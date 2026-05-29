# 第一批 commit 范围

## 纳入 commit

### 运行时与持久化

- `cbf8b19` fix(runtime): harden JSONL async I/O and DB put_batch thread validation
- `0fb0582` fix(runtime): make run creation persistence atomic
- `66d6a6a` fix: harden run finalization persistence
- `2eeb597` fix(runs): expose active progress counters
- `9b19cca` fix(runtime): make RunManager.cancel() idempotent for already-interrupted runs
- `737abc0` fix: ignore stale run reconnect conflicts

### 前端低耦合体验

- `11dd5b0` fix(frontend): strip unclosed `<think>` tags from streaming AI content
- `f68bcb7` fix(frontend): guard message copy clipboard access
- `2fdfff0` fix(frontend): fix Mermaid preview failure in historical messages
- `e7967a7` fix(frontend): hide copy for streaming assistant turn

### 后端/工具低风险修复

- `3599b57` fix(harness): wrap all async-only tools for sync clients
- `e19bec1` fix(task-tool): cancel and schedule deferred cleanup on polling safety timeout
- `e8e9edc` fix(channels): ignore hidden control messages when extracting replies
- `b00749a` fix(auth): share internal gateway token across workers

## 明确排除

- `9c03a71` `backend/app/gateway/services.py`
- `7ec8d3a` `backend/app/gateway/routers/mcp.py`
- `d46a577` / `d0fa37e` / `0287240` `frontend/src/core/threads/hooks.ts`
- `c881d95` / `162fb21` MCP session pooling
- `b103d1a` static demo mode
- `ca48757` ToolOutputBudgetMiddleware
