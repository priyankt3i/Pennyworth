const { app, BrowserWindow, Menu, Tray, globalShortcut, nativeImage } = require("electron");
const fs = require("fs");
const path = require("path");
const { registerIpcHandlers } = require("./ipc-handlers");

const ROOT_DIR = path.resolve(__dirname, "../..");
const ICON_ICO_PATH = path.join(ROOT_DIR, "public", "pennyworth.ico");
const ICON_PNG_PATH = path.join(ROOT_DIR, "public", "pennyworth.png");

let mainWindow = null;
let tray = null;

function createIcon() {
  if (fs.existsSync(ICON_PNG_PATH)) {
    return nativeImage.createFromPath(ICON_PNG_PATH);
  }
  if (fs.existsSync(ICON_ICO_PATH)) {
    return nativeImage.createFromPath(ICON_ICO_PATH);
  }
  return nativeImage.createEmpty();
}

function resolveWindowIconPath() {
  const preferred =
    process.platform === "win32"
      ? [ICON_ICO_PATH, ICON_PNG_PATH]
      : [ICON_PNG_PATH, ICON_ICO_PATH];
  return preferred.find((iconPath) => fs.existsSync(iconPath));
}

function createWindow() {
  const windowIconPath = resolveWindowIconPath();

  mainWindow = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: "Pennyworth",
    backgroundColor: "#0b1115",
    icon: windowIconPath,
    frame: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  if (typeof mainWindow.removeMenu === "function") {
    mainWindow.removeMenu();
  }

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("close", (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function toggleWindow() {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("pennyworth:summoned");
  } else if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("pennyworth:summoned");
  }
}

function createTray() {
  tray = new Tray(createIcon());
  tray.setToolTip("Pennyworth - Your Linux Butler");
  tray.on("click", toggleWindow);
  tray.on("double-click", toggleWindow);

  const menu = Menu.buildFromTemplate([
    { label: "Open Pennyworth", click: toggleWindow },
    {
      label: "Quit",
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
}

function registerShortcuts() {
  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    toggleWindow();
  });
}

if (process.env.NODE_ENV !== "test") {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });
  }

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    if (process.platform === "win32") {
      app.setAppUserModelId("com.pennyworth.desktop");
    }
    if (process.platform === "darwin" && app.dock) {
      const iconPath = resolveWindowIconPath();
      if (iconPath) {
        app.dock.setIcon(iconPath);
      }
    }
    createWindow();
    createTray();
    registerShortcuts();
    registerIpcHandlers(() => mainWindow);
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    try {
      const { terminateWorker } = require("./local-whisper");
      terminateWorker();
    } catch (e) {}
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
