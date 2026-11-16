// 설정·페어링은 chrome.storage.local(동기화 안 함, 계약 §14.3-3)에 둔다.
import type { PairedClient } from '@subbrain/shared';

export type CatchupMode = 'off' | 'visit' | 'background';
export interface Settings {
  coreUrl: string;
  paused: boolean;
  /** off = 따라잡기 안 함 · visit = 사이드바를 볼 때만(L2) · background = 주기적으로 비활성 탭에서도(L3, 개인용 기본) */
  catchupMode: CatchupMode;
  /** 대화 하나를 연 뒤 다음을 열 때까지 최소 간격(초). 서버 rate.maxFetchPerMinute보다 빠를 수 없다 */
  catchupIntervalSec: 60 | 30 | 20;
  /** 한 시간에 여는 최대 대화 수 */
  catchupMaxPerHour: number;
  /** 주기 훑기 간격(시간) */
  scanEveryHours: number;
  /** 사용자가 이 사이트를 N분 안에 썼으면 주기 훑기를 건너뜀(실시간 수집으로 충분) */
  skipIfActiveMin: number;
  /** 2026-10-16: 따라잡기 기본값을 '끄기'로 바꾼 1회 이전을 했는지 */
  catchupOffMigrated?: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  coreUrl: 'http://127.0.0.1:4545',
  paused: false,
  // 2026-10-16: 기본 끔 — 'background'/'visit'는 Chrome에 비활성 탭을 스스로 열고 닫아서(창이 혼자 움직이는 것처럼 보임) 사용자가 직접 켤 때만
  catchupMode: 'off',
  catchupIntervalSec: 30,
  catchupMaxPerHour: 20,
  scanEveryHours: 3,
  skipIfActiveMin: 10,
};
export const SPEED_LABEL: Record<Settings['catchupIntervalSec'], string> = { 60: '아주 천천히 · 1분에 1개', 30: '천천히 · 30초에 1개(권장)', 20: '조금 빠르게 · 20초에 1개' };

export interface Pairing { token: string; client: PairedClient; pairedAt: string; needsRepair?: boolean }

/** 저장소 추상화(테스트에서는 메모리) */
export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}
export const chromeKV = (area: chrome.storage.StorageArea): KV => ({
  async get<T>(key: string) { const r = await area.get(key); return r[key] as T | undefined; },
  async set(key, value) { await area.set({ [key]: value }); },
  async remove(key) { await area.remove(key); },
  async keys(prefix) { const all = await area.get(null); return Object.keys(all).filter((k) => k.startsWith(prefix)); },
});
export function memoryKV(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get<T>(k: string) { return structuredClone(data.get(k)) as T | undefined; },
    async set(k, v) { data.set(k, structuredClone(v)); },
    async remove(k) { data.delete(k); },
    async keys(p) { return [...data.keys()].filter((k) => k.startsWith(p)); },
  };
}

export async function loadSettings(kv: KV): Promise<Settings> {
  const stored = (await kv.get<Partial<Settings>>('settings')) ?? {};
  // 2026-10-16 1회 이전: 예전 기본값(background)으로 저장돼 있던 것도 한 번 '끄기'로. 그 뒤 팝업에서 다시 켜면 그대로 둠
  if (!stored.catchupOffMigrated) { const s = { ...DEFAULT_SETTINGS, ...stored, catchupMode: 'off' as const, catchupOffMigrated: true }; await kv.set('settings', s); return s; }
  return { ...DEFAULT_SETTINGS, ...stored };
}
export async function saveSettings(kv: KV, patch: Partial<Settings>): Promise<Settings> {
  const s = { ...(await loadSettings(kv)), ...patch };
  s.coreUrl = normalizeCoreUrl(s.coreUrl);
  if (![60, 30, 20].includes(s.catchupIntervalSec)) s.catchupIntervalSec = 30;
  s.catchupMaxPerHour = Math.max(1, Math.min(60, Math.round(s.catchupMaxPerHour)));
  s.scanEveryHours = Math.max(1, Math.min(24, s.scanEveryHours));
  await kv.set('settings', s);
  return s;
}
/** 로컬 주소만 허용(manifest host_permissions도 127.0.0.1 · localhost만) */
export function normalizeCoreUrl(u: string): string {
  let url: URL;
  try { url = new URL(u.trim().includes('://') ? u.trim() : `http://${u.trim()}`); } catch { return DEFAULT_SETTINGS.coreUrl; }
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:') return DEFAULT_SETTINGS.coreUrl;
  return `${url.protocol}//${url.host}`;
}
