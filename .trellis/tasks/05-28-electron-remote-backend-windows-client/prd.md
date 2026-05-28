# Electron remote backend Windows client

## Goal

Build a first Windows desktop client for Miaowu-OS as a lightweight Electron shell that loads the production Miaowu web app at `https://xs.miaowu.bond`. The desktop client must not start a local Python/FastAPI backend, local database, local model runtime, or `.desktop-runtime` managed gateway.

## Requirements

- The Windows client loads `https://xs.miaowu.bond` as the primary app URL.
- `xg.miaowu.bond` remains only the NewAPI/OIDC authorization surface and must not be repurposed as the Miaowu client API origin.
- Navigation inside the Electron main window is restricted to `xs.miaowu.bond` and the OIDC flow host `xg.miaowu.bond`; other external URLs open in the system browser or are blocked.
- Desktop login must not replace the main Miaowu window with the NewAPI/OIDC page. NewAPI/OIDC navigation opens in a controlled login window and returns the completed `xs.miaowu.bond` callback/workspace URL to the main window.
- The app supports single-instance behavior, sensible window defaults, app identity metadata, and production-safe web preferences.
- Windows packaging uses Electron Builder with an NSIS installer.
- Auto-update uses GitHub Releases through `electron-updater`; the app checks for updates after startup and prompts the user to restart when an update is downloaded.
- Code signing configuration must be environment-driven; no certificate material, passwords, GitHub token, or other secrets may be committed.
- The existing local development port convention remains unchanged: backend `8551`, frontend `4560`; this task must not introduce new local backend defaults.
- Trellis planning artifacts must exist before implementation starts.

## Acceptance Criteria

- [x] A dedicated Electron app exists under `deer-flow-main/desktop/electron`.
- [x] The Electron app can run in development and open `https://xs.miaowu.bond`.
- [x] Non-whitelisted navigation cannot replace the main app window.
- [x] NewAPI/OIDC login opens in a controlled modal login window and returns to the main Miaowu window after callback.
- [x] GitHub Releases auto-update configuration is present and wired to runtime update checks.
- [x] Windows NSIS package configuration exists with environment-based signing hooks/placeholders only.
- [x] Documentation explains development, packaging, update, and signing environment variables.
- [x] No local backend, PyInstaller, local database, or `.desktop-runtime` startup path is added to the first-version client.
- [x] Feasible lint/type/static validation is run and any verification gap is reported.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
