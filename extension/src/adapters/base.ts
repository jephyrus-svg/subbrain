// 두 사이트가 함께 쓰는 읽기 로직. 사이트별 차이는 selectors.ts 값으로만 둔다.
import type { IngestMessage, MessageRole, SiteAi } from '../shared/contract';
import type { SidebarItem } from '../shared/messages';
import { plainText, toMarkdown } from './dom-md';
import type { SiteSelectors } from './selectors';
import type { Adapter, HealthCheck, HealthReport, ReadResult } from './types';

/** 대체 사슬: 처음 맞는 선택자의 결과와 몇 번째였는지 */
export function firstAll(root: ParentNode, chain: string[]): { els: Element[]; index: number } {
  for (let i = 0; i < chain.length; i++) {
    try { const els = [...root.querySelectorAll(chain[i]!)]; if (els.length) return { els, index: i }; } catch { /* 잘못된 선택자는 건너뜀 */ }
  }
  return { els: [], index: -1 };
}
export const first = (root: ParentNode, chain: string[]) => { const r = firstAll(root, chain); return { el: r.els[0] ?? null, index: r.index }; };

export function makeAdapter(sourceAi: SiteAi, name: string, version: string, sel: SiteSelectors, extra: { roleOf?: (el: Element) => MessageRole | null } = {}): Adapter {
  const detectConversation = (url: URL) => {
    for (const re of sel.conversationPath) { const m = re.exec(url.pathname); if (m?.[1]) return m[1]; }
    return null;
  };
  const roleOf = (el: Element): MessageRole | null => {
    if (extra.roleOf) { const r = extra.roleOf(el); if (r) return r; }
    const r = sel.role;
    if (r.attr) {
      const v = el.getAttribute(r.attr) ?? '';
      if (r.userWhen?.includes(v)) return 'user';
      if (r.assistantWhen?.includes(v)) return 'assistant';
      if (v === 'system' || v === 'tool') return v as MessageRole;
    }
    if (r.userSelector && el.matches(r.userSelector)) return 'user';
    if (r.assistantSelector && el.matches(r.assistantSelector)) return 'assistant';
    return null;
  };
  const title = (doc: Document): string => {
    const t = first(doc, sel.title).el?.textContent?.trim();
    if (t) return t;
    const dt = doc.title.replace(sel.titleSuffix, '').trim();
    return dt && !/^(ChatGPT|Claude)$/i.test(dt) ? dt : '제목 없음';
  };
  const project = (url: URL, doc: Document): ReadResult['project'] => {
    if (!sel.projectPath) return null;
    const m = sel.projectPath.exec(url.pathname);
    if (m?.[1]) return { externalId: m[1], name: (m[2] ?? m[1]).replace(/-/g, ' ') };
    // Claude: 대화 화면 머리글의 프로젝트 링크
    const a = doc.querySelector('a[href^="/project/"]');
    const pm = a ? sel.projectPath.exec(a.getAttribute('href') ?? '') : null;
    return pm?.[1] ? { externalId: pm[1], name: a!.textContent?.trim() || pm[1] } : null;
  };

  const readMessages = (doc: Document, url: URL): ReadResult | null => {
    const sourceId = detectConversation(url);
    if (!sourceId) return null;
    const fallbacks: string[] = [];
    const found = firstAll(doc, sel.message);
    if (found.index > 0) fallbacks.push('message_selector');
    // 겹친 요소(바깥·안쪽이 모두 맞는 경우)는 바깥만
    const els = found.els.filter((e) => !found.els.some((o) => o !== e && o.contains(e)));
    const messages: IngestMessage[] = [];
    for (const el of els) {
      const role = roleOf(el);
      if (!role) continue;
      const bodyChain = role === 'user' ? sel.body?.user : sel.body?.assistant;
      const b = bodyChain ? first(el, bodyChain) : { el: null, index: -1 };
      const bodyEl = b.el ?? el;
      const contentMd = role === 'user' ? plainText(bodyEl, sel.strip) : toMarkdown(bodyEl, sel.strip);
      let externalId: string | null = null;
      for (const a of sel.messageId ?? []) { const v = el.getAttribute(a) ?? el.closest(`[${a}]`)?.getAttribute(a) ?? el.querySelector(`[${a}]`)?.getAttribute(a); if (v) { externalId = v.trim().split(/\s+/)[0] ?? v; break; } }
      messages.push({ seq: messages.length, externalId, role, contentMd, createdAt: null });
    }
    const streaming = sel.streaming.some((s) => { try { return !!doc.querySelector(s); } catch { return false; } });
    return { sourceId, title: title(doc), messages, streaming, project: project(url, doc), fallbacks };
  };

  const listSidebar = (doc: Document, base: URL): SidebarItem[] => {
    const { els } = firstAll(doc, sel.sidebarLink);
    const seen = new Set<string>(); const out: SidebarItem[] = [];
    for (const a of els) {
      const href = a.getAttribute('href'); if (!href) continue;
      let u: URL; try { u = new URL(href, base); } catch { continue; }
      const id = detectConversation(u); if (!id || seen.has(id)) continue;
      seen.add(id);
      // 사이드바에는 보통 시각이 없다 → updatedAt null(서버가 unknown_time으로 하루 한 번만 다시 봄)
      const t = a.querySelector('time')?.getAttribute('datetime') ?? null;
      out.push({ sourceId: id, title: (a.getAttribute('title') ?? a.textContent ?? '').trim() || '제목 없음', updatedAt: t, url: u.href });
    }
    return out;
  };
  const sidebarOpen = (doc: Document) => firstAll(doc, sel.sidebarLink).els.length > 0;

  const healthCheck = (doc: Document, url: URL): HealthReport => {
    const checks: HealthCheck[] = [];
    const any = (chain: string[]) => chain.some((s) => { try { return !!doc.querySelector(s); } catch { return false; } });
    if (any(sel.challenge)) return { health: 'broken', checks: [{ name: 'challenge', ok: false, detail: '봇 확인 화면 — 직접 풀어 주세요' }], errorCode: 'CHALLENGE' };
    if (sel.loggedOutPath.some((re) => re.test(url.pathname)) || any(sel.loggedOut)) return { health: 'broken', checks: [{ name: 'logged_in', ok: false, detail: '로그인이 풀린 것 같아요' }], errorCode: 'LOGGED_OUT' };
    const sb = firstAll(doc, sel.sidebarLink);
    checks.push({ name: 'sidebar_selector', ok: sb.index >= 0, detail: sb.index > 0 ? `대체 선택자 ${sb.index + 1}번째 사용` : sb.index < 0 ? '사이드바 대화 링크를 못 찾음(닫혀 있을 수 있음)' : null });
    const inConv = !!detectConversation(url);
    if (inConv) {
      const m = firstAll(doc, sel.message);
      const roles = m.els.map(roleOf);
      // 2026-10-16: 대체 선택자로 상자는 찾았지만 역할을 하나도 못 읽으면 메시지를 못 찾은 것과 같다
      const noRoles = m.els.length > 0 && roles.every((r) => !r);
      checks.push({ name: 'message_selector', ok: m.index >= 0 && !noRoles, detail: noRoles ? '메시지 상자는 있으나 역할을 못 읽음' : m.index > 0 ? `대체 선택자 ${m.index + 1}번째 사용` : m.index < 0 ? '메시지를 못 찾음' : null });
      checks.push({ name: 'role_attribute', ok: m.els.length === 0 || roles.every(Boolean), detail: roles.some((r) => !r) ? '역할을 모르는 메시지가 있음' : null });
      checks.push({ name: 'stream_end_detect', ok: sel.streaming.length > 0, detail: null });
    }
    const msgBad = checks.find((c) => c.name === 'message_selector' && !c.ok);
    const degraded = checks.some((c) => !c.ok || (c.detail ?? '').includes('대체'));
    return { health: msgBad ? 'broken' : degraded ? 'degraded' : 'ok', checks, errorCode: msgBad ? 'SELECTOR_NOT_FOUND' : null };
  };

  /** 2026-10-16 진단: 메시지를 못 읽을 때 화면 구조 요약(개수·속성 이름·data-testid 모양만 — 대화 내용은 넣지 않음) */
  const diagnose = (doc: Document): Array<{ name: string; detail: string }> => {
    const n = (s: string) => { try { return doc.querySelectorAll(s).length; } catch { return -1; } };
    const probes = ['[data-chatgpt-search-unit-key]', '[data-turn-key]', '[data-user-message-bubble]', '[data-markdown-copy="contents"]', '[data-message-author-role]', '[data-message-id]', '[data-turn]', 'article', '[data-testid^="conversation-turn"]', '[data-testid="user-message-text"]', '[data-message-content]', 'main'];
    const counts = probes.map((p) => `${p}=${n(p)}`).join(' ');
    const root = doc.querySelector('main') ?? doc.body;
    const attrs = new Map<string, number>(); const tids = new Map<string, number>();
    for (const e of [...(root?.querySelectorAll('*') ?? [])].slice(0, 20000)) {
      for (const a of e.getAttributeNames()) if (a.startsWith('data-')) attrs.set(a, (attrs.get(a) ?? 0) + 1);
      const t = e.getAttribute('data-testid'); if (t) { const k = t.replace(/\d+/g, '#').slice(0, 40); tids.set(k, (tids.get(k) ?? 0) + 1); }
    }
    const top = (m: Map<string, number>, k: number) => [...m].sort((x, y) => y[1] - x[1]).slice(0, k).map(([a, c]) => `${a}:${c}`).join(',');
    return [{ name: 'diag_counts', detail: counts.slice(0, 480) }, { name: 'diag_data_attrs', detail: top(attrs, 25).slice(0, 480) }, { name: 'diag_testids', detail: top(tids, 20).slice(0, 480) }];
  };

  return { sourceAi, name, version, sel, detectConversation, readMessages, listSidebar, sidebarOpen, healthCheck, diagnose };
}

/** 추출 검증(설계서 5.4①-C). 문제 있으면 이유 문자열, 괜찮으면 null */
export function validateExtraction(r: ReadResult, url: URL, adapter: Adapter, previousCount: number | null): string | null {
  if (adapter.detectConversation(url) !== r.sourceId) return '대화 id가 주소와 다름';
  if (r.messages.length === 0) return '메시지 0개';
  const empty = r.messages.filter((m, i) => !m.contentMd.trim() && !(r.streaming && i === r.messages.length - 1));
  if (empty.length) return `빈 메시지 ${empty.length}개`;
  // 역할 교대: 같은 역할이 3번 넘게 이어지면 이상(도구·이어 쓰기 예외 허용)
  let run = 1;
  for (let i = 1; i < r.messages.length; i++) { run = r.messages[i]!.role === r.messages[i - 1]!.role ? run + 1 : 1; if (run > 3) return '역할 교대가 깨짐'; }
  if (previousCount !== null && previousCount >= 6 && r.messages.length < previousCount * 0.5) return `메시지 수 급감(${previousCount} → ${r.messages.length}) — 화면이 일부만 그렸을 수 있음`;
  return null;
}
