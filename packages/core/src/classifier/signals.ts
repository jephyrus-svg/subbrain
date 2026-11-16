/**
 * 대화 끝 신호 (계약 §16 1.1.0) — 규칙 분류기와 LLM 결과 보정이 함께 쓴다. 같은 입력이면 항상 같은 결과.
 *  - handoff: 작업을 다른 창·도구로 옮긴다고 밝힘 ("새 창에서 작업할꺼야", "md로 정리해줘, Claude Code에서 이어갈게", "인계서 만들어줘")
 *  - continue: 나중에·내일 이어가겠다는 표현 ("내일 map 먼저 만들어 보자", "오늘은 요까지", "생각해볼께")
 *  - resolved / abandoned: 끝냄·그만둠 표현
 * 맞춤법이 흔들리는 실제 입력("할꺼야", "할께", "이어 갈수", "새창")을 일부러 받아준다.
 */
import type { MessageRole } from '@subbrain/shared';
import { L } from '../util/lang.ts';

/** 다른 곳(창·도구·기기)을 가리키는 말 → 표시용 대상 이름 */
const TARGETS: Array<[RegExp, string]> = [
  [/(클로드\s*코드|claude\s*code)/i, 'Claude Code'],
  [/(코덱스|codex)\s*(로|에서|에|가서)/i, 'Codex'],
  [/(커서|cursor)\s*(로|에서|에|가서)/i, 'Cursor'],
  [/(새\s*로운|새)\s*(창|대화|채팅|세션|탭)|new\s+(chat|window|session|conversation)/i, '새 대화'],
  [/(맥북|노트북|데스크톱|데스크탑|컴퓨터|pc|집에서|사무실)\s*(에서|로|가서)/i, '다른 기기'],
  [/코드\s*(로|에서)?\s*가서|코드에서\s*(작업|이어)/, '코드 작업 도구'],
  [/다른\s*(창|대화|채팅|ai|곳|데|도구)\s*(에서|로)/i, '다른 곳'],
];
/** 대화를 저장·정리해 달라는 요청 (옮겨가기 전에 흔히 함) */
const SAVE_RE = /((md|마크다운|markdown|파일|문서|정리\s*본?)\s*(파일)?\s*(로|으로)?\s*(정리|만들|저장|변환|뽑|내보내)|저장\s*해\s*줘|저장해줘|정리\s*해\s*줘|정리해줘|요약\s*해\s*줘|요약해줘|한꺼번에\s*저장)/i;
/** 옮겨서 일하겠다는 의도 */
const MOVE_INTENT_RE = /(작업|이어|할\s*(꺼|거)\s*(야|에요|예요)|할께|할게|갈께|갈게|옮길|넘어가|가서|계속)/;
/** 인계 문서 자체 */
const HANDOFF_DOC_RE = /(인계서|인수\s*인계|핸드\s*오프|handoff|handover|이어\s*갈\s*수\s*있게|이어갈\s*수\s*있게|이어서\s*할\s*수\s*있게)/i;
/** 맥락 한도 때문에 옮김 */
const LIMIT_RE = /(토큰|한도|용량|대화가?\s*너무\s*길|컨텍스트|context|limit)/i;

/** 나중에 이어가기(미해결) — "내일 X 먼저 해보자"는 완료가 아니다 */
export const CONTINUE_RE = new RegExp([
  '나중에', '다음에', '담에', '다음\\s*번에', '이어서', '이어\\s*가자', '이어가자', '이어\\s*갈게', '이어갈게', '계속\\s*하자', '계속하자',
  '내일', '모레', '다음\\s*주', '주말에', '이따', '이따가', '좀\\s*있다가',
  '일단\\s*여기까지', '오늘은\\s*(여기|요기|요|이)\\s*까지', '여기까지\\s*(하자|할게|할께|만)',
  '다시\\s*볼게', '다시\\s*볼께', '다시\\s*물어볼게', '다시\\s*올게', '다시\\s*올께', '추가할게', '추가할께',
  '생각해\\s*볼게', '생각해\\s*볼께', '고민해\\s*볼게', '고민해\\s*볼께', '좀\\s*더\\s*고민', '더\\s*생각해',
  '먼저\\s*(해|만들어|시작해|정리해)\\s*보자', '해\\s*보자$', '만들어\\s*보자', '시작하자',
  'to be continued', 'later', 'tomorrow', 'next time',
].join('|'), 'i');
export const RESOLVED_RE = /(고마워|고맙|감사|해결됐|해결했|됐다|됐어요|됐네|완료했|끝났|잘 되네|잘 돼|성공했|정리 끝|이걸로 할게|이걸로 확정|thanks|thank you|it works|solved|works now)/i;
export const ABANDON_RE = /(그만할래|그만 할래|그만두|포기|안 할래|안할래|다른 방법으로 할게|없던 걸로|접을게|drop it|never ?mind)/i;

export interface HandoffSignal { target: string | null; evidence: string }
export interface EndingSignals {
  lastUser: string;
  handoff: HandoffSignal | null;
  /** 이어가기 표현(일치한 부분). handoff면 항상 채움 */
  continueCue: string | null;
  resolvedCue: string | null;
  abandonCue: string | null;
  /** 끝 신호가 분명한가(확신도 보정용) */
  strong: boolean;
}

const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };

export function detectHandoff(text: string): HandoffSignal | null {
  if (!text.trim()) return null;
  const target = TARGETS.find(([re]) => re.test(text))?.[1] ?? null;
  const save = SAVE_RE.test(text), intent = MOVE_INTENT_RE.test(text), doc = HANDOFF_DOC_RE.test(text);
  const hit = doc || (target !== null && (save || intent)) || (save && LIMIT_RE.test(text));
  if (!hit) return null;
  return { target: target === '다른 곳' ? null : target, evidence: clip(text, 80) };
}

/** 마지막 사용자 메시지(필요하면 바로 앞 것까지)로 끝 신호를 읽는다 */
export function endingSignals(messages: Array<{ role: MessageRole; content: string }>): EndingSignals {
  const users = messages.filter((m) => m.role === 'user');
  const lastUser = users.at(-1)?.content ?? '';
  // 마지막 사용자 말이 아주 짧은 맞장구("ㅇㅇ", "응")면 그 앞 말까지 본다
  const window = lastUser.replace(/\s+/g, '').length <= 4 && users.length >= 2 ? `${users.at(-2)!.content}\n${lastUser}` : lastUser;
  const handoff = detectHandoff(window);
  const cont = window.match(CONTINUE_RE)?.[0] ?? null;
  const resolved = window.match(RESOLVED_RE)?.[0] ?? null;
  const abandon = window.match(ABANDON_RE)?.[0] ?? null;
  return {
    lastUser, handoff, continueCue: handoff ? cont ?? handoff.evidence : cont, resolvedCue: resolved, abandonCue: abandon,
    strong: Boolean(handoff || cont || abandon || resolved),
  };
}

export function handoffLabel(target: string | null): string {
  return target && target !== '새 대화' && target !== '다른 기기' && target !== '코드 작업 도구' ? L(`${target}에서 이어감`, `Continued in ${target}`)
    : target === '새 대화' ? L('새 대화에서 이어감', 'Continued in a new chat') : target === '다른 기기' ? L('다른 기기에서 이어감', 'Continued on another device') : L('다른 곳에서 이어감', 'Continued elsewhere');
}

// ───────────────────────── 1.4.0 대화 결과(conversation outcome)
/** 끊김 신호: 맥락 한도 소진·잠·시간·이동 중 — "옮긴다"는 말과 같이 와도 의도한 이동이 아니라 끊김 */
const LIMIT_EXHAUST_RE = /(토큰|한도|용량|컨텍스트|context|limit)\s*(이|가|을|를)?\s*(떨어|부족|다\s*(써|됐|찼|떨)|넘|초과|없|모자|끝)|대화가?\s*너무\s*길/i;
const INTERRUPT_RE = /(자야|잘\s*(래|게|께|시간)|잘래|졸려|졸리|피곤|잠\s*(와|온|이\s*와)|출근|퇴근|나가\s*봐야|가\s*봐야|배터리|시간이\s*(없|부족)|급한\s*일)/;

export type OutcomeKind = 'done' | 'moved' | 'interrupted' | 'open';
export interface OutcomeSignal { outcome: OutcomeKind; target: string | null; evidence: string | null; reason: string | null; strong: boolean }

/** 규칙만으로 대화 결과를 정한다. strong = 끊김/이동 문장 패턴이 직접 보임(LLM 판단보다 우선할 수 있음) */
export function detectOutcome(sig: EndingSignals, kind: 'task' | 'quick_question', resolution: 'resolved' | 'unresolved' | 'abandoned'): OutcomeSignal {
  const text = sig.lastUser;
  const ev = text.trim() ? clip(text, 80) : null;
  const limit = text.match(LIMIT_EXHAUST_RE)?.[0] ?? null;
  const sleep = text.match(INTERRUPT_RE)?.[0] ?? null;
  const save = SAVE_RE.test(text) || HANDOFF_DOC_RE.test(text);
  if (limit && (save || sig.handoff)) return { outcome: 'interrupted', target: sig.handoff?.target ?? null, evidence: ev, reason: L('토큰 한도', 'Usage limit'), strong: true };
  if (sleep && (save || sig.handoff)) return { outcome: 'interrupted', target: sig.handoff?.target ?? null, evidence: ev, reason: L('시간·잠', 'Out of time / sleep'), strong: true };
  if (sig.handoff) return { outcome: 'moved', target: sig.handoff.target, evidence: sig.handoff.evidence, reason: null, strong: true };
  if (resolution === 'resolved' || resolution === 'abandoned') return { outcome: 'done', target: null, evidence: ev, reason: null, strong: false };
  if (kind === 'quick_question') return { outcome: 'open', target: null, evidence: ev, reason: null, strong: false }; // 1.4.0 답 못 받은 간단한 질문(resolution=unresolved) = 남음
  return { outcome: 'open', target: null, evidence: ev, reason: null, strong: false };
}

export function outcomeLabel(o: OutcomeKind, target: string | null, reason: string | null): string {
  if (o === 'done') return L('끝난 대화', 'Finished chat');
  if (o === 'moved') return target && target !== '다른 곳' ? L(`${target}로 옮김`, `Moved to ${target}`) : L('다른 곳으로 옮김', 'Moved elsewhere'); // 대상 이름(Claude Code·새 대화·다른 기기·Codex·Cursor)은 모두 '로'가 자연스러움
  if (o === 'interrupted') return reason ? L(`끊김(${reason})`, `Interrupted (${reason})`) : L('끊김', 'Interrupted');
  return L('진행 중', 'In progress');
}
