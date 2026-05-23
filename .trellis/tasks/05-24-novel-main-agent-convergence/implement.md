# Implementation Plan

## Pre-work gates

- [ ] Confirm current working tree changes are unrelated and leave them untouched.
- [ ] Read backend guidelines before code edits:
  - `.trellis/spec/backend/quality-guidelines.md`
  - `.trellis/spec/backend/error-handling.md`
  - `.trellis/spec/backend/database-guidelines.md` if database writes are changed.
- [ ] Re-skim relevant code before editing:
  - `app/gateway/services.py`
  - `app/gateway/routers/runs.py`
  - `packages/harness/deerflow/runtime/runs/worker.py`
  - `packages/harness/deerflow/agents/lead_agent/agent.py`
  - `packages/harness/deerflow/tools/tools.py`
  - `app/gateway/novel_migrated/services/ai_service.py`
  - `app/gateway/novel_migrated/api/novel_stream.py`
  - `app/gateway/novel_migrated/services/memory_service.py`
  - `app/gateway/novel_migrated/api/mcp_plugins.py`

## Slice 1: contracts and tests

- [ ] Add `NovelContextAssembler` under `app.gateway.novel_migrated.services`.
- [ ] Add focused tests for:
  - context ordering
  - truncation behavior
  - project-level RAG vs main-memory pollution boundary
  - missing project/chapter access handling
- [ ] Add `NovelAgentRunService` under `app.gateway.novel_migrated.services`.
- [ ] Mock `RunManager`/`StreamBridge`/Gateway run helper in tests to prove config/context metadata:
  - `user_id`
  - `thread_id`
  - `project_id`
  - `chapter_id`
  - runtime provider/model overrides
  - advisory skill names
  - `include_novel=True`

## Slice 2: first streaming migration

- [ ] Migrate one chapter generation or continuation stream endpoint to `NovelAgentRunService.stream_task(...)`.
- [ ] Preserve legacy SSE event names and payload fields.
- [ ] Include `run_id` and `thread_id` as additive fields only.
- [ ] Write generated result and summary back to existing chapter/workspace/RAG paths.
- [ ] Add regression test proving the route no longer calls `AIService.generate_text_stream`.

## Slice 3: first structured/non-streaming migration

- [ ] Migrate one structured generation path (`polish`, `analysis`, or import-generation subtask) to `NovelAgentRunService.run_task(...)`.
- [ ] Add structured output parsing with retry/error handling that maps failures to existing HTTP behavior.
- [ ] Add regression test proving no direct `create_chat_model`/`AIService.ainvoke` call happens for the migrated path.

## Slice 4: MCP and skills source-of-truth cleanup

- [ ] Change novel MCP listing behavior to read from main MCP config/cache, or mark legacy `MCPPlugin` CRUD as read-only/deprecated.
- [ ] Remove or disable novel runtime dependence on `MCPPlugin` enabled/status fields.
- [ ] Change skill governance integration so `skill_governance_service` returns recommendation/explainability only.
- [ ] Add tests proving main `/api/mcp` and `/api/skills` state controls novel runtime availability.

## Slice 5: memory/RAG smoke and cleanup

- [ ] Add test or smoke helper for the minimum acceptance scenario:
  - main memory contains "user prefers first-person tense narration"
  - novel generation run sees the preference through main dynamic memory context
  - generated plot summary is searchable from novel RAG
  - main memory is not updated with raw chapter plot details by the novel RAG write
- [ ] Document remaining `AIService` legacy call sites and classify each as migrated, fallback-only, or future work.

## Slice 6: local build and staged rollout

- [ ] Run local backend targeted tests and any frontend/build checks needed by touched files.
- [ ] Run a local smoke using backend `http://127.0.0.1:8551` and frontend `4560` if the UI is involved.
- [ ] Package or build the verified local artifact using the repo's existing deployment method.
- [ ] Upload to the 31-port test server and run one focused novel-generation smoke:
  - main user memory preference is visible to the generation path
  - generated chapter/summary is persisted to novel RAG/workspace document paths
  - legacy SSE or HTTP response shape remains compatible
- [ ] If 31-server smoke passes, distribute the same verified artifact to the other servers.
- [ ] Record any server-specific failures and stop before broader distribution if the 31-server gate fails.

## Validation commands

Run from `deer-flow-main/backend` unless noted:

```bash
python -m pytest tests/test_run_manager.py tests/test_runs_api_endpoints.py
python -m pytest tests/test_memory_prompt_injection.py tests/test_memory_queue_user_isolation.py
python -m pytest tests/test_mcp_client_config.py tests/test_skills_loader.py tests/test_lead_agent_skills.py
python -m pytest tests/test_novel_tools.py tests/test_novel_unified_persistence.py
python -m pytest tests/test_novel_stream_guards.py
```

Add new targeted tests and include them in the final command list once filenames exist.

If local services are used for smoke, respect the project local-dev contract:

- backend: `http://127.0.0.1:8551`
- frontend: `4560`

Server rollout validation is deliberately ordered: local first, 31-port test server second, other servers last.

## Rollback points

- Before switching each endpoint, keep the old `AIService` call behind a clearly named temporary fallback flag.
- If SSE mapping breaks, revert only the endpoint migration and keep `NovelContextAssembler` / `NovelAgentRunService` tests.
- Do not drop `StoryMemory`, `PlotAnalysis`, `DocumentIndex`, `MCPPlugin`, or old route schemas in this task.
