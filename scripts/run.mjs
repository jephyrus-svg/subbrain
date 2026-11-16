#!/usr/bin/env node
// npm run demo   → core + web on the fake demo data in .demo/ (no key, no scheduler)
// npm run app    → core + web on your own data folder (~/.subbrain or SUBBRAIN_HOME)
// npm run import -- <export.zip|conversations.json|takeout.zip> [--no-classify]   → into your own data folder
// Port: SUBBRAIN_PORT (default 4545). Language: --lang ko or SUBBRAIN_LANG=ko (default en) — demo dataset,
// generated text (morning summary, next steps, TOC) and classification prompts follow it.
// The demo re-seeds on every start so its dates stay relative to today; pass --keep to reuse the existing .demo data.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [mode = 'demo', ...args] = process.argv.slice(2);
const li = args.indexOf('--lang');
const lang = (li >= 0 ? args[li + 1] : process.env.SUBBRAIN_LANG ?? 'en')?.toLowerCase().startsWith('ko') ? 'ko' : 'en';
const keep = args.includes('--keep');
const rest = args.filter((a, i) => a !== '--keep' && i !== li && i !== li + 1);
const tsx = join(ROOT, 'packages', 'core', 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
const cli = join(ROOT, 'packages', 'core', 'src', 'cli.ts');
if (!existsSync(tsx)) { console.error('Dependencies are missing — run `npm run setup` first.'); process.exit(1); }
const port = process.env.SUBBRAIN_PORT ?? '4545';
const env = { ...process.env, NODE_NO_WARNINGS: '1', SUBBRAIN_LANG: lang };
const url = `http://127.0.0.1:${port}${lang === 'ko' ? '/?lang=ko' : ''}`;

if (!existsSync(join(ROOT, 'web', 'dist', 'index.html')) && mode !== 'import') {
  console.log('→ Building the web app (first run)…');
  const pnpm = spawnSync('pnpm', ['--version']).status === 0 ? ['pnpm'] : ['corepack', 'pnpm'];
  spawnSync(pnpm[0], [...pnpm.slice(1), '--filter', '@subbrain/web', 'build:live'], { cwd: ROOT, stdio: 'inherit' });
}

let argv;
if (mode === 'demo') {
  const DEMO = join(ROOT, '.demo');
  // demo is always offline: never use an LLM key from the environment (rule classifier only, zero cost)
  for (const k of ['SUBBRAIN_LLM_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY']) delete env[k];
  // English demo = a fictional indie developer; Korean demo = the original Korean sample set
  if (!keep || !existsSync(join(DEMO, 'subbrain.db'))) {
    const r = spawnSync(tsx, [cli, 'seed', '--home', DEMO, '--vault', join(DEMO, 'vault'), '--lang', lang], { stdio: 'inherit', env });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  argv = [cli, 'start', '--home', DEMO, '--vault', join(DEMO, 'vault'), '--port', port, '--no-scheduler', ...rest];
  console.log(lang === 'ko' ? `데모 모드 — 가짜 예시 데이터만 써요. 열기: ${url}` : `Demo mode — fictional sample data only. Open ${url}  (Korean demo: npm run demo -- --lang ko)`);
} else if (mode === 'app') {
  argv = [cli, 'start', '--port', port, ...rest];
  console.log(lang === 'ko' ? `열기: ${url}` : `Open ${url}  (Korean UI: ?lang=ko)`);
} else if (mode === 'import') {
  argv = [cli, 'import', ...rest];
} else { console.error('usage: node scripts/run.mjs demo|app|import <file>'); process.exit(1); }
const child = spawn(tsx, argv, { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s));
