import { tt, ttf } from '../i18n';
// 1.9.0 기기 연결: 페어링 코드(POST /pairing, 5분) · 연결한 기기(GET /pairing/clients, 폐기 POST …/revoke) · AI별 수집 어댑터 상태(GET /sync-state).
// 웹앱(localhost)은 토큰 없이 web 세션. 토큰이 보이는 곳은 확장·MCP 쪽 한 번뿐 — 여기선 tokenId만 다룬다.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PairedClient, PairingClientKind, StartPairingResponse, SyncStateItem } from '@subbrain/shared';
import { api } from '../api/endpoints';
import { useApi } from '../api/useApi';
import { errorText } from '../api/client';
import { DataModeNote } from '../components/DataModeNote';
import { Icon } from '../components/Icons';
import { AiMark } from '../components/Marks';
import { useToast } from '../components/Toast';
import { aiLabel, fullDateTime, relative } from '../lib/format';
import { now } from '../lib/clock';
import '../styles/review.css';
import '../styles/devices.css';

const KIND: Record<PairingClientKind, string> = { extension: tt("크롬 확장"), mcp: tt("MCP(Claude 등)"), collector: tt("로컬 수집기") };
const SCOPE: Record<string, string> = { ingest: tt("수집"), read: tt("읽기"), mcp_write: tt("쓰기") };
const HEALTH: Record<string, { t: string; c: string; tip: string }> = {
  ok: { t: tt("정상"), c: 'ok', tip: tt("화면 구조 검사를 모두 통과") },
  degraded: { t: tt("일부 문제"), c: 'warm', tip: tt("읽기는 되지만 일부 검사 실패(예: 답 끝 표시)") },
  broken: { t: tt("고장"), c: 'late', tip: tt("화면 구조가 바뀌어 대화를 못 읽어요 — 확장 업데이트가 필요해요") },
};

export default function Devices() {
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const clients = useApi(() => api.pairingClients(), [tick]);
  const sync = useApi(() => api.syncState(), [tick]);
  const [code, setCode] = useState<StartPairingResponse | null>(null);
  const [kind, setKind] = useState<PairingClientKind>('extension');
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<string | null>(null);
  const [, force] = useState(0);
  useEffect(() => { if (!code) return; const h = setInterval(() => force((x) => x + 1), 1000); return () => clearInterval(h); }, [code]);
  // 새 기기가 붙었는지 코드가 떠 있는 동안 5초마다 목록 다시 보기
  useEffect(() => { if (!code) return; const h = setInterval(() => setTick((t) => t + 1), 5000); return () => clearInterval(h); }, [code]);

  const left = code ? Math.max(0, Math.round((Date.parse(code.expiresAt) - Date.now()) / 1000)) : 0;
  const start = async () => {
    setBusy(true);
    try { setCode(await api.startPairing({ kind, name: kind === 'extension' ? tt("내 크롬") : kind === 'mcp' ? 'Claude MCP' : tt("로컬 수집기") })); }
    catch (e) { toast.show(ttf("코드를 받지 못했어요: {0}", errorText(e)), { err: true }); }
    finally { setBusy(false); }
  };
  const revoke = async (c: PairedClient) => {
    try { await api.revokeClient(c.tokenId); toast.show(ttf("‘{0}’ 연결을 끊었어요 — 그 기기는 다시 페어링해야 보낼 수 있어요", c.name)); setAsk(null); setTick((t) => t + 1); }
    catch (e) { toast.show(ttf("끊지 못했어요: {0}", errorText(e)), { err: true }); }
  };
  const items = clients.data?.items ?? [];
  const active = items.filter((c) => !c.revokedAt);
  const revoked = items.filter((c) => c.revokedAt);
  const joined = code ? active.find((c) => Date.parse(c.createdAt) >= Date.parse(code.expiresAt) - 300_000) : undefined;

  return (
    <div className="review scroll">
      <div className="rvin">
        <div className="mast">
          <div className="l"><span className="eyebrow">{tt("확장 프로그램 · MCP · 수집기")}</span><h1>{tt("기기 연결")}</h1></div>
          <div className="r"><button onClick={() => setTick((t) => t + 1)}><Icon name="rotate" />{tt("새로고침")}</button></div>
        </div>

        <div className="rvgrid dvgrid">
          <section aria-label={tt("페어링 코드")}>
            <h2>{tt("새 기기 연결")} <span>{tt("코드는 5분 동안 한 번만 쓸 수 있어요")}</span></h2>
            <div className="pcard">
              <div className="seg" role="group" aria-label={tt("연결할 것")}>
                {(['extension', 'mcp'] as const).map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => { setKind(k); setCode(null); }}>{KIND[k]}</button>)}
              </div>
              {code && left > 0 ? (
                <>
                  <div className="pcode" aria-label={tt("페어링 코드")} data-code={code.code.replace(/\D/g, '')}>{code.code.replace(/\D/g, '').replace(/(\d{3})(\d{3})/, '$1 $2')}</div>
                  <div className="pcount"><i style={{ width: `${(left / 300) * 100}%` }} /><span>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} {tt("남음")}</span></div>
                  {joined ? <p className="pok"><Icon name="check" size={13} />‘{joined.name}{tt("’가 연결됐어요")}</p>
                    : <p>{kind === 'extension' ? tt("크롬 툴바의 서브브레인 확장을 열고 이 6자리를 넣으세요.") : tt("터미널에서 subbrain mcp pair 를 실행하면 이 과정을 대신해요. 직접 넣을 때는 이 코드를 쓰세요.")}</p>}
                  <button className="btn ghost" onClick={() => setCode(null)}>{tt("닫기")}</button>
                </>
              ) : (
                <>
                  {code && <p className="dim">{tt("코드가 만료됐어요. 새로 받아 주세요.")}</p>}
                  <p>{kind === 'extension' ? tt("확장이 chatgpt.com·claude.ai에서 본 대화를 이 컴퓨터의 서브브레인으로 보내요. 토큰은 확장에만 한 번 전달돼요.") : tt("Claude 데스크톱·Claude Code가 서브브레인을 읽게 해요(쓰기는 설정에서 따로 켬).")}</p>
                  <button className="btn pri" disabled={busy} onClick={() => void start()}><Icon name="plus" />{tt("코드 받기")}</button>
                </>
              )}
            </div>

            <h2 style={{ marginTop: 26 }}>{tt("AI별 수집 상태")} <span>{tt("확장이 보낸 어댑터 검사 · 대화 수")}</span></h2>
            {sync.error != null && <div className="state err"><b>{tt("수집 상태를 불러오지 못했어요")}</b><span>{errorText(sync.error)}</span></div>}
            <ul className="hlist">{(sync.data?.sources ?? []).map((s) => <HealthRow key={s.sourceAi} s={s} />)}</ul>
            {sync.data && !sync.data.sources.length && <div className="rvempty">{tt("아직 확장이 보낸 상태가 없어요.")}</div>}
          </section>

          <section aria-label={tt("연결한 기기")}>
            <h2>{tt("연결한 기기")} <span>{active.length}{tt("개")}</span></h2>
            {clients.loading && !clients.data && <div className="skel" style={{ height: 90 }} />}
            {clients.error != null && <div className="state err"><b>{tt("기기 목록을 불러오지 못했어요")}</b><span>{errorText(clients.error)}</span><button className="btn" onClick={clients.reload}>{tt("다시 시도")}</button></div>}
            {clients.data && !active.length && <div className="rvempty">{tt("연결한 기기가 없어요. 왼쪽에서 코드를 받아 확장에 넣어 보세요.")}</div>}
            <ul className="dlist">{active.map((c) => (
              <li key={c.tokenId}>
                <div className="d1"><b>{c.name}</b><span className="tb">{KIND[c.kind] ?? c.kind}</span>{c.scopes.map((x) => <span key={x} className="sc">{SCOPE[x] ?? x}</span>)}</div>
                <div className="d2">
                  <span title={fullDateTime(c.createdAt)}>{tt("연결")} {relative(c.createdAt, now())}</span>
                  <span>{c.lastUsedAt ? ttf("마지막 사용 {0}", relative(c.lastUsedAt, now())) : tt("아직 안 씀")}</span>
                  {c.rotatedAt && <span>{tt("토큰 교체")} {relative(c.rotatedAt, now())}</span>}
                  {c.extensionId && <code title={`chrome-extension://${c.extensionId}`}>{c.extensionId.slice(0, 8)}…</code>}
                  <code className="dim">{c.tokenId}</code>
                </div>
                {ask === c.tokenId ? (
                  <div className="d3"><span>{tt("이 기기의 연결을 끊을까요? 보내던 수집이 멈춰요.")}</span><button className="btn" onClick={() => void revoke(c)}>{tt("끊기")}</button><button className="btn ghost" onClick={() => setAsk(null)}>{tt("취소")}</button></div>
                ) : <button className="btn ghost dx" onClick={() => setAsk(c.tokenId)}>{tt("연결 끊기")}</button>}
              </li>
            ))}</ul>
            {revoked.length > 0 && <details className="drev"><summary>{tt("끊은 기기")} {revoked.length}{tt("개")}</summary><ul>{revoked.map((c) => <li key={c.tokenId}>{c.name} · {KIND[c.kind] ?? c.kind} {tt("· 끊음")} {relative(c.revokedAt, now())}</li>)}</ul></details>}
            <p className="dnote">{tt("MCP가 남긴 기록은")} <Link className="lnk" to="/review">{tt("확인할 것 → AI가 남긴 기록")}</Link>{tt("에서 되돌릴 수 있어요.")}</p>
          </section>
        </div>
      </div>
      <DataModeNote style={{ left: 40, bottom: 6 }} />
    </div>
  );
}

function HealthRow({ s }: { s: SyncStateItem }) {
  const h = s.health ? HEALTH[s.health] : null;
  return (
    <li className={s.health === 'broken' ? 'broken' : ''}>
      <AiMark ai={s.sourceAi} /><b>{aiLabel(s.sourceAi)}</b>
      <span className={`hb ${h?.c ?? 'dim'}`} title={h?.tip ?? tt("확장이 아직 상태를 보내지 않았어요")}>{h?.t ?? tt("보고 없음")}</span>
      <span className="hm">{s.lastSnapshotAt ? ttf("마지막 수신 {0}", relative(s.lastSnapshotAt, now())) : tt("받은 것 없음")} {tt("· 대화")} {s.knownConversations}{s.pendingFetch ? ttf(" · 따라잡기 대기 {0}", s.pendingFetch) : ''}{s.bufferedSnapshots ? ttf(" · 확장에 쌓임 {0}", s.bufferedSnapshots) : ''}</span>
      <span className="hv">{s.adapter ? `${s.adapter.name} ${s.adapter.version}` : ''}{s.healthAt ? ttf(" · 검사 {0}", relative(s.healthAt, now())) : ''}{s.errorCode ? ` · ${s.errorCode}` : ''}</span>
    </li>
  );
}
