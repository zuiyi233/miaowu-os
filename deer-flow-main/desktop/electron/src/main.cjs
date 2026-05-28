const { app, BrowserWindow, dialog, shell } = require("electron");
const { autoUpdater } = require("electron-updater");

const APP_URL = "https://xs.mwapi.bond";
const MIAOWU_HOST = "xs.mwapi.bond";
const OIDC_HOST = "xg.mwapi.bond";
const isDevelopment = !app.isPackaged;

let mainWindow = null;
let authWindow = null;
let updatePromptShown = false;

function parseHTTPURL(rawURL) {
  try {
    const url = new URL(rawURL);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function isMiaowuURL(rawURL) {
  const url = parseHTTPURL(rawURL);
  return Boolean(url && url.protocol === "https:" && url.hostname === MIAOWU_HOST);
}

function isOIDCURL(rawURL) {
  const url = parseHTTPURL(rawURL);
  return Boolean(url && url.protocol === "https:" && url.hostname === OIDC_HOST);
}

function openExternalURL(rawURL) {
  const url = parseHTTPURL(rawURL);
  if (url) {
    void shell.openExternal(url.toString());
  }
}

function finishAuthFlow(url) {
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.close();
  }
  authWindow = null;

  if (mainWindow && !mainWindow.isDestroyed()) {
    void mainWindow.loadURL(url);
    focusMainWindow();
  }
}

function handleAuthNavigation(event, url) {
  if (isOIDCURL(url)) {
    return;
  }

  event.preventDefault();
  if (isMiaowuURL(url)) {
    finishAuthFlow(url);
    return;
  }

  openExternalURL(url);
}

function openAuthWindow(url) {
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.focus();
    if (isOIDCURL(url)) {
      void authWindow.loadURL(url);
    }
    return;
  }

  authWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 720,
    minHeight: 620,
    show: false,
    parent: mainWindow || undefined,
    modal: Boolean(mainWindow),
    title: "Miaowu OS Login",
    backgroundColor: "#0f172a",
    webPreferences: {
      contextIsolation: true,
      devTools: isDevelopment,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  authWindow.once("ready-to-show", () => {
    if (authWindow && !authWindow.isDestroyed()) {
      authWindow.show();
    }
  });

  authWindow.webContents.setWindowOpenHandler(({ url: nextURL }) => {
    if (isOIDCURL(nextURL)) {
      void authWindow.loadURL(nextURL);
      return { action: "deny" };
    }
    if (isMiaowuURL(nextURL)) {
      finishAuthFlow(nextURL);
      return { action: "deny" };
    }
    openExternalURL(nextURL);
    return { action: "deny" };
  });

  authWindow.webContents.on("will-navigate", handleAuthNavigation);
  authWindow.webContents.on("will-redirect", handleAuthNavigation);
  authWindow.webContents.on("did-navigate", (_event, nextURL) => {
    if (isMiaowuURL(nextURL)) {
      finishAuthFlow(nextURL);
    }
  });

  authWindow.on("closed", () => {
    authWindow = null;
  });

  void authWindow.loadURL(url);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    backgroundColor: "#0f172a",
    title: "Miaowu OS",
    webPreferences: {
      contextIsolation: true,
      devTools: isDevelopment,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow) {
      return;
    }
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isOIDCURL(url)) {
      openAuthWindow(url);
      return { action: "deny" };
    }
    if (isMiaowuURL(url)) {
      void mainWindow.loadURL(url);
      return { action: "deny" };
    }
    openExternalURL(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isMiaowuURL(url)) {
      return;
    }
    event.preventDefault();
    if (isOIDCURL(url)) {
      openAuthWindow(url);
      return;
    }
    openExternalURL(url);
  });

  mainWindow.webContents.on("will-redirect", (event, url) => {
    if (isMiaowuURL(url)) {
      return;
    }
    event.preventDefault();
    if (isOIDCURL(url)) {
      openAuthWindow(url);
      return;
    }
    openExternalURL(url);
  });

  mainWindow.on("closed", () => {
    if (authWindow && !authWindow.isDestroyed()) {
      authWindow.close();
    }
    mainWindow = null;
  });

  void mainWindow.loadURL(APP_URL);
}

function focusMainWindow() {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
}

function configureAutoUpdates() {
  if (isDevelopment) {
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (error) => {
    console.warn("[auto-update]", error && error.message ? error.message : error);
  });

  autoUpdater.on("update-downloaded", async () => {
    if (updatePromptShown) {
      return;
    }
    updatePromptShown = true;

    const result = await dialog.showMessageBox({
      type: "info",
      buttons: ["Restart and install", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Miaowu OS update ready",
      message: "A new Miaowu OS update has been downloaded.",
      detail: "Restart the app to install it now, or continue using this version and install on exit.",
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall(false, true);
    }
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => {
      console.warn("[auto-update]", error && error.message ? error.message : error);
    });
  }, 5000);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", focusMainWindow);

  app.whenReady().then(() => {
    createMainWindow();
    configureAutoUpdates();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
