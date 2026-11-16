// 계약서 MVP 엔드포인트의 얇은 타입 래퍼. 타입은 @subbrain/shared 것만 쓴다.
import type {
  AcceptMergeBody, AcceptMergeResponse, ApproveDeletionBody, DeletionBatchResponse, RejectMergeBody, RejectMergeResponse, ResetOverridesBody, SetDeletionItemBody, ActivityResponse, BoardResponse, DashboardResponse, DigestListItem, DigestResponse,
  FlowQuery, FlowResponse, GraphQuery, GraphResponse, HealthResponse, ListResponse, MergeSuggestion, MetaResponse,
  OpenQuestion, ProjectDetail, ResumePromptResponse, SearchQuery, SearchResponse, SourceAi, TaskDetail, TopicDetail,
  UpdateOpenQuestionBody, UpdateTaskBody, UpdateTaskResponse,
  AcceptProjectSuggestionBody, AcceptProjectSuggestionResponse, ClassificationStatus, ConversationDetail, ProjectSuggestion, ProjectSuggestionsQuery,
  RejectProjectSuggestionResponse, TaskListItem, TaskListQuery,
  CollectorStatus, PutCollectorConfigBody, CollectorRunBody, Job,
  McpEventsResponse, McpUndoResponse, StartPairingBody, StartPairingResponse, ListPairedClientsResponse, PairedClient, SyncStateResponse, SessionResponse,
  OntologyGraphResponse, OntologyQuery, OntologyStatusResponse, ListObjectsQuery, ListObjectsResponse, ObjectDetail, ImpactResponse, WhyStalledResponse,
  WeeklyReviewResponse, SimilarResponse, GraphPathResponse, AcceptSuggestionResponse, RejectSuggestionResponse, BulkAcceptSuggestionsBody, BulkAcceptSuggestionsResponse, UndoOntologyResponse,
} from '@subbrain/shared';
import { ApiRequestError, get, patch, post, put, type Query } from './client';

const enc = encodeURIComponent;
const q = (o: object) => o as Query;

export const api = {
  /** 주간 돌아보기: date가 속한 주(월~일, KST). 비우면 이번 주 */
  weeklyReview: (date?: string) => get<WeeklyReviewResponse>('/review/weekly', { date }),
  /** §14.3 페어링·수집 상태(1.9.0) — 웹은 토큰 없이 web 세션 */
  session: () => get<SessionResponse>('/session'),
  startPairing: (body: StartPairingBody) => post<StartPairingResponse>('/pairing', body),
  pairingClients: () => get<ListPairedClientsResponse>('/pairing/clients'),
  revokeClient: (tokenId: string) => post<PairedClient>(`/pairing/clients/${enc(tokenId)}/revoke`, {}),
  syncState: () => get<SyncStateResponse>('/sync-state'),
  /** §14.5 MCP(1.8.0) — AI가 MCP로 한 쓰기 기록 · 되돌리기 */
  mcpEvents: () => get<McpEventsResponse>('/mcp/events'),
  mcpUndo: (id: number) => post<McpUndoResponse>(`/mcp/events/${id}/undo`, {}),
  /** §14.2 온톨로지(1.7.0) — 관계 모드는 GET /ontology(GET /graph?mode=ontology는 501) */
  ontology: (query: OntologyQuery = {}) => get<OntologyGraphResponse>('/ontology', q(query)),
  ontologyStatus: () => get<OntologyStatusResponse>('/ontology/status'),
  objects: (query: ListObjectsQuery = {}) => get<ListObjectsResponse>('/objects', q(query)),
  object: (id: string) => get<ObjectDetail>(`/objects/${enc(id)}`),
  impact: (id: string) => get<ImpactResponse>(`/objects/${enc(id)}/impact`),
  whyStalled: (taskId: string) => get<WhyStalledResponse>(`/tasks/${enc(taskId)}/why-stalled`),
  similar: (text: string, limit = 5) => get<SimilarResponse>('/similar', { text, limit }),
  graphPath: (from: string, to: string, maxDepth = 4) => get<GraphPathResponse>('/graph/path', { from, to, maxDepth }),
  acceptSuggestion: (id: string) => post<AcceptSuggestionResponse>(`/suggestions/${enc(id)}/accept`, {}),
  rejectSuggestion: (id: string, reason?: string) => post<RejectSuggestionResponse>(`/suggestions/${enc(id)}/reject`, reason ? { reason } : {}),
  bulkAcceptSuggestions: (body: BulkAcceptSuggestionsBody) => post<BulkAcceptSuggestionsResponse>('/suggestions/bulk-accept', body),
  undoOntology: (eventId: number) => post<UndoOntologyResponse>(`/ontology/events/${eventId}/undo`, {}),
  /** §12.10 로컬 세션 수집기(1.5.0) — Claude Code · Codex 세션 파일 감시 */
  collector: () => get<CollectorStatus>('/collector'),
  putCollectorConfig: (body: PutCollectorConfigBody) => put<CollectorStatus>('/collector/config', body),
  collectorScan: (body: CollectorRunBody = {}) => post<Job>('/collector/scan', body),
  health: () => get<HealthResponse>('/health'),
  meta: () => get<MetaResponse>('/meta'),
  dashboard: () => get<DashboardResponse>('/dashboard'),
  graph: (query: GraphQuery = {}, signal?: AbortSignal) => get<GraphResponse>('/graph', q(query), signal),
  activity: (query: { granularity?: 'week' | 'day'; from?: string; to?: string; projectId?: string } = {}) => get<ActivityResponse>('/activity', q(query)),
  project: (id: string) => get<ProjectDetail>(`/projects/${enc(id)}`),
  topic: (id: string) => get<TopicDetail>(`/topics/${enc(id)}`),
  /** §8.1 과제 목록 — 1.1.0 `classificationState`(blocked = 분류 불가)·`handedOff` 필터 */
  tasks: (query: TaskListQuery = {}) => get<ListResponse<TaskListItem>>('/tasks', q(query)),
  task: (id: string) => get<TaskDetail>(`/tasks/${enc(id)}`),
  flow: (id: string, query: FlowQuery = {}) => get<FlowResponse>(`/tasks/${enc(id)}/flow`, q(query)),
  updateTask: (id: string, body: UpdateTaskBody) => patch<UpdateTaskResponse>(`/tasks/${enc(id)}`, body),
  /** §8.6 사용자 고정값 풀기 → 규칙 엔진이 다시 계산한 TaskDetail */
  resetOverrides: (id: string, body: ResetOverridesBody) => post<TaskDetail>(`/tasks/${enc(id)}/overrides/reset`, body),
  updateOpenQuestion: (id: string, qid: string, body: UpdateOpenQuestionBody) => patch<OpenQuestion>(`/tasks/${enc(id)}/open-questions/${enc(qid)}`, body),
  resumePrompt: (id: string, targetAi?: SourceAi) => get<ResumePromptResponse>(`/tasks/${enc(id)}/resume-prompt`, { targetAi }),
  board: () => get<BoardResponse>('/board'),
  digests: (cursor?: string) => get<ListResponse<DigestListItem>>('/digests', { cursor, limit: 30 }),
  /** `today`가 아직 없으면 404 → `latest`로 다시 (계약서 §10.2) */
  digest: async (date: string): Promise<DigestResponse> => {
    try { return await get<DigestResponse>(`/digests/${enc(date)}`); }
    catch (e) {
      if (date === 'today' && e instanceof ApiRequestError && e.status === 404) return get<DigestResponse>('/digests/latest');
      throw e;
    }
  },
  search: (query: SearchQuery, signal?: AbortSignal) => get<SearchResponse>('/search', q(query), signal),
  mergeSuggestions: (query: { state?: 'pending' | 'accepted' | 'rejected'; taskId?: string; limit?: number; cursor?: string } = {}) => get<ListResponse<MergeSuggestion>>('/merge-suggestions', q(query)),
  acceptMerge: (id: string, body: AcceptMergeBody = {}) => post<AcceptMergeResponse>(`/merge-suggestions/${enc(id)}/accept`, body),
  /** 1.0.1: 수락과 같은 {suggestion, task} */
  rejectMerge: (id: string, body: RejectMergeBody = {}) => post<RejectMergeResponse>(`/merge-suggestions/${enc(id)}/reject`, body),
  // ── 1.1.0 새 프로젝트 제안 (§9-2) ──
  projectSuggestions: (query: ProjectSuggestionsQuery = {}) => get<ListResponse<ProjectSuggestion>>('/project-suggestions', q(query)),
  acceptProjectSuggestion: (id: string, body: AcceptProjectSuggestionBody = {}) => post<AcceptProjectSuggestionResponse>(`/project-suggestions/${enc(id)}/accept`, body),
  rejectProjectSuggestion: (id: string, body: { reason?: string } = {}) => post<RejectProjectSuggestionResponse>(`/project-suggestions/${enc(id)}/reject`, body),
  /** §12.6 분류 대기열·확인 필요 수 — 1.1.0 `blockedCount` */
  /** §8.12 대화 원문(메시지 페이지) — 1.3.0 `Message.voice?` */
  conversation: (id: string, query: { limit?: number; cursor?: string } = {}) => get<ConversationDetail>(`/conversations/${enc(id)}`, q(query)),
  classificationStatus: () => get<ClassificationStatus>('/classification/status'),
  // ── LATER(6) §14.1 [잠정]: MVP 코어는 501 NOT_IMPLEMENTED ──
  deletionBatch: (id: string) => get<DeletionBatchResponse>(`/deletion-batches/${enc(id)}`),
  setDeletionItem: (id: string, itemId: number, body: SetDeletionItemBody) => patch<DeletionBatchResponse>(`/deletion-batches/${enc(id)}/items/${itemId}`, body),
  approveDeletion: (id: string, body: ApproveDeletionBody) => post<DeletionBatchResponse>(`/deletion-batches/${enc(id)}/approve`, body),
  postponeDeletion: (id: string) => post<DeletionBatchResponse>(`/deletion-batches/${enc(id)}/postpone`, {}),
};

/** cursor 페이지를 끝까지 모으기 (계약서 §1.4) */
export async function collectAll<T>(fetchPage: (cursor?: string) => Promise<ListResponse<T>>, max = 500): Promise<T[]> {
  const out: T[] = []; let cursor: string | undefined;
  for (;;) {
    const r = await fetchPage(cursor);
    out.push(...r.items);
    if (!r.page.hasMore || !r.page.nextCursor || out.length >= max) return out;
    cursor = r.page.nextCursor;
  }
}
