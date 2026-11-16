/** Server-side language for generated text (morning summary, next-step reasons, TOC, CLI messages).
 *  SUBBRAIN_LANG=ko → Korean, anything else → English (default). Tests pin ko in test/setup-env.ts. */
export type Lang = 'en' | 'ko';
export function serverLang(): Lang { return (process.env.SUBBRAIN_LANG ?? 'en').toLowerCase().startsWith('ko') ? 'ko' : 'en'; }
/** Pick the Korean or English variant of a generated sentence. */
export const L = (ko: string, en: string): string => (serverLang() === 'ko' ? ko : en);
export const isEn = (): boolean => serverLang() === 'en';
const STATUS_EN: Record<string, string> = { '진행 중': 'In progress', '멈춤': 'Stalled', '완료': 'Done', '보관': 'Archived', '간단한 질문': 'Quick question' };
/** Display label for a stored task status ('진행 중' etc. stay the internal values). */
export const statusLabel = (s: string): string => (serverLang() === 'ko' ? s : STATUS_EN[s] ?? s);
