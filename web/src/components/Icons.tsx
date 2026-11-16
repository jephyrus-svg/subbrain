// 얇은 선 아이콘 스프라이트 (design/v3/src/common.py ICONS 그대로, stroke 1.35)
import type { CSSProperties } from 'react';

export type IconName = 'search' | 'graph' | 'board' | 'time' | 'sun' | 'arrow' | 'copy' | 'note' | 'back' | 'check' | 'q' | 'rotate' | 'plus' | 'minus'
  | 'filter' | 'play' | 'link' | 'pause' | 'archive' | 'trash' | 'warn' | 'more' | 'chev' | 'cube' | 'close'
  // 1.1.0: 다른 곳에서 이어감 · 분류 불가(안전 필터) · 새 프로젝트 제안
  | 'handoff' | 'shield' | 'folder-plus'
  // 온톨로지 객체 타입 (설계서 10.2.6)
  | 'o-person' | 'o-decision' | 'o-tool' | 'o-artifact' | 'o-place' | 'o-organization' | 'o-topic' | 'o-path';

export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <symbol id="i-search" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.6" /><path d="M10.4 10.4 14 14" /></symbol>
      <symbol id="i-graph" viewBox="0 0 16 16"><circle cx="4" cy="5" r="1.8" /><circle cx="11.5" cy="3.8" r="1.4" /><circle cx="10" cy="11.5" r="2.3" /><path d="M5.6 5.6 8.3 10M5.8 4.7 10.1 4M11.2 5.2 10.6 9.2" /></symbol>
      <symbol id="i-board" viewBox="0 0 16 16"><rect x="2" y="2.5" width="3.4" height="11" rx=".6" /><rect x="6.3" y="2.5" width="3.4" height="7" rx=".6" /><rect x="10.6" y="2.5" width="3.4" height="9" rx=".6" /></symbol>
      <symbol id="i-time" viewBox="0 0 16 16"><path d="M4 2.5v11M4 4.5h8M4 8h5.5M4 11.5h7" /></symbol>
      <symbol id="i-sun" viewBox="0 0 16 16"><path d="M2 12.5h12M4.5 12.5a3.5 3.5 0 0 1 7 0M8 4.5v1.6M3.4 7.4l1.1 1M12.6 7.4l-1.1 1" /></symbol>
      <symbol id="i-arrow" viewBox="0 0 16 16"><path d="M5 11 11 5M6 5h5v5" /></symbol>
      <symbol id="i-copy" viewBox="0 0 16 16"><rect x="5" y="5" width="8" height="8.5" rx="1" /><path d="M3 10.5V3.8C3 3.3 3.3 3 3.8 3H9.5" /></symbol>
      <symbol id="i-note" viewBox="0 0 16 16"><path d="M4 2.5h5.5L12.5 5.5v8H4z" /><path d="M9.5 2.5v3h3M6 8.5h4.5M6 11h3" /></symbol>
      <symbol id="i-back" viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5" /></symbol>
      <symbol id="i-check" viewBox="0 0 16 16"><path d="M3.5 8.5 6.5 11.5 12.5 5" /></symbol>
      <symbol id="i-q" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" /><path d="M6.4 6.4a1.7 1.7 0 1 1 2.3 1.6c-.5.2-.7.5-.7 1v.3M8 11.2v.1" /></symbol>
      <symbol id="i-rotate" viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.8v2.6h-2.6" /></symbol>
      <symbol id="i-plus" viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9" /></symbol>
      <symbol id="i-minus" viewBox="0 0 16 16"><path d="M3.5 8h9" /></symbol>
      <symbol id="i-filter" viewBox="0 0 16 16"><path d="M2.5 4h11M4.5 8h7M6.5 12h3" /></symbol>
      <symbol id="i-play" viewBox="0 0 16 16"><path d="M5.5 3.8v8.4L12 8z" /></symbol>
      <symbol id="i-link" viewBox="0 0 16 16"><path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.6.6M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.6-.6" /></symbol>
      <symbol id="i-pause" viewBox="0 0 16 16"><path d="M6 4v8M10 4v8" /></symbol>
      <symbol id="i-archive" viewBox="0 0 16 16"><rect x="2.5" y="3" width="11" height="3" rx=".5" /><path d="M3.5 6v6.5h9V6M6.5 8.5h3" /></symbol>
      <symbol id="i-trash" viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></symbol>
      <symbol id="i-warn" viewBox="0 0 16 16"><path d="M8 2.8 14 13H2z" /><path d="M8 6.8v3M8 11.4v.1" /></symbol>
      <symbol id="i-more" viewBox="0 0 16 16"><path d="M4 8h.1M8 8h.1M12 8h.1" /></symbol>
      <symbol id="i-chev" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" /></symbol>
      <symbol id="i-cube" viewBox="0 0 16 16"><path d="M8 2 13.5 5v6L8 14l-5.5-3V5z" /><path d="M2.5 5 8 8l5.5-3M8 8v6" /></symbol>
      <symbol id="i-close" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" /></symbol>
      <symbol id="i-handoff" viewBox="0 0 16 16"><path d="M9.5 3.5H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h5.5" /><path d="M7 8h6.5M11 5.5 13.5 8 11 10.5" /></symbol>
      <symbol id="i-shield" viewBox="0 0 16 16"><path d="M8 2.3 13 4v3.9c0 2.9-2.1 5-5 5.8-2.9-.8-5-2.9-5-5.8V4z" /><path d="M8 5.6v3M8 10.6v.1" /></symbol>
      <symbol id="i-folder-plus" viewBox="0 0 16 16"><path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.3 1.5h4.7a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" /><path d="M8 7.3v3.4M6.3 9h3.4" /></symbol>
      <symbol id="i-o-person" viewBox="0 0 16 16"><circle cx="8" cy="5.4" r="2.5" /><path d="M3.3 13.4c.6-2.7 2.5-4.2 4.7-4.2s4.1 1.5 4.7 4.2" /></symbol>
      <symbol id="i-o-decision" viewBox="0 0 16 16"><path d="M4 14V2.6" /><path d="M4 3.1h8.2l-1.7 2.8 1.7 2.8H4" /><path d="M6.2 5.8l1.2 1.1 2-2.1" /></symbol>
      <symbol id="i-o-tool" viewBox="0 0 16 16"><path d="M10.4 2.5a3.1 3.1 0 0 0-3.5 4.1l-4.1 4.1a1.25 1.25 0 0 0 1.8 1.8l4.1-4.1a3.1 3.1 0 0 0 4.1-3.5l-1.9 1.9-1.7-.3-.3-1.7z" /></symbol>
      <symbol id="i-o-artifact" viewBox="0 0 16 16"><path d="M4 2.5h5.5L12.5 5.5v8H4z" /><path d="M9.5 2.5v3h3M6 8.5h4.5M6 11h3" /></symbol>
      <symbol id="i-o-place" viewBox="0 0 16 16"><path d="M8 14s4.3-4.1 4.3-7.5a4.3 4.3 0 0 0-8.6 0C3.7 9.9 8 14 8 14z" /><circle cx="8" cy="6.5" r="1.5" /></symbol>
      <symbol id="i-o-organization" viewBox="0 0 16 16"><path d="M3.5 13.5V2.8h6v10.7M9.5 6.2h3v7.3M2.3 13.5h11.4M5.5 5h2M5.5 7.5h2M5.5 10h2" /></symbol>
      <symbol id="i-o-topic" viewBox="0 0 16 16"><path d="M6.6 2.8 5.2 13.2M11 2.8 9.6 13.2M3.4 6.2h9.8M2.8 9.8h9.8" /></symbol>
      <symbol id="i-o-path" viewBox="0 0 16 16"><circle cx="3.5" cy="11.5" r="1.6" /><circle cx="12.5" cy="4.5" r="1.6" /><path d="M5 11.5h3.5a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4H11" /></symbol>
    </svg>
  );
}

export function Icon({ name, size, style, className = 'i' }: { name: IconName; size?: number; style?: CSSProperties; className?: string }) {
  const s: CSSProperties = size ? { width: size, height: size, ...style } : style ?? {};
  return <svg className={className} style={s} aria-hidden="true"><use href={`#i-${name}`} /></svg>;
}

export function Logo() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="#EDEDEB" strokeWidth="1.4" aria-hidden="true">
      <circle cx="6" cy="7" r="2.6" fill="#7F9CC4" stroke="#7F9CC4" /><circle cx="14.5" cy="5.5" r="1.7" fill="#8FB59A" stroke="#8FB59A" />
      <circle cx="12.5" cy="14" r="3.2" fill="#D08A66" stroke="#D08A66" /><path d="M8.4 8.2l2.5 3.3M8.5 6.6l4.3-.7" />
    </svg>
  );
}
