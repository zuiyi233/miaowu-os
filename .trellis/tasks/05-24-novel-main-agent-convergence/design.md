# Design

## Architecture boundary

The main DeerFlow agent runtime becomes the only default model-reasoning runtime for novel generation. The novel module keeps ownership of novel-domain validation, permissions, database writes, RAG, and legacy HTTP/SSE compatibility.

The target boundary is:

`novel API route -> permission + request validation -> NovelAgentRunService -> main RunManager/LangGraph lead_agent -> deerflow.tools.builtins.novel_* -> novel services/database/RAG`

Legacy endpoints stay under `/api/novel-migrated/...`, but their model calls move behind the adapter. Frontend route changes are not required for the first convergence pass.

## New internal contracts

### NovelContextAssembler

Responsible for building a deterministic prompt/context payload for novel runs.

Inputs:

- `user_id`
- `project_id`
- optional `chapter_id`
- task kind (`chapter_generate`, `chapter_continue`, `polish`, `analysis`, `import_generate`, etc.)
- request body and user instructions
- token/character budget

Context order:

1. User long-term memory from main DeerFlow memory injection. This should normally be provided by the main DynamicContextMiddleware, not manually duplicated.
2. Current novel project metadata.
3. Recent chapter, outline, character, foreshadow, and style context.
4. Novel RAG retrieval results from `StoryMemory`, `PlotAnalysis`, `DocumentIndex`, Chroma/fallback retrieval, and workspace documents.
5. Current request.

Output:

- A user-facing task message for the main lead agent.
- A structured metadata payload for run config/context.
- A novel RAG/workspace write plan, when the task should write generated outputs back after completion.

Pollution rule:

- Project facts stay in novel RAG/workspace docs.
- User preferences enter main memory only through normal MemoryMiddleware processing when the user explicitly expresses durable writing preferences or habits.

### NovelAgentRunService

Responsible for invoking main agent runs without requiring callers to speak LangGraph API wire format directly.

`run_task(...)`:

- Creates or reuses a thread id.
- Builds LangGraph `RunCreateRequest`-compatible input/config.
- Calls the same service path used by `/api/runs/wait` or equivalent in-process helpers.
- Waits for completion, extracts final assistant content/structured JSON, returns result plus run metadata.

`stream_task(...)`:

- Creates or reuses a thread id.
- Starts a run through the same RunManager/StreamBridge path as `/api/runs/stream`.
- Consumes main run events and maps them to existing novel SSE frames (`progress`, `content`, `result`, `complete`, `error`) for legacy frontend compatibility.
- Preserves main run metadata (`run_id`, `thread_id`) in compatible payload extensions.

Required runtime context/config keys:

- `user_id`
- `thread_id`
- `project_id`
- `chapter_id` when applicable
- `module_id` or feature id for provider routing
- `runtime_model`, `runtime_provider`, `runtime_base_url`, `runtime_api_key` when resolved from user AI settings
- `include_novel=True`
- optional `requested_novel_skills` as advisory metadata

## Main run integration

Reuse existing Gateway service code instead of adding a second runner.

Candidate reuse points:

- `app.gateway.services.normalize_input`
- `app.gateway.services.inject_authenticated_user_context`
- `app.gateway.services.merge_run_context_overrides`
- `app.gateway.services.start_run`
- `deerflow.runtime.run_agent`
- `app.gateway.deps.get_run_context`

If direct reuse of `start_run` is too HTTP-request-shaped, extract a small internal helper from it. The helper must still create `RunRecord` through `RunManager`, use `RunContext`, and publish through `StreamBridge`.

## MCP and skills

MCP runtime truth:

- `extensions_config.json`
- `/api/mcp/config`
- `deerflow.mcp.cache/get_cached_mcp_tools`
- `deerflow.tools.get_available_tools(include_mcp=True)`

Novel MCP page/API may list main MCP servers, but writes should proxy to main MCP routes or be disabled with a clear legacy/read-only contract. `MCPPlugin` rows must not decide runtime tool availability.

Skills runtime truth:

- `deerflow.skills.storage`
- `/api/skills`
- lead-agent prompt building
- `filter_tools_by_skill_allowed_tools`

`skill_governance_service` may remain as recommendation/explainability only. It must not widen the tool list beyond main enabled skills and allowed-tools policy.

## Memory and RAG

Main memory:

- Injected by `DynamicContextMiddleware` through `_get_memory_context`.
- Updated by `MemoryMiddleware` after title handling and final assistant response filtering.
- Should capture durable user preferences, not project plot state.

Novel RAG:

- `StoryMemory`, `PlotAnalysis`, `DocumentIndex`, `MemoryService`, and workspace documents remain work-level context and retrieval.
- Generated chapter summaries and analysis outputs should be indexed here.
- The adapter should expose enough task metadata for novel tools to read/write this layer.

Preventing pollution:

- The prompt should explicitly mark project plot content as work-level context.
- Tests should verify automatic RAG writes do not enqueue global memory writes for chapter bodies/plot details.

## Compatibility strategy

First slice:

- Keep public route paths and request/response schemas stable.
- Migrate one streaming path and one structured path.
- Leave `AIService` in place as a compatibility shim and JSON-cleaning helper.
- Add tests that fail if the migrated paths call `AIService.generate_text_stream` or direct `create_chat_model`.

Expansion:

- Move remaining generation, polish, analysis, outline, character, inspiration, and import-generation paths incrementally.
- Decommission direct AIService model calls only after coverage proves migrated routes are stable.

Rollback:

- Keep a feature flag or internal switch for the first migrated endpoint to fall back to old AIService only during the rollout window.
- The fallback must be logged as legacy and should not be the default.

## Delivery gates

This task must not be distributed directly to production-like nodes from an unverified local build. The required delivery sequence is:

1. Local implementation and targeted backend tests.
2. Local build/smoke verification using the project local-dev contract (`127.0.0.1:8551` backend, frontend `4560` when needed).
3. Upload to the 31-port test server and run a focused novel-generation smoke there.
4. Distribute to the other servers only after the 31-server smoke is clean.

The 31-server step is a deployment gate, not a replacement for local tests.

## Risks

- Agent output may be less deterministic than direct prompt calls unless structured parsing and tool instructions are tight.
- Existing SSE consumers may rely on exact event timing and field names.
- MemoryMiddleware may capture more novel content than intended unless prompts and tests guard the boundary.
- Calling main run infrastructure from inside novel routers can introduce request-shape coupling if not wrapped carefully.
- Existing `MCPPlugin` API appears stale; changing it may affect UI screens that still expect CRUD semantics.
