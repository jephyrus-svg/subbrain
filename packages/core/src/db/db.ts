/**
 * node:sqlite 연결 + 얇은 도우미. 저장 계층은 이 파일 하나만 node:sqlite를 안다
 * (나중에 better-sqlite3로 바꿀 때 여기만 고치면 되게 — 계약서 §3 "교체 가능").
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './migrations.ts';

export type SqlValue = string | number | bigint | null | Uint8Array;
export type Param = SqlValue | boolean | undefined;
export type Row = Record<string, SqlValue>;

const norm = (p: Param): SqlValue => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p);

export class Db {
  readonly raw: DatabaseSync;
  private cache = new Map<string, ReturnType<DatabaseSync['prepare']>>();
  private depth = 0;

  constructor(readonly path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');
    migrate(this);
  }
  get schemaVersion(): number { return Number((this.raw.prepare('PRAGMA user_version').get() as Row | undefined)?.user_version ?? 0); }
  private stmt(sql: string) {
    let s = this.cache.get(sql);
    if (!s) { s = this.raw.prepare(sql); this.cache.set(sql, s); }
    return s;
  }
  all<T = Row>(sql: string, ...params: Param[]): T[] { return this.stmt(sql).all(...params.map(norm)) as T[]; }
  get<T = Row>(sql: string, ...params: Param[]): T | undefined { return this.stmt(sql).get(...params.map(norm)) as T | undefined; }
  run(sql: string, ...params: Param[]): { changes: number; lastInsertRowid: number } {
    const r = this.stmt(sql).run(...params.map(norm));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }
  value<T extends SqlValue = number>(sql: string, ...params: Param[]): T | null {
    const r = this.stmt(sql).get(...params.map(norm)) as Row | undefined;
    if (!r) return null;
    const v = Object.values(r)[0];
    return (v ?? null) as T | null;
  }
  exec(sql: string): void { this.raw.exec(sql); }
  /** 중첩 가능한 트랜잭션(바깥 하나만 BEGIN IMMEDIATE) */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) { this.depth++; try { return fn(); } finally { this.depth--; } }
    this.raw.exec('BEGIN IMMEDIATE');
    this.depth = 1;
    try { const r = fn(); this.raw.exec('COMMIT'); return r; } catch (e) { this.raw.exec('ROLLBACK'); throw e; } finally { this.depth = 0; }
  }
  close(): void { this.cache.clear(); this.raw.close(); }
}

export const bool = (v: SqlValue | undefined): boolean => v === 1 || v === 1n || v === '1';
export const str = (v: SqlValue | undefined): string | null => (v === null || v === undefined ? null : String(v));
export const num = (v: SqlValue | undefined): number | null => (v === null || v === undefined ? null : Number(v));
export function json<T>(v: SqlValue | undefined, fallback: T): T {
  if (typeof v !== 'string' || v === '') return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}
