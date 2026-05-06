# 任务目标
在不触碰 backend 业务逻辑的前提下，核查并修复 `D:/miaowu-os/deer-flow-main` 前端与 env/nginx 的网关契约一致性，确保 local-dev 仍以 `http://127.0.0.1:8551` 为后端基址，不回退到 `8001`。

# 范围（严格限定）
- deer-flow-main/frontend/.env.example
- deer-flow-main/frontend/src/core/auth/gateway-config.ts
- deer-flow-main/frontend/src/content/en/harness/tools.mdx
- deer-flow-main/frontend/src/content/zh/harness/tools.mdx
- deer-flow-main/frontend/tests/unit/core/auth/gateway-config.test.ts
- deer-flow-main/.env.example
- deer-flow-main/docker/nginx/nginx.conf

# 必达目标
1. 对照 upstream 同步后状态，确认 local-dev 契约（127.0.0.1:8551）未被破坏。
2. 修复范围内任何明确不一致问题（仅限上述文件）。
3. 执行最小验证：Vitest 定向用例，必要时补充静态检查。

# 非目标
- 不改 backend 业务逻辑。
- 不做范围外重构/格式化。
- 不修改 WSL 前端依赖流程（Win-only 约束保持不变）。
