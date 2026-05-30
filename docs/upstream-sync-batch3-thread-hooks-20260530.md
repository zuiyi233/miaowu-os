# Batch3 线程 Hooks 增量同步记录

> 分支：`codex/batch3-thread-hooks-sync`
> 基线：`792e9427`（Batch2 已完成）
> 日期：2026-05-30

---

## 1. 本批范围

本批仅处理前端线程/消息体验修复，落点限定为：

- `deer-flow-main/frontend/src/core/threads/hooks.ts`
- `deer-flow-main/frontend/tests/unit/core/threads/message-merge.test.ts`
- `.trellis/spec/frontend/hook-guidelines.md`

纳入的上游提交语义：

- `d46a577` preserve messages after summarization
- `d0fa37e` avoid duplicate optimistic user message
- `0287240` show new thread in sidebar immediately on creation

---

## 2. 手工合并策略

本批未直接覆盖上游 `hooks.ts`，而是在本地 Miaowu-OS 版本上做语义合并。

裁决原则：

1. 本地多账号 / agent 视图优先。
2. 本地 token usage baseline 逻辑优先。
3. 本地上传 optimistic UI 优先。
4. 本地 `create_novel_progress` toast / 自定义事件优先。
5. 只吸收与线程消息合并、optimistic 可见性、新线程 sidebar 可见性直接相关的上游修复。

---

## 3. 本批实际吸收的上游语义

### 3.1 Summarization 后历史消息保留

已吸收：

- hidden/control message 不再参与可见历史 overlap 裁切
- message identity 去重改为“优先保留最后一个可见消息；若全是 hidden 才退回最后一个同 id 消息”
- summarization update key 同时支持：
  - `SummarizationMiddleware.before_model`
  - `DeerFlowSummarizationMiddleware.before_model`
- summarization 迁移历史时，截断点改为“第一个保留的可见消息 identity”，而不是固定索引位

保留的本地逻辑：

- `createNovelProgressRef`
- `pendingUsageBaselineMessageIdsRef`
- token usage invalidation
- custom event / toast 行为

### 3.2 Optimistic human 去重显示

已吸收：

- 抽出 `getVisibleOptimisticMessages(...)`
- 当服务端 human message count 增长时，隐藏整组 optimistic send batch
- 结果消息合并时，使用 `visibleOptimisticMessages` 而不是原始 optimistic 数组

保留的本地逻辑：

- 上传前置流程
- 上传中的 optimistic human + optimistic AI 占位行为
- `hide_from_ui` 发送选项

### 3.3 新线程 sidebar 立即可见

已吸收：

- 在 `onCreated(...)` 中调用 `upsertThreadInSearchCache(...)`
- 新线程创建后，立即将 stub thread 写入 `["threads", "search"]`

本地优先裁决：

- 对已存在的缓存项，不直接用新 stub 覆盖
- `metadata` / `values` 采用“以已缓存本地字段为优先”的合并方式，避免覆盖本地多账号 / agent 作用域附加信息

---

## 4. 冲突裁决说明

### 冲突点 A：hidden message 是否参与 overlap 判定

上游目标：

- hidden message 只作为 UI 控制消息，不应把可见历史挤掉

本地裁决：

- 接受上游语义
- 因本地存在更多自定义 control/custom event 行为，额外通过单测锁定“hidden live 不能盖掉 visible history”

### 冲突点 B：optimistic 清理时机

上游目标：

- 服务端 human 到达后，不再显示 optimistic human

本地裁决：

- 接受上游语义
- 但不移除本地现有 `useEffect` 清空逻辑，改为在 merged view 层增加 `getVisibleOptimisticMessages(...)`
- 这样可以避免影响上传态、本地 pending baseline 和记忆中的异步时序防护

### 冲突点 C：sidebar cache upsert 是否覆盖已有行

上游目标：

- 新建线程立刻出现在 sidebar

本地裁决：

- 接受“立即出现”目标
- 不接受“已有缓存行被 optimistic stub 覆盖”的风险
- 对已存在行采用保守 merge，确保本地 `metadata` / `values` 不丢失

---

## 5. 验证结果

已执行：

```powershell
pnpm test -- --run tests/unit/core/threads/message-merge.test.ts
pnpm tsc --noEmit
```

结果：

- `message-merge.test.ts`: 16 passed
- `pnpm tsc --noEmit`: 通过

新增/强化的回归覆盖：

- hidden vs visible message dedupe
- summarization update key parsing
- optimistic human dedupe
- upload optimistic pair visibility
- thread search cache insert / merge behavior

---

## 6. 限制与后续

本批未做：

- 浏览器级手动点击验证
- 真实多账号运行态 E2E
- `hooks.ts` 之外的 thread list / page component 改造

建议下一步：

1. 在第二批隔离分支上继续下一批前端/交互同步时，把本批作为线程消息基线。
2. 若后续再同步 `recent-chat-list` 或 thread route 相关改动，必须继续保留“已有缓存行 metadata/values 优先”的本地裁决。
