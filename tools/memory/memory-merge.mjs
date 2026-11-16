#!/usr/bin/env node
// 새 목차 스냅샷(폴더)을 메모리 폴더에 합친다: 자동 구역(AUTO)은 새 내용으로 바꾸고, 내 메모·다음 할 일 수정 블록은 그대로 둔다.
// 사라진 id의 파일은 지우지 않고 _orphans/ 로 옮김. 다시 나타난 id는 _orphans의 메모를 되살림(원본은 _orphans/_restored/로).
//   node memory-merge.mjs --snap <스냅샷폴더> --mem <메모리폴더> [--dry-run]
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const SNAP = resolve(opt('snap') ?? ''), MEM = resolve(opt('mem') ?? ''), DRY = argv.includes('--dry-run');
if (!opt('snap') || !opt('mem')) { console.error('usage: memory-merge.mjs --snap DIR --mem DIR [--dry-run]'); process.exit(2); }
if (!existsSync(join(SNAP, 'index.md')) || !existsSync(join(SNAP, 'MANIFEST.json'))) { console.error('스냅샷 폴더에 index.md·MANIFEST.json 이 없어요'); process.exit(2); }

export const A_START = '<!-- AUTO:START 자동 생성 — 다음 갱신 때 통째로 바뀌어요. 이 블록은 고치지 마세요 -->', A_END = '<!-- AUTO:END -->';
export const M_START = '<!-- 내 메모 시작 -->', M_END = '<!-- 내 메모 끝 -->';
export const N_START = '<!-- 다음 할 일 수정 시작 -->', N_END = '<!-- 다음 할 일 수정 끝 -->';
export const PLACEHOLDER = '_(아직 메모 없음 — 여기에 `- YYYY-MM-DD [이름] 내용` 형식으로 줄을 추가하세요(이 안내 줄은 지워도 돼요))_';
const between = (s, a, b) => { const i = s.indexOf(a); if (i < 0) return null; const j = s.indexOf(b, i + a.length); return j < 0 ? null : s.slice(i + a.length, j).replace(/^\n/, '').replace(/\n$/, ''); };
const autoOf = (s) => { const m = /<!-- AUTO:START[^>]*-->\n?([\s\S]*?)\n?<!-- AUTO:END -->/.exec(s); return m ? m[1] : null; };
const isEmptyMemo = (m) => !m || !m.trim() || m.trim() === PLACEHOLDER;
const build = (rel, auto, memo, next) => {
  const isTask = rel.startsWith('tasks/');
  return `${A_START}\n${auto.replace(/\s+$/, '')}\n${A_END}\n\n## 내 메모\n${M_START}\n${isEmptyMemo(memo) ? PLACEHOLDER : memo.replace(/\s+$/, '')}\n${M_END}\n`
    + (isTask ? `\n## 다음 할 일 수정 (한 줄. 비워 두면 서브브레인에 안 보내요)\n${N_START}\n${(next ?? '').trim()}\n${N_END}\n` : '');
};
const list = (d) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.md')).sort() : []);
const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const targets = ['index.md', ...list(join(SNAP, 'projects')).map((f) => `projects/${f}`), ...list(join(SNAP, 'tasks')).map((f) => `tasks/${f}`)];
const stat = { created: 0, updated: 0, unchanged: 0, orphaned: 0, restored: 0, brokenMoved: 0 };
const mv = (from, toRel) => { const to = join(MEM, toRel); if (!DRY) { mkdirSync(dirname(to), { recursive: true }); renameSync(from, to); } return toRel; };
const orphanDir = join(MEM, '_orphans');
const latestOrphan = (kind, id) => existsSync(orphanDir) ? readdirSync(orphanDir).filter((f) => f.startsWith(`${kind}__${id}__`)).sort().pop() : undefined;

if (!DRY) mkdirSync(MEM, { recursive: true });
for (const rel of targets) {
  const auto = readFileSync(join(SNAP, rel), 'utf8');
  const path = join(MEM, rel);
  let memo = null, next = null, existed = false;
  if (existsSync(path)) {
    const cur = readFileSync(path, 'utf8');
    memo = between(cur, M_START, M_END); next = between(cur, N_START, N_END);
    if (memo === null) { console.log(`  ! ${rel}: 메모 표시가 망가져 있어 통째로 _orphans/로 옮기고 새로 만듦`); mv(path, `_orphans/${rel.replace('/', '__').replace(/\.md$/, '')}__broken-${ts}.md`); stat.brokenMoved++; }
    else existed = true;
  }
  if (!existed && rel !== 'index.md') {
    const kind = rel.split('/')[0], id = rel.split('/')[1].replace(/\.md$/, '');
    const o = latestOrphan(kind, id);
    if (o) {
      const old = readFileSync(join(orphanDir, o), 'utf8');
      const om = between(old, M_START, M_END), on = between(old, N_START, N_END);
      if (!isEmptyMemo(om) || (on ?? '').trim()) { memo = om; next = on; stat.restored++; if (!DRY) { mkdirSync(join(orphanDir, '_restored'), { recursive: true }); renameSync(join(orphanDir, o), join(orphanDir, '_restored', o)); } console.log(`  ↺ ${rel}: _orphans의 메모를 되살림`); }
    }
  }
  const out = build(rel, auto, memo ?? '', next ?? '');
  const prev = existed ? readFileSync(path, 'utf8') : null;
  if (prev === out) { stat.unchanged++; continue; }
  if (prev === null) stat.created++; else stat.updated++;
  if (!DRY) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, out); }
}
// 스냅샷에 없는 id → _orphans/
for (const kind of ['projects', 'tasks']) {
  for (const f of list(join(MEM, kind))) {
    if (targets.includes(`${kind}/${f}`)) continue;
    console.log(`  → ${kind}/${f} 가 스냅샷에 없어 _orphans/로 옮김(삭제 아님)`);
    mv(join(MEM, kind, f), `_orphans/${kind}__${f.replace(/\.md$/, '')}__${ts}.md`); stat.orphaned++;
  }
}
// 스냅샷 시각 정보(자동 파일)
const man = readFileSync(join(SNAP, 'MANIFEST.json'), 'utf8');
const manPath = join(MEM, 'MANIFEST.json');
if (!existsSync(manPath) || readFileSync(manPath, 'utf8') !== man) { if (!DRY) writeFileSync(manPath, man); }
console.log(`${DRY ? '(dry-run) ' : ''}병합: 새 ${stat.created} · 갱신 ${stat.updated} · 그대로 ${stat.unchanged} · _orphans로 ${stat.orphaned} · 메모 되살림 ${stat.restored} · 망가진 파일 이동 ${stat.brokenMoved}`);
