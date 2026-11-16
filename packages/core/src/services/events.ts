import type { EventActor, EventType, TimelineEvent } from '@subbrain/shared';
import type { Db } from '../db/db.ts';
import { nowIso } from '../util/time.ts';

export function addEvent(db: Db, e: { type: EventType; actor: EventActor; taskId?: string | null; conversationId?: string | null; payload?: Record<string, unknown>; at?: string }): TimelineEvent {
  const at = e.at ?? nowIso();
  const payload = e.payload ?? {};
  const r = db.run('INSERT INTO events(at,type,task_id,conversation_id,actor,payload_json) VALUES (?,?,?,?,?,?)', at, e.type, e.taskId ?? null, e.conversationId ?? null, e.actor, JSON.stringify(payload));
  return { id: r.lastInsertRowid, at, type: e.type, taskId: e.taskId ?? null, conversationId: e.conversationId ?? null, actor: e.actor, payload };
}
