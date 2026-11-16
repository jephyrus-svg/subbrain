/** 스케줄러(§5.4②): 1분마다 확인 — 매일 03:00 방치 재계산, 설정 시각(기본 08:00)에 오늘의 요약 */
import type { Core } from './core.ts';
import { recalcAll } from './services/tasks.ts';
import { generateDigest } from './digest/digest.ts';
import { kstHhmm, today } from './util/time.ts';

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private lastRecalcDate: string | null = null;
  constructor(private core: Core) {}

  start(): void {
    this.runStaleRecalc('시작할 때 방치 다시 계산');
    this.tick();
    this.timer = setInterval(() => this.tick(), 60_000);
    this.timer.unref();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  tick(): void {
    const d = today();
    const hhmm = kstHhmm();
    if (hhmm >= '03:00' && this.lastRecalcDate !== d) this.runStaleRecalc('매일 03:00 방치 다시 계산');
    const s = this.core.settings.get().digest;
    if (hhmm >= s.time && !this.core.db.get('SELECT 1 FROM digests WHERE date=?', d) && !this.core.db.get("SELECT 1 FROM jobs WHERE type='digest' AND state IN ('queued','running')")) {
      const id = this.core.queue.create('digest', `오늘의 요약 · ${d}`, { total: 1 });
      this.core.queue.enqueue(id, async (ctl) => { generateDigest(this.core, d); ctl.progress(1, 1); });
    }
  }

  runStaleRecalc(label: string): string {
    this.lastRecalcDate = today();
    const id = this.core.queue.create('stale_recalc', label);
    this.core.queue.enqueue(id, async (ctl) => { const r = recalcAll(this.core); ctl.progress(r.total, r.total); });
    return id;
  }
}
