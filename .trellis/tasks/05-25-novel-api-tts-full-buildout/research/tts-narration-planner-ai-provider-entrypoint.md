# Research: TTS narration planner AI provider entrypoint

- Query: deer-flow-main backend existing AI Provider / NewAPI text-model invocation entrypoint for TTS narration planner `auto_plan=true`
- Scope: internal
- Date: 2026-05-25

## Findings

### Files found

- `.trellis/workflow.md` - Trellis requires research findings to be persisted under the active task `research/` directory and confirms research is optional/repeatable during an in-progress task.
- `.trellis/tasks/05-25-novel-api-tts-full-buildout/prd.md` - Requires TTS to integrate with existing AI Provider / NewAPI settings and keep env vars as server-side fallback only.
- `.trellis/tasks/05-25-novel-api-tts-full-buildout/design.md` - Defines backend-mediated TTS service/provider architecture, stable error categories, and provider config resolution from user settings first.
- `.trellis/tasks/05-25-novel-api-tts-full-buildout/implement.md` - Calls out P0 provider config integration and P1 narration controls/cache as phased work.
- `.trellis/spec/backend/error-handling.md` - Requires model-call loop-closed recovery to use `clear_model_cache()` once and hide Python internals from users.
- `.trellis/spec/backend/quality-guidelines.md` - Requires model cache keys to include thread/loop scope and fire-and-forget task exceptions to be consumed.
- `.trellis/spec/guides/cross-layer-thinking-guide.md` - Reiterates Miaowu local-dev backend base is `127.0.0.1:8551` and config changes must be traced across layers.
- `deer-flow-main/backend/app/gateway/novel_migrated/services/ai_settings_service.py` - Canonical AI Provider / NewAPI settings source, feature routing resolver, and runtime config resolver.
- `deer-flow-main/backend/app/gateway/novel_migrated/services/ai_service.py` - Existing novel AI text-call service and DB-backed factory.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py` - Current TTS support service; already imports and uses the novel AI service for auto narration planning.
- `deer-flow-main/backend/tests/test_ai_service_messages.py` - Mock patterns for direct `AIService` message/text generation calls.
- `deer-flow-main/backend/tests/test_user_ai_settings_contract.py` - Fake DB/settings and provider bundle patterns for user AI settings, NewAPI groups, feature routing, and secret redaction.
- `deer-flow-main/backend/tests/test_tts_router.py` - Current TTS/narration-plan tests, including saved narration plan use in multivoice synthesis.

### Code patterns

- `ai_settings_service.resolve_user_ai_runtime_config(settings, ai_provider_id=None, ai_model=None, module_id=None)` is the runtime resolver to reuse when caller already has a `Settings` row. It starts from top-level legacy settings, then loads `preferences["ai_provider_settings"]`, selects explicit provider, feature-routed provider, or active/default provider, and returns `(runtime, source)` (`deer-flow-main/backend/app/gateway/novel_migrated/services/ai_settings_service.py:998`).
- Feature routing is already module-aware: `_resolve_feature_routing_target()` looks inside `feature_routing_settings["modules"]`, matches `moduleId`, honors `currentMode`, then checks `backupTarget`, `primaryTarget`, `defaultTarget`, and finally global `defaultTarget` (`deer-flow-main/backend/app/gateway/novel_migrated/services/ai_settings_service.py:922`).
- Provider lookup for feature routing is by provider record `id`; missing provider logs a warning and falls back to top-level settings instead of failing hard (`deer-flow-main/backend/app/gateway/novel_migrated/services/ai_settings_service.py:963`, `deer-flow-main/backend/app/gateway/novel_migrated/services/ai_settings_service.py:1033`).
- Runtime config decrypts provider secrets through `_provider_secret_for_runtime()` path and exposes plaintext only inside backend runtime config; public settings responses redact secrets (`deer-flow-main/backend/app/gateway/novel_migrated/services/ai_settings_service.py:1006`, `deer-flow-main/backend/app/gateway/novel_migrated/services/ai_settings_service.py:1047`).
- `AISettingsService.get_ai_settings()` returns public providers, `default_provider_id`, `client_settings`, and `feature_routing_settings`, then mirrors legacy runtime fields from `resolve_user_ai_runtime_config()` (`deer-flow-main/backend/app/gateway/novel_migrated/services/ai_settings_service.py:1216`).
- `AIService.generate_text()` is the existing non-streaming text model call. It resolves model name, gets cached LangChain chat model, applies runtime temperature/max_tokens, optionally binds MCP tools, builds system/user messages, calls `llm.ainvoke()`, normalizes content, and returns `{"content", "finish_reason", "tool_calls"}` (`deer-flow-main/backend/app/gateway/novel_migrated/services/ai_service.py:562`).
- `AIService.generate_text_with_messages()` is the non-streaming messages-array variant. It accepts `list[AiMessage]`, converts roles to LangChain messages, calls `llm.ainvoke()`, and returns the same dict shape (`deer-flow-main/backend/app/gateway/novel_migrated/services/ai_service.py:951`).
- `AIService.call_with_json_retry()` is the strongest existing fit for planner JSON output. It calls `generate_text()`, strips markdown fences/noise with `clean_json_response()`, validates expected object/array type, retries parse/type failures, and raises `ValueError` after retry exhaustion (`deer-flow-main/backend/app/gateway/novel_migrated/services/ai_service.py:1140`).
- `create_user_ai_service()` constructs an `AIService` from runtime config and preserves `user_id`, `db_session`, and MCP enablement (`deer-flow-main/backend/app/gateway/novel_migrated/services/ai_service.py:1180`).
- `create_user_ai_service_from_db(db, user_id, module_id=None)` is the recommended DB-backed entrypoint. It loads or creates `Settings`, calls `resolve_user_ai_runtime_config(_settings, module_id=module_id)`, and returns `AIService` with user context and DB session attached (`deer-flow-main/backend/app/gateway/novel_migrated/services/ai_service.py:1218`).
- Current TTS support already imports both provider settings helpers and `create_user_ai_service_from_db` (`deer-flow-main/backend/app/gateway/routers/tts_support/service.py:26`, `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:30`).
- Current `save_narration_plan()` handles `auto_plan=true`: requires `db`, loads the `Chapter`, chooses `req.text` or chapter content, rejects empty text, then calls `_auto_generate_narration_plan()` (`deer-flow-main/backend/app/gateway/routers/tts_support/service.py:576`).
- Current `_auto_generate_narration_plan()` already uses `create_user_ai_service_from_db(db, user_id, module_id="tts_planner")`, then calls `ai_service.generate_text(prompt=..., model=req.model, temperature=0.1, max_tokens=4000, system_prompt=..., auto_mcp=False)` and validates the JSON into `TtsNarrationPlan` (`deer-flow-main/backend/app/gateway/routers/tts_support/service.py:693`).
- The planner prompt already asks for strict JSON, preserves source text, and returns speaker/segment structure under schema `miaowu.tts.narration_plan.v1` (`deer-flow-main/backend/app/gateway/routers/tts_support/service.py:650`).

### Recommended calling entrypoint

Use `create_user_ai_service_from_db(db, user_id, module_id="tts_planner")` as the primary entrypoint for narration planner `auto_plan=true`.

Rationale:

- It preserves the existing novel AI Provider / NewAPI path rather than inventing TTS-specific text-model config.
- It honors `feature_routing_settings` through `module_id="tts_planner"` when configured.
- It falls back to active/default provider and top-level legacy settings through `resolve_user_ai_runtime_config()`.
- It keeps secrets server-side and gets decrypted provider keys only inside backend runtime config.
- It benefits from the existing `AIService` model cache, thread/loop scoping, and `clear_model_cache()` behavior.

For output parsing, prefer `ai_service.call_with_json_retry(...)` over a one-shot `generate_text()` plus manual `_extract_json_object()` when implementing or hardening planner auto-plan behavior. The existing code currently uses `generate_text()` and local JSON extraction, which works but duplicates the retry/cleanup behavior already present in `AIService.call_with_json_retry()`.

Recommended module id:

- `tts_planner`

This module id is already used in current TTS support code and gives the settings UI a stable feature-routing target separate from `create_novel` and `novel_tools`.

### Minimal接入示例

```python
from app.gateway.novel_migrated.services.ai_service import create_user_ai_service_from_db


async def plan_tts_narration(*, db, user_id: str, chapter_id: str, prompt: str, system_prompt: str, model: str | None):
    ai_service = await create_user_ai_service_from_db(db, user_id, module_id="tts_planner")
    payload = await ai_service.call_with_json_retry(
        prompt=prompt,
        max_retries=3,
        expected_type="object",
        model=model,
        temperature=0.1,
        max_tokens=4000,
        system_prompt=system_prompt,
        auto_mcp=False,
    )
    payload.setdefault("chapter_id", chapter_id)
    return TtsNarrationPlan.model_validate(payload)
```

If staying close to the current implementation shape, the minimal no-refactor variant is:

```python
ai_service = await create_user_ai_service_from_db(db, user_id, module_id="tts_planner")
result = await ai_service.generate_text(
    prompt=prompt,
    model=req.model,
    temperature=0.1,
    max_tokens=4000,
    system_prompt=system_prompt,
    auto_mcp=False,
)
content = str((result or {}).get("content") or "")
payload = _extract_json_object(content)
plan = TtsNarrationPlan.model_validate(payload)
```

The `call_with_json_retry()` version is preferable because planner output is strict JSON and existing retry/cleanup logic is already centralized there.

### Error handling recommendations

- Keep auth/user-context handling at the router boundary. If user context is missing, return 401 before invoking planner logic, consistent with task acceptance criteria.
- If `auto_plan=true` but `db is None`, keep returning a stable TTS error code such as `planner_missing_config` with 503. Current code already does this (`deer-flow-main/backend/app/gateway/routers/tts_support/service.py:579`).
- If no chapter exists, return `invalid_request` 404; if text is empty, return `invalid_request` 422. Current code already does this (`deer-flow-main/backend/app/gateway/routers/tts_support/service.py:585`, `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:588`).
- If provider settings cannot create an AI service or no usable provider/model is configured, normalize to `planner_missing_config` / 503. Current `_auto_generate_narration_plan()` wraps factory failure this way (`deer-flow-main/backend/app/gateway/routers/tts_support/service.py:702`).
- If the text model call fails after service creation, normalize to `planner_failed` / 502, log backend details without secrets, and do not leak provider response bodies or Python tracebacks to the client. Current code wraps model-call exceptions this way (`deer-flow-main/backend/app/gateway/routers/tts_support/service.py:720`).
- If JSON parsing or `TtsNarrationPlan` validation fails, normalize to `planner_invalid_json` / 502 and include only a bounded `content_snippet` for diagnostics. Current code uses `content[:500]` (`deer-flow-main/backend/app/gateway/routers/tts_support/service.py:730`).
- Preserve `auto_mcp=False` for the planner unless there is an explicit product reason to let narration planning call tools. Planner output is deterministic structure over chapter text, and MCP tool-calls complicate testing and latency.
- For `RuntimeError("Event loop is closed")`, do not add planner-specific retry/cache clearing. Let the existing model-call middleware/spec pattern own loop-closed cache recovery via `clear_model_cache()` where that middleware is in path. If adding local retries around planner calls, make sure they do not clear caches repeatedly.
- Treat feature-routed model mismatch as non-fatal: `resolve_user_ai_runtime_config()` already falls back to the provider's first model when the routed model is not in the provider model list. Surface the returned `source` only in logs/diagnostics if needed.
- Do not route TTS narration planning through OpenAI `/audio/speech`; it is a text-model JSON planning step. TTS audio adapter capability probing remains separate.

### Related测试 mock pattern

- Direct model-call tests can instantiate `AIService(...)`, patch `ai_service._resolve_model_name`, patch `app.gateway.novel_migrated.services.ai_service._get_cached_model`, and patch `ai_service._prepare_mcp_tools` to avoid MCP/tool loading (`deer-flow-main/backend/tests/test_ai_service_messages.py:149`).
- Mock LLM shape: `_make_mock_llm()` returns a `MagicMock` with `bind_tools.return_value = mock_llm`, `model_copy.return_value = mock_llm`, `ainvoke = AsyncMock(...)`, and `astream = MagicMock(return_value=_async_iter(...))` (`deer-flow-main/backend/tests/test_ai_service_messages.py:114`).
- For messages-array calls, existing tests assert `generate_text_with_messages()` returns `content`, `finish_reason`, `tool_calls`, and calls `mock_llm.ainvoke()` exactly once (`deer-flow-main/backend/tests/test_ai_service_messages.py:155`).
- For stream calls, existing tests feed `langchain_core.messages.AIMessage` chunks through the mocked `astream()` iterator and collect yielded text chunks (`deer-flow-main/backend/tests/test_ai_service_messages.py:218`).
- For settings/routing tests, reuse `_FakeDB` with async `execute`, `commit`, `refresh`, and `add`, plus `_ScalarResult.scalar_one_or_none()` (`deer-flow-main/backend/tests/test_user_ai_settings_contract.py:24`, `deer-flow-main/backend/tests/test_user_ai_settings_contract.py:32`).
- For API settings route tests, `_build_user_settings_app()` injects `request.state.user_id = "default_user"`, includes the router, and overrides `get_db` with the fake DB (`deer-flow-main/backend/tests/test_user_ai_settings_contract.py:51`).
- Provider bundle tests write `default_provider_id`, `providers`, `client_settings`, and `feature_routing_settings` through `/api/user/ai-settings`; the example stores `create_novel` and `novel_tools` routing targets and verifies mirroring/secret handling (`deer-flow-main/backend/tests/test_user_ai_settings_contract.py:415`).
- Existing zero-value regression verifies temperature `0.0` and max_tokens `0` survive provider settings resolution and should be preserved if planner config exposes low-temperature deterministic planning (`deer-flow-main/backend/tests/test_user_ai_settings_contract.py:982`).
- Managed NewAPI model fetch tests patch `user_settings.fetch_managed_newapi_models` and assert provider id `newapi-managed` plus grouped model response (`deer-flow-main/backend/tests/test_user_ai_settings_contract.py:1253`).
- Existing TTS narration-plan test covers saved plan use for `ai_multivoice`; it patches `tts_service.synthesize_tts`, forces local asset fallback, calls `save_narration_plan()` with an explicit plan, then generates chapter TTS and verifies speaker/voice behavior (`deer-flow-main/backend/tests/test_tts_router.py:601`).

### Suggested test additions for `auto_plan=true`

- Unit test planner factory routing:
  - Build a fake DB with a `Settings` record whose `preferences.ai_provider_settings.feature_routing_settings.modules` contains `moduleId="tts_planner"`.
  - Patch `app.gateway.novel_migrated.services.ai_service._get_cached_model` to a fake LLM returning valid narration-plan JSON.
  - Call `save_narration_plan(..., req=TtsNarrationPlanRequest(auto_plan=True, voice="demo-1"), user_id=..., db=fake_db_or_async_session)`.
  - Assert returned plan is valid and fake LLM saw the expected prompt/system prompt.
- Unit test invalid JSON:
  - Patch fake LLM response to `"not-json"`.
  - Assert `TtsProviderError.code == "planner_invalid_json"` and status 502.
- Unit test provider failure:
  - Patch `create_user_ai_service_from_db` or fake LLM `ainvoke` to raise.
  - Assert `planner_missing_config` for factory failure and `planner_failed` for call failure.
- Unit test missing DB:
  - Call `save_narration_plan(..., auto_plan=True, db=None)`.
  - Assert `planner_missing_config` 503.
- Unit test missing user at router:
  - Use a FastAPI app without auth middleware setting `request.state.user_id`.
  - Assert narration planner route returns 401 before service invocation, matching the broader API contract.

## Caveats / Not Found

- `python ./.trellis/scripts/task.py current --source` returned `Current task: (none)` in this session even though the user supplied `.trellis/tasks/05-25-novel-api-tts-full-buildout`; this file was written to the user-specified task directory.
- I did not modify code or tests. This is read-only research except for writing this required research artifact.
- I did not run pytest; the request was research-only and asked for no file changes.
- I did not browse external docs because the question is about existing local backend entrypoints and NewAPI settings code, not current external API behavior.
- Current code already has a `tts_planner` auto-plan implementation path. The main improvement opportunity is to swap one-shot `generate_text()` plus local JSON extraction for centralized `call_with_json_retry()` if the implement agent chooses to harden it.
