import { tt, ttf } from '../../i18n';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProjectDetail, SourceAi, TaskListItem } from '@subbrain/shared';
import { SOURCE_AIS } from '@subbrain/shared';
import { api } from '../../api/endpoints';
import { useApi } from '../../api/useApi';
import { Icon } from '../../components/Icons';
import { AiMark, StatusGlyph, Svc } from '../../components/Marks';
import { Popover } from '../../components/Popover';
import { aiLabel, dotDate, kst, monthDay, visualOf } from '../../lib/format';
import { openExternal, copyText } from '../../lib/clipboard';
import { useResume } from '../../lib/resume';
import { useToast } from '../../components/Toast';
import { PanelError, PanelSkeleton } from './PanelStates';
import { accentOf } from '../../design/tokens';
import { TaskFlags } from '../../components/TaskBadges';

const AI_VAR: Record<SourceAi, string> = { chatgpt: 'var(--gpt)', claude: 'var(--claude)', gemini: 'var(--gemini)', grok: 'var(--grok)', 'claude-code': 'var(--ccode)', codex: 'var(--codex)', grokbot: 'var(--grokbot)' };

export function ProjectPanel({ id, selectedTaskId, onSelect, onHoverTask }: { id: string; selectedTaskId: string | null; onSelect: (id: string) => void; onHoverTask: (id: string | null) => void }) {
  const q = useApi(() => api.project(id), [id]);
  if (q.loading && !q.data) return <PanelSkeleton eyebrow={tt("선택한 프로젝트")} />;
  if (q.error || !q.data) return <PanelError error={q.error} onRetry={q.reload} />;
  return <ProjectBody p={q.data} selectedTaskId={selectedTaskId} onSelect={onSelect} onHoverTask={onHoverTask} />;
}

function ProjectBody({ p, selectedTaskId, onSelect, onHoverTask }: { p: ProjectDetail; selectedTaskId: string | null; onSelect: (id: string) => void; onHoverTask: (id: string | null) => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const { copyPrompt, continueIn } = useResume();
  const [otherOpen, setOtherOpen] = useState(false);
  const [showAllDone, setShowAllDone] = useState(false);
  const a = p.activity;
  const v = visualOf(a.statusVisual);
  const totalConv = p.byAi.reduce((s, x) => s + x.conversationCount, 0);
  const maxConv = Math.max(1, ...p.byAi.map((x) => x.conversationCount));
  const highlight = selectedTaskId ?? p.nextStep?.taskId ?? null;

  const { open, doneHidden } = useMemo(() => {
    const notDone = p.tasks.filter((t) => t.statusVisual !== 'done');
    const done = p.tasks.filter((t) => t.statusVisual === 'done');
    const shownDone = showAllDone ? done : done.slice(0, 1);
    return { open: [...notDone, ...shownDone], doneHidden: showAllDone ? [] : done.slice(1) };
  }, [p.tasks, showAllDone]);

  // 스파크라인 (최근 16주)
  const spark = p.weeklyConversations.buckets.map((b) => b.count);
  const W = 200, H = 40, mx = Math.max(1, ...spark);
  const pts = spark.map((c, i) => [spark.length > 1 ? (i * W) / (spark.length - 1) : 0, H - 4 - (c / mx) * (H - 10)] as const);
  const path = pts.length ? 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L') : '';
  const peak = spark.indexOf(mx);
  const months = [...new Set(p.weeklyConversations.buckets.map((b) => kst(b.start).m))].slice(-4).map((m) => ttf("{0}월", m));
  const color = accentOf(p.colorHex);

  return (
    <>
      <div className="ph">
        <span className="eyebrow">{tt("선택한 프로젝트")}</span>
        <div className="acts">
          {p.vault.obsidianUri ? <a className="obs" href={p.vault.obsidianUri} title={p.vault.path}><Icon name="note" />{tt("Obsidian 노트")}</a> : <span className="obs" title={p.vault.path}><Icon name="note" />{p.vault.path}</span>}
          <button className="ib" title={tt("이 프로젝트 링크 복사")} onClick={async () => { const ok = await copyText(`${location.origin}/?focus=${p.id}`); toast.show(ok ? tt("이 프로젝트 링크를 복사했어요") : tt("복사하지 못했어요"), { err: !ok }); }}><Icon name="link" /></button>
          <button className="ib" title={tt("프로젝트 노트 경로 복사")} onClick={async () => { await copyText(p.vault.path); toast.show(ttf("{0} 경로를 복사했어요", p.vault.path)); }}><Icon name="more" /></button>
        </div>
      </div>
      <h1>{p.name}</h1>
      <div className="meta">
        {v === 'stall' || v === 'stall2' ? <span className={v === 'stall' ? 'late' : 'warm'}><StatusGlyph v={v} />{a.staleDays ?? '?'}{tt("일째 멈춤")}</span>
          : v === 'run' ? <span className="ok"><StatusGlyph v="run" />{tt("진행 중")}</span> : <span><StatusGlyph v={v} />{tt(a.status)}</span>}
        {p.status !== 'active' && <span className="life">{p.status === 'paused' ? tt("잠시 멈춘 프로젝트") : tt("끝낸 프로젝트")}</span>}
        {p.startedAt && <span>{monthDay(p.startedAt)} {tt("시작")}</span>}
        {p.lastActivityAt && <span>{tt("마지막 활동")} {monthDay(p.lastActivityAt)}</span>}
        <span>{tt("과제")} {p.taskCount} {tt("· 대화")} {p.conversationCount}</span>
      </div>
      {p.summary && <p className="sum">{p.summary}</p>}

      <div className="two">
        <div className="spk">
          <div className="hd">{tt("주간 대화 수")} <b>{tt("최근")} {p.weeklyConversations.weeks}{tt("주")}</b></div>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ttf("주간 대화 수: {0}", spark.join(', '))}>
            {path && <path d={`${path} L${W} ${H} L0 ${H} Z`} fill={color} fillOpacity={0.16} />}
            {path && <path d={path} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />}
            {pts[peak] && <circle cx={pts[peak]![0]} cy={pts[peak]![1]} r={2.6} fill="#EDEDEB"><title>{ttf("{0} 주 · {1}개", p.weeklyConversations.buckets[peak]?.start, mx)}</title></circle>}
            {pts.length > 0 && <line x1={W - 0.5} y1={4} x2={W - 0.5} y2={H} stroke="#D08A66" strokeDasharray="2 2" />}
          </svg>
          <div className="ax">{months.map((m) => <span key={m}>{m}</span>)}</div>
        </div>
        <div>
          <div className="hd">{tt("AI별 대화")} <b>{totalConv}{tt("개")}</b></div>
          <div className="per">
            {p.byAi.map((x) => (
              <div key={x.sourceAi}><Svc ai={x.sourceAi} /><i className="b" style={{ width: `${Math.max(4, (x.conversationCount / maxConv) * 100)}%`, background: AI_VAR[x.sourceAi] ?? 'var(--ink4)', opacity: x.sourceAi === 'grok' ? 0.6 : 0.75 }} /><em>{x.conversationCount}</em></div>
            ))}
          </div>
        </div>
      </div>

      {p.nextStep && (
        <div className="next">
          <div className="hd">{tt("AI가 제안한 다음 단계")}</div>
          <p>{p.nextStep.text}</p>
          {p.nextStep.evidence ? <div className="why" title={p.nextStep.evidence.quote}>{tt("근거:")} {p.nextStep.evidence.label} — “{p.nextStep.evidence.quote}”</div>
            : <div className="why">{tt("과제:")} {p.nextStep.taskTitle}</div>}
          <div className="row">
            {p.nextStep.continue ? (
              <button className="btn pri" onClick={() => openExternal(p.nextStep!.continue!.url)}><Icon name="arrow" />{p.nextStep.continue.label}</button>
            ) : (
              <button className="btn pri" onClick={() => nav(`/tasks/${encodeURIComponent(p.nextStep!.taskId)}`)}><Icon name="arrow" />{tt("과제 열기")}</button>
            )}
            <button className="btn" onClick={() => copyPrompt(p.nextStep!.taskId)}><Icon name="copy" />{tt("맥락 프롬프트 복사")}</button>
            <button className="btn ghost" onClick={() => setOtherOpen((o) => !o)} aria-haspopup="menu" aria-expanded={otherOpen}>{tt("다른 AI로…")}</button>
            <Popover open={otherOpen} onClose={() => setOtherOpen(false)} style={{ right: 0, top: 36 }}>
              <div className="lab">{tt("맥락을 붙여 새 대화로")}</div>
              {SOURCE_AIS.filter((ai) => ai !== p.nextStep!.continue?.sourceAi).map((ai) => (
                <button key={ai} onClick={() => { setOtherOpen(false); continueIn(p.nextStep!.taskId, ai); }}><AiMark ai={ai} />{aiLabel(ai)}{tt("에서 이어서")}</button>
              ))}
            </Popover>
          </div>
        </div>
      )}

      <section className="tsec">
        <div className="hd"><span>{tt("과제")} <b>{p.taskCount}</b> {tt("· 멈춘 기간 순")}</span><span>{tt("AI\u00a0·\u00a0 첫 활동–마지막 \u00a0·\u00a0 멈춤")}</span></div>
        <table>
          <tbody>
            {open.map((t) => <TaskRow key={t.id} t={t} sel={t.id === highlight} onOpen={() => nav(`/tasks/${encodeURIComponent(t.id)}`)} onHover={onHoverTask} />)}
          </tbody>
        </table>
        {doneHidden.length > 0 && <button className="pmore" onClick={() => setShowAllDone(true)}>{tt("완료")} {doneHidden.length}{tt("개 더 보기 —")} {doneHidden.map((t) => t.title).join(', ')}</button>}
      </section>

      {p.relatedProjects.length > 0 && (
        <section className="rel">
          <div className="hd">{tt("관련 프로젝트")}</div>
          <ul>{p.relatedProjects.map((r) => <li key={r.project.id} onClick={() => onSelect(r.project.id)} title={tt("그래프에서 선택")}><b>{r.project.name}</b>{r.reason}</li>)}</ul>
        </section>
      )}
    </>
  );
}

export function TaskRow({ t, sel, onOpen, onHover }: { t: TaskListItem; sel: boolean; onOpen: () => void; onHover: (id: string | null) => void }) {
  const v = visualOf(t.statusVisual);
  const stale = v === 'stall' ? <b className="late">{t.badge ?? ttf("{0}일", t.staleDays)}</b> : v === 'stall2' ? <span>{t.badge ?? ttf("{0}일", t.staleDays)}</span>
    : v === 'run' ? <span className="ok">{tt("진행 중")}</span> : <span>{tt(t.status)}</span>;
  return (
    <tr className={`tr${sel ? ' sel' : ''}`} onClick={onOpen} onMouseEnter={() => onHover(t.id)} onMouseLeave={() => onHover(null)} title={tt("과제 상세 열기")}>
      <td className="c0"><StatusGlyph v={v} title={tt(t.status)} /></td>
      <td><div className="tt">{t.title}<TaskFlags handoff={t.handoff} classificationState={t.classificationState} outcome={t.conversationOutcome} completionReason={t.completionReason} short /></div>{t.summary && <div className="ts">{t.summary}</div>}</td>
      <td className="ais">{t.sourceAis.map((a) => <AiMark key={a} ai={a} />)}</td>
      <td className="dt">{t.startedAt ? dotDate(t.startedAt) : '—'}<span>–</span>{t.lastActivityAt ? dotDate(t.lastActivityAt) : '—'}</td>
      <td className="sd">{stale}</td>
    </tr>
  );
}
