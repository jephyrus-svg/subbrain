/** 실행 중인 코어(기본 http://127.0.0.1:4545)에 GET 사례를 보내 zod 스키마로 검사한다. 사용: npx tsx test/smoke.ts [baseUrl] */
import { GET_CASES } from './cases.ts';

const base = (process.argv[2] ?? 'http://127.0.0.1:4545') + '/api/v1';
let fail = 0;
for (const [path, schema] of GET_CASES) {
  const res = await fetch(base + path);
  const body: unknown = await res.json();
  const r = schema.safeParse(body);
  const ok = res.status === 200 && r.success;
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${res.status} GET ${path}${r.success ? '' : '\n     ' + JSON.stringify(r.error.issues.slice(0, 3))}`);
}
console.log(fail ? `\n${fail}개 실패` : `\n모두 통과 (${GET_CASES.length}개)`);
process.exit(fail ? 1 : 0);
