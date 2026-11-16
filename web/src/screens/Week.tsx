import { tt, ttf } from '../i18n';
// 주간 돌아보기: 월~일(KST) 한 주. 완료·시작·멈춤·오래 방치(14일+)·AI별 대화 수, 항목마다 다음 할 일.
// GET /review/weekly?date=YYYY-MM-DD — 규칙만 씀(AI 호출 없음)
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { WeeklyReviewItem, WeeklyReviewResponse } from '@subbrain/shared';
import { api } from '../api/endpoints';
import { useApi } from '../api/useApi';
import { errorText } from '../api/client';
import { Icon } from '../components/Icons';
import { AiMark, StatusGlyph } from '../components/Marks';
import { NextStepLine, nextOf } from '../components/NextStep';
import { DataModeNote } from '../components/DataModeNote';
import { aiLabel, dotDate, monthDay } from '../lib/format';
import '../styles/week.css';

type Kind = 'finished' | 'started' | 'stalled' | 'neglected';
const SECTIONS: Array<{ k: Kind; label: string; empty: string; at: (w: WeeklyReviewResponse, i: WeeklyReviewItem) => string }> = [
  { k: 'finished', label: tt("끝낸 과제"), empty: tt("이 주에 끝낸 과제가 없어요"), at: (_w, i) => (i.at ? ttf("{0} 완료", dotDate(i.at)) : '') },
  { k: 'started', label: tt("새로 시작"), empty: tt("이 주에 시작한 과제가 없어요"), at: (_w, i) => (i.at ? ttf("{0} 시작", dotDate(i.at)) : '') },
  { k: 'stalled', label: tt("멈춘 과제"), empty: tt("멈춘 과제가 없어요"), at: (_w, i) => (i.task.staleDays != null ? ttf("{0}일째", i.task.staleDays) : '') },
  { k: 'neglected', label: tt("오래 방치"), empty: tt("오래 방치한 과제가 없어요"), at: (_w, i) => (i.task.staleDays != null ? ttf("{0}일째", i.task.staleDays) : '') },
];

const range = (w: WeeklyReviewResponse) => `${monthDay(w.weekStart)} – ${monthDay(w.weekEnd)}`;

export default function Week() {
  const { date } = useParams();
  const nav = useNavigate();
  const q = useApi(() => api.weeklyReview(date), [date ?? '']);
  const w = q.data;
  const go = (d: string | null) => { if (d) nav(`/week/${d}`); };
  return (
    <div className="wk scroll">
      <div className="wh">
        <div className="tt">
          <h1>{tt("주간 돌아보기")}</h1>
          <span className="rg">{w ? <>{range(w)}{w.isCurrent ? <em>{tt("이번 주 · 오늘")} {monthDay(w.today)}{tt("까지")}</em> : null}</> : '…'}</span>
        </div>
        <div className="nv">
          <button className="btn" disabled={!w} onClick={() => go(w?.prevWeek ?? null)} aria-label={tt("지난주")}><Icon name="back" />{tt("지난주")}</button>
          {w && !w.isCurrent && <button className="btn" onClick={() => nav('/week')}>{tt("이번 주")}</button>}
          <button className="btn" disabled={!w?.nextWeek} onClick={() => go(w?.nextWeek ?? null)} aria-label={tt("다음 주")}>{tt("다음 주")}<Icon name="chev" /></button>
        </div>
      </div>
      {q.error != null && <div className="state err"><b>{tt("주간 돌아보기를 불러오지 못했어요")}</b><span>{errorText(q.error)}</span><button className="btn" onClick={q.reload}>{tt("다시 시도")}</button></div>}
      {q.loading && !w && <div className="state">{tt("불러오는 중…")}</div>}
      {w && (
        <>
          <div className="nums" role="list">
            {SECTIONS.map((s) => <a key={s.k} role="listitem" href={`#wk-${s.k}`} className={`n n-${s.k}`} onClick={(e) => { e.preventDefault(); document.getElementById(`wk-${s.k}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}><b>{w[s.k].length}</b><span>{s.label}</span></a>)}
            <div className="n" role="listitem"><b>{w.conversationCount}</b><span>{tt("대화 · 메시지")} {w.messageCount}</span></div>
          </div>
          <section className="ai">
            <h2>{tt("AI별 대화")}</h2>
            {w.byAi.length === 0 ? <p className="empty">{tt("이 주에 대화가 없어요")}</p> : (
              <ul>{w.byAi.map((a) => {
                const max = Math.max(1, ...w.byAi.map((x) => x.conversationCount));
                return (
                  <li key={a.sourceAi}>
                    <span className="nm"><AiMark ai={a.sourceAi} />{aiLabel(a.sourceAi)}</span>
                    <span className="bar"><span style={{ width: `${Math.round((a.conversationCount / max) * 100)}%`, background: `var(--${aiVar(a.sourceAi)})` }} /></span>
                    <span className="ct"><b>{a.conversationCount}</b>{tt("개 ·")} {a.messageCount}</span>
                  </li>
                );
              })}</ul>
            )}
          </section>
          {SECTIONS.map((s) => (
            <section key={s.k} id={`wk-${s.k}`} className="ls">
              <h2>{s.label}<b>{w[s.k].length}</b>{s.k === 'neglected' && <small>{w.neglectDays}{tt("일 넘게 손대지 않음")}</small>}{s.k === 'stalled' && <small>{w.isCurrent ? tt("오늘") : tt("그 주 끝")} {tt("기준")}</small>}</h2>
              {w[s.k].length === 0 ? <p className="empty">{s.empty}</p> : (
                <ul>{w[s.k].map((i) => (
                  <li key={i.task.id}>
                    <Link to={`/tasks/${encodeURIComponent(i.task.id)}`} className="it">
                      <StatusGlyph v={i.task.statusVisual} />
                      <span className="tw">
                        <span className="t">{i.task.title}</span>
                        <span className="m">{i.task.project?.name && <span className="pj">{i.task.project.name}</span>}<span className="ai2">{i.task.sourceAis.map((a) => <AiMark key={a} ai={a} />)}</span><span className="at">{s.at(w, i)}</span></span>
                        {s.k !== 'finished' && <NextStepLine taskId={i.task.id} info={nextOf(i.task)} />}
                      </span>
                    </Link>
                  </li>
                ))}</ul>
              )}
            </section>
          ))}
          <p className="foot">{tt("규칙으로만 셈 · AI 호출 없음 · 주는 월요일~일요일(한국 시간)")}</p>
        </>
      )}
      <DataModeNote style={{ left: 24, bottom: 8 }} />
    </div>
  );
}

function aiVar(a: string) { return a === 'chatgpt' ? 'gpt' : a === 'claude-code' ? 'ccode' : a; }
