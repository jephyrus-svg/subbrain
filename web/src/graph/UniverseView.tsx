import { tt, ttf } from '../i18n';
// 홈 첫 화면용 "작은 우주" 3D 그래프 (Canvas 2D, 새 의존성 없음).
// - 배치: 프로젝트마다 구면 위 한 영역(피보나치 구 방향)을 받고, 과제는 그 둘레 구면 띠에, 주제는 이어진 노드 방향의 안쪽 구에 놓인다.
// - 회전: 90초에 한 바퀴(분당 1바퀴 이하), 살짝 기울인 축. 끌기·호버·조작 중엔 멈추고 3초 쉬면 천천히 다시 돈다. prefers-reduced-motion 이면 자동 회전 없음.
// - Graphite: 캔버스 #070708, 작은 점 노드 + 얇은 낮은 대비 선(Obsidian), 호버 시 이웃만 밝힘, 깊이 = 명도 감쇠 + 크기(nullschool), 구운 그늘(basement). 그라데이션·글로·블룸 없음.
// - 색: 액센트 6색만. 프로젝트 과제 = 프로젝트 색, 프로젝트 없는 과제 = 첫 주제별 색(같은 주제끼리 같은 색), 주제 = 이어진 과제 색을 옅게. 완료는 회색이 아니라 작고 차분하게.
// - 성능: devicePixelRatio 최대 2, 탭이 숨으면 그리기 멈춤, 변화가 없으면 프레임을 건너뜀.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { GraphEdge, GraphNode, GraphResponse } from '@subbrain/shared';
import { mix, visualOf } from '../lib/format';
import { ACCENTS, G, accentOf } from '../design/tokens';
import type { GraphHandle } from './GraphView';

interface Props {
  data: GraphResponse;
  selectedId: string | null;
  hoverId?: string | null;
  onSelect?: (id: string, node: GraphNode) => void;
  onOpen?: (node: GraphNode) => void;
  rotateOnDrag?: boolean;
  autoRotate?: boolean;
  ariaLabel?: string;
}
type Kind = 'hub' | 'task' | 'quick' | 'topic';
interface UNode { id: string; kind: Kind; node: GraphNode; p: [number, number, number]; r: number; color: string; hubId: string | null; v: string | null }
interface ULink { a: string; b: string; s: number; color: string; dashed: boolean; phase: number }
interface Proj { n: UNode; x: number; y: number; z: number; s: number; sr: number; d: number }

const R = 300;            // 우주 반지름 (월드 단위)
const FOCAL = 900;        // 원근 초점 거리
const DIST = 1050;        // 카메라 ~ 중심 거리
const TURN_MS = 90000;    // 한 바퀴 90초 (분당 1바퀴 이하 — Graphite 규칙)
const IDLE_MS = 3000;
const TILT = 0.38;        // 기본 기울기 (rad)
const BG = G.canvas;
const RUN = G.ochre, STALL = G.danger, STALL2 = G.clay;
// 손으로 칠한 듯한 물감 색 (중간 채도: 다채롭되 형광·네온은 아님, 서로 구별됨)
const PALETTE: readonly string[] = ACCENTS; // 액센트 6색만 (Clay·Sage·Slate·Ochre·Mauve·Stone)
const DARK = G.canvas; // 깊이: 캔버스 쪽으로 명도 감쇠 (nullschool식 fog, 블룸 없음)

function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed: number) { let a = seed || 1; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const c01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
type V3 = [number, number, number];
const norm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const fib = (i: number, n: number): V3 => { const y = 1 - 2 * ((i + 0.5) / n); const r = Math.sqrt(1 - y * y); const t = i * 2.39996323; return [Math.cos(t) * r, y * 0.92, Math.sin(t) * r]; };

/** 기존 프로젝트 색을 차분하게: 채도·명도를 눌러 주고, 없으면 팔레트 */
function calm(hex: string | null | undefined, i: number) {
  const base = PALETTE[i % PALETTE.length]!;
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return base;
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255) as [number, number, number];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
  return `hsl(${Math.round(h * 360)} ${Math.round(Math.max(0.38, Math.min(s, 0.56)) * 100)}% ${Math.round(Math.max(0.52, Math.min(l, 0.66)) * 100)}%)`;
}
function toHex(css: string): string {
  if (css.startsWith('#')) return css;
  const m = /hsl\((\d+) (\d+)% (\d+)%\)/.exec(css); if (!m) return '#6E6E6B';
  const h = +m[1]! / 360, s = +m[2]! / 100, l = +m[3]! / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return '#' + [h + 1 / 3, h, h - 1 / 3].map((t) => Math.round(f(t) * 255).toString(16).padStart(2, '0')).join('');
}

export function buildUniverse(g: GraphResponse) {
  const nodes: UNode[] = []; const byId = new Map<string, UNode>();
  const push = (u: UNode) => { nodes.push(u); byId.set(u.id, u); };
  const partOf = new Map<string, string>();
  for (const e of g.edges) if (e.type === 'part_of') partOf.set(e.source, e.target);
  const projects = g.nodes.filter((n) => n.type === 'project').sort((a, b) => b.size - a.size || a.id.localeCompare(b.id));
  const np = Math.max(1, projects.length);
  projects.forEach((p, pi) => {
    const color = p.colorHex ? accentOf(p.colorHex) : PALETTE[pi % PALETTE.length]!; void calm;
    const dir = norm(fib(pi, np));
    const kids = g.nodes.filter((n) => n.type === 'task' && (partOf.get(n.id) ?? n.projectId) === p.id);
    push({ id: p.id, kind: 'hub', node: p, p: [dir[0] * R * 0.9, dir[1] * R * 0.9, dir[2] * R * 0.9], r: 4.5 + 4 * c01(p.size), color, hubId: null, v: null });
    // 프로젝트 방향 둘레의 구면 영역(캡)에 과제를 흩는다
    const up: V3 = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const t1 = norm(cross(dir, up)), t2 = cross(dir, t1);
    const spread = Math.min(0.75, 0.22 + 0.055 * Math.sqrt(kids.length) * (projects.length > 6 ? 0.8 : 1.1));
    const rnd = rng(hash(p.id));
    kids.forEach((t, k) => {
      const quick = t.kind === 'quick_question';
      const a = Math.sqrt((k + 0.5) / kids.length) * spread * (0.85 + rnd() * 0.3); const th = k * 2.39996 + rnd() * 0.5;
      const d = norm([dir[0] + (t1[0] * Math.cos(th) + t2[0] * Math.sin(th)) * a, dir[1] + (t1[1] * Math.cos(th) + t2[1] * Math.sin(th)) * a, dir[2] + (t1[2] * Math.cos(th) + t2[2] * Math.sin(th)) * a]);
      const rr = R * (quick ? 1.04 + rnd() * 0.08 : 0.93 + rnd() * 0.12);
      push({ id: t.id, kind: quick ? 'quick' : 'task', node: t, p: [d[0] * rr, d[1] * rr, d[2] * rr], r: quick ? 1.2 : 1.8 + 2.6 * c01(t.size), color, hubId: p.id, v: visualOf(t.statusVisual) });
    });
  });
  // 프로젝트 없는 과제: 회색 대신 이어진 과제의 프로젝트 색을 빌리고, 없으면 첫 주제별 팔레트 색 (같은 주제를 가진 과제끼리 같은 색)
  const ornd = rng(7);
  const typeOf = new Map(g.nodes.map((n) => [n.id, n.type] as const));
  for (const t of g.nodes.filter((n) => n.type === 'task' && !byId.has(n.id))) {
    const d = norm([ornd() - 0.5, ornd() - 0.5, ornd() - 0.5]); const quick = t.kind === 'quick_question';
    let color: string | null = null; let topic: string | null = null;
    for (const e of g.edges) {
      if (e.source !== t.id && e.target !== t.id) continue;
      const o = e.source === t.id ? e.target : e.source; const on = byId.get(o);
      if (on?.hubId && e.type !== 'same_task_candidate') { color = mix(on.color, G.t1, 0.12); break; }
      if (!topic && typeOf.get(o) === 'topic') topic = o;
    }
    color ??= toHex(mix(PALETTE[hash(topic ?? t.id) % PALETTE.length]!, G.t1, 0.08));
    push({ id: t.id, kind: quick ? 'quick' : 'task', node: t, p: [d[0] * R, d[1] * R, d[2] * R], r: quick ? 1.2 : 1.8 + 2.6 * c01(t.size), color, hubId: null, v: visualOf(t.statusVisual) });
  }
  // 주제·기타: 이어진 노드 방향의 안쪽 구 (R*0.62)
  for (const n of g.nodes) {
    if (byId.has(n.id)) continue;
    const linked = g.edges.filter((e) => e.source === n.id || e.target === n.id).map((e) => byId.get(e.source === n.id ? e.target : e.source)).filter((x): x is UNode => !!x);
    const r0 = rng(hash(n.id));
    const m: V3 = linked.length ? linked.reduce((a, s) => [a[0] + s.p[0], a[1] + s.p[1], a[2] + s.p[2]] as V3, [0, 0, 0] as V3) : [r0() - 0.5, r0() - 0.5, r0() - 0.5];
    const d = norm([m[0] + (r0() - 0.5) * 40, m[1] + (r0() - 0.5) * 40, m[2] + (r0() - 0.5) * 40]); const rr = R * (0.6 + r0() * 0.1);
    // 주제 색 = 이어진 노드 색을 크림색 쪽으로 옅게 (회색 고리 대신 옅은 물감 점)
    const tint = linked[0]?.color ?? PALETTE[hash(n.id) % PALETTE.length]!;
    push({ id: n.id, kind: 'topic', node: n, p: [d[0] * rr, d[1] * rr, d[2] * rr], r: 1.4, color: mix(tint, G.t1, 0.35), hubId: null, v: null });
  }
  // 먼 별 (고정 시드, 드문드문)
  const srnd = rng(42); const stars: Array<[number, number, number, number]> = [];
  for (let i = 0; i < 160; i++) { const d = norm([srnd() - 0.5, srnd() - 0.5, srnd() - 0.5]); stars.push([d[0], d[1], d[2], 0.25 + srnd() * 0.5]); }
  // 관계선 + 세기(0..1). 대응 규칙:
  //  - 종류 기본값: part_of(과제→프로젝트) .45 · related_to/follow_up 등 .40 · 주제 연결 .30 · same_task_candidate .22
  //  - weight(1..): +0.35 × min(1, (weight-1)/4)          (엔진이 주는 굵기 힌트 = 근거·공유 대화 수)
  //  - confidence: × (0.55 + 0.45 × confidence)  (없으면 ×1)
  //  - 과제 크기(대화량, part_of만): +0.2 × size
  //  - 상태: 제안(suggested) ×0.45 · 끝난 관계(endedAt) ×0.5 · 완료 과제 ×0.55 · 간단한 질문 ×0.35
  const links: ULink[] = [];
  const hasPartOf = new Set<string>();
  for (const e of g.edges) {
    const A = byId.get(e.source), B = byId.get(e.target); if (!A || !B) continue;
    const topic = A.kind === 'topic' || B.kind === 'topic';
    let base = e.type === 'part_of' ? 0.45 : e.type === 'same_task_candidate' ? 0.22 : topic ? 0.3 : 0.4;
    base += 0.35 * Math.min(1, Math.max(0, ((e.weight ?? 1) - 1) / 4));
    if (e.confidence != null) base *= 0.55 + 0.45 * c01(e.confidence);
    if (e.status === 'suggested') base *= 0.45;
    if (e.endedAt) base *= 0.5;
    const task = A.kind === 'task' || A.kind === 'quick' ? A : B.kind === 'task' || B.kind === 'quick' ? B : null;
    if (e.type === 'part_of' && task) { base += 0.2 * c01(task.node.size); hasPartOf.add(task.id); }
    if (task?.v === 'done') base *= 0.55;
    if (task?.kind === 'quick') base *= 0.35;
    const src = A.kind === 'hub' ? A : B.kind === 'hub' ? B : A;
    links.push({ a: e.type === 'part_of' ? B.id : A.id, b: e.type === 'part_of' ? A.id : B.id, s: c01(base), color: src.color, dashed: e.type === 'same_task_candidate' || (A.kind === 'hub' && B.kind === 'hub'), phase: (hash(e.id) % 1000) / 1000 });
  }
  // part_of 간선이 없고 projectId로만 묶인 과제는 허브와 기본 세기로 잇는다
  for (const n of nodes) if (n.hubId && !hasPartOf.has(n.id)) {
    const s0 = c01((0.45 + 0.2 * c01(n.node.size)) * (n.v === 'done' ? 0.55 : 1) * (n.kind === 'quick' ? 0.35 : 1));
    links.push({ a: n.hubId, b: n.id, s: s0, color: n.color, dashed: false, phase: (hash(n.id) % 1000) / 1000 });
  }
  return { nodes, byId, edges: g.edges as GraphEdge[], links, stars };
}

export const UniverseView = forwardRef<GraphHandle, Props>(function UniverseView(
  { data, selectedId, hoverId: extHover = null, onSelect, onOpen, rotateOnDrag = true, autoRotate = true, ariaLabel }, ref,
) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const uni = useMemo(() => buildUniverse(data), [data]);
  const [hover, setHover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; n: UNode } | null>(null);
  // 카메라 상태는 ref (매 프레임 리렌더 없이)
  const st = useRef({ yaw: -0.4, pitch: TILT, zoom: 1, panX: 0, panY: 0, speed: 0, lastInteract: -1e9, dirty: true, W: 0, H: 0, dpr: 1 });
  const drag = useRef<{ x: number; y: number; moved: boolean; pan: boolean; yaw: number; pitch: number; panX: number; panY: number; id: string | null } | null>(null);
  const proj = useRef<Proj[]>([]);
  const anim = useRef<{ from: { yaw: number; pitch: number; zoom: number; panX: number; panY: number }; to: Partial<{ yaw: number; pitch: number; zoom: number; panX: number; panY: number }>; t0: number; ms: number } | null>(null);
  const live = useRef({ selectedId, hoverId: hover ?? extHover, autoRotate, uni });
  live.current = { selectedId, hoverId: hover ?? extHover, autoRotate, uni };
  useEffect(() => { st.current.dirty = true; }, [selectedId, hover, extHover, uni]);
  const reduced = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const poke = () => { st.current.lastInteract = performance.now(); st.current.dirty = true; };

  // 크기 + 픽셀 비율 (최대 2)
  useEffect(() => {
    const el = wrap.current, cv = canvas.current; if (!el || !cv) return;
    const ro = new ResizeObserver(([e]) => {
      if (!e) return; const s = st.current; s.W = Math.round(e.contentRect.width); s.H = Math.round(e.contentRect.height); s.dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = s.W * s.dpr; cv.height = s.H * s.dpr; cv.style.width = `${s.W}px`; cv.style.height = `${s.H}px`; s.dirty = true;
    });
    ro.observe(el); return () => ro.disconnect();
  }, []);

  // 그리기 루프
  useEffect(() => {
    const cv = canvas.current; if (!cv) return; const ctx = cv.getContext('2d'); if (!ctx) return;
    let raf = 0; let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(64, now - last); last = now; const s = st.current; const L = live.current;
      if (anim.current) {
        const a = anim.current; const p = Math.min(1, (now - a.t0) / a.ms); const e = 1 - Math.pow(1 - p, 3);
        for (const k of ['yaw', 'pitch', 'zoom', 'panX', 'panY'] as const) { const t = a.to[k]; if (t !== undefined) s[k] = a.from[k] + (t - a.from[k]) * e; }
        if (p >= 1) anim.current = null; s.dirty = true;
      }
      const idle = !drag.current && !L.hoverId && now - s.lastInteract > IDLE_MS;
      const want = L.autoRotate && !reduced && idle ? 1 : 0;
      s.speed += (want - s.speed) * Math.min(1, dt / (want ? 1400 : 180)); // 부드럽게 다시 출발, 빠르게 멈춤
      if (s.speed > 0.001) { s.yaw += s.speed * dt * (Math.PI * 2 / TURN_MS); s.dirty = true; }
      if (!s.dirty || !s.W) return;
      s.dirty = !reduced; // 빛 흐름이 있으니 계속 그림 (줄이기 설정이면 정지 화면)
      draw(ctx, s, L.uni, L.selectedId, L.hoverId, now);
    };
    const start = () => { cancelAnimationFrame(raf); last = performance.now(); st.current.dirty = true; raf = requestAnimationFrame(frame); };
    const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else start(); };
    document.addEventListener('visibilitychange', onVis);
    if (!document.hidden) start();
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis); };
  }, [reduced]);

  function draw(ctx: CanvasRenderingContext2D, s: typeof st.current, u: typeof uni, selId: string | null, hovId: string | null, now: number) {
    const { W, H, dpr } = s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    const cx = W / 2 - 20 + s.panX, cy = H / 2 + 6 + s.panY;
    const scale = (Math.min(W, H - 160) / (2 * R * 1.25)) * s.zoom;
    const cyw = Math.cos(s.yaw), syw = Math.sin(s.yaw), cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
    const rot = (p: V3) => { const x = p[0] * cyw - p[2] * syw; let z = p[0] * syw + p[2] * cyw; const y = p[1] * cp - z * sp; z = p[1] * sp + z * cp; return [x, y, z] as const; };
    // 별: 아주 멀리, 회전의 1/4만 따라감
    const sy2 = Math.sin(s.yaw * 0.25), cy2 = Math.cos(s.yaw * 0.25);
    for (const [x0, y0, z0, b] of u.stars) {
      const x = x0 * cy2 - z0 * sy2, z = x0 * sy2 + z0 * cy2; const y = y0 * cp - z * sp;
      const px = W / 2 + x * Math.max(W, H) * 0.75, py = H / 2 + y * Math.max(W, H) * 0.75;
      if (px < 0 || py < 0 || px > W || py > H) continue;
      ctx.fillStyle = `rgba(237,237,235,${(b * 0.22).toFixed(3)})`; ctx.fillRect(px, py, 1.1, 1.1);
    }
    const P: Proj[] = u.nodes.map((n) => { const [x, y, z] = rot(n.p); const k = FOCAL / (DIST + z); const d = c01((z + R) / (2 * R)); return { n, x: cx + x * k * scale * (DIST / FOCAL), y: cy + y * k * scale * (DIST / FOCAL), z, s: k, sr: Math.max(0.8, n.r * k * (DIST / FOCAL) * Math.sqrt(s.zoom)), d }; });
    proj.current = P;
    const by = new Map(P.map((p) => [p.n.id, p]));
    // 깊이: 먼 쪽은 같은 색을 조금 어둡게(최대 30%)만. 배경색으로 섞어 회색처럼 바래게 하지 않는다.
    const shade = (c: string, d: number) => mix(c, DARK, 0.02 + d * 0.5); // 먼 쪽일수록 어둡게
    // 호버 = 이웃만 밝히고 나머지는 흐리게 (Obsidian)
    const nb = hovId ? new Set<string>([hovId]) : null;
    if (nb) for (const l of u.links) { if (l.a === hovId) nb.add(l.b); else if (l.b === hovId) nb.add(l.a); }
    const selHub = selId ? (u.byId.get(selId)?.kind === 'hub' ? selId : u.byId.get(selId)?.hubId ?? null) : null;
    // 연결선: 얇고 은은하게, 세기만큼 진하게(불투명도 0.07~0.35). 그 위로 부드러운 빛 줄기가 흐른다.
    //  세기 ↑ = 더 밝고 길고 많고 빠르게 (1~4개, 11초~3.5초). 약한 선은 아주 옅게. 블러·글로·블룸 없음 — 끝이 옅어지는 짧은 선분과 작은 점뿐.
    for (const l of u.links) {
      const A = by.get(l.a), B = by.get(l.b); if (!A || !B) continue;
      const hv = hovId === l.a || hovId === l.b; const d = (A.d + B.d) / 2; const near = 1 - d * 0.35;
      const sel = selHub !== null && (l.a === selHub || l.b === selHub);
      // 화면용 세기: 실제 데이터의 세기는 0.04~0.65에 몰려 있어 대비를 넓힌다 (약한 주제 연결 ≈0~0.2, 보통 ≈0.4, 프로젝트 소속·근거 많은 관계 ≈1)
      const ls = c01((l.s - 0.06) / 0.52);
      const dim = nb !== null && !hv;
      ctx.lineWidth = 0.5 + 0.5 * ls;
      ctx.strokeStyle = hv || sel ? l.color : shade(mix(G.lineStrong, l.color, 0.18), d * 0.5);
      ctx.globalAlpha = hv ? 0.5 : dim ? 0.05 : sel ? 0.5 : (0.16 + 0.44 * ls) * near;
      if (l.dashed) ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); ctx.setLineDash([]);
      if (reduced || dim) continue;
      const len = Math.hypot(B.x - A.x, B.y - A.y); if (len < 6) continue;
      const count = 1 + Math.round(ls * 3);                     // 1~4개
      const period = 11000 - 7500 * ls;                          // 11초(약함) ~ 3.5초(강함)
      // 약한 관계는 옅게(≈0.12), 강한 관계는 또렷하게(≈0.95)
      const alpha = Math.min(1, (0.1 + 0.88 * Math.pow(ls, 1.3)) * near * (hv || sel ? 1.35 : 1));
      if (alpha < 0.04) continue;
      const pc = mix(l.color, G.t1, 0.3);                        // 액센트를 띤 따뜻한 빛 (흰 형광 아님)
      const scaleK = Math.min(1.35, (A.s + B.s) / 2 * 1.1);
      const pr = (1 + 1.8 * ls) * scaleK;                      // 머리 점 반지름
      const tail = Math.min(len * 0.45, (10 + 34 * ls) * scaleK); // 꼬리 길이 (강할수록 길게)
      const ux = (B.x - A.x) / len, uy = (B.y - A.y) / len;
      ctx.lineCap = 'round';
      for (let i = 0; i < count; i++) {
        const t = (now / period + l.phase + i / count) % 1;
        const x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t;
        const fade = Math.sin(t * Math.PI);                      // 양 끝에서 부드럽게 나타나고 사라짐
        const a = alpha * fade; if (a < 0.03) continue;
        const tl = Math.min(tail, len * t);                      // 출발점 뒤로는 꼬리가 나가지 않게
        if (tl > 2) { // 꼬리 = 옅어지는 짧은 선분 4개 (그라데이션·블러 없음)
          ctx.strokeStyle = pc; ctx.lineWidth = pr * 1.1;
          for (let k = 0; k < 4; k++) {
            ctx.globalAlpha = a * 0.6 * (1 - k / 4);
            ctx.beginPath(); ctx.moveTo(x - ux * tl * (k / 4), y - uy * tl * (k / 4)); ctx.lineTo(x - ux * tl * ((k + 1) / 4), y - uy * tl * ((k + 1) / 4)); ctx.stroke();
          }
        }
        ctx.globalAlpha = a; ctx.fillStyle = pc;
        ctx.beginPath(); ctx.arc(x, y, pr, 0, 6.2832); ctx.fill();
      }
      ctx.lineCap = 'butt';
    }
    ctx.globalAlpha = 1;
    // 노드: 먼 것부터 (부드러운 음영 구). 먼 노드 = 원근으로 작아지고 살짝 어두워질 뿐, 색은 그대로.
    // 완료 과제 = 회색 아님: 같은 색, 조금 작게(×0.82) + 음영 대비를 낮춰 차분하게.
    const order = [...P].sort((a, b) => b.z - a.z);
    for (const p of order) {
      const { n, x, y, d } = p; const isSel = n.id === selId, isHov = n.id === hovId;
      const done = n.v === 'done';
      const sr = p.sr * (done ? 0.82 : 1) * (1.06 - d * 0.12);
      const col = shade(done ? mix(n.color, G.t3, 0.25) : n.color, d);
      const ndim = nb !== null && !nb.has(n.id);
      ctx.globalAlpha = (n.kind === 'quick' ? 0.75 : n.kind === 'topic' ? 0.7 : 1) * (1 - d * 0.15) * (ndim ? 0.22 : 1);
      if (n.kind === 'topic' || sr < 3) {
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, sr, 0, 6.2832); ctx.fill();
        if (isHov || isSel) { ctx.strokeStyle = G.t1; ctx.lineWidth = 1; ctx.stroke(); }
      } else {
        // basement식 '구운 조명': 그림자 색 원 위에 왼쪽 위로 비킨 밝은 원 → 오른쪽 아래 그늘 초승달 (그라데이션·글로우 없음)
        ctx.save(); ctx.beginPath(); ctx.arc(x, y, sr, 0, 6.2832); ctx.clip();
        ctx.fillStyle = mix(col, DARK, done ? 0.38 : 0.5); ctx.fillRect(x - sr, y - sr, sr * 2, sr * 2);
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x - sr * 0.16, y - sr * 0.18, sr * 0.9, 0, 6.2832); ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1 - d * 0.3;
      if (n.kind === 'task' && (n.v === 'run' || n.v === 'stall') && sr >= 2) { ctx.globalAlpha *= 0.6;
        ctx.strokeStyle = n.v === 'run' ? RUN : n.v === 'stall' ? STALL : STALL2; ctx.lineWidth = 1;
        if (n.v !== 'run') ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.arc(x, y, sr + 2.5, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]);
      }
      if (isSel || isHov) { ctx.globalAlpha = isSel ? 0.95 : 0.6; ctx.strokeStyle = G.t1; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, sr + 5, 0, 6.2832); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    // 라벨: 프로젝트 이름 + 선택/호버. 겹치지 않게 놓는다 — 우선순위(선택 > 호버 > 가까운 큰 프로젝트) 순으로
    //  오른쪽 → 왼쪽 → 위 → 아래 자리를 시험하고, 다 겹치면 그 라벨은 생략(선택·호버는 항상 표시).
    //  배경은 글로우 대신 캔버스색 작은 판(불투명도 0.78, 모서리 3px)만.
    ctx.textBaseline = 'middle';
    const cand = order.filter((p) => p.n.kind === 'hub' || p.n.id === selId || p.n.id === hovId)
      .map((p) => ({ p, pri: p.n.id === selId ? 0 : p.n.id === hovId ? 1 : 2 + p.d * 2 - c01(p.n.node.size) }))
      .sort((x, y) => x.pri - y.pri);
    const placed: Array<[number, number, number, number]> = [];
    const hit = (r: [number, number, number, number]) => placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
    for (const { p, pri } of cand) {
      const { n } = p; const strong = pri < 2;
      const fs = n.kind === 'hub' ? 12 : 11.5;
      ctx.font = `${n.kind === 'hub' ? 500 : 500} ${fs}px Pretendard, system-ui, sans-serif`;
      const raw = n.kind === 'topic' ? `#${n.node.label}` : n.node.label;
      const t = raw.length > 22 && !strong ? `${raw.slice(0, 21)}…` : raw;
      const w = ctx.measureText(t).width, h = fs + 6, gap = p.sr + 6;
      const spots: Array<[number, number]> = [[p.x + gap, p.y], [p.x - gap - w, p.y], [p.x - w / 2, p.y - gap - h / 2], [p.x - w / 2, p.y + gap + h / 2]];
      let at: [number, number] | null = null;
      for (const [x, y] of spots) { const r: [number, number, number, number] = [x - 5, y - h / 2, x + w + 5, y + h / 2]; if (r[0] < 4 || r[2] > s.W - 4 || r[1] < 4 || r[3] > s.H - 4) continue; if (!hit(r)) { at = [x, y]; placed.push(r); break; } }
      if (!at) { if (!strong) continue; at = spots[0]!; }
      const fade = (strong ? 1 : 0.92 - p.d * 0.45) * (nb && !nb.has(n.id) ? 0.25 : 1);
      ctx.globalAlpha = 0.78 * fade; ctx.fillStyle = BG;
      ctx.beginPath(); ctx.roundRect(at[0] - 5, at[1] - h / 2, w + 10, h, 3); ctx.fill();
      if (strong) { ctx.globalAlpha = 0.9; ctx.strokeStyle = G.line; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.globalAlpha = fade;
      ctx.fillStyle = n.kind === 'hub' ? (strong ? G.t1 : mix(n.color, G.t1, 0.62)) : G.t1; ctx.fillText(t, at[0], at[1] + 0.5);
    }
    ctx.globalAlpha = 1;
  }

  const pick = (mx: number, my: number): Proj | null => {
    let best: Proj | null = null; let bz = Infinity;
    for (const p of proj.current) { const r = Math.max(6, p.sr + 3); if ((p.x - mx) ** 2 + (p.y - my) ** 2 <= r * r && p.z < bz) { best = p; bz = p.z; } }
    return best;
  };
  const local = (e: { clientX: number; clientY: number }) => { const r = canvas.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };

  const animateTo = useCallback((to: Partial<{ yaw: number; pitch: number; zoom: number; panX: number; panY: number }>, ms = 600) => {
    const s = st.current; anim.current = { from: { yaw: s.yaw, pitch: s.pitch, zoom: s.zoom, panX: s.panX, panY: s.panY }, to, t0: performance.now(), ms }; poke();
  }, []);
  const focus = useCallback((id: string) => {
    const n = live.current.uni.byId.get(id); if (!n) return;
    const s = st.current; let yaw = Math.atan2(n.p[0], n.p[2]) + Math.PI; // 노드를 앞쪽으로
    while (yaw - s.yaw > Math.PI) yaw -= 2 * Math.PI; while (s.yaw - yaw > Math.PI) yaw += 2 * Math.PI;
    animateTo({ yaw, pitch: TILT, zoom: Math.max(s.zoom, 1.25), panX: 0, panY: 0 }, 800);
  }, [animateTo]);
  const zoomBy = useCallback((f: number) => { const s = st.current; s.zoom = Math.max(0.5, Math.min(4, s.zoom * f)); poke(); }, []);
  useImperativeHandle(ref, () => ({ zoomBy, reset: () => animateTo({ pitch: TILT, zoom: 1, panX: 0, panY: 0 }), focus }), [zoomBy, animateTo, focus]);

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0015)); };
    el.addEventListener('wheel', onWheel, { passive: false }); return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const [mx, my] = local(e); const s = st.current; anim.current = null;
    drag.current = { x: e.clientX, y: e.clientY, moved: false, pan: e.button === 2 || e.shiftKey || !rotateOnDrag, yaw: s.yaw, pitch: s.pitch, panX: s.panX, panY: s.panY, id: pick(mx, my)?.n.id ?? null };
    poke();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current; const s = st.current;
    if (!d) {
      const [mx, my] = local(e); const p = pick(mx, my); const id = p?.n.id ?? null;
      if (id !== hover) setHover(id);
      setTip(p ? { x: p.x, y: p.y, n: p.n } : null);
      if (id) poke();
      return;
    }
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true; if (hover) { setHover(null); setTip(null); }
    if (d.pan) { s.panX = d.panX + dx; s.panY = d.panY + dy; } else { s.yaw = d.yaw + dx * 0.006; s.pitch = Math.max(-1.2, Math.min(1.2, d.pitch + dy * 0.005)); }
    poke();
  };
  const onPointerUp = () => {
    const d = drag.current; drag.current = null; poke(); if (!d) return;
    if (!d.moved && d.id) {
      const n = uni.byId.get(d.id); if (!n) return;
      onSelect?.(n.id, n.node);
      if (n.kind === 'task' || n.kind === 'quick') onOpen?.(n.node); // 과제 → 기존 상세 경로
    }
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const s = st.current;
    if (e.key === '+' || e.key === '=') zoomBy(1.2);
    else if (e.key === '-') zoomBy(1 / 1.2);
    else if (e.key === '0') animateTo({ pitch: TILT, zoom: 1, panX: 0, panY: 0 });
    else if (e.key === 'ArrowLeft') { s.yaw -= 0.08; poke(); }
    else if (e.key === 'ArrowRight') { s.yaw += 0.08; poke(); }
    else if (e.key === 'ArrowUp') { s.pitch = Math.min(1.2, s.pitch + 0.06); poke(); }
    else if (e.key === 'ArrowDown') { s.pitch = Math.max(-1.2, s.pitch - 0.06); poke(); }
    else if (e.key === 'Enter' && selectedId) { const n = uni.byId.get(selectedId); if (n) onOpen?.(n.node); }
    else return;
    e.preventDefault();
  };

  const W = st.current.W;
  return (
    <div ref={wrap} className="gview universe" tabIndex={0} role="application" aria-label={ariaLabel ?? tt("과제 그래프 (3D)")} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      <canvas ref={canvas} style={{ display: 'block', cursor: hover ? 'pointer' : 'grab' }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerLeave={() => { if (!drag.current) { setHover(null); setTip(null); } }} onDoubleClick={(e) => { const [mx, my] = local(e); const p = pick(mx, my); if (p) focus(p.n.id); }} />
      {tip && !drag.current && (
        <div className="gtip" style={{ left: Math.min(W - 260, tip.x + 14), top: Math.max(4, tip.y - 14) }}>
          {tip.n.node.tooltip ?? tip.n.node.label}
          <small>{tip.n.kind === 'task' || tip.n.kind === 'quick' ? tt("눌러서 과제 열기") : tip.n.kind === 'hub' ? tt("눌러서 선택 · 두 번 눌러 앞으로") : tt("눌러서 주제 보기")}</small>
        </div>
      )}
    </div>
  );
});
