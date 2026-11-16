/**
 * 새 프로젝트 제안 (계약 §16 1.1.0, 설계서 §7.6 new_project_suggestion · §7.7 "비슷한 주제의 미분류 대화가 3개 이상 모이면 새 프로젝트를 자동 제안,
 * 요약에서 한 번 눌러 승인, L4는 자동 생성").
 *  - 분류기가 기존 프로젝트에 없는 이름을 내면(new_project_suggestion, 또는 목록에 없는 project) 비슷한 이름끼리 제안 하나로 묶는다.
 *  - 프로젝트가 없는 과제가 minTasks(3)개 이상이면 ready → 요약·배지에 노출. 자동화 L4면 그 순간 자동 생성.
 *  - accept: 프로젝트를 만들고(같은 이름이 있으면 그것을 씀) 아직 프로젝트가 없고 사용자가 프로젝트를 고정하지 않은 과제를 붙인다.
 *  - reject: 같은 이름(비슷한 이름)은 다시 제안하지 않는다.
 *  - 1.2.0: 간단한 질문(kind=quick_question)은 제안에 넣지 않는다(§7.7은 "미분류 과제"를 모으는 것 — 간단한 질문은 과제가 아님).
 *  - 1.2.0: 비슷한 이름(한↔영 음차 별칭·일반어 제거 후 핵심 단어 겹침, util/similarity.ts similarProjectName)이나
 *    같은 과제·같은 대화·합치기 제안으로 이어진 과제를 가진 대기 중 제안은 하나로 합친다(consolidateProjectSuggestions).
 */
import type { AcceptProjectSuggestionBody, ProjectSuggestion, ProjectSuggestionState, SourceAi } from '@subbrain/shared';
import { CLASSIFIER_TUNING } from '@subbrain/shared/constants';
import type { Core } from '../core.ts';
import { json, str, type Row } from '../db/db.ts';
import { conflict, notFound } from '../util/errors.ts';
import { randomId } from '../util/ids.ts';
import { similarProjectName } from '../util/similarity.ts';
import { nowIso } from '../util/time.ts';
import { addEvent } from './events.ts';
import { createProject, normName } from './mutations.ts';
import { loadTasks, primaryAis, refreshTask, toTaskRef } from './tasks.ts';

const MIN = CLASSIFIER_TUNING.projectSuggestionMinTasks;

/** 이름이 기존 프로젝트(이름·동의어)와 정규화 후 같으면 그 id */
export function findProjectByName(core: Core, name: string): string | null {
  const nn = normName(name);
  if (!nn) return null;
  for (const p of core.db.all<{ id: string; name: string; aliases_json: string }>('SELECT id, name, aliases_json FROM projects')) {
    if (normName(p.name) === nn || json<string[]>(p.aliases_json, []).some((a) => normName(a) === nn)) return p.id;
  }
  return null;
}

/** 프로젝트가 없는 과제 수(제안의 실제 크기) */
function eligibleTaskIds(core: Core, suggestionId: string): string[] {
  return core.db.all<{ id: string }>(
    `SELECT t.id FROM project_suggestion_tasks pt JOIN tasks t ON t.id=pt.task_id
     WHERE pt.suggestion_id=? AND t.project_id IS NULL AND t.status<>'보관' AND t.kind='task' ORDER BY t.last_activity_at DESC`, suggestionId).map((r) => r.id);
}

/**
 * 분류 결과 하나를 제안에 반영(분류 트랜잭션 안에서 부른다). 반환: 이 과제를 붙인 제안 id 또는 null.
 * name=null이면 이 과제의 대기 중 제안 연결만 뗀다(최신 LLM 판단이 "새 프로젝트 아님").
 */
export function recordProjectSuggestion(core: Core, p: { taskId: string; conversationId: string; name: string | null; confidence: number; at: string }): string | null {
  const db = core.db;
  db.run("DELETE FROM project_suggestion_tasks WHERE task_id=? AND suggestion_id IN (SELECT id FROM project_suggestions WHERE state='pending')", p.taskId);
  const name = p.name?.trim().slice(0, 80) ?? '';
  if (!name || !normName(name)) return null;
  if (db.value<string>('SELECT kind FROM tasks WHERE id=?', p.taskId) !== 'task') return null; // 간단한 질문은 제안에 넣지 않음
  // 거절했던 이름(비슷한 이름 포함)은 다시 제안하지 않는다
  const all = db.all<{ id: string; name: string; alt_names_json: string; state: ProjectSuggestionState; project_id: string | null }>('SELECT id, name, alt_names_json, state, project_id FROM project_suggestions ORDER BY created_at');
  const match = (r: (typeof all)[number]) => [r.name, ...json<string[]>(r.alt_names_json, [])].some((n) => similarProjectName(n, name));
  if (all.some((r) => r.state === 'rejected' && match(r))) return null;
  // 이미 수락된 제안과 같은 이름 → 그 프로젝트에 바로 붙임
  const accepted = all.find((r) => r.state === 'accepted' && r.project_id && match(r));
  if (accepted) { attachToProject(core, accepted.project_id!, [p.taskId], 'classifier'); return accepted.id; }
  let sug = all.find((r) => r.state === 'pending' && match(r));
  if (!sug) {
    const id = `psg_${randomId(6)}`;
    db.run('INSERT INTO project_suggestions(id,name,norm_name,alt_names_json,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', id, name, normName(name), '[]', 'pending', p.at, p.at);
    sug = { id, name, alt_names_json: '[]', state: 'pending', project_id: null };
  } else if (normName(sug.name) !== normName(name)) {
    const alts = json<string[]>(sug.alt_names_json, []);
    if (!alts.some((a) => normName(a) === normName(name))) db.run('UPDATE project_suggestions SET alt_names_json=? WHERE id=?', JSON.stringify([...alts, name].slice(0, 10)), sug.id);
  }
  db.run('INSERT OR REPLACE INTO project_suggestion_tasks(suggestion_id,task_id,conversation_id,suggested_name,confidence,created_at) VALUES (?,?,?,?,?,?)', sug.id, p.taskId, p.conversationId, name, p.confidence, p.at);
  db.run('UPDATE project_suggestions SET updated_at=? WHERE id=?', p.at, sug.id);
  // L4: ready가 되는 순간 자동 생성(§7.7)
  if (core.settings.get().automation.level === 'L4' && eligibleTaskIds(core, sug.id).length >= MIN) acceptProjectSuggestion(core, sug.id, {}, 'classifier');
  return sug.id;
}

function attachToProject(core: Core, projectId: string, taskIds: string[], actor: 'user' | 'classifier'): string[] {
  const db = core.db;
  const done: string[] = [];
  for (const tid of taskIds) {
    const t = db.get<{ project_id: string | null; overrides_json: string }>('SELECT project_id, overrides_json FROM tasks WHERE id=?', tid);
    if (!t || t.project_id || json<string[]>(t.overrides_json, []).includes('project')) continue;
    db.run('UPDATE tasks SET project_id=?, updated_at=? WHERE id=?', projectId, nowIso(), tid);
    refreshTask(core, tid, actor === 'user' ? 'user' : 'classifier', { silent: true });
    core.vault.scheduleTask(tid);
    done.push(tid);
  }
  if (done.length) core.vault.schedule('project', projectId);
  return done;
}

export function toProjectSuggestion(core: Core, r: Row): ProjectSuggestion {
  const id = String(r.id);
  const state = String(r.state) as ProjectSuggestionState;
  const linked = core.db.all<{ task_id: string }>('SELECT task_id FROM project_suggestion_tasks WHERE suggestion_id=? ORDER BY created_at', id).map((x) => x.task_id);
  const eligible = new Set(eligibleTaskIds(core, id));
  // 대기 중이면 아직 프로젝트가 없는 과제만, 수락됐으면 붙은 과제 전부를 보여준다
  const shown = state === 'pending' ? linked.filter((t) => eligible.has(t)) : linked;
  const tasks = loadTasks(core, { ids: shown }).sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''));
  return {
    id, name: String(r.name), altNames: json<string[]>(r.alt_names_json, []), state, ready: state === 'pending' && eligible.size >= MIN, taskCount: eligible.size, minTasks: MIN,
    tasks: tasks.map((t) => ({ ...toTaskRef(t), sourceAis: primaryAis(t) as SourceAi[] })), projectId: str(r.project_id),
    createdAt: String(r.created_at), updatedAt: String(r.updated_at), decidedAt: str(r.decided_at),
  };
}

export function listProjectSuggestions(core: Core, q: { state?: ProjectSuggestionState; ready?: boolean }): ProjectSuggestion[] {
  const rows = core.db.all('SELECT * FROM project_suggestions WHERE state=? ORDER BY updated_at DESC', q.state ?? 'pending');
  const list = rows.map((r) => toProjectSuggestion(core, r)).filter((s) => (s.state !== 'pending' || s.taskCount > 0) && (q.ready === undefined || s.ready === q.ready));
  return list.sort((a, b) => Number(b.ready) - Number(a.ready) || b.taskCount - a.taskCount || b.updatedAt.localeCompare(a.updatedAt));
}
export function pendingReadyCount(core: Core): number { return listProjectSuggestions(core, { state: 'pending', ready: true }).length; }

export function getProjectSuggestion(core: Core, id: string): ProjectSuggestion {
  const r = core.db.get('SELECT * FROM project_suggestions WHERE id=?', id);
  if (!r) throw notFound('프로젝트 제안', id, 'suggestionId');
  return toProjectSuggestion(core, r);
}

export function acceptProjectSuggestion(core: Core, id: string, body: AcceptProjectSuggestionBody, actor: 'user' | 'classifier' = 'user'): { suggestion: ProjectSuggestion; projectId: string; attachedTaskIds: string[] } {
  const db = core.db;
  return db.tx(() => {
    const r = db.get('SELECT * FROM project_suggestions WHERE id=?', id);
    if (!r) throw notFound('프로젝트 제안', id, 'suggestionId');
    if (String(r.state) !== 'pending') throw conflict(`이미 처리한 제안이에요 (${String(r.state)}).`, { suggestionId: id, state: r.state });
    const name = (body.name ?? String(r.name)).trim();
    const projectId = findProjectByName(core, name) ?? createProject(core, { name, colorHex: body.colorHex });
    const candidates = eligibleTaskIds(core, id);
    const chosen = body.taskIds ? candidates.filter((t) => body.taskIds!.includes(t)) : candidates;
    const attached = attachToProject(core, projectId, chosen, actor);
    const at = nowIso();
    db.run("UPDATE project_suggestions SET state='accepted', project_id=?, decided_at=?, updated_at=? WHERE id=?", projectId, at, at, id);
    addEvent(db, { type: 'suggestion_accepted', actor: actor === 'user' ? 'user' : 'classifier', taskId: attached[0] ?? null, payload: { projectSuggestionId: id, projectId, name, attachedTaskIds: attached } });
    return { suggestion: getProjectSuggestion(core, id), projectId, attachedTaskIds: attached };
  });
}

export function rejectProjectSuggestion(core: Core, id: string, reason?: string): ProjectSuggestion {
  const db = core.db;
  const r = db.get('SELECT * FROM project_suggestions WHERE id=?', id);
  if (!r) throw notFound('프로젝트 제안', id, 'suggestionId');
  if (String(r.state) !== 'pending') throw conflict(`이미 처리한 제안이에요 (${String(r.state)}).`, { suggestionId: id, state: r.state });
  const at = nowIso();
  db.run("UPDATE project_suggestions SET state='rejected', decided_at=?, updated_at=? WHERE id=?", at, at, id);
  addEvent(db, { type: 'suggestion_rejected', actor: 'user', payload: { projectSuggestionId: id, name: r.name, ...(reason ? { reason } : {}) } });
  return getProjectSuggestion(core, id);
}

/**
 * 1.2.0 비슷한 대기 중 제안 합치기. 묶는 기준(하나라도):
 *  - 이름(대표 이름·다른 이름)끼리 similarProjectName
 *  - 같은 과제가 둘 다에 붙어 있음(과제 합치기 뒤 생김) / 같은 대화에서 나온 제안 / 대기·수락된 합치기 제안으로 이어진 과제
 * 남기는 쪽 = 실제 과제가 더 많은 제안(같으면 먼저 만든 것). 나머지 이름은 altNames로, 과제는 남는 쪽으로 옮기고 지운다.
 * 이미 수락된 제안과 비슷한 대기 중 제안은 그 프로젝트에 과제를 붙이고 지운다(거절된 제안과 비슷한 것은 건드리지 않음).
 */
export function consolidateProjectSuggestions(core: Core): { merged: number; attachedToAccepted: number } {
  const db = core.db;
  let merged = 0, attachedToAccepted = 0;
  db.tx(() => {
    type R = { id: string; name: string; alt_names_json: string; state: ProjectSuggestionState; project_id: string | null; created_at: string };
    const rows = db.all<R>("SELECT id, name, alt_names_json, state, project_id, created_at FROM project_suggestions WHERE state IN ('pending','accepted') ORDER BY created_at, id");
    const names = (r: R) => [r.name, ...json<string[]>(r.alt_names_json, [])];
    const tasksOf = new Map(rows.map((r) => [r.id, db.all<{ task_id: string; conversation_id: string | null }>('SELECT task_id, conversation_id FROM project_suggestion_tasks WHERE suggestion_id=?', r.id)]));
    const linkedPairs = new Set(db.all<{ a: string; b: string }>("SELECT task_a AS a, task_b AS b FROM task_merge_suggestions WHERE state IN ('pending','accepted')").flatMap((x) => [`${x.a}|${x.b}`, `${x.b}|${x.a}`]));
    const related = (x: R, y: R) => {
      if (names(x).some((a) => names(y).some((b) => similarProjectName(a, b)))) return true;
      const tx = tasksOf.get(x.id)!, ty = tasksOf.get(y.id)!;
      return tx.some((p) => ty.some((q) => p.task_id === q.task_id || (p.conversation_id && p.conversation_id === q.conversation_id) || linkedPairs.has(`${p.task_id}|${q.task_id}`)));
    };
    const pending = rows.filter((r) => r.state === 'pending');
    const accepted = rows.filter((r) => r.state === 'accepted' && r.project_id);
    const gone = new Set<string>();
    // 1) 수락된 제안과 비슷 → 그 프로젝트로
    for (const p of pending) {
      const acc = accepted.find((a) => related(a, p));
      if (!acc) continue;
      attachedToAccepted += attachToProject(core, acc.project_id!, eligibleTaskIds(core, p.id), 'classifier').length;
      const alts = json<string[]>(acc.alt_names_json, []);
      const add = names(p).filter((n) => normName(n) !== normName(acc.name) && !alts.some((a) => normName(a) === normName(n)));
      if (add.length) { acc.alt_names_json = JSON.stringify([...alts, ...add].slice(0, 10)); db.run('UPDATE project_suggestions SET alt_names_json=? WHERE id=?', acc.alt_names_json, acc.id); }
      db.run('DELETE FROM project_suggestions WHERE id=?', p.id);
      gone.add(p.id); merged++;
    }
    // 2) 대기 중끼리 묶기(union-find)
    const live = pending.filter((p) => !gone.has(p.id));
    const parent = new Map(live.map((p) => [p.id, p.id]));
    const find = (x: string): string => { while (parent.get(x) !== x) x = parent.get(x)!; return x; };
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      if (related(live[i]!, live[j]!)) { const a = find(live[i]!.id), b = find(live[j]!.id); if (a !== b) parent.set(b, a); }
    }
    const groups = new Map<string, R[]>();
    for (const p of live) { const k = find(p.id); groups.set(k, [...(groups.get(k) ?? []), p]); }
    const at = nowIso();
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      const size = (r: R) => eligibleTaskIds(core, r.id).length;
      const keep = [...g].sort((a, b) => size(b) - size(a) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))[0]!;
      let alts = json<string[]>(keep.alt_names_json, []);
      for (const o of g) {
        if (o.id === keep.id) continue;
        for (const n of names(o)) if (normName(n) !== normName(keep.name) && !alts.some((a) => normName(a) === normName(n))) alts.push(n);
        db.run(`INSERT OR IGNORE INTO project_suggestion_tasks(suggestion_id,task_id,conversation_id,suggested_name,confidence,created_at)
          SELECT ?, task_id, conversation_id, suggested_name, confidence, created_at FROM project_suggestion_tasks WHERE suggestion_id=?`, keep.id, o.id);
        db.run('DELETE FROM project_suggestions WHERE id=?', o.id);
        merged++;
      }
      alts = alts.slice(0, 10);
      db.run('UPDATE project_suggestions SET alt_names_json=?, updated_at=? WHERE id=?', JSON.stringify(alts), at, keep.id);
      if (core.settings.get().automation.level === 'L4' && eligibleTaskIds(core, keep.id).length >= MIN) acceptProjectSuggestion(core, keep.id, {}, 'classifier');
    }
  });
  return { merged, attachedToAccepted };
}
