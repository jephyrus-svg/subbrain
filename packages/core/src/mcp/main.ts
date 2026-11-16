/**
 * 1.8.0 MCP 서버 실행: STDIO(Claude Desktop·Claude Code가 띄움) 또는 Streamable HTTP(127.0.0.1만, 상태 없음).
 *   subbrain mcp [--core http://127.0.0.1:4545] [--write | --read-only] [--source-ai claude]   (1.10.0 기본 읽기 전용)
 *   subbrain mcp --http [--port 4547] ...
 * STDIO 모드에서는 stdout에 프로토콜 말고는 아무것도 쓰지 않는다(로그는 stderr).
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { SessionResponse } from '@subbrain/shared';
import { CoreError, createCoreClient, createSubbrainMcpServer, type SubbrainMcpOptions } from './server.ts';

export async function runStdio(o: SubbrainMcpOptions): Promise<void> {
  const server = createSubbrainMcpServer(o);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`[subbrain-mcp] STDIO 준비 · 코어 ${o.coreUrl} · 쓰기 ${o.write === true ? '켜짐' : '꺼짐(읽기 전용)'}\n`);
}

/** 상태 없는 Streamable HTTP. 요청마다 서버·전송을 새로 만듦(세션 없음). DNS 리바인딩 막기: Host·Origin 검사 */
export function createHttpApp(o: SubbrainMcpOptions & { port: number; /** false = 토큰 검사 끔(시험용) */ auth?: boolean }): Hono {
  const app = new Hono();
  const hosts = [`127.0.0.1:${o.port}`, `localhost:${o.port}`];
  const cache = new Map<string, { at: number; write: boolean }>();
  app.all('/mcp', async (c) => {
    // 1.9.0 토큰 인증: kind 'mcp' 페어링 토큰(Authorization: Bearer). 코어 GET /session으로 확인(30초 캐시). STDIO는 그대로(토큰 없음)
    let token: string | undefined;
    if (o.auth !== false) {
      const m = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
      const deny = (msg: string, status: 401 | 403 = 401) => c.json({ jsonrpc: '2.0', error: { code: -32001, message: msg }, id: null }, status, status === 401 ? { 'WWW-Authenticate': 'Bearer realm="subbrain"' } : {});
      if (!m) return deny('서브브레인 MCP 토큰이 필요해요(Authorization: Bearer sbt_…). `subbrain mcp pair`로 받으세요.');
      token = m[1]!;
      let hit = cache.get(token);
      if (!hit || Date.now() - hit.at > 30_000) {
        try {
          const s = await createCoreClient({ ...o, token })<SessionResponse>('GET', '/session');
          if (s.kind !== 'mcp') return deny('MCP용 토큰이 아니에요.', 403);
          hit = { at: Date.now(), write: s.scopes.includes('mcp_write') };
          cache.set(token, hit);
        } catch (e) { cache.delete(token); return deny(e instanceof CoreError ? e.message : e instanceof Error ? e.message : String(e), e instanceof CoreError && e.status === 403 ? 403 : 401); }
      }
      return handle({ ...o, token, write: o.write !== false && hit.write }, c.req.raw);
    }
    return handle(o, c.req.raw);
  });
  async function handle(opts: SubbrainMcpOptions, req: Request) {
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, enableDnsRebindingProtection: true, allowedHosts: hosts });
    const server = createSubbrainMcpServer(opts);
    await server.connect(transport);
    return transport.handleRequest(req);
  }
  app.get('/', (c) => c.text('subbrain MCP — POST /mcp (Streamable HTTP)'));
  return app;
}
export function runHttp(o: SubbrainMcpOptions & { port: number; auth?: boolean }): { close: () => void } {
  const s = serve({ fetch: createHttpApp(o).fetch, port: o.port, hostname: '127.0.0.1' });
  process.stderr.write(`[subbrain-mcp] Streamable HTTP http://127.0.0.1:${o.port}/mcp · 코어 ${o.coreUrl} · 쓰기 ${o.write === true ? '켜짐' : '꺼짐(읽기 전용)'}\n`);
  return { close: () => s.close() };
}

/** subbrain mcp pair [--write] — 코어(웹 세션)에서 코드를 받아 바로 완료하고 토큰을 한 번 보여 줌(HTTP 모드 클라이언트 설정에 붙여넣기) */
export async function pairMcp(o: { coreUrl: string; write: boolean; name: string }): Promise<{ token: string; tokenId: string; scopes: string[] }> {
  const call = createCoreClient({ coreUrl: o.coreUrl });
  const start = await call<{ code: string }>('POST', '/pairing', { kind: 'mcp', name: o.name, allowWrite: o.write });
  const done = await call<{ token: string; client: { tokenId: string; scopes: string[] } }>('POST', '/pairing/complete', { code: start.code, client: { kind: 'mcp', name: o.name, version: '1.9.0' } });
  return { token: done.token, tokenId: done.client.tokenId, scopes: done.client.scopes };
}
