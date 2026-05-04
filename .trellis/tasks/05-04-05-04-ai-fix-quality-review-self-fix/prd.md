# 05-04 AI 修复质量复核与自修复（prompt_cache + suggestions）

## 背景
对本轮 AI 修复进行质量复核，并在发现问题时直接修复，仅限与本任务相关文件，不做无关重构。

## 目标
1. 复核 `backend/app/gateway/middleware/prompt_cache.py`：
   - stream 请求旁路逻辑是否健壮
   - `_CachedRequest` 安全逻辑是否健壮
2. 复核 `backend/app/gateway/routers/suggestions.py`：
   - model unavailable fallback 是否仅处理目标错误，不误伤其他终止类错误
3. 复核测试覆盖：
   - `tests/test_prompt_cache_middleware.py`
   - `tests/test_suggestions_router.py`
   - 必要时补充/修复测试并确保稳定
4. 最小必要验证：
   - `python -m py_compile app/gateway/middleware/prompt_cache.py app/gateway/routers/suggestions.py`
   - `pytest -q tests/test_prompt_cache_middleware.py tests/test_suggestions_router.py`

## 范围约束
- 仅修改与上述两处逻辑及对应测试直接相关的文件
- 保持与 deer-flow 原版核心逻辑兼容
- 不改动无关模块，不清理历史无关变更

## 完成标准
- 发现的问题已修复并复测
- 输出 findings（按严重度排序）
- 明确最终 pass/fail 结论及验证结果
