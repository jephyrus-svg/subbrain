/**
 * 규칙 엔진 — 설계서 §7.2(최종 상태, 우선순위 순), §7.3(방치 단계), §7.7(이어서 하기 점수).
 * 순수 함수만 둔다(DB·시계 없음). 날짜는 KST "YYYY-MM-DD".
 */
import type { CompletionReason, Kind, Resolution, StaleInfo, StaleStage, StaleThresholds, StatusSource, StatusVisual, TaskStatus } from '@subbrain/shared';
import { DEFAULT_THRESHOLDS, STATUS_TO_VISUAL } from '@subbrain/shared/constants';
import { daysBetween } from '../util/time.ts';
import { L } from '../util/lang.ts';

export interface StatusInput {
  overrides: string[];
  /** 사용자(또는 이전 계산)가 저장해 둔 상태 — overrides에 status가 있을 때만 쓰임 */
  storedStatus: TaskStatus;
  storedStatusSource: StatusSource;
  storedCompletionReason: CompletionReason | null;
  mcpStatus: TaskStatus | null;
  mcpStatusAt: string | null;
  classifiedAt: string | null;
  kind: Kind;
  resolution: Resolution | null;
  lastActivityDate: string | null; // KST 날짜
  /** 1.5.0 주(primary) 대화들의 저장된 대화 결과(최신 대화 먼저). 1.4.0 이전 분류는 null */
  conversationOutcomes?: Array<{ outcome: 'done' | 'moved' | 'interrupted' | 'open'; detectedBy: 'llm' | 'rule' | 'both' } | null>;
}
export interface StatusResult {
  status: TaskStatus;
  statusSource: StatusSource;
  completionReason: CompletionReason | null;
  staleDays: number | null;
}

export function mergeThresholds(base: StaleThresholds, override: Partial<StaleThresholds> | null | undefined): StaleThresholds {
  return { ...base, ...(override ?? {}) };
}

export function validateThresholds(t: StaleThresholds): string | null {
  if (!(t.inProgressMaxDays < t.shortPauseMaxDays && t.shortPauseMaxDays < t.staleMaxDays && t.staleMaxDays < t.longStaleMaxDays)) {
    return 'inProgressMaxDays < shortPauseMaxDays < staleMaxDays < longStaleMaxDays 순서여야 해요';
  }
  return null;
}

/** 멈춘 일수 = 오늘 − 마지막 활동일 */
export function daysSince(lastActivityDate: string | null, today: string): number | null {
  if (!lastActivityDate) return null;
  return Math.max(0, daysBetween(lastActivityDate, today));
}

/** §7.2 최종 상태 (우선순위 순) */
export function computeStatus(input: StatusInput, today: string, t: StaleThresholds = DEFAULT_THRESHOLDS): StatusResult {
  const days = daysSince(input.lastActivityDate, today);
  const stale = (status: TaskStatus) => (status === '멈춤' ? days ?? 0 : null);
  // 1. 사용자가 직접 정한 상태 (보관 포함 — §7.2-7)
  if (input.overrides.includes('status')) {
    const s = input.storedStatus;
    return { status: s, statusSource: 'user', completionReason: s === '완료' ? input.storedCompletionReason ?? 'resolved' : null, staleDays: stale(s) };
  }
  // 2. MCP로 보고된 상태가 LLM 판정보다 최신이면
  if (input.mcpStatus && input.mcpStatusAt && (!input.classifiedAt || input.mcpStatusAt > input.classifiedAt)) {
    const s = input.mcpStatus;
    return { status: s, statusSource: 'mcp', completionReason: s === '완료' ? 'resolved' : null, staleDays: stale(s) };
  }
  // 3. 간단한 질문(1.4.0): 상태가 아니라 종류. 답을 받았으면(미해결이 아니면) 완료/answered, 못 받았으면 아래 방치 규칙(진행 중·멈춤).
  //    '간단한 질문' 상태 값은 계약 호환을 위해 enum에 남지만 더 이상 계산 결과로 나오지 않는다(사용자가 직접 고정한 옛 값만).
  if (input.kind === 'quick_question' && input.resolution !== 'unresolved') return { status: '완료', statusSource: input.classifiedAt ? 'llm' : 'rule', completionReason: 'answered', staleDays: null };
  // 4. 해결 → 완료
  if (input.resolution === 'resolved') return { status: '완료', statusSource: 'llm', completionReason: 'resolved', staleDays: null };
  // 5. 포기 → 완료(중단)
  if (input.resolution === 'abandoned') return { status: '완료', statusSource: 'llm', completionReason: 'abandoned', staleDays: null };
  // 5-1. 1.5.0 대화 결과: 주 대화가 **모두** done·moved면 과제도 완료(라벨 검토 기준 — Claude 29개 과제 상태 오답 8개가 전부 이 경우).
  //      reason = 최신 주 대화가 moved면 'moved'(이어간 곳 표시는 handoff로 유지), 아니면 'done'. 하나라도 interrupted·open·분류 전(null)이면 아래 방치 규칙.
  //      이어받은 로컬 세션을 합치면(합치기 제안 수락) 그 세션 대화(open)가 주 대화로 들어와 과제는 다시 진행 중/멈춤 — 일은 세션 쪽에서 계속.
  const oc = input.conversationOutcomes;
  if (oc && oc.length && oc.every((o) => o && (o.outcome === 'done' || o.outcome === 'moved'))) {
    return { status: '완료', statusSource: oc.every((o) => o!.detectedBy === 'rule') ? 'rule' : 'llm', completionReason: oc[0]!.outcome === 'moved' ? 'moved' : 'done', staleDays: null };
  }
  // 6. 미해결(또는 아직 분류 전): 기준 일수 이하면 진행 중, 넘으면 멈춤
  if (days === null || days <= t.inProgressMaxDays) return { status: '진행 중', statusSource: 'rule', completionReason: null, staleDays: null };
  return { status: '멈춤', statusSource: 'rule', completionReason: null, staleDays: days };
}

/** §7.3 방치 단계 */
export function staleStage(staleDays: number, t: StaleThresholds = DEFAULT_THRESHOLDS): StaleStage {
  if (staleDays <= t.shortPauseMaxDays) return 'short_pause';
  if (staleDays <= t.staleMaxDays) return 'stale';
  if (staleDays <= t.longStaleMaxDays) return 'long_stale';
  return 'dormant';
}

/** §10.2.3 고리 토큰: 4–7일 멈춤 = stall2(노랑), 8일+ = stall(주황) */
export function statusVisual(status: TaskStatus, staleDays: number | null, t: StaleThresholds = DEFAULT_THRESHOLDS): StatusVisual {
  if (status !== '멈춤') return STATUS_TO_VISUAL[status];
  return (staleDays ?? 0) <= t.shortPauseMaxDays ? 'stall2' : 'stall';
}

export function staleInfo(status: TaskStatus, lastActivityDate: string | null, today: string, t: StaleThresholds = DEFAULT_THRESHOLDS): StaleInfo {
  if (status !== '멈춤') return { staleDays: null, staleStage: null, statusVisual: statusVisual(status, null, t), badge: null };
  const d = daysSince(lastActivityDate, today) ?? 0;
  return { staleDays: d, staleStage: staleStage(d, t), statusVisual: statusVisual(status, d, t), badge: L(`${d}일`, `${d}d`) };
}

/** /meta의 staleStages 범위 (기준값에서 계산) */
export function staleStageRanges(t: StaleThresholds) {
  return [
    { key: 'short_pause' as const, minDays: t.inProgressMaxDays + 1, maxDays: t.shortPauseMaxDays as number | null },
    { key: 'stale' as const, minDays: t.shortPauseMaxDays + 1, maxDays: t.staleMaxDays as number | null },
    { key: 'long_stale' as const, minDays: t.staleMaxDays + 1, maxDays: t.longStaleMaxDays as number | null },
    { key: 'dormant' as const, minDays: t.longStaleMaxDays + 1, maxDays: null },
  ];
}

/** 계약서 §15-3: 프로젝트 표시 상태 = 과제들에서 파생 */
export function projectActivity(taskStatuses: TaskStatus[], lastActivityDate: string | null, today: string, t: StaleThresholds = DEFAULT_THRESHOLDS): { status: TaskStatus; staleDays: number | null; statusVisual: StatusVisual } {
  if (taskStatuses.includes('진행 중')) return { status: '진행 중', staleDays: null, statusVisual: 'run' };
  if (taskStatuses.includes('멈춤')) {
    const d = daysSince(lastActivityDate, today) ?? 0;
    return { status: '멈춤', staleDays: d, statusVisual: statusVisual('멈춤', d, t) };
  }
  if (taskStatuses.includes('완료')) return { status: '완료', staleDays: null, statusVisual: 'done' };
  if (taskStatuses.length && taskStatuses.every((s) => s === '간단한 질문')) return { status: '간단한 질문', staleDays: null, statusVisual: 'quick' };
  return { status: '보관', staleDays: null, statusVisual: 'archived' };
}

/**
 * §7.7 이어서 하기 점수 = 최근성 × 프로젝트 우선순위 × 방치 단계 × 다음 단계 명확도.
 * 가중치는 설계서에 없어 코어가 정함(0..1). 진행 중·멈춤 과제만 점수가 있다.
 */
export function resumeScore(p: { status: TaskStatus; kind: Kind; staleDays: number | null; projectPriority: number | null; hasNextStep: boolean; openQuestionCount: number }, t: StaleThresholds = DEFAULT_THRESHOLDS): number {
  if (p.kind !== 'task' || (p.status !== '진행 중' && p.status !== '멈춤')) return 0;
  const d = p.staleDays ?? 0;
  const recency = Math.max(0.3, 1 - d / 120);
  const stageFactor = p.status === '진행 중' ? 0.8 : ({ short_pause: 0.92, stale: 1, long_stale: 0.7, dormant: 0.4 } as const)[staleStage(d, t)];
  const priority = p.projectPriority ?? 0.8;
  const clarity = p.hasNextStep ? 1 : 0.55;
  const openQ = p.openQuestionCount > 3 ? 0.95 : 1;
  return Math.round(recency * stageFactor * Math.min(priority, 1.2) * clarity * openQ * 100) / 100;
}
