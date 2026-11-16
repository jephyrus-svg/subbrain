/** 서비스 쪽 보관 — 삭제 없음 · 고른 항목만 · 기본 dry-run · 네트워크/탭 조작 없음 (실제 서비스 계정 안 건드림) */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeCore } from './helpers.ts';

type T = Awaited<ReturnType<typeof makeCore>>;
let t: T | null = null;
const prev = process.env.SUBBRAIN_CLEANUP;
let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { process.env.SUBBRAIN_CLEANUP = 'preview'; fetchSpy = vi.spyOn(globalThis, 'fetch'); });
afterEach(() => { expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore(); t?.close(); t = null; if (prev === undefined) delete process.env.SUBBRAIN_CLEANUP; else process.env.SUBBRAIN_CLEANUP = prev; });

async function approved() {
  t = await makeCore({ seeded: true });
  const d = (await t.json('POST', '/cleanup/run', {})).body.detail;
  const n = d.batch.selectedCount;
  expect((await t.json('POST', `/deletion-batches/${d.batch.id}/approve`, { expectedSelectedCount: n, excludedItemIds: [] })).status).toBe(200);
  const approvedIds = t.core.db.all<{ id: number }>("SELECT id FROM deletion_items WHERE state='approved'").map((r) => r.id);
  const queued = t.core.db.all<{ id: number }>("SELECT id FROM deletion_items WHERE state='archive_queued'").map((r) => r.id);
  return { approvedIds, queued };
}
const snapshot = () => t!.core.db.all('SELECT id, service_state, deleted_at FROM conversations ORDER BY id');
const deletedCount = () => t!.core.db.value("SELECT COUNT(*) FROM conversations WHERE deleted_at IS NOT NULL OR service_state='deleted'");

describe('서비스 쪽 보관', () => {
  it('기본은 dry-run: 아무것도 기록·변경하지 않음', async () => {
    const { approvedIds, queued } = await approved();
    const before = snapshot();
    const r = await t!.json('POST', '/cleanup/service-archive/plan', { itemIds: [...approvedIds, ...queued] });
    expect(r.status).toBe(200);
    expect(r.body.dryRun).toBe(true);
    expect(r.body.recorded).toBe(0);
    expect(snapshot()).toEqual(before);
    expect((await t!.json('GET', '/cleanup/service-archive')).body.actions).toHaveLength(0);
    // ChatGPT = 직접 열어 보관 링크, 나머지 = SubBrain 안에서만
    for (const it of r.body.items) {
      if (it.sourceAi === 'chatgpt') { expect(it.action).toBe('open_and_archive_yourself'); expect(it.url).toMatch(/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//); }
      else expect(it.action).toBe('mark_local_only');
    }
    expect(r.body.items.some((i: { sourceAi: string }) => i.sourceAi === 'chatgpt')).toBe(true);
  });

  it('승인 안 된 항목은 건너뜀, 없는 항목은 404, 빈 목록은 400', async () => {
    await approved();
    const other = t!.core.db.value<number>("SELECT id FROM deletion_items WHERE state NOT IN ('approved','archive_queued') LIMIT 1");
    if (other) { const r = await t!.json('POST', '/cleanup/service-archive/plan', { itemIds: [other], dryRun: false }); expect(r.body.items[0].action).toBe('skip'); expect(r.body.recorded).toBe(0); }
    expect((await t!.json('POST', '/cleanup/service-archive/plan', { itemIds: [999999] })).status).toBe(404);
    expect((await t!.json('POST', '/cleanup/service-archive/plan', { itemIds: [] })).status).toBe(400);
  });

  it('기록 → 사용자가 "보관했어요" → archived, 되돌리기 → active + 보관 해제 안내. 삭제는 0', async () => {
    const { approvedIds, queued } = await approved();
    expect((await t!.json('GET', '/cleanup/service-archive')).body.eligible.length).toBe(approvedIds.length + queued.length);
    const rec = await t!.json('POST', '/cleanup/service-archive/plan', { itemIds: [...approvedIds, ...queued], dryRun: false });
    expect(rec.body.recorded).toBeGreaterThan(0);
    // 같은 항목 두 번은 안 됨
    const again = await t!.json('POST', '/cleanup/service-archive/plan', { itemIds: [...approvedIds, ...queued], dryRun: false });
    expect(again.body.recorded).toBe(0);
    expect((await t!.json('GET', '/cleanup/service-archive')).body.eligible).toHaveLength(0);
    const actions = (await t!.json('GET', '/cleanup/service-archive')).body.actions as { id: number; sourceAi: string; state: string; conversationId: string }[];
    const gpt = actions.filter((a) => a.sourceAi === 'chatgpt');
    expect(gpt.every((a) => a.state === 'link_issued')).toBe(true);
    expect(actions.filter((a) => a.sourceAi !== 'chatgpt').every((a) => a.state === 'local_only')).toBe(true);
    // 링크만 발급한 단계에선 서비스 상태 그대로
    expect(t!.core.db.value("SELECT COUNT(*) FROM conversations WHERE service_state!='active'")).toBe(0);
    const done = await t!.json('POST', '/cleanup/service-archive/done', { actionIds: gpt.map((a) => a.id) });
    expect(done.body.changed).toBe(gpt.length);
    expect(t!.core.db.value("SELECT COUNT(*) FROM conversations WHERE service_state='archived'")).toBe(gpt.length);
    const undo = await t!.json('POST', '/cleanup/service-archive/undo', { actionIds: [gpt[0]!.id] });
    expect(undo.body.howTo[0].howTo).toMatch(/보관 해제/);
    expect(t!.core.db.value('SELECT service_state FROM conversations WHERE id=?', gpt[0]!.conversationId)).toBe('active');
    expect(deletedCount()).toBe(0);
    const log = readFileSync(`${t!.core.home}/cleanup/audit.jsonl`, 'utf8');
    expect(log).toMatch(/service_archive_confirmed/);
  });

  it('서비스 주소가 아닌 링크는 내보내지 않음', async () => {
    const { safeUrl } = await import('../src/cleanup/service-archive.ts');
    expect(safeUrl('chatgpt', 'https://chatgpt.com/c/abc')).toBe('https://chatgpt.com/c/abc');
    expect(safeUrl('chatgpt', 'http://chatgpt.com/c/abc')).toBeNull();
    expect(safeUrl('chatgpt', 'https://evil.example/c/abc')).toBeNull();
    expect(safeUrl('claude', 'javascript:alert(1)')).toBeNull();
  });

  it('모듈에 삭제·탭 조작·네트워크 코드가 없음', () => {
    const src = readFileSync(new URL('../src/cleanup/service-archive.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/DELETE\s+FROM|deleted_at|'deleted'|fetch\(|chrome\.|tabs\.|windows\.|setInterval|setTimeout/);
  });
});
