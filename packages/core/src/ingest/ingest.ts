/**
 * 1.9.0 확장 수집(계약 §14.3): 스냅샷 멱등 수신 · 부분(스트리밍) 저장 · append · 오프라인 재전송 · 따라잡기 diff · 어댑터 상태.
 *  - 멱등 키 `sourceAi:sourceId:contentHash`(ingest_keys). contentHash = sha256(role+"\0"+contentMd 를 "\n\0"로 이음, hex) — 서버가 다시 계산.
 *  - 비밀정보는 저장 전에 redactSecrets(해시는 확장이 보낸 원문 기준이라 다음 append의 base로 그대로 씀).
 *  - 분류: 완성 스냅샷이 오면 대화가 debounceMs(기본 120초) 조용해질 때 분류. 부분 스냅샷은 저장만, debounceMs 동안 조각이 없으면 완성으로 봄.
 *  - 2026-10-16: 확장 수집 자동 분류는 기본 끔(유료 LLM 호출 방지). SUBBRAIN_INGEST_AUTO_CLASSIFY=1 일 때만 자동 분류. 끄면 저장만 하고 웹의 '분류 실행'으로 직접.
 *  - 2026-10-16: 내보내기 등으로 이미 있는 대화에 처음 들어온 화면 스냅샷이 메시지 수가 더 적으면 덮어쓰지 않음(메시지 삭제 방지, status stale).
 */
import { createHash } from 'node:crypto';
import type { AdapterHealthBody, AdapterHealthResponse, CatchupDiffBody, CatchupDiffResponse, IngestMessage, IngestReplayBody, IngestReplayResponse, IngestSnapshotBody, IngestSnapshotResponse, SyncStateItem, SyncStateResponse, ApiError as ApiErrorShape } from '@subbrain/shared';
import type { Core } from '../core.ts';
import { redactSecrets } from '../classifier/redact.ts';
import { str } from '../db/db.ts';
import { enqueueClassification } from '../services/classify.ts';
import { upsertConversation } from '../services/imports.ts';
import { collectionStatus } from '../services/lists.ts';
import { ApiError } from '../util/errors.ts';
import { normalizeIso, nowIso } from '../util/time.ts';

export function ingestContentHash(messages: Array<Pick<IngestMessage, 'role' | 'contentMd'>>): string {
  return createHash('sha256').update(messages.map((m) => `${m.role}\0${m.contentMd}`).join('\n\0')).digest('hex');
}

/** 확장 수집 뒤 자동 분류 여부(기본 끔 — 유료 LLM 호출은 사용자가 직접 실행) */
export const ingestAutoClassify = () => /^(1|true|on|yes)$/i.test(process.env.SUBBRAIN_INGEST_AUTO_CLASSIFY ?? '');

/** 대화별 분류 미루기(메모리 타이머). 코어를 닫으면 정리 */
export class IngestDebouncer {
  private timers = new Map<string, NodeJS.Timeout>();
  constructor(private core: Core, public ms: number) {}
  schedule(convId: string, finalizePartial: boolean): void {
    clearTimeout(this.timers.get(convId));
    const fire = () => {
      this.timers.delete(convId);
      try {
        if (finalizePartial) this.core.db.run('UPDATE conversations SET ingest_partial=0 WHERE id=?', convId);
        const st = this.core.db.get<{ classified_hash: string | null; content_hash: string; ingest_partial: number }>('SELECT classified_hash, content_hash, ingest_partial FROM conversations WHERE id=?', convId);
        if (st && !st.ingest_partial && st.classified_hash !== st.content_hash && ingestAutoClassify()) enqueueClassification(this.core, [convId], '실시간 수집 분류');
      } catch { /* 코어가 닫힘 */ }
    };
    if (this.ms <= 0) { fire(); return; }
    const t = setTimeout(fire, this.ms); t.unref?.(); this.timers.set(convId, t);
  }
  pending(): number { return this.timers.size; }
  flushAll(): void { for (const [id, t] of [...this.timers]) { clearTimeout(t); this.timers.delete(id); } }
  close(): void { for (const t of this.timers.values()) clearTimeout(t); this.timers.clear(); }
}
const debouncers = new WeakMap<Core, IngestDebouncer>();
export function debouncerFor(core: Core): IngestDebouncer {
  let d = debouncers.get(core);
  if (!d) { d = new IngestDebouncer(core, Number(process.env.SUBBRAIN_INGEST_DEBOUNCE_MS ?? 120_000)); debouncers.set(core, d); }
  return d;
}

function ensureSync(core: Core, ai: string) {
  core.db.run("INSERT OR IGNORE INTO sync_state(source_ai, adapter_health, methods_json) VALUES (?, 'ok', '[\"export\"]')", ai);
}
function addMethod(core: Core, ai: string, m: string) {
  ensureSync(core, ai);
  const cur = JSON.parse(String(core.db.value('SELECT methods_json FROM sync_state WHERE source_ai=?', ai) ?? '[]')) as string[];
  if (!cur.includes(m)) core.db.run('UPDATE sync_state SET methods_json=? WHERE source_ai=?', JSON.stringify([...cur, m]), ai);
}

export function ingestSnapshot(core: Core, b: IngestSnapshotBody, opts: { idempotencyKey?: string | null; tokenId?: string | null } = {}): { status: 200 | 202; body: IngestSnapshotResponse } {
  const db = core.db;
  const receivedAt = nowIso();
  // 1.9.1 'sha256:' 접두어 허용(정식은 맨 hex) · 시각은 +09:00으로 맞춰 저장(어떤 오프셋이든 받음)
  const strip = (h: string | null | undefined) => (h ? h.replace(/^sha256:/i, '').toLowerCase() : h);
  b = { ...b, contentHash: strip(b.contentHash)!, baseContentHash: strip(b.baseContentHash), capturedAt: normalizeIso(b.capturedAt)!, serviceUpdatedAt: normalizeIso(b.serviceUpdatedAt),
    messages: b.messages.map((m) => ({ ...m, createdAt: normalizeIso(m.createdAt) })) };
  const key = `${b.sourceAi}:${b.sourceId}:${b.contentHash}`;
  if (opts.idempotencyKey && opts.idempotencyKey.replace(/:sha256:/i, ':') !== key) throw new ApiError('VALIDATION_ERROR', 'Idempotency-Key가 sourceAi:sourceId:contentHash와 달라요.', { expected: key, got: opts.idempotencyKey });
  const ex = db.get<{ id: string; task_id: string | null; ingest_hash: string | null; ingest_captured_at: string | null; message_count: number; classified_hash: string | null; content_hash: string }>(
    'SELECT id, task_id, ingest_hash, ingest_captured_at, message_count, classified_hash, content_hash FROM conversations WHERE source_ai=? AND source_id=?', b.sourceAi, b.sourceId);
  const done = db.get<{ conversation_id: string }>('SELECT conversation_id FROM ingest_keys WHERE key=?', key);
  const resp = (status: IngestSnapshotResponse['status'], convId: string, classification: IngestSnapshotResponse['classification']): IngestSnapshotResponse => {
    const c = db.get<{ task_id: string | null; ingest_hash: string | null; message_count: number }>('SELECT task_id, ingest_hash, message_count FROM conversations WHERE id=?', convId)!;
    return { status, idempotencyKey: key, conversationId: convId, taskId: str(c.task_id), contentHash: c.ingest_hash ?? b.contentHash, messageCount: Number(c.message_count), classification, receivedAt };
  };
  if (done && ex) return { status: 200, body: resp('duplicate', ex.id, 'not_needed') };

  // 전체 메시지 만들기(append면 서버가 가진 앞부분 + 새 부분)
  let full: IngestMessage[];
  if (b.mode === 'append') {
    if (!ex || ex.ingest_hash !== b.baseContentHash) throw new ApiError('CONFLICT', '서버가 가진 대화와 기준 해시가 달라요. full로 다시 보내 주세요.', { reason: 'BASE_MISMATCH', expectedContentHash: ex?.ingest_hash ?? null });
    const prev = db.all<{ seq: number; role: IngestMessage['role']; content_md: string; created_at: string | null; external_id: string | null; voice: number }>(
      'SELECT seq, role, content_md, created_at, external_id, voice FROM messages WHERE conversation_id=? AND seq<=? ORDER BY seq', ex.id, b.appendFromSeq!);
    const raw = rawCache.get(ex.id);
    // 해시 검증은 원문 기준이어야 함: 가려 저장한 본문 대신, 마지막으로 받은 원문 사본(메모리)이 있으면 그걸 쓴다
    const head: IngestMessage[] = raw ? raw.slice(0, b.appendFromSeq) : prev.map((m) => ({ seq: m.seq - 1, externalId: m.external_id, role: m.role, contentMd: m.content_md, createdAt: m.created_at, voice: !!m.voice }));
    const byExt = new Map(b.messages.filter((m) => m.externalId).map((m) => [m.externalId!, m]));
    full = [...head.map((m) => (m.externalId && byExt.has(m.externalId) ? byExt.get(m.externalId)! : m)), ...b.messages.filter((m) => !(m.externalId && head.some((h) => h.externalId === m.externalId)))];
  } else full = [...b.messages].sort((x, y) => x.seq - y.seq);
  const computed = ingestContentHash(full);
  if (computed !== b.contentHash) throw new ApiError('VALIDATION_ERROR', 'contentHash가 메시지와 맞지 않아요.', { field: 'contentHash', computed });

  // 늦게 온 옛 스냅샷(오프라인 재전송) — 무시
  if (ex && ex.ingest_captured_at && Date.parse(ex.ingest_captured_at) > Date.parse(b.capturedAt) && full.length < Number(ex.message_count))
    return { status: 200, body: resp('stale', ex.id, 'not_needed') };
  // 2026-10-16: 내보내기(또는 다른 경로)로만 있던 대화에 처음 온 화면 스냅샷이 더 짧으면(화면이 일부만 그렸거나 내보내기에만 있는 메시지) 덮어쓰지 않는다 — 기존 메시지 삭제 방지
  if (ex && !ex.ingest_captured_at && b.mode === 'full' && full.length < Number(ex.message_count)) {
    console.log(`[subbrain] 확장 수집 건너뜀: ${b.sourceAi} ${b.sourceId.slice(0, 8)} 화면 ${full.length}개 < 저장된 ${ex.message_count}개(기존 메시지 보호)`);
    return { status: 200, body: resp('stale', ex.id, 'not_needed') };
  }

  const r = upsertConversation(core, {
    sourceAi: b.sourceAi as 'chatgpt', sourceId: b.sourceId, url: b.url, title: b.title || '(제목 없음)', createdAt: full[0]?.createdAt ?? null, updatedAt: b.serviceUpdatedAt ?? full.at(-1)?.createdAt ?? b.capturedAt,
    archived: false, inServiceProject: !!b.project, hasUnextractedArtifact: false,
    messages: full.map((m) => { const x = redactSecrets(m.contentMd); return { role: m.role, content: x.text, createdAt: m.createdAt, voice: m.voice }; }),
  }, { importId: null, rawPath: null, captureMethod: b.captureMethod });
  rawCache.set(r.conversationId, full);
  db.tx(() => {
    db.run('UPDATE conversations SET ingest_hash=?, ingest_captured_at=?, ingest_partial=?, service_updated_at=COALESCE(?, service_updated_at) WHERE id=?', b.contentHash, b.capturedAt, b.complete ? 0 : 1, b.serviceUpdatedAt, r.conversationId);
    full.forEach((m, i) => { if (m.externalId) db.run('UPDATE messages SET external_id=? WHERE conversation_id=? AND seq=?', m.externalId, r.conversationId, i + 1); });
    db.run('INSERT OR REPLACE INTO ingest_keys(key, conversation_id, status, token_id, at) VALUES (?,?,?,?,?)', key, r.conversationId, b.complete ? 'accepted' : 'partial', opts.tokenId ?? null, receivedAt);
    db.run("UPDATE catchup_items SET fulfilled_at=?, service_updated_at=COALESCE(?, service_updated_at) WHERE source_ai=? AND source_id=?", receivedAt, b.serviceUpdatedAt, b.sourceAi, b.sourceId);
    addMethod(core, b.sourceAi, b.captureMethod);
    db.run('UPDATE sync_state SET last_snapshot_at=?, last_import_at=?, adapter_version=COALESCE(?, adapter_version), adapter_name=COALESCE(?, adapter_name) WHERE source_ai=?', receivedAt, receivedAt, b.adapter.version, b.adapter.name, b.sourceAi);
  });
  const deb = debouncerFor(core);
  if (b.complete || r.state === 'new') console.log(`[subbrain] 확장 수집: ${b.sourceAi} ${b.sourceId.slice(0, 8)} 메시지 ${full.length}개 · ${r.state} · ${b.captureMethod}`);
  if (r.state === 'unchanged') return { status: 200, body: resp('duplicate', r.conversationId, 'not_needed') };
  if (!b.complete) { deb.schedule(r.conversationId, true); return { status: 202, body: resp('partial', r.conversationId, 'skipped') }; }
  deb.schedule(r.conversationId, false);
  return { status: 202, body: resp('accepted', r.conversationId, !ingestAutoClassify() ? 'skipped' : deb.ms <= 0 ? 'queued' : 'debounced') };
}
/** append 해시 검증용 원문 사본(가리기 전). 프로세스 메모리에만 — 재시작 뒤 append가 BASE_MISMATCH면 확장이 full로 다시 보냄 */
const rawCache = new Map<string, IngestMessage[]>();

export function ingestReplay(core: Core, b: IngestReplayBody, tokenId: string | null): IngestReplayResponse {
  const order = b.snapshots.map((s, i) => ({ s, i })).sort((x, y) => x.s.capturedAt.localeCompare(y.s.capturedAt)); // 오래된 것부터 처리
  const out = new Map<number, IngestReplayResponse['results'][number]>();
  for (const { s, i } of order) {
    try { out.set(i, { index: i, ok: true, result: ingestSnapshot(core, s, { tokenId }).body }); }
    catch (e) {
      const err = e instanceof ApiError ? e : new ApiError('INTERNAL', e instanceof Error ? e.message : String(e));
      out.set(i, { index: i, ok: false, error: { error: { code: err.code, message: err.message, details: err.details ?? {}, requestId: '' } } as ApiErrorShape });
    }
  }
  return { results: b.snapshots.map((_, i) => out.get(i)!) };
}

export const CATCHUP_MAX_FETCH_PER_MIN = 6;
export const CATCHUP_SCAN_INTERVAL_MS = 10 * 60_000;
const RETRY_AFTER_MS = 60 * 60_000;
const UNKNOWN_EVERY_MS = 24 * 60 * 60_000;

export function catchupDiff(core: Core, b: CatchupDiffBody): CatchupDiffResponse {
  b = { ...b, items: b.items.map((it) => ({ ...it, updatedAt: normalizeIso(it.updatedAt) })) };
  const db = core.db;
  const nowS = nowIso(), now = new Date(Date.parse(nowS));
  const T = (x: string | null | undefined) => (x ? Date.parse(x) : 0);
  ensureSync(core, b.sourceAi);
  const stored = str(db.value<string>('SELECT cursor FROM sync_state WHERE source_ai=?', b.sourceAi));
  const page = b.cursor ? (() => { try { return JSON.parse(Buffer.from(b.cursor, 'base64url').toString()) as { p: number; max: string | null; startedAt: string }; } catch { throw new ApiError('VALIDATION_ERROR', 'cursor가 잘못됐어요.', { field: 'cursor' }); } })() : { p: 0, max: null as string | null, startedAt: nowS };
  const fetch: CatchupDiffResponse['fetch'] = [];
  let skipped = 0, max = page.max;
  db.tx(() => {
    for (const it of b.items) {
      if (it.updatedAt && (!max || T(it.updatedAt) > T(max))) max = it.updatedAt;
      const conv = db.get<{ updated_at: string; service_updated_at: string | null; ingest_partial: number }>('SELECT updated_at, service_updated_at, ingest_partial FROM conversations WHERE source_ai=? AND source_id=?', b.sourceAi, it.sourceId);
      const ci = db.get<{ requested_at: string | null; fulfilled_at: string | null; unknown_checked_at: string | null }>('SELECT requested_at, fulfilled_at, unknown_checked_at FROM catchup_items WHERE source_ai=? AND source_id=?', b.sourceAi, it.sourceId);
      db.run('INSERT INTO catchup_items(source_ai, source_id, title, seen_at) VALUES (?,?,?,?) ON CONFLICT(source_ai, source_id) DO UPDATE SET title=excluded.title, seen_at=excluded.seen_at', b.sourceAi, it.sourceId, it.title, nowS);
      let reason: CatchupDiffResponse['fetch'][number]['reason'] | null = null;
      const waiting = !!ci?.requested_at && (!ci.fulfilled_at || T(ci.fulfilled_at) < T(ci.requested_at));
      const pendingFailed = waiting && now.getTime() - T(ci!.requested_at) > RETRY_AFTER_MS;
      if (pendingFailed) reason = 'retry';
      else if (waiting) reason = null; // 방금 요청함 — 기다림
      else if (!conv) reason = 'new';
      else if (!it.updatedAt) reason = !ci?.unknown_checked_at || now.getTime() - Date.parse(ci.unknown_checked_at) > UNKNOWN_EVERY_MS ? 'unknown_time' : null;
      else if (T(it.updatedAt) > T(conv.service_updated_at ?? conv.updated_at) || conv.ingest_partial) reason = 'updated';
      if (reason) {
        fetch.push({ sourceId: it.sourceId, reason });
        db.run('UPDATE catchup_items SET requested_at=?, requested_reason=?, unknown_checked_at=CASE WHEN ?=1 THEN ? ELSE unknown_checked_at END WHERE source_ai=? AND source_id=?', nowS, reason, reason === 'unknown_time' ? 1 : 0, nowS, b.sourceAi, it.sourceId);
      } else skipped++;
    }
    if (b.endOfList) db.run('UPDATE sync_state SET cursor=?, last_sidebar_scan_at=? WHERE source_ai=?', max ?? stored, nowS, b.sourceAi);
    else db.run('UPDATE sync_state SET last_sidebar_scan_at=? WHERE source_ai=?', nowS, b.sourceAi);
  });
  const cursor = Buffer.from(JSON.stringify({ p: page.p + 1, max, startedAt: page.startedAt })).toString('base64url');
  return { fetch, skipped, cursor, stopBefore: stored, rate: { maxFetchPerMinute: CATCHUP_MAX_FETCH_PER_MIN, nextScanAfter: new Date(now.getTime() + CATCHUP_SCAN_INTERVAL_MS).toISOString() } };
}

function syncItem(core: Core, ai: string): SyncStateItem {
  const db = core.db;
  const r = db.get<Record<string, unknown>>('SELECT * FROM sync_state WHERE source_ai=?', ai)!;
  return {
    sourceAi: ai as SyncStateItem['sourceAi'], cursor: str(r.cursor as string), lastScanAt: str(r.last_sidebar_scan_at as string), lastSnapshotAt: str(r.last_snapshot_at as string),
    knownConversations: Number(db.value('SELECT COUNT(*) FROM conversations WHERE source_ai=?', ai) ?? 0),
    pendingFetch: db.all<{ r: string; f: string | null }>('SELECT requested_at r, fulfilled_at f FROM catchup_items WHERE source_ai=? AND requested_at IS NOT NULL', ai).filter((x) => !x.f || Date.parse(x.f) < Date.parse(x.r)).length,
    health: r.health_at ? (r.adapter_health as SyncStateItem['health']) : null, healthAt: str(r.health_at as string),
    adapter: r.adapter_name ? { name: String(r.adapter_name), version: String(r.adapter_version ?? '') } : null,
    errorCode: str(r.error_code as string), bufferedSnapshots: Number(r.buffered_snapshots ?? 0),
  };
}
export function syncState(core: Core): SyncStateResponse {
  return { sources: core.db.all<{ source_ai: string }>('SELECT source_ai FROM sync_state ORDER BY source_ai').map((r) => syncItem(core, r.source_ai)) };
}
const HEALTH_MSG: Record<string, string> = { SELECTOR_NOT_FOUND: '화면 구조가 바뀌어 대화를 못 읽어요(확장 업데이트 필요)', LOGGED_OUT: '서비스에서 로그아웃돼 있어요', RATE_LIMITED: '서비스가 요청을 잠시 막았어요' };
export function adapterHealth(core: Core, ai: string, b: AdapterHealthBody): AdapterHealthResponse {
  if (!['chatgpt', 'claude', 'gemini', 'grok'].includes(ai)) throw new ApiError('VALIDATION_ERROR', `알 수 없는 AI예요: ${ai}`, { field: 'ai' });
  ensureSync(core, ai);
  addMethod(core, ai, 'extension_live');
  const failed = b.checks.filter((c) => !c.ok).map((c) => c.name);
  const note = b.health === 'ok' ? null : (b.errorCode && HEALTH_MSG[b.errorCode]) || (failed.length ? `확인 실패: ${failed.join(', ')}` : '확장 상태 주의');
  core.db.run('UPDATE sync_state SET adapter_health=?, health_at=?, adapter_name=?, adapter_version=?, selectors_version=COALESCE(?, selectors_version), error_code=?, buffered_snapshots=?, checks_json=?, notes=? WHERE source_ai=?',
    b.health, normalizeIso(b.at), b.adapter.name, b.adapter.version, b.adapter.domVersion ?? null, b.errorCode ?? null, b.bufferedSnapshots ?? 0, JSON.stringify(b.checks), note, ai);
  return { recorded: true, state: syncItem(core, ai), collection: collectionStatus(core).find((s) => s.sourceAi === ai)! };
}
