# MiMo TTS E2E, Documentation, and Deployment Check

## Goal

Verify the integrated MiMo TTS migration end to end, document setup/diagnostics, and identify deployment readiness without mixing production rollout into the code migration.

## Requirements

- Verify local-dev uses backend `http://127.0.0.1:8551` and frontend `4560`.
- Verify MiMo unavailable state when no explicit route exists.
- Verify MiMo available state when explicit NewAPI/MiMo route exists.
- Verify novel chapter MiMo multi-role generation with mocked or real provider depending on available credentials.
- Verify `/workspace/tts-studio` create/run/play/download/export flow.
- Update docs with NewAPI group setup, user setting routing, diagnostics, and intentional non-migrations.
- Document deployment checks separately from rollout execution.

## Acceptance Criteria

- [ ] Backend TTS tests pass or failures are documented with exact commands/output.
- [ ] Frontend typecheck/tests pass or failures are documented with exact commands/output.
- [ ] Browser smoke covers studio route and core controls if dev server can run.
- [ ] Docs explain how to configure MiMo through NewAPI/user settings.
- [ ] Docs explain that Express/Electron/default key/local workspace store were not migrated.
- [ ] Deployment checklist states that 31/five-node rollout requires a separate task.

## Out of Scope

- Actually deploying to 31 or production.
- Secret exposure in docs.
- Claiming real MiMo success without a real provider call or a clearly marked mock.
