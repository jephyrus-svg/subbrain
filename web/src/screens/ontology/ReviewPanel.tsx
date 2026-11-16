import { tt, ttf } from '../../i18n';
// 연결 제안 검토 (설계서 8.6 확신도 기준 · 10.11 제안 검토 대기열) — 1.7.0: 확정·거절·한 번에 확정·되돌리기는 코어에 저장
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icons';
import { AiMark } from '../../components/Marks';
import { useToast } from '../../components/Toast';
import { aiLabel, monthDay } from '../../lib/format';
import { LINK_META, TYPE_META, type OData, type OGraph, type OSuggestion, type Verdict } from '../../ontology/model';
import { ObjRef, pct } from './common';

interface Props {
  data: OData; base: OData; g: OGraph; verdicts: Record<string, Verdict>;
  onDecide: (s: OSuggestion, v: Verdict) => Promise<boolean>; onUndo: (id: string) => Promise<void>; onBulk: (ids: string[]) => Promise<void>;
  hl: string | null; onHighlight: (id: string | null) => void; onSelect: (id: string) => void;
}

export function ReviewPanel({ base, g, verdicts, onDecide, onUndo, onBulk, hl, onHighlight, onSelect }: Props) {
  const toast = useToast();
  const objs = useMemo(() => new Map(base.objects.map((o) => [o.id, o])), [base]);
  const rows = useMemo(() => base.suggestions.map((s) => {
    const l = s.link ? base.links.find((k) => k.id === s.link) : undefined;
    return { s, l, conf: s.conf ?? l?.conf ?? 0.7, ev: l?.ev ?? s.ev };
  }).sort((a, b) => b.conf - a.conf), [base]);
  const open = rows.filter((r) => !verdicts[r.s.id] || verdicts[r.s.id] === 'later');
  const [cursor, setCursor] = useState<string | null>(hl ?? open[0]?.s.id ?? null);
  useEffect(() => { if (hl) setCursor(hl); }, [hl]);

  const decide = (s: OSuggestion, v: Verdict) => {
    const i = open.findIndex((r) => r.s.id === s.id); const nx = open[i + 1] ?? open[i - 1];
    if (v !== 'later') { setCursor(nx?.s.id ?? null); onHighlight(nx?.s.id ?? null); }
    void onDecide(s, v).then((ok) => {
      if (!ok || v === 'later') return;
      const msg = v === 'accepted' ? (s.kind === 'merge' ? tt("합쳤어요") : tt("확정했어요 — 그래프에 실선으로 보여요")) : tt("거절했어요 — 같은 연결은 다시 제안하지 않아요");
      toast.show(msg, { action: { label: tt("되돌리기"), run: () => void onUndo(s.id) } });
    });
  };

  // 키보드: Y 확정 · N 거절 · ↓/↑ 이동
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey) return;
      const i = open.findIndex((r) => r.s.id === cursor); const cur = open[i];
      if ((e.key === 'y' || e.key === 'Y') && cur) { e.preventDefault(); decide(cur.s, 'accepted'); }
      else if ((e.key === 'n' || e.key === 'N') && cur) { e.preventDefault(); decide(cur.s, 'rejected'); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); const nx = open[Math.max(0, Math.min(open.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (nx) { setCursor(nx.s.id); onHighlight(nx.s.id); }
      }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  const high = open.filter((r) => r.conf >= 0.75);
  const doneCount = rows.length - open.length;

  return (
    <div className="obody">
      <div className="ph">
        <span className="eyebrow">{tt("연결 제안 검토")}</span>
        <div className="acts okeys"><kbd>Y</kbd> {tt("확정")} <kbd>N</kbd> {tt("거절")} <kbd>↓</kbd> {tt("다음")}</div>
      </div>
      <h1>{open.length ? ttf("확인할 제안 {0}건", open.length) : tt("제안을 모두 확인했어요")}</h1>
      <p className="sum">{tt("AI가 대화에서 뽑았지만 확신도가 0.6–0.85라 바로 쓰지 않은 연결이에요. 확정하면 그래프에 실선으로 들어가고, 거절하면 같은 연결을 다시 제안하지 않아요.")}</p>
      <div className="rvbar">
        <button className="btn" disabled={!high.length} onClick={() => void onBulk(high.map((r) => r.s.id))}>
          <Icon name="check" />{tt("확신도 0.75 이상")} {high.length}{tt("건 모두 확정")}
        </button>
        {doneCount > 0 && <button className="btn ghost" onClick={() => { for (const r of rows) if (verdicts[r.s.id] === 'accepted' || verdicts[r.s.id] === 'rejected') void onUndo(r.s.id); onHighlight(null); }}>{tt("이번에 한 결정 모두 되돌리기")}</button>}
        <span className="rvsort">{tt("확신도 높은 순")}</span>
      </div>

      <div className="sugs">
        {rows.map(({ s, l, conf, ev }) => {
          const v = verdicts[s.id]; const decided = v === 'accepted' || v === 'rejected';
          const on = cursor === s.id && !decided;
          const select = () => { setCursor(s.id); onHighlight(s.id); };
          if (decided) return (
            <div key={s.id} className={`srow done ${v}`}>
              <Icon name={v === 'accepted' ? 'check' : 'close'} size={13} />
              <span className="sd">{v === 'accepted' ? tt("확정함") : tt("거절함")}</span>
              <span className="st2">{s.kind === 'merge' ? `${objs.get(s.a!)?.name} = ${objs.get(s.b!)?.name}` : s.kind === 'object' ? ttf("새 객체 {0}", objs.get(s.obj!)?.name ?? s.text ?? '') : l ? `${objs.get(l.src)?.name} —${LINK_META[l.type].label}→ ${objs.get(l.dst)?.name}` : s.text}</span>
              <button className="lnk" onClick={() => void onUndo(s.id)}>{tt("되돌리기")}</button>
            </div>
          );
          return (
            <div key={s.id} className={`srow${on ? ' on' : ''}${v === 'later' ? ' later' : ''}`} onClick={select}>
              {s.kind === 'merge' ? (
                <div className="sl1 merge">
                  <span className="kind">{tt("합치기")}</span>
                  <ObjRef o={g.byId.get(s.a!) ?? objs.get(s.a!)} onSelect={onSelect} />
                  <span className="eq">=</span>
                  <ObjRef o={g.byId.get(s.b!) ?? objs.get(s.b!)} onSelect={onSelect} />
                </div>
              ) : s.kind === 'object' ? (
                <div className="sl1">
                  <span className="kind">{tt("새")} {objs.get(s.obj!) ? TYPE_META[objs.get(s.obj!)!.type].short : tt("객체")}</span>
                  <ObjRef o={g.byId.get(s.obj!) ?? objs.get(s.obj!)} onSelect={onSelect} />
                </div>
              ) : l ? (
                <div className="sl1">
                  <span className="kind">{TYPE_META[objs.get(l.src)?.type ?? 'topic'].short}</span>
                  <ObjRef o={g.byId.get(l.src) ?? objs.get(l.src)} onSelect={onSelect} />
                  <span className="orel sug" style={{ color: LINK_META[l.type].color }}>—{LINK_META[l.type].label}→</span>
                  <ObjRef o={g.byId.get(l.dst) ?? objs.get(l.dst)} onSelect={onSelect} />
                </div>
              ) : <div className="sl1"><span className="st2">{s.text}</span></div>}
              <div className="sl2">
                <span className="cf"><i style={{ ['--w' as string]: `${Math.max(8, Math.min(100, Math.round(((conf - 0.6) / 0.25) * 100)))}%` }} />{tt("확신도")} {pct(conf)}</span>
                <span>{tt("근거")} {l?.n ?? 1}{tt("개")}</span>
                {s.note && <span className="nt">{s.note}</span>}
                {v === 'later' && <span className="nt">{tt("나중에 보기로 함")}</span>}
              </div>
              {ev && <div className="sq"><AiMark ai={ev[0]} /><span>“{ev[3]}”</span><small>{aiLabel(ev[0])} · {monthDay(ev[1])}{ev[2] ? ` · ${ev[2]}` : ''}</small></div>}
              <div className="sb">
                <button className="btn pri" onClick={(e) => { e.stopPropagation(); decide(s, 'accepted'); }}><Icon name="check" />{s.kind === 'merge' ? tt("합치기") : tt("확정")}</button>
                <button className="btn" onClick={(e) => { e.stopPropagation(); decide(s, 'rejected'); }}><Icon name="close" size={13} />{tt("거절")}</button>
                <button className="btn ghost" onClick={(e) => { e.stopPropagation(); decide(s, 'later'); }}>{tt("나중에")}</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
