/**
 * 서브브레인 공용 상수 — 상태 색·AI 표식·관계 색·기준 일수 기본값 (설계서 §7.3, §10.2)
 * GET /meta 응답의 기본값과 같다. 사용자가 기준·타입을 바꾸면 /meta가 달라진다.
 */
import type {
  MetaResponse, Settings, SourceAi, StaleThresholds, StatusVisual, TaskStatus, LlmProvider,
} from './api-types.ts';

export const API_VERSION = '1.10.1';
export const CORE_VERSION = '0.1.0';
export const DEFAULT_PORT = 4545;
export const PROMPT_VERSION = 'cls-v4'; // 1.1.0 cls-v2: 확신도 기준표·이어감(handoff)·같은 과제 후보 규칙 강화 / 1.2.0 cls-v3: 재현 가능한 입력(대화 날짜 기준·제목만·자기 요약 재투입 없음)
export const KST_OFFSET = '+09:00';

export const DEFAULT_THRESHOLDS: StaleThresholds = {
  inProgressMaxDays: 3, shortPauseMaxDays: 7, staleMaxDays: 30, longStaleMaxDays: 90,
};

/** §10.2.1 프로젝트 8색 순환 */
export const PROJECT_PALETTE = ['#F07F5E', '#5B8DEF', '#36C2A6', '#D768A6', '#E8B63E', '#A393E0', '#4DB9E3', '#9CCB5E'] as const;

export const STATUS_META: MetaResponse['statuses'] = [
  { value: '진행 중', visual: 'run', colorHex: '#5ED3A0', labelKo: '진행 중' },
  { value: '멈춤', visual: 'stall', colorHex: '#FF8A65', labelKo: '멈춤' },
  { value: '완료', visual: 'done', colorHex: '#8C94A8', labelKo: '완료' },
  { value: '간단한 질문', visual: 'quick', colorHex: '#5E677D', labelKo: '간단한 질문' },
  { value: '보관', visual: 'archived', colorHex: '#535D75', labelKo: '보관' },
];

export const STATUS_VISUAL_META: MetaResponse['statusVisuals'] = {
  run: { colorHex: '#5ED3A0', ring: 'solid', labelKo: '진행 중' },
  stall2: { colorHex: '#F2B45A', ring: 'dashed', labelKo: '잠깐 멈춤 (4–7일)' },
  stall: { colorHex: '#FF8A65', ring: 'dashed', labelKo: '7일 넘게 멈춤' },
  done: { colorHex: '#8C94A8', ring: 'none', labelKo: '완료' },
  quick: { colorHex: '#5E677D', ring: 'dot', labelKo: '간단한 질문' },
  archived: { colorHex: null, ring: 'none', labelKo: '보관' },
};

export const STATUS_TO_VISUAL: Record<Exclude<TaskStatus, '멈춤'>, StatusVisual> = {
  '진행 중': 'run', '완료': 'done', '간단한 질문': 'quick', '보관': 'archived',
};

export const STALE_STAGE_LABELS = {
  short_pause: { labelKo: '잠깐 멈춤', emoji: '🟡' },
  stale: { labelKo: '방치', emoji: '🟠' },
  long_stale: { labelKo: '오래 방치', emoji: '🔴' },
  dormant: { labelKo: '휴면', emoji: '⚫' },
} as const;

export const SOURCE_AI_META: MetaResponse['sourceAis'] = [
  { key: 'chatgpt', labelKo: 'ChatGPT', shape: 'circle', colorHex: '#4CC38A' },
  { key: 'claude', labelKo: 'Claude', shape: 'rounded_square', colorHex: '#E88C60' },
  { key: 'gemini', labelKo: 'Gemini', shape: 'diamond', colorHex: '#7EA2F7' },
  { key: 'grok', labelKo: 'Grok', shape: 'triangle', colorHex: '#D8DCE5' },
  // 1.5.0 로컬 세션: 같은 회사 웹 서비스와 같은 모양, 색만 진하게
  { key: 'claude-code', labelKo: 'Claude Code', shape: 'rounded_square', colorHex: '#B8603A' },
  { key: 'codex', labelKo: 'Codex', shape: 'circle', colorHex: '#2E8F62' },
  { key: 'grokbot', labelKo: 'Grok Bot', shape: 'triangle', colorHex: '#9AA3B5' }, // 1.10.0
];

export const SOURCE_AI_LABEL: Record<SourceAi, string> = {
  chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', grok: 'Grok', 'claude-code': 'Claude Code', codex: 'Codex', grokbot: 'Grok Bot',
};

/** "새 대화" 주소 (이어서 하기에서 다른 AI로 넘길 때) */
export const NEW_CHAT_URL: Record<SourceAi, string> = {
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/new',
  gemini: 'https://gemini.google.com/app',
  grok: 'https://grok.com/',
  // 1.5.0 로컬 세션은 웹 새 대화 주소가 없음 → 빈 문자열(코어가 null로 바꿈). 이어서 하기 대상은 웹 4개뿐
  'claude-code': '',
  codex: '',
  grokbot: '',
};

/** 원래 대화 주소 (source_id → URL). 서비스 주소 형식은 공개 웹 주소 기준 */
export const CONVERSATION_URL: Record<SourceAi, (sourceId: string) => string> = {
  chatgpt: (id) => `https://chatgpt.com/c/${id}`,
  claude: (id) => `https://claude.ai/chat/${id}`,
  gemini: (id) => `https://gemini.google.com/app/${id}`,
  grok: (id) => `https://grok.com/chat/${id}`,
  'claude-code': () => '', // 1.5.0 로컬 세션: 웹 주소 없음(코어가 null로)
  codex: () => '',
  grokbot: () => '', // 1.10.0 웹 주소 없음
};

export const OBJECT_TYPE_META: MetaResponse['objectTypes'] = [
  { key: 'person', labelKo: '사람', icon: 'person', sensitive: true, enabled: false },
  { key: 'project', labelKo: '프로젝트', icon: 'sphere', sensitive: false, enabled: true },
  { key: 'task', labelKo: '과제', icon: 'sphere-ring', sensitive: false, enabled: true },
  { key: 'decision', labelKo: '결정', icon: 'flag-check', sensitive: false, enabled: true },
  { key: 'tool', labelKo: '도구/기술', icon: 'wrench', sensitive: false, enabled: true },
  { key: 'artifact', labelKo: '파일/자료', icon: 'document', sensitive: false, enabled: false },
  { key: 'place', labelKo: '장소', icon: 'pin', sensitive: false, enabled: false },
  { key: 'organization', labelKo: '조직', icon: 'building', sensitive: false, enabled: false },
  { key: 'topic', labelKo: '주제', icon: 'hash', sensitive: false, enabled: true },
];

export const LINK_TYPE_META: MetaResponse['linkTypes'] = [
  { key: 'uses', labelKo: '사용함', directed: true, colorHex: '#5B8DEF', line: 'solid', arrow: false, hiddenByDefault: false },
  { key: 'decided', labelKo: '결정함', directed: true, colorHex: '#E8B63E', line: 'solid', arrow: false, hiddenByDefault: false },
  { key: 'blocked_by', labelKo: '막혔음', directed: true, colorHex: '#FF8A65', line: 'dashed', arrow: true, hiddenByDefault: false },
  { key: 'derived_from', labelKo: '파생함', directed: true, colorHex: '#A393E0', line: 'solid', arrow: true, hiddenByDefault: false },
  { key: 'references', labelKo: '참고함', directed: true, colorHex: '#4DB9E3', line: 'thin', arrow: false, hiddenByDefault: false },
  { key: 'part_of', labelKo: '속함', directed: true, colorHex: '#535D75', line: 'thin', arrow: false, hiddenByDefault: false },
  { key: 'supersedes', labelKo: '대체함', directed: true, colorHex: '#D768A6', line: 'solid', arrow: true, hiddenByDefault: false },
  { key: 'affects', labelKo: '영향 줌', directed: true, colorHex: '#36C2A6', line: 'solid', arrow: true, hiddenByDefault: false },
  { key: 'located_at', labelKo: '위치함', directed: true, colorHex: '#9CCB5E', line: 'thin', arrow: false, hiddenByDefault: false },
  { key: 'related_to', labelKo: '관련 있음', directed: false, colorHex: '#8089A0', line: 'dotted', arrow: false, hiddenByDefault: true },
];

/**
 * 제공자별 기본 모델 이름 (2026-10-02 공식 문서로 확인, 계약 §16 1.1.0).
 *  - google: gemini-2.5-* 는 "예전에 쓰던 사용자만" 접근 가능 → 새 사용자는 404. Google 권장 새 프로젝트용 = gemini-3.5-flash-lite (GA, 2026-07-21)
 *  - openai: gpt-5-mini 는 2026-12-11 종료 예정 → 저비용 최신 gpt-6-luna
 *  - xai: grok-3-mini 는 2026-05-15 은퇴(grok-4.3 별칭) → grok-4.3
 *  - anthropic: claude-haiku-4-5 (현행 가장 빠른 모델, 은퇴는 2026-10-15 이후 공지 예정 — 바뀌면 여기만 고친다)
 * 이름은 제공자 사정에 따라 바뀔 수 있으니 설정(llm.model)에서 덮어쓸 수 있다.
 */
export const DEFAULT_MODEL: Record<LlmProvider, string> = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-6-luna',
  google: 'gemini-3.5-flash-lite',
  xai: 'grok-4.3',
  ollama: 'llama3.1',
};

/** 분류 후처리 기준값 (계약 §16 1.1.0) */
export const CLASSIFIER_TUNING = {
  /** 확신도 상한·하한 — 모델이 1.0을 남발해도 0.95를 넘지 않게 자른다 */
  confidenceMax: 0.95,
  confidenceMin: 0.05,
  /** 같은 과제 후보: 제목·요약·주제의 글자 2-gram 유사도가 이 값 미만이면 버린다 */
  mergeMinSimilarity: 0.12,
  /** 한 번의 분류 실행에서 같은 과제가 이 횟수를 넘게 후보로 찍히면(허브 현상) 유사도 strong 미만은 모두 버린다 */
  mergeMaxPerTargetPerRun: 3,
  mergeStrongSimilarity: 0.35,
  /** 새 프로젝트 제안: 미분류 과제가 이 수 이상 모이면 ready(요약·배지에 노출, L4는 자동 생성) — 설계서 §7.7 */
  projectSuggestionMinTasks: 3,
} as const;

/**
 * 1.2.0 Gemini Takeout 기록 → 대화 다시 묶기(대화 주소가 없는 기록에만 적용).
 *  - 앞 기록과 sessionGapMinutes(기본 30분) 넘게 떨어지면 새 대화. 단 mergeMaxGapMinutes 이내이고 주제 유사도 ≥ mergeMinSimilarity면 이어 붙임.
 *  - 간격 안이어도 splitMinGapMinutes 넘게 떨어졌고 새 질문이 길며(splitMinPromptChars) 주제 유사도 < splitMaxSimilarity이면 새 대화.
 *  유사도 = 글자 2-gram Dice(새 질문 ↔ 현재 대화의 최근 질문·응답 앞부분).
 */
export const GEMINI_SESSION_TUNING = {
  sessionGapMinutes: 30,
  mergeMaxGapMinutes: 180,
  mergeMinSimilarity: 0.3,
  splitMinGapMinutes: 5,
  splitMinPromptChars: 15,
  splitMaxSimilarity: 0.05,
} as const;

/** 다른 곳에서 이어감(handoff) 표시 문구 — 계약 §16 */
export const HANDOFF_LABEL = '다른 곳에서 이어감';

/** 제공자별 API 키 환경변수 (설정 화면에서 키를 넣지 않아도 이 변수가 있으면 사용) */
export const PROVIDER_ENV_KEY: Record<LlmProvider, string | null> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  xai: 'XAI_API_KEY',
  ollama: null,
};

export const MOCK_MODEL = 'rule-mock';

export const DEFAULT_SETTINGS: Settings = {
  llm: { provider: null, model: null, baseUrl: null, apiKeySet: false, dailyCostCapUsd: 10, redactSecrets: true, sensitiveKeywords: [], sensitiveProjectIds: [] },
  classification: { lowConfidenceThreshold: 0.6, promptVersion: PROMPT_VERSION, condenseHead: 3, condenseTail: 6, condenseMiddleChars: 200 },
  thresholds: DEFAULT_THRESHOLDS,
  ontology: { enabled: false, autoAcceptMin: 0.85, suggestMin: 0.6, enabledTypes: ['project', 'task', 'decision', 'tool', 'topic'], showPersonNames: false },
  vault: { path: '', name: 'SubBrain', includeFullTranscript: false, rawLocation: 'inside_vault', rawHtmlRetentionDays: 30, gitAutoCommit: false },
  digest: { time: '08:00', osNotification: true, writeDailyNote: true, llmNarrative: true },
  automation: { level: 'L3', catchupIntervalHours: 3, catchupMaxPerRun: 20, catchupMinIntervalSec: 15 },
  server: { port: DEFAULT_PORT, devOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'] },
};

export const DIGEST_ACTION_LABEL = {
  completed: '완료', started: '시작', continued: '이어감', stalled: '멈춤', archived: '보관', wiki_drafted: '위키 초안',
} as const;

export const WEEKDAY_KO = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'] as const;
