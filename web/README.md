# @subbrain/web — 서브브레인 MVP 프론트엔드

디자인 v3를 옮긴 Vite + React + TypeScript 앱. 타입은 `@subbrain/shared`(api-types.ts)를 그대로 쓴다.

## 실행
```bash
corepack pnpm install   # 저장소 루트에서
cd web
corepack pnpm dev        # 예시 데이터(mock) 모드, http://127.0.0.1:5173
corepack pnpm dev:live   # 실제 코어 모드: /api → http://127.0.0.1:4545 (Vite 프록시)
corepack pnpm typecheck && corepack pnpm build
```

## 데이터 모드
우선순위: URL `?data=mock|live` → localStorage `subbrain.dataMode` → `.env`의 `VITE_DATA_MODE`(기본 mock).
화면 왼쪽 아래 작은 안내에서 바꿀 수 있다(바꾸면 새로고침).
- mock: `src/api/mock/router.ts`가 계약서 경로를 흉내 낸다. 공용 목(`packages/shared/mocks/json`)을 먼저 쓰고,
  목에 없는 부분(그래프 전체, 26주 활동, 다른 과제 상세 등)만 `src/api/mock/demoData.ts`에서 채운다. 상태 변경(PATCH/POST)은 메모리에만 남는다.
  mock 모드의 "지금"은 2026-09-30 08:30 KST로 고정(`src/lib/clock.ts`).
  1.1.0 미리보기: 공유 목엔 handoff·분류 불가가 없어서 `demoData.ts`의 `AUG_110`이 과제 몇 개(분류 프롬프트 정확도 시험·볼트 노트 형식 = 이어감, 홈트 루틴 식단 = 분류 불가)에 표시를 덧씌운다(모의 모드만).
- live: `fetch('/api/v1/...')`. 오류는 `{error:{code,message,details,requestId}}`를 `ApiRequestError`로 바꾸고, 501은 "나중 단계" 안내로 보여 준다.

## 구조
- `src/api/` client(모드 전환·오류), endpoints(계약서 경로별 함수), useApi, mock/
- `src/graph/` engine(3D 배치·원근 투영·라벨 배치), GraphView(SVG 렌더러: 빛 받은 구, 깊이 흐림, 상태 고리, 회전·이동·확대·선택·호버·키보드)
- `src/screens/` Home(+home/ 패널), TaskDetail, Digest(+digest/CleanupPanel 삭제 승인), Board(간단), Timeline(자리만), Review(`/review` 확인할 것: 확인 필요·분류 불가·새 프로젝트 제안, 1.1.0)
- `src/components/TaskBadges.tsx` "…에서 이어감"·"분류 불가" 배지, `ProjectSuggestionCard.tsx` 새 프로젝트 제안 카드(확인할 것·오늘의 요약)
- `src/components/` TopBar, SearchOverlay(⌘K/Ctrl K, /), Toast, Popover 등
- `src/styles/` base + 화면별 CSS (디자인 생성기 home.py/detail.py/digest.py에서 옮김)
- 폰트: Pretendard 4굵기, 고운바탕 2굵기를 woff2로 로컬 번들(라틴·기호·한글 음절 11,172자 부분집합, 한자는 시스템 글꼴로 대체)
