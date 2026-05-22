#!/usr/bin/env bash
set -euo pipefail

ROOT="/mnt/d/miaowu-os/deer-flow-main"
cd "$ROOT"

echo "[phase3][contract] backend API contract tests"
cd backend
./.venv/bin/pytest -q \
  tests/test_intent_integration_imports.py \
  tests/test_ai_provider_messages_error_handling.py
cd ..

echo "[phase3][e2e] dialogue lifecycle scenario placeholders"
# These commands are placeholders for the implementation stage.
# Suggested tooling options:
# 1) pytest + httpx against local gateway
# 2) playwright for end-to-end UI + API assertions
#
# Example placeholder commands:
# cd backend && ./.venv/bin/pytest -q tests/e2e/test_dialogue_novel_lifecycle.py
# cd frontend && pnpm exec playwright test tests/e2e/novel-lifecycle.spec.ts

echo "[phase3][contract/e2e] done"
