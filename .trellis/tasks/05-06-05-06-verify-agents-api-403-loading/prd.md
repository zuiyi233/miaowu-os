# 任务目标
对 `D:/miaowu-os/deer-flow-main` 本轮“智能体页 `/api/agents` 403 + 长加载”修复做校验，输出按严重度排序的 findings，并给出是否建议提交。

# 校验范围（严格限定）
- `frontend/src/core/agents/api.ts`
- `frontend/src/core/agents/hooks.ts`
- `frontend/src/components/workspace/agents/agent-gallery.tsx`
- `config.yaml`

# 检查点
1. `agents_api` disabled 时前端应快速失败并显示明确提示，不再长时间 loading。
2. `listAgents` / `create` / `check` 的 disabled 错误识别逻辑一致。
3. retry 策略避免在 disabled 场景重复重试。
4. 配置开启后应从 `403(disabled)` 转为鉴权约束（未登录 `401`），不是继续 `403(disabled)`。
5. 执行并记录：`pnpm -C frontend lint` 与 `pnpm -C frontend typecheck`。

# 非目标
- 不改动范围外文件。
- 不做无关重构。
