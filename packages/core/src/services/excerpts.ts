/** 발췌 규칙(설계서 §6.2): 첫 사용자 메시지, 마지막 AI 답변 앞부분, 마지막 사용자 메시지, 분류 근거 문장. 각 500자 이내 */
import type { Excerpt, MessageRole, SourceAi } from '@subbrain/shared';
import { SOURCE_AI_LABEL } from '@subbrain/shared/constants';
import type { Db } from '../db/db.ts';
import { L } from '../util/lang.ts';

const clip = (s: string, n = 500) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
export function speakerLabel(role: MessageRole, ai: SourceAi): string {
  return role === 'user' ? L('나', 'Me') : role === 'assistant' ? SOURCE_AI_LABEL[ai] : role === 'tool' ? L('도구', 'Tool') : L('시스템', 'System');
}
/** evidence 문자열 안의 인용(‘…’, “…”, '…', "…")을 뽑는다 */
export function quoteIn(evidence: string | null): string | null {
  if (!evidence) return null;
  const m = evidence.match(/[‘“'"]([^’”'"]{4,})[’”'"]/);
  return m ? m[1]!.replace(/…$/, '').trim() : null;
}

export function computeExcerpts(db: Db, conversationId: string, ai: SourceAi, evidence: string | null, max = 3): Excerpt[] {
  type M = { seq: number; role: MessageRole; content_md: string };
  const first = db.get<M>("SELECT seq, role, content_md FROM messages WHERE conversation_id=? AND role='user' ORDER BY seq LIMIT 1", conversationId);
  const lastUser = db.get<M>("SELECT seq, role, content_md FROM messages WHERE conversation_id=? AND role='user' ORDER BY seq DESC LIMIT 1", conversationId);
  const lastAi = db.get<M>("SELECT seq, role, content_md FROM messages WHERE conversation_id=? AND role='assistant' ORDER BY seq DESC LIMIT 1", conversationId);
  const q = quoteIn(evidence);
  let evidenceSeq: number | null = null;
  if (q) evidenceSeq = db.value<number>("SELECT seq FROM messages WHERE conversation_id=? AND instr(content_md, ?) > 0 ORDER BY seq DESC LIMIT 1", conversationId, q.slice(0, 40));
  else if ((evidence?.includes('마지막 사용자 메시지') || evidence?.includes('Last user message')) && lastUser) evidenceSeq = lastUser.seq;
  const ev = evidenceSeq !== null ? db.get<M>('SELECT seq, role, content_md FROM messages WHERE conversation_id=? AND seq=?', conversationId, evidenceSeq) : undefined;
  const picked = new Map<number, M>();
  for (const m of [ev, lastUser, lastAi, first]) if (m && !picked.has(m.seq) && picked.size < max) picked.set(m.seq, m);
  return [...picked.values()].sort((a, b) => b.seq - a.seq).map((m) => ({
    role: m.role, speakerLabel: speakerLabel(m.role, ai), textMd: clip(m.content_md.trim()), messageSeq: m.seq, isEvidence: m.seq === evidenceSeq,
  }));
}
