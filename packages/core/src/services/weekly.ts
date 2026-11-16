/** 주간 돌아보기 (월–일, KST). LLM 없음 — 과제 상태·날짜·대화 수만으로. */
import type { SourceAi, WeeklyReviewItem, WeeklyReviewResponse } from '@subbrain/shared';
import { SOURCE_AI_META } from '@subbrain/shared/constants';
import type { Core } from '../core.ts';
import { addDays, daysBetween, kstDate, localIso, today, weekStart } from '../util/time.ts';
import { loadTasks, toListItem, type TaskFull } from './tasks.ts';
import { L } from '../util/lang.ts';

export const NEGLECT_DAYS = 14;

export function weeklyReview(core: Core, date?: string): WeeklyReviewResponse {
  const t0 = today();
  const ws = weekStart(date && date <= t0 ? date : t0);
  const we = addDays(ws, 6);
  const isCurrent = ws === weekStart(t0);
  const ref = isCurrent ? t0 : we; // 이 주 끝(이번 주면 오늘)
  const inWeek = (iso: string | null) => { if (!iso) return false; const d = kstDate(iso); return d >= ws && d <= we; };
  const tasks = loadTasks(core).filter((t) => t.kind !== 'quick_question' && t.status !== '간단한 질문');
  const item = (t: TaskFull, at: string | null): WeeklyReviewItem => ({ task: toListItem(t), at });
  const lastDay = (t: TaskFull) => (t.lastActivityAt ? kstDate(t.lastActivityAt) : null);
  // 과거 주: 그 주 끝에 열려 있었고(시작 ≤ 주 끝, 완료가 없거나 주 끝 뒤), 마지막 활동이 그 주 끝 이전 → 그 시점 멈춘 일수로 근사
  const openAt = (t: TaskFull) => t.status !== '보관' && (!t.startedAt || kstDate(t.startedAt) <= ref) && (!t.completedAt || t.status !== '완료' || kstDate(t.completedAt) > ref);
  const idleAt = (t: TaskFull) => { const l = lastDay(t); return l && l <= ref ? daysBetween(l, ref) : null; };

  const finished = tasks.filter((t) => t.status === '완료' && inWeek(t.completedAt)).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')).map((t) => item(t, t.completedAt));
  const started = tasks.filter((t) => inWeek(t.startedAt)).sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? '')).map((t) => item(t, t.startedAt));
  const idle = tasks.filter(openAt).map((t) => ({ t, d: idleAt(t) })).filter((x): x is { t: TaskFull; d: number } => x.d !== null);
  const stalledMin = (t: TaskFull) => t.thresholds.inProgressMaxDays;
  const stalled = idle.filter((x) => x.d > stalledMin(x.t) && x.d < NEGLECT_DAYS).sort((a, b) => b.d - a.d)
    .map((x) => withStale(item(x.t, x.t.lastActivityAt), x.d));
  const neglected = idle.filter((x) => x.d >= NEGLECT_DAYS).sort((a, b) => b.d - a.d).map((x) => withStale(item(x.t, x.t.lastActivityAt), x.d));

  // 대화: 그 주에 메시지가 있었던 대화 (메시지 시각이 없으면 대화 updated_at)
  const startIso = localIso(ws), endIso = localIso(addDays(we, 1));
  const sMs = Date.parse(startIso), eMs = Date.parse(endIso);
  const rows = core.db.all<{ source_ai: string; id: string; updated_at: string | null; n: number | null }>(
    `SELECT c.source_ai, c.id, c.updated_at, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.created_at IS NOT NULL) AS n FROM conversations c WHERE c.deleted_at IS NULL`);
  const msgRows = core.db.all<{ conversation_id: string; created_at: string }>(
    'SELECT conversation_id, created_at FROM messages WHERE created_at >= ? AND created_at < ?', new Date(sMs - 86_400_000).toISOString().slice(0, 10), new Date(eMs + 86_400_000).toISOString().slice(0, 10) + 'T99');
  const perConv = new Map<string, number>();
  for (const m of msgRows) { const ms = Date.parse(m.created_at); if (ms >= sMs && ms < eMs) perConv.set(m.conversation_id, (perConv.get(m.conversation_id) ?? 0) + 1); }
  const byAiMap = new Map<SourceAi, { conversationCount: number; messageCount: number }>();
  for (const r of rows) {
    let n = perConv.get(r.id) ?? 0;
    if (!n && !(r.n ?? 0) && r.updated_at) { const ms = Date.parse(r.updated_at); if (ms >= sMs && ms < eMs) n = 0.5; } // 메시지 시각 없는 대화
    if (!n) continue;
    const e = byAiMap.get(r.source_ai as SourceAi) ?? { conversationCount: 0, messageCount: 0 };
    e.conversationCount++; e.messageCount += Math.floor(n);
    byAiMap.set(r.source_ai as SourceAi, e);
  }
  const byAi = SOURCE_AI_META.map((m) => m.key).filter((k) => byAiMap.has(k)).map((k) => ({ sourceAi: k, ...byAiMap.get(k)! }))
    .sort((a, b) => b.conversationCount - a.conversationCount);
  return {
    weekStart: ws, weekEnd: we, prevWeek: addDays(ws, -7), nextWeek: isCurrent ? null : addDays(ws, 7), isCurrent, today: t0,
    finished, started, stalled, neglected, byAi,
    conversationCount: byAi.reduce((n, x) => n + x.conversationCount, 0), messageCount: byAi.reduce((n, x) => n + x.messageCount, 0), neglectDays: NEGLECT_DAYS,
  };
}
/** 과거 주는 그 시점 멈춘 일수로 배지를 바꿔 보여 준다 */
function withStale(it: WeeklyReviewItem, d: number): WeeklyReviewItem {
  return { ...it, task: { ...it.task, staleDays: d, badge: L(`${d}일`, `${d}d`) } };
}
