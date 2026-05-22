# Database Guidelines

> Database patterns and conventions for this project.

---

## Overview

- ORM: SQLAlchemy async (`AsyncSession`, `select`, `async_sessionmaker`).
- Primary runtime DB: SQLite (`novel_migrated.db`) with WAL enabled in bootstrap.
- **Novel domain file-truth rule (2026-04-28):**
  - Canonical content is stored in workspace files under `NOVEL_WORKSPACE_ROOT/{user_id}/{project_id}`.
  - DB stores index/cache/runtime-state metadata only.
  - API detail read must prefer file content and must not fallback to legacy DB正文 as truth source.

---

## Query Patterns

- Prefer `select(Model).where(...)` with explicit user/project scope filters.
- For file-truth index reads, use `(project_id, user_id, entity_type, entity_id)` composite scope.
- Batch writes should reuse one session and commit once per request-level unit of work.
- Optional metadata attachment (doc path/hash/mtime) should never block primary business flow.

---

## Migrations

- During local-dev reset phases, schema may be recreated via metadata bootstrap.
- When introducing new cache/index tables, ensure:
  1. table creation included in `init_db_schema` model import list;
  2. no hard dependency that breaks legacy endpoints before data backfill/rescan.

---

## Naming Conventions

- Table names: plural snake_case (`document_indexes`).
- Column naming:
  - identity/scope: `project_id`, `user_id`, `entity_type`, `entity_id`
  - file meta: `doc_path`, `content_hash`, `doc_updated_at`, `indexed_at`, `status`
- Unique constraints for index tables should reflect full logical scope.

---

## Common Mistakes

- Re-introducing正文字段 as truth source after moving to file-truth architecture.
- Returning raw DB model without file metadata fields (`doc_path`, `content_source`, `content_hash`, `doc_updated_at`).
- Committing repeatedly inside per-item loops instead of one transactional boundary.
