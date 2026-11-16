// 모의 모드 보강 데이터 (웹 전용). 1.0.1부터 거의 모든 데이터는 공유 목(엔진 캡처)을 그대로 쓰고,
// 여기엔 공유 목에 없는 것 하나만 남았다: 삭제 배치(LATER 6)의 "전체 항목".
// 공유 예시(digestCleanupLater·deletionBatchResponse)는 그룹마다 1~2개 항목만 싣고 total은 21·12라,
// "N개 더 보기"(GET /deletion-batches/:id = 그룹 items 전부, §14.1)를 미리 보여 주려면 나머지 항목이 필요하다.
import type { ClassificationState, DeletionBatch, HandoffInfo, ProjectSuggestion } from '@subbrain/shared';
import { clone, M } from './shared';

type Item = DeletionBatch['groups'][number]['items'][number];
const it = (itemId: number, ai: string, title: string, kindLabel: string, date: string): Item =>
  ({ itemId, conversationId: `conv_${ai}_demo${itemId}`, title, kindLabel, date: `2026-${date}`, selected: true, excludedByUser: false });
const FILLER: Record<string, Item[]> = {
  claude: [
    it(502, 'claude', 'SQLite FTS5 한국어 검색 설정', '완료', '09-26'), it(503, 'claude', '정규식 lookahead 예시', '간단한 질문', '09-22'),
    it(505, 'claude', '‘effect’와 ‘affect’ 차이', '간단한 질문', '09-19'), it(506, 'claude', '회의록 템플릿 — 주간 회고용으로 다시', '완료', '09-18'),
    it(507, 'claude', 'Tailwind에서 line-clamp 쓰는 법', '간단한 질문', '09-16'),
    ...['CSS :has() 지원 범위', 'Docker 볼륨 권한', 'Rust 소유권 메모', 'git rebase 취소', '타입스크립트 제네릭 예제', 'SQL 윈도 함수', 'zod v4 차이', 'Hono 미들웨어 순서',
      'MV3 service worker 수명', 'pnpm workspace 필터', 'SQLite WAL 모드', 'React 19 use()', '자기소개서 첫 문단', '링크드인 소개글']
      .map((t, k) => it(508 + k, 'claude', t, k % 3 === 0 ? '간단한 질문' : '완료', `09-${String(15 - Math.floor(k / 2)).padStart(2, '0')}`)),
  ],
  gemini: [
    it(521, 'gemini', '부모님 생신 선물 리스트', '완료', '09-23'), it(523, 'gemini', '1인치는 몇 cm?', '간단한 질문', '09-21'),
    it(524, 'gemini', '헤더 레퍼런스 찾기 (공유 대화)', '완료', '09-19'),
    ...['료칸 후보', '10월 축제 찾기', '엔화 환전 수수료', 'ICOCA 잔액 환불', '가구 배치 스케치 1차', '러닝화 사이즈', '단백질 하루 권장량', '홈트 스트레칭']
      .map((t, k) => it(525 + k, 'gemini', t, k % 2 ? '간단한 질문' : '완료', `09-${String(18 - k).padStart(2, '0')}`)),
  ],
};

/** 전체 배치(모든 항목) — GET /deletion-batches/:id 모의 응답의 원본. 공유 예시 항목이 먼저, 모자란 만큼 채운다. */
export function demoDeletionBatchFull(): DeletionBatch {
  const b = clone(M.digestCleanupLater.deletionBatch)!;
  for (const g of b.groups) {
    const have = new Set(g.items.map((i) => i.itemId));
    g.items = [...g.items, ...(FILLER[g.sourceAi] ?? []).filter((e) => !have.has(e.itemId))].slice(0, g.total)
      .sort((a, b2) => b2.date.localeCompare(a.date) || a.itemId - b2.itemId);
    g.selected = g.items.filter((i) => i.selected).length;
  }
  b.selectedCount = b.groups.reduce((s, g) => s + g.selected, 0);
  return b;
}
/** 요약에 싣는 모양: 그룹마다 앞쪽 일부만 (디자인: Claude 7개, Gemini 4개 + "N개 더 보기") */
export function previewBatch(full: DeletionBatch): DeletionBatch {
  const b = clone(full);
  const shown: Record<string, number> = { claude: 7, gemini: 4 };
  for (const g of b.groups) g.items = g.items.slice(0, shown[g.sourceAi] ?? 5);
  return b;
}

// ── 1.1.0 미리보기 (웹 전용 모의 보강) ──
// 공유 목(엔진 캡처)은 예시 데이터에 handoff·분류 불가가 하나도 없어(전부 null/ok) 화면이 비어 보인다.
// 모의 모드에서만 아래 몇 과제에 1.1.0 표시를 덧씌워 배지·"확인 필요" 모양을 미리 본다. 라이브(코어)는 영향 없음.

export interface Aug110 { handoff?: HandoffInfo; blocked?: { reason: string; model: string }; rawConfidence?: number }
export const AUG_110: Record<string, Aug110> = {
  // 진행 중 + Claude Code로 넘김 (규칙·LLM 모두 감지)
  task_20260929_01: { handoff: { label: 'Claude Code에서 이어감', target: 'Claude Code', conversationId: 'conv_claude_7dee29ba', evidence: '지금까지 정리한 거 md로 만들어줘, Claude Code에서 이어갈게', detectedBy: 'both' }, rawConfidence: 0.97 },
  // 멈춤(5일) + 대상 모름
  task_20260915_01: { handoff: { label: '다른 곳에서 이어감', target: null, conversationId: 'conv_claude_7a52cdde', evidence: '토큰 떨어져서 정리 파일 만들어줘', detectedBy: 'rule' } },
  // 제공자 안전 필터가 막아 규칙 분류로 채운 과제
  task_20260921_03: { blocked: { reason: 'PROHIBITED_CONTENT', model: 'gemini-3.5-flash-lite' } },
  // 확신도 보정: 모델은 0.9였지만 규칙 신호와 달라 0.55로 낮춤
  task_20260922_02: { rawConfidence: 0.9 },
};
export const aug110 = (id: string): Aug110 | undefined => AUG_110[id];
/** 목록 행(TaskListItem 모양)에 1.1.0 키를 채운다 — 엔진은 항상 보내는 키 */
export function augRow<T extends { id: string; needsReview?: boolean; handoff?: HandoffInfo | null; classificationState?: ClassificationState }>(row: T): T {
  const a = AUG_110[row.id];
  return { ...row, handoff: a?.handoff ?? row.handoff ?? null, classificationState: a?.blocked ? 'blocked' : row.classificationState ?? 'ok', needsReview: a?.blocked ? true : row.needsReview };
}

/** 공유 목 제안(ready) 뒤에 붙이는 "아직 모이는 중"(ready:false) 제안 하나 — 목록 모양 미리보기용 */
export const EXTRA_PROJECT_SUGGESTIONS: ProjectSuggestion[] = [{
  id: 'psg_web_demo1', name: '문장 다듬기', altNames: ['글쓰기 연습'], state: 'pending', ready: false, taskCount: 1, minTasks: 3,
  tasks: [{ id: 'task_20260924_02', title: '소개 페이지 문장 다듬기', status: '멈춤', statusVisual: 'stall2', staleDays: 6, projectId: null, sourceAis: ['chatgpt'] }],
  projectId: null, createdAt: '2026-09-24T21:15:30+09:00', updatedAt: '2026-09-24T21:15:30+09:00', decidedAt: null,
}];
