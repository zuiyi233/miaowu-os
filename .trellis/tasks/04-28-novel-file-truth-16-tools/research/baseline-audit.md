# Baseline Audit — novel file-truth cutover

Date: 2026-04-28

## 1) Scope confirmation

Target repo: `D:\miaowu-os\deer-flow-main`

Novel built-in tools discovered under:
- `backend/packages/harness/deerflow/tools/builtins/novel_creation_tools.py`
- `backend/packages/harness/deerflow/tools/builtins/novel_analysis_tools.py`
- `backend/packages/harness/deerflow/tools/builtins/novel_extended_tools.py`

Registered novel tool names (`NOVEL_BUILTIN_TOOLS`):
1. build_world
2. generate_characters
3. generate_outline
4. expand_outline
5. generate_chapter
6. generate_career_system
7. analyze_chapter
8. manage_foreshadow
9. search_memories
10. check_consistency
11. polish_text
12. regenerate_chapter
13. partial_regenerate
14. finalize_project
15. import_book
16. update_character_states
(+ create_novel is separate)

## 2) Current architecture findings

- Current 16 tools are endpoint/internal-call wrappers; they do NOT use project workspace files as truth source.
- Main paths depend on:
  - `app.gateway.novel_migrated.api.*`
  - `app.gateway.novel_migrated.services.*`
  - DB models in `app.gateway.novel_migrated.models.*`
- Tool helper base URL default already fixed to `http://127.0.0.1:8551` in:
  - `backend/packages/harness/deerflow/tools/builtins/novel_tool_helpers.py`

Gap vs target design:
- No unified workspace manager (`manifest.json`, path guard, typed entity path map)
- No file-first read chain for novel details
- No `workspace/init` and `workspace/rescan` endpoints in current API set
- No explicit `content_source: "file"` contract in current return payloads

## 3) Upstream/reference comparison

### 3.1 DeerFlow upstream (`D:\deer-flow-main`)

- Upstream builtins do not include novel toolset; only core builtins exist.
- Therefore compatibility target = preserve DeerFlow harness tool registration/return conventions and avoid breaking non-novel core paths.

### 3.2 MuMuAINovel reference (`D:\miaowu-os\参考项目\MuMuAINovel-main`)

- Reference project focuses on rich novel domain models and APIs, but baseline still DB-centric.
- Useful for domain semantics and workflow behavior, not as direct file-truth storage implementation template.

## 4) Immediate implementation implications

1. Need new shared file-truth service layer in `novel_migrated/services/` (workspace root, entity path resolver, manifest manager, path validator).
2. Need a lightweight index model/table (doc meta cache) and drop old正文真值依赖.
3. Need to refactor 16 tools to call official file I/O channel abstractions and return file-centric metadata.
4. Need API contract extension (doc_path/content_source/content_hash/doc_updated_at) across affected endpoints.

## 5) Risks to control

- Mass refactor touching tool layer + gateway API + DB models simultaneously.
- Existing async task flows (batch generate/analyze/regenerate) may implicitly rely on DB正文 fields.
- Frontend queries currently assume detail payload includes DB-shaped content objects.

Recommended rollout inside this task:
- Stage A: file-truth infra + dual read path hard-switch (no DB fallback)
- Stage B: 16 tools cutover
- Stage C: API/FE contract + rescan + RAG increment + regression
