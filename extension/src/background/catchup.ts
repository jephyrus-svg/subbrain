// 놓친 대화 따라잡기(계약 §14.3 catch-up · 설계서 9.5.2).
// 사이드바 목록 → POST /ingest/catchup/diff → 열어야 할 것만 큐에 → 비활성 탭으로 하나씩, 천천히 연다.
// 지키는 것: 한 번에 탭 하나 · 최소 간격(설정, 서버 rate.maxFetchPerMinute보다 빠르지 않게) · 시간당 상한 · nextScanAfter 전엔 다시 훑지 않음 ·
//            로그인 풀림/봇 확인이면 즉시 멈춤 · 사용자가 방금 쓰던 사이트는 주기 훑기 건너뜀. 사이트 내부 API는 쓰지 않는다(화면만 읽음).
import { SITE_HOME, SITES, type SiteAi } from '../shared/contract';
import type { PageSnapshot, SidebarItem } from '../shared/messages';
import { CoreError, type CoreClient } from './api';
import type { KV, Settings } from './settings';
import { getSite, updateSite } from './state';

export interface TabsPort { open(url: string): Promise<number>; close(tabId: number): Promise<void> }
export interface CatchupDeps { kv: KV; core: CoreClient; now: () => Date; tabs: TabsPort; settings: () => Promise<Settings>; paired: () => Promise<boolean> }
export interface CatchupTab { tabId: number; sourceAi: SiteAi; kind: 'fetch' | 'scan'; sourceId: string | null; openedAt: string }

export const FETCH_TIMEOUT_MS = 60_000;
export const SCAN_TIMEOUT_MS = 45_000;
const DIFF_CHUNK = 500;

export const conversationUrl = (ai: SiteAi, id: string) => (ai === 'chatgpt' ? `https://chatgpt.com/c/${id}` : `https://claude.ai/chat/${id}`);
const tabsKey = 'catchupTabs';
export const openTabs = async (kv: KV) => (await kv.get<CatchupTab[]>(tabsKey)) ?? [];
const setTabs = (kv: KV, t: CatchupTab[]) => kv.set(tabsKey, t);
const blocked = (code: string | null | undefined) => code === 'LOGGED_OUT' || code === 'CHALLENGE';

export async function onSidebar(d: CatchupDeps, ai: SiteAi, items: SidebarItem[], endOfList: boolean): Promise<'off' | 'paused' | 'wait' | 'unpaired' | 'error' | 'queued'> {
  const st = await d.settings();
  if (st.catchupMode === 'off') return 'off';
  if (st.paused) return 'paused';
  if (!(await d.paired())) return 'unpaired';
  const site = await getSite(d.kv, ai);
  if (site.catchup.nextScanAfter && new Date(site.catchup.nextScanAfter) > d.now()) return 'wait';
  if (!items.length) return 'wait';
  let cursor = site.catchup.cursor;
  const byId = new Map(items.map((i) => [i.sourceId, i]));
  const fetch: Array<{ sourceId: string; reason: string }> = [];
  let stopBefore: string | null = null; let rate = { maxFetchPerMinute: 6, nextScanAfter: d.now().toISOString() };
  try {
    for (let i = 0; i < items.length; i += DIFF_CHUNK) {
      const chunk = items.slice(i, i + DIFF_CHUNK);
      const last = i + DIFF_CHUNK >= items.length;
      const r = await d.core.catchupDiff({ sourceAi: ai, items: chunk.map((x) => ({ sourceId: x.sourceId, title: x.title, updatedAt: x.updatedAt, url: x.url })), cursor, endOfList: endOfList && last });
      cursor = r.cursor; fetch.push(...r.fetch); stopBefore = r.stopBefore; rate = r.rate;
      // stopBefore보다 오래된 것만 남으면 더 볼 필요 없음
      if (r.stopBefore && chunk.every((x) => x.updatedAt && x.updatedAt < r.stopBefore!)) break;
    }
  } catch (e) {
    const note = e instanceof CoreError && e.status === 501 ? '코어에 따라잡기 API가 아직 없어요(501)' : e instanceof CoreError && e.unauthorized ? '다시 페어링이 필요해요' : `따라잡기 확인 실패: ${(e as Error).message}`;
    await updateSite(d.kv, ai, (s) => { s.catchup.lastNote = note; });
    return 'error';
  }
  await updateSite(d.kv, ai, (s) => {
    const have = new Set(s.catchup.queue.map((q) => q.sourceId));
    for (const f of fetch) if (!have.has(f.sourceId)) { const it = byId.get(f.sourceId); s.catchup.queue.push({ sourceId: f.sourceId, reason: f.reason, url: it?.url ?? null, title: it?.title ?? '' }); have.add(f.sourceId); }
    s.catchup.cursor = cursor; s.catchup.stopBefore = stopBefore; s.catchup.nextScanAfter = rate.nextScanAfter;
    s.catchup.maxFetchPerMinute = Math.max(1, rate.maxFetchPerMinute); s.catchup.lastScanAt = d.now().toISOString();
    s.catchup.lastNote = fetch.length ? `가져올 대화 ${s.catchup.queue.length}개` : '새로 가져올 대화 없음';
  });
  return 'queued';
}

/** 최소 간격(ms): 사용자 설정과 서버 상한 중 느린 쪽 */
export const minGapMs = (st: Settings, maxPerMin: number) => Math.max(st.catchupIntervalSec * 1000, Math.ceil(60_000 / Math.max(1, maxPerMin)));

/** 알람마다 한 번: 시간 넘긴 탭 닫기 → 조건이 되면 대화 하나 열기. 돌려준 값은 테스트·로그용 */
export async function pumpOnce(d: CatchupDeps): Promise<string> {
  const now = d.now();
  let tabs = await openTabs(d.kv);
  for (const t of tabs) {
    const age = now.getTime() - new Date(t.openedAt).getTime();
    if (age > (t.kind === 'scan' ? SCAN_TIMEOUT_MS : FETCH_TIMEOUT_MS)) {
      await d.tabs.close(t.tabId).catch(() => {});
      await updateSite(d.kv, t.sourceAi, (s) => { s.catchup.lastNote = t.kind === 'scan' ? '목록을 읽지 못하고 시간 초과' : '대화를 다 읽지 못하고 시간 초과 — 다음에 사이트를 열 때 다시'; });
      tabs = tabs.filter((x) => x !== t);
    }
  }
  await setTabs(d.kv, tabs);
  const st = await d.settings();
  if (st.paused) return 'paused';
  if (st.catchupMode === 'off') return 'off';
  if (!(await d.paired())) return 'unpaired';
  if (tabs.length) return 'busy';
  for (const ai of SITES) {
    const site = await getSite(d.kv, ai);
    if (!site.catchup.queue.length) continue;
    if (blocked(site.health?.errorCode)) continue;
    const gap = minGapMs(st, site.catchup.maxFetchPerMinute);
    if (site.catchup.lastOpenAt && now.getTime() - new Date(site.catchup.lastOpenAt).getTime() < gap) continue;
    const hourAgo = now.getTime() - 3600_000;
    const recent = site.catchup.opened.filter((x) => new Date(x).getTime() > hourAgo);
    if (recent.length >= st.catchupMaxPerHour) continue;
    const item = site.catchup.queue[0]!;
    const tabId = await d.tabs.open(item.url ?? conversationUrl(ai, item.sourceId));
    await setTabs(d.kv, [...tabs, { tabId, sourceAi: ai, kind: 'fetch', sourceId: item.sourceId, openedAt: now.toISOString() }]);
    await updateSite(d.kv, ai, (s) => { s.catchup.queue = s.catchup.queue.filter((q) => q.sourceId !== item.sourceId); s.catchup.lastOpenAt = now.toISOString(); s.catchup.opened = [...recent, now.toISOString()]; });
    return `open:${ai}:${item.sourceId}`;
  }
  return 'idle';
}

/** 주기 훑기(L3 background): 사이트 첫 화면을 비활성 탭으로 열어 사이드바만 읽는다 */
export async function scanIfDue(d: CatchupDeps, force: SiteAi | null = null): Promise<string> {
  const st = await d.settings();
  if (st.paused) return 'paused';
  if (!(await d.paired())) return 'unpaired';
  if (!force && st.catchupMode !== 'background') return 'not-background';
  const tabs = await openTabs(d.kv);
  if (tabs.length) return 'busy';
  const now = d.now();
  for (const ai of force ? [force] : SITES) {
    const s = await getSite(d.kv, ai);
    if (blocked(s.health?.errorCode) && !force) continue;
    if (s.catchup.nextScanAfter && new Date(s.catchup.nextScanAfter) > now && !force) continue;
    if (!force && s.catchup.lastScanAt && now.getTime() - new Date(s.catchup.lastScanAt).getTime() < st.scanEveryHours * 3600_000) continue;
    if (!force && s.lastVisitAt && now.getTime() - new Date(s.lastVisitAt).getTime() < st.skipIfActiveMin * 60_000) continue;
    if (s.catchup.queue.length && !force) continue; // 큐를 다 비운 뒤에
    const tabId = await d.tabs.open(SITE_HOME[ai]);
    await setTabs(d.kv, [...tabs, { tabId, sourceAi: ai, kind: 'scan', sourceId: null, openedAt: now.toISOString() }]);
    return `scan:${ai}`;
  }
  return 'idle';
}

/** 따라잡기 탭에서 온 메시지인지 */
export async function catchupTabOf(kv: KV, tabId: number | undefined): Promise<CatchupTab | null> {
  if (tabId === undefined) return null;
  return (await openTabs(kv)).find((t) => t.tabId === tabId) ?? null;
}
/** 따라잡기 탭이 할 일을 끝냈으면 닫는다 */
export async function finishTab(d: CatchupDeps, t: CatchupTab, note?: string) {
  await d.tabs.close(t.tabId).catch(() => {});
  await setTabs(d.kv, (await openTabs(d.kv)).filter((x) => x.tabId !== t.tabId));
  await updateSite(d.kv, t.sourceAi, (s) => { if (t.kind === 'fetch') s.catchup.fetchedTotal++; if (note) s.catchup.lastNote = note; });
}
export async function onCatchupSnapshot(d: CatchupDeps, t: CatchupTab, snap: PageSnapshot): Promise<boolean> {
  if (t.kind !== 'fetch' || snap.sourceId !== t.sourceId || !snap.complete) return false;
  await finishTab(d, t); return true;
}
/** 따라잡기 탭이 로그인 화면·봇 확인이면: 탭 닫고 그 사이트 큐 멈춤 */
export async function onCatchupBlocked(d: CatchupDeps, t: CatchupTab, code: string) {
  await finishTab(d, t, code === 'CHALLENGE' ? '봇 확인 화면이 떠서 멈췄어요 — 사이트를 직접 열어 확인해 주세요' : '로그인이 풀려 멈췄어요 — 직접 로그인해 주세요');
}
