# 执行记录（截至 2026-05-04 22:54:16）

## 第1轮现象
- /health=200，local-dev 在 8551/4560 正常启动。
- /api/v1/auth/register、/login/local、/api/ai/chat 非流式、/api/threads、/runs/stream 均 200。
- /api/ai/chat 流式在客户端拿到空 body（LEN=0），backend 日志出现 Exception in ASGI application + Unexpected message received: http.request。
- /api/threads/{id}/suggestions 返回 200 但 suggestions=[]；日志显示模块路由命中 LongCat-Flash-Chat 后回退 deepseek-v3.1-terminus，上游返回 410 end of life。

## 修复动作
1. ackend/app/gateway/middleware/prompt_cache.py
   - 对 Starlette _CachedRequest 禁止覆写 equest._receive。
   - 当请求体 stream=true 时直接旁路缓存，不生成 cache key，不缓存流式响应。
2. ackend/app/gateway/routers/suggestions.py
   - 增加模型不可用识别（status 404/410 或 nd of life/no longer available/model_not_found）。
   - 命中时允许从 module_id 路由失败回退到显式 model_name 再试。
3. 测试最小修补
   - ackend/tests/test_prompt_cache_middleware.py 增加 stream bypass 与 _CachedRequest 分支测试。
   - ackend/tests/test_suggestions_router.py 增加 EOL 回退测试，并修复既有错误断言（ake_model 未定义）。

## 验证
- python -m py_compile app/gateway/middleware/prompt_cache.py app/gateway/routers/suggestions.py ✅
- python -m pytest tests/test_prompt_cache_middleware.py tests/test_suggestions_router.py -q ✅ (45 passed)
- 重启 local-dev 后第2轮 E2E：
  - /health ✅
  - /api/v1/auth/register ✅
  - /login/local ✅
  - /api/ai/chat 非流式 ✅
  - /api/ai/chat 流式 ✅（done=1, data=16, error=0）
  - /api/threads -> runs/stream ✅（vent=37, end=1, error=0）
  - /api/threads/{id}/suggestions ✅（返回 3 条建议）

## 关键证据
- E2E 结果文件：
  - $task/e2e-round1.json
  - $task/e2e-round2.json
- backend 日志证据（第2轮）：
  - request_id=4d8a8da5ba0472ca6abd2c59630a723 先报 410 end of life，随后 Retrying suggestions without module_id，并解析为 model=gpt-5.4-mini 成功。
  - 未再出现新的 Unexpected message received: http.request。
