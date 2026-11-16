/**
 * Phase 10 (계약 1.9.0) — 확장 수집 API: 페어링(코드·Origin·5번 틀림·교체·폐기) · 토큰 범위 · 스냅샷 멱등(duplicate/accepted/partial/stale) ·
 * append(BASE_MISMATCH) · 해시 검증 · 비밀 가림 · 재전송 · 따라잡기 diff · 어댑터 상태 · 속도 제한 · MCP HTTP 토큰
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { makeCore } from './helpers.ts';
import { debouncerFor } from '../src/ingest/ingest.ts';
import { createHttpApp } from '../src/mcp/main.ts';

type T = Awaited<ReturnType<typeof makeCore>>;
let t: T | null = null;
afterEach(() => { t?.close(); t = null; process.env.SUBBRAIN_INGEST_AUTO_CLASSIFY = '1'; });
// 기존 시나리오는 자동 분류가 켜진 상태를 전제(2026-10-16부터 기본은 끔 — 아래 '기본값' 테스트에서 따로 확인)
process.env.SUBBRAIN_INGEST_AUTO_CLASSIFY = '1';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const ORIGIN = `chrome-extension://${EXT}`;
const hashOf = (ms: Array<{ role: string; contentMd: string }>) => createHash('sha256').update(ms.map((m) => `${m.role}\0${m.contentMd}`).join('\n\0')).digest('hex');
function snap(over: Record<string, unknown> = {}, msgs?: Array<{ role: 'user' | 'assistant'; contentMd: string }>) {
  const messages = (msgs ?? [{ role: 'user', contentMd: '크롬 확장 수집 테스트 질문' }, { role: 'assistant', contentMd: '답변입니다' }]).map((m, i) => ({ seq: i, externalId: `m${i}`, role: m.role, contentMd: m.contentMd, createdAt: `2026-10-12T01:0${i}:00+09:00` }));
  return { sourceAi: 'claude', sourceId: 'live-conv-1', url: 'https://claude.ai/chat/live-conv-1', title: '실시간 수집 대화', capturedAt: '2026-10-12T01:10:00+09:00', serviceUpdatedAt: '2026-10-12T01:09:00+09:00',
    captureMethod: 'extension_live', mode: 'full', messages, contentHash: hashOf(messages), complete: true, adapter: { name: 'claude-dom', version: '0.1.0' }, ...over };
}
async function pairExt(tt: T) {
  const s = await tt.json('POST', '/pairing', { kind: 'extension', name: '내 크롬' });
  expect(s.status).toBe(201);
  const c = await tt.json('POST', '/pairing/complete', { code: s.body.code, client: { kind: 'extension', name: 'SubBrain', version: '0.1.0', extensionId: EXT } }, { origin: ORIGIN });
  expect(c.status).toBe(201);
  return { token: c.body.token as string, tokenId: c.body.client.tokenId as string };
}
const ext = (tt: T, token: string) => (method: string, path: string, body?: unknown, h: Record<string, string> = {}) => tt.json(method, path, body, { origin: ORIGIN, authorization: `Bearer ${token}`, ...h });

describe('페어링 · 토큰', () => {
  it('코드 → 토큰(sbt_, sha256만 저장) · Origin 불일치 403 · 5번 틀리면 폐기 · 세션 · 목록 · 교체(옛 토큰 300초) · 폐기 401 revoked', async () => {
    process.env.SUBBRAIN_INGEST_DEBOUNCE_MS = '0';
    t = await makeCore({ seeded: true });
    // 확장 Origin으로 페어링 시작은 안 됨
    expect((await t.json('POST', '/pairing', { kind: 'extension' }, { origin: ORIGIN })).status).toBe(403);
    const s = await t.json('POST', '/pairing', { kind: 'extension' });
    expect(s.body.code).toMatch(/^\d{6}$/);
    const bad = await t.json('POST', '/pairing/complete', { code: s.body.code, client: { kind: 'extension', name: 'x', version: '1', extensionId: EXT } }, { origin: 'chrome-extension://zzzzzzzzzzzzzzzz' });
    expect(bad.status).toBe(403);
    // 5번 틀리면 폐기
    for (let i = 0; i < 5; i++) expect((await t.json('POST', '/pairing/complete', { code: s.body.code === '000000' ? '111111' : '000000', client: { kind: 'extension', name: 'x', version: '1', extensionId: EXT } }, { origin: ORIGIN })).status).toBe(401);
    expect((await t.json('POST', '/pairing/complete', { code: s.body.code, client: { kind: 'extension', name: 'x', version: '1', extensionId: EXT } }, { origin: ORIGIN })).status).toBe(401);
    const { token, tokenId } = await pairExt(t);
    expect(token).toMatch(/^sbt_[A-Za-z0-9_-]{43}$/);
    expect(t.core.db.value('SELECT COUNT(*) FROM client_tokens WHERE token_hash LIKE ?', `%${token}%`)).toBe(0);
    const call = ext(t, token);
    const sess = await call('GET', '/session');
    expect(sess.body).toMatchObject({ kind: 'extension', scopes: ['ingest'], client: { tokenId, extensionId: EXT } });
    expect((await t.json('GET', '/session')).body.kind).toBe('web');
    // 범위 밖: 확장 토큰으로 과제 목록 403, 다른 Origin에서 같은 토큰 403
    expect((await call('GET', '/tasks')).body.error.details.reason).toBe('scope');
    expect((await t.json('GET', '/session', undefined, { authorization: `Bearer ${token}` })).status).toBe(200);
    // 토큰 없이 수집 401, 틀린 토큰 401
    expect((await t.json('POST', '/ingest/snapshot', snap(), { origin: ORIGIN })).status).toBe(401);
    expect((await ext(t, 'sbt_nope')('POST', '/ingest/snapshot', snap())).status).toBe(401);
    // CORS 미리 요청
    const pre = await t.req('/ingest/snapshot', { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    // 목록(웹만)
    expect((await t.json('GET', '/pairing/clients')).body.items[0].tokenId).toBe(tokenId);
    expect((await call('GET', '/pairing/clients')).status).toBe(403);
    // 교체
    const rot = await call('POST', `/pairing/clients/${tokenId}/rotate`, {});
    expect(rot.status).toBe(200);
    expect(rot.body.token).not.toBe(token);
    expect((await call('GET', '/session')).status).toBe(200); // 옛 토큰 유예
    expect((await ext(t, rot.body.token)('GET', '/session')).status).toBe(200);
    t.core.db.run("UPDATE client_tokens SET prev_valid_until='2000-01-01T00:00:00Z'");
    expect((await call('GET', '/session')).body.error.details.reason).toBe('rotated');
    // 폐기
    expect((await t.json('POST', `/pairing/clients/${tokenId}/revoke`, {})).body.revokedAt).toBeTruthy();
    expect((await ext(t, rot.body.token)('GET', '/session')).body.error.details.reason).toBe('revoked');
  });
});

describe('스냅샷 수집', () => {
  it('2026-10-16 기본값: 자동 분류 끔(skipped, 분류 작업 없음) · 내보내기 대화보다 짧은 첫 화면 스냅샷은 덮어쓰지 않음(stale) · 길면 저장(raw_path 유지)', async () => {
    process.env.SUBBRAIN_INGEST_DEBOUNCE_MS = '0';
    delete process.env.SUBBRAIN_INGEST_AUTO_CLASSIFY;
    t = await makeCore({ seeded: true });
    const call = ext(t, (await pairExt(t)).token);
    const db = t.core.db;
    const r1 = await call('POST', '/ingest/snapshot', snap());
    expect(r1.body).toMatchObject({ status: 'accepted', classification: 'skipped' });
    await t.core.queue.idle();
    expect(db.value("SELECT COUNT(*) FROM jobs WHERE type='classify'")).toBe(0);
    // 내보내기로만 있던 대화처럼 만들기: ingest 기록 지우고 메시지 4개 · raw_path
    const id = r1.body.conversationId;
    db.run("UPDATE conversations SET ingest_captured_at=NULL, ingest_hash=NULL, capture_method='export', raw_path='raw/x.json' WHERE id=?", id);
    for (const seq of [3, 4]) db.run("INSERT INTO messages(conversation_id,seq,role,content_md,content_hash) VALUES (?,?,?,?,?)", id, seq, seq === 3 ? 'user' : 'assistant', '내보내기에만 있는 메시지', 'h' + seq);
    db.run('UPDATE conversations SET message_count=4, content_hash=? WHERE id=?', 'exporthash', id);
    const short = snap({ capturedAt: '2026-10-12T02:00:00+09:00' }, [{ role: 'user', contentMd: '화면에 보이는 것만' }, { role: 'assistant', contentMd: '일부' }, { role: 'user', contentMd: '세 번째' }]);
    const r2 = await call('POST', '/ingest/snapshot', short);
    expect(r2.body.status).toBe('stale');
    expect(db.value('SELECT COUNT(*) FROM messages WHERE conversation_id=?', id)).toBe(4);
    const long = snap({ capturedAt: '2026-10-12T02:01:00+09:00' }, [{ role: 'user', contentMd: 'a' }, { role: 'assistant', contentMd: 'b' }, { role: 'user', contentMd: 'c' }, { role: 'assistant', contentMd: 'd' }, { role: 'user', contentMd: '테스트' }]);
    const r3 = await call('POST', '/ingest/snapshot', long);
    expect(r3.body).toMatchObject({ status: 'accepted', messageCount: 5, classification: 'skipped' });
    expect(db.value('SELECT raw_path FROM conversations WHERE id=?', id)).toBe('raw/x.json');
    expect(db.value('SELECT ingest_captured_at IS NOT NULL FROM conversations WHERE id=?', id)).toBe(1);
    process.env.SUBBRAIN_INGEST_AUTO_CLASSIFY = '1';
  });

  it('accepted → duplicate(같은 키) · Idempotency-Key 불일치 400 · 해시 불일치 400 · 비밀 가림 · 분류 큐 · 대시보드 실시간', async () => {
    process.env.SUBBRAIN_INGEST_DEBOUNCE_MS = '0';
    t = await makeCore({ seeded: true });
    const call = ext(t, (await pairExt(t)).token);
    const b = snap({}, [{ role: 'user', contentMd: '이 키 써 줘 sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefgh 확장 수집' }, { role: 'assistant', contentMd: '네' }]);
    const key = `claude:live-conv-1:${b.contentHash}`;
    expect((await call('POST', '/ingest/snapshot', b, { 'idempotency-key': 'claude:x:y' })).status).toBe(400);
    expect((await call('POST', '/ingest/snapshot', { ...b, contentHash: 'deadbeef' })).status).toBe(400);
    const r1 = await call('POST', '/ingest/snapshot', b, { 'idempotency-key': key });
    expect(r1.status).toBe(202);
    expect(r1.body).toMatchObject({ status: 'accepted', idempotencyKey: key, contentHash: b.contentHash, messageCount: 2, classification: 'queued' });
    const db = t.core.db;
    expect(db.value('SELECT capture_method FROM conversations WHERE id=?', r1.body.conversationId)).toBe('extension_live');
    expect(String(db.value('SELECT content_md FROM messages WHERE conversation_id=? AND seq=1', r1.body.conversationId))).not.toContain('sk-ant-api03');
    expect(db.value('SELECT external_id FROM messages WHERE conversation_id=? AND seq=2', r1.body.conversationId)).toBe('m1');
    const r2 = await call('POST', '/ingest/snapshot', b);
    expect(r2.status).toBe(200);
    expect(r2.body.status).toBe('duplicate');
    await t.core.queue.idle();
    expect(db.value('SELECT classified_hash=content_hash FROM conversations WHERE id=?', r1.body.conversationId)).toBe(1);
    const dash = await t.json('GET', '/dashboard');
    expect(dash.body.collection.sources.find((s: { sourceAi: string }) => s.sourceAi === 'claude').methods).toContain('extension_live');
  });

  it('partial(스트리밍) → 분류 안 함 → 완성 · debounced · stale(늦게 온 옛 것) · append + BASE_MISMATCH', async () => {
    process.env.SUBBRAIN_INGEST_DEBOUNCE_MS = '0';
    t = await makeCore({ seeded: true });
    const deb = debouncerFor(t.core);
    deb.ms = 60_000;
    const call = ext(t, (await pairExt(t)).token);
    const p = await call('POST', '/ingest/snapshot', snap({ complete: false }, [{ role: 'user', contentMd: '질문' }, { role: 'assistant', contentMd: '답이 아직' }]));
    expect(p.status).toBe(202);
    expect(p.body).toMatchObject({ status: 'partial', classification: 'skipped' });
    expect(t.core.db.value('SELECT ingest_partial FROM conversations WHERE id=?', p.body.conversationId)).toBe(1);
    const fin = snap({ capturedAt: '2026-10-12T01:11:00+09:00' }, [{ role: 'user', contentMd: '질문' }, { role: 'assistant', contentMd: '답이 아직 끝났어요' }]);
    const f = await call('POST', '/ingest/snapshot', fin);
    expect(f.body).toMatchObject({ status: 'accepted', classification: 'debounced', conversationId: p.body.conversationId });
    expect(deb.pending()).toBe(1);
    deb.close();
    // 늦게 온 옛 스냅샷(메시지 더 적음)
    const old = snap({ capturedAt: '2026-10-12T00:59:00+09:00' }, [{ role: 'user', contentMd: '질문' }]);
    expect((await call('POST', '/ingest/snapshot', old)).body.status).toBe('stale');
    // append: 기준 해시 맞으면 이어 붙임
    const all = [{ role: 'user' as const, contentMd: '질문' }, { role: 'assistant' as const, contentMd: '답이 아직 끝났어요' }, { role: 'user' as const, contentMd: '추가 질문' }];
    const full3 = snap({}, all);
    const ap = { ...full3, mode: 'append', appendFromSeq: 2, baseContentHash: fin.contentHash, messages: full3.messages.slice(2), capturedAt: '2026-10-12T01:12:00+09:00' };
    const a = await call('POST', '/ingest/snapshot', ap);
    expect(a.status).toBe(202);
    expect(a.body.messageCount).toBe(3);
    const mm = await call('POST', '/ingest/snapshot', { ...ap, baseContentHash: 'wrong', contentHash: hashOf([...all, { role: 'assistant', contentMd: 'x' }]) });
    expect(mm.status).toBe(409);
    expect(mm.body.error.details).toMatchObject({ reason: 'BASE_MISMATCH', expectedContentHash: full3.contentHash });
  });

  it('재전송(오래된 것부터, 항목별 결과·순서 유지, 다시 보내도 안전) · 속도 제한 429', async () => {
    process.env.SUBBRAIN_INGEST_DEBOUNCE_MS = '0';
    t = await makeCore({ seeded: true });
    const call = ext(t, (await pairExt(t)).token);
    const s1 = snap({ sourceId: 'off-1', capturedAt: '2026-10-11T10:00:00+09:00' });
    const s2 = snap({ sourceId: 'off-2', capturedAt: '2026-10-11T09:00:00+09:00' });
    const broken = { ...snap({ sourceId: 'off-3' }), contentHash: 'nope' };
    const r = await call('POST', '/ingest/replay', { snapshots: [s1, broken, s2] });
    expect(r.status).toBe(200);
    expect(r.body.results.map((x: { index: number; ok: boolean }) => [x.index, x.ok])).toEqual([[0, true], [1, false], [2, true]]);
    expect(r.body.results[1].error.error.code).toBe('VALIDATION_ERROR');
    const again = await call('POST', '/ingest/replay', { snapshots: [s1, s2] });
    expect(again.body.results.map((x: { result: { status: string } }) => x.result.status)).toEqual(['duplicate', 'duplicate']);
    let last = 0;
    for (let i = 0; i < 62; i++) last = (await call('POST', '/ingest/catchup/diff', { sourceAi: 'claude', items: [], cursor: null, endOfList: false })).status;
    expect(last).toBe(429);
  });
});

describe('따라잡기 · 어댑터 상태', () => {
  it('diff: new/updated/unknown_time(하루 한 번)/retry · 커서 · stopBefore · sync-state · health → 대시보드 고장', async () => {
    process.env.SUBBRAIN_INGEST_DEBOUNCE_MS = '0';
    t = await makeCore({ seeded: true });
    const call = ext(t, (await pairExt(t)).token);
    await call('POST', '/ingest/snapshot', snap({ sourceId: 'known-1', serviceUpdatedAt: '2026-10-10T00:00:00Z' }));
    const items = [
      { sourceId: 'known-1', title: 'a', updatedAt: '2026-10-10T00:00:00Z' },
      { sourceId: 'known-1b', title: 'b', updatedAt: '2026-10-09T00:00:00Z' },
      { sourceId: 'unk', title: 'c', updatedAt: null },
    ];
    await call('POST', '/ingest/snapshot', snap({ sourceId: 'unk' }));
    const d1 = await call('POST', '/ingest/catchup/diff', { sourceAi: 'claude', items, cursor: null, endOfList: false });
    expect(d1.status).toBe(200);
    expect(d1.body.fetch).toEqual([{ sourceId: 'known-1b', reason: 'new' }, { sourceId: 'unk', reason: 'unknown_time' }]);
    expect(d1.body.skipped).toBe(1);
    expect(d1.body.rate.maxFetchPerMinute).toBe(6);
    // 2쪽: known-1이 서비스에서 더 새로워짐, 끝까지 봄 → 커서 저장
    const d2 = await call('POST', '/ingest/catchup/diff', { sourceAi: 'claude', items: [{ sourceId: 'known-1', title: 'a', updatedAt: '2026-10-11T00:00:00Z' }], cursor: d1.body.cursor, endOfList: true });
    expect(d2.body.fetch).toEqual([{ sourceId: 'known-1', reason: 'updated' }]);
    // 바로 다시: 방금 요청한 건 기다림, unknown은 하루 한 번
    const d3 = await call('POST', '/ingest/catchup/diff', { sourceAi: 'claude', items, cursor: null, endOfList: false });
    expect(d3.body.fetch).toEqual([]);
    expect(d3.body.stopBefore).toBe('2026-10-11T09:00:00+09:00');
    // 1시간 넘게 안 온 요청 → retry
    t.core.db.run("UPDATE catchup_items SET requested_at='2026-09-01T00:00:00Z' WHERE source_id='known-1b'");
    expect((await call('POST', '/ingest/catchup/diff', { sourceAi: 'claude', items, cursor: null, endOfList: false })).body.fetch).toEqual([{ sourceId: 'known-1b', reason: 'retry' }]);
    const st = await call('GET', '/sync-state');
    const cl = st.body.sources.find((s: { sourceAi: string }) => s.sourceAi === 'claude');
    expect(cl).toMatchObject({ cursor: '2026-10-11T09:00:00+09:00', pendingFetch: 3 });
    const h = await call('POST', '/sync-state/claude/health', { adapter: { name: 'claude-dom', version: '0.1.0', domVersion: '2026-10' }, health: 'broken', checks: [{ name: 'message_selector', ok: false }], errorCode: 'SELECTOR_NOT_FOUND', at: '2026-10-12T01:00:00+09:00', bufferedSnapshots: 3 });
    expect(h.status).toBe(200);
    expect(h.body.state).toMatchObject({ health: 'broken', errorCode: 'SELECTOR_NOT_FOUND', bufferedSnapshots: 3, adapter: { name: 'claude-dom', version: '0.1.0' } });
    expect(h.body.collection.health).toBe('broken');
    expect((await t.json('GET', '/dashboard')).body.collection.overallHealth).toBe('broken');
    expect((await call('POST', '/sync-state/nope/health', { adapter: { name: 'x', version: '1' }, health: 'ok', checks: [], at: '2026-10-12T01:00:00+09:00' })).status).toBe(400);
  });
});

describe('MCP Streamable HTTP 토큰', () => {
  it('토큰 없음 401 · 확장 토큰 403 · 읽기 토큰은 쓰기 도구 숨김 · 쓰기 토큰은 18개', async () => {
    t = await makeCore({ seeded: true });
    const tt = t;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => { const u = new URL(String(input)); return tt.app.request(u.pathname + u.search, { ...init, headers: { ...(init?.headers as Record<string, string> ?? {}), host: '127.0.0.1:4545' } }); }) as typeof fetch;
    const app = createHttpApp({ coreUrl: 'http://127.0.0.1:4545', port: 4547, fetchImpl });
    const rpc = (token?: string) => app.request('/mcp', { method: 'POST', headers: { host: '127.0.0.1:4547', 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
    const none = await rpc();
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toContain('Bearer');
    const pair = async (allowWrite: boolean) => {
      const s = await tt.json('POST', '/pairing', { kind: 'mcp', allowWrite });
      return (await tt.json('POST', '/pairing/complete', { code: s.body.code, client: { kind: 'mcp', name: 'claude-code', version: '1' } })).body.token as string;
    };
    const ro = await pair(false), rw = await pair(true);
    const tools = async (tok: string) => ((await (await rpc(tok)).json()) as { result: { tools: Array<{ name: string }> } }).result.tools.map((x) => x.name);
    expect((await tools(ro)).length).toBe(18);
    expect((await tools(rw)).length).toBe(24);
    expect((await rpc('sbt_wrong')).status).toBe(401);
    // 읽기 토큰으로 코어 쓰기 경로 직접 → 403
    expect((await tt.json('POST', '/mcp/log-task', { title: 'x', sourceAi: 'claude' }, { authorization: `Bearer ${ro}` })).status).toBe(403);
    expect((await tt.json('POST', '/mcp/log-task', { title: 'x', sourceAi: 'claude' }, { authorization: `Bearer ${rw}` })).status).toBe(201);
  });
});

describe('1.9.1 보정', () => {
  it('sha256: 접두어 허용 · GET은 Origin 없으면 허용(있는데 다르면 403, POST는 필수) · 따라잡기 스냅샷 분당 6개 · 시각 +09:00 · MCP 기록에 기기', async () => {
    process.env.SUBBRAIN_INGEST_DEBOUNCE_MS = '0';
    t = await makeCore({ seeded: true });
    const { token } = await pairExt(t);
    const call = ext(t, token);
    const b = snap({ capturedAt: '2026-10-11T16:10:00Z' });
    const r = await call('POST', '/ingest/snapshot', { ...b, contentHash: 'sha256:' + b.contentHash }, { 'idempotency-key': `claude:live-conv-1:sha256:${b.contentHash}` });
    expect(r.status).toBe(202);
    expect(r.body.contentHash).toBe(b.contentHash);
    expect((await call('POST', '/ingest/snapshot', b)).body.status).toBe('duplicate');
    expect(t.core.db.value('SELECT ingest_captured_at FROM conversations WHERE id=?', r.body.conversationId)).toBe('2026-10-12T01:10:00+09:00');
    const noOrigin = { authorization: `Bearer ${token}` };
    expect((await t.json('GET', '/sync-state', undefined, noOrigin)).status).toBe(200);
    expect((await t.json('GET', '/sync-state', undefined, { ...noOrigin, origin: 'chrome-extension://zzzzzzzzzzzzzzzz' })).status).toBe(403);
    expect((await t.json('POST', '/ingest/catchup/diff', { sourceAi: 'claude', items: [], cursor: null, endOfList: false }, noOrigin)).status).toBe(403);
    expect((await t.json('GET', '/tasks', undefined, noOrigin)).status).toBe(403); // 범위는 그대로
    const h = await call('POST', '/sync-state/claude/health', { adapter: { name: 'a', version: '1' }, health: 'ok', checks: [], at: '2026-10-11T16:00:00Z' });
    expect(h.body.state.healthAt).toBe('2026-10-12T01:00:00+09:00');
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await call('POST', '/ingest/snapshot', snap({ sourceId: `cu-${i}`, captureMethod: 'extension_catchup' }))).status);
    expect(codes.slice(0, 6).every((c) => c === 202)).toBe(true);
    const last = await call('POST', '/ingest/snapshot', snap({ sourceId: 'cu-x', captureMethod: 'extension_catchup' }));
    expect(last.status).toBe(429);
    expect(Number(last.res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await call('POST', '/ingest/snapshot', snap({ sourceId: 'live-ok' }))).status).toBe(202); // 실시간은 따로
    // MCP 기록에 기기
    const s = await t.json('POST', '/pairing', { kind: 'mcp', name: '맥 Claude Code', allowWrite: true });
    const mt = (await t.json('POST', '/pairing/complete', { code: s.body.code, client: { kind: 'mcp', name: 'cc', version: '1' } })).body.token;
    await t.json('POST', '/mcp/log-task', { title: '기기 표시 과제', sourceAi: 'claude' }, { authorization: `Bearer ${mt}` });
    await t.json('POST', '/mcp/log-task', { title: 'STDIO 과제', sourceAi: 'claude' });
    const ev = (await t.json('GET', '/mcp/events')).body.items;
    expect(ev[1].client).toMatchObject({ name: '맥 Claude Code', kind: 'mcp' });
    expect(ev[0].client).toBeNull();
  });

  it('dev purge-conversation: 대화·메시지·혼자 가진 과제까지 지움', async () => {
    process.env.SUBBRAIN_INGEST_DEBOUNCE_MS = '0';
    t = await makeCore({ seeded: true });
    const call = ext(t, (await pairExt(t)).token);
    const r = await call('POST', '/ingest/snapshot', snap({ sourceId: 'smoke-1' }));
    const { purgeConversation } = await import('../src/dev-purge.ts');
    const p = purgeConversation(t.core, 'smoke-1');
    expect(p).toMatchObject({ conversationId: r.body.conversationId, taskRemoved: r.body.taskId });
    const db = t.core.db;
    expect(db.value('SELECT COUNT(*) FROM conversations WHERE id=?', r.body.conversationId)).toBe(0);
    expect(db.value('SELECT COUNT(*) FROM messages WHERE conversation_id=?', r.body.conversationId)).toBe(0);
    expect(db.value('SELECT COUNT(*) FROM tasks WHERE id=?', r.body.taskId)).toBe(0);
    const hits = (await t.json('GET', '/search?q=' + encodeURIComponent('수집 테스트 질문'))).body.items;
    expect(hits.filter((h: { conversationId: string | null }) => h.conversationId === r.body.conversationId)).toEqual([]);
  });
});

