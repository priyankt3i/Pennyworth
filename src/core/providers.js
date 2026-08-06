const axios = require("axios");
const https = require("https");
const fs = require("fs");
require("dotenv").config();

const {
  getOpenAIToolDefinitions,
  getGeminiFunctionDeclarations,
  executeToolFunction,
  runAgentTooling,
} = require("./tools");

function buildSystemPrompt(context) {
  const { systemContext, distroProfile, retrievedDocs, memories = [] } = context;
  const memorySection = memories.length > 0
    ? [
        "Butler Memory (Persistent facts you have learned/saved about this system/user):",
        ...memories.map((m) => `- [${new Date(m.at).toLocaleDateString()}] ${m.fact}`),
      ].join("\n")
    : "Butler Memory: No persistent facts recorded yet.";

  return [
    "You are Hermes, the advanced agentic PC and Linux system handler inside Pennyworth.",
    "Your goal is to help users manage, configure, troubleshoot, and interact with their host operating system.",
    "You have access to powerful system tools: `execute_system_command`, `read_system_file`, `write_system_file`, `get_system_status`, `remember_fact`, and `recall_facts`.",
    "Before running any command that installs packages, modifies configuration files, or performs potentially destructive actions, explain the proposed steps, risk score, and required privileges to the user.",
    "If a command requires root privileges (sudo) on Linux, prefer using `pkexec` (e.g. `pkexec pacman -S package`) to prompt the user with a graphical authorization dialog, or explain that they will be asked to authorize via the app's confirmation dialog.",
    "Style: precise, technical, prompt, helpful.",
    "For troubleshooting issues (e.g. broken packages, configuration errors, process management):",
    "  1. Gather info: check system logs or files using `read_system_file` or check statuses using `get_system_status`.",
    "  2. Propose plan: explain what is wrong and what commands you will execute.",
    "  3. Execute: execute the corrective commands via `execute_system_command`.",
    "  4. Verify: run a verification check to ensure the problem is solved.",
    memorySection,
    "Current system context:",
    JSON.stringify(systemContext, null, 2),
    "Configured distro profile:",
    JSON.stringify(distroProfile, null, 2),
    "Retrieved local docs context:",
    JSON.stringify(retrievedDocs, null, 2),
  ].join("\n\n");
}

function parseImageDataUrl(dataUrl) {
  const value = String(dataUrl || "").trim();
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(value);
  if (!match) {
    return null;
  }

  const mimeType = String(match[1] || "").trim().toLowerCase();
  const base64 = String(match[2] || "").replace(/\s+/g, "");
  if (!mimeType || !base64) {
    return null;
  }

  return {
    mimeType,
    base64,
    dataUrl: value,
  };
}

function buildUserTextWithImageFallback(userPrompt, screenshotAttached, hasImagePayload) {
  if (screenshotAttached && !hasImagePayload) {
    return `${userPrompt}\n\n[User attached a screenshot region, but image data was unavailable. Ask follow-up questions if visual context is required.]`;
  }
  return userPrompt;
}

function normalizeHistory(history = []) {
  return history
    .slice(-8)
    .filter((msg) => msg && typeof msg === "object")
    .map((msg) => ({
      role: msg.role,
      content: String(msg.content || ""),
    }))
    .filter((msg) => msg.role === "user" || msg.role === "assistant");
}

function buildOllamaMessages(context) {
  const imagePayload = parseImageDataUrl(context.screenshotData);
  const userText = buildUserTextWithImageFallback(
    context.userPrompt,
    context.screenshotAttached,
    Boolean(imagePayload)
  );

  const userMessage = {
    role: "user",
    content: userText,
  };

  if (imagePayload) {
    userMessage.images = [imagePayload.base64];
  }

  return [
    { role: "system", content: buildSystemPrompt(context) },
    ...normalizeHistory(context.history),
    userMessage,
  ];
}

function buildOpenAIMessages(context) {
  const imagePayload = parseImageDataUrl(context.screenshotData);
  const userText = buildUserTextWithImageFallback(
    context.userPrompt,
    context.screenshotAttached,
    Boolean(imagePayload)
  );

  const userMessage = imagePayload
    ? {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: imagePayload.dataUrl } },
        ],
      }
    : {
        role: "user",
        content: userText,
      };

  return [
    { role: "system", content: buildSystemPrompt(context) },
    ...normalizeHistory(context.history),
    userMessage,
  ];
}

function buildGeminiContents(context) {
  const imagePayload = parseImageDataUrl(context.screenshotData);
  const userText = buildUserTextWithImageFallback(
    context.userPrompt,
    context.screenshotAttached,
    Boolean(imagePayload)
  );

  const contents = [];
  for (const msg of normalizeHistory(context.history)) {
    const role = msg.role === "assistant" ? "model" : "user";
    contents.push({
      role,
      parts: [{ text: String(msg.content || "") }],
    });
  }

  const userParts = [{ text: userText }];
  if (imagePayload) {
    userParts.push({
      inlineData: {
        mimeType: imagePayload.mimeType,
        data: imagePayload.base64,
      },
    });
  }

  contents.push({
    role: "user",
    parts: userParts,
  });

  return contents;
}

function safeJsonParse(value) {
  if (!value || typeof value !== "string") {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function compactValue(value, max = 700) {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  if (!raw) {
    return "";
  }
  if (raw.length <= max) {
    return raw;
  }
  return `${raw.slice(0, max)} ...`;
}

let currentSessionCancelled = false;

function cancelCurrentSession() {
  currentSessionCancelled = true;
}

function checkCancellation() {
  if (currentSessionCancelled) {
    const err = new Error("AGENT_STOPPED: Execution terminated by user.");
    err.code = "AGENT_STOPPED";
    throw err;
  }
}

function pushTrace(context, event) {
  if (!Array.isArray(context?.toolTrace)) {
    return;
  }

  const traceEvent = {
    at: new Date().toISOString(),
    ...event,
  };
  context.toolTrace.push(traceEvent);

  try {
    const electron = require("electron");
    const win = electron.BrowserWindow.getFocusedWindow() || electron.BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send("pennyworth:trace-event", traceEvent);
    }
  } catch (e) {
    // Fail silently outside Electron process context
  }
}

function isSmallTalkPrompt(prompt) {
  const text = String(prompt || "").trim().toLowerCase();
  return /^(hi|hello|hey|yo|sup|good morning|good afternoon|good evening|thanks|thank you|thx|how are you(?: doing)?)\b/.test(
    text
  );
}

function shouldAutoWebSearchFromReply(userPrompt, reply) {
  const prompt = String(userPrompt || "").trim();
  const answer = String(reply || "").trim();

  if (!prompt || !answer || isSmallTalkPrompt(prompt)) {
    return false;
  }

  const asksQuestion = /\?|^(who|what|when|where|why|how|which)\b/i.test(prompt);
  if (!asksQuestion) {
    return false;
  }

  const uncertainPatterns = [
    /\bnot applicable\b/i,
    /\b(?:do not|don't)\s+know\b/i,
    /\bnot sure\b/i,
    /\b(?:cannot|can't|unable to)\b/i,
    /\bno (?:internet|web|live data|access)\b/i,
    /\bas an ai\b/i,
  ];

  return uncertainPatterns.some((pattern) => pattern.test(answer));
}

async function runToolAndFormat(name, args, context, providerName) {
  pushTrace(context, {
    stage: "tool_exec_start",
    provider: providerName,
    tool: name,
    args: compactValue(args),
  });

  try {
    const result = await executeToolFunction(name, args, {
      question: context.userPrompt,
      systemContext: context.systemContext,
      agentContext: context.agentContext,
      httpsAgent: context.httpsAgent,
    });

    pushTrace(context, {
      stage: "tool_exec_result",
      provider: providerName,
      tool: name,
      result: compactValue(result, 1200),
    });

    return result;
  } catch (error) {
    const failure = `Tool '${name}' failed: ${error.message}`;
    pushTrace(context, {
      stage: "tool_exec_error",
      provider: providerName,
      tool: name,
      error: error.message,
    });
    return failure;
  }
}

async function askOllama(config, context) {
  const fallbackTool = await runAgentTooling({
    question: context.userPrompt,
    systemContext: context.systemContext,
    agentContext: context.agentContext,
  });
  if (fallbackTool?.handled) {
    pushTrace(context, {
      stage: "fallback_tool_router",
      provider: "ollama",
      tool: fallbackTool.tool,
      result: compactValue(fallbackTool.reply, 1200),
    });
    return fallbackTool.reply;
  }

  const baseUrl = config.baseUrl || "http://127.0.0.1:11434";
  const model = config.model || process.env.OLLAMA_MODEL || "llama3.2";
  const messages = buildOllamaMessages(context);
  const tools = getOpenAIToolDefinitions(); // Ollama uses OpenAI-compatible tool specifications

  for (let step = 0; step < 4; step += 1) {
    checkCancellation();
    const response = await axios.post(`${baseUrl}/api/chat`, {
      model,
      messages,
      tools,
      stream: false,
      options: {
        temperature: 0.2,
      },
    }, {
      httpsAgent: context.httpsAgent,
    });

    const message = response?.data?.message;
    const toolCalls = message?.tool_calls || [];

    if (toolCalls.length) {
      messages.push({
        role: "assistant",
        content: message.content || "",
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        const toolName = call?.function?.name;
        const args = call?.function?.arguments || {};

        pushTrace(context, {
          stage: "model_tool_request",
          provider: "ollama",
          tool: toolName,
          args: compactValue(args),
        });

        const resultText = await runToolAndFormat(toolName, args, context, "ollama");

        messages.push({
          role: "tool",
          content: resultText,
          name: toolName,
        });
      }

      continue;
    }

    let reply = message?.content || "Ollama returned an empty response.";

    if (shouldAutoWebSearchFromReply(context.userPrompt, reply)) {
      pushTrace(context, {
        stage: "ollama_auto_web_search_trigger",
        provider: "ollama",
        reason: "model_uncertain_reply",
        firstReply: compactValue(reply, 500),
      });

      const webLookup = await runToolAndFormat(
        "web_search",
        { query: context.userPrompt },
        context,
        "ollama"
      );

      const synthesisPrompt = [
        "Your first answer was uncertain. Use the web lookup below to answer the user.",
        "If results are weak or conflicting, say that clearly.",
        "Prefer concise, direct guidance.",
        "Web lookup:",
        webLookup,
      ].join("\n\n");

      const synthesis = await axios.post(`${baseUrl}/api/chat`, {
        model,
        messages: [
          ...messages,
          { role: "assistant", content: reply },
          { role: "user", content: synthesisPrompt },
        ],
        stream: false,
      }, {
        httpsAgent: context.httpsAgent,
      });

      const upgradedReply = synthesis?.data?.message?.content?.trim();
      if (upgradedReply) {
        reply = upgradedReply;
      }
    }

    pushTrace(context, {
      stage: "final_response",
      provider: "ollama",
      text: compactValue(reply, 1200),
    });
    return reply;
  }

  throw new Error("Ollama tool-calling loop exceeded maximum steps.");
}

async function askOpenAI(config, context) {
  const apiKey = config.apiKey || process.env[config.apiKeyEnv || "OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  const model = config.model || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const messages = buildOpenAIMessages(context);
  const tools = getOpenAIToolDefinitions();

  for (let step = 0; step < 4; step += 1) {
    checkCancellation();
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.2,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 30000,
        httpsAgent: context.httpsAgent,
      }
    );

    const message = response?.data?.choices?.[0]?.message;
    const toolCalls = message?.tool_calls || [];

    if (toolCalls.length) {
      messages.push({
        role: "assistant",
        content: message.content || "",
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        const toolName = call?.function?.name;
        const args = safeJsonParse(call?.function?.arguments);

        pushTrace(context, {
          stage: "model_tool_request",
          provider: "openai",
          tool: toolName,
          args: compactValue(args),
        });

        const resultText = await runToolAndFormat(toolName, args, context, "openai");

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: resultText,
        });
      }

      continue;
    }

    const finalText = message?.content || "OpenAI returned an empty response.";
    pushTrace(context, {
      stage: "final_response",
      provider: "openai",
      text: compactValue(finalText, 1200),
    });
    return finalText;
  }

  throw new Error("OpenAI tool-calling loop exceeded maximum steps.");
}

function extractGeminiText(candidate) {
  const parts = candidate?.content?.parts || [];
  return parts
    .filter((part) => typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function extractGeminiFunctionCall(candidate) {
  const parts = candidate?.content?.parts || [];
  return parts.find((part) => part.functionCall)?.functionCall;
}

async function askGemini(config, context) {
  const apiKey = config.apiKey || process.env[config.apiKeyEnv || "GEMINI_API_KEY"];
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing.");
  }

  const rawModel = config.model || process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const model = String(rawModel).trim().replace(/^models\//, "");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const contents = buildGeminiContents(context);
  const systemInstruction = {
    parts: [{ text: buildSystemPrompt(context) }],
  };

  for (let step = 0; step < 4; step += 1) {
    checkCancellation();
    const response = await axios.post(url, {
      systemInstruction,
      contents,
      tools: [{ functionDeclarations: getGeminiFunctionDeclarations() }],
      generationConfig: {
        temperature: 0.2,
      },
    }, {
      httpsAgent: context.httpsAgent,
    });

    const candidate = response?.data?.candidates?.[0];
    const functionCall = extractGeminiFunctionCall(candidate);

    if (functionCall?.name) {
      const args = functionCall.args || {};
      pushTrace(context, {
        stage: "model_tool_request",
        provider: "gemini",
        tool: functionCall.name,
        args: compactValue(args),
      });

      const resultText = await runToolAndFormat(functionCall.name, args, context, "gemini");

      contents.push(candidate.content);
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: functionCall.name,
              response: {
                result: resultText,
              },
            },
          },
        ],
      });

      continue;
    }

    const text = extractGeminiText(candidate) || "Gemini returned an empty response.";
    pushTrace(context, {
      stage: "final_response",
      provider: "gemini",
      text: compactValue(text, 1200),
    });
    return text;
  }

  throw new Error("Gemini tool-calling loop exceeded maximum steps.");
}

async function askProvider(providerName, providerConfig, context) {
  if (providerName === "ollama") {
    return askOllama(providerConfig, context);
  }
  if (providerName === "openai") {
    return askOpenAI(providerConfig, context);
  }
  if (providerName === "gemini") {
    return askGemini(providerConfig, context);
  }
  throw new Error(`Unsupported provider: ${providerName}`);
}

function formatProviderError(error) {
  const status = error?.response?.status;
  const apiMessage =
    error?.response?.data?.error?.message ||
    error?.response?.data?.error ||
    error?.response?.data?.message;

  if (status && apiMessage) {
    return `HTTP ${status}: ${String(apiMessage)}`;
  }
  if (status) {
    return `HTTP ${status}: ${error?.message || "Request failed"}`;
  }
  if (error?.code) {
    return `${error.code}: ${error.message}`;
  }
  return error?.message || "Provider request failed";
}

async function askWithFailover(providerState, context) {
  currentSessionCancelled = false;
  const { defaultProvider, providers, customCaCertPath } = providerState;
  const order = [defaultProvider, ...Object.keys(providers).filter((k) => k !== defaultProvider)];

  let httpsAgent = null;
  if (customCaCertPath && fs.existsSync(customCaCertPath)) {
    try {
      const caCert = fs.readFileSync(customCaCertPath);
      httpsAgent = new https.Agent({ ca: caCert });
    } catch (err) {
      console.error("Failed to load custom CA Certificate:", err.message);
    }
  }

  const traceContext = {
    ...context,
    toolTrace: [],
    httpsAgent,
  };

  let lastError = null;
  for (const providerName of order) {
    const providerConfig = providers[providerName];
    if (!providerConfig?.enabled) {
      continue;
    }

    pushTrace(traceContext, {
      stage: "provider_attempt",
      provider: providerName,
    });

    try {
      const reply = await askProvider(providerName, providerConfig, traceContext);
      pushTrace(traceContext, {
        stage: "provider_success",
        provider: providerName,
      });
      return { provider: providerName, reply, toolTrace: traceContext.toolTrace };
    } catch (error) {
      const formattedError = formatProviderError(error);
      lastError = new Error(formattedError);
      pushTrace(traceContext, {
        stage: "provider_error",
        provider: providerName,
        error: formattedError,
      });
    }
  }

  throw lastError || new Error("No enabled providers are available.");
}

module.exports = {
  askWithFailover,
  cancelCurrentSession,
  checkCancellation: process.env.NODE_ENV === "test" ? checkCancellation : undefined,
};
