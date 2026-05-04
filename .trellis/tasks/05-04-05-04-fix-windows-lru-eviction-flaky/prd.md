# PRD: 修复 Windows 下 LRU 驱逐测试偶发失败

## 背景
在 `D:/miaowu-os/deer-flow-main` 中运行：
- `pytest -q tests/test_prompt_cache_middleware.py tests/test_suggestions_router.py`
当前存在偶发失败：
- `TestLRUEviction.test_recently_accessed_key_is_not_evicted`

## 目标
1. 以最小改动修复该测试在 Windows 下的稳定性问题。
2. 优先修测试，不引入行为回归。
3. 若必须改生产代码，需保持与现有逻辑兼容并说明原因。

## 非目标
- 不处理与该失败无关的问题。
- 不做无关重构、不做风格性改动。

## 约束
- 仅修改与失败根因直接相关文件。
- 保持与原版 deer-flow 核心逻辑兼容，必要时先对比原版相关逻辑。

## 验收标准
- `pytest -q tests/test_prompt_cache_middleware.py tests/test_suggestions_router.py` 通过。
- `python -m py_compile app/gateway/middleware/prompt_cache.py app/gateway/routers/suggestions.py` 通过。
- 输出改动文件、改动原因、最终测试结果。
