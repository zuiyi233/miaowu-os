# Design: Production Sidebar Navigation Performance

## Architecture and Boundaries

This task changes three layers:

1. Backend route compatibility
   - Existing gateway routers remain the source of truth:
     - `app.gateway.routers.threads` with prefix `/api/threads`
     - `app.gateway.routers.thread_runs` with prefix `/api/threads`
     - `app.gateway.routers.runs` with prefix `/api/runs`
     - `app.gateway.routers.assistants_compat` with prefix `/api/assistants`
   - Add `/api/langgraph/*` aliases by including the same router objects with an additional `/api/langgraph` prefix.
   - Do not copy endpoint functions or fork business logic.

2. Frontend navigation
   - Remove `prefetch={false}` from fixed internal navigation entry points so Next.js can use production default prefetching.
   - Scope is fixed links in workspace sidebar/header/welcome and landing header/hero that route into workspace pages.
   - Keep external links and any dynamic/unbounded list links untouched unless they are known fixed workspace entries.

3. Observability and route loading UX
   - Extend `RequestTraceMiddleware` so every request logs method, path, status, and duration in milliseconds under the current request id.
   - Add or preserve route-level loading UI for heavy workspace pages:
     - `/workspace/images`
     - `/workspace/tts-studio`
     - already-present `/workspace/novel` loading routes should remain intact.

## Data Flow and Contracts

### LangGraph SDK alias flow

```text
Browser LangGraph SDK
  -> /api/langgraph/threads/search
  -> FastAPI alias router
  -> existing /api/threads/search handler
  -> same auth, CSRF, thread store, response model
```

The alias must preserve the same:

- request body model
- response shape
- auth behavior
- CSRF behavior
- exception behavior
- request id and duration logging

### Request duration logging

```text
ASGI request
  -> RequestTraceMiddleware creates request_id and start timer
  -> downstream middleware/router handles response or exception
  -> middleware logs method/path/status/duration_ms/request_id
```

Streaming responses must not wait until the stream fully completes to emit a log line for initial response creation. The log duration should measure time until response object creation / first middleware completion, which is sufficient for routing/API latency triage.

## Compatibility Notes

- Existing `/api/*` paths must remain unchanged.
- Adding aliased routers can duplicate OpenAPI route entries; that is acceptable because production behavior matters more than OpenAPI compactness.
- Route inclusion order should place aliases after existing routers so existing route behavior is unchanged.
- If FastAPI route operation id duplication appears only as warnings, prefer explicit unique name generation only if it affects tests or docs generation.
- The frontend `getLangGraphBaseURL()` can remain `/api/langgraph`; backend aliases make the current SDK configuration work.

## Page Loading Review

- Image Generation already fetches job history in a client effect and renders shell first. Add route-level `loading.tsx` so first navigation has an immediate skeleton while the chunk/RSC path loads.
- TTS Studio already fetches workspaces/config via `Promise.all` and has component-level loading. Add route-level `loading.tsx` and avoid touching the existing dirty file unless necessary.
- Novel Workspace already has `loading.tsx`; keep it.
- Workspace/general APIs are already fetched client-side in hooks/components. The main issue is the `/api/langgraph/threads/search` 404 and disabled prefetch.

## Operational and Rollback

- Backend alias rollback: remove alias include helper/route registration.
- Frontend prefetch rollback: re-add `prefetch={false}` only for links that prove harmful.
- Logging rollback: disable or reduce request log level if log volume is too high.
- Production deployment should be 162-scoped and documented in `N:\cloudflare\DEPLOYMENT_NOTES.md`.

## Risks

- Aliasing router prefixes could expose more LangGraph-compatible paths than the frontend currently uses. This is acceptable because they reuse existing authenticated handlers.
- More prefetching increases background requests. User explicitly prefers caching/perceived speed and server-resource savings from fewer click-time cold loads.
- Existing uncommitted edits in `canvas.tsx` and `tts-studio-workspace.tsx` must be preserved.
