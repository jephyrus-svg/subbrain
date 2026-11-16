import { tt, ttf } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SearchHit, SearchResponse } from '@subbrain/shared';
import { api } from '../api/endpoints';
import { errorText } from '../api/client';
import { Icon } from './Icons';
import { AiMark, StatusGlyph } from './Marks';
import { Md } from './Md';
import { monthDay } from '../lib/format';
import { openExternal } from '../lib/clipboard';

const TYPE_LABEL: Record<string, string> = { task: tt("과제"), conversation: tt("대화"), message: tt("대화 원문"), decision: tt("결정"), wiki: tt("위키") };
const PAGE = 20;
const TYPE_FILTERS: Array<['all' | SearchHit['type'], string]> = [['all', tt("전체")], ['task', tt("과제")], ['conversation', tt("대화")], ['message', tt("원문")], ['decision', tt("결정")]];
const MODE_LABEL: Record<string, string> = { trigram: tt("빠른 검색"), bigram: tt("2글자 색인"), like: tt("전체 검색"), title_like: tt("제목만") };

/** ⌘K 검색 (GET /search) — 결과에서 과제 상세·원래 대화로 이동 */
export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const [types, setTypes] = useState<SearchHit['type'][]>([]);
  const [more, setMore] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setTimeout(() => input.current?.focus(), 0); setSel(0); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (!term) { setRes(null); setErr(null); return; }
    if (term.length > 200) { setErr(tt("검색어는 200자까지예요.")); return; }
    const ac = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      api.search({ q: term, limit: PAGE, types: types.length ? types : undefined }, ac.signal)
        .then((r) => { setRes(r); setErr(null); setSel(0); })
        .catch((e) => { if ((e as Error).name !== 'AbortError') setErr(errorText(e)); })
        .finally(() => setLoading(false));
    }, 180);
    return () => { clearTimeout(t); ac.abort(); };
  }, [q, open, types]);

  /** 다음 페이지 (cursor, 계약서 §1.4) — 목록 끝에 닿거나 버튼을 누르면 */
  const loadMore = async () => {
    if (!res?.page.hasMore || !res.page.nextCursor || more) return;
    setMore(true);
    try {
      const r = await api.search({ q: res.query, limit: PAGE, cursor: res.page.nextCursor, types: types.length ? types : undefined });
      setRes((cur) => {
        if (!cur || cur.query !== r.query) return cur;
        const seen = new Set(cur.items.map((h) => `${h.type}:${h.id}`));
        return { ...r, items: [...cur.items, ...r.items.filter((h) => !seen.has(`${h.type}:${h.id}`))] };
      });
    } catch (e) { setErr(errorText(e)); }
    finally { setMore(false); }
  };
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 80) void loadMore();
  };

  const items = useMemo(() => res?.items ?? [], [res]);
  const go = (h: SearchHit) => {
    if (h.task) { nav(`/tasks/${encodeURIComponent(h.task.id)}`); onClose(); return; }
    if (h.sourceUrl) openExternal(h.sourceUrl);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => { const n = Math.min(items.length - 1, s + 1); if (n >= items.length - 3) void loadMore(); list.current?.querySelectorAll('.shit')[n]?.scrollIntoView({ block: 'nearest' }); return n; }); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => { const n = Math.max(0, s - 1); list.current?.querySelectorAll('.shit')[n]?.scrollIntoView({ block: 'nearest' }); return n; }); }
    if (e.key === 'Enter' && items[sel]) { e.preventDefault(); go(items[sel]!); }
  };
  if (!open) return null;
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="search" role="dialog" aria-label={tt("검색")} onKeyDown={onKey}>
        <div className="sin">
          <Icon name="search" size={16} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={tt("과제, 대화 원문, 결정 사항 검색")} aria-label={tt("검색어")} />
          {loading ? <span className="sl">{tt("찾는 중…")}</span> : <kbd>Esc</kbd>}
        </div>
        {res && (
          <div className="sterms">
            {res.terms.map((t) => <span key={t.term}><b>{t.term}</b> {MODE_LABEL[t.mode] ?? t.mode}</span>)}
            <span className="sc">{res.page.total ?? res.items.length}{tt("건")}{res.page.hasMore ? ttf(" 중 {0}", items.length) : ''} · {res.tookMs}ms</span>
          </div>
        )}
        {(res || types.length > 0) && (
          <div className="stypes" role="group" aria-label={tt("결과 종류")}>
            {TYPE_FILTERS.map(([k, label]) => {
              const on = k === 'all' ? types.length === 0 : types.includes(k);
              return <button key={k} className={on ? 'on' : ''} aria-pressed={on} onClick={() => setTypes(k === 'all' ? [] : on ? types.filter((x) => x !== k) : [...types, k])}>{label}</button>;
            })}
          </div>
        )}
        {res?.notice && <div className="snotice"><Icon name="q" size={13} />{res.notice}</div>}
        <div className="sres scroll" ref={list} onScroll={onScroll}>
          {err && <div className="sempty err">{err}</div>}
          {!err && res && items.length === 0 && <div className="sempty">‘{res.query}{tt("’와 맞는 결과가 없어요.")}</div>}
          {!err && !res && <div className="sempty">{tt("예:")} <button className="lnk" onClick={() => setQ(tt("이사 견적"))}>{tt("이사 견적")}</button> · <button className="lnk" onClick={() => setQ(tt("카피"))}>{tt("카피")}</button> · <button className="lnk" onClick={() => setQ(tt("배포"))}>{tt("배포")}</button></div>}
          {items.map((h, k) => (
            <div key={`${h.type}:${h.id}`} className={`shit${k === sel ? ' on' : ''}`} onMouseEnter={() => setSel(k)} onClick={() => go(h)} role="option" aria-selected={k === sel}>
              <span className="sty">{TYPE_LABEL[h.type] ?? h.type}</span>
              <div className="sbody">
                <div className="stt">{h.task && <StatusGlyph v={h.task.statusVisual} />}<b>{h.title}</b>{h.sourceAi && <AiMark ai={h.sourceAi} />}</div>
                <div className="ssn"><Md src={h.snippetMd} /></div>
                <div className="smeta">
                  {h.task && h.type !== 'task' && <span>{tt("과제 ·")} {h.task.title}</span>}
                  {h.at && <span>{monthDay(h.at)}</span>}
                  {h.vaultPath && <span className="mono">{h.vaultPath}</span>}
                </div>
              </div>
              {h.sourceUrl && <button className="sext" title={tt("원래 대화 열기")} onClick={(e) => { e.stopPropagation(); openExternal(h.sourceUrl); }}>{tt("원래 대화")} <Icon name="arrow" size={12} /></button>}
            </div>
          ))}
          {res?.page.hasMore && (
            <button className="smore" onClick={() => void loadMore()} disabled={more}>{more ? tt("더 불러오는 중…") : ttf("더 보기 · {0}건 남음", Math.max(0, (res.page.total ?? items.length) - items.length))}</button>
          )}
        </div>
        <div className="sfoot"><span>{tt("↑↓ 이동")}</span><span>{tt("Enter 열기")}</span><span>{tt("Esc 닫기")}</span></div>
      </div>
    </div>
  );
}
