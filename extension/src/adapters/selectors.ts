// ─────────────────────────────────────────────────────────────────────────────
// 모든 DOM 선택자는 이 파일 하나에만 둔다(설계서 5.4①-C). 사이트가 바뀌면 여기만 고친다.
//
// ⚠ 근사치: 아래 값은 2026-10 기준으로 알려진 공개 화면 구조를 바탕으로 한 추정이다.
//   실제 chatgpt.com · claude.ai 로그인 화면에서 직접 확인하지 않았다(실계정 접속 금지).
//   처음 설치한 뒤 팝업의 "사이트 상태"가 '주의'·'고장'이면 이 파일을 먼저 본다.
//
// 규칙: class 이름은 쓰지 않는다. URL 패턴 · data-testid · aria role/label · 메시지 역할 속성만.
// 요소마다 대체 사슬(앞에서부터 시도, 앞의 것이 실패하고 뒤의 것이 맞으면 상태 '주의')을 둔다.
// 어디서도 사이트 내부 API(비공개 JSON)를 부르지 않는다 — 화면에 그려진 것만 읽는다.
// ─────────────────────────────────────────────────────────────────────────────

export interface SiteSelectors {
  /** 선택자 묶음 버전 — 어댑터 상태 보고의 domVersion */
  domVersion: string;
  /** 대화 주소 → 대화 id(첫 번째 캡처 그룹) */
  conversationPath: RegExp[];
  /** 서비스 프로젝트 주소(있으면 project.externalId) */
  projectPath?: RegExp;
  /** 메시지 하나(사용자·AI 모두) — 문서 순서가 대화 순서 */
  message: string[];
  /** 메시지 요소에서 역할을 읽는 방법 */
  role: { attr?: string; userWhen?: string[]; assistantWhen?: string[]; userSelector?: string; assistantSelector?: string };
  /** 메시지 요소 안 본문(없으면 메시지 요소 자체) */
  body?: { user?: string[]; assistant?: string[] };
  /** 메시지 id 속성(있으면 externalId) */
  messageId?: string[];
  /** 답 스트리밍 중 표시(하나라도 있으면 스트리밍 중) */
  streaming: string[];
  /** 대화 제목 */
  title: string[];
  /** document.title 끝에 붙는 서비스 이름 */
  titleSuffix: RegExp;
  /** 사이드바(대화 목록) 링크 */
  sidebarLink: string[];
  /** 사이드바 영역(열려 있는지 판단) */
  sidebarRoot: string[];
  /** 변환 전에 걷어낼 UI 요소(복사·좋아요·다시 생성 버튼 등) */
  strip: string[];
  /** 로그인 화면·봇 확인 화면 신호 → 즉시 멈춤 */
  loggedOut: string[];
  loggedOutPath: RegExp[];
  challenge: string[];
}

export const CHATGPT: SiteSelectors = {
  domVersion: '2026-10-16b',
  conversationPath: [/^\/c\/([0-9a-f-]{8,})/i, /^\/g\/[^/]+\/c\/([0-9a-f-]{8,})/i],
  projectPath: /^\/g\/(g-p-[0-9a-z]+)(?:-([^/]+))?\//i,
  // 2026-10-16 대체 사슬 추가: 새 화면은 턴 단위 article[data-turn] / [data-testid^="conversation-turn-"]만 있을 수 있음(역할은 chatgpt.ts roleOf)
  // 2026-10-16b: 새 앱 화면(저장한 실제 페이지로 확인)에는 article·data-turn·data-message-author-role이 없다.
  //   메시지 단위 = [data-chatgpt-search-unit-key="…:N:user|assistant"] (안쪽에 같은 값의 data-content-search-unit-key). 역할은 값 끝(chatgpt.ts roleOf)
  //   첫 항목은 새 화면 + 예전 화면을 함께(어느 쪽이든 상태 '정상'; 겹치면 바깥 요소만), 나머지는 대체 사슬
  message: ['[data-chatgpt-search-unit-key$=":user"], [data-chatgpt-search-unit-key$=":assistant"], [data-message-author-role]',
    '[data-content-search-unit-key$=":user"], [data-content-search-unit-key$=":assistant"]', 'article[data-turn]', '[data-testid^="conversation-turn-"]'],
  role: { attr: 'data-message-author-role', userWhen: ['user'], assistantWhen: ['assistant'] },
  body: {
    // 2026-10-16b: 사용자 말풍선 [data-user-message-bubble] 안 [data-search-result-target] · AI 본문 [data-markdown-copy="contents"] (머리글 '내가 한 말:'·'ChatGPT 답변:' h4는 본문 밖)
    user: ['[data-user-message-bubble] [data-search-result-target]', '[data-user-message-bubble]', '[data-testid="user-message-text"]', '[data-message-author-role="user"]'],
    assistant: ['[data-markdown-copy="contents"]', '[data-markdown-text-style="assistant-message"]', '[data-testid="assistant-markdown"]', '[data-message-content]', '[data-message-author-role="assistant"]'],
  },
  // 2026-10-16b: data-chatgpt-search-message-ids는 공백으로 여러 개일 수 있음 → 첫 값(base.ts)
  messageId: ['data-message-id', 'data-chatgpt-selection-message-id', 'data-dil-source-message-id', 'data-chatgpt-search-message-ids'],
  streaming: ['[data-testid="stop-button"]', 'button[aria-label="Stop streaming"]', 'button[aria-label="응답 중지"]', 'button[aria-label="스트리밍 중지"]', '[data-message-author-role="assistant"][data-streaming="true"]',
    // 2026-10-16b: 새 화면 턴 상태(저장본에서는 complete만 확인됨)
    '[data-talvt-turn-state="streaming"]', '[data-talvt-turn-state="in_progress"]', '[data-talvt-turn-state="pending"]'],
  title: ['[data-testid="conversation-title"]', 'nav a[aria-current="page"]'],
  titleSuffix: /\s*[-|–]\s*ChatGPT\s*$/,
  sidebarLink: ['nav a[href^="/c/"], nav a[href^="/g/"][href*="/c/"]', '[data-testid^="history-item"] a[href*="/c/"]', 'a[href^="/c/"]', 'nav a[data-interactive-row-link][href*="/c/"]'],
  sidebarRoot: ['nav[aria-label="Chat history"]', 'nav[aria-label="채팅 기록"]', 'nav'],
  strip: ['button', '[role="button"]', 'svg', '[data-testid*="copy"]', '[data-testid*="feedback"]', '[aria-hidden="true"]', 'textarea', 'form'],
  loggedOut: ['[data-testid="login-button"]', 'a[href*="/auth/login"]', 'button[data-testid="signup-button"]'],
  loggedOutPath: [/^\/auth\//, /^\/log-?in/],
  challenge: ['iframe[src*="challenges.cloudflare.com"]', '#challenge-form', '[id^="cf-chl"]'],
};

export const CLAUDE: SiteSelectors = {
  domVersion: '2026-10-approx',
  conversationPath: [/^\/chat\/([0-9a-f-]{8,})/i],
  projectPath: /^\/project\/([0-9a-f-]{8,})/i,
  // 사용자 메시지는 data-testid, AI 응답은 스트리밍 표시 속성(data-is-streaming)을 가진 상자
  message: ['[data-testid="user-message"], [data-is-streaming]'],
  role: { userSelector: '[data-testid="user-message"]', assistantSelector: '[data-is-streaming]' },
  body: { assistant: ['[data-testid="assistant-message"]'] },
  messageId: ['data-message-id', 'data-test-render-count'],
  streaming: ['[data-is-streaming="true"]', 'button[aria-label="Stop response"]', 'button[aria-label="응답 중지"]'],
  title: ['[data-testid="chat-menu-trigger"]', 'button[data-testid="chat-title"]'],
  titleSuffix: /\s*[-|–]\s*Claude\s*$/,
  sidebarLink: ['nav a[href^="/chat/"]', 'a[href^="/chat/"]'],
  sidebarRoot: ['nav[aria-label="Sidebar"]', 'nav'],
  strip: ['button', '[role="button"]', 'svg', '[data-testid*="action-bar"]', '[aria-hidden="true"]', 'textarea', 'form'],
  loggedOut: ['[data-testid="login-form"]', 'input[type="email"][name="email"]'],
  loggedOutPath: [/^\/login/, /^\/logout/],
  challenge: ['iframe[src*="challenges.cloudflare.com"]', '#challenge-form', '[id^="cf-chl"]'],
};
