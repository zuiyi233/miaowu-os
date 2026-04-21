#!/usr/bin/env bash
set -euo pipefail

WS_TAG="WS-A"
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
run_step "cd '${BACKEND_DIR}' && uv run ruff check app/gateway/middleware/domain_protocol.py app/gateway/middleware/intent_recognition_middleware.py app/gateway/api/ai_provider.py tests/test_intent_recognition_middleware.py tests/test_ai_provider_intent_routing.py"
run_step "cd '${BACKEND_DIR}' && uv run pytest -q tests/test_intent_recognition_middleware.py tests/test_ai_provider_intent_routing.py"

echo "[${WS_TAG}] 完成。若需实际执行，请设置 DRY_RUN=0。"
