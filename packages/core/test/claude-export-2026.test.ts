/**
 * Claude 새 내보내기 형식(2026-10 확인) 회귀 테스트 — 합성 데이터, 실제 사용자 데이터 아님.
 * 새 형식: 매니페스트 + 카테고리별 ZIP (conversations-000.zip / projects-000.zip / memories-000.zip).
 *  - conversations-000.zip 루트에 conversations.json 하나 (배열, 모양은 예전과 같음)
 *  - 대화: uuid, name, summary, created_at, updated_at, account{uuid}, chat_messages
 *  - 메시지: 모든 메시지에 parent_message_uuid (첫 메시지는 00000000-0000-4000-8000-000000000000), 시각은 마이크로초 Z
 *  - content 블록: text, tool_use, tool_result, thinking, flag, injected_prompt_block (+ start/stop_timestamp 등)
 *  - files[]: {file_uuid, file_name|null}, attachments[]: {file_name, file_size, file_type, extracted_content}
 *  - 대화에 project_uuid 없음 / projects-000.zip 은 projects/<uuid>.json 파일별 → 대화와 연결 정보 없음
 */
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseExport } from '../src/importers/detect.ts';
import { UnsupportedFileError } from '../src/importers/types.ts';
import { enc } from './fixtures/exports.ts';

const ROOT = '00000000-0000-4000-8000-000000000000';
const ts = (s: string) => ({ start_timestamp: s, stop_timestamp: s, flags: null });
const msg = (uuid: string, sender: string, parent: string, at: string, content: unknown[], extra: Record<string, unknown> = {}) => ({
  uuid, text: '', content, sender, created_at: at, updated_at: at, attachments: [], files: [], parent_message_uuid: parent, ...extra,
});

function newFormatConversations(): unknown[] {
  return [
    {
      uuid: '33333333-cccc-4ddd-8eee-000000000001', name: '합성 대화: 스크립트 만들기', summary: '요약 문단', created_at: '2026-09-01T03:00:00.123456Z',
      updated_at: '2026-09-01T03:10:00.654321Z', account: { uuid: 'acc' },
      chat_messages: [
        msg('m1', 'human', ROOT, '2026-09-01T03:00:00.123456Z', [
          { type: 'injected_prompt_block', prompt: '(주입된 프롬프트)', injection_source: 'x', initial_turn_only: true, skip_on_truncated_continuation: false, ...ts('2026-09-01T03:00:00.1Z') },
          { type: 'text', text: '스크립트를 만들어 줘.', citations: [], ...ts('2026-09-01T03:00:00.1Z') },
        ], {
          files: [{ file_uuid: 'f1', file_name: 'notes.md' }, { file_uuid: 'f2', file_name: null }],
          attachments: [{ file_name: 'notes.md', file_size: 10, file_type: 'text/plain', extracted_content: '메모' }],
        }),
        msg('m2', 'assistant', 'm1', '2026-09-01T03:01:00.000001Z', [
          { type: 'thinking', thinking: '(생각 과정)', summaries: [], cut_off: false, truncated: false, hidden: false, thinking_hidden: false, alternative_display_type: null, signature: null, ...ts('2026-09-01T03:01:00Z') },
          { type: 'text', text: '먼저 확인할게요.', citations: [], ...ts('2026-09-01T03:01:00Z') },
          { type: 'tool_use', id: 't1', name: 'bash_tool', input: { cmd: 'ls' }, message: '실행 중', display_content: null, ...ts('2026-09-01T03:01:01Z') },
          { type: 'tool_result', tool_use_id: 't1', name: 'bash_tool', content: [{ type: 'text', text: '(도구 출력)' }], is_error: false, ...ts('2026-09-01T03:01:02Z') },
          { type: 'flag', flag: 'x', helpline: {}, start_timestamp: null, stop_timestamp: null, flags: null },
          { type: 'text', text: '스크립트를 만들었어요.', citations: [], ...ts('2026-09-01T03:01:03Z') },
        ]),
        msg('m3old', 'human', 'm2', '2026-09-01T03:05:00.000000Z', [{ type: 'text', text: '(옛 가지)', citations: [] }]),
        msg('m3', 'human', 'm2', '2026-09-01T03:09:00.000000Z', [{ type: 'text', text: '고마워!', citations: [] }]),
        msg('m4', 'assistant', 'm3', '2026-09-01T03:10:00.654321Z', [{ type: 'thinking', thinking: '(생각만 있고 본문 없음)' }]),
      ],
    },
    {
      // 내용이 전혀 없는 대화(빈 content·빈 text) → 건너뜀
      uuid: '33333333-cccc-4ddd-8eee-000000000002', name: '', summary: '', created_at: '2026-09-02T00:00:00.000000Z', updated_at: '2026-09-02T00:00:00.000000Z', account: { uuid: 'acc' },
      chat_messages: [msg('e1', 'human', ROOT, '2026-09-02T00:00:00.000000Z', []), msg('e2', 'assistant', 'e1', '2026-09-02T00:00:01.000000Z', [])],
    },
  ];
}

describe('Claude 새 내보내기 형식 (카테고리별 ZIP, 2026-10)', () => {
  const zip = zipSync({ 'conversations.json': enc(newFormatConversations()) });

  it('conversations-000.zip 을 그대로 읽는다', () => {
    const r = parseExport(zip);
    expect(r.sourceAi).toBe('claude');
    expect(r.detectedFormat).toBe('claude_export_zip');
    expect(r.conversations).toHaveLength(1);
    expect(r.errors).toEqual([{ conversationSourceId: '33333333-cccc-4ddd-8eee-000000000002', message: '메시지가 없는 대화라 건너뜀' }]);
  });

  it('text·tool_use만 쓰고 thinking·tool_result·flag·injected_prompt_block은 뺀다, 가지는 최신 것만', () => {
    const c = parseExport(zip).conversations[0]!;
    expect(c.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']); // 생각만 있는 m4는 빈 메시지라 빠짐
    expect(c.messages[0]!.content).toContain('스크립트를 만들어 줘.');
    expect(c.messages[0]!.content).toContain('[첨부: notes.md]');
    expect(c.messages[0]!.content).not.toContain('주입된 프롬프트');
    expect(c.messages[1]!.content).toBe('먼저 확인할게요.\n\n[도구 사용: bash_tool]\n\n스크립트를 만들었어요.');
    expect(c.messages[2]!.content).toBe('고마워!');
    const all = c.messages.map((m) => m.content).join('\n');
    for (const hidden of ['생각', '도구 출력', '옛 가지']) expect(all).not.toContain(hidden);
  });

  it('마이크로초 Z 시각을 KST로, project_uuid가 없으니 inServiceProject=false', () => {
    const c = parseExport(zip).conversations[0]!;
    expect(c.createdAt).toBe('2026-09-01T12:00:00+09:00');
    expect(c.updatedAt).toBe('2026-09-01T12:10:00+09:00');
    expect(c.messages[0]!.createdAt).toBe('2026-09-01T12:00:00+09:00');
    expect(c.inServiceProject).toBe(false);
    expect(c.hasUnextractedArtifact).toBe(true); // files[] 항목은 자리표시자로
  });

  it('projects-000.zip · memories-000.zip 은 대화가 없어 지원하지 않는 파일', () => {
    const projects = zipSync({ 'projects/0190-aaaa.json': strToU8(JSON.stringify({ uuid: '0190-aaaa', name: '합성 프로젝트', docs: [] })) });
    const memories = zipSync({ 'memories/acc.json': strToU8(JSON.stringify({ conversations_memory: '', project_memories: {}, memory_files: [], account_uuid: 'acc' })) });
    expect(() => parseExport(projects)).toThrow(UnsupportedFileError);
    expect(() => parseExport(memories)).toThrow(/conversations\.json/);
  });
});
