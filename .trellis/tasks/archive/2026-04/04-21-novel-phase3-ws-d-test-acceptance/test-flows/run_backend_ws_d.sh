#!/usr/bin/env bash
set -euo pipefail

WS_TAG="WS-D"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/deer-flow-main/backend"
DRY_RUN="${DRY_RUN:-1}"
RUN_FULL="${RUN_FULL:-0}"

run_step() {
  local cmd="$1"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[DRY-RUN][${WS_TAG}] $cmd"
  else
    eval "$cmd"
  fi
}

echo "[${WS_TAG}] 后端测试流程脚本（本阶段仅提供，不执行）"
run_step "cd '${BACKEND_DIR}' && uv run ruff check tests/novel_phase3/ws_d tests/contracts/novel_phase3/ws_d tests/e2e/novel_phase3/ws_d tests/load/novel_phase3/ws_d"
run_step "cd '${BACKEND_DIR}' && uv run pytest -q tests/novel_phase3/ws_d/test_ws_d_targeted_suite.py"

if [[ "${RUN_FULL}" == "1" ]]; then
  run_step "cd '${BACKEND_DIR}' && uv run pytest -q tests/test_intent_recognition_middleware.py tests/test_ai_provider_intent_routing.py tests/test_skill_governance_service.py tests/test_quality_gate_fusion_service.py tests/test_lifecycle_service.py tests/test_novel_orchestration_recovery.py tests/test_novel_consistency_gate.py"
else
  echo "[${WS_TAG}] 跳过全量扩展集（RUN_FULL=0）。"
fi

echo "[${WS_TAG}] 完成。若需实际执行，请设置 DRY_RUN=0。"
