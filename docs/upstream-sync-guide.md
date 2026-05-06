# 上游同步操作手册

> 基于 2026-05-01 首次成功同步 bytedance/deer-flow 上游的实战经验总结。
> 最后更新：2026-05-05（第三次增量同步完成）

---

## 0. 当前同步状态速查

| 项目 | 值 |
|------|-----|
| 同步分支 | `merge/upstream-main` |
| 上游最新 commit | `8e48b7e8` |
| 上游同步基线 | `44ab21fc`（上次同步终点） |
| 本次同步 commit 数 | 7 个（`44ab21fc..8e48b7e8`） |
| 同步完整度 | **7/7 已全部对齐** |
| 前端 tsc | **零错误** |
| 后端 py_compile | **全部通过** |
| 小说自定义代码 | **hooks.ts 6 处完整保留** |

### 上游已同步的全部 commit

#### 第一批（2026-05-01/02 同步，基线 → 189b8240）

| 上游 commit | 描述 | 状态 |
|-------------|------|------|
| `189b8240` | fix(sandbox): pass no_change_timeout to exec_command | ✅ 已合并 |
| `487c1d93` | fix(subagents): use model override for tools and middleware | ✅ 已合并 |
| `c09c3345` | fix(harness): resolve runtime paths from project root | ✅ 已合并 |
| `8939ccae` | fix(uploads): enforce streaming upload limits in gateway | ✅ 已合并 |
| `83938cf3` | fix(subagents): propagate user context across threaded execution | ✅ 部分→已补全 |
| `78633c69` | fix(agents): propagate agent_name into ToolRuntime.context | ✅ 已补全 |
| `8b61c94e` | fix: keep lead agent graph factory signature compatible | ✅ 已合并 |
| `1ad1420e` | refactor(skills): Unified skill storage capability | ✅ 已合并 |

#### 第二批（2026-05-02 同步，189b8240 → 44ab21fc）

| 上游 commit | 描述 | 状态 |
|-------------|------|------|
| `44ab21fc` | feat(community): add Serper web search provider | ✅ 已合并 |
| `e543bbf5` | [security] fix(upload): reject symlinked upload destinations | ✅ 已合并 |
| `ca3332f8` | fix(gateway): return ISO 8601 timestamps from threads endpoints | ✅ 已合并 |

#### 第三批（2026-05-05 同步，44ab21fc → 8e48b7e8）

| 上游 commit | 描述 | 状态 |
|-------------|------|------|
| `f80ac961` | fix(harness): restore legacy skills path fallback | ✅ 已合并 |
| `222a7773` | fix(frontend): avoid misleading error message when agent api is disable | ✅ 已合并 |
| `82e7936d` | fix(docker): set UTF-8 locale to prevent ASCII encoding errors | ✅ 已合并 |
| `d02f762a` | feat: refine token usage display modes | ✅ 已合并 |
| `b10eb7ba` | feat(github): Added container push workflow | ✅ 已合并 |
| `af6e48cc` | fix(i18n): add Chinese translations for account settings page | ✅ 已合并 |
| `8e48b7e8` | fix(channels): preserve clarification conversation history across follow-up turns | ✅ 已合并 |

### 已验证的依赖版本组合（与上游完全一致）

| 包 | 版本 | 约束来源 |
|----|------|----------|
| `langgraph` | **1.0.9** | `pyproject.toml`: `>=1.0.6,<1.0.10` |
| `langgraph-prebuilt` | **1.0.8** | `pyproject.toml`: `<1.0.9`（手动锁定，防自动升级到不兼容的 1.0.13） |
| `langgraph-runtime-inmem` | 0.27.4 | 自动解析 |
| `langchain` | 1.2.10 | 自动解析 |
| `langchain-core` | 1.3.2 | 自动解析 |

> ⚠️ **重要**：`langgraph-prebuilt ≥ 1.0.9` 与 `langgraph 1.0.9` 不兼容（前者引入了 `ExecutionInfo` / `ServerInfo` 导入，需 `langgraph ≥ 1.0.10`）。上游约束 `<1.0.10` 禁止了 langgraph 升级路径，因此必须锁定 `langgraph-prebuilt<1.0.9`。详见本手册 7.2 节。

---

## 1. 项目背景

| 项目 | 说明 |
|------|------|
| 二开仓库 | `https://github.com/zuiyi233/miaowu-os.git`（origin） |
| 上游仓库 | `https://github.com/bytedance/deer-flow.git`（upstream） |
| 目录结构差异 | 上游代码在仓库根目录（`backend/`、`frontend/`），二开代码在子目录 `deer-flow-main/` 下 |
| 二开新增模块 | `novel_migrated`（小说功能）、AI 服务、灵感服务等 |

## 2. 关键教训：为什么不能直接 merge

### 2.1 失败方案：`git merge upstream/main`

**问题**：上游和二开仓库的提交历史完全不相关（无共同祖先），直接 merge 会引入上游的全部提交历史。

**后果**：
- 引入 150+ 个上游提交对象，推送包体积 ~15MB
- 上游历史引用了根目录级别的文件（`backend/uv.lock`、`frontend/pnpm-lock.yaml`、`frontend/public/demo/` 下的二进制文件）
- GitHub 服务端 `index-pack failed`，无法推送
- `git repack` 后部分上游松散对象丢失，导致仓库状态不一致

### 2.2 成功方案：Squash 合并（只取文件变更，不引入历史）

**核心思路**：从之前正确合并的分支中，只 checkout `deer-flow-main/` 目录下的文件变更，作为新的提交。

**优势**：
- 只产生 2 个提交（squash + fix），推送体积极小
- 不引入任何上游历史或根目录级别的冗余文件
- 推送成功率 100%

## 3. 标准操作流程

### 3.1 前置准备

```bash
# 确认 upstream remote 已配置
git remote -v
# 如未配置：
git remote add upstream https://github.com/bytedance/deer-flow.git

# 创建 main 的备份分支
git branch backup-before-sync-$(date +%Y%m%d-%H%M%S) main
```

### 3.2 Fetch 上游最新代码

```bash
git fetch upstream
```

### 3.3 创建同步分支

```bash
git checkout -b merge/upstream-main
```

### 3.4 Squash 合并：只取文件变更

**关键步骤**：从之前正确合并的分支（或临时创建的合并分支）中，只 checkout `deer-flow-main/` 目录：

```bash
# 方法 A：如果已有之前正确合并的分支
git checkout merge/upstream-main-YYYYMMDD -- deer-flow-main/

# 方法 B：如果没有，先创建临时合并分支
git checkout -b tmp-merge upstream/main
# 在 tmp-merge 上处理冲突后...
git checkout merge/upstream-main
git checkout tmp-merge -- deer-flow-main/
git branch -D tmp-merge
```

### 3.5 验证变更范围

```bash
# 确认所有变更都在 deer-flow-main/ 下
git diff --cached --name-only | Where-Object { $_ -notlike "deer-flow-main/*" }
# 应该没有输出

# 查看变更统计
git diff --cached --stat | tail -5
```

### 3.6 提交

```bash
git commit -m "feat(sync): 同步上游 bytedance/deer-flow 最新更新 (squash)

同步上游 <commit-hash> 的全部变更，采用 squash 合并
避免引入上游完整提交历史和根目录级别的冗余文件。

主要上游更新：
- ...

二开功能保留：
- novel_migrated 模块完整保留
- ..."
```

### 3.7 修复合并遗留问题

上游合并后，以下文件通常需要手动修复：

#### 3.7.1 `frontend/src/core/threads/hooks.ts`

**问题**：此文件是二开小说功能的核心修改点，合并时极易冲突。

**修复策略**：以纯净上游版本为基础，重新应用 6 处小说自定义代码：

| 序号 | 位置 | 类型 | 代码 |
|------|------|------|------|
| 1 | 变量声明区 | 新增变量 | `const createNovelProgressRef = useRef<Map<string, string>>(new Map());` |
| 2 | threadId useEffect | 新增行 | `createNovelProgressRef.current.clear();` |
| 3 | onCustomEvent | 新增事件处理器 | `create_novel_progress` 完整处理逻辑（~50行） |
| 4 | onError | 新增行 | `createNovelProgressRef.current.clear();` |
| 5 | threadId 切换重置 useEffect | 新增行 | `createNovelProgressRef.current.clear();` |
| 6 | onFinish | 新增行 | `createNovelProgressRef.current.clear();` |

**操作步骤**：

```bash
# 1. 用上游版本覆盖
git show upstream/main:frontend/src/core/threads/hooks.ts > deer-flow-main/frontend/src/core/threads/hooks.ts

# 2. 手动应用上述 6 处修改（参考本手册附录 A）
```

#### 3.7.2 `frontend/src/components/workspace/messages/message-list.tsx`

**问题**：合并时丢失上游新增的 React hooks 和 lucide-react 图标导入。

**修复**：

```diff
- import { useMemo } from "react";
+ import { ChevronUpIcon, Loader2Icon } from "lucide-react";
+ import { useCallback, useEffect, useMemo, useRef } from "react";
```

#### 3.7.3 `frontend/src/app/workspace/chats/[thread_id]/page.tsx`

**问题**：合并时丢失 `useRef` 导入。

**修复**：

```diff
- import { useCallback, useEffect, useMemo, useState } from "react";
+ import { useCallback, useEffect, useMemo, useRef, useState } from "react";
```

#### 3.7.4 `backend/app/gateway/routers/__init__.py`

**问题**：`__all__` 列表缺少 `novel_migrated`。

**修复**：在 `"novel"` 后添加 `"novel_migrated"`。

#### 3.7.5 `backend/app/gateway/app.py`

**问题**：合并时可能产生重复的常量定义。

**修复**：删除重复的 `_SHUTDOWN_HOOK_TIMEOUT_SECONDS` 定义。

### 3.8 安装上游新增依赖

```bash
cd deer-flow-main/frontend
pnpm install
# 如有新增依赖（如 better-auth）
pnpm add better-auth
```

**后端依赖同步**：如果上游 `pyproject.toml` 有依赖变更，需重建后端 venv：

```bash
cd deer-flow-main\backend
Remove-Item -Recurse -Force .venv
Remove-Item -Force uv.lock
uv sync
```

> ⚠️ 每次重建 venv 后必须验证 `langgraph-prebuilt` 版本：
> ```bash
> uv pip show langgraph-prebuilt   # 必须为 1.0.8，若 ≥ 1.0.9 需检查 pyproject.toml 锁定
> ```

### 3.9 编译验证

```bash
# 前端 TypeScript 编译
cd deer-flow-main/frontend && npx tsc --noEmit

# 后端 Python 编译
cd deer-flow-main/backend && python -m py_compile app/gateway/app.py

# 后端 pytest 核心用例
cd deer-flow-main/backend && .\.venv\Scripts\python.exe -m pytest tests/test_gateway_docs_toggle.py tests/test_gateway_runtime_cleanup.py -q
```

### 3.10 提交修复并推送

```bash
git add deer-flow-main/
git commit -m "fix(sync): 修复上游合并遗留问题并保留二开功能"
git push origin merge/upstream-main
```

## 4. 排错指南

### 4.1 `index-pack failed` 推送失败

**原因**：推送包含大量上游提交历史，GitHub 服务端解包超时。

**解决**：使用 squash 合并策略，只推送文件变更，不引入上游历史。

### 4.2 `missing` 对象警告

**原因**：`git repack` 可能清理了上游的松散对象，但本地分支不依赖这些对象。

**解决**：`git fsck --full` 确认无 missing 对象即可。如有，重新 `git fetch upstream`。

### 4.3 TypeScript 编译错误集中在 hooks.ts

**原因**：此文件是二开修改最多的文件，合并冲突最严重。

**解决**：不要尝试在冲突文件上手动解决，而是以纯净上游版本为基础重新应用自定义代码。

## 5. 检查清单

- [ ] upstream remote 已配置
- [ ] main 分支已备份
- [ ] squash 合并只包含 `deer-flow-main/` 下的文件
- [ ] 无根目录级别的文件混入
- [ ] 小说模块（novel_migrated）文件完整
- [ ] hooks.ts 中 6 处小说自定义代码已应用
- [ ] message-list.tsx 导入已修复
- [ ] page.tsx 导入已修复
- [ ] routers/__init__.py 已添加 novel_migrated
- [ ] app.py 无重复定义
- [ ] 上游新增依赖已安装
- [ ] langgraph-prebuilt 锁定在 <1.0.9（防止自动升级到不兼容版本）
- [ ] 若重建 venv，已重新 `uv sync`
- [ ] existing_project_file 导入链完整
- [ ] apply_logging_level / logging_level_from_config 函数存在
- [ ] merge_run_context_overrides 已应用到 services.py
- [ ] _build_runtime_context 已应用到 worker.py
- [ ] 前端 TypeScript 编译 0 错误
- [ ] 后端 Python 编译 0 错误
- [ ] 后端 pytest 全部通过
- [ ] dev-local.bat 启动成功
- [ ] 后端 /health 返回 healthy
- [ ] 推送成功

---

## 附录 A：hooks.ts 小说自定义代码完整补丁

以下为需要在上游版本基础上应用的 6 处修改的完整代码：

### A.1 新增变量声明

在 `const startedRef = useRef(false);` 后添加：

```typescript
const createNovelProgressRef = useRef<Map<string, string>>(new Map());
```

### A.2 threadId useEffect 中清除

在 `threadIdRef.current = normalizedThreadId;` 后添加：

```typescript
createNovelProgressRef.current.clear();
```

---

## 7. 本次同步实战记录（2026-05-02）

> 基于 2026-05-01 squash 合并后，逐项比对 upstream/main 的 8 个新增 commit 并修复差距。

### 7.1 发现并修复的差距

| # | 问题 | 根因 | 涉及文件 | 修复方式 |
|---|------|------|----------|----------|
| 1 | `ImportError: cannot import name 'RunContext'` | miaowu-os 的 `deps.py` 引用了 `RunContext`，但 runtime 包未定义此类 | `runtime/context.py`（新建）、`runtime/__init__.py` | 新建 `RunContext` 数据类并导出 |
| 2 | `ImportError: cannot import name 'load_skills'` | miaowu-os 重构了 skills 模块（引入 `SkillStorage`），删除了旧的 `loader.py`，但中间件仍引用旧 API | `skills/loader.py`（新建）、`skills/__init__.py` | 新建兼容层，通过 `LocalSkillStorage` 实现旧 API |
| 3 | `NameError: name 'require_permission' is not defined` | `uploads.py`、`threads.py` 使用了 `@require_permission` 装饰器但缺少导入 | `routers/uploads.py`、`routers/threads.py` | 补充 `from app.gateway.authz import require_permission` |
| 4 | `StreamingResponse` / `Response` 返回类型导致 Pydantic V2 OpenAPI schema 生成崩溃 | Pydantic V2 无法为 Starlette 响应类生成 JSON schema | `routers/thread_runs.py`、`routers/runs.py`、`routers/artifacts.py`、`routers/media_drafts.py` | 为流式/文件端点添加 `response_model=None, response_class=...` |
| 5 | `from __future__ import annotations` 导致 ForwardRef 解析失败 | `threads.py` 的 `ThreadPatchRequest` 作为 Query 参数时，字符串注解无法被 Pydantic V2 TypeAdapter 解析 | `routers/threads.py` | 移除 `from __future__ import annotations` |
| 6 | `name 'existing_project_file' is not defined` | `app_config.py` 使用了 `runtime_paths.py` 的函数但未导入 | `config/app_config.py` | 添加 `from deerflow.config.runtime_paths import existing_project_file` |
| 7 | `name 'apply_logging_level' is not defined` | 二开功能只写了测试 (`test_logging_level_from_config.py`) 和调用点 (`app.py` lifespan)，忘了在 `app_config.py` 中实现函数 | `config/app_config.py`、`gateway/app.py` | 实现 `logging_level_from_config()` + `apply_logging_level()`，在 lifespan 中导入 |
| 8 | 上游 commit `78633c69` 完全未合并 | squash 合并时漏掉了 `merge_run_context_overrides` 和 `_build_runtime_context` | `gateway/services.py`、`runtime/runs/worker.py` | 从上游 diff 手动补全两个函数并接入调用链 |

### 7.2 langgraph-prebuilt 版本锁定详解

**问题链**：
1. `uv sync` 将 `langgraph-prebuilt` 自动解析为 **1.0.13**（当时最新）
2. `langgraph-prebuilt ≥ 1.0.9` 的 `tool_node.py` 导入 `ExecutionInfo, ServerInfo` from `langgraph.runtime`
3. `langgraph` 被 `pyproject.toml` 约束在 `<1.0.10`，实际安装 **1.0.9**，该版本 `runtime.py` 无 `ExecutionInfo` 类
4. 启动时 `from langgraph.prebuilt.tool_node import ToolNode` → `ImportError`

**修复**：在 `backend/packages/harness/pyproject.toml` 添加：
```toml
"langgraph-prebuilt<1.0.9",
```
然后 `Remove-Item -Recurse .venv; uv sync`

**验证**：
```bash
uv pip show langgraph-prebuilt   # 应显示 1.0.8
```

**为什么不能升级到最新**：上游 `pyproject.toml` 约束 `langgraph<1.0.10`，即明确不支持 1.1.x 产品线。若强制升级 langgraph 需评估 breaking changes 并可能修改二开代码。

### 7.3 验证命令速查

```bash
# 后端
cd deer-flow-main\backend
.\.venv\Scripts\python.exe -m pytest tests/test_gateway_docs_toggle.py tests/test_gateway_runtime_cleanup.py -q
.\.venv\Scripts\python.exe -m py_compile app\gateway\app.py

# 前端
cd deer-flow-main\frontend
pnpm tsc --noEmit

# 全栈启动
scripts\dev-local.bat start
# 或 PowerShell:
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\dev-local.ps1" -Action start -View single

# 健康检查
curl http://localhost:8551/health
# 预期: {"status":"healthy","deerflow_available":true,"registered_harness_routers":15,"total_harness_routers":15}
```

### 7.4 二开关键文件完整性验证

以下文件在每次同步后都必须确认存在且内容完整：

| 类别 | 文件/目录 | 验证方式 |
|------|----------|----------|
| 后端路由 | `routers/novel.py`、`routers/novel_migrated/` | 确认文件存在 |
| 中间件 | `middleware/intent_recognition_middleware.py` (173KB) | 确认文件存在 |
| 运行时扩展 | `runtime/context.py`、`runtime/events/store/`、`runtime/runs/store/`、`persistence/thread_meta/`、`persistence/feedback/` | 确认文件/目录存在 |
| 网关配置 | `app.py`（含 novel 路由注册）、`deps.py`（含 RunContext 等） | 搜索 `novel`、`RunContext` |
| 小说工具 | `tools/builtins/novel_tools.py` (31KB) | 确认文件存在 |
| 前端核心 | `core/novel/`（hooks, api, stores...） | 确认目录存在 |
| 前端组件 | `components/novel/`（47 个文件） | 确认目录存在 |
| 冲突关注点 | `frontend/src/core/threads/hooks.ts`、`frontend/src/components/workspace/messages/message-list.tsx`、`frontend/src/app/workspace/chats/[thread_id]/page.tsx` | 确认其中小说自定义代码完整 |

### A.3 create_novel_progress 事件处理器

在 `updateSubtask({ id: e.task_id, latestMessage: e.message }); return; }` 后、`event.type === "llm_retry"` 前插入：

```typescript
if (
  typeof event === "object" &&
  event !== null &&
  "type" in event &&
  event.type === "create_novel_progress"
) {
  const e = event as {
    type: "create_novel_progress";
    tool_call_id?: string;
    stage?: string;
    status?: string;
    message?: string;
  };
  const stage =
    typeof e.stage === "string" && e.stage.trim()
      ? e.stage.trim()
      : "unknown_stage";
  const status =
    typeof e.status === "string" && e.status.trim()
      ? e.status.trim()
      : "running";
  const message =
    typeof e.message === "string" && e.message.trim()
      ? e.message.trim()
      : `create_novel ${stage} (${status})`;
  const fallbackThreadScope =
    typeof threadIdRef.current === "string" && threadIdRef.current.trim()
      ? threadIdRef.current.trim()
      : "default-thread";
  const fallbackToolId = `${fallbackThreadScope}:${stage}`;
  const normalizedToolCallId =
    typeof e.tool_call_id === "string" && e.tool_call_id.trim()
      ? e.tool_call_id.trim()
      : fallbackToolId;
  const toastId = `create-novel-progress:${normalizedToolCallId}`;
  const dedupeKey = `${stage}:${status}:${message}`;
  if (createNovelProgressRef.current.get(toastId) === dedupeKey) {
    return;
  }
  createNovelProgressRef.current.set(toastId, dedupeKey);

  if (status === "failed") {
    toast.error(message, { id: toastId });
  } else if (status === "completed" && stage === "completed") {
    toast.success(message, { id: toastId });
  } else {
    toast(message, { id: toastId });
  }
  return;
}
```

### A.4 onError 中清除

在 `setOptimisticMessages([]);` 后添加：

```typescript
createNovelProgressRef.current.clear();
```

### A.5 threadId 切换重置 useEffect 中清除

在 `sendInFlightRef.current = false;` 后添加：

```typescript
createNovelProgressRef.current.clear();
```

### A.6 onFinish 中清除

在 `listeners.current.onFinish?.(state.values);` 后添加：

```typescript
createNovelProgressRef.current.clear();
```

---

## 8. 第三次增量同步实战记录（2026-05-05）

> 同步上游 `44ab21fc..8e48b7e8` 共 7 个提交，涉及 30 个文件，新增约 2762 行，删除约 241 行。

### 8.1 同步策略

本次采用**逐提交手动应用**策略，而非 squash 合并。原因：

1. 上游变更量大（token usage 重构涉及 20 个文件），直接 squash 容易遗漏
2. 需要逐提交验证二开兼容性，特别是 API 变更的影响
3. 部分文件（如 `client.py`、`token_usage_middleware.py`）直接从上游复制更安全

**核心流程**：
1. 在 `D:\deer-flow-main`（原版项目）用 `git show` / `git diff` 获取每个提交的完整 diff
2. 对无二开修改的文件，直接 `git show 8e48b7e8:path > miaowu-os/path` 复制
3. 对有二开修改的文件（i18n、page.tsx 等），手动编辑合并上游新增内容
4. 验证编译通过后检查二开关键文件完整性

### 8.2 发现并修复的兼容性问题

| # | 问题 | 根因 | 涉及文件 | 修复方式 |
|---|------|------|----------|----------|
| 1 | `TS2305: Module '"../messages/utils"' has no exported member 'getToolCalls'` | 上游 `utils.ts` 重构移除了 `getToolCalls` 和 `NormalizedToolCall` 导出 | `core/tools/utils.ts`、`core/artifacts/loader.ts`、`core/threads/export.ts` | 改为直接使用 `message.tool_calls` 和 `ToolCall` 类型（与上游一致） |
| 2 | `TS2322: Type '{}' is not assignable to type 'string'` | `AgentThreadContext extends Record<string, unknown>` 导致 `Omit` 后 `media_draft_retention` 类型丢失 | `core/settings/local.ts` | 在 `LocalSettings.context` 交叉类型中显式添加 `media_draft_retention` 字段 |

### 8.3 上游 API 变更适配要点

#### 8.3.1 `getToolCalls` / `NormalizedToolCall` 移除

上游在 `d02f762a` 中重构了 `messages/utils.ts`，移除了自定义的 `getToolCalls()` 函数和 `NormalizedToolCall` 类型，改为直接使用 LangChain SDK 的 `ToolCall` 类型和 `message.tool_calls` 属性。

**迁移模式**：
```typescript
// 旧写法（已移除）
import { getToolCalls, NormalizedToolCall } from "../messages/utils";
const calls = getToolCalls(message);

// 新写法
import type { ToolCall } from "@langchain/core/messages";
const calls = message.tool_calls ?? [];
```

**受影响的二开文件**：
- `core/tools/utils.ts` — 直接替换为上游版本
- `core/artifacts/loader.ts` — 移除 `getToolCalls` 导入，改用 `message.tool_calls`
- `core/threads/export.ts` — 同上

#### 8.3.2 Token Usage 显示模式重构

上游 `d02f762a` 是本次最大的提交（+2346/-222），引入了完整的 token 用量归因系统：

- **后端**：`token_usage_middleware.py` 从简单日志记录重构为结构化归因标注（`token_usage_attribution`），支持 `final_answer`、`tool_batch`、`todo_update` 等 kind
- **后端**：`client.py` 新增 `additional_kwargs` 序列化和增量发送机制
- **前端**：新增 `usage-model.ts`（440 行）定义 `TokenUsageInlineMode` 和归因模型
- **前端**：`message-token-usage.tsx`、`token-usage-indicator.tsx`、`message-group.tsx`、`message-list.tsx` 全面重写
- **i18n**：新增 `presets`、`presetDescriptions`、`finalAnswer`、`stepTotal` 等翻译键

**二开适配**：这些文件无二开自定义代码，直接从上游复制即可。

#### 8.3.3 Skills 路径回退

上游 `f80ac961` 在 `skills_config.py` 中新增 `_legacy_skills_candidates()` 函数，当项目根目录下无 `skills/` 目录时，回退到仓库根目录的 `skills/`。

**二开影响**：miaowu-os 的目录结构与上游不同（代码在 `deer-flow-main/` 子目录下），但 `parents[4]` 的计算路径仍然适用，因为 `skills_config.py` 的相对位置不变。

### 8.4 同步后验证清单

- [x] 前端 TypeScript 编译零错误
- [x] 后端 Python 编译零错误（manager.py、app.py、client.py、token_usage_middleware.py、skills_config.py）
- [x] 小说模块文件完整（novel.py、novel_migrated.py、novel_tools.py、core/novel/、components/novel/）
- [x] hooks.ts 中 6 处小说自定义代码完整（9 处引用确认）
- [x] 所有变更都在 `deer-flow-main/` 下，无根目录级别文件混入
- [x] 新增文件 4 个（container.yaml、test_client_message_serialization.py、usage-model.ts、usage-model.test.ts）
- [x] 修改文件 29 个
- [ ] dev-local.bat 启动验证
- [ ] 后端 /health 健康检查

### 8.5 高效同步技巧总结

1. **直接复制优于手动合并**：对于无二开修改的文件（如 `client.py`、`token_usage_middleware.py`、`message-group.tsx`），使用 `git show 8e48b7e8:path > miaowu-os/path` 直接复制上游版本，避免手动编辑遗漏
2. **先检查上游 diff 再决定策略**：用 `git diff 44ab21fc..8e48b7e8 --stat` 查看变更范围，按文件大小和复杂度决定复制还是编辑
3. **API 变更需全局搜索**：上游移除导出（如 `getToolCalls`）时，必须全局搜索二开代码中的引用，逐一适配
4. **TypeScript 编译是最好的验证**：`npx tsc --noEmit` 能立即发现类型不兼容问题
5. **i18n 合并需注意类型定义**：`types.ts` 必须与 `en-US.ts`、`zh-CN.ts` 保持同步，否则编译报错
6. **`Record<string, unknown>` 的 Omit 陷阱**：当上游接口继承 `Record<string, unknown>` 时，`Omit` 后自定义字段可能丢失类型，需在交叉类型中显式声明
