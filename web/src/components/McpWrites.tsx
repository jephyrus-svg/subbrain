import { tt, ttf } from '../i18n';
// 1.8.0 "AI가 남긴 기록": Claude 등이 MCP로 서브브레인에 쓴 것(GET /mcp/events), 항목마다 되돌리기(POST /mcp/events/:id/undo).
// 되돌리기는 삭제가 아니다 — 남긴 기록은 보관으로, 상태 변경은 이전 값으로. 뒤에 같은 과제를 또 바꿨으면 409.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { McpWriteEvent } from '@subbrain/shared';
import { api } from '../api/endpoints';
import { useApi } from '../api/useApi';
import { ApiRequestError, errorText } from '../api/client';
import { useToast } from './Toast';
import { fullDateTime, relative } from '../lib/format';
import { now } from '../lib/clock';

const TYPE_LABEL: Record<McpWriteEvent['type'], string> = { task_logged: tt("과제 기록"), status_changed: tt("상태 바꿈") };
const clientOf = (e: McpWriteEvent) => (e as McpWriteEvent & { client?: string | null }).client ?? 'Claude · MCP';

export function McpWrites({ taskId, limit }: { taskId?: string; limit?: number }) {
  const toast = useToast();
  const ev = useApi(() => api.mcpEvents(), []);
  const [busy, setBusy] = useState<number | null>(null);
  const items = (ev.data?.items ?? []).filter((e) => !taskId || e.taskId === taskId).slice(0, limit ?? 50);
  if (taskId && !items.length) return null;
  const undo = async (e: McpWriteEvent) => {
    setBusy(e.id);
    try { await api.mcpUndo(e.id); toast.show(e.type === 'task_logged' ? tt("되돌렸어요 — 그 기록은 보관으로 옮겼어요(지우지 않음)") : tt("되돌렸어요 — 상태를 이전 값으로")); ev.reload(); }
    catch (x) { toast.show(x instanceof ApiRequestError && x.status === 409 ? tt("그 뒤에 이 과제가 또 바뀌어서 되돌릴 수 없어요") : ttf("되돌리지 못했어요: {0}", errorText(x)), { err: true }); }
    finally { setBusy(null); }
  };
  return (
    <section className="mcpw" aria-label={tt("AI가 남긴 기록")}>
      <h2>{tt("AI가 남긴 기록")} <span>{tt("MCP로 쓴 것 · 되돌리면 보관/이전 상태로(삭제 아님)")}</span></h2>
      {ev.loading && !ev.data && <div className="skel" style={{ height: 60, marginTop: 6 }} />}
      {ev.error != null && <div className="state err"><b>{tt("기록을 불러오지 못했어요")}</b><span>{errorText(ev.error)}</span><button className="btn" onClick={ev.reload}>{tt("다시 시도")}</button></div>}
      {ev.data && !items.length && <div className="rvempty">{tt("아직 AI가 MCP로 남긴 기록이 없어요.")}</div>}
      <ul>{items.map((e) => (
        <li key={e.id} className={e.undone ? 'off' : ''}>
          <time title={fullDateTime(e.at)}>{relative(e.at, now())}</time>
          <span className="who">{clientOf(e)}</span>
          <span className="ty">{TYPE_LABEL[e.type] ?? e.type}</span>
          <span className="what">{!taskId && <Link to={`/tasks/${encodeURIComponent(e.taskId)}`}>{e.taskTitle}</Link>}<small>{e.summary}</small></span>
          {e.undone ? <span className="und" title={e.undoneAt ? fullDateTime(e.undoneAt) : ''}>{tt("되돌림")}{e.undoneAt ? ` · ${relative(e.undoneAt, now())}` : ''}</span>
            : <button className="btn ghost" disabled={busy === e.id} onClick={() => void undo(e)}>{tt("되돌리기")}</button>}
        </li>
      ))}</ul>
    </section>
  );
}
