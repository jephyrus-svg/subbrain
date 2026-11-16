// 콘텐츠 스크립트 ↔ 서비스 워커 메시지. 콘텐츠 스크립트는 토큰도 코어 주소도 모른다(설계서 12.4).
import type { IngestMessage, SiteAi } from './contract';
import type { HealthReport } from '../adapters/types';

export interface PageSnapshot {
  sourceAi: SiteAi;
  sourceId: string;
  url: string;
  title: string;
  messages: IngestMessage[];
  /** 답이 아직 스트리밍 중이면 false */
  complete: boolean;
  project: { externalId: string; name: string } | null;
  adapter: { name: string; version: string; domVersion: string };
  /** 백그라운드 따라잡기 탭에서 읽었으면 true */
  catchup: boolean;
  capturedAt: string;
}
export interface SidebarItem { sourceId: string; title: string; updatedAt: string | null; url: string | null }

export type ToWorker =
  | { type: 'snapshot'; snapshot: PageSnapshot }
  | { type: 'sidebar'; sourceAi: SiteAi; items: SidebarItem[]; endOfList: boolean }
  | { type: 'health'; sourceAi: SiteAi; report: HealthReport }
  | { type: 'visit'; sourceAi: SiteAi }
  | { type: 'hello'; sourceAi: SiteAi };

export type ToContent = { type: 'catchup-read'; sourceId: string } | { type: 'paused'; paused: boolean };

/** 팝업 ↔ 서비스 워커 */
export type PopupRequest =
  | { type: 'status' }
  | { type: 'pair'; code: string; coreUrl: string }
  | { type: 'unpair' }
  | { type: 'set-settings'; patch: Partial<import('../background/settings').Settings> }
  | { type: 'catchup-now'; sourceAi: SiteAi }
  | { type: 'flush' };
