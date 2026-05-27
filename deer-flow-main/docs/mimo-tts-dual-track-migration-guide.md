# MiMo TTS Dual-Track Migration Guide

This guide documents the Miaowu-OS integration path for MiMo TTS, the novel audiobook enhancement, and the new `/workspace/tts-studio` workspace.

## Scope

The integration is intentionally split into two product entry points:

1. Existing novel TTS / audiobook flows gain MiMo voice design, voice clone, role voice mapping, and richer chapter generation metadata.
2. A new workspace-integrated audio studio provides a node-based flow for reference audio, style text, prompts, voice clone, voice design, and artifact export.

This migration does **not** bring over the standalone MiMo Express/Electron application.

## Local Development Ports

- Backend: `http://127.0.0.1:8551`
- Frontend: `4560`

Do not treat `8001` as the default backend port for this project.

## MiMo Provider Routing

MiMo is enabled only through explicit backend-controlled routes:

- user AI settings with TTS/MiMo feature routing
- the canonical `tts` runtime module
- the explicit aliases `tts-studio` and `mimo-tts`
- MiMo-specific server environment variables

Generic chat configuration must not enable MiMo TTS.

## Supported Backend APIs

The TTS router exposes the following MiMo-related operations:

- `GET /api/tts/config`
- `GET /api/tts/voices`
- `POST /api/tts/synthesize`
- `POST /api/tts/voices/design`
- `POST /api/tts/voices/clone`
- `POST /api/tts/style/optimize`
- `POST /api/tts/voice-design/optimize`

The studio workspace adds:

- `GET /api/tts/studio/workspaces`
- `POST /api/tts/studio/workspaces`
- `GET /api/tts/studio/workspaces/{id}`
- `PUT /api/tts/studio/workspaces/{id}`
- `DELETE /api/tts/studio/workspaces/{id}`
- `POST /api/tts/studio/workspaces/{id}/run-node`
- `POST /api/tts/studio/workspaces/{id}/export`

## Backend Truth Sources

Durable state is backend-owned:

- generated audio stays in the asset / TTS asset boundary
- studio board state is stored server-side
- narration plan metadata remains chapter-bound
- browser local storage is cache / draft only

Do not use browser-local settings as truth for MiMo or studio persistence.

## What Was Not Migrated

- standalone Express server
- standalone Electron packaging
- the reference project`s file-backed workspace truth source
- long-lived browser API key storage
- unbounded base64 audio as durable workspace truth

## Validation

Suggested checks:

```powershell
cd deer-flow-main/backend
uv run pytest -q tests/test_tts_router.py tests/test_tts_studio_workspace.py tests/test_gateway_router_registration.py
uv run ruff check app/gateway/routers/tts.py app/gateway/routers/tts_support/service.py app/gateway/routers/tts_support/studio.py tests/test_tts_router.py tests/test_tts_studio_workspace.py
```

```powershell
cd deer-flow-main/frontend
pnpm typecheck
pnpm test -- --run
```

## Notes

- MiMo provider resolution must remain fail-closed.
- Novel role voice mapping is intentionally metadata-driven rather than a new standalone role voice database.
- The studio workspace is intentionally minimal and tool-like. It is not a full DAW or timeline editor.
