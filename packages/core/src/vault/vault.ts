/**
 * 단방향 볼트 생성기 (설계서 §5.4④, §6.1, §6.2).
 * - DB → 마크다운 + YAML frontmatter. 볼트에서 고친 내용은 DB로 돌아오지 않는다(v2 감시기 전까지).
 * - vault_files에 마지막으로 쓴 내용의 해시를 둔다. 덮어쓰기 전에 파일 해시가 다르면(사용자가 Obsidian에서 고침)
 *   .subbrain/conflicts/<시각>/<경로>에 백업하고 vault_conflicts에 남긴 뒤 덮어쓴다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { stringify } from 'yaml';
import type { DigestResponse, VaultConflict, VaultRef } from '@subbrain/shared';
import type { Core } from '../core.ts';
import { json, str } from '../db/db.ts';
import { sha256, slugify } from '../util/ids.ts';
import { kstDate, nowIso } from '../util/time.ts';
import type { JobCtl } from '../queue/jobs.ts';

export type EntityType = VaultConflict['entityType'];
const GENERATED = '<!-- subbrain:generated — 이 파일은 자동 생성됩니다. 수정은 웹앱에서 하세요. -->';

export class VaultWriter {
  private pending = new Map<string, { type: EntityType; id: string }>();
  private flushScheduled = false;
  lastError: string | null = null;

  constructor(private core: Core, private autoWrite: boolean) {}

  /**
   * 1.10.1 볼트 주인 표시(.subbrain/owner.json = 이 볼트를 쓰는 DB 파일 경로).
   * DB를 다른 곳에 복사해 시험하면 설정의 볼트 경로가 원본 볼트를 그대로 가리켜, 복사본이 원본 볼트에 파일을 쓰고
   * 원본 엔진은 기록에 없는 파일을 "사용자가 고친 파일"로 보고 충돌 처리했음(Phase 12.1 grokbot 108개). 주인이 다르면 쓰지 않는다.
   */
  private ownerCache: { root: string; ok: boolean } | null = null;
  ownsVault(): boolean {
    const root = this.root;
    if (!root) return false;
    if (this.ownerCache?.root === root) return this.ownerCache.ok;
    const dbPath = this.core.db.path;
    let ok = true;
    if (dbPath !== ':memory:') {
      const me = (() => { try { return realpathSync(dbPath); } catch { return resolve(dbPath); } })();
      const f = join(root, '.subbrain', 'owner.json');
      let owner: string | null = null;
      try { owner = (JSON.parse(readFileSync(f, 'utf8')) as { db?: string }).db ?? null; } catch { owner = null; }
      if (owner && owner !== me && existsSync(owner)) {
        ok = false;
        this.lastError = `볼트 ${root}는 다른 DB(${owner})의 볼트예요 — 이 DB(${me})에서는 볼트를 쓰지 않아요. 복사본이면 설정에서 볼트 경로를 바꾸거나 SUBBRAIN_VAULT를 주세요.`;
        process.stderr.write(`[subbrain] ⚠ ${this.lastError}\n`);
      } else if (owner !== me) {
        mkdirSync(dirname(f), { recursive: true });
        writeFileSync(f, JSON.stringify({ db: me, at: nowIso() }) + '\n');
      }
    }
    this.ownerCache = { root, ok };
    return ok;
  }

  get root(): string { return this.core.settings.get().vault.path; }
  private uri(path: string): string | null {
    const name = this.core.settings.get().vault.name;
    return name ? `obsidian://open?vault=${encodeURIComponent(name)}&file=${encodeURIComponent(path)}` : null;
  }

  // ───────── 경로
  private owned(type: EntityType, id: string): string | null {
    return this.core.db.value<string>('SELECT path FROM vault_files WHERE entity_type=? AND entity_id=? ORDER BY generated_at DESC LIMIT 1', type, id);
  }
  private unique(path: string, type: EntityType, id: string): string {
    const owner = this.core.db.get<{ entity_type: string; entity_id: string }>('SELECT entity_type, entity_id FROM vault_files WHERE path=?', path);
    if (!owner || (owner.entity_type === type && owner.entity_id === id)) return path;
    return path.replace(/\.md$/, `-${id.split('_').slice(-2).join('')}.md`);
  }
  convPath(c: { id: string; source_ai: string; title: string; created_at: string }): string {
    const d = kstDate(c.created_at);
    const id8 = c.id.split('_').at(-1) ?? c.id;
    return `conversations/${d.slice(0, 4)}/${d.slice(5, 7)}/${d}_${c.source_ai}_${slugify(c.title, 40)}_${id8}.md`;
  }
  desiredPath(type: EntityType, id: string): string | null {
    const db = this.core.db;
    if (type === 'task') { const t = db.value<string>('SELECT title FROM tasks WHERE id=?', id); return t === null ? null : this.unique(`tasks/${slugify(t)}.md`, type, id); }
    if (type === 'project') { const n = db.value<string>('SELECT name FROM projects WHERE id=?', id); return n === null ? null : this.unique(`projects/${slugify(n)}.md`, type, id); }
    if (type === 'conversation') {
      const c = db.get<{ id: string; source_ai: string; title: string; created_at: string }>('SELECT id, source_ai, title, created_at FROM conversations WHERE id=?', id);
      return c ? this.convPath(c) : null;
    }
    if (type === 'daily') return `daily/${id}.md`;
    return null;
  }
  /** API용 VaultRef — 이미 쓴 파일이 있으면 그 경로, 없으면 쓸 경로 */
  ref(type: EntityType, id: string): VaultRef {
    const path = this.owned(type, id) ?? this.desiredPath(type, id) ?? '';
    return { path, obsidianUri: path ? this.uri(path) : null };
  }
  linkName(type: EntityType, id: string): string | null {
    const p = this.owned(type, id) ?? this.desiredPath(type, id);
    return p ? p.split('/').at(-1)!.replace(/\.md$/, '') : null;
  }

  // ───────── 쓰기 (해시 추적 + 충돌 백업)
  writeFile(rel: string, content: string, type: EntityType, id: string): 'written' | 'unchanged' | 'conflict' {
    const root = this.root;
    if (!root) throw new Error('볼트 경로가 설정되지 않았어요');
    const db = this.core.db;
    const abs = join(root, rel);
    const hash = 'sha256:' + sha256(content);
    if (!this.ownsVault()) return 'unchanged';
    const rec = db.get<{ generated_hash: string }>('SELECT generated_hash FROM vault_files WHERE path=?', rel);
    let result: 'written' | 'unchanged' | 'conflict' = 'written';
    if (existsSync(abs)) {
      const onDisk = 'sha256:' + sha256(readFileSync(abs));
      if (rec && onDisk === hash && rec.generated_hash === hash) return 'unchanged';
      // 1.10.1 디스크 내용이 지금 쓸 내용과 같으면 사람이 고친 게 아님(다른 프로세스가 먼저 씀) → 충돌 아님, 기록만
      if (onDisk !== hash && (!rec || onDisk !== rec.generated_hash)) { this.backup(rel, type, id); result = 'conflict'; }
    }
    mkdirSync(dirname(abs), { recursive: true });
    if (result === 'conflict' || !existsSync(abs) || 'sha256:' + sha256(readFileSync(abs)) !== hash) writeFileSync(abs, content);
    db.run('INSERT INTO vault_files(path,entity_type,entity_id,generated_hash,generated_at) VALUES (?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET entity_type=excluded.entity_type, entity_id=excluded.entity_id, generated_hash=excluded.generated_hash, generated_at=excluded.generated_at',
      rel, type, id, hash, nowIso());
    // 제목이 바뀌어 옛 경로가 남았으면 정리(사용자가 고친 파일이면 백업 후)
    for (const old of db.all<{ path: string; generated_hash: string }>('SELECT path, generated_hash FROM vault_files WHERE entity_type=? AND entity_id=? AND path<>?', type, id, rel)) this.removeFile(old.path, type, id);
    return result;
  }
  private backup(rel: string, type: EntityType, id: string): void {
    const stamp = nowIso().slice(0, 19).replace(/:/g, '-');
    const backupRel = `.subbrain/conflicts/${stamp}/${rel}`;
    const dst = join(this.root, backupRel);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(join(this.root, rel), dst);
    this.core.db.run('INSERT INTO vault_conflicts(path,entity_type,entity_id,detected_at,backup_path) VALUES (?,?,?,?,?)', rel, type, id, nowIso(), backupRel);
  }
  private removeFile(rel: string, type: EntityType, id: string): void {
    if (!this.ownsVault()) return;
    const abs = join(this.root, rel);
    const rec = this.core.db.get<{ generated_hash: string }>('SELECT generated_hash FROM vault_files WHERE path=?', rel);
    if (existsSync(abs)) {
      if (rec && 'sha256:' + sha256(readFileSync(abs)) !== rec.generated_hash) this.backup(rel, type, id);
      rmSync(abs);
    }
    this.core.db.run('DELETE FROM vault_files WHERE path=?', rel);
  }
  removeEntity(type: EntityType, id: string): void {
    if (!this.root) return;
    for (const r of this.core.db.all<{ path: string }>('SELECT path FROM vault_files WHERE entity_type=? AND entity_id=?', type, id)) this.removeFile(r.path, type, id);
  }

  // ───────── 렌더링
  private fm(data: Record<string, unknown>, body: string): string {
    return `---\n${stringify(data, { lineWidth: 0 }).trimEnd()}\n---\n\n${body.trim()}\n\n${GENERATED}\n`;
  }

  renderConversation(id: string): { path: string; content: string } | null {
    const db = this.core.db;
    const c = db.get('SELECT * FROM conversations WHERE id=?', id);
    if (!c) return null;
    const task = c.task_id ? db.get('SELECT * FROM tasks WHERE id=?', c.task_id) : undefined;
    const project = task?.project_id ? db.get('SELECT id, name FROM projects WHERE id=?', task.project_id) : undefined;
    const cls = db.get('SELECT * FROM classifications WHERE conversation_id=? ORDER BY id DESC LIMIT 1', id);
    const topics = task ? db.all<{ name: string }>("SELECT o.name FROM task_topics tt JOIN objects o ON o.id=tt.topic_id WHERE tt.task_id=?", task.id).map((r) => r.name) : [];
    const path = this.desiredPath('conversation', id)!;
    const ai = String(c.source_ai);
    const s = this.core.settings.get();
    const data = {
      type: 'conversation', id, source_ai: ai, source_id: String(c.source_id), source_url: str(c.source_url), title: String(c.title ?? ''),
      kind: task ? String(task.kind) : null, status: task ? String(task.status) : null, stale_days: task && task.stale_days !== null ? Number(task.stale_days) : null,
      summary: str(cls?.summary) ?? (task ? str(task.summary) : null), next_step: task ? str(task.next_step) : null,
      project: project ? `[[${this.linkName('project', String(project.id))}]]` : null, task: task ? `[[${this.linkName('task', String(task.id))}]]` : null,
      topics, pin: Number(c.pin) === 1, service_state: String(c.service_state), created: String(c.created_at), updated: String(c.updated_at), captured: String(c.captured_at),
      message_count: Number(c.message_count), capture_method: String(c.capture_method), content_hash: str(c.content_hash), raw_path: str(c.raw_path),
      classifier: cls ? { model: String(cls.model), version: String(cls.prompt_version), confidence: Number(cls.confidence), classified_at: String(cls.created_at) } : null,
      overrides: task ? json<string[]>(task.overrides_json, []) : [], deletion: { state: 'none', deleted_at: null }, tags: ['subbrain/conversation'],
    };
    type M = { seq: number; role: string; content_md: string };
    const first = db.get<M>("SELECT seq, role, content_md FROM messages WHERE conversation_id=? AND role='user' ORDER BY seq LIMIT 1", id);
    const lastAi = db.get<M>("SELECT seq, role, content_md FROM messages WHERE conversation_id=? AND role='assistant' ORDER BY seq DESC LIMIT 1", id);
    const lastUser = db.get<M>("SELECT seq, role, content_md FROM messages WHERE conversation_id=? AND role='user' ORDER BY seq DESC LIMIT 1", id);
    const q = (s0: string) => s0.replace(/\s+/g, ' ').trim().slice(0, 500);
    const label = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', grok: 'Grok' }[ai] ?? ai;
    const lines = [
      '## 요약', data.summary ?? '(아직 분류 전)', ...json<string[]>(cls?.detail_json, []).map((d) => `- ${d}`), '',
      '## 다음 단계', data.next_step ? `- [ ] ${data.next_step}` : '- 없음', '',
      '## 발췌',
      ...(first ? [`> **나 (첫 요청):** ${q(first.content_md)}`] : []),
      ...(lastAi ? [`> **${label} (마지막 답변 일부):** ${q(lastAi.content_md)}`] : []),
      ...(lastUser && lastUser.seq !== first?.seq ? [`> **나 (마지막 메시지):** ${q(lastUser.content_md)}`] : []),
      ...(cls?.evidence ? [`> **분류 근거:** ${q(String(cls.evidence))}`] : []), '',
      '## 관련', ...(data.task ? [`- 과제: ${data.task}`] : []), ...(data.project ? [`- 프로젝트: ${data.project}`] : []),
      `- 전체 원문: ${data.raw_path ? '`' + data.raw_path + '`' : 'DB'} · [웹앱에서 보기](http://127.0.0.1:${this.core.port}/conversations/${id})`,
    ];
    if (s.vault.includeFullTranscript) {
      lines.push('', '## 원문', '> [!note]- 전체 대화 (접힘)');
      for (const m of db.all<M>('SELECT seq, role, content_md FROM messages WHERE conversation_id=? ORDER BY seq', id)) {
        lines.push(`> **${m.role === 'user' ? '나' : m.role === 'assistant' ? label : m.role}:** ${m.content_md.replace(/\n/g, '\n> ')}`, '>');
      }
    }
    return { path, content: this.fm(data, lines.join('\n')) };
  }

  renderTask(id: string): { path: string; content: string } | null {
    const db = this.core.db;
    const t = db.get('SELECT * FROM tasks WHERE id=?', id);
    if (!t) return null;
    const convs = db.all<{ id: string; source_ai: string; role: string }>("SELECT c.id, c.source_ai, tc.role FROM task_conversations tc JOIN conversations c ON c.id=tc.conversation_id WHERE tc.task_id=? ORDER BY c.created_at", id);
    const decisions = db.all<{ name: string; properties_json: string }>("SELECT name, properties_json FROM objects WHERE type='decision' AND ref_table='tasks' AND ref_id=? AND status<>'rejected' ORDER BY first_seen_at", id);
    const oq = json<Array<{ text: string; resolved: boolean }>>(t.open_questions_json, []);
    const topics = db.all<{ name: string }>('SELECT o.name FROM task_topics tt JOIN objects o ON o.id=tt.topic_id WHERE tt.task_id=?', id).map((r) => r.name);
    const path = this.desiredPath('task', id)!;
    const link = (cid: string | null) => { const n = cid ? this.linkName('conversation', cid) : null; return n ? `[[${n}]]` : null; };
    const data = {
      type: 'task', id, title: String(t.title), status: String(t.status), stale_days: t.stale_days === null ? null : Number(t.stale_days),
      project: t.project_id ? `[[${this.linkName('project', String(t.project_id))}]]` : null, pin: Number(t.pin) === 1,
      conversations: convs.map((c) => link(c.id)!).filter(Boolean), source_ais: [...new Set(convs.filter((c) => c.role === 'primary').map((c) => c.source_ai))],
      started: t.started_at ? kstDate(String(t.started_at)) : null, last_activity: t.last_activity_at ? kstDate(String(t.last_activity_at)) : null,
      completed: t.completed_at ? kstDate(String(t.completed_at)) : null, next_step: str(t.next_step),
      decisions: decisions.map((d) => ({ text: d.name, source: link(json<{ conversationId?: string }>(d.properties_json, {}).conversationId ?? null) })),
      open_questions: oq.map((q) => ({ text: q.text, resolved: q.resolved })), origin: String(t.origin), overrides: json<string[]>(t.overrides_json, []),
      tags: ['subbrain/task', ...topics.map((x) => `topic/${slugify(x, 30)}`)],
    };
    const body = [
      `# ${data.title}`, '', '## 요약', str(t.summary) ?? '(아직 분류 전)', ...json<string[]>(t.summary_detail_json, []).map((d) => `- ${d}`), '',
      '## 다음 단계', data.next_step ? `- [ ] ${data.next_step}` : '- 없음', '',
      '## 결정한 것', ...(data.decisions.length ? data.decisions.map((d) => `- ${d.text}${d.source ? ` (${d.source})` : ''}`) : ['- 없음']), '',
      '## 아직 열린 질문', ...(oq.length ? oq.map((q) => `- [${q.resolved ? 'x' : ' '}] ${q.text}`) : ['- 없음']), '',
      '## 대화', ...data.conversations.map((c) => `- ${c}`),
    ].join('\n');
    return { path, content: this.fm(data, body) };
  }

  renderProject(id: string): { path: string; content: string } | null {
    const db = this.core.db;
    const p = db.get('SELECT * FROM projects WHERE id=?', id);
    if (!p) return null;
    const tasks = db.all<{ id: string; title: string; status: string }>("SELECT id, title, status FROM tasks WHERE project_id=? AND kind<>'quick_question' AND status NOT IN ('간단한 질문','보관') ORDER BY last_activity_at DESC", id);
    const data = { type: 'project', id, name: String(p.name), status: String(p.status), aliases: json<string[]>(p.aliases_json, []), color: String(p.color), tags: ['subbrain/project'] };
    const body = [`# ${data.name}`, '', str(p.summary) ?? '', '', '## 과제', ...(tasks.length ? tasks.map((t) => `- [[${this.linkName('task', t.id)}]] · ${t.status}`) : ['- 없음'])].join('\n');
    return { path: this.desiredPath('project', id)!, content: this.fm(data, body) };
  }

  renderDaily(date: string): { path: string; content: string } | null {
    const row = this.core.db.get<{ body_json: string; generated_at: string }>('SELECT body_json, generated_at FROM digests WHERE date=?', date);
    if (!row) return null;
    const d = JSON.parse(row.body_json) as DigestResponse;
    const taskLink = (id: string, title: string) => { const n = this.linkName('task', id); return n ? `[[${n}|${title}]]` : title; };
    const body = [
      `# ${d.title}`, '',
      `어제 대화 ${d.strip.yesterdayConversations} · 끝낸 과제 ${d.strip.completedTasks} · 새로 멈춘 일 ${d.strip.newlyStalled} · 간단한 질문 ${d.strip.quickQuestions} · 수집 공백 ${d.strip.collectionGap.label}`, '',
      '## 어제 있었던 일', d.yesterday.narrative, '', ...d.yesterday.events.map((e) => `- ${e.timeLabel} · ${e.actionLabel} · ${e.tasks.map((t) => taskLink(t.id, t.title)).join(', ')}${e.note ? ` — ${e.note}` : ''}`), '',
      '## 오늘 이어서 할 것', ...d.todayPicks.map((p) => `${p.rank}. ${taskLink(p.task.id, p.task.title)} (${p.freshnessLabel}) — ${p.nextStep}`), '',
      '## 이번 주 한 일', ...d.thisWeek.items.map((i) => `- ${i}`),
      ...(d.longNeglected.count ? ['', `## 오래 방치 (${d.longNeglected.count}개) — ${d.longNeglected.prompt}`, ...d.longNeglected.items.map((t) => `- ${taskLink(t.id, t.title)} · ${t.staleDays}일`)] : []),
    ].join('\n');
    return { path: `daily/${date}.md`, content: this.fm({ type: 'daily', date, generated: row.generated_at, tags: ['subbrain/daily'] }, body) };
  }

  writeEntity(type: EntityType, id: string): void {
    const r = type === 'conversation' ? this.renderConversation(id) : type === 'task' ? this.renderTask(id) : type === 'project' ? this.renderProject(id) : type === 'daily' ? this.renderDaily(id) : null;
    if (r) this.writeFile(r.path, r.content, type, id);
    else this.removeEntity(type, id);
  }

  /** 쓰기 API가 부르는 비동기 갱신(응답을 기다리게 하지 않음, 계약서 §1.6) */
  schedule(type: EntityType, id: string): void {
    if (!this.autoWrite || !this.root) return;
    this.pending.set(`${type}:${id}`, { type, id });
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    setImmediate(() => this.flush());
  }
  flush(): void {
    this.flushScheduled = false;
    const items = [...this.pending.values()];
    this.pending.clear();
    for (const it of items) {
      try { this.writeEntity(it.type, it.id); } catch (e) { this.lastError = e instanceof Error ? e.message : String(e); }
    }
  }
  scheduleTask(taskId: string): void {
    this.schedule('task', taskId);
    const db = this.core.db;
    const p = db.value<string>('SELECT project_id FROM tasks WHERE id=?', taskId);
    if (p) this.schedule('project', p);
    for (const c of db.all<{ conversation_id: string }>('SELECT conversation_id FROM task_conversations WHERE task_id=?', taskId)) this.schedule('conversation', c.conversation_id);
  }

  ensureReadme(): void {
    const readme = '# SubBrain 볼트\n\n자동 생성 폴더입니다. 수정은 웹앱에서 하세요.\n직접 고친 파일은 다음 생성 때 `.subbrain/conflicts/`에 백업된 뒤 덮어써집니다.\n';
    this.writeFile('README.md', readme, 'wiki', 'readme');
  }

  /** 볼트 전체 다시 만들기 (CLI regenerate-vault · POST /vault/regenerate) */
  async regenerateAll(ctl?: JobCtl): Promise<{ written: number; conflicts: number; total: number }> {
    const db = this.core.db;
    const items: Array<[EntityType, string]> = [
      ...db.all<{ id: string }>('SELECT id FROM projects').map((r): [EntityType, string] => ['project', r.id]),
      ...db.all<{ id: string }>('SELECT id FROM tasks').map((r): [EntityType, string] => ['task', r.id]),
      ...db.all<{ id: string }>('SELECT id FROM conversations').map((r): [EntityType, string] => ['conversation', r.id]),
      ...db.all<{ date: string }>('SELECT date FROM digests').map((r): [EntityType, string] => ['daily', r.date]),
    ];
    let written = 0, conflicts = 0, i = 0;
    ctl?.progress(0, items.length + 1);
    this.ensureReadme();
    for (const [type, id] of items) {
      const r = type === 'conversation' ? this.renderConversation(id) : type === 'task' ? this.renderTask(id) : type === 'project' ? this.renderProject(id) : this.renderDaily(id);
      if (r) { const res = this.writeFile(r.path, r.content, type, id); if (res !== 'unchanged') written++; if (res === 'conflict') conflicts++; }
      if (++i % 50 === 0) { ctl?.progress(i, items.length + 1); await new Promise((res) => setImmediate(res)); }
    }
    // DB에 없는 엔티티의 옛 파일 정리
    for (const r of db.all<{ path: string; entity_type: EntityType; entity_id: string }>(
      "SELECT path, entity_type, entity_id FROM vault_files WHERE (entity_type='task' AND entity_id NOT IN (SELECT id FROM tasks)) OR (entity_type='conversation' AND entity_id NOT IN (SELECT id FROM conversations)) OR (entity_type='project' AND entity_id NOT IN (SELECT id FROM projects))")) {
      this.removeFile(r.path, r.entity_type, r.entity_id);
    }
    ctl?.progress(items.length + 1, items.length + 1);
    return { written, conflicts, total: items.length };
  }

  lastGeneratedAt(): string | null { return this.core.db.value<string>('SELECT MAX(generated_at) FROM vault_files'); }
  conflictCount(): number { return Number(this.core.db.value('SELECT COUNT(*) FROM vault_conflicts') ?? 0); }
}
