# Implementation Plan

1. Replace novel database compatibility layer with main persistence-backed Base/session/engine.
2. Disable default fallback user for novel API request paths.
3. Exclude novel compatibility user tables from default schema imports to avoid `users` table conflict.
4. Add media asset metadata model and object storage config defaults for S3-compatible SeaweedFS.
5. Add focused backend tests for DB unification, auth strictness, project isolation, and asset model registration.
6. Run targeted backend tests and compile checks.

## Completion Notes

- Completed backend unification, strict user resolution, legacy novel user table deactivation, owner-scoped child resource lookup for chapter/character/outline hot paths, and S3-compatible SeaweedFS defaults.
- Verified with:
  - `uv run pytest tests/test_novel_unified_persistence.py tests/test_novel_internal_contracts.py tests/test_novel_p2_fix.py tests/test_novel_file_truth_read_paths.py tests/test_novel_chapters_idempotency.py tests/test_novel_router_regressions.py tests/test_characters_relationships_alias.py`
  - `uv run python -m compileall app/gateway/novel_migrated/core app/gateway/novel_migrated/models app/gateway/novel_migrated/api/common.py app/gateway/novel_migrated/api/chapters.py app/gateway/novel_migrated/api/characters.py app/gateway/novel_migrated/api/outlines.py packages/harness/deerflow/tools/builtins/novel_internal.py tests/test_novel_unified_persistence.py tests/test_novel_internal_contracts.py`
- Trellis `task.py` is currently blocked in this checkout by missing `.trellis/scripts/common/safe_commit.py`, so task transitions/commit automation could not be used.
