# 修复生产侧边栏导航慢与 LangGraph 兼容路由

## Goal

Reduce perceived latency when users click production workspace sidebar entries, and make production diagnostics precise enough to locate future slow paths.

The immediate production symptom is that sidebar entries such as Novel Workspace, Author Console, Inspiration Mode, Book Import, Image Generation, Audio Studio, Chats, and Agents feel slow on `cfxs.mwapi.bond` / 162. Read-only production evidence showed that 162 container CPU and memory are not saturated, but the frontend is doing click-time route loading and the gateway logs repeated `POST /api/langgraph/threads/search` 404 responses.

## Confirmed Facts

- 162 production stack is `/opt/stacks/miaowu-os-main`.
- Active containers observed on 162:
  - `miaowu-os-main-frontend-20260526`
  - `miaowu-os-main-gateway-20260526`
  - `miaowu-os-main-postgres-20260526`
- Runtime resources were low during diagnosis: frontend about 122 MiB, gateway about 170 MiB, gateway CPU about 0.14%.
- Public `cfxs.mwapi.bond` route adds roughly 1.5s to route response timing compared with 162 loopback tests.
- Production gateway logs repeatedly showed `POST /api/langgraph/threads/search` returning 404.
- Current backend registers thread compatibility endpoints under `/api/threads/*`, assistants under `/api/assistants/*`, and runs under `/api/threads/*` / `/api/runs/*`.
- Current frontend LangGraph SDK base URL defaults to `/api/langgraph`, which makes SDK calls land on `/api/langgraph/threads/search`.
- Current workspace sidebar and several landing/workspace entry links explicitly set `prefetch={false}`.
- Next.js production Link prefetching is intended to make route transitions faster; disabling prefetch defers route/data loading to click time.
- `RequestTraceMiddleware` already creates request IDs but does not currently log method/path/status/duration.

## Requirements

- Add backend compatibility aliases for `/api/langgraph/*` that delegate to existing gateway-compatible handlers rather than duplicating business logic.
- Alias coverage must include the LangGraph SDK paths used by the current frontend:
  - `/api/langgraph/threads/search`
  - `/api/langgraph/threads`
  - `/api/langgraph/threads/{thread_id}`
  - `/api/langgraph/threads/{thread_id}/state`
  - `/api/langgraph/threads/{thread_id}/history`
  - `/api/langgraph/threads/{thread_id}/runs`
  - `/api/langgraph/threads/{thread_id}/runs/{run_id}` and cancel/join/stream variants when present in existing routers
  - `/api/langgraph/assistants/search`
  - `/api/langgraph/assistants/{assistant_id}` and graph/schema variants already implemented
  - `/api/langgraph/runs` stateless run routes where the SDK or current code can call them
- Restore Next.js default prefetching for fixed internal navigation entries by removing `prefetch={false}` from workspace/sidebar/landing links unless there is a concrete functional reason to keep it.
- Keep route changes compatible with existing `/api/*` paths; do not break current direct API consumers.
- Add request duration logging to the gateway in a way that includes request id, method, path, status code, and elapsed milliseconds.
- Request duration logging must handle normal responses and exception paths.
- Review page data loading for Image Generation, TTS Studio, Novel Workspace, and general Workspace entry pages. Navigation should render a stable shell quickly, with data loads happening in parallel/client effects and with existing or added loading/skeleton states where needed.
- Preserve existing user edits in unrelated files:
  - `deer-flow-main/frontend/src/components/ai-elements/canvas.tsx`
  - `deer-flow-main/frontend/src/components/workspace/tts-studio/tts-studio-workspace.tsx`
- If `tts-studio-workspace.tsx` must be edited, inspect and preserve the existing uncommitted change rather than overwriting it.
- Use Windows/PowerShell only for frontend dependency operations. Do not use WSL for frontend dependencies.
- For any production rollout to 162, update `N:\cloudflare\DEPLOYMENT_NOTES.md` with image/tag, commands, and verification evidence.

## Acceptance Criteria

- [ ] Backend tests prove `/api/langgraph/threads/search` returns the same contract as `/api/threads/search` instead of 404.
- [ ] Backend tests cover at least one assistant alias and one run/state/history alias.
- [ ] Existing `/api/threads/*`, `/api/assistants/*`, and `/api/runs/*` tests still pass.
- [ ] Gateway logs include request duration in milliseconds for successful and failed requests.
- [ ] Repo search shows no unnecessary `prefetch={false}` on fixed internal navigation links in workspace/sidebar/landing entry points.
- [ ] Frontend typecheck passes.
- [ ] Relevant backend test subset passes.
- [ ] If production deployment is performed, 162 loopback and public checks verify:
  - `/api/langgraph/threads/search` no longer returns 404 for authenticated/browser-equivalent calls, or unauthenticated calls fail with auth/CSRF rather than route 404.
  - Sidebar target pages still return HTTP 200/redirect as expected.
  - Gateway log lines contain duration information.
- [ ] Final report states what was changed, what was verified, deployment state, and remaining gaps.

## Out of Scope

- Rewriting the LangGraph SDK client or replacing the current gateway compatibility layer.
- Broad redesign of workspace pages.
- Database schema changes.
- Changing 162 routing, Cloudflare, Tokyo FRP, or domain topology except as needed for read-only verification.
- Removing authentication or CSRF requirements from existing APIs.

## Notes

Planning based on production logs from 162 and local source inspection. `D:\deer-flow-main` was not present during the earlier diagnostic turn, so upstream comparison must use any available current checkout evidence unless that path appears later.
