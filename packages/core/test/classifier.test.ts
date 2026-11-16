import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../src/classifier/redact.ts';
import { condense } from '../src/classifier/condense.ts';
import { ruleClassify } from '../src/classifier/rule-classifier.ts';
import type { ClassifyInput } from '../src/classifier/provider.ts';

describe('비밀정보 가리기 (§7.5)', () => {
  it('키·이메일·전화·카드·주민번호 형식을 [REDACTED:종류]로', () => {
    const src = '키 sk-ant-api03-ABCDEFGHIJKLMNOPqrstuv 메일 me@example.com 폰 010-1234-5678 카드 1234 5678 9012 3456 주민 900101-1234567';
    const { text, counts } = redactSecrets(src);
    expect(text).not.toContain('sk-ant');
    expect(text).not.toContain('me@example.com');
    expect(text).not.toContain('010-1234-5678');
    expect(text).toContain('[REDACTED:api_key]');
    expect(counts).toMatchObject({ api_key: 1, email: 1, phone: 1, card: 1, rrn: 1 });
  });
  it('평범한 문장은 그대로', () => {
    expect(redactSecrets('A업체 180만, C업체 165만').text).toBe('A업체 180만, C업체 165만');
  });
});

describe('입력 줄이기 (§7.5)', () => {
  it('처음 N·마지막 M개는 전문, 가운데는 앞 K자만', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `${i}번 메시지 `.padEnd(50, 'x') }));
    const out = condense(msgs, { head: 2, tail: 2, middleChars: 5, redact: true });
    const lines = out.split('\n');
    expect(lines).toHaveLength(10);
    expect(lines[0]).toContain('x'.repeat(10));
    expect(lines[4]).toContain('…(생략)');
    expect(lines[9]).toContain('x'.repeat(10));
  });
});

const input = (msgs: Array<[string, string]>, title = '테스트'): ClassifyInput => ({
  sourceAi: 'chatgpt', title, createdAt: '2026-09-29T10:00:00+09:00', updatedAt: '2026-09-29T11:00:00+09:00',
  messages: msgs.map(([role, content]) => ({ role: role as 'user' | 'assistant', content })), previousSummary: null,
  projects: [{ name: '이사 준비', aliases: ['이사'] }], recentTasks: [], today: '2026-09-30', condensed: '',
});

describe('규칙 분류기 (키 없을 때)', () => {
  it('짧은 질문 하나 → 간단한 질문', () => {
    const r = ruleClassify(input([['user', 'CSS clamp가 뭐야?'], ['assistant', '범위를 정하는 함수예요.']]));
    expect(r.kind).toBe('quick_question');
    expect(r.resolution).toBe('resolved');
  });
  it('“내일 다시 볼게”로 끝나면 미해결 + 다음 단계', () => {
    const r = ruleClassify(input([['user', '이사업체 견적 비교하자'], ['assistant', '네'], ['user', 'A업체로 하자. 표도 만들어 줘'], ['assistant', '표예요'], ['user', 'B업체 답 오면 내일 다시 볼게']]));
    expect(r.kind).toBe('task');
    expect(r.resolution).toBe('unresolved');
    expect(r.next_step).toContain('이어서');
    expect(r.project).toBe('이사 준비');
    expect(r.decisions.length).toBeGreaterThan(0);
  });
  it('“해결됐어, 고마워” → 완료, “그만할래” → 포기', () => {
    const base: Array<[string, string]> = [['user', '배포 오류가 나'], ['assistant', '로그를 보여 주세요'], ['user', '여기'], ['assistant', '환경변수 문제예요']];
    expect(ruleClassify(input([...base, ['user', '해결됐어! 고마워']])).resolution).toBe('resolved');
    expect(ruleClassify(input([...base, ['user', '그냥 그만할래']])).resolution).toBe('abandoned');
  });
  it('같은 입력이면 같은 결과', () => {
    const i = input([['user', '온보딩 문구 다듬자'], ['assistant', '좋아요'], ['user', '세 줄로?'], ['assistant', '네']]);
    expect(ruleClassify(i)).toEqual(ruleClassify(i));
  });
});
