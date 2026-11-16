# 공통(source 해서 씀). MEMORY_DIR 로 폴더 변경 가능(시험용).
MEMORY_DIR="${MEMORY_DIR:-$HOME/subbrain-memory}"
OUT_DIR="${MEMORY_OUT:-$HOME/subbrain-memory-out}"
TOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mgit() { git -C "$MEMORY_DIR" "$@"; }
lock() { command -v flock >/dev/null 2>&1 && { exec 9>"$MEMORY_DIR/.git/memory.lock"; flock -w 30 9 || { echo "❌ 다른 작업이 진행 중이에요(잠금)"; exit 1; }; } || true; }
need_repo() { [ -d "$MEMORY_DIR/.git" ] || { echo "❌ $MEMORY_DIR 가 아직 초기화되지 않았어요: bash $TOOLS/memory-init.sh"; exit 1; }; }
