/**
 * 채팅창 정리 (Phase 6 미리보기, 설계서 §10.6 · §11, 자동화 설계 §8) — 웹 담당이 따로 붙인 모듈.
 *
 * 켜는 법: 환경변수 SUBBRAIN_CLEANUP=preview  (기본 꺼짐 → 예전처럼 cleanup:null, /deletion-batches/* 501)
 *
 * 하는 일 (L3 중 "되돌릴 수 있는 것"까지만):
 *  1. 정리 후보 계산: 완료·간단한 질문·보관 과제의 주 대화, 끝난 지 유예 기간(기본 7일) 지남, 제외 조건(§11.2) 통과
 *  2. 자동 내보내기: 후보 대화의 원문(DB 메시지 전부)을 <home>/cleanup/exports/<배치>/<대화>.json 으로 쓰고 sha256을 manifest에 기록
 *     → 그룹의 backupVerified = 파일이 있고 해시·메시지 수가 맞을 때만 true
 *  3. 자동 보관(되돌릴 수 있음): ChatGPT 대화는 삭제가 아니라 "보관 대기"로 둔다. /archive/undo 로 언제든 되돌림
 *  4. 되돌릴 수 없는 삭제(Claude·Gemini·Grok 등): 하루 한 번 승인. 승인 = **표시만**(state approved, mode mark_only)
 *     승인 직전 DB를 VACUUM INTO 로 백업(db_backup_ref).
 *
 * 하지 않는 일: 서비스(ChatGPT·Claude…)에서 실제로 보관·삭제하는 실행기는 없다. conversations.service_state 도 바꾸지 않는다.
 * 내부(비공개) API는 쓰지 않는다. 스키마 변경 없음 — 기존 deletion_batches · deletion_items 테이블만 쓴다.
 *
 * deletion_items.state 값
 *   삭제 후보: proposed(선택) · excluded(사용자가 뺌) · approved(승인 표시, 실행 전) · kept(승인 때 빠져 남김)
 *   보관 후보: archive_queued(보관 대기, 되돌릴 수 있음) · archive_undone(보관 해제 → 앞으로 후보에서 뺌)
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeletionBatch, DigestCleanup, SourceAi } from '@subbrain/shared';
import { SOURCE_AI_LABEL } from '@subbrain/shared/constants';
import type { Core } from '../core.ts';
import { ApiError, conflict, notFound } from '../util/errors.ts';
import { daysBetween, kstDate, nowIso, today } from '../util/time.ts';
import { loadTasks } from '../services/tasks.ts';

export const cleanupEnabled = (): boolean => process.env.SUBBRAIN_CLEANUP === 'preview';
/** 유예 기간 기본 7일 — 사용자 결정(2026-10-19): 끝난 대화는 7일 지나야 삭제 후보. 환경변수로만 바꿀 수 있음 */
export const DEFAULT_GRACE_DAYS = 7;
export const graceDays = (): number => { const v = process.env.SUBBRAIN_CLEANUP_GRACE_DAYS; const n = v === undefined || v === '' ? DEFAULT_GRACE_DAYS : Number(v); return Number.isFinite(n) && n >= 0 ? n : DEFAULT_GRACE_DAYS; };
const BATCH_CAP = 200;
const PER_ITEM_SEC = 4;
/** 되돌릴 수 있는 정리(보관)를 쓰는 서비스. 나머지는 되돌릴 수 없는 삭제 → 승인 필요 (Grok 30일 복구는 미검증이라 삭제로 취급) */
const ARCHIVE_SERVICES: ReadonlySet<string> = new Set(['chatgpt']);
/** 채팅창이 있는 웹 서비스만 (로컬 세션 수집 claude-code·codex, Grok Bot 등은 정리 대상 아님) */
const WEB_SERVICES: ReadonlySet<string> = new Set(['chatgpt', 'claude', 'gemini', 'grok']);
const SKIP_STATES = ['approved', 'kept', 'archive_queued', 'archive_undone'];

export const batchIdFor = (date: string) => `del_${date.replace(/-/g, '')}`;
const exportDir = (core: Core, batchId: string) => join(core.home, 'cleanup', 'exports', batchId);
const sha = (s: string | Buffer) => 'sha256:' + createHash('sha256').update(s).digest('hex');
function audit(core: Core, entry: Record<string, unknown>) {
  try { mkdirSync(join(core.home, 'cleanup'), { recursive: true }); appendFileSync(join(core.home, 'cleanup', 'audit.jsonl'), JSON.stringify({ at: nowIso(), ...entry }) + '\n'); } catch { /* 기록 실패는 무시 */ }
}

interface ItemRow { id: number; batch_id: string; conversation_id: string; expected_source_id: string | null; expected_url: string | null; expected_message_count: number | null; expected_hash: string | null; state: string; reason: string | null; source_ai: string; title: string | null; updated_at: string | null; kind_label: string | null }
interface Manifest { batchId: string; createdAt: string; files: Record<string, { file: string; sha256: string; messageCount: number }> }

export interface CleanupArchiveItem { itemId: number; conversationId: string; sourceAi: SourceAi; title: string; date: string; reason: string; state: 'archive_queued' | 'archive_undone' }
export interface CleanupBatchDetail {
  batch: DeletionBatch;
  /** 항목별 "왜 정리 후보인지" (itemId → 문장) */
  reasons: Record<string, string>;
  /** 자동 보관(되돌릴 수 있음) 항목 — ChatGPT */
  archive: CleanupArchiveItem[];
  mode: 'mark_only';
  executor: 'off';
  approvedAt: string | null;
  dbBackupRef: string | null;
  exportDir: string;
}

// ───────── 1. 후보 계산
interface Candidate { conversationId: string; sourceAi: string; sourceId: string; url: string | null; title: string; messageCount: number; contentHash: string | null; kindLabel: string; doneDate: string; reason: string }
interface Excluded { sourceAi: string | null; reason: string }

export function computeCandidates(core: Core, date = today()): { candidates: Candidate[]; excluded: Excluded[] } {
  const db = core.db;
  const grace = graceDays();
  const tasks = loadTasks(core);
  const statusOfTask = new Map(tasks.map((t) => [t.id, t.status]));
  const health = new Map(db.all<{ source_ai: string; adapter_health: string }>('SELECT source_ai, adapter_health FROM sync_state').map((r) => [r.source_ai, r.adapter_health]));
  const skip = new Set(db.all<{ conversation_id: string }>(`SELECT DISTINCT conversation_id FROM deletion_items WHERE state IN (${SKIP_STATES.map(() => '?').join(',')})`, ...SKIP_STATES).map((r) => r.conversation_id));
  const links = new Map<string, string[]>();
  for (const r of db.all<{ conversation_id: string; task_id: string }>('SELECT conversation_id, task_id FROM task_conversations')) { const a = links.get(r.conversation_id) ?? []; a.push(r.task_id); links.set(r.conversation_id, a); }
  const msgCount = new Map(db.all<{ conversation_id: string; n: number }>('SELECT conversation_id, COUNT(*) AS n FROM messages GROUP BY conversation_id').map((r) => [r.conversation_id, Number(r.n)]));
  const flags = new Map(db.all<{ id: string; pin: number; is_shared: number; in_service_project: number; has_unextracted_artifact: number; content_hash: string | null }>('SELECT id, pin, is_shared, in_service_project, has_unextracted_artifact, content_hash FROM conversations').map((r) => [r.id, r]));
  const candidates: Candidate[] = []; const excluded: Excluded[] = []; const seen = new Set<string>();
  for (const t of tasks) {
    if (t.status !== '완료' && t.status !== '간단한 질문' && t.status !== '보관') continue;
    const kindLabel = t.status === '보관' ? '보관한 과제' : t.kind === 'quick_question' || t.status === '간단한 질문' ? '간단한 질문' : '완료';
    const doneAt = t.completedAt ?? t.lastActivityAt;
    for (const c of t.primary) {
      if (seen.has(c.id)) continue; seen.add(c.id);
      if (!WEB_SERVICES.has(c.sourceAi) || c.serviceState !== 'active' || skip.has(c.id)) continue;
      const lastAt = [doneAt, c.updatedAt].filter((x): x is string => !!x).sort().pop() ?? null;
      const doneDate = lastAt ? kstDate(lastAt) : date;
      const age = daysBetween(doneDate, date);
      const ex = (reason: string) => excluded.push({ sourceAi: c.sourceAi, reason });
      const f = flags.get(c.id);
      if (age < grace) { ex(`끝난 지 ${grace}일이 안 됨 (유예 기간)`); continue; }
      if (t.pin || f?.pin) { ex('‘절대 삭제 안 함’ 표시'); continue; }
      if ((links.get(c.id) ?? []).some((tid) => tid !== t.id && (statusOfTask.get(tid) === '진행 중' || statusOfTask.get(tid) === '멈춤'))) { ex('진행 중·멈춤 과제와 함께 쓰는 대화'); continue; }
      if (f?.is_shared) { ex('공유 링크가 있음'); continue; }
      if (f?.in_service_project) { ex('서비스 안 프로젝트 폴더'); continue; }
      if (f?.has_unextracted_artifact) { ex('수집하지 못한 첨부·캔버스가 있음'); continue; }
      if (t.confidence !== null && t.confidence < 0.6) { ex('분류 확신도가 낮음 (0.6 미만)'); continue; }
      const h = health.get(c.sourceAi); if (h && h !== 'ok') { ex('수집 상태 점검 중'); continue; }
      if (!c.sourceId || !c.url) { ex('대화 주소가 없어 대조할 수 없음'); continue; }
      const n = msgCount.get(c.id) ?? 0;
      if (n === 0 || n !== c.messageCount) { ex('저장된 메시지 수가 맞지 않음'); continue; }
      const action = ARCHIVE_SERVICES.has(c.sourceAi) ? '보관' : '삭제';
      candidates.push({
        conversationId: c.id, sourceAi: c.sourceAi, sourceId: c.sourceId, url: c.url, title: c.title || t.title, messageCount: c.messageCount, contentHash: f?.content_hash ?? null, kindLabel, doneDate,
        reason: `${kindLabel} · ${+doneDate.slice(5, 7)}월 ${+doneDate.slice(8, 10)}일 이후 ${age}일 동안 새 메시지 없음 · 메시지 ${n}개 원문 저장됨 · ${action === '보관' ? '보관만(되돌릴 수 있음)' : '되돌릴 수 없는 삭제 → 승인 필요'}`,
      });
    }
  }
  candidates.sort((a, b) => a.sourceAi.localeCompare(b.sourceAi) || b.doneDate.localeCompare(a.doneDate));
  // 한 배치 상한은 되돌릴 수 없는 삭제 후보에만 (보관은 되돌릴 수 있어 상한 밖)
  let del = 0; const kept: Candidate[] = [];
  for (const c of candidates) {
    if (ARCHIVE_SERVICES.has(c.sourceAi)) { kept.push(c); continue; }
    if (++del > BATCH_CAP) { excluded.push({ sourceAi: c.sourceAi, reason: `한 배치 상한(${BATCH_CAP}개) 초과 — 다음 배치로` }); continue; }
    kept.push(c);
  }
  return { candidates: kept, excluded };
}

// ───────── 2. 자동 내보내기 (원문 사본 + 해시)
function exportConversations(core: Core, batchId: string, convIds: string[]): Manifest {
  const dir = exportDir(core, batchId); mkdirSync(dir, { recursive: true });
  const m: Manifest = { batchId, createdAt: nowIso(), files: {} };
  for (const id of convIds) {
    const conv = core.db.get('SELECT id, source_ai, source_id, source_url, title, created_at, updated_at, message_count, content_hash, capture_method FROM conversations WHERE id=?', id);
    const messages = core.db.all('SELECT seq, role, content_md, created_at FROM messages WHERE conversation_id=? ORDER BY seq', id);
    const body = JSON.stringify({ exportedAt: m.createdAt, batchId, conversation: conv, messages }, null, 1);
    const file = `${id.replace(/[^\w.-]/g, '_')}.json`;
    writeFileSync(join(dir, file), body);
    m.files[id] = { file, sha256: sha(body), messageCount: messages.length };
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m, null, 1));
  return m;
}
function readManifest(core: Core, batchId: string): Manifest | null {
  try { return JSON.parse(readFileSync(join(exportDir(core, batchId), 'manifest.json'), 'utf8')) as Manifest; } catch { return null; }
}
/** 내보낸 파일이 그대로 있고(해시) 메시지 수가 DB와 같은지 */
function verifiedSet(core: Core, batchId: string, rows: ItemRow[]): Set<string> {
  const m = readManifest(core, batchId); const ok = new Set<string>(); if (!m) return ok;
  for (const r of rows) {
    const e = m.files[r.conversation_id]; if (!e) continue;
    const p = join(exportDir(core, batchId), e.file); if (!existsSync(p)) continue;
    if (sha(readFileSync(p)) !== e.sha256) continue;
    const n = core.db.value<number>('SELECT COUNT(*) FROM messages WHERE conversation_id=?', r.conversation_id) ?? 0;
    if (n === e.messageCount && n === (r.expected_message_count ?? -1)) ok.add(r.conversation_id);
  }
  return ok;
}

// ───────── 3. 하루 배치 만들기 (매일 요약 때 자동 · POST /cleanup/run 으로 따라잡기)
export function ensureDailyBatch(core: Core, date = today()): { batchId: string | null; created: boolean } {
  const id = batchIdFor(date);
  if (core.db.get('SELECT 1 FROM deletion_batches WHERE id=?', id)) return { batchId: id, created: false };
  // 손대지 않은 지난 배치는 닫는다(cancelled = 지운 것 없음). 그 삭제 후보는 오늘 배치에 다시 오른다. 보관 항목은 그대로 유지.
  const stale = core.db.all<{ id: string }>("SELECT id FROM deletion_batches WHERE state='pending' AND id < ?", id);
  for (const s of stale) core.db.run("UPDATE deletion_batches SET state='cancelled' WHERE id=?", s.id);
  if (stale.length) audit(core, { op: 'batches_superseded', batchIds: stale.map((s) => s.id), by: id });
  const { candidates, excluded } = computeCandidates(core, date);
  if (!candidates.length && !excluded.length) return { batchId: null, created: false };
  const manifest = exportConversations(core, id, candidates.map((c) => c.conversationId));
  core.db.tx(() => {
    core.db.run("INSERT INTO deletion_batches(id, created_at, state, mode) VALUES (?, ?, 'pending', 'mark_only')", id, nowIso());
    for (const c of candidates) {
      const st = ARCHIVE_SERVICES.has(c.sourceAi) ? 'archive_queued' : 'proposed';
      core.db.run('INSERT INTO deletion_items(batch_id, conversation_id, expected_source_id, expected_url, expected_message_count, expected_hash, state, reason) VALUES (?,?,?,?,?,?,?,?)',
        id, c.conversationId, c.sourceId, c.url, manifest.files[c.conversationId]?.messageCount ?? c.messageCount, c.contentHash, st, JSON.stringify({ text: c.reason, kindLabel: c.kindLabel, date: c.doneDate }));
    }
    // 자동 제외는 항목이 아니라 배치 메모 파일로 (같은 사유끼리 묶어 요약에 보여 줌)
    writeFileSync(join(exportDir(core, id), 'excluded.json'), JSON.stringify(excluded));
  });
  audit(core, { op: 'batch_created', batchId: id, candidates: candidates.length, excluded: excluded.length });
  return { batchId: id, created: true };
}

// ───────── 4. 읽기 (요약 cleanup · GET /deletion-batches/:id)
function itemRows(core: Core, batchId: string): ItemRow[] {
  return core.db.all<ItemRow>('SELECT di.*, c.source_ai, c.title, c.updated_at FROM deletion_items di JOIN conversations c ON c.id=di.conversation_id WHERE di.batch_id=? ORDER BY c.source_ai, di.id', batchId);
}
const meta = (r: ItemRow) => { try { return JSON.parse(r.reason ?? '{}') as { text?: string; kindLabel?: string; date?: string }; } catch { return { text: r.reason ?? '' }; } };

export function batchDetail(core: Core, batchId: string): CleanupBatchDetail {
  const b = core.db.get<{ id: string; state: string; approved_at: string | null; db_backup_ref: string | null }>('SELECT id, state, approved_at, db_backup_ref FROM deletion_batches WHERE id=?', batchId);
  if (!b) throw notFound('삭제 배치', batchId);
  const rows = itemRows(core, batchId);
  const verified = verifiedSet(core, batchId, rows);
  const del = rows.filter((r) => !r.state.startsWith('archive_'));
  const groups = new Map<string, DeletionBatch['groups'][number]>();
  const reasons: Record<string, string> = {};
  for (const r of del) {
    const m = meta(r);
    const g = groups.get(r.source_ai) ?? { sourceAi: r.source_ai as SourceAi, selected: 0, total: 0, backupVerified: true, items: [] };
    const selected = r.state === 'proposed' || r.state === 'approved';
    groups.set(r.source_ai, g);
    g.total++; if (selected) g.selected++;
    if (selected && !verified.has(r.conversation_id)) g.backupVerified = false;
    g.items.push({ itemId: r.id, conversationId: r.conversation_id, title: r.title ?? '(제목 없음)', kindLabel: m.kindLabel ?? '완료', date: m.date ?? (r.updated_at ? kstDate(r.updated_at) : today()), selected, excludedByUser: r.state === 'excluded' || r.state === 'kept' });
    reasons[String(r.id)] = (m.text ?? '') + (verified.has(r.conversation_id) ? '' : ' · ⚠ 내보낸 원문 확인 실패');
  }
  let excluded: Excluded[] = [];
  try { excluded = JSON.parse(readFileSync(join(exportDir(core, batchId), 'excluded.json'), 'utf8')) as Excluded[]; } catch { /* 없음 */ }
  const ex = new Map<string, { count: number; sourceAi: SourceAi | null; reason: string }>();
  for (const e of excluded) { const k = `${e.sourceAi ?? ''}|${e.reason}`; const cur = ex.get(k) ?? { count: 0, sourceAi: (e.sourceAi as SourceAi | null) ?? null, reason: e.reason }; cur.count++; ex.set(k, cur); }
  const selectedCount = [...groups.values()].reduce((s, g) => s + g.selected, 0);
  const totalMin = Math.max(1, Math.ceil((selectedCount * PER_ITEM_SEC) / 60));
  const state = (['pending', 'approved', 'running', 'paused', 'postponed', 'done', 'cancelled'].includes(b.state) ? b.state : 'pending') as DeletionBatch['state'];
  const archive: CleanupArchiveItem[] = rows.filter((r) => r.state.startsWith('archive_')).map((r) => {
    const m = meta(r);
    return { itemId: r.id, conversationId: r.conversation_id, sourceAi: r.source_ai as SourceAi, title: r.title ?? '(제목 없음)', date: m.date ?? today(), reason: m.text ?? '', state: r.state as CleanupArchiveItem['state'] };
  });
  return {
    batch: {
      id: b.id, state, selectedCount, candidateCount: del.length,
      groups: [...groups.values()],
      autoExcluded: [...ex.values()].sort((a, z) => z.count - a.count),
      estimate: { perItemSec: PER_ITEM_SEC, totalMin, label: `실행기 준비 전 · 건당 약 ${PER_ITEM_SEC}초 · 약 ${totalMin}분 예상` },
    },
    reasons, archive, mode: 'mark_only', executor: 'off', approvedAt: b.approved_at, dbBackupRef: b.db_backup_ref, exportDir: exportDir(core, batchId),
  };
}

/** 요약(digest)의 cleanup 칸 — 그날 배치가 없으면 null */
export function cleanupForDigest(core: Core, date: string): DigestCleanup | null {
  const id = batchIdFor(date);
  if (!core.db.get('SELECT 1 FROM deletion_batches WHERE id=?', id)) return null;
  const d = batchDetail(core, id);
  const byAi = new Map<SourceAi, number>();
  for (const a of d.archive) if (a.state === 'archive_queued') byAi.set(a.sourceAi, (byAi.get(a.sourceAi) ?? 0) + 1);
  return {
    autoArchived: [...byAi.entries()].map(([sourceAi, count]) => ({ sourceAi, count, note: `언제든 보관 해제 가능 · 실행기가 꺼져 있어 ${SOURCE_AI_LABEL[sourceAi] ?? sourceAi} 화면은 아직 그대로` })),
    deletionBatch: d.batch.candidateCount || d.batch.autoExcluded.length ? d.batch : null,
  };
}

// ───────── 5. 쓰기
function mustPending(core: Core, id: string) {
  const b = core.db.get<{ state: string }>('SELECT state FROM deletion_batches WHERE id=?', id);
  if (!b) throw notFound('삭제 배치', id);
  if (b.state !== 'pending') throw conflict(`이미 ${b.state === 'approved' ? '승인한' : b.state === 'postponed' ? '내일로 미룬' : '닫힌'} 배치예요.`, { state: b.state });
}

export function setItemSelected(core: Core, batchId: string, itemId: number, selected: boolean): CleanupBatchDetail {
  mustPending(core, batchId);
  const r = core.db.get<{ state: string }>('SELECT state FROM deletion_items WHERE id=? AND batch_id=?', itemId, batchId);
  if (!r || r.state.startsWith('archive_')) throw notFound('삭제 항목', String(itemId), 'itemId');
  core.db.run('UPDATE deletion_items SET state=? WHERE id=?', selected ? 'proposed' : 'excluded', itemId);
  return batchDetail(core, batchId);
}

export function approveBatch(core: Core, batchId: string, body: { expectedSelectedCount: number; excludedItemIds: number[]; confirmPhrase?: string }): CleanupBatchDetail {
  mustPending(core, batchId);
  const before = batchDetail(core, batchId);
  core.db.tx(() => {
    for (const id of body.excludedItemIds) core.db.run("UPDATE deletion_items SET state='excluded' WHERE id=? AND batch_id=? AND state='proposed'", id, batchId);
    const n = core.db.value<number>("SELECT COUNT(*) FROM deletion_items WHERE batch_id=? AND state='proposed'", batchId) ?? 0;
    if (n !== body.expectedSelectedCount) throw conflict(`화면이 오래됐어요: 선택 수가 ${body.expectedSelectedCount}개가 아니라 ${n}개예요. 다시 확인해 주세요.`, { expected: body.expectedSelectedCount, actual: n });
    if (n === 0) throw new ApiError('VALIDATION_ERROR', '승인할 항목이 없어요.', { issues: [{ path: 'expectedSelectedCount', message: '0개' }] });
  });
  const after = batchDetail(core, batchId);
  const bad = after.batch.groups.filter((g) => g.selected > 0 && !g.backupVerified);
  if (bad.length) throw conflict(`원문 저장을 확인하지 못한 묶음이 있어요: ${bad.map((g) => SOURCE_AI_LABEL[g.sourceAi] ?? g.sourceAi).join(', ')}`, { groups: bad.map((g) => g.sourceAi) });
  // 승인 직전 DB 백업 (§11.4)
  const dir = join(core.home, 'backups'); mkdirSync(dir, { recursive: true });
  const ref = join(dir, `pre-deletion-${batchId}-${nowIso().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}.db`);
  core.db.run(`VACUUM INTO '${ref.replace(/'/g, "''")}'`);
  core.db.tx(() => {
    const n = core.db.run("UPDATE deletion_items SET state='approved' WHERE batch_id=? AND state='proposed'", batchId).changes;
    core.db.run("UPDATE deletion_items SET state='kept' WHERE batch_id=? AND state='excluded'", batchId);
    core.db.run("UPDATE deletion_batches SET state='approved', approved_at=?, approved_count=?, confirm_phrase=?, mode='mark_only', db_backup_ref=? WHERE id=?", nowIso(), n, body.confirmPhrase ?? null, ref, batchId);
  });
  audit(core, { op: 'batch_approved_mark_only', batchId, approved: after.batch.selectedCount, before: before.batch.selectedCount, dbBackupRef: ref });
  return batchDetail(core, batchId);
}

export function postponeBatch(core: Core, batchId: string): CleanupBatchDetail {
  mustPending(core, batchId);
  core.db.run("UPDATE deletion_batches SET state='postponed' WHERE id=?", batchId);
  audit(core, { op: 'batch_postponed', batchId });
  return batchDetail(core, batchId);
}

/** 보관 되돌리기(undo=true) · 다시 보관(undo=false). 아무 배치의 보관 항목이든 itemId로 */
export function setArchive(core: Core, itemIds: number[], undo: boolean): { changed: number; batchIds: string[] } {
  let changed = 0; const batches = new Set<string>();
  core.db.tx(() => {
    for (const id of itemIds) {
      const r = core.db.get<{ batch_id: string; state: string }>('SELECT batch_id, state FROM deletion_items WHERE id=?', id);
      if (!r || !r.state.startsWith('archive_')) throw notFound('보관 항목', String(id), 'itemId');
      const to = undo ? 'archive_undone' : 'archive_queued';
      if (r.state !== to) { core.db.run('UPDATE deletion_items SET state=? WHERE id=?', to, id); changed++; }
      batches.add(r.batch_id);
    }
  });
  audit(core, { op: undo ? 'archive_undo' : 'archive_redo', itemIds, changed });
  return { changed, batchIds: [...batches] };
}

/** 보관 항목 전부 (모든 배치, 최근 것부터) — 웹의 "보관 목록" */
export function listArchive(core: Core): CleanupArchiveItem[] {
  return core.db.all<ItemRow>("SELECT di.*, c.source_ai, c.title, c.updated_at FROM deletion_items di JOIN conversations c ON c.id=di.conversation_id WHERE di.state IN ('archive_queued','archive_undone') ORDER BY di.batch_id DESC, di.id")
    .map((r) => { const m = meta(r); return { itemId: r.id, conversationId: r.conversation_id, sourceAi: r.source_ai as SourceAi, title: r.title ?? '(제목 없음)', date: m.date ?? today(), reason: m.text ?? '', state: r.state as CleanupArchiveItem['state'] }; });
}

export function cleanupStatus(core: Core) {
  const latest = core.db.get<{ id: string; state: string; created_at: string }>('SELECT id, state, created_at FROM deletion_batches ORDER BY id DESC LIMIT 1');
  return {
    enabled: cleanupEnabled(), level: 'L3' as const, mode: 'mark_only' as const, executor: 'off' as const, graceDays: graceDays(), batchCap: BATCH_CAP,
    archiveServices: [...ARCHIVE_SERVICES], todayBatchId: core.db.get('SELECT 1 FROM deletion_batches WHERE id=?', batchIdFor(today())) ? batchIdFor(today()) : null,
    latestBatch: latest ? { id: latest.id, state: latest.state, createdAt: latest.created_at } : null,
    note: '승인은 표시만 해요. ChatGPT·Claude 등 서비스에서 실제로 보관·삭제하는 실행기는 아직 없어요.',
  };
}
