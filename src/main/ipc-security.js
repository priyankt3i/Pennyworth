const path = require("path");
const { pathToFileURL } = require("url");
const { ipcMain, BrowserWindow } = require("electron");
const rendererUrl = pathToFileURL(path.join(__dirname, "../renderer/index.html")).href;
function trustedSender(event) {
  try {
    return Boolean(event?.senderFrame && event.senderFrame === event.sender.mainFrame &&
      event.senderFrame.url === rendererUrl && BrowserWindow.fromWebContents(event.sender) && !event.sender.isDestroyed());
  } catch (_) { return false; }
}
const guardedIpcMain = {
  handle(channel, handler) {
    ipcMain.handle(channel, (event, ...args) => {
      if (!trustedSender(event)) throw new Error("Untrusted IPC sender.");
      return handler(event, ...args);
    });
  },
  on(channel, handler) {
    ipcMain.on(channel, (event, ...args) => {
      if (!trustedSender(event)) return;
      Promise.resolve().then(() => handler(event, ...args)).catch(error => console.error("IPC event failed:", error.message));
    });
  },
};
module.exports = { guardedIpcMain, trustedSender, rendererUrl };
