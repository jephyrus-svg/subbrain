// 계약 1.5.0 §14.3을 흉내 내는 작은 로컬 목 코어(테스트·수동 확인용). 실제 엔진(packages/core)은 아직 501.
// 구현: 페어링(코드 · Origin 검사 · 5번 틀리면 폐기) · Bearer 토큰(sha256만 저장) · snapshot(해시 재계산 · duplicate/stale/partial/accepted ·
//       append + BASE_MISMATCH · 413 · 분당 60회 429) · replay(≤20) · catchup/diff(커서 · stopBefore · rate) · health · sync-state
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CatchupDiffBody, IngestMessage, IngestSnapshotBody, IngestSnapshotResponse } from '@subbrain/shared';
import { contentHash } from '../src/shared/hash.ts';
import { AdapterHealthBodySchema, CatchupDiffBodySchema, CompletePairingBodySchema, IngestReplayBodySchema, IngestSnapshotBodySchema } from '@subbrain/shared/schemas';
// 1.9.0: 본문은 코어와 같은 zod 스키마(.strict)로 검사 — 모르는 필드가 있으면 400

interface Conv { messages: IngestMessage[]; contentHash: string; capturedAt: string; complete: boolean; title: string }
export interface MockState {
  codes: Map<string, { kind: string; expiresAt: number; wrong: number }>;
  tokens: Map<string, { tokenId: string; extensionId: string | null; revoked: boolean }>; // key = sha256(token)
  convs: Map<string, Conv>;           // sourceAi:sourceId
  keys: Set<string>;                  // 처리한 멱등 키
  known: Map<string, string | null>;  // catch-up: sourceAi:sourceId → updatedAt
  health: Map<string, unknown>;
  requests: Array<{ method: string; path: string; status: number; body?: unknown }>;
  rate: number[];
  failNext: number | null;            // 다음 요청을 이 상태 코드로 실패시킴(테스트)
  down: boolean;                      // true면 모든 수집 경로 501(엔진 미구현 흉내)
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const err = (res: ServerResponse, status: number, code: string, message: string, details?: Record<string, unknown>, headers: Record<string, string> = {}) => send(res, status, { error: { code, message, details, requestId: 'req_mock' } }, headers);
function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', ...headers });
  res.end(JSON.stringify(body));
}
async function readBody(req: IncomingMessage, limit = 5 * 1024 * 1024): Promise<{ tooLarge: boolean; json: unknown }> {
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > limit) return { tooLarge: true, json: null }; chunks.push(c as Buffer); }
  const t = Buffer.concat(chunks).toString('utf8');
  try { return { tooLarge: false, json: t ? JSON.parse(t) : null }; } catch { return { tooLarge: false, json: undefined }; }
}

export async function ingestOne(st: MockState, b: IngestSnapshotBody, idem?: string | null): Promise<{ status: number; body: unknown }> {
  const key = `${b.sourceAi}:${b.sourceId}`;
  if (!b || !Array.isArray(b.messages) || !b.sourceId || !b.contentHash) return { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: '본문 모양이 틀려요', requestId: 'req_mock' } } };
  const prev = st.convs.get(key);
  let all: IngestMessage[];
  if (b.mode === 'append') {
    if (!prev || prev.contentHash !== b.baseContentHash) return { status: 409, body: { error: { code: 'CONFLICT', message: '서버에 있는 내용과 이어 붙일 수 없어요. 전체(full)로 다시 보내 주세요.', details: { reason: 'BASE_MISMATCH', expectedContentHash: prev?.contentHash ?? null }, requestId: 'req_mock' } } };
    all = [...prev.messages.slice(0, b.appendFromSeq ?? prev.messages.length), ...b.messages];
  } else all = b.messages;
  const h = await contentHash(all);
  if (h !== b.contentHash) return { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'contentHash가 메시지와 맞지 않아요', details: { field: 'contentHash', expected: h }, requestId: 'req_mock' } } };
  const ik = `${b.sourceAi}:${b.sourceId}:${b.contentHash}`;
  if (idem && idem !== ik) return { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'Idempotency-Key가 본문과 달라요', requestId: 'req_mock' } } };
  const resp = (status: IngestSnapshotResponse['status'], cls: IngestSnapshotResponse['classification'], c: Conv): IngestSnapshotResponse => ({ status, idempotencyKey: ik, conversationId: `conv_${b.sourceAi}_${b.sourceId.slice(0, 8)}`, taskId: null, contentHash: c.contentHash, messageCount: c.messages.length, classification: cls, receivedAt: new Date().toISOString() });
  if (st.keys.has(ik) && prev && prev.contentHash === h && (prev.complete || !b.complete)) return { status: 200, body: resp('duplicate', 'not_needed', prev) };
  if (prev && b.capturedAt < prev.capturedAt && all.length < prev.messages.length) return { status: 200, body: resp('stale', 'not_needed', prev) };
  const c: Conv = { messages: all, contentHash: h, capturedAt: b.capturedAt, complete: b.complete, title: b.title };
  st.convs.set(key, c); st.keys.add(ik); st.known.set(key, b.capturedAt);
  return { status: 202, body: resp(b.complete ? 'accepted' : 'partial', b.complete ? 'debounced' : 'skipped', c) };
}

export function createMockCore(opts: { extensionId?: string | null; requireOrigin?: boolean } = {}) {
  const st: MockState = { codes: new Map(), tokens: new Map(), convs: new Map(), keys: new Set(), known: new Map(), health: new Map(), requests: [], rate: [], failNext: null, down: false };
  const issueCode = (code = String(100000 + Math.floor(Math.random() * 899999))) => { st.codes.set(code, { kind: 'extension', expiresAt: Date.now() + 300_000, wrong: 0 }); return code; };
  const auth = (req: IncomingMessage) => {
    const h = req.headers.authorization ?? ''; const m = /^Bearer (sbt_[\w-]+)$/.exec(h);
    if (!m) return { ok: false as const, reason: 'missing' };
    const t = st.tokens.get(sha(m[1]!)); if (!t) return { ok: false as const, reason: 'unknown' };
    if (t.revoked) return { ok: false as const, reason: 'revoked' };
    if (opts.requireOrigin && t.extensionId && req.headers.origin !== `chrome-extension://${t.extensionId}`) return { ok: false as const, reason: 'origin' };
    return { ok: true as const };
  };

  const server: Server = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x'); const p = u.pathname.replace(/^\/api\/v1/, '');
    const log = (status: number, body?: unknown) => st.requests.push({ method: req.method ?? '', path: p, status, body });
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (req.method === 'GET' && p === '/health') { log(200); return send(res, 200, { status: 'ok', apiVersion: '1.6.0-mock' }); }
    // 웹앱 쪽 코드 발급(같은 origin) — 수동 확인용
    if (req.method === 'POST' && p === '/pairing') { const code = issueCode(); log(201); return send(res, 201, { pairingId: 'pair_mock', code: `${code.slice(0, 3)} ${code.slice(3)}`, expiresAt: new Date(Date.now() + 300_000).toISOString(), kind: 'extension' }); }
    const { tooLarge, json } = await readBody(req);
    if (tooLarge) { log(413); return err(res, 413, 'PAYLOAD_TOO_LARGE', '5 MB를 넘었어요'); }
    if (json === undefined) { log(400); return err(res, 400, 'VALIDATION_ERROR', 'JSON이 아니에요'); }
    if (st.down && /^\/(ingest|sync-state|pairing)/.test(p)) { log(501); return err(res, 501, 'NOT_IMPLEMENTED', '아직 만들지 않은 기능이에요 (Phase 3).', { phase: '3' }); }
    if (st.failNext) { const s = st.failNext; st.failNext = null; log(s); return err(res, s, s === 429 ? 'RATE_LIMITED' : 'INTERNAL', '테스트 실패', undefined, s === 429 ? { 'Retry-After': '30' } : {}); }

    const SCHEMA: Record<string, { safeParse: (x: unknown) => { success: boolean; error?: { issues: unknown[] } } }> = { '/pairing/complete': CompletePairingBodySchema, '/ingest/snapshot': IngestSnapshotBodySchema, '/ingest/replay': IngestReplayBodySchema, '/ingest/catchup/diff': CatchupDiffBodySchema };
    const sch = SCHEMA[p] ?? (/^\/sync-state\/[\w-]+\/health$/.test(p) ? AdapterHealthBodySchema : null);
    if (req.method === 'POST' && sch) { const v = sch.safeParse(json); if (!v.success) { log(400, json); return err(res, 400, 'VALIDATION_ERROR', '본문이 계약과 달라요', { issues: v.error?.issues }); } }
    if (req.method === 'POST' && p === '/pairing/complete') {
      const b = json as { code?: string; client?: { kind?: string; extensionId?: string; name?: string } };
      const code = String(b?.code ?? '').replace(/\D/g, '');
      const entry = st.codes.get(code);
      if (!entry || entry.expiresAt < Date.now()) {
        for (const [k, v] of st.codes) if (++v.wrong >= 5) st.codes.delete(k);
        log(401); return err(res, 401, 'UNAUTHORIZED', '코드가 맞지 않거나 만료됐어요.', { reason: 'bad_code' });
      }
      if (b.client?.kind === 'extension') {
        if (!b.client.extensionId) { log(400); return err(res, 400, 'VALIDATION_ERROR', 'extensionId가 필요해요'); }
        const origin = req.headers.origin;
        if (opts.requireOrigin && origin !== `chrome-extension://${b.client.extensionId}`) { log(403); return err(res, 403, 'FORBIDDEN_ORIGIN', 'Origin이 확장 id와 달라요', { reason: 'origin' }); }
      }
      st.codes.delete(code);
      const token = 'sbt_' + randomBytes(32).toString('base64url');
      const tokenId = 'pat_' + randomBytes(2).toString('hex');
      st.tokens.set(sha(token), { tokenId, extensionId: b.client?.extensionId ?? null, revoked: false });
      log(201);
      return send(res, 201, { token, client: { tokenId, kind: 'extension', name: b.client?.name ?? 'SubBrain Chrome', extensionId: b.client?.extensionId ?? null, scopes: ['ingest'], createdAt: new Date().toISOString(), lastUsedAt: null, rotatedAt: null, revokedAt: null } });
    }
    if (/^\/(ingest|sync-state)/.test(p)) {
      const a = auth(req);
      if (!a.ok) { log(a.reason === 'origin' ? 403 : 401); return a.reason === 'origin' ? err(res, 403, 'FORBIDDEN_ORIGIN', 'Origin이 달라요', { reason: 'origin' }) : err(res, 401, 'UNAUTHORIZED', '토큰이 없거나 틀려요', { reason: a.reason === 'revoked' ? 'revoked' : 'invalid' }); }
      const now = Date.now(); st.rate = st.rate.filter((t) => now - t < 60_000);
      if (st.rate.length >= 60) { log(429); return err(res, 429, 'RATE_LIMITED', '요청이 너무 많아요', undefined, { 'Retry-After': '20' }); }
      st.rate.push(now);
    }
    if (req.method === 'POST' && p === '/ingest/snapshot') {
      const r = await ingestOne(st, json as IngestSnapshotBody, (req.headers['idempotency-key'] as string | undefined) ?? null);
      log(r.status, json); return send(res, r.status, r.body);
    }
    if (req.method === 'POST' && p === '/ingest/replay') {
      const snaps = (json as { snapshots?: IngestSnapshotBody[] })?.snapshots ?? [];
      if (snaps.length > 20) { log(400); return err(res, 400, 'VALIDATION_ERROR', '한 번에 20개까지예요'); }
      const results = [];
      for (let i = 0; i < snaps.length; i++) { const r = await ingestOne(st, snaps[i]!); results.push(r.status < 300 ? { index: i, ok: true, result: r.body } : { index: i, ok: false, error: r.body }); }
      log(200, json); return send(res, 200, { results });
    }
    if (req.method === 'POST' && p === '/ingest/catchup/diff') {
      const b = json as CatchupDiffBody;
      const fetch = []; let skipped = 0;
      for (const it of b.items) {
        const k = `${b.sourceAi}:${it.sourceId}`;
        if (!st.known.has(k)) fetch.push({ sourceId: it.sourceId, reason: 'new' });
        else if (it.updatedAt && (st.known.get(k) ?? '') < it.updatedAt) fetch.push({ sourceId: it.sourceId, reason: 'updated' });
        else skipped++;
      }
      log(200, json);
      return send(res, 200, { fetch, skipped, cursor: `cur_${b.sourceAi}_${Date.now()}`, stopBefore: null, rate: { maxFetchPerMinute: 6, nextScanAfter: new Date(Date.now() + 30 * 60_000).toISOString() } });
    }
    const hm = /^\/sync-state\/([\w-]+)\/health$/.exec(p);
    if (req.method === 'POST' && hm) {
      st.health.set(hm[1]!, json); log(200, json);
      return send(res, 200, { recorded: true, state: { sourceAi: hm[1], cursor: null, lastScanAt: null, lastSnapshotAt: null, knownConversations: st.convs.size, pendingFetch: 0, health: (json as { health: string }).health, healthAt: new Date().toISOString(), adapter: null, errorCode: null, bufferedSnapshots: 0 }, collection: {} });
    }
    if (req.method === 'GET' && p === '/sync-state') { log(200); return send(res, 200, { sources: [] }); }
    log(404); return err(res, 404, 'NOT_FOUND', `목 코어에 없는 경로: ${req.method} ${p}`);
  });

  return {
    state: st, issueCode, server,
    listen: (port = 0) => new Promise<string>((r) => server.listen(port, '127.0.0.1', () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`))),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
