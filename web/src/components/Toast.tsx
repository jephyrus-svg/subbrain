import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

interface ToastItem { id: number; text: string; err?: boolean; action?: { label: string; run: () => void } }
interface ToastApi { show: (text: string, opts?: { err?: boolean; action?: ToastItem['action']; ms?: number }) => void }
const Ctx = createContext<ToastApi>({ show: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const show = useCallback<ToastApi['show']>((text, opts = {}) => {
    const id = next.current++;
    setItems((xs) => [...xs.slice(-2), { id, text, err: opts.err, action: opts.action }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), opts.ms ?? (opts.action ? 6000 : 3200));
  }, []);
  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.err ? ' err' : ''}`}>
            <span>{t.text}</span>
            {t.action && <button onClick={() => { t.action!.run(); setItems((xs) => xs.filter((x) => x.id !== t.id)); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
