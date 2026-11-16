// 개발용 런타임 검사: 모든 응답(모의·라이브)과 보내는 본문을 공유 zod 스키마(@subbrain/shared/schemas, .strict())로 확인한다.
// 어긋나면 콘솔 경고 + window.__subbrainSchema에 모아 두고, 화면 왼쪽 아래 안내에 개수를 띄운다.
// 운영 빌드에서는 import.meta.env.DEV가 false라 스키마(zod)를 아예 불러오지 않는다.
/** zod 스키마에서 쓰는 부분만 (web은 zod에 직접 의존하지 않는다) */
interface ZodTypeAny { safeParse(v: unknown): { success: true } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } } }

type Schemas = typeof import('@subbrain/shared/schemas');
type Key = keyof Schemas;
export interface SchemaIssue { at: string; kind: 'response' | 'request' | 'error'; method: string; path: string; schema: string; issues: Array<{ path: string; message: string }>; sample?: unknown }
interface Store { checked: number; issues: SchemaIssue[]; listeners: Set<() => void> }

declare global { interface Window { __subbrainSchema?: Store } }
const store = (): Store => (window.__subbrainSchema ??= { checked: 0, issues: [], listeners: new Set() });
export const schemaStore = store;
export function onSchemaIssue(fn: () => void) { store().listeners.add(fn); return () => { store().listeners.delete(fn); }; }

let loaded: Promise<Schemas> | null = null;
const schemas = () => (loaded ??= import('@subbrain/shared/schemas'));

// 경로 → 응답 스키마 (계약서 MVP 엔드포인트)
const RESPONSES: Array<[string, RegExp, Key | ((s: Schemas) => ZodTypeAny)]> = [
  ['GET', /^\/health$/, 'HealthResponseSchema'],
  ['GET', /^\/meta$/, 'MetaResponseSchema'],
  ['GET', /^\/dashboard$/, 'DashboardResponseSchema'],
  ['GET', /^\/graph$/, 'GraphResponseSchema'],
  ['GET', /^\/activity$/, 'ActivityResponseSchema'],
  ['GET', /^\/projects$/, (s) => s.listOf(s.ProjectSummarySchema)],
  ['GET', /^\/projects\/[^/]+$/, 'ProjectDetailSchema'],
  ['GET', /^\/topics\/[^/]+$/, 'TopicDetailSchema'],
  ['GET', /^\/tasks$/, (s) => s.listOf(s.TaskListItemSchema)],
  ['GET', /^\/tasks\/[^/]+$/, 'TaskDetailSchema'],
  ['GET', /^\/tasks\/[^/]+\/flow$/, 'FlowResponseSchema'],
  ['GET', /^\/tasks\/[^/]+\/resume-prompt$/, 'ResumePromptResponseSchema'],
  ['PATCH', /^\/tasks\/[^/]+$/, 'UpdateTaskResponseSchema'],
  ['PATCH', /^\/tasks\/[^/]+\/open-questions\/[^/]+$/, 'OpenQuestionSchema'],
  ['POST', /^\/tasks\/[^/]+\/overrides\/reset$/, 'TaskDetailSchema'],
  ['GET', /^\/board$/, 'BoardResponseSchema'],
  ['GET', /^\/digests$/, (s) => s.listOf(s.DigestListItemSchema)],
  ['GET', /^\/digests\/[^/]+$/, 'DigestResponseSchema'],
  ['GET', /^\/search$/, 'SearchResponseSchema'],
  ['GET', /^\/merge-suggestions$/, (s) => s.listOf(s.MergeSuggestionSchema)],
  ['POST', /^\/merge-suggestions\/[^/]+\/accept$/, 'AcceptMergeResponseSchema'],
  ['POST', /^\/merge-suggestions\/[^/]+\/reject$/, 'RejectMergeResponseSchema'],
  ['GET', /^\/project-suggestions$/, (s) => s.listOf(s.ProjectSuggestionSchema)],
  ['POST', /^\/project-suggestions\/[^/]+\/accept$/, 'AcceptProjectSuggestionResponseSchema'],
  ['POST', /^\/project-suggestions\/[^/]+\/reject$/, 'RejectProjectSuggestionResponseSchema'],
  ['GET', /^\/conversations\/[^/]+$/, 'ConversationDetailSchema'],
  ['GET', /^\/classification\/status$/, 'ClassificationStatusSchema'],
  ['GET', /^\/deletion-batches\/[^/]+$/, 'DeletionBatchResponseSchema'],
  ['PATCH', /^\/deletion-batches\/[^/]+\/items\/[^/]+$/, 'DeletionBatchResponseSchema'],
  ['POST', /^\/deletion-batches\/[^/]+\/(approve|postpone)$/, 'DeletionBatchResponseSchema'],
];
const BODIES: Array<[string, RegExp, Key]> = [
  ['PATCH', /^\/tasks\/[^/]+$/, 'UpdateTaskBodySchema'],
  ['PATCH', /^\/tasks\/[^/]+\/open-questions\/[^/]+$/, 'UpdateOpenQuestionBodySchema'],
  ['POST', /^\/tasks\/[^/]+\/overrides\/reset$/, 'ResetOverridesBodySchema'],
  ['POST', /^\/merge-suggestions\/[^/]+\/accept$/, 'AcceptMergeBodySchema'],
  ['POST', /^\/merge-suggestions\/[^/]+\/reject$/, 'RejectMergeBodySchema'],
  ['POST', /^\/project-suggestions\/[^/]+\/accept$/, 'AcceptProjectSuggestionBodySchema'],
  ['POST', /^\/project-suggestions\/[^/]+\/reject$/, 'RejectProjectSuggestionBodySchema'],
  ['PATCH', /^\/deletion-batches\/[^/]+\/items\/[^/]+$/, 'SetDeletionItemBodySchema'],
  ['POST', /^\/deletion-batches\/[^/]+\/approve$/, 'ApproveDeletionBodySchema'],
];

function report(i: SchemaIssue) {
  const s = store(); s.issues.push(i);
  console.warn(`[schema] ${i.kind} ${i.method} ${i.path} ≠ ${i.schema}`, i.issues.slice(0, 8), i.sample);
  s.listeners.forEach((f) => f());
}
const pick = (s: Schemas, ref: Key | ((s: Schemas) => ZodTypeAny)): ZodTypeAny => (typeof ref === 'function' ? ref(s) : (s[ref] as unknown as ZodTypeAny));

async function check(kind: SchemaIssue['kind'], method: string, path: string, name: string, schema: ZodTypeAny, value: unknown) {
  store().checked++;
  const r = schema.safeParse(value);
  if (r.success) return;
  const issues = r.error.issues.map((x) => ({ path: x.path.map(String).join('.'), message: x.message }));
  const first = r.error.issues[0]?.path ?? [];
  let sample: unknown = value;
  for (const k of first.slice(0, -1)) sample = (sample as Record<PropertyKey, unknown> | null)?.[k];
  report({ at: new Date().toISOString(), kind, method, path, schema: name, issues, sample });
}

export async function validateResponse(method: string, path: string, value: unknown) {
  const hit = RESPONSES.find(([m, re]) => m === method && re.test(path));
  if (!hit) return;
  const s = await schemas();
  await check('response', method, path, typeof hit[2] === 'function' ? 'listOf(...)' : hit[2], pick(s, hit[2]), value);
}
export async function validateBody(method: string, path: string, value: unknown) {
  const hit = BODIES.find(([m, re]) => m === method && re.test(path));
  if (!hit) return;
  const s = await schemas();
  await check('request', method, path, hit[2], pick(s, hit[2]), value ?? {});
}
export async function validateError(method: string, path: string, value: unknown) {
  const s = await schemas();
  await check('error', method, path, 'ApiErrorSchema', s.ApiErrorSchema, value);
}
