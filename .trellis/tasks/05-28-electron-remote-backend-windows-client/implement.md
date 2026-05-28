# Electron remote backend Windows client implementation plan

1. Add a standalone Electron project under `deer-flow-main/desktop/electron` with package metadata, scripts, Electron Builder config, and source files.
2. Implement main-process window creation, navigation allowlist, external-link handling, single-instance behavior, and production web preferences.
3. Implement packaged-app auto-update checks using `electron-updater` with GitHub Releases provider and user restart prompt.
4. Add README instructions for development, Windows packaging, GitHub release publishing, and environment-based test signing.
5. Validate with install/build checks where feasible: dependency install if needed, lint/static syntax check, and package configuration inspection. Report any packaging/signing validation that cannot run due to missing credentials or release setup.
