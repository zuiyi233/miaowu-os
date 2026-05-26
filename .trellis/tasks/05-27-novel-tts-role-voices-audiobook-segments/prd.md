# Novel TTS Role Voices and Audiobook Segment Enhancement

## Goal

Enhance the existing novel TTS path so novel roles/speakers can use MiMo-designed or MiMo-cloned voices in chapter-level audiobook generation while preserving current device read-aloud and server audiobook behavior.

## Requirements

- Keep `TtsPlayer` two-mode behavior: device read-aloud and AI audiobook.
- Add MiMo provider selection and role voice binding where provider capabilities allow it.
- Align role voice data with existing novel project/user boundaries.
- Support role metadata such as role/character id, aliases, gender/age, personality, voice description, reference audio asset, voice status, and lock state where needed.
- Extend narration plan speaker-to-voice mapping to support MiMo voice assets or role voice references.
- Generate chapter audio by segment with the correct speaker voice strategy.
- Continue writing existing chapter manifest and download outputs.
- Do not break OpenAI/MOSS/Volcengine generation.

## Acceptance Criteria

- [ ] Existing single narrator chapter generation still works.
- [ ] Existing AI multi-voice narration plan generation still works.
- [ ] A role/speaker can be bound to a MiMo voice design asset or clone/reference asset.
- [ ] Segment generation uses speaker/role voice mapping in deterministic precedence.
- [ ] Chapter manifest records enough provider/voice metadata for refresh/download.
- [ ] Missing auth remains 401.
- [ ] UI clearly shows MiMo unavailable when config is missing.
- [ ] Tests cover speaker voice mapping and at least one MiMo role voice generation path with mocked provider output.

## Out of Scope

- Building the full `/workspace/tts-studio` canvas.
- Copying MiMo's audiobook workspace store.
- Replacing existing narration planner entirely.
