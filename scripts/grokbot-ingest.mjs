#!/usr/bin/env node
// 서브브레인 ← Grok Bot 대화 증분 가져오기 (코어 엔진용). Node 20+ 내장 모듈만 사용. LLM(Gemini 등) 호출 없음.
//   node scripts/grokbot-ingest.mjs [--inbox DIR] [--core URL] [--dry-run] [--validate-only] [--no-bot-prefix]
// 흐름: inbox/*.jsonl 읽기·검증 → 비밀값 한 번 더 가림 → (id+해시) 장부와 비교해 새것·바뀐 것만 추림 → Claude 내보내기 모양의 배치 파일로 만듦
//       → 엔진 POST /api/v1/imports {path, sourceAi:'grokbot'} → 미리보기 → POST .../start {classify:false}  (새 대화는 분류 안 된 '대기' 상태로 들어감)
// 삭제 없음: inbox 파일은 그대로 두고, 장부(<inbox>/../grokbot-ledger.json)와 배치 파일(<inbox>/../grokbot-batches/)만 만든다.
// 형식 명세: docs/grokbot-bridge.md
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const INBOX = resolve(opt('inbox', process.env.SUBBRAIN_INBOX ?? join(homedir(), '.subbrain', 'inbox', 'grokbot')));
const CORE = (opt('core', process.env.SUBBRAIN_CORE ?? 'http://127.0.0.1:4545')).replace(/\/+$/, '');
const ROOT = dirname(INBOX);
const LEDGER = join(ROOT, 'grokbot-ledger.json');
const BATCHES = join(ROOT, 'grokbot-batches');
const SCHEMA = 'subbrain-grokbot/1';
const MAX_MSG = 60000;
const sha = (s) => createHash('sha256').update(s).digest('hex');

// ── 비밀값 가림(내보내는 쪽에서 이미 가렸더라도 한 번 더)
const SECRET_RES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk|xai|pk|rk)-[A-Za-z0-9_-]{16,}/g, /\bsbt_[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g, /\bgithub_pat_[A-Za-z0-9_]{30,}/g, /\bAKIA[0-9A-Z]{16}\b/g, /\bAIza[0-9A-Za-z_-]{30,}/g, /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bBearer\s+[A-Za-z0-9._~+\/=-]{20,}/g, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];
const KV_RE = /\b(api[_-]?key|secret|token|password|passwd|pwd|authorization)(\s*["']?\s*[:=]\s*["']?)([^\s"',;]{8,})/gi;
let masked = 0;
function mask(s) {
  let out = s;
  for (const re of SECRET_RES) out = out.replace(re, () => { masked++; return '[MASKED]'; });
  out = out.replace(KV_RE, (_m, k, sep) => { masked++; return `${k}${sep}[MASKED]`; });
  return out;
}

// ── 읽기·검증
const errors = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const isIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
function readConv(file) {
  const name = basename(file);
  const id = name.replace(/\.jsonl$/, '');
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) { err(name, '파일 이름(=대화 id)은 영문·숫자·._- 1~120자'); return null; }
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) { err(name, '비어 있음'); return null; }
  let meta;
  try { meta = JSON.parse(lines[0]); } catch { err(name, '1번째 줄이 JSON이 아님'); return null; }
  if (meta.type !== 'meta' || meta.schema !== SCHEMA) { err(name, `1번째 줄은 {"type":"meta","schema":"${SCHEMA}",…} 이어야 함`); return null; }
  if (meta.id !== id) { err(name, `meta.id(${meta.id})가 파일 이름(${id})과 달라요`); return null; }
  if (typeof meta.title !== 'string' || !meta.title.trim()) { err(name, 'meta.title 필요'); return null; }
  const msgs = [];
  lines.slice(1).forEach((l, i) => {
    let m; try { m = JSON.parse(l); } catch { err(name, `${i + 2}번째 줄 JSON 오류(건너뜀)`); return; }
    if (m.type !== 'message') { err(name, `${i + 2}번째 줄 type이 message가 아님(건너뜀)`); return; }
    if (m.role !== 'user' && m.role !== 'assistant') { err(name, `${i + 2}번째 줄 role은 user|assistant만(건너뜀)`); return; }
    if (typeof m.text !== 'string' || !m.text.trim()) return; // 빈 메시지는 조용히 건너뜀
    let t = mask(m.text.trim());
    if (t.length > MAX_MSG) t = t.slice(0, MAX_MSG) + `\n…[잘림: 원래 ${m.text.length}자]`;
    msgs.push({ role: m.role, text: t, at: isIso(m.at) ? m.at : null });
  });
  if (!msgs.length) { err(name, '유효한 메시지가 없음'); return null; }
  const bot = typeof meta.bot === 'string' ? meta.bot.trim() : '';
  let title = mask(meta.title.trim());
  if (bot && !flag('no-bot-prefix') && !title.startsWith(`[${bot}]`)) title = `[${bot}] ${title}`;
  const created = isIso(meta.created_at) ? meta.created_at : (msgs.find((m) => m.at)?.at ?? new Date().toISOString());
  const updated = isIso(meta.updated_at) ? meta.updated_at : ([...msgs].reverse().find((m) => m.at)?.at ?? created);
  const hash = sha(JSON.stringify([title, msgs.map((m) => [m.role, m.text])]));
  return { id, bot, title, created, updated, msgs, hash };
}

const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : { version: 1, items: {} };
if (!existsSync(INBOX)) { console.error(`inbox가 없어요: ${INBOX}`); process.exit(2); }
const files = readdirSync(INBOX).filter((f) => f.endsWith('.jsonl') && !f.startsWith('.')).sort();
const convs = files.map((f) => readConv(join(INBOX, f))).filter(Boolean);
const fresh = [], changed = [], same = [];
for (const c of convs) { const old = ledger.items[c.id]; (!old ? fresh : old.hash !== c.hash ? changed : same).push(c); }
const todo = [...fresh, ...changed];
console.log(`inbox ${INBOX}\n파일 ${files.length}개 · 유효 ${convs.length}개 · 새것 ${fresh.length} · 바뀜 ${changed.length} · 그대로 ${same.length} · 오류/경고 ${errors.length} · 가린 비밀값 ${masked}곳`);
for (const e of errors.slice(0, 30)) console.log('  ! ' + e);
if (errors.length > 30) console.log(`  ! … ${errors.length - 30}건 더`);
if (flag('validate-only') || flag('dry-run')) { console.log(flag('dry-run') ? '(dry-run) 엔진에 아무것도 보내지 않았어요' : '(validate-only)'); process.exit(errors.some((e) => /JSON이 아님|meta|파일 이름|비어|유효한 메시지/.test(e)) && !convs.length ? 1 : 0); }
if (!todo.length) { console.log('가져올 새 대화·바뀐 대화가 없어요.'); process.exit(0); }

// ── 배치 파일(Claude conversations.json 모양 → 엔진 기존 가져오기 경로가 grokbot으로 처리, (source_ai, source_id)로 중복 방지)
mkdirSync(BATCHES, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 17) + '-' + sha(String(Math.random())).slice(0, 4);
const batchPath = join(BATCHES, `grokbot-batch-${stamp}.json`);
const batch = todo.map((c) => ({ uuid: c.id, name: c.title, created_at: c.created, updated_at: c.updated,
  chat_messages: c.msgs.map((m, i) => ({ uuid: `${c.id}-${i + 1}`, sender: m.role === 'user' ? 'human' : 'assistant', text: m.text, created_at: m.at ?? (i === 0 ? c.created : c.updated) })) }));
writeFileSync(batchPath, JSON.stringify(batch));
console.log(`배치 파일: ${batchPath} (${todo.length}개 대화)`);

const api = async (method, path, body) => {
  const res = await fetch(`${CORE}/api/v1${path}`, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }).catch(() => null);
  if (!res) { console.error(`엔진에 연결 못 했어요(${CORE}). 엔진을 켜 주세요. 배치 파일은 남겨 뒀어요.`); process.exit(3); }
  const j = await res.json().catch(() => null);
  if (!res.ok) { console.error(`엔진 오류 ${res.status} ${path}: ${j?.error?.message ?? ''}`); process.exit(4); }
  return j;
};
const phase = (j) => j.state ?? j.progress?.phase;
const wait = async (id, until, label, ms = 180000) => {
  const t0 = Date.now();
  for (;;) { const j = await api('GET', `/imports/${id}`); const p = phase(j); if (until.includes(p)) return j; if (p === 'failed' || p === 'cancelled') { console.error(`${label} 실패: ${JSON.stringify(j.errors ?? [])}`); process.exit(5); } if (Date.now() - t0 > ms) { console.error(`${label} 시간 초과(${p})`); process.exit(6); } await new Promise((r) => setTimeout(r, 700)); }
};
const imp = await api('POST', '/imports', { path: batchPath, sourceAi: 'grokbot' });
const pv = await wait(imp.id, ['preview_ready'], '파싱');
console.log(`미리보기: 새 ${pv.preview?.conversationsNew} · 바뀜 ${pv.preview?.conversationsUpdated} · 그대로 ${pv.preview?.conversationsUnchanged} · 메시지 ${pv.preview?.messagesTotal}`);
await api('POST', `/imports/${imp.id}/start`, { classify: false }); // 분류(유료 호출 가능)는 하지 않음 → '대기'
const done = await wait(imp.id, ['done'], '가져오기');
const r = done.result ?? {};
console.log(`✅ 가져옴: 새 ${r.conversationsNew ?? '?'} · 갱신 ${r.conversationsUpdated ?? '?'} · 건너뜀(중복) ${r.skippedDuplicates ?? '?'} · 과제 ${r.tasksCreated ?? '?'} · 분류 ${r.classified ?? 0}(0이어야 함) · 오류 ${(done.errors ?? []).length}`);
const bad = new Set((done.errors ?? []).map((e) => e.conversationSourceId).filter(Boolean));
for (const c of todo) if (!bad.has(c.id)) ledger.items[c.id] = { hash: c.hash, at: new Date().toISOString(), importId: imp.id, messages: c.msgs.length };
writeFileSync(LEDGER + '.tmp', JSON.stringify(ledger, null, 1)); renameSync(LEDGER + '.tmp', LEDGER);
console.log(`장부 갱신: ${LEDGER} (${Object.keys(ledger.items).length}개)`);
process.exit(bad.size ? 7 : 0);
