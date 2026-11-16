// 콘텐츠 스크립트 동작: MutationObserver → 디바운스 → 스냅샷, 스트리밍 조각, 주소 바뀜, 추출 이상, 사이드바
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatgptAdapter } from '../src/adapters/chatgpt';
import { claudeAdapter } from '../src/adapters/claude';
import { ContentRuntime } from '../src/content/runtime';
import type { ToWorker } from '../src/shared/messages';
import { page } from './helpers';

const GPT_URL = 'https://chatgpt.com/c/68f2a91c-1d2e-4b7a-9c3f-0a1b2c3d4e5f';
const CL_URL = 'https://claude.ai/chat/c1a0de01-0000-4000-8000-000000000001';
const OPTS = { debounceMs: 50, partialEveryMs: 400, sidebarDebounceMs: 30, sidebarMinGapMs: 1000, urlPollMs: 20 };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let rt: ContentRuntime | null = null;
afterEach(() => { rt?.stop(); rt = null; });

function boot(fx: string, url: string, adapter = chatgptAdapter) {
  const p = page(fx, url); const sent: ToWorker[] = [];
  rt = new ContentRuntime(adapter, p.win as unknown as Window, (m) => sent.push(m), OPTS);
  rt.start();
  const of = <T extends ToWorker['type']>(t: T) => sent.filter((m): m is Extract<ToWorker, { type: T }> => m.type === t);
  return { ...p, sent, of };
}

describe('ContentRuntime', () => {
  it('sends hello + health at start, then one debounced snapshot', async () => {
    const b = boot('chatgpt-conversation.html', GPT_URL);
    expect(b.of('hello')).toHaveLength(1);
    expect(b.of('health')[0]!.report.health).toBe('ok');
    expect(b.of('snapshot')).toHaveLength(0);
    await wait(120);
    const s = b.of('snapshot');
    expect(s).toHaveLength(1);
    expect(s[0]!.snapshot).toMatchObject({ sourceAi: 'chatgpt', sourceId: '68f2a91c-1d2e-4b7a-9c3f-0a1b2c3d4e5f', complete: true, catchup: false, url: GPT_URL });
    expect(s[0]!.snapshot.messages).toHaveLength(4);
  });

  it('a new message (DOM mutation) → exactly one new snapshot after quiet period', async () => {
    const b = boot('chatgpt-conversation.html', GPT_URL);
    await wait(120);
    const host = b.doc.querySelector('[role="presentation"]')!;
    for (let i = 0; i < 3; i++) { // 연속 변화는 하나로 묶인다
      const a = b.doc.createElement('article');
      a.innerHTML = i === 0 ? '<div data-message-author-role="user" data-message-id="u5"><div data-testid="user-message-text">고마워</div></div>' : '';
      host.appendChild(a); await wait(15);
    }
    await wait(150);
    const s = b.of('snapshot');
    expect(s).toHaveLength(2);
    expect(s[1]!.snapshot.messages.at(-1)).toMatchObject({ role: 'user', contentMd: '고마워', externalId: 'u5', seq: 4 });
  });

  it('streaming: partial (complete:false) at most every partialEveryMs, then complete when it ends', async () => {
    const b = boot('claude-streaming.html', CL_URL, claudeAdapter);
    await wait(120);
    expect(b.of('snapshot').map((m) => m.snapshot.complete)).toEqual([false]);
    const resp = b.doc.querySelector('[data-is-streaming]')!;
    resp.querySelector('p')!.textContent += ' 숨을 조금 길게';
    await wait(150);
    expect(b.of('snapshot')).toHaveLength(1); // 조각 간격 안이라 아직 안 보냄
    resp.setAttribute('data-is-streaming', 'false');
    b.doc.querySelector('button[aria-label="Stop response"]')!.remove();
    await wait(150);
    const s = b.of('snapshot');
    expect(s.at(-1)!.snapshot.complete).toBe(true);
    expect(s.at(-1)!.snapshot.messages[1]!.contentMd).toBe('차분하게: 속도를 0.9배로 하고 숨을 조금 길게');
  });

  it('SPA URL change → reads again for the new conversation', async () => {
    const b = boot('chatgpt-conversation.html', GPT_URL);
    await wait(120);
    (b.win as unknown as Window).history.pushState({}, '', '/c/77aa0000-0000-4000-8000-000000000003');
    await wait(80);
    rt!.readNow();
    const s = b.of('snapshot');
    expect(s.at(-1)!.snapshot.sourceId).toBe('77aa0000-0000-4000-8000-000000000003');
  });

  it('extraction anomaly (message count drop) → no snapshot, health degraded', async () => {
    const b = boot('chatgpt-conversation.html', GPT_URL);
    await wait(120);
    // 12개처럼 보이게 한 뒤 화면이 일부만 남은 상황
    (rt as unknown as { lastCount: number }).lastCount = 12;
    for (const a of [...b.doc.querySelectorAll('article')].slice(1)) a.remove();
    expect(rt!.readNow()).toBe('invalid');
    expect(b.of('snapshot')).toHaveLength(1);
    expect(b.of('health').at(-1)!.report).toMatchObject({ health: 'degraded', errorCode: 'EXTRACT_INVALID' });
  });

  it('sidebar list is sent once, then throttled until it changes', async () => {
    const b = boot('chatgpt-conversation.html', GPT_URL);
    await wait(100);
    const sb = b.of('sidebar');
    expect(sb).toHaveLength(1);
    expect(sb[0]!.items).toHaveLength(3);
    expect(rt!.readSidebar()).toBe('same');
  });

  it('paused → reads nothing', async () => {
    const b = boot('chatgpt-conversation.html', GPT_URL);
    rt!.paused = true;
    await wait(120);
    expect(b.of('snapshot')).toHaveLength(0);
  });
});
