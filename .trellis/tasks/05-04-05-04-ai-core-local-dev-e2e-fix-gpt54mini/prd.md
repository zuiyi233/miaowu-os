# PRD — AI核心功能 local-dev 持续回归与修复（gpt-5.4-mini）

## 目标
在 `D:/miaowu-os/deer-flow-main` 的 local-dev 环境中，使用 `gpt-5.4-mini` 持续执行 API 级端到端回归并修复项目代码问题，直到能够基于证据给出“AI核心功能是否恢复正常”的明确结论。

## 范围
- 仅处理项目代码问题（backend/frontend/script/config within repo）。
- 若判定为上游服务问题，不做越权改动，仅记录证据链。
- 修复策略优先最小改动，并保持与 upstream 核心逻辑兼容。

## 硬约束
1. local-dev 端口固定：backend `8551`，frontend `4560`；不得使用 `8001` 作为默认值。
2. 所有 API 测试请求都显式携带 `gpt-5.4-mini`（按路由支持字段：`model`/`model_name`/`context`/`configurable`/`provider_config`）。
3. 每次代码修改后，执行最小必要验证（至少 `py_compile` + 相关 `pytest`）。

## 执行闭环（循环）
A. 启动/重启 local-dev，并确认 `/health` 返回 `200`。
B. API 级端到端测试：
- `/api/v1/auth/register` + `/login/local`
- `/api/ai/chat`（非流式一次；流式一次，若支持）
- `/api/threads` -> `/api/threads/{thread_id}/runs/stream`（SSE）
- `/api/threads/{thread_id}/suggestions`（如可测）
C. 失败分类：
- 项目代码问题：修复并复测
- 上游服务问题：记录请求/响应/请求ID/run_id/状态码/关键日志行
D. 收敛输出：
- 每个功能的请求步骤、HTTP 状态、SSE 事件统计
- 后端日志关键证据
- 代码改动文件与原因
- 验证命令与结果
- 最终明确结论：是否可判定 AI 功能正常

## 非目标
- 不进行无关重构
- 不调整非必要架构
- 不引入与任务无关的新依赖
