/**
 * Phase 3 (계약 1.1.0) — 실제 Claude 내보내기(29개 대화)를 gemini-3.5-flash-lite로 분류하며 드러난 문제들의 회귀 테스트.
 *  2 같은 과제 후보 남발 · 3 handoff/'내일' · 4 안전 차단(분류 불가) · 5 확신도/주제 교체/새 프로젝트 제안/시작 로그 · 6 카테고리 ZIP · 시계 고정
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import * as S from '@subbrain/shared/schemas';
import { CLASSIFIER_TUNING, DEFAULT_MODEL, HANDOFF_LABEL, MOCK_MODEL, PROMPT_VERSION, PROVIDER_ENV_KEY } from '@subbrain/shared/constants';
import type { LlmClassification } from '@subbrain/shared/schemas';
import { makeCore, NOW } from './helpers.ts';
import { upsertConversation, createImport, getImport, startImport } from '../src/services/imports.ts';
import { classifyConversation, commitMergeCandidates, conversationsForScope, refineClassification, runClassification } from '../src/services/classify.ts';
import { ruleClassify } from '../src/classifier/rule-classifier.ts';
import { endingSignals } from '../src/classifier/signals.ts';
import { ProviderBlockedError, blockReasonFromError, type Classifier, type ClassifyInput, type ClassifyResult } from '../src/classifier/provider.ts';
import { blockedReason, supportsTemperature } from '../src/classifier/ai-sdk-classifier.ts';
import { SYSTEM_PROMPT } from '../src/classifier/prompt.ts';
import type { NormalizedConversation } from '../src/importers/types.ts';
import { nowIso } from '../src/util/time.ts';
import { generateDigest } from '../src/digest/digest.ts';

type T = Awaited<ReturnType<typeof makeCore>>;
let t: T;
beforeEach(async () => { t = await makeCore(); });
afterEach(() => t.close());

// ───────── 도우미
let seq = 0;
function conv(title: string, userLines: string[], opts: { id?: string; updatedAt?: string } = {}): NormalizedConversation {
  const id = opts.id ?? `src-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
  const at = opts.updatedAt ?? '2026-09-28T10:00:00+09:00';
  const messages = userLines.flatMap((u, i) => [
    { role: 'user' as const, content: u, createdAt: at },
    { role: 'assistant' as const, content: `${i + 1}번째 답변입니다. 자세한 설명을 드릴게요.`, createdAt: at },
  ]);
  return { sourceAi: 'claude', sourceId: id, title, createdAt: '2026-09-27T10:00:00+09:00', updatedAt: at, messages, archived: false, inServiceProject: false, hasUnextractedArtifact: false };
}
const add = (c: NormalizedConversation) => upsertConversation(t.core, c, { importId: null, rawPath: null });
const LONG = ['첫 질문이에요 어떻게 시작하면 좋을까요', '두 번째 질문 이어서 볼게요', '세 번째 질문도 있어요'];

class FakeLlm implements Classifier {
  readonly name = 'google'; readonly model = 'fake-flash'; readonly isLlm = true;
  calls = 0;
  constructor(private fn: (input: ClassifyInput) => Partial<LlmClassification> | Error) {}
  async classify(input: ClassifyInput): Promise<ClassifyResult> {
    this.calls++;
    const r = this.fn(input);
    if (r instanceof Error) throw r;
    return { output: S.LlmClassificationSchema.parse({ kind: 'task', resolution: 'unresolved', summary: `${input.title} 작업`, confidence: 0.9, ...r }), model: this.model, inputTokens: 100, outputTokens: 50, costUsd: null };
  }
}
const input = (users: string[], title = '테스트'): ClassifyInput => ({
  sourceAi: 'claude', title, createdAt: '2026-09-29T10:00:00+09:00', updatedAt: '2026-09-29T11:00:00+09:00',
  messages: users.flatMap((u) => [{ role: 'user' as const, content: u }, { role: 'assistant' as const, content: '답변이에요. 설명을 이어갈게요.' }]),
  previousSummary: null, projects: [], recentTasks: [], today: '2026-09-30', condensed: '',
});
const llmOut = (o: Partial<LlmClassification>): LlmClassification => S.LlmClassificationSchema.parse({ kind: 'task', resolution: 'resolved', summary: '요약', confidence: 1, ...o });
async function run(ids: string[]) { return runClassification(t.core, t.core.queue.create('classify', 'test', { total: ids.length }), ids); }
async function until<R>(fn: () => R | null | undefined | false, ms = 4000): Promise<R> {
  const t0 = Date.now();
  for (;;) { const r = fn(); if (r) return r; if (Date.now() - t0 > ms) throw new Error('시간 초과'); await new Promise((res) => setTimeout(res, 10)); }
}

// ───────── 1. 기본 모델
describe('1 기본 모델 (Google 공식 문서 2026-10 기준)', () => {
  it('Google 기본값은 새 사용자도 쓸 수 있는 gemini-3.5-flash-lite, 2.5 계열 아님', () => {
    expect(DEFAULT_MODEL.google).toBe('gemini-3.5-flash-lite');
    for (const m of Object.values(DEFAULT_MODEL)) expect(m).not.toMatch(/gemini-2\.5|grok-3-mini|gpt-5-mini/);
  });
  it('Gemini 3.x · GPT-5+/o 계열은 temperature를 보내지 않는다', () => {
    expect(supportsTemperature({ provider: 'google', model: 'gemini-3.5-flash-lite' })).toBe(false);
    expect(supportsTemperature({ provider: 'openai', model: 'gpt-6-luna' })).toBe(false);
    expect(supportsTemperature({ provider: 'anthropic', model: 'claude-haiku-4-5' })).toBe(true);
  });
});

// ───────── 2. 같은 과제 후보
describe('2 같은 과제 후보 거르기', () => {
  it('최근 과제가 하나뿐이라 모델이 전부 그 과제를 후보로 찍어도, 글자 유사도가 낮으면 버리고 진짜 비슷한 것만 제안', async () => {
    const hub = add(conv('Gemini 팟캐스트 자막 변환 도구 개발', ['Gemini로 팟캐스트 자막을 변환하는 도구를 만들자', 'API 연결 해보자', '자막 프리셋도 넣자']));
    await classifyConversation(t.core, hub.conversationId); // 규칙 분류로 허브 과제 요약·주제 채움
    const unrelated = ['이사 견적 비교', '블로그 SEO 글쓰기', '디자이너 피드백 요청', '엑셀 매크로 오류', '여행 일정 짜기', '영어 이메일 교정']
      .map((title) => add(conv(title, LONG)).conversationId);
    const related = add(conv('Gemini 팟캐스트 자막 변환 2 — 자막 프리셋 추가', LONG)).conversationId;
    t.core.classifierOverride = new FakeLlm((inp) => ({
      summary: inp.title.includes('Gemini') ? 'Gemini 팟캐스트 자막 변환 도구에 자막 프리셋 추가' : `${inp.title} 관련 작업`,
      same_task_candidates: [hub.conversationId], confidence: 0.9,
    }));
    await run([...unrelated, related]);
    const sugs = t.core.db.all<{ task_a: string; task_b: string; confidence: number }>('SELECT task_a, task_b, confidence FROM task_merge_suggestions');
    expect(sugs).toHaveLength(1);
    const relTask = t.core.db.value<string>('SELECT task_id FROM conversations WHERE id=?', related)!;
    expect([sugs[0]!.task_a, sugs[0]!.task_b].sort()).toEqual([hub.taskId!, relTask].sort());
    expect(sugs[0]!.confidence).toBeLessThan(0.9); // 유사도로 낮춘 확신도
  });

  it('한 실행에서 같은 과제가 N번 넘게 찍히면(허브) 유사도가 아주 높은 것만 남긴다', () => {
    const ids = Array.from({ length: 6 }, (_, i) => add(conv(`과제 ${i}`, LONG)).taskId!);
    const [target, ...others] = ids;
    const cands = others.map((tid, i) => ({ taskId: tid, otherTaskId: target!, similarity: i === 0 ? 0.6 : 0.2, confidence: 0.6, reason: 'x' }));
    expect(cands.length).toBeGreaterThan(CLASSIFIER_TUNING.mergeMaxPerTargetPerRun);
    const r = commitMergeCandidates(t.core, cands);
    expect(r).toEqual({ created: 1, droppedHub: 4 });
  });

  it('프롬프트: 목록에 과제가 하나뿐이라는 이유로 같은 과제라고 하지 않도록 지시', () => {
    expect(SYSTEM_PROMPT).toMatch(/하나뿐/);
    expect(SYSTEM_PROMPT).toMatch(/same_task_candidates/);
    expect(SYSTEM_PROMPT).toMatch(/내일/);
    expect(SYSTEM_PROMPT).toMatch(/handoff/);
  });
});

// ───────── 3. handoff · '내일'
describe('3 다른 곳에서 이어감(handoff) · 내일 이어가기', () => {
  const HANDOFF = ['오늘 내용 한꺼번에 저장해줘 새창에서 계속 할꺼야', 'md로 정리해줘, Claude Code에서 이어갈게', '이 대화 저장해서 나중에 노트북에서 이어 갈수 있게 만들어줘', '다른 도구로 가서 할꺼야 작업 인계서 만들어줘', '토큰 떨어져서 정리 파일 md 로 만들어줘'];
  const TOMORROW = ['좋아 내일 화면 먼저 만들어 보자 내일 같이 하자', '일단 오늘은 이쯤 하고 생각해볼께', '내일 X 먼저 해보자'];

  it.each(HANDOFF)('규칙 분류기: “%s” → 미해결 + handoff', (last) => {
    const r = ruleClassify(input([...LONG, last]));
    expect(r.resolution).toBe('unresolved');
    expect(r.kind).toBe('task');
    expect(r.handoff).toBe(true);
    expect(r.evidence).toMatch(/이어감/);
  });
  it.each(TOMORROW)('규칙 분류기: “%s” → 미해결(완료 아님)', (last) => {
    const r = ruleClassify(input([...LONG, last]));
    expect(r.resolution).toBe('unresolved');
    expect(r.handoff).toBe(false);
  });
  it('오탐 없음: 도구 질문·버그 설명은 handoff 아님, 고마워로 끝나면 해결', () => {
    expect(endingSignals(input(['클로드 코드 설치 어떻게 해?']).messages).handoff).toBeNull();
    expect(endingSignals(input(['새 창을 열면 버튼이 안보여']).messages).handoff).toBeNull();
    expect(ruleClassify(input([...LONG, '고마워 해결됐어'])).resolution).toBe('resolved');
  });
  it('LLM이 handoff 끝을 resolved(확신도 1.0)로 봐도 미해결로 보정, 확신도 ≤0.7, 근거에 [보정]', () => {
    const r = refineClassification(llmOut({ resolution: 'resolved', confidence: 1 }), input([...LONG, HANDOFF[1]!]), true);
    expect(r.out.resolution).toBe('unresolved');
    expect(r.out.handoff).toBe(true);
    expect(r.handoff).toMatchObject({ target: 'Claude Code', label: 'Claude Code에서 이어감', detectedBy: 'rule' });
    expect(r.out.confidence).toBeLessThanOrEqual(0.7);
    expect(r.out.evidence).toMatch(/^\[보정\]/);
    expect(r.rawConfidence).toBe(1);
  });
  it("LLM이 '내일 먼저 해보자' 끝을 resolved/quick으로 봐도 미해결 task", () => {
    const r = refineClassification(llmOut({ kind: 'quick_question', resolution: 'resolved', confidence: 0.95 }), input([...LONG, TOMORROW[0]!]), true);
    expect(r.out).toMatchObject({ kind: 'task', resolution: 'unresolved', handoff: false });
    expect(r.out.confidence).toBeLessThanOrEqual(0.7);
  });
  it('끝까지: 상태는 완료가 아니라 진행 중 + “이어감” 표시, API(목록·상세)에 handoff 노출', async () => {
    const h = add(conv('지도 앱 설계', [...LONG, HANDOFF[0]!]));
    const n = add(conv('지도 앱 내일', [...LONG, TOMORROW[0]!]));
    t.core.classifierOverride = new FakeLlm(() => ({ resolution: 'resolved', confidence: 1 }));
    await run([h.conversationId, n.conversationId]);
    const d = await t.json('GET', `/tasks/${h.taskId}`);
    expect(S.TaskDetailSchema.safeParse(d.body).success).toBe(true);
    // 1.5.0: 넘겨준 대화 하나뿐인 과제 → 대화 결과 moved → 과제도 완료(completionReason moved), 이어감 표시는 그대로
    expect(d.body).toMatchObject({ status: '완료', completionReason: 'moved' });
    expect(d.body.handoff).toMatchObject({ label: '새 대화에서 이어감', target: '새 대화', conversationId: h.conversationId });
    expect(d.body.classification.handoff.label).toBe('새 대화에서 이어감');
    const d2 = await t.json('GET', `/tasks/${n.taskId}`);
    expect(d2.body.status).toBe('진행 중');
    expect(d2.body.handoff).toBeNull();
    const list = await t.json('GET', '/tasks?handedOff=true');
    expect(list.body.items.map((x: { id: string }) => x.id)).toEqual([h.taskId]);
    expect(list.body.items[0].handoff.label).toBe('새 대화에서 이어감');
    expect(HANDOFF_LABEL).toBe('다른 곳에서 이어감');
  });
});

// ───────── 4. 안전 차단
describe('4 제공자 안전 차단 → 분류 불가(blocked)', () => {
  it('AI SDK 응답/오류에서 차단 사유를 읽는다', () => {
    expect(blockedReason({ finishReason: 'content-filter', rawFinishReason: 'PROHIBITED_CONTENT', text: '' })).toBe('PROHIBITED_CONTENT');
    expect(blockedReason({ finishReason: 'stop', text: '', providerMetadata: { google: { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } } } })).toBe('PROHIBITED_CONTENT');
    expect(blockedReason({ finishReason: 'stop', text: '{"kind":"task"}' })).toBeNull();
    expect(blockReasonFromError(new Error('[GoogleGenerativeAI Error] blocked: PROHIBITED_CONTENT'))).toBe('PROHIBITED_CONTENT');
    expect(blockReasonFromError(new Error('fetch failed'))).toBeNull();
  });
  it('차단되면 규칙 결과로 상태는 채우되 blocked 표시·확인 필요, 같은 내용은 다시 안 보냄(force·내용 변경 시만)', async () => {
    const c = conv('디자이너 피드백 요청', LONG);
    const r = add(c);
    const fake = new FakeLlm(() => new ProviderBlockedError('PROHIBITED_CONTENT', 'fake-flash'));
    t.core.classifierOverride = fake;
    const res = await run([r.conversationId]);
    expect(res).toMatchObject({ classified: 1, blocked: 1, failed: 0 });
    const d = await t.json('GET', `/tasks/${r.taskId}`);
    expect(S.TaskDetailSchema.safeParse(d.body).success).toBe(true);
    expect(d.body.classificationState).toBe('blocked');
    expect(d.body.classification).toMatchObject({ state: 'blocked', blockedReason: 'PROHIBITED_CONTENT', blockedModel: 'fake-flash', model: MOCK_MODEL, needsReview: true });
    expect((await t.json('GET', '/dashboard')).body.counts.needsReview).toBeGreaterThanOrEqual(1);
    const lst = await t.json('GET', '/tasks?classificationState=blocked');
    expect(lst.body.items.map((x: { id: string }) => x.id)).toEqual([r.taskId]);
    expect(lst.body.items[0].needsReview).toBe(true);
    const st = await t.json('GET', '/classification/status');
    expect(S.ClassificationStatusSchema.safeParse(st.body).success).toBe(true);
    expect(st.body).toMatchObject({ blockedCount: 1, promptVersion: PROMPT_VERSION });
    expect(st.body.needsReviewCount).toBeGreaterThanOrEqual(1);
    // 재시도 안 함
    for (const scope of ['changed', 'needs_review', 'unclassified']) expect(conversationsForScope(t.core, scope, {})).not.toContain(r.conversationId);
    expect(conversationsForScope(t.core, 'conversations', { conversationIds: [r.conversationId] })).toEqual([]);
    expect(conversationsForScope(t.core, 'conversations', { conversationIds: [r.conversationId], force: true })).toEqual([r.conversationId]);
    // 내용이 바뀌면 다시 대상
    add({ ...c, messages: [...c.messages, { role: 'user', content: '수정해서 다시 물어볼게요', createdAt: c.updatedAt }] });
    expect(conversationsForScope(t.core, 'changed', {})).toContain(r.conversationId);
    // 다시 성공하면 blocked 해제
    t.core.classifierOverride = new FakeLlm(() => ({ confidence: 0.8 }));
    await run([r.conversationId]);
    const d3 = await t.json('GET', `/tasks/${r.taskId}`);
    expect(d3.body.classificationState).toBe('ok');
    expect(fake.calls).toBe(1);
  });
});

// ───────── 5. 확신도 · 주제 · 새 프로젝트 제안 · 시작 로그
describe('5 확신도 보정', () => {
  it('1.0은 0.95로, 0은 0.05로 자르고 원래 값은 rawConfidence로 남김', () => {
    const hi = refineClassification(llmOut({ resolution: 'resolved', confidence: 1 }), input([...LONG, '고마워 해결됐어']), true);
    expect(hi.out.confidence).toBeLessThanOrEqual(CLASSIFIER_TUNING.confidenceMax);
    expect(hi.rawConfidence).toBe(1);
    const lo = refineClassification(llmOut({ resolution: 'resolved', confidence: 0 }), input([...LONG, '고마워 해결됐어']), true);
    expect(lo.out.confidence).toBe(CLASSIFIER_TUNING.confidenceMin);
  });
  it('규칙 신호와 결론이 다르면 낮춘다(이어가기 신호 없이 끝났는데 abandoned 등)', () => {
    const agree = refineClassification(llmOut({ resolution: 'resolved', confidence: 0.9 }), input([...LONG, '고마워 해결됐어']), true);
    const disagree = refineClassification(llmOut({ resolution: 'abandoned', confidence: 0.9 }), input([...LONG, '고마워 해결됐어']), true);
    expect(disagree.out.confidence).toBeLessThan(agree.out.confidence);
    expect(disagree.out.confidence).toBeLessThanOrEqual(0.65);
  });
});

describe('5 주제 교체', () => {
  it('LLM으로 다시 분류하면 규칙이 만든 주제는 떼고 LLM 주제로, 사용자가 붙인 주제는 유지', async () => {
    const r = add(conv('부산 여행 숙소 고르기', LONG));
    await classifyConversation(t.core, r.conversationId); // 규칙 분류 → 제목 단어 주제
    const db = t.core.db;
    const topics = () => db.all<{ name: string; origin: string | null }>('SELECT o.name, tt.origin FROM task_topics tt JOIN objects o ON o.id=tt.topic_id WHERE tt.task_id=? ORDER BY o.name', r.taskId);
    expect(topics().length).toBeGreaterThan(0);
    expect(topics().every((x) => x.origin === 'rule')).toBe(true);
    db.run("INSERT INTO objects(id,type,name,norm_name,status,confidence,first_seen_at,last_seen_at,mention_count,origin) VALUES ('obj_topic_user1','topic','내 여행 메모','내여행메모','accepted',1,?,?,1,'user')", nowIso(), nowIso());
    db.run("INSERT INTO task_topics(task_id,topic_id,confidence,created_at,origin) VALUES (?,'obj_topic_user1',1,?,'user')", r.taskId, nowIso());
    t.core.classifierOverride = new FakeLlm(() => ({ topics: ['숙소 비교', '부산'] }));
    await classifyConversation(t.core, r.conversationId, t.core.classifier());
    expect(topics()).toEqual([{ name: '내 여행 메모', origin: 'user' }, { name: '부산', origin: 'llm' }, { name: '숙소 비교', origin: 'llm' }]);
    // 규칙 주제 객체 중 어디에도 안 붙은 것은 지워짐
    expect(db.value<number>("SELECT COUNT(*) FROM objects WHERE type='topic' AND origin='rule' AND id NOT IN (SELECT topic_id FROM task_topics)")).toBe(0);
    // 다시 LLM 분류 → 이번 주제로 교체(사용자 주제 유지)
    t.core.classifierOverride = new FakeLlm(() => ({ topics: ['부산'] }));
    await classifyConversation(t.core, r.conversationId, t.core.classifier());
    expect(topics().map((x) => x.name)).toEqual(['내 여행 메모', '부산']);
  });
});

describe('5 새 프로젝트 제안', () => {
  async function suggestFor(names: Array<string | null>) {
    const convs = names.map((_, i) => add(conv(`유튜브 영상 ${i + 1}편 기획`, LONG)));
    let k = 0;
    const order = new Map(convs.map((c) => [c.conversationId, names[k++]]));
    t.core.classifierOverride = new FakeLlm((inp) => {
      const c = convs.find((x) => t.core.db.value<string>('SELECT title FROM conversations WHERE id=?', x.conversationId) === inp.title)!;
      return { new_project_suggestion: order.get(c.conversationId) ?? null };
    });
    await run(convs.map((c) => c.conversationId));
    return convs;
  }
  it('비슷한 이름을 하나로 모으고 과제 3개부터 ready, 수락하면 프로젝트를 만들어 과제를 붙인다', async () => {
    const convs = await suggestFor(['유튜브 채널', '유튜브채널 운영', null]);
    let l = await t.json('GET', '/project-suggestions');
    expect(l.status).toBe(200);
    expect(l.body.items).toHaveLength(1);
    expect(S.ProjectSuggestionSchema.safeParse(l.body.items[0]).success).toBe(true);
    expect(l.body.items[0]).toMatchObject({ name: '유튜브 채널', altNames: ['유튜브채널 운영'], taskCount: 2, ready: false, minTasks: CLASSIFIER_TUNING.projectSuggestionMinTasks });
    // 세 번째 과제가 같은 이름을 제안 → ready
    const more = add(conv('유튜브 썸네일 만들기', LONG));
    t.core.classifierOverride = new FakeLlm(() => ({ new_project_suggestion: '유튜브 채널' }));
    await run([more.conversationId]);
    l = await t.json('GET', '/project-suggestions?ready=true');
    expect(l.body.items).toHaveLength(1);
    const sug = l.body.items[0];
    expect(sug.taskCount).toBe(3);
    const dash = await t.json('GET', '/dashboard');
    expect(dash.body.badges.pendingProjectSuggestions).toBe(1);
    generateDigest(t.core);
    const dg = await t.json('GET', '/digests/today');
    expect(dg.status).toBe(200);
    expect(S.DigestResponseSchema.safeParse(dg.body).success).toBe(true);
    expect(dg.body.pendingProjectSuggestions?.map((x: { id: string }) => x.id)).toEqual([sug.id]);
    const acc = await t.json('POST', `/project-suggestions/${sug.id}/accept`, {});
    expect(acc.status).toBe(200);
    expect(S.AcceptProjectSuggestionResponseSchema.safeParse(acc.body).success).toBe(true);
    expect(acc.body.project.name).toBe('유튜브 채널');
    expect(acc.body.attachedTaskIds.sort()).toEqual([convs[0]!.taskId, convs[1]!.taskId, more.taskId].sort());
    const task = await t.json('GET', `/tasks/${more.taskId}`);
    expect(task.body.project?.name).toBe('유튜브 채널');
    // 이미 수락된 이름을 다시 제안하면 그 프로젝트에 바로 붙음
    const later = add(conv('유튜브 편집 툴', LONG));
    await run([later.conversationId]);
    expect(t.core.db.value<string>('SELECT project_id FROM tasks WHERE id=?', later.taskId)).toBe(acc.body.project.id);
    // 두 번 수락하면 409
    expect((await t.json('POST', `/project-suggestions/${sug.id}/accept`, {})).status).toBe(409);
  });
  it('거절한 이름(비슷한 이름 포함)은 다시 제안하지 않는다', async () => {
    await suggestFor(['부동산 공부']);
    const l = await t.json('GET', '/project-suggestions');
    const rej = await t.json('POST', `/project-suggestions/${l.body.items[0].id}/reject`, { reason: '프로젝트 아님' });
    expect(rej.status).toBe(200);
    expect(rej.body.suggestion.state).toBe('rejected');
    await suggestFor(['부동산공부']);
    expect((await t.json('GET', '/project-suggestions')).body.items).toHaveLength(0);
    expect((await t.json('GET', '/project-suggestions?state=rejected')).body.items).toHaveLength(1);
  });
  it('자동화 L4면 과제 3개가 모이는 순간 프로젝트를 자동으로 만든다', async () => {
    t.core.settings.patch({ automation: { level: 'L4' } });
    await suggestFor(['독서 모임', '독서 모임', '독서모임']);
    const pid = t.core.db.value<string>("SELECT id FROM projects WHERE name='독서 모임'");
    expect(pid).toBeTruthy();
    expect(t.core.db.value<number>('SELECT COUNT(*) FROM tasks WHERE project_id=?', pid)).toBe(3);
    expect((await t.json('GET', '/project-suggestions?state=accepted')).body.items).toHaveLength(1);
  });
  it('규칙 분류·분류 불가 결과는 제안을 만들지 않는다', async () => {
    const r = add(conv('혼자 하는 작업', LONG));
    await classifyConversation(t.core, r.conversationId);
    expect(t.core.db.value<number>('SELECT COUNT(*) FROM project_suggestions')).toBe(0);
  });
});

describe('5 시작 로그(LLM 상태 한 줄)', () => {
  const envKey = PROVIDER_ENV_KEY.google!;
  let saved: string | undefined;
  beforeEach(() => { saved = process.env[envKey]; delete process.env[envKey]; });
  afterEach(() => { if (saved === undefined) delete process.env[envKey]; else process.env[envKey] = saved; });
  it('제공자 미선택 / 키 없음 / 사용 중을 구분하고 키 값은 찍지 않는다', () => {
    expect(t.core.llmStatusLine()).toMatch(/제공자 미선택 → 규칙 분류기/);
    expect(t.core.llmStatusLine()).not.toMatch(/키 없음/);
    process.env[envKey] = 'test-value-not-a-real-key';
    expect(t.core.llmStatusLine()).toMatch(/제공자 미선택 \(환경변수 키 감지: google/);
    t.core.settings.patch({ llm: { provider: 'google' } });
    expect(t.core.llmStatusLine()).toBe('LLM: google · gemini-3.5-flash-lite (기본 모델) · 키 출처 GOOGLE_GENERATIVE_AI_API_KEY');
    expect(t.core.llmStatusLine()).not.toContain('test-value');
    delete process.env[envKey];
    expect(t.core.llmStatusLine()).toMatch(/google 선택됨, API 키 없음/);
  });
});

// ───────── 6. 카테고리 ZIP · 시계
describe('6 새 Claude 내보내기의 카테고리 ZIP 가져오기', () => {
  const projectsZip = () => zipSync({
    'projects/0190-a.json': strToU8(JSON.stringify({ uuid: '0190-a', name: '서브브레인', description: '너는 …', is_private: true, is_starter_project: false, created_at: '2026-08-01T00:00:00.000000Z', docs: [] })),
    'projects/0190-b.json': strToU8(JSON.stringify({ uuid: '0190-b', name: '', is_starter_project: false, docs: [] })),
    'projects/0190-c.json': strToU8(JSON.stringify({ uuid: '0190-c', name: 'How to use Claude', is_starter_project: true, docs: [] })),
    'projects/0190-d.json': strToU8(JSON.stringify({ uuid: '0190-d', name: '이사 준비', is_starter_project: false, docs: [] })),
  });
  it('projects ZIP → 실패 대신 미리보기(프로젝트 수), 시작하면 프로젝트를 만든다(이름 없음·스타터·기존 이름은 건너뜀)', async () => {
    t.core.db.run("INSERT INTO projects(id,name,aliases_json,status,color,created_at) VALUES ('proj_move','이사 준비','[]','active','#888888',?)", nowIso());
    const imp = createImport(t.core, { bytes: projectsZip(), fileName: 'projects-000.zip' });
    const ready = await until(() => { const j = getImport(t.core, imp.id)!; return j.state !== 'parsing' && j; });
    expect(ready.state).toBe('preview_ready');
    expect(S.ImportJobSchema.safeParse(ready).success).toBe(true);
    expect(ready.preview).toMatchObject({ detectedFormat: 'claude_projects_zip', category: 'projects', conversationsTotal: 0, projects: { total: 4, new: 1, existing: 1, skipped: 2, names: ['서브브레인'] } });
    expect(ready.preview!.warnings.join(' ')).toMatch(/프로젝트/);
    startImport(t.core, imp.id, {});
    const done = await until(() => { const j = getImport(t.core, imp.id)!; return j.state === 'done' && j; });
    expect(S.ImportJobSchema.safeParse(done).success).toBe(true);
    expect(done.result).toMatchObject({ projectsCreated: 1, conversationsNew: 0, tasksCreated: 0 });
    expect(t.core.db.value<string>("SELECT external_ref FROM projects WHERE name='서브브레인'")).toBe('claude_project:0190-a');
    expect(t.core.db.value<string>("SELECT external_ref FROM projects WHERE id='proj_move'")).toBe('claude_project:0190-d');
    // 같은 파일을 다시(force) 올리면 이미 있는 것으로
    const again = createImport(t.core, { bytes: projectsZip(), fileName: 'projects-000.zip', force: true });
    const r2 = await until(() => { const j = getImport(t.core, again.id)!; return j.state !== 'parsing' && j; });
    expect(r2.preview!.projects).toMatchObject({ new: 0, existing: 2 });
  });
  it('memories ZIP → 가져올 것 없음 안내(실패 아님), 시작하면 바로 완료', async () => {
    const zip = zipSync({ 'memories/acc.json': strToU8(JSON.stringify({ conversations_memory: '', project_memories: {}, account_uuid: 'acc' })) });
    const imp = createImport(t.core, { bytes: zip, fileName: 'memories-000.zip' });
    const ready = await until(() => { const j = getImport(t.core, imp.id)!; return j.state !== 'parsing' && j; });
    expect(ready.state).toBe('preview_ready');
    expect(ready.preview).toMatchObject({ detectedFormat: 'claude_memories_zip', category: 'memories', projects: null, conversationsTotal: 0 });
    expect(ready.preview!.warnings[0]).toMatch(/메모리/);
    startImport(t.core, imp.id, {});
    const done = await until(() => { const j = getImport(t.core, imp.id)!; return j.state === 'done' && j; });
    expect(done.result).toMatchObject({ projectsCreated: 0, conversationsNew: 0 });
  });
  it('대화 ZIP 미리보기는 category=conversations, projects=null, 결과 projectsCreated=0', async () => {
    const data = [{ uuid: 'c-1', name: '대화', created_at: '2026-09-01T00:00:00.123456Z', updated_at: '2026-09-01T01:00:00.123456Z', chat_messages: [
      { uuid: 'm1', sender: 'human', text: '안녕', created_at: '2026-09-01T00:00:00.123456Z', content: [{ type: 'text', text: '안녕' }] },
      { uuid: 'm2', sender: 'assistant', text: '안녕하세요', created_at: '2026-09-01T00:00:01.123456Z', content: [{ type: 'text', text: '안녕하세요' }] }] }];
    const imp = createImport(t.core, { bytes: zipSync({ 'conversations.json': strToU8(JSON.stringify(data)) }), fileName: 'conversations-000.zip' });
    const ready = await until(() => { const j = getImport(t.core, imp.id)!; return j.state !== 'parsing' && j; });
    expect(ready.preview).toMatchObject({ category: 'conversations', projects: null, conversationsTotal: 1 });
    startImport(t.core, imp.id, { classify: false });
    const done = await until(() => { const j = getImport(t.core, imp.id)!; return j.state === 'done' && j; });
    expect(done.result!.projectsCreated).toBe(0);
  });
});

describe('6 시계 고정', () => {
  it('예시 데이터를 넣어도 테스트 시계(2026-09-30 08:30 KST)가 유지된다', async () => {
    const s = await makeCore({ seeded: true });
    try {
      expect(nowIso().slice(0, 16)).toBe(NOW.slice(0, 16));
      const d = await s.json('GET', '/dashboard');
      expect(d.status).toBe(200);
    } finally { s.close(); }
  });
});
