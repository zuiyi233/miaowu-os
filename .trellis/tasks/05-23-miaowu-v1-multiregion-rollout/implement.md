# Implementation Plan

1. Create Trellis artifacts manually because `task.py` is blocked by missing `common.safe_commit`.
2. Add a production multi-region runbook under `deer-flow-main/docs`.
3. Add a production env template for `xs.miaowu.bond` and shared data sources.
4. Add a production compose template for one stateless frontend/gateway node.
5. Add a smoke-check PowerShell script for repeated node validation.
6. Add object storage env alias support so the implementation matches the public rollout contract.
7. Add focused unit coverage for generic S3 alias handling.
8. Run targeted tests and syntax checks that do not require live servers.

## Validation

- `uv run pytest tests/test_novel_unified_persistence.py -q`
- `uv run python -m compileall app/gateway/novel_migrated/core/object_storage.py`
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-miaowu-multiregion.ps1 -Help`

## Rollback

- Revert the new docs/templates/script files.
- Revert `object_storage.py` and the new unit test if env alias behavior is not desired.
