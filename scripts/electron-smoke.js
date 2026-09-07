// Run under xvfb on Linux. No credentials, provider calls or host commands.
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert/strict");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pennyworth-electron-"));
app.setPath("userData", directory);
process.env.NODE_ENV = "test";
const timer = setTimeout(() => { console.error("Electron smoke test timed out"); app.exit(1); }, 20000);
app.whenReady().then(async () => {
  try {
    const { createWindow } = require("../src/main/index");
    const window = createWindow();
    await new Promise(resolve => window.webContents.once("did-finish-load", resolve));
    const result = await window.webContents.executeJavaScript(`
      (() => {
        globalThis.injectedByNotification = false;
        pushNotification("error", '<img src=x onerror="globalThis.injectedByNotification=true">');
        renderNotificationsList();
        return { bridge: typeof window.pennyworth.ask, images: document.querySelectorAll('.toast-msg img, .notification-msg img').length, injected: globalThis.injectedByNotification, policy: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content };
      })()
    `);
    assert.equal(result.bridge, "function");
    assert.equal(result.images, 0);
    assert.equal(result.injected, false);
    assert.match(result.policy, /script-src 'self'/);
    assert.equal(window.webContents.getLastWebPreferences().sandbox, true);
    assert.equal(window.webContents.getLastWebPreferences().contextIsolation, true);
    console.log(app.commandLine.hasSwitch("no-sandbox") ? "Development renderer smoke passed (Electron process sandbox disabled)" : "Electron smoke checks passed");
    window.destroy();
    clearTimeout(timer);
    app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timer); app.exit(1); }
});
app.on("quit", () => { try { fs.rmSync(directory, { recursive: true, force: true }); } catch (_) {} });
