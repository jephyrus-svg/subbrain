import type { IngestMessage, SiteAi } from '../shared/contract';
import type { SidebarItem } from '../shared/messages';
import type { SiteSelectors } from './selectors';

export interface HealthCheck { name: string; ok: boolean; detail?: string | null }
export interface HealthReport {
  health: 'ok' | 'degraded' | 'broken';
  checks: HealthCheck[];
  errorCode: 'SELECTOR_NOT_FOUND' | 'LOGGED_OUT' | 'CHALLENGE' | 'EXTRACT_INVALID' | null;
}
export interface ReadResult {
  sourceId: string;
  title: string;
  messages: IngestMessage[];
  streaming: boolean;
  project: { externalId: string; name: string } | null;
  /** 대체 선택자를 쓴 곳(있으면 상태 '주의') */
  fallbacks: string[];
}
/** 어댑터 공통 인터페이스(설계서 5.4①-C, 삭제 관련은 이 단계에 없음) */
export interface Adapter {
  sourceAi: SiteAi;
  name: string;
  version: string;
  sel: SiteSelectors;
  detectConversation(url: URL): string | null;
  readMessages(doc: Document, url: URL): ReadResult | null;
  listSidebar(doc: Document, base: URL): SidebarItem[];
  sidebarOpen(doc: Document): boolean;
  healthCheck(doc: Document, url: URL): HealthReport;
  /** 2026-10-16 메시지를 못 읽을 때 화면 구조 요약(내용 없음) */
  diagnose?(doc: Document): Array<{ name: string; detail: string }>;
}
