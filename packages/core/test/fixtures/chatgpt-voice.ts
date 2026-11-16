/**
 * 합성 ChatGPT 음성 대화 — 실제 내보내기(2026-10, 사용자 파일)의 모양을 그대로 따름(내용은 지어낸 것):
 *  사용자 음성 턴: author.role='user', content_type='multimodal_text', parts=[{content_type:'audio_transcription', text, direction:'in', decoding_id:null}]
 *  AI 음성 턴:     author.role='assistant', 같은 모양, direction:'out'
 *  metadata.bidi_voice_mode_message=true, 일부는 bidi_voice_fem_message. 실제 파일엔 오디오 자산 부품이 없었지만,
 *  다른 내보내기 모양(audio_asset_pointer·real_time_user_audio_video_asset_pointer)도 섞어 시험한다.
 */
type Part = string | Record<string, unknown>;
const tr = (text: string, direction: 'in' | 'out'): Part => ({ content_type: 'audio_transcription', text, direction, decoding_id: null });
export const audioAsset = (): Part => ({ content_type: 'audio_asset_pointer', asset_pointer: 'sediment://file_audio_x', size_bytes: 12345, format: 'wav', metadata: { start: 0, end: 3.2 } });
export const rtAsset = (): Part => ({ content_type: 'real_time_user_audio_video_asset_pointer', audio_asset_pointer: audioAsset(), frames_asset_pointers: [], video_container_asset_pointer: null });
export const image = (): Part => ({ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_img', width: 1280, height: 720, size_bytes: 1000 });

export function voiceConversation(opts: { id?: string; turns: Array<{ role: 'user' | 'assistant'; parts: Part[]; voice?: boolean }>; t0?: number }) {
  const t0 = opts.t0 ?? 1_790_000_000;
  const mapping: Record<string, unknown> = { root: { id: 'root', parent: null, children: ['n0'], message: null } };
  opts.turns.forEach((tn, i) => {
    const id = `n${i}`;
    mapping[id] = {
      id, parent: i === 0 ? 'root' : `n${i - 1}`, children: i + 1 < opts.turns.length ? [`n${i + 1}`] : [],
      message: {
        id: `m${i}`, author: { role: tn.role, name: null }, create_time: t0 + i * 20,
        content: { content_type: 'multimodal_text', parts: tn.parts },
        metadata: tn.voice === false ? {} : { bidi_voice_mode_message: true, ...(tn.role === 'assistant' ? { bidi_voice_fem_message: true } : {}) }, recipient: 'all',
      },
    };
  });
  return { id: opts.id ?? 'voice-conv-1', title: '음성 대화', create_time: t0, update_time: t0 + opts.turns.length * 20, mapping, current_node: `n${opts.turns.length - 1}` };
}

export const VOICE_TURNS = [
  { role: 'user' as const, parts: [tr('꽃집 배송 앱 이름을 같이 고민해 줘', 'in')] },
  { role: 'assistant' as const, parts: [tr('좋아요. 꽃길, 꽃배달로처럼 짧은 이름은 어때요?', 'out')] },
  { role: 'user' as const, parts: [tr('꽃길 좋다 그걸로 하자', 'in')] },
  { role: 'assistant' as const, parts: [tr('그럼 꽃길로 정하고 로고 방향도 정리해 볼게요.', 'out')] },
];
export const voiceExport = (turns = VOICE_TURNS) => [voiceConversation({ turns })];
