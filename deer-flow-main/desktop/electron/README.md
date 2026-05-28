# Miaowu OS Desktop

Windows Electron shell for the production Miaowu-OS deployment.

This client loads `https://xs.miaowu.bond` and uses the remote server backend. It does not start a local FastAPI gateway, local database, local model runtime, or `.desktop-runtime` service bundle.

## Development

```powershell
cd deer-flow-main/desktop/electron
npm install
npm run start
```

The app opens `https://xs.miaowu.bond`. The main-window navigation allowlist is limited to Miaowu itself:

- `xs.miaowu.bond` for Miaowu-OS

NewAPI/OIDC authorization at `xg.miaowu.bond` opens in a controlled modal login window. When that flow redirects back to `xs.miaowu.bond`, the modal closes and the main window loads the callback or workspace URL. Other HTTP(S) links are opened with the system browser instead of replacing the app window.

## Validation

```powershell
npm run check
npm run pack
```

`npm run pack` builds an unpacked Electron app for local inspection. It does not publish a release.

## Windows Installer

```powershell
npm run dist:win
```

The Windows target is NSIS. Installer artifacts are written to `dist/` and follow:

```text
MiaowuOS-Setup-<version>-<arch>.exe
```

Before public distribution, add a Windows `.ico` file containing at least a 256x256 image and wire it through the `build.win.icon` setting. The existing web favicon is too small for `electron-builder`'s Windows icon requirement.

## Auto Update

Auto update uses `electron-updater` with GitHub Releases:

- owner: `zuiyi233`
- repo: `miaowu-os`

For release publishing, provide GitHub credentials through the environment used by `electron-builder`, for example `GH_TOKEN`. Do not commit tokens.

In development, update checks are skipped. In packaged builds, the app checks shortly after startup, downloads updates automatically, and prompts the user to restart when an update is ready.

## Test Signing

Code signing is intentionally environment-driven. Do not commit certificates or passwords. For test signing, provide signing values through the build environment supported by `electron-builder`, such as:

```powershell
$env:CSC_LINK = "C:\path\to\test-certificate.pfx"
$env:CSC_KEY_PASSWORD = "replace-with-local-secret"
npm run dist:win
```

Replace test signing with a production certificate before public distribution.
