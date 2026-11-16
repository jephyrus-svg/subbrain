// 사이트별 상태(팝업에 보이는 것) · 대화별 마지막 서버 확인 값. 모두 chrome.storage.local.
import type { SiteAi } from '../shared/contract';
import type { HealthReport } from '../adapters/types';
import type { KV } from './settings';

export interface SiteState {
  lastSentAt: string | null;
  lastResult: string | null;       // accepted · duplicate · partial · stale · buffered · 오류 문구
  lastTitle: string | null;
  lastError: string | null;
  sentToday: { date: string; n: number };
  lastVisitAt: string | null;      // 사용자가 이 사이트를 본 마지막 시각(콘텐츠 스크립트 보고)
  health: HealthReport | null;
  healthAt: string | null;
  healthSentAt: string | null;
  healthSentSig: string | null;
  catchup: {
    queue: Array<{ sourceId: string; reason: string; url: string | null; title: string }>;
    cursor: string | null;
    stopBefore: string | null;
    nextScanAfter: string | null;
    maxFetchPerMinute: number;
    lastScanAt: string | null;
    lastOpenAt: string | null;
    opened: string[];              // 최근 1시간 연 시각(시간당 상한)
    fetchedTotal: number;
    lastNote: string | null;       // "로그인이 풀려 멈춤" 등
  };
}
export const emptySite = (): SiteState => ({
  lastSentAt: null, lastResult: null, lastTitle: null, lastError: null, sentToday: { date: '', n: 0 }, lastVisitAt: null,
  health: null, healthAt: null, healthSentAt: null, healthSentSig: null,
  catchup: { queue: [], cursor: null, stopBefore: null, nextScanAfter: null, maxFetchPerMinute: 6, lastScanAt: null, lastOpenAt: null, opened: [], fetchedTotal: 0, lastNote: null },
});
export async function getSite(kv: KV, ai: SiteAi): Promise<SiteState> {
  const s = await kv.get<SiteState>(`site:${ai}`);
  return s ? { ...emptySite(), ...s, catchup: { ...emptySite().catchup, ...s.catchup } } : emptySite();
}
/** 같은 사이트 상태를 여러 곳에서 고치므로 사이트별로 순서대로 처리 */
const locks = new Map<string, Promise<unknown>>();
export async function updateSite(kv: KV, ai: SiteAi, fn: (s: SiteState) => void | Promise<void>): Promise<SiteState> {
  const prev = locks.get(ai) ?? Promise.resolve();
  const next = prev.then(async () => { const s = await getSite(kv, ai); await fn(s); await kv.set(`site:${ai}`, s); return s; });
  locks.set(ai, next.catch(() => {}));
  return next;
}

export interface ConvState { contentHash: string; count: number; capturedAt: string; complete?: boolean }
export const convKey = (ai: string, id: string) => `conv:${ai}:${id}`;
