# Technical Design — novel file-truth cutover

## Objective

Implement file-truth architecture for novel studio while preserving external tool/API names.

## Core components to add

1. `workspace_paths.py`
   - Resolve workspace root: `NOVEL_WORKSPACE_ROOT/{user_id}/{project_id}`
   - Validate entity paths and block traversal/absolute/cross-project writes
2. `workspace_manifest_service.py`
   - Load/save manifest
   - Upsert entity index records (`entity_type`, `entity_id`, path, hash, mtime...)
3. `workspace_document_service.py`
   - Canonical read/write for md/json docs
   - History snapshot for chapters
4. `workspace_index_sync_service.py`
   - Update DB lightweight index cache from manifest/doc metadata

## API changes

- add `POST /api/novels/{project_id}/workspace/init`
- add `POST /api/novels/{project_id}/workspace/rescan`
- add document direct read/write endpoints
- extend relevant response schemas with:
  - `doc_path`
  - `content_source="file"`
  - `content_hash`
  - `doc_updated_at`

## Tool cutover strategy (16 tools)

- Keep signatures unchanged
- Replace internal DB-write/api-write chain with:
  1) produce content
  2) write canonical workspace document
  3) update manifest + index
  4) return file metadata

## Validation strategy

- Unit tests for path guard + manifest upsert + rescan
- Integration checks for each entity write/read path
- Regression checks for tool-level output compatibility
