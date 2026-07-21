const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pennyworth", {
  getRuntimeConfig: () => ipcRenderer.invoke("pennyworth:get-runtime-config"),
  setProfile: (profileId) => ipcRenderer.invoke("pennyworth:set-profile", profileId),
  getSettings: () => ipcRenderer.invoke("pennyworth:get-settings"),
  getProviderHealth: (payload) => ipcRenderer.invoke("pennyworth:get-provider-health", payload),
  listOllamaModels: (payload) => ipcRenderer.invoke("pennyworth:list-ollama-models", payload),
  saveSettings: (payload) => ipcRenderer.invoke("pennyworth:save-settings", payload),
  getSystemContext: () => ipcRenderer.invoke("pennyworth:get-system-context"),
  listDisplays: () => ipcRenderer.invoke("pennyworth:list-displays"),
  captureScreen: (payload) => ipcRenderer.invoke("pennyworth:capture-screen", payload),
  ask: (payload) => ipcRenderer.invoke("pennyworth:ask", payload),
  cancelAgent: () => ipcRenderer.invoke("pennyworth:cancel-agent"),
  onTraceEvent: (handler) => ipcRenderer.on("pennyworth:trace-event", (event, arg) => handler(arg)),
  windowMinimize: () => ipcRenderer.invoke("pennyworth:window-minimize"),
  windowMaximizeToggle: () => ipcRenderer.invoke("pennyworth:window-maximize-toggle"),
  windowClose: () => ipcRenderer.invoke("pennyworth:window-close"),
  onSummoned: (handler) => ipcRenderer.on("pennyworth:summoned", handler),
  listSessions: () => ipcRenderer.invoke("pennyworth:list-sessions"),
  loadSession: (sessionId) => ipcRenderer.invoke("pennyworth:load-session", sessionId),
  newSession: () => ipcRenderer.invoke("pennyworth:new-session"),
  deleteSession: (sessionId) => ipcRenderer.invoke("pennyworth:delete-session", sessionId),
});
