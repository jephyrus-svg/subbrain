/**
 * Phase 5 (계약 1.3.0)
 *  1 ChatGPT 음성 대화 전사(audio_transcription) 보존 + 재가져오기 갱신·재분류 대상
 *  2 기본 가격표(공식 가격, 날짜 구간), 모르면 null, 환경변수 우선, 오늘 비용 null 규칙
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as S from '@subbrain/shared/schemas';
import { DEFAULT_MODEL, MOCK_MODEL } from '@subbrain/shared/constants';
import { makeCore } from './helpers.ts';
import { audioAsset, image, rtAsset, voiceConversation, voiceExport, VOICE_TURNS } from './fixtures/chatgpt-voice.ts';
import { parseChatgpt } from '../src/importers/chatgpt.ts';
import { createImport, getImport, startImport } from '../src/services/imports.ts';
import { conversationsForScope, todayUsage } from '../src/services/classify.ts';
import { conversationDetail } from '../src/services/views.ts';
import { DEFAULT_PRICES, priceFor, priceUsd } from '../src/classifier/pricing.ts';

type T = Awaited<ReturnType<typeof makeCore>>;
let t: T;
beforeEach(async () => { t = await makeCore(); });
afterEach(() => { t.close(); delete process.env.SUBBRAIN_PRICE_INPUT_PER_MTOK; delete process.env.SUBBRAIN_PRICE_OUTPUT_PER_MTOK; });

const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
async function until<R>(fn: () => R | null | undefined | false, ms = 4000): Promise<R> {
  const t0 = Date.now();
  for (;;) { const r = fn(); if (r) return r; if (Date.now() - t0 > ms) throw new Error('시간 초과'); await new Promise((res) => setTimeout(res, 10)); }
}
async function importAndStart(data: unknown, force = false) {
  const imp = createImport(t.core, { bytes: enc(data), fileName: 'conversations.json', force });
  const ready = await until(() => { const j = getImport(t.core, imp.id)!; return j.state !== 'parsing' ? j : null; });
  expect(ready.state, JSON.stringify(ready.errors)).toBe('preview_ready');
  startImport(t.core, ready.id, { classify: false });
  await t.core.queue.idle();
  return { preview: ready.preview!, done: getImport(t.core, ready.id)! };
}

describe('1 ChatGPT 음성 전사', () => {
  it('audio_transcription 글을 본문으로 쓰고 voice=true, 자리표시자 없음, 역할은 author.role 그대로', () => {
    const r = parseChatgpt(voiceExport(), 'chatgpt_conversations_json');
    const c = r.conversations[0]!;
    expect(c.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(c.messages[0]).toMatchObject({ content: '꽃집 배송 앱 이름을 같이 고민해 줘', voice: true });
    expect(c.messages.every((m) => m.voice === true && !m.content.includes('[첨부'))).toBe(true);
    expect(c.hasUnextractedArtifact).toBe(false);
    expect(r.warnings.join()).not.toContain('자리표시자');
  });

  it('전사가 있으면 같은 메시지의 오디오 자산은 표시하지 않고, 글 없는 오디오·이미지만 자리표시자', () => {
    const conv = voiceConversation({ turns: [
      { role: 'user', parts: [rtAsset(), { content_type: 'audio_transcription', text: '이거 들려?', direction: 'in' }] },
      { role: 'assistant', parts: [{ content_type: 'audio_transcription', text: '잘 들려요', direction: 'out' }, audioAsset()] },
      { role: 'user', parts: [audioAsset()] },                                                   // 전사 없음
      { role: 'user', parts: [{ content_type: 'audio_transcription', text: '   ', direction: 'in' }, audioAsset()] }, // 빈 전사
      { role: 'user', parts: [image(), '이 사진 봐'], voice: false },
    ] });
    const m = parseChatgpt([conv], 'chatgpt_conversations_json').conversations[0]!.messages;
    expect(m.map((x) => x.content)).toEqual(['이거 들려?', '잘 들려요', '[첨부: 음성]', '[첨부: 음성]', '[첨부: 이미지]\n이 사진 봐']);
    expect(m.map((x) => !!x.voice)).toEqual([true, true, true, true, false]); // bidi_voice_mode_message도 음성 표시
  });

  it('일반 글 대화의 해시는 1.2.0과 같고(voice 없음), 음성 메시지만 해시에 voice가 들어간다', async () => {
    const { conversationHash } = await import('../src/services/imports.ts');
    const plain = { sourceAi: 'chatgpt' as const, sourceId: 'x', title: 'x', createdAt: null, updatedAt: null, archived: false, inServiceProject: false, hasUnextractedArtifact: false,
      messages: [{ role: 'user' as const, content: '안녕', createdAt: null }] };
    const { createHash } = await import('node:crypto');
    const legacy = 'sha256:' + createHash('sha256').update(createHash('sha256').update('user\n안녕').digest('hex')).digest('hex');
    expect(conversationHash(plain).hash).toBe(legacy);
    expect(conversationHash({ ...plain, messages: [{ ...plain.messages[0]!, voice: true }] }).hash).not.toBe(legacy);
  });

  it('예전 자리표시자로 들어간 대화를 다시 가져오면 같은 대화가 갱신되고(중복 없음) 재분류 대상이 된다', async () => {
    // 1.2.0 파서가 만들던 모양 = 전사 대신 '[첨부: 음성]'
    const legacy = [voiceConversation({ turns: VOICE_TURNS.map((tn) => ({ role: tn.role, parts: [{ content_type: 'audio_asset_pointer', asset_pointer: 'x' }] })) })];
    await importAndStart(legacy);
    const convId = String(t.core.db.value("SELECT id FROM conversations WHERE source_id='voice-conv-1'"));
    expect(String(t.core.db.value('SELECT content_md FROM messages WHERE conversation_id=? AND seq=1', convId))).toBe('[첨부: 음성]');
    t.core.db.run('UPDATE conversations SET classified_hash=content_hash WHERE id=?', convId); // 분류됨 상태로
    expect(conversationsForScope(t.core, 'changed', {})).not.toContain(convId);

    const { preview, done } = await importAndStart(voiceExport(), true);
    expect(preview).toMatchObject({ conversationsNew: 0, conversationsUpdated: 1 });
    expect(done.result).toMatchObject({ conversationsNew: 0, conversationsUpdated: 1 });
    expect(Number(t.core.db.value("SELECT COUNT(*) FROM conversations WHERE source_id='voice-conv-1'"))).toBe(1);
    expect(conversationsForScope(t.core, 'changed', {})).toContain(convId);
    const d = conversationDetail(t.core, convId, { offset: 0 })!;
    expect(S.ConversationDetailSchema.safeParse(d).success).toBe(true);
    expect(d.messages.items[0]).toMatchObject({ contentMd: '꽃집 배송 앱 이름을 같이 고민해 줘', voice: true });
    expect(d.hasUnextractedArtifact).toBe(false);

    // 같은 파일을 한 번 더(force) → 모두 같음
    const again = await importAndStart(voiceExport(), true);
    expect(again.preview).toMatchObject({ conversationsUpdated: 0, conversationsUnchanged: 1 });
  });
});

describe('2 기본 가격표', () => {
  it('모든 기본 모델과 사용자가 쓰는 gemini-3.8-flash에 가격이 있다(공식 표)', () => {
    for (const [prov, model] of Object.entries(DEFAULT_MODEL)) expect(DEFAULT_PRICES[model], `${prov} ${model}`).toBeDefined();
    expect(priceFor('gemini-3.8-flash', new Date('2026-10-11T00:00:00Z'))).toMatchObject({ inputPerMTok: 0.75, outputPerMTok: 3.75, source: 'default' });
    expect(priceFor('models/gemini-3.8-flash', new Date('2027-01-01T00:00:00Z'))).toMatchObject({ inputPerMTok: 1.5, outputPerMTok: 7.5 });
    expect(priceUsd('claude-haiku-4-5', 1_000_000, 100_000)).toBe(1.5);
    expect(priceUsd('gemini-3.5-flash-lite', 2000, 400)).toBe(0.0016);
  });
  it('모르는 모델·규칙 분류기는 null(0 아님), 환경변수가 우선', () => {
    expect(priceUsd('gemini-9-ultra', 1000, 1000)).toBeNull();
    expect(priceUsd(MOCK_MODEL, 1000, 1000)).toBeNull();
    process.env.SUBBRAIN_PRICE_INPUT_PER_MTOK = '2'; process.env.SUBBRAIN_PRICE_OUTPUT_PER_MTOK = '4';
    expect(priceFor('gemini-9-ultra')).toMatchObject({ inputPerMTok: 2, outputPerMTok: 4, source: 'env' });
    expect(priceUsd('claude-haiku-4-5', 1_000_000, 1_000_000)).toBe(6);
  });
  it('오늘 사용량: 가격 모르는 LLM 분류가 있으면 costUsd=null, 아는 것만 costUsdKnown', () => {
    const db = t.core.db;
    const ins = (model: string, cost: number | null, cache = 0) => {
      db.run("INSERT INTO classifications(conversation_id,model,prompt_version,input_tokens,output_tokens,cost_usd,created_at,detail_json,decisions_json,cache_hit) VALUES (NULL,?,'x',1,1,?,?,'{}','[]',?)", model, cost, new Date().toISOString(), cache);
    };
    const base = todayUsage(t.core);
    ins('gemini-3.8-flash', 0.01);
    ins(MOCK_MODEL, null); ins('gemini-3.8-flash', null, 1); // 규칙·캐시는 모름으로 세지 않음
    expect(todayUsage(t.core)).toMatchObject({ costUsd: base.costUsdKnown + 0.01, costUnknownCount: base.costUnknownCount });
    ins('mystery-model', null);
    const u = todayUsage(t.core);
    expect(u.costUsd).toBeNull(); expect(u.costUnknownCount).toBe(base.costUnknownCount + 1); expect(u.costUsdKnown).toBeCloseTo(base.costUsdKnown + 0.01);
    expect(S.ClassificationStatusSchema.shape.today.safeParse(u).success).toBe(true);
  });
});
