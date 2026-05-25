# Research: client-native-tts-ffmpeg-wasm

- Query: 浏览器端 TTS + ffmpeg.wasm 在本项目里的可行实现边界；核对 Web Speech API、speechSynthesis 录制/导出、ffmpeg.wasm chunk 合并、移动端与 COOP/COEP 风险。
- Scope: mixed
- Date: 2026-05-25

## Findings

### Files found

- `deer-flow-main/frontend/src/core/tts/api.ts` - 当前前端 TTS API 合同层，统一通过 `getBackendBaseURL()` 下的 `/api/tts/*` 网关，不直接调用外部 TTS Provider。
- `deer-flow-main/frontend/src/core/tts/hooks.ts` - 当前 `useTts` 只实现服务端合成音频 Blob 播放、章节音频生成/查询、任务轮询、下载 URL；尚无浏览器原生 `speechSynthesis` 引擎。
- `deer-flow-main/frontend/src/core/tts/index.ts` - TTS core 导出入口，应继续作为新增原生 TTS hook/engine 的公开出口。
- `deer-flow-main/frontend/src/components/novel/reader/TtsPlayer.tsx` - 小说阅读器 TTS UI，当前播放按钮调用 `tts.speak(text)`，实际走服务端 `/api/tts/synthesize`，尚未区分“设备朗读”和“AI 有声书”两种模式。
- `deer-flow-main/frontend/tests/unit/core/tts/api.test.ts` - 当前 API 合同测试验证 8551 网关、`/api/tts/synthesize`、`/api/tts/voices`、章节生成/下载路径。
- `deer-flow-main/frontend/tests/unit/core/tts/useTts.test.ts` - 当前 hook 状态形状、章节生成、AbortController 隔离测试；未覆盖 `window.speechSynthesis`。
- `deer-flow-main/frontend/tests/unit/components/novel/reader/TtsPlayer.test.tsx` - 当前 TTS UI/i18n/能力门测试；应扩展模式切换、原生不可下载、fallback 文案。
- `deer-flow-main/frontend/package.json` - 当前没有 `@ffmpeg/ffmpeg`、`@ffmpeg/core`、`@ffmpeg/core-mt`、`@ffmpeg/util` 依赖。
- `deer-flow-main/frontend/next.config.js` - 搜索未发现 COOP/COEP header 配置；当前前端没有为 cross-origin isolation 配置全站 headers。
- `.trellis/tasks/05-25-novel-api-tts-full-buildout/prd.md` - 明确客户端原生朗读是 P1，必须与服务端 API 有声书分离，且不能导出 MP3 或暴露 provider key。
- `.trellis/tasks/05-25-novel-api-tts-full-buildout/design.md` - 已定义客户端原生朗读边界：`speechSynthesis`、`SpeechSynthesisUtterance`、voiceschanged、长文本切块、用户手势启动、不可生成音频文件。
- `.trellis/tasks/05-25-novel-api-tts-full-buildout/implement.md` - Phase 2 要求新增 frontend-only client native TTS engine、mocked `window.speechSynthesis` 单测、模式切换 UI。
- `.trellis/spec/frontend/hook-guidelines.md` - hook 层应把后端失败归一成明确 typed states 后再到页面层。
- `.trellis/spec/frontend/quality-guidelines.md` - 小说 i18n 新增 key 必须用 `withNovelDefaults(...)`，并跑 `pnpm tsc --noEmit` 与目标测试。
- `.trellis/spec/frontend/state-management.md` - 前端查询/轮询要按路由和需求收敛，避免无差别轮询；对 TTS job polling 也应只在生成任务运行时存在。

### Code patterns

- `deer-flow-main/frontend/src/core/tts/api.ts:263` defines `ttsUrl(path)` as `${getBackendBaseURL()}/api/tts${path}`; any server TTS chunk/generation call must keep this gateway path and local-dev 8551 base.
- `deer-flow-main/frontend/src/core/tts/api.ts:384` posts `synthesizeSpeech()` to `/api/tts/synthesize` and returns a `Blob`; browser-native TTS should not reuse this path for device read-aloud.
- `deer-flow-main/frontend/src/core/tts/api.ts:408` and `:434` already define chapter audio lookup/generation contracts; chunk merge/export should remain server/API audiobook responsibility unless a later explicit design adds client-side post-processing.
- `deer-flow-main/frontend/src/core/tts/api.ts:509` maps chapter audio manifests to gateway download URLs; native `speechSynthesis` should not populate this because it has no generated asset.
- `deer-flow-main/frontend/src/core/tts/hooks.ts:149` owns `useTts()` state; current state has `playing/loading/error/progress/duration/currentTime` and chapter audio fields, but no `mode`, native support flag, native voices, utterance queue, pitch, or local voice selection.
- `deer-flow-main/frontend/src/core/tts/hooks.ts:163` stores `HTMLAudioElement` and Blob URL refs; native `speechSynthesis` needs separate refs for queue, current utterance index, current text/chapter identity, and cleanup via `speechSynthesis.cancel()`.
- `deer-flow-main/frontend/src/core/tts/hooks.ts:180` loads server config immediately; native mode should not require server TTS config to be available before exposing device read-aloud support.
- `deer-flow-main/frontend/src/core/tts/hooks.ts:206` loads provider voices via `/api/tts/voices`; native voices must come from `speechSynthesis.getVoices()` and stay typed separately from provider voices.
- `deer-flow-main/frontend/src/core/tts/hooks.ts:222` cleanup currently stops audio and aborts fetches; native mode must also cancel utterance queues on unmount/chapter change.
- `deer-flow-main/frontend/src/core/tts/hooks.ts:703` current `speak(text)` always calls `synthesizeSpeech()` then `new Audio(url)`; MVP should either split into `speakServer()` / `speakNative()` or add an explicit `ttsMode` branch so a device-read click never calls `/api/tts/synthesize`.
- `deer-flow-main/frontend/src/core/tts/hooks.ts:799` and `:806` pause/resume only control `HTMLAudioElement`; native mode should call `speechSynthesis.pause()` / `resume()` and treat progress as chunk/character approximation rather than audio duration.
- `deer-flow-main/frontend/src/components/novel/reader/TtsPlayer.tsx:80` `handleSpeak` calls `tts.speak(text)`; UI needs a mode control before this path is safe for native TTS.
- `deer-flow-main/frontend/src/components/novel/reader/TtsPlayer.tsx:133` downloads `tts.downloadUrl`; native mode must disable/hide download and explain that device read-aloud is non-exportable.
- `deer-flow-main/frontend/src/components/novel/reader/TtsPlayer.tsx:158` computes available providers from server config only; native device mode availability must be independent of backend provider availability.
- `deer-flow-main/frontend/src/components/novel/reader/TtsPlayer.tsx:385` chapter audio controls are grouped under chapter mode; they should remain AI audiobook controls, not native TTS controls.
- `deer-flow-main/frontend/tests/unit/core/tts/api.test.ts:9` mocks `getBackendBaseURL()` as `http://127.0.0.1:8551`; preserve this in server API tests and add a negative test that native mode does not call the gateway.
- `deer-flow-main/frontend/tests/unit/core/tts/useTts.test.ts:15` mocks React hooks directly; for robust native queue behavior, prefer an additional focused unit around a pure native engine/helper or a hook test that explicitly mocks `window.speechSynthesis`.
- `deer-flow-main/frontend/tests/unit/components/novel/reader/TtsPlayer.test.tsx:72` mocks `@/core/tts`; extend this mock with native support/mode fields so UI tests can verify mode labels and disabled download behavior.

### External references

- MDN Web Speech API: `SpeechSynthesis` is the TTS half of Web Speech and reads text via the device's default synthesizer using `SpeechSynthesisUtterance` objects and `speechSynthesis.speak()` (https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API).
- MDN `SpeechSynthesis`: baseline widely available since September 2018; it controls the speech service, exposes queue state, `getVoices()`, `pause()`, `resume()`, `cancel()`, and `speak()` (https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis).
- MDN `SpeechSynthesisUtterance`: baseline widely available, but some parts vary; supports `text`, `lang`, `voice`, `rate`, `pitch`, `volume`, plus events like `boundary`, `end`, `error`, `pause`, `resume`, `start` (https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance).
- MDN `getVoices()`: returns device voices; examples call it once and then refresh via `onvoiceschanged` when available (https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices).
- MDN `voiceschanged`: baseline widely available since September 2022; fires when the `getVoices()` result changes (https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/voiceschanged_event).
- Can I Use Speech Synthesis API: reports 94.21% global support in April 2026, with current Chrome/Edge/Safari/Firefox/Chrome Android/iOS Safari supported; Opera Mini, UC Android, Android Browser, and Opera Mobile are unsupported (https://caniuse.com/speech-synthesis).
- MDN `MediaRecorder`: records a supplied `MediaStream`, not arbitrary `speechSynthesis` output; recording formats depend on UA support and resources (https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder).
- MDN `MediaRecorder.isTypeSupported()`: support is checked per MIME type and recording may still fail from resource limits; MP3 is not guaranteed by the API (https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static).
- MDN `HTMLMediaElement.captureStream()`: only captures rendered media elements, is not baseline, and does not give a way to capture Web Speech output directly (https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/captureStream).
- MDN `Window.crossOriginIsolated`: `SharedArrayBuffer` requires cross-origin isolation; headers must include `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` or `credentialless`, plus permissions policy not blocking it (https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated).
- ffmpeg.wasm overview: browser-only pure WebAssembly/JavaScript port; runs processing in web workers; supports single-thread `@ffmpeg/core` and multi-thread `@ffmpeg/core-mt` (https://ffmpegwasm.netlify.app/docs/overview/).
- ffmpeg.wasm usage: official examples load `ffmpeg-core` around 31 MB; multi-thread version requires `SharedArrayBuffer` and meeting security requirements (https://ffmpegwasm.netlify.app/docs/getting-started/usage/).
- ffmpeg.wasm performance: official benchmark shows native FFmpeg 5.2s vs wasm single-thread 128.8s and wasm multi-thread 60.4s for one transcode scenario, so wasm is much slower than native even with multithread (https://ffmpegwasm.netlify.app/docs/performance/).
- ffmpeg.wasm installation: `@ffmpeg/ffmpeg` spawns a web worker; docs recommend hosting it on your server most of the time rather than CDN import (https://ffmpegwasm.netlify.app/docs/getting-started/installation/).
- npm metadata checked 2026-05-25 from `npm view`: `@ffmpeg/ffmpeg@0.12.15` unpacked size 71,999 bytes; `@ffmpeg/core@0.12.10` unpacked size 64,689,644 bytes; `@ffmpeg/core-mt@0.12.10` unpacked size 65,700,111 bytes.

### Web Speech API capability and limits

- Desktop capability: current Chrome, Edge, Safari, and Firefox support speech synthesis, but available voices are OS/browser dependent. Product logic must feature-detect `window.speechSynthesis` and `window.SpeechSynthesisUtterance`, then load voices from `getVoices()` and refresh on `voiceschanged`.
- Mobile capability: iOS Safari and Chrome for Android are listed supported, but mobile behavior is still best-effort. Start must be user gesture initiated; long text should be split into short utterances because mobile speech services can stall or drop long utterances; page lifecycle/unmount/chapter change must cancel or pause.
- Voice limitations: voice IDs/names are not portable provider contracts. The same browser family can expose different voices by OS, installed language packs, user settings, and online/offline speech services.
- Control limitations: API supports queueing, pause/resume/cancel, rate/pitch/volume/voice/lang on utterances. Duration, seek, byte-level progress, stable timestamps, MP3 output, provider-grade voice style, and multi-speaker narration are not native Web Speech outputs.
- Progress limitations: `boundary` events can help approximate word/sentence progress where supported, but they are not equivalent to provider timestamps and should not drive precise read-along alignment in MVP.
- Security/API key boundary: browser-native speech uses local/device speech service only. It must not receive or infer OpenAI/NewAPI/Volcengine/MOSS keys and must not call external provider APIs.

### ffmpeg.wasm suitability for front-end chunk merging

- Technically possible: ffmpeg.wasm can concatenate/transcode audio in-browser if chunks are already fetched as Blob/ArrayBuffer and written into the wasm FS. It can also encode MP3 because the documented build includes LAME.
- Not suitable for MVP in this project: current frontend has no ffmpeg.wasm dependencies, no COOP/COEP headers, and no cross-origin isolation. Adding it would introduce a large wasm asset, worker loading/hosting work, mobile memory/CPU risk, and a new browser support matrix.
- Package/body risk: official usage examples disclose `ffmpeg-core` around 31 MB to load, while current npm unpacked `@ffmpeg/core` and `@ffmpeg/core-mt` are about 64-66 MB. This is inappropriate to put on the default reader path and risky even as lazy-loaded mobile feature.
- Performance risk: official performance numbers show wasm transcode far slower than native FFmpeg; phone CPU, memory pressure, thermal throttling, and tab lifecycle make long chapter stitching fragile.
- COOP/COEP risk: multi-thread `@ffmpeg/core-mt` needs `SharedArrayBuffer`; this requires cross-origin isolation headers. Setting COOP/COEP globally in Next can break or require auditing third-party embeds, auth popups, cross-origin assets, and any resource lacking CORS/CORP compatibility. Current repo search found no COOP/COEP setup.
- Mobile risk: even single-thread core avoids SharedArrayBuffer but still pays heavy wasm download and memory cost. Multi-chapter or long-chapter merging on phones is likely to be slow, battery-heavy, and failure-prone.
- Better boundary: server API audiobook mode should own chunk stitching/export using server-side FFmpeg or equivalent, or initially avoid stitching by returning an ordered playlist/manifest of chunk download URLs and a server-generated chapter download endpoint.

### Can speechSynthesis export or be recorded as MP3?

- Direct export: no. `speechSynthesis` and `SpeechSynthesisUtterance` expose control/events for speaking through the speech service, not audio bytes, a `MediaStream`, a `Blob`, PCM samples, or MP3 output.
- Direct recording: no supported direct path. `MediaRecorder` records a supplied `MediaStream`; Web Speech output is not exposed as a stream. `HTMLMediaElement.captureStream()` captures media elements and is not baseline, but `speechSynthesis` is not a media element source.
- Indirect recording caveat: browser/system audio loopback hacks are outside normal Web APIs, not portable, often require user permission or OS routing, and cannot be treated as an application feature.
- MP3 export: only service-generated audio should be downloadable/exportable. If the source is server TTS chunks, MP3 stitching/export belongs in server API audiobook mode, not client-native read-aloud.

### Recommended MVP implementation

- Add a frontend-only native TTS engine under `deer-flow-main/frontend/src/core/tts/`, likely `native.ts` plus optional `useNativeTts.ts`, exported through `index.ts`.
- Add explicit mode state: `device` / `server` or `native` / `api`. Default to device mode when feature-detected and user has no cached server audio selected; keep server generated audio visible and selectable when available.
- Implement native detection: `typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window`.
- Implement voice loading: call `speechSynthesis.getVoices()` on mount/open, subscribe to `voiceschanged`, expose native voices separately from provider voices, and persist selected native voice locally only as a preference.
- Implement mobile-safe utterance queue: deterministic chunking by paragraph/sentence with max character cap; enqueue sequential `SpeechSynthesisUtterance`s; advance on `end`, surface `error`, cancel stale queue on stop/unmount/chapter change.
- Implement native controls: play, pause, resume, stop, rate, pitch, voice. Use approximate progress from chunk index and optional boundary char index; do not expose seek/duration as exact.
- UI: update `TtsPlayer.tsx` to show a mode toggle, native voice/rate/pitch controls in device mode, and existing provider/model/instructions/chapter generation/download controls only in AI audiobook mode.
- Fallback: if unsupported or no voices after `voiceschanged` timeout/refresh, show a visible fallback to server API mode, but do not require server config for the feature-detection itself.
- Tests: add mocked `window.speechSynthesis` unit tests for support/unsupported, voice loading, `voiceschanged`, queue completion, pause/resume/cancel, text/chapter cleanup, and negative gateway-call behavior. Extend `TtsPlayer.test.tsx` for mode toggle and non-exportable native mode.

### Explicit non-goals for MVP

- Do not add ffmpeg.wasm to the frontend for MVP.
- Do not set global COOP/COEP solely for front-end TTS chunk merging.
- Do not stitch long chapter audio in the browser.
- Do not export or record `speechSynthesis` output as MP3.
- Do not fake native-mode download URLs, media assets, durations, timestamps, or read-along alignment.
- Do not expose provider API keys or call OpenAI/NewAPI/Volcengine/MOSS directly from the browser.
- Do not make native voices part of backend/provider voice metadata contracts.
- Do not treat native Web Speech as replacement for server API audiobook mode; it is immediate best-effort read-aloud only.

## Related specs

- `.trellis/spec/frontend/hook-guidelines.md` - typed hook-layer state/error handling.
- `.trellis/spec/frontend/quality-guidelines.md` - novel i18n defaults and required validation.
- `.trellis/spec/frontend/state-management.md` - avoid unnecessary global polling; relevant to TTS job polling and native queue state.
- `.trellis/tasks/05-25-novel-api-tts-full-buildout/prd.md` - two-mode TTS requirement and native non-export boundary.
- `.trellis/tasks/05-25-novel-api-tts-full-buildout/design.md` - existing architecture and frontend/native boundaries.
- `.trellis/tasks/05-25-novel-api-tts-full-buildout/implement.md` - Phase 2 frontend native TTS execution plan.

## Caveats / Not Found

- `python ./.trellis/scripts/task.py current --source` returned `Current task: (none)` in this sub-agent session. The user supplied the active task path explicitly, so this file was written only inside `.trellis/tasks/05-25-novel-api-tts-full-buildout/research/`.
- I did not run browser runtime smoke on real desktop/mobile devices; mobile statements are derived from official compatibility/docs plus known API shape, not local device verification.
- I did not inspect generated Next build headers at runtime; repo search found no COOP/COEP/cross-origin isolation header configuration in the frontend.
- I did not test ffmpeg.wasm locally or install packages; package size data came from `npm view` and official docs.
- Official docs do not define a portable max utterance length. Any chunk size should be validated empirically in this app; MVP should keep chunking conservative and event-driven.
