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

function clearChatDisplay() {
  el.chat.innerHTML = "";
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

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-session-btn";
    deleteBtn.innerHTML = "🗑";
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
}

async function loadSessionsFlow() {
  try {
    const result = await window.pennyworth.listSessions();
    if (result.ok) {
      state.sessions = result.sessions || [];
      renderSessionsList();
    }
  } catch (error) {
    console.error("Failed to load sessions:", error);
  }
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
  try {
    setBusy(true);
    setStatus("Loading conversation...");
    const result = await window.pennyworth.loadSession(sessionId);
    if (result.ok) {
      state.activeSessionId = sessionId;
      state.history = result.session.messages || [];
      state.lastToolTrace = [];
      renderToolTrace([]);
      
      clearChatDisplay();
      
      state.history.forEach((msg) => {
        const label = msg.role === "user" ? "You" : "Hermes";
        appendMessage(msg.role, msg.content, label);
      });

      if (state.history.length === 0) {
        const hasProvider = await checkActiveProviderStatus();
        if (!hasProvider) {
          appendWelcomeSetupCard();
        } else {
          const systemName = state.system?.distro?.prettyName || state.system?.platform || "PC";
          appendMessage(
            "assistant",
            `Hermes Agent ready. System context initialized for ${systemName}. How can I assist you with your system configurations or package management today?`,
            "Hermes"
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
  try {
    setBusy(true);
    setStatus("Creating new chat...");
    const result = await window.pennyworth.newSession();
    if (result.ok) {
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
          `Hermes Agent ready. System context initialized for ${systemName}. How can I assist you with your system configurations or package management today?`,
          "Hermes"
        );
      }

      await loadSessionsFlow();
      setStatus("New chat ready.");
    } else {
      setStatus("Failed to create new chat.", "error");
    }
  } catch (error) {
    console.error("Failed to create new session:", error);
    setStatus("Error creating new chat.", "error");
  } finally {
    setBusy(false);
  }
}

async function deleteSessionFlow(sessionId) {
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
    const language = lang ? ` class="lang-${lang}"` : "";
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
        <strong style="color:var(--text); font-size:0.92rem; display:block; margin-bottom:4px;">Option 1: Bootstrap Local Ollama (Recommended)</strong>
        <span style="font-size:0.8rem; color:var(--muted); display:block; margin-bottom:12px;">Installs Ollama, starts the local service, and downloads <strong>Qwen 2.5 Coder 1.5B</strong> automatically. Safe, private, and works offline.</span>
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
      progressStatus.textContent = "Installing Ollama on your system (this may request authorization)...";
      progressBar.style.width = "10%";

      const installRes = await window.pennyworth.bootstrapOllama();
      if (!installRes.ok) {
        throw new Error(installRes.error || "Ollama installation failed.");
      }

      progressBar.style.width = "40%";
      progressStatus.textContent = "Ollama installed & service running.";

      if (window.pennyworth.showNativeNotification) {
        window.pennyworth.showNativeNotification({
          title: "Pennyworth - Ollama Installed",
          body: "Ollama service installed & started successfully. Now downloading model..."
        });
      }
      if (typeof pushNotification === "function") {
        pushNotification("ok", "Ollama installed & background service running.");
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
      sessionId: state.activeSessionId,
    });

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

    await loadSessionsFlow();
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

  window.pennyworth.onLiveTranscriptPartial((data) => {
    if (data?.text) {
      const liveText = data.text.trim();
      if (liveText) {
        if (data.isFinal) {
          if (voiceState.lastPartialText && !voiceState.committedText.endsWith(voiceState.lastPartialText)) {
            voiceState.committedText = voiceState.committedText
              ? `${voiceState.committedText} ${voiceState.lastPartialText}`
              : voiceState.lastPartialText;
          } else if (!voiceState.lastPartialText && !voiceState.committedText.endsWith(liveText)) {
            voiceState.committedText = voiceState.committedText
              ? `${voiceState.committedText} ${liveText}`
              : liveText;
          }
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
          const combined = [voiceState.baseText, voiceState.committedText, currentLive]
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
