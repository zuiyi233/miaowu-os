# 第一批上游低风险同步变更记录

## 执行环境

- 隔离 worktree：`N:\miaowu-os-merge-upstream-main-worktrees\batch1-upstream-low-risk-sync`
- 工作分支：`codex/batch1-upstream-low-risk-sync`
- 主工作树：未改动

## 备份

- 备份分支：`backup-before-batch1-sync-20260530-015419`
- 备份目录：`D:\miaowu-os-backups\upstream-sync\batch1-20260530-015419`

## 同步策略

- 不直接 `cherry-pick` 官方 commit。
- 采用 selective semantic merge：按上游语义逐段移植到本地 `deer-flow-main/` 子树。
- 本地二开优先，尤其保护：
  - 多账号 / 用户隔离逻辑
  - 本地 local-dev `127.0.0.1:8551`
  - 已有小说与网关二开链路

## 本批实际纳入

### 运行时与持久化

- `cbf8b19`
  - JSONL event store 改为 `asyncio.to_thread` I/O
  - 加入 per-thread lock / seq counter 管理
  - 补 `delete_by_thread` 清理
- `0fb0582`
  - `RunManager.create()` 改为“持久化成功后才可见”
  - `create_or_reject()` 改为“新 run 持久化成功后再中断旧 run”
  - 失败或取消时回滚内存态
- `66d6a6a`
  - 增加持久化短重试策略
  - `RunRepository.put()` 幂等 upsert
  - `update_status()` / `update_run_completion()` 支持 rowcount 返回
  - 增加 `list_inflight()` 与 sqlite 启动恢复
  - 启动时将孤儿 inflight run 标记为 error，并在必要时同步 thread 状态
- `2eeb597`
  - `RunJournal` 增加 progress snapshot、caller bucket token 统计、消息摘要
  - `worker.py` 接入 `progress_reporter`
  - `thread_runs.py` 支持 `include_active=true`
  - `RunResponse` 暴露运行中 token / message 计数
- `9b19cca`
  - `cancel()` 对已 interrupted run 保持幂等成功
- `737abc0`
  - 本批范围内未发现需要额外人工补丁的残缺点，保留此前已同步语义

### 前端低耦合体验修复

- `11dd5b0`
  - 未闭合 `<think>` 预处理
- `f68bcb7`
  - 剪贴板保护
- `2fdfff0`
  - 历史 Mermaid 预览修复
- `e7967a7`
  - streaming assistant 回复隐藏 copy
- 另外补了 stale reconnect `409` 的 `sessionStorage` 清理，保持与本地前端现状一致

### 后端 / 工具低风险修复

- `3599b57`
  - async-only tools 的 sync wrapper 语义补齐
- `e19bec1`
  - task-tool 超时清理相关契约覆盖
- `e8e9edc`
  - channels 隐藏 human control message 过滤
- `b00749a`
  - `DEER_FLOW_INTERNAL_AUTH_TOKEN` 支持
  - compose / deploy 接线同步，但保持本地 `8551` 约定不回退到 upstream `8001`

## 明确延期 / 排除

- `backend/app/gateway/services.py`
- `backend/app/gateway/routers/mcp.py`
- `frontend/src/core/threads/hooks.ts`
- MCP session pooling
- static demo mode
- ToolOutputBudgetMiddleware

这些内容要么与多账号主链重叠高，要么冲突面大，不属于第一批低风险同步。

## 冲突裁决

### 1. 根路径映射冲突

- 官方仓库以根目录组织
- 本地二开以 `deer-flow-main/` 子树承载
- 结论：不能直接套 patch，只能按语义移植

### 2. 多账号优先

- 所有 run / thread / store 持久化修复仅补稳定性与恢复能力
- 未引入任何 upstream 单账号回退逻辑
- 所有 `user_id` 过滤契约保持本地实现

### 3. local-dev 端口优先

- Docker / env / deploy 接线保留本地 `127.0.0.1:8551`
- 未将 upstream `8001` 误带回 Windows local-dev 直连场景

## 关键修改文件

- `backend/packages/harness/deerflow/runtime/journal.py`
- `backend/packages/harness/deerflow/runtime/runs/worker.py`
- `backend/packages/harness/deerflow/runtime/runs/manager.py`
- `backend/packages/harness/deerflow/runtime/runs/store/base.py`
- `backend/packages/harness/deerflow/runtime/runs/store/memory.py`
- `backend/packages/harness/deerflow/persistence/run/sql.py`
- `backend/app/gateway/deps.py`
- `backend/app/gateway/routers/thread_runs.py`
- `backend/packages/harness/deerflow/runtime/events/store/jsonl.py`
- `backend/app/channels/manager.py`
- `backend/app/gateway/internal_auth.py`
- `backend/packages/harness/deerflow/tools/sync.py`
- 前端相关 `copy-button` / `markdown-content` / `message-list` / `recent-chat-list` / `api-client` / `streamdown`

## 验证结果

### 本轮重新执行

- `py_compile`：
  - `journal.py`
  - `worker.py`
  - `manager.py`
  - `store/base.py`
  - `store/memory.py`
  - `sql.py`
  - `deps.py`
  - `thread_runs.py`
- `pytest` 定向运行时集合：`104 passed`
- `pytest` 第一批后端回归集合：`324 passed`

### 前序已验证

- 前端单测：`8 passed`
- `pnpm tsc --noEmit`：通过
- 说明：这两项来自本批 worktree 的前序验证，本轮未重复执行

## 当前限制

- 变更目前仅在隔离 worktree 和分支中，尚未合并回主工作树。
- 尚未做人工多账号功能验收；当前结论基于定向自动化测试。
- 第一批之外的高交叉上游改动仍需后续分批处理。
