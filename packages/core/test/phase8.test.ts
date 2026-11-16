/**
 * Phase 8 (계약 1.7.0) — 온톨로지 구현(설계서 8장)
 *  예시 데이터 화면(GET /ontology·/objects·/objects/:id), 막힘 사슬(재귀 CTE), 제안 확정·거절·일괄·되돌리기, 합치기·나누기·끊기·고치기,
 *  영향·비슷한 과제·경로, 규칙 추출(키 없이), LLM 추출(가짜 모델: 스키마·허용 쌍·확신도 기준·거절 기억·다시 안 보냄), 추출 작업 엔드포인트
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as S from '@subbrain/shared/schemas';
import { makeCore, NOW } from './helpers.ts';
import { classifyConversation } from '../src/services/classify.ts';
import { upsertConversation } from '../src/services/imports.ts';
import { extractLlmForConversation, emptyStats } from '../src/ontology/extract.ts';
import { upsertLink } from '../src/ontology/store.ts';
import type { Classifier } from '../src/classifier/provider.ts';

type T = Awaited<ReturnType<typeof makeCore>>;
let t: T | null = null;
afterEach(() => { t?.close(); t = null; });
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('예시 데이터 + 화면', () => {
  it('GET /ontology — 시안과 같은 그림, 계약 스키마 통과', async () => {
    t = await makeCore({ seeded: true });
    const r = await t.json('GET', '/ontology');
    expect(r.status).toBe(200);
    const g = S.OntologyGraphResponseSchema.parse(r.body);
    expect(g.objects.length).toBeGreaterThanOrEqual(68);
    expect(g.links.some((l) => l.type === 'related_to')).toBe(false); // 기본 숨김
    expect(g.counts.pendingSuggestions).toBe(9);
    const copy = g.objects.find((o) => o.ref?.id === 'task_20260830_01')!;
    expect(copy.type).toBe('task');
    expect(copy.statusVisual).not.toBeNull();
    expect(copy.projectObjectId).toBe(g.objects.find((o) => o.ref?.id === 'prj_blog')!.id);
    expect(g.objects.find((o) => o.ref?.id === 'prj_blog')!.colorHex).toMatch(/^#/);
    const all = S.OntologyGraphResponseSchema.parse((await t.json('GET', '/ontology?linkTypes=related_to,part_of&minMentions=2')).body);
    expect(all.links.every((l) => l.type === 'related_to' || l.type === 'part_of')).toBe(true);
    const prj = S.OntologyGraphResponseSchema.parse((await t.json('GET', '/ontology?projectId=prj_moving')).body);
    expect(prj.objects.length).toBeLessThan(g.objects.length);
    expect(prj.objects.some((o) => o.ref?.id === 'prj_moving')).toBe(true);
  });

  it('GET /objects 검색(별칭) · /objects/:id 상세', async () => {
    t = await makeCore({ seeded: true });
    const l = S.ListObjectsResponseSchema.parse((await t.json('GET', '/objects?type=tool&q=nextjs')).body);
    expect(l.items[0]?.name).toBe('Next.js');
    const d = S.ObjectDetailSchema.parse((await t.json('GET', `/objects/${l.items[0]!.id}`)).body);
    expect(d.links.length).toBeGreaterThan(0);
    expect(d.relatedTasks.length).toBeGreaterThan(0);
    expect(d.mentionsByWeek.length).toBeGreaterThan(0);
    expect((await t.json('GET', '/objects/obj_nope')).status).toBe(404);
  });

  it('왜 멈췄나: blocked_by 사슬(3단계) → 사람 답 기다림, 끝난 막힘·제안 막힘 분리, TaskDetail.whyStalled', async () => {
    t = await makeCore({ seeded: true });
    const w = S.WhyStalledResponseSchema.parse((await t.json('GET', '/tasks/task_20260827_01/why-stalled')).body);
    expect(w.chain.map((c) => c.depth)).toEqual([1, 2, 3]);
    expect(w.rootCauses).toEqual([expect.objectContaining({ kind: 'waiting_person', label: '‘디자이너 윤서’(사람 답 기다림)' })]);
    expect(w.explanation).toContain('디자이너 윤서');
    const rss = S.WhyStalledResponseSchema.parse((await t.json('GET', '/tasks/task_20260805_01/why-stalled')).body);
    expect(rss.chain).toEqual([]);
    expect(rss.ended.length).toBe(1);
    const etf = S.WhyStalledResponseSchema.parse((await t.json('GET', '/tasks/task_20260924_03/why-stalled')).body);
    expect(etf.suggested.length).toBe(1);
    expect(etf.explanation).toContain('확인 필요');
    const td = (await t.json('GET', '/tasks/task_20260827_01')).body as Any;
    expect(td.whyStalled.chain.length).toBe(3);
    expect(td.whyStalled.rootCause).toContain('디자이너');
  });

  it('영향·비슷한 과제·경로', async () => {
    t = await makeCore({ seeded: true });
    const db = t.core.db;
    const tone = db.value<string>("SELECT id FROM objects WHERE type='decision' AND name='카피 톤은 존댓말'")!;
    const im = S.ImpactResponseSchema.parse((await t.json('GET', `/objects/${tone}/impact`)).body);
    expect(im.affected.map((a) => a.object.label)).toEqual(expect.arrayContaining(['메인 페이지 카피 확정', '소개 페이지 톤 맞추기']));
    const vercel = db.value<string>("SELECT id FROM objects WHERE type='decision' AND name='Vercel로 배포'")!;
    expect(S.ImpactResponseSchema.parse((await t.json('GET', `/objects/${vercel}/impact`)).body).supersededBy?.label).toBe('Netlify로 배포');
    const sim = S.SimilarResponseSchema.parse((await t.json('GET', `/similar?text=${encodeURIComponent('Next.js 배포 오류가 또 났어')}`)).body);
    expect(sim.items[0]?.task.title).toContain('배포');
    const a = db.value<string>("SELECT id FROM objects WHERE ref_id='task_20260827_01'")!, b = db.value<string>("SELECT id FROM objects WHERE type='person' AND name='디자이너 윤서'")!;
    const p = S.GraphPathResponseSchema.parse((await t.json('GET', `/graph/path?from=${a}&to=${b}`)).body);
    expect(p.found).toBe(true);
    expect(p.objects[0]!.id).toBe(a);
    expect(p.objects.at(-1)!.id).toBe(b);
  });
});

describe('제안 검토 + 편집 + 되돌리기', () => {
  it('확정 → 관계·끝 객체 확정, 되돌리기 → 원래대로', async () => {
    t = await makeCore({ seeded: true });
    const list = S.ListSuggestionsResponseSchema.parse((await t.json('GET', '/suggestions')).body);
    expect(list.total).toBe(9);
    const s = list.items.find((x) => x.kind === 'link' && x.reason === 'mid_confidence')!;
    const acc = await t.json('POST', `/suggestions/${s.id}/accept`, {});
    expect(acc.status).toBe(200);
    const body = acc.body as Any;
    expect(body.links[0].status).toBe('accepted');
    expect((await t.json('POST', `/suggestions/${s.id}/accept`, {})).status).toBe(409);
    expect(S.ListSuggestionsResponseSchema.parse((await t.json('GET', '/suggestions')).body).total).toBe(8);
    const u = await t.json('POST', `/ontology/events/${body.eventId}/undo`, {});
    expect(u.body).toMatchObject({ undone: true });
    expect(t.core.db.value('SELECT status FROM links WHERE id=?', Number(String(s.linkId).slice(4)))).toBe('suggested');
    expect(S.ListSuggestionsResponseSchema.parse((await t.json('GET', '/suggestions')).body).total).toBe(9);
  });

  it('거절 → 거절 기억(같은 관계 다시 안 만듦), 일괄 확정은 사람·대체·합치기 건너뜀', async () => {
    t = await makeCore({ seeded: true });
    const db = t.core.db;
    const items = S.ListSuggestionsResponseSchema.parse((await t.json('GET', '/suggestions')).body).items;
    const s = items.find((x) => x.kind === 'link' && x.reason === 'mid_confidence')!;
    const rj = await t.json('POST', `/suggestions/${s.id}/reject`, { reason: '아님' });
    expect((rj.body as Any).suggestion.state).toBe('rejected');
    expect(upsertLink(db, { type: s.linkType!, srcId: s.src!.id, dstId: s.dst!.id, confidence: 0.99, origin: 'llm' })).toBeNull();
    const bulk = (await t.json('POST', '/suggestions/bulk-accept', { minConfidence: 0.6 })).body as Any;
    const protectedIds = items.filter((x) => x.kind === 'merge' || x.reason === 'first_seen_person' || x.reason === 'supersedes').map((x) => x.id);
    expect(bulk.skipped.filter((x: Any) => x.reason === 'protected').map((x: Any) => x.id).sort()).toEqual(protectedIds.sort());
    expect(bulk.accepted.length).toBe(items.length - protectedIds.length - 1);
  });

  it('합치기(별칭·관계 옮김) → 되돌리기, 나누기, 고치기(옛 이름은 별칭), 끊기', async () => {
    t = await makeCore({ seeded: true });
    const db = t.core.db;
    const sug = S.ListSuggestionsResponseSchema.parse((await t.json('GET', '/suggestions?kind=merge')).body).items[0]!;
    const { keepId, mergeId } = sug.merge!;
    const mergeName = String(db.value('SELECT name FROM objects WHERE id=?', mergeId));
    const linksBefore = Number(db.value('SELECT COUNT(*) FROM links WHERE src_id=? OR dst_id=?', mergeId, mergeId));
    const m = await t.json('POST', `/objects/${mergeId}/merge`, { intoId: keepId });
    expect(m.status).toBe(200);
    const mo = S.ObjectDetailSchema.parse((m.body as Any).object);
    expect(mo.object.aliases).toContain(mergeName);
    expect(db.value('SELECT status FROM objects WHERE id=?', mergeId)).toBe('merged');
    expect(db.value('SELECT COUNT(*) FROM links WHERE src_id=? OR dst_id=?', mergeId, mergeId)).toBe(0);
    expect(db.value("SELECT state FROM ontology_suggestions WHERE id=?", sug.id)).toBe('accepted');
    await t.json('POST', `/ontology/events/${(m.body as Any).eventId}/undo`, {});
    expect(db.value('SELECT status FROM objects WHERE id=?', mergeId)).not.toBe('merged');
    expect(Number(db.value('SELECT COUNT(*) FROM links WHERE src_id=? OR dst_id=?', mergeId, mergeId))).toBe(linksBefore);
    expect(db.value("SELECT state FROM ontology_suggestions WHERE id=?", sug.id)).toBe('pending');
    // 나누기
    const tool = db.value<string>("SELECT id FROM objects WHERE type='tool' AND name='Next.js'")!;
    const lk = db.value<number>('SELECT id FROM links WHERE dst_id=? LIMIT 1', tool)!;
    const sp = await t.json('POST', `/objects/${tool}/split`, { newName: 'Next.js 15', linkIds: [`lnk_${lk}`] });
    expect(sp.status).toBe(201);
    const created = S.ObjectDetailSchema.parse((sp.body as Any).created);
    expect(created.links.map((l) => l.id)).toContain(`lnk_${lk}`);
    // 고치기
    const pt = S.ObjectDetailSchema.parse((await t.json('PATCH', `/objects/${tool}`, { name: 'Next.js (앱 라우터)', properties: { version: '14' } })).body);
    expect(pt.object.aliases).toContain('Next.js');
    expect(pt.object.properties.version).toBe('14');
    expect((await t.json('POST', `/ontology/events/${(sp.body as Any).eventId}/undo`, {})).status).toBe(409); // 뒤에 고치기가 있음
    // 끊기
    const e = await t.json('POST', `/links/lnk_${lk}/end`, { note: '해결됨' });
    expect((e.body as Any).link.endedAt).not.toBeNull();
    expect((await t.json('POST', '/links/lnk_999999/end', {})).status).toBe(404);
    const prjObj = db.value<string>("SELECT id FROM objects WHERE type='project' LIMIT 1")!;
    expect((await t.json('POST', `/objects/${tool}/merge`, { intoId: prjObj })).status).toBe(409); // 다른 종류
    expect((await t.json('PATCH', `/objects/${prjObj}`, { name: '새 이름' })).status).toBe(409); // 프로젝트 이름은 원본에서
    expect(S.ObjectDetailSchema.parse((await t.json('GET', `/objects/${mergeId}`)).body).object.id).toBe(mergeId); // 되돌린 뒤라 자기 자신
  });

  it('요약(digest) 제안 검토 카드가 채워짐', async () => {
    t = await makeCore({ seeded: true });
    const d = (await t.json('GET', '/digests/2026-09-30')).body as Any;
    expect(d.ontology.pendingCount).toBe(9);
    expect(d.ontology.items.length).toBeGreaterThan(0);
  });
});

const conv = (sourceId: string, title: string, msgs: Array<[string, string]>) => ({
  sourceAi: 'claude' as const, sourceId, title, createdAt: NOW, updatedAt: NOW, archived: false, inServiceProject: false, hasUnextractedArtifact: false,
  messages: msgs.map(([role, content]) => ({ role: role as 'user', content, createdAt: NOW })),
});

const taskCls: Classifier = { name: 'fake', model: 'fake-llm', isLlm: false,
  async classify() { return { output: S.LlmClassificationSchema.parse({ kind: 'task', resolution: 'unresolved', summary: '요약', confidence: 0.8 }), model: 'fake-llm', inputTokens: 1, outputTokens: 1, costUsd: null }; } };

describe('추출', () => {
  it('규칙(키 없이): 분류 끝나면 과제 객체 + 도구 사전 uses(사용자 2번 = 확정, 1번 = 제안)', async () => {
    t = await makeCore();
    const r = upsertConversation(t.core, conv('r1', '블로그 배포 설정', [
      ['user', 'Next.js 앱을 Vercel에 올리려는데 빌드가 깨져'], ['assistant', 'Next.js 설정을 볼게요'],
      ['user', 'next.js 14 쓰고 있어. 그리고 Figma 시안도 있음'], ['assistant', '네'],
    ]), { importId: null, rawPath: null });
    await classifyConversation(t.core, r.conversationId, taskCls); // 분류 결과는 과제(규칙 추출은 키와 상관없이 돎)
    const db = t.core.db;
    const tObj = db.value<string>("SELECT id FROM objects WHERE type='task' AND ref_id=?", r.taskId!);
    expect(tObj).toBeTruthy();
    const tool = (n: string) => db.get<Any>("SELECT o.status AS os, l.status AS ls FROM objects o JOIN links l ON l.dst_id=o.id AND l.type='uses' WHERE o.type='tool' AND o.name=?", n);
    expect(tool('Next.js')).toEqual({ os: 'accepted', ls: 'accepted' });
    expect(tool('Figma')).toEqual({ os: 'suggested', ls: 'suggested' });
    expect(db.value("SELECT excerpt FROM evidence WHERE target_kind='object' AND target_id=(SELECT id FROM objects WHERE name='Next.js')")).toContain('Next.js');
    // 다시 분류해도 출처·언급이 늘지 않음
    await classifyConversation(t.core, r.conversationId, taskCls);
    expect(db.value("SELECT mention_count FROM objects WHERE name='Next.js'")).toBe(1);
    expect(db.value("SELECT COUNT(*) FROM evidence WHERE target_kind='object' AND target_id=(SELECT id FROM objects WHERE name='Next.js')")).toBe(1);
  });

  it('LLM(가짜): 스키마 검증·허용 쌍(아니면 related_to)·확신도 기준·꺼진 타입 버림·같은 내용 다시 안 보냄', async () => {
    t = await makeCore();
    const db = t.core.db;
    db.run("UPDATE object_types SET enabled=1 WHERE key IN ('person','artifact')"); // 기본은 꺼짐(설계서 8.2)
    const r0 = upsertConversation(t.core, conv('l1', '카피 확정', [['user', '디자이너 답 오면 카피 확정하자. 톤은 존댓말로 정했어. 참고는 노션 문서'], ['assistant', '좋아요'], ['user', '후보 두 개 더 뽑아줘'], ['assistant', 'A안, B안'], ['user', '디자이너한테 보내고 기다릴게']]), { importId: null, rawPath: null });
    const r = r0;
    await classifyConversation(t.core, r.conversationId, taskCls);
    let calls = 0;
    const out = {
      objects: [
        { ref: 'o1', type: 'person', name: '디자이너', confidence: 0.95, evidence: '디자이너 답 오면', message_seq: 1 },
        { ref: 'o2', type: 'decision', name: '톤은 존댓말', confidence: 0.92, evidence: '톤은 존댓말로 정했어', message_seq: 1 },
        { ref: 'o3', type: 'artifact', name: '노션 문서', confidence: 0.7, evidence: '참고는 노션 문서', message_seq: 1 },
        { ref: 'o4', type: 'place', name: '애매한 곳', confidence: 0.5, evidence: '', message_seq: null },
        { ref: 'o5', type: 'project', name: '새 프로젝트', confidence: 0.99, evidence: '', message_seq: null },
      ],
      links: [
        { type: 'blocked_by', src: 'TASK', dst: 'o1', confidence: 0.9, evidence: '디자이너 답 오면', message_seq: 1 },
        { type: 'decided', src: 'TASK', dst: 'o2', confidence: 0.92, evidence: '정했어', message_seq: 1 },
        { type: 'uses', src: 'o2', dst: 'o3', confidence: 0.9, evidence: 'x', message_seq: 1 },     // 결정→자료 uses는 허용 안 됨 → related_to
        { type: 'references', src: 'TASK', dst: 'o3', confidence: 0.75, evidence: '참고는', message_seq: 1 },
        { type: 'located_at', src: 'TASK', dst: 'o4', confidence: 0.9, evidence: '', message_seq: null }, // o4 버려짐 → 관계도 없음
      ],
    };
    const fake: Classifier = { name: 'fake', model: 'fake-llm', isLlm: true, classify: async () => { throw new Error('x'); },
      complete: async (system, prompt) => { calls++; expect(system).toContain('JSON'); expect(prompt).toContain('TASK='); return { text: '```json\n' + JSON.stringify(out) + '\n```', model: 'fake-llm', inputTokens: 1000, outputTokens: 200, costUsd: 0.001 }; } };
    const st = await extractLlmForConversation(t.core, r.conversationId, fake, emptyStats());
    expect(st.llmCalls).toBe(1);
    const o = (n: string) => db.get<Any>('SELECT type, status FROM objects WHERE name=?', n);
    expect(o('디자이너')).toEqual({ type: 'person', status: 'suggested' });               // 처음 보는 사람 = 늘 제안
    expect(db.value("SELECT reason FROM ontology_suggestions WHERE object_id=(SELECT id FROM objects WHERE name='디자이너')")).toBe('first_seen_person');
    expect(o('톤은 존댓말')).toEqual({ type: 'decision', status: 'accepted' });
    expect(o('노션 문서')).toEqual({ type: 'artifact', status: 'suggested' });
    expect(o('애매한 곳')).toBeUndefined();
    expect(o('새 프로젝트')).toBeUndefined();
    expect(db.value("SELECT type FROM links WHERE src_id=(SELECT id FROM objects WHERE name='톤은 존댓말') AND dst_id=(SELECT id FROM objects WHERE name='노션 문서')")).toBe('related_to');
    expect(db.value("SELECT status FROM links WHERE type='blocked_by'")).toBe('suggested'); // 끝 객체가 제안이면 관계도 제안
    // 왜 멈췄나: 제안 막힘 → 확정하면 사슬
    const w0 = S.WhyStalledResponseSchema.parse((await t.json('GET', `/tasks/${r.taskId}/why-stalled`)).body);
    expect(w0.suggested.length).toBe(1);
    const sid = db.value<string>("SELECT id FROM ontology_suggestions WHERE kind='link' AND link_id=(SELECT id FROM links WHERE type='blocked_by')")!;
    await t.json('POST', `/suggestions/${sid}/accept`, {});
    expect(o('디자이너')!.status).toBe('accepted');
    const w1 = S.WhyStalledResponseSchema.parse((await t.json('GET', `/tasks/${r.taskId}/why-stalled`)).body);
    expect(w1.rootCauses[0]).toMatchObject({ kind: 'waiting_person' });
    // 같은 내용이면 다시 안 보냄
    await extractLlmForConversation(t.core, r.conversationId, fake, emptyStats());
    expect(calls).toBe(1);
    // 깨진 응답은 버리고 실패하지 않음
    const bad: Classifier = { ...fake, complete: async () => ({ text: 'not json', model: 'fake-llm', inputTokens: 1, outputTokens: 1, costUsd: null }) };
    await expect(extractLlmForConversation(t.core, r.conversationId, bad, emptyStats(), { force: true })).resolves.toBeTruthy();
  });

  it('POST /ontology/extract(키 없음 → 규칙만) · GET /ontology/status', async () => {
    t = await makeCore({ seeded: true });
    const r = await t.json('POST', '/ontology/extract', { scope: 'all' });
    expect(r.status).toBe(202);
    const jobId = (r.body as Any).id;
    for (let i = 0; i < 50; i++) { const j = (await t.json('GET', `/jobs/${jobId}`)).body as Any; if (j.state === 'done' || j.state === 'failed') break; await new Promise((x) => setTimeout(x, 20)); }
    expect(((await t.json('GET', `/jobs/${jobId}`)).body as Any).state).toBe('done');
    const st = (await t.json('GET', '/ontology/status')).body as Any;
    expect(st.llmConfigured).toBe(false);
    expect(st.objects.task).toBeGreaterThanOrEqual(20);
    expect(st.promptVersion).toBe('ont-v1');
    // 예시 그림은 그대로(규칙 추출이 과제 객체를 새로 만들지 않고 ref로 재사용)
    expect(t.core.db.value("SELECT COUNT(*) FROM objects WHERE type='task' AND ref_id='task_20260830_01'")).toBe(1);
  });

  it('v7 이전 데이터 보충: 과제 객체가 없으면 규칙 추출(멱등, LLM 없음) · mode:"rules"', async () => {
    t = await makeCore({ seeded: true });
    const db = t.core.db;
    db.run("DELETE FROM ontology_suggestions"); db.run('DELETE FROM evidence'); db.run('DELETE FROM links'); db.run("DELETE FROM objects WHERE type NOT IN ('topic','decision')");
    const { backfillRulesIfMissing } = await import('../src/ontology/job.ts');
    const a = backfillRulesIfMissing(t.core);
    expect(a.ran).toBe(true);
    const n = Number(db.value('SELECT COUNT(*) FROM links'));
    expect(db.value("SELECT COUNT(*) FROM links WHERE type='decided'")).toBeGreaterThan(0);
    expect(db.value("SELECT COUNT(*) FROM links WHERE type='part_of'")).toBeGreaterThan(0);
    expect(backfillRulesIfMissing(t.core).ran).toBe(false);
    const r = await t.json('POST', '/ontology/extract', { scope: 'all', mode: 'rules' });
    expect(r.status).toBe(202);
    await t.core.queue.idle();
    expect(Number(db.value('SELECT COUNT(*) FROM links'))).toBe(n);
  });
});
