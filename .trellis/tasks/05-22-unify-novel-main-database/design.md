# Design

## Database

`app.gateway.novel_migrated.core.database` is no longer an independent database owner. It is a thin import/call boundary into `deerflow.persistence.engine` so novel data lives in the same main database as users, threads, runs, and settings.

- `Base` is imported from `deerflow.persistence.base`.
- `get_db()` yields sessions from `get_session_factory()`.
- `AsyncSessionLocal` and `async_session_factory` remain only as transitional call-shape aliases for existing services; they resolve the current main session factory at call time and do not own an engine.
- `init_db_schema()` imports novel models and creates tables through the main engine if available.
- `novel_migrated.models.user` is deprecated and not imported into default schema registration because the main project owns `users`.
- The optional legacy novel admin router is blocked in unified persistence mode; admin capabilities must use the main DeerFlow admin/permission system.

## Auth Isolation

Novel APIs derive `user_id` from `request.state.user_id` or `request.state.auth.user.id`. No default local user fallback is used for API requests.

High-frequency project child resource reads use an owner-scoped lookup through `projects.user_id` before returning chapter, character, or outline records by ID. Internal novel tool calls resolve `user_id` from the main DeerFlow runtime user context and fail if no authenticated user context exists.

## Object Storage

Add a DB metadata model for assets. Actual object upload plumbing can be layered after this phase.

Local server truth: SeaweedFS S3-compatible, VIP `172.22.22.170:18334`; MinIO is legacy.
