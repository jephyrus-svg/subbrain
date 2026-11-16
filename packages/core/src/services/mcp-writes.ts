/**
 * 1.8.0 MCP 쓰기 경로(설계서 5.4 ⑤). MCP 서버는 이 HTTP 엔드포인트만 부른다(DB 직접 안 염 → 쓰기 경로 하나).
 *  - log_task: 짧은 대화(captureMethod mcp, 메모가 본문) + 과제(origin mcp, 상태는 mcp_status). 분류 대기열에 넣지 않음(명시 정보).
 *  - update_task_status: mcp_status·mcp_status_at·next_step. 규칙 엔진 우선순위 2(MCP)로 반영.
 *  - 모두 events(actor mcp)에 이전 값과 함께 남고 POST /mcp/events/:id/undo로 되돌림. 삭제는 없음(기록 되돌리기 = 보관).
 */
import type { McpEventsResponse, McpLogTaskBody, McpLogTaskResponse, McpUndoResponse, McpUpdateTaskStatusBody, McpUpdateTaskStatusResponse, McpWriteEvent, TaskStatus } from '@subbrain/shared';
import type { Core } from '../core.ts';
import { json, str } from '../db/db.ts';
import { ApiError } from '../util/errors.ts';
import { randomId } from '../util/ids.ts';
import { bigrams, dice } from '../util/similarity.ts';
import { nowIso } from '../util/time.ts';
import { addEvent } from './events.ts';
import { upsertConversation } from './imports.ts';
import { normName } from './mutations.ts';
import { refreshTask } from './tasks.ts';
import { taskDetail } from './views.ts';

function resolveProject(core: Core, p: string | null | undefined): string | null {
  if (!p?.trim()) return null;
  const db = core.db;
  const byId = db.value<string>('SELECT id FROM projects WHERE id=?', p);
  if (byId) return byId;
  const n = normName(p);
  for (const r of db.all<{ id: string; name: string; aliases_json: string }>("SELECT id, name, aliases_json FROM projects WHERE status<>'archived'")) {
    if (normName(r.name) === n || json<string[]>(r.aliases_json, []).some((a) => normName(a) === n)) return r.id;
  }
  return null;
}
const detail = (core: Core, id: string) => taskDetail(core, id)!;

export function mcpLogTask(core: Core, b: McpLogTaskBody, tokenId: string | null = null): McpLogTaskResponse {
  const db = core.db;
  const at = nowIso();
  const projectId = resolveProject(core, b.project);
  const r = upsertConversation(core, {
    sourceAi: b.sourceAi, sourceId: `mcp_${randomId(10)}`, title: b.title.trim(), sourceUrl: b.sourceUrl ?? null, createdAt: at, updatedAt: at,
    archived: false, inServiceProject: false, hasUnextractedArtifact: false,
    messages: [{ role: 'user', content: b.note?.trim() || b.title.trim(), createdAt: at }],
  } as never, { importId: null, rawPath: null, captureMethod: 'mcp' });
  const taskId = r.taskId!;
  let eventId = 0;
  db.tx(() => {
    db.run('UPDATE conversations SET classified_hash=content_hash WHERE id=?', r.conversationId); // 분류 대기열에서 뺌
    db.run("UPDATE tasks SET title=?, project_id=COALESCE(?, project_id), origin='mcp', kind='task', mcp_status=?, mcp_status_at=?, next_step=COALESCE(?, next_step), summary=COALESCE(summary, ?) WHERE id=?",
      b.title.trim(), projectId, b.status ?? '진행 중', at, b.nextStep ?? null, b.note?.trim() || null, taskId);
    refreshTask(core, taskId, 'user', { silent: true });
    eventId = addEvent(db, { type: 'task_logged', actor: 'mcp', taskId, conversationId: r.conversationId, payload: { title: b.title, projectId, status: b.status ?? '진행 중', sourceAi: b.sourceAi, nextStep: b.nextStep ?? null, tokenId } }).id;
  });
  return { task: detail(core, taskId), conversationId: r.conversationId, projectMatched: !!projectId || !b.project, eventId };
}

/** 제목 검색: 정규화 포함 일치 > 2-gram 유사도. 1등과 2등이 가까우면 애매(409) */
export function findTaskByQuery(core: Core, q: string): string {
  const n = normName(q), bg = bigrams(q);
  const rows = core.db.all<{ id: string; title: string; last_activity_at: string | null }>("SELECT id, title, last_activity_at FROM tasks WHERE status<>'보관' AND kind='task'");
  const scored = rows.map((r) => ({ ...r, s: normName(r.title) === n ? 2 : normName(r.title).includes(n) && n.length >= 2 ? 1.2 : dice(bg, bigrams(r.title)) }))
    .filter((r) => r.s >= 0.35).sort((a, b) => b.s - a.s || String(b.last_activity_at).localeCompare(String(a.last_activity_at)));
  if (!scored.length) throw new ApiError('NOT_FOUND', `‘${q}’와 맞는 과제를 못 찾았어요.`, { query: q });
  if (scored.length > 1 && scored[0]!.s < 2 && scored[0]!.s - scored[1]!.s < 0.15)
    throw new ApiError('CONFLICT', `‘${q}’와 비슷한 과제가 여러 개예요. taskId로 골라 주세요.`, { query: q, candidates: scored.slice(0, 5).map((r) => ({ id: r.id, title: r.title })) });
  return scored[0]!.id;
}

export function mcpUpdateTaskStatus(core: Core, b: McpUpdateTaskStatusBody, tokenId: string | null = null): McpUpdateTaskStatusResponse {
  const db = core.db;
  const taskId = b.taskId ?? findTaskByQuery(core, b.query!);
  const row = db.get<{ status: TaskStatus; mcp_status: string | null; mcp_status_at: string | null; next_step: string | null }>('SELECT status, mcp_status, mcp_status_at, next_step FROM tasks WHERE id=?', taskId);
  if (!row) throw new ApiError('NOT_FOUND', '과제를 찾을 수 없어요.', { taskId });
  let eventId = 0;
  db.tx(() => {
    db.run('UPDATE tasks SET mcp_status=?, mcp_status_at=?, next_step=CASE WHEN ? THEN ? ELSE next_step END WHERE id=?', b.status, nowIso(), b.nextStep !== undefined ? 1 : 0, b.nextStep ?? null, taskId);
    refreshTask(core, taskId, 'user', { silent: true });
    const to = String(db.value('SELECT status FROM tasks WHERE id=?', taskId));
    eventId = addEvent(db, { type: 'status_changed', actor: 'mcp', taskId, payload: { from: row.status, to, requested: b.status, nextStep: b.nextStep ?? null, prev: { mcpStatus: row.mcp_status, mcpStatusAt: row.mcp_status_at, nextStep: row.next_step }, tokenId } }).id;
  });
  return { task: detail(core, taskId), previousStatus: row.status, eventId };
}

export function mcpEvents(core: Core, limit = 50): McpEventsResponse {
  const rows = core.db.all<{ id: number; at: string; type: string; task_id: string; payload_json: string; title: string | null }>(
    "SELECT e.id, e.at, e.type, e.task_id, e.payload_json, t.title FROM events e LEFT JOIN tasks t ON t.id=e.task_id WHERE e.actor='mcp' AND e.type IN ('task_logged','status_changed') ORDER BY e.id DESC LIMIT ?", limit);
  return {
    items: rows.map((r): McpWriteEvent => {
      const p = json<Record<string, unknown>>(r.payload_json, {});
      const tok = typeof p.tokenId === 'string' ? core.db.get<{ id: string; name: string; kind: string }>('SELECT id, name, kind FROM client_tokens WHERE id=?', p.tokenId) : null;
      return { client: tok ? { tokenId: tok.id, name: tok.name, kind: tok.kind as 'mcp' } : null, id: r.id, at: r.at, type: r.type as McpWriteEvent['type'], taskId: r.task_id, taskTitle: r.title ?? '', undone: !!p.undoneAt, undoneAt: str(p.undoneAt as string),
        summary: r.type === 'task_logged' ? `과제 기록: ${String(p.title)} (${String(p.status)})` : `상태 ${String(p.from)} → ${String(p.to)}${p.nextStep ? ` · 다음: ${String(p.nextStep)}` : ''}` };
    }),
  };
}

export function mcpUndo(core: Core, eventId: number): McpUndoResponse {
  const db = core.db;
  const ev = db.get<{ type: string; task_id: string; actor: string; payload_json: string; conversation_id: string | null }>('SELECT type, task_id, actor, payload_json, conversation_id FROM events WHERE id=?', eventId);
  if (!ev || ev.actor !== 'mcp' || !['task_logged', 'status_changed'].includes(ev.type)) throw new ApiError('NOT_FOUND', '되돌릴 MCP 기록이 없어요.', { eventId });
  const p = json<Record<string, unknown>>(ev.payload_json, {});
  if (p.undoneAt) throw new ApiError('CONFLICT', '이미 되돌린 기록이에요.', { eventId, undoneAt: p.undoneAt });
  if (ev.type === 'status_changed' && db.get("SELECT 1 FROM events WHERE task_id=? AND actor='mcp' AND type='status_changed' AND id>? AND json_extract(payload_json,'$.undoneAt') IS NULL", ev.task_id, eventId))
    throw new ApiError('CONFLICT', '이 과제에 뒤에 바꾼 상태가 있어요. 그것부터 되돌려 주세요.', { eventId });
  let undoEventId = 0;
  db.tx(() => {
    if (ev.type === 'task_logged') {
      // 삭제하지 않고 보관(웹에서 보관 해제 가능)
      db.run("UPDATE tasks SET mcp_status='보관', mcp_status_at=? WHERE id=?", nowIso(), ev.task_id);
      if (ev.conversation_id) db.run("UPDATE conversations SET service_state='archived' WHERE id=?", ev.conversation_id);
    } else {
      const prev = (p.prev ?? {}) as { mcpStatus: string | null; mcpStatusAt: string | null; nextStep: string | null };
      db.run('UPDATE tasks SET mcp_status=?, mcp_status_at=?, next_step=? WHERE id=?', prev.mcpStatus, prev.mcpStatusAt, prev.nextStep, ev.task_id);
    }
    refreshTask(core, ev.task_id, 'user', { silent: true });
    const at = nowIso();
    db.run('UPDATE events SET payload_json=? WHERE id=?', JSON.stringify({ ...p, undoneAt: at }), eventId);
    undoEventId = addEvent(db, { type: 'write_undone', actor: 'user', taskId: ev.task_id, payload: { eventId, type: ev.type } }).id;
  });
  return { undone: true, eventId, undoEventId, task: detail(core, ev.task_id) };
}
