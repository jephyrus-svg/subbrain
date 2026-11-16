/**
 * 1.5.0 로컬 세션 로그 파서 — Claude Code(~/.claude/projects/**.jsonl) · OpenAI Codex CLI(~/.codex/sessions/**.jsonl).
 * 실제 표본(real/local-sessions, Claude Code 2.1.121–2.1.295 · Codex cli 0.137–0.159)으로 확인한 형식. 표본에 없는 부분은 [추정] 주석.
 *
 * 줄 하나씩 먹는(feed) 증분 파서: 파일에서 새로 붙은 줄만 넣으면 되고, 상태(FileState)는 JSON으로 DB에 저장해 다음 검사에서 이어 간다.
 *  - 도구 호출은 메시지 본문에 한 줄 요약만: "[도구: Bash] 입력… → 출력…(N자 중 M자)". 출력은 짝(id/call_id)이 오면 자리표(\u0000T:id\u0000)를 바꿔 넣는다.
 *  - 비밀정보는 여기서(저장 전에) redactSecrets로 가린다 — DB·볼트·LLM 어디에도 원문이 가지 않음.
 *  - 주입 블록(<environment_context> 등)·메타 기록·thinking·암호화 내용·이미지 base64는 버린다.
 */
import { redactSecrets } from '../classifier/redact.ts';

export type LocalAi = 'claude-code' | 'codex';
export interface SessionMsg { role: 'user' | 'assistant' | 'system'; content: string; createdAt: string | null }
export interface FileState {
  ai: LocalAi;
  sessionKey: string | null;     // 같은 대화로 묶는 키 = 루트 세션 id
  sessionId: string | null;      // 이 파일 자신의 세션/스레드 id
  isSubagent: boolean;
  agentName: string | null;
  title: string | null;          // custom-title > ai-title
  aiTitle: string | null;
  cwd: string | null;
  version: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  msgs: SessionMsg[];
  pending: Record<string, number>;   // 도구 호출 id → msgs 위치(출력 기다림)
  lastAssistantKey: string | null;   // 같은 답(message.id)·같은 턴 이어 붙이기
  explicitRef: { sourceAi: 'chatgpt' | 'claude'; sourceId: string; title: string | null } | null; // 넘겨준 대화 직접 참조
  redacted: number;
  skippedLines: number;
}
export interface ParseOpts { toolInputMaxChars: number; toolOutputMaxChars: number; messageMaxChars?: number }
export const DEFAULT_PARSE_OPTS: ParseOpts = { toolInputMaxChars: 300, toolOutputMaxChars: 600, messageMaxChars: 20000 };

export function newState(ai: LocalAi, path: string): FileState {
  return {
    ai, sessionKey: null, sessionId: null, isSubagent: /\/subagents\//.test(path), agentName: null, title: null, aiTitle: null, cwd: null, version: null,
    createdAt: null, updatedAt: null, msgs: [], pending: {}, lastAssistantKey: null, explicitRef: null, redacted: 0, skippedLines: 0,
  };
}

// ── 공통 도구
const TOKEN = (id: string) => `\u0000T:${id}\u0000`;
const TOKEN_RE = /\u0000T:[^\u0000]*\u0000/g;
function clean(st: FileState, s: string): string {
  const r = redactSecrets(s);
  for (const v of Object.values(r.counts)) st.redacted += v;
  return r.text;
}
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
function cut(s: string, max: number): string {
  const t = oneLine(s);
  return t.length <= max ? t : `${t.slice(0, max)}…(${t.length.toLocaleString('en-US')}자 중 ${max}자)`;
}
/** base64·긴 덩어리(이미지·암호문)는 길이만 */
const BLOB_RE = /[A-Za-z0-9+/=_-]{400,}/g;
const deblob = (s: string) => s.replace(BLOB_RE, (m) => `[데이터 ${m.length.toLocaleString('en-US')}자]`);
function touch(st: FileState, ts: unknown): string | null {
  const t = typeof ts === 'string' ? ts : typeof ts === 'number' ? new Date(ts > 1e12 ? ts : ts * 1000).toISOString() : null;
  if (!t) return null;
  if (!st.createdAt || t < st.createdAt) st.createdAt = t;
  if (!st.updatedAt || t > st.updatedAt) st.updatedAt = t;
  return t;
}
function pushUser(st: FileState, text: string, at: string | null, opts: ParseOpts): void {
  const t = clean(st, text).trim();
  if (!t) return;
  st.msgs.push({ role: 'user', content: t.slice(0, opts.messageMaxChars ?? 20000), createdAt: at });
  st.lastAssistantKey = null;
}
function assistantMsg(st: FileState, key: string, at: string | null): SessionMsg {
  const last = st.msgs.at(-1);
  if (last && last.role === 'assistant' && st.lastAssistantKey === key) return last;
  const m: SessionMsg = { role: 'assistant', content: '', createdAt: at };
  st.msgs.push(m); st.lastAssistantKey = key;
  return m;
}
function appendText(st: FileState, m: SessionMsg, text: string, opts: ParseOpts): void {
  const t = clean(st, text).trim();
  if (!t) return;
  const max = opts.messageMaxChars ?? 20000;
  if (m.content.length >= max) return;
  m.content = (m.content ? `${m.content}\n\n${t}` : t).slice(0, max);
}
function addToolCall(st: FileState, key: string, at: string | null, id: string, name: string, input: string, opts: ParseOpts): void {
  const m = assistantMsg(st, key, at);
  const line = `[도구: ${name}] ${cut(deblob(clean(st, input)), opts.toolInputMaxChars)}${id ? TOKEN(id) : ''}`;
  m.content = m.content ? `${m.content}\n${line}` : line;
  if (id) st.pending[id] = st.msgs.length - 1;
}
function addToolResult(st: FileState, id: string, output: string, opts: ParseOpts): void {
  const i = st.pending[id];
  if (i === undefined) return;          // 짝 없는 결과(앞부분이 잘린 파일 등) — 버림
  delete st.pending[id];
  const m = st.msgs[i];
  if (!m) return;
  const out = cut(deblob(clean(st, output)), opts.toolOutputMaxChars);
  m.content = m.content.replace(TOKEN(id), out ? ` → ${out}` : '');
}
/** 상태 → 메시지(남은 자리표 제거, 하위 에이전트면 이름 붙임) */
export function finalMessages(st: FileState): SessionMsg[] {
  const tag = st.isSubagent ? `[하위 에이전트${st.agentName ? ` ${st.agentName}` : ''}] ` : '';
  return st.msgs.map((m) => ({ ...m, content: tag + m.content.replace(TOKEN_RE, '') })).filter((m) => m.content.trim());
}
const textOf = (v: unknown): string => typeof v === 'string' ? v
  : Array.isArray(v) ? v.map((b) => (b && typeof b === 'object' ? (typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : (b as { type?: string }).type === 'image' ? '[이미지]' : '') : typeof b === 'string' ? b : '')).filter(Boolean).join('\n')
  : v && typeof v === 'object' && typeof (v as { text?: unknown }).text === 'string' ? (v as { text: string }).text : '';

// ── 사람 말이 아닌 주입 블록 지우기
/** 앞뒤를 감싼 태그 블록: <environment_context>…</environment_context>, <app-context>…, <in-app-browser-context …>… 등 */
const BLOCK_RE = /<([a-zA-Z][\w-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g;
/** Claude Code 슬래시 명령·훅 기록 */
const CC_INJECTED = /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|task-notification|system-reminder|user-prompt-submit-hook|bash-input|bash-stdout|bash-stderr)\b/;
export function stripInjected(text: string): { text: string; files: number; images: number } {
  let files = 0, images = 0;
  let t = text.replace(/<image\b[^>]*>[\s\S]*?<\/image>/g, () => { images++; return ''; });
  t = t.replace(BLOCK_RE, '');
  // "# Files pasted/mentioned by the user:" — 붙여 넣은 파일 본문은 버리고 표시만
  t = t.replace(/^\s*#\s*Files (?:pasted|mentioned) by the user:[\s\S]*?(?=\n\s*\n(?!\s*##)|(?![\s\S]))/m, (m) => { files += Math.max(1, (m.match(/^\s*##\s/gm) ?? []).length); return ''; });
  t = t.trim();
  const marks = [files ? `[첨부: 파일 ${files}개]` : '', images ? `[첨부: 이미지 ${images}개]` : ''].filter(Boolean).join(' ');
  return { text: [marks, t].filter(Boolean).join('\n'), files, images };
}

// ── Claude Code
type Rec = Record<string, unknown>;
export function feedClaudeCode(st: FileState, rec: Rec, opts: ParseOpts = DEFAULT_PARSE_OPTS): void {
  const type = rec.type;
  if (typeof rec.version === 'string') st.version = rec.version;
  if (typeof rec.sessionId === 'string') { st.sessionId ??= rec.sessionId; st.sessionKey ??= rec.sessionId; } // 하위 에이전트 파일도 부모 sessionId를 씀 [추정: 공개 자료]
  if (rec.isSidechain === true) st.isSubagent = true;
  if (typeof rec.cwd === 'string' && !st.cwd) st.cwd = rec.cwd;
  if (type === 'custom-title' && typeof rec.customTitle === 'string') { st.title = rec.customTitle; return; }
  if (type === 'ai-title' && typeof rec.aiTitle === 'string') { st.aiTitle = rec.aiTitle; return; }
  if (type === 'agent-name' && typeof rec.agentName === 'string') { st.agentName = rec.agentName; return; }
  if (type !== 'user' && type !== 'assistant') return;      // attachment·queue-operation·system·file-history-* … 대화 아님
  const at = touch(st, rec.timestamp);
  const msg = (rec.message ?? {}) as Rec;
  const content = msg.content;
  if (type === 'user') {
    if (rec.isMeta === true) return;                          // [Image: source: …] 같은 메타
    if (typeof content === 'string') {
      if (CC_INJECTED.test(content)) return;
      pushUser(st, stripInjected(content).text, at, opts); return;
    }
    if (!Array.isArray(content)) return;
    const texts: string[] = []; let images = 0;
    for (const b of content as Rec[]) {
      if (b.type === 'tool_result') addToolResult(st, String(b.tool_use_id ?? ''), textOf(b.content), opts);
      else if (b.type === 'text' && typeof b.text === 'string' && !CC_INJECTED.test(b.text)) texts.push(stripInjected(b.text).text);
      else if (b.type === 'image') images++;
    }
    const body = [images ? `[첨부: 이미지 ${images}개]` : '', ...texts].filter(Boolean).join('\n');
    if (body) pushUser(st, body, at, opts);
    return;
  }
  // assistant: 블록마다 따로 기록되므로 같은 턴(사람 말 사이)을 한 메시지로
  const key = 'turn';
  if (!Array.isArray(content)) { if (typeof content === 'string') appendText(st, assistantMsg(st, key, at), content, opts); return; }
  for (const b of content as Rec[]) {
    if (b.type === 'text' && typeof b.text === 'string') appendText(st, assistantMsg(st, key, at), b.text, opts);
    else if (b.type === 'tool_use') addToolCall(st, key, at, String(b.id ?? ''), String(b.name ?? 'tool'), toolInput(b.input), opts);
    // thinking·redacted_thinking: 버림
  }
}
function toolInput(input: unknown): string {
  if (input && typeof input === 'object') {
    const o = input as Rec;
    for (const k of ['command', 'cmd', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt']) if (typeof o[k] === 'string') return k === 'description' || k === 'prompt' ? String(o[k]) : `${o[k]}`;
    return JSON.stringify(input);
  }
  return typeof input === 'string' ? input : '';
}

// ── Codex
/** 넘겨준 ChatGPT 대화 참조(thread_source: chatgpt_handoff) — {"conversationId":"…","title":"…"} */
const REF_RE = /Referenced ChatGPT conversation:[\s\S]*?\{"conversationId":"([^"]+)"(?:,"title":"((?:[^"\\]|\\.)*)")?/;
export function feedCodex(st: FileState, rec: Rec, opts: ParseOpts = DEFAULT_PARSE_OPTS): void {
  const p = (rec.payload ?? {}) as Rec;
  const at = touch(st, rec.timestamp);
  if (rec.type === 'session_meta') {
    if (typeof p.id === 'string') st.sessionId = p.id;
    st.sessionKey = typeof p.session_id === 'string' ? p.session_id : st.sessionId;
    st.isSubagent = Boolean(st.sessionId && st.sessionKey && st.sessionId !== st.sessionKey) || Boolean((p.source as Rec | undefined)?.subagent);
    if (typeof p.cwd === 'string') st.cwd = p.cwd;
    if (typeof p.cli_version === 'string') st.version = p.cli_version;
    if (typeof p.agent_nickname === 'string') st.agentName = p.agent_nickname;
    const spawn = ((p.source as Rec | undefined)?.subagent as Rec | undefined)?.thread_spawn as Rec | undefined;
    if (!st.agentName && spawn && typeof spawn.agent_role === 'string') st.agentName = spawn.agent_role;
    return;
  }
  if (rec.type === 'turn_context') { if (typeof p.cwd === 'string' && !st.cwd) st.cwd = p.cwd; return; }
  if (rec.type !== 'response_item') return;                  // event_msg·token_count·world_state·compacted(앞 내용 반복) … 버림
  const t = p.type;
  if (t === 'message') {
    const role = p.role;
    if (role === 'developer' || role === 'system') return;
    const parts = Array.isArray(p.content) ? (p.content as Rec[]) : [];
    if (role === 'user') {
      const texts: string[] = [];
      for (const c of parts) {
        const raw = typeof c.text === 'string' ? c.text : '';
        if (!raw) continue;
        const ref = REF_RE.exec(raw);
        if (ref) { st.explicitRef = { sourceAi: 'chatgpt', sourceId: ref[1]!, title: ref[2] ? JSON.parse(`"${ref[2]}"`) as string : null }; continue; } // 참조 미리보기(남의 대화)는 본문에 안 넣음
        texts.push(raw);
      }
      const body = stripInjected(texts.join('\n')).text;
      if (body) pushUser(st, body, at, opts);
      return;
    }
    if (role === 'assistant') {
      const m = assistantMsg(st, 'turn', at);
      for (const c of parts) if (typeof c.text === 'string') appendText(st, m, c.text, opts);
    }
    return;
  }
  if (t === 'custom_tool_call') { addToolCall(st, 'turn', at, String(p.call_id ?? ''), String(p.name ?? 'tool'), typeof p.input === 'string' ? p.input : JSON.stringify(p.input ?? ''), opts); return; }
  if (t === 'function_call') {
    const name = [p.namespace, p.name].filter((x) => typeof x === 'string' && x).join('.');
    addToolCall(st, 'turn', at, String(p.call_id ?? ''), name || 'function', typeof p.arguments === 'string' ? p.arguments : JSON.stringify(p.arguments ?? ''), opts); return;
  }
  if (t === 'custom_tool_call_output' || t === 'function_call_output') { addToolResult(st, String(p.call_id ?? ''), textOf(p.output), opts); return; }
  if (t === 'agent_message' && typeof p.recipient === 'string') { // 하위 에이전트에게 일 맡김(본문은 암호화) — 표시만
    const m = assistantMsg(st, 'turn', at); appendText(st, m, `[하위 에이전트에게 맡김 → ${p.recipient}]`, opts);
  }
  // reasoning(암호화)·compaction: 버림
}

export function feed(st: FileState, line: string, opts: ParseOpts = DEFAULT_PARSE_OPTS): void {
  const s = line.trim();
  if (!s) return;
  let rec: Rec;
  try { rec = JSON.parse(s) as Rec; } catch { st.skippedLines++; return; }
  if (!rec || typeof rec !== 'object') return;
  if (st.ai === 'claude-code') feedClaudeCode(st, rec, opts); else feedCodex(st, rec, opts);
}

/** 대화 제목: Claude custom-title > ai-title > 첫 사용자 말 · Codex 첫 사용자 말 */
export function sessionTitle(st: FileState): string {
  const first = st.msgs.find((m) => m.role === 'user')?.content.replace(/^\[첨부:[^\]]*\]\s*/g, '') ?? '';
  return (st.title ?? st.aiTitle ?? (oneLine(first).slice(0, 60) || (st.cwd ? `${baseName(st.cwd)} 세션` : '세션'))).slice(0, 120);
}
export function baseName(p: string): string { return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p; }
