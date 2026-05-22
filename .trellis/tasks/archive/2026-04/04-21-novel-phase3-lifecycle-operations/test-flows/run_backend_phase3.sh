#!/usr/bin/env bash
set -euo pipefail

ROOT="/mnt/d/miaowu-os/deer-flow-main/backend"
cd "$ROOT"

echo "[phase3][backend] ruff"
./.venv/bin/ruff check app/gateway tests

echo "[phase3][backend] pyright (optional if configured)"
if [ -f "pyproject.toml" ] && grep -q "pyright" pyproject.toml; then
  ./.venv/bin/pyright || true
fi

echo "[phase3][backend] targeted pytest - action router and lifecycle"
./.venv/bin/pytest -q \
  tests/test_intent_recognition_middleware.py \
  tests/test_novel_orchestration_recovery.py \
  tests/test_novel_consistency_gate.py \
  tests/test_ai_provider_intent_routing.py \
  tests/test_intent_observability.py

echo "[phase3][backend] contract-oriented pytest pack"
./.venv/bin/pytest -q \
  tests/test_features_router_rollout.py \
  tests/test_extensions_feature_rollout.py \
  tests/test_request_trace_middleware.py

echo "[phase3][backend] done"
