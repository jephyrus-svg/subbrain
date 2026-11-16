# 서브브레인 로컬 코어 HTTP API 계약서 (API_CONTRACT) — v1 (MVP)

- 작성: 2026-09-30 (KST) · 엔진/백엔드 담당 · **현재 1.9.1 (2026-10-12, §16)**
- 기준 문서: 내부 설계서 v1.1(공개 저장소에는 포함되지 않음, 이하 **설계서**, 절 번호는 `§8.3`처럼 표기) + 디자인 v3 (`design/v3/01_home_graph`, `02_task_detail`, `03_daily_digest`)
- 이 계약서는 **웹앱이 목(mock)으로 먼저 개발할 수 있도록** 모든 엔드포인트의 요청·응답 모양과 예시 JSON을 고정한다. 코어 구현은 이 문서를 따른다. 바꿀 때는 §16 변경 이력에 적는다.
- 타입 원본(TypeScript)은 `packages/shared/src/api-types.ts`(이 문서 §4에 그대로 들어감). JSON 예시는 **엔진이 예시 데이터(시드) 위에서 실제로 돌려준 응답**(zod 검사 통과)을 캡처한 것이고, 엔진으로 재현되지 않는 상태(가져오기 진행 단계·오류·LATER 예시)만 타입 검사한 `packages/shared/mocks/fixtures.ts`에서 온다. 웹 목용 파일은 `packages/shared/mocks/json/*.json`.
- **이 문서는 생성물이다**: 고칠 때는 `scripts/contract.template.md`·`api-types.ts`·`fixtures.ts`(또는 시드 `packages/core/src/seed-data.ts`)를 고치고 `node scripts/build-contract.mjs`(= `pnpm contract`, Node 22+)로 다시 만든다.

---

## 목차

0. [한눈에 보기 — 엔드포인트 목록](#0-한눈에-보기--엔드포인트-목록)
1. [기본 규칙 (주소·이름·시간·페이지)](#1-기본-규칙)
2. [인증 · CORS · 보안 · 버전](#2-인증--cors--보안--버전)
3. [모노레포 구성 계획 (Node 22+ 필수)](#3-모노레포-구성-계획)
4. [공유 타입 (TypeScript)](#4-공유-타입-typescript)
5. [시스템: health · meta · dashboard](#5-시스템-health--meta--dashboard)
6. [그래프 (홈)](#6-그래프-홈)
7. [프로젝트 · 주제 (홈 오른쪽 패널)](#7-프로젝트--주제-홈-오른쪽-패널)
8. [과제 목록 · 보드 · 과제 상세 · 대화](#8-과제-목록--보드--과제-상세--대화)
9. [과제 합치기 제안](#9-과제-합치기-제안)
10. [오늘의 요약 (digest)](#10-오늘의-요약-digest)
11. [검색](#11-검색)
12. [가져오기 · 작업(jobs) · 분류](#12-가져오기--작업jobs--분류)
13. [설정 · 볼트](#13-설정--볼트)
14. [나중(LATER) 엔드포인트 — MVP 밖](#14-나중later-엔드포인트--mvp-밖)
15. [설계서와 다르거나 모호했던 점 · 결정](#15-설계서와-다르거나-모호했던-점--결정)
16. [변경 이력](#16-변경-이력)

---

## 0. 한눈에 보기 — 엔드포인트 목록

기본 주소: `http://127.0.0.1:4545/api/v1` (포트는 `SUBBRAIN_PORT`로 변경)

표기: **MVP** = Phase 1에서 구현(웹앱이 지금 목으로 만들 대상) · **1.5 / 2 / 3 / 5 / 6** = 설계서 §14.2 단계 · LATER 항목은 §14에 이름과 대략적인 모양만.

| # | 메서드 | 경로 | 용도 | 화면 | 단계 |
|---|---|---|---|---|---|
| 1 | GET | `/health` | 코어 상태·버전·SQLite 기능 | (시작 확인) | MVP |
| 2 | GET | `/meta` | 열거값·라벨·색·객체/관계 타입 메타 | 전체 | MVP |
| 3 | GET | `/dashboard` | 상단바(수집 상태·배지·오늘) + 홈 카운터 | 상단바, 홈 | MVP |
| 4 | GET | `/graph` | 그래프 노드·엣지(과제 모드 / 관계 모드) | 홈, 과제 상세 미니맵, 요약의 작은 그래프 | MVP (관계 모드 1.5, `at` 되감기 2) |
| 5 | GET | `/activity` | 주간 대화 수 막대(되감기 슬라이더·스파크라인) | 홈 | MVP |
| 6 | GET | `/projects` | 프로젝트 목록 | 설정, 필터 | MVP |
| 7 | GET | `/projects/:projectId` | 프로젝트 상세 패널 | 홈 오른쪽 패널 | MVP |
| 8 | POST | `/projects` | 프로젝트 만들기 | 설정 | MVP |
| 9 | PATCH | `/projects/:projectId` | 이름·동의어·상태·색·방치 기준 변경 | 설정 | MVP |
| 10 | GET | `/topics/:topicId` | 주제 노드 패널 | 홈 오른쪽 패널 | MVP |
| 11 | GET | `/tasks` | 과제 목록(필터·정렬·페이지) | 목록, 검색 필터 | MVP |
| 12 | GET | `/board` | 칸반 4열(진행 중·멈춤·완료 14일·간단한 질문) | 보드 | MVP |
| 13 | GET | `/tasks/:taskId` | 과제 상세(머리·속성·결정·열린 질문·이어서 하기·함께 볼 것) | 과제 상세, 홈 패널(과제 선택 시) | MVP |
| 14 | GET | `/tasks/:taskId/flow` | 대화 흐름(날짜별 대화·발췌·빈 기간) | 과제 상세 가운데 | MVP |
| 15 | PATCH | `/tasks/:taskId` | 상태·프로젝트·고정·제목·다음 단계 변경(override 기록) | 보드 끌기, 상태 바꾸기, 보관 | MVP |
| 16 | POST | `/tasks/:taskId/overrides/reset` | 사용자 고정값 해제(에이전트에게 돌려줌) | 과제 상세 | MVP |
| 17 | PATCH | `/tasks/:taskId/open-questions/:questionId` | 열린 질문 해결 체크 | 과제 상세 | MVP |
| 18 | PATCH | `/tasks/:taskId/decisions/:decisionId` | 결정 문구 수정·무효 표시 | 과제 상세 | MVP |
| 19 | GET | `/tasks/:taskId/resume-prompt` | AI별 맥락 프롬프트 + 이어갈 URL | 과제 상세, 홈 패널, 요약 Top 3 | MVP |
| 20 | POST | `/tasks/:taskId/merge` | 과제 직접 합치기 | 보드 카드 동작 | MVP |
| 21 | POST | `/tasks/:taskId/reclassify` | 다시 분류 요청 | 과제 상세 | MVP |
| 22 | GET | `/conversations/:conversationId` | 대화 원문(메시지 페이지) | "웹앱에서 보기" | MVP |
| 23 | GET | `/merge-suggestions` | "같은 과제일 수 있음" 제안 목록 | 보드, 요약 | MVP |
| 24 | POST | `/merge-suggestions/:suggestionId/accept` | 제안 수락(합치기) | 보드, 요약 | MVP |
| 25 | POST | `/merge-suggestions/:suggestionId/reject` | 제안 거절 | 보드, 요약 | MVP |
| 26 | GET | `/digests` | 지난 요약 목록 | 요약 "지난 요약 모두" | MVP |
| 27 | GET | `/digests/:date` | 날짜별 오늘의 요약(`today`·`latest` 별칭) | 오늘의 요약 | MVP (승인 칸 6, 제안 카드 1.5) |
| 28 | POST | `/digests/:date/regenerate` | 요약 다시 만들기 | 오늘의 요약 | MVP |
| 29 | GET | `/search` | 전문 검색(한국어 3글자 미만 대체 규칙) | ⌘K 검색 | MVP |
| 30 | POST | `/imports` | 내보내기 ZIP/JSON 업로드 → 가져오기 작업 id | 가져오기 | MVP |
| 31 | GET | `/imports` | 가져오기 기록 | 가져오기 | MVP |
| 32 | GET | `/imports/:importId` | 가져오기 진행률·미리보기·결과 | 가져오기 | MVP |
| 33 | POST | `/imports/:importId/start` | 미리보기 확인 후 실행 | 가져오기 | MVP |
| 34 | POST | `/imports/:importId/cancel` | 가져오기 취소 | 가져오기 | MVP |
| 35 | GET | `/jobs` | 백그라운드 작업 목록 | 설정·상태 | MVP |
| 36 | GET | `/jobs/:jobId` | 작업 하나 상태 | 설정·상태 | MVP |
| 37 | GET | `/classification/status` | 분류 대기열·오늘 비용·상한 | 가져오기, 설정 | MVP |
| 38 | POST | `/classification/run` | 분류 실행(미분류/지정 대상) | 설정 | MVP |
| 39 | GET | `/settings` | 설정 조회(API 키 값은 절대 안 돌려줌) | 설정 | MVP |
| 40 | PATCH | `/settings` | 설정 부분 변경 | 설정 | MVP |
| 41 | PUT | `/settings/llm-key` | LLM API 키 저장(MVP: secrets.json 0600) | 설정 | MVP |
| 42 | POST | `/settings/llm-test` | LLM 연결 시험 | 설정 | MVP |
| 43 | POST | `/vault/regenerate` | 볼트 다시 만들기 | 설정 | MVP |
| 44 | GET | `/vault/conflicts` | 볼트에서 직접 고친 파일 목록 | 상단 배너 | MVP |
| 45 | GET | `/project-suggestions` | 새 프로젝트 제안 목록(1.1.0) | 요약, 설정, 홈 배지 | MVP |
| 46 | POST | `/project-suggestions/:suggestionId/accept` | 제안 수락 → 프로젝트 만들고 과제 붙이기(1.1.0) | 요약, 설정 | MVP |
| 47 | POST | `/project-suggestions/:suggestionId/reject` | 제안 거절(같은 이름 다시 제안 안 함, 1.1.0) | 요약, 설정 | MVP |
| 48 | GET | `/collector` | 로컬 세션 수집기 상태(1.5.0, §12.10) | 설정 | MVP |
| 49 | PUT | `/collector/config` | 감시 폴더·켜기/끄기(1.5.0) | 설정 | MVP |
| 50 | POST | `/collector/backfill` | 처음 한 번 전체 읽기 → 작업(1.5.0) | 설정 | MVP |
| 51 | POST | `/collector/scan` | 지금 한 번 검사 → 작업(1.5.0) | 설정 | MVP |
| 52 | GET | `/ontology` | 관계(온톨로지) 모드 화면 한 번에(1.7.0, §14.2) | 홈 관계 모드 | 1.5 ✅ |
| 53 | GET | `/ontology/status` | 객체 수·추출 진행·비용(1.7.0) | 설정 | 1.5 ✅ |
| 54 | POST | `/ontology/extract` | 객체·관계 뽑기 작업(규칙+LLM, 1.7.0) | 설정 | 1.5 ✅ |
| 55 | POST | `/ontology/events/:eventId/undo` | 온톨로지 액션 되돌리기 | 상세 패널·요약 | 1.5 ✅ |
| 56 | GET | `/suggestions` | 대기 제안(객체·관계·합치기) | 요약 제안 카드 | 1.5 ✅ |
| 57 | POST | `/suggestions/bulk-accept` | 확신도 기준 일괄 확정 | 요약 | 1.5 ✅ |
| 58 | POST | `/suggestions/:id/accept` | 제안 확정 | 요약·상세 | 1.5 ✅ |
| 59 | POST | `/suggestions/:id/reject` | 제안 거절(거절 기억) | 요약·상세 | 1.5 ✅ |
| 60 | GET | `/objects` | 객체 검색(이름+별칭) | 관계 모드 검색 | 1.5 ✅ |
| 61 | GET | `/objects/:id` | 객체 상세 패널 | 관계 모드 | 1.5 ✅ |
| 62 | PATCH | `/objects/:id` | 이름·별칭·속성 고치기 | 상세 패널 | 1.5 ✅ |
| 63 | POST | `/objects/:id/merge` | 합치기 | 상세 패널 | 1.5 ✅ |
| 64 | POST | `/objects/:id/split` | 나누기 | 상세 패널 | 1.5 ✅ |
| 65 | GET | `/objects/:id/impact` | 이 결정·도구가 바뀌면 영향받는 것 | 상세 패널 | 1.5 ✅ |
| 66 | POST | `/links/:id/end` | 관계 끊기(해소, 삭제 아님) | 상세 패널 | 1.5 ✅ |
| 67 | GET | `/tasks/:id/why-stalled` | 왜 멈췄나(막힘 사슬) | 과제 상세 | 1.5 ✅ |
| 68 | GET | `/similar` | 비슷한 예전 과제 | 과제 상세·검색 | 1.5 ✅ |
| 69 | GET | `/graph/path` | 두 객체 사이 경로 | 관계 모드 | 1.5 ✅ |
| 70 | POST | `/mcp/log-task` | MCP 과제 기록(1.8.0, §14.5) | MCP 서버만 | 2 ✅ |
| 71 | POST | `/mcp/update-task-status` | MCP 상태 바꾸기(1.8.0) | MCP 서버만 | 2 ✅ |
| 72 | GET | `/mcp/events` | MCP로 한 쓰기 목록(1.8.0) | MCP·설정 | 2 ✅ |
| 73 | POST | `/mcp/events/:eventId/undo` | MCP 쓰기 되돌리기(1.8.0, 삭제 아님) | MCP·설정 | 2 ✅ |
| 74 | POST | `/pairing` | 페어링 코드 발급(웹만, 1.9.0 §14.3) | 설정 | 3 ✅ |
| 75 | POST | `/pairing/complete` | 코드 → 토큰(확장·MCP) | 확장 팝업 · `subbrain mcp pair` | 3 ✅ |
| 76 | GET | `/pairing/clients` | 페어링한 기기 목록(웹만) | 설정 | 3 ✅ |
| 77 | POST | `/pairing/clients/:tokenId/rotate` | 토큰 교체(그 토큰으로) | 확장 | 3 ✅ |
| 78 | POST | `/pairing/clients/:tokenId/revoke` | 토큰 폐기(웹만) | 설정 | 3 ✅ |
| 79 | GET | `/session` | 지금 요청의 주체(web·extension·mcp) | 확장·MCP | 3 ✅ |
| 80 | POST | `/ingest/snapshot` | 스냅샷 수신(멱등, 토큰) | 확장 | 3 ✅ |
| 81 | POST | `/ingest/replay` | 오프라인 버퍼 재전송(토큰) | 확장 | 3 ✅ |
| 82 | POST | `/ingest/catchup/diff` | 놓친 대화 비교(토큰) | 확장 | 3 ✅ |
| 83 | GET | `/sync-state` | 소스별 수집 상태 | 확장·설정 | 3 ✅ |
| 84 | POST | `/sync-state/:ai/health` | 어댑터 상태 보고(토큰) | 확장 | 3 ✅ |

온톨로지(1.5)는 **1.7.0에 구현**(52–69, §14.2). MCP 서버는 **1.8.0에 구현**(70–73, §14.5). 확장 수집·페어링은 **1.9.0에 구현**(74–84, §14.3). LATER(§14): 타임라인·되감기·SSE(2), 확장 수집·페어링(3, **1.5.0에 모양 고정 §14.3**), 위키(5), 정리·삭제(6), 모든 **삭제(DELETE) 엔드포인트**, MCP.

**목(mock) 파일** — `packages/shared/mocks/json/<이름>.json` (전부 zod/`api-types.ts`로 검사됨, 기준 시각 2026-09-30 08:30 KST). 엔진 캡처: `pnpm --filter @subbrain/core mocks`
`health` · `meta` · `dashboard` · `graph` · `activity` · `projectsList` · `projectDetail` · `topicDetail` · `tasksList` · `board` · `taskDetail` · `taskFlow` · `updateTaskResponse` · `resumePrompt` · `mergeTasksResponse` · `conversationDetail` · `mergeSuggestions` · `acceptMergeResponse` · `digestList` · `digest` · `digestOntologyLater` · `digestCleanupLater` · `search` · `searchPaged` · `searchPagedNext` · `graphExcerpt` · `rejectMergeResponse` · `approveDeletionBody` · `deletionBatchResponse` · `deletionBatchPostponed` · `importCreated` · `importPreviewReady` · `importClassifying` · `importDone` · `importsList` · `job` · `jobsList` · `classificationStatus` · `settings` · `llmTest` · `vaultConflicts` · `collectionMvpExample` · `errorNotFound` · `errorValidation` · `errorDuplicateImport` · `errorNotImplemented` · (1.1.0) `projectSuggestions` · `acceptProjectSuggestionResponse` · `importProjectsPreview` · (1.2.0) `importGeminiPreview` · `tasksHandedOff` · `tasksBlocked`
웹에서는 `import taskDetail from '@subbrain/shared/mocks/taskDetail'`(workspace 의존) 또는 파일 복사로 쓴다.

**전체 상세 세트** `mocks/json/demo/` — 예시 데이터의 **모든 id**에 대한 엔진 응답(키 = id): `demo/index`(id 목록·개수) · `demo/tasks`(`TaskDetail` 98개) · `demo/flows`(`FlowResponse`) · `demo/resumePrompts`(`ResumePromptResponse`, 기본 AI) · `demo/projects`(`ProjectDetail` 8개) · `demo/topics`(`TopicDetail`) · `demo/conversations`(`ConversationDetail` 250개, 메시지 첫 100개). 예: `import tasks from '@subbrain/shared/mocks/demo/tasks'` → `tasks['task_20260914_01']`.
예시 데이터 = 디자인 v3 수치: 프로젝트 8 · 프로젝트 과제 41(+프로젝트 없는 과제 2) · 간단한 질문 26 · 주제 8, 프로젝트별 대화/메시지 합계가 디자인과 같다(블로그 43/402, 서브브레인 58/475 …). 26주 활동이 비지 않도록 4~6월 보관 과제가 들어 있다.

---

## 1. 기본 규칙

### 1.1 주소
- 코어는 `127.0.0.1`에만 바인딩한다(설계서 §5.3, §5.4②). 기본 포트 **4545** (`SUBBRAIN_PORT`).
- 모든 API는 **`/api/v1`** 아래. 웹앱 정적 파일은 같은 서버의 `/`에서 제공(설계서 §5.4⑥) → 배포 시 같은 origin이라 CORS 불필요.

### 1.2 필드 이름 = camelCase (한 번 정함)
- **JSON의 키는 전부 camelCase** (`sourceAi`, `staleDays`, `lastActivityAt`). DB 열(snake_case, 설계서 §6.3)과 이름은 1:1로 대응한다: `stale_days` ↔ `staleDays`, `source_ai` ↔ `sourceAi`.
- **열거값(enum value)은 설계서에 적힌 값을 그대로** 쓴다. 바꾸거나 번역하지 않는다.
  - 과제 상태는 설계서 §6.2·§6.3·§7.2 그대로 **한국어 문자열**: `"진행 중" | "멈춤" | "완료" | "간단한 질문" | "보관"`. (쿼리스트링에서는 URL 인코딩: `status=%EB%A9%88%EC%B6%A4` — `URLSearchParams`가 자동 처리)
  - 나머지는 설계서의 영문 키 그대로: `kind: "task" | "quick_question"`, `sourceAi: "chatgpt" | ...`, 객체 타입 `person|project|...`(§8.2), 관계 타입 `uses|decided|...`(§8.3).
  - 화면 표시용 토큰(`statusVisual: "run" | "stall2" | "stall" | "done" | "quick"`)은 **파생값**으로 따로 준다(§10.2.3의 고리 규칙). 웹은 색·고리 모양을 이 값으로만 고른다.
- ID는 문자열. 접두사로 종류를 구분한다.

| 종류 | 형식 | 예 | 근거 |
|---|---|---|---|
| 대화 | `conv_<ai>_<원본ID 앞 8자리>` | `conv_chatgpt_68f2a91c` | §6.2, §6.3 |
| 과제 | `task_<YYYYMMDD>_<2자리>` | `task_20260830_01` | §6.2 |
| 프로젝트 | `prj_<짧은 영문 slug>` | `prj_blog` | (설계서에 형식 없음 → 계약서가 정함) |
| 객체(주제 등) | `obj_<type>_<짧은 id>` | `obj_topic_copywriting` | §8.4 |
| 결정 | `obj_decision_<짧은 id>` | `obj_decision_7a1c` | §8.2 (결정의 원본은 결정 객체) |
| 열린 질문 | `oq_<taskId 뒷부분>_<n>` | `oq_20260830_01_1` | (§6.3 `open_questions_json` 항목에 id 부여) |
| 위키 | `wiki_<짧은 id>` | `wiki_voice` | §6.3 `wiki_pages` |
| 가져오기 | `imp_<YYYYMMDD>_<4자>` | `imp_20260930_k3f9` | §6.3 `import_batches` |
| 작업 | `job_<짧은 id>` | `job_8c21` | (큐 테이블, §5.4②) |
| 합치기 제안 | `ms_<짧은 id>` | `ms_4410` | (§15 참고) |

### 1.3 시간
- 시각: **ISO 8601 + KST 오프셋** `"2026-09-18T01:47:00+09:00"` (설계서 frontmatter와 같음, §6.2). 코어는 항상 `+09:00`으로 내보낸다(사용자 시간대 설정이 생기면 그 오프셋).
- 날짜: `"2026-09-30"` (KST 기준 날짜). 요일·"12일째" 같은 문구는 **웹이 계산**하지 않아도 되도록 `staleDays` 등 숫자를 주지만, 요일 표기는 웹이 날짜로 만든다.
- "오늘"은 코어의 KST 날짜. 모든 응답의 `staleDays`는 **요청 시점의 오늘** 기준(규칙 엔진이 매일 새벽 다시 계산한 값, §7.3).
- "이번 주" = **월요일 시작** KST 주.

### 1.4 목록·페이지 (cursor 방식)
목록 응답은 항상 이 모양이다:

```jsonc
{
  "items": [ /* ... */ ],
  "page": { "limit": 50, "nextCursor": "eyJvIjo1MH0", "hasMore": true, "total": 58 }
}
```

- 요청: `?limit=50&cursor=<nextCursor>` (`limit` 기본 50, 최대 200). `cursor`는 불투명 문자열(웹은 해석하지 않음).
- `total`은 계산이 싼 경우에만 준다(없으면 `null`).
- 단일 리소스 응답은 봉투(envelope) 없이 **리소스 객체 그대로** 준다.

### 1.5 오류 형식

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "과제를 찾을 수 없어요: task_20260830_99",
    "details": {"taskId": "task_20260830_99"},
    "requestId": "req_01J9ZK4M"
  }
}
```

| HTTP | `code` | 언제 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | 쿼리·본문이 zod 검증 실패. `details.issues`에 `[{path, message}]` |
| 400 | `UNSUPPORTED_FILE` | 가져오기 파일 형식을 알 수 없음 |
| 403 | `FORBIDDEN_ORIGIN` | 허용되지 않은 Origin/Host (§2) |
| 404 | `NOT_FOUND` | 대상 없음 |
| 409 | `CONFLICT` | 상태가 맞지 않음(예: 이미 끝난 가져오기를 시작, 이미 처리된 제안) |
| 409 | `DUPLICATE_IMPORT` | 같은 파일 해시를 이미 가져옴(`details.importId`) |
| 413 | `PAYLOAD_TOO_LARGE` | 업로드 상한(기본 2 GB) 초과 |
| 422 | `NOT_ALLOWED_IN_BUILD` | 판매용 빌드에서 뺀 기능 호출(§9.2.4). 아직 구현 안 된 LATER 경로는 `501` |
| 429 | `COST_CAP_REACHED` | 하루 LLM 비용 상한 도달로 분류 실행 거부(§7.7) |
| 500 | `INTERNAL` | 그 밖의 오류 |
| 501 | `NOT_IMPLEMENTED` | LATER 엔드포인트(경로는 예약됨) |
| 503 | `DB_BUSY` / `LLM_UNAVAILABLE` | DB 잠김 지속, LLM 연결 실패 |

- 모든 응답에 `X-Request-Id` 헤더. 오류 `message`는 사용자에게 그대로 보여줄 수 있는 한국어.

### 1.6 쓰기 규칙
- 모든 쓰기는 이 API 하나로만(설계서 §5.3 "쓰기 경로는 하나"). 쓰기가 성공하면 코어가 `events`에 기록하고(§6.3) 볼트 노트를 다시 만든다(비동기, 응답을 기다리게 하지 않음).
- 사용자가 웹앱에서 바꾼 필드는 `overrides`에 올라가고, 그 뒤 에이전트는 그 필드를 바꾸지 않는다(§6.2 필드 소유권, §7.2-1).
- `PATCH`는 **보낸 필드만** 바꾼다(JSON merge). `null`을 보내면 값 비우기(허용된 필드만).
- 멱등 키: `POST /imports`, `POST /*/accept|reject`는 `Idempotency-Key` 헤더를 받으면 같은 키의 재요청에 같은 응답을 준다(선택).

---

## 2. 인증 · CORS · 보안 · 버전

### 2.1 인증
- **MVP: 인증 없음.** 대신 다음 세 가지로 막는다.
  1. `127.0.0.1`에만 바인딩(외부 인터페이스 없음).
  2. **Host 헤더 검사**(DNS 리바인딩 방지): `Host`가 `127.0.0.1:<port>`·`localhost:<port>` 또는 **§2.2 개발 origin의 host**(`localhost:5173`, `127.0.0.1:5173`, `SUBBRAIN_DEV_ORIGINS`에 넣은 것)가 아니면 `403 FORBIDDEN_ORIGIN`. 개발 origin host를 허용하는 이유: Vite 프록시 기본값(`changeOrigin:false`)은 브라우저의 `Host: 127.0.0.1:5173`을 그대로 넘긴다(1.0.1).
  3. **Origin 검사**: `Origin` 헤더가 있으면 허용 목록(자기 자신 + §2.2의 개발 origin)만 통과. 상태를 바꾸는 요청(POST/PATCH/PUT)에서 허용되지 않은 Origin이면 `403`.
- **나중(Phase 3, 확장 프로그램 도입 시): 페어링 토큰.** 웹앱에서 한 번 발급(`POST /pairing`)해 확장 프로그램·MCP 서버에 저장, `Authorization: Bearer <token>`으로 호출(설계서 §5.4①-A, §12.1). 도입 후에도 같은 origin 웹앱은 쿠키 없이 로컬 세션 토큰을 `GET /session`으로 받는 방식을 검토. **토큰이 생겨도 경로·응답 모양은 바뀌지 않는다.**

### 2.2 CORS (개발용)
- 배포(코어가 웹 정적 파일 제공) = 같은 origin → CORS 헤더 불필요.
- 개발: Vite 개발 서버 origin을 허용한다. 기본 허용 목록:
  - `http://localhost:5173`, `http://127.0.0.1:5173` (Vite 기본 포트)
  - 추가는 환경변수 `SUBBRAIN_DEV_ORIGINS="http://localhost:5174,http://localhost:4173"` (쉼표 구분)
- 허용 메서드 `GET, POST, PATCH, PUT, OPTIONS`, 허용 헤더 `Content-Type, Idempotency-Key, Authorization`, 노출 헤더 `X-Request-Id, X-SubBrain-Api-Version`. 쿠키를 쓰지 않으므로 `credentials` 없음.
- **권장**: 웹 개발 시 Vite `server.proxy`로 `/api` → `http://127.0.0.1:4545` 프록시(그러면 CORS 자체가 필요 없음). CORS 허용은 프록시 없이 붙을 때를 위한 것.

```ts
// web/vite.config.ts (참고)
server: { proxy: { '/api': 'http://127.0.0.1:4545' } }
```

### 2.3 버전
- 경로 버전: `/api/v1`. 모든 응답 헤더에 `X-SubBrain-Api-Version: 1.7.0`, `GET /health`의 `apiVersion`도 같은 값. 1.1.0~1.7.0은 **추가만 하는 변경**(필드·엔드포인트 추가, 기존 필드 의미 유지 — 예외 1개: 1.3.0 `ClassificationStatus.today.costUsd`가 `number | null`이 됨, §12.6) — 웹이 리터럴로 만드는 타입(`TaskListItem`·대시보드 `badges`·`DigestResponse`·`GraphNode`)에 더한 필드는 선택(`?`)이다.
- **v1 안에서는 더하기만** 한다(새 필드·새 엔드포인트·새 열거값). 웹은 모르는 필드를 무시하고, 모르는 열거값은 기본 표시로 처리해야 한다.
- 필드 삭제·이름 변경·의미 변경은 `/api/v2`로. v1은 최소 한 버전 동안 같이 둔다.
- LATER 표시가 붙은 필드는 **MVP 응답에도 키는 항상 있고** 값이 `null` 또는 `[]`이다(목·화면을 미리 만들 수 있게).

### 2.4 개인정보
- API 키는 어떤 응답에도 나오지 않는다(`apiKeySet: true`만). 설계서 §12.1.
- 사람 객체(Phase 1.5)는 설정에서 허용하지 않으면 `label`이 역할("디자이너(사람)")로 나온다(§8.8, §12.2).

---

## 3. 모노레포 구성 계획

> **런타임: Node.js 22 LTS 이상 필수(22.13+ 권장)** — 코어가 내장 `node:sqlite`를 쓰기 때문(설계서 §13). `node:sqlite`는 **Node 22.5**에 들어왔고 22.13부터 플래그 없이 쓸 수 있다. Node 20 이하에는 `node:sqlite`가 없다.
> → `.nvmrc`(22)를 따르거나 nvm/fnm 등으로 Node 22를 설치해 쓴다.
> 확인 결과(2026-09-30): `node:sqlite`에서 FTS5 `trigram` 동작함, 3글자 이상 검색 OK, **2글자("이사")는 0건** → 설계서 §6.4의 대체 검색이 실제로 필요함(설계서 §16.1 T2 일부 확인).

```
subbrain/
├── API_CONTRACT.md              ← 이 문서 (생성물)
├── scripts/
│   ├── contract.template.md     ← 이 문서의 원본 틀
│   └── build-contract.mjs       ← 틀 + api-types.ts + 목 JSON → API_CONTRACT.md
├── package.json                 ← private, "packageManager": "pnpm@9", engines.node ">=22.13"
├── pnpm-workspace.yaml          ← packages: ["packages/*", "web"]
├── tsconfig.base.json
├── .nvmrc                       ← 22
├── packages/
│   ├── shared/                  ← @subbrain/shared (엔진 담당)
│   │   ├── mocks/
│   │   │   ├── fixtures.ts      ← 타입 검사되는 예시 데이터 (이 문서의 JSON 예시 원본)
│   │   │   ├── dump.ts          ← fixtures → json/*.json
│   │   │   └── json/*.json      ← 웹 목용 파일
│   │   └── src/
│   │       ├── api-types.ts     ← 이 문서 §4의 타입 (웹·코어·MCP 공용)
│   │       ├── schemas.ts       ← zod 스키마(요청 검증·LLM 출력·frontmatter) — Phase 1 구현 때
│   │       ├── constants.ts     ← 상태 색·AI 표식·관계 색·기준 일수 기본값(§10.2)
│   │       └── build-flags.ts   ← personal | sellable (설계서 §9.2.4)
│   └── core/                    ← @subbrain/core (엔진 담당)
│       └── src/
│           ├── server.ts        ← Hono 앱, 127.0.0.1 바인딩, Host/Origin 검사, CORS
│           ├── routes/          ← 이 문서의 절 단위(graph, projects, tasks, digests, search, imports, settings…)
│           ├── db/              ← node:sqlite 연결(WAL, busy_timeout, foreign_keys), 마이그레이션, 저장 계층 인터페이스(better-sqlite3로 교체 가능, §15 위험)
│           ├── importers/       ← chatgpt(트리에서 현재 가지), claude  (§5.4②)
│           ├── classifier/      ← LLM 호출(Vercel AI SDK), 입력 줄이기·비밀정보 가림(§7.5), 프롬프트(§7.6)
│           ├── rules/           ← 최종 상태 규칙(§7.2), 방치 단계(§7.3), 이어서 하기 점수(§7.7)
│           ├── search/          ← trigram / bigram / LIKE 대체(§6.4)
│           ├── digest/          ← 오늘의 요약 생성(§7.7, §10.6)
│           ├── vault/           ← 단방향 볼트 생성 + vault_files 해시 + 충돌 백업(§5.4④)
│           ├── queue/           ← SQLite 테이블 기반 작업 큐 + 스케줄러
│           └── cli.ts           ← subbrain start | import | regenerate-vault | autostart install (§13)
└── web/                         ← @subbrain/web (웹 담당 에이전트 소유, React + Vite)
```

- 웹은 `@subbrain/shared`의 `api-types.ts`를 `workspace:*`로 가져다 쓴다(타입만, 런타임 의존 없음).
- 코어는 `hono`, `@hono/node-server`, `zod`, `ai`(Vercel AI SDK), `gray-matter`, `yauzl`(ZIP) 정도만 쓴다. 네이티브 모듈 없음(설계서 §13 원칙).
---

## 4. 공유 타입 (TypeScript)

### 4.1 핵심 타입 결정 (요약)

| 결정 | 내용 | 근거 |
|---|---|---|
| 과제 상태 값 | 한국어 문자열 그대로 `"진행 중" \| "멈춤" \| "완료" \| "간단한 질문" \| "보관"` | §6.2, §6.3 `tasks.status`, §7.2 |
| 화면 토큰 분리 | `statusVisual` = `run \| stall2 \| stall \| done \| quick \| archived` (디자인 v3 CSS 클래스와 같은 이름) | §10.2.3 |
| 멈춤 세분 | `staleStage` = `short_pause`(4–7) · `stale`(8–30) · `long_stale`(31–90) · `dormant`(90+). 키는 계약서가 정함 | §7.3 (라벨만 있음) |
| 포기한 일 | 별도 상태 없이 `status:"완료"` + `completionReason:"abandoned"` | §7.2-5 (별도 상태는 [결정 필요] → 나중에 상태 추가는 v1 안의 "더하기"로 가능) |
| 간단한 질문 | 과제 테이블의 한 행(`kind:"quick_question"`, `status:"간단한 질문"`). 그래프에서도 `type:"task"` | §6.1 대화 1개 = 과제 1개, §7.2-3 |
| 그래프 노드 종류 | `ObjectType`(9종, §8.2) + `wiki` + `ai_service`(선택) | §8.2, §10.2.5 |
| 그래프 엣지 종류 | `LinkType`(10종, §8.3) + `same_task_candidate` + `wiki_source` + `from_ai` | §8.3, §10.2.5 |
| 과제 모드 엣지 매핑 | 과제→프로젝트 = `part_of`, 과제→주제 = `related_to`(점선), 과제→과제 후속 = `derived_from`, 과제↔과제 합치기 후보 = `same_task_candidate`, 프로젝트↔프로젝트 = `related_to`(+`reason`) | §8.3 "속함은 tasks.project_id에서 자동", §10.2.5 |
| 주제 | MVP부터 `objects` 테이블의 `topic` 객체(`obj_topic_*`)로 저장(분류 결과 `topics_json`에서 규칙으로 생성, `origin:"rule"`) → Phase 1.5에서 그대로 확장 | §8.2 "기존 topics가 이 타입으로 옮겨옴" |
| 결정 | `id`는 결정 객체 id(`obj_decision_*`). MVP도 분류 결과의 `decisions`를 결정 객체로 저장 | §6.2 필드 소유권, §8.2 |
| 대화↔과제 | 대화마다 주 과제 1개(`conversations.task_id`) + "공유" 과제 0개 이상(`sharedWithTasks`) | 디자인 02 "‘1차 디자인’과 공유" — §15-2 |
| 프로젝트 표시 상태 | `activity`는 과제들에서 파생(진행 중 > 멈춤 > 완료), 생애 상태 `status`(active/paused/done)와 분리 | §6.2, 디자인 01 — §15-3 |
| 개수·크기 | 서버가 `size`(0..1), `recency`(0..1), `badge`("12일")까지 계산해서 준다 → 웹은 그리기만 | §10.2.5 |

### 4.2 전체 타입 (`packages/shared/src/api-types.ts`와 동일)

```ts
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
```

---

## 5. 시스템: health · meta · dashboard

### 5.1 `GET /api/v1/health` — MVP
코어가 떠 있는지, 버전, SQLite 기능(trigram·bigram 색인 여부), 볼트·작업자 상태. 웹은 시작할 때 한 번 부르고 `apiVersion`의 주 버전이 1인지 확인한다. 실패하면 "서브브레인 코어가 실행 중이 아닙니다" 화면.

응답 `200 HealthResponse`
```json
{
  "status": "ok",
  "apiVersion": "1.10.1",
  "coreVersion": "0.1.0",
  "node": "v22.23.4",
  "buildTarget": "personal",
  "startedAt": "2026-09-30T08:30:00+09:00",
  "uptimeSec": 0,
  "db": {
    "path": "/tmp/subbrain-mocks-bDgXou/subbrain.db",
    "journalMode": "wal",
    "schemaVersion": 8,
    "sqliteVersion": "3.53.4",
    "fts5": true,
    "trigram": true,
    "bigramIndex": false,
    "sizeBytes": 6319608
  },
  "vault": {
    "path": "/tmp/subbrain-mocks-bDgXou/vault",
    "lastGeneratedAt": "2026-09-30T08:30:00+09:00",
    "conflictCount": 1
  },
  "workers": {"queueDepth": 0, "running": 0, "paused": false, "pausedReason": null},
  "llm": {"provider": "anthropic", "model": "claude-haiku-4-5", "configured": true}
}
```

### 5.2 `GET /api/v1/meta` — MVP
열거값의 한국어 라벨·색·모양, 객체/관계 타입 메타(DB `object_types`·`link_types`, §8.4), 방치 기준. 웹은 앱 시작 시 한 번 받아 캐시한다(`packages/shared/constants.ts`에도 같은 기본값이 있음 — 사용자가 타입을 켜고 끄거나 기준을 바꾸면 이 응답이 달라짐).

응답 `200 MetaResponse`
```json
{
  "statuses": [
    {"value": "진행 중", "visual": "run", "colorHex": "#5ED3A0", "labelKo": "진행 중"},
    {"value": "멈춤", "visual": "stall", "colorHex": "#FF8A65", "labelKo": "멈춤"},
    {"value": "완료", "visual": "done", "colorHex": "#8C94A8", "labelKo": "완료"},
    {"value": "간단한 질문", "visual": "quick", "colorHex": "#5E677D", "labelKo": "간단한 질문"},
    {"value": "보관", "visual": "archived", "colorHex": "#535D75", "labelKo": "보관"}
  ],
  "statusVisuals": {
    "run": {"colorHex": "#5ED3A0", "ring": "solid", "labelKo": "진행 중"},
    "stall2": {"colorHex": "#F2B45A", "ring": "dashed", "labelKo": "잠깐 멈춤 (4–7일)"},
    "stall": {"colorHex": "#FF8A65", "ring": "dashed", "labelKo": "7일 넘게 멈춤"},
    "done": {"colorHex": "#8C94A8", "ring": "none", "labelKo": "완료"},
    "quick": {"colorHex": "#5E677D", "ring": "dot", "labelKo": "간단한 질문"},
    "archived": {"colorHex": null, "ring": "none", "labelKo": "보관"}
  },
  "staleStages": [
    {"key": "short_pause", "labelKo": "잠깐 멈춤", "emoji": "🟡", "minDays": 4, "maxDays": 7},
    {"key": "stale", "labelKo": "방치", "emoji": "🟠", "minDays": 8, "maxDays": 30},
    {"key": "long_stale", "labelKo": "오래 방치", "emoji": "🔴", "minDays": 31, "maxDays": 90},
    {"key": "dormant", "labelKo": "휴면", "emoji": "⚫", "minDays": 91, "maxDays": null}
  ],
  "sourceAis": [
    {"key": "chatgpt", "labelKo": "ChatGPT", "shape": "circle", "colorHex": "#4CC38A"},
    {"key": "claude", "labelKo": "Claude", "shape": "rounded_square", "colorHex": "#E88C60"},
    {"key": "gemini", "labelKo": "Gemini", "shape": "diamond", "colorHex": "#7EA2F7"},
    {"key": "grok", "labelKo": "Grok", "shape": "triangle", "colorHex": "#D8DCE5"},
    {"key": "claude-code", "labelKo": "Claude Code", "shape": "rounded_square", "colorHex": "#B8603A"},
    {"key": "codex", "labelKo": "Codex", "shape": "circle", "colorHex": "#2E8F62"},
    {"key": "grokbot", "labelKo": "Grok Bot", "shape": "triangle", "colorHex": "#9AA3B5"}
  ],
  "projectPalette": ["#F07F5E", "#5B8DEF", "#36C2A6", "#D768A6", "#E8B63E", "#A393E0", "#4DB9E3", "#9CCB5E"],
  "objectTypes": [
    {"key": "person", "labelKo": "사람", "icon": "person", "sensitive": true, "enabled": false},
    {"key": "project", "labelKo": "프로젝트", "icon": "sphere", "sensitive": false, "enabled": true},
    {"key": "task", "labelKo": "과제", "icon": "sphere-ring", "sensitive": false, "enabled": true},
    {"key": "decision", "labelKo": "결정", "icon": "flag-check", "sensitive": false, "enabled": true},
    {"key": "tool", "labelKo": "도구/기술", "icon": "wrench", "sensitive": false, "enabled": true},
    {"key": "artifact", "labelKo": "파일/자료", "icon": "document", "sensitive": false, "enabled": false},
    {"key": "place", "labelKo": "장소", "icon": "pin", "sensitive": false, "enabled": false},
    {"key": "organization", "labelKo": "조직", "icon": "building", "sensitive": false, "enabled": false},
    {"key": "topic", "labelKo": "주제", "icon": "hash", "sensitive": false, "enabled": true}
  ],
  "linkTypes": [
    {
      "key": "uses",
      "labelKo": "사용함",
      "directed": true,
      "colorHex": "#5B8DEF",
      "line": "solid",
      "arrow": false,
      "hiddenByDefault": false
    },
    {
      "key": "decided",
      "labelKo": "결정함",
      "directed": true,
      "colorHex": "#E8B63E",
      "line": "solid",
      "arrow": false,
      "hiddenByDefault": false
    },
    {
      "key": "blocked_by",
      "labelKo": "막혔음",
      "directed": true,
      "colorHex": "#FF8A65",
      "line": "dashed",
      "arrow": true,
      "hiddenByDefault": false
    },
    {
      "key": "derived_from",
      "labelKo": "파생함",
      "directed": true,
      "colorHex": "#A393E0",
      "line": "solid",
      "arrow": true,
      "hiddenByDefault": false
    },
    {
      "key": "references",
      "labelKo": "참고함",
      "directed": true,
      "colorHex": "#4DB9E3",
      "line": "thin",
      "arrow": false,
      "hiddenByDefault": false
    },
    {
      "key": "part_of",
      "labelKo": "속함",
      "directed": true,
      "colorHex": "#535D75",
      "line": "thin",
      "arrow": false,
      "hiddenByDefault": false
    },
    {
      "key": "supersedes",
      "labelKo": "대체함",
      "directed": true,
      "colorHex": "#D768A6",
      "line": "solid",
      "arrow": true,
      "hiddenByDefault": false
    },
    {
      "key": "affects",
      "labelKo": "영향 줌",
      "directed": true,
      "colorHex": "#36C2A6",
      "line": "solid",
      "arrow": true,
      "hiddenByDefault": false
    },
    {
      "key": "located_at",
      "labelKo": "위치함",
      "directed": true,
      "colorHex": "#9CCB5E",
      "line": "thin",
      "arrow": false,
      "hiddenByDefault": false
    },
    {
      "key": "related_to",
      "labelKo": "관련 있음",
      "directed": false,
      "colorHex": "#8089A0",
      "line": "dotted",
      "arrow": false,
      "hiddenByDefault": true
    }
  ],
  "thresholds": {"inProgressMaxDays": 3, "shortPauseMaxDays": 7, "staleMaxDays": 30, "longStaleMaxDays": 90}
}
```

### 5.3 `GET /api/v1/dashboard` — MVP
상단바(§10.3: 수집 상태 "수집 1분 전", 오늘 날짜, "승인 1건" 배지)와 홈 카운터(§10.4: 진행 중 · 멈춤(7일 넘은 것) · 이번 주 완료 · 간단한 질문). 모든 화면이 30초마다 다시 불러도 되는 가벼운 응답.

- 쿼리: 없음
- 규칙: `stalledOver7Days` = 멈춤 중 `staleDays ≥ 8`. `completedThisWeek` = 이번 주(월요일 시작) `completedAt`. `totalTasks` = 간단한 질문·보관 제외 과제 수(되감기 슬라이더 "오늘 · 과제 58개").
- `collection.sources`: MVP(확장 프로그램 없음)는 `methods:["export"]`, `methodLabel:"내보내기 가져오기"`, `lastCapturedAt`=마지막 가져오기 시각. 아래 예시는 Phase 3 이후 모습(디자인과 같게).
- `badges.digestApprovals`: MVP=0. Phase 1.5부터 제안 검토 수, Phase 6부터 삭제 배치 1건을 더함.

응답 `200 DashboardResponse`
```json
{
  "today": "2026-09-30",
  "counts": {
    "inProgress": 7,
    "stalled": 11,
    "stalledOver7Days": 4,
    "completedThisWeek": 2,
    "quickQuestions": 26,
    "archived": 29,
    "needsReview": 3,
    "totalTasks": 43,
    "allTasks": 98
  },
  "collection": {
    "lastCapturedAt": "2026-09-30T08:05:12+09:00",
    "overallHealth": "ok",
    "sources": [
      {
        "sourceAi": "chatgpt",
        "methods": ["export"],
        "methodLabel": "내보내기 가져오기",
        "lastCapturedAt": "2026-09-30T08:05:12+09:00",
        "health": "ok",
        "message": null
      },
      {
        "sourceAi": "claude",
        "methods": ["export"],
        "methodLabel": "내보내기 가져오기",
        "lastCapturedAt": "2026-09-28T21:40:03+09:00",
        "health": "ok",
        "message": null
      }
    ]
  },
  "badges": {
    "digestApprovals": 0,
    "pendingMergeSuggestions": 1,
    "vaultConflicts": 1,
    "runningImports": 0,
    "pendingProjectSuggestions": 0
  },
  "latestDigestDate": "2026-09-30"
}
```

MVP의 `collection.sources` 예시:
```json
[
  {
    "sourceAi": "chatgpt",
    "methods": ["export"],
    "methodLabel": "내보내기 가져오기",
    "lastCapturedAt": "2026-09-30T08:05:12+09:00",
    "health": "ok",
    "message": null
  },
  {
    "sourceAi": "claude",
    "methods": ["export"],
    "methodLabel": "내보내기 가져오기",
    "lastCapturedAt": "2026-09-28T21:40:03+09:00",
    "health": "ok",
    "message": null
  }
]
```

---

## 6. 그래프 (홈)

### 6.1 `GET /api/v1/graph` — MVP (관계 모드 1.5, 되감기 2)
홈 그래프(§10.4, §10.2.5), 과제 상세의 미니맵(`focus`+`depth`), 오늘의 요약의 "어제 움직인 프로젝트" 작은 그래프(웹이 `movedProjects`로 그려도 됨)에 쓴다. 2D(MVP)와 3D(Phase 5)가 **같은 응답**을 쓴다(§10.10).

| 쿼리 | 타입 | 기본 | 설명 |
|---|---|---|---|
| `mode` | `task \| ontology` | `task` | `ontology`는 계속 `501` — 관계 모드 데이터는 1.7.0부터 `GET /ontology`(§14.2) |
| `status` | `TaskStatus[]` (쉼표) | 전체 | 필터 메뉴 "상태" (§10.8) |
| `sourceAi` | `SourceAi[]` | 전체 | |
| `projectId` | `string[]` | 전체 | |
| `from`, `to` | `ISODate` | 없음 | 마지막 활동 기간 |
| `includeQuick` | boolean | `true` | 간단한 질문 점. 노드 수가 `limit`에 가까우면 코어가 숨기고 `stats.hiddenQuickCount`로 알림 (§10.2.5) |
| `includeDone` | boolean | `true` | |
| `includeWiki` | boolean | `true` | MVP엔 위키 노드 없음 |
| `focus` | node id | 없음 | 이 노드와 이웃만 (과제 상세 미니맵 "이웃 6") |
| `depth` | `1 \| 2` | `1` | focus 기준 깊이 (§10.11 펼치기 깊이) |
| `at` | `ISODate` | 오늘 | **Phase 2**: 시점 되감기(§10.8). MVP는 오늘이 아니면 `501` |
| `objectTypes`, `linkTypes`, `hideSingleMention` | | | ontology 모드 전용(§10.11). `related_to`는 기본 제외 |
| `limit` | number | 1500 | 노드 상한 |

규칙
- 노드 `id`는 도메인 id(`prj_*`, `task_*`, `obj_topic_*`, `wiki_*`). 선택 시 오른쪽 패널: `project`→`GET /projects/:id`, `task`→`GET /tasks/:id`, `topic`→`GET /topics/:id`.
- `size`: 같은 종류 안에서 `sqrt(messageCount)`를 0..1로 정규화("크기 = 대화량", 디자인 01 범례). `recency`: 마지막 활동이 오늘이면 1, 90일 이상이면 0.
- `badge`: 멈춤이면 `"N일"` (4–7일은 노랑, 8일+ 주황 — 색은 `statusVisual`로). 선택 상태(흰 이중 고리)는 웹 상태.
- 과제 모드 엣지: `part_of`(과제→프로젝트), `related_to`(과제→주제, 점선 / 프로젝트↔프로젝트, `reason` 포함), `derived_from`(과제→과제 후속), `same_task_candidate`(대기 중 합치기 제안), `wiki_source`(위키→과제, Phase 5).
- 되감기(Phase 2)는 `events`만으로 그 날짜의 노드·상태를 다시 계산한다(§10.8). 끝난 관계(`endedAt`)는 흐리게.

그래프 프로젝트 노드의 `messageCount`·`conversationCount`·`taskCount`는 필터와 무관하게 `GET /projects`의 프로젝트 요약과 같은 값(보관 과제의 대화 포함, 공유 대화는 한 번).

응답 `200 GraphResponse` (발췌 — `?focus=task_20260830_01&depth=1`. 필터 없는 전체 응답은 `mocks/json/graph.json`: 노드 85 · 엣지 89)
```json
{
  "mode": "task",
  "at": "2026-09-30",
  "generatedAt": "2026-09-30T08:30:00+09:00",
  "nodes": [
    {
      "id": "prj_blog",
      "type": "project",
      "label": "블로그 리뉴얼",
      "objectId": null,
      "projectId": "prj_blog",
      "colorHex": "#F07F5E",
      "kind": null,
      "status": null,
      "statusVisual": null,
      "staleDays": null,
      "staleStage": null,
      "badge": null,
      "sourceAis": ["chatgpt", "claude", "gemini", "grok"],
      "messageCount": 402,
      "conversationCount": 43,
      "taskCount": 7,
      "size": 1,
      "recency": 0.99,
      "firstActivityAt": "2026-06-11T20:03:00+09:00",
      "lastActivityAt": "2026-09-29T21:31:00+09:00",
      "objectStatus": null,
      "mentionCount": null,
      "confidence": null,
      "tooltip": "블로그 리뉴얼 · 과제 7 · 마지막 대화 9월 29일"
    },
    {
      "id": "task_20260830_01",
      "type": "task",
      "label": "메인 페이지 카피 확정",
      "objectId": null,
      "projectId": "prj_blog",
      "colorHex": "#F07F5E",
      "kind": "task",
      "status": "멈춤",
      "statusVisual": "stall",
      "staleDays": 12,
      "staleStage": "stale",
      "badge": "12일",
      "sourceAis": ["chatgpt", "claude", "gemini"],
      "messageCount": 89,
      "conversationCount": 5,
      "taskCount": null,
      "size": 1,
      "recency": 0.87,
      "firstActivityAt": "2026-08-30T23:12:00+09:00",
      "lastActivityAt": "2026-09-18T01:47:00+09:00",
      "objectStatus": null,
      "mentionCount": null,
      "confidence": null,
      "tooltip": "메인 페이지 카피 확정 · 12일째 멈춤 · 마지막 대화 9월 18일"
    },
    {
      "id": "task_20260902_01",
      "type": "task",
      "label": "소개 페이지 톤 맞추기",
      "objectId": null,
      "projectId": "prj_blog",
      "colorHex": "#F07F5E",
      "kind": "task",
      "status": "멈춤",
      "statusVisual": "stall2",
      "staleDays": 6,
      "staleStage": "short_pause",
      "badge": "6일",
      "sourceAis": ["claude"],
      "messageCount": 22,
      "conversationCount": 2,
      "taskCount": null,
      "size": 0.5,
      "recency": 0.93,
      "firstActivityAt": "2026-09-02T10:20:00+09:00",
      "lastActivityAt": "2026-09-24T22:10:00+09:00",
      "objectStatus": null,
      "mentionCount": null,
      "confidence": null,
      "tooltip": "소개 페이지 톤 맞추기 · 6일째 멈춤 · 마지막 대화 9월 24일"
    },
    {
      "id": "obj_topic_copywriting",
      "type": "topic",
      "label": "카피라이팅",
      "objectId": "obj_topic_copywriting",
      "projectId": null,
      "colorHex": null,
      "kind": null,
      "status": null,
      "statusVisual": null,
      "staleDays": null,
      "staleStage": null,
      "badge": null,
      "sourceAis": [],
      "messageCount": 0,
      "conversationCount": 9,
      "taskCount": null,
      "size": 0.83,
      "recency": 0.93,
      "firstActivityAt": "2026-08-30T23:12:00+09:00",
      "lastActivityAt": "2026-09-24T22:10:00+09:00",
      "objectStatus": "accepted",
      "mentionCount": 12,
      "confidence": 0.9,
      "tooltip": "#카피라이팅 · 과제 4개"
    },
    {
      "id": "obj_topic_branding",
      "type": "topic",
      "label": "브랜딩",
      "objectId": "obj_topic_branding",
      "projectId": null,
      "colorHex": null,
      "kind": null,
      "status": null,
      "statusVisual": null,
      "staleDays": null,
      "staleStage": null,
      "badge": null,
      "sourceAis": [],
      "messageCount": 0,
      "conversationCount": 5,
      "taskCount": null,
      "size": 0.62,
      "recency": 0.87,
      "firstActivityAt": "2026-08-30T23:12:00+09:00",
      "lastActivityAt": "2026-09-18T01:47:00+09:00",
      "objectStatus": "accepted",
      "mentionCount": 3,
      "confidence": 0.9,
      "tooltip": "#브랜딩 · 과제 1개"
    },
    {
      "id": "obj_topic_blog",
      "type": "topic",
      "label": "블로그",
      "objectId": "obj_topic_blog",
      "projectId": null,
      "colorHex": null,
      "kind": null,
      "status": null,
      "statusVisual": null,
      "staleDays": null,
      "staleStage": null,
      "badge": null,
      "sourceAis": [],
      "messageCount": 0,
      "conversationCount": 13,
      "taskCount": null,
      "size": 1,
      "recency": 0.99,
      "firstActivityAt": "2026-06-12T21:00:00+09:00",
      "lastActivityAt": "2026-09-29T21:31:00+09:00",
      "objectStatus": "accepted",
      "mentionCount": 18,
      "confidence": 0.9,
      "tooltip": "#블로그 · 과제 6개"
    }
  ],
  "edges": [
    {
      "id": "part_of:task_20260830_01",
      "type": "part_of",
      "source": "task_20260830_01",
      "target": "prj_blog",
      "directed": true,
      "status": "accepted",
      "confidence": null,
      "endedAt": null,
      "weight": 1,
      "reason": null
    },
    {
      "id": "part_of:task_20260902_01",
      "type": "part_of",
      "source": "task_20260902_01",
      "target": "prj_blog",
      "directed": true,
      "status": "accepted",
      "confidence": null,
      "endedAt": null,
      "weight": 1,
      "reason": null
    },
    {
      "id": "topic:task_20260830_01:obj_topic_copywriting",
      "type": "related_to",
      "source": "task_20260830_01",
      "target": "obj_topic_copywriting",
      "directed": false,
      "status": "accepted",
      "confidence": 0.9,
      "endedAt": null,
      "weight": 1,
      "reason": null
    },
    {
      "id": "topic:task_20260830_01:obj_topic_branding",
      "type": "related_to",
      "source": "task_20260830_01",
      "target": "obj_topic_branding",
      "directed": false,
      "status": "accepted",
      "confidence": 0.9,
      "endedAt": null,
      "weight": 1,
      "reason": null
    },
    {
      "id": "topic:task_20260830_01:obj_topic_blog",
      "type": "related_to",
      "source": "task_20260830_01",
      "target": "obj_topic_blog",
      "directed": false,
      "status": "accepted",
      "confidence": 0.9,
      "endedAt": null,
      "weight": 1,
      "reason": null
    },
    {
      "id": "topic:task_20260902_01:obj_topic_copywriting",
      "type": "related_to",
      "source": "task_20260902_01",
      "target": "obj_topic_copywriting",
      "directed": false,
      "status": "accepted",
      "confidence": 0.9,
      "endedAt": null,
      "weight": 1,
      "reason": null
    },
    {
      "id": "topic:task_20260902_01:obj_topic_blog",
      "type": "related_to",
      "source": "task_20260902_01",
      "target": "obj_topic_blog",
      "directed": false,
      "status": "accepted",
      "confidence": 0.9,
      "endedAt": null,
      "weight": 1,
      "reason": null
    },
    {
      "id": "derived_from:task_20260902_01:task_20260830_01",
      "type": "derived_from",
      "source": "task_20260902_01",
      "target": "task_20260830_01",
      "directed": true,
      "status": "accepted",
      "confidence": 0.86,
      "endedAt": null,
      "weight": 1,
      "reason": "메인 카피가 정해지면 같은 톤으로 다시 쓰기로 함"
    }
  ],
  "stats": {
    "projectCount": 1,
    "taskCount": 2,
    "quickQuestionCount": 0,
    "topicCount": 3,
    "hiddenQuickCount": 0,
    "truncated": false
  }
}
```

### 6.2 `GET /api/v1/activity` — MVP
되감기 슬라이더의 주간 대화 수 막대(§10.4 "주간 활동 막대", 26주), 프로젝트 패널 스파크라인(16주)에 쓴다. 되감기 자체는 Phase 2지만 막대는 MVP에서도 보여준다.

| 쿼리 | 타입 | 기본 | 설명 |
|---|---|---|---|
| `granularity` | `week \| day` | `week` | 주는 월요일 시작 |
| `weeks` | number | 26 | `from`이 없을 때 오늘부터 거꾸로 |
| `from`, `to` | `ISODate` | | |
| `projectId` | string | 없음 | 프로젝트 하나만 |

응답 `200 ActivityResponse` (발췌 6주)
```json
{
  "granularity": "week",
  "from": "2026-04-06",
  "to": "2026-09-30",
  "projectId": null,
  "buckets": [
    {"start": "2026-04-06", "conversationCount": 5, "messageCount": 50, "taskCount": 2},
    {"start": "2026-04-13", "conversationCount": 7, "messageCount": 73, "taskCount": 3},
    {"start": "2026-04-20", "conversationCount": 5, "messageCount": 52, "taskCount": 3},
    {"start": "2026-04-27", "conversationCount": 5, "messageCount": 48, "taskCount": 4},
    {"start": "2026-05-04", "conversationCount": 5, "messageCount": 42, "taskCount": 5},
    {"start": "2026-05-11", "conversationCount": 6, "messageCount": 58, "taskCount": 6},
    {"start": "2026-05-18", "conversationCount": 7, "messageCount": 65, "taskCount": 7},
    {"start": "2026-05-25", "conversationCount": 6, "messageCount": 57, "taskCount": 8},
    {"start": "2026-06-01", "conversationCount": 5, "messageCount": 44, "taskCount": 9},
    {"start": "2026-06-08", "conversationCount": 8, "messageCount": 78, "taskCount": 11},
    {"start": "2026-06-15", "conversationCount": 6, "messageCount": 60, "taskCount": 14},
    {"start": "2026-06-22", "conversationCount": 9, "messageCount": 90, "taskCount": 15},
    {"start": "2026-06-29", "conversationCount": 4, "messageCount": 29, "taskCount": 18},
    {"start": "2026-07-06", "conversationCount": 7, "messageCount": 68, "taskCount": 21},
    {"start": "2026-07-13", "conversationCount": 7, "messageCount": 79, "taskCount": 22},
    {"start": "2026-07-20", "conversationCount": 13, "messageCount": 129, "taskCount": 26},
    {"start": "2026-07-27", "conversationCount": 10, "messageCount": 87, "taskCount": 28},
    {"start": "2026-08-03", "conversationCount": 5, "messageCount": 45, "taskCount": 31},
    {"start": "2026-08-10", "conversationCount": 8, "messageCount": 68, "taskCount": 35},
    {"start": "2026-08-17", "conversationCount": 15, "messageCount": 114, "taskCount": 39},
    {"start": "2026-08-24", "conversationCount": 21, "messageCount": 172, "taskCount": 44},
    {"start": "2026-08-31", "conversationCount": 20, "messageCount": 215, "taskCount": 51},
    {"start": "2026-09-07", "conversationCount": 15, "messageCount": 136, "taskCount": 54},
    {"start": "2026-09-14", "conversationCount": 19, "messageCount": 113, "taskCount": 59},
    {"start": "2026-09-21", "conversationCount": 27, "messageCount": 155, "taskCount": 69},
    {"start": "2026-09-28", "conversationCount": 16, "messageCount": 127, "taskCount": 72}
  ]
}
```

---

## 7. 프로젝트 · 주제 (홈 오른쪽 패널)

### 7.1 `GET /api/v1/projects` — MVP
설정 화면의 프로젝트·동의어 목록, 필터 메뉴. `?status=active,paused&limit&cursor`. 정렬은 마지막 활동 최근 순.

응답 `200 ListResponse<ProjectSummary>`
```json
{
  "items": [
    {
      "id": "prj_subbrain",
      "name": "서브브레인",
      "aliases": ["SubBrain", "subbrain"],
      "status": "active",
      "colorHex": "#5B8DEF",
      "activity": {"status": "진행 중", "staleDays": null, "statusVisual": "run"},
      "taskCount": 9,
      "conversationCount": 58,
      "startedAt": "2026-08-18T20:03:00+09:00",
      "lastActivityAt": "2026-09-30T00:20:00+09:00",
      "thresholds": null
    },
    {
      "id": "prj_blog",
      "name": "블로그 리뉴얼",
      "aliases": ["블로그", "blog renewal"],
      "status": "active",
      "colorHex": "#F07F5E",
      "activity": {"status": "진행 중", "staleDays": null, "statusVisual": "run"},
      "taskCount": 7,
      "conversationCount": 43,
      "startedAt": "2026-06-11T20:03:00+09:00",
      "lastActivityAt": "2026-09-29T21:31:00+09:00",
      "thresholds": null
    },
    {
      "id": "prj_moving",
      "name": "이사 준비",
      "aliases": ["이사"],
      "status": "active",
      "colorHex": "#36C2A6",
      "activity": {"status": "진행 중", "staleDays": null, "statusVisual": "run"},
      "taskCount": 5,
      "conversationCount": 19,
      "startedAt": "2026-07-28T20:00:00+09:00",
      "lastActivityAt": "2026-09-29T19:41:00+09:00",
      "thresholds": null
    },
    {
      "id": "prj_devstudy",
      "name": "개발 공부",
      "aliases": ["공부", "dev"],
      "status": "active",
      "colorHex": "#4DB9E3",
      "activity": {"status": "완료", "staleDays": null, "statusVisual": "done"},
      "taskCount": 6,
      "conversationCount": 22,
      "startedAt": "2026-06-20T21:00:00+09:00",
      "lastActivityAt": "2026-09-29T10:12:00+09:00",
      "thresholds": null
    },
    {
      "id": "prj_health",
      "name": "건강",
      "aliases": ["운동"],
      "status": "active",
      "colorHex": "#9CCB5E",
      "activity": {"status": "진행 중", "staleDays": null, "statusVisual": "run"},
      "taskCount": 3,
      "conversationCount": 9,
      "startedAt": "2026-08-25T21:00:00+09:00",
      "lastActivityAt": "2026-09-29T07:40:00+09:00",
      "thresholds": null
    },
    {
      "id": "prj_kyoto",
      "name": "가을 교토 여행",
      "aliases": ["교토", "일본 여행"],
      "status": "active",
      "colorHex": "#D768A6",
      "activity": {"status": "멈춤", "staleDays": 4, "statusVisual": "stall2"},
      "taskCount": 4,
      "conversationCount": 12,
      "startedAt": "2026-09-02T21:00:00+09:00",
      "lastActivityAt": "2026-09-26T23:50:00+09:00",
      "thresholds": null
    },
    {
      "id": "prj_dividend",
      "name": "배당 가계부",
      "aliases": ["배당", "가계부"],
      "status": "active",
      "colorHex": "#E8B63E",
      "activity": {"status": "멈춤", "staleDays": 6, "statusVisual": "stall2"},
      "taskCount": 3,
      "conversationCount": 11,
      "startedAt": "2026-07-10T21:00:00+09:00",
      "lastActivityAt": "2026-09-24T20:30:00+09:00",
      "thresholds": null
    },
    {
      "id": "prj_career",
      "name": "커리어",
      "aliases": ["이직", "이력서"],
      "status": "active",
      "colorHex": "#A393E0",
      "activity": {"status": "멈춤", "staleDays": 34, "statusVisual": "stall"},
      "taskCount": 4,
      "conversationCount": 16,
      "startedAt": "2026-07-20T21:00:00+09:00",
      "lastActivityAt": "2026-08-27T23:30:00+09:00",
      "thresholds": null
    }
  ],
  "page": {"limit": 50, "nextCursor": null, "hasMore": false, "total": 8}
}
```

### 7.2 `GET /api/v1/projects/:projectId` — MVP
홈 오른쪽 상세 패널(§10.4, 디자인 01): 제목, Obsidian 노트 링크, 표시 상태("12일째 멈춤" 등), 시작일, 마지막 활동, 과제 수·대화 수, 요약, 주간 대화 수(16주), AI별 대화 수, **AI가 제안한 다음 단계** 카드(근거 + "ChatGPT에서 이어서"), 과제 목록(멈춘 기간 긴 순), 관련 프로젝트.

- 쿼리: `weeks`(기본 16)
- `tasks` 정렬: 멈춤(`staleDays` 큰 순) → 진행 중 → 완료(최근 완료 순). 간단한 질문은 빼고 `quickQuestionCount`로만. 웹은 완료를 2개 넘으면 "완료 N개 더 보기"로 접는다.
- `nextStep`: 이 프로젝트에서 이어서 하기 점수(§7.7)가 가장 높은 과제의 다음 단계. "맥락 프롬프트 복사"는 `GET /tasks/:taskId/resume-prompt`, "다른 AI로…"는 같은 엔드포인트에 `targetAi`.
- `activity.status`는 파생값(§15-3). 아래 예시는 "글 목록 태그 필터"가 어제(9/29) 진행 중이라 `진행 중`이다(디자인 01의 "12일째 멈춤"은 시안 데이터가 서로 맞지 않는 부분).

응답 `200 ProjectDetail`
```json
{
  "id": "prj_blog",
  "name": "블로그 리뉴얼",
  "aliases": ["블로그", "blog renewal"],
  "status": "active",
  "colorHex": "#F07F5E",
  "activity": {"status": "진행 중", "staleDays": null, "statusVisual": "run"},
  "taskCount": 7,
  "conversationCount": 43,
  "startedAt": "2026-06-11T20:03:00+09:00",
  "lastActivityAt": "2026-09-29T21:31:00+09:00",
  "thresholds": null,
  "summary": "1차 디자인과 섹션 구성은 끝났고, 메인 카피를 두 안 중에 고르다 멈춰 있어요.",
  "vault": {
    "path": "projects/블로그-리뉴얼.md",
    "obsidianUri": "obsidian://open?vault=SubBrain&file=projects%2F%EB%B8%94%EB%A1%9C%EA%B7%B8-%EB%A6%AC%EB%89%B4%EC%96%BC.md"
  },
  "weeklyConversations": {
    "weeks": 16,
    "buckets": [
      {"start": "2026-06-15", "count": 4},
      {"start": "2026-06-22", "count": 5},
      {"start": "2026-06-29", "count": 3},
      {"start": "2026-07-06", "count": 3},
      {"start": "2026-07-13", "count": 1},
      {"start": "2026-07-20", "count": 2},
      {"start": "2026-07-27", "count": 3},
      {"start": "2026-08-03", "count": 1},
      {"start": "2026-08-10", "count": 3},
      {"start": "2026-08-17", "count": 2},
      {"start": "2026-08-24", "count": 0},
      {"start": "2026-08-31", "count": 3},
      {"start": "2026-09-07", "count": 2},
      {"start": "2026-09-14", "count": 2},
      {"start": "2026-09-21", "count": 1},
      {"start": "2026-09-28", "count": 2}
    ]
  },
  "byAi": [
    {"sourceAi": "chatgpt", "conversationCount": 21, "messageCount": 214},
    {"sourceAi": "claude", "conversationCount": 14, "messageCount": 131},
    {"sourceAi": "gemini", "conversationCount": 6, "messageCount": 45},
    {"sourceAi": "grok", "conversationCount": 2, "messageCount": 12}
  ],
  "nextStep": {
    "taskId": "task_20260830_01",
    "taskTitle": "메인 페이지 카피 확정",
    "text": "A안을 기준으로 보조 문장 3개와 CTA 2개 쓰기",
    "evidence": {
      "conversationId": "conv_chatgpt_68f2a91c",
      "sourceAi": "chatgpt",
      "at": "2026-09-18T01:37:28+09:00",
      "quote": "A가 더 나 같긴 한데, 너무 밋밋한가? 내일 다시 볼게",
      "label": "9월 18일 ChatGPT 대화의 마지막 메시지"
    },
    "continue": {
      "sourceAi": "chatgpt",
      "url": "https://chatgpt.com/c/68f2a91c-4b7e-8003-a1d2-9c0e5b7f3a21",
      "conversationId": "conv_chatgpt_68f2a91c",
      "label": "ChatGPT에서 이어서"
    }
  },
  "tasks": [
    {
      "id": "task_20260805_01",
      "title": "RSS 피드 붙이기",
      "summary": "라우트 핸들러로 만들다 멈춤. 우선순위 낮음",
      "kind": "task",
      "status": "멈춤",
      "statusVisual": "stall",
      "staleDays": 54,
      "staleStage": "long_stale",
      "badge": "54일",
      "project": {"id": "prj_blog", "name": "블로그 리뉴얼", "colorHex": "#F07F5E"},
      "sourceAis": ["grok"],
      "conversationCount": 1,
      "messageCount": 6,
      "startedAt": "2026-08-05T21:44:00+09:00",
      "lastActivityAt": "2026-08-07T00:15:00+09:00",
      "completedAt": null,
      "nextStep": "app/feed.xml/route.ts에서 글 목록을 RSS 2.0으로 내보내기",
      "nextStepInfo": {
        "text": "app/feed.xml/route.ts에서 글 목록을 RSS 2.0으로 내보내기",
        "source": "saved",
        "basis": "분류 결과"
      },
      "needsReview": false,
      "pin": false,
      "primaryConversation": {
        "id": "conv_grok_19ab2c7d",
        "sourceAi": "grok",
        "url": "https://grok.com/chat/19ab2c7d-0e44-4b1f-9a52-7f3e0c2d8b16"
      },
      "handoff": null,
      "classificationState": "ok",
      "blockedReason": null,
      "blockedModel": null,
      "confidence": 0.81,
      "completionReason": null,
      "conversationOutcome": {
        "outcome": "open",
        "status": "멈춤",
        "staleDays": 54,
        "label": "멈춤 54일",
        "target": null,
        "evidence": null,
        "detectedBy": "derived"
      }
    },
    {
      "id": "task_20260830_01",
      "title": "메인 페이지 카피 확정",
      "summary": "후보 3개 중 A/B로 좁힘. 톤은 ‘담백하게’로 합의",
      "kind": "task",
      "status": "멈춤",
      "statusVisual": "stall",
      "staleDays": 12,
      "staleStage": "stale",
      "badge": "12일",
      "project": {"id": "prj_blog", "name": "블로그 리뉴얼", "colorHex": "#F07F5E"},
      "sourceAis": ["chatgpt", "claude", "gemini"],
      "conversationCount": 5,
      "messageCount": 89,
      "startedAt": "2026-08-30T23:12:00+09:00",
      "lastActivityAt": "2026-09-18T01:47:00+09:00",
      "completedAt": null,
      "nextStep": "A안을 기준으로 보조 문장 3개와 CTA 2개 쓰기",
      "nextStepInfo": {"text": "A안을 기준으로 보조 문장 3개와 CTA 2개 쓰기", "source": "saved", "basis": "분류 결과"},
      "needsReview": false,
      "pin": false,
      "primaryConversation": {
        "id": "conv_chatgpt_68f2a91c",
        "sourceAi": "chatgpt",
        "url": "https://chatgpt.com/c/68f2a91c-4b7e-8003-a1d2-9c0e5b7f3a21"
      },
      "handoff": null,
      "classificationState": "ok",
      "blockedReason": null,
      "blockedModel": null,
      "confidence": 0.86,
      "completionReason": null,
      "conversationOutcome": {
        "outcome": "open",
        "status": "멈춤",
        "staleDays": 12,
        "label": "멈춤 12일",
        "target": null,
        "evidence": null,
        "detectedBy": "derived"
      }
    },
    {
      "id": "task_20260902_01",
      "title": "소개 페이지 톤 맞추기",
      "summary": "메인 카피가 정해지면 같은 톤으로 다시 쓰기로 함",
      "kind": "task",
      "status": "멈춤",
      "statusVisual": "stall2",
      "staleDays": 6,
      "staleStage": "short_pause",
      "badge": "6일",
      "project": {"id": "prj_blog", "name": "블로그 리뉴얼", "colorHex": "#F07F5E"},
      "sourceAis": ["claude"],
      "conversationCount": 2,
      "messageCount": 22,
      "startedAt": "2026-09-02T10:20:00+09:00",
      "lastActivityAt": "2026-09-24T22:10:00+09:00",
      "completedAt": null,
      "nextStep": "메인 카피 확정 후 소개 문단 1·2를 같은 톤으로 다시 쓰기",
      "nextStepInfo": {"text": "메인 카피 확정 후 소개 문단 1·2를 같은 톤으로 다시 쓰기", "source": "saved", "basis": "분류 결과"},
      "needsReview": false,
      "pin": false,
      "primaryConversation": {
        "id": "conv_claude_e02b5a91",
        "sourceAi": "claude",
        "url": "https://claude.ai/chat/e02b5a91-6c3d-4f70-b1a8-2d9e4c7f0a35"
      },
      "handoff": null,
      "classificationState": "ok",
      "blockedReason": null,
      "blockedModel": null,
      "confidence": 0.78,
      "completionReason": null,
      "conversationOutcome": {
        "outcome": "open",
        "status": "멈춤",
        "staleDays": 6,
        "label": "멈춤 6일",
        "target": null,
        "evidence": null,
        "detectedBy": "derived"
      }
    },
    {
      "id": "task_20260927_01",
      "title": "글 목록 태그 필터",
      "summary": "칩 대신 텍스트 링크로 바꾸는 중 — 모바일 줄바꿈 확인 필요",
      "kind": "task",
      "status": "진행 중",
      "statusVisual": "run",
      "staleDays": null,
      "staleStage": null,
      "badge": null,
      "project": {"id": "prj_blog", "name": "블로그 리뉴얼", "colorHex": "#F07F5E"},
      "sourceAis": ["chatgpt"],
      "conversationCount": 1,
      "messageCount": 9,
      "startedAt": "2026-09-27T13:02:00+09:00",
      "lastActivityAt": "2026-09-29T21:31:00+09:00",
      "completedAt": null,
      "nextStep": "375px 화면에서 태그 줄바꿈 확인",
      "nextStepInfo": {"text": "375px 화면에서 태그 줄바꿈 확인", "source": "saved", "basis": "분류 결과"},
      "needsReview": false,
      "pin": false,
      "primaryConversation": {
        "id": "conv_chatgpt_7c0d3e55",
        "sourceAi": "chatgpt",
        "url": "https://chatgpt.com/c/7c0d3e55-2a19-8001-b6f4-5e8a1d0c9b72"
      },
      "handoff": null,
      "classificationState": "ok",
      "blockedReason": null,
      "blockedModel": null,
      "confidence": 0.9,
      "completionReason": null,
      "conversationOutcome": {
        "outcome": "open",
        "status": "진행 중",
        "staleDays": null,
        "label": "진행 중",
        "target": null,
        "evidence": null,
        "detectedBy": "derived"
      }
    },
    {
      "id": "task_20260703_01",
      "title": "1차 디자인 시안",
      "summary": "레퍼런스 4개 중 2번 방향(여백 넓은 단일 칼럼)",
      "kind": "task",
      "status": "완료",
      "statusVisual": "done",
      "staleDays": null,
      "staleStage": null,
      "badge": null,
      "project": {"id": "prj_blog", "name": "블로그 리뉴얼", "colorHex": "#F07F5E"},
      "sourceAis": ["chatgpt", "gemini"],
      "conversationCount": 3,
      "messageCount": 27,
      "startedAt": "2026-07-03T19:30:00+09:00",
      "lastActivityAt": "2026-07-21T23:02:00+09:00",
      "completedAt": "2026-07-21T23:02:00+09:00",
      "nextStep": null,
      "nextStepInfo": null,
      "needsReview": false,
      "pin": false,
      "primaryConversation": {
        "id": "conv_chatgpt_4be8c9f2",
        "sourceAi": "chatgpt",
        "url": "https://chatgpt.com/c/4be8c9f2-cb7c-431a-aef1-3366b3799c84"
      },
      "handoff": null,
      "classificationState": "ok",
      "blockedReason": null,
      "blockedModel": null,
      "confidence": 0.92,
      "completionReason": "resolved",
      "conversationOutcome": {
        "outcome": "done",
        "status": "완료",
        "staleDays": null,
        "label": "끝난 대화",
        "target": null,
        "evidence": null,
        "detectedBy": "derived"
      }
    },
    {
      "id": "task_20260612_01",
      "title": "섹션 구성안",
      "summary": "소개·글 목록·프로젝트·연락 4섹션으로 확정",
      "kind": "task",
      "status": "완료",
      "statusVisual": "done",
      "staleDays": null,
      "staleStage": null,
      "badge": null,
      "project": {"id": "prj_blog", "name": "블로그 리뉴얼", "colorHex": "#F07F5E"},
      "sourceAis": ["chatgpt"],
      "conversationCount": 2,
      "messageCount": 19,
      "startedAt": "2026-06-12T21:00:00+09:00",
      "lastActivityAt": "2026-06-20T22:31:00+09:00",
      "completedAt": "2026-06-20T22:31:00+09:00",
      "nextStep": null,
      "nextStepInfo": null,
      "needsReview": false,
      "pin": false,
      "primaryConversation": {
        "id": "conv_chatgpt_1a14c47c",
        "sourceAi": "chatgpt",
        "url": "https://chatgpt.com/c/1a14c47c-a5d6-46f4-a837-f1d942c5420a"
      },
      "handoff": null,
      "classificationState": "ok",
      "blockedReason": null,
      "blockedModel": null,
      "confidence": 0.9,
      "completionReason": "resolved",
      "conversationOutcome": {
        "outcome": "done",
        "status": "완료",
        "staleDays": null,
        "label": "끝난 대화",
        "target": null,
        "evidence": null,
        "detectedBy": "derived"
      }
    },
    {
      "id": "task_20260615_01",
      "title": "도메인·호스팅 결정",
      "summary": "Vercel + 기존 도메인 유지로 결정",
      "kind": "task",
      "status": "완료",
      "statusVisual": "done",
      "staleDays": null,
      "staleStage": null,
      "badge": null,
      "project": {"id": "prj_blog", "name": "블로그 리뉴얼", "colorHex": "#F07F5E"},
      "sourceAis": ["claude"],
      "conversationCount": 1,
      "messageCount": 11,
      "startedAt": "2026-06-15T20:12:00+09:00",
      "lastActivityAt": "2026-06-15T21:40:00+09:00",
      "completedAt": "2026-06-15T21:40:00+09:00",
      "nextStep": null,
      "nextStepInfo": null,
      "needsReview": false,
      "pin": false,
      "primaryConversation": {
        "id": "conv_claude_5f81c0d2",
        "sourceAi": "claude",
        "url": "https://claude.ai/chat/5f81c0d2-3b6a-4e19-8d70-a1c4e9b2f063"
      },
      "handoff": null,
      "classificationState": "ok",
      "blockedReason": null,
      "blockedModel": null,
      "confidence": 0.93,
      "completionReason": "resolved",
      "conversationOutcome": {
        "outcome": "done",
        "status": "완료",
        "staleDays": null,
        "label": "끝난 대화",
        "target": null,
        "evidence": null,
        "detectedBy": "derived"
      }
    }
  ],
  "quickQuestionCount": 3,
  "relatedProjects": [
    {
      "project": {"id": "prj_subbrain", "name": "서브브레인", "colorHex": "#5B8DEF"},
      "reason": "같은 주제 #카피라이팅 · 겹치는 과제 1개",
      "sharedTopicIds": ["obj_topic_copywriting"]
    },
    {
      "project": {"id": "prj_career", "name": "커리어", "colorHex": "#A393E0"},
      "reason": "포트폴리오 글을 블로그로 옮기기로 함 (8월 4일)",
      "sharedTopicIds": ["obj_topic_portfolio"]
    },
    {
      "project": {"id": "prj_devstudy", "name": "개발 공부", "colorHex": "#4DB9E3"},
      "reason": "Next.js 배포 위키 2건을 참고함",
      "sharedTopicIds": ["obj_topic_deploy"]
    }
  ]
}
```

### 7.3 `POST /api/v1/projects` — MVP
본문 `CreateProjectBody` → `201 ProjectSummary`. 색을 안 주면 팔레트(§10.2.1) 8색을 순서대로 돈다(9번째는 1번째 색). 이름이 겹치면 `409 CONFLICT`(§6.3 `projects.name UNIQUE`).
```json
{"name": "가을 교토 여행", "aliases": ["교토", "일본 여행"]}
```

### 7.4 `PATCH /api/v1/projects/:projectId` — MVP
본문 `UpdateProjectBody` → `200 ProjectSummary`. `thresholds`로 프로젝트별 방치 기준(§7.3 "장기 프로젝트는 진행 중 기준 7일"). `null`이면 기본값으로.
```json
{"aliases": ["교토", "일본 여행", "kyoto"], "thresholds": {"inProgressMaxDays": 5}}
```

### 7.5 `GET /api/v1/topics/:topicId` — MVP
주제 노드를 골랐을 때의 패널(§10.8 "프로젝트/과제/주제별 내용"). 연결된 과제·프로젝트, 언급 수, 주별 언급 막대. 위키는 Phase 5 전엔 `[]`.

응답 `200 TopicDetail`
```json
{
  "id": "obj_topic_copywriting",
  "name": "카피라이팅",
  "aliases": ["copywriting", "카피"],
  "objectStatus": "accepted",
  "mentionCount": 12,
  "firstSeenAt": "2026-08-30T12:00:00+09:00",
  "lastSeenAt": "2026-09-22T12:00:00+09:00",
  "tasks": [
    {
      "id": "task_20260902_01",
      "title": "소개 페이지 톤 맞추기",
      "summary": "메인 카피가 정해지면 같은 톤으로 다시 쓰기로 함",
      "kind": "task",
      "status": "멈춤",
      "statusVisual": "stall2",
      "staleDays": 6,
      "staleStage": "short_pause",
      "badge": "6일",
      "project": {"id": "prj_blog", "name": "블로그 리뉴얼", "colorHex": "#F07F5E"},
      "sourceAis": ["claude"],
      "conversationCount": 2,
      "messageCount": 22,
      "startedAt": "2026-09-02T10:20:00+09:00",
      "lastActivityAt": "2026-09-24T22:10:00+09:00",
      "completedAt": null,
      "nextStep": "메인 카피 확정 후 소개 문단 1·2를 같은 톤으로 다시 쓰기",
      "nextStepInfo": {"text": "메인 카피 확정 후 소개 문단 1·2를 같은 톤으로 다시 쓰기", "source": "saved", "basis": "분류 결과"},
      "needsReview": false,
      "pin": false,
      "primaryConversation": {
        "id": "conv_claude_e02b5a91",
        "sourceAi": "claude",
        "url": "https://claude.ai/chat/e02b5a91-6c3d-4f70-b1a8-2d9e4c7f0a35"
      },
      "handoff": null,
      "classificationState": "ok",
      "blockedReason": null,
      "blockedModel": null,
      "confidence": 0.78,
      "completionReason": null,
      "conversationOutcome": {
        "outcome": "open",
        "status": "멈춤",
        "staleDays": 6,
        "label": "멈춤 6일",
        "target": null,
        "evidence": null,
        "detectedBy": "derived"
      }
    },
    {
      "id": "task_20260924_02",
      "title": "소개 페이지 문장 다듬기",
      "summary": "소개 페이지 문장을 짧게 고치는 중",
      "kind": "task",
      "status": "멈춤",
      "statusVisual": "stall2",
      "staleDays": 6,
      "staleStage": "short_pause",
      "badge": "6일",
      "project": null,
      "sourceAis": ["chatgpt"],
      "conversationCount": 1,
      "messageCount": 12,
      "startedAt": "2026-09-24T20:00:00+09:00",
      "lastActivityAt": "2026-09-24T21:10:00+09:00",
      "completedAt": null,
      "nextStep": "소개 문단 두 번째 문장 줄이기",
      "nextStepInfo": {"text": "소개 문단 두 번째 문장 줄이기", "source": "saved", "basis": "분류 결과"},
      "needsReview": true,
      "pin": false,
      "primaryConversation": {
        "id": "conv_chatgpt_ecce7181",
        "sourceAi": "chatgpt",
        "url": "https://chatgpt.com/c/ecce7181-588b-4c87-a251-37adaf9e7e77"
      },
      "handoff": null,
      "classificationState": "ok",
      "blockedReason": null,
      "blockedModel": null,
      "confidence": 0.52,
      "completionReason": null,
      "conversationOutcome": {
        "outcome": "open",
        "status": "멈춤",
        "staleDays": 6,
        "label": "멈춤 6일",
        "target": null,
        "evidence": null,
        "detectedBy": "derived"
      }
    },
    {
      "id": "task_20260919_02",
      "title": "온보딩 문구 다듬기",
      "summary": "첫 화면 문구를 3줄로 줄이고 버튼은 ‘가져오기 시작’으로",
      "kind": "task",
      "status": "완료",
      "statusVisual": "done",
      "staleDays": null,
      "staleStage": null,
      "badge": null,
      "project": {"id": "prj_subbrain", "name": "서브브레인", "colorHex": "#5B8DEF"},
      "sourceAis": ["claude"],
      "conversationCount": 1,
      "messageCount": 6,
      "startedAt": "2026-09-19T20:10:00+09:00",
      "lastActivityAt": "2026-09-21T22:48:00+09:00",
      "completedAt": "2026-09-21T22:48:00+09:00",
      "nextStep": null,
      "nextStepInfo": null,
      "needsReview": false,
      "pin": false,
      "primaryConversation": {
        "id": "conv_claude_7ad4344c",
        "sourceAi": "claude",
        "url": "https://claude.ai/chat/7ad4344c-174b-49dc-af6e-d01c0791775e"
      },
      "handoff": null,
      "classificationState": "ok",
      "blockedReason": null,
      "blockedModel": null,
      "confidence": 0.85,
      "completionReason": "resolved",
      "conversationOutcome": {
        "outcome": "done",
        "status": "완료",
        "staleDays": null,
        "label": "끝난 대화",
        "target": null,
        "evidence": null,
        "detectedBy": "derived"
      }
    },
    {
      "id": "task_20260830_01",
      "title": "메인 페이지 카피 확정",
      "summary": "후보 3개 중 A/B로 좁힘. 톤은 ‘담백하게’로 합의",
      "kind": "task",
      "status": "멈춤",
      "statusVisual": "stall",
      "staleDays": 12,
      "staleStage": "stale",
      "badge": "12일",
      "project": {"id": "prj_blog", "name": "블로그 리뉴얼", "colorHex": "#F07F5E"},
      "sourceAis": ["chatgpt", "claude", "gemini"],
      "conversationCount": 5,
      "messageCount": 89,
      "startedAt": "2026-08-30T23:12:00+09:00",
      "lastActivityAt": "2026-09-18T01:47:00+09:00",
      "completedAt": null,
      "nextStep": "A안을 기준으로 보조 문장 3개와 CTA 2개 쓰기",
      "nextStepInfo": {"text": "A안을 기준으로 보조 문장 3개와 CTA 2개 쓰기", "source": "saved", "basis": "분류 결과"},
      "needsReview": false,
      "pin": false,
      "primaryConversation": {
        "id": "conv_chatgpt_68f2a91c",
        "sourceAi": "chatgpt",
        "url": "https://chatgpt.com/c/68f2a91c-4b7e-8003-a1d2-9c0e5b7f3a21"
      },
      "handoff": null,
      "classificationState": "ok",
      "blockedReason": null,
      "blockedModel": null,
      "confidence": 0.86,
      "completionReason": null,
      "conversationOutcome": {
        "outcome": "open",
        "status": "멈춤",
        "staleDays": 12,
        "label": "멈춤 12일",
        "target": null,
        "evidence": null,
        "detectedBy": "derived"
      }
    }
  ],
  "projects": [
    {"id": "prj_blog", "name": "블로그 리뉴얼", "colorHex": "#F07F5E"},
    {"id": "prj_subbrain", "name": "서브브레인", "colorHex": "#5B8DEF"}
  ],
  "wikiPages": [],
  "weeklyMentions": [
    {"start": "2026-07-13", "count": 1},
    {"start": "2026-08-31", "count": 3},
    {"start": "2026-09-07", "count": 1},
    {"start": "2026-09-14", "count": 1},
    {"start": "2026-09-21", "count": 3}
  ]
}
```

---

## 8. 과제 목록 · 보드 · 과제 상세 · 대화

### 8.1 `GET /api/v1/tasks` — MVP
과제 목록(필터·정렬·페이지). 보드 외의 목록, 검색 필터, MCP `get_unfinished`(Phase 2)가 같은 엔드포인트를 쓴다.

| 쿼리 | 타입 | 기본 | 설명 |
|---|---|---|---|
| `status` | `TaskStatus[]` | `진행 중,멈춤,완료,간단한 질문` | `보관`은 명시해야 나옴(§7.2-7 "목록에서 숨김") |
| `kind` | `task \| quick_question` | 전체 | |
| `projectId` | `string[]` | 전체 | `none` = 프로젝트 없음 |
| `sourceAi` | `SourceAi[]` | 전체 | |
| `from`, `to` | `ISODate` | | 마지막 활동 기간 |
| `needsReview` | boolean | | "확인 필요"만(§7.6, §10.7) |
| `pinned` | boolean | | |
| `minStaleDays` | number | | MCP `get_unfinished(min_stale_days)` |
| `staleStage` | `StaleStage[]` | | |
| `topicId` | string | | |
| `classificationState` | `ok \| blocked` | | 1.1.0 `blocked` = 분류 불가(제공자 안전 차단, §12.7)만 |
| `handedOff` | boolean | | 1.1.0 `true` = "다른 곳에서 이어감"(handoff) 표시가 있는 과제만 |
| `sort` | `stale_desc \| last_activity_desc \| started_desc \| resume_score_desc \| title_asc` | `last_activity_desc` | |
| `limit`, `cursor` | | 50 | §1.4 |

**수 세기 규칙(1.0.1, 모든 응답 공통)**: 과제의 `conversationCount`·`messageCount`·`sourceAis`는 **공유 대화를 포함**한다(목록 `TaskListItem`, 그래프 노드, 프로젝트 상세 `tasks`, 과제 상세 모두 같은 값 — 예: 메인 페이지 카피 확정 = 대화 5 · 메시지 89 · ChatGPT/Claude/Gemini). 프로젝트 합계는 공유 대화를 **한 번만** 센다(중복 없음). 과제의 시작일·첫 대화는 주 대화 기준(§15-2). ~~1.0.0: sourceAis는 주 대화만~~

응답 `200 ListResponse<TaskListItem>`
```json
{
  "items": [
    {
      "id": "task_20260920_01",
      "title": "교토 3박 4일 일정",
      "summary": "둘째 날 아라시야마 동선에서 멈춤",
      "kind": "task",
      "status": "멈춤",
      "statusVisual": "stall2",
      "staleDays": 4,
      "staleStage": "short_pause",
      "badge": "4일",
      "project": {"id": "prj_kyoto", "name": "가을 교토 여행", "colorHex": "#D768A6"},
      "sourceAis": ["gemini"],
      "conversationCount": 3,
      "messageCount": 31,
      "startedAt": "2026-09-20T21:00:00+09:00",
      "lastActivityAt": "2026-09-26T23:50:00+09:00",
      "completedAt": null,
      "nextStep": "둘째 날 오후 동선을 버스 기준으로 다시 짜기",
      "nextStepInfo": {"text": "둘째 날 오후 동선을 버스 기준으로 다시 짜기", "source": "saved", "basis": "분류 결과"},
      "needsReview": false,
      "pin": false,
      "primaryConversation": {
        "id": "conv_gemini_793a3db5",
        "sourceAi": "gemini",
        "url": "https://gemini.google.com/app/793a3db5691593ea"
      },
      "handoff": null,
      "classificationState": "ok",
      "blockedReason": null,
      "blockedModel": null,
      "confidence": 0.85,
      "completionReason": null,
      "conversationOutcome": {
        "outcome": "open",
        "status": "멈춤",
        "staleDays": 4,
        "label": "멈춤 4일",
        "target": null,
        "evidence": null,
        "detectedBy": "derived"
      }
    },
    {
      "id": "task_20260919_01",
      "title": "인터넷 이전 신청",
      "summary": "이전 설치 날짜를 이사 당일로 잡을지 고민 중",
      "kind": "task",
      "status": "멈춤",
      "statusVisual": "stall2",
      "staleDays": 4,
      "staleStage": "short_pause",
      "badge": "4일",
      "project": {"id": "prj_moving", "name": "이사 준비", "colorHex": "#36C2A6"},
      "sourceAis": ["chatgpt"],
      "conversationCount": 1,
      "messageCount": 9,
      "startedAt": "2026-09-19T10:00:00+09:00",
      "lastActivityAt": "2026-09-26T21:10:00+09:00",
      "completedAt": null,
      "nextStep": "통신사에 이전 설치 가능한 날짜 문의하기",
      "nextStepInfo": {"text": "통신사에 이전 설치 가능한 날짜 문의하기", "source": "saved", "basis": "분류 결과"},
      "needsReview": false,
      "pin": false,
      "primaryConversation": {
        "id": "conv_chatgpt_04abfe52",
        "sourceAi": "chatgpt",
        "url": "https://chatgpt.com/c/04abfe52-d82d-47e1-a05b-a7fc8341608a"
      },
      "handoff": null,
      "classificationState": "ok",
      "blockedReason": null,
      "blockedModel": null,
      "confidence": 0.85,
      "completionReason": null,
      "conversationOutcome": {
        "outcome": "open",
        "status": "멈춤",
        "staleDays": 4,
        "label": "멈춤 4일",
        "target": null,
        "evidence": null,
        "detectedBy": "derived"
      }
    },
    {
      "id": "task_20260921_03",
      "title": "홈트 루틴 식단",
      "summary": "주 3회 홈트 루틴은 정했고 식단 부분을 고민 중",
      "kind": "task",
      "status": "멈춤",
      "statusVisual": "stall2",
      "staleDays": 4,
      "staleStage": "short_pause",
      "badge": "4일",
      "project": {"id": "prj_health", "name": "건강", "colorHex": "#9CCB5E"},
      "sourceAis": ["gemini"],
      "conversationCount": 1,
      "messageCount": 7,
      "startedAt": "2026-09-21T07:30:00+09:00",
      "lastActivityAt": "2026-09-26T08:05:00+09:00",
      "completedAt": null,
      "nextStep": "아침 식단 3가지 후보 중 하나 고르기",
      "nextStepInfo": {"text": "아침 식단 3가지 후보 중 하나 고르기", "source": "saved", "basis": "분류 결과"},
      "needsReview": false,
      "pin": false,
      "primaryConversation": {
        "id": "conv_gemini_85360ec3",
        "sourceAi": "gemini",
        "url": "https://gemini.google.com/app/85360ec33fd77f72"
      },
      "handoff": null,
      "classificationState": "ok",
      "blockedReason": null,
      "blockedModel": null,
      "confidence": 0.85,
      "completionReason": null,
      "conversationOutcome": {
        "outcome": "open",
        "status": "멈춤",
        "staleDays": 4,
        "label": "멈춤 4일",
        "target": null,
        "evidence": null,
        "detectedBy": "derived"
      }
    }
  ],
  "page": {"limit": 3, "nextCursor": "eyJvIjozfQ", "hasMore": true, "total": 11}
}
```

### 8.2 `GET /api/v1/board` — MVP
칸반(§10.7): 열 **진행 중 | 멈춤 | 완료(최근 14일) | 간단한 질문(접힘)**. 카드: 제목, 한 줄 요약, AI 표식, 프로젝트 태그, "12일째" 배지, 다음 단계. 필터: 프로젝트, AI, 기간, "확인 필요"만.

| 쿼리 | 기본 | 설명 |
|---|---|---|
| `projectId`, `sourceAi`, `from`, `to`, `needsReview` | | `/tasks`와 같음 |
| `doneWithinDays` | 14 | 완료 열 기간 |
| `columnLimit` | 100 | 열마다 카드 상한(`hasMore`면 `/tasks?status=…`로 더 불러옴) |

- 열 안 정렬: 진행 중=마지막 활동 최근 순, 멈춤=`staleDays` 큰 순, 완료=완료 최근 순, 간단한 질문=최근 순(접힌 열은 `items:[]` + `total`, 펼치면 `/tasks?status=간단한 질문`).
- 끌어서 상태 변경 = `PATCH /tasks/:id {status}`. 카드 동작: 원래 대화 열기(`primaryConversation.url`), 프롬프트 복사(`/resume-prompt`), 보관(`PATCH {status:"보관"}`), 과제 합치기(`POST /tasks/:id/merge`).
- `weeklyResumeSuggestions`: 4–7일 멈춤 "이번 주 이어서 하기" 추천(§7.3).

응답 `200 BoardResponse` (줄임 — 배열은 앞 2개씩만. 전체는 `mocks/json/board.json`)
```json
{
  "columns": [
    {
      "status": "진행 중",
      "labelKo": "진행 중",
      "collapsed": false,
      "total": 7,
      "items": [
        {
          "id": "task_20260929_01",
          "title": "분류 프롬프트 정확도 시험",
          "summary": "정답 세트 100건으로 정확도를 재는 중",
          "kind": "task",
          "status": "진행 중",
          "statusVisual": "run",
          "staleDays": null,
          "staleStage": null,
          "badge": null,
          "project": {"id": "prj_subbrain", "name": "서브브레인", "colorHex": "#5B8DEF"},
          "sourceAis": ["claude"],
          "conversationCount": 2,
          "messageCount": 52,
          "startedAt": "2026-09-29T14:40:00+09:00",
          "lastActivityAt": "2026-09-30T00:20:00+09:00",
          "completedAt": null,
          "nextStep": "틀린 23건의 공통점 정리",
          "nextStepInfo": {"text": "틀린 23건의 공통점 정리", "source": "saved", "basis": "분류 결과"},
          "needsReview": false,
          "pin": false,
          "primaryConversation": {
            "id": "conv_claude_7dee29ba",
            "sourceAi": "claude",
            "url": "https://claude.ai/chat/7dee29ba-63b3-4414-a507-ed0b5046ceee"
          },
          "handoff": null,
          "classificationState": "ok",
          "blockedReason": null,
          "blockedModel": null,
          "confidence": 0.88,
          "completionReason": null,
          "conversationOutcome": {
            "outcome": "interrupted",
            "status": "진행 중",
            "staleDays": null,
            "label": "끊김(토큰 한도)",
            "target": null,
            "evidence": "마지막 사용자 메시지: ‘토큰이 다 떨어져서 오늘은 여기까지, 정리 파일 md로 만들어줘’",
            "detectedBy": "rule"
          }
        },
        {
          "id": "task_20260924_01",
          "title": "그래프 홈 시안",
          "summary": "그래프 홈의 노드 크기·색 규칙을 정하고 필터 막대를 그리는 중",
          "kind": "task",
          "status": "진행 중",
          "statusVisual": "run",
          "staleDays": null,
          "staleStage": null,
          "badge": null,
          "project": {"id": "prj_subbrain", "name": "서브브레인", "colorHex": "#5B8DEF"},
          "sourceAis": ["claude"],
          "conversationCount": 2,
          "messageCount": 21,
          "startedAt": "2026-09-24T20:00:00+09:00",
          "lastActivityAt": "2026-09-29T22:40:00+09:00",
          "completedAt": null,
          "nextStep": "되감기 막대와 노드 흐림 효과 연결하기",
          "nextStepInfo": {"text": "되감기 막대와 노드 흐림 효과 연결하기", "source": "saved", "basis": "분류 결과"},
          "needsReview": false,
          "pin": false,
          "primaryConversation": {
            "id": "conv_claude_296a5a76",
            "sourceAi": "claude",
            "url": "https://claude.ai/chat/296a5a76-1bcf-4781-ae5e-d9e20f002600"
          },
          "handoff": null,
          "classificationState": "ok",
          "blockedReason": null,
          "blockedModel": null,
          "confidence": 0.85,
          "completionReason": null,
          "conversationOutcome": {
            "outcome": "open",
            "status": "진행 중",
            "staleDays": null,
            "label": "진행 중",
            "target": null,
            "evidence": null,
            "detectedBy": "derived"
          }
        }
      ],
      "hasMore": false
    },
    {
      "status": "멈춤",
      "labelKo": "멈춤",
      "collapsed": false,
      "total": 11,
      "items": [
        {
          "id": "task_20260805_01",
          "title": "RSS 피드 붙이기",
          "summary": "라우트 핸들러로 만들다 멈춤. 우선순위 낮음",
          "kind": "task",
          "status": "멈춤",
          "statusVisual": "stall",
          "staleDays": 54,
          "staleStage": "long_stale",
          "badge": "54일",
          "project": {"id": "prj_blog", "name": "블로그 리뉴얼", "colorHex": "#F07F5E"},
          "sourceAis": ["grok"],
          "conversationCount": 1,
          "messageCount": 6,
          "startedAt": "2026-08-05T21:44:00+09:00",
          "lastActivityAt": "2026-08-07T00:15:00+09:00",
          "completedAt": null,
          "nextStep": "app/feed.xml/route.ts에서 글 목록을 RSS 2.0으로 내보내기",
          "nextStepInfo": {
            "text": "app/feed.xml/route.ts에서 글 목록을 RSS 2.0으로 내보내기",
            "source": "saved",
            "basis": "분류 결과"
          },
          "needsReview": false,
          "pin": false,
          "primaryConversation": {
            "id": "conv_grok_19ab2c7d",
            "sourceAi": "grok",
            "url": "https://grok.com/chat/19ab2c7d-0e44-4b1f-9a52-7f3e0c2d8b16"
          },
          "handoff": null,
          "classificationState": "ok",
          "blockedReason": null,
          "blockedModel": null,
          "confidence": 0.81,
          "completionReason": null,
          "conversationOutcome": {
            "outcome": "open",
            "status": "멈춤",
            "staleDays": 54,
            "label": "멈춤 54일",
            "target": null,
            "evidence": null,
            "detectedBy": "derived"
          }
        },
        {
          "id": "task_20260827_01",
          "title": "영문 이력서 다듬기",
          "summary": "경력 요약 문단을 세 번 고치다 멈춤",
          "kind": "task",
          "status": "멈춤",
          "statusVisual": "stall",
          "staleDays": 34,
          "staleStage": "long_stale",
          "badge": "34일",
          "project": {"id": "prj_career", "name": "커리어", "colorHex": "#A393E0"},
          "sourceAis": ["chatgpt"],
          "conversationCount": 2,
          "messageCount": 27,
          "startedAt": "2026-08-27T20:00:00+09:00",
          "lastActivityAt": "2026-08-27T23:30:00+09:00",
          "completedAt": null,
          "nextStep": "경력 요약을 3줄로 줄이기",
          "nextStepInfo": {"text": "경력 요약을 3줄로 줄이기", "source": "saved", "basis": "분류 결과"},
          "needsReview": false,
          "pin": false,
          "primaryConversation": {
            "id": "conv_chatgpt_3771cb26",
            "sourceAi": "chatgpt",
            "url": "https://chatgpt.com/c/3771cb26-5ed1-4120-a6ad-bd8c950fd209"
          },
          "handoff": null,
          "classificationState": "ok",
          "blockedReason": null,
          "blockedModel": null,
          "confidence": 0.85,
          "completionReason": null,
          "conversationOutcome": {
            "outcome": "open",
            "status": "멈춤",
            "staleDays": 34,
            "label": "멈춤 34일",
            "target": null,
            "evidence": null,
            "detectedBy": "derived"
          }
        }
      ],
      "hasMore": false
    }
  ],
  "weeklyResumeSuggestions": ["task_20260902_01", "task_20260924_03"]
}
```

### 8.3 `GET /api/v1/tasks/:taskId` — MVP
과제 상세(§10.5, 디자인 02)의 머리·왼쪽 칸·오른쪽 칸 전부. 가운데 "대화 흐름"은 길 수 있어 §8.4로 나눴다. 홈에서 과제 노드를 골랐을 때 패널도 이 응답의 일부를 쓴다.

화면 ↔ 필드
| 화면 요소 | 필드 |
|---|---|
| 경로 "그래프 / 블로그 리뉴얼 / 과제" | `breadcrumb` |
| 제목 + "12일째 멈춤" | `title`, `status`, `stale.staleDays`, `stale.statusVisual` |
| "8월 30일 시작 · 마지막 대화 9월 18일" | `startedAt`, `lastConversationAt` |
| 버튼 Obsidian 노트 / 상태 바꾸기 / 보관 | `vault.obsidianUri` / `PATCH {status}` / `PATCH {status:"보관"}` |
| 미니맵 "이웃 6" | `neighborCount` + `GET /graph?focus=<taskId>&depth=1` |
| 속성: 상태 "멈춤 · 방치 단계 (8~30일)" | `status`, `stale.staleStage` (+ `/meta`의 `staleStages` 라벨·범위) |
| 프로젝트, 첫·마지막 대화, 대화·메시지 수 | `project`, `firstConversationAt`, `lastConversationAt`, `conversationCount`, `messageCount` |
| AI별 "Gemini 1 · 9개 (공유 대화)" | `byAi[].sharedConversationCount` |
| 주제 `#카피라이팅 #브랜딩 #블로그` | `topics` |
| 분류 근거와 신뢰도 0.86 | `classification.evidence`, `classification.confidence` (보정 전 모델 값 = `classification.rawConfidence`, 1.1.0) |
| (1.1.0) "Claude Code에서 이어감" 표시 | `handoff.label` (`handoff.evidence` = 근거 문장) — 목록 `TaskListItem.handoff`도 같은 값 |
| (1.1.0) "분류 불가" 표시 | `classificationState==="blocked"`, `classification.blockedReason`(예: `PROHIBITED_CONTENT`)·`blockedModel` |
| (1.2.0) 목록 카드의 분류 불가 사유·확신도 | `TaskListItem.blockedReason`·`blockedModel`(blocked가 아니면 `null`)·`confidence`(보정 후, 분류 전 `null`) — 상세를 열지 않아도 됨 |
| (1.2.0) "저장된 답 재사용" 표시(선택) | `classification.cached` — 응답 캐시에서 꺼낸 결과(§12.7 재현성) |
| 볼트 노트 경로 | `vault.path` |
| 결정한 것 (4개 · 대화에서 자동 추출) | `decisions` (AI 표식 = `sourceAi`, 날짜 = `decidedAt`) |
| 아직 열린 질문 (체크박스) | `openQuestions` → 체크 = `PATCH /tasks/:id/open-questions/:qid` |
| 이어서 하기 (AI 탭 4개, 미리보기, "ChatGPT에서 이어서"/복사, "원래 대화(9.18)에 이어 붙임") | `resume.*`; 다른 탭 = `GET /resume-prompt?targetAi=` |
| 함께 보면 좋은 것 | `related.similarTasks`, `related.wikiPages`(Phase 5 전엔 `[]`) |
| "왜 멈췄나" 버튼(v1.1) | `whyStalled` — Phase 1.5 전엔 `null`(버튼 숨김) |

응답 `200 TaskDetail`
```json
{
  "id": "task_20260830_01",
  "title": "메인 페이지 카피 확정",
  "kind": "task",
  "status": "멈춤",
  "statusSource": "rule",
  "stale": {"staleDays": 12, "staleStage": "stale", "statusVisual": "stall", "badge": "12일"},
  "completionReason": null,
  "project": {"id": "prj_blog", "name": "블로그 리뉴얼", "colorHex": "#F07F5E"},
  "breadcrumb": [
    {"label": "그래프", "href": "/"},
    {"label": "블로그 리뉴얼", "href": "/?focus=prj_blog"},
    {"label": "과제", "href": null}
  ],
  "origin": "auto",
  "pin": false,
  "overrides": [],
  "startedAt": "2026-08-30T23:12:00+09:00",
  "lastActivityAt": "2026-09-18T01:47:00+09:00",
  "completedAt": null,
  "firstConversationAt": "2026-08-30T23:12:00+09:00",
  "lastConversationAt": "2026-09-18T01:47:00+09:00",
  "conversationCount": 5,
  "messageCount": 89,
  "byAi": [
    {"sourceAi": "chatgpt", "conversationCount": 2, "messageCount": 44, "sharedConversationCount": 0},
    {"sourceAi": "claude", "conversationCount": 2, "messageCount": 36, "sharedConversationCount": 0},
    {"sourceAi": "gemini", "conversationCount": 1, "messageCount": 9, "sharedConversationCount": 1}
  ],
  "topics": [
    {"id": "obj_topic_blog", "name": "블로그"},
    {"id": "obj_topic_copywriting", "name": "카피라이팅"},
    {"id": "obj_topic_branding", "name": "브랜딩"}
  ],
  "summary": "후보 3개 중 A/B로 좁힘. 톤은 ‘담백하게’로 합의",
  "summaryDetail": [
    "메인 카피 후보 11개를 3개로 추렸고, 9월 18일 A(담백한 소개형)와 B(질문형)를 비교함.",
    "A 쪽으로 기울었지만 “밋밋한가?”라는 고민으로 확정하지 않고 끝남.",
    "보이스 원칙(1인칭·짧은 문장·느낌표 없음)은 9월 3일 Claude 대화에서 정함."
  ],
  "nextStep": "A안을 기준으로 보조 문장 3개와 CTA 2개 쓰기",
  "nextStepInfo": {"text": "A안을 기준으로 보조 문장 3개와 CTA 2개 쓰기", "source": "saved", "basis": "분류 결과"},
  "classification": {
    "kind": "task",
    "resolution": "unresolved",
    "completionReason": null,
    "confidence": 0.86,
    "evidence": "“내일 다시 볼게”로 끝남",
    "model": "claude-haiku-4-5",
    "promptVersion": "cls-v1",
    "classifiedAt": "2026-09-18T01:52:30+09:00",
    "needsReview": false,
    "state": "ok",
    "blockedReason": null,
    "blockedModel": null,
    "rawConfidence": null,
    "handoff": null,
    "cached": false
  },
  "handoff": null,
  "classificationState": "ok",
  "conversationOutcome": {
    "outcome": "open",
    "status": "멈춤",
    "staleDays": 12,
    "label": "멈춤 12일",
    "target": null,
    "evidence": null,
    "detectedBy": "derived"
  },
  "conversationOutcomes": [
    {
      "conversationId": "conv_chatgpt_68f2a91c",
      "sourceAi": "chatgpt",
      "title": "카피 A/B 비교",
      "role": "primary",
      "updatedAt": "2026-09-18T01:47:00+09:00",
      "outcome": {
        "outcome": "open",
        "status": "멈춤",
        "staleDays": 12,
        "label": "멈춤 12일",
        "target": null,
        "evidence": null,
        "detectedBy": "derived"
      }
    },
    {
      "conversationId": "conv_chatgpt_5d1e77b0",
      "sourceAi": "chatgpt",
      "title": "메인 카피 후보 뽑기",
      "role": "primary",
      "updatedAt": "2026-09-12T23:02:00+09:00",
      "outcome": {
        "outcome": "open",
        "status": "멈춤",
        "staleDays": 18,
        "label": "멈춤 18일",
        "target": null,
        "evidence": null,
        "detectedBy": "derived"
      }
    },
    {
      "conversationId": "conv_claude_a7c3e210",
      "sourceAi": "claude",
      "title": "블로그 톤 & 보이스 정리",
      "role": "primary",
      "updatedAt": "2026-09-03T21:20:00+09:00",
      "outcome": {
        "outcome": "open",
        "status": "멈춤",
        "staleDays": 27,
        "label": "멈춤 27일",
        "target": null,
        "evidence": null,
        "detectedBy": "derived"
      }
    },
    {
      "conversationId": "conv_claude_3b9d4f12",
      "sourceAi": "claude",
      "title": "소개 문단 초안",
      "role": "primary",
      "updatedAt": "2026-08-31T00:05:00+09:00",
      "outcome": {
        "outcome": "open",
        "status": "멈춤",
        "staleDays": 30,
        "label": "멈춤 30일",
        "target": null,
        "evidence": null,
        "detectedBy": "derived"
      }
    },
    {
      "conversationId": "conv_gemini_c41f8e03",
      "sourceAi": "gemini",
      "title": "헤더 레퍼런스 찾기",
      "role": "shared",
      "updatedAt": "2026-07-15T21:40:00+09:00",
      "outcome": {
        "outcome": "open",
        "status": "멈춤",
        "staleDays": 77,
        "label": "멈춤 77일",
        "target": null,
        "evidence": null,
        "detectedBy": "derived"
      }
    }
  ],
  "vault": {
    "path": "tasks/메인-페이지-카피-확정.md",
    "obsidianUri": "obsidian://open?vault=SubBrain&file=tasks%2F%EB%A9%94%EC%9D%B8-%ED%8E%98%EC%9D%B4%EC%A7%80-%EC%B9%B4%ED%94%BC-%ED%99%95%EC%A0%95.md"
  },
  "decisions": [
    {
      "id": "obj_decision_b812",
      "text": "후보는 A(담백한 소개형)와 B(질문형) 둘로 좁힘",
      "sourceConversationId": "conv_chatgpt_68f2a91c",
      "sourceAi": "chatgpt",
      "decidedAt": "2026-09-18T01:30:00+09:00",
      "valid": true,
      "overridden": false
    },
    {
      "id": "obj_decision_7a1c",
      "text": "메인 카피는 한 줄 + 보조 한 줄 구조로 간다",
      "sourceConversationId": "conv_chatgpt_5d1e77b0",
      "sourceAi": "chatgpt",
      "decidedAt": "2026-09-12T22:41:00+09:00",
      "valid": true,
      "overridden": false
    },
    {
      "id": "obj_decision_7a1d",
      "text": "과장 표현은 쓰지 않는다 (‘혁신’, ‘세상을 바꾸는’ 등)",
      "sourceConversationId": "conv_chatgpt_5d1e77b0",
      "sourceAi": "chatgpt",
      "decidedAt": "2026-09-12T22:18:00+09:00",
      "valid": true,
      "overridden": false
    },
    {
      "id": "obj_decision_2f90",
      "text": "보이스: 1인칭, 짧은 문장, 느낌표 없음",
      "sourceConversationId": "conv_claude_a7c3e210",
      "sourceAi": "claude",
      "decidedAt": "2026-09-03T21:05:00+09:00",
      "valid": true,
      "overridden": false
    }
  ],
  "openQuestions": [
    {
      "id": "oq_20260830_01_1",
      "text": "A안이 밋밋한가? 두 번째 줄에 숫자를 넣을지",
      "resolved": false,
      "note": "9.18 ChatGPT 대화 마지막에서",
      "sourceConversationId": "conv_chatgpt_68f2a91c",
      "resolvedAt": null
    },
    {
      "id": "oq_20260830_01_2",
      "text": "CTA를 ‘글 읽기’로 할지 ‘뉴스레터 구독’으로 할지",
      "resolved": false,
      "note": "뉴스레터 자체가 보류 상태 — 섹션 구성안 참고",
      "sourceConversationId": "conv_chatgpt_5d1e77b0",
      "resolvedAt": null
    },
    {
      "id": "oq_20260830_01_3",
      "text": "영문 병기 여부",
      "resolved": false,
      "note": "한 번 언급되고 결론 없음",
      "sourceConversationId": "conv_claude_3b9d4f12",
      "resolvedAt": null
    }
  ],
  "resume": {
    "defaultTargetAi": "chatgpt",
    "targets": ["chatgpt", "claude", "gemini", "grok"],
    "promptPreview": "[맥락] 블로그 리뉴얼 — 메인 페이지 카피 확정. 후보 3개 중 A/B로 좁힘. 톤은 ‘담백하게’로 합의\n결정: 후보는 A(담백한 소개형)와 B(질문형) 둘로 좁힘 / 메인 카피는 한 줄 + 보조 한 줄 구조로 간다 / 과장 표현은 쓰지 않는다 (‘혁신’, ‘세상을 바꾸는’ 등) / 보이스: 1인칭, 짧은 문장, 느낌표 없음\n- 메인 카피 후보 11개를 3개로 추렸고, 9월 18일 A(담백한 소개형)와 B(질문형)를 비교함.\n- A 쪽으로 기울었지만 “밋밋한가?”라는 고민으로 확정하지 않고 끝남.\n- 보이스 원칙(1인칭·짧은 문장·느낌표 없음)은 9월 3일 Claude 대화에서 정함.\n남은 질문: A안이 밋밋한가? 두 번째 줄에 숫자를 넣을지 / CTA를 ‘글 읽기’로 할지 ‘뉴스레터 구독’으로 할지 / 영문 병기 여부\n다음 할 일: A안을 기준으로 보조 문장 3개와 CTA 2개 쓰기\n요청: 위 다음 할 일부터 이어서 도와줘.",
    "continue": {
      "sourceAi": "chatgpt",
      "url": "https://chatgpt.com/c/68f2a91c-4b7e-8003-a1d2-9c0e5b7f3a21",
      "conversationId": "conv_chatgpt_68f2a91c",
      "label": "ChatGPT에서 이어서"
    },
    "continueNote": "원래 대화(9.18)에 이어 붙임"
  },
  "related": {
    "similarTasks": [
      {
        "id": "task_20260919_02",
        "title": "온보딩 문구 다듬기",
        "status": "완료",
        "statusVisual": "done",
        "staleDays": null,
        "projectId": "prj_subbrain",
        "projectName": "서브브레인",
        "sourceAi": "claude",
        "reason": "같은 주제 #카피라이팅",
        "completedAt": "2026-09-21T22:48:00+09:00"
      },
      {
        "id": "task_20260703_01",
        "title": "1차 디자인 시안",
        "status": "완료",
        "statusVisual": "done",
        "staleDays": null,
        "projectId": "prj_blog",
        "projectName": "블로그 리뉴얼",
        "sourceAi": "chatgpt",
        "reason": "같은 주제 #블로그",
        "completedAt": "2026-07-21T23:02:00+09:00"
      },
      {
        "id": "task_20260612_01",
        "title": "섹션 구성안",
        "status": "완료",
        "statusVisual": "done",
        "staleDays": null,
        "projectId": "prj_blog",
        "projectName": "블로그 리뉴얼",
        "sourceAi": "chatgpt",
        "reason": "같은 주제 #블로그",
        "completedAt": "2026-06-20T22:31:00+09:00"
      },
      {
        "id": "task_20260927_01",
        "title": "글 목록 태그 필터",
        "status": "진행 중",
        "statusVisual": "run",
        "staleDays": null,
        "projectId": "prj_blog",
        "projectName": "블로그 리뉴얼",
        "sourceAi": "chatgpt",
        "reason": "같은 주제 #블로그",
        "completedAt": null
      },
      {
        "id": "task_20260924_02",
        "title": "소개 페이지 문장 다듬기",
        "status": "멈춤",
        "statusVisual": "stall2",
        "staleDays": 6,
        "projectId": null,
        "projectName": null,
        "sourceAi": "chatgpt",
        "reason": "같은 주제 #카피라이팅",
        "completedAt": null
      }
    ],
    "wikiPages": []
  },
  "mergeSuggestions": [],
  "neighborCount": 5,
  "whyStalled": {
    "chain": [
      {
        "depth": 1,
        "nodeId": "obj_person_designer",
        "type": "person",
        "label": "디자이너 윤서",
        "linkType": "blocked_by",
        "confidence": 0.91
      }
    ],
    "rootCause": "‘디자이너 윤서’(사람 답 기다림)",
    "lastRelatedConversationId": "conv_chatgpt_68f2a91c"
  }
}
```

### 8.4 `GET /api/v1/tasks/:taskId/flow` — MVP
대화 흐름(§10.5 가운데 칸): 최근 것부터, 날짜별 대화 제목·AI 표식·메시지 수·요약·발췌 인용·원래 대화 링크, 대화가 없던 기간 "12일째 대화 없음", 필터 **전체 / 발췌만 / 결정만**.

| 쿼리 | 기본 | 설명 |
|---|---|---|
| `filter` | `all` | `excerpts`=발췌 있는 대화만, `decisions`=결정이 나온 대화만(`decisionIds`가 비지 않은 것) |
| `limit`, `cursor` | 20 | |

- `today.daysSinceLastConversation` → 맨 위 "오늘 · 9월 30일 — 12일째 대화 없음".
- `gapDaysFromNewer` → 항목 사이 빈칸 라벨("6일", "46일"). 첫 항목은 오늘과의 차이.
- 발췌 규칙(§6.2): 첫 사용자 메시지, 마지막 AI 답변 앞부분, 마지막 사용자 메시지, 분류 근거(`isEvidence`). 각 500자 이내. `textMd`의 `*기울임*` = 디자인의 밑줄 강조.
- 공유 대화(`isPrimary:false`)도 흐름에 나온다(`sharedWithTasks`로 "‘1차 디자인’과 공유" 표시).

응답 `200 FlowResponse`
```json
{
  "items": [
    {
      "conversationId": "conv_chatgpt_68f2a91c",
      "sourceAi": "chatgpt",
      "title": "카피 A/B 비교",
      "sourceUrl": "https://chatgpt.com/c/68f2a91c-4b7e-8003-a1d2-9c0e5b7f3a21",
      "createdAt": "2026-09-17T23:05:00+09:00",
      "updatedAt": "2026-09-18T01:47:00+09:00",
      "date": "2026-09-18",
      "gapDaysFromNewer": 12,
      "messageCount": 18,
      "summary": "A(담백한 소개형)와 B(질문으로 시작)를 나란히 비교. A 쪽으로 기울었지만 확정하지 않고 끝남.",
      "excerpts": [
        {
          "role": "assistant",
          "speakerLabel": "ChatGPT",
          "textMd": "좋아요. 내일은 A안을 기준으로 보조 문장부터 같이 써 봐요.",
          "messageSeq": 18,
          "isEvidence": false
        },
        {
          "role": "user",
          "speakerLabel": "나",
          "textMd": "A가 더 나 같긴 한데, 너무 밋밋한가? 내일 다시 볼게",
          "messageSeq": 17,
          "isEvidence": true
        },
        {
          "role": "user",
          "speakerLabel": "나",
          "textMd": "메인 카피 후보 A랑 B를 나란히 놓고 비교해 줘.\n\nA: 작은 도구를 만들고, 만든 과정을 씁니다.\nB: 왜 어떤 도구는 오래 쓰게 될까요?",
          "messageSeq": 1,
          "isEvidence": false
        }
      ],
      "decisionIds": ["obj_decision_b812"],
      "isPrimary": true,
      "sharedWithTasks": [],
      "serviceState": "active",
      "captureMethod": "export",
      "isStartOfTask": false
    },
    {
      "conversationId": "conv_chatgpt_5d1e77b0",
      "sourceAi": "chatgpt",
      "title": "메인 카피 후보 뽑기",
      "sourceUrl": "https://chatgpt.com/c/5d1e77b0-91a3-8004-c2e8-3b7f0d6a1e94",
      "createdAt": "2026-09-12T21:40:00+09:00",
      "updatedAt": "2026-09-12T23:02:00+09:00",
      "date": "2026-09-12",
      "gapDaysFromNewer": 6,
      "messageCount": 26,
      "summary": "후보 11개에서 3개로 추림. ‘과장 없이, 내가 쓴 것처럼’이라는 기준을 세움. 한 줄 + 보조 한 줄 구조로 결정.",
      "excerpts": [
        {
          "role": "assistant",
          "speakerLabel": "ChatGPT",
          "textMd": "두 번째는 “지금 당장 필요한가”로 거르는 단계예요. 필요 없으면 나중 목록으로 옮겨요.",
          "messageSeq": 26,
          "isEvidence": false
        },
        {
          "role": "user",
          "speakerLabel": "나",
          "textMd": "메인 카피는 한 줄 + 보조 한 줄 구조로 가자. CTA는 ‘글 읽기’랑 ‘뉴스레터 구독’ 중에 아직 모르겠어.",
          "messageSeq": 25,
          "isEvidence": false
        },
        {
          "role": "user",
          "speakerLabel": "나",
          "textMd": "개인 블로그 메인 카피 후보를 10개 이상 뽑아 줘. 개발하면서 만든 작은 도구들 이야기를 쓰는 블로그야.",
          "messageSeq": 1,
          "isEvidence": false
        }
      ],
      "decisionIds": ["obj_decision_7a1c", "obj_decision_7a1d"],
      "isPrimary": true,
      "sharedWithTasks": [],
      "serviceState": "active",
      "captureMethod": "export",
      "isStartOfTask": false
    },
    {
      "conversationId": "conv_claude_a7c3e210",
      "sourceAi": "claude",
      "title": "블로그 톤 & 보이스 정리",
      "sourceUrl": "https://claude.ai/chat/a7c3e210-5d8f-4b21-9e03-c6a1f7b2d840",
      "createdAt": "2026-09-03T20:31:00+09:00",
      "updatedAt": "2026-09-03T21:20:00+09:00",
      "date": "2026-09-03",
      "gapDaysFromNewer": 9,
      "messageCount": 22,
      "summary": "보이스 원칙 세 가지: 1인칭, 짧은 문장, 전문용어는 풀어서 쓰기.",
      "excerpts": [
        {
          "role": "assistant",
          "speakerLabel": "Claude",
          "textMd": "좋아요. 다음 단계에서는 결정한 내용을 짧게 기록해 둘게요.",
          "messageSeq": 22,
          "isEvidence": false
        },
        {
          "role": "user",
          "speakerLabel": "나",
          "textMd": "좋아. 보이스는 1인칭, 짧은 문장, 느낌표 없음으로 가자.",
          "messageSeq": 21,
          "isEvidence": false
        },
        {
          "role": "user",
          "speakerLabel": "나",
          "textMd": "내 블로그 글의 톤을 정하고 싶어. 친근하지만 가볍지 않게?",
          "messageSeq": 1,
          "isEvidence": false
        }
      ],
      "decisionIds": ["obj_decision_2f90"],
      "isPrimary": true,
      "sharedWithTasks": [],
      "serviceState": "active",
      "captureMethod": "export",
      "isStartOfTask": false
    },
    {
      "conversationId": "conv_claude_3b9d4f12",
      "sourceAi": "claude",
      "title": "소개 문단 초안",
      "sourceUrl": "https://claude.ai/chat/3b9d4f12-a0c7-4e6d-8f15-92b3e7d0c4a1",
      "createdAt": "2026-08-30T23:12:00+09:00",
      "updatedAt": "2026-08-31T00:05:00+09:00",
      "date": "2026-08-31",
      "gapDaysFromNewer": 3,
      "messageCount": 14,
      "summary": "자기소개 문단 초안 2개. 메인 카피와 문장이 겹쳐서 일단 보류 — 이 과제가 시작된 대화.",
      "excerpts": [
        {
          "role": "assistant",
          "speakerLabel": "Claude",
          "textMd": "두 번째는 “지금 당장 필요한가”로 거르는 단계예요. 필요 없으면 나중 목록으로 옮겨요.",
          "messageSeq": 14,
          "isEvidence": false
        },
        {
          "role": "user",
          "speakerLabel": "나",
          "textMd": "영문 병기도 해야 할까? 일단 메인 카피부터 정하고 다시 볼게.",
          "messageSeq": 13,
          "isEvidence": false
        },
        {
          "role": "user",
          "speakerLabel": "나",
          "textMd": "블로그 첫 화면에 들어갈 자기소개 문단 초안을 두 개만 써 줘. 너무 거창하지 않게.",
          "messageSeq": 1,
          "isEvidence": false
        }
      ],
      "decisionIds": [],
      "isPrimary": true,
      "sharedWithTasks": [],
      "serviceState": "active",
      "captureMethod": "export",
      "isStartOfTask": true
    },
    {
      "conversationId": "conv_gemini_c41f8e03",
      "sourceAi": "gemini",
      "title": "헤더 레퍼런스 찾기",
      "sourceUrl": "https://gemini.google.com/app/c41f8e03a7b2d619",
      "createdAt": "2026-07-15T21:02:00+09:00",
      "updatedAt": "2026-07-15T21:40:00+09:00",
      "date": "2026-07-15",
      "gapDaysFromNewer": 47,
      "messageCount": 9,
      "summary": "여백 넓은 단일 칼럼 레퍼런스 4개. 헤더 문구 길이는 20자 이내가 좋다는 메모.",
      "excerpts": [
        {
          "role": "user",
          "speakerLabel": "나",
          "textMd": "예시를 하나만 더 들어 줘.",
          "messageSeq": 9,
          "isEvidence": false
        },
        {
          "role": "assistant",
          "speakerLabel": "Gemini",
          "textMd": "예를 들면, 오늘 30분 안에 끝낼 수 있는 작은 일부터 정하는 식이에요.",
          "messageSeq": 8,
          "isEvidence": false
        },
        {
          "role": "user",
          "speakerLabel": "나",
          "textMd": "헤더 레퍼런스 찾기 관련해서 같이 정리해 줄래?",
          "messageSeq": 1,
          "isEvidence": false
        }
      ],
      "decisionIds": [],
      "isPrimary": false,
      "sharedWithTasks": [{"id": "task_20260703_01", "title": "1차 디자인 시안"}],
      "serviceState": "active",
      "captureMethod": "export",
      "isStartOfTask": false
    }
  ],
  "page": {"limit": 20, "nextCursor": null, "hasMore": false, "total": 5},
  "today": {"date": "2026-09-30", "daysSinceLastConversation": 12},
  "totalConversations": 5
}
```

### 8.5 `PATCH /api/v1/tasks/:taskId` — MVP
상태 바꾸기·보드 끌기·보관·프로젝트 변경·고정·제목·다음 단계. **보낸 필드는 `overrides`에 추가**되고(§6.2), 그 뒤 분류기·규칙 엔진은 그 필드를 바꾸지 않고 제안만 한다(§7.2-1). `events`에 `status_changed`(actor `user`)가 남고, 볼트 노트가 다시 생성된다(§10.7).

본문 `UpdateTaskBody`
```json
{"status": "보관", "note": "과제 상세에서 보관"}
```
다른 예: 보드에서 완료 열로 끌기 `{ "status": "완료", "completionReason": "resolved" }`, 프로젝트 바꾸기 `{ "projectId": "prj_blog" }`.

- 규칙: `status:"멈춤"`을 사용자가 직접 고르면 `staleDays`는 규칙대로 계산해 보여주되 상태는 고정. `status:"진행 중"`을 고정하면 날짜가 지나도 멈춤으로 바뀌지 않는다(해제는 §8.6).
- `overrides`에 쓰는 필드 이름은 DB/frontmatter 이름(snake_case): `status`, `project`, `pin`, `title`, `next_step`, `decisions`, `open_questions` (§6.2 `overrides: [status]`).
- 오류: 없는 `projectId` → `404`, 허용 안 되는 상태 값 → `400 VALIDATION_ERROR`.

응답 `200 UpdateTaskResponse` (`task`는 §8.3과 같은 모양 — 아래는 줄임)
```json
{
  "task": {
    "__abbreviated__": "GET /tasks/:taskId 응답(TaskDetail)과 같은 모양 — 바뀐 값 반영",
    "id": "task_20260805_01",
    "status": "보관",
    "overrides": ["status"]
  },
  "event": {
    "id": 444,
    "at": "2026-09-30T08:30:00+09:00",
    "type": "status_changed",
    "taskId": "task_20260805_01",
    "conversationId": null,
    "actor": "user",
    "payload": {"from": "멈춤", "to": "보관", "field": "status", "addedOverride": "status"}
  }
}
```

### 8.6 `POST /api/v1/tasks/:taskId/overrides/reset` — MVP
사용자 고정값을 풀어 에이전트·규칙에게 돌려준다. 본문 `ResetOverridesBody` → `200 TaskDetail`(규칙 엔진이 즉시 다시 계산한 값).
```json
{"fields": ["status"]}
```

### 8.7 `PATCH /api/v1/tasks/:taskId/open-questions/:questionId` — MVP
본문 `{ "resolved": true }` 또는 `{ "text": "..." }` → `200 OpenQuestion`. 고치면 `overrides`에 `open_questions`가 올라간다(§6.2).
```json
{
  "id": "oq_20260830_01_3",
  "text": "영문 병기 여부",
  "resolved": true,
  "note": "한 번 언급되고 결론 없음",
  "sourceConversationId": "conv_claude_3b9d4f12",
  "resolvedAt": "2026-09-30T09:40:10+09:00"
}
```

### 8.8 `PATCH /api/v1/tasks/:taskId/decisions/:decisionId` — MVP
본문 `{ "text": "..." }` 또는 `{ "valid": false }`(취소·무효) → `200 Decision`. 결정 객체(§8.2)를 고치고 `overridden:true`, 과제 `overrides`에 `decisions`.

### 8.9 `GET /api/v1/tasks/:taskId/resume-prompt` — MVP
"맥락 프롬프트 복사"·AI 탭·"다른 AI로…"(§10.4, §10.5), 요약 Top 3의 프롬프트 복사(§10.6). MCP `get_resume_prompt`(Phase 2)도 같은 것.

| 쿼리 | 기본 | 설명 |
|---|---|---|
| `targetAi` | 원래 대화의 AI | 다른 AI면 "~에서 하던 작업을 이어서 함"을 붙이고 `continue:null`, `newChatUrl` 제공 |

- 내용: 목표, 결정, 후보·산출물 요약, 열린 질문, 요청 문장. Phase 1.5부터 관련 결정과 **막힌 이유**를 함께 넣는다(§8.7).
- 원래 AI면 `tasks.resume_prompt`에 미리 만들어 둔 것(§7.7)을 주고 `cached:true`.
- 과제 상세의 `resume.promptPreview`는 `targetAi` 없이(= `defaultTargetAi`) 부른 이 응답의 `prompt`와 **글자 하나까지 같다**(자르지 않음 — 몇 줄만 보일지는 웹이 정함, 1.0.1).

응답 `200 ResumePromptResponse` (`?targetAi=claude`)
```json
{
  "taskId": "task_20260830_01",
  "targetAi": "claude",
  "prompt": "[맥락] 블로그 리뉴얼 — 메인 페이지 카피 확정. 후보 3개 중 A/B로 좁힘. 톤은 ‘담백하게’로 합의 (ChatGPT에서 하던 작업을 이어서 함)\n결정: 후보는 A(담백한 소개형)와 B(질문형) 둘로 좁힘 / 메인 카피는 한 줄 + 보조 한 줄 구조로 간다 / 과장 표현은 쓰지 않는다 (‘혁신’, ‘세상을 바꾸는’ 등) / 보이스: 1인칭, 짧은 문장, 느낌표 없음\n- 메인 카피 후보 11개를 3개로 추렸고, 9월 18일 A(담백한 소개형)와 B(질문형)를 비교함.\n- A 쪽으로 기울었지만 “밋밋한가?”라는 고민으로 확정하지 않고 끝남.\n- 보이스 원칙(1인칭·짧은 문장·느낌표 없음)은 9월 3일 Claude 대화에서 정함.\n남은 질문: A안이 밋밋한가? 두 번째 줄에 숫자를 넣을지 / CTA를 ‘글 읽기’로 할지 ‘뉴스레터 구독’으로 할지 / 영문 병기 여부\n다음 할 일: A안을 기준으로 보조 문장 3개와 CTA 2개 쓰기\n요청: 위 다음 할 일부터 이어서 도와줘.",
  "continue": null,
  "newChatUrl": "https://claude.ai/new",
  "generatedAt": "2026-09-30T08:30:00+09:00",
  "cached": false
}
```

### 8.10 `POST /api/v1/tasks/:taskId/merge` — MVP
보드 카드 "과제 합치기". `:taskId`가 남는 과제, `sourceTaskIds`의 대화·결정·열린 질문·주제가 옮겨오고 그 과제들은 사라진다(되돌리기는 `events` 기반, 나누기는 LATER). 본문 `MergeTasksBody` → `200 MergeTasksResponse`.
```json
{"sourceTaskIds": ["task_20260924_02"]}
```
응답(줄임)
```json
{
  "task": {
    "__abbreviated__": "GET /tasks/:taskId 응답(TaskDetail)과 같은 모양 — 바뀐 값 반영",
    "id": "task_20260921_01",
    "status": "멈춤",
    "overrides": []
  },
  "mergedTaskIds": ["task_20260924_03"],
  "event": {
    "id": 445,
    "at": "2026-09-30T08:30:00+09:00",
    "type": "status_changed",
    "taskId": "task_20260921_01",
    "conversationId": null,
    "actor": "user",
    "payload": {"action": "merge", "mergedTaskIds": ["task_20260924_03"]}
  }
}
```

### 8.11 `POST /api/v1/tasks/:taskId/reclassify` — MVP
그 과제의 대화를 다시 분류(사용자 고정 필드는 그대로). 본문 없음 → `202 Job`(§12.5 모양). 비용 상한이면 `429 COST_CAP_REACHED`. 1.1.0: 분류 불가(`blocked`) 과제도 **이 엔드포인트로는 다시 시도한다**(사용자가 명시적으로 누른 재시도). 자동·범위 실행은 다시 보내지 않는다(§12.7).

### 8.12 `GET /api/v1/conversations/:conversationId` — MVP
"웹앱에서 보기"(§6.2 노트의 "전체 원문 … 웹앱에서 보기"), 검색 결과의 메시지 이동. 메시지는 `?limit=100&cursor=`로 페이지(기본 100, 순서 `seq` 오름차순). `?aroundSeq=17`이면 그 메시지 주변 페이지.

응답 `200 ConversationDetail`
```json
{
  "id": "conv_chatgpt_68f2a91c",
  "sourceAi": "chatgpt",
  "sourceId": "68f2a91c-4b7e-8003-a1d2-9c0e5b7f3a21",
  "sourceUrl": "https://chatgpt.com/c/68f2a91c-4b7e-8003-a1d2-9c0e5b7f3a21",
  "title": "카피 A/B 비교",
  "createdAt": "2026-09-17T23:05:00+09:00",
  "updatedAt": "2026-09-18T01:47:00+09:00",
  "capturedAt": "2026-09-30T08:05:00+09:00",
  "messageCount": 18,
  "captureMethod": "export",
  "serviceState": "active",
  "pin": false,
  "isShared": false,
  "inServiceProject": false,
  "hasUnextractedArtifact": false,
  "task": {
    "id": "task_20260830_01",
    "title": "메인 페이지 카피 확정",
    "status": "멈춤",
    "statusVisual": "stall",
    "staleDays": 12,
    "projectId": "prj_blog"
  },
  "sharedWithTasks": [],
  "classification": {
    "kind": "task",
    "resolution": "unresolved",
    "completionReason": null,
    "confidence": 0.86,
    "evidence": "“내일 다시 볼게”로 끝남",
    "model": "claude-haiku-4-5",
    "promptVersion": "cls-v1",
    "classifiedAt": "2026-09-18T01:52:30+09:00",
    "needsReview": false,
    "state": "ok",
    "blockedReason": null,
    "blockedModel": null,
    "rawConfidence": null,
    "handoff": null,
    "cached": false
  },
  "vault": {
    "path": "conversations/2026/09/2026-09-17_chatgpt_카피-ab-비교_68f2a91c.md",
    "obsidianUri": "obsidian://open?vault=SubBrain&file=conversations%2F2026%2F09%2F2026-09-17_chatgpt_%EC%B9%B4%ED%94%BC-ab-%EB%B9%84%EA%B5%90_68f2a91c.md"
  },
  "rawPath": "raw/exports/chatgpt/2026-09-30_export.zip",
  "outcome": {
    "outcome": "open",
    "status": "멈춤",
    "staleDays": 12,
    "label": "멈춤 12일",
    "target": null,
    "evidence": null,
    "detectedBy": "derived"
  },
  "messages": {
    "items": [
      {
        "id": 63,
        "seq": 1,
        "role": "user",
        "contentMd": "메인 카피 후보 A랑 B를 나란히 놓고 비교해 줘.\n\nA: 작은 도구를 만들고, 만든 과정을 씁니다.\nB: 왜 어떤 도구는 오래 쓰게 될까요?",
        "createdAt": "2026-09-17T23:05:00+09:00"
      },
      {
        "id": 64,
        "seq": 2,
        "role": "assistant",
        "contentMd": "| 기준 | A | B |\n|---|---|---|\n| 첫인상 | 담백함 | 호기심 |\n| 나다움 | 높음 | 중간 |",
        "createdAt": "2026-09-17T23:14:32+09:00"
      }
    ],
    "page": {"limit": 2, "nextCursor": "eyJvIjoyfQ", "hasMore": true, "total": 18}
  }
}
```
**대화 결과 · 간단한 질문 (1.4.0)** — 웹이 새로 그릴 것:
- `TaskListItem.conversationOutcome?` / `ConversationDetail.outcome?`: `ConversationOutcomeInfo { outcome: 'done'|'moved'|'interrupted'|'open', status: '완료'|'진행 중'|'멈춤', staleDays, label, target, evidence, detectedBy: 'llm'|'rule'|'both'|'derived' }`. **대화 단위** 상태로, 과제 상태(`status`)와 별개다. 예: "새창에서 작업할게"로 끝난 대화 → `outcome:'moved', status:'완료', label:'새 대화로 옮김', target:'새 대화'`인데 과제 `status`는 `진행 중`(+ `handoff.target` 유지). 화면: 대화 결과 배지 = `label`(색: done·moved=완료, interrupted=주황, open=진행/멈춤 색은 `status`). `TaskListItem`에서는 대표(최근 primary) 대화 기준.
  - `done` 이 대화에서 할 일이 끝남 · `moved` 사용자가 일부러 다른 곳(새 대화·Claude Code·다른 AI·다른 기기)으로 옮김 → 대화는 완료 · `interrupted` 토큰 한도·잘 시간 등 바깥 사정으로 끊김 → `status`는 방치 규칙(진행 중/멈춤 N일), `label` 예 `끊김(토큰 한도)` · `open` 그냥 남음 → 방치 규칙, `label` `진행 중`/`멈춤 N일`.
  - `detectedBy:'derived'` = 1.4.0 이전 분류(cls-v3 이하)라 과제 상태로 추정한 값 — 재분류하면 llm/rule/both가 된다.
- **간단한 질문은 상태가 아니라 종류**: `kind:'quick_question'`은 그대로. 답을 받은 것 → `status:'완료'`, `completionReason:'answered'`(새 값, `TaskListItem.completionReason?`), `statusVisual:'quick'`. 답을 못 받은 것 → 일반 방치 규칙(`진행 중`/`멈춤`). `TaskStatus`의 `'간단한 질문'` 값은 **호환용으로 남기되 더 이상 저장·반환하지 않음(deprecated)**: `GET /tasks?status=간단한 질문` 필터는 "답 받은 간단한 질문" 별칭으로 계속 동작, 보드의 `간단한 질문` 열도 그대로(답 받은 간단한 질문만, `완료` 열에는 안 들어감). 대시보드 `quickQuestions`도 같은 기준, `completedThisWeek`·`totalTasks`에는 안 셈. 요약(digest)의 간단한 질문 묶음도 같은 기준.
- **대화 결과 → 과제 상태 (1.6.0)**: 과제의 **주(primary) 대화가 모두** 결과 `done`·`moved`면 과제도 `완료`. `completionReason` = 최신 주 대화가 `moved`면 `'moved'`(새 값, `handoff` 표시는 그대로 → "Claude Code로 옮김" 배지), 아니면 `'done'`(새 값). 하나라도 `interrupted`·`open`이거나 아직 1.4.0 결과가 없으면(분류 전) 예전 규칙(해결/포기 → 완료, 나머지 방치 규칙). 우선순위: 사용자 지정 > MCP > 답 받은 간단한 질문 > `resolution` resolved/abandoned > **이 규칙** > 방치 규칙. 대화 하나짜리 과제가 대부분이라 사실상 "대화가 끝났으면 과제도 끝" — 4546 Claude 29개 라벨에서 과제 상태 오답 8개가 모두 이 경우였다. 여러 대화 과제도 같은 규칙(모두 끝났을 때만 완료 — 하나라도 남아 있으면 일이 남은 것). **이어받은 세션**: 넘겨준 대화(moved)만 있는 동안 과제는 `완료/moved`; 로컬 세션이 합치기 제안(§12.10)으로 **수락되면** 세션 대화가 주 대화로 들어와 그 결과(보통 `open`)를 따라 `진행 중`/`멈춤`으로 돌아간다(일은 세션 쪽에서 계속). 제안을 수락하기 전엔 세션은 따로인 과제.
- **보드 `간단한 질문` 열 items (1.6.0 버그 수정)**: `collapsed:true`인 열도 `items`를 채운다(최대 `columnLimit`). 전엔 접힌 열은 `total`만 있고 `items:[]`라 펼쳐도 비어 보였다. `collapsed`는 화면 힌트일 뿐.
- **`TaskDetail.conversationOutcome?` · `conversationOutcomes?` (1.6.0)**: 대표(최신 주) 대화의 결과(목록 `TaskListItem.conversationOutcome`과 같은 값)와 모든 대화의 결과 `[{conversationId, sourceAi, title, role, updatedAt, outcome}]`(최신 먼저) — 상세 화면이 대화마다 `/conversations/:id`를 다시 부르지 않아도 된다.
- **결과 라벨 저장 (1.6.0)**: 분류할 때 정한 라벨 글(`끝난 대화`·`Claude Code로 옮김`·`끊김(토큰 한도)` …)을 `conversations.outcome_label`·`classifications.outcome_label`과 `outcome_json.label`에 저장하고, API는 저장된 글을 쓴다(`open`의 `진행 중`/`멈춤 N일`은 날짜에 따라 바뀌므로 늘 계산). 이전 데이터는 스키마 v6 이전 때 채운다.

**음성 메시지(1.3.0)**: ChatGPT 음성 모드 대화는 전사 글이 `contentMd`에 그대로 들어가고(앞에 표시 글자 없음) `voice: true`가 붙는다. 음성이 아닌 메시지에는 `voice` 필드가 없다. 화면은 🎙 같은 표시를 `voice`로 붙이면 된다. 검색·분류·볼트는 전사 글을 일반 글처럼 쓴다.

---

## 9. 과제 합치기 제안

> §6.1 "같은 일을 ChatGPT에서 시작해 Claude에서 이어간 경우 분류 에이전트가 **같은 과제일 수 있음**이라고 제안하고, 사용자가 웹앱에서 합친다", §7.6 `same_task_candidates`, §7.7 "이어짐". 설계서에 저장 테이블이 없어 코어가 `task_merge_suggestions`를 더한다(§15-4). 온톨로지 제안(§14 Phase 1.5)과는 별개.

### 9.1 `GET /api/v1/merge-suggestions` — MVP
쿼리: `state`(기본 `pending`), `taskId`(그 과제가 걸린 것만), `minConfidence`, `limit`, `cursor`. 정렬: 확신도 높은 순.

응답 `200 ListResponse<MergeSuggestion>`
```json
{
  "items": [
    {
      "id": "ms_4410",
      "state": "pending",
      "confidence": 0.74,
      "reason": "같은 주제 #카피라이팅 · Claude에서 시작한 소개 페이지 톤 작업을 ChatGPT에서 이어간 것으로 보임",
      "tasks": [
        {
          "id": "task_20260902_01",
          "title": "소개 페이지 톤 맞추기",
          "status": "멈춤",
          "statusVisual": "stall2",
          "staleDays": 6,
          "projectId": "prj_blog",
          "sourceAis": ["claude"]
        },
        {
          "id": "task_20260924_02",
          "title": "소개 페이지 문장 다듬기",
          "status": "멈춤",
          "statusVisual": "stall2",
          "staleDays": 6,
          "projectId": null,
          "sourceAis": ["chatgpt"]
        }
      ],
      "suggestedPrimaryTaskId": "task_20260902_01",
      "createdAt": "2026-09-25T03:02:11+09:00",
      "decidedAt": null
    }
  ],
  "page": {"limit": 50, "nextCursor": null, "hasMore": false, "total": 1}
}
```

### 9.2 `POST /api/v1/merge-suggestions/:suggestionId/accept` — MVP
본문 `AcceptMergeBody`(선택: 남길 과제·제목. 없으면 `suggestedPrimaryTaskId`) → `200 AcceptMergeResponse`. 이미 처리된 제안이면 `409 CONFLICT`. `events`에 기록(되돌리기 가능).
```json
{"primaryTaskId": "task_20260902_01"}
```
응답(줄임)
```json
{
  "suggestion": {
    "id": "ms_4410",
    "state": "accepted",
    "confidence": 0.74,
    "reason": "같은 주제 #카피라이팅 · Claude에서 시작한 소개 페이지 톤 작업을 ChatGPT에서 이어간 것으로 보임",
    "tasks": [
      {
        "id": "task_20260902_01",
        "title": "소개 페이지 톤 맞추기",
        "status": "멈춤",
        "statusVisual": "stall2",
        "staleDays": 6,
        "projectId": "prj_blog",
        "sourceAis": ["claude"]
      },
      {
        "id": "task_20260924_02",
        "title": "소개 페이지 문장 다듬기",
        "status": "멈춤",
        "statusVisual": "stall2",
        "staleDays": 6,
        "projectId": null,
        "sourceAis": ["chatgpt"]
      }
    ],
    "suggestedPrimaryTaskId": "task_20260902_01",
    "createdAt": "2026-09-25T03:02:11+09:00",
    "decidedAt": "2026-09-30T08:30:00+09:00"
  },
  "task": {
    "__abbreviated__": "GET /tasks/:taskId 응답(TaskDetail)과 같은 모양 — 바뀐 값 반영",
    "id": "task_20260902_01",
    "status": "멈춤",
    "overrides": []
  }
}
```

### 9.3 `POST /api/v1/merge-suggestions/:suggestionId/reject` — MVP
본문 없음(선택 `{ "reason": "다른 페이지 작업이에요" }`) → `200 RejectMergeResponse` = 수락과 **같은 감싼 모양** `{ suggestion, task }`(1.0.1, 이전엔 `MergeSuggestion`만). `suggestion.state:"rejected"`, `task`는 `suggestedPrimaryTaskId` 과제의 `TaskDetail`(그 과제의 `mergeSuggestions`에서 이 제안이 빠진 상태). 이미 처리된 제안이면 `409 CONFLICT`. 거절한 쌍은 다시 제안하지 않는다(§8.6 "거절 기억"과 같은 원칙).

응답(줄임)
```json
{
  "suggestion": {
    "id": "ms_4410",
    "state": "rejected",
    "confidence": 0.74,
    "reason": "같은 주제 #카피라이팅 · Claude에서 시작한 소개 페이지 톤 작업을 ChatGPT에서 이어간 것으로 보임",
    "tasks": [
      {
        "id": "task_20260902_01",
        "title": "소개 페이지 톤 맞추기",
        "status": "멈춤",
        "statusVisual": "stall2",
        "staleDays": 6,
        "projectId": "prj_blog",
        "sourceAis": ["claude"]
      },
      {
        "id": "task_20260924_02",
        "title": "소개 페이지 문장 다듬기",
        "status": "멈춤",
        "statusVisual": "stall2",
        "staleDays": 6,
        "projectId": null,
        "sourceAis": ["chatgpt"]
      }
    ],
    "suggestedPrimaryTaskId": "task_20260902_01",
    "createdAt": "2026-09-25T03:02:11+09:00",
    "decidedAt": "2026-09-30T08:30:00+09:00"
  },
  "task": {
    "__abbreviated__": "GET /tasks/:taskId 응답(TaskDetail)과 같은 모양 — 바뀐 값 반영",
    "id": "task_20260902_01",
    "status": "멈춤",
    "overrides": []
  }
}
```

---

## 9-2. 새 프로젝트 제안 (1.1.0)

> 설계서 §7.6 `new_project_suggestion`·§7.7 "프로젝트 자동 생성: L1–L3는 제안, L4는 자동"을 구현. 새 Claude 내보내기(2026-10)는 대화에 `project_uuid`가 없어 **과제를 프로젝트에 붙이는 유일한 길**이다(이름이 이미 있는 프로젝트와 맞으면 분류가 바로 붙이고, 아니면 여기 제안으로 모인다).

규칙
- LLM 분류(규칙 분류·분류 불가 제외)가 **프로젝트 없는** 과제(사용자가 프로젝트를 고정하지 않은 것)에 `new_project_suggestion`(또는 목록에 없는 `project` 이름)을 내면 제안에 과제를 더한다. 비슷한 이름은 한 제안으로 모으고 `altNames`에 남긴다.
- **비슷한 이름(1.2.0)** = ① 정규화 후 같음·포함·글자 2-gram 유사도 ≥0.6, 또는 ② 한↔영 음차 별칭(헤르메스↔hermes, 클로드↔claude, 에이전트↔agent, 사스↔saas …)을 맞추고 일반어(AI·에이전트·SaaS·앱·시스템·설치·개발·준비·관리 …)를 뺀 **핵심 단어**가 한쪽에 다 들어가거나(작은 쪽 2개 이상, 또는 큰 쪽 2개 이하), 핵심 단어를 이어 붙인 글자가 같거나 포함(3글자 이상), 핵심 단어가 2개 이상 겹치고 겹침 비율 ≥0.67. 예: `꽃집 배송 SaaS` = `꽃집 배송 AI 에이전트` = `꽃집배송`, `Obsidian Agent 설치` = `옵시디언 AI`. `꽃집 배송 SaaS` ≠ `택배 배송관리 시스템`. 일반어뿐인 이름끼리는 같다고 보지 않는다.
- **합치기(1.2.0)**: 대기 중 제안끼리 이름이 비슷하거나, **같은 과제·같은 대화가 둘 다에 붙었거나**(과제 합치기 뒤 생김), 대기·수락된 **과제 합치기 제안으로 이어진 과제**를 가지면 하나로 합친다(과제 많은 쪽 이름을 남기고 나머지는 `altNames`). 이미 수락된 제안과 비슷한 대기 중 제안은 그 프로젝트에 과제를 붙이고 사라진다. 분류 실행이 끝날 때마다, 그리고 코어 시작 때 한 번 돈다(1.1.0이 따로 만든 제안도 정리됨). 합쳐진 제안 id는 없어진다(목록을 다시 받으면 됨).
- **간단한 질문은 넣지 않는다(1.2.0)**: `kind:"quick_question"` 과제는 제안에 붙지 않고, 붙어 있던 과제가 다시 분류돼 간단한 질문이 되면 빠진다(설계서 §7.7은 "미분류 **과제**"를 모으는 것). 1.1.0에서는 간단한 질문도 `taskCount`에 들어가 수락 응답의 `project.taskCount`(간단한 질문 제외)와 어긋났다 — 이제 `taskCount` = 수락하면 붙을 과제 수 = 수락 후 `project.taskCount`에 더해지는 수.
- 과제가 `minTasks`(3)개 이상 모이면 `ready:true` — 대시보드 `badges.pendingProjectSuggestions`·요약 `pendingProjectSuggestions`에 나온다. `ready:false`인 제안도 목록(`GET`)에는 보인다.
- 자동화 레벨 `L4`면 ready가 되는 순간 자동 수락(프로젝트 생성 + 과제 연결, 이벤트 `suggestion_accepted` actor `classifier`). L1–L3는 사용자가 수락.
- 수락된 제안과 같은 이름을 나중에 또 제안하면 그 프로젝트에 바로 붙는다. 거절한 이름(비슷한 이름 포함)은 다시 제안하지 않는다.
- 같은 과제를 다시 분류해 최신 판단이 "새 프로젝트 아님"이면 대기 중 제안에서 빠진다. 프로젝트가 생기거나 보관된 과제는 `taskCount`에서 빠진다.

### 9-2.1 `GET /api/v1/project-suggestions` — MVP
쿼리 `state`(`pending`(기본)·`accepted`·`rejected`), `ready`(boolean), `limit`, `cursor` → `200 ListResponse<ProjectSuggestion>`(ready 먼저, 과제 많은 순).
```json
{
  "items": [
    {
      "id": "psg_seed01",
      "name": "전세 계약 정리",
      "altNames": ["전세계약 서류"],
      "state": "pending",
      "ready": false,
      "taskCount": 1,
      "minTasks": 3,
      "tasks": [
        {
          "id": "task_20260928_02",
          "title": "전세 계약 특약 문구 검토",
          "status": "완료",
          "statusVisual": "done",
          "staleDays": null,
          "projectId": null,
          "sourceAis": ["chatgpt"]
        }
      ],
      "projectId": null,
      "createdAt": "2026-09-28T21:40:00+09:00",
      "updatedAt": "2026-09-28T21:40:00+09:00",
      "decidedAt": null
    }
  ],
  "page": {"limit": 50, "nextCursor": null, "hasMore": false, "total": 1}
}
```

### 9-2.2 `POST /api/v1/project-suggestions/:suggestionId/accept` — MVP
본문 `AcceptProjectSuggestionBody`(전부 선택: `name` 이름 바꿔 만들기, `colorHex`, `taskIds` 일부만 붙이기) → `200 AcceptProjectSuggestionResponse { suggestion, project, attachedTaskIds }`. 같은 이름 프로젝트가 이미 있으면 새로 만들지 않고 그 프로젝트에 붙인다. 붙이는 과제 = 아직 프로젝트가 없고 사용자가 프로젝트를 고정하지 않은 과제. 이미 처리된 제안이면 `409 CONFLICT`. `Idempotency-Key` 지원.
```json
{
  "suggestion": {
    "id": "psg_seed01",
    "name": "전세 계약 정리",
    "altNames": ["전세계약 서류"],
    "state": "accepted",
    "ready": false,
    "taskCount": 0,
    "minTasks": 3,
    "tasks": [
      {
        "id": "task_20260928_02",
        "title": "전세 계약 특약 문구 검토",
        "status": "완료",
        "statusVisual": "done",
        "staleDays": null,
        "projectId": "prj_kpes6h",
        "sourceAis": ["chatgpt"]
      }
    ],
    "projectId": "prj_kpes6h",
    "createdAt": "2026-09-28T21:40:00+09:00",
    "updatedAt": "2026-09-30T08:30:00+09:00",
    "decidedAt": "2026-09-30T08:30:00+09:00"
  },
  "project": {
    "id": "prj_kpes6h",
    "name": "전세 계약 정리",
    "aliases": [],
    "status": "active",
    "colorHex": "#F07F5E",
    "activity": {"status": "완료", "staleDays": null, "statusVisual": "done"},
    "taskCount": 1,
    "conversationCount": 1,
    "startedAt": "2026-09-28T21:00:00+09:00",
    "lastActivityAt": "2026-09-29T16:05:00+09:00",
    "thresholds": null
  },
  "attachedTaskIds": ["task_20260928_02"]
}
```

### 9-2.3 `POST /api/v1/project-suggestions/:suggestionId/reject` — MVP
본문 선택 `RejectProjectSuggestionBody { reason?: string }`(1.2.0 타입 export) → `200 RejectProjectSuggestionResponse { suggestion }`(`state:"rejected"`). 이미 처리됐으면 `409`.

---

## 10. 오늘의 요약 (digest)

> §7.7 일일 요약, §10.6 화면, §6.3 `digests(date, body_json)`. 매일 08:00(설정) 스케줄러가 만들고 `daily/YYYY-MM-DD.md`도 생성한다. **응답 모양 = `digests.body_json` + 머리 정보.** 이미 만든 요약은 그대로 돌려주고(그날 아침의 기록), 수집 상태만 실시간 값으로 덮어쓴다.

### 10.1 `GET /api/v1/digests` — MVP
"지난 요약 모두". `?limit=30&cursor=`, 최근 날짜 순.

응답 `200 ListResponse<DigestListItem>`
```json
{
  "items": [
    {
      "date": "2026-09-30",
      "generatedAt": "2026-09-30T08:00:03+09:00",
      "title": "9월 30일 수요일 아침",
      "strip": {
        "yesterdayConversations": 11,
        "completedTasks": 2,
        "newlyStalled": 4,
        "quickQuestions": 4,
        "collectionGap": {"hasGap": true, "hours": 34, "label": "34시간"}
      }
    },
    {
      "date": "2026-09-29",
      "generatedAt": "2026-09-29T08:00:03+09:00",
      "title": "9월 29일 화요일 아침",
      "strip": {
        "yesterdayConversations": 4,
        "completedTasks": 0,
        "newlyStalled": 5,
        "quickQuestions": 2,
        "collectionGap": {"hasGap": false, "hours": null, "label": "없음"}
      }
    },
    {
      "date": "2026-09-28",
      "generatedAt": "2026-09-28T08:00:03+09:00",
      "title": "9월 28일 월요일 아침",
      "strip": {
        "yesterdayConversations": 2,
        "completedTasks": 0,
        "newlyStalled": 4,
        "quickQuestions": 2,
        "collectionGap": {"hasGap": false, "hours": null, "label": "없음"}
      }
    }
  ],
  "page": {"limit": 30, "nextCursor": null, "hasMore": false, "total": 3}
}
```

### 10.2 `GET /api/v1/digests/:date` — MVP (제안 카드 1.5, 승인 칸 6)
`:date` = `YYYY-MM-DD` 또는 `today`(오늘 것이 아직 없으면 `404` — 웹은 `latest`로 다시 요청) 또는 `latest`.

화면 ↔ 필드 (디자인 03)
| 화면 | 필드 |
|---|---|
| "오늘의 요약 · 오전 8:00에 만들어짐", 제목 "9월 30일 수요일 아침" | `generatedAt`, `title` |
| ← 9월 29일 / 지난 요약 모두 / `daily/2026-09-30.md` | `prevDate`, `GET /digests`, `vault` |
| 요약 줄: 어제 대화 7 · 끝낸 과제 2 · 새로 멈춘 일 2 · 간단한 질문 4 · 수집 공백 없음 | `strip` |
| 어제 있었던 일(서술 + 시간순 목록) | `yesterday.narrative`, `yesterday.events` (`timeLabel`, `sourceAi` 표식, `actionLabel`, 프로젝트 색 점 `project.colorHex`, `note`) |
| 수집 상태 | `collectionStatus` (MVP는 내보내기 기준 — §5.3) |
| 이번 주 한 일 | `thisWeek` |
| 오늘 이어서 할 것 Top 3 (추천 AI 버튼, 프롬프트 복사) | `todayPicks` (`actionLabel`, `continue`; 복사는 `GET /tasks/:id/resume-prompt?targetAi=<recommendedAi>`) |
| "오래 방치(31일 넘음) 1개 — 영문 이력서 다듬기. 계속할까요, 보관할까요?" | `longNeglected` → 계속=`PATCH {status:"진행 중"}`, 보관=`PATCH {status:"보관"}` |
| 어제 움직인 프로젝트(구 크기 = 메시지 수) | `movedProjects` (`becameStalled`면 주황 점선 고리) |
| "간단한 질문 4개(ChatGPT 2 · Claude 1 · Grok 1)" | `quickQuestionsByAi` |
| (MVP 추가) 합치기 제안 | `pendingMergeSuggestions` |
| 제안 검토 카드 (Phase 1.5) | `ontology` — MVP `null` |
| 오른쪽 칸 "하루 한 번 승인 · 채팅창 정리" (Phase 6) | `cleanup` — MVP `null` (웹은 칸을 숨기거나 "준비 중" 표시) |

- `todayPicks` 규칙(§7.7): 점수 = 최근성 × 프로젝트 우선순위 × 방치 단계 × 다음 단계 명확도. 원래 AI의 어댑터가 `degraded/broken`이면 다른 AI를 추천(`actionLabel:"Claude로 넘겨서 이어서"`, `continue:null`).
- `yesterday.events`의 규칙 엔진 전환은 `actor:"rule"`, `timeLabel:"새벽 계산"`.

응답 `200 DigestResponse`
```json
{
  "date": "2026-09-30",
  "generatedAt": "2026-09-30T08:00:03+09:00",
  "title": "9월 30일 수요일 아침",
  "prevDate": "2026-09-29",
  "nextDate": null,
  "vault": {
    "path": "daily/2026-09-30.md",
    "obsidianUri": "obsidian://open?vault=SubBrain&file=daily%2F2026-09-30.md"
  },
  "strip": {
    "yesterdayConversations": 11,
    "completedTasks": 2,
    "newlyStalled": 4,
    "quickQuestions": 4,
    "collectionGap": {"hasGap": true, "hours": 34, "label": "34시간"}
  },
  "yesterday": {
    "date": "2026-09-29",
    "narrative": "어제는 ‘Next.js 배포 오류 해결’, ‘전세 계약 특약 문구 검토’을(를) 끝냈어요. ‘분류 프롬프트 정확도 시험’을(를) 새로 시작했어요. ‘러닝 10km 준비’, ‘이사업체 견적 비교표’ 외 2개는 이어서 진행했어요. 볼트 노트 형식, 인터넷 이전 신청 등은(는) 대화가 끊겨 ‘멈춤’으로 옮겼어요.",
    "events": [
      {
        "at": "2026-09-29T07:40:00+09:00",
        "timeLabel": "오전 7:40",
        "actor": "extension",
        "sourceAi": "gemini",
        "action": "continued",
        "actionLabel": "이어감",
        "tasks": [{"id": "task_20260927_02", "title": "러닝 10km 준비"}],
        "project": {"id": "prj_health", "name": "건강", "colorHex": "#9CCB5E"},
        "note": "건강 · 메시지 4개 추가"
      },
      {
        "at": "2026-09-29T09:40:00+09:00",
        "timeLabel": "오전 9:40",
        "actor": "extension",
        "sourceAi": "claude",
        "action": "continued",
        "actionLabel": "이어감",
        "tasks": [{"id": "task_20260926_01", "title": "Next.js 배포 오류 해결"}],
        "project": {"id": "prj_devstudy", "name": "개발 공부", "colorHex": "#4DB9E3"},
        "note": "개발 공부 · 메시지 14개 추가"
      },
      {
        "at": "2026-09-29T10:12:00+09:00",
        "timeLabel": "오전 10:12",
        "actor": "classifier",
        "sourceAi": "claude",
        "action": "completed",
        "actionLabel": "완료",
        "tasks": [{"id": "task_20260926_01", "title": "Next.js 배포 오류 해결"}],
        "project": {"id": "prj_devstudy", "name": "개발 공부", "colorHex": "#4DB9E3"},
        "note": null
      },
      {
        "at": "2026-09-29T14:40:00+09:00",
        "timeLabel": "오후 2:40",
        "actor": "extension",
        "sourceAi": "claude",
        "action": "started",
        "actionLabel": "시작",
        "tasks": [{"id": "task_20260929_01", "title": "분류 프롬프트 정확도 시험"}],
        "project": {"id": "prj_subbrain", "name": "서브브레인", "colorHex": "#5B8DEF"},
        "note": null
      },
      {
        "at": "2026-09-29T16:05:00+09:00",
        "timeLabel": "오후 4:05",
        "actor": "extension",
        "sourceAi": "chatgpt",
        "action": "continued",
        "actionLabel": "이어감",
        "tasks": [{"id": "task_20260928_02", "title": "전세 계약 특약 문구 검토"}],
        "project": null,
        "note": "과제 · 메시지 4개 추가"
      },
      {
        "at": "2026-09-29T16:05:00+09:00",
        "timeLabel": "오후 4:05",
        "actor": "classifier",
        "sourceAi": "chatgpt",
        "action": "completed",
        "actionLabel": "완료",
        "tasks": [{"id": "task_20260928_02", "title": "전세 계약 특약 문구 검토"}],
        "project": null,
        "note": null
      },
      {
        "at": "2026-09-29T19:20:00+09:00",
        "timeLabel": "오후 7:20",
        "actor": "extension",
        "sourceAi": "claude",
        "action": "continued",
        "actionLabel": "이어감",
        "tasks": [{"id": "task_20260914_01", "title": "이사업체 견적 비교표"}],
        "project": {"id": "prj_moving", "name": "이사 준비", "colorHex": "#36C2A6"},
        "note": "이사 준비 · 메시지 8개 추가"
      },
      {
        "at": "2026-09-29T20:10:00+09:00",
        "timeLabel": "오후 8:10",
        "actor": "extension",
        "sourceAi": "claude",
        "action": "continued",
        "actionLabel": "이어감",
        "tasks": [{"id": "task_20260929_01", "title": "분류 프롬프트 정확도 시험"}],
        "project": {"id": "prj_subbrain", "name": "서브브레인", "colorHex": "#5B8DEF"},
        "note": "서브브레인 · 메시지 24개 추가"
      },
      {
        "at": "2026-09-29T21:20:00+09:00",
        "timeLabel": "오후 9:20",
        "actor": "extension",
        "sourceAi": "claude",
        "action": "continued",
        "actionLabel": "이어감",
        "tasks": [{"id": "task_20260924_01", "title": "그래프 홈 시안"}],
        "project": {"id": "prj_subbrain", "name": "서브브레인", "colorHex": "#5B8DEF"},
        "note": "서브브레인 · 메시지 10개 추가"
      },
      {
        "at": "2026-09-29T21:31:00+09:00",
        "timeLabel": "오후 9:31",
        "actor": "extension",
        "sourceAi": "chatgpt",
        "action": "continued",
        "actionLabel": "이어감",
        "tasks": [{"id": "task_20260927_01", "title": "글 목록 태그 필터"}],
        "project": {"id": "prj_blog", "name": "블로그 리뉴얼", "colorHex": "#F07F5E"},
        "note": "블로그 리뉴얼 · 메시지 3개 추가"
      },
      {
        "at": "2026-09-30T03:00:00+09:00",
        "timeLabel": "새벽 계산",
        "actor": "rule",
        "sourceAi": null,
        "action": "stalled",
        "actionLabel": "멈춤",
        "tasks": [{"id": "task_20260915_01", "title": "볼트 노트 형식"}],
        "project": {"id": "prj_subbrain", "name": "서브브레인", "colorHex": "#5B8DEF"},
        "note": "서브브레인 · 1개 멈춤으로"
      },
      {
        "at": "2026-09-30T03:00:00+09:00",
        "timeLabel": "새벽 계산",
        "actor": "rule",
        "sourceAi": null,
        "action": "stalled",
        "actionLabel": "멈춤",
        "tasks": [{"id": "task_20260919_01", "title": "인터넷 이전 신청"}],
        "project": {"id": "prj_moving", "name": "이사 준비", "colorHex": "#36C2A6"},
        "note": "이사 준비 · 1개 멈춤으로"
      },
      {
        "at": "2026-09-30T03:00:00+09:00",
        "timeLabel": "새벽 계산",
        "actor": "rule",
        "sourceAi": null,
        "action": "stalled",
        "actionLabel": "멈춤",
        "tasks": [{"id": "task_20260920_01", "title": "교토 3박 4일 일정"}],
        "project": {"id": "prj_kyoto", "name": "가을 교토 여행", "colorHex": "#D768A6"},
        "note": "가을 교토 여행 · 1개 멈춤으로"
      },
      {
        "at": "2026-09-30T03:00:00+09:00",
        "timeLabel": "새벽 계산",
        "actor": "rule",
        "sourceAi": null,
        "action": "stalled",
        "actionLabel": "멈춤",
        "tasks": [{"id": "task_20260921_03", "title": "홈트 루틴 식단"}],
        "project": {"id": "prj_health", "name": "건강", "colorHex": "#9CCB5E"},
        "note": "건강 · 1개 멈춤으로"
      }
    ]
  },
  "collectionStatus": [
    {
      "sourceAi": "chatgpt",
      "methods": ["export"],
      "methodLabel": "내보내기 가져오기",
      "lastCapturedAt": "2026-09-30T08:05:12+09:00",
      "health": "ok",
      "message": null
    },
    {
      "sourceAi": "claude",
      "methods": ["export"],
      "methodLabel": "내보내기 가져오기",
      "lastCapturedAt": "2026-09-28T21:40:03+09:00",
      "health": "ok",
      "message": null
    }
  ],
  "thisWeek": {
    "rangeLabel": "월–화 · 하루 한 번 새로 씀",
    "items": [
      "‘Next.js 배포 오류 해결’을(를) 끝냈어요.",
      "‘전세 계약 특약 문구 검토’을(를) 끝냈어요.",
      "‘hero 섹션 높이 vh 단위’을(를) 끝냈어요.",
      "‘분류 프롬프트 정확도 시험’을(를) 시작했어요.",
      "‘가구 배치 스케치’을(를) 시작했어요."
    ]
  },
  "todayPicks": [
    {
      "rank": 1,
      "task": {
        "id": "task_20260830_01",
        "title": "메인 페이지 카피 확정",
        "status": "멈춤",
        "statusVisual": "stall",
        "staleDays": 12,
        "projectId": "prj_blog"
      },
      "project": {"id": "prj_blog", "name": "블로그 리뉴얼", "colorHex": "#F07F5E"},
      "freshnessLabel": "12일째",
      "nextStep": "A안을 기준으로 보조 문장 3개와 CTA 2개 쓰기",
      "reason": "블로그 리뉴얼 · 다음 단계가 분명해요",
      "recommendedAi": "chatgpt",
      "actionLabel": "ChatGPT에서 이어서",
      "continue": {
        "sourceAi": "chatgpt",
        "url": "https://chatgpt.com/c/68f2a91c-4b7e-8003-a1d2-9c0e5b7f3a21",
        "conversationId": "conv_chatgpt_68f2a91c",
        "label": "ChatGPT에서 이어서"
      },
      "resumeScore": 1.08
    },
    {
      "rank": 2,
      "task": {
        "id": "task_20260902_01",
        "title": "소개 페이지 톤 맞추기",
        "status": "멈춤",
        "statusVisual": "stall2",
        "staleDays": 6,
        "projectId": "prj_blog"
      },
      "project": {"id": "prj_blog", "name": "블로그 리뉴얼", "colorHex": "#F07F5E"},
      "freshnessLabel": "6일째",
      "nextStep": "메인 카피 확정 후 소개 문단 1·2를 같은 톤으로 다시 쓰기",
      "reason": "블로그 리뉴얼 · 다음 단계가 분명해요",
      "recommendedAi": "claude",
      "actionLabel": "Claude에서 이어서",
      "continue": {
        "sourceAi": "claude",
        "url": "https://claude.ai/chat/e02b5a91-6c3d-4f70-b1a8-2d9e4c7f0a35",
        "conversationId": "conv_claude_e02b5a91",
        "label": "Claude에서 이어서"
      },
      "resumeScore": 1.05
    },
    {
      "rank": 3,
      "task": {
        "id": "task_20260921_01",
        "title": "배당 시트 환율 자동화",
        "status": "멈춤",
        "statusVisual": "stall",
        "staleDays": 9,
        "projectId": "prj_dividend"
      },
      "project": {"id": "prj_dividend", "name": "배당 가계부", "colorHex": "#E8B63E"},
      "freshnessLabel": "9일째",
      "nextStep": "GOOGLEFINANCE 환율 셀이 #N/A 나는 원인 찾기",
      "reason": "배당 가계부 · 다음 단계가 분명해요",
      "recommendedAi": "grok",
      "actionLabel": "Grok에서 이어서",
      "continue": {
        "sourceAi": "grok",
        "url": "https://grok.com/chat/b1115650-a489-4475-ad01-94f13a6e1c09",
        "conversationId": "conv_grok_b1115650",
        "label": "Grok에서 이어서"
      },
      "resumeScore": 1.02
    }
  ],
  "longNeglected": {
    "count": 2,
    "items": [
      {
        "id": "task_20260805_01",
        "title": "RSS 피드 붙이기",
        "status": "멈춤",
        "statusVisual": "stall",
        "staleDays": 54,
        "projectId": "prj_blog"
      },
      {
        "id": "task_20260827_01",
        "title": "영문 이력서 다듬기",
        "status": "멈춤",
        "statusVisual": "stall",
        "staleDays": 34,
        "projectId": "prj_career"
      }
    ],
    "prompt": "계속할까요, 보관할까요?"
  },
  "movedProjects": [
    {
      "project": {"id": "prj_subbrain", "name": "서브브레인", "colorHex": "#5B8DEF"},
      "messageCount": 34,
      "note": "시작 1",
      "becameStalled": true
    },
    {
      "project": {"id": "prj_devstudy", "name": "개발 공부", "colorHex": "#4DB9E3"},
      "messageCount": 14,
      "note": "완료 1",
      "becameStalled": false
    },
    {
      "project": {"id": "prj_moving", "name": "이사 준비", "colorHex": "#36C2A6"},
      "messageCount": 8,
      "note": "이어감",
      "becameStalled": true
    },
    {
      "project": {"id": "prj_health", "name": "건강", "colorHex": "#9CCB5E"},
      "messageCount": 4,
      "note": "이어감",
      "becameStalled": true
    },
    {
      "project": {"id": "prj_blog", "name": "블로그 리뉴얼", "colorHex": "#F07F5E"},
      "messageCount": 3,
      "note": "이어감",
      "becameStalled": false
    },
    {
      "project": {"id": "prj_kyoto", "name": "가을 교토 여행", "colorHex": "#D768A6"},
      "messageCount": 0,
      "note": "멈춤으로",
      "becameStalled": true
    }
  ],
  "quickQuestionsByAi": [
    {"sourceAi": "claude", "count": 1},
    {"sourceAi": "gemini", "count": 1},
    {"sourceAi": "chatgpt", "count": 1},
    {"sourceAi": "grok", "count": 1}
  ],
  "pendingMergeSuggestions": [
    {
      "id": "ms_4410",
      "state": "pending",
      "confidence": 0.74,
      "reason": "같은 주제 #카피라이팅 · Claude에서 시작한 소개 페이지 톤 작업을 ChatGPT에서 이어간 것으로 보임",
      "tasks": [
        {
          "id": "task_20260902_01",
          "title": "소개 페이지 톤 맞추기",
          "status": "멈춤",
          "statusVisual": "stall2",
          "staleDays": 6,
          "projectId": "prj_blog",
          "sourceAis": ["claude"]
        },
        {
          "id": "task_20260924_02",
          "title": "소개 페이지 문장 다듬기",
          "status": "멈춤",
          "statusVisual": "stall2",
          "staleDays": 6,
          "projectId": null,
          "sourceAis": ["chatgpt"]
        }
      ],
      "suggestedPrimaryTaskId": "task_20260902_01",
      "createdAt": "2026-09-25T03:02:11+09:00",
      "decidedAt": null
    }
  ],
  "pendingProjectSuggestions": [],
  "alerts": [],
  "ontology": {
    "newlyLinkedCount": 0,
    "pendingCount": 9,
    "items": [
      {
        "id": "osg_mkb9b9",
        "kind": "merge",
        "confidence": 0.78,
        "text": "[도구] Chrome 확장 MV3 = 크롬 익스텐션 (같은 것으로 합치기)",
        "linkType": null,
        "src": {"id": "obj_tool_mv3", "type": "tool", "label": "Chrome 확장 MV3"},
        "dst": {"id": "obj_tool_chromeext", "type": "tool", "label": "크롬 익스텐션"},
        "evidenceCount": 2,
        "evidence": [
          {
            "conversationId": "conv_grok_46093688",
            "sourceAi": "grok",
            "excerpt": "크롬 익스텐션에서 탭 내용 읽으려면 어떤 권한이 필요해?",
            "at": "2026-09-26T12:00:00+09:00"
          },
          {
            "conversationId": "conv_chatgpt_b74a8daa",
            "sourceAi": "chatgpt",
            "excerpt": "MV3라 백그라운드 페이지 대신 서비스 워커.",
            "at": "2026-09-20T12:00:00+09:00"
          }
        ],
        "state": "pending",
        "linkId": null,
        "objectId": null,
        "merge": {"keepId": "obj_tool_mv3", "mergeId": "obj_tool_chromeext"},
        "reason": "merge_candidate",
        "note": "같은 브라우저 확장 이야기일 수 있음",
        "createdAt": "2026-09-30T12:00:00+09:00"
      },
      {
        "id": "osg_tn99dk",
        "kind": "link",
        "confidence": 0.77,
        "text": "[과제] ETF 분배금 세금 —막혔음→ [사람] 친구 민호",
        "linkType": "blocked_by",
        "src": {"id": "obj_task_etftax", "type": "task", "label": "ETF 분배금 세금"},
        "dst": {"id": "obj_person_minho", "type": "person", "label": "친구 민호"},
        "evidenceCount": 1,
        "evidence": [
          {
            "conversationId": "conv_grok_46093688",
            "sourceAi": "grok",
            "excerpt": "종합과세 넘는지는 민호한테 물어보기로.",
            "at": "2026-09-22T12:00:00+09:00"
          }
        ],
        "state": "pending",
        "linkId": "lnk_29",
        "objectId": null,
        "merge": null,
        "reason": "first_seen_person",
        "note": "처음 보는 사람이라 확신도와 상관없이 제안으로 둠",
        "createdAt": "2026-09-30T12:00:00+09:00"
      },
      {
        "id": "osg_sztgyc",
        "kind": "link",
        "confidence": 0.71,
        "text": "[과제] 그래프 홈 시안 —사용함→ [도구] Figma",
        "linkType": "uses",
        "src": {"id": "obj_task_graphhome", "type": "task", "label": "그래프 홈 시안"},
        "dst": {"id": "obj_tool_figma", "type": "tool", "label": "Figma"},
        "evidenceCount": 1,
        "evidence": [
          {
            "conversationId": "conv_claude_296a5a76",
            "sourceAi": "claude",
            "excerpt": "시안은 Figma 말고 코드로 바로 그려 보는 게 빠를 수도.",
            "at": "2026-09-24T12:00:00+09:00"
          }
        ],
        "state": "pending",
        "linkId": "lnk_69",
        "objectId": null,
        "merge": null,
        "reason": "mid_confidence",
        "note": null,
        "createdAt": "2026-09-30T12:00:00+09:00"
      },
      {
        "id": "osg_yb7hyx",
        "kind": "link",
        "confidence": 0.7,
        "text": "[과제] 가구 배치 스케치 —막혔음→ [결정] 이사 날짜 11월 8일",
        "linkType": "blocked_by",
        "src": {"id": "obj_task_furniture", "type": "task", "label": "가구 배치 스케치"},
        "dst": {"id": "obj_decision_moveday", "type": "decision", "label": "이사 날짜 11월 8일"},
        "evidenceCount": 1,
        "evidence": [
          {
            "conversationId": "conv_gemini_b07f0dcd",
            "sourceAi": "gemini",
            "excerpt": "이사 날짜가 정해져야 소파 배송일을 잡을 수 있어.",
            "at": "2026-09-26T12:00:00+09:00"
          }
        ],
        "state": "pending",
        "linkId": "lnk_31",
        "objectId": null,
        "merge": null,
        "reason": "mid_confidence",
        "note": null,
        "createdAt": "2026-09-30T12:00:00+09:00"
      },
      {
        "id": "osg_68vndy",
        "kind": "link",
        "confidence": 0.68,
        "text": "[도구] Netlify —대체함→ [도구] Vercel",
        "linkType": "supersedes",
        "src": {"id": "obj_tool_netlify", "type": "tool", "label": "Netlify"},
        "dst": {"id": "obj_tool_vercel", "type": "tool", "label": "Vercel"},
        "evidenceCount": 1,
        "evidence": [
          {
            "conversationId": "conv_claude_5cb41190",
            "sourceAi": "claude",
            "excerpt": "블로그도 Netlify로 옮기자. Vercel 프로젝트는 정리.",
            "at": "2026-09-26T12:00:00+09:00"
          }
        ],
        "state": "pending",
        "linkId": "lnk_57",
        "objectId": null,
        "merge": null,
        "reason": "supersedes",
        "note": "대체함은 늘 제안으로 둠",
        "createdAt": "2026-09-30T12:00:00+09:00"
      }
    ]
  },
  "cleanup": null
}
```

LATER(1.5) `ontology` 예시 (§10.6 제안 검토 카드 — 확정/거절은 §14의 `/suggestions`):
```json
{
  "newlyLinkedCount": 7,
  "pendingCount": 3,
  "items": [
    {
      "id": "sg_1102",
      "kind": "link",
      "confidence": 0.74,
      "text": "[과제] 메인 페이지 카피 확정 —막혔음→ [과제] 디자이너 답변 대기",
      "linkType": "blocked_by",
      "src": {"id": "obj_task_20260830_01", "type": "task", "label": "메인 페이지 카피 확정"},
      "dst": {"id": "obj_task_20260916_02", "type": "task", "label": "디자이너 답변 대기"},
      "evidenceCount": 1,
      "evidence": [
        {
          "conversationId": "conv_chatgpt_68f2a91c",
          "sourceAi": "chatgpt",
          "excerpt": "디자이너가 폰트 크기 답을 줘야 카피 길이를 정할 수 있어",
          "at": "2026-09-18T01:20:00+09:00"
        }
      ]
    }
  ]
}
```

LATER(6) `cleanup` 예시 (§10.6 승인 칸, §11 — 문구는 설계서 지시대로 "언제든 보관 해제 가능"):
```json
{
  "autoArchived": [{"sourceAi": "chatgpt", "count": 31, "note": "언제든 보관 해제 가능"}],
  "deletionBatch": {
    "id": "del_20260930",
    "state": "pending",
    "selectedCount": 32,
    "candidateCount": 34,
    "groups": [
      {
        "sourceAi": "claude",
        "selected": 20,
        "total": 21,
        "backupVerified": true,
        "items": [
          {
            "itemId": 501,
            "conversationId": "conv_claude_91d0f6a4",
            "title": "Next.js 배포 오류 해결",
            "kindLabel": "완료 · 위키",
            "date": "2026-09-29",
            "selected": true,
            "excludedByUser": false
          },
          {
            "itemId": 504,
            "conversationId": "conv_claude_5f81c0d2",
            "title": "도메인과 호스팅 고르기",
            "kindLabel": "완료",
            "date": "2026-06-15",
            "selected": false,
            "excludedByUser": true
          }
        ]
      },
      {
        "sourceAi": "gemini",
        "selected": 12,
        "total": 12,
        "backupVerified": true,
        "items": [
          {
            "itemId": 522,
            "conversationId": "conv_gemini_2d9f0a61",
            "title": "교토 10월 평균 기온",
            "kindLabel": "간단한 질문",
            "date": "2026-09-21",
            "selected": true,
            "excludedByUser": false
          }
        ]
      }
    ],
    "autoExcluded": [
      {"count": 4, "sourceAi": "grok", "reason": "어댑터 점검 중"},
      {"count": 2, "sourceAi": null, "reason": "서비스 안 프로젝트 폴더"},
      {"count": 1, "sourceAi": null, "reason": "공유 링크가 있음"},
      {"count": 1, "sourceAi": null, "reason": "캔버스를 수집하지 못함"}
    ],
    "estimate": {"perItemSec": 4, "totalMin": 3, "label": "건당 4초 간격, 3분쯤 걸려요"}
  }
}
```

### 10.3 `POST /api/v1/digests/:date/regenerate` — MVP
그날 요약을 다시 만든다(오늘 날짜만 허용, 과거는 `409`). 본문 없음 → `202 Job`(`type:"digest"`). 끝나면 `GET /digests/:date`.

---

## 11. 검색

### 11.1 `GET /api/v1/search` — MVP
⌘K 검색(§10.3 "과제, 대화 원문, 결정 사항 검색", §10.7). 결과에서 과제 상세·노트·원래 대화로 이동.

| 쿼리 | 기본 | 설명 |
|---|---|---|
| `q` | (필수) | 1~200자. 공백으로 단어 구분 |
| `types` | `task,conversation,message,decision` | `wiki`는 Phase 5 |
| `projectId`, `sourceAi`, `status`, `from`, `to` | | 필터 |
| `limit`, `cursor` | 20 | |

**한국어 규칙(§6.4)** — 단어마다 방식을 고르고 결과를 교집합한다. 쓴 방식은 `terms[].mode`로 돌려준다.
| 단어 길이 | 방식 (`mode`) | 비고 |
|---|---|---|
| 3글자 이상 | `trigram` — `messages_fts`/`tasks_fts`/`conversations_fts MATCH '"<단어>"'` (큰따옴표로 감싸 구문 검색) | 이 박스에서 동작 확인: `"이사업"` 1건 |
| 2글자 | `bigram`(보조 색인이 있으면) — **MVP는 `like`** (`LIKE '%이사%'` 전체 스캔) | 확인: trigram MATCH `"이사"` = 0건 → 대체가 꼭 필요 |
| 1글자 | `title_like` — 제목·요약에만 LIKE | |

- `notice`: 느린 방식을 썼을 때 한 줄 안내.
- `snippetMd`: 일치 부분 `**굵게**`, 앞뒤 60자 안팎.
- `q`가 비었거나 200자 초과 → `400 VALIDATION_ERROR`.

응답 `200 SearchResponse` (`?q=이사 견적`)
```json
{
  "items": [
    {
      "type": "task",
      "id": "task_20260914_01",
      "title": "이사업체 견적 비교표",
      "snippetMd": "**이사**업체 3곳 **견적**을 표로 비교하다가 B업체 추가 **견적** 대기 중",
      "task": {
        "id": "task_20260914_01",
        "title": "이사업체 견적 비교표",
        "status": "진행 중",
        "statusVisual": "run",
        "staleDays": null,
        "projectId": "prj_moving"
      },
      "conversationId": "conv_claude_a1b2c3d4",
      "sourceAi": "claude",
      "sourceUrl": "https://claude.ai/chat/a1b2c3d4-7f60-4e2a-9b1c-5d8e3f0a6c27",
      "vaultPath": "tasks/이사업체-견적-비교표.md",
      "at": "2026-09-29T19:20:00+09:00",
      "score": 1
    },
    {
      "type": "conversation",
      "id": "conv_claude_a1b2c3d4",
      "title": "이사업체 견적 비교표",
      "snippetMd": "**이사**업체 **견적** 비교표",
      "task": {
        "id": "task_20260914_01",
        "title": "이사업체 견적 비교표",
        "status": "진행 중",
        "statusVisual": "run",
        "staleDays": null,
        "projectId": "prj_moving"
      },
      "conversationId": "conv_claude_a1b2c3d4",
      "sourceAi": "claude",
      "sourceUrl": "https://claude.ai/chat/a1b2c3d4-7f60-4e2a-9b1c-5d8e3f0a6c27",
      "vaultPath": "conversations/2026/09/2026-09-14_claude_이사업체-견적-비교표_a1b2c3d4.md",
      "at": "2026-09-29T19:20:00+09:00",
      "score": 0.8
    },
    {
      "type": "message",
      "id": "250",
      "title": "이사업체 견적 비교표",
      "snippetMd": "**이사**업체 **견적** 비교표을(를) 기준으로 보면 세 가지로 나눌 수 있어요. 1) 목표 정하기 2) 선택지 비교 3)…",
      "task": {
        "id": "task_20260914_01",
        "title": "이사업체 견적 비교표",
        "status": "진행 중",
        "statusVisual": "run",
        "staleDays": null,
        "projectId": "prj_moving"
      },
      "conversationId": "conv_claude_a1b2c3d4",
      "sourceAi": "claude",
      "sourceUrl": "https://claude.ai/chat/a1b2c3d4-7f60-4e2a-9b1c-5d8e3f0a6c27",
      "vaultPath": "conversations/2026/09/2026-09-14_claude_이사업체-견적-비교표_a1b2c3d4.md",
      "at": "2026-09-29T19:20:00+09:00",
      "score": 0.72
    },
    {
      "type": "message",
      "id": "243",
      "title": "이사업체 견적 비교표",
      "snippetMd": "좋아. 그럼 **이사**업체 **견적** 비교표에서 제일 먼저 할 일은 뭐야?",
      "task": {
        "id": "task_20260914_01",
        "title": "이사업체 견적 비교표",
        "status": "진행 중",
        "statusVisual": "run",
        "staleDays": null,
        "projectId": "prj_moving"
      },
      "conversationId": "conv_claude_a1b2c3d4",
      "sourceAi": "claude",
      "sourceUrl": "https://claude.ai/chat/a1b2c3d4-7f60-4e2a-9b1c-5d8e3f0a6c27",
      "vaultPath": "conversations/2026/09/2026-09-14_claude_이사업체-견적-비교표_a1b2c3d4.md",
      "at": "2026-09-25T06:07:23+09:00",
      "score": 0.7
    },
    {
      "type": "message",
      "id": "242",
      "title": "이사업체 견적 비교표",
      "snippetMd": "**이사**업체 **견적** 비교표의 첫 단계는 현재 상태를 한 줄로 적는 거예요. 그다음 막힌 지점을 하나만 고르세요.",
      "task": {
        "id": "task_20260914_01",
        "title": "이사업체 견적 비교표",
        "status": "진행 중",
        "statusVisual": "run",
        "staleDays": null,
        "projectId": "prj_moving"
      },
      "conversationId": "conv_claude_a1b2c3d4",
      "sourceAi": "claude",
      "sourceUrl": "https://claude.ai/chat/a1b2c3d4-7f60-4e2a-9b1c-5d8e3f0a6c27",
      "vaultPath": "conversations/2026/09/2026-09-14_claude_이사업체-견적-비교표_a1b2c3d4.md",
      "at": "2026-09-24T14:31:18+09:00",
      "score": 0.7
    },
    {
      "type": "message",
      "id": "256",
      "title": "포장이사 체크리스트",
      "snippetMd": "포장**이사**는 **견적** 받을 때 사다리차 비용이 따로인지 꼭 물어보세요. 엘리베이터 사용 예약도 미리 해 두면 좋아요.",
      "task": {
        "id": "task_20260802_01",
        "title": "포장이사 체크리스트",
        "status": "완료",
        "statusVisual": "done",
        "staleDays": null,
        "projectId": "prj_moving"
      },
      "conversationId": "conv_chatgpt_9f8e7d6c",
      "sourceAi": "chatgpt",
      "sourceUrl": "https://chatgpt.com/c/9f8e7d6c-1a2b-8005-d4e6-7b9c0a1f2e33",
      "vaultPath": "conversations/2026/08/2026-08-02_chatgpt_포장이사-체크리스트_9f8e7d6c.md",
      "at": "2026-08-02T21:38:53+09:00",
      "score": 0.56
    }
  ],
  "page": {"limit": 20, "nextCursor": null, "hasMore": false, "total": 6},
  "query": "이사 견적",
  "terms": [{"term": "이사", "mode": "like"}, {"term": "견적", "mode": "like"}],
  "notice": "2글자 검색어는 전체 검색(LIKE)으로 찾았어요. 조금 느릴 수 있어요.",
  "tookMs": 7
}
```

**페이지 넘기기 예시** — `?q=카피&limit=2` → `page.nextCursor`가 있으면 그 값을 `cursor`로 넘겨 다음 쪽(`?q=카피&limit=2&cursor=<nextCursor>`, 목: `searchPagedNext`). `nextCursor`는 불투명 문자열(해석하지 말 것).
```json
{
  "items": [
    {
      "type": "task",
      "id": "task_20260902_01",
      "title": "소개 페이지 톤 맞추기",
      "snippetMd": "메인 **카피**가 정해지면 같은 톤으로 다시 쓰기로 함",
      "task": {
        "id": "task_20260902_01",
        "title": "소개 페이지 톤 맞추기",
        "status": "멈춤",
        "statusVisual": "stall2",
        "staleDays": 6,
        "projectId": "prj_blog"
      },
      "conversationId": "conv_claude_e02b5a91",
      "sourceAi": "claude",
      "sourceUrl": "https://claude.ai/chat/e02b5a91-6c3d-4f70-b1a8-2d9e4c7f0a35",
      "vaultPath": "tasks/소개-페이지-톤-맞추기.md",
      "at": "2026-09-24T22:10:00+09:00",
      "score": 0.97
    },
    {
      "type": "task",
      "id": "task_20260830_01",
      "title": "메인 페이지 카피 확정",
      "snippetMd": "메인 페이지 **카피** 확정",
      "task": {
        "id": "task_20260830_01",
        "title": "메인 페이지 카피 확정",
        "status": "멈춤",
        "statusVisual": "stall",
        "staleDays": 12,
        "projectId": "prj_blog"
      },
      "conversationId": "conv_chatgpt_68f2a91c",
      "sourceAi": "chatgpt",
      "sourceUrl": "https://chatgpt.com/c/68f2a91c-4b7e-8003-a1d2-9c0e5b7f3a21",
      "vaultPath": "tasks/메인-페이지-카피-확정.md",
      "at": "2026-09-18T01:47:00+09:00",
      "score": 0.94
    }
  ],
  "page": {"limit": 2, "nextCursor": "eyJvIjoyfQ", "hasMore": true, "total": 13},
  "query": "카피",
  "terms": [{"term": "카피", "mode": "like"}],
  "notice": "2글자 검색어는 전체 검색(LIKE)으로 찾았어요. 조금 느릴 수 있어요.",
  "tookMs": 6
}
```

---

## 12. 가져오기 · 작업(jobs) · 분류

> 흐름(§3 시나리오 D, §10.7): **ZIP 끌어다 놓기 → 미리보기(대화 수, 예상 토큰·비용) → 실행 → 진행률**. MVP 파서: ChatGPT(메시지 트리에서 현재 가지), Claude(§5.4②, §14.2). 원본 파일은 `raw/exports/<ai>/`에 그대로 보관(§6.1).
> 진행률은 **폴링**(1초 간격 권장). SSE는 Phase 2(§14).

상태 흐름 (`ImportState`):
```
uploaded → parsing → preview_ready ──(POST start)──→ importing → classifying → done
                 ↘ failed          ↘ (POST cancel) → cancelled      ↘ failed
```
- `classify:false`로 시작하면 `importing → done`(분류는 나중에 `/classification/run`).
- 하루 비용 상한에 걸리면 남은 분류는 `deferred` 작업으로 넘기고 가져오기는 `done`(`result.classificationDeferred`).

### 12.1 `POST /api/v1/imports` — MVP
`Content-Type: multipart/form-data`
| 필드 | 필수 | 설명 |
|---|---|---|
| `file` | ✅ | ChatGPT 내보내기 ZIP 또는 `conversations.json`, Claude 내보내기 ZIP 또는 `conversations.json`. 상한 2 GB. 1.1.0: 새 Claude 내보내기(2026-10)의 카테고리 ZIP도 받는다 — `conversations-000.zip`(대화), `projects-000.zip`(프로젝트만), `memories-000.zip`(가져올 것 없음, 안내만). 1.2.0: **Google Takeout "내 활동 > Gemini 앱"** — Takeout ZIP, 또는 `MyActivity.html`·`MyActivity.json` 파일 하나(§12.2) |
| `sourceAi` | | `chatgpt \| claude \| gemini`(1.2.0). 없으면 내용으로 자동 감지 |
| `geminiSessionGapMinutes` | | 1.2.0 Gemini Takeout만: 대화 주소가 없는 기록을 대화로 묶을 시간 간격(분, 1–1440, 기본 30). 범위 밖이면 `400 VALIDATION_ERROR` |

- 파일 해시(sha256)가 이미 가져온 것과 같으면 `409 DUPLICATE_IMPORT`(`details.importId`). 강제로 다시 하려면 `?force=true`.
- **ChatGPT 음성 대화(1.3.0)**: 음성 턴은 `multimodal_text` 안의 `audio_transcription` 부품(`text`, `direction: in=사용자·out=AI`)으로 온다(사용자 실제 내보내기 2026-10로 확인: 2,046부품·8대화). 1.2.0까지는 전부 `[첨부: 음성]`으로 바꿔 전사가 사라졌다 — 이제 전사를 본문으로 쓰고 메시지에 `voice:true`. 글이 없는 오디오·영상 부품(`audio_asset_pointer`·`real_time_user_audio_video_asset_pointer`, 전사가 비었을 때)만 `[첨부: 음성]`. 같은 파일을 **다시 가져오면**(`?force=true`, 파일 해시가 같아 그냥은 `409`) 그 대화들은 "바뀜"으로 갱신되고(중복 없음) 재분류 대상(`scope:"changed"`)이 된다. 음성이 아닌 대화의 내용 해시는 그대로라 "같음".
- 형식을 모르면 `400 UNSUPPORTED_FILE`(Grok은 아직). 1.2.0부터 `<`로 시작하는 HTML 파일도 받는다(Gemini Takeout HTML이 아니면 미리보기 단계에서 `failed`).
- 응답은 즉시 `202 ImportJob`(`state:"parsing"`) + `Location: /api/v1/imports/<id>`.

응답 `202 ImportJob`
```json
{
  "id": "imp_20260930_n8w1",
  "state": "parsing",
  "sourceAi": null,
  "fileName": "chatgpt-export-full-2026-09-30.zip",
  "fileSizeBytes": 187334656,
  "fileHash": "sha256:5e1c0b7a9d2f4e6813c7a0b9f1d2e3c4a5b6c7d8e9f0a1b2c3d4e5f60718293a",
  "createdAt": "2026-09-30T09:02:10+09:00",
  "startedAt": null,
  "finishedAt": null,
  "options": {},
  "preview": null,
  "progress": {
    "phase": "parsing",
    "processed": 0,
    "total": 0,
    "percent": 2,
    "currentLabel": "ZIP 여는 중",
    "etaSec": null
  },
  "result": null,
  "errors": [],
  "classifyJobId": null
}
```

(선택) CLI·감시 폴더용 JSON 본문: `POST /imports` + `Content-Type: application/json` + `{ "path": "/path/to/chatgpt-export.zip" }` — 코어가 로컬 파일을 직접 읽음. 웹은 쓰지 않음. 1.2.0: `sourceAi`에 `gemini`, 선택 `geminiSessionGapMinutes`(숫자). CLI: `subbrain import <파일> [--gap 분]`.

### 12.2 `GET /api/v1/imports/:importId` — MVP
진행률·미리보기·결과. 미리보기 준비 시(`preview_ready`):
```json
{
  "id": "imp_20260930_n8w1",
  "state": "preview_ready",
  "sourceAi": "chatgpt",
  "fileName": "chatgpt-export-full-2026-09-30.zip",
  "fileSizeBytes": 187334656,
  "fileHash": "sha256:5e1c0b7a9d2f4e6813c7a0b9f1d2e3c4a5b6c7d8e9f0a1b2c3d4e5f60718293a",
  "createdAt": "2026-09-30T09:02:10+09:00",
  "startedAt": null,
  "finishedAt": null,
  "options": {},
  "preview": {
    "sourceAi": "chatgpt",
    "detectedFormat": "chatgpt_export_zip",
    "formatVersion": "2026-09",
    "category": "conversations",
    "projects": null,
    "conversationsTotal": 1204,
    "conversationsNew": 1180,
    "conversationsUpdated": 18,
    "conversationsUnchanged": 6,
    "messagesTotal": 23870,
    "dateRange": {"from": "2023-03-14T22:01:00+09:00", "to": "2026-09-29T23:12:00+09:00"},
    "quickQuestionPrefiltered": 412,
    "activity": null,
    "estimate": {
      "model": "claude-haiku-4-5",
      "inputTokens": 3960000,
      "outputTokens": 238000,
      "costUsd": 5.15,
      "note": "가격표 기준 추정 [미검증] · 간단한 질문 412개는 규칙으로 걸러 LLM 생략"
    },
    "warnings": ["캔버스·첨부파일 17개는 자리표시자로만 저장돼요"]
  },
  "progress": {
    "phase": "preview_ready",
    "processed": 1204,
    "total": 1204,
    "percent": 10,
    "currentLabel": "미리보기 준비됨",
    "etaSec": null
  },
  "result": null,
  "errors": [],
  "classifyJobId": null
}
```
분류 진행 중(`classifying`):
```json
{
  "id": "imp_20260930_n8w1",
  "state": "classifying",
  "sourceAi": "chatgpt",
  "fileName": "chatgpt-export-full-2026-09-30.zip",
  "fileSizeBytes": 187334656,
  "fileHash": "sha256:5e1c0b7a9d2f4e6813c7a0b9f1d2e3c4a5b6c7d8e9f0a1b2c3d4e5f60718293a",
  "createdAt": "2026-09-30T09:02:10+09:00",
  "startedAt": "2026-09-30T09:04:31+09:00",
  "finishedAt": null,
  "options": {"classify": true, "maxCostUsd": 10},
  "preview": {
    "sourceAi": "chatgpt",
    "detectedFormat": "chatgpt_export_zip",
    "formatVersion": "2026-09",
    "category": "conversations",
    "projects": null,
    "conversationsTotal": 1204,
    "conversationsNew": 1180,
    "conversationsUpdated": 18,
    "conversationsUnchanged": 6,
    "messagesTotal": 23870,
    "dateRange": {"from": "2023-03-14T22:01:00+09:00", "to": "2026-09-29T23:12:00+09:00"},
    "quickQuestionPrefiltered": 412,
    "activity": null,
    "estimate": {
      "model": "claude-haiku-4-5",
      "inputTokens": 3960000,
      "outputTokens": 238000,
      "costUsd": 5.15,
      "note": "가격표 기준 추정 [미검증] · 간단한 질문 412개는 규칙으로 걸러 LLM 생략"
    },
    "warnings": ["캔버스·첨부파일 17개는 자리표시자로만 저장돼요"]
  },
  "progress": {
    "phase": "classifying",
    "processed": 312,
    "total": 792,
    "percent": 58,
    "currentLabel": "분류 중 · 312 / 792",
    "etaSec": 1440
  },
  "result": null,
  "errors": [],
  "classifyJobId": "job_8c21"
}
```
완료(`done`):
```json
{
  "id": "imp_20260930_k3f9",
  "state": "done",
  "sourceAi": "chatgpt",
  "fileName": "chatgpt-export-2026-09-30.zip",
  "fileSizeBytes": 187334656,
  "fileHash": "sha256:756e784a85dbdf6e3f870470c483da6937282a406650b2f59ecfd86400aa7529",
  "createdAt": "2026-09-30T08:02:10+09:00",
  "startedAt": "2026-09-30T08:04:31+09:00",
  "finishedAt": "2026-09-30T08:41:07+09:00",
  "options": {"classify": true, "maxCostUsd": 10},
  "preview": {
    "sourceAi": "chatgpt",
    "detectedFormat": "chatgpt_export_zip",
    "formatVersion": null,
    "category": "conversations",
    "projects": null,
    "conversationsTotal": 102,
    "conversationsNew": 102,
    "conversationsUpdated": 0,
    "conversationsUnchanged": 0,
    "messagesTotal": 924,
    "dateRange": {"from": "2026-04-06T21:00:00+09:00", "to": "2026-09-29T21:31:00+09:00"},
    "quickQuestionPrefiltered": 0,
    "activity": null,
    "estimate": {
      "model": "claude-haiku-4-5",
      "inputTokens": 0,
      "outputTokens": 0,
      "costUsd": null,
      "note": "예시 데이터"
    },
    "warnings": []
  },
  "progress": {
    "phase": "done",
    "processed": 102,
    "total": 102,
    "percent": 100,
    "currentLabel": "완료",
    "etaSec": 0
  },
  "result": {
    "conversationsNew": 102,
    "conversationsUpdated": 0,
    "skippedDuplicates": 0,
    "tasksCreated": 102,
    "classified": 102,
    "classificationDeferred": 0,
    "actualCostUsd": null,
    "unfinishedTasks": 0,
    "projectsCreated": 0
  },
  "errors": [],
  "classifyJobId": null
}
```
**카테고리 ZIP(1.1.0)**: 미리보기 `category`가 `conversations`(기존과 같음, `projects:null`) · `projects` · `memories`.
- `projects`(`detectedFormat:"claude_projects_zip"`): `projects/<uuid>.json`을 읽어 `preview.projects = { total, new, existing, skipped, names }`. 이름 없는 것·Claude 기본 스타터 프로젝트("How to use Claude")·파일 안 중복은 `skipped`, 같은 이름(동의어 포함)이나 이전에 가져온 같은 uuid는 `existing`. 시작하면 `new`만 프로젝트로 만들고 `result.projectsCreated`에 수를 넣는다(대화·과제 0). Claude 프로젝트의 `description`은 시스템 프롬프트라 요약으로 쓰지 않는다. 대화와 연결 정보가 없으므로 과제 연결은 분류 때 프로젝트 이름 매칭 또는 §9-2 제안으로 — **대화 ZIP보다 먼저 올리면** 분류기가 이 프로젝트 이름을 고를 수 있다.
- `memories`(`detectedFormat:"claude_memories_zip"`): 서브브레인은 메모리를 쓰지 않아 미리보기 경고만 주고, 시작하면 바로 `done`(모두 0).
- 대화 ZIP의 `result.projectsCreated`는 항상 0. 1.0.x에 저장된 가져오기 기록은 읽을 때 `category:"conversations"`·`projects:null`·`projectsCreated:0`으로 채운다.
```json
{
  "id": "imp_20261002_p4c2",
  "state": "preview_ready",
  "sourceAi": "claude",
  "fileName": "projects-000.zip",
  "fileSizeBytes": 48211,
  "fileHash": "sha256:9a8b7c6d5e4f30211203a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5",
  "createdAt": "2026-09-30T09:02:10+09:00",
  "startedAt": null,
  "finishedAt": null,
  "options": {},
  "preview": {
    "sourceAi": "claude",
    "detectedFormat": "claude_projects_zip",
    "formatVersion": "2026-10",
    "category": "projects",
    "projects": {"total": 23, "new": 20, "existing": 1, "skipped": 2, "names": ["서브브레인", "블로그 리뉴얼", "이사 준비"]},
    "conversationsTotal": 0,
    "conversationsNew": 0,
    "conversationsUpdated": 0,
    "conversationsUnchanged": 0,
    "messagesTotal": 0,
    "dateRange": {"from": null, "to": null},
    "quickQuestionPrefiltered": 0,
    "activity": null,
    "estimate": {
      "model": null,
      "inputTokens": 0,
      "outputTokens": 0,
      "costUsd": 0,
      "note": "대화가 없는 파일이라 분류하지 않아요 — 비용 없음"
    },
    "warnings": [
      "Claude 프로젝트 파일이에요 — 대화가 없어 프로젝트만 만들어요.",
      "새 Claude 내보내기는 대화에 프로젝트 정보가 없어요. 과제는 분류 때 프로젝트 이름이 맞거나 새 프로젝트 제안을 수락하면 연결돼요."
    ]
  },
  "progress": {
    "phase": "preview_ready",
    "processed": 0,
    "total": 0,
    "percent": 10,
    "currentLabel": "미리보기 준비됨",
    "etaSec": null
  },
  "result": null,
  "errors": [],
  "classifyJobId": null
}
```

**Gemini Takeout (1.2.0)** — `sourceAi:"gemini"`, `detectedFormat`이 `gemini_takeout_html`(기본 형식) 또는 `gemini_takeout_json`, `formatVersion` = `takeout-my-activity-html|json[-zip]`.
- Takeout은 대화가 아니라 **활동 기록**(질문 1개 + 응답 1개)이다. 코어가 대화로 다시 묶는다: ① 기록에 대화 주소(`gemini.google.com/app/<id>`)가 있으면 그 id별(`source_id`=id, 원본 링크 있음) ② 없으면 시간순으로 앞 기록과 `geminiSessionGapMinutes`(기본 30분) 넘게 떨어지면 새 대화 — 단 3시간 이내이고 주제가 이어지면(글자 2-gram 유사도 ≥0.3) 붙이고, 간격 안이라도 5분 넘게 떨어진 긴 새 질문이 앞 주제와 거의 겹치지 않으면(<0.05) 나눈다("더 짧게"·"그럼…" 같은 이어 묻기는 나누지 않음). 시간으로 묶은 대화는 `source_id = gtk_<첫 기록(시각+질문) 해시>`, 원본 링크 없음(`TaskListItem.primaryConversation.url:null`).
- **다시 가져와도 중복 없음**: 같은 파일 → 모두 "같음". 새 기록이 더해진 Takeout → 첫 기록이 같은 대화는 "바뀜"(메시지 추가), 나머지 "같음". 간격 값을 바꿔 다시 가져오면 묶음이 달라져 새 대화가 생길 수 있다.
- 미리보기 `activity`(`GeminiActivityPreview`, 다른 형식이면 `null`): `events`(Gemini 기록 수) → `conversations`(= `conversationsTotal`), `byConversationId`·`bySession`, `skipped`(다른 제품·피드백·빈 기록), `missingResponses`(응답 본문 없음 — Takeout에서 흔함), `attachments`(첨부·캔버스가 있던 기록 — 내용은 없고 `[첨부 N개]`·`[캔버스] 제목` 표시만, `hasUnextractedArtifact`), `timezoneAssumed`(시간대 없는 HTML 날짜를 KST로 본 수), `sessionGapMinutes`.
- ZIP 안 위치: 경로에 `Gemini`/`Bard`가 들어간 폴더의 `.html`/`.json`(예: `Takeout/My Activity/Gemini Apps/MyActivity.html`, 한국어 `Takeout/내 활동/Gemini 앱/내활동.html`). JSON과 HTML이 둘 다 있으면 JSON. 기록이 0개면 `failed`("Gemini 앱 활동이 꺼져 있으면 빈 파일").
- 형식 근거 — **확인**(공개 문서·여러 공개 파서가 같은 모양): 기록 배열/카드 목록, JSON `header·title("Prompted …")·time(ISO UTC)·products·subtitles·titleUrl`, 응답 위치가 `safeHtmlItem[].html`·`subtitles[].name`·`details[{name:"Response"}]`·`userInteractions[].userInteraction.response`(JSON 문자열)로 내보내기마다 다름, HTML 카드 `div.outer-cell` > 첫 `content-cell` = "Prompted&nbsp;질문<br>날짜<br>응답 HTML", 날짜 예 `1 Apr 2026, 18:39:35 WEST`·`Oct 1, 2024, 3:45:12 PM KST`. **추정**(한 곳만 언급·직접 확인 못 함): `titleUrl`의 대화 id, 한국어 계정의 폴더·파일 이름·날짜 형식(`2024. 10. 1. 오후 3:45:12 KST`)·질문 앞말, 첨부·캔버스 기록 문구. 앞말이 없거나 날짜를 못 읽어도 기록은 버리지 않는다(날짜 없으면 시각 없음).
```json
{
  "id": "imp_20261010_g7m2",
  "state": "preview_ready",
  "sourceAi": "gemini",
  "fileName": "takeout-20261010T120000Z-001.zip",
  "fileSizeBytes": 3184220,
  "fileHash": "sha256:4f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0",
  "createdAt": "2026-09-30T09:02:10+09:00",
  "startedAt": null,
  "finishedAt": null,
  "options": {},
  "preview": {
    "sourceAi": "gemini",
    "detectedFormat": "gemini_takeout_html",
    "formatVersion": "takeout-my-activity-html-zip",
    "category": "conversations",
    "projects": null,
    "conversationsTotal": 97,
    "conversationsNew": 97,
    "conversationsUpdated": 0,
    "conversationsUnchanged": 0,
    "messagesTotal": 801,
    "dateRange": {"from": "2025-11-02T21:14:09+09:00", "to": "2026-10-09T23:41:52+09:00"},
    "quickQuestionPrefiltered": 31,
    "activity": {
      "events": 412,
      "skipped": 9,
      "conversations": 97,
      "byConversationId": 0,
      "bySession": 97,
      "sessionGapMinutes": 30,
      "missingResponses": 23,
      "attachments": 14,
      "timezoneAssumed": 0
    },
    "estimate": {
      "model": "gemini-3.5-flash-lite",
      "inputTokens": 181000,
      "outputTokens": 19800,
      "costUsd": 0.03,
      "note": "글자 수 기준 대략 추정 [미검증] · 간단한 질문 31개는 규칙으로 걸러 LLM 생략"
    },
    "warnings": [
      "Gemini Takeout은 대화가 아니라 활동 기록이에요 — 기록 412개를 대화 97개로 다시 묶었어요 (대화 주소 없는 기록은 30분 간격·주제 연속성으로 묶음)",
      "응답 본문이 없는 기록 23개 — Takeout이 응답을 빼거나 자르는 일이 흔해요",
      "첨부·캔버스가 있던 기록 14개 — 파일·캔버스 내용은 Takeout에 없어 표시만 남겨요",
      "Gemini 대화가 아닌 기록 9개는 건너뛰었어요(피드백·다른 제품·빈 기록)"
    ]
  },
  "progress": {
    "phase": "preview_ready",
    "processed": 97,
    "total": 97,
    "percent": 10,
    "currentLabel": "미리보기 준비됨",
    "etaSec": null
  },
  "result": null,
  "errors": [],
  "classifyJobId": null
}
```

### 12.3 `POST /api/v1/imports/:importId/start` — MVP
`preview_ready`에서만(아니면 `409`). 본문 `StartImportBody` → `202 ImportJob`(`state:"importing"`).
```json
{"classify": true, "maxCostUsd": 10}
```

### 12.4 `POST /api/v1/imports/:importId/cancel` · `GET /api/v1/imports` — MVP
- cancel: 본문 없음 → `200 ImportJob`(`cancelled`). 이미 DB에 들어간 대화는 남는다(되돌리기 없음, 다시 가져오면 중복 제거됨). `done/failed`면 `409`.
- 목록: `?limit=20&cursor=` 최근 순 → `ListResponse<ImportJob>` (§6.3 `import_batches`).
```json
{
  "items": [
    {
      "id": "imp_20260930_k3f9",
      "state": "done",
      "sourceAi": "chatgpt",
      "fileName": "chatgpt-export-2026-09-30.zip",
      "fileSizeBytes": 187334656,
      "fileHash": "sha256:756e784a85dbdf6e3f870470c483da6937282a406650b2f59ecfd86400aa7529",
      "createdAt": "2026-09-30T08:02:10+09:00",
      "startedAt": "2026-09-30T08:04:31+09:00",
      "finishedAt": "2026-09-30T08:41:07+09:00",
      "options": {"classify": true, "maxCostUsd": 10},
      "preview": {
        "sourceAi": "chatgpt",
        "detectedFormat": "chatgpt_export_zip",
        "formatVersion": null,
        "category": "conversations",
        "projects": null,
        "conversationsTotal": 102,
        "conversationsNew": 102,
        "conversationsUpdated": 0,
        "conversationsUnchanged": 0,
        "messagesTotal": 924,
        "dateRange": {"from": "2026-04-06T21:00:00+09:00", "to": "2026-09-29T21:31:00+09:00"},
        "quickQuestionPrefiltered": 0,
        "activity": null,
        "estimate": {
          "model": "claude-haiku-4-5",
          "inputTokens": 0,
          "outputTokens": 0,
          "costUsd": null,
          "note": "예시 데이터"
        },
        "warnings": []
      },
      "progress": {
        "phase": "done",
        "processed": 102,
        "total": 102,
        "percent": 100,
        "currentLabel": "완료",
        "etaSec": 0
      },
      "result": {
        "conversationsNew": 102,
        "conversationsUpdated": 0,
        "skippedDuplicates": 0,
        "tasksCreated": 102,
        "classified": 102,
        "classificationDeferred": 0,
        "actualCostUsd": null,
        "unfinishedTasks": 0,
        "projectsCreated": 0
      },
      "errors": [],
      "classifyJobId": null
    }
  ],
  "page": {"limit": 20, "nextCursor": null, "hasMore": false, "total": 1}
}
```

### 12.5 `GET /api/v1/jobs` · `GET /api/v1/jobs/:jobId` — MVP
백그라운드 작업(분류·볼트 생성·요약·방치 재계산·백업). 쿼리: `type`, `state`, `parentId`, `limit`, `cursor`.

`GET /jobs/:jobId` → `200 Job`
```json
{
  "id": "job_8c21",
  "type": "classify",
  "state": "running",
  "createdAt": "2026-09-30T09:04:31+09:00",
  "startedAt": "2026-09-30T09:04:33+09:00",
  "finishedAt": null,
  "progress": {"processed": 312, "total": 792, "percent": 39},
  "label": "분류 · 가져오기 imp_20260930_n8w1",
  "parentId": "imp_20260930_n8w1",
  "error": null,
  "costUsd": 1.83
}
```
`GET /jobs` → `200 ListResponse<Job>`
```json
{"items": [], "page": {"limit": 5, "nextCursor": null, "hasMore": false, "total": 0}}
```

### 12.6 `GET /api/v1/classification/status` — MVP
분류 대기열, 오늘 토큰·비용, 하루 상한(§7.7 "하루 LLM 비용 상한"), "확인 필요" 수. 1.1.0: `blockedCount` = 분류 불가 과제 수(보관 제외), `needsReviewCount`는 분류 불가 포함, `promptVersion`은 코드의 현재 프롬프트 버전(1.2.0 `cls-v3`, 1.4.0부터 `cls-v4`). 1.2.0: `today.cacheHits` = 오늘 응답 캐시로 처리한 분류 수(토큰·비용 0). **1.3.0 비용**: `today.costUsd`는 가격을 모르는 모델로 분류한 것(규칙 분류기·캐시 적중 제외)이 오늘 하나라도 있으면 `null`("알 수 없음" — `$0`으로 보이면 안 됨), `today.costUsdKnown` = 가격을 아는 것만 더한 값(하루 상한 판단도 이것), `today.costUnknownCount` = 가격 모르는 분류 수. 화면 예: `costUsd===null`이면 "약 $${costUsdKnown} + 알 수 없음 ${costUnknownCount}건".
```json
{
  "queue": {"pending": 0, "running": 0, "deferred": 0, "failedToday": 0},
  "today": {
    "classified": 1,
    "inputTokens": 3280,
    "outputTokens": 240,
    "costUsd": null,
    "costUsdKnown": 0,
    "costUnknownCount": 1,
    "cacheHits": 0
  },
  "dailyCapUsd": 10,
  "capReached": false,
  "model": "claude-haiku-4-5",
  "promptVersion": "cls-v4",
  "needsReviewCount": 3,
  "blockedCount": 1,
  "lastRunAt": "2026-09-30T00:25:30+09:00"
}
```

### 12.7 `POST /api/v1/classification/run` — MVP
본문 `RunClassificationBody` → `202 Job`. 상한 도달이면 `429 COST_CAP_REACHED`. **LLM 키가 없으면 오류가 아니라 규칙 분류기**(`model:"rule-mock"`, 비용 0, 확신도 낮게)로 돈다 — 예시 데이터·오프라인에서도 흐름을 확인할 수 있게(1.0.1). `503 LLM_UNAVAILABLE`은 **설정된** 제공자 호출이 실패했을 때만(작업은 `failed`, 대화는 다음 실행에서 다시). 민감 키워드·민감 프로젝트 대화와 간단한 질문 후보는 키가 있어도 규칙 분류기로 처리(LLM에 보내지 않음).
```json
{"scope": "needs_review"}
```

**분류 규칙 (1.1.0, 프롬프트 `cls-v2`)** — 실제 Claude 내보내기 29개를 `gemini-3.5-flash-lite`로 분류해 본 결과로 고친 것.
1. **다른 곳에서 이어감(handoff)**: 마지막 사용자 말이 "새 창에서 작업할꺼야", "md로 정리해줘, Claude Code에서 이어갈게", "맥북에서 이어 갈 수 있게 저장해줘", "작업 인계서 만들어줘", "토큰 다 써서 정리 파일 만들어줘"처럼 **이 일을 다른 창·도구·기기에서 계속하겠다**는 뜻이면 → `kind:"task"`, `resolution:"unresolved"`, 과제/분류에 `handoff = { label, target, conversationId, evidence, detectedBy }`. **상태 규칙: handoff는 완료가 아니다** — 상태는 규칙 엔진대로 `진행 중`(방치 기준을 넘으면 `멈춤`)이고 화면은 `handoff.label`(예: "Claude Code에서 이어감", 대상을 모르면 "다른 곳에서 이어감")을 함께 보여 준다. 이어간 곳의 대화가 들어와 같은 과제로 합쳐지거나 사용자가 완료로 바꾸면 그때 끝난다. LLM(`handoff:true`)과 규칙 분류기(문장 패턴) 중 하나라도 handoff면 적용(`detectedBy`: `llm`·`rule`·`both`).
2. **"내일 X 먼저 해보자"·"오늘은 여기까지"·"생각해볼께"·"이어서 하자"로 끝남** → `unresolved`(완료 아님). 모델이 `resolved`·간단한 질문으로 답해도 코어가 미해결 과제로 보정하고 근거 앞에 `[보정]`을 붙인다.
3. **확신도 보정**: 프롬프트에 기준표(0.9 / 0.75 / 0.6 / ≤0.4, 1.0 금지)를 주고, 코어가 0.05–0.95로 자른다. 보정했으면 ≤0.7, 규칙 신호와 결론이 다르면 낮춘다(끝 신호가 분명하면 ≤0.65), 메시지 2개 이하 과제는 ≤0.7. 모델이 낸 원래 값은 `classification.rawConfidence`.
4. **같은 과제 후보(합치기 제안)**: 모델 후보마다 이 대화(제목·요약·주제)와 후보 과제(제목·요약·주제·대화 제목)의 글자 2-gram 유사도를 재서 0.12 미만은 버리고, 제안 확신도 = min(모델 확신도, 0.45+유사도)×0.9. 한 실행에서 같은 과제가 3번 넘게 후보로 찍히면(최근 과제가 하나뿐일 때의 "허브" 현상) 유사도 0.35 미만은 모두 버린다. 프롬프트도 "목록에 과제가 하나뿐이라는 이유로 고르지 말 것, 기본은 빈 배열"로 좁혔다.
5. **분류 불가(blocked)**: 제공자 안전 필터(Google `PROHIBITED_CONTENT`·`SAFETY`, OpenAI content filter, Anthropic refusal 등)가 막으면 실패로 끝내거나 몰래 규칙 결과로 바꾸지 않고, 규칙 분류 결과로 상태를 채우되 `classification.state:"blocked"`, `blockedReason`, `blockedModel`을 남긴다. 그 과제는 "확인 필요"(`needsReview:true`)에 들어가고 `GET /tasks?classificationState=blocked`로 모아 볼 수 있다. **재시도 정책**: 같은 내용이면 어떤 `scope`로도 다시 보내지 않는다(같은 결과라 비용만 듦). 대화 내용이 바뀌었을 때, `force:true`일 때, 또는 `POST /tasks/:id/reclassify`일 때만 다시 시도한다. 작업 결과에는 `failed`가 아니라 분류된 것으로 센다.
6. **주제**: 분류기가 붙인 주제는 다시 분류하면 **교체**한다 — LLM 분류는 규칙 분류기가 붙였던 주제를 모두 떼고, 같은 출처가 같은 대화에서 붙였던 주제도 이번 결과로 바꾼다. 사용자가 붙인 주제·예시 데이터 주제는 그대로 둔다. 어디에도 안 붙은 분류기 주제 객체는 지운다.
7. **새 프로젝트 제안**: §9-2.
8. `force:true`의 의미: 바뀌지 않은 대화·분류 불가 대화도 다시 분류. 프롬프트가 바뀐 뒤 전체를 다시 돌릴 때 `{ "scope": "changed", "force": true }`. 1.2.0: 응답 캐시가 있으면 force여도 같은 입력은 저장된 답을 쓴다 — 모델을 꼭 새로 부르려면 `refreshCache:true`를 함께.

**재현성 (1.2.0, 프롬프트 `cls-v3`)** — 같은 모델·프롬프트·데이터로 두 PC에서 결과가 달랐던 문제(상태 2개·프로젝트 1개·주제 1개).
1. **원인**: Gemini 3.x에는 temperature를 보내지 않는다(Google 공식 Gemini 3 개발자 가이드: 기본 1.0 유지, 낮추면 반복·품질 저하 가능) → 매번 샘플링이 달라진다. 또 입력에 실행한 날짜, 최근 과제의 **요약**(분류할 때마다 바뀜), 같은 내용을 다시 분류할 때 **자기 이전 요약**이 들어가 다시 돌리면 입력부터 달라졌다.
2. **seed**: 지원하는 곳만 고정 seed(`20261010`)를 보낸다 — Google generateContent(`generationConfig.seed`)·xAI·Ollama. OpenAI 기본 경로(Responses API)와 Anthropic은 seed가 없다(AI SDK가 버림). temperature는 Gemini 3.x·OpenAI 추론 모델은 안 보내고, 나머지는 0. Google 문서상 seed도 "최선 노력"이지 보장이 아니다.
3. **입력 고정(`cls-v3`)**: 기준 날짜 = 이 대화의 마지막 활동일(KST), 최근 과제 창 = 그 날짜 ±30일·순서 고정, 최근 과제 목록은 대화 id + 제목만, 이전 요약은 이 대화의 **예전 내용**(내용 해시가 다른 것)을 분류한 결과만, 프로젝트 목록 순서 고정. 지시문은 `cls-v2`와 같다.
4. **응답 캐시**: 키 = sha256(제공자, 모델, 프롬프트 버전, 입력 해시[실제로 보내는 system+user 프롬프트 전문]). 성공한 응답만 저장(안전 차단·오류는 저장 안 함). 같은 키면 모델을 부르지 않고 저장된 답을 쓴다(`classification.cached:true`, 토큰·비용 0, `ClassificationStatus.today.cacheHits`). 캐시는 DB(`llm_cache` 테이블) 안에 있어 **DB를 복사한 다른 PC에서도 같은 답**이 나온다. 새로 부르기: `RunClassificationBody.refreshCache:true`(새 답으로 덮어씀), `POST /tasks/:id/reclassify`는 항상 새로 부른다. 끄기: 환경변수 `SUBBRAIN_LLM_CACHE=off`.
5. 남는 차이: 캐시가 없는 첫 실행은 여전히 모델 샘플링에 따라 다를 수 있다(특히 Gemini 3.x). 두 PC 결과를 맞추려면 한쪽에서 분류한 DB를 복사하거나 같은 캐시를 쓰게 한다.

### 12.10 로컬 세션 수집기 — Claude Code · Codex (1.5.0, 구현됨)
내 PC의 코딩 에이전트 세션 로그를 대화로 가져온다. `sourceAi`는 `claude-code` · `codex`, `captureMethod`는 `local_session`. **코어가 도는 PC의 파일만** 읽는다(사용자 Mac에서 코어를 돌려야 Mac 로그가 들어옴). 기본은 꺼져 있음(`enabled:false`) — 사용자가 켠다. 한 번 가져오기(backfill)는 감시를 켜지 않아도 된다.

| 메서드 · 경로 | 본문 → 응답 | 설명 |
|---|---|---|
| `GET /collector` | → `200 CollectorStatus` | 설정 + 소스별 파일 수·읽은 바이트·세션 수·마지막 검사/수집·backfill 상태·최근 오류 |
| `PUT /collector/config` | `PutCollectorConfigBody` → `200 CollectorStatus` | 부분 변경(보낸 키만). `enabled:true`면 바로 감시 시작, `false`면 멈춤. `root`의 `~`는 코어 PC 홈으로 |
| `POST /collector/backfill` | `CollectorRunBody` → `202 Job`(`collector_backfill`) | 처음 한 번 전체 읽기. 이미 읽은 파일은 저장된 위치부터(다시 돌려도 중복 없음) |
| `POST /collector/scan` | `CollectorRunBody` → `202 Job`(`collector_scan`) | 지금 한 번 검사(감시를 꺼 둔 경우 수동 갱신) |

```json
{
  "enabled": true,
  "sources": [
    {"sourceAi": "claude-code", "root": "~/.claude/projects", "enabled": true},
    {"sourceAi": "codex", "root": "~/.codex/sessions", "enabled": true}
  ]
}
```
```json
{
  "config": {
    "enabled": true,
    "sources": [
      {"sourceAi": "claude-code", "root": "~/.claude/projects", "enabled": true},
      {"sourceAi": "codex", "root": "~/.codex/sessions", "enabled": true}
    ],
    "pollIntervalSec": 20,
    "toolOutputMaxChars": 600,
    "toolInputMaxChars": 300,
    "excludeCwdPatterns": [],
    "classify": true
  },
  "watching": true,
  "redactedSecrets": 7,
  "sources": [
    {
      "sourceAi": "claude-code",
      "root": "/Users/me/.claude/projects",
      "rootExists": true,
      "enabled": true,
      "files": 21,
      "bytesTotal": 154109552,
      "bytesIngested": 154109552,
      "sessions": 17,
      "lastScanAt": "2026-09-30T08:29:40+09:00",
      "lastIngestAt": "2026-09-30T08:12:03+09:00",
      "backfill": {
        "state": "done",
        "startedAt": "2026-09-30T08:00:00+09:00",
        "finishedAt": "2026-09-30T08:00:41+09:00",
        "filesDone": 21,
        "filesTotal": 21,
        "jobId": "job_cb01"
      },
      "errors": []
    },
    {
      "sourceAi": "codex",
      "root": "/Users/me/.codex/sessions",
      "rootExists": true,
      "enabled": true,
      "files": 92,
      "bytesTotal": 1589240949,
      "bytesIngested": 1201333002,
      "sessions": 61,
      "lastScanAt": "2026-09-30T08:29:40+09:00",
      "lastIngestAt": "2026-09-30T08:29:12+09:00",
      "backfill": {
        "state": "running",
        "startedAt": "2026-09-30T08:00:00+09:00",
        "finishedAt": null,
        "filesDone": 70,
        "filesTotal": 92,
        "jobId": "job_cb02"
      },
      "errors": [
        {
          "file": "2026/07/14/rollout-…-01a0.jsonl",
          "message": "마지막 줄이 아직 덜 써짐 — 다음 검사에서 이어 읽음",
          "at": "2026-09-30T08:29:12+09:00"
        }
      ]
    }
  ]
}
```

**파일 형식** (실제 로그 표본 6개로 확인 — Claude Code 2.1.121–2.1.295, Codex cli 0.137–0.159; 표본에 없는 것은 [추정])
- Claude Code `~/.claude/projects/<cwd 슬러그>/<sessionId>.jsonl` — 한 줄 = 한 기록. `type:user|assistant`만 대화로 쓴다(`attachment`·`queue-operation`·`custom-title`·`ai-title`·`last-prompt`·`system`·`file-history-*` 등은 제목·메타에만). 제목 = 마지막 `custom-title` > `ai-title` > 첫 사용자 말. 어시스턴트 답은 블록마다 따로 기록되므로 **사람 말 사이의 한 턴을 메시지 하나로** 합친다(도구 결과 `tool_result`는 사람 말이 아님). `thinking`은 버림. `isMeta:true`, `<command-name>`·`<local-command-stdout>`·`<local-command-caveat>`·`<task-notification>`·`<system-reminder>`로 시작하는 사용자 기록은 사람 말이 아니라 뺀다. 하위 에이전트 `<sessionId>/subagents/agent-*.jsonl`(`isSidechain:true`)은 **부모 대화에 합친다** [추정: 표본에는 없음, 공개 자료 기준].
- Codex `~/.codex/sessions/YYYY/MM/DD/rollout-<시각>-<threadId>.jsonl` — `{timestamp, type, payload}`. 첫 줄 `session_meta`(cwd·cli_version·`session_id`=루트 세션·`parent_thread_id`·`thread_source`). 대화는 `response_item` `message`(role user/assistant; developer는 버림). 어시스턴트 `phase:"commentary"`(진행 보고)는 이어 붙이고 `final_answer`가 답. 사용자 메시지 안의 `<environment_context>`·`<app-context>`·`<in-app-browser-context>`·`<recommended_plugins>`·`<external_codex_apps_*>` 같은 **주입 블록은 지운다**(대화·분류·검색에 안 들어감). "# Files pasted/mentioned by the user" 머리는 `[첨부: 파일]`로. 하위 에이전트 파일(`session_id ≠ id`, `source.subagent`)은 **루트 세션 대화에 합친다**(`session_id` 기준, 시간순).
- **도구 호출**: Claude `tool_use`/`tool_result`, Codex `custom_tool_call`/`function_call`(+`_output`, `call_id`로 짝). 메시지 본문에 한 줄 요약만 남긴다: `[도구: Bash] ps -axm … → 722 MB …(출력 18,204자 중 600자)`. 입력은 `toolInputMaxChars`(300), 출력은 `toolOutputMaxChars`(600)로 자름, 이미지·base64·`encrypted_content`는 버림 → 1.59 GB Codex 로그가 대화 글 수십 MB로 줄어든다(§12.10 예상치).
- **프로젝트**: 대화 첫 메시지(`role:system`)에 `작업 폴더: <cwd> · Claude Code <버전>[ · 하위 에이전트 N개]`를 넣어 분류기가 프로젝트를 고를 때 보게 한다(`conversations.cwd`에도 저장). 같은 이름의 프로젝트(또는 동의어)가 있으면 그 프로젝트로, 없으면 새 프로젝트 제안(§9-2) 후보. 사람 말이 하나도 없는 세션(루트 없이 하위 에이전트만 있는 경우)은 대화로 만들지 않는다.
- **비밀정보**: 실제 로그에 API 키가 평문으로 있었다 → 읽는 즉시(**DB·볼트·LLM에 가기 전**) `redactSecrets`로 가린다. 1.5.0에서 패턴을 늘림(OpenAI `sk-proj-`·Anthropic `sk-ant-`·Google `AIza`·GitHub `ghp_`/`github_pat_`·Slack `xox?-`·AWS `AKIA`·JWT·`Bearer …`·`KEY=값` 꼴 환경변수·PEM 개인키). 가린 수는 `redactedSecrets`.

**감시 · 이어 읽기**: 파일마다 `(경로, inode, 크기, 읽은 위치, 파서 상태)`를 저장한다(파서 상태 = 이 파일에서 뽑은 줄인 메시지 + 짝을 기다리는 도구 호출 → 도구 결과가 다음 검사에 와도 맞춤). 늘어난 바이트만 줄 단위로 스트리밍해 읽고(파일 전체를 메모리에 올리지 않음 — 300 MB+ 파일 있음), 끝이 줄바꿈으로 안 끝난 마지막 줄은 다음 검사로 미룬다. inode가 바뀌었거나 크기가 줄었으면(교체·잘림) 처음부터 다시 읽되 메시지 단위 해시로 중복 없이 갱신한다. `fs.watch`(가능하면) + `pollIntervalSec`마다 검사. 세션 대화는 마지막 추가 후 10분 동안 조용하면 분류한다(답이 이어지는 중엔 분류 안 함).

**넘겨준 대화 ↔ 세션 연결(합치기 제안)**: "Claude Code에서 이어감"(`handoff`)으로 끝난 채팅 대화와 그 뒤 세션을 **같은 과제로 합치자는 제안**(`MergeSuggestion.kind:"handoff_session"`, §9)을 만든다 — 자동으로 합치지 않음. 후보 = 대화 결과 `moved`이거나 `handoff`가 있는 채팅 대화 중 세션 시작 60분 뒤 ~ 72시간 전에 끝난 것. 점수 = 0.45·시간(0분=1 … 72시간=0) + 0.30·min(1, 2×글 유사도(바이그램 Dice: 넘겨준 대화 제목+마지막 3개 ↔ 세션 제목+첫 사용자 말 3개)) + 0.25·프로젝트(같은 프로젝트 1, cwd 폴더 이름이 대화 제목·프로젝트 이름과 겹침 0.6). 0.55 이상만 제안, 넘겨준 대화마다 최고 1개. 대상이 `Claude Code`면 claude-code 세션만, `Codex`면 codex만, 그 밖엔 둘 다. Codex `thread_source:"chatgpt_handoff"`처럼 세션이 넘겨준 대화 id를 직접 적었으면 `explicitRef:true`, 점수 0.95(시간 창 무시). 이미 두 과제 사이에 제안이 있으면(거절 포함) 다시 만들지 않는다. **수락하면** 세션 대화가 그 과제의 주 대화로 들어오므로 과제 상태는 세션 쪽 결과로 다시 계산된다(§8 1.6.0 규칙: 세션이 아직 열려 있으면 `진행 중`/`멈춤`).
```json
{
  "id": "ms_hs01",
  "state": "pending",
  "confidence": 0.81,
  "kind": "handoff_session",
  "reason": "‘Claude Code에서 이어감’으로 끝난 대화 → 18분 뒤 같은 프로젝트 폴더(blog-renewal)의 Claude Code 세션",
  "tasks": [
    {
      "id": "task_20260915_01",
      "title": "노트 형식 정리",
      "status": "진행 중",
      "statusVisual": "run",
      "staleDays": null,
      "projectId": "prj_subbrain",
      "sourceAis": ["claude"]
    },
    {
      "id": "task_20260915_07",
      "title": "blog-renewal: md 노트 변환 스크립트",
      "status": "진행 중",
      "statusVisual": "run",
      "staleDays": null,
      "projectId": null,
      "sourceAis": ["claude-code"]
    }
  ],
  "suggestedPrimaryTaskId": "task_20260915_01",
  "createdAt": "2026-09-15T22:40:00+09:00",
  "decidedAt": null,
  "handoff": {
    "fromConversationId": "conv_claude_5e1d",
    "sessionConversationId": "conv_claude-code_28327da6",
    "target": "Claude Code",
    "gapMinutes": 18,
    "textSimilarity": 0.34,
    "projectMatch": "cwd_name",
    "explicitRef": false,
    "cwd": "/Users/me/dev/blog-renewal",
    "score": 0.81
  }
}
```

---

## 13. 설정 · 볼트

### 13.1 `GET /api/v1/settings` — MVP
설정 화면(§10.7): LLM 제공자·모델·키 설정 여부, 방치 기준 일수, 볼트 경로, 노트에 전체 원문 포함 여부, 요약 시각, 자동화 레벨(MVP는 표시만). 프로젝트·동의어는 `/projects`.
```json
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5",
    "baseUrl": null,
    "apiKeySet": true,
    "dailyCostCapUsd": 10,
    "redactSecrets": true,
    "sensitiveKeywords": ["건강", "연봉"],
    "sensitiveProjectIds": ["prj_health"]
  },
  "classification": {
    "lowConfidenceThreshold": 0.6,
    "promptVersion": "cls-v4",
    "condenseHead": 3,
    "condenseTail": 6,
    "condenseMiddleChars": 200
  },
  "thresholds": {"inProgressMaxDays": 3, "shortPauseMaxDays": 7, "staleMaxDays": 30, "longStaleMaxDays": 90},
  "ontology": {
    "enabled": false,
    "autoAcceptMin": 0.85,
    "suggestMin": 0.6,
    "enabledTypes": ["project", "task", "decision", "tool", "topic"],
    "showPersonNames": false
  },
  "vault": {
    "path": "/tmp/subbrain-mocks-bDgXou/vault",
    "name": "SubBrain",
    "includeFullTranscript": false,
    "rawLocation": "inside_vault",
    "rawHtmlRetentionDays": 30,
    "gitAutoCommit": false
  },
  "digest": {"time": "08:00", "osNotification": true, "writeDailyNote": true, "llmNarrative": true},
  "automation": {
    "level": "L3",
    "catchupIntervalHours": 3,
    "catchupMaxPerRun": 20,
    "catchupMinIntervalSec": 15
  },
  "server": {"port": 4545, "devOrigins": ["http://localhost:5173", "http://127.0.0.1:5173"]}
}
```

### 13.2 `PATCH /api/v1/settings` — MVP
본문 = 바꿀 부분만(깊은 병합, `UpdateSettingsBody`) → `200 Settings`. `thresholds`를 바꾸면 규칙 엔진이 즉시 전체 `staleDays`·상태를 다시 계산(LLM 호출 없음, §7.3). `vault.path`를 바꾸면 볼트 재생성 작업이 큐에 들어감. `llm.apiKeySet`은 무시.
```json
{"thresholds": {"inProgressMaxDays": 5}, "digest": {"time": "07:30"}}
```
- 검증: `inProgressMaxDays < shortPauseMaxDays < staleMaxDays < longStaleMaxDays` 아니면 `400`.

### 13.3 `PUT /api/v1/settings/llm-key` — MVP
본문 `{ "provider": "anthropic", "apiKey": "sk-ant-..." }` → `204`. 키는 로그·응답에 절대 남기지 않는다. **MVP 저장 위치(1.0.1)**: OS 키체인 대신 `<데이터 홈>/secrets.json`(권한 0600, DB·볼트 밖). 환경변수 `ANTHROPIC_API_KEY`·`OPENAI_API_KEY`·`GOOGLE_GENERATIVE_AI_API_KEY`·`XAI_API_KEY`가 있으면 파일보다 뒤 순위로 씀. OS 키체인 연동은 LATER. (키 지우기는 LATER — 삭제 엔드포인트는 MVP 밖. 그 전까지는 다른 키로 덮어쓰기)

### 13.4 `POST /api/v1/settings/llm-test` — MVP
본문 없음(선택 `{ "provider": "...", "model": "..." }`) → `200 LlmTestResponse`. 짧은 가짜 대화 1건을 분류해 본다(비용 표시). 제공자가 설정되지 않았으면 `400 VALIDATION_ERROR`, 키가 없거나 호출이 실패하면 `200 { ok:false, message }`(1.0.1). 1.1.0: 모델을 찾을 수 없다는 오류(404 등)면 `message`에 기본 모델 이름을 붙여 안내.

**기본 모델(1.1.0, `@subbrain/shared/constants`의 `DEFAULT_MODEL` — 설정에 모델이 없을 때 `GET /health`의 `llm.model`)** — 2026-10-02 각 제공자 공식 문서로 확인: Google `gemini-3.5-flash-lite`(gemini-2.5 계열은 기존 사용자만 쓸 수 있어 새 사용자는 404였음), OpenAI `gpt-6-luna`(gpt-5-mini는 2026-12-11 종료), xAI `grok-4.3`(grok-3-mini는 2026-05-15 종료), Anthropic `claude-haiku-4-5`(유지 — 종료 예정일 2026-10-15 이후 공지 주의), Ollama `llama3.1`. Gemini 3.x·GPT-5 이후·o 계열에는 temperature를 보내지 않는다(1.2.0: 대신 지원하는 제공자에 고정 seed, §12.7 재현성). 설정의 `llm.model`을 비우면 기본 모델을 쓴다.

**기본 가격표(1.3.0, `packages/core/src/classifier/pricing.ts`)** — 환경변수 `SUBBRAIN_PRICE_INPUT_PER_MTOK`·`SUBBRAIN_PRICE_OUTPUT_PER_MTOK`가 없을 때 쓰는 표준 요금(USD/100만 토큰, 짧은 프롬프트). 2026-10-11 공식 가격표에서 확인, 출처 URL은 코드 주석. **표에 없는 모델은 비용 `null`**(0이 아님) — 분류 기록·작업 `costUsd`·가져오기 미리보기 `estimate.costUsd` 모두.
| 모델 | 입력 | 출력 | 출처 |
|---|---:|---:|---|
| `gemini-3.8-flash` | 0.75 (2027-01-01부터 1.50) | 3.75 (2027-01-01부터 7.50) | ai.google.dev/gemini-api/docs/pricing |
| `gemini-3.5-flash-lite` (Google 기본) | 0.30 | 2.50 | 같음 |
| `gemini-3.1-flash-lite` | 0.25 | 1.50 | 같음 |
| `claude-haiku-4-5` (Anthropic 기본) | 1.00 | 5.00 | docs.claude.com/en/docs/about-claude/pricing |
| `gpt-6-luna` (OpenAI 기본) | 0.10 | 0.50 | platform.openai.com/docs/pricing |
| `grok-4.3` (xAI 기본) | 1.25 | 2.50 | docs.x.ai/docs/models |
| `llama3.1` (Ollama 기본) | 0 | 0 | 로컬 실행 |
환경변수는 모든 모델에 우선한다. 가격은 바뀌므로 코어를 업데이트하거나 환경변수로 덮어쓴다.
```json
{
  "ok": true,
  "provider": "anthropic",
  "model": "claude-haiku-4-5",
  "latencyMs": 812,
  "message": "연결됐어요. 시험 분류 1건 성공."
}
```

### 13.5 `POST /api/v1/vault/regenerate` · `GET /api/v1/vault/conflicts` — MVP
- regenerate: 볼트 전체 다시 만들기(`regenerate-vault` CLI와 같음, §5.4②④) → `202 Job`(`type:"vault_regenerate"`).
- conflicts: Obsidian에서 직접 고친 파일(해시 불일치 → `.subbrain/conflicts/`에 백업 후 덮어씀, §5.4④) 목록. 상단 배너 "볼트에서 직접 고친 파일 N개가 있습니다".
```json
{
  "items": [
    {
      "path": "tasks/이사업체-견적-비교표.md",
      "entityType": "task",
      "entityId": "task_20260914_01",
      "detectedAt": "2026-09-30T08:30:00+09:00",
      "backupPath": ".subbrain/conflicts/2026-09-30T08-30-00/tasks/이사업체-견적-비교표.md"
    }
  ],
  "page": {"limit": 50, "nextCursor": null, "hasMore": false, "total": 1}
}
```

---

## 14. 나중(LATER) 엔드포인트 — MVP 밖

> 경로만 예약한다. MVP 코어는 이 경로에 `501 NOT_IMPLEMENTED`를 돌려준다. 웹은 목을 만들 필요 없음(제안 카드·승인 칸 모양은 §10.2 예시 참고).

| 단계 | 메서드 · 경로 | 용도 | 근거 |
|---|---|---|---|
| 1.5 | `GET /ontology` · `POST /ontology/events/:eventId/undo` (1.5.0) | 온톨로지 모드 화면 데이터 · 액션 되돌리기 — **§14.2** | §8, §10.11 |
| 1.5 | `GET /suggestions?kind=object\|link\|merge&minConfidence=` | 온톨로지 제안 검토 대기열 | §8.6, §10.11 |
| 1.5 | `POST /suggestions/:id/accept` · `/reject` · `POST /suggestions/bulk-accept {minConfidence:0.8}` | 확정/거절, "확신도 0.8 이상 모두 확정" | §10.6 |
| 1.5 | `GET /objects?type=&q=` · `GET /objects/:id` | 객체 목록·상세 패널(관계 목록·출처·스파크라인) | §10.11 |
| 1.5 | `POST /objects/:id/merge {intoId}` · `/split` · `PATCH /objects/:id {name}` · `POST /links/:id/end` | 객체 액션(합치기·나누기·이름 바꾸기·관계 끊기) | §8.1 액션, §8.5 |
| 1.5 | `GET /tasks/:id/why-stalled` · `GET /objects/:id/impact` · `GET /similar?text=` · `GET /graph/path?from=&to=` | 막힘 사슬, 영향 분석, 비슷한 옛 작업, 경로 강조 | §8.7, §10.8 |
| 2 | `GET /timeline?from=&to=&projectId=&granularity=` · `GET /events` | 타임라인 화면(날짜별 묶음, 히트맵, 두 기간 비교) | §10.7 |
| 2 | `GET /graph?at=YYYY-MM-DD` | 시점 되감기 | §10.8 |
| 2 | `GET /stream` (SSE) | 가져오기·작업 진행률, 새 대화 알림 푸시 | — |
| 2 | MCP 서버(별도 프로세스) | 이 API를 부르는 얇은 클라이언트: `get_unfinished`=`GET /tasks`, `get_timeline`=`GET /timeline`, `search_past_work`=`GET /search`, `get_task`=`GET /tasks/:id`, `get_resume_prompt`=`GET /tasks/:id/resume-prompt`. 삭제 도구 없음 | §5.4⑤, §8.8 |
| 3 | `POST /pairing` · `POST /pairing/complete` · `GET /pairing/clients` · `POST /pairing/clients/:tokenId/rotate`·`/revoke` · `GET /session` | 페어링 토큰 발급·교체·폐기(확장·MCP) — **§14.3** | §5.4①-A, §12.1 |
| 3 | `POST /ingest/snapshot` · `POST /ingest/replay` · `POST /ingest/catchup/diff` | 확장 스냅샷 수신·오프라인 재전송·놓친 대화 비교 — **§14.3** | §5.4①-A |
| 3 | `GET /sync-state` · `POST /sync-state/:ai/health` | 어댑터 상태 보고·조회 | §6.3 `sync_state`, §9.6 |
| 3 | ~~`POST /mcp/log-task` · `POST /mcp/update-task-status`~~ → **1.8.0 구현**(§14.5) | — | §5.4⑤ |
| 5 | `GET /wiki` · `GET /wiki/:id` · `PATCH /wiki/:id {draft:false}` | 위키 검토 | §5.4⑦, §10.7 |
| 6 | `GET /deletion-batches/:id` · `POST /deletion-batches/:id/approve` · `/postpone` · `PATCH /deletion-batches/:id/items/:itemId {selected}` · `POST /archive/undo` | 하루 한 번 승인·채팅창 정리 — 아래 [잠정] 모양 | §10.6, §11 |
| 6 | 판매용 빌드: `approve` 본문에 `confirmPhrase:"32개 삭제"` 필수 | 확인 문구 승인 | §9.2.4 |
| LATER | 모든 `DELETE` (과제·대화·프로젝트·객체 완전 삭제, 사람 객체 이름 가림, API 키 삭제) | 데이터 삭제 | 사용자 지시: 삭제는 MVP 밖, §8.10, §12.2 |

#### 14.2 온톨로지 API [1.5.0 계약 · **1.7.0 구현**]
설계서 v1.1 8장. 모든 응답은 기본으로 `accepted`만(제안은 `suggested`로 따로 표시), 쓰기 액션은 전부 `events`에 남고 `POST /ontology/events/:eventId/undo`로 되돌린다. MCP는 읽기만(§8.8).

| 메서드 · 경로 | 본문/쿼리 → 응답 | 비고 |
|---|---|---|
| `GET /ontology` | `OntologyQuery` → `OntologyGraphResponse` | 온톨로지 모드 화면 한 번에(객체·관계·대기 제안). `GET /graph?mode=ontology`는 계속 예약(같은 데이터를 `GraphResponse` 모양으로 — 홈 그래프와 합칠 때) |
| `GET /objects` | `ListObjectsQuery` → `ListObjectsResponse` | 검색(이름+별칭, 정규화 비교) |
| `GET /objects/:id` | → `ObjectDetail` | 상세 패널: 관계(방향·상대)·출처 50·주별 언급·관련 과제. 합쳐진 객체 id면 `308` 없이 합친 대상 상세 + `object.mergedInto` |
| `PATCH /objects/:id` | `PatchObjectBody` → `ObjectDetail` | 이름·별칭·속성(project/task 객체 이름은 원본 테이블 이름을 바꾸지 않음 → `409`) |
| `POST /objects/:id/merge` | `MergeObjectBody` → `MergeObjectResponse` | 별칭·관계·출처를 `intoId`로. 타입 다르면 `409` |
| `POST /objects/:id/split` | `SplitObjectBody` → `SplitObjectResponse` | |
| `POST /links/:id/end` | `EndLinkBody` → `EndLinkResponse` | 관계 끊기(삭제 아님, `endedAt`) |
| `POST /ontology/events/:eventId/undo` | → `UndoOntologyResponse` | 같은 대상에 뒤 액션이 있으면 `409` |
| `GET /suggestions` | `ListSuggestionsQuery` → `ListSuggestionsResponse` | 대기 제안(확신도 높은 순) |
| `POST /suggestions/:id/accept` | → `AcceptSuggestionResponse` | 제안 상태 객체도 함께 확정 |
| `POST /suggestions/:id/reject` | `RejectSuggestionBody` → `RejectSuggestionResponse` | 거절 기억(같은 내용 다시 제안 안 함). "나중에"는 서버 호출 없음(화면에서만) |
| `POST /suggestions/bulk-accept` | `BulkAcceptSuggestionsBody` → `BulkAcceptSuggestionsResponse` | 처음 보는 사람·`supersedes`·합치기는 빠짐(`skipped: protected`) |
| `GET /tasks/:id/why-stalled` | → `WhyStalledResponse` | `blocked_by` 재귀 최대 5단계(8.4 CTE), 끝 원인 분류, 풀린 막힘·확인 필요 막힘 따로 |
| `GET /objects/:id/impact` | → `ImpactResponse` | `affects`·`derived_from` 거꾸로 |
| `GET /similar?text=&limit=` | → `SimilarResponse` | 겹치는 객체 + 글 유사도 |
| `GET /graph/path?from=&to=&maxDepth=` | → `GraphPathResponse` | 확정 관계 먼저, 없으면 제안 포함(`usedSuggested`) |
| `GET /ontology/status` (1.7.0) | → `OntologyStatusResponse` | 타입별 객체 수·관계 수·대기 제안·LLM 추출한 대화/대상 대화·프롬프트 버전·누적 비용·`llmConfigured` |
| `POST /ontology/extract` (1.7.0) | `OntologyExtractBody` → `202 Job`(`extract_ontology`) | 규칙 추출(전 과제) + LLM 추출(`scope` `changed` 기본 = 아직 안 뽑았거나 내용이 바뀐 대화, `all` = 다시). `llm:false`면 규칙만. `maxCostUsd`·하루 상한 넘으면 `deferred` |

**1.7.0 구현 메모**
- **언제 뽑나**: 규칙 추출은 **분류가 끝날 때마다 자동**(키 없어도, 비용 0). LLM 추출(프롬프트 `ont-v1`)은 비용 때문에 `POST /ontology/extract`(또는 CLI `subbrain ontology extract`)로만 — 설계서 8.6의 "분류 호출에 함께"는 분류 프롬프트(cls-v4) 재현성·캐시를 깨지 않으려고 따로 호출로 시작(§15-37).
- **규칙 추출**: 과제·프로젝트 객체(원본 행에서, 늘 확정) + `part_of`(프로젝트가 바뀌면 예전 것은 `endedAt`) · 분류 주제 → `related_to` · 분류 결정 → `decided` · 과제 사이 막힘(`task_links`) → `blocked_by` · 도구 사전(한/영 표기 약 50개) → `uses`(사용자가 2번+ 또는 사용자+답 = 0.85~0.9 확정, 사용자 1번 = 0.75 제안, 답에만 3번+ = 0.62 제안, 답에만 1–2번 = 버림) · 과제가 `완료`되면 그 과제의 `blocked_by`에 `endedAt`.
- **LLM 추출**: 줄인 대화(메시지 앞 `#번호`, 비밀 가림) + 분류 요약·결정·열린 질문 + 후보 객체(이 대화 글에 이름이 나오는 확정 객체·같은 프로젝트 과제, 최대 50, 이 과제 = `TASK`) → 설계서 8.6 스키마(Zod 검증, 깨진 응답은 버림). 새 `project`·`task` 객체와 과제→프로젝트 `part_of`는 버림(규칙 몫). 허용 안 되는 쌍은 `related_to`로. 꺼진 타입(`object_types.enabled=0`: 기본 사람·자료·장소·조직)은 버림. 간단한 질문·민감 프로젝트/키워드 대화는 보내지 않음. 같은 대화를 같은 내용·같은 프롬프트로 다시 보내지 않음(`ontology_runs`).
- **확신도 기준(8.6)**: ≥ 0.85 자동 확정 · 0.6–0.85 제안(`ontology_suggestions`) · < 0.6 버림. 처음 보는 사람·`supersedes`·합치기는 늘 제안. 끝 객체가 제안이면 관계도 제안. 다른 대화에서 다시 나오면 +0.1(최대 0.95)·기준 넘으면 자동 확정. 이름이 비슷한 같은 타입 객체(2-gram Dice ≥ 0.75)는 새로 만들고 **합치기 제안**.
- **엔터티 해소**: 같은 타입에서 `norm_name`(소문자·NFKC·공백/기호 제거) 또는 별칭이 같으면 같은 객체, 합쳐진 객체는 `mergedInto`를 따라감.
- **출처·언급**: 출처는 (대상, 대화, 규칙/LLM) 하나로 덮어씀 → 같은 대화를 다시 분류해도 늘지 않음. `mentionCount` = 서로 다른 대화 수.
- **거절 기억**: 거절한 객체(타입+이름)·관계(타입+양끝)·합치기 쌍은 다시 만들지 않음(되돌리기로 풀림).
- **되돌리기**: 모든 쓰기(확정·거절·고치기·합치기·나누기·끊기)는 바뀌기 전 행을 `ontology_events`에 저장 → undo가 그대로 되돌림. 같은 대상에 뒤 액션이 있으면 `409`.
- **오류**: 없는 객체·관계·제안 `404` · 이미 처리한 제안 `409` · 다른 타입 합치기 `409` · project/task 객체 이름 고치기 `409`(원본에서) · 합쳐진 객체 id로 상세를 부르면 합친 대상 상세.
- **"왜 멈췄나"**: 과제 객체에서 확정·안 끝난 `blocked_by`를 재귀 CTE로 최대 5단계(순환 방지). 사슬 끝 = 원인(`person`→`waiting_person`, `decision`→`undecided`, `task`→`blocked_task`, `organization`→`external`, 그 밖 `other`). 설명은 규칙 문장("‘디자이너 윤서’(사람 답 기다림) 때문에 14일째 멈춤"). `TaskDetail.whyStalled`(1.0 모양)도 사슬이 있으면 채움.
- **영향**: `affects`(나감) · `derived_from`·`uses`·`decided`(들어옴)를 3단계까지. `supersededBy` = 이 객체를 대체한 확정 `supersedes`.
- **비슷한 과제**: 0.6×글 유사도(제목+요약 2-gram) + 0.4×겹치는 객체 비율(글에 이름·별칭이 나온 객체 중 그 과제와 이어진 것).
- **요약 카드**: `DigestResponse.ontology` = `{newlyLinkedCount(어제 이후 자동 확정 관계), pendingCount, items(상위 5)}`, 제안·새 관계가 없으면 `null`.
- **예시 데이터(4545)**: 시드가 이 표의 웹 시안 그림(객체 68·관계 116·제안 9)을 DB에 넣는다 — 출처 대화는 제목이 같은 예시 대화(없으면 이어진 과제의 최근 대화). 관계 id는 `lnk_<숫자>`, 제안 id는 `osg_<6자>`(시안의 `l01`·`s1`과 다름).

예시는 웹 시안 목 `web/src/mocks/ontology.json`을 **계약 모양으로 바꾼 것**(`mocks/json/ontologyGraph.json` · `objectDetail` · `whyStalled` · `impact` · `similar` · `graphPath` · `suggestionsList` · `acceptSuggestion` · `bulkAcceptSuggestions`). 웹 목 → 계약 차이:

| 웹 목(ontology.json) | 계약 | 이유 |
|---|---|---|
| `src: [AI, 날짜, 대화 제목, 발췌][]` (튜플) | `evidencePreview: OntologyEvidence[]` (`conversationId`·`sourceAi`·`conversationTitle`·`messageSeq`·`excerpt`·`at`·`confidence`·`model`) | 대화로 이동하려면 id가 필요, 튜플은 확장 불가. 전체는 `GET /objects/:id` `evidence` |
| `first` · `last` (`YYYY-MM-DD`) | `firstSeenAt` · `lastSeenAt` (ISO 시각) | 다른 API와 같은 시각 형식 |
| `mentions` | `mentionCount` | 설계서 8.4 이름 |
| `props: Record<string,string>` | `properties: Record<string, string\|number\|boolean>` | 8.6 추출 스키마(숫자·참거짓 속성) |
| `ref: "task_…"` (문자열) | `ref: { table: 'projects'\|'tasks'\|'topics', id }` | 접두어 추측 대신 명시 |
| `project` | `projectObjectId` | 객체 id임을 이름에 |
| `color` | `colorHex` (project 객체만) | 다른 API와 같은 이름 |
| `visual` | `statusVisual` (task 객체만, `StatusVisual`) | 과제 목록과 같은 토큰 |
| `status`·`confidence` 생략 = accepted·0.9 | 항상 있음. `status`에 `merged` 추가, `mergedInto` | 기본값 추측 없이 |
| — | `origin`(llm·rule·user) | 사용자 수정·규칙 관계 구분 |
| link `conf` · `n` · `ended`(날짜) · `ev`(튜플) | `confidence` · `mentionCount` · `endedAt`(ISO) · `evidencePreview` | 같은 이유 |
| link `origin` 일부만 | 항상 있음(생략 = llm) | |
| — | link `validFrom` · `firstSeenAt` · `lastSeenAt` · `properties` | 8.3 유효 기간 |
| suggestion `{kind:'link', link}` | `OntologySuggestion` + `linkId`(+ 읽기 쉬운 `text`·`src`·`dst`·`evidence`) | 요약 카드(§10.2)와 같은 모양 하나로 |
| suggestion `{kind:'merge', a, b}` | `merge: {keepId, mergeId}` | 어느 쪽이 남는지 명시 |
| suggestion `note` | `note` + `reason` 코드 | 화면 문구는 코드로 고르기 |
| 제안 결정 `later`(메모리) | 서버 호출 없음 | 그대로 |
| `kind:'object'` 제안 없음 | `kind:'object'` + `objectId` 지원 | 처음 보는 사람 등 |

#### 14.3 확장 프로그램 수집 API [1.5.0 계약 · **1.9.0 구현**]
설계서 5.4①-A · 6.3 `sync_state` · 12.4. **이 경로들만** 페어링 토큰이 필요하다(나머지 API는 지금처럼 같은 origin·로컬).

**인증 · 페어링**
1. 웹앱(같은 origin)에서 `POST /pairing` `StartPairingBody` → `StartPairingResponse`(6자리 `code`, 5분, 한 번만). 화면에 코드 표시.
2. 확장 팝업에 코드 입력 → 확장이 `POST /pairing/complete` `CompletePairingBody`. `kind:'extension'`이면 요청 `Origin`이 `chrome-extension://<extensionId>`와 같아야 함(아니면 `403 FORBIDDEN_ORIGIN`). 코드 5번 틀리면 그 페어링 폐기. → `CompletePairingResponse`: `token`(`sbt_` + 32바이트 base64url)은 **이 응답에서 한 번만** 보인다. 코어는 sha256만 저장.
3. 이후 `Authorization: Bearer <token>`. 없거나 틀리면 `401 UNAUTHORIZED`, 폐기된 토큰도 `401`(`details.reason:"revoked"`). 확장 토큰은 매 요청 Origin 검사. 확장은 `chrome.storage.local`(sync 아님)에 저장.
4. 교체: `POST /pairing/clients/:tokenId/rotate`(그 토큰으로) → `RotateTokenResponse`, 옛 토큰은 300초 더 유효. 웹: `GET /pairing/clients` → `ListPairedClientsResponse`, `POST /pairing/clients/:tokenId/revoke` → `PairedClient`. `GET /session` → `SessionResponse`.
- 범위: extension·collector=`ingest`, mcp=`read`(+`mcp_write`는 설정에서 켤 때만). 범위 밖 경로는 `403 FORBIDDEN_ORIGIN`(`details.reason:"scope"`).
```json
{"pairingId": "pair_7Q2M", "code": "418 207", "expiresAt": "2026-09-30T08:35:00+09:00", "kind": "extension"}
```
```json
{
  "token": "sbt_EXAMPLE_ONLY_not_a_real_token_000000",
  "client": {
    "tokenId": "pat_k3f9",
    "kind": "extension",
    "name": "SubBrain Chrome",
    "extensionId": "abcdefghijklmnopabcdefghijklmnop",
    "scopes": ["ingest"],
    "createdAt": "2026-09-30T08:31:10+09:00",
    "lastUsedAt": null,
    "rotatedAt": null,
    "revokedAt": null
  }
}
```

**1.9.0 구현 메모**
- 인증 모델(§15-39): 토큰이 **꼭** 필요한 곳 = `/ingest/*` · `POST /sync-state/:ai/health` · `rotate`. 토큰 없는 localhost 웹앱 요청은 지금처럼 `web` 세션(모든 범위). 토큰을 보내면 어디서든 검사(틀림 401, 범위 밖 403 `reason:"scope"`, 확장 토큰은 매 요청 `Origin = chrome-extension://<extensionId>` 아니면 403 `reason:"origin"`). `chrome-extension://` Origin은 수집·페어링·`/session`·`/sync-state` 경로에서만 CORS 허용, 토큰 없이는 `/pairing/complete`·`/health`만.
- `POST /pairing`(웹만, 확장 Origin이면 403) `StartPairingBody.allowWrite`(1.9.0, `kind:'mcp'`만) → 범위 `read`+`mcp_write`. 틀린 코드는 열린 페어링 **모두**의 시도 수를 올림(어느 것인지 모르므로) — 5번이면 폐기. 코드·토큰 모두 sha256만 저장.
- 범위: `ingest` = `/ingest/*`·`/sync-state(…/health)`; `read` = 모든 GET(페어링 목록 제외); `mcp_write` = `POST /mcp/*`. 모든 토큰 = `/session`·자기 `rotate`.
- 속도 제한: `/ingest/*` 토큰당 분당 60회(`SUBBRAIN_INGEST_RATE_PER_MIN`), 넘으면 `429` + `Retry-After`. 메모리 계산(재시작하면 비움).
- 분류: 완성 스냅샷은 `SUBBRAIN_INGEST_DEBOUNCE_MS`(기본 120000) 조용해지면 분류(`debounced`; 0이면 바로 `queued`). 부분 스냅샷은 같은 시간 동안 조각이 없으면 완성으로 보고 분류. 타이머는 메모리 — 재시작으로 놓친 부분 대화는 다음 따라잡기에서 `updated`로 다시 요청.
- 비밀정보는 저장 전에 `redactSecrets`(해시 검증은 받은 원문 기준). `append`의 앞부분 원문은 프로세스 메모리에 둠 — 재시작 뒤 가려진 메시지가 있는 대화의 append는 `BASE_MISMATCH`가 날 수 있고 확장은 `full`로 다시 보냄.
- `stale` = 서버가 가진 `capturedAt`보다 오래되고 메시지가 더 적음. 같은 내용이 다른 키로 와도(`unchanged`) `duplicate`.
- 따라잡기: `retry` = 요청했는데 1시간 넘게 스냅샷이 안 옴, 요청 뒤 1시간 안이면 다시 내지 않음. `unknown_time`은 하루 한 번. `cursor`는 불투명(base64url), `endOfList:true`일 때 지금까지 본 가장 새 `updatedAt`을 소스 커서로 저장 → 다음 diff의 `stopBefore`.
- DB 스키마 v8: `pairings` · `client_tokens` · `ingest_keys` · `catchup_items` + `conversations.ingest_hash/ingest_captured_at/ingest_partial/service_updated_at` · `messages.external_id` · `sync_state` 열 7개.
- MCP Streamable HTTP(`subbrain mcp --http`)는 이제 `kind:'mcp'` 토큰이 필요(없으면 `401` + `WWW-Authenticate: Bearer`). MCP 서버가 받은 토큰을 코어로 그대로 넘김 → 코어가 범위 검사. `mcp_write`가 없는 토큰이면 쓰기 도구를 숨김. 토큰 받기: `subbrain mcp pair [--write]`(웹 세션으로 코드 발급+완료, 토큰을 한 번 출력). STDIO는 그대로(토큰 없음 — 데스크톱 앱이 직접 띄우는 자식 프로세스). 시험용 `--no-auth`.

**1.9.1 보정**
- `contentHash`·`baseContentHash`·`Idempotency-Key`의 해시는 **맨 hex가 정식**(64자 소문자). `sha256:` 접두어를 붙여도 받아서 떼고 저장·응답은 맨 hex.
- Origin 규칙(확장 토큰): **GET/HEAD에 Origin이 없으면 허용**(호스트 권한이 있는 Chrome 확장은 GET에 Origin을 안 보냄). Origin이 있는데 다르면 403, POST 등 쓰기 메서드는 Origin 필수. 근거: 웹 페이지가 브라우저에서 보내는 요청에는 GET이라도 교차 출처면 Origin이 붙거나(fetch CORS) 토큰을 넣을 수 없고(헤더 설정 불가), 토큰 자체가 비밀이라 Origin 없는 GET은 토큰을 가진 쪽(확장·로컬 프로세스)만 할 수 있음. 읽기라 상태를 바꾸지 않고, 범위 검사(`ingest` 토큰은 `/sync-state`·`/session`만 GET 가능)는 그대로.
- 따라잡기 속도: `captureMethod:"extension_catchup"` 스냅샷은 토큰당 분당 6개(`rate.maxFetchPerMinute`, `SUBBRAIN_CATCHUP_FETCH_PER_MIN`) — 넘으면 `429` + `Retry-After`. 실시간(`extension_live`)·`replay`는 이 한도와 따로(전체 분당 60회는 공통).
- 시각: 확장이 보낸 시각(`capturedAt`·`serviceUpdatedAt`·메시지 `createdAt`·catch-up `updatedAt`·health `at`)은 어떤 오프셋이든 받고 **+09:00으로 바꿔 저장·응답**.
- `McpWriteEvent.client` `{tokenId,name,kind}` — HTTP MCP 토큰으로 한 쓰기면 그 기기, STDIO·웹이면 `null`.
- 개발 전용 CLI `subbrain dev purge-conversation <id|sourceId>… --dev`(HTTP 삭제 API는 계속 없음).

**1.10.0 추가 (Grok Bot · 수집기 · AI 검색)**
- `SourceAi`에 `'grokbot'`(라벨 "Grok Bot", 대화 URL 없음). 가져오기 형식 `detectedFormat:"grokbot_json"` = Claude `conversations.json`과 같은 모양. 업로드·`POST /imports {path, sourceAi:"grokbot"}`·CLI `import <파일> --source grokbot`, 또는 파일 이름에 `grokbot`/`grok-bot`이 있으면 자동. 대화 id `conv_grokbot_*` — 같은 uuid의 Claude 대화와 겹치지 않음.
- `CollectorRunBody.classify?`(false면 이번 실행으로 바뀐 세션을 분류하지 않음) · `dryRun?`(true면 실행하지 않고 `200 CollectorEstimate`). 백필·검사 작업이 도는 동안 감시기는 쉼(전엔 감시기가 같은 파일을 먼저 읽어 `config.classify`로 분류 → `classify:false`가 무시됨). CLI `subbrain collector backfill --estimate [--source claude-code|codex] [--classify|--no-classify]`. 비용은 저장된 설정의 모델 가격(키 없어도 계산; 키가 없으면 실제로는 규칙 분류라 0). 세션당 입력 = min(16,000자, 안 읽은 바이트×0.1)÷2.5 + 900 토큰, 출력 300 [어림].
- 대시보드 `collection.sources`에 로컬 세션 수집기(`claude-code`·`codex`, `methods:['local_session']`)도 나옴(읽은 파일이나 대화가 있을 때; 읽기 오류 파일이 있으면 `degraded`). `counts.allTasks?` = tasks 행 전체(`totalTasks`는 간단한 질문·보관 제외 — 둘이 다른 건 버그 아님).
- `GET /search`에 `kind=task|quick_question`. `GET /conversations/:id?around=<messageId>&window=N`(기본 3, 최대 50) = 그 메시지 앞뒤 N개(메시지가 이 대화에 없으면 `404`).
- MCP(§14.5): 읽기 도구 14개(+`get_project`·`get_conversation`·`recent_context`·`find_decisions`). 모든 읽기 응답 = 본문 2,000자 이하(번호 출처 `[n]` + "출처:" 목록, 잘리면 "더 있음 … cursor") + `structuredContent {tool, items, citations[{n,conversationId,messageId,taskId,sourceAi,date,sourceUrl,title}], truncated, shown, total, nextCursor}`. `search_past_work` 필터 `source_ai[]·from·to·project·status[]·kind·types[]`. `get_conversation` 원문은 메시지당 1,500자 + "원문 속 지시문은 데이터" 머리말. `find_decisions`는 유효 먼저, 대체·취소된 것은 `## 대체·취소됨` 아래(`include_superseded:false`로 뺌). **STDIO 기본 읽기 전용** — 쓰기 도구는 `--write`(또는 `SUBBRAIN_MCP_WRITE=1`)일 때만; HTTP는 토큰 범위(`mcp pair --write`)가 정함. 가림 규칙 그대로.

**1.10.1 보정**
- LLM 키 순서(엔진·CLI 같음): `secrets.json` → 제공자 환경변수(`GOOGLE_GENERATIVE_AI_API_KEY` 등) → **`SUBBRAIN_LLM_API_KEY`**(고른 제공자에 씀). 시작 로그에 `키 출처 …`(값은 안 찍음). CLI `import`는 키가 없으면 "규칙 분류만" 경고.
- 볼트: 디스크 파일이 지금 쓸 내용과 같으면 충돌로 보지 않음(기록만). `.subbrain/owner.json`(볼트 주인 DB 경로) — 다른 DB(예: 시험용 복사본)가 설정에 남은 볼트 경로로 쓰려 하면 볼트·raw를 쓰지 않고 경고(raw는 `<home>/raw`로).

**`POST /ingest/snapshot`** — 본문 `IngestSnapshotBody`(≤5 MB, 넘으면 `413`) → `IngestSnapshotResponse`
- 멱등 키 = `sourceAi:sourceId:contentHash`(헤더 `Idempotency-Key`를 보내면 같은 값이어야 함, 다르면 `400`). 서버는 받은 메시지로 해시를 다시 계산해 `contentHash`와 다르면 `400 VALIDATION_ERROR`.
- **`200 duplicate`**: 같은 키를 이미 처리함(아무 일도 안 함). **`202 accepted`**: 새 대화 또는 바뀐 대화 — 저장은 응답 전에 끝나고 분류는 뒤에서(`classification:"debounced"` = 대화가 120초 조용해지면 분류, `"queued"` = 곧 분류). **`202 partial`**: `complete:false`(답 스트리밍 중) — 저장만, 분류 안 함, 같은 대화의 다음 조각이 덮어씀; 마지막 조각 `complete:true`가 오거나 120초 동안 조각이 없으면 완성으로 봄. **`200 stale`**: 서버가 가진 것보다 오래된 `capturedAt`이고 메시지가 더 적음(오프라인 재전송이 늦게 도착) — 무시.
- `mode:"append"`: `appendFromSeq` 이후 메시지만. `baseContentHash`가 서버의 지금 해시와 다르면 `409 CONFLICT`(`details.reason:"BASE_MISMATCH"`, `expectedContentHash`) → 확장은 `full`로 다시 보냄. 메시지는 `externalId`(없으면 `seq`)로 맞춰 갱신, 서비스에서 고친 메시지는 덮어씀.
- 속도 제한: 토큰당 분당 60회(`429 RATE_LIMITED`, `Retry-After` 헤더).
```json
{
  "sourceAi": "chatgpt",
  "sourceId": "68f2a91c-1d2e-4b7a-9c3f-0a1b2c3d4e5f",
  "url": "https://chatgpt.com/c/68f2a91c-1d2e-4b7a-9c3f-0a1b2c3d4e5f",
  "title": "메인 카피 후보 뽑기",
  "capturedAt": "2026-09-30T08:20:41+09:00",
  "serviceUpdatedAt": "2026-09-30T08:20:30+09:00",
  "captureMethod": "extension_live",
  "mode": "append",
  "appendFromSeq": 6,
  "baseContentHash": "9b1c…(이전 응답 contentHash)",
  "messages": [
    {
      "seq": 6,
      "externalId": "msg_aa01",
      "role": "user",
      "contentMd": "후보 B를 조금 더 짧게 해 줘",
      "createdAt": "2026-09-30T08:20:02+09:00"
    },
    {
      "seq": 7,
      "externalId": "msg_aa02",
      "role": "assistant",
      "contentMd": "좋아요. 12자 안으로 줄인 안: …",
      "createdAt": "2026-09-30T08:20:30+09:00"
    }
  ],
  "contentHash": "4e07…(전체 8개 메시지 기준)",
  "complete": true,
  "adapter": {"name": "chatgpt-dom", "version": "0.3.0", "domVersion": "2026-09"},
  "project": null
}
```
```json
{
  "status": "accepted",
  "idempotencyKey": "chatgpt:68f2a91c-1d2e-4b7a-9c3f-0a1b2c3d4e5f:4e07…",
  "conversationId": "conv_chatgpt_68f2a91c",
  "taskId": "task_20260830_01",
  "contentHash": "4e07…",
  "messageCount": 8,
  "classification": "debounced",
  "receivedAt": "2026-09-30T08:20:41+09:00"
}
```

**오프라인 버퍼 재전송** — 코어가 꺼져 있으면 확장이 IndexedDB에 쌓아 두었다가(대화당 마지막 것만 남겨도 됨) 다시 연결되면 **오래된 것부터** `POST /ingest/replay` `IngestReplayBody`(≤20개) → `200 IngestReplayResponse`(항목별 성공·오류; 순서 = 보낸 순서). `capturedAt`은 원래 시각 그대로. 같은 키는 `duplicate`, 늦게 온 옛 것은 `stale`이라 몇 번을 다시 보내도 안전. `BASE_MISMATCH`가 난 항목은 다음 정상 수집 때 `full`로.
```json
{
  "results": [
    {
      "index": 0,
      "ok": true,
      "result": {
        "status": "stale",
        "idempotencyKey": "chatgpt:68f2a91c-1d2e-4b7a-9c3f-0a1b2c3d4e5f:4e07…",
        "conversationId": "conv_chatgpt_68f2a91c",
        "taskId": "task_20260830_01",
        "contentHash": "4e07…",
        "messageCount": 8,
        "classification": "not_needed",
        "receivedAt": "2026-09-30T08:20:41+09:00"
      }
    },
    {
      "index": 1,
      "ok": false,
      "error": {
        "error": {
          "code": "CONFLICT",
          "message": "서버에 있는 내용과 이어 붙일 수 없어요. 전체(full)로 다시 보내 주세요.",
          "details": {"reason": "BASE_MISMATCH", "expectedContentHash": "4e07…"},
          "requestId": "req_01JA0001"
        }
      }
    }
  ]
}
```

**놓친 대화 따라잡기(catch-up)** — 사이드바 목록을 쪼개서(≤500개) `POST /ingest/catchup/diff` `CatchupDiffBody` → `CatchupDiffResponse`: `fetch` = 열어서 스냅샷을 보내야 할 것(`new` 처음 봄, `updated` 서버보다 새로움, `unknown_time` 시각을 모름 → 하루 한 번만, `retry` 지난번 실패). 서버는 소스별 커서(마지막으로 다 확인한 `updatedAt`)를 저장하고, `stopBefore`보다 오래된 항목만 남으면 더 스크롤하지 않아도 된다. 확장은 `rate.maxFetchPerMinute`(기본 6)를 넘겨 열지 않고 `nextScanAfter` 전엔 다시 훑지 않는다(서비스 계정 위험, 9.6). GET 대신 POST인 이유: 목록이 커서 쿼리에 안 들어감.
```json
{
  "sourceAi": "claude",
  "items": [
    {
      "sourceId": "c1a0de01-0000-4000-8000-000000000001",
      "title": "Gemini 팟캐스트 자막 변환 도구 개발",
      "updatedAt": "2026-09-29T23:10:00+09:00"
    },
    {
      "sourceId": "c1a0de02-0000-4000-8000-000000000002",
      "title": "독서 모임 공지 초안",
      "updatedAt": "2026-09-12T10:00:00+09:00"
    },
    {"sourceId": "77aa0000-0000-4000-8000-000000000003", "title": "새 대화", "updatedAt": null}
  ],
  "cursor": null,
  "endOfList": false
}
```
```json
{
  "fetch": [
    {"sourceId": "c1a0de01-0000-4000-8000-000000000001", "reason": "updated"},
    {"sourceId": "77aa0000-0000-4000-8000-000000000003", "reason": "new"}
  ],
  "skipped": 1,
  "cursor": "cur_claude_20260930T0821",
  "stopBefore": "2026-09-12T10:00:00+09:00",
  "rate": {"maxFetchPerMinute": 6, "nextScanAfter": "2026-09-30T08:51:00+09:00"}
}
```

**어댑터 상태** — `POST /sync-state/:ai/health` `AdapterHealthBody` → `200 AdapterHealthResponse`(대시보드 `collection.sources`에 바로 반영: `broken`이면 그 AI 배지 "고장"). 확장은 시작할 때·DOM 검사 실패 때·하루 한 번 보냄. `GET /sync-state` → `SyncStateResponse`(소스별 커서·마지막 검사·대기·건강·버퍼 수).
```json
{
  "adapter": {"name": "claude-dom", "version": "0.3.0", "domVersion": "2026-09"},
  "health": "degraded",
  "checks": [
    {"name": "sidebar_selector", "ok": true},
    {"name": "message_selector", "ok": true},
    {"name": "stream_end_detect", "ok": false, "detail": "응답 끝 표시를 못 찾아 120초 대기로 판단"}
  ],
  "errorCode": null,
  "at": "2026-09-30T08:22:00+09:00",
  "bufferedSnapshots": 0
}
```
```json
{
  "sources": [
    {
      "sourceAi": "claude",
      "cursor": "cur_claude_20260930T0821",
      "lastScanAt": "2026-09-30T08:21:00+09:00",
      "lastSnapshotAt": "2026-09-30T08:20:41+09:00",
      "knownConversations": 29,
      "pendingFetch": 2,
      "health": "degraded",
      "healthAt": "2026-09-30T08:22:00+09:00",
      "adapter": {"name": "claude-dom", "version": "0.3.0"},
      "errorCode": null,
      "bufferedSnapshots": 0
    },
    {
      "sourceAi": "chatgpt",
      "cursor": null,
      "lastScanAt": null,
      "lastSnapshotAt": "2026-09-30T08:20:41+09:00",
      "knownConversations": 412,
      "pendingFetch": 0,
      "health": "ok",
      "healthAt": "2026-09-30T08:19:00+09:00",
      "adapter": {"name": "chatgpt-dom", "version": "0.3.0"},
      "errorCode": null,
      "bufferedSnapshots": 0
    }
  ]
}
```

#### 14.1 삭제 배치 [잠정 — Phase 6, MVP 코어는 `501 NOT_IMPLEMENTED`]
웹이 화면을 먼저 만들 수 있게 모양만 고정한다. 구현 때 바뀌면 §16에 적는다.
- 상태 `DeletionBatchState` = `pending | approved | running | paused | postponed | done | cancelled` (`postponed` = "내일 다시" — 1.0.1 추가).
- `GET /deletion-batches/:id` → `200 DeletionBatchResponse` = `{ batch: DeletionBatch }` (`DeletionBatch` = 요약 `cleanup.deletionBatch`와 같은 모양, 단 그룹의 `items`는 전부).
- `PATCH /deletion-batches/:id/items/:itemId` 본문 `SetDeletionItemBody` `{ selected }` → `200 DeletionBatchResponse` (`selectedCount`·그룹 `selected` 다시 계산, 뺀 항목은 `excludedByUser:true`).
- `POST /deletion-batches/:id/approve` 본문 `ApproveDeletionBody` → `200 DeletionBatchResponse` (`state:"approved"`, 곧 `running`). `expectedSelectedCount`가 서버 계산과 다르면 `409 CONFLICT`(화면이 오래됨), `excludedItemIds`는 승인 순간 한 번 더 빼는 목록. `confirmPhrase`는 판매용 빌드에서만 필수(틀리면 `400`).
- `POST /deletion-batches/:id/postpone` 본문 없음 → `200 DeletionBatchResponse` (`state:"postponed"`, 다음 날 요약에 다시 나옴).
```json
{"expectedSelectedCount": 32, "excludedItemIds": [504], "confirmPhrase": "삭제 승인"}
```
응답 예시는 `mocks/json/deletionBatchResponse.json`(approved) · `deletionBatchPostponed.json`(postponed) — 배치 본문은 §10.2 `digestCleanupLater`의 `deletionBatch`와 같다.

---

#### 14.5 MCP 서버 [**1.8.0 구현**]

별도 프로세스 `subbrain mcp`(공식 `@modelcontextprotocol/sdk`). **DB를 열지 않는 얇은 클라이언트** — 코어 HTTP API(`--core`, 기본 `http://127.0.0.1:4545`)만 부른다(쓰기 경로 하나). 전송: STDIO(기본) · Streamable HTTP(`--http --port 4547`, `127.0.0.1`만, 상태 없음·JSON 응답, Host 검사로 DNS 리바인딩 막음). 안내 문서: `docs/mcp-guide.md`.

| 도구 | 부르는 API | 비고 |
|---|---|---|
| `get_unfinished(project?, min_stale_days?, limit?)` | `GET /tasks?status=진행 중,멈춤&kind=task` | 프로젝트는 이름·id |
| `get_timeline(from, to, project?)` | `GET /tasks?from&to` | 날짜별로 묶음 |
| `search_past_work(query, limit?)` | `GET /search` | |
| `get_task(task_id)` | `GET /tasks/:id` | id 또는 제목 |
| `get_resume_prompt(task_id, target_ai?)` | `GET /tasks/:id/resume-prompt` | |
| `why_stalled(task)` · `search_objects(query,type?)` · `find_by_object(name,type?)` · `impact_of(decision)` · `similar_past_work(text)` | 온톨로지 §14.2 | 설계서 8.8 |
| `log_task(title, project?, status?, note?, next_step?, source_ai?)` | `POST /mcp/log-task` | 쓰기 |
| `update_task_status(task_id \| query, status, next_step?)` | `POST /mcp/update-task-status` | 쓰기. 검색어가 애매하면 409 + 후보 |
| `list_my_writes(limit?)` · `undo_write(event_id)` | `GET /mcp/events` · `POST /mcp/events/:id/undo` | |

- **삭제 도구 없음**. `--read-only`(또는 `SUBBRAIN_MCP_READ_ONLY=1`)면 쓰기 도구를 아예 등록하지 않음. 도구마다 `readOnlyHint`·`destructiveHint:false` 주석.
- **쓰기 = 이벤트**: `log_task` → `events.type='task_logged'`(actor `mcp`), 상태 → `status_changed`(actor `mcp`, `payload.prev`에 이전 `mcp_status`·`next_step`). 되돌리기 → 원래 이벤트 `payload.undoneAt` + 새 `write_undone` 이벤트. 기록 되돌리기는 **삭제가 아니라 보관**(과제 `mcp_status='보관'`, 대화 `service_state='archived'`). 뒤에 같은 과제를 또 바꿨으면 409.
- `log_task`는 짧은 대화 하나(`captureMethod:'mcp'`, 메모가 본문)를 만들고 과제 `origin='mcp'`. 분류 대기열에 넣지 않음(사용자가 직접 준 정보). 상태는 규칙 엔진 우선순위 2(MCP, 설계서 7.4).
- **가림**: `settings.ontology.showPersonNames=false`(기본)면 사람 객체 이름·별칭을 `역할(사람)`으로 바꿔 내보냄. `settings.llm.sensitiveProjectIds` 프로젝트·`sensitiveKeywords`가 제목에 든 과제는 제목·요약·대화를 내보내지 않음(`🔒 민감 프로젝트 과제`). 설정은 호출마다 다시 읽음.
- 보안: 코어 MCP 엔드포인트는 웹앱 API와 같은 규칙(로컬 바인딩 + 브라우저 Origin 검사, §2) + 1.9.0부터 토큰을 보내면 `mcp_write` 범위 검사. Streamable HTTP MCP 서버는 1.9.0부터 MCP 토큰 필수(§14.3 구현 메모).

**MCP 타입**: `McpLogTaskBody` · `McpLogTaskResponse{task, conversationId, projectMatched, eventId}` · `McpUpdateTaskStatusBody{taskId?|query?, status, nextStep?}` · `McpUpdateTaskStatusResponse{task, previousStatus, eventId}` · `McpEventsResponse{items: McpWriteEvent[]}` · `McpUndoResponse`.

## 15. 설계서와 다르거나 모호했던 점 · 결정

설계서·디자인 파일은 고치지 않았다. 아래는 계약서에서 정한 해석이다(설계서를 고칠 때 참고).

1. **인증**: 설계서 §5.2 그림·§12.1은 "토큰 인증 / 페어링 토큰으로 웹앱 인증"이라 했지만, 이번 작업 지시는 MVP 인증 없음. → MVP는 127.0.0.1 + Host/Origin 검사, 토큰은 Phase 3(확장 도입)에 추가. 경로·응답은 그대로(§2.1).
2. **대화가 여러 과제에 걸침**: 설계서 §6.3은 `conversations.task_id` 하나뿐인데 디자인 02는 "헤더 레퍼런스 찾기 — ‘1차 디자인’과 공유"로 한 대화가 두 과제에 보인다. → 주 과제는 `task_id`, 추가 연결은 코어가 `task_conversations(task_id, conversation_id, role: primary|shared)` 조인 테이블로 둔다. API는 `isPrimary`·`sharedWithTasks`. 과제의 시작일·첫 대화는 **주 대화 기준**(그래서 7/15 공유 대화가 있어도 "8월 30일 시작"), 대화·메시지 수와 AI별은 공유 포함(디자인의 5개·89개와 맞음).
3. **프로젝트 상태**: 설계서 §6.2 프로젝트 status는 `active|paused|done`인데 디자인 01 패널은 "12일째 멈춤"을 보여준다. 게다가 같은 시안 안에서 "글 목록 태그 필터"는 진행 중(9/27–9/29)이라 프로젝트가 멈춤일 수 없다(시안 데이터끼리 모순). → 생애 상태 `status`와 파생 표시 `activity`를 분리. 규칙: 진행 중 과제가 하나라도 있으면 `진행 중`, 없고 멈춤이 있으면 `멈춤`(staleDays = 오늘 − 프로젝트 마지막 활동), 모두 완료면 `완료`.
4. **합치기 제안 저장소**: §6.1·§7.6에 "같은 과제일 수 있음" 제안은 있지만 테이블이 없다. → 코어가 `task_merge_suggestions(id, task_a, task_b, suggested_primary, confidence, reason, state, created_at, decided_at)`를 더한다. 온톨로지 제안(§8.6, Phase 1.5)과 따로 둔다.
5. **방치 단계 키**: §7.3은 한국어 라벨만 있음 → `short_pause/stale/long_stale/dormant`로 정함.
6. **4–7일 멈춤의 일수 표시**: §10.2.3은 "7일 넘게 멈춤"만 라벨 옆에 일수를 붙인다고 했지만 디자인 01은 "소개 페이지 톤 6일"처럼 4–7일에도 붙인다. → `badge`는 멈춤이면 항상 "N일", 색으로 구분(노랑/주황). 웹이 8일 미만을 숨기고 싶으면 `statusVisual==="stall"`일 때만 보여주면 됨.
7. **볼트 경로**: 디자인 02는 `tasks/2026/메인 페이지 카피 확정.md`, 설계서 §6.1은 `tasks/이사업체-견적-비교.md`(연도 폴더 없음, 하이픈 slug). → 설계서를 따름.
8. **디자인 요일 표기**: 디자인 02의 "9.18 목요일", "8월 30일 (토)"는 2026년 달력과 맞지 않는다(2026-09-18은 금요일, 08-30은 일요일). 디자인 03의 "9월 30일 수요일"은 맞음. → API는 요일 문자열을 주지 않는다(단, 요약 `title`은 서버가 올바른 요일로 만듦). 웹이 `date`로 계산.
9. **ChatGPT 보관 문구**: 디자인 03 "7일 안에 되돌릴 수 있음"은 설계서 §10.6이 틀렸다고 명시 → 예시는 "언제든 보관 해제 가능".
10. **9번째 프로젝트 색**: §10.2.1 팔레트는 8색 순환이라 9번째 프로젝트는 1번째와 같은 `#F07F5E`가 된다(디자인 03은 팔레트 밖 `#C9A27A` 사용). → 순환 유지, `PATCH /projects/:id {colorHex}`로 바꿀 수 있게 함. 예시 데이터는 1.0.1부터 디자인 v3와 같은 8개 프로젝트라 색이 겹치지 않는다(1.0.0의 `prj_life` "생활" 삭제). `projects` 테이블에 `color` 열을 더한다(설계서 §6.3엔 없음).
11. **설계서 예시 과제와 디자인 예시의 차이**: 설계서 §6.2의 "이사업체 견적 비교(task_20260914_01, 멈춤 12일)"와 디자인 03의 "이사업체 견적 비교표(어제 진행)"가 다르다. 둘 다 예시일 뿐 → 계약서 예시는 디자인 쪽 상황을 따랐다.
12. **간단한 질문의 저장 위치**: §6.1 "대화 1개 = 과제 1개" + §6.3 `tasks.status`에 '간단한 질문'이 있으므로 간단한 질문도 `tasks` 행. 카운터·그래프 점·보드 열 모두 이 행에서 계산.
13. **포기한 일**: §7.2-5 [결정 필요] → 기본안대로 `완료` + `completionReason:"abandoned"`. 별도 상태가 결정되면 `TaskStatus`에 값을 더한다(v1 안의 추가 변경).
14. **엔드포인트 경로 버전**: §5.4①-A는 `/api/ingest/snapshot`(버전 없음) → `/api/v1/ingest/snapshot`로 예약.
15. **ontology `task`/`project` 객체**: §8.2는 과제·프로젝트도 객체라고 하지만 MVP는 객체 테이블 없이도 동작해야 한다. → MVP 노드 `id`는 도메인 id(`task_*`, `prj_*`), `objectId`는 Phase 1.5부터 채운다. 주제만 MVP부터 `obj_topic_*`.
17. **handoff 상태(1.1.0)**: 설계서 §7.2는 해결/미해결/포기만 있다. "다른 곳에서 이어감"을 새 상태나 resolution으로 만들면 보드 열·규칙 엔진이 바뀌므로, **resolution은 `unresolved` 그대로 두고 표시(`handoff`)만 더했다**(설계서 정신: 끝난 일만 완료). 이어간 쪽 대화가 같은 과제로 합쳐지면 표시는 그 대화 분류로 갱신된다.
18. **분류 불가(1.1.0)**: 설계서에 없는 경우. 상태를 비워 두면 보드·카운터가 깨지므로 규칙 결과로 채우고 `state:"blocked"`로 표시, "확인 필요"로 보낸다.
19. **새 프로젝트 제안 저장소(1.1.0)**: §7.6/§7.7에 제안·자동 생성은 있지만 테이블이 없다 → `project_suggestions`·`project_suggestion_tasks`를 더한다. ready 기준(과제 3개)은 §7.7 "근거 3건" 관례를 따름.
21. **Gemini Takeout = 활동 기록(1.2.0)**: 설계서는 Gemini를 "대화 내보내기"로 가정했지만 Takeout은 질문·응답 기록이다. 대화 단위가 없으므로 코어가 대화 주소 → 시간 간격 + 주제 연속성 순으로 다시 묶고, 묶는 규칙과 근거(확인/추정)를 §12.2에 적었다. 시간으로 묶은 대화는 원본 링크가 없다.
22. **간단한 질문은 새 프로젝트 제안에서 뺀다(1.2.0)**: §7.7 "비슷한 주제의 미분류 대화가 3개 이상"의 "대화"를 과제로 읽었다(간단한 질문은 프로젝트 과제 수에도 안 들어감).
23. **재현성 우선(1.2.0)**: 최근 과제 목록에서 요약을 뺐다(같은 과제 후보 판단엔 제목·대화 id로 충분하고, 후보는 코어가 유사도로 다시 거른다). 프롬프트 버전을 `cls-v3`로 올렸지만 자동 재분류는 하지 않는다.
24. **DB 스키마 v3(1.2.0)**: `llm_cache` 테이블, `classifications.cache_hit`·`content_hash`. 코어 시작 시 자동 이전.
28. **대화 결과 vs 과제 상태(1.4.0)**: 정확도 검토(docs/review-accuracy-v1.md) 제안 (a)(c). 사용자는 "넘겨준 대화"를 완료로 본다 — 대화 결과를 과제 상태와 분리해 둘 다 맞게 했다. 결과는 cls-v4 LLM 출력 `conversation_outcome` + 규칙 패턴(옮김: "새창에서 작업"·"Claude Code로 가서", 끊김: "토큰 떨어져서"·"자야 할 시간" + 저장 요청)을 합친다. 끊김 패턴이 가장 강하고(LLM이 moved라 해도 interrupted), 그다음 LLM, 규칙. handoff인데 LLM이 done/open이면 moved.
29. **DB 스키마 v5(1.4.0)**: `classifications.conversation_outcome/outcome_json`, `conversations.outcome/outcome_json`. 저장된 `간단한 질문` 상태는 이전 때 답 받음 → `완료/answered`, 못 받음(`resolution='unresolved'`) → `진행 중`(다음 계산에서 방치 규칙).
30. **sourceAi 넓힘(1.5.0)**: 로컬 세션을 다른 AI 서비스와 같이 그래프·목록·필터에 보이려면 같은 열거형이 맞다. `SourceAi`에 `claude-code`·`codex`를 더하고, 웹 채팅 4개만 필요한 곳(확장 수집 본문, 이어서 하기 대상)은 `ChatSourceAi`로 좁혔다. **웹 영향**: `Record<SourceAi, …>`로 적은 표(라벨·아이콘·색)에 두 키를 더해야 컴파일된다. 로컬 세션 대화의 `url`은 `null`(웹 주소 없음), `meta.sourceAis`에 모양·색 추가(claude-code=rounded_square #B8603A, codex=circle #2E8F62).
31. **온톨로지 계약은 웹 시안 목에 맞춤(1.5.0)**: 웹 시안이 이미 화면을 그리고 있어 필드 뜻은 그대로 두고 이름·형식만 다른 API와 맞췄다(§14.2 차이표). 목 변환 코드 `packages/shared/mocks/fixtures-15.ts`가 그대로 옮기는 방법이다.
32. **수집 토큰은 수집 경로만(1.5.0)**: 지금 웹앱 API에 토큰을 요구하면 MVP 화면이 다 깨진다. 토큰은 `/ingest/*`·`/sync-state/*`·`/pairing/clients/:id/rotate`·(나중) `/mcp/*`에만. 웹앱 쪽 보호는 지금처럼 Origin 검사(§2).
33. **로컬 세션 도구 출력 줄이기(1.5.0)**: Codex 로그 1.59 GB의 대부분이 도구 출력·이미지라, 도구 호출은 한 줄 요약(입력 300자·출력 600자)만 남긴다. 원본은 사용자 PC에 그대로 있으니 필요하면 다시 읽을 수 있다.
34. **DB 스키마 v6(1.5.0·1.6.0)**: `collector_files`(경로·inode·크기·읽은 위치·세션 키·파서 상태) · `collector_state`(설정·backfill·오류·가린 수) · `conversations.cwd` · `task_merge_suggestions.kind`·`handoff_json` · `conversations/classifications.outcome_label`. 코어 시작 시 자동 이전(라벨은 저장된 결과로 채움).
35. **대화가 끝나면 과제도 끝(1.6.0)**: 1.4.0에서 대화 결과와 과제 상태를 나눴지만, 사용자 라벨은 "대화가 끝났으면 과제 완료"였다(오답 8/8). 나눈 구조는 그대로 두고, 주 대화가 **모두** 끝난 경우만 과제를 완료로 올린다. 이어받은 세션은 자동 합치기 대신 제안 → 수락이 상태를 되돌리는 유일한 길이라 잘못 붙어도 사용자가 거절하면 끝.
36. **접힌 보드 열도 items(1.6.0)**: 숨기는 건 화면 몫. 간단한 질문 수십 개 정도는 응답 크기 문제가 없다.
38. (예약)
39. **인증 모델(1.9.0)**: localhost 웹앱은 계속 인증 없음(같은 origin + Host/Origin 검사가 이미 다른 사이트·DNS 리바인딩을 막음). 웹에 세션 쿠키를 새로 넣으면 웹 dev 흐름(Vite 프록시)을 바꿔야 해서 미룸 — 판매용 빌드에서 다시 본다. 토큰은 "밖에서 들어오는" 클라이언트(확장·HTTP MCP)만.
37. **온톨로지 구현(1.7.0)**: DB 스키마 v7 = `links.mention_count` · `ontology_suggestions` · `ontology_events` · `ontology_rejections` · `ontology_runs` + 색인. 설계서 8.6은 "분류 호출에 함께"가 기본이지만 (a) cls-v4 응답 캐시·재현성을 그대로 두고 (b) 이미 분류한 수천 개 대화에 분류를 다시 돌리지 않으려고 **따로 호출(ont-v1)** 로 시작 — 비용은 대화당 분류 1회와 비슷(입력 대부분이 같은 줄인 대화). 확신도 기준은 설계서 기본값(0.85/0.6) 그대로. 사람·자료·장소·조직은 설계서대로 기본 꺼짐(켜면 LLM 추출 대상). `GET /graph?mode=ontology`는 `GraphResponse` 모양으로 합칠 때까지 계속 501.
25. **음성 표시 방식(1.3.0)**: 전사 앞에 "🎙" 같은 글자를 붙이면 검색·분류·내용 해시·볼트에 섞이므로, 본문은 전사 그대로 두고 `messages.voice` 열 + `Message.voice?`로 표시만 한다. 음성이 아닌 메시지의 해시는 바뀌지 않게 voice는 true일 때만 해시에 넣었다.
26. **가격을 모르면 null(1.3.0)**: 설계서 §7.7 비용 표시는 금액을 가정하지만, 모르는 값을 $0으로 보이면 "공짜"로 오해한다. 기본 가격표는 공식 가격표에서 확인한 값만 넣고, 나머지는 null. 오늘 합계만 nullable로 바꿨다(계약상 유일한 비추가 변경).
27. **DB 스키마 v4(1.3.0)**: `messages.voice`. 코어 시작 시 자동 이전.
20. **DB 스키마 v2(1.1.0)**: 코어 시작 시 자동 이전 — `classifications`에 `state·blocked_reason·blocked_model·raw_confidence·handoff_json·new_project_suggestion`, `tasks.handoff_json`, `task_topics.origin·conversation_id`, `projects.external_ref`, 위 제안 테이블 2개. 기존 데이터는 그대로(새 열은 비어 있거나 기본값).
16. **확인된 기술 사실(T2 일부)**: 이 박스의 Node 22.23.3 `node:sqlite`에서 FTS5 trigram 3글자 이상 구문 검색은 되고, 2글자는 0건 — §6.4 대체 검색 필요성 확인.

---

## 16. 변경 이력

| 버전 | 날짜 | 내용 |
|---|---|---|
| 1.10.1 | 2026-10-14 | §14.3 「1.10.1 보정」: `SUBBRAIN_LLM_API_KEY` 읽기·키 출처 로그·CLI 경고 · 볼트 같은 내용은 충돌 아님 · 볼트 주인 표시(복사본 DB가 원본 볼트에 쓰지 않음) |
| 1.10.0 | 2026-10-12 | §14.3 「1.10.0 추가」: `SourceAi` `grokbot`·`grokbot_json` 가져오기 · `CollectorRunBody.classify?`·`dryRun?`, `CollectorEstimate`, 백필 중 감시기 쉼(classify:false 버그) · 대시보드에 로컬 세션 수집기·`counts.allTasks?` · `/search?kind` · `/conversations/:id?around&window` · MCP 읽기 14개(출처·structuredContent·2,000자·cursor, 새 도구 4개), STDIO 기본 읽기 전용 |
| 1.9.1 | 2026-10-12 | §14.3 「1.9.1 보정」: 해시 `sha256:` 접두어 허용(정식 맨 hex, 예시 고침) · 확장 토큰 GET은 Origin 없으면 허용 · 따라잡기 스냅샷 분당 6개 서버 강제 · 수집 시각 +09:00 정규화 · `McpWriteEvent.client` · `dev purge-conversation` CLI |
| 1.9.0 | 2026-10-12 | ① 확장 수집 API **구현**(§14.3, 엔드포인트 74–84 — 501 해제): 페어링 코드·토큰(교체 300초 유예·폐기), 확장 Origin 검사, 스냅샷 멱등(accepted/duplicate/partial/stale)·append·재전송·따라잡기 diff·어댑터 상태, 속도 제한 ② `StartPairingBody.allowWrite?` ③ 요청 Zod 스키마(`IngestSnapshotBodySchema` 등) ④ MCP Streamable HTTP에 토큰 필수, `subbrain mcp pair` ⑤ DB 스키마 v8 ⑥ 인증 모델 결정 §15-39 |
| 1.8.0 | 2026-10-12 | ① MCP 서버 구현(§14.5, 도구 14개 — 읽기 10 · 쓰기 4) ② 엔드포인트 70–73 `/mcp/*` ③ `EventType`에 `task_logged`·`write_undone`, `captureMethod`에 `mcp` ④ `OntologyExtractBody.mode?: 'rules'\|'all'`(`'rules'` = `llm:false`) ⑤ 코어 시작 때 과제 객체가 없는 과제가 있으면 규칙 온톨로지 자동 보충(LLM 없음, 멱등 — v7 이전 데이터) ⑥ `ontology estimate`는 키가 없어도 저장된 설정의 모델 값으로 비용 어림 |
| 1.7.0 | 2026-10-12 | ① 온톨로지 **구현**(§14.2 엔드포인트 52–69 — 501 해제) ② 새 엔드포인트 `GET /ontology/status`·`POST /ontology/extract`(작업 `extract_ontology`), 타입 `OntologyExtractBody`·`OntologyStatusResponse` ③ 규칙 추출(분류 뒤 자동) + LLM 추출(`ont-v1`) ④ `TaskDetail.whyStalled`·`DigestResponse.ontology` 채움(전엔 늘 `null`) ⑤ 응답·쿼리 Zod 스키마(`OntologyGraphResponseSchema` 등) ⑥ DB 스키마 v7(§15-37) ⑦ 예시 데이터에 시안 온톨로지 |
| 1.6.0 | 2026-10-12 | ① 대화 결과 → 과제 상태: 주 대화 모두 `done`·`moved` → `완료` + `completionReason` `'done'`·`'moved'`(새 값, §8) ② 보드 `간단한 질문` 열 `items` 채움(버그 수정) ③ `TaskDetail.conversationOutcome?`·`conversationOutcomes?` ④ 결과 라벨 DB 저장 ⑤ 예시 데이터: 넘겨준 과제 `task_20260915_01`이 `완료/moved`가 되어 대시보드 `stalled` 12 → 11 |
| 1.5.0 | 2026-10-12 | ① 로컬 세션 수집기 **구현**(§12.10, 엔드포인트 48–51, `sourceAi` `claude-code`·`codex`, `captureMethod` `local_session`, 작업 `collector_backfill`·`collector_scan`) ② `MergeSuggestion.kind?`·`handoff?`(넘겨준 대화 ↔ 세션 합치기 제안) ③ 온톨로지 API 계약(§14.2, 아직 501) ④ 확장 수집 API 계약(§14.3, 아직 501) ⑤ 오류 코드 `UNAUTHORIZED`(401)·`RATE_LIMITED`(429) ⑥ DB 스키마 v6(§15-34) |
| 1.4.0 | 2026-10-12 | ① 대화 결과 `ConversationOutcomeInfo`(`TaskListItem.conversationOutcome?`, `ConversationDetail.outcome?`, §8) ② 간단한 질문 답 받음 = `완료` + `completionReason:'answered'`(새 값), `TaskStatus '간단한 질문'` deprecated(필터·보드 열은 별칭 유지) ③ 프롬프트 `cls-v4`(`conversation_outcome`) ④ DB 스키마 v5(§15-28·29) |
| 1.3.0 | 2026-10-11 | ① ChatGPT 음성 대화 전사 보존(§12.1, `Message.voice?`, §8.12) — 다시 가져오면 해당 대화 갱신·재분류 대상 ② 기본 가격표(§13.4), 모르는 모델 비용 `null` ③ `ClassificationStatus.today.costUsd: number \| null` + `costUsdKnown`·`costUnknownCount`(§12.6), 하루 상한은 `costUsdKnown` 기준 ④ DB 스키마 v4(§15-27) |
| 1.2.0 | 2026-10-10 | 추가만(§2.3). ① **Gemini Takeout 가져오기**(§12.1·12.2): `detectedFormat`에 `gemini_takeout_html`·`gemini_takeout_json`, `ImportPreview.activity`(`GeminiActivityPreview`, 다른 형식은 `null`), 업로드 `sourceAi:gemini`·`geminiSessionGapMinutes`, HTML 파일 업로드 허용, CLI `--gap` ② **새 프로젝트 제안 합치기**(§9-2): 한↔영 별칭·핵심 단어 이름 비교, 같은 과제·대화·합치기 제안으로 이어진 제안 합치기, 수락된 제안으로 흡수, 간단한 질문 제외(`taskCount` = 수락 후 `project.taskCount` 증가분) ③ **재현성**(§12.7): 프롬프트 `cls-v3`(입력 고정), seed, 응답 캐시(`ClassificationInfo.cached`, `ClassificationStatus.today.cacheHits`, `RunClassificationBody.refreshCache?`) ④ `TaskListItem.blockedReason?`·`blockedModel?`·`confidence?` ⑤ `RejectProjectSuggestionBody` 타입 ⑥ 예시 데이터: handoff 과제(`task_20260915_01`)·분류 불가 과제(`task_20260922_02`, 원래 확인 필요라 수치 그대로)·새 프로젝트 제안(`psg_seed01`, 과제 1개라 ready 아님 → 대시보드 배지 0과 일치) ⑦ DB 스키마 v3(§15-24) ⑧ 목 `importGeminiPreview`·`tasksHandedOff`·`tasksBlocked`, `projectSuggestions`는 읽기 캡처로 옮김 |
| 1.1.0 | 2026-10-02 | 실제 Claude 내보내기(2026-10 형식)를 Gemini로 분류해 보고 고친 것(추가만, §2.3). ① 기본 모델 교체(Google `gemini-3.5-flash-lite` 등, §13.4) ② 분류 규칙 `cls-v2`(§12.7): handoff 표시(`HandoffInfo`, `TaskListItem.handoff?`·`TaskDetail.handoff`·`ClassificationInfo.handoff`, 상태는 완료 아님), "내일 X 먼저 해보자" 끝은 미해결, 확신도 보정(`ClassificationInfo.rawConfidence`), 같은 과제 후보 유사도·허브 필터, 분류기 주제 교체 ③ 분류 불가: `ClassificationState`(`ok\|blocked`), `TaskListItem.classificationState?`·`TaskDetail.classificationState`·`ClassificationInfo.state/blockedReason/blockedModel`, 목록 쿼리 `classificationState`·`handedOff`, `ClassificationStatus.blockedCount`, needsReview에 포함, 재시도 정책 ④ 새 프로젝트 제안 엔드포인트 3개(§9-2, `ProjectSuggestion`·`AcceptProjectSuggestionBody/Response`·`RejectProjectSuggestionResponse`), 대시보드 `badges.pendingProjectSuggestions?`, 요약 `pendingProjectSuggestions?` ⑤ 카테고리 ZIP(§12.2): `ImportPreview.category`·`projects`, `detectedFormat`에 `claude_projects_zip`·`claude_memories_zip`, `ImportJob.result.projectsCreated` ⑥ llm-test 404 안내, 시작 로그(제공자 미선택/키 없음/사용 중 구분) ⑦ DB 스키마 v2(§15-20) ⑧ 목 `projectSuggestions`·`acceptProjectSuggestionResponse`·`importProjectsPreview` |
| 1.0.1 | 2026-09-30 | 코어 구현과 맞춤. ① 합치기 거절 응답을 수락과 같은 `{ suggestion, task }`로(`RejectMergeResponse`) ② 과제 대화·메시지 수·`sourceAis`는 공유 대화 포함으로 통일(목록·그래프·프로젝트 상세·과제 상세), 그래프 프로젝트 노드 수치 = 프로젝트 요약 ③ `resume.promptPreview` = resume-prompt 전문과 동일 ④ Host 검사에 개발 origin host 허용(Vite 프록시) ⑤ 삭제 배치 [잠정] 모양(§14.1: `ApproveDeletionBody`·`SetDeletionItemBody`·`DeletionBatchResponse`, 상태 `postponed` 추가) ⑥ 키 없을 때 분류는 규칙 분류기(503 아님), llm-test는 제공자 없음 400 / 키 없음 200 ok:false ⑦ API 키 저장 = `secrets.json`(0600) + 환경변수 ⑧ 목 JSON을 엔진 캡처로 전환 — 예시 데이터를 디자인 v3 수치로 확장(프로젝트 8, `prj_life` 삭제), `mocks/json/demo/` 전체 상세 세트, `searchPaged`·`graphExcerpt`·`rejectMergeResponse` 추가, 요약의 멈춤 이벤트에 `project` 채움(프로젝트별 한 줄) |
| 1.0.0 | 2026-09-30 | 첫 계약. MVP 엔드포인트 44개, LATER 경로 예약, 공유 타입(`packages/shared/src/api-types.ts`), 타입 검사한 목 JSON(`packages/shared/mocks/json/*.json`) |

> 목 JSON 다시 만들기: `cd app && pnpm contract` (= 정적 목 `packages/shared/mocks/dump.ts` + 엔진 캡처 `pnpm --filter @subbrain/core mocks` + 이 문서 생성, Node 22+). 엔진 캡처는 임시 폴더에 시드를 넣어 쓰므로 실제 데이터(`~/.subbrain`, `app/.data`)는 건드리지 않는다.
