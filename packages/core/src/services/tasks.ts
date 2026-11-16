/** 과제 읽기 모델 + 상태 재계산. 상태는 요청 시점의 "오늘"로 규칙 엔진(§7.2)을 다시 돌려 계산한다. */
import type {
  CaptureMethod, ClassificationState, ConversationOutcome, ConversationOutcomeInfo, CompletionReason, ContinueTarget, HandoffInfo, Kind, OpenQuestion, ProjectRef, Resolution, ServiceState, SourceAi,
  StaleInfo, StaleThresholds, StatusSource, TaskListItem, TaskOrigin, TaskRef, TaskStatus,
} from '@subbrain/shared';
import { SOURCE_AI_LABEL } from '@subbrain/shared/constants';
import type { Core } from '../core.ts';
import { bool, json, num, str, type Row } from '../db/db.ts';
import { computeStatus, resumeScore, staleInfo } from '../rules/rules.ts';
import { daysBetween, kstDate, nowIso, today } from '../util/time.ts';
import { outcomeLabel } from '../classifier/signals.ts';
import { addEvent } from './events.ts';
import { nextStepInfoOf, ruleNextStep, type MsgLite } from './next-step.ts';
import { L } from '../util/lang.ts';

export interface ConvLite {
  id: string; sourceAi: SourceAi; sourceId: string; url: string | null; title: string; messageCount: number;
  createdAt: string; updatedAt: string; role: 'primary' | 'shared'; serviceState: ServiceState; captureMethod: CaptureMethod;
  /** 1.4.0 저장된 대화 결과(StoredOutcome JSON) — 재분류 전이면 null */
  outcomeJson: string | null;
}
export interface ProjectLite { id: string; name: string; colorHex: string; thresholdsJson: string | null; priority: number; status: string }
export interface TaskFull {
  rowid: number; id: string; title: string; projectId: string | null; project: ProjectLite | null; kind: Kind; resolution: Resolution | null;
  storedStatus: TaskStatus; storedStatusSource: StatusSource; storedCompletionReason: CompletionReason | null;
  pin: boolean; overrides: string[]; startedAt: string | null; lastActivityAt: string | null; completedAt: string | null;
  nextStep: string | null; origin: TaskOrigin; summary: string | null; summaryDetail: string[]; confidence: number | null;
  classificationId: number | null; classifiedAt: string | null; resumePrompt: string | null; mcpStatus: TaskStatus | null; mcpStatusAt: string | null;
  openQuestions: OpenQuestion[];
  handoff: HandoffInfo | null; classificationState: ClassificationState; // 1.1.0
  blockedReason: string | null; blockedModel: string | null; // 1.2.0
  convs: ConvLite[]; primary: ConvLite[];
  thresholds: StaleThresholds;
  status: TaskStatus; statusSource: StatusSource; completionReason: CompletionReason | null; stale: StaleInfo; needsReview: boolean;
  /** 규칙으로 만든 다음 할 일(저장된 next_step이 없을 때만 계산) */
  nextStepRule: { text: string; basis: string } | null;
}

export function loadProjects(core: Core): Map<string, ProjectLite> {
  const m = new Map<string, ProjectLite>();
  for (const r of core.db.all('SELECT id,name,color,thresholds_json,priority,status FROM projects')) {
    m.set(String(r.id), { id: String(r.id), name: String(r.name), colorHex: String(r.color), thresholdsJson: str(r.thresholds_json), priority: Number(r.priority ?? 1), status: String(r.status) });
  }
  return m;
}
export const projectRef = (p: ProjectLite | null): ProjectRef | null => (p ? { id: p.id, name: p.name, colorHex: p.colorHex } : null);

function convLite(r: Row): ConvLite {
  return {
    id: String(r.id), sourceAi: String(r.source_ai) as SourceAi, sourceId: String(r.source_id), url: str(r.source_url), title: String(r.title ?? ''),
    messageCount: Number(r.message_count ?? 0), createdAt: String(r.created_at), updatedAt: String(r.updated_at),
    role: (String(r.link_role ?? r.role ?? 'primary') as 'primary' | 'shared'), serviceState: String(r.service_state) as ServiceState, captureMethod: String(r.capture_method) as CaptureMethod,
    outcomeJson: str(r.outcome_json),
  };
}

/** 과제 전부(또는 ids만)를 대화·프로젝트와 함께 읽고 오늘 기준 상태를 계산 */
export function loadTasks(core: Core, opts: { ids?: string[] } = {}): TaskFull[] {
  const db = core.db;
  const ids = opts.ids ? JSON.stringify(opts.ids) : null;
  const rows = ids
    ? db.all('SELECT t.rowid AS rid, t.*, cl.created_at AS classified_at, cl.state AS cls_state, cl.blocked_reason AS cls_blocked_reason, cl.blocked_model AS cls_blocked_model FROM tasks t LEFT JOIN classifications cl ON cl.id=t.classification_id WHERE t.id IN (SELECT value FROM json_each(?))', ids)
    : db.all('SELECT t.rowid AS rid, t.*, cl.created_at AS classified_at, cl.state AS cls_state, cl.blocked_reason AS cls_blocked_reason, cl.blocked_model AS cls_blocked_model FROM tasks t LEFT JOIN classifications cl ON cl.id=t.classification_id');
  const convRows = ids
    ? db.all('SELECT c.*, tc.task_id AS link_task_id, tc.role AS link_role FROM task_conversations tc JOIN conversations c ON c.id=tc.conversation_id WHERE tc.task_id IN (SELECT value FROM json_each(?))', ids)
    : db.all('SELECT c.*, tc.task_id AS link_task_id, tc.role AS link_role FROM task_conversations tc JOIN conversations c ON c.id=tc.conversation_id');
  const byTask = new Map<string, ConvLite[]>();
  for (const r of convRows) {
    const k = String(r.link_task_id);
    let a = byTask.get(k); if (!a) byTask.set(k, (a = []));
    a.push(convLite(r));
  }
  const projects = loadProjects(core);
  const s = core.settings.get();
  const t0 = today();
  const out = rows.map((r) => {
    const convs = (byTask.get(String(r.id)) ?? []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const project = r.project_id ? projects.get(String(r.project_id)) ?? null : null;
    const thresholds = core.thresholdsFor(project?.thresholdsJson);
    const base = {
      rowid: Number(r.rid), id: String(r.id), title: String(r.title), projectId: project ? project.id : null, project,
      kind: (String(r.kind) as Kind), resolution: (str(r.resolution) as Resolution | null),
      storedStatus: String(r.status) as TaskStatus, storedStatusSource: String(r.status_source) as StatusSource, storedCompletionReason: str(r.completion_reason) as CompletionReason | null,
      pin: bool(r.pin), overrides: json<string[]>(r.overrides_json, []), startedAt: str(r.started_at), lastActivityAt: str(r.last_activity_at), completedAt: str(r.completed_at),
      nextStep: str(r.next_step), origin: String(r.origin) as TaskOrigin, summary: str(r.summary), summaryDetail: json<string[]>(r.summary_detail_json, []),
      confidence: num(r.confidence), classificationId: num(r.classification_id), classifiedAt: str(r.classified_at), resumePrompt: str(r.resume_prompt),
      mcpStatus: str(r.mcp_status) as TaskStatus | null, mcpStatusAt: str(r.mcp_status_at), openQuestions: json<OpenQuestion[]>(r.open_questions_json, []),
      handoff: json<HandoffInfo | null>(r.handoff_json, null), classificationState: (str(r.cls_state) === 'blocked' ? 'blocked' : 'ok') as ClassificationState,
      blockedReason: str(r.cls_state) === 'blocked' ? str(r.cls_blocked_reason) : null, blockedModel: str(r.cls_state) === 'blocked' ? str(r.cls_blocked_model) : null,
      convs, primary: convs.filter((c) => c.role === 'primary'), thresholds,
    };
    const res = computeStatus({
      overrides: base.overrides, storedStatus: base.storedStatus, storedStatusSource: base.storedStatusSource, storedCompletionReason: base.storedCompletionReason,
      mcpStatus: base.mcpStatus, mcpStatusAt: base.mcpStatusAt, classifiedAt: base.classifiedAt, kind: base.kind, resolution: base.resolution,
      lastActivityDate: base.lastActivityAt ? kstDate(base.lastActivityAt) : null,
      conversationOutcomes: base.primary.map((c) => json<{ outcome: 'done' | 'moved' | 'interrupted' | 'open'; detectedBy: 'llm' | 'rule' | 'both' } | null>(c.outcomeJson, null)),
    }, t0, thresholds);
    const stale0 = staleInfo(res.status, base.lastActivityAt ? kstDate(base.lastActivityAt) : null, t0, thresholds);
    // 1.4.0 답 받은 간단한 질문은 상태는 완료지만 그래프·보드 고리는 예전처럼 'quick'(작은 회색 점)
    const stale = isQuickAnswered({ kind: base.kind, status: res.status }) ? { ...stale0, statusVisual: 'quick' as const } : stale0;
    // 확인 필요: 확신도 < 기준, 또는 1.1.0 분류 불가(blocked). 사용자가 상태를 정했거나 보관이면 아님
    const needsReview = ((base.confidence !== null && base.confidence < s.classification.lowConfidenceThreshold) || base.classificationState === 'blocked') && !base.overrides.includes('status') && res.status !== '보관';
    return { ...base, status: res.status, statusSource: res.statusSource, completionReason: res.completionReason, stale, needsReview, nextStepRule: null as TaskFull['nextStepRule'] };
  });
  // 다음 할 일(규칙): 저장된 것이 없고 아직 열린 과제만, 최근 대표 대화의 마지막 6개 메시지로 (한 번의 질의)
  const need = out.filter((t) => !t.nextStep && t.status !== '완료' && t.status !== '보관' && t.status !== '간단한 질문');
  const convOf = new Map<string, string>();
  for (const t of need) { const c = t.primary[0] ?? t.convs[0]; if (c) convOf.set(t.id, c.id); }
  const msgs = new Map<string, MsgLite[]>();
  if (convOf.size) {
    const rowsM = db.all<{ conversation_id: string; role: string; c: string }>(
      `SELECT m.conversation_id, m.role, substr(m.content_md, -2500) AS c FROM messages m
       JOIN (SELECT conversation_id AS cid, MAX(seq) AS mx FROM messages WHERE conversation_id IN (SELECT value FROM json_each(?)) GROUP BY conversation_id) x ON x.cid=m.conversation_id
       WHERE m.seq > x.mx - 6 ORDER BY m.conversation_id, m.seq`, JSON.stringify([...new Set(convOf.values())]));
    for (const r of rowsM) { let a = msgs.get(r.conversation_id); if (!a) msgs.set(r.conversation_id, (a = [])); a.push({ role: r.role, text: String(r.c ?? '') }); }
  }
  for (const t of need) {
    const oq = t.openQuestions.find((q) => !q.resolved)?.text ?? null;
    t.nextStepRule = ruleNextStep({ status: t.status, staleDays: t.stale.staleDays, title: t.title, openQuestion: oq, msgs: msgs.get(convOf.get(t.id) ?? '') ?? [] });
  }
  return out;
}
export const nextStepInfo = (t: TaskFull) => nextStepInfoOf(t);
/** 맥락 프롬프트·점수에 쓰는 실제 다음 할 일 문장 */
export const effectiveNextStep = (t: TaskFull): string | null => nextStepInfoOf(t)?.text ?? t.nextStep;

export function loadTask(core: Core, id: string): TaskFull | null { return loadTasks(core, { ids: [id] })[0] ?? null; }

/** 1.4.0 답 받은 간단한 질문(상태 완료 + 종류 quick_question). 옛 '간단한 질문' 상태 값(사용자 고정)도 같은 뜻으로 본다 */
export const isQuickAnswered = (t: { kind: Kind; status: TaskStatus }): boolean => (t.kind === 'quick_question' && t.status === '완료') || t.status === '간단한 질문';

/**
 * 1.4.0 대화 결과 배지. 저장된 결과가 없으면(1.4.0 이전 분류) 과제 상태로 추정(detectedBy 'derived'):
 * handoff → moved, 과제 완료 → done, 나머지 open. 대화 상태: done·moved = 완료, 나머지는 대화 마지막 날짜로 진행 중/멈춤.
 */
export function outcomeInfo(c: { outcomeJson: string | null; updatedAt: string }, task: { status: TaskStatus; handoff: HandoffInfo | null } | null, thresholds: StaleThresholds, t0 = today()): ConversationOutcomeInfo {
  type Stored = { outcome: ConversationOutcome; target: string | null; evidence: string | null; reason: string | null; detectedBy: 'llm' | 'rule' | 'both' };
  const st = json<Stored | null>(c.outcomeJson, null);
  const o: Omit<Stored, 'detectedBy'> & { detectedBy: ConversationOutcomeInfo['detectedBy'] } = st ?? (task?.handoff
    ? { outcome: 'moved', target: task.handoff.target, evidence: task.handoff.evidence, reason: null, detectedBy: 'derived' }
    : { outcome: task && (task.status === '완료' || task.status === '간단한 질문') ? 'done' : 'open', target: null, evidence: null, reason: null, detectedBy: 'derived' });
  let status: ConversationOutcomeInfo['status'] = '완료', staleDays: number | null = null;
  if (o.outcome === 'interrupted' || o.outcome === 'open') {
    const d = Math.max(0, daysBetween(kstDate(c.updatedAt), t0));
    if (d <= thresholds.inProgressMaxDays) status = '진행 중'; else { status = '멈춤'; staleDays = d; }
  }
  // 1.5.0 저장된 라벨(분류 때 정한 글)을 먼저 쓴다. open은 날짜에 따라 바뀌므로 늘 계산
  const label = o.outcome === 'open' ? (status === '멈춤' ? L(`멈춤 ${staleDays}일`, `Stalled ${staleDays}d`) : L('진행 중', 'In progress')) : (st as { label?: string } | null)?.label ?? outcomeLabel(o.outcome, o.target, o.reason);
  return { outcome: o.outcome, status, staleDays, label, target: o.target, evidence: o.evidence, detectedBy: o.detectedBy };
}

export const latestPrimary = (t: TaskFull): ConvLite | null => t.primary[0] ?? t.convs[0] ?? null;
// 계약서 §15-2 (1.0.1): 과제의 대화 수·메시지 수·AI 목록은 공유 대화를 포함해 센다 — 목록·그래프·상세 모두 같은 규칙
export const primaryAis = (t: TaskFull): SourceAi[] => [...new Set(t.convs.map((c) => c.sourceAi))];
export const primaryMessageCount = (t: TaskFull): number => t.convs.reduce((n, c) => n + c.messageCount, 0);

export function toTaskRef(t: TaskFull): TaskRef {
  return { id: t.id, title: t.title, status: t.status, statusVisual: t.stale.statusVisual, staleDays: t.stale.staleDays, projectId: t.projectId };
}
export function toListItem(t: TaskFull): TaskListItem {
  const lp = latestPrimary(t);
  return {
    id: t.id, title: t.title, summary: t.summary, kind: t.kind, status: t.status, statusVisual: t.stale.statusVisual,
    staleDays: t.stale.staleDays, staleStage: t.stale.staleStage, badge: t.stale.badge, project: projectRef(t.project), sourceAis: primaryAis(t),
    conversationCount: t.convs.length, messageCount: primaryMessageCount(t), startedAt: t.startedAt, lastActivityAt: t.lastActivityAt,
    completedAt: t.status === '완료' ? t.completedAt : null, nextStep: t.nextStep, nextStepInfo: nextStepInfoOf(t), needsReview: t.needsReview, pin: t.pin,
    primaryConversation: lp ? { id: lp.id, sourceAi: lp.sourceAi, url: lp.url } : null,
    handoff: t.handoff, classificationState: t.classificationState,
    blockedReason: t.blockedReason, blockedModel: t.blockedModel, confidence: t.confidence,
    completionReason: t.status === '완료' ? t.completionReason : null,
    conversationOutcome: lp ? outcomeInfo(lp, t, t.thresholds) : null,
  };
}
export function continueTarget(c: ConvLite | null): ContinueTarget | null {
  return c && c.url ? { sourceAi: c.sourceAi, url: c.url, conversationId: c.id, label: L(`${SOURCE_AI_LABEL[c.sourceAi]}에서 이어서`, `Continue in ${SOURCE_AI_LABEL[c.sourceAi]}`) } : null;
}
export function scoreOf(t: TaskFull): number {
  return resumeScore({ status: t.status, kind: t.kind, staleDays: t.stale.staleDays, projectPriority: t.project?.priority ?? null, hasNextStep: Boolean(t.nextStep), openQuestionCount: t.openQuestions.filter((q) => !q.resolved).length }, t.thresholds);
}

// ───────────────────────── 정렬
const byStr = (a: string | null, b: string | null) => (a ?? '').localeCompare(b ?? '');
export function sortTasks(list: TaskFull[], sort: 'stale_desc' | 'last_activity_desc' | 'started_desc' | 'resume_score_desc' | 'title_asc'): TaskFull[] {
  const cmp: Record<typeof sort, (a: TaskFull, b: TaskFull) => number> = {
    stale_desc: (a, b) => (b.stale.staleDays ?? -1) - (a.stale.staleDays ?? -1) || byStr(b.lastActivityAt, a.lastActivityAt),
    last_activity_desc: (a, b) => byStr(b.lastActivityAt, a.lastActivityAt) || a.id.localeCompare(b.id),
    started_desc: (a, b) => byStr(b.startedAt, a.startedAt) || a.id.localeCompare(b.id),
    resume_score_desc: (a, b) => scoreOf(b) - scoreOf(a) || byStr(b.lastActivityAt, a.lastActivityAt),
    title_asc: (a, b) => a.title.localeCompare(b.title, 'ko'),
  };
  return [...list].sort(cmp[sort]);
}

// ───────────────────────── 상태 재계산 (규칙 엔진 결과를 저장 + 전환 이벤트)
/** 대화에서 시작일·마지막 활동을 다시 계산하고 상태를 저장한다. 바뀌면 status_changed 이벤트(actor). */
export function refreshTask(core: Core, taskId: string, actor: 'rule' | 'classifier' | 'user' = 'rule', opts: { silent?: boolean } = {}): { from: TaskStatus; to: TaskStatus } | null {
  const db = core.db;
  const agg = db.get<{ s: string | null; l: string | null }>(
    "SELECT MIN(c.created_at) AS s, MAX(c.updated_at) AS l FROM task_conversations tc JOIN conversations c ON c.id=tc.conversation_id WHERE tc.task_id=? AND tc.role='primary'", taskId);
  if (agg?.s) db.run('UPDATE tasks SET started_at=?, last_activity_at=? WHERE id=?', agg.s, agg.l, taskId);
  const t = loadTask(core, taskId);
  if (!t) return null;
  const changed = t.status !== t.storedStatus;
  let completedAt = t.completedAt;
  if (t.status === '완료' && !completedAt) completedAt = actor === 'user' ? nowIso() : t.lastActivityAt ?? nowIso();
  if (t.status !== '완료') completedAt = null;
  db.run('UPDATE tasks SET status=?, status_source=?, completion_reason=?, stale_days=?, completed_at=?, updated_at=? WHERE id=?',
    t.status, t.statusSource, t.completionReason, t.stale.staleDays, completedAt, changed ? nowIso() : (db.value<string>('SELECT updated_at FROM tasks WHERE id=?', taskId) ?? nowIso()), taskId);
  if (!changed) return null;
  if (!opts.silent) {
    const eventActor = actor === 'rule' ? 'rule' : actor === 'classifier' ? 'classifier' : 'user';
    addEvent(db, { type: 'status_changed', actor: eventActor, taskId, payload: { from: t.storedStatus, to: t.status, staleDays: t.stale.staleDays } });
    if (t.status === '완료') addEvent(db, { type: 'completed', actor: eventActor, taskId, payload: { completionReason: t.completionReason } });
  }
  return { from: t.storedStatus, to: t.status };
}

/** 전체 재계산 (매일 새벽 스케줄러, 기준 일수 변경 시). LLM 호출 없음(§7.3) */
export function recalcAll(core: Core): { total: number; changed: number } {
  const ids = core.db.all<{ id: string }>('SELECT id FROM tasks').map((r) => r.id);
  let changed = 0;
  core.db.tx(() => { for (const id of ids) if (refreshTask(core, id, 'rule')) changed++; });
  return { total: ids.length, changed };
}
