// 큰 온톨로지 합성 예시(모의 모드에서 /ontology?fixture=big): 실제 Mac 규모와 같은 섞임
// 987 객체(주제 394·결정 376·과제 159·도구 37·프로젝트 21), 관계 ~560. 결정적(시드 고정), 실데이터 없음.
import type { OntologyGraphResponse, OntologyLink, OntologyObject, StatusVisual } from '@subbrain/shared';

function rng(seed: number) { let a = seed; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const COLORS = ['#7F9CC4', '#D08A66', '#8FB59A', '#D3B060', '#B293AE', '#CF6F6A', '#A3A3A0'] as const;
const W1 = ['데이터', '검색', '동기화', '정리', '요약', '배포', '디자인', '백업', '알림', '분류', '보관', '읽기', '테스트', '설정', '로그'];
const W2 = ['파이프라인', '화면', '규칙', '엔진', '실험', '개선', '이전', '점검', '계획', '모듈', '정책', '도구', '흐름', '지표'];

let cached: OntologyGraphResponse | null = null;
export function bigOntology(): OntologyGraphResponse {
  if (cached) return cached;
  const r = rng(20261021);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)]!;
  const at = '2026-10-01T00:00:00Z';
  const objects: OntologyObject[] = []; const links: OntologyLink[] = [];
  const mk = (type: OntologyObject['type'], i: number, name: string, mentions: number, extra: Partial<OntologyObject> = {}): OntologyObject => {
    const o: OntologyObject = { id: `obj_${type}_${i}`, type, name, aliases: [], status: 'accepted', confidence: null, origin: 'rule', firstSeenAt: at, lastSeenAt: at, mentionCount: mentions, properties: {}, ref: null, projectObjectId: null, colorHex: null, statusVisual: null, badge: null, mergedInto: null, evidencePreview: [], ...extra };
    objects.push(o); return o;
  };
  const ment = () => (r() < 0.62 ? 1 : 1 + Math.floor(Math.pow(r(), 2.2) * 30));
  let li = 0;
  const link = (type: OntologyLink['type'], s: string, d: string) => links.push({ id: `lnk_${++li}`, type, srcId: s, dstId: d, status: r() < 0.05 ? 'suggested' : 'accepted', confidence: 0.9, origin: 'rule', mentionCount: 1, validFrom: null, endedAt: null, firstSeenAt: at, lastSeenAt: at, properties: {}, evidencePreview: null });
  const projects = Array.from({ length: 21 }, (_, i) => mk('project', i, `${pick(W1)} ${pick(W2)} 프로젝트 ${i + 1}`, 3 + Math.floor(r() * 40), { ref: { table: 'projects', id: `prj_big_${i}` }, colorHex: COLORS[i % COLORS.length]! as OntologyObject['colorHex'] }));
  const vis: StatusVisual[] = ['run', 'run', 'stall', 'stall2', 'done', 'done', 'quick'];
  const tasks = Array.from({ length: 159 }, (_, i) => {
    const p = projects[Math.floor(Math.pow(r(), 1.4) * projects.length)]!; const v = pick(vis);
    const t = mk('task', i, `${pick(W1)} ${pick(W2)} 과제 ${i + 1}`, ment(), { ref: { table: 'tasks', id: `task_big_${i}` }, projectObjectId: p.id, statusVisual: v, badge: v === 'stall' || v === 'stall2' ? `${3 + Math.floor(r() * 20)}일` : null });
    link('part_of', t.id, p.id); return t;
  });
  const tools = Array.from({ length: 37 }, (_, i) => mk('tool', i, `${pick(['Vite', 'SQLite', 'Gemini', 'Docker', 'React', 'Rust', 'Python', 'Figma', 'Notion', 'Git'])} ${i + 1}`, ment()));
  const decisions = Array.from({ length: 376 }, (_, i) => mk('decision', i, `${pick(W1)}은 ${pick(W2)}로 하기 ${i + 1}`, ment()));
  const topics = Array.from({ length: 394 }, (_, i) => mk('topic', i, `${pick(W1)}${pick(W2)}${i + 1}`, ment(), { ref: { table: 'topics', id: `t${i}` } }));
  const ptask = () => (r() < 0.75 ? pick(tasks) : pick(projects));
  for (let i = 0; i < 70; i++) link('uses', ptask().id, pick(tools).id);
  for (let i = 0; i < 190; i++) link('decided', ptask().id, pick(decisions).id);
  for (let i = 0; i < 110; i++) link('references', ptask().id, pick(topics).id);
  for (let i = 0; i < 20; i++) link('blocked_by', pick(tasks).id, pick(tasks).id);
  for (let i = 0; i < 11; i++) link('affects', pick(decisions).id, pick(tasks).id);
  cached = { today: '2026-10-21', objects, links, suggestions: [], counts: { objects: objects.length, links: links.length, pendingSuggestions: 0, hiddenSingleMention: 0 }, truncated: false };
  return cached;
}
