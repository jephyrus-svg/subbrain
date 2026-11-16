#!/usr/bin/env node
// 커밋 전 검사: (1) 모든 .md 에 메모 블록이 정확히 하나씩 있는지 (2) git에 이미 있던 파일의 AUTO 구역이 바뀌지 않았는지(봇이 자동 구역을 고치면 거부).
//   node memory-check.mjs <메모리폴더>      (MEMORY_ALLOW_AUTO=1 이면 (2) 건너뜀 — 재생성 때 사용)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const MEM = resolve(process.argv[2] ?? '.');
const auto = (s) => { const m = /<!-- AUTO:START[^>]*-->\n?([\s\S]*?)\n?<!-- AUTO:END -->/.exec(s); return m ? m[1] : null; };
const count = (s, t) => s.split(t).length - 1;
const git = (a) => { try { return execFileSync('git', ['-C', MEM, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
const files = [];
const walk = (d, rel = '') => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith('.') || e.name === '_orphans' || e.name === '_sync') continue; const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(join(d, e.name), r); else if (e.name.endsWith('.md')) files.push(r); } };
walk(MEM);
let bad = 0;
for (const f of files) {
  if (['USER.md', 'MEMORY.md', 'README.md'].includes(f)) continue;
  const cur = readFileSync(join(MEM, f), 'utf8');
  if (count(cur, '<!-- 내 메모 시작 -->') !== 1 || count(cur, '<!-- 내 메모 끝 -->') !== 1) { console.log(`❌ ${f}: '내 메모' 시작/끝 표시가 정확히 하나씩 있어야 해요`); bad++; }
  if (f.startsWith('tasks/') && (count(cur, '<!-- 다음 할 일 수정 시작 -->') !== 1 || count(cur, '<!-- 다음 할 일 수정 끝 -->') !== 1)) { console.log(`❌ ${f}: '다음 할 일 수정' 표시가 정확히 하나씩 있어야 해요`); bad++; }
  if (process.env.MEMORY_ALLOW_AUTO !== '1') {
    const head = git(['show', `HEAD:${f}`]);
    if (head !== null && auto(head) !== null && auto(head) !== auto(cur)) {
      if (process.env.MEMORY_FIX_AUTO === '1') { // 자동 구역만 HEAD 값으로 되돌림(내 메모 편집은 그대로)
        const fixed = cur.replace(/(<!-- AUTO:START[^>]*-->\n?)([\s\S]*?)(\n?<!-- AUTO:END -->)/, (_m, a, _b, c) => a + auto(head) + c);
        writeFileSync(join(MEM, f), fixed); console.log(`🔧 ${f}: 자동 구역을 원래대로 복구(메모 편집은 유지)`);
      } else { console.log(`❌ ${f}: 자동 구역(AUTO)이 바뀌었어요 — 메모는 '내 메모' 블록에만 쓰세요. 자동 구역만 되돌리고 메모는 살리려면: bash memory-commit.sh --fix-auto "메시지"`); bad++; }
    }
  }
}
console.log(bad ? `검사 실패 ${bad}건` : `검사 통과 (${files.length}개 파일)`);
process.exit(bad ? 1 : 0);
