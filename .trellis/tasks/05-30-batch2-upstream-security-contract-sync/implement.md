# Batch2 Implementation Plan

## Ordered Steps

1. Update task artifacts and switch the task to `in_progress`.
2. Merge upstream message-normalization semantics into `backend/app/gateway/services.py`.
3. Extend `backend/tests/test_gateway_services.py` with contract regressions for metadata preservation and malformed input handling.
4. Merge upstream MCP secret-masking semantics into `backend/app/gateway/routers/mcp.py`, preserving local admin auth and `features`.
5. Add `backend/tests/test_mcp_config_secrets.py` covering helper logic and router round-trip behavior.
6. Run targeted backend regression tests and fix any failures.
7. Update backend spec / batch report with the new executable contract and conflict decisions.
8. Commit batch2 on a dedicated branch.

## Validation Commands

```powershell
pytest deer-flow-main/backend/tests/test_gateway_services.py -q
pytest deer-flow-main/backend/tests/test_mcp_config_secrets.py -q
pytest deer-flow-main/backend/tests/test_auth_middleware.py -q
pytest deer-flow-main/backend/tests/test_gateway_services.py deer-flow-main/backend/tests/test_mcp_config_secrets.py deer-flow-main/backend/tests/test_auth_middleware.py -q
```

## Review Gates

- Do not reintroduce upstream single-user assumptions.
- Do not leak secrets via GET response or persisted rewrite.
- Do not overwrite local `features` or unknown top-level extension config keys.
- Do not alter local-dev 8551 contract.

## Rollback Points

- Pre-batch2 branch snapshot: `backup-before-batch2-sync-20260530-034130`
- Last known stable implementation branch base: `codex/batch1-upstream-low-risk-sync` at commit `556cb97c`
