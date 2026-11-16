/**
 * 1.7.0 온톨로지 저장(설계서 8.4–8.6). 객체·관계·별칭·출처·제안·이벤트.
 *  - 엔터티 해소: 같은 타입에서 norm_name 또는 별칭이 같으면 같은 객체(합쳐진 객체는 merged_into를 따라감).
 *    이름이 비슷하면(2-gram Dice ≥ 0.75) 새로 만들되 합치기 제안.
 *  - 확신도: ≥ 0.85 자동 확정, 0.6–0.85 제안, < 0.6 버림. 처음 보는 사람·supersedes·합치기는 늘 제안.
 *    다른 대화에서 다시 나오면 확신도 +0.1(최대 0.95) → 기준을 넘으면 자동 확정(보호 대상 제외).
 *  - 거절 기억: 거절한 객체(타입+이름)·관계(타입+양끝)는 다시 만들지 않는다.
 */
import type { LinkType, ObjectType, OntologyOrigin } from '@subbrain/shared';
import type { Core } from '../core.ts';
import type { Db, Row } from '../db/db.ts';
import { normName } from '../services/mutations.ts';
import { randomId } from '../util/ids.ts';
import { bigrams, dice } from '../util/similarity.ts';
import { nowIso } from '../util/time.ts';

export const ACCEPT_AT = 0.85;
export const SUGGEST_AT = 0.6;
export const REPEAT_BUMP = 0.1;

/** 허용 시작·끝 타입 쌍(8.3). 안 맞으면 related_to로 낮춤 */
export const ALLOWED: Record<LinkType, Array<[ObjectType[], ObjectType[]]>> = {
  uses: [[['task', 'project', 'person'], ['tool', 'artifact']]],
  decided: [[['person', 'task'], ['decision']]],
  blocked_by: [[['task'], ['task', 'decision', 'person', 'organization', 'artifact']]],
  derived_from: [[['task', 'decision', 'artifact'], ['task', 'decision', 'artifact']]],
  references: [[['task', 'decision'], ['artifact']]],
  part_of: [[['task'], ['project']], [['person'], ['organization']], [['project'], ['project']]],
  supersedes: [[['decision'], ['decision']], [['tool'], ['tool']]],
  affects: [[['decision'], ['task', 'project']]],
  located_at: [[['task', 'organization', 'person'], ['place']]],
  related_to: [],
};
export function allowedPair(type: LinkType, src: ObjectType, dst: ObjectType): boolean {
  if (type === 'related_to') return true;
  return ALLOWED[type].some(([a, b]) => a.includes(src) && b.includes(dst));
}

export interface EvidenceIn { conversationId: string | null; messageSeq?: number | null; excerpt: string; confidence: number | null; model: string; promptVersion?: string | null; at?: string | null }

export function typeEnabled(db: Db, type: ObjectType): boolean { return Number(db.value('SELECT enabled FROM object_types WHERE key=?', type) ?? 0) === 1; }

/** 합쳐진 객체면 최종 객체 id */
export function canonical(db: Db, id: string): string {
  let cur = id;
  for (let i = 0; i < 10; i++) {
    const r = db.get<{ status: string; merged_into: string | null }>('SELECT status, merged_into FROM objects WHERE id=?', cur);
    if (!r || r.status !== 'merged' || !r.merged_into) return cur;
    cur = r.merged_into;
  }
  return cur;
}
export function findObject(db: Db, type: ObjectType, name: string): string | null {
  const nn = normName(name);
  if (!nn) return null;
  const r = db.get<{ id: string }>("SELECT id FROM objects WHERE type=? AND norm_name=? AND status<>'rejected' ORDER BY (status='merged'), mention_count DESC LIMIT 1", type, nn)
    ?? db.get<{ id: string }>("SELECT o.id FROM aliases a JOIN objects o ON o.id=a.object_id WHERE o.type=? AND a.norm_alias=? AND o.status<>'rejected' ORDER BY (o.status='merged') LIMIT 1", type, nn);
  return r ? canonical(db, r.id) : null;
}
const rejectedKey = (db: Db, key: string) => !!db.get('SELECT 1 FROM ontology_rejections WHERE key=?', key);
export const objKey = (type: string, name: string) => `o|${type}|${normName(name)}`;
export const linkKey = (type: string, src: string, dst: string) => `l|${type}|${src}|${dst}`;

function addAliases(db: Db, objectId: string, aliases: string[], source: string): void {
  const own = String(db.value('SELECT norm_name FROM objects WHERE id=?', objectId) ?? '');
  for (const a of aliases) {
    const na = normName(a);
    if (!na || na === own) continue;
    db.run('INSERT OR IGNORE INTO aliases(object_id,alias,norm_alias,source) VALUES (?,?,?,?)', objectId, a.trim().slice(0, 80), na, source);
  }
}

/** 출처 추가(같은 대상·대화·모델 종류면 덮어씀) → 언급 수 = 서로 다른 대화 수 */
export function addEvidence(db: Db, kind: 'object' | 'link', targetId: string, e: EvidenceIn): void {
  const fam = e.model === 'rule' ? 'rule' : e.model === 'user' ? 'user' : 'llm';
  const famSql = "CASE WHEN model='rule' THEN 'rule' WHEN model='user' THEN 'user' ELSE 'llm' END";
  const ex = e.conversationId ? db.get<{ id: number }>(`SELECT id FROM evidence WHERE target_kind=? AND target_id=? AND conversation_id=? AND ${famSql}=?`, kind, targetId, e.conversationId, fam) : null;
  const at = e.at ?? nowIso();
  const msgId = e.conversationId && e.messageSeq != null ? db.value<number>('SELECT id FROM messages WHERE conversation_id=? AND seq=?', e.conversationId, e.messageSeq) ?? null : null;
  if (ex) db.run('UPDATE evidence SET excerpt=?, confidence=?, model=?, prompt_version=?, extracted_at=?, message_id=? WHERE id=?', e.excerpt.slice(0, 300), e.confidence, e.model, e.promptVersion ?? null, at, msgId, ex.id);
  else db.run('INSERT INTO evidence(target_kind,target_id,conversation_id,message_id,excerpt,confidence,model,prompt_version,extracted_at) VALUES (?,?,?,?,?,?,?,?,?)',
    kind, targetId, e.conversationId, msgId, e.excerpt.slice(0, 300), e.confidence, e.model, e.promptVersion ?? null, at);
  const n = Number(db.value('SELECT COUNT(DISTINCT conversation_id) FROM evidence WHERE target_kind=? AND target_id=?', kind, targetId) ?? 0);
  if (kind === 'object') db.run('UPDATE objects SET mention_count=MAX(mention_count, ?) WHERE id=?', n, targetId);
  else db.run('UPDATE links SET mention_count=MAX(mention_count, ?) WHERE id=?', n, Number(targetId));
}

export function createSuggestion(db: Db, s: { kind: 'object' | 'link' | 'merge'; objectId?: string | null; linkId?: number | null; keepId?: string; mergeId?: string; confidence: number; reason: string; note?: string | null }): string | null {
  if (s.kind === 'merge') {
    if (db.get("SELECT 1 FROM ontology_suggestions WHERE kind='merge' AND ((keep_id=? AND merge_id=?) OR (keep_id=? AND merge_id=?))", s.keepId, s.mergeId, s.mergeId, s.keepId)) return null;
    if (rejectedKey(db, `m|${[s.keepId, s.mergeId].sort().join('|')}`)) return null;
  } else if (db.get(`SELECT 1 FROM ontology_suggestions WHERE kind=? AND state='pending' AND ${s.kind === 'object' ? 'object_id=?' : 'link_id=?'}`, s.kind, s.kind === 'object' ? s.objectId : s.linkId)) return null;
  const id = `osg_${randomId(6)}`;
  db.run('INSERT INTO ontology_suggestions(id,kind,object_id,link_id,keep_id,merge_id,confidence,reason,note,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    id, s.kind, s.objectId ?? null, s.linkId ?? null, s.keepId ?? null, s.mergeId ?? null, s.confidence, s.reason, s.note ?? null, 'pending', nowIso());
  return id;
}

export interface EnsureObjectIn {
  type: ObjectType; name: string; aliases?: string[]; properties?: Record<string, string | number | boolean>;
  confidence: number; origin: OntologyOrigin; ref?: { table: string; id: string } | null; evidence?: EvidenceIn | null; existingId?: string | null;
  /** 규칙이 만드는 과제·프로젝트 객체처럼 늘 확정 */
  forceAccept?: boolean;
}
/** 객체 찾기/만들기. 버려지면(확신도 낮음·거절 기억·꺼진 타입) null */
export function ensureObject(db: Db, o: EnsureObjectIn): { id: string; created: boolean } | null {
  const name = o.name.trim().slice(0, 80);
  if (!name) return null;
  const at = o.evidence?.at ?? nowIso();
  let id: string | null = null;
  if (o.existingId) { const r = db.get<{ type: string }>('SELECT type FROM objects WHERE id=?', o.existingId); if (r && r.type === o.type) id = canonical(db, o.existingId); }
  if (!id && o.ref) id = db.value<string>("SELECT id FROM objects WHERE type=? AND ref_table=? AND ref_id=? AND status<>'merged' LIMIT 1", o.type, o.ref.table, o.ref.id) ?? null;
  if (!id) id = findObject(db, o.type, name);
  if (id) {
    const cur = db.get<{ status: string; confidence: number | null; origin: string | null }>('SELECT status, confidence, origin FROM objects WHERE id=?', id)!;
    if (o.aliases?.length) addAliases(db, id, o.aliases, o.origin);
    db.run('UPDATE objects SET last_seen_at=MAX(COALESCE(last_seen_at,?), ?), first_seen_at=MIN(COALESCE(first_seen_at,?), ?) WHERE id=?', at, at, at, at, id);
    if (o.properties && Object.keys(o.properties).length) {
      const prev = JSON.parse(String(db.value('SELECT properties_json FROM objects WHERE id=?', id) ?? '{}') || '{}') as Record<string, unknown>;
      db.run('UPDATE objects SET properties_json=? WHERE id=?', JSON.stringify({ ...o.properties, ...prev }), id); // 기존 값(사용자 수정 포함) 우선
    }
    if (o.evidence) {
      const isNewConv = o.evidence.conversationId && !db.get('SELECT 1 FROM evidence WHERE target_kind=? AND target_id=? AND conversation_id=?', 'object', id, o.evidence.conversationId);
      addEvidence(db, 'object', id, o.evidence);
      if (isNewConv && cur.status === 'suggested' && cur.origin !== 'user') {
        const c = Math.min(0.95, Math.max(cur.confidence ?? 0, o.confidence) + REPEAT_BUMP);
        db.run('UPDATE objects SET confidence=? WHERE id=?', c, id);
        if (c >= ACCEPT_AT && o.type !== 'person') { db.run("UPDATE objects SET status='accepted' WHERE id=?", id); db.run("UPDATE ontology_suggestions SET state='accepted', decided_at=? WHERE kind='object' AND object_id=? AND state='pending'", nowIso(), id); }
      }
    }
    if (o.forceAccept && cur.status === 'suggested') db.run("UPDATE objects SET status='accepted' WHERE id=?", id);
    return { id, created: false };
  }
  if (rejectedKey(db, objKey(o.type, name))) return null;
  if (!o.forceAccept && o.confidence < SUGGEST_AT) return null;
  const firstPerson = o.type === 'person';
  const status = o.forceAccept || (o.confidence >= ACCEPT_AT && !firstPerson) ? 'accepted' : 'suggested';
  id = `obj_${o.type}_${randomId(6)}`;
  db.run('INSERT INTO objects(id,type,name,norm_name,ref_table,ref_id,properties_json,status,confidence,first_seen_at,last_seen_at,mention_count,origin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, o.type, name, normName(name), o.ref?.table ?? null, o.ref?.id ?? null, JSON.stringify(o.properties ?? {}), status, o.origin === 'user' ? null : o.confidence, at, at, 0, o.origin);
  if (o.aliases?.length) addAliases(db, id, o.aliases, o.origin);
  if (o.evidence) addEvidence(db, 'object', id, o.evidence);
  if (status === 'suggested') createSuggestion(db, { kind: 'object', objectId: id, confidence: o.confidence, reason: firstPerson ? 'first_seen_person' : 'mid_confidence', note: firstPerson ? '처음 보는 사람이라 확신도와 상관없이 제안으로 둠' : null });
  // 이름이 비슷한 같은 타입 객체 → 합치기 제안(자동으로 합치지 않음)
  if (!o.ref) {
    const bg = bigrams(name);
    for (const r of db.all<{ id: string; name: string; first_seen_at: string | null }>("SELECT id, name, first_seen_at FROM objects WHERE type=? AND id<>? AND status IN ('accepted','suggested')", o.type, id)) {
      const sim = dice(bg, bigrams(r.name));
      if (sim >= 0.75) { createSuggestion(db, { kind: 'merge', keepId: r.id, mergeId: id, confidence: Math.round(sim * 100) / 100, reason: 'merge_candidate', note: `이름이 비슷함(${Math.round(sim * 100)}%)` }); break; }
    }
  }
  return { id, created: true };
}

export interface UpsertLinkIn {
  type: LinkType; srcId: string; dstId: string; confidence: number; origin: OntologyOrigin; evidence?: EvidenceIn | null;
  properties?: Record<string, string>; ended?: boolean; forceAccept?: boolean;
}
/** 관계 찾기/만들기. 허용 안 되는 쌍은 related_to로 낮춤. 버려지면 null */
export function upsertLink(db: Db, l: UpsertLinkIn): { id: number; created: boolean } | null {
  const src = canonical(db, l.srcId), dst = canonical(db, l.dstId);
  if (src === dst) return null;
  const st = db.get<{ type: ObjectType; status: string }>('SELECT type, status FROM objects WHERE id=?', src), dt = db.get<{ type: ObjectType; status: string }>('SELECT type, status FROM objects WHERE id=?', dst);
  if (!st || !dt || st.status === 'rejected' || dt.status === 'rejected') return null;
  let type = l.type;
  if (!allowedPair(type, st.type, dt.type)) type = 'related_to';
  const at = l.evidence?.at ?? nowIso();
  const cur = db.get<{ id: number; status: string; confidence: number | null; origin: string | null; ended_at: string | null }>('SELECT id, status, confidence, origin, ended_at FROM links WHERE type=? AND src_id=? AND dst_id=?', type, src, dst)
    ?? (type === 'related_to' ? db.get<{ id: number; status: string; confidence: number | null; origin: string | null; ended_at: string | null }>('SELECT id, status, confidence, origin, ended_at FROM links WHERE type=? AND src_id=? AND dst_id=?', type, dst, src) : undefined);
  if (cur) {
    if (cur.status === 'rejected') return null;
    db.run('UPDATE links SET last_seen_at=MAX(COALESCE(last_seen_at,?), ?) WHERE id=?', at, at, cur.id);
    if (l.ended && !cur.ended_at) db.run('UPDATE links SET ended_at=? WHERE id=?', at, cur.id);
    if (l.evidence) {
      const isNewConv = l.evidence.conversationId && !db.get('SELECT 1 FROM evidence WHERE target_kind=? AND target_id=? AND conversation_id=?', 'link', String(cur.id), l.evidence.conversationId);
      addEvidence(db, 'link', String(cur.id), l.evidence);
      if (isNewConv && cur.status === 'suggested' && cur.origin !== 'user') {
        const c = Math.min(0.95, Math.max(cur.confidence ?? 0, l.confidence) + REPEAT_BUMP);
        db.run('UPDATE links SET confidence=? WHERE id=?', c, cur.id);
        if (c >= ACCEPT_AT && type !== 'supersedes') { db.run("UPDATE links SET status='accepted' WHERE id=?", cur.id); db.run("UPDATE ontology_suggestions SET state='accepted', decided_at=? WHERE kind='link' AND link_id=? AND state='pending'", nowIso(), cur.id); }
      }
    }
    if (l.forceAccept && cur.status !== 'accepted') db.run("UPDATE links SET status='accepted' WHERE id=?", cur.id);
    return { id: cur.id, created: false };
  }
  if (db.get('SELECT 1 FROM ontology_rejections WHERE key=?', linkKey(type, src, dst))) return null;
  if (!l.forceAccept && l.confidence < SUGGEST_AT) return null;
  const protectedType = type === 'supersedes';
  const endsSuggested = st.status === 'suggested' || dt.status === 'suggested';
  const status = l.forceAccept || (l.confidence >= ACCEPT_AT && !protectedType && !endsSuggested) ? 'accepted' : 'suggested';
  const r = db.run('INSERT INTO links(type,src_id,dst_id,properties_json,status,confidence,valid_from,ended_at,first_seen_at,last_seen_at,origin,mention_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,0)',
    type, src, dst, JSON.stringify(l.properties ?? {}), status, l.origin === 'user' ? null : l.confidence, at, l.ended ? at : null, at, at, l.origin);
  const id = Number(r.lastInsertRowid);
  if (l.evidence) addEvidence(db, 'link', String(id), l.evidence);
  if (status === 'suggested') {
    // 끝 객체가 제안이면 그 객체 제안에 묶는다(관계를 확정하면 객체도 확정)
    const reason = protectedType ? 'supersedes' : dt.type === 'person' && dt.status === 'suggested' ? 'first_seen_person' : 'mid_confidence';
    createSuggestion(db, { kind: 'link', linkId: id, confidence: l.confidence, reason, note: protectedType ? '대체 관계는 확신도와 상관없이 제안으로 둠' : null });
  }
  return { id, created: true };
}

// ── 이벤트(되돌리기): 바뀌기 전 행을 통째로 저장해 두고 되돌릴 때 다시 넣는다
export interface Snapshot { objects: Row[]; aliases: Row[]; links: Row[]; evidence: Row[]; suggestions: Row[]; taskTopics: Row[]; rejections: Row[] }
export function snapshot(db: Db, objectIds: string[], linkIds: number[] = []): Snapshot {
  const oj = JSON.stringify(objectIds);
  const links = db.all(`SELECT * FROM links WHERE src_id IN (SELECT value FROM json_each(?)) OR dst_id IN (SELECT value FROM json_each(?)) OR id IN (SELECT value FROM json_each(?))`, oj, oj, JSON.stringify(linkIds));
  const lj = JSON.stringify(links.map((l) => String(l.id)));
  return {
    objects: db.all('SELECT * FROM objects WHERE id IN (SELECT value FROM json_each(?))', oj),
    aliases: db.all('SELECT * FROM aliases WHERE object_id IN (SELECT value FROM json_each(?))', oj),
    links,
    evidence: db.all("SELECT * FROM evidence WHERE (target_kind='object' AND target_id IN (SELECT value FROM json_each(?))) OR (target_kind='link' AND target_id IN (SELECT value FROM json_each(?)))", oj, lj),
    suggestions: db.all('SELECT * FROM ontology_suggestions WHERE object_id IN (SELECT value FROM json_each(?)) OR keep_id IN (SELECT value FROM json_each(?)) OR merge_id IN (SELECT value FROM json_each(?)) OR link_id IN (SELECT value FROM json_each(?))', oj, oj, oj, JSON.stringify(links.map((l) => Number(l.id)))),
    taskTopics: db.all('SELECT * FROM task_topics WHERE topic_id IN (SELECT value FROM json_each(?))', oj),
    rejections: [],
  };
}
export function recordEvent(db: Db, kind: string, before: Snapshot, extra: { objectIds: string[]; linkIds: number[]; createdObjectIds?: string[]; createdLinkIds?: number[]; rejectionKeys?: string[]; payload?: unknown }): number {
  const r = db.run('INSERT INTO ontology_events(at,kind,payload_json) VALUES (?,?,?)', nowIso(), kind, JSON.stringify({ before, ...extra }));
  return Number(r.lastInsertRowid);
}
function reinsert(db: Db, table: string, rows: Row[]): void {
  for (const r of rows) {
    const cols = Object.keys(r);
    db.run(`INSERT OR REPLACE INTO ${table}(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((c) => r[c] as never));
  }
}
export function undoEvent(core: Core, eventId: number): { undone: boolean; objectIds: string[]; linkIds: string[] } {
  const db = core.db;
  const ev = db.get<{ payload_json: string; undone_at: string | null }>('SELECT payload_json, undone_at FROM ontology_events WHERE id=?', eventId);
  if (!ev || ev.undone_at) return { undone: false, objectIds: [], linkIds: [] };
  const p = JSON.parse(ev.payload_json) as { before: Snapshot; objectIds: string[]; linkIds: number[]; createdObjectIds?: string[]; createdLinkIds?: number[]; rejectionKeys?: string[] };
  db.tx(() => {
    for (const id of p.createdLinkIds ?? []) { db.run("DELETE FROM evidence WHERE target_kind='link' AND target_id=?", String(id)); db.run('DELETE FROM links WHERE id=?', id); }
    for (const id of p.createdObjectIds ?? []) {
      db.run("DELETE FROM evidence WHERE target_kind='object' AND target_id=?", id);
      for (const l of db.all<{ id: number }>('SELECT id FROM links WHERE src_id=? OR dst_id=?', id, id)) { db.run("DELETE FROM evidence WHERE target_kind='link' AND target_id=?", String(l.id)); db.run('DELETE FROM links WHERE id=?', l.id); }
      db.run('DELETE FROM aliases WHERE object_id=?', id); db.run('DELETE FROM task_topics WHERE topic_id=?', id); db.run('DELETE FROM objects WHERE id=?', id);
    }
    for (const k of p.rejectionKeys ?? []) db.run('DELETE FROM ontology_rejections WHERE key=?', k);
    const b = p.before;
    const oj = JSON.stringify(b.objects.map((o) => o.id));
    db.run('DELETE FROM aliases WHERE object_id IN (SELECT value FROM json_each(?))', oj);
    // 지금 이 객체들을 가리키는 관계 중 예전에 없던 것(옮겨 온 관계)은 지우지 않고, 예전 행으로 덮어씀
    reinsert(db, 'objects', b.objects); reinsert(db, 'aliases', b.aliases); reinsert(db, 'links', b.links);
    reinsert(db, 'evidence', b.evidence); reinsert(db, 'ontology_suggestions', b.suggestions); reinsert(db, 'task_topics', b.taskTopics);
    db.run('UPDATE ontology_events SET undone_at=? WHERE id=?', nowIso(), eventId);
  });
  return { undone: true, objectIds: p.objectIds, linkIds: p.linkIds.map((n) => `lnk_${n}`) };
}
