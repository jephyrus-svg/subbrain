/**
 * 1.7.0 온톨로지 추출(설계서 8.6).
 *  규칙(늘, 키 없어도): 과제·프로젝트 객체(기존 행에서) + part_of, 주제 related_to, 결정 decided(+ affects 과제),
 *    과제 사이 막힘(task_links blocked_by), 도구 사전(한/영 표기) uses, 과제가 끝나면 그 과제의 blocked_by에 ended_at.
 *  LLM(키가 있을 때, 프롬프트 ont-v1): 줄인 대화 + 분류 결과 + 비슷한 기존 객체 후보 → 객체·관계(스키마 검증·허용 쌍·확신도 기준).
 *  같은 대화를 같은 내용·같은 프롬프트로 다시 돌리지 않는다(ontology_runs).
 */
import { z } from 'zod';
import type { LinkType, ObjectType } from '@subbrain/shared';
import type { Core } from '../core.ts';
import { json, str } from '../db/db.ts';
import { condense } from '../classifier/condense.ts';
import { extractJson } from '../classifier/ai-sdk-classifier.ts';
import { redactSecrets } from '../classifier/redact.ts';
import type { Classifier } from '../classifier/provider.ts';
import { normName } from '../services/mutations.ts';
import { loadTasks } from '../services/tasks.ts';
import { nowIso } from '../util/time.ts';
import { addEvidence, ensureObject, typeEnabled, upsertLink } from './store.ts';

export const ONTOLOGY_PROMPT_VERSION = 'ont-v1';

/** 도구 사전: [이름, 별칭...] — 대소문자·공백·기호 무시하고 단어 경계로 찾음 */
export const TOOL_DICT: string[][] = [
  ['Next.js', 'nextjs', '넥스트JS', '넥스트'], ['React', '리액트'], ['Vue', 'Vue.js', '뷰JS'], ['Svelte'], ['TypeScript', '타입스크립트'], ['JavaScript', '자바스크립트'],
  ['Python', '파이썬'], ['Node.js', 'nodejs', '노드JS'], ['Docker', '도커'], ['Kubernetes', 'k8s', '쿠버네티스'], ['PostgreSQL', 'Postgres', '포스트그레스'],
  ['SQLite'], ['MySQL'], ['Supabase', '수파베이스'], ['Firebase', '파이어베이스'], ['Vercel', '버셀'], ['Netlify', '네틀리파이'], ['AWS', '아마존 웹 서비스'],
  ['Cloudflare', '클라우드플레어'], ['GitHub', '깃허브'], ['Git', '깃'], ['Obsidian', '옵시디언'], ['Notion', '노션'], ['Figma', '피그마'], ['Excel', '엑셀'],
  ['Google Sheets', '구글 시트', '스프레드시트'], ['Slack', '슬랙'], ['Tailwind CSS', 'tailwind', '테일윈드'], ['Vite', '비트'], ['Electron', '일렉트론'],
  ['Unity', '유니티'], ['Blender', '블렌더', '블랜더'], ['Claude Code', '클로드 코드'], ['Codex', '코덱스'], ['Chrome 확장', 'Chrome extension', '크롬 확장', 'MV3'],
  ['MCP', 'Model Context Protocol'], ['Hono'], ['Zod'], ['Prisma', '프리즈마'], ['FastAPI'], ['Django', '장고'], ['Flutter', '플러터'], ['Swift', '스위프트'],
  ['Kotlin', '코틀린'], ['Rust', '러스트'], ['Go', 'Golang'], ['Redis', '레디스'], ['Stripe', '스트라이프'], ['WordPress', '워드프레스'], ['Canva', '캔바'],
];
function toolPatterns(): Array<{ name: string; re: RegExp }> {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  return TOOL_DICT.map(([name, ...al]) => ({ name: name!, re: new RegExp(`(?<![A-Za-z0-9가-힣])(?:${[name!, ...al].filter((a) => a.length >= 2).map(esc).join('|')})(?![A-Za-z0-9])`, 'i') }));
}
const TOOL_RE = toolPatterns();
/** 'Go'·'Git'·'Vite'는 일반 단어와 겹쳐 사용자 말에서 2번 넘게 나올 때만 */
const WEAK = new Set(['Go', 'Git', 'Vite', 'Swift', 'Rust', 'MCP', 'Codex']);

export interface ExtractStats { conversations: number; objectsCreated: number; linksCreated: number; suggestions: number; llmCalls: number; costUsd: number | null; inputTokens: number; outputTokens: number; skipped: number }
export const emptyStats = (): ExtractStats => ({ conversations: 0, objectsCreated: 0, linksCreated: 0, suggestions: 0, llmCalls: 0, costUsd: null, inputTokens: 0, outputTokens: 0, skipped: 0 });

/** 프로젝트·과제 객체를 기존 행과 맞춘다(이름·part_of). 규칙이므로 늘 확정 */
export function syncCoreObjects(core: Core, taskIds?: string[]): void {
  const db = core.db;
  for (const p of db.all<{ id: string; name: string; aliases_json: string; created_at: string }>('SELECT id, name, aliases_json, created_at FROM projects')) {
    const r = ensureObject(db, { type: 'project', name: p.name, aliases: json<string[]>(p.aliases_json, []), confidence: 1, origin: 'rule', ref: { table: 'projects', id: p.id }, forceAccept: true, evidence: null });
    if (r) db.run('UPDATE objects SET name=?, norm_name=?, first_seen_at=COALESCE(first_seen_at, ?) WHERE id=?', p.name, normName(p.name), p.created_at, r.id);
  }
  const tasks = loadTasks(core, taskIds ? { ids: taskIds } : {}).filter((t) => t.kind === 'task' && t.status !== '보관');
  for (const t of tasks) {
    const first = t.convs.at(-1), last = t.convs[0];
    const r = ensureObject(db, { type: 'task', name: t.title, confidence: 1, origin: 'rule', ref: { table: 'tasks', id: t.id }, forceAccept: true, evidence: null });
    if (!r) continue;
    db.run('UPDATE objects SET name=?, norm_name=?, first_seen_at=COALESCE(?, first_seen_at), last_seen_at=COALESCE(?, last_seen_at), mention_count=MAX(mention_count, ?) WHERE id=?',
      t.title, normName(t.title), first?.createdAt ?? null, t.lastActivityAt, t.convs.length, r.id);
    // part_of: 지금 프로젝트만 남기고 예전 것(규칙이 만든)은 끝냄
    const projObj = t.projectId ? db.value<string>("SELECT id FROM objects WHERE type='project' AND ref_table='projects' AND ref_id=?", t.projectId) : null;
    for (const l of db.all<{ id: number; dst_id: string }>("SELECT id, dst_id FROM links WHERE type='part_of' AND src_id=? AND origin='rule' AND ended_at IS NULL", r.id)) {
      if (l.dst_id !== projObj) db.run('UPDATE links SET ended_at=? WHERE id=?', nowIso(), l.id);
    }
    if (projObj) {
      const lk = upsertLink(db, { type: 'part_of', srcId: r.id, dstId: projObj, confidence: 1, origin: 'rule', forceAccept: true, evidence: null });
      if (lk) db.run('UPDATE links SET ended_at=NULL, valid_from=COALESCE(valid_from, ?), first_seen_at=COALESCE(?, first_seen_at), last_seen_at=COALESCE(?, last_seen_at) WHERE id=?', first?.createdAt ?? null, first?.createdAt ?? null, t.lastActivityAt, lk.id);
    }
    // 과제가 끝났으면 막힘 관계 해소(삭제하지 않음, 8.3)
    if (t.status === '완료') db.run("UPDATE links SET ended_at=COALESCE(ended_at, ?) WHERE type='blocked_by' AND src_id=? AND ended_at IS NULL", t.completedAt ?? nowIso(), r.id);
    void last;
  }
}

function excerptAround(text: string, idx: number): string {
  const s = Math.max(0, idx - 80), e = Math.min(text.length, idx + 160);
  return redactSecrets(`${s > 0 ? '…' : ''}${text.slice(s, e).replace(/\s+/g, ' ').trim()}${e < text.length ? '…' : ''}`).text;
}

/** 규칙 추출: 과제 하나(과제의 모든 주 대화) */
export function extractRulesForTask(core: Core, taskId: string, stats: ExtractStats = emptyStats()): ExtractStats {
  const db = core.db;
  syncCoreObjects(core, [taskId]);
  const tObj = db.value<string>("SELECT id FROM objects WHERE type='task' AND ref_table='tasks' AND ref_id=? AND status<>'merged'", taskId);
  if (!tObj) return stats;
  const before = { o: Number(db.value('SELECT COUNT(*) FROM objects') ?? 0), l: Number(db.value('SELECT COUNT(*) FROM links') ?? 0), s: Number(db.value('SELECT COUNT(*) FROM ontology_suggestions') ?? 0) };
  // 주제 → related_to (분류기가 붙인 task_topics)
  for (const tp of db.all<{ topic_id: string; confidence: number | null; created_at: string | null }>('SELECT topic_id, confidence, created_at FROM task_topics WHERE task_id=?', taskId)) {
    upsertLink(db, { type: 'related_to', srcId: tObj, dstId: tp.topic_id, confidence: Math.max(0.85, tp.confidence ?? 0.85), origin: 'rule', forceAccept: true, evidence: null });
  }
  // 결정 → decided (+ 결정 객체는 분류 때 이미 만들어짐)
  for (const d of db.all<{ id: string; properties_json: string | null; name: string; first_seen_at: string | null }>("SELECT id, properties_json, name, first_seen_at FROM objects WHERE type='decision' AND ref_table='tasks' AND ref_id=? AND status<>'merged'", taskId)) {
    const p = json<{ conversationId?: string } | null>(d.properties_json, null);
    upsertLink(db, { type: 'decided', srcId: tObj, dstId: d.id, confidence: 0.9, origin: 'rule', forceAccept: true, evidence: p?.conversationId ? { conversationId: p.conversationId, excerpt: d.name, confidence: 0.9, model: 'rule', at: d.first_seen_at } : null });
  }
  // 과제 사이 막힘(task_links)
  for (const tl of db.all<{ dst_task_id: string; confidence: number | null; reason: string | null; created_at: string | null }>("SELECT dst_task_id, confidence, reason, created_at FROM task_links WHERE src_task_id=? AND type='blocked_by'", taskId)) {
    syncCoreObjects(core, [tl.dst_task_id]);
    const dObj = db.value<string>("SELECT id FROM objects WHERE type='task' AND ref_table='tasks' AND ref_id=? AND status<>'merged'", tl.dst_task_id);
    if (dObj) upsertLink(db, { type: 'blocked_by', srcId: tObj, dstId: dObj, confidence: tl.confidence ?? 0.7, origin: 'rule', evidence: tl.reason ? { conversationId: null, excerpt: tl.reason, confidence: tl.confidence, model: 'rule', at: tl.created_at } : null });
  }
  // 도구 사전
  if (typeEnabled(db, 'tool')) {
    const convs = db.all<{ id: string }>("SELECT c.id FROM task_conversations tc JOIN conversations c ON c.id=tc.conversation_id WHERE tc.task_id=? AND tc.role='primary'", taskId);
    for (const c of convs) {
      const msgs = db.all<{ seq: number; role: string; content_md: string; created_at: string | null }>("SELECT seq, role, content_md, created_at FROM messages WHERE conversation_id=? AND role IN ('user','assistant') ORDER BY seq", c.id);
      for (const t of TOOL_RE) {
        let userHits = 0, asstHits = 0; let first: { seq: number; text: string; idx: number; at: string | null; user: boolean } | null = null;
        for (const m of msgs) {
          const mm = t.re.exec(m.content_md);
          if (!mm) continue;
          if (m.role === 'user') userHits++; else asstHits++;
          if (!first || (m.role === 'user' && !first.user)) first = { seq: m.seq, text: m.content_md, idx: mm.index, at: m.created_at, user: m.role === 'user' }; // 사용자 말을 근거로 우선
        }
        if (!first) continue;
        if (WEAK.has(t.name) && userHits < 2) continue;
        // 사용자가 직접 말한 도구가 더 확실. 사용자 1번 = 0.75(제안), 2번+ 또는 사용자+답 = 0.85+(확정), 답에만 3번+ = 0.62(제안), 답에만 1–2번 = 버림(코드 예시·일반 설명이 많음)
        const conf = Math.min(0.95, userHits >= 2 ? 0.9 : userHits === 1 ? (asstHits ? 0.85 : 0.75) : asstHits >= 3 ? 0.62 : 0.5);
        if (conf < 0.6) continue;
        const ev = { conversationId: c.id, messageSeq: first.seq, excerpt: excerptAround(first.text, first.idx), confidence: conf, model: 'rule', at: first.at };
        const o = ensureObject(db, { type: 'tool', name: t.name, confidence: conf, origin: 'rule', evidence: ev });
        if (o) upsertLink(db, { type: 'uses', srcId: tObj, dstId: o.id, confidence: conf, origin: 'rule', evidence: ev });
      }
    }
  }
  stats.objectsCreated += Number(db.value('SELECT COUNT(*) FROM objects') ?? 0) - before.o;
  stats.linksCreated += Number(db.value('SELECT COUNT(*) FROM links') ?? 0) - before.l;
  stats.suggestions += Number(db.value('SELECT COUNT(*) FROM ontology_suggestions') ?? 0) - before.s;
  return stats;
}

// ── LLM (ont-v1)
const OT = z.enum(['person', 'project', 'task', 'decision', 'tool', 'artifact', 'place', 'organization', 'topic']);
const LT = z.enum(['uses', 'decided', 'blocked_by', 'derived_from', 'references', 'part_of', 'supersedes', 'affects', 'located_at', 'related_to']);
const num01 = z.number().min(0).max(1);
export const OntologyExtractionSchema = z.object({
  objects: z.array(z.object({
    ref: z.string(), existing_id: z.string().nullable().default(null), type: OT, name: z.string().min(1).max(80),
    aliases: z.array(z.string()).max(5).default([]), properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    confidence: num01, evidence: z.string().max(400).default(''), message_seq: z.number().int().nullable().default(null),
  })).max(30).default([]),
  links: z.array(z.object({
    type: LT, src: z.string(), dst: z.string(), properties: z.record(z.string(), z.string()).default({}),
    confidence: num01, evidence: z.string().max(400).default(''), message_seq: z.number().int().nullable().default(null), ended: z.boolean().default(false),
  })).max(40).default([]),
});
export type OntologyExtraction = z.infer<typeof OntologyExtractionSchema>;

export function buildOntologyPrompt(input: { title: string; condensed: string; summary: string | null; decisions: string[]; openQuestions: string[]; candidates: Array<{ id: string; type: string; name: string }>; taskObjectId: string; enabledTypes: string[] }): { system: string; prompt: string } {
  const system = [
    '너는 사용자의 AI 대화에서 "객체"와 "관계"를 뽑는 추출기다. JSON 하나만 출력한다(설명·코드펜스 없이).',
    `객체 타입: ${input.enabledTypes.join(', ')} (이 목록 밖의 타입은 내지 마라). project·task 객체는 새로 만들지 말고 후보 목록의 id만 쓴다.`,
    '관계 타입과 허용 쌍: uses(과제·프로젝트·사람→도구·자료), decided(사람·과제→결정), blocked_by(과제→과제·결정·사람·조직·자료), derived_from(과제·결정·자료→과제·결정·자료), references(과제·결정→자료), part_of(사람→조직, 프로젝트→프로젝트), supersedes(결정→결정, 도구→도구), affects(결정→과제·프로젝트), located_at(과제·조직·사람→장소), related_to(약한 관계, 아껴 쓸 것).',
    '규칙: 대화에 실제로 나온 것만. 일반 상식·예시로만 나온 것은 빼라. 이름은 대화에 나온 표기 그대로, 짧게(80자 이내). 사람은 실명 대신 역할로 써도 된다("디자이너").',
    '후보 목록에 같은 것이 있으면 existing_id에 그 id를 넣어라. 관계의 src·dst는 객체 ref 또는 후보 id. "이 과제"는 id TASK.',
    'confidence: 대화에 분명히 적힌 것 0.9 이상, 추론이 필요한 것 0.6–0.8, 애매하면 빼라. evidence: 근거가 된 대화 문장 발췌(300자 이내), message_seq: 그 메시지 번호(모르면 null).',
    '막힘이 풀렸거나 결정이 취소됐다는 표현이 있으면 그 관계에 ended:true.',
    '출력 형식: {"objects":[{"ref":"o1","existing_id":null,"type":"tool","name":"Next.js","aliases":[],"properties":{},"confidence":0.9,"evidence":"…","message_seq":3}],"links":[{"type":"uses","src":"TASK","dst":"o1","properties":{},"confidence":0.9,"evidence":"…","message_seq":3,"ended":false}]}',
  ].join('\n');
  const prompt = [
    `대화 제목: ${input.title}`,
    input.summary ? `분류 요약: ${input.summary}` : '',
    input.decisions.length ? `결정: ${input.decisions.join(' / ')}` : '',
    input.openQuestions.length ? `열린 질문: ${input.openQuestions.join(' / ')}` : '',
    `후보(이미 있는 객체): ${input.candidates.length ? input.candidates.map((c) => `${c.id}=[${c.type}] ${c.name}`).join('; ') : '없음'}`,
    '--- 대화(줄이고 비밀정보 가림, 각 메시지 앞 #번호) ---',
    input.condensed,
  ].filter(Boolean).join('\n');
  return { system, prompt };
}

/** LLM 추출: 대화 하나. 같은 내용·프롬프트면 건너뜀 */
export async function extractLlmForConversation(core: Core, convId: string, classifier: Classifier, stats: ExtractStats = emptyStats(), opts: { force?: boolean } = {}): Promise<ExtractStats> {
  const db = core.db;
  if (!classifier.isLlm || !classifier.complete) return stats;
  const conv = db.get<{ id: string; title: string; task_id: string | null; content_hash: string; updated_at: string }>('SELECT id, title, task_id, content_hash, updated_at FROM conversations WHERE id=?', convId);
  if (!conv?.task_id) return stats;
  const task = db.get<{ kind: string; project_id: string | null; summary: string | null; open_questions_json: string | null }>('SELECT kind, project_id, summary, open_questions_json FROM tasks WHERE id=?', conv.task_id);
  if (!task || task.kind !== 'task') { stats.skipped++; return stats; } // 간단한 질문은 빼기(8.10 비용)
  const s = core.settings.get();
  if (s.llm.sensitiveProjectIds.includes(task.project_id ?? '') || s.llm.sensitiveKeywords.some((k) => k && conv.title.includes(k))) { stats.skipped++; return stats; } // 민감 프로젝트는 추출 안 함
  const run = db.get<{ content_hash: string; prompt_version: string }>('SELECT content_hash, prompt_version FROM ontology_runs WHERE conversation_id=?', convId);
  if (!opts.force && run && run.content_hash === conv.content_hash && run.prompt_version === ONTOLOGY_PROMPT_VERSION) { stats.skipped++; return stats; }
  syncCoreObjects(core, [conv.task_id]);
  const tObj = db.value<string>("SELECT id FROM objects WHERE type='task' AND ref_table='tasks' AND ref_id=? AND status<>'merged'", conv.task_id);
  if (!tObj) return stats;
  const msgs = db.all<{ seq: number; role: string; content_md: string; created_at: string | null }>('SELECT seq, role, content_md, created_at FROM messages WHERE conversation_id=? ORDER BY seq', convId);
  const condensed = condense(msgs.map((m) => ({ role: m.role as never, content: `#${m.seq} ${m.content_md}` })), { head: s.classification.condenseHead, tail: s.classification.condenseTail, middleChars: s.classification.condenseMiddleChars, redact: true });
  // 후보: 이 대화 글에 이름·별칭이 나오는 확정 객체 + 이 과제·프로젝트 + 최근 과제
  const textNorm = normName(msgs.map((m) => m.content_md).join(' ').slice(0, 200_000));
  const cands = new Map<string, { id: string; type: string; name: string }>();
  cands.set(tObj, { id: 'TASK', type: 'task', name: conv.title });
  for (const r of db.all<{ id: string; type: string; name: string; norm_name: string }>("SELECT id, type, name, norm_name FROM objects WHERE status='accepted' AND type NOT IN ('task') AND length(norm_name)>=2 ORDER BY mention_count DESC LIMIT 2000")) {
    if (cands.size >= 40) break;
    if (textNorm.includes(r.norm_name)) cands.set(r.id, { id: r.id, type: r.type, name: r.name });
  }
  for (const r of db.all<{ id: string; name: string }>("SELECT o.id, o.name FROM objects o JOIN tasks t ON t.id=o.ref_id WHERE o.type='task' AND o.ref_table='tasks' AND t.project_id IS ? AND o.id<>? AND o.status='accepted' ORDER BY t.last_activity_at DESC LIMIT 10", task.project_id, tObj)) {
    if (cands.size < 50) cands.set(r.id, { id: r.id, type: 'task', name: r.name });
  }
  const enabledTypes = db.all<{ key: string }>("SELECT key FROM object_types WHERE enabled=1 AND key NOT IN ('project','task')").map((r) => r.key);
  const decisions = db.all<{ name: string }>("SELECT name FROM objects WHERE type='decision' AND ref_id=? AND status<>'rejected'", conv.task_id).map((r) => r.name);
  const { system, prompt } = buildOntologyPrompt({ title: conv.title, condensed, summary: task.summary, decisions, openQuestions: json<Array<{ text: string }>>(task.open_questions_json, []).map((q) => q.text), candidates: [...cands.values()], taskObjectId: tObj, enabledTypes: [...enabledTypes, 'task', 'project'] });
  const res = await classifier.complete(system, prompt);
  stats.llmCalls++; stats.inputTokens += res.inputTokens; stats.outputTokens += res.outputTokens;
  if (res.costUsd !== null) stats.costUsd = (stats.costUsd ?? 0) + res.costUsd;
  let out: OntologyExtraction;
  try { out = OntologyExtractionSchema.parse(extractJson(res.text)); }
  catch { out = { objects: [], links: [] }; }
  applyExtraction(core, convId, tObj, out, res.model, [...cands.keys()], msgs, stats);
  db.run('INSERT INTO ontology_runs(conversation_id,content_hash,prompt_version,model,at,input_tokens,output_tokens,cost_usd) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET content_hash=excluded.content_hash, prompt_version=excluded.prompt_version, model=excluded.model, at=excluded.at, input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens, cost_usd=excluded.cost_usd',
    convId, conv.content_hash, ONTOLOGY_PROMPT_VERSION, res.model, nowIso(), res.inputTokens, res.outputTokens, res.costUsd);
  return stats;
}

/** 검증된 추출 결과를 저장(테스트에서 직접 부르기도 함) */
export function applyExtraction(core: Core, convId: string, taskObjectId: string, out: OntologyExtraction, model: string, candidateIds: string[], msgs: Array<{ seq: number; created_at: string | null }>, stats: ExtractStats = emptyStats()): ExtractStats {
  const db = core.db;
  const before = { o: Number(db.value('SELECT COUNT(*) FROM objects') ?? 0), l: Number(db.value('SELECT COUNT(*) FROM links') ?? 0), s: Number(db.value('SELECT COUNT(*) FROM ontology_suggestions') ?? 0) };
  const convAt = String(db.value('SELECT updated_at FROM conversations WHERE id=?', convId) ?? nowIso());
  const atOf = (seq: number | null) => (seq !== null ? msgs.find((m) => m.seq === seq)?.created_at ?? null : null) ?? convAt;
  const idByRef = new Map<string, string>([['TASK', taskObjectId]]);
  const known = new Set(candidateIds);
  for (const o of out.objects) {
    const ev = { conversationId: convId, messageSeq: o.message_seq, excerpt: redactSecrets(o.evidence || o.name).text, confidence: o.confidence, model, promptVersion: ONTOLOGY_PROMPT_VERSION, at: atOf(o.message_seq) };
    if (o.existing_id && (known.has(o.existing_id) || o.existing_id === 'TASK')) {
      const id = o.existing_id === 'TASK' ? taskObjectId : o.existing_id;
      idByRef.set(o.ref, id);
      if (o.existing_id !== 'TASK') ensureObject(db, { type: o.type, name: o.name, aliases: o.aliases, confidence: o.confidence, origin: 'llm', existingId: id, evidence: ev });
      continue;
    }
    if (o.type === 'project' || o.type === 'task') continue;           // 과제·프로젝트는 규칙이 만든다
    if (!typeEnabled(db, o.type)) continue;
    const r = ensureObject(db, { type: o.type, name: o.name, aliases: o.aliases, properties: o.properties, confidence: o.confidence, origin: 'llm', evidence: ev });
    if (r) idByRef.set(o.ref, r.id);
  }
  const resolve = (x: string) => idByRef.get(x) ?? (known.has(x) ? x : null);
  for (const l of out.links) {
    const src = resolve(l.src), dst = resolve(l.dst);
    if (!src || !dst) continue;
    if (l.type === 'part_of' && db.get("SELECT 1 FROM objects WHERE id=? AND type='task'", src)) continue; // 과제→프로젝트는 tasks.project_id에서만
    upsertLink(db, { type: l.type as LinkType, srcId: src, dstId: dst, confidence: l.confidence, origin: 'llm', properties: l.properties, ended: l.ended,
      evidence: { conversationId: convId, messageSeq: l.message_seq, excerpt: redactSecrets(l.evidence || '').text, confidence: l.confidence, model, promptVersion: ONTOLOGY_PROMPT_VERSION, at: atOf(l.message_seq) } });
  }
  stats.conversations++;
  stats.objectsCreated += Number(db.value('SELECT COUNT(*) FROM objects') ?? 0) - before.o;
  stats.linksCreated += Number(db.value('SELECT COUNT(*) FROM links') ?? 0) - before.l;
  stats.suggestions += Number(db.value('SELECT COUNT(*) FROM ontology_suggestions') ?? 0) - before.s;
  void addEvidence; void str;
  return stats;
}

/** 범위 고르기: all | changed(LLM 미추출·내용 바뀐 것) | taskIds */
export function conversationsForExtraction(core: Core, scope: 'all' | 'changed', taskIds?: string[]): string[] {
  const db = core.db;
  const base = `SELECT c.id FROM conversations c JOIN task_conversations tc ON tc.conversation_id=c.id AND tc.role='primary' JOIN tasks t ON t.id=tc.task_id WHERE t.kind='task' AND t.status<>'보관'`;
  const tf = taskIds?.length ? ` AND t.id IN (SELECT value FROM json_each('${JSON.stringify(taskIds).replace(/'/g, "''")}'))` : '';
  const ch = scope === 'changed' ? ` AND NOT EXISTS (SELECT 1 FROM ontology_runs r WHERE r.conversation_id=c.id AND r.content_hash=c.content_hash AND r.prompt_version='${ONTOLOGY_PROMPT_VERSION}')` : '';
  return db.all<{ id: string }>(`${base}${tf}${ch} ORDER BY c.updated_at DESC`).map((r) => r.id);
}
export type { ObjectType };
