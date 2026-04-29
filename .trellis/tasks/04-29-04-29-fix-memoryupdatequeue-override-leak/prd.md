# PRD - 修复 MemoryUpdateQueue override 串用

## 背景
在 `backend/packages/harness/deerflow/agents/memory/queue.py` 的 `MemoryUpdateQueue._process_queue` 中，`MemoryUpdater` 可能被上一条 context 复用，导致后续 context 即使未提供 override 仍使用上一条 `model/base_url/api_key`。

## 目标
修复队列处理中的 override 串用问题，确保每个 context 的 `MemoryUpdater` 独立按自身参数构造。

## 需求
1. 每个 context 的 `MemoryUpdater` 必须基于该 context 的 override 参数创建，不得沿用上一条 context 的 override。
2. 保持现有处理行为不变：日志、异常处理、sleep 等流程不改或最小改动。
3. 增加/更新单元测试覆盖以下场景：
   - 同批次两个 context，前一个有 override，后一个无 override。
   - 第二个 context 不得使用前一个 context 的 override。
4. 至少运行 `backend/tests/test_memory_queue.py` 并汇报结果。

## 验收标准
- 代码中每个 context 的 updater 构造独立、override 不泄漏。
- 新增/更新测试在本地通过。
- 变更范围聚焦，不引入无关行为变更。
