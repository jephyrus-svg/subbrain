import { tt, ttf, lang } from '../i18n';
// 날짜·시간 표시 — 서버가 보낸 ISO의 오프셋(서버의 로컬 시간대) 기준. API는 요일 문자열을 보내지 않으므로 여기서 계산한다 (계약서 §15).
import type { ISODate, ISODateTime, SourceAi, StatusVisual } from '@subbrain/shared';

/** offset of the last server timestamp seen (server local time); before that, the browser's */
let displayOffsetMin = -new Date().getTimezoneOffset();
export const WEEKDAYS = lang === 'ko' ? (['일', '월', '화', '수', '목', '금', '토'] as const) : (['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const);

export interface KstParts { y: number; m: number; d: number; h: number; min: number; wd: number }

/** ISODateTime(+09:00 등) 또는 ISODate('YYYY-MM-DD')를 KST 달력 값으로 */
export function kst(iso: string): KstParts {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return { y, m, d, h: 0, min: 0, wd };
  }
  const m = /([+-])(\d\d):(\d\d)$/.exec(iso);
  if (m) displayOffsetMin = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  const t = new Date(iso).getTime() + displayOffsetMin * 60000;
  const u = new Date(t);
  return { y: u.getUTCFullYear(), m: u.getUTCMonth() + 1, d: u.getUTCDate(), h: u.getUTCHours(), min: u.getUTCMinutes(), wd: u.getUTCDay() };
}

export const weekday = (iso: string) => WEEKDAYS[kst(iso).wd]!;
/** "9월 18일" */
export const monthDay = (iso: string) => { const p = kst(iso); return ttf("{0}월 {1}일", p.m, p.d); };
/** "9.18" (월.일, 일은 두 자리) */
export const dotDate = (iso: string) => { const p = kst(iso); return `${p.m}.${String(p.d).padStart(2, '0')}`; };
/** "9월 18일 (금)" */
export const monthDayWd = (iso: string) => `${monthDay(iso)} (${weekday(iso)})`;
/** "9월 30일 수요일" */
export const monthDayWeekday = (iso: string) => ttf("{0} {1}요일", monthDay(iso), weekday(iso));
/** "오후 11:12" / "오전 1:47" */
export function timeKo(iso: string): string {
  const p = kst(iso);
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  if (lang !== 'ko') return `${h12}:${String(p.min).padStart(2, '0')} ${p.h < 12 ? 'AM' : 'PM'}`;
  const ap = p.h < 12 ? tt("오전") : tt("오후");
  return `${ap} ${h12}:${String(p.min).padStart(2, '0')}`;
}
/** "8월 30일 (일) 오후 11:12" */
export const fullDateTime = (iso: string) => `${monthDayWd(iso)} ${timeKo(iso)}`;

export function toIsoDate(p: { y: number; m: number; d: number }): ISODate {
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}
export function daysBetween(a: ISODate, b: ISODate): number {
  const pa = kst(a), pb = kst(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

/** 상대 시간: "방금", "3분 전", "2시간 전", "어제 오후 6:20", "9월 12일" */
export function relative(iso: ISODateTime | null, now: Date): string {
  if (!iso) return tt("기록 없음");
  const diff = now.getTime() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return tt("방금");
  if (min < 60) return ttf("{0}분 전", min);
  const nowIso = new Date(now.getTime()).toISOString();
  const dd = daysBetween(toIsoDate(kst(iso)), toIsoDate(kst(nowIso)));
  if (dd === 0) return ttf("{0}시간 전", Math.round(min / 60));
  if (dd === 1) return ttf("어제 {0}", timeKo(iso));
  return monthDay(iso);
}

export const AI_LABEL: Record<SourceAi, string> = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', grok: 'Grok', 'claude-code': 'Claude Code', codex: 'Codex', grokbot: 'Grok Bot' };
export const aiLabel = (a: string | null | undefined) => (a && a in AI_LABEL ? AI_LABEL[a as SourceAi] : a ?? tt("알 수 없음"));
/** 알 수 없는 enum 값은 기본 표시로 (계약서 §1) */
export function visualOf(v: string | null | undefined): StatusVisual {
  return v === 'run' || v === 'stall' || v === 'stall2' || v === 'done' || v === 'quick' || v === 'archived' ? v : 'done';
}

// 색 섞기 (디자인 graph3d.mix와 같음)
export function mix(c1: string, c2: string, t: number): string {
  const a = hex(c1), b = hex(c2);
  return '#' + [0, 1, 2].map((k) => Math.round(a[k]! + (b[k]! - a[k]!) * t).toString(16).padStart(2, '0')).join('');
}
function hex(c: string): number[] {
  const s = /^#?([0-9a-f]{6})$/i.exec(c)?.[1] ?? '8C97B3';
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}

/** 아주 작은 마크다운: *기울임* → <em>, **굵게** → <b>. React 노드 배열 대신 조각 배열을 돌려준다 */
export type MdPiece = { t: 'text' | 'em' | 'b'; s: string };
export function mdPieces(src: string): MdPiece[] {
  const out: MdPiece[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ t: 'text', s: src.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: 'b', s: m[1] }); else out.push({ t: 'em', s: m[2] ?? '' });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ t: 'text', s: src.slice(last) });
  return out;
}

/** 1.3.0 §12.6 오늘 분류 비용 — costUsd가 null이면 "알 수 없음"($0 아님). 아는 부분이 있으면 "$x 외 N건 알 수 없음" */
export function costText(t: { costUsd: number | null; costUsdKnown?: number | null; costUnknownCount?: number | null } | null | undefined): string {
  if (!t) return '–';
  const usd = (v: number) => `$${v < 0.01 && v > 0 ? v.toFixed(4) : v.toFixed(2)}`;
  if (typeof t.costUsd === 'number') return usd(t.costUsd);
  const known = typeof t.costUsdKnown === 'number' ? t.costUsdKnown : 0;
  const n = typeof t.costUnknownCount === 'number' ? t.costUnknownCount : 0;
  if (known > 0 && n > 0) return ttf("{0} 외 {1}건 알 수 없음", usd(known), n);
  return tt("비용 알 수 없음");
}
