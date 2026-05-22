#!/usr/bin/env bash
set -euo pipefail

WS_TAG="WS-D"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/deer-flow-main/backend"
DRY_RUN="${DRY_RUN:-1}"

run_step() {
  local cmd="$1"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[DRY-RUN][${WS_TAG}] $cmd"
  else
    eval "$cmd"
  fi
}

echo "[${WS_TAG}] 契约/E2E 测试流程脚本（本阶段仅提供，不执行）"
run_step "cd '${BACKEND_DIR}' && uv run pytest -q tests/contracts/novel_phase3/ws_d/ --maxfail=1"
run_step "cd '${BACKEND_DIR}' && uv run pytest -q tests/e2e/novel_phase3/ws_d/ --maxfail=1"
run_step "cd '${BACKEND_DIR}' && uv run pytest -q tests/load/novel_phase3/ws_d/ --maxfail=1"

echo "[${WS_TAG}] 完成。若需实际执行，请设置 DRY_RUN=0。"
