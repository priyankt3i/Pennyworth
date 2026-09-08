// Run under xvfb on Linux. No credentials, provider calls or host commands.
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert/strict");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pennyworth-electron-"));
app.setPath("userData", directory);
fs.mkdirSync(path.join(directory, "sessions"));
for (let i = 0; i < 75; i++) {
  const id = `smoke-${String(i).padStart(3, "0")}`;
  fs.writeFileSync(path.join(directory, "sessions", `${id}.json`), JSON.stringify({
    id, title: `Smoke conversation ${i}`, createdAt: "2026-01-01T00:00:00.000Z",
    messages: Array.from({ length: 120 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `Message ${index}` })),
  }));
}
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
    const historyResult = await window.webContents.executeJavaScript(`
      (async () => {
        const waitFor = predicate => new Promise((resolve, reject) => {
          const deadline = Date.now() + 10000;
          const check = () => {
            if (predicate()) return resolve();
            if (Date.now() > deadline) return reject(new Error("History UI did not settle"));
            setTimeout(check, 20);
          };
          check();
        });
        await waitFor(() => state.activeSessionId && !state.isBusy);
        const sidebarCount = document.querySelectorAll('.session-item').length;
        const firstCount = el.chat.querySelectorAll('.message').length;
        const lastBefore = el.chat.querySelector('.message:last-child .message-body').textContent;
        el.chat.querySelector('.history-load-more').click();
        await waitFor(() => el.chat.querySelectorAll('.message').length === 100);
        const lastAfter = el.chat.querySelector('.message:last-child .message-body').textContent;
        const result = await window.pennyworth.renameSession(state.activeSessionId, "Renamed smoke conversation");
        const reloaded = await window.pennyworth.loadSession(state.activeSessionId);
        return { sidebarCount, firstCount, lastBefore, lastAfter, renamed: result.ok, title: reloaded.session.title };
      })()
    `);
    assert.equal(historyResult.sidebarCount, 50);
    assert.equal(historyResult.firstCount, 50);
    assert.equal(historyResult.lastBefore, historyResult.lastAfter);
    assert.equal(historyResult.renamed, true);
    assert.equal(historyResult.title, "Renamed smoke conversation");
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
