/** 읽기 화면들: 과제 상세 · 대화 흐름 · 대화 상세 · 합치기 제안 · 주제 */
import { nextStepInfoOf } from './next-step.ts';
import type {
  ClassificationInfo, ConversationDetail, Decision, FlowEntry, FlowResponse, HandoffInfo, Kind, MergeSuggestion, Message, MessageRole,
  Resolution, SourceAi, ChatSourceAi, TaskDetail, TopicDetail, CompletionReason,
} from '@subbrain/shared';
import { SOURCE_AI_META } from '@subbrain/shared/constants';
import type { Core } from '../core.ts';
import { json, str, type Row } from '../db/db.ts';
import { encodeCursor } from '../util/ids.ts';
import { daysBetween, dotMonthDay, kstDate, today, weekStart, addDays } from '../util/time.ts';
import { computeExcerpts } from './excerpts.ts';
import { buildResumePrompt, freshCached } from './resume.ts';
import { whyStalledLegacy } from '../ontology/api.ts';
import {
  continueTarget, latestPrimary, loadProjects, loadTask, loadTasks, primaryAis, projectRef, toListItem, toTaskRef, sortTasks, type TaskFull, outcomeInfo } from './tasks.ts';
import { L } from '../util/lang.ts';

export function classificationInfo(core: Core, r: Row | undefined, taskOverrides: string[] = []): ClassificationInfo | null {
  if (!r) return null;
  const s = core.settings.get();
  const resolution = String(r.resolution) as Resolution;
  const confidence = Number(r.confidence ?? 0);
  const blocked = str(r.state) === 'blocked';
  const raw = r.raw_confidence === null || r.raw_confidence === undefined ? null : Number(r.raw_confidence);
  return {
    kind: String(r.kind) as Kind, resolution, completionReason: resolution === 'resolved' ? (String(r.kind) === 'quick_question' ? 'answered' : 'resolved') : resolution === 'abandoned' ? 'abandoned' : null as CompletionReason | null,
    confidence, evidence: str(r.evidence), model: String(r.model), promptVersion: String(r.prompt_version), classifiedAt: String(r.created_at),
    needsReview: (confidence < s.classification.lowConfidenceThreshold || blocked) && !taskOverrides.includes('status'),
    state: blocked ? 'blocked' : 'ok', blockedReason: str(r.blocked_reason), blockedModel: str(r.blocked_model),
    rawConfidence: raw === null ? null : Math.min(1, Math.max(0, raw)), handoff: json<HandoffInfo | null>(r.handoff_json, null),
    cached: Number(r.cache_hit ?? 0) === 1,
  };
}

export function loadDecisions(core: Core, taskId: string): Decision[] {
  return core.db.all("SELECT id, name, properties_json FROM objects WHERE type='decision' AND ref_table='tasks' AND ref_id=? AND status IN ('accepted','suggested') ORDER BY first_seen_at DESC, id", taskId).map((r) => {
    const p = json<{ conversationId?: string | null; sourceAi?: SourceAi | null; decidedAt?: string | null; valid?: boolean; overridden?: boolean }>(r.properties_json, {});
    return { id: String(r.id), text: String(r.name), sourceConversationId: p.conversationId ?? null, sourceAi: p.sourceAi ?? null, decidedAt: p.decidedAt ?? null, valid: p.valid ?? true, overridden: p.overridden ?? false };
  });
}

export function mergeSuggestionsFor(core: Core, where: { state?: string; taskId?: string; minConfidence?: number; ids?: string[] }): MergeSuggestion[] {
  const conds: string[] = [], params: Array<string | number> = [];
  if (where.state) { conds.push('state=?'); params.push(where.state); }
  if (where.taskId) { conds.push('(task_a=? OR task_b=?)'); params.push(where.taskId, where.taskId); }
  if (where.minConfidence !== undefined) { conds.push('confidence>=?'); params.push(where.minConfidence); }
  if (where.ids) { conds.push('id IN (SELECT value FROM json_each(?))'); params.push(JSON.stringify(where.ids)); }
  const rows = core.db.all(`SELECT * FROM task_merge_suggestions ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''} ORDER BY confidence DESC, created_at DESC`, ...params);
  const taskIds = [...new Set(rows.flatMap((r) => [String(r.task_a), String(r.task_b)]))];
  const tasks = new Map(loadTasks(core, { ids: taskIds }).map((t) => [t.id, t]));
  const out: MergeSuggestion[] = [];
  for (const r of rows) {
    const a = tasks.get(String(r.task_a)), b = tasks.get(String(r.task_b));
    if (!a || !b) continue;
    out.push({
      id: String(r.id), state: String(r.state) as MergeSuggestion['state'], confidence: Number(r.confidence), reason: String(r.reason),
      tasks: [{ ...toTaskRef(a), sourceAis: primaryAis(a) }, { ...toTaskRef(b), sourceAis: primaryAis(b) }],
      suggestedPrimaryTaskId: String(r.suggested_primary), createdAt: String(r.created_at), decidedAt: str(r.decided_at),
      // 1.5.0 넘겨준 대화 ↔ 로컬 세션
      ...(String(r.kind ?? 'same_task') === 'handoff_session' ? { kind: 'handoff_session' as const, handoff: json<MergeSuggestion['handoff']>(r.handoff_json, null) } : {}),
    });
  }
  return out;
}

function topicsOf(core: Core, taskId: string): Array<{ id: string; name: string }> {
  return core.db.all<{ id: string; name: string }>("SELECT o.id, o.name FROM task_topics tt JOIN objects o ON o.id=tt.topic_id WHERE tt.task_id=? AND o.status IN ('accepted','suggested') ORDER BY tt.confidence DESC, o.mention_count DESC", taskId);
}

/** 그래프 이웃 수 (과제 모드: 프로젝트 · 주제 · 과제↔과제 연결 · 합치기 후보) */
function neighborCount(core: Core, t: TaskFull): number {
  const n = new Set<string>();
  if (t.projectId) n.add(t.projectId);
  for (const r of core.db.all<{ topic_id: string }>('SELECT topic_id FROM task_topics WHERE task_id=?', t.id)) n.add(r.topic_id);
  for (const r of core.db.all<{ o: string }>('SELECT CASE WHEN src_task_id=? THEN dst_task_id ELSE src_task_id END AS o FROM task_links WHERE src_task_id=? OR dst_task_id=?', t.id, t.id, t.id)) n.add(r.o);
  for (const r of core.db.all<{ o: string }>("SELECT CASE WHEN task_a=? THEN task_b ELSE task_a END AS o FROM task_merge_suggestions WHERE state='pending' AND (task_a=? OR task_b=?)", t.id, t.id, t.id)) n.add(r.o);
  return n.size;
}

export function taskDetail(core: Core, taskId: string): TaskDetail | null {
  const t = loadTask(core, taskId);
  if (!t) return null;
  const db = core.db;
  const lp = latestPrimary(t);
  const byAiMap = new Map<SourceAi, { conversationCount: number; messageCount: number; sharedConversationCount: number }>();
  for (const c of t.convs) {
    const e = byAiMap.get(c.sourceAi) ?? { conversationCount: 0, messageCount: 0, sharedConversationCount: 0 };
    e.conversationCount++; e.messageCount += c.messageCount; if (c.role === 'shared') e.sharedConversationCount++;
    byAiMap.set(c.sourceAi, e);
  }
  const byAi = SOURCE_AI_META.map((m) => m.key).filter((k) => byAiMap.has(k)).map((k) => ({ sourceAi: k, ...byAiMap.get(k)! }))
    .sort((a, b) => b.conversationCount - a.conversationCount || b.messageCount - a.messageCount);
  const decisions = loadDecisions(core, taskId);
  const topics = topicsOf(core, taskId);
  const cls = t.classificationId !== null ? db.get('SELECT * FROM classifications WHERE id=?', t.classificationId) : undefined;
  // 함께 보면 좋은 것: 같은 주제를 가진 다른 과제(직접 연결·합치기 후보 제외), 완료 먼저
  const excluded = new Set<string>([t.id,
    ...db.all<{ o: string }>('SELECT CASE WHEN src_task_id=? THEN dst_task_id ELSE src_task_id END AS o FROM task_links WHERE src_task_id=? OR dst_task_id=?', t.id, t.id, t.id).map((r) => r.o),
    ...db.all<{ o: string }>('SELECT CASE WHEN task_a=? THEN task_b ELSE task_a END AS o FROM task_merge_suggestions WHERE task_a=? OR task_b=?', t.id, t.id, t.id).map((r) => r.o)]);
  const simRows = db.all<{ task_id: string; topic_id: string; name: string }>(
    'SELECT tt2.task_id, o.id AS topic_id, o.name FROM task_topics tt1 JOIN task_topics tt2 ON tt1.topic_id=tt2.topic_id AND tt2.task_id<>tt1.task_id JOIN objects o ON o.id=tt1.topic_id WHERE tt1.task_id=?', t.id);
  const simTopic = new Map<string, string>();
  for (const r of simRows) if (!excluded.has(r.task_id) && !simTopic.has(r.task_id)) simTopic.set(r.task_id, r.name);
  const simTasks = loadTasks(core, { ids: [...simTopic.keys()] }).filter((x) => x.status !== '보관' && x.kind === 'task')
    .sort((a, b) => Number(b.status === '완료') - Number(a.status === '완료') || (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '')).slice(0, 5);
  const firstPrimary = [...t.primary].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null;
  const lastConv = t.primary[0] ?? null;
  return {
    id: t.id, title: t.title, kind: t.kind, status: t.status, statusSource: t.statusSource, stale: t.stale,
    completionReason: t.status === '완료' ? t.completionReason : null, project: projectRef(t.project),
    breadcrumb: [{ label: L('그래프', 'Graph'), href: '/' }, ...(t.project ? [{ label: t.project.name, href: `/?focus=${t.project.id}` }] : []), { label: t.kind === 'quick_question' ? L('간단한 질문', 'Quick question') : L('과제', 'Task'), href: null }],
    origin: t.origin, pin: t.pin, overrides: t.overrides, startedAt: t.startedAt, lastActivityAt: t.lastActivityAt, completedAt: t.status === '완료' ? t.completedAt : null,
    firstConversationAt: firstPrimary?.createdAt ?? null, lastConversationAt: lastConv?.updatedAt ?? null,
    conversationCount: t.convs.length, messageCount: t.convs.reduce((n, c) => n + c.messageCount, 0), byAi, topics,
    summary: t.summary, summaryDetail: t.summaryDetail, nextStep: t.nextStep, nextStepInfo: nextStepInfoOf(t), classification: classificationInfo(core, cls, t.overrides),
    handoff: t.handoff, classificationState: t.classificationState,
    conversationOutcome: lastConv ? outcomeInfo(lastConv, t, t.thresholds) : null,
    conversationOutcomes: t.convs.map((c) => ({ conversationId: c.id, sourceAi: c.sourceAi, title: c.title, role: c.role, updatedAt: c.updatedAt, outcome: outcomeInfo(c, c.role === 'primary' ? t : null, t.thresholds) })),
    vault: core.vault.ref('task', t.id), decisions, openQuestions: t.openQuestions,
    resume: {
      defaultTargetAi: chatAi(lp?.sourceAi), targets: ['chatgpt', 'claude', 'gemini', 'grok'],
      promptPreview: freshCached(t) ? t.resumePrompt! : buildResumePrompt(t, decisions, chatAi(lp?.sourceAi)),
      continue: continueTarget(lp), continueNote: lp ? L(`원래 대화(${dotMonthDay(kstDate(lp.updatedAt))})에 이어 붙임`, `Appended to the original chat (${dotMonthDay(kstDate(lp.updatedAt))})`) : null,
    },
    related: {
      similarTasks: simTasks.map((x) => ({ ...toTaskRef(x), projectName: x.project?.name ?? null, sourceAi: latestPrimary(x)?.sourceAi ?? null, reason: L(`같은 주제 #${simTopic.get(x.id)}`, `Shared topic #${simTopic.get(x.id)}`), completedAt: x.status === '완료' ? x.completedAt : null })),
      wikiPages: [],
    },
    mergeSuggestions: mergeSuggestionsFor(core, { state: 'pending', taskId: t.id }), neighborCount: neighborCount(core, t), whyStalled: whyStalledLegacy(core, t.id), // 1.7.0 온톨로지 막힘 사슬(없으면 null)
  };
}

export function taskFlow(core: Core, taskId: string, q: { filter?: 'all' | 'excerpts' | 'decisions'; limit?: number; offset: number }): FlowResponse | null {
  const t = loadTask(core, taskId);
  if (!t) return null;
  const db = core.db;
  const t0 = today();
  const decisions = loadDecisions(core, taskId);
  const startId = [...t.primary].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.id ?? null;
  const convs = [...t.convs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  let prevDate = t0;
  const all: FlowEntry[] = convs.map((c) => {
    const date = kstDate(c.updatedAt);
    const gap = Math.max(0, daysBetween(date, prevDate));
    prevDate = date;
    const cls = db.get<{ summary: string | null; evidence: string | null }>('SELECT summary, evidence FROM classifications WHERE conversation_id=? ORDER BY id DESC LIMIT 1', c.id);
    const shared = db.all<{ id: string; title: string }>('SELECT t.id, t.title FROM task_conversations tc JOIN tasks t ON t.id=tc.task_id WHERE tc.conversation_id=? AND tc.task_id<>?', c.id, taskId);
    return {
      conversationId: c.id, sourceAi: c.sourceAi, title: c.title, sourceUrl: c.url, createdAt: c.createdAt, updatedAt: c.updatedAt, date, gapDaysFromNewer: gap,
      messageCount: c.messageCount, summary: cls?.summary ?? null, excerpts: computeExcerpts(db, c.id, c.sourceAi, cls?.evidence ?? null),
      decisionIds: decisions.filter((d) => d.sourceConversationId === c.id).map((d) => d.id), isPrimary: c.role === 'primary', sharedWithTasks: shared,
      serviceState: c.serviceState, captureMethod: c.captureMethod, isStartOfTask: c.id === startId,
    };
  });
  const filtered = q.filter === 'excerpts' ? all.filter((e) => e.excerpts.length > 0) : q.filter === 'decisions' ? all.filter((e) => e.decisionIds.length > 0) : all;
  const limit = q.limit ?? 20;
  const items = filtered.slice(q.offset, q.offset + limit);
  const more = q.offset + limit < filtered.length;
  const last = t.primary[0]?.updatedAt ?? t.convs[0]?.updatedAt ?? null;
  return {
    items, page: { limit, nextCursor: more ? encodeCursor(q.offset + limit) : null, hasMore: more, total: filtered.length },
    today: { date: t0, daysSinceLastConversation: last ? Math.max(0, daysBetween(kstDate(last), t0)) : 0 }, totalConversations: t.convs.length,
  };
}

export function conversationDetail(core: Core, id: string, q: { limit?: number; offset: number; aroundSeq?: number }): ConversationDetail | null {
  const db = core.db;
  const c = db.get('SELECT * FROM conversations WHERE id=?', id);
  if (!c) return null;
  const limit = q.limit ?? 100;
  const total = Number(db.value('SELECT COUNT(*) FROM messages WHERE conversation_id=?', id) ?? 0);
  const offset = q.aroundSeq !== undefined
    ? Math.max(0, (Number(db.value('SELECT COUNT(*) FROM messages WHERE conversation_id=? AND seq<?', id, q.aroundSeq) ?? 0)) - Math.floor(limit / 2)) : q.offset;
  const msgs: Message[] = db.all('SELECT id, seq, role, content_md, created_at, voice FROM messages WHERE conversation_id=? ORDER BY seq LIMIT ? OFFSET ?', id, limit, offset)
    .map((m) => ({ id: Number(m.id), seq: Number(m.seq), role: String(m.role) as MessageRole, contentMd: String(m.content_md), createdAt: str(m.created_at), ...(Number(m.voice ?? 0) === 1 ? { voice: true } : {}) }));
  const primaryTask = c.task_id ? loadTask(core, String(c.task_id)) : null;
  const shared = db.all<{ id: string; title: string }>('SELECT t.id, t.title FROM task_conversations tc JOIN tasks t ON t.id=tc.task_id WHERE tc.conversation_id=? AND tc.task_id IS NOT ?', id, str(c.task_id));
  const cls = db.get('SELECT * FROM classifications WHERE conversation_id=? ORDER BY id DESC LIMIT 1', id);
  const more = offset + limit < total;
  return {
    id, sourceAi: String(c.source_ai) as SourceAi, sourceId: String(c.source_id), sourceUrl: str(c.source_url), title: String(c.title ?? ''),
    createdAt: String(c.created_at), updatedAt: String(c.updated_at), capturedAt: String(c.captured_at ?? c.updated_at), messageCount: Number(c.message_count),
    captureMethod: String(c.capture_method) as ConversationDetail['captureMethod'], serviceState: String(c.service_state) as ConversationDetail['serviceState'],
    pin: Number(c.pin) === 1, isShared: Number(c.is_shared) === 1, inServiceProject: Number(c.in_service_project) === 1, hasUnextractedArtifact: Number(c.has_unextracted_artifact) === 1,
    task: primaryTask ? toTaskRef(primaryTask) : null, sharedWithTasks: shared, classification: classificationInfo(core, cls, primaryTask?.overrides ?? []),
    vault: core.vault.ref('conversation', id), rawPath: str(c.raw_path),
    outcome: outcomeInfo({ outcomeJson: str(c.outcome_json), updatedAt: String(c.updated_at) }, primaryTask, primaryTask?.thresholds ?? core.thresholdsFor(null)),
    messages: { items: msgs, page: { limit, nextCursor: more ? encodeCursor(offset + limit) : null, hasMore: more, total } },
  };
}

export function topicDetail(core: Core, id: string): TopicDetail | null {
  const db = core.db;
  const o = db.get("SELECT * FROM objects WHERE id=? AND type='topic'", id);
  if (!o) return null;
  const taskIds = db.all<{ task_id: string }>('SELECT task_id FROM task_topics WHERE topic_id=?', id).map((r) => r.task_id);
  const tasks = sortTasks(loadTasks(core, { ids: taskIds }).filter((t) => t.status !== '보관'), 'last_activity_desc');
  const projects = loadProjects(core);
  const projIds = [...new Set(tasks.map((t) => t.projectId).filter((p): p is string => Boolean(p)))];
  // 주별 언급: 연결된 과제의 대화 수를 주 단위로
  const weeks = new Map<string, number>();
  for (const t of tasks) for (const c of t.convs) { const w = weekStart(kstDate(c.updatedAt)); weeks.set(w, (weeks.get(w) ?? 0) + 1); }
  const aliases = db.all<{ alias: string }>('SELECT alias FROM aliases WHERE object_id=? ORDER BY alias', id).map((r) => r.alias);
  return {
    id, name: String(o.name), aliases, objectStatus: String(o.status) as TopicDetail['objectStatus'], mentionCount: Number(o.mention_count ?? 0),
    firstSeenAt: str(o.first_seen_at), lastSeenAt: str(o.last_seen_at), tasks: tasks.map(toListItem),
    projects: projIds.map((p) => projectRef(projects.get(p) ?? null)!).filter(Boolean), wikiPages: [],
    weeklyMentions: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([start, count]) => ({ start, count })),
  };
}

/** 오늘부터 거꾸로 n주(월요일 시작) */
export function weekStarts(n: number, end = today()): string[] {
  const last = weekStart(end);
  return Array.from({ length: n }, (_, i) => addDays(last, -7 * (n - 1 - i)));
}

/** 1.5.0 이어서 하기 대상은 웹 채팅 4개뿐 — 로컬 세션(claude-code·codex)은 같은 회사 웹 서비스로 */
export function chatAi(a: SourceAi | undefined | null): ChatSourceAi {
  return a === 'claude-code' ? 'claude' : a === 'codex' ? 'chatgpt' : a === 'grokbot' ? 'grok' : a ?? 'chatgpt';
}
