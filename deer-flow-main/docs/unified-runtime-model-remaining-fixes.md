# 统一默认分组模型与子代理运行时模型 — 遗留问题收口记录

> 文档版本：2026-05-29
> 关联计划：统一 Miaowu-OS 默认分组模型与子代理运行时模型计划
> 状态：已核对 / 已补齐

---

## 1. 收口结论

本文件原先记录的是“统一默认分组模型与子代理运行时模型”方案的遗留修复项。经本轮核对，原清单中的高风险运行时问题已经由当前实现覆盖；剩余问题集中在缓存容量语义和前端类型推断，并已补齐。

| 编号 | 原问题 | 当前状态 |
|------|--------|----------|
| R-01 | `_create_summarization_middleware` 缺少 OpenAI-compatible 检查 | 已由 `_build_runtime_overrides()` 统一覆盖 |
| R-02 | `MemoryUpdater._get_model` 缺少 OpenAI-compatible 检查 | 已由 `_build_runtime_overrides()` 统一覆盖 |
| R-03 | `TitleMiddleware._agenerate_title_result` 缺少 OpenAI-compatible 检查 | 已由 `_build_runtime_overrides()` 统一覆盖 |
| R-04 | `runtime_api_key` 明文存在于 LangGraph configurable 中 | 已改为 `ContextVar` 传递，`configurable` 仅保留 `*_runtime_api_key_set` 标记 |
| R-05 | `MemoryUpdater._model_cache` 无完整清理/淘汰机制 | 本轮补齐 LRU + TTL + 插入后容量保证 |
| R-06 | `_models_cache` 无确定性容量限制 | 本轮补齐插入后容量保证和命中刷新 |
| R-07 | `AgentThreadContext extends Record<string, unknown>` 导致类型推断问题 | 本轮改为显式接口字段 + `[key: string]: unknown` |
| R-08 | 前端 `context.model_name` / `context.agent_name` 残留类型断言 | 本轮移除旧类型问题导致的冗余断言 |

---

## 2. 本轮补齐内容

### R-05: MemoryUpdater 模型缓存

- `MemoryUpdater._model_cache` 使用 `OrderedDict[str, tuple[float, Any]]` 表达 LRU 顺序。
- 缓存命中且未过期时调用 `move_to_end(cache_key)` 刷新最近使用顺序。
- 缓存过期时删除旧条目并创建新模型。
- 新模型写入后再次执行 eviction，确保最终 `len(_model_cache) <= _MODEL_CACHE_MAX_SIZE`。

### R-06: `/api/models` 用户模型列表缓存

- `_models_cache` 使用 `OrderedDict[str, tuple[float, ModelsListResponse]]` 表达 LRU 顺序。
- 有效命中时刷新用户缓存项顺序。
- 过期命中会被删除并重新加载。
- 新响应通过 `_store_models_cache()` 写入，写入后执行 eviction，确保最终 `len(_models_cache) <= _MODELS_CACHE_MAX_SIZE`。

### R-07 / R-08: 前端线程上下文类型

- `AgentThreadContext` 不再继承 `Record<string, unknown>`。
- 保留 `[key: string]: unknown` 以兼容 LangGraph runtime context 的动态字段。
- `model_name`、`agent_name` 等显式字段恢复稳定类型推断。
- 移除了 `input-box.tsx` 和 `hooks.ts` 中旧类型问题导致的 `as string | undefined` 断言。

---

## 3. 未改变的行为

- `/api/models` 响应结构不变，仍返回 `models`、`token_usage`、`default_model_name`、`default_provider_id`。
- `ModelResponse.provider_id` 保持不变。
- 主 Agent、子代理、标题、记忆、摘要 LLM 的 runtime model/provider 选择链路不变。
- `runtime_api_key` 继续不写入 `configurable` 明文字段。
- 子代理继续通过 runtime 参数继承父级 provider-side model、base URL 和 API key。

---

## 4. 验证清单

本轮应至少验证：

```powershell
cd N:\miaowu-os-merge-upstream-main\deer-flow-main\backend
$env:PYTHONPATH='.;packages/harness'
.\.venv\Scripts\python.exe -m pytest tests/test_models_router_user_settings.py tests/test_gateway_services.py tests/test_lead_agent_model_resolution.py tests/test_subagent_executor.py tests/test_task_tool_core_logic.py tests/test_title_middleware_core_logic.py tests/test_memory_updater.py -q
```

```powershell
cd N:\miaowu-os-merge-upstream-main\deer-flow-main\frontend
npm test -- tests/unit/components/workspace/input-box-logic.test.ts tests/unit/core/models/api.test.ts
npm run typecheck
```

如果 `npm run typecheck` 暴露历史无关错误，应单独记录；若错误来自 `AgentThreadContext` 类型调整，则必须修复后再提交。
