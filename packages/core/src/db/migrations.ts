import { outcomeLabel, type OutcomeKind } from '../classifier/signals.ts';
/**
 * 스키마 마이그레이션. 설계서 §6.3(기본 테이블) + §8.4(온톨로지) + 계약서 §15 추가분.
 * 설계서에 없는 코어 내부 열·테이블은 "-- +core" 주석으로 표시.
 */
import type { Db } from './db.ts';
import { OBJECT_TYPE_META, LINK_TYPE_META } from '@subbrain/shared/constants';

const M1 = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, aliases_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'active',
  color TEXT NOT NULL,                       -- 계약서 §15-10
  summary TEXT,                              -- +core 분류기가 쓴 프로젝트 요약
  thresholds_json TEXT,                      -- +core 프로젝트별 방치 기준(§7.3)
  priority REAL NOT NULL DEFAULT 1.0,        -- +core 이어서 하기 점수의 프로젝트 우선순위(§7.7)
  created_at TEXT NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  status TEXT NOT NULL,                      -- 진행 중|멈춤|완료|간단한 질문|보관
  status_source TEXT NOT NULL DEFAULT 'rule',-- user|mcp|llm|rule
  pin INTEGER NOT NULL DEFAULT 0,
  overrides_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT, last_activity_at TEXT, completed_at TEXT,
  next_step TEXT, origin TEXT NOT NULL DEFAULT 'auto',
  decisions_json TEXT NOT NULL DEFAULT '[]',  -- 결정 객체(objects)의 보여주기용 사본
  open_questions_json TEXT NOT NULL DEFAULT '[]',
  resume_prompt TEXT, resume_prompt_at TEXT,
  kind TEXT NOT NULL DEFAULT 'task',          -- +core 마지막 분류 결과 사본
  resolution TEXT,                            -- +core
  completion_reason TEXT,                     -- +core §7.2-5
  summary TEXT, summary_detail_json TEXT NOT NULL DEFAULT '[]', -- +core
  confidence REAL, classification_id INTEGER, -- +core
  stale_days INTEGER,                         -- +core 규칙 엔진이 매일 계산
  mcp_status TEXT, mcp_status_at TEXT,        -- +core §7.2-2 (Phase 2)
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_last ON tasks(last_activity_at);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY, source_ai TEXT NOT NULL, source_id TEXT NOT NULL, source_url TEXT, title TEXT,
  created_at TEXT, updated_at TEXT, captured_at TEXT, message_count INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT, capture_method TEXT NOT NULL DEFAULT 'export', raw_path TEXT,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  pin INTEGER NOT NULL DEFAULT 0, is_shared INTEGER NOT NULL DEFAULT 0, in_service_project INTEGER NOT NULL DEFAULT 0,
  has_unextracted_artifact INTEGER NOT NULL DEFAULT 0, service_state TEXT NOT NULL DEFAULT 'active', deleted_at TEXT,
  import_id TEXT,                             -- +core 마지막으로 들여온 가져오기
  classified_hash TEXT,                       -- +core 마지막 분류 때의 content_hash (changed 범위용)
  UNIQUE (source_ai, source_id)
);
CREATE INDEX idx_conv_task ON conversations(task_id);
CREATE INDEX idx_conv_updated ON conversations(updated_at);

-- 계약서 §15-2: 대화 ↔ 과제 (주/공유)
CREATE TABLE task_conversations (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('primary','shared')),
  PRIMARY KEY (task_id, conversation_id)
);
CREATE INDEX idx_tc_conv ON task_conversations(conversation_id);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, role TEXT NOT NULL, content_md TEXT NOT NULL DEFAULT '', created_at TEXT, content_hash TEXT,
  UNIQUE (conversation_id, seq)
);
CREATE INDEX idx_msg_created ON messages(created_at);

-- §6.4 전문 검색 (trigram). 2글자 bigram 보조 색인은 MVP에서 만들지 않음 → LIKE 대체
CREATE VIRTUAL TABLE messages_fts USING fts5(content_md, content='messages', content_rowid='id', tokenize='trigram');
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN INSERT INTO messages_fts(rowid, content_md) VALUES (new.id, new.content_md); END;
CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN INSERT INTO messages_fts(messages_fts, rowid, content_md) VALUES ('delete', old.id, old.content_md); END;
CREATE TRIGGER messages_au AFTER UPDATE OF content_md ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content_md) VALUES ('delete', old.id, old.content_md);
  INSERT INTO messages_fts(rowid, content_md) VALUES (new.id, new.content_md);
END;
CREATE VIRTUAL TABLE tasks_fts USING fts5(title, summary, next_step, content='tasks', content_rowid='rowid', tokenize='trigram');
CREATE TRIGGER tasks_ai AFTER INSERT ON tasks BEGIN INSERT INTO tasks_fts(rowid, title, summary, next_step) VALUES (new.rowid, new.title, new.summary, new.next_step); END;
CREATE TRIGGER tasks_ad AFTER DELETE ON tasks BEGIN INSERT INTO tasks_fts(tasks_fts, rowid, title, summary, next_step) VALUES ('delete', old.rowid, old.title, old.summary, old.next_step); END;
CREATE TRIGGER tasks_au AFTER UPDATE OF title, summary, next_step ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, summary, next_step) VALUES ('delete', old.rowid, old.title, old.summary, old.next_step);
  INSERT INTO tasks_fts(rowid, title, summary, next_step) VALUES (new.rowid, new.title, new.summary, new.next_step);
END;
CREATE VIRTUAL TABLE conversations_fts USING fts5(title, content='conversations', content_rowid='rowid', tokenize='trigram');
CREATE TRIGGER conv_ai AFTER INSERT ON conversations BEGIN INSERT INTO conversations_fts(rowid, title) VALUES (new.rowid, new.title); END;
CREATE TRIGGER conv_ad AFTER DELETE ON conversations BEGIN INSERT INTO conversations_fts(conversations_fts, rowid, title) VALUES ('delete', old.rowid, old.title); END;
CREATE TRIGGER conv_au AFTER UPDATE OF title ON conversations BEGIN
  INSERT INTO conversations_fts(conversations_fts, rowid, title) VALUES ('delete', old.rowid, old.title);
  INSERT INTO conversations_fts(rowid, title) VALUES (new.rowid, new.title);
END;

CREATE TABLE classifications (
  id INTEGER PRIMARY KEY, conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  kind TEXT, resolution TEXT, summary TEXT, next_step TEXT, evidence TEXT, project_guess TEXT, topics_json TEXT,
  confidence REAL, model TEXT, prompt_version TEXT, input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL, created_at TEXT,
  detail_json TEXT, decisions_json TEXT, open_questions_json TEXT, same_task_candidates_json TEXT -- +core LLM 출력 나머지
);
CREATE INDEX idx_cls_conv ON classifications(conversation_id, id);
CREATE INDEX idx_cls_created ON classifications(created_at);

CREATE TABLE events (
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, type TEXT NOT NULL, task_id TEXT, conversation_id TEXT, actor TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_events_at ON events(at);
CREATE INDEX idx_events_task ON events(task_id);

CREATE TABLE vault_files (path TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT, generated_hash TEXT, generated_at TEXT);
CREATE INDEX idx_vault_entity ON vault_files(entity_type, entity_id);
CREATE TABLE vault_conflicts (                -- +core §5.4④ 충돌 백업 기록
  id INTEGER PRIMARY KEY, path TEXT NOT NULL, entity_type TEXT, entity_id TEXT, detected_at TEXT NOT NULL, backup_path TEXT NOT NULL
);

CREATE TABLE deletion_batches (
  id TEXT PRIMARY KEY, created_at TEXT, approved_at TEXT, approved_count INTEGER, confirm_phrase TEXT, mode TEXT, db_backup_ref TEXT, state TEXT
);
CREATE TABLE deletion_items (
  id INTEGER PRIMARY KEY, batch_id TEXT REFERENCES deletion_batches(id), conversation_id TEXT REFERENCES conversations(id),
  expected_source_id TEXT, expected_url TEXT, expected_message_count INTEGER, expected_hash TEXT, state TEXT, reason TEXT, attempted_at TEXT, finished_at TEXT
);
CREATE TABLE sync_state (
  source_ai TEXT PRIMARY KEY, last_sidebar_scan_at TEXT, last_import_at TEXT, last_reconcile_at TEXT,
  adapter_version TEXT, selectors_version TEXT, adapter_health TEXT NOT NULL DEFAULT 'ok', notes TEXT,
  methods_json TEXT NOT NULL DEFAULT '["export"]' -- +core 수집 방식(MVP는 export)
);
CREATE TABLE reconcile_reports (id INTEGER PRIMARY KEY, source_ai TEXT, run_at TEXT, missing_in_db INTEGER, count_mismatch INTEGER, details_json TEXT);
CREATE TABLE digests (date TEXT PRIMARY KEY, generated_at TEXT NOT NULL, body_json TEXT NOT NULL, deletion_batch_id TEXT REFERENCES deletion_batches(id));
CREATE TABLE wiki_pages (id TEXT PRIMARY KEY, title TEXT, body_md TEXT, source_task_ids_json TEXT, draft INTEGER, updated_at TEXT);

CREATE TABLE import_batches (
  id TEXT PRIMARY KEY, source_ai TEXT, file_name TEXT, file_hash TEXT, imported_at TEXT, conversations_new INTEGER, conversations_updated INTEGER, errors_json TEXT,
  state TEXT NOT NULL DEFAULT 'uploaded',     -- +core 아래는 가져오기 작업 상태
  file_size INTEGER NOT NULL DEFAULT 0, file_path TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
  options_json TEXT NOT NULL DEFAULT '{}', preview_json TEXT, progress_json TEXT NOT NULL DEFAULT '{}', result_json TEXT, classify_job_id TEXT
);
CREATE INDEX idx_import_hash ON import_batches(file_hash);

-- +core 작업 큐 (§5.4② queue/scheduler)
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
  processed INTEGER NOT NULL DEFAULT 0, total INTEGER, label TEXT NOT NULL, parent_id TEXT, error TEXT, cost_usd REAL, payload_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_jobs_state ON jobs(state);

-- +core 설정 (키/값 JSON). API 키는 여기 두지 않는다
CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);

-- 계약서 §15-4: 과제 합치기 제안
CREATE TABLE task_merge_suggestions (
  id TEXT PRIMARY KEY, task_a TEXT NOT NULL, task_b TEXT NOT NULL, suggested_primary TEXT NOT NULL,
  confidence REAL NOT NULL, reason TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, decided_at TEXT
);
CREATE INDEX idx_ms_state ON task_merge_suggestions(state);

-- §8.4 온톨로지 (MVP는 topic·decision 객체만 사용)
CREATE TABLE object_types (key TEXT PRIMARY KEY, label_ko TEXT, icon TEXT, sensitive INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1);
CREATE TABLE objects (
  id TEXT PRIMARY KEY, type TEXT NOT NULL REFERENCES object_types(key), name TEXT NOT NULL, norm_name TEXT NOT NULL,
  ref_table TEXT, ref_id TEXT, properties_json TEXT, status TEXT DEFAULT 'suggested', merged_into TEXT REFERENCES objects(id),
  confidence REAL, first_seen_at TEXT, last_seen_at TEXT, mention_count INTEGER DEFAULT 0, origin TEXT
);
CREATE INDEX idx_objects_type_norm ON objects(type, norm_name);
CREATE INDEX idx_objects_ref ON objects(ref_table, ref_id);
CREATE TABLE aliases (object_id TEXT REFERENCES objects(id) ON DELETE CASCADE, alias TEXT, norm_alias TEXT, source TEXT, PRIMARY KEY (object_id, norm_alias));
CREATE INDEX idx_aliases_norm ON aliases(norm_alias);
CREATE TABLE link_types (key TEXT PRIMARY KEY, label_ko TEXT, directed INTEGER DEFAULT 1, allowed_pairs_json TEXT, color TEXT);
CREATE TABLE links (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL REFERENCES link_types(key), src_id TEXT NOT NULL REFERENCES objects(id), dst_id TEXT NOT NULL REFERENCES objects(id),
  properties_json TEXT, status TEXT DEFAULT 'suggested', confidence REAL, valid_from TEXT, ended_at TEXT, first_seen_at TEXT, last_seen_at TEXT, origin TEXT,
  UNIQUE (type, src_id, dst_id)
);
CREATE TABLE evidence (
  id INTEGER PRIMARY KEY, target_kind TEXT, target_id TEXT, conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL, excerpt TEXT, confidence REAL, model TEXT, prompt_version TEXT, extracted_at TEXT
);
CREATE INDEX idx_evidence_target ON evidence(target_kind, target_id);

-- +core MVP 그래프용 연결 (Phase 1.5에 links로 옮길 예정: 과제·프로젝트가 아직 객체가 아니라서)
CREATE TABLE task_topics (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, topic_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  confidence REAL, created_at TEXT, PRIMARY KEY (task_id, topic_id)
);
CREATE TABLE task_links (
  src_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, dst_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL, confidence REAL, reason TEXT, created_at TEXT, PRIMARY KEY (src_task_id, dst_task_id, type)
);
CREATE TABLE project_links (
  project_a TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, project_b TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reason TEXT NOT NULL, shared_topic_ids_json TEXT NOT NULL DEFAULT '[]', weight REAL NOT NULL DEFAULT 1, created_at TEXT,
  PRIMARY KEY (project_a, project_b)
);
`;

/** 계약 1.1.0 (§16): 분류 불가(blocked) · 이어감(handoff) · 주제 출처 · 새 프로젝트 제안 · 외부 프로젝트 id */
const M2 = `
ALTER TABLE classifications ADD COLUMN state TEXT NOT NULL DEFAULT 'ok';     -- ok|blocked
ALTER TABLE classifications ADD COLUMN blocked_reason TEXT;                   -- 제공자 안전 차단 사유(PROHIBITED_CONTENT 등)
ALTER TABLE classifications ADD COLUMN blocked_model TEXT;                    -- 막은 LLM 모델 (model 열은 대신 쓴 rule-mock)
ALTER TABLE classifications ADD COLUMN raw_confidence REAL;                   -- 보정 전 모델 확신도
ALTER TABLE classifications ADD COLUMN handoff_json TEXT;                     -- HandoffInfo | NULL
ALTER TABLE classifications ADD COLUMN new_project_suggestion TEXT;
ALTER TABLE tasks ADD COLUMN handoff_json TEXT;                               -- 최신 주 대화 분류의 HandoffInfo 사본
ALTER TABLE task_topics ADD COLUMN origin TEXT;                               -- rule|llm|user|seed (NULL = 1.0 데이터)
ALTER TABLE task_topics ADD COLUMN conversation_id TEXT;                      -- 이 주제를 낸 분류의 대화
ALTER TABLE projects ADD COLUMN external_ref TEXT;                            -- 예: claude_project:<uuid> (projects ZIP 가져오기)
UPDATE task_topics SET origin = (SELECT o.origin FROM objects o WHERE o.id = task_topics.topic_id);
CREATE TABLE project_suggestions (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, norm_name TEXT NOT NULL, alt_names_json TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'pending', project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, decided_at TEXT
);
CREATE INDEX idx_psg_state ON project_suggestions(state);
CREATE TABLE project_suggestion_tasks (
  suggestion_id TEXT NOT NULL REFERENCES project_suggestions(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  conversation_id TEXT, suggested_name TEXT, confidence REAL, created_at TEXT NOT NULL,
  PRIMARY KEY (suggestion_id, task_id)
);
CREATE INDEX idx_psgt_task ON project_suggestion_tasks(task_id);
`;

/** 1.2.0 — LLM 응답 캐시(같은 모델·프롬프트 버전·입력이면 같은 답), 분류 기록에 캐시 적중 표시 */
const M3 = `
CREATE TABLE llm_cache (
  key TEXT PRIMARY KEY,                 -- sha256(provider, model, promptVersion, inputHash)
  provider TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL, input_hash TEXT NOT NULL,
  output_json TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, last_hit_at TEXT, hits INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_llm_cache_model ON llm_cache(model, prompt_version);
ALTER TABLE classifications ADD COLUMN cache_hit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE classifications ADD COLUMN content_hash TEXT;                   -- 분류할 때의 대화 내용 해시(이전 요약을 고를 때 씀)
`;

const M4 = `
-- 1.3.0 — 음성 대화 전사 메시지 표시(ChatGPT audio_transcription)
ALTER TABLE messages ADD COLUMN voice INTEGER NOT NULL DEFAULT 0;
`;

const M5 = `
-- 1.4.0 — 대화 결과(done|moved|interrupted|open) + 간단한 질문은 상태가 아니라 종류
ALTER TABLE classifications ADD COLUMN conversation_outcome TEXT;
ALTER TABLE classifications ADD COLUMN outcome_json TEXT;
ALTER TABLE conversations ADD COLUMN outcome TEXT;             -- 최신 분류의 대화 결과(재분류 전이면 NULL → 읽을 때 추정)
ALTER TABLE conversations ADD COLUMN outcome_json TEXT;
CREATE INDEX idx_conv_outcome ON conversations(outcome);
-- 저장된 '간단한 질문' 상태 바꾸기: 답 받음(미해결 아님) → 완료/answered, 답 못 받음 → 진행 중(다음 계산에서 방치 규칙 적용)
UPDATE tasks SET status='완료', completion_reason='answered', completed_at=COALESCE(completed_at, last_activity_at)
  WHERE status='간단한 질문' AND (resolution IS NULL OR resolution<>'unresolved');
UPDATE tasks SET status='진행 중', completion_reason=NULL WHERE status='간단한 질문';
`;

const M6 = `
-- M6: 1.5.0 — 대화 결과 라벨 저장 · 로컬 세션 수집기(Claude Code·Codex)
ALTER TABLE classifications ADD COLUMN outcome_label TEXT;
ALTER TABLE conversations ADD COLUMN outcome_label TEXT;
ALTER TABLE conversations ADD COLUMN cwd TEXT;              -- 로컬 세션의 작업 폴더(프로젝트 힌트)
-- 파일마다 이어 읽기 위치. state_json = 이 파일에서 뽑은 메시지(줄인 글) + 짝 못 찾은 도구 호출 + 제목 등
CREATE TABLE collector_files (
  path TEXT PRIMARY KEY, source_ai TEXT NOT NULL, inode TEXT, size INTEGER NOT NULL DEFAULT 0, offset INTEGER NOT NULL DEFAULT 0,
  session_key TEXT, is_subagent INTEGER NOT NULL DEFAULT 0, state_json TEXT, lines INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT, error TEXT
);
CREATE INDEX idx_cf_session ON collector_files(session_key);
CREATE TABLE collector_state (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
ALTER TABLE task_merge_suggestions ADD COLUMN kind TEXT NOT NULL DEFAULT 'same_task';
ALTER TABLE task_merge_suggestions ADD COLUMN handoff_json TEXT;
`;

const M7 = `
-- M7: 1.7.0 — 온톨로지 구현(설계서 8.4–8.6)
ALTER TABLE links ADD COLUMN mention_count INTEGER NOT NULL DEFAULT 1;
CREATE INDEX idx_links_src ON links(src_id, type);
CREATE INDEX idx_links_dst ON links(dst_id, type);
CREATE INDEX idx_evidence_conv ON evidence(conversation_id);
-- 제안 검토(8.6·8.9): kind object|link|merge, state pending|accepted|rejected
CREATE TABLE ontology_suggestions (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, object_id TEXT, link_id INTEGER, keep_id TEXT, merge_id TEXT,
  confidence REAL NOT NULL DEFAULT 0, reason TEXT NOT NULL, note TEXT, state TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL, decided_at TEXT, reject_reason TEXT
);
CREATE INDEX idx_osug_state ON ontology_suggestions(state, confidence);
-- 되돌리기용 이벤트(바뀌기 전 행 통째로)
CREATE TABLE ontology_events (id INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL, undone_at TEXT);
-- 거절 기억(8.10): 'o|타입|정규화 이름' · 'l|타입|src|dst' · 'm|a|b'
CREATE TABLE ontology_rejections (key TEXT PRIMARY KEY, at TEXT NOT NULL);
-- LLM 추출 실행 기록(같은 내용·프롬프트 다시 안 보냄)
CREATE TABLE ontology_runs (conversation_id TEXT PRIMARY KEY, content_hash TEXT, prompt_version TEXT, model TEXT, at TEXT, input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL);
`;

const M8 = `
-- M8: 1.9.0 — 확장 수집 API · 페어링 토큰(계약 §14.3)
CREATE TABLE pairings (id TEXT PRIMARY KEY, code_hash TEXT NOT NULL, kind TEXT NOT NULL, name TEXT, scopes_json TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, used_at TEXT, discarded_at TEXT);
CREATE TABLE client_tokens (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, version TEXT, extension_id TEXT, scopes_json TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE, prev_token_hash TEXT, prev_valid_until TEXT,
  created_at TEXT NOT NULL, last_used_at TEXT, rotated_at TEXT, revoked_at TEXT);
CREATE INDEX idx_client_tokens_prev ON client_tokens(prev_token_hash);
CREATE TABLE ingest_keys (key TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, status TEXT NOT NULL, token_id TEXT, at TEXT NOT NULL);
CREATE TABLE catchup_items (source_ai TEXT NOT NULL, source_id TEXT NOT NULL, title TEXT, service_updated_at TEXT,
  requested_at TEXT, requested_reason TEXT, fulfilled_at TEXT, unknown_checked_at TEXT, seen_at TEXT NOT NULL, PRIMARY KEY (source_ai, source_id));
ALTER TABLE conversations ADD COLUMN ingest_hash TEXT;
ALTER TABLE conversations ADD COLUMN ingest_captured_at TEXT;
ALTER TABLE conversations ADD COLUMN ingest_partial INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN service_updated_at TEXT;
ALTER TABLE messages ADD COLUMN external_id TEXT;
ALTER TABLE sync_state ADD COLUMN cursor TEXT;
ALTER TABLE sync_state ADD COLUMN last_snapshot_at TEXT;
ALTER TABLE sync_state ADD COLUMN health_at TEXT;
ALTER TABLE sync_state ADD COLUMN adapter_name TEXT;
ALTER TABLE sync_state ADD COLUMN error_code TEXT;
ALTER TABLE sync_state ADD COLUMN buffered_snapshots INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_state ADD COLUMN checks_json TEXT;
`;

const MIGRATIONS: Array<(db: Db) => void> = [
  (db) => {
    db.exec(M1);
    for (const t of OBJECT_TYPE_META) db.run('INSERT INTO object_types(key,label_ko,icon,sensitive,enabled) VALUES (?,?,?,?,?)', t.key, t.labelKo, t.icon, t.sensitive, t.enabled);
    for (const l of LINK_TYPE_META) db.run('INSERT INTO link_types(key,label_ko,directed,color) VALUES (?,?,?,?)', l.key, l.labelKo, l.directed, l.colorHex);
  },
  (db) => { db.exec(M2); },
  (db) => { db.exec(M3); },
  (db) => { db.exec(M4); },
  (db) => { db.exec(M5); },
  (db) => {
    db.exec(M6);
    // 이미 저장된 대화 결과에 라벨 채우기
    for (const tbl of ['conversations', 'classifications']) {
      for (const r of db.all<{ id: string | number; outcome_json: string }>(`SELECT id, outcome_json FROM ${tbl} WHERE outcome_json IS NOT NULL`)) {
        try {
          const o = JSON.parse(r.outcome_json) as { outcome: OutcomeKind; target: string | null; reason: string | null };
          const label = outcomeLabel(o.outcome, o.target, o.reason);
          db.run(`UPDATE ${tbl} SET outcome_label=?, outcome_json=? WHERE id=?`, label, JSON.stringify({ ...o, label }), r.id);
        } catch { /* 깨진 JSON은 그대로 */ }
      }
    }
  },
  (db) => { db.exec(M7); },
  (db) => { db.exec(M8); },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function migrate(db: Db): void {
  const current = Number(db.value<number>('PRAGMA user_version') ?? 0);
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.tx(() => {
      MIGRATIONS[v]!(db);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}
