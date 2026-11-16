import { tt, ttf } from '../../i18n';
// 2D 지도에서 펼친 프로젝트의 오른쪽 패널: 과제·주요 결정·도구 카드. 카드를 누르면 지도에서 그 객체를 밝힌다.
import { useEffect, useMemo, useRef } from 'react';
import { owners } from '../../ontology/map2dLayout';
import type { OData, OLink, OObject } from '../../ontology/model';

const VIS: Record<string, [string, string]> = { run: [tt("진행 중"), '#8FB59A'], stall: [tt("멈춤"), '#D08A66'], stall2: [tt("느려짐"), '#D3B060'], done: [tt("끝남"), '#6E6E6B'], quick: [tt("짧은 일"), '#8A8A85'], archived: [tt("보관"), '#4A4A48'] };
const md = (d: string) => (d ? ttf("{0}월 {1}일", Number(d.slice(5, 7)), Number(d.slice(8, 10))) : '');

export function ProjectCards({ data, links, projectId, pick, onPick, onDetail, onBack }: {
  data: OData; links: OLink[]; projectId: string; pick: string | null; onPick: (id: string | null) => void; onDetail: (id: string) => void; onBack: () => void;
}) {
  const { p, tasks, decisions, tools, rest } = useMemo(() => {
    const { own, byId } = owners(data, links);
    const p = byId.get(projectId)!;
    const tasks = data.objects.filter((o) => o.type === 'task' && own.get(o.id)?.has(projectId)).sort((a, b) => b.last.localeCompare(a.last));
    const near = new Set([projectId, ...tasks.map((t) => t.id)]); const items = new Map<string, OObject>();
    for (const l of links) { const a = near.has(l.src), b = near.has(l.dst); if (a === b) continue; const o = byId.get(a ? l.dst : l.src); if (o && o.type !== 'project' && o.type !== 'task') items.set(o.id, o); }
    const all = [...items.values()].sort((a, b) => b.mentions - a.mentions);
    return { p, tasks, decisions: all.filter((o) => o.type === 'decision'), tools: all.filter((o) => o.type === 'tool'), rest: all.filter((o) => o.type !== 'decision' && o.type !== 'tool') };
  }, [data, links, projectId]);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (pick) root.current?.querySelector(`[data-card="${CSS.escape(pick)}"]`)?.scrollIntoView({ block: 'nearest' }); }, [pick]);
  if (!p) return null;
  const card = (o: OObject, dot: string, sub: string, badge?: [string, string] | null) => (
    <button key={o.id} data-card={o.id} className={`pcard${pick === o.id ? ' on' : ''}`} onClick={() => onPick(pick === o.id ? null : o.id)} onDoubleClick={() => onDetail(o.id)}>
      <i className="dot" style={{ background: dot }} />
      <span><div className="nm">{o.name}</div><div className="sm">{sub}</div></span>
      {badge && <span className="bd" style={{ color: badge[1] }}>{badge[0]}</span>}
    </button>
  );
  const stalled = tasks.filter((t) => t.visual === 'stall' || t.visual === 'stall2').length;
  return (
    <div className="pcards" ref={root}>
      <button className="lnk" onClick={onBack}>{tt("← 전체 지도")}</button>
      <h2><i className="dot" style={{ width: 10, height: 10, borderRadius: '50%', background: p.color ?? '#A3A3A0', display: 'inline-block' }} />{p.name}</h2>
      <div className="meta">{tt("과제")} {tasks.length}{stalled ? ttf(" · 막힘 {0}", stalled) : ''} {tt("· 결정")} {decisions.length} {tt("· 도구")} {tools.length} {tt("· 마지막")} {md(p.last)}</div>
      <div className="sec"><span>{tt("과제")}</span><span>{tasks.length}</span></div>
      {tasks.map((t) => { const v = VIS[t.visual ?? ''] ?? ['', '#8A8A85']; return card(t, v[1], ttf("{0}{1} – {2} · 언급 {3}", v[0] ? `${v[0]} · ` : '', md(t.first), md(t.last), t.mentions), t.badge ? [t.badge, v[1]] : null); })}
      {decisions.length > 0 && <><div className="sec"><span>{tt("주요 결정")}</span><span>{decisions.length}</span></div>{decisions.slice(0, 12).map((o) => card(o, '#EDEDEB', ttf("{0} · 언급 {1}", md(o.last), o.mentions)))}</>}
      {tools.length > 0 && <><div className="sec"><span>{tt("도구")}</span><span>{tools.length}</span></div>{tools.map((o) => card(o, '#7F9CC4', ttf("언급 {0}", o.mentions)))}</>}
      {rest.length > 0 && <><div className="sec"><span>{tt("그 밖에")}</span><span>{rest.length}</span></div>{rest.slice(0, 12).map((o) => card(o, '#6E6E6B', ttf("{0} · 언급 {1}", o.type === 'topic' ? tt("주제") : '', o.mentions)))}</>}
      {pick && <p style={{ marginTop: 14 }}><button className="lnk" onClick={() => onDetail(pick)}>{tt("고른 객체 자세히 (질문·근거) →")}</button></p>}
      <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 10 }}>{tt("카드를 누르면 지도에서 밝혀요 · Esc로 전체 지도")}</p>
    </div>
  );
}
