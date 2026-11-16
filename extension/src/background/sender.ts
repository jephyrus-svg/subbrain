// 스냅샷 보내기 · 오프라인 재전송 (계약 1.5.0 §14.3)
// - 멱등 키 sourceAi:sourceId:contentHash (Idempotency-Key 헤더 = 같은 값)
// - append: 서버가 가진 해시(지난 응답 contentHash)가 새 메시지 앞부분 해시와 같을 때만, appendFromSeq = 그 개수
// - 409 BASE_MISMATCH → 바로 full로 다시
// - 코어 꺼짐(네트워크)·501(아직 구현 안 됨)·429·5xx → 버퍼에 남겨 두고 나중에 /ingest/replay(≤20, 오래된 것부터)
// - 401 → 다시 페어링 필요 표시(버퍼 유지) · 400/413 → 이 스냅샷은 버림(같은 오류 반복 방지)
import type { IngestSnapshotBody, IngestSnapshotResponse, SiteAi } from '../shared/contract';
import { contentHash, idempotencyKey } from '../shared/hash';
import type { PageSnapshot } from '../shared/messages';
import { CoreError, type CoreClient } from './api';
import { bufferKey, type SnapshotBuffer } from './buffer';
import type { KV, Pairing } from './settings';
import { convKey, updateSite, type ConvState } from './state';

export const REPLAY_BATCH = 20;
export interface SenderDeps { kv: KV; core: CoreClient; buffer: SnapshotBuffer; now: () => Date }
export type SendOutcome = { status: IngestSnapshotResponse['status'] | 'skipped' | 'buffered' | 'dropped' | 'unpaired'; detail?: string };

export async function toBody(s: PageSnapshot): Promise<IngestSnapshotBody> {
  return {
    sourceAi: s.sourceAi, sourceId: s.sourceId, url: s.url, title: s.title, capturedAt: s.capturedAt, serviceUpdatedAt: null,
    captureMethod: s.catchup ? 'extension_catchup' : 'extension_live', mode: 'full', messages: s.messages,
    contentHash: await contentHash(s.messages), complete: s.complete, adapter: s.adapter, project: s.project,
  };
}

/** 지난번 서버 확인 값으로 append가 가능한지 */
export async function asAppend(full: IngestSnapshotBody, prev: ConvState | undefined): Promise<IngestSnapshotBody> {
  if (!prev || prev.count <= 0 || prev.count >= full.messages.length) return full;
  const prefix = await contentHash(full.messages.slice(0, prev.count));
  if (prefix !== prev.contentHash) return full; // 앞부분이 바뀜(편집·다시 생성) → full
  return { ...full, mode: 'append', appendFromSeq: prev.count, baseContentHash: prev.contentHash, messages: full.messages.slice(prev.count) };
}

const today = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; // 사용자 현지 날짜
async function record(deps: SenderDeps, ai: SiteAi, title: string, result: string, error: string | null) {
  await updateSite(deps.kv, ai, (s) => {
    s.lastResult = result; s.lastError = error;
    if (!error || result === 'buffered') { s.lastSentAt = result === 'buffered' ? s.lastSentAt : deps.now().toISOString(); s.lastTitle = title; }
    if (!error) { const d = today(deps.now()); s.sentToday = s.sentToday.date === d ? { date: d, n: s.sentToday.n + 1 } : { date: d, n: 1 }; }
  });
}

async function markUnpaired(kv: KV) {
  const p = await kv.get<Pairing>('pairing'); if (p && !p.needsRepair) await kv.set('pairing', { ...p, needsRepair: true });
}

export async function sendSnapshot(deps: SenderDeps, snap: PageSnapshot): Promise<SendOutcome> {
  const full = await toBody(snap);
  const ck = convKey(full.sourceAi, full.sourceId);
  const prev = await deps.kv.get<ConvState>(ck);
  // 같은 내용: 이미 완성으로 보냈거나 지금도 스트리밍 조각이면 건너뜀(마지막 complete:true는 내용이 같아도 보냄)
  if (prev && prev.contentHash === full.contentHash && (prev.complete || !full.complete)) return { status: 'skipped', detail: '바뀐 것 없음' };
  // 먼저 버퍼에(서비스 워커가 보내는 도중 꺼져도 남도록). 버퍼에는 항상 full로 둔다 — 재전송 때 base가 달라도 안전
  await deps.buffer.put(full);
  return deliver(deps, full, prev);
}

async function deliver(deps: SenderDeps, full: IngestSnapshotBody, prev: ConvState | undefined, retried = false): Promise<SendOutcome> {
  const ck = convKey(full.sourceAi, full.sourceId);
  const body = retried ? full : await asAppend(full, prev);
  try {
    const { data } = await deps.core.snapshot(body, idempotencyKey(full.sourceAi, full.sourceId, full.contentHash));
    if (data.status !== 'stale') await deps.kv.set(ck, { contentHash: data.contentHash, count: data.messageCount, capturedAt: full.capturedAt, complete: full.complete } satisfies ConvState);
    await deps.buffer.remove(bufferKey(full), full.capturedAt);
    await record(deps, full.sourceAi as SiteAi, full.title, data.status, null);
    return { status: data.status };
  } catch (e) {
    if (!(e instanceof CoreError)) throw e;
    if (e.baseMismatch && !retried) { await deps.kv.remove(ck); return deliver(deps, full, undefined, true); }
    if (e.unauthorized) { await markUnpaired(deps.kv); await record(deps, full.sourceAi as SiteAi, full.title, 'buffered', '다시 페어링이 필요해요'); return { status: 'unpaired', detail: e.message }; }
    if (e.retryable) {
      const why = e.status === 0 ? '코어가 꺼져 있어 보관 중' : e.status === 501 ? '코어에 수집 API가 아직 없어 보관 중(501)' : e.status === 429 ? `요청이 많아 ${e.retryAfterSec ?? 60}초 쉬는 중(429)` : `코어 오류 ${e.status} · 보관 중`;
      await record(deps, full.sourceAi as SiteAi, full.title, 'buffered', why);
      return { status: 'buffered', detail: why };
    }
    await deps.buffer.remove(bufferKey(full), full.capturedAt);
    await record(deps, full.sourceAi as SiteAi, full.title, 'dropped', `${e.code}: ${e.message}`);
    return { status: 'dropped', detail: e.message };
  }
}

/** 버퍼 비우기: 오래된 것부터 20개씩 /ingest/replay. 돌려준 값 = 보낸 수 */
export async function flushBuffer(deps: SenderDeps, maxBatches = 5): Promise<{ sent: number; left: number; error?: string }> {
  let sent = 0;
  for (let b = 0; b < maxBatches; b++) {
    const batch = await deps.buffer.oldest(REPLAY_BATCH);
    if (!batch.length) break;
    let res;
    try { res = await deps.core.replay({ snapshots: batch.map((x) => x.body) }); }
    catch (e) {
      if (e instanceof CoreError && e.unauthorized) await markUnpaired(deps.kv);
      return { sent, left: await deps.buffer.count(), error: e instanceof Error ? e.message : String(e) };
    }
    for (const r of res.results) {
      const entry = batch[r.index]; if (!entry) continue;
      const ck = convKey(entry.body.sourceAi, entry.body.sourceId);
      if (r.ok) {
        if (r.result.status !== 'stale') await deps.kv.set(ck, { contentHash: r.result.contentHash, count: r.result.messageCount, capturedAt: entry.capturedAt, complete: entry.body.complete } satisfies ConvState);
        await deps.buffer.remove(entry.key, entry.capturedAt); sent++;
        await record(deps, entry.body.sourceAi as SiteAi, entry.body.title, r.result.status, null);
      } else {
        const code = r.error.error.code; const st = code === 'RATE_LIMITED' ? 429 : code === 'CONFLICT' ? 409 : 400;
        if (code === 'CONFLICT') { await deps.kv.remove(ck); await deps.buffer.remove(entry.key, entry.capturedAt); } // 다음 정상 수집 때 full
        else if (st === 429 || code === 'NOT_IMPLEMENTED' || code === 'INTERNAL' || code === 'DB_BUSY') await deps.buffer.bump(entry.key);
        else { await deps.buffer.remove(entry.key, entry.capturedAt); await record(deps, entry.body.sourceAi as SiteAi, entry.body.title, 'dropped', `${code}: ${r.error.error.message}`); }
      }
    }
    if (batch.length < REPLAY_BATCH) break;
  }
  return { sent, left: await deps.buffer.count() };
}
