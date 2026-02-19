const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pennyworth", {
  getRuntimeConfig: () => ipcRenderer.invoke("pennyworth:get-runtime-config"),
  setProfile: (profileId) => ipcRenderer.invoke("pennyworth:set-profile", profileId),
  getSettings: () => ipcRenderer.invoke("pennyworth:get-settings"),
  getProviderHealth: () => ipcRenderer.invoke("pennyworth:get-provider-health"),
  saveSettings: (payload) => ipcRenderer.invoke("pennyworth:save-settings", payload),
  getSystemContext: () => ipcRenderer.invoke("pennyworth:get-system-context"),
  captureScreen: () => ipcRenderer.invoke("pennyworth:capture-screen"),
  ask: (payload) => ipcRenderer.invoke("pennyworth:ask", payload),
  onSummoned: (handler) => ipcRenderer.on("pennyworth:summoned", handler),
});
