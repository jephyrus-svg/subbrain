// 계약 1.5.0 §14.3 확장 수집 타입 — @subbrain/shared(api-types.ts)를 그대로 쓴다(타입만, 번들에 들어가지 않음).
export type {
  AdapterHealth, AdapterHealthBody, AdapterHealthResponse, ApiError, CatchupDiffBody, CatchupDiffResponse, ChatSourceAi,
  CompletePairingBody, CompletePairingResponse, IngestMessage, IngestReplayBody, IngestReplayResponse, IngestSnapshotBody,
  IngestSnapshotResponse, MessageRole, SyncStateResponse,
} from '@subbrain/shared';

/** 이 확장이 지금 다루는 사이트(계약의 ChatSourceAi 중 둘) */
export type SiteAi = 'chatgpt' | 'claude';
export const SITES: readonly SiteAi[] = ['chatgpt', 'claude'];
export const SITE_LABEL: Record<SiteAi, string> = { chatgpt: 'ChatGPT', claude: 'Claude' };
export const SITE_HOME: Record<SiteAi, string> = { chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/recents' };
export const EXT_VERSION = '0.1.0';
