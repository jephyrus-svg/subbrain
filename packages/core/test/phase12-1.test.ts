/**
 * Phase 12.1 (계약 1.10.1) — SUBBRAIN_LLM_API_KEY 읽기 · 볼트 가짜 충돌 회귀
 *  - 원인: DB 복사본(시험용)이 설정에 남은 원본 볼트 경로로 파일을 써 넣음 → 원본 엔진이 기록에 없는 파일을 "사용자 수정"으로 보고 108개 충돌
 */
import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeCore } from './helpers.ts';
import { Core } from '../src/core.ts';

type T = Awaited<ReturnType<typeof makeCore>>;
let t: T | null = null;
const extra: Core[] = [];
const PREV = process.env.SUBBRAIN_LLM_API_KEY;
afterEach(() => { for (const c of extra.splice(0)) c.close(); t?.close(); t = null; if (PREV === undefined) delete process.env.SUBBRAIN_LLM_API_KEY; else process.env.SUBBRAIN_LLM_API_KEY = PREV; });

describe('LLM 키: SUBBRAIN_LLM_API_KEY', () => {
  it('제공자를 골랐고 다른 키가 없으면 공통 환경변수를 씀(순서: secrets.json → 제공자 환경변수 → 공통), 출처만 알려 줌', async () => {
    t = await makeCore();
    const prevG = process.env.GOOGLE_GENERATIVE_AI_API_KEY; delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; delete process.env.SUBBRAIN_LLM_API_KEY;
    try {
      await t.json('PATCH', '/settings', { llm: { provider: 'google' } });
      expect(t.core.llmConfigured()).toBe(false);
      expect(t.core.llmStatusLine()).toContain('API 키 없음');
      process.env.SUBBRAIN_LLM_API_KEY = 'test-generic-key-value';
      expect(t.core.settings.getApiKey('google')).toBe('test-generic-key-value');
      expect(t.core.llmConfigured()).toBe(true);
      expect(t.core.llmStatusLine()).toContain('키 출처 SUBBRAIN_LLM_API_KEY');
      expect(t.core.llmStatusLine()).not.toContain('test-generic-key-value');
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'provider-key';
      expect(t.core.settings.getApiKey('google')).toBe('provider-key');
      t.core.settings.setApiKey('google', 'file-key');
      expect(t.core.settings.getApiKey('google')).toBe('file-key');
      expect(t.core.settings.apiKeySource('google')).toBe('secrets.json');
    } finally { if (prevG === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevG; }
  });
});

describe('볼트 가짜 충돌', () => {
  it('디스크 파일이 지금 쓸 내용과 같으면(다른 프로세스가 먼저 씀) 충돌 아님', async () => {
    t = await makeCore({ seeded: true });
    const r = await t.core.vault.regenerateAll();
    expect(r.conflicts).toBe(0);
    // 기록만 지우고(다른 프로세스가 같은 내용을 쓴 상황) 다시 생성
    t.core.db.run('DELETE FROM vault_files');
    const r2 = await t.core.vault.regenerateAll();
    expect(r2.conflicts).toBe(0);
    expect(t.core.vault.conflictCount()).toBe(0);
    // 진짜로 고친 파일은 여전히 충돌
    const p = t.core.db.value<string>("SELECT path FROM vault_files WHERE entity_type='task' LIMIT 1")!;
    writeFileSync(join(t.home, 'vault', p), '사용자가 고침\n');
    expect((await t.core.vault.regenerateAll()).conflicts).toBe(1);
  });

  it('DB 복사본은 원본 볼트에 쓰지 않음(주인 표시) → 원본에 충돌이 생기지 않음', async () => {
    t = await makeCore({ seeded: true });
    await t.core.vault.regenerateAll();
    const vault = join(t.home, 'vault');
    expect(existsSync(join(vault, '.subbrain', 'owner.json'))).toBe(true);
    // 복사본: 같은 설정(볼트 경로 = 원본 볼트)
    t.core.db.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const copyHome = join(t.home, 'copy'); mkdirSync(copyHome);
    copyFileSync(join(t.home, 'subbrain.db'), join(copyHome, 'subbrain.db'));
    const copy = new Core({ home: copyHome, port: 4599 }); extra.push(copy);
    expect(copy.settings.get().vault.path).toBe(vault);
    expect(copy.vault.ownsVault()).toBe(false);
    expect(copy.rawDir()).toBe(join(copyHome, 'raw'));
    copy.db.run('DELETE FROM vault_files'); // 복사본에서 새로 생긴 과제처럼
    copy.db.run("UPDATE tasks SET title = title || ' (복사본)'");
    const before = readdirSync(join(vault, 'tasks')).length;
    const r = await copy.vault.regenerateAll();
    expect(r.written).toBe(0);
    expect(readdirSync(join(vault, 'tasks')).length).toBe(before);
    expect((await t.core.vault.regenerateAll()).conflicts).toBe(0);
    expect(t.core.vault.conflictCount()).toBe(0);
  });
});
