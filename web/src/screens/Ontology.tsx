import { tt, ttf } from '../i18n';
// 온톨로지 모드 (설계서 10.11). 1.7.0: 데이터는 코어 GET /ontology(모의 모드는 공유 목 ontologyGraph), 제안 결정은 /suggestions/*,
// 되돌리기는 /ontology/events/:id/undo, 경로는 /graph/path(라이브), 질문은 패널에서 /tasks/:id/why-stalled · /objects/:id/impact · /similar.
// 주소: /ontology  ?focus=<객체> &to=<경로 끝> &q=why|similar|impact &tab=review &hl=<제안> &depth=1|2|all &hide=<타입,…> &lt=<관계,…> &once=1
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icons';
import { ModeSwitch } from '../components/ModeSwitch';
import { OntologyGraph, type Focus, type OGraphHandle } from '../ontology/OntologyGraph';
import { TypeGlyph } from '../ontology/Glyph';
import type { Box } from '../ontology/layout';
import { applyVerdicts, DEFAULT_LINK_TYPES, fromApi, LINK_META, LINK_TYPES, OBJECT_TYPES, OGraph, SUGGEST_DASH, TYPE_META, type LinkType, type ObjectType, type OLink, type Verdict } from '../ontology/model';
import { ObjectPanel, Overview } from './ontology/ObjectPanel';
import { ProjectCards } from './ontology/ProjectCards';
import { Map2D, type Map2DHandle } from '../ontology/OntologyMap2D';
import { owners } from '../ontology/map2dLayout';
import { ReviewPanel } from './ontology/ReviewPanel';
import { PathLine } from './ontology/common';
import type { OData, OSuggestion } from '../ontology/model';
import type { OntologyStatusResponse } from '@subbrain/shared';
import { api } from '../api/endpoints';
import { useApi } from '../api/useApi';
import { dataMode, errorText } from '../api/client';
import { useToast } from '../components/Toast';
import '../styles/home.css';
import '../styles/ontology.css';

let savedVerdicts: Record<string, Verdict> = {}; // 화면을 오가도 유지('나중에'는 서버에 보내지 않음)
const savedEvents = new Map<string, number>();   // 제안 id → 서버 이벤트 id(되돌리기용)
export type Question = 'why' | 'similar' | 'impact';
const RAIL_W = 160;
const LARGE = 300;                                   // 이보다 많으면 기본 필터를 켠다
const LARGE_HIDE: ObjectType[] = ['decision', 'topic']; // OBJECT_TYPES 순서

export default function Ontology() {
  const [rev, setRev] = useState(0);
  const src = useApi(() => api.ontology(), [rev]);
  const status = useApi(() => api.ontologyStatus(), [rev]);
  const base = useMemo(() => (src.data ? fromApi(src.data) : null), [src.data]);
  const reload = useCallback(() => setRev((r) => r + 1), []);
  if (!base) return (
    <div className="home onto"><main className="stage" aria-label={tt("관계 그래프")}>
      <div className="state" style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', textAlign: 'center', color: 'var(--ink3)' }}>
        {src.error ? <><b style={{ color: 'var(--ink2)' }}>{tt("관계 그래프를 불러오지 못했어요")}</b><span>{errorText(src.error)}</span><button className="btn" style={{ marginTop: 10, justifySelf: 'center' }} onClick={reload}>{tt("다시 시도")}</button></> : tt("관계 그래프를 불러오는 중…")}
      </div>
    </main></div>
  );
  return <OntologyView BASE={base} status={status.data} reload={reload} />;
}

function OntologyView({ BASE, status, reload }: { BASE: OData; status: OntologyStatusResponse | null; reload: () => void }) {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [verdicts, setVerdictsState] = useState<Record<string, Verdict>>(savedVerdicts);
  const setVerdicts = useCallback((f: (v: Record<string, Verdict>) => Record<string, Verdict>) => setVerdictsState((v) => (savedVerdicts = f(v))), []);
  const [rotate3d, setRotate3d] = useState(true);
  const [spin, setSpin] = useState(false);
  const [panelHover, setPanelHover] = useState<string | null>(null);
  const gref = useRef<OGraphHandle>(null);
  const mref = useRef<Map2DHandle>(null);

  const p = (k: string) => params.get(k);
  const setP = useCallback((patch: Record<string, string | null>) => {
    setParams((cur) => { const n = new URLSearchParams(cur); for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') n.delete(k); else n.set(k, v); } return n; }, { replace: true });
  }, [setParams]);

  const data = useMemo(() => applyVerdicts(BASE, verdicts), [BASE, verdicts]);
  // 객체가 많으면(>300) 기본으로 주제·결정 잎을 숨기고 '한 번만 언급된 것 숨기기'를 켠다. 주소 hide=none · once=0 으로 끈다.
  const large = data.objects.length > LARGE;
  const hideP = p('hide');
  const hidden = useMemo(() => new Set((hideP === null ? (large ? LARGE_HIDE.join(',') : '') : hideP === 'none' ? '' : hideP).split(',').filter(Boolean) as ObjectType[]), [hideP, large]);
  const linkOn = useMemo(() => new Set((p('lt') ? p('lt')!.split(',').filter(Boolean) : DEFAULT_LINK_TYPES) as LinkType[]), [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const once = p('once') === null ? large : p('once') === '1';
  const depth = (p('depth') ?? '1') as '1' | '2' | 'all';
  const tab = p('tab') === 'review' ? 'review' : 'object';
  const view3d = p('v') === '3d';
  const focusId = p('focus'); const pathTo = p('to'); const q = p('q') as Question | null; const hl = p('hl');

  // 보이는 객체·관계
  const baseVisible = useMemo(() => new Set(data.objects.filter((o) => o.status !== 'rejected' && !hidden.has(o.type) && (!once || o.mentions > 1 || o.type === 'project' || o.type === 'task')).map((o) => o.id)), [data, hidden, once]);
  // 고른 객체(와 경로 끝)는 늘 보이고, 고른 객체의 바로 이웃은 숨긴 종류여도 잠깐 보인다(잎 펼치기)
  const visibleObjs = useMemo(() => {
    const v = new Set(baseVisible); const alive = new Set(data.objects.filter((o) => o.status !== 'rejected').map((o) => o.id));
    for (const id of [focusId, pathTo]) if (id && alive.has(id)) v.add(id);
    if (focusId) for (const l of data.links) if (l.status !== 'rejected') { if (l.src === focusId && alive.has(l.dst)) v.add(l.dst); else if (l.dst === focusId && alive.has(l.src)) v.add(l.src); }
    return v;
  }, [data, baseVisible, focusId, pathTo]);
  const liveLinks = useMemo(() => data.links.filter((l) => l.status !== 'rejected' && visibleObjs.has(l.src) && visibleObjs.has(l.dst)), [data, visibleObjs]);
  const gAll = useMemo(() => new OGraph(data, data.links.filter((l) => l.status !== 'rejected' && data.objects.some((o) => o.id === l.src) && data.objects.some((o) => o.id === l.dst))), [data]);
  const filteredLinks = useMemo(() => liveLinks.filter((l) => linkOn.has(l.type)), [liveLinks, linkOn]);
  const gVis = useMemo(() => new OGraph(data, filteredLinks), [data, filteredLinks]);

  // ── 2D 지도: 펼친 프로젝트와 밝힌 객체 ──
  const mapLinks = useMemo(() => data.links.filter((l) => l.status !== 'rejected' && l.type !== 'related_to'), [data]);
  const own2d = useMemo(() => owners(data, mapLinks), [data, mapLinks]);
  const [pick, setPick] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const mapProject = useMemo(() => {
    if (view3d || !focusId) return null;
    const o = own2d.byId.get(focusId); if (!o) return null;
    if (o.type === 'project') return o.id;
    const ps = own2d.own.get(o.id); return ps && ps.size ? [...ps][0]! : null;
  }, [view3d, focusId, own2d]);
  useEffect(() => { setPick(focusId && mapProject && focusId !== mapProject ? focusId : null); setDetail(null); }, [mapProject]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = useMemo(() => data.suggestions.filter((s) => !verdicts[s.id] || verdicts[s.id] === 'later'), [data, verdicts]);
  const pendingLinks = useMemo(() => pending.map((s) => (s.link ? data.links.find((l) => l.id === s.link) : undefined)).filter((l): l is OLink => !!l && l.status === 'suggested'), [pending, data]);

  // 라이브: 두 객체 사이 경로는 코어 /graph/path(최대 4단계, 확정 관계 먼저). 실패하면 화면 계산으로
  const [serverPath, setServerPath] = useState<{ key: string; ids: string[] | null } | null>(null);
  useEffect(() => {
    if (!focusId || !pathTo || focusId === pathTo || dataMode() !== 'live') return;
    const key = `${focusId}>${pathTo}`; let live = true;
    api.graphPath(focusId, pathTo).then((r) => { if (live) setServerPath({ key, ids: r.found ? r.links.map((l) => l.id) : [] }); }, () => { if (live) setServerPath({ key, ids: null }); });
    return () => { live = false; };
  }, [focusId, pathTo]);

  // 제안 결정 → 코어(확정·거절), 되돌리기 → 이벤트 undo. '나중에'는 화면에만
  const decide = useCallback(async (s: OSuggestion, v: Verdict) => {
    setVerdicts((x) => ({ ...x, [s.id]: v }));
    if (v === 'later') return true;
    try {
      const r = v === 'accepted' ? await api.acceptSuggestion(s.id) : await api.rejectSuggestion(s.id);
      savedEvents.set(s.id, r.eventId);
      return true;
    } catch (e) {
      setVerdicts((x) => { const n = { ...x }; delete n[s.id]; return n; });
      toast.show(ttf("저장하지 못했어요: {0}", errorText(e)), { err: true });
      return false;
    }
  }, [setVerdicts, toast]);
  const undo = useCallback(async (sid: string) => {
    const ev = savedEvents.get(sid);
    try {
      if (ev !== undefined) await api.undoOntology(ev);
      savedEvents.delete(sid);
      setVerdicts((x) => { const n = { ...x }; delete n[sid]; return n; });
      reload();
    } catch (e) { toast.show(ttf("되돌리지 못했어요: {0}", errorText(e)), { err: true }); }
  }, [setVerdicts, reload, toast]);
  const bulk = useCallback(async (ids: string[]) => {
    try {
      const r = await api.bulkAcceptSuggestions({ ids });
      setVerdicts((x) => ({ ...x, ...Object.fromEntries(r.accepted.map((id) => [id, 'accepted' as Verdict])) }));
      toast.show(ttf("{0}건을 한 번에 확정했어요{1}", r.accepted.length, r.skipped.length ? ttf(" · {0}건은 하나씩 봐야 해요(사람 첫 등장·대체·합치기)", r.skipped.length) : ''));
      reload();
    } catch (e) { toast.show(ttf("확정하지 못했어요: {0}", errorText(e)), { err: true }); }
  }, [setVerdicts, reload, toast]);

  // 초점: 경로 > 질문 > 제안 검토 > 이웃
  const { focus, pathLinks, queryNote } = useMemo((): { focus: Focus | null; pathLinks: OLink[] | null; queryNote: string | null } => {
    if (focusId && pathTo && focusId !== pathTo) {
      const sp = serverPath?.key === `${focusId}>${pathTo}` && serverPath.ids ? serverPath.ids.map((id) => data.links.find((l) => l.id === id)).filter((l): l is OLink => !!l) : null;
      const path = sp && sp.length ? sp : gVis.path(focusId, pathTo);
      if (!path) return { focus: { nodes: new Set([focusId, pathTo]), links: new Set(), kind: 'path' }, pathLinks: [], queryNote: null };
      const nodes = new Set([focusId]); let cur = focusId; for (const l of path) { cur = l.src === cur ? l.dst : l.src; nodes.add(cur); }
      const ids = new Set(path.map((l) => l.id));
      return { focus: { nodes, links: ids, strong: ids, kind: 'path' }, pathLinks: path, queryNote: null };
    }
    if (focusId && q) {
      if (q === 'why') {
        const r = gAll.whyStalled(focusId);
        const ls = [...r.chain.map((c) => c.link), ...r.pending];
        return { focus: { nodes: new Set([focusId, ...ls.map((l) => l.dst)]), links: new Set(ls.map((l) => l.id)), kind: 'query' }, pathLinks: null, queryNote: 'why' };
      }
      if (q === 'impact') {
        const r = gAll.impact(focusId);
        return { focus: { nodes: new Set([focusId, ...r.map((x) => x.obj.id)]), links: new Set(r.map((x) => x.link.id)), kind: 'query' }, pathLinks: null, queryNote: 'impact' };
      }
      const r = gAll.similar(focusId);
      const nodes = new Set([focusId, ...r.map((x) => x.obj.id), ...r.flatMap((x) => x.shared.map((s) => s.id))]);
      const links = new Set(gAll.links.filter((l) => l.type !== 'part_of' && nodes.has(l.src) && nodes.has(l.dst) && (l.src === focusId || l.dst === focusId || r.some((x) => x.obj.id === l.src || x.obj.id === l.dst))).map((l) => l.id));
      return { focus: { nodes, links, kind: 'query' }, pathLinks: null, queryNote: 'similar' };
    }
    if (tab === 'review' && !focusId) {
      const s = hl ? data.suggestions.find((x) => x.id === hl) : undefined;
      if (s?.kind === 'object' && s.obj) return { focus: { nodes: new Set([s.obj, ...gAll.all(s.obj).map((l) => gAll.other(l, s.obj!))]), links: new Set(gAll.all(s.obj).map((l) => l.id)), kind: 'query' }, pathLinks: null, queryNote: null };
      if (s?.kind === 'merge' && s.a && s.b) return { focus: { nodes: new Set([s.a, s.b]), links: new Set(), kind: 'query' }, pathLinks: null, queryNote: null };
      const ls = s?.link ? data.links.filter((l) => l.id === s.link) : pendingLinks;
      const extra = s ? [] : pending.filter((x) => x.kind === 'merge').flatMap((x) => [x.a!, x.b!]);
      return { focus: { nodes: new Set([...ls.flatMap((l) => [l.src, l.dst]), ...extra]), links: new Set(ls.map((l) => l.id)), kind: 'query' }, pathLinks: null, queryNote: null };
    }
    if (focusId && depth !== 'all') { const h = gVis.neighborhood(focusId, depth === '2' ? 2 : 1); return { focus: { ...h, kind: 'hood' }, pathLinks: null, queryNote: null }; }
    return { focus: null, pathLinks: null, queryNote: null };
  }, [focusId, pathTo, q, tab, hl, depth, gVis, gAll, data, pending, pendingLinks, serverPath]);

  // 그릴 관계: 필터를 지난 것 + 질문·제안 검토로 꼭 보여야 하는 것
  const drawLinks = useMemo(() => {
    if (!focus || focus.kind === 'hood' || focus.kind === 'path') return filteredLinks;
    const ids = new Set(filteredLinks.map((l) => l.id));
    return [...filteredLinks, ...liveLinks.filter((l) => !ids.has(l.id) && focus.links.has(l.id))];
  }, [filteredLinks, liveLinks, focus]);

  // 카메라: 그래프에서 직접 누른 선택은 그대로 두고, 주소·패널·질문·경로로 바뀐 초점은 화면에 꽉 차게 맞춘다
  const skipFit = useRef(false);
  const fitted = useRef(false);
  const focusKey = focus ? [...focus.nodes].sort().join(',') : '';
  useEffect(() => {
    if (skipFit.current) { skipFit.current = false; return; }
    if (focus && focus.nodes.size) { fitted.current = true; gref.current?.fitTo([...focus.nodes]); }
    else if (fitted.current) { fitted.current = false; gref.current?.reset(); }
  }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = useCallback((id: string, shift = false, fromGraph = false) => {
    if (shift && focusId && focusId !== id) setP({ to: id, q: null, hl: null });
    else { skipFit.current = fromGraph; setP({ focus: id, to: null, q: null, hl: null, tab: null }); }
  }, [focusId, setP]);
  const selectFromPanel = useCallback((id: string) => select(id), [select]);
  const clear = useCallback(() => setP({ focus: null, to: null, q: null, hl: null }), [setP]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) clear(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [clear]);

  const toggleType = (t: ObjectType) => { const n = new Set(hidden); if (n.has(t)) n.delete(t); else n.add(t); const v = [...n].join(','); setP({ hide: v ? (large && v === LARGE_HIDE.join(',') ? null : v) : large ? 'none' : null }); };
  const toggleLink = (t: LinkType) => {
    const n = new Set(linkOn); if (n.has(t)) n.delete(t); else n.add(t);
    const isDefault = n.size === DEFAULT_LINK_TYPES.length && DEFAULT_LINK_TYPES.every((x) => n.has(x));
    setP({ lt: isDefault ? null : [...n].join(',') || 'none' });
  };
  const filtered = p('hide') !== null || p('once') !== null || (!large && (hidden.size > 0 || once)) || p('lt') !== null;

  // 숫자
  const objCount = (t: ObjectType) => data.objects.filter((o) => o.type === t && o.status !== 'rejected').length;
  const linkCount = (t: LinkType) => liveLinks.filter((l) => l.type === t).length;
  const activeLinks = data.links.filter((l) => l.status === 'accepted');
  // 고르기·마우스마다 다시 계산하지 않게 (과제 수 × 사슬 탐색)
  const { blockedTasks, longest } = useMemo(() => { const bt = data.objects.filter((o) => o.type === 'task' && gAll.whyStalled(o.id).chain.length > 0); return { blockedTasks: bt, longest: Math.max(0, ...bt.map((t) => Math.max(...gAll.whyStalled(t.id).chain.map((c) => c.depth)))) }; }, [data, gAll]);

  const boxFn = useCallback((W: number, H: number): Box => ({ x0: 28 + RAIL_W + 26, y0: 104, x1: W - 34, y1: H - 92 }), []);
  const box2d = useCallback((W: number, H: number): Box => ({ x0: 40, y0: 128, x1: W - 40, y1: H - 84 }), []);
  const blocked = useMemo<Array<[number, number, number, number]>>(() => [[0, 0, 600, 92], [0, 0, 28 + RAIL_W + 8, 2000]], []);

  return (
    <div className="home onto">
      <main className="stage" aria-label={tt("관계 그래프")}>
        {!view3d ? <Map2D ref={mref} data={data} links={mapLinks} projectId={mapProject} pick={pick} box={box2d}
          onOpen={(id) => setP({ focus: id, to: null, q: null, hl: null, tab: null })} onPick={(id) => { setPick(id); setDetail(null); }} onBack={clear} />
        : <OntologyGraph ref={gref} data={data} visible={visibleObjs} links={drawLinks} selectedId={focusId} pathTo={pathTo} focus={focus} hoverId={panelHover}
          fitVisible={baseVisible} onSelect={(id, shift) => select(id, shift, true)} onClear={clear} rotateOnDrag={rotate3d} autoRotate={spin} blocked={blocked} box={boxFn} />}
        {!view3d && <div className="crumb">{mapProject ? <><button onClick={clear}>{tt("← 전체 지도")}</button><span className="sep">/</span><b>{own2d.byId.get(mapProject)?.name}</b><span>{tt("· Esc로 돌아가기")}</span></> : <span>{tt("프로젝트 지도 · 거품을 누르면 펼쳐요")}</span>}</div>}

        <div className="counts" aria-label={tt("요약 숫자")}>
          <div><div className="l">{tt("객체")}</div><div className="v">{data.objects.filter((o) => o.status !== 'rejected').length}<small>{tt("보이는 것")} <b className="n">{visibleObjs.size}</b></small></div></div>
          <div><div className="l">{tt("관계")}</div><div className="v">{activeLinks.length}<small>{tt("끝난 것")} {activeLinks.filter((l) => l.ended).length}</small></div></div>
          <div className="clk" onClick={() => setP({ tab: 'review', focus: null, to: null, q: null })} title={tt("연결 제안 검토 열기")}><div className="l">{tt("확인할 제안")}</div><div className="v">{pending.length}<small>{tt("확신도 0.6–0.85")}</small></div></div>
          <div><div className="l"><i className="st stall" />{tt("막힌 과제")}</div><div className="v">{blockedTasks.length}<small>{tt("가장 긴 사슬")} <b>{longest}{tt("단계")}</b></small></div></div>
        </div>

        {view3d && <nav className="orail scroll" aria-label={tt("필터")}>
          <div className="rh">{tt("객체 종류")}</div>
          {OBJECT_TYPES.map((t) => (
            <button key={t} className={`rrow${hidden.has(t) ? ' off' : ''}`} aria-pressed={!hidden.has(t)} onClick={() => toggleType(t)} title={hidden.has(t) ? tt("눌러서 보이기") : tt("눌러서 숨기기")}>
              <TypeGlyph type={t} size={17} /><span>{TYPE_META[t].label}</span><em>{objCount(t)}</em>
            </button>
          ))}
          <label className="rchk"><input type="checkbox" checked={once} onChange={() => setP({ once: once ? (large ? '0' : null) : large ? null : '1' })} />{tt("한 번만 언급된 것 숨기기")}</label>
          {large && p('hide') === null && <div className="rnote">{tt("객체가 많아 주제·결정은 기본으로 숨겼어요. 객체를 누르면 이웃으로 보여요.")}</div>}
          <div className="rh">{tt("관계 종류")}</div>
          {LINK_TYPES.map((t) => {
            const m = LINK_META[t]; const on = linkOn.has(t);
            return (
              <button key={t} className={`rrow${on ? '' : ' off'}`} aria-pressed={on} onClick={() => toggleLink(t)} title={t === 'related_to' ? tt("약한 관계 — 기본으로 숨김") : on ? tt("눌러서 숨기기") : tt("눌러서 보이기")}>
                <svg className="lsw" width="22" height="10" viewBox="0 0 22 10" aria-hidden="true">
                  <path d="M1 5h18" stroke={m.color} strokeWidth={Math.max(1.2, m.w + 0.3)} strokeDasharray={m.dash} strokeLinecap="round" />
                  {m.arrow && <path d="M16 2l3.5 3-3.5 3" fill="none" stroke={m.color} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />}
                </svg>
                <span>{m.label}</span><em>{linkCount(t)}</em>
              </button>
            );
          })}
          <div className="rleg"><svg width="22" height="10" aria-hidden="true"><path d="M1 5h20" stroke="#A3A3A0" strokeOpacity=".55" strokeWidth="1.2" strokeDasharray={SUGGEST_DASH} /></svg>{tt("제안 (흐린 긴 점선)")}</div>
          <div className="rh">{tt("펼치기 깊이")}</div>
          <div className="seg" role="group" aria-label={tt("펼치기 깊이")}>
            {(['1', '2', 'all'] as const).map((d) => <button key={d} className={depth === d ? 'on' : ''} onClick={() => setP({ depth: d === '1' ? null : d })}>{d === 'all' ? tt("전체") : ttf("{0}단계", d)}</button>)}
          </div>
          {filtered && <button className="rreset" onClick={() => setP({ hide: null, lt: null, once: null })}>{tt("필터 처음으로")}</button>}
        </nav>}

        <div className="tools">
          <ModeSwitch mode="ontology" />
          <i className="sep" />
          <button className={`t3d${view3d ? ' on' : ''}`} title={view3d ? tt("2D 지도로") : tt("3D 그래프로 (전체 객체)")} aria-pressed={view3d} onClick={() => setP({ v: view3d ? null : '3d' })}>3D</button>
          {view3d && <><button className={rotate3d ? 'on' : ''} title={rotate3d ? tt("끌면 돌리기 (끄면 끌어서 이동)") : tt("끌면 이동 (켜면 끌어서 돌리기)")} aria-pressed={rotate3d} onClick={() => setRotate3d((v) => !v)}><Icon name="cube" /></button>
          <button className={spin ? 'on' : ''} title={spin ? tt("자동 회전 멈추기") : tt("천천히 자동 회전")} aria-pressed={spin} onClick={() => setSpin((v) => !v)}><Icon name="rotate" /></button></>}
          <i className="sep" />
          <button title={tt("확대 (+)")} aria-label={tt("확대")} onClick={() => (view3d ? gref.current?.zoomBy(1.2) : mref.current?.zoomBy(1.2))}><Icon name="plus" /></button>
          <button title={tt("축소 (−)")} aria-label={tt("축소")} onClick={() => (view3d ? gref.current?.zoomBy(1 / 1.2) : mref.current?.zoomBy(1 / 1.2))}><Icon name="minus" /></button>
        </div>
        <div className="hint">{view3d ? tt("끌어서 돌리기 · 눌러서 이웃 보기 · Shift+클릭으로 경로") : tt("끌어서 이동 · 휠로 확대 · 누르면 펼치기")}</div>

        <div className="obar">
          {pathLinks && focusId && pathTo ? (
            <><span className="bl"><Icon name="o-path" />{tt("경로")} {pathLinks.length ? ttf("{0}단계", pathLinks.length) : tt("없음")}</span>
              {pathLinks.length ? <PathLine start={focusId} links={pathLinks} g={gAll} onSelect={selectFromPanel} /> : <span className="bm">{tt("보이는 관계로는 4단계 안에 이어지지 않아요. 관계 필터를 넓혀 보세요.")}</span>}
              <button className="bx" onClick={() => setP({ to: null })} title={tt("경로 지우기")}><Icon name="close" size={13} /></button></>
          ) : queryNote && focusId ? (
            <><span className="bl">{queryNote === 'why' ? tt("왜 멈췄나") : queryNote === 'impact' ? tt("영향 범위") : tt("비슷한 옛 작업")}</span>
              <span className="bm">{data.objects.find((o) => o.id === focusId)?.name} {tt("— 관련된 것만 남기고 흐리게 했어요. 자세한 결과는 오른쪽 패널에.")}</span>
              <button className="bx" onClick={() => setP({ q: null })} title={tt("질문 지우기")}><Icon name="close" size={13} /></button></>
          ) : !view3d ? (
            <div className="olegend">
              <span><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="#7F9CC4" fillOpacity=".14" stroke="#7F9CC4" /></svg>{tt("프로젝트 (크기 = 과제 수)")}</span>
              <span><svg width="22" height="8" aria-hidden="true"><path d="M1 4h20" stroke="#6E6E6B" strokeWidth="2.4" strokeOpacity=".5" /></svg>{tt("선 굵기 = 함께 걸친 도구·결정·관계 수")}</span>
              <span><svg width="22" height="8" aria-hidden="true"><path d="M1 4h20" stroke="#D08A66" strokeWidth="1.4" strokeDasharray="4 3" /></svg>{tt("막힘")}</span>
              <span className="lk">{tt("3D 버튼으로 전체 객체 그래프")}</span>
            </div>
          ) : (
            <div className="olegend">
              <span><i className="ps" style={{ ['--c' as string]: '#7F9CC4' }} />{tt("구 = 프로젝트·과제")}</span>
              <span><TypeGlyph type="tool" size={15} />{tt("원판 = 그 밖의 객체")}</span>
              <span><svg width="22" height="8" aria-hidden="true"><path d="M1 4h20" stroke="#D08A66" strokeWidth="1.4" strokeDasharray="4 3" /></svg>{tt("막힘")}</span>
              <span><svg width="22" height="8" aria-hidden="true"><path d="M1 4h20" stroke="#6E6E6B" strokeOpacity=".45" strokeWidth="1.2" strokeDasharray={SUGGEST_DASH} /></svg>{tt("제안")}</span>
              <span><svg width="22" height="8" aria-hidden="true"><path d="M1 4h20" stroke="#6E6E6B" strokeOpacity=".3" strokeWidth="1.2" /></svg>{tt("끝난 관계")}</span>
              <span className="lk">{tt("객체를 누르면 이웃만 밝게 · Shift+클릭하면 두 객체 사이 경로")}</span>
            </div>
          )}
        </div>
      </main>
      <div className="note onote" style={{ left: 28, bottom: 5 }}>{dataMode() === 'mock' ? tt("예시 데이터 · 결정은 이 탭에서만 기억해요") : status ? ttf("객체 {0} · 관계 {1} · 대기 제안 {2} · AI로 뽑은 대화 {3}/{4}{5}", Object.values(status.objects).reduce((a, b) => a + (b ?? 0), 0), status.links, status.pendingSuggestions, status.llmExtractedConversations, status.extractableConversations, status.lastRunAt ? '' : tt(" (아직 AI 추출 전, 규칙만)")) : tt("코어 온톨로지")}</div>

      <aside className="panel scroll opanel" aria-label={tt("선택한 객체")}>
        <div className="otabs" role="tablist">
          <button role="tab" aria-selected={tab === 'object'} className={tab === 'object' ? 'on' : ''} onClick={() => setP({ tab: null, hl: null })}>{tt("객체")}</button>
          <button role="tab" aria-selected={tab === 'review'} className={tab === 'review' ? 'on' : ''} onClick={() => setP({ tab: 'review', focus: null, to: null, q: null })}>{tt("연결 제안 검토")}{pending.length > 0 && <span className="n">{pending.length}</span>}</button>
        </div>
        {tab === 'review' ? (
          <ReviewPanel data={data} base={BASE} verdicts={verdicts} onDecide={decide} onUndo={undo} onBulk={bulk} hl={hl} onHighlight={(id) => setP({ hl: id })} onSelect={selectFromPanel} g={gAll} />
        ) : !view3d && detail && gAll.byId.get(detail) ? (
          <>
            <button className="lnk" style={{ fontSize: 11.5, color: 'var(--ink3)' }} onClick={() => setDetail(null)}>{tt("← 프로젝트 카드")}</button>
            <ObjectPanel key={detail} id={detail} g={gAll} today={data.today} q={null} pathTo={null} pathLinks={null}
              onQuestion={(x) => setP({ v: '3d', focus: detail, q: x, to: null })} onSelect={(id) => setPick(id)} onHover={() => {}}
              onReview={() => setP({ tab: 'review', focus: null, to: null, q: null })} pendingFor={0} />
          </>
        ) : !view3d && mapProject ? (
          <ProjectCards data={data} links={mapLinks} projectId={mapProject} pick={pick} onPick={setPick} onDetail={setDetail} onBack={clear} />
        ) : focusId && gAll.byId.get(focusId) ? (
          <ObjectPanel key={focusId} id={focusId} g={gAll} today={data.today} q={q} pathTo={pathTo} pathLinks={pathLinks}
            onQuestion={(x) => setP({ q: x === q ? null : x, to: null })} onSelect={selectFromPanel} onHover={setPanelHover}
            onReview={() => setP({ tab: 'review', focus: null, to: null, q: null })} pendingFor={pending.filter((s) => { const l = s.link ? data.links.find((k) => k.id === s.link) : undefined; return l ? l.src === focusId || l.dst === focusId : s.a === focusId || s.b === focusId || s.obj === focusId; }).length} />
        ) : (
          <Overview g={gAll} pending={pending.length} onSelect={selectFromPanel} onWhy={(id) => setP({ focus: id, q: 'why', to: null })} onReview={() => setP({ tab: 'review' })} onHover={setPanelHover} />
        )}
      </aside>
    </div>
  );
}
