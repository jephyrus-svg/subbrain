import { createHash, randomBytes } from 'node:crypto';

const ALPH = '0123456789abcdefghjkmnpqrstvwxyz';
export function randomId(len = 4): string {
  const b = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPH[b[i]! % ALPH.length];
  return s;
}
export function sha256(data: string | Uint8Array): string { return createHash('sha256').update(data).digest('hex'); }
export function requestId(): string { return 'req_' + randomId(8).toUpperCase(); }
/** 원본 ID → 대화 id 뒤 8자리 (영숫자만, 소문자) */
export function shortSourceId(sourceId: string, len = 8): string {
  const clean = sourceId.toLowerCase().replace(/[^0-9a-z]/g, '');
  return (clean || sha256(sourceId)).slice(0, len);
}
/** 볼트 파일 이름용 slug: 공백→-, 금지 문자 제거, 영문 소문자 (설계서 §6.1 예: 이사업체-견적-비교) */
export function slugify(title: string, max = 60): string {
  const s = title.normalize('NFC').toLowerCase()
    .replace(/[\\/:*?"<>|#^[\]{}()!'`~@$%&=+;,.“”‘’…·]/g, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return (s || 'untitled').slice(0, max).replace(/-$/, '');
}
export function encodeCursor(offset: number): string { return Buffer.from(JSON.stringify({ o: offset })).toString('base64url'); }
export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown };
    return typeof v.o === 'number' && v.o >= 0 ? Math.floor(v.o) : 0;
  } catch { return 0; }
}
