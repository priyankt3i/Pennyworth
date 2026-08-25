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
    appendWelcomeSetupCard();
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
function updateTracePanelVisibility() {
  if (!el.tracePanel || !el.traceContent) {
    return;
  }

  const devModeEnabled = state.runtime?.agentContext?.devMode !== undefined ? Boolean(state.runtime.agentContext.devMode) : Boolean(el.devMode?.checked);
  const show = devModeEnabled && Array.isArray(state.lastToolTrace) && state.lastToolTrace.length > 0;
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
    if (entry?.details) {
      details.push(`details=${entry.details}`);
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

  const profileName = state.runtime?.profile?.name || "Select OS Profile";
  const distroName = state.system?.distro?.prettyName || state.system?.platform || "Linux";
  const archName = state.system?.arch || "x64";
  el.subTitle.textContent = `${distroName} / ${archName} / ${profileName}`;
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
      // Ignore
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
      // Ignore
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

  if (el.toggleSidebarBtn) {
    el.toggleSidebarBtn.addEventListener("click", () => {
      document.querySelector(".app-shell").classList.toggle("sidebar-collapsed");
    });
  }

  if (el.newChatBtn) {
    el.newChatBtn.addEventListener("click", createNewSessionFlow);
  }

  await loadSessionsFlow();
  if (state.sessions.length > 0) {
    await switchSessionFlow(state.sessions[0].id);
  } else {
    await createNewSessionFlow();
  }

  if (window.pennyworth.onBootstrapProgress) {
    window.pennyworth.onBootstrapProgress((data) => {
      const progressBar = document.getElementById("setupProgressBar");
      const progressStatus = document.getElementById("setupProgressStatus");
      if (progressBar && progressStatus) {
        if (data.total > 0 && typeof data.completed === "number") {
          const pct = Math.round((data.completed / data.total) * 100);
          progressBar.style.width = `${50 + (pct * 0.4)}%`;
          const mbDone = (data.completed / 1024 / 1024).toFixed(1);
          const mbTotal = (data.total / 1024 / 1024).toFixed(1);
          const hash = data.digest ? ` (${data.digest.substring(7, 19)})` : "";
          progressStatus.textContent = `Downloading layer${hash}: ${pct}% complete (${mbDone} / ${mbTotal} MB)...`;
        } else if (data.status) {
          progressStatus.textContent = `Model setup: ${data.status}`;
        }
      }
    });
  }

  el.sendBtn.addEventListener("click", () => {
    if (el.sendBtn.dataset.action === "stop") {
      stopAgent();
    } else {
      askAgent();
    }
  });

  if (el.promptInput) {
    el.promptInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (el.sendBtn.dataset.action === "stop") {
          return;
        }
        askAgent();
      }
    });
  }
  el.captureBtn.addEventListener("click", captureScreenFlow);
  el.voiceBtn.addEventListener("click", startVoiceInput);
  el.settingsBtn.addEventListener("click", openSettingsModal);
  if (el.notificationsBtn) {
    el.notificationsBtn.addEventListener("click", openNotificationsModal);
  }
  if (el.closeNotificationsBtn) {
    el.closeNotificationsBtn.addEventListener("click", closeNotificationsModal);
  }
  if (el.clearNotificationsBtn) {
    el.clearNotificationsBtn.addEventListener("click", clearNotifications);
  }
  if (el.vaultSetupBtn) {
    el.vaultSetupBtn.addEventListener("click", async () => {
      const passphrase = el.vaultSetupPassphrase.value;
      if (!passphrase || passphrase.length < 8) {
        alert("Passphrase must be at least 8 characters long.");
        return;
      }
      try {
        const res = await window.pennyworth.vaultSetup(passphrase);
        if (res.ok) {
          alert("Vault initialized successfully.");
          el.vaultSetupPassphrase.value = "";
          refreshVaultStatus();
        } else {
          alert(`Vault setup failed: ${res.error}`);
        }
      } catch (err) {
        alert(`Vault setup error: ${err.message}`);
      }
    });
  }
  if (el.vaultUnlockBtn) {
    el.vaultUnlockBtn.addEventListener("click", async () => {
      const passphrase = el.vaultUnlockPassphrase.value;
      if (!passphrase) {
        alert("Please enter your passphrase.");
        return;
      }
      try {
        const res = await window.pennyworth.vaultUnlock(passphrase);
        if (res.ok) {
          alert("Vault unlocked successfully.");
          el.vaultUnlockPassphrase.value = "";
          refreshVaultStatus();
        } else {
          alert(`Unlock failed: ${res.error}`);
        }
      } catch (err) {
        alert(`Unlock error: ${err.message}`);
      }
    });
  }
  if (el.windowMinBtn) {
    el.windowMinBtn.addEventListener("click", () => {
      invokeWindowControl(() => window.pennyworth.windowMinimize(), "Failed to minimize window.");
    });
  }
  if (el.windowMaxBtn) {
    el.windowMaxBtn.addEventListener("click", () => {
      invokeWindowControl(() => window.pennyworth.windowMaximizeToggle(), "Failed to maximize window.");
    });
  }
  if (el.windowCloseBtn) {
    el.windowCloseBtn.addEventListener("click", () => {
      invokeWindowControl(() => window.pennyworth.windowClose(), "Failed to close window.");
    });
  }
  el.clearCaptureBtn.addEventListener("click", () => {
    setCapturedImage(null);
    setStatus("Attached screenshot removed.");
  });

  window.pennyworth.onTraceEvent((event) => {
    if (!event) {
      return;
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
      await window.pennyworth.cancelAgent(state.activeSessionId);
      if (typeof setBusy === "function") setBusy(false);
      setStatus("Agent stopped.", "warn");
    } catch (err) {
      console.error("Cancel agent error:", err);
      if (typeof setBusy === "function") setBusy(false);
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
      } else if (provider === "openai") {
        refreshOpenAIModels(false);
      } else if (provider === "gemini") {
        refreshGeminiModels(false);
      }
    });
  });

  if (el.clearOpenAIBtn) {
    el.clearOpenAIBtn.addEventListener("click", () => {
      el.openaiApiKey.value = "";
      state.clearApiKeys.openai = true;
      setOpenAIModelOptions([], "gpt-4o-mini");
      setStatus("OpenAI API key will be cleared on save.", "ok");
    });
  }

  if (el.clearGeminiBtn) {
    el.clearGeminiBtn.addEventListener("click", () => {
      el.geminiApiKey.value = "";
      state.clearApiKeys.gemini = true;
      setGeminiModelOptions([], "gemini-2.5-flash");
      setStatus("Gemini API key will be cleared on save.", "ok");
    });
  }

  if (el.openaiApiKey) {
    el.openaiApiKey.addEventListener("input", () => {
      if (el.openaiApiKey.value.trim()) {
        state.clearApiKeys.openai = false;
      }
    });
    el.openaiApiKey.addEventListener("change", () => {
      refreshOpenAIModels(false);
    });
  }

  if (el.geminiApiKey) {
    el.geminiApiKey.addEventListener("input", () => {
      if (el.geminiApiKey.value.trim()) {
        state.clearApiKeys.gemini = false;
      }
    });
    el.geminiApiKey.addEventListener("change", () => {
      refreshGeminiModels(false);
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

  if (el.copyTraceBtn) {
    el.copyTraceBtn.addEventListener("click", async () => {
      if (!el.traceContent || !el.traceContent.textContent) return;
      try {
        await navigator.clipboard.writeText(el.traceContent.textContent);
        const originalText = el.copyTraceBtn.textContent;
        el.copyTraceBtn.textContent = "Copied!";
        setTimeout(() => {
          if (el.copyTraceBtn) el.copyTraceBtn.textContent = originalText;
        }, 1500);
      } catch (err) {
        console.error("Failed to copy tool trace:", err);
      }
    });
  }

  if (el.clearTraceBtn) {
    el.clearTraceBtn.addEventListener("click", () => {
      state.lastToolTrace = [];
      renderToolTrace([]);
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
