# Implement Plan: Production Sidebar Navigation Performance

## Checklist

1. Backend alias implementation
   - Add a helper in `backend/app/gateway/app.py` or a small new module to include selected routers with `/api/langgraph` prefixes.
   - Register aliases for:
     - threads router under `/api/langgraph`
     - thread runs router under `/api/langgraph`
     - assistants router under `/api/langgraph`
     - stateless runs router so `/api/langgraph/runs/*` maps to existing stateless run handlers.
   - Keep existing router registration unchanged.

2. Backend request duration logging
   - Extend `backend/app/gateway/middleware/request_trace.py`.
   - Use `time.perf_counter()`.
   - Log one structured-ish line on success and exception:
     - `Gateway request completed method=... path=... status_code=... duration_ms=... request_id=...`
     - `Gateway request failed method=... path=... duration_ms=... request_id=...`
   - Preserve trace context reset behavior for streaming responses.

3. Backend tests
   - Add or extend focused tests for alias route registration.
   - Verify `/api/langgraph/threads/search` is not 404 and matches `/api/threads/search` behavior using the same router dependencies/mocks.
   - Verify `/api/langgraph/assistants/search`.
   - Verify a run/state/history alias path at routing level.
   - Add request trace middleware logging test if no existing middleware test covers it.

4. Frontend prefetch cleanup
   - Remove `prefetch={false}` from fixed internal links found by:
     - `rg -n "prefetch=\\{false\\}" deer-flow-main/frontend/src`
   - Scope expected files:
     - `components/workspace/workspace-nav-chat-list.tsx`
     - `components/workspace/workspace-header.tsx`
     - `components/workspace/welcome.tsx`
     - `components/landing/header.tsx`
     - `components/landing/hero.tsx`
   - Re-run search and leave any remaining occurrences only with a documented reason.

5. Page loading UX
   - Add `frontend/src/app/workspace/images/loading.tsx`.
   - Add `frontend/src/app/workspace/tts-studio/loading.tsx`.
   - Reuse existing workspace layout primitives and simple skeleton/loader components.
   - Avoid editing `tts-studio-workspace.tsx` unless evidence shows blocking behavior not covered by route loading.

6. Validation
   - Backend:
     - `cd deer-flow-main/backend`
     - run focused pytest for new alias/logging tests and existing related router tests.
     - run ruff on touched backend files.
   - Frontend:
     - `cd deer-flow-main/frontend`
     - `npm run typecheck`
     - run focused unit tests if touched files have tests.
   - Repo checks:
     - `rg -n "prefetch=\\{false\\}" deer-flow-main/frontend/src`
     - `rg -n "/api/langgraph" deer-flow-main/backend/app deer-flow-main/frontend/src`

7. Production rollout if local validation passes
   - Build gateway/frontend images using the repo's existing production Docker flow.
   - Deploy to 162 `/opt/stacks/miaowu-os-main`.
   - Verify:
     - `curl http://127.0.0.1:18551/health`
     - route-level probes for `/api/langgraph/threads/search` behavior
     - public `https://cfxs.mwapi.bond/health`
     - route pages `/workspace/novel`, `/workspace/images`, `/workspace/tts-studio`
     - gateway logs contain duration lines.
   - Update `N:\cloudflare\DEPLOYMENT_NOTES.md`.

## Risky Files and Rollback Points

- `backend/app/gateway/app.py`: router registration. Roll back alias include calls if route collision occurs.
- `backend/app/gateway/middleware/request_trace.py`: middleware lifecycle. Roll back duration logging block if streaming or trace context behavior regresses.
- `frontend/src/components/...`: Link prop cleanup. Roll back only specific links if prefetch creates measurable harm.
- `frontend/src/app/workspace/*/loading.tsx`: additive loading routes; safe to delete if not useful.

## Review Gates Before Start

- PRD, design, and implement are present.
- User has already approved the task scope.
- Existing dirty files are acknowledged and must not be overwritten.
