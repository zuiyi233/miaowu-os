# 架构治理后端子任务（精简版）

## Goal

把 `intent_recognition_middleware.py` 的文本/正则提取逻辑，以及 `memory_service.py` 的 fallback 容量与淘汰逻辑抽到同目录 helper 中，降低主文件复杂度，并补一个最小可运行回归测试。

## Requirements

- `backend/app/gateway/middleware/intent_recognition_middleware.py`
  - 将文本提取 / regex cache 的核心逻辑委托给新 helper。
  - 保留现有行为与现有调用点语义不变。
- `backend/app/gateway/novel_migrated/services/memory_service.py`
  - 将 fallback 缓存容量控制 / 淘汰逻辑委托给新 helper。
  - 统一容量上限与淘汰日志。
- 新增同目录 helper 文件
  - 仅放可复用的辅助逻辑，不新增业务入口。
- 新增 `backend/tests` 下的最小回归测试
  - 覆盖 helper 的关键行为与/或 service 集成路径。

## Acceptance Criteria

- [ ] `python -m py_compile` 通过相关改动文件。
- [ ] `pytest` 通过新增/关联的测试。
- [ ] intent middleware 的 regex cache / text extraction 逻辑已从主文件抽离。
- [ ] memory service 的 fallback 容量上限 / 淘汰逻辑已从主文件抽离。
- [ ] 触达缓存时有明确的上限或淘汰日志。

## Definition of Done

- 只改动用户允许的文件范围。
- 代码能被最小回归测试验证。
- 输出改动文件、拆分说明、验证结果。

## Out of Scope

- 不改其他 backend 文件。
- 不做额外重构或无关清理。
- 不改业务 API 语义。

## Technical Notes

- 已检查：
  - `backend/app/gateway/middleware/intent_recognition_middleware.py`
  - `backend/app/gateway/novel_migrated/services/memory_service.py`
  - `backend/tests/test_intent_recognition_middleware.py`
  - `backend/tests/test_novel_memory_service.py`
- 新 helper 建议：
  - `backend/app/gateway/middleware/intent_text_helpers.py`
  - `backend/app/gateway/novel_migrated/services/memory_fallback_store.py`
