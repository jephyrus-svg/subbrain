// API_CONTRACT.md 생성: template + api-types.ts + JSON 예시
//   1) shared: 정적 목(fixtures.ts, tsc 검사) → mocks/json   2) core: 엔진이 시드 위에서 캡처한 응답 → mocks/json (+ demo/)
// 사용: node scripts/build-contract.mjs   (Node 22+, app/ 에서)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
const shared = new URL('packages/shared/', root);
execFileSync(process.execPath, ['--no-warnings', '--experimental-strip-types', 'mocks/dump.ts'], { cwd: shared, stdio: 'inherit' });
const core = new URL('packages/core/', root);
execFileSync(process.execPath, ['--no-warnings', new URL('node_modules/tsx/dist/cli.mjs', core).pathname, 'src/cli.ts', 'mocks'], { cwd: core, stdio: 'inherit' });
const inline = (o) => o === null || typeof o !== 'object' ? JSON.stringify(o)
  : Array.isArray(o) ? '[' + o.map(inline).join(', ') + ']'
  : '{' + Object.entries(o).map(([k, v]) => JSON.stringify(k) + ': ' + inline(v)).join(', ') + '}';
const fmt = (o, depth = 0, col = 0, width = 110) => {
  const one = inline(o);
  if (o === null || typeof o !== 'object' || Object.keys(o).length === 0 || col + one.length <= width) return one;
  const pad = '  '.repeat(depth + 1), end = '  '.repeat(depth);
  if (Array.isArray(o)) return '[\n' + o.map((v) => pad + fmt(v, depth + 1, pad.length, width)).join(',\n') + '\n' + end + ']';
  return '{\n' + Object.entries(o).map(([k, v]) => { const key = pad + JSON.stringify(k) + ': '; return key + fmt(v, depth + 1, key.length, width); }).join(',\n') + '\n' + end + '}';
};
let doc = readFileSync(new URL('scripts/contract.template.md', root), 'utf8');
doc = doc.replace('{{types}}', readFileSync(new URL('src/api-types.ts', shared), 'utf8').trimEnd());
// {{json:이름}} · {{json:이름|abbr=task}}(TaskDetail 줄임) · {{json:이름|cap=3}}(긴 배열은 앞 N개만 — 전체는 mocks/json)
const capArrays = (o, n) => Array.isArray(o) ? o.slice(0, n).map((v) => capArrays(v, n)) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, capArrays(v, n)])) : o;
doc = doc.replace(/\{\{json:([A-Za-z0-9]+)(?:\|abbr=(\w+))?(?:\|cap=(\d+))?\}\}/g, (_, name, abbr, cap) => {
  let data = JSON.parse(readFileSync(new URL(`mocks/json/${name}.json`, shared), 'utf8'));
  if (cap) data = capArrays(data, Number(cap));
  if (abbr) { const t = data[abbr]; data[abbr] = { __abbreviated__: 'GET /tasks/:taskId 응답(TaskDetail)과 같은 모양 — 바뀐 값 반영', id: t.id, status: t.status, overrides: t.overrides }; }
  return fmt(data);
});
doc = doc.replace(/```json\n([\s\S]*?)\n```/g, (_, body) => '```json\n' + fmt(JSON.parse(body)) + '\n```');
if (doc.includes('{{')) throw new Error('unfilled placeholder');
writeFileSync(new URL('API_CONTRACT.md', root), doc);
console.log('API_CONTRACT.md', doc.split('\n').length, 'lines');
