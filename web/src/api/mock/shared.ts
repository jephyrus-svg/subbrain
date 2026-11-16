// 공유 목(mock) JSON을 공유 타입으로 읽는다. 1.0.1부터 목은 엔진이 예시 데이터 위에서 캡처한 응답이다
// (packages/shared/mocks/json, 상세 세트는 mocks/json/demo/ — 키 = id).
import type {
  AcceptMergeResponse, ActivityResponse, BoardResponse, DashboardResponse, DeletionBatchResponse, DigestCleanup, DigestListItem,
  DigestResponse, FlowResponse, GraphResponse, HealthResponse, ListResponse, MergeSuggestion, MetaResponse, ProjectDetail,
  ProjectSummary, RejectMergeResponse, ResumePromptResponse, SearchResponse, TaskDetail, TopicDetail, UpdateTaskResponse,
  AcceptProjectSuggestionResponse, ClassificationStatus, WeeklyReviewResponse, ConversationDetail, ImportJob, ProjectSuggestion,
} from '@subbrain/shared';
import health from '@subbrain/shared/mocks/health';
import meta from '@subbrain/shared/mocks/meta';
import dashboard from '@subbrain/shared/mocks/dashboard';
import graph from '@subbrain/shared/mocks/graph';
import activity from '@subbrain/shared/mocks/activity';
import projectsList from '@subbrain/shared/mocks/projectsList';
import board from '@subbrain/shared/mocks/board';
import updateTaskResponse from '@subbrain/shared/mocks/updateTaskResponse';
import mergeSuggestions from '@subbrain/shared/mocks/mergeSuggestions';
import acceptMergeResponse from '@subbrain/shared/mocks/acceptMergeResponse';
import rejectMergeResponse from '@subbrain/shared/mocks/rejectMergeResponse';
import digestList from '@subbrain/shared/mocks/digestList';
import digest from '@subbrain/shared/mocks/digest';
import digestCleanupLater from '@subbrain/shared/mocks/digestCleanupLater';
import deletionBatchResponse from '@subbrain/shared/mocks/deletionBatchResponse';
import search from '@subbrain/shared/mocks/search';
import searchPaged from '@subbrain/shared/mocks/searchPaged';
import searchPagedNext from '@subbrain/shared/mocks/searchPagedNext';
// 1.1.0 목: 새 프로젝트 제안(§9-2)·분류 상태(§12.6 blockedCount)·카테고리 ZIP 미리보기(§12.2)
import projectSuggestions from '@subbrain/shared/mocks/projectSuggestions';
import acceptProjectSuggestionResponse from '@subbrain/shared/mocks/acceptProjectSuggestionResponse';
import importProjectsPreview from '@subbrain/shared/mocks/importProjectsPreview';
import classificationStatus from '@subbrain/shared/mocks/classificationStatus';
import weeklyReview from '@subbrain/shared/mocks/weeklyReview';
import weeklyReviewPrev from '@subbrain/shared/mocks/weeklyReviewPrev';
import demoTasks from '@subbrain/shared/mocks/demo/tasks';
import demoFlows from '@subbrain/shared/mocks/demo/flows';
import demoResume from '@subbrain/shared/mocks/demo/resumePrompts';
import demoProjects from '@subbrain/shared/mocks/demo/projects';
import demoTopics from '@subbrain/shared/mocks/demo/topics';
import demoConversations from '@subbrain/shared/mocks/demo/conversations';

const as = <T,>(x: unknown) => x as T;
/** 읽을 때마다 복사본 (라우터가 고쳐도 원본은 그대로) */
export const clone = <T,>(x: T): T => structuredClone(x);

export const M = {
  weeklyReview: as<WeeklyReviewResponse>(weeklyReview),
  weeklyReviewPrev: as<WeeklyReviewResponse>(weeklyReviewPrev),
  health: as<HealthResponse>(health),
  meta: as<MetaResponse>(meta),
  dashboard: as<DashboardResponse>(dashboard),
  graph: as<GraphResponse>(graph),
  activity: as<ActivityResponse>(activity),
  projectsList: as<ListResponse<ProjectSummary>>(projectsList),
  board: as<BoardResponse>(board),
  updateTaskResponse: as<UpdateTaskResponse>(updateTaskResponse),
  mergeSuggestions: as<ListResponse<MergeSuggestion>>(mergeSuggestions),
  acceptMergeResponse: as<AcceptMergeResponse>(acceptMergeResponse),
  rejectMergeResponse: as<RejectMergeResponse>(rejectMergeResponse),
  digestList: as<ListResponse<DigestListItem>>(digestList),
  digest: as<DigestResponse>(digest),
  digestCleanupLater: as<DigestCleanup>(digestCleanupLater),
  deletionBatchResponse: as<DeletionBatchResponse>(deletionBatchResponse),
  search: as<SearchResponse>(search),
  searchPaged: as<SearchResponse>(searchPaged),
  searchPagedNext: as<SearchResponse>(searchPagedNext),
  projectSuggestions: as<ListResponse<ProjectSuggestion>>(projectSuggestions),
  acceptProjectSuggestionResponse: as<AcceptProjectSuggestionResponse>(acceptProjectSuggestionResponse),
  importProjectsPreview: as<ImportJob>(importProjectsPreview),
  classificationStatus: as<ClassificationStatus>(classificationStatus),
};

/** 엔진이 캡처한 전체 상세 세트 (키 = id) */
export const D = {
  tasks: as<Record<string, TaskDetail>>(demoTasks),
  flows: as<Record<string, FlowResponse>>(demoFlows),
  resume: as<Record<string, ResumePromptResponse>>(demoResume),
  projects: as<Record<string, ProjectDetail>>(demoProjects),
  topics: as<Record<string, TopicDetail>>(demoTopics),
  conversations: as<Record<string, ConversationDetail>>(demoConversations),
};
