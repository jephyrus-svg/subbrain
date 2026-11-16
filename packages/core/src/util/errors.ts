import type { ErrorCode } from '@subbrain/shared';
import type { ZodError } from 'zod';
import { L } from './lang.ts';

export const STATUS_OF: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400, UNSUPPORTED_FILE: 400, FORBIDDEN_ORIGIN: 403, NOT_FOUND: 404, CONFLICT: 409, DUPLICATE_IMPORT: 409,
  PAYLOAD_TOO_LARGE: 413, NOT_ALLOWED_IN_BUILD: 422, COST_CAP_REACHED: 429, INTERNAL: 500, NOT_IMPLEMENTED: 501, DB_BUSY: 503, LLM_UNAVAILABLE: 503, UNAUTHORIZED: 401, RATE_LIMITED: 429,
};

export class ApiError extends Error {
  constructor(public code: ErrorCode, message: string, public details?: Record<string, unknown>) { super(message); }
  get status(): number { return STATUS_OF[this.code]; }
}
const WHAT_EN: Record<string, string> = { 과제: 'Task', 프로젝트: 'Project', 대화: 'Chat', 객체: 'Object', 제안: 'Suggestion', 주제: 'Topic', 가져오기: 'Import', 작업: 'Job', 메시지: 'Message', 날짜: 'Date', 요약: 'Summary', task: 'Task', project: 'Project', chat: 'Chat' };
export const notFound = (what: string, id: string, key = 'id') => new ApiError('NOT_FOUND', L(`${what}을(를) 찾을 수 없어요: ${id}`, `${WHAT_EN[what] ?? what} not found: ${id}`), { [key]: id });
export const conflict = (message: string, details?: Record<string, unknown>) => new ApiError('CONFLICT', message, details);
export const invalid = (message: string, issues: Array<{ path: string; message: string }> = []) => new ApiError('VALIDATION_ERROR', message, { issues });

/** zod 오류 → 한국어 VALIDATION_ERROR */
export function fromZod(err: ZodError): ApiError {
  const issues = err.issues.map((i) => {
    const path = i.path.filter((p) => typeof p === 'string').join('.') || L('(본문)', '(body)');
    let message = i.message;
    if (i.code === 'invalid_enum_value') message = L(`'${String(i.received)}'은(는) 허용되지 않아요. 허용: ${i.options.join(', ')}`, `'${String(i.received)}' is not allowed. Allowed: ${i.options.join(', ')}`);
    else if (i.code === 'unrecognized_keys') message = L(`알 수 없는 필드: ${i.keys.join(', ')}`, `Unknown field(s): ${i.keys.join(', ')}`);
    else if (i.code === 'invalid_type') message = i.received === 'undefined' ? L('필수 값이에요', 'Required') : L(`타입이 달라요 (기대: ${i.expected}, 받음: ${i.received})`, `Wrong type (expected ${i.expected}, got ${i.received})`);
    return { path, message };
  });
  return new ApiError('VALIDATION_ERROR', L('요청 값이 올바르지 않아요.', 'Invalid request.'), { issues });
}
