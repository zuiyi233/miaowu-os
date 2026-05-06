# PRD: Backend Core Audit & Backfill for Upstream Alignment (1336872b / 4ead2c6b)

## Background
Current branch `merge/upstream-main` contains local secondary-development changes plus upstream sync. User requests a backend-only focused audit within a fixed file scope to ensure upstream alignment does not break local custom behavior.

## Scope
Only these paths are in-scope:
- `deer-flow-main/backend/app/channels/manager.py`
- `deer-flow-main/backend/app/gateway/routers/agents.py`
- `deer-flow-main/backend/packages/harness/deerflow/agents/lead_agent/agent.py`
- `deer-flow-main/backend/packages/harness/deerflow/agents/lead_agent/prompt.py`
- `deer-flow-main/backend/packages/harness/deerflow/agents/middlewares/loop_detection_middleware.py`
- `deer-flow-main/backend/packages/harness/deerflow/community/aio_sandbox/remote_backend.py`
- `deer-flow-main/backend/packages/harness/deerflow/config/*.py`
- `deer-flow-main/backend/packages/harness/deerflow/tools/builtins/{__init__.py,setup_agent_tool.py,update_agent_tool.py}`

Out of scope:
- Any frontend code/file changes.
- Unrelated backend refactors.

## Goals
1. Verify whether there are unresolved logical gaps after aligning with upstream latest 7 commits.
2. Pay special attention to logic related to commits `1336872b` and `4ead2c6b`.
3. If explicit logic gaps are found in scoped files, fix them directly.
4. Run minimal backend validation:
   - `compileall`
   - targeted `pytest` set related to touched logic

## Acceptance Criteria
- No conflict-marker leftovers and no identified logic gaps left unfixed in scope.
- Any implemented fix is limited to scoped backend files.
- Validation outputs collected:
  - compileall pass/fail with command evidence
  - related pytest command(s) pass/fail with evidence
- Final report includes:
  - changed files
  - verification commands and results
  - remaining blockers or explicit none
