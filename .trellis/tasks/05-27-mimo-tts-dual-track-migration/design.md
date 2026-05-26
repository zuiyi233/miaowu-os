# Technical Design

## Architecture

This is an integrated migration with one shared TTS backend core and two product surfaces.

Shared core:

- `deer-flow-main/backend/app/gateway/routers/tts.py`
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py`
- existing auth, user AI settings, `MediaAsset`, object storage, `.deer-flow/tts-assets`, chapter manifest, and download paths

Product surfaces:

- Novel reader / audiobook generation path through existing novel TTS components and chapter APIs.
- Workspace audio studio under `/workspace/tts-studio`.

Reference-only source:

- `参考项目/mimo-tts-studio-main/server/index.ts`
- `参考项目/mimo-tts-studio-main/src/App.tsx`
- `参考项目/mimo-tts-studio-main/CLAUDE.md`

The reference app is not a runtime dependency. It informs payload shape, node taxonomy, and workflow sequencing only.

## Provider Boundary

Extend `TtsProvider` from:

```text
openai | volcengine | moss-local
```

to:

```text
openai | volcengine | moss-local | mimo
```

MiMo must be implemented as an adapter inside the existing TTS support service or a focused helper imported by it. It must not add a second TTS server.

## MiMo Upstream Shape

The reference project calls `https://api.xiaomimimo.com/v1/chat/completions` with:

- `mimo-v2.5-tts-voiceclone`
- `mimo-v2.5-tts-voicedesign`
- `mimo-v2-flash`
- `mimo-v2.5-pro`

The reference response parser expects audio at `choices[0].message.audio.data` and text at `choices[0].message.content`.

Miaowu should support equivalent upstream shapes but route through configured NewAPI/MiMo provider settings when possible. The implementation should tolerate OpenAI-compatible `/chat/completions` base URLs and normalize base URL suffixes through existing provider helpers where possible.

## Configuration and Availability

MiMo availability must be fail-closed.

Allowed sources:

- user AI settings with explicit feature routing for `tts`, `tts-studio`, or `mimo-tts`
- managed NewAPI group selected by the user and explicitly bound to the TTS/MiMo module
- MiMo-specific server environment variables such as `MIMO_TTS_BASE_URL`, `MIMO_TTS_API_KEY`, or agreed project-specific names

Disallowed sources:

- generic `OPENAI_BASE_URL`
- active/default chat provider without explicit TTS/MiMo routing
- frontend localStorage settings
- reference project's `api-key` header from browser input

`/api/tts/config` should expose:

- `providers.mimo.available`
- `providers.mimo.default_model`
- `providers.mimo.default_format`
- capability flags for `voice_clone`, `voice_design`, `style_optimize`, `role_voices`, and `narration_plan`
- diagnostics explaining missing route, missing key, missing model, unsupported endpoint, or last smoke error

## Data Flow

Voice design:

1. Frontend sends voice description, text/sample text, optional instruction, model/format, and selected route/provider id.
2. Backend resolves MiMo config through user settings.
3. Backend calls MiMo/NewAPI using server-side credentials.
4. Backend validates audio bytes, content type, size, and metadata.
5. Backend stores audio as a `MediaAsset` or local TTS asset and returns asset metadata, playback URL, and download URL.

Voice clone:

1. Frontend uploads or references a backend audio asset.
2. Backend validates asset ownership and MIME/size constraints.
3. Backend calls MiMo voice clone with reference audio, text, instruction/style, and format.
4. Backend stores generated output as an asset.
5. Backend returns asset metadata and normalized provider diagnostics.

Novel audiobook:

1. Novel roles map to Miaowu voice records or voice asset metadata.
2. Narration plan segments keep speaker identity and voice binding references.
3. Chapter generation resolves each segment's speaker voice to a MiMo voice design/clone strategy or existing provider voice id.
4. Generated chunks continue to write the existing manifest and download outputs.

Studio:

1. User creates or loads a backend-owned board.
2. Frontend graph state stores nodes/edges/stash item metadata, not durable base64 audio.
3. Run-node calls backend `/api/tts/studio/workspaces/{id}/run-node`.
4. Backend validates node inputs, resolves assets, invokes MiMo APIs, persists outputs, and updates workspace state.
5. Export gathers asset IDs and produces a ZIP or a lightweight multi-file download path.

## Persistence

Durable objects should be owned by the backend and scoped by user id:

- studio workspace board metadata: nodes, edges, stash references, name, timestamps
- voice assets: role id, character id, description, reference asset id, generated sample asset id, provider metadata, lock state
- generated audio assets: existing `MediaAsset` / `.deer-flow/tts-assets` integration

Browser state can cache draft graph state, but backend state is canonical. Missing user context must return 401.

## Compatibility

Existing contracts must remain stable:

- `openai`, `volcengine`, and `moss-local` config and synthesize paths
- chapter audio manifest and `/api/tts/chapters/{chapter_id}/download`
- device read-aloud mode in `TtsPlayer`
- browser export path for already-generated audio chunks
- narration plan API
- no TTS availability from generic OpenAI chat env

## UI Integration

The studio should use:

- Next.js app route under `deer-flow-main/frontend/src/app/workspace/tts-studio`
- existing workspace shell/sidebar
- `@xyflow/react`
- lucide icons
- existing UI components and compact operational styling

Do not copy the reference `App.tsx` wholesale. Split into:

- `core/tts` API client additions
- page/container components
- node components
- graph/state hooks
- artifact/player/export helpers

## Risk and Rollback

High-risk areas:

- provider resolution and accidental key exposure
- cross-user asset access
- large audio payloads and base64 memory use
- chapter manifest compatibility
- frontend type drift across provider configs
- adding broad new database tables without migrations/tests

Rollback strategy:

- Land provider, novel, studio, and docs in separate child tasks.
- Keep MiMo availability false unless explicitly configured.
- Gate UI features on `providers.mimo.available` and capability flags.
- Preserve existing providers and keep tests proving old defaults.
