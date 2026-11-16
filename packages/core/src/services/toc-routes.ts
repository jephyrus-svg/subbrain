/** 목차(TOC) 라우트 — /api/v1/toc*, POST /api/v1/mcp/toc-note(쓰기: mcp_write 범위). server.ts에서 한 줄로 등록. */
import type { Hono } from 'hono';
import { z } from 'zod';
import type { Core } from '../core.ts';
import { ApiError, fromZod } from '../util/errors.ts';
import { tocConversation, tocIndex, tocNote, tocNoteUndo, tocProject, tocTask, type TocResponse } from './toc.ts';

const flag = z.enum(['1', '0', 'true', 'false']).optional().transform((v) => v === '1' || v === 'true');
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max).optional();
const QBase = { format: z.enum(['json', 'text']).optional() };
const IndexQ = z.object({ ...QBase, offset: int(0, 10000), limit: int(1, 200), includeArchived: flag }).strict();
const ListQ = z.object({ ...QBase, offset: int(0, 10000), limit: int(1, 200), includeQuick: flag }).strict();
const ConvQ = z.object({ ...QBase, offset: int(0, 1000000), from: int(0, 10000000), limit: int(500, 8000) }).strict();
const NoteB = z.object({ taskId: z.string().min(1), progress: z.string().max(300).nullable().optional(), nextStep: z.string().max(300).nullable().optional(), sourceAi: z.string().max(40).nullable().optional() }).strict();
const UndoB = z.object({}).strict();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerTocRoutes(api: Hono<any>, core: Core): void {
  const parse = <T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> => { const r = schema.safeParse(raw); if (!r.success) throw fromZod(r.error); return r.data; };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const send = (c: any, fmt: 'json' | 'text' | undefined, r: TocResponse) => (fmt === 'text' ? c.text(r.text) : c.json(r));
  api.get('/toc', (c) => { const q = parse(IndexQ, c.req.query()); return send(c, q.format, tocIndex(core, q)); });
  api.get('/toc/project/:id', (c) => { const q = parse(ListQ, c.req.query()); return send(c, q.format, tocProject(core, c.req.param('id'), q)); });
  api.get('/toc/task/:id', (c) => { const q = parse(ListQ, c.req.query()); return send(c, q.format, tocTask(core, c.req.param('id'), q)); });
  api.get('/toc/conversation/:id', (c) => { const q = parse(ConvQ, c.req.query()); return send(c, q.format, tocConversation(core, c.req.param('id'), q)); });
  api.post('/mcp/toc-note', async (c) => {
    const text = await c.req.text();
    let raw: unknown = {};
    try { raw = text.trim() ? JSON.parse(text) : {}; } catch { throw new ApiError('VALIDATION_ERROR', '본문이 올바른 JSON이 아니에요.', { issues: [{ path: '(본문)', message: 'JSON 파싱 실패' }] }); }
    return c.json(tocNote(core, parse(NoteB, raw), c.get('client')?.tokenId ?? null), 201);
  });
  api.post('/mcp/toc-note/:eventId/undo', async (c) => { parse(UndoB, JSON.parse((await c.req.text()).trim() || '{}')); return c.json(tocNoteUndo(core, Number(c.req.param('eventId')))); });
}
