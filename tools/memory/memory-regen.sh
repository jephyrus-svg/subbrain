#!/usr/bin/env bash
# bash memory-regen.sh <toc-latest.tgz | 스냅샷폴더> [--dry-run]
# 새 스냅샷을 합친다: 자동 구역 교체, 내 메모·다음 할 일 수정 보존, 사라진 id는 _orphans/로. 합치기 전에 커밋 안 된 편집은 먼저 커밋(잃지 않게). 끝나면 커밋 하나.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
SRC="${1:?usage: memory-regen.sh <toc-latest.tgz|dir> [--dry-run]}"; DRY=""; [ "${2:-}" = "--dry-run" ] && DRY="--dry-run"
[ -d "$MEMORY_DIR/.git" ] || bash "$TOOLS/memory-init.sh"
lock
if [ -d "$SRC" ]; then SNAP="$SRC"; else
  [ -f "$SRC" ] || { echo "없음: $SRC"; exit 1; }
  if tar tzf "$SRC" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then echo "❌ 위험한 경로"; exit 1; fi
  SNAP="$(mktemp -d)"; tar xzf "$SRC" -C "$SNAP"
  grep -q '"includesRawConversations": false' "$SNAP/MANIFEST.json" || { echo "❌ 목차 스냅샷이 아니거나 원문 포함 여부 불명"; exit 1; }
fi
if [ -z "$DRY" ] && [ -n "$(mgit status --porcelain)" ]; then mgit add -A; mgit commit -q -m "pre-regen: 커밋 안 된 편집 저장" && echo "(커밋 안 된 편집을 먼저 저장: $(mgit rev-parse --short HEAD))"; fi
OUT="$(node "$TOOLS/memory-merge.mjs" --snap "$SNAP" --mem "$MEMORY_DIR" $DRY)"; echo "$OUT"
[ -n "$DRY" ] && exit 0
if grep -q '<!-- PENDING -->' "$MEMORY_DIR/README.md" 2>/dev/null; then printf '# 서브브레인 메모리\n`index.md`부터 읽으세요(작동 방식: `MEMORY.md`). 스냅샷 시각은 `MANIFEST.json`.\n' > "$MEMORY_DIR/README.md"; fi
MEMORY_ALLOW_AUTO=1 node "$TOOLS/memory-check.mjs" "$MEMORY_DIR"
G="$(grep -o '"generatedAt": "[^"]*"' "$MEMORY_DIR/MANIFEST.json" | cut -d'"' -f4)"
mgit add -A
if [ -z "$(mgit status --porcelain)" ]; then echo "변경 없음(이미 같은 스냅샷)"; else mgit commit -q -m "regen: 스냅샷 $G — $(echo "$OUT" | tail -1 | sed 's/^병합: //')" && echo "✅ 커밋 $(mgit rev-parse --short HEAD)"; fi
