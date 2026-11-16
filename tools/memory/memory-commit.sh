#!/usr/bin/env bash
# bash memory-commit.sh [--fix-auto] "<메시지>" [봇이름]   — 편집 뒤 커밋. 자동 구역을 고쳤거나 표시가 망가졌으면 거부(메모 블록에만 쓰세요).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
FIX=""; [ "${1:-}" = "--fix-auto" ] && { FIX=1; shift; }
MSG="${1:?usage: memory-commit.sh [--fix-auto] \"<메시지>\" [봇이름]}"; BOT="${2:-${BOT_NAME:-bot}}"
need_repo; lock
[ -n "$(mgit status --porcelain)" ] || { echo "커밋할 변경이 없어요."; exit 0; }
MEMORY_FIX_AUTO="$FIX" node "$TOOLS/memory-check.mjs" "$MEMORY_DIR" || { echo "→ 커밋 안 함. 위 문제를 고친 뒤 다시."; exit 1; }
mgit add -A
mgit -c user.name="$BOT" -c user.email="memory@localhost" commit -q -m "$MSG"
echo "✅ 커밋 $(mgit rev-parse --short HEAD) by $BOT: $MSG"
