// 그래프 엔진: GraphResponse → 3D 배치 → 원근 투영 → 화면 겹침 풀기 → 라벨 충돌 회피.
// design/v3/src/graph3d.py 를 TypeScript로 옮기고, 회전·확대·이동을 받도록 카메라를 붙였다.
import type { GraphEdge, GraphNode, GraphResponse, StatusVisual } from '@subbrain/shared';
import { accentOf } from '../design/tokens';
import { visualOf } from '../lib/format';

export type Kind = 'hub' | 'task' | 'quick' | 'topic';
export interface SNode {
  id: string; kind: Kind; node: GraphNode; w: [number, number, number]; r: number; color: string;
  hubId: string | null; v: StatusVisual | null; projectIndex: number;
}
export interface Scene { nodes: SNode[]; byId: Map<string, SNode>; edges: GraphEdge[]; projects: string[]; colors: Map<string, string> }
export interface Camera { yaw: number; pitch: number; zoom: number; panX: number; panY: number }
export interface PNode extends SNode { x: number; y: number; z: number; s: number; sr: number; dn: number }
export interface Box { x0: number; y0: number; x1: number; y1: number }

export const DEFAULT_CAMERA: Camera = { yaw: -0.28, pitch: 0.30, zoom: 1, panX: 0, panY: 0 };
const F = 760;
// 디자인 v3 배치(프로젝트 8개)를 "큰 프로젝트 순위"로 정렬한 자리. API가 보내는 순서와 상관없이
// 대화가 많은 프로젝트일수록 앞(가운데·앞쪽) 자리를 받는다. 9번째부터는 구면 나선으로 이어 붙인다.
const PRESETS: Array<[number, number, number]> = [
  [140, -150, 30], [-110, 10, -170], [-60, -300, 240], [300, 150, -60], [-360, -180, 200], [60, 280, 120], [-360, 310, 110], [420, -60, 230],
];
const FALLBACK = '#6E6E6B';

function hash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed: number) { let a = seed || 1; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function buildScene(g: GraphResponse): Scene {
  const projects = g.nodes.filter((n) => n.type === 'project');
  const colors = new Map<string, string>();
  const nodes: SNode[] = []; const byId = new Map<string, SNode>();
  const push = (s: SNode) => { nodes.push(s); byId.set(s.id, s); };
  const partOf = new Map<string, string>();
  for (const e of g.edges) if (e.type === 'part_of') partOf.set(e.source, e.target);
  const rank = new Map([...projects].sort((a, b) => b.size - a.size || b.conversationCount - a.conversationCount || a.id.localeCompare(b.id)).map((p, i) => [p.id, i]));
  projects.forEach((p, pi) => {
    const color = p.colorHex ? accentOf(p.colorHex) : FALLBACK; colors.set(p.id, color);
    const ri = rank.get(p.id) ?? pi;
    let pos = PRESETS[ri];
    if (!pos) { const k = ri - PRESETS.length; const y = 1 - 2 * ((k + 0.5) / 12); const rr = Math.sqrt(1 - y * y); const th = k * 2.39996; pos = [Math.cos(th) * rr * 480, y * 360, Math.sin(th) * rr * 480]; }
    const hubR = 12 + 16 * clamp01(p.size);
    push({ id: p.id, kind: 'hub', node: p, w: pos, r: hubR, color, hubId: null, v: null, projectIndex: pi });
    const kids = g.nodes.filter((n) => n.type === 'task' && (partOf.get(n.id) ?? n.projectId) === p.id);
    const tasks = kids.filter((n) => n.kind !== 'quick_question');
    const quick = kids.filter((n) => n.kind === 'quick_question');
    const rnd = rng(hash(p.id));
    const [hx, hy, hz] = pos;
    tasks.forEach((t, k) => {
      const n = tasks.length; const yy = 1 - 2 * (k + 0.5) / n; const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
      const th = k * 2.39996 + (rnd() - 0.5) * 0.6; const d = hubR * 2.2 + 44 + rnd() * 26;
      push({ id: t.id, kind: 'task', node: t, w: [hx + Math.cos(th) * rr * d, hy + yy * d * 0.85, hz + Math.sin(th) * rr * d], r: 2.8 + 7.8 * clamp01(t.size), color, hubId: p.id, v: visualOf(t.statusVisual), projectIndex: pi });
    });
    quick.forEach((q) => {
      const th = rnd() * 6.28; const ph = rnd() * 2 - 1; const d = hubR * 2 + 70 + rnd() * 40;
      push({ id: q.id, kind: 'quick', node: q, w: [hx + Math.cos(th) * d, hy + ph * d * 0.6, hz + Math.sin(th) * d], r: 1.6, color, hubId: p.id, v: 'quick', projectIndex: pi });
    });
  });
  // 프로젝트 없는 과제(미분류)
  const orphan = g.nodes.filter((n) => n.type === 'task' && !byId.has(n.id));
  const ornd = rng(7);
  orphan.forEach((t) => push({ id: t.id, kind: t.kind === 'quick_question' ? 'quick' : 'task', node: t, w: [(ornd() - 0.5) * 500, (ornd() - 0.5) * 400, (ornd() - 0.5) * 300], r: t.kind === 'quick_question' ? 1.6 : 2.8 + 7.8 * clamp01(t.size), color: t.colorHex ?? FALLBACK, hubId: null, v: visualOf(t.statusVisual), projectIndex: -1 }));
  // 주제·기타(위키 등): 이어진 노드들의 가운데
  for (const n of g.nodes) {
    if (byId.has(n.id)) continue;
    const linked = g.edges.filter((e) => e.source === n.id || e.target === n.id).map((e) => byId.get(e.source === n.id ? e.target : e.source)).filter((x): x is SNode => !!x);
    const r0 = rng(hash(n.id));
    let w: [number, number, number];
    if (linked.length) {
      const m = linked.reduce((a, s) => [a[0] + s.w[0], a[1] + s.w[1], a[2] + s.w[2]] as [number, number, number], [0, 0, 0] as [number, number, number]).map((v) => v / linked.length) as [number, number, number];
      w = linked.length === 1 ? [m[0] + 60 + r0() * 30, m[1] - 50 - r0() * 20, m[2]] : [m[0] + (r0() - 0.5) * 30, m[1] - 20 + (r0() - 0.5) * 30, m[2]];
    } else w = [(r0() - 0.5) * 400, (r0() - 0.5) * 300, 0];
    push({ id: n.id, kind: 'topic', node: n, w, r: 3.4, color: FALLBACK, hubId: null, v: null, projectIndex: -1 });
  }
  // 회전 중심 = 허브들의 가운데
  const hubs = nodes.filter((n) => n.kind === 'hub');
  const base = hubs.length ? hubs : nodes;
  let c0 = 0, c1 = 0, c2 = 0;
  for (const s of base) { c0 += s.w[0]; c1 += s.w[1]; c2 += s.w[2]; }
  const nb = Math.max(1, base.length); c0 /= nb; c1 /= nb; c2 /= nb;
  for (const n of nodes) n.w = [n.w[0] - c0, n.w[1] - c1, n.w[2] - c2];
  return { nodes, byId, edges: g.edges, projects: projects.map((p) => p.id), colors };
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

function rotate(w: [number, number, number], yaw: number, pitch: number) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  let [x, y, z] = w;
  [x, z] = [x * cy - z * sy, x * sy + z * cy];
  [y, z] = [y * cp - z * sp, y * sp + z * cp];
  return [x, y, z] as const;
}

/** 기본 각도에서 상자에 꼭 맞는 배율 (회전해도 크기가 튀지 않게 한 번만 잰다) */
export interface Fit { k: number; ox: number; oy: number }
export function fitScale(scene: Scene, box: Box): Fit {
  const pts = scene.nodes.filter((n) => n.kind !== 'quick');
  if (!pts.length) return { k: 1, ox: 0, oy: 0 };
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
  for (const n of pts) {
    const [x, y, z] = rotate(n.w, DEFAULT_CAMERA.yaw, DEFAULT_CAMERA.pitch); const s = F / (F + z);
    const px = x * s, py = y * s, sr = n.r * s;
    mnx = Math.min(mnx, px - sr); mxx = Math.max(mxx, px + sr); mny = Math.min(mny, py - sr); mxy = Math.max(mxy, py + sr);
  }
  const kx = (box.x1 - box.x0) / Math.max(1, mxx - mnx), ky = (box.y1 - box.y0) / Math.max(1, mxy - mny);
  return { k: Math.min(kx, ky, 3), ox: (mnx + mxx) / 2, oy: (mny + mxy) / 2 };
}

export function project(scene: Scene, cam: Camera, box: Box, fit: Fit, relaxIters = 60, sizeCap = Infinity, hubMul = 1): PNode[] {
  const { k, ox, oy } = fit;
  const cx = (box.x0 + box.x1) / 2 + cam.panX, cy = (box.y0 + box.y1) / 2 + cam.panY;
  const kk = k * cam.zoom;
  const out: PNode[] = scene.nodes.map((n) => {
    const [x, y, z] = rotate(n.w, cam.yaw, cam.pitch); const s = F / (F + Math.max(-F * 0.8, z));
    return { ...n, x: (x * s - ox) * kk + cx, y: (y * s - oy) * kk + cy, z, s, sr: n.r * s * Math.sqrt(Math.min(kk, sizeCap)) * 1.25 * (n.kind === 'hub' ? hubMul : 1), dn: 0 };
  });
  let z0 = Infinity, z1 = -Infinity;
  for (const n of out) { z0 = Math.min(z0, n.z); z1 = Math.max(z1, n.z); }
  for (const n of out) n.dn = z1 > z0 ? (n.z - z0) / (z1 - z0) : 0;
  // 화면상 겹침 살짝 풀기 (허브는 고정)
  const solid = out.filter((n) => n.kind !== 'quick');
  for (let it = 0; it < relaxIters; it++) {
    let moved = false;
    for (let i = 0; i < solid.length; i++) {
      const a = solid[i]!;
      for (let j = i + 1; j < solid.length; j++) {
        const b = solid[j]!;
        const m = a.sr + b.sr + 5; const dx = b.x - a.x, dy = b.y - a.y;
        if (Math.abs(dx) > m || Math.abs(dy) > m) continue;
        let d = Math.hypot(dx, dy);
        if (d >= m) continue;
        const fa = a.kind === 'hub' ? 0 : 1, fb = b.kind === 'hub' ? 0 : 1;
        if (fa + fb === 0) continue;
        d = d || 0.01; const pu = (m - d) / 2, ux = dx / d, uy = dy / d;
        a.x -= ux * pu * 2 * fa / (fa + fb); a.y -= uy * pu * 2 * fa / (fa + fb);
        b.x += ux * pu * 2 * fb / (fa + fb); b.y += uy * pu * 2 * fb / (fa + fb);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}

export const curve = (ax: number, ay: number, bx: number, by: number, bend = 0.12) => {
  const mx = (ax + bx) / 2 + (by - ay) * bend, my = (ay + by) / 2 - (bx - ax) * bend;
  return `M${ax.toFixed(1)} ${ay.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
};

// ── 라벨 ──
let ctx: CanvasRenderingContext2D | null = null;
const widthCache = new Map<string, number>();
export function textWidth(s: string, fs: number, weight = 500): number {
  const key = `${weight}|${fs}|${s}`;
  const hit = widthCache.get(key); if (hit !== undefined) return hit;
  ctx ??= document.createElement('canvas').getContext('2d');
  let w = s.length * fs * 0.62;
  if (ctx) { ctx.font = `${weight} ${fs}px Pretendard, "Noto Sans CJK KR", sans-serif`; w = ctx.measureText(s).width; }
  widthCache.set(key, w); return w;
}
export const clearTextCache = () => widthCache.clear();

export interface Wanted { n: PNode; prio: number; main: string; extra: string | null; kind: Label['kind']; sel: boolean }
export interface Label { id: string; x: number; y: number; fs: number; kind: 'hub' | 'task' | 'topic'; main: string; extra: string | null; extraColor: string | null; color: string; weight: number }
type Rect = [number, number, number, number];

export function placeLabels(nodes: PNode[], wanted: Wanted[], box: Box, blocked: Rect[], fonts: { hub: number; hubSel: number; task: number }, edge = 12): Label[] {
  const boxes: Rect[] = nodes.filter((n) => n.kind !== 'quick').map((n) => [n.x - n.sr - 3, n.y - n.sr - 3, n.x + n.sr + 3, n.y + n.sr + 3]);
  const placed: Rect[] = [];
  const hit = (b: Rect) => {
    if (b[0] < box.x0 - edge || b[2] > box.x1 + edge || b[1] < box.y0 - edge || b[3] > box.y1 + edge) return true;
    for (const c of boxes) if (b[0] < c[2] && b[2] > c[0] && b[1] < c[3] && b[3] > c[1]) return true;
    for (const c of blocked) if (b[0] < c[2] && b[2] > c[0] && b[1] < c[3] && b[3] > c[1]) return true;
    for (const c of placed) if (b[0] < c[2] && b[2] > c[0] && b[1] < c[3] && b[3] > c[1]) return true;
    return false;
  };
  const out: Label[] = [];
  for (const it of [...wanted].sort((a, b) => a.prio - b.prio)) {
    const { n } = it;
    const fs = it.kind === 'hub' ? (it.sel ? fonts.hubSel : fonts.hub) : fonts.task;
    const weight = it.kind === 'hub' ? (it.sel ? 700 : 600) : it.kind === 'task' ? 400 : 400;
    const w = textWidth(it.main + (it.extra ? ` ${it.extra}` : ''), fs, weight) + 4; const h = fs * 1.3;
    const r = n.sr + (it.sel ? 8 : it.kind === 'task' ? 4 : 0); const g = 6; const x = n.x, y = n.y;
    const cands: Array<[number, number]> = [[x + r + g, y - h / 2], [x - r - g - w, y - h / 2], [x - w / 2, y + r + g - 2], [x - w / 2, y - r - g - h + 2],
      [x + r + g, y - h / 2 + 11], [x + r + g, y - h / 2 - 11], [x - r - g - w, y - h / 2 + 11], [x - r - g - w, y - h / 2 - 11], [x + r + g, y + r], [x - r - g - w, y + r]];
    let chosen: [number, number] | null = null;
    for (const c of cands) { const b: Rect = [c[0], c[1], c[0] + w, c[1] + h]; if (!hit(b)) { chosen = c; placed.push(b); break; } }
    if (!chosen) {
      if (!it.sel && it.prio > 0.5 && it.kind !== 'hub') continue; // 자리가 없으면 과제·주제 라벨은 생략
      chosen = cands[0]!; placed.push([chosen[0], chosen[1], chosen[0] + w, chosen[1] + h]);
    }
    const color = it.kind === 'hub' ? (it.sel ? '#EDEDEB' : n.dn < 0.6 ? '#EDEDEB' : '#A3A3A0') : it.kind === 'task' ? '#A3A3A0' : '#8A8A85';
    const ec = n.v === 'stall' ? '#D08A66' : n.v === 'stall2' ? '#D3B060' : '#8FB59A';
    out.push({ id: n.id, x: chosen[0], y: chosen[1] + h * 0.78, fs, kind: it.kind, main: it.main, extra: it.extra, extraColor: it.extra ? ec : null, color, weight });
  }
  return out;
}
