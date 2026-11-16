/**
 * Local-time helpers. All stored/returned timestamps use ONE fixed UTC offset per process:
 * SUBBRAIN_UTC_OFFSET ("+09:00", "-05:00", "Z") if set, otherwise the system time zone's offset at startup.
 * (Tests pin +09:00. Across a DST change, restart the core.) SUBBRAIN_NOW(ISO) pins the clock for tests/seeds.
 */
import { L } from './lang.ts';
export const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
let offCache: { key: string; min: number; suffix: string } | null = null;
function off(): { min: number; suffix: string } {
  const key = process.env.SUBBRAIN_UTC_OFFSET ?? '';
  if (offCache && offCache.key === key) return offCache;
  let min = -new Date().getTimezoneOffset();
  const m = /^(?:UTC|GMT)?\s*([+-])(\d{1,2}):?(\d{2})?$/i.exec(key.trim());
  if (/^(z|utc|gmt)$/i.test(key.trim())) min = 0;
  else if (m) min = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  const a = Math.abs(min);
  offCache = { key, min, suffix: `${min < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}` };
  return offCache;
}
/** "+09:00" style suffix of the configured local offset */
export function tzSuffix(): string { return off().suffix; }
/** offset in ms */
export function tzOffsetMs(): number { return off().min * 60_000; }
/** "YYYY-MM-DDTHH:MM:SS±hh:mm" for a local wall-clock time */
export function localIso(date: string, hms = '00:00:00'): string { return `${date}T${hms}${tzSuffix()}`; }
let fixedNow: number | null = process.env.SUBBRAIN_NOW ? Date.parse(process.env.SUBBRAIN_NOW) : null;

export function setNow(iso: string | null): void { fixedNow = iso ? Date.parse(iso) : null; }
/** 지금 고정된 시계(ISO) 또는 null — seed·mocks가 잠깐 시계를 바꿨다가 되돌릴 때 쓴다(env가 아니라 이 값을 되돌려야 테스트 시계가 유지됨) */
export function getFixedNow(): string | null { return fixedNow === null ? null : new Date(fixedNow).toISOString(); }
export function nowMs(): number { return fixedNow ?? Date.now(); }


/** epoch ms → "2026-09-18T01:47:00+09:00" */
export function toKstIso(ms: number): string {
  const d = new Date(ms + tzOffsetMs());
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${tzSuffix()}`;
}
export function nowIso(): string { return toKstIso(nowMs()); }
/** 아무 ISO(오프셋 포함) → KST ISO. 잘못된 값이면 null */
export function normalizeIso(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  const ms = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
  return Number.isFinite(ms) ? toKstIso(ms) : null;
}
/** KST 날짜 "YYYY-MM-DD" */
export function kstDate(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
  return toKstIso(ms).slice(0, 10);
}
export function today(): string { return kstDate(nowMs()); }
export function dateToMs(date: string): number { return Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)); }
/** b − a (일) — 둘 다 YYYY-MM-DD */
export function daysBetween(a: string, b: string): number { return Math.round((dateToMs(b) - dateToMs(a)) / 86_400_000); }
export function addDays(date: string, n: number): string { return new Date(dateToMs(date) + n * 86_400_000).toISOString().slice(0, 10); }
/** 월요일 시작 주의 첫날 */
export function weekStart(date: string): string {
  const dow = new Date(dateToMs(date)).getUTCDay(); // 0=일
  return addDays(date, -((dow + 6) % 7));
}
export function weekday(date: string): number { return new Date(dateToMs(date)).getUTCDay(); }
/** KST 날짜의 00:00 ISO */
export function startOfDayIso(date: string): string { return localIso(date); }
/** "9월 18일" */
export function koMonthDay(date: string): string { return L(`${+date.slice(5, 7)}월 ${+date.slice(8, 10)}일`, `${MONTH_EN[+date.slice(5, 7) - 1]} ${+date.slice(8, 10)}`); }
/** "9.18" */
export function dotMonthDay(date: string): string { return `${+date.slice(5, 7)}.${+date.slice(8, 10)}`; }
/** "오전 10:12" / "오후 9:31" */
export function koTimeLabel(iso: string): string {
  const t = toKstIso(Date.parse(iso));
  const h = +t.slice(11, 13), m = t.slice(14, 16);
  return L(`${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${m}`, `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`);
}
/** KST 현재 "HH:MM" */
export function kstHhmm(): string { return nowIso().slice(11, 16); }
