# PRD: 本轮工作区改动质量检查与自修复

## 背景
用户要求对当前工作区本轮改动做质量检查，并在发现问题时直接修复。

## 范围（重点文件）
1. `frontend/src/core/threads/hooks.ts`
2. `frontend/src/core/threads/submit-retry.ts`
3. `frontend/src/app/workspace/chats/[thread_id]/page.tsx`
4. `frontend/src/app/workspace/agents/[agent_name]/chats/[thread_id]/page.tsx`
5. `frontend/src/components/workspace/settings/ai-provider-settings-page.tsx`
6. `frontend/tests/unit/core/threads/submit-retry.test.ts`

## 检查点
- 用户主动 stop 时不应产生未处理 `AbortError`
- 配置/认证错误不应盲目重试导致长 loading
- 与现有逻辑兼容，不引入无关重构
- `lint` / `typecheck` / 目标单测保持通过

## 完成标准
- 对上述文件完成代码审查
- 发现问题则在当前工作区直接修复
- 至少执行并汇报：
  - 前端 lint
  - 前端 typecheck
  - 目标单测：`frontend/tests/unit/core/threads/submit-retry.test.ts`
