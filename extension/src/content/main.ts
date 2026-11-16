// chatgpt.com · claude.ai 에 들어가는 콘텐츠 스크립트(둘이 같은 파일, 주소로 어댑터를 고름)
import { adapterForHost } from '../adapters/index';
import type { ToContent, ToWorker } from '../shared/messages';
import { ContentRuntime } from './runtime';

const adapter = adapterForHost(location.hostname);
if (adapter) {
  const send = (m: ToWorker) => { chrome.runtime.sendMessage(m).catch(() => { /* 워커가 깨어나는 중 — 다음 변화 때 다시 */ }); };
  const rt = new ContentRuntime(adapter, window, send);
  chrome.storage.local.get('settings').then((r) => { rt.paused = !!(r.settings as { paused?: boolean } | undefined)?.paused; rt.start(); });
  chrome.runtime.onMessage.addListener((m: ToContent) => { if (m.type === 'paused') { rt.paused = m.paused; if (!m.paused) rt.readNow(); } });
}
