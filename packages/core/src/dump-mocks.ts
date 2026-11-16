/**
 * 공유 목(mock) JSON 생성기 — 엔진이 목 데이터의 유일한 출처.
 * 임시 홈에 예시 데이터를 넣고(오늘 = 2026-09-30 08:30 KST 고정) 실제 라우트 응답을 캡처해 zod로 검사한 뒤
 * packages/shared/mocks/json/<이름>.json 과 mocks/json/demo/*.json(모든 과제·프로젝트·주제·대화의 상세)을 쓴다.
 * 실행: `pnpm --filter @subbrain/core mocks` (또는 `pnpm contract`가 자동 실행)
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { z } from 'zod';
import * as S from '@subbrain/shared/schemas';
import { Core } from './core.ts';
import { createApp } from './server.ts';
import { seed } from './seed.ts';
import { getFixedNow, setNow } from './util/time.ts';

export const MOCK_NOW = '2026-09-30T08:30:00+09:00';

export async function dumpMocks(outDir: string): Promise<{ files: number; demo: Record<string, number> }> {
  process.env.SUBBRAIN_UTC_OFFSET ??= '+09:00'; // the shared mocks are written in +09:00
  const prevNow = getFixedNow();
  setNow(MOCK_NOW);
  const home = mkdtempSync(join(tmpdir(), 'subbrain-mocks-'));
  const core = new Core({ home, vaultPath: join(home, 'vault'), port: 4545 });
  try {
    await seed(core, { vault: true });
    await core.vault.flush();
    const app = createApp(core, { checkHost: false });
    const call = async <T extends z.ZodTypeAny>(method: string, path: string, schema: T, body?: unknown): Promise<z.infer<T>> => {
      const res = await app.request(`/api/v1${path}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
      const r = schema.safeParse(json);
      if (!r.success) throw new Error(`${method} ${path} 응답이 스키마와 달라요: ${JSON.stringify(r.error.issues.slice(0, 3))}`);
      return r.data;
    };
    const get = <T extends z.ZodTypeAny>(path: string, schema: T) => call('GET', path, schema);
    mkdirSync(join(outDir, 'demo'), { recursive: true });
    let files = 0;
    const write = (name: string, data: unknown) => { writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`); files++; };

    // ── 읽기 응답 (웹이 import하는 이름 그대로)
    const COPY = 'task_20260830_01';
    const reads: Array<[string, string, z.ZodTypeAny]> = [
      ['health', '/health', S.HealthResponseSchema],
      ['meta', '/meta', S.MetaResponseSchema],
      ['dashboard', '/dashboard', S.DashboardResponseSchema],
      ['graph', '/graph', S.GraphResponseSchema],
      ['graphExcerpt', `/graph?focus=${COPY}&depth=1`, S.GraphResponseSchema],
      ['activity', '/activity?weeks=26', S.ActivityResponseSchema],
      ['projectsList', '/projects', S.listOf(S.ProjectSummarySchema)],
      ['projectDetail', '/projects/prj_blog', S.ProjectDetailSchema],
      ['topicDetail', '/topics/obj_topic_copywriting', S.TopicDetailSchema],
      ['tasksList', `/tasks?status=${encodeURIComponent('멈춤')}&limit=3`, S.listOf(S.TaskListItemSchema)],
      ['board', '/board', S.BoardResponseSchema],
      ['taskDetail', `/tasks/${COPY}`, S.TaskDetailSchema],
      ['taskFlow', `/tasks/${COPY}/flow`, S.FlowResponseSchema],
      ['resumePrompt', `/tasks/${COPY}/resume-prompt?targetAi=claude`, S.ResumePromptResponseSchema],
      ['conversationDetail', '/conversations/conv_chatgpt_68f2a91c?limit=2', S.ConversationDetailSchema],
      ['mergeSuggestions', '/merge-suggestions', S.listOf(S.MergeSuggestionSchema)],
      ['digestList', '/digests', S.listOf(S.DigestListItemSchema)],
      ['digest', '/digests/2026-09-30', S.DigestResponseSchema],
      ['search', `/search?q=${encodeURIComponent('이사 견적')}`, S.SearchResponseSchema],
      ['searchPaged', `/search?q=${encodeURIComponent('카피')}&limit=2`, S.SearchResponseSchema],
      ['settings', '/settings', S.SettingsSchema],
      ['vaultConflicts', '/vault/conflicts', S.listOf(S.VaultConflictSchema)],
      ['importsList', '/imports', S.listOf(S.ImportJobSchema)],
      ['importDone', '/imports/imp_20260930_k3f9', S.ImportJobSchema],
      ['classificationStatus', '/classification/status', S.ClassificationStatusSchema],
      ['jobsList', '/jobs?limit=5', S.listOf(S.JobSchema)],
      ['projectSuggestions', '/project-suggestions', S.listOf(S.ProjectSuggestionSchema)], // 1.1.0 (1.2.0부터 읽기 캡처 — dashboard 배지와 같은 상태)
      ['tasksHandedOff', '/tasks?handedOff=true', S.listOf(S.TaskListItemSchema)], // 1.2.0 다른 곳에서 이어감 예시(시드 task_20260915_01)
      ['weeklyReview', '/review/weekly', S.WeeklyReviewResponseSchema],
      ['weeklyReviewPrev', '/review/weekly?date=2026-09-21', S.WeeklyReviewResponseSchema],
      ['tasksBlocked', '/tasks?classificationState=blocked', S.listOf(S.TaskListItemSchema)], // 1.2.0 분류 불가 예시(시드 task_20260922_02)
    ];
    for (const [name, path, schema] of reads) write(name, await get(path, schema));
    const paged = await get(`/search?q=${encodeURIComponent('카피')}&limit=2`, S.SearchResponseSchema);
    if (paged.page.nextCursor) write('searchPagedNext', await get(`/search?q=${encodeURIComponent('카피')}&limit=2&cursor=${paged.page.nextCursor}`, S.SearchResponseSchema));

    // ── 전체 상세 세트 (웹 모의 모드가 어떤 id든 채울 수 있게)
    const tasks = (await get('/tasks?status=' + encodeURIComponent('진행 중,멈춤,완료,간단한 질문,보관') + '&limit=200', S.listOf(S.TaskListItemSchema))).items;
    const projects = (await get('/projects?limit=200', S.listOf(S.ProjectSummarySchema))).items;
    const graph = await get('/graph', S.GraphResponseSchema);
    const topicIds = graph.nodes.filter((n) => n.type === 'topic').map((n) => n.id);
    const demo = { tasks: {} as Record<string, unknown>, flows: {} as Record<string, unknown>, resumePrompts: {} as Record<string, unknown>, projects: {} as Record<string, unknown>, topics: {} as Record<string, unknown>, conversations: {} as Record<string, unknown> };
    const convIds = new Set<string>();
    for (const t of tasks) {
      const detail = await get(`/tasks/${t.id}`, S.TaskDetailSchema);
      demo.tasks[t.id] = detail;
      demo.flows[t.id] = await get(`/tasks/${t.id}/flow`, S.FlowResponseSchema);
      demo.resumePrompts[t.id] = await get(`/tasks/${t.id}/resume-prompt`, S.ResumePromptResponseSchema);
      for (const c of core.db.all<{ conversation_id: string }>('SELECT conversation_id FROM task_conversations WHERE task_id=?', t.id)) convIds.add(c.conversation_id);
    }
    for (const p of projects) demo.projects[p.id] = await get(`/projects/${p.id}`, S.ProjectDetailSchema);
    for (const id of topicIds) demo.topics[id] = await get(`/topics/${id}`, S.TopicDetailSchema);
    for (const id of [...convIds].sort()) demo.conversations[id] = await get(`/conversations/${id}`, S.ConversationDetailSchema);
    for (const [k, v] of Object.entries(demo)) write(`demo/${k}`, v);
    const counts = Object.fromEntries(Object.entries(demo).map(([k, v]) => [k, Object.keys(v).length]));
    write('demo/index', { generatedAt: MOCK_NOW, note: '엔진(pnpm --filter @subbrain/core mocks)이 예시 데이터 위에서 캡처한 전체 상세. 키 = id', counts,
      taskIds: Object.keys(demo.tasks), projectIds: Object.keys(demo.projects), topicIds: Object.keys(demo.topics), conversationIds: Object.keys(demo.conversations) });

    // ── 쓰기 응답 (임시 DB에서 실제로 실행 — 읽기 캡처 뒤에)
    const reject = await call('POST', '/merge-suggestions/ms_4410/reject', S.RejectMergeResponseSchema, { reason: '다른 과제예요' });
    write('rejectMergeResponse', reject);
    core.db.run("UPDATE task_merge_suggestions SET state='pending', decided_at=NULL WHERE id='ms_4410'"); // 같은 제안으로 수락 예시도 만들기 위해 되돌림
    write('acceptMergeResponse', await call('POST', '/merge-suggestions/ms_4410/accept', S.AcceptMergeResponseSchema, {}));
    write('updateTaskResponse', await call('PATCH', '/tasks/task_20260805_01', S.UpdateTaskResponseSchema, { status: '보관' }));
    write('mergeTasksResponse', await call('POST', `/tasks/${'task_20260921_01'}/merge`, S.MergeTasksResponseSchema, { sourceTaskIds: ['task_20260924_03'] }));
    // 1.1.0 새 프로젝트 제안 수락 — 제안은 시드에 있음(psg_seed01). 읽기 캡처(dashboard·digest·projectSuggestions)가 같은 상태를 보도록 1.2.0부터 시드로 옮김
    write('acceptProjectSuggestionResponse', await call('POST', '/project-suggestions/psg_seed01/accept', S.AcceptProjectSuggestionResponseSchema, {}));
    return { files, demo: counts };
  } finally {
    core.close();
    rmSync(home, { recursive: true, force: true });
    setNow(prevNow);
  }
}
