/**
 * Phase 6 (계약 1.4.0)
 *  (c) 간단한 질문 = 종류. 답 받음 → 완료/answered, 못 받음 → 진행 중·멈춤. 보드·대시보드·필터 별칭
 *  (a) 대화 결과 done|moved|interrupted|open (cls-v4 + 규칙 패턴), 과제 상태는 그대로, handoff 대상 유지
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as S from '@subbrain/shared/schemas';
import type { LlmClassification } from '@subbrain/shared/schemas';
import { makeCore, NOW } from './helpers.ts';
import { detectOutcome, endingSignals } from '../src/classifier/signals.ts';
import { ruleClassify } from '../src/classifier/rule-classifier.ts';
import { SYSTEM_PROMPT } from '../src/classifier/prompt.ts';
import { classifyConversation, resolveOutcome } from '../src/services/classify.ts';
import { upsertConversation } from '../src/services/imports.ts';
import { loadTask, toListItem } from '../src/services/tasks.ts';
import { conversationDetail } from '../src/services/views.ts';
import { board, dashboard, filterTasks } from '../src/services/lists.ts';
import { loadTasks } from '../src/services/tasks.ts';
import type { Classifier } from '../src/classifier/provider.ts';
import type { NormalizedConversation } from '../src/importers/types.ts';

type T = Awaited<ReturnType<typeof makeCore>>;
let t: T;
beforeEach(async () => { t = await makeCore(); });
afterEach(() => t.close());

const msgs = (lastUser: string, extra: Array<[string, string]> = []) => [
  ...extra.map(([role, content]) => ({ role: role as 'user' | 'assistant', content })),
  { role: 'user' as const, content: '앱 기획을 같이 정리해 줘. 화면 구성이랑 데이터 구조까지.' }, { role: 'assistant' as const, content: '좋아요. 화면은 세 개로 나누고…' },
  { role: 'user' as const, content: '좋아 그 구조로 가자' }, { role: 'assistant' as const, content: '정리했어요.' },
  { role: 'user' as const, content: lastUser }, { role: 'assistant' as const, content: '알겠어요.' },
];
const ruleOutcome = (lastUser: string) => { const sig = endingSignals(msgs(lastUser)); return detectOutcome(sig, 'task', 'unresolved'); };

function conv(id: string, lastUser: string, opts: { quick?: boolean; endsWithUser?: boolean; daysAgo?: number } = {}): NormalizedConversation {
  const at = new Date(Date.parse(NOW) - (opts.daysAgo ?? 0) * 86400_000).toISOString();
  const m = opts.quick
    ? [{ role: 'user' as const, content: lastUser, createdAt: at }, ...(opts.endsWithUser ? [] : [{ role: 'assistant' as const, content: '답은 이거예요.', createdAt: at }])]
    : msgs(lastUser).map((x) => ({ ...x, createdAt: at }));
  return { sourceAi: 'claude', sourceId: id, title: `대화 ${id}`, createdAt: at, updatedAt: at, messages: m, archived: false, inServiceProject: false, hasUnextractedArtifact: false };
}
function fake(partial: Partial<LlmClassification>): Classifier {
  return {
    name: 'fake', model: 'fake-llm', isLlm: true,
    async classify() {
      const output = S.LlmClassificationSchema.parse({ kind: 'task', resolution: 'unresolved', summary: '요약', confidence: 0.8, ...partial });
      return { output, model: 'fake-llm', inputTokens: 1, outputTokens: 1, costUsd: null };
    },
  };
}
function add(c: NormalizedConversation) { return upsertConversation(t.core, c, { importId: null, rawPath: null }); }

describe('(a) 대화 결과 규칙 패턴 — 실제 라벨의 넘겨줌 6건 모양', () => {
  it('의도한 이동은 moved(대상 유지), 끊김은 interrupted, 나머지 open', () => {
    expect(ruleOutcome('오늘 내용 한꺼번에 저장해줘 새창에서 계속 할꺼야')).toMatchObject({ outcome: 'moved', target: '새 대화', strong: true });
    expect(ruleOutcome('지금까지 내용을 md 파일로 만들어줘 클로드 코드로 가서 이어서 할꺼야')).toMatchObject({ outcome: 'moved', target: 'Claude Code' });
    expect(ruleOutcome('토큰 떨어져서 더 못하겠다 정리 파일 md 로 만들어줘')).toMatchObject({ outcome: 'interrupted', reason: '토큰 한도' });
    expect(ruleOutcome('이제 자야 해서 이 대화 저장해서 나중에 노트북에서 이어 갈수 있게 해줘')).toMatchObject({ outcome: 'interrupted', reason: '시간·잠', target: '다른 기기' });
    expect(ruleOutcome('오늘 고마웠어 나중에 이어가자').outcome).toBe('open');
    expect(ruleOutcome('이제 잘래 내일 보자').outcome).toBe('open'); // 잠만 말하고 저장 요청이 없으면 끊김으로 단정하지 않음
  });
  it('규칙 분류기도 conversation_outcome을 낸다(간단한 질문 답 받음 = done)', () => {
    expect(ruleClassify({ sourceAi: 'claude', title: 'q', createdAt: '', updatedAt: '', messages: [{ role: 'user', content: '환율 알려줘' }, { role: 'assistant', content: '1,380원' }], previousSummary: null, projects: [], recentTasks: [], today: '2026-10-11', condensed: '' }))
      .toMatchObject({ kind: 'quick_question', resolution: 'resolved', conversation_outcome: 'done' });
    expect(ruleClassify({ sourceAi: 'claude', title: 'q', createdAt: '', updatedAt: '', messages: [{ role: 'user', content: '환율 알려줘' }], previousSummary: null, projects: [], recentTasks: [], today: '2026-10-11', condensed: '' }))
      .toMatchObject({ kind: 'quick_question', resolution: 'unresolved', conversation_outcome: 'open' });
  });
  it('합치기 규칙: 끊김 패턴 > LLM > 규칙, handoff면 done/open → moved, resolved면 open → done', () => {
    const base = S.LlmClassificationSchema.parse({ kind: 'task', resolution: 'unresolved', summary: 's', confidence: 0.8 });
    const sigInt = endingSignals(msgs('토큰 다 써서 정리 파일 만들어줘'));
    expect(resolveOutcome({ ...base, handoff: true }, sigInt, 'moved')).toMatchObject({ outcome: 'interrupted', detectedBy: 'rule' });
    expect(resolveOutcome(base, endingSignals(msgs('카톡으로 공유 안돼?')), 'done')).toMatchObject({ outcome: 'done', detectedBy: 'llm' });
    expect(resolveOutcome({ ...base, handoff: true, handoff_target: 'Claude Code' }, endingSignals(msgs('응')), 'done')).toMatchObject({ outcome: 'moved', target: 'Claude Code' });
    expect(resolveOutcome({ ...base, resolution: 'resolved' }, endingSignals(msgs('고마워')), 'open').outcome).toBe('done');
    expect(SYSTEM_PROMPT).toContain('conversation_outcome');
  });
});

describe('(a) 저장·API — 대화 결과는 과제 상태와 별개', () => {
  it('moved: 대화 완료 배지 + (1.5.0) 대화 하나뿐인 과제도 완료/moved, handoff 유지', async () => {
    const r = add(conv('m1', '오늘 내용 한꺼번에 저장해줘 새창에서 계속 할꺼야'));
    await classifyConversation(t.core, r.conversationId, fake({ handoff: true, handoff_target: '새 대화', conversation_outcome: 'moved' }));
    const task = loadTask(t.core, r.taskId!)!;
    const li = toListItem(task);
    expect(li).toMatchObject({ status: '완료', completionReason: 'moved' });
    expect(li.handoff).toMatchObject({ target: '새 대화' });
    expect(li.conversationOutcome).toMatchObject({ outcome: 'moved', status: '완료', label: '새 대화로 옮김', target: '새 대화', detectedBy: 'both' });
    expect(S.TaskListItemSchema.safeParse(li).success).toBe(true);
    const d = conversationDetail(t.core, r.conversationId, { offset: 0 })!;
    expect(d.outcome).toMatchObject({ outcome: 'moved', status: '완료' });
    expect(S.ConversationDetailSchema.safeParse(d).success).toBe(true);
    expect(t.core.db.value('SELECT conversation_outcome FROM classifications ORDER BY id DESC LIMIT 1')).toBe('moved');
  });
  it('interrupted·open: 대화 상태는 방치 규칙(오래되면 멈춤 N일)', async () => {
    const r = add(conv('i1', '토큰 떨어져서 더 못하겠다 정리 파일 md 로 만들어줘', { daysAgo: 10 }));
    await classifyConversation(t.core, r.conversationId, fake({ handoff: true, conversation_outcome: 'moved' }));
    const o = toListItem(loadTask(t.core, r.taskId!)!).conversationOutcome!;
    expect(o).toMatchObject({ outcome: 'interrupted', status: '멈춤', label: '끊김(토큰 한도)' });
    expect(o.staleDays).toBeGreaterThanOrEqual(9);
    const d = add(conv('d1', '카톡으로 보내는 법도 알려줘'));
    await classifyConversation(t.core, d.conversationId, fake({ conversation_outcome: 'done' }));
    const li = toListItem(loadTask(t.core, d.taskId!)!);
    expect(li).toMatchObject({ status: '완료', completionReason: 'done' }); // 1.5.0 대화 결과 done → 과제 완료
    expect(li.conversationOutcome).toMatchObject({ outcome: 'done', status: '완료', label: '끝난 대화' });
  });
  it('1.4.0 이전 분류(결과 없음)는 과제 상태로 추정(derived)', () => {
    const r = add(conv('x1', '좋아'));
    expect(toListItem(loadTask(t.core, r.taskId!)!).conversationOutcome).toMatchObject({ outcome: 'open', detectedBy: 'derived' });
  });
});

describe('(c) 간단한 질문 = 종류', () => {
  it('답 받은 간단한 질문 → 완료/answered, 보드는 간단한 질문 열(완료 열 아님), 대시보드는 끝낸 과제에 안 셈', async () => {
    const before = dashboard(t.core).counts;
    const r = add(conv('q1', '환율 알려줘', { quick: true }));
    await classifyConversation(t.core, r.conversationId); // 키 없음 → 규칙
    const li = toListItem(loadTask(t.core, r.taskId!)!);
    expect(li).toMatchObject({ kind: 'quick_question', status: '완료', completionReason: 'answered', statusVisual: 'quick' });
    const b = board(t.core, {});
    expect(b.columns.find((c) => c.status === '간단한 질문')!.total).toBeGreaterThan(0);
    expect(b.columns.find((c) => c.status === '완료')!.items.some((x) => x.id === li.id)).toBe(false);
    const after = dashboard(t.core).counts;
    expect(after.quickQuestions).toBe(before.quickQuestions + 1);
    expect(after.completedThisWeek).toBe(before.completedThisWeek);
    expect(after.totalTasks).toBe(before.totalTasks);
    // 옛 status=간단한 질문 필터는 별칭으로 계속 동작
    expect(filterTasks(t.core, loadTasks(t.core), { status: ['간단한 질문'] }).some((x) => x.id === li.id)).toBe(true);
  });
  it('답 못 받은 간단한 질문 → 진행 중(남음), 대화 결과 open', async () => {
    const r = add(conv('q2', '세 프로젝트 만들었는데 입력창이 안 나와', { quick: true, endsWithUser: true }));
    await classifyConversation(t.core, r.conversationId);
    const li = toListItem(loadTask(t.core, r.taskId!)!);
    expect(li).toMatchObject({ kind: 'quick_question', status: '진행 중', completionReason: null });
    expect(li.conversationOutcome?.outcome).toBe('open');
  });
  it('이전 v5: 저장된 간단한 질문 상태를 바꾼다', async () => {
    const { migrateV5ForTest } = { migrateV5ForTest: (sql: string) => t.core.db.exec(sql) };
    const db = t.core.db;
    const r1 = add(conv('mq1', 'a', { quick: true })), r2 = add(conv('mq2', 'b', { quick: true }));
    db.run("UPDATE tasks SET status='간단한 질문', kind='quick_question', resolution='resolved' WHERE id=?", r1.taskId);
    db.run("UPDATE tasks SET status='간단한 질문', kind='quick_question', resolution='unresolved' WHERE id=?", r2.taskId);
    migrateV5ForTest(`UPDATE tasks SET status='완료', completion_reason='answered', completed_at=COALESCE(completed_at, last_activity_at) WHERE status='간단한 질문' AND (resolution IS NULL OR resolution<>'unresolved');
      UPDATE tasks SET status='진행 중', completion_reason=NULL WHERE status='간단한 질문';`);
    expect(db.get('SELECT status, completion_reason FROM tasks WHERE id=?', r1.taskId)).toMatchObject({ status: '완료', completion_reason: 'answered' });
    expect(db.value('SELECT status FROM tasks WHERE id=?', r2.taskId)).toBe('진행 중');
    expect(Number(db.value('PRAGMA user_version'))).toBeGreaterThanOrEqual(5);
  });
});
