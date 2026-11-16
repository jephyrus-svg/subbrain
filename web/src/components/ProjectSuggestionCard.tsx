import { tt, ttf } from '../i18n';
// 1.1.0 새 프로젝트 제안 카드 (§9-2): 프로젝트 없는 과제가 비슷한 이름으로 모이면 "이 이름으로 묶을까요?"를 묻는다.
// 수락 = POST /project-suggestions/:id/accept (프로젝트를 만들거나 같은 이름 프로젝트에 붙임), 거절 = .../reject (같은 이름 다시 제안 안 함)
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AcceptProjectSuggestionResponse, ProjectSuggestion } from '@subbrain/shared';
import { api } from '../api/endpoints';
import { ApiRequestError, errorText } from '../api/client';
import { useAppData } from './AppData';
import { Icon } from './Icons';
import { AiMark, Sphere, StatusGlyph } from './Marks';
import { useToast } from './Toast';
import { monthDay } from '../lib/format';
import { ACCENTS } from '../design/tokens';
import '../styles/suggestions.css';

const FALLBACK_PALETTE: readonly string[] = ACCENTS;
/** 아직 없는 프로젝트의 "예정 색": 팔레트에서 id로 하나 고른다(실제 색은 코어가 정함) */
function previewColor(id: string, palette: string[] | undefined) {
  const p = palette?.length ? palette : FALLBACK_PALETTE;
  let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return p[h % p.length]!;
}

export type SuggestionOutcome = { id: string; state: 'accepted' | 'rejected' | 'gone'; accepted?: AcceptProjectSuggestionResponse };

export function ProjectSuggestionCard({ s, onDone, compact = false }: { s: ProjectSuggestion; onDone: (o: SuggestionOutcome) => void; compact?: boolean }) {
  const toast = useToast();
  const { meta, refresh } = useAppData();
  const [busy, setBusy] = useState<null | 'accept' | 'reject'>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.name);
  const color = previewColor(s.id, meta?.projectPalette);
  const remain = Math.max(0, s.minTasks - s.taskCount);

  const decide = async (accept: boolean) => {
    setBusy(accept ? 'accept' : 'reject');
    try {
      if (accept) {
        const nm = name.trim();
        const r = await api.acceptProjectSuggestion(s.id, editing && nm && nm !== s.name ? { name: nm } : {});
        const n = r.attachedTaskIds.length;
        toast.show(ttf("‘{0}’ 프로젝트{1}", r.project.name, n ? ttf("에 과제 {0}개를 붙였어요", n) : tt("를 만들었어요")));
        onDone({ id: s.id, state: 'accepted', accepted: r });
      } else {
        await api.rejectProjectSuggestion(s.id, {});
        toast.show(ttf("‘{0}’은(는) 만들지 않을게요 · 비슷한 이름은 다시 제안하지 않아요", s.name));
        onDone({ id: s.id, state: 'rejected' });
      }
      refresh();
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 409) { toast.show(tt("이미 처리된 제안이에요")); onDone({ id: s.id, state: 'gone' }); refresh(); return; }
      toast.show(errorText(e), { err: true });
    } finally { setBusy(null); }
  };

  return (
    <article className={`psg${s.ready ? '' : ' wait'}${compact ? ' compact' : ''}`} aria-label={ttf("새 프로젝트 제안: {0}", s.name)}>
      <div className="pst">
        <span className="pso" style={{ ['--c' as string]: color }}><Sphere color={color} size={compact ? 16 : 20} /></span>
        <div className="psn">
          {editing ? (
            <input className="psi" value={name} autoFocus maxLength={80} aria-label={tt("프로젝트 이름")} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void decide(true); if (e.key === 'Escape') { setEditing(false); setName(s.name); } }} />
          ) : <h3>{s.name}</h3>}
          <small>{s.altNames.length > 0 ? ttf("비슷한 이름 함께 묶음: {0} · ", s.altNames.join(', ')) : ''}{monthDay(s.createdAt)}{tt("부터 모임")}</small>
        </div>
        <span className={`psr${s.ready ? ' ok' : ''}`} title={ttf("과제가 {0}개 이상 모이면 제안해요", s.minTasks)}>
          {tt("과제")} {s.taskCount}{tt("개")}{s.ready ? '' : ttf(" · {0}개 더 모이면 제안", remain)}
        </span>
      </div>
      <ul className="pstl">
        {s.tasks.slice(0, compact ? 3 : 8).map((t) => (
          <li key={t.id}>
            <StatusGlyph v={t.statusVisual} title={tt(t.status)} />
            <Link to={`/tasks/${encodeURIComponent(t.id)}`}>{t.title}</Link>
            {t.sourceAis.map((a) => <AiMark key={a} ai={a} />)}
            <small>{tt(t.status)}{t.staleDays ? ttf(" {0}일", t.staleDays) : ''}</small>
          </li>
        ))}
        {s.tasks.length > (compact ? 3 : 8) && <li className="more">{tt("외")} {s.tasks.length - (compact ? 3 : 8)}{tt("개")}</li>}
      </ul>
      <div className="row">
        <button className="btn pri" disabled={!!busy || (editing && !name.trim())} onClick={() => void decide(true)}>
          <Icon name="folder-plus" />{busy === 'accept' ? tt("만드는 중…") : editing ? tt("이 이름으로 만들기") : tt("프로젝트 만들기")}
        </button>
        {!editing && !compact && <button className="btn" disabled={!!busy} onClick={() => setEditing(true)}>{tt("이름 바꿔서")}</button>}
        {editing && <button className="btn ghost" disabled={!!busy} onClick={() => { setEditing(false); setName(s.name); }}>{tt("취소")}</button>}
        <button className="btn ghost" disabled={!!busy} onClick={() => void decide(false)}>{busy === 'reject' ? tt("처리 중…") : tt("만들지 않기")}</button>
        {!compact && <small>{tt("같은 이름 프로젝트가 있으면 거기에 붙여요")}</small>}
      </div>
    </article>
  );
}
