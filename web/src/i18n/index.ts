// UI language — English by default, Korean optional.
// Source strings in the code are Korean (the original language of the project); `en.json` maps them to English.
// Choose with ?lang=en|ko (saved), localStorage `subbrain.lang`, or VITE_LANG at build time. Switching reloads the page.
import en from './en.json';

export type Lang = 'en' | 'ko';
const EN = en as Record<string, string>;

function detect(): Lang {
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? '').get('lang');
    if (q === 'en' || q === 'ko') { globalThis.localStorage?.setItem('subbrain.lang', q); return q; }
    const s = globalThis.localStorage?.getItem('subbrain.lang');
    if (s === 'en' || s === 'ko') return s;
  } catch { /* no storage (tests, SSR) */ }
  const env = (import.meta as { env?: Record<string, string> }).env?.VITE_LANG;
  return env === 'ko' ? 'ko' : 'en';
}

export const lang: Lang = detect();
if (typeof document !== 'undefined') document.documentElement.lang = lang;

/** Translate a UI string (Korean source → current language). Unknown strings fall back to the source text. */
/** A few server-built labels carry numbers; translate them by pattern. */
const PATTERNS: Array<[RegExp, string]> = [
  [/^완료 \(최근 (\d+)일\)$/, 'Done (last $1 days)'],
  [/^(\d+)일째 멈춤$/, 'Stalled $1 days'],
  [/^(\d+)일 전$/, '$1 days ago'],
];
export function tt(s: string): string {
  if (lang === 'ko' || !s) return s;
  const hit = EN[s];
  if (hit !== undefined) return hit;
  for (const [re, rep] of PATTERNS) if (re.test(s)) return s.replace(re, rep);
  return s;
}
/** Translate a template with {0}, {1}… placeholders, then fill them in. */
export function ttf(s: string, ...args: unknown[]): string {
  return tt(s).replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)] ?? ''));
}
export function setLang(next: Lang): void {
  try { globalThis.localStorage?.setItem('subbrain.lang', next); } catch { /* ignore */ }
  const u = new URL(globalThis.location.href); u.searchParams.delete('lang'); globalThis.location.replace(u.toString());
}
