# Design: NewAPI 手动分组同步与密钥选择流程

## Design Summary

把 NewAPI 同步拆成两个显式阶段：

1. **发现分组**：后端为当前 Miaowu 用户查询 NewAPI Hub 可用分组，并结合已保存的 managed providers 形成脱敏目录。
2. **指定分组同步**：前端让用户选择或输入分组名，后端按这些分组创建/复用 token、拉模型、保存 provider。

自动 OAuth callback 可以继续做 best-effort 同步，但产品主路径不再依赖它必须完整发现全部分组。多分组时，用户选择是权威控制面。

## Architecture Boundaries

### NewAPI

NewAPI 负责：

- OAuth/OIDC 用户身份。
- Hub bootstrap。
- group catalog。
- group-scoped token 创建/复用。
- `/v1/models` 模型目录。

Miaowu-OS 不直接修改 NewAPI 分组权限，也不在前端读取 NewAPI secret。

### Miaowu Backend

Miaowu backend 负责：

- 当前 session 用户隔离。
- 保存 NewAPI account snapshot。
- 发起 server-side NewAPI Hub 调用。
- 加密或后端持久化 group token。
- 返回脱敏 provider/group 状态。

### Miaowu Frontend

Miaowu frontend 负责：

- 展示分组选择面板。
- 允许手动输入分组名。
- 发起同步请求。
- 刷新并展示 AI provider 列表。

前端不保存真实 key，不把 key 放入 localStorage。

## Proposed Backend Contracts

### GET `/api/user/newapi-sync/groups`

返回当前用户可选择同步的 NewAPI 分组目录。

Response:

```json
{
  "groups": [
    {
      "group_id": "default",
      "name": "default",
      "models": ["model-a"],
      "model_count": 1,
      "provider_id": "newapi-managed-default",
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

Notes:

- `models` 可以返回模型 id 列表，但不返回 key。
- 如果无法从 NewAPI Hub 获取 catalog，返回空 groups + warning，让前端展示手动输入。
- 如果当前用户没有 NewAPI OAuth snapshot 或 server-side token 不可用，返回 401/409 或 warning，要求重新登录 NewAPI。

### POST `/api/user/newapi-sync/groups`

按用户选择同步分组。

Request:

```json
{
  "groups": ["default", "vip"],
  "manual_groups": ["svip"]
}
```

Response:

```json
{
  "results": [
    {
      "group_id": "vip",
      "provider_id": "newapi-managed-vip",
      "model_count": 23,
      "has_api_key": true,
      "status": "synced",
      "error": null
    }
  ],
  "ai_settings": { "...": "same shape as /api/user/ai-settings" }
}
```

Rules:

- Normalize and de-duplicate group names.
- Reject empty group name.
- Each group result is independent.
- If one group fails, other groups can still persist.
- A request with zero valid groups returns 400.

## Backend Implementation Shape

Reuse existing functions in `app.gateway.auth.newapi_oauth`:

- `_fetch_newapi_hub_group_catalog`
- `_bootstrap_newapi_group_tokens`
- `_build_newapi_managed_group_items`
- `_build_legacy_newapi_group_item`
- `_extract_newapi_system_access_token`

Recommended new helper:

```python
async def sync_newapi_groups_for_user(
    user_id: str,
    settings: NewAPIOAuthSettings,
    access_token: str,
    groups: list[str],
) -> NewAPIManualGroupSyncResult:
    ...
```

But the current code only has OIDC access token during callback. For later manual sync, backend needs a server-side credential path. Options:

1. Store encrypted `system_access_token` per NewAPI account snapshot.
2. Re-run OAuth login and use callback to seed a short-lived pending sync selection.
3. Use NewAPI `/api/hub/session/bootstrap` with an already persisted system access token if available.

Recommended MVP:

- Store NewAPI `system_access_token` server-side in the account snapshot/preferences if available, encrypted where project encryption is enabled.
- Never return it to frontend.
- Manual sync API uses stored system token.
- If token missing, API returns “需要重新 NewAPI 登录”，front-end opens OAuth in a new tab and then retries.

If adding a new DB column is too risky for MVP, store it in `Settings.preferences["newapi_sync"]` with encryption helper, but document migration debt.

## Frontend UX

Current button:

```text
同步 NewAPI 分组/密钥
```

New behavior:

- Opens a compact dialog/panel in AI provider settings.
- On open, calls `GET /api/user/newapi-sync/groups`.
- Shows discovered groups as checkboxes:
  - group name
  - model count
  - current sync status
  - already synced indicator
- Provides manual input: “手动输入分组名”。
- Primary action: “同步选中分组”。
- After success, calls `refreshFromServer()` and closes or shows result summary.

Do not use a landing page. Keep it in the existing SaaS settings style.

## Compatibility

- Existing `/api/user/ai-settings` remains the canonical provider bundle.
- Existing OAuth callback can still perform initial best-effort sync.
- Existing env-managed NewAPI fallback remains only for deployments without OAuth group providers.
- Existing custom/OpenAI provider flows must not change.

## Failure Modes

| Failure | Expected behavior |
| --- | --- |
| NewAPI group catalog unavailable | Show warning and allow manual group input |
| Stored system token missing/expired | Ask user to re-login NewAPI in new tab |
| One selected group bootstrap fails | Mark that group error, keep other successful groups |
| `/v1/models` returns empty | Save provider as `empty`, disable as default candidate |
| Frontend save occurs after sync | Preserve `model_groups` and managed metadata |
| Gateway container not current | Rebuild or fully sync dependency set before smoke |

## Security

- No real key/token in logs.
- No real key/token in frontend state.
- No real key/token in docs/test output.
- Only return `has_api_key`.
- Manual group names are not secrets, but should still be normalized and length-limited.

## Rollback

If manual sync causes issues:

- Hide/disable the new dialog entry point.
- Keep existing OAuth callback sync and `/api/user/ai-settings`.
- Provider records saved by the new flow are ordinary managed providers and can be removed by replacing the provider bundle or re-running sync.

