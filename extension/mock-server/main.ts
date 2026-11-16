// 수동 확인용: node --experimental-strip-types mock-server/main.ts [port=4547]
// 팝업 "엔진 주소"를 http://127.0.0.1:4547 로 바꾸고, 아래에 찍힌 코드로 페어링한다.
import { createMockCore } from './core.ts';
const port = Number(process.argv[2] ?? 4547);
const m = createMockCore({ requireOrigin: true });
const url = await m.listen(port);
const code = m.issueCode();
console.log(`목 코어 ${url}/api/v1 — 페어링 코드: ${code.slice(0, 3)} ${code.slice(3)} (5분) · 새 코드: curl -XPOST ${url}/api/v1/pairing`);
setInterval(() => { const s = m.state; process.stdout.write(`\r대화 ${s.convs.size} · 요청 ${s.requests.length} · 마지막 ${s.requests.at(-1)?.method ?? ''} ${s.requests.at(-1)?.path ?? ''} ${s.requests.at(-1)?.status ?? ''}      `); }, 2000);
