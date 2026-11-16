// 채팅창 정리 미리보기 보조 경로 (/cleanup/*, POST /archive/undo) — 코어 src/cleanup 모듈(SUBBRAIN_CLEANUP=preview)과 짝.
// 계약 §14.1 경로(/deletion-batches/*)는 endpoints.ts 그대로 쓰고, 여기엔 계약에 아직 없는 것만 둔다(웹 전용 타입).
import type { DeletionBatch, SourceAi } from '@subbrain/shared';
import { get, post } from './client';

export interface CleanupArchiveItem { itemId: number; conversationId: string; sourceAi: SourceAi; title: string; date: string; reason: string; state: 'archive_queued' | 'archive_undone' }
export interface CleanupBatchDetail {
  batch: DeletionBatch;
  reasons: Record<string, string>;
  archive: CleanupArchiveItem[];
  mode: 'mark_only';
  executor: 'off';
  approvedAt: string | null;
  dbBackupRef: string | null;
  exportDir: string;
}
export interface CleanupStatus {
  enabled: boolean; level: 'L3'; mode: 'mark_only'; executor: 'off'; graceDays: number; batchCap: number; archiveServices: SourceAi[];
  todayBatchId: string | null; latestBatch: { id: string; state: string; createdAt: string } | null; note: string;
}
export interface ArchiveChange { changed: number; batchIds: string[]; archive: CleanupArchiveItem[] }

// 서비스 쪽 보관 (사용자 클릭으로만 · 기본 dry-run · 삭제 없음 · 탭/창 조작 없음)
export interface ServiceGuide { canArchive: boolean; mechanism: 'user_ui_link' | 'none'; howTo: string; undoHowTo: string; archivedListUrl: string | null }
export interface ServiceArchiveEligible { itemId: number; conversationId: string; sourceAi: SourceAi; title: string; itemState: string; canArchive: boolean }
export interface ServiceArchivePlanItem { itemId: number; conversationId: string; sourceAi: SourceAi; title: string; url: string | null; itemState: string; action: 'open_and_archive_yourself' | 'mark_local_only' | 'skip'; skipReason?: string; guide: ServiceGuide; actionId?: number }
export interface ServiceArchiveAction { id: number; itemId: number; conversationId: string; sourceAi: SourceAi; title: string; url: string | null; method: string; state: 'link_issued' | 'user_archived' | 'local_only' | 'undone'; createdAt: string; updatedAt: string; undo: { prevServiceState: string; howTo: string } }
export interface ServiceArchiveState { guides: Record<string, ServiceGuide>; eligible: ServiceArchiveEligible[]; actions: ServiceArchiveAction[] }

const enc = encodeURIComponent;
export const cleanupApi = {
  status: () => get<CleanupStatus>('/cleanup/status'),
  run: () => post<{ batchId: string | null; created: boolean; detail: CleanupBatchDetail | null }>('/cleanup/run', {}),
  detail: (id: string) => get<CleanupBatchDetail>(`/cleanup/batches/${enc(id)}`),
  archive: () => get<{ archive: CleanupArchiveItem[] }>('/cleanup/archive'),
  undoArchive: (itemIds: number[]) => post<ArchiveChange>('/archive/undo', { itemIds }),
  redoArchive: (itemIds: number[]) => post<ArchiveChange>('/cleanup/archive', { itemIds }),
  serviceArchive: () => get<ServiceArchiveState>('/cleanup/service-archive'),
  serviceArchivePlan: (itemIds: number[], dryRun: boolean) => post<{ dryRun: boolean; items: ServiceArchivePlanItem[]; recorded: number }>('/cleanup/service-archive/plan', { itemIds, dryRun }),
  serviceArchiveDone: (actionIds: number[]) => post<{ changed: number; actions: ServiceArchiveAction[] }>('/cleanup/service-archive/done', { actionIds }),
  serviceArchiveUndo: (actionIds: number[]) => post<{ changed: number; howTo: { actionId: number; sourceAi: SourceAi; howTo: string }[]; actions: ServiceArchiveAction[] }>('/cleanup/service-archive/undo', { actionIds }),
};
