#!/usr/bin/env bash
# bash memory-revert.sh <커밋>  — 그 커밋의 변경을 되돌리는 **새 커밋**을 만든다(기록은 그대로 남음, reset·강제 없음). 충돌이 나면 중단하고 원상태 유지.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
C="${1:?usage: memory-revert.sh <commit>}"; need_repo; lock
mgit rev-parse --verify -q "$C^{commit}" >/dev/null || { echo "❌ 없는 커밋: $C"; exit 1; }
[ -z "$(mgit status --porcelain)" ] || { echo "❌ 커밋 안 된 변경이 있어요. 먼저: bash $TOOLS/memory-commit.sh \"메시지\""; exit 1; }
[ "$(mgit rev-list --count --parents -n1 "$C" | awk '{print NF-1}')" -le 1 ] || { echo "❌ 병합 커밋은 지원 안 해요"; exit 1; }
if mgit -c user.name="${BOT_NAME:-revert}" -c user.email="memory@localhost" revert --no-edit "$C" >/tmp/memrev.$$ 2>&1; then echo "✅ 되돌림 커밋 $(mgit rev-parse --short HEAD) (대상 $(mgit rev-parse --short "$C"))"
else cat /tmp/memrev.$$; mgit revert --abort >/dev/null 2>&1 || true; echo "❌ 충돌로 중단했고 폴더는 그대로예요(기록 손상 없음)."; exit 1; fi
