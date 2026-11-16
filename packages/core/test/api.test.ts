import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as S from '@subbrain/shared/schemas';
import { API_VERSION } from '@subbrain/shared/constants';
import { GET_CASES } from './cases.ts';
import { makeCore } from './helpers.ts';

let t: Awaited<ReturnType<typeof makeCore>>;
beforeAll(async () => { t = await makeCore({ seeded: true }); });
afterAll(() => t.close());

describe('GET 계약 (예시 데이터, zod 검사)', () => {
  it.each(GET_CASES)('%s', async (path, schema) => {
    const r = await t.json('GET', path);
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    const parsed = schema.safeParse(r.body);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true);
    expect(r.res.headers.get('x-subbrain-api-version')).toBe(API_VERSION);
  });
});

describe('예시 데이터 = 디자인 v3 수치, 모든 응답에서 같은 수', () => {
  it('대시보드', async () => {
    const d = (await t.json('GET', '/dashboard')).body;
    expect(d.counts).toMatchObject({ inProgress: 7, stalled: 11, /* 1.5.0: 예시의 넘겨준 과제(task_20260915_01, 대화 결과 moved)가 완료/moved로 — 디자인 v3의 12에서 1 줄어듦 */ quickQuestions: 26, needsReview: 3, completedThisWeek: 2 });
  });
  it('프로젝트 8개, 합계가 디자인과 같고 그래프 노드 = 프로젝트 요약', async () => {
    const want: Record<string, [number, number]> = { prj_blog: [43, 402], prj_subbrain: [58, 475], prj_moving: [19, 160], prj_kyoto: [12, 140], prj_dividend: [11, 110], prj_career: [16, 150], prj_devstudy: [22, 200], prj_health: [9, 70] };
    const list = (await t.json('GET', '/projects')).body.items as Array<{ id: string; conversationCount: number; taskCount: number; colorHex: string }>;
    expect(list.map((p) => p.id).sort()).toEqual(Object.keys(want).sort());
    expect(new Set(list.map((p) => p.colorHex)).size).toBe(8); // 색 겹침 없음
    expect(list.reduce((n, p) => n + p.taskCount, 0)).toBe(41);
    const g = (await t.json('GET', '/graph')).body;
    for (const p of list) {
      const n = g.nodes.find((x: { id: string }) => x.id === p.id);
      expect([n.conversationCount, n.messageCount]).toEqual(want[p.id]);
      expect(n.conversationCount).toBe(p.conversationCount);
      expect(n.taskCount).toBe(p.taskCount);
    }
    expect(g.stats).toMatchObject({ projectCount: 8, taskCount: 43, quickQuestionCount: 26 });
  });
  it('과제 수는 공유 대화 포함 — 목록·그래프·프로젝트 상세·과제 상세가 모두 같다', async () => {
    const g = (await t.json('GET', '/graph')).body;
    const list = (await t.json('GET', `/tasks?status=${encodeURIComponent('진행 중,멈춤,완료,간단한 질문')}&limit=200`)).body.items as Array<{ id: string; conversationCount: number; messageCount: number; sourceAis: string[]; project: { id: string } | null }>;
    for (const item of list) {
      const node = g.nodes.find((n: { id: string }) => n.id === item.id);
      const detail = (await t.json('GET', `/tasks/${item.id}`)).body;
      expect([node.conversationCount, node.messageCount], item.id).toEqual([item.conversationCount, item.messageCount]);
      expect([detail.conversationCount, detail.messageCount], item.id).toEqual([item.conversationCount, item.messageCount]);
      expect([...node.sourceAis].sort()).toEqual([...item.sourceAis].sort());
    }
    const copy = list.find((x) => x.id === 'task_20260830_01')!;
    expect([copy.conversationCount, copy.messageCount]).toEqual([5, 89]);
    const pd = (await t.json('GET', '/projects/prj_blog')).body;
    expect(pd.tasks.find((x: { id: string }) => x.id === 'task_20260830_01')).toMatchObject({ conversationCount: 5, messageCount: 89 });
  });
  it('26주 활동이 비지 않는다', async () => {
    const a = (await t.json('GET', '/activity?weeks=26')).body;
    expect(a.buckets).toHaveLength(26);
    expect(a.buckets.every((b: { conversationCount: number }) => b.conversationCount > 0)).toBe(true);
  });
  it('모든 과제·프로젝트에 상세와 흐름이 있다', async () => {
    const list = (await t.json('GET', `/tasks?status=${encodeURIComponent('진행 중,멈춤,완료,간단한 질문,보관')}&limit=200`)).body.items as Array<{ id: string }>;
    expect(list.length).toBeGreaterThan(90);
    for (const x of list.slice(0, 200)) {
      expect(S.FlowResponseSchema.safeParse((await t.json('GET', `/tasks/${x.id}/flow`)).body).success, x.id).toBe(true);
    }
  });
  it('resume.promptPreview = resume-prompt 전문', async () => {
    for (const id of ['task_20260830_01', 'task_20260914_01', 'task_20260921_01']) {
      const d = (await t.json('GET', `/tasks/${id}`)).body;
      const p = (await t.json('GET', `/tasks/${id}/resume-prompt`)).body;
      expect(d.resume.promptPreview).toBe(p.prompt);
    }
  });
  it('요약: 엔진이 만들고 멈춤 이벤트에 project가 채워짐', async () => {
    const d = (await t.json('GET', '/digests/2026-09-30')).body;
    const stalls = d.yesterday.events.filter((e: { action: string }) => e.action === 'stalled');
    expect(stalls.length).toBeGreaterThan(0);
    expect(stalls.every((e: { project: unknown }) => e.project !== null)).toBe(true);
    expect(d.prevDate).toBe('2026-09-29');
  });
});

describe('검색', () => {
  it('2글자는 like, 3글자 이상은 trigram, 교집합', async () => {
    const r = (await t.json('GET', `/search?q=${encodeURIComponent('이사 견적')}`)).body;
    expect(r.terms).toEqual([{ term: '이사', mode: 'like' }, { term: '견적', mode: 'like' }]);
    expect(r.items.some((i: { title: string }) => i.title === '이사업체 견적 비교표')).toBe(true);
    const r3 = (await t.json('GET', `/search?q=${encodeURIComponent('카피라이팅')}`)).body;
    expect(r3.terms[0].mode).toBe('trigram');
  });
  it('cursor 페이지 넘기기', async () => {
    const q = encodeURIComponent('카피');
    const p1 = (await t.json('GET', `/search?q=${q}&limit=2`)).body;
    expect(p1.items).toHaveLength(2);
    expect(p1.page.hasMore).toBe(true);
    const p2 = (await t.json('GET', `/search?q=${q}&limit=2&cursor=${p1.page.nextCursor}`)).body;
    expect(p2.items.map((i: { id: string }) => i.id)).not.toEqual(p1.items.map((i: { id: string }) => i.id));
  });
  it('빈 q는 400', async () => { expect((await t.json('GET', '/search?q=')).status).toBe(400); });
});

describe('쓰기', () => {
  it('합치기 거절 = 수락과 같은 {suggestion, task}, 멱등 키, 다시 처리하면 409', async () => {
    const r = await t.json('POST', '/merge-suggestions/ms_4410/reject', { reason: '다른 과제' }, { 'idempotency-key': 'k-1' });
    expect(r.status).toBe(200);
    expect(S.RejectMergeResponseSchema.safeParse(r.body).success).toBe(true);
    expect(r.body.suggestion.state).toBe('rejected');
    expect(r.body.task.id).toBe('task_20260902_01');
    const again = await t.json('POST', '/merge-suggestions/ms_4410/reject', { reason: '다른 과제' }, { 'idempotency-key': 'k-1' });
    expect(again.status).toBe(200);
    expect((await t.json('POST', '/merge-suggestions/ms_4410/accept', {})).status).toBe(409);
  });
  it('PATCH 과제: 보관 → overrides에 status, 잘못된 상태는 400', async () => {
    const r = await t.json('PATCH', '/tasks/task_20260805_01', { status: '보관' });
    expect(r.status).toBe(200);
    expect(r.body.task).toMatchObject({ status: '보관', statusSource: 'user' });
    expect(r.body.task.overrides).toContain('status');
    const bad = await t.json('PATCH', '/tasks/task_20260805_01', { status: '진행중' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });
  it('설정: 기준 일수 순서가 틀리면 400, 맞으면 200', async () => {
    expect((await t.json('PATCH', '/settings', { thresholds: { inProgressMaxDays: 9 } })).status).toBe(400);
    const ok = await t.json('PATCH', '/settings', { digest: { time: '07:30' } });
    expect(ok.status).toBe(200);
    expect(ok.body.digest.time).toBe('07:30');
  });
  it('llm-test: 키 없음 → 200 ok:false', async () => {
    const r = await t.json('POST', '/settings/llm-test', {});
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(false);
  });
});

describe('경계', () => {
  it('LATER 경로는 501 + phase, 없는 경로는 404, 없는 과제는 404', async () => {
    const l = await t.json('POST', '/deletion-batches/del_1/approve', { expectedSelectedCount: 1, excludedItemIds: [] });
    expect(l.status).toBe(501);
    expect(l.body.error).toMatchObject({ code: 'NOT_IMPLEMENTED', details: { phase: '6' } });
    expect((await t.json('GET', '/nope')).status).toBe(404);
    expect((await t.json('GET', '/tasks/task_20990101_01')).body.error.code).toBe('NOT_FOUND');
  });
  it('Host 검사: 모르는 Host는 403, Vite 프록시 Host(127.0.0.1:5173)는 통과', async () => {
    const bad = await t.app.request('/api/v1/health', { headers: { host: 'evil.example:4545' } });
    expect(bad.status).toBe(403);
    const proxy = await t.app.request('/api/v1/health', { headers: { host: '127.0.0.1:5173' } });
    expect(proxy.status).toBe(200);
  });
  it('Origin 검사: 허용 밖 Origin의 쓰기는 403, 개발 origin은 CORS 헤더', async () => {
    const bad = await t.json('PATCH', '/settings', { digest: { time: '08:00' } }, { origin: 'https://evil.example' });
    expect(bad.status).toBe(403);
    const dev = await t.req('/health', { headers: { origin: 'http://localhost:5173' } });
    expect(dev.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });
});
