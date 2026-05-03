# PRD

## Goal
Restore thread search compatibility and draft media cleanup behavior, and update upload router tests to match the current safe write contract.

## Requirements
1. `GET/POST /api/threads/search` must keep `thread_store` as the primary source, but also include checkpointer-only threads through a deduplicated fallback/merge path.
2. The fallback must preserve multi-user isolation. Thread entries already visible via `thread_store` must not be duplicated or broadened.
3. `get_thread()` and `get_thread_state()` must filter expired `draft_media` from channel values and write the cleaned checkpoint back when cleanup changed data. Cleanup failures must be best-effort and must not block the main response.
4. `tests/test_uploads_router.py` must be updated to reflect the current explicit config contract for `_auto_convert_documents_enabled(app_config)` and the safe upload write path using `O_NOFOLLOW`.
5. Do not weaken upload safety checks.

## Acceptance
- `ruff check` passes for touched backend files.
- `pytest` passes for:
  - `backend/tests/test_uploads_router.py`
  - `backend/tests/test_threads_router.py`
  - `backend/tests/test_run_worker_rollback.py`
  - `backend/tests/test_lead_agent_model_resolution.py`
