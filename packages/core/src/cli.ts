#!/usr/bin/env node
/** subbrain CLI (§13): start | seed | import <파일> | regenerate-vault | mocks   (--dev: 데이터를 app/.data 아래에 둠) */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Core, type CoreOptions } from './core.ts';
import { consolidateProjectSuggestions } from './services/project-suggestions.ts';
import { createApp } from './server.ts';
import { Scheduler } from './scheduler.ts';
import { createImport, getImport, startImport } from './services/imports.ts';
import { seed } from './seed.ts';
import { L, serverLang } from './util/lang.ts';
import { dumpMocks } from './dump-mocks.ts';
import { backfillRulesIfMissing, enqueueOntologyExtract, estimateOntologyCost, ontologyStatus } from './ontology/job.ts';
import { collectorConfig, collectorStatus, putCollectorConfig, startCollectorJob, watcherFor } from './collector/collector.ts';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const cmd = args[0] ?? 'start';
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

function coreOptions(): CoreOptions {
  const o: CoreOptions = {};
  if (flag('dev')) { o.home = process.env.SUBBRAIN_HOME ?? join(APP_DIR, '.data'); o.vaultPath = process.env.SUBBRAIN_VAULT ?? join(APP_DIR, '.data', 'vault'); }
  if (opt('home')) o.home = resolve(opt('home')!);
  if (opt('vault')) o.vaultPath = resolve(opt('vault')!);
  if (opt('port')) o.port = Number(opt('port'));
  return o;
}

async function main(): Promise<void> {
  if (cmd === 'start') {
    const core = new Core(coreOptions());
    const app = createApp(core, { webDist: join(APP_DIR, 'web', 'dist') });
    const scheduler = new Scheduler(core);
    const server = serve({ fetch: app.fetch, port: core.port, hostname: '127.0.0.1' }, (info) => {
      console.log(L(`[subbrain] 코어 실행 중 → http://127.0.0.1:${info.port}/api/v1  (데이터: ${core.home}, 볼트: ${core.settings.get().vault.path})`, `[subbrain] Core running → http://127.0.0.1:${info.port}/api/v1  (data: ${core.home}, vault: ${core.settings.get().vault.path})`));
      console.log(`[subbrain] ${core.llmStatusLine()}`);
    });
    if (!flag('no-scheduler')) scheduler.start();
    // 1.5.0 로컬 세션 수집기: 설정에서 켜 둔 경우만 감시(PUT /collector/config 또는 `collector watch on`)
    watcherFor(core).sync();
    // 1.7.1 v7 이전 데이터: 과제 객체가 없으면 규칙 온톨로지 보충(LLM 없음, 멱등)
    try { const b = backfillRulesIfMissing(core); if (b.ran) console.log(L(`[subbrain] 온톨로지 규칙 보충: 과제 ${b.tasks}개 · 관계 ${b.linksCreated}개`, `[subbrain] Relations backfilled by rules: ${b.tasks} tasks · ${b.linksCreated} links`)); } catch (e) { console.error(L('[subbrain] 온톨로지 보충 실패', '[subbrain] Relation backfill failed'), e); }
    if (watcherFor(core).watching) console.log(L('[subbrain] 로컬 세션 감시 중 (Claude Code · Codex)', '[subbrain] Watching local sessions (Claude Code · Codex)'));
    core.vault.ensureReadme();
    // 1.2.0 이전 버전이 만든 비슷한 새 프로젝트 제안을 한 번 합친다(이후엔 분류 실행이 끝날 때마다)
    try { const r = consolidateProjectSuggestions(core); if (r.merged) console.log(L(`[subbrain] 비슷한 새 프로젝트 제안 ${r.merged}개를 합쳤어요${r.attachedToAccepted ? ` (수락된 프로젝트에 과제 ${r.attachedToAccepted}개 연결)` : ''}`, `[subbrain] Merged ${r.merged} similar new-project suggestions${r.attachedToAccepted ? ` (${r.attachedToAccepted} tasks attached to accepted projects)` : ''}`)); }
    catch (e) { console.warn(L(`[subbrain] 프로젝트 제안 합치기 실패: ${e instanceof Error ? e.message : String(e)}`, `[subbrain] Merging project suggestions failed: ${e instanceof Error ? e.message : String(e)}`)); }
    const stop = () => { watcherFor(core).stop(); scheduler.stop(); server.close(); core.close(); process.exit(0); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return;
  }
  if (cmd === 'key') {
    // subbrain key set <google|anthropic|openai|xai> [--home <dir>]  — reads the key from SUBBRAIN_SETUP_KEY or stdin (never from argv, so it stays out of shell history)
    const provider = args[2] as 'google' | 'anthropic' | 'openai' | 'xai' | undefined;
    if (args[1] !== 'set' || !provider || !['google', 'anthropic', 'openai', 'xai'].includes(provider)) throw new Error('usage: subbrain key set <google|anthropic|openai|xai> [--home <dir>]  (key via SUBBRAIN_SETUP_KEY or stdin)');
    let key = process.env.SUBBRAIN_SETUP_KEY ?? '';
    if (!key) { const chunks: Buffer[] = []; for await (const c of process.stdin) chunks.push(c as Buffer); key = Buffer.concat(chunks).toString('utf8'); }
    key = key.trim();
    if (!key) throw new Error('no key given');
    const core = new Core(coreOptions());
    core.settings.setApiKey(provider, key);
    core.settings.patch({ llm: { provider, model: null } } as Parameters<typeof core.settings.patch>[0]);
    console.log(`[subbrain] saved ${provider} key to ${join(core.home, 'secrets.json')} (0600) and selected ${provider} as the classifier`);
    core.close();
    return;
  }
  if (cmd === 'collector') {
    // subbrain collector status | backfill [--source claude-code|codex] [--claude-root 경로] [--codex-root 경로] [--classify] | watch on|off
    const sub = args[1] ?? 'status';
    const core = new Core(coreOptions());
    const roots: Array<['claude-code' | 'codex', string | undefined]> = [['claude-code', opt('claude-root')], ['codex', opt('codex-root')]];
    if (roots.some(([, r]) => r)) putCollectorConfig(core, { sources: collectorConfig(core).sources.map((s) => ({ ...s, root: roots.find(([a]) => a === s.sourceAi)?.[1] ?? s.root })) });
    if (sub === 'watch') putCollectorConfig(core, { enabled: args[2] !== 'off' });
    if (sub === 'backfill' && flag('estimate')) {
      // 1.10.0 subbrain collector backfill --estimate [--source …] [--classify]
      const { estimateCollectorBackfill } = await import('./collector/collector.ts');
      const e = estimateCollectorBackfill(core, { sourceAi: opt('source') as 'claude-code' | 'codex' | undefined, classify: flag('classify') ? true : flag('no-classify') ? false : undefined });
      for (const x of e.sources) console.log(L(`  ${x.sourceAi.padEnd(11)} ${x.rootExists ? '' : '(폴더 없음) '}${x.root} — 파일 ${x.files}(안 읽은 ${x.filesUnread}) · 안 읽은 ${(x.bytesUnread / 1e6).toFixed(1)}/${(x.bytesTotal / 1e6).toFixed(1)} MB · 대화 약 ${x.sessionsEstimated}개`, `  ${x.sourceAi.padEnd(11)} ${x.rootExists ? '' : '(folder missing) '}${x.root} — files ${x.files} (unread ${x.filesUnread}) · unread ${(x.bytesUnread / 1e6).toFixed(1)}/${(x.bytesTotal / 1e6).toFixed(1)} MB · ~${x.sessionsEstimated} chats`));
      const c = e.classification;
      console.log(L(`[subbrain] 백필 어림: DB +${e.dbGrowthMbEstimated} MB · 읽기 약 ${e.secondsEstimated}초 · 분류 ${c.willClassify ? `세션 ${c.sessions}개 · 입력 ~${Math.round(c.inputTokens / 1000)}k / 출력 ~${Math.round(c.outputTokens / 1000)}k 토큰 · ${c.model ?? '-'} · ${c.costUsd === null ? '가격 모름' : '$' + c.costUsd.toFixed(2)}` : '안 함(비용 0 · 설정 또는 --no-classify)'}\n  ${c.note}`, `[subbrain] Backfill estimate: DB +${e.dbGrowthMbEstimated} MB · ~${e.secondsEstimated}s to read · classification ${c.willClassify ? `${c.sessions} sessions · in ~${Math.round(c.inputTokens / 1000)}k / out ~${Math.round(c.outputTokens / 1000)}k tokens · ${c.model ?? '-'} · ${c.costUsd === null ? 'price unknown' : '$' + c.costUsd.toFixed(2)}` : 'off (cost 0 · settings or --no-classify)'}\n  ${c.note}`));
      core.close();
      return;
    }
    if (sub === 'backfill' || sub === 'scan') {
      const src = opt('source') as 'claude-code' | 'codex' | undefined;
      const t0 = Date.now();
      const jobId = startCollectorJob(core, sub, { sourceAi: src, classify: flag('classify') ? true : flag('no-classify') ? false : undefined });
      await core.queue.idle();
      const j = core.queue.get(jobId);
      console.log(L(`[subbrain] ${sub} ${j?.state} — ${((Date.now() - t0) / 1000).toFixed(1)}초${j?.error ? ` (${j.error})` : ''}${flag('classify') ? ' · 분류도 끝냄' : ' · 분류는 안 함(--classify로 함께, 또는 웹에서 분류 실행)'}`, `[subbrain] ${sub} ${j?.state} — ${((Date.now() - t0) / 1000).toFixed(1)}s${j?.error ? ` (${j.error})` : ''}${flag('classify') ? ' · classified too' : ' · not classified (add --classify, or run classification from the web UI)'}`));
    }
    const st = collectorStatus(core, false);
    console.log(L(`[subbrain] 수집기: 감시 ${st.config.enabled ? '켜짐(코어 start 때 시작)' : '꺼짐'} · 가린 비밀·개인정보 ${st.redactedSecrets}개`, `[subbrain] Collector: watching ${st.config.enabled ? 'on (starts with core start)' : 'off'} · ${st.redactedSecrets} secrets/personal details redacted`));
    for (const s of st.sources) console.log(L(`  ${s.sourceAi.padEnd(11)} ${s.rootExists ? '' : '(폴더 없음) '}${s.root} — 파일 ${s.files} · ${(s.bytesIngested / 1e6).toFixed(1)}/${(s.bytesTotal / 1e6).toFixed(1)} MB 읽음 · 대화 ${s.sessions} · backfill ${s.backfill.state}${s.errors.length ? ` · 오류 ${s.errors.length}` : ''}`, `  ${s.sourceAi.padEnd(11)} ${s.rootExists ? '' : '(folder missing) '}${s.root} — files ${s.files} · ${(s.bytesIngested / 1e6).toFixed(1)}/${(s.bytesTotal / 1e6).toFixed(1)} MB read · chats ${s.sessions} · backfill ${s.backfill.state}${s.errors.length ? ` · errors ${s.errors.length}` : ''}`));
    core.close();
    return;
  }
  if (cmd === 'mcp') {
    // 1.8.0 subbrain mcp [--http] [--port 4547] [--core http://127.0.0.1:4545] [--write | --read-only] [--source-ai claude] — 1.10.0 STDIO 기본 읽기 전용
    const { pairMcp, runHttp, runStdio } = await import('./mcp/main.ts');
    const coreUrl = opt('core') ?? process.env.SUBBRAIN_CORE_URL ?? 'http://127.0.0.1:4545';
    if (process.argv.includes('pair')) {
      const r = await pairMcp({ coreUrl, write: flag('write'), name: opt('name') ?? 'MCP (HTTP)' });
      console.log(L(`[subbrain] MCP 토큰 ${r.tokenId} · 범위 ${r.scopes.join(',')} — 이 값은 지금 한 번만 보여요:\n${r.token}`, `[subbrain] MCP token ${r.tokenId} · scopes ${r.scopes.join(',')} — shown only this once:\n${r.token}`));
      return;
    }
    // 1.10.0 기본은 읽기 전용. STDIO는 --write(또는 SUBBRAIN_MCP_WRITE=1)일 때만 쓰기 도구를 등록.
    //  HTTP는 토큰 범위(mcp_write = `mcp pair --write`)가 정하고, 서버를 --read-only로 켜면 그것도 끔.
    const ro = flag('read-only') || process.env.SUBBRAIN_MCP_READ_ONLY === '1';
    const o = { coreUrl, write: flag('http') && !flag('no-auth') ? !ro : !ro && (flag('write') || process.env.SUBBRAIN_MCP_WRITE === '1'), sourceAi: opt('source-ai') ?? process.env.SUBBRAIN_MCP_SOURCE_AI ?? 'claude' };
    if (flag('http')) runHttp({ ...o, port: Number(opt('port') ?? 4547), auth: !flag('no-auth') });
    else await runStdio(o);
    return;
  }
  if (cmd === 'ontology') {
    // subbrain ontology status | estimate [--all] | extract [--all] [--rules-only] [--max-cost 0.5] [--task task_id]
    const sub = args[1] ?? 'status';
    const core = new Core(coreOptions());
    if (sub === 'estimate') {
      const e = estimateOntologyCost(core, flag('all') ? 'all' : 'changed');
      console.log(L(`[subbrain] LLM 추출 어림: 대화 ${e.conversations}개 · 입력 ~${Math.round(e.inputTokens / 1000)}k · 출력 ~${Math.round(e.outputTokens / 1000)}k 토큰 · 모델 ${e.model ?? '(키 없음 — 규칙만)'} · 비용 ${e.costUsd === null ? '알 수 없음' : `~$${e.costUsd.toFixed(3)}`}`, `[subbrain] LLM extraction estimate: ${e.conversations} chats · in ~${Math.round(e.inputTokens / 1000)}k · out ~${Math.round(e.outputTokens / 1000)}k tokens · model ${e.model ?? '(no key — rules only)'} · cost ${e.costUsd === null ? 'unknown' : `~$${e.costUsd.toFixed(3)}`}`));
    }
    if (sub === 'extract') {
      const t0 = Date.now();
      const maxCost = opt('max-cost');
      const jobId = enqueueOntologyExtract(core, { scope: flag('all') ? 'all' : 'changed', llm: !flag('rules-only'), maxCostUsd: maxCost ? Number(maxCost) : null, taskIds: opt('task') ? [opt('task')!] : undefined });
      await core.queue.idle();
      const j = core.queue.get(jobId);
      console.log(L(`[subbrain] 추출 ${j?.state} — ${((Date.now() - t0) / 1000).toFixed(1)}초 · 비용 ${j?.costUsd == null ? '-' : `$${Number(j.costUsd).toFixed(4)}`}${j?.error ? ` (${j.error})` : ''}`, `[subbrain] Extraction ${j?.state} — ${((Date.now() - t0) / 1000).toFixed(1)}s · cost ${j?.costUsd == null ? '-' : `$${Number(j.costUsd).toFixed(4)}`}${j?.error ? ` (${j.error})` : ''}`));
    }
    const st = ontologyStatus(core);
    console.log(L(`[subbrain] 온톨로지: 객체 ${Object.entries(st.objects).map(([k, v]) => `${k} ${v}`).join(' · ') || '없음'} · 관계 ${st.links} · 대기 제안 ${st.pendingSuggestions} · LLM 추출 ${st.llmExtractedConversations}/${st.extractableConversations} 대화 (${st.promptVersion}) · 누적 비용 ${st.costUsdTotal === null ? '-' : `$${st.costUsdTotal}`} · 키 ${st.llmConfigured ? '있음' : '없음(규칙만)'}`, `[subbrain] Relations: objects ${Object.entries(st.objects).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'} · links ${st.links} · pending suggestions ${st.pendingSuggestions} · LLM-extracted ${st.llmExtractedConversations}/${st.extractableConversations} chats (${st.promptVersion}) · total cost ${st.costUsdTotal === null ? '-' : `$${st.costUsdTotal}`} · key ${st.llmConfigured ? 'yes' : 'none (rules only)'}`));
    core.close();
    return;
  }
  if (cmd === 'dev' && process.argv.includes('purge-conversation')) {
    const ids = process.argv.slice(process.argv.indexOf('purge-conversation') + 1).filter((a) => !a.startsWith('--') && a !== opt('home') && a !== opt('vault'));
    if (!ids.length) throw new Error(L('사용법: subbrain dev purge-conversation <conv_id|sourceId>… [--dev|--home <dir>]', 'Usage: subbrain dev purge-conversation <conv_id|sourceId>… [--dev|--home <dir>]'));
    if (!flag('dev') && !flag('force')) throw new Error(L('개발 전용이에요: --dev(데모 데이터)로 쓰세요. 다른 데이터 폴더에 쓰려면 백업 후 --force.', 'Development only: use --dev (demo data). To use another data folder, back it up first and pass --force.'));
    const { purgeConversation } = await import('./dev-purge.ts');
    const core = new Core(coreOptions());
    for (const id of ids) { const r = purgeConversation(core, id); console.log(L(`[subbrain] 지움: ${r.conversationId}${r.taskRemoved ? ` + 과제 ${r.taskRemoved}` : ''} (행 ${r.rows})`, `[subbrain] Removed: ${r.conversationId}${r.taskRemoved ? ` + task ${r.taskRemoved}` : ''} (${r.rows} rows)`)); }
    core.close();
    return;
  }
  if (cmd === 'seed') {
    const o = coreOptions();
    if (!o.home && !process.env.SUBBRAIN_HOME && !flag('force')) throw new Error('seed replaces all data in the target folder. Use --dev, --home <demo-folder> (e.g. .demo), or --force for the default ~/.subbrain.');
    const core = new Core(o);
    const lang = (opt('lang') ?? serverLang()).startsWith('ko') ? 'ko' : 'en';
    process.env.SUBBRAIN_LANG = lang; // generated text (morning summaries, vault notes) follows the dataset language
    const r = await seed(core, { vault: !flag('no-vault'), lang });
    console.log(L(`[subbrain] 예시 데이터를 넣었어요: 프로젝트 ${r.projects}, 과제 ${r.tasks}, 대화 ${r.conversations}, 메시지 ${r.messages} (DB: ${core.db.path})`,
      `[subbrain] Sample data loaded (${lang}): ${r.projects} projects, ${r.tasks} tasks, ${r.conversations} chats, ${r.messages} messages (DB: ${core.db.path})`));
    core.close();
    return;
  }
  if (cmd === 'import') {
    const VALUE_OPTS = new Set(['--home', '--vault', '--port', '--out', '--gap', '--source']);
    const file = args.slice(1).find((a, i, arr) => !a.startsWith('--') && !VALUE_OPTS.has(arr[i - 1] ?? ''));
    if (!file) throw new Error(L('사용법: subbrain import <내보내기 ZIP · conversations.json · Gemini Takeout ZIP/MyActivity.html/MyActivity.json> [--dev] [--no-classify] [--force] [--gap 분]', 'Usage: subbrain import <export ZIP · conversations.json · Gemini Takeout ZIP/MyActivity.html/MyActivity.json> [--dev] [--no-classify] [--force] [--gap minutes]'));
    const gi = args.indexOf('--gap');
    const gap = gi >= 0 ? Number(args[gi + 1]) : undefined;
    if (gap !== undefined && !(Number.isInteger(gap) && gap >= 1 && gap <= 1440)) throw new Error(L('--gap은 1~1440 사이 정수(분)예요', '--gap must be an integer between 1 and 1440 (minutes)'));
    const core = new Core(coreOptions());
    const srcOpt = args.includes('--source') ? args[args.indexOf('--source') + 1] : undefined; // 1.10.0 --source grokbot
    if (srcOpt && !['chatgpt', 'claude', 'gemini', 'grokbot'].includes(srcOpt)) throw new Error(L('--source는 chatgpt·claude·gemini·grokbot', '--source must be chatgpt, claude, gemini or grokbot'));
    const imp = createImport(core, { bytes: new Uint8Array(readFileSync(resolve(file))), fileName: resolve(file), force: flag('force'), geminiSessionGapMinutes: gap, sourceAi: srcOpt as 'grokbot' | undefined });
    let cur = imp;
    while (cur.state === 'parsing') { await new Promise((r) => setTimeout(r, 100)); cur = getImport(core, imp.id)!; }
    if (cur.state !== 'preview_ready') throw new Error(cur.errors[0]?.message ?? L(`가져오기 실패 (${cur.state})`, `Import failed (${cur.state})`));
    const p = cur.preview!;
    if (p.activity) console.log(L(`[subbrain] gemini 활동 기록 ${p.activity.events}개 → 대화 ${p.activity.conversations}개 (대화 주소로 ${p.activity.byConversationId} · 시간 ${p.activity.sessionGapMinutes}분 간격으로 ${p.activity.bySession}) · 건너뜀 ${p.activity.skipped} · 응답 없음 ${p.activity.missingResponses}`, `[subbrain] gemini activity: ${p.activity.events} events → ${p.activity.conversations} chats (by chat URL ${p.activity.byConversationId} · by ${p.activity.sessionGapMinutes}-minute gaps ${p.activity.bySession}) · skipped ${p.activity.skipped} · missing responses ${p.activity.missingResponses}`));
    for (const w of p.warnings) console.log(L(`[subbrain] 참고: ${w}`, `[subbrain] Note: ${w}`));
    console.log(L(`[subbrain] ${p.sourceAi}: 대화 ${p.conversationsTotal}개 (새 ${p.conversationsNew} · 바뀜 ${p.conversationsUpdated} · 같음 ${p.conversationsUnchanged}) · 메시지 ${p.messagesTotal}개`, `[subbrain] ${p.sourceAi}: ${p.conversationsTotal} chats (new ${p.conversationsNew} · changed ${p.conversationsUpdated} · unchanged ${p.conversationsUnchanged}) · ${p.messagesTotal} messages`));
    if (!flag('no-classify')) {
      // 1.10.1 키가 없으면 조용히 규칙 분류로 떨어지던 문제 — 분명히 알림(키 값은 찍지 않음)
      console.log(`[subbrain] ${core.llmStatusLine()}`);
      if (!core.llmConfigured()) console.warn(L('[subbrain] ⚠ LLM 키 없음 → 이번 가져오기는 규칙 분류만(mock) 합니다. 키: 설정 저장(secrets.json) · 제공자 환경변수 · SUBBRAIN_LLM_API_KEY. 분류 없이 넣으려면 --no-classify', '[subbrain] ⚠ No LLM key → this import uses the free rule classifier only. Add a key: npm run setup, SUBBRAIN_LLM_API_KEY, or a provider env var. To import without classifying: --no-classify'));
    }
    startImport(core, imp.id, { classify: !flag('no-classify') });
    await core.queue.idle();
    await core.vault.flush();
    cur = getImport(core, imp.id)!;
    console.log(L(`[subbrain] 완료: ${JSON.stringify(cur.result)}`, `[subbrain] Done: ${JSON.stringify(cur.result)}`));
    core.close();
    return;
  }
  if (cmd === 'regenerate-vault') {
    const core = new Core(coreOptions());
    const r = await core.vault.regenerateAll();
    console.log(L(`[subbrain] 볼트를 다시 만들었어요: ${r.written}/${r.total}개 파일, 충돌 백업 ${r.conflicts}개 → ${core.settings.get().vault.path}`, `[subbrain] Vault rebuilt: ${r.written}/${r.total} files, ${r.conflicts} conflict backups → ${core.settings.get().vault.path}`));
    core.close();
    return;
  }
  if (cmd === 'mocks') {
    // 공유 목 JSON을 엔진 응답으로 다시 만든다 (임시 홈 사용 — 실제 데이터는 건드리지 않음)
    const out = opt('out') ? resolve(opt('out')!) : join(APP_DIR, 'packages', 'shared', 'mocks', 'json');
    const r = await dumpMocks(out);
    console.log(L(`[subbrain] 목 JSON ${r.files}개를 썼어요 → ${out} (demo: ${JSON.stringify(r.demo)})`, `[subbrain] Wrote ${r.files} mock JSON files → ${out} (demo: ${JSON.stringify(r.demo)})`));
    return;
  }
  throw new Error(L(`알 수 없는 명령: ${cmd} (start | seed | import <파일> | regenerate-vault | mocks)`, `Unknown command: ${cmd} (start | seed | import <file> | regenerate-vault | mocks)`));
}

main().catch((e: unknown) => { console.error(`[subbrain] ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
