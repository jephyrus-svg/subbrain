import { tt, ttf } from '../i18n';
// 다음 할 일: 과제마다 한 줄. 출처 = 직접 씀(user) > 분류 결과(saved) > 자동(rule, 마지막 대화에서 규칙으로)
// 저장 = PATCH /tasks/:id {nextStep}, 자동으로 되돌리기 = POST /tasks/:id/overrides/reset {fields:['next_step']}
// 복사 = GET /tasks/:id/resume-prompt (제목·요약·다음 할 일·핵심 결정이 든 맥락 프롬프트)
import { useEffect, useRef, useState } from 'react';
import type { NextStepInfo, TaskDetail } from '@subbrain/shared';
import { api } from '../api/endpoints';
import { errorText } from '../api/client';
import { useResume } from '../lib/resume';
import { Icon } from './Icons';
import { useToast } from './Toast';
import '../styles/nextstep.css';

export const NS_SOURCE: Record<NextStepInfo['source'], string> = { user: tt("직접 씀"), saved: tt("분류"), rule: tt("자동") };

export function nextOf(t: { nextStepInfo?: NextStepInfo | null; nextStep?: string | null }): NextStepInfo | null {
  if (t.nextStepInfo) return t.nextStepInfo;
  return t.nextStep ? { text: t.nextStep, source: 'saved', basis: null } : null;
}

/** 목록·카드용 한 줄 (+ 복사). 부모가 button이어도 되게 span으로 */
export function NextStepLine({ taskId, info, copy = true }: { taskId: string; info: NextStepInfo | null; copy?: boolean }) {
  const { copyPrompt } = useResume();
  if (!info) return null;
  const doCopy = (e: React.SyntheticEvent) => { e.stopPropagation(); e.preventDefault(); void copyPrompt(taskId); };
  return (
    <span className="nsl" title={info.basis ? ttf("{0}\n근거: {1}", info.text, info.basis) : info.text}>
      <span className="k">{tt("다음")}</span>
      <span className="x">{info.text}</span>
      <span className={`src s-${info.source}`}>{NS_SOURCE[info.source]}</span>
      {copy && <span className="cp" role="button" tabIndex={0} aria-label={tt("맥락 프롬프트 복사")} title={tt("맥락 프롬프트 복사 (제목·요약·다음 할 일·핵심 결정)")}
        onClick={doCopy} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') doCopy(e); }}><Icon name="copy" size={13} /></span>}
    </span>
  );
}

/** 상세·패널용: 보기 / 고치기 / 자동으로 되돌리기 / 복사 */
export function NextStepCard({ t, onChange, extra, compact }: { t: TaskDetail; onChange: (d: TaskDetail) => void; extra?: React.ReactNode; compact?: boolean }) {
  const toast = useToast();
  const { copyPrompt } = useResume();
  const info = nextOf(t);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(info?.text ?? '');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!editing) setText(info?.text ?? ''); }, [info?.text, editing]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);
  if (t.kind === 'quick_question' && !info) return null;
  const save = async () => {
    const v = text.trim();
    if (!v) { toast.show(tt("비워 두려면 ‘자동으로’를 눌러 주세요"), { err: true }); return; }
    setBusy(true);
    try { const r = await api.updateTask(t.id, { nextStep: v.slice(0, 300), note: tt("다음 할 일 직접 고침") }); onChange(r.task); setEditing(false); toast.show(tt("다음 할 일을 저장했어요 — 자동 분류가 바꾸지 않아요")); }
    catch (e) { toast.show(errorText(e), { err: true }); } finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true);
    try { const d = await api.resetOverrides(t.id, { fields: ['next_step'] }); onChange(d); setEditing(false); toast.show(tt("자동으로 되돌렸어요")); }
    catch (e) { toast.show(errorText(e), { err: true }); } finally { setBusy(false); }
  };
  return (
    <div className={`nsc${compact ? ' compact' : ''}`}>
      <div className="hd">{tt("다음 할 일")}{info && <span className={`src s-${info.source}`}>{NS_SOURCE[info.source]}</span>}</div>
      {editing ? (
        <>
          <textarea ref={ref} value={text} maxLength={300} rows={2} placeholder={tt("한 줄로: 다음에 할 일")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void save(); } if (e.key === 'Escape') setEditing(false); }} />
          <div className="row">
            <button className="btn pri" disabled={busy} onClick={() => void save()}><Icon name="check" />{tt("저장")}</button>
            <button className="btn" disabled={busy} onClick={() => setEditing(false)}>{tt("취소")}</button>
          </div>
        </>
      ) : (
        <>
          <p className={info ? '' : 'none'}>{info?.text ?? tt("아직 정해진 다음 할 일이 없어요")}</p>
          {info?.basis && <div className="why">{tt("근거:")} {info.basis}</div>}
          <div className="row">
            {extra}
            <button className="btn" onClick={() => void copyPrompt(t.id)} title={tt("제목·요약·다음 할 일·핵심 결정")}><Icon name="copy" />{tt("맥락 프롬프트 복사")}</button>
            <button className="btn" disabled={busy} onClick={() => setEditing(true)}>{info ? tt("고치기") : tt("직접 쓰기")}</button>
            {t.overrides.includes('next_step') && <button className="btn" disabled={busy} onClick={() => void reset()}><Icon name="rotate" />{tt("자동으로")}</button>}
          </div>
        </>
      )}
    </div>
  );
}
