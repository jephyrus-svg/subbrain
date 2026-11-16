/**
 * Phase 12 (계약 1.10.0) — Grok Bot 가져오기, 수집기 버그(대시보드·classify:false·어림), AI 검색 1·2단계(MCP 필터·출처·2,000자·새 도구·읽기 전용 기본)
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { makeCore, NOW } from './helpers.ts';
import { parseExport } from '../src/importers/detect.ts';
import { putCollectorConfig } from '../src/collector/collector.ts';
import { createSubbrainMcpServer, READ_TOOLS } from '../src/mcp/server.ts';
import { MAX_CHARS } from '../src/mcp/format.ts';

type T = Awaited<ReturnType<typeof makeCore>>;
let t: T | null = null;
afterEach(() => { t?.close(); t = null; });
const iso = (min: number) => new Date(Date.parse(NOW) + min * 60_000).toISOString();
const J = (o: unknown) => JSON.stringify(o) + '\n';
const ccLine = (sid: string, min: number, role: 'user' | 'assistant', text: string) => J(role === 'user'
  ? { type: 'user', sessionId: sid, cwd: '/Users/me/dev/x', version: '2', timestamp: iso(min), isSidechain: false, message: { role: 'user', content: text }, uuid: `u${min}` }
  : { type: 'assistant', sessionId: sid, cwd: '/Users/me/dev/x', version: '2', timestamp: iso(min), isSidechain: false, message: { id: `m${min}`, role: 'assistant', model: 'x', content: [{ type: 'text', text }] } });

describe('A1. Grok Bot 가져오기', () => {
  it('Claude 형식 + grokbot 힌트/파일 이름 → sourceAi grokbot, URL 없음, 같은 uuid라도 Claude와 다른 대화', () => {
    const conv = [{ uuid: '11111111-2222-4333-8444-555555555555', name: '봇 대화', summary: '', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:01:00Z', account: { uuid: 'a' },
      chat_messages: [{ uuid: 'a1', text: '안녕', content: [{ type: 'text', text: '안녕' }], sender: 'human', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', attachments: [], files: [], parent_message_uuid: '00000000-0000-4000-8000-000000000000' },
        { uuid: 'a2', text: '네', content: [{ type: 'text', text: '네' }], sender: 'assistant', created_at: '2026-10-01T00:01:00Z', updated_at: '2026-10-01T00:01:00Z', attachments: [], files: [], parent_message_uuid: 'a1' }] }];
    const bytes = new TextEncoder().encode(JSON.stringify(conv));
    const g = parseExport(bytes, undefined, { fileName: 'grokbot-conversations.json' });
    const g2 = parseExport(bytes, 'grokbot');
    const c = parseExport(bytes, 'claude');
    expect(g.detectedFormat).toBe('grokbot_json');
    expect(g2.detectedFormat).toBe('grokbot_json');
    expect(g.conversations[0]).toMatchObject({ sourceAi: 'grokbot', url: null });
    expect(c.conversations[0]!.sourceAi).toBe('claude');
  });
});

describe('A2. 수집기', () => {
  function setup(tt: T) {
    const ccRoot = join(tt.home, 'claude', 'projects');
    mkdirSync(join(ccRoot, '-Users-me-dev-x'), { recursive: true });
    putCollectorConfig(tt.core, { sources: [{ sourceAi: 'claude-code', root: ccRoot, enabled: true }, { sourceAi: 'codex', root: join(tt.home, 'nope'), enabled: true }] });
    const f = join(ccRoot, '-Users-me-dev-x', 's1.jsonl');
    writeFileSync(f, ccLine('s1', 0, 'user', '리팩터링 시작하자 '.repeat(50)) + ccLine('s1', 1, 'assistant', '좋아요 '.repeat(200)));
    return f;
  }
  it('dry-run 어림(파일만 보고, DB 안 바꿈) → classify:false 백필은 분류를 큐에 넣지 않음 → 대시보드에 claude-code가 보임', async () => {
    t = await makeCore();
    setup(t);
    const est = await t.json('POST', '/collector/backfill', { dryRun: true, classify: true });
    expect(est.status).toBe(200);
    const cc = est.body.sources.find((s: { sourceAi: string }) => s.sourceAi === 'claude-code');
    expect(cc).toMatchObject({ files: 1, filesUnread: 1, sessionsEstimated: 1 });
    expect(cc.bytesUnread).toBeGreaterThan(1000);
    expect(est.body.sources.find((s: { sourceAi: string }) => s.sourceAi === 'codex')).toMatchObject({ rootExists: false, files: 0 });
    expect(est.body.classification).toMatchObject({ sessions: 1, willClassify: true });
    expect(est.body.classification.inputTokens).toBeGreaterThan(900);
    expect((await t.json('POST', '/collector/backfill', { dryRun: true, classify: false })).body.classification).toMatchObject({ willClassify: false, costUsd: 0 });
    expect(Number(t.core.db.value('SELECT COUNT(*) FROM conversations'))).toBe(0);
    expect((await t.json('GET', '/dashboard')).body.collection.sources.some((s: { sourceAi: string }) => s.sourceAi === 'claude-code')).toBe(false);

    const job = await t.json('POST', '/collector/backfill', { classify: false });
    expect(job.status).toBe(202);
    await t.core.queue.idle();
    const jobs = (await t.json('GET', '/jobs?limit=100')).body.items as Array<{ type: string }>;
    expect(jobs.some((j) => /classif/.test(j.type))).toBe(false);
    const pending = Number(t.core.db.value("SELECT COUNT(*) FROM conversations WHERE source_ai='claude-code' AND classified_hash IS NULL"));
    expect(pending).toBe(1);
    const dash = (await t.json('GET', '/dashboard')).body;
    expect(dash.collection.sources.find((s: { sourceAi: string }) => s.sourceAi === 'claude-code')).toMatchObject({ methods: ['local_session'], health: 'ok' });
    expect(dash.collection.sources.find((s: { sourceAi: string }) => s.sourceAi === 'codex')).toBeUndefined(); // 읽은 것 없음
    expect(dash.counts.allTasks).toBeGreaterThanOrEqual(dash.counts.totalTasks);
    // 다 읽은 뒤 어림은 0
    expect((await t.json('POST', '/collector/backfill', { dryRun: true })).body.classification.sessions).toBe(0);
  });
  it('allTasks = totalTasks + 빠른 답변 + 보관 (예시 데이터)', async () => {
    t = await makeCore({ seeded: true });
    const c = (await t.json('GET', '/dashboard')).body.counts;
    expect(c.allTasks).toBe(Number(t.core.db.value('SELECT COUNT(*) FROM tasks')));
    expect(c.allTasks).toBe(c.totalTasks + c.quickQuestions + c.archived);
  });
});

const viaApp = (tt: T): typeof fetch => (async (input: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(input));
  return tt.app.request(u.pathname + u.search, { ...init, headers: { ...(init?.headers as Record<string, string> ?? {}), host: '127.0.0.1:4545' } });
}) as typeof fetch;
async function connect(tt: T, write?: boolean) {
  const server = createSubbrainMcpServer({ coreUrl: 'http://127.0.0.1:4545', fetchImpl: viaApp(tt), write });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args }) as { content: Array<{ text: string }>; structuredContent?: any; isError?: boolean }; // eslint-disable-line @typescript-eslint/no-explicit-any
    return { text: r.content.map((c) => c.text).join('\n'), sc: r.structuredContent, isError: !!r.isError };
  };
  return { client, call };
}

describe('B. AI 검색(MCP)', () => {
  it('엔진: /search kind 필터 · /conversations/:id?around=&window=', async () => {
    t = await makeCore({ seeded: true });
    const all = (await t.json('GET', '/search?q=%EC%B9%B4%ED%94%BC&limit=50')).body; // 카피
    const qq = (await t.json('GET', '/search?q=%EC%B9%B4%ED%94%BC&limit=50&kind=quick_question')).body;
    expect(qq.page.total).toBeLessThanOrEqual(all.page.total);
    for (const h of qq.items) if (h.task) expect(['quick_question']).toContain((await t.json('GET', `/tasks/${h.task.id}`)).body.kind);
    const conv = t.core.db.get<{ id: string }>('SELECT conversation_id id FROM messages GROUP BY conversation_id HAVING COUNT(*) >= 5 LIMIT 1')!;
    const mid = t.core.db.get<{ id: number; seq: number }>('SELECT id, seq FROM messages WHERE conversation_id=? ORDER BY seq LIMIT 1 OFFSET 2', conv.id)!;
    const r = (await t.json('GET', `/conversations/${conv.id}?around=${mid.id}&window=1`)).body;
    expect(r.messages.items.map((m: { id: number }) => m.id)).toContain(mid.id);
    expect(r.messages.items.length).toBe(3);
    expect((await t.json('GET', `/conversations/${conv.id}?around=999999999`)).status).toBe(404);
  });

  it('기본 읽기 전용(14개 읽기 도구), search_past_work 필터·출처·structuredContent·2,000자·cursor', async () => {
    t = await makeCore({ seeded: true });
    const { client, call } = await connect(t);
    expect((await client.listTools()).tools.map((x) => x.name).sort()).toEqual([...READ_TOOLS].sort());
    const r = await call('search_past_work', { query: '카피', limit: 30 });
    expect(r.isError).toBe(false);
    expect(r.text.length).toBeLessThanOrEqual(MAX_CHARS);
    expect(r.text).toMatch(/\[1\]/);
    expect(r.text).toContain('출처:');
    expect(r.sc.citations.length).toBeGreaterThan(0);
    expect(r.sc.citations[0]).toHaveProperty('conversationId');
    expect(r.sc.citations[0]).toHaveProperty('messageId');
    expect(r.sc.citations[0]).toHaveProperty('sourceAi');
    expect(r.sc.citations[0]).toHaveProperty('date');
    expect(r.sc.citations[0]).toHaveProperty('sourceUrl');
    if (r.sc.nextCursor) {
      expect(r.text).toContain('더 있음');
      const r2 = await call('search_past_work', { query: '카피', limit: 30, cursor: r.sc.nextCursor });
      expect(r2.sc.items[0]?.id).not.toBe(r.sc.items[0]?.id);
    }
    const f = await call('search_past_work', { query: '카피', source_ai: ['chatgpt'], from: '2026-01-01', to: '2026-12-31', kind: 'task' });
    for (const c of f.sc.citations) if (c.sourceAi) expect(c.sourceAi).toBe('chatgpt');
    expect((await call('search_past_work', { query: '카피', project: '없는프로젝트xyz' })).text).toContain('프로젝트가 없어요');
    // 모든 읽기 도구는 2,000자 이하
    for (const [name, args] of [['get_unfinished', { limit: 50 }], ['get_timeline', { from: '2026-01-01', to: '2026-12-31', limit: 50 }], ['recent_context', { days: 90, limit: 50 }]] as const) {
      const x = await call(name, args as Record<string, unknown>);
      expect(x.isError, name).toBe(false);
      expect(x.text.length, name).toBeLessThanOrEqual(MAX_CHARS);
      expect(x.sc, name).toHaveProperty('citations');
    }
  });

  it('get_conversation(around) · get_project · find_decisions(유효/대체) · 민감 가림 유지', async () => {
    t = await makeCore({ seeded: true });
    const { call } = await connect(t);
    const conv = t.core.db.get<{ id: string }>('SELECT conversation_id id FROM messages GROUP BY conversation_id HAVING COUNT(*) >= 5 LIMIT 1')!;
    const mid = t.core.db.get<{ id: number }>('SELECT id FROM messages WHERE conversation_id=? ORDER BY seq LIMIT 1 OFFSET 2', conv.id)!;
    const g = await call('get_conversation', { conversation_id: conv.id, around: mid.id, window: 1 });
    expect(g.isError).toBe(false);
    expect(g.text).toContain('데이터');
    expect(g.text).toContain(`#m${mid.id} ◀`);
    expect(g.sc.citations.some((c: { messageId: string }) => c.messageId === String(mid.id))).toBe(true);
    expect(g.text.length).toBeLessThanOrEqual(MAX_CHARS);

    const pname = String(t.core.db.value('SELECT name FROM projects LIMIT 1'));
    const p = await call('get_project', { project: pname });
    expect(p.isError).toBe(false);
    expect(p.sc.project.name).toBeTruthy();

    // 결정: 과제 하나에 유효 1 + 대체 1
    const task = t.core.db.get<{ id: string; title: string }>("SELECT id, title FROM tasks WHERE kind='task' AND status<>'보관' LIMIT 1")!;
    const cid = String(t.core.db.value('SELECT conversation_id FROM task_conversations WHERE task_id=? LIMIT 1', task.id));
    const addD = (id: string, name: string, valid: boolean, at: string) => t!.core.db.run("INSERT INTO objects(id,type,name,norm_name,ref_table,ref_id,properties_json,status,first_seen_at,last_seen_at,origin) VALUES (?,'decision',?,?,'tasks',?,?,'accepted',?,?,'llm')",
      id, name, name, task.id, JSON.stringify({ conversationId: cid, sourceAi: 'chatgpt', decidedAt: at, valid }), at, at);
    addD('obj_decision_t1', '배포는 Vercel로', true, '2026-09-20T10:00:00+09:00');
    addD('obj_decision_t0', '배포는 Netlify로', false, '2026-09-10T10:00:00+09:00');
    const d = await call('find_decisions', { query: task.title });
    const mine = d.sc.items.filter((x: { id: string }) => /^obj_decision_t[01]$/.test(x.id));
    expect(mine.map((x: { id: string; valid: boolean }) => [x.id, x.valid])).toEqual([['obj_decision_t1', true], ['obj_decision_t0', false]]);
    const vs = d.sc.items.map((x: { valid: boolean }) => x.valid);
    expect(vs.indexOf(false)).toBeGreaterThan(vs.lastIndexOf(true)); // 유효 먼저, 대체된 것 뒤
    expect(d.text).toContain('## 대체·취소됨');
    const d2 = await call('find_decisions', { query: task.title, include_superseded: false });
    expect(d2.sc.items.every((x: { valid: boolean }) => x.valid)).toBe(true);
    expect((await call('find_decisions', {})).isError).toBe(true);

    // 민감 프로젝트: 검색·대화에서 가림
    const tp = t.core.db.get<{ project_id: string }>('SELECT project_id FROM tasks WHERE id=?', task.id)!;
    if (tp.project_id) {
      expect((await t.json('PATCH', '/settings', { llm: { sensitiveProjectIds: [tp.project_id] } })).status).toBe(200);
      const g2 = await call('get_conversation', { conversation_id: cid });
      expect(g2.text).toContain('🔒');
    }
  });

  it('쓰기는 write:true일 때만', async () => {
    t = await makeCore({ seeded: true });
    const { client } = await connect(t, true);
    expect((await client.listTools()).tools.map((x) => x.name)).toContain('log_task');
  });
});
