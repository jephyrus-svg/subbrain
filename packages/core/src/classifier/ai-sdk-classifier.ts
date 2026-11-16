/** Vercel AI SDK 어댑터 — Anthropic / OpenAI / Google / xAI / Ollama(OpenAI 호환 주소) */
import { generateText, type LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createXai } from '@ai-sdk/xai';
import { LlmClassificationSchema } from '@subbrain/shared/schemas';
import { promptLang, systemPrompt, userPrompt, userPromptEn } from './prompt.ts';
import { blockReasonFromError, priceUsd, ProviderBlockedError, type Classifier, type ClassifyInput, type ClassifyResult, type LlmConfig } from './provider.ts';

export function languageModel(cfg: LlmConfig): LanguageModel {
  const key = cfg.apiKey ?? undefined;
  const baseURL = cfg.baseUrl ?? undefined;
  switch (cfg.provider) {
    case 'anthropic': return createAnthropic({ apiKey: key, baseURL })(cfg.model);
    case 'openai': return createOpenAI({ apiKey: key, baseURL })(cfg.model);
    case 'google': return createGoogleGenerativeAI({ apiKey: key, baseURL })(cfg.model);
    case 'xai': return createXai({ apiKey: key, baseURL })(cfg.model);
    case 'ollama': return createOpenAI({ apiKey: key ?? 'ollama', baseURL: baseURL ?? 'http://127.0.0.1:11434/v1' }).chat(cfg.model); // [미검증]
  }
}

/**
 * temperature를 보낼지. Gemini 3.x는 Google이 샘플링 파라미터를 쓰지 말라고 안내하고(모델이 스스로 관리),
 * OpenAI 추론 모델(gpt-5·gpt-6·o 시리즈)은 temperature를 받지 않는다.
 */
export function supportsTemperature(cfg: Pick<LlmConfig, 'provider' | 'model'>): boolean {
  if (cfg.provider === 'google') return !/^gemini-([3-9]|\d{2})/.test(cfg.model);
  if (cfg.provider === 'openai') return !/^(gpt-[5-9]|gpt-\d{2}|o\d)/.test(cfg.model);
  return true;
}

/** 1.2.0 고정 seed. 바꾸면 캐시 밖의 결과가 달라질 수 있으니 바꾸지 않는다 */
export const LLM_SEED = 20261010;

/**
 * seed를 보낼지 — AI SDK 4.x 기준(node_modules 코드로 확인):
 * Google generateContent: generationConfig.seed 전달 / xAI chat: seed 전달 / Ollama(OpenAI 호환 chat): seed 전달.
 * OpenAI 기본 경로(Responses API)와 Anthropic은 seed를 받지 않음(SDK가 경고만 내고 버림) → 안 보냄.
 * 모든 제공자에서 seed는 "최선 노력"이지 보장이 아니다(Google 문서 명시). 그래서 응답 캐시를 함께 쓴다.
 */
export function supportsSeed(cfg: Pick<LlmConfig, 'provider'>): boolean {
  return cfg.provider === 'google' || cfg.provider === 'xai' || cfg.provider === 'ollama';
}

/** generateText에 넘길 샘플링 옵션. Gemini 3.x: temperature는 보내지 않고(기본 1.0 유지 권고) seed만 고정 */
export function samplingOptions(cfg: Pick<LlmConfig, 'provider' | 'model'>): { temperature?: number; seed?: number } {
  return { ...(supportsTemperature(cfg) ? { temperature: 0 } : {}), ...(supportsSeed(cfg) ? { seed: LLM_SEED } : {}) };
}

/** 실제로 보내는 system·user 프롬프트(캐시 키의 입력 해시도 이것으로 계산) */
export function buildPrompts(input: ClassifyInput): { system: string; prompt: string } {
  const lang = promptLang(), none = lang === 'ko' ? '없음' : 'none';
  const system = systemPrompt(lang)
    .replace('{projects_with_aliases}', input.projects.map((p) => p.aliases.length ? `${p.name}(${p.aliases.join(', ')})` : p.name).join(' / ') || none)
    .replace('{recent_tasks}', input.recentTasks.slice(0, 40).map((t) => `${t.conversationId}: ${t.title}`).join('\n') || none)
    .replace('{today}', input.today);
  const args = { sourceAi: input.sourceAi, title: input.title, created: input.createdAt, updated: input.updatedAt, count: input.messages.length, previousSummary: input.previousSummary, transcript: input.condensed };
  const prompt = lang === 'ko' ? userPrompt(args) : userPromptEn(args);
  return { system, prompt };
}

/** 응답이 안전 필터로 막혔으면 사유. finishReason='content-filter'(AI SDK 공통) + Google promptFeedback.blockReason */
export function blockedReason(res: { finishReason: string; rawFinishReason?: string | undefined; text: string; providerMetadata?: Record<string, Record<string, unknown>> | undefined }): string | null {
  const google = res.providerMetadata?.google as { promptFeedback?: { blockReason?: string | null } | null } | undefined;
  const prompt = google?.promptFeedback?.blockReason;
  if (prompt && prompt !== 'BLOCK_REASON_UNSPECIFIED' && prompt !== 'BLOCKED_REASON_UNSPECIFIED') return prompt;
  if (res.finishReason === 'content-filter') return res.rawFinishReason || 'CONTENT_FILTER';
  return null;
}

/** 모델이 코드 블록이나 설명을 붙여도 첫 JSON 객체만 뽑는다 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('모델 응답에 JSON이 없어요');
  return JSON.parse(body.slice(start, end + 1));
}

export class AiSdkClassifier implements Classifier {
  readonly isLlm = true;
  readonly cacheable = true;
  constructor(private cfg: LlmConfig) {}
  get name() { return this.cfg.provider; }
  get model() { return this.cfg.model; }

  async classify(input: ClassifyInput): Promise<ClassifyResult> {
    const { system, prompt } = buildPrompts(input);
    let res;
    try {
      res = await generateText({ model: languageModel(this.cfg), system, prompt, maxRetries: 2, ...samplingOptions(this.cfg) });
    } catch (e) {
      const reason = blockReasonFromError(e);
      if (reason) throw new ProviderBlockedError(reason, this.cfg.model);
      throw e;
    }
    const inputTokens = res.usage.inputTokens ?? 0, outputTokens = res.usage.outputTokens ?? 0;
    const blocked = blockedReason(res);
    if (blocked) throw new ProviderBlockedError(blocked, this.cfg.model, inputTokens, outputTokens);
    const output = LlmClassificationSchema.parse(extractJson(res.text));
    return { output, model: this.cfg.model, inputTokens, outputTokens, costUsd: priceUsd(this.cfg.model, inputTokens, outputTokens) };
  }

  async complete(system: string, prompt: string): Promise<{ text: string; model: string; inputTokens: number; outputTokens: number; costUsd: number | null }> {
    let res;
    try { res = await generateText({ model: languageModel(this.cfg), system, prompt, maxRetries: 2, ...samplingOptions(this.cfg) }); }
    catch (e) { const reason = blockReasonFromError(e); if (reason) throw new ProviderBlockedError(reason, this.cfg.model); throw e; }
    const inputTokens = res.usage.inputTokens ?? 0, outputTokens = res.usage.outputTokens ?? 0;
    const blocked = blockedReason(res);
    if (blocked) throw new ProviderBlockedError(blocked, this.cfg.model, inputTokens, outputTokens);
    return { text: res.text, model: this.cfg.model, inputTokens, outputTokens, costUsd: priceUsd(this.cfg.model, inputTokens, outputTokens) };
  }
}
