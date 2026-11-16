import { tt, ttf } from '../i18n';
import { Link } from 'react-router-dom';
export default function Timeline() {
  return (
    <div style={{ position: 'absolute', top: 52, left: 0, right: 0, bottom: 0 }}>
      <div className="state"><b>{tt("타임라인은 다음 작업에서 열려요")}</b><span>{tt("지금은 과제 상세의 ‘대화 흐름’과 오늘의 요약에서 시간순으로 볼 수 있어요.")}</span><Link className="btn" to="/digest">{tt("오늘의 요약 보기")}</Link></div>
    </div>
  );
}
