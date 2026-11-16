/**
 * Phase 4 (계약 1.2.0)
 *  A Gemini Google Takeout(내 활동 > Gemini 앱) 가져오기: HTML·JSON, ZIP·파일, 기록 → 대화 다시 묶기, 재가져오기 중복 없음
 *  B 비슷한 새 프로젝트 제안 합치기(한↔영 별칭·핵심 단어·겹치는 과제)
 *  C 재현성: seed/temperature 규칙, 응답 캐시, 실행 시각에 안 흔들리는 입력
 *  D 웹 요청: 목 일관성, TaskListItem 필드, 간단한 질문 제외, RejectProjectSuggestionBody
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as S from '@subbrain/shared/schemas';
import { PROMPT_VERSION } from '@subbrain/shared/constants';
import type { LlmClassification } from '@subbrain/shared/schemas';
import type { RejectProjectSuggestionBody } from '@subbrain/shared';
import { makeCore } from './helpers.ts';
import { htmlCard, htmlPage, jsonRecord, scenarioJson, SCENARIO, takeoutZip } from './fixtures/gemini-takeout.ts';
import { parseExport } from '../src/importers/detect.ts';
import { findHtmlDate, htmlToText, isGeminiZipEntry, parseGemini, sessionize, type GeminiEvent } from '../src/importers/gemini.ts';
import { UnsupportedFileError, type NormalizedConversation } from '../src/importers/types.ts';
import { createImport, getImport, startImport, upsertConversation } from '../src/services/imports.ts';
import { classifyConversation, runClassification } from '../src/services/classify.ts';
import { acceptProjectSuggestion, consolidateProjectSuggestions, listProjectSuggestions, recordProjectSuggestion } from '../src/services/project-suggestions.ts';
import { similarProjectName } from '../src/util/similarity.ts';
import { samplingOptions, supportsSeed, LLM_SEED } from '../src/classifier/ai-sdk-classifier.ts';
import { cacheKeyFor } from '../src/classifier/cache.ts';
import type { Classifier, ClassifyInput, ClassifyResult } from '../src/classifier/provider.ts';

type T = Awaited<ReturnType<typeof makeCore>>;
let t: T;
beforeEach(async () => { t = await makeCore(); });
afterEach(() => { t.close(); delete process.env.SUBBRAIN_LLM_CACHE; });

const enc = (s: string) => new TextEncoder().encode(s);
async function until<R>(fn: () => R | null | undefined | false, ms = 4000): Promise<R> {
  const t0 = Date.now();
  for (;;) { const r = fn(); if (r) return r; if (Date.now() - t0 > ms) throw new Error('시간 초과'); await new Promise((res) => setTimeout(res, 10)); }
}
async function importBytes(bytes: Uint8Array, fileName: string, extra: { force?: boolean; geminiSessionGapMinutes?: number } = {}) {
  const imp = createImport(t.core, { bytes, fileName, ...extra });
  const ready = await until(() => { const j = getImport(t.core, imp.id)!; return j.state !== 'parsing' ? j : null; });
  return ready;
}
async function importAndStart(bytes: Uint8Array, fileName: string, extra: { force?: boolean; geminiSessionGapMinutes?: number } = {}) {
  const ready = await importBytes(bytes, fileName, extra);
  expect(ready.state, JSON.stringify(ready.errors)).toBe('preview_ready');
  startImport(t.core, ready.id, { classify: false });
  await t.core.queue.idle();
  return { preview: ready.preview!, done: getImport(t.core, ready.id)! };
}

// ═════════ A. Gemini Takeout ═════════
describe('A1 JSON MyActivity — 응답 위치 변형·거르기·대화 주소', () => {
  it('safeHtmlItem / subtitles / details(Request·Response) / userInteractions 모두에서 질문·응답을 읽는다', () => {
    for (const v of ['safeHtml', 'subtitles', 'details', 'userInteractions'] as const) {
      const r = parseGemini({ json: JSON.parse(scenarioJson(v)) }, { zipped: false });
      expect(r.activity!.events, v).toBe(7);
      const first = r.conversations[0]!;
      expect(first.messages[0]).toMatchObject({ role: 'user', content: SCENARIO[0]!.prompt });
      expect(first.messages[1]!.role).toBe('assistant');
      expect(first.messages[1]!.content, v).toContain('꽃집 배송 배송 경로 최적화');
      expect(first.messages[1]!.content, v).not.toMatch(/<\/?(p|b|ul|li)>/);
    }
  });
  it('다른 제품(Search) 기록·피드백·빈 기록은 건너뛰고 skipped로 센다', () => {
    const data = [
      jsonRecord({ prompt: '정상 질문입니다 알려줘', response: '<p>답</p>', time: '2026-10-01T00:00:00Z' }),
      { header: 'Search', title: 'Searched for 꽃집', time: '2026-10-01T00:01:00Z', products: ['Search'] },
      { header: 'Gemini Apps', title: 'Gave feedback: Good response', time: '2026-10-01T00:02:00Z', products: ['Gemini Apps'] },
      { header: 'Gemini Apps', title: 'Used Gemini Apps', time: '2026-10-01T00:03:00Z', products: ['Gemini Apps'] },
    ];
    const r = parseGemini({ json: data }, { zipped: false });
    expect(r.activity).toMatchObject({ events: 1, skipped: 3, conversations: 1 });
  });
  it('titleUrl에 대화 id가 있으면 시간이 멀어도 같은 대화로 묶고 source_id·주소로 쓴다', () => {
    const url = 'https://gemini.google.com/app/c/1a2b3c4d5e6f7a8b';
    const data = [
      jsonRecord({ prompt: '첫 질문: 블로그 개편 계획', response: '<p>a</p>', time: '2026-10-01T00:00:00Z', convUrl: url }),
      jsonRecord({ prompt: '다른 대화 질문', response: '<p>b</p>', time: '2026-10-01T00:10:00Z' }),
      jsonRecord({ prompt: '사흘 뒤 같은 대화에서 이어서', response: '<p>c</p>', time: '2026-10-04T00:00:00Z', convUrl: url }),
    ].reverse();
    const r = parseGemini({ json: data }, { zipped: false });
    expect(r.activity).toMatchObject({ conversations: 2, byConversationId: 1, bySession: 1 });
    const byId = r.conversations.find((c) => c.sourceId === '1a2b3c4d5e6f7a8b')!;
    expect(byId.messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['첫 질문: 블로그 개편 계획', '사흘 뒤 같은 대화에서 이어서']);
    expect(byId.url).toBe('https://gemini.google.com/app/1a2b3c4d5e6f7a8b');
    expect(r.conversations.find((c) => c.sourceId !== '1a2b3c4d5e6f7a8b')!.url).toBeNull();
  });
  it('시각은 KST ISO로 바꾸고, 첨부·캔버스는 표시를 남기고 hasUnextractedArtifact', () => {
    const data = [
      jsonRecord({ prompt: '이 사진 속 영수증 정리해줘', response: '<p>정리했어요</p>', time: '2026-10-01T15:30:00.500Z', extra: { attachedFiles: ['receipt.jpg'] } }),
      { header: 'Gemini Apps', title: 'Created Gemini Canvas titled 꽃집 배송 기획서', time: '2026-10-01T15:31:00Z', products: ['Gemini Apps'] },
    ];
    const r = parseGemini({ json: data }, { zipped: false });
    const c = r.conversations[0]!;
    expect(c.createdAt).toBe('2026-10-02T00:30:00+09:00');
    expect(c.messages[0]!.content).toContain('[첨부 1개');
    expect(c.messages.some((m) => m.content.startsWith('[캔버스]'))).toBe(true);
    expect(c.hasUnextractedArtifact).toBe(true);
    expect(r.activity!.attachments).toBe(2);
  });
});

describe('A2 기록 → 대화 다시 묶기(시간 간격 + 주제 연속성)', () => {
  const r = () => parseGemini({ json: JSON.parse(scenarioJson()) }, { zipped: false });
  it('기본 30분: 같은 주제 40분 뒤는 이어 붙이고, 간격 안이라도 다른 긴 주제는 나눈다 → 기록 7개 = 대화 4개', () => {
    const res = r();
    expect(res.activity).toMatchObject({ events: 7, conversations: 4, bySession: 4, sessionGapMinutes: 30 });
    const titles = res.conversations.map((c) => c.title);
    expect(titles[0]).toContain('꽃집 배송');
    expect(res.conversations[0]!.messages.filter((m) => m.role === 'user')).toHaveLength(4); // "그럼 MVP 범위는?"(짧은 이어 묻기) + 40분 뒤 같은 주제 포함
    expect(titles.some((x) => x.startsWith('전세 계약'))).toBe(true);
    expect(titles.some((x) => x.startsWith('파이썬 정규표현식'))).toBe(true);
  });
  it('최신이 먼저 오는 Takeout 순서를 시간순으로 되돌린다', () => {
    const c = r().conversations[0]!;
    const times = c.messages.map((m) => m.createdAt!);
    expect([...times].sort()).toEqual(times);
  });
  it('간격은 설정 가능: 3시간이면 정규식 질문까지 앞 대화와 다른 주제라 나누지만, 1분이면 잘게 나뉜다', () => {
    const wide = parseGemini({ json: JSON.parse(scenarioJson()) }, { zipped: false }, { sessionGapMinutes: 180 });
    const narrow = parseGemini({ json: JSON.parse(scenarioJson()) }, { zipped: false }, { sessionGapMinutes: 1 });
    expect(wide.activity!.sessionGapMinutes).toBe(180);
    expect(narrow.activity!.conversations).toBeGreaterThan(r().activity!.conversations);
  });
  it('sessionize: 짧은 이어 묻기("더", "그럼")는 주제가 달라 보여도 간격 안이면 나누지 않는다', () => {
    const ev = (min: number, prompt: string): GeminiEvent => ({ ms: Date.UTC(2026, 9, 1, 0, min), prompt, response: '', convId: null, attachments: 0, canvas: false, order: -min });
    const out = sessionize([ev(0, '서브브레인 분류 프롬프트 개선 방향 정리해줘'), ev(10, '더 짧게'), ev(20, '그럼 영어로도 써줘 부탁해요 길게 써줘')]);
    expect(out).toHaveLength(1);
  });
});

describe('A3 HTML MyActivity — 카드·날짜·이스케이프', () => {
  it('미국식·영국식·한국어 날짜와 시간대를 UTC로 바르게 읽는다(모르는 시간대는 KST로 보고 센다)', () => {
    expect(new Date(findHtmlDate('Oct 1, 2026, 3:45:12\u202fPM KST')!.ms!).toISOString()).toBe('2026-10-01T06:45:12.000Z');
    expect(new Date(findHtmlDate('15 Sept 2024, 00:49:15 WEST')!.ms!).toISOString()).toBe('2024-09-14T23:49:15.000Z');
    expect(new Date(findHtmlDate('2026. 10. 1. 오후 3:45:12 KST')!.ms!).toISOString()).toBe('2026-10-01T06:45:12.000Z');
    expect(new Date(findHtmlDate('2026. 10. 1. 오전 12:05:00 GMT+09:00')!.ms!).toISOString()).toBe('2026-09-30T15:05:00.000Z');
    const noTz = findHtmlDate('2026. 10. 1. 15:45:12')!;
    expect(noTz.assumed).toBe(true);
    expect(new Date(noTz.ms!).toISOString()).toBe('2026-10-01T06:45:12.000Z');
  });
  it('HTML 응답 본문의 태그·엔티티를 글로 바꾼다(목록·코드·따옴표)', () => {
    expect(htmlToText('<p>A &amp; B</p><ul><li>하나</li><li>둘</li></ul><pre>x &lt; 3 &amp;&amp; y &gt; 1</pre><p>&quot;끝&quot;&#39;s &#x1F34A;</p>'))
      .toBe('A & B\n- 하나\n- 둘\n\nx < 3 && y > 1\n\n"끝"\'s 🍊');
  });
  it('한국어 계정 HTML(헤더 "Gemini 앱", 한국어 날짜, 앞말 없음) + 첨부·캔버스·피드백 카드', () => {
    const html = htmlPage([
      htmlCard({ header: 'Gemini 앱', head: '전세 계약 특약 문구 &lt;초안&gt; 검토해줘', date: '2026. 10. 2. 오후 9:10:00 KST', responseHtml: '<p>특약 &quot;선순위 없음&quot;을 넣으세요.</p>' }),
      htmlCard({ header: 'Gemini 앱', head: 'Prompted&nbsp;Attached 1 file.<br>이 계약서 사진 읽어줘', date: '2026. 10. 2. 오후 9:02:00 KST', responseHtml: '<p>사진 속 계약서는…</p>', links: ['https://drive.google.com/file/d/abc'] }),
      htmlCard({ header: 'Gemini 앱', head: 'Created Gemini Canvas titled 전세 체크리스트', date: '2026. 10. 2. 오후 9:15:00 KST' }),
      htmlCard({ header: 'Gemini 앱', head: 'Gave feedback: 좋아요', date: '2026. 10. 2. 오후 9:16:00 KST' }),
      htmlCard({ header: 'YouTube', head: 'Watched 꽃꽂이 강좌', date: '2026. 10. 2. 오후 9:17:00 KST' }),
    ]);
    const r = parseExport(enc(html));
    expect(r.detectedFormat).toBe('gemini_takeout_html');
    expect(r.activity).toMatchObject({ events: 3, skipped: 2, conversations: 1, attachments: 2, timezoneAssumed: 0 });
    expect(r.conversations[0]!.messages[0]!.content).toBe('이 계약서 사진 읽어줘\n\n[첨부 1개 — Takeout에는 파일 내용이 없어요]');
    const c = r.conversations[0]!;
    expect(c.createdAt).toBe('2026-10-02T21:02:00+09:00');
    const users = c.messages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(users[0]).toContain('이 계약서 사진 읽어줘');
    expect(users[0]).toContain('[첨부');
    expect(users[1]).toBe('전세 계약 특약 문구 <초안> 검토해줘');
    expect(c.messages.find((m) => m.content.includes('선순위'))!.content).toBe('특약 "선순위 없음"을 넣으세요.');
    expect(c.messages.at(-1)!.content).toBe('[캔버스] Gemini Canvas titled 전세 체크리스트');
    expect(c.messages.some((m) => m.content.includes('Why is this here'))).toBe(false); // 메타 칸은 본문이 아님
  });
  it('HTML 카드의 대화 주소 링크로 묶는다', () => {
    const html = htmlPage([
      htmlCard({ head: 'Prompted&nbsp;second question here', date: 'Oct 3, 2026, 9:00:00 AM PDT', responseHtml: '<p>b</p>', links: ['https://gemini.google.com/app/abcdef0123456789'] }),
      htmlCard({ head: 'Prompted&nbsp;first question here', date: 'Oct 1, 2026, 9:00:00 AM PDT', responseHtml: '<p>a</p>', links: ['https://gemini.google.com/app/abcdef0123456789'] }),
    ]);
    const r = parseExport(enc(html));
    expect(r.activity).toMatchObject({ conversations: 1, byConversationId: 1 });
    expect(r.conversations[0]!.createdAt).toBe('2026-10-02T01:00:00+09:00');
  });
});

describe('A4 Takeout ZIP 경로(영문·한국어 폴더) · 형식 우선순위 · 오류', () => {
  const html = htmlPage(SCENARIO.slice(0, 2).map((e) => htmlCard({ head: `Prompted&nbsp;${e.prompt}`, date: 'Oct 1, 2026, 10:00:00 AM KST', responseHtml: e.response })));
  it('Takeout/My Activity/Gemini Apps/MyActivity.html', () => {
    const r = parseExport(takeoutZip({ 'Takeout/archive_browser.html': '<html>index</html>', 'Takeout/My Activity/Gemini Apps/MyActivity.html': html }));
    expect(r).toMatchObject({ sourceAi: 'gemini', detectedFormat: 'gemini_takeout_html', formatVersion: 'takeout-my-activity-html-zip' });
  });
  it('한국어 폴더 Takeout/내 활동/Gemini 앱/내활동.html, 옛 이름 Bard', () => {
    expect(parseExport(takeoutZip({ 'Takeout/내 활동/Gemini 앱/내활동.html': html })).sourceAi).toBe('gemini');
    expect(parseExport(takeoutZip({ 'Takeout/My Activity/Bard/MyActivity.json': scenarioJson() })).detectedFormat).toBe('gemini_takeout_json');
    expect(isGeminiZipEntry('Takeout/My Activity/YouTube/MyActivity.html')).toBe(false);
  });
  it('HTML·JSON이 둘 다 있으면 JSON을 쓴다', () => {
    expect(parseExport(takeoutZip({ 'Takeout/My Activity/Gemini Apps/MyActivity.html': html, 'Takeout/My Activity/Gemini Apps/MyActivity.json': scenarioJson() })).detectedFormat).toBe('gemini_takeout_json');
  });
  it('빈 활동 기록은 친절한 오류, Gemini 아닌 HTML은 지원 안 함', () => {
    expect(() => parseExport(takeoutZip({ 'Takeout/My Activity/Gemini Apps/MyActivity.json': '[]' }))).toThrow(/Gemini 앱 활동/);
    expect(() => parseExport(enc('<html><body>hello</body></html>'))).toThrow(UnsupportedFileError);
  });
});

describe('A5 가져오기 흐름: 미리보기(기록 → 대화) · 저장 · 다시 가져와도 중복 없음', () => {
  it('미리보기 activity와 대화 수가 맞고 스키마를 통과, 시간으로 묶은 대화는 주소가 없다', async () => {
    const ready = await importBytes(enc(scenarioJson()), 'MyActivity.json');
    expect(ready.state).toBe('preview_ready');
    S.ImportJobSchema.parse(ready);
    expect(ready.sourceAi).toBe('gemini');
    expect(ready.preview).toMatchObject({ detectedFormat: 'gemini_takeout_json', conversationsTotal: 4, conversationsNew: 4, activity: { events: 7, conversations: 4 } });
    startImport(t.core, ready.id, { classify: false });
    await t.core.queue.idle();
    const rows = t.core.db.all<{ source_ai: string; source_url: string | null; source_id: string }>("SELECT source_ai, source_url, source_id FROM conversations WHERE source_ai='gemini'");
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.source_url === null && r.source_id.startsWith('gtk_'))).toBe(true);
    expect(Number(t.core.db.value("SELECT COUNT(*) FROM tasks t JOIN conversations c ON c.task_id=t.id WHERE c.source_ai='gemini'"))).toBe(4);
  });
  it('같은 파일(HTML) 다시 가져오기 → 모두 같음, 새 기록이 붙은 Takeout → 그 대화만 바뀜', async () => {
    const cards = (evs: typeof SCENARIO) => htmlPage([...evs].reverse().map((e) => htmlCard({
      head: `Prompted&nbsp;${e.prompt}`, date: new Date(e.time).toLocaleString('en-US', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }) + ' KST', responseHtml: e.response,
    })));
    const first = await importAndStart(enc(cards(SCENARIO)), 'MyActivity.html');
    expect(first.preview.activity).toMatchObject({ events: 7, conversations: 4, timezoneAssumed: 0 });
    const again = await importBytes(enc(cards(SCENARIO)), 'MyActivity.html', { force: true });
    expect(again.preview).toMatchObject({ conversationsNew: 0, conversationsUpdated: 0, conversationsUnchanged: 4 });
    const more = [...SCENARIO, { time: '2026-10-02T09:10:00.000Z', prompt: '특약 하나만 더 추천해줘', response: '<p>임대인 체납 세금 확인 특약</p>' }];
    const third = await importBytes(enc(cards(more)), 'MyActivity.html', { force: true });
    expect(third.preview).toMatchObject({ conversationsNew: 0, conversationsUpdated: 1, conversationsUnchanged: 3 });
  });
  it('웹 업로드(multipart) + geminiSessionGapMinutes 폼 필드, CLI와 같은 경로', async () => {
    const fd = new FormData();
    fd.append('file', new Blob([scenarioJson()], { type: 'application/json' }), 'MyActivity.json');
    fd.append('geminiSessionGapMinutes', '1');
    const res = await t.req('/imports', { method: 'POST', body: fd });
    expect(res.status).toBe(202);
    const id = ((await res.json()) as { id: string }).id;
    const ready = await until(() => { const j = getImport(t.core, id)!; return j.state === 'preview_ready' ? j : null; });
    expect(ready.preview!.activity!.sessionGapMinutes).toBe(1);
    const bad = new FormData();
    bad.append('file', new Blob([scenarioJson()]), 'MyActivity.json');
    bad.append('geminiSessionGapMinutes', '0');
    expect((await t.req('/imports', { method: 'POST', body: bad })).status).toBe(400);
  });
  it('HTML 파일 하나도 업로드 허용(이전엔 ZIP·JSON만)', async () => {
    const fd = new FormData();
    fd.append('file', new Blob([htmlPage([htmlCard({ head: 'Prompted&nbsp;hello gemini question', date: 'Oct 1, 2026, 10:00:00 AM KST', responseHtml: '<p>hi</p>' })])], { type: 'text/html' }), 'MyActivity.html');
    const res = await t.req('/imports', { method: 'POST', body: fd });
    expect(res.status).toBe(202);
    const id = ((await res.json()) as { id: string }).id;
    const ready = await until(() => { const j = getImport(t.core, id)!; return j.state !== 'parsing' ? j : null; });
    expect(ready.preview!.detectedFormat).toBe('gemini_takeout_html');
  });
});

// ═════════ B. 새 프로젝트 제안 합치기 ═════════
let seq = 0;
function conv(title: string, kind: 'task' | 'quick' = 'task'): NormalizedConversation {
  const at = '2026-09-28T10:00:00+09:00';
  const lines = kind === 'quick' ? ['환율 얼마야?'] : ['첫 질문이에요 어떻게 시작하면 좋을까요', '두 번째 질문 이어서 볼게요', '세 번째 질문도 있어요'];
  return { sourceAi: 'claude', sourceId: `p4-${++seq}`, title, createdAt: at, updatedAt: at, archived: false, inServiceProject: false, hasUnextractedArtifact: false,
    messages: lines.flatMap((u) => [{ role: 'user' as const, content: `${title} ${u}`, createdAt: at }, { role: 'assistant' as const, content: '답변이에요. 자세히 설명할게요.', createdAt: at }]) };
}
const addTask = (title: string, kind: 'task' | 'quick' = 'task') => {
  const r = upsertConversation(t.core, conv(title, kind), { importId: null, rawPath: null });
  if (kind === 'quick') t.core.db.run("UPDATE tasks SET kind='quick_question' WHERE id=?", r.taskId);
  return { taskId: r.taskId!, conversationId: r.conversationId };
};
const suggest = (x: { taskId: string; conversationId: string }, name: string) => recordProjectSuggestion(t.core, { ...x, name, confidence: 0.8, at: '2026-09-29T10:00:00+09:00' });

describe('B 비슷한 새 프로젝트 제안 합치기', () => {
  it('이름 비교: 실데이터 쌍(한↔영 음차·일반어) — 같아야 할 것과 달라야 할 것', () => {
    expect(similarProjectName('꽃집 배송 SaaS', '꽃집 배송 AI 에이전트')).toBe(true);
    expect(similarProjectName('Obsidian Agent 설치', '옵시디언 AI')).toBe(true);
    expect(similarProjectName('꽃집배송', '꽃집 배송 SaaS')).toBe(true);
    expect(similarProjectName('꽃집 배송 SaaS', '택배 배송관리 시스템')).toBe(false);
    expect(similarProjectName('동네 빵집 IP 사업', '우주 탐험 게임 프로젝트')).toBe(false);
    expect(similarProjectName('AI 에이전트', 'SaaS 플랫폼')).toBe(false); // 일반어뿐이면 같다고 보지 않음
  });
  it('새 제안이 비슷한 이름이면 기존 제안에 붙는다(altNames) → 3개면 ready', () => {
    const a = addTask('꽃집 배송 고찰'), b = addTask('AI 에이전트 토론'), c = addTask('꽃집배송');
    const s1 = suggest(a, '꽃집 배송 SaaS'), s2 = suggest(b, '꽃집 배송 AI 에이전트'), s3 = suggest(c, '꽃집배송');
    expect(new Set([s1, s2, s3]).size).toBe(1);
    const [only] = listProjectSuggestions(t.core, {});
    expect(only).toMatchObject({ name: '꽃집 배송 SaaS', taskCount: 3, ready: true });
    expect(only!.altNames).toEqual(expect.arrayContaining(['꽃집 배송 AI 에이전트', '꽃집배송']));
  });
  it('이전 버전이 따로 만든 제안(Obsidian Agent 설치 / 옵시디언 AI)을 consolidate가 하나로 합친다', () => {
    const a = addTask('맥북에 옵시디언 설치하기'), b = addTask('옵시디언 AI용 VPS 추천'), c = addTask('꽃집 배송 관리 프로그램');
    const at = '2026-09-29T10:00:00+09:00';
    for (const [id, name, task] of [['psg_h1', 'Obsidian Agent 설치', a], ['psg_h2', '옵시디언 AI', b], ['psg_l1', '택배 배송관리 시스템', c]] as const) {
      t.core.db.run("INSERT INTO project_suggestions(id,name,norm_name,alt_names_json,state,created_at,updated_at) VALUES (?,?,?,?,'pending',?,?)", id, name, name, '[]', at, at);
      t.core.db.run('INSERT INTO project_suggestion_tasks(suggestion_id,task_id,conversation_id,suggested_name,confidence,created_at) VALUES (?,?,?,?,?,?)', id, task.taskId, task.conversationId, name, 0.8, at);
    }
    expect(consolidateProjectSuggestions(t.core)).toMatchObject({ merged: 1 });
    const list = listProjectSuggestions(t.core, {});
    expect(list).toHaveLength(2);
    const h = list.find((s) => s.altNames.includes('옵시디언 AI') || s.name === '옵시디언 AI')!;
    expect(h.taskCount).toBe(2);
    expect(consolidateProjectSuggestions(t.core).merged).toBe(0); // 다시 돌려도 그대로
  });
  it('이름이 달라도 같은 과제가 붙은 제안(과제 합치기 뒤)이나 합치기 제안으로 이어진 과제를 가진 제안은 합친다', () => {
    const a = addTask('예산표 만들기'), b = addTask('견적 비교'), c = addTask('카드 혜택 정리'), d = addTask('적금 비교');
    const at = '2026-09-29T10:00:00+09:00';
    const mk = (id: string, name: string, tasks: Array<typeof a>) => {
      t.core.db.run("INSERT INTO project_suggestions(id,name,norm_name,alt_names_json,state,created_at,updated_at) VALUES (?,?,?,?,'pending',?,?)", id, name, name, '[]', at, at);
      for (const x of tasks) t.core.db.run('INSERT INTO project_suggestion_tasks(suggestion_id,task_id,conversation_id,suggested_name,confidence,created_at) VALUES (?,?,?,?,?,?)', id, x.taskId, x.conversationId, name, 0.8, at);
    };
    mk('psg_x1', '이사 예산', [a, b]); mk('psg_x2', '새집 꾸미기', [b]); // 같은 과제 b
    mk('psg_y1', '재테크 공부', [c]); mk('psg_y2', '저축 계획', [d]);
    t.core.db.run("INSERT INTO task_merge_suggestions(id,task_a,task_b,suggested_primary,confidence,reason,state,created_at) VALUES ('ms_p4',?,?,?,0.8,'같음','pending',?)", c.taskId, d.taskId, c.taskId, at);
    expect(consolidateProjectSuggestions(t.core).merged).toBe(2);
    const names = listProjectSuggestions(t.core, {}).map((s) => s.name).sort();
    expect(names).toEqual(['이사 예산', '재테크 공부']);
  });
  it('이미 수락한 제안과 비슷한 대기 중 제안은 그 프로젝트로 과제를 붙이고 사라진다', () => {
    const a = addTask('꽃집 배송 고찰'), b = addTask('꽃집 배차 알고리즘');
    suggest(a, '꽃집 배송 SaaS');
    const [s] = listProjectSuggestions(t.core, {});
    const acc = acceptProjectSuggestion(t.core, s!.id, {});
    const at = '2026-09-29T11:00:00+09:00';
    t.core.db.run("INSERT INTO project_suggestions(id,name,norm_name,alt_names_json,state,created_at,updated_at) VALUES ('psg_late','꽃집 배송 AI 에이전트','x','[]','pending',?,?)", at, at);
    t.core.db.run("INSERT INTO project_suggestion_tasks(suggestion_id,task_id,conversation_id,suggested_name,confidence,created_at) VALUES ('psg_late',?,?,'꽃집 배송 AI 에이전트',0.8,?)", b.taskId, b.conversationId, at);
    expect(consolidateProjectSuggestions(t.core)).toMatchObject({ merged: 1, attachedToAccepted: 1 });
    expect(t.core.db.value('SELECT project_id FROM tasks WHERE id=?', b.taskId)).toBe(acc.projectId);
  });
});

// ═════════ C. 재현성 ═════════
class FakeLlm implements Classifier {
  readonly name = 'google'; readonly model = 'fake-flash'; readonly isLlm = true; readonly cacheable = true;
  calls = 0; inputs: ClassifyInput[] = [];
  constructor(private fn: (input: ClassifyInput, n: number) => Partial<LlmClassification> | Error) {}
  async classify(input: ClassifyInput): Promise<ClassifyResult> {
    this.calls++; this.inputs.push(input);
    const r = this.fn(input, this.calls);
    if (r instanceof Error) throw r;
    return { output: S.LlmClassificationSchema.parse({ kind: 'task', resolution: 'unresolved', summary: `${input.title} 작업 (호출 ${this.calls})`, confidence: 0.8, ...r }), model: this.model, inputTokens: 100, outputTokens: 50, costUsd: 0.001 };
  }
}
const run = (ids: string[], opts: { refreshCache?: boolean } = {}) => runClassification(t.core, t.core.queue.create('classify', 'test', { total: ids.length }), ids, opts);

describe('C 재현성: seed·temperature·응답 캐시', () => {
  it('Gemini 3.x는 temperature 없이 seed만, Anthropic은 temperature 0(seed 미지원), OpenAI 추론 모델은 둘 다 안 보냄', () => {
    expect(samplingOptions({ provider: 'google', model: 'gemini-3.5-flash-lite' })).toEqual({ seed: LLM_SEED });
    expect(samplingOptions({ provider: 'google', model: 'gemini-2.0-flash' })).toEqual({ temperature: 0, seed: LLM_SEED });
    expect(samplingOptions({ provider: 'anthropic', model: 'claude-haiku-4-5' })).toEqual({ temperature: 0 });
    expect(samplingOptions({ provider: 'openai', model: 'gpt-6-luna' })).toEqual({});
    expect(supportsSeed({ provider: 'xai' })).toBe(true);
    expect(PROMPT_VERSION).toBe('cls-v4'); // 1.4.0
  });
  it('같은 내용을 다시 분류하면 캐시 답을 쓴다(모델 호출 없음, 비용 0, cached 표시), refreshCache면 새로 부른다', async () => {
    const x = addTask('캐시 시험 대화');
    const fake = new FakeLlm(() => ({}));
    t.core.classifierOverride = fake;
    const r1 = await run([x.conversationId]);
    expect(r1).toMatchObject({ classified: 1, cacheHits: 0 });
    const r2 = await run([x.conversationId]);
    expect(r2).toMatchObject({ classified: 1, cacheHits: 1 });
    expect(fake.calls).toBe(1);
    expect(fake.inputs[0]!.previousSummary).toBeNull(); // 같은 내용이면 자기 요약을 다시 넣지 않음 → 입력이 같음
    const d = await t.json('GET', `/tasks/${x.taskId}`);
    expect(d.body.classification.cached).toBe(true);
    expect(d.body.summary).toContain('호출 1');
    const st = await t.json('GET', '/classification/status');
    expect(S.ClassificationStatusSchema.parse(st.body).today.cacheHits).toBe(1);
    await run([x.conversationId], { refreshCache: true });
    expect(fake.calls).toBe(2);
    expect(t.core.db.value('SELECT COUNT(*) FROM llm_cache')).toBe(1);
  });
  it('입력은 실행한 날짜가 아니라 대화 날짜로 정해진다 → 다른 날 다시 돌려도 같은 캐시 키', async () => {
    const x = addTask('날짜 시험');
    const fake = new FakeLlm(() => ({}));
    await classifyConversation(t.core, x.conversationId, fake);
    const { setNow } = await import('../src/util/time.ts');
    setNow('2026-10-10T09:00:00+09:00');
    t.core.db.run('UPDATE conversations SET classified_hash=NULL WHERE id=?', x.conversationId);
    await classifyConversation(t.core, x.conversationId, fake);
    expect(fake.calls).toBe(1);
    expect(fake.inputs[0]!.today).toBe('2026-09-28');
    expect(cacheKeyFor(fake, fake.inputs[0]!).key).toMatch(/^[0-9a-f]{64}$/);
  });
  it('내용이 바뀌면 캐시를 안 쓰고 이전 요약을 넣는다 · 안전 차단은 캐시하지 않음 · SUBBRAIN_LLM_CACHE=off', async () => {
    const x = addTask('바뀌는 대화');
    const fake = new FakeLlm(() => ({}));
    await classifyConversation(t.core, x.conversationId, fake);
    const c = conv('바뀌는 대화'); c.sourceId = t.core.db.value<string>('SELECT source_id FROM conversations WHERE id=?', x.conversationId)!;
    c.messages.push({ role: 'user', content: '새 메시지가 붙었어요 계속 해볼게요', createdAt: c.updatedAt });
    upsertConversation(t.core, c, { importId: null, rawPath: null });
    await classifyConversation(t.core, x.conversationId, fake);
    expect(fake.calls).toBe(2);
    expect(fake.inputs[1]!.previousSummary).toContain('호출 1');
    const { ProviderBlockedError } = await import('../src/classifier/provider.ts');
    const y = addTask('막히는 대화');
    const blocker = new FakeLlm(() => new ProviderBlockedError('PROHIBITED_CONTENT', 'fake-flash'));
    await classifyConversation(t.core, y.conversationId, blocker);
    await classifyConversation(t.core, y.conversationId, blocker);
    expect(blocker.calls).toBe(2);
    process.env.SUBBRAIN_LLM_CACHE = 'off';
    const z = addTask('캐시 끔');
    const f2 = new FakeLlm(() => ({}));
    await classifyConversation(t.core, z.conversationId, f2);
    await classifyConversation(t.core, z.conversationId, f2);
    expect(f2.calls).toBe(2);
  });
});

// ═════════ D. 웹 요청 ═════════
describe('D 웹 에이전트 요청', () => {
  it('(1)(3) 예시 데이터: 대시보드 배지 = ready 제안 수, handoff 과제 1개·분류 불가 과제 1개, 확인 필요 수는 그대로 3', async () => {
    const s = await makeCore({ seeded: true });
    try {
      const d = await s.json('GET', '/dashboard');
      const sugs = await s.json('GET', '/project-suggestions');
      expect(d.body.badges.pendingProjectSuggestions).toBe(sugs.body.items.filter((x: { ready: boolean }) => x.ready).length);
      expect(sugs.body.items.length).toBeGreaterThanOrEqual(1);
      expect(d.body.counts.needsReview).toBe(3);
      const ho = await s.json('GET', '/tasks?handedOff=true');
      expect(ho.body.items.map((x: { id: string }) => x.id)).toEqual(['task_20260915_01']);
      const bl = await s.json('GET', '/tasks?classificationState=blocked');
      expect(bl.body.items).toHaveLength(1);
      // (2) TaskListItem.blockedReason · blockedModel · confidence
      const item = S.TaskListItemSchema.parse(bl.body.items[0]);
      expect(item).toMatchObject({ id: 'task_20260922_02', classificationState: 'blocked', blockedReason: 'PROHIBITED_CONTENT', blockedModel: 'gemini-3.5-flash-lite', confidence: 0.55, needsReview: true });
      const okItem = S.TaskListItemSchema.parse(ho.body.items[0]);
      expect(okItem).toMatchObject({ blockedReason: null, blockedModel: null });
      expect(typeof okItem.confidence).toBe('number');
      // 수락 응답의 project.taskCount = 붙인 과제 수
      const acc = await s.json('POST', '/project-suggestions/psg_seed01/accept', {});
      expect(acc.status).toBe(200);
      expect(acc.body.project.taskCount).toBe(acc.body.attachedTaskIds.length);
    } finally { s.close(); }
  });
  it('(4) 간단한 질문은 새 프로젝트 제안에 들어가지 않고, 수락 응답 project.taskCount = 붙은 과제 수', async () => {
    const a = addTask('전세 계약 특약 검토'), b = addTask('이사 날짜 정하기'), c = addTask('집 정리 순서');
    const q1 = addTask('환율 확인', 'quick'), q2 = addTask('정규식 질문', 'quick');
    for (const x of [a, q1, b, q2, c]) suggest(x, '집 정리');
    const [s] = listProjectSuggestions(t.core, {});
    expect(s).toMatchObject({ taskCount: 3, ready: true });
    expect(s!.tasks.map((x) => x.id).sort()).toEqual([a.taskId, b.taskId, c.taskId].sort());
    // 이미 붙어 있던 과제가 다시 분류돼 간단한 질문이 되면 제안에서 빠진다
    t.core.classifierOverride = new FakeLlm(() => ({ kind: 'quick_question', resolution: 'resolved' }));
    await classifyConversation(t.core, c.conversationId);
    expect(listProjectSuggestions(t.core, {})[0]).toMatchObject({ taskCount: 2, ready: false });
    const res = await t.json('POST', `/project-suggestions/${s!.id}/accept`, {});
    expect(res.body.attachedTaskIds).toHaveLength(2);
    expect(res.body.project.taskCount).toBe(2);
  });
  it('(5) RejectProjectSuggestionBody 타입 export + 스키마와 같음', async () => {
    const x = addTask('거절할 제안');
    suggest(x, '거절 시험 프로젝트');
    const [s] = listProjectSuggestions(t.core, {});
    const body: RejectProjectSuggestionBody = { reason: '필요 없어요' };
    expect(S.RejectProjectSuggestionBodySchema.parse(body)).toEqual(body);
    const res = await t.json('POST', `/project-suggestions/${s!.id}/reject`, body);
    expect(res.body.suggestion.state).toBe('rejected');
  });
});
