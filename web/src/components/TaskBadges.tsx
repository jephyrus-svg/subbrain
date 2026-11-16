import { tt, ttf } from '../i18n';
// 1.1.0 과제 표시 배지: "다른 곳에서 이어감"(handoff) · "분류 불가"(제공자 안전 필터가 막음, §12.7)
// 상태 옆에 붙는 작고 차분한 알약. 상태 자체(진행 중/멈춤)는 바꾸지 않는다 — handoff는 완료가 아니다(계약서 §15-17).
import type { ClassificationState, CompletionReason, ConversationOutcomeInfo, HandoffInfo } from '@subbrain/shared';
import { Icon } from './Icons';

export function HandoffBadge({ h, short = false }: { h: HandoffInfo | null | undefined; short?: boolean }) {
  if (!h) return null;
  const tip = [h.label, h.target ? ttf("이어간 곳: {0}", h.target) : null, h.evidence ? ttf("근거: “{0}”", h.evidence) : null, tt("끝난 일이 아니라 다른 곳에서 계속하는 중이에요")].filter(Boolean).join('\n');
  return <span className="tb ho" title={tip}><Icon name="handoff" />{short ? (h.target ? ttf("{0}에서", h.target) : tt("이어감")) : h.label}</span>;
}

export function BlockedBadge({ state, reason, model }: { state: ClassificationState | null | undefined; reason?: string | null; model?: string | null }) {
  if (state !== 'blocked') return null;
  return <span className="tb bl" title={blockedSentence(reason ?? null, model ?? null)}><Icon name="shield" />{tt("분류 불가")}</span>;
}

// 1.4.0 대화 결과 배지(§8): label 그대로, 근거는 툴팁. 과제 상태와 별개(대화 단위).
const OUTCOME_KO: Record<string, string> = { done: tt("이 대화에서 할 일이 끝남"), moved: tt("일부러 다른 곳으로 옮김 — 대화는 끝남"), interrupted: tt("바깥 사정(한도·시간)으로 끊김"), open: tt("아직 남은 대화") };
const DETECTED_KO: Record<string, string> = { llm: tt("AI 분류"), rule: tt("규칙"), both: tt("AI 분류 + 규칙"), derived: tt("이전 분류에서 추정(다시 분류 전)") };
export function OutcomeBadge({ o }: { o: ConversationOutcomeInfo | null | undefined }) {
  if (!o) return null;
  const cls = o.outcome === 'done' || o.outcome === 'moved' ? 'oc-done' : o.outcome === 'interrupted' ? 'oc-int' : o.status === '멈춤' ? 'oc-stall' : 'oc-run';
  const tip = [ttf("대화 결과: {0}", o.label), OUTCOME_KO[o.outcome] ?? o.outcome, o.target ? ttf("옮겨 간 곳: {0}", o.target) : null, o.evidence ? ttf("근거: “{0}”", o.evidence) : null, ttf("감지: {0}", DETECTED_KO[o.detectedBy] ?? o.detectedBy)].filter(Boolean).join('\n');
  return <span className={`tb oc ${cls}`} title={tip} data-outcome={o.outcome}>{o.outcome === 'moved' ? <Icon name="handoff" /> : null}{o.label}</span>;
}
/** 완료 이유 표시(1.4.0 answered · 1.6.0 done/moved). 상태(완료)는 그대로, 왜 끝났는지만 작게 붙인다.
 *  moved는 옮겨 간 곳(handoff/대화 결과의 target)을 함께 보여 주어 이어간 곳 배지 역할을 그대로 한다. */
const COMPLETION_TIP: Record<string, string> = {
  answered: tt("답을 받은 간단한 질문 — 상태는 완료"),
  done: tt("주 대화가 모두 끝나서 완료로 봤어요"),
  moved: tt("일부러 다른 곳으로 옮겨서 이 대화는 끝남 — 상태는 완료"),
};
export function completionText(reason: CompletionReason | null | undefined, target?: string | null): string | null {
  if (reason === 'answered') return tt("답변 받음");
  if (reason === 'done') return tt("끝냄");
  if (reason === 'moved') return target ? ttf("옮겨서 끝냄 · {0}", target) : tt("옮겨서 끝냄");
  return null;
}
export function CompletionTag({ reason, target }: { reason: CompletionReason | null | undefined; target?: string | null }) {
  const txt = completionText(reason, target);
  if (!txt) return null;
  const tip = [COMPLETION_TIP[reason!], reason === 'moved' && target ? ttf("옮겨 간 곳: {0}", target) : null].filter(Boolean).join('\n');
  return <span className={`tb ans cr-${reason}`} title={tip} data-reason={reason}>{reason === 'moved' ? <Icon name="handoff" /> : null}{txt}</span>;
}
/** 예전 이름(1.4.0) — 답변 받음만이 아니라 done·moved도 그린다 */
export const AnsweredTag = CompletionTag;
const COMPLETION_REASONS_SHOWN = new Set<CompletionReason>(['answered', 'done', 'moved']);
export const movedTarget = (t: { handoff?: HandoffInfo | null; conversationOutcome?: ConversationOutcomeInfo | null }) => t.handoff?.target ?? t.conversationOutcome?.target ?? null;

/** 목록 행·카드용: 완료 이유(답변 받음·끝냄·옮겨서 끝냄)가 있으면 먼저, 그다음 대화 결과(1.4.0) 또는 예전 이어감 배지, 분류 불가.
 *  done/moved 과제는 완료 이유가 대화 결과("끝난 대화"·"…로 옮김")와 같은 말이라 대화 결과 배지는 생략한다. */
export function TaskFlags({ handoff, classificationState, outcome, completionReason, short }: { handoff?: HandoffInfo | null; classificationState?: ClassificationState; outcome?: ConversationOutcomeInfo | null; completionReason?: CompletionReason | null; short?: boolean }) {
  // 행·카드에서는 'open'(그냥 남은 대화)은 상태 표시와 같은 말이라 생략 — 상세·대화 화면에서는 보인다
  if (outcome && outcome.outcome === 'open') outcome = null;
  if (!hasFlags({ handoff, classificationState, conversationOutcome: outcome, completionReason })) return null;
  const ended = completionReason === 'done' || completionReason === 'moved';
  return <span className="tbs"><CompletionTag reason={completionReason} target={movedTarget({ handoff, conversationOutcome: outcome })} />{ended ? null : outcome ? <OutcomeBadge o={outcome} /> : <HandoffBadge h={handoff} short={short} />}<BlockedBadge state={classificationState} /></span>;
}
export const hasFlags = (t: { handoff?: HandoffInfo | null; classificationState?: ClassificationState; conversationOutcome?: ConversationOutcomeInfo | null; completionReason?: CompletionReason | null }) =>
  !!(t.handoff || (t.conversationOutcome && t.conversationOutcome.outcome !== 'open') || t.classificationState === 'blocked' || (t.completionReason && COMPLETION_REASONS_SHOWN.has(t.completionReason)));

const REASON_KO: Record<string, string> = {
  PROHIBITED_CONTENT: tt("금지된 내용으로 판단"), SAFETY: tt("안전 기준에 걸림"), BLOCKLIST: tt("차단 목록에 걸림"), SPII: tt("민감한 개인정보로 판단"), RECITATION: tt("저작물 인용으로 판단"),
  CONTENT_FILTER: tt("콘텐츠 필터"), content_filter: tt("콘텐츠 필터"), REFUSAL: tt("응답 거절"), refusal: tt("응답 거절"), OTHER: tt("기타 사유"),
};
export const reasonKo = (r: string | null) => (r ? REASON_KO[r] ?? r : tt("사유 없음"));
export function providerOf(model: string | null): string {
  const m = (model ?? '').toLowerCase();
  if (m.startsWith('gemini')) return 'Google Gemini';
  if (m.startsWith('gpt') || /^o\d/.test(m)) return 'OpenAI';
  if (m.startsWith('claude')) return 'Anthropic Claude';
  if (m.startsWith('grok')) return 'xAI Grok';
  return model ? model : tt("AI 제공자");
}
/** "Google Gemini 안전 필터가 이 대화를 막았어요 (금지된 내용으로 판단 · PROHIBITED_CONTENT)" */
export function blockedSentence(reason: string | null, model: string | null): string {
  const r = reason ? (REASON_KO[reason] ? `${REASON_KO[reason]} · ${reason}` : reason) : tt("사유 없음");
  return ttf("{0} 안전 필터가 이 대화를 막았어요 ({1}). 규칙 분류 결과로 상태를 대신 채웠어요.", providerOf(model), r);
}
