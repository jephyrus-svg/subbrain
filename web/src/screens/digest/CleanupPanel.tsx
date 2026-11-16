import { tt, ttf } from '../../i18n';
// "하루 한 번 승인 · 채팅창 정리" — Phase 6 미리보기.
// 코어가 SUBBRAIN_CLEANUP=preview 로 떠 있으면 digest.cleanup 과 /deletion-batches/* 가 살아 있다(src/cleanup). 아니면 cleanup=null · 501.
// 승인은 "지워도 됨" 표시만 남긴다 — ChatGPT·Claude 등에서 실제로 지우는 실행기는 아직 없다(executor off).
// ChatGPT 대화는 삭제 대신 자동 보관(되돌릴 수 있음) 목록으로 가고, 여기서 보관 해제·다시 보관을 한다.
import { useEffect, useMemo, useState } from 'react';
import { cleanupApi, type CleanupArchiveItem, type CleanupStatus } from '../../api/cleanup';
import type { DigestCleanup, SourceAi } from '@subbrain/shared';
import { api } from '../../api/endpoints';
import { ApiRequestError, errorText } from '../../api/client';
import type { DeletionBatch } from '@subbrain/shared';

type DeletionGroup = DeletionBatch['groups'][number];
type DeletionItem = DeletionGroup['items'][number];
import { useAppData } from '../../components/AppData';
import { Icon } from '../../components/Icons';
import { AiMark, Svc } from '../../components/Marks';
import { useToast } from '../../components/Toast';
import { aiLabel, dotDate } from '../../lib/format';
import { ServiceArchivePanel } from './ServiceArchivePanel';

type View = 'idle' | 'confirm' | 'sending';

const ROWS_FOLDED = 6;

export function CleanupPanel({ cleanup, reload }: { cleanup: DigestCleanup | null; reload?: () => void }) {
  const toast = useToast();
  const { health, refresh } = useAppData();
  const [batch, setBatch] = useState<DeletionBatch | null>(cleanup?.deletionBatch ?? null);
  const [expanded, setExpanded] = useState<Partial<Record<SourceAi, boolean>>>({});
  const [pending, setPending] = useState<Set<number>>(new Set());
  const [view, setView] = useState<View>('idle');
  const [phrase, setPhrase] = useState('');
  const [dialogErr, setDialogErr] = useState<string | null>(null);
  useEffect(() => { setBatch(cleanup?.deletionBatch ?? null); }, [cleanup]);
  // 보조 정보: 항목별 이유 · 보관 목록 · 실행기 상태 (없으면 조용히 생략)
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [archive, setArchive] = useState<CleanupArchiveItem[] | null>(null);
  const [archOpen, setArchOpen] = useState(false);
  const [archAll, setArchAll] = useState(false);
  const [archBusy, setArchBusy] = useState<Set<number>>(new Set());
  const [unfold, setUnfold] = useState<Partial<Record<SourceAi, boolean>>>({});
  const [status, setStatus] = useState<CleanupStatus | null>(null);
  const [running, setRunning] = useState(false);
  const batchId = cleanup?.deletionBatch?.id ?? null;
  useEffect(() => {
    let off = false;
    if (batchId) cleanupApi.detail(batchId).then((d) => { if (!off) setReasons(d.reasons); }).catch(() => { /* 보조 경로 없음 */ });
    if (cleanup) cleanupApi.archive().then((a) => { if (!off) setArchive(a.archive); }).catch(() => { /* 보조 경로 없음 */ });
    else cleanupApi.status().then((st) => { if (!off) setStatus(st); }).catch(() => { /* 코어가 정리 미리보기를 안 켬 */ });
    return () => { off = true; };
  }, [batchId, cleanup]);
  const archQueued = archive?.filter((a) => a.state === 'archive_queued').length ?? 0;
  const archUndone = archive?.filter((a) => a.state === 'archive_undone').length ?? 0;
  const changeArchive = async (items: CleanupArchiveItem[], undo: boolean) => {
    const ids = items.map((i) => i.itemId);
    setArchBusy((b) => new Set([...b, ...ids]));
    try {
      const r = undo ? await cleanupApi.undoArchive(ids) : await cleanupApi.redoArchive(ids);
      setArchive(r.archive);
      toast.show(undo ? ttf("{0}개 보관을 해제했어요 — 다음 정리 후보에서도 빼요", ids.length) : ttf("{0}개를 다시 보관 대기로 돌렸어요", ids.length));
    } catch (e) { toast.show(errorText(e), { err: true }); }
    finally { setArchBusy((b) => { const n = new Set(b); ids.forEach((i) => n.delete(i)); return n; }); }
  };
  const runNow = async () => {
    setRunning(true);
    try {
      const r = await cleanupApi.run();
      toast.show(r.batchId ? (r.created ? tt("오늘 정리 후보를 만들었어요") : tt("오늘 정리 후보가 이미 있어요")) : tt("지금은 정리할 대화가 없어요"));
      reload?.();
    } catch (e) { toast.show(errorText(e), { err: true }); }
    finally { setRunning(false); }
  };

  const sellable = health?.buildTarget === 'sellable';
  const excludedItems = useMemo(() => batch?.groups.flatMap((g) => g.items.filter((i) => !i.selected).map((i) => ({ ...i, sourceAi: g.sourceAi }))) ?? [], [batch]);
  const autoExcludedCount = batch?.autoExcluded.reduce((s, x) => s + x.count, 0) ?? 0;
  const allBackedUp = batch?.groups.every((g) => g.backupVerified) ?? false;

  if (!cleanup) {
    return (
      <aside className="appr">
        <div className="body scroll">
          <span className="eyebrow">{tt("하루 한 번 승인")}</span>
          <h1>{tt("채팅창 정리")}</h1>
          {status?.enabled ? (
            <div className="later">
              <b>{tt("오늘 정리 후보를 아직 만들지 않았어요.")}</b><br />
              {tt("끝난 지")} {status.graceDays}{tt("일이 지난 대화를 골라 원문을 한 번 더 내보내 두고, ChatGPT 대화는 보관 대기로, 나머지는 여기서 승인할 목록으로 올려요. 서비스 쪽 대화는 건드리지 않아요.")}
              <div style={{ marginTop: 10 }}><button className="btn" disabled={running} onClick={() => void runNow()}><Icon name="rotate" size={13} />{running ? tt("후보 만드는 중…") : tt("지금 후보 만들기")}</button></div>
            </div>
          ) : (
            <div className="later">
              <b>{tt("다음 단계(Phase 6)에서 열려요.")}</b><br />
              {tt("지금은 대화 원문과 볼트 노트만 저장하고, ChatGPT·Claude 같은 서비스 쪽 대화는 건드리지 않아요. 이 칸이 열리면 끝난 대화를 자동으로 보관하고, 지워도 되는 대화는 여기서 한 번에 승인하게 돼요.")}
            </div>
          )}
        </div>
      </aside>
    );
  }

  /** 서버가 돌려준 전체 배치 → 화면의 그룹 수·선택 수 갱신 (보이는 항목만 갱신, 펼친 그룹은 전체 교체) */
  const mergeServer = (srv: DeletionBatch) => setBatch((cur) => {
    if (!cur) return srv;
    return {
      ...cur, state: srv.state, selectedCount: srv.selectedCount, candidateCount: srv.candidateCount,
      groups: cur.groups.map((g) => {
        const sg = srv.groups.find((x) => x.sourceAi === g.sourceAi); if (!sg) return g;
        const items = expanded[g.sourceAi] ? sg.items : g.items.map((i) => sg.items.find((x) => x.itemId === i.itemId) ?? i);
        return { ...g, selected: sg.selected, total: sg.total, backupVerified: sg.backupVerified, items };
      }),
    };
  });

  const setItems = async (group: DeletionGroup, items: DeletionItem[], selected: boolean) => {
    if (!batch || batch.state !== 'pending') return;
    const ids = items.filter((i) => i.selected !== selected).map((i) => i.itemId);
    if (!ids.length) return;
    // 낙관적 갱신
    setPending((p) => new Set([...p, ...ids]));
    setBatch((cur) => cur && ({
      ...cur, selectedCount: cur.selectedCount + (selected ? ids.length : -ids.length),
      groups: cur.groups.map((g) => (g.sourceAi !== group.sourceAi ? g : { ...g, selected: g.selected + (selected ? ids.length : -ids.length), items: g.items.map((i) => (ids.includes(i.itemId) ? { ...i, selected, excludedByUser: !selected } : i)) })),
    }));
    try {
      let last: DeletionBatch | null = null;
      for (const id of ids) last = (await api.setDeletionItem(batch.id, id, { selected })).batch;
      if (last) mergeServer(last);
    } catch (e) {
      setBatch((cur) => cur && ({
        ...cur, selectedCount: cur.selectedCount - (selected ? ids.length : -ids.length),
        groups: cur.groups.map((g) => (g.sourceAi !== group.sourceAi ? g : { ...g, selected: g.selected - (selected ? ids.length : -ids.length), items: g.items.map((i) => (ids.includes(i.itemId) ? { ...i, selected: !selected, excludedByUser: selected } : i)) })),
      }));
      toast.show(errorText(e), { err: true });
    } finally {
      setPending((p) => { const n = new Set(p); ids.forEach((i) => n.delete(i)); return n; });
    }
  };

  const expand = async (g: DeletionGroup) => {
    if (!batch) return;
    try {
      const r = await api.deletionBatch(batch.id);
      const sg = r.batch.groups.find((x) => x.sourceAi === g.sourceAi);
      if (sg) { setExpanded((e) => ({ ...e, [g.sourceAi]: true })); setBatch((cur) => cur && ({ ...cur, groups: cur.groups.map((x) => (x.sourceAi === g.sourceAi ? sg : x)) })); }
    } catch (e) { toast.show(errorText(e), { err: true }); }
  };
  const toggleGroup = async (g: DeletionGroup) => {
    const target = g.selected < g.total; // 일부·전부 해제 상태면 모두 선택, 모두 선택이면 모두 해제
    let group = g;
    if (g.items.length < g.total && batch) {
      try {
        const r = await api.deletionBatch(batch.id);
        const sg = r.batch.groups.find((x) => x.sourceAi === g.sourceAi);
        if (sg) { group = sg; setExpanded((e) => ({ ...e, [g.sourceAi]: true })); setBatch((cur) => cur && ({ ...cur, groups: cur.groups.map((x) => (x.sourceAi === g.sourceAi ? sg : x)) })); }
      } catch (e) { toast.show(errorText(e), { err: true }); return; }
    }
    await setItems(group, group.items, target);
  };

  const openConfirm = () => { setPhrase(''); setDialogErr(null); setView('confirm'); };
  const approve = async () => {
    if (!batch) return;
    setView('sending'); setDialogErr(null);
    try {
      const r = await api.approveDeletion(batch.id, {
        expectedSelectedCount: batch.selectedCount,
        excludedItemIds: excludedItems.map((i) => i.itemId),
        ...(sellable ? { confirmPhrase: phrase.trim() } : {}),
      });
      mergeServer(r.batch); setView('idle'); refresh();
      toast.show(ttf("{0}개를 ‘삭제 승인’으로 표시했어요 — 실제 삭제는 아직 실행하지 않아요", r.batch.selectedCount));
    } catch (e) {
      setView('confirm');
      if (e instanceof ApiRequestError && e.status === 409) {
        setDialogErr(e.message);
        try { mergeServer((await api.deletionBatch(batch.id)).batch); } catch { /* 무시 */ }
      } else setDialogErr(errorText(e));
    }
  };
  const postpone = async () => {
    if (!batch) return;
    try { const r = await api.postponeDeletion(batch.id); mergeServer(r.batch); refresh(); toast.show(tt("내일 아침 요약에 다시 올릴게요")); }
    catch (e) { toast.show(errorText(e), { err: true }); }
  };

  const locked = !batch || batch.state !== 'pending';
  const n = batch?.selectedCount ?? 0;
  const phraseOk = !sellable || phrase.trim() === ttf("{0}개 삭제", n);

  return (
    <aside className="appr">
      <div className="body scroll">
        <span className="eyebrow">{tt("하루 한 번 승인")}</span>
        <h1>{tt("채팅창 정리")}</h1>
        <div className="cmode"><span>{tt("승인 = 표시만")}</span><span>{tt("실제 삭제 실행기 꺼짐")}</span><span>{tt("원문은 자동 내보내기로 한 벌 더")}</span></div>
        {cleanup.autoArchived.map((a) => (
          <div className="auto" key={a.sourceAi}>
            <Icon name="archive" /><span><Svc ai={a.sourceAi} /> {tt("대화")} <b>{a.count}{tt("개")}</b>{tt("를 보관 대기로 옮겼어요 ·")} {a.note}</span>
            {archive && <button className="lk" aria-expanded={archOpen} onClick={() => setArchOpen((o) => !o)}>{archOpen ? tt("접기") : tt("목록")}</button>}
          </div>
        ))}
        {cleanup.autoArchived.length === 0 && archive && archive.length > 0 && (
          <div className="auto"><Icon name="archive" /><span>{tt("보관 대기")} <b>{archQueued}{tt("개")}</b>{archUndone ? ttf(" · 보관 해제 {0}개", archUndone) : ''}</span>
            <button className="lk" aria-expanded={archOpen} onClick={() => setArchOpen((o) => !o)}>{archOpen ? tt("접기") : tt("목록")}</button></div>
        )}
        {archOpen && archive && (
          <div className="arch">
            <div className="ah"><span>{tt("보관 대기")} {archQueued}{tt("개")}{archUndone ? ttf(" · 해제 {0}개", archUndone) : ''}</span>
              {archQueued > 0 && <button className="lk" disabled={archBusy.size > 0} onClick={() => void changeArchive(archive.filter((x) => x.state === 'archive_queued'), true)}>{tt("모두 보관 해제")}</button>}</div>
            <table className="rows"><tbody>
              {(archAll ? archive : archive.slice(0, 8)).map((x) => (
                <tr key={x.itemId} className={`${x.state === 'archive_undone' ? 'off' : ''}${archBusy.has(x.itemId) ? ' pending' : ''}`} style={{ cursor: 'default' }}>
                  <td className="t"><AiMark ai={x.sourceAi} style={{ marginRight: 8 }} /><span>{x.title}</span>{x.state === 'archive_undone' && <small>{tt("보관 해제됨")}</small>}<em className="why" title={x.reason}>{x.reason}</em></td>
                  <td className="d">{dotDate(x.date)}</td>
                  <td className="ab">{x.state === 'archive_queued'
                    ? <button className="btn sm" disabled={archBusy.has(x.itemId)} onClick={() => void changeArchive([x], true)}>{tt("보관 해제")}</button>
                    : <button className="btn sm" disabled={archBusy.has(x.itemId)} onClick={() => void changeArchive([x], false)}>{tt("다시 보관")}</button>}</td>
                </tr>
              ))}
            </tbody></table>
            {!archAll && archive.length > 8 && <button className="dmore" style={{ paddingLeft: 0 }} onClick={() => setArchAll(true)}>{archive.length - 8}{tt("개 더 보기")}</button>}
          </div>
        )}
        <ServiceArchivePanel />
        {batch && (
          <div className="batch">
            <div className="bh"><h2>{tt("되돌릴 수 없는 삭제")}</h2><span className="c">{tt("선택")} <b>{batch.selectedCount}</b> {tt("/ 후보")} {batch.candidateCount}</span></div>
            {batch.groups.map((g) => {
              const cls = g.selected === 0 ? '' : g.selected >= g.total ? 'on' : 'part';
              const hidden = g.total - g.items.length;
              const folded = !unfold[g.sourceAi] && g.items.length > ROWS_FOLDED;
              const rows = folded ? g.items.slice(0, ROWS_FOLDED) : g.items;
              return (
                <div key={g.sourceAi}>
                  <div className="grp">
                    <button className={`cb ${cls}`} role="checkbox" aria-checked={cls === 'on' ? true : cls === 'part' ? 'mixed' : false} aria-label={ttf("{0} 전체", aiLabel(g.sourceAi))} disabled={locked} onClick={() => void toggleGroup(g)} />
                    <Svc ai={g.sourceAi} /><span className="cnt">{g.selected} / {g.total}</span>
                    <span className={`all${g.backupVerified ? '' : ' bad'}`}>{g.backupVerified ? tt("원문·노트 저장 확인됨") : tt("저장 확인 안 됨 — 승인 불가")}</span>
                  </div>
                  <table className="rows"><tbody>
                    {rows.map((it) => (
                      <tr key={it.itemId} className={`${it.selected ? '' : 'off'}${pending.has(it.itemId) ? ' pending' : ''}`} onClick={() => !locked && void setItems(g, [it], !it.selected)}>
                        <td className="c"><button className={`cb${it.selected ? ' on' : ''}`} role="checkbox" aria-checked={it.selected} aria-label={it.title} disabled={locked} onClick={(e) => { e.stopPropagation(); void setItems(g, [it], !it.selected); }} /></td>
                        <td className="t"><AiMark ai={g.sourceAi} style={{ marginRight: 8 }} /><span>{it.title}</span>{!it.selected && it.excludedByUser && <small>{tt("직접 뺌")}</small>}{reasons[String(it.itemId)] && <em className="why" title={reasons[String(it.itemId)]}>{reasons[String(it.itemId)]}</em>}</td>
                        <td className="k">{tt(it.kindLabel)}</td>
                        <td className="d">{dotDate(it.date)}</td>
                        <td className={`v${g.backupVerified ? '' : ' no'}`}>{g.backupVerified ? <Icon name="check" /> : <Icon name="warn" />}</td>
                      </tr>
                    ))}
                  </tbody></table>
                  {folded && <button className="dmore" onClick={() => setUnfold((u) => ({ ...u, [g.sourceAi]: true }))}>{g.items.length - ROWS_FOLDED + hidden}{tt("개 더 보기")}</button>}
                  {!folded && hidden > 0 && <button className="dmore" onClick={() => void expand(g)}>{hidden}{tt("개 더 보기")}</button>}
                  {!folded && g.items.length > ROWS_FOLDED && <button className="dmore" onClick={() => setUnfold((u) => ({ ...u, [g.sourceAi]: false }))}>{tt("접기")}</button>}
                </div>
              );
            })}
            {batch.autoExcluded.length > 0 && (
              <div className="exc">
                <div className="hh">{tt("이번 배치에서 빠진 것")} <span>{autoExcludedCount}{tt("개 · 규칙에 따라 자동 제외")}</span></div>
                <ul>{batch.autoExcluded.map((x, k) => <li key={k}><b>{x.sourceAi ? `${aiLabel(x.sourceAi)} ` : ''}{x.count}{tt("개")}</b>{x.reason}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </div>
      {batch && (
        <div className="go">
          {batch.state === 'pending' ? (
            <>
              <p>{tt("승인은 ‘서비스에서 지워도 됨’ 표시만 남겨요.")} <b>{tt("지금은 실행기가 꺼져 있어 ChatGPT·Claude·Gemini 쪽 대화를 실제로 지우지 않아요.")}</b> {tt("실행기가 켜지면 한 건씩 대화 ID를 대조해 지우고 다시 열어 확인해요(")}{batch.estimate.label}{tt("). 원문·볼트 노트·내보낸 사본은 그대로 남아요.")}</p>
              <div className="row">
                <button className="btn pri" disabled={n === 0 || !allBackedUp || pending.size > 0} onClick={openConfirm}><Icon name="trash" />{n > 0 ? ttf("{0}개 삭제 승인 (표시만)", n) : tt("선택한 항목이 없어요")}</button>
                <button className="btn" onClick={() => void postpone()}>{tt("내일로 미루기")}</button>
                <small>{tt("승인 직전 DB 자동 백업")}<br />{excludedItems.length > 0 ? ttf("직접 뺀 {0}개는 남겨요", excludedItems.length) : tt("빠진 항목 없음")}</small>
              </div>
            </>
          ) : batch.state === 'postponed' ? (
            <div className="done"><Icon name="pause" />{tt("오늘은 지우지 않아요 — 내일 아침 요약에 다시 올릴게요.")}</div>
          ) : batch.state === 'cancelled' ? (
            <div className="done"><Icon name="close" />{tt("이 배치는 취소됐어요 — 지운 것은 없어요.")}</div>
          ) : batch.state === 'paused' ? (
            <div className="done"><Icon name="pause" />{tt("지우다가 잠시 멈췄어요 · 확장 프로그램 연결을 확인해 주세요.")}</div>
          ) : (
            <div className="done"><Icon name="check" />{batch.selectedCount}{tt("개를 삭제 승인으로 표시했어요 ·")} {batch.state === 'done' ? tt("모두 지웠어요") : batch.state === 'running' ? tt("백그라운드에서 지우는 중") : tt("실행기가 꺼져 있어 서비스 쪽 대화는 그대로예요")}</div>
          )}
        </div>
      )}

      {view !== 'idle' && batch && (
        <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && view === 'confirm') setView('idle'); }}>
          <div className="dialog cfm" role="alertdialog" aria-labelledby="cfm-title">
            <h2 id="cfm-title"><Icon name="trash" size={17} />{tt("대화")} {n}{tt("개를 ‘삭제 승인’으로 표시할까요?")}</h2>
            <p>{tt("오늘은 표시만 하고 실제로 지우지 않아요(실행기 꺼짐). 나중에 실행기가 켜지면 이 대화들은 ChatGPT·Claude·Gemini 화면에서 되살릴 수 없게 지워져요. 서브브레인에 저장한 원문·볼트 노트·내보낸 사본은 그대로 남아요.")}</p>
            <dl>
              {batch.groups.map((g) => <span key={g.sourceAi} style={{ display: 'contents' }}><dt><Svc ai={g.sourceAi} /></dt><dd>{g.selected}{tt("개 승인 표시")} <small>{tt("후보")} {g.total}{tt("개 ·")} {g.backupVerified ? tt("원문·노트 저장 확인됨") : tt("저장 확인 안 됨")}</small></dd></span>)}
              <dt>{tt("남기는 것")}</dt>
              <dd>{excludedItems.length > 0 ? <>{tt("직접 뺀")} {excludedItems.length}{tt("개")}<small>{excludedItems.slice(0, 4).map((i) => i.title).join(' · ')}{excludedItems.length > 4 ? ttf(" 외 {0}개", excludedItems.length - 4) : ''}</small></> : tt("직접 뺀 항목 없음")}
                {batch.candidateCount - n - excludedItems.length > 0 && <small>{tt("펼치지 않은 항목 중 선택 안 된 것")} {batch.candidateCount - n - excludedItems.length}{tt("개도 남아요")}</small>}
                {autoExcludedCount > 0 && <small>{tt("규칙에 따라 자동 제외")} {autoExcludedCount}{tt("개")}</small>}</dd>
              <dt>{tt("걸리는 시간")}</dt><dd>{batch.estimate.label}</dd>
            </dl>
            <div className="warnl"><Icon name="warn" size={14} /><span>{tt("승인 직전에 DB를 자동으로 백업해요. 진행 중에는 요약 화면에서 멈출 수 있어요.")}</span></div>
            {sellable && <input className="phrase" value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder={ttf("확인하려면 ‘{0}개 삭제’라고 입력하세요", n)} aria-label={tt("확인 문구")} />}
            {dialogErr && <p style={{ color: 'var(--accent)', marginTop: 10 }}>{dialogErr}</p>}
            <div className="row">
              <button className="btn" onClick={() => setView('idle')} disabled={view === 'sending'}>{tt("취소")}</button>
              <button className="btn pri" onClick={() => void approve()} disabled={view === 'sending' || !phraseOk}><Icon name="trash" />{view === 'sending' ? tt("표시하는 중…") : ttf("{0}개 삭제 승인 (표시만)", n)}</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
