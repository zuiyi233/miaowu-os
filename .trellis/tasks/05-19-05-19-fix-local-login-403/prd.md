# Fix local-dev login 403

## Goal

Fix the local-dev browser login failure where `POST /api/v1/auth/login/local` returns `403 Forbidden` from the gateway when the frontend runs on port `4560` and calls the backend on `127.0.0.1:8551`.

## Requirements

- Keep `/api/v1/auth/login/local` protected against hostile cross-site browser requests.
- Allow the current Miaowu local-dev origins, especially `http://localhost:4560` and `http://127.0.0.1:4560`, to call auth POST endpoints when the backend runs on `127.0.0.1:8551`.
- Reuse the gateway's active CORS configuration source (`CORS_ORIGINS` / `get_gateway_config().cors_origins`) so CORS and CSRF origin policy do not drift.
- Preserve wildcard safety: `*` must not become an allowed credentialed auth origin.
- Keep the fix backend-scoped unless evidence shows frontend changes are required.

## Acceptance Criteria

- [ ] A regression test proves `CORS_ORIGINS=http://localhost:4560,http://127.0.0.1:4560` allows auth POSTs from `Origin: http://localhost:4560` to a `127.0.0.1:8551` backend.
- [ ] Existing CSRF tests for hostile origins, malformed origins, same-origin auth, and non-auth double-submit token checks still pass.
- [ ] The targeted login request no longer returns `403 Cross-site auth request denied` for the local-dev frontend origin.
- [ ] The implementation remains compatible with upstream's auth middleware behavior: auth routes stay public, CSRF still rejects unauthorized browser origins.

## Definition of Done

- Backend tests covering CSRF middleware pass.
- Syntax/compile verification for touched backend files passes.
- Any runtime verification gap is explicitly reported.

## Technical Approach

The root cause is configuration drift at the backend boundary:

- `backend/app/gateway/app.py` configures CORS via `get_gateway_config().cors_origins`.
- `backend/app/gateway/config.py` reads that list from `CORS_ORIGINS`, defaulting to `http://localhost:3000,http://localhost:4560,http://127.0.0.1:4560`.
- `backend/app/gateway/csrf_middleware.py` currently checks explicit auth origins only via `GATEWAY_CORS_ORIGINS`.
- The local-dev runner sets `CORS_ORIGINS`, not `GATEWAY_CORS_ORIGINS`.
- Therefore a browser login from frontend `localhost:4560` to backend `127.0.0.1:8551` is treated as cross-site and receives 403 before the login route runs.

Fix by making CSRF explicit-origin lookup use the same gateway CORS config, optionally preserving `GATEWAY_CORS_ORIGINS` as an override/compatibility input if needed, while still ignoring wildcard `*`.

## Out of Scope

- Changing auth credential validation or password policy.
- Changing frontend login UI.
- Changing local-dev ports; the local backend remains `127.0.0.1:8551` and frontend remains `4560`.
- Broad auth/session refactors.

## Technical Notes

- Compared with original project `D:\deer-flow-main`: auth middleware public paths match and include `/api/v1/auth/login/local`.
- Current failure is not the auth middleware public-path list; the route is public in both original and fork.
- Backend log observed: `POST /api/v1/auth/login/local HTTP/1.1" 403 Forbidden`.
- Relevant files:
  - `deer-flow-main/backend/app/gateway/csrf_middleware.py`
  - `deer-flow-main/backend/app/gateway/config.py`
  - `deer-flow-main/backend/tests/test_csrf_middleware.py`
  - `deer-flow-main/scripts/dev-local.ps1`
