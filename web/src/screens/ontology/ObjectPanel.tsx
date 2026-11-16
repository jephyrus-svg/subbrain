import { tt, ttf } from '../../i18n';
// 온톨로지 모드 오른쪽 패널: 객체 상세 (설계서 10.11) + 아무것도 고르지 않았을 때의 한눈에 보기
import { useEffect, useMemo, useState } from 'react';
import type { ImpactResponse, ObjectDetail, SimilarResponse, WhyStalledResponse } from '@subbrain/shared';
import { api } from '../../api/endpoints';
import { dataMode } from '../../api/client';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icons';
import { AiMark } from '../../components/Marks';
import { useToast } from '../../components/Toast';
import { aiLabel, monthDay } from '../../lib/format';
import { TypeGlyph } from '../../ontology/Glyph';
import { LINK_META, LINK_TYPES, TYPE_META, weeklyMentions, type LinkType, type OGraph, type OLink, type OObject } from '../../ontology/model';
import type { Question } from '../Ontology';
import { ObjRef, PathLine, pct } from './common';

interface Props {
  id: string; g: OGraph; today: string; q: Question | null; pathTo: string | null; pathLinks: OLink[] | null; pendingFor: number;
  onQuestion: (q: Question) => void; onSelect: (id: string) => void; onHover: (id: string | null) => void; onReview: () => void;
}

/** 라이브 모드에서만 코어에 묻는다(모의 모드는 화면 계산 그대로). 실패하면 null → 화면 계산으로 */
function useLive<T>(fn: (() => Promise<T>) | null, deps: unknown[]): T | null {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    setV(null);
    if (!fn || dataMode() !== 'live') return;
    let live = true; fn().then((x) => { if (live) setV(x); }, () => {});
    return () => { live = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

export function ObjectPanel({ id, g, today, q, pathTo, pathLinks, pendingFor, onQuestion, onSelect, onHover, onReview }: Props) {
  const nav = useNavigate();
  const toast = useToast();
  const o = g.byId.get(id)!;
  const rels = g.all(id);
  const weeks = useMemo(() => weeklyMentions(o, today), [o, today]);
  const mx = Math.max(1, ...weeks);

  // 관계 타입·방향별 묶음: "사용함 ← 과제 4개"
  const groups = useMemo(() => {
    const m = new Map<string, { type: LinkType; dir: 'out' | 'in'; items: OLink[] }>();
    for (const l of rels) {
      const dir = l.src === id ? 'out' : 'in'; const k = `${l.type}|${LINK_META[l.type].directed ? dir : 'out'}`;
      (m.get(k) ?? m.set(k, { type: l.type, dir: LINK_META[l.type].directed ? dir : 'out', items: [] }).get(k)!).items.push(l);
    }
    return [...m.values()].sort((a, b) => LINK_TYPES.indexOf(a.type) - LINK_TYPES.indexOf(b.type) || (a.dir === 'out' ? -1 : 1));
  }, [rels, id]);
  const byType = LINK_TYPES.map((t) => ({ t, n: rels.filter((l) => l.type === t).length })).filter((x) => x.n > 0);
  const maxT = Math.max(1, ...byType.map((x) => x.n));
  const notReal = () => toast.show(tt("이 동작은 아직 이 화면에서 못 해요 — 다음 작업에서 열려요"));
  const detail = useLive<ObjectDetail>(() => api.object(id), [id]);
  const evidence = detail ? detail.evidence : null;
  const sugg = o.status === 'suggested';
  const stalled = o.visual === 'stall' || o.visual === 'stall2';

  return (
    <div className="obody">
      <div className="ph">
        <span className="eyebrow">{tt("선택한 객체 ·")} {TYPE_META[o.type].label}</span>
        <div className="acts">
          {o.type === 'task' && o.ref && <button className="obs" onClick={() => nav(`/tasks/${encodeURIComponent(o.ref!)}`)}><Icon name="arrow" />{tt("과제 상세")}</button>}
          {o.type === 'project' && o.ref && <button className="obs" onClick={() => nav(`/?focus=${encodeURIComponent(o.ref!)}`)}><Icon name="graph" />{tt("과제 그래프에서 보기")}</button>}
        </div>
      </div>
      <h1 className="oh1"><TypeGlyph type={o.type} o={o} size={26} />{o.name}</h1>
      <div className="meta">
        {sugg ? <span className="warm">{tt("제안 · 확신도")} {pct(o.confidence)}</span> : <span className="ok"><Icon name="check" size={12} />{tt("확정")}</span>}
        {o.type === 'task' && stalled && <span className={o.visual === 'stall' ? 'late' : 'warm'}>{o.badge}{tt("째 멈춤")}</span>}
        <span>{tt("처음 언급")} {monthDay(o.first)}</span>
        <span>{tt("마지막")} {monthDay(o.last)}</span>
        <span>{tt("언급")} {o.mentions}{tt("회")}</span>
      </div>
      {o.aliases.length > 0 && <div className="alias"><span>{tt("다른 이름")}</span>{o.aliases.map((a) => <i key={a}>{a}</i>)}</div>}
      {Object.keys(o.props).length > 0 && (
        <dl className="facts ofacts">{Object.entries(o.props).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      )}

      <div className="two">
        <div className="spk">
          <div className="hd">{tt("주별 언급")} <b>{tt("최근 16주")}</b></div>
          <svg width="200" height="40" viewBox="0 0 200 40" role="img" aria-label={ttf("주별 언급: {0}", weeks.join(', '))}>
            {weeks.map((c, i) => { const h = c ? 4 + (c / mx) * 32 : 1; return <rect key={i} x={i * 12.5 + 1} y={40 - h} width={10} height={h} rx={1} fill={c ? (o.color ?? TYPE_META[o.type].tint) : '#2C2C30'} opacity={c ? 0.8 : 1}><title>{ttf("{0}주 전 · {1}회", 16 - i, c)}</title></rect>; })}
          </svg>
          <div className="ax"><span>{tt("6월")}</span><span>{tt("7월")}</span><span>{tt("8월")}</span><span>{tt("9월")}</span></div>
        </div>
        <div>
          <div className="hd">{tt("관계")} <b>{rels.length}{tt("개")}</b></div>
          <div className="per oper">
            {byType.slice(0, 5).map((x) => <div key={x.t}><span>{LINK_META[x.t].label}</span><i className="b" style={{ width: `${Math.max(6, (x.n / maxT) * 100)}%`, background: LINK_META[x.t].color, opacity: 0.8 }} /><em>{x.n}</em></div>)}
          </div>
        </div>
      </div>

      <div className="oq" role="group" aria-label={tt("질문")}>
        <span className="hd">{tt("물어보기")}</span>
        <button className={`btn${q === 'why' ? ' pri' : ''}`} onClick={() => onQuestion('why')} title={tt("막힘 사슬(blocked_by)을 끝까지 따라가요")}>{tt("왜 멈췄나")}</button>
        <button className={`btn${q === 'similar' ? ' pri' : ''}`} onClick={() => onQuestion('similar')} title={tt("같은 도구·주제·조직을 쓴 다른 과제")}>{tt("비슷한 옛 작업")}</button>
        <button className={`btn${q === 'impact' ? ' pri' : ''}`} onClick={() => onQuestion('impact')} title={tt("이게 바뀌면 흔들리는 것")}>{tt("영향 범위")}</button>
      </div>
      {q && <Answer q={q} o={o} g={g} onSelect={onSelect} onHover={onHover} />}

      {pathTo && pathLinks && (
        <div className="next oans">
          <div className="hd">{tt("경로 ·")} {g.byId.get(pathTo)?.name}{tt("까지")}</div>
          {pathLinks.length ? <PathLine start={id} links={pathLinks} g={g} onSelect={onSelect} /> : <p className="om">{tt("4단계 안에 이어지는 확정된 관계가 없어요.")}</p>}
        </div>
      )}
      {!pathTo && !q && <p className="otip">{tt("다른 객체를")} <b>{tt("Shift+클릭")}</b>{tt("하면 두 객체 사이 가장 짧은 관계 경로를 보여줘요.")}</p>}

      <section className="tsec orels">
        <div className="hd"><span>{tt("관계")} <b>{rels.length}</b> {tt("· 종류별")}</span><span>{tt("확신도 · 출처")}</span></div>
        {groups.map((gr) => {
          const m = LINK_META[gr.type];
          const kinds = [...new Set(gr.items.map((l) => TYPE_META[g.byId.get(g.other(l, id))?.type ?? 'topic'].short))];
          return (
            <div key={`${gr.type}${gr.dir}`} className="rg2">
              <div className="rgh"><i style={{ background: m.color }} /><b style={{ color: m.color }}>{m.label}</b> {m.directed ? (gr.dir === 'out' ? '→' : '←') : '↔'} {kinds.join('·')} {gr.items.length}{tt("개")}</div>
              {gr.items.map((l) => {
                const other = g.byId.get(g.other(l, id));
                return (
                  <div key={l.id} className={`rrel${l.status === 'suggested' ? ' sug' : ''}${l.ended ? ' ended' : ''}`} onMouseEnter={() => onHover(other?.id ?? null)} onMouseLeave={() => onHover(null)}>
                    <ObjRef o={other} onSelect={onSelect} sub={other?.type === 'task' && (other.visual === 'stall' || other.visual === 'stall2') ? <b className={other.visual === 'stall' ? 'late' : 'warm'}>{other.badge}</b> : null} />
                    <span className="rtag">{l.status === 'suggested' ? tt("제안") : l.ended ? ttf("{0} 끝남", monthDay(l.ended)) : ''}</span>
                    <span className="rconf">{pct(l.conf)} · {l.n}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
        {pendingFor > 0 && <button className="pmore" onClick={onReview}>{tt("이 객체에 걸린 제안")} {pendingFor}{tt("건 검토하기 →")}</button>}
      </section>

      <section className="tsec osrc">
        <div className="hd"><span>{tt("출처")} <b>{detail ? detail.evidenceTotal : o.src.length}</b> {tt("· 대화 속 발췌")}</span><span>{o.src.length ? ttf("{0}까지", monthDay(o.src[o.src.length - 1]![1])) : ''}</span></div>
        {evidence ? evidence.slice(0, 12).map((e) => (
          <div key={e.id} className="src">
            <div className="sh"><AiMark ai={e.sourceAi} /><b>{e.conversationTitle}</b><span>{aiLabel(e.sourceAi)} · {monthDay(e.at)}</span></div>
            <blockquote>“{e.excerpt}”</blockquote>
            <button className="lnk sl" onClick={() => nav(`/conversations/${encodeURIComponent(e.conversationId)}`)}>{tt("원래 대화 열기")}</button>
          </div>
        )) : o.src.map((e, i) => (
          <div key={i} className="src">
            <div className="sh"><AiMark ai={e[0]} /><b>{e[2]}</b><span>{aiLabel(e[0])} · {monthDay(e[1])}</span></div>
            <blockquote>“{e[3]}”</blockquote>
          </div>
        ))}
        {(detail ? detail.evidenceTotal : o.src.length) === 0 && <p className="om">{tt("아직 근거 발췌가 없어요.")}</p>}
      </section>

      <div className="actions">
        {sugg && <button className="btn pri" onClick={onReview}><Icon name="check" />{tt("제안 검토로")}</button>}
        <button className="btn" onClick={notReal}>{tt("합치기…")}</button>
        <button className="btn" onClick={notReal}>{tt("나누기")}</button>
        <button className="btn" onClick={notReal}>{tt("이름 바꾸기")}</button>
        <button className="btn ghost" onClick={notReal}>{tt("관계 끊기")}</button>
        {o.type === 'person' && <button className="btn ghost" onClick={notReal}>{tt("완전 삭제")}</button>}
      </div>
    </div>
  );
}

function Answer({ q, o, g, onSelect, onHover }: { q: Question; o: OObject; g: OGraph; onSelect: (id: string) => void; onHover: (id: string | null) => void }) {
  const nav = useNavigate();
  const why = useLive<WhyStalledResponse>(q === 'why' && o.type === 'task' && o.ref ? () => api.whyStalled(o.ref!) : null, [q, o.id]);
  const imp = useLive<ImpactResponse>(q === 'impact' ? () => api.impact(o.id) : null, [q, o.id]);
  const sim = useLive<SimilarResponse>(q === 'similar' ? () => api.similar(o.name) : null, [q, o.id]);
  if (q === 'why' && why && (why.chain.length || why.suggested.length || why.ended.length)) {
    const chainLinks = why.chain.map((c) => g.links.find((l) => l.id === c.link.id)).filter((l): l is OLink => !!l);
    return (
      <div className="next oans">
        <div className="hd">{tt("왜 멈췄나 · 막힘 사슬")} {why.chain.length ? ttf("{0}단계", Math.max(...why.chain.map((c) => c.depth))) : tt("없음")}</div>
        {chainLinks.length === why.chain.length && chainLinks.length > 0 && <PathLine start={o.id} links={chainLinks} g={g} onSelect={onSelect} />}
        <p className="om">{why.explanation}</p>
        {why.rootCauses.length > 0 && <p className="om">{tt("끝에 있는 원인:")} {why.rootCauses.map((c) => <b key={c.object.id} style={{ marginRight: 6 }}>{c.label}</b>)}</p>}
        {why.suggested.length > 0 && <p className="om">{tt("확인 안 된 막힘 제안")} {why.suggested.length}{tt("건")} <span className="dim">{tt("(점선)")}</span></p>}
        {why.ended.length > 0 && <p className="om dim">{tt("이미 풀린 막힘")} {why.ended.length}{tt("건")}</p>}
        {why.lastConversation && <button className="lnk sl" onClick={() => nav(`/conversations/${encodeURIComponent(why.lastConversation!.id)}`)}>{tt("마지막 관련 대화:")} {why.lastConversation.title}</button>}
      </div>
    );
  }
  if (q === 'impact' && imp) {
    return (
      <div className="next oans ok2">
        <div className="hd">{tt("영향 범위 ·")} {imp.affected.length}{tt("개")}</div>
        {imp.affected.length ? <ul className="olist">{imp.affected.slice(0, 10).map((x) => (
          <li key={x.object.id} onMouseEnter={() => onHover(x.object.id)} onMouseLeave={() => onHover(null)}>
            <span className="dep">{ttf("{0}단계", x.depth)}</span><ObjRef o={g.byId.get(x.object.id)} onSelect={onSelect} /><span className="via" style={{ color: LINK_META[x.via[0] ?? 'related_to'].color }}>{x.via.map((t) => LINK_META[t]?.label ?? t).join('·')}</span>
            {x.superseded && <span className="dim">{tt("대체된 결정")}</span>}
          </li>
        ))}</ul> : <p className="om">{tt("이 객체에 기대는 것이 아직 없어요.")}</p>}
      </div>
    );
  }
  if (q === 'similar' && sim) {
    return (
      <div className="next oans sim">
        <div className="hd">{tt("비슷한 옛 작업 · 겹치는 객체 순")}</div>
        {sim.items.length ? <ul className="olist">{sim.items.map((x) => (
          <li key={x.task.id}>
            <button className="oref" onClick={() => nav(`/tasks/${encodeURIComponent(x.task.id)}`)}><TypeGlyph type="task" size={16} /><span>{x.task.title}</span>{x.completedAt && <span className="dim">{tt("완료")}</span>}</button>
            <span className="via">{x.sharedObjects.map((s) => s.label).join(', ') || ttf("유사도 {0}", x.score.toFixed(2))}</span>
          </li>
        ))}</ul> : <p className="om">{tt("겹치는 도구·주제·자료가 있는 다른 과제가 없어요.")}</p>}
      </div>
    );
  }
  if (q === 'why') {
    const r = g.whyStalled(o.id);
    const end = r.chain.length ? g.byId.get(r.chain[r.chain.length - 1]!.link.dst) : undefined;
    return (
      <div className="next oans">
        <div className="hd">{tt("왜 멈췄나 · 막힘 사슬")} {r.chain.length ? ttf("{0}단계", Math.max(...r.chain.map((c) => c.depth))) : tt("없음")}</div>
        {r.chain.length ? <>
          <PathLine start={o.id} links={r.chain.map((c) => c.link)} g={g} onSelect={onSelect} />
          <p className="om">{tt("끝에 있는 원인:")} <b>{end?.name}</b> ({TYPE_META[end?.type ?? 'topic'].label}){end?.type === 'person' ? tt(" — 답을 기다리는 중") : end?.type === 'organization' ? tt(" — 바깥 일정 대기") : end?.type === 'task' ? ` — ${end.visual === 'done' ? tt("이미 끝남") : tt("아직 진행 전")}` : ''}</p>
          {(() => { const ev = r.chain[0]!.link.ev; return ev ? <div className="why">{tt("근거:")} {aiLabel(ev[0])} · {monthDay(ev[1])} “{ev[3]}”</div> : null; })()}
        </> : <p className="om">{tt("확정된 막힘 관계가 없어요")}{o.type === 'task' && o.visual !== 'done' ? ttf(" — 마지막 대화가 {0}이라 그냥 손을 놓은 것일 수 있어요.", monthDay(o.last)) : '.'}</p>}
        {r.pending.length > 0 && <p className="om">{tt("확인 안 된 막힘 제안")} {r.pending.length}{tt("건:")} {r.pending.map((l) => g.byId.get(l.dst)?.name).join(', ')} <span className="dim">{tt("(점선)")}</span></p>}
        {r.ended.length > 0 && <p className="om dim">{tt("이미 풀린 막힘:")} {r.ended.map((l) => `${g.byId.get(l.dst)?.name} (${monthDay(l.ended!)})`).join(', ')}</p>}
      </div>
    );
  }
  if (q === 'impact') {
    const r = g.impact(o.id);
    return (
      <div className="next oans ok2">
        <div className="hd">{tt("영향 범위 ·")} {r.length}{tt("개")}</div>
        {r.length ? <ul className="olist">{r.slice(0, 8).map((x) => (
          <li key={x.obj.id} onMouseEnter={() => onHover(x.obj.id)} onMouseLeave={() => onHover(null)}>
            <span className="dep">{ttf("{0}단계", x.depth)}</span><ObjRef o={x.obj} onSelect={onSelect} /><span className="via" style={{ color: LINK_META[x.link.type].color }}>{LINK_META[x.link.type].label}</span>
            {x.obj.props['유효']?.startsWith('대체') && <span className="dim">{tt("대체된 결정")}</span>}
          </li>
        ))}</ul> : <p className="om">{tt("이 객체에 기대는 것이 아직 없어요.")}</p>}
      </div>
    );
  }
  const r = g.similar(o.id);
  return (
    <div className="next oans sim">
      <div className="hd">{tt("비슷한 옛 작업 · 겹치는 객체 순")}</div>
      {r.length ? <ul className="olist">{r.map((x) => (
        <li key={x.obj.id} onMouseEnter={() => onHover(x.obj.id)} onMouseLeave={() => onHover(null)}>
          <ObjRef o={x.obj} onSelect={onSelect} sub={x.obj.visual === 'done' ? <span className="dim">{tt("완료")}</span> : null} />
          <span className="via">{x.shared.map((s) => s.name).join(', ')}</span>
        </li>
      ))}</ul> : <p className="om">{tt("겹치는 도구·주제·자료가 있는 다른 과제가 없어요.")}</p>}
    </div>
  );
}

/** 아무것도 고르지 않았을 때: 멈춤의 원인, 많이 이어진 것, 최근 바뀐 관계 */
export function Overview({ g, pending, onSelect, onWhy, onReview, onHover }: { g: OGraph; pending: number; onSelect: (id: string) => void; onWhy: (id: string) => void; onReview: () => void; onHover: (id: string | null) => void }) {
  const stalled = g.d.objects.filter((o) => o.type === 'task').map((o) => ({ o, r: g.whyStalled(o.id) })).filter((x) => x.r.chain.length > 0)
    .sort((a, b) => parseInt(b.o.badge ?? '0') - parseInt(a.o.badge ?? '0'));
  const hubs = g.d.objects.filter((o) => o.type !== 'project' && o.type !== 'task' && o.status === 'accepted').map((o) => ({ o, n: g.all(o.id).length })).sort((a, b) => b.n - a.n).slice(0, 6);
  const changed = g.links.filter((l) => l.ended || l.type === 'supersedes').sort((a, b) => (b.ended ?? '9').localeCompare(a.ended ?? '9'));
  return (
    <div className="obody">
      <div className="ph"><span className="eyebrow">{tt("온톨로지 한눈에")}</span></div>
      <h1>{tt("무엇이 무엇에 걸려 있나")}</h1>
      <ObjectSearch g={g} onSelect={onSelect} onHover={onHover} />
      <p className="sum">{tt("대화에서 뽑은 사람·도구·결정·자료를 객체로, 그 사이를 관계로 이었어요. 객체를 누르면 이웃만 밝게, 다른 객체를 Shift+클릭하면 둘 사이 경로를 보여줘요.")}</p>

      {pending > 0 && (
        <div className="next orev" onClick={onReview} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onReview()}>
          <div className="hd">{tt("연결 제안 검토")}</div>
          <p>{tt("확신도가 낮은 연결")} {pending}{tt("건이 확인을 기다려요")}</p>
          <div className="why">{tt("그래프에서는 흐린 긴 점선으로 보여요. 한 번 눌러 확정하거나 거절해요.")}</div>
          <div className="row"><button className="btn pri" onClick={(e) => { e.stopPropagation(); onReview(); }}><Icon name="check" />{tt("검토하기")}</button></div>
        </div>
      )}

      <section className="tsec">
        <div className="hd"><span>{tt("멈춤의 원인")} <b>{stalled.length}</b> {tt("· 막힘 사슬")}</span><span>{tt("멈춘 기간")}</span></div>
        {stalled.map(({ o, r }) => (
          <div key={o.id} className="ostall" onClick={() => onWhy(o.id)} onMouseEnter={() => onHover(o.id)} onMouseLeave={() => onHover(null)} title={tt("왜 멈췄나 보기")}>
            <div className="osc">
              <ObjRef o={o} onSelect={onSelect} />
              <div className="ochain">{r.chain.map((c) => { const t = g.byId.get(c.link.dst); return <span key={c.link.id}><em>{tt("막혔음 →")}</em><button onClick={(e) => { e.stopPropagation(); if (t) onSelect(t.id); }}>{t?.name}</button></span>; })}</div>
            </div>
            <span className={o.visual === 'stall' ? 'late' : 'warm'}>{o.badge}</span>
          </div>
        ))}
      </section>

      <section className="tsec">
        <div className="hd"><span>{tt("많이 이어진 것")}</span><span>{tt("관계 · 언급")}</span></div>
        <div className="ohubs">
          {hubs.map(({ o, n }) => (
            <div key={o.id} className="rrel" onMouseEnter={() => onHover(o.id)} onMouseLeave={() => onHover(null)}>
              <ObjRef o={o} onSelect={onSelect} /><span className="rtag">{TYPE_META[o.type].label}</span><span className="rconf">{n} · {o.mentions}{tt("회")}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="tsec">
        <div className="hd"><span>{tt("최근 바뀐 관계")}</span><span>{tt("날짜")}</span></div>
        {changed.map((l) => (
          <div key={l.id} className={`rrel${l.status === 'suggested' ? ' sug' : ''}`}>
            <span className="chg"><ObjRef o={g.byId.get(l.src)} onSelect={onSelect} /><span className="orel" style={{ color: LINK_META[l.type].color }}>{LINK_META[l.type].label}→</span><ObjRef o={g.byId.get(l.dst)} onSelect={onSelect} /></span>
            <span className="rtag">{l.status === 'suggested' ? tt("제안") : l.ended ? tt("끝남") : tt("대체")}</span>
            <span className="rconf">{l.ended ? monthDay(l.ended) : '—'}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

/** 객체 찾기: GET /objects?q= (이름·다른 이름). 그래프에 없는 객체는 흐리게 */
function ObjectSearch({ g, onSelect, onHover }: { g: OGraph; onSelect: (id: string) => void; onHover: (id: string | null) => void }) {
  const [text, setText] = useState('');
  const [items, setItems] = useState<OObject[] | null>(null);
  useEffect(() => {
    const t = text.trim(); if (!t) { setItems(null); return; }
    let live = true;
    const h = setTimeout(() => {
      api.objects({ q: t, limit: 8 }).then((r) => { if (live) setItems(r.items.map((x) => g.byId.get(x.id) ?? { id: x.id, type: x.type, name: x.name, aliases: x.aliases, status: 'accepted', confidence: 1, first: '', last: '', mentions: x.mentionCount, props: {}, src: [] } as OObject)); }, () => { if (live) setItems([]); });
    }, 220);
    return () => { live = false; clearTimeout(h); };
  }, [text, g]);
  return (
    <div className="osearch">
      <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={tt("객체 찾기 — 이름이나 다른 이름")} aria-label={tt("객체 찾기")} />
      {items && (items.length ? <ul className="olist">{items.map((o) => (
        <li key={o.id} onMouseEnter={() => onHover(o.id)} onMouseLeave={() => onHover(null)} className={g.byId.has(o.id) ? '' : 'dim'}>
          <ObjRef o={o} onSelect={g.byId.has(o.id) ? onSelect : undefined} /><span className="via">{TYPE_META[o.type].label} · {o.mentions}{tt("회")}</span>
        </li>
      ))}</ul> : <p className="om">{tt("찾는 객체가 없어요.")}</p>)}
    </div>
  );
}
