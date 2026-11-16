// 모의 모드 라우터: 계약서의 경로·쿼리·본문을 그대로 받아 공유 목 JSON(엔진 캡처)으로 답한다.
// 쓰기(PATCH/POST)는 메모리에만 반영되고 새로고침하면 처음으로 돌아간다.
import type {
  ApproveDeletionBody, DeletionBatch, DigestResponse, FlowResponse, GraphNode, GraphResponse, ProjectDetail, ResumePromptResponse,
  SearchHit, SearchMode, SearchResponse, SetDeletionItemBody, SourceAi, StaleStage, StatusVisual, TaskDetail, TaskListItem, TaskRef,
  TaskStatus, TopicDetail, UpdateTaskBody, ErrorCode, ProjectSuggestion, AcceptProjectSuggestionBody, AcceptProjectSuggestionResponse,
  ClassificationStatus, ListResponse, ProjectSummary,
} from '@subbrain/shared';
import { ApiRequestError, type Query } from '../client';
import { aug110, augRow, demoDeletionBatchFull, EXTRA_PROJECT_SUGGESTIONS, previewBatch } from './demoData';
import { clone, D, M } from './shared';
import collectorStatusJson from '@subbrain/shared/mocks/collectorStatus';
import type { CollectorStatus, Job, PutCollectorConfigBody } from '@subbrain/shared';

import ontologyGraphJson from '@subbrain/shared/mocks/ontologyGraph';
import { bigOntology } from './bigOntology';
import type { OntologyGraphResponse, OntologyLink, OntologySuggestion, WhyStalledResponse } from '@subbrain/shared';

// 1.7.0 온톨로지(모의): 공유 목(ontologyGraph = 웹 시안 예시를 계약 모양으로) 위에 결정만 메모리에
const ONT = ontologyGraphJson as unknown as OntologyGraphResponse;
const ontDecided = new Map<string, { state: 'accepted' | 'rejected'; eventId: number }>();
let ontEvent = 9000;
function ontologyNow(): OntologyGraphResponse {
  const d = clone(typeof location !== 'undefined' && /[?&]fixture=big\b/.test(location.search) ? bigOntology() : ONT);
  const merged = new Map<string, string>();
  for (const sg of d.suggestions) {
    const x = ontDecided.get(sg.id); if (!x) continue;
    if (sg.linkId) { const l = d.links.find((k) => k.id === sg.linkId); if (l) l.status = x.state as OntologyLink['status']; }
    if (sg.objectId) { const o = d.objects.find((k) => k.id === sg.objectId); if (o) o.status = x.state; }
    if (sg.merge && x.state === 'accepted') merged.set(sg.merge.mergeId, sg.merge.keepId);
  }
  for (const o of d.objects) if (merged.has(o.id)) { o.status = 'merged'; o.mergedInto = merged.get(o.id)!; }
  for (const l of d.links) { l.srcId = merged.get(l.srcId) ?? l.srcId; l.dstId = merged.get(l.dstId) ?? l.dstId; }
  d.links = d.links.filter((l) => (l.status as string) !== 'rejected');
  d.objects = d.objects.filter((o) => o.status !== 'rejected' && o.status !== 'merged');
  d.suggestions = d.suggestions.filter((x) => !ontDecided.has(x.id));
  d.counts = { ...d.counts, objects: d.objects.length, links: d.links.length, pendingSuggestions: d.suggestions.length };
  return d;
}
function whyStalledMock0(taskId: string): TaskDetail['whyStalled'] {
  const g = ontologyNow(); const obj = g.objects.find((o) => o.ref?.id === taskId); if (!obj) return null;
  const byId = new Map(g.objects.map((o) => [o.id, o])); const chain: NonNullable<TaskDetail['whyStalled']>['chain'] = []; let cur = obj.id;
  for (let depth = 1; depth <= 5; depth++) { const l = g.links.find((k) => k.srcId === cur && k.type === 'blocked_by' && k.status === 'accepted' && !k.endedAt); const o = l && byId.get(l.dstId); if (!l || !o) break; chain.push({ depth, nodeId: o.id, type: o.type, label: o.name, linkType: 'blocked_by', confidence: l.confidence ?? 1 }); cur = o.id; }
  return chain.length ? { chain, rootCause: chain.at(-1)!.label, lastRelatedConversationId: null } : null;
}
function whyStalledMock(taskId: string): WhyStalledResponse {
  const g = ontologyNow(); const t = taskDetail(taskId);
  const obj = g.objects.find((o) => o.ref?.id === taskId) ?? null;
  const byId = new Map(g.objects.map((o) => [o.id, o]));
  const chain: WhyStalledResponse['chain'] = []; const seen = new Set<string>();
  const walk = (id: string, depth: number) => {
    if (depth > 5) return;
    for (const l of g.links) if (l.srcId === id && l.type === 'blocked_by' && l.status === 'accepted' && !l.endedAt && !seen.has(l.dstId)) {
      const o = byId.get(l.dstId); if (!o) continue; seen.add(l.dstId);
      chain.push({ depth, link: l, object: { id: o.id, type: o.type, label: o.name, status: o.status, taskStatus: null } }); walk(o.id, depth + 1);
    }
  };
  if (obj) walk(obj.id, 1);
  const mine = obj ? g.links.filter((l) => l.srcId === obj.id && l.type === 'blocked_by') : [];
  const leaf = chain.filter((c) => !chain.some((d) => d.depth === c.depth + 1));
  const kind = (ty: string) => (ty === 'person' ? 'waiting_person' : ty === 'decision' ? 'undecided' : ty === 'task' ? 'blocked_task' : 'other') as WhyStalledResponse['rootCauses'][number]['kind'];
  const rootCauses = leaf.map((c) => ({ object: { id: c.object.id, type: c.object.type, label: c.object.label }, kind: kind(c.object.type), label: c.object.label }));
  return {
    taskId, objectId: obj?.id ?? null, task: { status: t.status, staleDays: t.stale.staleDays }, chain, rootCauses,
    ended: mine.filter((l) => l.endedAt), suggested: mine.filter((l) => l.status === 'suggested'), lastConversation: null,
    explanation: rootCauses.length ? `‘${rootCauses[0]!.label}’ 때문에 ${t.stale.staleDays ?? 0}일째 멈춤` : '막힘 관계가 없어요',
  };
}

// 1.9.0 페어링·수집 상태(모의)
const mockClients: Array<{ tokenId: string; kind: 'extension' | 'mcp' | 'collector'; name: string; extensionId: string | null; scopes: Array<'ingest' | 'read' | 'mcp_write'>; createdAt: string; lastUsedAt: string | null; rotatedAt: string | null; revokedAt: string | null }> = [
  { tokenId: 'pat_k3f9', kind: 'extension', name: '내 크롬', extensionId: 'pggahpedofmfcngpdljmhngeinnigecm', scopes: ['ingest'], createdAt: '2026-09-28T21:10:00+09:00', lastUsedAt: '2026-09-30T08:20:41+09:00', rotatedAt: null, revokedAt: null },
  { tokenId: 'pat_m7q2', kind: 'mcp', name: 'Claude MCP', extensionId: null, scopes: ['read', 'mcp_write'], createdAt: '2026-09-29T22:00:00+09:00', lastUsedAt: '2026-09-30T08:42:00+09:00', rotatedAt: null, revokedAt: null },
];
let pairSeq = 0;
const mockSync = [
  { sourceAi: 'chatgpt', cursor: 'cur_chatgpt_1', lastScanAt: '2026-09-30T08:21:00+09:00', lastSnapshotAt: '2026-09-30T08:20:41+09:00', knownConversations: 412, pendingFetch: 0, health: 'ok', healthAt: '2026-09-30T08:19:00+09:00', adapter: { name: 'chatgpt-dom', version: '0.1.0' }, errorCode: null, bufferedSnapshots: 0 },
  { sourceAi: 'claude', cursor: null, lastScanAt: '2026-09-29T23:00:00+09:00', lastSnapshotAt: '2026-09-29T22:58:00+09:00', knownConversations: 29, pendingFetch: 2, health: 'broken', healthAt: '2026-09-30T08:22:00+09:00', adapter: { name: 'claude-dom', version: '0.1.0' }, errorCode: 'SELECTOR_NOT_FOUND', bufferedSnapshots: 3 },
  { sourceAi: 'gemini', cursor: null, lastScanAt: null, lastSnapshotAt: null, knownConversations: 0, pendingFetch: 0, health: null, healthAt: null, adapter: null, errorCode: null, bufferedSnapshots: 0 },
];

// 1.8.0 MCP 쓰기 기록(모의)
const mcpEvents: Array<{ id: number; at: string; type: 'task_logged' | 'status_changed'; taskId: string; taskTitle: string; summary: string; undone: boolean; undoneAt: string | null }> = [
  { id: 7103, at: '2026-09-30T08:42:00+09:00', type: 'status_changed', taskId: 'task_20260830_01', taskTitle: '메인 페이지 카피 확정', summary: '상태 멈춤 → 진행 중 · 다음 단계 "윤서 님 답 받으면 A안으로"', undone: false, undoneAt: null },
  { id: 7102, at: '2026-09-29T22:15:00+09:00', type: 'task_logged', taskId: 'task_20260929_05', taskTitle: 'MCP 서버 도구 이름 정리', summary: 'Claude Code에서 한 작업을 새 과제로 기록 · 서브브레인 프로젝트', undone: false, undoneAt: null },
  { id: 7098, at: '2026-09-28T19:03:00+09:00', type: 'status_changed', taskId: 'task_20260915_01', taskTitle: '블로그 RSS 피드', summary: '상태 진행 중 → 완료', undone: true, undoneAt: '2026-09-28T19:10:00+09:00' },
];

// 1.5.0 로컬 수집(모의): 메모리 상태
const collector: CollectorStatus = clone(collectorStatusJson as unknown as CollectorStatus);
let scanSeq = 0;

// ── 메모리 상태 ──
const taskStatus = new Map<string, TaskStatus>();
const oqResolved = new Map<string, boolean>();
const mergeState = new Map<string, 'accepted' | 'rejected'>();
const suggestionState = new Map<string, { state: 'accepted' | 'rejected'; projectId: string | null }>(); // 1.1.0 새 프로젝트 제안
let batch: DeletionBatch | null = null;
type MockArchiveItem = { itemId: number; conversationId: string; sourceAi: SourceAi; title: string; date: string; reason: string; state: 'archive_queued' | 'archive_undone' };
let archiveItems: MockArchiveItem[] | null = null;
const mockArchive = () => (archiveItems ??= ['여행 짐 목록 정리', '엑셀 VLOOKUP 오류', '영어 이메일 다듬기', '노트북 배터리 수명'].map((title, i) => ({
  itemId: 900 + i, conversationId: `conv_chatgpt_demo${i}`, sourceAi: 'chatgpt' as SourceAi, title, date: `2026-09-${String(12 + i * 2).padStart(2, '0')}`,
  reason: `완료 · 9월 ${12 + i * 2}일 이후 새 메시지 없음 · 원문 저장됨 · 보관만(되돌릴 수 있음)`, state: 'archive_queued' as const,
})));
const mockCleanupDetail = () => {
  const b = clone(fullBatch());
  const reasons: Record<string, string> = {};
  for (const g of b.groups) for (const it of g.items) reasons[String(it.itemId)] = `${it.kindLabel} · ${+it.date.slice(5, 7)}월 ${+it.date.slice(8, 10)}일 이후 새 메시지 없음 · 원문 저장됨 · 되돌릴 수 없는 삭제 → 승인 필요`;
  return { batch: b, reasons, archive: clone(mockArchive()), mode: 'mark_only', executor: 'off', approvedAt: null, dbBackupRef: null, exportDir: '(모의)' };
};
let eventSeq = 0;
const fullBatch = () => (batch ??= demoDeletionBatchFull());

const NOW = '2026-09-30T08:30:00+09:00';
const TODAY = M.dashboard.today;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const err = (status: number, code: ErrorCode, message: string, details?: Record<string, unknown>) => new ApiRequestError(status, code, message, details, `req_mock${Math.floor(Math.random() * 1e4)}`);
const notFound = (what: string, id: string) => err(404, 'NOT_FOUND', `${what}을(를) 찾을 수 없어요: ${id}`, { id });
const invalid = (msg: string, details?: Record<string, unknown>) => err(400, 'VALIDATION_ERROR', msg, details);
const notImpl = (phase: string, what = '아직 만들지 않은 기능이에요') => err(501, 'NOT_IMPLEMENTED', `${what} (Phase ${phase}).`, { phase });
const list = (v: Query[string]): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(',') : []);
const bool = (v: Query[string], d: boolean) => (v === undefined || v === null ? d : v === true || v === 'true');
const STATUSES: TaskStatus[] = ['진행 중', '멈춤', '완료', '간단한 질문', '보관'];
const NEW_CHAT: Record<SourceAi, string> = { chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/new', gemini: 'https://gemini.google.com/app', grok: 'https://grok.com/', 'claude-code': 'https://claude.ai/code', codex: 'https://chatgpt.com/codex', grokbot: '' };
const AI_NAME: Record<SourceAi, string> = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', grok: 'Grok', 'claude-code': 'Claude Code', codex: 'Codex', grokbot: 'Grok Bot' };

// ── 상태 바꾸기 → 멈춘 날·단계·표시 다시 계산 (§7.4, meta.thresholds) ──
const days = (from: string | null) => (from ? Math.max(0, Math.floor((Date.parse(NOW) - Date.parse(from)) / 86400000)) : 0);
function staleOf(status: TaskStatus, last: string | null) {
  const th = M.meta.thresholds;
  if (status !== '멈춤') {
    const v: StatusVisual = status === '진행 중' ? 'run' : status === '완료' ? 'done' : status === '간단한 질문' ? 'quick' : 'archived';
    return { staleDays: null, staleStage: null, statusVisual: v, badge: null };
  }
  const d = days(last);
  const stage: StaleStage = d <= th.shortPauseMaxDays ? 'short_pause' : d <= th.staleMaxDays ? 'stale' : d <= th.longStaleMaxDays ? 'long_stale' : 'dormant';
  return { staleDays: d, staleStage: stage, statusVisual: (stage === 'short_pause' ? 'stall2' : 'stall') as StatusVisual, badge: `${d}일` };
}

const nextStepOverride = new Map<string, string>();
function taskDetail(id: string): TaskDetail {
  const src = D.tasks[id];
  if (!src) throw notFound('과제', id);
  const d = clone(src);
  const ns = nextStepOverride.get(id);
  if (ns !== undefined) { d.nextStep = ns; d.nextStepInfo = { text: ns, source: 'user', basis: null }; if (!d.overrides.includes('next_step')) d.overrides = [...d.overrides, 'next_step']; }
  const o = taskStatus.get(id);
  if (o && o !== src.status) {
    d.status = o; d.statusSource = 'user';
    if (!d.overrides.includes('status')) d.overrides = [...d.overrides, 'status'];
    d.stale = staleOf(o, d.lastActivityAt);
    d.completedAt = o === '완료' ? d.completedAt ?? NOW : null;
    d.completionReason = o === '완료' ? d.completionReason ?? 'resolved' : null;
  }
  if (d.kind === 'task' && d.status === '멈춤' && !d.whyStalled) { const w = whyStalledMock0(id); if (w) d.whyStalled = w; } // 1.7.0
  d.openQuestions = d.openQuestions.map((q) => (oqResolved.has(q.id) ? { ...q, resolved: oqResolved.get(q.id)!, resolvedAt: oqResolved.get(q.id) ? NOW : null } : q));
  // 1.1.0 미리보기(웹 모의 보강): handoff·분류 불가·보정 전 확신도
  const a = aug110(id);
  if (a?.handoff) { d.handoff = a.handoff; if (d.classification) d.classification.handoff = a.handoff; }
  if (a?.blocked) {
    d.classificationState = 'blocked';
    if (d.classification) Object.assign(d.classification, { state: 'blocked', blockedReason: a.blocked.reason, blockedModel: a.blocked.model, model: 'rule-mock', confidence: 0.4, rawConfidence: null, needsReview: true, evidence: '규칙 분류: 마지막 사용자 메시지 ‘나중에 다시 볼게’' });
  }
  if (a?.rawConfidence !== undefined && d.classification) d.classification.rawConfidence = a.rawConfidence;
  return d;
}
const taskRef = (t: TaskDetail): TaskRef => ({ id: t.id, title: t.title, status: t.status, statusVisual: t.stale.statusVisual, staleDays: t.stale.staleDays, projectId: t.project?.id ?? null });
function listItemFrom(t: TaskDetail): TaskListItem {
  return {
    id: t.id, title: t.title, summary: t.summary, kind: t.kind, status: t.status, statusVisual: t.stale.statusVisual, staleDays: t.stale.staleDays,
    staleStage: t.stale.staleStage, badge: t.stale.badge, project: t.project, sourceAis: t.byAi.map((b) => b.sourceAi), conversationCount: t.conversationCount,
    messageCount: t.messageCount, startedAt: t.startedAt, lastActivityAt: t.lastActivityAt, completedAt: t.completedAt, nextStep: t.nextStep, nextStepInfo: t.nextStepInfo ?? null,
    needsReview: t.classification?.needsReview ?? false, pin: t.pin, primaryConversation: t.resume.continue ? { id: t.resume.continue.conversationId, sourceAi: t.resume.continue.sourceAi, url: t.resume.continue.url } : null,
    handoff: t.handoff, classificationState: t.classificationState,
    completionReason: t.completionReason, conversationOutcome: t.resume.continue ? D.conversations[t.resume.continue.conversationId]?.outcome ?? null : null,
  };
}
/** 목록 행·그래프 노드에 상태 덮어쓰기 반영 */
function patchRow<T extends { id: string; status: TaskStatus | null; statusVisual: StatusVisual | null; staleDays: number | null; staleStage: StaleStage | null; badge: string | null }>(row: T): T {
  if (!taskStatus.has(row.id)) return row;
  const t = taskDetail(row.id);
  return { ...row, status: t.status, statusVisual: t.stale.statusVisual, staleDays: t.stale.staleDays, staleStage: t.stale.staleStage, badge: t.stale.badge };
}

function graphNow(): GraphResponse {
  const g = clone(M.graph);
  g.nodes = g.nodes.map((n) => (n.type === 'task' ? patchRow(n) : n));
  // 보관 해제된 과제(원래 그래프에 없던 것)는 상세에서 노드를 만든다
  for (const [id, st] of taskStatus) {
    if (st === '보관' || g.nodes.some((n) => n.id === id)) continue;
    const t = taskDetail(id); const p = t.project;
    const node: GraphNode = {
      id, type: 'task', label: t.title, objectId: null, projectId: p?.id ?? null, colorHex: p?.colorHex ?? null, kind: t.kind, status: t.status,
      statusVisual: t.stale.statusVisual, staleDays: t.stale.staleDays, staleStage: t.stale.staleStage, badge: t.stale.badge, sourceAis: t.byAi.map((b) => b.sourceAi),
      messageCount: t.messageCount, conversationCount: t.conversationCount, taskCount: null, size: Math.min(1, Math.sqrt(t.messageCount / 160)), recency: 0.2,
      firstActivityAt: t.startedAt, lastActivityAt: t.lastActivityAt, objectStatus: null, mentionCount: null, confidence: null, tooltip: `${t.title} · ${t.status}`,
    };
    g.nodes.push(node);
    if (p) g.edges.push({ id: `e_part_${id}`, type: 'part_of', source: id, target: p.id, directed: true, status: 'accepted', confidence: null, endedAt: null, reason: null, weight: 1 } as GraphResponse['edges'][number]);
  }
  g.nodes = g.nodes.filter((n) => n.status !== '보관');
  const ids = new Set(g.nodes.map((n) => n.id));
  g.edges = g.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  return g;
}

function filterGraph(g: GraphResponse, q: Query): GraphResponse {
  const statuses = list(q.status); const ais = list(q.sourceAi); const projects = list(q.projectId);
  const incQuick = bool(q.includeQuick, true); const incDone = bool(q.includeDone, true);
  const focus = typeof q.focus === 'string' ? q.focus : null; const depth = q.depth === '2' || q.depth === 2 ? 2 : 1;
  if (focus && !g.nodes.some((n) => n.id === focus)) throw notFound('노드', focus);
  let nodes = g.nodes.filter((n) => {
    if (n.type !== 'task') return !projects.length || n.type !== 'project' || projects.includes(n.id);
    if (!incQuick && n.kind === 'quick_question') return false;
    if (!incDone && n.statusVisual === 'done') return false;
    if (statuses.length && !statuses.includes(n.status ?? '')) return false;
    if (ais.length && !n.sourceAis.some((a) => ais.includes(a))) return false;
    if (projects.length && !projects.includes(n.projectId ?? '')) return false;
    return true;
  });
  if (focus) {
    const keep = new Set([focus]);
    for (let d = 0; d < depth; d++) for (const e of [...g.edges]) {
      if (keep.has(e.source)) keep.add(e.target); else if (keep.has(e.target)) keep.add(e.source);
    }
    nodes = nodes.filter((n) => keep.has(n.id));
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges = g.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  const tasks = nodes.filter((n) => n.type === 'task');
  return {
    ...g, nodes, edges,
    stats: { ...g.stats, projectCount: nodes.filter((n) => n.type === 'project').length, taskCount: tasks.filter((n) => n.kind !== 'quick_question').length, quickQuestionCount: tasks.filter((n) => n.kind === 'quick_question').length, topicCount: nodes.filter((n) => n.type === 'topic').length, hiddenQuickCount: incQuick ? 0 : g.nodes.filter((n) => n.kind === 'quick_question').length },
  };
}

function projectDetail(id: string): ProjectDetail {
  const src = D.projects[id];
  if (!src) throw notFound('프로젝트', id);
  const d = clone(src);
  d.tasks = d.tasks.map(patchRow);
  for (const [tid, st] of taskStatus) {
    const t = D.tasks[tid];
    if (st !== '보관' && t?.project?.id === id && t.kind === 'task' && !d.tasks.some((x) => x.id === tid)) d.tasks.push(listItemFrom(taskDetail(tid)));
  }
  d.tasks = d.tasks.filter((t) => t.status !== '보관').map(augRow);
  return d;
}

function topicDetail(id: string): TopicDetail {
  const src = D.topics[id];
  if (!src) throw notFound('주제', id);
  const d = clone(src);
  d.tasks = d.tasks.map(patchRow).filter((t) => t.status !== '보관').map(augRow);
  return d;
}

function flow(id: string, q: Query): FlowResponse {
  const src = D.flows[id];
  if (!src) throw notFound('과제', id);
  const f = clone(src);
  const filter = q.filter === 'excerpts' || q.filter === 'decisions' ? q.filter : 'all';
  if (filter === 'excerpts') f.items = f.items.filter((i) => i.excerpts.length > 0);
  if (filter === 'decisions') f.items = f.items.filter((i) => i.decisionIds.length > 0);
  f.page = { ...f.page, total: f.items.length };
  return f;
}

function resumePrompt(id: string, target: SourceAi | undefined): ResumePromptResponse {
  const src = D.resume[id];
  if (!src) throw notFound('과제', id);
  const r = clone(src);
  if (!target || target === r.targetAi) return r;
  // 다른 AI로: 같은 맥락 + 원래 대화 이어 붙이기는 원래 서비스일 때만
  const from = r.targetAi;
  return { ...r, targetAi: target, prompt: `${r.prompt}\n(${AI_NAME[from]}에서 하던 작업을 ${AI_NAME[target]}에서 이어서 함)`, continue: r.continue?.sourceAi === target ? r.continue : null, newChatUrl: NEW_CHAT[target], cached: false, generatedAt: NOW };
}

function digest(date: string): DigestResponse {
  const today = M.digest.date;
  const withState = (d: DigestResponse): DigestResponse => {
    // 모의 모드는 LATER(6) 승인 칸을 미리 보여 준다 (MVP 코어는 cleanup:null)
    d.cleanup = { autoArchived: clone(M.digestCleanupLater.autoArchived), deletionBatch: previewBatch(fullBatch()) };
    d.pendingMergeSuggestions = d.pendingMergeSuggestions.filter((m) => !mergeState.has(m.id));
    { const g = ontologyNow(); d.ontology = { newlyLinkedCount: [...ontDecided.values()].filter((x) => x.state === 'accepted').length + 6, pendingCount: g.suggestions.length, items: g.suggestions.slice(0, 3) }; } // 1.7.0 온톨로지 카드
    d.pendingProjectSuggestions = suggestionsNow().filter((x) => x.state === 'pending' && x.ready); // 1.1.0
    d.todayPicks = d.todayPicks.map((p) => {
      if (!taskStatus.has(p.task.id)) return p;
      const t = taskDetail(p.task.id);
      return { ...p, task: taskRef(t) };
    });
    return d;
  };
  if (date === 'today' || date === 'latest' || date === today) return withState(clone(M.digest));
  const li = M.digestList.items.find((i) => i.date === date);
  if (!li) throw err(404, 'NOT_FOUND', `그날 요약이 없어요: ${date}`, { date });
  const prev = new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const idx = M.digestList.items.findIndex((i) => i.date === date);
  return {
    ...clone(M.digest), date, generatedAt: li.generatedAt, title: li.title,
    prevDate: M.digestList.items[idx + 1]?.date ?? null, nextDate: next <= today ? next : null,
    vault: { path: `daily/${date}.md`, obsidianUri: null }, strip: li.strip,
    yesterday: { date: prev, narrative: '예시 데이터에는 이 날의 자세한 요약이 없어요. 요약 줄의 숫자만 목록(GET /digests)에서 가져왔어요.', events: [] },
    collectionStatus: [], thisWeek: { rangeLabel: '예시 없음', items: [] }, todayPicks: [], longNeglected: { count: 0, items: [], prompt: '' }, movedProjects: [],
    quickQuestionsByAi: [], pendingMergeSuggestions: [], alerts: [], ontology: null, cleanup: null,
  };
}

// ── 검색: 엔진과 같은 규칙(3자 이상 trigram, 2자 LIKE, 1자 제목만)으로 상세 세트를 훑는다. 커서 = base64 {"o":offset} ──
function search(q: Query): SearchResponse {
  const query = typeof q.q === 'string' ? q.q.trim() : '';
  if (!query) throw invalid('검색어를 입력해 주세요', { field: 'q' });
  if (query.length > 200) throw invalid('검색어는 200자 이내로 입력해 주세요', { field: 'q' });
  const limit = Math.min(100, Math.max(1, Number(q.limit ?? 20) || 20));
  let offset = 0;
  if (typeof q.cursor === 'string' && q.cursor) {
    try { offset = Number(JSON.parse(atob(q.cursor)).o) || 0; } catch { throw invalid('커서가 올바르지 않아요', { field: 'cursor' }); }
  }
  const terms = query.split(/\s+/).filter(Boolean);
  const mode = (t: string): SearchMode => ([...t].length >= 3 ? 'trigram' : [...t].length === 2 ? 'like' : 'title_like');
  const termInfo = terms.map((t) => ({ term: t, mode: mode(t) }));
  const notice = termInfo.some((t) => t.mode === 'like') ? '2글자 검색어는 전체 검색(LIKE)으로 찾았어요. 조금 느릴 수 있어요.' : termInfo.some((t) => t.mode === 'title_like') ? '1글자 검색어는 제목에서만 찾았어요.' : null;
  const titleOnly = termInfo.some((t) => t.mode === 'title_like');
  const has = (s: string | null | undefined) => !!s && terms.every((t) => s.toLowerCase().includes(t.toLowerCase()));
  const bold = (s: string) => terms.reduce((acc, t) => acc.split(t).join(`**${t}**`), s.replace(/\*\*/g, ''));
  const types = list(q.types); const want = (t: SearchHit['type']) => !types.length || types.includes(t);
  const items: SearchHit[] = [];
  for (const id of Object.keys(D.tasks)) {
    const t = taskDetail(id); const ref = taskRef(t);
    if (want('task') && (has(t.title) || (!titleOnly && (has(t.summary) || has(t.nextStep))))) {
      items.push({ type: 'task', id, title: t.title, snippetMd: bold(has(t.summary) ? t.summary ?? '' : has(t.nextStep) ? t.nextStep ?? '' : t.summary ?? t.title), task: ref,
        conversationId: t.resume.continue?.conversationId ?? null, sourceAi: t.resume.continue?.sourceAi ?? t.byAi[0]?.sourceAi ?? null, sourceUrl: t.resume.continue?.url ?? null, vaultPath: t.vault.path, at: t.lastActivityAt, score: has(t.title) ? 1 : 0.8 });
    }
    if (titleOnly) continue;
    if (want('decision')) for (const dd of t.decisions) if (has(dd.text)) items.push({ type: 'decision', id: dd.id, title: dd.text, snippetMd: bold(dd.text), task: ref, conversationId: dd.sourceConversationId, sourceAi: dd.sourceAi, sourceUrl: null, vaultPath: t.vault.path, at: dd.decidedAt, score: 0.7 });
    const f = D.flows[id];
    if (f) for (const e of f.items) {
      if (want('conversation') && (has(e.title) || has(e.summary))) items.push({ type: 'conversation', id: e.conversationId, title: e.title, snippetMd: bold(has(e.summary) ? e.summary ?? '' : e.title), task: ref, conversationId: e.conversationId, sourceAi: e.sourceAi, sourceUrl: e.sourceUrl, vaultPath: null, at: e.updatedAt, score: 0.6 });
      if (want('message')) for (const x of e.excerpts) if (has(x.textMd.replace(/\*/g, ''))) items.push({ type: 'message', id: `${e.conversationId}#${x.messageSeq ?? 0}`, title: e.title, snippetMd: bold(x.textMd.replace(/\*/g, '')), task: ref, conversationId: e.conversationId, sourceAi: e.sourceAi, sourceUrl: e.sourceUrl, vaultPath: null, at: e.updatedAt, score: 0.5 });
    }
  }
  const seen = new Set<string>();
  const uniq = items.filter((h) => { const k = `${h.type}:${h.id}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.score - a.score || (b.at ?? '').localeCompare(a.at ?? ''));
  const page = uniq.slice(offset, offset + limit);
  const more = offset + limit < uniq.length;
  return { query, terms: termInfo, notice, tookMs: 6, items: page, page: { limit, nextCursor: more ? btoa(JSON.stringify({ o: offset + limit })).replace(/=+$/, '') : null, hasMore: more, total: uniq.length } };
}

// ── 1.1.0: 과제 목록(§8.1) — 상세 세트를 목록 행으로. 필터: status·kind·projectId·needsReview·classificationState·handedOff ──
/** 주간 돌아보기(모의): 엔진 캡처 2주 + 그 밖의 주는 빈 주 */
function weekly(date?: string) {
  const cur = M.weeklyReview; const prev = M.weeklyReviewPrev;
  const fix = (w: typeof cur) => { const x = clone(w); for (const k of ['finished', 'started', 'stalled', 'neglected'] as const) x[k] = x[k].map((i) => (D.tasks[i.task.id] ? { ...i, task: { ...i.task, ...pick(listItemFrom(taskDetail(i.task.id))) } } : i)); return x; };
  if (!date || date > cur.weekEnd) return fix(cur);
  if (date >= cur.weekStart) return fix(cur);
  if (date >= prev.weekStart) return fix(prev);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw invalid('date는 YYYY-MM-DD', { field: 'date' });
  const d = new Date(`${date}T00:00:00Z`); const dow = (d.getUTCDay() + 6) % 7; const ws = new Date(d.getTime() - dow * 864e5);
  const iso = (t: Date) => t.toISOString().slice(0, 10);
  return { ...clone(prev), weekStart: iso(ws), weekEnd: iso(new Date(ws.getTime() + 6 * 864e5)), prevWeek: iso(new Date(ws.getTime() - 7 * 864e5)), nextWeek: iso(new Date(ws.getTime() + 7 * 864e5)), isCurrent: false,
    finished: [], started: [], stalled: [], neglected: [], byAi: [], conversationCount: 0, messageCount: 0 };
}
/** 덮어쓴 다음 할 일·상태만 주간 항목에 반영 (뱃지·멈춘 일수는 그 주 기준 그대로) */
const pick = (t: TaskListItem) => ({ nextStep: t.nextStep, nextStepInfo: t.nextStepInfo });
function taskList(q: Query): ListResponse<TaskListItem> {
  const statuses = list(q.status); const projects = list(q.projectId);
  let rows = Object.keys(D.tasks).map((id) => listItemFrom(taskDetail(id)));
  if (statuses.length) rows = rows.filter((t) => statuses.includes(t.status)); else rows = rows.filter((t) => t.status !== '보관');
  if (q.kind === 'task' || q.kind === 'quick_question') rows = rows.filter((t) => t.kind === q.kind);
  if (projects.length) rows = rows.filter((t) => projects.includes(t.project?.id ?? 'none'));
  if (q.needsReview !== undefined) { const want = bool(q.needsReview, true); rows = rows.filter((t) => t.needsReview === want && (!want || !taskStatus.has(t.id))); }
  if (q.classificationState === 'blocked' || q.classificationState === 'ok') rows = rows.filter((t) => (t.classificationState ?? 'ok') === q.classificationState);
  else if (q.classificationState !== undefined) throw invalid(`허용되지 않는 classificationState: ${String(q.classificationState)}`, { field: 'classificationState' });
  if (q.handedOff !== undefined) { const want = bool(q.handedOff, true); rows = rows.filter((t) => !!t.handoff === want); }
  const sort = typeof q.sort === 'string' ? q.sort : 'stale_desc';
  rows.sort(sort === 'title_asc' ? (a, b) => a.title.localeCompare(b.title, 'ko')
    : sort === 'last_activity_desc' ? (a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '')
      : (a, b) => (b.staleDays ?? -1) - (a.staleDays ?? -1) || (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''));
  const limit = Math.min(200, Math.max(1, Number(q.limit ?? 50) || 50));
  let offset = 0;
  if (typeof q.cursor === 'string' && q.cursor) { try { offset = Number(JSON.parse(atob(q.cursor)).o) || 0; } catch { throw invalid('커서가 올바르지 않아요', { field: 'cursor' }); } }
  const more = offset + limit < rows.length;
  return { items: rows.slice(offset, offset + limit), page: { limit, nextCursor: more ? btoa(JSON.stringify({ o: offset + limit })).replace(/=+$/, '') : null, hasMore: more, total: rows.length } };
}
/** 확인 필요(§7.6): 확신도 낮음 + 분류 불가. 사용자가 상태를 정했거나 보관이면 뺀다 (코어 services/tasks.ts와 같은 규칙) */
const needsReviewRows = () => taskList({ needsReview: true, limit: 200 }).items;

// ── 1.1.0: 새 프로젝트 제안(§9-2) — 공유 목 + 웹 미리보기용 ready:false 하나, 수락·거절은 메모리에만 ──
function suggestionsNow(): ProjectSuggestion[] {
  return [...clone(M.projectSuggestions.items), ...clone(EXTRA_PROJECT_SUGGESTIONS)].map((x) => {
    const st = suggestionState.get(x.id);
    if (!st) return x;
    return { ...x, state: st.state, decidedAt: NOW, updatedAt: NOW, projectId: st.projectId, ready: false, taskCount: st.state === 'accepted' ? 0 : x.taskCount,
      tasks: st.state === 'accepted' ? x.tasks.map((t) => ({ ...t, projectId: st.projectId })) : x.tasks };
  });
}
function projectSuggestionList(q: Query): ListResponse<ProjectSuggestion> {
  const state = q.state === undefined ? 'pending' : q.state;
  if (state !== 'pending' && state !== 'accepted' && state !== 'rejected') throw invalid(`허용되지 않는 state: ${String(state)}`, { field: 'state' });
  let items = suggestionsNow().filter((x) => x.state === state);
  if (q.ready !== undefined) { const want = bool(q.ready, true); items = items.filter((x) => x.ready === want); }
  items.sort((a, b) => Number(b.ready) - Number(a.ready) || b.taskCount - a.taskCount);
  const limit = Math.min(200, Math.max(1, Number(q.limit ?? 50) || 50));
  return { items: items.slice(0, limit), page: { limit, nextCursor: null, hasMore: items.length > limit, total: items.length } };
}
function decideSuggestion(id: string, action: 'accept' | 'reject', body: unknown): unknown {
  const s = suggestionsNow().find((x) => x.id === id);
  if (!s) throw notFound('프로젝트 제안', id);
  if (s.state !== 'pending') throw err(409, 'CONFLICT', '이미 처리된 제안이에요.', { state: s.state });
  if (action === 'reject') {
    suggestionState.set(id, { state: 'rejected', projectId: null });
    return { suggestion: suggestionsNow().find((x) => x.id === id)! };
  }
  const b = (body ?? {}) as AcceptProjectSuggestionBody;
  if (b.name !== undefined && !b.name.trim()) throw invalid('이름을 비울 수 없어요', { field: 'name' });
  const base = M.acceptProjectSuggestionResponse;
  const sameAsCaptured = base.suggestion.id === id;
  const projectId = sameAsCaptured ? base.project.id : `prj_mock${id.slice(-4)}`;
  const taskIds = (b.taskIds?.length ? s.tasks.filter((t) => b.taskIds!.includes(t.id)) : s.tasks).map((t) => t.id);
  suggestionState.set(id, { state: 'accepted', projectId });
  const project: ProjectSummary = { ...clone(base.project), id: projectId, name: b.name?.trim() || s.name, colorHex: b.colorHex ?? base.project.colorHex, taskCount: taskIds.length };
  const res: AcceptProjectSuggestionResponse = { suggestion: suggestionsNow().find((x) => x.id === id)!, project, attachedTaskIds: taskIds };
  return res;
}
// 대화 원문(§8.12). 1.3.0 음성 표식을 모의에서도 보이도록 예시 대화의 앞 두 메시지를 음성 전사로 둔다.
const VOICE_DEMO = 'conv_chatgpt_68f2a91c'; // 계약서 대화 예시(카피 A/B 비교)
function conversationDetail(id: string) {
  const c = D.conversations[id];
  if (!c) throw notFound('대화', id);
  const d = clone(c);
  if (id === VOICE_DEMO) d.messages.items = d.messages.items.map((m, i) => (i < 2 ? { ...m, voice: true } : m));
  return d;
}

function classificationStatus(): ClassificationStatus {
  const rows = needsReviewRows();
  return { ...clone(M.classificationStatus), needsReviewCount: rows.length, blockedCount: rows.filter((t) => t.classificationState === 'blocked').length };
}

function recountBatch(b: DeletionBatch) {
  for (const g of b.groups) g.selected = g.items.filter((i) => i.selected).length;
  b.selectedCount = b.groups.reduce((s, g) => s + g.selected, 0);
}

// 빈 DB 모양 미리보기: ?mock=empty (세션 동안 유지) — 첫 실행·가져오기 전 화면 점검용
const EMPTY = (() => {
  try {
    const v = new URL(window.location.href).searchParams.get('mock');
    if (v === 'empty' || v === 'full') sessionStorage.setItem('subbrain.mockScenario', v);
    return sessionStorage.getItem('subbrain.mockScenario') === 'empty';
  } catch { return false; }
})();
function emptyGet(a: string | undefined, b: string | undefined): unknown {
  const page = { limit: 50, nextCursor: null, hasMore: false, total: 0 };
  switch (a) {
    case 'dashboard': { const d = clone(M.dashboard); for (const k of Object.keys(d.counts) as Array<keyof typeof d.counts>) d.counts[k] = 0; d.badges = { digestApprovals: 0, pendingMergeSuggestions: 0, vaultConflicts: 0, runningImports: 0, pendingProjectSuggestions: 0 }; d.latestDigestDate = null; d.collection = { lastCapturedAt: null, overallHealth: 'ok', sources: [] }; return d; }
    case 'graph': return { ...clone(M.graph), nodes: [], edges: [], stats: { projectCount: 0, taskCount: 0, quickQuestionCount: 0, topicCount: 0, hiddenQuickCount: 0, truncated: false } };
    case 'activity': return { ...clone(M.activity), buckets: M.activity.buckets.map((x) => ({ ...x, conversationCount: 0, messageCount: 0, taskCount: 0 })) };
    case 'projects': if (b) throw notFound('프로젝트', b); return { items: [], page };
    case 'tasks': if (b) throw notFound('과제', b); return { items: [], page };
    case 'topics': if (b) throw notFound('주제', b); return { items: [], page };
    case 'board': return { columns: M.board.columns.map((c) => ({ ...c, items: [], total: 0 })), weeklyResumeSuggestions: [] };
    case 'digests': if (b) throw err(404, 'NOT_FOUND', `요약이 아직 없어요: ${b}`, { date: b }); return { items: [], page };
    case 'merge-suggestions': return { items: [], page };
    case 'project-suggestions': return { items: [], page };
    case 'classification': return { ...clone(M.classificationStatus), today: { classified: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, costUsdKnown: 0, costUnknownCount: 0, cacheHits: 0 }, needsReviewCount: 0, blockedCount: 0, lastRunAt: null };
    default: return undefined;
  }
}

export async function mockRequest<T>(method: string, path: string, q: Query, body: unknown): Promise<T> {
  await sleep(40 + Math.random() * 80);
  if (EMPTY && method === 'GET') {
    const [a0, b0] = path.split('/').filter(Boolean).map(decodeURIComponent);
    if (a0 === 'search') { const r0 = search(q); return { ...r0, items: [], page: { ...r0.page, total: 0, hasMore: false, nextCursor: null } } as T; }
    const v = emptyGet(a0, b0); if (v !== undefined) return v as T;
  }
  const seg = path.split('/').filter(Boolean).map(decodeURIComponent);
  const r = (x: unknown) => x as T;
  const [a, b, c, d] = seg;
  if (method === 'GET') {
    switch (a) {
      case 'health': return r(M.health);
      case 'meta': return r(M.meta);
      case 'dashboard': {
        const dash = clone(M.dashboard);
        // 상태 덮어쓰기만큼 숫자 옮기기 (코어는 매번 다시 센다)
        const bucket = (st: TaskStatus, stale: number | null, kind: string): Array<keyof typeof dash.counts> =>
          st === '진행 중' ? ['inProgress', 'totalTasks'] : st === '멈춤' ? ((stale ?? 0) >= 8 ? ['stalled', 'stalledOver7Days', 'totalTasks'] : ['stalled', 'totalTasks'])
            : st === '완료' ? ['totalTasks'] : st === '보관' ? ['archived'] : kind === 'quick_question' ? ['quickQuestions'] : [];
        for (const id of taskStatus.keys()) {
          const o = D.tasks[id]; if (!o) continue; const n = taskDetail(id);
          for (const k of bucket(o.status, o.stale.staleDays, o.kind)) dash.counts[k]--;
          for (const k of bucket(n.status, n.stale.staleDays, n.kind)) dash.counts[k]++;
        }
        dash.badges.digestApprovals = fullBatch().state === 'pending' ? 1 : 0; // 모의: LATER(6) 승인 칸 미리보기
        dash.badges.pendingMergeSuggestions = M.mergeSuggestions.items.filter((m) => !mergeState.has(m.id)).length;
        // 1.1.0: 공유 목 dashboard는 제안 0으로 캡처돼 있어(제안 목록엔 ready 1건) 지금 상태로 다시 센다
        dash.badges.pendingProjectSuggestions = suggestionsNow().filter((x) => x.state === 'pending' && x.ready).length;
        dash.counts.needsReview = needsReviewRows().length;
        return r(dash);
      }
      case 'graph':
        if (q.mode === 'ontology') throw notImpl('1.5', '관계 모드는 아직 없어요');
        if (q.at && q.at !== TODAY) throw notImpl('2', '시점 되감기는 아직 없어요');
        return r(filterGraph(graphNow(), q));
      case 'activity': return r(M.activity);
      case 'projects': if (b) return r(projectDetail(b)); return r(M.projectsList);
      case 'topics': if (b) return r(topicDetail(b)); break;
      case 'conversations': if (b) return r(conversationDetail(b)); break;
      case 'tasks':
        if (b && c === 'why-stalled') return r(whyStalledMock(b));
        if (b && c === 'flow') return r(flow(b, q));
        if (b && c === 'resume-prompt') return r(resumePrompt(b, (q.targetAi as SourceAi | undefined) || undefined));
        if (b && c === 'why-stalled') throw notImpl('1.5');
        if (b && !c) return r(taskDetail(b));
        if (!b) return r(taskList(q));
        break;
      case 'review': if (b === 'weekly') return r(weekly(typeof q.date === 'string' ? q.date : undefined)); break;
      case 'board': { const bd = clone(M.board); for (const col of bd.columns) col.items = col.items.map(augRow); return r(bd); }
      case 'project-suggestions': if (!b) return r(projectSuggestionList(q)); break;
      case 'classification': if (b === 'status') return r(classificationStatus()); break;
      case 'imports': if (b && b === M.importProjectsPreview.id) return r(M.importProjectsPreview); if (b) throw notFound('가져오기', b); break;
      case 'digests': if (b) return r(digest(b)); return r(M.digestList);
      case 'search': return r(search(q));
      case 'merge-suggestions': return r({ ...M.mergeSuggestions, items: M.mergeSuggestions.items.filter((m) => !mergeState.has(m.id)) });
      case 'cleanup':
        if (b === 'status') return r({ enabled: true, level: 'L3', mode: 'mark_only', executor: 'off', graceDays: 7, batchCap: 200, archiveServices: ['chatgpt'], todayBatchId: fullBatch().id, latestBatch: { id: fullBatch().id, state: fullBatch().state, createdAt: M.digest.generatedAt }, note: '승인은 표시만 해요.' });
        if (b === 'archive') return r({ archive: clone(mockArchive()) });
        if (b === 'batches' && c) { if (fullBatch().id !== c) throw notFound('삭제 배치', c); return r(mockCleanupDetail()); }
        break;
      case 'deletion-batches': if (b) { if (fullBatch().id !== b) throw notFound('삭제 배치', b); return r({ batch: clone(fullBatch()) }); } break;
      case 'timeline': case 'events': case 'wiki': throw notImpl(a === 'wiki' ? '5' : '2');
      case 'collector': if (!b) return r(clone(collector)); break;
      case 'mcp': if (b === 'events' && !c) return r({ items: clone(mcpEvents) }); break;
      case 'session': return r({ kind: 'web', client: null, scopes: ['ingest', 'read', 'mcp_write'] });
      case 'pairing': if (b === 'clients' && !c) return r({ items: clone(mockClients) }); break;
      case 'sync-state': if (!b) return r({ sources: clone(mockSync) }); break;
      case 'ontology': {
        if (!b) return r(ontologyNow());
        if (b === 'status') { const g = ontologyNow(); const objects: Record<string, number> = {}; for (const o of g.objects) objects[o.type] = (objects[o.type] ?? 0) + 1; return r({ objects, links: g.links.length, pendingSuggestions: g.suggestions.length, llmExtractedConversations: 0, extractableConversations: 0, promptVersion: 'ont-v1', lastRunAt: null, costUsdTotal: null, llmConfigured: false }); }
        break;
      }
      case 'objects': {
        const g = ontologyNow();
        if (!b) { const t = String(q.q ?? '').toLowerCase(); const items = g.objects.filter((o) => !t || o.name.toLowerCase().includes(t) || o.aliases.some((a) => a.toLowerCase().includes(t))).slice(0, Number(q.limit ?? 20)); return r({ items, total: items.length, nextCursor: null }); }
        const o = g.objects.find((x) => x.id === b); if (!o) throw notFound('객체', b);
        if (c === 'impact') return r({ objectId: b, affected: g.links.filter((l) => l.srcId === b && (l.type === 'affects' || l.type === 'derived_from')).map((l) => { const x = g.objects.find((k) => k.id === l.dstId)!; return { object: { id: x.id, type: x.type, label: x.name }, via: [l.type], depth: 1, superseded: false }; }), supersededBy: null });
        const links = g.links.filter((l) => l.srcId === b || l.dstId === b).map((l) => { const out = l.srcId === b; const x = g.objects.find((k) => k.id === (out ? l.dstId : l.srcId))!; return { ...l, direction: out ? 'out' : 'in', other: { id: x.id, type: x.type, label: x.name, status: x.status } }; });
        return r({ object: o, links, evidence: o.evidencePreview, evidenceTotal: o.evidencePreview.length, mentionsByWeek: [], relatedTasks: [] });
      }
      case 'suggestions': if (!b) { const g = ontologyNow(); return r({ items: g.suggestions, total: g.suggestions.length, nextCursor: null }); } break;
    }
  }
  if (method === 'POST' && a === 'pairing' && !b) {
    const k = ((body ?? {}) as { kind?: string }).kind ?? 'extension';
    const code = String(418207 + (++pairSeq) * 7919).slice(-6);
    return r({ pairingId: `pair_mock${pairSeq}`, code, expiresAt: new Date(Date.now() + 300_000).toISOString(), kind: k });
  }
  if (method === 'POST' && a === 'pairing' && b === 'clients' && c && d === 'revoke') {
    const x = mockClients.find((y) => y.tokenId === c); if (!x) throw notFound('기기', c);
    x.revokedAt = new Date().toISOString(); return r(clone(x));
  }
  if (method === 'POST' && a === 'mcp' && b === 'events' && c && d === 'undo') {
    const e = mcpEvents.find((x) => x.id === Number(c)); if (!e) throw notFound('MCP 기록', c);
    if (e.undone) throw err(409, 'CONFLICT', '이미 되돌린 기록이에요.', { eventId: e.id });
    e.undone = true; e.undoneAt = new Date().toISOString();
    return r({ undone: true, eventId: e.id, undoEventId: e.id + 1000, task: taskDetail(taskStatus.has(e.taskId) || e.taskId === 'task_20260830_01' ? e.taskId : 'task_20260830_01') });
  }
  if (method === 'POST' && a === 'suggestions') {
    const pend = (id: string): OntologySuggestion => { const sg = ONT.suggestions.find((x) => x.id === id); if (!sg) throw notFound('제안', id); if (ontDecided.has(id)) throw err(409, 'CONFLICT', '이미 처리된 제안이에요.', { state: ontDecided.get(id)!.state }); return sg; };
    if (b === 'bulk-accept') {
      const bb = (body ?? {}) as { ids?: string[]; minConfidence?: number };
      const cand = ONT.suggestions.filter((x) => !ontDecided.has(x.id) && (bb.ids ? bb.ids.includes(x.id) : x.confidence >= (bb.minConfidence ?? 0.8)));
      const accepted: string[] = []; const skipped: Array<{ id: string; reason: 'protected' }> = [];
      for (const x of cand) { if (x.kind === 'merge' || x.reason === 'first_seen_person' || x.reason === 'supersedes') skipped.push({ id: x.id, reason: 'protected' }); else { ontDecided.set(x.id, { state: 'accepted', eventId: ++ontEvent }); accepted.push(x.id); } }
      return r({ accepted, skipped });
    }
    if (b && (c === 'accept' || c === 'reject')) {
      const sg = pend(b); const eventId = ++ontEvent; ontDecided.set(b, { state: c === 'accept' ? 'accepted' : 'rejected', eventId });
      const g = ontologyNow();
      return r(c === 'accept' ? { suggestion: { ...sg, state: 'accepted' }, objects: [], links: g.links.filter((l) => l.id === sg.linkId), eventId } : { suggestion: { ...sg, state: 'rejected' }, eventId });
    }
  }
  if (method === 'POST' && a === 'ontology' && b === 'events' && c && d === 'undo') {
    const id = Number(c); const hit = [...ontDecided].find(([, v]) => v.eventId === id);
    if (!hit) throw notFound('온톨로지 이벤트', c);
    ontDecided.delete(hit[0]);
    return r({ undone: true, eventId: id, affected: { objectIds: [], linkIds: [] } });
  }
  if (method === 'PUT' && a === 'collector' && b === 'config') {
    const u = (body ?? {}) as PutCollectorConfigBody;
    if (u.enabled !== undefined && typeof u.enabled !== 'boolean') throw invalid('enabled는 true/false여야 해요', { field: 'enabled' });
    Object.assign(collector.config, u);
    collector.watching = collector.config.enabled;
    return r(clone(collector));
  }
  if (method === 'POST' && a === 'collector' && (b === 'scan' || b === 'backfill')) {
    const at = new Date().toISOString();
    for (const s0 of collector.sources) if (s0.enabled) s0.lastScanAt = at;
    const job: Job = { id: `job_mockscan${++scanSeq}`, type: b === 'scan' ? 'collector_scan' : 'collector_backfill', state: 'queued', createdAt: at, startedAt: null, finishedAt: null, progress: { processed: 0, total: collector.sources.length, percent: 0 }, label: b === 'scan' ? '로컬 세션 다시 읽기' : '로컬 세션 처음부터 읽기', parentId: null, error: null, costUsd: null };
    return r(job);
  }
  if (method === 'PATCH' && a === 'tasks' && b && !c) {
    const u = (body ?? {}) as UpdateTaskBody;
    const before = taskDetail(b);
    if (u.status !== undefined) {
      if (!STATUSES.includes(u.status)) throw invalid(`허용되지 않는 상태 값: ${String(u.status)}`, { field: 'status' });
      taskStatus.set(b, u.status);
    }
    if (typeof u.nextStep === 'string' && u.nextStep.trim()) nextStepOverride.set(b, u.nextStep.trim().slice(0, 300));
    else if (u.nextStep === null) nextStepOverride.delete(b);
    const after = taskDetail(b);
    const ev = M.updateTaskResponse.event;
    return r({ task: after, event: { ...ev, id: 900000 + (++eventSeq), taskId: b, at: NOW, payload: { from: before.status, to: after.status, field: 'status', addedOverride: 'status' } } });
  }
  if (method === 'POST' && a === 'tasks' && b && c === 'overrides' && d === 'reset') {
    const fields = ((body ?? {}) as { fields?: string[] }).fields ?? [];
    if (!fields.length) throw invalid('fields를 하나 이상 보내 주세요', { field: 'fields' });
    taskDetail(b);
    if (fields.includes('status')) taskStatus.delete(b);
    if (fields.includes('next_step')) nextStepOverride.delete(b);
    if (fields.includes('open_questions')) for (const q of D.tasks[b]!.openQuestions) oqResolved.delete(q.id);
    return r(taskDetail(b));
  }
  if (method === 'PATCH' && a === 'tasks' && b && c === 'open-questions' && d) {
    const u = (body ?? {}) as { resolved?: boolean };
    const t = taskDetail(b); const oq = t.openQuestions.find((x) => x.id === d);
    if (!oq) throw notFound('열린 질문', d);
    if (typeof u.resolved === 'boolean') oqResolved.set(d, u.resolved);
    return r({ ...oq, resolved: u.resolved ?? oq.resolved, resolvedAt: (u.resolved ?? oq.resolved) ? NOW : null });
  }
  if (method === 'POST' && a === 'merge-suggestions' && b && (c === 'accept' || c === 'reject')) {
    const s = M.mergeSuggestions.items.find((m) => m.id === b) ?? M.digest.pendingMergeSuggestions.find((m) => m.id === b);
    if (!s) throw notFound('합치기 제안', b);
    if (mergeState.has(b)) throw err(409, 'CONFLICT', '이미 처리된 제안이에요.', { state: mergeState.get(b) });
    mergeState.set(b, c === 'accept' ? 'accepted' : 'rejected');
    return r(clone(c === 'accept' ? M.acceptMergeResponse : M.rejectMergeResponse));
  }
  if (method === 'POST' && a === 'project-suggestions' && b && (c === 'accept' || c === 'reject')) return r(decideSuggestion(b, c, body));
  if (a === 'deletion-batches' && b) {
    const bt = fullBatch();
    if (bt.id !== b) throw notFound('삭제 배치', b);
    const locked = () => err(409, 'CONFLICT', '이미 승인했거나 미룬 배치예요.', { state: bt.state });
    if (method === 'PATCH' && c === 'items' && d) {
      if (bt.state !== 'pending') throw locked();
      const item = bt.groups.flatMap((g) => g.items).find((i) => String(i.itemId) === d);
      if (!item) throw notFound('삭제 항목', d);
      const sel = (body as SetDeletionItemBody).selected;
      if (typeof sel !== 'boolean') throw invalid('selected는 true/false여야 해요', { field: 'selected' });
      item.selected = sel; item.excludedByUser = !sel;
      recountBatch(bt);
      return r({ batch: clone(bt) });
    }
    if (method === 'POST' && c === 'approve') {
      const ab = body as ApproveDeletionBody;
      if (bt.state !== 'pending') throw locked();
      for (const id of ab.excludedItemIds ?? []) { const x = bt.groups.flatMap((g) => g.items).find((i) => i.itemId === id); if (x) { x.selected = false; x.excludedByUser = true; } }
      recountBatch(bt);
      if (ab.expectedSelectedCount !== bt.selectedCount) throw err(409, 'CONFLICT', `선택 개수가 바뀌었어요 (서버 ${bt.selectedCount}개). 다시 확인해 주세요.`, { selectedCount: bt.selectedCount });
      if (M.health.buildTarget === 'sellable' && ab.confirmPhrase !== `${bt.selectedCount}개 삭제`) throw invalid('확인 문구가 맞지 않아요.', { field: 'confirmPhrase' });
      bt.state = 'approved';
      return r({ batch: clone(bt) });
    }
    if (method === 'POST' && c === 'postpone') {
      if (bt.state !== 'pending') throw locked();
      bt.state = 'postponed';
      return r({ batch: clone(bt) });
    }
  }
  // 채팅창 정리 미리보기 보조 경로 (코어 src/cleanup 과 같은 모양, 모의 데이터)
  if (method === 'POST' && ((a === 'archive' && b === 'undo') || (a === 'cleanup' && b === 'archive'))) {
    const ids = ((body as { itemIds?: number[] })?.itemIds ?? []);
    let changed = 0;
    for (const id of ids) { const x = mockArchive().find((i) => i.itemId === id); if (!x) throw notFound('보관 항목', String(id)); const to = a === 'archive' ? 'archive_undone' : 'archive_queued'; if (x.state !== to) { x.state = to; changed++; } }
    return r({ changed, batchIds: [fullBatch().id], archive: clone(mockArchive()) });
  }
  if (method === 'POST' && a === 'cleanup' && b === 'run') return r({ batchId: fullBatch().id, created: false, detail: mockCleanupDetail() });
  throw err(404, 'NOT_FOUND', `모의 모드에 없는 경로예요: ${method} ${path}`);
}
