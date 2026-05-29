# Research: 31 multi-user settings acceptance matrix

- Query: 31测试栈上多用户设置改造的验收矩阵，聚焦用户隔离点、API/UI验证顺序、A/B用户验证、管理员权限点、以及缺少双账号时的最小替代路径。
- Scope: mixed
- Date: 2026-05-29

## Findings

### 1) User preference settings are per-user, stored in `Settings.preferences`, and normalized on read/write
- `backend/app/gateway/novel_migrated/core/user_context.py` enforces authenticated user identity only; `resolve_user_id()` returns `401 Authentication required` when no user id exists.
- `backend/app/gateway/novel_migrated/services/user_preferences_service.py` stores three separate per-user keys: `user_skill_settings`, `user_tool_settings`, `user_ui_settings`.
- Read paths normalize each preference blob and may persist normalization changes back to the same user record.
- This means the most valuable 31 verification is not just “page loads”, but “same endpoint returns different state for different users after one user mutates it.”

Relevant files:
- `deer-flow-main/backend/app/gateway/novel_migrated/core/user_context.py`
- `deer-flow-main/backend/app/gateway/novel_migrated/services/user_preferences_service.py`
- `deer-flow-main/backend/tests/test_user_preferences_contract.py`

### 2) Skill and tool toggles are user-scoped, but system catalog state is separate and admin-only
- `backend/app/gateway/novel_migrated/api/user_settings.py` exposes `/api/user/skill-settings` and `/api/user/tool-settings` as user-specific read/write endpoints.
- The response includes `is_admin`, `system_enabled`, and for skills `is_editable`, which are useful for asserting that user-scoped state is not the same as system catalog state.
- `backend/app/gateway/routers/skills.py` uses `require_admin_user` for install/edit/delete/history/rollback/custom-skill and public catalog enable/disable endpoints, while `/api/skills/{skill_name}` and `/api/skills/{skill_name}` PUT remain user-scoped.
- `backend/app/gateway/routers/mcp.py` and `backend/app/gateway/routers/admin.py` are fully admin-gated.

Relevant files:
- `deer-flow-main/backend/app/gateway/novel_migrated/api/user_settings.py`
- `deer-flow-main/backend/app/gateway/routers/skills.py`
- `deer-flow-main/backend/app/gateway/routers/mcp.py`
- `deer-flow-main/backend/app/gateway/routers/admin.py`

### 3) MCP tool scope is per user and directly affects tool loading
- `backend/app/gateway/novel_migrated/services/mcp_tools_loader.py` reads the current user’s `Settings.preferences` and passes only that user’s enabled server names into `get_mcp_tools(enabled_server_names=...)`.
- The loader caches by `user_id`, and `invalidate_cache(user_id)` is available.
- `backend/tests/test_mcp_tools_loader_user_scope.py` asserts that user A’s disabled server does not leak into user B’s enabled set.
- This is one of the highest-value A/B checks for 31 because it proves the runtime tool set, not just the settings page, is isolated.

Relevant files:
- `deer-flow-main/backend/app/gateway/novel_migrated/services/mcp_tools_loader.py`
- `deer-flow-main/backend/tests/test_mcp_tools_loader_user_scope.py`
- `deer-flow-main/backend/app/gateway/novel_migrated/services/user_preferences_service.py`

### 4) Skill governance has a hard workspace gate plus session narrowing; this is a separate isolation axis
- `backend/app/gateway/novel_migrated/services/skill_governance_service.py` resolves final enabled skills from system defaults, workspace state, and session candidates.
- `workspace_disabled` is a hard constraint, and feature-flag-off paths can fall back to `workspace_only`, `system_only`, or `intersection`.
- `backend/tests/test_skill_governance_service.py` proves the hard constraint and fallback behavior.
- For 31, this is important if the feature was part of the multi-user settings change, but it is usually less user-visible than UI settings or MCP tool scope.

Relevant files:
- `deer-flow-main/backend/app/gateway/novel_migrated/services/skill_governance_service.py`
- `deer-flow-main/backend/tests/test_skill_governance_service.py`

### 5) UI pages map cleanly to the per-user APIs, and admin pages map to admin-gated APIs
- `frontend/src/components/workspace/settings/draft-settings-page.tsx` uses `useUserUiSettings` / `useUpdateUserUiSettings`, which call `/api/user/ui-settings`.
- `frontend/src/components/workspace/settings/skill-settings-page.tsx` uses `useSkills` and `useEnableSkill`, which call `/api/skills` and `/api/skills/{skill_name}`.
- `frontend/src/components/workspace/settings/tool-settings-page.tsx` uses `useMCPConfig` and `useEnableMCPServer`, which call `/api/user/tool-settings`.
- `frontend/src/components/workspace/settings/ai-provider-settings-page.tsx` hydrates and saves through `fetchUserAiSettings` / `putUserAiSettings`, so AI provider state and feature routing are both backed by `/api/user/ai-settings`.
- `frontend/src/components/workspace/settings/admin-settings-page.tsx` is the admin console for `/api/admin/system-settings`, `/api/admin/users`, `/api/admin/storage/overview`, `/api/admin/audit-logs`, `/api/mcp/config`, `/api/skills/custom/*`, and public catalog toggles.

Relevant files:
- `deer-flow-main/frontend/src/components/workspace/settings/draft-settings-page.tsx`
- `deer-flow-main/frontend/src/components/workspace/settings/skill-settings-page.tsx`
- `deer-flow-main/frontend/src/components/workspace/settings/tool-settings-page.tsx`
- `deer-flow-main/frontend/src/components/workspace/settings/ai-provider-settings-page.tsx`
- `deer-flow-main/frontend/src/components/workspace/settings/admin-settings-page.tsx`
- `deer-flow-main/frontend/src/core/ai/useAiSettingsApi.ts`
- `deer-flow-main/frontend/src/core/user-settings/api.ts`
- `deer-flow-main/frontend/src/core/user-settings/hooks.ts`
- `deer-flow-main/frontend/src/core/api/fetcher.ts`

### 6) Existing tests already define the minimum contract worth turning into 31 acceptance checks
- `backend/tests/test_user_preferences_contract.py` proves:
  - UI settings default to `7d` and persist per user
  - skill settings default to enabled and update per user
  - tool settings default to enabled and update per user
  - skill/tool preference writes persist into the preferences blob
- `backend/tests/test_mcp_tools_loader_user_scope.py` proves user-filtered MCP server names are passed to tool loading.
- `backend/tests/test_skill_governance_service.py` proves workspace disable is a hard gate and fallback modes behave deterministically.

## 31 Acceptance Matrix

### Highest-value user isolation points to test first

#### A. `user_ui_settings` isolation
- Why it matters: lowest-risk, cheapest smoke that proves the per-user persistence layer is not leaking.
- API-first steps:
  1. Login as user A.
  2. `GET /api/user/ui-settings` and note the baseline `media_draft_retention`.
  3. `PUT /api/user/ui-settings` with a different retention value.
  4. Re-`GET` as user A and verify the new value persists.
  5. Switch to user B and verify B still sees the baseline/default or B’s own value, not A’s value.
- UI step:
  - Open Draft Settings and change the retention selector, then refresh and confirm the selected value persists.
- Validation mode:
  - Can be a single-user smoke for persistence.
  - Must become A/B if you want to prove isolation across accounts.
- Admin needed:
  - No.
- Minimal substitute if no second account:
  - Use one user, change the value, then verify the backend blob or repeated `GET` result; this proves persistence but not isolation.

#### B. `user_tool_settings` / MCP enablement isolation
- Why it matters: directly affects which MCP servers the runtime loads for that user.
- API-first steps:
  1. Login as user A.
  2. `GET /api/user/tool-settings` and note enabled servers.
  3. `PUT /api/user/tool-settings` disabling one server.
  4. Re-`GET` as user A and confirm the server is disabled.
  5. Login as user B and confirm B still sees its own independent enabled set.
  6. If possible, exercise a code path that depends on `MCPToolsLoader.get_user_langchain_tools(user_id=...)` or a runtime feature that uses MCP tools.
- UI step:
  - Open Tool Settings and toggle a server; refresh and confirm only that account changed.
- Validation mode:
  - A/B is strongly recommended.
  - A single-user smoke is only a partial validation.
- Admin needed:
  - No for user toggle; yes if you want to change system-level MCP registry.
- Minimal substitute if no second account:
  - Validate the `GET`/`PUT` round trip and inspect that the returned `mcp_servers[...].enabled` changes for the same user.
  - If runtime tooling is hard to exercise, assert the frontend request payload and the response JSON shape.

#### C. `user_skill_settings` isolation
- Why it matters: proves per-user feature enablement, but still needs a runtime check if the downstream agent path is in scope.
- API-first steps:
  1. Login as user A.
  2. `GET /api/user/skill-settings` and note the skills list.
  3. `PUT /api/user/skill-settings` disabling one skill.
  4. Re-`GET` as user A and verify the skill remains disabled.
  5. Login as user B and verify B’s view remains independent.
- UI step:
  - Open Skill Settings and toggle a skill off; refresh to confirm persistence.
- Validation mode:
  - A/B recommended for true isolation.
  - Single-user smoke is acceptable only for persistence.
- Admin needed:
  - No for user toggles.
  - Yes if you want to verify the admin catalog toggle (`/api/skills/{skill_name}/catalog`) impacts `system_enabled`.
- Minimal substitute if no second account:
  - Round-trip the `GET`/`PUT` payload for one user and confirm `enabled` changes while `system_enabled` stays as catalog state.

#### D. AI provider / feature routing isolation (`/api/user/ai-settings`)
- Why it matters: this is the canonical source of truth for providers, default provider selection, client settings, and feature routing.
- API-first steps:
  1. Login as user A.
  2. `GET /api/user/ai-settings`.
  3. Change a non-secret provider field or `feature_routing_settings` via `PUT /api/user/ai-settings`.
  4. Re-`GET` and confirm the change persisted.
  5. Login as user B and confirm B’s provider list/default/routing is not altered.
- UI step:
  - Open AI Provider Settings, change default provider or routing, save, refresh, and confirm the UI reloads from server state.
- Validation mode:
  - Must be A/B if you want to verify isolation.
  - Single-user smoke is okay for save/reload correctness.
- Admin needed:
  - No for ordinary provider edits.
  - Some NewAPI sync flows may depend on user-linked account state but still do not require admin.
- Minimal substitute if no second account:
  - Single-user `GET`/`PUT`/`GET` round trip plus screenshot/DOM check of the provider page after reload.

#### E. Runtime MCP loader isolation
- Why it matters: it is the backend proof that the user-scoped toggle changes actual tool loading, not just stored preferences.
- API-first steps:
  1. Use the `tool-settings` API to disable one MCP server for user A.
  2. Trigger a backend code path that uses `MCPToolsLoader.get_user_langchain_tools(user_id=...)` or `has_enabled_plugins(...)`.
  3. Verify only the user’s enabled servers are passed to tool loading.
  4. Repeat for user B if available.
- UI step:
  - None required if API/runtime verification is possible; this is backend-first.
- Validation mode:
  - Strongly prefers A/B.
- Admin needed:
  - No.
- Minimal substitute if no second account or runtime harness is limited:
  - Use the existing unit contract as the lower bound, then validate user A’s toggle round trip in the 31 environment.

#### F. Admin-gated catalog and registry changes
- Why it matters: the multi-user model only holds if ordinary users cannot change shared system catalog state.
- API-first steps:
  1. Login as non-admin user.
  2. Try `GET`/`PUT /api/mcp/config` and confirm 403.
  3. Try `POST /api/skills/install`, `/api/skills/custom`, `/api/skills/custom/{skill_name}`, `/api/skills/custom/{skill_name}/history`, `/api/skills/custom/{skill_name}/rollback`, and `/api/skills/{skill_name}/catalog` and confirm 403.
  4. Login as admin and confirm these endpoints are available.
- UI step:
  - Open Admin Settings and verify the corresponding sections render only for admin.
- Validation mode:
  - Must be A/B or admin/non-admin comparison.
- Admin needed:
  - Yes, by definition.
- Minimal substitute if no second account:
  - Use one admin account and one known non-admin token/session, then verify response codes directly.

### What can be single-user smoke vs what needs A/B

#### Single-user smoke is acceptable for:
- `GET` then `PUT` then `GET` round-trip on `/api/user/ui-settings`
- `GET` then `PUT` then `GET` round-trip on `/api/user/skill-settings`
- `GET` then `PUT` then `GET` round-trip on `/api/user/tool-settings`
- `GET` then `PUT` then `GET` round-trip on `/api/user/ai-settings`
- UI save/reload correctness on the corresponding settings pages
- Admin-only 403 checks when you only need to prove the endpoint is gated, not cross-user leakage

#### Must have A/B verification for:
- Proving user A’s change does not appear in user B’s settings
- Proving user A’s MCP disable changes only A’s runtime tool set
- Proving user A’s skill toggle does not alter user B’s skill state
- Proving AI provider or feature routing changes are account-specific
- Proving system catalog/admin changes remain global while user toggles stay local

### Admin-verified points
- `/api/mcp/config` GET/PUT
- `/api/skills/install`
- `/api/skills/custom`
- `/api/skills/custom/{skill_name}` GET/PUT
- `/api/skills/custom/{skill_name}/history`
- `/api/skills/custom/{skill_name}/rollback`
- `/api/skills/{skill_name}/catalog`
- `/api/admin/system-settings`
- `/api/admin/users`
- `/api/admin/users/{user_id}/product-entitlement`
- `/api/admin/users/{user_id}/product-entitlement/refresh`
- `/api/admin/users/{user_id}/quota`
- `/api/admin/users/{user_id}/recalculate-storage`
- `/api/admin/storage/recalculate-all`
- `/api/admin/storage/recalculate-all/{task_id}`
- `/api/admin/storage/overview`
- `/api/admin/audit-logs`

### Best minimal substitute if 31 lacks two accounts or UI interaction is too costly
1. Prefer API-level verification on the exact per-user endpoint first, because the request/response payload is authoritative and cheaper than the UI.
2. If no second account exists, do one-user persistence smoke plus a backend artifact check for the same account, and explicitly mark isolation as not fully proven.
3. If UI work is too expensive, use direct authenticated API calls with the frontend request wrapper contract preserved (`credentials: include`, CSRF for state-changing methods).
4. If runtime tool-loading is hard to reach, rely on the existing unit contract for `MCPToolsLoader` and the per-user API round trip as the minimum acceptable evidence.
5. For admin-gated endpoints, verify both one non-admin 403 and one admin 200; that is the smallest meaningful permission test.

## Caveats / Not Found
- The task PRD was still a placeholder, so the matrix is derived from live code and tests rather than a filled-in task brief.
- I did not run 31 runtime smoke commands or browser verification in this pass, so the matrix is a planning/acceptance artifact, not a runtime result.
- `frontend/src/components/workspace/settings/ai-provider-settings-page.tsx` shows the settings page writes to `/api/user/ai-settings`, but the exact UI affordance for `feature_routing_settings` is routed through the store and helper modules rather than being obvious from the page shell alone.
- No existing dual-account fixture was found in this workspace; A/B verification will need two authenticated sessions on 31 or an equivalent backend test harness.
