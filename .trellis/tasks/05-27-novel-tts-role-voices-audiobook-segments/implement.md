# Implementation Checklist

## Before Coding

- [ ] Run `git status --short`.
- [ ] Read frontend and backend relevant specs.
- [ ] Compare touched reader/backend logic with `D:\deer-flow-main`.
- [ ] Inspect `D:\miaowu-os\参考项目\MuMuAINovel-main` if role/character data modeling questions remain.
- [ ] Confirm provider child APIs are implemented or mocked.

## Backend

- [ ] Add/extend role voice models or metadata storage.
- [ ] Enforce user/project ownership for voice assets and reference audio.
- [ ] Extend narration plan serialization if needed.
- [ ] Extend chapter generation to resolve MiMo role voice assets.
- [ ] Preserve existing manifest/download shape.
- [ ] Add tests for mapping and ownership.

## Frontend

- [ ] Extend `core/tts` types and hooks.
- [ ] Add MiMo provider controls to AI audiobook mode.
- [ ] Add role voice management UI in a dedicated panel/surface.
- [ ] Show unavailable diagnostics and disabled states.
- [ ] Keep reader player compact.

## Verification

```powershell
cd N:\miaowu-os-merge-upstream-main\deer-flow-main\backend
uv run pytest -q tests/test_tts_router.py
```

```powershell
cd N:\miaowu-os-merge-upstream-main\deer-flow-main\frontend
pnpm typecheck
pnpm test -- --run
```

Record any unavailable test runner or missing script exactly.
