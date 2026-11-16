import { tt, ttf } from '../i18n';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { DigestResponse, TaskRef } from '@subbrain/shared';
import { api } from '../api/endpoints';
import { useApi } from '../api/useApi';
import { ApiRequestError, errorText } from '../api/client';
import { useAppData } from '../components/AppData';
import { DataModeNote } from '../components/DataModeNote';
import { Icon } from '../components/Icons';
import { AiMark, Sphere, Svc } from '../components/Marks';
import { Popover } from '../components/Popover';
import { useToast } from '../components/Toast';
import { aiLabel, mix, monthDay, monthDayWeekday, relative, timeKo, visualOf } from '../lib/format';
import { now } from '../lib/clock';
import { useResume } from '../lib/resume';
import { CleanupPanel } from './digest/CleanupPanel';
import { ProjectSuggestionCard } from '../components/ProjectSuggestionCard';
import { accentOf } from '../design/tokens';
import '../styles/digest.css';

export default function Digest() {
  const { date = 'today' } = useParams();
  const q = useApi(() => api.digest(date), [date]);
  if (q.loading && !q.data) return <div className="wrap"><div className="state">{tt("요약을 불러오는 중…")}</div></div>;
  if (date === 'today' && q.error instanceof ApiRequestError && q.error.status === 404) return (
    <div className="wrap" style={{ display: 'block' }}><div className="state"><b>{tt("아직 만든 요약이 없어요")}</b>
      <span>{tt("요약은 매일 아침 8시에, 전날 대화를 모아 만들어요. 대화를 가져오고 나면 내일 아침부터 여기에 나와요.")}</span>
      <span style={{ display: 'flex', gap: 8 }}><Link className="btn" to="/">{tt("그래프 보기")}</Link><button className="btn" onClick={q.reload}>{tt("다시 확인")}</button></span></div></div>
  );
  if (q.error || !q.data) return (
    <div className="wrap" style={{ display: 'block' }}><div className="state err"><b>{tt("요약을 불러오지 못했어요")}</b><span>{errorText(q.error)}</span>
      <span style={{ display: 'flex', gap: 8 }}><button className="btn" onClick={q.reload}>{tt("다시 시도")}</button><Link className="btn" to="/digest">{tt("오늘 요약")}</Link></span></div></div>
  );
  return <DigestBody key={q.data.date} d={q.data} reload={q.reload} />;
}

const ACTION_CLASS: Record<string, string> = { completed: 'd', stalled: 's' };
const HEALTH: Record<string, [string, string]> = { ok: [tt("정상"), ''], degraded: [tt("주의"), 'w'], broken: [tt("고장"), 'bad'] };

function DigestBody({ d, reload }: { d: DigestResponse; reload: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const { refresh } = useAppData();
  const { copyPrompt, continueIn } = useResume();
  const [listOpen, setListOpen] = useState(false);
  const list = useApi(() => (listOpen ? api.digests() : Promise.resolve(null)), [listOpen]);
  const [neglectAsk, setNeglectAsk] = useState(false);
  const [handled, setHandled] = useState<Record<string, string>>({});
  const openTask = (id: string) => nav(`/tasks/${encodeURIComponent(id)}`);

  const decide = async (t: TaskRef, status: '진행 중' | '보관') => {
    try {
      await api.updateTask(t.id, { status, note: tt("오늘의 요약 — 오래 방치 질문") });
      setHandled((h) => ({ ...h, [t.id]: status === '보관' ? tt("보관함 · 언제든 보관 해제 가능") : tt("계속하기로 함") })); refresh();
    } catch (e) { toast.show(errorText(e), { err: true }); }
  };
  // 요약은 아침에 만든 사진이라 그 뒤에 처리한 합치기 제안이 'pending'으로 남아 있을 수 있다 → 지금 상태(GET /merge-suggestions)와 맞춰 본다
  const pendingNow = useApi(() => (d.pendingMergeSuggestions.length ? api.mergeSuggestions({ state: 'pending' }) : Promise.resolve(null)), [d.date, d.pendingMergeSuggestions.length]);
  const [mergeDone, setMergeDone] = useState<Record<string, 'accepted' | 'rejected' | 'gone'>>({});
  const merges = d.pendingMergeSuggestions.filter((m) => !mergeDone[m.id] && (!pendingNow.data || pendingNow.data.items.some((x) => x.id === m.id)));
  const merge = async (id: string, accept: boolean) => {
    try {
      const r = accept ? await api.acceptMerge(id) : await api.rejectMerge(id);
      setMergeDone((x) => ({ ...x, [id]: r.suggestion.state === 'accepted' ? 'accepted' : 'rejected' }));
      toast.show(accept ? ttf("두 과제를 합쳤어요 — ‘{0}’", r.task.title) : tt("다른 과제로 둘게요 · 다시 제안하지 않아요"), accept ? { action: { label: tt("열기"), run: () => openTask(r.task.id) } } : undefined);
      refresh();
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 409) { setMergeDone((x) => ({ ...x, [id]: 'gone' })); toast.show(tt("이미 처리된 제안이에요")); refresh(); return; }
      toast.show(errorText(e), { err: true });
    }
  };

  // 1.1.0 새 프로젝트 제안(§7.7 "요약에서 한 번 눌러 승인") — 합치기와 같이 지금 상태와 맞춰 본다
  const psList = d.pendingProjectSuggestions ?? [];
  const psNow = useApi(() => (psList.length ? api.projectSuggestions({ state: 'pending', ready: true }) : Promise.resolve(null)), [d.date, psList.length]);
  const [psDone, setPsDone] = useState<Record<string, true>>({});
  const projectSuggestions = psList.filter((x) => !psDone[x.id] && (!psNow.data || psNow.data.items.some((y) => y.id === x.id)));

  const s = d.strip;
  const qTotal = d.quickQuestionsByAi.reduce((a, x) => a + x.count, 0);
  return (
    <div className="wrap">
      <section className="paper scroll">
        <div className="mast">
          <div className="l"><span className="eyebrow">{tt("오늘의 요약 ·")} {timeKo(d.generatedAt)}{tt("에 만들어짐")}</span><h1>{d.title}</h1></div>
          <div className="r">
            {d.prevDate && <Link to={`/digest/${d.prevDate}`}><Icon name="back" />{monthDay(d.prevDate)}</Link>}
            {d.nextDate && <Link to={`/digest/${d.nextDate}`}>{monthDay(d.nextDate)}<Icon name="chev" /></Link>}
            <button onClick={() => setListOpen((o) => !o)} aria-haspopup="menu" aria-expanded={listOpen}>{tt("지난 요약 모두")}</button>
            <Popover open={listOpen} onClose={() => setListOpen(false)} style={{ right: 120, top: 26, width: 300 }}>
              <div className="lab">{tt("지난 요약")}</div>
              {list.loading && <div className="lab" style={{ fontWeight: 400 }}>{tt("불러오는 중…")}</div>}
              {list.data?.items.map((it) => (
                <button key={it.date} className={it.date === d.date ? 'on' : ''} onClick={() => { setListOpen(false); nav(`/digest/${it.date}`); }}>
                  <span style={{ flex: 1 }}>{it.title}</span><small style={{ color: 'var(--ink3)' }}>{tt("대화")} {it.strip.yesterdayConversations} {tt("· 완료")} {it.strip.completedTasks}</small>
                </button>
              ))}
              {list.data?.page.hasMore && <div className="lab" style={{ fontWeight: 400 }}>{tt("외")} {(list.data.page.total ?? 0) - list.data.items.length}{tt("개 더")}</div>}
            </Popover>
            <a href={d.vault.obsidianUri ?? undefined} title={tt("Obsidian에서 열기")}><Icon name="note" />{d.vault.path}</a>
          </div>
        </div>
        <div className="strip">
          <div>{tt("어제 대화")} <b>{s.yesterdayConversations}</b></div><div>{tt("끝낸 과제")} <b>{s.completedTasks}</b></div>
          <div>{tt("새로 멈춘 일")} <b className={s.newlyStalled > 0 ? 'late' : ''}>{s.newlyStalled}</b></div><div>{tt("간단한 질문")} <b>{s.quickQuestions}</b></div>
          <div>{tt("수집 공백")} <b className={s.collectionGap.hasGap ? 'late' : ''}>{s.collectionGap.label}</b></div>
        </div>
        <div className="dgrid">
          <div>
            <h2>{tt("어제 있었던 일")} <span>{monthDayWeekday(d.yesterday.date)}</span></h2>
            <p className="lead">{d.yesterday.narrative}</p>
            {d.yesterday.events.length > 0 && (
              <ul className="ev">{d.yesterday.events.map((e, k) => (
                <li key={k}>
                  <span className="t">{e.timeLabel}</span>{e.sourceAi ? <AiMark ai={e.sourceAi} /> : <i />}
                  <span><em className={ACTION_CLASS[e.action] ?? ''}>{e.actionLabel}</em>
                    {e.project && <Sphere color={accentOf(e.project.colorHex)} />}
                    {e.tasks.map((t, j) => <span key={t.id}>{j > 0 && ' · '}<a href={`/tasks/${t.id}`} onClick={(ev) => { ev.preventDefault(); openTask(t.id); }}>{t.title}</a></span>)}
                    {e.note && <small>{e.note}</small>}</span>
                </li>
              ))}</ul>
            )}
            {d.collectionStatus.length > 0 && (
              <div className="health">
                <h2>{tt("수집 상태")} <span>{[...new Set(d.collectionStatus.flatMap((c) => c.methods))].some((m) => m === 'mcp') ? tt("확장 프로그램 · MCP") : tt("내보내기 가져오기")}</span></h2>
                <table><tbody>{d.collectionStatus.map((c, k) => {
                  const [label, cls] = HEALTH[c.health] ?? [tt("알 수 없음"), ''];
                  return <tr key={c.sourceAi}><td><Svc ai={c.sourceAi} /></td><td>{c.message ?? c.methodLabel}</td><td>{c.lastCapturedAt ? `${k === 0 ? tt("마지막 ") : ''}${relative(c.lastCapturedAt, now())}` : tt("기록 없음")}</td>
                    <td className={cls}>{cls && <Icon name="warn" size={13} style={{ marginRight: 3 }} />}{label}</td></tr>;
                })}</tbody></table>
              </div>
            )}
            {d.thisWeek.items.length > 0 && (
              <div className="health">
                <h2>{tt("이번 주 한 일")} <span>{d.thisWeek.rangeLabel}</span></h2>
                <ol className="wk">{d.thisWeek.items.map((x, k) => <li key={k}>{x}</li>)}</ol>
              </div>
            )}
          </div>
          <div>
            <h2>{tt("오늘 이어서 할 것")} <span>{d.todayPicks.length ? tt("세 가지만 골랐어요") : tt("오늘은 고른 게 없어요")}</span></h2>
            {d.todayPicks.map((p) => {
              const v = visualOf(p.task.statusVisual);
              return (
                <div className="pick" key={p.rank}>
                  <span className="n">{p.rank}</span>
                  <div>
                    <h3>{p.project && <Sphere color={accentOf(p.project.colorHex)} />}<a href={`/tasks/${p.task.id}`} onClick={(e) => { e.preventDefault(); openTask(p.task.id); }}>{p.task.title}</a> <span className={v === 'stall' ? 'late' : v === 'stall2' ? 'warm' : 'ok'}>{p.freshnessLabel}</span></h3>
                    <p>{p.nextStep}</p><div className="why">{p.reason}</div>
                    <div className="ac">
                      <button onClick={() => void continueIn(p.task.id, p.recommendedAi, p.continue)}><Icon name="arrow" />{p.actionLabel}</button>
                      <button className="s" onClick={() => void copyPrompt(p.task.id, p.recommendedAi)}><Icon name="copy" />{tt("프롬프트 복사")}</button>
                    </div>
                  </div>
                </div>
              );
            })}
            {d.longNeglected.count > 0 && (
              <div className="neg">
                <span>{tt("오래 방치(31일 넘음)")} {d.longNeglected.count}{tt("개 —")} {d.longNeglected.items.map((t) => <a key={t.id} className="lnk" href={`/tasks/${t.id}`} onClick={(e) => { e.preventDefault(); openTask(t.id); }} style={{ borderBottom: 0 }}>{t.title}</a>)}.</span>
                {!neglectAsk && d.longNeglected.items.every((t) => !handled[t.id]) && <button className="lnk" onClick={() => setNeglectAsk(true)}>{d.longNeglected.prompt}</button>}
                {neglectAsk && d.longNeglected.items.map((t) => handled[t.id] ? <span key={t.id} style={{ color: 'var(--ink2)' }}>{t.title}: {handled[t.id]}</span> : (
                  <span key={t.id} style={{ display: 'flex', gap: 6 }}>
                    <button className="btn" onClick={() => void decide(t, "진행 중")}>{tt("계속하기")}</button>
                    <button className="btn" onClick={() => void decide(t, "보관")}><Icon name="archive" size={13} />{tt("보관")}</button>
                  </span>
                ))}
              </div>
            )}
            {d.movedProjects.length > 0 && (
              <div className="health">
                <h2>{tt("어제 움직인 프로젝트")} <span>{tt("구 크기 = 메시지 수")}</span></h2>
                <Orbs d={d} onPick={(id) => nav(`/?focus=${encodeURIComponent(id)}`)} />
                {qTotal > 0 && <div style={{ fontSize: 11.5, color: 'var(--ink3)', marginTop: 2 }}>{tt("간단한 질문")} {qTotal}{tt("개(")}{d.quickQuestionsByAi.map((x) => `${aiLabel(x.sourceAi)} ${x.count}`).join(' · ')}{tt(")는 그래프에서 흐리게 표시돼요.")}</div>}
              </div>
            )}
            {merges.map((m) => (
              <div className="merge" key={m.id}>
                <div><b>{tt("같은 과제일 수 있어요")}</b> {tt("· 확신도")} {Math.round(m.confidence * 100)}%</div>
                <div style={{ marginTop: 3 }}>{m.tasks.map((t, k) => <span key={t.id}>{k > 0 && ' ↔ '}<a className="lnk" href={`/tasks/${t.id}`} onClick={(e) => { e.preventDefault(); openTask(t.id); }}>{t.title}</a> {t.sourceAis.map((a) => <AiMark key={a} ai={a} />)}</span>)}</div>
                <div style={{ color: 'var(--ink3)', marginTop: 3, fontSize: 11.5 }}>{m.reason}</div>
                <div className="row"><button className="btn" onClick={() => void merge(m.id, true)}>{tt("합치기")}</button><button className="btn ghost" onClick={() => void merge(m.id, false)}>{tt("다른 과제예요")}</button></div>
              </div>
            ))}
            {d.ontology && (d.ontology.pendingCount > 0 || d.ontology.newlyLinkedCount > 0) && (
              <div className="health onc">
                <h2>{tt("새로 이어진 관계")} <span>{tt("어제")} {d.ontology.newlyLinkedCount}{tt("개 · 확인할 제안")} {d.ontology.pendingCount}{tt("건 ·")} <Link className="lnk" to="/ontology?tab=review" style={{ borderBottom: 0 }}>{tt("검토하기")}</Link></span></h2>
                {d.ontology.items.slice(0, 3).map((x) => (
                  <div key={x.id} className="onrow">
                    <span className="cf">{x.confidence.toFixed(2)}</span>
                    <span className="tx">{x.text}</span>
                    <Link className="lnk" to={`/ontology?tab=review&hl=${encodeURIComponent(x.id)}`} style={{ borderBottom: 0 }}>{tt("보기")}</Link>
                  </div>
                ))}
              </div>
            )}
            {projectSuggestions.length > 0 && (
              <div className="health">
                <h2>{tt("새 프로젝트로 묶을까요?")} <span>{tt("프로젝트 없는 과제")} {projectSuggestions.reduce((a, x) => a + x.taskCount, 0)}{tt("개 ·")} <Link className="lnk" to="/review#suggestions" style={{ borderBottom: 0 }}>{tt("모두 보기")}</Link></span></h2>
                {projectSuggestions.map((x) => <ProjectSuggestionCard key={x.id} s={x} compact onDone={(o) => setPsDone((m) => ({ ...m, [o.id]: true }))} />)}
              </div>
            )}
          </div>
        </div>
      </section>
      <CleanupPanel cleanup={d.cleanup} reload={reload} />
      <DataModeNote style={{ left: 40, bottom: 6 }} />
    </div>
  );
}

// 디자인 v3의 작은 구 무리 배치 (순서대로), 그 이상은 오른쪽으로 이어 붙임
const ORB_POS: Array<[number, number, number]> = [[62, 66, 0], [168, 44, 0.3], [248, 84, 0], [318, 40, 0.45], [364, 98, 0.2], [150, 116, 0.5]];
function Orbs({ d, onPick }: { d: DigestResponse; onPick: (id: string) => void }) {
  const orbs = d.movedProjects.slice(0, 9).map((m, k) => ({ m, pos: ORB_POS[k] ?? [60 + (k - 6) * 110, 140, 0.3] as [number, number, number] }));
  return (
    <svg className="orbs" viewBox="0 0 410 162" style={{ display: 'block', width: '100%', height: 'auto' }} role="img" aria-label={tt("어제 움직인 프로젝트")}>
      <defs>
        {orbs.map(({ m }, k) => { const c = accentOf(m.project.colorHex); return <radialGradient key={k} id={`orb${k}`} cx="36%" cy="30%" r="72%"><stop offset="0" stopColor={c} /><stop offset=".78" stopColor={c} /><stop offset=".78" stopColor={mix(c, '#070708', 0.62)} /><stop offset="1" stopColor={mix(c, '#070708', 0.62)} /></radialGradient>; })}
      </defs>
      <ellipse cx="205" cy="112" rx="195" ry="30" fill="none" stroke="#6E6E6B" strokeOpacity=".16" />
      <ellipse cx="205" cy="112" rx="120" ry="17" fill="none" stroke="#6E6E6B" strokeOpacity=".12" />
      {[...orbs.entries()].sort((a, b) => b[1].pos[2] - a[1].pos[2]).map(([k, { m, pos: [x, y, depth] }]) => {
        const r = m.messageCount ? 7 + Math.sqrt(m.messageCount) * 3.9 : 8; const o = 1 - depth * 0.5; const ly = y + r + 14;
        const st = { paintOrder: 'stroke', stroke: '#0B0B0C', strokeWidth: '3px' } as React.CSSProperties;
        return (
          <g key={m.project.id} onClick={() => onPick(m.project.id)}>
            <title>{ttf("{0} · 메시지 {1}{2}", m.project.name, m.messageCount, m.becameStalled ? tt(" · 멈춤으로 옮김") : '')}</title>
            {m.messageCount > 0 ? <>
              <ellipse cx={x} cy={Math.round(y + r + 4)} rx={Math.round(r * 0.8)} ry={Math.round(r * 0.2 + 1)} fill="#000" opacity=".35" />
              <circle cx={x} cy={y} r={r} fill={`url(#orb${k})`} opacity={o} />
            </> : <circle cx={x} cy={y} r={r} fill={`url(#orb${k})`} opacity=".55" />}
            {m.becameStalled && <circle cx={x} cy={y} r={r + 3} fill="none" stroke="#D08A66" strokeDasharray="2 2" strokeWidth={1.3} />}
            <text x={x} y={Math.round(ly)} textAnchor="middle" fontSize="11" fontWeight="600" fill="#EDEDEB" style={st}>{m.project.name}</text>
            <text x={x} y={Math.round(ly + 13)} textAnchor="middle" fontSize="10.5" fill="#8A8A85" style={st}>{m.note}</text>
          </g>
        );
      })}
    </svg>
  );
}

