process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, ipcMain, desktopCapturer } = require("electron");
const axios = require("axios");
const screenshot = require("screenshot-desktop");
const { exec, execSync } = require("child_process");

const { loadDistroConfig, loadProviderConfig } = require("./core/config");
const { getSystemContext } = require("./core/system-context");
const { retrieveContext } = require("./core/rag");
const { askWithFailover } = require("./core/providers");

const ROOT_DIR = path.resolve(__dirname, "..");
const KEYTAR_SERVICE = "pennyworth-desktop";
const ICON_PNG_PATH = path.join(ROOT_DIR, "public", "pennyworth.png");
const ICON_ICO_PATH = path.join(ROOT_DIR, "public", "pennyworth.ico");

let keytar = null;
try {
  keytar = require("keytar");
} catch (error) {
  keytar = null;
}

let mainWindow;
let tray;
let storeCache = null;
let storePath = null;
let providerHealthCache = null;
let providerHealthCacheAt = 0;
let providerHealthInFlight = null;

const PROVIDER_HEALTH_TTL_MS = 30_000;

function getStorePath() {
  if (storePath) {
    return storePath;
  }

  const userDataDir = app.getPath("userData");
  fs.mkdirSync(userDataDir, { recursive: true });
  storePath = path.join(userDataDir, "pennyworth-runtime.json");
  return storePath;
}

function readStore() {
  if (storeCache) {
    return storeCache;
  }

  try {
    const raw = fs.readFileSync(getStorePath(), "utf8");
    const clean = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const parsed = JSON.parse(clean);
    storeCache = parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error(`Failed to read runtime store: ${error.message}`);
    }
    storeCache = {};
  }

  return storeCache;
}

function writeStore(nextState) {
  storeCache = nextState;
  fs.writeFileSync(getStorePath(), JSON.stringify(nextState, null, 2), "utf8");
}

function storeGet(key, fallback = undefined) {
  const state = readStore();
  if (Object.prototype.hasOwnProperty.call(state, key)) {
    return state[key];
  }
  return fallback;
}

function storeSet(key, value) {
  const state = readStore();
  const nextState = {
    ...state,
    [key]: value,
  };
  writeStore(nextState);
}

function toErrorPayload(error, fallbackMessage) {
  const details = error?.message || String(error || "Unknown error");
  return {
    message: fallbackMessage,
    details,
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDisplays(displays) {
  if (!Array.isArray(displays)) {
    return [];
  }

  return displays.map((display, index) => ({
    id: display?.id,
    name: display?.name || display?.displayName || `Display ${index + 1}`,
    primary: Boolean(display?.primary),
  }));
}

async function listDisplaysSafe() {
  try {
    const displays = await screenshot.listDisplays();
    return normalizeDisplays(displays);
  } catch {
    return [];
  }
}

function normalizeScreenId(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return value;
}

function createIcon() {
  const preferred =
    process.platform === "win32"
      ? [ICON_ICO_PATH, ICON_PNG_PATH]
      : [ICON_PNG_PATH, ICON_ICO_PATH];

  for (const iconPath of preferred) {
    if (!fs.existsSync(iconPath)) {
      continue;
    }
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      return icon;
    }
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
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  if (typeof mainWindow.removeMenu === "function") {
    mainWindow.removeMenu();
  }

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
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

  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("pennyworth:summoned");
  }
}

function getWindowFromEvent(event) {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow && !senderWindow.isDestroyed()) {
    return senderWindow;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }
  return null;
}

function createTray() {
  tray = new Tray(createIcon());
  tray.setToolTip("Pennyworth - Your Linux Butler");
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

function normalizeProviderState(base, override) {
  const merged = {
    defaultProvider: override?.defaultProvider || base?.defaultProvider || "ollama",
    providers: {
      ollama: {
        ...base?.providers?.ollama,
        ...override?.providers?.ollama,
      },
      openai: {
        ...base?.providers?.openai,
        ...override?.providers?.openai,
      },
      gemini: {
        ...base?.providers?.gemini,
        ...override?.providers?.gemini,
      },
    },
  };

  merged.providers.ollama.enabled = Boolean(merged.providers.ollama.enabled);
  merged.providers.openai.enabled = Boolean(merged.providers.openai.enabled);
  merged.providers.gemini.enabled = Boolean(merged.providers.gemini.enabled);

  merged.providers.ollama.baseUrl =
    merged.providers.ollama.baseUrl || "http://127.0.0.1:11434";
  merged.providers.ollama.model = merged.providers.ollama.model || "llama3.2";
  merged.providers.openai.model = merged.providers.openai.model || "gpt-4o-mini";
  merged.providers.gemini.model = merged.providers.gemini.model || "gemini-2.0-flash";

  if (!merged.providers[merged.defaultProvider]) {
    merged.defaultProvider = "ollama";
  }

  const enabledProviders = Object.keys(merged.providers).filter(
    (providerName) => merged.providers[providerName].enabled
  );
  if (!enabledProviders.includes(merged.defaultProvider)) {
    merged.defaultProvider = enabledProviders[0] || merged.defaultProvider;
  }

  Object.keys(merged.providers).forEach((providerName) => {
    merged.providers[providerName].enabled = providerName === merged.defaultProvider;
  });

  return merged;
}

function getProviderState() {
  const base = loadProviderConfig(ROOT_DIR);
  const override = storeGet("providerConfig");
  return normalizeProviderState(base, override);
}

function saveProviderState(providerConfig) {
  const current = getProviderState();
  const next = normalizeProviderState(current, providerConfig);
  storeSet("providerConfig", next);
  return next;
}

async function checkOllamaRunning() {
  try {
    const res = await axios.get("http://127.0.0.1:11434/api/tags", { timeout: 2000 });
    return res.status === 200;
  } catch (e) {
    return false;
  }
}

async function startOllamaService() {
  const isWin = os.platform() === "win32";
  const isMac = os.platform() === "darwin";
  const isLinux = os.platform() === "linux";

  if (isWin) {
    const userLocal = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const ollamaPath = path.join(userLocal, "Programs", "Ollama", "ollama app.exe");
    if (fs.existsSync(ollamaPath)) {
      exec(`start "" "${ollamaPath}"`);
      await wait(3000);
      return true;
    }
  } else if (isMac) {
    if (fs.existsSync("/Applications/Ollama.app")) {
      exec("open /Applications/Ollama.app");
      await wait(3000);
      return true;
    }
  } else if (isLinux) {
    try {
      execSync("systemctl --user start ollama || sudo systemctl start ollama");
      await wait(3000);
      return true;
    } catch (e) {
      exec("ollama serve &");
      await wait(3000);
      return true;
    }
  }
  return false;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function bootstrapOllama() {
  const alreadyRunning = await checkOllamaRunning();
  if (alreadyRunning) {
    return { ok: true, message: "Ollama is already running." };
  }

  const started = await startOllamaService();
  if (started && await checkOllamaRunning()) {
    return { ok: true, message: "Ollama started successfully." };
  }

  const isWin = os.platform() === "win32";
  const isLinux = os.platform() === "linux";
  const isMac = os.platform() === "darwin";

  try {
    if (isWin) {
      try {
        execSync("winget --version");
      } catch (e) {
        throw new Error("winget package manager is not available. Please install Ollama manually from https://ollama.com");
      }
      
      execSync("winget install Ollama.Ollama --accept-package-agreements --accept-source-agreements --silent", { stdio: "ignore" });
      await startOllamaService();
      
      if (!(await checkOllamaRunning())) {
        throw new Error("Ollama installed but local service failed to start.");
      }
      return { ok: true, message: "Ollama installed and started successfully via winget." };
    } else if (isLinux) {
      execSync("curl -fsSL https://ollama.com/install.sh | sh", { stdio: "ignore" });
      await startOllamaService();
      
      if (!(await checkOllamaRunning())) {
        throw new Error("Ollama installed but service could not be started automatically.");
      }
      return { ok: true, message: "Ollama installed and started successfully." };
    } else if (isMac) {
      throw new Error("Automated installation is not supported on macOS yet. Please download and run the installer from https://ollama.com");
    } else {
      throw new Error(`Unsupported OS platform: ${os.platform()}`);
    }
  } catch (error) {
    console.error("Bootstrap installation failed:", error);
    return { ok: false, error: error.message };
  }
}

function getEncryptionKey() {
  const info = os.hostname() + os.arch() + os.platform() + (os.userInfo()?.username || "pennyworth");
  return crypto.createHash("sha256").update(info).digest();
}

function encrypt(text) {
  try {
    const iv = crypto.randomBytes(16);
    const key = getEncryptionKey();
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return `${iv.toString("hex")}:${encrypted}`;
  } catch (error) {
    console.error("Encryption failed:", error);
    return "";
  }
}

function decrypt(encryptedText) {
  try {
    const parts = encryptedText.split(":");
    if (parts.length !== 2) {
      return "";
    }
    const iv = Buffer.from(parts[0], "hex");
    const encrypted = parts[1];
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    console.error("Decryption failed:", error);
    return "";
  }
}

async function getStoredApiKey(account) {
  if (keytar) {
    try {
      const key = await keytar.getPassword(KEYTAR_SERVICE, account);
      if (key) return key;
    } catch (e) {
      console.warn("Keytar read failed, using fallback storage:", e.message);
    }
  }

  const encrypted = storeGet(`secret_${account}`);
  if (encrypted) {
    return decrypt(encrypted);
  }
  return "";
}

async function setStoredApiKey(account, value) {
  if (keytar) {
    try {
      await keytar.setPassword(KEYTAR_SERVICE, account, value);
      storeSet(`secret_${account}`, undefined);
      return;
    } catch (e) {
      console.warn("Keytar write failed, using fallback storage:", e.message);
    }
  }

  const encrypted = encrypt(value);
  storeSet(`secret_${account}`, encrypted);
}

async function clearStoredApiKey(account) {
  if (keytar) {
    try {
      await keytar.deletePassword(KEYTAR_SERVICE, account);
    } catch (e) {
      console.warn("Keytar clear failed:", e.message);
    }
  }
  storeSet(`secret_${account}`, undefined);
}

function hasEnvKeyForProvider(providerName) {
  if (providerName === "openai") {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  if (providerName === "gemini") {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  return false;
}

async function getProviderStateForUi() {
  const providerState = getProviderState();
  const openaiStored = Boolean(await getStoredApiKey("openai"));
  const geminiStored = Boolean(await getStoredApiKey("gemini"));

  return {
    secureStorageAvailable: Boolean(keytar),
    defaultProvider: providerState.defaultProvider,
    providers: {
      ollama: {
        enabled: providerState.providers.ollama.enabled,
        baseUrl: providerState.providers.ollama.baseUrl,
        model: providerState.providers.ollama.model,
      },
      openai: {
        enabled: providerState.providers.openai.enabled,
        model: providerState.providers.openai.model,
        hasApiKey: openaiStored || hasEnvKeyForProvider("openai"),
      },
      gemini: {
        enabled: providerState.providers.gemini.enabled,
        model: providerState.providers.gemini.model,
        hasApiKey: geminiStored || hasEnvKeyForProvider("gemini"),
      },
    },
  };
}

async function getProviderStateForAsk() {
  const providerState = getProviderState();
  const openaiApiKey = await getStoredApiKey("openai");
  const geminiApiKey = await getStoredApiKey("gemini");

  if (openaiApiKey) {
    providerState.providers.openai.apiKey = openaiApiKey;
  }

  if (geminiApiKey) {
    providerState.providers.gemini.apiKey = geminiApiKey;
  }

  return providerState;
}

function toProviderErrorMessage(error) {
  const status = error?.response?.status;
  const apiMessage =
    error?.response?.data?.error?.message ||
    error?.response?.data?.error ||
    error?.response?.data?.message;

  if (status && apiMessage) {
    return `HTTP ${status}: ${String(apiMessage)}`;
  }
  if (status) {
    return `HTTP ${status}`;
  }
  if (error?.code) {
    return String(error.code);
  }
  return error?.message || "Connection failed";
}

function normalizeOllamaBaseUrl(baseUrl) {
  const raw = String(baseUrl || "http://127.0.0.1:11434").trim();
  return raw.replace(/\/+$/, "");
}

async function listOllamaModels(baseUrl) {
  const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
  const response = await axios.get(`${normalizedBaseUrl}/api/tags`, { timeout: 5000 });
  const models = Array.isArray(response?.data?.models) ? response.data.models : [];

  const names = Array.from(
    new Set(
      models
        .map((model) => String(model?.name || "").trim())
        .filter(Boolean)
    )
  );

  return names;
}

async function checkOllamaHealth(config) {
  if (!config?.enabled) {
    return { state: "disabled", connected: false, message: "Disabled in settings." };
  }

  const baseUrl = String(config.baseUrl || "http://127.0.0.1:11434").replace(/\/+$/, "");
  try {
    await axios.get(`${baseUrl}/api/tags`, { timeout: 4000 });
    return { state: "connected", connected: true, message: "Connected." };
  } catch (error) {
    return {
      state: "error",
      connected: false,
      message: toProviderErrorMessage(error),
    };
  }
}

async function checkOpenAIHealth(config, apiKey) {
  if (!config?.enabled) {
    return { state: "disabled", connected: false, message: "Disabled in settings." };
  }
  if (!apiKey) {
    return { state: "not_configured", connected: false, message: "Missing API key." };
  }

  try {
    await axios.get("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 5000,
    });
    return { state: "connected", connected: true, message: "Connected." };
  } catch (error) {
    return {
      state: "error",
      connected: false,
      message: toProviderErrorMessage(error),
    };
  }
}

async function checkGeminiHealth(config, apiKey) {
  if (!config?.enabled) {
    return { state: "disabled", connected: false, message: "Disabled in settings." };
  }
  if (!apiKey) {
    return { state: "not_configured", connected: false, message: "Missing API key." };
  }

  try {
    await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
      timeout: 5000,
    });
    return { state: "connected", connected: true, message: "Connected." };
  } catch (error) {
    return {
      state: "error",
      connected: false,
      message: toProviderErrorMessage(error),
    };
  }
}

function invalidateProviderHealthCache() {
  providerHealthCache = null;
  providerHealthCacheAt = 0;
}

async function fetchProviderHealth() {
  const providerState = getProviderState();
  const openaiStoredKey = await getStoredApiKey("openai");
  const geminiStoredKey = await getStoredApiKey("gemini");
  const openaiApiKey = openaiStoredKey || process.env.OPENAI_API_KEY || "";
  const geminiApiKey = geminiStoredKey || process.env.GEMINI_API_KEY || "";

  const [ollama, openai, gemini] = await Promise.all([
    checkOllamaHealth(providerState.providers.ollama),
    checkOpenAIHealth(providerState.providers.openai, openaiApiKey),
    checkGeminiHealth(providerState.providers.gemini, geminiApiKey),
  ]);

  return { ollama, openai, gemini };
}

async function getProviderHealth(options = {}) {
  const force = Boolean(options?.force);
  const ttlMs = Number(options?.ttlMs) > 0 ? Number(options.ttlMs) : PROVIDER_HEALTH_TTL_MS;
  const ageMs = Date.now() - providerHealthCacheAt;

  if (!force && providerHealthCache && ageMs < ttlMs) {
    return {
      health: providerHealthCache,
      cached: true,
      stale: false,
      ageMs,
    };
  }

  if (providerHealthInFlight) {
    return providerHealthInFlight;
  }

  providerHealthInFlight = (async () => {
    try {
      const health = await fetchProviderHealth();
      providerHealthCache = health;
      providerHealthCacheAt = Date.now();
      return {
        health,
        cached: false,
        stale: false,
        ageMs: 0,
      };
    } catch (error) {
      if (providerHealthCache) {
        return {
          health: providerHealthCache,
          cached: true,
          stale: true,
          ageMs: Date.now() - providerHealthCacheAt,
        };
      }
      throw error;
    } finally {
      providerHealthInFlight = null;
    }
  })();

  return providerHealthInFlight;
}
function normalizeAgentContext(input) {
  return {
    docsRootUrlOverride: String(input?.docsRootUrlOverride || "").trim(),
    allowIpLocation: Boolean(input?.allowIpLocation),
    devMode: Boolean(input?.devMode),
  };
}

function getAgentContextState() {
  const raw = storeGet("agentContext", {});
  return normalizeAgentContext(raw);
}

function saveAgentContextState(agentContext) {
  const normalized = normalizeAgentContext(agentContext);
  storeSet("agentContext", normalized);
  return normalized;
}

function normalizeArchLabel(arch) {
  const value = String(arch || "")
    .trim()
    .toLowerCase();
  if (value === "x64" || value === "amd64") {
    return "x86_64";
  }
  if (value === "arm64") {
    return "aarch64";
  }
  return value || "unknown";
}

function autoDetectProfileId(distroConfig, systemContext) {
  const profiles = distroConfig?.profiles || {};
  const keys = Object.keys(profiles);
  const fallbackId = distroConfig?.defaultProfile || keys[0];
  const fallbackName = profiles?.[fallbackId]?.name || fallbackId;

  if (!keys.length) {
    throw new Error("No distro profiles are configured.");
  }

  if (systemContext.platform === "win32") {
    const prettyName = String(systemContext?.distro?.prettyName || "").toLowerCase();
    const name = String(systemContext?.distro?.name || "").toLowerCase();

    let targetId = "windows_11";
    if (prettyName.includes("server 2025") || name.includes("server 2025")) {
      targetId = "windows_server_2025";
    } else if (prettyName.includes("windows 10") || name.includes("windows 10")) {
      targetId = "windows_10";
    }

    const matchedName = profiles?.[targetId]?.name || targetId;
    return {
      profileId: targetId,
      reason: `Windows system context resolved. Selected target profile: '${matchedName}'.`,
    };
  }

  if (systemContext.platform === "darwin") {
    const prettyName = String(systemContext?.distro?.prettyName || "").toLowerCase();
    const name = String(systemContext?.distro?.name || "").toLowerCase();

    let targetId = "macos_sequoia";
    if (prettyName.includes("tahoe") || prettyName.includes("16.") || name.includes("tahoe")) {
      targetId = "macos_tahoe";
    }

    const matchedName = profiles?.[targetId]?.name || targetId;
    return {
      profileId: targetId,
      reason: `macOS system context resolved. Selected target profile: '${matchedName}'.`,
    };
  }

  if (systemContext.platform !== "linux") {
    return {
      profileId: fallbackId,
      reason: `Non-Linux host (${systemContext.platform}) detected. Auto target profile: '${fallbackName}'.`,
    };
  }

  const distroId = String(systemContext?.distro?.id || "unknown").toLowerCase();
  const distroIdLike = (systemContext?.distro?.idLike || []).map((x) => String(x).toLowerCase());
  const detectedArch = normalizeArchLabel(systemContext?.arch);
  const pkgPresence = systemContext?.packageManagersPresent || {};

  let best = {
    profileId: fallbackId,
    score: -999,
    reason: `No strong match; using default profile '${fallbackId}'.`,
  };

  for (const profileId of keys) {
    const profile = profiles[profileId] || {};
    let score = 0;
    const reasons = [];
    const family = String(profile.family || "").toLowerCase();
    const profileName = String(profile.name || "").toLowerCase();
    const profileIdLower = profileId.toLowerCase();
    const supportedArch = (profile.architectures || []).map((x) => String(x).toLowerCase());
    const packageManagers = (profile.packageManagers || []).map((x) => String(x).toLowerCase());

    if (distroId === profileIdLower) {
      score += 40;
      reasons.push(`distro id '${distroId}' matched profile id`);
    } else if (profileName && profileName.includes(distroId)) {
      score += 30;
      reasons.push(`distro id '${distroId}' matched profile name`);
    }

    if (family && distroIdLike.includes(family)) {
      score += 18;
      reasons.push(`ID_LIKE matched family '${family}'`);
    }
    if (distroIdLike.includes(profileIdLower)) {
      score += 16;
      reasons.push(`ID_LIKE matched profile '${profileIdLower}'`);
    }

    const matchingPkg = packageManagers.filter((pm) => Boolean(pkgPresence[pm]));
    if (matchingPkg.length) {
      score += matchingPkg.length * 7;
      reasons.push(`package manager match (${matchingPkg.join(", ")})`);
    }

    if (supportedArch.includes(detectedArch)) {
      score += 6;
      reasons.push(`architecture '${detectedArch}' supported`);
    } else if (supportedArch.length) {
      score -= 4;
    }

    if (score > best.score) {
      best = {
        profileId,
        score,
        reason: reasons.join("; ") || "best candidate",
      };
    }
  }

  return {
    profileId: best.profileId,
    reason: best.reason,
  };
}

function applyAgentOverrides(systemContext, profile, agentContext) {
  const outputSystemContext = {
    ...systemContext,
  };
  const outputProfile = {
    ...profile,
    documentation: {
      ...(profile?.documentation || {}),
    },
  };

  if (agentContext.docsRootUrlOverride) {
    outputProfile.documentation.rootUrl = agentContext.docsRootUrlOverride;
  }

  outputSystemContext.agentOverrides = {
    docsRootUrlOverride: agentContext.docsRootUrlOverride || null,
    allowIpLocation: Boolean(agentContext.allowIpLocation),
    devMode: Boolean(agentContext.devMode),
  };

  return {
    systemContext: outputSystemContext,
    profile: outputProfile,
  };
}

function runtimeState() {
  const distroConfig = loadDistroConfig(ROOT_DIR);
  const systemContext = getSystemContext();
  const detection = autoDetectProfileId(distroConfig, systemContext);
  const profileId = detection.profileId;
  const agentContext = getAgentContextState();
  const profile = distroConfig.profiles[profileId];
  const contextWithOverrides = applyAgentOverrides(systemContext, profile, agentContext);

  return {
    distroConfig,
    profileId,
    profile,
    agentContext,
    detection,
    systemContext,
    contextWithOverrides,
    hostProfileName: systemContext?.distro?.prettyName || systemContext.platform,
    hostArchitecture: systemContext.arch,
  };
}

const SESSIONS_DIR = path.join(app.getPath("userData"), "sessions");
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

function getSessionFilePath(sessionId) {
  return path.join(SESSIONS_DIR, `${sessionId}.json`);
}

function listSessions() {
  try {
    const files = fs.readdirSync(SESSIONS_DIR);
    const list = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = fs.readFileSync(path.join(SESSIONS_DIR, file), "utf8");
        const parsed = JSON.parse(raw);
        list.push({
          id: parsed.id,
          title: parsed.title || "Untitled Chat",
          createdAt: parsed.createdAt,
          updatedAt: parsed.updatedAt || parsed.createdAt,
        });
      } catch (e) {
        console.warn(`Failed to parse session file ${file}:`, e.message);
      }
    }
    return list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  } catch (error) {
    console.error("Failed to list sessions:", error);
    return [];
  }
}

function loadSession(sessionId) {
  try {
    const filePath = getSessionFilePath(sessionId);
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      return JSON.parse(raw);
    }
  } catch (error) {
    console.error(`Failed to load session ${sessionId}:`, error);
  }
  return null;
}

function saveSessionMessage(sessionId, messagePayload) {
  try {
    const filePath = getSessionFilePath(sessionId);
    let session = {
      id: sessionId,
      title: "Untitled Chat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    if (fs.existsSync(filePath)) {
      session = JSON.parse(fs.readFileSync(filePath, "utf8"));
    }

    session.messages.push(messagePayload);
    session.updatedAt = new Date().toISOString();

    if (session.title === "Untitled Chat" && messagePayload.role === "user") {
      const prompt = messagePayload.content;
      session.title = prompt.length > 30 ? `${prompt.slice(0, 30)}...` : prompt;
    }

    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), "utf8");
    return session;
  } catch (error) {
    console.error(`Failed to save message for session ${sessionId}:`, error);
    return null;
  }
}

function deleteSession(sessionId) {
  try {
    const filePath = getSessionFilePath(sessionId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (error) {
    console.error(`Failed to delete session ${sessionId}:`, error);
  }
  return false;
}

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

ipcMain.handle("pennyworth:bootstrap-ollama", async () => {
  return await bootstrapOllama();
});

ipcMain.handle("pennyworth:bootstrap-pull-model", async (_event, modelName) => {
  try {
    const response = await axios.post("http://127.0.0.1:11434/api/pull", {
      name: modelName,
      stream: true
    }, {
      responseType: "stream",
      timeout: 600000 // 10 minutes timeout
    });

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

function bootstrapSetDefaultProvider(provider, model) {
  const providerState = {
    defaultProvider: provider,
    providers: {
      ollama: {
        enabled: true,
        model: model,
      }
    }
  };
  saveProviderState(providerState);
  return { ok: true };
}

ipcMain.handle("pennyworth:bootstrap-set-default-provider", async (_event, provider, model) => {
  try {
    return bootstrapSetDefaultProvider(provider, model);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

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

ipcMain.handle("pennyworth:window-minimize", async (event) => {
  try {
    const win = getWindowFromEvent(event);
    if (!win) {
      throw new Error("Window is not available.");
    }
    win.minimize();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: toErrorPayload(error, "Failed to minimize window."),
    };
  }
});

ipcMain.handle("pennyworth:window-maximize-toggle", async (event) => {
  try {
    const win = getWindowFromEvent(event);
    if (!win) {
      throw new Error("Window is not available.");
    }
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
    return { ok: true, maximized: win.isMaximized() };
  } catch (error) {
    return {
      ok: false,
      error: toErrorPayload(error, "Failed to change window size."),
    };
  }
});

ipcMain.handle("pennyworth:window-close", async (event) => {
  try {
    const win = getWindowFromEvent(event);
    if (!win) {
      throw new Error("Window is not available.");
    }
    win.hide();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: toErrorPayload(error, "Failed to close window."),
    };
  }
});

ipcMain.handle("pennyworth:set-profile", async (_event, profileId) => {
  return {
    ok: false,
    error: {
      message: "Manual profile selection is disabled.",
      details: `Profile '${profileId}' was ignored. Pennyworth now auto-detects profile and architecture.`,
    },
  };
});

ipcMain.handle("pennyworth:get-settings", async () => {
  try {
    const state = runtimeState();
    const providerState = await getProviderStateForUi();
    return {
      ok: true,
      providerConfig: providerState,
      profiles: state.distroConfig.profiles,
      detectedProfileId: state.profileId,
      detectedProfileName: state.hostProfileName,
      detectedArchitecture: state.hostArchitecture,
      targetProfileName: state.profile?.name || state.profileId,
      targetProfileId: state.profileId,
      detectionReason: state.detection.reason,
      agentContext: state.agentContext,
    };
  } catch (error) {
    return {
      ok: false,
      error: toErrorPayload(error, "Failed to load settings."),
    };
  }
});

ipcMain.handle("pennyworth:get-provider-health", async (_event, payload) => {
  try {
    const result = await getProviderHealth(payload || {});
    return {
      ok: true,
      health: result.health,
      cached: Boolean(result.cached),
      stale: Boolean(result.stale),
      ageMs: result.ageMs || 0,
    };
  } catch (error) {
    return {
      ok: false,
      error: toErrorPayload(error, "Failed to check provider connectivity."),
    };
  }
});

ipcMain.handle("pennyworth:list-ollama-models", async (_event, payload) => {
  try {
    const names = await listOllamaModels(payload?.baseUrl);
    return {
      ok: true,
      models: names,
    };
  } catch (error) {
    return {
      ok: false,
      error: toErrorPayload(error, "Failed to load Ollama models."),
    };
  }
});

ipcMain.handle("pennyworth:save-settings", async (_event, payload) => {
  try {
    const body = payload || {};
    const warnings = [];
    const savedAgentContext = saveAgentContextState(body.agentContext || {});

    saveProviderState(body.providerConfig);

    const openaiApiKey = (body?.secrets?.openaiApiKey || "").trim();
    const geminiApiKey = (body?.secrets?.geminiApiKey || "").trim();
    const clearOpenAI = Boolean(body?.secrets?.clearOpenAI);
    const clearGemini = Boolean(body?.secrets?.clearGemini);

    if (openaiApiKey) {
      try {
        await setStoredApiKey("openai", openaiApiKey);
      } catch (error) {
        warnings.push(error.message);
      }
    } else if (clearOpenAI) {
      try {
        await clearStoredApiKey("openai");
      } catch (error) {
        warnings.push(error.message);
      }
    }

    if (geminiApiKey) {
      try {
        await setStoredApiKey("gemini", geminiApiKey);
      } catch (error) {
        warnings.push(error.message);
      }
    } else if (clearGemini) {
      try {
        await clearStoredApiKey("gemini");
      } catch (error) {
        warnings.push(error.message);
      }
    }

    invalidateProviderHealthCache();
    const stateAfterSave = runtimeState();
    return {
      ok: true,
      providerConfig: await getProviderStateForUi(),
      profiles: stateAfterSave.distroConfig.profiles,
      detectedProfileId: stateAfterSave.profileId,
      detectedProfileName: stateAfterSave.hostProfileName,
      detectedArchitecture: stateAfterSave.hostArchitecture,
      targetProfileName: stateAfterSave.profile?.name || stateAfterSave.profileId,
      targetProfileId: stateAfterSave.profileId,
      detectionReason: stateAfterSave.detection.reason,
      agentContext: savedAgentContext,
      warnings,
    };
  } catch (error) {
    return {
      ok: false,
      error: toErrorPayload(error, "Failed to save settings."),
    };
  }
});

ipcMain.handle("pennyworth:get-system-context", async () => {
  try {
    return {
      ok: true,
      systemContext: getSystemContext(),
    };
  } catch (error) {
    return {
      ok: false,
      error: toErrorPayload(error, "Failed to read system context."),
    };
  }
});

ipcMain.handle("pennyworth:list-displays", async () => {
  try {
    const displays = await listDisplaysSafe();
    return {
      ok: true,
      displays,
    };
  } catch (error) {
    return {
      ok: false,
      error: toErrorPayload(error, "Failed to detect displays."),
    };
  }
});

ipcMain.handle("pennyworth:capture-screen", async (_event, payload) => {
  const requestedScreenId = normalizeScreenId(payload?.screenId);
  const wasVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());

  try {
    const displays = await listDisplaysSafe();
    const selectedDisplay = displays.find((display) => String(display.id) === String(requestedScreenId));

    if (wasVisible) {
      mainWindow.hide();
      await wait(220);
    }

    const captureOptions = { format: "png" };
    if (requestedScreenId !== null) {
      captureOptions.screen = requestedScreenId;
    }

    let image;
    let warning = null;
    try {
      image = await screenshot(captureOptions);
    } catch (error) {
      // First fallback: try default display if specific display failed
      try {
        if (requestedScreenId !== null) {
          image = await screenshot({ format: "png" });
          warning = `Display-specific capture failed for '${requestedScreenId}'. Captured default display instead.`;
        } else {
          throw error;
        }
      } catch (innerError) {
        // Second fallback: try Electron desktopCapturer (Wayland support)
        console.log("Screenshot library failed, attempting Electron desktopCapturer fallback...", innerError.message);
        
        try {
          const sources = await desktopCapturer.getSources({ 
            types: ['screen'],
            thumbnailSize: { width: 1920, height: 1080 }, // Set reasonable default size, will scale
            fetchWindowIcons: false
          });

          let source = sources.find(s => String(s.display_id) === String(requestedScreenId));
          if (!source) {
            source = sources[0]; // Default to first screen if specific one not found
            if (requestedScreenId) {
               warning = `Display-specific capture failed for '${requestedScreenId}'. Captured primary display instead via fallback.`;
            }
          }

          if (!source) {
             throw new Error("No screen sources available via desktopCapturer");
          }

          // Re-fetch with higher resolution if possible or just use what we have
          // For now, just use the thumbnail as the screenshot
          // Note: thumbnail size is limited by Electron, but usually sufficient for chat context
          image = source.thumbnail.toPNG();
          
          if (!warning) {
             // Only add warning if we haven't already added one about display mismatch
             // warning = "Used fallback capture method (Wayland compatibility mode)"; 
             // (Optional: don't show warning if it works, transparency is better)
          }
        } catch (captureError) {
           console.error("All screenshot methods failed:", captureError);
           throw error; // Throw the original error from the library to show xrandr issue if fallback also fails
        }
      }
    }

    return {
      ok: true,
      imageDataUrl: `data:image/png;base64,${image.toString("base64")}`,
      screenId: selectedDisplay?.id ?? requestedScreenId,
      screenName: selectedDisplay?.name || null,
      warning,
    };
  } catch (error) {
    return {
      ok: false,
      error: toErrorPayload(error, "Failed to capture screenshot."),
    };
  } finally {
    if (wasVisible && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }
});

ipcMain.handle("pennyworth:cancel-agent", async () => {
  try {
    const providers = require("./core/providers");
    providers.cancelCurrentSession();
    return { ok: true };
  } catch (error) {
    console.error("Failed to cancel agent session:", error);
    return { ok: false, error: error.message };
  }
});



ipcMain.handle("pennyworth:ask", async (_event, payload) => {
  const { question, history = [], screenshotAttached = false, screenshotData = null, sessionId } = payload || {};
  if (!question || !question.trim()) {
    return {
      ok: false,
      error: {
        message: "Question is required.",
        details: "Prompt was empty.",
      },
    };
  }

  try {
    const state = runtimeState();
    const providerState = await getProviderStateForAsk();
    const retrievedDocs = retrieveContext(ROOT_DIR, state.profileId, question);

    let memories = [];
    try {
      const memoryFilePath = path.join(app.getPath("userData"), "pennyworth-memory.json");
      if (fs.existsSync(memoryFilePath)) {
        memories = JSON.parse(fs.readFileSync(memoryFilePath, "utf8"));
      }
    } catch (e) {
      console.warn("Failed to load memory file for prompt injection:", e.message);
    }

    if (sessionId) {
      saveSessionMessage(sessionId, { role: "user", content: question });
    }

    const answer = await askWithFailover(providerState, {
      userPrompt: question,
      history,
      screenshotAttached,
      screenshotData,
      systemContext: state.contextWithOverrides.systemContext,
      agentContext: state.agentContext,
      distroProfile: state.contextWithOverrides.profile,
      retrievedDocs,
      memories,
    });

    if (sessionId) {
      saveSessionMessage(sessionId, { role: "assistant", content: answer.reply });
    }

    return {
      ok: true,
      profileId: state.profileId,
      provider: answer.provider,
      reply: answer.reply,
      docsUsed: retrievedDocs,
      toolTrace: answer.toolTrace || [],
    };
  } catch (error) {
    return {
      ok: false,
      error: toErrorPayload(error, "Failed to generate response."),
    };
  }
});

if (process.env.NODE_ENV !== "test") {
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
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}

if (process.env.NODE_ENV === "test") {
  module.exports = {
    autoDetectProfileId,
    encrypt,
    decrypt,
    getStoredApiKey,
    setStoredApiKey,
    clearStoredApiKey,
    storeGet,
    storeSet,
    bootstrapOllama: typeof bootstrapOllama !== "undefined" ? bootstrapOllama : undefined,
    bootstrapSetDefaultProvider: typeof bootstrapSetDefaultProvider !== "undefined" ? bootstrapSetDefaultProvider : undefined,
  };
}




