/**
 * 서브브레인 zod 스키마 — 요청 검증 · 응답 계약 검사 · LLM 출력 · 볼트 frontmatter
 * 응답 스키마는 api-types.ts와 컴파일 시점에 서로 같은지 검사한다(파일 끝 TypeCheck).
 * 응답 스키마는 .strict() — 계약서에 없는 키가 섞이면 테스트가 실패한다.
 */
import { z } from 'zod';
import type * as T from './api-types.ts';

// ───────────── 0. 스칼라 · 열거
const isoDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/, 'ISO 8601 시각이어야 해요');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 날짜여야 해요');
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, '#RRGGBB 색이어야 해요');
export { isoDateTime as IsoDateTimeSchema, isoDate as IsoDateSchema, hex as HexColorSchema };

export const SourceAiSchema = z.enum(['chatgpt', 'claude', 'gemini', 'grok', 'claude-code', 'codex', 'grokbot']);
export const KindSchema = z.enum(['task', 'quick_question']);
export const ResolutionSchema = z.enum(['resolved', 'unresolved', 'abandoned']);
export const TaskStatusSchema = z.enum(['진행 중', '멈춤', '완료', '간단한 질문', '보관']);
export const StatusSourceSchema = z.enum(['user', 'mcp', 'llm', 'rule']);
export const TaskOriginSchema = z.enum(['auto', 'mcp', 'manual']);
export const CompletionReasonSchema = z.enum(['resolved', 'abandoned', 'answered', 'done', 'moved']);
export const StaleStageSchema = z.enum(['short_pause', 'stale', 'long_stale', 'dormant']);
export const StatusVisualSchema = z.enum(['run', 'stall2', 'stall', 'done', 'quick', 'archived']);
export const ServiceStateSchema = z.enum(['active', 'archived', 'deleted']);
export const CaptureMethodSchema = z.enum(['extension_live', 'extension_catchup', 'export', 'mcp', 'local_session']);
export const MessageRoleSchema = z.enum(['user', 'assistant', 'system', 'tool']);
export const ProjectStatusSchema = z.enum(['active', 'paused', 'done']);
export const EventTypeSchema = z.enum(['conversation_started', 'message_added', 'status_changed', 'completed', 'wiki_created', 'archived_in_service', 'deleted_from_service', 'object_created', 'object_merged', 'link_added', 'link_ended', 'suggestion_accepted', 'suggestion_rejected', 'task_logged', 'write_undone']);
export const EventActorSchema = z.enum(['user', 'mcp', 'classifier', 'rule', 'extension']);
export const AdapterHealthSchema = z.enum(['ok', 'degraded', 'broken']);
export const ObjectTypeSchema = z.enum(['person', 'project', 'task', 'decision', 'tool', 'artifact', 'place', 'organization', 'topic']);
export const LinkTypeSchema = z.enum(['uses', 'decided', 'blocked_by', 'derived_from', 'references', 'part_of', 'supersedes', 'affects', 'located_at', 'related_to']);
export const ObjectStatusSchema = z.enum(['accepted', 'suggested', 'rejected', 'merged']);
export const LinkStatusSchema = z.enum(['accepted', 'suggested', 'rejected']);
export const GraphModeSchema = z.enum(['task', 'ontology']);
export const GraphNodeTypeSchema = z.enum(['person', 'project', 'task', 'decision', 'tool', 'artifact', 'place', 'organization', 'topic', 'wiki', 'ai_service']);
export const GraphEdgeTypeSchema = z.enum(['uses', 'decided', 'blocked_by', 'derived_from', 'references', 'part_of', 'supersedes', 'affects', 'located_at', 'related_to', 'same_task_candidate', 'wiki_source', 'from_ai']);
export const AutomationLevelSchema = z.enum(['L0', 'L1', 'L2', 'L3', 'L4']);
export const LlmProviderSchema = z.enum(['anthropic', 'openai', 'google', 'xai', 'ollama']);
export const ImportStateSchema = z.enum(['uploaded', 'parsing', 'preview_ready', 'importing', 'classifying', 'done', 'failed', 'cancelled']);
export const JobTypeSchema = z.enum(['import', 'classify', 'extract_ontology', 'vault_regenerate', 'digest', 'stale_recalc', 'wiki', 'backup', 'collector_backfill', 'collector_scan']);
export const JobStateSchema = z.enum(['queued', 'running', 'done', 'failed', 'cancelled', 'deferred']);
export const SearchModeSchema = z.enum(['trigram', 'bigram', 'like', 'title_like']);
export const SearchResultTypeSchema = z.enum(['task', 'conversation', 'message', 'decision', 'wiki']);
export const MergeSuggestionStateSchema = z.enum(['pending', 'accepted', 'rejected']);
export const ProjectSuggestionStateSchema = z.enum(['pending', 'accepted', 'rejected']); // 1.1.0
export const ClassificationStateSchema = z.enum(['ok', 'blocked']); // 1.1.0
export const DigestEventActionSchema = z.enum(['completed', 'started', 'continued', 'stalled', 'archived', 'wiki_drafted']);
export const ErrorCodeSchema = z.enum(['VALIDATION_ERROR', 'UNSUPPORTED_FILE', 'FORBIDDEN_ORIGIN', 'NOT_FOUND', 'CONFLICT', 'DUPLICATE_IMPORT', 'PAYLOAD_TOO_LARGE', 'NOT_ALLOWED_IN_BUILD', 'COST_CAP_REACHED', 'INTERNAL', 'NOT_IMPLEMENTED', 'DB_BUSY', 'LLM_UNAVAILABLE', 'UNAUTHORIZED', 'RATE_LIMITED']);

// ───────────── 1. 공통 조각
export const PageSchema = z.object({ limit: z.number().int(), nextCursor: z.string().nullable(), hasMore: z.boolean(), total: z.number().int().nullable() }).strict();
export const listOf = <S extends z.ZodTypeAny>(item: S) => z.object({ items: z.array(item), page: PageSchema }).strict();

export const ApiErrorSchema = z.object({
  error: z.object({ code: ErrorCodeSchema, message: z.string(), details: z.record(z.unknown()).optional(), requestId: z.string() }).strict(),
}).strict();
export const VaultRefSchema = z.object({ path: z.string(), obsidianUri: z.string().nullable() }).strict();
export const ProjectRefSchema = z.object({ id: z.string(), name: z.string(), colorHex: hex }).strict();
export const TaskRefSchema = z.object({ id: z.string(), title: z.string(), status: TaskStatusSchema, statusVisual: StatusVisualSchema, staleDays: z.number().int().nullable(), projectId: z.string().nullable() }).strict();
export const StaleInfoSchema = z.object({ staleDays: z.number().int().nullable(), staleStage: StaleStageSchema.nullable(), statusVisual: StatusVisualSchema, badge: z.string().nullable() }).strict();
export const AiCountSchema = z.object({ sourceAi: SourceAiSchema, conversationCount: z.number().int(), messageCount: z.number().int() }).strict();
export const ContinueTargetSchema = z.object({ sourceAi: SourceAiSchema, url: z.string(), conversationId: z.string(), label: z.string() }).strict();
export const ConversationOutcomeSchema = z.enum(['done', 'moved', 'interrupted', 'open']); // 1.4.0
export const ConversationOutcomeInfoSchema = z.object({
  outcome: ConversationOutcomeSchema, status: z.enum(['진행 중', '멈춤', '완료']), staleDays: z.number().int().nullable(), label: z.string(),
  target: z.string().nullable(), evidence: z.string().nullable(), detectedBy: z.enum(['llm', 'rule', 'both', 'derived']),
}).strict();
export const HandoffInfoSchema = z.object({ label: z.string(), target: z.string().nullable(), conversationId: z.string(), evidence: z.string().nullable(), detectedBy: z.enum(['llm', 'rule', 'both']) }).strict(); // 1.1.0
export const StaleThresholdsSchema = z.object({ inProgressMaxDays: z.number().int().min(0), shortPauseMaxDays: z.number().int().min(1), staleMaxDays: z.number().int().min(1), longStaleMaxDays: z.number().int().min(1) }).strict();

// ───────────── 2. 시스템
export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']), apiVersion: z.string(), coreVersion: z.string(), node: z.string(),
  buildTarget: z.enum(['personal', 'sellable']), startedAt: isoDateTime, uptimeSec: z.number(),
  db: z.object({ path: z.string(), journalMode: z.literal('wal'), schemaVersion: z.number().int(), sqliteVersion: z.string(), fts5: z.boolean(), trigram: z.boolean(), bigramIndex: z.boolean(), sizeBytes: z.number() }).strict(),
  vault: z.object({ path: z.string(), lastGeneratedAt: isoDateTime.nullable(), conflictCount: z.number().int() }).strict(),
  workers: z.object({ queueDepth: z.number().int(), running: z.number().int(), paused: z.boolean(), pausedReason: z.string().nullable() }).strict(),
  llm: z.object({ provider: LlmProviderSchema.nullable(), model: z.string().nullable(), configured: z.boolean() }).strict(),
}).strict();

export const MetaResponseSchema = z.object({
  statuses: z.array(z.object({ value: TaskStatusSchema, visual: StatusVisualSchema, colorHex: hex, labelKo: z.string() }).strict()),
  statusVisuals: z.object(Object.fromEntries(StatusVisualSchema.options.map((k) => [k, z.object({ colorHex: hex.nullable(), ring: z.enum(['solid', 'dashed', 'none', 'dot']), labelKo: z.string() }).strict()])) as Record<T.StatusVisual, z.ZodObject<{ colorHex: z.ZodNullable<z.ZodString>; ring: z.ZodEnum<['solid', 'dashed', 'none', 'dot']>; labelKo: z.ZodString }, 'strict'>>).strict(),
  staleStages: z.array(z.object({ key: StaleStageSchema, labelKo: z.string(), emoji: z.string(), minDays: z.number().int(), maxDays: z.number().int().nullable() }).strict()),
  sourceAis: z.array(z.object({ key: SourceAiSchema, labelKo: z.string(), shape: z.enum(['circle', 'rounded_square', 'diamond', 'triangle']), colorHex: hex }).strict()),
  projectPalette: z.array(hex),
  objectTypes: z.array(z.object({ key: ObjectTypeSchema, labelKo: z.string(), icon: z.string(), sensitive: z.boolean(), enabled: z.boolean() }).strict()),
  linkTypes: z.array(z.object({ key: LinkTypeSchema, labelKo: z.string(), directed: z.boolean(), colorHex: hex, line: z.enum(['solid', 'dashed', 'thin', 'dotted']), arrow: z.boolean(), hiddenByDefault: z.boolean() }).strict()),
  thresholds: StaleThresholdsSchema,
}).strict();

export const CollectionSourceStatusSchema = z.object({
  sourceAi: SourceAiSchema, methods: z.array(CaptureMethodSchema), methodLabel: z.string(), lastCapturedAt: isoDateTime.nullable(), health: AdapterHealthSchema, message: z.string().nullable(),
}).strict();

export const DashboardResponseSchema = z.object({
  today: isoDate,
  counts: z.object({ inProgress: z.number().int(), stalled: z.number().int(), stalledOver7Days: z.number().int(), completedThisWeek: z.number().int(), quickQuestions: z.number().int(), archived: z.number().int(), needsReview: z.number().int(), totalTasks: z.number().int(), allTasks: z.number().int().optional() }).strict(),
  collection: z.object({ lastCapturedAt: isoDateTime.nullable(), overallHealth: AdapterHealthSchema, sources: z.array(CollectionSourceStatusSchema) }).strict(),
  badges: z.object({ digestApprovals: z.number().int(), pendingMergeSuggestions: z.number().int(), vaultConflicts: z.number().int(), runningImports: z.number().int(), pendingProjectSuggestions: z.number().int().optional() }).strict(),
  latestDigestDate: isoDate.nullable(),
}).strict();

// ───────────── 3. 그래프
export const GraphNodeSchema = z.object({
  id: z.string(), type: GraphNodeTypeSchema, label: z.string(), objectId: z.string().nullable(), projectId: z.string().nullable(), colorHex: hex.nullable(),
  kind: KindSchema.nullable(), status: TaskStatusSchema.nullable(), statusVisual: StatusVisualSchema.nullable(), staleDays: z.number().int().nullable(), staleStage: StaleStageSchema.nullable(), badge: z.string().nullable(),
  sourceAis: z.array(SourceAiSchema), messageCount: z.number().int(), conversationCount: z.number().int(), taskCount: z.number().int().nullable(),
  size: z.number().min(0).max(1), recency: z.number().min(0).max(1), firstActivityAt: isoDateTime.nullable(), lastActivityAt: isoDateTime.nullable(),
  objectStatus: ObjectStatusSchema.nullable(), mentionCount: z.number().int().nullable(), confidence: z.number().nullable(), tooltip: z.string(),
}).strict();
export const GraphEdgeSchema = z.object({
  id: z.string(), type: GraphEdgeTypeSchema, source: z.string(), target: z.string(), directed: z.boolean(), status: LinkStatusSchema,
  confidence: z.number().nullable(), endedAt: isoDateTime.nullable(), weight: z.number(), reason: z.string().nullable(),
}).strict();
export const GraphResponseSchema = z.object({
  mode: GraphModeSchema, at: isoDate, generatedAt: isoDateTime, nodes: z.array(GraphNodeSchema), edges: z.array(GraphEdgeSchema),
  stats: z.object({ projectCount: z.number().int(), taskCount: z.number().int(), quickQuestionCount: z.number().int(), topicCount: z.number().int(), hiddenQuickCount: z.number().int(), truncated: z.boolean() }).strict(),
}).strict();
export const ActivityResponseSchema = z.object({
  granularity: z.enum(['week', 'day']), from: isoDate, to: isoDate, projectId: z.string().nullable(),
  buckets: z.array(z.object({ start: isoDate, conversationCount: z.number().int(), messageCount: z.number().int(), taskCount: z.number().int() }).strict()),
}).strict();

// ───────────── 4. 프로젝트 · 과제
export const ProjectSummarySchema = z.object({
  id: z.string(), name: z.string(), aliases: z.array(z.string()), status: ProjectStatusSchema, colorHex: hex,
  activity: z.object({ status: TaskStatusSchema, staleDays: z.number().int().nullable(), statusVisual: StatusVisualSchema }).strict(),
  taskCount: z.number().int(), conversationCount: z.number().int(), startedAt: isoDateTime.nullable(), lastActivityAt: isoDateTime.nullable(),
  thresholds: StaleThresholdsSchema.partial().nullable(),
}).strict();
export const NextStepInfoSchema = z.object({ text: z.string(), source: z.enum(['user', 'saved', 'rule']), basis: z.string().nullable() }).strict();
export const TaskListItemSchema = z.object({
  id: z.string(), title: z.string(), summary: z.string().nullable(), kind: KindSchema, status: TaskStatusSchema, statusVisual: StatusVisualSchema,
  staleDays: z.number().int().nullable(), staleStage: StaleStageSchema.nullable(), badge: z.string().nullable(), project: ProjectRefSchema.nullable(),
  sourceAis: z.array(SourceAiSchema), conversationCount: z.number().int(), messageCount: z.number().int(),
  startedAt: isoDateTime.nullable(), lastActivityAt: isoDateTime.nullable(), completedAt: isoDateTime.nullable(), nextStep: z.string().nullable(), nextStepInfo: NextStepInfoSchema.nullable().optional(),
  needsReview: z.boolean(), pin: z.boolean(),
  primaryConversation: z.object({ id: z.string(), sourceAi: SourceAiSchema, url: z.string().nullable() }).strict().nullable(),
  handoff: HandoffInfoSchema.nullable().optional(), classificationState: ClassificationStateSchema.optional(),
  blockedReason: z.string().nullable().optional(), blockedModel: z.string().nullable().optional(), confidence: z.number().min(0).max(1).nullable().optional(),
  completionReason: CompletionReasonSchema.nullable().optional(), conversationOutcome: ConversationOutcomeInfoSchema.nullable().optional(),
}).strict();
export const NextStepCardSchema = z.object({
  taskId: z.string(), taskTitle: z.string(), text: z.string(),
  evidence: z.object({ conversationId: z.string(), sourceAi: SourceAiSchema, at: isoDateTime, quote: z.string(), label: z.string() }).strict().nullable(),
  continue: ContinueTargetSchema.nullable(),
}).strict();
export const ProjectDetailSchema = ProjectSummarySchema.extend({
  summary: z.string().nullable(), vault: VaultRefSchema,
  weeklyConversations: z.object({ weeks: z.number().int(), buckets: z.array(z.object({ start: isoDate, count: z.number().int() }).strict()) }).strict(),
  byAi: z.array(AiCountSchema), nextStep: NextStepCardSchema.nullable(), tasks: z.array(TaskListItemSchema), quickQuestionCount: z.number().int(),
  relatedProjects: z.array(z.object({ project: ProjectRefSchema, reason: z.string(), sharedTopicIds: z.array(z.string()) }).strict()),
}).strict();
export const WikiRefSchema = z.object({ id: z.string(), title: z.string(), draft: z.boolean(), updatedAt: isoDateTime.nullable() }).strict();
export const TopicDetailSchema = z.object({
  id: z.string(), name: z.string(), aliases: z.array(z.string()), objectStatus: ObjectStatusSchema, mentionCount: z.number().int(),
  firstSeenAt: isoDateTime.nullable(), lastSeenAt: isoDateTime.nullable(), tasks: z.array(TaskListItemSchema), projects: z.array(ProjectRefSchema),
  wikiPages: z.array(WikiRefSchema), weeklyMentions: z.array(z.object({ start: isoDate, count: z.number().int() }).strict()),
}).strict();

export const BoardColumnSchema = z.object({
  status: z.enum(['진행 중', '멈춤', '완료', '간단한 질문']), labelKo: z.string(), collapsed: z.boolean(), total: z.number().int(), items: z.array(TaskListItemSchema), hasMore: z.boolean(),
}).strict();
export const BoardResponseSchema = z.object({ columns: z.array(BoardColumnSchema), weeklyResumeSuggestions: z.array(z.string()) }).strict();

export const DecisionSchema = z.object({
  id: z.string(), text: z.string(), sourceConversationId: z.string().nullable(), sourceAi: SourceAiSchema.nullable(), decidedAt: isoDateTime.nullable(), valid: z.boolean(), overridden: z.boolean(),
}).strict();
export const OpenQuestionSchema = z.object({
  id: z.string(), text: z.string(), resolved: z.boolean(), note: z.string().nullable(), sourceConversationId: z.string().nullable(), resolvedAt: isoDateTime.nullable(),
}).strict();
export const ClassificationInfoSchema = z.object({
  kind: KindSchema, resolution: ResolutionSchema, completionReason: CompletionReasonSchema.nullable(), confidence: z.number().min(0).max(1), evidence: z.string().nullable(),
  model: z.string(), promptVersion: z.string(), classifiedAt: isoDateTime, needsReview: z.boolean(),
  state: ClassificationStateSchema, blockedReason: z.string().nullable(), blockedModel: z.string().nullable(), rawConfidence: z.number().min(0).max(1).nullable(), handoff: HandoffInfoSchema.nullable(),
  cached: z.boolean(),
}).strict();
export const MergeSuggestionTaskSchema = TaskRefSchema.extend({ sourceAis: z.array(SourceAiSchema) }).strict();
export const MergeSuggestionSchema = z.object({
  id: z.string(), state: MergeSuggestionStateSchema, confidence: z.number(), reason: z.string(),
  tasks: z.tuple([MergeSuggestionTaskSchema, MergeSuggestionTaskSchema]), suggestedPrimaryTaskId: z.string(), createdAt: isoDateTime, decidedAt: isoDateTime.nullable(),
  kind: z.enum(['same_task', 'handoff_session']).optional(), // 1.5.0
  handoff: z.object({ fromConversationId: z.string(), sessionConversationId: z.string(), target: z.string().nullable(), gapMinutes: z.number(), textSimilarity: z.number(),
    projectMatch: z.enum(['same_project', 'cwd_name', 'none']), explicitRef: z.boolean(), cwd: z.string().nullable(), score: z.number() }).strict().nullable().optional(),
}).strict();
export const ProjectSuggestionSchema = z.object({ // 1.1.0
  id: z.string(), name: z.string(), altNames: z.array(z.string()), state: ProjectSuggestionStateSchema, ready: z.boolean(), taskCount: z.number().int(), minTasks: z.number().int(),
  tasks: z.array(MergeSuggestionTaskSchema), projectId: z.string().nullable(), createdAt: isoDateTime, updatedAt: isoDateTime, decidedAt: isoDateTime.nullable(),
}).strict();
export const AcceptProjectSuggestionResponseSchema = z.object({ suggestion: ProjectSuggestionSchema, project: ProjectSummarySchema, attachedTaskIds: z.array(z.string()) }).strict();
export const RejectProjectSuggestionResponseSchema = z.object({ suggestion: ProjectSuggestionSchema }).strict();
export const WhyStalledSchema = z.object({
  chain: z.array(z.object({ depth: z.number().int(), nodeId: z.string(), type: ObjectTypeSchema, label: z.string(), linkType: z.literal('blocked_by'), confidence: z.number() }).strict()),
  rootCause: z.string().nullable(), lastRelatedConversationId: z.string().nullable(),
}).strict();
export const TaskDetailSchema = z.object({
  id: z.string(), title: z.string(), kind: KindSchema, status: TaskStatusSchema, statusSource: StatusSourceSchema, stale: StaleInfoSchema,
  completionReason: CompletionReasonSchema.nullable(), project: ProjectRefSchema.nullable(),
  breadcrumb: z.array(z.object({ label: z.string(), href: z.string().nullable() }).strict()),
  origin: TaskOriginSchema, pin: z.boolean(), overrides: z.array(z.string()),
  startedAt: isoDateTime.nullable(), lastActivityAt: isoDateTime.nullable(), completedAt: isoDateTime.nullable(),
  firstConversationAt: isoDateTime.nullable(), lastConversationAt: isoDateTime.nullable(),
  conversationCount: z.number().int(), messageCount: z.number().int(),
  byAi: z.array(AiCountSchema.extend({ sharedConversationCount: z.number().int() }).strict()),
  topics: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
  summary: z.string().nullable(), summaryDetail: z.array(z.string()), nextStep: z.string().nullable(), nextStepInfo: NextStepInfoSchema.nullable().optional(),
  classification: ClassificationInfoSchema.nullable(), handoff: HandoffInfoSchema.nullable(), classificationState: ClassificationStateSchema,
  conversationOutcome: ConversationOutcomeInfoSchema.nullable().optional(), // 1.5.0
  conversationOutcomes: z.array(z.object({ conversationId: z.string(), sourceAi: SourceAiSchema, title: z.string(), role: z.enum(['primary', 'shared']), updatedAt: isoDateTime, outcome: ConversationOutcomeInfoSchema }).strict()).optional(),
  vault: VaultRefSchema, decisions: z.array(DecisionSchema), openQuestions: z.array(OpenQuestionSchema),
  resume: z.object({ defaultTargetAi: SourceAiSchema, targets: z.array(SourceAiSchema), promptPreview: z.string(), continue: ContinueTargetSchema.nullable(), continueNote: z.string().nullable() }).strict(),
  related: z.object({
    similarTasks: z.array(TaskRefSchema.extend({ projectName: z.string().nullable(), sourceAi: SourceAiSchema.nullable(), reason: z.string(), completedAt: isoDateTime.nullable() }).strict()),
    wikiPages: z.array(WikiRefSchema.extend({ reviewLabel: z.string() }).strict()),
  }).strict(),
  mergeSuggestions: z.array(MergeSuggestionSchema), neighborCount: z.number().int(), whyStalled: WhyStalledSchema.nullable(),
}).strict();

export const ExcerptSchema = z.object({ role: MessageRoleSchema, speakerLabel: z.string(), textMd: z.string(), messageSeq: z.number().int().nullable(), isEvidence: z.boolean() }).strict();
export const FlowEntrySchema = z.object({
  conversationId: z.string(), sourceAi: SourceAiSchema, title: z.string(), sourceUrl: z.string().nullable(), createdAt: isoDateTime, updatedAt: isoDateTime, date: isoDate,
  gapDaysFromNewer: z.number().int(), messageCount: z.number().int(), summary: z.string().nullable(), excerpts: z.array(ExcerptSchema), decisionIds: z.array(z.string()),
  isPrimary: z.boolean(), sharedWithTasks: z.array(z.object({ id: z.string(), title: z.string() }).strict()), serviceState: ServiceStateSchema, captureMethod: CaptureMethodSchema, isStartOfTask: z.boolean(),
}).strict();
export const FlowResponseSchema = z.object({
  items: z.array(FlowEntrySchema), page: PageSchema,
  today: z.object({ date: isoDate, daysSinceLastConversation: z.number().int() }).strict(), totalConversations: z.number().int(),
}).strict();
export const TimelineEventSchema = z.object({
  id: z.number().int(), at: isoDateTime, type: EventTypeSchema, taskId: z.string().nullable(), conversationId: z.string().nullable(), actor: EventActorSchema, payload: z.record(z.unknown()),
}).strict();
export const UpdateTaskResponseSchema = z.object({ task: TaskDetailSchema, event: TimelineEventSchema }).strict();
export const ResumePromptResponseSchema = z.object({
  taskId: z.string(), targetAi: SourceAiSchema, prompt: z.string(), continue: ContinueTargetSchema.nullable(), newChatUrl: z.string(), generatedAt: isoDateTime, cached: z.boolean(),
}).strict();
export const MergeTasksResponseSchema = z.object({ task: TaskDetailSchema, mergedTaskIds: z.array(z.string()), event: TimelineEventSchema }).strict();

export const MessageSchema = z.object({ id: z.number().int(), seq: z.number().int(), role: MessageRoleSchema, contentMd: z.string(), createdAt: isoDateTime.nullable(), voice: z.boolean().optional() }).strict();
export const ConversationDetailSchema = z.object({
  id: z.string(), sourceAi: SourceAiSchema, sourceId: z.string(), sourceUrl: z.string().nullable(), title: z.string(),
  createdAt: isoDateTime, updatedAt: isoDateTime, capturedAt: isoDateTime, messageCount: z.number().int(), captureMethod: CaptureMethodSchema, serviceState: ServiceStateSchema,
  pin: z.boolean(), isShared: z.boolean(), inServiceProject: z.boolean(), hasUnextractedArtifact: z.boolean(),
  task: TaskRefSchema.nullable(), sharedWithTasks: z.array(z.object({ id: z.string(), title: z.string() }).strict()), classification: ClassificationInfoSchema.nullable(),
  vault: VaultRefSchema, rawPath: z.string().nullable(), outcome: ConversationOutcomeInfoSchema.nullable().optional(), messages: listOf(MessageSchema),
}).strict();
export const AcceptMergeResponseSchema = z.object({ suggestion: MergeSuggestionSchema, task: TaskDetailSchema }).strict();
export const RejectMergeResponseSchema = AcceptMergeResponseSchema;

// ───────────── 5. 요약
export const DigestStripSchema = z.object({
  yesterdayConversations: z.number().int(), completedTasks: z.number().int(), newlyStalled: z.number().int(), quickQuestions: z.number().int(),
  collectionGap: z.object({ hasGap: z.boolean(), hours: z.number().nullable(), label: z.string() }).strict(),
}).strict();
export const DigestListItemSchema = z.object({ date: isoDate, generatedAt: isoDateTime, title: z.string(), strip: DigestStripSchema }).strict();
export const DigestEventSchema = z.object({
  at: isoDateTime.nullable(), timeLabel: z.string(), actor: EventActorSchema, sourceAi: SourceAiSchema.nullable(), action: DigestEventActionSchema, actionLabel: z.string(),
  tasks: z.array(z.object({ id: z.string(), title: z.string() }).strict()), project: ProjectRefSchema.nullable(), note: z.string().nullable(),
}).strict();
export const DigestPickSchema = z.object({
  rank: z.number().int(), task: TaskRefSchema, project: ProjectRefSchema.nullable(), freshnessLabel: z.string(), nextStep: z.string(), reason: z.string(),
  recommendedAi: SourceAiSchema, actionLabel: z.string(), continue: ContinueTargetSchema.nullable(), resumeScore: z.number(),
}).strict();
const ontologyNode = z.object({ id: z.string(), type: ObjectTypeSchema, label: z.string() }).strict();
export const OntologySuggestionSchema = z.object({
  id: z.string(), kind: z.enum(['object', 'link', 'merge']), confidence: z.number(), text: z.string(), linkType: LinkTypeSchema.nullable(),
  src: ontologyNode.nullable(), dst: ontologyNode.nullable(), evidenceCount: z.number().int(),
  evidence: z.array(z.object({ conversationId: z.string(), sourceAi: SourceAiSchema, excerpt: z.string(), at: isoDateTime }).strict()),
  // 1.5.0 선택 필드
  state: z.enum(['pending', 'accepted', 'rejected']).optional(), linkId: z.string().nullable().optional(), objectId: z.string().nullable().optional(),
  merge: z.object({ keepId: z.string(), mergeId: z.string() }).strict().nullable().optional(),
  reason: z.enum(['mid_confidence', 'first_seen_person', 'supersedes', 'merge_candidate', 'repeated']).optional(), note: z.string().nullable().optional(), createdAt: isoDateTime.optional(),
}).strict();
export const DigestOntologyCardSchema = z.object({ newlyLinkedCount: z.number().int(), pendingCount: z.number().int(), items: z.array(OntologySuggestionSchema) }).strict();
export const DeletionBatchStateSchema = z.enum(['pending', 'approved', 'running', 'paused', 'postponed', 'done', 'cancelled']);
export const DigestCleanupSchema = z.object({
  autoArchived: z.array(z.object({ sourceAi: SourceAiSchema, count: z.number().int(), note: z.string() }).strict()),
  deletionBatch: z.object({
    id: z.string(), state: DeletionBatchStateSchema, selectedCount: z.number().int(), candidateCount: z.number().int(),
    groups: z.array(z.object({
      sourceAi: SourceAiSchema, selected: z.number().int(), total: z.number().int(), backupVerified: z.boolean(),
      items: z.array(z.object({ itemId: z.number().int(), conversationId: z.string(), title: z.string(), kindLabel: z.string(), date: isoDate, selected: z.boolean(), excludedByUser: z.boolean() }).strict()),
    }).strict()),
    autoExcluded: z.array(z.object({ count: z.number().int(), sourceAi: SourceAiSchema.nullable(), reason: z.string() }).strict()),
    estimate: z.object({ perItemSec: z.number(), totalMin: z.number(), label: z.string() }).strict(),
  }).strict().nullable(),
}).strict();
export const DeletionBatchResponseSchema = z.object({ batch: DigestCleanupSchema.shape.deletionBatch.unwrap() }).strict();
export const SetDeletionItemBodySchema = z.object({ selected: z.boolean() }).strict();
export const ApproveDeletionBodySchema = z.object({ expectedSelectedCount: z.number().int().min(0), excludedItemIds: z.array(z.number().int()), confirmPhrase: z.string().min(1).max(100).optional() }).strict();
export const DigestResponseSchema = z.object({
  date: isoDate, generatedAt: isoDateTime, title: z.string(), prevDate: isoDate.nullable(), nextDate: isoDate.nullable(), vault: VaultRefSchema, strip: DigestStripSchema,
  yesterday: z.object({ date: isoDate, narrative: z.string(), events: z.array(DigestEventSchema) }).strict(),
  collectionStatus: z.array(CollectionSourceStatusSchema),
  thisWeek: z.object({ rangeLabel: z.string(), items: z.array(z.string()) }).strict(),
  todayPicks: z.array(DigestPickSchema),
  longNeglected: z.object({ count: z.number().int(), items: z.array(TaskRefSchema), prompt: z.string() }).strict(),
  movedProjects: z.array(z.object({ project: ProjectRefSchema, messageCount: z.number().int(), note: z.string(), becameStalled: z.boolean() }).strict()),
  quickQuestionsByAi: z.array(z.object({ sourceAi: SourceAiSchema, count: z.number().int() }).strict()),
  pendingMergeSuggestions: z.array(MergeSuggestionSchema), pendingProjectSuggestions: z.array(ProjectSuggestionSchema).optional(),
  alerts: z.array(z.object({ level: z.enum(['info', 'warn', 'error']), message: z.string(), sourceAi: SourceAiSchema.nullable() }).strict()),
  ontology: DigestOntologyCardSchema.nullable(), cleanup: DigestCleanupSchema.nullable(),
}).strict();

// ───────────── 6. 검색
export const SearchHitSchema = z.object({
  type: SearchResultTypeSchema, id: z.string(), title: z.string(), snippetMd: z.string(), task: TaskRefSchema.nullable(), conversationId: z.string().nullable(),
  sourceAi: SourceAiSchema.nullable(), sourceUrl: z.string().nullable(), vaultPath: z.string().nullable(), at: isoDateTime.nullable(), score: z.number(),
}).strict();
export const SearchResponseSchema = z.object({
  items: z.array(SearchHitSchema), page: PageSchema, query: z.string(),
  terms: z.array(z.object({ term: z.string(), mode: SearchModeSchema }).strict()), notice: z.string().nullable(), tookMs: z.number(),
}).strict();

// ───────────── 7. 가져오기 · 작업 · 분류
export const StartImportBodySchema = z.object({
  classify: z.boolean().optional(), maxCostUsd: z.number().min(0).nullable().optional(), onlyNewSince: isoDate.nullable().optional(),
}).strict();
export const GeminiActivityPreviewSchema = z.object({
  events: z.number().int(), skipped: z.number().int(), conversations: z.number().int(), byConversationId: z.number().int(), bySession: z.number().int(),
  sessionGapMinutes: z.number().int(), missingResponses: z.number().int(), attachments: z.number().int(), timezoneAssumed: z.number().int(),
}).strict();
export const ImportPreviewSchema = z.object({
  sourceAi: SourceAiSchema, detectedFormat: z.enum(['chatgpt_export_zip', 'chatgpt_conversations_json', 'claude_export_zip', 'claude_conversations_json', 'claude_projects_zip', 'claude_memories_zip', 'gemini_takeout_html', 'gemini_takeout_json', 'grokbot_json']), formatVersion: z.string().nullable(),
  category: z.enum(['conversations', 'projects', 'memories']),
  projects: z.object({ total: z.number().int(), new: z.number().int(), existing: z.number().int(), skipped: z.number().int(), names: z.array(z.string()) }).strict().nullable(),
  conversationsTotal: z.number().int(), conversationsNew: z.number().int(), conversationsUpdated: z.number().int(), conversationsUnchanged: z.number().int(), messagesTotal: z.number().int(),
  dateRange: z.object({ from: isoDateTime.nullable(), to: isoDateTime.nullable() }).strict(), quickQuestionPrefiltered: z.number().int(),
  activity: GeminiActivityPreviewSchema.nullable(),
  estimate: z.object({ model: z.string().nullable(), inputTokens: z.number().int(), outputTokens: z.number().int(), costUsd: z.number().nullable(), note: z.string() }).strict(),
  warnings: z.array(z.string()),
}).strict();
export const ImportProgressSchema = z.object({ phase: ImportStateSchema, processed: z.number().int(), total: z.number().int(), percent: z.number(), currentLabel: z.string().nullable(), etaSec: z.number().nullable() }).strict();
export const ImportJobSchema = z.object({
  id: z.string(), state: ImportStateSchema, sourceAi: SourceAiSchema.nullable(), fileName: z.string(), fileSizeBytes: z.number().int(), fileHash: z.string(),
  createdAt: isoDateTime, startedAt: isoDateTime.nullable(), finishedAt: isoDateTime.nullable(), options: StartImportBodySchema, preview: ImportPreviewSchema.nullable(), progress: ImportProgressSchema,
  result: z.object({
    conversationsNew: z.number().int(), conversationsUpdated: z.number().int(), skippedDuplicates: z.number().int(), tasksCreated: z.number().int(), classified: z.number().int(),
    classificationDeferred: z.number().int(), actualCostUsd: z.number().nullable(), unfinishedTasks: z.number().int(), projectsCreated: z.number().int(),
  }).strict().nullable(),
  errors: z.array(z.object({ conversationSourceId: z.string().nullable(), message: z.string() }).strict()), classifyJobId: z.string().nullable(),
}).strict();
export const JobSchema = z.object({
  id: z.string(), type: JobTypeSchema, state: JobStateSchema, createdAt: isoDateTime, startedAt: isoDateTime.nullable(), finishedAt: isoDateTime.nullable(),
  progress: z.object({ processed: z.number().int(), total: z.number().int().nullable(), percent: z.number().nullable() }).strict(),
  label: z.string(), parentId: z.string().nullable(), error: z.string().nullable(), costUsd: z.number().nullable(),
}).strict();
export const ClassificationStatusSchema = z.object({
  queue: z.object({ pending: z.number().int(), running: z.number().int(), deferred: z.number().int(), failedToday: z.number().int() }).strict(),
  today: z.object({ classified: z.number().int(), inputTokens: z.number().int(), outputTokens: z.number().int(), costUsd: z.number().nullable(), costUsdKnown: z.number(), costUnknownCount: z.number().int(), cacheHits: z.number().int() }).strict(),
  dailyCapUsd: z.number().nullable(), capReached: z.boolean(), model: z.string().nullable(), promptVersion: z.string(), needsReviewCount: z.number().int(), blockedCount: z.number().int(), lastRunAt: isoDateTime.nullable(),
}).strict();

// ───────────── 8. 설정 · 볼트
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM 형식이어야 해요');
export const SettingsSchema = z.object({
  llm: z.object({
    provider: LlmProviderSchema.nullable(), model: z.string().min(1).nullable(), baseUrl: z.string().url().nullable(), apiKeySet: z.boolean(),
    dailyCostCapUsd: z.number().min(0).nullable(), redactSecrets: z.boolean(), sensitiveKeywords: z.array(z.string()), sensitiveProjectIds: z.array(z.string()),
  }).strict(),
  classification: z.object({
    lowConfidenceThreshold: z.number().min(0).max(1), promptVersion: z.string(), condenseHead: z.number().int().min(0).max(50), condenseTail: z.number().int().min(0).max(50), condenseMiddleChars: z.number().int().min(0).max(5000),
  }).strict(),
  thresholds: StaleThresholdsSchema,
  ontology: z.object({ enabled: z.boolean(), autoAcceptMin: z.number().min(0).max(1), suggestMin: z.number().min(0).max(1), enabledTypes: z.array(ObjectTypeSchema), showPersonNames: z.boolean() }).strict(),
  vault: z.object({ path: z.string(), name: z.string().min(1), includeFullTranscript: z.boolean(), rawLocation: z.enum(['inside_vault', 'outside_vault']), rawHtmlRetentionDays: z.number().int().min(0), gitAutoCommit: z.boolean() }).strict(),
  digest: z.object({ time: hhmm, osNotification: z.boolean(), writeDailyNote: z.boolean(), llmNarrative: z.boolean() }).strict(),
  automation: z.object({ level: AutomationLevelSchema, catchupIntervalHours: z.number().min(0), catchupMaxPerRun: z.number().int().min(0), catchupMinIntervalSec: z.number().min(0) }).strict(),
  server: z.object({ port: z.number().int().min(1).max(65535), devOrigins: z.array(z.string()) }).strict(),
}).strict();
/** PATCH /settings — 섹션별 부분집합. apiKeySet은 받아도 무시(계약 §13.2) */
export const UpdateSettingsBodySchema = z.object({
  llm: SettingsSchema.shape.llm.partial().strict().optional(),
  classification: SettingsSchema.shape.classification.partial().strict().optional(),
  thresholds: StaleThresholdsSchema.partial().strict().optional(),
  ontology: SettingsSchema.shape.ontology.partial().strict().optional(),
  vault: SettingsSchema.shape.vault.partial().strict().optional(),
  digest: SettingsSchema.shape.digest.partial().strict().optional(),
  automation: SettingsSchema.shape.automation.partial().strict().optional(),
  server: SettingsSchema.shape.server.partial().strict().optional(),
}).strict();
export const PutLlmKeyBodySchema = z.object({ provider: LlmProviderSchema, apiKey: z.string().min(8).max(500) }).strict();
export const LlmTestBodySchema = z.object({ provider: LlmProviderSchema.optional(), model: z.string().min(1).optional() }).strict();
export const LlmTestResponseSchema = z.object({ ok: z.boolean(), provider: LlmProviderSchema, model: z.string(), latencyMs: z.number().nullable(), message: z.string() }).strict();
export const VaultConflictSchema = z.object({
  path: z.string(), entityType: z.enum(['conversation', 'task', 'project', 'wiki', 'daily']), entityId: z.string(), detectedAt: isoDateTime, backupPath: z.string(),
}).strict();

// ───────────── 9. 요청 본문
export const CreateProjectBodySchema = z.object({
  name: z.string().trim().min(1).max(80), aliases: z.array(z.string().trim().min(1).max(80)).max(50).optional(), colorHex: hex.optional(), status: ProjectStatusSchema.optional(),
}).strict();
export const UpdateProjectBodySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(), aliases: z.array(z.string().trim().min(1).max(80)).max(50).optional(), colorHex: hex.optional(),
  status: ProjectStatusSchema.optional(), thresholds: StaleThresholdsSchema.partial().strict().nullable().optional(),
}).strict();
export const UpdateTaskBodySchema = z.object({
  status: TaskStatusSchema.optional(), projectId: z.string().min(1).nullable().optional(), pin: z.boolean().optional(),
  title: z.string().trim().min(1).max(200).optional(), nextStep: z.string().max(1000).nullable().optional(),
  completionReason: CompletionReasonSchema.nullable().optional(), note: z.string().max(1000).optional(),
}).strict();
export const ResetOverridesBodySchema = z.object({
  fields: z.array(z.enum(['status', 'project', 'pin', 'title', 'next_step', 'decisions', 'open_questions'])).min(1),
}).strict();
export const UpdateOpenQuestionBodySchema = z.object({ resolved: z.boolean().optional(), text: z.string().trim().min(1).max(500).optional() }).strict();
export const UpdateDecisionBodySchema = z.object({ text: z.string().trim().min(1).max(500).optional(), valid: z.boolean().optional() }).strict();
export const MergeTasksBodySchema = z.object({ sourceTaskIds: z.array(z.string().min(1)).min(1).max(50), title: z.string().trim().min(1).max(200).optional() }).strict();
export const AcceptMergeBodySchema = z.object({ primaryTaskId: z.string().min(1).optional(), title: z.string().trim().min(1).max(200).optional() }).strict();
export const RejectMergeBodySchema = z.object({ reason: z.string().max(500).optional() }).strict();
export const AcceptProjectSuggestionBodySchema = z.object({ name: z.string().trim().min(1).max(80).optional(), colorHex: hex.optional(), taskIds: z.array(z.string().min(1)).max(500).optional() }).strict(); // 1.1.0
export const RejectProjectSuggestionBodySchema = z.object({ reason: z.string().max(500).optional() }).strict(); // 1.1.0
export const RunClassificationBodySchema = z.object({
  scope: z.enum(['unclassified', 'changed', 'needs_review', 'conversations', 'project']),
  conversationIds: z.array(z.string()).max(5000).optional(), projectId: z.string().optional(), force: z.boolean().optional(),
  refreshCache: z.boolean().optional(),
}).strict();
export const ImportFromPathBodySchema = z.object({ path: z.string().min(1), sourceAi: z.enum(['chatgpt', 'claude', 'gemini', 'grokbot']).optional(), geminiSessionGapMinutes: z.number().int().min(1).max(1440).optional() }).strict();

// ───────────── 10. 쿼리 (쉼표 목록 · 불리언 · 숫자)
const csv = <S extends z.ZodTypeAny>(item: S) => z.preprocess(
  (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v), z.array(item).min(1));
const boolQ = z.preprocess((v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v), z.boolean());
const intQ = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
export const LimitCursorQuery = { limit: intQ(1, 200).optional(), cursor: z.string().optional() };

export const GraphQuerySchema = z.object({
  mode: GraphModeSchema.optional(), status: csv(TaskStatusSchema).optional(), sourceAi: csv(SourceAiSchema).optional(), projectId: csv(z.string()).optional(),
  from: isoDate.optional(), to: isoDate.optional(), includeQuick: boolQ.optional(), includeDone: boolQ.optional(), includeWiki: boolQ.optional(),
  focus: z.string().optional(), depth: z.coerce.number().int().min(1).max(2).optional(), at: isoDate.optional(),
  objectTypes: csv(ObjectTypeSchema).optional(), linkTypes: csv(LinkTypeSchema).optional(), hideSingleMention: boolQ.optional(), limit: intQ(1, 10000).optional(),
}).strict();
export const ActivityQuerySchema = z.object({
  granularity: z.enum(['week', 'day']).optional(), weeks: intQ(1, 260).optional(), from: isoDate.optional(), to: isoDate.optional(), projectId: z.string().optional(),
}).strict();
export const ProjectsQuerySchema = z.object({ status: csv(ProjectStatusSchema).optional(), ...LimitCursorQuery }).strict();
export const ProjectDetailQuerySchema = z.object({ weeks: intQ(1, 104).optional() }).strict();
export const TaskListQuerySchema = z.object({
  status: csv(TaskStatusSchema).optional(), kind: KindSchema.optional(), projectId: csv(z.string()).optional(), sourceAi: csv(SourceAiSchema).optional(),
  from: isoDate.optional(), to: isoDate.optional(), needsReview: boolQ.optional(), pinned: boolQ.optional(), minStaleDays: intQ(0, 100000).optional(),
  staleStage: csv(StaleStageSchema).optional(), topicId: z.string().optional(), classificationState: ClassificationStateSchema.optional(), handedOff: boolQ.optional(),
  sort: z.enum(['stale_desc', 'last_activity_desc', 'started_desc', 'resume_score_desc', 'title_asc']).optional(), ...LimitCursorQuery,
}).strict();
export const BoardQuerySchema = z.object({
  projectId: csv(z.string()).optional(), sourceAi: csv(SourceAiSchema).optional(), from: isoDate.optional(), to: isoDate.optional(), needsReview: boolQ.optional(),
  doneWithinDays: intQ(1, 3650).optional(), columnLimit: intQ(1, 500).optional(),
}).strict();
export const FlowQuerySchema = z.object({ filter: z.enum(['all', 'excerpts', 'decisions']).optional(), ...LimitCursorQuery }).strict();
export const ResumePromptQuerySchema = z.object({ targetAi: SourceAiSchema.optional() }).strict();
export const ConversationQuerySchema = z.object({ aroundSeq: intQ(1, 10_000_000).optional(), ...LimitCursorQuery, limit: intQ(1, 500).optional(),
  /** 1.10.0 메시지 id 둘레 — window개씩 앞뒤(기본 3) */ around: intQ(1, 2_000_000_000).optional(), window: intQ(0, 50).optional() }).strict();
export const MergeSuggestionsQuerySchema = z.object({
  state: MergeSuggestionStateSchema.optional(), taskId: z.string().optional(), minConfidence: z.coerce.number().min(0).max(1).optional(), ...LimitCursorQuery,
}).strict();
export const ProjectSuggestionsQuerySchema = z.object({ state: ProjectSuggestionStateSchema.optional(), ready: boolQ.optional(), ...LimitCursorQuery }).strict(); // 1.1.0
export const DigestsQuerySchema = z.object({ ...LimitCursorQuery }).strict();
export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1, '검색어를 입력해 주세요').max(200, '검색어는 200자 이내로 입력해 주세요'),
  types: csv(SearchResultTypeSchema).optional(), projectId: csv(z.string()).optional(), sourceAi: csv(SourceAiSchema).optional(), status: csv(TaskStatusSchema).optional(),
  from: isoDate.optional(), to: isoDate.optional(), ...LimitCursorQuery,
  kind: csv(KindSchema).optional(), // 1.10.0
}).strict();
export const ImportsQuerySchema = z.object({ force: boolQ.optional(), ...LimitCursorQuery }).strict();
export const JobsQuerySchema = z.object({ type: csv(JobTypeSchema).optional(), state: csv(JobStateSchema).optional(), parentId: z.string().optional(), ...LimitCursorQuery }).strict();
export const EmptyQuerySchema = z.object({}).strict();
export const WeeklyReviewQuerySchema = z.object({ date: isoDate.optional() }).strict();

// ───────────── 11. LLM 분류 출력 (설계서 §7.6)
export const LlmClassificationSchema = z.object({
  kind: KindSchema,
  resolution: ResolutionSchema,
  summary: z.string().min(1).max(300),
  detail: z.array(z.string().max(500)).max(8).default([]),
  next_step: z.string().max(500).nullable().default(null),
  project: z.string().max(80).nullable().default(null),
  new_project_suggestion: z.string().max(80).nullable().default(null),
  topics: z.array(z.string().min(1).max(40)).max(10).default([]),
  decisions: z.array(z.string().min(1).max(300)).max(5).default([]),
  open_questions: z.array(z.string().min(1).max(300)).max(5).default([]),
  same_task_candidates: z.array(z.string()).max(5).default([]),
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(500).nullable().default(null),
  /** 1.1.0 사용자가 다른 창·도구에서 이어가겠다고 밝힘(완료 아님). 모델이 빼먹으면 false */
  handoff: z.boolean().default(false),
  handoff_target: z.string().max(80).nullable().default(null),
  /** 1.4.0 cls-v4 대화 결과. 모델이 빼먹으면 null → 코어가 규칙으로 채움 */
  conversation_outcome: z.enum(['done', 'moved', 'interrupted', 'open']).nullable().default(null),
});
export type LlmClassification = z.infer<typeof LlmClassificationSchema>;

// ───────────── 12. 볼트 frontmatter (설계서 §6.2)
export const ConversationFrontmatterSchema = z.object({
  type: z.literal('conversation'), id: z.string(), source_ai: SourceAiSchema, source_id: z.string(), source_url: z.string().nullable(), title: z.string(),
  kind: KindSchema.nullable(), status: TaskStatusSchema.nullable(), stale_days: z.number().int().nullable(), summary: z.string().nullable(), next_step: z.string().nullable(),
  project: z.string().nullable(), task: z.string().nullable(), topics: z.array(z.string()), pin: z.boolean(), service_state: ServiceStateSchema,
  created: z.string(), updated: z.string(), captured: z.string(), message_count: z.number().int(), capture_method: CaptureMethodSchema,
  content_hash: z.string().nullable(), raw_path: z.string().nullable(),
  classifier: z.object({ model: z.string(), version: z.string(), confidence: z.number(), classified_at: z.string() }).nullable(),
  overrides: z.array(z.string()), deletion: z.object({ state: z.string(), deleted_at: z.string().nullable() }), tags: z.array(z.string()),
});
export const TaskFrontmatterSchema = z.object({
  type: z.literal('task'), id: z.string(), title: z.string(), status: TaskStatusSchema, stale_days: z.number().int().nullable(), project: z.string().nullable(), pin: z.boolean(),
  conversations: z.array(z.string()), source_ais: z.array(SourceAiSchema), started: z.string().nullable(), last_activity: z.string().nullable(), completed: z.string().nullable(),
  next_step: z.string().nullable(), decisions: z.array(z.object({ text: z.string(), source: z.string().nullable() })),
  open_questions: z.array(z.object({ text: z.string(), resolved: z.boolean() })), origin: TaskOriginSchema, overrides: z.array(z.string()), tags: z.array(z.string()),
});
export const ProjectFrontmatterSchema = z.object({
  type: z.literal('project'), id: z.string(), name: z.string(), status: ProjectStatusSchema, aliases: z.array(z.string()), color: z.string(), tags: z.array(z.string()),
});

// ───────────── 13. 컴파일 시점 검사: 스키마 ⇔ api-types.ts
type Eq<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<X extends true> = X;
/** 하나라도 다르면 tsc가 여기서 실패한다 */
export type SchemaTypeChecks = [
  Assert<Eq<z.infer<typeof HealthResponseSchema>, T.HealthResponse>>, // health
  Assert<Eq<z.infer<typeof MetaResponseSchema>, T.MetaResponse>>, // meta
  Assert<Eq<z.infer<typeof DashboardResponseSchema>, T.DashboardResponse>>, // dashboard
  Assert<Eq<z.infer<typeof GraphResponseSchema>, T.GraphResponse>>, // graph
  Assert<Eq<z.infer<typeof ActivityResponseSchema>, T.ActivityResponse>>, // activity
  Assert<Eq<z.infer<typeof ProjectSummarySchema>, T.ProjectSummary>>, // projectSummary
  Assert<Eq<z.infer<typeof ProjectDetailSchema>, T.ProjectDetail>>, // projectDetail
  Assert<Eq<z.infer<typeof TopicDetailSchema>, T.TopicDetail>>, // topic
  Assert<Eq<z.infer<typeof TaskListItemSchema>, T.TaskListItem>>, // taskListItem
  Assert<Eq<z.infer<typeof BoardResponseSchema>, T.BoardResponse>>, // board
  Assert<Eq<z.infer<typeof TaskDetailSchema>, T.TaskDetail>>, // taskDetail
  Assert<Eq<z.infer<typeof FlowResponseSchema>, T.FlowResponse>>, // flow
  Assert<Eq<z.infer<typeof UpdateTaskResponseSchema>, T.UpdateTaskResponse>>, // updateTask
  Assert<Eq<z.infer<typeof ResumePromptResponseSchema>, T.ResumePromptResponse>>, // resume
  Assert<Eq<z.infer<typeof MergeTasksResponseSchema>, T.MergeTasksResponse>>, // mergeTasks
  Assert<Eq<z.infer<typeof ConversationDetailSchema>, T.ConversationDetail>>, // conversation
  Assert<Eq<z.infer<typeof MergeSuggestionSchema>, T.MergeSuggestion>>, // mergeSuggestion
  Assert<Eq<z.infer<typeof AcceptMergeResponseSchema>, T.AcceptMergeResponse>>, // acceptMerge
  Assert<Eq<z.infer<typeof DigestListItemSchema>, T.DigestListItem>>, // digestList
  Assert<Eq<z.infer<typeof DigestResponseSchema>, T.DigestResponse>>, // digest
  Assert<Eq<z.infer<typeof SearchResponseSchema>, T.SearchResponse>>, // search
  Assert<Eq<z.infer<typeof ImportJobSchema>, T.ImportJob>>, // importJob
  Assert<Eq<z.infer<typeof JobSchema>, T.Job>>, // job
  Assert<Eq<z.infer<typeof ClassificationStatusSchema>, T.ClassificationStatus>>, // classificationStatus
  Assert<Eq<z.infer<typeof SettingsSchema>, T.Settings>>, // settings
  Assert<Eq<z.infer<typeof LlmTestResponseSchema>, T.LlmTestResponse>>, // llmTest
  Assert<Eq<z.infer<typeof VaultConflictSchema>, T.VaultConflict>>, // vaultConflict
  Assert<Eq<z.infer<typeof ApiErrorSchema>, T.ApiError>>, // apiError
  Assert<Eq<z.infer<typeof TimelineEventSchema>, T.TimelineEvent>>, // timeline
  Assert<Eq<z.infer<typeof CreateProjectBodySchema>, T.CreateProjectBody>>, // createProject
  Assert<Eq<z.infer<typeof UpdateTaskBodySchema>, T.UpdateTaskBody>>, // updateTaskBody
  Assert<Eq<z.infer<typeof StartImportBodySchema>, T.StartImportBody>>, // startImport
  Assert<Eq<z.infer<typeof RunClassificationBodySchema>, T.RunClassificationBody>>, // runClassification
  Assert<Eq<z.infer<typeof RejectMergeResponseSchema>, T.RejectMergeResponse>>, // rejectMerge
  Assert<Eq<z.infer<typeof DeletionBatchResponseSchema>, T.DeletionBatchResponse>>, // deletionBatch (LATER, 잠정)
  Assert<Eq<z.infer<typeof ApproveDeletionBodySchema>, T.ApproveDeletionBody>>, // approveDeletion (LATER, 잠정)
  Assert<Eq<z.infer<typeof ProjectSuggestionSchema>, T.ProjectSuggestion>>, // projectSuggestion (1.1.0)
  Assert<Eq<z.infer<typeof AcceptProjectSuggestionResponseSchema>, T.AcceptProjectSuggestionResponse>>, // acceptProjectSuggestion (1.1.0)
  Assert<Eq<z.infer<typeof RejectProjectSuggestionResponseSchema>, T.RejectProjectSuggestionResponse>>, // rejectProjectSuggestion (1.1.0)
  Assert<Eq<z.infer<typeof AcceptProjectSuggestionBodySchema>, T.AcceptProjectSuggestionBody>>,
  Assert<Eq<z.infer<typeof RejectProjectSuggestionBodySchema>, T.RejectProjectSuggestionBody>>, // rejectProjectSuggestionBody (1.2.0)
  Assert<Eq<z.infer<typeof GeminiActivityPreviewSchema>, T.GeminiActivityPreview>>, // geminiActivityPreview (1.2.0) // acceptProjectSuggestionBody (1.1.0)
  Assert<Eq<z.infer<typeof HandoffInfoSchema>, T.HandoffInfo>>, // handoff (1.1.0)
];

// ───────── 1.5.0 로컬 세션 수집기 (§12.10)
export const LocalSourceAiSchema = z.enum(['claude-code', 'codex']);
export const CollectorSourceConfigSchema = z.object({ sourceAi: LocalSourceAiSchema, root: z.string().min(1).max(1000), enabled: z.boolean() }).strict();
export const CollectorConfigSchema = z.object({
  enabled: z.boolean(), sources: z.array(CollectorSourceConfigSchema).max(10), pollIntervalSec: z.number().int().min(5).max(3600),
  toolOutputMaxChars: z.number().int().min(0).max(20000), toolInputMaxChars: z.number().int().min(0).max(20000),
  excludeCwdPatterns: z.array(z.string().max(500)).max(50), classify: z.boolean(),
}).strict();
export const PutCollectorConfigBodySchema = CollectorConfigSchema.partial().strict();
export const CollectorRunBodySchema = z.object({ sourceAi: LocalSourceAiSchema.optional(), files: z.array(z.string()).max(1000).optional(), classify: z.boolean().optional(), dryRun: z.boolean().optional() }).strict();
type _CollectorChecks = [
  Assert<Eq<z.infer<typeof CollectorConfigSchema>, T.CollectorConfig>>,
  Assert<Eq<z.infer<typeof PutCollectorConfigBodySchema>, T.PutCollectorConfigBody>>,
  Assert<Eq<z.infer<typeof CollectorRunBodySchema>, T.CollectorRunBody>>,
];

// ───────────── 1.7.0 온톨로지 (§14.2 구현)
const propVal = z.union([z.string(), z.number(), z.boolean()]);
export const OntologyEvidenceSchema = z.object({
  id: z.number().int(), conversationId: z.string(), sourceAi: SourceAiSchema, conversationTitle: z.string(), messageSeq: z.number().int().nullable(),
  excerpt: z.string(), at: isoDateTime, confidence: z.number().nullable(), model: z.string().nullable(),
}).strict();
export const OntologyOriginSchema = z.enum(['llm', 'rule', 'user']);
export const OntologyObjectSchema = z.object({
  id: z.string(), type: ObjectTypeSchema, name: z.string(), aliases: z.array(z.string()), status: ObjectStatusSchema, confidence: z.number().nullable(),
  origin: OntologyOriginSchema, firstSeenAt: isoDateTime, lastSeenAt: isoDateTime, mentionCount: z.number().int(), properties: z.record(z.string(), propVal),
  ref: z.object({ table: z.enum(['projects', 'tasks', 'topics']), id: z.string() }).strict().nullable(), projectObjectId: z.string().nullable(),
  colorHex: z.string().nullable(), statusVisual: StatusVisualSchema.nullable(), badge: z.string().nullable(), mergedInto: z.string().nullable(), evidencePreview: z.array(OntologyEvidenceSchema),
}).strict();
export const OntologyLinkSchema = z.object({
  id: z.string(), type: LinkTypeSchema, srcId: z.string(), dstId: z.string(), status: LinkStatusSchema, confidence: z.number().nullable(), origin: OntologyOriginSchema,
  mentionCount: z.number().int(), validFrom: isoDateTime.nullable(), endedAt: isoDateTime.nullable(), firstSeenAt: isoDateTime, lastSeenAt: isoDateTime,
  properties: z.record(z.string(), z.string()), evidencePreview: OntologyEvidenceSchema.nullable(),
}).strict();
const objRef = z.object({ id: z.string(), type: ObjectTypeSchema, label: z.string() }).strict();
export const OntologyGraphResponseSchema = z.object({
  today: isoDate, objects: z.array(OntologyObjectSchema), links: z.array(OntologyLinkSchema), suggestions: z.array(OntologySuggestionSchema),
  counts: z.object({ objects: z.number().int(), links: z.number().int(), pendingSuggestions: z.number().int(), hiddenSingleMention: z.number().int() }).strict(), truncated: z.boolean(),
}).strict();
export const ObjectDetailSchema = z.object({
  object: OntologyObjectSchema,
  links: z.array(OntologyLinkSchema.extend({ direction: z.enum(['out', 'in']), other: objRef.extend({ status: ObjectStatusSchema }) })),
  evidence: z.array(OntologyEvidenceSchema), evidenceTotal: z.number().int(), mentionsByWeek: z.array(z.object({ week: isoDate, count: z.number().int() }).strict()),
  relatedTasks: z.array(TaskRefSchema),
}).strict();
export const WhyStalledResponseSchema = z.object({
  taskId: z.string(), objectId: z.string().nullable(), task: z.object({ status: TaskStatusSchema, staleDays: z.number().int().nullable() }).strict(),
  chain: z.array(z.object({ depth: z.number().int(), link: OntologyLinkSchema, object: objRef.extend({ status: ObjectStatusSchema, taskStatus: TaskStatusSchema.nullable() }) }).strict()),
  rootCauses: z.array(z.object({ object: objRef, kind: z.enum(['waiting_person', 'undecided', 'blocked_task', 'external', 'other']), label: z.string() }).strict()),
  ended: z.array(OntologyLinkSchema), suggested: z.array(OntologyLinkSchema),
  lastConversation: z.object({ id: z.string(), title: z.string(), sourceAi: SourceAiSchema, at: isoDateTime }).strict().nullable(), explanation: z.string(),
}).strict();
export const ImpactResponseSchema = z.object({ objectId: z.string(), affected: z.array(z.object({ object: objRef, via: z.array(LinkTypeSchema), depth: z.number().int(), superseded: z.boolean() }).strict()), supersededBy: objRef.nullable() }).strict();
export const SimilarResponseSchema = z.object({ items: z.array(z.object({ task: TaskRefSchema, score: z.number(), sharedObjects: z.array(objRef), decisions: z.array(z.string()), blockers: z.array(z.string()), completedAt: isoDateTime.nullable() }).strict()) }).strict();
export const GraphPathResponseSchema = z.object({ found: z.boolean(), objects: z.array(objRef), links: z.array(OntologyLinkSchema), usedSuggested: z.boolean() }).strict();
export const ListSuggestionsResponseSchema = z.object({ items: z.array(OntologySuggestionSchema), total: z.number().int(), nextCursor: z.string().nullable() }).strict();
export const ListObjectsResponseSchema = z.object({ items: z.array(OntologyObjectSchema), total: z.number().int(), nextCursor: z.string().nullable() }).strict();

// 쿼리·본문
export const OntologyQuerySchema = z.object({
  objectTypes: csv(ObjectTypeSchema).optional(), linkTypes: csv(LinkTypeSchema).optional(), status: csv(z.enum(['accepted', 'suggested'])).optional(),
  projectId: z.string().optional(), includeEnded: boolQ.optional(), minMentions: intQ(1, 1000).optional(),
}).strict();
export const ListObjectsQuerySchema = z.object({ type: csv(ObjectTypeSchema).optional(), q: z.string().optional(), status: csv(ObjectStatusSchema).optional(), ...LimitCursorQuery }).strict();
export const ListSuggestionsQuerySchema = z.object({ kind: csv(z.enum(['object', 'link', 'merge'])).optional(), minConfidence: z.coerce.number().min(0).max(1).optional(), ...LimitCursorQuery }).strict();
export const PatchObjectBodySchema = z.object({ name: z.string().min(1).max(80).optional(), aliases: z.array(z.string().min(1).max(80)).max(30).optional(), properties: z.record(z.string(), propVal.nullable()).optional() }).strict();
export const MergeObjectBodySchema = z.object({ intoId: z.string().min(1) }).strict();
export const SplitObjectBodySchema = z.object({ newName: z.string().min(1).max(80), aliases: z.array(z.string()).optional(), evidenceIds: z.array(z.number().int()).optional(), linkIds: z.array(z.string()).optional() }).strict();
export const EndLinkBodySchema = z.object({ endedAt: isoDateTime.optional(), note: z.string().max(300).optional() }).strict();
export const RejectSuggestionBodySchema = z.object({ reason: z.string().max(300).optional() }).strict();
export const BulkAcceptSuggestionsBodySchema = z.object({ minConfidence: z.number().min(0).max(1).optional(), kind: z.array(z.enum(['object', 'link', 'merge'])).optional(), ids: z.array(z.string()).max(500).optional() }).strict();
export const SimilarQuerySchema = z.object({ text: z.string().min(1).max(2000), limit: intQ(1, 20).optional() }).strict();
export const GraphPathQuerySchema = z.object({ from: z.string().min(1), to: z.string().min(1), maxDepth: intQ(1, 6).optional() }).strict();
export const OntologyExtractBodySchema = z.object({ scope: z.enum(['changed', 'all']).optional(), taskIds: z.array(z.string()).max(1000).optional(), llm: z.boolean().optional(), mode: z.enum(['rules', 'all']).optional(), maxCostUsd: z.number().min(0).nullable().optional() }).strict();
type _OntologyChecks = [
  Assert<Eq<z.infer<typeof OntologyObjectSchema>, T.OntologyObject>>,
  Assert<Eq<z.infer<typeof OntologyLinkSchema>, T.OntologyLink>>,
  Assert<Eq<z.infer<typeof OntologyGraphResponseSchema>, T.OntologyGraphResponse>>,
  Assert<Eq<z.infer<typeof WhyStalledResponseSchema>, T.WhyStalledResponse>>,
  Assert<Eq<z.infer<typeof PatchObjectBodySchema>, T.PatchObjectBody>>,
  Assert<Eq<z.infer<typeof SplitObjectBodySchema>, T.SplitObjectBody>>,
  Assert<Eq<z.infer<typeof BulkAcceptSuggestionsBodySchema>, T.BulkAcceptSuggestionsBody>>,
  Assert<Eq<z.infer<typeof OntologyExtractBodySchema>, T.OntologyExtractBody>>,
];

// ───────────── 1.8.0 MCP 쓰기
export const McpTaskStatusSchema = z.enum(['진행 중', '멈춤', '완료']);
export const McpLogTaskBodySchema = z.object({
  title: z.string().trim().min(1).max(200), project: z.string().max(200).nullable().optional(), status: McpTaskStatusSchema.optional(),
  note: z.string().max(4000).nullable().optional(), nextStep: z.string().max(500).nullable().optional(), sourceAi: SourceAiSchema, sourceUrl: z.string().max(2000).nullable().optional(),
}).strict();
export const McpUpdateTaskStatusBodySchema = z.object({ taskId: z.string().optional(), query: z.string().min(1).max(200).optional(), status: McpTaskStatusSchema, nextStep: z.string().max(500).nullable().optional() }).strict()
  .refine((b) => !!b.taskId !== !!b.query, { message: 'taskId와 query 중 하나만 주세요' });
export const McpEventsQuerySchema = z.object({ limit: intQ(1, 200).optional() }).strict();
type _McpChecks = [Assert<Eq<z.infer<typeof McpLogTaskBodySchema>, T.McpLogTaskBody>>];

// ───────── 1.9.0 확장 수집 · 페어링 (§14.3) — 요청 본문
export const PairingClientKindSchema = z.enum(['extension', 'mcp', 'collector']);
export const StartPairingBodySchema = z.object({ kind: PairingClientKindSchema, name: z.string().trim().max(80).optional(), allowWrite: z.boolean().optional() }).strict();
export const CompletePairingBodySchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, '6자리 숫자 코드를 입력해 주세요'),
  client: z.object({ kind: PairingClientKindSchema, name: z.string().trim().min(1).max(80), version: z.string().trim().min(1).max(40), extensionId: z.string().regex(/^[a-z0-9]{8,64}$/i).optional() }).strict(),
}).strict();
const ChatSourceAiSchema = z.enum(['chatgpt', 'claude', 'gemini', 'grok']);
const AdapterInfoSchema = z.object({ name: z.string().min(1).max(80), version: z.string().min(1).max(40), domVersion: z.string().max(80).nullable().optional() }).strict();
export const IngestMessageSchema = z.object({
  seq: z.number().int().min(0), externalId: z.string().max(200).nullable(), role: z.enum(['user', 'assistant', 'system', 'tool']),
  contentMd: z.string(), createdAt: isoDateTime.nullable(), voice: z.boolean().optional(),
}).strict();
export const IngestSnapshotBodySchema = z.object({
  sourceAi: ChatSourceAiSchema, sourceId: z.string().min(1).max(200), url: z.string().max(2000).nullable(), title: z.string().max(500),
  capturedAt: isoDateTime, serviceUpdatedAt: isoDateTime.nullable(), captureMethod: z.enum(['extension_live', 'extension_catchup']),
  mode: z.enum(['full', 'append']), appendFromSeq: z.number().int().min(0).optional(), baseContentHash: z.string().nullable().optional(),
  messages: z.array(IngestMessageSchema).max(5000), contentHash: z.string().min(1).max(100), complete: z.boolean(), adapter: AdapterInfoSchema,
  project: z.object({ externalId: z.string().max(200), name: z.string().max(200) }).strict().nullable().optional(),
}).strict().superRefine((b, ctx) => {
  if (b.mode === 'append' && (b.appendFromSeq === undefined || !b.baseContentHash)) ctx.addIssue({ code: 'custom', message: 'append에는 appendFromSeq와 baseContentHash가 필요해요', path: ['appendFromSeq'] });
});
export const IngestReplayBodySchema = z.object({ snapshots: z.array(IngestSnapshotBodySchema).min(1).max(20) }).strict();
export const CatchupDiffBodySchema = z.object({
  sourceAi: ChatSourceAiSchema,
  items: z.array(z.object({ sourceId: z.string().min(1).max(200), title: z.string().max(500), updatedAt: isoDateTime.nullable(), url: z.string().max(2000).nullable().optional() }).strict()).max(500),
  cursor: z.string().max(500).nullable(), endOfList: z.boolean(),
}).strict();
export const AdapterHealthBodySchema = z.object({
  adapter: AdapterInfoSchema, health: AdapterHealthSchema,
  checks: z.array(z.object({ name: z.string().max(80), ok: z.boolean(), detail: z.string().max(500).nullable().optional() }).strict()).max(50),
  errorCode: z.string().max(80).nullable().optional(), at: isoDateTime, bufferedSnapshots: z.number().int().min(0).optional(),
}).strict();

export const WeeklyReviewItemSchema = z.object({ task: TaskListItemSchema, at: isoDateTime.nullable() }).strict();
export const WeeklyReviewResponseSchema = z.object({
  weekStart: isoDate, weekEnd: isoDate, prevWeek: isoDate, nextWeek: isoDate.nullable(), isCurrent: z.boolean(), today: isoDate,
  finished: z.array(WeeklyReviewItemSchema), started: z.array(WeeklyReviewItemSchema), stalled: z.array(WeeklyReviewItemSchema), neglected: z.array(WeeklyReviewItemSchema),
  byAi: z.array(z.object({ sourceAi: SourceAiSchema, conversationCount: z.number().int(), messageCount: z.number().int() }).strict()),
  conversationCount: z.number().int(), messageCount: z.number().int(), neglectDays: z.number().int(),
}).strict();
