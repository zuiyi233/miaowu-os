# Implementation Checklist

## Before Coding

- [ ] Run `git status --short`.
- [ ] Read `.trellis/spec/frontend/*` relevant docs.
- [ ] Read `.trellis/spec/guides/cross-layer-thinking-guide.md`.
- [ ] Inspect existing workspace page and navigation patterns.
- [ ] Confirm provider child APIs are implemented or mocked.

## Backend

- [ ] Choose persistence boundary and document why.
- [ ] Add studio workspace models/schemas.
- [ ] Add CRUD APIs with user ownership.
- [ ] Add run-node API.
- [ ] Add export API.
- [ ] Add backend tests for auth, CRUD, ownership, run-node, export.

## Frontend

- [ ] Add route `/workspace/tts-studio`.
- [ ] Add sidebar navigation item.
- [ ] Add studio API client.
- [ ] Add React Flow board with v1 node components.
- [ ] Add upload/record-to-asset flow.
- [ ] Add node execution and artifact updates.
- [ ] Add stash/play/download/export controls.
- [ ] Add unavailable/provider diagnostics.

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

If a local dev server is started for browser verification, use backend `8551` and frontend `4560`.
