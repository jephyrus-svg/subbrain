#!/usr/bin/env bash
# 코어 컴퓨터에서: bash scripts/memory-pull.sh [--apply]     (기본 dry-run)
# $SUBBRAIN_ROOT/inbox/incoming/ 의 가장 새 writeback-pack-*.tgz 를 inbox/ 에 풀고(→ inbox/memory-writeback/*.json) memory-writeback-apply.mjs 실행. 삭제 없음.
set -euo pipefail
ROOT="${SUBBRAIN_ROOT:-$HOME/.subbrain}"; APP="$(cd "$(dirname "$0")/.." && pwd)"; INC="$ROOT/inbox/incoming"
TGZ="$(ls -1t "$INC"/writeback-pack-*.tgz 2>/dev/null | head -1 || true)"; [ -n "$TGZ" ] || { echo "받은 묶음이 없어요: $INC/writeback-pack-*.tgz"; exit 1; }
if /usr/bin/tar tzf "$TGZ" </dev/null | grep -Eq '(^/|(^|/)\.\.(/|$))'; then echo "❌ 위험한 경로"; exit 1; fi
echo "묶음: $TGZ"; mkdir -p "$ROOT/inbox"; /usr/bin/tar xzf "$TGZ" -C "$ROOT/inbox" </dev/null
cd "$APP" && node scripts/memory-writeback-apply.mjs --dir "$ROOT/inbox/memory-writeback" "$@" </dev/null
