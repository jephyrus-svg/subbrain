/** 채팅창 정리 라우트 (SUBBRAIN_CLEANUP=preview 일 때만 등록). 계약 §14.1 [잠정] 모양 그대로 + /cleanup/* 보조 경로. */
import type { Hono } from 'hono';
import { z } from 'zod';
import * as S from '@subbrain/shared/schemas';
import type { Core } from '../core.ts';
import { today } from '../util/time.ts';
import { ApiError } from '../util/errors.ts';
import { approveBatch, batchDetail, cleanupStatus, ensureDailyBatch, listArchive, postponeBatch, setArchive, setItemSelected } from './cleanup.ts';
import { confirmServiceArchived, listServiceArchive, planServiceArchive, SERVICE_GUIDES, undoServiceArchive, listServiceArchiveEligible } from './service-archive.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = <T extends z.ZodTypeAny>(c: any, schema: T) => Promise<z.infer<T>>;
const PlanSchema = z.object({ itemIds: z.array(z.number().int()).min(1).max(500), dryRun: z.boolean().optional() }).strict();
const ActionIdsSchema = z.object({ actionIds: z.array(z.number().int()).min(1).max(500) }).strict();
const ItemIdsSchema = z.object({ itemIds: z.array(z.number().int()).min(1).max(500) }).strict();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerCleanupRoutes(api: Hono<any>, core: Core, body: Body): void {
  const itemId = (v: string) => { const n = Number(v); if (!Number.isInteger(n)) throw new ApiError('VALIDATION_ERROR', 'itemId는 정수예요.', { issues: [{ path: 'itemId', message: '정수 아님' }] }); return n; };
  // 계약 §14.1 — 응답은 DeletionBatchResponse 그대로 { batch }
  api.get('/deletion-batches/:id', (c) => c.json({ batch: batchDetail(core, c.req.param('id')).batch }));
  api.patch('/deletion-batches/:id/items/:itemId', async (c) => {
    const b = await body(c, S.SetDeletionItemBodySchema);
    return c.json({ batch: setItemSelected(core, c.req.param('id'), itemId(c.req.param('itemId')), b.selected).batch });
  });
  api.post('/deletion-batches/:id/approve', async (c) => {
    const b = await body(c, S.ApproveDeletionBodySchema);
    return c.json({ batch: approveBatch(core, c.req.param('id'), b).batch });
  });
  api.post('/deletion-batches/:id/postpone', async (c) => c.json({ batch: postponeBatch(core, c.req.param('id')).batch }));
  // 계약 6번 줄의 POST /archive/undo (본문 모양은 계약에 없음 → { itemIds })
  api.post('/archive/undo', async (c) => { const b = await body(c, ItemIdsSchema); const r = setArchive(core, b.itemIds, true); return c.json({ ...r, archive: listArchive(core) }); });
  // 보조 경로 (웹 전용 미리보기)
  api.post('/cleanup/archive', async (c) => { const b = await body(c, ItemIdsSchema); const r = setArchive(core, b.itemIds, false); return c.json({ ...r, archive: listArchive(core) }); });
  api.get('/cleanup/archive', (c) => c.json({ archive: listArchive(core) }));
  api.get('/cleanup/status', (c) => c.json(cleanupStatus(core)));
  api.post('/cleanup/run', async (c) => { const r = ensureDailyBatch(core, today()); return c.json({ ...r, detail: r.batchId ? batchDetail(core, r.batchId) : null }); });
  api.get('/cleanup/batches/:id', (c) => c.json(batchDetail(core, c.req.param('id'))));
  // 서비스 쪽 보관 (사용자 클릭으로만, 기본 dry-run, 삭제 없음, 탭/창 조작 없음, 서비스 호출 없음)
  api.get('/cleanup/service-archive', (c) => c.json({ guides: SERVICE_GUIDES, eligible: listServiceArchiveEligible(core), actions: listServiceArchive(core) }));
  api.post('/cleanup/service-archive/plan', async (c) => { const b = await body(c, PlanSchema); return c.json(planServiceArchive(core, b.itemIds, b.dryRun !== false)); });
  api.post('/cleanup/service-archive/done', async (c) => { const b = await body(c, ActionIdsSchema); return c.json({ ...confirmServiceArchived(core, b.actionIds), actions: listServiceArchive(core) }); });
  api.post('/cleanup/service-archive/undo', async (c) => { const b = await body(c, ActionIdsSchema); return c.json({ ...undoServiceArchive(core, b.actionIds), actions: listServiceArchive(core) }); });
}
