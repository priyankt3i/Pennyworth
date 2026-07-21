const state = {
  runtime: null,
  system: null,
  history: [],
  screenshotData: null,
  lastToolTrace: [],
  drawing: false,
  crop: null,
  settings: null,
  captureDisplays: [],
  selectedDisplayKey: "",
  captureSourceLabel: "",
  activeProviderTab: "ollama",
  clearApiKeys: {
    openai: false,
    gemini: false,
  },
  providerHealth: null,
};

const el = {
  chat: document.getElementById("chat"),
  providerBadge: document.getElementById("providerBadge"),
  providerBadgeIcon: document.getElementById("providerBadgeIcon"),
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
  captureInfo: document.getElementById("captureInfo"),
  clearCaptureBtn: document.getElementById("clearCaptureBtn"),
  cropModal: document.getElementById("cropModal"),
  cropSelectionMeta: document.getElementById("cropSelectionMeta"),
  displaySelectorWrap: document.getElementById("displaySelectorWrap"),
  displaySelect: document.getElementById("displaySelect"),
  resetCropBtn: document.getElementById("resetCropBtn"),
  cropCanvasWrap: document.getElementById("cropCanvasWrap"),
  cancelCropBtn: document.getElementById("cancelCropBtn"),
  confirmCropBtn: document.getElementById("confirmCropBtn"),
  subTitle: document.getElementById("subTitle"),
  runtimePill: document.getElementById("runtimePill"),
  settingsBtn: document.getElementById("settingsBtn"),
  windowMinBtn: document.getElementById("windowMinBtn"),
  windowMaxBtn: document.getElementById("windowMaxBtn"),
  windowCloseBtn: document.getElementById("windowCloseBtn"),
  settingsModal: document.getElementById("settingsModal"),
  detectedProfile: document.getElementById("detectedProfile"),
  detectedArch: document.getElementById("detectedArch"),
  detectionReason: document.getElementById("detectionReason"),
  docsRootOverride: document.getElementById("docsRootOverride"),
  allowIpLocation: document.getElementById("allowIpLocation"),
  devMode: document.getElementById("devMode"),
  llmTabOllama: document.getElementById("llmTabOllama"),
  llmTabOpenAI: document.getElementById("llmTabOpenAI"),
  llmTabGemini: document.getElementById("llmTabGemini"),
  llmPanelOllama: document.getElementById("llmPanelOllama"),
  llmPanelOpenAI: document.getElementById("llmPanelOpenAI"),
  llmPanelGemini: document.getElementById("llmPanelGemini"),
  ollamaBaseUrl: document.getElementById("ollamaBaseUrl"),
  ollamaModel: document.getElementById("ollamaModel"),
  openaiModel: document.getElementById("openaiModel"),
  openaiApiKey: document.getElementById("openaiApiKey"),
  clearOpenAIBtn: document.getElementById("clearOpenAIBtn"),
  geminiModel: document.getElementById("geminiModel"),
  geminiApiKey: document.getElementById("geminiApiKey"),
  clearGeminiBtn: document.getElementById("clearGeminiBtn"),
  ollamaStatus: document.getElementById("ollamaStatus"),
  openaiKeyStatus: document.getElementById("openaiKeyStatus"),
  geminiKeyStatus: document.getElementById("geminiKeyStatus"),
  cancelSettingsBtn: document.getElementById("cancelSettingsBtn"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  themeSelect: document.getElementById("themeSelect"),
};

function setStatus(text, mode = "info") {
  el.status.textContent = text;
  el.status.dataset.mode = mode;
}

function showLoader(show) {
  el.loader.classList.toggle("hidden", !show);
}

function setBusy(isBusy) {
  state.isBusy = isBusy;
  showLoader(isBusy);
  
  if (isBusy) {
    el.sendBtn.textContent = "Stop";
    el.sendBtn.dataset.action = "stop";
    el.sendBtn.classList.add("stopping");
  } else {
    el.sendBtn.textContent = "Send";
    el.sendBtn.dataset.action = "send";
    el.sendBtn.classList.remove("stopping");
  }

  el.captureBtn.disabled = isBusy;
  el.voiceBtn.disabled = isBusy;
  el.promptInput.disabled = isBusy;
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
  text = text.replace(/^\s*-\s+(.+)$/gm, "- $1");
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
  option.textContent = state.runtime.profile.name;
  option.selected = true;
  el.profileSelect.appendChild(option);
}

function updateBadges(providerLabel = null) {
  if (!el.providerBadge || !el.providerBadgeIcon) {
    return;
  }

  const activeProvider = String(
    providerLabel || state.runtime?.providers?.defaultProvider || "ollama"
  ).toLowerCase();

  const iconByProvider = {
    ollama: "../../public/ollama.png",
    openai: "../../public/openai.png",
    gemini: "../../public/gemini.png",
    noprovider: "../../public/noprovider.png",
  };

  const normalizedProvider = iconByProvider[activeProvider] ? activeProvider : "noprovider";
  const iconPath = iconByProvider[normalizedProvider];
  el.providerBadgeIcon.src = iconPath;
  el.providerBadgeIcon.alt = `${normalizedProvider} icon`;
  const label =
    normalizedProvider === "noprovider" ? "No provider available" : `Provider: ${normalizedProvider}`;
  el.providerBadge.title = label;
  el.providerBadge.setAttribute("aria-label", label);
}

function activeProviderName() {
  return String(state.runtime?.providers?.defaultProvider || "").trim().toLowerCase();
}

function isProviderConnected(healthEntry) {
  return String(healthEntry?.state || "").toLowerCase() === "connected";
}

function showNoProviderGuidance(showInChat = false, detail = "") {
  const active = activeProviderName() || "none";
  const reason = detail ? ` Reason: ${detail}.` : "";
  const helpText = `No active provider is available (selected: ${active}). Open Settings, choose an LLM tab, and ensure it is connected.${reason}`;
  updateBadges("noprovider");
  if (el.runtimePill) {
    el.runtimePill.textContent = "provider offline";
    el.runtimePill.dataset.mode = "error";
  }
  setStatus(helpText, "error");
  if (showInChat) {
    appendMessage("assistant", helpText, "System");
  }
}

function applyProviderAvailabilityUi(health = {}, showInChat = false) {
  const active = activeProviderName();
  if (!active) {
    showNoProviderGuidance(showInChat);
    return false;
  }

  const activeHealth = health?.[active];
  if (isProviderConnected(activeHealth)) {
    updateBadges(active);
    if (el.runtimePill) {
      el.runtimePill.textContent = `${active} ready`;
      el.runtimePill.dataset.mode = "ok";
    }
    return true;
  }

  const reason = activeHealth?.message || activeHealth?.state || "not connected";
  showNoProviderGuidance(showInChat, reason);
  return false;
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

  const show = Array.isArray(state.lastToolTrace) && state.lastToolTrace.length > 0;
  el.tracePanel.classList.toggle("hidden", !show);

  if (show && (!Array.isArray(state.lastToolTrace) || !state.lastToolTrace.length)) {
    el.traceContent.textContent = "Agent starting...";
  }
}

function renderToolTrace(toolTrace, providerLabel = "") {
  if (!el.traceContent) {
    return;
  }

  state.lastToolTrace = Array.isArray(toolTrace) ? toolTrace : [];
  updateTracePanelVisibility();

  if (!state.lastToolTrace.length) {
    el.traceContent.textContent = "Agent starting...";
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
  state.system = runtimeResult.runtime?.systemContext || null;

  if (!state.system) {
    const systemResult = assertOk(
      await window.pennyworth.getSystemContext(),
      "Unable to read system context."
    );
    state.system = systemResult.systemContext;
  }

  renderProfileSelect();
  updateBadges();
  updateTracePanelVisibility();

  el.subTitle.textContent = `${state.system.distro.prettyName} / ${state.system.arch} / ${state.runtime.profile.name}`;
  if (el.runtimePill) {
    el.runtimePill.textContent = state.system.platform;
    el.runtimePill.dataset.mode = "neutral";
  }

  const theme = state.runtime?.agentContext?.theme || "light";
  document.body.classList.toggle("dark-theme", theme === "dark");
  if (el.themeSelect) {
    el.themeSelect.value = theme;
  }
}

function setCapturedImage(dataUrl, label = "") {
  state.screenshotData = dataUrl;
  state.captureSourceLabel = label;
  if (!dataUrl) {
    el.capturePreview.classList.add("hidden");
    el.captureImage.src = "";
    if (el.captureInfo) {
      el.captureInfo.textContent = "";
    }
    return;
  }
  el.captureImage.src = dataUrl;
  if (el.captureInfo) {
    el.captureInfo.textContent = label || "Screenshot attached to next message";
  }
  el.capturePreview.classList.remove("hidden");
}

function createCropCanvas(imageDataUrl) {
  disposeCropSession(false);
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
      pointerId: null,
      rafId: null,
    };

    redrawCropCanvas();
  };

  img.src = imageDataUrl;

  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", onCropStart);
  canvas.addEventListener("dblclick", confirmCropSelection);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  el.cropCanvasWrap.appendChild(canvas);
}

function cropPosition(event) {
  const rect = state.crop.canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const scaleX = state.crop.canvas.width / width;
  const scaleY = state.crop.canvas.height / height;

  const x = Math.max(0, Math.min(state.crop.canvas.width, (event.clientX - rect.left) * scaleX));
  const y = Math.max(0, Math.min(state.crop.canvas.height, (event.clientY - rect.top) * scaleY));
  return { x, y };
}

function onCropStart(event) {
  if (!state.crop) {
    return;
  }
  if (event.pointerType === "mouse" && event.button !== 0) {
    return;
  }

  event.preventDefault();
  state.drawing = true;
  state.crop.pointerId = event.pointerId ?? null;
  if (event.target?.setPointerCapture && state.crop.pointerId !== null) {
    try {
      event.target.setPointerCapture(state.crop.pointerId);
    } catch {
      // Ignore capture failures and continue best-effort.
    }
  }
  state.crop.start = cropPosition(event);
  state.crop.selection = { x: state.crop.start.x, y: state.crop.start.y, w: 0, h: 0 };
  redrawCropCanvas();
  window.addEventListener("pointermove", onCropMove);
  window.addEventListener("pointerup", onCropEnd);
  window.addEventListener("pointercancel", onCropEnd);
}

function onCropMove(event) {
  if (!state.crop || !state.drawing) {
    return;
  }
  if (state.crop.pointerId !== null && event.pointerId !== state.crop.pointerId) {
    return;
  }

  event.preventDefault();
  const current = cropPosition(event);
  const x = Math.min(state.crop.start.x, current.x);
  const y = Math.min(state.crop.start.y, current.y);
  const w = Math.abs(current.x - state.crop.start.x);
  const h = Math.abs(current.y - state.crop.start.y);

  state.crop.selection = { x, y, w, h };
  scheduleCropRedraw();
}

function onCropEnd(event) {
  if (!state.crop) {
    return;
  }
  if (state.crop.pointerId !== null && event?.pointerId !== undefined && event.pointerId !== state.crop.pointerId) {
    return;
  }

  if (event?.target?.releasePointerCapture && state.crop.pointerId !== null) {
    try {
      event.target.releasePointerCapture(state.crop.pointerId);
    } catch {
      // Ignore release failures.
    }
  }
  state.drawing = false;
  state.crop.pointerId = null;
  window.removeEventListener("pointermove", onCropMove);
  window.removeEventListener("pointerup", onCropEnd);
  window.removeEventListener("pointercancel", onCropEnd);
}

function hasValidCropSelection() {
  const selection = state.crop?.selection;
  return Boolean(selection && selection.w >= 2 && selection.h >= 2);
}

function updateCropConfirmButton() {
  if (!el.confirmCropBtn) {
    return;
  }
  if (!hasValidCropSelection()) {
    el.confirmCropBtn.textContent = "Use Full Screen";
    if (el.cropSelectionMeta) {
      el.cropSelectionMeta.textContent = "Full screenshot";
    }
    return;
  }

  const selection = state.crop.selection;
  const width = Math.max(1, Math.floor(selection.w / state.crop.scale));
  const height = Math.max(1, Math.floor(selection.h / state.crop.scale));
  el.confirmCropBtn.textContent = "Use Selection";
  if (el.cropSelectionMeta) {
    el.cropSelectionMeta.textContent = `Selection ${width} x ${height}`;
  }
}

function scheduleCropRedraw() {
  if (!state.crop || state.crop.rafId) {
    return;
  }

  state.crop.rafId = window.requestAnimationFrame(() => {
    if (!state.crop) {
      return;
    }
    state.crop.rafId = null;
    redrawCropCanvas();
  });
}

function redrawCropCanvas() {
  if (!state.crop) {
    return;
  }

  const { canvas, ctx, img, selection } = state.crop;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  updateCropConfirmButton();

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

  setCapturedImage(out.toDataURL("image/png"), `Selected region - ${out.width} x ${out.height}`);
  closeCropModal();
  setStatus("Attached selected screenshot region.", "ok");
}

function disposeCropSession(clearCanvas = true) {
  if (state.crop?.rafId) {
    window.cancelAnimationFrame(state.crop.rafId);
  }
  window.removeEventListener("pointermove", onCropMove);
  window.removeEventListener("pointerup", onCropEnd);
  window.removeEventListener("pointercancel", onCropEnd);
  state.crop = null;
  state.drawing = false;
  if (clearCanvas) {
    el.cropCanvasWrap.innerHTML = "";
  }
  updateCropConfirmButton();
}

function closeCropModal() {
  el.cropModal.classList.add("hidden");
  disposeCropSession(true);
}

function resetCropSelection() {
  if (!state.crop) {
    return;
  }
  state.crop.selection = null;
  state.crop.start = null;
  redrawCropCanvas();
}

function toDisplayKey(id, fallbackIndex = 0) {
  if (id === null || id === undefined || id === "") {
    return `display-${fallbackIndex}`;
  }
  return String(id);
}

function normalizeDisplayList(displays) {
  if (!Array.isArray(displays) || !displays.length) {
    return [];
  }

  return displays.map((display, index) => {
    const key = toDisplayKey(display.id, index);
    const label = display.name || `Display ${index + 1}`;
    return {
      key,
      id: display.id,
      label: display.primary ? `${label} (Primary)` : label,
      primary: Boolean(display.primary),
    };
  });
}

function getSelectedDisplay() {
  if (!state.captureDisplays.length) {
    return null;
  }

  return (
    state.captureDisplays.find((display) => display.key === state.selectedDisplayKey) ||
    state.captureDisplays[0]
  );
}

function renderDisplaySelector() {
  if (!el.displaySelectorWrap || !el.displaySelect) {
    return;
  }

  const displays = state.captureDisplays;
  const show = displays.length > 1;
  el.displaySelectorWrap.classList.toggle("hidden", !show);

  if (!show) {
    el.displaySelect.innerHTML = "";
    return;
  }

  el.displaySelect.innerHTML = "";
  for (const display of displays) {
    const option = document.createElement("option");
    option.value = display.key;
    option.textContent = display.label;
    el.displaySelect.appendChild(option);
  }

  const selected = getSelectedDisplay();
  if (selected) {
    el.displaySelect.value = selected.key;
  }
}

async function refreshCaptureDisplays() {
  try {
    const response = await window.pennyworth.listDisplays();
    if (!response?.ok) {
      throw new Error(extractErrorText(response?.error, "Display detection failed."));
    }

    const displays = normalizeDisplayList(response.displays || []);
    state.captureDisplays = displays;

    if (!displays.length) {
      state.selectedDisplayKey = "";
      renderDisplaySelector();
      return;
    }

    const selected = displays.find((display) => display.key === state.selectedDisplayKey);
    state.selectedDisplayKey = selected ? selected.key : displays[0].key;
    renderDisplaySelector();
  } catch (error) {
    state.captureDisplays = [];
    state.selectedDisplayKey = "";
    renderDisplaySelector();
    setStatus(`Display detection issue: ${extractErrorText(error)}. Using default capture mode.`, "error");
  }
}

async function captureCurrentDisplayImage() {
  const selected = getSelectedDisplay();
  const payload = {};
  if (selected && selected.id !== null && selected.id !== undefined && selected.id !== "") {
    payload.screenId = selected.id;
  }

  const captureResult = assertOk(
    await window.pennyworth.captureScreen(payload),
    "Screenshot capture failed."
  );

  if (captureResult.warning) {
    appendMessage("assistant", captureResult.warning, "System");
  }

  return {
    imageDataUrl: captureResult.imageDataUrl,
    sourceLabel: captureResult.screenName || selected?.label || "default display",
  };
}

async function openCaptureModalForCurrentDisplay() {
  const captured = await captureCurrentDisplayImage();
  const dataUrl = captured.imageDataUrl;

  createCropCanvas(dataUrl);
  el.cropModal.classList.remove("hidden");

  el.confirmCropBtn.onclick = () => {
    if (hasValidCropSelection()) {
      confirmCropSelection();
      return;
    }
    setCapturedImage(dataUrl, `Full screenshot - ${captured.sourceLabel}`);
    closeCropModal();
    setStatus(`Attached full screenshot from ${captured.sourceLabel}.`, "ok");
  };

  if (state.captureDisplays.length > 1) {
    setStatus(`Captured ${captured.sourceLabel}. Change monitor if needed.`, "ok");
  } else {
    setStatus("Choose a region or keep full screenshot.");
  }
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

function getCurrentOllamaModelValue(fallback = "llama3.2") {
  const current = String(el.ollamaModel?.value || "").trim();
  if (current) {
    return current;
  }
  return String(fallback || "llama3.2").trim() || "llama3.2";
}

function setOllamaModelOptions(models, preferredModel) {
  if (!el.ollamaModel) {
    return;
  }

  const safePreferred = getCurrentOllamaModelValue(preferredModel);
  const uniqueModels = Array.from(
    new Set((Array.isArray(models) ? models : []).map((x) => String(x || "").trim()).filter(Boolean))
  );

  el.ollamaModel.innerHTML = "";

  if (!uniqueModels.length) {
    const fallback = document.createElement("option");
    fallback.value = safePreferred;
    fallback.textContent = `${safePreferred} (configured)`;
    el.ollamaModel.appendChild(fallback);
    el.ollamaModel.value = safePreferred;
    return;
  }

  uniqueModels.forEach((model) => {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    el.ollamaModel.appendChild(option);
  });

  if (!uniqueModels.includes(safePreferred)) {
    const configured = document.createElement("option");
    configured.value = safePreferred;
    configured.textContent = `${safePreferred} (configured)`;
    el.ollamaModel.appendChild(configured);
  }

  el.ollamaModel.value = safePreferred;
}

async function refreshOllamaModels(showStatus = false) {
  if (!el.ollamaBaseUrl || !el.ollamaModel) {
    return;
  }

  const baseUrl = el.ollamaBaseUrl.value.trim() || "http://127.0.0.1:11434";
  const currentModel = getCurrentOllamaModelValue("llama3.2");

  try {
    const result = assertOk(
      await window.pennyworth.listOllamaModels({ baseUrl }),
      "Failed to fetch Ollama model list."
    );

    const models = Array.isArray(result.models) ? result.models : [];
    setOllamaModelOptions(models, currentModel);

    if (showStatus) {
      const message =
        models.length > 0
          ? `Loaded ${models.length} Ollama model(s).`
          : "Connected to Ollama, but no local models were found.";
      setStatus(message, models.length > 0 ? "ok" : "error");
    }
  } catch (error) {
    setOllamaModelOptions([], currentModel);
    if (showStatus) {
      setStatus(`Could not load Ollama models. ${extractErrorText(error)}`, "error");
    }
  }
}

function getProviderFromButton(button) {
  return String(button?.dataset?.provider || "").trim().toLowerCase();
}

function getActiveProviderFromConfig(providerConfig) {
  if (!providerConfig?.providers) {
    return "ollama";
  }

  const defaultProvider = String(providerConfig.defaultProvider || "ollama").toLowerCase();
  if (providerConfig.providers[defaultProvider]?.enabled) {
    return defaultProvider;
  }

  const firstEnabled = Object.keys(providerConfig.providers).find(
    (provider) => providerConfig.providers[provider]?.enabled
  );
  return firstEnabled || defaultProvider || "ollama";
}

function setActiveProviderTab(provider) {
  const next = ["ollama", "openai", "gemini"].includes(provider) ? provider : "ollama";
  state.activeProviderTab = next;

  const tabMap = {
    ollama: el.llmTabOllama,
    openai: el.llmTabOpenAI,
    gemini: el.llmTabGemini,
  };

  const panelMap = {
    ollama: el.llmPanelOllama,
    openai: el.llmPanelOpenAI,
    gemini: el.llmPanelGemini,
  };

  Object.entries(tabMap).forEach(([name, node]) => {
    if (!node) {
      return;
    }
    const active = name === next;
    node.classList.toggle("llm-tab-active", active);
    node.setAttribute("aria-pressed", active ? "true" : "false");
  });

  Object.entries(panelMap).forEach(([name, node]) => {
    if (!node) {
      return;
    }
    node.classList.toggle("hidden", name !== next);
  });
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

async function refreshProviderHealth(showNoProviderMessage = false, force = false) {
  try {
    const result = assertOk(
      await window.pennyworth.getProviderHealth({ force }),
      "Failed to check provider connectivity."
    );
    const health = result.health || {};
    state.providerHealth = health;
    setProviderStatusChip(el.ollamaStatus, "Ollama", health.ollama);
    setProviderStatusChip(el.openaiKeyStatus, "OpenAI", health.openai);
    setProviderStatusChip(el.geminiKeyStatus, "Gemini", health.gemini);
    applyProviderAvailabilityUi(health, showNoProviderMessage);
    return health;
  } catch (error) {
    state.providerHealth = null;
    setProviderStatusChip(el.ollamaStatus, "Ollama", { state: "error", message: "health check failed" });
    setProviderStatusChip(el.openaiKeyStatus, "OpenAI", { state: "error", message: "health check failed" });
    setProviderStatusChip(el.geminiKeyStatus, "Gemini", { state: "error", message: "health check failed" });
    updateBadges("noprovider");
    reportFailure("Provider health check failed:", error, false);
    return null;
  }
}

async function ensureActiveProviderForAsk() {
  const health = await refreshProviderHealth(false, false);
  if (!health) {
    showNoProviderGuidance(true);
    return false;
  }

  if (applyProviderAvailabilityUi(health, false)) {
    return true;
  }

  showNoProviderGuidance(true);
  return false;
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
  if (el.themeSelect) {
    el.themeSelect.value = agentContext.theme || "light";
  }
  updateTracePanelVisibility();

  el.ollamaBaseUrl.value = providerConfig.providers.ollama.baseUrl;
  setOllamaModelOptions([], providerConfig.providers.ollama.model);

  el.openaiModel.value = providerConfig.providers.openai.model;
  el.openaiApiKey.value = "";

  el.geminiModel.value = providerConfig.providers.gemini.model;
  el.geminiApiKey.value = "";
  state.clearApiKeys.openai = false;
  state.clearApiKeys.gemini = false;
  setActiveProviderTab(getActiveProviderFromConfig(providerConfig));

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
    if (state.activeProviderTab === "ollama") {
      refreshOllamaModels(false);
    }
    refreshProviderHealth(false, false);
  } catch (error) {
    reportFailure("Settings error:", error, true);
  }
}

async function saveSettings() {
  const activeProvider = state.activeProviderTab || "ollama";
  const openaiApiKey = el.openaiApiKey.value.trim();
  const geminiApiKey = el.geminiApiKey.value.trim();

  const payload = {
    agentContext: {
      docsRootUrlOverride: el.docsRootOverride.value.trim(),
      allowIpLocation: el.allowIpLocation.checked,
      devMode: Boolean(el.devMode?.checked),
      theme: el.themeSelect.value,
    },
    providerConfig: {
      defaultProvider: activeProvider,
      providers: {
        ollama: {
          enabled: activeProvider === "ollama",
          baseUrl: el.ollamaBaseUrl.value.trim(),
          model: el.ollamaModel.value.trim(),
        },
        openai: {
          enabled: activeProvider === "openai",
          model: el.openaiModel.value.trim(),
        },
        gemini: {
          enabled: activeProvider === "gemini",
          model: el.geminiModel.value.trim(),
        },
      },
    },
    secrets: {
      openaiApiKey,
      geminiApiKey,
      clearOpenAI: !openaiApiKey && state.clearApiKeys.openai,
      clearGemini: !geminiApiKey && state.clearApiKeys.gemini,
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

    const theme = result.agentContext?.theme || "light";
    document.body.classList.toggle("dark-theme", theme === "dark");

    populateSettingsForm(state.settings);
    await loadRuntime();
    closeSettingsModal();
    await refreshProviderHealth(false, true);

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
  if (state.isBusy) {
    return;
  }

  const question = el.promptInput.value.trim();
  if (!question) {
    setStatus("Type a question first.", "error");
    return;
  }

  const providerReady = await ensureActiveProviderForAsk();
  if (!providerReady) {
    return;
  }

  const historyBeforeAsk = state.history.slice();
  appendMessage("user", question, "You");
  state.history.push({ role: "user", content: question });
  el.promptInput.value = "";

  state.lastToolTrace = [];
  renderToolTrace([]);
  setBusy(true);
  setStatus("Pennyworth is working...");

  try {
    const result = await window.pennyworth.ask({
      question,
      history: historyBeforeAsk,
      screenshotAttached: Boolean(state.screenshotData),
      screenshotData: state.screenshotData || null,
    });

    if (!result.ok) {
      let providerHintShown = false;
      const details = extractErrorText(result.error, "");
      if (/(no enabled providers|api key is missing|connection failed|not connected|refused)/i.test(details)) {
        showNoProviderGuidance(true);
        providerHintShown = true;
      }
      reportFailure("Agent failed:", result.error, !providerHintShown);
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
    if (state.screenshotData) {
      setCapturedImage(null);
    }
    setStatus("Answer ready.", "ok");
  } catch (error) {
    reportFailure("Agent invocation failed:", error, true);
  } finally {
    setBusy(false);
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
    setStatus("Detecting displays...");
    await refreshCaptureDisplays();
    setStatus("Capturing screen...");
    await openCaptureModalForCurrentDisplay();
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

function registerKeyboardShortcuts() {
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    if (!el.cropModal.classList.contains("hidden")) {
      closeCropModal();
      return;
    }
    if (!el.settingsModal.classList.contains("hidden")) {
      closeSettingsModal();
    }
  });
}

async function invokeWindowControl(action, fallbackMessage) {
  try {
    if (!window.pennyworth || typeof action !== "function") {
      throw new Error("Window controls are unavailable in this environment.");
    }

    const result = await action();
    if (!result?.ok) {
      throw new Error(extractErrorText(result?.error, fallbackMessage));
    }
  } catch (error) {
    reportFailure("Window control failed:", error, true);
  }
}

async function init() {
  registerGlobalErrorHandlers();
  registerKeyboardShortcuts();
  await loadRuntime();
  refreshProviderHealth(false, false);

  const systemName = state.system?.distro?.prettyName || state.system?.platform || "PC";
  appendMessage(
    "assistant",
    `Hermes Agent ready. System context initialized for ${systemName}. How can I assist you with your system configurations or package management today?`,
    "Hermes"
  );

  el.sendBtn.addEventListener("click", () => {
    if (el.sendBtn.dataset.action === "stop") {
      stopAgent();
    } else {
      askAgent();
    }
  });
  el.captureBtn.addEventListener("click", captureScreenFlow);
  el.voiceBtn.addEventListener("click", startVoiceInput);
  el.settingsBtn.addEventListener("click", openSettingsModal);
  if (el.windowMinBtn) {
    el.windowMinBtn.addEventListener("click", () => {
      invokeWindowControl(() => window.pennyworth.windowMinimize(), "Failed to minimize window.");
    });
  }
  if (el.windowMaxBtn) {
    el.windowMaxBtn.addEventListener("click", () => {
      invokeWindowControl(
        () => window.pennyworth.windowMaximizeToggle(),
        "Failed to maximize or restore window."
      );
    });
  }
  if (el.windowCloseBtn) {
    el.windowCloseBtn.addEventListener("click", () => {
      invokeWindowControl(() => window.pennyworth.windowClose(), "Failed to close window.");
    });
  }

  el.promptInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!state.isBusy) {
        askAgent();
      }
    }
  });

  el.clearCaptureBtn.addEventListener("click", () => {
    setCapturedImage(null);
    setStatus("Screenshot cleared.");
  });

  window.pennyworth.onTraceEvent((event) => {
    if (!Array.isArray(state.lastToolTrace)) {
      state.lastToolTrace = [];
    }
    state.lastToolTrace.push(event);
    renderToolTrace(state.lastToolTrace, event.provider);

    if (event.stage === "model_tool_request") {
      setStatus(`Hermes requesting: ${event.tool}...`);
    } else if (event.stage === "tool_exec_start") {
      setStatus(`Executing tool: ${event.tool}...`);
    } else if (event.stage === "tool_exec_result") {
      setStatus(`Execution complete: ${event.tool}.`);
    } else if (event.stage === "tool_exec_error") {
      setStatus(`Tool error: ${event.tool} failed.`, "error");
    } else if (event.stage === "provider_attempt") {
      setStatus("Hermes is thinking...");
    } else if (event.stage === "final_response") {
      setStatus("Ready");
    }
  });

  async function stopAgent() {
    setStatus("Stopping agent...");
    try {
      await window.pennyworth.cancelAgent();
    } catch (err) {
      console.error("Cancel agent error:", err);
      setStatus("Failed to stop agent.", "error");
    }
  }
  if (el.resetCropBtn) {
    el.resetCropBtn.addEventListener("click", resetCropSelection);
  }

  if (el.displaySelect) {
    el.displaySelect.addEventListener("change", async () => {
      state.selectedDisplayKey = el.displaySelect.value;
      if (el.cropModal.classList.contains("hidden")) {
        return;
      }

      try {
        setStatus("Switching monitor capture...");
        await openCaptureModalForCurrentDisplay();
      } catch (error) {
        reportFailure("Display capture switch failed:", error, true);
      }
    });
  }

  if (el.ollamaBaseUrl) {
    el.ollamaBaseUrl.addEventListener("blur", () => {
      refreshOllamaModels(true);
    });
  }

  [el.llmTabOllama, el.llmTabOpenAI, el.llmTabGemini].forEach((tab) => {
    if (!tab) {
      return;
    }
    tab.addEventListener("click", () => {
      const provider = getProviderFromButton(tab);
      setActiveProviderTab(provider);
      if (provider === "ollama") {
        refreshOllamaModels(false);
      }
    });
  });

  if (el.clearOpenAIBtn) {
    el.clearOpenAIBtn.addEventListener("click", () => {
      el.openaiApiKey.value = "";
      state.clearApiKeys.openai = true;
      setStatus("OpenAI API key will be cleared on save.", "ok");
    });
  }

  if (el.clearGeminiBtn) {
    el.clearGeminiBtn.addEventListener("click", () => {
      el.geminiApiKey.value = "";
      state.clearApiKeys.gemini = true;
      setStatus("Gemini API key will be cleared on save.", "ok");
    });
  }

  if (el.openaiApiKey) {
    el.openaiApiKey.addEventListener("input", () => {
      if (el.openaiApiKey.value.trim()) {
        state.clearApiKeys.openai = false;
      }
    });
  }

  if (el.geminiApiKey) {
    el.geminiApiKey.addEventListener("input", () => {
      if (el.geminiApiKey.value.trim()) {
        state.clearApiKeys.gemini = false;
      }
    });
  }

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
    setStatus("Ready.", "ok");
  });
}

init().catch((error) => {
  reportFailure("Startup error:", error, true);
});


