/** 1.7.0 추출 작업(POST /ontology/extract · CLI `ontology extract`) + 분류 뒤 규칙 추출 + 상태 */
import type { OntologyExtractBody, OntologyStatusResponse, ObjectType } from '@subbrain/shared';
import type { Core } from '../core.ts';
import type { JobCtl } from '../queue/jobs.ts';
import { capReached } from '../services/classify.ts';
import { condense, estimateTokens } from '../classifier/condense.ts';
import { priceUsd } from '../classifier/pricing.ts';
import { conversationsForExtraction, emptyStats, extractLlmForConversation, extractRulesForTask, ONTOLOGY_PROMPT_VERSION, syncCoreObjects, type ExtractStats } from './extract.ts';

export async function runOntologyExtract(core: Core, b: OntologyExtractBody, ctl?: JobCtl): Promise<{ stats: ExtractStats; state: 'done' | 'deferred' | 'cancelled' }> {
  const db = core.db;
  const stats = emptyStats();
  // 1) 규칙: 모든 과제(가벼움)
  syncCoreObjects(core, b.taskIds);
  const taskIds = b.taskIds?.length ? b.taskIds : db.all<{ id: string }>("SELECT id FROM tasks WHERE kind='task' AND status<>'보관'").map((r) => r.id);
  for (const id of taskIds) extractRulesForTask(core, id, stats);
  // 2) LLM
  const cls = core.classifier();
  if (b.llm === false || b.mode === 'rules' || !cls.isLlm || !cls.complete) return { stats, state: 'done' };
  const convs = conversationsForExtraction(core, b.scope ?? 'changed', b.taskIds);
  ctl?.progress(0, convs.length);
  let i = 0;
  for (const c of convs) {
    if (ctl?.cancelled()) return { stats, state: 'cancelled' };
    if (b.maxCostUsd != null && (stats.costUsd ?? 0) >= b.maxCostUsd) return { stats, state: 'deferred' };
    if (capReached(core)) return { stats, state: 'deferred' };
    try {
      const before = stats.costUsd ?? 0;
      await extractLlmForConversation(core, c, cls, stats, { force: b.scope === 'all' });
      ctl?.addCost((stats.costUsd ?? 0) - before);
    } catch (e) {
      if (process.env.SUBBRAIN_DEBUG) console.error(e);
      stats.skipped++;
    }
    ctl?.progress(++i, convs.length);
  }
  return { stats, state: 'done' };
}

export function enqueueOntologyExtract(core: Core, b: OntologyExtractBody): string {
  const llm = b.llm !== false && b.mode !== 'rules' && core.llmConfigured();
  const id = core.queue.create('extract_ontology', `객체·관계 뽑기 · ${llm ? 'LLM+규칙' : '규칙만'}${b.scope === 'all' ? ' · 전체' : ''}`, { payload: b });
  core.queue.enqueue(id, async (ctl) => (await runOntologyExtract(core, b, ctl)).state);
  return id;
}

/** 분류가 끝난 과제마다 규칙 추출(키 없어도, 비용 0) */
export function afterClassification(core: Core, taskId: string | null): void {
  if (!taskId) return;
  try { extractRulesForTask(core, taskId); } catch (e) { if (process.env.SUBBRAIN_DEBUG) console.error(e); }
}

export function ontologyStatus(core: Core): OntologyStatusResponse {
  const db = core.db;
  const objects: Partial<Record<ObjectType, number>> = {};
  for (const r of db.all<{ type: ObjectType; n: number }>("SELECT type, COUNT(*) n FROM objects WHERE status IN ('accepted','suggested') GROUP BY type")) objects[r.type] = Number(r.n);
  const run = db.get<{ n: number; last: string | null; cost: number | null }>('SELECT COUNT(*) n, MAX(at) last, SUM(cost_usd) cost FROM ontology_runs WHERE prompt_version=?', ONTOLOGY_PROMPT_VERSION)!;
  return {
    objects, links: Number(db.value("SELECT COUNT(*) FROM links WHERE status IN ('accepted','suggested')") ?? 0),
    pendingSuggestions: Number(db.value("SELECT COUNT(*) FROM ontology_suggestions WHERE state='pending'") ?? 0),
    llmExtractedConversations: Number(run.n), extractableConversations: conversationsForExtraction(core, 'all').length,
    promptVersion: ONTOLOGY_PROMPT_VERSION, lastRunAt: run.last, costUsdTotal: run.cost == null ? null : Math.round(Number(run.cost) * 10000) / 10000, llmConfigured: core.llmConfigured(),
  };
}

/** 비용 어림(LLM 호출 없음): 대상 대화의 줄인 글 길이 → 토큰(글자/2.5) + 고정 프롬프트 1,200 + 출력 600 */
export function estimateOntologyCost(core: Core, scope: 'changed' | 'all'): { conversations: number; inputTokens: number; outputTokens: number; model: string | null; costUsd: number | null } {
  const db = core.db;
  const s = core.settings.get();
  const ids = conversationsForExtraction(core, scope);
  let inTok = 0;
  for (const id of ids) {
    const msgs = db.all<{ role: string; content_md: string }>('SELECT role, content_md FROM messages WHERE conversation_id=? ORDER BY seq', id);
    inTok += estimateTokens(condense(msgs.map((m) => ({ role: m.role as never, content: m.content_md })), { head: s.classification.condenseHead, tail: s.classification.condenseTail, middleChars: s.classification.condenseMiddleChars, redact: false })) + 1200;
  }
  const outTok = ids.length * 600;
  const model = s.llm.model ?? null; // 키가 없어도 저장된 설정의 모델로 어림
  return { conversations: ids.length, inputTokens: inTok, outputTokens: outTok, model, costUsd: model ? priceUsd(model, inTok, outTok) : null };
}

/** 1.7.0 v7 이전 데이터 보충: 과제 객체가 없는 과제가 있으면 규칙 추출(LLM 없음, 멱등). 코어 시작 때 한 번 */
export function backfillRulesIfMissing(core: Core): { ran: boolean; tasks: number; linksCreated: number } {
  const db = core.db;
  const missing = Number(db.value("SELECT COUNT(*) FROM tasks t WHERE t.kind='task' AND t.status<>'보관' AND NOT EXISTS (SELECT 1 FROM objects o WHERE o.type='task' AND o.ref_table='tasks' AND o.ref_id=t.id)") ?? 0);
  if (!missing) return { ran: false, tasks: 0, linksCreated: 0 };
  const stats = emptyStats();
  db.tx(() => { syncCoreObjects(core); for (const r of db.all<{ id: string }>("SELECT id FROM tasks WHERE kind='task' AND status<>'보관'")) extractRulesForTask(core, r.id, stats); });
  return { ran: true, tasks: missing, linksCreated: stats.linksCreated };
}
