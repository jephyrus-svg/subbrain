/** 1.7.0 온톨로지 API(계약 §14.2) — 보기·질의·액션 */
import type {
  AcceptSuggestionResponse, BulkAcceptSuggestionsBody, BulkAcceptSuggestionsResponse, EndLinkBody, EndLinkResponse, GraphPathResponse, ImpactResponse, LinkType,
  ListObjectsResponse, ListSuggestionsResponse, MergeObjectResponse, ObjectDetail, ObjectRef, ObjectType, OntologyEvidence, OntologyGraphResponse, OntologyLink,
  OntologyObject, OntologyStatus, OntologySuggestion, PatchObjectBody, RejectSuggestionResponse, SimilarResponse, SourceAi, SplitObjectBody, SplitObjectResponse,
  StatusVisual, TaskStatus, UndoOntologyResponse, WhyStalledResponse,
} from '@subbrain/shared';
import { LINK_TYPE_META } from '@subbrain/shared/constants';
import type { Core } from '../core.ts';
import { json, str, type Db, type Row } from '../db/db.ts';
import { normName } from '../services/mutations.ts';
import { loadTasks, toTaskRef, type TaskFull } from '../services/tasks.ts';
import { ApiError } from '../util/errors.ts';
import { decodeCursor, encodeCursor } from '../util/ids.ts';
import { bigrams, dice } from '../util/similarity.ts';
import { kstDate, nowIso, today, weekStart } from '../util/time.ts';
import { canonical, linkKey, objKey, recordEvent, snapshot, undoEvent, upsertLink } from './store.ts';
import { L, statusLabel } from '../util/lang.ts';

const LINK_LABEL_EN: Record<string, string> = { uses: 'uses', decided: 'decided', blocked_by: 'blocked by', part_of: 'part of', related_to: 'related to', affects: 'affects',
  references: 'references', located_at: 'located at', derived_from: 'derived from', supersedes: 'supersedes' };
const LINK_LABEL_ = () => (Object.fromEntries(LINK_TYPE_META.map((l) => [l.key, L(l.labelKo, LINK_LABEL_EN[l.key] ?? l.key)])) as Record<LinkType, string>);
const TYPE_LABEL_ = (): Record<ObjectType, string> => ({ person: L('사람', 'Person'), project: L('프로젝트', 'Project'), task: L('과제', 'Task'), decision: L('결정', 'Decision'), tool: L('도구', 'Tool'), artifact: L('자료', 'File'), place: L('장소', 'Place'), organization: L('조직', 'Organization'), topic: L('주제', 'Topic') });
export const linkIdOf = (n: number | string) => `lnk_${n}`;
export function parseLinkId(id: string): number {
  const m = /^lnk_(\d+)$/.exec(id) ?? /^(\d+)$/.exec(id);
  if (!m) throw new ApiError('NOT_FOUND', L('관계를 찾을 수 없어요.', 'Relation not found.'), { linkId: id });
  return Number(m[1]);
}

// ── 보기 만들기
interface Ctx { tasks: Map<string, TaskFull>; projects: Map<string, { color: string; name: string; status: string }>; evidence: Map<string, OntologyEvidence[]>; projectOf: Map<string, string | null> }
function evidenceRows(db: Db, kind: 'object' | 'link', ids: string[], perTarget: number): Map<string, OntologyEvidence[]> {
  const m = new Map<string, OntologyEvidence[]>();
  if (!ids.length) return m;
  const rows = db.all(`SELECT e.*, c.source_ai, c.title AS conv_title, c.updated_at AS conv_at, ms.seq AS msg_seq, ms.created_at AS msg_at FROM evidence e
    LEFT JOIN conversations c ON c.id=e.conversation_id LEFT JOIN messages ms ON ms.id=e.message_id
    WHERE e.target_kind=? AND e.target_id IN (SELECT value FROM json_each(?)) ORDER BY COALESCE(ms.created_at, e.extracted_at) DESC, e.id DESC`, kind, JSON.stringify(ids));
  for (const r of rows) {
    const k = String(r.target_id);
    let a = m.get(k); if (!a) m.set(k, (a = []));
    if (a.length >= perTarget || !r.conversation_id) continue;
    a.push(evRow(r));
  }
  return m;
}
const evRow = (r: Row): OntologyEvidence => ({
  id: Number(r.id), conversationId: String(r.conversation_id), sourceAi: String(r.source_ai ?? 'chatgpt') as SourceAi, conversationTitle: String(r.conv_title ?? ''),
  messageSeq: r.msg_seq == null ? null : Number(r.msg_seq), excerpt: String(r.excerpt ?? ''), at: String(r.msg_at ?? r.extracted_at ?? r.conv_at ?? nowIso()),
  confidence: r.confidence == null ? null : Number(r.confidence), model: str(r.model),
});

function buildCtx(core: Core, objRows: Row[], linkRows: Row[]): Ctx {
  const db = core.db;
  const taskIds = objRows.filter((o) => o.type === 'task' && o.ref_table === 'tasks').map((o) => String(o.ref_id));
  const tasks = new Map(loadTasks(core, { ids: taskIds }).map((t) => [t.id, t]));
  const projects = new Map(db.all<{ id: string; color: string; name: string; status: string }>('SELECT id, color, name, status FROM projects').map((p) => [p.id, p]));
  const evidence = evidenceRows(db, 'object', objRows.map((o) => String(o.id)), 3);
  // 프로젝트 객체: 과제는 part_of, 나머지는 이어진 과제들의 가장 많은 프로젝트
  const projOfTask = new Map<string, string>();
  for (const l of db.all<{ src_id: string; dst_id: string }>("SELECT src_id, dst_id FROM links WHERE type='part_of' AND status='accepted' AND ended_at IS NULL AND dst_id IN (SELECT id FROM objects WHERE type='project')")) projOfTask.set(l.src_id, l.dst_id);
  const projectOf = new Map<string, string | null>();
  const votes = new Map<string, Map<string, number>>();
  for (const l of linkRows) {
    for (const [a, b] of [[String(l.src_id), String(l.dst_id)], [String(l.dst_id), String(l.src_id)]] as const) {
      const p = projOfTask.get(b);
      if (!p) continue;
      let v = votes.get(a); if (!v) votes.set(a, (v = new Map()));
      v.set(p, (v.get(p) ?? 0) + 1);
    }
  }
  for (const o of objRows) {
    const id = String(o.id);
    if (o.type === 'project') { projectOf.set(id, null); continue; }
    if (projOfTask.has(id)) { projectOf.set(id, projOfTask.get(id)!); continue; }
    const v = votes.get(id);
    projectOf.set(id, v ? [...v].sort((a, b) => b[1] - a[1])[0]![0] : null);
  }
  return { tasks, projects, evidence, projectOf };
}
const STATUS_KO: Record<string, string> = { active: '진행 중', paused: '멈춤', done: '완료', archived: '보관' };
const STATUS_EN_P: Record<string, string> = { active: 'Active', paused: 'Paused', done: 'Done', archived: 'Archived' };
function objectView(db: Db, r: Row, ctx: Ctx, aliases: Map<string, string[]>): OntologyObject {
  const id = String(r.id), type = String(r.type) as ObjectType;
  const t = type === 'task' && r.ref_table === 'tasks' ? ctx.tasks.get(String(r.ref_id)) ?? null : null;
  const p = type === 'project' && r.ref_table === 'projects' ? ctx.projects.get(String(r.ref_id)) ?? null : null;
  let properties = json<Record<string, string | number | boolean>>(r.properties_json, {});
  if (type === 'decision') properties = Object.fromEntries(Object.entries(properties).filter(([k]) => !['conversationId', 'sourceAi', 'decidedAt', 'valid', 'overridden'].includes(k))); // 분류기 내부 사본
  if (t) properties = { ...properties, [L('상태', 'Status')]: statusLabel(t.status) };
  if (p) { const n = Number(db.value("SELECT COUNT(*) FROM tasks WHERE project_id=? AND kind='task' AND status<>'보관'", String(r.ref_id)) ?? 0); properties = { [L('상태', 'Status')]: L(STATUS_KO[p.status] ?? p.status, STATUS_EN_P[p.status] ?? p.status), [L('과제', 'Tasks')]: L(`${n}개`, String(n)), ...properties }; }
  const refTable = (type === 'project' || type === 'task' || type === 'topic') && r.ref_table ? String(r.ref_table) as 'projects' | 'tasks' | 'topics' : type === 'topic' ? 'topics' : null;
  return {
    id, type, name: String(r.name), aliases: aliases.get(id) ?? [], status: String(r.status) as OntologyStatus,
    confidence: r.confidence == null ? null : Number(r.confidence), origin: (str(r.origin) ?? 'rule') as OntologyObject['origin'],
    firstSeenAt: String(r.first_seen_at ?? t?.startedAt ?? nowIso()), lastSeenAt: String(r.last_seen_at ?? t?.lastActivityAt ?? r.first_seen_at ?? nowIso()),
    mentionCount: Number(r.mention_count ?? 0), properties,
    ref: refTable ? { table: refTable, id: refTable === 'topics' ? id : String(r.ref_id) } : null,
    projectObjectId: ctx.projectOf.get(id) ?? null, colorHex: p ? p.color : null,
    statusVisual: t ? (t.stale.statusVisual as StatusVisual) : null, badge: t ? t.stale.badge : null,
    mergedInto: str(r.merged_into), evidencePreview: ctx.evidence.get(id) ?? [],
  };
}
function aliasMap(db: Db, ids: string[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const a of db.all<{ object_id: string; alias: string }>('SELECT object_id, alias FROM aliases WHERE object_id IN (SELECT value FROM json_each(?)) ORDER BY alias', JSON.stringify(ids))) {
    let x = m.get(a.object_id); if (!x) m.set(a.object_id, (x = []));
    x.push(a.alias);
  }
  return m;
}
export function linkViews(db: Db, rows: Row[]): OntologyLink[] {
  const ev = evidenceRows(db, 'link', rows.map((r) => String(r.id)), 1);
  return rows.map((r) => ({
    id: linkIdOf(Number(r.id)), type: String(r.type) as LinkType, srcId: String(r.src_id), dstId: String(r.dst_id), status: String(r.status) as OntologyLink['status'],
    confidence: r.confidence == null ? null : Number(r.confidence), origin: (str(r.origin) ?? 'rule') as OntologyLink['origin'], mentionCount: Math.max(1, Number(r.mention_count ?? 1)),
    validFrom: str(r.valid_from), endedAt: str(r.ended_at), firstSeenAt: String(r.first_seen_at ?? r.valid_from ?? nowIso()), lastSeenAt: String(r.last_seen_at ?? r.first_seen_at ?? nowIso()),
    properties: json<Record<string, string>>(r.properties_json, {}), evidencePreview: ev.get(String(r.id))?.[0] ?? null,
  }));
}
export function objectViews(core: Core, rows: Row[], linkRows: Row[] = []): OntologyObject[] {
  const ctx = buildCtx(core, rows, linkRows);
  const al = aliasMap(core.db, rows.map((r) => String(r.id)));
  return rows.map((r) => objectView(core.db, r, ctx, al));
}
const refOf = (r: { id: string; type: string; name: string }): ObjectRef => ({ id: r.id, type: r.type as ObjectType, label: r.name });
function objRow(db: Db, id: string): Row {
  const r = db.get('SELECT * FROM objects WHERE id=?', id);
  if (!r) throw new ApiError('NOT_FOUND', L('객체를 찾을 수 없어요.', 'Object not found.'), { objectId: id });
  return r;
}

// ── 제안
function suggestionView(db: Db, r: Row): OntologySuggestion | null {
  const kind = String(r.kind) as OntologySuggestion['kind'];
  const o = (id: string | null) => (id ? db.get<{ id: string; type: string; name: string }>('SELECT id, type, name FROM objects WHERE id=?', id) : undefined);
  let src: ObjectRef | null = null, dst: ObjectRef | null = null, linkType: LinkType | null = null, text = '', evTargets: Array<['object' | 'link', string]> = [];
  if (kind === 'link') {
    const l = db.get<{ id: number; type: LinkType; src_id: string; dst_id: string }>('SELECT id, type, src_id, dst_id FROM links WHERE id=?', Number(r.link_id));
    if (!l) return null;
    const a = o(l.src_id), b = o(l.dst_id);
    if (!a || !b) return null;
    src = refOf(a); dst = refOf(b); linkType = l.type;
    text = `[${TYPE_LABEL_()[src.type]}] ${src.label} —${LINK_LABEL_()[l.type]}→ [${TYPE_LABEL_()[dst.type]}] ${dst.label}`;
    evTargets = [['link', String(l.id)]];
  } else if (kind === 'object') {
    const a = o(str(r.object_id));
    if (!a) return null;
    src = refOf(a);
    text = L(`새 ${TYPE_LABEL_()[src.type]}: ${src.label}`, `New ${TYPE_LABEL_()[src.type]}: ${src.label}`);
    evTargets = [['object', a.id]];
  } else {
    const a = o(str(r.keep_id)), b = o(str(r.merge_id));
    if (!a || !b) return null;
    src = refOf(a); dst = refOf(b);
    text = L(`[${TYPE_LABEL_()[src.type]}] ${src.label} = ${dst.label} (같은 것으로 합치기)`, `[${TYPE_LABEL_()[src.type]}] ${src.label} = ${dst.label} (merge as the same thing)`);
    evTargets = [['object', b.id], ['object', a.id]];
  }
  const ev = evTargets.flatMap(([k, id]) => db.all(`SELECT e.*, c.source_ai, c.title AS conv_title, c.updated_at AS conv_at, ms.created_at AS msg_at FROM evidence e JOIN conversations c ON c.id=e.conversation_id LEFT JOIN messages ms ON ms.id=e.message_id WHERE e.target_kind=? AND e.target_id=? ORDER BY e.id DESC`, k, id));
  return {
    id: String(r.id), kind, confidence: Number(r.confidence ?? 0), text, linkType, src, dst, evidenceCount: ev.length,
    evidence: ev.slice(0, 3).map((e) => ({ conversationId: String(e.conversation_id), sourceAi: String(e.source_ai) as SourceAi, excerpt: String(e.excerpt ?? ''), at: String(e.msg_at ?? e.extracted_at ?? e.conv_at) })),
    state: String(r.state) as 'pending', linkId: r.link_id == null ? null : linkIdOf(Number(r.link_id)), objectId: str(r.object_id),
    merge: kind === 'merge' ? { keepId: String(r.keep_id), mergeId: String(r.merge_id) } : null, reason: String(r.reason) as OntologySuggestion['reason'], note: str(r.note), createdAt: String(r.created_at),
  };
}
export function listSuggestions(core: Core, q: { kind?: string[]; minConfidence?: number; limit?: number; cursor?: string; state?: string }): ListSuggestionsResponse {
  const rows = core.db.all(`SELECT * FROM ontology_suggestions WHERE state=? ${q.kind?.length ? 'AND kind IN (SELECT value FROM json_each(?))' : ''} ${q.minConfidence !== undefined ? 'AND confidence>=?' : ''} ORDER BY confidence DESC, created_at DESC, id`,
    q.state ?? 'pending', ...(q.kind?.length ? [JSON.stringify(q.kind)] : []), ...(q.minConfidence !== undefined ? [q.minConfidence] : []));
  const all = rows.map((r) => suggestionView(core.db, r)).filter((x): x is OntologySuggestion => !!x);
  const off = decodeCursor(q.cursor), lim = q.limit ?? 50;
  return { items: all.slice(off, off + lim), total: all.length, nextCursor: off + lim < all.length ? encodeCursor(off + lim) : null };
}
function sugRow(db: Db, id: string): Row {
  const r = db.get('SELECT * FROM ontology_suggestions WHERE id=?', id);
  if (!r) throw new ApiError('NOT_FOUND', L('제안을 찾을 수 없어요.', 'Suggestion not found.'), { suggestionId: id });
  return r;
}
const PROTECTED = new Set(['first_seen_person', 'supersedes']);
export function acceptSuggestion(core: Core, id: string): AcceptSuggestionResponse {
  const db = core.db;
  const r = sugRow(db, id);
  if (r.state !== 'pending') throw new ApiError('CONFLICT', L('이미 처리한 제안이에요.', 'This suggestion was already handled.'), { suggestionId: id, state: r.state });
  const objIds = [str(r.object_id), str(r.keep_id), str(r.merge_id)].filter((x): x is string => !!x);
  let linkIds: number[] = r.link_id == null ? [] : [Number(r.link_id)];
  if (linkIds.length) { const l = db.get<{ src_id: string; dst_id: string }>('SELECT src_id, dst_id FROM links WHERE id=?', linkIds[0]!); if (l) objIds.push(l.src_id, l.dst_id); }
  const before = snapshot(db, objIds, linkIds);
  let eventId = 0;
  db.tx(() => {
    if (r.kind === 'merge') { mergeObjects(core, String(r.merge_id), String(r.keep_id)); }
    else {
      if (r.kind === 'object') { db.run("UPDATE objects SET status='accepted' WHERE id=?", String(r.object_id)); linkIds = db.all<{ id: number }>("SELECT id FROM links WHERE (src_id=? OR dst_id=?) AND status='suggested' AND id NOT IN (SELECT link_id FROM ontology_suggestions WHERE kind='link' AND state='pending' AND link_id IS NOT NULL)", String(r.object_id), String(r.object_id)).map((x) => x.id); }
      for (const lid of r.kind === 'link' ? linkIds : []) {
        db.run("UPDATE links SET status='accepted' WHERE id=?", lid);
        const l = db.get<{ src_id: string; dst_id: string }>('SELECT src_id, dst_id FROM links WHERE id=?', lid)!;
        for (const oid of [l.src_id, l.dst_id]) {
          if (db.get("SELECT 1 FROM objects WHERE id=? AND status='suggested'", oid)) {
            db.run("UPDATE objects SET status='accepted' WHERE id=?", oid);
            db.run("UPDATE ontology_suggestions SET state='accepted', decided_at=? WHERE kind='object' AND object_id=? AND state='pending'", nowIso(), oid);
          }
        }
      }
    }
    db.run("UPDATE ontology_suggestions SET state='accepted', decided_at=? WHERE id=?", nowIso(), id);
    eventId = recordEvent(db, 'accept_suggestion', before, { objectIds: objIds, linkIds });
  });
  const objs = db.all('SELECT * FROM objects WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify([...new Set(objIds.map((x) => canonical(db, x)))]));
  const links = linkIds.length ? db.all('SELECT * FROM links WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(linkIds)) : [];
  return { suggestion: suggestionView(db, sugRow(db, id))!, objects: objectViews(core, objs, links), links: linkViews(db, links), eventId };
}
export function rejectSuggestion(core: Core, id: string, reason?: string): RejectSuggestionResponse {
  const db = core.db;
  const r = sugRow(db, id);
  if (r.state !== 'pending') throw new ApiError('CONFLICT', L('이미 처리한 제안이에요.', 'This suggestion was already handled.'), { suggestionId: id, state: r.state });
  const objIds = [str(r.object_id), str(r.keep_id), str(r.merge_id)].filter((x): x is string => !!x);
  const linkIds = r.link_id == null ? [] : [Number(r.link_id)];
  const before = snapshot(db, objIds, linkIds);
  const keys: string[] = [];
  let eventId = 0;
  const view = suggestionView(db, r);
  db.tx(() => {
    if (r.kind === 'link') {
      const l = db.get<{ type: string; src_id: string; dst_id: string }>('SELECT type, src_id, dst_id FROM links WHERE id=?', linkIds[0]!);
      db.run("UPDATE links SET status='rejected' WHERE id=?", linkIds[0]!);
      if (l) keys.push(linkKey(l.type, l.src_id, l.dst_id));
    } else if (r.kind === 'object') {
      const o = db.get<{ type: string; name: string }>('SELECT type, name FROM objects WHERE id=?', String(r.object_id));
      db.run("UPDATE objects SET status='rejected' WHERE id=?", String(r.object_id));
      db.run("UPDATE links SET status='rejected' WHERE (src_id=? OR dst_id=?) AND status='suggested'", String(r.object_id), String(r.object_id));
      db.run("UPDATE ontology_suggestions SET state='rejected', decided_at=? WHERE kind='link' AND state='pending' AND link_id IN (SELECT id FROM links WHERE src_id=? OR dst_id=?)", nowIso(), String(r.object_id), String(r.object_id));
      if (o) keys.push(objKey(o.type, o.name));
    } else keys.push(`m|${[String(r.keep_id), String(r.merge_id)].sort().join('|')}`);
    for (const k of keys) db.run('INSERT OR IGNORE INTO ontology_rejections(key, at) VALUES (?,?)', k, nowIso());
    db.run("UPDATE ontology_suggestions SET state='rejected', decided_at=?, reject_reason=? WHERE id=?", nowIso(), reason ?? null, id);
    eventId = recordEvent(db, 'reject_suggestion', before, { objectIds: objIds, linkIds, rejectionKeys: keys });
  });
  return { suggestion: { ...(view ?? suggestionView(db, sugRow(db, id))!), state: 'rejected' }, eventId };
}
export function bulkAccept(core: Core, b: BulkAcceptSuggestionsBody): BulkAcceptSuggestionsResponse {
  const db = core.db;
  const min = b.minConfidence ?? 0.8;
  const rows = b.ids?.length ? b.ids.map((id) => db.get('SELECT * FROM ontology_suggestions WHERE id=?', id) ?? { id, state: 'missing' }) : db.all("SELECT * FROM ontology_suggestions WHERE state='pending' ORDER BY confidence DESC");
  const accepted: string[] = [], skipped: BulkAcceptSuggestionsResponse['skipped'] = [];
  for (const r of rows) {
    const id = String(r.id);
    if (r.state !== 'pending') { skipped.push({ id, reason: 'not_pending' }); continue; }
    if (b.kind?.length && !b.kind.includes(String(r.kind) as 'link')) continue;
    if (r.kind === 'merge' || PROTECTED.has(String(r.reason))) { skipped.push({ id, reason: 'protected' }); continue; }
    if (!b.ids?.length && Number(r.confidence) < min) { skipped.push({ id, reason: 'below_threshold' }); continue; }
    if (db.value<string>('SELECT state FROM ontology_suggestions WHERE id=?', id) !== 'pending') { skipped.push({ id, reason: 'not_pending' }); continue; } // 앞의 확정으로 같이 처리됨
    acceptSuggestion(core, id); accepted.push(id);
  }
  return { accepted, skipped };
}

// ── 화면 데이터
export function ontologyGraph(core: Core, q: { objectTypes?: ObjectType[]; linkTypes?: LinkType[]; status?: Array<'accepted' | 'suggested'>; projectId?: string; includeEnded?: boolean; minMentions?: number }): OntologyGraphResponse {
  const db = core.db;
  const status = q.status?.length ? q.status : ['accepted', 'suggested'];
  const linkTypes = q.linkTypes?.length ? q.linkTypes : LINK_TYPE_META.filter((l) => l.key !== 'related_to').map((l) => l.key);
  let objs = db.all(`SELECT * FROM objects WHERE status IN (SELECT value FROM json_each(?)) ${q.objectTypes?.length ? 'AND type IN (SELECT value FROM json_each(?))' : ''} ORDER BY mention_count DESC, id`,
    JSON.stringify(status), ...(q.objectTypes?.length ? [JSON.stringify(q.objectTypes)] : []));
  let ids = new Set(objs.map((o) => String(o.id)));
  let links = db.all(`SELECT * FROM links WHERE status IN (SELECT value FROM json_each(?)) AND type IN (SELECT value FROM json_each(?)) ${q.includeEnded === false ? 'AND ended_at IS NULL' : ''} ORDER BY id`, JSON.stringify(status), JSON.stringify(linkTypes))
    .filter((l) => ids.has(String(l.src_id)) && ids.has(String(l.dst_id)));
  if (q.projectId) {
    const p = db.value<string>("SELECT id FROM objects WHERE type='project' AND ((ref_table='projects' AND ref_id=?) OR id=?)", q.projectId, q.projectId);
    if (!p) throw new ApiError('NOT_FOUND', L('프로젝트를 찾을 수 없어요.', 'Project not found.'), { projectId: q.projectId });
    const keep = new Set([p]);
    for (let hop = 0; hop < 2; hop++) for (const l of links) { const a = String(l.src_id), b = String(l.dst_id); if (keep.has(a) || keep.has(b)) { keep.add(a); keep.add(b); } }
    objs = objs.filter((o) => keep.has(String(o.id))); ids = keep;
    links = links.filter((l) => keep.has(String(l.src_id)) && keep.has(String(l.dst_id)));
  }
  const minM = q.minMentions ?? 1;
  const hidden = minM > 1 ? objs.filter((o) => Number(o.mention_count ?? 0) < minM && o.type !== 'project' && o.type !== 'task').length : 0;
  if (minM > 1) { objs = objs.filter((o) => Number(o.mention_count ?? 0) >= minM || o.type === 'project' || o.type === 'task'); ids = new Set(objs.map((o) => String(o.id))); links = links.filter((l) => ids.has(String(l.src_id)) && ids.has(String(l.dst_id))); }
  const truncated = objs.length > 1500;
  if (truncated) { objs = objs.slice(0, 1500); ids = new Set(objs.map((o) => String(o.id))); links = links.filter((l) => ids.has(String(l.src_id)) && ids.has(String(l.dst_id))); }
  const sug = listSuggestions(core, { limit: 50 });
  return {
    today: today(), objects: objectViews(core, objs, links), links: linkViews(db, links), suggestions: sug.items,
    counts: { objects: objs.length, links: links.length, pendingSuggestions: sug.total, hiddenSingleMention: hidden }, truncated,
  };
}
export function listObjects(core: Core, q: { type?: ObjectType[]; q?: string; status?: OntologyStatus[]; limit?: number; cursor?: string }): ListObjectsResponse {
  const db = core.db;
  const st = q.status?.length ? q.status : ['accepted', 'suggested'];
  let rows = db.all(`SELECT * FROM objects WHERE status IN (SELECT value FROM json_each(?)) ${q.type?.length ? 'AND type IN (SELECT value FROM json_each(?))' : ''} ORDER BY mention_count DESC, name`, JSON.stringify(st), ...(q.type?.length ? [JSON.stringify(q.type)] : []));
  if (q.q) {
    const nq = normName(q.q);
    const hit = new Set(db.all<{ object_id: string }>("SELECT object_id FROM aliases WHERE norm_alias LIKE '%' || ? || '%'", nq).map((r) => r.object_id));
    rows = rows.filter((r) => String(r.norm_name).includes(nq) || hit.has(String(r.id)));
  }
  const off = decodeCursor(q.cursor), lim = q.limit ?? 50;
  const pageRows = rows.slice(off, off + lim);
  return { items: objectViews(core, pageRows), total: rows.length, nextCursor: off + lim < rows.length ? encodeCursor(off + lim) : null };
}
export function objectDetail(core: Core, id0: string): ObjectDetail {
  const db = core.db;
  objRow(db, id0);
  const id = canonical(db, id0); // 합쳐진 객체 id면 합친 대상 상세(계약 §14.2)
  const r = objRow(db, id);
  const links = db.all("SELECT * FROM links WHERE (src_id=? OR dst_id=?) AND status<>'rejected' ORDER BY ended_at IS NOT NULL, last_seen_at DESC", id, id);
  const others = db.all('SELECT id, type, name, status FROM objects WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(links.map((l) => (l.src_id === id ? l.dst_id : l.src_id))));
  const om = new Map(others.map((o) => [String(o.id), o]));
  const lv = linkViews(db, links);
  const evAll = db.all(`SELECT e.*, c.source_ai, c.title AS conv_title, c.updated_at AS conv_at, ms.seq AS msg_seq, ms.created_at AS msg_at FROM evidence e JOIN conversations c ON c.id=e.conversation_id LEFT JOIN messages ms ON ms.id=e.message_id WHERE e.target_kind='object' AND e.target_id=? ORDER BY COALESCE(ms.created_at, e.extracted_at) DESC, e.id DESC`, id);
  // 스파크라인: 이 객체와 이 객체 관계들의 출처 시각(주 단위)
  const lj = JSON.stringify(links.map((l) => String(l.id)));
  const ats = db.all<{ at: string }>(`SELECT COALESCE(ms.created_at, c.updated_at, e.extracted_at) AS at FROM evidence e LEFT JOIN conversations c ON c.id=e.conversation_id LEFT JOIN messages ms ON ms.id=e.message_id
    WHERE (e.target_kind='object' AND e.target_id=?) OR (e.target_kind='link' AND e.target_id IN (SELECT value FROM json_each(?)))`, id, lj);
  const byWeek = new Map<string, number>();
  for (const a of ats) if (a.at) { const w = weekStart(kstDate(a.at)); byWeek.set(w, (byWeek.get(w) ?? 0) + 1); }
  const taskObjIds = new Set<string>();
  for (const l of links) { if (!['uses', 'references', 'part_of', 'related_to', 'decided', 'affects', 'blocked_by'].includes(String(l.type))) continue; const o = l.src_id === id ? l.dst_id : l.src_id; if (om.get(String(o))?.type === 'task') taskObjIds.add(String(o)); }
  if (r.type === 'task') taskObjIds.delete(id);
  const taskRefIds = db.all<{ ref_id: string }>("SELECT ref_id FROM objects WHERE id IN (SELECT value FROM json_each(?)) AND ref_table='tasks'", JSON.stringify([...taskObjIds])).map((x) => x.ref_id);
  return {
    object: objectViews(core, [r], links)[0]!,
    links: lv.map((l, i) => { const raw = links[i]!; const dir = raw.src_id === id ? 'out' as const : 'in' as const; const o = om.get(String(dir === 'out' ? raw.dst_id : raw.src_id)); return { ...l, direction: dir, other: { id: String(o?.id ?? ''), type: String(o?.type ?? 'topic') as ObjectType, label: String(o?.name ?? ''), status: String(o?.status ?? 'accepted') as OntologyStatus } }; }),
    evidence: evAll.slice(0, 50).map(evRow), evidenceTotal: evAll.length,
    mentionsByWeek: [...byWeek].sort((a, b) => a[0].localeCompare(b[0])).map(([week, count]) => ({ week, count })),
    relatedTasks: loadTasks(core, { ids: taskRefIds }).map(toTaskRef),
  };
}

// ── 객체 액션
export function patchObject(core: Core, id: string, b: PatchObjectBody): ObjectDetail {
  const db = core.db;
  const row = objRow(db, id);
  if (b.name !== undefined && (row.type === 'project' || row.type === 'task') && row.ref_table)
    throw new ApiError('CONFLICT', L('프로젝트·과제 객체 이름은 원래 프로젝트·과제에서 바꿔요.', 'Rename project and task objects from the project or task itself.'), { objectId: id, ref: { table: row.ref_table, id: row.ref_id } });
  const before = snapshot(db, [id]);
  db.tx(() => {
    if (b.name !== undefined) {
      const n = b.name.trim();
      if (!n) throw new ApiError('VALIDATION_ERROR', L('이름이 비었어요.', 'Name is empty.'), { issues: [{ path: 'name', message: L('빈 이름', 'empty name') }] });
      const old = String(db.value('SELECT name FROM objects WHERE id=?', id));
      db.run('UPDATE objects SET name=?, norm_name=? WHERE id=?', n, normName(n), id);
      if (normName(old) !== normName(n)) db.run("INSERT OR IGNORE INTO aliases(object_id,alias,norm_alias,source) VALUES (?,?,?,'user')", id, old, normName(old));
    }
    if (b.aliases) {
      db.run('DELETE FROM aliases WHERE object_id=?', id);
      const own = normName(String(db.value('SELECT name FROM objects WHERE id=?', id)));
      for (const a of b.aliases) { const na = normName(a); if (na && na !== own) db.run("INSERT OR IGNORE INTO aliases(object_id,alias,norm_alias,source) VALUES (?,?,?,'user')", id, a, na); }
    }
    if (b.properties) {
      const p = json<Record<string, unknown>>(db.value<string>('SELECT properties_json FROM objects WHERE id=?', id), {});
      for (const [k, v] of Object.entries(b.properties)) { if (v === null) delete p[k]; else p[k] = v; }
      db.run('UPDATE objects SET properties_json=? WHERE id=?', JSON.stringify(p), id);
    }
    db.run("UPDATE objects SET status=CASE WHEN status='suggested' THEN 'accepted' ELSE status END WHERE id=?", id); // 사용자가 고쳤으면 확정
    recordEvent(db, 'patch_object', before, { objectIds: [id], linkIds: [] });
  });
  return objectDetail(core, id);
}
/** mergeId → intoId (별칭·출처·관계·주제 연결을 옮김) */
function mergeObjects(core: Core, mergeId: string, intoId: string): void {
  const db = core.db;
  const a = objRow(db, mergeId), b = objRow(db, intoId);
  if (a.type !== b.type) throw new ApiError('CONFLICT', L('같은 종류의 객체만 합칠 수 있어요.', 'Only objects of the same type can be merged.'), { objectType: a.type, intoType: b.type });
  if (mergeId === intoId) throw new ApiError('VALIDATION_ERROR', L('자기 자신과는 합칠 수 없어요.', 'An object can’t be merged with itself.'), { issues: [{ path: 'intoId', message: 'same' }] });
  db.run("INSERT OR IGNORE INTO aliases(object_id,alias,norm_alias,source) VALUES (?,?,?,'merge')", intoId, String(a.name), String(a.norm_name));
  db.run('UPDATE OR IGNORE aliases SET object_id=? WHERE object_id=?', intoId, mergeId);
  db.run('DELETE FROM aliases WHERE object_id=?', mergeId);
  db.run('DELETE FROM aliases WHERE object_id=? AND norm_alias=?', intoId, String(b.norm_name));
  db.run("UPDATE evidence SET target_id=? WHERE target_kind='object' AND target_id=?", intoId, mergeId);
  for (const l of db.all<{ id: number; type: string; src_id: string; dst_id: string; confidence: number | null; status: string }>('SELECT id, type, src_id, dst_id, confidence, status FROM links WHERE src_id=? OR dst_id=?', mergeId, mergeId)) {
    const s = l.src_id === mergeId ? intoId : l.src_id, d = l.dst_id === mergeId ? intoId : l.dst_id;
    if (s === d) { db.run('DELETE FROM links WHERE id=?', l.id); continue; }
    const dup = db.get<{ id: number }>('SELECT id FROM links WHERE type=? AND src_id=? AND dst_id=? AND id<>?', l.type, s, d, l.id);
    if (dup) {
      db.run("UPDATE evidence SET target_id=? WHERE target_kind='link' AND target_id=?", String(dup.id), String(l.id));
      db.run("UPDATE links SET confidence=MAX(COALESCE(confidence,0), ?), status=CASE WHEN status='accepted' OR ?='accepted' THEN 'accepted' ELSE status END, mention_count=mention_count+1 WHERE id=?", l.confidence ?? 0, l.status, dup.id);
      db.run('UPDATE ontology_suggestions SET link_id=? WHERE link_id=?', dup.id, l.id);
      db.run('DELETE FROM links WHERE id=?', l.id);
    } else db.run('UPDATE links SET src_id=?, dst_id=? WHERE id=?', s, d, l.id);
  }
  if (a.type === 'topic') { db.run('UPDATE OR IGNORE task_topics SET topic_id=? WHERE topic_id=?', intoId, mergeId); db.run('DELETE FROM task_topics WHERE topic_id=?', mergeId); }
  const n = Number(db.value("SELECT COUNT(DISTINCT conversation_id) FROM evidence WHERE target_kind='object' AND target_id=?", intoId) ?? 0);
  db.run("UPDATE objects SET mention_count=MAX(?, mention_count + ?), first_seen_at=MIN(COALESCE(first_seen_at,?), COALESCE(?,first_seen_at)), last_seen_at=MAX(COALESCE(last_seen_at,?), COALESCE(?,last_seen_at)), status=CASE WHEN status='suggested' THEN 'accepted' ELSE status END WHERE id=?",
    n, Number(a.mention_count ?? 0), a.first_seen_at as string, a.first_seen_at as string, a.last_seen_at as string, a.last_seen_at as string, intoId);
  db.run("UPDATE objects SET status='merged', merged_into=? WHERE id=?", intoId, mergeId);
  db.run("UPDATE ontology_suggestions SET state='accepted', decided_at=? WHERE state='pending' AND kind='merge' AND ((keep_id=? AND merge_id=?) OR (keep_id=? AND merge_id=?))", nowIso(), intoId, mergeId, mergeId, intoId);
  db.run("UPDATE ontology_suggestions SET state='accepted', decided_at=? WHERE state='pending' AND kind='object' AND object_id=?", nowIso(), mergeId);
}
export function mergeObjectAction(core: Core, id: string, intoId: string): MergeObjectResponse {
  const db = core.db;
  objRow(db, intoId);
  const before = snapshot(db, [id, intoId]);
  let eventId = 0;
  db.tx(() => { mergeObjects(core, id, intoId); eventId = recordEvent(db, 'merge_object', before, { objectIds: [id, intoId], linkIds: before.links.map((l) => Number(l.id)) }); });
  return { object: objectDetail(core, intoId), eventId };
}
export function splitObject(core: Core, id: string, b: SplitObjectBody): SplitObjectResponse {
  const db = core.db;
  const r = objRow(db, id);
  const before = snapshot(db, [id]);
  const newId = `obj_${String(r.type)}_${Math.random().toString(36).slice(2, 8)}`;
  let eventId = 0;
  db.tx(() => {
    db.run("INSERT INTO objects(id,type,name,norm_name,properties_json,status,confidence,first_seen_at,last_seen_at,mention_count,origin) VALUES (?,?,?,?, '{}', 'accepted', NULL, ?, ?, 0, 'user')",
      newId, String(r.type), b.newName.trim(), normName(b.newName), r.first_seen_at as string, r.last_seen_at as string);
    for (const a of b.aliases ?? []) { db.run('DELETE FROM aliases WHERE object_id=? AND norm_alias=?', id, normName(a)); db.run("INSERT OR IGNORE INTO aliases(object_id,alias,norm_alias,source) VALUES (?,?,?,'user')", newId, a, normName(a)); }
    for (const e of b.evidenceIds ?? []) db.run("UPDATE evidence SET target_id=? WHERE id=? AND target_kind='object' AND target_id=?", newId, e, id);
    for (const lid of (b.linkIds ?? []).map(parseLinkId)) {
      db.run('UPDATE links SET src_id=CASE WHEN src_id=? THEN ? ELSE src_id END, dst_id=CASE WHEN dst_id=? THEN ? ELSE dst_id END WHERE id=?', id, newId, id, newId, lid);
    }
    for (const oid of [id, newId]) db.run("UPDATE objects SET mention_count=(SELECT COUNT(DISTINCT conversation_id) FROM evidence WHERE target_kind='object' AND target_id=?) WHERE id=? AND type NOT IN ('task','project')", oid, oid);
    eventId = recordEvent(db, 'split_object', before, { objectIds: [id, newId], linkIds: (b.linkIds ?? []).map(parseLinkId), createdObjectIds: [newId] });
  });
  return { original: objectDetail(core, id), created: objectDetail(core, newId), eventId };
}
export function endLink(core: Core, linkId: string, b: EndLinkBody): EndLinkResponse {
  const db = core.db;
  const n = parseLinkId(linkId);
  const l = db.get('SELECT * FROM links WHERE id=?', n);
  if (!l) throw new ApiError('NOT_FOUND', L('관계를 찾을 수 없어요.', 'Relation not found.'), { linkId });
  const before = snapshot(db, [], [n]);
  let eventId = 0;
  db.tx(() => {
    const p = json<Record<string, string>>(l.properties_json, {});
    if (b.note) p.note = b.note;
    db.run('UPDATE links SET ended_at=?, properties_json=? WHERE id=?', b.endedAt ?? nowIso(), JSON.stringify(p), n);
    eventId = recordEvent(db, 'end_link', before, { objectIds: [], linkIds: [n] });
  });
  return { link: linkViews(db, [db.get('SELECT * FROM links WHERE id=?', n)!])[0]!, eventId };
}
export function undo(core: Core, eventId: number): UndoOntologyResponse {
  const ev = core.db.get<{ payload_json: string }>('SELECT payload_json FROM ontology_events WHERE id=?', eventId);
  if (!ev) throw new ApiError('NOT_FOUND', L('되돌릴 기록이 없어요.', 'Nothing to undo.'), { eventId });
  // 같은 대상에 뒤 액션이 있으면 409(뒤 것부터 되돌려야 함)
  const p = JSON.parse(ev.payload_json) as { objectIds: string[]; linkIds: number[] };
  for (const later of core.db.all<{ id: number; payload_json: string }>('SELECT id, payload_json FROM ontology_events WHERE id>? AND undone_at IS NULL', eventId)) {
    const q = JSON.parse(later.payload_json) as { objectIds: string[]; linkIds: number[] };
    if (q.objectIds.some((x) => p.objectIds.includes(x)) || q.linkIds.some((x) => p.linkIds.includes(x)))
      throw new ApiError('CONFLICT', L('같은 대상에 뒤에 한 일이 있어요. 그것부터 되돌려 주세요.', 'A later change touched the same item. Undo that one first.'), { eventId, laterEventId: later.id });
  }
  const r = undoEvent(core, eventId);
  return { undone: r.undone, eventId, affected: { objectIds: r.objectIds, linkIds: r.linkIds } };
}
/** 사용자가 직접 관계를 만들 때(내부용·테스트) */
export function userLink(core: Core, type: LinkType, src: string, dst: string): number | null { return upsertLink(core.db, { type, srcId: src, dstId: dst, confidence: 1, origin: 'user', forceAccept: true })?.id ?? null; }

// ── 질의
const taskObjectOf = (db: Db, taskId: string) => db.value<string>("SELECT id FROM objects WHERE type='task' AND ref_table='tasks' AND ref_id=? AND status<>'merged' LIMIT 1", taskId);
const CAUSE_ = (): Record<string, { kind: WhyStalledResponse['rootCauses'][number]['kind']; ko: string }> => ({
  person: { kind: 'waiting_person', ko: L('사람 답 기다림', 'Waiting on a person') }, decision: { kind: 'undecided', ko: L('아직 안 정한 결정', 'Undecided decision') }, task: { kind: 'blocked_task', ko: L('다른 과제가 먼저', 'Another task comes first') },
  organization: { kind: 'external', ko: L('바깥 기관·회사', 'Waiting on an outside company') }, artifact: { kind: 'other', ko: L('자료가 필요함', 'Needs a file or document') },
});
export function whyStalled(core: Core, taskId: string): WhyStalledResponse {
  const db = core.db;
  const t = loadTasks(core, { ids: [taskId] })[0];
  if (!t) throw new ApiError('NOT_FOUND', L('과제를 찾을 수 없어요.', 'Task not found.'), { taskId });
  const oid = taskObjectOf(db, taskId);
  const lastC = t.convs[0] ?? null;
  const base: WhyStalledResponse = { taskId, objectId: oid ?? null, task: { status: t.status, staleDays: t.stale.staleDays }, chain: [], rootCauses: [], ended: [], suggested: [], lastConversation: lastC ? { id: lastC.id, title: lastC.title, sourceAi: lastC.sourceAi, at: lastC.updatedAt } : null, explanation: '' };
  if (!oid) { base.explanation = L('아직 이 과제의 관계를 뽑지 않았어요.', 'Relations for this task haven’t been extracted yet.'); return base; }
  // 8.4 재귀 CTE: blocked_by 사슬, 최대 5단계, 끝나지 않은 확정 관계만
  const rows = db.all<{ depth: number; link_id: number }>(`WITH RECURSIVE chain(obj, depth, link_id, path) AS (
      SELECT ?, 0, NULL, ',' || ? || ','
      UNION ALL
      SELECT l.dst_id, c.depth + 1, l.id, c.path || l.dst_id || ','
      FROM chain c JOIN links l ON l.src_id = c.obj AND l.type = 'blocked_by' AND l.status = 'accepted' AND l.ended_at IS NULL
      WHERE c.depth < 5 AND instr(c.path, ',' || l.dst_id || ',') = 0
    ) SELECT depth, link_id FROM chain WHERE link_id IS NOT NULL ORDER BY depth, link_id`, oid, oid);
  const linkRows = rows.length ? db.all('SELECT * FROM links WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(rows.map((r) => r.link_id))) : [];
  const lv = new Map(linkViews(db, linkRows).map((l) => [l.id, l]));
  const objs = new Map(db.all<{ id: string; type: string; name: string; status: string; ref_table: string | null; ref_id: string | null }>('SELECT id, type, name, status, ref_table, ref_id FROM objects WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(linkRows.map((l) => String(l.dst_id)))).map((o) => [o.id, o]));
  const taskStatus = new Map(loadTasks(core, { ids: [...objs.values()].filter((o) => o.ref_table === 'tasks').map((o) => o.ref_id!) }).map((x) => [x.id, x.status]));
  for (const r of rows) {
    const raw = linkRows.find((l) => Number(l.id) === r.link_id)!;
    const o = objs.get(String(raw.dst_id))!;
    base.chain.push({ depth: r.depth, link: lv.get(linkIdOf(r.link_id))!, object: { id: o.id, type: o.type as ObjectType, label: o.name, status: o.status as OntologyStatus, taskStatus: (o.ref_table === 'tasks' ? taskStatus.get(o.ref_id!) ?? null : null) as TaskStatus | null } });
  }
  const srcs = new Set(linkRows.map((l) => String(l.src_id)));
  for (const c of base.chain) {
    if (srcs.has(c.object.id)) continue;                        // 사슬 끝만 원인
    const k = CAUSE_()[c.object.type] ?? { kind: 'other' as const, ko: L('기타', 'Other') };
    if (!base.rootCauses.some((x) => x.object.id === c.object.id)) base.rootCauses.push({ object: { id: c.object.id, type: c.object.type, label: c.object.label }, kind: k.kind, label: L(`‘${c.object.label}’(${k.ko})`, `${c.object.label} (${k.ko.toLowerCase()})`) });
  }
  base.ended = linkViews(db, db.all("SELECT * FROM links WHERE src_id=? AND type='blocked_by' AND status='accepted' AND ended_at IS NOT NULL ORDER BY ended_at DESC", oid));
  base.suggested = linkViews(db, db.all("SELECT * FROM links WHERE src_id=? AND type='blocked_by' AND status='suggested' ORDER BY confidence DESC", oid));
  const days = t.stale.staleDays;
  base.explanation = base.rootCauses.length
    ? L(`${base.rootCauses.map((c) => c.label).join(', ')} 때문에 ${t.status === '멈춤' && days !== null ? `${days}일째 멈춤` : t.status === '완료' ? '막혔었음(지금은 완료)' : '막혀 있음'}`, `Blocked by ${base.rootCauses.map((c) => c.label).join(', ')} — ${t.status === '멈춤' && days !== null ? `stalled for ${days} days` : t.status === '완료' ? 'was blocked (done now)' : 'still blocked'}`)
    : base.suggested.length ? L(`확정된 막힘은 없어요. 확인 필요: ${base.suggested.map((l) => String(objs.get(l.dstId)?.name ?? db.value('SELECT name FROM objects WHERE id=?', l.dstId))).join(', ')}`, `No confirmed blockers. Needs review: ${base.suggested.map((l) => String(objs.get(l.dstId)?.name ?? db.value('SELECT name FROM objects WHERE id=?', l.dstId))).join(', ')}`)
      : t.status === '멈춤' ? L(`막힌 관계는 없어요. 마지막 대화${lastC ? `(‘${lastC.title}’)` : ''} 뒤로 ${days ?? 0}일 동안 손대지 않음`, `No blocking relations. Untouched for ${days ?? 0} days since the last chat${lastC ? ` (‘${lastC.title}’)` : ''}`) : L('막힌 것이 없어요.', 'Nothing is blocking it.');
  return base;
}
/** TaskDetail.whyStalled(1.0 모양)용 요약 */
export function whyStalledLegacy(core: Core, taskId: string): { chain: Array<{ depth: number; nodeId: string; type: ObjectType; label: string; linkType: 'blocked_by'; confidence: number }>; rootCause: string | null; lastRelatedConversationId: string | null } | null {
  if (!taskObjectOf(core.db, taskId)) return null;
  const w = whyStalled(core, taskId);
  if (!w.chain.length) return null;
  return { chain: w.chain.map((c) => ({ depth: c.depth, nodeId: c.object.id, type: c.object.type, label: c.object.label, linkType: 'blocked_by', confidence: c.link.confidence ?? 1 })), rootCause: w.rootCauses[0]?.label ?? null, lastRelatedConversationId: w.lastConversation?.id ?? null };
}
export function impact(core: Core, id: string): ImpactResponse {
  const db = core.db;
  objRow(db, id);
  // 결정·도구가 바뀌면 영향받는 것: affects(나가는) · derived_from(들어오는: 이것에서 파생된 것) · uses(들어오는: 이것을 쓰는 것) · decided(들어오는: 이 결정을 한 과제)
  const affected = new Map<string, { via: LinkType[]; depth: number }>();
  let frontier = [id];
  for (let depth = 1; depth <= 3 && frontier.length; depth++) {
    const next: string[] = [];
    const fj = JSON.stringify(frontier);
    const rows = db.all<{ type: LinkType; src_id: string; dst_id: string }>(`SELECT type, src_id, dst_id FROM links WHERE status='accepted' AND ended_at IS NULL AND (
      (type='affects' AND src_id IN (SELECT value FROM json_each(?))) OR (type IN ('derived_from','uses','decided') AND dst_id IN (SELECT value FROM json_each(?))))`, fj, fj);
    for (const r of rows) {
      const o = r.type === 'affects' ? r.dst_id : r.src_id;
      if (o === id) continue;
      const cur = affected.get(o);
      if (cur) { if (!cur.via.includes(r.type)) cur.via.push(r.type); continue; }
      affected.set(o, { via: [r.type], depth }); next.push(o);
    }
    frontier = next;
  }
  const objs = new Map(db.all<{ id: string; type: string; name: string }>('SELECT id, type, name FROM objects WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify([...affected.keys()])).map((o) => [o.id, o]));
  const supersededOf = (oid: string) => db.get<{ id: string; type: string; name: string }>("SELECT o.id, o.type, o.name FROM links l JOIN objects o ON o.id=l.src_id WHERE l.type='supersedes' AND l.dst_id=? AND l.status='accepted' AND l.ended_at IS NULL LIMIT 1", oid);
  const sb = supersededOf(id);
  return {
    objectId: id,
    affected: [...affected].filter(([o]) => objs.has(o)).sort((a, b) => a[1].depth - b[1].depth).map(([o, v]) => ({ object: refOf(objs.get(o)!), via: v.via, depth: v.depth, superseded: !!supersededOf(o) })),
    supersededBy: sb ? refOf(sb) : null,
  };
}
export function similar(core: Core, text: string, limit = 5): SimilarResponse {
  const db = core.db;
  const nt = normName(text);
  const bg = bigrams(text);
  // 글에 이름·별칭이 나오는 객체(과제·프로젝트 제외)
  const shared = db.all<{ id: string; type: string; name: string; norm_name: string }>("SELECT id, type, name, norm_name FROM objects WHERE status='accepted' AND type NOT IN ('task','project') AND length(norm_name)>=2")
    .filter((o) => nt.includes(o.norm_name) || db.all<{ norm_alias: string }>('SELECT norm_alias FROM aliases WHERE object_id=?', o.id).some((a) => a.norm_alias.length >= 2 && nt.includes(a.norm_alias)));
  const sharedIds = new Set(shared.map((o) => o.id));
  const tasks = loadTasks(core).filter((t) => t.kind === 'task' && t.status !== '보관');
  const out: SimilarResponse['items'] = [];
  for (const t of tasks) {
    const oid = taskObjectOf(db, t.id);
    const nb = oid ? db.all<{ o: string }>("SELECT CASE WHEN src_id=? THEN dst_id ELSE src_id END AS o FROM links WHERE (src_id=? OR dst_id=?) AND status='accepted'", oid, oid, oid).map((r) => r.o) : [];
    const so = shared.filter((o) => nb.includes(o.id));
    const textScore = dice(bg, bigrams(`${t.title} ${t.summary ?? ''}`));
    const score = Math.round((0.6 * textScore + 0.4 * (sharedIds.size ? so.length / sharedIds.size : 0)) * 1000) / 1000;
    if (score < 0.08) continue;
    const decisions = oid ? db.all<{ name: string }>("SELECT o.name FROM links l JOIN objects o ON o.id=l.dst_id WHERE l.src_id=? AND l.type='decided' AND l.status='accepted'", oid).map((r) => r.name) : [];
    const blockers = oid ? db.all<{ name: string }>("SELECT o.name FROM links l JOIN objects o ON o.id=l.dst_id WHERE l.src_id=? AND l.type='blocked_by' AND l.status='accepted'", oid).map((r) => r.name) : [];
    out.push({ task: toTaskRef(t), score, sharedObjects: so.map(refOf), decisions, blockers, completedAt: t.status === '완료' ? t.completedAt : null });
  }
  return { items: out.sort((a, b) => b.score - a.score).slice(0, limit) };
}
export function graphPath(core: Core, from: string, to: string, maxDepth = 4): GraphPathResponse {
  const db = core.db;
  objRow(db, from); objRow(db, to);
  const bfs = (statuses: string[]) => {
    const rows = db.all<{ id: number; src_id: string; dst_id: string }>(`SELECT id, src_id, dst_id FROM links WHERE status IN (SELECT value FROM json_each(?)) AND ended_at IS NULL`, JSON.stringify(statuses));
    const adj = new Map<string, Array<{ o: string; l: number }>>();
    for (const r of rows) for (const [a, b] of [[r.src_id, r.dst_id], [r.dst_id, r.src_id]] as const) { let x = adj.get(a); if (!x) adj.set(a, (x = [])); x.push({ o: b, l: r.id }); }
    const prev = new Map<string, { from: string; l: number } | null>([[from, null]]);
    let frontier = [from];
    for (let d = 0; d < maxDepth && frontier.length && !prev.has(to); d++) {
      const nx: string[] = [];
      for (const f of frontier) for (const e of adj.get(f) ?? []) if (!prev.has(e.o)) { prev.set(e.o, { from: f, l: e.l }); nx.push(e.o); }
      frontier = nx;
    }
    if (!prev.has(to)) return null;
    const objs: string[] = [to], links: number[] = [];
    for (let cur = to; prev.get(cur); ) { const p = prev.get(cur)!; links.unshift(p.l); objs.unshift(p.from); cur = p.from; }
    return { objs, links };
  };
  let r = bfs(['accepted']), used = false;
  if (!r) { r = bfs(['accepted', 'suggested']); used = !!r; }
  if (!r) return { found: false, objects: [], links: [], usedSuggested: false };
  const om = new Map(db.all<{ id: string; type: string; name: string }>('SELECT id, type, name FROM objects WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(r.objs)).map((o) => [o.id, o]));
  const lr = db.all('SELECT * FROM links WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(r.links));
  const lv = new Map(linkViews(db, lr).map((l) => [l.id, l]));
  return { found: true, objects: r.objs.map((o) => refOf(om.get(o)!)), links: r.links.map((l) => lv.get(linkIdOf(l))!), usedSuggested: used };
}
/** 요약(digest) 제안 검토 카드 */
export function digestOntologyCard(core: Core, sinceIso: string): { newlyLinkedCount: number; pendingCount: number; items: OntologySuggestion[] } | null {
  const db = core.db;
  const s = listSuggestions(core, { limit: 5 });
  const newly = Number(db.value("SELECT COUNT(*) FROM links WHERE status='accepted' AND origin IN ('llm','rule') AND type<>'part_of' AND first_seen_at>=?", sinceIso) ?? 0);
  if (!s.total && !newly) return null;
  return { newlyLinkedCount: newly, pendingCount: s.total, items: s.items };
}
