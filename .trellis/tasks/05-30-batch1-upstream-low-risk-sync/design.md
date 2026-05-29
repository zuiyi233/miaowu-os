# 设计：第一批低风险上游同步

## 目标

以隔离工作树为执行载体，把官方第一批低风险修复同步进本地二开仓库，同时把多账号/用户隔离改造的风险面控制在最小范围。

## 执行边界

### 纳入主题

1. 运行时/持久化稳态
2. 前端纯体验修复
3. 低风险后端/工具修复

### 排除主题

1. 多账号高交叉 API 与 gateway services
2. MCP 用户级配置与 session pooling
3. `hooks.ts` 线程/消息复合逻辑
4. static demo / ToolOutputBudgetMiddleware / MiMo reasoning

## 隔离策略

由于主工作树存在未提交改动，本批必须：

1. 在根仓库创建备份分支
2. 导出当前脏工作树补丁
3. 新建干净 worktree + 分支作为实施环境

这样可以同时满足：

- 原工作树保持不动
- 新批次同步可提交、可测试
- 出错时可直接丢弃隔离工作树回滚

## 合并策略

采用“逐提交定向应用 + 子树映射”而不是根级 merge：

- 官方仓库根路径 `backend/**` → 本地 `deer-flow-main/backend/**`
- 官方仓库根路径 `frontend/**` → 本地 `deer-flow-main/frontend/**`
- 只复制/改动本批 commit 实际触达且低风险的文件
- 对本地已有差异的文件优先保留本地业务语义，再补上游修复

## 关键风险

### 1. Runtime persistence 文件与本地 run store 改造叠加

虽然不是多账号主链，但 `runtime/runs/**`、`persistence/run/**`、`gateway/deps.py` 仍然可能与本地运行时修复存在局部冲突。处理方式：

- 以当前本地文件为主
- 逐段引入上游稳态修复
- 用相关 pytest 校验行为

### 2. 前端体验修复与本地小说/UI 二开间接交叉

`markdown-content.tsx`、`copy-button.tsx`、`artifact-file-detail.tsx` 等文件可能被本地 UI 微调过。处理方式：

- 优先保留本地视觉/业务分支
- 只吸收明确的 bugfix 逻辑

### 3. 内部 token 共享修复的网关边界

`b00749a` 涉及 `internal_auth` / worker 间令牌共享，需要确认不影响本地多账号鉴权模型。因为它不直接触达 user-scoped settings，本批可纳入，但需加定向测试。

## 验证策略

### 后端

- 与 run persistence、gateway internal auth、channels、task tool、runtime event store 相关 pytest
- `compileall` / `py_compile` 覆盖本批改动的关键 Python 文件

### 前端

- `pnpm tsc --noEmit`
- 如可行，补运行相关单测

### 功能回归

- 不做全量多账号功能验收
- 仅确认本批未明显破坏附件预览、复制按钮、Mermaid 历史渲染、streaming 展示与 run 相关 API
