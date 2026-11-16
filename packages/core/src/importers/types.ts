import type { GeminiActivityPreview, ImportPreview, MessageRole } from '@subbrain/shared';

/** voice: 1.3.0 음성 대화 전사(ChatGPT audio_transcription). 본문은 전사 글 그대로(접두어 없음) */
export interface NormalizedMessage { role: MessageRole; content: string; createdAt: string | null; voice?: boolean }
export type ImportSourceAi = 'chatgpt' | 'claude' | 'gemini' | 'grokbot';
export interface NormalizedConversation {
  /** 1.5.0 로컬 세션 수집기는 claude-code·codex */
  sourceAi: ImportSourceAi | 'claude-code' | 'codex';
  sourceId: string;
  /** 1.2.0 원본 대화 주소. 없으면(undefined) CONVERSATION_URL로 만들고, null이면 주소 없음(예: 시간으로 묶은 Gemini 대화) */
  url?: string | null;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  messages: NormalizedMessage[];
  archived: boolean;
  inServiceProject: boolean;
  hasUnextractedArtifact: boolean;
}
export interface ParseResult {
  sourceAi: ImportSourceAi;
  detectedFormat: ImportPreview['detectedFormat'];
  formatVersion: string | null;
  conversations: NormalizedConversation[];
  errors: Array<{ conversationSourceId: string | null; message: string }>;
  warnings: string[];
  /** 1.1.0 새 Claude 내보내기(2026-10)의 카테고리별 ZIP. 없으면 'conversations' */
  category?: 'conversations' | 'projects' | 'memories';
  /** category='projects'일 때 projects/<uuid>.json 목록 */
  projects?: ClaudeProjectRecord[];
  /** 1.2.0 Gemini Takeout(활동 기록)일 때 다시 묶은 내역 */
  activity?: GeminiActivityPreview;
}
/** Claude projects/<uuid>.json 에서 서브브레인이 쓰는 부분. description은 시스템 프롬프트라 요약으로 쓰지 않는다 */
export interface ClaudeProjectRecord { uuid: string; name: string; isStarter: boolean; createdAt: string | null; updatedAt: string | null }
export class UnsupportedFileError extends Error {}
/**
 * 대화가 아닌 카테고리 ZIP(projects-000.zip / memories-000.zip). parseExport는 기존처럼 이 오류를 던지고(대화 파서 관점에선 지원 안 하는 파일),
 * 가져오기 흐름(services/imports)은 이 오류를 잡아 카테고리 미리보기로 바꾼다.
 */
export class CategoryZipError extends UnsupportedFileError {
  constructor(public readonly category: 'projects' | 'memories', public readonly projects: ClaudeProjectRecord[], public readonly fileCount: number) {
    super(category === 'projects'
      ? `ZIP 안에 conversations.json이 없어요 — Claude 내보내기의 프로젝트 파일(projects/, ${fileCount}개)이에요. 대화는 conversations ZIP에 있어요`
      : `ZIP 안에 conversations.json이 없어요 — Claude 내보내기의 메모리 파일(memories/, ${fileCount}개)이에요. 서브브레인은 메모리를 쓰지 않아요`);
  }
}
