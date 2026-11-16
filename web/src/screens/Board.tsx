import { tt, ttf } from '../i18n';
import { Link, useNavigate } from 'react-router-dom';
import { useAppData } from '../components/AppData';
import { Icon } from '../components/Icons';
import { api } from '../api/endpoints';
import { useApi } from '../api/useApi';
import { errorText } from '../api/client';
import { AiMark, StatusGlyph } from '../components/Marks';
import { DataModeNote } from '../components/DataModeNote';
import { TaskFlags, hasFlags } from '../components/TaskBadges';
import { dotDate } from '../lib/format';
import { NextStepLine, nextOf } from '../components/NextStep';
import '../styles/list.css';

/** 보드 (MVP 최소판): GET /board 열 4개. 끌어서 상태 바꾸기는 다음 작업 */
export default function Board() {
  const nav = useNavigate();
  const q = useApi(() => api.board(), []);
  const { dashboard } = useAppData();
  const nr = dashboard?.counts.needsReview ?? 0; const ps = dashboard?.badges.pendingProjectSuggestions ?? 0;
  const total = q.data?.columns.reduce((a, c) => a + c.total, 0) ?? 0;
  return (
    <div className="tl scroll">
      <div className="head">
        <h1>{tt("과제")}</h1>
        <span className="sum">{total}{tt("개 · 상태별")}</span>
        {(nr > 0 || ps > 0) && <Link to="/review" className="lnk" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 'auto' }}><Icon name="q" size={13} />{tt("확인할 것")}{nr > 0 ? ttf(" · 확인 필요 {0}", nr) : ''}{ps > 0 ? ttf(" · 새 프로젝트 제안 {0}", ps) : ''}</Link>}
      </div>
      {q.error != null && <div className="state err"><b>{tt("과제 목록을 불러오지 못했어요")}</b><span>{errorText(q.error)}</span></div>}
      {q.data?.columns.map((c) => (
        <section key={c.status}>
          <div className={`grp${c.total === 0 ? ' empty' : ''}`}><StatusGlyph v={c.items[0]?.statusVisual ?? null} />{tt(c.labelKo)}<b>{c.total}</b>{c.total === 0 && <small>{tt("없음")}</small>}</div>
          {c.items.map((t) => { const ns = t.status === '진행 중' || t.status === '멈춤' ? nextOf(t) : null; return (
            <button key={t.id} className={`row${ns ? ' has-ns' : ''}`} onClick={() => nav(`/tasks/${encodeURIComponent(t.id)}`)}>
              <StatusGlyph v={t.statusVisual} />
              {ns ? <span className="tw"><span className="t">{t.title}</span><NextStepLine taskId={t.id} info={ns} /></span> : <span className="t">{t.title}</span>}
              {hasFlags(t) && <span className="fl"><TaskFlags handoff={t.handoff} classificationState={t.classificationState} outcome={t.conversationOutcome} completionReason={t.completionReason} /></span>}
              <span className="pjc">{t.project?.name && <span className="pj" title={t.project.name}>{t.project.name}</span>}</span>
              <span className="ai">{t.sourceAis.map((a) => <AiMark key={a} ai={a} />)}</span>
              <span className="dt">{t.badge ?? (t.lastActivityAt ? dotDate(t.lastActivityAt) : '')}</span>
            </button>
          ); })}
          {c.total > c.items.length && <div className="more">{c.collapsed ? tt("접혀 있어요") : ttf("외 {0}개", c.total - c.items.length)}</div>}
        </section>
      ))}
      <DataModeNote style={{ left: 32, bottom: 8 }} />
    </div>
  );
}
