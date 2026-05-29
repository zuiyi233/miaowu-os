# 第二批上游安全与契约同步变更记录

## 执行环境

- 隔离 worktree：`N:\miaowu-os-merge-upstream-main-worktrees\batch1-upstream-low-risk-sync`
- 工作分支：`codex/batch2-upstream-security-contract-sync`
- 基线提交：`556cb97c` (`feat: sync upstream batch1 low-risk fixes`)
- 主工作树：未用于本批实现

## 备份

- 备份分支：`backup-before-batch2-sync-20260530-034130`

## 同步策略

- 不直接 `cherry-pick` 上游提交。
- 采用 selective semantic merge：只移植上游安全与契约语义，不覆盖本地 Miaowu-OS 多账号、novel、runtime-provider 二开主干。
- 明确保留：
  - `require_admin_user` 权限约束
  - 本地多账号 / 用户隔离
  - local-dev `127.0.0.1:8551`
  - `.deer-flow/` 临时目录

## 本批实际纳入

### 1. `9c03a71` `backend/app/gateway/services.py`

- `normalize_input()` 改为优先透传 `BaseMessage`
- dict message 改为使用 `convert_to_messages([msg])`
- 保留：
  - `additional_kwargs`
  - `id`
  - `name`
  - `tool_call_id`
  - `system` / `ai` / `tool` 等非 human role
- 畸形消息项改为在网关边界返回 `HTTP 400`
  - 错误信息包含 `input.messages[{index}]`

### 2. `7ec8d3a` `backend/app/gateway/routers/mcp.py`

- 新增 `_MASKED_VALUE = "***"`
- 新增 `_mask_server_config()`
  - `GET /api/mcp/config` 对 env/header 值做掩码
  - 不返回 OAuth `client_secret` / `refresh_token`
- 新增 `_merge_preserving_secrets()`
  - 支持前端对 masked 配置的安全 round-trip
  - 现有 secret 保留，新增 secret key 禁止直接传 `***`
  - OAuth `""` 视为显式清空，`null` 视为保留原值
- `PUT /api/mcp/config` 现在：
  - 从磁盘 raw config 合并 secret
  - 保留本地 `features`
  - 保留额外顶层键，如 `mcpInterceptors`

## 冲突裁决

### 1. `services.py` 深度本地定制冲突

- 上游文件与本地多账号/runtime provider/novel 路由逻辑差异很大
- 结论：只吸收消息规范化契约，不引入上游其余结构性修改

### 2. `mcp.py` 权限与配置结构冲突

- 上游版本没有本地 `require_admin_user`
- 本地版本已有 `features` 写回保护
- 结论：
  - 保留本地 admin-only 接口
  - 保留本地 `features`
  - 增量吸收 secret masking 和 masked round-trip 逻辑

### 3. 配置持久化冲突

- 上游修复要求保留 raw top-level keys
- 本地已有扩展配置项，不应因 MCP 更新被丢失
- 结论：写回时保留 `mcpServers` / `skills` / `features` 之外的 raw 顶层键

## 关键修改文件

- `deer-flow-main/backend/app/gateway/services.py`
- `deer-flow-main/backend/app/gateway/routers/mcp.py`
- `deer-flow-main/backend/tests/test_gateway_services.py`
- `deer-flow-main/backend/tests/test_mcp_config_secrets.py`
- `.trellis/spec/backend/quality-guidelines.md`
- `deer-flow-main/backend/README.md`
- `deer-flow-main/backend/CLAUDE.md`

## 验证结果

### 自动化验证

- `cd deer-flow-main/backend && $env:PYTHONPATH='.'; uv run pytest tests/test_gateway_services.py -q`
  - `47 passed`
- `cd deer-flow-main/backend && $env:PYTHONPATH='.'; uv run pytest tests/test_mcp_config_secrets.py -q`
  - `16 passed`
- `cd deer-flow-main/backend && $env:PYTHONPATH='.'; uv run pytest tests/test_auth_middleware.py -q`
  - `50 passed`
- `cd deer-flow-main/backend && $env:PYTHONPATH='.'; uv run pytest tests/test_gateway_services.py tests/test_mcp_config_secrets.py tests/test_auth_middleware.py -q`
  - `113 passed`

### 质量说明

- 初次直接用系统 Python 跑测试失败，原因是没走项目标准 `uv run` 环境，缺 `langchain_core` 与 `email-validator`。
- 已改为仓库标准方式 `uv run pytest` 验证，最终通过。

## 当前限制

- 本批仅覆盖上游第二批中 `services.py` 与 `mcp.py` 两个中风险点；MCP session pooling、`hooks.ts` 等仍未纳入。
- 未执行更大范围的全量后端/前端回归；当前结论基于 batch2 定向自动化测试。
- 变更仍在隔离 worktree / 分支中，尚未并回主工作树。
