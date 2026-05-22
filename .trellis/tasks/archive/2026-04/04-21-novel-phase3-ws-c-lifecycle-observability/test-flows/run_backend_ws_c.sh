#!/usr/bin/env bash
set -euo pipefail

WS_TAG="WS-C"
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

echo "[${WS_TAG}] 后端测试流程脚本（本阶段仅提供，不执行）"
run_step "cd '${BACKEND_DIR}' && uv run ruff check app/gateway/novel_migrated/services/lifecycle_service.py app/gateway/novel_migrated/services/orchestration_service.py app/gateway/novel_migrated/services/consistency_gate_service.py app/gateway/observability/context.py tests/test_lifecycle_service.py tests/test_novel_orchestration_recovery.py tests/test_novel_consistency_gate.py"
run_step "cd '${BACKEND_DIR}' && uv run pytest -q tests/test_lifecycle_service.py tests/test_novel_orchestration_recovery.py tests/test_novel_consistency_gate.py"

echo "[${WS_TAG}] 完成。若需实际执行，请设置 DRY_RUN=0。"
