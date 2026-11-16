/**
 * Claude(claude.ai) 데이터 내보내기 파서.
 * 형식(공개적으로 알려진 모양 [미검증: Anthropic 공식 스키마 문서 없음, 필드는 바뀔 수 있음]):
 *   conversations.json = [{ uuid, name, created_at(ISO), updated_at, account:{uuid},
 *     chat_messages: [{ uuid, sender:'human'|'assistant', text, content?:[{type:'text',text}|{type:'tool_use',name}|...],
 *       created_at, updated_at, attachments?:[{file_name, extracted_content}], files?:[{file_name}],
 *       parent_message_uuid? }] }]
 * 규칙: parent_message_uuid가 있으면(편집으로 가지가 생긴 경우) 가장 늦은 메시지에서 부모를 따라 올라간 가지만 쓴다.
 */
import { normalizeIso } from '../util/time.ts';
import type { NormalizedConversation, NormalizedMessage, ParseResult } from './types.ts';

interface ClBlock { type?: string; text?: string; name?: string }
interface ClMessage {
  uuid?: string; sender?: string; text?: string; content?: ClBlock[]; created_at?: string; updated_at?: string;
  attachments?: Array<{ file_name?: string; extracted_content?: string }>; files?: Array<{ file_name?: string }>; parent_message_uuid?: string | null;
}
interface ClConversation { uuid?: string; name?: string | null; created_at?: string; updated_at?: string; chat_messages?: ClMessage[]; project_uuid?: string | null }

export function looksLikeClaude(data: unknown): boolean {
  return Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null && 'chat_messages' in data[0];
}

const ROOT = '00000000-0000-4000-8000-000000000000'; // 일부 내보내기에서 첫 메시지의 부모로 쓰는 값 [추정]

function currentBranch(msgs: ClMessage[]): ClMessage[] {
  if (!msgs.some((m) => m.parent_message_uuid)) return msgs;
  const byId = new Map(msgs.filter((m) => m.uuid).map((m) => [m.uuid!, m]));
  const last = [...msgs].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '')).at(-1);
  const chain: ClMessage[] = [];
  const seen = new Set<string>();
  for (let m: ClMessage | undefined = last; m && m.uuid && !seen.has(m.uuid); m = m.parent_message_uuid && m.parent_message_uuid !== ROOT ? byId.get(m.parent_message_uuid) : undefined) {
    seen.add(m.uuid); chain.push(m);
  }
  return chain.reverse();
}

export function parseClaude(data: unknown, format: ParseResult['detectedFormat']): ParseResult {
  const out: ParseResult = { sourceAi: 'claude', detectedFormat: format, formatVersion: null, conversations: [], errors: [], warnings: [] };
  if (!Array.isArray(data)) throw new Error('conversations.json이 배열이 아니에요');
  let artifactCount = 0;
  for (const raw of data as ClConversation[]) {
    const sourceId = raw.uuid;
    if (!sourceId) { out.errors.push({ conversationSourceId: null, message: '대화 uuid가 없어 건너뜀' }); continue; }
    let artifact = false;
    const messages: NormalizedMessage[] = [];
    for (const m of currentBranch(raw.chat_messages ?? [])) {
      const role = m.sender === 'human' ? 'user' : m.sender === 'assistant' ? 'assistant' : null;
      if (!role) continue;
      let text = '';
      if (Array.isArray(m.content) && m.content.length) {
        text = m.content.map((b) => b.type === 'text' ? b.text ?? '' : b.type === 'tool_use' ? `[도구 사용: ${b.name ?? '?'}]` : '').filter(Boolean).join('\n\n');
      }
      if (!text.trim()) text = m.text ?? '';
      for (const a of m.attachments ?? []) { if (a.file_name) text += `\n\n[첨부: ${a.file_name}]`; if (!a.extracted_content) artifact = true; }
      for (const f of m.files ?? []) { if (f.file_name) { text += `\n\n[첨부: ${f.file_name}]`; artifact = true; } }
      text = text.trim();
      if (text) messages.push({ role, content: text, createdAt: normalizeIso(m.created_at ?? null) });
    }
    if (!messages.length) { out.errors.push({ conversationSourceId: sourceId, message: '메시지가 없는 대화라 건너뜀' }); continue; }
    if (artifact) artifactCount++;
    const conv: NormalizedConversation = {
      sourceAi: 'claude', sourceId, title: (raw.name ?? '').trim() || messages[0]!.content.slice(0, 40),
      createdAt: normalizeIso(raw.created_at ?? null) ?? messages[0]!.createdAt,
      updatedAt: normalizeIso(raw.updated_at ?? null) ?? messages[messages.length - 1]!.createdAt,
      messages, archived: false, inServiceProject: Boolean(raw.project_uuid), hasUnextractedArtifact: artifact,
    };
    out.conversations.push(conv);
  }
  if (artifactCount) out.warnings.push(`내용을 못 읽은 첨부파일이 있는 대화 ${artifactCount}개는 자리표시자로만 저장돼요`);
  return out;
}
