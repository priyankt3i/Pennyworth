const state = {
  runtime: null,
  system: null,
  history: [],
  screenshotData: null,
  lastToolTrace: [],
  drawing: false,
  crop: null,
  settings: null,
};

const el = {
  chat: document.getElementById("chat"),
  profileBadge: document.getElementById("profileBadge"),
  providerBadge: document.getElementById("providerBadge"),
  profileSelect: document.getElementById("profileSelect"),
  tracePanel: document.getElementById("tracePanel"),
  traceContent: document.getElementById("traceContent"),
  captureBtn: document.getElementById("captureBtn"),
  voiceBtn: document.getElementById("voiceBtn"),
  sendBtn: document.getElementById("sendBtn"),
  promptInput: document.getElementById("promptInput"),
  status: document.getElementById("status"),
  loader: document.getElementById("loader"),
  capturePreview: document.getElementById("capturePreview"),
  captureImage: document.getElementById("captureImage"),
  clearCaptureBtn: document.getElementById("clearCaptureBtn"),
  cropModal: document.getElementById("cropModal"),
  cropCanvasWrap: document.getElementById("cropCanvasWrap"),
  cancelCropBtn: document.getElementById("cancelCropBtn"),
  confirmCropBtn: document.getElementById("confirmCropBtn"),
  subTitle: document.getElementById("subTitle"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsModal: document.getElementById("settingsModal"),
  detectedProfile: document.getElementById("detectedProfile"),
  detectedArch: document.getElementById("detectedArch"),
  detectionReason: document.getElementById("detectionReason"),
  docsRootOverride: document.getElementById("docsRootOverride"),
  allowIpLocation: document.getElementById("allowIpLocation"),
  devMode: document.getElementById("devMode"),
  defaultProviderSelect: document.getElementById("defaultProviderSelect"),
  ollamaEnabled: document.getElementById("ollamaEnabled"),
  ollamaBaseUrl: document.getElementById("ollamaBaseUrl"),
  ollamaModel: document.getElementById("ollamaModel"),
  openaiEnabled: document.getElementById("openaiEnabled"),
  openaiModel: document.getElementById("openaiModel"),
  openaiApiKey: document.getElementById("openaiApiKey"),
  clearOpenAI: document.getElementById("clearOpenAI"),
  geminiEnabled: document.getElementById("geminiEnabled"),
  geminiModel: document.getElementById("geminiModel"),
  geminiApiKey: document.getElementById("geminiApiKey"),
  clearGemini: document.getElementById("clearGemini"),
  ollamaStatus: document.getElementById("ollamaStatus"),
  openaiKeyStatus: document.getElementById("openaiKeyStatus"),
  geminiKeyStatus: document.getElementById("geminiKeyStatus"),
  cancelSettingsBtn: document.getElementById("cancelSettingsBtn"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
};

function setStatus(text, mode = "info") {
  el.status.textContent = text;
  el.status.style.fontWeight = "500";
  if (mode === "error") {
    el.status.style.color = "#ff9e94";
  } else if (mode === "ok") {
    el.status.style.color = "#0f6b2e";
    el.status.style.fontWeight = "700";
  } else {
    el.status.style.color = "";
  }
}

function showLoader(show) {
  el.loader.classList.toggle("hidden", !show);
}

function appendMessage(role, text, meta) {
  const wrapper = document.createElement("article");
  wrapper.className = `message ${role}`;

  const metaNode = document.createElement("div");
  metaNode.className = "message-meta";
  metaNode.textContent = meta || (role === "user" ? "You" : "Pennyworth");

  const content = document.createElement("div");
  content.className = "message-body";
  content.innerHTML = renderMarkdown(text);

  wrapper.appendChild(metaNode);
  wrapper.appendChild(content);
  el.chat.appendChild(wrapper);
  el.chat.scrollTop = el.chat.scrollHeight;
}

function escapeHtml(input) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderMarkdown(input) {
  let text = escapeHtml(input);
  const blocks = [];

  text = text.replace(/```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g, (_m, lang, code) => {
    const idx = blocks.length;
    const language = lang ? ` class=\"lang-${lang}\"` : "";
    blocks.push(`<pre><code${language}>${code}</code></pre>`);
    return `@@CODEBLOCK_${idx}@@`;
  });

  text = text.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*][\s\S]*?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|\s)\*([^*\n][\s\S]*?)\*(?=\s|$)/g, "$1<em>$2</em>");
  text = text.replace(/^###\s+(.+)$/gm, "<h4>$1</h4>");
  text = text.replace(/^##\s+(.+)$/gm, "<h3>$1</h3>");
  text = text.replace(/^#\s+(.+)$/gm, "<h2>$1</h2>");
  text = text.replace(/^\s*-\s+(.+)$/gm, "• $1");
  text = text.replace(/\n/g, "<br>");

  blocks.forEach((html, idx) => {
    text = text.replace(`@@CODEBLOCK_${idx}@@`, html);
  });

  return text;
}

function extractErrorText(errorLike, fallback = "Unexpected failure.") {
  if (!errorLike) {
    return fallback;
  }

  if (typeof errorLike === "string") {
    return errorLike;
  }

  const message = errorLike.message || fallback;
  const details = errorLike.details;

  if (details && details !== message) {
    return `${message} Details: ${details}`;
  }

  return message;
}

function assertOk(result, fallback) {
  if (!result?.ok) {
    throw new Error(extractErrorText(result?.error, fallback));
  }
  return result;
}

function reportFailure(context, errorLike, showInChat = false) {
  const message = `${context} ${extractErrorText(errorLike)}`;
  setStatus(message, "error");
  if (showInChat) {
    appendMessage("assistant", message, "System");
  }
}

function renderProfileSelect() {
  el.profileSelect.innerHTML = "";
  const option = document.createElement("option");
  option.value = state.runtime.profileId;
  option.textContent = `Auto target: ${state.runtime.profile.name}`;
  option.selected = true;
  el.profileSelect.appendChild(option);
}

function updateBadges(providerLabel = null) {
  const profile = state.runtime.profile;
  if (state.system.platform === "linux") {
    el.profileBadge.textContent = `${profile.name} | ${state.system.arch}`;
  } else {
    const host = state.system.distro?.name || state.system.platform;
    el.profileBadge.textContent = `Host: ${host} | Target: ${profile.name}`;
  }

  if (providerLabel) {
    el.providerBadge.textContent = `provider: ${providerLabel}`;
    return;
  }
  el.providerBadge.textContent = `default: ${state.runtime.providers.defaultProvider}`;
}

function isDevModeEnabled() {
  if (el.devMode) {
    return Boolean(el.devMode.checked);
  }
  return Boolean(state.runtime?.agentContext?.devMode);
}

function updateTracePanelVisibility() {
  if (!el.tracePanel || !el.traceContent) {
    return;
  }

  const show = isDevModeEnabled();
  el.tracePanel.classList.toggle("hidden", !show);

  if (show && (!Array.isArray(state.lastToolTrace) || !state.lastToolTrace.length)) {
    el.traceContent.textContent = "No tool calls captured yet.";
  }
}

function renderToolTrace(toolTrace, providerLabel = "") {
  if (!el.traceContent) {
    return;
  }

  state.lastToolTrace = Array.isArray(toolTrace) ? toolTrace : [];
  updateTracePanelVisibility();

  if (!isDevModeEnabled()) {
    return;
  }

  if (!state.lastToolTrace.length) {
    el.traceContent.textContent = "No tool calls captured yet.";
    return;
  }

  const lines = state.lastToolTrace.map((entry, idx) => {
    const timeText = entry?.at ? new Date(entry.at).toLocaleTimeString() : "--:--:--";
    const stage = entry?.stage || "event";
    const provider = entry?.provider || providerLabel || "unknown";
    const details = [];

    if (entry?.tool) {
      details.push(`tool=${entry.tool}`);
    }
    if (entry?.args) {
      details.push(`args=${entry.args}`);
    }
    if (entry?.result) {
      details.push(`result=${entry.result}`);
    }
    if (entry?.error) {
      details.push(`error=${entry.error}`);
    }
    if (entry?.text) {
      details.push(`text=${entry.text}`);
    }

    return [`#${idx + 1} ${timeText}`, `${provider}/${stage}`, ...details].join(" | ");
  });

  el.traceContent.textContent = lines.join("\n");
  el.traceContent.scrollTop = el.traceContent.scrollHeight;
}

async function loadRuntime() {
  const runtimeResult = assertOk(
    await window.pennyworth.getRuntimeConfig(),
    "Unable to load runtime configuration."
  );
  state.runtime = runtimeResult.runtime;

  const systemResult = assertOk(
    await window.pennyworth.getSystemContext(),
    "Unable to read system context."
  );
  state.system = systemResult.systemContext;

  renderProfileSelect();
  updateBadges();
  updateTracePanelVisibility();

  el.subTitle.textContent = `${state.system.distro.prettyName} | ${state.system.desktop} | kernel ${state.system.kernel} | auto profile ${state.runtime.profile.name}`;
}

function setCapturedImage(dataUrl) {
  state.screenshotData = dataUrl;
  if (!dataUrl) {
    el.capturePreview.classList.add("hidden");
    el.captureImage.src = "";
    return;
  }
  el.captureImage.src = dataUrl;
  el.capturePreview.classList.remove("hidden");
}

function createCropCanvas(imageDataUrl) {
  el.cropCanvasWrap.innerHTML = "";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const img = new Image();

  img.onload = () => {
    const maxW = 1280;
    const scale = Math.min(1, maxW / img.width);
    const width = Math.floor(img.width * scale);
    const height = Math.floor(img.height * scale);

    canvas.width = width;
    canvas.height = height;

    state.crop = {
      canvas,
      ctx,
      img,
      scale,
      selection: null,
      start: null,
    };

    redrawCropCanvas();
  };

  img.src = imageDataUrl;

  canvas.addEventListener("mousedown", onCropStart);
  canvas.addEventListener("mousemove", onCropMove);
  canvas.addEventListener("mouseup", onCropEnd);
  canvas.addEventListener("dblclick", confirmCropSelection);

  el.cropCanvasWrap.appendChild(canvas);
}

function cropPosition(event) {
  const rect = state.crop.canvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(state.crop.canvas.width, event.clientX - rect.left));
  const y = Math.max(0, Math.min(state.crop.canvas.height, event.clientY - rect.top));
  return { x, y };
}

function onCropStart(event) {
  if (!state.crop) {
    return;
  }
  state.drawing = true;
  state.crop.start = cropPosition(event);
  state.crop.selection = { x: state.crop.start.x, y: state.crop.start.y, w: 0, h: 0 };
  redrawCropCanvas();
}

function onCropMove(event) {
  if (!state.crop || !state.drawing) {
    return;
  }
  const current = cropPosition(event);
  const x = Math.min(state.crop.start.x, current.x);
  const y = Math.min(state.crop.start.y, current.y);
  const w = Math.abs(current.x - state.crop.start.x);
  const h = Math.abs(current.y - state.crop.start.y);

  state.crop.selection = { x, y, w, h };
  redrawCropCanvas();
}

function onCropEnd() {
  state.drawing = false;
}

function redrawCropCanvas() {
  if (!state.crop) {
    return;
  }

  const { canvas, ctx, img, selection } = state.crop;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  if (!selection || selection.w < 2 || selection.h < 2) {
    return;
  }

  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.drawImage(
    img,
    selection.x / state.crop.scale,
    selection.y / state.crop.scale,
    selection.w / state.crop.scale,
    selection.h / state.crop.scale,
    selection.x,
    selection.y,
    selection.w,
    selection.h
  );

  ctx.strokeStyle = "#f0cf78";
  ctx.lineWidth = 2;
  ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
}

function confirmCropSelection() {
  if (!state.crop || !state.crop.selection) {
    return;
  }

  const { img, selection, scale } = state.crop;
  if (selection.w < 2 || selection.h < 2) {
    return;
  }

  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.floor(selection.w / scale));
  out.height = Math.max(1, Math.floor(selection.h / scale));

  const outCtx = out.getContext("2d");
  outCtx.drawImage(
    img,
    selection.x / scale,
    selection.y / scale,
    selection.w / scale,
    selection.h / scale,
    0,
    0,
    out.width,
    out.height
  );

  setCapturedImage(out.toDataURL("image/png"));
  closeCropModal();
  setStatus("Attached selected screenshot region.", "ok");
}

function closeCropModal() {
  el.cropModal.classList.add("hidden");
  state.crop = null;
  state.drawing = false;
  el.cropCanvasWrap.innerHTML = "";
}

function setProviderStatusChip(node, label, health) {
  if (!node) {
    return;
  }

  node.classList.remove("status-ok", "status-fail", "status-warn", "status-off", "status-checking");

  if (!health) {
    node.textContent = `${label}: checking...`;
    node.classList.add("status-checking");
    return;
  }

  if (health.state === "connected") {
    node.textContent = `${label}: connected`;
    node.classList.add("status-ok");
    return;
  }

  if (health.state === "disabled") {
    node.textContent = `${label}: disabled`;
    node.classList.add("status-off");
    return;
  }

  if (health.state === "not_configured") {
    node.textContent = `${label}: missing key`;
    node.classList.add("status-warn");
    return;
  }

  if (health.state === "checking") {
    node.textContent = `${label}: checking...`;
    node.classList.add("status-checking");
    return;
  }

  node.textContent = `${label}: ${health.message || "not connected"}`;
  node.classList.add("status-fail");
}

function renderProviderSetupStatus(providerConfig) {
  setProviderStatusChip(el.ollamaStatus, "Ollama", null);
  setProviderStatusChip(el.openaiKeyStatus, "OpenAI", {
    state: providerConfig.providers.openai.hasApiKey ? "checking" : "not_configured",
    message: providerConfig.providers.openai.hasApiKey ? "checking..." : "missing key",
  });
  setProviderStatusChip(el.geminiKeyStatus, "Gemini", {
    state: providerConfig.providers.gemini.hasApiKey ? "checking" : "not_configured",
    message: providerConfig.providers.gemini.hasApiKey ? "checking..." : "missing key",
  });
}

async function refreshProviderHealth() {
  try {
    const result = assertOk(
      await window.pennyworth.getProviderHealth(),
      "Failed to check provider connectivity."
    );
    const health = result.health || {};
    setProviderStatusChip(el.ollamaStatus, "Ollama", health.ollama);
    setProviderStatusChip(el.openaiKeyStatus, "OpenAI", health.openai);
    setProviderStatusChip(el.geminiKeyStatus, "Gemini", health.gemini);
  } catch (error) {
    setProviderStatusChip(el.ollamaStatus, "Ollama", { state: "error", message: "health check failed" });
    setProviderStatusChip(el.openaiKeyStatus, "OpenAI", { state: "error", message: "health check failed" });
    setProviderStatusChip(el.geminiKeyStatus, "Gemini", { state: "error", message: "health check failed" });
    reportFailure("Provider health check failed:", error, false);
  }
}

function closeSettingsModal() {
  el.settingsModal.classList.add("hidden");
}

function populateSettingsForm(settingsPayload) {
  const providerConfig = settingsPayload.providerConfig;
  const agentContext = settingsPayload.agentContext || {};

  el.detectedProfile.value =
    settingsPayload.detectedProfileName || settingsPayload.detectedProfileId || "unknown";
  el.detectedArch.value = settingsPayload.detectedArchitecture || "unknown";
  const baseReason = settingsPayload.detectionReason || "No details available.";
  const targetName = settingsPayload.targetProfileName || settingsPayload.targetProfileId;
  el.detectionReason.value = targetName ? `${baseReason} Target: ${targetName}.` : baseReason;
  el.docsRootOverride.value = agentContext.docsRootUrlOverride || "";
  el.allowIpLocation.checked = Boolean(agentContext.allowIpLocation);
  if (el.devMode) {
    el.devMode.checked = Boolean(agentContext.devMode);
  }
  updateTracePanelVisibility();

  el.defaultProviderSelect.value = providerConfig.defaultProvider;
  el.ollamaEnabled.checked = providerConfig.providers.ollama.enabled;
  el.ollamaBaseUrl.value = providerConfig.providers.ollama.baseUrl;
  el.ollamaModel.value = providerConfig.providers.ollama.model;

  el.openaiEnabled.checked = providerConfig.providers.openai.enabled;
  el.openaiModel.value = providerConfig.providers.openai.model;
  el.openaiApiKey.value = "";
  el.clearOpenAI.checked = false;

  el.geminiEnabled.checked = providerConfig.providers.gemini.enabled;
  el.geminiModel.value = providerConfig.providers.gemini.model;
  el.geminiApiKey.value = "";
  el.clearGemini.checked = false;

  renderProviderSetupStatus(providerConfig);
}

async function openSettingsModal() {
  try {
    const result = assertOk(await window.pennyworth.getSettings(), "Failed to open settings.");

    state.settings = result;
    populateSettingsForm(result);
    el.settingsModal.classList.remove("hidden");

    setStatus(
      result.providerConfig.secureStorageAvailable
        ? "Settings opened."
        : "Settings opened. Secure keychain unavailable; API key save may fail.",
      result.providerConfig.secureStorageAvailable ? "ok" : "error"
    );
    await refreshProviderHealth();
  } catch (error) {
    reportFailure("Settings error:", error, true);
  }
}

async function saveSettings() {
  const payload = {
    agentContext: {
      docsRootUrlOverride: el.docsRootOverride.value.trim(),
      allowIpLocation: el.allowIpLocation.checked,
      devMode: Boolean(el.devMode?.checked),
    },
    providerConfig: {
      defaultProvider: el.defaultProviderSelect.value,
      providers: {
        ollama: {
          enabled: el.ollamaEnabled.checked,
          baseUrl: el.ollamaBaseUrl.value.trim(),
          model: el.ollamaModel.value.trim(),
        },
        openai: {
          enabled: el.openaiEnabled.checked,
          model: el.openaiModel.value.trim(),
        },
        gemini: {
          enabled: el.geminiEnabled.checked,
          model: el.geminiModel.value.trim(),
        },
      },
    },
    secrets: {
      openaiApiKey: el.openaiApiKey.value,
      geminiApiKey: el.geminiApiKey.value,
      clearOpenAI: el.clearOpenAI.checked,
      clearGemini: el.clearGemini.checked,
    },
  };

  try {
    const result = assertOk(await window.pennyworth.saveSettings(payload), "Failed to save settings.");

    state.settings = {
      providerConfig: result.providerConfig,
      detectedProfileId: result.detectedProfileId,
      detectedProfileName: result.detectedProfileName,
      detectedArchitecture: result.detectedArchitecture,
      detectionReason: result.detectionReason,
      profiles: result.profiles,
      agentContext: result.agentContext,
    };
    populateSettingsForm(state.settings);
    await loadRuntime();
    closeSettingsModal();
    await refreshProviderHealth();

    if (result.warnings?.length) {
      const warningText = result.warnings.join(" | ");
      setStatus(`Settings saved with warnings: ${warningText}`, "error");
      appendMessage("assistant", `Settings warnings: ${warningText}`, "System");
      return;
    }

    setStatus("Settings saved.", "ok");
  } catch (error) {
    reportFailure("Settings save failed:", error, true);
  }
}

async function askAgent() {
  const question = el.promptInput.value.trim();
  if (!question) {
    setStatus("Type a question first.", "error");
    return;
  }

  appendMessage("user", question, "You");
  state.history.push({ role: "user", content: question });
  el.promptInput.value = "";

  showLoader(true);
  setStatus("Pennyworth is working...");

  try {
    const result = await window.pennyworth.ask({
      question,
      history: state.history,
      screenshotAttached: Boolean(state.screenshotData),
    });

    if (!result.ok) {
      reportFailure("Agent failed:", result.error, true);
      return;
    }

    const docMeta = (result.docsUsed || []).map((d) => d.file).join(", ");
    const meta = docMeta
      ? `Pennyworth via ${result.provider} | docs: ${docMeta}`
      : `Pennyworth via ${result.provider}`;

    appendMessage("assistant", result.reply, meta);
    state.history.push({ role: "assistant", content: result.reply });
    renderToolTrace(result.toolTrace || [], result.provider);

    updateBadges(result.provider);
    setStatus("Answer ready.", "ok");
  } catch (error) {
    reportFailure("Agent invocation failed:", error, true);
  } finally {
    showLoader(false);
  }
}

function startVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setStatus("Speech recognition is not available in this environment.", "error");
    return;
  }

  const recog = new SpeechRecognition();
  recog.lang = "en-US";
  recog.interimResults = false;
  recog.maxAlternatives = 1;

  setStatus("Listening...");
  recog.start();

  recog.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript || "";
    if (!transcript) {
      setStatus("No speech detected.", "error");
      return;
    }

    el.promptInput.value = `${el.promptInput.value} ${transcript}`.trim();
    setStatus("Voice captured.", "ok");
  };

  recog.onerror = (event) => {
    setStatus(`Speech error: ${event.error}`, "error");
  };
}

async function captureScreenFlow() {
  try {
    setStatus("Capturing screen...");
    const captureResult = assertOk(
      await window.pennyworth.captureScreen(),
      "Screenshot capture failed."
    );
    const dataUrl = captureResult.imageDataUrl;

    createCropCanvas(dataUrl);
    el.cropModal.classList.remove("hidden");
    setStatus("Choose a region or keep full screenshot.");

    el.confirmCropBtn.onclick = () => {
      setCapturedImage(dataUrl);
      closeCropModal();
      setStatus("Attached full screenshot.", "ok");
    };
  } catch (error) {
    reportFailure("Capture failed:", error, true);
  }
}

function registerGlobalErrorHandlers() {
  window.addEventListener("error", (event) => {
    reportFailure("Unexpected UI error:", event.error || event.message, true);
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportFailure("Unhandled async error:", event.reason, true);
  });
}

async function init() {
  registerGlobalErrorHandlers();
  await loadRuntime();

  appendMessage(
    "assistant",
    "At your service. Summon me with terminal errors, config headaches, and system gremlins.",
    "Pennyworth"
  );

  el.sendBtn.addEventListener("click", askAgent);
  el.captureBtn.addEventListener("click", captureScreenFlow);
  el.voiceBtn.addEventListener("click", startVoiceInput);
  el.settingsBtn.addEventListener("click", openSettingsModal);

  el.promptInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      askAgent();
    }
  });

  el.clearCaptureBtn.addEventListener("click", () => {
    setCapturedImage(null);
    setStatus("Screenshot cleared.");
  });

  el.cancelCropBtn.addEventListener("click", closeCropModal);
  el.cancelSettingsBtn.addEventListener("click", closeSettingsModal);
  el.saveSettingsBtn.addEventListener("click", saveSettings);
  if (el.devMode) {
    el.devMode.addEventListener("change", () => {
      updateTracePanelVisibility();
      renderToolTrace(state.lastToolTrace);
    });
  }

  window.pennyworth.onSummoned(() => {
    el.promptInput.focus();
    setStatus("Summoned.", "ok");
  });
}

init().catch((error) => {
  reportFailure("Startup error:", error, true);
});


