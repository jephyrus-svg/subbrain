/**
 * 1.9.1 개발 전용: 대화 하나를 DB에서 완전히 지움(e2e 찌꺼기 정리). HTTP 삭제 API는 만들지 않는다(삭제는 API 밖, §14).
 *   subbrain dev purge-conversation <conv_id | sourceId> [--dev | --home <dir>]
 * conversation_id 열이 있는 모든 표에서 지우고, 그 대화만 가진 과제는 task_id 열이 있는 모든 표에서 지운다. FTS는 다시 만든다.
 */
import type { Core } from './core.ts';

export function purgeConversation(core: Core, idOrSource: string): { conversationId: string; taskRemoved: string | null; rows: number } {
  const db = core.db;
  const conv = db.get<{ id: string; task_id: string | null }>('SELECT id, task_id FROM conversations WHERE id=? OR source_id=? LIMIT 1', idOrSource, idOrSource);
  if (!conv) throw new Error(`대화를 찾을 수 없어요: ${idOrSource}`);
  const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '%_fts%' AND name NOT LIKE 'sqlite_%'").map((r) => r.name);
  const cols = (t: string) => db.all<{ name: string }>(`PRAGMA table_info(${t})`).map((c) => c.name);
  let rows = 0;
  let taskRemoved: string | null = null;
  db.tx(() => {
    const others = conv.task_id ? Number(db.value('SELECT COUNT(*) FROM task_conversations WHERE task_id=? AND conversation_id<>?', conv.task_id, conv.id) ?? 0) : 1;
    for (const t of tables) if (t !== 'conversations' && cols(t).includes('conversation_id')) rows += db.run(`DELETE FROM ${t} WHERE conversation_id=?`, conv.id).changes;
    rows += db.run('DELETE FROM conversations WHERE id=?', conv.id).changes;
    if (conv.task_id && others === 0) {
      for (const t of tables) if (t !== 'tasks' && cols(t).includes('task_id')) rows += db.run(`DELETE FROM ${t} WHERE task_id=?`, conv.task_id).changes;
      rows += db.run("DELETE FROM objects WHERE ref_table='tasks' AND ref_id=?", conv.task_id).changes;
      rows += db.run('DELETE FROM tasks WHERE id=?', conv.task_id).changes;
      taskRemoved = conv.task_id;
    }
    for (const f of ['messages_fts', 'tasks_fts', 'conversations_fts']) db.exec(`INSERT INTO ${f}(${f}) VALUES('rebuild')`);
  });
  return { conversationId: conv.id, taskRemoved, rows };
}
