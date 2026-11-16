/** 파일 형식 감지 + 파싱: ZIP(fflate, 메모리) 또는 conversations.json */
import { unzipSync, strFromU8 } from 'fflate';
import { parseChatgpt, looksLikeChatgpt } from './chatgpt.ts';
import { parseClaude, looksLikeClaude } from './claude.ts';
import { isGeminiZipEntry, looksLikeGeminiActivity, looksLikeGeminiHtml, parseGemini, type GeminiParseOptions } from './gemini.ts';
import { CategoryZipError, UnsupportedFileError, type ClaudeProjectRecord, type ImportSourceAi, type ParseResult } from './types.ts';

const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6);

export interface ParseOptions { gemini?: GeminiParseOptions; /** 1.10.0 파일 이름에 grokbot이 있으면 Grok Bot으로 */ fileName?: string }

export function parseExport(bytes: Uint8Array, hint?: ImportSourceAi, opts: ParseOptions = {}): ParseResult {
  if (hint === 'grokbot' || (!hint && opts.fileName && /grok-?bot/i.test(opts.fileName.split(/[\\/]/).pop() ?? ''))) return asGrokbot(parseExport(bytes, 'claude', { ...opts, fileName: undefined }));
  let zipped = false;
  let jsonText: string;
  if (isZip(bytes)) {
    zipped = true;
    let files: Record<string, Uint8Array>;
    try { files = unzipSync(bytes, { filter: (f) => /(^|\/)conversations\.json$/i.test(f.name) }); }
    catch { throw new UnsupportedFileError('ZIP 파일을 열 수 없어요'); }
    const name = Object.keys(files).sort((a, b) => a.length - b.length)[0];
    if (!name) { const g = parseGeminiZip(bytes, opts); if (g) return g; }
    if (!name) detectCategoryZip(bytes);
    if (!name) throw new UnsupportedFileError('ZIP 안에 conversations.json이나 Gemini 활동 기록(My Activity/Gemini Apps/MyActivity.html·json)이 없어요');
    jsonText = strFromU8(files[name]!);
  } else {
    jsonText = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
    // 1.2.0 Gemini Takeout HTML(MyActivity.html) 파일 하나
    if (/^\s*</.test(jsonText)) {
      if (looksLikeGeminiHtml(jsonText)) return parseGemini({ html: jsonText }, { zipped: false }, opts.gemini);
      throw new UnsupportedFileError('HTML 파일은 Google Takeout의 Gemini 앱 활동 기록(MyActivity.html)만 가져올 수 있어요');
    }
  }
  let data: unknown;
  try { data = JSON.parse(jsonText.replace(/^\uFEFF/, '')); } catch { throw new UnsupportedFileError('JSON으로 읽을 수 없는 파일이에요'); }
  if (Array.isArray(data) && data.length === 0) throw new UnsupportedFileError('대화가 하나도 없는 파일이에요');
  const kind = hint === 'chatgpt' && looksLikeChatgpt(data) ? 'chatgpt' : hint === 'claude' && looksLikeClaude(data) ? 'claude'
    : looksLikeChatgpt(data) ? 'chatgpt' : looksLikeClaude(data) ? 'claude' : looksLikeGeminiActivity(data) ? 'gemini' : null;
  if (!kind) throw new UnsupportedFileError('알 수 없는 형식이에요 (ChatGPT·Claude 내보내기, Gemini Takeout 활동 기록만 지원. Grok은 아직)');
  if (kind === 'gemini') return parseGemini({ json: data }, { zipped }, opts.gemini);
  return kind === 'chatgpt'
    ? parseChatgpt(data, zipped ? 'chatgpt_export_zip' : 'chatgpt_conversations_json')
    : parseClaude(data, zipped ? 'claude_export_zip' : 'claude_conversations_json');
}

/** 1.10.0 Grok Bot: Claude conversations.json 모양 → sourceAi 'grokbot'. (source_ai, source_id)가 키라 같은 uuid의 Claude 대화와 섞이지 않음, 대화 id도 conv_grokbot_… */
function asGrokbot(r: ParseResult): ParseResult {
  if (r.sourceAi !== 'claude') throw new UnsupportedFileError('Grok Bot 파일은 Claude conversations.json 모양이어야 해요');
  return { ...r, sourceAi: 'grokbot', detectedFormat: 'grokbot_json', conversations: r.conversations.map((c) => ({ ...c, sourceAi: 'grokbot', url: null, inServiceProject: false })) };
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** 새 Claude 내보내기(2026-10)의 projects/ · memories/ 카테고리 ZIP이면 CategoryZipError, 아니면 그냥 돌아온다 */
function detectCategoryZip(bytes: Uint8Array): void {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes, { filter: (f) => /(^|\/)(projects|memories)\/[^/]+\.json$/i.test(f.name) }); } catch { return; }
  const names = Object.keys(files);
  const proj = names.filter((n) => /(^|\/)projects\/[^/]+\.json$/i.test(n));
  const mem = names.filter((n) => /(^|\/)memories\/[^/]+\.json$/i.test(n));
  if (proj.length && proj.length >= mem.length) {
    const projects: ClaudeProjectRecord[] = [];
    for (const n of proj.sort()) {
      try {
        const d = JSON.parse(strFromU8(files[n]!).replace(/^\uFEFF/, '')) as Record<string, unknown>;
        const uuid = str(d.uuid);
        if (!uuid) continue;
        projects.push({ uuid, name: (str(d.name) ?? '').trim(), isStarter: d.is_starter_project === true, createdAt: str(d.created_at), updatedAt: str(d.updated_at) });
      } catch { /* 깨진 파일은 건너뜀 */ }
    }
    throw new CategoryZipError('projects', projects, proj.length);
  }
  if (mem.length) throw new CategoryZipError('memories', [], mem.length);
}

/** 1.2.0 Takeout ZIP 안 Gemini 앱 활동 파일. JSON이 있으면 JSON, 없으면 HTML. 이름이 MyActivity/내활동인 파일을 먼저 */
function parseGeminiZip(bytes: Uint8Array, opts: ParseOptions): ParseResult | null {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes, { filter: (f) => isGeminiZipEntry(f.name) }); } catch { return null; }
  const rank = (n: string) => (/(^|\/)(my\s*activity|내\s*활동|활동)\.[a-z]+$/i.test(n) ? 0 : 2) + (/\.json$/i.test(n) ? 0 : 1);
  const names = Object.keys(files).sort((a, b) => rank(a) - rank(b) || a.length - b.length);
  for (const n of names) {
    const text = strFromU8(files[n]!).replace(/^\uFEFF/, '');
    if (/\.json$/i.test(n)) {
      let data: unknown;
      try { data = JSON.parse(text); } catch { continue; }
      if (looksLikeGeminiActivity(data)) return parseGemini({ json: data }, { zipped: true, path: n }, opts.gemini);
      if (Array.isArray(data) && !data.length && rank(n) === 0) return parseGemini({ json: data }, { zipped: true, path: n }, opts.gemini); // 빈 기록 → 친절한 오류
    } else if (looksLikeGeminiHtml(text) || (rank(n) <= 1 && /class="outer-cell/.test(text))) {
      return parseGemini({ html: text }, { zipped: true, path: n }, opts.gemini);
    }
  }
  return null;
}
