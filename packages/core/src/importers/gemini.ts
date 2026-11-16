/**
 * Google Takeout "내 활동(My Activity) > Gemini 앱(Gemini Apps)" 파서 (1.2.0).
 *
 * 형식 근거 — [확인] = 공개 문서·여러 공개 파서가 같은 모양을 보임 / [추정] = 한 곳만 말하거나 직접 확인 못 함:
 *  [확인] Takeout은 대화가 아니라 "활동 기록" 목록. 기록 1개 = 질문 1개(+응답 1개). 기본 형식은 HTML, 내보낼 때 JSON으로 바꿀 수 있음.
 *         경로 Takeout/My Activity/Gemini Apps/MyActivity.(html|json), 옛 이름 Bard. (portable-ai-memory.org, solstone, totalreclaw)
 *  [확인] JSON = 기록 배열. 필드 header("Gemini Apps"), title("Prompted <질문>"), time(ISO 8601 UTC), products, subtitles, titleUrl.
 *         다른 제품 기록(Search 등)이 섞일 수 있어 header로 거른다.
 *  [확인] 응답 위치가 내보내기마다 다름: safeHtmlItem[].html(HTML 조각) / subtitles[].name / details[{name:"Response",value}] /
 *         userInteractions[].userInteraction.response(JSON 문자열) / description. 응답이 비거나 잘리는 일이 흔함.
 *  [확인] HTML = div.outer-cell 카드. 내용 칸(content-cell) = "Prompted&nbsp;질문<br>날짜<br>응답 HTML", 다음 content-cell은 메타.
 *         날짜 예: "1 Apr 2026, 18:39:35 WEST"(en-GB), 미국식 "Oct 1, 2024, 3:45:12 PM KST". 시간대는 약어.
 *  [추정] 대화 주소 titleUrl = https://gemini.google.com/app/<대화 id>(PAM 문서만 언급). 있으면 그 id로 묶고, 없으면 시간 간격으로 묶는다.
 *  [추정] 한국어 계정: 폴더 "내 활동/Gemini 앱", 파일 이름 "내활동.html" 가능, 날짜 "2024. 10. 1. 오후 3:45:12 KST",
 *         질문 앞말이 "Prompted" 대신 한국어일 수 있음 → 앞말이 없어도 날짜 앞 텍스트를 질문으로 쓴다.
 *  [추정] 첨부·캔버스: "Attached N file(s)"/"첨부" 문구, 첨부 링크, "Canvas/캔버스" 기록. 본문은 없으므로 표시만 남긴다.
 *
 * 대화로 다시 묶기: ① 대화 id가 있으면 id별 ② 없으면 시간순으로 GEMINI_SESSION_TUNING(기본 30분 간격 + 주제 연속성).
 * source_id: id가 있으면 그 id, 없으면 첫 기록(시각+질문)의 해시 → 같은 파일을 다시 가져오면 같은 대화로 인식(중복 없음).
 */
import { GEMINI_SESSION_TUNING } from '@subbrain/shared/constants';
import type { GeminiActivityPreview } from '@subbrain/shared';
import { sha256 } from '../util/ids.ts';
import { bigrams, dice } from '../util/similarity.ts';
import { toKstIso } from '../util/time.ts';
import { UnsupportedFileError, type NormalizedConversation, type NormalizedMessage, type ParseResult } from './types.ts';

export interface GeminiEvent {
  ms: number | null;            // 기록 시각(UTC ms). 모르면 null
  prompt: string;
  response: string;
  convId: string | null;
  attachments: number;          // 첨부 언급 수
  canvas: boolean;
  order: number;                // 파일 안 순서(Takeout은 최신이 먼저)
}
export interface GeminiParseOptions { sessionGapMinutes?: number }
interface Stats { events: number; skipped: number; missingResponses: number; attachments: number; timezoneAssumed: number }

// ───────────── 공통 ─────────────
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return NAMED[e.toLowerCase()] ?? m;
  });
}
/** HTML 조각 → 읽을 수 있는 글(줄바꿈·목록·코드 유지) */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<\/(p|div|li|h[1-6]|pre|tr|table|ul|ol|blockquote)>/gi, '\n')
    .replace(/<(p|div|h[1-6]|pre|tr|table|ul|ol|blockquote)(\s[^>]*)?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s).replace(/[\u00a0\u202f]/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}- /g, '\n- ').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}
const PROMPT_PREFIX = /^\s*(?:Prompted|Asked|Prompt|Said|프롬프트(?:\s*입력(?:함)?)?|질문(?:함)?|입력함|요청함)(?:\s*[:：]\s*|\s+|$)/i;
export function stripPromptPrefix(s: string): string { return s.replace(/[\u00a0\u202f]/g, ' ').replace(PROMPT_PREFIX, '').trim(); }
/** 질문 글에서 첨부 안내 줄·첨부 링크 줄을 뗀다(첨부는 [첨부 N개] 표시로 따로 남김) */
function cleanPrompt(s: string): string {
  return s.split('\n').filter((l) => !ATTACH_LINE_RE.test(l.trim()) && !/^https?:\/\/\S+$/.test(l.trim())).join('\n').trim();
}
/** 응답이 HTML 조각처럼 보이면 글로 바꾼다(subtitles·details에 HTML이 오는 내보내기 대비) */
const maybeHtml = (v: string) => (/<\/?[a-z][a-z0-9]*(\s[^>]*)?>/i.test(v) ? htmlToText(v) : decodeEntities(v).trim());
const FEEDBACK_RE = /^\s*(Gave feedback|Rated|Feedback|피드백|평가함)/i;
const CANVAS_RE = /\b(canvas)\b|캔버스/i;
const GENERIC_TITLE_RE = /^\s*(Used Gemini Apps|Used Bard|Gemini 앱 사용(함)?|Bard 사용(함)?)\s*$/i;
const ATTACH_RE = /\b(Attached \d+ files?|Uploaded \d+ files?|Attached a file)\b|첨부(함|한|된)?\s*파일|파일\s*\d+\s*개\s*첨부/i;
const ATTACH_LINE_RE = /^(Attached \d+ files?\.?|Uploaded \d+ files?\.?|Attached a file\.?|첨부(함|한|된)?\s*파일.*|파일\s*\d+\s*개\s*첨부.*)$/i;
const CONV_URL_RE = /https?:\/\/(?:gemini\.google\.com\/(?:u\/\d+\/)?app\/(?:c\/)?|bard\.google\.com\/(?:u\/\d+\/)?chat\/)([A-Za-z0-9_-]{8,})/;
export function convIdFromUrl(url: string | null | undefined): string | null { const m = url ? CONV_URL_RE.exec(url) : null; return m ? m[1]! : null; }
const isGeminiHeader = (h: string) => !h.trim() || /gemini|bard/i.test(h);

// ───────────── JSON ─────────────
type J = Record<string, unknown>;
const s = (v: unknown) => (typeof v === 'string' ? v : '');
export function looksLikeGeminiActivity(data: unknown): boolean {
  const arr = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as J).items) ? (data as J).items as unknown[] : null;
  if (!arr || !arr.length) return false;
  return arr.slice(0, 50).some((r) => r && typeof r === 'object' && 'time' in (r as J) && ('header' in (r as J) || 'products' in (r as J))
    && (/gemini|bard/i.test(s((r as J).header)) || ((r as J).products as unknown[] | undefined)?.some?.((p) => /gemini|bard/i.test(s(p)))));
}
/** userInteractions의 JSON 문자열에서 글자만 모은다 [추정 구조] */
function textFromSerialized(v: unknown): string {
  let d: unknown = v;
  if (typeof v === 'string') { try { d = JSON.parse(v); } catch { return v.trim(); } }
  const out: string[] = [];
  const walk = (x: unknown, key = '') => {
    if (typeof x === 'string') { if (x.trim() && (key === 'text' || key === '' ) && !/^https?:\/\//.test(x) && !/^[a-z]+_[a-z0-9_]+$/i.test(x)) out.push(x.trim()); }
    else if (Array.isArray(x)) x.forEach((y) => walk(y, key === 'text' ? 'text' : ''));
    else if (x && typeof x === 'object') for (const [k, y] of Object.entries(x as J)) walk(y, k);
  };
  walk(d);
  return out.join('\n').trim();
}
export function eventsFromJson(data: unknown, st: Stats): GeminiEvent[] {
  const arr = (Array.isArray(data) ? data : (data as J)?.items) as unknown[];
  const out: GeminiEvent[] = [];
  arr.forEach((raw, order) => {
    if (!raw || typeof raw !== 'object') { st.skipped++; return; }
    const r = raw as J;
    const products = Array.isArray(r.products) ? (r.products as unknown[]).map(s) : [];
    if (!isGeminiHeader(s(r.header)) && !products.some((p) => /gemini|bard/i.test(p))) { st.skipped++; return; }
    const title = s(r.title).trim();
    if (FEEDBACK_RE.test(title)) { st.skipped++; return; }
    const details = Array.isArray(r.details) ? (r.details as J[]) : [];
    const detail = (re: RegExp) => details.filter((d) => re.test(s(d?.name).trim())).map((d) => s(d.value).trim()).filter(Boolean).join('\n');
    const ui = Array.isArray(r.userInteractions) ? (r.userInteractions as J[]).map((x) => (x?.userInteraction ?? x) as J) : [];
    const subs = Array.isArray(r.subtitles) ? (r.subtitles as J[]) : [];
    let prompt = GENERIC_TITLE_RE.test(title) ? '' : stripPromptPrefix(title);
    if (!prompt) prompt = detail(/^(request|prompt|요청|질문)$/i) || ui.map((u) => textFromSerialized(u.request)).filter(Boolean).join('\n');
    const html = Array.isArray(r.safeHtmlItem) ? (r.safeHtmlItem as J[]).map((x) => s(x?.html)).filter(Boolean).join('\n') : '';
    let response = html ? htmlToText(html) : '';
    if (!response) response = maybeHtml(detail(/^(response|응답|답변)$/i));
    if (!response) response = maybeHtml(ui.map((u) => textFromSerialized(u.response)).filter(Boolean).join('\n'));
    const subNoUrl = subs.filter((x) => !s(x?.url)).map((x) => maybeHtml(s(x?.name) || s(x?.value))).filter(Boolean);
    if (!response && subNoUrl.length) response = subNoUrl.join('\n');
    if (!response) response = maybeHtml(s(r.description));
    const urls = [s(r.titleUrl), ...subs.map((x) => s(x?.url))];
    const convId = urls.map(convIdFromUrl).find(Boolean) ?? null;
    const files = [r.attachedFiles, r.imageFile, r.files].flatMap((f) => (Array.isArray(f) ? f : f ? [f] : []));
    const attachments = Math.max(files.length + subs.filter((x) => s(x?.url) && !convIdFromUrl(s(x?.url))).length, ATTACH_RE.test(`${title}\n${prompt}`) ? 1 : 0);
    prompt = cleanPrompt(prompt);
    const canvas = CANVAS_RE.test(title) && !PROMPT_PREFIX.test(title);
    if (canvas && !prompt) prompt = '';
    if (!prompt && !response && !canvas) { st.skipped++; return; }
    const ms = Date.parse(s(r.time).trim());
    out.push({ ms: Number.isFinite(ms) ? ms : null, prompt: canvas ? '' : prompt, response: canvas ? `[캔버스] ${title.replace(/^\s*Created\s+/i, '')}` : response, convId, attachments, canvas, order });
  });
  return out;
}

// ───────────── HTML ─────────────
const TZ: Record<string, number> = {
  UTC: 0, GMT: 0, Z: 0, WET: 0, WEST: 60, BST: 60, IST: 330, CET: 60, CEST: 120, EET: 120, EEST: 180, MSK: 180,
  KST: 540, JST: 540, CST: -360, CDT: -300, EST: -300, EDT: -240, MST: -420, MDT: -360, PST: -480, PDT: -420, AKST: -540, AKDT: -480, HST: -600,
  AEST: 600, AEDT: 660, NZST: 720, NZDT: 780, SGT: 480, HKT: 480, ICT: 420, 'GMT+9': 540, 'UTC+9': 540,
};
function tzOffsetMin(tz: string | undefined): number | null {
  if (!tz) return null;
  const t = tz.trim().toUpperCase();
  if (t in TZ) return TZ[t]!;
  const m = /^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(t);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : null;
}
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  gen: 1, fev: 2, fév: 2, mär: 3, abr: 4, avr: 4, mai: 5, mag: 5, giu: 6, lug: 7, ago: 8, aoû: 8, set: 9, okt: 10, ott: 10, out: 10, dez: 12, dic: 12, déc: 12,
};
const month = (tok: string) => MONTHS[tok.toLowerCase().replace(/\.$/, '')] ?? MONTHS[tok.toLowerCase().slice(0, 3)] ?? null;
const SP = '[\\s\\u00a0\\u202f]';
const TZ_PART = `(?:${SP}+((?:GMT|UTC)[+-]\\d{1,2}(?::?\\d{2})?|[A-Z]{2,5}))?`;
const DATE_RES: Array<{ re: RegExp; build: (m: RegExpExecArray) => { y: number; mo: number | null; d: number; h: number; mi: number; s: number; tz?: string } }> = [
  // 한국어: 2024. 10. 1. 오후 3:45:12 KST  /  2024. 10. 1. 15:45:12
  { re: new RegExp(`(\\d{4})\\.${SP}*(\\d{1,2})\\.${SP}*(\\d{1,2})\\.${SP}*(오전|오후)?${SP}*(\\d{1,2}):(\\d{2}):(\\d{2})${TZ_PART}`),
    build: (m) => { let h = Number(m[5]); if (m[4] === '오후' && h < 12) h += 12; if (m[4] === '오전' && h === 12) h = 0; return { y: +m[1]!, mo: +m[2]!, d: +m[3]!, h, mi: +m[6]!, s: +m[7]!, tz: m[8] }; } },
  // 미국식: Oct 1, 2024, 3:45:12 PM KST
  { re: new RegExp(`\\b(\\p{L}{3,9})\\.?${SP}+(\\d{1,2}),${SP}+(\\d{4}),?${SP}+(\\d{1,2}):(\\d{2}):(\\d{2})${SP}*([AP]M)?${TZ_PART}`, 'u'),
    build: (m) => { let h = Number(m[4]); if (m[7] === 'PM' && h < 12) h += 12; if (m[7] === 'AM' && h === 12) h = 0; return { y: +m[3]!, mo: month(m[1]!), d: +m[2]!, h, mi: +m[5]!, s: +m[6]!, tz: m[8] }; } },
  // 영국·유럽식: 1 Apr 2026, 18:39:35 WEST / 15 Sept 2024, 00:49:15 CEST
  { re: new RegExp(`\\b(\\d{1,2})\\.?${SP}+(\\p{L}{3,9})\\.?${SP}+(\\d{4}),?${SP}+(\\d{1,2}):(\\d{2}):(\\d{2})${TZ_PART}`, 'u'),
    build: (m) => ({ y: +m[3]!, mo: month(m[2]!), d: +m[1]!, h: +m[4]!, mi: +m[5]!, s: +m[6]!, tz: m[7] }) },
  // ISO
  { re: /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?/,
    build: (m) => ({ y: +m[1]!, mo: +m[2]!, d: +m[3]!, h: +m[4]!, mi: +m[5]!, s: +m[6]!, tz: m[7] ? (m[7] === 'Z' ? 'UTC' : `UTC${m[7].slice(0, 3)}:${m[7].slice(-2)}`) : undefined }) },
];
/** 카드 글자에서 첫 날짜를 찾는다. 시간대를 모르면 Asia/Seoul(+09:00)로 보고 assumed=true */
export function findHtmlDate(text: string): { index: number; length: number; ms: number | null; assumed: boolean } | null {
  let best: { index: number; length: number; ms: number | null; assumed: boolean } | null = null;
  for (const { re, build } of DATE_RES) {
    const m = re.exec(text);
    if (!m || (best && m.index >= best.index)) continue;
    const p = build(m);
    const off = tzOffsetMin(p.tz);
    const ms = p.mo ? Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - (off ?? 540) * 60_000 : null;
    best = { index: m.index, length: m[0].length, ms: ms !== null && Number.isFinite(ms) ? ms : null, assumed: off === null };
  }
  return best;
}
export function looksLikeGeminiHtml(text: string): boolean {
  return /class="outer-cell/.test(text) && /gemini|bard/i.test(text.slice(0, 200_000));
}
export function eventsFromHtml(html: string, st: Stats): GeminiEvent[] {
  const marker = '<div class="outer-cell';
  const starts: number[] = [];
  for (let i = html.indexOf(marker); i >= 0; i = html.indexOf(marker, i + 1)) starts.push(i);
  const out: GeminiEvent[] = [];
  starts.forEach((start, order) => {
    const cell = html.slice(start, starts[order + 1] ?? html.length);
    const header = htmlToText(/<p class="mdl-typography--title">([\s\S]*?)<\/p>/.exec(cell)?.[1] ?? '');
    if (!isGeminiHeader(header)) { st.skipped++; return; }
    const ci = cell.search(/<div class="content-cell/);
    if (ci < 0) { st.skipped++; return; }
    const open = cell.indexOf('>', ci) + 1;
    const next = cell.slice(open).search(/<\/div>\s*<div class="content-cell/);
    const content = next >= 0 ? cell.slice(open, open + next) : cell.slice(open);
    const flat = content.replace(/&nbsp;|&#160;|&#8239;/g, ' ');
    const date = findHtmlDate(flat);
    const promptHtml = date ? flat.slice(0, date.index) : flat;
    const respHtml = date ? flat.slice(date.index + date.length).replace(/^\s*<br\s*\/?>/i, '') : '';
    const head = htmlToText(promptHtml);
    if (FEEDBACK_RE.test(head)) { st.skipped++; return; }
    const canvas = CANVAS_RE.test(head) && !PROMPT_PREFIX.test(head);
    const prompt = canvas || GENERIC_TITLE_RE.test(head) ? '' : cleanPrompt(stripPromptPrefix(head));
    const response = htmlToText(respHtml);
    const hrefs = [...cell.matchAll(/href="([^"]+)"/g)].map((m) => decodeEntities(m[1]!));
    const convId = hrefs.map(convIdFromUrl).find(Boolean) ?? null;
    const attachLinks = [...promptHtml.matchAll(/<a\s[^>]*href="([^"]+)"/g)].filter((m) => !convIdFromUrl(decodeEntities(m[1]!))).length + (/<img\s/i.test(promptHtml) ? 1 : 0);
    const attachments = Math.max(attachLinks, ATTACH_RE.test(head) ? 1 : 0);
    if (!prompt && !response && !canvas) { st.skipped++; return; }
    if (date?.assumed) st.timezoneAssumed++;
    out.push({ ms: date?.ms ?? null, prompt, response: canvas ? `[캔버스] ${head.replace(/^\s*Created\s+/i, '')}` : response, convId, attachments, canvas, order });
  });
  return out;
}

// ───────────── 대화로 다시 묶기 ─────────────
const FOLLOW_UP_RE = /^\s*(그럼|그러면|그리고|그거|이거|저거|그건|이건|아니|응|네|좋아|더|다시|또|왜|그래서|계속|이어서|위에|방금|ok|okay|and|also|then|what about|how about|more|again|why|yes|no|thanks|고마워|감사)/i;
const ctxText = (evs: GeminiEvent[]) => evs.slice(-3).map((e) => `${e.prompt} ${e.response.slice(0, 300)}`).join(' ');

/** 시간순 기록(대화 id 없는 것)을 대화로 나눈다 */
export function sessionize(events: GeminiEvent[], gapMinutes: number = GEMINI_SESSION_TUNING.sessionGapMinutes): GeminiEvent[][] {
  const T = GEMINI_SESSION_TUNING;
  const sorted = [...events].sort((a, b) => (a.ms ?? Infinity) - (b.ms ?? Infinity) || b.order - a.order);
  const out: GeminiEvent[][] = [];
  let cur: GeminiEvent[] = [];
  for (const e of sorted) {
    if (!cur.length) { cur.push(e); continue; }
    const last = cur.at(-1)!;
    const gap = e.ms !== null && last.ms !== null ? (e.ms - last.ms) / 60_000 : 0;
    const probe = bigrams(e.prompt || e.response.slice(0, 300));
    // 주제 유사도 = max(최근 질문 각각, 최근 질문+응답 앞부분 묶음). 응답이 길면 묶음 쪽이 희석되므로 질문끼리도 본다
    const sim = Math.max(dice(probe, bigrams(ctxText(cur))), ...cur.slice(-3).filter((x) => x.prompt).map((x) => dice(probe, bigrams(x.prompt))));
    let split: boolean;
    if (gap > gapMinutes) split = !(gap <= T.mergeMaxGapMinutes && sim >= T.mergeMinSimilarity);
    else split = gap > T.splitMinGapMinutes && e.prompt.length >= T.splitMinPromptChars && !FOLLOW_UP_RE.test(e.prompt) && sim < T.splitMaxSimilarity;
    if (split) { out.push(cur); cur = [e]; } else cur.push(e);
  }
  if (cur.length) out.push(cur);
  return out;
}

function clipTitle(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  if (one.length <= 60) return one || 'Gemini 대화';
  const cut = one.slice(0, 60), sp = cut.lastIndexOf(' ');
  return `${(sp > 30 ? cut.slice(0, sp) : cut).trim()}…`;
}
function toConversation(group: GeminiEvent[], convId: string | null): NormalizedConversation {
  const evs = [...group].sort((a, b) => (a.ms ?? Infinity) - (b.ms ?? Infinity) || b.order - a.order);
  const first = evs[0]!;
  const iso = (e: GeminiEvent) => (e.ms !== null ? toKstIso(e.ms) : null);
  // 응답은 Takeout마다 잘리는 정도가 달라 해시에 넣지 않는다(질문이 없을 때만 응답 앞부분)
  const sourceId = convId ?? `gtk_${sha256(`${first.ms ?? ''}\n${first.prompt || first.response.slice(0, 200)}`).slice(0, 24)}`;
  const messages: NormalizedMessage[] = [];
  for (const e of evs) {
    const at = iso(e);
    if (e.prompt || e.attachments) messages.push({ role: 'user', content: `${e.prompt}${e.attachments ? `${e.prompt ? '\n\n' : ''}[첨부 ${e.attachments}개 — Takeout에는 파일 내용이 없어요]` : ''}`, createdAt: at });
    if (e.response) messages.push({ role: 'assistant', content: e.response, createdAt: at });
  }
  const times = evs.map(iso).filter((x): x is string => !!x);
  return {
    sourceAi: 'gemini', sourceId, url: convId ? `https://gemini.google.com/app/${convId}` : null,
    title: clipTitle(evs.find((e) => e.prompt)?.prompt ?? first.response),
    createdAt: times[0] ?? null, updatedAt: times.at(-1) ?? null, messages,
    archived: false, inServiceProject: false, hasUnextractedArtifact: evs.some((e) => e.attachments > 0 || e.canvas),
  };
}

export function parseGemini(input: { html?: string; json?: unknown }, meta: { zipped: boolean; path?: string }, opts: GeminiParseOptions = {}): ParseResult {
  const gap = Math.max(1, Math.round(opts.sessionGapMinutes ?? GEMINI_SESSION_TUNING.sessionGapMinutes));
  const st: Stats = { events: 0, skipped: 0, missingResponses: 0, attachments: 0, timezoneAssumed: 0 };
  const isHtml = input.html !== undefined;
  const events = isHtml ? eventsFromHtml(input.html!, st) : eventsFromJson(input.json, st);
  st.events = events.length;
  if (!events.length) throw new UnsupportedFileError('Gemini 활동 기록이 하나도 없어요 — Google 계정의 "Gemini 앱 활동"이 꺼져 있었으면 빈 파일이 나와요');
  st.missingResponses = events.filter((e) => !e.response && !e.canvas).length;
  st.attachments = events.filter((e) => e.attachments > 0 || e.canvas).length;
  const byId = new Map<string, GeminiEvent[]>();
  const loose: GeminiEvent[] = [];
  for (const e of events) { if (e.convId) byId.set(e.convId, [...(byId.get(e.convId) ?? []), e]); else loose.push(e); }
  const sessions = sessionize(loose, gap);
  const conversations = [...[...byId].map(([id, g]) => toConversation(g, id)), ...sessions.map((g) => toConversation(g, null))]
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  // 같은 첫 기록(드물게 완전히 같은 질문·시각)이면 source_id가 겹치므로 뒤에 번호
  const seen = new Map<string, number>();
  for (const c of conversations) { const n = seen.get(c.sourceId) ?? 0; seen.set(c.sourceId, n + 1); if (n) c.sourceId = `${c.sourceId}_${n}`; }
  const activity: GeminiActivityPreview = {
    events: st.events, skipped: st.skipped, conversations: conversations.length, byConversationId: byId.size, bySession: sessions.length,
    sessionGapMinutes: gap, missingResponses: st.missingResponses, attachments: st.attachments, timezoneAssumed: st.timezoneAssumed,
  };
  const warnings = [
    `Gemini Takeout은 대화가 아니라 활동 기록이에요 — 기록 ${st.events}개를 대화 ${conversations.length}개로 다시 묶었어요` +
      (sessions.length ? ` (대화 주소 없는 기록은 ${gap}분 간격·주제 연속성으로 묶음)` : ''),
    ...(st.missingResponses ? [`응답 본문이 없는 기록 ${st.missingResponses}개 — Takeout이 응답을 빼거나 자르는 일이 흔해요`] : []),
    ...(st.attachments ? [`첨부·캔버스가 있던 기록 ${st.attachments}개 — 파일·캔버스 내용은 Takeout에 없어 표시만 남겨요`] : []),
    ...(st.timezoneAssumed ? [`시간대를 알 수 없는 날짜 ${st.timezoneAssumed}개는 한국 시간(KST)으로 봤어요`] : []),
    ...(st.skipped ? [`Gemini 대화가 아닌 기록 ${st.skipped}개는 건너뛰었어요(피드백·다른 제품·빈 기록)`] : []),
  ];
  return {
    sourceAi: 'gemini', detectedFormat: isHtml ? 'gemini_takeout_html' : 'gemini_takeout_json',
    formatVersion: `takeout-my-activity-${isHtml ? 'html' : 'json'}${meta.zipped ? '-zip' : ''}`,
    conversations, errors: [], warnings, activity,
  };
}

/** ZIP 안 Gemini 활동 파일 후보: 경로에 gemini/bard가 들어간 폴더의 .html/.json, 또는 MyActivity/내활동 파일 */
export function isGeminiZipEntry(name: string): boolean {
  if (!/\.(html?|json)$/i.test(name)) return false;
  const parts = name.split('/');
  // 제품 폴더 이름은 언어가 달라도 브랜드(Gemini/Bard)가 들어간다 [추정: 'Gemini Apps' / 'Gemini 앱']. 다른 제품 폴더의 MyActivity는 받지 않는다
  return /gemini|bard/i.test(parts.slice(0, -1).join('/'));
}
