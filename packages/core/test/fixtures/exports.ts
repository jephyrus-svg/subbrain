/**
 * 합성 내보내기 파일 (테스트용). 실제 사용자 데이터 아님.
 * 형식은 공개적으로 알려진 모양을 따른다 — [추정/미검증] 공식 스키마 문서가 없어 필드가 바뀔 수 있음:
 *  - ChatGPT conversations.json: [{ id, title, create_time(초), update_time, current_node, mapping: { [nodeId]: { id, parent, children, message } } }]
 *    message = { id, author:{role}, create_time, content:{content_type:'text', parts:[...]}, metadata, recipient }
 *    편집하면 트리에 가지가 생기고 current_node가 보이는 가지의 끝을 가리킨다.
 *  - Claude conversations.json: [{ uuid, name, created_at(ISO), updated_at, chat_messages:[{ uuid, sender:'human'|'assistant', text, content:[{type,text}], created_at, attachments, files, parent_message_uuid? }] }]
 */
const t = (iso: string) => Date.parse(iso) / 1000;
type Node = { id: string; parent: string | null; children: string[]; message: Record<string, unknown> | null };

function cgMsg(id: string, role: string, text: string, at: string, extra: Record<string, unknown> = {}) {
  return { id, author: { role }, create_time: t(at), content: { content_type: 'text', parts: [text] }, metadata: {}, recipient: 'all', ...extra };
}

/** ChatGPT: 가지가 있는 대화 1개 + 짧은 질문 1개 + current_node 없는 대화 1개 */
export function chatgptConversations(opts: { extraTurn?: boolean } = {}): unknown[] {
  const m: Record<string, Node> = {
    root: { id: 'root', parent: null, children: ['sys'], message: null },
    sys: { id: 'sys', parent: 'root', children: ['u1'], message: cgMsg('sys', 'system', '시스템 프롬프트', '2026-09-20T12:00:00Z') },
    u1: { id: 'u1', parent: 'sys', children: ['a1'], message: cgMsg('u1', 'user', '이사업체 견적을 표로 비교하고 싶어.', '2026-09-20T12:00:10Z') },
    a1: { id: 'a1', parent: 'u1', children: ['u2old', 'u2new'], message: cgMsg('a1', 'assistant', '좋아요. 업체 이름과 금액을 알려 주세요.', '2026-09-20T12:00:20Z') },
    u2old: { id: 'u2old', parent: 'a1', children: ['a2old'], message: cgMsg('u2old', 'user', '(옛 가지) A업체 200만', '2026-09-20T12:01:00Z') },
    a2old: { id: 'a2old', parent: 'u2old', children: [], message: cgMsg('a2old', 'assistant', '(옛 가지 답)', '2026-09-20T12:01:10Z') },
    u2new: { id: 'u2new', parent: 'a1', children: ['hidden'], message: cgMsg('u2new', 'user', 'A업체 180만, C업체 165만이야.', '2026-09-20T12:02:00Z') },
    hidden: { id: 'hidden', parent: 'u2new', children: ['a2new'], message: cgMsg('hidden', 'assistant', '숨김', '2026-09-20T12:02:05Z', { metadata: { is_visually_hidden_from_conversation: true } }) },
    a2new: { id: 'a2new', parent: 'hidden', children: [], message: cgMsg('a2new', 'assistant', '표로 정리했어요. B업체는 답을 기다리는 중이죠?', '2026-09-20T12:02:30Z') },
  };
  let current = 'a2new';
  if (opts.extraTurn) {
    m.a2new!.children = ['u3'];
    m.u3 = { id: 'u3', parent: 'a2new', children: ['a3'], message: cgMsg('u3', 'user', 'B업체 답장이 오면 내일 다시 볼게.', '2026-09-21T12:00:00Z') };
    m.a3 = { id: 'a3', parent: 'u3', children: [], message: cgMsg('a3', 'assistant', '좋아요, 내일 이어서 해요.', '2026-09-21T12:00:10Z') };
    current = 'a3';
  }
  const quick: Record<string, Node> = {
    q0: { id: 'q0', parent: null, children: ['q1'], message: null },
    q1: { id: 'q1', parent: 'q0', children: ['q2'], message: cgMsg('q1', 'user', 'CSS clamp 함수가 뭐야?', '2026-09-22T01:00:00Z') },
    q2: { id: 'q2', parent: 'q1', children: [], message: cgMsg('q2', 'assistant', 'clamp(최솟값, 선호값, 최댓값)으로 범위를 정해요.', '2026-09-22T01:00:05Z') },
  };
  const noCurrent: Record<string, Node> = {
    n0: { id: 'n0', parent: null, children: ['n1'], message: null },
    n1: { id: 'n1', parent: 'n0', children: ['n2'], message: cgMsg('n1', 'user', '블로그 RSS 피드를 붙이려면 어떻게 해?', '2026-09-23T10:00:00Z') },
    n2: { id: 'n2', parent: 'n1', children: [], message: cgMsg('n2', 'assistant', 'app/feed.xml/route.ts에서 내보내면 돼요.', '2026-09-23T10:00:10Z') },
  };
  return [
    { id: '11111111-aaaa-4bbb-8ccc-000000000001', title: '이사업체 견적 비교', create_time: t('2026-09-20T12:00:00Z'), update_time: t(opts.extraTurn ? '2026-09-21T12:00:10Z' : '2026-09-20T12:02:30Z'), current_node: current, mapping: m },
    { id: '11111111-aaaa-4bbb-8ccc-000000000002', title: 'CSS clamp', create_time: t('2026-09-22T01:00:00Z'), update_time: t('2026-09-22T01:00:05Z'), current_node: 'q2', mapping: quick },
    { id: '11111111-aaaa-4bbb-8ccc-000000000003', title: '', create_time: t('2026-09-23T10:00:00Z'), update_time: t('2026-09-23T10:00:10Z'), mapping: noCurrent },
  ];
}

/** Claude: 내용 블록 + 첨부가 있는 대화 1개, 편집 가지가 있는 대화 1개 */
export function claudeConversations(): unknown[] {
  return [
    {
      uuid: '22222222-bbbb-4ccc-8ddd-000000000001', name: '온보딩 문구 다듬기', created_at: '2026-09-19T11:10:00Z', updated_at: '2026-09-19T11:40:00Z',
      chat_messages: [
        { uuid: 'c1', sender: 'human', text: '(text 필드)', content: [{ type: 'text', text: '첫 화면 문구를 3줄로 줄여 줘.' }], created_at: '2026-09-19T11:10:00Z', attachments: [{ file_name: 'draft.txt', extracted_content: '초안' }] },
        { uuid: 'c2', sender: 'assistant', text: '', content: [{ type: 'text', text: '세 줄 안을 드릴게요.' }, { type: 'tool_use', name: 'artifacts' }], created_at: '2026-09-19T11:11:00Z' },
        { uuid: 'c3', sender: 'human', text: '좋아, 이걸로 할게. 고마워!', created_at: '2026-09-19T11:40:00Z' },
      ],
    },
    {
      uuid: '22222222-bbbb-4ccc-8ddd-000000000002', name: '가지 있는 대화', created_at: '2026-09-24T11:00:00Z', updated_at: '2026-09-24T11:30:00Z',
      chat_messages: [
        { uuid: 'r1', sender: 'human', text: '볼트 노트 형식을 정하자.', created_at: '2026-09-24T11:00:00Z', parent_message_uuid: '00000000-0000-4000-8000-000000000000' },
        { uuid: 'r2', sender: 'assistant', text: 'frontmatter부터 볼까요?', created_at: '2026-09-24T11:01:00Z', parent_message_uuid: 'r1' },
        { uuid: 'r3old', sender: 'human', text: '(옛 가지) 본문 먼저', created_at: '2026-09-24T11:02:00Z', parent_message_uuid: 'r2' },
        { uuid: 'r3new', sender: 'human', text: '응, frontmatter 필드 목록을 줘.', created_at: '2026-09-24T11:05:00Z', parent_message_uuid: 'r2' },
        { uuid: 'r4', sender: 'assistant', text: 'id, status, project, updated 를 추천해요.', created_at: '2026-09-24T11:30:00Z', parent_message_uuid: 'r3new' },
      ],
    },
  ];
}

export const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
