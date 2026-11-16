/**
 * 다음 할 일(규칙) — LLM 없이 저장된 데이터로 한 줄을 만든다.
 * 우선순위: 사용자가 쓴 것(overrides next_step) > 분류가 저장한 next_step > 남은 질문 > 최근 대화 끝(답 못 받은 질문·AI 제안) > 상태 템플릿.
 */
import type { NextStepInfo, TaskStatus } from '@subbrain/shared';
import { L } from '../util/lang.ts';

export interface MsgLite { role: string; text: string }

const CUE = /(다음(으로|에는| 단계)?|이제|먼저|해\s?보(세요|시면|자)|해\s?볼까요|할까요|하시면|추천|권장|진행하(세요|면)|확인해|정리해|만들어|next|try|you (can|should|could)|let'?s|i'?d suggest|recommend)/i;
const clean = (s: string) => s
  .replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]*)`/g, '$1').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '').replace(/[*_~|]+/g, '').replace(/\s+/g, ' ').trim();
export function snip(s: string, n = 56): string {
  const c = clean(s);
  return c.length > n ? `${c.slice(0, n - 1).trimEnd()}…` : c;
}
const sentences = (s: string) => clean(s).split(/(?<=[.!?。？！])\s+|(?<=[다요죠])\.\s*|\n+/).map((x) => x.trim()).filter((x) => x.length >= 6);

/** 마지막 몇 메시지(오래된 → 최근)에서 단서를 찾는다 */
export function fromMessages(msgs: MsgLite[]): { kind: 'ask_open' | 'suggestion' | 'ask'; text: string } | null {
  const u = msgs.map((m, i) => ({ ...m, i })).filter((m) => m.role === 'user' && clean(m.text).length > 0);
  const a = msgs.map((m, i) => ({ ...m, i })).filter((m) => m.role === 'assistant' && clean(m.text).length > 0);
  const lu = u[u.length - 1], la = a[a.length - 1];
  if (lu && (!la || lu.i > la.i)) return { kind: 'ask_open', text: snip(lu.text) };
  if (la) {
    const ss = sentences(la.text.slice(-2500));
    for (let k = ss.length - 1; k >= Math.max(0, ss.length - 8); k--) if (CUE.test(ss[k]!)) return { kind: 'suggestion', text: snip(ss[k]!) };
  }
  if (lu) return { kind: 'ask', text: snip(lu.text) };
  return null;
}

export function ruleNextStep(i: { status: TaskStatus; staleDays: number | null; title: string; openQuestion: string | null; msgs: MsgLite[] }): { text: string; basis: string } | null {
  if (i.status === '완료' || i.status === '보관' || i.status === '간단한 질문') return null;
  const pre = i.status === '멈춤' && i.staleDays !== null ? L(`멈춘 ${i.staleDays}일 — `, `Stalled ${i.staleDays} days — `) : '';
  if (i.openQuestion) return { text: L(`${pre}남은 질문 풀기: ${snip(i.openQuestion, 50)}`, `${pre}Resolve the open question: ${snip(i.openQuestion, 50)}`), basis: L('남은 질문', 'Open question') };
  const m = fromMessages(i.msgs);
  if (m?.kind === 'ask_open') return { text: L(`${pre}답 못 받은 질문 이어가기: “${m.text}”`, `${pre}Follow up on your unanswered question: “${m.text}”`), basis: L('마지막 내 질문(답 없음)', 'Your last question (unanswered)') };
  if (m?.kind === 'suggestion') return { text: L(`${pre}${pre ? '마지막 제안부터: ' : ''}${m.text}`, `${pre}${pre ? 'Start from the last suggestion: ' : ''}${m.text}`), basis: L('마지막 AI 제안', 'Last AI suggestion') };
  if (m?.kind === 'ask') return { text: L(`${pre}마지막: “${m.text}”에서 이어가기`, `${pre}Pick up from: “${m.text}”`), basis: L('마지막 내 메시지', 'Your last message') };
  return { text: L(`${pre}마지막 대화를 열어 다음 단계 정하기`, `${pre}Open the last chat and decide the next step`), basis: L('상태', 'Status') };
}

export function nextStepInfoOf(t: { overrides: string[]; nextStep: string | null; status: TaskStatus; nextStepRule: { text: string; basis: string } | null }): NextStepInfo | null {
  if (t.nextStep && t.overrides.includes('next_step')) return { text: t.nextStep, source: 'user', basis: null };
  if (t.status === '완료' || t.status === '보관' || t.status === '간단한 질문') return null;
  if (t.nextStep) return { text: t.nextStep, source: 'saved', basis: L('분류 결과', 'AI summary') };
  return t.nextStepRule ? { text: t.nextStepRule.text, source: 'rule', basis: t.nextStepRule.basis } : null;
}
