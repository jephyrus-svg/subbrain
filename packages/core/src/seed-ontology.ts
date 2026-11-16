/**
 * 1.7.0 예시 온톨로지 — 웹 시안 목(web/src/mocks/ontology.json → shared/mocks/fixtures-15.ts 변환)을 굳힌 seed-ontology.json을 DB에 넣는다.
 * 웹 관계 화면이 4545에서 시안과 같은 그림을 그리게 하려는 것. 대화 id는 시안의 가짜 id라 제목이 같은 예시 대화로, 없으면
 * 그 객체에 이어진 과제의 최근 대화로, 그것도 없으면 같은 AI의 시각이 가장 가까운 대화로 붙인다(발췌·시각은 시안 그대로).
 */
import type { OntologyGraphResponse } from '@subbrain/shared';
import type { Core } from './core.ts';
import { normName } from './services/mutations.ts';
import { createSuggestion } from './ontology/store.ts';
import { readFileSync } from 'node:fs';
import { tzSuffix } from './util/time.ts';
/** keep the dataset's wall-clock time, use the configured local offset */
const w = <T extends string | null | undefined>(v: T): T => (typeof v === 'string' && /T\d\d:\d\d(:\d\d)?[+-]\d\d:\d\d$/.test(v) ? v.replace(/[+-]\d\d:\d\d$/, tzSuffix()) : v) as T;

const data: unknown = JSON.parse(readFileSync(new URL('./seed-ontology.json', import.meta.url), 'utf8'));

export function seedOntology(core: Core, graph?: OntologyGraphResponse): { objects: number; links: number; suggestions: number } {
  const db = core.db;
  const g = graph ?? (data as unknown as OntologyGraphResponse);
  const convByTitle = new Map(db.all<{ id: string; title: string }>('SELECT id, title FROM conversations').map((c) => [c.title, c.id]));
  const idMap = new Map<string, string>();
  // 1) 객체: 같은 ref·같은 (타입, 이름) 객체가 이미 있으면(예시 주제·결정) 그 행을 씀
  for (const o of g.objects) {
    const ex = (o.ref && o.ref.table !== 'topics' ? db.value<string>('SELECT id FROM objects WHERE type=? AND ref_table=? AND ref_id=?', o.type, o.ref.table, o.ref.id) : null)
      ?? db.value<string>('SELECT id FROM objects WHERE id=?', o.id) ?? db.value<string>('SELECT id FROM objects WHERE type=? AND norm_name=?', o.type, normName(o.name));
    const id = ex ?? o.id;
    idMap.set(o.id, id);
    const ref = o.ref && o.ref.table !== 'topics' ? o.ref : null;
    if (ex) db.run('UPDATE objects SET status=?, confidence=?, origin=?, first_seen_at=?, last_seen_at=?, mention_count=MAX(mention_count, ?), properties_json=COALESCE(?, properties_json) WHERE id=?',
      o.status, o.confidence, o.origin, w(o.firstSeenAt), w(o.lastSeenAt), o.mentionCount, Object.keys(o.properties ?? {}).length ? JSON.stringify(o.properties) : null, id);
    else db.run('INSERT INTO objects(id,type,name,norm_name,ref_table,ref_id,properties_json,status,merged_into,confidence,first_seen_at,last_seen_at,mention_count,origin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, o.type, o.name, normName(o.name), ref?.table ?? null, ref?.id ?? null, JSON.stringify(o.properties), o.status, o.mergedInto, o.confidence, w(o.firstSeenAt), w(o.lastSeenAt), o.mentionCount, o.origin);
    for (const a of o.aliases) db.run("INSERT OR IGNORE INTO aliases(object_id,alias,norm_alias,source) VALUES (?,?,?,'llm')", id, a, normName(a));
  }
  const taskConv = (objId: string): string | null => {
    const r = db.get<{ ref_id: string | null }>("SELECT ref_id FROM objects WHERE id=? AND ref_table='tasks'", objId);
    return r?.ref_id ? db.value<string>("SELECT c.id FROM task_conversations tc JOIN conversations c ON c.id=tc.conversation_id WHERE tc.task_id=? ORDER BY c.updated_at DESC LIMIT 1", r.ref_id) ?? null : null;
  };
  const neighborsOf = (mockId: string) => g.links.filter((l) => l.srcId === mockId || l.dstId === mockId).map((l) => idMap.get(l.srcId === mockId ? l.dstId : l.srcId)!);
  const convFor = (e: { conversationTitle: string; sourceAi: string; at: string }, targets: string[]): string | null => {
    const t = convByTitle.get(e.conversationTitle);
    if (t) return t;
    for (const x of targets) { const c = taskConv(x); if (c) return c; }
    return db.value<string>('SELECT id FROM conversations WHERE source_ai=? ORDER BY abs(julianday(updated_at) - julianday(?)) LIMIT 1', e.sourceAi, e.at) ?? null;
  };
  const addEv = (kind: 'object' | 'link', targetId: string, e: OntologyGraphResponse['objects'][number]['evidencePreview'][number], targets: string[]) => {
    const conv = convFor(e, targets);
    if (!conv) return;
    db.run('INSERT INTO evidence(target_kind,target_id,conversation_id,message_id,excerpt,confidence,model,prompt_version,extracted_at) VALUES (?,?,?,NULL,?,?,?,?,?)',
      kind, targetId, conv, e.excerpt, e.confidence, e.model ?? 'seed', 'seed', w(e.at));
  };
  for (const o of g.objects) for (const e of [...o.evidencePreview].reverse()) addEv('object', idMap.get(o.id)!, e, [idMap.get(o.id)!, ...neighborsOf(o.id)]);
  // 2) 관계
  const linkMap = new Map<string, number>();
  for (const l of g.links) {
    const s = idMap.get(l.srcId)!, d = idMap.get(l.dstId)!;
    const r = db.run('INSERT OR IGNORE INTO links(type,src_id,dst_id,properties_json,status,confidence,valid_from,ended_at,first_seen_at,last_seen_at,origin,mention_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      l.type, s, d, JSON.stringify(l.properties), l.status, l.confidence, w(l.validFrom), w(l.endedAt), w(l.firstSeenAt), w(l.lastSeenAt), l.origin, l.mentionCount);
    const id = r.changes ? r.lastInsertRowid : Number(db.value('SELECT id FROM links WHERE type=? AND src_id=? AND dst_id=?', l.type, s, d));
    linkMap.set(l.id, id);
    if (l.evidencePreview && r.changes) addEv('link', String(id), l.evidencePreview, [s, d]);
  }
  // 3) 제안
  let n = 0;
  for (const sg of g.suggestions) {
    const created = sg.kind === 'link' && sg.linkId && linkMap.has(sg.linkId) ? createSuggestion(db, { kind: 'link', linkId: linkMap.get(sg.linkId)!, confidence: sg.confidence, reason: sg.reason ?? 'mid_confidence', note: sg.note ?? null })
      : sg.kind === 'merge' && sg.merge ? createSuggestion(db, { kind: 'merge', keepId: idMap.get(sg.merge.keepId)!, mergeId: idMap.get(sg.merge.mergeId)!, confidence: sg.confidence, reason: 'merge_candidate', note: sg.note ?? null })
        : sg.kind === 'object' && sg.objectId ? createSuggestion(db, { kind: 'object', objectId: idMap.get(sg.objectId)!, confidence: sg.confidence, reason: sg.reason ?? 'mid_confidence', note: sg.note ?? null }) : null;
    if (created) { db.run('UPDATE ontology_suggestions SET created_at=? WHERE id=?', w(sg.createdAt ?? '2026-09-30T07:00:00+09:00'), created); n++; }
  }
  return { objects: g.objects.length, links: linkMap.size, suggestions: n };
}
