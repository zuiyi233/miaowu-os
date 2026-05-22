# Unify novel_migrated with main backend persistence

## Goal

Make the novel二开 module use the main DeerFlow backend persistence as the canonical data source, with strict account-level isolation. Production target is PostgreSQL; local SQLite remains a development mode.

## Requirements

- `novel_migrated` must not write new canonical data into a hard-coded `novel_migrated.db`.
- `novel_migrated` must reuse the main `deerflow.persistence.engine` session factory and ORM metadata.
- Missing authenticated user on novel APIs must return 401 instead of falling back to `local_single_user`.
- Novel project access must remain scoped by `projects.user_id`.
- The legacy novel admin user source must be disabled or routed away from the novel module.
- Object storage planning must use the verified local server truth: current active path is SeaweedFS S3-compatible via VIP `172.22.22.170:18334`; MinIO is historical only.
- First phase does not migrate old data from `novel_migrated.db`, legacy JSON store, or browser IndexedDB.

## Acceptance Criteria

- [ ] Backend tests prove `novel_migrated.core.database` uses the main persistence session factory.
- [ ] Backend tests prove no hard-coded `novel_migrated.db` URL is used for the new novel DB engine.
- [ ] Backend tests prove unauthenticated novel user resolution returns 401.
- [ ] Backend tests prove project access is denied across users.
- [ ] A media asset metadata model exists for object-storage-backed assets with user/project ownership fields.
- [ ] Object storage config defaults are S3-compatible/Seaweed-friendly and do not mention MinIO as the active default.

## Out of Scope

- Automatic migration from old `novel_migrated.db`, JSON store, or browser IndexedDB.
- Full object upload/download implementation for every existing file path.
- Multi-user collaboration or public shared projects.
