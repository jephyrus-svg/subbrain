/**
 * Phase 7 (계약 1.5.0)
 *  A. 대화 결과 → 과제 상태(주 대화 모두 done·moved → 완료/done·moved), 보드 간단한 질문 열 items, TaskDetail 대화 결과, 라벨 저장
 *  B. 로컬 세션 수집기: Claude Code·Codex 파서(실제 표본 모양의 합성 줄), 이어 읽기·덜 써진 줄·교체, 하위 에이전트 합치기,
 *     주입 블록 제거, 도구 출력 줄이기, 비밀 가림(저장 전), 넘겨준 대화 ↔ 세션 합치기 제안, 수락 후 상태, 엔드포인트
 */
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as S from '@subbrain/shared/schemas';
import type { LlmClassification } from '@subbrain/shared/schemas';
import { makeCore, NOW } from './helpers.ts';
import { computeStatus } from '../src/rules/rules.ts';
import { DEFAULT_THRESHOLDS } from '@subbrain/shared/constants';
import { feed, finalMessages, newState, sessionTitle, stripInjected } from '../src/collector/parsers.ts';
import { putCollectorConfig, scanSource } from '../src/collector/collector.ts';
import { redactSecrets } from '../src/classifier/redact.ts';
import { classifyConversation } from '../src/services/classify.ts';
import { upsertConversation } from '../src/services/imports.ts';
import { loadTask, toListItem } from '../src/services/tasks.ts';
import type { Classifier } from '../src/classifier/provider.ts';

type T = Awaited<ReturnType<typeof makeCore>>;
let t: T;
beforeEach(async () => { t = await makeCore(); });
afterEach(() => t.close());

// 실제 키처럼 보이는 가짜 값(런타임에 조립)
const FAKE = (p: string, n = 40) => p + 'Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0LmNbVcXz'.repeat(2).slice(0, n);
const iso = (min: number) => new Date(Date.parse(NOW) + min * 60_000).toISOString();
const J = (o: unknown) => JSON.stringify(o) + '\n';

function fake(partial: Partial<LlmClassification>): Classifier {
  return { name: 'fake', model: 'fake-llm', isLlm: true,
    async classify() { return { output: S.LlmClassificationSchema.parse({ kind: 'task', resolution: 'unresolved', summary: '요약', confidence: 0.8, ...partial }), model: 'fake-llm', inputTokens: 1, outputTokens: 1, costUsd: null }; } };
}

// ── 합성 로그(표본 모양)
const cc = {
  user: (sid: string, min: number, content: unknown, extra: Record<string, unknown> = {}) => J({ type: 'user', sessionId: sid, cwd: '/Users/me/dev/blog-renewal', version: '2.1.295', timestamp: iso(min), isSidechain: false, message: { role: 'user', content }, uuid: `u${min}`, ...extra }),
  asst: (sid: string, min: number, blocks: unknown[], id = `msg_${min}`) => J({ type: 'assistant', sessionId: sid, cwd: '/Users/me/dev/blog-renewal', version: '2.1.295', timestamp: iso(min), isSidechain: false, message: { id, role: 'assistant', model: 'claude-sonnet-5-5', content: blocks } }),
};
const cx = {
  meta: (id: string, root = id, extra: Record<string, unknown> = {}) => J({ timestamp: iso(0), type: 'session_meta', payload: { id, session_id: root, cwd: '/Users/me/dev/train-game', cli_version: '0.159.0-alpha.12.1', originator: 'Codex Desktop', ...extra } }),
  msg: (min: number, role: string, texts: string[], phase?: string) => J({ timestamp: iso(min), type: 'response_item', payload: { type: 'message', role, ...(phase ? { phase } : {}), content: texts.map((text) => ({ type: role === 'assistant' ? 'output_text' : 'input_text', text })) } }),
  call: (min: number, id: string, input: string) => J({ timestamp: iso(min), type: 'response_item', payload: { type: 'custom_tool_call', call_id: id, name: 'exec', input, status: 'completed' } }),
  out: (min: number, id: string, text: string) => J({ timestamp: iso(min), type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: id, output: [{ type: 'input_text', text }] } }),
};

describe('A. 대화 결과 → 과제 상태', () => {
  const base = { overrides: [], storedStatus: '진행 중' as const, storedStatusSource: 'rule' as const, storedCompletionReason: null, mcpStatus: null, mcpStatusAt: null, classifiedAt: '2026-09-20T10:00:00+09:00', kind: 'task' as const, resolution: 'unresolved' as const, lastActivityDate: '2026-09-01' };
  it('주 대화 모두 done·moved → 완료(최신이 moved면 moved), 하나라도 open·interrupted·분류 전 → 방치 규칙', () => {
    expect(computeStatus({ ...base, conversationOutcomes: [{ outcome: 'done', detectedBy: 'llm' }] }, '2026-09-30')).toMatchObject({ status: '완료', completionReason: 'done', statusSource: 'llm' });
    expect(computeStatus({ ...base, conversationOutcomes: [{ outcome: 'moved', detectedBy: 'rule' }, { outcome: 'done', detectedBy: 'rule' }] }, '2026-09-30')).toMatchObject({ status: '완료', completionReason: 'moved', statusSource: 'rule' });
    expect(computeStatus({ ...base, conversationOutcomes: [{ outcome: 'open', detectedBy: 'llm' }, { outcome: 'moved', detectedBy: 'both' }] }, '2026-09-30', DEFAULT_THRESHOLDS).status).toBe('멈춤'); // 이어받은 세션(open)이 들어오면 다시 남음
    expect(computeStatus({ ...base, conversationOutcomes: [{ outcome: 'interrupted', detectedBy: 'rule' }] }, '2026-09-30').status).toBe('멈춤');
    expect(computeStatus({ ...base, conversationOutcomes: [null] }, '2026-09-30').status).toBe('멈춤');
    // 사용자 지정·MCP가 우선
    expect(computeStatus({ ...base, overrides: ['status'], storedStatus: '진행 중', conversationOutcomes: [{ outcome: 'done', detectedBy: 'llm' }] }, '2026-09-30').status).toBe('진행 중');
  });
  it('보드 간단한 질문 열: total만큼 items가 온다(접힘은 화면 힌트) · TaskDetail에 대화 결과 · 라벨이 DB에 저장', async () => {
    const s = await makeCore({ seeded: true });
    try {
      const b = (await s.json('GET', '/board')).body;
      const q = b.columns.find((c: { status: string }) => c.status === '간단한 질문');
      expect(q.collapsed).toBe(true);
      expect(q.total).toBeGreaterThan(0);
      expect(q.items.length).toBe(Math.min(q.total, 100));
      expect(q.items.every((x: { kind: string; status: string; completionReason: string }) => x.kind === 'quick_question' && x.status === '완료' && x.completionReason === 'answered')).toBe(true);
      const d = (await s.json('GET', '/tasks/task_20260915_01')).body;
      expect(S.TaskDetailSchema.safeParse(d).success).toBe(true);
      expect(d).toMatchObject({ status: '완료', completionReason: 'moved', handoff: { target: 'Claude Code' } });
      expect(d.conversationOutcome).toMatchObject({ outcome: 'moved', status: '완료', label: 'Claude Code로 옮김' });
      expect(d.conversationOutcomes[0]).toMatchObject({ role: 'primary', outcome: { outcome: 'moved' } });
    } finally { s.close(); }
    const r = upsertConversation(t.core, { sourceAi: 'claude', sourceId: 'lbl1', title: 'x', createdAt: NOW, updatedAt: NOW, archived: false, inServiceProject: false, hasUnextractedArtifact: false,
      messages: [{ role: 'user', content: '이 구조로 정리해 줘. 화면은 셋.', createdAt: NOW }, { role: 'assistant', content: '네', createdAt: NOW }, { role: 'user', content: '토큰 떨어져서 더 못하겠다 정리 파일 md 로 만들어줘', createdAt: NOW }, { role: 'assistant', content: '네', createdAt: NOW }] }, { importId: null, rawPath: null });
    await classifyConversation(t.core, r.conversationId, fake({}));
    expect(t.core.db.value('SELECT outcome_label FROM conversations WHERE id=?', r.conversationId)).toBe('끊김(토큰 한도)');
    expect(JSON.parse(String(t.core.db.value('SELECT outcome_json FROM classifications ORDER BY id DESC LIMIT 1'))).label).toBe('끊김(토큰 한도)');
  });
});

describe('B1. 파서', () => {
  it('Claude Code: 주입·메타 기록을 빼고, 같은 턴 블록을 합치고, 도구는 한 줄(입력·출력 자름), thinking 버림, 제목은 custom-title', () => {
    const st = newState('claude-code', '/x/s1.jsonl');
    const lines = [
      cc.user('s1', 0, '<command-name>/model</command-name> <command-args>opus</command-args>'),
      cc.user('s1', 0, '<local-command-stdout>Set model</local-command-stdout>'),
      cc.user('s1', 1, [{ type: 'text', text: '[Image: source: /tmp/1.png]' }], { isMeta: true }),
      cc.user('s1', 1, [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR'.repeat(200) } }, { type: 'text', text: '메모리 왜 이렇게 많이 써?' }]),
      cc.asst('s1', 2, [{ type: 'thinking', thinking: '속으로 생각' }]),
      cc.asst('s1', 2, [{ type: 'text', text: '확인해 볼게요.' }]),
      cc.asst('s1', 2, [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ps -axm -o rss=,comm= | sort -rn | head', description: '메모리 상위' } }]),
      cc.user('s1', 3, [{ tool_use_id: 'toolu_1', type: 'tool_result', content: '722 MB\tClaude Helper\n' + '프로세스 '.repeat(1000) }]),
      cc.asst('s1', 3, [{ type: 'text', text: 'Claude 앱이 가장 많이 써요.' }]),
      J({ type: 'custom-title', customTitle: '캐시 파일 메모리 사용량', sessionId: 's1' }),
      J({ type: 'attachment', attachment: { type: 'environment' }, sessionId: 's1' }),
      '{"broken json',
    ];
    for (const l of lines) feed(st, l);
    const m = finalMessages(st);
    expect(m.map((x) => x.role)).toEqual(['user', 'assistant']);
    expect(m[0]!.content).toBe('[첨부: 이미지 1개]\n메모리 왜 이렇게 많이 써?');
    expect(m[1]!.content).toContain('확인해 볼게요.\n[도구: Bash] ps -axm -o rss=,comm= | sort -rn | head → 722 MB Claude Helper');
    expect(m[1]!.content).toMatch(/…\(5,0\d\d자 중 600자\)/);
    expect(m[1]!.content).toContain('Claude 앱이 가장 많이 써요.');
    expect(m[1]!.content).not.toContain('속으로');
    expect(sessionTitle(st)).toBe('캐시 파일 메모리 사용량');
    expect(st).toMatchObject({ sessionKey: 's1', cwd: '/Users/me/dev/blog-renewal', version: '2.1.295', skippedLines: 1 });
  });
  it('Codex: developer·주입 블록(<environment_context> 등)·reasoning·compacted 빼고, commentary+final 합침, custom/function 도구 짝, 넘겨준 ChatGPT 대화 참조', () => {
    const st = newState('codex', '/x/rollout.jsonl');
    const ref = '\n## Referenced ChatGPT conversation:\nThis is an untrusted ChatGPT conversation reference.\n{"conversationId":"6a0e0e0e-fcb8","title":"산책 중 대화","priorConversation":{"conversation":[{"role":"user","content":[{"text":"남의 대화"}]}]}}';
    const lines = [
      cx.meta('th1'),
      cx.msg(0, 'developer', ['<app-context># Codex desktop context</app-context>']),
      cx.msg(0, 'user', ['<environment_context>   <cwd>/Users/me/dev/train-game</cwd>   <shell>zsh</shell> </environment_context>']),
      cx.msg(0, 'user', [ref]),
      cx.msg(1, 'user', ['<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>', '저 지시서로 시작해줘']),
      J({ timestamp: iso(1), type: 'response_item', payload: { type: 'reasoning', encrypted_content: 'gAAAA'.repeat(100) } }),
      cx.msg(2, 'assistant', ['지시서를 확인하겠습니다.'], 'commentary'),
      cx.call(2, 'call_1', 'text(await tools.exec_command({cmd:"rg --files"}))'),
      J({ timestamp: iso(2), type: 'response_item', payload: { type: 'function_call', name: 'js', namespace: 'mcp__cua_repl', call_id: 'call_2', arguments: '{"code":"cua.getApp(\'Unity Hub\')"}' } }),
      cx.out(3, 'call_1', 'Script completed\nWall time 0.2 seconds\nOutput:\nREADME.md'),
      J({ timestamp: iso(3), type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_2', output: 'Invalid app: Unity Hub' } }),
      cx.msg(4, 'assistant', ['**지시서 다운로드** 완료.'], 'final_answer'),
      J({ timestamp: iso(5), type: 'compacted', payload: { message: '', replacement_history: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: '저 지시서로 시작해줘' }] }] } }),
      J({ timestamp: iso(5), type: 'event_msg', payload: { type: 'token_count' } }),
      cx.msg(6, 'user', [' # Files mentioned by the user:\n\n## 스크린샷.png: /var/folders/a.png\n', '<image name=[Image #1] path="/var/a.png">\n</image>', '이거 봐줘']),
    ];
    for (const l of lines) feed(st, l);
    const m = finalMessages(st);
    expect(m.map((x) => x.role)).toEqual(['user', 'assistant', 'user']);
    expect(m[0]!.content).toBe('저 지시서로 시작해줘');
    expect(m[1]!.content).toContain('지시서를 확인하겠습니다.\n[도구: exec] text(await tools.exec_command({cmd:"rg --files"})) → Script completed Wall time 0.2 seconds Output: README.md');
    expect(m[1]!.content).toContain('[도구: mcp__cua_repl.js]');
    expect(m[1]!.content).toContain('→ Invalid app: Unity Hub');
    expect(m[1]!.content).toContain('**지시서 다운로드** 완료.');
    expect(m[2]!.content).toBe('[첨부: 파일 1개] [첨부: 이미지 1개]\n이거 봐줘');
    expect(m.map((x) => x.content).join('\n')).not.toMatch(/environment_context|남의 대화|app-context|gAAAA/);
    expect(st.explicitRef).toEqual({ sourceAi: 'chatgpt', sourceId: '6a0e0e0e-fcb8', title: '산책 중 대화' });
    expect(st).toMatchObject({ sessionKey: 'th1', isSubagent: false, cwd: '/Users/me/dev/train-game' });
  });
  it('Codex 하위 에이전트: session_id(루트) ≠ id → 하위, 키는 루트', () => {
    const st = newState('codex', '/x/r2.jsonl');
    feed(st, cx.meta('child', 'root1', { parent_thread_id: 'root1', source: { subagent: { thread_spawn: { parent_thread_id: 'root1', depth: 1, agent_role: 'worker' } } }, agent_nickname: 'Aquinas' }));
    expect(st).toMatchObject({ sessionKey: 'root1', sessionId: 'child', isSubagent: true, agentName: 'Aquinas' });
  });
  it('비밀정보는 파서에서(저장 전) 가린다 — 사용자 말·도구 입력·도구 출력 모두', () => {
    const st = newState('codex', '/x/r3.jsonl');
    feed(st, cx.meta('s'));
    feed(st, cx.msg(1, 'user', [`키는 ${FAKE('sk-proj-')} 이거야`]));
    feed(st, cx.call(2, 'c1', `export OPENAI_API_KEY=${FAKE('sk-')} && node a.js`));
    feed(st, cx.out(3, 'c1', `{"api_key": "${FAKE('', 30)}", "auth": "Bearer ${FAKE('', 40)}"} GEMINI_API_KEY=${FAKE('AIza', 39)}`));
    const all = finalMessages(st).map((m) => m.content).join('\n');
    expect(all).not.toContain('Zx9Qw8Er7');
    expect(all).toContain('OPENAI_API_KEY=[REDACTED:secret_env]');
    expect(st.redacted).toBeGreaterThanOrEqual(5);
  });
  it('redactSecrets 1.5.0 패턴: 환경변수 꼴은 이름 남김, 평범한 설정은 그대로', () => {
    const r = (s: string) => redactSecrets(s).text;
    expect(r(`ANTHROPIC_API_KEY="${FAKE('sk-ant-api03-')}"`)).toBe('ANTHROPIC_API_KEY="[REDACTED:secret_env]"');
    expect(r(`SLACK_BOT_TOKEN: ${FAKE('xoxb-', 30)}`)).toBe('SLACK_BOT_TOKEN: [REDACTED:secret_env]');
    expect(r(`DB_PASSWORD=hunter2hunter2`)).toBe('DB_PASSWORD=[REDACTED:secret_env]');
    expect(r(`Authorization: Bearer ${FAKE('', 30)}`)).toBe('Authorization: [REDACTED:token]');
    expect(r(`jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4fw`)).toBe('jwt [REDACTED:token]');
    expect(r(`gh ${FAKE('github_pat_', 50)}`)).toBe('gh [REDACTED:token]');
    expect(r(`stripe ${FAKE('sk_live_', 30)}`)).toBe('stripe [REDACTED:api_key]');
    expect(r('-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\nBBBB')).toBe('[REDACTED:private_key]'); // 끝 줄이 잘려도
    expect(r('MAX_TOKENS=4096000 SORT_ORDER=createdAt model=gpt-6-luna')).toBe('MAX_TOKENS=4096000 SORT_ORDER=createdAt model=gpt-6-luna');
  });
  it('stripInjected: 태그 블록은 통째로, 평범한 꺾쇠 글은 남김', () => {
    expect(stripInjected('<in-app-browser-context source="ambient-ui-state">\n페이지\n</in-app-browser-context>\n계속 진행해').text).toBe('계속 진행해');
    expect(stripInjected('a < b 이고 c > d 야').text).toBe('a < b 이고 c > d 야');
  });
});

describe('B2. 수집기(파일 → DB)', () => {
  function roots() {
    const ccRoot = join(t.home, 'claude', 'projects'), cxRoot = join(t.home, 'codex', 'sessions');
    mkdirSync(join(ccRoot, '-Users-me-dev-blog-renewal', 'sess1', 'subagents'), { recursive: true });
    mkdirSync(join(cxRoot, '2026', '09', '30'), { recursive: true });
    putCollectorConfig(t.core, { sources: [{ sourceAi: 'claude-code', root: ccRoot, enabled: true }, { sourceAi: 'codex', root: cxRoot, enabled: true }] });
    return { ccRoot, cxRoot, ccFile: join(ccRoot, '-Users-me-dev-blog-renewal', 'sess1.jsonl'), subFile: join(ccRoot, '-Users-me-dev-blog-renewal', 'sess1', 'subagents', 'agent-a1.jsonl') };
  }
  it('이어 읽기: 늘어난 바이트만, 덜 써진 마지막 줄은 다음에, 도구 짝이 검사 사이에 걸쳐도 맞춤, 교체되면 처음부터(중복 없음)', async () => {
    const { ccFile } = roots();
    writeFileSync(ccFile, cc.user('sess1', 0, `볼트 노트 md 변환 스크립트 만들자 ${FAKE('sk-ant-')}`) + cc.asst('sess1', 1, [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'notes/a.md' } }]));
    let r = await scanSource(t.core, 'claude-code');
    expect(r.changed.length).toBe(1);
    const convId = r.changed[0]!;
    const row = () => t.core.db.get<{ offset: number; size: number }>('SELECT offset, size FROM collector_files WHERE path=?', ccFile)!;
    expect(row().offset).toBe(row().size);
    // 결과가 다음 검사에 오고, 마지막 줄은 아직 쓰는 중(줄바꿈 없음)
    const half = cc.asst('sess1', 3, [{ type: 'text', text: '변환 완료' }]);
    appendFileSync(ccFile, cc.user('sess1', 2, [{ type: 'tool_result', tool_use_id: 't1', content: '# A 노트' }]) + half.slice(0, 40));
    r = await scanSource(t.core, 'claude-code');
    expect(row().offset).toBe(row().size - 40);
    appendFileSync(ccFile, half.slice(40));
    r = await scanSource(t.core, 'claude-code');
    expect(row().offset).toBe(row().size);
    const msgs = () => t.core.db.all<{ role: string; content_md: string }>('SELECT role, content_md FROM messages WHERE conversation_id=? ORDER BY seq', convId);
    expect(msgs().map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
    expect(msgs()[0]!.content_md).toBe('작업 폴더: /Users/me/dev/blog-renewal · Claude Code 2.1.295');
    expect(msgs()[2]!.content_md).toBe('[도구: Read] notes/a.md → # A 노트\n\n변환 완료');
    expect(msgs()[1]!.content_md).toContain('[REDACTED:api_key]');
    expect(JSON.stringify(t.core.db.all('SELECT * FROM messages'))).not.toContain('Zx9Qw8Er7');
    expect(JSON.stringify(t.core.db.all('SELECT state_json FROM collector_files'))).not.toContain('Zx9Qw8Er7');
    // 바뀐 게 없으면 그대로
    expect((await scanSource(t.core, 'claude-code')).changed).toEqual([]);
    // 교체(새 inode, 더 짧음) → 처음부터 다시, 대화는 같은 것
    const tmp = ccFile + '.new';
    writeFileSync(tmp, cc.user('sess1', 0, '볼트 노트 md 변환 스크립트 만들자'));
    renameSync(tmp, ccFile);
    r = await scanSource(t.core, 'claude-code');
    expect(r.changed).toEqual([convId]);
    expect(Number(t.core.db.value("SELECT COUNT(*) FROM conversations WHERE source_ai='claude-code'"))).toBe(1);
    expect(msgs().map((m) => m.role)).toEqual(['system', 'user']);
    const c = t.core.db.get<{ capture_method: string; cwd: string; source_url: string | null }>('SELECT capture_method, cwd, source_url FROM conversations WHERE id=?', convId)!;
    expect(c).toEqual({ capture_method: 'local_session', cwd: '/Users/me/dev/blog-renewal', source_url: null });
  });
  it('하위 에이전트 파일은 부모 대화에 시간순으로 합쳐지고 표시가 붙는다', async () => {
    const { ccFile, subFile } = roots();
    writeFileSync(ccFile, cc.user('sess1', 0, '리팩터링 해줘') + cc.asst('sess1', 10, [{ type: 'text', text: '다 됐어요' }]));
    writeFileSync(subFile, J({ type: 'agent-name', agentName: 'explorer', sessionId: 'sess1' }) + cc.asst('sess1', 5, [{ type: 'text', text: '파일 3개 찾음' }]).replace('"isSidechain":false', '"isSidechain":true'));
    const r = await scanSource(t.core, 'claude-code');
    expect(r.changed.length).toBe(1);
    const m = t.core.db.all<{ content_md: string }>('SELECT content_md FROM messages WHERE conversation_id=? ORDER BY seq', r.changed[0]).map((x) => x.content_md);
    expect(m).toEqual(['작업 폴더: /Users/me/dev/blog-renewal · Claude Code 2.1.295 · 하위 에이전트 1개', '리팩터링 해줘', '[하위 에이전트 explorer] 파일 3개 찾음', '다 됐어요']);
  });
  it('넘겨준 채팅 대화 ↔ 세션: 시간·폴더 이름으로 합치기 제안 → 수락하면 과제는 세션 쪽에서 이어짐(완료 → 진행 중)', async () => {
    const { ccFile } = roots();
    // 넘겨준 Claude 웹 대화(10분 전 끝), 대화 결과 moved → 과제 완료/moved
    const h = upsertConversation(t.core, { sourceAi: 'claude', sourceId: 'web1', title: 'blog-renewal 노트 변환 기획', createdAt: iso(-60), updatedAt: iso(-10), archived: false, inServiceProject: false, hasUnextractedArtifact: false,
      messages: [{ role: 'user', content: 'blog-renewal 노트를 md로 바꾸는 스크립트 기획하자', createdAt: iso(-60) }, { role: 'assistant', content: '좋아요', createdAt: iso(-59) },
        { role: 'user', content: '지금까지 내용을 md 파일로 만들어줘 클로드 코드로 가서 이어서 할꺼야', createdAt: iso(-11) }, { role: 'assistant', content: '정리했어요', createdAt: iso(-10) }] }, { importId: null, rawPath: null });
    await classifyConversation(t.core, h.conversationId, fake({ handoff: true, handoff_target: 'Claude Code', conversation_outcome: 'moved' }));
    expect(toListItem(loadTask(t.core, h.taskId!)!)).toMatchObject({ status: '완료', completionReason: 'moved' });
    writeFileSync(ccFile, cc.user('sess1', 8, 'blog-renewal 노트 md 변환 스크립트 이어서 만들자') + cc.asst('sess1', 9, [{ type: 'text', text: '시작할게요' }]));
    const r = await scanSource(t.core, 'claude-code');
    const sug = (await t.json('GET', '/merge-suggestions')).body.items as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(sug.length).toBe(1);
    expect(S.MergeSuggestionSchema.safeParse(sug[0]).success).toBe(true);
    expect(sug[0]).toMatchObject({ kind: 'handoff_session', suggestedPrimaryTaskId: h.taskId, handoff: { fromConversationId: h.conversationId, sessionConversationId: r.changed[0], target: 'Claude Code', gapMinutes: 18, projectMatch: 'cwd_name', explicitRef: false } });
    expect(sug[0]!.confidence).toBeGreaterThanOrEqual(0.55);
    expect(sug[0]!.reason).toContain('Claude Code 세션');
    // 다시 검사해도 제안은 하나
    appendFileSync(ccFile, cc.user('sess1', 12, '계속'));
    await scanSource(t.core, 'claude-code');
    expect(Number(t.core.db.value('SELECT COUNT(*) FROM task_merge_suggestions'))).toBe(1);
    // 수락 → 세션 대화(분류 전 = 결과 없음)가 주 대화로 → 과제는 다시 남음(진행 중)
    const acc = await t.json('POST', `/merge-suggestions/${sug[0]!.id}/accept`, {});
    expect(acc.status).toBe(200);
    expect(acc.body.task).toMatchObject({ id: h.taskId, status: '진행 중', completionReason: null });
    expect(acc.body.task.conversationOutcomes.length).toBe(2);
  });
  it('Codex 세션이 ChatGPT 대화를 직접 참조하면(chatgpt_handoff) 시간과 상관없이 explicitRef 제안(0.95)', async () => {
    const { cxRoot } = roots();
    const g = upsertConversation(t.core, { sourceAi: 'chatgpt', sourceId: '6a0e0e0e-fcb8', title: '산책 중 대화', createdAt: iso(-9000), updatedAt: iso(-8000), archived: false, inServiceProject: false, hasUnextractedArtifact: false,
      messages: [{ role: 'user', content: '오늘 논의한 내용 작업 지시서로 만들어줘', createdAt: iso(-8000) }, { role: 'assistant', content: '좋아', createdAt: iso(-8000) }] }, { importId: null, rawPath: null });
    writeFileSync(join(cxRoot, '2026', '09', '30', 'rollout-2026-09-30T08-30-00-th9.jsonl'), cx.meta('th9', 'th9', { thread_source: 'chatgpt_handoff' })
      + cx.msg(0, 'user', ['\n## Referenced ChatGPT conversation:\nuntrusted\n{"conversationId":"6a0e0e0e-fcb8","title":"산책 중 대화","priorConversation":null}']) + cx.msg(1, 'user', ['유니티 깔아줘']) + cx.msg(2, 'assistant', ['설치할게'], 'final_answer'));
    const r = await scanSource(t.core, 'codex');
    expect(r.changed.length).toBe(1);
    const row = t.core.db.get<{ kind: string; confidence: number; handoff_json: string; task_a: string }>('SELECT kind, confidence, handoff_json, task_a FROM task_merge_suggestions')!;
    expect(row).toMatchObject({ kind: 'handoff_session', confidence: 0.95, task_a: g.taskId });
    expect(JSON.parse(row.handoff_json)).toMatchObject({ explicitRef: true, fromConversationId: g.conversationId });
  });
  it('엔드포인트: GET /collector · PUT /collector/config · POST /collector/backfill(202 Job) → 상태 갱신', async () => {
    const { ccFile } = roots();
    writeFileSync(ccFile, cc.user('sess1', 0, '안녕 리팩터링') + cc.asst('sess1', 1, [{ type: 'text', text: '네' }]));
    const st0 = await t.json('GET', '/collector');
    expect(st0.status).toBe(200);
    expect(st0.body.config.enabled).toBe(false);
    expect(st0.body.sources[0]).toMatchObject({ sourceAi: 'claude-code', rootExists: true, files: 0, backfill: { state: 'never' } });
    const bad = await t.json('PUT', '/collector/config', { pollIntervalSec: 1 });
    expect(bad.status).toBe(400);
    const put = await t.json('PUT', '/collector/config', { toolOutputMaxChars: 200, classify: false });
    expect(put.body.config).toMatchObject({ toolOutputMaxChars: 200, classify: false, enabled: false });
    const job = await t.json('POST', '/collector/backfill', { sourceAi: 'claude-code' });
    expect(job.status).toBe(202);
    expect(job.body.type).toBe('collector_backfill');
    await t.core.queue.idle();
    const st = (await t.json('GET', '/collector')).body;
    expect(st.sources[0]).toMatchObject({ files: 1, sessions: 1, backfill: { state: 'done', filesDone: 1 } });
    expect(st.sources[0].bytesIngested).toBe(st.sources[0].bytesTotal);
    expect((await t.json('POST', '/collector/scan', {})).status).toBe(202);
    await t.core.queue.idle();
    const list = (await t.json('GET', '/tasks?sourceAi=claude-code')).body.items;
    expect(list.length).toBe(1);
    expect(list[0].sourceAis).toEqual(['claude-code']);
    const d = (await t.json('GET', `/tasks/${list[0].id}`)).body;
    expect(S.TaskDetailSchema.safeParse(d).success).toBe(true);
    expect(d.resume.defaultTargetAi).toBe('claude');
  });
});
