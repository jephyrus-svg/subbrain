import { afterEach, describe, expect, it } from 'vitest';
import * as S from '@subbrain/shared/schemas';
import { fromMessages, ruleNextStep } from '../src/services/next-step.ts';
import { makeCore } from './helpers.ts';

let ctx: Awaited<ReturnType<typeof makeCore>> | null = null;
afterEach(() => { ctx?.close(); ctx = null; });

describe('다음 할 일 규칙', () => {
  it('답 못 받은 내 질문 > AI 제안 > 마지막 내 메시지', () => {
    expect(fromMessages([{ role: 'assistant', text: '좋아요.' }, { role: 'user', text: '그럼 견적은 어디서 받아?' }])).toEqual({ kind: 'ask_open', text: '그럼 견적은 어디서 받아?' });
    expect(fromMessages([{ role: 'user', text: '정리해 줘' }, { role: 'assistant', text: '요약입니다. 다음으로 **표지 시안**을 만들어 보세요.' }])?.kind).toBe('suggestion');
    expect(fromMessages([{ role: 'user', text: '고마워' }, { role: 'assistant', text: '천만에요.' }])).toEqual({ kind: 'ask', text: '고마워' });
  });
  it('멈춤이면 일수 접두, 완료면 없음', () => {
    expect(ruleNextStep({ status: '멈춤', staleDays: 12, title: 'x', openQuestion: null, msgs: [{ role: 'user', text: '이사 견적 비교해 줘' }, { role: 'assistant', text: '네.' }] })!.text).toBe('멈춘 12일 — 마지막: “이사 견적 비교해 줘”에서 이어가기');
    expect(ruleNextStep({ status: '완료', staleDays: null, title: 'x', openQuestion: null, msgs: [] })).toBeNull();
  });
});

describe('API', () => {
  it('목록·상세에 nextStepInfo, 직접 고치면 user, 되돌리면 자동', async () => {
    ctx = await makeCore({ seeded: true });
    const list = await ctx.json('GET', '/tasks?status=' + encodeURIComponent('진행 중,멈춤') + '&limit=200');
    expect(S.listOf(S.TaskListItemSchema).safeParse(list.body).success).toBe(true);
    const open = list.body.items as Array<{ id: string; nextStepInfo: { text: string; source: string } | null }>;
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((t) => t.nextStepInfo && t.nextStepInfo.text.length > 0)).toBe(true);
    const id = open[0]!.id;
    const p = await ctx.json('PATCH', `/tasks/${id}`, { nextStep: '내가 정한 다음 할 일' });
    expect(p.status).toBe(200);
    expect(p.body.task.nextStepInfo).toEqual({ text: '내가 정한 다음 할 일', source: 'user', basis: null });
    const rp = await ctx.json('GET', `/tasks/${id}/resume-prompt`);
    expect(rp.body.prompt).toContain('내가 정한 다음 할 일');
    const r = await ctx.json('POST', `/tasks/${id}/overrides/reset`, { fields: ['next_step'] });
    expect(r.status).toBe(200);
    expect(r.body.nextStepInfo?.source).not.toBe('user');
  });
  it('주간 돌아보기: 이번 주·이전 주, 스키마', async () => {
    ctx = await makeCore({ seeded: true });
    const w = await ctx.json('GET', '/review/weekly');
    expect(w.status).toBe(200);
    const ok = S.WeeklyReviewResponseSchema.safeParse(w.body); if (!ok.success) console.log(ok.error.issues.slice(0, 3));
    expect(ok.success).toBe(true);
    expect(w.body.weekStart).toBe('2026-09-28'); expect(w.body.weekEnd).toBe('2026-10-04'); expect(w.body.isCurrent).toBe(true); expect(w.body.nextWeek).toBeNull();
    const prev = await ctx.json('GET', `/review/weekly?date=${w.body.prevWeek}`);
    expect(prev.body.weekStart).toBe('2026-09-21'); expect(prev.body.nextWeek).toBe('2026-09-28');
    const total = (x: any) => x.finished.length + x.started.length + x.stalled.length + x.neglected.length + x.conversationCount; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(total(w.body) + total(prev.body)).toBeGreaterThan(0);
    expect(w.body.neglected.every((i: any) => i.task.staleDays >= 14)).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((await ctx.json('GET', '/review/weekly?date=bad')).status).toBe(400);
  });
});
