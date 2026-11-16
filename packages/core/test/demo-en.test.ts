/** English demo dataset + English generated text (SUBBRAIN_LANG=en). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Core } from '../src/core.ts';
import { createApp } from '../src/server.ts';
import { seed, buildSpecs, seedDataset } from '../src/seed.ts';
import { setNow } from '../src/util/time.ts';
import { tocConversation, tocIndex, tocProject, tocTask } from '../src/services/toc.ts';

const HANGUL = /[\uac00-\ud7a3]/;
/** Korean is allowed only in internal enum fields that the web UI translates itself */
const ENUM_KEYS = new Set(['status', 'labelKo', 'value', 'from', 'to']);
function hangulLeaks(x: unknown, key = '', out: string[] = []): string[] {
  if (Array.isArray(x)) x.forEach((v) => hangulLeaks(v, key, out));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) hangulLeaks(v, k, out);
  else if (typeof x === 'string' && HANGUL.test(x) && !ENUM_KEYS.has(key)) out.push(`${key}: ${x.slice(0, 80)}`);
  return out;
}

describe('English demo', () => {
  let home = '', core: Core, prev: string | undefined;
  let req: (p: string) => Promise<unknown>;
  beforeAll(async () => {
    prev = process.env.SUBBRAIN_LANG; process.env.SUBBRAIN_LANG = 'en';
    setNow('2026-11-17T10:00:00+09:00');
    home = mkdtempSync(join(tmpdir(), 'subbrain-en-'));
    core = new Core({ home, vaultPath: join(home, 'vault'), port: 4545 });
    await seed(core, { vault: false, lang: 'en', today: '2026-11-17' });
    const app = createApp(core, { checkHost: true });
    req = async (p) => (await app.request(`/api/v1${p}`, { headers: { host: '127.0.0.1:4545' } })).json();
  });
  afterAll(() => { core.close(); rmSync(home, { recursive: true, force: true }); setNow(null); process.env.SUBBRAIN_LANG = prev; if (prev === undefined) delete process.env.SUBBRAIN_LANG; });

  it('dataset is fictional English with no Korean text', () => {
    const specs = buildSpecs(seedDataset('en', '2026-11-17'));
    expect(specs.length).toBeGreaterThan(50);
    const leaks = specs.flatMap((t) => [t.title, t.summary ?? '', t.next ?? '', ...(t.detail ?? []), ...t.convs.map((c) => c.title)]).filter((s) => HANGUL.test(s));
    expect(leaks).toEqual([]);
    buildSpecs(seedDataset('ko')); // restore the module default for other tests
  });

  it('main screens return English generated text', async () => {
    for (const p of ['/dashboard', '/board', '/tasks', '/tasks/task_tp_pricing', '/tasks/task_tp_pricing/flow', '/tasks/task_tp_pricing/why-stalled', '/tasks/task_tp_pricing/resume-prompt',
      '/digests/2026-11-17', '/review/weekly', '/projects/prj_tidepool', '/graph', '/ontology', '/suggestions', '/merge-suggestions', '/project-suggestions']) {
      const body = await req(p);
      expect(hangulLeaks(body), p).toEqual([]);
    }
    const digest = await req('/digests/2026-11-17') as { title: string; yesterday: { narrative: string } };
    expect(digest.title).toBe('Tuesday morning, Nov 17');
    expect(digest.yesterday.narrative).toMatch(/^Yesterday/);
  });

  it('TOC (MCP) text is English', () => {
    const conv = core.db.value<string>("SELECT conversation_id FROM task_conversations WHERE task_id='task_tp_pricing' LIMIT 1")!;
    const parts = [tocIndex(core, {}), tocProject(core, 'prj_tidepool'), tocTask(core, 'task_tp_pricing'), tocConversation(core, conv)].map((r) => JSON.stringify(r));
    expect(parts[0]).toContain('[Subbrain TOC L1]');
    expect(parts.filter((t) => HANGUL.test(t)).map((t) => t.match(/.{0,40}[\uac00-\ud7a3]+.{0,40}/)?.[0])).toEqual([]);
  });
});
