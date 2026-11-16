/**
 * 가져오기 흐름(§3 시나리오 D, 계약서 §12): 업로드 → parsing → preview_ready → (start) importing → classifying → done
 * 중복 제거: (source_ai, source_id)가 같으면 같은 대화. 메시지 해시가 모두 같으면 건너뜀, 다르면 seq별로 갱신.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ImportJob, ImportPreview, ImportProgress, ImportState, SourceAi, StartImportBody } from '@subbrain/shared';
import { CONVERSATION_URL, MOCK_MODEL } from '@subbrain/shared/constants';
import type { Core } from '../core.ts';
import { json, str, type Row } from '../db/db.ts';
import { parseExport, type ParseOptions } from '../importers/detect.ts';
import { CategoryZipError, UnsupportedFileError, type ClaudeProjectRecord, type ImportSourceAi, type NormalizedConversation, type ParseResult } from '../importers/types.ts';
import { condense, estimateTokens } from '../classifier/condense.ts';
import { priceUsd } from '../classifier/provider.ts';
import { ApiError, conflict, notFound } from '../util/errors.ts';
import { randomId, sha256, shortSourceId } from '../util/ids.ts';
import { kstDate, localIso, koTimeLabel, koMonthDay, nowIso, today } from '../util/time.ts';
import { addEvent } from './events.ts';
import { isQuickCandidate, runClassification } from './classify.ts';
import { refreshTask } from './tasks.ts';
import { createProject, normName } from './mutations.ts';
import { findProjectByName } from './project-suggestions.ts';

const parsed = new Map<string, ParseResult>(); // 미리보기와 실행 사이의 파싱 결과(메모리). 재시작되면 파일에서 다시 파싱

export function rowToImport(r: Row): ImportJob {
  return {
    id: String(r.id), state: String(r.state) as ImportState, sourceAi: (str(r.source_ai) as SourceAi | null), fileName: String(r.file_name), fileSizeBytes: Number(r.file_size ?? 0),
    fileHash: `sha256:${String(r.file_hash)}`, createdAt: String(r.created_at), startedAt: str(r.started_at), finishedAt: str(r.finished_at),
    options: json<StartImportBody>(r.options_json, {}), preview: normPreview(json<ImportPreview | null>(r.preview_json, null)), progress: json<ImportProgress>(r.progress_json, { phase: 'uploaded', processed: 0, total: 0, percent: 0, currentLabel: null, etaSec: null }),
    result: normResult(json<ImportJob['result']>(r.result_json, null)), errors: json<ImportJob['errors']>(r.errors_json, []), classifyJobId: str(r.classify_job_id),
  };
}
// 1.0.x에 저장된 가져오기 기록에는 1.1.0 필드가 없다 → 읽을 때 채움
function normPreview(p: ImportPreview | null): ImportPreview | null { return p ? { ...p, category: p.category ?? 'conversations', projects: p.projects ?? null, activity: p.activity ?? null } : null; }
function normResult(r: ImportJob['result']): ImportJob['result'] { return r ? { ...r, projectsCreated: r.projectsCreated ?? 0 } : null; }
export function getImport(core: Core, id: string): ImportJob | null { const r = core.db.get('SELECT * FROM import_batches WHERE id=?', id); return r ? rowToImport(r) : null; }

function setProgress(core: Core, id: string, p: Partial<ImportProgress> & { phase: ImportState }): void {
  const cur = json<ImportProgress>(core.db.value<string>('SELECT progress_json FROM import_batches WHERE id=?', id), { phase: 'uploaded', processed: 0, total: 0, percent: 0, currentLabel: null, etaSec: null });
  const next = { ...cur, etaSec: null, ...p };
  core.db.run('UPDATE import_batches SET state=?, progress_json=? WHERE id=?', p.phase, JSON.stringify(next), id);
}

export function conversationHash(c: NormalizedConversation): { hash: string; messageHashes: string[] } {
  // voice는 true일 때만 해시에 넣는다(1.3.0) — 음성이 아닌 대화의 해시는 1.2.0과 같음
  const messageHashes = c.messages.map((m) => sha256(`${m.role}\n${m.content}${m.voice ? '\n\u0000voice' : ''}`));
  return { hash: 'sha256:' + sha256(messageHashes.join('\n')), messageHashes };
}

/** POST /imports — 파일을 받아 즉시 parsing 상태로 돌려주고, 파싱은 뒤에서 */
export function createImport(core: Core, input: { bytes: Uint8Array; fileName: string; sourceAi?: ImportSourceAi; force?: boolean; geminiSessionGapMinutes?: number }): ImportJob {
  const db = core.db;
  const hash = sha256(input.bytes);
  const dup = db.get<{ id: string; created_at: string }>("SELECT id, created_at FROM import_batches WHERE file_hash=? AND state NOT IN ('failed','cancelled') ORDER BY created_at DESC LIMIT 1", hash);
  if (dup && !input.force) throw new ApiError('DUPLICATE_IMPORT', `이미 가져온 파일이에요 (${koMonthDay(kstDate(dup.created_at))} ${koTimeLabel(dup.created_at)}).`, { importId: dup.id });
  const id = `imp_${today().replace(/-/g, '')}_${randomId(4)}`;
  const now = nowIso();
  db.run('INSERT INTO import_batches(id,source_ai,file_name,file_hash,file_size,created_at,state,progress_json) VALUES (?,?,?,?,?,?,?,?)',
    id, null, basename(input.fileName), hash, input.bytes.byteLength, now, 'parsing', JSON.stringify({ phase: 'parsing', processed: 0, total: 0, percent: 2, currentLabel: '파일 여는 중', etaSec: null }));
  setImmediate(() => { void parseInBackground(core, id, input.bytes, input.fileName, input.sourceAi, { gemini: { sessionGapMinutes: input.geminiSessionGapMinutes } }); });
  return getImport(core, id)!;
}

/**
 * 가져오기용 파싱. 1.1.0: 새 Claude 내보내기(2026-10)의 카테고리 ZIP은 실패 대신 카테고리 결과로 바꾼다.
 *  - projects-000.zip → 프로젝트만 만든다(대화와 연결 정보가 없어 과제 연결은 분류 단계의 새 프로젝트 제안/프로젝트 이름 매칭으로)
 *  - memories-000.zip → 가져올 것이 없음(안내만)
 */
export function parseForImport(bytes: Uint8Array, hint?: ImportSourceAi, opts: ParseOptions = {}): ParseResult {
  try { return parseExport(bytes, hint, opts); } catch (e) {
    if (!(e instanceof CategoryZipError)) throw e;
    const warnings = e.category === 'projects'
      ? ['Claude 프로젝트 파일이에요 — 대화가 없어 프로젝트만 만들어요.', '새 Claude 내보내기는 대화에 프로젝트 정보가 없어요. 과제는 분류 때 프로젝트 이름이 맞거나 새 프로젝트 제안을 수락하면 연결돼요.']
      : [`Claude 메모리 파일이에요(${e.fileCount}개) — 서브브레인은 메모리를 쓰지 않아 가져올 것이 없어요. 대화는 conversations ZIP을 올려 주세요.`];
    return {
      sourceAi: 'claude', detectedFormat: e.category === 'projects' ? 'claude_projects_zip' : 'claude_memories_zip', formatVersion: '2026-10',
      conversations: [], errors: [], warnings, category: e.category, projects: e.projects,
    };
  }
}

interface ProjectPlan { total: number; create: ClaudeProjectRecord[]; existing: Array<{ rec: ClaudeProjectRecord; projectId: string }>; skipped: number }
/** projects ZIP → 만들 것/이미 있는 것/건너뛸 것(이름 없음·Claude 기본 'How to use Claude' 같은 스타터·파일 안 중복) */
function planProjects(core: Core, recs: ClaudeProjectRecord[]): ProjectPlan {
  const plan: ProjectPlan = { total: recs.length, create: [], existing: [], skipped: 0 };
  const seen = new Set<string>();
  for (const r of recs) {
    const nn = normName(r.name);
    if (!r.name || !nn || r.isStarter || seen.has(nn)) { plan.skipped++; continue; }
    seen.add(nn);
    const byRef = core.db.value<string>('SELECT id FROM projects WHERE external_ref=?', `claude_project:${r.uuid}`);
    const pid = byRef ?? findProjectByName(core, r.name);
    if (pid) plan.existing.push({ rec: r, projectId: pid }); else plan.create.push(r);
  }
  return plan;
}

async function parseInBackground(core: Core, id: string, bytes: Uint8Array, fileName: string, hint?: ImportSourceAi, opts: ParseOptions = {}): Promise<void> {
  const db = core.db;
  try {
    const res = parseForImport(bytes, hint, { ...opts, fileName });
    if (db.value<string>('SELECT state FROM import_batches WHERE id=?', id) === 'cancelled') return;
    // 원본 보관(§6.1 raw/exports/<ai>/)
    const dir = join(core.rawDir(), 'exports', res.sourceAi);
    mkdirSync(dir, { recursive: true });
    const rawName = `${today()}_${id}_${basename(fileName)}`;
    writeFileSync(join(dir, rawName), bytes);
    parsed.set(id, res);
    const preview = buildPreview(core, res);
    db.run('UPDATE import_batches SET source_ai=?, file_path=?, preview_json=?, errors_json=? WHERE id=?', res.sourceAi, join(dir, rawName), JSON.stringify(preview), JSON.stringify(res.errors), id);
    setProgress(core, id, { phase: 'preview_ready', processed: preview.conversationsTotal, total: preview.conversationsTotal, percent: 10, currentLabel: '미리보기 준비됨' });
  } catch (e) {
    const msg = e instanceof UnsupportedFileError ? e.message : `파일을 읽다가 오류가 났어요: ${e instanceof Error ? e.message : String(e)}`;
    db.run('UPDATE import_batches SET errors_json=?, finished_at=? WHERE id=?', JSON.stringify([{ conversationSourceId: null, message: msg }]), nowIso(), id);
    setProgress(core, id, { phase: 'failed', percent: 100, currentLabel: '실패' });
  }
}

export function buildPreview(core: Core, res: ParseResult): ImportPreview {
  const db = core.db;
  let nNew = 0, nUpd = 0, nSame = 0, msgs = 0, quick = 0, inTok = 0, outTok = 0;
  let from: string | null = null, to: string | null = null;
  const s = core.settings.get();
  const llm = core.llmConfigured();
  for (const c of res.conversations) {
    msgs += c.messages.length;
    if (c.createdAt && (!from || c.createdAt < from)) from = c.createdAt;
    if (c.updatedAt && (!to || c.updatedAt > to)) to = c.updatedAt;
    const ex = db.get<{ content_hash: string }>('SELECT content_hash FROM conversations WHERE source_ai=? AND source_id=?', c.sourceAi, c.sourceId);
    const { hash } = conversationHash(c);
    const status = !ex ? 'new' : ex.content_hash === hash ? 'same' : 'upd';
    if (status === 'new') nNew++; else if (status === 'upd') nUpd++; else nSame++;
    if (status === 'same') continue;
    if (isQuickCandidate(c.messages)) { quick++; continue; }
    inTok += estimateTokens(condense(c.messages, { head: s.classification.condenseHead, tail: s.classification.condenseTail, middleChars: s.classification.condenseMiddleChars, redact: false })) + 900;
    outTok += 300;
  }
  const category = res.category ?? 'conversations';
  const plan = category === 'projects' ? planProjects(core, res.projects ?? []) : null;
  const useLlm = llm && category === 'conversations';
  const model = useLlm ? core.classifier().model : null;
  const cost = useLlm ? priceUsd(model, inTok, outTok) : 0;
  return {
    sourceAi: res.sourceAi, detectedFormat: res.detectedFormat, formatVersion: res.formatVersion,
    category,
    projects: plan ? { total: plan.total, new: plan.create.length, existing: plan.existing.length, skipped: plan.skipped, names: plan.create.map((r) => r.name).slice(0, 50) } : null,
    conversationsTotal: res.conversations.length,
    conversationsNew: nNew, conversationsUpdated: nUpd, conversationsUnchanged: nSame, messagesTotal: msgs, dateRange: { from, to }, quickQuestionPrefiltered: quick,
    activity: res.activity ?? null,
    estimate: {
      model, inputTokens: inTok, outputTokens: outTok, costUsd: cost,
      note: category !== 'conversations'
        ? '대화가 없는 파일이라 분류하지 않아요 — 비용 없음'
        : llm
        ? `글자 수 기준 대략 추정 [미검증]${cost === null ? ` · ${model} 가격을 몰라 비용은 계산하지 않음(SUBBRAIN_PRICE_INPUT_PER_MTOK·OUTPUT 설정)` : ''} · 간단한 질문 ${quick}개는 규칙으로 걸러 LLM 생략`
        : `LLM 키가 없어 규칙 분류기(${MOCK_MODEL})로 분류해요 — 비용 없음`,
    },
    warnings: res.warnings,
  };
}

function newTaskId(core: Core, createdAt: string): string {
  const d = kstDate(createdAt).replace(/-/g, '');
  const rows = core.db.all<{ id: string }>("SELECT id FROM tasks WHERE id LIKE ?", `task_${d}_%`);
  const max = Math.max(0, ...rows.map((r) => Number(r.id.split('_').at(-1)) || 0));
  return `task_${d}_${String(max + 1).padStart(2, '0')}`;
}
function newConvId(core: Core, ai: SourceAi, sourceId: string): string {
  for (const len of [8, 12, 16, 32]) {
    const id = `conv_${ai}_${shortSourceId(sourceId, len)}`;
    const other = core.db.value<string>('SELECT source_id FROM conversations WHERE id=?', id);
    if (!other || other === sourceId) return id;
  }
  return `conv_${ai}_${sha256(sourceId).slice(0, 16)}`;
}

/** 대화 하나 넣기/갱신 (dedupe). 반환: new | updated | unchanged */
export function upsertConversation(core: Core, c: NormalizedConversation, meta: { importId: string | null; rawPath: string | null; captureMethod?: 'export' | 'local_session' | 'mcp' | 'extension_live' | 'extension_catchup' }): { state: 'new' | 'updated' | 'unchanged'; conversationId: string; taskId: string | null; taskCreated: boolean } {
  const db = core.db;
  const { hash, messageHashes } = conversationHash(c);
  const now = nowIso();
  const created = c.createdAt ?? c.messages[0]?.createdAt ?? now;
  const updated = c.updatedAt ?? c.messages.at(-1)?.createdAt ?? created;
  return db.tx(() => {
    const ex = db.get('SELECT * FROM conversations WHERE source_ai=? AND source_id=?', c.sourceAi, c.sourceId);
    if (ex && ex.content_hash === hash) {
      db.run('UPDATE conversations SET captured_at=? WHERE id=?', now, ex.id);
      return { state: 'unchanged' as const, conversationId: String(ex.id), taskId: str(ex.task_id), taskCreated: false };
    }
    const convId = ex ? String(ex.id) : newConvId(core, c.sourceAi, c.sourceId);
    if (ex) {
      db.run('UPDATE conversations SET title=?, updated_at=?, captured_at=?, message_count=?, content_hash=?, raw_path=COALESCE(?, raw_path), import_id=COALESCE(?, import_id), service_state=?, has_unextracted_artifact=?, in_service_project=? WHERE id=?',
        c.title, updated, now, c.messages.length, hash, meta.rawPath, meta.importId, c.archived ? 'archived' : 'active', c.hasUnextractedArtifact, c.inServiceProject, convId);
    } else {
      db.run(`INSERT INTO conversations(id,source_ai,source_id,source_url,title,created_at,updated_at,captured_at,message_count,content_hash,capture_method,raw_path,service_state,has_unextracted_artifact,in_service_project,import_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, convId, c.sourceAi, c.sourceId, c.url !== undefined ? c.url : CONVERSATION_URL[c.sourceAi](c.sourceId), c.title, created, updated, now, c.messages.length, hash,
        meta.captureMethod ?? 'export', meta.rawPath, c.archived ? 'archived' : 'active', c.hasUnextractedArtifact, c.inServiceProject, meta.importId);
    }
    // 메시지: seq별 해시 비교 → 바뀐 것만 갱신, 늘어난 것 추가, 줄어든 것 삭제
    const existing = new Map(db.all<{ seq: number; content_hash: string }>('SELECT seq, content_hash FROM messages WHERE conversation_id=?', convId).map((m) => [m.seq, m.content_hash]));
    let added = 0;
    c.messages.forEach((m, i) => {
      const seq = i + 1, h = messageHashes[i]!;
      const old = existing.get(seq);
      if (old === h) return;
      if (old === undefined) { db.run('INSERT INTO messages(conversation_id,seq,role,content_md,created_at,content_hash,voice) VALUES (?,?,?,?,?,?,?)', convId, seq, m.role, m.content, m.createdAt, h, m.voice ? 1 : 0); added++; }
      else db.run('UPDATE messages SET role=?, content_md=?, created_at=?, content_hash=?, voice=? WHERE conversation_id=? AND seq=?', m.role, m.content, m.createdAt, h, m.voice ? 1 : 0, convId, seq);
    });
    db.run('DELETE FROM messages WHERE conversation_id=? AND seq>?', convId, c.messages.length);
    let taskId = ex ? str(ex.task_id) : null;
    let taskCreated = false;
    if (!taskId) {
      // 대화 1개 = 과제 1개로 시작(§6.1)
      taskId = newTaskId(core, created);
      db.run("INSERT INTO tasks(id,title,status,status_source,started_at,last_activity_at,origin,kind,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        taskId, c.title, '진행 중', 'rule', created, updated, 'auto', 'task', now, now);
      db.run("INSERT INTO task_conversations(task_id,conversation_id,role) VALUES (?,?,'primary')", taskId, convId);
      db.run('UPDATE conversations SET task_id=? WHERE id=?', taskId, convId);
      taskCreated = true;
      addEvent(db, { type: 'conversation_started', actor: meta.captureMethod === 'mcp' ? 'mcp' : 'extension', taskId, conversationId: convId, at: created, payload: { sourceAi: c.sourceAi, via: meta.captureMethod ?? 'export' } });
    } else {
      addEvent(db, { type: 'message_added', actor: 'extension', taskId, conversationId: convId, at: updated, payload: { added, messageCount: c.messages.length, via: meta.captureMethod ?? 'export' } });
    }
    refreshTask(core, taskId, 'rule', { silent: true });
    return { state: ex ? 'updated' as const : 'new' as const, conversationId: convId, taskId, taskCreated };
  });
}

/** POST /imports/:id/start */
export function startImport(core: Core, id: string, body: StartImportBody): ImportJob {
  const db = core.db;
  const imp = getImport(core, id);
  if (!imp) throw notFound('가져오기', id, 'importId');
  if (imp.state !== 'preview_ready') throw conflict(`미리보기 준비 상태에서만 시작할 수 있어요 (지금: ${imp.state}).`, { importId: id, state: imp.state });
  const now = nowIso();
  db.run('UPDATE import_batches SET started_at=?, options_json=? WHERE id=?', now, JSON.stringify(body), id);
  setProgress(core, id, { phase: 'importing', processed: 0, total: imp.preview?.conversationsTotal ?? 0, percent: 12, currentLabel: '대화 넣는 중' });
  const jobId = core.queue.create('import', `가져오기 ${id}`, { parentId: id, total: imp.preview?.conversationsTotal ?? 0 });
  core.queue.enqueue(jobId, async (ctl) => {
    let res = parsed.get(id);
    if (!res) { const path = db.value<string>('SELECT file_path FROM import_batches WHERE id=?', id); if (!path) throw new Error('원본 파일이 없어요'); res = parseForImport(new Uint8Array(readFileSync(path)), imp.sourceAi === 'grokbot' ? 'grokbot' : undefined, { gemini: { sessionGapMinutes: imp.preview?.activity?.sessionGapMinutes } }); }
    const rawRel = db.value<string>('SELECT file_path FROM import_batches WHERE id=?', id);
    const errors = [...imp.errors];
    if (res.category && res.category !== 'conversations') {
      // 1.1.0 카테고리 ZIP: projects → 프로젝트 만들기(+external_ref), memories → 할 일 없음
      let projectsCreated = 0;
      if (res.category === 'projects') {
        const plan = planProjects(core, res.projects ?? []);
        db.tx(() => {
          for (const r of plan.create) {
            try {
              const pid = createProject(core, { name: r.name });
              db.run('UPDATE projects SET external_ref=? WHERE id=?', `claude_project:${r.uuid}`, pid);
              addEvent(db, { type: 'object_created', actor: 'user', at: nowIso(), payload: { objectType: 'project', projectId: pid, name: r.name, via: 'claude_projects_zip', importId: id } });
              projectsCreated++;
            } catch (e) { errors.push({ conversationSourceId: null, message: `프로젝트 '${r.name}'을 만들지 못했어요: ${e instanceof Error ? e.message : String(e)}` }); }
          }
          for (const x of plan.existing) db.run('UPDATE projects SET external_ref=COALESCE(external_ref, ?) WHERE id=?', `claude_project:${x.rec.uuid}`, x.projectId);
        });
      }
      db.run('UPDATE import_batches SET imported_at=?, conversations_new=0, conversations_updated=0, errors_json=?, result_json=?, finished_at=? WHERE id=?', nowIso(), JSON.stringify(errors),
        JSON.stringify({ conversationsNew: 0, conversationsUpdated: 0, skippedDuplicates: 0, tasksCreated: 0, classified: 0, classificationDeferred: 0, actualCostUsd: 0, unfinishedTasks: 0, projectsCreated }), nowIso(), id);
      setProgress(core, id, { phase: 'done', processed: 0, total: 0, percent: 100, currentLabel: res.category === 'projects' ? `완료 · 프로젝트 ${projectsCreated}개` : '완료 · 가져올 대화 없음', etaSec: 0 });
      parsed.delete(id);
      return 'done';
    }
    const convs = body.onlyNewSince ? res.conversations.filter((c) => (c.updatedAt ?? '') >= localIso(body.onlyNewSince!)) : res.conversations;
    const counts = { conversationsNew: 0, conversationsUpdated: 0, skippedDuplicates: 0, tasksCreated: 0 };
    const toClassify: string[] = [];
    const touchedTasks = new Set<string>();
    let i = 0;
    for (const c of convs) {
      if (ctl.cancelled() || db.value<string>('SELECT state FROM import_batches WHERE id=?', id) === 'cancelled') return 'cancelled';
      try {
        const r = upsertConversation(core, c, { importId: id, rawPath: rawRel });
        if (r.state === 'new') counts.conversationsNew++; else if (r.state === 'updated') counts.conversationsUpdated++; else counts.skippedDuplicates++;
        if (r.taskCreated) counts.tasksCreated++;
        if (r.state !== 'unchanged') { toClassify.push(r.conversationId); if (r.taskId) touchedTasks.add(r.taskId); }
      } catch (e) { errors.push({ conversationSourceId: c.sourceId, message: e instanceof Error ? e.message : String(e) }); }
      i++;
      ctl.progress(i, convs.length);
      if (i % 25 === 0 || i === convs.length) {
        setProgress(core, id, { phase: 'importing', processed: i, total: convs.length, percent: 12 + Math.round((i / Math.max(1, convs.length)) * 28), currentLabel: `대화 넣는 중 · ${i.toLocaleString('ko-KR')} / ${convs.length.toLocaleString('ko-KR')}` });
        await new Promise((r) => setImmediate(r));
      }
    }
    db.run("INSERT INTO sync_state(source_ai,last_import_at,adapter_health,methods_json) VALUES (?,?, 'ok', '[\"export\"]') ON CONFLICT(source_ai) DO UPDATE SET last_import_at=excluded.last_import_at", res.sourceAi, nowIso());
    db.run('UPDATE import_batches SET imported_at=?, conversations_new=?, conversations_updated=?, errors_json=? WHERE id=?', nowIso(), counts.conversationsNew, counts.conversationsUpdated, JSON.stringify(errors), id);
    let classified = 0, deferred = 0, cost: number | null = null;
    if (body.classify !== false && toClassify.length) {
      const cjob = core.queue.create('classify', `분류 · 가져오기 ${id}`, { parentId: id, total: toClassify.length });
      db.run("UPDATE jobs SET state='running', started_at=? WHERE id=?", nowIso(), cjob);
      db.run('UPDATE import_batches SET classify_job_id=? WHERE id=?', cjob, id);
      setProgress(core, id, { phase: 'classifying', processed: 0, total: toClassify.length, percent: 40, currentLabel: `분류 중 · 0 / ${toClassify.length.toLocaleString('ko-KR')}` });
      const t0 = Date.now();
      const r = await runClassification(core, cjob, toClassify, {
        maxCostUsd: body.maxCostUsd ?? null,
        onProgress: (done, total) => {
          if (done % 10 !== 0 && done !== total) return;
          const per = (Date.now() - t0) / done;
          setProgress(core, id, { phase: 'classifying', processed: done, total, percent: 40 + Math.round((done / total) * 60), currentLabel: `분류 중 · ${done.toLocaleString('ko-KR')} / ${total.toLocaleString('ko-KR')}`, etaSec: Math.round((per * (total - done)) / 1000) });
        },
      });
      db.run('UPDATE jobs SET state=?, finished_at=? WHERE id=?', r.state === 'cancelled' ? 'cancelled' : r.state, nowIso(), cjob);
      classified = r.classified; deferred = r.deferred; cost = r.costUsd;
    }
    const unfinished = Number(db.value("SELECT COUNT(*) FROM tasks WHERE id IN (SELECT value FROM json_each(?)) AND status IN ('진행 중','멈춤') AND kind='task'", JSON.stringify([...touchedTasks])) ?? 0);
    db.run('UPDATE import_batches SET result_json=?, finished_at=? WHERE id=?', JSON.stringify({ ...counts, classified, classificationDeferred: deferred, actualCostUsd: cost, unfinishedTasks: unfinished, projectsCreated: 0 }), nowIso(), id);
    setProgress(core, id, { phase: 'done', processed: convs.length, total: convs.length, percent: 100, currentLabel: '완료', etaSec: 0 });
    parsed.delete(id);
    for (const tid of touchedTasks) core.vault.scheduleTask(tid);
    return 'done';
  });
  return getImport(core, id)!;
}

export function cancelImport(core: Core, id: string): ImportJob {
  const imp = getImport(core, id);
  if (!imp) throw notFound('가져오기', id, 'importId');
  if (imp.state === 'done' || imp.state === 'failed' || imp.state === 'cancelled') throw conflict(`이미 끝난 가져오기예요 (${imp.state}).`, { importId: id, state: imp.state });
  const job = core.db.value<string>("SELECT id FROM jobs WHERE parent_id=? AND type='import' AND state IN ('queued','running')", id);
  if (job) core.queue.cancel(job);
  core.db.run('UPDATE import_batches SET finished_at=? WHERE id=?', nowIso(), id);
  setProgress(core, id, { phase: 'cancelled', currentLabel: '취소됨' });
  parsed.delete(id);
  return getImport(core, id)!;
}

