# Technical Design

## Existing Surface

Current novel TTS is already built around:

- `TtsPlayer`
- `core/tts` hooks and API client
- backend narration plan APIs
- `TtsChapterGenerateRequest`
- speaker voice mapping
- manifest/download persistence

This task extends those surfaces rather than replacing them.

## Voice Records

Represent MiMo role voices as Miaowu-owned metadata, not assumed remote voice ids:

- character or speaker id
- display name and aliases
- voice description
- reference audio asset id
- generated sample asset id
- provider: `mimo`
- model
- mode: `design` or `clone`
- status: pending/generating/ready/error
- locked flag
- timestamps and diagnostics

Prefer adding these fields to an existing project/user-scoped persistence boundary if one exists. If a new model/table is required, design it in this child before implementation.

## Generation Precedence

For each segment, resolve voice in this order:

1. explicit `speaker_voices[segment.speaker_id]`
2. segment-level voice asset/reference
3. speaker-level voice asset/reference
4. plan default voice
5. request voice
6. provider default voice

If the resolved value is a MiMo role voice asset, synthesize through the MiMo strategy recorded on that asset. Otherwise keep existing provider voice behavior.

## UI Shape

Keep the reader controls lightweight. Put complex voice management in a dedicated panel or linked workflow:

- provider selector
- unavailable diagnostics
- role list with voice status
- create design voice
- upload/choose reference audio
- clone voice
- lock/regenerate/delete
- audition generated sample

## Reference Project Use

Borrow workflow ideas from the MiMo reference:

- character creation
- annotation
- generation
- per-character voice status
- locked voices

Do not borrow its workspace truth source or data URL persistence.
