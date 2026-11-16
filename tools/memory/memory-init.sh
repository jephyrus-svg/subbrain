#!/usr/bin/env bash
# bash memory-init.sh  — 메모리 폴더를 만들고(이미 있으면 없는 것만 채움) 로컬 git 저장소로 초기화. 원격 없음. 기존 파일은 덮어쓰지 않음.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
mkdir -p "$MEMORY_DIR/projects" "$MEMORY_DIR/tasks" "$MEMORY_DIR/_orphans" "$MEMORY_DIR/_sync"
[ -d "$MEMORY_DIR/.git" ] || { git -C "$MEMORY_DIR" init -q -b main 2>/dev/null || git -C "$MEMORY_DIR" init -q; }
mgit config user.name "subbrain-memory"; mgit config user.email "memory@localhost"; mgit config commit.gpgsign false
[ -e "$MEMORY_DIR/MEMORY.md" ] || cat > "$MEMORY_DIR/MEMORY.md" <<'M'
# MEMORY — 이 폴더가 하는 일 (짧게)
서브브레인(코어 컴퓨터)의 목차 스냅샷을 봇 컴퓨터에 옮겨 둔 **읽기·메모용 폴더**예요. 코어 컴퓨터가 꺼져 있어도 봇이 읽을 수 있어요.

- 읽는 순서: `index.md`(프로젝트 목록) → `projects/<id>.md` → `tasks/<id>.md`. 한 번에 한 단계, 필요한 것만. `MANIFEST.json`의 `generatedAt`이 스냅샷 시각.
- 각 파일 = **자동 구역**(`AUTO:START…AUTO:END`, 새 스냅샷이 오면 통째로 바뀜 — 고치지 말 것) + **`내 메모`** 블록(사람·봇이 적는 곳, 갱신해도 보존됨) + (과제 파일) **`다음 할 일 수정`** 블록(한 줄, 서브브레인에 보낼 새 다음 할 일).
- 메모는 한 줄씩 추가: `- 2026-10-28 [봇이름] 내용`. 적은 뒤 `bash tools/memory/memory-commit.sh "메시지"`.
- `USER.md`: 사용자에 대한 메모(직접 편집, 갱신 때 절대 안 덮임). `_orphans/`: 사라진 id의 파일 보관(삭제 아님, 읽지 않음).
- 변경 기록은 이 폴더의 로컬 git(원격 없음). 최근 변경: `memory-log.sh`, 되돌리기: `memory-revert.sh <커밋>`(새 커밋으로 되돌림, 기록은 남음).
- 과제의 메모·다음 할 일 수정은 코어 컴퓨터가 켜지면 `memory-collect.sh --pack` → 코어 컴퓨터의 `memory-pull.sh`로 서브브레인에 반영돼요(삭제 없음, 되돌리기 가능).
M
[ -e "$MEMORY_DIR/USER.md" ] || cat > "$MEMORY_DIR/USER.md" <<'U'
# USER — 사용자에 대한 메모 (직접 편집 · 갱신 때 절대 덮어쓰지 않음)
<!-- 선호, 말투, 자주 쓰는 도구, 하지 말아야 할 일 등을 적어 두세요. 봇은 줄을 추가할 때 `- 날짜 [봇이름] 내용` 형식으로. -->
U
[ -e "$MEMORY_DIR/README.md" ] || cat > "$MEMORY_DIR/README.md" <<'R'
<!-- PENDING -->
# 서브브레인 메모리 — 스냅샷 대기 중
아직 코어 컴퓨터에서 만든 목차 스냅샷이 들어오지 않았어요(코어 컴퓨터가 켜질 때까지 대기). `index.md`가 없으면 **서브브레인 정보 없음**이라고 말하고, 사용자가 말해 주는 맥락으로 진행하세요.
작동 방식은 `MEMORY.md`를 보세요.
R
mkdir -p "$OUT_DIR"
if [ -z "$(mgit status --porcelain)" ] && mgit rev-parse HEAD >/dev/null 2>&1; then echo "이미 초기화됨, 변경 없음: $MEMORY_DIR"; else mgit add -A; mgit commit -q -m "init: 메모리 폴더 준비" && echo "✅ 초기화: $MEMORY_DIR ($(mgit rev-parse --short HEAD))"; fi
