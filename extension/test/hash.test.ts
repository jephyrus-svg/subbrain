import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { contentHash, hashInput, idempotencyKey } from '../src/shared/hash';

describe('contentHash (계약 §14.3)', () => {
  const msgs = [{ role: 'user' as const, contentMd: '안녕' }, { role: 'assistant' as const, contentMd: '네, 안녕하세요' }];
  it('joins role\\0content with \\n\\0', () => expect(hashInput(msgs)).toBe('user\0안녕\n\0assistant\0네, 안녕하세요'));
  it('is sha256 hex with prefix (matches node crypto)', async () => {
    expect(await contentHash(msgs)).toBe(createHash('sha256').update('user\0안녕\n\0assistant\0네, 안녕하세요', 'utf8').digest('hex'));
  });
  it('idempotency key = sourceAi:sourceId:contentHash', () => expect(idempotencyKey('chatgpt', 'abc', '00ff')).toBe('chatgpt:abc:00ff'));
});
