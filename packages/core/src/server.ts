/** Hono 앱 — 계약서(API_CONTRACT.md)의 MVP 엔드포인트 51개(1.1.0: 새 프로젝트 제안 3개, 1.5.0: 로컬 세션 수집기 4개, 1.7.0: 온톨로지 19개, 1.8.0: MCP 쓰기 4개) + LATER 경로 501 */
import { L } from './util/lang.ts';
import { collectorStatus, estimateCollectorBackfill, putCollectorConfig, startCollectorJob, watcherFor } from './collector/collector.ts';
import { authenticate, clientById, completePairing, extensionPublic, listClients, RateLimiter, requiresToken, revokeClient, rotateToken, scopeAllows, startPairing, type AuthClient } from './ingest/auth.ts';
import { adapterHealth, catchupDiff, ingestReplay, ingestSnapshot, syncState } from './ingest/ingest.ts';
import { mcpEvents, mcpLogTask, mcpUndo, mcpUpdateTaskStatus } from './services/mcp-writes.ts';
import { acceptSuggestion as ontoAccept, bulkAccept, endLink, graphPath, impact, listObjects, listSuggestions, mergeObjectAction, objectDetail, ontologyGraph, patchObject, rejectSuggestion as ontoReject, similar, splitObject, undo as ontoUndo, whyStalled } from './ontology/api.ts';
import { enqueueOntologyExtract, ontologyStatus } from './ontology/job.ts';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { Hono, type Context } from 'hono';
import { ZodError, type z } from 'zod';
import type { ApiError as ApiErrorBody, ClassificationStatus, HealthResponse, LlmProvider, LlmTestResponse, MetaResponse } from '@subbrain/shared';
import * as S from '@subbrain/shared/schemas';
import { API_VERSION, CORE_VERSION, DEFAULT_MODEL, LINK_TYPE_META, MOCK_MODEL, OBJECT_TYPE_META, PROMPT_VERSION, PROJECT_PALETTE, SOURCE_AI_META, STALE_STAGE_LABELS, STATUS_META, STATUS_VISUAL_META } from '@subbrain/shared/constants';
import type { Core } from './core.ts';
import { ApiError, fromZod, notFound, conflict } from './util/errors.ts';
import { decodeCursor, requestId } from './util/ids.ts';
import { startOfDayIso, today } from './util/time.ts';
import { staleStageRanges } from './rules/rules.ts';
import { rowToJob } from './queue/jobs.ts';
import { activity, board, dashboard, filterTasks, getProjectSummary, graph, listProjects, page, projectDetail } from './services/lists.ts';
import { weeklyReview } from './services/weekly.ts';
import { conversationDetail, mergeSuggestionsFor, taskDetail, taskFlow, topicDetail } from './services/views.ts';
import { acceptSuggestion, createProject, mergeTasks, rejectSuggestion, resetOverrides, updateDecision, updateOpenQuestion, updateProject, updateTask } from './services/mutations.ts';
import { loadTasks, recalcAll, sortTasks, toListItem } from './services/tasks.ts';
import { resumePrompt } from './services/resume.ts';
import { search } from './search/search.ts';
import { generateDigest, listDigests, readDigest } from './digest/digest.ts';
import { cleanupEnabled } from './cleanup/cleanup.ts';
import { registerCleanupRoutes } from './cleanup/routes.ts';
import { registerTocRoutes } from './services/toc-routes.ts';
import { cancelImport, createImport, getImport, rowToImport, startImport } from './services/imports.ts';
import { capReached, conversationsForScope, enqueueClassification, todayUsage } from './services/classify.ts';
import { AiSdkClassifier } from './classifier/ai-sdk-classifier.ts';
import { acceptProjectSuggestion, listProjectSuggestions, rejectProjectSuggestion } from './services/project-suggestions.ts';

type Env = { Variables: { rid: string; client: AuthClient | null } };
export const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;

export interface AppOptions { checkHost?: boolean; webDist?: string | null }

export function createApp(core: Core, opts: AppOptions = {}): Hono<Env> {
  const app = new Hono<Env>();
  const checkHost = opts.checkHost ?? true;
  // Host 허용: 코어 자신 + 개발 프록시(Vite changeOrigin:false → Host가 127.0.0.1:5173 등으로 들어옴)
  const allowedHosts = () => {
    const hs = new Set([`127.0.0.1:${core.port}`, `localhost:${core.port}`]);
    for (const o of core.settings.get().server.devOrigins) { try { hs.add(new URL(o).host.toLowerCase()); } catch { /* 잘못된 origin 무시 */ } }
    return hs;
  };
  // 1.9.1 따라잡기로 연 대화 스냅샷(captureMethod extension_catchup)은 토큰당 분당 6개(CatchupDiffResponse.rate.maxFetchPerMinute)
  const catchupLimiter = new RateLimiter(Number(process.env.SUBBRAIN_CATCHUP_FETCH_PER_MIN ?? 6));
  const ingestLimiter = new RateLimiter(Number(process.env.SUBBRAIN_INGEST_RATE_PER_MIN ?? 60));
  const allowedOrigins = () => new Set([`http://127.0.0.1:${core.port}`, `http://localhost:${core.port}`, ...core.settings.get().server.devOrigins]);

  // ───────── 공통: 요청 id · 버전 · Host/Origin 검사 · CORS
  app.use('*', async (c, next) => {
    const rid = requestId();
    c.set('rid', rid);
    const path = c.req.path;
    const isApi = path.startsWith('/api/');
    if (checkHost) {
      const host = (c.req.header('host') ?? new URL(c.req.url).host).toLowerCase();
      if (!allowedHosts().has(host)) return errorResponse(c, new ApiError('FORBIDDEN_ORIGIN', `허용되지 않은 Host예요: ${host}`, { host }));
    }
    const origin = c.req.header('origin');
    // 1.9.0 확장 Origin(chrome-extension://…)은 수집·페어링 경로에서만 CORS 허용 — 실제 허락은 아래 토큰 검사가 정함
    const apiPath = isApi ? path.replace(/^\/api\/v1/, '') : path;
    const extOrigin = !!origin && /^chrome-extension:\/\/[a-z0-9]+$/i.test(origin) && (extensionPublic(apiPath) || requiresToken(c.req.method === 'OPTIONS' ? 'POST' : c.req.method, apiPath) || apiPath === '/session' || apiPath === '/sync-state');
    const originOk = !origin || allowedOrigins().has(origin) || extOrigin;
    if (isApi && origin && originOk) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
      c.header('Access-Control-Expose-Headers', 'X-Request-Id, X-SubBrain-Api-Version');
    }
    if (isApi && c.req.method === 'OPTIONS') {
      if (!originOk) return errorResponse(c, new ApiError('FORBIDDEN_ORIGIN', `허용되지 않은 Origin이에요: ${origin}`, { origin }));
      c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key, Authorization');
      c.header('Access-Control-Max-Age', '600');
      c.header('X-Request-Id', rid);
      c.header('X-SubBrain-Api-Version', API_VERSION);
      return c.body(null, 204);
    }
    if (isApi && !originOk && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(c.req.method)) return errorResponse(c, new ApiError('FORBIDDEN_ORIGIN', `허용되지 않은 Origin이에요: ${origin}`, { origin }));
    // 1.9.0 토큰 인증(§14.3 · §15-39)
    c.set('client', null);
    if (isApi && c.req.method !== 'OPTIONS') {
      const authz = c.req.header('authorization');
      const m = authz ? /^Bearer\s+(\S+)$/i.exec(authz) : null;
      if (authz && !m) return errorResponse(c, new ApiError('UNAUTHORIZED', 'Authorization 헤더는 "Bearer <토큰>" 모양이어야 해요.', { reason: 'invalid' }));
      if (m) {
        let cl: AuthClient;
        try { cl = authenticate(core, m[1]!); } catch (e) { return errorResponse(c, e); }
        // 1.9.1 호스트 권한이 있는 확장은 GET에 Origin을 안 보냄 → 안전한 메서드(GET/HEAD)에서 Origin이 *없으면* 허용(토큰·범위 검사는 그대로). 있는데 다르면 403, 쓰기 메서드는 Origin 필수
        if (cl.kind === 'extension' && !(origin === undefined && ['GET', 'HEAD'].includes(c.req.method)) && origin !== `chrome-extension://${cl.extensionId}`) return errorResponse(c, new ApiError('FORBIDDEN_ORIGIN', '이 토큰은 페어링한 확장 프로그램에서만 쓸 수 있어요.', { origin: origin ?? null, reason: 'origin' }));
        if (!scopeAllows(cl.scopes, c.req.method, apiPath)) return errorResponse(c, new ApiError('FORBIDDEN_ORIGIN', '이 토큰으로는 부를 수 없는 경로예요.', { reason: 'scope', scopes: cl.scopes }));
        if (apiPath.startsWith('/ingest/')) {
          const wait = ingestLimiter.check(cl.tokenId) ?? (apiPath === '/ingest/snapshot' && /"captureMethod"\s*:\s*"extension_catchup"/.test(await c.req.raw.clone().text()) ? catchupLimiter.check(cl.tokenId) : null);
          if (wait !== null) { c.header('Retry-After', String(wait)); return errorResponse(c, new ApiError('RATE_LIMITED', `요청이 너무 많아요. ${wait}초 뒤에 다시 보내 주세요.`, { retryAfterSeconds: wait })); }
        }
        c.set('client', cl);
      } else if (requiresToken(c.req.method, apiPath)) {
        return errorResponse(c, new ApiError('UNAUTHORIZED', '페어링 토큰이 필요해요(Authorization: Bearer …).', { reason: 'missing' }));
      } else if (origin && extOrigin && !extensionPublic(apiPath)) {
        return errorResponse(c, new ApiError('UNAUTHORIZED', '페어링 토큰이 필요해요.', { reason: 'missing' }));
      }
    }
    await next();
    c.res.headers.set('X-Request-Id', rid);
    c.res.headers.set('X-SubBrain-Api-Version', API_VERSION);
  });

  app.onError((err, c) => errorResponse(c, err));

  const api = new Hono<Env>();
  const offset = (cursor?: string) => decodeCursor(cursor);
  const query = <T extends z.ZodTypeAny>(c: Context<Env>, schema: T): z.infer<T> => {
    const r = schema.safeParse(c.req.query());
    if (!r.success) throw fromZod(r.error);
    return r.data;
  };
  const body = async <T extends z.ZodTypeAny>(c: Context<Env>, schema: T): Promise<z.infer<T>> => {
    const text = await c.req.text();
    let raw: unknown = {};
    if (text.trim()) { try { raw = JSON.parse(text); } catch { throw new ApiError('VALIDATION_ERROR', '본문이 올바른 JSON이 아니에요.', { issues: [{ path: '(본문)', message: 'JSON 파싱 실패' }] }); } }
    const r = schema.safeParse(raw);
    if (!r.success) throw fromZod(r.error);
    return r.data;
  };
  const must = <T>(v: T | null | undefined, what: string, id: string, key = 'id'): T => { if (v === null || v === undefined) throw notFound(what, id, key); return v; };
  const later = (phase: string) => (c: Context<Env>) => errorResponse(c, new ApiError('NOT_IMPLEMENTED', `아직 만들지 않은 기능이에요 (Phase ${phase}).`, { phase }));
  const job202 = (c: Context<Env>, id: string) => c.json(core.queue.get(id), 202);
  const ensureTask = (id: string) => { if (!core.db.get('SELECT 1 FROM tasks WHERE id=?', id)) throw notFound('과제', id, 'taskId'); };

  // ───────── 5. 기본
  api.get('/health', (c) => {
    const s = core.settings.get();
    const dbPath = core.db.path;
    let size = 0;
    for (const p of [dbPath, `${dbPath}-wal`]) { try { size += statSync(p).size; } catch { /* 없음 */ } }
    const res: HealthResponse = {
      status: core.queue.paused ? 'degraded' : 'ok', apiVersion: API_VERSION, coreVersion: CORE_VERSION, node: process.version, buildTarget: core.buildTarget,
      startedAt: core.startedAt, uptimeSec: Math.round((Date.now() - core.startedMs) / 1000),
      db: { path: dbPath, journalMode: 'wal', schemaVersion: core.db.schemaVersion, sqliteVersion: String(core.db.value('SELECT sqlite_version()')), fts5: true, trigram: true, bigramIndex: false, sizeBytes: size },
      vault: { path: s.vault.path, lastGeneratedAt: core.vault.lastGeneratedAt(), conflictCount: core.vault.conflictCount() },
      workers: { queueDepth: core.queue.depth, running: core.queue.running, paused: core.queue.paused, pausedReason: core.queue.paused ? '일시 정지됨' : null },
      llm: { provider: s.llm.provider, model: s.llm.provider ? (s.llm.model ?? DEFAULT_MODEL[s.llm.provider]) : null, configured: core.llmConfigured() },
    };
    return c.json(res);
  });
  api.get('/meta', (c) => {
    query(c, S.EmptyQuerySchema);
    const t = core.settings.get().thresholds;
    const res: MetaResponse = {
      statuses: STATUS_META, statusVisuals: STATUS_VISUAL_META,
      staleStages: staleStageRanges(t).map((r) => ({ key: r.key, labelKo: STALE_STAGE_LABELS[r.key].labelKo, emoji: STALE_STAGE_LABELS[r.key].emoji, minDays: r.minDays, maxDays: r.maxDays })),
      sourceAis: SOURCE_AI_META, projectPalette: [...PROJECT_PALETTE], objectTypes: OBJECT_TYPE_META, linkTypes: LINK_TYPE_META, thresholds: t,
    };
    return c.json(res);
  });
  api.get('/dashboard', (c) => { query(c, S.EmptyQuerySchema); return c.json(dashboard(core)); });

  // ───────── 6. 그래프 · 활동
  api.get('/graph', (c) => {
    const q = query(c, S.GraphQuerySchema);
    if (q.mode === 'ontology') throw new ApiError('NOT_IMPLEMENTED', '관계(온톨로지) 모드 데이터는 GET /api/v1/ontology 에서 받아요(1.7.0).', { phase: '1.5', use: '/api/v1/ontology' });
    if (q.at && q.at !== today()) throw new ApiError('NOT_IMPLEMENTED', '시점 되감기는 Phase 2에 만들어요.', { phase: '2' });
    return c.json(graph(core, q));
  });
  api.get('/activity', (c) => c.json(activity(core, query(c, S.ActivityQuerySchema))));

  // ───────── 7. 프로젝트 · 주제
  api.get('/projects', (c) => { const q = query(c, S.ProjectsQuerySchema); return c.json(listProjects(core, { status: q.status, limit: q.limit, offset: offset(q.cursor) })); });
  api.get('/projects/:projectId', (c) => { const id = c.req.param('projectId'); const q = query(c, S.ProjectDetailQuerySchema); return c.json(must(projectDetail(core, id, q.weeks ?? 16), '프로젝트', id, 'projectId')); });
  api.post('/projects', async (c) => { const b = await body(c, S.CreateProjectBodySchema); const id = createProject(core, b); return c.json(getProjectSummary(core, id), 201); });
  api.patch('/projects/:projectId', async (c) => {
    const id = c.req.param('projectId');
    const b = await body(c, S.UpdateProjectBodySchema);
    must(getProjectSummary(core, id), '프로젝트', id, 'projectId');
    updateProject(core, id, b);
    return c.json(getProjectSummary(core, id));
  });
  api.get('/topics/:topicId', (c) => { const id = c.req.param('topicId'); query(c, S.EmptyQuerySchema); return c.json(must(topicDetail(core, id), '주제', id, 'topicId')); });

  // ───────── 8. 과제 · 보드 · 대화
  api.get('/tasks', (c) => {
    const q = query(c, S.TaskListQuerySchema);
    const { sort, limit, cursor, ...f } = q;
    let list = filterTasks(core, loadTasks(core), f);
    if (!f.status?.length) list = list.filter((t) => t.status !== '보관');
    return c.json(page(sortTasks(list, sort ?? 'last_activity_desc').map(toListItem), offset(cursor), limit ?? 50));
  });
  api.get('/review/weekly', (c) => { const q = query(c, S.WeeklyReviewQuerySchema); return c.json(weeklyReview(core, q.date)); });
  api.get('/board', (c) => c.json(board(core, query(c, S.BoardQuerySchema))));
  api.get('/tasks/:taskId', (c) => { const id = c.req.param('taskId'); query(c, S.EmptyQuerySchema); return c.json(must(taskDetail(core, id), '과제', id, 'taskId')); });
  api.get('/tasks/:taskId/flow', (c) => { const id = c.req.param('taskId'); const q = query(c, S.FlowQuerySchema); return c.json(must(taskFlow(core, id, { filter: q.filter, limit: q.limit, offset: offset(q.cursor) }), '과제', id, 'taskId')); });
  api.patch('/tasks/:taskId', async (c) => {
    const id = c.req.param('taskId');
    const b = await body(c, S.UpdateTaskBodySchema);
    ensureTask(id);
    const event = updateTask(core, id, b);
    return c.json({ task: taskDetail(core, id), event });
  });
  api.post('/tasks/:taskId/overrides/reset', async (c) => { const id = c.req.param('taskId'); const b = await body(c, S.ResetOverridesBodySchema); ensureTask(id); resetOverrides(core, id, b); return c.json(taskDetail(core, id)); });
  api.patch('/tasks/:taskId/open-questions/:questionId', async (c) => { const id = c.req.param('taskId'); const b = await body(c, S.UpdateOpenQuestionBodySchema); ensureTask(id); return c.json(updateOpenQuestion(core, id, c.req.param('questionId'), b)); });
  api.patch('/tasks/:taskId/decisions/:decisionId', async (c) => { const id = c.req.param('taskId'); const b = await body(c, S.UpdateDecisionBodySchema); ensureTask(id); return c.json(updateDecision(core, id, c.req.param('decisionId'), b)); });
  api.get('/tasks/:taskId/resume-prompt', (c) => { const id = c.req.param('taskId'); const q = query(c, S.ResumePromptQuerySchema); return c.json(must(resumePrompt(core, id, q.targetAi), '과제', id, 'taskId')); });
  api.post('/tasks/:taskId/merge', async (c) => {
    const id = c.req.param('taskId');
    const b = await body(c, S.MergeTasksBodySchema);
    ensureTask(id);
    const event = mergeTasks(core, id, b.sourceTaskIds, b.title);
    return c.json({ task: taskDetail(core, id), mergedTaskIds: b.sourceTaskIds, event });
  });
  api.post('/tasks/:taskId/reclassify', async (c) => {
    const id = c.req.param('taskId');
    await body(c, S.EmptyQuerySchema);
    ensureTask(id);
    if (capReached(core)) throw new ApiError('COST_CAP_REACHED', '오늘 LLM 비용 상한에 도달했어요. 내일 다시 시도하거나 설정에서 상한을 올려 주세요.', { dailyCapUsd: core.settings.get().llm.dailyCostCapUsd });
    const convs = core.db.all<{ conversation_id: string }>("SELECT conversation_id FROM task_conversations WHERE task_id=? AND role='primary'", id).map((r) => r.conversation_id);
    return job202(c, enqueueClassification(core, convs, `다시 분류 · ${id}`, id, { refreshCache: true })); // 1.2.0 직접 다시 분류는 캐시를 건너뜀
  });
  api.get('/conversations/:conversationId', (c) => {
    const id = c.req.param('conversationId');
    const q = query(c, S.ConversationQuerySchema);
    if (q.around !== undefined) { // 1.10.0 ?around=<messageId>&window=N
      const seq = core.db.value('SELECT seq FROM messages WHERE id=? AND conversation_id=?', q.around, id);
      if (seq === undefined || seq === null) throw new ApiError('NOT_FOUND', `이 대화에 메시지 ${q.around}가 없어요.`, { conversationId: id, messageId: q.around });
      const w = q.window ?? 3;
      return c.json(must(conversationDetail(core, id, { limit: 2 * w + 1, offset: 0, aroundSeq: Number(seq) }), '대화', id, 'conversationId'));
    }
    return c.json(must(conversationDetail(core, id, { limit: q.limit, offset: offset(q.cursor), aroundSeq: q.aroundSeq }), '대화', id, 'conversationId'));
  });

  // ───────── 9. 합치기 제안
  api.get('/merge-suggestions', (c) => {
    const q = query(c, S.MergeSuggestionsQuerySchema);
    return c.json(page(mergeSuggestionsFor(core, { state: q.state ?? 'pending', taskId: q.taskId, minConfidence: q.minConfidence }), offset(q.cursor), q.limit ?? 50));
  });
  api.post('/merge-suggestions/:suggestionId/accept', async (c) => {
    const b = await body(c, S.AcceptMergeBodySchema);
    return idem(c, () => { const r = acceptSuggestion(core, c.req.param('suggestionId'), b); return { suggestion: r.suggestion, task: taskDetail(core, r.taskId) }; });
  });
  api.post('/merge-suggestions/:suggestionId/reject', async (c) => {
    const b = await body(c, S.RejectMergeBodySchema);
    return idem(c, () => { const sug = rejectSuggestion(core, c.req.param('suggestionId'), b.reason); return { suggestion: sug, task: taskDetail(core, sug.suggestedPrimaryTaskId) }; });
  });

  // ───────── 9-2. 새 프로젝트 제안 (1.1.0, §7.7)
  api.get('/project-suggestions', (c) => {
    const q = query(c, S.ProjectSuggestionsQuerySchema);
    return c.json(page(listProjectSuggestions(core, { state: q.state, ready: q.ready }), offset(q.cursor), q.limit ?? 50));
  });
  api.post('/project-suggestions/:suggestionId/accept', async (c) => {
    const b = await body(c, S.AcceptProjectSuggestionBodySchema);
    return idem(c, () => {
      const r = acceptProjectSuggestion(core, c.req.param('suggestionId'), b);
      return { suggestion: r.suggestion, project: getProjectSummary(core, r.projectId)!, attachedTaskIds: r.attachedTaskIds };
    });
  });
  api.post('/project-suggestions/:suggestionId/reject', async (c) => {
    const b = await body(c, S.RejectProjectSuggestionBodySchema);
    return idem(c, () => ({ suggestion: rejectProjectSuggestion(core, c.req.param('suggestionId'), b.reason) }));
  });

  // ───────── 10. 오늘의 요약
  api.get('/digests', (c) => { const q = query(c, S.DigestsQuerySchema); return c.json(page(listDigests(core), offset(q.cursor), q.limit ?? 30)); });
  const resolveDate = (d: string) => (d === 'today' ? today() : d === 'latest' ? (core.db.value<string>('SELECT MAX(date) FROM digests') ?? today()) : d);
  const checkDate = (d: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new ApiError('VALIDATION_ERROR', '날짜는 YYYY-MM-DD, today, latest 중 하나예요.', { issues: [{ path: 'date', message: '형식 오류' }] }); };
  api.get('/digests/:date', (c) => {
    const d = resolveDate(c.req.param('date'));
    checkDate(d);
    query(c, S.EmptyQuerySchema);
    return c.json(must(readDigest(core, d), '요약', d, 'date'));
  });
  api.post('/digests/:date/regenerate', async (c) => {
    const d = resolveDate(c.req.param('date'));
    checkDate(d);
    await body(c, S.EmptyQuerySchema);
    if (d !== today()) throw conflict('오늘 요약만 다시 만들 수 있어요.', { date: d, today: today() });
    const id = core.queue.create('digest', `오늘의 요약 · ${d}`, { total: 1 });
    core.queue.enqueue(id, async (ctl) => { generateDigest(core, d); ctl.progress(1, 1); });
    return job202(c, id);
  });

  // ───────── 11. 검색
  api.get('/search', (c) => { const q = query(c, S.SearchQuerySchema); const { cursor, limit, ...rest } = q; return c.json(search(core, { ...rest, limit: limit ?? 20, offset: offset(cursor) })); });

  // ───────── 12. 가져오기 · 작업 · 분류
  api.post('/imports', async (c) => {
    const q = query(c, S.ImportsQuerySchema);
    const len = Number(c.req.header('content-length') ?? 0);
    if (len > MAX_UPLOAD_BYTES) throw new ApiError('PAYLOAD_TOO_LARGE', '파일이 너무 커요 (최대 2 GB).', { maxBytes: MAX_UPLOAD_BYTES });
    const ct = c.req.header('content-type') ?? '';
    let bytes: Uint8Array, fileName: string, sourceAi: 'chatgpt' | 'claude' | 'gemini' | 'grokbot' | undefined, gap: number | undefined;
    if (ct.includes('application/json')) {
      const b = await body(c, S.ImportFromPathBodySchema);
      const p = resolve(b.path);
      if (!existsSync(p)) throw notFound('파일', b.path, 'path');
      bytes = new Uint8Array(readFileSync(p)); fileName = p; sourceAi = b.sourceAi; gap = b.geminiSessionGapMinutes;
    } else if (ct.includes('multipart/form-data')) {
      const form = await c.req.parseBody();
      const f = form.file;
      if (!(f instanceof File)) throw new ApiError('VALIDATION_ERROR', '업로드할 파일(file)이 필요해요.', { issues: [{ path: 'file', message: '필수 값이에요' }] });
      if (f.size > MAX_UPLOAD_BYTES) throw new ApiError('PAYLOAD_TOO_LARGE', '파일이 너무 커요 (최대 2 GB).', { maxBytes: MAX_UPLOAD_BYTES });
      const sa = typeof form.sourceAi === 'string' && form.sourceAi ? form.sourceAi : undefined;
      if (sa && sa !== 'chatgpt' && sa !== 'claude' && sa !== 'gemini' && sa !== 'grokbot') throw new ApiError('UNSUPPORTED_FILE', `아직 지원하지 않는 서비스예요: ${sa} (Grok은 아직)`, { sourceAi: sa });
      // 1.2.0 Gemini Takeout: 대화로 묶을 시간 간격(분). 폼 필드 geminiSessionGapMinutes
      const g = typeof form.geminiSessionGapMinutes === 'string' && form.geminiSessionGapMinutes ? Number(form.geminiSessionGapMinutes) : undefined;
      if (g !== undefined && !(Number.isInteger(g) && g >= 1 && g <= 1440)) throw new ApiError('VALIDATION_ERROR', 'geminiSessionGapMinutes는 1~1440 사이 정수예요.', { issues: [{ path: 'geminiSessionGapMinutes', message: String(form.geminiSessionGapMinutes) }] });
      gap = g;
      bytes = new Uint8Array(await f.arrayBuffer()); fileName = f.name || 'upload'; sourceAi = sa as typeof sourceAi;
    } else throw new ApiError('VALIDATION_ERROR', 'multipart/form-data 또는 application/json {path} 로 보내 주세요.', { issues: [{ path: 'content-type', message: ct || '없음' }] });
    if (!looksSupported(bytes)) throw new ApiError('UNSUPPORTED_FILE', 'ZIP·JSON 내보내기 파일이나 Gemini Takeout HTML(MyActivity.html)만 가져올 수 있어요.', { fileName });
    return idem(c, () => {
      const imp = createImport(core, { bytes, fileName, sourceAi, force: q.force, geminiSessionGapMinutes: gap });
      c.header('Location', `/api/v1/imports/${imp.id}`);
      return imp;
    }, 202);
  });
  api.get('/imports', (c) => {
    const q = query(c, S.ImportsQuerySchema);
    const all = core.db.all('SELECT * FROM import_batches ORDER BY created_at DESC').map(rowToImport);
    return c.json(page(all, offset(q.cursor), q.limit ?? 20));
  });
  api.get('/imports/:importId', (c) => { const id = c.req.param('importId'); return c.json(must(getImport(core, id), '가져오기', id, 'importId')); });
  api.post('/imports/:importId/start', async (c) => { const b = await body(c, S.StartImportBodySchema); return c.json(startImport(core, c.req.param('importId'), b), 202); });
  api.post('/imports/:importId/cancel', async (c) => { await body(c, S.EmptyQuerySchema); return c.json(cancelImport(core, c.req.param('importId'))); });
  api.get('/jobs', (c) => {
    const q = query(c, S.JobsQuerySchema);
    const conds: string[] = [], params: string[] = [];
    if (q.type?.length) { conds.push(`type IN (${q.type.map(() => '?').join(',')})`); params.push(...q.type); }
    if (q.state?.length) { conds.push(`state IN (${q.state.map(() => '?').join(',')})`); params.push(...q.state); }
    if (q.parentId) { conds.push('parent_id=?'); params.push(q.parentId); }
    const rows = core.db.all(`SELECT * FROM jobs ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''} ORDER BY created_at DESC, rowid DESC`, ...params).map(rowToJob);
    return c.json(page(rows, offset(q.cursor), q.limit ?? 50));
  });
  api.get('/jobs/:jobId', (c) => { const id = c.req.param('jobId'); return c.json(must(core.queue.get(id), '작업', id, 'jobId')); });
  api.get('/classification/status', (c) => {
    const s = core.settings.get();
    const db = core.db;
    const tasksNow = loadTasks(core);
    const res: ClassificationStatus = {
      queue: {
        pending: Number(db.value('SELECT COUNT(*) FROM conversations WHERE classified_hash IS NULL OR classified_hash<>content_hash') ?? 0),
        running: Number(db.value("SELECT COUNT(*) FROM jobs WHERE type='classify' AND state='running'") ?? 0),
        deferred: Number(db.value("SELECT COUNT(*) FROM jobs WHERE type='classify' AND state='deferred'") ?? 0),
        failedToday: Number(db.value("SELECT COUNT(*) FROM jobs WHERE type='classify' AND state='failed' AND created_at >= ?", startOfDayIso(today())) ?? 0),
      },
      today: todayUsage(core), dailyCapUsd: s.llm.dailyCostCapUsd, capReached: capReached(core),
      model: core.llmConfigured() && s.llm.provider ? (s.llm.model ?? DEFAULT_MODEL[s.llm.provider]) : MOCK_MODEL,
      promptVersion: PROMPT_VERSION,
      needsReviewCount: tasksNow.filter((t) => t.needsReview).length,
      blockedCount: tasksNow.filter((t) => t.classificationState === 'blocked' && t.status !== '보관').length,
      lastRunAt: db.value<string>('SELECT MAX(created_at) FROM classifications'),
    };
    return c.json(res);
  });
  api.post('/classification/run', async (c) => {
    const b = await body(c, S.RunClassificationBodySchema);
    if (capReached(core)) throw new ApiError('COST_CAP_REACHED', '오늘 LLM 비용 상한에 도달했어요. 내일 다시 시도하거나 설정에서 상한을 올려 주세요.', { dailyCapUsd: core.settings.get().llm.dailyCostCapUsd });
    if (b.scope === 'project' && b.projectId && !core.db.get('SELECT 1 FROM projects WHERE id=?', b.projectId)) throw notFound('프로젝트', b.projectId, 'projectId');
    const convs = conversationsForScope(core, b.scope, b);
    return job202(c, enqueueClassification(core, convs, `분류 · ${b.scope} (${convs.length}건)`, null, { refreshCache: b.refreshCache === true }));
  });

  // ───────── 13. 설정 · 볼트
  api.get('/settings', (c) => c.json(core.settings.get()));
  api.patch('/settings', async (c) => {
    const b = await body(c, S.UpdateSettingsBodySchema);
    const before = core.llmStatusLine();
    const r = core.settings.patch(b);
    const after = core.llmStatusLine();
    if (before !== after) console.log(`[subbrain] 설정 변경 → ${after}`);
    if (r.thresholdsChanged) recalcAll(core);
    if (r.vaultPathChanged) enqueueVault(core);
    return c.json(r.settings);
  });
  api.put('/settings/llm-key', async (c) => {
    const b = await body(c, S.PutLlmKeyBodySchema);
    const before = core.llmStatusLine();
    core.settings.setApiKey(b.provider, b.apiKey);
    const after = core.llmStatusLine();
    if (before !== after) console.log(`[subbrain] API 키 저장 → ${after}`); // 키 값은 찍지 않는다
    return c.body(null, 204);
  });
  api.post('/settings/llm-test', async (c) => {
    const b = await body(c, S.LlmTestBodySchema);
    const s = core.settings.get().llm;
    const provider: LlmProvider | null = b.provider ?? s.provider;
    if (!provider) throw new ApiError('VALIDATION_ERROR', '먼저 LLM 제공자를 골라 주세요.', { issues: [{ path: 'provider', message: '필수 값이에요' }] });
    const model = b.model ?? (provider === s.provider ? s.model : null) ?? DEFAULT_MODEL[provider];
    const key = core.settings.getApiKey(provider);
    if (!key) return c.json({ ok: false, provider, model, latencyMs: null, message: 'API 키가 없어요. 키를 넣기 전까지는 규칙 분류기로 분류해요.' } satisfies LlmTestResponse);
    const cls = new AiSdkClassifier({ provider, model, apiKey: key, baseUrl: s.baseUrl });
    const t0 = Date.now();
    try {
      const r = await cls.classify(testInput());
      return c.json({ ok: true, provider, model, latencyMs: Date.now() - t0, message: `연결됐어요. 시험 분류 1건 성공${r.costUsd !== null ? ` (약 $${r.costUsd.toFixed(4)})` : ''}.` } satisfies LlmTestResponse);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const hint = /\b404\b|not found|NOT_FOUND|is not supported|does not exist/i.test(msg) ? ` — 모델 이름(${model})을 확인해 주세요. 기본값: ${DEFAULT_MODEL[provider]}` : '';
      return c.json({ ok: false, provider, model, latencyMs: Date.now() - t0, message: `연결에 실패했어요: ${msg.slice(0, 200)}${hint}` } satisfies LlmTestResponse);
    }
  });
  api.post('/vault/regenerate', async (c) => { await body(c, S.EmptyQuerySchema); return job202(c, enqueueVault(core)); });
  api.get('/vault/conflicts', (c) => {
    const q = query(c, S.DigestsQuerySchema);
    const rows = core.db.all<{ path: string; entity_type: string; entity_id: string; detected_at: string; backup_path: string }>('SELECT * FROM vault_conflicts ORDER BY detected_at DESC')
      .map((r) => ({ path: r.path, entityType: r.entity_type as 'task', entityId: r.entity_id, detectedAt: r.detected_at, backupPath: r.backup_path }));
    return c.json(page(rows, offset(q.cursor), q.limit ?? 50));
  });

  // ───────── 1.9.0 페어링 · 확장 수집(§14.3)
  const webOnly = (c: Context<Env>) => { if (c.get('client')) throw new ApiError('FORBIDDEN_ORIGIN', '웹앱에서만 할 수 있어요.', { reason: 'scope' }); };
  api.post('/pairing', async (c) => { webOnly(c); if (c.req.header('origin')?.startsWith('chrome-extension://')) throw new ApiError('FORBIDDEN_ORIGIN', '페어링 시작은 웹앱에서만 해요.', { reason: 'origin' }); return c.json(startPairing(core, await body(c, S.StartPairingBodySchema)), 201); });
  api.post('/pairing/complete', async (c) => c.json(completePairing(core, await body(c, S.CompletePairingBodySchema), c.req.header('origin')), 201));
  api.get('/pairing/clients', (c) => { webOnly(c); return c.json(listClients(core)); });
  api.post('/pairing/clients/:tokenId/rotate', async (c) => { await body(c, S.EmptyQuerySchema); return c.json(rotateToken(core, c.req.param('tokenId'), c.get('client')!)); });
  api.post('/pairing/clients/:tokenId/revoke', async (c) => { webOnly(c); await body(c, S.EmptyQuerySchema); return c.json(revokeClient(core, c.req.param('tokenId'))); });
  api.get('/session', (c) => { const cl = c.get('client'); return c.json(cl ? { kind: cl.kind, client: clientById(core, cl.tokenId), scopes: cl.scopes } : { kind: 'web', client: null, scopes: ['ingest', 'read', 'mcp_write'] }); });
  const tooBig = (c: Context<Env>, max: number) => { const n = Number(c.req.header('content-length') ?? 0); if (n > max) throw new ApiError('PAYLOAD_TOO_LARGE', `본문이 너무 커요(최대 ${Math.round(max / 1024 / 1024)}MB).`, { maxBytes: max }); };
  api.post('/ingest/snapshot', async (c) => {
    tooBig(c, 5 * 1024 * 1024);
    const r = ingestSnapshot(core, await body(c, S.IngestSnapshotBodySchema), { idempotencyKey: c.req.header('idempotency-key') ?? null, tokenId: c.get('client')?.tokenId ?? null });
    return c.json(r.body, r.status);
  });
  api.post('/ingest/replay', async (c) => { tooBig(c, 20 * 1024 * 1024); return c.json(ingestReplay(core, await body(c, S.IngestReplayBodySchema), c.get('client')?.tokenId ?? null)); });
  api.post('/ingest/catchup/diff', async (c) => c.json(catchupDiff(core, await body(c, S.CatchupDiffBodySchema))));
  api.get('/sync-state', (c) => c.json(syncState(core)));
  api.post('/sync-state/:ai/health', async (c) => c.json(adapterHealth(core, c.req.param('ai'), await body(c, S.AdapterHealthBodySchema))));

  // ───────── 1.8.0 MCP 쓰기 경로(MCP 서버만 부름 — 삭제 없음, 모두 되돌리기 가능)
  api.post('/mcp/log-task', async (c) => c.json(mcpLogTask(core, await body(c, S.McpLogTaskBodySchema), c.get('client')?.tokenId ?? null), 201));
  api.post('/mcp/update-task-status', async (c) => c.json(mcpUpdateTaskStatus(core, await body(c, S.McpUpdateTaskStatusBodySchema), c.get('client')?.tokenId ?? null)));
  api.get('/mcp/events', (c) => { const q = query(c, S.McpEventsQuerySchema); return c.json(mcpEvents(core, q.limit)); });
  api.post('/mcp/events/:eventId/undo', async (c) => { await body(c, S.EmptyQuerySchema); return c.json(mcpUndo(core, Number(c.req.param('eventId')))); });

  // ───────── 14.2 온톨로지 (1.7.0 구현)
  api.get('/ontology', (c) => c.json(ontologyGraph(core, query(c, S.OntologyQuerySchema))));
  api.get('/ontology/status', (c) => { query(c, S.EmptyQuerySchema); return c.json(ontologyStatus(core)); });
  api.post('/ontology/extract', async (c) => { const b = await body(c, S.OntologyExtractBodySchema); return job202(c, enqueueOntologyExtract(core, b)); });
  api.post('/ontology/events/:eventId/undo', async (c) => { await body(c, S.EmptyQuerySchema); return c.json(ontoUndo(core, Number(c.req.param('eventId')))); });
  api.get('/suggestions', (c) => c.json(listSuggestions(core, query(c, S.ListSuggestionsQuerySchema))));
  api.post('/suggestions/bulk-accept', async (c) => c.json(bulkAccept(core, await body(c, S.BulkAcceptSuggestionsBodySchema))));
  api.post('/suggestions/:id/accept', async (c) => { await body(c, S.EmptyQuerySchema); return c.json(ontoAccept(core, c.req.param('id'))); });
  api.post('/suggestions/:id/reject', async (c) => { const b = await body(c, S.RejectSuggestionBodySchema); return c.json(ontoReject(core, c.req.param('id'), b.reason)); });
  api.get('/objects', (c) => c.json(listObjects(core, query(c, S.ListObjectsQuerySchema))));
  api.get('/objects/:id', (c) => { query(c, S.EmptyQuerySchema); return c.json(objectDetail(core, c.req.param('id'))); });
  api.patch('/objects/:id', async (c) => c.json(patchObject(core, c.req.param('id'), await body(c, S.PatchObjectBodySchema))));
  api.post('/objects/:id/merge', async (c) => { const b = await body(c, S.MergeObjectBodySchema); return c.json(mergeObjectAction(core, c.req.param('id'), b.intoId)); });
  api.post('/objects/:id/split', async (c) => c.json(splitObject(core, c.req.param('id'), await body(c, S.SplitObjectBodySchema)), 201));
  api.get('/objects/:id/impact', (c) => { query(c, S.EmptyQuerySchema); return c.json(impact(core, c.req.param('id'))); });
  api.post('/links/:id/end', async (c) => c.json(endLink(core, c.req.param('id'), await body(c, S.EndLinkBodySchema))));
  api.get('/tasks/:id/why-stalled', (c) => { query(c, S.EmptyQuerySchema); return c.json(whyStalled(core, c.req.param('id'))); });
  api.get('/similar', (c) => { const q = query(c, S.SimilarQuerySchema); return c.json(similar(core, q.text, q.limit)); });
  api.get('/graph/path', (c) => { const q = query(c, S.GraphPathQuerySchema); return c.json(graphPath(core, q.from, q.to, q.maxDepth)); });

  // ───────── 12.10 로컬 세션 수집기 (1.5.0)
  api.get('/collector', (c) => { query(c, S.EmptyQuerySchema); return c.json(collectorStatus(core, watcherFor(core).watching)); });
  api.put('/collector/config', async (c) => {
    const b = await body(c, S.PutCollectorConfigBodySchema);
    putCollectorConfig(core, b);
    watcherFor(core).sync();
    return c.json(collectorStatus(core, watcherFor(core).watching));
  });
  api.post('/collector/backfill', async (c) => { const b = await body(c, S.CollectorRunBodySchema); if (b.dryRun) return c.json(estimateCollectorBackfill(core, b)); return job202(c, startCollectorJob(core, 'backfill', b)); });
  api.post('/collector/scan', async (c) => { const b = await body(c, S.CollectorRunBodySchema); return job202(c, startCollectorJob(core, 'scan', b)); });

  // ───────── 14-a. 채팅창 정리 미리보기 (웹 담당 모듈 src/cleanup — SUBBRAIN_CLEANUP=preview 일 때만, 아래 501보다 먼저 등록)
  if (cleanupEnabled()) registerCleanupRoutes(api, core, body);

  // ───────── 12.11 목차(TOC) — 단계별로 내려가며 읽기(LLM 호출 없음)
  registerTocRoutes(api, core);

  // ───────── 14. LATER — 501
  for (const [m, p, phase] of LATER_ROUTES) api.on(m, p, later(phase));
  api.all('*', (c) => errorResponse(c, new ApiError('NOT_FOUND', L(`없는 API 경로예요: ${c.req.method} ${c.req.path}`, `Unknown API route: ${c.req.method} ${c.req.path}`), { path: c.req.path })));

  app.route('/api/v1', api);
  app.all('/api/*', (c) => errorResponse(c, new ApiError('NOT_FOUND', L(`없는 API 경로예요: ${c.req.path} (/api/v1 을 쓰세요)`, `Unknown API route: ${c.req.path} (use /api/v1)`), { path: c.req.path })));

  // 웹 정적 파일(배포 시 같은 origin, §1.1) — web/dist가 있을 때만
  const dist = opts.webDist;
  if (dist && existsSync(dist)) {
    app.get('*', (c) => {
      const rel = decodeURIComponent(c.req.path).replace(/^\/+/, '');
      let file = resolve(dist, rel);
      if (!file.startsWith(resolve(dist)) || !existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
      return new Response(readFileSync(file), { headers: { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' } });
    });
  }
  return app;

  function idem<T>(c: Context<Env>, fn: () => T, status: 200 | 202 = 200) {
    const key = c.req.header('idempotency-key');
    const cacheKey = key ? `${c.req.method} ${c.req.path} ${key}` : null;
    if (cacheKey && idemCache.has(cacheKey)) { const hit = idemCache.get(cacheKey)!; return c.json(hit.body as object, hit.status as 200); }
    const res = fn();
    if (cacheKey) { idemCache.set(cacheKey, { status, body: res }); if (idemCache.size > 500) idemCache.delete(idemCache.keys().next().value!); }
    return c.json(res as object, status);
  }
}

const idemCache = new Map<string, { status: number; body: unknown }>();

export function enqueueVault(core: Core): string {
  const id = core.queue.create('vault_regenerate', '볼트 다시 만들기');
  core.queue.enqueue(id, async (ctl) => { await core.vault.regenerateAll(ctl); });
  return id;
}

function looksSupported(b: Uint8Array): boolean {
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b) return true; // ZIP
  for (let i = 0; i < Math.min(b.length, 64); i++) { const ch = b[i]!; if (ch === 0x5b || ch === 0x7b || ch === 0x3c) return true; /* [ { < (1.2.0 HTML) */ if (ch > 0x20 && ch !== 0xef && ch !== 0xbb && ch !== 0xbf) return false; }
  return false;
}

function testInput() {
  const messages = [{ role: 'user' as const, content: '파이썬에서 리스트 중복 제거하는 법?' }, { role: 'assistant' as const, content: 'list(dict.fromkeys(xs))를 쓰면 순서를 지키며 중복을 없앨 수 있어요.' }];
  return { sourceAi: 'chatgpt', title: '연결 시험', createdAt: '2026-01-01T00:00:00+09:00', updatedAt: '2026-01-01T00:01:00+09:00', messages, previousSummary: null, projects: [], recentTasks: [], today: today(),
    condensed: messages.map((m) => `[${m.role}] ${m.content}`).join('\n') };
}

export function errorResponse(c: Context, err: unknown): Response {
  let e: ApiError;
  if (err instanceof ApiError) e = err;
  else if (err instanceof ZodError) e = fromZod(err);
  else if (err instanceof Error && /database is locked|SQLITE_BUSY/i.test(err.message)) e = new ApiError('DB_BUSY', '데이터베이스가 잠시 바빠요. 잠깐 뒤에 다시 시도해 주세요.');
  else if (err instanceof Error && (err as { status?: number }).status === 413) e = new ApiError('PAYLOAD_TOO_LARGE', '파일이 너무 커요 (최대 2 GB).');
  else {
    if (process.env.NODE_ENV !== 'test' || process.env.SUBBRAIN_DEBUG) console.error('[subbrain] 내부 오류', err);
    e = new ApiError('INTERNAL', '코어에서 예상하지 못한 오류가 났어요.', { reason: err instanceof Error ? err.message.slice(0, 300) : String(err) });
  }
  const rid = (c.get('rid' as never) as string | undefined) ?? requestId();
  const payload: ApiErrorBody = { error: { code: e.code, message: e.message, details: e.details ?? {}, requestId: rid } };
  return new Response(JSON.stringify(payload), { status: e.status, headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Request-Id': rid, 'X-SubBrain-Api-Version': API_VERSION, ...(c.res.headers.get('Access-Control-Allow-Origin') ? { 'Access-Control-Allow-Origin': c.res.headers.get('Access-Control-Allow-Origin')!, Vary: 'Origin' } : {}) } });
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

type M = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export const LATER_ROUTES: Array<[M, string, string]> = [
  ['GET', '/timeline', '2'], ['GET', '/events', '2'], ['GET', '/stream', '2'],
  ['GET', '/wiki', '5'], ['GET', '/wiki/:id', '5'], ['PATCH', '/wiki/:id', '5'],
  ['GET', '/deletion-batches/:id', '6'], ['POST', '/deletion-batches/:id/approve', '6'], ['POST', '/deletion-batches/:id/postpone', '6'], ['PATCH', '/deletion-batches/:id/items/:itemId', '6'], ['POST', '/archive/undo', '6'],
  ['DELETE', '/tasks/:id', 'LATER'], ['DELETE', '/conversations/:id', 'LATER'], ['DELETE', '/projects/:id', 'LATER'], ['DELETE', '/objects/:id', 'LATER'], ['DELETE', '/settings/llm-key', 'LATER'],
];
