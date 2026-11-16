/**
 * 서비스 쪽 보관(2026-10-21) — 승인한 대화를 ChatGPT·Claude·Gemini·Grok "에서" 정리하는 단계.
 *
 * 절대 규칙
 *  - 삭제는 없다. 이 모듈에는 삭제 경로가 아예 없다(conversations.deleted_at 손대지 않음).
 *  - 사용자가 정리 화면에서 고른 itemId만, 사용자의 클릭(HTTP 요청)으로만. 배치·타이머·자동 실행 없음.
 *  - 엔진·확장은 브라우저 탭/창을 열거나 옮기지 않는다. 서비스 API(공식/비공식)도 부르지 않는다(네트워크 호출 0).
 *    → 모든 서비스가 "직접 열어서 보관하기" 링크 목록 방식. 링크는 사용자가 눌러야만 열린다.
 *  - 기본은 dry-run(미리보기). dryRun:false 일 때만 DB에 기록.
 *
 * 서비스별 (2026-10 조사)
 *  - ChatGPT: 공식 "보관(Archive)" 있음, 되돌리기 = 설정 → 데이터 제어(Archived chats) → 보관 해제.
 *    공개 API 없음. 확장에서 로그인 세션으로 내부 API(backend-api) 호출은 비공식·약관 위험 → 하지 않음.
 *  - Claude · Gemini · Grok: 개별 대화 보관 기능 없음(삭제만). 서비스 쪽은 그대로 두고 SubBrain 안에서만 "정리됨" 표시.
 *
 * 상태(service_archive_actions.state): link_issued(링크 발급, 사용자 작업 대기) → user_archived(사용자가 "보관했어요")
 *   · local_only(보관 기능 없는 서비스, SubBrain 안에서만 정리 표시) · undone(되돌림)
 */
import type { Core } from '../core.ts';
import { ApiError, notFound } from '../util/errors.ts';
import { nowIso } from '../util/time.ts';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface ServiceGuide { canArchive: boolean; mechanism: 'user_ui_link' | 'none'; howTo: string; undoHowTo: string; archivedListUrl: string | null }
export const SERVICE_GUIDES: Record<string, ServiceGuide> = {
  chatgpt: { canArchive: true, mechanism: 'user_ui_link', howTo: '링크를 눌러 대화를 연 뒤, 오른쪽 위 ⋯ 메뉴 → "보관(Archive)". 삭제(Delete)는 누르지 마세요.', undoHowTo: 'ChatGPT 설정 → 데이터 제어 → 보관된 채팅(Archived chats) → 해당 대화 "보관 해제".', archivedListUrl: 'https://chatgpt.com/#settings/DataControls' },
  claude: { canArchive: false, mechanism: 'none', howTo: 'Claude에는 개별 대화 보관 기능이 없어요(삭제만 있음). 서비스 쪽은 그대로 두고 SubBrain 안에서만 정리됨으로 표시해요.', undoHowTo: 'SubBrain에서 "되돌리기" — 서비스 쪽은 바뀐 게 없어요.', archivedListUrl: null },
  gemini: { canArchive: false, mechanism: 'none', howTo: 'Gemini에는 개별 대화 보관 기능이 없어요(삭제만 있음). 서비스 쪽은 그대로 두고 SubBrain 안에서만 정리됨으로 표시해요.', undoHowTo: 'SubBrain에서 "되돌리기" — 서비스 쪽은 바뀐 게 없어요.', archivedListUrl: null },
  grok: { canArchive: false, mechanism: 'none', howTo: 'Grok에는 개별 대화 보관 기능이 없어요(삭제만 있음). 서비스 쪽은 그대로 두고 SubBrain 안에서만 정리됨으로 표시해요.', undoHowTo: 'SubBrain에서 "되돌리기" — 서비스 쪽은 바뀐 게 없어요.', archivedListUrl: null },
};
const ELIGIBLE_ITEM_STATES = ['approved', 'archive_queued'];
const ALLOWED_HOSTS: Record<string, string[]> = { chatgpt: ['chatgpt.com', 'chat.openai.com'], claude: ['claude.ai'], gemini: ['gemini.google.com'], grok: ['grok.com', 'x.com'] };

export interface ServiceArchivePlanItem {
  itemId: number; conversationId: string; sourceAi: string; title: string; url: string | null; itemState: string;
  action: 'open_and_archive_yourself' | 'mark_local_only' | 'skip'; skipReason?: string; guide: ServiceGuide; actionId?: number;
}
export interface ServiceArchiveAction { id: number; itemId: number; conversationId: string; sourceAi: string; title: string; url: string | null; method: string; state: string; createdAt: string; updatedAt: string; undo: { prevServiceState: string; howTo: string } }

function ensureTable(core: Core) {
  core.db.run(`CREATE TABLE IF NOT EXISTS service_archive_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, conversation_id TEXT NOT NULL, source_ai TEXT NOT NULL,
    url TEXT, method TEXT NOT NULL, state TEXT NOT NULL, prev_service_state TEXT NOT NULL, undo_json TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  core.db.run('CREATE INDEX IF NOT EXISTS idx_saa_conv ON service_archive_actions(conversation_id)');
}
function audit(core: Core, e: Record<string, unknown>) {
  try { mkdirSync(join(core.home, 'cleanup'), { recursive: true }); appendFileSync(join(core.home, 'cleanup', 'audit.jsonl'), JSON.stringify({ at: nowIso(), ...e }) + '\n'); } catch { /* 무시 */ }
}
/** 서비스 도메인의 https 링크만 내보낸다(엉뚱한 주소로 보내지 않게) */
export function safeUrl(sourceAi: string, url: string | null): string | null {
  if (!url) return null;
  try { const u = new URL(url); const hosts = ALLOWED_HOSTS[sourceAi] ?? []; return u.protocol === 'https:' && hosts.includes(u.hostname) ? u.toString() : null; } catch { return null; }
}
const OPEN_STATES = ['link_issued', 'user_archived', 'local_only'];

/** 미리보기(dryRun 기본 true) 또는 기록. itemIds는 사용자가 화면에서 직접 고른 것만 */
export function planServiceArchive(core: Core, itemIds: number[], dryRun = true): { dryRun: boolean; items: ServiceArchivePlanItem[]; recorded: number } {
  ensureTable(core);
  if (!itemIds.length) throw new ApiError('VALIDATION_ERROR', '고른 항목이 없어요.', { issues: [{ path: 'itemIds', message: '0개' }] });
  const items: ServiceArchivePlanItem[] = [];
  for (const id of [...new Set(itemIds)]) {
    const r = core.db.get<{ id: number; conversation_id: string; state: string; source_ai: string; title: string | null; source_url: string | null; service_state: string }>(
      'SELECT di.id, di.conversation_id, di.state, c.source_ai, c.title, c.source_url, c.service_state FROM deletion_items di JOIN conversations c ON c.id=di.conversation_id WHERE di.id=?', id);
    if (!r) throw notFound('정리 항목', String(id), 'itemId');
    const guide = SERVICE_GUIDES[r.source_ai] ?? { canArchive: false, mechanism: 'none', howTo: '이 서비스는 정리 대상이 아니에요.', undoHowTo: '', archivedListUrl: null };
    const url = safeUrl(r.source_ai, r.source_url);
    const base = { itemId: r.id, conversationId: r.conversation_id, sourceAi: r.source_ai, title: r.title ?? '(제목 없음)', url, itemState: r.state, guide };
    const open = core.db.get<{ id: number }>(`SELECT id FROM service_archive_actions WHERE conversation_id=? AND state IN (${OPEN_STATES.map(() => '?').join(',')})`, r.conversation_id, ...OPEN_STATES);
    let skip: string | null = null;
    if (!ELIGIBLE_ITEM_STATES.includes(r.state)) skip = '정리 화면에서 승인(또는 보관 대기)된 항목이 아니에요';
    else if (r.service_state !== 'active') skip = `이미 서비스 상태가 ${r.service_state}예요`;
    else if (open) skip = '이미 보관 단계에 있어요';
    else if (!SERVICE_GUIDES[r.source_ai]) skip = '정리 대상 서비스가 아니에요';
    else if (guide.canArchive && !url) skip = '대화 주소가 없거나 서비스 주소가 아니에요';
    if (skip) { items.push({ ...base, action: 'skip', skipReason: skip, actionId: open?.id }); continue; }
    items.push({ ...base, action: guide.canArchive ? 'open_and_archive_yourself' : 'mark_local_only' });
  }
  let recorded = 0;
  if (!dryRun) {
    core.db.tx(() => {
      const at = nowIso();
      for (const it of items) {
        if (it.action === 'skip') continue;
        const prev = core.db.value<string>('SELECT service_state FROM conversations WHERE id=?', it.conversationId) ?? 'active';
        const state = it.action === 'open_and_archive_yourself' ? 'link_issued' : 'local_only';
        const undo = { prevServiceState: prev, howTo: it.guide.undoHowTo };
        it.actionId = Number(core.db.run('INSERT INTO service_archive_actions (item_id, conversation_id, source_ai, url, method, state, prev_service_state, undo_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
          it.itemId, it.conversationId, it.sourceAi, it.url, it.guide.mechanism, state, prev, JSON.stringify(undo), at, at).lastInsertRowid);
        recorded++;
      }
    });
    audit(core, { op: 'service_archive_recorded', itemIds, recorded });
  }
  return { dryRun, items, recorded };
}

/** 사용자가 서비스에서 직접 보관을 마쳤다고 누름 → service_state=archived (ChatGPT만). 삭제 아님 */
export function confirmServiceArchived(core: Core, actionIds: number[]): { changed: number } {
  ensureTable(core); let changed = 0;
  core.db.tx(() => {
    for (const id of actionIds) {
      const a = core.db.get<{ conversation_id: string; state: string }>('SELECT conversation_id, state FROM service_archive_actions WHERE id=?', id);
      if (!a) throw notFound('보관 기록', String(id), 'actionId');
      if (a.state !== 'link_issued') continue;
      core.db.run("UPDATE service_archive_actions SET state='user_archived', updated_at=? WHERE id=?", nowIso(), id);
      core.db.run("UPDATE conversations SET service_state='archived' WHERE id=? AND service_state='active'", a.conversation_id);
      changed++;
    }
  });
  audit(core, { op: 'service_archive_confirmed', actionIds, changed });
  return { changed };
}

/** 되돌리기: SubBrain 기록을 되돌리고 서비스에서 보관 해제하는 법을 알려준다(서비스는 사용자가 직접) */
export function undoServiceArchive(core: Core, actionIds: number[]): { changed: number; howTo: { actionId: number; sourceAi: string; howTo: string }[] } {
  ensureTable(core); let changed = 0; const howTo: { actionId: number; sourceAi: string; howTo: string }[] = [];
  core.db.tx(() => {
    for (const id of actionIds) {
      const a = core.db.get<{ conversation_id: string; state: string; source_ai: string; prev_service_state: string; undo_json: string }>('SELECT * FROM service_archive_actions WHERE id=?', id);
      if (!a) throw notFound('보관 기록', String(id), 'actionId');
      if (a.state === 'undone') continue;
      core.db.run("UPDATE service_archive_actions SET state='undone', updated_at=? WHERE id=?", nowIso(), id);
      core.db.run("UPDATE conversations SET service_state=? WHERE id=? AND service_state='archived'", a.prev_service_state, a.conversation_id);
      if (a.state === 'user_archived') howTo.push({ actionId: id, sourceAi: a.source_ai, howTo: (JSON.parse(a.undo_json) as { howTo: string }).howTo });
      changed++;
    }
  });
  audit(core, { op: 'service_archive_undone', actionIds, changed });
  return { changed, howTo };
}

export function listServiceArchive(core: Core): ServiceArchiveAction[] {
  ensureTable(core);
  return core.db.all<{ id: number; item_id: number; conversation_id: string; source_ai: string; title: string | null; url: string | null; method: string; state: string; created_at: string; updated_at: string; undo_json: string }>(
    'SELECT a.*, c.title FROM service_archive_actions a JOIN conversations c ON c.id=a.conversation_id ORDER BY a.id DESC')
    .map((r) => ({ id: r.id, itemId: r.item_id, conversationId: r.conversation_id, sourceAi: r.source_ai, title: r.title ?? '(제목 없음)', url: r.url, method: r.method, state: r.state, createdAt: r.created_at, updatedAt: r.updated_at, undo: JSON.parse(r.undo_json) }));
}

/** 화면에 보여줄 "고를 수 있는" 항목: 승인됨·보관 대기 중, 아직 보관 단계에 없는 것 (보여주기만, 아무것도 안 함) */
export function listServiceArchiveEligible(core: Core): { itemId: number; conversationId: string; sourceAi: string; title: string; itemState: string; canArchive: boolean }[] {
  ensureTable(core);
  return core.db.all<{ id: number; conversation_id: string; source_ai: string; title: string | null; state: string }>(
    `SELECT di.id, di.conversation_id, c.source_ai, c.title, di.state FROM deletion_items di JOIN conversations c ON c.id=di.conversation_id
     WHERE di.state IN ('approved','archive_queued') AND c.service_state='active'
       AND NOT EXISTS (SELECT 1 FROM service_archive_actions a WHERE a.conversation_id=di.conversation_id AND a.state IN ('link_issued','user_archived','local_only'))
     ORDER BY c.source_ai, di.id`)
    .map((r) => ({ itemId: r.id, conversationId: r.conversation_id, sourceAi: r.source_ai, title: r.title ?? '(제목 없음)', itemState: r.state, canArchive: !!SERVICE_GUIDES[r.source_ai]?.canArchive }));
}
