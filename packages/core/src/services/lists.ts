/** 목록 화면들: 과제 목록 · 보드 · 프로젝트 · 대시보드 · 그래프 · 활동 */
import type {
  ActivityResponse, AdapterHealth, BoardColumn, BoardResponse, CaptureMethod, CollectionSourceStatus, DashboardResponse, GraphEdge, GraphNode,
  GraphResponse, ListResponse, ProjectDetail, ProjectStatus, ProjectSummary, SourceAi, StaleThresholds, TaskListItem, TaskStatus,
} from '@subbrain/shared';
import { SOURCE_AI_LABEL, SOURCE_AI_META } from '@subbrain/shared/constants';
import type { Core } from '../core.ts';
import { json, str } from '../db/db.ts';
import { projectActivity } from '../rules/rules.ts';
import { encodeCursor } from '../util/ids.ts';
import { addDays, daysBetween, kstDate, koMonthDay, nowIso, startOfDayIso, today, weekStart } from '../util/time.ts';
import { type ConvLite, continueTarget, isQuickAnswered, latestPrimary, loadProjects, loadTasks, primaryAis, primaryMessageCount, projectRef, scoreOf, sortTasks, toListItem, type TaskFull } from './tasks.ts';
import { weekStarts } from './views.ts';
import { pendingReadyCount } from './project-suggestions.ts';
import { L, statusLabel } from '../util/lang.ts';

export function page<T>(all: T[], offset: number, limit: number): ListResponse<T> {
  const items = all.slice(offset, offset + limit);
  const more = offset + limit < all.length;
  return { items, page: { limit, nextCursor: more ? encodeCursor(offset + limit) : null, hasMore: more, total: all.length } };
}

export interface TaskFilter {
  status?: TaskStatus[]; kind?: 'task' | 'quick_question'; projectId?: string[]; sourceAi?: SourceAi[]; from?: string; to?: string;
  needsReview?: boolean; pinned?: boolean; minStaleDays?: number; staleStage?: string[]; topicId?: string;
  classificationState?: 'ok' | 'blocked'; handedOff?: boolean;
}
export function filterTasks(core: Core, list: TaskFull[], f: TaskFilter): TaskFull[] {
  const topicTasks = f.topicId ? new Set(core.db.all<{ task_id: string }>('SELECT task_id FROM task_topics WHERE topic_id=?', f.topicId).map((r) => r.task_id)) : null;
  return list.filter((t) => {
    // 1.4.0 status=간단한 질문(사용 중단 예정 별칭) = 답 받은 간단한 질문(kind quick_question + 상태 완료)
    if (f.status && !f.status.includes(t.status) && !(f.status.includes('간단한 질문') && isQuickAnswered(t))) return false;
    if (f.kind && t.kind !== f.kind) return false;
    if (f.projectId && !f.projectId.some((p) => (p === 'none' ? t.projectId === null : t.projectId === p))) return false;
    if (f.sourceAi && !primaryAis(t).some((a) => f.sourceAi!.includes(a))) return false;
    const last = t.lastActivityAt ? kstDate(t.lastActivityAt) : null;
    if (f.from && (!last || last < f.from)) return false;
    if (f.to && (!last || last > f.to)) return false;
    if (f.needsReview !== undefined && t.needsReview !== f.needsReview) return false;
    if (f.pinned !== undefined && t.pin !== f.pinned) return false;
    if (f.minStaleDays !== undefined && (t.stale.staleDays ?? -1) < f.minStaleDays) return false;
    if (f.staleStage && (!t.stale.staleStage || !f.staleStage.includes(t.stale.staleStage))) return false;
    if (topicTasks && !topicTasks.has(t.id)) return false;
    if (f.classificationState && t.classificationState !== f.classificationState) return false;
    if (f.handedOff !== undefined && (t.handoff !== null) !== f.handedOff) return false;
    return true;
  });
}

// ───────── 보드 (§10.7)
export function board(core: Core, q: { projectId?: string[]; sourceAi?: SourceAi[]; from?: string; to?: string; needsReview?: boolean; doneWithinDays?: number; columnLimit?: number }): BoardResponse {
  const all = filterTasks(core, loadTasks(core), q);
  const t0 = today();
  const doneDays = q.doneWithinDays ?? 14, lim = q.columnLimit ?? 100;
  const col = (status: BoardColumn['status'], list: TaskFull[], labelKo: string, collapsed = false): BoardColumn => ({
    status, labelKo, collapsed, total: list.length, items: list.slice(0, lim).map(toListItem), hasMore: list.length > lim, // 1.5.0 접힌 열도 items를 채움(collapsed는 화면 힌트일 뿐 — 전엔 total만 있고 items가 비어 보였음)
  });
  const inProg = sortTasks(all.filter((t) => t.status === '진행 중'), 'last_activity_desc');
  const stalled = sortTasks(all.filter((t) => t.status === '멈춤'), 'stale_desc');
  // 1.4.0 '간단한 질문' 열 = 답 받은 간단한 질문(상태 완료). 완료 열에는 과제만. 답 못 받은 간단한 질문은 상태대로 진행 중/멈춤 열
  const done = all.filter((t) => t.status === '완료' && !isQuickAnswered(t) && t.completedAt && daysBetween(kstDate(t.completedAt), t0) < doneDays).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  const quick = sortTasks(all.filter(isQuickAnswered), 'last_activity_desc');
  return {
    columns: [col('진행 중', inProg, '진행 중'), col('멈춤', stalled, '멈춤'), col('완료', done, `완료 (최근 ${doneDays}일)`), col('간단한 질문', quick, '간단한 질문', true)],
    weeklyResumeSuggestions: sortTasks(stalled.filter((t) => t.stale.staleStage === 'short_pause' && t.kind === 'task'), 'resume_score_desc').slice(0, 5).map((t) => t.id),
  };
}

// ───────── 프로젝트
interface ProjAgg { tasks: TaskFull[]; convIds: Set<string>; convs: Map<string, ConvLite>; first: string | null; last: string | null }
function aggregate(tasks: TaskFull[]): Map<string, ProjAgg> {
  const m = new Map<string, ProjAgg>();
  for (const t of tasks) {
    if (!t.projectId) continue;
    let a = m.get(t.projectId); if (!a) m.set(t.projectId, (a = { tasks: [], convIds: new Set(), convs: new Map(), first: null, last: null }));
    a.tasks.push(t);
    for (const c of t.convs) { a.convIds.add(c.id); a.convs.set(c.id, c); } // 공유 대화 포함, 중복 없이
    for (const c of t.primary) {
      if (!a.first || c.createdAt < a.first) a.first = c.createdAt;
      if (!a.last || c.updatedAt > a.last) a.last = c.updatedAt;
    }
  }
  return m;
}
function projectSummary(core: Core, r: Record<string, unknown>, agg: ProjAgg | undefined): ProjectSummary {
  const tasks = agg?.tasks ?? [];
  const thresholds = core.thresholdsFor(str(r.thresholds_json as string | null));
  const act = projectActivity(tasks.filter((t) => t.status !== '보관').map((t) => t.status), agg?.last ? kstDate(agg.last) : null, today(), thresholds);
  return {
    id: String(r.id), name: String(r.name), aliases: json<string[]>(r.aliases_json as string, []), status: String(r.status) as ProjectStatus, colorHex: String(r.color),
    activity: act, taskCount: tasks.filter((t) => t.kind === 'task' && t.status !== '보관').length, conversationCount: agg?.convIds.size ?? 0,
    startedAt: agg?.first ?? null, lastActivityAt: agg?.last ?? null, thresholds: json<Partial<StaleThresholds> | null>(r.thresholds_json as string | null, null),
  };
}
export function listProjects(core: Core, q: { status?: ProjectStatus[]; limit?: number; offset: number }): ListResponse<ProjectSummary> {
  const agg = aggregate(loadTasks(core));
  const rows = core.db.all('SELECT * FROM projects');
  const all = rows.map((r) => projectSummary(core, r, agg.get(String(r.id)))).filter((p) => !q.status || q.status.includes(p.status))
    .sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '') || a.name.localeCompare(b.name, 'ko'));
  return page(all, q.offset, q.limit ?? 50);
}
export function getProjectSummary(core: Core, id: string): ProjectSummary | null {
  const r = core.db.get('SELECT * FROM projects WHERE id=?', id);
  if (!r) return null;
  return projectSummary(core, r, aggregate(loadTasks(core).filter((t) => t.projectId === id)).get(id));
}
export function projectDetail(core: Core, id: string, weeks = 16): ProjectDetail | null {
  const db = core.db;
  const r = db.get('SELECT * FROM projects WHERE id=?', id);
  if (!r) return null;
  const tasks = loadTasks(core).filter((t) => t.projectId === id);
  const agg = aggregate(tasks).get(id);
  const summary = projectSummary(core, r, agg);
  const convs = [...(agg?.convs.values() ?? [])];
  const starts = weekStarts(weeks);
  const buckets = starts.map((start) => ({ start, count: convs.filter((c) => { const d = kstDate(c.updatedAt); return d >= start && d < addDays(start, 7); }).length }));
  const byAiMap = new Map<SourceAi, { c: number; m: number }>();
  for (const c of convs) { const e = byAiMap.get(c.sourceAi) ?? { c: 0, m: 0 }; e.c++; e.m += c.messageCount; byAiMap.set(c.sourceAi, e); }
  const byAi = [...byAiMap.entries()].map(([sourceAi, e]) => ({ sourceAi, conversationCount: e.c, messageCount: e.m })).sort((a, b) => b.conversationCount - a.conversationCount);
  const visible = tasks.filter((t) => t.kind === 'task' && t.status !== '보관');
  const ordered = [
    ...sortTasks(visible.filter((t) => t.status === '멈춤'), 'stale_desc'),
    ...sortTasks(visible.filter((t) => t.status === '진행 중'), 'last_activity_desc'),
    ...visible.filter((t) => t.status === '완료').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
  ];
  const best = sortTasks(visible.filter((t) => (t.status === '진행 중' || t.status === '멈춤') && t.nextStep), 'resume_score_desc')[0];
  let nextStep: ProjectDetail['nextStep'] = null;
  if (best) {
    const lp = latestPrimary(best);
    const lastUser = lp ? db.get<{ content_md: string; created_at: string | null }>("SELECT content_md, created_at FROM messages WHERE conversation_id=? AND role='user' ORDER BY seq DESC LIMIT 1", lp.id) : undefined;
    nextStep = {
      taskId: best.id, taskTitle: best.title, text: best.nextStep!,
      evidence: lp && lastUser ? { conversationId: lp.id, sourceAi: lp.sourceAi, at: lastUser.created_at ?? lp.updatedAt, quote: lastUser.content_md.replace(/\s+/g, ' ').slice(0, 120), label: L(`${koMonthDay(kstDate(lp.updatedAt))} ${SOURCE_AI_LABEL[lp.sourceAi]} 대화의 마지막 메시지`, `Last message of the ${SOURCE_AI_LABEL[lp.sourceAi]} chat on ${koMonthDay(kstDate(lp.updatedAt))}`) } : null,
      continue: continueTarget(lp),
    };
  }
  // 관련 프로젝트: project_links + 같은 주제를 공유하는 프로젝트
  const projects = loadProjects(core);
  const related = new Map<string, { reason: string; sharedTopicIds: string[] }>();
  for (const l of db.all('SELECT * FROM project_links WHERE project_a=? OR project_b=? ORDER BY weight DESC', id, id)) {
    const other = String(l.project_a) === id ? String(l.project_b) : String(l.project_a);
    related.set(other, { reason: String(l.reason), sharedTopicIds: json<string[]>(l.shared_topic_ids_json, []) });
  }
  const shared = db.all<{ pid: string; topic_id: string; name: string; n: number }>(
    `SELECT t2.project_id AS pid, o.id AS topic_id, o.name, COUNT(DISTINCT t2.id) AS n FROM tasks t1 JOIN task_topics a ON a.task_id=t1.id JOIN task_topics b ON b.topic_id=a.topic_id
     JOIN tasks t2 ON t2.id=b.task_id JOIN objects o ON o.id=a.topic_id WHERE t1.project_id=? AND t2.project_id IS NOT NULL AND t2.project_id<>? GROUP BY t2.project_id, o.id ORDER BY n DESC`, id, id);
  for (const s of shared) if (!related.has(s.pid)) related.set(s.pid, { reason: L(`같은 주제 #${s.name} · 겹치는 과제 ${s.n}개`, `Shared topic #${s.name} · ${s.n} overlapping task${s.n === 1 ? '' : 's'}`), sharedTopicIds: [s.topic_id] });
  return {
    ...summary, summary: str(r.summary), vault: core.vault.ref('project', id), weeklyConversations: { weeks, buckets }, byAi, nextStep,
    tasks: ordered.map(toListItem), quickQuestionCount: tasks.filter(isQuickAnswered).length,
    relatedProjects: [...related.entries()].filter(([pid]) => projects.has(pid)).map(([pid, v]) => ({ project: projectRef(projects.get(pid)!)!, ...v })),
  };
}

// ───────── 대시보드 · 수집 상태
export function collectionStatus(core: Core): CollectionSourceStatus[] {
  const rows: CollectionSourceStatus[] = core.db.all('SELECT * FROM sync_state ORDER BY source_ai').map((r) => {
    const methods = json<CaptureMethod[]>(r.methods_json, ['export']);
    const label = methods.includes('extension_live') ? (methods.includes('mcp') ? L('실시간 + 데스크톱 앱(MCP)', 'Live + desktop app (MCP)') : L('실시간 캡처', 'Live capture')) : L('내보내기 가져오기', 'Export import');
    return { sourceAi: String(r.source_ai) as SourceAi, methods, methodLabel: label, lastCapturedAt: str(r.last_import_at), health: String(r.adapter_health) as AdapterHealth, message: str(r.notes) };
  });
  // 1.10.0 로컬 세션 수집기(claude-code·codex)는 sync_state 행이 없어 대시보드에서 빠지던 버그 — 수집기 파일·대화로 채움
  const have = new Set(rows.map((r) => r.sourceAi));
  for (const ai of ['claude-code', 'codex'] as const) {
    if (have.has(ai)) continue;
    const files = Number(core.db.value('SELECT COUNT(*) FROM collector_files WHERE source_ai=?', ai) ?? 0);
    const convs = core.db.get<{ n: number; last: string | null }>("SELECT COUNT(*) n, MAX(captured_at) last FROM conversations WHERE source_ai=?", ai)!;
    if (!files && !Number(convs.n)) continue;
    const errs = Number(core.db.value("SELECT COUNT(*) FROM collector_files WHERE source_ai=? AND error IS NOT NULL", ai) ?? 0);
    rows.push({ sourceAi: ai, methods: ['local_session'], methodLabel: L('로컬 세션 수집', 'Local session capture'), lastCapturedAt: str(convs.last), health: errs ? 'degraded' : 'ok', message: errs ? L(`읽기 오류 파일 ${errs}개`, `${errs} unreadable file${errs === 1 ? '' : 's'}`) : null });
  }
  return rows.sort((a, b) => a.sourceAi.localeCompare(b.sourceAi));
}
export function dashboard(core: Core): DashboardResponse {
  const tasks = loadTasks(core);
  const t0 = today();
  const monday = weekStart(t0);
  const count = (s: TaskStatus) => tasks.filter((t) => t.status === s).length;
  const sources = collectionStatus(core);
  const overall: AdapterHealth = sources.some((s) => s.health === 'broken') ? 'broken' : sources.some((s) => s.health === 'degraded') ? 'degraded' : 'ok';
  const last = sources.map((s) => s.lastCapturedAt).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
  return {
    today: t0,
    counts: {
      inProgress: count('진행 중'), stalled: count('멈춤'), stalledOver7Days: tasks.filter((t) => t.status === '멈춤' && (t.stale.staleDays ?? 0) >= 8).length,
      completedThisWeek: tasks.filter((t) => t.status === '완료' && !isQuickAnswered(t) && t.completedAt && kstDate(t.completedAt) >= monday).length,
      quickQuestions: tasks.filter(isQuickAnswered).length, archived: count('보관'), needsReview: tasks.filter((t) => t.needsReview).length,
      totalTasks: tasks.filter((t) => !isQuickAnswered(t) && t.status !== '보관').length,
      allTasks: tasks.length, // 1.10.0 DB 행 전체(= totalTasks + quickQuestions + archived 중 겹침 제외)
    },
    collection: { lastCapturedAt: last, overallHealth: overall, sources },
    badges: {
      digestApprovals: 0,
      pendingMergeSuggestions: Number(core.db.value("SELECT COUNT(*) FROM task_merge_suggestions WHERE state='pending'") ?? 0),
      vaultConflicts: core.vault.conflictCount(),
      runningImports: Number(core.db.value("SELECT COUNT(*) FROM import_batches WHERE state IN ('uploaded','parsing','importing','classifying')") ?? 0),
      pendingProjectSuggestions: pendingReadyCount(core),
    },
    latestDigestDate: core.db.value<string>('SELECT MAX(date) FROM digests'),
  };
}

// ───────── 그래프 (§10.2.5, 과제 모드)
export interface GraphQ { status?: TaskStatus[]; sourceAi?: SourceAi[]; projectId?: string[]; from?: string; to?: string; includeQuick?: boolean; includeDone?: boolean; focus?: string; depth?: number; limit?: number }
export function graph(core: Core, q: GraphQ): GraphResponse {
  const db = core.db;
  const t0 = today();
  const projects = loadProjects(core);
  const allTasks = loadTasks(core);
  let tasks = filterTasks(core, allTasks, { status: q.status, sourceAi: q.sourceAi, projectId: q.projectId, from: q.from, to: q.to });
  if (!q.status) tasks = tasks.filter((t) => t.status !== '보관');
  if (q.includeDone === false) tasks = tasks.filter((t) => t.status !== '완료' || isQuickAnswered(t)); // 1.4.0 답 받은 간단한 질문은 includeQuick로만 거른다
  if (q.includeQuick === false) tasks = tasks.filter((t) => t.kind !== 'quick_question');
  const taskIds = new Set(tasks.map((t) => t.id));
  const recency = (iso: string | null) => (iso ? Math.max(0, Math.min(1, 1 - daysBetween(kstDate(iso), t0) / 90)) : 0);
  const recent = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
  const tooltipDate = (iso: string | null) => (iso ? koMonthDay(kstDate(iso)) : L('없음', 'none'));

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const blank = { objectId: null, kind: null, status: null, statusVisual: null, staleDays: null, staleStage: null, badge: null, taskCount: null, objectStatus: null, mentionCount: null, confidence: null } as const;
  // 프로젝트
  // 프로젝트 노드의 수치는 필터와 무관하게 프로젝트 요약(GET /projects)과 같은 값
  const agg = aggregate(tasks);
  const fullAgg = aggregate(allTasks);
  for (const pid of agg.keys()) {
    const p = projects.get(pid); const a = fullAgg.get(pid); if (!p || !a) continue;
    const ais = [...new Set([...a.convs.values()].map((c) => c.sourceAi))];
    const nTasks = a.tasks.filter((t) => t.kind === 'task' && t.status !== '보관').length;
    nodes.push({ ...blank, id: pid, type: 'project', label: p.name, projectId: pid, colorHex: p.colorHex, sourceAis: ais,
      messageCount: [...a.convs.values()].reduce((n, c) => n + c.messageCount, 0), conversationCount: a.convIds.size, taskCount: nTasks, size: 0, recency: recency(a.last),
      firstActivityAt: a.first, lastActivityAt: a.last, tooltip: L(`${p.name} · 과제 ${nTasks} · 마지막 대화 ${tooltipDate(a.last)}`, `${p.name} · ${nTasks} tasks · last chat ${tooltipDate(a.last)}`) });
  }
  // 과제
  for (const t of tasks) {
    const statusText = t.status === '멈춤' ? L(`${t.stale.staleDays}일째 멈춤`, `Stalled ${t.stale.staleDays} days`) : statusLabel(t.status);
    nodes.push({ ...blank, id: t.id, type: 'task', label: t.title, projectId: t.projectId, colorHex: t.project?.colorHex ?? null, kind: t.kind, status: t.status,
      statusVisual: t.stale.statusVisual, staleDays: t.stale.staleDays, staleStage: t.stale.staleStage, badge: t.stale.badge, sourceAis: primaryAis(t),
      messageCount: primaryMessageCount(t), conversationCount: t.convs.length, size: 0, recency: recency(t.lastActivityAt), firstActivityAt: t.startedAt, lastActivityAt: t.lastActivityAt,
      tooltip: t.kind === 'quick_question' ? L(`${t.title} · 간단한 질문 · ${tooltipDate(t.lastActivityAt)}`, `${t.title} · quick question · ${tooltipDate(t.lastActivityAt)}`) : L(`${t.title} · ${statusText} · 마지막 대화 ${tooltipDate(t.lastActivityAt)}`, `${t.title} · ${statusText} · last chat ${tooltipDate(t.lastActivityAt)}`) });
    if (t.projectId && agg.has(t.projectId)) edges.push({ id: `part_of:${t.id}`, type: 'part_of', source: t.id, target: t.projectId, directed: true, status: 'accepted', confidence: null, endedAt: null, weight: 1, reason: null });
  }
  // 주제
  const topicRows = db.all<{ task_id: string; topic_id: string; confidence: number | null }>('SELECT task_id, topic_id, confidence FROM task_topics');
  const topicTasks = new Map<string, TaskFull[]>();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const r of topicRows) {
    if (!taskIds.has(r.task_id)) continue;
    const arr = topicTasks.get(r.topic_id) ?? []; arr.push(byId.get(r.task_id)!); topicTasks.set(r.topic_id, arr);
    edges.push({ id: `topic:${r.task_id}:${r.topic_id}`, type: 'related_to', source: r.task_id, target: r.topic_id, directed: false, status: 'accepted', confidence: r.confidence, endedAt: null, weight: 1, reason: null });
  }
  for (const [tid, ts] of topicTasks) {
    const o = db.get("SELECT * FROM objects WHERE id=? AND type='topic'", tid); if (!o) continue;
    const convIds = new Set(ts.flatMap((t) => t.convs.map((c) => c.id)));
    const first = ts.map((t) => t.startedAt).filter((x): x is string => Boolean(x)).sort()[0] ?? null;
    const last = ts.map((t) => t.lastActivityAt).reduce<string | null>(recent, null);
    nodes.push({ ...blank, id: tid, type: 'topic', label: String(o.name), objectId: tid, projectId: null, colorHex: null, sourceAis: [], messageCount: 0, conversationCount: convIds.size,
      size: 0, recency: recency(last), firstActivityAt: first, lastActivityAt: last, objectStatus: String(o.status) as GraphNode['objectStatus'], mentionCount: Number(o.mention_count ?? 0),
      confidence: o.confidence === null ? null : Number(o.confidence), tooltip: L(`#${String(o.name)} · 과제 ${ts.length}개`, `#${String(o.name)} · ${ts.length} task${ts.length === 1 ? '' : 's'}`) });
  }
  // 과제↔과제, 합치기 후보, 프로젝트↔프로젝트
  for (const l of db.all('SELECT * FROM task_links')) {
    if (taskIds.has(String(l.src_task_id)) && taskIds.has(String(l.dst_task_id)))
      edges.push({ id: `${l.type}:${l.src_task_id}:${l.dst_task_id}`, type: String(l.type) as GraphEdge['type'], source: String(l.src_task_id), target: String(l.dst_task_id), directed: true, status: 'accepted', confidence: l.confidence === null ? null : Number(l.confidence), endedAt: null, weight: 1, reason: str(l.reason) });
  }
  for (const m of db.all("SELECT * FROM task_merge_suggestions WHERE state='pending'")) {
    if (taskIds.has(String(m.task_a)) && taskIds.has(String(m.task_b)))
      edges.push({ id: `same:${m.id}`, type: 'same_task_candidate', source: String(m.task_a), target: String(m.task_b), directed: false, status: 'suggested', confidence: Number(m.confidence), endedAt: null, weight: 1, reason: String(m.reason) });
  }
  const projIds = new Set(nodes.filter((n) => n.type === 'project').map((n) => n.id));
  for (const l of db.all('SELECT * FROM project_links')) {
    if (projIds.has(String(l.project_a)) && projIds.has(String(l.project_b)))
      edges.push({ id: `prj:${l.project_a}:${l.project_b}`, type: 'related_to', source: String(l.project_a), target: String(l.project_b), directed: false, status: 'accepted', confidence: null, endedAt: null, weight: Number(l.weight), reason: String(l.reason) });
  }
  // focus: 이웃만
  let outNodes = nodes, outEdges = edges;
  if (q.focus) {
    const keep = new Set<string>([q.focus]);
    for (let d = 0; d < (q.depth ?? 1); d++) { // 단계별 BFS (한 단계에서 새로 들어온 노드는 다음 단계에서만 퍼짐)
      const frontier = new Set(keep);
      for (const e of edges) { if (frontier.has(e.source) || frontier.has(e.target)) { keep.add(e.source); keep.add(e.target); } }
    }
    outNodes = nodes.filter((n) => keep.has(n.id));
    outEdges = edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  }
  // 상한: 간단한 질문 → 오래된 과제 순으로 숨김
  const limit = q.limit ?? 1500;
  let hiddenQuick = 0, truncated = false;
  if (outNodes.length > limit) {
    const quick = outNodes.filter((n) => n.kind === 'quick_question');
    const drop = new Set(quick.slice(0, Math.min(quick.length, outNodes.length - limit)).map((n) => n.id));
    hiddenQuick = drop.size;
    outNodes = outNodes.filter((n) => !drop.has(n.id));
    if (outNodes.length > limit) {
      truncated = true;
      const keepIds = new Set([...outNodes].sort((a, b) => b.recency - a.recency).slice(0, limit).map((n) => n.id));
      outNodes = outNodes.filter((n) => keepIds.has(n.id));
    }
    const ids = new Set(outNodes.map((n) => n.id));
    outEdges = outEdges.filter((e) => ids.has(e.source) && ids.has(e.target));
  }
  // 크기: 같은 종류 안에서 sqrt(메시지 수) 정규화 (주제는 대화 수)
  for (const type of ['project', 'task', 'topic'] as const) {
    const ns = outNodes.filter((n) => n.type === type);
    const v = (n: GraphNode) => Math.sqrt(type === 'topic' ? n.conversationCount : n.messageCount);
    const max = Math.max(0, ...ns.map(v));
    for (const n of ns) n.size = max > 0 ? Math.round((v(n) / max) * 100) / 100 : 0;
  }
  for (const n of outNodes) n.recency = Math.round(n.recency * 100) / 100;
  return {
    mode: 'task', at: t0, generatedAt: nowIso(), nodes: outNodes, edges: outEdges,
    stats: {
      projectCount: outNodes.filter((n) => n.type === 'project').length, taskCount: outNodes.filter((n) => n.type === 'task' && n.kind === 'task').length,
      quickQuestionCount: outNodes.filter((n) => n.kind === 'quick_question').length, topicCount: outNodes.filter((n) => n.type === 'topic').length, hiddenQuickCount: hiddenQuick, truncated,
    },
  };
}

// ───────── 활동 막대
export function activity(core: Core, q: { granularity?: 'week' | 'day'; weeks?: number; from?: string; to?: string; projectId?: string }): ActivityResponse {
  const gran = q.granularity ?? 'week';
  const to = q.to ?? today();
  const from = q.from ?? (gran === 'week' ? addDays(weekStart(to), -7 * ((q.weeks ?? 26) - 1)) : addDays(to, -((q.weeks ?? 26) * 7) + 1));
  const start0 = gran === 'week' ? weekStart(from) : from;
  const starts: string[] = [];
  for (let d = start0; d <= to; d = addDays(d, gran === 'week' ? 7 : 1)) starts.push(d);
  const db = core.db;
  const projFilter = q.projectId ? 'AND c.task_id IN (SELECT id FROM tasks WHERE project_id=?)' : '';
  const params = q.projectId ? [q.projectId] : [];
  const msgRows = db.all<{ d: string; convs: number; msgs: number }>(
    `SELECT substr(m.created_at,1,10) AS d, COUNT(DISTINCT m.conversation_id) AS convs, COUNT(*) AS msgs FROM messages m JOIN conversations c ON c.id=m.conversation_id
     WHERE m.created_at >= ? AND m.created_at < ? ${projFilter} GROUP BY d`, startOfDayIso(start0), startOfDayIso(addDays(to, 1)), ...params);
  const convDay = db.all<{ d: string; cid: string }>(
    `SELECT DISTINCT substr(m.created_at,1,10) AS d, m.conversation_id AS cid FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.created_at >= ? AND m.created_at < ? ${projFilter}`,
    startOfDayIso(start0), startOfDayIso(addDays(to, 1)), ...params);
  const taskStarts = db.all<{ started_at: string }>(`SELECT started_at FROM tasks WHERE kind='task' AND started_at IS NOT NULL ${q.projectId ? 'AND project_id=?' : ''}`, ...params).map((r) => kstDate(r.started_at)).sort();
  const buckets = starts.map((start) => {
    const end = gran === 'week' ? addDays(start, 7) : addDays(start, 1);
    const inRange = (d: string) => d >= start && d < end;
    return {
      start,
      conversationCount: new Set(convDay.filter((r) => inRange(r.d)).map((r) => r.cid)).size,
      messageCount: msgRows.filter((r) => inRange(r.d)).reduce((n, r) => n + Number(r.msgs), 0),
      taskCount: taskStarts.filter((d) => d < end).length, // 그 구간 끝까지 존재한 과제 수(누적)
    };
  });
  return { granularity: gran, from: start0, to, projectId: q.projectId ?? null, buckets };
}

