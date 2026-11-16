import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { DashboardResponse, HealthResponse, MetaResponse } from '@subbrain/shared';
import { api } from '../api/endpoints';

interface AppData {
  dashboard: DashboardResponse | null; meta: MetaResponse | null; health: HealthResponse | null;
  error: unknown; refresh: () => void;
}
const Ctx = createContext<AppData>({ dashboard: null, meta: null, health: null, error: null, refresh: () => {} });
export const useAppData = () => useContext(Ctx);

/** 상단바·카운터·배지에 쓰는 전역 데이터 (dashboard는 1분마다 새로고침) */
export function AppDataProvider({ children }: { children: ReactNode }) {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const refresh = useCallback(() => { api.dashboard().then((d) => { setDashboard(d); setError(null); }).catch(setError); }, []);
  useEffect(() => {
    refresh();
    api.meta().then(setMeta).catch(() => {});
    api.health().then(setHealth).catch(() => {});
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);
  return <Ctx.Provider value={{ dashboard, meta, health, error, refresh }}>{children}</Ctx.Provider>;
}
