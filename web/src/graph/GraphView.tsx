import { tt, ttf } from '../i18n';
// 홈 그래프 · 미니맵 공용 SVG 렌더러 (디자인 v3: 빛 받은 구체, 깊이 흐림, 상태 고리, 원근 바닥 타원)
import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { GraphNode, GraphResponse } from '@subbrain/shared';
import { mix } from '../lib/format';
import { buildScene, clearTextCache, curve, DEFAULT_CAMERA, fitScale, placeLabels, project, type Box, type Camera, type PNode, type Wanted } from './engine';

export interface GraphHandle { zoomBy: (f: number) => void; reset: () => void; focus: (id: string) => void }
type Rect = [number, number, number, number];
interface Props {
  data: GraphResponse;
  selectedId: string | null;
  hoverId?: string | null;
  onSelect?: (id: string, node: GraphNode) => void;
  onOpen?: (node: GraphNode) => void;
  onHover?: (id: string | null) => void;
  compact?: boolean;
  rotateOnDrag?: boolean;
  autoRotate?: boolean;
  ariaLabel?: string;
}

const RUN = '#8FB59A';
const STALL: Record<string, string> = { stall: '#D08A66', stall2: '#D3B060' };

export const GraphView = forwardRef<GraphHandle, Props>(function GraphView(
  { data, selectedId, hoverId: extHover = null, onSelect, onOpen, onHover, compact = false, rotateOnDrag = true, autoRotate = false, ariaLabel }, ref,
) {
  const pfx = useId().replace(/[^a-zA-Z0-9]/g, '');
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ W: number; H: number }>({ W: 0, H: 0 });
  const [cam, setCam] = useState<Camera>(DEFAULT_CAMERA);
  const camRef = useRef(cam); camRef.current = cam;
  const [hover, setHover] = useState<string | null>(null);
  const [fontTick, setFontTick] = useState(0);
  const drag = useRef<{ x: number; y: number; moved: boolean; mode: 'rotate' | 'pan'; id: string | null; cam: Camera } | null>(null);
  const anim = useRef<number | null>(null);

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (e) setSize({ W: Math.round(e.contentRect.width), H: Math.round(e.contentRect.height) }); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  useEffect(() => { document.fonts?.ready.then(() => { clearTextCache(); setFontTick((t) => t + 1); }); }, []);

  const scene = useMemo(() => buildScene(data), [data]);
  const { W, H } = size;
  const box: Box = useMemo(() => (compact ? { x0: 16, y0: 16, x1: W - 16, y1: H - 24 } : { x0: 40, y0: 100, x1: W - 40, y1: H - 113 }), [compact, W, H]);
  const k = useMemo(() => (W && H ? fitScale(scene, box) : { k: 1, ox: 0, oy: 0 }), [scene, box, W, H]);
  const pnodes = useMemo(() => (W && H ? project(scene, cam, box, k, drag.current?.moved ? 25 : 60, compact ? 1.1 : Infinity, compact ? 0.6 : 1) : []), [scene, cam, box, k, W, H]);
  const byId = useMemo(() => new Map(pnodes.map((n) => [n.id, n])), [pnodes]);
  const hoverId = hover ?? extHover;

  // 선택 → 속한 프로젝트
  const sel = selectedId ? scene.byId.get(selectedId) : undefined;
  const selProject = sel ? (sel.kind === 'hub' ? sel.id : sel.hubId) : null;

  // 자동 회전
  useEffect(() => {
    if (!autoRotate) return;
    let raf = 0;
    const tick = () => { if (!drag.current) setCam((c) => ({ ...c, yaw: c.yaw + 0.0028 })); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [autoRotate]);

  const animateTo = useCallback((target: Partial<Camera>, ms = 380) => {
    if (anim.current) cancelAnimationFrame(anim.current);
    const from = camRef.current; const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms); const e = 1 - Math.pow(1 - p, 3);
      const lerp = (a: number, b: number | undefined) => (b === undefined ? a : a + (b - a) * e);
      setCam({ yaw: lerp(from.yaw, target.yaw), pitch: lerp(from.pitch, target.pitch), zoom: lerp(from.zoom, target.zoom), panX: lerp(from.panX, target.panX), panY: lerp(from.panY, target.panY) });
      if (p < 1) anim.current = requestAnimationFrame(step); else anim.current = null;
    };
    anim.current = requestAnimationFrame(step);
  }, []);

  const zoomAt = useCallback((f: number, sx?: number, sy?: number) => {
    setCam((c) => {
      const zoom = Math.max(0.4, Math.min(4, c.zoom * f)); const ff = zoom / c.zoom;
      const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
      const px = sx ?? cx + c.panX, py = sy ?? cy + c.panY;
      return { ...c, zoom, panX: px - cx - (px - cx - c.panX) * ff, panY: py - cy - (py - cy - c.panY) * ff };
    });
  }, [box]);

  const focus = useCallback((id: string) => {
    const n = byId.get(id); if (!n) return;
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    const c = camRef.current; const zoom = Math.min(2.6, c.zoom * 1.35); const f = zoom / c.zoom;
    animateTo({ zoom, panX: -(n.x - cx - c.panX) * f, panY: -(n.y - cy - c.panY) * f });
  }, [byId, box, animateTo]);

  useImperativeHandle(ref, () => ({ zoomBy: (f) => zoomAt(f), reset: () => animateTo(DEFAULT_CAMERA), focus }), [zoomAt, animateTo, focus]);

  // 휠 확대 (passive:false)
  useEffect(() => {
    const el = wrap.current; if (!el || compact) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); };
    el.addEventListener('wheel', onWheel, { passive: false }); return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, compact]);

  const nodeAt = (t: EventTarget | null) => (t as Element | null)?.closest?.('[data-id]')?.getAttribute('data-id') ?? null;
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const pan = e.button === 2 || e.shiftKey || !rotateOnDrag;
    drag.current = { x: e.clientX, y: e.clientY, moved: false, mode: pan ? 'pan' : 'rotate', id: nodeAt(e.target), cam: camRef.current };
    if (anim.current) { cancelAnimationFrame(anim.current); anim.current = null; }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) {
      const id = nodeAt(e.target);
      if (id !== hover) { setHover(id); onHover?.(id); }
      return;
    }
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    if (hover) { setHover(null); onHover?.(null); }
    if (d.mode === 'rotate') setCam({ ...d.cam, yaw: d.cam.yaw + dx * 0.006, pitch: Math.max(-0.2, Math.min(1.25, d.cam.pitch + dy * 0.004)) });
    else setCam({ ...d.cam, panX: d.cam.panX + dx, panY: d.cam.panY + dy });
  };
  const onPointerUp = () => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (!d.moved && d.id) { const n = scene.byId.get(d.id); if (n) onSelect?.(n.id, n.node); }
    if (d.moved) setCam((c) => ({ ...c })); // 정밀 겹침 풀기로 한 번 더 그림
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    const id = nodeAt(e.target);
    if (!id) { animateTo({ ...DEFAULT_CAMERA, yaw: camRef.current.yaw, pitch: camRef.current.pitch }); return; }
    const n = scene.byId.get(id);
    if (compact) { if (n) onOpen?.(n.node); return; }
    focus(id);
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
    else if (e.key === 'Enter' && selectedId) { const n = scene.byId.get(selectedId); if (n) onOpen?.(n.node); }
    else return;
    e.preventDefault();
  };

  // ── 그리기 ──
  const fade = (n: PNode) => 1 - n.dn * 0.55;
  const blur = (_n: PNode): string | undefined => undefined; // Graphite: 블러 없음 — 깊이는 명도·크기로
  const defs = useMemo(() => {
    const out: React.ReactNode[] = [];
    const cols = [...scene.projects.map((p) => scene.colors.get(p) ?? '#6E6E6B'), '#6E6E6B'];
    cols.forEach((c, i) => {
      const id = i === cols.length - 1 ? 'x' : String(i);
      out.push(<radialGradient key={`s${id}`} id={`${pfx}s${id}`} cx="36%" cy="30%" r="72%"><stop offset="0" stopColor={c} /><stop offset=".78" stopColor={c} /><stop offset=".78" stopColor={mix(c, '#070708', 0.62)} /><stop offset="1" stopColor={mix(c, '#070708', 0.62)} /></radialGradient>);
      const d = mix(c, '#6E6E6B', 0.72);
      out.push(<radialGradient key={`d${id}`} id={`${pfx}d${id}`} cx="36%" cy="30%" r="72%"><stop offset="0" stopColor={d} /><stop offset=".78" stopColor={d} /><stop offset=".78" stopColor={mix(d, '#070708', 0.6)} /><stop offset="1" stopColor={mix(d, '#070708', 0.6)} /></radialGradient>);
    });
    return out;
  }, [scene, pfx, compact]);
  const grad = (n: PNode, done: boolean) => `url(#${pfx}${done ? 'd' : 's'}${n.projectIndex >= 0 ? n.projectIndex : 'x'})`;

  const labels = useMemo(() => {
    if (!pnodes.length) return [];
    void fontTick;
    const wanted = pnodes.flatMap((n): Wanted[] => {
      const isSel = n.id === selectedId, isHover = n.id === hoverId;
      if (n.kind === 'hub') return [{ n, prio: isSel ? 0 : 1 + n.dn, main: n.node.label, extra: null, kind: 'hub', sel: isSel }];
      if (n.kind === 'task') {
        const stalled = n.v === 'stall' || n.v === 'stall2';
        const show = compact ? n.v !== 'done' || isSel || n.node.size > 0.35 : stalled || (n.v === 'run' && n.node.size >= 0.45) || isSel || isHover;
        if (!show || (compact && isSel && !isHover)) return [];
        return [{ n, prio: isSel || isHover ? 0.2 : 3, main: compact && !isHover ? shortLabel(n.node.label) : n.node.label, extra: !compact && stalled ? n.node.badge : null, kind: 'task', sel: false }];
      }
      if (n.kind === 'topic') return [{ n, prio: isHover ? 0.2 : 4, main: `#${n.node.label}`, extra: null, kind: 'topic', sel: false }];
      if (n.kind === 'quick' && isHover) return [{ n, prio: 0.2, main: n.node.label, extra: null, kind: 'task', sel: false }];
      return [];
    });
    const blocked: Rect[] = compact ? [] : [[0, 0, 560, 90], [W - 200, 0, W, 80], [0, H - 106, W, H]];
    return placeLabels(pnodes, wanted, box, blocked, compact ? { hub: 11, hubSel: 11.5, task: 10.5 } : { hub: 13, hubSel: 15, task: 11 }, compact ? 2 : 12);
  }, [pnodes, selectedId, hoverId, box, W, H, compact, fontTick]);

  const edgesEl: React.ReactNode[] = [];
  const hoverEdge = (a: string, b: string) => hoverId !== null && (a === hoverId || b === hoverId);
  // 프로젝트 ↔ 프로젝트, 주제, 후속 관계
  for (const e of scene.edges) {
    if (e.type === 'part_of') continue;
    const A = byId.get(e.source), B = byId.get(e.target); if (!A || !B) continue;
    const hv = hoverEdge(e.source, e.target);
    const faded = e.status === 'suggested' ? 0.4 : e.endedAt ? 0.5 : 1;
    if (A.kind === 'hub' && B.kind === 'hub') edgesEl.push(<path key={e.id} d={curve(A.x, A.y, B.x, B.y, 0.16)} fill="none" stroke="#6E6E6B" strokeWidth={1} strokeDasharray="3 5" opacity={(hv ? 0.85 : 0.45) * faded}><title>{e.reason ?? tt("관련 프로젝트")}</title></path>);
    else if (e.type === 'same_task_candidate') edgesEl.push(<path key={e.id} d={curve(A.x, A.y, B.x, B.y, -0.14)} fill="none" stroke="#D3B060" strokeWidth={0.9} strokeDasharray="2 3" opacity={hv ? 0.9 : 0.5}><title>{tt("같은 과제일 수 있음")}</title></path>);
    else edgesEl.push(<path key={e.id} d={curve(B.x, B.y, A.x, A.y, -0.14)} fill="none" stroke="#6E6E6B" strokeWidth={hv ? 1.1 : 0.8} strokeDasharray="1.5 3.5" opacity={(hv ? 0.9 : 0.5) * faded}>{e.reason ? <title>{e.reason}</title> : null}</path>);
  }
  const spokes = pnodes.filter((n) => (n.kind === 'task' || n.kind === 'quick') && n.hubId).sort((a, b) => b.z - a.z);
  for (const n of spokes) {
    const h = byId.get(n.hubId!); if (!h) continue;
    const isSelP = n.hubId === selProject; const hv = hoverEdge(n.id, h.id);
    const o = n.kind === 'task' ? (hv ? 0.85 : (isSelP ? 0.55 : 0.32) * fade(n)) : (hv ? 0.6 : 0.16 * fade(n));
    edgesEl.push(<path key={`sp${n.id}`} d={curve(h.x, h.y, n.x, n.y, 0.1)} fill="none" stroke={n.color} strokeWidth={((isSelP ? 1.3 : 0.9) * n.s).toFixed(2)} opacity={o.toFixed(2)} />);
  }

  const nodesEl = [...pnodes].sort((a, b) => b.z - a.z).map((n) => {
    const f = fade(n); const isSel = n.id === selectedId; const isHover = n.id === hoverId;
    const { x, y, sr: r } = n;
    const ring = (rr: number, stroke: string, w: number, op: number, dash?: string) => <circle cx={x} cy={y} r={rr} fill="none" stroke={stroke} strokeWidth={w} opacity={op} strokeDasharray={dash} />;
    let body: React.ReactNode;
    if (n.kind === 'hub') {
      body = <>
        <ellipse cx={x} cy={y + r * 1.15} rx={r * 0.85} ry={r * 0.22} fill="#000" opacity={0.35 * f} />
        <circle cx={x} cy={y} r={r} fill={grad(n, false)} opacity={Math.max(0.6, f)} filter={blur(n)} />
        {isSel && <>{ring(r + 7, '#EDEDEB', 1.3, 1)}{ring(r + 12, '#EDEDEB', 0.7, 0.35)}</>}
        {isHover && !isSel && ring(r + 5, '#EDEDEB', 1, 0.55)}
      </>;
    } else if (n.kind === 'task') {
      const done = n.v === 'done';
      body = <>
        <circle cx={x} cy={y} r={r} fill={grad(n, done)} opacity={f * (done ? 0.7 : 1)} filter={blur(n)} />
        {n.v === 'run' && ring(r + 3, RUN, 1.4, f)}
        {(n.v === 'stall' || n.v === 'stall2') && ring(r + 3, STALL[n.v]!, 1.4, f, '2.2 2.2')}
        {isSel && <>{ring(r + 7, '#EDEDEB', 1.3, 1)}{ring(r + 11, '#EDEDEB', 0.7, 0.35)}</>}
        {isHover && !isSel && ring(r + 6, '#EDEDEB', 1, 0.6)}
        <circle cx={x} cy={y} r={r + 4} fill="transparent" />
      </>;
    } else if (n.kind === 'quick') {
      body = <>
        <circle cx={x} cy={y} r={Math.max(1.1, r)} fill="#6E6E6B" opacity={(isHover ? 0.9 : 0.45) * f} />
        {(isSel || isHover) && ring(r + 4, '#EDEDEB', 1, isSel ? 0.9 : 0.5)}
        <circle cx={x} cy={y} r={5} fill="transparent" />
      </>;
    } else {
      body = <>
        <circle cx={x} cy={y} r={3.4} fill="#0B0B0C" stroke={isHover || isSel ? '#EDEDEB' : '#6E6E6B'} strokeWidth={1} />
        {isSel && ring(8, '#EDEDEB', 1.1, 0.9)}
        <circle cx={x} cy={y} r={7} fill="transparent" />
      </>;
    }
    return <g key={n.id} data-id={n.id} style={{ cursor: 'pointer' }}>{body}</g>;
  });

  const ground = !compact && W > 0 ? (() => {
    const cx = W / 2 + cam.panX, cy = H * 0.755 + cam.panY, R = W * 0.467 * cam.zoom;
    const ry = Math.max(0.04, Math.min(0.6, 0.26 * (Math.sin(cam.pitch) / Math.sin(0.3))));
    return [0.35, 0.6, 0.85, 1.1].map((m, i) => <ellipse key={i} cx={cx} cy={cy} rx={R * m} ry={Math.abs(R * m * ry)} fill="none" stroke="#6E6E6B" strokeOpacity={0.16 - i * 0.03} strokeWidth={1} />);
  })() : compact && W > 0 ? <ellipse cx={W / 2} cy={H - 24} rx={W * 0.41} ry={18} fill="none" stroke="#6E6E6B" strokeOpacity={0.14} /> : null;

  const hovered = hoverId ? byId.get(hoverId) : undefined;
  const labelStyle = { paintOrder: 'stroke', stroke: compact ? '#131314' : '#0B0B0C', strokeWidth: compact ? '3px' : '3.5px', strokeLinejoin: 'round' } as React.CSSProperties;

  return (
    <div ref={wrap} className={`gview${compact ? ' compact' : ''}${drag.current?.moved ? ' dragging' : ''}`} tabIndex={0} role="application" aria-label={ariaLabel ?? tt("과제 그래프")}
      onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {W > 0 && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onPointerLeave={() => { if (!drag.current && hover) { setHover(null); onHover?.(null); } }} onDoubleClick={onDoubleClick}>
          <defs>{defs}</defs>
          {ground}
          {edgesEl}
          {nodesEl}
          <g pointerEvents="none">
            {labels.map((l) => (
              <text key={l.id} x={l.x.toFixed(1)} y={l.y.toFixed(1)} fontSize={l.fs} fontWeight={l.weight} fill={l.color} fontStyle={l.kind === 'topic' ? 'italic' : undefined} style={labelStyle}>
                {l.main}{l.extra && <tspan fill={l.extraColor ?? undefined} fontWeight={600}> {l.extra}</tspan>}
              </text>
            ))}
          </g>
        </svg>
      )}
      {hovered && !drag.current && (
        <div className="gtip" style={{ left: Math.min(W - 260, hovered.x + hovered.sr + 12), top: Math.max(4, hovered.y - 14) }}>
          {hovered.node.tooltip}
          {!compact && <small>{hovered.kind === 'hub' ? tt("눌러서 선택 · 두 번 눌러 초점") : hovered.kind === 'topic' ? tt("눌러서 주제 보기") : tt("눌러서 선택 · 오른쪽 패널에서 열기")}</small>}
        </div>
      )}
    </div>
  );
});

/** 미니 그래프용 짧은 이름: 앞 단어부터 8자 안쪽까지 */
function shortLabel(s: string): string {
  if (s.length <= 8) return s;
  const words = s.split(/\s+/); let out = '';
  for (const w of words) { const next = out ? `${out} ${w}` : w; if (next.length > 8) break; out = next; }
  return out || `${s.slice(0, 7)}…`;
}
