// 끝까지 시험(1.9.0 실제 코어 4545 데모): 빌드한 확장을 헤드리스 Chrome에 올리고, chatgpt.com을 로컬 HTTPS(픽스처)로 돌려
// 웹 API로 페어링 코드 → 확장 팝업에서 페어링 → 대화 페이지 → 스냅샷(full) → DOM에 턴 추가 → append → 코어에서 확인.
// 실제 chatgpt.com·계정에는 닿지 않는다(host-resolver-rules로 127.0.0.1에 묶음).   node e2e/run.mjs
import { createServer } from 'node:https';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const DB = process.env.CORE_DB ?? new URL('../../.data/subbrain.db', import.meta.url).pathname; // 데모 코어 DB, 읽기만
const conv = () => { const d = new DatabaseSync(DB, { readOnly: true }); try { return d.prepare('SELECT id, title, message_count AS n, ingest_hash AS h, ingest_partial AS p FROM conversations WHERE source_ai=? AND source_id=?').get('chatgpt', SID); } finally { d.close(); } };
const here = new URL('.', import.meta.url).pathname;
const CORE = process.env.CORE ?? 'http://127.0.0.1:4545';
const DIST = join(here, '../dist');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = []; const ok = (n, c, d = '') => { R.push(!!c); console.log(c ? '  ✓' : '  ✗', n, d ? '— ' + String(d).slice(0, 260) : ''); };
const SID = `e2e0${Date.now().toString(16).slice(-4)}-0000-4000-8000-${Date.now().toString(16).padStart(12, "0").slice(-12)}`;
const TITLE = `E2E 확장 시험 ${new Date().toISOString().slice(0, 16)}`;
const fixture = readFileSync(join(here, '../test/fixtures/chatgpt-conversation.html'), 'utf8').replace(/<title>[^<]*/, `<title>${TITLE} - ChatGPT`);

// 시험용 자체 서명 인증서는 저장소에 두지 않고 실행할 때마다 임시 폴더에 만든다(openssl 필요).
const certDir = mkdtempSync(join(tmpdir(), 'subbrain-e2e-cert-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=chatgpt.com', '-keyout', join(certDir, 'key.pem'), '-out', join(certDir, 'cert.pem')], { stdio: 'ignore' });
const srv = createServer({ key: readFileSync(join(certDir, 'key.pem')), cert: readFileSync(join(certDir, 'cert.pem')) }, (req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fixture); });
await new Promise((r) => srv.listen(8443, '127.0.0.1', r));

const prof = mkdtempSync(join(tmpdir(), 'sbext-'));
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=9334', '--enable-unsafe-extension-debugging',
  '--host-resolver-rules=MAP chatgpt.com 127.0.0.1:8443, MAP claude.ai 127.0.0.1:8443', '--ignore-certificate-errors', 'about:blank'], { stdio: 'ignore' });
let ver; for (let i = 0; i < 40 && !ver; i++) { await sleep(250); try { ver = await (await fetch('http://127.0.0.1:9334/json/version')).json(); } catch { /* 아직 */ } }
function cdp(url) {
  const ws = new WebSocket(url); let id = 0; const logs = [];
  const ready = new Promise((r) => ws.onopen = r);
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + m.params.exceptionDetails.exception?.description); if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) logs.push(m.params.type + ' ' + m.params.args.map((a) => a.value ?? a.description).join(' ')); });
  const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; ws.addEventListener('message', function h(e) { const m = JSON.parse(e.data); if (m.id === i) { ws.removeEventListener('message', h); r(m); } }); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
  return { ready, send, logs, close: () => ws.close() };
}
const b = cdp(ver.webSocketDebuggerUrl); await b.ready;
const ld = await b.send('Extensions.loadUnpacked', { path: DIST });
const extId = ld.result?.id; ok('extension loads (MV3)', !!extId, extId ?? JSON.stringify(ld.error));
await sleep(1500);
const targets = async () => (await (await fetch('http://127.0.0.1:9334/json')).json());
ok('service worker running', (await targets()).some((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${extId}/`)));

// 1) 웹 API로 코드(웹 세션 — 토큰 없음)
const pr = await (await fetch(`${CORE}/api/v1/pairing`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'extension', name: 'E2E 헤드리스 크롬' }) })).json();
ok('web POST /pairing → 6-digit code', /^\d{3} ?\d{3}$/.test(pr.code ?? ''), `${pr.code} until ${pr.expiresAt}`);

// 2) 팝업에서 페어링(서비스 워커에 메시지 — 팝업 버튼과 같은 길)
const pop = await (await fetch(`http://127.0.0.1:9334/json/new?chrome-extension://${extId}/popup.html`, { method: 'PUT' })).json();
const P = cdp(pop.webSocketDebuggerUrl); await P.ready; await P.send('Runtime.enable'); await sleep(800);
const ev = async (c, expr) => (await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const wrong = await ev(P, `chrome.runtime.sendMessage({ type: 'pair', code: '000000', coreUrl: '${CORE}' })`);
ok('wrong code → friendly error', wrong && wrong.ok === false, JSON.stringify(wrong));
const pair = await ev(P, `chrome.runtime.sendMessage({ type: 'pair', code: ${JSON.stringify(pr.code)}, coreUrl: '${CORE}' })`);
ok('pair with real engine (Origin = chrome-extension://id)', pair?.ok === true, JSON.stringify(pair).replace(/sbt_[\w-]+/g, 'sbt_…'));
const stored = await ev(P, `chrome.storage.local.get('pairing').then((x) => ({ has: !!x.pairing?.token?.startsWith('sbt_'), tokenId: x.pairing?.client?.tokenId }))`);
ok('token stored in chrome.storage.local', stored?.has, stored?.tokenId);
const clients = await (await fetch(`${CORE}/api/v1/pairing/clients`)).json();
const me = (clients.items ?? clients.clients ?? []).find((c) => c.tokenId === stored?.tokenId);
ok('web GET /pairing/clients lists it with extensionId', me?.extensionId === extId, JSON.stringify(me));

// 따라잡기는 끔: 픽스처 서버가 모든 /c/* 에 같은 페이지를 주므로 사이드바 대화를 열면 데모에 가짜 대화가 생긴다(첫 실행에서 확인한 뒤 끔)
await ev(P, `chrome.runtime.sendMessage({ type: 'set-settings', patch: { catchupMode: 'off' } })`);
// 3) 대화 페이지(가짜 chatgpt.com)
const tab = await (await fetch(`http://127.0.0.1:9334/json/new?https://chatgpt.com/c/${SID}`, { method: 'PUT' })).json();
const T = cdp(tab.webSocketDebuggerUrl); await T.ready; await T.send('Runtime.enable');
await sleep(7000);
const st1 = await ev(P, `chrome.runtime.sendMessage({ type: 'status' })`);
const site1 = st1?.sites?.chatgpt ?? st1?.sites?.find?.((s) => s.ai === 'chatgpt');
const c1 = conv();
ok('core stored the conversation (full)', c1 && c1.n === 4, JSON.stringify(c1));
ok('snapshot sent (popup status)', site1 && site1.lastResult === 'accepted', JSON.stringify({ r: site1?.lastResult, e: site1?.lastError, t: site1?.lastTitle }));

// 4) 턴 추가 → append
const mut = await ev(T, `(() => { const arts = [...document.querySelectorAll('article[data-testid^="conversation-turn"]')]; const u = arts.at(-2).cloneNode(true), a = arts.at(-1).cloneNode(true);
  u.querySelector('[data-message-id]').setAttribute('data-message-id', 'e2e-user-9'); u.querySelector('[data-message-author-role]').querySelectorAll('div').forEach(d => { if (!d.children.length) d.textContent = 'E2E 추가 질문: 한 줄로 줄여 줘'; });
  a.querySelector('[data-message-id]').setAttribute('data-message-id', 'e2e-asst-9'); const md = a.querySelector('.markdown') ?? a.querySelector('[data-message-author-role]'); md.innerHTML = '<p>E2E 추가 답: 짧게 쓴 한 줄 안</p>';
  arts.at(-1).after(u, a); return [arts.length, document.querySelectorAll('[data-message-author-role]').length, a.textContent.slice(0, 60), u.textContent.slice(0, 60)]; })()`);
console.log('    mutated:', JSON.stringify(mut));
await sleep(9000);
const st2 = await ev(P, `chrome.runtime.sendMessage({ type: 'status' })`);
const site2 = st2?.sites?.chatgpt ?? st2?.sites?.find?.((s) => s.ai === 'chatgpt');
const c2 = conv();
ok('core has the appended turns (6 messages, new hash)', c2 && c2.n === 6 && c2.h !== c1?.h, JSON.stringify(c2));
ok('new turns → sent again (append)', site2?.lastResult === 'accepted' && site2?.sentToday?.n >= 2, JSON.stringify({ r: site2?.lastResult, n: site2?.sentToday, e: site2?.lastError }));

// 5) 코어 쪽 확인
const ss = await (await fetch(`${CORE}/api/v1/sync-state`)).json();
const cg = ss.sources?.find((s) => s.sourceAi === 'chatgpt');
ok('core /sync-state: chatgpt lastSnapshotAt + adapter + health', cg?.lastSnapshotAt && cg?.adapter?.name, JSON.stringify(cg));
const sess = await ev(P, `chrome.storage.local.get('pairing').then(async (x) => { try { const r = await fetch('${CORE}/api/v1/session', { headers: { Authorization: 'Bearer ' + x.pairing.token } }); return { status: r.status, ...(await r.json()) }; } catch (e) { return { err: String(e) }; } })`);
// 알림: Chrome은 host_permissions가 있는 확장의 GET에는 Origin을 안 붙인다 → 코어가 403 origin. 확장은 GET을 토큰으로 부르지 않으니 기록만
console.log('    info: GET /session from extension page →', JSON.stringify(sess).slice(0, 200));
const errs = [...P.logs, ...T.logs].filter((l) => !/DevTools|favicon/.test(l));
ok('no extension errors in popup/page console', errs.length === 0, errs.join(' / '));
// 정리: 시험 토큰은 웹 API로 폐기(대화 삭제 API는 아직 없음 — 만든 대화 id를 남김)
if (stored?.tokenId) { const rv = await fetch(`${CORE}/api/v1/pairing/clients/${stored.tokenId}/revoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); ok('cleanup: test token revoked', rv.ok); }
console.log(JSON.stringify({ conversationId: conv()?.id, sourceId: SID, title: TITLE, tokenId: stored?.tokenId }));
for (const c of [P, T, b]) c.close();
chrome.kill('SIGKILL'); srv.close(); await sleep(300); rmSync(prof, { recursive: true, force: true });
console.log(`${R.filter(Boolean).length}/${R.length} passed`);
process.exit(R.every(Boolean) ? 0 : 1);
