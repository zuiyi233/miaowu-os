# P0: Event loop is closed stopgap

## Goal

Apply a narrow backend-only stopgap for the `Event loop is closed` failure without changing unrelated behavior.

## Requirements

1. `backend/app/gateway/novel_migrated/services/ai_service.py`
   - Expand the model cache key so it includes loop/thread scope in addition to `model`, `base_url`, and `api_key` hash.
   - Reuse model instances only within the same loop/thread scope.
   - `clear_model_cache()` must best-effort close cached model instances before dropping them.
   - Support both sync `close()` and async `aclose()` cleanup paths.
   - Cleanup failures must never escape `clear_model_cache()`.

2. `backend/packages/harness/deerflow/agents/middlewares/llm_error_handling_middleware.py`
   - Classify `RuntimeError("Event loop is closed")` as a retriable error reason, e.g. `loop_closed`.
   - On the first occurrence, perform a best-effort recovery action that clears the novel model cache.
   - Keep the existing retry budget / retry semantics for all other errors unchanged.
   - Import failure for the recovery action must be swallowed.

3. `.deer-flow/local-dev/backend-runner.ps1`
   - Default local-dev backend launch must not pass `--reload`.
   - Allow reload only when explicitly enabled via environment variable, e.g. `DEERFLOW_BACKEND_RELOAD=1`.

## Validation

- Add or update unit tests for the cache scoping and loop-closed retry/recovery behavior.
- Run `python -m compileall backend/app backend/packages/harness/deerflow`.

## Non-goals

- No unrelated refactors.
- No other behavior changes to LLM error handling.
- No frontend changes.
