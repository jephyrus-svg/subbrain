import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Core } from '../src/core.ts';
import { createApp } from '../src/server.ts';
import { seed } from '../src/seed.ts';
import { setNow } from '../src/util/time.ts';

export const NOW = '2026-09-30T08:30:00+09:00';

/** 임시 홈 + (선택) 예시 데이터. 시계는 2026-09-30 08:30 KST로 고정 */
export async function makeCore(opts: { seeded?: boolean } = {}) {
  setNow(NOW);
  const home = mkdtempSync(join(tmpdir(), 'subbrain-test-'));
  const core = new Core({ home, vaultPath: join(home, 'vault'), port: 4545 });
  if (opts.seeded) await seed(core, { vault: false });
  const app = createApp(core, { checkHost: true });
  const H = { host: '127.0.0.1:4545' };
  const req = (path: string, init: RequestInit = {}) => app.request(`/api/v1${path}`, { ...init, headers: { ...H, ...(init.headers as Record<string, string> | undefined) } });
  const json = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await req(path, { method, headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json().catch(() => null)) as any, res }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const close = () => { core.close(); rmSync(home, { recursive: true, force: true }); setNow(null); };
  return { core, app, home, req, json, close };
}
