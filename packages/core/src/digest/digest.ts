/**
 * 아침 요약(§10.2, 계약서 §8). 규칙으로 만든다(LLM 키가 없어도 동작).
 * digests.body_json에 저장하고, 읽을 때 prevDate/nextDate·수집 상태·vault 경로를 채운다.
 */
import { digestOntologyCard } from '../ontology/api.ts';
import type { DigestEvent, DigestEventAction, DigestListItem, DigestPick, DigestResponse, DigestStrip, ProjectRef, SourceAi } from '@subbrain/shared';
import { DIGEST_ACTION_LABEL, SOURCE_AI_LABEL, WEEKDAY_KO } from '@subbrain/shared/constants';
import type { Core } from '../core.ts';
import { json } from '../db/db.ts';
import { WEEKDAY_EN, localIso, addDays, koMonthDay, koTimeLabel, kstDate, nowIso, startOfDayIso, today, weekStart, weekday } from '../util/time.ts';
import { continueTarget, isQuickAnswered, loadTasks, projectRef, scoreOf, toTaskRef, type TaskFull } from '../services/tasks.ts';
import { collectionStatus } from '../services/lists.ts';
import { mergeSuggestionsFor } from '../services/views.ts';
import { listProjectSuggestions } from '../services/project-suggestions.ts';
import { cleanupEnabled, cleanupForDigest, ensureDailyBatch } from '../cleanup/cleanup.ts';
import { L } from '../util/lang.ts';

export const digestTitle = (date: string) => L(`${koMonthDay(date)} ${WEEKDAY_KO[weekday(date)]} 아침`, `${WEEKDAY_EN[weekday(date)]} morning, ${koMonthDay(date)}`);

const ACTION_EN: Record<keyof typeof DIGEST_ACTION_LABEL, string> = { completed: 'Done', started: 'Started', continued: 'Continued', stalled: 'Stalled', archived: 'Archived', wiki_drafted: 'Wiki draft' };

type Body = Omit<DigestResponse, 'prevDate' | 'nextDate' | 'collectionStatus' | 'vault'>;

export function generateDigest(core: Core, date: string = today()): DigestResponse {
  const db = core.db;
  if (cleanupEnabled()) ensureDailyBatch(core, date); // 채팅창 정리 미리보기: 매일 요약 때 그날 배치를 만든다(되돌릴 수 있는 일만)
  const y = addDays(date, -1);
  const yStart = startOfDayIso(y), yEnd = startOfDayIso(date);
  // 멈춤 전환은 D 03:00 새벽 계산에서 생기므로 D 04:00까지 포함한다
  const stallEnd = localIso(date, '04:00:00');
  const tasks = loadTasks(core);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const evs = db.all<{ at: string; type: string; task_id: string | null; conversation_id: string | null; actor: DigestEvent['actor']; payload_json: string }>(
    "SELECT at, type, task_id, conversation_id, actor, payload_json FROM events WHERE at >= ? AND ((at < ? AND type IN ('conversation_started','message_added','status_changed','completed')) OR (at < ? AND type='status_changed' AND payload_json LIKE '%멈춤%')) ORDER BY at, id", yStart, yEnd, stallEnd);
  const events: DigestEvent[] = [];
  const stalledGroup: Array<{ id: string; title: string; project: ProjectRef | null }> = [];
  const projMoves = new Map<string, { project: ProjectRef; messageCount: number; started: number; completed: number; continued: number; becameStalled: boolean }>();
  const bump = (t: TaskFull | undefined, f: 'started' | 'completed' | 'continued' | 'becameStalled', msgs = 0) => {
    if (!t?.project) return;
    const m = projMoves.get(t.project.id) ?? { project: projectRef(t.project)!, messageCount: 0, started: 0, completed: 0, continued: 0, becameStalled: false };
    if (f === 'becameStalled') m.becameStalled = true; else m[f]++;
    m.messageCount += msgs;
    projMoves.set(t.project.id, m);
  };
  const seen = new Set<string>();
  for (const e of evs) {
    const t = e.task_id ? byId.get(e.task_id) : undefined;
    if (!t || t.kind !== 'task') continue;
    const p = json<Record<string, unknown>>(e.payload_json, {});
    let action: DigestEventAction | null = null;
    if (e.type === 'completed') action = 'completed';
    else if (e.type === 'conversation_started') action = 'started';
    else if (e.type === 'message_added') action = 'continued';
    else if (e.type === 'status_changed' && p.to === '멈춤') { if (!stalledGroup.some((g) => g.id === t.id)) stalledGroup.push({ id: t.id, title: t.title, project: projectRef(t.project) }); bump(t, 'becameStalled'); continue; }
    else if (e.type === 'status_changed' && p.to === '보관') action = 'archived';
    if (!action || e.at >= yEnd) continue;
    const key = `${action}:${t.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const added = Number(p.added ?? 0);
    bump(t, action === 'archived' ? 'continued' : action, added);
    events.push({
      at: e.at, timeLabel: koTimeLabel(e.at), actor: e.actor, sourceAi: t.primary[0]?.sourceAi ?? null, action, actionLabel: L(DIGEST_ACTION_LABEL[action], ACTION_EN[action]),
      tasks: [{ id: t.id, title: t.title }], project: projectRef(t.project), note: action === 'continued' && added ? L(`${t.project?.name ?? '과제'} · 메시지 ${added}개 추가`, `${t.project?.name ?? 'Task'} · ${added} new message${added === 1 ? '' : 's'}`) : null,
    });
  }
  // 멈춤 전환은 프로젝트별로 한 줄씩 (project를 항상 채움, 프로젝트 없는 과제만 null)
  const stallByProject = new Map<string, { project: ProjectRef | null; tasks: Array<{ id: string; title: string }> }>();
  for (const g of stalledGroup) {
    const k = g.project?.id ?? '';
    const cur = stallByProject.get(k) ?? { project: g.project, tasks: [] };
    cur.tasks.push({ id: g.id, title: g.title });
    stallByProject.set(k, cur);
  }
  for (const g of stallByProject.values()) {
    events.push({ at: localIso(date, '03:00:00'), timeLabel: L('새벽 계산', 'Overnight check'), actor: 'rule', sourceAi: null, action: 'stalled', actionLabel: L(DIGEST_ACTION_LABEL.stalled, ACTION_EN.stalled), tasks: g.tasks, project: g.project,
      note: g.project ? L(`${g.project.name} · ${g.tasks.length}개 멈춤으로`, `${g.project.name} · ${g.tasks.length} moved to stalled`) : L(`${g.tasks.length}개 멈춤으로`, `${g.tasks.length} moved to stalled`) });
  }
  const yConvs = db.all<{ id: string; task_id: string | null; message_count: number }>('SELECT id, task_id, message_count FROM conversations WHERE updated_at >= ? AND updated_at < ?', yStart, yEnd);
  const quick = tasks.filter((t) => isQuickAnswered(t) && t.lastActivityAt && t.lastActivityAt >= yStart && t.lastActivityAt < yEnd);
  const byAi = new Map<SourceAi, number>();
  for (const t of quick) { const ai = t.primary[0]?.sourceAi; if (ai) byAi.set(ai, (byAi.get(ai) ?? 0) + 1); }
  const sources = collectionStatus(core);
  const gapHours = sources.map((s) => (s.lastCapturedAt ? (Date.parse(localIso(date, '08:00:00')) - Date.parse(s.lastCapturedAt)) / 3600_000 : null)).filter((h): h is number => h !== null);
  const worst = gapHours.length ? Math.max(...gapHours) : null;
  const hasGap = worst !== null && worst >= 24; // 내보내기 방식은 하루 넘게 비면 공백으로 본다
  const completedN = events.filter((e) => e.action === 'completed').length;
  const strip: DigestStrip = {
    yesterdayConversations: yConvs.length, completedTasks: completedN, newlyStalled: stalledGroup.length, quickQuestions: quick.length,
    collectionGap: { hasGap, hours: hasGap && worst !== null ? Math.round(worst) : null, label: hasGap && worst !== null ? L(`${Math.round(worst)}시간`, `${Math.round(worst)}h`) : L('없음', 'None') },
  };
  const startedN = events.filter((e) => e.action === 'started').length;
  const parts: string[] = [];
  const titles = (a: DigestEventAction) => events.filter((e) => e.action === a).flatMap((e) => e.tasks.map((x) => `‘${x.title}’`));
  const doneTitles = titles('completed'), startTitles = titles('started');
  const contTitles = titles('continued').filter((x) => !doneTitles.includes(x) && !startTitles.includes(x));
  if (doneTitles.length) parts.push(L(`어제는 ${doneTitles.slice(0, 2).join(', ')}${doneTitles.length > 2 ? ` 등 ${doneTitles.length}개` : ''}을(를) 끝냈어요.`, `Yesterday you finished ${doneTitles.slice(0, 2).join(', ')}${doneTitles.length > 2 ? ` and ${doneTitles.length - 2} more` : ''}.`));
  else parts.push(yConvs.length ? L(`어제는 대화 ${yConvs.length}개가 있었어요.`, `Yesterday you had ${yConvs.length} chat${yConvs.length === 1 ? '' : 's'}.`) : L('어제는 새로 들어온 대화가 없었어요.', 'No new chats came in yesterday.'));
  if (startedN) parts.push(L(`${startTitles.slice(0, 2).join(', ')}${startedN > 2 ? ' 등' : ''}을(를) 새로 시작했어요.`, `You started ${startTitles.slice(0, 2).join(', ')}${startedN > 2 ? ' and more' : ''}.`));
  if (contTitles.length) parts.push(L(`${contTitles.slice(0, 2).join(', ')}${contTitles.length > 2 ? ` 외 ${contTitles.length - 2}개` : ''}는 이어서 진행했어요.`, `You kept going on ${contTitles.slice(0, 2).join(', ')}${contTitles.length > 2 ? ` and ${contTitles.length - 2} more` : ''}.`));
  if (stalledGroup.length) parts.push(L(`${stalledGroup.map((s) => s.title).slice(0, 2).join(', ')}${stalledGroup.length > 2 ? ' 등' : ''}은(는) 대화가 끊겨 ‘멈춤’으로 옮겼어요.`, `${stalledGroup.map((s) => s.title).slice(0, 2).join(', ')}${stalledGroup.length > 2 ? ' and others' : ''} went quiet and moved to ‘Stalled’.`));
  // 오늘 이어서 할 것 Top 3 (§7.7 점수)
  const picks: DigestPick[] = tasks.filter((t) => t.kind === 'task' && (t.status === '진행 중' || t.status === '멈춤') && t.nextStep)
    .map((t) => ({ t, s: scoreOf(t) })).sort((a, b) => b.s - a.s).slice(0, 3)
    .map(({ t, s }, i) => {
      const orig = t.primary[0] ?? null;
      const rec: SourceAi = orig?.sourceAi ?? 'chatgpt';
      const cont = continueTarget(orig);
      const d = t.stale.staleDays;
      return {
        rank: i + 1, task: toTaskRef(t), project: projectRef(t.project), freshnessLabel: d === null ? (t.lastActivityAt && kstDate(t.lastActivityAt) === y ? L('어제', 'Yesterday') : L('최근', 'Recently')) : L(`${d}일째`, `${d} days idle`),
        nextStep: t.nextStep ?? '', reason: L(`${t.project?.name ?? '프로젝트 없음'} · ${t.status === '진행 중' ? '흐름이 끊기기 전에 짧게 마무리' : '다음 단계가 분명해요'}`, `${t.project?.name ?? 'No project'} · ${t.status === '진행 중' ? 'Wrap it up before you lose the thread' : 'The next step is clear'}`),
        recommendedAi: rec, actionLabel: L(`${SOURCE_AI_LABEL[rec]}에서 이어서`, `Continue in ${SOURCE_AI_LABEL[rec]}`), continue: cont, resumeScore: Math.round(s * 100) / 100,
      };
    });
  const neglected = tasks.filter((t) => t.status === '멈춤' && t.kind === 'task' && (t.stale.staleDays ?? 0) >= 31).sort((a, b) => (b.stale.staleDays ?? 0) - (a.stale.staleDays ?? 0));
  const monday = weekStart(date);
  const weekDone = tasks.filter((t) => t.status === '완료' && t.completedAt && kstDate(t.completedAt) >= monday && kstDate(t.completedAt) < date);
  const weekStarted = tasks.filter((t) => t.kind === 'task' && t.startedAt && kstDate(t.startedAt) >= monday && kstDate(t.startedAt) < date);
  const items: string[] = [
    ...weekDone.slice(0, 3).map((t) => L(`‘${t.title}’을(를) 끝냈어요.`, `Finished ‘${t.title}’.`)),
    ...weekStarted.filter((t) => !weekDone.includes(t)).slice(0, 2).map((t) => L(`‘${t.title}’을(를) 시작했어요.`, `Started ‘${t.title}’.`)),
  ];
  const lastDay = addDays(date, -1);
  const rangeLabel = monday >= date ? L('이번 주 시작', 'Week just started') : L(`${WEEKDAY_KO[weekday(monday)]!.slice(0, 1)}–${WEEKDAY_KO[weekday(lastDay)]!.slice(0, 1)} · 하루 한 번 새로 씀`, `${WEEKDAY_EN[weekday(monday)]!.slice(0, 3)}–${WEEKDAY_EN[weekday(lastDay)]!.slice(0, 3)} · refreshed daily`);
  const body: Body = {
    date, generatedAt: nowIso(), title: digestTitle(date), strip,
    yesterday: { date: y, narrative: parts.join(' '), events },
    thisWeek: { rangeLabel, items: items.length ? items : [L('이번 주에는 아직 끝내거나 시작한 과제가 없어요.', 'Nothing finished or started yet this week.')] },
    todayPicks: picks,
    longNeglected: { count: neglected.length, items: neglected.slice(0, 5).map(toTaskRef), prompt: L('계속할까요, 보관할까요?', 'Pick it back up, or archive it?') },
    movedProjects: [...projMoves.values()].sort((a, b) => b.messageCount - a.messageCount).map((m) => ({
      project: m.project, messageCount: m.messageCount, becameStalled: m.becameStalled,
      note: m.becameStalled && !m.messageCount ? L('멈춤으로', 'Stalled') : m.started ? L(`시작 ${m.started}`, `${m.started} started`) : m.completed ? L(`완료 ${m.completed}`, `${m.completed} done`) : m.continued ? L('이어감', 'Continued') : L(`메시지 ${m.messageCount}`, `${m.messageCount} messages`),
    })),
    quickQuestionsByAi: [...byAi.entries()].map(([sourceAi, count]) => ({ sourceAi, count })),
    pendingMergeSuggestions: mergeSuggestionsFor(core, { state: 'pending' }).slice(0, 3),
    alerts: sources.filter((s) => s.health !== 'ok').map((s) => ({ level: s.health === 'broken' ? 'error' as const : 'warn' as const, message: L(`${SOURCE_AI_LABEL[s.sourceAi]} 수집에 문제가 있어요${s.message ? `: ${s.message}` : ''}.`, `${SOURCE_AI_LABEL[s.sourceAi]} capture has a problem${s.message ? `: ${s.message}` : ''}.`), sourceAi: s.sourceAi })),
    ontology: digestOntologyCard(core, startOfDayIso(y)), cleanup: null, // 1.7.0 제안 검토 카드
  };
  saveDigest(core, body);
  return readDigest(core, date)!;
}

export function saveDigest(core: Core, body: Body | DigestResponse): void {
  const { prevDate: _p, nextDate: _n, collectionStatus: _c, vault: _v, ...rest } = body as DigestResponse;
  core.db.run('INSERT INTO digests(date,generated_at,body_json) VALUES (?,?,?) ON CONFLICT(date) DO UPDATE SET generated_at=excluded.generated_at, body_json=excluded.body_json', rest.date, rest.generatedAt, JSON.stringify(rest));
  if (core.settings.get().digest.writeDailyNote) core.vault.schedule('daily', rest.date);
}

export function readDigest(core: Core, date: string): DigestResponse | null {
  const row = core.db.get<{ body_json: string }>('SELECT body_json FROM digests WHERE date=?', date);
  if (!row) return null;
  const body = json<Body>(row.body_json, {} as Body);
  const prev = core.db.value<string>('SELECT date FROM digests WHERE date < ? ORDER BY date DESC LIMIT 1', date);
  const next = core.db.value<string>('SELECT date FROM digests WHERE date > ? ORDER BY date LIMIT 1', date);
  const { date: _d, generatedAt, title, ...rest } = body;
  return { date, generatedAt, title, prevDate: prev, nextDate: next, vault: core.vault.ref('daily', date), strip: rest.strip, yesterday: rest.yesterday, collectionStatus: collectionStatus(core),
    thisWeek: rest.thisWeek, todayPicks: rest.todayPicks, longNeglected: rest.longNeglected, movedProjects: rest.movedProjects, quickQuestionsByAi: rest.quickQuestionsByAi,
    pendingMergeSuggestions: rest.pendingMergeSuggestions, alerts: rest.alerts, ontology: rest.ontology ?? null, cleanup: cleanupEnabled() ? cleanupForDigest(core, date) : rest.cleanup ?? null,
    // 1.1.0: 과제가 충분히 모인 새 프로젝트 제안(읽을 때마다 현재 상태로)
    pendingProjectSuggestions: listProjectSuggestions(core, { state: 'pending', ready: true }).slice(0, 3) };
}

export function listDigests(core: Core): DigestListItem[] {
  return core.db.all<{ date: string; generated_at: string; body_json: string }>('SELECT date, generated_at, body_json FROM digests ORDER BY date DESC').map((r) => {
    const b = json<Body>(r.body_json, {} as Body);
    return { date: r.date, generatedAt: r.generated_at, title: b.title ?? digestTitle(r.date), strip: b.strip };
  });
}
