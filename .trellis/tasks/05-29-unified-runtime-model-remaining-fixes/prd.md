# 补齐 unified runtime model remaining fixes

## Goal

Close the still-valid items from `deer-flow-main/docs/unified-runtime-model-remaining-fixes.md` without changing the already-fixed runtime model routing behavior.

## Requirements

- Fix backend cache capacity semantics for `/api/models` and `MemoryUpdater` so caches cannot exceed their configured maximum after insertion.
- Make `MemoryUpdater._model_cache` behave as LRU + TTL: valid hits refresh recency, expired entries are removed, and the oldest entry is evicted after overflow.
- Improve `AgentThreadContext` typing by removing `extends Record<string, unknown>` while preserving dynamic extension fields with an index signature.
- Remove redundant frontend `as string | undefined` assertions made unnecessary by the context type fix.
- Update `unified-runtime-model-remaining-fixes.md` so it records which items were already covered and which were completed in this task.
- Do not change main Agent, subagent, provider override, or ContextVar runtime key behavior.

## Acceptance Criteria

- [ ] Backend targeted tests pass for models router, gateway services, lead agent model resolution, subagent executor, task tool, title middleware, and memory updater.
- [ ] Frontend targeted model/input tests pass.
- [ ] Frontend typecheck either passes or any remaining failures are confirmed unrelated to this task.
- [ ] `git diff --stat` only includes task-relevant files and prior new-window changes.

## Notes

- This is a lightweight closure task; PRD-only is sufficient.
