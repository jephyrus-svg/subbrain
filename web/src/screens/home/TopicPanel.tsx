import { tt, ttf } from '../../i18n';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { useApi } from '../../api/useApi';
import { monthDay } from '../../lib/format';
import { PanelError, PanelSkeleton } from './PanelStates';
import { TaskRow } from './ProjectPanel';

export function TopicPanel({ id, onSelect, onHoverTask }: { id: string; onSelect: (id: string) => void; onHoverTask: (id: string | null) => void }) {
  const nav = useNavigate();
  const q = useApi(() => api.topic(id), [id]);
  if (q.loading && !q.data) return <PanelSkeleton eyebrow={tt("선택한 주제")} />;
  if (q.error || !q.data) return <PanelError error={q.error} onRetry={q.reload} />;
  const t = q.data;
  return (
    <>
      <div className="ph"><span className="eyebrow">{tt("선택한 주제")}</span></div>
      <h1 style={{ fontStyle: 'italic' }}>#{t.name}</h1>
      <div className="meta">
        <span>{tt("언급")} {t.mentionCount}{tt("번")}</span>
        {t.firstSeenAt && <span>{monthDay(t.firstSeenAt)} {tt("처음")}</span>}
        {t.lastSeenAt && <span>{tt("마지막")} {monthDay(t.lastSeenAt)}</span>}
        {t.aliases.length > 0 && <span>{tt("같은 말:")} {t.aliases.join(', ')}</span>}
      </div>
      <section className="tsec">
        <div className="hd"><span>{tt("이 주제가 나온 과제")} <b>{t.tasks.length}</b></span><span>{tt("AI · 첫 활동–마지막 · 멈춤")}</span></div>
        <table><tbody>{t.tasks.map((x) => <TaskRow key={x.id} t={x} sel={false} onOpen={() => nav(`/tasks/${encodeURIComponent(x.id)}`)} onHover={onHoverTask} />)}</tbody></table>
      </section>
      {t.projects.length > 0 && (
        <section className="rel"><div className="hd">{tt("걸친 프로젝트")}</div>
          <ul>{t.projects.map((p) => <li key={p.id} onClick={() => onSelect(p.id)}><b>{p.name}</b>{tt("그래프에서 선택")}</li>)}</ul>
        </section>
      )}
    </>
  );
}
