# Batch2 Design

## Scope

This batch performs a selective semantic merge of two upstream fixes onto the local multi-user Miaowu-OS gateway base:

- `9c03a71`: preserve rich message metadata in `normalize_input()`
- `7ec8d3a`: mask sensitive MCP config values and preserve secrets across masked round-trips

Out of scope:

- MCP session pooling
- `frontend/src/core/threads/hooks.ts`
- static demo mode
- ToolOutputBudgetMiddleware
- any rollback of local multi-account / novel / runtime-provider customizations

## Merge Strategy

### 1. `backend/app/gateway/services.py`

Keep local file structure, runtime-provider logic, user-context injection, and multi-account feature routing intact.

Only replace the message normalization contract:

- use `BaseMessage` passthrough
- use `convert_to_messages([msg])` for dict messages
- preserve `additional_kwargs`, `id`, `name`, `tool_call_id`, and role fidelity
- raise `HTTPException(400)` for malformed entries with `input.messages[{index}]`

Rationale:

- local hand-written coercion currently strips attachment metadata and richer role information
- this is an HTTP boundary contract fix with minimal overlap with the multi-account code paths below it

### 2. `backend/app/gateway/routers/mcp.py`

Keep local admin-only access and existing `features` preservation.

Add upstream security helpers:

- `_MASKED_VALUE = "***"`
- `_mask_server_config()`
- `_merge_preserving_secrets()`

Update GET behavior:

- mask env/header values
- strip OAuth `client_secret` / `refresh_token`

Update PUT behavior:

- load raw on-disk JSON when present
- merge masked request values with existing secrets
- preserve extra top-level keys from raw config beyond `mcpServers`, `skills`, `features`
- still preserve local `features`

Rationale:

- this closes a clear secret-leak boundary without changing the local multi-user auth model
- preserving raw top-level keys avoids destructive rewrites of local extension configuration

## Validation Design

### `services.py`

Add regression coverage for:

- `additional_kwargs` and message identity preservation
- `BaseMessage` passthrough
- non-human roles
- malformed dict message => `HTTPException(400)` with index

### `mcp.py`

Add tests for:

- helper-level masking and merge behavior
- GET response masking through router integration
- PUT round-trip preserving secrets
- PUT preserving `features` and extra top-level keys such as `mcpInterceptors`

## Rollback Shape

- Branch-level rollback point: `backup-before-batch2-sync-20260530-034130`
- If batch2 introduces regressions, revert only the batch2 commit and keep batch1 (`556cb97c`) as the stable baseline
