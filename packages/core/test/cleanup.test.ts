/**
 * 채팅창 정리 미리보기 (src/cleanup, SUBBRAIN_CLEANUP=preview) — 승인은 표시만, 서비스 쪽은 건드리지 않음
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as S from '@subbrain/shared/schemas';
import { makeCore } from './helpers.ts';
import { generateDigest } from '../src/digest/digest.ts';
import { setNow } from '../src/util/time.ts';

type T = Awaited<ReturnType<typeof makeCore>>;
let t: T | null = null;
const prev = process.env.SUBBRAIN_CLEANUP;
beforeEach(() => { process.env.SUBBRAIN_CLEANUP = 'preview'; });
afterEach(() => { t?.close(); t = null; if (prev === undefined) delete process.env.SUBBRAIN_CLEANUP; else process.env.SUBBRAIN_CLEANUP = prev; });

const serviceStates = (core: T['core']) => core.db.all<{ service_state: string; n: number }>('SELECT service_state, COUNT(*) AS n FROM conversations GROUP BY 1');

describe('채팅창 정리 미리보기', () => {
  it('꺼져 있으면 예전 그대로: 501 · cleanup null', async () => {
    delete process.env.SUBBRAIN_CLEANUP;
    t = await makeCore({ seeded: true });
    expect((await t.json('GET', '/deletion-batches/del_20260930')).status).toBe(501);
    expect((await t.json('POST', '/archive/undo', { itemIds: [1] })).status).toBe(501);
    expect(generateDigest(t.core).cleanup).toBeNull();
  });

  it('하루 배치: 삭제 후보(승인 필요)와 ChatGPT 보관(되돌릴 수 있음)을 나누고, 원문을 내보내 해시로 확인', async () => {
    t = await makeCore({ seeded: true });
    const run = await t.json('POST', '/cleanup/run', {});
    expect(run.status).toBe(200);
    const d = run.body.detail; // 예시 데이터를 만들 때 요약이 이미 오늘 배치를 만들었을 수 있다
    expect(d.batch.id).toBe('del_20260930');
    expect(d.batch.state).toBe('pending');
    expect(d.batch.candidateCount).toBeGreaterThan(0);
    expect(d.batch.groups.length).toBeGreaterThan(0);
    expect(d.batch.selectedCount).toBe(d.batch.candidateCount);
    expect(d.batch.groups.some((g: { sourceAi: string }) => g.sourceAi === 'chatgpt')).toBe(false);
    const arc = (await t.json('GET', '/cleanup/archive')).body.archive;
    expect(arc.length).toBeGreaterThan(0);
    expect(arc.every((a: { sourceAi: string; state: string }) => a.sourceAi === 'chatgpt' && a.state === 'archive_queued')).toBe(true);
    // 지난 날 손대지 않은 배치는 닫힘
    expect(t.core.db.value("SELECT COUNT(*) FROM deletion_batches WHERE state='pending'")).toBe(1);
    expect(d.batch.groups.every((g: { backupVerified: boolean }) => g.backupVerified)).toBe(true);
    for (const g of d.batch.groups) for (const it of g.items) expect(d.reasons[String(it.itemId)]).toMatch(/새 메시지 없음/);
    expect(existsSync(join(d.exportDir, 'manifest.json'))).toBe(true);
    // 두 번 불러도 같은 배치
    expect((await t.json('POST', '/cleanup/run', {})).body.created).toBe(false);
    // 계약 모양 그대로 (strict)
    const g = await t.json('GET', `/deletion-batches/${d.batch.id}`);
    expect(S.DeletionBatchResponseSchema.safeParse(g.body).success).toBe(true);
    const dig = generateDigest(t.core);
    expect(S.DigestCleanupSchema.safeParse(dig.cleanup).success).toBe(true);
    expect(dig.cleanup!.deletionBatch!.id).toBe(d.batch.id);
  });

  it('선택 해제 → 승인(표시만): 409 검사, DB 백업, 서비스 상태는 그대로', async () => {
    t = await makeCore({ seeded: true });
    const d = (await t.json('POST', '/cleanup/run', {})).body.detail;
    const id = d.batch.id; const first = d.batch.groups[0].items[0];
    const off = await t.json('PATCH', `/deletion-batches/${id}/items/${first.itemId}`, { selected: false });
    expect(off.status).toBe(200);
    expect(off.body.batch.selectedCount).toBe(d.batch.selectedCount - 1);
    const it0 = off.body.batch.groups[0].items.find((x: { itemId: number }) => x.itemId === first.itemId);
    expect(it0).toMatchObject({ selected: false, excludedByUser: true });
    const before = serviceStates(t.core);
    const stale = await t.json('POST', `/deletion-batches/${id}/approve`, { expectedSelectedCount: d.batch.selectedCount, excludedItemIds: [] });
    expect(stale.status).toBe(409);
    const n = off.body.batch.selectedCount;
    const ok = await t.json('POST', `/deletion-batches/${id}/approve`, { expectedSelectedCount: n, excludedItemIds: [first.itemId] });
    expect(ok.status).toBe(200);
    expect(ok.body.batch.state).toBe('approved');
    expect(ok.body.batch.selectedCount).toBe(n);
    const det = (await t.json('GET', `/cleanup/batches/${id}`)).body;
    expect(det.mode).toBe('mark_only');
    expect(det.executor).toBe('off');
    expect(existsSync(det.dbBackupRef)).toBe(true);
    expect(serviceStates(t.core)).toEqual(before); // 서비스 쪽은 아무것도 안 바뀜
    expect(t.core.db.value("SELECT COUNT(*) FROM conversations WHERE deleted_at IS NOT NULL")).toBe(0);
    expect(t.core.db.value("SELECT COUNT(*) FROM deletion_items WHERE batch_id=? AND state='approved'", id)).toBe(n);
    expect(t.core.db.value("SELECT COUNT(*) FROM deletion_items WHERE batch_id=? AND state='kept'", id)).toBe(1);
    expect((await t.json('POST', `/deletion-batches/${id}/approve`, { expectedSelectedCount: n, excludedItemIds: [] })).status).toBe(409);
    expect((await t.json('PATCH', `/deletion-batches/${id}/items/${first.itemId}`, { selected: true })).status).toBe(409);
  });

  it('내보낸 원문이 바뀌면 그 묶음은 저장 확인 안 됨 → 승인 409', async () => {
    t = await makeCore({ seeded: true });
    const d = (await t.json('POST', '/cleanup/run', {})).body.detail;
    const m = JSON.parse(readFileSync(join(d.exportDir, 'manifest.json'), 'utf8'));
    const conv = d.batch.groups[0].items[0].conversationId;
    writeFileSync(join(d.exportDir, m.files[conv].file), '{"tampered":true}');
    const g = (await t.json('GET', `/deletion-batches/${d.batch.id}`)).body.batch;
    expect(g.groups[0].backupVerified).toBe(false);
    expect((await t.json('POST', `/deletion-batches/${d.batch.id}/approve`, { expectedSelectedCount: g.selectedCount, excludedItemIds: [] })).status).toBe(409);
  });

  it('보관 되돌리기 · 다시 보관, 되돌린 대화는 다음 배치에 안 나옴', async () => {
    t = await makeCore({ seeded: true });
    const d = (await t.json('POST', '/cleanup/run', {})).body.detail;
    const arc = (await t.json('GET', '/cleanup/archive')).body.archive;
    const a = arc[0];
    const u = await t.json('POST', '/archive/undo', { itemIds: [a.itemId] });
    expect(u.status).toBe(200);
    expect(u.body.changed).toBe(1);
    expect(u.body.archive.find((x: { itemId: number }) => x.itemId === a.itemId).state).toBe('archive_undone');
    const r = await t.json('POST', '/cleanup/archive', { itemIds: [a.itemId] });
    expect(r.body.changed).toBe(1);
    await t.json('POST', '/archive/undo', { itemIds: [a.itemId] });
    expect((await t.json('POST', '/archive/undo', { itemIds: [999999] })).status).toBe(404);
    // 미루기 → 다음 날 새 배치에 삭제 후보는 다시, 되돌린 보관 항목은 빠짐
    expect((await t.json('POST', `/deletion-batches/${d.batch.id}/postpone`, {})).body.batch.state).toBe('postponed');
    setNow('2026-10-01T08:30:00+09:00');
    const d2 = (await t.json('POST', '/cleanup/run', {})).body.detail;
    expect(d2.batch.id).toBe('del_20261001');
    expect(d2.batch.candidateCount).toBeGreaterThanOrEqual(d.batch.candidateCount);
    expect(d2.archive.some((x: { conversationId: string }) => x.conversationId === a.conversationId)).toBe(false);
    expect(t.core.db.value("SELECT state FROM deletion_batches WHERE id=?", d.batch.id)).toBe('postponed');
  });

  it('진행 중·멈춤 과제와 유예 기간 안의 대화는 후보가 아님', async () => {
    t = await makeCore({ seeded: true });
    const d = (await t.json('POST', '/cleanup/run', {})).body.detail;
    const arc = (await t.json('GET', '/cleanup/archive')).body.archive;
    expect(d.batch.candidateCount + arc.length).toBeGreaterThan(0);
    const ids = [...d.batch.groups.flatMap((g: { items: Array<{ conversationId: string }> }) => g.items.map((i) => i.conversationId)), ...arc.map((a: { conversationId: string }) => a.conversationId)];
    const bad = t.core.db.all<{ id: string }>(`SELECT c.id FROM conversations c JOIN tasks t ON t.id=c.task_id WHERE t.status IN ('진행 중','멈춤') AND c.id IN (SELECT value FROM json_each(?))`, JSON.stringify(ids));
    expect(bad).toEqual([]);
  });
});

describe('cleanup grace days default', () => {
  it('defaults to 7 days (user decision 2026-10-19) and honours the env override', async () => {
    const { graceDays, DEFAULT_GRACE_DAYS } = await import('../src/cleanup/cleanup.ts');
    const prev = process.env.SUBBRAIN_CLEANUP_GRACE_DAYS;
    try {
      delete process.env.SUBBRAIN_CLEANUP_GRACE_DAYS;
      expect(DEFAULT_GRACE_DAYS).toBe(7); expect(graceDays()).toBe(7);
      process.env.SUBBRAIN_CLEANUP_GRACE_DAYS = ''; expect(graceDays()).toBe(7);
      process.env.SUBBRAIN_CLEANUP_GRACE_DAYS = 'abc'; expect(graceDays()).toBe(7);
      process.env.SUBBRAIN_CLEANUP_GRACE_DAYS = '3'; expect(graceDays()).toBe(3);
    } finally { if (prev === undefined) delete process.env.SUBBRAIN_CLEANUP_GRACE_DAYS; else process.env.SUBBRAIN_CLEANUP_GRACE_DAYS = prev; }
  });
});
