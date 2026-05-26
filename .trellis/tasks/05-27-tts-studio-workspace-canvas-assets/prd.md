# TTS Studio Workspace Canvas and Asset Workflow

## Goal

Add an integrated Miaowu audio studio at `/workspace/tts-studio` with a node-based workflow for reference audio, voice style, prompts, MiMo voice clone/design, generated artifacts, stash, playback, download, and export.

## Requirements

- Add sidebar entry "音频工作站".
- Add `/workspace/tts-studio` page using the existing workspace shell.
- Use existing Next.js/React frontend, `@xyflow/react`, lucide icons, and local UI components.
- Do not add a standalone Vite app.
- Persist workspace board data through Miaowu backend APIs.
- Durable board state includes name, nodes, edges, stash asset references, timestamps, and user ownership.
- Node run actions call Miaowu backend, not MiMo/NewAPI directly.
- Reference audio upload must become a backend asset before durable use.
- Artifacts must store asset ids/URLs/metadata rather than long-lived base64.
- Batch export should use backend ZIP for large artifacts where feasible.

## Acceptance Criteria

- [ ] Authenticated user can create, list, load, update, and delete a TTS studio workspace.
- [ ] Unauthenticated requests return 401.
- [ ] User A cannot access User B workspaces or assets.
- [ ] Canvas supports v1 nodes: reference audio, voice style, prompt, voice clone, voice design, artifact.
- [ ] Running voice clone/design nodes calls backend `/api/tts/*` endpoints and persists generated artifacts.
- [ ] Generated artifacts can be played and downloaded.
- [ ] Stashed artifacts survive refresh.
- [ ] Batch export works for multiple artifacts or reports a clear unsupported reason.
- [ ] UI remains workspace-integrated and does not present a marketing/landing page.

## Out of Scope

- Electron packaging.
- MiMo smart workspace generation unless explicitly added later.
- Full visual parity with the reference app.
- Long-lived browser data URL storage.
