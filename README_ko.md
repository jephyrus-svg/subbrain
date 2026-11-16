# 서브브레인 (Subbrain)

**AI 대화를 위한 로컬 우선 작업 기억 장치.** ChatGPT·Claude·Gemini·Grok 대화(그리고 Claude Code·Codex 세션)를 모아 **완료·진행 중·멈춤**을 가려내고, **프로젝트 → 과제 → 다음 할 일**로 묶어 줍니다. 어떤 AI 에이전트든 **단계별 목차(MCP)**를 따라 필요한 만큼만 읽고 이어서 작업할 수 있어요.

> **상태: v0.1.0-alpha.** 실제 데이터로 끝까지 동작하지만 거친 부분이 있어요([알려진 한계](#알려진-한계)). 모든 것이 내 컴퓨터에서 돌고, 직접 설정한 LLM 분류 호출(선택) 말고는 아무것도 밖으로 나가지 않아요.

## 무엇이 다른가

- **대화 상태 분류:** 대화마다 상태(완료·진행 중·멈춤·간단한 질문)와 결과(끝남·다른 곳으로 옮김·끊김·진행 중)를 붙여요. "내일 이어서 하자"는 완료가 아니고, "md로 정리해줘, Claude Code에서 이어갈게"는 버린 게 아니라 옮긴 거예요.
- **프로젝트·과제 묶기와 다음 할 일:** 같은 목표의 대화를 과제로 합치고, 과제를 프로젝트로 묶고, 과제마다 한 줄 다음 할 일을 둬요(직접 고친 값은 자동 분류가 덮어쓰지 않음).
- **주간 돌아보기:** 끝낸 일·시작한 일·멈춘 일·오래 방치한 일을 규칙으로 계산(LLM 비용 0).
- **보관만 하는 정리:** 끝난 대화는 원문을 한 번 더 내보낸 뒤 원래 서비스에서 보관하도록 안내만 해요. 지우지 않고, 브라우저를 움직이지 않아요.
- **단계별 목차(MCP):** `toc_index` → `toc_project` → `toc_task` → `toc_conversation_excerpt`. 에이전트가 2KB짜리 목차부터 읽고 필요한 곳만 내려가요. 🔒 민감 프로젝트는 빠지고 사람 이름은 가려져요.
- **함께 고치는 기억 폴더:** `tools/memory/`가 목차를 마크다운 폴더(로컬 git)로 옮겨 둬요. 봇들이 읽고 '내 메모'에 덧붙이고, 모든 변경은 되돌릴 수 있어요.

## 빠른 시작

**Node 22.16 이상**이 필요해요(내장 `node:sqlite` + FTS5 사용, 22.13~22.15에는 FTS5가 없음). Node 22.23·24.22에서 확인했어요.

```bash
git clone https://github.com/<계정>/subbrain.git
cd subbrain
npm run setup      # 의존성 설치, 웹 빌드, 가짜 예시 데이터 생성, (선택) Gemini 키 입력
npm run demo -- --lang ko   # → http://127.0.0.1:4545/?lang=ko (한국어 예시 데이터, 키·네트워크 불필요)
npm run demo                # 영어 데모(가상의 1인 개발자 예시 데이터)
```

> `pnpm setup`은 pnpm 자체 명령이라 `npm run setup`(또는 `pnpm run setup`)을 쓰세요.

내 데이터로 쓰려면:

```bash
npm run import -- ~/Downloads/chatgpt-export.zip     # ChatGPT: 설정 → 데이터 제어 → 데이터 내보내기
npm run import -- ~/Downloads/claude-export.zip      # Claude: 설정 → 개인정보 → 데이터 내보내기
npm run import -- ~/Downloads/takeout.zip            # Gemini: takeout.google.com → 내 활동 → Gemini 앱
npm run app                                          # → http://127.0.0.1:4545, 데이터는 ~/.subbrain
```

- **키가 없어도** 내장 규칙 분류기로 모두 동작해요(무료·오프라인). 분류 없이 넣으려면 `--no-classify`.
- **Gemini 키**(선택): `npm run setup` 중 또는 설정 화면에서 입력. `~/.subbrain/secrets.json`(권한 600)에만 저장돼요. 하루 비용 상한(기본 $10)을 넘으면 나머지는 미뤄져요.
- LLM에 보내기 전에 대화 속 API 키·이메일·전화번호·카드번호 등을 가려요.

### 언어

- 기본은 영어. `--lang ko`(또는 `SUBBRAIN_LANG=ko`)를 주면 예시 데이터, 서버가 만드는 문장(아침 요약, 다음 할 일 근거, 멈춤 라벨, 규칙 분류기 요약, 목차·MCP 문장, 터미널 메시지), 분류 프롬프트가 한국어가 돼요: `npm run demo -- --lang ko`, `npm run app -- --lang ko`.
- 화면만 바꾸려면 주소 끝에 `?lang=ko` 또는 상단의 한국어/EN 버튼(화면 언어와 서버 언어는 따로라 섞으면 글이 섞여요).
- 데모는 `npm run demo` 때마다 예시 데이터를 다시 넣어 날짜가 늘 오늘 기준이에요. 그대로 두려면 `--keep`.

## 알려진 한계

- 알파 버전이라 API·DB 구조가 바뀔 수 있어요(마이그레이션은 자동, 그래도 `~/.subbrain` 백업 권장).
- 아직 한국어만 있는 것: Obsidian 볼트 노트, 목차 외 MCP 도구 설명, 온톨로지 추출 프롬프트, 드문 API 오류 문구, `docs/` 문서, API 계약서, 코드 주석, 저장되는 상태 값(`진행 중`·`멈춤` 등, 화면에서 번역).
- 시간·하루 경계는 시스템 시간대 기준이에요(시작할 때 고정, `SUBBRAIN_UTC_OFFSET=+09:00`으로 지정 가능). 서머타임이 바뀌면 코어를 다시 시작하세요.
- 키 없는 규칙 분류기는 LLM보다 정확도가 낮아요.
- 채팅창 정리는 표시·보관 안내만 하고, 실제 삭제 실행기는 꺼져 있어요.
- 크롬 확장은 ChatGPT·Claude 화면 구조가 바뀌면 고장 날 수 있어요.
- macOS·Linux에서 시험했고 Windows는 아직이에요.

## 라이선스

[MIT](LICENSE) © Subbrain Contributors
