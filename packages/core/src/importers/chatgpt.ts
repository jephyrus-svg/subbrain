/**
 * ChatGPT 데이터 내보내기 파서.
 * 형식(공개적으로 널리 알려진 모양 — OpenAI가 공식 스키마를 문서로 내지는 않음 [미검증: 필드는 바뀔 수 있음]):
 *   conversations.json = [{ id|conversation_id, title, create_time(유닉스 초, 실수), update_time,
 *     mapping: { <nodeId>: { id, parent, children[], message: { author:{role}, create_time,
 *       content:{ content_type:'text'|'multimodal_text'|'code'|..., parts?:[], text? }, metadata, recipient } | null } },
 *     current_node, is_archived?, gizmo_id? }]
 * 음성 대화(1.3.0, 실제 내보내기 2026-10로 확인): 음성 턴은 content_type 'multimodal_text'에 parts가
 *   { content_type:'audio_transcription', text, direction:'in'(user)|'out'(assistant), decoding_id } 이고 metadata.bidi_voice_mode_message=true.
 *   이 내보내기에는 audio_asset_pointer·real_time_user_audio_video_asset_pointer 부품이 없었다(다른 내보내기에는 있다고 알려짐 [미검증]).
 *   → 전사 text를 메시지 본문으로 쓰고 메시지에 voice=true. 글이 없는 오디오/영상 부품만 '[첨부: 음성]' 자리표시자.
 * 규칙: 편집·재생성으로 가지가 여러 개인 트리에서 current_node부터 parent를 따라 올라간 "현재 가지"만 쓴다.
 */
import type { MessageRole } from '@subbrain/shared';
import { normalizeIso } from '../util/time.ts';
import type { NormalizedConversation, NormalizedMessage, ParseResult } from './types.ts';

interface CgNode { id?: string; parent?: string | null; children?: string[]; message?: CgMessage | null }
interface CgMessage {
  id?: string; author?: { role?: string; name?: string | null }; create_time?: number | null;
  content?: { content_type?: string; parts?: unknown[]; text?: string; result?: string };
  metadata?: Record<string, unknown>; recipient?: string;
}
interface CgConversation {
  id?: string; conversation_id?: string; title?: string | null; create_time?: number | null; update_time?: number | null;
  mapping?: Record<string, CgNode>; current_node?: string | null; is_archived?: boolean; gizmo_id?: string | null;
}

export function looksLikeChatgpt(data: unknown): boolean {
  return Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null && 'mapping' in data[0];
}

/** current_node가 없으면: 자식이 없는 노드 중 가장 늦게 만든 것 (대체 규칙) */
function pickLeaf(mapping: Record<string, CgNode>): string | null {
  let best: string | null = null, bestT = -Infinity;
  for (const [id, n] of Object.entries(mapping)) {
    if (n.children && n.children.length) continue;
    const t = n.message?.create_time ?? 0;
    if (t >= bestT) { best = id; bestT = t; }
  }
  return best;
}

function partType(p: unknown): string {
  return typeof p === 'object' && p !== null && 'content_type' in p ? String((p as { content_type: unknown }).content_type) : '';
}

function messageText(m: CgMessage, flags: { artifact: boolean }): { text: string; role: MessageRole; voice: boolean } | null {
  const role0 = m.author?.role;
  const role: MessageRole = role0 === 'user' || role0 === 'assistant' || role0 === 'system' || role0 === 'tool' ? role0 : 'assistant';
  const meta = m.metadata ?? {};
  if (meta.is_visually_hidden_from_conversation === true) return null;
  if (typeof m.recipient === 'string' && m.recipient.startsWith('canmore')) flags.artifact = true; // 캔버스 [추정]
  const c = m.content ?? {};
  const type = c.content_type ?? 'text';
  let text = '';
  let voice = meta.bidi_voice_mode_message === true;
  switch (type) {
    case 'text':
      text = (c.parts ?? []).filter((p): p is string => typeof p === 'string').join('\n');
      break;
    case 'multimodal_text':
    {
      const parts = c.parts ?? [];
      // 전사가 있으면 같은 메시지의 오디오 자산(audio_asset_pointer 등)은 자리표시자를 붙이지 않는다(내용이 이미 글로 있음)
      const hasTranscript = parts.some((p) => partType(p) === 'audio_transcription' && typeof (p as { text?: unknown }).text === 'string' && (p as { text: string }).text.trim() !== '');
      text = parts.map((p) => {
        if (typeof p === 'string') return p;
        const ct = partType(p);
        if (ct === 'audio_transcription') {
          const t = (p as { text?: unknown }).text;
          if (typeof t === 'string' && t.trim()) { voice = true; return t; }
          return '';
        }
        if ((ct.includes('audio') || ct.includes('video')) && hasTranscript) { voice = true; return ''; }
        flags.artifact = true;
        return ct.includes('image') ? '[첨부: 이미지]' : ct.includes('audio') || ct.includes('video') ? '[첨부: 음성]' : '[첨부]';
      }).filter(Boolean).join('\n');
    }
      break;
    case 'code':
      text = c.text ? '```\n' + c.text + '\n```' : '';
      break;
    case 'execution_output':
      text = c.text ? '```\n' + c.text + '\n```' : '';
      return text ? { text, role: 'tool', voice: false } : null;
    case 'user_editable_context': // 사용자 맞춤 지침 — 대화 내용 아님
    case 'thoughts':
    case 'reasoning_recap':
    case 'model_editable_context':
      return null;
    default:
      text = (c.parts ?? []).filter((p): p is string => typeof p === 'string').join('\n') || (typeof c.text === 'string' ? c.text : '');
  }
  text = text.trim();
  if (!text) return null;
  if (role === 'system') return null; // 시스템 프롬프트는 저장하지 않음
  return { text, role, voice };
}

export function parseChatgpt(data: unknown, format: ParseResult['detectedFormat']): ParseResult {
  const out: ParseResult = { sourceAi: 'chatgpt', detectedFormat: format, formatVersion: null, conversations: [], errors: [], warnings: [] };
  if (!Array.isArray(data)) throw new Error('conversations.json이 배열이 아니에요');
  let artifactCount = 0;
  for (const raw of data as CgConversation[]) {
    const sourceId = raw.id ?? raw.conversation_id ?? null;
    if (!sourceId) { out.errors.push({ conversationSourceId: null, message: '대화 id가 없어 건너뜀' }); continue; }
    const mapping = raw.mapping ?? {};
    const start = raw.current_node && mapping[raw.current_node] ? raw.current_node : pickLeaf(mapping);
    if (!start) { out.errors.push({ conversationSourceId: sourceId, message: '메시지 트리에 현재 가지가 없어 건너뜀' }); continue; }
    const chain: CgNode[] = [];
    const seen = new Set<string>();
    for (let id: string | null | undefined = start; id && mapping[id] && !seen.has(id); id = mapping[id]!.parent) { seen.add(id); chain.push(mapping[id]!); }
    chain.reverse();
    const flags = { artifact: false };
    const messages: NormalizedMessage[] = [];
    for (const node of chain) {
      if (!node.message) continue;
      const t = messageText(node.message, flags);
      if (t) messages.push({ role: t.role, content: t.text, createdAt: normalizeIso(node.message.create_time ?? null), ...(t.voice ? { voice: true } : {}) });
    }
    if (!messages.length) { out.errors.push({ conversationSourceId: sourceId, message: '현재 가지에 보여줄 메시지가 없어 건너뜀' }); continue; }
    if (flags.artifact) artifactCount++;
    const conv: NormalizedConversation = {
      sourceAi: 'chatgpt', sourceId, title: (raw.title ?? '').trim() || messages[0]!.content.slice(0, 40),
      createdAt: normalizeIso(raw.create_time ?? null) ?? messages[0]!.createdAt,
      updatedAt: normalizeIso(raw.update_time ?? null) ?? messages[messages.length - 1]!.createdAt,
      messages, archived: raw.is_archived === true,
      inServiceProject: typeof raw.gizmo_id === 'string' && raw.gizmo_id.startsWith('g-p-'), // 프로젝트 [미검증]
      hasUnextractedArtifact: flags.artifact,
    };
    out.conversations.push(conv);
  }
  if (artifactCount) out.warnings.push(`캔버스·첨부파일이 있는 대화 ${artifactCount}개는 자리표시자로만 저장돼요`);
  return out;
}
