/**
 * 서브브레인 로컬 코어 HTTP API v1 — 공유 타입
 * 원본 계약: API_CONTRACT.md (§4와 1:1)
 * 설계서 절 번호: 서브브레인_전체설계서_v1.1.md 기준 (§6.2 = 6.2절)
 * 규칙: JSON 키는 camelCase, 열거값은 설계서 값 그대로.
 * "LATER(x)" 표시 필드는 MVP에서도 키가 있고 값은 null 또는 [] 이다.
 */

// ───────────────────────── 0. 공통 스칼라 ─────────────────────────
/** ISO 8601 + KST 오프셋. 예: "2026-09-18T01:47:00+09:00" */
export type ISODateTime = string;
/** KST 날짜. 예: "2026-09-30" */
export type ISODate = string;
/** 색 hex. 예: "#F07F5E" */
export type HexColor = string;

// ───────────────────────── 1. 열거값 (설계서 그대로) ─────────────────────────
/** §6.2 source_ai, §6.3 conversations.source_ai */
/** 1.5.0: 'claude-code'(Claude Code CLI 세션 로그) · 'codex'(OpenAI Codex CLI 세션 로그) 추가 — 로컬 세션 수집기(§12.10)가 만든 대화 */
/** 1.10.0: 'grokbot'(Grok Bot 앱 대화 — Claude conversations.json 모양으로 변환해 가져옴) */
export type SourceAi = 'chatgpt' | 'claude' | 'gemini' | 'grok' | 'claude-code' | 'codex' | 'grokbot';
export const SOURCE_AIS: readonly SourceAi[] = ['chatgpt', 'claude', 'gemini', 'grok', 'claude-code', 'codex', 'grokbot'];
/** 1.5.0 웹 채팅 서비스(확장 프로그램·내보내기 대상) */
export type ChatSourceAi = 'chatgpt' | 'claude' | 'gemini' | 'grok';
export const CHAT_SOURCE_AIS: readonly ChatSourceAi[] = ['chatgpt', 'claude', 'gemini', 'grok'];
/** 1.5.0 로컬 코딩 에이전트 세션 로그 */
export type LocalSourceAi = 'claude-code' | 'codex';
export const LOCAL_SOURCE_AIS: readonly LocalSourceAi[] = ['claude-code', 'codex'];

/** §6.2 kind, §7.1 — 과제 | 간단한 질문 */
export type Kind = 'task' | 'quick_question';

/** §6.3 classifications.resolution, §7.6 */
export type Resolution = 'resolved' | 'unresolved' | 'abandoned';

/** §6.2 status, §6.3 tasks.status, §7.2 — 값은 한국어 문자열 그대로 */
export type TaskStatus = '진행 중' | '멈춤' | '완료' | '간단한 질문' | '보관';
export const TASK_STATUSES: readonly TaskStatus[] = ['진행 중', '멈춤', '완료', '간단한 질문', '보관'];

/** §6.3 tasks.status_source */
export type StatusSource = 'user' | 'mcp' | 'llm' | 'rule';

/** §6.2 과제 origin */
export type TaskOrigin = 'auto' | 'mcp' | 'manual';

/** §7.2-5: abandoned → 완료(완료_사유: 중단). 완료가 아니면 null */
/** 1.4.0 'answered' = 답을 받은 간단한 질문(kind='quick_question'). 간단한 질문은 상태가 아니라 종류 → 상태는 '완료' */
/** 1.5.0 done = 주 대화가 모두 끝남(대화 결과 done) · moved = 다른 곳으로 옮겨 끝냄(handoff 표시 유지) */
export type CompletionReason = 'resolved' | 'abandoned' | 'answered' | 'done' | 'moved';

/** §7.3 방치 단계. 키는 계약서가 정함(설계서엔 한국어 라벨만 있음)
 *  short_pause=잠깐 멈춤(4–7일) · stale=방치(8–30) · long_stale=오래 방치(31–90) · dormant=휴면(90+) */
export type StaleStage = 'short_pause' | 'stale' | 'long_stale' | 'dormant';

/** §10.2.3 그래프 고리·목록 아이콘용 파생 토큰(디자인 v3 CSS 클래스와 같은 이름)
 *  run=진행 중(초록 실선) · stall2=4–7일 멈춤(노랑 점선) · stall=8일+ 멈춤(주황 점선) · done=완료 · quick=간단한 질문 · archived=보관 */
export type StatusVisual = 'run' | 'stall2' | 'stall' | 'done' | 'quick' | 'archived';

/** §6.2 service_state — 서비스 쪽 대화 상태 */
export type ServiceState = 'active' | 'archived' | 'deleted';

/** §6.2 capture_method */
export type CaptureMethod = 'extension_live' | 'extension_catchup' | 'export' | 'mcp' | 'local_session'; // 1.5.0 local_session

/** §6.3 messages.role */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/** §6.2 프로젝트 노트 status */
export type ProjectStatus = 'active' | 'paused' | 'done';

/** §6.3 events.type + §6.5/§8.4 온톨로지 이벤트 */
export type EventType =
  | 'conversation_started' | 'message_added' | 'status_changed' | 'completed'
  | 'wiki_created' | 'archived_in_service' | 'deleted_from_service'
  | 'object_created' | 'object_merged' | 'link_added' | 'link_ended'
  | 'suggestion_accepted' | 'suggestion_rejected'
  | 'task_logged' | 'write_undone'; // 1.8.0 MCP 기록·되돌리기

/** §6.3 events.actor */
export type EventActor = 'user' | 'mcp' | 'classifier' | 'rule' | 'extension';

/** §6.3 sync_state.adapter_health — 화면 라벨: 정상 / 주의 / 고장 (§10.6) */
export type AdapterHealth = 'ok' | 'degraded' | 'broken';

/** §8.2 객체 종류 9개 (object_types.key) */
export type ObjectType =
  | 'person' | 'project' | 'task' | 'decision' | 'tool'
  | 'artifact' | 'place' | 'organization' | 'topic';
export const OBJECT_TYPES: readonly ObjectType[] = [
  'person', 'project', 'task', 'decision', 'tool', 'artifact', 'place', 'organization', 'topic',
];

/** §8.3 관계 종류 10개 (link_types.key) */
export type LinkType =
  | 'uses' | 'decided' | 'blocked_by' | 'derived_from' | 'references'
  | 'part_of' | 'supersedes' | 'affects' | 'located_at' | 'related_to';
export const LINK_TYPES: readonly LinkType[] = [
  'uses', 'decided', 'blocked_by', 'derived_from', 'references',
  'part_of', 'supersedes', 'affects', 'located_at', 'related_to',
];

/** §8.4 objects.status */
export type ObjectStatus = 'accepted' | 'suggested' | 'rejected' | 'merged';
/** §8.4 links.status */
export type LinkStatus = 'accepted' | 'suggested' | 'rejected';
/** §8.4 objects.origin / links.origin */
export type OntologyOrigin = 'llm' | 'rule' | 'user';

/** §10.11 기본(과제) 모드 / 온톨로지(관계) 모드 */
export type GraphMode = 'task' | 'ontology';

/** §10.2.5 그래프 노드 종류 = §8.2 객체 타입 + 위키 페이지 + (선택) AI 서비스 노드.
 *  간단한 질문은 별도 타입이 아니라 type:'task' + kind:'quick_question' (작은 회색 점). */
export type GraphNodeType = ObjectType | 'wiki' | 'ai_service';

/** §10.2.5 엣지 = §8.3 관계 + 그래프 전용 3종
 *  same_task_candidate: 과제↔과제 "같은 과제일 수 있음"(합치기 제안, §6.1)
 *  wiki_source: 위키 → 출처 과제 · from_ai: 과제 → AI 서비스 노드(선택) */
export type GraphEdgeType = LinkType | 'same_task_candidate' | 'wiki_source' | 'from_ai';

/** §9.2 자동화 레벨 (개인용 기본 L3, §0) */
export type AutomationLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

/** §12.2, §13 — 분류용 LLM 제공자 */
export type LlmProvider = 'anthropic' | 'openai' | 'google' | 'xai' | 'ollama';

/** 가져오기 작업 상태 (§3 시나리오 D, §10.7 가져오기: 끌어다 놓기 → 미리보기 → 실행 → 진행률) */
export type ImportState =
  | 'uploaded' | 'parsing' | 'preview_ready' | 'importing' | 'classifying'
  | 'done' | 'failed' | 'cancelled';

/** 백그라운드 작업 종류 (§5.4② queue/scheduler) */
export type JobType =
  | 'import' | 'classify' | 'extract_ontology' | 'vault_regenerate'
  | 'digest' | 'stale_recalc' | 'wiki' | 'backup'
  | 'collector_backfill' | 'collector_scan'; // 1.5.0 로컬 세션 수집기
/** deferred = 하루 LLM 비용 상한 때문에 다음 날로 미룸 (§7.7) */
export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'deferred';

/** §6.4 검색 방식: 3글자+ trigram · 2글자 bigram 보조 색인(또는 LIKE 대체) · 1글자 제목·요약 LIKE */
export type SearchMode = 'trigram' | 'bigram' | 'like' | 'title_like';
export type SearchResultType = 'task' | 'conversation' | 'message' | 'decision' | 'wiki';

export type MergeSuggestionState = 'pending' | 'accepted' | 'rejected';
/** 1.1.0 새 프로젝트 제안 상태 (§7.7) */
export type ProjectSuggestionState = 'pending' | 'accepted' | 'rejected';
/** 1.1.0 분류 상태: ok = 정상 분류, blocked = 제공자 안전 필터가 막아 "분류 불가"(규칙 분류 결과로 대신 채움) */
export type ClassificationState = 'ok' | 'blocked';

/**
 * 1.1.0 다른 곳에서 이어감(handoff) — 대화 끝에서 사용자가 작업을 다른 창·도구로 옮긴다고 밝힘
 * ("새 창에서 작업할꺼야", "md로 정리해줘, Claude Code에서 이어갈게", "인계서 만들어줘").
 * 과제는 끝난 것이 아니다: resolution은 항상 unresolved → 상태는 진행 중/멈춤(§7.2-6), 완료가 아님.
 */
/**
 * 1.4.0 대화 결과(과제 상태와 별개 — 사용자가 "이 대화는 끝났다"고 보는 기준).
 *  done = 이 대화의 목적 달성 · moved = 의도해서 다른 창·도구로 옮김("새창에서 작업할꺼야", "Claude Code로 가서") ·
 *  interrupted = 한도·잠·시간 때문에 끊김("토큰 떨어져서", "자야 할 시간") · open = 아직 진행 중/답을 기다림
 */
export type ConversationOutcome = 'done' | 'moved' | 'interrupted' | 'open';
export const CONVERSATION_OUTCOMES: readonly ConversationOutcome[] = ['done', 'moved', 'interrupted', 'open'];
export interface ConversationOutcomeInfo {
  outcome: ConversationOutcome;
  /** 대화 기준 상태: done·moved → '완료', interrupted·open → 마지막 메시지 날짜로 '진행 중'/'멈춤'(과제와 같은 방치 기준) */
  status: Extract<TaskStatus, '진행 중' | '멈춤' | '완료'>;
  staleDays: number | null;
  /** 배지 문구: "끝난 대화" · "Claude Code로 옮김" · "끊김(토큰 한도)" · "진행 중" */
  label: string;
  target: string | null;          // moved/interrupted일 때 옮겨 갈 곳(handoff.target과 같음)
  evidence: string | null;
  detectedBy: 'llm' | 'rule' | 'both' | 'derived'; // derived = 1.4.0 이전 분류에서 추정(재분류 전)
}

export interface HandoffInfo {
  label: string;                 // "Claude Code에서 이어감" | "다른 곳에서 이어감"
  target: string | null;         // "Claude Code" | "새 대화" | "다른 기기" | "Codex" | "Cursor" | null(알 수 없음)
  conversationId: string;        // 이어감을 밝힌 대화
  evidence: string | null;       // 근거 발췌(마지막 사용자 메시지 일부)
  detectedBy: 'llm' | 'rule' | 'both';
}

/** 오늘의 요약 "어제 있었던 일" 행 동작 (§10.6, 디자인 03: 완료/시작/이어감/멈춤) */
export type DigestEventAction = 'completed' | 'started' | 'continued' | 'stalled' | 'archived' | 'wiki_drafted';

// ───────────────────────── 2. 공통 조각 ─────────────────────────
export interface Page {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
  total: number | null;
}
export interface ListResponse<T> {
  items: T[];
  page: Page;
}

export type ErrorCode =
  | 'VALIDATION_ERROR' | 'UNSUPPORTED_FILE' | 'FORBIDDEN_ORIGIN' | 'NOT_FOUND'
  | 'CONFLICT' | 'DUPLICATE_IMPORT' | 'PAYLOAD_TOO_LARGE' | 'NOT_ALLOWED_IN_BUILD'
  | 'COST_CAP_REACHED' | 'INTERNAL' | 'NOT_IMPLEMENTED' | 'DB_BUSY' | 'LLM_UNAVAILABLE'
  | 'UNAUTHORIZED' | 'RATE_LIMITED'; // 1.5.0 (Phase 3 수집 API) 401 · 429
export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    requestId: string;
  };
}

/** 볼트 노트 위치 (§6.1). obsidianUri는 볼트 이름을 알 때만 */
export interface VaultRef {
  path: string;              // 볼트 기준 상대 경로. 예: "tasks/메인-페이지-카피-확정.md"
  obsidianUri: string | null; // 예: "obsidian://open?vault=SubBrain&file=tasks%2F..."
}

export interface ProjectRef {
  id: string;
  name: string;
  colorHex: HexColor;        // §10.2.1 프로젝트 8색 순환
}

export interface TaskRef {
  id: string;
  title: string;
  status: TaskStatus;
  statusVisual: StatusVisual;
  staleDays: number | null;
  projectId: string | null;
}

/** 멈춤 정보 묶음 (§7.2-6, §7.3, §10.2.3) */
export interface StaleInfo {
  staleDays: number | null;      // 오늘 − 마지막 활동일. 멈춤이 아니면 null
  staleStage: StaleStage | null; // 멈춤일 때만
  statusVisual: StatusVisual;
  /** 라벨 옆 배지 문구. 멈춤이면 항상 "N일"(색은 statusVisual: 4–7일 노랑, 8일+ 주황), 아니면 null (§10.2.3, 디자인 v3) */
  badge: string | null;
}

/** AI별 개수 (§10.4 AI별 대화 막대, §10.5 AI별 분포) */
export interface AiCount {
  sourceAi: SourceAi;
  conversationCount: number;
  messageCount: number;
}

/** "…에서 이어서" 버튼 대상 (§10.4, §10.8 이어서 하기) */
export interface ContinueTarget {
  sourceAi: SourceAi;
  url: string;                   // 원래 대화 URL (source_url)
  conversationId: string;
  label: string;                 // 예: "ChatGPT에서 이어서"
}

// ───────────────────────── 3. 시스템 ─────────────────────────
export interface HealthResponse {
  status: 'ok' | 'degraded';
  apiVersion: string;            // "1.1.0"
  coreVersion: string;
  node: string;                  // "v22.23.3"
  buildTarget: 'personal' | 'sellable'; // §9.2.4
  startedAt: ISODateTime;
  uptimeSec: number;
  db: {
    path: string;
    journalMode: 'wal';
    schemaVersion: number;
    sqliteVersion: string;
    fts5: boolean;
    trigram: boolean;
    bigramIndex: boolean;        // false면 2글자 검색은 LIKE 대체 (§6.4)
    sizeBytes: number;
  };
  vault: { path: string; lastGeneratedAt: ISODateTime | null; conflictCount: number };
  workers: { queueDepth: number; running: number; paused: boolean; pausedReason: string | null };
  llm: { provider: LlmProvider | null; model: string | null; configured: boolean };
}

export interface MetaResponse {
  statuses: Array<{ value: TaskStatus; visual: StatusVisual; colorHex: HexColor; labelKo: string }>;
  statusVisuals: Record<StatusVisual, { colorHex: HexColor | null; ring: 'solid' | 'dashed' | 'none' | 'dot'; labelKo: string }>;
  staleStages: Array<{ key: StaleStage; labelKo: string; emoji: string; minDays: number; maxDays: number | null }>;
  sourceAis: Array<{ key: SourceAi; labelKo: string; shape: 'circle' | 'rounded_square' | 'diamond' | 'triangle'; colorHex: HexColor }>;
  projectPalette: HexColor[];
  objectTypes: Array<{ key: ObjectType; labelKo: string; icon: string; sensitive: boolean; enabled: boolean }>;
  linkTypes: Array<{ key: LinkType; labelKo: string; directed: boolean; colorHex: HexColor; line: 'solid' | 'dashed' | 'thin' | 'dotted'; arrow: boolean; hiddenByDefault: boolean }>;
  thresholds: StaleThresholds;
}

/** 상단바 + 홈 카운터 (§10.3, §10.4) */
export interface DashboardResponse {
  today: ISODate;
  counts: {
    inProgress: number;          // 진행 중
    stalled: number;             // 멈춤 전체
    stalledOver7Days: number;    // 그중 8일 이상("7일 넘은 것", §10.2.3)
    completedThisWeek: number;   // 이번 주(월요일 시작) 완료
    quickQuestions: number;      // 간단한 질문
    archived: number;
    needsReview: number;         // 분류 확신도 < 0.6 "확인 필요" (§7.6) + 1.1.0 분류 불가(blocked)
    totalTasks: number;          // 되감기 표시 "과제 58개" (§10.4)
    /** 1.10.0 tasks 테이블 전체 행 수. totalTasks는 빠른 답변·보관 제외 */
    allTasks?: number;
  };
  collection: {
    lastCapturedAt: ISODateTime | null;  // "수집 1분 전"
    overallHealth: AdapterHealth;        // 초록 점 / 주의 / 고장
    sources: CollectionSourceStatus[];
  };
  badges: {
    digestApprovals: number;     // "승인 1건" 배지 — LATER(6)은 삭제 배치, 1.5부터 제안 검토 포함. MVP=0
    pendingMergeSuggestions: number;
    vaultConflicts: number;
    runningImports: number;
    /** 1.1.0 ready(과제 3개 이상)인 대기 중 새 프로젝트 제안 수. 엔진은 항상 보냄 */
    pendingProjectSuggestions?: number;
  };
  latestDigestDate: ISODate | null;
}

/** 수집 상태 한 줄 (§10.6 수집 상태, §6.3 sync_state) */
export interface CollectionSourceStatus {
  sourceAi: SourceAi;
  methods: CaptureMethod[];      // MVP는 ['export'] 뿐
  methodLabel: string;           // "실시간 캡처", "실시간 + 데스크톱 앱(MCP)", "내보내기 가져오기"
  lastCapturedAt: ISODateTime | null;
  health: AdapterHealth;
  message: string | null;        // "화면 구조가 바뀜 — 점검 중"
}

// ───────────────────────── 4. 그래프 ─────────────────────────
export interface GraphQuery {
  mode?: GraphMode;              // 기본 'task'. 'ontology'는 LATER(1.5)
  status?: TaskStatus[];         // 쉼표 구분
  sourceAi?: SourceAi[];
  projectId?: string[];
  from?: ISODate;                // 마지막 활동 기간 필터
  to?: ISODate;
  includeQuick?: boolean;        // 기본 true (노드가 많으면 코어가 묶음, stats.hiddenQuickCount)
  includeDone?: boolean;         // 기본 true
  includeWiki?: boolean;         // 기본 true (MVP엔 위키가 없어 빈 결과)
  focus?: string;                // 노드 id — 주변만(과제 상세 미니맵)
  depth?: 1 | 2;                 // focus 기준 이웃 깊이. 기본 1
  at?: ISODate;                  // LATER(2): 시점 되감기. MVP는 오늘만 허용
  objectTypes?: ObjectType[];    // ontology 모드 필터
  linkTypes?: LinkType[];        // ontology 모드 필터(related_to는 기본 제외)
  hideSingleMention?: boolean;   // ontology 모드 "한 번만 언급된 것 숨기기"
  limit?: number;                // 노드 상한. 기본 1500
}

export interface GraphNode {
  id: string;                    // 도메인 id (prj_*, task_*, obj_*, wiki_*, ai_*)
  type: GraphNodeType;
  label: string;
  objectId: string | null;       // 온톨로지 객체 id(project/task도 obj 자리가 있음, §8.2). MVP는 topic만 채움
  projectId: string | null;      // 속한 프로젝트(프로젝트 노드는 자기 자신)
  colorHex: HexColor | null;     // 구 색 = 프로젝트 색(§10.2.1). 주제·기타는 null
  // 과제 노드
  kind: Kind | null;
  status: TaskStatus | null;
  statusVisual: StatusVisual | null;
  staleDays: number | null;
  staleStage: StaleStage | null;
  badge: string | null;          // "12일"
  sourceAis: SourceAi[];
  // 크기·밝기 (§10.2.5: 메시지 수 또는 최근성)
  messageCount: number;
  conversationCount: number;
  taskCount: number | null;      // 프로젝트 노드만
  size: number;                  // 0..1 정규화(같은 종류 안에서 메시지 수 sqrt 기준)
  recency: number;               // 0..1 (1=오늘 활동)
  firstActivityAt: ISODateTime | null;
  lastActivityAt: ISODateTime | null;
  // 온톨로지(LATER 1.5, MVP는 topic만)
  objectStatus: ObjectStatus | null;
  mentionCount: number | null;
  confidence: number | null;
  /** 미리보기 말풍선용 한 줄 (§10.8: 이름·상태·마지막 대화 날짜) */
  tooltip: string;
}

export interface GraphEdge {
  id: string;
  type: GraphEdgeType;
  source: string;                // node id
  target: string;
  directed: boolean;
  status: LinkStatus;            // 제안이면 40% 투명 (§10.2.6)
  confidence: number | null;
  endedAt: ISODateTime | null;   // 끝난 관계는 흐리게 (§8.3, §10.11)
  weight: number;                // 선 굵기 힌트 1..
  reason: string | null;         // 프로젝트↔프로젝트 related_to 이유 등
}

export interface GraphResponse {
  mode: GraphMode;
  at: ISODate;
  generatedAt: ISODateTime;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    projectCount: number;
    taskCount: number;           // 간단한 질문 제외
    quickQuestionCount: number;
    topicCount: number;
    hiddenQuickCount: number;    // 너무 많아 묶거나 숨긴 간단한 질문 수 (§10.2.5)
    truncated: boolean;
  };
}

/** 주간 활동 막대 (§10.4 시점 되감기 슬라이더, 상세 패널 스파크라인) */
export interface ActivityResponse {
  granularity: 'week' | 'day';
  from: ISODate;
  to: ISODate;
  projectId: string | null;
  buckets: Array<{ start: ISODate; conversationCount: number; messageCount: number; taskCount: number }>;
}

// ───────────────────────── 5. 프로젝트 · 주제 ─────────────────────────
export interface ProjectSummary {
  id: string;
  name: string;
  aliases: string[];             // §6.2 태그 정규화 동의어
  status: ProjectStatus;         // 사용자가 정하는 생애 상태 (§6.2)
  colorHex: HexColor;
  /** 과제들에서 계산한 표시 상태(§15-3): 진행 중 과제가 있으면 진행 중, 없고 멈춤이 있으면 멈춤(staleDays=오늘−프로젝트 마지막 활동) */
  activity: { status: TaskStatus; staleDays: number | null; statusVisual: StatusVisual };
  taskCount: number;
  conversationCount: number;
  startedAt: ISODateTime | null;
  lastActivityAt: ISODateTime | null;
  thresholds: Partial<StaleThresholds> | null; // 프로젝트별 방치 기준(§7.3). null이면 기본
}

/** 홈 오른쪽 패널 한 줄 과제 (§10.4 과제 목록, 멈춘 기간 긴 순) */
/** 다음 할 일 한 줄 (규칙 기반, LLM 없음). source: user=직접 씀, saved=분류가 저장, rule=대화·상태로 자동 */
export interface NextStepInfo { text: string; source: 'user' | 'saved' | 'rule'; basis: string | null }

export interface TaskListItem {
  id: string;
  title: string;
  summary: string | null;        // 한 줄 요약
  kind: Kind;
  status: TaskStatus;
  statusVisual: StatusVisual;
  staleDays: number | null;
  staleStage: StaleStage | null;
  badge: string | null;
  project: ProjectRef | null;
  sourceAis: SourceAi[];
  conversationCount: number;
  messageCount: number;
  startedAt: ISODateTime | null;
  lastActivityAt: ISODateTime | null;
  completedAt: ISODateTime | null;
  nextStep: string | null;
  /** 다음 할 일(직접 쓴 것 > 저장된 것 > 규칙). 완료·보관이면 null */
  nextStepInfo?: NextStepInfo | null;
  needsReview: boolean;          // 확신도 < 0.6 (§7.6) 또는 1.1.0 분류 불가(classificationState=blocked)
  pin: boolean;
  primaryConversation: { id: string; sourceAi: SourceAi; url: string | null } | null;
  /** 1.1.0 다른 곳에서 이어감 표시. 엔진은 항상 보냄(구버전 모의 데이터 호환을 위해 선택 키) */
  handoff?: HandoffInfo | null;
  /** 1.1.0 'blocked'면 "분류 불가" 배지. 엔진은 항상 보냄 */
  classificationState?: ClassificationState;
  /** 1.2.0 분류 불가 사유·막은 모델(classificationState='blocked'일 때만 값, 아니면 null). 엔진은 항상 보냄 */
  blockedReason?: string | null;
  blockedModel?: string | null;
  /** 1.2.0 최신 분류 확신도(보정 후, 0..1). 분류 전이면 null. 엔진은 항상 보냄 */
  confidence?: number | null;
  /** 1.4.0 '완료'일 때 이유: resolved · abandoned · answered(답 받은 간단한 질문). 엔진은 항상 보냄 */
  completionReason?: CompletionReason | null;
  /** 1.4.0 최신 대화의 결과 배지. 엔진은 항상 보냄(대화 없으면 null) */
  conversationOutcome?: ConversationOutcomeInfo | null;
}

export interface NextStepCard {
  taskId: string;
  taskTitle: string;
  text: string;                  // "메인 카피는 A안(...)으로 정하고 ..."
  evidence: {
    conversationId: string;
    sourceAi: SourceAi;
    at: ISODateTime;
    quote: string;               // 근거 발췌
    label: string;               // "9월 18일 ChatGPT 대화의 마지막 메시지"
  } | null;
  continue: ContinueTarget | null;
}

export interface ProjectDetail extends ProjectSummary {
  summary: string | null;        // 분류기가 쓴 프로젝트 요약
  vault: VaultRef;
  weeklyConversations: { weeks: number; buckets: Array<{ start: ISODate; count: number }> }; // 최근 16주
  byAi: AiCount[];
  nextStep: NextStepCard | null; // "AI가 제안한 다음 단계" — 이어서 하기 점수 1위 과제 (§7.7)
  tasks: TaskListItem[];         // 간단한 질문 제외, 멈춘 기간 긴 순 → 진행 중 → 완료
  quickQuestionCount: number;
  relatedProjects: Array<{ project: ProjectRef; reason: string; sharedTopicIds: string[] }>;
}

export interface CreateProjectBody {
  name: string;
  aliases?: string[];
  colorHex?: HexColor;
  status?: ProjectStatus;
}
export interface UpdateProjectBody {
  name?: string;
  aliases?: string[];
  colorHex?: HexColor;
  status?: ProjectStatus;
  thresholds?: Partial<StaleThresholds> | null;
}

/** 주제 노드 패널 (§10.8 선택: 프로젝트/과제/주제별 내용) — 주제는 §8.2 topic 객체 */
export interface TopicDetail {
  id: string;                    // obj_topic_*
  name: string;
  aliases: string[];
  objectStatus: ObjectStatus;
  mentionCount: number;
  firstSeenAt: ISODateTime | null;
  lastSeenAt: ISODateTime | null;
  tasks: TaskListItem[];
  projects: ProjectRef[];
  wikiPages: WikiRef[];          // LATER(5): MVP []
  weeklyMentions: Array<{ start: ISODate; count: number }>;
}

export interface WikiRef {
  id: string;
  title: string;
  draft: boolean;
  updatedAt: ISODateTime | null;
}

// ───────────────────────── 6. 과제 ─────────────────────────
export interface TaskListQuery {
  status?: TaskStatus[];
  kind?: Kind;
  projectId?: string[];          // "none" = 프로젝트 없음
  sourceAi?: SourceAi[];
  from?: ISODate;                // lastActivityAt 기간
  to?: ISODate;
  needsReview?: boolean;
  pinned?: boolean;
  minStaleDays?: number;
  staleStage?: StaleStage[];
  topicId?: string;
  classificationState?: ClassificationState; // 1.1.0 'blocked' = 분류 불가만
  handedOff?: boolean;           // 1.1.0 다른 곳에서 이어감 표시가 있는 과제만(true) / 없는 과제만(false)
  sort?: 'stale_desc' | 'last_activity_desc' | 'started_desc' | 'resume_score_desc' | 'title_asc';
  limit?: number;
  cursor?: string;
}

export interface BoardQuery {
  projectId?: string[];
  sourceAi?: SourceAi[];
  from?: ISODate;
  to?: ISODate;
  needsReview?: boolean;
  doneWithinDays?: number;       // 기본 14 (§10.7 완료(최근 14일))
  columnLimit?: number;          // 열마다 카드 상한, 기본 100
}
export interface BoardColumn {
  status: Extract<TaskStatus, '진행 중' | '멈춤' | '완료' | '간단한 질문'>;
  labelKo: string;               // "완료 (최근 14일)"
  collapsed: boolean;            // 간단한 질문은 true (§10.7)
  total: number;
  items: TaskListItem[];
  hasMore: boolean;
}
export interface BoardResponse {
  columns: BoardColumn[];
  weeklyResumeSuggestions: string[]; // 4–7일 멈춤 "이번 주 이어서 하기" 추천 과제 id (§7.3)
}

export interface Decision {
  id: string;                    // obj_decision_* (§8.2: 결정 객체가 원본, decisions_json은 사본)
  text: string;
  sourceConversationId: string | null;
  sourceAi: SourceAi | null;
  decidedAt: ISODateTime | null;
  valid: boolean;                // 대체·취소되면 false
  overridden: boolean;           // 사용자가 고침
}

export interface OpenQuestion {
  id: string;
  text: string;
  resolved: boolean;
  note: string | null;           // "9.18 ChatGPT 대화 마지막에서"
  sourceConversationId: string | null;
  resolvedAt: ISODateTime | null;
}

export interface ClassificationInfo {
  kind: Kind;
  resolution: Resolution;
  completionReason: CompletionReason | null;
  confidence: number;            // 0..1
  evidence: string | null;       // "“내일 다시 볼게”로 끝남"
  model: string;
  promptVersion: string;         // "cls-v3" (1.2.0) — 코드가 정함, PATCH로 바꿔도 무시
  classifiedAt: ISODateTime;
  needsReview: boolean;          // 확신도 < 기준(0.6) 또는 state='blocked'
  /** 1.1.0 */
  state: ClassificationState;
  blockedReason: string | null;  // state='blocked'일 때 제공자 사유. 예: "PROHIBITED_CONTENT"
  blockedModel: string | null;   // 막은 모델. 예: "gemini-3.5-flash-lite" (model은 대신 쓴 rule-mock)
  rawConfidence: number | null;  // 보정 전 모델이 낸 확신도(평가용). 규칙 분류면 null
  handoff: HandoffInfo | null;
  /** 1.2.0 응답 캐시에서 꺼낸 결과(같은 모델·프롬프트 버전·입력으로 전에 받은 답). 토큰·비용 0 */
  cached: boolean;
}

export interface TaskDetail {
  id: string;
  title: string;
  kind: Kind;
  status: TaskStatus;
  statusSource: StatusSource;
  stale: StaleInfo;
  completionReason: CompletionReason | null;
  project: ProjectRef | null;
  breadcrumb: Array<{ label: string; href: string | null }>; // 그래프 › 블로그 리뉴얼 › 과제
  origin: TaskOrigin;
  pin: boolean;
  overrides: string[];           // 사용자가 고친 필드 목록 (§6.2 overrides)
  startedAt: ISODateTime | null;
  lastActivityAt: ISODateTime | null;
  completedAt: ISODateTime | null;
  firstConversationAt: ISODateTime | null;
  lastConversationAt: ISODateTime | null;
  conversationCount: number;
  messageCount: number;
  byAi: Array<AiCount & { sharedConversationCount: number }>;
  topics: Array<{ id: string; name: string }>;
  summary: string | null;
  summaryDetail: string[];       // 3~5줄 상세 (§6.2 본문, §7.6 detail)
  nextStep: string | null;
  nextStepInfo?: NextStepInfo | null;
  classification: ClassificationInfo | null;
  /** 1.1.0 최신 주 대화 분류의 이어감 표시(= classification.handoff, 목록과 같은 값) */
  handoff: HandoffInfo | null;
  /** 1.5.0 대표(최신 주) 대화의 결과 — TaskListItem.conversationOutcome과 같은 값 */
  conversationOutcome?: ConversationOutcomeInfo | null;
  /** 1.5.0 이 과제의 모든 대화 결과(최신 먼저) — 대화 상세를 따로 부르지 않아도 됨 */
  conversationOutcomes?: Array<{ conversationId: string; sourceAi: SourceAi; title: string; role: 'primary' | 'shared'; updatedAt: ISODateTime; outcome: ConversationOutcomeInfo }>;
  /** 1.1.0 'blocked' = 분류 불가 (분류 전이면 'ok') */
  classificationState: ClassificationState;
  vault: VaultRef;
  decisions: Decision[];
  openQuestions: OpenQuestion[];
  resume: {
    defaultTargetAi: SourceAi;   // 원래 대화 AI
    targets: SourceAi[];         // 탭 4개
    promptPreview: string;       // defaultTargetAi용 맥락 프롬프트 — GET /tasks/:id/resume-prompt(targetAi=defaultTargetAi).prompt 와 글자 하나까지 같다(자르지 않음, 줄임은 화면 몫)
    continue: ContinueTarget | null;
    continueNote: string | null; // "원래 대화(9.18)에 이어 붙임"
  };
  related: {
    similarTasks: Array<TaskRef & { projectName: string | null; sourceAi: SourceAi | null; reason: string; completedAt: ISODateTime | null }>;
    wikiPages: Array<WikiRef & { reviewLabel: string }>;  // LATER(5) — MVP []
  };
  mergeSuggestions: MergeSuggestion[]; // 이 과제가 걸린 대기 중 제안
  neighborCount: number;         // 미니맵 "이웃 6"
  whyStalled: WhyStalled | null; // LATER(1.5) — MVP null
}

/** LATER(1.5) 막힘 사슬 (§8.4 재귀 CTE, §8.7, §10.5) */
export interface WhyStalled {
  chain: Array<{ depth: number; nodeId: string; type: ObjectType; label: string; linkType: 'blocked_by'; confidence: number }>;
  rootCause: string | null;
  lastRelatedConversationId: string | null;
}

export interface FlowQuery {
  filter?: 'all' | 'excerpts' | 'decisions'; // §10.5 전체 / 발췌만 / 결정만
  limit?: number;
  cursor?: string;
}
export interface Excerpt {
  role: MessageRole;
  speakerLabel: string;          // "나" | "ChatGPT" | "Claude" ...
  /** 마크다운. 강조는 *기울임* (디자인의 밑줄 강조) */
  textMd: string;
  messageSeq: number | null;
  isEvidence: boolean;           // 분류 근거 문장 (§6.2 발췌 규칙)
}
export interface FlowEntry {
  conversationId: string;
  sourceAi: SourceAi;
  title: string;
  sourceUrl: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  date: ISODate;                 // 묶음 기준 날짜(마지막 메시지 KST 날짜)
  /** 이 대화와 바로 위(더 최근) 항목 사이의 빈 날 수. 첫 항목은 오늘과의 차이 (§10.5 "12일째 대화 없음") */
  gapDaysFromNewer: number;
  messageCount: number;
  summary: string | null;
  excerpts: Excerpt[];
  decisionIds: string[];
  isPrimary: boolean;            // 이 과제가 주 과제인 대화
  sharedWithTasks: Array<{ id: string; title: string }>; // "‘1차 디자인’과 공유"
  serviceState: ServiceState;
  captureMethod: CaptureMethod;
  isStartOfTask: boolean;        // "이 과제가 시작된 대화"
}
export interface FlowResponse extends ListResponse<FlowEntry> {
  today: { date: ISODate; daysSinceLastConversation: number };
  totalConversations: number;
}

/** PATCH /tasks/:id — 보낸 필드만 바꾸고 overrides에 추가 (§6.2, §7.2-1) */
export interface UpdateTaskBody {
  status?: TaskStatus;           // 보드 끌기, 상태 바꾸기, "보관" 버튼 = '보관'
  projectId?: string | null;
  pin?: boolean;
  title?: string;
  nextStep?: string | null;
  completionReason?: CompletionReason | null; // status '완료'일 때만
  note?: string;                 // events.payload에 남길 메모(선택)
}
export interface UpdateTaskResponse {
  task: TaskDetail;
  event: TimelineEvent;
}

export interface ResetOverridesBody {
  fields: Array<'status' | 'project' | 'pin' | 'title' | 'next_step' | 'decisions' | 'open_questions'>;
}

export interface UpdateOpenQuestionBody { resolved?: boolean; text?: string }
export interface UpdateDecisionBody { text?: string; valid?: boolean }

export interface ResumePromptResponse {
  taskId: string;
  targetAi: SourceAi;
  prompt: string;                // 맥락 요약 프롬프트 (§5.4⑤ get_resume_prompt, §8.7: 결정·막힌 이유 포함)
  continue: ContinueTarget | null; // targetAi가 원래 AI면 원래 대화, 아니면 null(새 대화)
  newChatUrl: string;            // 예: "https://claude.ai/new"
  generatedAt: ISODateTime;
  cached: boolean;               // tasks.resume_prompt 미리 만든 것 (§7.7)
}

export interface MergeTasksBody {
  sourceTaskIds: string[];       // 이 과제(:taskId)로 합칠 과제들
  title?: string;                // 합친 뒤 제목(없으면 대상 과제 제목 유지)
}
export interface MergeTasksResponse {
  task: TaskDetail;
  mergedTaskIds: string[];
  event: TimelineEvent;
}

export interface TimelineEvent {
  id: number;
  at: ISODateTime;
  type: EventType;
  taskId: string | null;
  conversationId: string | null;
  actor: EventActor;
  payload: Record<string, unknown>;
}

// ───────────────────────── 7. 대화 ─────────────────────────
export interface Message {
  id: number;
  seq: number;
  role: MessageRole;
  contentMd: string;
  createdAt: ISODateTime | null;
  /** 1.3.0 음성 대화 전사(ChatGPT 음성 모드). 본문은 전사 글 그대로. 음성이 아니면 필드 없음 */
  voice?: boolean;
}
export interface ConversationDetail {
  id: string;
  sourceAi: SourceAi;
  sourceId: string;
  sourceUrl: string | null;
  title: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  capturedAt: ISODateTime;
  messageCount: number;
  captureMethod: CaptureMethod;
  serviceState: ServiceState;
  pin: boolean;
  isShared: boolean;
  inServiceProject: boolean;
  hasUnextractedArtifact: boolean;
  task: TaskRef | null;
  sharedWithTasks: Array<{ id: string; title: string }>;
  classification: ClassificationInfo | null;
  vault: VaultRef;
  rawPath: string | null;
  /** 1.4.0 대화 결과 배지. 엔진은 항상 보냄 */
  outcome?: ConversationOutcomeInfo | null;
  messages: ListResponse<Message>;   // ?limit&cursor 로 페이지
}

// ───────────────────────── 8. 과제 합치기 제안 ─────────────────────────
/** §6.1 "같은 과제일 수 있음" 제안 · §7.6 same_task_candidates · §7.7 "이어짐" */
export interface MergeSuggestion {
  id: string;
  state: MergeSuggestionState;
  confidence: number;
  reason: string;                // "같은 주제 #카피라이팅, 9.12 ChatGPT 대화를 9.18에 이어감"
  tasks: [TaskRef & { sourceAis: SourceAi[] }, TaskRef & { sourceAis: SourceAi[] }];
  suggestedPrimaryTaskId: string;
  createdAt: ISODateTime;
  decidedAt: ISODateTime | null;
  /** 1.5.0 same_task = 분류기의 같은 과제 후보 · handoff_session = "Claude Code에서 이어감"으로 끝난 대화 ↔ 로컬 세션(§12.10.5). 없으면 same_task */
  kind?: 'same_task' | 'handoff_session';
  /** 1.5.0 kind=handoff_session일 때 근거 점수 */
  handoff?: HandoffSessionMatch | null;
}
/** 1.5.0 넘겨준 대화 ↔ 로컬 세션 짝 근거. score = 0.45·시간 + 0.30·글 유사도 + 0.25·프로젝트/폴더 */
export interface HandoffSessionMatch {
  fromConversationId: string;    // 넘겨준 채팅 대화(claude·chatgpt…)
  sessionConversationId: string; // 이어받은 로컬 세션(claude-code·codex)
  target: string | null;         // 넘겨준 대화의 handoff.target ("Claude Code")
  gapMinutes: number;            // 넘겨준 대화 마지막 메시지 → 세션 첫 사용자 메시지
  textSimilarity: number;        // 0–1 글자 2-gram (넘겨준 대화 끝 3개 메시지 ↔ 세션 첫 3개 사용자 메시지)
  projectMatch: 'same_project' | 'cwd_name' | 'none';
  /** Codex `thread_source: chatgpt_handoff`처럼 세션이 넘겨준 대화 id를 직접 적은 경우 true(점수 0.95 고정) */
  explicitRef: boolean;
  cwd: string | null;
  score: number;
}
export interface AcceptMergeBody { primaryTaskId?: string; title?: string }
export interface AcceptMergeResponse { suggestion: MergeSuggestion; task: TaskDetail }
export interface RejectMergeBody { reason?: string }
/** accept와 같은 모양. task = 제안이 남기려던 과제(suggestedPrimaryTaskId)의 최신 상세 */
export interface RejectMergeResponse { suggestion: MergeSuggestion; task: TaskDetail }

// ───────────────────────── 8-2. 새 프로젝트 제안 (1.1.0, §7.6 new_project_suggestion · §7.7) ─────────────────────────
/**
 * 분류기가 기존 프로젝트에 맞지 않는다며 new_project_suggestion을 내면, 같은(비슷한) 이름끼리 묶어 제안 하나로 모은다.
 * 프로젝트 정보가 없는 Claude 2026-10 내보내기에서는 이것이 대화 → 프로젝트 연결의 유일한 자동 경로다.
 * 과제가 minTasks(3)개 이상 모이면 ready → 오늘의 요약·배지에 노출. 자동화 단계 L4면 ready가 되는 순간 자동 생성(accept와 같은 동작).
 */
export interface ProjectSuggestion {
  id: string;                    // psg_xxxxxx
  name: string;                  // 처음 제안된 이름(수락 때 바꿀 수 있음)
  altNames: string[];            // 비슷하다고 보고 함께 묶은 다른 제안 이름
  state: ProjectSuggestionState;
  ready: boolean;                // taskCount >= minTasks
  taskCount: number;             // 아직 프로젝트가 없는 연결 과제 수(이미 프로젝트가 생긴 과제는 빠짐)
  minTasks: number;              // 3 (§7.7)
  tasks: Array<TaskRef & { sourceAis: SourceAi[] }>;
  projectId: string | null;      // accepted면 만든(또는 같은 이름이라 합친) 프로젝트
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  decidedAt: ISODateTime | null;
}
export interface ProjectSuggestionsQuery { state?: ProjectSuggestionState; ready?: boolean; limit?: number; cursor?: string }
/** POST /project-suggestions/:id/accept — 이름이 기존 프로젝트와 같으면 새로 만들지 않고 그 프로젝트에 붙인다 */
export interface AcceptProjectSuggestionBody { name?: string; colorHex?: HexColor; taskIds?: string[] }
export interface AcceptProjectSuggestionResponse { suggestion: ProjectSuggestion; project: ProjectSummary; attachedTaskIds: string[] }
/** 1.2.0 POST /project-suggestions/:id/reject 본문(비어 있어도 됨) */
export interface RejectProjectSuggestionBody { reason?: string }
export interface RejectProjectSuggestionResponse { suggestion: ProjectSuggestion }

// ───────────────────────── 9. 오늘의 요약 ─────────────────────────
export interface DigestListItem {
  date: ISODate;
  generatedAt: ISODateTime;
  title: string;
  strip: DigestStrip;
}
export interface DigestStrip {
  yesterdayConversations: number; // 어제 대화
  completedTasks: number;         // 끝낸 과제
  newlyStalled: number;           // 새로 멈춘 일
  quickQuestions: number;         // 간단한 질문
  collectionGap: { hasGap: boolean; hours: number | null; label: string }; // "없음" / "6시간"
}
export interface DigestEvent {
  at: ISODateTime | null;         // 규칙 계산은 새벽 시각
  timeLabel: string;              // "오전 10:12" | "새벽 계산"
  actor: EventActor;
  sourceAi: SourceAi | null;
  action: DigestEventAction;
  actionLabel: string;            // "완료" | "시작" | "이어감" | "멈춤"
  tasks: Array<{ id: string; title: string }>;
  project: ProjectRef | null;
  note: string | null;            // "→ 위키 초안 1건", "블로그 리뉴얼 · 메시지 6개 추가"
}
export interface DigestPick {
  rank: number;                   // 1..3
  task: TaskRef;
  project: ProjectRef | null;
  freshnessLabel: string;         // "12일째" | "어제"
  nextStep: string;
  reason: string;                 // "블로그 리뉴얼 · 다음 단계가 분명하고 ..."
  recommendedAi: SourceAi;
  actionLabel: string;            // "ChatGPT에서 이어서" | "Claude로 넘겨서 이어서"
  continue: ContinueTarget | null; // 원래 AI와 같을 때만
  resumeScore: number;            // §7.7 점수
}
export interface DigestResponse {
  date: ISODate;
  generatedAt: ISODateTime;
  title: string;                  // "9월 30일 수요일 아침"
  prevDate: ISODate | null;
  nextDate: ISODate | null;
  vault: VaultRef;                // daily/2026-09-30.md
  strip: DigestStrip;
  yesterday: {
    date: ISODate;
    narrative: string;            // 짧은 서술(LLM 또는 규칙, §12.2 끄면 규칙 요약)
    events: DigestEvent[];
  };
  collectionStatus: CollectionSourceStatus[];
  thisWeek: { rangeLabel: string; items: string[] };
  todayPicks: DigestPick[];       // 오늘 이어서 할 것 Top 3
  longNeglected: { count: number; items: TaskRef[]; prompt: string }; // 31일+ (§7.3, §7.7 주간 정리 질문)
  movedProjects: Array<{ project: ProjectRef; messageCount: number; note: string; becameStalled: boolean }>;
  quickQuestionsByAi: Array<{ sourceAi: SourceAi; count: number }>;
  pendingMergeSuggestions: MergeSuggestion[];
  /** 1.1.0 "요약에서 한 번 눌러 승인"(§7.7) — ready인 대기 중 새 프로젝트 제안. 엔진은 항상 보냄 */
  pendingProjectSuggestions?: ProjectSuggestion[];
  alerts: Array<{ level: 'info' | 'warn' | 'error'; message: string; sourceAi: SourceAi | null }>;
  ontology: DigestOntologyCard | null;  // LATER(1.5) — MVP null
  cleanup: DigestCleanup | null;        // LATER(6)  — MVP null
}

/** LATER(1.5) 제안 검토 카드 (§10.6, §10.11) */
export interface DigestOntologyCard {
  newlyLinkedCount: number;
  pendingCount: number;
  items: OntologySuggestion[];   // 확신도 높은 순 일부
}
export interface OntologySuggestion {
  id: string;
  kind: 'object' | 'link' | 'merge';
  confidence: number;
  text: string;                  // "[과제] 카피 확정 —막혔음→ [과제] 디자이너 답변 대기"
  linkType: LinkType | null;
  src: { id: string; type: ObjectType; label: string } | null;
  dst: { id: string; type: ObjectType; label: string } | null;
  evidenceCount: number;
  evidence: Array<{ conversationId: string; sourceAi: SourceAi; excerpt: string; at: ISODateTime }>;
}

/** LATER(6) 삭제 배치 상태. postponed = "내일 다시 묻기"(POST /deletion-batches/:id/postpone) */
export type DeletionBatchState = 'pending' | 'approved' | 'running' | 'paused' | 'postponed' | 'done' | 'cancelled';
/** LATER(6) 하루 한 번 승인 · 채팅창 정리 (§10.6, §11) */
export interface DigestCleanup {
  autoArchived: Array<{ sourceAi: SourceAi; count: number; note: string }>; // "언제든 보관 해제 가능"
  deletionBatch: {
    id: string;
    state: DeletionBatchState;
    selectedCount: number;
    candidateCount: number;
    groups: Array<{
      sourceAi: SourceAi;
      selected: number;
      total: number;
      backupVerified: boolean;   // "원문·노트 저장 확인됨"
      items: Array<{ itemId: number; conversationId: string; title: string; kindLabel: string; date: ISODate; selected: boolean; excludedByUser: boolean }>;
    }>;
    autoExcluded: Array<{ count: number; sourceAi: SourceAi | null; reason: string }>;
    estimate: { perItemSec: number; totalMin: number; label: string };
  } | null;
}

/** LATER(6) 삭제 배치 (GET /deletion-batches/:id 응답의 batch — 요약에 실리는 것과 같은 모양, 항목은 전부) */
export type DeletionBatch = NonNullable<DigestCleanup['deletionBatch']>;
/** LATER(6) PATCH /deletion-batches/:id/items/:itemId */
export interface SetDeletionItemBody { selected: boolean }
/**
 * LATER(6) POST /deletion-batches/:id/approve — [잠정]
 * expectedSelectedCount: 사용자가 화면에서 본 선택 수. 서버 값과 다르면 409(화면이 낡음).
 * excludedItemIds: 승인 직전에 뺀 항목. confirmPhrase: 판매용 빌드에서 필수("32개 삭제", §9.2.4)
 */
export interface ApproveDeletionBody { expectedSelectedCount: number; excludedItemIds: number[]; confirmPhrase?: string }
/** LATER(6) GET /deletion-batches/:id · approve · postpone · PATCH items 공통 응답 — [잠정] */
export interface DeletionBatchResponse { batch: DeletionBatch }

// ───────────────────────── 10. 검색 ─────────────────────────
export interface SearchQuery {
  q: string;
  types?: SearchResultType[];    // 기본 task,conversation,message,decision
  projectId?: string[];
  sourceAi?: SourceAi[];
  status?: TaskStatus[];
  from?: ISODate;
  to?: ISODate;
  limit?: number;                // 기본 20
  cursor?: string;
}
export interface SearchHit {
  type: SearchResultType;
  id: string;                    // 결과 자체 id (메시지는 message id 문자열)
  title: string;
  snippetMd: string;             // 일치 부분은 **굵게**
  task: TaskRef | null;          // 이동 대상 과제
  conversationId: string | null;
  sourceAi: SourceAi | null;
  sourceUrl: string | null;
  vaultPath: string | null;
  at: ISODateTime | null;
  score: number;
}
export interface SearchResponse extends ListResponse<SearchHit> {
  query: string;
  terms: Array<{ term: string; mode: SearchMode }>; // 단어별로 쓴 방식 (§6.4)
  notice: string | null;         // "2글자 검색은 느린 전체 검색으로 찾았어요" 등
  tookMs: number;
}

// ───────────────────────── 11. 가져오기 · 작업 · 분류 ─────────────────────────
export interface ImportPreview {
  sourceAi: SourceAi;
  /** 1.1.0: Claude 2026-10 카테고리별 ZIP 중 projects-000.zip → claude_projects_zip, memories-000.zip → claude_memories_zip */
  detectedFormat: 'chatgpt_export_zip' | 'chatgpt_conversations_json' | 'claude_export_zip' | 'claude_conversations_json' | 'claude_projects_zip' | 'claude_memories_zip'
    | 'gemini_takeout_html' | 'gemini_takeout_json'
    | 'grokbot_json'; // 1.10.0 Grok Bot 대화(Claude conversations.json 모양, sourceAi 'grokbot') // 1.2.0 Google Takeout "내 활동 > Gemini 앱" (ZIP 안이든 파일 하나든)
  formatVersion: string | null;
  /** 1.1.0 무엇을 들여오는 파일인지. projects = 프로젝트 목록만(대화 0개), memories = 들여올 것 없음(시작하면 아무것도 바꾸지 않고 끝남) */
  category: 'conversations' | 'projects' | 'memories';
  /** 1.1.0 category='projects'일 때만. 이름이 같은 기존 프로젝트는 건너뜀 */
  projects: { total: number; new: number; existing: number; skipped: number; names: string[] } | null;
  conversationsTotal: number;
  conversationsNew: number;
  conversationsUpdated: number;
  conversationsUnchanged: number;
  messagesTotal: number;
  dateRange: { from: ISODateTime | null; to: ISODateTime | null };
  quickQuestionPrefiltered: number; // 규칙으로 걸러 LLM 생략할 예상 수 (§15.2)
  /** 1.2.0 활동 기록 형식(Gemini Takeout)일 때만: 질문·응답 기록 events개를 대화 conversations개로 다시 묶은 결과. 다른 형식이면 null */
  activity: GeminiActivityPreview | null;
  estimate: {
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;      // 가격을 모르면 null
    note: string;                // "가격표 기준 추정 [미검증]"
  };
  warnings: string[];
}
/** 1.2.0 Gemini Takeout 미리보기 — 기록(질문 1개 + 응답 1개)을 대화로 다시 묶은 내역 */
export interface GeminiActivityPreview {
  events: number;              // 질문·응답 기록 수(Gemini 앱 기록만)
  skipped: number;             // 뺀 기록(다른 제품 기록, 피드백, 내용 없음)
  conversations: number;       // 다시 묶은 대화 수 (= conversationsTotal)
  byConversationId: number;    // 기록에 대화 주소(gemini.google.com/app/<id>)가 있어 그대로 묶은 대화 수
  bySession: number;           // 주소가 없어 시간 간격 + 주제 연속성으로 묶은 대화 수
  sessionGapMinutes: number;   // 쓴 시간 간격(기본 30분, 가져오기 때 바꿀 수 있음)
  missingResponses: number;    // 응답 본문이 비어 있던 기록 수(Takeout이 응답을 빼거나 자르는 일이 흔함)
  attachments: number;         // 첨부·캔버스 언급이 있던 기록 수
  timezoneAssumed: number;     // HTML 날짜에 시간대가 없거나 몰라서 Asia/Seoul로 본 기록 수
}
export interface ImportProgress {
  phase: ImportState;
  processed: number;
  total: number;
  percent: number;               // 0..100 (전체 단계 합산)
  currentLabel: string | null;   // "분류 중 · 312 / 1,204"
  etaSec: number | null;
}
export interface ImportJob {
  id: string;
  state: ImportState;
  sourceAi: SourceAi | null;
  fileName: string;
  fileSizeBytes: number;
  fileHash: string;              // "sha256:…"
  createdAt: ISODateTime;
  startedAt: ISODateTime | null;
  finishedAt: ISODateTime | null;
  options: StartImportBody;
  preview: ImportPreview | null; // state >= preview_ready
  progress: ImportProgress;
  result: {
    conversationsNew: number;
    conversationsUpdated: number;
    skippedDuplicates: number;
    tasksCreated: number;
    classified: number;
    classificationDeferred: number; // 비용 상한으로 미룸
    actualCostUsd: number | null;
    unfinishedTasks: number;      // "아직 안 끝난 것처럼 보이는 과제" (§3 시나리오 D)
    projectsCreated: number;      // 1.1.0 projects ZIP에서 만든 프로젝트 수(대화 ZIP이면 0)
  } | null;
  errors: Array<{ conversationSourceId: string | null; message: string }>;
  classifyJobId: string | null;
}
export interface StartImportBody {
  classify?: boolean;            // 기본 true
  maxCostUsd?: number | null;    // 넘으면 나머지는 deferred
  onlyNewSince?: ISODate | null;
}

export interface Job {
  id: string;
  type: JobType;
  state: JobState;
  createdAt: ISODateTime;
  startedAt: ISODateTime | null;
  finishedAt: ISODateTime | null;
  progress: { processed: number; total: number | null; percent: number | null };
  label: string;                 // "분류 · 가져오기 imp_20260930_k3f9"
  parentId: string | null;       // 예: import id
  error: string | null;
  costUsd: number | null;
}

export interface ClassificationStatus {
  queue: { pending: number; running: number; deferred: number; failedToday: number };
  /** 1.2.0 cacheHits = 응답 캐시로 처리한 수.
   *  1.3.0 costUsd: 가격을 모르는 모델로 분류한 것이 오늘 하나라도 있으면 null("알 수 없음" — $0 아님). costUsdKnown = 가격을 아는 것만 더한 값, costUnknownCount = 가격 모르는 분류 수 */
  today: { classified: number; inputTokens: number; outputTokens: number; costUsd: number | null; costUsdKnown: number; costUnknownCount: number; cacheHits: number };
  dailyCapUsd: number | null;
  capReached: boolean;
  model: string | null;
  promptVersion: string;
  needsReviewCount: number;      // 1.1.0부터 분류 불가(blocked) 과제 포함
  blockedCount: number;          // 1.1.0 분류 불가(제공자 안전 차단) 과제 수
  lastRunAt: ISODateTime | null;
}
export interface RunClassificationBody {
  scope: 'unclassified' | 'changed' | 'needs_review' | 'conversations' | 'project';
  conversationIds?: string[];    // scope='conversations'
  projectId?: string;            // scope='project'
  /** 1.2.0 true면 응답 캐시를 건너뛰고 모델을 새로 부른다(새 답을 캐시에 덮어씀). 기본 false */
  refreshCache?: boolean;
  force?: boolean;               // 사용자 고정값(overrides)은 force여도 안 바꿈. 1.1.0: 분류 불가(blocked)는 내용이 바뀌거나 force·conversations 범위일 때만 다시 시도
}

// ───────────────────────── 12. 설정 ─────────────────────────
/** §7.2-6, §7.3 기준 일수 (기본 3 / 7 / 30 / 90, [결정 필요] 기본값) */
export interface StaleThresholds {
  inProgressMaxDays: number;     // 이 일수 이하면 진행 중 (기본 3)
  shortPauseMaxDays: number;     // 잠깐 멈춤 상한 (기본 7)
  staleMaxDays: number;          // 방치 상한 (기본 30)
  longStaleMaxDays: number;      // 오래 방치 상한 (기본 90), 초과 = 휴면
}
export interface Settings {
  llm: {
    provider: LlmProvider | null;
    model: string | null;
    baseUrl: string | null;      // ollama 등
    apiKeySet: boolean;          // 키 값은 절대 내보내지 않음
    dailyCostCapUsd: number | null;
    redactSecrets: boolean;      // §7.5 (항상 true 권장)
    sensitiveKeywords: string[]; // §12.2 민감 프로젝트 모드
    sensitiveProjectIds: string[];
  };
  classification: {
    lowConfidenceThreshold: number; // 0.6 (§7.6 "확인 필요")
    promptVersion: string;
    condenseHead: number;        // 3 (§7.5)
    condenseTail: number;        // 6
    condenseMiddleChars: number; // 200
  };
  thresholds: StaleThresholds;
  ontology: {                    // LATER(1.5) 적용, 값은 MVP부터 저장
    enabled: boolean;
    autoAcceptMin: number;       // 0.85 (§8.6)
    suggestMin: number;          // 0.6
    enabledTypes: ObjectType[];
    showPersonNames: boolean;    // §8.8, §12.2
  };
  vault: {
    path: string;
    name: string;                // Obsidian 볼트 이름(obsidianUri용)
    includeFullTranscript: boolean; // §6.2 기본 false
    rawLocation: 'inside_vault' | 'outside_vault';
    rawHtmlRetentionDays: number;   // 30
    gitAutoCommit: boolean;
  };
  digest: {
    time: string;                // "08:00"
    osNotification: boolean;
    writeDailyNote: boolean;
    llmNarrative: boolean;       // false면 규칙 요약
  };
  automation: {
    level: AutomationLevel;      // 개인용 기본 L3 (MVP는 표시만)
    catchupIntervalHours: number; // 3   LATER(3.5)
    catchupMaxPerRun: number;     // 20
    catchupMinIntervalSec: number; // 15
  };
  server: { port: number; devOrigins: string[] };
}
/** PATCH /settings 본문 = Settings의 깊은 부분집합(apiKeySet 제외) */
export type UpdateSettingsBody = {
  [K in keyof Settings]?: Partial<Settings[K]>;
};
export interface PutLlmKeyBody { provider: LlmProvider; apiKey: string }
export interface LlmTestResponse { ok: boolean; provider: LlmProvider; model: string; latencyMs: number | null; message: string }

// ───────────────────────── 13. 볼트 ─────────────────────────
export interface VaultConflict {
  path: string;
  entityType: 'conversation' | 'task' | 'project' | 'wiki' | 'daily';
  entityId: string;
  detectedAt: ISODateTime;
  backupPath: string;            // .subbrain/conflicts/...
}

// ═════════════════════════ 1.5.0 계약 — 온톨로지(Phase 1.5) · 확장 수집(Phase 3) · 로컬 세션 수집기 ═════════════════════════
// 온톨로지·수집 경로는 **모양만 고정**(코어는 아직 501 NOT_IMPLEMENTED, §14). 로컬 세션 수집기(§12.10)는 1.5.0에서 구현됨.

// ───────── 14.2 온톨로지 (설계서 v1.1 8장) ─────────
/** 객체 상태. merged = 다른 객체로 합쳐짐(mergedInto). 화면·검색 기본은 accepted만 */
export type OntologyStatus = 'accepted' | 'suggested' | 'rejected' | 'merged';
export interface ObjectRef { id: string; type: ObjectType; label: string }
/** 출처 한 건(설계서 8.4 evidence). 웹 목의 [AI, 날짜, 대화 제목, 발췌] 튜플을 객체로 */
export interface OntologyEvidence {
  id: number;
  conversationId: string;
  sourceAi: SourceAi;
  conversationTitle: string;
  messageSeq: number | null;
  excerpt: string;               // ≤300자, 비밀정보 가림 적용
  at: ISODateTime;               // 근거 메시지 시각(없으면 대화 마지막 활동)
  confidence: number | null;
  model: string | null;          // 'rule' 또는 모델 id
}
export interface OntologyObject {
  id: string;                    // obj_<type>_<짧은 id>
  type: ObjectType;
  name: string;
  aliases: string[];
  status: OntologyStatus;
  confidence: number | null;     // user가 만든 것은 null
  origin: OntologyOrigin;
  firstSeenAt: ISODateTime;
  lastSeenAt: ISODateTime;
  mentionCount: number;
  properties: Record<string, string | number | boolean>;  // 화면 표시용 키는 한국어 그대로 허용("상태", "후보")
  /** project·task·topic 객체가 가리키는 기존 행(값의 원본은 그 테이블) */
  ref: { table: 'projects' | 'tasks' | 'topics'; id: string } | null;
  projectObjectId: string | null;    // 이 객체가 속한 프로젝트 객체(part_of에서 파생, 색 묶음용)
  colorHex: HexColor | null;         // project 객체만(프로젝트 색)
  statusVisual: StatusVisual | null; // task 객체만(과제 상태에서 파생)
  badge: string | null;              // task 객체 "14일" 같은 멈춘 일수
  mergedInto: string | null;
  evidencePreview: OntologyEvidence[]; // 최근 ≤3개(전부는 GET /objects/:id)
}
export interface OntologyLink {
  id: string;                    // lnk_<숫자>
  type: LinkType;
  srcId: string;
  dstId: string;
  status: LinkStatus;
  confidence: number | null;
  origin: OntologyOrigin;
  mentionCount: number;          // 같은 관계가 나온 출처 수
  validFrom: ISODateTime | null;
  endedAt: ISODateTime | null;   // 해소·대체(삭제하지 않음, 8.3)
  firstSeenAt: ISODateTime;
  lastSeenAt: ISODateTime;
  properties: Record<string, string>;
  evidencePreview: OntologyEvidence | null; // 가장 최근 근거 1개
}
/** GET /ontology — 온톨로지 모드 화면 한 번에(웹 목 ontology.json과 같은 역할) */
export interface OntologyQuery {
  objectTypes?: ObjectType[];
  linkTypes?: LinkType[];        // 기본: related_to 제외 전부
  status?: Array<'accepted' | 'suggested'>; // 기본 accepted,suggested (rejected·merged는 안 옴)
  projectId?: string;            // 그 프로젝트 객체 2단계 이웃만
  includeEnded?: boolean;        // 기본 true(끝난 관계도 흐리게 그림)
  minMentions?: number;          // 기본 1. 2면 한 번만 언급된 객체 숨김(8.10)
}
export interface OntologyGraphResponse {
  today: ISODate;
  objects: OntologyObject[];
  links: OntologyLink[];
  suggestions: OntologySuggestion[];   // 대기 중(pending) 제안 — 확신도 높은 순
  counts: { objects: number; links: number; pendingSuggestions: number; hiddenSingleMention: number };
  truncated: boolean;            // 객체 1500개 초과 시 언급 적은 것부터 잘림
}
/** 제안 이유 코드(8.6 예외 규칙) */
export type OntologySuggestionReason = 'mid_confidence' | 'first_seen_person' | 'supersedes' | 'merge_candidate' | 'repeated';
/** 1.5.0 OntologySuggestion(§10.2 digest 카드)에 더한 필드 — 모두 선택 */
export interface OntologySuggestion {
  state?: 'pending' | 'accepted' | 'rejected';
  linkId?: string | null;          // kind=link → 제안 상태 관계 id
  objectId?: string | null;        // kind=object → 제안 상태 객체 id
  merge?: { keepId: string; mergeId: string } | null; // kind=merge → 남길 객체·합칠 객체
  reason?: OntologySuggestionReason;
  note?: string | null;            // "처음 보는 사람이라 확신도와 상관없이 제안으로 둠"
  createdAt?: ISODateTime;
}
export interface ListObjectsQuery { type?: ObjectType[]; q?: string; status?: OntologyStatus[]; limit?: number; cursor?: string }
export interface ListObjectsResponse { items: OntologyObject[]; total: number; nextCursor: string | null }
/** GET /objects/:id — 객체 상세 패널(관계 목록·출처·스파크라인) */
export interface ObjectDetail {
  object: OntologyObject;
  links: Array<OntologyLink & { direction: 'out' | 'in'; other: ObjectRef & { status: OntologyStatus } }>;
  evidence: OntologyEvidence[];          // 최신순, 최대 50(evidenceTotal로 전체 수)
  evidenceTotal: number;
  mentionsByWeek: Array<{ week: ISODate; count: number }>; // 스파크라인(주 시작 월요일)
  relatedTasks: TaskRef[];               // uses·references·part_of로 이어진 과제
}
export interface PatchObjectBody { name?: string; aliases?: string[]; properties?: Record<string, string | number | boolean | null> } // null = 속성 지움
export interface MergeObjectBody { intoId: string }
/** 합친 결과: 남은 객체 상세 + 되돌리기용 이벤트 id */
export interface MergeObjectResponse { object: ObjectDetail; eventId: number }
/** 나누기: 지정한 별칭·출처·관계를 새 객체로 옮김 */
export interface SplitObjectBody { newName: string; aliases?: string[]; evidenceIds?: number[]; linkIds?: string[] }
export interface SplitObjectResponse { original: ObjectDetail; created: ObjectDetail; eventId: number }
export interface EndLinkBody { endedAt?: ISODateTime; note?: string }
export interface EndLinkResponse { link: OntologyLink; eventId: number }
/** POST /ontology/events/:eventId/undo — 합치기·나누기·끊기·확정·거절 되돌리기 */
export interface UndoOntologyResponse { undone: boolean; eventId: number; affected: { objectIds: string[]; linkIds: string[] } }
export interface ListSuggestionsQuery { kind?: Array<'object' | 'link' | 'merge'>; minConfidence?: number; limit?: number; cursor?: string }
export interface ListSuggestionsResponse { items: OntologySuggestion[]; total: number; nextCursor: string | null }
export interface AcceptSuggestionResponse { suggestion: OntologySuggestion; objects: OntologyObject[]; links: OntologyLink[]; eventId: number }
export interface RejectSuggestionBody { reason?: string }
export interface RejectSuggestionResponse { suggestion: OntologySuggestion; eventId: number }
/** "확신도 0.8 이상 모두 확정" 또는 ids 지정. 사람 첫 등장·supersedes·merge는 bulk에서 빠짐(skipped) */
export interface BulkAcceptSuggestionsBody { minConfidence?: number; kind?: Array<'object' | 'link' | 'merge'>; ids?: string[] }
export interface BulkAcceptSuggestionsResponse { accepted: string[]; skipped: Array<{ id: string; reason: 'protected' | 'not_pending' | 'below_threshold' }> }
/** GET /tasks/:id/why-stalled — 막힘 사슬(blocked_by 재귀, 최대 5단계, 8.4 CTE) */
export interface WhyStalledResponse {
  taskId: string;
  objectId: string | null;       // 과제 객체가 아직 없으면 null(chain 빈 배열)
  task: { status: TaskStatus; staleDays: number | null };
  chain: Array<{ depth: number; link: OntologyLink; object: ObjectRef & { status: OntologyStatus; taskStatus: TaskStatus | null } }>;
  /** 사슬 끝(더 막힌 것 없음)에 있는 원인 */
  rootCauses: Array<{ object: ObjectRef; kind: 'waiting_person' | 'undecided' | 'blocked_task' | 'external' | 'other'; label: string }>;
  ended: OntologyLink[];         // 이미 풀린 막힘(ended_at 있음) — "예전엔 X 때문이었음"
  suggested: OntologyLink[];     // 확정 안 된 막힘 관계(흐리게, "확인 필요")
  lastConversation: { id: string; title: string; sourceAi: SourceAi; at: ISODateTime } | null;
  explanation: string;           // 규칙으로 만든 한 줄 설명. 예: "‘디자이너 답변 대기’(사람 답 기다림) 때문에 14일째 멈춤"
}
export interface ImpactResponse {
  objectId: string;
  affected: Array<{ object: ObjectRef; via: LinkType[]; depth: number; superseded: boolean }>;
  supersededBy: ObjectRef | null;
}
export interface SimilarQuery { text: string; limit?: number }
export interface SimilarResponse {
  items: Array<{ task: TaskRef; score: number; sharedObjects: ObjectRef[]; decisions: string[]; blockers: string[]; completedAt: ISODateTime | null }>;
}
export interface GraphPathQuery { from: string; to: string; maxDepth?: number } // 기본 4, 최대 6
export interface GraphPathResponse { found: boolean; objects: ObjectRef[]; links: OntologyLink[]; usedSuggested: boolean }
/** 1.7.0 POST /ontology/extract — 객체·관계 뽑기 작업(202 Job, type extract_ontology).
 * 규칙 추출은 키 없이도 늘 돌고(분류가 끝날 때마다 자동), LLM 추출(ont-v1)은 이 작업으로만(비용 때문). */
export interface OntologyExtractBody {
  scope?: 'changed' | 'all';     // 기본 changed = LLM으로 아직 안 뽑았거나 내용이 바뀐 대화
  taskIds?: string[];
  llm?: boolean;                 // 기본 true(키가 있으면). false면 규칙만
  mode?: 'rules' | 'all';        // 1.7.1 'rules' = llm:false와 같음(규칙만, LLM 호출 없음, 멱등)
  maxCostUsd?: number | null;    // 넘으면 멈춤(deferred)
}
/** 1.7.0 GET /ontology/status */
export interface OntologyStatusResponse {
  objects: Partial<Record<ObjectType, number>>;
  links: number;
  pendingSuggestions: number;
  llmExtractedConversations: number;
  extractableConversations: number;  // 과제(간단한 질문·보관 제외)의 주 대화
  promptVersion: string;
  lastRunAt: ISODateTime | null;
  costUsdTotal: number | null;
  llmConfigured: boolean;
}

// ───────── 14.3 확장 프로그램 수집 (Phase 3, 설계서 5.4①-A · 6.3 sync_state · 12.4) ─────────
export type PairingClientKind = 'extension' | 'mcp' | 'collector';
export type PairingScope = 'ingest' | 'read' | 'mcp_write';
/** POST /pairing (웹앱, 같은 origin) — 6자리 코드 발급(5분) */
export interface StartPairingBody { kind: PairingClientKind; name?: string; /** 1.9.0 kind 'mcp'만: true면 scopes에 mcp_write(기본 false = 읽기만) */ allowWrite?: boolean }
export interface StartPairingResponse { pairingId: string; code: string; expiresAt: ISODateTime; kind: PairingClientKind }
/** POST /pairing/complete (확장·MCP가 부름) — 코드 + 자기 정보 → 토큰(이 응답에서 한 번만 보임) */
export interface CompletePairingBody {
  code: string;
  client: { kind: PairingClientKind; name: string; version: string; extensionId?: string }; // extension이면 extensionId 필수, Origin과 같아야 함
}
export interface CompletePairingResponse { token: string; client: PairedClient }
export interface PairedClient {
  tokenId: string;               // pat_xxxx (토큰 자체가 아님)
  kind: PairingClientKind;
  name: string;
  extensionId: string | null;
  scopes: PairingScope[];        // extension=[ingest], mcp=[read](+mcp_write 선택), collector=[ingest]
  createdAt: ISODateTime;
  lastUsedAt: ISODateTime | null;
  rotatedAt: ISODateTime | null;
  revokedAt: ISODateTime | null;
}
export interface ListPairedClientsResponse { items: PairedClient[] }
/** POST /pairing/clients/:tokenId/rotate — 그 토큰으로 부름. 옛 토큰은 graceSeconds(300) 동안 함께 유효 */
export interface RotateTokenResponse { token: string; client: PairedClient; previousValidUntil: ISODateTime }
/** GET /session — 지금 요청의 주체 */
export interface SessionResponse { kind: 'web' | PairingClientKind; client: PairedClient | null; scopes: PairingScope[] }

export type IngestStatus = 'accepted' | 'duplicate' | 'partial' | 'stale';
export interface IngestMessage {
  seq: number;                   // 대화 안 0부터 순서
  externalId: string | null;     // 서비스 메시지 id(있으면 갱신 판단에 씀)
  role: MessageRole;
  contentMd: string;
  createdAt: ISODateTime | null;
  voice?: boolean;
}
/** POST /ingest/snapshot 본문 */
export interface IngestSnapshotBody {
  sourceAi: ChatSourceAi;
  sourceId: string;              // 서비스 대화 id
  url: string | null;
  title: string;
  capturedAt: ISODateTime;       // 확장이 찍은 시각(오프라인 재전송 때도 원래 시각)
  serviceUpdatedAt: ISODateTime | null;
  captureMethod: 'extension_live' | 'extension_catchup';
  /** full = 대화 전체 · append = appendFromSeq 이후만(baseContentHash 필요) */
  mode: 'full' | 'append';
  appendFromSeq?: number;
  baseContentHash?: string | null;   // append일 때 서버가 가진 해시(전에 받은 contentHash)
  messages: IngestMessage[];
  contentHash: string;           // sha256(전체 메시지 role+"\0"+contentMd 를 "\n\0"로 이음) — 서버가 다시 계산해 다르면 400
  /** false = 답이 아직 스트리밍 중(부분 저장, 분류 안 함). 마지막 조각에 true */
  complete: boolean;
  adapter: { name: string; version: string; domVersion?: string | null };
  project?: { externalId: string; name: string } | null;  // 서비스 쪽 프로젝트(ChatGPT 프로젝트·Claude 프로젝트)
}
export interface IngestSnapshotResponse {
  status: IngestStatus;
  idempotencyKey: string;        // `${sourceAi}:${sourceId}:${contentHash}`
  conversationId: string;
  taskId: string | null;
  contentHash: string;           // 서버가 저장한 지금 해시(다음 append의 baseContentHash)
  messageCount: number;
  classification: 'queued' | 'debounced' | 'not_needed' | 'skipped';
  receivedAt: ISODateTime;
}
/** POST /ingest/replay — 오프라인 버퍼 일괄 재전송(≤20개, 오래된 것부터) */
export interface IngestReplayBody { snapshots: IngestSnapshotBody[] }
export interface IngestReplayResponse {
  results: Array<{ index: number; ok: true; result: IngestSnapshotResponse } | { index: number; ok: false; error: ApiError }>;
}
/** POST /ingest/catchup/diff — 사이드바 목록을 보내면 가져와야 할 것만 돌려줌(목록이 길어 GET 대신 POST) */
export interface CatchupDiffBody {
  sourceAi: ChatSourceAi;
  items: Array<{ sourceId: string; title: string; updatedAt: ISODateTime | null; url?: string | null }>; // ≤500
  cursor: string | null;         // 앞 페이지 응답의 cursor
  endOfList: boolean;            // 사이드바 끝까지 스크롤함
}
export interface CatchupDiffResponse {
  fetch: Array<{ sourceId: string; reason: 'new' | 'updated' | 'unknown_time' | 'retry' }>;
  skipped: number;
  cursor: string;
  /** 이 시각보다 오래된 updatedAt만 남으면 더 내려가지 않아도 됨 */
  stopBefore: ISODateTime | null;
  rate: { maxFetchPerMinute: number; nextScanAfter: ISODateTime };
}
/** POST /sync-state/:ai/health */
export interface AdapterHealthBody {
  adapter: { name: string; version: string; domVersion?: string | null };
  health: AdapterHealth;
  checks: Array<{ name: string; ok: boolean; detail?: string | null }>; // "sidebar_selector","message_selector","stream_end_detect"
  errorCode?: string | null;     // "SELECTOR_NOT_FOUND","LOGGED_OUT","RATE_LIMITED"
  at: ISODateTime;
  bufferedSnapshots?: number;    // 오프라인 버퍼에 쌓인 수
}
export interface SyncStateItem {
  sourceAi: SourceAi;
  cursor: string | null;
  lastScanAt: ISODateTime | null;
  lastSnapshotAt: ISODateTime | null;
  knownConversations: number;
  pendingFetch: number;
  health: AdapterHealth | null;
  healthAt: ISODateTime | null;
  adapter: { name: string; version: string } | null;
  errorCode: string | null;
  bufferedSnapshots: number;
}
export interface SyncStateResponse { sources: SyncStateItem[] }
export interface AdapterHealthResponse { recorded: true; state: SyncStateItem; collection: CollectionSourceStatus }

// ───────── 12.10 로컬 세션 수집기 (1.5.0 구현) ─────────
export interface CollectorSourceConfig {
  sourceAi: LocalSourceAi;
  root: string;                  // 기본 ~/.claude/projects · ~/.codex/sessions (~ 허용)
  enabled: boolean;
}
export interface CollectorConfig {
  enabled: boolean;              // 감시(watch) 켜기 — 기본 false(사용자가 켬)
  sources: CollectorSourceConfig[];
  pollIntervalSec: number;       // 기본 20 (fs.watch 보조 — 놓친 변경 잡기)
  toolOutputMaxChars: number;    // 도구 출력 하나를 줄이는 길이(기본 600)
  toolInputMaxChars: number;     // 도구 호출 입력(기본 300)
  excludeCwdPatterns: string[];  // 이 글자가 cwd에 들어가면 건너뜀(예: "/tmp/")
  classify: boolean;             // 새 세션 분류(기본 true, 하루 상한 함께 씀)
}
export type PutCollectorConfigBody = Partial<Omit<CollectorConfig, 'sources'>> & { sources?: CollectorSourceConfig[] };
export interface CollectorSourceStatus {
  sourceAi: LocalSourceAi;
  root: string;                  // ~ 펼친 실제 경로
  rootExists: boolean;
  enabled: boolean;
  files: number;                 // 추적 중인 .jsonl
  bytesTotal: number;
  bytesIngested: number;         // 읽은 위치 합
  sessions: number;              // 만든 대화(하위 에이전트는 부모에 합쳐 셈)
  lastScanAt: ISODateTime | null;
  lastIngestAt: ISODateTime | null;
  backfill: { state: 'never' | 'running' | 'done' | 'failed'; startedAt: ISODateTime | null; finishedAt: ISODateTime | null; filesDone: number; filesTotal: number; jobId: string | null };
  errors: Array<{ file: string; message: string; at: ISODateTime }>; // 최근 10개
}
export interface CollectorStatus {
  config: CollectorConfig;
  watching: boolean;             // 지금 감시 중(enabled이고 코어가 돌고 있음)
  sources: CollectorSourceStatus[];
  redactedSecrets: number;       // 수집하면서 가린 비밀정보 수(누적)
}
export interface CollectorRunBody {
  sourceAi?: LocalSourceAi; files?: string[]; // 비우면 켜진 소스 전부
  /** 1.10.0 false면 이번 실행으로 바뀐 세션을 분류하지 않음(감시기도 이 실행 동안 쉼). 비우면 설정 config.classify */
  classify?: boolean;
  /** 1.10.0 true면 실행하지 않고 어림만 → 200 CollectorEstimate */
  dryRun?: boolean;
}
/** 1.10.0 POST /collector/backfill {dryRun:true} · CLI `collector backfill --estimate` */
export interface CollectorEstimate {
  sources: Array<{ sourceAi: LocalSourceAi; root: string; rootExists: boolean; files: number; filesUnread: number; bytesTotal: number; bytesUnread: number; sessionsEstimated: number }>;
  classification: { model: string | null; sessions: number; inputTokens: number; outputTokens: number; costUsd: number | null; willClassify: boolean; note: string };
  dbGrowthMbEstimated: number;   // 도구 출력 줄인 뒤 본문 기준 어림
  secondsEstimated: number;      // 읽기 시간 어림(맥 기준 [미검증])
}

// ═════════════════════════ 1.8.0 — MCP 쓰기 경로(설계서 5.4 ⑤) ═════════════════════════
/** MCP가 바꿀 수 있는 상태(보관·간단한 질문은 안 됨 — 웹에서만) */
export type McpTaskStatus = '진행 중' | '멈춤' | '완료';
/** POST /mcp/log-task — 데스크톱 앱 작업을 과제로 기록(origin mcp, 대화 captureMethod mcp) */
export interface McpLogTaskBody {
  title: string;
  project?: string | null;       // 프로젝트 id 또는 이름·별칭(없으면 붙이지 않음 — 새 프로젝트를 만들지 않음)
  status?: McpTaskStatus;        // 기본 '진행 중'
  note?: string | null;          // 한두 줄 메모(대화 본문으로 저장)
  nextStep?: string | null;
  sourceAi: SourceAi;
  sourceUrl?: string | null;
}
export interface McpLogTaskResponse { task: TaskDetail; conversationId: string; projectMatched: boolean; eventId: number }
/** POST /mcp/update-task-status — taskId 또는 제목 검색어(query) 중 하나. 애매하면 409 + details.candidates */
export interface McpUpdateTaskStatusBody { taskId?: string; query?: string; status: McpTaskStatus; nextStep?: string | null }
export interface McpUpdateTaskStatusResponse { task: TaskDetail; previousStatus: TaskStatus; eventId: number }
/** GET /mcp/events — MCP가 한 쓰기 기록(최신 먼저) */
export interface McpWriteEvent {
  /** 1.9.1 어느 기기(MCP 토큰)가 했는지 — STDIO·웹이면 null */
  client: { tokenId: string; name: string; kind: PairingClientKind } | null;
  id: number; at: ISODateTime; type: 'task_logged' | 'status_changed'; taskId: string; taskTitle: string; summary: string; undone: boolean; undoneAt: ISODateTime | null }
export interface McpEventsResponse { items: McpWriteEvent[] }
/** POST /mcp/events/:eventId/undo — 기록은 보관으로(삭제 아님), 상태 변경은 이전 값으로 */
export interface McpUndoResponse { undone: boolean; eventId: number; undoEventId: number; task: TaskDetail }

/** GET /review/weekly?date=YYYY-MM-DD — 주간 돌아보기 (월–일, KST) */
export interface WeeklyReviewItem { task: TaskListItem; at: ISODateTime | null }
export interface WeeklyReviewResponse {
  weekStart: ISODate; weekEnd: ISODate; prevWeek: ISODate; nextWeek: ISODate | null; isCurrent: boolean; today: ISODate;
  finished: WeeklyReviewItem[];
  started: WeeklyReviewItem[];
  stalled: WeeklyReviewItem[];      // 이 주 끝(이번 주면 오늘) 기준 멈춤
  neglected: WeeklyReviewItem[];    // 14일 넘게 손대지 않은 진행 중·멈춤
  byAi: Array<{ sourceAi: SourceAi; conversationCount: number; messageCount: number }>;
  conversationCount: number; messageCount: number; neglectDays: number;
}
