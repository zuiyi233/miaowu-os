# NewAPI Manual Group Sync Runbook

## Purpose

Miaowu-OS uses NewAPI as the account and AI gateway entry. NewAPI deployments often have multiple user groups, and each group can expose a different model catalog. A single default group token cannot represent the full account.

The product flow must therefore be:

1. Discover the current NewAPI user's visible groups when possible.
2. Let the user choose the groups they want to sync.
3. Allow manual group input when the catalog is incomplete.
4. Create or reuse a group-scoped token on the server.
5. Fetch `/v1/models` with that group token.
6. Save each group as a separate `newapi-managed-*` provider.
7. Return only redacted status to the browser.

Do not build a workflow that silently guesses one group and presents it as complete.

## Reference Pattern

The reference project `参考项目/all-api-hub-main` uses a selection-required flow:

- zero groups: block or ask the user to configure manually
- one group: use it automatically
- multiple groups: require user selection
- token creation is tied to the selected group
- UI constrains choices to known groups but still supports explicit user control

Miaowu follows the same product rule, with an added manual input fallback because some NewAPI Hub catalogs can be incomplete.

## Backend Contract

### `GET /api/user/newapi-sync/groups`

Returns a redacted directory of groups available for sync.

Response shape:

```json
{
  "groups": [
    {
      "group_id": "default",
      "name": "default",
      "models": ["model-a"],
      "model_count": 1,
      "provider_id": "newapi-managed",
      "already_synced": true,
      "has_api_key": true,
      "model_sync_status": "synced",
      "model_sync_error": null
    }
  ],
  "manual_group_allowed": true,
  "warnings": []
}
```

Rules:

- Never return plaintext API keys, OAuth tokens, Hub tokens, or system access tokens.
- Merge NewAPI Hub catalog results with existing managed providers.
- If the server-side NewAPI sync token is missing, return a warning so the UI can ask the user to re-login.
- If the catalog is empty, keep `manual_group_allowed=true`.
- Do not treat a visible group name as proof that the group has usable models. NewAPI `GetHubUserGroups` only includes per-group model lists when the user has product access.

### `POST /api/user/newapi-sync/groups`

Synchronizes user-selected groups.

Request shape:

```json
{
  "groups": ["default"],
  "manual_groups": ["vip"]
}
```

Response shape:

```json
{
  "results": [
    {
      "group_id": "vip",
      "provider_id": "newapi-managed-vip",
      "model_count": 2,
      "has_api_key": true,
      "status": "synced",
      "error": null
    }
  ],
  "ai_settings": {
    "providers": []
  }
}
```

Rules:

- Normalize and deduplicate groups.
- Keep per-group success and failure independent.
- Save successful groups as managed providers through `AISettingsService.apply_managed_newapi_group_bootstrap`.
- Empty model groups use `model_sync_status=empty`, not fake success.
- Error groups keep `status=error` and a redacted message.
- A group with no models plus a Hub diagnostic error, such as missing product access or unavailable Hub token provisioning, must be `error`, not `synced`.
- Prefer `hub_api_token.authorization` / raw `key` from NewAPI Hub bootstrap when calling `/v1/models`; `sk_key` is a display/API-key form and must not be double-prefixed in a Bearer header.

## Server-Side Token State

Manual sync requires a server-side NewAPI Hub credential after login. Miaowu stores the NewAPI `system_access_token` in `Settings.preferences["newapi_sync"]["system_access_token_encrypted"]`.

Security rules:

- The browser never sees this value.
- Logs must only include user id, group id, model count, status, and `has_key`.
- Do not print values that look like `sk-`.
- Do not expose OAuth `code`, access token, system token, or Hub token in docs, tests, or API responses.

This is an MVP persistence path. A future hardening pass can move the token into a dedicated encrypted table with expiry metadata.

## Model Sync Diagnostics

The NewAPI source contract in `N:\new-api-main\controller\hub.go` is the source of truth for repeated "group exists but zero models" incidents:

- `POST /api/hub/session/bootstrap` returns `has_novel_product_access`, `hub_api_token.provisioning`, `hub_api_token.group`, `hub_api_token.authorization`, `hub_api_token.key`, `models`, and `quick_start.relay_base_url`.
- `GET /api/hub/user/groups` returns selectable groups. Its per-group `models` list is populated only when the user has the required product access.
- If `has_novel_product_access=false`, NewAPI deliberately does not create a usable Hub API token for model calls; Miaowu must surface that as a sync error.
- If `/v1/models` returns non-200 or the token is missing, Miaowu must preserve the diagnostic status instead of collapsing the result into a generic `0 models`.

When debugging, inspect these redacted facts in order: discovered group ids, `has_novel_product_access`, Hub token `provisioning`, token group, relay base URL, `/v1/models` HTTP status, parsed model count. Never log or return token values.

## Frontend Flow

The AI provider settings page uses a compact dialog:

1. User clicks "同步 NewAPI 分组/密钥".
2. Frontend calls `GET /api/user/newapi-sync/groups`.
3. Dialog shows discovered groups with model count, sync status, and whether a provider/key already exists.
4. If one group is discovered, it is selected by default.
5. User may add manual group names separated by comma, space, or newline.
6. User clicks "同步选中分组".
7. Frontend calls `POST /api/user/newapi-sync/groups`.
8. Frontend displays per-group results.
9. Frontend refreshes `/api/user/ai-settings` and shows each group as its own provider.
10. If token state is missing, user clicks "重新登录 NewAPI", which opens a new tab and returns to Miaowu after OAuth.

The UI must not ask the user to paste NewAPI keys. Key creation and storage are server-side.

## How To Adapt Another Project

Use this checklist when integrating NewAPI multi-group sync into another app:

1. Confirm whether the upstream gateway has group-scoped model catalogs.
2. Confirm whether one token can cover all groups. If not, design a selected-group token flow.
3. Add a redacted group catalog API.
4. Add a selected-group sync API.
5. Store group-scoped tokens only on the backend.
6. Save each group as an independent provider or runtime profile.
7. Preserve model group metadata during GET/PUT round-trip.
8. Add a UI where the user can choose groups; do not silently pick the first group in a multi-group account.
9. Treat zero-model groups as `empty`, not as a successful usable provider.
10. Add tests that search response JSON for known fake secret values and verify they are absent.

## Verification

Backend:

```powershell
cd N:\miaowu-os-merge-upstream-main\deer-flow-main\backend
uv run pytest tests/test_user_ai_settings_contract.py tests/test_newapi_oauth.py -q
uv run ruff check app/gateway/auth/newapi_oauth.py app/gateway/novel_migrated/api/user_settings.py tests/test_user_ai_settings_contract.py tests/test_newapi_oauth.py
```

Frontend:

```powershell
cd N:\miaowu-os-merge-upstream-main\deer-flow-main\frontend
pnpm typecheck
```

Runtime smoke:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8551/health
```

Local-dev contract:

- Gateway: `http://127.0.0.1:8551`
- Miaowu frontend: `http://127.0.0.1:14560` in the current user test setup, or `4560` in the fixed local-dev contract
- NewAPI: `http://127.0.0.1:3000`
- Do not use `8001` as the Windows local-dev default.
