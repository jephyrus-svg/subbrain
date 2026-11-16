# 목차(TOC) 읽기 경로 — AI가 최소한만 읽고 한 단계씩 내려가기

LLM(Gemini 등)을 부르지 않고, 이미 저장된 기록(프로젝트·과제·분류 요약·결정·대화)만으로 만든 4단계 목차입니다.

| 단계 | 엔진 API (`/api/v1`) | MCP 도구 | 내용 | 상한 |
|---|---|---|---|---|
| L1 | `GET /toc` | `toc_index` | 프로젝트 목록: id·이름·상태·한 줄 요약·과제 수·최근 활동 | 3,500자 |
| L2 | `GET /toc/project/:id` (`none`=프로젝트 없음) | `toc_project` | 그 프로젝트 과제: 상태·진행(요약)·다음 단계(+출처 태그)·핵심 결정 | 5,500자 |
| L3 | `GET /toc/task/:id` | `toc_task` | 과제 요약·결정·남은 질문·메모 + 관련 대화 목록(AI·날짜·한 줄 요약·대화 id) | 5,500자 |
| L4 | `GET /toc/conversation/:id?offset&from&limit` | `toc_conversation_excerpt` | 원문 한 토막(쪽 나눔: 기본 3,000자·최대 8,000자, 메시지당 1,500자) | 8,000자 |

- 각 응답: `{ level, text, chars, children[{id,label}], drill, next, truncated }`. `?format=text`면 본문만.
- 목록이 길면 `… 더 있음 → offset=N` 안내. L4는 `offset`(메시지 번호)·`from`(긴 메시지 안 글자 위치)로 이어 읽기.
- 민감 프로젝트(설정의 sensitiveProjectIds·sensitiveKeywords)는 🔒로 가리고 L3·L4도 막습니다. 사람 이름 가림은 MCP 쪽에서 기존 설정대로.
- 다음 단계 출처 태그: `[내가 정함]`(사용자/메모로 정한 값) · `[저장]`(분류 결과) · `[규칙]`(규칙으로 만든 문장).

## 쓰기(작게, 삭제 없음) — MCP `--write`일 때만 보임
- `toc_update_task(task_id, progress?, next_step?)` → `POST /api/v1/mcp/toc-note`. 진행 메모는 events(`toc_note`, actor mcp)에 남고 L2·L3에 보임. next_step을 주면 그 과제의 다음 단계가 “내가 정함”으로 저장(분류가 다시 돌아도 안 덮임).
- `toc_undo_update(event_id)` → `POST /api/v1/mcp/toc-note/:eventId/undo`. 다음 단계는 이전 값으로, 메모는 숨김. 민감 과제에는 쓸 수 없음.

## Claude에서 쓰는 법
> 서브브레인 목차로 내 작업을 파악해줘. 항상 toc_index부터 보고, 관련 프로젝트 하나만 toc_project로, 필요한 과제 하나만 toc_task로 내려가. 원문(toc_conversation_excerpt)은 정말 필요할 때만 읽고, 어느 단계까지 읽었는지 알려줘.
