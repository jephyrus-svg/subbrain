import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS } from '@subbrain/shared/constants';
import { computeStatus, projectActivity, staleInfo, staleStage, validateThresholds, type StatusInput } from '../src/rules/rules.ts';

const base: StatusInput = { overrides: [], storedStatus: '진행 중', storedStatusSource: 'rule', storedCompletionReason: null, mcpStatus: null, mcpStatusAt: null,
  classifiedAt: '2026-09-20T10:00:00+09:00', kind: 'task', resolution: 'unresolved', lastActivityDate: '2026-09-28' };
const T = '2026-09-30';

describe('상태 우선순위 (§7.2)', () => {
  it('사용자 지정 > MCP > 간단한 질문 > 해결 > 날짜', () => {
    expect(computeStatus({ ...base, overrides: ['status'], storedStatus: '보관' }, T).status).toBe('보관');
    expect(computeStatus({ ...base, mcpStatus: '완료', mcpStatusAt: '2026-09-21T10:00:00+09:00' }, T)).toMatchObject({ status: '완료', statusSource: 'mcp' });
    expect(computeStatus({ ...base, mcpStatus: '완료', mcpStatusAt: '2026-09-19T10:00:00+09:00' }, T).status).toBe('진행 중'); // 분류가 더 최신
    // 1.4.0 간단한 질문은 종류: 답 받음 → 완료/answered(날짜 무관), 답 못 받음(unresolved) → 방치 규칙
    expect(computeStatus({ ...base, kind: 'quick_question', resolution: 'resolved', lastActivityDate: '2026-01-01' }, T)).toMatchObject({ status: '완료', completionReason: 'answered' });
    expect(computeStatus({ ...base, kind: 'quick_question', resolution: null, lastActivityDate: '2026-01-01' }, T)).toMatchObject({ status: '완료', completionReason: 'answered' });
    expect(computeStatus({ ...base, kind: 'quick_question', resolution: 'unresolved', lastActivityDate: '2026-01-01' }, T).status).toBe('멈춤');
    expect(computeStatus({ ...base, resolution: 'resolved' }, T)).toMatchObject({ status: '완료', completionReason: 'resolved' });
    expect(computeStatus({ ...base, resolution: 'abandoned' }, T)).toMatchObject({ status: '완료', completionReason: 'abandoned' });
  });
  it('미해결: 3일 이하 진행 중, 넘으면 멈춤(일수)', () => {
    expect(computeStatus({ ...base, lastActivityDate: '2026-09-27' }, T).status).toBe('진행 중');
    expect(computeStatus({ ...base, lastActivityDate: '2026-09-26' }, T)).toMatchObject({ status: '멈춤', staleDays: 4 });
  });
});

describe('방치 단계 (§7.3)', () => {
  it('경계값', () => {
    expect(staleStage(4)).toBe('short_pause');
    expect(staleStage(7)).toBe('short_pause');
    expect(staleStage(8)).toBe('stale');
    expect(staleStage(30)).toBe('stale');
    expect(staleStage(31)).toBe('long_stale');
    expect(staleStage(91)).toBe('dormant');
  });
  it('표시: 4–7일 stall2, 8일+ stall, 배지 N일', () => {
    expect(staleInfo('멈춤', '2026-09-24', T)).toMatchObject({ staleDays: 6, statusVisual: 'stall2', badge: '6일' });
    expect(staleInfo('멈춤', '2026-09-18', T)).toMatchObject({ staleDays: 12, statusVisual: 'stall', badge: '12일' });
    expect(staleInfo('진행 중', '2026-09-29', T)).toMatchObject({ staleDays: null, statusVisual: 'run', badge: null });
  });
  it('기준 일수 순서 검사', () => {
    expect(validateThresholds(DEFAULT_THRESHOLDS)).toBeNull();
    expect(validateThresholds({ ...DEFAULT_THRESHOLDS, inProgressMaxDays: 9 })).not.toBeNull();
  });
  it('프로젝트 활동: 진행 중 하나라도 → 진행 중, 없고 멈춤 → 멈춤, 모두 완료 → 완료', () => {
    expect(projectActivity(['멈춤', '진행 중'], '2026-09-29', T).status).toBe('진행 중');
    expect(projectActivity(['멈춤', '완료'], '2026-09-21', T)).toMatchObject({ status: '멈춤', staleDays: 9 });
    expect(projectActivity(['완료'], '2026-09-21', T).status).toBe('완료');
  });
});
