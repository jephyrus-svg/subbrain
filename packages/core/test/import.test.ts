import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as S from '@subbrain/shared/schemas';
import { makeCore } from './helpers.ts';
import { chatgptConversations, claudeConversations } from './fixtures/exports.ts';

let t: Awaited<ReturnType<typeof makeCore>>;
beforeAll(async () => { t = await makeCore(); });
afterAll(() => t.close());

async function upload(data: unknown, name: string) {
  const fd = new FormData();
  fd.append('file', new File([JSON.stringify(data)], name, { type: 'application/json' }));
  const r = await t.req('/imports', { method: 'POST', body: fd });
  return { status: r.status, body: (await r.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function waitState(id: string, states: string[]) {
  for (let i = 0; i < 200; i++) {
    const r = await t.json('GET', `/imports/${id}`);
    if (states.includes(r.body.state)) return r.body;
    await new Promise((res) => setTimeout(res, 25));
  }
  throw new Error('가져오기가 끝나지 않음');
}

describe('가져오기 흐름: 업로드 → 미리보기 → 시작 → 완료', () => {
  let importId = '';
  it('업로드하면 202, 미리보기가 준비된다', async () => {
    const r = await upload(chatgptConversations(), 'conversations.json');
    expect(r.status).toBe(202);
    importId = r.body.id;
    const job = await waitState(importId, ['preview_ready', 'failed']);
    expect(S.ImportJobSchema.safeParse(job).success).toBe(true);
    expect(job.preview).toMatchObject({ sourceAi: 'chatgpt', conversationsTotal: 3, conversationsNew: 3 });
  });
  it('시작하면 분류(키 없음 → 규칙 분류기)까지 끝나 과제가 생긴다', async () => {
    const s = await t.json('POST', `/imports/${importId}/start`, { classify: true });
    expect([200, 202]).toContain(s.status);
    const job = await waitState(importId, ['done', 'failed']);
    expect(job.state).toBe('done');
    expect(job.result.conversationsNew).toBe(3);
    const tasks = (await t.json('GET', `/tasks?status=${encodeURIComponent('진행 중,멈춤,완료,간단한 질문')}`)).body.items;
    expect(tasks.length).toBe(3);
    expect(tasks.some((x: { kind: string; status: string; completionReason?: string }) => x.kind === 'quick_question' && x.status === '완료' && x.completionReason === 'answered')).toBe(true); // 1.4.0
    const st = (await t.json('GET', '/classification/status')).body;
    expect(st.model).toBe('rule-mock');
  });
  it('같은 파일을 다시 올리면 409 DUPLICATE_IMPORT', async () => {
    const r = await upload(chatgptConversations(), 'conversations.json');
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DUPLICATE_IMPORT');
  });
  it('메시지가 늘어난 내보내기는 “바뀜”으로 잡고 같은 과제에 붙인다', async () => {
    const r = await upload(chatgptConversations({ extraTurn: true }), 'conversations-2.json');
    expect(r.status).toBe(202);
    const job = await waitState(r.body.id, ['preview_ready', 'failed']);
    expect(job.preview).toMatchObject({ conversationsNew: 0, conversationsUpdated: 1, conversationsUnchanged: 2 });
    await t.json('POST', `/imports/${r.body.id}/start`, { classify: true });
    await waitState(r.body.id, ['done', 'failed']);
    const tasks = (await t.json('GET', `/tasks?status=${encodeURIComponent('진행 중,멈춤,완료,간단한 질문')}`)).body.items;
    expect(tasks.length).toBe(3);
  });
  it('Claude 내보내기도 가져온다', async () => {
    const r = await upload(claudeConversations(), 'claude.json');
    const job = await waitState(r.body.id, ['preview_ready', 'failed']);
    expect(job.preview.sourceAi).toBe('claude');
  });
  it('모르는 파일은 400 UNSUPPORTED_FILE', async () => {
    const fd = new FormData();
    fd.append('file', new File(['hello'], 'x.txt'));
    const r = await t.req('/imports', { method: 'POST', body: fd });
    expect(r.status).toBe(400);
  });
});

describe('볼트 (한 방향 쓰기 + 충돌 백업)', () => {
  it('과제 노트를 쓰고, 사용자가 고친 파일은 백업 후 덮어쓴다', async () => {
    await t.core.vault.regenerateAll();
    const row = t.core.db.get<{ path: string; entity_id: string }>("SELECT path, entity_id FROM vault_files WHERE entity_type='task' LIMIT 1")!;
    const abs = join(t.core.settings.get().vault.path, row.path);
    expect(existsSync(abs)).toBe(true);
    writeFileSync(abs, readFileSync(abs, 'utf8') + '\n사용자 메모\n');
    t.core.vault.writeEntity('task', row.entity_id);
    expect(readFileSync(abs, 'utf8')).not.toContain('사용자 메모');
    const c = (await t.json('GET', '/vault/conflicts')).body;
    expect(c.items).toHaveLength(1);
    expect(existsSync(join(t.core.settings.get().vault.path, c.items[0].backupPath))).toBe(true);
  });
});
