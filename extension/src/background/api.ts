// 로컬 코어 호출은 서비스 워커에서만(설계서 12.4). 확장에서 보낸 fetch에는 Chrome이 Origin: chrome-extension://<id> 를 붙인다.
import type {
  AdapterHealthBody, AdapterHealthResponse, ApiError, CatchupDiffBody, CatchupDiffResponse, CompletePairingBody, CompletePairingResponse,
  IngestReplayBody, IngestReplayResponse, IngestSnapshotBody, IngestSnapshotResponse,
} from '../shared/contract';

export class CoreError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: Record<string, unknown> | undefined = undefined, readonly retryAfterSec: number | null = null) { super(message); this.name = 'CoreError'; }
  /** 코어가 꺼져 있거나(0) 아직 이 경로가 없음(501) 또는 일시 오류 → 버퍼에 두고 나중에 */
  get retryable() { return this.status === 0 || this.status === 501 || this.status === 429 || this.status === 503 || this.status >= 500; }
  get baseMismatch() { return this.status === 409 && this.details?.reason === 'BASE_MISMATCH'; }
  /** 401(없음·틀림·폐기) 또는 403 origin/scope(다른 확장 id에 묶인 토큰) → 다시 페어링 */
  get unauthorized() { return this.status === 401 || (this.status === 403 && (this.details?.reason === 'origin' || this.details?.reason === 'scope' || this.code === 'FORBIDDEN_ORIGIN')); }
}

export interface CoreClientDeps { fetch: typeof fetch; baseUrl: () => Promise<string>; token: () => Promise<string | null> }

/** 429 뒤에는 Retry-After 동안 같은 묶음(ingest · catchup)을 아예 보내지 않는다(계약: ingest 60/분, catchup/diff 6/분).
 *  서비스 워커가 다시 떠도 지켜지도록 모듈 전역 + 선택적으로 저장소에 남김(호출하는 쪽 kv). */
const pausedUntil = new Map<string, number>();
export const rateGroup = (path: string) => (path.startsWith('/ingest/catchup') ? 'catchup' : path.startsWith('/ingest') || path.startsWith('/sync-state') ? 'ingest' : 'other');
export function backoffLeftSec(group: string, now = Date.now()): number { const u = pausedUntil.get(group) ?? 0; return u > now ? Math.ceil((u - now) / 1000) : 0; }
export function resetBackoff() { pausedUntil.clear(); }

export class CoreClient {
  constructor(private readonly d: CoreClientDeps & { now?: () => number }) {}

  private async call<T>(method: string, path: string, body?: unknown, opts: { auth?: boolean; headers?: Record<string, string> } = {}): Promise<{ status: number; data: T }> {
    const now = this.d.now?.() ?? Date.now(); const g = rateGroup(path); const left = backoffLeftSec(g, now);
    if (left > 0) throw new CoreError(429, 'RATE_LIMITED', `요청이 많아 ${left}초 쉬는 중`, { local: true }, left);
    const base = await this.d.baseUrl();
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...opts.headers };
    if (opts.auth !== false) { const t = await this.d.token(); if (!t) throw new CoreError(401, 'UNAUTHORIZED', '아직 페어링하지 않았어요'); headers.Authorization = `Bearer ${t}`; }
    let res: Response;
    try { res = await this.d.fetch(`${base}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch { throw new CoreError(0, 'NETWORK_ERROR', `코어(${base})에 연결하지 못했어요`); }
    const text = await res.text();
    let data: unknown = null; try { data = text ? JSON.parse(text) : null; } catch { /* 본문 없음 */ }
    if (!res.ok) {
      const e = (data as ApiError | null)?.error;
      const ra = res.headers.get('Retry-After');
      if (res.status === 429) pausedUntil.set(g, now + (Number(ra) > 0 ? Number(ra) : 60) * 1000);
      throw new CoreError(res.status, e?.code ?? 'HTTP_' + res.status, e?.message ?? `코어 응답 ${res.status}`, e?.details, ra ? Number(ra) || null : null);
    }
    return { status: res.status, data: data as T };
  }

  completePairing(body: CompletePairingBody) { return this.call<CompletePairingResponse>('POST', '/pairing/complete', body, { auth: false }).then((r) => r.data); }
  snapshot(body: IngestSnapshotBody, idemKey: string) { return this.call<IngestSnapshotResponse>('POST', '/ingest/snapshot', body, { headers: { 'Idempotency-Key': idemKey } }); }
  replay(body: IngestReplayBody) { return this.call<IngestReplayResponse>('POST', '/ingest/replay', body).then((r) => r.data); }
  catchupDiff(body: CatchupDiffBody) { return this.call<CatchupDiffResponse>('POST', '/ingest/catchup/diff', body).then((r) => r.data); }
  health(ai: string, body: AdapterHealthBody) { return this.call<AdapterHealthResponse>('POST', `/sync-state/${encodeURIComponent(ai)}/health`, body).then((r) => r.data); }
  session() { return this.call<{ kind: string; client: unknown; scopes: string[] }>('GET', '/session').then((r) => r.data); }
  /** 페어링 없이도 되는 생존 확인 */
  async ping(): Promise<boolean> { try { await this.call('GET', '/health', undefined, { auth: false }); return true; } catch { return false; } }
}
