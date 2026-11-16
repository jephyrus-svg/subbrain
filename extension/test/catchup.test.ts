// 따라잡기: diff → 큐 → 천천히(간격·시간당 상한·서버 상한·한 번에 탭 하나) · nextScanAfter · 로그인 풀림 멈춤 · 주기 훑기 건너뛰기
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMockCore } from '../mock-server/core';
import { CoreClient } from '../src/background/api';
import { catchupTabOf, minGapMs, onCatchupBlocked, onCatchupSnapshot, onSidebar, openTabs, pumpOnce, scanIfDue, type CatchupDeps } from '../src/background/catchup';
import { DEFAULT_SETTINGS, memoryKV, saveSettings, loadSettings } from '../src/background/settings';
import { getSite, updateSite } from '../src/background/state';
import type { PageSnapshot } from '../src/shared/messages';

const mock = createMockCore();
let base = '';
beforeAll(async () => { base = await mock.listen(); });
afterAll(() => mock.close());

let kv: ReturnType<typeof memoryKV>; let d: CatchupDeps; let clock: number; let opened: string[]; let closed: number[];
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ sourceId: `id${i}`, title: `대화 ${i}`, updatedAt: null, url: `https://claude.ai/chat/id${i}` }));
beforeEach(async () => {
  mock.state.known.clear(); mock.state.requests.length = 0; mock.state.rate = [];
  // 토큰 하나 발급해 둠
  const code = mock.issueCode();
  const token = (await (await fetch(`${base}/api/v1/pairing/complete`, { method: 'POST', body: JSON.stringify({ code, client: { kind: 'extension', name: 't', version: '0', extensionId: 'testextensionid' } }) })).json()).token as string;
  kv = memoryKV(); clock = Date.now(); opened = []; closed = [];
  let tabSeq = 100;
  d = {
    kv, now: () => new Date(clock), settings: () => loadSettings(kv), paired: async () => true,
    core: new CoreClient({ fetch, baseUrl: async () => base, token: async () => token }),
    tabs: { open: async (u) => { opened.push(u); return ++tabSeq; }, close: async (id) => { closed.push(id); } },
  };
  // 2026-10-16 기본은 끔 — 따라잡기 동작 시험은 사용자가 '자동'을 직접 켠 상태로
  await loadSettings(kv); await saveSettings(kv, { catchupMode: 'background' });
});

describe('2026-10-16 따라잡기 기본 끔', () => {
  it('저장된 예전 기본값(background)도 한 번만 off로 바꾸고, 그 뒤 다시 켠 값은 유지', async () => {
    const k = memoryKV();
    await k.set('settings', { ...DEFAULT_SETTINGS, catchupMode: 'background', catchupOffMigrated: undefined });
    expect((await loadSettings(k)).catchupMode).toBe('off');
    await saveSettings(k, { catchupMode: 'visit' });
    expect((await loadSettings(k)).catchupMode).toBe('visit');
  });
});

describe('catch-up', () => {
  it('sidebar → diff (only unknown) → queue; respects nextScanAfter for the next scan', async () => {
    mock.state.known.set('claude:id1', '2026-10-01');
    expect(await onSidebar(d, 'claude', items(4), false)).toBe('queued');
    const s = await getSite(kv, 'claude');
    expect(s.catchup.queue.map((q) => q.sourceId)).toEqual(['id0', 'id2', 'id3']);
    expect(s.catchup.cursor).toMatch(/^cur_claude/);
    expect(s.catchup.maxFetchPerMinute).toBe(6);
    expect(await onSidebar(d, 'claude', items(4), false)).toBe('wait'); // nextScanAfter(30분 뒤) 전
    expect(mock.state.requests.filter((r) => r.path === '/ingest/catchup/diff')).toHaveLength(1);
  });

  it('opens one background tab at a time, no faster than the configured gap', async () => {
    await onSidebar(d, 'claude', items(3), false);
    expect(await pumpOnce(d)).toBe('open:claude:id0');
    expect(opened).toEqual(['https://claude.ai/chat/id0']);
    expect(await pumpOnce(d)).toBe('busy');            // 첫 탭이 아직 열려 있음
    const tab = (await openTabs(kv))[0]!;
    const snap = { sourceId: 'id0', complete: true } as PageSnapshot;
    expect(await onCatchupSnapshot(d, tab, snap)).toBe(true);
    expect(closed).toEqual([tab.tabId]);
    clock += 10_000;
    expect(await pumpOnce(d)).toBe('idle');            // 30초(기본 '천천히') 안 됨
    clock += 21_000;
    expect(await pumpOnce(d)).toBe('open:claude:id1');
    expect((await getSite(kv, 'claude')).catchup.fetchedTotal).toBe(1);
  });

  it('server limit wins when slower than the setting; hourly cap holds', async () => {
    const st = await saveSettings(kv, { catchupIntervalSec: 20, catchupMaxPerHour: 2 });
    expect(minGapMs(st, 6)).toBe(20_000);
    expect(minGapMs(st, 1)).toBe(60_000);
    await onSidebar(d, 'claude', items(5), false);
    for (let i = 0; i < 4; i++) { await pumpOnce(d); const t = (await openTabs(kv))[0]; if (t) await onCatchupSnapshot(d, t, { sourceId: t.sourceId!, complete: true } as PageSnapshot); clock += 25_000; }
    expect(opened).toHaveLength(2);
  });

  it('a tab that never delivers is closed after the timeout', async () => {
    await onSidebar(d, 'claude', items(1), false);
    await pumpOnce(d); clock += 61_000;
    await pumpOnce(d);
    expect(closed).toHaveLength(1);
    expect((await getSite(kv, 'claude')).catchup.lastNote).toMatch(/시간 초과/);
  });

  it('logged out / challenge in a catch-up tab → close and stop that site', async () => {
    await onSidebar(d, 'claude', items(3), false);
    await pumpOnce(d);
    const t = (await catchupTabOf(kv, (await openTabs(kv))[0]!.tabId))!;
    await onCatchupBlocked(d, t, 'LOGGED_OUT');
    await updateSite(kv, 'claude', (s) => { s.health = { health: 'broken', checks: [], errorCode: 'LOGGED_OUT' }; });
    clock += 120_000;
    expect(await pumpOnce(d)).toBe('idle');
    expect((await getSite(kv, 'claude')).catchup.lastNote).toMatch(/로그인/);
  });

  it('paused or mode off → nothing opens', async () => {
    await onSidebar(d, 'claude', items(2), false);
    await saveSettings(kv, { paused: true }); expect(await pumpOnce(d)).toBe('paused');
    await saveSettings(kv, { paused: false, catchupMode: 'off' }); expect(await pumpOnce(d)).toBe('off');
    expect(await onSidebar(d, 'chatgpt', items(2), false)).toBe('off');
    expect(opened).toHaveLength(0);
  });

  it('periodic scan opens the site home in background, but skips a site the user just used', async () => {
    expect(DEFAULT_SETTINGS.catchupMode).toBe('off');
    await updateSite(kv, 'chatgpt', (s) => { s.lastVisitAt = new Date(clock - 2 * 60_000).toISOString(); });
    expect(await scanIfDue(d)).toBe('scan:claude');
    expect(opened).toEqual(['https://claude.ai/recents']);
  });
});
