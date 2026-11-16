import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export interface ApiState<T> { data: T | null; error: unknown; loading: boolean; reload: () => void; setData: (fn: (d: T | null) => T | null) => void }

/** 간단한 데이터 훅: deps가 바뀌면 다시 부르고, 늦게 온 이전 응답은 버린다 */
export function useApi<T>(fn: () => Promise<T>, deps: DependencyList): ApiState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const my = ++seq.current;
    setLoading(true); setError(null);
    fn().then((d) => { if (my === seq.current) { setDataState(d); setLoading(false); } })
      .catch((e) => { if (my === seq.current) { setError(e); setLoading(false); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((f: (d: T | null) => T | null) => setDataState((d) => f(d)), []);
  return { data, error, loading, reload, setData };
}
