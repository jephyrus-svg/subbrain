/**
 * API v1 정적 목(mock) 예시 — 예시 데이터(시드)로는 재현되지 않는 상태만 여기서 손으로 적는다.
 *   가져오기 진행 단계(새 대용량 가져오기 가정) · 작업(job) · LLM 연결 시험 · 오류 · LATER 예시(온톨로지 카드, 채팅창 정리/삭제 배치).
 * 나머지 응답 예시(health·graph·task·digest·search …)는 엔진이 만든다: `pnpm --filter @subbrain/core mocks`
 *   → 임시 홈에 시드를 넣고 실제 라우트 응답을 캡처해 mocks/json/<이름>.json 으로 쓴다(엔진 = 목의 유일한 출처).
 * 이 파일은 tsc로 api-types.ts와 맞는지 검사하고, `node --experimental-strip-types mocks/dump.ts`가 JSON으로 쓴다.
 * 기준일: 2026-09-30 (KST).
 */
import type {
  ApiError, ApproveDeletionBody, CollectionSourceStatus, DeletionBatchResponse, DigestCleanup, DigestOntologyCard, ImportJob, Job, LlmTestResponse,
} from '../src/api-types.ts';

// ── 3. dashboard — MVP(내보내기 가져오기만)의 collection.sources 예시
export const collectionMvpExample: CollectionSourceStatus[] = [
  { sourceAi: 'chatgpt', methods: ['export'], methodLabel: '내보내기 가져오기', lastCapturedAt: '2026-09-30T08:05:12+09:00', health: 'ok', message: null },
  { sourceAi: 'claude', methods: ['export'], methodLabel: '내보내기 가져오기', lastCapturedAt: '2026-09-28T21:40:03+09:00', health: 'ok', message: null },
];

// ── 11. digest LATER 예시
/** LATER(1.5) — digest.ontology 예시 */
export const digestOntologyLater: DigestOntologyCard = {
  newlyLinkedCount: 7, pendingCount: 3,
  items: [{
    id: 'sg_1102', kind: 'link', confidence: 0.74, text: '[과제] 메인 페이지 카피 확정 —막혔음→ [과제] 디자이너 답변 대기', linkType: 'blocked_by',
    src: { id: 'obj_task_20260830_01', type: 'task', label: '메인 페이지 카피 확정' }, dst: { id: 'obj_task_20260916_02', type: 'task', label: '디자이너 답변 대기' },
    evidenceCount: 1, evidence: [{ conversationId: 'conv_chatgpt_68f2a91c', sourceAi: 'chatgpt', excerpt: '디자이너가 폰트 크기 답을 줘야 카피 길이를 정할 수 있어', at: '2026-09-18T01:20:00+09:00' }],
  }],
};

/** LATER(6) — digest.cleanup 예시 */
export const digestCleanupLater: DigestCleanup = {
  autoArchived: [{ sourceAi: 'chatgpt', count: 31, note: '언제든 보관 해제 가능' }],
  deletionBatch: {
    id: 'del_20260930', state: 'pending', selectedCount: 32, candidateCount: 34,
    groups: [
      { sourceAi: 'claude', selected: 20, total: 21, backupVerified: true, items: [
        { itemId: 501, conversationId: 'conv_claude_91d0f6a4', title: 'Next.js 배포 오류 해결', kindLabel: '완료 · 위키', date: '2026-09-29', selected: true, excludedByUser: false },
        { itemId: 504, conversationId: 'conv_claude_5f81c0d2', title: '도메인과 호스팅 고르기', kindLabel: '완료', date: '2026-06-15', selected: false, excludedByUser: true },
      ] },
      { sourceAi: 'gemini', selected: 12, total: 12, backupVerified: true, items: [
        { itemId: 522, conversationId: 'conv_gemini_2d9f0a61', title: '교토 10월 평균 기온', kindLabel: '간단한 질문', date: '2026-09-21', selected: true, excludedByUser: false },
      ] },
    ],
    autoExcluded: [
      { count: 4, sourceAi: 'grok', reason: '어댑터 점검 중' },
      { count: 2, sourceAi: null, reason: '서비스 안 프로젝트 폴더' },
      { count: 1, sourceAi: null, reason: '공유 링크가 있음' },
      { count: 1, sourceAi: null, reason: '캔버스를 수집하지 못함' },
    ],
    estimate: { perItemSec: 4, totalMin: 3, label: '건당 4초 간격, 3분쯤 걸려요' },
  },
};

// ── 14. LATER(6) 삭제 배치 — [잠정] 승인 요청/응답 예시
/** POST /deletion-batches/:id/approve 요청 본문: 화면에서 본 선택 수와 서버 계산이 다르면 409 */
export const approveDeletionBody: ApproveDeletionBody = { expectedSelectedCount: 32, excludedItemIds: [504], confirmPhrase: '삭제 승인' };
/** approve 응답 — 상태가 approved로 바뀐 배치 (postpone 응답도 같은 모양, state만 'postponed') */
export const deletionBatchResponse: DeletionBatchResponse = { batch: { ...digestCleanupLater.deletionBatch!, state: 'approved' } };
export const deletionBatchPostponed: DeletionBatchResponse = { batch: { ...digestCleanupLater.deletionBatch!, state: 'postponed' } };

// ── 12. imports — 새 대용량 가져오기(가정)의 단계별 모양. 완료된 예시(importDone·importsList)는 엔진이 시드에서 만든다
const importBase: ImportJob = {
  id: 'imp_20260930_n8w1', state: 'parsing', sourceAi: null, fileName: 'chatgpt-export-full-2026-09-30.zip', fileSizeBytes: 187334656,
  fileHash: 'sha256:5e1c0b7a9d2f4e6813c7a0b9f1d2e3c4a5b6c7d8e9f0a1b2c3d4e5f60718293a',
  createdAt: '2026-09-30T09:02:10+09:00', startedAt: null, finishedAt: null, options: {},
  preview: null, progress: { phase: 'parsing', processed: 0, total: 0, percent: 2, currentLabel: 'ZIP 여는 중', etaSec: null },
  result: null, errors: [], classifyJobId: null,
};
export const importCreated: ImportJob = importBase;
export const importPreviewReady: ImportJob = {
  ...importBase, state: 'preview_ready', sourceAi: 'chatgpt',
  preview: {
    sourceAi: 'chatgpt', detectedFormat: 'chatgpt_export_zip', formatVersion: '2026-09', category: 'conversations', projects: null, conversationsTotal: 1204, conversationsNew: 1180, conversationsUpdated: 18, conversationsUnchanged: 6, messagesTotal: 23870,
    dateRange: { from: '2023-03-14T22:01:00+09:00', to: '2026-09-29T23:12:00+09:00' }, quickQuestionPrefiltered: 412, activity: null,
    estimate: { model: 'claude-haiku-4-5', inputTokens: 3960000, outputTokens: 238000, costUsd: 5.15, note: '가격표 기준 추정 [미검증] · 간단한 질문 412개는 규칙으로 걸러 LLM 생략' },
    warnings: ['캔버스·첨부파일 17개는 자리표시자로만 저장돼요'],
  },
  progress: { phase: 'preview_ready', processed: 1204, total: 1204, percent: 10, currentLabel: '미리보기 준비됨', etaSec: null },
};
/** 1.1.0 새 Claude 내보내기(2026-10)의 projects-000.zip — 대화 없이 프로젝트만 만든다 */
export const importProjectsPreview: ImportJob = {
  ...importBase, id: 'imp_20261002_p4c2', state: 'preview_ready', sourceAi: 'claude', fileName: 'projects-000.zip', fileSizeBytes: 48211,
  fileHash: 'sha256:9a8b7c6d5e4f30211203a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5',
  preview: {
    sourceAi: 'claude', detectedFormat: 'claude_projects_zip', formatVersion: '2026-10', category: 'projects',
    projects: { total: 23, new: 20, existing: 1, skipped: 2, names: ['서브브레인', '블로그 리뉴얼', '이사 준비'] },
    conversationsTotal: 0, conversationsNew: 0, conversationsUpdated: 0, conversationsUnchanged: 0, messagesTotal: 0,
    dateRange: { from: null, to: null }, quickQuestionPrefiltered: 0, activity: null,
    estimate: { model: null, inputTokens: 0, outputTokens: 0, costUsd: 0, note: '대화가 없는 파일이라 분류하지 않아요 — 비용 없음' },
    warnings: ['Claude 프로젝트 파일이에요 — 대화가 없어 프로젝트만 만들어요.', '새 Claude 내보내기는 대화에 프로젝트 정보가 없어요. 과제는 분류 때 프로젝트 이름이 맞거나 새 프로젝트 제안을 수락하면 연결돼요.'],
  },
  progress: { phase: 'preview_ready', processed: 0, total: 0, percent: 10, currentLabel: '미리보기 준비됨', etaSec: null },
};
/** 1.2.0 Google Takeout "내 활동 > Gemini 앱" ZIP — 활동 기록(질문·응답) 412개를 대화 97개로 다시 묶은 미리보기 */
export const importGeminiPreview: ImportJob = {
  ...importBase, id: 'imp_20261010_g7m2', state: 'preview_ready', sourceAi: 'gemini', fileName: 'takeout-20261010T120000Z-001.zip', fileSizeBytes: 3184220,
  fileHash: 'sha256:4f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0',
  preview: {
    sourceAi: 'gemini', detectedFormat: 'gemini_takeout_html', formatVersion: 'takeout-my-activity-html-zip', category: 'conversations', projects: null,
    conversationsTotal: 97, conversationsNew: 97, conversationsUpdated: 0, conversationsUnchanged: 0, messagesTotal: 801,
    dateRange: { from: '2025-11-02T21:14:09+09:00', to: '2026-10-09T23:41:52+09:00' }, quickQuestionPrefiltered: 31,
    activity: { events: 412, skipped: 9, conversations: 97, byConversationId: 0, bySession: 97, sessionGapMinutes: 30, missingResponses: 23, attachments: 14, timezoneAssumed: 0 },
    estimate: { model: 'gemini-3.5-flash-lite', inputTokens: 181000, outputTokens: 19800, costUsd: 0.03, note: '글자 수 기준 대략 추정 [미검증] · 간단한 질문 31개는 규칙으로 걸러 LLM 생략' },
    warnings: [
      'Gemini Takeout은 대화가 아니라 활동 기록이에요 — 기록 412개를 대화 97개로 다시 묶었어요 (대화 주소 없는 기록은 30분 간격·주제 연속성으로 묶음)',
      '응답 본문이 없는 기록 23개 — Takeout이 응답을 빼거나 자르는 일이 흔해요',
      '첨부·캔버스가 있던 기록 14개 — 파일·캔버스 내용은 Takeout에 없어 표시만 남겨요',
      'Gemini 대화가 아닌 기록 9개는 건너뛰었어요(피드백·다른 제품·빈 기록)',
    ],
  },
  progress: { phase: 'preview_ready', processed: 97, total: 97, percent: 10, currentLabel: '미리보기 준비됨', etaSec: null },
};
export const importClassifying: ImportJob = {
  ...importPreviewReady, state: 'classifying', startedAt: '2026-09-30T09:04:31+09:00', options: { classify: true, maxCostUsd: 10 },
  progress: { phase: 'classifying', processed: 312, total: 792, percent: 58, currentLabel: '분류 중 · 312 / 792', etaSec: 1440 },
  classifyJobId: 'job_8c21',
};

// ── 12.5 jobs · 13.4 llm-test
export const job: Job = {
  id: 'job_8c21', type: 'classify', state: 'running', createdAt: '2026-09-30T09:04:31+09:00', startedAt: '2026-09-30T09:04:33+09:00', finishedAt: null,
  progress: { processed: 312, total: 792, percent: 39 }, label: '분류 · 가져오기 imp_20260930_n8w1', parentId: 'imp_20260930_n8w1', error: null, costUsd: 1.83,
};
export const llmTest: LlmTestResponse = { ok: true, provider: 'anthropic', model: 'claude-haiku-4-5', latencyMs: 812, message: '연결됐어요. 시험 분류 1건 성공.' };

// ── 15. errors
export const errorNotFound: ApiError = { error: { code: 'NOT_FOUND', message: '과제를 찾을 수 없어요: task_20260830_99', details: { taskId: 'task_20260830_99' }, requestId: 'req_01J9ZK4M' } };
export const errorValidation: ApiError = { error: { code: 'VALIDATION_ERROR', message: '요청 값이 올바르지 않아요.', details: { issues: [{ path: 'status', message: "'진행중'은 허용되지 않아요. 허용: 진행 중, 멈춤, 완료, 간단한 질문, 보관" }] }, requestId: 'req_01J9ZK5Q' } };
export const errorDuplicateImport: ApiError = { error: { code: 'DUPLICATE_IMPORT', message: '이미 가져온 파일이에요 (9월 30일 오전 8:02).', details: { importId: 'imp_20260930_k3f9' }, requestId: 'req_01J9ZK6A' } };
export const errorNotImplemented: ApiError = { error: { code: 'NOT_IMPLEMENTED', message: '이 기능은 아직 없어요 (Phase 6).', details: { phase: '6' }, requestId: 'req_01J9ZK7C' } };
export * from './fixtures-15.ts';
