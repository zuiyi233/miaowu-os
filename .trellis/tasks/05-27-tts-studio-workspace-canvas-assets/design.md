# Technical Design

## API

Add backend-owned workspace APIs under `/api/tts/studio/workspaces`:

- `GET /api/tts/studio/workspaces`
- `POST /api/tts/studio/workspaces`
- `GET /api/tts/studio/workspaces/{id}`
- `PUT /api/tts/studio/workspaces/{id}`
- `DELETE /api/tts/studio/workspaces/{id}`
- `POST /api/tts/studio/workspaces/{id}/run-node`
- `POST /api/tts/studio/workspaces/{id}/export`

Run-node accepts a node id and current graph snapshot or persisted workspace revision. Backend validates inputs and updates workspace/artifact metadata.

## Persistence

Options to evaluate during implementation:

- reuse existing Settings/preferences JSON for small per-user board metadata
- add a project/user-scoped model if board state becomes too large or needs querying
- store generated audio in existing `MediaAsset` and object storage/local asset path

Do not use the reference app's `data/workspaces.json`.

## Frontend Structure

Do not copy `src/App.tsx`. Split into:

- `app/workspace/tts-studio/page.tsx`
- `components/workspace/tts-studio/*`
- `core/tts/studio-api.ts`
- hooks for graph state, workspace autosave, node execution, artifact stash

## Node Types

V1 node taxonomy:

- `referenceAudio`: upload/record/select a voice sample asset
- `voiceStyle`: director text with optional style optimize
- `prompt`: text content
- `voiceClone`: consumes reference audio, style, and prompt
- `voiceDesign`: consumes voice description and prompt
- `artifact`: output playback/download/stash

## UI Constraints

- Tool-first dense layout.
- Stable dimensions for graph controls and side panels.
- Use icons for actions where familiar.
- Avoid nested cards and landing-page sections.
- Show configuration diagnostics from `/api/tts/config`.

## Asset Flow

Temporary browser audio may start as a local file or recording. Before durable save or node execution, upload it to backend media/asset storage and store only the returned asset id and metadata in board state.
