/**
 * 1.9.0 페어링 토큰(계약 §14.3). 토큰 `sbt_` + 32바이트 base64url — 코어는 sha256만 저장, 응답에서 한 번만 보임.
 * 결정(§15-39): localhost 웹앱(Origin 없음 또는 허용 origin, 토큰 없음)은 지금처럼 인증 없이 "web" 세션.
 * 토큰이 꼭 필요한 곳 = 수집 경로(/ingest/*, POST /sync-state/:ai/health), 토큰 교체, 그리고 MCP Streamable HTTP(MCP 서버가 토큰을 코어로 넘김).
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { CompletePairingBody, ListPairedClientsResponse, PairedClient, PairingClientKind, PairingScope, RotateTokenResponse, StartPairingBody, StartPairingResponse } from '@subbrain/shared';
import type { Core } from '../core.ts';
import { json, str } from '../db/db.ts';
import { ApiError } from '../util/errors.ts';
import { randomId, sha256 } from '../util/ids.ts';
import { nowIso } from '../util/time.ts';

export const PAIRING_TTL_MS = 5 * 60_000;
export const ROTATE_GRACE_S = 300;
export const MAX_CODE_ATTEMPTS = 5;

export interface AuthClient { tokenId: string; kind: PairingClientKind; scopes: PairingScope[]; extensionId: string | null; viaPrevious: boolean }

const newToken = () => 'sbt_' + randomBytes(32).toString('base64url');
const hashToken = (t: string) => sha256('subbrain-token\0' + t);
const hashCode = (c: string) => sha256('subbrain-pairing\0' + c);

function clientView(r: Record<string, unknown>): PairedClient {
  return { tokenId: String(r.id), kind: r.kind as PairingClientKind, name: String(r.name), extensionId: str(r.extension_id as string), scopes: json<PairingScope[]>(r.scopes_json as string, []),
    createdAt: String(r.created_at), lastUsedAt: str(r.last_used_at as string), rotatedAt: str(r.rotated_at as string), revokedAt: str(r.revoked_at as string) };
}

export function startPairing(core: Core, b: StartPairingBody): StartPairingResponse {
  const db = core.db;
  const now = Date.parse(nowIso());
  for (const p of db.all<{ id: string; expires_at: string }>('SELECT id, expires_at FROM pairings WHERE used_at IS NULL AND discarded_at IS NULL'))
    if (Date.parse(p.expires_at) <= now) db.run('UPDATE pairings SET discarded_at=? WHERE id=?', nowIso(), p.id);
  let code = '';
  for (let i = 0; i < 20; i++) {
    code = String(randomBytes(4).readUInt32BE() % 1_000_000).padStart(6, '0');
    if (!db.get('SELECT 1 FROM pairings WHERE code_hash=? AND used_at IS NULL AND discarded_at IS NULL', hashCode(code))) break;
  }
  const scopes: PairingScope[] = b.kind === 'mcp' ? (b.allowWrite ? ['read', 'mcp_write'] : ['read']) : ['ingest'];
  const id = `pair_${randomId(10)}`;
  const expiresAt = new Date(now + PAIRING_TTL_MS).toISOString();
  db.run('INSERT INTO pairings(id,code_hash,kind,name,scopes_json,created_at,expires_at) VALUES (?,?,?,?,?,?,?)', id, hashCode(code), b.kind, b.name ?? null, JSON.stringify(scopes), nowIso(), expiresAt);
  return { pairingId: id, code, expiresAt, kind: b.kind };
}

export function completePairing(core: Core, b: CompletePairingBody, origin: string | undefined): { token: string; client: PairedClient } {
  const db = core.db;
  const now = nowIso();
  const active = db.all<{ id: string; code_hash: string; kind: string; name: string | null; scopes_json: string; attempts: number; expires_at: string }>(
    'SELECT * FROM pairings WHERE used_at IS NULL AND discarded_at IS NULL').filter((p) => Date.parse(p.expires_at) > Date.parse(now));
  const want = Buffer.from(hashCode(b.code));
  const hit = active.find((p) => timingSafeEqual(Buffer.from(p.code_hash), want));
  if (!hit) {
    // 틀린 코드: 열린 페어링 모두 시도 횟수 +1, 5번이면 폐기(누구 것인지 모르므로 전부 — 무차별 대입 막기)
    for (const p of active) db.run('UPDATE pairings SET attempts=attempts+1, discarded_at=CASE WHEN attempts+1>=? THEN ? ELSE NULL END WHERE id=?', MAX_CODE_ATTEMPTS, now, p.id);
    throw new ApiError('UNAUTHORIZED', '코드가 맞지 않거나 만료됐어요. 웹앱에서 새 코드를 받아 주세요.', { reason: 'bad_code' });
  }
  if (hit.kind !== b.client.kind) throw new ApiError('VALIDATION_ERROR', `이 코드는 ${hit.kind}용이에요.`, { expected: hit.kind });
  if (b.client.kind === 'extension') {
    if (!b.client.extensionId) throw new ApiError('VALIDATION_ERROR', '확장 페어링에는 extensionId가 필요해요.', { field: 'client.extensionId' });
    if (origin !== `chrome-extension://${b.client.extensionId}`) throw new ApiError('FORBIDDEN_ORIGIN', '확장 프로그램 Origin이 extensionId와 달라요.', { origin: origin ?? null, expected: `chrome-extension://${b.client.extensionId}` });
  }
  const token = newToken();
  const id = `pat_${randomId(10)}`;
  db.tx(() => {
    db.run('UPDATE pairings SET used_at=? WHERE id=?', now, hit.id);
    db.run('INSERT INTO client_tokens(id,kind,name,version,extension_id,scopes_json,token_hash,created_at) VALUES (?,?,?,?,?,?,?,?)',
      id, b.client.kind, hit.name || b.client.name, b.client.version, b.client.extensionId ?? null, hit.scopes_json, hashToken(token), now);
  });
  return { token, client: clientView(db.get('SELECT * FROM client_tokens WHERE id=?', id)!) };
}

/** Bearer 확인. 없거나 틀리면 401, 폐기면 401 reason revoked */
export function authenticate(core: Core, token: string): AuthClient {
  const db = core.db;
  const h = hashToken(token);
  const now = nowIso();
  let r = db.get<Record<string, unknown>>('SELECT * FROM client_tokens WHERE token_hash=?', h);
  let viaPrevious = false;
  if (!r) {
    r = db.get<Record<string, unknown>>('SELECT * FROM client_tokens WHERE prev_token_hash=?', h);
    if (r && !(Date.parse(String(r.prev_valid_until ?? '')) > Date.parse(now))) throw new ApiError('UNAUTHORIZED', '교체된 옛 토큰이에요. 새 토큰을 쓰세요.', { reason: 'rotated' });
    viaPrevious = !!r;
  }
  if (!r) throw new ApiError('UNAUTHORIZED', '토큰이 맞지 않아요. 다시 페어링해 주세요.', { reason: 'invalid' });
  if (r.revoked_at) throw new ApiError('UNAUTHORIZED', '폐기된 토큰이에요. 다시 페어링해 주세요.', { reason: 'revoked' });
  db.run('UPDATE client_tokens SET last_used_at=? WHERE id=?', now, String(r.id));
  return { tokenId: String(r.id), kind: r.kind as PairingClientKind, scopes: json<PairingScope[]>(r.scopes_json as string, []), extensionId: str(r.extension_id as string), viaPrevious };
}

export function rotateToken(core: Core, tokenId: string, caller: AuthClient): RotateTokenResponse {
  if (caller.tokenId !== tokenId) throw new ApiError('FORBIDDEN_ORIGIN', '자기 토큰만 교체할 수 있어요.', { reason: 'scope' });
  if (caller.viaPrevious) throw new ApiError('UNAUTHORIZED', '옛 토큰으로는 다시 교체할 수 없어요.', { reason: 'rotated' });
  const db = core.db;
  const token = newToken();
  const now = new Date(Date.parse(nowIso()));
  const until = new Date(now.getTime() + ROTATE_GRACE_S * 1000).toISOString();
  db.run('UPDATE client_tokens SET prev_token_hash=token_hash, prev_valid_until=?, token_hash=?, rotated_at=? WHERE id=?', until, hashToken(token), now.toISOString(), tokenId);
  return { token, client: clientView(db.get('SELECT * FROM client_tokens WHERE id=?', tokenId)!), previousValidUntil: until };
}

export function listClients(core: Core): ListPairedClientsResponse {
  return { items: core.db.all<Record<string, unknown>>('SELECT * FROM client_tokens ORDER BY created_at DESC').map(clientView) };
}
export function revokeClient(core: Core, tokenId: string): PairedClient {
  const r = core.db.get('SELECT 1 FROM client_tokens WHERE id=?', tokenId);
  if (!r) throw new ApiError('NOT_FOUND', '페어링한 기기를 찾을 수 없어요.', { tokenId });
  core.db.run('UPDATE client_tokens SET revoked_at=COALESCE(revoked_at, ?) WHERE id=?', nowIso(), tokenId);
  return clientView(core.db.get('SELECT * FROM client_tokens WHERE id=?', tokenId)!);
}
export function clientById(core: Core, tokenId: string): PairedClient | null {
  const r = core.db.get<Record<string, unknown>>('SELECT * FROM client_tokens WHERE id=?', tokenId);
  return r ? clientView(r) : null;
}

/** 범위 판정: 경로·메서드가 이 토큰으로 허용되는가 */
export function scopeAllows(scopes: PairingScope[], method: string, path: string): boolean {
  if (path === '/session' || /^\/pairing\/clients\/[^/]+\/rotate$/.test(path)) return true;
  if (scopes.includes('ingest') && (path.startsWith('/ingest/') || /^\/sync-state(\/[^/]+\/health)?$/.test(path))) return true;
  if (scopes.includes('read') && (method === 'GET' || method === 'HEAD')) return !path.startsWith('/pairing');
  if (scopes.includes('mcp_write') && method === 'POST' && path.startsWith('/mcp/')) return true;
  return false;
}
/** 토큰이 꼭 있어야 하는 경로 */
export const requiresToken = (method: string, path: string) =>
  path.startsWith('/ingest/') || (method === 'POST' && /^\/sync-state\/[^/]+\/health$/.test(path)) || /^\/pairing\/clients\/[^/]+\/rotate$/.test(path);
/** 확장 Origin(chrome-extension://)이 토큰 없이 부를 수 있는 경로 */
export const extensionPublic = (path: string) => path === '/pairing/complete' || path === '/health';

/** 토큰당 분당 60회(수집 경로) */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private perMinute = 60) {}
  check(key: string): number | null {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (arr.length >= this.perMinute) { this.hits.set(key, arr); return Math.ceil((60_000 - (now - arr[0]!)) / 1000); }
    arr.push(now); this.hits.set(key, arr); return null;
  }
}
