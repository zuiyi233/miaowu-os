# 执行计划：后续真正同步时的落地顺序

## 预检

- 确认官方 remote 指向 `https://github.com/bytedance/deer-flow.git`
- 清理或隔离当前未提交改动，避免污染同步批次
- 创建备份分支与 bundle 备份

## 批次执行顺序

1. 批次 1：低风险基础修复
2. 批次 2：安全与消息契约修复
3. 批次 3：线程交互体验修复
4. 批次 4：专题验证项

## 每批固定动作

1. 记录官方目标 commit 和纳入的提交列表
2. 仅同步 `deer-flow-main/` 子树
3. 生成人工冲突清单
4. 以本地二开逻辑优先完成裁决
5. 运行本批最小必要验证
6. 记录验证结果、限制和剩余风险

## 高风险文件清单

- `deer-flow-main/backend/app/gateway/routers/mcp.py`
- `deer-flow-main/backend/app/gateway/services.py`
- `deer-flow-main/backend/packages/harness/deerflow/agents/lead_agent/agent.py`
- `deer-flow-main/backend/packages/harness/deerflow/mcp/tools.py`
- `deer-flow-main/backend/packages/harness/deerflow/tools/builtins/task_tool.py`
- `deer-flow-main/backend/packages/harness/deerflow/tools/tools.py`
- `deer-flow-main/frontend/src/components/workspace/artifacts/artifact-file-detail.tsx`
- `deer-flow-main/frontend/src/core/auth/AuthProvider.tsx`
- `deer-flow-main/frontend/src/core/threads/hooks.ts`

## 验证命令基线

- 后端：定向 `pytest` + `compileall`
- 前端：`pnpm tsc --noEmit`
- 功能：多账号设置、MCP 配置、附件消息、新线程侧栏、小说链路
