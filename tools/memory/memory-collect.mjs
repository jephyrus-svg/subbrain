#!/usr/bin/env node
// 지난 동기화 이후 바뀐 '내 메모'(새로 추가된 줄)와 '다음 할 일 수정'을 모아 outbox 파일로 만든다. 과제(tasks/)만 서브브레인으로 보냄(프로젝트·index·USER 메모는 봇 컴퓨터에만 남음).
//   node memory-collect.mjs --mem <메모리폴더> --out <outbox폴더> [--dry-run]
// 상태(_sync/state.json: 마지막으로 모은 시점의 메모 줄·다음 할 일)는 메모리 폴더 안에 두어 git에 기록됨. 같은 key는 Mac 쪽 장부가 한 번만 적용.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const MEM = resolve(opt('mem') ?? ''), OUT = resolve(opt('out') ?? ''), DRY = argv.includes('--dry-run');
if (!opt('mem') || !opt('out')) { console.error('usage: memory-collect.mjs --mem DIR --out DIR [--dry-run]'); process.exit(2); }
const PLACEHOLDER = '_(아직 메모 없음 — 여기에 `- YYYY-MM-DD [이름] 내용` 형식으로 줄을 추가하세요(이 안내 줄은 지워도 돼요))_';
const between = (s, a, b) => { const i = s.indexOf(a); if (i < 0) return null; const j = s.indexOf(b, i + a.length); return j < 0 ? null : s.slice(i + a.length, j); };
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const statePath = join(MEM, '_sync', 'state.json');
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { version: 1, tasks: {} };
const manifest = existsSync(join(MEM, 'MANIFEST.json')) ? JSON.parse(readFileSync(join(MEM, 'MANIFEST.json'), 'utf8')) : null;
const items = []; let localOnly = 0;
const memoLines = (s) => (between(s, '<!-- 내 메모 시작 -->', '<!-- 내 메모 끝 -->') ?? '').split('\n').map((l) => l.trim()).filter((l) => l && l !== PLACEHOLDER);
const parseLine = (l) => { const m = /^[-*]\s*(\d{4}-\d{2}-\d{2})?\s*(?:\[([^\]]{1,30})\])?\s*(.*)$/.exec(l); return { date: m?.[1] ?? null, bot: m?.[2] ?? null, text: (m?.[3] ?? l).trim() }; };
const next = { tasks: {} };
const dir = join(MEM, 'tasks');
for (const f of existsSync(dir) ? readdirSync(dir).filter((x) => x.endsWith('.md')) : []) {
  const id = f.replace(/\.md$/, ''); const s = readFileSync(join(dir, f), 'utf8');
  const lines = memoLines(s), ns = (between(s, '<!-- 다음 할 일 수정 시작 -->', '<!-- 다음 할 일 수정 끝 -->') ?? '').trim();
  const base = state.tasks[id] ?? { memo: [], next: '' };
  const seen = new Set(base.memo);
  for (const l of lines) if (!seen.has(l)) { const p = parseLine(l); if (p.text) items.push({ kind: 'task_note', taskId: id, progress: p.text.slice(0, 300), bot: p.bot, date: p.date, key: sha(`${id}|memo|${l}`) }); }
  if (ns && ns !== base.next) items.push({ kind: 'task_note', taskId: id, nextStep: ns.slice(0, 300), key: sha(`${id}|next|${ns}`) });
  next.tasks[id] = { memo: lines, next: ns };
}
for (const f of ['index.md', ...(existsSync(join(MEM, 'projects')) ? readdirSync(join(MEM, 'projects')).map((x) => `projects/${x}`) : [])]) {
  const p = join(MEM, f); if (existsSync(p) && memoLines(readFileSync(p, 'utf8')).length) localOnly++;
}
const limited = items.slice(0, 200);
console.log(`변경 ${items.length}건(과제 메모·다음 할 일) · 봇 컴퓨터에만 남는 프로젝트/목차 메모 파일 ${localOnly}개${items.length > 200 ? ' · 200건까지만 담음' : ''}`);
for (const it of limited.slice(0, 20)) console.log(`  - ${it.taskId} ${it.progress ? `메모: ${it.progress.slice(0, 50)}` : `다음 할 일: ${it.nextStep.slice(0, 50)}`}`);
if (DRY || !items.length) { if (!items.length) console.log('보낼 변경이 없어요.'); process.exit(0); }
mkdirSync(OUT, { recursive: true });
const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const file = join(OUT, `writeback-${ts}-${sha(JSON.stringify(limited)).slice(0, 4)}.json`);
writeFileSync(file, JSON.stringify({ schema: 'subbrain-memory-writeback/1', createdAt: new Date().toISOString(), baseSnapshot: manifest?.generatedAt ?? null, items: limited }, null, 1));
for (const it of limited) { /* 보낸 것만 기준선에 반영 */ }
const sent = new Set(limited.map((i) => i.key));
for (const [id, cur] of Object.entries(next.tasks)) {
  const base = state.tasks[id] ?? { memo: [], next: '' };
  const memo = [...base.memo];
  for (const l of cur.memo) if (!base.memo.includes(l) && sent.has(sha(`${id}|memo|${l}`))) memo.push(l);
  state.tasks[id] = { memo, next: (cur.next && sent.has(sha(`${id}|next|${cur.next}`))) ? cur.next : base.next };
}
mkdirSync(join(MEM, '_sync'), { recursive: true });
writeFileSync(statePath, JSON.stringify({ version: 1, collectedAt: new Date().toISOString(), tasks: state.tasks }, null, 1));
console.log(`✅ outbox: ${file} (${limited.length}건)`);
