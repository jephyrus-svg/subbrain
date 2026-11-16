// 서비스 워커: 콘텐츠 스크립트·팝업 메시지를 받고, 로컬 코어 호출을 전담한다.
// 상태는 모두 storage.local · IndexedDB에 있어서 워커가 꺼졌다 켜져도 이어진다(알람이 깨움).
import { ADAPTERS } from '../adapters/index';
import { SITES, type SiteAi } from '../shared/contract';
import type { PopupRequest, ToWorker } from '../shared/messages';
import { CoreClient } from './api';
import { idbBuffer } from './buffer';
import { catchupTabOf, finishTab, onCatchupBlocked, onCatchupSnapshot, onSidebar, openTabs, pumpOnce, scanIfDue, type CatchupDeps } from './catchup';
import { reportHealth } from './health';
import { pair } from './pairing';
import { flushBuffer, sendSnapshot, type SenderDeps } from './sender';
import { chromeKV, loadSettings, saveSettings, type Pairing } from './settings';
import { getSite, updateSite } from './state';

const kv = chromeKV(chrome.storage.local);
const buffer = idbBuffer();
const now = () => new Date();
const token = async () => { const p = await kv.get<Pairing>('pairing'); return p && !p.needsRepair ? p.token : null; };
const clientFor = (base?: string) => new CoreClient({ fetch: (...a) => fetch(...a), baseUrl: async () => base ?? (await loadSettings(kv)).coreUrl, token });
const core = clientFor();
const sender: SenderDeps = { kv, core, buffer, now };
const tabs = {
  async open(url: string) { const t = await chrome.tabs.create({ url, active: false }); return t.id!; },
  async close(id: number) { await chrome.tabs.remove(id); },
};
const cd: CatchupDeps = { kv, core, now, tabs, settings: () => loadSettings(kv), paired: async () => !!(await token()) };

// ── 알람: 버퍼 재전송 1분 · 따라잡기 펌프 30초 · 주기 훑기 확인 10분 · 상태 보고 하루
async function ensureAlarms() {
  const want: Record<string, chrome.alarms.AlarmCreateInfo> = {
    flush: { periodInMinutes: 1 }, pump: { periodInMinutes: 0.5 }, scan: { periodInMinutes: 10 }, healthDaily: { periodInMinutes: 1440 },
  };
  for (const [name, info] of Object.entries(want)) if (!(await chrome.alarms.get(name))) await chrome.alarms.create(name, info);
}
chrome.runtime.onInstalled.addListener(() => { void ensureAlarms(); void refreshBadge(); });
chrome.runtime.onStartup.addListener(() => { void ensureAlarms(); void flushBuffer(sender); });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'flush') void loadSettings(kv).then((s) => (s.paused ? null : flushBuffer(sender))).then(refreshBadge);
  if (a.name === 'pump') void pumpSoon();
  if (a.name === 'scan') void scanIfDue(cd);
  if (a.name === 'healthDaily') for (const ai of SITES) void reportHealth({ kv, core, buffer, now }, ai, null);
});

// 20초 간격 설정은 30초 알람보다 짧으므로 워커가 살아 있는 동안은 타이머로 한 번 더 본다
let pumpTimer: ReturnType<typeof setTimeout> | null = null;
async function pumpSoon() {
  const r = await pumpOnce(cd);
  const st = await loadSettings(kv);
  if (pumpTimer) clearTimeout(pumpTimer);
  if (r !== 'paused' && r !== 'off' && r !== 'unpaired' && st.catchupIntervalSec < 30) pumpTimer = setTimeout(() => void pumpSoon(), st.catchupIntervalSec * 1000);
}

// ── 콘텐츠 스크립트
chrome.runtime.onMessage.addListener((msg: ToWorker | PopupRequest, sender_, reply) => {
  void handle(msg, sender_).then(reply, (e) => reply({ ok: false, message: String(e) }));
  return true;
});

async function handle(msg: ToWorker | PopupRequest, from: chrome.runtime.MessageSender): Promise<unknown> {
  const tabId = from.tab?.id;
  switch (msg.type) {
    case 'hello': case 'visit': {
      const ct = await catchupTabOf(kv, tabId);
      if (!ct && from.tab?.active !== false) await updateSite(kv, msg.sourceAi, (s) => { s.lastVisitAt = now().toISOString(); });
      return { ok: true, paused: (await loadSettings(kv)).paused };
    }
    case 'snapshot': {
      const st = await loadSettings(kv);
      if (st.paused) return { ok: false, paused: true };
      const ct = await catchupTabOf(kv, tabId);
      const snap = { ...msg.snapshot, catchup: !!ct };
      const r = await sendSnapshot(sender, snap);
      if (ct) await onCatchupSnapshot(cd, ct, snap);
      void refreshBadge();
      return { ok: true, result: r };
    }
    case 'sidebar': {
      const ct = await catchupTabOf(kv, tabId);
      const r = await onSidebar(cd, msg.sourceAi, msg.items, msg.endOfList);
      if (ct?.kind === 'scan') await finishTab(cd, ct, undefined);
      if (r === 'queued') void pumpSoon();
      return { ok: true, result: r };
    }
    case 'health': {
      const ct = await catchupTabOf(kv, tabId);
      if (ct && (msg.report.errorCode === 'LOGGED_OUT' || msg.report.errorCode === 'CHALLENGE')) await onCatchupBlocked(cd, ct, msg.report.errorCode);
      await reportHealth({ kv, core, buffer, now }, msg.sourceAi, msg.report);
      void refreshBadge();
      return { ok: true };
    }
    // ── 팝업
    case 'status': return status();
    case 'pair': {
      const r = await pair({ kv, core: (b) => clientFor(b), extensionId: chrome.runtime.id }, msg.code, msg.coreUrl);
      if (r.ok) { void flushBuffer(sender); for (const ai of SITES) void reportHealth({ kv, core, buffer, now }, ai, null, true); }
      void refreshBadge();
      return r.ok ? { ok: true } : r;
    }
    case 'unpair': await kv.remove('pairing'); void refreshBadge(); return { ok: true };
    case 'set-settings': {
      const s = await saveSettings(kv, msg.patch);
      for (const t of await chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://claude.ai/*'] })) if (t.id) chrome.tabs.sendMessage(t.id, { type: 'paused', paused: s.paused }).catch(() => {});
      void refreshBadge();
      return { ok: true, settings: s };
    }
    case 'catchup-now': return { ok: true, result: await scanIfDue(cd, msg.sourceAi) };
    case 'flush': return { ok: true, result: await flushBuffer(sender) };
  }
}

async function status() {
  const settings = await loadSettings(kv);
  const p = await kv.get<Pairing>('pairing');
  const sites = Object.fromEntries(await Promise.all(SITES.map(async (ai) => [ai, await getSite(kv, ai)] as const)));
  return {
    ok: true, settings, buffered: await buffer.count(), coreReachable: await core.ping(), openCatchupTabs: (await openTabs(kv)).length,
    pairing: p ? { tokenId: p.client.tokenId, pairedAt: p.pairedAt, needsRepair: !!p.needsRepair } : null,
    sites, adapters: Object.fromEntries(SITES.map((ai) => [ai, { name: ADAPTERS[ai].name, version: ADAPTERS[ai].version, domVersion: ADAPTERS[ai].sel.domVersion }])),
  };
}

/** 아이콘 배지: 쉼 · 페어링 필요 · 고장 · 보관 중 수 */
async function refreshBadge() {
  const s = await loadSettings(kv); const p = await kv.get<Pairing>('pairing');
  const sites = await Promise.all(SITES.map((ai: SiteAi) => getSite(kv, ai)));
  const n = await buffer.count();
  const [text, color] = s.paused ? ['쉼', '#8C8577'] : !p || p.needsRepair ? ['!', '#B5763C'] : sites.some((x) => x.health?.health === 'broken') ? ['!', '#B5523C'] : n > 0 ? [String(Math.min(n, 99)), '#6F7F96'] : ['', '#6F7F96'];
  await chrome.action.setBadgeText({ text }); await chrome.action.setBadgeBackgroundColor({ color });
}
void ensureAlarms();
