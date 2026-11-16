import type { MessageRole } from '../shared/contract';
import { makeAdapter } from './base';
import { CHATGPT } from './selectors';

/** 2026-10-16: 턴 상자(article[data-turn] 등)에서 역할 읽기 — data-turn → 안쪽 data-message-author-role → 화면 낭독용 머리글 */
function chatgptRole(el: Element): MessageRole | null {
  const ok = (v: string | null | undefined): MessageRole | null => (v === 'user' || v === 'assistant' ? v : null);
  // 2026-10-16b 새 화면: 메시지 단위 키 끝이 :user / :assistant
  const key = el.getAttribute('data-chatgpt-search-unit-key') ?? el.getAttribute('data-content-search-unit-key');
  if (key) { const m = /:(user|assistant)$/.exec(key); if (m) return m[1] as MessageRole; }
  const t = ok(el.getAttribute('data-turn')); if (t) return t;
  const cr = ok(el.querySelector('[data-conversation-role]')?.getAttribute('data-conversation-role')); if (cr) return cr;
  if (el.hasAttribute('data-message-author-role')) return null; // 기본 규칙에 맡김
  const inner = ok(el.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role')); if (inner) return inner;
  const h = el.querySelector('h1, h2, h3, h4, h5, h6')?.textContent?.trim() ?? '';
  if (/^(You said|나의 말|내가 말|내가 한 말)/i.test(h)) return 'user';
  if (/^(ChatGPT said|ChatGPT의 말|ChatGPT 답변)/i.test(h)) return 'assistant';
  return null;
}
export const chatgptAdapter = makeAdapter('chatgpt', 'chatgpt-dom', '0.1.2', CHATGPT, { roleOf: chatgptRole });
