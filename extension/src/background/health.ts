// 어댑터 상태 보고(계약 §14.3 POST /sync-state/:ai/health): 시작할 때 · 상태가 바뀔 때 · 하루 한 번
import type { SiteAi } from '../shared/contract';
import type { HealthReport } from '../adapters/types';
import { ADAPTERS } from '../adapters/index';
import type { CoreClient } from './api';
import type { SnapshotBuffer } from './buffer';
import type { KV } from './settings';
import { getSite, updateSite } from './state';

const DAY = 86_400_000;
const sig = (r: HealthReport) => `${r.health}|${r.errorCode ?? ''}|${r.checks.map((c) => `${c.name}:${c.ok}`).join(',')}`;

export async function reportHealth(d: { kv: KV; core: CoreClient; buffer: SnapshotBuffer; now: () => Date }, ai: SiteAi, report: HealthReport | null, force = false): Promise<'sent' | 'same' | 'failed' | 'none'> {
  const now = d.now();
  const site = await updateSite(d.kv, ai, (s) => { if (report) { s.health = report; s.healthAt = now.toISOString(); } });
  const r = site.health; if (!r) return 'none';
  const changed = site.healthSentSig !== sig(r);
  const stale = !site.healthSentAt || now.getTime() - new Date(site.healthSentAt).getTime() > DAY;
  if (!force && !changed && !stale) return 'same';
  const a = ADAPTERS[ai];
  try {
    await d.core.health(ai, { adapter: { name: a.name, version: a.version, domVersion: a.sel.domVersion }, health: r.health, checks: r.checks, errorCode: r.errorCode, at: now.toISOString(), bufferedSnapshots: await d.buffer.count() });
    await updateSite(d.kv, ai, (s) => { s.healthSentAt = now.toISOString(); s.healthSentSig = sig(r); });
    return 'sent';
  } catch { return 'failed'; }
}
export const lastHealth = async (kv: KV, ai: SiteAi) => (await getSite(kv, ai)).health;
