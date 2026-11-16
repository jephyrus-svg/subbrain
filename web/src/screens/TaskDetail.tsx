import { tt, ttf } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { NextStepCard } from '../components/NextStep';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { McpWrites } from '../components/McpWrites';
import type { FlowQuery, ResumePromptResponse, SourceAi, TaskDetail as TTaskDetail, TaskStatus } from '@subbrain/shared';
import { api } from '../api/endpoints';
import { useApi } from '../api/useApi';
import { errorText } from '../api/client';
import { useAppData } from '../components/AppData';
import { DataModeNote } from '../components/DataModeNote';
import { Icon } from '../components/Icons';
import { AiMark, StatusGlyph, Svc } from '../components/Marks';
import { Md } from '../components/Md';
import { Popover } from '../components/Popover';
import { useToast } from '../components/Toast';
import { GraphView } from '../graph/GraphView';
import { CompletionTag, BlockedBadge, HandoffBadge, OutcomeBadge, blockedSentence, completionText, movedTarget } from '../components/TaskBadges';
import { copyText, openExternal } from '../lib/clipboard';
import { aiLabel, dotDate, fullDateTime, monthDay, monthDayWd, visualOf, weekday } from '../lib/format';
import { accentOf } from '../design/tokens';
import '../styles/detail.css';

const FILTERS: Array<{ k: NonNullable<FlowQuery['filter']>; label: string }> = [{ k: 'all', label: tt("전체") }, { k: 'excerpts', label: tt("발췌만") }, { k: 'decisions', label: tt("결정만") }];
const STATUS_CHOICES: TaskStatus[] = ["진행 중", "멈춤", "완료"];
const DETECTED: Record<string, string> = { llm: tt("AI 분류"), rule: tt("문장 규칙"), both: tt("AI 분류 · 문장 규칙") };
/** 1.1.0 보정 전 확신도: 코어가 0.05–0.95로 자르고 규칙과 다르면 낮춘다. 보정됐을 때만 원래 값을 덧붙인다 */
const rawNote = (c: number, raw: number | null | undefined) => (raw != null && Math.abs(raw - c) >= 0.005 ? ttf(" (보정 전 {0})", raw.toFixed(2)) : '');

export default function TaskDetail() {
  const { taskId = '' } = useParams();
  const task = useApi(() => api.task(taskId), [taskId]);
  if (task.loading && !task.data) return <div className="detail"><div className="state">{tt("과제를 불러오는 중…")}</div></div>;
  if (task.error || !task.data) return (
    <div className="detail"><div className="state err" style={{ height: '100%' }}><b>{tt("과제를 불러오지 못했어요")}</b><span>{errorText(task.error)}</span>
      <span style={{ display: 'flex', gap: 8 }}><button className="btn" onClick={task.reload}>{tt("다시 시도")}</button><Link className="btn" to="/">{tt("그래프로")}</Link></span></div></div>
  );
  return <DetailBody key={taskId} t={task.data} setT={(fn) => task.setData((d) => (d ? fn(d) : d))} reload={task.reload} />;
}

function DetailBody({ t, setT, reload }: { t: TTaskDetail; setT: (fn: (d: TTaskDetail) => TTaskDetail) => void; reload: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const { meta, refresh } = useAppData();
  const [filter, setFilter] = useState<NonNullable<FlowQuery['filter']>>('all');
  const flow = useApi(() => api.flow(t.id, { filter }), [t.id, filter]);
  const miniRaw = useApi(() => api.graph({ focus: t.id, depth: 2, includeQuick: false }), [t.id]);
  // 미니 그래프: 이 과제의 프로젝트 안쪽 + 이 과제와 바로 이어진 주제만 (다른 프로젝트까지 펼치면 너무 작아진다)
  const miniData = useMemo(() => {
    const g = miniRaw.data; if (!g) return null;
    const pid = t.project?.id ?? null;
    const direct = new Set<string>();
    for (const e of g.edges) { if (e.source === t.id) direct.add(e.target); if (e.target === t.id) direct.add(e.source); }
    const keep = new Set(g.nodes.filter((n) => n.id === t.id || (pid && n.projectId === pid) || (n.type !== 'project' && n.type !== 'task' && direct.has(n.id))).map((n) => n.id));
    if (keep.size < 3) return g;
    return { ...g, nodes: g.nodes.filter((n) => keep.has(n.id)), edges: g.edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
  }, [miniRaw.data, t.id, t.project?.id]);
  const mini = { ...miniRaw, data: miniData };
  const [statusOpen, setStatusOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const v = visualOf(t.stale.statusVisual);
  // 1.6.0: 과제 상세가 대표 대화 결과(conversationOutcome)와 대화별 결과(conversationOutcomes)를 직접 준다 — 대화 상세를 따로 부르지 않음
  const outcome = t.conversationOutcome ?? null;
  const outcomes = t.conversationOutcomes ?? [];
  const ended = t.completionReason === 'done' || t.completionReason === 'moved';
  const stage = meta?.staleStages.find((s) => s.key === t.stale.staleStage);
  const tint = t.project?.colorHex ? `${accentOf(t.project.colorHex)}1A` : undefined;

  /** 상태 바꾸기(PATCH → overrides에 status). 되돌리기는 원래 고정값이 없었으면 고정 풀기(§8.6), 있었으면 이전 값으로 */
  const changeStatus = async (status: TaskStatus, opts: { isUndo?: boolean; note?: string } = {}) => {
    setBusy(true); setStatusOpen(false);
    const hadOverride = t.overrides.includes('status');
    try {
      const r = await api.updateTask(t.id, { status, note: opts.note ?? tt("과제 상세에서 바꿈") });
      setT(() => r.task); refresh();
      const from = (r.event.payload as { from?: TaskStatus }).from ?? t.status;
      const undo = opts.isUndo ? undefined : { label: tt("되돌리기"), run: () => void (hadOverride ? changeStatus(from, { isUndo: true, note: tt("되돌리기") }) : releaseStatus(true)) };
      if (status === '보관') toast.show(tt("보관했어요 · 언제든 보관 해제 가능"), { action: undo });
      else toast.show(opts.isUndo ? ttf("‘{0}’(으)로 되돌렸어요", status) : ttf("상태를 ‘{0}’(으)로 바꿨어요 — 이제 자동 분류가 이 값을 바꾸지 않아요", status), { action: undo });
    } catch (e) { toast.show(errorText(e), { err: true }); }
    finally { setBusy(false); }
  };
  /** 고정 풀기: 규칙 엔진이 다시 계산한 상태로 */
  const releaseStatus = async (quiet = false): Promise<TTaskDetail | null> => {
    setBusy(true); setStatusOpen(false);
    try {
      const d = await api.resetOverrides(t.id, { fields: ['status'] });
      setT(() => d); refresh();
      if (!quiet) toast.show(ttf("자동 분류에 맡겼어요 — 지금은 ‘{0}’", d.status));
      else toast.show(ttf("되돌렸어요 — 지금은 ‘{0}’", d.status));
      return d;
    } catch (e) { toast.show(errorText(e), { err: true }); return null; }
    finally { setBusy(false); }
  };
  /** 보관 해제: 직접 보관한 것이면 고정 풀기(원래 상태로 계산), 그래도 보관이거나 규칙이 보관한 것이면 '멈춤'으로 */
  const unarchive = async () => {
    if (t.overrides.includes('status')) {
      const d = await releaseStatus(true);
      if (!d || d.status !== '보관') return;
    }
    await changeStatus("멈춤", { note: tt("보관 해제"), isUndo: true });
  };

  const toggleQuestion = async (qid: string, resolved: boolean) => {
    setT((d) => ({ ...d, openQuestions: d.openQuestions.map((q) => (q.id === qid ? { ...q, resolved } : q)) }));
    try {
      const r = await api.updateOpenQuestion(t.id, qid, { resolved });
      setT((d) => ({ ...d, openQuestions: d.openQuestions.map((q) => (q.id === qid ? r : q)) }));
    } catch (e) {
      setT((d) => ({ ...d, openQuestions: d.openQuestions.map((q) => (q.id === qid ? { ...q, resolved: !resolved } : q)) }));
      toast.show(errorText(e), { err: true });
    }
  };

  const openCount = t.openQuestions.filter((q) => !q.resolved).length;
  const validDecisions = t.decisions.filter((d) => d.valid);
  const items = flow.data?.items ?? [];
  const totalConv = flow.data?.totalConversations ?? t.conversationCount;

  return (
    <div className="detail">
      <section className="sub" style={tint ? ({ ['--subtint' as string]: tint } as React.CSSProperties) : undefined}>
        <div className="crumb">
          {t.breadcrumb.map((b, k) => (
            <span key={k} style={{ display: 'contents' }}>
              {k > 0 && <span>/</span>}
              {b.href ? <Link to={b.href}>{k === 0 && <Icon name="back" />}{b.label}</Link> : <span>{b.label}</span>}
            </span>
          ))}
        </div>
        <div className="ttl">
          <h1 title={t.title}>{t.title}</h1>
          {v === 'stall' || v === 'stall2' ? <span className={`stt${v === 'stall2' ? ' warm' : ''}`}><StatusGlyph v={v} />{t.stale.staleDays}{tt("일째 멈춤")}</span>
            : v === 'run' ? <span className="stt ok"><StatusGlyph v="run" />{tt("진행 중")}</span> : <span className="stt plain"><StatusGlyph v={v} />{tt(t.status)}</span>}
          {(outcome || t.handoff || t.classificationState === 'blocked' || completionText(t.completionReason)) && <span className="flags"><CompletionTag reason={t.completionReason} target={movedTarget(t)} />{ended ? null : outcome ? <OutcomeBadge o={outcome} /> : <HandoffBadge h={t.handoff} />}<BlockedBadge state={t.classificationState} reason={t.classification?.blockedReason} model={t.classification?.blockedModel} /></span>}
          <span className="m">{t.startedAt ? ttf("{0} 시작", monthDay(t.startedAt)) : ''}{t.lastConversationAt ? ttf(" · 마지막 대화 {0}", monthDayWd(t.lastConversationAt)) : ''}{t.overrides.includes('status') ? tt(" · 상태 직접 고정") : ''}</span>
          <div className="acts">
            <button className="btn" disabled={!t.vault.obsidianUri} title={t.vault.path} onClick={() => openExternal(t.vault.obsidianUri)}><Icon name="note" />{tt("Obsidian 노트")}</button>
            <button className="btn" disabled={busy} onClick={() => setStatusOpen((o) => !o)} aria-haspopup="menu" aria-expanded={statusOpen}>{tt("상태 바꾸기")}</button>
            <Popover open={statusOpen} onClose={() => setStatusOpen(false)} style={{ right: 70, top: 38 }}>
              <div className="lab">{tt("직접 고르면 자동 분류가 바꾸지 않아요")}</div>
              {STATUS_CHOICES.map((s) => (
                <button key={s} className={s === t.status ? 'on' : ''} onClick={() => void changeStatus(s)}>
                  <StatusGlyph v={s === '진행 중' ? 'run' : s === '멈춤' ? (v === 'stall2' ? 'stall2' : 'stall') : 'done'} />{tt(s)}{s === t.status && tt(" · 지금")}
                </button>
              ))}
              {t.overrides.includes('status') && <button onClick={() => void releaseStatus()}><Icon name="rotate" />{tt("고정 풀기 · 자동 분류에 맡기기")}</button>}
            </Popover>
            {t.status === '보관'
              ? <button className="btn" disabled={busy} onClick={() => void unarchive()}><Icon name="archive" />{tt("보관 해제")}</button>
              : <button className="btn" disabled={busy} onClick={() => void changeStatus("보관", { note: tt("과제 상세에서 보관") })}><Icon name="archive" />{tt("보관")}</button>}
          </div>
        </div>
      </section>

      <div className="cols">
        <aside className="side scroll">
          <div className="hd">{tt("그래프 속 위치")} <b>{tt("이웃")} {t.neighborCount}</b></div>
          <div className="mini">
            {mini.data && mini.data.nodes.length > 0 && (
              <GraphView compact data={mini.data} selectedId={t.id} ariaLabel={tt("주변 그래프")}
                onSelect={(id, n) => { if (n.type === 'task' && id !== t.id) nav(`/tasks/${encodeURIComponent(id)}`); else if (n.type !== 'task') nav(`/?focus=${encodeURIComponent(id)}`); }} />
            )}
            {mini.error != null && <div className="state" style={{ fontSize: 11.5 }}>{tt("주변 그래프를 불러오지 못했어요")}</div>}
          </div>
          <dl>
            <dt>{tt("상태")}</dt>
            <dd>{v === 'stall' || v === 'stall2' ? <><span className={v === 'stall' ? 'late' : 'warm'}>{tt("멈춤 ·")} {(stage?.labelKo ? tt(stage.labelKo) : null) ?? tt("방치")} {tt("단계")}</span> {stage && <small>({stage.minDays}~{stage.maxDays ?? ''}{tt("일)")}</small>}</>
              : <span className={v === 'run' ? 'ok' : ''}>{tt(t.status)}</span>}
              {completionText(t.completionReason) && <> <CompletionTag reason={t.completionReason} target={movedTarget(t)} /></>}{t.statusSource === 'user' && <small> {tt("· 직접 고정")}</small>}</dd>
            {outcome && <><dt>{tt("대화 결과")}</dt><dd className="hof"><OutcomeBadge o={outcome} />{outcome.evidence && <small>“{outcome.evidence}”</small>}<small>{tt("대화 기준 · 과제 상태와 별개")}</small></dd></>}
            {outcomes.length > 1 && <><dt>{tt("대화별 결과")}</dt><dd className="ocl"><ul>{outcomes.map((c) => (
              <li key={c.conversationId}><AiMark ai={c.sourceAi} /><Link to={`/conversations/${encodeURIComponent(c.conversationId)}`} title={c.title}>{c.title}</Link><OutcomeBadge o={c.outcome} />{c.role === 'shared' && <small>{tt("공유")}</small>}</li>
            ))}</ul><small>{outcomes.filter((c) => c.role === 'primary').every((c) => c.outcome.outcome === 'done' || c.outcome.outcome === 'moved') ? tt("주 대화가 모두 끝남 → 과제 완료") : tt("주 대화가 하나라도 남아 있으면 과제는 완료가 아니에요")}</small></dd></>}
            {t.handoff && <><dt>{tt("이어간 곳")}</dt><dd className="hof"><HandoffBadge h={t.handoff} />{t.handoff.evidence && <small>“{t.handoff.evidence}”</small>}<small>{t.completionReason === 'moved' ? tt("옮겨서 이 과제는 끝남") : tt("아직 끝난 일 아님")} {tt("· 감지:")} {DETECTED[t.handoff.detectedBy] ?? t.handoff.detectedBy}</small></dd></>}
            <dt>{tt("프로젝트")}</dt><dd>{t.project ? <Link to={`/?focus=${t.project.id}`}>{t.project.name}</Link> : <small>{tt("없음")}</small>}</dd>
            <dt>{tt("첫 대화")}</dt><dd>{t.firstConversationAt ? fullDateTime(t.firstConversationAt) : '—'}</dd>
            <dt>{tt("마지막 대화")}</dt><dd>{t.lastConversationAt ? fullDateTime(t.lastConversationAt) : '—'}</dd>
            <dt>{tt("대화 · 메시지")}</dt><dd>{t.conversationCount}{tt("개 ·")} {t.messageCount}{tt("개")}</dd>
            <dt>{tt("AI별")}</dt>
            <dd className="aic">{t.byAi.map((a, k) => (
              <span key={a.sourceAi}><Svc ai={a.sourceAi} /><b>{a.conversationCount}</b> <small>· {a.messageCount}{tt("개")}{k === 0 ? tt(" 메시지") : ''}{a.sharedConversationCount > 0 ? tt(" (공유 대화)") : ''}</small></span>
            ))}</dd>
            {t.topics.length > 0 && <><dt>{tt("주제")}</dt><dd className="tags">{t.topics.map((x) => <button key={x.id} onClick={() => nav(`/?focus=${encodeURIComponent(x.id)}`)}>#{x.name}</button>)}</dd></>}
            {t.classificationState === 'blocked' && <><dt>{tt("분류")}</dt><dd><div className="blkn"><b>{tt("분류 불가")}</b> — {blockedSentence(t.classification?.blockedReason ?? null, t.classification?.blockedModel ?? null)}</div></dd></>}
            {t.classification && <><dt>{tt("분류 근거")}</dt><dd><small>{t.classification.evidence ? `${t.classification.evidence} · ` : ''}{tt("신뢰도")} {t.classification.confidence.toFixed(2)}{rawNote(t.classification.confidence, t.classification.rawConfidence)}{t.classification.needsReview ? tt(" · 확인 필요") : ''}</small></dd></>}
          </dl>
          <a className="obsn" href={t.vault.obsidianUri ?? undefined} title={tt("Obsidian에서 열기")}><Icon name="note" /><div>{tt("볼트 노트")}<small>{t.vault.path}</small></div></a>
        </aside>

        <div className="flowwrap">
          <main className="flow scroll">
            {t.kind === 'task' && <NextStepCard t={t} onChange={(d) => setT(() => d)} />}
            <div className="fhd">
              <h2>{tt("대화 흐름")}</h2><span>{tt("최근 것부터 ·")} {totalConv}{tt("개 대화")}</span>
              <div className="flt" role="tablist">{FILTERS.map((f) => <button key={f.k} role="tab" aria-selected={filter === f.k} className={filter === f.k ? 'on' : ''} onClick={() => setFilter(f.k)}>{f.label}</button>)}</div>
            </div>
            {flow.data && flow.data.today.daysSinceLastConversation > 0 && (
              <div className={`today${v === 'run' || v === 'done' ? ' calm' : ''}`}><div className="d">{tt("오늘")}</div><div className="t"><span>{monthDay(flow.data.today.date)} — {flow.data.today.daysSinceLastConversation}{tt("일째 대화 없음")}</span></div></div>
            )}
            {flow.loading && !flow.data && <div className="state">{tt("대화 흐름을 불러오는 중…")}</div>}
            {flow.error != null && <div className="state err"><b>{tt("대화 흐름을 불러오지 못했어요")}</b><span>{errorText(flow.error)}</span><button className="btn" onClick={flow.reload}>{tt("다시 시도")}</button></div>}
            {flow.data && items.length === 0 && <div className="state">{filter === 'all' ? tt("아직 이어진 대화가 없어요.") : filter === 'excerpts' ? tt("발췌가 있는 대화가 없어요.") : tt("결정이 나온 대화가 없어요.")}</div>}
            {items.map((e) => (
              <div key={e.conversationId}>
                {e.gapDaysFromNewer > 0 && <div className="gap"><span>{e.gapDaysFromNewer}{tt("일")}</span></div>}
                <div className="ent">
                  <div className="d" title={ttf("{0} 시작 · {1} 마지막 메시지 (날짜는 마지막 메시지 기준)", fullDateTime(e.createdAt), fullDateTime(e.updatedAt))}><b>{dotDate(e.date)}</b><small>{weekday(e.date)}{tt("요일")}</small></div>
                  <div className="b"><AiMark ai={e.sourceAi} />
                    <div className="eh">
                      <h3>{e.title}</h3><span className="sv">{aiLabel(e.sourceAi)}</span><span className="n">{tt("메시지")} {e.messageCount}</span>
                      {e.isStartOfTask && <span className="start">{tt("시작")}</span>}
                      {!e.isPrimary && e.sharedWithTasks.length > 0 && (
                        <span className="shared">{e.sharedWithTasks.map((s, k) => <span key={s.id}>{k > 0 && ', '}<Link to={`/tasks/${encodeURIComponent(s.id)}`}>‘{s.title}’</Link></span>)}{tt("과 공유")}</span>
                      )}
                      <Link className="cvl" to={`/conversations/${encodeURIComponent(e.conversationId)}`}>{tt("대화 보기")}</Link>{e.sourceUrl ? <a href={e.sourceUrl} target="_blank" rel="noreferrer">{tt("원래 대화")} <Icon name="arrow" /></a> : <a style={{ color: 'var(--ink4)' }} title={tt("원래 대화 주소가 없어요")}>{tt("원래 대화 없음")}</a>}
                    </div>
                    {e.summary && <p className="es">{e.summary}</p>}
                    {e.excerpts.map((x, k) => (
                      <div key={k} className={`q${x.role === 'user' ? ' me' : ''}`} title={x.isEvidence ? tt("분류 근거가 된 문장") : undefined}>
                        <span className="who">{x.speakerLabel}</span><Md src={x.textMd} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </main>
        </div>

        <aside className="right scroll">
          {t.whyStalled && t.whyStalled.chain.length > 0 && (
            <div className="wst">
              <h2>{tt("왜 멈췄나")} <span>{tt("막힘 사슬")} {Math.max(...t.whyStalled.chain.map((c) => c.depth))}{tt("단계 · 관계에서")}</span></h2>
              <ol className="wchain">{t.whyStalled.chain.map((c) => (
                <li key={`${c.depth}-${c.nodeId}`} style={{ paddingLeft: (c.depth - 1) * 12 }}>
                  <em>{tt("막혔음 →")}</em><Link to={`/ontology?focus=${encodeURIComponent(c.nodeId)}`}>{c.label}</Link><small>{tt("확신도")} {c.confidence.toFixed(2)}</small>
                </li>
              ))}</ol>
              {t.whyStalled.rootCause && <p>{tt("끝에 있는 원인:")} <b>{t.whyStalled.rootCause}</b></p>}
              <div className="row">
                {t.whyStalled.lastRelatedConversationId && <Link className="lnk" to={`/conversations/${encodeURIComponent(t.whyStalled.lastRelatedConversationId)}`}>{tt("마지막 관련 대화")}</Link>}
                <Link className="lnk" to={`/ontology?focus=${encodeURIComponent(t.whyStalled.chain[0]!.nodeId)}`}>{tt("관계 그래프에서 보기")}</Link>
              </div>
            </div>
          )}
          <h2>{tt("결정한 것")} <span>{validDecisions.length}{tt("개 · 대화에서 자동 추출")}</span></h2>
          {t.decisions.length === 0 ? <div className="state" style={{ padding: '10px 0', alignItems: 'flex-start' }}>{tt("아직 뽑힌 결정이 없어요.")}</div> : (
            <ol className="dec">{t.decisions.map((d) => (
              <li key={d.id} className={d.valid ? '' : 'off'}><span>{d.text}</span><small>{d.sourceAi && <AiMark ai={d.sourceAi} />}{d.decidedAt ? dotDate(d.decidedAt) : ''}</small></li>
            ))}</ol>
          )}
          <div className="sec">
            <h2>{tt("아직 열린 질문")} <span>{openCount}{tt("개")}</span></h2>
            {t.openQuestions.length === 0 ? <div className="state" style={{ padding: '10px 0', alignItems: 'flex-start' }}>{tt("열린 질문이 없어요.")}</div> : (
              <ul className="open">{t.openQuestions.map((q) => (
                <li key={q.id} className={q.resolved ? 'done' : ''}>
                  <button className={`cbx${q.resolved ? ' on' : ''}`} role="checkbox" aria-checked={q.resolved} aria-label={q.resolved ? tt("다시 열기") : tt("해결로 표시")} onClick={() => void toggleQuestion(q.id, !q.resolved)} />
                  <span>{q.text}{q.note && <small>{q.note}</small>}</span>
                </li>
              ))}</ul>
            )}
          </div>
          <ResumeBox key={t.nextStepInfo?.text ?? t.nextStep ?? ""} t={t} onReload={reload} />
          <div className="sec"><McpWrites taskId={t.id} /></div>
          {(t.related.similarTasks.length > 0 || t.related.wikiPages.length > 0) && (
            <div className="sec">
              <h2>{tt("함께 보면 좋은 것")} <span>{tt("같은 주제")}</span></h2>
              <ul className="open rel">
                {t.related.similarTasks.map((s) => (
                  <li key={s.id} onClick={() => nav(`/tasks/${encodeURIComponent(s.id)}`)}><b>↳</b><span>{s.projectName ? `${s.projectName} › ` : ''}{s.title} <small style={{ display: 'inline', marginLeft: 6 }}>{s.sourceAi ? `${aiLabel(s.sourceAi)} · ` : ''}{s.status}{s.completedAt ? ` ${dotDate(s.completedAt)}` : ''}</small></span></li>
                ))}
                {t.related.wikiPages.map((w) => (
                  <li key={w.id} onClick={() => toast.show(tt("위키는 다음 단계(Phase 5)에서 열려요"))}><b>↳</b><span>{tt("위키 ›")} {w.title} <small style={{ display: 'inline', marginLeft: 6 }}>{w.reviewLabel}</small></span></li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
      <DataModeNote style={{ left: 32, bottom: 8 }} />
    </div>
  );
}

/** 이어서 하기: AI 탭 4개 · 맥락 프롬프트 · 이어서/복사 (GET /tasks/:id/resume-prompt?targetAi=) */
function ResumeBox({ t }: { t: TTaskDetail; onReload: () => void }) {
  const toast = useToast();
  const [target, setTarget] = useState<SourceAi>(t.resume.defaultTargetAi);
  const [prompts, setPrompts] = useState<Partial<Record<SourceAi, ResumePromptResponse>>>({});
  const [expanded, setExpanded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isDefault = target === t.resume.defaultTargetAi;
  useEffect(() => {
    if (isDefault || prompts[target]) return;
    let live = true; setErr(null);
    api.resumePrompt(t.id, target).then((r) => { if (live) setPrompts((p) => ({ ...p, [target]: r })); }).catch((e) => { if (live) setErr(errorText(e)); });
    return () => { live = false; };
  }, [target, isDefault, prompts, t.id]);
  const text = isDefault ? t.resume.promptPreview : prompts[target]?.prompt ?? '';
  const cont = isDefault ? t.resume.continue : prompts[target]?.continue ?? null;
  const newUrl = prompts[target]?.newChatUrl;

  const getFull = async () => {
    // 미리보기는 줄임본일 수 있어 복사·이어서는 전체 프롬프트를 새로 받는다
    const r = prompts[target] ?? await api.resumePrompt(t.id, target);
    setPrompts((p) => ({ ...p, [target]: r })); return r;
  };
  const copy = async () => {
    try { const r = await getFull(); const ok = await copyText(r.prompt); toast.show(ok ? ttf("{0}용 맥락 프롬프트를 복사했어요", aiLabel(target)) : tt("복사하지 못했어요"), { err: !ok }); }
    catch (e) { toast.show(errorText(e), { err: true }); }
  };
  const go = async () => {
    try {
      const r = await getFull();
      if (r.continue) { openExternal(r.continue.url); return; }
      await copyText(r.prompt); openExternal(r.newChatUrl);
      toast.show(ttf("새 {0} 대화를 열었어요 — 복사한 프롬프트를 붙여 넣으세요", aiLabel(target)));
    } catch (e) { toast.show(errorText(e), { err: true }); }
  };
  const lines = useMemo(() => text.split('\n'), [text]);
  return (
    <div className="cont">
      <div className="hd" style={{ marginBottom: 8 }}>{tt("이어서 하기")} <b>{tt("맥락을 붙여서 새 대화 시작")}</b></div>
      <div className="seg" role="tablist" aria-label={tt("이어서 할 AI")}>
        {t.resume.targets.map((ai) => <button key={ai} role="tab" aria-selected={ai === target} className={ai === target ? 'on' : ''} onClick={() => setTarget(ai)}><AiMark ai={ai} />{aiLabel(ai)}</button>)}
      </div>
      <div className={`pre${expanded ? ' open' : ''}`} onClick={() => setExpanded((x) => !x)} title={expanded ? tt("접기") : tt("펼쳐서 전체 보기")}>
        {err ? <span style={{ color: 'var(--accent)' }}>{err}</span> : !text ? tt("프롬프트를 만드는 중…") : lines.map((l, k) => {
          const m = /^(\[[^\]]+\]|[^:：]{1,12}[:：])(.*)$/.exec(l);
          return <span key={k}>{m ? <><b>{m[1]}</b>{m[2]}</> : l}{k < lines.length - 1 ? '\n' : ''}</span>;
        })}
      </div>
      <div className="row">
        <button className="btn pri" onClick={() => void go()}><Icon name="arrow" />{cont ? cont.label : ttf("{0}에서 새로 이어서", aiLabel(target))}</button>
        <button className="btn" onClick={() => void copy()}><Icon name="copy" />{tt("복사")}</button>
        <small>{isDefault ? t.resume.continueNote ?? '' : cont ? tt("원래 대화에 이어 붙임") : ttf("새 대화에 붙여 넣어요{0}", newUrl ? '' : '')}</small>
      </div>
    </div>
  );
}
