import { tt, ttf } from '../i18n';
// 온톨로지 그래프 SVG 렌더러 — 홈 그래프(GraphView)와 같은 카메라·구 표현에, 객체 원판과 관계 색 선을 더했다.
import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { clearTextCache } from '../graph/engine';
import { mix } from '../lib/format';
import { buildScene, DEFAULT_CAMERA, fitScale, placeEdgeLabels, placeLabels, project, trimmedCurve, type Box, type Camera, type EdgeLabelWant, type PNode, type Want } from './layout';
import { LINK_META, SUGGEST_DASH, TYPE_META, type OData, type OLink } from './model';
import { TYPE_ICON } from './Glyph';

export interface OGraphHandle { zoomBy: (f: number) => void; reset: () => void; focus: (id: string) => void; fitTo: (ids: string[]) => void }
export interface Focus { nodes: Set<string>; links: Set<string>; strong?: Set<string>; kind: 'hood' | 'path' | 'query' }
interface Props {
  data: OData;                 // 배치용 전체 데이터 (필터와 무관)
  visible: Set<string>;        // 보이는 객체
  links: OLink[];              // 보이는 관계
  selectedId: string | null;
  pathTo: string | null;
  focus: Focus | null;
  hoverId?: string | null;
  onSelect: (id: string, shift: boolean) => void;
  onClear: () => void;
  rotateOnDrag?: boolean;
  autoRotate?: boolean;
  blocked?: Array<[number, number, number, number]>;
  box: (W: number, H: number) => Box;
  fitVisible?: Set<string>;    // 화면 맞춤 기준(선택으로 잠깐 보이는 이웃은 빼서 카메라가 튀지 않게)
}

const RUN = '#8FB59A';
const STALL: Record<string, string> = { stall: '#D08A66', stall2: '#D3B060' };
const CREAM = '#EDEDEB';

export const OntologyGraph = forwardRef<OGraphHandle, Props>(function OntologyGraph(
  { data, visible, links, selectedId, pathTo, focus, hoverId: extHover = null, onSelect, onClear, rotateOnDrag = true, autoRotate = false, blocked = [], box: boxFn, fitVisible }, ref,
) {
  const pfx = useId().replace(/[^a-zA-Z0-9]/g, '');
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ W: 0, H: 0 });
  const [cam, setCam] = useState<Camera>(DEFAULT_CAMERA);
  const camRef = useRef(cam); camRef.current = cam;
  const [hover, setHover] = useState<string | null>(null);
  const [fontTick, setFontTick] = useState(0);
  const drag = useRef<{ x: number; y: number; moved: boolean; mode: 'rotate' | 'pan'; id: string | null; shift: boolean; cam: Camera } | null>(null);
  const anim = useRef<number | null>(null);

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (e) setSize({ W: Math.round(e.contentRect.width), H: Math.round(e.contentRect.height) }); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  useEffect(() => { document.fonts?.ready.then(() => { clearTextCache(); setFontTick((t) => t + 1); }); }, []);

  const scene = useMemo(() => buildScene(data), [data]);
  const { W, H } = size;
  const box = useMemo(() => boxFn(W, H), [boxFn, W, H]);
  const fit = useMemo(() => (W && H ? fitScale(scene, box, fitVisible ?? visible) : { k: 1, ox: 0, oy: 0 }), [scene, box, W, H, fitVisible ?? visible]);
  const hoodKey = focus?.kind === 'hood' && selectedId ? `${selectedId}:${[...focus.nodes].join(',')}` : '';
  const pnodes = useMemo(() => {
    if (!W || !H) return [];
    const out = project(scene, visible, cam, box, fit, drag.current?.moved ? 20 : 50);
    // 이웃 보기: 고른 객체 둘레의 이웃을 살짝 밀어내 라벨이 숨 쉴 자리를 만든다 (어안 렌즈처럼)
    if (hoodKey && selectedId && focus) {
      const c = out.find((n) => n.id === selectedId);
      const R = 120 * Math.min(1.6, Math.max(0.8, cam.zoom));
      if (c) for (const n of out) {
        if (n === c || !focus.nodes.has(n.id) || n.o.type === 'project') continue;
        const dx = n.x - c.x, dy = n.y - c.y, d = Math.hypot(dx, dy) || 0.01;
        if (d < R) { const nd = d + (R - d) * 0.7; n.x = c.x + (dx / d) * nd; n.y = c.y + (dy / d) * nd; }
      }
      const fs = out.filter((n) => focus.nodes.has(n.id));
      for (let it = 0; it < 30; it++) {
        let moved = false;
        for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
          const a = fs[i]!, b = fs[j]!; const m = a.sr + b.sr + 26; const dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 0.01;
          if (d >= m) continue;
          const fa = a.id === selectedId || a.o.type === 'project' ? 0 : 1, fb = b.id === selectedId || b.o.type === 'project' ? 0 : 1; if (!fa && !fb) continue;
          const pu = (m - d) / (fa + fb); a.x -= (dx / d) * pu * fa; a.y -= (dy / d) * pu * fa; b.x += (dx / d) * pu * fb; b.y += (dy / d) * pu * fb; moved = true;
        }
        if (!moved) break;
      }
    }
    return out;
  }, [scene, visible, cam, box, fit, W, H, hoodKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(pnodes.map((n) => [n.id, n])), [pnodes]);
  const hoverId = hover ?? extHover;

  useEffect(() => {
    if (!autoRotate) return;
    let raf = 0;
    const tick = () => { if (!drag.current) setCam((c) => ({ ...c, yaw: c.yaw + 0.0024 })); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [autoRotate]);

  const animateTo = useCallback((target: Partial<Camera>, ms = 380) => {
    if (anim.current) cancelAnimationFrame(anim.current);
    const from = camRef.current; const t0 = performance.now();
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const step = (t: number) => {
      const p = reduce ? 1 : Math.min(1, (t - t0) / ms); const e = 1 - Math.pow(1 - p, 3);
      const lerp = (a: number, b: number | undefined) => (b === undefined ? a : a + (b - a) * e);
      setCam({ yaw: lerp(from.yaw, target.yaw), pitch: lerp(from.pitch, target.pitch), zoom: lerp(from.zoom, target.zoom), panX: lerp(from.panX, target.panX), panY: lerp(from.panY, target.panY) });
      anim.current = p < 1 ? requestAnimationFrame(step) : null;
    };
    anim.current = requestAnimationFrame(step);
  }, []);
  const zoomAt = useCallback((f: number, sx?: number, sy?: number) => {
    setCam((c) => {
      const zoom = Math.max(0.45, Math.min(4, c.zoom * f)); const ff = zoom / c.zoom;
      const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
      const px = sx ?? cx + c.panX, py = sy ?? cy + c.panY;
      return { ...c, zoom, panX: px - cx - (px - cx - c.panX) * ff, panY: py - cy - (py - cy - c.panY) * ff };
    });
  }, [box]);
  const focusOn = useCallback((id: string) => {
    const n = byId.get(id); if (!n) return;
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    const c = camRef.current; const zoom = Math.min(2.4, Math.max(c.zoom, 1.3)); const f = zoom / c.zoom;
    animateTo({ zoom, panX: -(n.x - cx - c.panX) * f, panY: -(n.y - cy - c.panY) * f });
  }, [byId, box, animateTo]);
  // 고른 것들(이웃·경로·질문 결과)이 화면에 꽉 차게 카메라를 옮긴다. 아직 그리기 전이면 그린 뒤에.
  const pendingFit = useRef<string[] | null>(null);
  const fitTo = useCallback((ids: string[]) => {
    const ns = ids.map((id) => byId.get(id)).filter((n): n is PNode => !!n);
    if (!ns.length) { pendingFit.current = ids; return; }
    pendingFit.current = null;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const n of ns) { x0 = Math.min(x0, n.x - n.sr - 60); x1 = Math.max(x1, n.x + n.sr + 90); y0 = Math.min(y0, n.y - n.sr - 30); y1 = Math.max(y1, n.y + n.sr + 30); }
    const c = camRef.current; const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    const want = Math.min((box.x1 - box.x0) / Math.max(1, x1 - x0), (box.y1 - box.y0) / Math.max(1, y1 - y0));
    const zoom = Math.max(0.9, Math.min(3.2, c.zoom * want)); const f = zoom / c.zoom;
    const bx = (x0 + x1) / 2, by = (y0 + y1) / 2;
    animateTo({ zoom, panX: -(bx - cx - c.panX) * f, panY: -(by - cy - c.panY) * f }, 460);
  }, [byId, box, animateTo]);
  useEffect(() => { if (pendingFit.current && pnodes.length) fitTo(pendingFit.current); }, [pnodes.length, fitTo]);
  useImperativeHandle(ref, () => ({ zoomBy: (f) => zoomAt(f), reset: () => animateTo(DEFAULT_CAMERA), focus: focusOn, fitTo }), [zoomAt, animateTo, focusOn, fitTo]);

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); };
    el.addEventListener('wheel', onWheel, { passive: false }); return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const nodeAt = (t: EventTarget | null) => (t as Element | null)?.closest?.('[data-id]')?.getAttribute('data-id') ?? null;
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const id = nodeAt(e.target);
    const pan = e.button === 2 || (e.shiftKey && !id) || !rotateOnDrag;
    drag.current = { x: e.clientX, y: e.clientY, moved: false, mode: pan ? 'pan' : 'rotate', id, shift: e.shiftKey, cam: camRef.current };
    if (anim.current) { cancelAnimationFrame(anim.current); anim.current = null; }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) { const id = nodeAt(e.target); if (id !== hover) setHover(id); return; }
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true; if (hover) setHover(null);
    if (d.mode === 'rotate') setCam({ ...d.cam, yaw: d.cam.yaw + dx * 0.006, pitch: Math.max(-0.2, Math.min(1.25, d.cam.pitch + dy * 0.004)) });
    else setCam({ ...d.cam, panX: d.cam.panX + dx, panY: d.cam.panY + dy });
  };
  const onPointerUp = () => {
    const d = drag.current; drag.current = null; if (!d) return;
    if (!d.moved) { if (d.id) onSelect(d.id, d.shift); else onClear(); }
    if (d.moved) setCam((c) => ({ ...c }));
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    const id = nodeAt(e.target);
    if (!id) { animateTo({ ...DEFAULT_CAMERA, yaw: camRef.current.yaw, pitch: camRef.current.pitch }); return; }
    focusOn(id);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const c = camRef.current;
    if (e.key === '+' || e.key === '=') zoomAt(1.2);
    else if (e.key === '-') zoomAt(1 / 1.2);
    else if (e.key === '0') animateTo(DEFAULT_CAMERA);
    else if (e.key === 'ArrowLeft') setCam({ ...c, yaw: c.yaw - 0.08 });
    else if (e.key === 'ArrowRight') setCam({ ...c, yaw: c.yaw + 0.08 });
    else if (e.key === 'ArrowUp') setCam({ ...c, pitch: Math.min(1.25, c.pitch + 0.06) });
    else if (e.key === 'ArrowDown') setCam({ ...c, pitch: Math.max(-0.2, c.pitch - 0.06) });
    else return;
    e.preventDefault();
  };

  // ── 그리기 ──
  const inFocus = (id: string) => !focus || focus.nodes.has(id);
  const fade = (n: PNode) => 1 - n.dn * 0.5;
  const blur = (_n: PNode): string | undefined => undefined; // Graphite: 블러 없음 — 깊이는 명도·크기로

  const defs = useMemo(() => {
    const out: React.ReactNode[] = [];
    const cols = [...scene.projectColors, '#6E6E6B'];
    cols.forEach((c, i) => {
      const id = i === cols.length - 1 ? 'x' : String(i);
      out.push(<radialGradient key={`s${id}`} id={`${pfx}s${id}`} cx="36%" cy="30%" r="72%"><stop offset="0" stopColor={c} /><stop offset=".78" stopColor={c} /><stop offset=".78" stopColor={mix(c, '#070708', 0.62)} /><stop offset="1" stopColor={mix(c, '#070708', 0.62)} /></radialGradient>);
      const d = mix(c, '#6E6E6B', 0.72);
      out.push(<radialGradient key={`d${id}`} id={`${pfx}d${id}`} cx="36%" cy="30%" r="72%"><stop offset="0" stopColor={d} /><stop offset=".78" stopColor={d} /><stop offset=".78" stopColor={mix(d, '#070708', 0.6)} /><stop offset="1" stopColor={mix(d, '#070708', 0.6)} /></radialGradient>);
    });
    // 원판: 위에서 빛을 받은 얇은 판 (sheet2 바탕)
    out.push(<radialGradient key="disc" id={`${pfx}disc`} cx="40%" cy="28%" r="80%"><stop offset="0" stopColor="#222225" /><stop offset=".8" stopColor="#222225" /><stop offset=".8" stopColor="#131314" /><stop offset="1" stopColor="#131314" /></radialGradient>);
    for (const [k, m] of Object.entries(LINK_META)) if (m.arrow) out.push(<marker key={`a${k}`} id={`${pfx}a${k}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto"><path d="M1.5 1.5 8.5 5 1.5 8.5" fill="none" stroke={m.color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" /></marker>);
    out.push(<marker key="aw" id={`${pfx}aw`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path d="M1.5 1.5 8.5 5 1.5 8.5" fill="none" stroke={CREAM} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" /></marker>);
    return out;
  }, [scene, pfx]);
  const grad = (n: PNode, done: boolean) => `url(#${pfx}${done ? 'd' : 's'}${n.pi >= 0 ? n.pi : 'x'})`;

  // 같은 두 객체 사이 여러 관계는 휨을 달리
  const bends = useMemo(() => {
    const groups = new Map<string, OLink[]>();
    for (const l of links) { const k = [l.src, l.dst].sort().join('|'); (groups.get(k) ?? groups.set(k, []).get(k)!).push(l); }
    const out = new Map<string, number>();
    for (const g of groups.values()) g.forEach((l, i) => { const base = l.type === 'part_of' ? 0.06 : 0.12; const flip = l.src < l.dst ? 1 : -1; out.set(l.id, (g.length === 1 ? base : base + i * 0.16 - (g.length - 1) * 0.08) * flip); });
    return out;
  }, [links]);

  const edgeGeo = useMemo(() => {
    const m = new Map<string, ReturnType<typeof trimmedCurve>>();
    for (const l of links) {
      const A = byId.get(l.src), B = byId.get(l.dst); if (!A || !B) continue;
      m.set(l.id, trimmedCurve(A.x, A.y, A.sr + 2, B.x, B.y, B.sr + (LINK_META[l.type].arrow ? 4 : 2), bends.get(l.id) ?? 0.12));
    }
    return m;
  }, [links, byId, bends]);

  const labels = useMemo(() => {
    if (!pnodes.length) return { nodes: [], edges: [] };
    void fontTick;
    const pathEnds = new Set([selectedId, pathTo].filter(Boolean) as string[]);
    const large = data.objects.length > 300;
    const deg = new Map<string, number>(); for (const l of links) { deg.set(l.src, (deg.get(l.src) ?? 0) + 1); deg.set(l.dst, (deg.get(l.dst) ?? 0) + 1); }
    const dg = (id: string) => Math.min(0.9, (deg.get(id) ?? 0) / 30);
    const wanted = pnodes.flatMap((n): Want[] => {
      const o = n.o; const isSel = pathEnds.has(n.id); const isHover = n.id === hoverId; const f = inFocus(n.id);
      const dim = !!focus && !f;
      if (o.type === 'project') return [{ n, prio: isSel ? 0 : f && focus ? 0.8 : 1 + n.dn * 0.4 - dg(n.id), text: o.name, kind: 'project', sel: isSel, dim }];
      if (dim && !isHover) return [];
      const focused = !!focus && f;
      if (o.type === 'task') {
        const stalled = o.visual === 'stall' || o.visual === 'stall2';
        if (!(stalled || o.visual === 'run' || isSel || isHover || focused)) return [];
        return [{ n, prio: isSel ? 0.1 : isHover ? 0.2 : focused ? 1.5 - dg(n.id) : 3 + n.dn - dg(n.id), text: o.name, extra: stalled ? o.badge : null, extraColor: o.visual === 'stall' ? '#D08A66' : '#D3B060', kind: 'task', sel: isSel, dim: false }];
      }
      const show = isSel || isHover || focused || o.mentions >= 4 || (o.type === 'decision' && !large);
      if (!show) return [];
      return [{ n, prio: isSel ? 0.1 : isHover ? 0.2 : focused ? 1.6 : 4 - Math.min(1.5, o.mentions / 20) + n.dn, text: o.type === 'topic' ? `#${o.name}` : o.name, kind: o.type === 'topic' ? 'topic' : 'obj', sel: isSel, dim: false }];
    });
    // 흐리게 만든 객체는 라벨 자리를 막지 않는다
    const solid = focus ? pnodes.filter((n) => focus.nodes.has(n.id) || n.id === hoverId) : pnodes;
    const allBlocked: Array<[number, number, number, number]> = [...blocked, [W - 440, 0, W, 96]];
    // 많을 때 라벨 수 상한(화면 넓이 비례) — 나머지는 마우스를 올리거나 누르면
    const cap = focus ? 40 : Math.round(Math.max(12, Math.min(34, ((box.x1 - box.x0) * (box.y1 - box.y0)) / 22000)));
    const nodeLabels = placeLabels(solid, wanted, box, allBlocked, large ? cap : Infinity);
    // 관계 라벨: 초점(이웃·경로·질문)에 든 선, 아니면 마우스를 올린 객체의 선
    const ew: EdgeLabelWant[] = [];
    for (const l of links) {
      const g = edgeGeo.get(l.id); if (!g || g.len < 46) continue;
      const strong = focus?.strong?.has(l.id);
      const show = focus ? focus.links.has(l.id) && (focus.kind !== 'hood' || l.type !== 'part_of') : hoverId !== null && (l.src === hoverId || l.dst === hoverId);
      if (!show) continue;
      const m = LINK_META[l.type];
      ew.push({ id: l.id, text: m.label + (l.status === 'suggested' ? tt(" (제안)") : l.ended ? tt(" (끝남)") : ''), x: g.mid[0], y: g.mid[1], color: strong ? CREAM : mix(m.color, '#ffffff', 0.25), prio: strong ? 0 : l.status === 'suggested' ? 2 : 1 });
    }
    return { nodes: nodeLabels, edges: placeEdgeLabels(ew.sort((a, b) => a.prio - b.prio).slice(0, 26), solid, nodeLabels, allBlocked) };
  }, [pnodes, selectedId, pathTo, hoverId, box, focus, links, edgeGeo, blocked, fontTick, W, data]); // eslint-disable-line react-hooks/exhaustive-deps

  // 선
  const edgesEl: React.ReactNode[] = [];
  const order = [...links].sort((a, b) => rank(a) - rank(b));
  function rank(l: OLink) { if (focus?.strong?.has(l.id)) return 3; if (focus?.links.has(l.id)) return 2; if (hoverId && (l.src === hoverId || l.dst === hoverId)) return 2; return l.type === 'part_of' ? 0 : 1; }
  for (const l of order) {
    const A = byId.get(l.src), B = byId.get(l.dst), g = edgeGeo.get(l.id); if (!A || !B || !g) continue;
    const m = LINK_META[l.type];
    const strong = !!focus?.strong?.has(l.id);
    const inF = !focus || focus.links.has(l.id);
    const hv = hoverId !== null && (l.src === hoverId || l.dst === hoverId);
    const depth = 1 - ((A.dn + B.dn) / 2) * 0.45;
    let op = (l.type === 'part_of' ? 0.6 : 0.78) * depth;
    if (l.status === 'suggested') op = 0.42 * depth;
    if (l.ended) op = 0.3 * depth;
    if (focus && inF) op = l.status === 'suggested' ? 0.6 : l.ended ? 0.45 : 0.95;
    if (focus && !inF) op = 0.07;
    if (hv && (!focus || inF)) op = Math.max(op, l.status === 'suggested' ? 0.65 : 0.95);
    const color = strong ? CREAM : m.color;
    const w = (strong ? 2.2 : m.w * (focus && inF ? 1.25 : 1)) * (l.type === 'part_of' && !strong ? Math.min(1.2, A.s) : 1);
    const dash = strong ? (l.status === 'suggested' ? SUGGEST_DASH : undefined) : l.status === 'suggested' ? SUGGEST_DASH : m.dash;
    const arrow = m.arrow ? `url(#${pfx}a${strong ? 'w' : l.type})` : undefined;
    edgesEl.push(
      <path key={l.id} d={g.d} fill="none" stroke={color} strokeWidth={w.toFixed(2)} strokeDasharray={dash} strokeLinecap="round" opacity={op.toFixed(2)} markerEnd={arrow}>
        <title>{`${A.o.name} —${m.label}→ ${B.o.name}${l.status === 'suggested' ? ttf(" · 제안 {0}", l.conf.toFixed(2)) : ''}${l.ended ? ttf(" · {0}일에 끝남", l.ended.slice(5).replace('-', '월 ')) : ''}`}</title>
      </path>,
    );
  }

  // 객체
  const pathEnds = new Set([selectedId, pathTo].filter(Boolean) as string[]);
  const nodesEl = [...pnodes].sort((a, b) => b.z - a.z).map((n) => {
    const o = n.o; const f = fade(n); const isSel = pathEnds.has(n.id); const isHover = n.id === hoverId;
    const dim = !!focus && !focus.nodes.has(n.id);
    const { x, y, sr: r } = n;
    const op = dim ? 0.16 : 1;
    const ring = (rr: number, stroke: string, w: number, o2: number, dash?: string) => <circle cx={x} cy={y} r={rr} fill="none" stroke={stroke} strokeWidth={w} opacity={o2} strokeDasharray={dash} />;
    const selRings = isSel ? <>{ring(r + 6, CREAM, 1.3, 1)}{ring(r + 10.5, CREAM, 0.7, 0.35)}</> : isHover ? ring(r + 5, CREAM, 1, 0.6) : focus?.kind === 'path' && !dim && focus.strong && !isSel ? ring(r + 4, CREAM, 0.9, 0.55) : null;
    let body: React.ReactNode;
    if (o.type === 'project') {
      body = <>
        <ellipse cx={x} cy={y + r * 1.15} rx={r * 0.85} ry={r * 0.22} fill="#000" opacity={0.35 * f * op} />
        <circle cx={x} cy={y} r={r} fill={grad(n, false)} opacity={dim ? 0.22 : Math.max(0.6, f)} filter={dim ? undefined : blur(n)} />
      </>;
    } else if (o.type === 'task') {
      const done = o.visual === 'done';
      body = <>
        <circle cx={x} cy={y} r={r} fill={grad(n, done)} opacity={op * f * (done ? 0.7 : 1)} filter={dim ? undefined : blur(n)} />
        {!dim && o.visual === 'run' && ring(r + 3, RUN, 1.4, f)}
        {!dim && (o.visual === 'stall' || o.visual === 'stall2') && ring(r + 3, STALL[o.visual]!, 1.4, f, '2.2 2.2')}
      </>;
    } else if (o.type === 'topic') {
      body = <>
        <circle cx={x} cy={y} r={Math.max(3.4, r * 0.62)} fill="#0B0B0C" stroke={isHover || isSel ? CREAM : '#6E6E6B'} strokeWidth={1} opacity={op} />
      </>;
    } else {
      const sug = o.status === 'suggested';
      const border = o.type === 'decision' ? CREAM : '#6E6E6B';
      const icon = TYPE_ICON[o.type];
      const iz = r * 1.22;
      body = <g opacity={op * (sug ? 0.62 : 1) * Math.max(0.55, f)} filter={dim ? undefined : blur(n)}>
        <ellipse cx={x} cy={y + r * 1.05} rx={r * 0.8} ry={r * 0.2} fill="#000" opacity={0.4} />
        <circle cx={x} cy={y} r={r} fill={`url(#${pfx}disc)`} stroke={border} strokeWidth={o.type === 'decision' ? 1.3 : 0.9} strokeOpacity={o.type === 'decision' ? 0.95 : 0.75} strokeDasharray={sug ? '2.4 2' : undefined} />
        <use href={`#i-${icon}`} x={x - iz / 2} y={y - iz / 2} width={iz} height={iz} style={{ stroke: TYPE_META[o.type].tint, fill: 'none', strokeWidth: 1.45, strokeLinecap: 'round', strokeLinejoin: 'round' }} />
      </g>;
    }
    return <g key={n.id} data-id={n.id} style={{ cursor: 'pointer' }}>{body}{selRings}<circle cx={x} cy={y} r={Math.max(r + 4, 8)} fill="transparent" /></g>;
  });

  const ground = W > 0 ? (() => {
    const cx = (box.x0 + box.x1) / 2 + cam.panX, cy = H * 0.76 + cam.panY, R = (box.x1 - box.x0) * 0.56 * cam.zoom;
    const ry = Math.max(0.04, Math.min(0.6, 0.26 * (Math.sin(cam.pitch) / Math.sin(0.3))));
    return [0.35, 0.6, 0.85, 1.1].map((m, i) => <ellipse key={i} cx={cx} cy={cy} rx={R * m} ry={Math.abs(R * m * ry)} fill="none" stroke="#6E6E6B" strokeOpacity={0.15 - i * 0.03} strokeWidth={1} />);
  })() : null;

  const hovered = hoverId ? byId.get(hoverId) : undefined;
  const labelStyle = { paintOrder: 'stroke', stroke: '#0B0B0C', strokeWidth: '3.5px', strokeLinejoin: 'round' } as React.CSSProperties;
  const relCount = (id: string) => links.filter((l) => l.src === id || l.dst === id).length;

  return (
    <div ref={wrap} className={`gview${drag.current?.moved ? ' dragging' : ''}`} tabIndex={0} role="application" aria-label={tt("객체·관계 그래프")} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {W > 0 && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onPointerLeave={() => { if (!drag.current && hover) setHover(null); }} onDoubleClick={onDoubleClick}>
          <defs>{defs}</defs>
          {ground}
          <g>{edgesEl}</g>
          {nodesEl}
          <g pointerEvents="none">
            {labels.edges.map((l) => (
              <text key={`e${l.id}`} x={l.x.toFixed(1)} y={(l.y + 3.5).toFixed(1)} textAnchor="middle" fontSize={10} fontWeight={500} fill={l.color} style={{ ...labelStyle, strokeWidth: '3px' }}>{l.text}</text>
            ))}
            {labels.nodes.map((l) => (
              <text key={l.id} x={l.x.toFixed(1)} y={l.y.toFixed(1)} fontSize={l.fs} fontWeight={l.weight} fill={l.color} fontStyle={l.italic ? 'italic' : undefined} style={labelStyle}>
                {l.text}{l.extra && <tspan fill={l.extraColor} fontWeight={600}> {l.extra}</tspan>}
              </text>
            ))}
          </g>
        </svg>
      )}
      {hovered && !drag.current && (
        <div className="gtip" style={{ left: Math.min(W - 250, hovered.x + hovered.sr + 12), top: Math.max(4, hovered.y - 14) }}>
          {hovered.o.name} <span style={{ color: 'var(--ink3)' }}>· {TYPE_META[hovered.o.type].label}{hovered.o.status === 'suggested' ? tt(" · 제안") : ''}</span>
          <small>{tt("관계")} {relCount(hovered.id)}{tt("개 · 언급")} {hovered.o.mentions}{tt("회 · 눌러서 선택, Shift+클릭으로 경로")}</small>
        </div>
      )}
    </div>
  );
});
