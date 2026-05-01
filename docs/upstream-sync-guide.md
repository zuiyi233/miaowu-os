# 上游同步操作手册

> 基于 2026-05-01 首次成功同步 bytedance/deer-flow 上游的实战经验总结。

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

### 3.9 编译验证

```bash
# 前端 TypeScript 编译
cd deer-flow-main/frontend && npx tsc --noEmit

# 后端 Python 编译
cd deer-flow-main/backend && python -m py_compile app/gateway/app.py
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
- [ ] 前端 TypeScript 编译 0 错误
- [ ] 后端 Python 编译 0 错误
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
