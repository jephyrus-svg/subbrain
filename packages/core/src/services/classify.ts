/**
 * 분류 파이프라인: 대화 → (줄이기·가리기) → 분류기 → 결과 보정(1.1.0) → classifications 저장 → 과제에 반영(고정 필드 제외) → 규칙 엔진
 * 1.1.0 (계약 §16):
 *  - 보정: "내일 X 먼저 해보자"·다른 곳에서 이어감(handoff) 끝은 미해결로 고정, 확신도 기준표 + 규칙 신호로 보정·상한 0.95
 *  - 분류 불가: 제공자 안전 필터(PROHIBITED_CONTENT 등)면 규칙 결과로 채우되 state='blocked'로 표시, 내용이 바뀌거나 force일 때만 다시 시도
 *  - 같은 과제 후보: 글자 2-gram 유사도 하한 + 한 실행에서 같은 과제가 너무 자주 찍히면(허브) 버림
 *  - 주제: 분류기가 붙인 주제는 다시 분류하면 교체(사용자·시드 주제는 유지)
 *  - 새 프로젝트 제안: project_suggestions에 모음(project-suggestions.ts)
 */
import type { HandoffInfo, MessageRole, SourceAi } from '@subbrain/shared';
import { CLASSIFIER_TUNING, MOCK_MODEL, PROMPT_VERSION } from '@subbrain/shared/constants';
import type { LlmClassification } from '@subbrain/shared/schemas';
import type { Core } from '../core.ts';
import { json, str } from '../db/db.ts';
import { condense } from '../classifier/condense.ts';
import { RuleClassifier, ruleClassify } from '../classifier/rule-classifier.ts';
import { ProviderBlockedError, type Classifier, type ClassifyInput } from '../classifier/provider.ts';
import { classifyWithCache } from '../classifier/cache.ts';
import { detectOutcome, endingSignals, handoffLabel, outcomeLabel, type OutcomeKind } from '../classifier/signals.ts';
import { ApiError } from '../util/errors.ts';
import { randomId } from '../util/ids.ts';
import { bigrams, dice } from '../util/similarity.ts';
import { addDays, kstDate, nowIso, startOfDayIso, today } from '../util/time.ts';
import { normName, syncDecisionsCopy } from './mutations.ts';
import { afterClassification } from '../ontology/job.ts';
import { consolidateProjectSuggestions, findProjectByName, recordProjectSuggestion } from './project-suggestions.ts';
import { refreshTask } from './tasks.ts';
import type { JobCtl } from '../queue/jobs.ts';

/** 규칙으로 판단할 수 있는 짧은 간단한 질문은 LLM을 부르지 않는다(§7.7 비용 관리) */
export function isQuickCandidate(messages: Array<{ role: MessageRole; content: string }>): boolean {
  const users = messages.filter((m) => m.role === 'user');
  const sig = endingSignals(messages);
  return users.length <= 2 && messages.length <= 4 && !sig.continueCue && !sig.handoff && !users.some((m) => m.content.includes('```'));
}

/** 1.3.0 costUsd: 가격을 모르는 LLM 분류(규칙·캐시·분류 불가 제외)가 하나라도 있으면 null(합계를 알 수 없음), costUsdKnown = 아는 것만 더한 값(비용 상한 판단에 씀) */
export function todayUsage(core: Core): { classified: number; inputTokens: number; outputTokens: number; costUsd: number | null; costUsdKnown: number; costUnknownCount: number; cacheHits: number } {
  const r = core.db.get<{ n: number; i: number | null; o: number | null; c: number | null; h: number | null; u: number | null }>(
    `SELECT COUNT(*) AS n, SUM(input_tokens) AS i, SUM(output_tokens) AS o, SUM(cost_usd) AS c, SUM(cache_hit) AS h,
       SUM(CASE WHEN cost_usd IS NULL AND model<>? AND cache_hit=0 THEN 1 ELSE 0 END) AS u FROM classifications WHERE created_at >= ?`, MOCK_MODEL, startOfDayIso(today()));
  const known = Math.round(Number(r?.c ?? 0) * 10000) / 10000, unknown = Number(r?.u ?? 0);
  return { classified: Number(r?.n ?? 0), inputTokens: Number(r?.i ?? 0), outputTokens: Number(r?.o ?? 0), costUsd: unknown > 0 ? null : known, costUsdKnown: known, costUnknownCount: unknown, cacheHits: Number(r?.h ?? 0) };
}
export function capReached(core: Core): boolean {
  const cap = core.settings.get().llm.dailyCostCapUsd;
  return core.llmConfigured() && cap !== null && todayUsage(core).costUsdKnown >= cap;
}

export interface ClassifyOutcome { costUsd: number | null; inputTokens: number; outputTokens: number; model: string; blocked: boolean; cached?: boolean }

/** 같은 과제 후보를 실행이 끝날 때 한꺼번에 거른다(허브 현상 방지) */
export interface MergeCandidate { taskId: string; otherTaskId: string; similarity: number; confidence: number; reason: string }
export type MergeSink = MergeCandidate[];

// ───────────────────────── 결과 보정 (1.1.0)
const clamp = (x: number) => Math.round(Math.min(CLASSIFIER_TUNING.confidenceMax, Math.max(CLASSIFIER_TUNING.confidenceMin, x)) * 100) / 100;

/** 1.4.0 저장용 대화 결과(대화 상태는 읽을 때 날짜로 계산) */
export interface StoredOutcome { outcome: OutcomeKind; target: string | null; evidence: string | null; reason: string | null; detectedBy: 'llm' | 'rule' | 'both' }
export interface Refined { out: LlmClassification; rawConfidence: number | null; handoff: Omit<HandoffInfo, 'conversationId'> | null; corrected: string | null; outcome: StoredOutcome }

/**
 * 1.4.0 대화 결과 정하기. 규칙의 끊김/이동 문장 패턴(strong)이 LLM보다 우선(끊김 > 이동), 그다음 LLM 값, 없으면 규칙.
 * 일관성: handoff인데 done/open이면 moved, resolution이 resolved/abandoned인데 open이면 done.
 */
export function resolveOutcome(out: LlmClassification, sig: ReturnType<typeof endingSignals>, llmOutcome: OutcomeKind | null): StoredOutcome {
  const rule = detectOutcome(sig, out.kind, out.resolution);
  let o: OutcomeKind, by: StoredOutcome['detectedBy'];
  if (rule.strong && rule.outcome === 'interrupted') { o = 'interrupted'; by = llmOutcome === 'interrupted' ? 'both' : 'rule'; }
  else if (llmOutcome) { o = llmOutcome; by = llmOutcome === rule.outcome ? 'both' : 'llm'; }
  else { o = rule.outcome; by = 'rule'; }
  if (out.handoff && (o === 'done' || o === 'open')) { o = 'moved'; by = by === 'llm' ? 'both' : by; }
  if (o === 'open' && (out.resolution === 'resolved' || out.resolution === 'abandoned')) o = 'done';
  const target = o === 'moved' || o === 'interrupted' ? out.handoff_target ?? rule.target ?? null : null;
  return { outcome: o, target, evidence: rule.evidence, reason: o === 'interrupted' ? rule.reason : null, detectedBy: by };
}

/**
 * LLM 결과를 규칙 신호와 맞춰 본다. 같은 입력이면 항상 같은 결과.
 *  1) handoff(LLM 또는 규칙) → kind=task, resolution=unresolved (다른 곳에서 이어감 ≠ 완료)
 *  2) 이어가기 표현("내일 …해보자", "오늘은 여기까지")으로 끝났는데 resolved/quick_question → unresolved task
 *  3) 확신도: 0.05..0.95로 자름, 보정했으면 ≤0.7, 규칙과 결론이 다르면 낮춤(끝 신호가 분명하면 ≤0.65), 메시지 2개 이하 과제면 ≤0.7
 */
export function refineClassification(llm: LlmClassification, input: ClassifyInput, isLlm: boolean): Refined {
  const sig = endingSignals(input.messages);
  const out: LlmClassification = { ...llm, topics: [...llm.topics], same_task_candidates: [...llm.same_task_candidates] };
  if (!isLlm) {
    const h = out.handoff ? { label: handoffLabel(out.handoff_target), target: out.handoff_target, evidence: sig.handoff?.evidence ?? out.evidence, detectedBy: 'rule' as const } : null;
    const outcome = resolveOutcome(out, sig, null);
    out.conversation_outcome = outcome.outcome;
    return { out, rawConfidence: null, handoff: h, corrected: null, outcome };
  }
  const raw = llm.confidence;
  let corrected: string | null = null;
  const ruleSaysHandoff = sig.handoff !== null;
  let handoff: Refined['handoff'] = null;
  if (llm.handoff || ruleSaysHandoff) {
    const target = llm.handoff_target ?? sig.handoff?.target ?? null;
    handoff = { label: handoffLabel(target), target, evidence: sig.handoff?.evidence ?? llm.evidence, detectedBy: llm.handoff && ruleSaysHandoff ? 'both' : llm.handoff ? 'llm' : 'rule' };
    out.handoff = true; out.handoff_target = target;
    if (out.resolution !== 'unresolved' || out.kind !== 'task') corrected = `${handoff.label} — 완료가 아니라 미해결로 보정`;
    out.resolution = 'unresolved'; out.kind = 'task';
  } else if (sig.continueCue && !sig.abandonCue && (out.resolution === 'resolved' || out.kind === 'quick_question')) {
    corrected = `“${sig.continueCue.slice(0, 30)}”로 끝나 미해결로 보정`;
    out.resolution = 'unresolved'; out.kind = 'task';
  }
  if (corrected) out.evidence = `[보정] ${corrected}${llm.evidence ? ` · 모델 근거: ${llm.evidence}` : ''}`.slice(0, 500);
  if (out.resolution === 'unresolved' && !out.next_step && handoff) out.next_step = `${handoff.target ?? '다른 곳'}에서 이어서 진행`;
  // 확신도 보정
  const rule = ruleClassify(input);
  let c = clamp(raw);
  if (corrected) c = Math.min(c, 0.7);
  else if (rule.resolution !== out.resolution) c = sig.strong ? Math.min(c, 0.65) : c - 0.05;
  if (rule.kind !== out.kind) c -= 0.05;
  if (out.kind === 'task' && input.messages.length <= 2) c = Math.min(c, 0.7);
  out.confidence = clamp(c);
  const outcome = resolveOutcome(out, sig, llm.conversation_outcome);
  out.conversation_outcome = outcome.outcome;
  return { out, rawConfidence: raw, handoff, corrected, outcome };
}

export async function classifyConversation(core: Core, convId: string, classifier: Classifier = core.classifier(), opts: { mergeSink?: MergeSink; refreshCache?: boolean } = {}): Promise<ClassifyOutcome> {
  const db = core.db;
  const conv = db.get('SELECT * FROM conversations WHERE id=?', convId);
  if (!conv) throw new Error(`대화 없음: ${convId}`);
  const s = core.settings.get();
  const messages = db.all<{ role: MessageRole; content_md: string }>('SELECT role, content_md FROM messages WHERE conversation_id=? ORDER BY seq', convId)
    .map((m) => ({ role: m.role, content: m.content_md }));
  // 1.2.0 cls-v3 재현성: 입력은 실행 시각이 아니라 이 대화(내용·날짜)로만 정해지게 한다
  //  - 이전 요약: 이 대화의 예전 내용(content_hash가 다른 것)을 분류한 결과만. 같은 내용을 다시 돌릴 때 자기 답을 다시 넣지 않음
  //  - 기준 날짜·최근 과제 창: 대화 마지막 활동일 ±30일, 순서 고정
  const prev = db.get<{ summary: string | null }>("SELECT summary FROM classifications WHERE conversation_id=? AND state='ok' AND content_hash IS NOT NULL AND content_hash<>? ORDER BY id DESC LIMIT 1", convId, String(conv.content_hash));
  const projects = db.all<{ name: string; aliases_json: string }>('SELECT name, aliases_json FROM projects ORDER BY created_at, id').map((p) => ({ name: p.name, aliases: json<string[]>(p.aliases_json, []) }));
  const anchorDay = kstDate(String(conv.updated_at));
  const recentTasks = db.all<{ conversation_id: string; title: string; summary: string | null }>(
    `SELECT c.id AS conversation_id, t.title, t.summary FROM tasks t JOIN conversations c ON c.task_id=t.id
     WHERE t.last_activity_at >= ? AND t.last_activity_at < ? AND t.kind='task' AND c.id<>? AND t.id IS NOT ? ORDER BY t.last_activity_at DESC, c.id LIMIT 40`,
    startOfDayIso(addDays(anchorDay, -30)), startOfDayIso(addDays(anchorDay, 31)), convId, str(conv.task_id));
  const sensitive = s.llm.sensitiveKeywords.some((k) => k && `${conv.title}`.includes(k)) || (conv.task_id && s.llm.sensitiveProjectIds.includes(String(db.value<string>('SELECT project_id FROM tasks WHERE id=?', String(conv.task_id)) ?? '')));
  // 민감 프로젝트·키워드(§12.2)이거나 짧은 간단한 질문이면 LLM 대신 규칙 분류기
  const use: Classifier = classifier.isLlm && (sensitive || isQuickCandidate(messages)) ? new RuleClassifier() : classifier;
  const input: ClassifyInput = {
    sourceAi: String(conv.source_ai), title: String(conv.title ?? ''), createdAt: String(conv.created_at), updatedAt: String(conv.updated_at), messages,
    previousSummary: prev?.summary ?? null, projects, recentTasks: recentTasks.map((r) => ({ conversationId: r.conversation_id, title: r.title, summary: r.summary })), today: anchorDay,
    condensed: condense(messages, { head: s.classification.condenseHead, tail: s.classification.condenseTail, middleChars: s.classification.condenseMiddleChars, redact: s.llm.redactSecrets }),
  };
  let res;
  try { res = await classifyWithCache(db, use, input, { refresh: opts.refreshCache }); }
  catch (e) {
    if (e instanceof ProviderBlockedError) {
      // 분류 불가: 규칙 결과로 상태는 채우되 blocked로 표시. 같은 내용이면 다시 보내지 않는다(conversationsForScope)
      const fallback = await new RuleClassifier().classify(input);
      const ref = refineClassification(fallback.output, input, false);
      applyClassification(core, convId, ref.out, { model: MOCK_MODEL, inputTokens: e.inputTokens, outputTokens: e.outputTokens, costUsd: null, handoff: ref.handoff, outcome: ref.outcome, blocked: { reason: e.reason, model: e.model }, mergeSink: opts.mergeSink });
      return { costUsd: null, inputTokens: e.inputTokens, outputTokens: e.outputTokens, model: MOCK_MODEL, blocked: true };
    }
    throw new ApiError('LLM_UNAVAILABLE', `분류 모델 호출에 실패했어요: ${e instanceof Error ? e.message : String(e)}`);
  }
  const ref = refineClassification(res.output, input, use.isLlm);
  applyClassification(core, convId, ref.out, { model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: res.costUsd, rawConfidence: ref.rawConfidence, handoff: ref.handoff, outcome: ref.outcome, mergeSink: opts.mergeSink, cacheHit: res.cached });
  return { costUsd: res.costUsd, inputTokens: res.inputTokens, outputTokens: res.outputTokens, model: res.model, blocked: false, cached: res.cached };
}

export interface ApplyMeta {
  model: string; inputTokens: number; outputTokens: number; costUsd: number | null; at?: string;
  rawConfidence?: number | null;
  handoff?: Omit<HandoffInfo, 'conversationId'> | null;
  /** 1.4.0 대화 결과. 없으면 규칙으로 정함 */
  outcome?: StoredOutcome | null;
  blocked?: { reason: string; model: string } | null;
  /** 1.2.0 응답 캐시에서 꺼낸 결과 */
  cacheHit?: boolean;
  /** 있으면 같은 과제 후보를 바로 만들지 않고 모았다가 실행 끝에 commitMergeCandidates로 거른다 */
  mergeSink?: MergeSink;
}

/** 같은 과제 후보 유사도: 이 대화(제목·요약·주제) ↔ 후보 과제(제목·요약·주제·대화 제목) */
export function mergeSimilarity(core: Core, conv: { title: string }, out: Pick<LlmClassification, 'summary' | 'topics'>, otherTaskId: string): number {
  const db = core.db;
  const o = db.get<{ title: string; summary: string | null }>('SELECT title, summary FROM tasks WHERE id=?', otherTaskId);
  if (!o) return 0;
  const otherTopics = db.all<{ name: string }>('SELECT o.name FROM task_topics tt JOIN objects o ON o.id=tt.topic_id WHERE tt.task_id=?', otherTaskId).map((r) => r.name);
  const otherTitles = db.all<{ title: string | null }>('SELECT c.title FROM task_conversations tc JOIN conversations c ON c.id=tc.conversation_id WHERE tc.task_id=?', otherTaskId).map((r) => r.title ?? '');
  const a = bigrams([conv.title, out.summary, ...out.topics].join(' '));
  const b = bigrams([o.title, o.summary ?? '', ...otherTopics, ...otherTitles].join(' '));
  return Math.round(dice(a, b) * 1000) / 1000;
}

/** 모은 후보를 거른 뒤 제안으로 만든다. 같은 과제가 한 실행에서 N번 넘게 찍히면 유사도 strong 미만은 버린다 */
export function commitMergeCandidates(core: Core, cands: MergeCandidate[], at = nowIso()): { created: number; droppedHub: number } {
  const db = core.db;
  const byTarget = new Map<string, number>();
  for (const c of cands) byTarget.set(c.otherTaskId, (byTarget.get(c.otherTaskId) ?? 0) + 1);
  let created = 0, droppedHub = 0;
  db.tx(() => {
    for (const c of cands) {
      if ((byTarget.get(c.otherTaskId) ?? 0) > CLASSIFIER_TUNING.mergeMaxPerTargetPerRun && c.similarity < CLASSIFIER_TUNING.mergeStrongSimilarity) { droppedHub++; continue; }
      if (!db.get('SELECT 1 FROM tasks WHERE id=?', c.taskId) || !db.get('SELECT 1 FROM tasks WHERE id=?', c.otherTaskId) || c.taskId === c.otherTaskId) continue;
      if (db.get('SELECT 1 FROM task_merge_suggestions WHERE (task_a=? AND task_b=?) OR (task_a=? AND task_b=?)', c.taskId, c.otherTaskId, c.otherTaskId, c.taskId)) continue;
      const older = db.value<string>('SELECT id FROM tasks WHERE id IN (?,?) ORDER BY started_at LIMIT 1', c.taskId, c.otherTaskId) ?? c.otherTaskId;
      db.run('INSERT INTO task_merge_suggestions(id,task_a,task_b,suggested_primary,confidence,reason,state,created_at) VALUES (?,?,?,?,?,?,?,?)',
        `ms_${randomId(4)}`, older, older === c.taskId ? c.otherTaskId : c.taskId, older, c.confidence, c.reason, 'pending', at);
      created++;
    }
  });
  return { created, droppedHub };
}

/** 분류 결과 저장 + 과제 반영. 사용자가 고친 필드(overrides)는 바꾸지 않는다(§6.2 필드 소유권) */
export function applyClassification(core: Core, convId: string, out: LlmClassification, meta: ApplyMeta): number {
  const db = core.db;
  const at = meta.at ?? nowIso();
  const isRule = meta.model === MOCK_MODEL;
  const topicOrigin: 'rule' | 'llm' = isRule ? 'rule' : 'llm';
  const handoff: HandoffInfo | null = meta.handoff ? { ...meta.handoff, conversationId: convId } : null;
  const pendingMerges: MergeCandidate[] = [];
  const clsId = db.tx(() => {
    const conv = db.get('SELECT * FROM conversations WHERE id=?', convId)!;
    const clsId = db.run(`INSERT INTO classifications(conversation_id,kind,resolution,summary,next_step,evidence,project_guess,topics_json,confidence,model,prompt_version,input_tokens,output_tokens,cost_usd,created_at,detail_json,decisions_json,open_questions_json,same_task_candidates_json,
        state,blocked_reason,blocked_model,raw_confidence,handoff_json,new_project_suggestion,cache_hit,content_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, convId, out.kind, out.resolution, out.summary, out.next_step, out.evidence, out.project, JSON.stringify(out.topics), out.confidence,
      meta.model, PROMPT_VERSION, meta.inputTokens, meta.outputTokens, meta.costUsd, at, JSON.stringify(out.detail), JSON.stringify(out.decisions),
      JSON.stringify(out.open_questions), JSON.stringify(out.same_task_candidates),
      meta.blocked ? 'blocked' : 'ok', meta.blocked?.reason ?? null, meta.blocked?.model ?? null, meta.rawConfidence ?? null, handoff ? JSON.stringify(handoff) : null, out.new_project_suggestion, meta.cacheHit ? 1 : 0, str(db.value<string>('SELECT content_hash FROM conversations WHERE id=?', convId))).lastInsertRowid;
    const outcome = meta.outcome ?? resolveOutcome(out, endingSignals(db.all<{ role: MessageRole; content_md: string }>('SELECT role, content_md FROM messages WHERE conversation_id=? ORDER BY seq', convId).map((m) => ({ role: m.role, content: m.content_md }))), out.conversation_outcome ?? null);
    // 1.5.0 라벨 글도 저장(outcome_json.label + outcome_label 열) — 화면·볼트·검색이 같은 글을 씀
    const label = outcomeLabel(outcome.outcome, outcome.target, outcome.reason);
    const stored = JSON.stringify({ ...outcome, label });
    db.run('UPDATE classifications SET conversation_outcome=?, outcome_json=?, outcome_label=? WHERE id=?', outcome.outcome, stored, label, clsId);
    db.run('UPDATE conversations SET classified_hash=content_hash, outcome=?, outcome_json=?, outcome_label=? WHERE id=?', outcome.outcome, stored, label, convId);
    const taskId = str(conv.task_id);
    if (!taskId) return clsId;
    const task = db.get('SELECT * FROM tasks WHERE id=?', taskId)!;
    const overrides = json<string[]>(task.overrides_json, []);
    const latest = db.value<string>("SELECT c.id FROM task_conversations tc JOIN conversations c ON c.id=tc.conversation_id WHERE tc.task_id=? AND tc.role='primary' ORDER BY c.updated_at DESC LIMIT 1", taskId);
    const tail = taskId.replace(/^task_/, '');
    let projectSet = false;
    if (latest === convId) {
      db.run('UPDATE tasks SET kind=?, resolution=?, summary=?, summary_detail_json=?, confidence=?, classification_id=?, handoff_json=?, resume_prompt=NULL, updated_at=? WHERE id=?',
        out.kind, out.resolution, out.summary, JSON.stringify(out.detail), out.confidence, clsId, handoff ? JSON.stringify(handoff) : null, at, taskId);
      if (!overrides.includes('next_step')) db.run('UPDATE tasks SET next_step=? WHERE id=?', out.next_step, taskId);
      if (!overrides.includes('project') && out.project) {
        const pid = findProjectByName(core, out.project);
        if (pid) { db.run('UPDATE tasks SET project_id=? WHERE id=?', pid, taskId); projectSet = true; }
      }
    }
    // 새 프로젝트 제안(1.1.0): 프로젝트가 없고 사용자가 고정하지 않은 과제만. 규칙 분류·분류 불가는 제안을 건드리지 않는다.
    // 1.2.0: 간단한 질문은 제안에서 뗀다(누가 분류했든)
    if (out.kind === 'quick_question') recordProjectSuggestion(core, { taskId, conversationId: convId, name: null, confidence: out.confidence, at });
    else if (!isRule && !meta.blocked && !projectSet && !overrides.includes('project') && !db.value<string>('SELECT project_id FROM tasks WHERE id=?', taskId)) {
      const unmatchedProject = out.project && !findProjectByName(core, out.project) ? out.project : null;
      recordProjectSuggestion(core, { taskId, conversationId: convId, name: out.new_project_suggestion ?? unmatchedProject, confidence: out.confidence, at });
    }
    // 결정 (원본 = 결정 객체, §8.2)
    if (!overrides.includes('decisions')) {
      for (const text of out.decisions) {
        const nn = normName(text);
        if (db.get("SELECT 1 FROM objects WHERE type='decision' AND ref_id=? AND norm_name=?", taskId, nn)) continue;
        db.run("INSERT INTO objects(id,type,name,norm_name,ref_table,ref_id,properties_json,status,confidence,first_seen_at,last_seen_at,mention_count,origin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
          `obj_decision_${randomId(4)}`, 'decision', text, nn, 'tasks', taskId, JSON.stringify({ conversationId: convId, sourceAi: conv.source_ai as SourceAi, decidedAt: conv.updated_at, valid: true, overridden: false }),
          'accepted', out.confidence, at, at, 1, topicOrigin);
      }
      syncDecisionsCopy(core, taskId);
    }
    // 열린 질문: 이 대화에서 나온 미해결 항목만 새 목록으로 바꿈(해결된 것은 둠)
    if (!overrides.includes('open_questions')) {
      const cur = json<Array<{ id: string; text: string; resolved: boolean; note: string | null; sourceConversationId: string | null; resolvedAt: string | null }>>(task.open_questions_json, []);
      const kept = cur.filter((q) => q.resolved || q.sourceConversationId !== convId);
      let n = Math.max(0, ...cur.map((q) => Number(q.id.split('_').at(-1)) || 0));
      for (const text of out.open_questions) if (!kept.some((q) => q.text === text)) kept.push({ id: `oq_${tail}_${++n}`, text, resolved: false, note: null, sourceConversationId: convId, resolvedAt: null });
      db.run('UPDATE tasks SET open_questions_json=? WHERE id=?', JSON.stringify(kept), taskId);
    }
    replaceTopics(core, taskId, convId, out, topicOrigin, at);
    // 같은 과제 후보 → 합치기 제안(§7.6). 유사도 하한 미만은 버리고, 거절한 쌍은 다시 제안하지 않음
    for (const cand of out.same_task_candidates) {
      const other = db.value<string>('SELECT task_id FROM conversations WHERE id=?', cand);
      if (!other || other === taskId) continue;
      const sim = mergeSimilarity(core, { title: String(conv.title ?? '') }, out, other);
      if (sim < CLASSIFIER_TUNING.mergeMinSimilarity) continue;
      const confidence = Math.round(Math.min(out.confidence, 0.45 + sim) * 0.9 * 100) / 100;
      pendingMerges.push({ taskId, otherTaskId: other, similarity: sim, confidence, reason: `분류기가 같은 과제일 수 있다고 봄(제목·요약 유사도 ${sim.toFixed(2)}) — ${out.summary}` });
    }
    refreshTask(core, taskId, 'classifier');
    core.vault.scheduleTask(taskId);
    return clsId;
  });
  if (meta.mergeSink) meta.mergeSink.push(...pendingMerges);
  else if (pendingMerges.length) commitMergeCandidates(core, pendingMerges, at);
  // 1.7.0 분류가 끝나면 규칙 온톨로지 추출(키 없이, 비용 0)
  afterClassification(core, str(db.value<string>('SELECT task_id FROM conversations WHERE id=?', convId)));
  return clsId;
}

/**
 * 주제 교체(1.1.0): 이 분류가 붙일 주제로 바꾼다. 떼는 것 = 같은 출처가 이 대화에서 붙였던 주제 + (LLM 분류면) 규칙이 붙였던 주제 전부.
 * 사용자(user)·시드(seed)·출처 불명(NULL) 주제는 그대로 둔다. 더 이상 어디에도 안 붙은 분류기 주제 객체는 지운다(별칭·관계가 있으면 둠).
 */
function replaceTopics(core: Core, taskId: string, convId: string, out: LlmClassification, origin: 'rule' | 'llm', at: string): void {
  const db = core.db;
  const stale = db.all<{ topic_id: string }>(
    `SELECT topic_id FROM task_topics WHERE task_id=? AND (
       (origin='rule' AND (?='llm' OR conversation_id=? OR conversation_id IS NULL)) OR
       (origin='llm' AND ?='llm' AND (conversation_id=? OR conversation_id IS NULL)))`, taskId, origin, convId, origin, convId).map((r) => r.topic_id);
  const keepNorms = new Set(out.topics.map(normName).filter(Boolean));
  for (const tid of stale) {
    const nn = db.value<string>('SELECT norm_name FROM objects WHERE id=?', tid);
    if (nn && keepNorms.has(nn)) continue; // 다시 나온 주제는 떼지 않고 아래에서 출처만 갱신
    db.run('DELETE FROM task_topics WHERE task_id=? AND topic_id=?', taskId, tid);
    // 1.7.0 규칙이 만든 과제→주제 related_to도 같이 뗌(근거가 task_topics였으므로)
    for (const l of db.all<{ id: number }>("SELECT l.id FROM links l JOIN objects o ON o.id=l.src_id WHERE l.type='related_to' AND l.origin='rule' AND l.dst_id=? AND o.ref_table='tasks' AND o.ref_id=?", tid, taskId)) {
      db.run("DELETE FROM evidence WHERE target_kind='link' AND target_id=?", String(l.id)); db.run('DELETE FROM links WHERE id=?', l.id);
    }
    db.run('UPDATE objects SET mention_count=MAX(0, mention_count-1) WHERE id=?', tid);
    if (!db.get('SELECT 1 FROM task_topics WHERE topic_id=?', tid) && !db.get('SELECT 1 FROM aliases WHERE object_id=?', tid)
      && !db.get('SELECT 1 FROM links WHERE src_id=? OR dst_id=?', tid, tid) && db.get("SELECT 1 FROM objects WHERE id=? AND origin IN ('rule','llm') AND status<>'merged'", tid)) {
      db.run('DELETE FROM objects WHERE id=?', tid);
    }
  }
  for (const name of out.topics) {
    const nn = normName(name);
    if (!nn) continue;
    let tid = db.value<string>("SELECT id FROM objects WHERE type='topic' AND norm_name=? AND status<>'merged'", nn)
      ?? db.value<string>("SELECT a.object_id FROM aliases a JOIN objects o ON o.id=a.object_id WHERE a.norm_alias=? AND o.type='topic'", nn);
    if (!tid) {
      tid = `obj_topic_${randomId(6)}`;
      db.run("INSERT INTO objects(id,type,name,norm_name,status,confidence,first_seen_at,last_seen_at,mention_count,origin) VALUES (?,?,?,?,?,?,?,?,?,?)",
        tid, 'topic', name, nn, out.confidence >= 0.6 ? 'accepted' : 'suggested', out.confidence, at, at, 0, origin);
    }
    const cur = db.get<{ origin: string | null }>('SELECT origin FROM task_topics WHERE task_id=? AND topic_id=?', taskId, tid);
    if (!cur) {
      db.run('INSERT INTO task_topics(task_id,topic_id,confidence,created_at,origin,conversation_id) VALUES (?,?,?,?,?,?)', taskId, tid, out.confidence, at, origin, convId);
      db.run('UPDATE objects SET mention_count=mention_count+1, last_seen_at=? WHERE id=?', at, tid);
    } else if (cur.origin === 'rule' || cur.origin === 'llm') {
      db.run('UPDATE task_topics SET origin=?, conversation_id=?, confidence=? WHERE task_id=? AND topic_id=?', origin === 'llm' || cur.origin === 'rule' ? origin : cur.origin, convId, out.confidence, taskId, tid);
    }
  }
}

/** 분류 작업 본문(큐에서, 또는 가져오기 작업 안에서 바로 실행) */
export async function runClassification(core: Core, jobId: string, convIds: string[], opts: { maxCostUsd?: number | null; ctl?: JobCtl; onProgress?: (done: number, total: number) => void; refreshCache?: boolean } = {}):
  Promise<{ classified: number; deferred: number; failed: number; blocked: number; cacheHits: number; costUsd: number | null; state: 'done' | 'deferred' | 'cancelled' }> {
  const db = core.db;
  const classifier = core.classifier();
  const cap = core.settings.get().llm.dailyCostCapUsd;
  const mergeSink: MergeSink = [];
  let classified = 0, failed = 0, blocked = 0, cacheHits = 0, cost: number | null = null, i = 0;
  const finish = <S extends 'done' | 'deferred' | 'cancelled'>(state: S, deferred: number) => {
    commitMergeCandidates(core, mergeSink);
    consolidateProjectSuggestions(core); // 1.2.0 비슷한 새 프로젝트 제안 합치기
    return { classified, deferred, failed, blocked, cacheHits, costUsd: cost, state };
  };
  const setJob = (p: number) => { if (opts.ctl) opts.ctl.progress(p, convIds.length); else db.run('UPDATE jobs SET processed=?, total=? WHERE id=?', p, convIds.length, jobId); };
  for (const id of convIds) {
    if (opts.ctl?.cancelled()) return finish('cancelled', convIds.length - i);
    const spent = todayUsage(core).costUsdKnown;
    if (classifier.isLlm && ((cap !== null && spent >= cap) || (opts.maxCostUsd != null && (cost ?? 0) >= opts.maxCostUsd))) {
      return finish('deferred', convIds.length - i);
    }
    try {
      const r = await classifyConversation(core, id, classifier, { mergeSink, refreshCache: opts.refreshCache });
      classified++;
      if (r.blocked) blocked++;
      if (r.cached) cacheHits++;
      if (r.costUsd !== null) { cost = (cost ?? 0) + r.costUsd; opts.ctl?.addCost(r.costUsd); if (!opts.ctl) db.run('UPDATE jobs SET cost_usd=COALESCE(cost_usd,0)+? WHERE id=?', r.costUsd, jobId); }
    } catch (e) {
      failed++;
      db.run('UPDATE jobs SET error=? WHERE id=?', e instanceof Error ? e.message : String(e), jobId);
    }
    i++;
    setJob(i);
    opts.onProgress?.(i, convIds.length);
    if (i % 20 === 0) await new Promise((r) => setImmediate(r));
  }
  return finish('done', 0);
}

/** 분류 작업을 만들어 큐에 넣는다 */
export function enqueueClassification(core: Core, convIds: string[], label: string, parentId: string | null = null, opts: { refreshCache?: boolean } = {}): string {
  const jobId = core.queue.create('classify', label, { parentId, total: convIds.length, payload: { conversationIds: convIds.length, ...(opts.refreshCache ? { refreshCache: true } : {}) } });
  core.queue.enqueue(jobId, async (ctl) => {
    const r = await runClassification(core, jobId, convIds, { ctl, refreshCache: opts.refreshCache });
    if (r.failed && !r.classified && convIds.length) throw new Error(`분류 ${r.failed}건 모두 실패`);
    return r.state;
  });
  return jobId;
}

/**
 * 1.1.0: 분류 불가(blocked)이고 그 뒤로 내용이 안 바뀐 대화는 어떤 범위에서도 빼고(force면 포함) 다시 보내지 않는다.
 * 사용자가 과제 하나를 직접 다시 분류(POST /tasks/:id/reclassify)하면 이 규칙과 상관없이 다시 시도한다.
 */
const NOT_BLOCKED = `NOT (classified_hash IS content_hash AND EXISTS (SELECT 1 FROM classifications k WHERE k.id=(SELECT MAX(id) FROM classifications WHERE conversation_id=conversations.id) AND k.state='blocked'))`;
export function conversationsForScope(core: Core, scope: string, opts: { conversationIds?: string[]; projectId?: string; force?: boolean }): string[] {
  const db = core.db;
  const thr = core.settings.get().classification.lowConfidenceThreshold;
  const ok = (ids: string[]) => {
    if (opts.force || !ids.length) return ids;
    const allowed = new Set(db.all<{ id: string }>(`SELECT id FROM conversations WHERE id IN (SELECT value FROM json_each(?)) AND ${NOT_BLOCKED}`, JSON.stringify(ids)).map((r) => r.id));
    return ids.filter((id) => allowed.has(id));
  };
  switch (scope) {
    case 'unclassified': return ok(db.all<{ id: string }>('SELECT id FROM conversations WHERE id NOT IN (SELECT DISTINCT conversation_id FROM classifications) ORDER BY updated_at').map((r) => r.id));
    case 'changed': return ok(db.all<{ id: string }>(opts.force ? 'SELECT id FROM conversations ORDER BY updated_at' : 'SELECT id FROM conversations WHERE classified_hash IS NULL OR classified_hash<>content_hash ORDER BY updated_at').map((r) => r.id));
    case 'needs_review': return ok(db.all<{ id: string }>(`SELECT (SELECT c.id FROM task_conversations tc JOIN conversations c ON c.id=tc.conversation_id WHERE tc.task_id=t.id AND tc.role='primary' ORDER BY c.updated_at DESC LIMIT 1) AS id
      FROM tasks t LEFT JOIN classifications cl ON cl.id=t.classification_id WHERE (t.confidence < ? OR cl.state='blocked') AND t.status<>'보관'`, thr).map((r) => r.id).filter(Boolean));
    case 'conversations': return ok((opts.conversationIds ?? []).filter((id) => db.get('SELECT 1 FROM conversations WHERE id=?', id)));
    case 'project': return ok(db.all<{ id: string }>("SELECT c.id FROM conversations c JOIN task_conversations tc ON tc.conversation_id=c.id AND tc.role='primary' JOIN tasks t ON t.id=tc.task_id WHERE t.project_id=?", opts.projectId ?? '').map((r) => r.id));
    default: return [];
  }
}
