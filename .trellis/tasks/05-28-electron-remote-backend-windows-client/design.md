# Electron remote backend Windows client design

## Architecture

The desktop client is an independent Electron project under `deer-flow-main/desktop/electron`. It is intentionally separate from the existing `.desktop-runtime` path, which packages local Next standalone and local gateway services. This client is a production web shell: Electron loads `https://xs.miaowu.bond` and delegates all backend behavior to the deployed server.

## Runtime behavior

- Main process creates one BrowserWindow with hardened defaults: no Node integration, context isolation enabled, sandbox enabled, and devtools closed in packaged builds.
- Single-instance lock prevents duplicate client processes; a second launch focuses the existing window.
- Allowed in-window origins are `https://xs.miaowu.bond` and `https://xg.miaowu.bond` for the NewAPI/OIDC authorization flow.
- Other links are opened through the OS browser when triggered by user navigation, and blocked from replacing the main app surface.
- Auto-update uses `electron-updater`. Checks are skipped in development and run shortly after packaged app startup. When downloaded, the user receives a dialog to restart and install.

## Packaging

- `electron-builder` creates a Windows NSIS installer.
- GitHub Releases is configured as the update provider. Repository owner/name are kept configurable through package metadata/build config and must be reviewed before publishing.
- Signing remains environment-based. Test signing can be enabled through CI/user environment variables; secret material is never committed.

## Compatibility boundaries

- Do not change Miaowu server runtime, Docker production routing, local-dev 8551/4560 conventions, or NewAPI `xg.miaowu.bond` role.
- Do not embed API tokens or user credentials in Electron code.
- Do not add local backend startup, local model execution, or `.desktop-runtime` service orchestration to this client.
