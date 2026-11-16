import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseExport } from '../src/importers/detect.ts';
import { UnsupportedFileError } from '../src/importers/types.ts';
import { chatgptConversations, claudeConversations, enc } from './fixtures/exports.ts';

describe('ChatGPT 파서', () => {
  it('current_node 가지만 따라가고 시스템·숨김 메시지는 뺀다', () => {
    const r = parseExport(enc(chatgptConversations()));
    expect(r.sourceAi).toBe('chatgpt');
    expect(r.detectedFormat).toBe('chatgpt_conversations_json');
    const c = r.conversations.find((x) => x.title === '이사업체 견적 비교')!;
    expect(c.messages.map((m) => m.content)).toEqual([
      '이사업체 견적을 표로 비교하고 싶어.', '좋아요. 업체 이름과 금액을 알려 주세요.', 'A업체 180만, C업체 165만이야.', '표로 정리했어요. B업체는 답을 기다리는 중이죠?',
    ]);
    expect(c.messages.some((m) => m.content.includes('옛 가지'))).toBe(false);
    expect(c.createdAt).toBe('2026-09-20T21:00:00+09:00'); // KST로 정규화
  });
  it('current_node가 없으면 가장 늦은 잎 노드, 제목이 비면 첫 메시지로', () => {
    const r = parseExport(enc(chatgptConversations()));
    const c = r.conversations.find((x) => x.sourceId.endsWith('03'))!;
    expect(c.messages).toHaveLength(2);
    expect(c.title).toBe('블로그 RSS 피드를 붙이려면 어떻게 해?'.slice(0, 40));
  });
  it('ZIP(메모리, fflate) 안의 conversations.json을 읽는다', () => {
    const zip = zipSync({ 'chat.html': strToU8('<html></html>'), 'conversations.json': enc(chatgptConversations()) });
    const r = parseExport(zip);
    expect(r.detectedFormat).toBe('chatgpt_export_zip');
    expect(r.conversations).toHaveLength(3);
  });
});

describe('Claude 파서', () => {
  it('content 블록을 text보다 먼저 쓰고 첨부는 자리표시자로', () => {
    const r = parseExport(enc(claudeConversations()));
    expect(r.sourceAi).toBe('claude');
    const c = r.conversations[0]!;
    expect(c.messages[0]!.content).toContain('첫 화면 문구를 3줄로 줄여 줘.');
    expect(c.messages[0]!.content).toContain('[첨부: draft.txt]');
    expect(c.messages[1]!.content).toContain('[도구 사용: artifacts]');
    expect(c.messages[0]!.role).toBe('user');
  });
  it('parent_message_uuid 가지 중 가장 늦은 메시지의 가지만', () => {
    const r = parseExport(enc(claudeConversations()));
    const c = r.conversations[1]!;
    expect(c.messages.map((m) => m.content)).toEqual(['볼트 노트 형식을 정하자.', 'frontmatter부터 볼까요?', '응, frontmatter 필드 목록을 줘.', 'id, status, project, updated 를 추천해요.']);
  });
  it('ZIP은 claude_export_zip', () => {
    expect(parseExport(zipSync({ 'data/conversations.json': enc(claudeConversations()) })).detectedFormat).toBe('claude_export_zip');
  });
});

describe('형식 오류', () => {
  it('모르는 형식·빈 파일·깨진 JSON은 UnsupportedFileError', () => {
    expect(() => parseExport(enc([{ foo: 1 }]))).toThrow(UnsupportedFileError);
    expect(() => parseExport(enc([]))).toThrow(UnsupportedFileError);
    expect(() => parseExport(new TextEncoder().encode('{not json'))).toThrow(UnsupportedFileError);
    expect(() => parseExport(zipSync({ 'readme.txt': strToU8('x') }))).toThrow(/conversations\.json/);
  });
});
