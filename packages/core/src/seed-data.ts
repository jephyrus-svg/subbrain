/**
 * 예시 데이터 정의 (디자인 v3 예시 데이터 = 웹 demoData.ts와 같은 id·이름·수치).
 * 프로젝트 8 · 프로젝트 과제 41 · 간단한 질문 26 · 보관(채우기) — 프로젝트별 대화/메시지 합계가 디자인 수치와 정확히 같도록 보관 과제로 채운다.
 * 날짜는 'MM-DD HH:MM'(2026년, KST). 과제 id의 날짜와 디자인의 "처음" 날짜가 어긋나면 id 날짜를 시작일로 쓴다.
 */
import type { MessageRole, OntologyGraphResponse, SourceAi } from '@subbrain/shared';

export interface ConvSpec { ai: SourceAi; sid?: string; title: string; from: string; to: string; n: number; msgs?: Record<number, [MessageRole, string]>; summary?: string; evidence?: string; sharedWith?: string }
export type SeedState = 'run' | 'stall' | 'done' | 'quick' | 'archived';
export interface TaskSpec {
  id: string; title: string; project: string | null; state: SeedState;
  summary?: string; detail?: string[]; next?: string | null; conf?: number; convs: ConvSpec[]; topics?: string[];
}
/** 대화를 자동으로 나누는 간단 정의: 메시지 msgs개를 round(msgs/11)개 대화로 first~last 사이에 나눔 */
export interface AutoTask { id: string; title: string; project: string | null; state: SeedState; ai: SourceAi; msgs: number; first: string; last: string; summary?: string; next?: string; detail?: string[]; conf?: number; topics?: string[]; convCount?: number }

export const PROJECTS: Array<{ id: string; name: string; color: string; aliases: string[]; summary: string | null; thresholds?: object | null; priority?: number }> = [
  { id: 'prj_blog', name: '블로그 리뉴얼', color: '#F07F5E', aliases: ['블로그', 'blog renewal'], summary: '1차 디자인과 섹션 구성은 끝났고, 메인 카피를 두 안 중에 고르다 멈춰 있어요.', priority: 1.2 },
  { id: 'prj_subbrain', name: '서브브레인', color: '#5B8DEF', aliases: ['SubBrain', 'subbrain'], summary: '스키마와 검색은 끝났고, 정답 세트로 분류 프롬프트 정확도를 시험하는 중이에요.', priority: 1.1 },
  { id: 'prj_moving', name: '이사 준비', color: '#36C2A6', aliases: ['이사'], summary: '업체 견적을 비교하는 중이에요. 한 곳은 아직 답이 없어요.' },
  { id: 'prj_kyoto', name: '가을 교토 여행', color: '#D768A6', aliases: ['교토', '일본 여행'], summary: '료칸은 골랐고 3박 4일 일정과 교통패스를 정하다 멈춰 있어요.', thresholds: null },
  { id: 'prj_dividend', name: '배당 가계부', color: '#E8B63E', aliases: ['배당', '가계부'], summary: '구글 시트로 배당 가계부를 만드는 중. 환율 자동화에서 막혀 있어요.', priority: 1.1 },
  { id: 'prj_career', name: '커리어', color: '#A393E0', aliases: ['이직', '이력서'], summary: '포트폴리오 목차는 끝났고 영문 이력서를 다듬다 한 달 넘게 멈춰 있어요.' },
  { id: 'prj_devstudy', name: '개발 공부', color: '#4DB9E3', aliases: ['공부', 'dev'], summary: '궁금한 걸 그때그때 끝내는 편 — 진행 중인 과제는 없어요.' },
  { id: 'prj_health', name: '건강', color: '#9CCB5E', aliases: ['운동'], summary: '10km 러닝 훈련표를 짜는 중이에요.' },
];

export const TOPICS: Array<[key: string, name: string, aliases: string[]]> = [
  ['copywriting', '카피라이팅', ['카피', 'copywriting']], ['branding', '브랜딩', ['branding']], ['blog', '블로그', ['blog']],
  ['portfolio', '포트폴리오', ['portfolio']], ['deploy', '배포', ['deploy', '디플로이']], ['classification', '분류', ['classification']],
  ['quote', '견적', ['quote']], ['automation', '자동화', ['automation']],
];

// ───────── 대화를 직접 적은 과제 (블로그 전부 + 몇몇 핵심 과제)
export const EXPLICIT: TaskSpec[] = [
  {
    id: 'task_20260830_01', title: '메인 페이지 카피 확정', project: 'prj_blog', state: 'stall', conf: 0.86, topics: ['copywriting', 'branding', 'blog'],
    summary: '후보 3개 중 A/B로 좁힘. 톤은 ‘담백하게’로 합의',
    detail: [
      '메인 카피 후보 11개를 3개로 추렸고, 9월 18일 A(담백한 소개형)와 B(질문형)를 비교함.',
      'A 쪽으로 기울었지만 “밋밋한가?”라는 고민으로 확정하지 않고 끝남.',
      '보이스 원칙(1인칭·짧은 문장·느낌표 없음)은 9월 3일 Claude 대화에서 정함.',
    ],
    next: 'A안을 기준으로 보조 문장 3개와 CTA 2개 쓰기',
    convs: [
      { ai: 'claude', sid: '3b9d4f12-a0c7-4e6d-8f15-92b3e7d0c4a1', title: '소개 문단 초안', from: '08-30 23:12', to: '08-31 00:05', n: 14, summary: '자기소개 문단 초안 2개. 메인 카피와 문장이 겹쳐서 일단 보류 — 이 과제가 시작된 대화.',
        msgs: { 1: ['user', '블로그 첫 화면에 들어갈 자기소개 문단 초안을 두 개만 써 줘. 너무 거창하지 않게.'], 13: ['user', '영문 병기도 해야 할까? 일단 메인 카피부터 정하고 다시 볼게.'] } },
      { ai: 'claude', sid: 'a7c3e210-5d8f-4b21-9e03-c6a1f7b2d840', title: '블로그 톤 & 보이스 정리', from: '09-03 20:31', to: '09-03 21:20', n: 22, summary: '보이스 원칙 세 가지: 1인칭, 짧은 문장, 전문용어는 풀어서 쓰기.',
        msgs: { 1: ['user', '내 블로그 글의 톤을 정하고 싶어. 친근하지만 가볍지 않게?'], 12: ['assistant', '‘친근하지만 가볍지 않게’보다는 행동으로 정의해 보세요 — 문장은 25자 안팎, *느낌표는 쓰지 않기*처럼요.'], 21: ['user', '좋아. 보이스는 1인칭, 짧은 문장, 느낌표 없음으로 가자.'] } },
      { ai: 'chatgpt', sid: '5d1e77b0-91a3-8004-c2e8-3b7f0d6a1e94', title: '메인 카피 후보 뽑기', from: '09-12 21:40', to: '09-12 23:02', n: 26, summary: '후보 11개에서 3개로 추림. ‘과장 없이, 내가 쓴 것처럼’이라는 기준을 세움. 한 줄 + 보조 한 줄 구조로 결정.',
        msgs: { 1: ['user', '개인 블로그 메인 카피 후보를 10개 이상 뽑아 줘. 개발하면서 만든 작은 도구들 이야기를 쓰는 블로그야.'], 9: ['user', '‘세상을 바꾸는’ 같은 말은 전부 빼 줘. 내가 실제로 쓸 법한 문장으로.'],
          10: ['assistant', '남은 후보 — ① 작은 도구를 만들고, 만든 과정을 씁니다. ② 왜 어떤 도구는 오래 쓰게 될까요? ③ 만들고, 고치고, 기록합니다.'], 25: ['user', '메인 카피는 한 줄 + 보조 한 줄 구조로 가자. CTA는 ‘글 읽기’랑 ‘뉴스레터 구독’ 중에 아직 모르겠어.'] } },
      { ai: 'chatgpt', sid: '68f2a91c-4b7e-8003-a1d2-9c0e5b7f3a21', title: '카피 A/B 비교', from: '09-17 23:05', to: '09-18 01:47', n: 18, summary: 'A(담백한 소개형)와 B(질문으로 시작)를 나란히 비교. A 쪽으로 기울었지만 확정하지 않고 끝남.', evidence: '“내일 다시 볼게”로 끝남',
        msgs: { 1: ['user', '메인 카피 후보 A랑 B를 나란히 놓고 비교해 줘.\n\nA: 작은 도구를 만들고, 만든 과정을 씁니다.\nB: 왜 어떤 도구는 오래 쓰게 될까요?'], 2: ['assistant', '| 기준 | A | B |\n|---|---|---|\n| 첫인상 | 담백함 | 호기심 |\n| 나다움 | 높음 | 중간 |'],
          15: ['user', '후보는 A랑 B 둘로 좁히자. 근데 A가 좀 밋밋한가?'], 16: ['assistant', 'A를 유지하되 두 번째 줄에 *구체적인 숫자를 하나* 넣으면 밋밋함이 줄어요. 예: “7년째 작은 도구를 만들고 있습니다.”'],
          17: ['user', 'A가 더 나 같긴 한데, 너무 밋밋한가? 내일 다시 볼게'], 18: ['assistant', '좋아요. 내일은 A안을 기준으로 보조 문장부터 같이 써 봐요.'] } },
    ],
  },
  { id: 'task_20260805_01', title: 'RSS 피드 붙이기', project: 'prj_blog', state: 'stall', conf: 0.81, summary: '라우트 핸들러로 만들다 멈춤. 우선순위 낮음', next: 'app/feed.xml/route.ts에서 글 목록을 RSS 2.0으로 내보내기', topics: ['blog'],
    convs: [{ ai: 'grok', sid: '19ab2c7d-0e44-4b1f-9a52-7f3e0c2d8b16', title: 'Next.js RSS 피드', from: '08-05 21:44', to: '08-07 00:15', n: 6 }] },
  { id: 'task_20260902_01', title: '소개 페이지 톤 맞추기', project: 'prj_blog', state: 'stall', conf: 0.78, summary: '메인 카피가 정해지면 같은 톤으로 다시 쓰기로 함', next: '메인 카피 확정 후 소개 문단 1·2를 같은 톤으로 다시 쓰기', topics: ['copywriting', 'blog'],
    convs: [
      { ai: 'claude', title: '소개 페이지 톤', from: '09-02 10:20', to: '09-02 11:30', n: 12 },
      { ai: 'claude', sid: 'e02b5a91-6c3d-4f70-b1a8-2d9e4c7f0a35', title: '소개 문단 다시 쓰기', from: '09-24 21:00', to: '09-24 22:10', n: 10 },
    ] },
  { id: 'task_20260927_01', title: '글 목록 태그 필터', project: 'prj_blog', state: 'run', conf: 0.9, summary: '칩 대신 텍스트 링크로 바꾸는 중 — 모바일 줄바꿈 확인 필요', next: '375px 화면에서 태그 줄바꿈 확인', topics: ['blog'],
    convs: [{ ai: 'chatgpt', sid: '7c0d3e55-2a19-8001-b6f4-5e8a1d0c9b72', title: '글 목록 태그 필터', from: '09-27 13:02', to: '09-29 21:31', n: 9 }] },
  { id: 'task_20260703_01', title: '1차 디자인 시안', project: 'prj_blog', state: 'done', conf: 0.92, summary: '레퍼런스 4개 중 2번 방향(여백 넓은 단일 칼럼)', topics: ['blog', 'portfolio'],
    convs: [
      { ai: 'gemini', title: '레퍼런스 모음 정리', from: '07-03 19:30', to: '07-03 20:40', n: 8 },
      { ai: 'gemini', sid: 'c41f8e03a7b2d619', title: '헤더 레퍼런스 찾기', from: '07-15 21:02', to: '07-15 21:40', n: 9, summary: '여백 넓은 단일 칼럼 레퍼런스 4개. 헤더 문구 길이는 20자 이내가 좋다는 메모.', sharedWith: 'task_20260830_01' },
      { ai: 'chatgpt', title: '시안 피드백 정리', from: '07-21 22:10', to: '07-21 23:02', n: 10 },
    ] },
  { id: 'task_20260612_01', title: '섹션 구성안', project: 'prj_blog', state: 'done', conf: 0.9, summary: '소개·글 목록·프로젝트·연락 4섹션으로 확정', topics: ['blog'],
    convs: [{ ai: 'chatgpt', sid: '2e7b9f10-8c4d-8002-a3e1-6f0b2d9c7e48', title: '블로그 섹션 구성', from: '06-12 21:00', to: '06-12 22:10', n: 10 }, { ai: 'chatgpt', title: '섹션 순서 다시 보기', from: '06-20 21:40', to: '06-20 22:31', n: 9 }] },
  { id: 'task_20260615_01', title: '도메인·호스팅 결정', project: 'prj_blog', state: 'done', conf: 0.93, summary: 'Vercel + 기존 도메인 유지로 결정', topics: ['deploy'],
    convs: [{ ai: 'claude', sid: '5f81c0d2-3b6a-4e19-8d70-a1c4e9b2f063', title: '도메인과 호스팅 고르기', from: '06-15 20:12', to: '06-15 21:40', n: 11 }] },
  // 서브브레인
  { id: 'task_20260929_01', title: '분류 프롬프트 정확도 시험', project: 'prj_subbrain', state: 'run', conf: 0.88, topics: ['classification'],
    summary: '정답 세트 100건으로 정확도를 재는 중', detail: ['정답 세트 100건에 라벨을 붙이고 v2 프롬프트로 첫 시험을 돌림.', '77건 맞음 — 틀린 23건은 대부분 ‘간단한 질문’과 ‘완료’를 헷갈린 경우.'],
    next: '틀린 23건의 공통점 정리',
    convs: [
      { ai: 'claude', title: '분류 정답 세트 만들기', from: '09-29 14:40', to: '09-29 17:30', n: 28 },
      { ai: 'claude', title: '분류 프롬프트 v2 시험', from: '09-29 20:10', to: '09-30 00:20', n: 24,
        msgs: { 21: ['user', '정답 세트로 돌려 보니 100건 중 77건 맞았어. 틀린 23건은 내일 공통점을 정리해 보자.'], 22: ['assistant', '좋아요. 틀린 23건을 ‘간단한 질문↔완료’, ‘멈춤↔진행 중’으로 먼저 나눠 보면 원인이 빨리 보여요.'] } },
    ] },
  // 이사
  { id: 'task_20260914_01', title: '이사업체 견적 비교표', project: 'prj_moving', state: 'run', conf: 0.83, topics: ['quote'],
    summary: '이사업체 3곳 견적을 표로 비교하다가 B업체 추가 견적 대기 중', next: 'B업체 답장이 오면 표에 넣고 총액 다시 계산',
    convs: [{ ai: 'claude', sid: 'a1b2c3d4-7f60-4e2a-9b1c-5d8e3f0a6c27', title: '이사업체 견적 비교표', from: '09-14 20:30', to: '09-29 19:20', n: 24,
      msgs: { 1: ['user', '이사업체 3곳 견적을 표로 비교하고 싶어. A업체 180만, C업체 165만이고 B업체는 추가 견적을 기다리는 중이야.'], 6: ['assistant', 'A·C업체 견적은 표에 확정 반영했어요. B업체는 사다리차 포함 여부를 물어보고 받으면 넣을게요.'], 23: ['user', 'B업체 답장이 오면 표에 넣고 총액 다시 계산하자. 일단 오늘은 여기까지.'] } }] },
  { id: 'task_20260802_01', title: '포장이사 체크리스트', project: 'prj_moving', state: 'done', conf: 0.91, summary: '이사 한 달 전부터 당일까지 체크리스트 완성',
    convs: [{ ai: 'chatgpt', sid: '9f8e7d6c-1a2b-8005-d4e6-7b9c0a1f2e33', title: '포장이사 체크리스트', from: '08-02 21:00', to: '08-02 22:10', n: 10,
      msgs: { 6: ['assistant', '포장이사는 견적 받을 때 사다리차 비용이 따로인지 꼭 물어보세요. 엘리베이터 사용 예약도 미리 해 두면 좋아요.'], 9: ['user', '완벽해, 이 체크리스트대로 할게. 고마워!'] } }] },
  // 개발 공부
  { id: 'task_20260926_01', title: 'Next.js 배포 오류 해결', project: 'prj_devstudy', state: 'done', conf: 0.94, summary: '원인은 환경변수 이름 — 위키 초안으로 남김', topics: ['deploy'],
    convs: [
      { ai: 'claude', title: '배포 오류 로그 보기', from: '09-26 21:18', to: '09-26 22:02', n: 6 },
      { ai: 'claude', sid: '91d0f6a4-7e2b-4c58-a3f9-0b6d1e8c2a57', title: 'Next.js 배포 오류 해결', from: '09-29 09:40', to: '09-29 10:12', n: 14,
        msgs: { 12: ['assistant', '원인은 환경변수 이름이에요. 브라우저에서 쓰는 값은 NEXT_PUBLIC_ 접두사가 있어야 빌드에 포함돼요.'], 13: ['user', '해결됐어! 접두사 붙이니까 바로 되네. 고마워.'] } },
    ] },
];

// ───────── 대화를 자동으로 나누는 과제 (디자인 v3 수치 그대로: 메시지 수 · 마지막 날짜)
export const AUTO: AutoTask[] = [
  // 서브브레인
  { id: 'task_20260926_03', title: '수집 확장 MV3 골격', project: 'prj_subbrain', state: 'run', ai: 'chatgpt', msgs: 14, first: '09-26 20:00', last: '09-28 22:40', topics: ['automation'], summary: '크롬 확장 MV3 골격을 만들고 service worker에서 대화 캡처를 시험하는 중', next: 'content script에서 대화 DOM 변화 감지 붙이기' },
  { id: 'task_20260901_01', title: 'SQLite 스키마 설계', project: 'prj_subbrain', state: 'done', ai: 'claude', msgs: 31, first: '09-01 21:00', last: '09-08 22:30', summary: '대화·과제·이벤트 테이블과 FTS5 인덱스 구조를 확정' },
  { id: 'task_20260910_02', title: 'FTS5 한국어 검색', project: 'prj_subbrain', state: 'done', ai: 'claude', msgs: 18, first: '09-10 20:00', last: '09-14 21:40', topics: ['deploy'], summary: 'trigram 토크나이저 + 2글자는 LIKE로 보완하기로 결정' },
  { id: 'task_20260819_01', title: '로고 스케치', project: 'prj_subbrain', state: 'done', ai: 'chatgpt', msgs: 8, first: '08-19 21:00', last: '08-22 21:30', summary: '뇌 모양 대신 겹친 말풍선 두 개로 결정' },
  { id: 'task_20260915_01', title: '볼트 노트 형식', project: 'prj_subbrain', state: 'stall', ai: 'claude', msgs: 12, first: '09-15 20:30', last: '09-25 22:10', summary: '과제 노트 frontmatter 필드는 정했고 본문 섹션 순서를 고민하다 멈춤', next: '본문 섹션 순서(요약→결정→흐름) 확정하기' },
  { id: 'task_20260818_02', title: '비슷한 서비스 조사', project: 'prj_subbrain', state: 'done', ai: 'grok', msgs: 5, first: '08-18 20:03', last: '08-18 20:40', summary: '비슷한 서비스 4개를 훑어보고 ‘로컬 우선’이 차별점이라고 정리' },
  { id: 'task_20260924_01', title: '그래프 홈 시안', project: 'prj_subbrain', state: 'run', ai: 'claude', msgs: 21, first: '09-24 20:00', last: '09-29 22:40', summary: '그래프 홈의 노드 크기·색 규칙을 정하고 필터 막대를 그리는 중', next: '되감기 막대와 노드 흐림 효과 연결하기' },
  { id: 'task_20260919_02', title: '온보딩 문구 다듬기', project: 'prj_subbrain', state: 'done', ai: 'claude', msgs: 6, first: '09-19 20:10', last: '09-21 22:48', topics: ['copywriting'], summary: '첫 화면 문구를 3줄로 줄이고 버튼은 ‘가져오기 시작’으로' },
  // 이사
  { id: 'task_20260811_01', title: '전입신고 준비물', project: 'prj_moving', state: 'done', ai: 'claude', msgs: 7, first: '08-11 12:00', last: '08-11 12:40', summary: '신분증과 임대차계약서만 있으면 됨 — 온라인 신고도 가능' },
  { id: 'task_20260919_01', title: '인터넷 이전 신청', project: 'prj_moving', state: 'stall', ai: 'chatgpt', msgs: 9, first: '09-19 10:00', last: '09-26 21:10', summary: '이전 설치 날짜를 이사 당일로 잡을지 고민 중', next: '통신사에 이전 설치 가능한 날짜 문의하기' },
  { id: 'task_20260928_01', title: '가구 배치 스케치', project: 'prj_moving', state: 'run', ai: 'gemini', msgs: 4, first: '09-28 20:00', last: '09-28 21:00', summary: '거실 소파 위치를 두 가지로 그려 봄', next: '방 치수 재서 소파 위치 확정' },
  // 교토
  { id: 'task_20260920_01', title: '교토 3박 4일 일정', project: 'prj_kyoto', state: 'stall', ai: 'gemini', msgs: 31, first: '09-20 21:00', last: '09-26 23:50', summary: '둘째 날 아라시야마 동선에서 멈춤', next: '둘째 날 오후 동선을 버스 기준으로 다시 짜기',
    detail: ['첫날 후시미이나리·기요미즈데라, 셋째 날 우지는 확정.', '둘째 날 아라시야마 오후 동선(버스 vs 도보)을 고민하다 멈춤.'] },
  { id: 'task_20260905_01', title: '료칸 후보', project: 'prj_kyoto', state: 'done', ai: 'gemini', msgs: 6, first: '09-05 21:00', last: '09-07 21:30', summary: '조식 포함·기온 근처 료칸 한 곳으로 예약' },
  { id: 'task_20260922_02', title: 'JR 패스 계산', project: 'prj_kyoto', state: 'stall', ai: 'chatgpt', msgs: 8, first: '09-22 21:00', last: '09-24 21:40', conf: 0.55, summary: 'JR 패스와 개별 승차권 가격을 비교하다 멈춤', next: '간사이 와이드 패스 가격과 비교해서 결정' },
  { id: 'task_20260903_01', title: '10월 축제 찾기', project: 'prj_kyoto', state: 'done', ai: 'grok', msgs: 3, first: '09-03 22:00', last: '09-03 22:20', summary: '여행 기간에 겹치는 축제는 지다이 마쓰리(10/22) 하나' },
  // 배당
  { id: 'task_20260921_01', title: '배당 시트 환율 자동화', project: 'prj_dividend', state: 'stall', ai: 'grok', msgs: 16, first: '09-21 20:00', last: '09-21 21:30', topics: ['automation'], summary: 'GOOGLEFINANCE 환율 셀이 #N/A로 나와 멈춤', next: 'GOOGLEFINANCE 환율 셀이 #N/A 나는 원인 찾기' },
  { id: 'task_20260712_01', title: '배당 캘린더 정리', project: 'prj_dividend', state: 'done', ai: 'chatgpt', msgs: 12, first: '07-12 21:00', last: '07-15 22:00', summary: '보유 종목 배당 지급월을 캘린더 시트로 정리' },
  { id: 'task_20260924_03', title: 'ETF 분배금 세금', project: 'prj_dividend', state: 'stall', ai: 'grok', msgs: 4, first: '09-24 20:00', last: '09-24 20:30', summary: 'ETF 분배금 과세 방식을 묻다 멈춤', next: '국내 상장 해외 ETF 분배금 원천징수 확인' },
  // 커리어
  { id: 'task_20260827_01', title: '영문 이력서 다듬기', project: 'prj_career', state: 'stall', ai: 'chatgpt', msgs: 27, first: '08-27 20:00', last: '08-27 23:30', topics: ['portfolio'], summary: '경력 요약 문단을 세 번 고치다 멈춤', next: '경력 요약을 3줄로 줄이기' },
  { id: 'task_20260804_01', title: '포트폴리오 목차', project: 'prj_career', state: 'done', ai: 'chatgpt', msgs: 15, first: '08-04 20:00', last: '08-04 21:10', topics: ['portfolio'], summary: '포트폴리오 글을 블로그로 옮기기로 하고 목차 5개 확정' },
  { id: 'task_20260725_01', title: '자기소개서 첫 문단', project: 'prj_career', state: 'done', ai: 'claude', msgs: 9, first: '07-25 20:00', last: '07-26 21:00', summary: '첫 문단을 ‘만든 도구’ 이야기로 시작하기로 함' },
  { id: 'task_20260721_01', title: '링크드인 소개글', project: 'prj_career', state: 'done', ai: 'chatgpt', msgs: 6, first: '07-21 21:00', last: '07-21 21:40', summary: '소개글 3문장 확정' },
  // 개발 공부
  { id: 'task_20260901_02', title: 'React 19 use() 정리', project: 'prj_devstudy', state: 'done', ai: 'claude', msgs: 13, first: '09-01 21:00', last: '09-03 22:00', summary: 'use()는 Promise와 Context를 읽는 훅 — Suspense와 같이 씀' },
  { id: 'task_20260815_01', title: 'Docker 볼륨 권한', project: 'prj_devstudy', state: 'done', ai: 'chatgpt', msgs: 9, first: '08-15 21:00', last: '08-16 21:00', summary: '컨테이너 사용자 UID를 호스트와 맞춰 해결' },
  { id: 'task_20260808_01', title: 'Rust 소유권 메모', project: 'prj_devstudy', state: 'done', ai: 'grok', msgs: 7, first: '08-08 21:00', last: '08-09 21:30', summary: '빌림 규칙 두 가지를 예제로 정리' },
  { id: 'task_20260710_01', title: '타입스크립트 제네릭', project: 'prj_devstudy', state: 'done', ai: 'claude', msgs: 25, first: '07-10 21:00', last: '07-14 22:00', summary: '조건부 타입과 infer까지 예제로 정리' },
  { id: 'task_20260702_01', title: 'SQL 윈도 함수', project: 'prj_devstudy', state: 'done', ai: 'chatgpt', msgs: 5, first: '07-02 21:00', last: '07-02 21:40', summary: 'ROW_NUMBER·LAG 예제로 정리' },
  // 건강
  { id: 'task_20260927_02', title: '러닝 10km 준비', project: 'prj_health', state: 'run', ai: 'gemini', msgs: 11, first: '09-27 07:00', last: '09-29 07:40', summary: '10주 훈련표를 짜는 중, 3주차까지 확정', next: '4주차 인터벌 거리 정하기' },
  { id: 'task_20260921_03', title: '홈트 루틴 식단', project: 'prj_health', state: 'stall', ai: 'gemini', msgs: 7, first: '09-21 07:30', last: '09-26 08:05', summary: '주 3회 홈트 루틴은 정했고 식단 부분을 고민 중', next: '아침 식단 3가지 후보 중 하나 고르기' },
  { id: 'task_20260826_01', title: '영양제 조합', project: 'prj_health', state: 'done', ai: 'chatgpt', msgs: 4, first: '08-26 21:00', last: '08-26 21:20', summary: '비타민 D·마그네슘만 먹기로 함' },
  // 프로젝트 없음
  { id: 'task_20260924_02', title: '소개 페이지 문장 다듬기', project: null, state: 'stall', ai: 'chatgpt', msgs: 12, first: '09-24 20:00', last: '09-24 21:10', conf: 0.52, topics: ['copywriting'], summary: '소개 페이지 문장을 짧게 고치는 중', next: '소개 문단 두 번째 문장 줄이기' },
  { id: 'task_20260928_02', title: '전세 계약 특약 문구 검토', project: null, state: 'done', ai: 'chatgpt', msgs: 12, first: '09-28 21:00', last: '09-29 16:05', summary: '특약 5개 문구를 다듬고 확정' },
];

// ───────── 간단한 질문 [제목, 프로젝트, AI, 'MM-DD HH:MM', 확신도?]
export const QUICK: Array<[title: string, project: string | null, ai: SourceAi, at: string, conf?: number]> = [
  ['hero 섹션 높이 vh 단위', 'prj_blog', 'chatgpt', '09-28 11:05'], ['og:image 권장 크기', 'prj_blog', 'chatgpt', '09-18 14:10'], ['favicon 다크 모드', 'prj_blog', 'claude', '09-09 22:30'],
  ['SQLite WAL 모드 장단점', 'prj_subbrain', 'claude', '09-29 11:20'], ['pnpm workspace 필터', 'prj_subbrain', 'chatgpt', '09-27 16:40'], ['MV3 service worker 수명', 'prj_subbrain', 'chatgpt', '09-26 18:10'],
  ['zod v4 차이', 'prj_subbrain', 'claude', '09-22 13:00'], ['Hono 미들웨어 순서', 'prj_subbrain', 'claude', '09-16 15:30'],
  ['전입신고 기한', 'prj_moving', 'chatgpt', '09-20 12:10'], ['냉장고 운반 전 전원', 'prj_moving', 'gemini', '09-29 19:40'],
  ['교토 10월 평균 기온', 'prj_kyoto', 'gemini', '09-21 08:10'], ['엔화 환전 수수료', 'prj_kyoto', 'grok', '09-23 12:30'], ['ICOCA 잔액 환불', 'prj_kyoto', 'chatgpt', '09-25 22:20'],
  ['GOOGLEFINANCE 지연 시간', 'prj_dividend', 'grok', '09-21 19:40'], ['원천징수 15.4%', 'prj_dividend', 'chatgpt', '09-12 10:00'],
  ['영문 이력서 동사 목록', 'prj_career', 'chatgpt', '08-27 19:30'], ['STAR 기법', 'prj_career', 'claude', '08-24 21:00'],
  ['git rebase 취소', 'prj_devstudy', 'chatgpt', '09-28 09:20'], ['CSS :has() 지원', 'prj_devstudy', 'claude', '09-24 15:00'], ['정규식 lookahead 예시', 'prj_devstudy', 'claude', '09-19 10:30'], ['Tailwind line-clamp', 'prj_devstudy', 'claude', '09-15 16:00'],
  ['단백질 하루 권장량', 'prj_health', 'gemini', '09-25 07:50'],
  ['정규식 이메일 패턴', null, 'chatgpt', '09-29 10:02', 0.48], ['환율 1달러 몇 원', null, 'grok', '09-29 18:05'], ['맥 스크린샷 단축키', null, 'gemini', '09-27 10:00'], ['HTTP 204 의미', null, 'claude', '09-20 11:20'],
];

// ───────── 보관 과제 (프로젝트 합계를 디자인 수치에 맞추는 채우기 + 4~6월 활동)
export interface ArchivedDef { id: string; title: string; project: string | null; ai: SourceAi; convs: number; msgs: number; from: string; to: string }
export const ARCHIVED_BLOG: Array<{ id: string; title: string; convs: Array<[SourceAi, string, string, number]> }> = [
  { id: 'task_20260611_01', title: '블로그 플랫폼 비교 (Ghost vs Next.js)', convs: [['chatgpt', '06-11 20:03', '06-11 21:00', 10], ['chatgpt', '06-12 20:00', '06-12 20:40', 10], ['chatgpt', '06-13 21:00', '06-13 21:30', 10], ['chatgpt', '06-14 20:00', '06-14 20:30', 10], ['chatgpt', '06-14 22:00', '06-14 22:30', 10]] },
  { id: 'task_20260618_01', title: '글 목록 페이지네이션 초안', convs: [['chatgpt', '06-18 21:00', '06-18 21:40', 10], ['chatgpt', '06-20 20:00', '06-20 20:30', 10], ['chatgpt', '06-23 21:00', '06-23 21:30', 10], ['chatgpt', '06-25 21:00', '06-25 21:20', 10]] },
  { id: 'task_20260705_01', title: '다크 모드 색 팔레트', convs: [['chatgpt', '07-05 20:00', '07-05 20:40', 10], ['chatgpt', '07-07 21:00', '07-07 21:30', 10], ['chatgpt', '07-10 20:00', '07-10 20:30', 10], ['chatgpt', '07-12 22:00', '07-12 22:20', 8]] },
  { id: 'task_20260622_01', title: '댓글 기능 넣을지 고민', convs: [['claude', '06-22 21:00', '06-22 21:30', 8], ['claude', '06-24 20:00', '06-24 20:20', 8], ['claude', '06-27 21:00', '06-27 21:20', 8], ['claude', '06-29 22:00', '06-29 22:10', 6]] },
  { id: 'task_20260726_01', title: '뉴스레터 붙이기 검토', convs: [['claude', '07-26 21:00', '07-26 21:30', 8], ['claude', '07-27 20:00', '07-27 20:20', 8], ['claude', '07-30 21:00', '07-30 21:20', 8], ['claude', '08-01 22:00', '08-01 22:10', 6]] },
  { id: 'task_20260812_01', title: '썸네일 자동 생성 실험', convs: [['gemini', '08-12 20:00', '08-12 20:30', 8], ['gemini', '08-13 21:00', '08-13 21:20', 6], ['gemini', '08-15 20:00', '08-15 20:20', 8], ['gemini', '08-17 21:00', '08-17 21:10', 6], ['grok', '08-18 22:00', '08-18 22:20', 6]] },
];
/** 프로젝트 합계(디자인 v3): 대화 수 · 메시지 수 (간단한 질문 · 보관 포함, 공유 대화는 한 번) */
export const PROJECT_TOTALS: Record<string, { conv: number; msgs: number }> = {
  prj_blog: { conv: 43, msgs: 402 }, prj_subbrain: { conv: 58, msgs: 475 }, prj_moving: { conv: 19, msgs: 160 }, prj_kyoto: { conv: 12, msgs: 140 },
  prj_dividend: { conv: 11, msgs: 110 }, prj_career: { conv: 16, msgs: 150 }, prj_devstudy: { conv: 22, msgs: 200 }, prj_health: { conv: 9, msgs: 70 },
};
/** 채우기 보관 과제 틀 — 대화 수·메시지 수는 PROJECT_TOTALS와의 차이로 채운다(비율은 weight) */
export const FILLERS: Array<{ id: string; title: string; project: string; ai: SourceAi; from: string; to: string; weight: number }> = [
  { id: 'task_20260818_05', title: '메모 앱으로 먼저 만들어 보기', project: 'prj_subbrain', ai: 'chatgpt', from: '08-18 21:00', to: '08-24 22:00', weight: 8 },
  { id: 'task_20260825_05', title: '노션 연동 검토', project: 'prj_subbrain', ai: 'claude', from: '08-25 21:00', to: '08-31 22:00', weight: 7 },
  { id: 'task_20260901_05', title: 'Electron vs Tauri 비교', project: 'prj_subbrain', ai: 'claude', from: '09-01 20:00', to: '09-06 22:00', weight: 7 },
  { id: 'task_20260907_05', title: '임베딩 검색 실험', project: 'prj_subbrain', ai: 'chatgpt', from: '09-07 20:00', to: '09-12 22:00', weight: 7 },
  { id: 'task_20260913_05', title: '대화 요약 길이 실험', project: 'prj_subbrain', ai: 'grok', from: '09-13 20:00', to: '09-17 22:00', weight: 7 },
  { id: 'task_20260728_05', title: '원룸 vs 투룸 비교', project: 'prj_moving', ai: 'chatgpt', from: '07-28 20:00', to: '08-05 22:00', weight: 6 },
  { id: 'task_20260820_05', title: '청소업체 알아보기', project: 'prj_moving', ai: 'claude', from: '08-20 20:00', to: '08-28 22:00', weight: 5 },
  { id: 'task_20260902_05', title: '오사카 당일치기 검토', project: 'prj_kyoto', ai: 'gemini', from: '09-02 21:00', to: '09-08 22:30', weight: 3 },
  { id: 'task_20260710_05', title: '미국 배당주 스크리닝', project: 'prj_dividend', ai: 'chatgpt', from: '07-10 21:00', to: '07-20 22:00', weight: 6 },
  { id: 'task_20260720_05', title: '이직 회사 리스트', project: 'prj_career', ai: 'chatgpt', from: '07-20 21:00', to: '07-28 22:00', weight: 5 },
  { id: 'task_20260810_05', title: '연봉 협상 준비', project: 'prj_career', ai: 'claude', from: '08-10 21:00', to: '08-18 22:00', weight: 4 },
  { id: 'task_20260620_05', title: 'Go 기초 문법', project: 'prj_devstudy', ai: 'chatgpt', from: '06-20 21:00', to: '06-28 22:00', weight: 5 },
  { id: 'task_20260718_05', title: 'Kubernetes 입문', project: 'prj_devstudy', ai: 'claude', from: '07-18 21:00', to: '07-25 22:00', weight: 5 },
  { id: 'task_20260825_06', title: '수면 기록 앱 비교', project: 'prj_health', ai: 'gemini', from: '08-25 21:00', to: '08-31 22:00', weight: 5 },
];
/** 4~6월 활동(프로젝트 없음, 보관) — 26주 활동 막대가 비지 않도록 */
export const OLD_ARCHIVED: ArchivedDef[] = [
  { id: 'task_20260406_01', title: '가계부 앱 비교', project: null, ai: 'chatgpt', convs: 6, msgs: 60, from: '04-06 21:00', to: '04-20 22:00' },
  { id: 'task_20260408_01', title: '영어 회화 표현 모음', project: null, ai: 'chatgpt', convs: 7, msgs: 70, from: '04-08 08:00', to: '04-29 08:30' },
  { id: 'task_20260413_01', title: '엑셀 매크로 공부', project: null, ai: 'claude', convs: 6, msgs: 66, from: '04-13 21:00', to: '05-01 22:00' },
  { id: 'task_20260427_01', title: '부산 여행 코스', project: null, ai: 'gemini', convs: 6, msgs: 54, from: '04-27 20:00', to: '05-12 21:00' },
  { id: 'task_20260504_01', title: '홈카페 원두 추천', project: null, ai: 'chatgpt', convs: 6, msgs: 48, from: '05-04 10:00', to: '05-20 11:00' },
  { id: 'task_20260511_01', title: '옛 블로그 글 이전 계획', project: null, ai: 'claude', convs: 7, msgs: 77, from: '05-11 20:00', to: '05-29 21:00' },
  { id: 'task_20260518_01', title: '사진 정리 규칙', project: null, ai: 'grok', convs: 6, msgs: 48, from: '05-18 21:00', to: '06-05 22:00' },
  { id: 'task_20260525_01', title: '독서 메모 템플릿', project: null, ai: 'claude', convs: 6, msgs: 60, from: '05-25 21:00', to: '06-12 22:00' },
  { id: 'task_20260601_01', title: 'MBTI 궁합 잡담', project: null, ai: 'grok', convs: 4, msgs: 32, from: '06-01 23:00', to: '06-16 23:30' },
];

export const DECISIONS: Array<[id: string, task: string, text: string, conv: string, ai: SourceAi, at: string]> = [
  ['obj_decision_7a1c', 'task_20260830_01', '메인 카피는 한 줄 + 보조 한 줄 구조로 간다', 'conv_chatgpt_5d1e77b0', 'chatgpt', '09-12 22:41'],
  ['obj_decision_7a1d', 'task_20260830_01', '과장 표현은 쓰지 않는다 (‘혁신’, ‘세상을 바꾸는’ 등)', 'conv_chatgpt_5d1e77b0', 'chatgpt', '09-12 22:18'],
  ['obj_decision_2f90', 'task_20260830_01', '보이스: 1인칭, 짧은 문장, 느낌표 없음', 'conv_claude_a7c3e210', 'claude', '09-03 21:05'],
  ['obj_decision_b812', 'task_20260830_01', '후보는 A(담백한 소개형)와 B(질문형) 둘로 좁힘', 'conv_chatgpt_68f2a91c', 'chatgpt', '09-18 01:30'],
  ['obj_decision_5c02', 'task_20260914_01', 'A·C업체 견적은 표에 확정 반영', 'conv_claude_a1b2c3d4', 'claude', '09-14 21:40'],
];
export const COPY_OPEN_QUESTIONS = [
  { id: 'oq_20260830_01_1', text: 'A안이 밋밋한가? 두 번째 줄에 숫자를 넣을지', resolved: false, note: '9.18 ChatGPT 대화 마지막에서', sourceConversationId: 'conv_chatgpt_68f2a91c', resolvedAt: null },
  { id: 'oq_20260830_01_2', text: 'CTA를 ‘글 읽기’로 할지 ‘뉴스레터 구독’으로 할지', resolved: false, note: '뉴스레터 자체가 보류 상태 — 섹션 구성안 참고', sourceConversationId: 'conv_chatgpt_5d1e77b0', resolvedAt: null },
  { id: 'oq_20260830_01_3', text: '영문 병기 여부', resolved: false, note: '한 번 언급되고 결론 없음', sourceConversationId: 'conv_claude_3b9d4f12', resolvedAt: null },
];
export const COPY_RESUME_PROMPT = [
  '[맥락] 블로그 리뉴얼 — 개인 블로그 메인 카피를 정하는 중.',
  '결정: 한 줄+보조 한 줄 / 과장 금지 / 1인칭·짧은 문장·느낌표 없음',
  '후보 A: “작은 도구를 만들고, 만든 과정을 씁니다.”',
  '후보 B: “왜 어떤 도구는 오래 쓰게 될까요?”',
  '남은 질문: A가 밋밋한지, 두 번째 줄에 숫자를 넣을지 / CTA를 ‘글 읽기’로 할지 ‘뉴스레터 구독’으로 할지',
  '요청: A를 기준으로 보조 문장 3개와 CTA 2개를 제안해 줘.',
].join('\n');

// ───────── 데이터셋 묶음 (seed.ts가 쓰는 형태 — 영어 예시는 seed-data-en.ts)
export interface SeedText {
  suffix: string[]; U: Array<(t: string) => string>; A: Array<(t: string) => string>;
  quickQ: (t: string) => string; quickA: (t: string) => string; resolved: string; unresolved: string;
  archivedSummary: (t: string) => string; quickSummary: (t: string) => string; convSummary: (t: string) => string;
  evDone: string; evQuick: string; evOpen: string; sampleNote: string; doneLabel: string;
}
export interface SeedExtras {
  sensitiveKeywords: string[]; sensitiveProjectIds: string[];
  copyTaskId: string; copyResumeAt: string;
  taskLinks: Array<{ src: string; dst: string; type: string; conf: number; reason: string; at: string }>;
  projectLinks: Array<{ a: string; b: string; reason: string; topics: string[]; w: number }>;
  mergeSuggestions: Array<{ id: string; a: string; b: string; primary: string; conf: number; reason: string; at: string }>;
  handoff: { taskId: string; label: string; target: string; evidence: string };
  interrupted: { evidence: string; reason: string };
  blocked: { taskId: string; evidence: string };
  projectSuggestion: { taskId: string; name: string; alt: string[]; at: string };
  vaultConflict: { taskId: string; note: string };
}
export interface SeedTimes {
  projectCreated: string; capturedAt: string; importDay: string; importId: string; importCreated: string; importStarted: string; importFinished: string;
  syncChatgpt: string; syncClaude: string; digestDays: string[]; digestAt: string; archiveCap: string;
}
export interface SeedDataset {
  lang: 'ko' | 'en';
  PROJECTS: typeof PROJECTS; TOPICS: typeof TOPICS; EXPLICIT: TaskSpec[]; AUTO: AutoTask[]; QUICK: typeof QUICK;
  archivedProject: string; ARCHIVED_BLOG: typeof ARCHIVED_BLOG; PROJECT_TOTALS: typeof PROJECT_TOTALS; FILLERS: typeof FILLERS; OLD_ARCHIVED: ArchivedDef[];
  DECISIONS: typeof DECISIONS; COPY_OPEN_QUESTIONS: typeof COPY_OPEN_QUESTIONS; COPY_RESUME_PROMPT: string;
  quickSids: Record<string, string>; text: SeedText; extras: SeedExtras; times: SeedTimes; ontology?: OntologyGraphResponse;
}

export const KO_DATASET: SeedDataset = {
  lang: 'ko', PROJECTS, TOPICS, EXPLICIT, AUTO, QUICK, archivedProject: 'prj_blog', ARCHIVED_BLOG, PROJECT_TOTALS, FILLERS, OLD_ARCHIVED, DECISIONS, COPY_OPEN_QUESTIONS, COPY_RESUME_PROMPT,
  quickSids: { '교토 10월 평균 기온': '2d9f0a61b3c4e5f7' },
  text: {
    suffix: ['', ' — 이어서', ' — 다시 보기', ' — 정리', ' — 마무리', ' — 확인', ' — 추가 질문', ' — 메모'],
    U: [
      (t) => `${t} 관련해서 같이 정리해 줄래?`, () => '방금 말한 것 중에 두 번째가 잘 이해가 안 돼.', (t) => `좋아. 그럼 ${t}에서 제일 먼저 할 일은 뭐야?`,
      () => '조금 더 짧게, 목록으로 정리해 줘.', () => '예시를 하나만 더 들어 줘.', () => '이 방향이 맞는 것 같아. 다음 단계로 가자.',
    ],
    A: [
      (t) => `${t}을(를) 기준으로 보면 세 가지로 나눌 수 있어요. 1) 목표 정하기 2) 선택지 비교 3) 결정 기록하기.`,
      () => '두 번째는 “지금 당장 필요한가”로 거르는 단계예요. 필요 없으면 나중 목록으로 옮겨요.',
      (t) => `${t}의 첫 단계는 현재 상태를 한 줄로 적는 거예요. 그다음 막힌 지점을 하나만 고르세요.`,
      () => '- 핵심 한 줄\n- 선택지 2개\n- 다음 행동 1개', () => '예를 들면, 오늘 30분 안에 끝낼 수 있는 작은 일부터 정하는 식이에요.', () => '좋아요. 다음 단계에서는 결정한 내용을 짧게 기록해 둘게요.',
    ],
    quickQ: (t) => `${t}?`, quickA: (t) => `${t}에 대한 짧은 답: 가장 흔한 방법 하나와 주의할 점 하나를 알려 드릴게요.`,
    resolved: '해결됐어, 정리 고마워!', unresolved: '일단 여기까지 하고 나중에 다시 볼게.',
    archivedSummary: (t) => `${t} — 보관함`, quickSummary: (t) => `${t} — 짧은 질문과 답`, convSummary: (t) => `${t} 대화`,
    evDone: '‘해결됐어’로 끝남', evQuick: '짧은 질문 하나에 답 하나', evOpen: '마지막 사용자 메시지: ‘나중에 다시 볼게’', sampleNote: '예시 데이터', doneLabel: '완료',
  },
  extras: {
    sensitiveKeywords: ['건강', '연봉'], sensitiveProjectIds: ['prj_health'],
    copyTaskId: 'task_20260830_01', copyResumeAt: '2026-09-18T01:52:30+09:00',
    taskLinks: [{ src: 'task_20260902_01', dst: 'task_20260830_01', type: 'derived_from', conf: 0.86, reason: '메인 카피가 정해지면 같은 톤으로 다시 쓰기로 함', at: '09-24 22:15' }],
    projectLinks: [
      { a: 'prj_blog', b: 'prj_subbrain', reason: '같은 주제 #카피라이팅 · 겹치는 과제 1개', topics: ['obj_topic_copywriting'], w: 2 },
      { a: 'prj_blog', b: 'prj_career', reason: '포트폴리오 글을 블로그로 옮기기로 함 (8월 4일)', topics: ['obj_topic_portfolio'], w: 1.5 },
      { a: 'prj_blog', b: 'prj_devstudy', reason: 'Next.js 배포 위키 2건을 참고함', topics: ['obj_topic_deploy'], w: 1 },
    ],
    mergeSuggestions: [{ id: 'ms_4410', a: 'task_20260902_01', b: 'task_20260924_02', primary: 'task_20260902_01', conf: 0.74, reason: '같은 주제 #카피라이팅 · Claude에서 시작한 소개 페이지 톤 작업을 ChatGPT에서 이어간 것으로 보임', at: '09-25 03:02' }],
    handoff: { taskId: 'task_20260915_01', label: 'Claude Code에서 이어감', target: 'Claude Code', evidence: '마지막 사용자 메시지: ‘노트 형식은 md로 정리해줘, Claude Code에서 이어갈게’' },
    interrupted: { evidence: '마지막 사용자 메시지: ‘토큰이 다 떨어져서 오늘은 여기까지, 정리 파일 md로 만들어줘’', reason: '토큰 한도' },
    blocked: { taskId: 'task_20260922_02', evidence: '제공자가 안전 정책으로 분류를 거부함(PROHIBITED_CONTENT) — 규칙 분류 결과로 대신 채움' },
    projectSuggestion: { taskId: 'task_20260928_02', name: '전세 계약 정리', alt: ['전세계약 서류'], at: '09-28 21:40' },
    vaultConflict: { taskId: 'task_20260914_01', note: '(Obsidian에서 직접 적은 메모: B업체 전화해 보기)' },
  },
  times: {
    projectCreated: '06-01 09:00', capturedAt: '09-30 08:05', importDay: '2026-09-30', importId: 'imp_20260930_k3f9',
    importCreated: '2026-09-30T08:02:10+09:00', importStarted: '2026-09-30T08:04:31+09:00', importFinished: '2026-09-30T08:41:07+09:00',
    syncChatgpt: '2026-09-30T08:05:12+09:00', syncClaude: '2026-09-28T21:40:03+09:00',
    digestDays: ['2026-09-28', '2026-09-29', '2026-09-30'], digestAt: '08:00:03', archiveCap: '2026-09-28',
  },
};
