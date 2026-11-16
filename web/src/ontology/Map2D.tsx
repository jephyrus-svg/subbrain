import { tt, ttf } from '../i18n';
// 관계 지도(2D) — 기본 보기. 전체 지도(프로젝트 거품 + 묶은 선) ↔ 프로젝트 펼치기(과제 좌우 호, 도구·결정·주제 위아래 줄).
// Graphite: 단색 면·얇은 선, 네온·글로·블룸 없음. 선 위로 흐르는 옅은 빛은 짧은 점선을 천천히 흘려 표현(강한 관계일수록 밝고 빠르게).
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { mix } from '../lib/format';
import { LINK_META, type OData, type OLink, type OObject } from './model';
import { focusLayout, overviewLayout, type MapLayout, type MNode } from './map2d';
import type { Box } from './layout';

export interface Map2DHandle { zoomBy: (f: number) => void; reset: () => void }
interface Props {
  data: OData; links: OLink[]; projectId: string | null; pick: string | null;
  onOpen: (projectId: string) => void; onPick: (id: string | null) => void; onBack: () => void;
  box: (W: number, H: number) => Box;
}
const CREAM = '#EDEDEB';
const BG = '#0B0B0C';
export const colorOf = (p: OObject) => p.color ?? '#A3A3A0';

export const Map2D = forwardRef<Map2DHandle, Props>(function Map2D({ data, links, projectId, pick, onOpen, onPick, onBack, box: boxFn }, ref) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ W: 0, H: 0 });
  const [cam, setCam] = useState({ z: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [fontTick, setFontTick] = useState(0);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean; id: string | null } | null>(null);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (e) { const W = Math.round(e.contentRect.width), H = Math.round(e.contentRect.height); setSize((o) => (o.W === W && o.H === H ? o : { W, H })); } });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  useEffect(() => { document.fonts?.ready.then(() => setFontTick((t) => t + 1)); }, []);
  useEffect(() => { setCam({ z: 1, x: 0, y: 0 }); setExpanded(new Set()); setHover(null); }, [projectId]);
  useImperativeHandle(ref, () => ({ zoomBy: (f) => setCam((c) => ({ ...c, z: Math.max(0.5, Math.min(4, c.z * f)) })), reset: () => setCam({ z: 1, x: 0, y: 0 }) }), []);

  const proj = projectId ? data.objects.find((o) => o.id === projectId) : undefined;
  const L: MapLayout = useMemo(() => { void fontTick; return proj ? focusLayout(data, links, proj.id, colorOf(proj), expanded) : overviewLayout(data, links, colorOf); }, [data, links, proj, expanded, fontTick]);
  const byId = useMemo(() => new Map(L.nodes.map((n) => [n.id, n])), [L]);
  const { W, H } = size; const box = boxFn(W, H);
  const [bx0, by0, bx1, by1] = L.bbox;
  const s0 = Number.isFinite(bx0) ? Math.min(proj ? 1.25 : 1.35, (box.x1 - box.x0) / Math.max(1, bx1 - bx0), (box.y1 - box.y0) / Math.max(1, by1 - by0)) : 1;
  const s = (Number.isFinite(s0) && s0 > 0 ? s0 : 1) * cam.z;
  const tx = (box.x0 + box.x1) / 2 - ((bx0 + bx1) / 2) * s + cam.x, ty = (box.y0 + box.y1) / 2 - ((by0 + by1) / 2) * s + cam.y;

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top; setCam((c) => { const z = Math.max(0.5, Math.min(4, c.z * Math.exp(-e.deltaY * 0.0015))); const f = z / c.z; const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2; return { z, x: px - cx - (px - cx - c.x) * f, y: py - cy - (py - cy - c.y) * f }; }); };
    el.addEventListener('wheel', onWheel, { passive: false }); return () => el.removeEventListener('wheel', onWheel);
  }, [box.x0, box.x1, box.y0, box.y1]);

  const active = hover ?? pick;
  const touches = (e: { a: string; b: string }) => !!active && (e.a === active || e.b === active);
  const nodeAt = (t: EventTarget | null) => (t as Element | null)?.closest?.('[data-id]')?.getAttribute('data-id') ?? null;
  const click = (id: string | null) => {
    if (!id) { if (pick) onPick(null); return; }
    const n = byId.get(id); if (!n) return;
    if (n.kind === 'more' && n.more) { const t = n.more.type; setExpanded((x) => { const y = new Set(x); y.add(t); return y; }); return; }
    if (!proj && n.kind === 'project') { onOpen(id); return; }
    onPick(pick === id ? null : id);
  };

  const edgeEls: React.ReactNode[] = []; const flowEls: React.ReactNode[] = [];
  for (const e of L.edges) {
    const A = byId.get(e.a), B = byId.get(e.b); if (!A || !B) continue;
    const on = touches(e); const dim = !!active && !on;
    const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1;
    const bend = e.kind === 'agg' ? 0.08 : e.type === 'part_of' ? 0 : 0.12;
    const mx = (A.x + B.x) / 2 + dy * bend, my = (A.y + B.y) / 2 - dx * bend;
    const sx = A.x + (dx / d) * (A.r + 2), sy = A.y + (dy / d) * (A.r + 2), ex = B.x - (dx / d) * (B.r + 2), ey = B.y - (dy / d) * (B.r + 2);
    const path = `M${sx.toFixed(1)} ${sy.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
    let color: string, w: number, op: number, dash: string | undefined;
    if (e.kind === 'agg') { color = '#6E6E6B'; w = 0.8 + 3.2 * e.norm; op = 0.1 + 0.36 * e.norm; }
    else { const m = LINK_META[e.type!]; color = e.type === 'part_of' ? mix(A.color, '#6E6E6B', 0.4) : m.color; w = e.type === 'part_of' ? 0.9 : m.w; op = e.type === 'part_of' ? 0.32 : 0.42; dash = e.suggested ? '6 4' : m.dash; }
    if (on) op = Math.min(0.95, op + 0.4); if (dim) op *= 0.35;
    edgeEls.push(<path key={e.id} d={path} fill="none" stroke={color} strokeWidth={w / s0} strokeDasharray={dash} strokeLinecap="round" opacity={op.toFixed(2)} />);
    // 흐르는 빛: 짧은 밝은 조각이 선을 따라 천천히 (세기 = 관계 굵기). 흐린 선엔 생략
    if (!dim && flowEls.length < 60 && (e.kind === 'agg' || on || e.type === 'part_of')) {
      const k = e.kind === 'agg' ? e.norm : on ? 0.8 : 0.25;
      flowEls.push(<path key={`f${e.id}`} className="oflow" d={path} fill="none" stroke={CREAM} strokeWidth={(0.7 + 1.6 * k) / s0} strokeLinecap="round" strokeDasharray={`${(2 + 6 * k) / s0} ${46 / s0}`}
        opacity={(0.1 + 0.42 * k).toFixed(2)} style={{ animationDuration: `${(7 - 3.5 * k).toFixed(1)}s`, ['--flow' as string]: `${-48 / s0}px` }} />);
    }
  }

  const label = (n: MNode, fs: number, weight: number, color: string) => (
    <text x={n.lx} y={n.ly} textAnchor={n.anchor} fontSize={fs} fontWeight={weight} fill={color} className="olbl" data-lbl={n.id}>
      {n.label}{n.badge && <tspan fill={n.badgeColor} fontWeight={600}> {n.badge}</tspan>}
    </text>
  );
  const nodeEls = L.nodes.map((n) => {
    const isOn = n.id === active; const dim = !!active && !isOn && !L.edges.some((e) => touches(e) && (e.a === n.id || e.b === n.id));
    const op = dim ? 0.38 : 1;
    let body: React.ReactNode; let lbl: React.ReactNode;
    if (n.kind === 'project') {
      const big = !!proj;
      body = <><circle cx={n.x} cy={n.y} r={n.r} fill={n.color} fillOpacity={big ? 0.22 : 0.14} stroke={n.color} strokeOpacity={0.9} strokeWidth={big ? 1.8 : 1.4} />
        <circle cx={n.x} cy={n.y} r={Math.max(3, n.r * 0.26)} fill={n.color} /></>;
      lbl = <>{label({ ...n, ly: n.ly }, big ? 15 : 12.5, big ? 700 : 600, CREAM)}<text x={n.lx} y={n.ly + (big ? 17 : 15)} textAnchor="middle" fontSize={10.5} fill="#8A8A85" className="olbl">{n.sub}</text></>;
    } else if (n.kind === 'tool') {
      body = <circle cx={n.x} cy={n.y} r={n.r} fill="#131314" stroke={n.color} strokeWidth={1.3} />;
      lbl = <>{label(n, 11.5, 500, '#C4C2BC')}<text x={n.lx} y={n.ly + 14} textAnchor="middle" fontSize={10.5} fill="#8A8A85" className="olbl">{n.sub}</text></>;
    } else if (n.kind === 'task') {
      const v = n.o.visual; const done = v === 'done' || v === 'archived';
      body = <><circle cx={n.x} cy={n.y} r={n.r} fill={done ? mix(n.color, '#6E6E6B', 0.6) : n.color} />
        {v === 'run' && <circle cx={n.x} cy={n.y} r={n.r + 3} fill="none" stroke="#8FB59A" strokeWidth={1.2} />}
        {(v === 'stall' || v === 'stall2') && <circle cx={n.x} cy={n.y} r={n.r + 3} fill="none" stroke={v === 'stall' ? '#D08A66' : '#D3B060'} strokeWidth={1.2} strokeDasharray="2.2 2.2" />}</>;
      lbl = label(n, 11.5, isOn ? 600 : 500, isOn ? CREAM : done ? '#8A8A85' : '#C4C2BC');
    } else if (n.kind === 'more') {
      body = <rect x={n.rect[0] + 2} y={n.rect[1] + 1} width={n.rect[2] - n.rect[0] - 4} height={n.rect[3] - n.rect[1] - 2} rx={9} fill="#131314" stroke="#2C2C30" />;
      lbl = <text x={n.lx} y={n.ly} fontSize={11} fontWeight={600} fill="#A3A3A0" className="olbl" data-lbl={n.id}>{n.label}</text>;
    } else {
      body = <circle cx={n.x} cy={n.y} r={n.r} fill="#0B0B0C" stroke={n.color} strokeWidth={1.2} />;
      lbl = label(n, 11, isOn ? 600 : 500, isOn ? CREAM : n.o.type === 'topic' ? '#8A8A85' : '#A3A3A0');
    }
    const ring = isOn && n.kind !== 'more' ? <circle cx={n.x} cy={n.y} r={n.r + 6} fill="none" stroke={CREAM} strokeWidth={1.2} /> : null;
    const hitR: [number, number, number, number] = [Math.min(n.rect[0], n.x - n.r - 4), Math.min(n.rect[1], n.y - n.r - 4), Math.max(n.rect[2], n.x + n.r + 4), Math.max(n.rect[3], n.y + n.r + 4)];
    return <g key={n.id} data-id={n.id} opacity={op} style={{ cursor: 'pointer' }}>
      <rect x={hitR[0]} y={hitR[1]} width={hitR[2] - hitR[0]} height={hitR[3] - hitR[1]} fill="transparent" />
      {body}{ring}{lbl}
    </g>;
  });

  const hv = hover ? byId.get(hover) : undefined;
  return (
    <div ref={wrap} className="gview omap" role="application" aria-label={proj ? ttf("{0} 펼친 지도", proj.name) : tt("프로젝트 지도")} tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Backspace' && proj) onBack(); }}>
      {W > 0 && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}
          onPointerDown={(e) => { (e.currentTarget as Element).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false, id: nodeAt(e.target) }; }}
          onPointerMove={(e) => { const d = drag.current; if (!d) { const id = nodeAt(e.target); if (id !== hover) setHover(id); return; } const dx = e.clientX - d.x, dy = e.clientY - d.y; if (!d.moved && Math.hypot(dx, dy) < 4) return; d.moved = true; setCam((c) => ({ ...c, x: d.cx + dx, y: d.cy + dy })); }}
          onPointerUp={(e) => { const d = drag.current; drag.current = null; if (d && !d.moved) click(d.id); void e; }}
          onPointerLeave={() => { if (!drag.current) setHover(null); }}>
          <g transform={`translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${s.toFixed(4)})`}>
            <g>{edgeEls}</g>
            <g pointerEvents="none">{flowEls}</g>
            {nodeEls}
          </g>
        </svg>
      )}
      {hv && !proj && hv.kind === 'project' && (
        <div className="gtip" style={{ left: Math.min(W - 250, tx + (hv.x + hv.r) * s + 10), top: Math.max(4, ty + hv.y * s - 14) }}>
          {hv.o.name}<small>{hv.sub} {tt("· 눌러서 펼치기")}</small>
        </div>
      )}
    </div>
  );
});
void BG;
