/**
 * 1.3.0 기본 가격표 (USD, 100만 토큰당, 표준·짧은 프롬프트 요금 — 배치·캐시·긴 문맥 할증은 안 씀).
 * 환경변수 SUBBRAIN_PRICE_INPUT_PER_MTOK / SUBBRAIN_PRICE_OUTPUT_PER_MTOK가 있으면 그것이 우선(모든 모델).
 * 표에 없는 모델은 null(비용 모름) — $0으로 보이지 않게. 숫자를 지어내지 않는다: 아래는 모두 공식 가격표에서 2026-10-11(KST)에 확인한 값.
 *
 * 출처
 *  - Google: https://ai.google.dev/gemini-api/docs/pricing (페이지 "Last updated 2026-10-09 UTC")
 *  - Anthropic: https://docs.claude.com/en/docs/about-claude/pricing
 *  - OpenAI: https://platform.openai.com/docs/pricing (Standard, 짧은 문맥 ≤272K)
 *  - xAI: https://docs.x.ai/docs/models (Text API, 200K 미만 프롬프트)
 *  - Ollama: 내 컴퓨터에서 돌리는 모델이라 API 요금 없음(0)
 * 분류 프롬프트는 수천 토큰이라 긴 문맥 구간(200K/272K 초과)에 들어가지 않는다고 본다.
 */
import { MOCK_MODEL } from '@subbrain/shared/constants';

export interface ModelPrice {
  /** 이 날짜(YYYY-MM-DD, UTC)부터 적용. 없으면 처음부터 */
  from?: string;
  inputPerMTok: number;
  outputPerMTok: number;
}

export const PRICE_SOURCES = {
  google: 'https://ai.google.dev/gemini-api/docs/pricing',
  anthropic: 'https://docs.claude.com/en/docs/about-claude/pricing',
  openai: 'https://platform.openai.com/docs/pricing',
  xai: 'https://docs.x.ai/docs/models',
  checkedAt: '2026-10-11',
} as const;

/** 모델 id → 날짜순 가격 구간 */
export const DEFAULT_PRICES: Record<string, ModelPrice[]> = {
  // Google — 3.8 Flash는 2026-12-31까지 할인가, 2027-01-01부터 두 배(가격표에 명시). 출력에 thinking 토큰 포함.
  'gemini-3.8-flash': [{ inputPerMTok: 0.75, outputPerMTok: 3.75 }, { from: '2027-01-01', inputPerMTok: 1.5, outputPerMTok: 7.5 }],
  'gemini-3.5-flash-lite': [{ inputPerMTok: 0.3, outputPerMTok: 2.5 }],
  'gemini-3.1-flash-lite': [{ inputPerMTok: 0.25, outputPerMTok: 1.5 }], // 텍스트 입력 요금(오디오는 0.50)
  // Anthropic
  'claude-haiku-4-5': [{ inputPerMTok: 1, outputPerMTok: 5 }],
  // OpenAI
  'gpt-6-luna': [{ inputPerMTok: 0.1, outputPerMTok: 0.5 }],
  // xAI
  'grok-4.3': [{ inputPerMTok: 1.25, outputPerMTok: 2.5 }],
  // Ollama(로컬)
  'llama3.1': [{ inputPerMTok: 0, outputPerMTok: 0 }],
};

/** 접두어 없는 id로 맞춘다: 'models/gemini-3.8-flash' → 'gemini-3.8-flash'. 날짜 붙은 스냅샷 id는 표에 없으면 모름(null) */
function normModel(model: string): string {
  return model.trim().toLowerCase().replace(/^models\//, '');
}

export type PriceSource = 'env' | 'default' | 'unknown';

export function priceFor(model: string | null | undefined, at: Date = new Date()): (ModelPrice & { source: PriceSource }) | null {
  const ei = process.env.SUBBRAIN_PRICE_INPUT_PER_MTOK, eo = process.env.SUBBRAIN_PRICE_OUTPUT_PER_MTOK;
  if (ei && eo && Number.isFinite(Number(ei)) && Number.isFinite(Number(eo))) return { inputPerMTok: Number(ei), outputPerMTok: Number(eo), source: 'env' };
  if (!model || model === MOCK_MODEL) return null;
  const tiers = DEFAULT_PRICES[normModel(model)];
  if (!tiers) return null;
  const day = at.toISOString().slice(0, 10);
  let cur: ModelPrice | null = null;
  for (const t of tiers) if (!t.from || t.from <= day) cur = t;
  return cur ? { ...cur, source: 'default' } : null;
}

/** 비용(USD, 소수 4자리). 가격을 모르면 null — 0이 아님 */
export function priceUsd(model: string | null | undefined, inputTokens: number, outputTokens: number, at: Date = new Date()): number | null {
  const p = priceFor(model, at);
  if (!p) return null;
  return Math.round(((inputTokens * p.inputPerMTok + outputTokens * p.outputPerMTok) / 1e6) * 10000) / 10000;
}
