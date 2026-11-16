/**
 * 규칙 분류기 (API 키가 없을 때). 같은 입력이면 항상 같은 결과.
 * 설계서 §7.4 간단한 질문 힌트 + 마지막 사용자 말의 종료/중단/이어가기/다른 곳에서 이어감(handoff) 표현으로 판단한다(signals.ts).
 * 1.1.0: "내일 X 먼저 해보자", "오늘은 요까지", "새 창에서 작업할꺼야" 같은 끝은 미해결(unresolved) — 완료가 아니다.
 */
import { MOCK_MODEL } from '@subbrain/shared/constants';
import type { LlmClassification } from '@subbrain/shared/schemas';
import type { Classifier, ClassifyInput, ClassifyResult } from './provider.ts';
import { estimateTokens } from './condense.ts';
import { detectOutcome, endingSignals, handoffLabel } from './signals.ts';
import { L } from '../util/lang.ts';

const DECISION_RE = /(로 하자|으로 하자|로 정했|으로 정했|로 결정|으로 결정|로 간다|으로 간다|확정|결정:)/;

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?。？！])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 1);
}
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

export function ruleClassify(input: ClassifyInput): LlmClassification {
  const msgs = input.messages;
  const users = msgs.filter((m) => m.role === 'user');
  const lastUser = users.at(-1)?.content ?? '';
  const firstUser = users[0]?.content ?? input.title;
  const hasCode = msgs.some((m) => m.role === 'user' && m.content.includes('```'));
  const sig = endingSignals(msgs);
  const handoff = sig.handoff;
  const wantsContinue = sig.continueCue !== null;
  const quick = users.length <= 2 && msgs.length <= 4 && !wantsContinue && !hasCode;

  let resolution: LlmClassification['resolution'] = 'unresolved';
  let evidence: string;
  if (handoff) evidence = `${handoffLabel(handoff.target)} — “${clip(handoff.evidence, 50)}”`;
  else if (sig.abandonCue) { resolution = 'abandoned'; evidence = L(`마지막 사용자 메시지: '${clip(lastUser, 60)}'`, `Last user message: '${clip(lastUser, 60)}'`); }
  else if (!wantsContinue && sig.resolvedCue) { resolution = 'resolved'; evidence = L(`마지막 사용자 메시지: '${clip(lastUser, 60)}'`, `Last user message: '${clip(lastUser, 60)}'`); }
  else if (quick && msgs.at(-1)?.role === 'user') evidence = L('간단한 질문에 답이 없음', 'Quick question with no answer'); // 1.4.0 답 못 받은 간단한 질문 = 남음
  else if (quick) { resolution = 'resolved'; evidence = L(`짧은 질문 ${users.length}개, 이어갈 표현 없음`, `${users.length} short question${users.length === 1 ? '' : 's'}, no sign of continuing`); }
  else evidence = wantsContinue ? L(`“${clip(lastUser, 40)}”로 끝남`, `Ended with “${clip(lastUser, 40)}”`) : msgs.at(-1)?.role === 'assistant' ? L('AI 답변으로 끝났고 끝냈다는 표현이 없음', 'Ended on an AI reply with no sign it was finished') : L(`마지막 사용자 메시지: '${clip(lastUser, 60)}'`, `Last user message: '${clip(lastUser, 60)}'`);

  const hay = `${input.title}\n${msgs.map((m) => m.content).join('\n')}`.toLowerCase();
  const project = input.projects.find((p) => [p.name, ...p.aliases].some((n) => n.length >= 2 && hay.includes(n.toLowerCase())))?.name ?? null;

  const decisions = users.flatMap((m) => sentences(m.content)).filter((s) => DECISION_RE.test(s)).slice(-5).map((s) => clip(s, 120));
  const openQuestions = resolution === 'unresolved'
    ? users.slice(-3).flatMap((m) => sentences(m.content)).filter((s) => /[?？]$/.test(s)).slice(-3).map((s) => clip(s, 120)) : [];
  const topicWords = [...new Set((input.title.match(/[가-힣A-Za-z0-9.#+]{2,}/g) ?? []).filter((w) => w.length >= 2))].slice(0, 3);

  let confidence = handoff ? 0.78 : quick ? 0.8 : resolution === 'unresolved' ? (wantsContinue ? 0.75 : 0.62) : 0.7;
  if (msgs.length <= 2 && !quick) confidence = 0.5;

  const summary = clip(handoff ? `${input.title} — ${handoffLabel(handoff.target)}` : resolution === 'unresolved' ? L(`${input.title} — 진행 중`, `${input.title} — in progress`) : input.title || clip(firstUser, 40), 60);
  return {
    kind: quick ? 'quick_question' : 'task',
    resolution,
    summary,
    detail: [L(`첫 요청: ${clip(firstUser.replace(/\s+/g, ' '), 100)}`, `First ask: ${clip(firstUser.replace(/\s+/g, ' '), 100)}`), ...(users.length > 1 ? [L(`마지막 요청: ${clip(lastUser.replace(/\s+/g, ' '), 100)}`, `Last ask: ${clip(lastUser.replace(/\s+/g, ' '), 100)}`)] : [])],
    next_step: resolution === 'unresolved'
      ? handoff ? clip(L(`${handoff.target ?? '다른 곳'}에서 이어서: ${lastUser.replace(/\s+/g, ' ')}`, `Continue in ${handoff.target ?? 'another tool'}: ${lastUser.replace(/\s+/g, ' ')}`), 80)
        : wantsContinue ? clip(L(`이어서: ${lastUser.replace(/\s+/g, ' ')}`, `Continue: ${lastUser.replace(/\s+/g, ' ')}`), 80) : L('마지막 답변을 확인하고 다음 단계 정하기', 'Check the last reply and decide the next step')
      : null,
    project,
    new_project_suggestion: null,
    topics: quick ? [] : topicWords,
    decisions,
    open_questions: openQuestions,
    same_task_candidates: [],
    confidence,
    evidence,
    handoff: handoff !== null,
    handoff_target: handoff?.target ?? null,
    conversation_outcome: detectOutcome(sig, quick ? 'quick_question' : 'task', resolution).outcome,
  };
}

export class RuleClassifier implements Classifier {
  readonly name = 'rule';
  readonly model = MOCK_MODEL;
  readonly isLlm = false;
  async classify(input: ClassifyInput): Promise<ClassifyResult> {
    return { output: ruleClassify(input), model: MOCK_MODEL, inputTokens: estimateTokens(input.condensed), outputTokens: 0, costUsd: null };
  }
}
