// 저장한 chatgpt.com 페이지(HTML)에 어댑터를 돌려 구조만 출력(대화 내용은 출력하지 않음)
// 사용: tsx scripts/verify-saved.ts <파일.html> [대화주소]
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { chatgptAdapter } from '../src/adapters/chatgpt';
import { validateExtraction } from '../src/adapters/base';

const file = process.argv[2]!;
const html = readFileSync(file, 'utf8');
const saved = /saved from url=\(\d+\)(\S+)/.exec(html)?.[1];
const href = process.argv[3] ?? saved ?? 'https://chatgpt.com/c/unknown';
const w = new Window({ url: href, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, navigation: { disableMainFrameNavigation: true, disableChildFrameNavigation: true, disableChildPageNavigation: true } } as never });
w.document.write(html.replace(/<script[\s\S]*?<\/script>/gi, ''));
const doc = w.document as unknown as Document; const url = new URL(href);
const r = chatgptAdapter.readMessages(doc, url);
if (!r) { console.log('대화 주소가 아님', href); process.exit(1); }
const bad = ['나의 말', '내가 한 말', 'ChatGPT의 말', 'ChatGPT 답변', '메시지 복사', '실수를 할 수'];
console.log(JSON.stringify({ url: href, adapter: chatgptAdapter.version, count: r.messages.length, streaming: r.streaming, fallbacks: r.fallbacks, titleLen: r.title.length,
  roles: r.messages.map((m) => (m.role === 'user' ? 'U' : m.role === 'assistant' ? 'A' : m.role[0])).join(''),
  withId: r.messages.filter((m) => m.externalId).length, emptyBodies: r.messages.filter((m) => !m.contentMd.trim()).length,
  lens: r.messages.map((m) => m.contentMd.length), uiTextHits: r.messages.filter((m) => bad.some((b) => m.contentMd.includes(b))).length,
  validation: validateExtraction(r, url, chatgptAdapter, null), health: chatgptAdapter.healthCheck(doc, url) }, null, 1));
await w.happyDOM.close();
