#!/usr/bin/env bash
# bash memory-collect.sh [--dry-run] [--pack]
# 지난 동기화 이후 바뀐 과제 메모·다음 할 일 수정을 $MEMORY_OUT/writeback-<ts>.json 로 모으고(기준선은 _sync/state.json, 커밋됨),
# --pack 이면 outbox 전체를 $MEMORY_OUT/writeback-pack-<ts>.tgz 로 묶는다(코어 컴퓨터는 key로 중복 방지하니 매번 전체를 보내도 안전).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"; need_repo; lock
DRY=""; PACK=""; for a in "$@"; do [ "$a" = "--dry-run" ] && DRY="--dry-run"; [ "$a" = "--pack" ] && PACK=1; done
if [ -z "$DRY" ] && [ -n "$(mgit status --porcelain)" ]; then echo "ℹ 커밋 안 된 편집이 있어요 — 먼저 memory-commit.sh 로 저장하세요(수집은 파일 내용 기준이라 계속 진행)."; fi
node "$TOOLS/memory-collect.mjs" --mem "$MEMORY_DIR" --out "$OUT_DIR/memory-writeback" $DRY
if [ -z "$DRY" ]; then mgit add -A; [ -z "$(mgit status --porcelain)" ] || { mgit commit -q -m "collect: 기준선 갱신" && echo "(기준선 커밋 $(mgit rev-parse --short HEAD))"; }; fi
if [ -n "$PACK" ] && [ -z "$DRY" ]; then n=$(ls "$OUT_DIR/memory-writeback"/*.json 2>/dev/null | wc -l); [ "$n" -gt 0 ] || { echo "묶을 outbox 파일이 없어요"; exit 0; }
  T="$OUT_DIR/writeback-pack-$(date +%Y%m%d-%H%M%S).tgz"; tar czf "$T" -C "$OUT_DIR" memory-writeback && echo "✅ $T ($n개 파일) → <SUBBRAIN_ROOT>/inbox/incoming/ 로 복사 후 memory-pull.sh"; fi
