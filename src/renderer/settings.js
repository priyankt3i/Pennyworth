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

function getCurrentOpenAIModelValue(fallback = "gpt-4o-mini") {
  const current = String(el.openaiModel?.value || "").trim();
  if (current) {
    return current;
  }
  return String(fallback || "gpt-4o-mini").trim() || "gpt-4o-mini";
}

function setOpenAIModelOptions(models, preferredModel) {
  if (!el.openaiModel) {
    return;
  }

  const safePreferred = getCurrentOpenAIModelValue(preferredModel);
  const uniqueModels = Array.from(
    new Set((Array.isArray(models) ? models : []).map((x) => String(x || "").trim()).filter(Boolean))
  );

  el.openaiModel.innerHTML = "";

  if (!uniqueModels.length) {
    const fallback = document.createElement("option");
    fallback.value = safePreferred;
    fallback.textContent = `${safePreferred} (configured)`;
    el.openaiModel.appendChild(fallback);
    el.openaiModel.value = safePreferred;
    return;
  }

  uniqueModels.forEach((model) => {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    el.openaiModel.appendChild(option);
  });

  if (uniqueModels.includes(safePreferred)) {
    el.openaiModel.value = safePreferred;
  } else {
    const configured = document.createElement("option");
    configured.value = safePreferred;
    configured.textContent = `${safePreferred} (invalid/unavailable)`;
    el.openaiModel.appendChild(configured);

    const validDefault = uniqueModels.find((m) => m === "gpt-4o-mini" || m === "gpt-4o") || uniqueModels[0];
    el.openaiModel.value = validDefault;
  }
}

async function refreshOpenAIModels(showStatus = false) {
  if (!el.openaiApiKey || !el.openaiModel) {
    return;
  }

  const currentModel = getCurrentOpenAIModelValue("gpt-4o-mini");
  const rawKeyInput = String(el.openaiApiKey.value || "").trim();
  const apiKeyToUse = rawKeyInput.includes("•") ? "" : rawKeyInput;

  try {
    const result = assertOk(
      await window.pennyworth.listOpenAIModels({ apiKey: apiKeyToUse }),
      "Failed to fetch OpenAI model list."
    );

    const models = Array.isArray(result.models) ? result.models : [];
    setOpenAIModelOptions(models, currentModel);

    if (showStatus) {
      const message =
        models.length > 0
          ? `Loaded ${models.length} OpenAI model(s).`
          : "Connected to OpenAI, but no models were returned.";
      setStatus(message, models.length > 0 ? "ok" : "error");
    }
  } catch (error) {
    setOpenAIModelOptions([], currentModel);
    if (showStatus) {
      setStatus(`Could not load OpenAI models. ${extractErrorText(error)}`, "error");
    }
  }
}

function getCurrentGeminiModelValue(fallback = "gemini-2.5-flash") {
  const current = String(el.geminiModel?.value || "").trim();
  if (current) {
    return current;
  }
  return String(fallback || "gemini-2.5-flash").trim() || "gemini-2.5-flash";
}

function setGeminiModelOptions(models, preferredModel) {
  if (!el.geminiModel) {
    return;
  }

  const safePreferred = getCurrentGeminiModelValue(preferredModel);
  const uniqueModels = Array.from(
    new Set((Array.isArray(models) ? models : []).map((x) => String(x || "").trim()).filter(Boolean))
  );

  el.geminiModel.innerHTML = "";

  if (!uniqueModels.length) {
    const fallback = document.createElement("option");
    fallback.value = safePreferred;
    fallback.textContent = `${safePreferred} (configured)`;
    el.geminiModel.appendChild(fallback);
    el.geminiModel.value = safePreferred;
    return;
  }

  uniqueModels.forEach((model) => {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    el.geminiModel.appendChild(option);
  });

  if (uniqueModels.includes(safePreferred)) {
    el.geminiModel.value = safePreferred;
  } else {
    const configured = document.createElement("option");
    configured.value = safePreferred;
    configured.textContent = `${safePreferred} (invalid/unavailable)`;
    el.geminiModel.appendChild(configured);

    const validDefault = uniqueModels.find((m) => m === "gemini-2.5-flash" || m === "gemini-3.5-flash") || uniqueModels[0];
    el.geminiModel.value = validDefault;
  }
}

async function refreshGeminiModels(showStatus = false) {
  if (!el.geminiApiKey || !el.geminiModel) {
    return;
  }

  const currentModel = getCurrentGeminiModelValue("gemini-2.5-flash");
  const rawKeyInput = String(el.geminiApiKey.value || "").trim();
  const apiKeyToUse = rawKeyInput.includes("•") ? "" : rawKeyInput;

  try {
    const result = assertOk(
      await window.pennyworth.listGeminiModels({ apiKey: apiKeyToUse }),
      "Failed to fetch Gemini model list."
    );

    const models = Array.isArray(result.models) ? result.models : [];
    setGeminiModelOptions(models, currentModel);

    if (showStatus) {
      const message =
        models.length > 0
          ? `Loaded ${models.length} Gemini model(s).`
          : "Connected to Gemini, but no models were returned.";
      setStatus(message, models.length > 0 ? "ok" : "error");
    }
  } catch (error) {
    setGeminiModelOptions([], currentModel);
    if (showStatus) {
      setStatus(`Could not load Gemini models. ${extractErrorText(error)}`, "error");
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

async function refreshVaultStatus() {
  if (!el.vaultStatusText) return;
  try {
    const res = await window.pennyworth.vaultStatus();
    if (res.ok) {
      if (res.hasSafeStorage) {
        el.vaultStatusText.textContent = "Status: Secure OS Keychain (safeStorage) connected. Local vault encryption passphrase is not required.";
        el.vaultSetupArea.classList.add("hidden");
        el.vaultUnlockArea.classList.add("hidden");
      } else if (!res.isSetup) {
        el.vaultStatusText.textContent = "Status: Secure keychain unavailable and Local Vault not initialized. Setting up local cloud keys requires initializing an encryption vault passphrase.";
        el.vaultSetupArea.classList.remove("hidden");
        el.vaultUnlockArea.classList.add("hidden");
      } else if (res.isLocked) {
        el.vaultStatusText.textContent = "Status: Local Vault is locked. Enter your master passphrase to unlock credentials.";
        el.vaultSetupArea.classList.add("hidden");
        el.vaultUnlockArea.classList.remove("hidden");
      } else {
        el.vaultStatusText.textContent = "Status: Local Vault is unlocked. API keys are ready.";
        el.vaultSetupArea.classList.add("hidden");
        el.vaultUnlockArea.classList.add("hidden");
      }
    } else {
      el.vaultStatusText.textContent = `Status Check Error: ${res.error}`;
    }
  } catch (err) {
    el.vaultStatusText.textContent = `Failed to query vault: ${err.message}`;
  }
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
  if (el.customCaCertPath) {
    el.customCaCertPath.value = providerConfig.customCaCertPath || "";
  }
  refreshVaultStatus();
  updateTracePanelVisibility();

  el.ollamaBaseUrl.value = providerConfig.providers.ollama.baseUrl;
  setOllamaModelOptions([], providerConfig.providers.ollama.model);

  el.openaiApiKey.value = providerConfig.providers.openai.maskedApiKey || "";
  setOpenAIModelOptions([], providerConfig.providers.openai.model);

  el.geminiApiKey.value = providerConfig.providers.gemini.maskedApiKey || "";
  setGeminiModelOptions([], providerConfig.providers.gemini.model);

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
    } else if (state.activeProviderTab === "openai") {
      refreshOpenAIModels(false);
    } else if (state.activeProviderTab === "gemini") {
      refreshGeminiModels(false);
    }
    refreshProviderHealth(false, false);
  } catch (error) {
    reportFailure("Settings error:", error, true);
  }
}

async function saveSettings() {
  const activeProvider = state.activeProviderTab || "ollama";
  const rawOpenaiKey = el.openaiApiKey.value.trim();
  const rawGeminiKey = el.geminiApiKey.value.trim();

  const openaiApiKey = rawOpenaiKey.includes("•") ? "" : rawOpenaiKey;
  const geminiApiKey = rawGeminiKey.includes("•") ? "" : rawGeminiKey;

  const payload = {
    agentContext: {
      docsRootUrlOverride: el.docsRootOverride.value.trim(),
      allowIpLocation: el.allowIpLocation.checked,
      devMode: Boolean(el.devMode?.checked),
      theme: el.themeSelect.value,
    },
    providerConfig: {
      defaultProvider: activeProvider,
      customCaCertPath: el.customCaCertPath.value.trim(),
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
