/**
 * 1.5.0 로컬 세션 수집기 (계약 §12.10).
 *  - 파일마다 (경로, inode, 크기, 읽은 위치, 파서 상태)를 collector_files에 저장 → 늘어난 바이트만 줄 단위 스트리밍(파일 전체를 메모리에 안 올림).
 *  - 끝이 줄바꿈으로 안 끝난 마지막 줄은 다음 검사로(쓰는 중). inode가 바뀌거나 크기가 줄면 처음부터 다시(내용 해시로 중복 없이 갱신).
 *  - 같은 루트 세션(Claude sessionId, Codex session_meta.session_id)의 파일(부모 + 하위 에이전트)을 대화 하나로 합친다.
 *  - 넘겨준 채팅 대화 ↔ 세션: 합치기 제안(kind handoff_session) — 자동으로 합치지 않음.
 */
import { createReadStream, existsSync, readdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CollectorConfig, CollectorEstimate, CollectorSourceStatus, CollectorStatus, HandoffSessionMatch, LocalSourceAi, PutCollectorConfigBody } from '@subbrain/shared';
import type { Core } from '../core.ts';
import { json, str } from '../db/db.ts';
import { enqueueClassification } from '../services/classify.ts';
import { upsertConversation } from '../services/imports.ts';
import { priceUsd } from '../classifier/pricing.ts';
import { randomId } from '../util/ids.ts';
import { bigrams, dice } from '../util/similarity.ts';
import { nowIso, nowMs, toKstIso } from '../util/time.ts';
import { baseName, feed, finalMessages, newState, sessionTitle, type FileState, type ParseOpts } from './parsers.ts';

export const DEFAULT_COLLECTOR_CONFIG: CollectorConfig = {
  enabled: false,
  sources: [{ sourceAi: 'claude-code', root: '~/.claude/projects', enabled: true }, { sourceAi: 'codex', root: '~/.codex/sessions', enabled: true }],
  pollIntervalSec: 20, toolOutputMaxChars: 600, toolInputMaxChars: 300, excludeCwdPatterns: [], classify: true,
};
/** 세션이 이만큼 조용하면 분류(답이 이어지는 중엔 안 함) */
export const QUIET_MS = 10 * 60_000;
const LABEL: Record<LocalSourceAi, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };

const expand = (p: string) => resolve(p.startsWith('~') ? join(homedir(), p.slice(1)) : p);
function getState<T>(core: Core, key: string, dflt: T): T { return json<T>(core.db.value<string>('SELECT value_json FROM collector_state WHERE key=?', key), dflt); }
function setState(core: Core, key: string, v: unknown): void { core.db.run('INSERT INTO collector_state(key,value_json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json', key, JSON.stringify(v)); }

export function collectorConfig(core: Core): CollectorConfig { return { ...DEFAULT_COLLECTOR_CONFIG, ...getState<Partial<CollectorConfig>>(core, 'config', {}) }; }
export function putCollectorConfig(core: Core, b: PutCollectorConfigBody): CollectorConfig {
  const next = { ...collectorConfig(core), ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) } as CollectorConfig;
  setState(core, 'config', next);
  return next;
}

interface BackfillInfo { state: 'never' | 'running' | 'done' | 'failed'; startedAt: string | null; finishedAt: string | null; filesDone: number; filesTotal: number; jobId: string | null }
type ErrItem = { file: string; message: string; at: string };
function pushError(core: Core, ai: LocalSourceAi, e: ErrItem): void { setState(core, `errors:${ai}`, [e, ...getState<ErrItem[]>(core, `errors:${ai}`, [])].slice(0, 10)); }

export function collectorStatus(core: Core, watching: boolean): CollectorStatus {
  const config = collectorConfig(core);
  const sources: CollectorSourceStatus[] = config.sources.map((s) => {
    const root = expand(s.root);
    const agg = core.db.get<{ n: number; size: number; off: number; last: string | null }>('SELECT COUNT(*) n, COALESCE(SUM(size),0) size, COALESCE(SUM(offset),0) off, MAX(updated_at) last FROM collector_files WHERE source_ai=?', s.sourceAi)!;
    const sessions = Number(core.db.value("SELECT COUNT(*) FROM conversations WHERE source_ai=?", s.sourceAi) ?? 0);
    return {
      sourceAi: s.sourceAi, root, rootExists: existsSync(root), enabled: s.enabled, files: Number(agg.n), bytesTotal: Number(agg.size), bytesIngested: Number(agg.off), sessions,
      lastScanAt: getState<string | null>(core, `lastScan:${s.sourceAi}`, null), lastIngestAt: agg.last ?? null,
      backfill: getState<BackfillInfo>(core, `backfill:${s.sourceAi}`, { state: 'never', startedAt: null, finishedAt: null, filesDone: 0, filesTotal: 0, jobId: null }),
      errors: getState<ErrItem[]>(core, `errors:${s.sourceAi}`, []),
    };
  });
  return { config, watching, sources, redactedSecrets: getState<number>(core, 'redacted', 0) };
}

/** 루트 아래 .jsonl 전부(정렬). Claude 하위 에이전트(<세션>/subagents/agent-*.jsonl)도 포함 */
export function listSessionFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const e of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.jsonl')) out.push(join(e.parentPath ?? (e as unknown as { path: string }).path, e.name));
  }
  return out.sort();
}

/** 파일 하나: 늘어난 바이트만 읽어 상태를 갱신. 바뀐 세션 키를 돌려줌 */
export async function ingestFile(core: Core, ai: LocalSourceAi, path: string, opts: ParseOpts): Promise<{ sessionKey: string | null; bytes: number; reset: boolean } | null> {
  const db = core.db;
  let st0: ReturnType<typeof statSync>;
  try { st0 = statSync(path); } catch { return null; }
  const inode = `${st0.dev}:${st0.ino}`, size = st0.size;
  const row = db.get<{ inode: string | null; size: number; offset: number; state_json: string | null; session_key: string | null }>('SELECT inode,size,offset,state_json,session_key FROM collector_files WHERE path=?', path);
  let reset = false;
  let offset = row ? Number(row.offset) : 0;
  let state: FileState = row?.state_json ? json<FileState>(row.state_json, newState(ai, path)) : newState(ai, path);
  if (row && (row.inode !== inode || size < offset)) { reset = true; offset = 0; state = newState(ai, path); } // 교체·잘림
  if (row && !reset && size === offset) return { sessionKey: str(row.session_key), bytes: 0, reset: false };
  const redBefore = state.redacted;
  // 스트리밍: 청크 → 줄. 마지막 줄바꿈 뒤의 덜 써진 줄은 읽은 위치에 넣지 않는다
  let consumed = 0; let carry: Buffer[] = []; let carryLen = 0;
  if (size > offset) {
    const stream = createReadStream(path, { start: offset, end: size - 1, highWaterMark: 1 << 20 });
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      let start = 0;
      for (let i = chunk.indexOf(10); i !== -1; i = chunk.indexOf(10, start)) {
        const piece = chunk.subarray(start, i);
        const lineBuf = carryLen ? Buffer.concat([...carry, piece]) : piece;
        consumed += lineBuf.length + 1;
        carry = []; carryLen = 0;
        feed(state, lineBuf.toString('utf8'), opts);
        start = i + 1;
      }
      if (start < chunk.length) { const rest = chunk.subarray(start); carry.push(Buffer.from(rest)); carryLen += rest.length; }
      if (carryLen > 64 << 20) { consumed += carryLen; carry = []; carryLen = 0; state.skippedLines++; } // 64MB 넘는 한 줄(이미지 덩어리)은 건너뜀
    }
  }
  const newOffset = offset + consumed;
  db.run(`INSERT INTO collector_files(path,source_ai,inode,size,offset,session_key,is_subagent,state_json,lines,updated_at,error) VALUES (?,?,?,?,?,?,?,?,?,?,NULL)
    ON CONFLICT(path) DO UPDATE SET inode=excluded.inode,size=excluded.size,offset=excluded.offset,session_key=excluded.session_key,is_subagent=excluded.is_subagent,state_json=excluded.state_json,updated_at=excluded.updated_at,error=NULL`,
    path, ai, inode, size, newOffset, state.sessionKey, state.isSubagent ? 1 : 0, JSON.stringify(state), 0, nowIso());
  if (state.redacted > redBefore) setState(core, 'redacted', getState<number>(core, 'redacted', 0) + (state.redacted - redBefore));
  return { sessionKey: state.sessionKey, bytes: consumed, reset };
}

/** 세션 키 하나 → 대화(부모 + 하위 에이전트 메시지를 시간순으로) */
export function buildSession(core: Core, ai: LocalSourceAi, sessionKey: string, cfg: CollectorConfig): { conversationId: string; state: 'new' | 'updated' | 'unchanged' } | null {
  const rows = core.db.all<{ path: string; state_json: string; is_subagent: number }>('SELECT path, state_json, is_subagent FROM collector_files WHERE source_ai=? AND session_key=? ORDER BY is_subagent, path', ai, sessionKey);
  const states = rows.map((r) => json<FileState | null>(r.state_json, null)).filter((s): s is FileState => !!s);
  if (!states.length) return null;
  const main = states.find((s) => !s.isSubagent) ?? states[0]!;
  const cwd = main.cwd ?? states.find((s) => s.cwd)?.cwd ?? null;
  if (cwd && cfg.excludeCwdPatterns.some((p) => p && cwd.includes(p))) return null;
  const tagged = states.flatMap((s, si) => finalMessages(s).map((m, i) => ({ ...m, k: si, i })));
  tagged.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.k - b.k || a.i - b.i);
  if (!tagged.some((m) => m.role === 'user')) return null;      // 사람 말이 없는 세션(하위 에이전트만 등)은 아직 대화로 안 만듦
  const kst = (iso: string | null) => (iso ? toKstIso(Date.parse(iso)) : null);
  const first = tagged[0]!.createdAt, last = tagged.at(-1)!.createdAt;
  const meta = `작업 폴더: ${cwd ?? '알 수 없음'} · ${LABEL[ai]}${main.version ? ` ${main.version}` : ''}${states.length > 1 ? ` · 하위 에이전트 ${states.length - 1}개` : ''}`;
  const res = upsertConversation(core, {
    sourceAi: ai, sourceId: sessionKey, url: null, title: sessionTitle(main), createdAt: kst(main.createdAt ?? first), updatedAt: kst(last),
    messages: [{ role: 'system', content: meta, createdAt: kst(first) }, ...tagged.map((m) => ({ role: m.role, content: m.content, createdAt: kst(m.createdAt) }))],
    archived: false, inServiceProject: false, hasUnextractedArtifact: false,
  }, { importId: null, rawPath: rows.find((r) => !r.is_subagent)?.path ?? rows[0]!.path, captureMethod: 'local_session' });
  core.db.run('UPDATE conversations SET cwd=? WHERE id=?', cwd, res.conversationId);
  if (main.explicitRef) setState(core, `ref:${res.conversationId}`, main.explicitRef);
  return { conversationId: res.conversationId, state: res.state };
}

/** 소스 하나 검사(감시·scan·backfill 공통). files를 주면 그 파일만 */
export async function scanSource(core: Core, ai: LocalSourceAi, opts: { files?: string[]; onFile?: (done: number, total: number) => void; cancelled?: () => boolean } = {}): Promise<{ files: number; bytes: number; changed: string[] }> {
  const cfg = collectorConfig(core);
  const src = cfg.sources.find((s) => s.sourceAi === ai);
  if (!src) return { files: 0, bytes: 0, changed: [] };
  const root = expand(src.root);
  const files = opts.files?.length ? opts.files.map(expand) : listSessionFiles(root);
  const popts: ParseOpts = { toolInputMaxChars: cfg.toolInputMaxChars, toolOutputMaxChars: cfg.toolOutputMaxChars };
  const dirty = new Set<string>(); let bytes = 0, done = 0;
  for (const f of files) {
    if (opts.cancelled?.()) break;
    try {
      const r = await ingestFile(core, ai, f, popts);
      if (r && (r.bytes > 0 || r.reset) && r.sessionKey) dirty.add(r.sessionKey);
      bytes += r?.bytes ?? 0;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      core.db.run('UPDATE collector_files SET error=? WHERE path=?', message, f);
      pushError(core, ai, { file: f, message, at: nowIso() });
    }
    opts.onFile?.(++done, files.length);
  }
  const changed: string[] = [];
  for (const k of dirty) {
    const r = buildSession(core, ai, k, cfg);
    if (r && r.state !== 'unchanged') changed.push(r.conversationId);
  }
  setState(core, `lastScan:${ai}`, nowIso());
  if (changed.length) suggestHandoffLinks(core, changed);
  return { files: files.length, bytes, changed };
}

// ── 넘겨준 대화 ↔ 세션 합치기 제안
const CHAT = ['chatgpt', 'claude', 'gemini', 'grok'];
const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.·]+/g, '');
export function suggestHandoffLinks(core: Core, sessionConvIds: string[]): number {
  const db = core.db; let created = 0;
  for (const sid of sessionConvIds) {
    const s = db.get<{ id: string; source_ai: LocalSourceAi; created_at: string; cwd: string | null; task_id: string | null; title: string }>('SELECT id, source_ai, created_at, cwd, task_id, title FROM conversations WHERE id=?', sid);
    if (!s?.task_id) continue;
    const sUsers = db.all<{ content_md: string; created_at: string | null }>("SELECT content_md, created_at FROM messages WHERE conversation_id=? AND role='user' ORDER BY seq LIMIT 3", sid);
    const start = Date.parse(sUsers[0]?.created_at ?? s.created_at);
    const sTask = db.get<{ project_id: string | null }>('SELECT project_id FROM tasks WHERE id=?', s.task_id);
    const ref = getState<{ sourceAi: string; sourceId: string } | null>(core, `ref:${sid}`, null);
    const cwdName = s.cwd ? norm(baseName(s.cwd)) : '';
    const cands = db.all<{ id: string; source_ai: string; source_id: string; updated_at: string; title: string; task_id: string; project_id: string | null; handoff_json: string | null; outcome: string | null; outcome_json: string | null; pname: string | null }>(
      `SELECT c.id, c.source_ai, c.source_id, c.updated_at, c.title, c.task_id, t.project_id, t.handoff_json, c.outcome, c.outcome_json, p.name AS pname
       FROM conversations c JOIN tasks t ON t.id=c.task_id LEFT JOIN projects p ON p.id=t.project_id
       WHERE c.source_ai IN (SELECT value FROM json_each(?)) AND c.task_id<>? AND (c.outcome='moved' OR t.handoff_json IS NOT NULL ${ref ? 'OR (c.source_ai=? AND c.source_id=?)' : ''})`,
      JSON.stringify(CHAT), s.task_id, ...(ref ? [ref.sourceAi, ref.sourceId] : []));
    let best: { m: HandoffSessionMatch; c: (typeof cands)[number] } | null = null;
    for (const c of cands) {
      const explicit = !!ref && c.source_ai === ref.sourceAi && c.source_id === ref.sourceId;
      const target = json<{ target?: string | null } | null>(c.outcome_json, null)?.target ?? json<{ target?: string | null } | null>(c.handoff_json, null)?.target ?? null;
      if (!explicit && target) {
        if (/claude\s*code|클로드\s*코드/i.test(target) && s.source_ai !== 'claude-code') continue;
        if (/codex|코덱스/i.test(target) && s.source_ai !== 'codex') continue;
      }
      const gapMin = Math.round((start - Date.parse(c.updated_at)) / 60_000);
      if (!explicit && (gapMin < -60 || gapMin > 72 * 60)) continue;
      const time = Math.max(0, 1 - Math.max(0, gapMin) / (72 * 60));
      const cMsgs = db.all<{ content_md: string }>('SELECT content_md FROM messages WHERE conversation_id=? ORDER BY seq DESC LIMIT 3', c.id).map((m) => m.content_md.slice(0, 3000));
      const textSimilarity = Math.round(dice(bigrams([c.title, ...cMsgs].join(' ')), bigrams([s.title, ...sUsers.map((m) => m.content_md.slice(0, 3000))].join(' '))) * 1000) / 1000;
      const projectMatch: HandoffSessionMatch['projectMatch'] = sTask?.project_id && c.project_id && sTask.project_id === c.project_id ? 'same_project'
        : cwdName.length >= 2 && (norm(c.title).includes(cwdName) || (c.pname && norm(c.pname).includes(cwdName)) || cMsgs.some((m) => norm(m).includes(cwdName))) ? 'cwd_name' : 'none';
      const score = explicit ? 0.95 : Math.round((0.45 * time + 0.30 * Math.min(1, textSimilarity * 2) + 0.25 * (projectMatch === 'same_project' ? 1 : projectMatch === 'cwd_name' ? 0.6 : 0)) * 1000) / 1000;
      const m: HandoffSessionMatch = { fromConversationId: c.id, sessionConversationId: sid, target, gapMinutes: gapMin, textSimilarity, projectMatch, explicitRef: explicit, cwd: s.cwd, score };
      if (score >= 0.55 && (!best || score > best.m.score)) best = { m, c };
    }
    if (!best) continue;
    const { m, c } = best;
    if (db.get('SELECT 1 FROM task_merge_suggestions WHERE (task_a=? AND task_b=?) OR (task_a=? AND task_b=?)', c.task_id, s.task_id, s.task_id, c.task_id)) continue;
    const gap = m.gapMinutes < 60 ? `${Math.max(0, m.gapMinutes)}분` : m.gapMinutes < 2880 ? `${Math.round(m.gapMinutes / 60)}시간` : `${Math.round(m.gapMinutes / 1440)}일`;
    const reason = m.explicitRef ? `${LABEL[s.source_ai]} 세션이 이 대화(‘${c.title}’)를 직접 참조해 시작함`
      : `‘${m.target ?? '다른 곳'}에서 이어감’으로 끝난 대화 → ${gap} 뒤 ${LABEL[s.source_ai]} 세션${m.projectMatch === 'same_project' ? '(같은 프로젝트)' : m.projectMatch === 'cwd_name' ? `(폴더 ${baseName(s.cwd ?? '')})` : ''}`;
    db.run("INSERT INTO task_merge_suggestions(id,task_a,task_b,suggested_primary,confidence,reason,state,created_at,kind,handoff_json) VALUES (?,?,?,?,?,?,'pending',?,'handoff_session',?)",
      `ms_${randomId(4)}`, c.task_id, s.task_id, c.task_id, m.score, reason, nowIso(), JSON.stringify(m));
    created++;
  }
  return created;
}

// ── 작업(backfill·scan)
export function startCollectorJob(core: Core, kind: 'backfill' | 'scan', body: { sourceAi?: LocalSourceAi; files?: string[]; classify?: boolean } = {}): string {
  const cfg = collectorConfig(core);
  const ais = cfg.sources.filter((s) => (body.sourceAi ? s.sourceAi === body.sourceAi : s.enabled)).map((s) => s.sourceAi);
  const jobId = core.queue.create(kind === 'backfill' ? 'collector_backfill' : 'collector_scan', `${kind === 'backfill' ? '로컬 세션 전체 읽기' : '로컬 세션 검사'} · ${ais.map((a) => LABEL[a]).join('·')}`, { total: null });
  core.queue.enqueue(jobId, async (ctl) => {
    // 1.10.0 이 작업이 도는 동안 감시기는 쉼 — 감시기가 같은 파일을 먼저 읽으면 config.classify(기본 true)로 분류해 버려 classify:false가 무시되던 버그
    RUNNING.set(core, (RUNNING.get(core) ?? 0) + 1);
    try { return await runJob(ctl); } finally { RUNNING.set(core, Math.max(0, (RUNNING.get(core) ?? 1) - 1)); }
  });
  async function runJob(ctl: Parameters<Parameters<Core['queue']['enqueue']>[1]>[0]) {
    const changed: string[] = [];
    for (const ai of ais) {
      const total = body.files?.length ?? listSessionFiles(expand(cfg.sources.find((s) => s.sourceAi === ai)!.root)).length;
      const info: BackfillInfo = { state: 'running', startedAt: nowIso(), finishedAt: null, filesDone: 0, filesTotal: total, jobId };
      if (kind === 'backfill') setState(core, `backfill:${ai}`, info);
      try {
        const r = await scanSource(core, ai, { files: body.files, cancelled: ctl.cancelled, onFile: (d, t) => { ctl.progress(d, t); if (kind === 'backfill' && (d % 5 === 0 || d === t)) setState(core, `backfill:${ai}`, { ...info, filesDone: d, filesTotal: t }); } });
        changed.push(...r.changed);
        if (kind === 'backfill') setState(core, `backfill:${ai}`, { ...info, state: 'done', finishedAt: nowIso(), filesDone: r.files, filesTotal: r.files });
      } catch (e) {
        if (kind === 'backfill') setState(core, `backfill:${ai}`, { ...info, state: 'failed', finishedAt: nowIso() });
        throw e;
      }
    }
    if ((body.classify ?? cfg.classify) && changed.length) enqueueClassification(core, changed, `분류 · 로컬 세션 ${changed.length}개`, jobId);
    return ctl.cancelled() ? 'cancelled' : 'done';
  }

  return jobId;
}

/** 감시: fs.watch(재귀, 되는 곳) + pollIntervalSec 주기 검사. 바뀐 세션은 QUIET_MS 조용하면 분류 */
export class CollectorWatcher {
  private timer: NodeJS.Timeout | null = null;
  private watchers: FSWatcher[] = [];
  private busy = false; private again = false;
  private debounce: NodeJS.Timeout | null = null;
  private pendingClassify = new Map<string, number>();
  constructor(private core: Core) {}
  get watching(): boolean { return this.timer !== null; }
  /** 설정에 맞춰 켜고 끔 */
  sync(): void {
    const cfg = collectorConfig(this.core);
    this.stop();
    if (!cfg.enabled) return;
    for (const s of cfg.sources.filter((x) => x.enabled)) {
      const root = expand(s.root);
      if (!existsSync(root)) continue;
      try { this.watchers.push(watch(root, { recursive: true }, () => this.kick())); } catch { /* 재귀 감시가 안 되는 곳 — 주기 검사만 */ }
    }
    this.timer = setInterval(() => this.kick(), cfg.pollIntervalSec * 1000);
    this.timer.unref?.();
    this.kick();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer); this.timer = null;
    for (const w of this.watchers) { try { w.close(); } catch { /* 이미 닫힘 */ } }
    this.watchers = [];
    if (this.debounce) clearTimeout(this.debounce); this.debounce = null;
  }
  private kick(): void {
    if (this.debounce) return;
    this.debounce = setTimeout(() => { this.debounce = null; void this.tick(); }, 1500);
    this.debounce.unref?.();
  }
  async tick(): Promise<void> {
    if (this.busy) { this.again = true; return; }
    if ((RUNNING.get(this.core) ?? 0) > 0) return; // 백필·검사 작업 중엔 쉼(다음 주기에 다시)
    this.busy = true;
    try {
      const cfg = collectorConfig(this.core);
      for (const s of cfg.sources.filter((x) => x.enabled)) {
        const r = await scanSource(this.core, s.sourceAi);
        for (const id of r.changed) this.pendingClassify.set(id, nowMs());
      }
      if (cfg.classify) {
        const ready = [...this.pendingClassify].filter(([, t]) => nowMs() - t >= QUIET_MS).map(([id]) => id);
        if (ready.length) { for (const id of ready) this.pendingClassify.delete(id); enqueueClassification(this.core, ready, `분류 · 로컬 세션 ${ready.length}개`); }
      } else this.pendingClassify.clear();
    } finally {
      this.busy = false;
      if (this.again) { this.again = false; this.kick(); }
    }
  }
}

const RUNNING = new WeakMap<Core, number>();

/** 1.10.0 백필 어림(파일을 열지 않고 크기·읽은 위치만) — 비용은 저장된 설정의 모델 가격으로 */
export function estimateCollectorBackfill(core: Core, body: { sourceAi?: LocalSourceAi; classify?: boolean } = {}): CollectorEstimate {
  const st = collectorStatus(core, false);
  const cfg = st.config;
  const s = core.settings.get();
  const sources = st.sources.filter((x) => (body.sourceAi ? x.sourceAi === body.sourceAi : x.enabled)).map((x) => {
    const tracked = new Map(core.db.all<{ path: string; offset: number }>('SELECT path, offset FROM collector_files WHERE source_ai=?', x.sourceAi).map((r) => [r.path, Number(r.offset)]));
    const files = x.rootExists ? listSessionFiles(x.root) : [];
    let bytesTotal = 0, bytesUnread = 0, filesUnread = 0;
    const unread: number[] = [];
    for (const f of files) {
      let size = 0; try { size = statSync(f).size; } catch { continue; }
      const u = Math.max(0, size - (tracked.get(f) ?? 0));
      bytesTotal += size; if (u > 0) { bytesUnread += u; filesUnread++; unread.push(u); }
    }
    return { sourceAi: x.sourceAi, root: x.root, rootExists: x.rootExists, files: files.length, filesUnread, bytesTotal, bytesUnread, sessionsEstimated: filesUnread, _unread: unread };
  });
  const willClassify = body.classify ?? cfg.classify;
  // 세션 하나의 분류 입력: 도구 출력을 줄인 본문(원본의 약 10% [어림]) → 줄인 대화 상한 16,000자(§7.5) → 글자÷2.5 토큰 + 프롬프트 약 900
  let inTok = 0, outTok = 0, n = 0;
  for (const x of sources) for (const u of x._unread) { inTok += Math.ceil(Math.min(16000, u * 0.1) / 2.5) + 900; outTok += 300; n++; }
  const model = s.llm.model ?? null;
  const llm = core.llmConfigured();
  const cost = !willClassify ? 0 : priceUsd(model ?? '', inTok, outTok);
  const bytesUnread = sources.reduce((a, x) => a + x.bytesUnread, 0);
  return {
    sources: sources.map(({ _unread, ...rest }) => rest),
    classification: { model, sessions: n, inputTokens: inTok, outputTokens: outTok, costUsd: cost, willClassify,
      note: !willClassify ? '분류하지 않음(classify:false) — 비용 0. 나중에 웹에서 분류 실행 가능' : `${llm ? '' : 'LLM 키가 없으면 규칙 분류(비용 0) — 금액은 저장된 모델로 계산한 것. '}세션당 입력은 원본의 약 10%(도구 출력 줄임)를 16,000자로 자른 값 [어림]` },
    dbGrowthMbEstimated: Math.round((bytesUnread * 0.1) / 1e6 * 1.6), // 본문 + FTS 색인 [어림]
    secondsEstimated: Math.round(bytesUnread / 40e6), // 약 40 MB/초 줄 단위 읽기 [어림·미검증]
  };
}

const WATCHERS = new WeakMap<Core, CollectorWatcher>();
/** 코어 하나에 감시기 하나 */
export function watcherFor(core: Core): CollectorWatcher {
  let w = WATCHERS.get(core);
  if (!w) { w = new CollectorWatcher(core); WATCHERS.set(core, w); }
  return w;
}
