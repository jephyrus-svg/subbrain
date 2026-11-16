import { tt, ttf } from '../../i18n';
// 서비스 쪽 보관 — 승인한 대화를 ChatGPT 등 "에서" 정리하는 단계 (2026-10-21).
// 규칙: 삭제 없음 · 사용자가 고르고 누를 때만 · 기본 미리보기(dry-run) · 이 화면/엔진/확장은 탭·창을 열거나 옮기지 않음.
// ChatGPT는 "직접 열어서 보관하기" 링크(사용자가 눌러야 열림), Claude·Gemini·Grok은 보관 기능이 없어 SubBrain 안에서만 정리 표시.
import { useCallback, useEffect, useState } from 'react';
import { cleanupApi, type ServiceArchivePlanItem, type ServiceArchiveState } from '../../api/cleanup';
import { errorText } from '../../api/client';
import { AiMark } from '../../components/Marks';
import { useToast } from '../../components/Toast';

export function ServiceArchivePanel() {
  const toast = useToast();
  const [st, setSt] = useState<ServiceArchiveState | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<ServiceArchivePlanItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { cleanupApi.serviceArchive().then(setSt).catch(() => setSt(null)); }, []);
  useEffect(load, [load]);
  if (!st || (st.eligible.length === 0 && st.actions.length === 0)) return null;
  const toggle = (id: number) => { setPreview(null); setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const run = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const r = await cleanupApi.serviceArchivePlan([...picked], dryRun);
      if (dryRun) setPreview(r.items);
      else { toast.show(ttf("{0}개를 보관 목록에 올렸어요 — 아래 링크로 직접 보관해 주세요", r.recorded)); setPreview(null); setPicked(new Set()); load(); }
    } catch (e) { toast.show(errorText(e), { err: true }); } finally { setBusy(false); }
  };
  const act = async (kind: 'done' | 'undo', id: number) => {
    setBusy(true);
    try {
      if (kind === 'done') { await cleanupApi.serviceArchiveDone([id]); toast.show(tt("보관 완료로 기록했어요")); }
      else { const r = await cleanupApi.serviceArchiveUndo([id]); toast.show(r.howTo[0]?.howTo ?? tt("SubBrain 기록을 되돌렸어요")); }
      load();
    } catch (e) { toast.show(errorText(e), { err: true }); } finally { setBusy(false); }
  };
  const open = st.actions.filter((a) => a.state !== 'undone');
  return (
    <div className="batch svcarch">
      <div className="bh"><h2>{tt("서비스에서 보관하기")}</h2><span className="c">{tt("삭제 없음 · 직접 눌러서만")}</span></div>
      <p className="note">{tt("SubBrain은 탭을 열거나 브라우저를 움직이지 않아요. ChatGPT는 링크를 눌러 직접 ⋯ → 보관(Archive) 하세요. Claude·Gemini·Grok은 보관 기능이 없어 SubBrain 안에서만 정리됨으로 표시해요.")}</p>
      {st.eligible.length > 0 && (
        <table className="rows"><tbody>
          {st.eligible.map((e) => (
            <tr key={e.itemId} className={picked.has(e.itemId) ? '' : 'off'} onClick={() => toggle(e.itemId)}>
              <td className="c"><button className={`cb${picked.has(e.itemId) ? ' on' : ''}`} role="checkbox" aria-checked={picked.has(e.itemId)} aria-label={e.title} onClick={(ev) => { ev.stopPropagation(); toggle(e.itemId); }} /></td>
              <td className="t"><AiMark ai={e.sourceAi} style={{ marginRight: 8 }} /><span>{e.title}</span><small>{e.canArchive ? tt("서비스 보관 가능") : tt("SubBrain 안에서만")}</small></td>
            </tr>
          ))}
        </tbody></table>
      )}
      {picked.size > 0 && (
        <div className="foot">
          <button className="btn" disabled={busy} onClick={() => void run(true)}>{tt("미리보기 (")}{picked.size}{tt("개)")}</button>
          {preview && <button className="btn primary" disabled={busy || !preview.some((p) => p.action !== 'skip')} onClick={() => void run(false)}>{tt("보관 목록에 올리기")}</button>}
        </div>
      )}
      {preview && (
        <ul className="plan">{preview.map((p) => <li key={p.itemId}><AiMark ai={p.sourceAi} /> {p.title} — {p.action === 'skip' ? ttf("건너뜀: {0}", p.skipReason) : p.guide.howTo}</li>)}</ul>
      )}
      {open.length > 0 && (
        <table className="rows"><tbody>
          {open.map((a) => (
            <tr key={a.id} style={{ cursor: 'default' }}>
              <td className="t"><AiMark ai={a.sourceAi} style={{ marginRight: 8 }} /><span>{a.title}</span>
                <small>{a.state === 'link_issued' ? tt("직접 보관 대기") : a.state === 'user_archived' ? tt("서비스에서 보관함") : tt("SubBrain 안에서만 정리")}</small>
                {a.state === 'user_archived' && <em className="why" title={a.undo.howTo}>{tt("되돌리기:")} {a.undo.howTo}</em>}</td>
              <td className="ab">
                {a.state === 'link_issued' && a.url && <a className="btn sm" href={a.url} target="_blank" rel="noopener noreferrer">{tt("열어서 직접 보관")}</a>}
                {a.state === 'link_issued' && <button className="btn sm" disabled={busy} onClick={() => void act('done', a.id)}>{tt("보관했어요")}</button>}
                <button className="btn sm" disabled={busy} onClick={() => void act('undo', a.id)}>{tt("되돌리기")}</button>
              </td>
            </tr>
          ))}
        </tbody></table>
      )}
    </div>
  );
}
