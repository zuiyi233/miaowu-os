# PRD：同步 upstream/main 到 merge/upstream-main（保留二开功能）

## 背景
- 当前工作分支：`merge/upstream-main`
- 当前 HEAD：`5efd3592`
- 上游最新：`upstream/main = 189b8240`（2026-05-01 fetch 后）
- 已有经验文档：`D:/miaowu-os/docs/upstream-sync-guide.md`

## 目标
1. 将 `upstream/main` 最新变更同步到当前分支。
2. 严格沿用已有经验：仅同步 `deer-flow-main/` 子目录，避免引入上游完整历史与根目录噪音。
3. 完整保留二开能力（尤其 novel 相关）。
4. 处理同步冲突并保证项目可编译/可运行的最低验证。

## 非目标
- 不做无关重构。
- 不调整 WSL 前端依赖流程（保持 Win-only 依赖管理）。
- 不改动 `deer-flow-main/` 以外目录（除任务文档）。

## 实施范围
- Git 同步对象：`upstream/main` -> `merge/upstream-main`
- 代码范围：`deer-flow-main/**`
- 重点核对文件（按经验）：
  - `deer-flow-main/frontend/src/core/threads/hooks.ts`
  - `deer-flow-main/frontend/src/components/workspace/messages/message-list.tsx`
  - `deer-flow-main/frontend/src/app/workspace/chats/[thread_id]/page.tsx`
  - `deer-flow-main/backend/app/gateway/routers/__init__.py`
  - `deer-flow-main/backend/app/gateway/app.py`

## 验收标准
- Git：
  - 分支仍为 `merge/upstream-main`
  - 工作区 clean
  - 仅包含预期同步提交（必要时 + 冲突修复提交）
- 代码：
  - 二开关键点未丢失（novel_migrated、hooks.ts 自定义逻辑等）
- 验证：
  - 前端：`pnpm -C deer-flow-main/frontend tsc --noEmit` 通过
  - 后端：`python -m py_compile deer-flow-main/backend/app/gateway/app.py` 通过
  - 如验证失败，明确列出失败点与阻塞

## 风险
- 上游近期变更可能触发 novel 分支逻辑冲突。
- front/backend 依赖状态可能导致编译误报；需区分“代码错误”与“环境依赖缺失”。
