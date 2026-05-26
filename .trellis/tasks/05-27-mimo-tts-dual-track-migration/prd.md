# MiMo TTS Dual-Track Migration to Miaowu-OS

## Goal

Bring the mature MiMo TTS capabilities from `参考项目/mimo-tts-studio-main` into Miaowu-OS as an integrated feature set, not as a copied standalone Express/Electron application.

The migration has two product entry points:

- Enhance the existing novel TTS/audiobook path with MiMo voice design, voice clone, role voice binding, and stronger multi-segment generation.
- Add a Miaowu workspace audio studio at `/workspace/tts-studio` for node-based reference audio, style, prompt, voice clone, voice design, artifact stash, playback, download, and batch export workflows.

## Confirmed Facts

- Current workspace: `N:\miaowu-os-merge-upstream-main`.
- Current git status was clean at planning start, despite the initial plan mentioning 17 uncommitted changes. This must be rechecked before implementation.
- Local-dev backend and frontend ports are project-specific: backend `http://127.0.0.1:8551`, frontend `4560`. Do not fall back to `8001`.
- Current backend TTS entrypoint is `deer-flow-main/backend/app/gateway/routers/tts.py`.
- Current backend TTS core is `deer-flow-main/backend/app/gateway/routers/tts_support/service.py`.
- Existing `TtsProvider` values are `openai`, `volcengine`, and `moss-local`.
- Existing TTS API already includes `/api/tts/config`, `/api/tts/voices`, `/api/tts/synthesize`, chapter audio generation, chapter audio manifest, chapter download, narration plan CRUD, smoke/probe, and job endpoints.
- Existing TTS config intentionally does not treat a regular `OPENAI_BASE_URL` or normal chat provider as proof that OpenAI-compatible TTS is available.
- Existing chapter audio generation writes to `.deer-flow/tts-assets` or `MIAOWU_TTS_ASSET_DIR`, tracks manifests, and uses `MediaAsset` / object storage where possible.
- Existing frontend TTS client lives under `deer-flow-main/frontend/src/core/tts`.
- Existing novel reader TTS component is `deer-flow-main/frontend/src/components/novel/reader/TtsPlayer.tsx`.
- Existing workspace navigation is `deer-flow-main/frontend/src/components/workspace/workspace-nav-chat-list.tsx`.
- `@xyflow/react` is already present and used by Miaowu components such as AI elements and the relationship graph.
- Existing user AI settings are backend-controlled through `/api/user/ai-settings` and NewAPI group sync endpoints under `deer-flow-main/backend/app/gateway/novel_migrated/api/user_settings.py`.
- Existing frontend feature routing definitions are in `deer-flow-main/frontend/src/core/ai/feature-routing.ts`.
- The MiMo reference project is a Vite + Express + Electron app with a monolithic `src/App.tsx` and `server/index.ts`.
- The MiMo reference project uses `mimo-v2.5-tts-voiceclone`, `mimo-v2.5-tts-voicedesign`, `mimo-v2-flash`, and `mimo-v2.5-pro`.
- The MiMo reference project stores API keys and workspaces in its own settings/files and transports audio as long-lived base64 data URLs. Those patterns are explicitly out of scope for Miaowu.

## Requirements

- Add MiMo as a first-class TTS provider in the existing Miaowu TTS core instead of creating a parallel TTS service.
- Keep existing OpenAI, Volcengine, MOSS-local, device read-aloud, chapter audio, browser export, and narration plan behavior compatible.
- Resolve MiMo credentials and base URL from backend-controlled user settings, explicit MiMo/TTS feature routing, or service-side MiMo-specific environment variables only.
- Do not enable MiMo from a generic chat provider, a generic `OPENAI_BASE_URL`, or browser-local settings.
- Do not expose long-lived MiMo/NewAPI API keys to the frontend.
- Return strict 401 for missing user context; do not restore anonymous, `local_single_user`, or `NOVEL_MIGRATED_DEFAULT_USER_ID` behavior.
- Store durable audio outputs as backend assets and references, not long-lived browser data URLs.
- Allow temporary frontend data URLs only as transitional upload payloads that are converted into backend assets.
- Add or extend APIs for MiMo voice design, voice clone, style optimize, voice-design optimize, studio workspace CRUD, run-node, and export.
- Add `providers.mimo` to `/api/tts/config` with availability, defaults, capabilities, and diagnostics.
- Add frontend provider/types/API client support for `mimo`.
- Add a workspace-integrated `/workspace/tts-studio` page using existing Next.js, React, `@xyflow/react`, lucide icons, and local UI components.
- Keep the new studio dense, tool-like, and integrated with the Miaowu workspace. Do not build a standalone landing page or copy MiMo branding wholesale.
- Split implementation into independently verifiable child tasks.

## Child Task Map

- `05-27-mimo-tts-provider-newapi-user-settings`: MiMo provider adapter, config exposure, NewAPI/user setting resolution, provider APIs, and backend tests.
- `05-27-novel-tts-role-voices-audiobook-segments`: role voice assets, novel role binding, narration plan voice mapping, and chapter generation integration.
- `05-27-tts-studio-workspace-canvas-assets`: `/workspace/tts-studio`, React Flow node workflows, workspace persistence, run-node, artifact stash, playback/download/export.
- `05-27-mimo-tts-e2e-docs-deploy-check`: integration smoke tests, documentation, local-dev verification, and deployment-readiness checks.

## Acceptance Criteria

- [ ] Parent and all child tasks have `prd.md`, `design.md`, and `implement.md` before any child is started.
- [ ] The provider child can prove `mimo` is unavailable without explicit TTS/MiMo configuration and available when a valid MiMo/NewAPI TTS route is configured.
- [ ] `/api/tts/config` includes `providers.mimo` with voice clone, voice design, style optimize, role voices, and narration plan capability flags.
- [ ] `/api/tts/synthesize` remains backward compatible and accepts MiMo-specific advanced options without breaking existing providers.
- [ ] Voice design and clone endpoints return backend asset references or audio responses through the existing asset boundary, with structured errors for timeout, upstream errors, empty audio, invalid payloads, and oversized audio.
- [ ] Novel TTS can bind speakers/roles to MiMo-designed or MiMo-cloned voice assets and still write chapter manifests/download links.
- [ ] `/workspace/tts-studio` supports the v1 board workflow: create/load/save board, connect nodes, run clone/design nodes through Miaowu backend, play/download artifacts, stash artifacts, and export multiple artifacts.
- [ ] Missing authentication returns 401 for studio, voice, and novel TTS APIs.
- [ ] Durable state is backend-owned; browser local state is cache/draft only.
- [ ] Frontend local-dev uses backend `http://127.0.0.1:8551` and does not introduce `8001`.
- [ ] Tests cover backend contracts, frontend client/types, key UI state transitions, and at least one local integration path where feasible.
- [ ] Documentation explains NewAPI MiMo group setup, user setting routing, capability diagnostics, and what is intentionally not migrated.

## Out of Scope

- Migrating the reference project's Express server.
- Migrating Electron packaging, Vite app structure, separate ports, or standalone CORS policy.
- Storing frontend default keys or long-lived keys in localStorage.
- Using `data/workspaces.json` or MiMo's file workspace store as the Miaowu truth source.
- Rebuilding all MiMo visual polish in v1.
- Deploying to 31 or five-node production as part of the code migration task; deployment requires a separate rollout task.

## Open Questions

- Should voice clone v1 persist a generated reusable MiMo voice abstraction, or should it persist only reusable Miaowu audio/reference assets plus the prompt metadata needed to synthesize each segment?

Recommended answer: persist Miaowu-owned voice asset records that can reference a cloned source asset, generated sample asset, prompt metadata, and provider metadata. Avoid claiming MiMo has a reusable remote voice id until the provider contract proves one exists.
