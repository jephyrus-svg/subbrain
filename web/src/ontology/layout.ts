// 온톨로지 그래프 배치: 프로젝트는 홈과 같은 자리(design v3 PRESETS), 과제는 프로젝트 둘레,
// 나머지 객체는 이어진 것들 사이에 놓고 작은 3D 힘 배치로 한 번 편다(결정적, 시드 고정).
// 투영·겹침 풀기는 graph/engine.ts와 같은 방식.
import { textWidth } from '../graph/engine';
import type { OData, OLink, OObject } from './model';

export interface Camera { yaw: number; pitch: number; zoom: number; panX: number; panY: number }
export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface SNode { id: string; o: OObject; w: [number, number, number]; r: number; color: string; sphere: boolean; pi: number }
export interface PNode extends SNode { x: number; y: number; z: number; s: number; sr: number; dn: number }
export interface Scene { nodes: SNode[]; byId: Map<string, SNode>; projectColors: string[] }

export const DEFAULT_CAMERA: Camera = { yaw: -0.28, pitch: 0.3, zoom: 1, panX: 0, panY: 0 };
const F = 760;
const HOME_POS: Record<string, [number, number, number]> = {
  prj_subbrain: [140, -150, 30], prj_blog: [-110, 10, -170], prj_devstudy: [-60, -300, 240], prj_moving: [300, 150, -60],
  prj_career: [-360, -180, 200], prj_kyoto: [60, 280, 120], prj_dividend: [-360, 310, 110], prj_health: [420, -60, 230],
};
const FALLBACK = '#6E6E6B';

function hash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed: number) { let a = seed || 1; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** 모든 객체(필터와 무관)로 한 번만 배치한다 → 필터를 바꿔도 자리가 튀지 않는다 */
export function buildScene(d: OData): Scene {
  const nodes: SNode[] = []; const byId = new Map<string, SNode>();
  const projects = d.objects.filter((o) => o.type === 'project');
  const projectColors = projects.map((p) => p.color ?? FALLBACK);
  const pIndex = new Map(projects.map((p, i) => [p.id, i]));
  const maxM = Math.max(1, ...projects.map((p) => p.mentions));
  const links = d.links.filter((l) => l.status !== 'rejected');
  const nb = new Map<string, string[]>();
  for (const l of links) { (nb.get(l.src) ?? nb.set(l.src, []).get(l.src)!).push(l.dst); (nb.get(l.dst) ?? nb.set(l.dst, []).get(l.dst)!).push(l.src); }
  const push = (s: SNode) => { nodes.push(s); byId.set(s.id, s); };

  projects.forEach((p, k) => {
    const base = HOME_POS[p.ref ?? ''] ?? (() => { const y = 1 - 2 * ((k + 0.5) / Math.max(12, projects.length)); const rr = Math.sqrt(Math.max(0, 1 - y * y)); const th = k * 2.39996; return [Math.cos(th) * rr * 480, y * 360, Math.sin(th) * rr * 480] as [number, number, number]; })();
    push({ id: p.id, o: p, w: [base[0] * 1.3, base[1] * 1.6, base[2] * 1.2], r: 11 + 13 * Math.sqrt(p.mentions / maxM), color: p.color ?? FALLBACK, sphere: true, pi: k });
  });
  for (const p of projects) {
    const hub = byId.get(p.id)!; const tasks = d.objects.filter((o) => o.type === 'task' && o.project === p.id);
    const rnd = rng(hash(p.id));
    tasks.forEach((t, k) => {
      const n = tasks.length; const yy = n === 1 ? 0.2 : 1 - 2 * (k + 0.5) / n; const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
      const th = k * 2.39996 + rnd() * 1.2; const dd = hub.r * 2 + 62 + rnd() * 18;
      push({ id: t.id, o: t, w: [hub.w[0] + Math.cos(th) * rr * dd, hub.w[1] + yy * dd * 0.8, hub.w[2] + Math.sin(th) * rr * dd], r: 3.6 + 5.4 * clamp01(t.mentions / 14), color: hub.color, sphere: true, pi: pIndex.get(p.id) ?? -1 });
    });
  }
  // 나머지: 이어진 것들의 가운데 + 흔들기 (여러 번 돌며 자리 잡은 이웃이 생기면 놓는다)
  let rest = d.objects.filter((o) => !byId.has(o.id));
  for (let pass = 0; pass < 4 && rest.length; pass++) {
    const left: OObject[] = [];
    for (const o of rest) {
      const placed = (nb.get(o.id) ?? []).map((x) => byId.get(x)).filter((x): x is SNode => !!x);
      if (!placed.length && pass < 3) { left.push(o); continue; }
      const r0 = rng(hash(o.id));
      const m: [number, number, number] = [0, 0, 0];
      for (const s of placed) { m[0] += s.w[0] / placed.length; m[1] += s.w[1] / placed.length; m[2] += s.w[2] / placed.length; }
      const j = placed.length === 1 ? 70 : 34;
      push({ id: o.id, o, w: [m[0] + (r0() - 0.5) * 2 * j, m[1] + (r0() - 0.5) * 2 * j - (placed.length === 1 ? 20 : 0), m[2] + (r0() - 0.5) * 2 * j], r: o.type === 'topic' ? 4 : 6.4 + 2.6 * clamp01((o.mentions - 1) / 14), color: FALLBACK, sphere: false, pi: -1 });
    }
    rest = left;
  }
  relax3d(nodes, byId, links);
  let c0 = 0, c1 = 0, c2 = 0;
  for (const n of nodes) { c0 += n.w[0]; c1 += n.w[1]; c2 += n.w[2]; }
  c0 /= nodes.length; c1 /= nodes.length; c2 /= nodes.length;
  for (const n of nodes) n.w = [n.w[0] - c0, n.w[1] - c1, n.w[2] - c2];
  return { nodes, byId, projectColors };
}

function relax3d(nodes: SNode[], byId: Map<string, SNode>, links: OLink[]) {
  const N = 240;
  const pairs = links.map((l) => [byId.get(l.src), byId.get(l.dst), l.type] as const).filter((p): p is readonly [SNode, SNode, OLink['type']] => !!p[0] && !!p[1]);
  for (let it = 0; it < N; it++) {
    const cap = 7 * (1 - it / N) + 0.4;
    const f = new Map<string, [number, number, number]>(nodes.map((n) => [n.id, [0, 0, 0]]));
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]!;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j]!;
        const dx = b.w[0] - a.w[0], dy = b.w[1] - a.w[1], dz = b.w[2] - a.w[2];
        const d2 = dx * dx + dy * dy + dz * dz; if (d2 > 240 * 240) continue;
        const d = Math.sqrt(d2) || 0.1; const want = (a.r + b.r) * 1.6 + 58;
        const k = 4200 / (d2 + 60) + (d < want ? (want - d) * 0.1 : 0);
        const fa = f.get(a.id)!, fb = f.get(b.id)!;
        fa[0] -= (dx / d) * k; fa[1] -= (dy / d) * k; fa[2] -= (dz / d) * k;
        fb[0] += (dx / d) * k; fb[1] += (dy / d) * k; fb[2] += (dz / d) * k;
      }
    }
    for (const [a, b, t] of pairs) {
      const dx = b.w[0] - a.w[0], dy = b.w[1] - a.w[1], dz = b.w[2] - a.w[2];
      const d = Math.hypot(dx, dy, dz) || 0.1;
      const L = t === 'part_of' ? a.r + b.r + 70 : a.r + b.r + 112;
      const k = (d - L) * (t === 'part_of' ? 0.03 : 0.013);
      const fa = f.get(a.id)!, fb = f.get(b.id)!;
      fa[0] += (dx / d) * k; fa[1] += (dy / d) * k; fa[2] += (dz / d) * k;
      fb[0] -= (dx / d) * k; fb[1] -= (dy / d) * k; fb[2] -= (dz / d) * k;
    }
    for (const n of nodes) {
      if (n.o.type === 'project') continue;
      const v = f.get(n.id)!;
      const m = Math.hypot(v[0], v[1], v[2]); const s = m > cap ? cap / m : 1;
      n.w = [n.w[0] + v[0] * s, n.w[1] + v[1] * s, n.w[2] + v[2] * s];
    }
  }
}

function rotate(w: [number, number, number], yaw: number, pitch: number) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  let [x, y, z] = w;
  [x, z] = [x * cy - z * sy, x * sy + z * cy];
  [y, z] = [y * cp - z * sp, y * sp + z * cp];
  return [x, y, z] as const;
}

export interface Fit { k: number; ox: number; oy: number }
export function fitScale(scene: Scene, box: Box, visible?: Set<string>): Fit {
  // 많을 때(>300)는 보이는 객체 기준 + 양끝 4%를 빼고 맞춘다 → 멀리 떨어진 몇 개 때문에 가운데가 뭉치지 않게
  const ns = visible && visible.size ? scene.nodes.filter((n) => visible.has(n.id)) : scene.nodes;
  const xs: number[] = [], ys: number[] = [];
  let rMax = 0;
  for (const n of ns) {
    const [x, y, z] = rotate(n.w, DEFAULT_CAMERA.yaw, DEFAULT_CAMERA.pitch); const s = F / (F + z);
    xs.push(x * s); ys.push(y * s); rMax = Math.max(rMax, n.r);
  }
  if (!xs.length) return { k: 1, ox: 0, oy: 0 };
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const q = scene.nodes.length > 300 && xs.length > 40 ? 0.025 : 0;
  const at = (a: number[], f: number) => a[Math.min(a.length - 1, Math.max(0, Math.round(f * (a.length - 1))))]!;
  const mnx = at(xs, q) - rMax, mxx = at(xs, 1 - q) + rMax, mny = at(ys, q) - rMax, mxy = at(ys, 1 - q) + rMax;
  const kx = (box.x1 - box.x0) / Math.max(1, mxx - mnx), ky = (box.y1 - box.y0) / Math.max(1, mxy - mny);
  return { k: Math.min(kx, ky, 3), ox: (mnx + mxx) / 2, oy: (mny + mxy) / 2 };
}

export function project(scene: Scene, visible: Set<string>, cam: Camera, box: Box, fit: Fit, relaxIters = 50): PNode[] {
  const { k, ox, oy } = fit;
  const cx = (box.x0 + box.x1) / 2 + cam.panX, cy = (box.y0 + box.y1) / 2 + cam.panY;
  const kk = k * cam.zoom;
  const out: PNode[] = scene.nodes.filter((n) => visible.has(n.id)).map((n) => {
    const [x, y, z] = rotate(n.w, cam.yaw, cam.pitch); const s = F / (F + Math.max(-F * 0.8, z));
    const grow = n.sphere ? 1.25 : 1.4;
    return { ...n, x: (x * s - ox) * kk + cx, y: (y * s - oy) * kk + cy, z, s, sr: n.r * Math.min(s, 1.35) * Math.min(Math.sqrt(kk), 1.25 * Math.sqrt(cam.zoom)) * grow, dn: 0 };
  });
  let z0 = Infinity, z1 = -Infinity;
  for (const n of out) { z0 = Math.min(z0, n.z); z1 = Math.max(z1, n.z); }
  for (const n of out) n.dn = z1 > z0 ? (n.z - z0) / (z1 - z0) : 0;
  for (let it = 0; it < relaxIters; it++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[i]!;
      for (let j = i + 1; j < out.length; j++) {
        const b = out[j]!;
        const m = a.sr + b.sr + 7; const dx = b.x - a.x, dy = b.y - a.y;
        if (Math.abs(dx) > m || Math.abs(dy) > m) continue;
        let d = Math.hypot(dx, dy); if (d >= m) continue;
        const fa = a.o.type === 'project' ? 0 : 1, fb = b.o.type === 'project' ? 0 : 1;
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

/** 휜 선의 조절점 (같은 두 객체 사이 여러 관계는 휨을 달리한다) */
export function ctrl(ax: number, ay: number, bx: number, by: number, bend: number): [number, number] {
  return [(ax + bx) / 2 + (by - ay) * bend, (ay + by) / 2 - (bx - ax) * bend];
}
/** A·B 원 바깥에서 시작·끝나도록 줄인 2차 곡선 */
export function trimmedCurve(ax: number, ay: number, ar: number, bx: number, by: number, br: number, bend: number) {
  const [mx, my] = ctrl(ax, ay, bx, by, bend);
  const da = Math.hypot(mx - ax, my - ay) || 1, db = Math.hypot(bx - mx, by - my) || 1;
  const sx = ax + ((mx - ax) / da) * ar, sy = ay + ((my - ay) / da) * ar;
  const ex = bx - ((bx - mx) / db) * br, ey = by - ((by - my) / db) * br;
  const mid: [number, number] = [0.25 * sx + 0.5 * mx + 0.25 * ex, 0.25 * sy + 0.5 * my + 0.25 * ey];
  // 중간점의 접선 방향(라벨 기울기용)
  const ang = Math.atan2(ey - sy, ex - sx);
  return { d: `M${sx.toFixed(1)} ${sy.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`, mid, ang, len: Math.hypot(ex - sx, ey - sy) };
}

// ── 라벨 ──
type Rect = [number, number, number, number];
export interface Want { n: PNode; prio: number; text: string; extra?: string | null; extraColor?: string; kind: 'project' | 'task' | 'obj' | 'topic'; sel: boolean; dim: boolean }
export interface Label { id: string; x: number; y: number; fs: number; text: string; extra?: string | null; extraColor?: string; color: string; weight: number; italic: boolean; rect: Rect }
const hitAny = (b: Rect, list: Rect[]) => list.some((c) => b[0] < c[2] && b[2] > c[0] && b[1] < c[3] && b[3] > c[1]);

export function placeLabels(nodes: PNode[], wanted: Want[], box: Box, blocked: Rect[], maxCount = Infinity): Label[] {
  let free = maxCount; // 고른·마우스 올린 것(sel·prio<0.5)은 개수 제한 밖
  const boxes: Rect[] = nodes.map((n) => [n.x - n.sr - 2, n.y - n.sr - 2, n.x + n.sr + 2, n.y + n.sr + 2]);
  const placed: Rect[] = []; const out: Label[] = [];
  for (const it of [...wanted].sort((a, b) => a.prio - b.prio)) {
    const { n } = it;
    const must = it.sel || it.prio < 0.5;
    if (!must && free <= 0) continue;
    const fs = it.kind === 'project' ? (it.sel ? 15 : 13) : it.sel ? 12.5 : 11;
    const weight = it.kind === 'project' ? (it.sel ? 700 : 600) : it.sel ? 600 : it.kind === 'obj' ? 500 : 400;
    const w = textWidth(it.text + (it.extra ? ` ${it.extra}` : ''), fs, weight) + 4; const h = fs * 1.3;
    const r = n.sr + (it.sel ? 9 : 4); const g = 5; const x = n.x, y = n.y;
    const cands: Array<[number, number]> = [[x + r + g, y - h / 2], [x - r - g - w, y - h / 2], [x - w / 2, y + r + g - 2], [x - w / 2, y - r - g - h + 2],
      [x + r + g, y - h / 2 + 11], [x + r + g, y - h / 2 - 11], [x - r - g - w, y - h / 2 + 11], [x - r - g - w, y - h / 2 - 11], [x + r, y + r], [x - r - w, y + r], [x + r, y - r - h], [x - r - w, y - r - h]];
    let chosen: Rect | null = null;
    for (const c of cands) {
      const b: Rect = [c[0], c[1], c[0] + w, c[1] + h];
      if (b[0] < box.x0 - 14 || b[2] > box.x1 + 24 || b[1] < box.y0 - 30 || b[3] > box.y1 + 30) continue;
      if (hitAny(b, boxes) || hitAny(b, blocked) || hitAny(b, placed)) continue;
      chosen = b; break;
    }
    if (!chosen) { if (!it.sel) continue; const c = cands[0]!; chosen = [c[0], c[1], c[0] + w, c[1] + h]; }
    placed.push(chosen); if (!must) free--;
    const color = it.dim ? '#4A4A48' : it.kind === 'project' ? (it.sel ? '#EDEDEB' : n.dn < 0.6 ? '#EDEDEB' : '#A3A3A0') : it.sel ? '#EDEDEB' : it.kind === 'topic' ? '#8A8A85' : it.kind === 'obj' ? '#C4C2BC' : '#A3A3A0';
    out.push({ id: n.id, x: chosen[0], y: chosen[1] + h * 0.78, fs, text: it.text, extra: it.extra, extraColor: it.extraColor, color, weight, italic: it.kind === 'topic', rect: chosen });
  }
  return out;
}

export interface EdgeLabelWant { id: string; text: string; x: number; y: number; color: string; prio: number }
export interface EdgeLabel extends EdgeLabelWant { w: number }
export function placeEdgeLabels(wanted: EdgeLabelWant[], nodes: PNode[], labels: Label[], blocked: Rect[]): EdgeLabel[] {
  const boxes: Rect[] = [...nodes.map((n): Rect => [n.x - n.sr - 1, n.y - n.sr - 1, n.x + n.sr + 1, n.y + n.sr + 1]), ...labels.map((l) => l.rect), ...blocked];
  const out: EdgeLabel[] = [];
  for (const it of [...wanted].sort((a, b) => a.prio - b.prio)) {
    const w = textWidth(it.text, 10, 500) + 8; const h = 15;
    for (const [dx, dy] of [[0, 0], [0, -10], [0, 10], [14, 0], [-14, 0], [0, -18], [0, 18], [20, -8], [-20, 8]] as const) {
      const b: Rect = [it.x + dx - w / 2, it.y + dy - h / 2, it.x + dx + w / 2, it.y + dy + h / 2];
      if (hitAny(b, boxes)) continue;
      boxes.push(b); out.push({ ...it, x: it.x + dx, y: it.y + dy, w }); break;
    }
  }
  return out;
}
