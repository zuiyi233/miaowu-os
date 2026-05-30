# Implement

1. Inspect current writing-skill rerank path, memory search path, and settings/frontend integration points to confirm exact edit targets.
2. Implement reusable `reranker_service.py` with:
   - config resolution
   - async entrypoint
   - sync entrypoint
   - safe parsing / fallback
3. Integrate `MemoryService.search_memories()`:
   - overfetch before rerank
   - rerank only after similarity filtering
   - clean fallback to original ranking
4. Migrate writing-skill runtime to the shared reranker service.
5. Add the minimum settings/frontend wiring needed for user-configurable rerank model selection if the current path is missing or incomplete.
6. Add/update tests for backend config resolution, rerank fallback, writing-skill ranking flow, and memory search flow.
7. Run targeted lint/tests.
8. If verification fails, fix or reduce scope until the task closes with a coherent, verified result.

## Validation Commands

- `uv run pytest <targeted tests>`
- `uv run ruff check <touched backend/frontend files where applicable>`

## Rollback Notes

- If shared reranker migration destabilizes writing-skill search, revert only the service substitution while keeping tests and MemoryService changes isolated.
- If frontend settings exposure grows beyond minimal scope, stop and keep backend capability user-configurable through existing preference persistence only.
