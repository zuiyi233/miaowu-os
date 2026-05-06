# PRD - 修复 /api/agents 403 导致智能体页面长时间加载

## 背景
在 local-dev 配置下，`config.yaml` 中 `agents_api.enabled=false` 会导致 backend `/api/agents` 返回 403。前端 `listAgents` 未识别该场景，页面会经历较长加载并最终表现不清晰。

## 目标
1. 前端识别 agents API disabled 场景并提供明确 UI 提示，不再误导为加载中或空列表。
2. 本地开发默认开启 `agents_api.enabled`，避免该场景在当前仓库反复出现。

## 变更范围
- `frontend/src/core/agents/api.ts`
- `frontend/src/core/agents/hooks.ts`
- `frontend/src/components/workspace/agents/agent-gallery.tsx`
- `config.yaml`（仅 `agents_api.enabled` 字段）

## 非目标
- 不改 `config.example.yaml`
- 不改与 agents API disabled 无关逻辑
- 不处理其他页面/模块 UI 重构

## 验收标准
- `listAgents` 在 `/api/agents` 非 2xx 且 detail 包含 `agents_api.enabled` 时抛出 `AgentsApiDisabledError`，并尽可能显示后端 detail 原因。
- `useAgents` 暴露 `isAgentsApiDisabled`。
- `agent-gallery` 在 disabled 场景显示明确提示，不展示“空列表”语义，不触发新建跳转按钮。
- 运行：`pnpm -C frontend lint` 与 `pnpm -C frontend typecheck`。
