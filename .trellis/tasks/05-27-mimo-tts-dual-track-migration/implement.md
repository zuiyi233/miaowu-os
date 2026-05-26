# Implementation Plan

## Ordering

1. Complete provider child planning and implement MiMo provider/backend APIs first.
2. Extend novel role voice and chapter generation paths after provider APIs are testable.
3. Build `/workspace/tts-studio` after backend studio persistence and run-node contracts are planned.
4. Run end-to-end checks, docs, and deployment-readiness review after the first three children are implemented.

The parent task coordinates scope and final integration review. Implementation should happen in child tasks.

## Child Task Execution Gates

### 1. MiMo Provider and NewAPI/User Settings

- Read backend spec guides before coding:
  - `.trellis/spec/backend/error-handling.md`
  - `.trellis/spec/backend/quality-guidelines.md`
  - `.trellis/spec/guides/cross-layer-thinking-guide.md`
  - `.trellis/spec/guides/code-reuse-thinking-guide.md`
- Inspect original Deer-Flow logic under `D:\deer-flow-main` for any touched core gateway logic before editing Miaowu files.
- Implement provider type expansion, config availability, MiMo adapter, voice design/clone/optimize APIs, and tests.
- Keep generic `OPENAI_BASE_URL` from enabling TTS.

### 2. Novel TTS Role Voices and Audiobook Segments

- Read backend and frontend spec indexes plus relevant specific docs.
- Compare with original `D:\deer-flow-main` for touched novel reader/backend logic.
- For novel-specific behavior, inspect `D:\miaowu-os\参考项目\MuMuAINovel-main` if relevant role/character patterns are needed.
- Extend role voice data and UI without overloading the compact reader popover.
- Preserve existing device read-aloud and server audiobook modes.

### 3. TTS Studio Workspace

- Read frontend guidelines before coding.
- Use existing workspace navigation and page patterns.
- Use `@xyflow/react` already present in the frontend.
- Implement backend-owned workspace persistence before relying on frontend graph state.
- Do not copy reference `src/App.tsx` as a monolith.

### 4. E2E, Docs, Deploy Check

- Verify local-dev backend `8551` and frontend `4560`.
- Document NewAPI MiMo group routing and diagnostics.
- Do not deploy to 31 or five-node environments in this task unless a separate rollout task is created.

## Validation Commands

Run the tightest applicable subset during each child, then broaden before parent closure:

```powershell
cd N:\miaowu-os-merge-upstream-main\deer-flow-main\backend
uv run pytest -q tests/test_tts_router.py
uv run pytest -q tests/test_gateway_router_registration.py
uv run ruff check app/gateway/routers/tts.py app/gateway/routers/tts_support/service.py tests/test_tts_router.py
```

```powershell
cd N:\miaowu-os-merge-upstream-main\deer-flow-main\frontend
pnpm typecheck
pnpm test -- --run
```

If frontend tests are not configured or too broad, record the exact failure and run targeted type checks / component tests available in the repo.

## Files Likely To Change

Backend:

- `deer-flow-main/backend/app/gateway/routers/tts.py`
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py`
- possible new `tts_support/mimo.py` or similar focused adapter
- `deer-flow-main/backend/app/gateway/novel_migrated/api/user_settings.py`
- `deer-flow-main/backend/app/gateway/novel_migrated/services/ai_settings_service.py`
- `deer-flow-main/backend/app/gateway/novel_migrated/models/*` if voice/studio persistence needs models
- `deer-flow-main/backend/tests/test_tts_router.py`
- new backend tests for studio workspaces if APIs are added

Frontend:

- `deer-flow-main/frontend/src/core/tts/api.ts`
- `deer-flow-main/frontend/src/core/tts/*`
- `deer-flow-main/frontend/src/components/novel/reader/TtsPlayer.tsx`
- `deer-flow-main/frontend/src/components/workspace/workspace-nav-chat-list.tsx`
- `deer-flow-main/frontend/src/core/ai/feature-routing.ts`
- new `/workspace/tts-studio` app route and components

Reference-only:

- `参考项目/mimo-tts-studio-main/server/index.ts`
- `参考项目/mimo-tts-studio-main/src/App.tsx`
- `参考项目/mimo-tts-studio-main/CLAUDE.md`

## Rollback Points

- Provider code should be removable without touching existing provider behavior.
- Studio navigation entry should be safe to hide if backend APIs are incomplete.
- MiMo config must remain disabled unless explicitly configured.
- Any persistence migration must include tests and clear cleanup behavior.

## Planning Completion Checklist

- [ ] Parent artifacts reviewed.
- [ ] Child `prd.md`, `design.md`, and `implement.md` written.
- [ ] Open question about reusable voice abstraction answered.
- [ ] User approves which child to start first.
- [ ] `task.py start` is run only for the first implementation child, not for the parent.
