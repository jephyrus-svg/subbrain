import { tt, ttf } from '../i18n';
// 1.5.0 로컬 수집(§12.10): Claude Code · Codex 세션 파일 감시 상태 카드.
// 상단 막대 "수집" 옆 작은 팝오버에 들어간다. 감시 켜기/끄기 = PUT /collector/config {enabled}, 지금 스캔 = POST /collector/scan.
import { Link } from 'react-router-dom';
import { useState } from 'react';
import type { CollectorStatus } from '@subbrain/shared';
import { api } from '../api/endpoints';
import { useApi } from '../api/useApi';
import { ApiRequestError, errorText } from '../api/client';
import { AiMark } from './Marks';
import { aiLabel, relative } from '../lib/format';
import { now } from '../lib/clock';
import { useToast } from './Toast';

const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.max(0, Math.round(n / 1e6))} MB`);

export function CollectorCard() {
  const q = useApi(() => api.collector(), []);
  const toast = useToast();
  const [busy, setBusy] = useState<'toggle' | 'scan' | null>(null);
  const [over, setOver] = useState<CollectorStatus | null>(null);
  const st = over ?? q.data;

  if (q.error && !st) return <div className="colc"><div className="colh"><b>{tt("로컬 수집")}</b></div><p className="colm">{q.error instanceof ApiRequestError && q.error.notImplemented ? tt("이 코어에는 아직 로컬 수집기가 없어요.") : errorText(q.error)}</p></div>;
  if (!st) return <div className="colc"><div className="colh"><b>{tt("로컬 수집")}</b></div><p className="colm">{tt("불러오는 중…")}</p></div>;

  const toggle = async () => {
    setBusy('toggle');
    try { const r = await api.putCollectorConfig({ enabled: !st.config.enabled }); setOver(r); toast.show(r.config.enabled ? tt("로컬 세션 감시를 켰어요") : tt("로컬 세션 감시를 껐어요")); }
    catch (e) { toast.show(errorText(e), { err: true }); }
    finally { setBusy(null); }
  };
  const scan = async () => {
    setBusy('scan');
    try { await api.collectorScan(); toast.show(tt("지금 스캔을 시작했어요 — 바뀐 세션만 다시 읽어요")); setTimeout(() => { void api.collector().then(setOver, () => {}); }, 1500); }
    catch (e) { toast.show(errorText(e), { err: true }); }
    finally { setBusy(null); }
  };
  const lastScan = st.sources.map((s) => s.lastScanAt).filter(Boolean).sort().at(-1) ?? null;

  return (
    <div className="colc">
      <div className="colh">
        <b>{tt("로컬 수집")}</b><span className="cols">{tt("Claude Code · Codex 세션 파일")}</span>
        <label className={`sw${st.config.enabled ? ' on' : ''}`} title={tt("켜면 세션 파일이 바뀔 때마다 이어서 읽어요")}>
          <input type="checkbox" checked={st.config.enabled} disabled={busy !== null} onChange={() => void toggle()} aria-label={tt("로컬 세션 감시")} />
          <i />{st.config.enabled ? (st.watching ? tt("감시 중") : tt("켜짐 · 대기")) : tt("꺼짐")}
        </label>
      </div>
      <ul className="colsrc">
        {st.sources.map((s) => (
          <li key={s.sourceAi} className={s.enabled ? '' : 'off'}>
            <div className="r1"><AiMark ai={s.sourceAi} /><b>{aiLabel(s.sourceAi)}</b><span className="n">{tt("세션")} {s.sessions.toLocaleString()}{tt("개")}</span>
              {s.backfill.state === 'running' && <span className="bf">{tt("처음 읽기")} {s.backfill.filesDone}/{s.backfill.filesTotal}</span>}
              {s.errors.length > 0 && <span className="er" title={s.errors.map((x) => `${x.file}: ${x.message}`).join('\n')}>{tt("오류")} {s.errors.length}</span>}
            </div>
            <code title={s.root}>{s.root}{!s.rootExists && tt(" (폴더 없음)")}</code>
            <div className="r3">{tt("파일")} {s.files}{tt("개 ·")} {mb(s.bytesIngested)} / {mb(s.bytesTotal)} {tt("읽음 · 마지막 스캔")} {s.lastScanAt ? relative(s.lastScanAt, now()) : tt("없음")}</div>
          </li>
        ))}
      </ul>
      <div className="colf">
        <span>{lastScan ? ttf("마지막 스캔 {0}", relative(lastScan, now())) : tt("아직 스캔 안 함")}{st.redactedSecrets > 0 ? ttf(" · 가린 비밀정보 {0}개", st.redactedSecrets) : ''}</span>
        <button className="btn" disabled={busy !== null} onClick={() => void scan()}>{busy === 'scan' ? tt("스캔 중…") : tt("지금 스캔")}</button>
      </div>
      <div className="colf coldev"><span>{tt("브라우저 확장 · MCP 연결과 AI별 수집 상태")}</span><Link className="btn" to="/devices">{tt("기기 연결 →")}</Link></div>
    </div>
  );
}
