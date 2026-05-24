# Implementation Plan: NewAPI 手动分组同步与密钥选择流程

## Phase 0: Pre-checks

- [ ] Confirm current git status and avoid touching unrelated files.
- [ ] Confirm Gateway runtime status and decide rebuild vs complete container sync.
- [ ] Read current NewAPI OAuth/settings files before editing.

## Phase 1: Backend API and Service

- [ ] Add a server-side NewAPI sync state helper for current user:
  - read saved NewAPI account/snapshot
  - obtain stored system token or return re-login-required
  - query group catalog
  - merge with existing managed providers
- [ ] Add `GET /api/user/newapi-sync/groups`.
- [ ] Add `POST /api/user/newapi-sync/groups`.
- [ ] Reuse existing group bootstrap/model parsing helpers instead of duplicating token logic.
- [ ] Ensure group names are normalized, deduped, length-limited, and never treated as secrets.
- [ ] Ensure responses return only group/status/model count/has_key, never key/token.
- [ ] Keep `/api/user/ai-settings` response contract stable.

## Phase 2: Frontend UI

- [ ] Replace the current single “open OAuth and wait” sync action with a dialog/panel.
- [ ] Add API client functions for group discovery and manual sync.
- [ ] Show discovered groups with checkbox selection.
- [ ] Add manual group input fallback.
- [ ] Default-select one group when only one is discovered.
- [ ] Show per-group result status after sync.
- [ ] Refresh AI settings after successful sync.
- [ ] Preserve existing new-tab NewAPI login path for re-login-required cases.

## Phase 3: Runtime Recovery

- [ ] Restore local Gateway `127.0.0.1:8551`.
- [ ] Avoid partial hot-copy dependency drift. Prefer rebuild/recreate if source and container differ.
- [ ] Smoke `/health`.
- [ ] Confirm frontend uses current backend base URL, not `8001`.

## Phase 4: Tests

Backend target tests:

```powershell
cd N:\miaowu-os-merge-upstream-main\deer-flow-main\backend
uv run pytest tests/test_user_ai_settings_contract.py tests/test_newapi_oauth.py -q
uv run ruff check app/gateway/auth/newapi_oauth.py app/gateway/novel_migrated/api/user_settings.py app/gateway/novel_migrated/services/ai_settings_service.py tests/test_user_ai_settings_contract.py tests/test_newapi_oauth.py
```

Add or extend backend tests for:

- group discovery returns existing managed groups and NewAPI catalog without secrets
- manual sync persists one selected group
- manual sync handles multiple selected groups with one failure
- manual group input works
- `model_groups` round-trip remains intact

Frontend validation:

```powershell
cd N:\miaowu-os-merge-upstream-main\deer-flow-main\frontend
pnpm typecheck
```

Add frontend tests if current test harness can run quickly:

- dialog renders discovered groups
- manual input triggers sync payload
- success refreshes settings
- re-login-required shows NewAPI login action

## Risky Files

- `deer-flow-main/backend/app/gateway/auth/newapi_oauth.py`
- `deer-flow-main/backend/app/gateway/novel_migrated/api/user_settings.py`
- `deer-flow-main/backend/app/gateway/novel_migrated/services/ai_settings_service.py`
- `deer-flow-main/frontend/src/components/workspace/settings/ai-provider-settings-page.tsx`
- `deer-flow-main/frontend/src/core/ai/useAiSettingsApi.ts`
- `deer-flow-main/frontend/src/core/ai/ai-provider-store.ts`

## Do Not Touch

- Do not revert unrelated `deer-flow-main/frontend/src/core/auth/types.ts`.
- Do not remove unrelated tests under `deer-flow-main/frontend/tests/unit/core/auth/`.
- Do not use WSL for frontend dependencies.
- Do not expose real `sk-` keys.

## Review Gate Before Start

- [ ] User confirms this plan is acceptable.
- [ ] Run `task.py start 05-25-newapi-manual-group-sync` only after confirmation.

