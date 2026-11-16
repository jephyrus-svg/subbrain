/**
 * 검색(§6.4, 계약서 §11.1). 단어마다 방식을 고른다: 3글자↑ trigram FTS, 2글자 LIKE, 1글자 제목·요약 LIKE.
 * 한 결과가 모든 단어를 포함해야 함(교집합). 드라이버 단어(가장 긴 것)로 후보를 뽑고 나머지 단어로 거른다.
 */
import type { SearchHit, SearchMode, SearchResponse, SearchResultType, SourceAi, TaskStatus } from '@subbrain/shared';
import type { Core } from '../core.ts';
import { json } from '../db/db.ts';
import { daysBetween, kstDate, today } from '../util/time.ts';
import { loadTasks, primaryAis, toTaskRef, type TaskFull } from '../services/tasks.ts';
import { page } from '../services/lists.ts';

export interface SearchParams { q: string; types?: SearchResultType[]; projectId?: string[]; sourceAi?: SourceAi[]; status?: TaskStatus[]; kind?: string[]; from?: string; to?: string; limit: number; offset: number }

export function termMode(term: string): SearchMode { const n = [...term].length; return n >= 3 ? 'trigram' : n === 2 ? 'like' : 'title_like'; }
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const likeEsc = (s: string) => `%${s.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
const ftsPhrase = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** 일치 부분 **굵게**, 첫 일치 앞뒤 60자 */
export function snippet(text: string, terms: string[], radius = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  let pos = -1;
  for (const t of terms) { const p = lower.indexOf(t.toLowerCase()); if (p >= 0 && (pos < 0 || p < pos)) pos = p; }
  let start = 0, end = flat.length;
  if (pos >= 0) { start = Math.max(0, pos - radius); end = Math.min(flat.length, pos + radius + (terms[0]?.length ?? 0)); } else end = Math.min(flat.length, radius * 2);
  let s = flat.slice(start, end);
  if (terms.length) s = s.replace(new RegExp(`(${terms.map(esc).sort((a, b) => b.length - a.length).join('|')})`, 'gi'), '**$1**');
  return `${start > 0 ? '…' : ''}${s}${end < flat.length ? '…' : ''}`;
}

const containsAll = (hay: string, terms: string[]) => { const h = hay.toLowerCase(); return terms.every((t) => h.includes(t.toLowerCase())); };

export function search(core: Core, p: SearchParams): SearchResponse {
  const t0 = performance.now();
  const db = core.db;
  const terms = [...new Set(p.q.trim().split(/\s+/).filter(Boolean))];
  const modes = terms.map((term) => ({ term, mode: termMode(term) }));
  const types = new Set<SearchResultType>(p.types?.length ? p.types.filter((t) => t !== 'wiki') : ['task', 'conversation', 'message', 'decision']);
  const long = terms.filter((t) => termMode(t) !== 'title_like');
  const short1 = terms.filter((t) => termMode(t) === 'title_like');
  const driver = [...long].sort((a, b) => [...b].length - [...a].length)[0] ?? null;
  const driverMode = driver ? termMode(driver) : 'title_like';
  const tasks = new Map(loadTasks(core).map((t) => [t.id, t]));
  const convTask = new Map(db.all<{ id: string; task_id: string | null }>('SELECT id, task_id FROM conversations').map((r) => [r.id, r.task_id]));
  const hits: SearchHit[] = [];
  const recency = (at: string | null) => (at ? Math.exp(-Math.max(0, daysBetween(kstDate(at), today())) / 90) : 0.3);
  const score = (w: number, at: string | null) => Math.round(w * (0.55 + 0.45 * recency(at)) * 100) / 100;
  const passTask = (t: TaskFull | null | undefined, ai: SourceAi | null, at: string | null): boolean => {
    if (p.projectId?.length && !(t && t.projectId && p.projectId.includes(t.projectId))) return false;
    if (p.status?.length && !(t && p.status.includes(t.status))) return false;
    if (p.kind?.length && !(t && p.kind.includes(t.kind))) return false;
    if (p.sourceAi?.length && !(ai ? p.sourceAi.includes(ai) : t && primaryAis(t).some((a) => p.sourceAi!.includes(a)))) return false;
    const d = at ? kstDate(at) : null;
    if (p.from && (!d || d < p.from)) return false;
    if (p.to && (!d || d > p.to)) return false;
    return true;
  };
  const taskLink = (t: TaskFull | undefined | null) => (t ? toTaskRef(t) : null);

  // 과제: 제목·요약·다음 할 일
  if (types.has('task')) {
    let ids: string[];
    if (driver && driverMode === 'trigram') ids = db.all<{ id: string }>('SELECT t.id FROM tasks_fts f JOIN tasks t ON t.rowid=f.rowid WHERE tasks_fts MATCH ?', ftsPhrase(driver)).map((r) => r.id);
    else ids = [...tasks.keys()];
    for (const id of ids) {
      const t = tasks.get(id);
      if (!t) continue;
      const text = `${t.title} ${t.summary ?? ''} ${t.nextStep ?? ''}`;
      if (!containsAll(text, long) || !containsAll(`${t.title} ${t.summary ?? ''}`, short1)) continue;
      if (!passTask(t, null, t.lastActivityAt)) continue;
      const lp = t.primary[0] ?? null;
      const body = t.summary && containsAll(t.summary, terms.slice(0, 1)) ? t.summary : containsAll(t.title, terms.slice(0, 1)) ? t.title : text;
      hits.push({ type: 'task', id, title: t.title, snippetMd: snippet(body, terms), task: taskLink(t), conversationId: lp?.id ?? null, sourceAi: lp?.sourceAi ?? null, sourceUrl: lp?.url ?? null,
        vaultPath: core.vault.ref('task', id).path || null, at: t.lastActivityAt, score: score(1, t.lastActivityAt) });
    }
  }
  // 대화: 제목
  if (types.has('conversation')) {
    const rows = driver && driverMode === 'trigram'
      ? db.all<{ id: string; title: string; source_ai: SourceAi; source_url: string | null; updated_at: string }>('SELECT c.id, c.title, c.source_ai, c.source_url, c.updated_at FROM conversations_fts f JOIN conversations c ON c.rowid=f.rowid WHERE conversations_fts MATCH ?', ftsPhrase(driver))
      : db.all<{ id: string; title: string; source_ai: SourceAi; source_url: string | null; updated_at: string }>("SELECT id, title, source_ai, source_url, updated_at FROM conversations WHERE title LIKE ? ESCAPE '\\'", likeEsc(driver ?? terms[0] ?? ''));
    for (const c of rows) {
      if (!containsAll(c.title ?? '', terms)) continue;
      const t = tasks.get(convTask.get(c.id) ?? '');
      if (!passTask(t, c.source_ai, c.updated_at)) continue;
      hits.push({ type: 'conversation', id: c.id, title: c.title, snippetMd: snippet(c.title, terms), task: taskLink(t), conversationId: c.id, sourceAi: c.source_ai, sourceUrl: c.source_url,
        vaultPath: core.vault.ref('conversation', c.id).path || null, at: c.updated_at, score: score(0.8, c.updated_at) });
    }
  }
  // 메시지 원문 (1글자 단어만 있으면 원문은 찾지 않음 — 제목·요약만)
  if (types.has('message') && driver) {
    const sql = driverMode === 'trigram'
      ? 'SELECT m.id, m.conversation_id, m.content_md, m.created_at FROM messages_fts f JOIN messages m ON m.id=f.rowid WHERE messages_fts MATCH ? ORDER BY m.id DESC LIMIT 3000'
      : "SELECT id, conversation_id, content_md, created_at FROM messages WHERE content_md LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 3000";
    const convs = new Map(db.all<{ id: string; title: string; source_ai: SourceAi; source_url: string | null; updated_at: string }>('SELECT id, title, source_ai, source_url, updated_at FROM conversations').map((c) => [c.id, c]));
    const perConv = new Map<string, number>();
    for (const m of db.all<{ id: number; conversation_id: string; content_md: string; created_at: string | null }>(sql, driverMode === 'trigram' ? ftsPhrase(driver) : likeEsc(driver))) {
      const c = convs.get(m.conversation_id);
      if (!c || !containsAll(m.content_md, long) || !containsAll(c.title ?? '', short1)) continue;
      const n = perConv.get(c.id) ?? 0;
      if (n >= 3) continue; // 한 대화에서 너무 많이 나오지 않게
      const at = m.created_at ?? c.updated_at;
      const t = tasks.get(convTask.get(c.id) ?? '');
      if (!passTask(t, c.source_ai, at)) continue;
      perConv.set(c.id, n + 1);
      hits.push({ type: 'message', id: String(m.id), title: c.title, snippetMd: snippet(m.content_md, terms), task: taskLink(t), conversationId: c.id, sourceAi: c.source_ai, sourceUrl: c.source_url,
        vaultPath: core.vault.ref('conversation', c.id).path || null, at, score: score(0.72, at) });
    }
  }
  // 결정 사항
  if (types.has('decision')) {
    for (const d of db.all<{ id: string; name: string; ref_id: string | null; properties_json: string; first_seen_at: string | null }>("SELECT id, name, ref_id, properties_json, first_seen_at FROM objects WHERE type='decision' AND status<>'merged'")) {
      if (!containsAll(d.name, terms)) continue;
      const props = json<{ conversationId?: string | null; sourceAi?: SourceAi | null; decidedAt?: string | null; valid?: boolean }>(d.properties_json, {});
      const t = tasks.get(d.ref_id ?? '');
      const at = props.decidedAt ?? d.first_seen_at;
      if (!passTask(t, props.sourceAi ?? null, at)) continue;
      hits.push({ type: 'decision', id: d.id, title: d.name, snippetMd: snippet(d.name, terms), task: taskLink(t), conversationId: props.conversationId ?? null, sourceAi: props.sourceAi ?? null, sourceUrl: null,
        vaultPath: null, at, score: score(props.valid === false ? 0.5 : 0.75, at) });
    }
  }
  hits.sort((a, b) => b.score - a.score || (b.at ?? '').localeCompare(a.at ?? ''));
  const slow = modes.filter((m) => m.mode !== 'trigram');
  const notice = !slow.length ? null
    : slow.some((m) => m.mode === 'like') ? '2글자 검색어는 전체 검색(LIKE)으로 찾았어요. 조금 느릴 수 있어요.'
    : '1글자 검색어는 과제·대화 제목과 요약에서만 찾았어요.';
  const res = page(hits, p.offset, p.limit);
  return { query: p.q, terms: modes, notice, tookMs: Math.round(performance.now() - t0), ...res };
}
