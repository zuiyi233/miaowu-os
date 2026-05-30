# Design

## Scope
This task implements the reranker plan only for the current Python Miaowu-OS / DeerFlow codebase. Changes for the separate TypeScript writing-skill runtime are out of scope for this task because that runtime needs its own user-config persistence and validation.

## Main Design Decisions

### 1. Reusable reranker service lives in Gateway services
Place the reusable service at `backend/app/gateway/services/reranker_service.py` so it can be consumed by Gateway services and, where needed, by code that already depends on app-layer runtime services.

### 2. Separate async and sync entrypoints
Provide native async rerank for async services and a sync rerank helper for sync call sites. Avoid threadpool + nested event-loop bridging as the default implementation. The sync path can use its own synchronous HTTP client while sharing config resolution and payload parsing logic.

### 3. User settings remain the primary config source
The reranker service resolves:
- user settings / preferences first
- environment variables second
- empty config -> graceful no-op fallback

### 4. MemoryService integrates rerank after overfetch
`search_memories()` first overfetches vector candidates, applies current similarity threshold filtering, then reranks the filtered candidates and truncates to the requested limit. If rerank fails or is unavailable, the pre-rerank order remains.

### 5. Writing skill migration is a service substitution, not a search rewrite
The current writing-skill keyword/vector fusion stays intact. Only the final rerank step is migrated from private `_RerankBackend` to the reusable service. Existing user embedding/rerank preference resolution remains in the writing-skill layer unless a clear shared helper already exists.

### 6. Minimal frontend/config exposure
Do not redesign provider settings. Only expose the minimum settings path necessary to preserve user control over rerank-related model keys consistent with current settings storage.

## Boundaries and Risks

- `packages/harness/*` must not import app-only modules in places that violate current layering assumptions. Reuse is acceptable in the existing writing-skill runtime because that module already depends on app settings/database access.
- Rerank adds latency and a second remote call; all new callsites must degrade safely.
- Frontend architecture is provider-centric; any new fields should avoid forcing a wide data-model migration.

## Verification Strategy

- Unit/integration tests for service config resolution and fallback behavior.
- Regression tests for writing-skill user model selection and invoke-limit behavior.
- MemoryService tests for overfetch + rerank integration and graceful degradation.
- Lint/tests on touched files.
