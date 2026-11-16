import { useEffect, useRef, type ReactNode, type CSSProperties } from 'react';

/** 바깥을 누르거나 Esc를 누르면 닫히는 작은 메뉴 */
export function Popover({ open, onClose, children, style, className = 'menu' }: { open: boolean; onClose: () => void; children: ReactNode; style?: CSSProperties; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const t = setTimeout(() => document.addEventListener('mousedown', down), 0);
    document.addEventListener('keydown', key);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open, onClose]);
  if (!open) return null;
  return <div ref={ref} className={className} style={style} role="menu">{children}</div>;
}
