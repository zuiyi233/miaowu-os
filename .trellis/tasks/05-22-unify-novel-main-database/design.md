# Design

## Database

`app.gateway.novel_migrated.core.database` becomes a compatibility layer over `deerflow.persistence.engine`.

- `Base` is imported from `deerflow.persistence.base`.
- `get_db()` yields sessions from `get_session_factory()`.
- `AsyncSessionLocal` and `async_session_factory` are proxies that resolve the current main session factory at call time.
- `init_db_schema()` imports novel models and creates tables through the main engine if available.

## Auth Isolation

Novel APIs derive `user_id` from `request.state.user_id` or `request.state.auth.user.id`. No default local user fallback is used for API requests.

## Object Storage

Add a DB metadata model for assets. Actual object upload plumbing can be layered after this phase.

Local server truth: SeaweedFS S3-compatible, VIP `172.22.22.170:18334`; MinIO is legacy.
