#!/usr/bin/env node
// 서브브레인 목차(L1~L3) 스냅샷 → 마크다운 묶음(tgz). 엔진 /api/v1/toc*만 읽음(GET만, DB 직접 안 염, LLM 호출 없음, 원문(L4) 안 가져옴).
//   node scripts/toc-export.mjs [--core URL] [--out DIR] [--tar FILE] [--max-tasks N] [--include-quick]
// 결과(tgz 루트): index.md · projects/<id>.md · tasks/<id>.md · MANIFEST.json   (민감 🔒 프로젝트·과제는 파일을 만들지 않음, 사람 이름은 설정대로 가림)
// 기본: --out ~/.subbrain/toc-snapshot, --tar <out>/toc-latest.tgz (+ 시각이 붙은 사본 toc-<ts>.tgz). 임시 폴더에서 만들고 끝나면 정리.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const CORE = opt('core', process.env.SUBBRAIN_CORE ?? 'http://127.0.0.1:4545').replace(/\/+$/, '');
const OUT = resolve(opt('out', process.env.SUBBRAIN_TOC_OUT ?? join(homedir(), '.subbrain', 'toc-snapshot')));
const MAX_TASKS = Number(opt('max-tasks', '400'));
const get = async (path) => {
  const res = await fetch(`${CORE}/api/v1${path}`).catch(() => null);
  if (!res) { console.error(`엔진에 연결 못 했어요(${CORE}). 엔진을 켠 뒤 다시 실행하세요.`); process.exit(3); }
  if (!res.ok) { const j = await res.json().catch(() => null); const e = new Error(`${res.status} ${path} ${j?.error?.message ?? ''}`); e.status = res.status; throw e; }
  return res.json();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// local time with the system offset ("2026-11-16T17:30:00+09:00")
const kst = (d = new Date()) => {
  const off = -d.getTimezoneOffset(), a = Math.abs(off), p = (n) => String(n).padStart(2, '0');
  return new Date(d.getTime() + off * 60e3).toISOString().replace(/\.\d+Z$/, '') + `${off < 0 ? '-' : '+'}${p(Math.floor(a / 60))}:${p(a % 60)}`;
};

// ── 사람 이름 가림(MCP와 같은 규칙: 설정 ontology.showPersonNames가 꺼져 있으면 역할로)
async function makeMask() {
  const s = await get('/settings');
  if (s.ontology?.showPersonNames) return (t) => t;
  const people = await get('/objects?type=person&status=accepted,suggested&limit=200').catch(() => ({ items: [] }));
  const pairs = [];
  for (const p of people.items) {
    const role = String(p.properties?.['역할'] ?? p.properties?.role ?? '').trim();
    const label = `${role || '누군가'}(사람)`;
    for (const n of [p.name, ...(p.aliases ?? [])]) if (n && n.length >= 2 && n !== '나') pairs.push([n, label]);
  }
  pairs.sort((a, b) => b[0].length - a[0].length);
  if (!pairs.length) return (t) => t;
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(pairs.map(([n]) => esc(n)).join('|'), 'g'); const map = new Map(pairs);
  return (t) => t.replace(re, (m) => map.get(m) ?? m);
}

// ── 쪽 나눔을 끝까지 따라가 본문을 이어 붙임(헤더는 첫 쪽만, '더 있음' 줄은 뺌)
async function fetchAll(base, extra = '') {
  let offset = 0, header = null, body = [], last = null, locked = false, children = [];
  for (let page = 0; page < 60; page++) {
    const r = await get(`${base}?offset=${offset}${extra}`);
    last = r; locked = locked || !!r.locked;
    if (r.locked) return { text: r.text, children: [], locked: true };
    const lines = r.text.split('\n');
    const hi = lines.findIndex((l) => l.startsWith('다음 단계:'));
    const head = lines.slice(0, hi + 1), rest = lines.slice(hi + 1).filter((l) => !l.startsWith('… '));
    if (header === null) header = head;
    body.push(...rest); children.push(...r.children);
    if (!r.next) break;
    const m = /offset=(\d+)/.exec(r.next); if (!m || Number(m[1]) <= offset) break;
    offset = Number(m[1]); await sleep(40);
  }
  return { text: [...(header ?? []), ...body].join('\n'), children, locked, truncatedPages: last?.next ? true : false };
}

const tmp = mkdtempSync(join(tmpdir(), 'subbrain-toc-'));
mkdirSync(join(tmp, 'projects')); mkdirSync(join(tmp, 'tasks'));
const nowIso = kst();
const mask = await makeMask();
const banner = `> 스냅샷: ${nowIso} (한국시간) · 출처: 서브브레인 엔진 목차(/toc) · 읽기 전용 사본이에요(원문 대화는 포함하지 않음).`;
const W = (rel, text) => writeFileSync(join(tmp, rel), mask(text).replace(/\s+$/, '') + '\n');

// L1
const l1 = await fetchAll('/toc');
const l1lines = l1.text.split('\n');
const hi1 = l1lines.findIndex((l) => l.startsWith('다음 단계:'));
const projects = []; // {id,name,locked}
const idxLines = l1lines.slice(hi1 + 1).map((l) => {
  const m = /^(\d+)\. (\S+) \| ([^|]*) \|/.exec(l);
  if (!m) return l;
  const locked = l.includes('🔒');
  projects.push({ id: m[2], name: m[3].trim(), locked });
  return locked ? `${l} | (🔒 비공개 — 파일 없음)` : `${l} | → projects/${m[2]}.md`;
});
const taskIndex = []; // 프로젝트 파일에 나온 과제들
let nTasks = 0, nProjFiles = 0, nLocked = 0, skippedTasks = 0;
for (const p of projects) {
  if (p.locked) { nLocked++; continue; }
  let l2;
  try { l2 = await fetchAll(`/toc/project/${encodeURIComponent(p.id)}`); } catch (e) { console.error(`  ! 프로젝트 ${p.id}: ${e.message}`); continue; }
  if (l2.locked) { nLocked++; continue; }
  const lines = l2.text.split('\n');
  const out = lines.map((l) => {
    const m = /^(\d+)\. (task_\S+) \|/.exec(l);
    if (!m) return l.startsWith('다음 단계:') ? '다음 단계: 필요한 과제의 파일(아래 → 경로)만 여세요. 과제 파일은 ../tasks/<과제id>.md 예요.' : l;
    return l.includes('🔒') ? l : `${l} | → ../tasks/${m[2]}.md`;
  });
  W(`projects/${p.id}.md`, `${banner}\n상위: ../index.md\n\n${out.join('\n')}`);
  nProjFiles++;
  for (const c of l2.children) taskIndex.push({ id: c.id, project: p.id });
  await sleep(40);
}
// L3 (열린 과제부터 — L2가 진행·멈춤·완료 순이므로 앞에서부터)
for (const t of taskIndex.slice(0, MAX_TASKS)) {
  let l3;
  try { l3 = await fetchAll(`/toc/task/${encodeURIComponent(t.id)}`); } catch (e) { console.error(`  ! 과제 ${t.id}: ${e.message}`); continue; }
  if (l3.locked) { nLocked++; continue; }
  const lines = l3.text.split('\n');
  const out = lines.map((l) => l.startsWith('다음 단계:') ? '다음 단계: 이 과제 정보로 충분하면 멈추세요. 원문(대화 내용)은 이 사본에 없고, 코어 컴퓨터의 서브브레인(MCP toc_conversation_excerpt, 대화 id)에서만 읽어요.' : l);
  W(`tasks/${t.id}.md`, `${banner}\n상위: ../projects/${t.project}.md\n\n${out.join('\n')}`);
  nTasks++; await sleep(40);
}
skippedTasks = Math.max(0, taskIndex.length - MAX_TASKS);
const header1 = l1lines.slice(0, hi1).join('\n');
W('index.md', `${banner}\n\n# 서브브레인 목차 (L1 — 항상 여기서 시작)\n\n${header1}\n\n읽는 순서: ① 이 파일에서 관련 프로젝트 하나 고르기 → ② projects/<프로젝트id>.md → ③ tasks/<과제id>.md. 필요한 것만 여세요. 스냅샷이 오래됐으면(위 시각) 최신이 아닐 수 있다고 사용자에게 알리세요.\n\n${idxLines.join('\n')}`);
const manifest = { schema: 'subbrain-toc-snapshot/1', generatedAt: nowIso, generatedAtEpochMs: Date.now(), core: CORE, projects: projects.length, projectFiles: nProjFiles, taskFiles: nTasks, lockedSkipped: nLocked, tasksNotExported: skippedTasks, includesRawConversations: false };
writeFileSync(join(tmp, 'MANIFEST.json'), JSON.stringify(manifest, null, 1) + '\n');

mkdirSync(OUT, { recursive: true });
const ts = nowIso.replace(/[-:+]/g, '').replace('T', '-').slice(0, 15);
const stamped = join(OUT, `toc-${ts}.tgz`);
const latest = resolve(opt('tar', join(OUT, 'toc-latest.tgz')));
execFileSync('/usr/bin/tar', ['czf', stamped, '-C', tmp, 'index.md', 'projects', 'tasks', 'MANIFEST.json'], { stdio: ['ignore', 'inherit', 'inherit'] }); // 표준입력 닫음(예전에 tar가 멈춘 적 있음)
if (latest !== stamped) copyFileSync(stamped, latest);
rmSync(tmp, { recursive: true, force: true }); // 임시 폴더(내가 만든 것)만 정리
console.log(`✅ 스냅샷 ${nowIso}: 프로젝트 ${projects.length}(파일 ${nProjFiles}, 🔒 ${nLocked}) · 과제 파일 ${nTasks}${skippedTasks ? ` (+${skippedTasks}개는 --max-tasks 때문에 제외)` : ''}`);
console.log(`tgz: ${latest} (${statSync(latest).size} bytes)\n사본: ${stamped}`);
