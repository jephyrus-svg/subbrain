import { tt, ttf } from '../../i18n';
import type { ReactNode } from 'react';
import { TypeGlyph } from '../../ontology/Glyph';
import { LINK_META, TYPE_META, type OGraph, type OLink, type OObject } from '../../ontology/model';

/** 객체 이름 칩: 표식 + 이름 (누르면 선택) */
export function ObjRef({ o, onSelect, sub }: { o: OObject | undefined; onSelect?: (id: string) => void; sub?: ReactNode }) {
  if (!o) return <span className="oref">{tt("알 수 없음")}</span>;
  return (
    <button className="oref" onClick={(e) => { e.stopPropagation(); onSelect?.(o.id); }} title={ttf("{0} · 그래프에서 선택", TYPE_META[o.type].label)}>
      <TypeGlyph type={o.type} o={o} size={16} /><span>{o.name}</span>{sub}
    </button>
  );
}

/** "과제 → 막혔음 → 과제" 경로 표시줄 */
export function PathLine({ start, links, g, onSelect }: { start: string; links: OLink[]; g: OGraph; onSelect?: (id: string) => void }) {
  const out: ReactNode[] = [<ObjRef key="s" o={g.byId.get(start)} onSelect={onSelect} />];
  let cur = start;
  links.forEach((l, i) => {
    const fwd = l.src === cur; const next = fwd ? l.dst : l.src; const m = LINK_META[l.type];
    out.push(<span key={`l${i}`} className={`orel${l.status === 'suggested' ? ' sug' : ''}`} style={{ color: m.color }}>{fwd || !m.directed ? '' : '←'}{m.label}{fwd && m.directed ? '→' : ''}</span>);
    out.push(<ObjRef key={`o${i}`} o={g.byId.get(next)} onSelect={onSelect} />);
    cur = next;
  });
  return <div className="opath">{out}</div>;
}

export const pct = (c: number) => c.toFixed(2);
