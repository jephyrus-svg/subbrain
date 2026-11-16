import { tt, ttf } from '../i18n';
import { useEffect, useState } from 'react';
import { CORE_LABEL, dataMode, setDataMode } from '../api/client';

/** 개발 모드에서만: 공유 스키마와 어긋난 응답 수 */
function useSchemaIssues(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let off: (() => void) | undefined; let alive = true;
    void import('../api/validate').then((v) => {
      if (!alive) return;
      const sync = () => setN(v.schemaStore().issues.length);
      sync(); off = v.onSchemaIssue(sync);
    });
    return () => { alive = false; off?.(); };
  }, []);
  return n;
}

/** 화면 구석의 작은 안내: 지금 어떤 데이터로 그렸는지 + 모드 전환 */
export function DataModeNote({ style }: { style?: React.CSSProperties }) {
  const m = dataMode();
  const issues = useSchemaIssues();
  return (
    <div className="note" style={style}>
      {m === 'mock' ? <>{tt("예시 데이터로 채운 화면 ·")} <button onClick={() => setDataMode('live')}>{tt("코어에 연결")}</button></>
        : <>{tt("코어")} {CORE_LABEL} · <button onClick={() => setDataMode('mock')}>{tt("예시 데이터로 보기")}</button></>}
      {issues > 0 && <> · <button className="warn" title={tt("콘솔의 [schema] 경고 또는 window.__subbrainSchema 참고")} onClick={() => console.table(window.__subbrainSchema?.issues.map((i) => ({ kind: i.kind, method: i.method, path: i.path, schema: i.schema, first: `${i.issues[0]?.path}: ${i.issues[0]?.message}` })))}>{tt("스키마 경고")} {issues}</button></>}
    </div>
  );
}
