// 어댑터 단위 테스트 — 픽스처는 손으로 만든 근사치(fixtures/*.html 머리말 참고). 실제 사이트에서 저장한 HTML로 바꿔도 같은 기대값이어야 한다.
import { describe, expect, it } from 'vitest';
import { chatgptAdapter } from '../src/adapters/chatgpt';
import { claudeAdapter } from '../src/adapters/claude';
import { validateExtraction } from '../src/adapters/base';
import { toMarkdown } from '../src/adapters/dom-md';
import { adapterForHost } from '../src/adapters/index';
import { page } from './helpers';

const GPT_URL = 'https://chatgpt.com/c/68f2a91c-1d2e-4b7a-9c3f-0a1b2c3d4e5f';
const CL_URL = 'https://claude.ai/chat/c1a0de01-0000-4000-8000-000000000001';

describe('chatgpt adapter', () => {
  const { doc, url } = page('chatgpt-conversation.html', GPT_URL);
  const r = chatgptAdapter.readMessages(doc, url)!;

  it('detects conversation ids from both URL shapes', () => {
    expect(chatgptAdapter.detectConversation(new URL(GPT_URL))).toBe('68f2a91c-1d2e-4b7a-9c3f-0a1b2c3d4e5f');
    expect(chatgptAdapter.detectConversation(new URL('https://chatgpt.com/g/g-p-6812ab34cd-landing/c/5d9e0000-0000-4000-8000-000000000004'))).toBe('5d9e0000-0000-4000-8000-000000000004');
    expect(chatgptAdapter.detectConversation(new URL('https://chatgpt.com/'))).toBeNull();
    expect(adapterForHost('chatgpt.com')).toBe(chatgptAdapter);
  });
  it('reads messages in order with roles and ids', () => {
    expect(r.sourceId).toBe('68f2a91c-1d2e-4b7a-9c3f-0a1b2c3d4e5f');
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(r.messages.map((m) => m.seq)).toEqual([0, 1, 2, 3]);
    expect(r.messages[1]!.externalId).toBe('msg_aa02');
    expect(r.title).toBe('메인 카피 후보 뽑기');
    expect(r.streaming).toBe(false);
    expect(r.fallbacks).toEqual([]);
  });
  it('keeps user text as typed (line breaks)', () => {
    expect(r.messages[0]!.contentMd).toBe('랜딩 페이지 메인 카피 후보 3개만 뽑아 줘.\n톤은 차분하게, 20자 안으로.');
  });
  it('converts assistant DOM to markdown: bold, list, code, table, TeX; strips UI', () => {
    const md = r.messages[1]!.contentMd;
    expect(md).toContain('좋아요. **차분한 톤**으로 세 가지 안입니다:');
    expect(md).toContain('1. 오늘 할 일만, 조용히\n2. 흩어진 대화를 한곳에\n3. 멈춘 일을 다시 *이어서*');
    expect(md).toContain('```python\nfor c in candidates:\n    print(c, len(c))\n```');
    expect(md).toContain('| 안 | 글자 수 |\n| --- | --- |\n| 1 | 11 |');
    expect(md).toContain('점수 식: $s = \\frac{a}{n}$ 입니다.');
    expect(md).not.toMatch(/복사|다시 시도|👍|좋은 응답/);
    expect(r.messages[3]!.contentMd).toBe('좋아요. 12자 안으로 줄인 안: `대화를 한곳에`');
  });
  it('lists sidebar conversations once each', () => {
    const items = chatgptAdapter.listSidebar(doc, url);
    expect(items.map((i) => i.sourceId)).toEqual(['68f2a91c-1d2e-4b7a-9c3f-0a1b2c3d4e5f', '77aa0000-0000-4000-8000-000000000003', '5d9e0000-0000-4000-8000-000000000004']);
    expect(items[1]).toMatchObject({ title: '이사업체 견적 비교표', updatedAt: null, url: 'https://chatgpt.com/c/77aa0000-0000-4000-8000-000000000003' });
    expect(chatgptAdapter.sidebarOpen(doc)).toBe(true);
  });
  it('reads ChatGPT project from /g/g-p-… URL', () => {
    const p = page('chatgpt-conversation.html', 'https://chatgpt.com/g/g-p-6812ab34cd-landing/c/68f2a91c-1d2e-4b7a-9c3f-0a1b2c3d4e5f');
    expect(chatgptAdapter.readMessages(p.doc, p.url)!.project).toEqual({ externalId: 'g-p-6812ab34cd', name: 'landing' });
  });
  it('health ok on a normal page', () => {
    const h = chatgptAdapter.healthCheck(doc, url);
    expect(h.health).toBe('ok'); expect(h.errorCode).toBeNull();
  });
  it('logged-out page → broken LOGGED_OUT', () => {
    const p = page('chatgpt-logged-out.html', 'https://chatgpt.com/');
    expect(chatgptAdapter.healthCheck(p.doc, p.url)).toMatchObject({ health: 'broken', errorCode: 'LOGGED_OUT' });
  });
  it('selector drift → broken SELECTOR_NOT_FOUND, read returns no messages', () => {
    const p = page('chatgpt-drifted.html', GPT_URL);
    expect(chatgptAdapter.healthCheck(p.doc, p.url)).toMatchObject({ health: 'broken', errorCode: 'SELECTOR_NOT_FOUND' });
    const rr = chatgptAdapter.readMessages(p.doc, p.url)!;
    expect(rr.messages).toHaveLength(0);
    expect(validateExtraction(rr, p.url, chatgptAdapter, null)).toBe('메시지 0개');
  });
});

describe('claude adapter', () => {
  const { doc, url } = page('claude-conversation.html', CL_URL);
  const r = claudeAdapter.readMessages(doc, url)!;
  it('reads user/assistant turns in document order', () => {
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(r.messages[0]!.contentMd).toBe('Gemini로 팟캐스트 자막을 만드는 작은 도구를 만들고 싶어.\n입력은 텍스트 파일 하나.');
    expect(r.title).toBe('Gemini 팟캐스트 자막 변환 도구 개발');
    expect(r.streaming).toBe(false);
    expect(r.project).toEqual({ externalId: '0193aaaa-0000-4000-8000-00000000abcd', name: '서브브레인' });
    expect(r.messages[1]!.externalId).toBe('2'); // data-test-render-count (진짜 id 아님 — 순서 표시)
  });
  it('markdown: nested list, code with language, quote; no buttons', () => {
    const md = r.messages[1]!.contentMd;
    expect(md).toContain('- 텍스트 읽기\n- 자막 프리셋 고르기\n  - 차분하게\n  - 밝게');
    expect(md).toContain('```bash\npip install google-genai\n```');
    expect(md).toContain('> API 키는 환경변수로.');
    expect(md).not.toMatch(/복사|다시 시도/);
    expect(r.messages[3]!.contentMd).toBe('추가했어요. 이제 프리셋은 **3개**예요.');
  });
  it('sidebar lists /chat/ links only (not /project/ or /new)', () => {
    expect(claudeAdapter.listSidebar(doc, url).map((i) => i.title)).toEqual(['Gemini 팟캐스트 자막 변환 도구 개발', '독서 모임 공지 초안', '새 대화']);
  });
  it('detects streaming', () => {
    const p = page('claude-streaming.html', CL_URL);
    const s = claudeAdapter.readMessages(p.doc, p.url)!;
    expect(s.streaming).toBe(true);
    expect(s.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });
  it('bot challenge → broken CHALLENGE', () => {
    const p = page('claude-challenge.html', CL_URL);
    expect(claudeAdapter.healthCheck(p.doc, p.url)).toMatchObject({ health: 'broken', errorCode: 'CHALLENGE' });
  });
});

describe('extraction validation', () => {
  const { doc, url } = page('chatgpt-conversation.html', GPT_URL);
  const r = chatgptAdapter.readMessages(doc, url)!;
  it('passes a normal read', () => expect(validateExtraction(r, url, chatgptAdapter, 4)).toBeNull());
  it('rejects a sudden drop in message count', () => expect(validateExtraction(r, url, chatgptAdapter, 12)).toMatch(/급감/));
  it('rejects id/url mismatch', () => expect(validateExtraction({ ...r, sourceId: 'other' }, url, chatgptAdapter, null)).toMatch(/주소/));
  it('rejects empty messages', () => expect(validateExtraction({ ...r, messages: [...r.messages, { seq: 4, externalId: null, role: 'user', contentMd: ' ', createdAt: null }] }, url, chatgptAdapter, null)).toMatch(/빈 메시지/));
});

describe('dom → markdown edge cases', () => {
  it('merged-cell tables stay HTML', () => {
    const { doc } = page('chatgpt-logged-out.html', 'https://chatgpt.com/');
    const d = doc.createElement('div'); d.innerHTML = '<table><tr><td colspan="2">합침</td></tr><tr><td>a</td><td>b</td></tr></table>';
    expect(toMarkdown(d, [])).toMatch(/^<table>/);
  });
  it('code containing ``` gets a longer fence', () => {
    const { doc } = page('chatgpt-logged-out.html', 'https://chatgpt.com/');
    const d = doc.createElement('div'); d.innerHTML = '<pre><code class="language-md">```js\nx\n```</code></pre>';
    expect(toMarkdown(d, [])).toBe('````md\n```js\nx\n```\n````');
  });
});

describe('chatgpt adapter — turn-only DOM fallback (2026-10-16)', () => {
  const { doc, url } = page('chatgpt-turns-only.html', 'https://chatgpt.com/c/68f2a91c-1d2e-4b7a-9c3f-0a1b2c3d4e5f');
  const r = chatgptAdapter.readMessages(doc, url)!;
  it('reads article[data-turn] turns with roles, ids, bodies', () => {
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(r.messages.map((m) => m.externalId)).toEqual(['u1', 'a1']);
    expect(r.messages[0]!.contentMd).toBe('안녕');
    expect(r.messages[1]!.contentMd).toContain('반가워요');
    expect(r.fallbacks).toEqual(['message_selector']);
  });
  it('diagnose reports structure only', () => {
    const d = chatgptAdapter.diagnose!(doc);
    expect(d.map((x) => x.name)).toEqual(['diag_counts', 'diag_data_attrs', 'diag_testids']);
    expect(d.every((x) => x.detail.length <= 480)).toBe(true);
    expect(JSON.stringify(d)).not.toContain('반가워요');
  });
});

describe('chatgpt adapter — new app-shell DOM (2026-10-16b, saved real page skeleton)', () => {
  const U = 'https://chatgpt.com/c/6a000000-0000-8000-a000-000000000011';
  const { doc, url } = page('chatgpt-app-shell.html', U);
  const r = chatgptAdapter.readMessages(doc, url)!;
  it('reads search-unit messages with roles, ids, clean bodies (no headings, buttons, footer)', () => {
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(r.messages.map((m) => m.externalId)).toEqual(['u-0001', 'a-0001', 'u-0002', 'a-0002']);
    expect(r.messages[0]!.contentMd).toBe('첫 질문 줄\n둘째 줄');
    expect(r.messages[1]!.contentMd).toBe('첫 답변 문단\n\n둘째 **굵은 말**입니다');
    expect(r.messages[2]!.contentMd).toBe('테스트');
    expect(r.messages[3]!.contentMd).toBe('잘 받았어요');
    const all = r.messages.map((m) => m.contentMd).join('\n');
    for (const bad of ['내가 한 말', 'ChatGPT 답변', '복사', '편집', '좋아요', '실수를 할 수', '최신 응답']) expect(all).not.toContain(bad);
    expect(r.streaming).toBe(false);
    expect(r.fallbacks).toEqual([]);
    expect(r.title).toBe('테스트 인사 확인');
  });
  it('passes validation, health ok, sidebar lists conversations', () => {
    expect(validateExtraction(r, url, chatgptAdapter, null)).toBeNull();
    expect(chatgptAdapter.healthCheck(doc, url).health).toBe('ok');
    expect(chatgptAdapter.listSidebar(doc, url).map((i) => i.sourceId)).toEqual(['6a000000-0000-8000-a000-000000000011', '6a000000-0000-8000-a000-000000000012']);
  });
  it('detects streaming from turn state', () => {
    doc.querySelector('[data-talvt-turn-state]')!.setAttribute('data-talvt-turn-state', 'streaming');
    expect(chatgptAdapter.readMessages(doc, url)!.streaming).toBe(true);
    doc.querySelector('[data-talvt-turn-state]')!.setAttribute('data-talvt-turn-state', 'complete');
  });
});
