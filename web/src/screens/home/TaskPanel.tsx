import { tt, ttf } from '../../i18n';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { useApi } from '../../api/useApi';
import { Icon } from '../../components/Icons';
import { AiMark, StatusGlyph } from '../../components/Marks';
import { aiLabel, monthDay, monthDayWd, visualOf } from '../../lib/format';
import { openExternal } from '../../lib/clipboard';
import { NextStepCard } from '../../components/NextStep';
import { PanelError, PanelSkeleton } from './PanelStates';
import { CompletionTag, BlockedBadge, HandoffBadge, OutcomeBadge, blockedSentence, completionText, movedTarget } from '../../components/TaskBadges';

/** 그래프에서 과제(또는 간단한 질문)를 골랐을 때 오른쪽 패널 */
export function TaskPanel({ id, onSelect }: { id: string; onSelect: (id: string) => void }) {
  const nav = useNavigate();
  const q = useApi(() => api.task(id), [id]);
  if (q.loading && !q.data) return <PanelSkeleton eyebrow={tt("선택한 과제")} />;
  if (q.error || !q.data) return <PanelError error={q.error} onRetry={q.reload} />;
  const t = q.data; const outcome = t.conversationOutcome ?? null; const ended = t.completionReason === 'done' || t.completionReason === 'moved'; const v = visualOf(t.stale.statusVisual);
  const open = () => nav(`/tasks/${encodeURIComponent(t.id)}`);
  return (
    <>
      <div className="ph">
        <span className="eyebrow">{t.kind === 'quick_question' ? tt("선택한 간단한 질문") : tt("선택한 과제")}</span>
        <div className="acts">{t.vault.obsidianUri && <a className="obs" href={t.vault.obsidianUri} title={t.vault.path}><Icon name="note" />{tt("Obsidian 노트")}</a>}</div>
      </div>
      <h1>{t.title}</h1>
      <div className="meta">
        {v === 'stall' || v === 'stall2' ? <span className={v === 'stall' ? 'late' : 'warm'}><StatusGlyph v={v} />{t.stale.staleDays}{tt("일째 멈춤")}</span>
          : v === 'run' ? <span className="ok"><StatusGlyph v="run" />{tt("진행 중")}</span> : <span><StatusGlyph v={v} />{tt(t.status)}</span>}
        {completionText(t.completionReason) && <span><CompletionTag reason={t.completionReason} target={movedTarget(t)} /></span>}
        {ended ? null : outcome ? <span><OutcomeBadge o={outcome} /></span> : t.handoff && <span><HandoffBadge h={t.handoff} /></span>}
        {t.classificationState === 'blocked' && <span><BlockedBadge state="blocked" reason={t.classification?.blockedReason} model={t.classification?.blockedModel} /></span>}
        {t.project && <span style={{ cursor: 'pointer' }} onClick={() => onSelect(t.project!.id)}>{t.project.name}</span>}
        {t.startedAt && <span>{monthDay(t.startedAt)} {tt("시작")}</span>}
        {t.lastConversationAt && <span>{tt("마지막 대화")} {monthDayWd(t.lastConversationAt)}</span>}
      </div>
      {t.summary && <p className="sum">{t.summary}</p>}
      {t.classificationState === 'blocked' && <p className="blkn"><b>{tt("분류 불가")}</b> — {blockedSentence(t.classification?.blockedReason ?? null, t.classification?.blockedModel ?? null)}</p>}
      {(t.status === '진행 중' || t.status === '멈춤' || t.nextStepInfo || t.nextStep) && (
        <NextStepCard t={t} compact onChange={(d) => q.setData(() => d)}
          extra={t.resume.continue ? <button className="btn pri" onClick={() => openExternal(t.resume.continue!.url)}><Icon name="arrow" />{t.resume.continue.label}</button>
            : <button className="btn pri" onClick={open}><Icon name="arrow" />{tt("과제 열기")}</button>} />
      )}
      <dl className="facts">
        <dt>{tt("대화 · 메시지")}</dt><dd>{t.conversationCount}{tt("개 ·")} {t.messageCount}{tt("개")}</dd>
        <dt>{tt("AI별")}</dt><dd>{t.byAi.map((a) => <span key={a.sourceAi} style={{ marginRight: 12 }}><AiMark ai={a.sourceAi} style={{ marginRight: 5 }} />{aiLabel(a.sourceAi)} {a.conversationCount}</span>)}</dd>
        {t.topics.length > 0 && <><dt>{tt("주제")}</dt><dd>{t.topics.map((x) => <button key={x.id} className="lnk" style={{ marginRight: 8 }} onClick={() => onSelect(x.id)}>#{x.name}</button>)}</dd></>}
        <dt>{tt("결정 · 열린 질문")}</dt><dd>{t.decisions.length}{tt("개 ·")} {t.openQuestions.filter((o) => !o.resolved).length}{tt("개")}</dd>
        <dt>{tt("볼트 노트")}</dt><dd><small className="mono">{t.vault.path}</small></dd>
      </dl>
      <div className="actions"><button className="btn pri" onClick={open}><Icon name="chev" />{tt("과제 상세 열기")}</button></div>
    </>
  );
}
