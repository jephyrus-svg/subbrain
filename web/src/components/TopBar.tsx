import { tt, ttf, lang, setLang } from '../i18n';
import { NavLink, useLocation } from 'react-router-dom';
import { useAppData } from './AppData';
import { Icon, Logo } from './Icons';
import { monthDayWeekday, relative } from '../lib/format';
import { now } from '../lib/clock';
import { useState } from 'react';
import { Popover } from './Popover';
import '../styles/narrow.css';
import { CollectorCard } from './CollectorCard';

const HEALTH_LABEL = { ok: tt("정상"), degraded: tt("주의"), broken: tt("고장") } as const;

export function TopBar({ onSearch }: { onSearch: () => void }) {
  const { dashboard, error } = useAppData();
  const approvals = dashboard?.badges.digestApprovals ?? 0;
  const health = dashboard?.collection.overallHealth ?? 'ok';
  const { pathname } = useLocation();
  const [colOpen, setColOpen] = useState(false);
  const broken = dashboard?.collection.sources?.filter((x) => x.health === 'broken') ?? []; // 1.9.0: 확장 어댑터가 broken이면 "고장"
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const tab = (to: string, icon: Parameters<typeof Icon>[0]['name'], label: string, badge?: string, end = false) => (
    // 그래프 탭은 온톨로지 모드(/ontology, 같은 그래프의 "관계" 보기)에서도 켜져 있다
    <NavLink to={to} end={end} className={({ isActive }) => (isActive || (to === '/' && pathname.startsWith('/ontology')) ? 'on' : '')}>
      <Icon name={icon} />{label}{badge ? <span className="n">{badge}</span> : null}
    </NavLink>
  );
  return (
    <header className="bar">
      <NavLink to="/" className="logo" aria-label={tt("서브브레인 홈")}><Logo />{tt("서브브레인")}</NavLink>
      <nav className="nav" aria-label={tt("주 메뉴")}>
        {tab('/', 'graph', tt("그래프"), undefined, true)}
        {tab('/board', 'board', tt("과제"))}
        {tab('/timeline', 'time', tt("타임라인"))}
        {tab('/week', 'check', tt("주간"))}
        {tab('/digest', 'sun', tt("오늘의 요약"), approvals > 0 ? ttf("승인 {0}건", approvals) : undefined)}
      </nav>
      <button className="find" onClick={onSearch} aria-label={tt("검색 열기")}>
        <Icon name="search" /><span>{tt("과제, 대화 원문, 결정 사항 검색")}</span><kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <div className="barmeta">
        {error && !dashboard ? (
          <span style={{ color: 'var(--accent)' }}><span className="dot broken" />{tt("코어 연결 안 됨")}</span>
        ) : (
          <span className="colwrap">
            <button className="colbtn" title={dashboard ? ttf("수집 상태: {0} · 눌러서 로컬 수집 보기", HEALTH_LABEL[health]) : undefined} aria-haspopup="dialog" aria-expanded={colOpen} onMouseDown={(e) => e.stopPropagation()} onClick={() => setColOpen((o) => !o)}>
              <span className={`dot ${dashboard && !dashboard.collection.lastCapturedAt ? 'none' : health}`} />{tt("수집")} <b>{dashboard ? relative(dashboard.collection.lastCapturedAt, now()) : '…'}</b>{broken.length > 0 && <span className="colbroken" title={broken.map((x) => `${x.sourceAi}: ${x.message ?? tt("화면 구조가 바뀜")}`).join('\n')}>{tt("고장")} {broken.length}</span>}
            </button>
            <Popover open={colOpen} onClose={() => setColOpen(false)} className="colpop"><div onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setColOpen(false); }}><CollectorCard /></div></Popover>
          </span>
        )}
        <span>{dashboard ? monthDayWeekday(dashboard.today) : ''}</span>
        <button className="langbtn" onClick={() => setLang(lang === 'en' ? 'ko' : 'en')} title={lang === 'en' ? '한국어로 보기' : 'Switch to English'} aria-label="Language">{lang === 'en' ? '한국어' : 'EN'}</button>
      </div>
    </header>
  );
}
