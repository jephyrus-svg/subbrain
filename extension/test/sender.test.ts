// 서비스 워커 전송 로직 ↔ 계약 1.5.0 목 코어(실제 HTTP): 멱등 · append · BASE_MISMATCH · 오프라인 버퍼 · replay · 401 · 페어링
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMockCore } from '../mock-server/core';
import { CoreClient, backoffLeftSec, resetBackoff } from '../src/background/api';
import { idbBuffer, type SnapshotBuffer } from '../src/background/buffer';
import { pair } from '../src/background/pairing';
import { flushBuffer, sendSnapshot, toBody, type SenderDeps } from '../src/background/sender';
import { memoryKV, type Pairing } from '../src/background/settings';
import { getSite } from '../src/background/state';
import type { IngestMessage } from '../src/shared/contract';
import type { PageSnapshot } from '../src/shared/messages';

const mock = createMockCore({ extensionId: 'testextid' });
let base = '';
beforeAll(async () => { base = await mock.listen(); });
afterAll(() => mock.close());

const msg = (seq: number, role: 'user' | 'assistant', text: string): IngestMessage => ({ seq, externalId: `m${seq}`, role, contentMd: text, createdAt: null });
let t0 = Date.parse('2026-10-12T01:00:00+09:00');
function snap(id: string, msgs: IngestMessage[], extra: Partial<PageSnapshot> = {}): PageSnapshot {
  t0 += 1000;
  return { sourceAi: 'chatgpt', sourceId: id, url: `https://chatgpt.com/c/${id}`, title: '테스트 ' + id, messages: msgs, complete: true, project: null, adapter: { name: 'chatgpt-dom', version: '0.1.0', domVersion: 'x' }, catchup: false, capturedAt: new Date(t0).toISOString(), ...extra };
}

let kv: ReturnType<typeof memoryKV>; let buffer: SnapshotBuffer; let deps: SenderDeps; let fetchImpl: typeof fetch;
beforeEach(async () => {
  resetBackoff(); mock.state.convs.clear(); mock.state.keys.clear(); mock.state.requests.length = 0; mock.state.down = false; mock.state.rate = [];
  kv = memoryKV(); buffer = idbBuffer(new IDBFactory());
  fetchImpl = (...a) => fetch(...a);
  const core = new CoreClient({ fetch: (...a) => fetchImpl(...a), baseUrl: async () => base, token: async () => (await kv.get<Pairing>('pairing'))?.token ?? null });
  deps = { kv, core, buffer, now: () => new Date() };
  const code = mock.issueCode('418207');
  const r = await pair({ kv, core: () => core, extensionId: 'testextid' }, '418 207', base);
  expect(r.ok, code).toBe(true);
});
const ingestCalls = () => mock.state.requests.filter((r) => r.path === '/ingest/snapshot');

describe('pairing', () => {
  it('stores the one-time token and client in storage.local; wrong code is a friendly error', async () => {
    const p = (await kv.get<Pairing>('pairing'))!;
    expect(p.token).toMatch(/^sbt_/); expect(p.client.scopes).toEqual(['ingest']);
    const core = new CoreClient({ fetch, baseUrl: async () => base, token: async () => null });
    const bad = await pair({ kv, core: () => core, extensionId: 'otherextid' }, '000 000', base);
    expect(bad).toMatchObject({ ok: false, message: expect.stringContaining('코드가 맞지 않거나') });
    expect(await pair({ kv, core: () => core, extensionId: 'otherextid' }, '12', base)).toMatchObject({ ok: false });
  });
});

describe('snapshot sending', () => {
  it('first send = full + accepted; same content again = skipped locally (no request)', async () => {
    const m = [msg(0, 'user', '질문'), msg(1, 'assistant', '답')];
    expect((await sendSnapshot(deps, snap('c1', m))).status).toBe('accepted');
    expect((ingestCalls()[0]!.body as { mode: string }).mode).toBe('full');
    expect((await sendSnapshot(deps, snap('c1', m))).status).toBe('skipped');
    expect(ingestCalls()).toHaveLength(1);
    const s = await getSite(kv, 'chatgpt');
    expect(s.lastResult).toBe('accepted'); expect(s.lastSentAt).not.toBeNull();
  });

  it('new messages → append from the acknowledged count with baseContentHash', async () => {
    const m = [msg(0, 'user', '질문'), msg(1, 'assistant', '답')];
    await sendSnapshot(deps, snap('c2', m));
    const r = await sendSnapshot(deps, snap('c2', [...m, msg(2, 'user', '더'), msg(3, 'assistant', '네')]));
    expect(r.status).toBe('accepted');
    const body = ingestCalls().at(-1)!.body as { mode: string; appendFromSeq: number; messages: unknown[]; baseContentHash: string };
    expect(body).toMatchObject({ mode: 'append', appendFromSeq: 2 });
    expect(body.messages).toHaveLength(2);
    expect(mock.state.convs.get('chatgpt:c2')!.messages).toHaveLength(4);
  });

  it('an edited earlier message → full (prefix hash differs)', async () => {
    await sendSnapshot(deps, snap('c3', [msg(0, 'user', '질문'), msg(1, 'assistant', '답')]));
    await sendSnapshot(deps, snap('c3', [msg(0, 'user', '고친 질문'), msg(1, 'assistant', '새 답'), msg(2, 'user', '음')]));
    expect((ingestCalls().at(-1)!.body as { mode: string }).mode).toBe('full');
  });

  it('409 BASE_MISMATCH → resends full immediately', async () => {
    const m = [msg(0, 'user', '질문'), msg(1, 'assistant', '답')];
    await sendSnapshot(deps, snap('c4', m));
    mock.state.convs.delete('chatgpt:c4'); // 서버가 그 사이 내용을 잃음
    const r = await sendSnapshot(deps, snap('c4', [...m, msg(2, 'user', '더')]));
    expect(r.status).toBe('accepted');
    expect(ingestCalls().slice(-2).map((c) => [c.status, (c.body as { mode: string }).mode])).toEqual([[409, 'append'], [202, 'full']]);
  });

  it('streaming partial then final complete with same text is still sent', async () => {
    const m = [msg(0, 'user', '질문'), msg(1, 'assistant', '답 중간')];
    expect((await sendSnapshot(deps, snap('c5', m, { complete: false }))).status).toBe('partial');
    expect((await sendSnapshot(deps, snap('c5', m, { complete: false }))).status).toBe('skipped');
    expect((await sendSnapshot(deps, snap('c5', m, { complete: true }))).status).toBe('accepted');
  });

  it('server recomputes the hash: a tampered hash is 400 → dropped, not retried forever', async () => {
    fetchImpl = async (url, init) => { const b = JSON.parse(String(init!.body)); b.contentHash = 'bad'; return fetch(url, { ...init, body: JSON.stringify(b), headers: { ...(init!.headers as object), 'Idempotency-Key': `chatgpt:c6:bad` } }); };
    expect((await sendSnapshot(deps, snap('c6', [msg(0, 'user', 'x')]))).status).toBe('dropped');
    expect(await buffer.count()).toBe(0);
  });
});

describe('offline buffer + replay', () => {
  it('engine says 501 (ingest API not built yet) → buffered; later replay sends oldest first in batches of ≤20', async () => {
    mock.state.down = true;
    for (let i = 0; i < 25; i++) expect((await sendSnapshot(deps, snap(`off${String(i).padStart(2, '0')}`, [msg(0, 'user', `q${i}`), msg(1, 'assistant', `a${i}`)]))).status).toBe('buffered');
    expect(await buffer.count()).toBe(25);
    expect((await getSite(kv, 'chatgpt')).lastError).toMatch(/501/);
    mock.state.down = false;
    const r = await flushBuffer(deps);
    expect(r).toEqual({ sent: 25, left: 0 });
    const replays = mock.state.requests.filter((x) => x.path === '/ingest/replay').map((x) => (x.body as { snapshots: Array<{ sourceId: string; mode: string }> }).snapshots);
    expect(replays.map((b) => b.length)).toEqual([20, 5]);
    expect(replays[0]![0]!.sourceId).toBe('off00');
    expect(replays.flat().every((s) => s.mode === 'full')).toBe(true);
    // 같은 것을 다시 보내도 안전(duplicate)
    mock.state.down = true; await sendSnapshot(deps, snap('off00', [msg(0, 'user', 'q0'), msg(1, 'assistant', 'a0'), msg(2, 'user', 'more')])); mock.state.down = false;
    expect((await flushBuffer(deps)).sent).toBe(1);
  });

  it('core not running (network error) → buffered, keeps only the newest per conversation', async () => {
    fetchImpl = async () => { throw new TypeError('fetch failed'); };
    await sendSnapshot(deps, snap('n1', [msg(0, 'user', 'a')]));
    await sendSnapshot(deps, snap('n1', [msg(0, 'user', 'a'), msg(1, 'assistant', 'b')]));
    expect(await buffer.count()).toBe(1);
    expect((await buffer.oldest(5))[0]!.body.messages).toHaveLength(2);
    expect((await getSite(kv, 'chatgpt')).lastError).toMatch(/꺼져/);
    fetchImpl = (...a) => fetch(...a);
    expect((await flushBuffer(deps)).sent).toBe(1);
  });

  it('late offline copy of an older state is stale on the server and harmless', async () => {
    const m = [msg(0, 'user', 'q'), msg(1, 'assistant', 'a'), msg(2, 'user', 'q2'), msg(3, 'assistant', 'a2')];
    const old = snap('s1', m.slice(0, 2));
    await sendSnapshot(deps, snap('s1', m));
    const res = await deps.core.replay({ snapshots: [await toBody(old)] });
    expect(res.results[0]).toMatchObject({ ok: true, result: { status: 'stale' } });
  });

  it('401 → marks pairing as needing repair, keeps the snapshot buffered', async () => {
    const p = (await kv.get<Pairing>('pairing'))!; await kv.set('pairing', { ...p, token: 'sbt_wrong' });
    expect((await sendSnapshot(deps, snap('u1', [msg(0, 'user', 'x')]))).status).toBe('unpaired');
    expect((await kv.get<Pairing>('pairing'))!.needsRepair).toBe(true);
    expect(await buffer.count()).toBe(1);
  });
  it('1.9.0: 429 + Retry-After → buffered, and no further ingest requests until it passes', async () => {
    mock.state.failNext = 429;
    expect((await sendSnapshot(deps, snap('r1', [msg(0, 'user', 'a')]))).status).toBe('buffered');
    expect(backoffLeftSec('ingest')).toBeGreaterThan(20);
    const n = mock.state.requests.length;
    expect((await sendSnapshot(deps, snap('r2', [msg(0, 'user', 'b')]))).status).toBe('buffered');
    expect(mock.state.requests.length).toBe(n); // 로컬에서 쉼 — 코어에 다시 두드리지 않음
    resetBackoff();
    expect((await flushBuffer(deps)).sent).toBe(2);
  });

  it('1.9.0: hash is lowercase hex without prefix (same as the engine)', async () => {
    const b = await toBody(snap('h1', [msg(0, 'user', 'a')]));
    expect(b.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
