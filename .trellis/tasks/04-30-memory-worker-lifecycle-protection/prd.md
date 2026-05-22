# PRD — memory worker refactor + lifecycle protection

## Background
The current memory update queue still relies on `threading.Timer` and the synchronous `update_memory()` bridge, which repeatedly spins up `asyncio.run()` paths in the hot update flow. The gateway also launches several fire-and-forget tasks without a unified done-callback guard.

## Goals
### Goal A — Memory queue worker refactor
- Replace the timer-driven memory queue flush path with a single long-lived async worker running on one event loop.
- Keep `MemoryMiddleware.after_agent` limited to enqueueing conversation contexts.
- Use an internal `asyncio.Queue` + background task to batch and process updates.
- Avoid calling `asyncio.run()` from the main memory update flow.
- Stop the worker best-effort during application shutdown without blocking exit indefinitely.

### Goal B — Fire-and-forget lifecycle protection
- Attach a done callback to background tasks created in the gateway service layer and runtime worker layer.
- Ensure unhandled task exceptions are swallowed and logged instead of becoming unobserved task warnings.
- Add task names where practical so logs can identify the background work.
- Do not change public API behavior.

## Constraints
- Do not touch `ai_service`, `llm_error_handling`, or `backend-runner`.
- Keep the change focused on the owned backend files and tests.
- Preserve existing memory update semantics as much as possible while moving to async worker execution.

## Acceptance Criteria
- `MemoryUpdateQueue` no longer uses `threading.Timer` as the primary processing mechanism.
- Memory updates are processed by one async worker/task tied to a single loop.
- Shutdown stops the worker best-effort.
- `MemoryMiddleware.after_agent` still only enqueues memory work.
- Gateway background tasks have done callbacks that consume/log exceptions.
- Relevant tests are updated/added and pass.
- `python -m compileall backend/app backend/packages/harness/deerflow` succeeds.
