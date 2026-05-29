# 第一批上游低风险同步

## Goal

将官方 `bytedance/deer-flow` 相对本地已收口基线 `c810e9f8` 的第一批低风险修复同步到 `miaowu-os`，前提是：

- 不破坏当前多账号/用户隔离改造
- 不触碰高交叉冲突区
- 不污染当前存在未提交改动的工作树

## Confirmed Facts

- 当前主工作树存在未提交改动，不能直接在原工作树上做同步。
- 本批目标来自官方 `c810e9f8..e8e9edc` 区间，用户已确认立即开始执行第一批。
- 本批纳入的 upstream commits：
  - 运行时与持久化：`cbf8b19`、`0fb0582`、`66d6a6a`、`2eeb597`、`9b19cca`、`737abc0`
  - 前端低耦合体验：`11dd5b0`、`f68bcb7`、`2fdfff0`、`e7967a7`
  - 后端/工具低风险修复：`3599b57`、`e19bec1`、`e8e9edc`、`b00749a`
- 本批显式排除：
  - `9c03a71` `backend/app/gateway/services.py`
  - `7ec8d3a` `backend/app/gateway/routers/mcp.py`
  - `d46a577` / `d0fa37e` / `0287240` `frontend/src/core/threads/hooks.ts`
  - `c881d95` / `162fb21` MCP session pooling
  - `b103d1a` static demo mode
  - `ca48757` ToolOutputBudgetMiddleware

## Requirements

- 先建立隔离执行环境，避免覆盖当前工作树中的未提交改动。
- 在实际改动前创建可回滚备份，至少包含：
  - 当前提交状态的备份分支
  - 当前脏工作树的补丁级备份
- 仅同步本批 14 个 commit 对应的 `deer-flow-main/` 子树改动。
- 对冲突或高交叉文件保持“本地二开优先”，必要时放弃纳入本批。
- 同步完成后执行最小必要验证：
  - 后端定向 `pytest`
  - 后端定向 `compileall` / `py_compile`
  - 前端 `pnpm tsc --noEmit`
- 生成本批变更记录，说明：
  - 实际纳入的 commit
  - 被排除或延期的文件
  - 冲突裁决方式
  - 验证结果与残余风险

## Acceptance Criteria

- [ ] 已创建隔离工作树或等效隔离环境，当前主工作树未被改动。
- [ ] 已创建备份分支与脏工作树补丁备份。
- [ ] 本批 14 个 commit 的低风险改动已尽可能落地到 `deer-flow-main/` 子树。
- [ ] 被识别为高交叉或非低风险的改动未被误纳入。
- [ ] 已完成本批最小必要验证，并明确记录失败项或限制。
- [ ] 已输出本批同步摘要与冲突/延期清单。

## Out of Scope

- 不处理 `services.py`、`routers/mcp.py`、`hooks.ts`、`AuthProvider.tsx` 等高交叉专题。
- 不处理 MCP session pooling、ToolOutputBudgetMiddleware、static demo mode、MiMo reasoning support。
- 不清理或改写当前主工作树里的其他未提交改动。
