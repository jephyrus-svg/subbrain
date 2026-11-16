import { tt, ttf } from '../i18n';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { GraphNode, GraphQuery, SourceAi, TaskStatus } from '@subbrain/shared';
import { SOURCE_AIS } from '@subbrain/shared';
import { api } from '../api/endpoints';
import { useApi } from '../api/useApi';
import { errorText } from '../api/client';
import { useAppData } from '../components/AppData';
import { DataModeNote } from '../components/DataModeNote';
import { Icon } from '../components/Icons';
import { AiMark, StatusGlyph } from '../components/Marks';
import { Popover } from '../components/Popover';
import { ModeSwitch } from '../components/ModeSwitch';
import type { GraphHandle } from '../graph/GraphView';
import { UniverseView } from '../graph/UniverseView';
import { aiLabel, kst, monthDay } from '../lib/format';
import { ProjectPanel } from './home/ProjectPanel';
import { TaskPanel } from './home/TaskPanel';
import { TopicPanel } from './home/TopicPanel';
import '../styles/home.css';

const STATUS_FILTERS: TaskStatus[] = ["진행 중", "멈춤", "완료", "간단한 질문"];

export default function Home() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { dashboard } = useAppData();
  const [statuses, setStatuses] = useState<TaskStatus[]>([]);
  const [ais, setAis] = useState<SourceAi[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [rotate3d, setRotate3d] = useState(true);
  const [spin, setSpin] = useState(true);
  const [panelHover, setPanelHover] = useState<string | null>(null);
  const gref = useRef<GraphHandle>(null);

  const query: GraphQuery = useMemo(() => {
    const q: GraphQuery = {};
    if (statuses.length) { q.status = statuses; q.includeQuick = statuses.includes('간단한 질문'); q.includeDone = statuses.includes('완료'); }
    if (ais.length) q.sourceAi = ais;
    return q;
  }, [statuses, ais]);
  const graph = useApi(() => api.graph(query), [JSON.stringify(query)]);
  const activity = useApi(() => api.activity({ granularity: 'week' }), []);

  const nodes = graph.data?.nodes;
  const focus = params.get('focus');
  const selectedId = useMemo(() => {
    if (focus) return focus;
    return nodes?.find((n) => n.type === 'project')?.id ?? null;
  }, [focus, nodes]);
  const selected: GraphNode | undefined = nodes?.find((n) => n.id === selectedId);
  const selType = selected?.type ?? (selectedId?.startsWith('prj_') ? 'project' : selectedId?.startsWith('task_') ? 'task' : selectedId?.startsWith('obj_topic_') ? 'topic' : null);

  const select = useCallback((id: string) => { setParams({ focus: id }, { replace: true }); }, [setParams]);
  const selectFromPanel = useCallback((id: string) => { select(id); setTimeout(() => gref.current?.focus(id), 30); }, [select]);
  const openNode = useCallback((n: GraphNode) => {
    if (n.type === 'task') nav(`/tasks/${encodeURIComponent(n.id)}`);
  }, [nav]);

  const c = dashboard?.counts;
  const filtered = statuses.length > 0 || ais.length > 0;
  const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

  // 되감기 막대 (주간 대화 수)
  const buckets = activity.data?.buckets ?? [];
  const bmax = Math.max(1, ...buckets.map((b) => b.conversationCount));
  const months = [...new Map(buckets.map((b) => [kst(b.start).m, ttf("{0}월", kst(b.start).m)])).values()];

  return (
    <div className="home">
      <main className="stage" aria-label={tt("과제 그래프")}>
        {graph.data && graph.data.nodes.length > 0 && (
          <UniverseView ref={gref} data={graph.data} selectedId={selectedId} hoverId={panelHover} onSelect={(id) => select(id)} onOpen={openNode} rotateOnDrag={rotate3d} autoRotate={spin} />
        )}
        {graph.loading && !graph.data && <div className="state">{tt("그래프를 그리는 중…")}</div>}
        {graph.error != null && <div className="state err"><b>{tt("그래프를 불러오지 못했어요")}</b><span>{errorText(graph.error)}</span><button className="btn" onClick={graph.reload}>{tt("다시 시도")}</button></div>}
        {graph.data && graph.data.nodes.length === 0 && (
          <div className="state"><b>{filtered ? tt("조건에 맞는 과제가 없어요") : tt("아직 수집한 대화가 없어요")}</b><span>{filtered ? tt("필터를 풀어 보세요.") : tt("ChatGPT·Claude 내보내기 파일을 가져오면 여기에 그래프가 그려져요.")}</span>
            {filtered && <button className="btn" onClick={() => { setStatuses([]); setAis([]); }}>{tt("필터 풀기")}</button>}</div>
        )}

        <div className="counts" aria-label={tt("요약 숫자")}>
          <div><div className="l"><StatusGlyph v="run" />{tt("진행 중")}</div><div className="v">{c?.inProgress ?? '–'}</div></div>
          <div><div className="l"><StatusGlyph v="stall" />{tt("멈춤")}</div><div className="v">{c?.stalled ?? '–'}<small>{tt("7일 넘은 것")} <b>{c?.stalledOver7Days ?? '–'}</b></small></div></div>
          <div><div className="l"><StatusGlyph v="done" />{tt("이번 주 완료")}</div><div className="v">{c?.completedThisWeek ?? '–'}</div></div>
          <div><div className="l"><StatusGlyph v="quick" />{tt("간단한 질문")}</div><div className="v">{c?.quickQuestions ?? '–'}<small>{tt("그래프에서 흐리게")}</small></div></div>
        </div>

        {/* 1.1.0 확인할 것: 확인 필요(분류 불가 포함) · 새 프로젝트 제안 배지 → /review */}
        {((c?.needsReview ?? 0) > 0 || (dashboard?.badges.pendingProjectSuggestions ?? 0) > 0) && (
          <div className="asks" aria-label={tt("확인할 것")}>
            {(c?.needsReview ?? 0) > 0 && <Link to="/review" title={tt("확신도가 낮거나 분류하지 못한 과제")}><Icon name="q" />{tt("확인 필요")} <b>{c!.needsReview}</b></Link>}
            {(dashboard?.badges.pendingProjectSuggestions ?? 0) > 0 && <Link to="/review#suggestions" className="psb" title={tt("프로젝트 없는 과제가 비슷한 이름으로 모였어요")}><Icon name="folder-plus" />{tt("새 프로젝트 제안")} <b>{dashboard!.badges.pendingProjectSuggestions}</b></Link>}
          </div>
        )}

        <div className="tools">
          <ModeSwitch mode="task" />
          <i className="sep" />
          <span className="wrapb">
            <button className={filterOpen ? 'on' : ''} title={tt("필터")} aria-label={tt("필터")} onClick={() => setFilterOpen((o) => !o)}><Icon name="filter" /></button>
            {filtered && <i className="fdot" />}
          </span>
          <button className={rotate3d ? 'on' : ''} title={rotate3d ? tt("끌면 돌리기 (끄면 끌어서 이동)") : tt("끌면 이동 (켜면 끌어서 돌리기)")} aria-pressed={rotate3d} onClick={() => setRotate3d((v) => !v)}><Icon name="cube" /></button>
          <button className={spin ? 'on' : ''} title={spin ? tt("자동 회전 멈추기") : tt("천천히 자동 회전")} aria-pressed={spin} onClick={() => setSpin((v) => !v)}><Icon name="rotate" /></button>
          <i className="sep" />
          <button title={tt("확대 (+)")} aria-label={tt("확대")} onClick={() => gref.current?.zoomBy(1.2)}><Icon name="plus" /></button>
          <button title={tt("축소 (−)")} aria-label={tt("축소")} onClick={() => gref.current?.zoomBy(1 / 1.2)}><Icon name="minus" /></button>
        </div>
        <Popover open={filterOpen} onClose={() => setFilterOpen(false)} className="menu gfilter">
          <div className="lab">{tt("상태")}</div>
          {STATUS_FILTERS.map((s) => (
            <label key={s}><input type="checkbox" checked={statuses.includes(s)} onChange={() => setStatuses((xs) => toggle(xs, s))} /><StatusGlyph v={s === "진행 중" ? "run" : s === "멈춤" ? "stall" : s === "완료" ? "done" : "quick"} />{tt(s)}</label>
          ))}
          <div className="sep" />
          <div className="lab">AI</div>
          {SOURCE_AIS.map((a) => <label key={a}><input type="checkbox" checked={ais.includes(a)} onChange={() => setAis((xs) => toggle(xs, a))} /><AiMark ai={a} />{aiLabel(a)}</label>)}
          <div className="sep" />
          <button onClick={() => { setStatuses([]); setAis([]); }} disabled={!filtered}>{tt("모두 보기")}</button>
          <button onClick={() => { gref.current?.reset(); setFilterOpen(false); }}>{tt("시점 처음으로 (0)")}</button>
        </Popover>
        <div className="hint">{rotate3d ? tt("끌어서 돌리기") : tt("끌어서 이동")} {tt("· 두 번 눌러 초점 이동")}</div>

        <div className="legend">
          <span><i className="rg run" />{tt("진행 중")}</span><span><i className="rg s2" />{tt("잠깐 멈춤")}</span><span><i className="rg s1" />{tt("7일 넘게 멈춤")}</span><span><i className="rg dn" />{tt("완료")}</span>
          <span className="lsep" aria-hidden="true" /><span className="lk">{tt("색 = 프로젝트 · 크기 = 대화량 · 가까울수록 밝게 · 빛 = 관계 세기")}</span>
        </div>

        <div className="scrub">
          <div className="lab"><button className="pl" disabled title={tt("시점 되감기는 다음 단계(Phase 2)에서 열려요")} aria-label={tt("시점 되감기 (준비 중)")}><Icon name="play" size={11} /></button><div>{tt("시점 되감기")}<small>{tt("그 날까지의 그래프")}</small></div></div>
          <div className="trk" title={tt("시점 되감기는 다음 단계(Phase 2)에서 열려요 — 지금은 오늘 그래프만 볼 수 있어요")}>
            <svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
              {buckets.map((b, i) => { const w = 100 / buckets.length; const h = (b.conversationCount / bmax) * 28; return <rect key={b.start} x={(i * w + 0.35).toFixed(2)} y={(30 - h).toFixed(2)} width={(w - 0.9).toFixed(2)} height={h.toFixed(2)} fill="#3C3C41"><title>{ttf("{0} 주 · 대화 {1}", monthDay(b.start), b.conversationCount)}</title></rect>; })}
            </svg>
            <div className="base" />
            <div className="mon">{months.map((m) => <span key={m}>{m}</span>)}</div>
            <div className="knob" />
          </div>
          <div className="now">{dashboard ? monthDay(dashboard.today) : ''}<small>{tt("오늘 · 과제")} {c?.totalTasks ?? '–'}{tt("개")}{c?.allTasks != null ? ttf(" (전체 {0})", c.allTasks) : ''}</small></div>
        </div>
      </main>
      <DataModeNote style={{ left: 28, bottom: 5 }} />

      <aside className="panel scroll" aria-label={tt("선택한 항목")}>
        {selectedId && selType === 'project' && <ProjectPanel key={selectedId} id={selectedId} selectedTaskId={null} onSelect={selectFromPanel} onHoverTask={setPanelHover} />}
        {selectedId && selType === 'task' && <TaskPanel key={selectedId} id={selectedId} onSelect={selectFromPanel} />}
        {selectedId && selType === 'topic' && <TopicPanel key={selectedId} id={selectedId} onSelect={selectFromPanel} onHoverTask={setPanelHover} />}
        {!selectedId && !graph.loading && <div className="state"><b>{tt("그래프에서 프로젝트나 과제를 눌러 보세요")}</b></div>}
      </aside>
    </div>
  );
}
