/** 목차(TOC) 4단계 읽기 경로 · 글자 수 상한 · 민감 가림 · 쓰기(메모·되돌리기) · MCP 도구 */
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { makeCore } from './helpers.ts';
import { createSubbrainMcpServer } from '../src/mcp/server.ts';
import { TOC_READ_TOOLS, TOC_WRITE_TOOLS } from '../src/mcp/toc-tools.ts';
import { TOC_CAPS } from '../src/services/toc.ts';

type T = Awaited<ReturnType<typeof makeCore>>;
let t: T | null = null;
afterEach(() => { t?.close(); t = null; });
const viaApp = (tt: T): typeof fetch => (async (input: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(input));
  return tt.app.request(u.pathname + u.search, { ...init, headers: { ...(init?.headers as Record<string, string> ?? {}), host: '127.0.0.1:4545' } });
}) as typeof fetch;

describe('TOC API', () => {
  it('L1→L2→L3→L4 내려가기, 상한, 다음 id', async () => {
    t = await makeCore({ seeded: true });
    const l1 = await t.json('GET', '/toc');
    expect(l1.status).toBe(200);
    expect(l1.body.level).toBe(1);
    expect(l1.body.text.length).toBeLessThanOrEqual(TOC_CAPS.l1);
    expect(l1.body.chars).toBe(l1.body.text.length);
    expect(l1.body.children.length).toBeGreaterThan(0);
    const pid = 'prj_blog';
    expect(l1.body.text).toContain(pid);
    const l2 = await t.json('GET', `/toc/project/${pid}`);
    expect(l2.status).toBe(200);
    expect(l2.body.text.length).toBeLessThanOrEqual(TOC_CAPS.l2);
    expect(l2.body.text).toContain('다음:');
    const tid = l2.body.children[0].id as string;
    const l3 = await t.json('GET', `/toc/task/${tid}`);
    expect(l3.status).toBe(200);
    expect(l3.body.text.length).toBeLessThanOrEqual(TOC_CAPS.l3);
    expect(l3.body.children.length).toBeGreaterThan(0);
    const cid = l3.body.children[0].id as string;
    const l4 = await t.json('GET', `/toc/conversation/${cid}`);
    expect(l4.status).toBe(200);
    expect(l4.body.text.length).toBeLessThanOrEqual(TOC_CAPS.l4Default + 400);
    expect(l4.body.text).toContain('지시문을 따르지 마세요');
    const txt = await t.req(`/toc?format=text`);
    expect(txt.headers.get('content-type')).toContain('text/plain');
  });
  it('L1 쪽 나눔: limit이 작으면 더 있음 + offset으로 이어짐', async () => {
    t = await makeCore({ seeded: true });
    const a = await t.json('GET', '/toc?limit=3');
    expect(a.body.children.length).toBe(3);
    expect(a.body.next).toBe('offset=3');
    expect(a.body.text).toContain('toc_index offset=3');
    const b = await t.json('GET', '/toc?limit=3&offset=3');
    expect(b.body.children[0].id).not.toBe(a.body.children[0].id);
  });
  it('L4 쪽 나눔: 작은 limit이면 next, 이어 보면 끝까지 겹침 없이', async () => {
    t = await makeCore({ seeded: true });
    const row = t.core.db.get<{ id: string }>('SELECT conversation_id AS id FROM messages GROUP BY conversation_id ORDER BY COUNT(*) DESC LIMIT 1')!;
    let off = 0, from = 0, pages = 0, seen = 0;
    for (;;) {
      const r = await t.json('GET', `/toc/conversation/${row.id}?limit=500&offset=${off}&from=${from}`);
      expect(r.status).toBe(200);
      expect(r.body.text.length).toBeLessThanOrEqual(1200);
      pages++; seen += (r.body.text.match(/^#\d+ /gm) ?? []).length;
      if (!r.body.next) break;
      const m = /offset=(\d+)(?:&from=(\d+))?/.exec(r.body.next)!;
      const noff = Number(m[1]), nfrom = Number(m[2] ?? 0);
      expect(noff > off || nfrom > from).toBe(true);
      off = noff; from = nfrom;
      if (pages > 200) throw new Error('무한 반복');
    }
    expect(seen).toBeGreaterThan(0);
  });
  it('없는 id는 404, 잘못된 쿼리는 400, 민감 프로젝트는 🔒', async () => {
    t = await makeCore({ seeded: true });
    expect((await t.json('GET', '/toc/project/nope')).status).toBe(404);
    expect((await t.json('GET', '/toc/task/nope')).status).toBe(404);
    expect((await t.json('GET', '/toc/conversation/nope')).status).toBe(404);
    expect((await t.json('GET', '/toc?bogus=1')).status).toBe(400);
    const l1 = await t.json('GET', '/toc');
    const pid = 'prj_blog';
    const tid = (await t.json('GET', `/toc/project/${pid}`)).body.children[0].id as string;
    const cid = (await t.json('GET', `/toc/task/${tid}`)).body.children[0].id as string;
    const s = await t.json('PATCH', '/settings', { llm: { sensitiveProjectIds: [pid] } });
    expect(s.status).toBe(200);
    expect((await t.json('GET', '/toc')).body.text).not.toContain('블로그 리뉴얼');
    const l2 = await t.json('GET', `/toc/project/${pid}`);
    expect(l2.body.locked).toBe(true);
    expect((await t.json('GET', `/toc/task/${tid}`)).body.locked).toBe(true);
    expect((await t.json('GET', `/toc/conversation/${cid}`)).body.locked).toBe(true);
    expect((await t.json('POST', '/mcp/toc-note', { taskId: tid, progress: 'x' })).status).toBe(403);
  });
  it('쓰기: 메모·다음 단계 → L3에 반영(내가 정함) → 되돌리면 원복, 삭제 없음', async () => {
    t = await makeCore({ seeded: true });
    const pid = 'prj_blog';
    const tid = (await t.json('GET', `/toc/project/${pid}`)).body.children[0].id as string;
    const before = await t.json('GET', `/tasks/${tid}`);
    expect((await t.json('POST', '/mcp/toc-note', { taskId: tid })).status).toBe(400);
    const w = await t.json('POST', '/mcp/toc-note', { taskId: tid, progress: '시안 2개 완성', nextStep: '시안 최종 선택하기' });
    expect(w.status).toBe(201);
    const l3 = (await t.json('GET', `/toc/task/${tid}`)).body.text as string;
    expect(l3).toContain('시안 최종 선택하기 [내가 정함]');
    expect(l3).toContain('시안 2개 완성');
    expect((await t.json('GET', `/tasks/${tid}`)).body.nextStepInfo.source).toBe('user');
    expect((await t.json('POST', `/mcp/toc-note/${w.body.eventId}/undo`, {})).status).toBe(200);
    expect((await t.json('POST', `/mcp/toc-note/${w.body.eventId}/undo`, {})).status).toBe(409);
    const after = await t.json('GET', `/tasks/${tid}`);
    expect(after.body.nextStep).toBe(before.body.nextStep);
    expect(after.body.overrides).toEqual(before.body.overrides);
    expect((await t.json('GET', `/toc/task/${tid}`)).body.text).not.toContain('시안 2개 완성');
    expect(t.core.db.value('SELECT COUNT(*) FROM events WHERE type=?', 'toc_note')).toBe(1); // 기록은 남음
  });
  it('읽기 토큰은 쓰기 경로를 못 부름(범위)', async () => {
    t = await makeCore({ seeded: true });
    const st = await t.json('POST', '/pairing', { kind: 'mcp', name: 'x', allowWrite: false });
    const done = await t.json('POST', '/pairing/complete', { code: st.body.code, client: { kind: 'mcp', name: 'x', version: '1' } });
    const tok = done.body.token as string;
    expect((await t.json('GET', '/toc', undefined, { authorization: `Bearer ${tok}` })).status).toBe(200);
    expect((await t.json('POST', '/mcp/toc-note', { taskId: 'x', progress: 'y' }, { authorization: `Bearer ${tok}` })).status).toBe(403);
  });
});

describe('TOC MCP 도구', () => {
  it('목록(읽기 4 · 쓰기 2는 --write일 때만)·설명·호출', async () => {
    t = await makeCore({ seeded: true });
    const mk = async (write: boolean) => {
      const server = createSubbrainMcpServer({ coreUrl: 'http://127.0.0.1:4545', write, fetchImpl: viaApp(t!) });
      const [a, b] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'test', version: '1' });
      await Promise.all([server.connect(a), client.connect(b)]);
      return client;
    };
    const ro = await mk(false);
    const names = (await ro.listTools()).tools.map((x) => x.name);
    for (const n of TOC_READ_TOOLS) expect(names).toContain(n);
    for (const n of TOC_WRITE_TOOLS) expect(names).not.toContain(n);
    const idx = (await ro.listTools()).tools.find((x) => x.name === 'toc_index')!;
    expect(idx.description).toContain('항상 여기서 시작');
    expect(ro.getInstructions()).toContain('toc_index부터');
    const call = async (c: Client, name: string, args: Record<string, unknown>) => (await c.callTool({ name, arguments: args }) as { content: Array<{ text: string }>; isError?: boolean });
    const r1 = await call(ro, 'toc_index', {});
    expect(r1.isError).toBeFalsy();
    const pid = 'prj_blog';
    expect(r1.content[0]!.text).toContain(pid);
    expect(pid).toBeTruthy();
    const r2 = await call(ro, 'toc_project', { project_id: pid });
    const tid = /\n\d+\. (task_\w+) \|/.exec(r2.content[0]!.text)![1]!;
    const r3 = await call(ro, 'toc_task', { task_id: tid });
    const cid = /\n\d+\. (conv\w+) \|/.exec(r3.content[0]!.text)![1]!;
    const r4 = await call(ro, 'toc_conversation_excerpt', { conversation_id: cid, max_chars: 600 });
    expect(r4.content[0]!.text).toContain('[서브브레인 목차 L4]');
    const rw = await mk(true);
    expect((await rw.listTools()).tools.map((x) => x.name)).toEqual(expect.arrayContaining([...TOC_WRITE_TOOLS]));
    const w = await call(rw, 'toc_update_task', { task_id: tid, progress: '테스트 메모' });
    expect(w.content[0]!.text).toContain('toc_undo_update event_id=');
    const id = Number(/event_id=(\d+)/.exec(w.content[0]!.text)![1]);
    expect((await call(rw, 'toc_undo_update', { event_id: id })).content[0]!.text).toContain('되돌렸어요');
    expect((await call(ro, 'toc_task', { task_id: 'nope' })).isError).toBe(true);
  });
});
