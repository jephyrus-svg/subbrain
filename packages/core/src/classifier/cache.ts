/**
 * 1.2.0 LLM 응답 캐시 — 같은 (제공자, 모델, 프롬프트 버전, 입력 해시)면 모델을 다시 부르지 않고 저장된 답을 쓴다.
 * 목적: 다시 돌려도 같은 결과(재현성). Gemini 3.x는 temperature를 낮추지 말라고 안내하고 seed도 "최선 노력"이라
 * 같은 입력에 다른 답이 나올 수 있다. 캐시는 DB(subbrain.db) 안에 있으므로 DB를 복사한 다른 PC에서도 같은 답이 나온다.
 * - 입력 해시 = 실제로 보내는 system + user 프롬프트 전문의 sha256 (최근 과제 목록·프로젝트 목록·오늘 날짜 포함).
 *   그래서 다른 과제가 바뀌었거나 날짜가 바뀌면 자연히 새로 부른다.
 * - 성공한 응답만 저장(안전 차단·오류·형식 오류는 저장 안 함).
 * - 끄기: 환경변수 SUBBRAIN_LLM_CACHE=off. 한 번만 새로: POST /classification/run {refreshCache:true}, 과제 다시 분류(reclassify)는 항상 새로 부름.
 */
import { LlmClassificationSchema } from '@subbrain/shared/schemas';
import type { Db } from '../db/db.ts';
import { sha256 } from '../util/ids.ts';
import { nowIso } from '../util/time.ts';
import { PROMPT_VERSION } from '@subbrain/shared/constants';
import { buildPrompts } from './ai-sdk-classifier.ts';
import type { Classifier, ClassifyInput, ClassifyResult } from './provider.ts';

export function llmCacheEnabled(): boolean {
  return !/^(off|0|false|no)$/i.test(process.env.SUBBRAIN_LLM_CACHE ?? '');
}

export function cacheKeyFor(cls: Pick<Classifier, 'name' | 'model'>, input: ClassifyInput): { key: string; inputHash: string } {
  const { system, prompt } = buildPrompts(input);
  const inputHash = sha256(`${system}\n\u0000\n${prompt}`);
  return { key: sha256(JSON.stringify([cls.name, cls.model, PROMPT_VERSION, inputHash])), inputHash };
}

export interface CachedClassifyResult extends ClassifyResult { cached: boolean }

/** 캐시를 거쳐 분류. cls.cacheable이 true(실제 LLM 어댑터)일 때만 캐시를 쓴다 */
export async function classifyWithCache(db: Db, cls: Classifier, input: ClassifyInput, opts: { refresh?: boolean } = {}): Promise<CachedClassifyResult> {
  if (!cls.isLlm || !cls.cacheable || !llmCacheEnabled()) return { ...(await cls.classify(input)), cached: false };
  const { key, inputHash } = cacheKeyFor(cls, input);
  if (!opts.refresh) {
    const row = db.get<{ output_json: string }>('SELECT output_json FROM llm_cache WHERE key=?', key);
    if (row) {
      const parsed = LlmClassificationSchema.safeParse(JSON.parse(row.output_json));
      if (parsed.success) {
        db.run('UPDATE llm_cache SET hits=hits+1, last_hit_at=? WHERE key=?', nowIso(), key);
        return { output: parsed.data, model: cls.model, inputTokens: 0, outputTokens: 0, costUsd: 0, cached: true };
      }
    }
  }
  const res = await cls.classify(input);
  db.run(`INSERT INTO llm_cache(key,provider,model,prompt_version,input_hash,output_json,input_tokens,output_tokens,created_at,hits) VALUES (?,?,?,?,?,?,?,?,?,0)
    ON CONFLICT(key) DO UPDATE SET output_json=excluded.output_json, input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens, created_at=excluded.created_at`,
  key, cls.name, cls.model, PROMPT_VERSION, inputHash, JSON.stringify(res.output), res.inputTokens, res.outputTokens, nowIso());
  return { ...res, cached: false };
}
