/**
 * 분류 제공자 인터페이스. 구현 두 개:
 *  - RuleClassifier: API 키가 없을 때 쓰는 결정적(deterministic) 규칙 분류기 (model "rule-mock")
 *  - AiSdkClassifier: Vercel AI SDK로 Anthropic / OpenAI / Google / xAI / (Ollama: OpenAI 호환) 호출
 */
import type { LlmProvider, MessageRole } from '@subbrain/shared';
import type { LlmClassification } from '@subbrain/shared/schemas';

export interface ClassifyInput {
  sourceAi: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Array<{ role: MessageRole; content: string }>;
  previousSummary: string | null;
  projects: Array<{ name: string; aliases: string[] }>;
  recentTasks: Array<{ conversationId: string; title: string; summary: string | null }>;
  today: string;
  condensed: string; // §7.5로 줄이고 비밀정보를 가린 대화
}
export interface ClassifyResult {
  output: LlmClassification;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}
export interface Classifier {
  readonly name: string;   // 'rule' | provider
  readonly model: string;
  readonly isLlm: boolean;
  /** 1.2.0 true면 응답 캐시(classifier/cache.ts)를 쓴다. 실제 LLM 어댑터만 true */
  readonly cacheable?: boolean;
  classify(input: ClassifyInput): Promise<ClassifyResult>;
  /** 1.7.0 온톨로지 추출 등 자유 형식 호출(JSON 글을 돌려받음). 규칙 분류기에는 없음 */
  complete?(system: string, prompt: string): Promise<{ text: string; model: string; inputTokens: number; outputTokens: number; costUsd: number | null }>;
}

export interface LlmConfig { provider: LlmProvider; model: string; apiKey: string | null; baseUrl: string | null }

/**
 * 제공자 안전 필터가 요청·응답을 막음(Google PROHIBITED_CONTENT/SAFETY, OpenAI content_filter, Anthropic refusal 등).
 * 다시 시도해도 같은 결과라 재시도하지 않는다 → 대화를 "분류 불가"(classificationState='blocked')로 표시(계약 §16 1.1.0).
 */
export class ProviderBlockedError extends Error {
  constructor(readonly reason: string, readonly model: string, readonly inputTokens = 0, readonly outputTokens = 0) {
    super(`제공자 안전 필터가 막았어요 (${reason})`);
    this.name = 'ProviderBlockedError';
  }
}
/** 오류 메시지만 보고 안전 차단인지 판단(제공자가 4xx로 거절하는 경우) */
export function blockReasonFromError(e: unknown): string | null {
  const msg = e instanceof Error ? `${e.message} ${(e as { responseBody?: string }).responseBody ?? ''}` : String(e);
  const m = msg.match(/\b(PROHIBITED_CONTENT|SAFETY|BLOCKLIST|SPII|IMAGE_SAFETY|RECITATION)\b/) ?? msg.match(/\b(content[_ ]policy[_ ]violation|content[_ ]filter(?:ed)?|refusal)\b/i);
  return m ? m[1]!.toUpperCase().replace(/ /g, '_') : null;
}

/** 가격은 classifier/pricing.ts (1.3.0 기본 가격표 + SUBBRAIN_PRICE_* 우선) */
export { priceUsd, priceFor } from './pricing.ts';
