import { tt, ttf } from '../i18n';
// 관계 지도(2D) 배치 — 원근·회전 없이 평면에.
// 전체 지도: 프로젝트(+공유가 많은 도구 몇 개)만 거품으로, 프로젝트 사이 관계는 묶어서 한 선(굵기 = 공유 관계 수).
// 프로젝트 펼치기: 가운데 프로젝트, 좌우 호에 과제, 위·아래 줄에 도구·결정·주제(많으면 개수 칩으로 접음).
// 모든 라벨은 사각형으로 겹침을 풀어서 놓는다(겹치면 안 그림 대신 자리를 민다).
import { textWidth } from '../graph/engine';
import type { OData, OLink, OObject, ObjectType } from './model';

export type Rect = [number, number, number, number];
export const hit = (a: Rect, b: Rect) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const FONT_W = (s: string, fs: number, w: number) => (typeof document === 'undefined' ? s.length * fs * 0.62 : textWidth(s, fs, w));

/** 객체 → 속한 프로젝트들 (프로젝트는 자기, 과제는 속한 프로젝트, 나머지는 이어진 프로젝트·과제의 프로젝트) */
export function owners(d: OData, links: OLink[]) {
  const byId = new Map(d.objects.map((o) => [o.id, o]));
  const own = new Map<string, Set<string>>();
  const add = (id: string, p: string) => (own.get(id) ?? own.set(id, new Set()).get(id)!).add(p);
  for (const o of d.objects) if (o.type === 'project') add(o.id, o.id);
  for (const o of d.objects) if (o.type === 'task' && o.project && byId.has(o.project)) add(o.id, o.project);
  for (const l of links) if (l.type === 'part_of') { const a = byId.get(l.src), b = byId.get(l.dst); if (a?.type === 'task' && b?.type === 'project' && !own.has(a.id)) add(a.id, b.id); }
  for (const l of links) {
    for (const [x, y] of [[l.src, l.dst], [l.dst, l.src]] as const) {
      const ox = byId.get(x), oy = byId.get(y); if (!ox || !oy || ox.type === 'project' || ox.type === 'task') continue;
      if (oy.type === 'project' || oy.type === 'task') for (const p of own.get(y) ?? []) add(x, p);
    }
  }
  return { own, byId };
}

export interface MNode { id: string; o: OObject; kind: 'project' | 'tool' | 'task' | 'item' | 'more'; x: number; y: number; r: number; color: string;
  label: string; sub?: string; badge?: string | null; badgeColor?: string; anchor: 'middle' | 'start' | 'end'; lx: number; ly: number; rect: Rect; more?: { type: ObjectType; n: number } }
export interface MEdge { id: string; a: string; b: string; w: number; norm: number; kind: 'agg' | 'link'; type?: OLink['type']; suggested?: boolean }
export interface MapLayout { nodes: MNode[]; edges: MEdge[]; bbox: Rect }

const LBL = '#EDEDEB';
function nodeRect(n: Omit<MNode, 'rect' | 'lx' | 'ly' | 'anchor'> & { anchor?: MNode['anchor'] }, fs: number, weight: number) {
  const tw = FONT_W(n.label + (n.badge ? ` ${n.badge}` : ''), fs, weight);
  const sw = n.sub ? FONT_W(n.sub, 10.5, 400) : 0;
  return { tw, sw };
}

// ── 전체 지도 ──
export function overviewLayout(d: OData, links: OLink[], colorOf: (p: OObject) => string): MapLayout {
  const { own, byId } = owners(d, links);
  const projects = d.objects.filter((o) => o.type === 'project');
  const tasksOf = new Map<string, OObject[]>();
  for (const o of d.objects) if (o.type === 'task') for (const p of own.get(o.id) ?? []) (tasksOf.get(p) ?? tasksOf.set(p, []).get(p)!).push(o);
  // 프로젝트 쌍 사이 묶음 무게: 둘 다에 걸친 객체 수 + 서로 다른 프로젝트 객체를 잇는 직접 관계
  const pair = new Map<string, number>(); const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const [id, ps] of own) { const o = byId.get(id); if (!o || o.type === 'project' || o.type === 'task' || ps.size < 2) continue; const a = [...ps]; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) pair.set(key(a[i]!, a[j]!), (pair.get(key(a[i]!, a[j]!)) ?? 0) + 1); }
  for (const l of links) { if (l.type === 'part_of') continue; const A = own.get(l.src), B = own.get(l.dst); const oa = byId.get(l.src), ob = byId.get(l.dst); if (!A || !B || !oa || !ob || !['project', 'task'].includes(oa.type) || !['project', 'task'].includes(ob.type)) continue; for (const a of A) for (const b of B) if (a !== b) pair.set(key(a, b), (pair.get(key(a, b)) ?? 0) + 1); }
  // 여러 프로젝트에 걸친 도구 상위 6개
  const tools = d.objects.filter((o) => o.type === 'tool' && (own.get(o.id)?.size ?? 0) >= 2).sort((a, b) => (own.get(b.id)!.size - own.get(a.id)!.size) || b.mentions - a.mentions).slice(0, 6);
  const toolW = new Map<string, number>();
  for (const l of links) for (const t of tools) { const other = l.src === t.id ? l.dst : l.dst === t.id ? l.src : null; if (!other) continue; for (const p of own.get(other) ?? []) toolW.set(`${t.id}|${p}`, (toolW.get(`${t.id}|${p}`) ?? 0) + 1); }

  type B = { id: string; o: OObject; kind: 'project' | 'tool'; r: number; color: string; label: string; sub: string; badge: string | null; tw: number; sw: number; x: number; y: number };
  const bs: B[] = [];
  projects.forEach((p) => {
    const ts = tasksOf.get(p.id) ?? []; const stalled = ts.filter((t) => t.visual === 'stall' || t.visual === 'stall2').length;
    const label = trunc(p.name, 20); const sub = ttf("과제 {0}{1}", ts.length, stalled ? ttf(" · 막힘 {0}", stalled) : '');
    bs.push({ id: p.id, o: p, kind: 'project', r: 14 + 6.5 * Math.sqrt(ts.length), color: colorOf(p), label, sub, badge: null, tw: FONT_W(label, 12.5, 600), sw: FONT_W(sub, 10.5, 400), x: 0, y: 0 });
  });
  tools.forEach((t) => { const label = trunc(t.name, 16); const sub = ttf("프로젝트 {0}곳", own.get(t.id)!.size); bs.push({ id: t.id, o: t, kind: 'tool', r: 9, color: '#7F9CC4', label, sub, badge: null, tw: FONT_W(label, 11.5, 500), sw: FONT_W(sub, 10.5, 400), x: 0, y: 0 }); });
  const bi = new Map(bs.map((b, i) => [b.id, i]));
  const edges: Array<{ a: number; b: number; w: number }> = [];
  for (const [k, w] of pair) { const [a, b] = k.split('|'); if (bi.has(a!) && bi.has(b!)) edges.push({ a: bi.get(a!)!, b: bi.get(b!)!, w }); }
  for (const [k, w] of toolW) { const [t, p] = k.split('|'); if (bi.has(t!) && bi.has(p!)) edges.push({ a: bi.get(t!)!, b: bi.get(p!)!, w }); }
  const maxW = Math.max(1, ...edges.map((e) => e.w));
  // 선이 너무 많으면 털뭉치가 된다: 각 거품의 가장 굵은 3개 + 아주 굵은 것만 남긴다(배치 힘은 전부 씀)
  const keep = new Set<number>();
  const per = new Map<number, number[]>();
  edges.forEach((e, i) => { for (const n of [e.a, e.b]) (per.get(n) ?? per.set(n, []).get(n)!).push(i); if (e.w / maxW >= 0.7) keep.add(i); });
  for (const arr of per.values()) arr.sort((x, y) => edges[y]!.w - edges[x]!.w).slice(0, 2).forEach((i) => keep.add(i));
  // 시작 자리: 큰 것부터 해바라기 나선
  const order = [...bs.keys()].sort((a, b) => bs[b]!.r - bs[a]!.r);
  order.forEach((i, k) => { const th = k * 2.39996, rr = 70 * Math.sqrt(k + 0.5); bs[i]!.x = Math.cos(th) * rr * 1.5; bs[i]!.y = Math.sin(th) * rr; });
  const rectOf = (b: B): Rect => { const hw = Math.max(b.r, b.tw / 2, b.sw / 2) + 8; return [b.x - hw, b.y - b.r - 8, b.x + hw, b.y + b.r + 6 + 32 + 6]; };
  // 시간 상한: 실데이터가 커져도 화면이 멎지 않게 (배치 120ms, 겹침 풀기 60ms)
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const t0 = now();
  for (let it = 0; it < 400; it++) {
    if (now() - t0 > 120) break;
    const cool = 1 - it / 400;
    for (const e of edges) { const A = bs[e.a]!, B = bs[e.b]!; const dx = B.x - A.x, dy = B.y - A.y, dd = Math.max(1, Math.hypot(dx, dy)); const L = A.r + B.r + 150; const k = (dd - L) * 0.012 * Math.min(1, 0.3 + e.w / maxW) * cool; A.x += dx / dd * k; A.y += dy / dd * k; B.x -= dx / dd * k; B.y -= dy / dd * k; }
    for (const b of bs) { b.x *= 1 - 0.004 * cool; b.y *= 1 - 0.006 * cool; } // 가운데로 살짝 (세로를 조금 더 → 가로로 넓은 화면)
    separate(bs, rectOf, 14);
  }
  const t1 = now();
  for (let k = 0; k < 60 && now() - t1 < 60; k++) if (!separate(bs, rectOf, 14)) break;
  bs.forEach((b, k) => { if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) { b.x = (k % 6) * 220; b.y = Math.floor(k / 6) * 120; } });
  const nodes: MNode[] = bs.map((b) => ({ id: b.id, o: b.o, kind: b.kind, x: b.x, y: b.y, r: b.r, color: b.color, label: b.label, sub: b.sub, badge: null, anchor: 'middle', lx: b.x, ly: b.y + b.r + 17, rect: [b.x - Math.max(b.tw, b.sw) / 2 - 2, b.y + b.r + 4, b.x + Math.max(b.tw, b.sw) / 2 + 2, b.y + b.r + 36] }));
  void LBL;
  return { nodes, edges: edges.filter((_, i) => keep.has(i)).map((e, i) => ({ id: `agg${i}`, a: bs[e.a]!.id, b: bs[e.b]!.id, w: e.w, norm: e.w / maxW, kind: 'agg' })), bbox: bboxOf(bs.map(rectOf)) };
}

/** 사각형끼리 겹치면 덜 겹친 축으로 밀어낸다. 움직였으면 true */
function separate<T extends { x: number; y: number }>(items: T[], rectOf: (t: T) => Rect, pad: number): boolean {
  let moved = false;
  if (items.length > 400) return false; // O(n²) 상한
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const A = items[i]!, B = items[j]!; const a = rectOf(A), b = rectOf(B);
    const ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]) + pad, oy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]) + pad;
    if (ox <= 0 || oy <= 0) continue;
    moved = true;
    if (A.x === B.x && A.y === B.y) { A.x -= 1 + (i % 3); B.x += 1 + (j % 3); } // 같은 자리면 서로 바꾸며 떨지 않게 먼저 벌린다
    if (ox / 1.6 < oy) { const s = (A.x < B.x ? -1 : 1) * ox / 2; A.x += s; B.x -= s; } else { const s = (A.y < B.y ? -1 : 1) * oy / 2; A.y += s; B.y -= s; }
  }
  return moved;
}
const bboxOf = (rs: Rect[]): Rect => rs.reduce<Rect>((m, r) => [Math.min(m[0], r[0]), Math.min(m[1], r[1]), Math.max(m[2], r[2]), Math.max(m[3], r[3])], [Infinity, Infinity, -Infinity, -Infinity]);

// ── 프로젝트 펼치기 ──
const STATUS_RANK: Record<string, number> = { stall: 0, stall2: 1, run: 2, quick: 3, done: 4, archived: 5 };
const GROUP_ORDER: ObjectType[] = ['tool', 'decision', 'person', 'organization', 'place', 'artifact', 'topic'];
export const GROUP_CAP = 8;
export function focusLayout(d: OData, links: OLink[], pid: string, color: string, expanded: Set<string>): MapLayout {
  const { own, byId } = owners(d, links);
  const p = byId.get(pid)!;
  const tasks = d.objects.filter((o) => o.type === 'task' && own.get(o.id)?.has(pid)).sort((a, b) => (STATUS_RANK[a.visual ?? ''] ?? 9) - (STATUS_RANK[b.visual ?? ''] ?? 9) || b.mentions - a.mentions);
  tasks.splice(120); // 한 프로젝트에 과제가 아주 많아도 호 길이·렌더 상한
  const taskIds = new Set(tasks.map((t) => t.id));
  const near = new Set([pid, ...taskIds]);
  // 둘째 고리: 프로젝트·과제와 바로 이어진 나머지
  const items = new Map<string, OObject>();
  for (const l of links) { const a = near.has(l.src), b = near.has(l.dst); if (a === b) continue; const o = byId.get(a ? l.dst : l.src); if (o && o.type !== 'project' && o.type !== 'task') items.set(o.id, o); }
  const nodes: MNode[] = [];
  const pr = 26;
  const plabel = trunc(p.name, 26); const pw = FONT_W(plabel, 15, 700);
  nodes.push({ id: pid, o: p, kind: 'project', x: 0, y: 0, r: pr, color, label: plabel, sub: ttf("과제 {0} · 이어진 것 {1}", tasks.length, items.size), anchor: 'middle', lx: 0, ly: pr + 20, rect: [-Math.max(pw, 120) / 2 - 2, pr + 6, Math.max(pw, 120) / 2 + 2, pr + 42] });
  // 과제: 오른쪽·왼쪽 호에 번갈아. 세로 간격을 고정해 같은 쪽 라벨끼리 겹치지 않게
  const right = tasks.filter((_, i) => i % 2 === 0), left = tasks.filter((_, i) => i % 2 === 1);
  const GAP = 24; const half = Math.max(right.length, left.length);
  const ymax = Math.max(60, ((half - 1) * GAP) / 2);
  const R = Math.max(210, ymax / Math.sin((68 * Math.PI) / 180));
  const placeSide = (arr: OObject[], side: 1 | -1) => arr.forEach((t, i) => {
    const y = -((arr.length - 1) * GAP) / 2 + i * GAP;
    const x = side * Math.sqrt(Math.max(0, R * R - y * y));
    const stalled = t.visual === 'stall' || t.visual === 'stall2';
    const label = trunc(t.name, 22); const badge = stalled ? t.badge ?? null : null;
    const r = 5 + 3 * Math.min(1, t.mentions / 14);
    const tw = FONT_W(label + (badge ? ` ${badge}` : ''), 11.5, 500);
    const lx = x + side * (r + 7);
    nodes.push({ id: t.id, o: t, kind: 'task', x, y, r, color, label, badge, badgeColor: t.visual === 'stall' ? '#D08A66' : '#D3B060', anchor: side === 1 ? 'start' : 'end', lx, ly: y + 4,
      rect: side === 1 ? [lx - 1, y - 8, lx + tw + 1, y + 8] : [lx - tw - 1, y - 8, lx + 1, y + 8] });
  });
  placeSide(right, 1); placeSide(left, -1);
  // 둘째 고리: 위(도구·결정·사람…) / 아래(주제·나머지) 줄. 많은 무리는 상위만 + "+n" 칩
  const groups = new Map<ObjectType, OObject[]>();
  for (const o of items.values()) (groups.get(o.type) ?? groups.set(o.type, []).get(o.type)!).push(o);
  type Chip = { o: OObject; more?: { type: ObjectType; n: number }; label: string; w: number };
  const chipsFor = (t: ObjectType): Chip[] => {
    const arr = (groups.get(t) ?? []).sort((a, b) => b.mentions - a.mentions);
    const cap = expanded.has(t) ? Infinity : t === 'tool' ? 10 : GROUP_CAP;
    const shown = arr.slice(0, cap);
    const out: Chip[] = shown.map((o) => { const label = trunc(t === 'topic' ? `#${o.name}` : o.name, 18); return { o, label, w: 14 + FONT_W(label, 11, 500) }; });
    if (arr.length > shown.length) { const label = `${TYPE_LABEL[t]} +${arr.length - shown.length}`; out.push({ o: { ...arr[0]!, id: `more:${t}`, name: label }, more: { type: t, n: arr.length - shown.length }, label, w: 20 + FONT_W(label, 11, 600) }); }
    return out;
  };
  const top = GROUP_ORDER.filter((t) => t !== 'topic' && t !== 'artifact').flatMap(chipsFor);
  const bottom = (['topic', 'artifact'] as ObjectType[]).flatMap(chipsFor);
  const maxRow = Math.max(560, 2 * R + 120);
  const rowsOf = (cs: Chip[]) => { const rows: Chip[][] = [[]]; let w = 0; for (const c of cs) { if (w + c.w > maxRow && rows[rows.length - 1]!.length) { rows.push([]); w = 0; } rows[rows.length - 1]!.push(c); w += c.w + 18; } return rows.filter((r) => r.length); };
  const yTop = -ymax - 54, yBot = Math.max(ymax, pr + 42) + 54;
  const lay = (rows: Chip[][], y0: number, dir: 1 | -1) => rows.forEach((row, ri) => {
    const tot = row.reduce((s, c) => s + c.w, 0) + 18 * (row.length - 1); let x = -tot / 2; const y = y0 + dir * ri * 28;
    for (const c of row) {
      const r = c.more ? 0 : 4.5; const cx = x + 5;
      nodes.push({ id: c.o.id, o: c.o, kind: c.more ? 'more' : 'item', x: cx, y, r, color: TINT[c.o.type] ?? '#6E6E6B', label: c.label, anchor: 'start', lx: c.more ? x + 8 : cx + 9, ly: y + 4, rect: [x - 2, y - 10, x + c.w + 2, y + 10], more: c.more });
      x += c.w + 18;
    }
  });
  const topRows = rowsOf(top); lay(topRows.reverse(), yTop, -1); // 가까운 줄이 가운데 쪽
  lay(rowsOf(bottom), yBot, 1);
  const shown = new Set(nodes.map((n) => n.id));
  const edges: MEdge[] = [];
  for (const l of links) {
    if (!shown.has(l.src) || !shown.has(l.dst)) continue;
    edges.push({ id: l.id, a: l.src, b: l.dst, w: 1, norm: l.type === 'part_of' ? 0.3 : 0.6, kind: 'link', type: l.type, suggested: l.status === 'suggested' });
  }
  return { nodes, edges, bbox: bboxOf(nodes.map((n): Rect => [Math.min(n.rect[0], n.x - n.r), Math.min(n.rect[1], n.y - n.r), Math.max(n.rect[2], n.x + n.r), Math.max(n.rect[3], n.y + n.r)])) };
}
const TYPE_LABEL: Partial<Record<ObjectType, string>> = { tool: tt("도구"), decision: tt("결정"), topic: tt("주제"), person: tt("사람"), organization: tt("조직"), place: tt("장소"), artifact: tt("자료") };
const TINT: Partial<Record<ObjectType, string>> = { tool: '#7F9CC4', decision: '#EDEDEB', topic: '#8A8A85', person: '#D3B060', organization: '#B293AE', place: '#8FB59A', artifact: '#C4C2BC' };
