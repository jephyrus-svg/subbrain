# 서브브레인 (SubBrain) — 앱 모노레포

로컬 우선 AI 대화 작업 기억 장치. ChatGPT·Claude 대화를 가져와 **과제 단위**로 묶고(진행 중 · 멈춤 · 완료 · 간단한 질문 · 보관),
SQLite를 유일한 원본으로 두며, Obsidian 볼트(Markdown)를 한 방향으로 써 주고, 로컬 웹앱에 API를 제공한다.

- API 계약서: [`API_CONTRACT.md`](./API_CONTRACT.md) (생성물 — `pnpm contract`로 다시 만듦, 현재 v1.0.1)
- 설계서·디자인 원본은 공개 저장소에 포함되지 않음

## 구성

```
app/
├── packages/shared   공유 타입(api-types.ts) · zod 스키마(schemas.ts) · 상수 · 목 JSON(mocks/json)
├── packages/core     로컬 코어: Hono HTTP API(127.0.0.1:4545) · SQLite(node:sqlite) · 가져오기 · 분류 · 규칙 엔진 · 볼트 · 아침 요약
├── web               웹앱(React + Vite) — 웹 담당
└── scripts           계약서 생성기(build-contract.mjs + contract.template.md)
```

## 준비

- Node **22.16+** (`node:sqlite` 사용 — 실행 시 나오는 `ExperimentalWarning: SQLite is an experimental feature`는 무해)
- pnpm 9 — 루트 스크립트가 안에서 `pnpm`을 다시 부르므로 `pnpm`이 PATH에 있어야 한다(`corepack enable pnpm`)

```bash
cd subbrain
pnpm install
```

## 자주 쓰는 명령 (저장소 루트에서)

| 명령 | 하는 일 |
|---|---|
| `pnpm seed` | 예시 데이터 넣기(디자인 v3와 같은 상황: 프로젝트 8 · 과제 41 · 간단한 질문 26 …) + 볼트 생성. **기존 개발 DB를 비움** |
| `pnpm dev` | 코어 개발 서버(tsx watch) → `http://127.0.0.1:4545/api/v1` |
| `pnpm start` | 코어 실행(기본 데이터 폴더 `~/.subbrain`, 볼트 `~/SubBrain`) |
| `pnpm test` | 코어 테스트(vitest: 파서 · 가리기/줄이기 · 규칙 엔진 · 규칙 분류기 · 전 엔드포인트 계약 · 가져오기 흐름 · 볼트 충돌) |
| `pnpm typecheck` | 전체 워크스페이스 타입 검사(shared · core · web) |
| `pnpm mocks` | 공유 목 JSON(`packages/shared/mocks/json`)을 **엔진 응답으로** 다시 만듦(임시 폴더 사용, 실제 데이터 안 건드림) |
| `pnpm contract` | 정적 목 + 엔진 목 + `API_CONTRACT.md` 다시 만들기 |

코어 CLI 직접 실행(`packages/core`에서 `npx tsx src/cli.ts <명령>`):

```
start | seed | import <내보내기 ZIP 또는 conversations.json> | regenerate-vault | mocks
  --dev            데이터를 .data, 볼트를 .data/vault 에 둠 (pnpm dev/seed가 씀)
  --home <폴더>    데이터 폴더 (기본 ~/.subbrain, 환경변수 SUBBRAIN_HOME)
  --vault <폴더>   볼트 폴더 (환경변수 SUBBRAIN_VAULT)
  --port <번호>    기본 4545
  --no-scheduler   (start) 새벽 3시 멈춤 재계산 · 요약 생성 스케줄러 끄기
  --no-vault       (seed) 볼트 생성 생략
  --no-classify    (import) 분류 생략
  --force          (import) 이미 가져온 파일도 다시
```

예: 실제 ChatGPT 내보내기 가져오기 → `pnpm --filter @subbrain/core run import ~/Downloads/chatgpt-export.zip` (개발 DB에 들어감. `pnpm import`는 pnpm 자체 명령이라 `run`이 필요)

## 데이터 위치

- 개발(`--dev`): `.data/subbrain.db`, 원본 파일 `.data/raw/exports/<ai>/`, 볼트 `.data/vault/` (`.gitignore`에 포함)
- 기본: `~/.subbrain/` + `~/SubBrain/`(볼트). 볼트는 코어가 **한 방향으로만** 쓴다. 사용자가 Obsidian에서 고친 노트는
  다음 생성 때 `볼트/.subbrain/conflicts/<시각>/…`에 백업한 뒤 덮어쓰고 `GET /vault/conflicts`에 남는다.

## LLM 분류

- **키가 없어도 동작**: 규칙 분류기(`model: "rule-mock"`)가 같은 입력에 같은 결과를 낸다(예시 데이터 · 오프라인 · 테스트용).
- 키 넣기: 웹 설정 화면 → `PUT /api/v1/settings/llm-key {provider, apiKey}` (`<데이터 폴더>/secrets.json`, 권한 0600)
  또는 환경변수 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` / `XAI_API_KEY`.
  제공자·모델은 `PATCH /api/v1/settings {llm:{provider, model}}`. 연결 확인은 `POST /api/v1/settings/llm-test`.
- 보내기 전 비밀정보 가리기(키·이메일·전화·카드·주민번호 형식) + 입력 줄이기(처음 3 + 마지막 6 + 가운데 200자).
  민감 키워드·민감 프로젝트 대화와 간단한 질문 후보는 LLM에 보내지 않는다.
- 비용: 가격표를 코드에 박지 않음 — `SUBBRAIN_PRICE_INPUT_PER_MTOK`, `SUBBRAIN_PRICE_OUTPUT_PER_MTOK`(USD/100만 토큰)를 주면 계산, 없으면 `null`. 하루 상한(`llm.dailyCostCapUsd`)에 닿으면 남은 분류는 `deferred`.

## 웹앱과 붙이기

- 모의 모드: 웹은 `@subbrain/shared/mocks/<이름>`(예: `graph`, `taskDetail`, `digest`)과 전체 상세 세트
  `@subbrain/shared/mocks/demo/{tasks,flows,resumePrompts,projects,topics,conversations}`(키 = id)를 쓸 수 있다.
  이 JSON은 전부 엔진이 예시 데이터 위에서 실제로 돌려준 응답이다(`pnpm mocks`).
- 실연결 모드: 코어를 4545에 띄우고(`pnpm seed && pnpm dev`) 웹을 `pnpm --filter @subbrain/web dev:live`로 실행.
  Vite 프록시(`/api` → `127.0.0.1:4545`, `changeOrigin:false`)의 Host(`127.0.0.1:5173` 등)는 코어가 허용한다.
  다른 포트에서 개발하면 `SUBBRAIN_DEV_ORIGINS="http://localhost:5174"`.
- 시각 고정: 환경변수 `SUBBRAIN_NOW=2026-09-30T08:30:00+09:00`를 주면 코어의 “오늘”이 고정된다(목·테스트가 이 값을 씀).

## 알려진 한계 / TODO

- 2글자 한국어 검색은 LIKE 전체 스캔(보조 bigram 색인은 아직 없음). 3글자 이상은 FTS5 trigram.
- LATER 경로(제안 검토 1.5 · 타임라인/SSE 2 · 확장/페어링 3 · 위키 5 · 정리/삭제 6)는 `501 NOT_IMPLEMENTED` + `details.phase`.
  삭제 배치 요청/응답 모양은 계약서 §14.1에 [잠정]으로 고정.
- API 키는 OS 키체인 대신 `secrets.json`(0600). 키 삭제 엔드포인트 없음(덮어쓰기만).
- AI SDK 제공자별 기본 모델 이름은 [미검증] — 설정에서 바꿀 수 있음.
- ChatGPT·Claude 내보내기 형식은 공개적으로 알려진 모양 기준 [추정] — 공식 스키마 문서 없음. ZIP은 메모리에서 푼다(아주 큰 파일은 메모리 사용 큼).
