import { tt, ttf } from '../i18n';
// 1.1.0 "확인할 것" 화면: 확인 필요 과제(확신도 낮음 + 분류 불가) · 새 프로젝트 제안 · 다른 곳에서 이어가는 과제.
// GET /tasks?needsReview=true | ?classificationState=blocked | ?handedOff=true, GET /classification/status(blockedCount), GET /project-suggestions
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { TaskDetail, TaskListItem } from '@subbrain/shared';
import { api } from '../api/endpoints';
import { useApi } from '../api/useApi';
import { errorText } from '../api/client';
import { useAppData } from '../components/AppData';
import { DataModeNote } from '../components/DataModeNote';
import { Icon } from '../components/Icons';
import { AiMark, Sphere, StatusGlyph } from '../components/Marks';
import { ProjectSuggestionCard, type SuggestionOutcome } from '../components/ProjectSuggestionCard';
import { HandoffBadge, OutcomeBadge, TaskFlags, blockedSentence } from '../components/TaskBadges';
import { fullDateTime, relative, visualOf, costText } from '../lib/format';
import { now } from '../lib/clock';
import { McpWrites } from '../components/McpWrites';
import { accentOf } from '../design/tokens';
import '../styles/review.css';

type Tab = 'all' | 'blocked';

export default function Review() {
  const { dashboard, refresh } = useAppData();
  const loc = useLocation();
  const [tab, setTab] = useState<Tab>('all');
  const [tick, setTick] = useState(0);
  const status = useApi(() => api.classificationStatus(), [tick]);
  const rows = useApi(() => (tab === 'blocked' ? api.tasks({ classificationState: 'blocked', limit: 100 }) : api.tasks({ needsReview: true, limit: 100 })), [tab, tick]);
  const handed = useApi(() => api.tasks({ handedOff: true, limit: 50, sort: 'last_activity_desc' }), [tick]);
  const sugg = useApi(() => api.projectSuggestions({ state: 'pending', limit: 50 }), [tick]);
  const [gone, setGone] = useState<Record<string, true>>({});

  // 분류 불가 사유(blockedReason)와 확신도는 목록 행에 없어 상세에서 읽는다 (보이는 행만, 최대 40개)
  const items = rows.data?.items ?? [];
  const [details, setDetails] = useState<Record<string, TaskDetail>>({});
  useEffect(() => {
    let live = true;
    const need = items.slice(0, 40).filter((t) => !details[t.id]);
    if (!need.length) return;
    void Promise.all(need.map((t) => api.task(t.id).catch(() => null))).then((ds) => {
      if (!live) return;
      setDetails((m) => { const n = { ...m }; for (const d of ds) if (d) n[d.id] = d; return n; });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.data]);
  const sorted = useMemo(() => [...items].sort((a, b) => Number(b.classificationState === 'blocked') - Number(a.classificationState === 'blocked')), [items]);

  useEffect(() => {
    if (loc.hash === '#suggestions' && sugg.data) document.getElementById('suggestions')?.scrollIntoView({ block: 'start' });
  }, [loc.hash, sugg.data]);

  const onDecided = (o: SuggestionOutcome) => { setGone((g) => ({ ...g, [o.id]: true })); setTick((t) => t + 1); refresh(); };
  const cs = status.data;
  const suggestions = (sugg.data?.items ?? []).filter((x) => !gone[x.id]);
  const readyCount = suggestions.filter((x) => x.ready).length;

  return (
    <div className="review scroll">
      <div className="rvin">
        <div className="mast">
          <div className="l"><span className="eyebrow">{tt("사람이 한 번 봐 주면 좋은 것")}</span><h1>{tt("확인할 것")}</h1></div>
          <div className="r"><button onClick={() => setTick((t) => t + 1)}><Icon name="rotate" />{tt("새로고침")}</button></div>
        </div>
        <div className="strip" aria-label={tt("분류 상태")}>
          <div>{tt("확인 필요")} <b>{cs?.needsReviewCount ?? dashboard?.counts.needsReview ?? '–'}</b></div>
          <div title={tt("제공자 안전 필터가 막아 규칙 분류로 채운 과제 (보관 제외)")}>{tt("분류 불가")} <b className={cs && cs.blockedCount > 0 ? 'rose' : ''}>{cs?.blockedCount ?? '–'}</b></div>
          <div>{tt("새 프로젝트 제안")} <b>{dashboard?.badges.pendingProjectSuggestions ?? readyCount}</b></div>
          <div className="cm">{cs ? <>{tt("분류")} {cs.model ?? tt("모델 없음")} · {cs.promptVersion}{cs.lastRunAt ? ttf(" · 마지막 분류 {0}", relative(cs.lastRunAt, now())) : ''}{ttf(" · 오늘 {0}건 · {1}", cs.today.classified, costText(cs.today))}{cs.queue.pending + cs.queue.running > 0 ? ttf(" · 대기 {0}", cs.queue.pending + cs.queue.running) : ''}</> : status.error ? tt("분류 상태를 불러오지 못했어요") : '…'}</div>
        </div>

        <div className="rvgrid">
          <section aria-label={tt("확인 필요 과제")}>
            <h2>{tt("확인 필요")} <span>{tt("확신도가 낮거나 분류하지 못한 과제")}</span>
              <span className="tabs" role="tablist">
                <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>{tt("전체")}</button>
                <button role="tab" aria-selected={tab === 'blocked'} className={tab === 'blocked' ? 'on' : ''} onClick={() => setTab('blocked')}>{tt("분류 불가만")}{cs ? ` ${cs.blockedCount}` : ''}</button>
              </span>
            </h2>
            {rows.loading && !rows.data && <div className="skel" style={{ height: 64, marginTop: 6 }} />}
            {rows.error != null && <div className="state err"><b>{tt("목록을 불러오지 못했어요")}</b><span>{errorText(rows.error)}</span><button className="btn" onClick={rows.reload}>{tt("다시 시도")}</button></div>}
            {rows.data && sorted.length === 0 && <div className="rvempty">{tab === 'blocked' ? tt("분류하지 못한 과제가 없어요.") : tt("지금은 확인할 과제가 없어요.")}</div>}
            {sorted.map((t) => <ReviewRow key={t.id} t={t} d={details[t.id]} />)}
            {rows.data?.page.hasMore && <div className="rvempty">{tt("외")} {(rows.data.page.total ?? 0) - sorted.length}{tt("개 더 있어요")}</div>}

            {(handed.data?.items.length ?? 0) > 0 && (
              <div className="rvsub">
                <h2>{tt("다른 곳에서 이어가는 과제")} <span>{tt("끝난 게 아니라 다른 창·도구로 옮겨 계속하는 중")}</span></h2>
                <ul className="hol">{handed.data!.items.map((t) => (
                  <li key={t.id}><StatusGlyph v={t.statusVisual} title={tt(t.status)} /><Link to={`/tasks/${encodeURIComponent(t.id)}`}>{t.title}</Link>{t.conversationOutcome ? <OutcomeBadge o={t.conversationOutcome} /> : <HandoffBadge h={t.handoff} />}
                    <small>{statusText(t)}{t.project ? ` · ${t.project.name}` : ''}</small></li>
                ))}</ul>
              </div>
            )}
          </section>

          <section id="suggestions" aria-label={tt("새 프로젝트 제안")}>
            <h2>{tt("새 프로젝트 제안")} <span>{suggestions.length ? tt("프로젝트 없는 과제가 비슷한 이름으로 모였어요") : ''}</span></h2>
            {sugg.loading && !sugg.data && <div className="skel" style={{ height: 120, marginTop: 6 }} />}
            {sugg.error != null && <div className="state err"><b>{tt("제안을 불러오지 못했어요")}</b><span>{errorText(sugg.error)}</span><button className="btn" onClick={sugg.reload}>{tt("다시 시도")}</button></div>}
            {sugg.data && suggestions.length === 0 && <div className="rvempty">{tt("새 프로젝트 제안이 없어요. 프로젝트 없는 과제가 비슷한 이름으로 3개 모이면 여기에 나와요.")}</div>}
            {suggestions.map((s) => <ProjectSuggestionCard key={s.id} s={s} onDone={onDecided} />)}
          </section>
          <McpWrites />
        </div>
      </div>
      <DataModeNote style={{ left: 40, bottom: 6 }} />
    </div>
  );
}

function statusText(t: TaskListItem) {
  const v = visualOf(t.statusVisual);
  return v === 'stall' || v === 'stall2' ? ttf("{0}일째 멈춤", t.staleDays ?? '?') : tt(t.status);
}

function ReviewRow({ t, d }: { t: TaskListItem; d: TaskDetail | undefined }) {
  const nav = useNavigate();
  const v = visualOf(t.statusVisual);
  const c = d?.classification;
  const blocked = t.classificationState === 'blocked';
  const open = () => nav(`/tasks/${encodeURIComponent(t.id)}`);
  return (
    <div className={`rv${blocked ? ' blk' : ''}`}>
      <StatusGlyph v={v} title={tt(t.status)} />
      <div className="rvb">
        <div className="rvt"><a href={`/tasks/${t.id}`} onClick={(e) => { e.preventDefault(); open(); }}>{t.title}</a><TaskFlags handoff={t.handoff} classificationState={t.classificationState} outcome={t.conversationOutcome} completionReason={t.completionReason} /></div>
        <div className="rvm">
          {t.project ? <span><Sphere color={accentOf(t.project.colorHex)} size={9} />{t.project.name}</span> : <span>{tt("프로젝트 없음")}</span>}
          <span className={v === 'stall' ? 'late' : v === 'stall2' ? 'warm' : v === 'run' ? 'ok' : ''}>{statusText(t)}</span>
          <span>{t.sourceAis.map((a) => <AiMark key={a} ai={a} style={{ marginRight: 4 }} />)}{tt("대화")} {t.conversationCount}</span>
          {c && !blocked && <span>{tt("신뢰도")} {c.confidence.toFixed(2)}{c.rawConfidence != null && Math.abs(c.rawConfidence - c.confidence) >= 0.005 ? ttf(" (보정 전 {0})", c.rawConfidence.toFixed(2)) : ''}</span>}
        </div>
        {blocked ? (
          <div className="blkn"><b>{tt("분류 불가")}</b> — {d ? blockedSentence(c?.blockedReason ?? null, c?.blockedModel ?? null) : tt("사유를 불러오는 중…")}
            {c?.classifiedAt && <small> {fullDateTime(c.classifiedAt)}</small>}</div>
        ) : c?.evidence ? <div className="rvw">{tt("분류 근거:")} {c.evidence}</div> : null}
      </div>
      <button className="btn" onClick={open}>{tt("열기")}<Icon name="chev" /></button>
    </div>
  );
}
