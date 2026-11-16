/** SQLite 테이블 기반 작업 큐 (§5.4②). 한 번에 하나씩 순서대로 돈다(쓰기 경합 방지). */
import type { Job, JobState, JobType } from '@subbrain/shared';
import type { Db, Row } from '../db/db.ts';
import { num, str } from '../db/db.ts';
import { randomId } from '../util/ids.ts';
import { nowIso } from '../util/time.ts';

export interface JobCtl {
  id: string;
  progress(processed: number, total?: number | null): void;
  addCost(usd: number | null): void;
  cancelled(): boolean;
}
export type JobFn = (ctl: JobCtl) => Promise<JobState | void>;

export function rowToJob(r: Row): Job {
  const processed = Number(r.processed ?? 0), total = num(r.total);
  return {
    id: String(r.id), type: String(r.type) as JobType, state: String(r.state) as JobState,
    createdAt: String(r.created_at), startedAt: str(r.started_at), finishedAt: str(r.finished_at),
    progress: { processed, total, percent: total ? Math.min(100, Math.round((processed / total) * 100)) : r.state === 'done' ? 100 : null },
    label: String(r.label), parentId: str(r.parent_id), error: str(r.error), costUsd: num(r.cost_usd),
  };
}

export class JobQueue {
  private chain: Promise<void> = Promise.resolve();
  private pending = 0;
  private cancelledIds = new Set<string>();
  paused = false;

  constructor(private db: Db) {
    db.run("UPDATE jobs SET state='failed', error='코어가 다시 시작되어 중단됐어요', finished_at=? WHERE state IN ('queued','running')", nowIso());
  }

  create(type: JobType, label: string, opts: { parentId?: string | null; total?: number | null; payload?: unknown } = {}): string {
    const id = 'job_' + randomId(4);
    this.db.run('INSERT INTO jobs(id,type,state,created_at,label,parent_id,total,payload_json) VALUES (?,?,?,?,?,?,?,?)',
      id, type, 'queued', nowIso(), label, opts.parentId ?? null, opts.total ?? null, JSON.stringify(opts.payload ?? {}));
    return id;
  }

  /** 작업을 큐에 넣는다. fn이 'deferred'/'cancelled'를 돌려주면 그 상태로 끝냄 */
  enqueue(id: string, fn: JobFn): void {
    this.pending++;
    this.chain = this.chain.then(async () => {
      const db = this.db;
      if (this.cancelledIds.has(id)) { db.run("UPDATE jobs SET state='cancelled', finished_at=? WHERE id=?", nowIso(), id); return; }
      db.run("UPDATE jobs SET state='running', started_at=? WHERE id=?", nowIso(), id);
      const ctl: JobCtl = {
        id,
        progress: (p, t) => { if (t === undefined) db.run('UPDATE jobs SET processed=? WHERE id=?', p, id); else db.run('UPDATE jobs SET processed=?, total=? WHERE id=?', p, t, id); },
        addCost: (usd) => { if (usd !== null && usd > 0) db.run('UPDATE jobs SET cost_usd=COALESCE(cost_usd,0)+? WHERE id=?', usd, id); },
        cancelled: () => this.cancelledIds.has(id),
      };
      try {
        const final = (await fn(ctl)) ?? 'done';
        db.run('UPDATE jobs SET state=?, finished_at=? WHERE id=?', final, nowIso(), id);
      } catch (e) {
        db.run("UPDATE jobs SET state='failed', error=?, finished_at=? WHERE id=?", e instanceof Error ? e.message : String(e), nowIso(), id);
        if (process.env.SUBBRAIN_DEBUG) console.error(e);
      }
    }).finally(() => { this.pending--; });
  }

  cancel(id: string): void { this.cancelledIds.add(id); }
  get(id: string): Job | null { const r = this.db.get('SELECT * FROM jobs WHERE id=?', id); return r ? rowToJob(r) : null; }
  get depth(): number { return Number(this.db.value("SELECT COUNT(*) FROM jobs WHERE state='queued'") ?? 0); }
  get running(): number { return Number(this.db.value("SELECT COUNT(*) FROM jobs WHERE state='running'") ?? 0); }
  /** 테스트·CLI용: 큐가 빌 때까지 기다림 */
  async idle(): Promise<void> { while (this.pending > 0) await this.chain; }
}
