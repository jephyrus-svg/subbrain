/**
 * 예시 데이터 (디자인 v3 예시 데이터와 같은 id·이름·수치, 오늘 = 2026-09-30 기준 절대 날짜).
 * `pnpm seed` → DB를 비우고 프로젝트 8 · 프로젝트 과제 41 · 간단한 질문 · 보관 과제 · 대화 · 메시지 · 결정 · 주제를 넣고,
 * 9/28~9/30 아침 요약을 엔진 규칙으로 만든 뒤 볼트를 만든다. 데이터 정의는 seed-data.ts.
 * 공유 목(mocks/json)은 이 시드 위에서 엔진 응답을 캡처해 만든다(`pnpm --filter @subbrain/core mocks`).
 */
import { seedOntology } from './seed-ontology.ts';
import { existsSync, rmSync, appendFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { MessageRole, SourceAi } from '@subbrain/shared';
import { CONVERSATION_URL, MOCK_MODEL } from '@subbrain/shared/constants';
import type { Core } from './core.ts';
import { sha256, shortSourceId } from './util/ids.ts';
import { addDays, getFixedNow, kstDate, localIso, normalizeIso, nowIso, setNow, tzOffsetMs } from './util/time.ts';
import { conversationHash } from './services/imports.ts';
import { normName, syncDecisionsCopy } from './services/mutations.ts';
import { refreshTask } from './services/tasks.ts';
import { generateDigest } from './digest/digest.ts';
import { KO_DATASET, type AutoTask, type ConvSpec, type SeedDataset, type TaskSpec } from './seed-data.ts';
import { buildEnDataset } from './seed-data-en.ts';

/** 지금 시드하는 데이터셋 (ko = 2026-09-30 고정 예시, en = 오늘 기준 영어 예시) */
let DS: SeedDataset = KO_DATASET;
export function seedDataset(lang: 'ko' | 'en', today?: string): SeedDataset { return lang === 'en' ? buildEnDataset(today ?? kstDate(nowIso())) : KO_DATASET; }

const Y = '2026';
/** 'MM-DD HH:MM' → local ISO */
const d = (s: string) => /T\d\d:/.test(s) ? wall(s) : /^\d{4}-/.test(s) ? localIso(s.slice(0, 10), `${s.slice(11, 16) || '12:00'}:00`) : localIso(`${Y}-${s.slice(0, 5)}`, `${s.slice(6, 11) || '12:00'}:00`);
/** keep a dataset ISO's wall-clock time but use the configured local offset */
const wall = (iso: string) => localIso(iso.slice(0, 10), iso.slice(11, 19));
const hex = (seed: string, n: number) => { let h = ''; let i = 0; while (h.length < n) h += sha256(`${seed}#${i++}`); return h.slice(0, n); };
const uuid = (seed: string) => { const h = hex(seed, 32); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };
/** ms → 'MM-DD HH:MM' (local) */
const fmt = (ms: number) => new Date(ms + tzOffsetMs()).toISOString().slice(0, 16).replace('T', ' ');

/** 메시지 total개를 k개로 나눔(각 2개 이상) */
function splitCount(total: number, k: number): number[] {
  const base = Math.floor(total / k), rem = total - base * k;
  return Array.from({ length: k }, (_, i) => base + (i < rem ? 1 : 0));
}
/** first~last 사이에 대화 k개를 배치 (마지막 대화는 last에 끝남) */
function spreadConvs(ai: SourceAi, title: string, first: string, last: string, parts: number[]): ConvSpec[] {
  const t0 = Date.parse(d(first)), t1 = Date.parse(d(last));
  const k = parts.length;
  if (k === 1) return [{ ai, title, from: first, to: last, n: parts[0]! }];
  const slot = (t1 - t0) / k;
  const dur = Math.max(10 * 60_000, Math.min(80 * 60_000, slot * 0.6));
  return parts.map((n, i) => {
    const end = i === k - 1 ? t1 : t0 + slot * i + dur;
    const start = i === k - 1 ? Math.max(t0 + slot * i, t1 - dur) : t0 + slot * i;
    return { ai, title: `${title}${DS.text.suffix[i % DS.text.suffix.length]}`, from: fmt(start), to: fmt(end), n };
  });
}
function autoToSpec(a: AutoTask): TaskSpec {
  const k = a.convCount ?? Math.max(1, Math.round(a.msgs / 11));
  return { id: a.id, title: a.title, project: a.project, state: a.state, summary: a.summary, next: a.next ?? null, detail: a.detail, conf: a.conf, topics: a.topics,
    convs: spreadConvs(a.ai, a.title, a.first, a.last, splitCount(a.msgs, k)) };
}
/** 정적 예시(삭제 배치 등)가 가리키는 대화 id를 고정 */
function quickSpecs(): TaskSpec[] {
  const seq = new Map<string, number>();
  return DS.QUICK.map(([title, project, ai, at, conf]) => {
    const day = d(at).slice(0, 10).replace(/-/g, '');
    const n = (seq.get(day) ?? 50) + 1; seq.set(day, n);
    const end = fmt(Date.parse(d(at)) + 60_000);
    const sid = DS.quickSids[title];
    return { id: `task_${day}_${n}`, title, project, state: 'quick', conf: conf ?? 0.95, convs: [{ ai, title, from: at, to: end, n: 2, ...(sid ? { sid } : {}) }] };
  });
}
/** 모든 과제 정의: 직접 적은 과제 + 자동 과제 + 간단한 질문 + 보관(블로그·채우기·4~6월) */
export function buildSpecs(ds: SeedDataset = DS): TaskSpec[] {
  DS = ds;
  const specs: TaskSpec[] = [...DS.EXPLICIT, ...DS.AUTO.map(autoToSpec), ...quickSpecs(),
    ...DS.ARCHIVED_BLOG.map((a): TaskSpec => ({ id: a.id, title: a.title, project: DS.archivedProject, state: 'archived', conf: 0.8, summary: DS.text.archivedSummary(a.title), next: null,
      convs: a.convs.map(([ai, from, to, n], i) => ({ ai, title: `${a.title}${DS.text.suffix[i % DS.text.suffix.length]}`, from, to, n })) }))];
  // 프로젝트 합계 채우기: 디자인 수치와의 차이만큼 보관 과제로
  for (const [pid, target] of Object.entries(DS.PROJECT_TOTALS)) {
    const convs = specs.filter((t) => t.project === pid).flatMap((t) => t.convs);
    const haveConv = convs.length, haveMsg = convs.reduce((n, c) => n + c.n, 0);
    const fillers = DS.FILLERS.filter((f) => f.project === pid);
    const dc = target.conv - haveConv, dm = target.msgs - haveMsg;
    if (dc === 0 && dm === 0) continue;
    if (!fillers.length || dc <= 0 || dm < dc * 2) throw new Error(`시드 합계를 맞출 수 없어요: ${pid} (대화 ${dc}, 메시지 ${dm})`);
    const wsum = fillers.reduce((n, f) => n + f.weight, 0);
    const alloc = fillers.map((f) => Math.max(1, Math.floor((dc * f.weight) / wsum)));
    for (let i = 0; alloc.reduce((a, b) => a + b, 0) < dc; i++) alloc[i % alloc.length]!++;
    const msgAlloc = splitCount(dm, dc);
    let mi = 0;
    fillers.forEach((f, i) => {
      const parts = msgAlloc.slice(mi, mi + alloc[i]!); mi += alloc[i]!;
      specs.push({ id: f.id, title: f.title, project: pid, state: 'archived', conf: 0.8, summary: DS.text.archivedSummary(f.title), next: null, convs: spreadConvs(f.ai, f.title, f.from, f.to, parts) });
    });
  }
  for (const a of DS.OLD_ARCHIVED) specs.push({ id: a.id, title: a.title, project: a.project, state: 'archived', conf: 0.8, summary: DS.text.archivedSummary(a.title), next: null,
    convs: spreadConvs(a.ai, a.title, a.from, a.to, splitCount(a.msgs, a.convs)) });
  const ids = new Set<string>();
  for (const t of specs) { if (ids.has(t.id)) throw new Error(`시드 과제 id 중복: ${t.id}`); ids.add(t.id); }
  return specs;
}

// ───────── 메시지 만들기
function genMessages(spec: ConvSpec, ending: 'unresolved' | 'resolved' | 'quick'): Array<{ role: MessageRole; content: string; createdAt: string }> {
  const out: Array<{ role: MessageRole; content: string; createdAt: string }> = [];
  const t0 = Date.parse(d(spec.from)), t1 = Date.parse(d(spec.to));
  for (let seq = 1; seq <= spec.n; seq++) {
    const role: MessageRole = seq % 2 === 1 ? 'user' : 'assistant';
    let content: string;
    const explicit = spec.msgs?.[seq];
    if (explicit) content = explicit[1];
    else if (ending === 'quick') content = role === 'user' ? DS.text.quickQ(spec.title) : DS.text.quickA(spec.title);
    else if (seq === spec.n - 1 && role === 'user') content = ending === 'resolved' ? DS.text.resolved : DS.text.unresolved;
    else { const pool = role === 'user' ? DS.text.U : DS.text.A; content = pool[Math.floor(seq / 2) % pool.length]!(spec.title); }
    const at = spec.n > 1 ? t0 + ((t1 - t0) * (seq - 1)) / (spec.n - 1) : t0;
    out.push({ role: explicit?.[0] ?? role, content, createdAt: new Date(Math.round(at / 1000) * 1000).toISOString() });
  }
  return out;
}

export async function seed(core: Core, opts: { vault?: boolean; lang?: 'ko' | 'en'; today?: string } = {}): Promise<{ projects: number; tasks: number; conversations: number; messages: number }> {
  const db = core.db;
  DS = seedDataset(opts.lang ?? 'ko', opts.today);
  const X = DS.extras, T = DS.times;
  const now = nowIso();
  // 1) 비우기
  const vaultRoot = core.settings.get().vault.path;
  const vaultInsideHome = vaultRoot && !relative(core.home, vaultRoot).startsWith('..');
  db.exec('PRAGMA foreign_keys = OFF');
  const keep = new Set(['object_types', 'link_types']);
  if (!vaultInsideHome) { keep.add('vault_files'); keep.add('vault_conflicts'); }
  for (const { name } of db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '%_fts%' AND name NOT LIKE 'sqlite_%'")) if (!keep.has(name)) db.run(`DELETE FROM "${name}"`);
  for (const f of ['messages_fts', 'tasks_fts', 'conversations_fts']) db.run(`INSERT INTO ${f}(${f}) VALUES ('delete-all')`);
  db.exec('PRAGMA foreign_keys = ON');
  if (vaultInsideHome && existsSync(vaultRoot)) for (const sub of ['tasks', 'projects', 'conversations', 'daily', '.subbrain', 'README.md']) rmSync(join(vaultRoot, sub), { recursive: true, force: true });
  // 2) 설정 (키 없음 → 규칙 분류기)
  core.settings.patch({ llm: { provider: 'anthropic', model: 'claude-haiku-4-5', dailyCostCapUsd: 10, sensitiveKeywords: X.sensitiveKeywords, sensitiveProjectIds: X.sensitiveProjectIds } });

  let convCount = 0, msgCount = 0;
  db.tx(() => {
    for (const p of DS.PROJECTS) db.run('INSERT INTO projects(id,name,aliases_json,status,color,summary,thresholds_json,priority,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      p.id, p.name, JSON.stringify(p.aliases), 'active', p.color, p.summary, p.thresholds ? JSON.stringify(p.thresholds) : null, p.priority ?? 1, d(T.projectCreated));
    const topicId = (k: string) => `obj_topic_${k}`;
    for (const [k, name, aliases] of DS.TOPICS) {
      db.run("INSERT INTO objects(id,type,name,norm_name,status,confidence,mention_count,origin) VALUES (?, 'topic', ?, ?, 'accepted', ?, 0, 'llm')", topicId(k), name, normName(name), 0.9);
      for (const a of aliases) db.run("INSERT OR IGNORE INTO aliases(object_id,alias,norm_alias,source) VALUES (?,?,?,'llm')", topicId(k), a, normName(a));
    }
    const all = buildSpecs();
    const pending: Array<{ taskId: string; spec: ConvSpec }> = [];
    for (const t of all) {
      const first = t.convs[0]!, last = t.convs.reduce((a, b) => (d(b.to) > d(a.to) ? b : a));
      const kind = t.state === 'quick' ? 'quick_question' : 'task';
      const resolution = t.state === 'done' ? 'resolved' : t.state === 'quick' ? 'resolved' : 'unresolved';
      const archived = t.state === 'archived';
      db.run(`INSERT INTO tasks(id,title,project_id,status,status_source,overrides_json,started_at,last_activity_at,next_step,origin,kind,resolution,summary,summary_detail_json,confidence,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, t.id, t.title, t.project, archived ? '보관' : '진행 중', archived ? 'user' : 'rule', JSON.stringify(archived ? ['status'] : []),
        d(first.from), d(last.to), t.next ?? null, 'auto', kind, resolution, t.summary ?? (kind === 'quick_question' ? DS.text.quickSummary(t.title) : null), JSON.stringify(t.detail ?? []), t.conf ?? 0.85, d(first.from), d(last.to));
      for (const c of t.convs) pending.push({ taskId: t.id, spec: c });
      for (const k of t.topics ?? []) db.run("INSERT INTO task_topics(task_id,topic_id,confidence,created_at,origin) VALUES (?,?,?,?,'seed')", t.id, topicId(k), 0.9, d(first.from));
    }
    // 대화 · 메시지 · 분류
    for (const { taskId, spec } of pending) {
      const t = all.find((x) => x.id === taskId)!;
      const sid = spec.sid ?? (spec.ai === 'gemini' ? hex(`${taskId}/${spec.title}/${spec.from}`, 16) : uuid(`${taskId}/${spec.title}/${spec.from}`));
      let convId = `conv_${spec.ai}_${shortSourceId(sid, 8)}`;
      if (db.get('SELECT 1 FROM conversations WHERE id=?', convId)) convId = `conv_${spec.ai}_${shortSourceId(sid, 12)}`;
      const isLast = t.convs.at(-1) === spec;
      const msgs = genMessages(spec, t.state === 'quick' ? 'quick' : t.state === 'done' && isLast ? 'resolved' : 'unresolved')
        .map((m) => ({ ...m, createdAt: kstIso(m.createdAt) }));
      const { hash, messageHashes } = conversationHash({ messages: msgs.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })) } as Parameters<typeof conversationHash>[0]);
      db.run(`INSERT INTO conversations(id,source_ai,source_id,source_url,title,created_at,updated_at,captured_at,message_count,content_hash,capture_method,raw_path,task_id,service_state,import_id,classified_hash)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, convId, spec.ai, sid, CONVERSATION_URL[spec.ai](sid), spec.title, d(spec.from), d(spec.to), d(T.capturedAt), spec.n, hash, spec.ai === 'claude-code' ? 'local_session' : 'export',
        spec.ai === 'claude-code' ? `~/.claude/projects/demo/${sid}.jsonl` : `raw/exports/${spec.ai}/${T.importDay}_export.zip`, taskId, 'active', spec.ai === 'chatgpt' ? T.importId : null, hash);
      db.run("INSERT INTO task_conversations(task_id,conversation_id,role) VALUES (?,?,'primary')", taskId, convId);
      if (spec.sharedWith) db.run("INSERT INTO task_conversations(task_id,conversation_id,role) VALUES (?,?,'shared')", spec.sharedWith, convId);
      msgs.forEach((m, i) => db.run('INSERT INTO messages(conversation_id,seq,role,content_md,created_at,content_hash) VALUES (?,?,?,?,?,?)', convId, i + 1, m.role, m.content, m.createdAt, messageHashes[i]!));
      convCount++; msgCount += msgs.length;
      const kind = t.state === 'quick' ? 'quick_question' : 'task';
      const resolution = t.state === 'done' || t.state === 'quick' ? 'resolved' : 'unresolved';
      const evidence = spec.evidence ?? (isLast ? (t.state === 'done' ? DS.text.evDone : t.state === 'quick' ? DS.text.evQuick : DS.text.evOpen) : null);
      const clsAt = new Date(Date.parse(d(spec.to)) + 5 * 60_000 + 30_000).toISOString();
      const clsId = db.run(`INSERT INTO classifications(conversation_id,kind,resolution,summary,next_step,evidence,project_guess,topics_json,confidence,model,prompt_version,input_tokens,output_tokens,cost_usd,created_at,detail_json,decisions_json,open_questions_json,same_task_candidates_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, convId, kind, resolution, spec.summary ?? t.summary ?? DS.text.convSummary(spec.title), isLast ? t.next ?? null : null, evidence,
        t.project ? DS.PROJECTS.find((p) => p.id === t.project)!.name : null, JSON.stringify(t.topics ?? []), t.conf ?? 0.85, 'claude-haiku-4-5', 'cls-v1', 400 + spec.n * 120, 240, null,
        kstIso(clsAt), JSON.stringify(isLast ? t.detail ?? [] : []), '[]', '[]', '[]').lastInsertRowid;
      if (isLast) db.run('UPDATE tasks SET classification_id=? WHERE id=?', clsId, taskId);
    }
    // 결정 · 열린 질문 · 링크 · 제안
    for (const [id, task, text, conv, ai, atS] of DS.DECISIONS) {
      const at = d(atS);
      db.run("INSERT INTO objects(id,type,name,norm_name,ref_table,ref_id,properties_json,status,confidence,first_seen_at,last_seen_at,mention_count,origin) VALUES (?, 'decision', ?, ?, 'tasks', ?, ?, 'accepted', 0.9, ?, ?, 1, 'llm')",
        id, text, normName(text), task, JSON.stringify({ conversationId: conv, sourceAi: ai, decidedAt: at, valid: true, overridden: false }), at, at);
    }
    db.run('UPDATE tasks SET open_questions_json=?, resume_prompt=?, resume_prompt_at=? WHERE id=?', JSON.stringify(DS.COPY_OPEN_QUESTIONS), DS.COPY_RESUME_PROMPT, d(X.copyResumeAt), X.copyTaskId);
    for (const l of X.taskLinks) db.run('INSERT INTO task_links(src_task_id,dst_task_id,type,confidence,reason,created_at) VALUES (?,?,?,?,?,?)', l.src, l.dst, l.type, l.conf, l.reason, d(l.at));
    for (const l of X.projectLinks) db.run('INSERT INTO project_links(project_a,project_b,reason,shared_topic_ids_json,weight,created_at) VALUES (?,?,?,?,?,?)', l.a, l.b, l.reason, JSON.stringify(l.topics), l.w, now);
    for (const m of X.mergeSuggestions) db.run("INSERT INTO task_merge_suggestions(id,task_a,task_b,suggested_primary,confidence,reason,state,created_at) VALUES (?,?,?,?,?,?, 'pending', ?)",
      m.id, m.a, m.b, m.primary, m.conf, m.reason, d(m.at).replace(/:00([+-]\d\d:\d\d)$/, ':11$1'));
    // 주제 통계
    db.run(`UPDATE objects SET mention_count=(SELECT COUNT(*) FROM task_topics tt WHERE tt.topic_id=objects.id) * 3,
      first_seen_at=(SELECT MIN(t.started_at) FROM task_topics tt JOIN tasks t ON t.id=tt.task_id WHERE tt.topic_id=objects.id),
      last_seen_at=(SELECT MAX(t.last_activity_at) FROM task_topics tt JOIN tasks t ON t.id=tt.task_id WHERE tt.topic_id=objects.id) WHERE type='topic'`);
    // 상태 계산 → 결정 사본
    for (const t of all) { refreshTask(core, t.id, 'rule', { silent: true }); syncDecisionsCopy(core, t.id); }
    // 1.2.0 예시: 다른 곳에서 이어감(handoff) 과제 1개 · 분류 불가(blocked) 과제 1개 · 새 프로젝트 제안 1개(프로젝트 없는 과제)
    const latestCls = (taskId: string) => db.value<number>('SELECT classification_id FROM tasks WHERE id=?', taskId)!;
    {
      const tid = X.handoff.taskId, convId = db.value<string>("SELECT conversation_id FROM task_conversations WHERE task_id=? AND role='primary' LIMIT 1", tid)!;
      const ho = { label: X.handoff.label, target: X.handoff.target, detectedBy: 'both' as const, evidence: X.handoff.evidence, conversationId: convId };
      db.run("UPDATE classifications SET handoff_json=?, evidence=?, prompt_version='cls-v2' WHERE id=?", JSON.stringify(ho), ho.evidence, latestCls(tid));
      db.run('UPDATE tasks SET handoff_json=? WHERE id=?', JSON.stringify(ho), tid);
    }
    {
      // 1.4.0 예시: 대화 결과 — 넘겨준 대화는 moved(대화 완료, 과제는 진행 중), 진행 중 과제 하나는 interrupted(토큰 한도)
      const setOutcome = (tid: string, o: { outcome: string; target: string | null; evidence: string | null; reason: string | null; detectedBy: string }) => {
        const convId = db.value<string>("SELECT conversation_id FROM task_conversations WHERE task_id=? AND role='primary' ORDER BY rowid DESC LIMIT 1", tid)!;
        db.run("UPDATE classifications SET conversation_outcome=?, outcome_json=?, prompt_version='cls-v4' WHERE id=?", o.outcome, JSON.stringify(o), latestCls(tid));
        db.run('UPDATE conversations SET outcome=?, outcome_json=? WHERE id=?', o.outcome, JSON.stringify(o), convId);
      };
      setOutcome(X.handoff.taskId, { outcome: 'moved', target: X.handoff.target, evidence: X.handoff.evidence, reason: null, detectedBy: 'both' });
      const intTid = db.value<string>("SELECT id FROM tasks WHERE status='진행 중' AND kind='task' AND handoff_json IS NULL ORDER BY last_activity_at DESC LIMIT 1");
      if (intTid) setOutcome(intTid, { outcome: 'interrupted', target: null, evidence: X.interrupted.evidence, reason: X.interrupted.reason, detectedBy: 'rule' });
    }
    {
      // 이미 '확인 필요'(확신도 0.55)인 과제를 고른다 → 디자인 v3 수치(확인 필요 3)가 그대로
      const tid = X.blocked.taskId;
      db.run("UPDATE classifications SET state='blocked', blocked_reason='PROHIBITED_CONTENT', blocked_model='gemini-3.5-flash-lite', model=?, raw_confidence=NULL, prompt_version='cls-v2', evidence=? WHERE id=?",
        MOCK_MODEL, X.blocked.evidence, latestCls(tid));
    }
    {
      const ps = X.projectSuggestion, tid = ps.taskId, convId = db.value<string>("SELECT conversation_id FROM task_conversations WHERE task_id=? AND role='primary' LIMIT 1", tid)!;
      const at = d(ps.at);
      db.run("INSERT INTO project_suggestions(id,name,norm_name,alt_names_json,state,created_at,updated_at) VALUES ('psg_seed01',?,?,?,'pending',?,?)", ps.name, normName(ps.name), JSON.stringify(ps.alt), at, at);
      db.run('INSERT INTO project_suggestion_tasks(suggestion_id,task_id,conversation_id,suggested_name,confidence,created_at) VALUES (?,?,?,?,?,?)', 'psg_seed01', tid, convId, ps.name, 0.72, at);
      db.run("UPDATE classifications SET new_project_suggestion=? WHERE id=?", ps.name, latestCls(tid));
    }
    // 이벤트(타임라인·요약용). 보관은 마지막 대화 + 14일(늦어도 9/28 21:00)에 사용자가 옮긴 것으로
    const archiveAt = (last: string) => { const day = addDays(kstDate(last), 14); return localIso(day < T.archiveCap ? day : T.archiveCap, '21:00:00'); };
    const th = core.settings.get().thresholds;
    for (const t of all) {
      const convs = db.all<{ id: string; created_at: string; updated_at: string; message_count: number }>("SELECT c.id, c.created_at, c.updated_at, c.message_count FROM task_conversations tc JOIN conversations c ON c.id=tc.conversation_id WHERE tc.task_id=? AND tc.role='primary' ORDER BY c.created_at", t.id);
      convs.forEach((c, i) => {
        db.run("INSERT INTO events(at,type,task_id,conversation_id,actor,payload_json) VALUES (?,?,?,?, 'extension', ?)", c.created_at, i === 0 ? 'conversation_started' : 'message_added', t.id, c.id, JSON.stringify(i === 0 ? { sourceAi: c.id.split('_')[1], via: 'export' } : { added: c.message_count, via: 'export' }));
        if (i === 0 && kstDate(c.updated_at) !== kstDate(c.created_at)) db.run("INSERT INTO events(at,type,task_id,conversation_id,actor,payload_json) VALUES (?, 'message_added', ?, ?, 'extension', ?)", c.updated_at, t.id, c.id, JSON.stringify({ added: Math.ceil(c.message_count / 3), via: 'export' }));
      });
      const row = db.get<{ status: string; completed_at: string | null; last_activity_at: string }>('SELECT status, completed_at, last_activity_at FROM tasks WHERE id=?', t.id)!;
      if (row.status === '완료' && row.completed_at) {
        db.run("INSERT INTO events(at,type,task_id,actor,payload_json) VALUES (?, 'status_changed', ?, 'classifier', ?)", row.completed_at, t.id, JSON.stringify({ from: '진행 중', to: '완료' }));
        db.run("INSERT INTO events(at,type,task_id,actor,payload_json) VALUES (?, 'completed', ?, 'classifier', ?)", row.completed_at, t.id, JSON.stringify({ completionReason: 'resolved' }));
      }
      if (row.status === '멈춤' || t.state === 'archived') {
        const day = addDays(kstDate(row.last_activity_at), th.inProgressMaxDays + 1);
        db.run("INSERT INTO events(at,type,task_id,actor,payload_json) VALUES (?, 'status_changed', ?, 'rule', ?)", localIso(day, '03:00:00'), t.id, JSON.stringify({ from: '진행 중', to: '멈춤', staleDays: th.inProgressMaxDays + 1 }));
      }
      if (t.state === 'archived') db.run("INSERT INTO events(at,type,task_id,actor,payload_json) VALUES (?, 'status_changed', ?, 'user', ?)", archiveAt(row.last_activity_at), t.id, JSON.stringify({ from: '멈춤', to: '보관', field: 'status', addedOverride: 'status' }));
    }
    // 수집 상태 · 가져오기 기록 (MVP = 내보내기 가져오기)
    db.run("INSERT INTO sync_state(source_ai,last_import_at,adapter_health,methods_json) VALUES ('chatgpt',?, 'ok', '[\"export\"]'), ('claude',?, 'ok', '[\"export\"]')", d(T.syncChatgpt), d(T.syncClaude));
    const gptConvs = Number(db.value("SELECT COUNT(*) FROM conversations WHERE source_ai='chatgpt'") ?? 0);
    const gptMsgs = Number(db.value("SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.source_ai='chatgpt'") ?? 0);
    db.run(`INSERT INTO import_batches(id,source_ai,file_name,file_hash,imported_at,conversations_new,conversations_updated,errors_json,state,file_size,file_path,created_at,started_at,finished_at,options_json,preview_json,progress_json,result_json)
      VALUES (?,'chatgpt',?,?,?,?,0,'[]','done',187334656,NULL,?,?,?,?,?,?,?)`,
      T.importId, `chatgpt-export-${T.importDay}.zip`, sha256('seed-import'), d(T.syncChatgpt), gptConvs, d(T.importCreated), d(T.importStarted), d(T.importFinished), JSON.stringify({ classify: true, maxCostUsd: 10 }),
      JSON.stringify({ sourceAi: 'chatgpt', detectedFormat: 'chatgpt_export_zip', formatVersion: null, conversationsTotal: gptConvs, conversationsNew: gptConvs, conversationsUpdated: 0, conversationsUnchanged: 0, messagesTotal: gptMsgs,
        dateRange: { from: db.value<string>("SELECT MIN(created_at) FROM conversations WHERE source_ai='chatgpt'"), to: db.value<string>("SELECT MAX(updated_at) FROM conversations WHERE source_ai='chatgpt'") }, quickQuestionPrefiltered: 0, estimate: { model: 'claude-haiku-4-5', inputTokens: 0, outputTokens: 0, costUsd: null, note: DS.text.sampleNote }, warnings: [] }),
      JSON.stringify({ phase: 'done', processed: gptConvs, total: gptConvs, percent: 100, currentLabel: DS.text.doneLabel, etaSec: 0 }),
      JSON.stringify({ conversationsNew: gptConvs, conversationsUpdated: 0, skippedDuplicates: 0, tasksCreated: gptConvs, classified: gptConvs, classificationDeferred: 0, actualCostUsd: null, unfinishedTasks: 0 }));
  });
  // 2-1) 1.7.0 예시 온톨로지(웹 관계 화면 시안과 같은 그림)
  db.tx(() => { seedOntology(core, DS.ontology); });
  // 3) 아침 요약: 9/28~9/30을 그날 아침 8시 기준으로 엔진 규칙이 생성
  const prevNow = getFixedNow(); // 테스트가 고정한 시계를 되돌린다(env가 아니라 현재 고정값)
  try {
    for (const day of T.digestDays) { setNow(localIso(day, T.digestAt)); generateDigest(core, day); }
  } finally { setNow(prevNow); }
  // 4) 볼트
  if (opts.vault !== false && vaultRoot) {
    await core.vault.regenerateAll();
    // 충돌 예시: 사용자가 Obsidian에서 과제 노트를 고친 상황 → 다음 생성 때 백업 후 덮어씀
    const p = db.value<string>("SELECT path FROM vault_files WHERE entity_type='task' AND entity_id=?", X.vaultConflict.taskId);
    if (p && existsSync(join(vaultRoot, p))) { appendFileSync(join(vaultRoot, p), `\n\n${X.vaultConflict.note}\n`); core.vault.writeEntity('task', X.vaultConflict.taskId); }
  }
    return { projects: DS.PROJECTS.length, tasks: Number(db.value('SELECT COUNT(*) FROM tasks') ?? 0), conversations: convCount, messages: msgCount };
}

function kstIso(utcIso: string): string {
  return normalizeIso(utcIso)!;
}
