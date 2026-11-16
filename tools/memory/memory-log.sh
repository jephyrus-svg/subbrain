#!/usr/bin/env bash
# bash memory-log.sh [개수=15]  — 최근 변경(커밋) 목록 + 바뀐 파일 수
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"; need_repo
mgit log -n "${1:-15}" --date=format:'%Y-%m-%d %H:%M' --pretty='%h  %ad  %an: %s' --shortstat | sed '/^$/d'
[ -z "$(mgit status --porcelain)" ] || { echo "(커밋 안 된 변경이 있어요:)"; mgit status --short; }
