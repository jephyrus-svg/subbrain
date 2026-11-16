/** Graphite 토큰(캔버스·SVG용 HEX). CSS는 styles/tokens.css — 두 곳 값이 같아야 함 */
export const G = {
  canvas: '#070708', base: '#0B0B0C', s1: '#131314', s2: '#1A1A1C', s3: '#222225',
  lineSubtle: '#1F1F22', line: '#2C2C30', lineStrong: '#3C3C41',
  t1: '#EDEDEB', t2: '#A3A3A0', t3: '#8A8A85', t4: '#4A4A48',
  clay: '#D08A66', sage: '#8FB59A', slate: '#7F9CC4', ochre: '#D3B060', mauve: '#B293AE', stone: '#C4C2BC', danger: '#CF6F6A',
} as const;
/** 출처 색: Claude=Clay, ChatGPT=Sage, Gemini=Slate, Claude Code=Ochre, Codex=Mauve, Grok·Grok Bot=Stone */
export const SOURCE_COLOR: Record<string, string> = {
  claude: G.clay, chatgpt: G.sage, gemini: G.slate, 'claude-code': G.ochre, codex: G.mauve, grok: G.stone, grokbot: G.stone,
};
/** 프로젝트 등 범주 색 — 액센트 6색만 */
export const ACCENTS = [G.clay, G.sage, G.slate, G.ochre, G.mauve, G.stone] as const;

/** 엔진이 준 프로젝트 색(아무 HEX)을 가장 가까운 액센트로 맞춘다 — 화면 어디서나 같은 프로젝트는 같은 액센트 */
export function accentOf(hex: string | null | undefined): string {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return G.stone;
  const hue = (h: string) => {
    const [r, g, b] = [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16) / 255) as [number, number, number];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx - mn < 0.08) return -1;
    const d = mx - mn; let x = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return x * 60;
  };
  const h = hue(hex); if (h < 0) return G.stone;
  let best: string = G.stone, bd = 1e9;
  for (const a of [G.clay, G.sage, G.slate, G.ochre, G.mauve]) { const ah = hue(a); const dd = Math.min(Math.abs(ah - h), 360 - Math.abs(ah - h)); if (dd < bd) { bd = dd; best = a; } }
  return best;
}
