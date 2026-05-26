# Implementation Checklist

## Before Coding

- [ ] Run `git status --short`.
- [ ] Read `.trellis/spec/backend/error-handling.md`.
- [ ] Read `.trellis/spec/backend/quality-guidelines.md`.
- [ ] Read `.trellis/spec/guides/cross-layer-thinking-guide.md`.
- [ ] Compare touched TTS/gateway logic with `D:\deer-flow-main`.
- [ ] Re-read `参考项目/mimo-tts-studio-main/server/index.ts` around MiMo payloads and response parsing.

## Backend Work

- [ ] Extend `TtsProvider` and frontend `TtsProvider`.
- [ ] Add MiMo config resolver with fail-closed availability.
- [ ] Add `providers.mimo` and capabilities to config response.
- [ ] Add MiMo adapter calls.
- [ ] Add voice design/clone/optimize request and response models.
- [ ] Register new routes in `tts.py`.
- [ ] Add asset persistence for generated outputs or a narrowly scoped bridge into existing local TTS asset handling.
- [ ] Add tests.

## Verification

```powershell
cd N:\miaowu-os-merge-upstream-main\deer-flow-main\backend
uv run pytest -q tests/test_tts_router.py
uv run pytest -q tests/test_gateway_router_registration.py
uv run ruff check app/gateway/routers/tts.py app/gateway/routers/tts_support/service.py tests/test_tts_router.py
```

If frontend types are touched:

```powershell
cd N:\miaowu-os-merge-upstream-main\deer-flow-main\frontend
pnpm typecheck
```

## Stop Conditions

- Stop and update design if MiMo/NewAPI upstream contract differs from the reference shape.
- Stop and update design before adding new persistent database tables.
- Stop if implementation would require storing browser-visible long-lived API keys.
