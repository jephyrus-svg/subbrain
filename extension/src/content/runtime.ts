// 콘텐츠 스크립트 본체: 사용자가 보고 있는 화면을 읽기만 한다(추가 요청 없음 · 사이트 내부 API 없음).
// - MutationObserver로 바뀜 감지 → 조용해지면(디바운스) 스냅샷
// - 답 스트리밍 중엔 complete:false 조각을 드물게, 끝나면 바로 complete:true
// - SPA 주소 바뀜(대화 이동) · 탭 숨김 때 바로 한 번 더
// - 사이드바 목록이 보이거나 바뀌면 서비스 워커에 넘김 → 따라잡기 diff
// 토큰·코어 주소는 모른다. 보내는 곳은 chrome.runtime.sendMessage(서비스 워커)뿐.
import type { Adapter, HealthReport } from '../adapters/types';
import { validateExtraction } from '../adapters/base';
import type { PageSnapshot, ToWorker } from '../shared/messages';

export interface RuntimeOpts {
  debounceMs: number;        // 마지막 변화 뒤 이만큼 조용하면 읽음
  partialEveryMs: number;    // 스트리밍 중 조각 최소 간격
  sidebarDebounceMs: number;
  sidebarMinGapMs: number;   // 같은 목록을 너무 자주 보내지 않음
  urlPollMs: number;
}
export const DEFAULT_OPTS: RuntimeOpts = { debounceMs: 2500, partialEveryMs: 20_000, sidebarDebounceMs: 3000, sidebarMinGapMs: 60_000, urlPollMs: 1000 };

export class ContentRuntime {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sbTimer: ReturnType<typeof setTimeout> | null = null;
  private urlTimer: ReturnType<typeof setInterval> | null = null;
  private obs: MutationObserver | null = null;
  private href = '';
  private lastSig = '';
  private lastPartialAt = 0;
  private wasStreaming = false;
  private lastCount: number | null = null;
  private sbSig = ''; private sbAt = -Infinity;
  private healthSig = '';
  paused = false;

  constructor(private readonly a: Adapter, private readonly win: Window, private readonly send: (m: ToWorker) => void, private readonly o: RuntimeOpts = DEFAULT_OPTS, private readonly clock: () => number = () => Date.now()) {}

  get doc() { return this.win.document; }
  get url() { return new URL(this.win.location.href); }

  start() {
    this.href = this.win.location.href;
    this.send({ type: 'hello', sourceAi: this.a.sourceAi });
    const MO = (this.win as Window & { MutationObserver: typeof MutationObserver }).MutationObserver;
    this.obs = new MO(() => this.onMutation());
    this.obs.observe(this.doc.body ?? this.doc.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-is-streaming', 'data-message-author-role', 'data-testid', 'aria-label', 'href'] });
    this.urlTimer = setInterval(() => this.checkUrl(), this.o.urlPollMs);
    this.doc.addEventListener('visibilitychange', () => { if (this.doc.visibilityState === 'hidden') this.readNow(); else this.send({ type: 'visit', sourceAi: this.a.sourceAi }); });
    this.checkHealth();
    this.schedule(); this.scheduleSidebar();
  }
  stop() { this.obs?.disconnect(); if (this.timer) clearTimeout(this.timer); if (this.sbTimer) clearTimeout(this.sbTimer); if (this.urlTimer) clearInterval(this.urlTimer); }

  private onMutation() { this.schedule(); this.scheduleSidebar(); }
  private schedule(ms = this.o.debounceMs) { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => this.readNow(), ms); }
  private scheduleSidebar() { if (this.sbTimer) clearTimeout(this.sbTimer); this.sbTimer = setTimeout(() => this.readSidebar(), this.o.sidebarDebounceMs); }

  checkUrl() {
    if (this.win.location.href === this.href) return;
    this.href = this.win.location.href;
    this.lastSig = ''; this.lastCount = null; this.wasStreaming = false; this.lastPartialAt = 0;
    this.checkHealth();
    this.schedule(1500);
  }

  checkHealth(): HealthReport {
    const r = this.a.healthCheck(this.doc, this.url);
    const sig = `${r.health}|${r.errorCode}|${r.checks.map((c) => c.name + c.ok).join()}`;
    if (sig !== this.healthSig) { this.healthSig = sig; this.send({ type: 'health', sourceAi: this.a.sourceAi, report: r }); }
    return r;
  }

  /** 지금 화면을 읽어 바뀌었으면 보낸다. 돌려준 값은 테스트용 */
  readNow(): 'paused' | 'no-conversation' | 'invalid' | 'same' | 'partial' | 'sent' | 'throttled' {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.paused) return 'paused';
    const url = this.url;
    const r = this.a.readMessages(this.doc, url);
    if (!r) return 'no-conversation';
    const bad = validateExtraction(r, url, this.a, this.lastCount);
    if (bad) {
      // 이상이 있으면 이 스냅샷은 버리고(덮어쓰지 않음) 상태를 '주의'로
      const diag = r.messages.length === 0 && this.a.diagnose ? this.a.diagnose(this.doc).map((d) => ({ name: d.name, ok: false, detail: d.detail })) : [];
      this.send({ type: 'health', sourceAi: this.a.sourceAi, report: { health: 'degraded', checks: [{ name: 'extract_valid', ok: false, detail: bad }, ...diag], errorCode: 'EXTRACT_INVALID' } });
      this.healthSig = 'extract-invalid';
      return 'invalid';
    }
    if (r.fallbacks.length) this.checkHealth();
    const complete = !r.streaming;
    const sig = `${r.sourceId}|${complete}|${r.messages.length}|${r.messages.map((m) => m.contentMd.length).join(',')}|${r.title}`;
    if (sig === this.lastSig) return 'same';
    const now = this.clock();
    if (!complete) {
      this.wasStreaming = true;
      if (now - this.lastPartialAt < this.o.partialEveryMs) { this.schedule(this.o.debounceMs); return 'throttled'; }
      this.lastPartialAt = now;
    } else this.wasStreaming = false;
    this.lastSig = sig; this.lastCount = r.messages.length;
    const snapshot: PageSnapshot = {
      sourceAi: this.a.sourceAi, sourceId: r.sourceId, url: url.origin + url.pathname, title: r.title, messages: r.messages, complete,
      project: r.project, adapter: { name: this.a.name, version: this.a.version, domVersion: this.a.sel.domVersion }, catchup: false, capturedAt: new Date(now).toISOString(),
    };
    this.send({ type: 'snapshot', snapshot });
    if (!complete) this.schedule(this.o.debounceMs);
    return complete ? 'sent' : 'partial';
  }

  readSidebar(): 'closed' | 'same' | 'sent' | 'throttled' {
    if (this.paused || !this.a.sidebarOpen(this.doc)) return 'closed';
    const items = this.a.listSidebar(this.doc, this.url).slice(0, 500);
    if (!items.length) return 'closed';
    const sig = items.map((i) => i.sourceId + i.title).join('|');
    if (sig === this.sbSig) return 'same';
    const now = this.clock();
    if (now - this.sbAt < this.o.sidebarMinGapMs) { this.scheduleSidebar(); return 'throttled'; }
    this.sbSig = sig; this.sbAt = now;
    // 끝까지 스크롤하지 않으므로 endOfList는 false(서버 stopBefore로 충분)
    this.send({ type: 'sidebar', sourceAi: this.a.sourceAi, items, endOfList: false });
    return 'sent';
  }
}
