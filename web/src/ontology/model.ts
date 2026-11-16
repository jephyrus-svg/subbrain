import { tt, ttf } from '../i18n';
// 온톨로지 모드 시안의 데이터 모델 (설계서 8.2 객체 종류 · 8.3 관계 종류 · 8.7 질문).
// 1.7.0부터 데이터는 코어 GET /ontology(계약 §14.2, OntologyGraphResponse)에서 오고, fromApi()가 화면 모델(OData)로 바꾼다.
// 모의 모드도 같은 경로(공유 목 ontologyGraph.json = 이 시안 예시를 계약 모양으로 바꾼 것)를 쓴다.
import { accentOf } from '../design/tokens';
import type { OntologyEvidence, OntologyGraphResponse } from '@subbrain/shared';

export type ObjectType = 'project' | 'task' | 'decision' | 'tool' | 'topic' | 'person' | 'organization' | 'place' | 'artifact';
export type LinkType = 'uses' | 'decided' | 'blocked_by' | 'derived_from' | 'references' | 'part_of' | 'supersedes' | 'affects' | 'located_at' | 'related_to';
export type Status = 'accepted' | 'suggested' | 'rejected';
/** [AI, 날짜, 대화 제목, 발췌] */
export type Evidence = [string, string, string, string];

export interface OObject {
  id: string; type: ObjectType; name: string; aliases: string[]; status: Status; confidence: number;
  first: string; last: string; mentions: number; props: Record<string, string>; src: Evidence[];
  ref?: string; project?: string; color?: string; visual?: string; badge?: string;
}
export interface OLink {
  id: string; type: LinkType; src: string; dst: string; status: Status; conf: number; n: number;
  ended?: string; ev?: Evidence; origin?: string;
}
export interface OSuggestion { id: string; kind: 'link' | 'merge' | 'object'; link?: string; a?: string; b?: string; obj?: string; conf?: number; note?: string; ev?: Evidence; text?: string }
export interface OData { today: string; objects: OObject[]; links: OLink[]; suggestions: OSuggestion[] }

// 설계서 8.2 순서 대신 화면 필터 순서(자주 보는 것 먼저)
export const OBJECT_TYPES: ObjectType[] = ['project', 'task', 'decision', 'tool', 'topic', 'person', 'organization', 'place', 'artifact'];
export const TYPE_META: Record<ObjectType, { label: string; short: string; tint: string }> = {
  project: { label: tt("프로젝트"), short: tt("프로젝트"), tint: '#D08A66' },
  task: { label: tt("과제"), short: tt("과제"), tint: '#8FB59A' },
  decision: { label: tt("결정"), short: tt("결정"), tint: '#EDEDEB' },
  tool: { label: tt("도구/기술"), short: tt("도구"), tint: '#7F9CC4' },
  topic: { label: tt("주제"), short: tt("주제"), tint: '#6E6E6B' },
  person: { label: tt("사람"), short: tt("사람"), tint: '#D3B060' },
  organization: { label: tt("조직"), short: tt("조직"), tint: '#B293AE' },
  place: { label: tt("장소"), short: tt("장소"), tint: '#8FB59A' },
  artifact: { label: tt("파일/자료"), short: tt("자료"), tint: '#C4C2BC' },
};

// 설계서 10.2.6 관계 색·선 모양
export const LINK_TYPES: LinkType[] = ['blocked_by', 'affects', 'decided', 'derived_from', 'uses', 'references', 'supersedes', 'located_at', 'part_of', 'related_to'];
export const LINK_META: Record<LinkType, { label: string; color: string; dash?: string; arrow: boolean; w: number; directed: boolean }> = {
  uses: { label: tt("사용함"), color: '#7F9CC4', arrow: false, w: 1.15, directed: true },
  decided: { label: tt("결정함"), color: '#D3B060', arrow: false, w: 1.15, directed: true },
  blocked_by: { label: tt("막혔음"), color: '#D08A66', dash: '4 3', arrow: true, w: 1.35, directed: true },
  derived_from: { label: tt("파생함"), color: '#B293AE', arrow: true, w: 1.15, directed: true },
  references: { label: tt("참고함"), color: '#7F9CC4', arrow: false, w: 0.8, directed: true },
  part_of: { label: tt("속함"), color: '#4A4A48', arrow: false, w: 0.85, directed: true },
  supersedes: { label: tt("대체함"), color: '#CF6F6A', arrow: true, w: 1.15, directed: true },
  affects: { label: tt("영향 줌"), color: '#8FB59A', arrow: true, w: 1.2, directed: true },
  located_at: { label: tt("위치함"), color: '#8FB59A', arrow: false, w: 0.8, directed: true },
  related_to: { label: tt("관련 있음"), color: '#6E6E6B', dash: '1.5 3', arrow: false, w: 0.8, directed: false },
};
export const DEFAULT_LINK_TYPES: LinkType[] = LINK_TYPES.filter((t) => t !== 'related_to');
/** 제안 상태 관계의 선 모양 (색은 같고 40% 투명도) */
export const SUGGEST_DASH = '6 4';

const day = (iso: string | null | undefined) => (iso ?? '').slice(0, 10);
const evT = (e: OntologyEvidence | null | undefined): Evidence | undefined => (e ? [e.sourceAi, day(e.at), e.conversationTitle, e.excerpt] : undefined);
const KNOWN_LINKS = new Set<string>(['uses', 'decided', 'blocked_by', 'derived_from', 'references', 'part_of', 'supersedes', 'affects', 'located_at', 'related_to']);

/** 계약 응답 → 화면 모델. merged·rejected 객체와 그 관계는 그리지 않는다 */
export function fromApi(r: OntologyGraphResponse): OData {
  const objects: OObject[] = r.objects.filter((o) => o.status !== 'merged' && o.status !== 'rejected').map((o) => ({
    id: o.id, type: o.type as ObjectType, name: o.name, aliases: o.aliases ?? [], status: o.status as Status, confidence: o.confidence ?? 1,
    first: day(o.firstSeenAt), last: day(o.lastSeenAt), mentions: o.mentionCount,
    props: Object.fromEntries(Object.entries(o.properties ?? {}).map(([k, v]) => [k, String(v)])),
    src: [...(o.evidencePreview ?? [])].sort((a, b) => a.at.localeCompare(b.at)).map(evT).filter((e): e is Evidence => !!e),
    ref: o.ref?.table === 'topics' ? undefined : o.ref?.id, project: o.projectObjectId ?? undefined, color: o.colorHex ? accentOf(o.colorHex) : undefined,
    visual: o.statusVisual ?? undefined, badge: o.badge ?? undefined,
  }));
  const ids = new Set(objects.map((o) => o.id));
  const links: OLink[] = r.links.filter((l) => ids.has(l.srcId) && ids.has(l.dstId) && KNOWN_LINKS.has(l.type) && (l.status as string) !== 'rejected').map((l) => ({
    id: l.id, type: l.type as LinkType, src: l.srcId, dst: l.dstId, status: (l.status as Status) ?? 'accepted', conf: l.confidence ?? 1, n: l.mentionCount || 1,
    ended: l.endedAt ? day(l.endedAt) : undefined, ev: evT(l.evidencePreview), origin: l.origin,
  }));
  const suggestions: OSuggestion[] = r.suggestions.filter((s) => !s.state || s.state === 'pending').map((s) => {
    const e = s.evidence?.[0];
    const ev: Evidence | undefined = e ? [e.sourceAi, day(e.at), '', e.excerpt] : undefined;
    const base = { id: s.id, conf: s.confidence, note: s.note ?? undefined, ev, text: s.text };
    if (s.kind === 'merge') return { ...base, kind: 'merge' as const, a: s.merge?.keepId ?? s.src?.id, b: s.merge?.mergeId ?? s.dst?.id };
    if (s.kind === 'object') return { ...base, kind: 'object' as const, obj: s.objectId ?? s.src?.id ?? undefined };
    return { ...base, kind: 'link' as const, link: s.linkId ?? undefined };
  });
  return { today: r.today, objects, links, suggestions };
}

// ── 사용자가 내린 제안 결정 (시안: 메모리에만, 새로고침하면 처음으로) ──
export type Verdict = 'accepted' | 'rejected' | 'later';
export function applyVerdicts(d: OData, v: Record<string, Verdict>): OData {
  const linkStatus = new Map<string, Status>();
  const objStatus = new Map<string, Status>();
  const merged = new Map<string, string>();
  for (const s of d.suggestions) {
    const x = v[s.id]; if (!x || x === 'later') continue;
    if (s.kind === 'link' && s.link) {
      linkStatus.set(s.link, x);
      const l = d.links.find((k) => k.id === s.link);
      // 처음 보는 객체(제안 상태)는 관계와 함께 확정/거절
      if (l) for (const id of [l.src, l.dst]) if (d.objects.find((o) => o.id === id)?.status === 'suggested') objStatus.set(id, x);
    }
    if (s.kind === 'merge' && s.a && s.b) { if (x === 'accepted') merged.set(s.b, s.a); }
    if (s.kind === 'object' && s.obj) objStatus.set(s.obj, x);
  }
  const objects = d.objects.filter((o) => !merged.has(o.id)).map((o) => {
    const into = [...merged].filter(([, a]) => a === o.id).map(([b]) => d.objects.find((k) => k.id === b)).filter((k): k is OObject => !!k);
    const st = objStatus.get(o.id);
    return into.length || st ? { ...o, status: st ?? o.status, aliases: [...o.aliases, ...into.map((k) => k.name)], src: [...o.src, ...into.flatMap((k) => k.src)], mentions: o.mentions + into.reduce((s, k) => s + k.mentions, 0) } : o;
  });
  const links = d.links.map((l) => ({ ...l, src: merged.get(l.src) ?? l.src, dst: merged.get(l.dst) ?? l.dst, status: linkStatus.get(l.id) ?? l.status }));
  return { ...d, objects, links };
}

// ── 그래프 질문 (8.7) ──
export class OGraph {
  byId: Map<string, OObject>;
  out = new Map<string, OLink[]>();
  inn = new Map<string, OLink[]>();
  constructor(public d: OData, public links: OLink[]) {
    this.byId = new Map(d.objects.map((o) => [o.id, o]));
    for (const l of links) {
      (this.out.get(l.src) ?? this.out.set(l.src, []).get(l.src)!).push(l);
      (this.inn.get(l.dst) ?? this.inn.set(l.dst, []).get(l.dst)!).push(l);
    }
  }
  all(id: string): OLink[] { return [...(this.out.get(id) ?? []), ...(this.inn.get(id) ?? [])]; }
  other(l: OLink, id: string) { return l.src === id ? l.dst : l.src; }

  /** depth 단계 이웃 (보이는 관계 전부) */
  neighborhood(id: string, depth: number): { nodes: Set<string>; links: Set<string> } {
    const nodes = new Set([id]); const links = new Set<string>(); let front = [id];
    for (let k = 0; k < depth; k++) {
      const next: string[] = [];
      for (const n of front) for (const l of this.all(n)) {
        links.add(l.id); const o = this.other(l, n);
        if (!nodes.has(o)) { nodes.add(o); next.push(o); }
      }
      front = next;
    }
    // 바깥 고리끼리 이어진 선도 함께
    for (const l of this.links) if (nodes.has(l.src) && nodes.has(l.dst)) links.add(l.id);
    return { nodes, links };
  }

  /** 두 객체 사이 가장 짧은 관계 경로 (최대 4단계, 확정·진행 중인 관계 먼저) */
  path(a: string, b: string, max = 4): OLink[] | null {
    const tryWith = (ok: (l: OLink) => boolean, lim: number) => {
      const prev = new Map<string, OLink | null>([[a, null]]); let front = [a];
      for (let k = 0; k < lim && front.length; k++) {
        const next: string[] = [];
        for (const n of front) for (const l of this.all(n)) {
          if (!ok(l)) continue; const o = this.other(l, n);
          if (prev.has(o)) continue; prev.set(o, l); next.push(o);
          if (o === b) { const out: OLink[] = []; let c = b; while (c !== a) { const e = prev.get(c)!; out.unshift(e); c = this.other(e, c); } return out; }
        }
        front = next;
      }
      return null;
    };
    return tryWith((l) => l.status === 'accepted' && !l.ended, max) ?? tryWith((l) => l.status !== 'rejected', max) ?? tryWith((l) => l.status !== 'rejected', 6);
  }

  /** 왜 멈췄나: blocked_by 재귀 (최대 5단계) */
  whyStalled(id: string): { chain: Array<{ link: OLink; depth: number }>; pending: OLink[]; ended: OLink[] } {
    const chain: Array<{ link: OLink; depth: number }> = []; const seen = new Set([id]);
    const walk = (n: string, depth: number) => {
      if (depth > 5) return;
      for (const l of this.out.get(n) ?? []) {
        if (l.type !== 'blocked_by' || l.status !== 'accepted' || l.ended || seen.has(l.dst)) continue;
        seen.add(l.dst); chain.push({ link: l, depth }); walk(l.dst, depth + 1);
      }
    };
    walk(id, 1);
    const mine = (this.out.get(id) ?? []).filter((l) => l.type === 'blocked_by');
    return { chain, pending: mine.filter((l) => l.status === 'suggested'), ended: mine.filter((l) => l.status === 'accepted' && !!l.ended) };
  }

  /** 영향 범위: 이게 바뀌면 흔들리는 것 (affects →, ← derived_from, ← blocked_by, ← uses, ← references), 최대 3단계 */
  impact(id: string): Array<{ link: OLink; obj: OObject; depth: number }> {
    const out: Array<{ link: OLink; obj: OObject; depth: number }> = []; const seen = new Set([id]); let front = [id];
    for (let depth = 1; depth <= 3 && front.length; depth++) {
      const next: string[] = [];
      for (const n of front) {
        const cand: Array<[OLink, string]> = [];
        for (const l of this.out.get(n) ?? []) if (l.type === 'affects') cand.push([l, l.dst]);
        for (const l of this.inn.get(n) ?? []) if (l.type === 'derived_from' || l.type === 'blocked_by' || l.type === 'uses' || l.type === 'references') cand.push([l, l.src]);
        for (const [l, o] of cand) {
          if (l.status === 'rejected' || seen.has(o)) continue;
          const obj = this.byId.get(o); if (!obj) continue;
          seen.add(o); out.push({ link: l, obj, depth }); next.push(o);
        }
      }
      front = next;
    }
    return out;
  }

  /** 비슷한 옛 작업: 같은 도구·주제·조직·자료·장소·사람·결정을 공유하는 다른 과제 (완료된 것에 가중치) */
  similar(id: string): Array<{ obj: OObject; shared: OObject[]; score: number }> {
    const me = this.byId.get(id); if (!me) return [];
    const feats = (n: string) => new Set(this.all(n).filter((l) => l.type !== 'part_of' && l.status !== 'rejected').map((l) => this.other(l, n)).filter((o) => { const t = this.byId.get(o)?.type; return t && t !== 'task' && t !== 'project'; }));
    let mine = feats(id);
    if (me.type !== 'task') mine = new Set([id, ...mine]);
    const res: Array<{ obj: OObject; shared: OObject[]; score: number }> = [];
    for (const o of this.d.objects) {
      if (o.type !== 'task' || o.id === id) continue;
      const f = feats(o.id); if (me.type !== 'task' && this.all(o.id).some((l) => this.other(l, o.id) === id)) f.add(id);
      const shared = [...f].filter((x) => mine.has(x)).map((x) => this.byId.get(x)!).filter(Boolean);
      if (!shared.length) continue;
      res.push({ obj: o, shared, score: shared.length + (o.visual === 'done' ? 0.6 : 0) });
    }
    return res.sort((a, b) => b.score - a.score || a.obj.name.localeCompare(b.obj.name)).slice(0, 5);
  }
}

/** 16주 언급 막대 (출처 날짜 + 처음/마지막 언급 사이에 언급 수를 고르게 나눈 예시값) */
export function weeklyMentions(o: OObject, today: string, weeks = 16): number[] {
  const t = Date.parse(today); const out = new Array<number>(weeks).fill(0);
  const wk = (iso: string) => weeks - 1 - Math.floor((t - Date.parse(iso)) / (7 * 86400000));
  const a = Math.max(0, wk(o.first)), b = Math.min(weeks - 1, Math.max(a, wk(o.last)));
  let left = o.mentions;
  for (const e of o.src) { const i = wk(e[1]); if (i >= 0 && i < weeks && left > 0) { out[i]! += 1; left--; } }
  let seed = [...o.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  while (left > 0 && b >= a) { const i = a + Math.floor(rnd() * (b - a + 1)); out[i]! += 1; left--; }
  return out;
}
