const { ipcMain, desktopCapturer, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");

const { storeGet, storeSet } = require("./store");
const { getStoredApiKey, setStoredApiKey, clearStoredApiKey, getVaultStatus, setupVault, unlockVault } = require("./vault");
const { getSessionFilePath, listSessions, loadSession, deleteSession } = require("./sessions");
const { bootstrapOllama, bootstrapSetDefaultProvider } = require("./bootstrap");
const { getProviderState, saveProviderState, getProviderStateForUi } = require("./provider-config");
const { listOllamaModels, listOpenAIModels, listGeminiModels, invalidateProviderHealthCache, getProviderHealth } = require("./health");
const { runtimeState, getAgentContextState } = require("./profiles");
const { transcribeLocalPcm, terminateWorker } = require("./local-whisper");

const MAX_STREAM_SAMPLES = 80000; // 5 seconds max window at 16kHz for fast inference
const MIN_TRANSCRIPTION_SAMPLES = 12000; // 0.75 seconds minimum to attempt live whisper

let liveStreamPcmBuffer = new Float32Array(0);
let isTranscribingStream = false;
let lastTranscribedText = "";

ipcMain.on("pennyworth:audio-stream-chunk", async (event, payload) => {
  try {
    const { pcmSamples } = payload || {};
    if (!pcmSamples) return;

    let incoming;
    if (pcmSamples instanceof Float32Array) {
      incoming = pcmSamples;
    } else if (Array.isArray(pcmSamples)) {
      incoming = new Float32Array(pcmSamples);
    } else if (Buffer.isBuffer(pcmSamples) || pcmSamples instanceof Uint8Array) {
      const ab = pcmSamples.buffer.slice(pcmSamples.byteOffset, pcmSamples.byteOffset + pcmSamples.byteLength);
      incoming = new Float32Array(ab);
    } else if (pcmSamples && typeof pcmSamples === "object") {
      const vals = Object.values(pcmSamples);
      incoming = Float32Array.from(vals);
    } else {
      incoming = new Float32Array(0);
    }

    if (incoming.length === 0) return;

    // Append to ring buffer, keeping at most MAX_STREAM_SAMPLES
    const newLen = liveStreamPcmBuffer.length + incoming.length;
    if (newLen <= MAX_STREAM_SAMPLES) {
      const temp = new Float32Array(newLen);
      temp.set(liveStreamPcmBuffer, 0);
      temp.set(incoming, liveStreamPcmBuffer.length);
      liveStreamPcmBuffer = temp;
    } else {
      const temp = new Float32Array(MAX_STREAM_SAMPLES);
      const keepOldCount = MAX_STREAM_SAMPLES - incoming.length;
      if (keepOldCount > 0) {
        temp.set(liveStreamPcmBuffer.subarray(liveStreamPcmBuffer.length - keepOldCount), 0);
        temp.set(incoming, keepOldCount);
      } else {
        temp.set(incoming.subarray(incoming.length - MAX_STREAM_SAMPLES), 0);
      }
      liveStreamPcmBuffer = temp;
    }

    // Trigger non-blocking live transcription if buffer is long enough and not currently busy
    if (!isTranscribingStream && liveStreamPcmBuffer.length >= MIN_TRANSCRIPTION_SAMPLES) {
      isTranscribingStream = true;
      const snapshot = new Float32Array(liveStreamPcmBuffer);

      transcribeLocalPcm(snapshot)
        .then((res) => {
          if (res.ok && res.text && res.text !== lastTranscribedText) {
            lastTranscribedText = res.text;
            if (event.sender && !event.sender.isDestroyed()) {
              event.sender.send("pennyworth:live-transcript-partial", { text: res.text });
            }
          }
        })
        .catch((err) => {
          console.warn("Live stream transcription chunk error:", err.message);
        })
        .finally(() => {
          isTranscribingStream = false;
        });
    }
  } catch (err) {
    console.warn("audio-stream-chunk error:", err.message);
  }
});

ipcMain.on("pennyworth:audio-stream-stop", async (event) => {
  try {
    if (liveStreamPcmBuffer.length > 0) {
      const snapshot = new Float32Array(liveStreamPcmBuffer);
      const res = await transcribeLocalPcm(snapshot);
      if (res.ok && res.text && event.sender && !event.sender.isDestroyed()) {
        event.sender.send("pennyworth:live-transcript-partial", { text: res.text, isFinal: true });
      }
    }
  } catch (err) {
    console.warn("audio-stream-stop error:", err.message);
  } finally {
    liveStreamPcmBuffer = new Float32Array(0);
    isTranscribingStream = false;
    lastTranscribedText = "";
  }
});

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

  ipcMain.handle("pennyworth:transcribe-audio", async (_event, payload) => {
    try {
      const { audioBuffer, mimeType = "audio/webm", pcmSamples } = payload || {};

      // 1. Local Whisper via Float32 PCM samples (CPU ONNX)
      if (pcmSamples && Array.isArray(pcmSamples) && pcmSamples.length > 0) {
        try {
          const floatArray = Float32Array.from(pcmSamples);
          const localRes = await transcribeLocalPcm(floatArray);
          if (localRes.ok && localRes.text) {
            return { ok: true, text: localRes.text, provider: "Local Whisper (Offline CPU)" };
          }
        } catch (err) {
          console.warn("Local PCM Whisper failed:", err.message);
        }
      }

      const buffer = audioBuffer ? Buffer.from(audioBuffer) : null;

      // 2. OpenAI Whisper
      const openaiStoredKey = await getStoredApiKey("openai");
      const openaiKey = openaiStoredKey || process.env.OPENAI_API_KEY || "";
      if (openaiKey && buffer) {
        try {
          const blob = new Blob([buffer], { type: mimeType });
          const formData = new FormData();
          formData.append("file", blob, "speech.webm");
          formData.append("model", "whisper-1");

          const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${openaiKey}` },
            body: formData,
          });

          if (response.ok) {
            const data = await response.json();
            if (data.text) return { ok: true, text: data.text, provider: "OpenAI Whisper" };
          }
        } catch (err) {
          console.warn("OpenAI Whisper transcription failed:", err.message);
        }
      }

      // 3. Groq Whisper
      const groqKey = process.env.GROQ_API_KEY || "";
      if (groqKey && buffer) {
        try {
          const blob = new Blob([buffer], { type: mimeType });
          const formData = new FormData();
          formData.append("file", blob, "speech.webm");
          formData.append("model", "whisper-large-v3-turbo");

          const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${groqKey}` },
            body: formData,
          });

          if (response.ok) {
            const data = await response.json();
            if (data.text) return { ok: true, text: data.text, provider: "Groq Whisper" };
          }
        } catch (err) {
          console.warn("Groq Whisper transcription failed:", err.message);
        }
      }

      // 4. Gemini Audio Transcription
      const geminiStoredKey = await getStoredApiKey("gemini");
      const geminiKey = geminiStoredKey || process.env.GEMINI_API_KEY || "";
      if (geminiKey && buffer) {
        try {
          const base64Audio = buffer.toString("base64");
          const cleanMime = (mimeType || "audio/webm").split(";")[0];
          const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { inlineData: { mimeType: cleanMime, data: base64Audio } },
                    { text: "Transcribe this spoken audio recording verbatim. Return only the transcript text without formatting, explanations, or quotes." }
                  ]
                }
              ]
            })
          });

          if (response.ok) {
            const data = await response.json();
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (text) return { ok: true, text, provider: "Gemini Audio" };
          }
        } catch (err) {
          console.warn("Gemini audio transcription failed:", err.message);
        }
      }

      // 5. Local / Custom Whisper Endpoint
      const whisperUrl = process.env.WHISPER_BASE_URL || "";
      if (whisperUrl && buffer) {
        try {
          const blob = new Blob([buffer], { type: mimeType });
          const formData = new FormData();
          formData.append("file", blob, "speech.webm");
          formData.append("model", "whisper-1");

          const endpoint = `${whisperUrl.replace(/\/+$/, "")}/v1/audio/transcriptions`;
          const response = await fetch(endpoint, {
            method: "POST",
            body: formData,
          });

          if (response.ok) {
            const data = await response.json();
            if (data.text) return { ok: true, text: data.text, provider: "Local Whisper Endpoint" };
          }
        } catch (err) {
          console.warn("Local Whisper transcription failed:", err.message);
        }
      }

      return {
        ok: false,
        error: "Speech-to-text requires audio recording. Ensure microphone access is allowed.",
      };
    } catch (error) {
      return { ok: false, error: error.message || "Failed to transcribe audio." };
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

  ipcMain.handle("pennyworth:show-native-notification", async (_event, payload) => {
    try {
      const { Notification } = require("electron");
      if (Notification && Notification.isSupported()) {
        const notification = new Notification({
          title: payload?.title || "Pennyworth",
          body: payload?.body || "",
        });
        notification.show();
        return { ok: true };
      }
      return { ok: false, error: "Native notifications not supported" };
    } catch (error) {
      console.error("Failed to show native notification:", error);
      return { ok: false, error: error.message };
    }
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
      let buffer = "";

      response.data.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
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
        response.data.on("end", () => {
          if (buffer.trim()) {
            try {
              const data = JSON.parse(buffer);
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send("pennyworth:bootstrap-progress", data);
              }
            } catch (e) {}
          }
          resolve();
        });
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
