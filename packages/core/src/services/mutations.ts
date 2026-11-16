/** 쓰기: 프로젝트 · 과제 PATCH · 고정값 해제 · 열린 질문 · 결정 · 과제 합치기 · 합치기 제안 */
import type {
  AcceptMergeBody, CreateProjectBody, Decision, MergeSuggestion, OpenQuestion, ResetOverridesBody, TimelineEvent,
  UpdateDecisionBody, UpdateOpenQuestionBody, UpdateProjectBody, UpdateTaskBody,
} from '@subbrain/shared';
import { PROJECT_PALETTE } from '@subbrain/shared/constants';
import type { Core } from '../core.ts';
import { json, str } from '../db/db.ts';
import { validateThresholds, mergeThresholds } from '../rules/rules.ts';
import { ApiError, conflict, invalid, notFound } from '../util/errors.ts';
import { randomId, slugify } from '../util/ids.ts';
import { nowIso } from '../util/time.ts';
import { addEvent } from './events.ts';
import { loadTask, refreshTask } from './tasks.ts';
import { loadDecisions, mergeSuggestionsFor } from './views.ts';

// ───────── 프로젝트
export function nextProjectColor(core: Core): string {
  const n = Number(core.db.value('SELECT COUNT(*) FROM projects') ?? 0);
  return PROJECT_PALETTE[n % PROJECT_PALETTE.length]!;
}
export function projectIdFor(core: Core, name: string): string {
  const ascii = slugify(name).replace(/[^a-z0-9-]/g, '').replace(/-+/g, '_').replace(/^_|_$/g, '');
  let base = `prj_${ascii && ascii.length >= 2 ? ascii.slice(0, 24) : randomId(6)}`;
  while (core.db.get('SELECT 1 FROM projects WHERE id=?', base)) base = `prj_${ascii ? ascii.slice(0, 18) + '_' : ''}${randomId(4)}`;
  return base;
}
export function createProject(core: Core, body: CreateProjectBody, id?: string): string {
  if (core.db.get('SELECT 1 FROM projects WHERE name=?', body.name)) throw conflict(`이미 있는 프로젝트 이름이에요: ${body.name}`, { name: body.name });
  const pid = id ?? projectIdFor(core, body.name);
  core.db.run('INSERT INTO projects(id,name,aliases_json,status,color,created_at) VALUES (?,?,?,?,?,?)',
    pid, body.name, JSON.stringify(body.aliases ?? []), body.status ?? 'active', body.colorHex ?? nextProjectColor(core), nowIso());
  core.vault.schedule('project', pid);
  return pid;
}
export function updateProject(core: Core, id: string, body: UpdateProjectBody): void {
  const p = core.db.get('SELECT * FROM projects WHERE id=?', id);
  if (!p) throw notFound('프로젝트', id, 'projectId');
  if (body.name && body.name !== p.name && core.db.get('SELECT 1 FROM projects WHERE name=? AND id<>?', body.name, id)) throw conflict(`이미 있는 프로젝트 이름이에요: ${body.name}`, { name: body.name });
  if (body.thresholds) {
    const err = validateThresholds(mergeThresholds(core.settings.get().thresholds, body.thresholds));
    if (err) throw invalid('방치 기준 일수 순서가 맞지 않아요.', [{ path: 'thresholds', message: err }]);
  }
  core.db.run('UPDATE projects SET name=COALESCE(?,name), aliases_json=COALESCE(?,aliases_json), color=COALESCE(?,color), status=COALESCE(?,status) WHERE id=?',
    body.name ?? null, body.aliases ? JSON.stringify(body.aliases) : null, body.colorHex ?? null, body.status ?? null, id);
  if (body.thresholds !== undefined) {
    core.db.run('UPDATE projects SET thresholds_json=? WHERE id=?', body.thresholds === null ? null : JSON.stringify(body.thresholds), id);
    for (const t of core.db.all<{ id: string }>('SELECT id FROM tasks WHERE project_id=?', id)) refreshTask(core, t.id, 'rule');
  }
  core.vault.schedule('project', id);
  if (body.name) for (const t of core.db.all<{ id: string }>('SELECT id FROM tasks WHERE project_id=?', id)) core.vault.scheduleTask(t.id);
}

// ───────── 과제 PATCH (§8.5): 보낸 필드만 바꾸고 overrides에 추가
const FIELD_OVERRIDE: Record<string, string> = { status: 'status', projectId: 'project', pin: 'pin', title: 'title', nextStep: 'next_step' };

export function updateTask(core: Core, id: string, body: UpdateTaskBody): TimelineEvent {
  const db = core.db;
  const t = loadTask(core, id);
  if (!t) throw notFound('과제', id, 'taskId');
  if (body.projectId && !db.get('SELECT 1 FROM projects WHERE id=?', body.projectId)) throw notFound('프로젝트', body.projectId, 'projectId');
  const newStatus = body.status ?? t.status;
  if (body.completionReason && newStatus !== '완료') throw invalid('완료 사유는 상태가 완료일 때만 줄 수 있어요.', [{ path: 'completionReason', message: "status가 '완료'여야 해요" }]);
  const fields = Object.keys(body).filter((k) => k in FIELD_OVERRIDE);
  if (!fields.length && body.completionReason === undefined) throw invalid('바꿀 필드가 없어요.', [{ path: '(본문)', message: 'status, projectId, pin, title, nextStep 중 하나 이상' }]);
  return db.tx(() => {
    const overrides = new Set(t.overrides);
    const added: string[] = [];
    for (const f of fields) { const o = FIELD_OVERRIDE[f]!; if (!overrides.has(o)) added.push(o); overrides.add(o); }
    const now = nowIso();
    if (body.status !== undefined) {
      const reason = body.status === '완료' ? body.completionReason ?? t.completionReason ?? 'resolved' : null;
      db.run('UPDATE tasks SET status=?, status_source=?, completion_reason=?, completed_at=? WHERE id=?', body.status, 'user', reason,
        body.status === '완료' ? (t.status === '완료' ? t.completedAt : now) : null, id);
    } else if (body.completionReason !== undefined) {
      db.run('UPDATE tasks SET completion_reason=? WHERE id=?', body.completionReason ?? 'resolved', id);
    }
    if (body.projectId !== undefined) db.run('UPDATE tasks SET project_id=? WHERE id=?', body.projectId, id);
    if (body.pin !== undefined) db.run('UPDATE tasks SET pin=? WHERE id=?', body.pin, id);
    if (body.title !== undefined) db.run('UPDATE tasks SET title=? WHERE id=?', body.title, id);
    if (body.nextStep !== undefined) db.run('UPDATE tasks SET next_step=?, resume_prompt=NULL WHERE id=?', body.nextStep, id);
    db.run('UPDATE tasks SET overrides_json=?, updated_at=? WHERE id=?', JSON.stringify([...overrides]), now, id);
    refreshTask(core, id, 'user', { silent: true });
    const payload: Record<string, unknown> = body.status !== undefined
      ? { from: t.status, to: body.status, field: 'status', ...(added.includes('status') ? { addedOverride: 'status' } : {}) }
      : { field: fields[0] ?? 'completionReason', fields, from: fieldValue(t, fields[0]), to: fields[0] ? (body as Record<string, unknown>)[fields[0]] : body.completionReason };
    if (body.status !== undefined && fields.length > 1) payload.fields = fields;
    if (added.length > 1 || (added.length === 1 && added[0] !== 'status')) payload.addedOverrides = added;
    if (body.note) payload.note = body.note;
    const ev = addEvent(db, { type: 'status_changed', actor: 'user', taskId: id, payload });
    if (body.status === '완료' && t.status !== '완료') addEvent(db, { type: 'completed', actor: 'user', taskId: id, payload: { completionReason: body.completionReason ?? 'resolved' } });
    core.vault.scheduleTask(id);
    if (body.projectId !== undefined && t.projectId) core.vault.schedule('project', t.projectId);
    return ev;
  });
}
function fieldValue(t: NonNullable<ReturnType<typeof loadTask>>, f: string | undefined): unknown {
  return f === 'projectId' ? t.projectId : f === 'pin' ? t.pin : f === 'title' ? t.title : f === 'nextStep' ? t.nextStep : null;
}

/** §8.6 고정값 해제 → 분류기·규칙 값으로 되돌림 */
export function resetOverrides(core: Core, id: string, body: ResetOverridesBody): void {
  const db = core.db;
  const t = loadTask(core, id);
  if (!t) throw notFound('과제', id, 'taskId');
  db.tx(() => {
    const overrides = t.overrides.filter((o) => !body.fields.includes(o as ResetOverridesBody['fields'][number]));
    db.run('UPDATE tasks SET overrides_json=?, updated_at=? WHERE id=?', JSON.stringify(overrides), nowIso(), id);
    const cls = t.classificationId !== null ? db.get('SELECT * FROM classifications WHERE id=?', t.classificationId) : undefined;
    if (body.fields.includes('pin')) db.run('UPDATE tasks SET pin=0 WHERE id=?', id);
    if (body.fields.includes('next_step') && cls) db.run('UPDATE tasks SET next_step=?, resume_prompt=NULL WHERE id=?', str(cls.next_step), id);
    if (body.fields.includes('title')) {
      const first = t.primary.at(-1);
      if (first) db.run('UPDATE tasks SET title=? WHERE id=?', first.title, id);
    }
    if (body.fields.includes('project') && cls?.project_guess) {
      const pid = db.value<string>('SELECT id FROM projects WHERE name=?', String(cls.project_guess));
      db.run('UPDATE tasks SET project_id=? WHERE id=?', pid, id);
    }
    refreshTask(core, id, 'rule');
    addEvent(db, { type: 'status_changed', actor: 'user', taskId: id, payload: { action: 'reset_overrides', fields: body.fields } });
  });
  core.vault.scheduleTask(id);
}

function addOverride(core: Core, taskId: string, field: string): void {
  const cur = json<string[]>(core.db.value<string>('SELECT overrides_json FROM tasks WHERE id=?', taskId), []);
  if (!cur.includes(field)) core.db.run('UPDATE tasks SET overrides_json=? WHERE id=?', JSON.stringify([...cur, field]), taskId);
}

export function updateOpenQuestion(core: Core, taskId: string, qid: string, body: UpdateOpenQuestionBody): OpenQuestion {
  const t = loadTask(core, taskId);
  if (!t) throw notFound('과제', taskId, 'taskId');
  const q = t.openQuestions.find((x) => x.id === qid);
  if (!q) throw notFound('열린 질문', qid, 'questionId');
  if (body.text === undefined && body.resolved === undefined) throw invalid('바꿀 필드가 없어요.', [{ path: '(본문)', message: 'resolved 또는 text' }]);
  if (body.text !== undefined) q.text = body.text;
  if (body.resolved !== undefined && body.resolved !== q.resolved) { q.resolved = body.resolved; q.resolvedAt = body.resolved ? nowIso() : null; }
  core.db.tx(() => {
    core.db.run('UPDATE tasks SET open_questions_json=?, resume_prompt=NULL, updated_at=? WHERE id=?', JSON.stringify(t.openQuestions), nowIso(), taskId);
    addOverride(core, taskId, 'open_questions');
  });
  core.vault.schedule('task', taskId);
  return q;
}

export function updateDecision(core: Core, taskId: string, did: string, body: UpdateDecisionBody): Decision {
  const db = core.db;
  if (!db.get('SELECT 1 FROM tasks WHERE id=?', taskId)) throw notFound('과제', taskId, 'taskId');
  const o = db.get("SELECT * FROM objects WHERE id=? AND type='decision' AND ref_id=?", did, taskId);
  if (!o) throw notFound('결정', did, 'decisionId');
  if (body.text === undefined && body.valid === undefined) throw invalid('바꿀 필드가 없어요.', [{ path: '(본문)', message: 'text 또는 valid' }]);
  const props = json<Record<string, unknown>>(o.properties_json, {});
  if (body.valid !== undefined) props.valid = body.valid;
  props.overridden = true;
  db.tx(() => {
    db.run("UPDATE objects SET name=COALESCE(?,name), norm_name=COALESCE(?,norm_name), properties_json=?, status='accepted', origin='user' WHERE id=?",
      body.text ?? null, body.text ? normName(body.text) : null, JSON.stringify(props), did);
    syncDecisionsCopy(core, taskId);
    addOverride(core, taskId, 'decisions');
    db.run('UPDATE tasks SET resume_prompt=NULL WHERE id=?', taskId);
  });
  core.vault.schedule('task', taskId);
  return loadDecisions(core, taskId).find((d) => d.id === did)!;
}
export const normName = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '');
/** tasks.decisions_json = 결정 객체의 보여주기용 사본(§6.2 v1.1) */
export function syncDecisionsCopy(core: Core, taskId: string): void {
  const copy = loadDecisions(core, taskId).map((d) => ({ id: d.id, text: d.text, source_conversation_id: d.sourceConversationId, valid: d.valid }));
  core.db.run('UPDATE tasks SET decisions_json=? WHERE id=?', JSON.stringify(copy), taskId);
}

// ───────── 과제 합치기 (§8.10)
export function mergeTasks(core: Core, targetId: string, sourceIds: string[], title?: string): TimelineEvent {
  const db = core.db;
  const target = loadTask(core, targetId);
  if (!target) throw notFound('과제', targetId, 'taskId');
  const sources = [...new Set(sourceIds)].filter((s) => s !== targetId);
  if (!sources.length) throw invalid('합칠 과제가 없어요.', [{ path: 'sourceTaskIds', message: '대상 과제와 다른 과제 id가 필요해요' }]);
  for (const s of sources) if (!db.get('SELECT 1 FROM tasks WHERE id=?', s)) throw notFound('과제', s, 'taskId');
  const oldProjects = new Set<string>();
  const ev = db.tx(() => {
    const oq = [...target.openQuestions];
    for (const sid of sources) {
      const src = loadTask(core, sid)!;
      if (src.projectId) oldProjects.add(src.projectId);
      for (const c of src.convs) {
        const exists = db.get<{ role: string }>('SELECT role FROM task_conversations WHERE task_id=? AND conversation_id=?', targetId, c.id);
        if (exists) { if (c.role === 'primary' && exists.role !== 'primary') db.run("UPDATE task_conversations SET role='primary' WHERE task_id=? AND conversation_id=?", targetId, c.id); }
        else db.run('INSERT INTO task_conversations(task_id,conversation_id,role) VALUES (?,?,?)', targetId, c.id, c.role);
        if (c.role === 'primary') db.run('UPDATE conversations SET task_id=? WHERE id=?', targetId, c.id);
      }
      db.run("UPDATE objects SET ref_id=? WHERE type='decision' AND ref_table='tasks' AND ref_id=?", targetId, sid);
      for (const q of src.openQuestions) oq.push({ ...q, id: `oq_${targetId.replace(/^task_/, '')}_${oq.length + 1}` });
      db.run('INSERT OR IGNORE INTO task_topics(task_id,topic_id,confidence,created_at,origin,conversation_id) SELECT ?, topic_id, confidence, created_at, origin, conversation_id FROM task_topics WHERE task_id=?', targetId, sid);
      db.run('UPDATE OR IGNORE project_suggestion_tasks SET task_id=? WHERE task_id=?', targetId, sid);
      db.run('UPDATE OR IGNORE task_links SET src_task_id=? WHERE src_task_id=?', targetId, sid);
      db.run('UPDATE OR IGNORE task_links SET dst_task_id=? WHERE dst_task_id=?', targetId, sid);
      db.run('DELETE FROM task_links WHERE src_task_id=dst_task_id');
      db.run("UPDATE task_merge_suggestions SET state='accepted', decided_at=? WHERE state='pending' AND ((task_a=? AND task_b=?) OR (task_a=? AND task_b=?))", nowIso(), targetId, sid, sid, targetId);
      db.run("UPDATE task_merge_suggestions SET state='rejected', decided_at=? WHERE state='pending' AND (task_a=? OR task_b=?)", nowIso(), sid, sid);
      if (!target.projectId && src.projectId) db.run('UPDATE tasks SET project_id=? WHERE id=?', src.projectId, targetId);
      db.run('DELETE FROM tasks WHERE id=?', sid);
    }
    db.run('UPDATE tasks SET open_questions_json=?, resume_prompt=NULL, updated_at=? WHERE id=?', JSON.stringify(oq), nowIso(), targetId);
    if (title) {
      db.run('UPDATE tasks SET title=? WHERE id=?', title, targetId);
      addOverride(core, targetId, 'title');
    }
    syncDecisionsCopy(core, targetId);
    refreshTask(core, targetId, 'user');
    return addEvent(db, { type: 'status_changed', actor: 'user', taskId: targetId, payload: { action: 'merge', mergedTaskIds: sources } });
  });
  for (const sid of sources) core.vault.removeEntity('task', sid);
  core.vault.scheduleTask(targetId);
  for (const p of oldProjects) core.vault.schedule('project', p);
  return ev;
}

export function acceptSuggestion(core: Core, id: string, body: AcceptMergeBody): { suggestion: MergeSuggestion; taskId: string } {
  const db = core.db;
  const s = db.get('SELECT * FROM task_merge_suggestions WHERE id=?', id);
  if (!s) throw notFound('합치기 제안', id, 'suggestionId');
  if (s.state !== 'pending') throw conflict('이미 처리된 제안이에요.', { suggestionId: id, state: String(s.state) });
  const pair = [String(s.task_a), String(s.task_b)];
  const primary = body.primaryTaskId ?? String(s.suggested_primary);
  if (!pair.includes(primary)) throw invalid('남길 과제는 제안에 든 두 과제 중 하나여야 해요.', [{ path: 'primaryTaskId', message: pair.join(' 또는 ') }]);
  const other = pair.find((p) => p !== primary)!;
  const before = mergeSuggestionsFor(core, { ids: [id] })[0];
  if (!before) throw new ApiError('CONFLICT', '제안에 든 과제가 이미 없어요.', { suggestionId: id });
  mergeTasks(core, primary, [other], body.title);
  const decidedAt = nowIso();
  db.run("UPDATE task_merge_suggestions SET state='accepted', decided_at=? WHERE id=?", decidedAt, id);
  addEvent(db, { type: 'suggestion_accepted', actor: 'user', taskId: primary, payload: { suggestionId: id, mergedTaskIds: [other] } });
  return { suggestion: { ...before, state: 'accepted', decidedAt }, taskId: primary };
}

export function rejectSuggestion(core: Core, id: string, reason?: string): MergeSuggestion {
  const db = core.db;
  const s = db.get('SELECT * FROM task_merge_suggestions WHERE id=?', id);
  if (!s) throw notFound('합치기 제안', id, 'suggestionId');
  if (s.state !== 'pending') throw conflict('이미 처리된 제안이에요.', { suggestionId: id, state: String(s.state) });
  db.run("UPDATE task_merge_suggestions SET state='rejected', decided_at=? WHERE id=?", nowIso(), id);
  addEvent(db, { type: 'suggestion_rejected', actor: 'user', taskId: String(s.task_a), payload: { suggestionId: id, tasks: [s.task_a, s.task_b], ...(reason ? { reason } : {}) } });
  return mergeSuggestionsFor(core, { ids: [id] })[0]!;
}
