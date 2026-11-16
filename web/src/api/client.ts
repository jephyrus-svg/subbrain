import { tt, ttf } from '../i18n';
// 데이터 계층: 모의(mock) 모드 ↔ 라이브(live) 모드 전환.
// - mock: packages/shared/mocks/json 을 읽어 코어 없이 화면을 띄운다 (기본값, VITE_DATA_MODE=mock)
// - live: Vite 프록시 /api → http://127.0.0.1:4545 (계약서 base /api/v1)
import type { ApiError, ErrorCode } from '@subbrain/shared';

export type DataMode = 'mock' | 'live';
const LS_KEY = 'subbrain.dataMode';

function initialMode(): DataMode {
  try {
    const url = new URL(window.location.href).searchParams.get('data');
    if (url === 'mock' || url === 'live') { localStorage.setItem(LS_KEY, url); return url; }
    const ls = localStorage.getItem(LS_KEY);
    if (ls === 'mock' || ls === 'live') return ls;
  } catch { /* SSR·테스트 */ }
  return import.meta.env.VITE_DATA_MODE === 'live' ? 'live' : 'mock';
}
let mode: DataMode = initialMode();
export const dataMode = (): DataMode => mode;
export function setDataMode(m: DataMode) {
  mode = m;
  localStorage.setItem(LS_KEY, m);
  const u = new URL(window.location.href); u.searchParams.delete('data');
  window.location.replace(u.toString());
}

export const API_BASE = '/api/v1';
/** 화면에 보여 줄 코어 주소(실데이터 설정은 VITE_CORE_LABEL로 덮어씀) */
export const CORE_LABEL: string = (import.meta.env.VITE_CORE_LABEL as string | undefined) ?? '127.0.0.1:4545';

export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR' | 'BAD_RESPONSE';
export class ApiRequestError extends Error {
  readonly status: number; readonly code: ClientErrorCode; readonly details?: Record<string, unknown>; readonly requestId: string | null;
  /** 라이브 오류 응답 원문 (개발용 스키마 검사) */
  raw?: unknown;
  constructor(status: number, code: ClientErrorCode, message: string, details?: Record<string, unknown>, requestId: string | null = null) {
    super(message); this.name = 'ApiRequestError';
    this.status = status; this.code = code; this.details = details; this.requestId = requestId;
  }
  /** LATER 엔드포인트(501)인지 */
  get notImplemented() { return this.status === 501 || this.code === 'NOT_IMPLEMENTED'; }
  static fromBody(status: number, body: unknown): ApiRequestError {
    const e = (body as Partial<ApiError> | null)?.error;
    if (e && typeof e.code === 'string') return new ApiRequestError(status, e.code, e.message ?? tt("오류"), e.details, e.requestId ?? null);
    return new ApiRequestError(status, 'BAD_RESPONSE', ttf("서버 응답을 읽지 못했어요 ({0})", status));
  }
}

export type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[];
export type Query = Record<string, QueryValue>;

/** 배열은 쉼표로, undefined/null/빈 배열은 뺀다 (계약서 §1.4, 쉼표 구분 필터) */
export function toSearch(q?: Query): string {
  if (!q) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) { if (v.length) sp.set(k, v.join(',')); continue; }
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export interface RequestOpts { query?: Query; body?: unknown; signal?: AbortSignal }

const DEV_CHECK = import.meta.env.DEV && import.meta.env.VITE_SCHEMA_CHECK !== 'off';
const devCheck = (fn: (v: typeof import('./validate')) => Promise<void>) => {
  if (!DEV_CHECK) return;
  void import('./validate').then(fn).catch((e) => console.warn(tt("[schema] 검사 실패"), e));
};

export async function request<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, opts: RequestOpts = {}): Promise<T> {
  if (opts.body !== undefined) devCheck((v) => v.validateBody(method, path, opts.body));
  const out = await requestRaw<T>(method, path, opts).catch((e: unknown) => {
    if (e instanceof ApiRequestError && e.raw !== undefined) devCheck((v) => v.validateError(method, path, e.raw));
    throw e;
  });
  devCheck((v) => v.validateResponse(method, path, out));
  return out;
}

async function requestRaw<T>(method: string, path: string, opts: RequestOpts): Promise<T> {
  if (mode === 'mock') {
    const { mockRequest } = await import('./mock/router');
    return mockRequest<T>(method, path, opts.query ?? {}, opts.body);
  }
  let res: Response;
  try {
    res = await fetch(API_BASE + path + toSearch(opts.query), {
      method,
      headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiRequestError(0, 'NETWORK_ERROR', ttf("코어({0})에 연결하지 못했어요. 엔진이 켜져 있는지 확인해 주세요.", CORE_LABEL));
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) { try { body = JSON.parse(text); } catch { body = null; } }
  if (!res.ok) { const e = ApiRequestError.fromBody(res.status, body); e.raw = body; throw e; }
  if (body === null && res.status !== 204) throw new ApiRequestError(res.status, 'BAD_RESPONSE', ttf("서버 응답을 읽지 못했어요 ({0})", res.status));
  return body as T;
}

export const get = <T,>(path: string, query?: Query, signal?: AbortSignal) => request<T>('GET', path, { query, signal });
export const post = <T,>(path: string, body?: unknown) => request<T>('POST', path, { body });
export const patch = <T,>(path: string, body: unknown) => request<T>('PATCH', path, { body });
export const put = <T,>(path: string, body: unknown) => request<T>('PUT', path, { body });

/** 사용자에게 보여줄 한 줄 오류 문구 */
export function errorText(e: unknown): string {
  if (e instanceof ApiRequestError) {
    if (e.notImplemented) return tt("아직 코어가 지원하지 않는 기능이에요 (다음 단계).");
    return e.message;
  }
  return (e as Error)?.message ?? tt("알 수 없는 오류");
}
