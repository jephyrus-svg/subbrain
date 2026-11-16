#!/usr/bin/env node
// 봇 컴퓨터 메모리 폴더에서 온 '과제 메모·다음 할 일 수정'을 서브브레인 엔진에 반영. 기존 안전 경로만 사용: POST /api/v1/mcp/toc-note (삭제 없음, 이벤트로 기록·되돌리기 가능). LLM 호출 없음.
//   node scripts/memory-writeback-apply.mjs [--dir DIR] [--core URL] [--apply]      (기본은 dry-run: 무엇을 보낼지만 보여 줌)
// 입력: <dir>/writeback-*.json {schema:'subbrain-memory-writeback/1', items:[{kind:'task_note', taskId, progress?, nextStep?, bot?, date?, key}]}
// 장부 <dir>/../memory-writeback-ledger.json: key별로 한 번만 적용(재실행 안전). 없는 과제·민감 과제는 건너뜀.
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const DIR = resolve(opt('dir', process.env.SUBBRAIN_WRITEBACK_DIR ?? join(homedir(), '.subbrain', 'inbox', 'memory-writeback')));
const CORE = opt('core', process.env.SUBBRAIN_CORE ?? 'http://127.0.0.1:4545').replace(/\/+$/, '');
const APPLY = argv.includes('--apply');
const LEDGER = join(dirname(DIR), 'memory-writeback-ledger.json');
if (!existsSync(DIR)) { console.error(`폴더가 없어요: ${DIR}`); process.exit(2); }
const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : { version: 1, items: {} };
const items = [];
for (const f of readdirSync(DIR).filter((x) => /^writeback-.*\.json$/.test(x)).sort()) {
  let j; try { j = JSON.parse(readFileSync(join(DIR, f), 'utf8')); } catch { console.log(`  ! ${f}: JSON 오류(건너뜀)`); continue; }
  if (j.schema !== 'subbrain-memory-writeback/1' || !Array.isArray(j.items)) { console.log(`  ! ${f}: 알 수 없는 형식(건너뜀)`); continue; }
  for (const it of j.items) if (it && it.kind === 'task_note' && /^task_[A-Za-z0-9_]+$/.test(it.taskId ?? '') && typeof it.key === 'string' && (it.progress || it.nextStep)) items.push(it);
}
const seen = new Set(), todo = [];
for (const it of items) { if (ledger.items[it.key] || seen.has(it.key)) continue; seen.add(it.key); todo.push(it); }
console.log(`${APPLY ? '적용' : '(dry-run)'} · 파일 안 항목 ${items.length} · 이미 반영 ${items.length - todo.length} · 새로 보낼 것 ${todo.length}`);
const api = async (method, path, body) => {
  const res = await fetch(`${CORE}/api/v1${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
  if (!res) { console.error(`엔진에 연결 못 했어요(${CORE}).`); process.exit(3); }
  return { status: res.status, body: await res.json().catch(() => null) };
};
let ok = 0, skipped = 0;
for (const it of todo.slice(0, 200)) {
  const what = it.progress ? `메모 “${it.progress.slice(0, 40)}”` : `다음 할 일 “${it.nextStep.slice(0, 40)}”`;
  if (!APPLY) { console.log(`  → ${it.taskId} ${what}`); continue; }
  const body = { taskId: it.taskId, progress: it.progress ? `${it.bot ? `[${it.bot}] ` : ''}${it.progress}`.slice(0, 300) : null, nextStep: it.nextStep ?? null, sourceAi: 'grokbot' };
  const r = await api('POST', '/mcp/toc-note', body);
  if (r.status === 201) { ok++; ledger.items[it.key] = { at: new Date().toISOString(), taskId: it.taskId, eventId: r.body.eventId, result: 'applied' }; console.log(`  ✅ ${it.taskId} ${what} (event ${r.body.eventId})`); }
  else if (r.status === 404 || r.status === 403) { skipped++; ledger.items[it.key] = { at: new Date().toISOString(), taskId: it.taskId, result: `skipped:${r.status}` }; console.log(`  ⏭ ${it.taskId} ${what} — ${r.status === 404 ? '과제 없음' : '민감 과제'}(건너뜀)`); }
  else { console.error(`  ❌ ${it.taskId}: ${r.status} ${r.body?.error?.message ?? ''} — 중단(장부엔 지금까지만 기록)`); break; }
}
if (APPLY) { writeFileSync(LEDGER + '.tmp', JSON.stringify(ledger, null, 1)); renameSync(LEDGER + '.tmp', LEDGER); console.log(`반영 ${ok} · 건너뜀 ${skipped} · 장부 ${LEDGER}\n되돌리기: POST /api/v1/mcp/toc-note/<eventId>/undo (또는 MCP toc_undo_update)`); }
else console.log('실제로 보내려면 --apply 를 붙이세요.');
