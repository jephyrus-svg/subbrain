import { dataMode } from '../api/client';
// 모의 데이터는 2026-09-30 오전 8:30(KST) 기준으로 만들어졌다. 모의 모드에서는 시계를 그 시각에 고정해
// "수집 1분 전" 같은 상대 시간이 디자인과 같게 나오도록 한다. 라이브 모드는 실제 시각.
const MOCK_NOW = '2026-09-30T08:30:00+09:00';
export const now = (): Date => (dataMode() === 'mock' ? new Date(MOCK_NOW) : new Date());
