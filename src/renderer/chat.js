function showLoader(show) {
  el.loader.classList.toggle("hidden", !show);
}

function setBusy(isBusy) {
  state.isBusy = isBusy;
  if (el.newChatBtn) el.newChatBtn.disabled = isBusy;
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

function clearChatDisplay() {
  el.chat.innerHTML = "";
}

let sessionListCursor = null;
let sessionListLoading = false;
let historyLoadVersion = 0;
let olderMessageCursor = null;
function updateSessionSummary(session) {
  if (!session) return;
  const title = automaticSessionTitles.get(session.id) || session.title;
  state.sessions = [{ ...session, title }, ...state.sessions.filter(item => item.id !== session.id)]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  renderSessionsList();
}

const automaticSessionTitles = new Map();
let sessionTitleListenerReady = false;
function initSessionTitleListener() {
  if (sessionTitleListenerReady) return;
  sessionTitleListenerReady = true;
  window.pennyworth.onSessionUpdated?.(updateSessionSummary);
  window.pennyworth.onSessionRenamed?.(updated => {
  automaticSessionTitles.set(updated.id, updated.title);
  const session = state.sessions.find(item => item.id === updated.id);
  if (session) session.title = updated.title;
  // Update just the label so an in-progress manual edit keeps focus and text.
  for (const item of el.sessionsList?.children || []) {
    if (item.dataset.id === updated.id) {
      const label = item.querySelector(".session-title");
      if (label) label.textContent = updated.title;
    }
  }
  });
}

function renderSessionsList() {
  if (!el.sessionsList) return;
  el.sessionsList.innerHTML = "";

  state.sessions.forEach((session) => {
    const item = document.createElement("div");
    item.className = `session-item${session.id === state.activeSessionId ? " active" : ""}`;
    item.dataset.id = session.id;

    const title = document.createElement("span");
    title.className = "session-title";
    title.textContent = session.title || "Untitled Chat";
    item.appendChild(title);

    const renameBtn = document.createElement("button");
    renameBtn.className = "rename-session-btn";
    renameBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/></svg>';
    renameBtn.title = "Rename conversation";
    renameBtn.type = "button";
    renameBtn.setAttribute("aria-label", `Rename ${session.title || "conversation"}`);
    renameBtn.addEventListener("click", event => {
      event.stopPropagation();
      if (item.querySelector("input")) return;
      const input = document.createElement("input");
      input.className = "session-rename-input";
      input.value = session.title || "";
      input.maxLength = 80;
      input.setAttribute("aria-label", "Conversation title; Enter to save, Escape to cancel");
      input.title = "Enter to save, Escape to cancel";
      item.classList.add("is-renaming");
      title.replaceWith(input);
      input.focus();
      input.select();
      let saving = false;
      input.addEventListener("click", event => event.stopPropagation());
      input.addEventListener("keydown", async event => {
        event.stopPropagation();
        if (event.key === "Escape") { renderSessionsList(); return; }
        if (event.key !== "Enter" || saving) return;
        event.preventDefault();
        saving = true;
        try {
          const result = await window.pennyworth.renameSession(session.id, input.value);
          if (!result.ok) throw new Error(result.error);
          automaticSessionTitles.set(session.id, result.session.title);
          session.title = result.session.title;
          renderSessionsList();
          setStatus("Conversation renamed.", "ok");
        } catch (error) { setStatus(error.message, "error"); }
        finally { saving = false; }
      });
    });
    item.appendChild(renameBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-session-btn";
    deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';
    deleteBtn.setAttribute("aria-label", `Delete ${session.title || "conversation"}`);
    deleteBtn.title = "Delete Chat";
    deleteBtn.type = "button";
    
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await deleteSessionFlow(session.id);
    });

    item.appendChild(deleteBtn);

    item.addEventListener("click", () => {
      if (session.id !== state.activeSessionId) {
        switchSessionFlow(session.id);
      }
    });

    el.sessionsList.appendChild(item);
  });
  if (sessionListCursor) {
    const more = document.createElement("button");
    more.className = "history-load-more";
    more.textContent = sessionListLoading ? "Loading…" : "Load more conversations";
    more.disabled = sessionListLoading;
    more.addEventListener("click", () => loadSessionsFlow(true));
    el.sessionsList.appendChild(more);
  }
}

async function loadSessionsFlow(append = false) {
  initSessionTitleListener();
  if (sessionListLoading) return false;
  sessionListLoading = true;
  renderSessionsList();
  try {
    const result = await window.pennyworth.listSessions({ cursor: append ? sessionListCursor : null, limit: 50 });
    if (!result.ok) throw new Error(result.error);
    const existing = append ? state.sessions : [];
    const merged = new Map(existing.map(session => [session.id, session]));
    for (const session of result.sessions || []) {
      merged.set(session.id, { ...session, title: automaticSessionTitles.get(session.id) || session.title });
    }
    state.sessions = [...merged.values()];
    sessionListCursor = result.nextCursor;
    if (result.migrationWarnings?.length) {
      pushNotification("error", `${result.migrationWarnings.length} conversation file(s) could not be imported. Originals are preserved; see README recovery instructions.`);
    }
    return true;
  } catch (error) { setStatus(`Could not load conversations: ${error.message}`, "error"); return false; }
  finally { sessionListLoading = false; renderSessionsList(); }
}

function renderHistoryMessages(messages, target) {
  for (const msg of messages) {
    const status = msg.status && msg.status !== "complete" ? ` · ${msg.status}` : "";
    appendMessage(msg.role, msg.content, `${msg.role === "user" ? "You" : "Pennyworth"}${status}`, target);
  }
}
function addOlderMessagesControl(version) {
  if (!olderMessageCursor) return;
  const button = document.createElement("button");
  button.className = "history-load-more";
  button.textContent = "Load older messages";
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Loading…";
    try {
      const result = await window.pennyworth.loadSession(state.activeSessionId, { before: olderMessageCursor, limit: 50 });
      if (version !== historyLoadVersion) return;
      if (!result.ok) throw new Error(result.error);
      const previousHeight = el.chat.scrollHeight;
      const previousTop = el.chat.scrollTop;
      const fragment = document.createDocumentFragment();
      renderHistoryMessages(result.session.messages, fragment);
      button.remove();
      el.chat.prepend(fragment);
      olderMessageCursor = result.nextBefore;
      addOlderMessagesControl(version);
      el.chat.scrollTop = previousTop + el.chat.scrollHeight - previousHeight;
    } catch (error) {
      if (version === historyLoadVersion) {
        setStatus(`Could not load older messages: ${error.message}`, "error");
        button.disabled = false;
        button.textContent = "Retry loading older messages";
      }
    }
  });
  el.chat.prepend(button);
}

async function checkActiveProviderStatus() {
  try {
    const active = activeProviderName();
    if (!active) return false;
    
    const healthResult = await window.pennyworth.getProviderHealth({
      providerConfig: state.runtime.providerConfig,
    });
    if (healthResult.ok && healthResult.health) {
      const activeHealth = healthResult.health[active];
      return isProviderConnected(activeHealth);
    }
  } catch (e) {
    console.error("Failed to check active provider status:", e);
  }
  return false;
}

async function switchSessionFlow(sessionId) {
  if (state.isBusy) return;
  const version = ++historyLoadVersion;
  try {
    setBusy(true);
    setStatus("Loading conversation...");
    const result = await window.pennyworth.loadSession(sessionId);
    if (result.ok) {
      state.activeSessionId = sessionId;
      state.history = (result.session.messages || []).filter(msg => msg.status === "complete").slice(-8);
      olderMessageCursor = result.nextBefore;
      state.lastToolTrace = [];
      renderToolTrace([]);
      
      clearChatDisplay();
      
      const fragment = document.createDocumentFragment();
      renderHistoryMessages(result.session.messages, fragment);
      el.chat.appendChild(fragment);
      addOlderMessagesControl(version);
      el.chat.scrollTop = el.chat.scrollHeight;

      if (!result.session.messages.length) {
        const hasProvider = await checkActiveProviderStatus();
        if (!hasProvider) {
          appendWelcomeSetupCard();
        } else {
          const systemName = state.system?.distro?.prettyName || state.system?.platform || "PC";
          appendMessage(
            "assistant",
            `Pennyworth ready. System context initialized for ${systemName}. How can I assist you with your system configurations or package management today?`,
            "Pennyworth"
          );
        }
      }

      renderSessionsList();
      setStatus("Ready");
    } else {
      setStatus("Failed to load session.", "error");
    }
  } catch (error) {
    console.error("Failed to switch session:", error);
    setStatus("Error loading session.", "error");
  } finally {
    setBusy(false);
  }
}

async function createNewSessionFlow() {
  if (state.isBusy) return;
  try {
    setBusy(true);
    setStatus("Creating new chat...");
    const result = await window.pennyworth.newSession();
    if (result.ok) {
      historyLoadVersion += 1;
      olderMessageCursor = null;
      state.activeSessionId = result.sessionId;
      state.history = [];
      state.lastToolTrace = [];
      renderToolTrace([]);
      clearChatDisplay();

      const hasProvider = await checkActiveProviderStatus();
      if (!hasProvider) {
        appendWelcomeSetupCard();
      } else {
        const systemName = state.system?.distro?.prettyName || state.system?.platform || "PC";
        appendMessage(
          "assistant",
          `Pennyworth ready. System context initialized for ${systemName}. How can I assist you with your system configurations or package management today?`,
          "Pennyworth"
        );
      }

      updateSessionSummary(result.session);
      setStatus("New chat ready.");
    } else {
      setStatus(`Failed to create new chat: ${extractErrorText(result.error)}`, "error");
    }
  } catch (error) {
    console.error("Failed to create new session:", error);
    setStatus(`Error creating new chat: ${error.message}`, "error");
  } finally {
    setBusy(false);
  }
}

async function deleteSessionFlow(sessionId) {
  if (state.isBusy) return;
  const confirmDelete = confirm("Are you sure you want to delete this chat session?");
  if (!confirmDelete) return;

  try {
    setStatus("Deleting chat...");
    const result = await window.pennyworth.deleteSession(sessionId);
    if (result.ok) {
      await loadSessionsFlow();
      if (state.activeSessionId === sessionId) {
        if (state.sessions.length > 0) {
          await switchSessionFlow(state.sessions[0].id);
        } else {
          await createNewSessionFlow();
        }
      }
      setStatus("Chat deleted.");
    } else {
      setStatus("Failed to delete chat.", "error");
    }
  } catch (error) {
    console.error("Failed to delete session:", error);
    setStatus("Error deleting chat.", "error");
  }
}

function appendMessage(role, text, meta, target = el.chat) {
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
  target.appendChild(wrapper);
  if (target === el.chat) el.chat.scrollTop = el.chat.scrollHeight;
  return wrapper;
}

function escapeHtml(input) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderMarkdown(input) {
  if (!input) return "";

  // 1. Extract and preserve code blocks securely using unique random placeholders
  const codeBlocks = [];
  const tokenPrefix = `__PW_CODE_BLOCK_${Math.random().toString(36).slice(2)}_${Date.now()}_`;
  
  let processed = String(input).replace(/```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g, (_m, lang, code) => {
    const idx = codeBlocks.length;
    const safeCode = escapeHtml(code);
    const safeLang = lang ? escapeHtml(lang) : "";
    const languageAttr = safeLang ? ` class="lang-${safeLang}"` : "";
    codeBlocks.push(`<pre><code${languageAttr}>${safeCode}</code></pre>`);
    return `${tokenPrefix}${idx}__`;
  });

  // 2. Escape remaining raw text to prevent any HTML injection
  processed = escapeHtml(processed);

  // 3. Process inline markdown formatting safely on escaped text
  processed = processed.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  processed = processed.replace(/\*\*([^*][\s\S]*?)\*\*/g, "<strong>$1</strong>");
  processed = processed.replace(/(^|\s)\*([^*\n][\s\S]*?)\*(?=\s|$)/g, "$1<em>$2</em>");
  // Support all six heading levels and tolerate numbered headings such as
  // "####2. Limit Flatpak". Preserve the existing compact h2–h4 sizing.
  processed = processed.replace(/^[ \t]{0,3}(#{1,6})(?!#)(?:[ \t]+|(?=\d+[.)]?(?:[ \t]|$)))([^\r\n]+)$/gm, (_match, hashes, title) => {
    const level = Math.min(hashes.length + 1, 6);
    return `<h${level}>${title}</h${level}>`;
  });
  processed = processed.replace(/^\s*-\s+(.+)$/gm, "- $1");
  processed = processed.replace(/\n/g, "<br>");

  // 4. Re-insert preserved safe code blocks
  codeBlocks.forEach((htmlBlock, idx) => {
    const placeholder = escapeHtml(`${tokenPrefix}${idx}__`);
    processed = processed.replace(placeholder, htmlBlock);
  });

  return processed;
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
  if (!el.profileSelect) return;
  el.profileSelect.innerHTML = "";
  const option = document.createElement("option");
  option.value = state.runtime?.profileId || "";
  option.textContent = state.runtime?.profile?.name || "Select OS Profile";
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

function appendWelcomeSetupCard() {
  const cardId = "welcomeSetupCard";
  if (document.getElementById(cardId)) return;

  const wrapper = document.createElement("article");
  wrapper.className = "message assistant welcome-card-wrapper";
  wrapper.id = cardId;

  const content = document.createElement("div");
  content.className = "message-body welcome-card-body";
  content.innerHTML = `
    <h3 style="margin-top:0; color:var(--accent); font-size:1.15rem;">Welcome to Pennyworth!</h3>
    <p style="font-size:0.88rem; line-height:1.45; color:var(--text); margin-bottom:14px;">To begin using your local PC copilot, choose one of the options below to configure an LLM provider:</p>
    
    <div class="setup-options-container" style="display:flex; flex-direction:column; gap:12px; margin: 16px 0;">
      <div class="setup-option-card" style="border:1px solid var(--border); padding:14px; border-radius:8px; background:rgba(0,0,0,0.02); text-align:left;">
        <strong style="color:var(--text); font-size:0.92rem; display:block; margin-bottom:4px;">Option 1: Connect Local Ollama</strong>
        <span style="font-size:0.8rem; color:var(--muted); display:block; margin-bottom:12px;">Connects to an installed Ollama service and downloads <strong>Qwen 2.5 Coder 1.5B</strong>. Starting the service may request approval. Model downloads need internet access; inference runs locally.</span>
        <button id="setupLocalOllamaBtn" class="no-drag" type="button" style="background:var(--accent); color:white; border:none; padding:8px 14px; border-radius:6px; cursor:pointer; font-weight:600; font-size:0.82rem; transition: background 0.2s;">Download & Set Up Local LLM</button>
      </div>
      
      <div class="setup-option-card" style="border:1px solid var(--border); padding:14px; border-radius:8px; background:rgba(0,0,0,0.02); text-align:left;">
        <strong style="color:var(--text); font-size:0.92rem; display:block; margin-bottom:4px;">Option 2: Connect Cloud API Key</strong>
        <span style="font-size:0.8rem; color:var(--muted); display:block; margin-bottom:12px;">Configure OpenAI, Gemini, or an existing Ollama endpoint manually.</span>
        <button id="setupCloudBtn" class="no-drag" type="button" style="background:var(--surface-2); color:var(--text); border:1px solid var(--border); padding:8px 14px; border-radius:6px; cursor:pointer; font-weight:600; font-size:0.82rem; transition: background 0.2s;">Open Settings API Panel</button>
      </div>
    </div>
    
    <div id="setupProgressArea" class="hidden" style="margin-top:16px; border-top:1px solid var(--border); padding-top:16px; text-align:left;">
      <h4 style="margin:0 0 8px; color:var(--text); font-size:0.85rem;" id="setupProgressTitle">Onboarding Progress</h4>
      <div style="width:100%; height:6px; background:var(--border); border-radius:3px; overflow:hidden; margin-bottom:8px;">
        <div id="setupProgressBar" style="width:0%; height:100%; background:var(--accent); transition:width 0.2s;"></div>
      </div>
      <p id="setupProgressStatus" style="font-size:0.78rem; color:var(--muted); margin:0;">Waiting to start...</p>
    </div>
  `;

  wrapper.appendChild(content);
  el.chat.appendChild(wrapper);
  el.chat.scrollTop = el.chat.scrollHeight;

  const localBtn = wrapper.querySelector("#setupLocalOllamaBtn");
  const cloudBtn = wrapper.querySelector("#setupCloudBtn");
  const progressArea = wrapper.querySelector("#setupProgressArea");
  const progressBar = wrapper.querySelector("#setupProgressBar");
  const progressStatus = wrapper.querySelector("#setupProgressStatus");
  const progressTitle = wrapper.querySelector("#setupProgressTitle");

  cloudBtn.addEventListener("click", () => {
    openSettingsModal();
  });

  localBtn.addEventListener("click", async () => {
    localBtn.disabled = true;
    cloudBtn.disabled = true;
    progressArea.classList.remove("hidden");
    
    try {
      progressTitle.textContent = "Bootstrapping Ollama...";
      progressStatus.textContent = "Connecting to Ollama (starting the service may request approval)...";
      progressBar.style.width = "10%";

      const installRes = await window.pennyworth.bootstrapOllama();
      if (!installRes.ok) {
        throw new Error(installRes.error || "Ollama could not be connected or started.");
      }

      progressBar.style.width = "40%";
      progressStatus.textContent = "Ollama service is running.";

      if (window.pennyworth.showNativeNotification) {
        window.pennyworth.showNativeNotification({
          title: "Pennyworth - Ollama Installed",
          body: "Ollama service is ready. Now downloading model..."
        });
      }
      if (typeof pushNotification === "function") {
        pushNotification("ok", "Ollama service is running.");
      }

      progressBar.style.width = "50%";
      progressStatus.textContent = "Downloading Qwen 2.5 Coder 1.5B model from Ollama registry...";

      const pullRes = await window.pennyworth.bootstrapPullModel("qwen2.5:1.5b");
      if (!pullRes.ok) {
        throw new Error(pullRes.error || "Failed to download model.");
      }

      if (window.pennyworth.showNativeNotification) {
        window.pennyworth.showNativeNotification({
          title: "Pennyworth - Model Pulled",
          body: "Model qwen2.5:1.5b downloaded successfully!"
        });
      }
      if (typeof pushNotification === "function") {
        pushNotification("ok", "Model qwen2.5:1.5b downloaded successfully.");
      }

      progressBar.style.width = "90%";
      progressStatus.textContent = "Configuring Pennyworth default settings...";

      const configRes = await window.pennyworth.bootstrapSetDefaultProvider("ollama", "qwen2.5:1.5b");
      if (!configRes.ok) {
        throw new Error(configRes.error || "Failed to set default provider.");
      }

      progressBar.style.width = "100%";
      progressStatus.textContent = "Success! Local setup complete. Reloading application...";
      progressTitle.textContent = "Setup Successful!";

      if (window.pennyworth.showNativeNotification) {
        window.pennyworth.showNativeNotification({
          title: "Pennyworth Ready",
          body: "Local setup complete! You can now start using Pennyworth with Qwen 2.5 Coder."
        });
      }
      
      setTimeout(async () => {
        wrapper.remove();
        await loadRuntime();
        refreshProviderHealth(false, false);
      }, 2000);

    } catch (err) {
      localBtn.disabled = false;
      cloudBtn.disabled = false;
      progressStatus.textContent = `Error: ${err.message}`;
      progressBar.style.width = "0%";
      progressTitle.textContent = "Setup Failed";

      if (window.pennyworth.showNativeNotification) {
        window.pennyworth.showNativeNotification({
          title: "Pennyworth - Setup Error",
          body: `Ollama setup failed: ${err.message}`
        });
      }
      if (typeof pushNotification === "function") {
        pushNotification("error", `Setup failed: ${err.message}`);
      }
    }
  });
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

  const checkedSession = state.activeSessionId;
  const providerReady = await ensureActiveProviderForAsk();
  if (!providerReady || state.isBusy || checkedSession !== state.activeSessionId) {
    return;
  }

  const requestSessionId = state.activeSessionId;
  const userMessage = appendMessage("user", question, "You · sending");
  state.history.push({ role: "user", content: question });
  el.promptInput.value = "";

  state.lastToolTrace = [];
  renderToolTrace([]);
  setBusy(true);
  setStatus("Pennyworth is working...");

  try {
    const result = await window.pennyworth.ask({
      question,
      screenshotAttached: Boolean(state.screenshotData),
      screenshotData: state.screenshotData || null,
      sessionId: requestSessionId,
    });

    userMessage.querySelector(".message-meta").textContent = result.ok && !result.saveError ? "You" :
      `You · ${result.session ? (/AGENT_STOPPED/.test(String(result.error)) ? "cancelled" : "failed") : "not saved"}`;
    updateSessionSummary(result.session);
    if (result.saveError) pushNotification("error", result.saveError);
    if (!result.ok) {
      let providerHintShown = false;
      const details = extractErrorText(result.error, "");
      if (details.includes("AGENT_STOPPED") || details.includes("Execution terminated by user")) {
        setStatus("Agent stopped.", "warn");
        return;
      }
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

    state.history = state.history.slice(-8);
    updateBadges(result.provider);
    if (state.screenshotData) {
      setCapturedImage(null);
    }
    setStatus(result.saveError || "Answer ready.", result.saveError ? "error" : "ok");
  } catch (error) {
    userMessage.querySelector(".message-meta").textContent = "You · delivery uncertain";
    reportFailure("Agent invocation failed:", error, true);
  } finally {
    setBusy(false);
  }
}

let voiceState = {
  active: false,
  stream: null,
  audioCtx: null,
  processor: null,
  baseText: "",
  committedText: "",
  lastPartialText: "",
  isListenerSet: false,
};

function downsampleBuffer(buffer, inputSampleRate, targetSampleRate = 16000) {
  if (inputSampleRate === targetSampleRate) return buffer;
  const ratio = inputSampleRate / targetSampleRate;
  const newLength = Math.floor(buffer.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const originPos = i * ratio;
    const index = Math.floor(originPos);
    const decimal = originPos - index;
    const nextIndex = Math.min(index + 1, buffer.length - 1);
    result[i] = buffer[index] * (1 - decimal) + buffer[nextIndex] * decimal;
  }
  return result;
}

function initLiveTranscriptListener() {
  if (voiceState.isListenerSet || !window.pennyworth?.onLiveTranscriptPartial) return;
  voiceState.isListenerSet = true;
  window.pennyworth.onVoiceStatus?.(({ stage } = {}) => {
    const messages = {
      loading: "Preparing local speech model. First use may require a download.",
      transcribing: "Transcribing voice on this device...",
      complete: "Local transcription complete.",
      error: "Local transcription failed. Please retry; first use requires a model download.",
    };
    if (messages[stage]) setStatus(messages[stage], stage === "error" ? "error" : "ok");
  });

  window.pennyworth.onLiveTranscriptPartial((data) => {
    if (data?.text) {
      const liveText = data.text.trim();
      if (liveText) {
        if (data.isFinal) {
          // Final transcript cleanly replaces live stream partials
          voiceState.committedText = liveText;
          voiceState.lastPartialText = "";
        } else {
          // Detect new sentence segment after a pause and commit previous segment
          if (
            voiceState.lastPartialText &&
            !liveText.toLowerCase().startsWith(voiceState.lastPartialText.toLowerCase()) &&
            !voiceState.committedText.endsWith(voiceState.lastPartialText)
          ) {
            voiceState.committedText = voiceState.committedText
              ? `${voiceState.committedText} ${voiceState.lastPartialText}`
              : voiceState.lastPartialText;
          }
          voiceState.lastPartialText = liveText;
        }

        if (el.promptInput) {
          const currentLive = data.isFinal ? "" : voiceState.lastPartialText;
          const textToRender = data.isFinal ? liveText : voiceState.committedText;
          const combined = [voiceState.baseText, textToRender, currentLive]
            .filter(Boolean)
            .join(" ")
            .trim();

          el.promptInput.value = combined;
          el.promptInput.focus();
          el.promptInput.selectionStart = el.promptInput.value.length;
          el.promptInput.selectionEnd = el.promptInput.value.length;
        }
        setStatus(data.isFinal ? "Voice captured." : "Transcribing voice...", "ok");
      }
    }
  });
}

async function startVoiceInput() {
  if (voiceState.active) {
    stopVoiceInput();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Speech recognition is not available in this environment.", "error");
    return;
  }

  try {
    initLiveTranscriptListener();

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceState.stream = stream;
    voiceState.baseText = el.promptInput?.value ? el.promptInput.value.trim() : "";
    voiceState.committedText = "";
    voiceState.lastPartialText = "";
    voiceState.active = true;

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    voiceState.audioCtx = audioCtx;

    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    voiceState.processor = processor;

    const muteGain = audioCtx.createGain();
    muteGain.gain.value = 0;

    processor.onaudioprocess = (e) => {
      if (!voiceState.active) return;
      const inputData = e.inputBuffer.getChannelData(0);
      const resampled = downsampleBuffer(inputData, audioCtx.sampleRate, 16000);
      const pcmSamples = Array.from(resampled);
      if (window.pennyworth?.sendAudioStreamChunk) {
        window.pennyworth.sendAudioStreamChunk({ pcmSamples });
      }
    };

    source.connect(processor);
    processor.connect(muteGain);
    muteGain.connect(audioCtx.destination);

    if (el.voiceBtn) {
      el.voiceBtn.classList.add("recording");
      el.voiceBtn.textContent = "Stop (Mic)";
    }
    setStatus("Listening...", "ok");
  } catch (err) {
    setStatus("Microphone access denied or unavailable.", "error");
    stopVoiceInput();
  }
}

function stopVoiceInput() {
  voiceState.active = false;

  if (window.pennyworth?.stopAudioStream) {
    window.pennyworth.stopAudioStream();
  }

  if (voiceState.processor) {
    try {
      voiceState.processor.disconnect();
    } catch (e) {}
    voiceState.processor = null;
  }

  if (voiceState.audioCtx && voiceState.audioCtx.state !== "closed") {
    try {
      voiceState.audioCtx.close().catch(() => {});
    } catch (e) {}
    voiceState.audioCtx = null;
  }

  if (voiceState.stream) {
    try {
      voiceState.stream.getTracks().forEach((track) => track.stop());
    } catch (e) {}
    voiceState.stream = null;
  }

  if (el.voiceBtn) {
    el.voiceBtn.classList.remove("recording");
    el.voiceBtn.textContent = "Voice";
  }

  if (el.promptInput) {
    el.promptInput.focus();
  }

  setStatus("Voice input disabled.", "ok");
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
