# 第二批上游安全与契约同步

## Goal

在第一批低风险同步 `556cb97c` 基线上，增量吸收上游第二批中两项高价值且可控的中风险修复：

- `9c03a71` `backend/app/gateway/services.py`
- `7ec8d3a` `backend/app/gateway/routers/mcp.py`

同步方式必须以本地 Miaowu-OS 多账号改造为主干，保留本地鉴权、用户隔离、local-dev `127.0.0.1:8551` 约定和已有网关二开逻辑。

## Requirements

- 只在隔离 worktree `N:\miaowu-os-merge-upstream-main-worktrees\batch1-upstream-low-risk-sync` 上实施。
- 以当前第一批稳定提交为回退点，不直接覆盖或回滚本地多账号改造。
- `services.py` 必须吸收上游消息规范化契约：
  - `normalize_input()` 保留 `additional_kwargs`、`id`、`name`、非 human role 等消息元数据。
  - 对畸形消息条目在 HTTP 边界返回 `400`，且错误信息包含具体索引。
- `routers/mcp.py` 必须吸收上游 MCP 配置安全契约：
  - `GET /api/mcp/config` 不得返回明文 env/header secret，也不得返回 OAuth `client_secret` / `refresh_token`。
  - `PUT /api/mcp/config` 必须支持前端把 `GET` 的 masked 配置原样 round-trip 回来时保留原 secret。
  - `PUT /api/mcp/config` 必须保留本地已有的 `features` 顶层配置，以及原始配置文件中的其他顶层键，例如 `mcpInterceptors`。
- 必须保留本地 `require_admin_user` 权限依赖，不回退到上游单用户/弱权限行为。
- 不清理 `.deer-flow/` 临时目录。
- 变更完成后需要补充本批同步记录，明确纳入的上游语义、冲突裁决与测试结果。

## Acceptance Criteria

- [ ] `backend/app/gateway/services.py` 已完成语义合并，本地多账号逻辑不变，消息规范化新增契约测试通过。
- [ ] `backend/app/gateway/routers/mcp.py` 已完成语义合并，admin 权限依赖仍在，secret masking / masked round-trip / top-level key 保留测试通过。
- [ ] 至少完成以下自动化验证并通过：
  - `backend/tests/test_gateway_services.py`
  - `backend/tests/test_mcp_config_secrets.py`
  - `backend/tests/test_auth_middleware.py`
- [ ] 本批变更已提交到独立分支，不与第一批提交混在一起。
- [ ] 生成本批同步记录，写明上游内容、冲突解决策略、验证结果与限制。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
