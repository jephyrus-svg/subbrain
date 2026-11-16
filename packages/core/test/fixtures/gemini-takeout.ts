/**
 * 합성 Google Takeout "내 활동 > Gemini 앱" 픽스처 (1.2.0). 실제 개인 데이터 없음.
 * 모양 근거는 src/importers/gemini.ts 머리말([확인]/[추정]) 참고.
 */
import { strToU8, zipSync } from 'fflate';

export interface Ev { prompt: string; response?: string; time: string; convUrl?: string; header?: string; title?: string; extra?: Record<string, unknown> }

/** JSON 기록 하나 — 기본형: title "Prompted …", 응답은 safeHtmlItem(HTML) */
export function jsonRecord(e: Ev, variant: 'safeHtml' | 'subtitles' | 'details' | 'userInteractions' = 'safeHtml'): Record<string, unknown> {
  const base: Record<string, unknown> = {
    header: e.header ?? 'Gemini Apps', title: e.title ?? `Prompted ${e.prompt}`, time: e.time, products: ['Gemini Apps'],
    activityControls: ['Gemini Apps Activity'], ...(e.convUrl ? { titleUrl: e.convUrl } : {}),
  };
  const r = e.response;
  if (r !== undefined) {
    if (variant === 'safeHtml') base.safeHtmlItem = [{ html: r }];
    if (variant === 'subtitles') base.subtitles = [{ name: r }];
    if (variant === 'details') { base.title = 'Used Gemini Apps'; base.details = [{ name: 'Request', value: e.prompt }, { name: 'Response', value: r }]; }
    if (variant === 'userInteractions') {
      base.title = 'Used Gemini Apps';
      base.userInteractions = [{ userInteraction: { endpoint: 2, request: JSON.stringify([{ text: e.prompt }]), response: JSON.stringify([{ text: r }]) } }];
    }
  }
  return { ...base, ...(e.extra ?? {}) };
}

/** Takeout HTML 카드 하나(실제 My Activity 카드 마크업 구조를 따름) */
export function htmlCard(o: { header?: string; head: string; date: string; responseHtml?: string; links?: string[] }): string {
  const links = (o.links ?? []).map((u) => `<a href="${u}">${u}</a><br>`).join('');
  return `<div class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp"><div class="mdl-grid">`
    + `<div class="header-cell mdl-cell mdl-cell--12-col"><p class="mdl-typography--title">${o.header ?? 'Gemini Apps'}<br></p></div>`
    + `<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">${o.head}<br>${links}${o.date}<br>${o.responseHtml ?? ''}</div>`
    + `<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1 mdl-typography--text-right"></div>`
    + `<div class="content-cell mdl-cell mdl-cell--12-col mdl-typography--caption"><b>Products:</b><br>&emsp;Gemini Apps<br><b>Why is this here?</b><br>&emsp;This activity was saved to your Google Account because the following settings were on:&nbsp;Gemini Apps Activity.</div>`
    + `</div></div>`;
}
export function htmlPage(cards: string[]): string {
  return `<html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><title>My Activity</title><style>.mdl-grid{}</style></head><body><div class="mdl-grid">${cards.join('')}</div></body></html>`;
}

export const takeoutZip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

/**
 * 기본 시나리오(시간은 UTC): 대화 주소 없음.
 *  S1 꽃집 배송(3개, 5~12분 간격) · S2 40분 뒤 같은 주제 이어감(→ S1에 붙음) · S3 2시간 뒤 정규식(새 대화)
 *  S4 6분 뒤 전혀 다른 긴 질문(전세 계약 → 새 대화) · S5 다음 날 짧은 "더 짧게"는 S4와 다른 날이라 새 대화
 *  Takeout처럼 최신이 먼저 오게 뒤집어 둔다.
 */
export const SCENARIO: Ev[] = [
  { time: '2026-10-01T01:00:00.123Z', prompt: '동네 꽃집 배송 배송 경로를 최적화하는 SaaS 아이디어 정리해줘', response: '<p>꽃집 배송 배송 경로 최적화 SaaS는 <b>농가-집하장-택배</b> 구간을 묶어…</p><ul><li>수요 예측</li><li>배차</li></ul>' },
  { time: '2026-10-01T01:05:10.000Z', prompt: '꽃집 배송 배송 경로 최적화에서 배차 알고리즘은 뭘 쓰면 좋아?', response: '<p>배차는 VRP(차량 경로 문제)로 풀어요. OR-Tools를 &quot;먼저&quot; 써 보세요.</p>' },
  { time: '2026-10-01T01:17:00.000Z', prompt: '그럼 MVP 범위는?', response: '<p>MVP: 집하장 3곳, 차량 5대 &amp; 하루 배차표.</p>' },
  { time: '2026-10-01T01:57:30.000Z', prompt: '꽃집 배송 배송 경로 최적화 MVP에 배차표 화면도 넣어줘', response: '<p>꽃집 배송 배송 배차표 화면 구성안이에요.</p>' },
  { time: '2026-10-01T04:00:00.000Z', prompt: '파이썬 정규표현식으로 이메일 주소 검증하는 법 알려줘', response: '<pre>re.fullmatch(r&quot;[^@]+@[^@]+\\.[a-z]+&quot;, s)</pre>' },
  { time: '2026-10-01T04:06:30.000Z', prompt: '전세 계약할 때 특약 문구 어떤 걸 넣어야 안전해?', response: '<p>전세 특약: 선순위 채권 없음 확인, 보증보험 가입 협조…</p>' },
  { time: '2026-10-02T09:00:00.000Z', prompt: '더 짧게 요약해줘', response: '<p>요약: 특약 3개만 넣으세요.</p>' },
];
export const scenarioJson = (variant: Parameters<typeof jsonRecord>[1] = 'safeHtml') => JSON.stringify([...SCENARIO].reverse().map((e) => jsonRecord(e, variant)));
