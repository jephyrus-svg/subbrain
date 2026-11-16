/** 설계서 §7.5 입력 줄이기: 처음 N개 + 마지막 M개 + 중간은 각 메시지 첫 K자 */
import type { MessageRole } from '@subbrain/shared';
import { redactSecrets } from './redact.ts';

export interface CondenseMsg { role: MessageRole; content: string }
export interface CondenseOpts { head: number; tail: number; middleChars: number; redact: boolean; maxChars?: number }

const SPEAKER: Record<MessageRole, string> = { user: '사용자', assistant: 'AI', system: '시스템', tool: '도구' };

export function condense(messages: CondenseMsg[], o: CondenseOpts): string {
  const n = messages.length;
  const lines: string[] = [];
  messages.forEach((m, i) => {
    const full = i < o.head || i >= n - o.tail;
    let body = full ? m.content : m.content.slice(0, o.middleChars) + (m.content.length > o.middleChars ? ' …(생략)' : '');
    if (o.redact) body = redactSecrets(body).text;
    lines.push(`[${i + 1}] ${SPEAKER[m.role]}: ${body}`);
  });
  let text = lines.join('\n');
  const max = o.maxChars ?? 16000; // 약 4천~6천 토큰 상한(§7.5)
  if (text.length > max) text = text.slice(0, Math.floor(max * 0.4)) + '\n…(너무 길어 가운데 생략)…\n' + text.slice(text.length - Math.floor(max * 0.6));
  return text;
}

/** 대략 토큰 수 추정 — 한국어·영어 섞인 글자 수 ÷ 2.5 [미검증: 모델별 토크나이저가 다름] */
export function estimateTokens(text: string): number { return Math.ceil(text.length / 2.5); }
