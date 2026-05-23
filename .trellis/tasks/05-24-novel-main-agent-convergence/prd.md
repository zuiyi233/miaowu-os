# Novel main-agent convergence

## Goal

Make the migrated novel feature a first-class DeerFlow business capability instead of a parallel lightweight AI runtime. Model-reasoning novel workflows must run through the main Gateway-embedded LangGraph/RunManager lead-agent path so they inherit DeerFlow MCP, skills, memory, thread isolation, middleware, logs, token usage, run history, and tool policy.

The novel RAG system remains, but its role is narrowed to project/work-level context: plot facts, chapter indexes, foreshadowing, character state, imported documents, and workspace documents. Main DeerFlow memory remains the source of user-level long-term preferences and writing habits.

## Confirmed repository facts

- Gateway already initializes LangGraph runtime singletons (`StreamBridge`, `RunManager`, checkpointer, store, run event store, memory worker) in `app.gateway.deps.langgraph_runtime`.
- `/api/runs/stream`, `/api/runs/wait`, and thread-run routers delegate to `app.gateway.services.start_run`, then `deerflow.runtime.run_agent`.
- `run_agent` injects runtime context (`thread_id`, `run_id`, caller context, `app_config`) into LangGraph runtime and streams `values`, `messages`, and `custom` events through the Gateway bridge.
- The lead agent already assembles the main middleware chain: dynamic memory/date context, summarization, token usage, title, memory, tool error handling, loop detection, optional subagents, and clarification.
- Main tools already include `NOVEL_BUILTIN_TOOLS` by default through `deerflow.tools.get_available_tools(include_novel=True)`.
- Main MCP tools are loaded from `extensions_config.json` and `/api/mcp/config`; `novel_migrated.services.mcp_tools_loader` already bridges to DeerFlow MCP instead of owning a full separate MCP runtime.
- Main skills are loaded and governed through `deerflow.skills.*`, `/api/skills`, lead-agent prompt injection, and `filter_tools_by_skill_allowed_tools`.
- `novel_migrated.services.ai_service.AIService` still directly creates chat models and calls `ainvoke` / `astream`, including tool-call loops and model cache logic.
- Multiple novel endpoints and services still depend on `AIService.generate_text_stream`, `generate_text`, or `call_with_json_retry`.
- Novel project memory/RAG exists through `StoryMemory`, `PlotAnalysis`, `DocumentIndex`, `MemoryService`, Chroma/fallback retrieval, and workspace document indexing.
- `novel_migrated.api.mcp_plugins` still writes `MCPPlugin` rows and calls a non-existent/obsolete `load_tools_for_plugin` method, so it cannot be treated as the source of truth for runtime MCP availability.

## Requirements

- Model-reasoning novel workflows must use the main RunManager/LangGraph lead-agent path by default.
- `AIService` must stop being a second agent runtime. It may remain as a compatibility adapter for legacy call sites during migration.
- New adapter code must preserve existing old novel API routes and response shapes where practical, especially SSE compatibility for existing frontend calls.
- Main DeerFlow middleware must run for novel generation paths: dynamic memory injection, summarization, tool error handling, token usage, title/thread handling, skills prompt injection, MCP tool assembly, and run journaling.
- Novel run requests must bind `user_id`, `thread_id`, `project_id`, `chapter_id` where applicable, and store run metadata in the main run store.
- Novel context assembly must follow this order: user long-term memory, current novel project metadata, recent chapter/outline/character/foreshadow context, novel RAG retrieval results, current request.
- Main memory must not be polluted with chapter bodies, plot details, foreshadowing, or character state by default.
- Stable user preferences, writing habits, and explicit long-term style preferences may flow into main memory through the existing MemoryMiddleware path.
- Novel RAG tables and indexes must remain canonical for work-level memory and must not be bulk-imported into main user memory.
- Novel MCP and skills UI/API behavior must treat main DeerFlow configuration as runtime truth. Novel-specific MCP/skill tables may be retained only as read-only legacy display/recommendation layers until a later deprecation task.
- Runtime skill availability must be decided by main `deerflow.skills.*`, configured skill state, allowed-tools policy, and lead-agent prompt injection. Novel session skill hints may only narrow or suggest, never expand beyond main policy.
- Local development defaults must keep the project contract: backend `http://127.0.0.1:8551`, frontend `4560`; do not introduce `8001` as a novel default gateway.
- Delivery must follow the staged gate requested by the user: build and test locally first, then upload to the 31-port test server for a smoke run, and only distribute to the other servers after local and 31-server verification pass.
- Existing unrelated worktree changes must not be reverted or reformatted.

## Acceptance Criteria

- [ ] A `NovelContextAssembler` exists and has tests proving context order, truncation, and pollution boundaries.
- [ ] A `NovelAgentRunService` or equivalent adapter exists with `run_task(...)` and `stream_task(...)` entry points.
- [ ] Adapter tests prove `user_id`, `thread_id`, `project_id`, `chapter_id`, runtime provider overrides, and metadata are passed into the main RunManager/LangGraph run config.
- [ ] At least one high-value streaming generation endpoint (chapter generate or continue) uses the main agent adapter internally while preserving the legacy SSE contract.
- [ ] At least one non-streaming structured generation path uses the main agent adapter and parses structured output without direct `AIService.ainvoke`.
- [ ] `AIService` direct model calls are either removed from migrated paths or explicitly marked as legacy/fallback-only with tests preventing new core generation paths from using them.
- [ ] Novel project RAG write/search remains functional after generation and analysis.
- [ ] Tests prove chapter/plot/foreshadow content is written to novel RAG/workspace documents, not automatically to main global memory.
- [ ] Tests prove a user-level memory preference can be injected into a novel generation run through main dynamic memory context.
- [ ] Tests prove novel MCP/skills visibility follows main `/api/mcp` and `/api/skills` state, not `MCPPlugin` or `skill_governance_service` as runtime authority.
- [ ] Regression tests cover old novel frontend endpoints without changing their public route paths.
- [ ] Local build/test verification passes before any server upload.
- [ ] A 31-port server smoke test is performed after local verification and before broader distribution.
- [ ] Broader server distribution happens only after the local and 31-server gates are green.
- [ ] Verification includes targeted backend tests for run adapter, context assembler, memory pollution, MCP/skills source-of-truth, and at least one novel stream endpoint.

## Out of Scope

- Deleting existing novel RAG tables or history.
- Bulk-importing historical `StoryMemory` records into main DeerFlow memory.
- A frontend-breaking route migration.
- Full removal of every legacy `AIService` call in one pass if the call is not part of core model-reasoning generation.
- Removing `MCPPlugin` tables. First pass should make runtime behavior ignore them or expose them as legacy/read-only.
- Changing local-dev ports or upstream container-internal `gateway:8001` routing.

## Planning notes

- This is a complex cross-layer task and requires `design.md` plus `implement.md` before `task.py start`.
- The first implementation slice should be intentionally narrow: build the adapter/context contracts, then migrate one streaming path and one structured path before expanding to all novel generation surfaces.
