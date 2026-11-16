#!/usr/bin/env node
// Subbrain one-command setup:  npm run setup   (or: pnpm setup / node scripts/setup.mjs)
//   1. checks Node (22.13+, node:sqlite with FTS5)
//   2. installs dependencies (pnpm, via corepack if needed)
//   3. builds the web app
//   4. fills a demo data folder (.demo/) with clearly fake sample data
//   5. optionally asks for a Gemini API key (skip = demo / rule-based classifier only, no cost)
// Flags: --yes (no questions, skip key) · --skip-install · --skip-build · --lang ko
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const KO = has('--lang') ? args[args.indexOf('--lang') + 1] === 'ko' : (process.env.SUBBRAIN_LANG ?? '').startsWith('ko');
const say = (en, ko) => console.log(KO ? ko : en);
const fail = (en, ko) => { console.error(`\n✗ ${KO ? ko : en}`); process.exit(1); };
const run = (cmd, a, opts = {}) => { const r = spawnSync(cmd, a, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', ...opts }); return r.status === 0; };

// 1. Node
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) fail(`Node 22.13+ is required (you have ${process.versions.node}). Install Node 22 LTS (e.g. \`nvm install 22\`).`, `Node 22.13 이상이 필요해요(지금 ${process.versions.node}). Node 22 LTS를 설치해 주세요(예: \`nvm install 22\`).`);
try {
  const { DatabaseSync } = await import('node:sqlite');
  const d = new DatabaseSync(':memory:'); d.exec("CREATE VIRTUAL TABLE t USING fts5(x, tokenize='trigram')"); d.close();
} catch (e) { fail(`node:sqlite with FTS5 trigram is not available in this Node build: ${e.message}`, `이 Node에서 node:sqlite FTS5 trigram을 쓸 수 없어요: ${e.message}`); }
say(`✓ Node ${process.versions.node} (node:sqlite + FTS5)`, `✓ Node ${process.versions.node} (node:sqlite + FTS5)`);

// 2. dependencies
const pnpm = spawnSync('pnpm', ['--version'], { shell: process.platform === 'win32' }).status === 0 ? ['pnpm'] : ['corepack', 'pnpm'];
if (!has('--skip-install')) {
  say('\n→ Installing dependencies…', '\n→ 의존성 설치 중…');
  if (!run(pnpm[0], [...pnpm.slice(1), 'install'])) fail('pnpm install failed. Try `corepack enable` and run again.', 'pnpm install 실패. `corepack enable` 후 다시 실행해 주세요.');
}

// 3. web build (served by the core on the same port)
if (!has('--skip-build')) {
  say('\n→ Building the web app…', '\n→ 웹앱 빌드 중…');
  if (!run(pnpm[0], [...pnpm.slice(1), '--filter', '@subbrain/web', 'build:live'])) fail('Web build failed.', '웹 빌드 실패.');
}

// 4. demo data
const tsx = join(ROOT, 'packages', 'core', 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
const cli = join(ROOT, 'packages', 'core', 'src', 'cli.ts');
const DEMO = join(ROOT, '.demo');
say('\n→ Creating demo data in .demo/ (fake sample projects, no real chats)…', '\n→ .demo/ 에 예시 데이터 만드는 중(가짜 예시, 실제 대화 없음)…');
if (!run(tsx, [cli, 'seed', '--home', DEMO, '--vault', join(DEMO, 'vault'), '--lang', KO ? 'ko' : 'en'], { env: { ...process.env, NODE_NO_WARNINGS: '1', SUBBRAIN_LANG: KO ? 'ko' : 'en' } })) fail('Seeding demo data failed.', '예시 데이터 만들기 실패.');

// 5. optional Gemini key (for your real data folder)
const REAL = process.env.SUBBRAIN_HOME ?? join(homedir(), '.subbrain');
let keySaved = false;
if (!has('--yes') && process.stdin.isTTY) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  say(`\nOptional: a Gemini API key lets Subbrain classify YOUR imported chats with an LLM (cheap flash-lite model, daily cost cap $10 by default).
Without a key everything still works with the built-in rule classifier (free, offline).
Get a key at https://aistudio.google.com/apikey — it is stored only in ${join(REAL, 'secrets.json')} (chmod 600).`,
  `\n선택: Gemini API 키를 넣으면 가져온 내 대화를 LLM으로 분류해요(저렴한 flash-lite, 기본 하루 상한 $10).
키가 없어도 내장 규칙 분류기로 모두 동작해요(무료, 오프라인).
키 발급: https://aistudio.google.com/apikey — ${join(REAL, 'secrets.json')} 에만 저장돼요(권한 600).`);
  const key = (await rl.question(KO ? 'Gemini API 키 (건너뛰려면 Enter): ' : 'Gemini API key (Enter to skip): ')).trim();
  rl.close();
  if (key) {
    keySaved = run(tsx, [cli, 'key', 'set', 'google', '--home', REAL], { env: { ...process.env, SUBBRAIN_SETUP_KEY: key, NODE_NO_WARNINGS: '1' } });
    if (!keySaved) say('! Could not save the key — you can add it later in the app settings.', '! 키를 저장하지 못했어요 — 나중에 앱 설정에서 넣을 수 있어요.');
  }
}

say(`
✓ Setup complete.

  Demo (fake sample data, no key needed):   npm run demo      → http://127.0.0.1:4545
  Your own data (${REAL}):                  npm run app       → http://127.0.0.1:4545
  Korean: npm run demo -- --lang ko · npm run app -- --lang ko  (UI only: add ?lang=ko to the URL)

Import your chats (into your own data folder, not the demo):
  ChatGPT  Settings → Data controls → Export data → wait for the email → download the ZIP
           npm run import -- ~/Downloads/chatgpt-export.zip
  Claude   Settings → Privacy → Export data → download the ZIP from the email
           npm run import -- ~/Downloads/claude-export.zip
  Gemini   takeout.google.com → select only "My Activity" → "Gemini Apps" → export → download the ZIP
           npm run import -- ~/Downloads/takeout.zip
  ${keySaved ? 'LLM classification: Gemini key saved.' : 'No key: imports are classified by the free rule classifier. Add a key later in Settings or with `npm run setup`.'}
  Add --no-classify to import without classifying (no cost).
`, `
✓ 설치 완료.

  데모(가짜 예시 데이터, 키 불필요):   npm run demo -- --lang ko   → http://127.0.0.1:4545/?lang=ko
  내 데이터(${REAL}):                  npm run app    → http://127.0.0.1:4545
  한국어: npm run app -- --lang ko (화면만 바꾸려면 주소 끝에 ?lang=ko)

내 대화 가져오기(데모가 아니라 내 데이터 폴더로):
  ChatGPT  설정 → 데이터 제어 → 데이터 내보내기 → 메일의 ZIP 다운로드 → npm run import -- ~/Downloads/chatgpt-export.zip
  Claude   설정 → 개인정보 → 데이터 내보내기 → 메일의 ZIP 다운로드 → npm run import -- ~/Downloads/claude-export.zip
  Gemini   takeout.google.com → "내 활동" → "Gemini 앱"만 선택 → ZIP 다운로드 → npm run import -- ~/Downloads/takeout.zip
  ${keySaved ? 'LLM 분류: Gemini 키 저장됨.' : '키 없음: 가져온 대화는 무료 규칙 분류기로 분류돼요. 키는 나중에 설정에서 넣을 수 있어요.'}
  분류 없이 넣으려면 --no-classify (비용 0).
`);
