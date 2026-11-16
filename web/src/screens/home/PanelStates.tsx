import { tt, ttf } from '../../i18n';
import { errorText } from '../../api/client';
export function PanelSkeleton({ eyebrow }: { eyebrow: string }) {
  return (
    <div aria-busy="true">
      <span className="eyebrow">{eyebrow}</span>
      <div className="skel" style={{ width: 220, height: 28, marginTop: 8 }} />
      <div className="skel" style={{ width: 380 }} /><div className="skel" style={{ width: 460 }} /><div className="skel" style={{ width: 300 }} />
      <div className="skel" style={{ width: 480, height: 90, marginTop: 20 }} />
    </div>
  );
}
export function PanelError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return <div className="state err"><b>{tt("불러오지 못했어요")}</b><span>{errorText(error)}</span><button className="btn" onClick={onRetry}>{tt("다시 시도")}</button></div>;
}
