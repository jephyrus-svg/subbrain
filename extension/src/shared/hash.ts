// 계약 §14.3 contentHash: sha256(전체 메시지 role + "\0" + contentMd 를 "\n\0"로 이음) → 소문자 hex 64자(접두어 없음)
// 1.9.0 코어(packages/core/src/ingest/ingest.ts ingestContentHash)와 같은 값. 계약 예시의 "sha256:…" 접두어는 코어가 받지 않는다(400).
// voice 플래그는 해시에 들어가지 않는다(코어 구현 확인).
import type { IngestMessage } from './contract';

export function hashInput(messages: Pick<IngestMessage, 'role' | 'contentMd'>[]): string {
  return messages.map((m) => `${m.role}\0${m.contentMd}`).join('\n\0');
}

export async function contentHash(messages: Pick<IngestMessage, 'role' | 'contentMd'>[]): Promise<string> {
  const data = new TextEncoder().encode(hashInput(messages));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const idempotencyKey = (sourceAi: string, sourceId: string, hash: string) => `${sourceAi}:${sourceId}:${hash}`;
