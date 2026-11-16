/**
 * Phase 9 (계약 1.8.0) — MCP 서버: 공식 SDK in-process 클라이언트(InMemoryTransport)로 도구 목록·읽기·쓰기·되돌리기·가림·코어 꺼짐,
 * Streamable HTTP(상태 없음, Host 검사), 코어 쓰기 엔드포인트(/mcp/log-task 등)
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { makeCore } from './helpers.ts';
import { createSubbrainMcpServer, READ_TOOLS, WRITE_TOOLS } from '../src/mcp/server.ts';
import { createHttpApp } from '../src/mcp/main.ts';

type T = Awaited<ReturnType<typeof makeCore>>;
let t: T | null = null;
afterEach(() => { t?.close(); t = null; });

const viaApp = (tt: T): typeof fetch => (async (input: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(input));
  return tt.app.request(u.pathname + u.search, { ...init, headers: { ...(init?.headers as Record<string, string> ?? {}), host: '127.0.0.1:4545' } });
}) as typeof fetch;

async function connect(opts: { write?: boolean; fetchImpl: typeof fetch }) {
  const server = createSubbrainMcpServer({ coreUrl: 'http://127.0.0.1:4545', ...opts });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const callText = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    return { text: r.content.map((c) => c.text).join('\n'), isError: !!r.isError };
  };
  return { client, callText };
}

describe('MCP 도구', () => {
  it('도구 목록: 읽기 14 + 쓰기 4, 삭제 도구 없음, 읽기 전용 모드는 쓰기 숨김, 주석', async () => {
    t = await makeCore({ seeded: true });
    const { client } = await connect({ write: true, fetchImpl: viaApp(t) });
    expect((await (await connect({ fetchImpl: viaApp(t) })).client.listTools()).tools.map((x) => x.name).sort()).toEqual([...READ_TOOLS].sort()); // 1.10.0 기본 읽기 전용
    const tools = (await client.listTools()).tools;
    expect(tools.map((x) => x.name).sort()).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
    expect(tools.some((x) => /delete|remove|purge|erase|drop/i.test(x.name))).toBe(false);
    expect(tools.find((x) => x.name === 'get_task')!.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((x) => x.name === 'log_task')!.annotations?.destructiveHint).toBe(false);
    const ro = await connect({ write: false, fetchImpl: viaApp(t) });
    expect((await ro.client.listTools()).tools.map((x) => x.name).sort()).toEqual([...READ_TOOLS].sort());
  });

  it('읽기: get_unfinished · get_timeline · search_past_work · get_task · get_resume_prompt · 온톨로지 읽기', async () => {
    t = await makeCore({ seeded: true });
    const { callText } = await connect({ fetchImpl: viaApp(t) });
    const u = await callText('get_unfinished', { project: '블로그 리뉴얼' });
    expect(u.isError).toBe(false);
    expect(u.text).toContain('메인 페이지 카피 확정');
    expect((await callText('get_unfinished', { project: '없는 프로젝트' })).text).toContain('없어요');
    const tl = await callText('get_timeline', { from: '2026-09-24', to: '2026-09-30' });
    expect(tl.text).toMatch(/## 2026-09-\d\d/);
    expect((await callText('search_past_work', { query: '카피' })).text).toContain('카피');
    const g = await callText('get_task', { task_id: 'task_20260830_01' });
    expect(g.text).toContain('# 메인 페이지 카피 확정');
    expect(g.text).toContain('결정:');
    expect((await callText('get_task', { task_id: '메인 페이지 카피' })).text).toContain('task_20260830_01'); // 이름으로
    expect((await callText('get_resume_prompt', { task_id: 'task_20260830_01', target_ai: 'claude' })).text.length).toBeGreaterThan(50);
    expect((await callText('search_objects', { query: 'nextjs' })).text).toContain('Next.js');
    expect((await callText('find_by_object', { name: 'Next.js', type: 'tool' })).text).toContain('과제:');
    expect((await callText('impact_of', { decision: '카피 톤은 존댓말' })).text).toContain('소개 페이지 톤 맞추기');
    expect((await callText('similar_past_work', { text: 'Next.js 배포 오류' })).text).toContain('배포');
    expect((await callText('get_task', { task_id: 'task_nope' })).isError).toBe(true);
  });

  it('가림: 사람 이름은 역할로(기본), 허용하면 이름, 민감 프로젝트 과제는 비공개', async () => {
    t = await makeCore({ seeded: true });
    const { callText } = await connect({ write: true, fetchImpl: viaApp(t) });
    const w = await callText('why_stalled', { task: 'task_20260827_01' });
    expect(w.text).toContain('프리랜서 디자이너(사람)');
    expect(w.text).not.toContain('윤서');
    await t.json('PATCH', '/settings', { ontology: { showPersonNames: true } });
    expect((await callText('why_stalled', { task: 'task_20260827_01' })).text).toContain('윤서');
    await t.json('PATCH', '/settings', { llm: { sensitiveProjectIds: ['prj_blog'] } });
    const g = await callText('get_task', { task_id: 'task_20260830_01' });
    expect(g.text).toContain('🔒');
    expect(g.text).not.toContain('카피');
    expect((await callText('get_unfinished', {})).text).not.toContain('메인 페이지 카피 확정');
    expect((await callText('get_resume_prompt', { task_id: 'task_20260830_01' })).text).toContain('웹앱에서만');
  });

  it('쓰기: log_task → update_task_status(검색어) → list_my_writes → undo_write(이전 상태) → undo log(보관, 삭제 아님)', async () => {
    t = await makeCore({ seeded: true });
    const db = t.core.db;
    const { callText } = await connect({ write: true, fetchImpl: viaApp(t) });
    const l = await callText('log_task', { title: '데스크톱 앱 설치 스크립트 정리', project: '서브브레인', note: 'Claude Desktop에서 작업 중', next_step: '맥에서 시험' });
    expect(l.isError).toBe(false);
    const taskId = /task_\w+/.exec(l.text)![0];
    const logEvent = Number(/event_id=(\d+)/.exec(l.text)![1]);
    expect(db.get('SELECT origin, status, project_id, next_step FROM tasks WHERE id=?', taskId)).toEqual({ origin: 'mcp', status: '진행 중', project_id: 'prj_subbrain', next_step: '맥에서 시험' });
    expect(db.value("SELECT capture_method FROM conversations WHERE task_id=?", taskId)).toBe('mcp');
    expect(db.value("SELECT COUNT(*) FROM conversations WHERE task_id=? AND (classified_hash IS NULL OR classified_hash<>content_hash)", taskId)).toBe(0);
    const u = await callText('update_task_status', { query: '데스크톱 앱 설치 스크립트', status: '완료', next_step: '없음' });
    expect(u.text).toContain('진행 중 → 완료');
    expect(db.get('SELECT status, status_source FROM tasks WHERE id=?', taskId)).toEqual({ status: '완료', status_source: 'mcp' });
    const ev = Number(/event_id=(\d+)/.exec(u.text)![1]);
    expect((await callText('list_my_writes')).text).toContain(`event ${ev}`);
    expect((await callText('undo_write', { event_id: logEvent })).isError).toBe(false); // 기록 되돌리기는 상태 변경과 별개(보관)
    expect(db.value('SELECT status FROM tasks WHERE id=?', taskId)).toBe('보관');
    expect(db.value('SELECT COUNT(*) FROM tasks WHERE id=?', taskId)).toBe(1); // 삭제 아님
    expect((await callText('undo_write', { event_id: logEvent })).text).toContain('이미 되돌린');
    expect((await callText('undo_write', { event_id: ev })).isError).toBe(false);
    expect(db.value("SELECT COUNT(*) FROM events WHERE type='write_undone'")).toBe(2);
    // 애매한 검색어 → 후보
    await callText('log_task', { title: '중복 제목 과제 하나' }); await callText('log_task', { title: '중복 제목 과제 둘' });
    const amb = await callText('update_task_status', { query: '중복 제목 과제', status: '멈춤' });
    expect(amb.isError).toBe(true);
    expect(amb.text).toContain('후보');
    // 없는 프로젝트는 붙이지 않음
    expect((await callText('log_task', { title: '프로젝트 없는 기록', project: '없는거' })).text).toContain('붙이지 않았어요');
  });

  it('코어가 꺼져 있으면 알기 쉬운 오류', async () => {
    const { callText } = await connect({ fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch });
    const r = await callText('get_unfinished');
    expect(r.isError).toBe(true);
    expect(r.text).toContain('코어가 실행 중이 아닙니다');
  });

  it('Streamable HTTP(상태 없음): initialize·tools/list, 다른 Host는 막음', async () => {
    t = await makeCore({ seeded: true });
    const app = createHttpApp({ coreUrl: 'http://127.0.0.1:4545', port: 4547, fetchImpl: viaApp(t), auth: false });
    const rpc = (body: unknown, host = '127.0.0.1:4547') => app.request('/mcp', { method: 'POST', headers: { host, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) });
    const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    expect(init.status).toBe(200);
    expect(((await init.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe('subbrain');
    const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(((await list.json()) as { result: { tools: unknown[] } }).result.tools.length).toBe(18);
    const call = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_unfinished', arguments: { limit: 3 } } });
    expect(JSON.stringify(await call.json())).toContain('안 끝난 과제');
    expect((await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} }, 'evil.example:4547')).status).toBe(403);
  });
});
