# miaowu-os 图片生成能力模块实施计划

## Steps

1. Read backend/frontend spec indexes and existing patterns for routers, auth dependencies, persistence, uploads/media, and workspace pages.
2. Implement backend image generation models, service, storage, and router for first-stage MVP.
3. Register the router in the gateway app and add tests for validation, success, upstream failure, job history, and file serving.
4. Implement `/workspace/images` frontend page and API client helpers using existing UI patterns.
5. Add focused frontend test or type coverage for request/response handling and layout-safe states where practical.
6. Run targeted backend tests, frontend typecheck/test, and report any validation gaps.

## Validation Commands

- Backend targeted tests from `deer-flow-main/backend`: `uv run pytest -q tests/test_image_generation_router.py`
- Backend formatting/lint if available and scoped: `uv run ruff check app/gateway/routers/image_generation.py app/gateway/image_generation.py tests/test_image_generation_router.py`
- Frontend from `deer-flow-main/frontend`: `pnpm typecheck`
- Frontend targeted tests if added: `pnpm test -- <test-file>`

## Risk Controls

- Do not modify unrelated active TTS/novel files except if router registration conflicts require careful merge.
- Do not migrate or copy the reference project's standalone backend app or frontend app.
- Do not introduce a second auth system or SQLite database.
- Keep image files in a controlled project data directory and protect file reads through the gateway route.
- Keep the first implementation focused on text-to-image MVP; edit/mask/novel integration remain future extension points.
