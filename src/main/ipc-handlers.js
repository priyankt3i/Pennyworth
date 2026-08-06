const { ipcMain, desktopCapturer, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");

const { storeGet, storeSet, readStore, writeStore } = require("./store");
const { getStoredApiKey, setStoredApiKey, clearStoredApiKey, getVaultStatus, setupVault, unlockVault } = require("./vault");
const { getSessionFilePath, listSessions, loadSession, deleteSession } = require("./sessions");
const { checkOllamaRunning, startOllamaService, bootstrapOllama, bootstrapSetDefaultProvider } = require("./bootstrap");
const { getProviderState, saveProviderState, getProviderStateForUi, normalizeProviderState } = require("./provider-config");
const { listOllamaModels, listOpenAIModels, listGeminiModels, invalidateProviderHealthCache, getProviderHealth } = require("./health");
const { runtimeState, getAgentContextState } = require("./profiles");

const { getSystemContext } = require("../core/system-context");
const { retrieveContext } = require("../core/rag");
const { askWithFailover, cancelCurrentSession } = require("../core/providers");

const ROOT_DIR = path.resolve(__dirname, "../..");

function toErrorPayload(error, fallbackMessage) {
  const details = error?.message || String(error || "Unknown error");
  return {
    message: fallbackMessage,
    details,
  };
}

function getWindowFromEvent(event) {
  const { BrowserWindow } = require("electron");
  return BrowserWindow.fromWebContents(event.sender);
}

function registerIpcHandlers(getMainWindow) {
  ipcMain.handle("pennyworth:get-runtime-config", async () => {
    try {
      const state = runtimeState();
      const providerState = await getProviderStateForUi();

      return {
        ok: true,
        runtime: {
          profileId: state.profileId,
          profile: state.profile,
          profiles: state.distroConfig.profiles,
          providers: providerState,
          agentContext: state.agentContext,
          detection: state.detection,
          hostProfileName: state.hostProfileName,
          hostArchitecture: state.hostArchitecture,
          systemContext: state.systemContext,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: toErrorPayload(error, "Failed to load runtime configuration."),
      };
    }
  });

  ipcMain.handle("pennyworth:set-profile", async (_event, profileId) => {
    try {
      storeSet("activeProfileId", profileId);
      invalidateProviderHealthCache();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pennyworth:get-settings", async () => {
    try {
      const state = runtimeState();
      const providerState = await getProviderStateForUi();

      return {
        ok: true,
        detectedProfileId: state.detection.profileId,
        detectedProfileName: state.distroConfig.profiles[state.detection.profileId]?.name || state.detection.profileId,
        detectedArchitecture: state.hostArchitecture,
        detectionReason: state.detection.reason,
        targetProfileId: state.profileId,
        targetProfileName: state.profile?.name || state.profileId,
        providerConfig: providerState,
        agentContext: state.agentContext,
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pennyworth:get-provider-health", async (_event, payload) => {
    try {
      const force = Boolean(payload?.force);
      const result = await getProviderHealth({ force });
      return { ok: true, health: result.health, cached: result.cached };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pennyworth:list-ollama-models", async (_event, payload) => {
    try {
      const baseUrl = payload?.baseUrl || "http://127.0.0.1:11434";
      const models = await listOllamaModels(baseUrl);
      return { ok: true, models };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pennyworth:list-openai-models", async (_event, payload) => {
    try {
      const apiKey = payload?.apiKey || "";
      const models = await listOpenAIModels(apiKey);
      return { ok: true, models };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pennyworth:list-gemini-models", async (_event, payload) => {
    try {
      const apiKey = payload?.apiKey || "";
      const models = await listGeminiModels(apiKey);
      return { ok: true, models };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pennyworth:save-settings", async (_event, payload) => {
    try {
      if (payload?.agentContext) {
        storeSet("agentContext", payload.agentContext);
      }

      if (payload?.providerConfig) {
        saveProviderState(payload.providerConfig);
      }

      if (payload?.secrets) {
        const secrets = payload.secrets;
        if (secrets.openaiApiKey) {
          await setStoredApiKey("openai", secrets.openaiApiKey);
        } else if (secrets.clearOpenAI) {
          await clearStoredApiKey("openai");
        }

        if (secrets.geminiApiKey) {
          await setStoredApiKey("gemini", secrets.geminiApiKey);
        } else if (secrets.clearGemini) {
          await clearStoredApiKey("gemini");
        }
      }

      invalidateProviderHealthCache();

      const state = runtimeState();
      const providerState = await getProviderStateForUi();

      return {
        ok: true,
        detectedProfileId: state.detection.profileId,
        detectedProfileName: state.distroConfig.profiles[state.detection.profileId]?.name || state.detection.profileId,
        detectedArchitecture: state.hostArchitecture,
        targetProfileId: state.profileId,
        targetProfileName: state.profile?.name || state.profileId,
        providerConfig: providerState,
        agentContext: state.agentContext,
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pennyworth:get-system-context", async () => {
    try {
      const state = runtimeState();
      return { ok: true, systemContext: state.contextWithOverrides.systemContext };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pennyworth:list-displays", async () => {
    try {
      let displays = [];
      try {
        const { screen } = require("electron");
        const electronDisplays = screen.getAllDisplays();
        const primaryDisplay = screen.getPrimaryDisplay();
        const sources = await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: { width: 1, height: 1 }
        });
        displays = electronDisplays.map((d, index) => {
          const source = sources.find(s => String(s.display_id) === String(d.id)) || sources[index];
          const name = source ? source.name : `Display ${index + 1}`;
          return {
            id: d.id,
            name: name,
            primary: d.id === primaryDisplay.id
          };
        });
      } catch (electronError) {
        console.error("Electron native display detection failed, falling back to screenshot-desktop:", electronError);
        const screenshot = require("screenshot-desktop");
        const rawDisplays = await screenshot.listDisplays();
        displays = rawDisplays.map((d, index) => ({
          id: d.id,
          name: d.name || `Display ${index + 1}`,
          primary: index === 0
        }));
      }
      return { ok: true, displays };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pennyworth:capture-screen", async (_event, payload) => {
    try {
      const targetId = payload?.screenId || payload?.displayKey;
      let dataUri = null;
      let screenName = "default display";

      try {
        const { screen } = require("electron");
        const allDisplays = screen.getAllDisplays();
        
        let targetDisplay = null;
        let targetIndex = 0;
        
        if (targetId !== undefined && targetId !== null && targetId !== "") {
          const idx = allDisplays.findIndex(d => String(d.id) === String(targetId));
          if (idx !== -1) {
            targetDisplay = allDisplays[idx];
            targetIndex = idx;
          } else {
            const matchedIndex = String(targetId).match(/\d+/);
            if (matchedIndex) {
              const parsedIdx = parseInt(matchedIndex[0], 10);
              if (parsedIdx >= 0 && parsedIdx < allDisplays.length) {
                targetDisplay = allDisplays[parsedIdx];
                targetIndex = parsedIdx;
              }
            }
          }
        }
        
        if (!targetDisplay) {
          targetDisplay = screen.getPrimaryDisplay() || allDisplays[0];
          targetIndex = 0;
        }

        const { width, height } = targetDisplay.bounds;
        const scale = targetDisplay.scaleFactor || 1;

        const sources = await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: {
            width: Math.round(width * scale),
            height: Math.round(height * scale)
          }
        });

        let matchingSource = sources.find(s => String(s.display_id) === String(targetDisplay.id));
        if (!matchingSource) {
          matchingSource = sources[targetIndex] || sources[0];
        }

        if (matchingSource) {
          dataUri = matchingSource.thumbnail.toDataURL();
          screenName = matchingSource.name || `Display ${targetIndex + 1}`;
        } else {
          throw new Error("No desktopCapturer sources found");
        }
      } catch (electronError) {
        console.error("Electron desktopCapturer failed, falling back to screenshot-desktop:", electronError);
        const screenshot = require("screenshot-desktop");
        let options = { format: "png" };
        if (targetId !== undefined && targetId !== null && targetId !== "") {
          options.screen = targetId;
        }
        const imgBuffer = await screenshot(options);
        dataUri = `data:image/png;base64,${imgBuffer.toString("base64")}`;
        screenName = `Display ${targetId || "default"}`;
      }

      if (!dataUri) {
        throw new Error("Failed to capture screen from all methods");
      }

      return {
        ok: true,
        dataUri,
        imageDataUrl: dataUri,
        screenName
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pennyworth:ask", async (_event, payload) => {
    try {
      const providerConfig = getProviderState();
      const agentContext = getAgentContextState();
      const state = runtimeState();
      const systemContext = state.contextWithOverrides.systemContext;

      const userPrompt = String(payload?.question || "").trim();
      const history = Array.isArray(payload?.history) ? payload.history : [];
      const screenshotAttached = Boolean(payload?.screenshotAttached);
      const screenshotData = payload?.screenshotData || null;

      const openaiStoredKey = await getStoredApiKey("openai");
      const geminiStoredKey = await getStoredApiKey("gemini");
      const openaiApiKey = openaiStoredKey || process.env.OPENAI_API_KEY || "";
      const geminiApiKey = geminiStoredKey || process.env.GEMINI_API_KEY || "";

      const activeConfig = {
        ...providerConfig,
        providers: {
          ollama: { ...providerConfig.providers.ollama },
          openai: { ...providerConfig.providers.openai, apiKey: openaiApiKey },
          gemini: { ...providerConfig.providers.gemini, apiKey: geminiApiKey },
        },
      };

      const docsUsed = retrieveContext(ROOT_DIR, state.profileId, userPrompt);
      const mainWindow = getMainWindow();

      const result = await askWithFailover(activeConfig, {
        userPrompt,
        history,
        systemContext,
        agentContext,
        screenshotAttached,
        screenshotData,
        docsUsed,
        onTrace: (eventData) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("pennyworth:trace-event", eventData);
          }
        },
      });

      // Append assistant reply to session file on disk
      const sessionId = payload?.sessionId;
      if (sessionId) {
        const sessionFile = getSessionFilePath(sessionId);
        if (fs.existsSync(sessionFile)) {
          try {
            const data = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
            data.messages = data.messages || [];
            data.messages.push({ role: "user", content: userPrompt });
            data.messages.push({ role: "assistant", content: result.reply });
            data.updatedAt = new Date().toISOString();
            fs.writeFileSync(sessionFile, JSON.stringify(data, null, 2), "utf8");
          } catch (e) {
            console.error("Failed to append reply to session file:", e.message);
          }
        }
      }

      return {
        ok: true,
        provider: result.provider,
        reply: result.reply,
        toolTrace: result.toolTrace,
        docsUsed,
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pennyworth:cancel-agent", async () => {
    cancelCurrentSession();
    return { ok: true };
  });

  ipcMain.handle("pennyworth:window-minimize", async (event) => {
    try {
      const win = getWindowFromEvent(event);
      if (!win) throw new Error("Window is not available.");
      win.minimize();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pennyworth:window-maximize-toggle", async (event) => {
    try {
      const win = getWindowFromEvent(event);
      if (!win) throw new Error("Window is not available.");
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pennyworth:window-close", async (event) => {
    try {
      const win = getWindowFromEvent(event);
      if (!win) throw new Error("Window is not available.");
      win.close();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pennyworth:list-sessions", async () => {
    try {
      return { ok: true, sessions: listSessions() };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pennyworth:load-session", async (_event, sessionId) => {
    try {
      const session = loadSession(sessionId);
      if (session) {
        return { ok: true, session };
      }
      return { ok: false, error: "Session not found." };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pennyworth:new-session", async () => {
    try {
      const sessionId = crypto.randomUUID();
      const session = {
        id: sessionId,
        title: "Untitled Chat",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
      };
      fs.writeFileSync(getSessionFilePath(sessionId), JSON.stringify(session, null, 2), "utf8");
      return { ok: true, sessionId, session };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pennyworth:delete-session", async (_event, sessionId) => {
    try {
      const success = deleteSession(sessionId);
      return { ok: success };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pennyworth:vault-status", async () => {
    try {
      const status = getVaultStatus();
      return { ok: true, ...status };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pennyworth:vault-setup", async (_event, passphrase) => {
    try {
      const success = setupVault(passphrase);
      return { ok: success };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pennyworth:vault-unlock", async (_event, passphrase) => {
    try {
      const success = unlockVault(passphrase);
      return { ok: success };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pennyworth:bootstrap-ollama", async () => {
    return await bootstrapOllama();
  });

  ipcMain.handle("pennyworth:bootstrap-pull-model", async (event, modelName) => {
    try {
      const response = await axios.post("http://127.0.0.1:11434/api/pull", {
        name: modelName,
        stream: true
      }, {
        responseType: "stream",
        timeout: 600000 // 10 minutes timeout
      });

      const mainWindow = getMainWindow();

      response.data.on("data", (chunk) => {
        const lines = chunk.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("pennyworth:bootstrap-progress", data);
            }
          } catch (e) {
            // ignore parsing errors on raw stdout text chunks
          }
        }
      });

      await new Promise((resolve, reject) => {
        response.data.on("end", () => resolve());
        response.data.on("error", (err) => reject(err));
      });

      return { ok: true };
    } catch (error) {
      console.error("Bootstrap model pull failed:", error);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pennyworth:bootstrap-set-default-provider", async (_event, provider, model) => {
    try {
      return bootstrapSetDefaultProvider(provider, model);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}

module.exports = {
  registerIpcHandlers,
};
