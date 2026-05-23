# Legacy AIService call-site classification

## Migrated in this task

- `api/novel_stream.py`
  - chapter generate stream
  - chapter continue stream
  - chapter generate alias
  - chapter continue alias
  - batch chapter generate stream
  - replay failed batch stream
- `api/polish.py`
  - text polish

These paths now route model generation through `NovelAgentRunService` and the main `lead_agent` run stack. `AIService` may still be passed into chapter generation only for legacy auto-analysis orchestration that has not yet been migrated.

## Runtime authority changed in this task

- `api/mcp_plugins.py`
  - listing reads main `deerflow.extensions_config`
  - legacy create/update/delete/test writes return `410`

Novel `MCPPlugin` rows are no longer runtime authority for the migrated generation path.

## Legacy or follow-up migration surface

- `api/chapters.py`
  - partial regeneration still uses `AIService.generate_text_stream`
- `api/outlines.py`
  - outline continuation and expansion services still use `AIService`
- `api/characters.py`
  - character generation still uses `AIService`
- `api/projects.py`
  - project template/seed generation still uses `AIService`
- `api/inspiration.py` and `services/inspiration.py`
  - inspiration workflows still use `AIService`
- `services/book_import_service.py`
  - import-time structure/world/career/outline generation still uses `AIService.call_with_json_retry`
- `services/orchestration_service.py`, `services/plot_analyzer.py`, `services/chapter_regenerator.py`
  - analysis/revision/regeneration pipelines still use `AIService`
- `services/auto_character_service.py`, `services/auto_organization_service.py`, `services/plot_expansion_service.py`
  - helper services still use `AIService`
- `api/settings.py`
  - model connectivity/test calls remain direct by design because they verify user model configuration, not novel content generation
- `services/mcp_test_service.py`
  - legacy MCP connection test helper remains direct/legacy

This file is an explicit migration ledger, not an approval to add new direct-model generation paths. New novel model-reasoning entry points should use `NovelAgentRunService` unless the task is specifically a legacy compatibility or settings connectivity test.
