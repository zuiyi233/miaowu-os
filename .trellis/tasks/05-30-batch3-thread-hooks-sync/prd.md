# 第三批线程与消息体验同步

## Goal

在第二批安全与契约同步 `792e9427` 基线上，增量吸收上游 `frontend/src/core/threads/hooks.ts` 的三项线程/消息体验修复：

- `d46a577` preserve messages after summarization
- `d0fa37e` avoid duplicate optimistic user message
- `0287240` show new thread in sidebar immediately on creation

同步必须以本地 Miaowu-OS 前端行为为主干，优先保护本地多账号、小说工作区、token usage、上传态、toast 与 thread search 缓存逻辑。

## Requirements

- 只在隔离 worktree `N:\miaowu-os-merge-upstream-main-worktrees\batch1-upstream-low-risk-sync` 上实施。
- 只处理 `frontend/src/core/threads/hooks.ts` 与其直接配套单测，不扩大到无关前端模块。
- 需人工语义合并上游三个修复，不能直接覆盖本地 `hooks.ts`。
- 保留本地优先逻辑：
  - 多账号 / 用户态相关线程列表与缓存行为
  - `pendingUsageMessages` / token usage baseline
  - 文件上传 optimistic UI
  - novel / toast / custom event 行为
- 必须验证以下体验问题：
  - summarization 后历史消息不会因 hidden/control message 误判而丢失
  - optimistic human message 不会在服务端 human message 到达后重复显示
  - 新建线程后 sidebar 立即可见，而不需要等首次刷新
- 完成后需补充本批同步记录，并把前端线程消息契约写入可执行 spec。

## Acceptance Criteria

- [ ] `hooks.ts` 已纳入三项上游修复语义，且本地多账号优先逻辑仍保留。
- [ ] `frontend/tests/unit/core/threads/message-merge.test.ts` 补齐覆盖 summarization / optimistic dedupe / new thread cache 行为。
- [ ] 前端相关自动化验证通过，至少包括：
  - `pnpm test -- --run tests/unit/core/threads/message-merge.test.ts`
  - `pnpm tsc --noEmit`
- [ ] 变更已在独立 batch3 分支提交，不影响已完成的 batch1 / batch2 提交。
- [ ] 生成 batch3 变更记录，说明纳入的上游语义、冲突裁决、验证结果与限制。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
