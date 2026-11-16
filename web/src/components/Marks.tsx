import type { SourceAi, StatusVisual } from '@subbrain/shared';
import { aiLabel, visualOf } from '../lib/format';

// AI 표식: ChatGPT=원, Claude=둥근 사각, Gemini=마름모, Grok=삼각 (meta.sourceAis[].shape)
// Graphite 출처 색(styles/tokens.css): Claude=Clay · ChatGPT=Sage · Gemini=Slate · Claude Code=Ochre · Codex=Mauve · Grok·Grok Bot=Stone
// 1.10.0 Grok Bot=Stone 삼각을 흐리게 — Grok(또렷한 Stone 삼각)과 구분
// 1.5.0 로컬 세션: Claude Code=속 빈 둥근 사각(Ochre), Codex=속 빈 원(Mauve) — 같은 회사 웹 표식과 모양은 같고, 속이 비어 '내 컴퓨터에서 읽은 세션'임을 구분
const MK: Record<SourceAi, string> = { chatgpt: 'g', claude: 'c', gemini: 'm', grok: 'x', 'claude-code': 'cc', codex: 'cx', grokbot: 'gb' };
export const mkClass = (ai: string | null | undefined) => `mk ${ai && ai in MK ? MK[ai as SourceAi] : 'g'}`;

export function AiMark({ ai, style }: { ai: string | null | undefined; style?: React.CSSProperties }) {
  return <i className={mkClass(ai)} title={aiLabel(ai)} style={style} />;
}
export function Svc({ ai, label = true }: { ai: string; label?: boolean }) {
  return <span className="svc"><AiMark ai={ai} />{label ? aiLabel(ai) : null}</span>;
}
export function StatusGlyph({ v, title }: { v: StatusVisual | string | null | undefined; title?: string }) {
  return <i className={`st ${visualOf(v)}`} title={title} />;
}
export function Sphere({ color, size }: { color: string; size?: number }) {
  return <i className="ps" style={{ ['--c' as string]: color, ...(size ? { width: size, height: size } : {}) }} />;
}
