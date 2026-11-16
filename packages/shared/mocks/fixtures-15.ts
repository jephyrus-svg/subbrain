/// <reference path="./node-fs.d.ts" />
/**
 * 1.5.0 계약 예시 — 온톨로지(Phase 1.5) · 확장 수집(Phase 3) · 로컬 세션 수집기.
 * 온톨로지 예시는 웹 시안 목(web/src/mocks/ontology.json, 손으로 쓴 예시)을 **계약 모양으로 바꾼 것**이다
 * — 같은 데이터가 두 모양으로 있으니 웹은 필드 이름만 옮기면 된다(차이 목록: API_CONTRACT §14.2 · docs/contracts-1.5-summary.md).
 */
import { readFileSync } from 'node:fs';
import type {
  AcceptSuggestionResponse, AdapterHealthBody, AdapterHealthResponse, BulkAcceptSuggestionsResponse, CatchupDiffBody, CatchupDiffResponse,
  CollectorStatus, CompletePairingBody, CompletePairingResponse, GraphPathResponse, ImpactResponse, IngestReplayResponse, IngestSnapshotBody,
  IngestSnapshotResponse, LinkType, MergeSuggestion, ObjectDetail, ObjectRef, ObjectType, OntologyEvidence, OntologyGraphResponse, OntologyLink,
  OntologyObject, OntologySuggestion, PutCollectorConfigBody, SimilarResponse, SourceAi, StartPairingResponse, StatusVisual, SyncStateResponse, WhyStalledResponse,
} from '../src/api-types.ts';

// ── 웹 목 → 계약 모양
interface WebObj { id: string; type: string; name: string; aliases?: string[]; status?: string; confidence?: number; first: string; last: string; mentions: number; props?: Record<string, string>; src?: string[][]; ref?: string; project?: string; color?: string; visual?: string; badge?: string }
interface WebLink { id: string; type: string; src: string; dst: string; status?: string; conf: number; n?: number; ended?: string; ev?: string[]; origin?: string }
interface WebSug { id: string; kind: 'link' | 'merge'; link?: string; a?: string; b?: string; conf?: number; note?: string; ev?: string[] }
const web = JSON.parse(readFileSync(new URL('../../../web/src/mocks/ontology.json', import.meta.url), 'utf8')) as { meta: { today: string }; objects: WebObj[]; links: WebLink[]; suggestions: WebSug[] };
const at = (d: string) => `${d}T12:00:00+09:00`;
let evId = 1;
const ev = (t: string[] | undefined, conf: number | null = null): OntologyEvidence | null => t && t.length >= 4
  ? { id: evId++, conversationId: `conv_${t[0]}_ex${String(evId).padStart(3, '0')}`, sourceAi: t[0] as SourceAi, conversationTitle: t[2]!, messageSeq: null, excerpt: t[3]!, at: at(t[1]!), confidence: conf, model: conf === null ? null : 'gemini-3.8-flash' }
  : null;
const refOf = (r: string | undefined): OntologyObject['ref'] => !r ? null : r.startsWith('task_') ? { table: 'tasks', id: r } : r.startsWith('prj_') ? { table: 'projects', id: r } : { table: 'topics', id: r };
const objects: OntologyObject[] = web.objects.map((o) => {
  const evs = (o.src ?? []).map((t) => ev(t)).filter((e): e is OntologyEvidence => !!e);
  return {
    id: o.id, type: o.type as ObjectType, name: o.name, aliases: o.aliases ?? [], status: (o.status as OntologyObject['status']) ?? 'accepted',
    confidence: o.confidence ?? 0.9, origin: o.ref ? 'rule' : 'llm', firstSeenAt: at(o.first), lastSeenAt: at(o.last), mentionCount: o.mentions,
    properties: o.props ?? {}, ref: refOf(o.ref), projectObjectId: o.project ?? (o.type === 'project' ? null : null), colorHex: (o.color as `#${string}`) ?? null,
    statusVisual: (o.visual as StatusVisual) ?? null, badge: o.badge ?? null, mergedInto: null, evidencePreview: evs.slice(-3).reverse(),
  };
});
const byId = new Map(objects.map((o) => [o.id, o]));
const ref = (id: string): ObjectRef => { const o = byId.get(id)!; return { id, type: o.type, label: o.name }; };
const links: OntologyLink[] = web.links.map((l) => {
  const e = ev(l.ev, l.conf);
  const first = e?.at ?? byId.get(l.src)!.firstSeenAt;
  return {
    id: l.id, type: l.type as LinkType, srcId: l.src, dstId: l.dst, status: (l.status as OntologyLink['status']) ?? 'accepted', confidence: l.conf,
    origin: (l.origin as OntologyLink['origin']) ?? 'llm', mentionCount: l.n ?? 1, validFrom: first, endedAt: l.ended ? at(l.ended) : null,
    firstSeenAt: first, lastSeenAt: e?.at ?? byId.get(l.src)!.lastSeenAt, properties: {}, evidencePreview: e,
  };
});
const linkById = new Map(links.map((l) => [l.id, l]));
const LABEL: Record<LinkType, string> = { uses: '사용함', decided: '결정함', blocked_by: '막혔음', derived_from: '파생함', references: '참고함', part_of: '속함', supersedes: '대체함', affects: '영향 줌', located_at: '위치함', related_to: '관련 있음' };
const TYPE_KO: Record<ObjectType, string> = { person: '사람', project: '프로젝트', task: '과제', decision: '결정', tool: '도구', artifact: '자료', place: '장소', organization: '조직', topic: '주제' };
const suggestions: OntologySuggestion[] = web.suggestions.map((s) => {
  if (s.kind === 'merge') {
    const a = ref(s.a!), b = ref(s.b!), e = ev(s.ev, s.conf ?? null);
    return { id: s.id, kind: 'merge', confidence: s.conf ?? 0.7, text: `[${TYPE_KO[a.type]}] ${a.label} ＝ [${TYPE_KO[b.type]}] ${b.label} 합치기`, linkType: null, src: a, dst: b,
      evidenceCount: e ? 1 : 0, evidence: e ? [{ conversationId: e.conversationId, sourceAi: e.sourceAi, excerpt: e.excerpt, at: e.at }] : [],
      state: 'pending', linkId: null, objectId: null, merge: { keepId: a.id, mergeId: b.id }, reason: 'merge_candidate', note: s.note ?? null, createdAt: at(web.meta.today) };
  }
  const l = linkById.get(s.link!)!, a = ref(l.srcId), b = ref(l.dstId), e = l.evidencePreview;
  const person = [a, b].some((x) => x.type === 'person' && byId.get(x.id)!.status === 'suggested') || /사람/.test(s.note ?? '');
  return { id: s.id, kind: 'link', confidence: l.confidence ?? 0.7, text: `[${TYPE_KO[a.type]}] ${a.label} —${LABEL[l.type]}→ [${TYPE_KO[b.type]}] ${b.label}`, linkType: l.type, src: a, dst: b,
    evidenceCount: e ? 1 : 0, evidence: e ? [{ conversationId: e.conversationId, sourceAi: e.sourceAi, excerpt: e.excerpt, at: e.at }] : [],
    state: 'pending', linkId: l.id, objectId: null, merge: null, reason: l.type === 'supersedes' ? 'supersedes' : person ? 'first_seen_person' : 'mid_confidence', note: s.note ?? null, createdAt: at(web.meta.today) };
});

// ── 14.2 온톨로지
export const ontologyGraph: OntologyGraphResponse = {
  today: web.meta.today, objects: objects.filter((o) => o.status !== 'rejected'), links: links.filter((l) => l.status !== 'rejected'), suggestions,
  counts: { objects: objects.length, links: links.length, pendingSuggestions: suggestions.length, hiddenSingleMention: 0 }, truncated: false,
};
const copy = byId.get('obj_task_copy')!;
const copyLinks = links.filter((l) => l.srcId === copy.id || l.dstId === copy.id);
export const objectDetail: ObjectDetail = {
  object: copy,
  links: copyLinks.map((l) => { const out = l.srcId === copy.id; const o = byId.get(out ? l.dstId : l.srcId)!; return { ...l, direction: out ? 'out' : 'in', other: { id: o.id, type: o.type, label: o.name, status: o.status } }; }),
  evidence: copy.evidencePreview, evidenceTotal: copy.evidencePreview.length,
  mentionsByWeek: [{ week: '2026-08-24', count: 5 }, { week: '2026-08-31', count: 2 }, { week: '2026-09-07', count: 4 }, { week: '2026-09-14', count: 3 }, { week: '2026-09-21', count: 0 }, { week: '2026-09-28', count: 0 }],
  relatedTasks: [{ id: 'task_20260830_01', title: '메인 페이지 카피 확정', status: '멈춤', statusVisual: 'stall', staleDays: 14, projectId: 'prj_blog' }],
};
const blk = links.filter((l) => l.srcId === copy.id && l.type === 'blocked_by');
export const whyStalled: WhyStalledResponse = {
  taskId: 'task_20260830_01', objectId: copy.id, task: { status: '멈춤', staleDays: 14 },
  chain: blk.filter((l) => l.status === 'accepted' && !l.endedAt).map((l) => { const o = byId.get(l.dstId)!; return { depth: 1, link: l, object: { id: o.id, type: o.type, label: o.name, status: o.status, taskStatus: o.type === 'task' ? '진행 중' : null } }; }),
  rootCauses: blk.filter((l) => l.status === 'accepted' && !l.endedAt).map((l) => { const o = byId.get(l.dstId)!; return { object: { id: o.id, type: o.type, label: o.name }, kind: o.type === 'person' ? 'waiting_person' : o.type === 'decision' ? 'undecided' : o.type === 'task' ? 'blocked_task' : 'other', label: `${o.name} 기다리는 중` }; }),
  ended: blk.filter((l) => l.endedAt), suggested: blk.filter((l) => l.status === 'suggested'),
  lastConversation: { id: 'conv_chatgpt_ex003', title: '디자이너 회신 전 정리', sourceAi: 'chatgpt', at: '2026-09-16T12:00:00+09:00' },
  explanation: `‘${blk.map((l) => byId.get(l.dstId)!.name)[0] ?? '?'}’ 때문에 14일째 멈춤`,
};
const dec = objects.find((o) => o.type === 'decision')!;
export const impact: ImpactResponse = {
  objectId: dec.id,
  affected: links.filter((l) => l.srcId === dec.id && (l.type === 'affects' || l.type === 'derived_from')).map((l) => ({ object: ref(l.dstId), via: [l.type], depth: 1, superseded: false })),
  supersededBy: null,
};
export const similar: SimilarResponse = { items: [{ task: { id: 'task_20260830_01', title: '메인 페이지 카피 확정', status: '멈춤', statusVisual: 'stall', staleDays: 14, projectId: 'prj_blog' }, score: 0.62, sharedObjects: [ref(copy.id)], decisions: ['카피 톤은 존댓말'], blockers: ['디자이너 답변 대기'], completedAt: null }] };
const p = links.find((l) => l.srcId === copy.id)!;
export const graphPath: GraphPathResponse = { found: true, objects: [ref(p.srcId), ref(p.dstId)], links: [p], usedSuggested: false };
export const suggestionsList = { items: suggestions, total: suggestions.length, nextCursor: null };
const s0 = suggestions.find((s) => s.kind === 'link')!;
export const acceptSuggestion: AcceptSuggestionResponse = { suggestion: { ...s0, state: 'accepted' }, objects: [], links: [{ ...linkById.get(s0.linkId!)!, status: 'accepted' }], eventId: 9001 };
export const bulkAcceptSuggestions: BulkAcceptSuggestionsResponse = { accepted: suggestions.filter((s) => s.reason === 'mid_confidence' && s.confidence >= 0.8).map((s) => s.id), skipped: suggestions.filter((s) => s.reason !== 'mid_confidence').map((s) => ({ id: s.id, reason: 'protected' as const })) };

// ── 14.3 확장 수집
export const startPairing: StartPairingResponse = { pairingId: 'pair_7Q2M', code: '418 207', expiresAt: '2026-09-30T08:35:00+09:00', kind: 'extension' };
export const completePairingBody: CompletePairingBody = { code: '418207', client: { kind: 'extension', name: 'SubBrain Chrome', version: '0.3.0', extensionId: 'abcdefghijklmnopabcdefghijklmnop' } };
export const completePairing: CompletePairingResponse = {
  token: 'sbt_EXAMPLE_ONLY_not_a_real_token_000000',
  client: { tokenId: 'pat_k3f9', kind: 'extension', name: 'SubBrain Chrome', extensionId: 'abcdefghijklmnopabcdefghijklmnop', scopes: ['ingest'], createdAt: '2026-09-30T08:31:10+09:00', lastUsedAt: null, rotatedAt: null, revokedAt: null },
};
export const ingestSnapshotBody: IngestSnapshotBody = {
  sourceAi: 'chatgpt', sourceId: '68f2a91c-1d2e-4b7a-9c3f-0a1b2c3d4e5f', url: 'https://chatgpt.com/c/68f2a91c-1d2e-4b7a-9c3f-0a1b2c3d4e5f', title: '메인 카피 후보 뽑기',
  capturedAt: '2026-09-30T08:20:41+09:00', serviceUpdatedAt: '2026-09-30T08:20:30+09:00', captureMethod: 'extension_live', mode: 'append', appendFromSeq: 6,
  baseContentHash: '9b1c…(이전 응답 contentHash)',
  messages: [
    { seq: 6, externalId: 'msg_aa01', role: 'user', contentMd: '후보 B를 조금 더 짧게 해 줘', createdAt: '2026-09-30T08:20:02+09:00' },
    { seq: 7, externalId: 'msg_aa02', role: 'assistant', contentMd: '좋아요. 12자 안으로 줄인 안: …', createdAt: '2026-09-30T08:20:30+09:00' },
  ],
  contentHash: '4e07…(전체 8개 메시지 기준)', complete: true, adapter: { name: 'chatgpt-dom', version: '0.3.0', domVersion: '2026-09' }, project: null,
};
export const ingestSnapshotAccepted: IngestSnapshotResponse = { status: 'accepted', idempotencyKey: 'chatgpt:68f2a91c-1d2e-4b7a-9c3f-0a1b2c3d4e5f:4e07…', conversationId: 'conv_chatgpt_68f2a91c', taskId: 'task_20260830_01', contentHash: '4e07…', messageCount: 8, classification: 'debounced', receivedAt: '2026-09-30T08:20:41+09:00' };
export const ingestSnapshotDuplicate: IngestSnapshotResponse = { ...ingestSnapshotAccepted, status: 'duplicate', classification: 'not_needed' };
export const ingestReplay: IngestReplayResponse = { results: [
  { index: 0, ok: true, result: { ...ingestSnapshotAccepted, status: 'stale', classification: 'not_needed' } },
  { index: 1, ok: false, error: { error: { code: 'CONFLICT', message: '서버에 있는 내용과 이어 붙일 수 없어요. 전체(full)로 다시 보내 주세요.', details: { reason: 'BASE_MISMATCH', expectedContentHash: '4e07…' }, requestId: 'req_01JA0001' } } },
] };
export const catchupDiffBody: CatchupDiffBody = { sourceAi: 'claude', items: [
  { sourceId: 'c1a0de01-0000-4000-8000-000000000001', title: 'Gemini 팟캐스트 자막 변환 도구 개발', updatedAt: '2026-09-29T23:10:00+09:00' },
  { sourceId: 'c1a0de02-0000-4000-8000-000000000002', title: '독서 모임 공지 초안', updatedAt: '2026-09-12T10:00:00+09:00' },
  { sourceId: '77aa0000-0000-4000-8000-000000000003', title: '새 대화', updatedAt: null },
], cursor: null, endOfList: false };
export const catchupDiff: CatchupDiffResponse = { fetch: [{ sourceId: 'c1a0de01-0000-4000-8000-000000000001', reason: 'updated' }, { sourceId: '77aa0000-0000-4000-8000-000000000003', reason: 'new' }], skipped: 1, cursor: 'cur_claude_20260930T0821', stopBefore: '2026-09-12T10:00:00+09:00', rate: { maxFetchPerMinute: 6, nextScanAfter: '2026-09-30T08:51:00+09:00' } };
export const adapterHealthBody: AdapterHealthBody = { adapter: { name: 'claude-dom', version: '0.3.0', domVersion: '2026-09' }, health: 'degraded', checks: [{ name: 'sidebar_selector', ok: true }, { name: 'message_selector', ok: true }, { name: 'stream_end_detect', ok: false, detail: '응답 끝 표시를 못 찾아 120초 대기로 판단' }], errorCode: null, at: '2026-09-30T08:22:00+09:00', bufferedSnapshots: 0 };
const syncClaude = { sourceAi: 'claude' as const, cursor: 'cur_claude_20260930T0821', lastScanAt: '2026-09-30T08:21:00+09:00', lastSnapshotAt: '2026-09-30T08:20:41+09:00', knownConversations: 29, pendingFetch: 2, health: 'degraded' as const, healthAt: '2026-09-30T08:22:00+09:00', adapter: { name: 'claude-dom', version: '0.3.0' }, errorCode: null, bufferedSnapshots: 0 };
export const syncState: SyncStateResponse = { sources: [syncClaude, { sourceAi: 'chatgpt', cursor: null, lastScanAt: null, lastSnapshotAt: '2026-09-30T08:20:41+09:00', knownConversations: 412, pendingFetch: 0, health: 'ok', healthAt: '2026-09-30T08:19:00+09:00', adapter: { name: 'chatgpt-dom', version: '0.3.0' }, errorCode: null, bufferedSnapshots: 0 }] };
export const adapterHealth: AdapterHealthResponse = { recorded: true, state: syncClaude, collection: { sourceAi: 'claude', methods: ['extension_live', 'extension_catchup', 'export'], methodLabel: '확장 프로그램', lastCapturedAt: '2026-09-30T08:20:41+09:00', health: 'degraded', message: '응답 끝 표시를 못 찾음 — 120초 대기로 저장 중' } };

// ── 12.10 로컬 세션 수집기
export const putCollectorConfigBody: PutCollectorConfigBody = { enabled: true, sources: [{ sourceAi: 'claude-code', root: '~/.claude/projects', enabled: true }, { sourceAi: 'codex', root: '~/.codex/sessions', enabled: true }] };
export const collectorStatus: CollectorStatus = {
  config: { enabled: true, sources: putCollectorConfigBody.sources!, pollIntervalSec: 20, toolOutputMaxChars: 600, toolInputMaxChars: 300, excludeCwdPatterns: [], classify: true },
  watching: true, redactedSecrets: 7,
  sources: [
    { sourceAi: 'claude-code', root: '/Users/me/.claude/projects', rootExists: true, enabled: true, files: 21, bytesTotal: 154109552, bytesIngested: 154109552, sessions: 17, lastScanAt: '2026-09-30T08:29:40+09:00', lastIngestAt: '2026-09-30T08:12:03+09:00', backfill: { state: 'done', startedAt: '2026-09-30T08:00:00+09:00', finishedAt: '2026-09-30T08:00:41+09:00', filesDone: 21, filesTotal: 21, jobId: 'job_cb01' }, errors: [] },
    { sourceAi: 'codex', root: '/Users/me/.codex/sessions', rootExists: true, enabled: true, files: 92, bytesTotal: 1589240949, bytesIngested: 1201333002, sessions: 61, lastScanAt: '2026-09-30T08:29:40+09:00', lastIngestAt: '2026-09-30T08:29:12+09:00', backfill: { state: 'running', startedAt: '2026-09-30T08:00:00+09:00', finishedAt: null, filesDone: 70, filesTotal: 92, jobId: 'job_cb02' }, errors: [{ file: '2026/07/14/rollout-…-01a0.jsonl', message: '마지막 줄이 아직 덜 써짐 — 다음 검사에서 이어 읽음', at: '2026-09-30T08:29:12+09:00' }] },
  ],
};
export const handoffMergeSuggestion: MergeSuggestion = {
  id: 'ms_hs01', state: 'pending', confidence: 0.81, kind: 'handoff_session',
  reason: '‘Claude Code에서 이어감’으로 끝난 대화 → 18분 뒤 같은 프로젝트 폴더(blog-renewal)의 Claude Code 세션',
  tasks: [
    { id: 'task_20260915_01', title: '노트 형식 정리', status: '진행 중', statusVisual: 'run', staleDays: null, projectId: 'prj_subbrain', sourceAis: ['claude'] },
    { id: 'task_20260915_07', title: 'blog-renewal: md 노트 변환 스크립트', status: '진행 중', statusVisual: 'run', staleDays: null, projectId: null, sourceAis: ['claude-code'] },
  ],
  suggestedPrimaryTaskId: 'task_20260915_01', createdAt: '2026-09-15T22:40:00+09:00', decidedAt: null,
  handoff: { fromConversationId: 'conv_claude_5e1d', sessionConversationId: 'conv_claude-code_28327da6', target: 'Claude Code', gapMinutes: 18, textSimilarity: 0.34, projectMatch: 'cwd_name', explicitRef: false, cwd: '/Users/me/dev/blog-renewal', score: 0.81 },
};
