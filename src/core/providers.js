const axios = require("axios");
require("dotenv").config();

const {
  getOpenAIToolDefinitions,
  getGeminiFunctionDeclarations,
  executeToolFunction,
  runAgentTooling,
} = require("./tools");

function buildSystemPrompt(context) {
  const { systemContext, distroProfile, retrievedDocs } = context;
  return [
    "You are Pennyworth, a precise Linux expert assistant inspired by Alfred Pennyworth.",
    "Style: concise, technical, witty but never verbose.",
    "You must prefer distro-correct commands and explain command risk when root access is needed.",
    "If uncertain, state assumptions and provide verification steps.",
    "When available, use tools for live web search, date/time, and weather rather than guessing.",
    "Current system context:",
    JSON.stringify(systemContext, null, 2),
    "Configured distro profile:",
    JSON.stringify(distroProfile, null, 2),
    "Retrieved local docs context:",
    JSON.stringify(retrievedDocs, null, 2),
  ].join("\n\n");
}

function buildMessages(context) {
  const { userPrompt, history = [], screenshotAttached } = context;
  const userContent = screenshotAttached
    ? `${userPrompt}\n\n[User attached a screenshot region. If visual context is not available, ask follow-up questions.]`
    : userPrompt;

  return [
    { role: "system", content: buildSystemPrompt(context) },
    ...history.slice(-8),
    { role: "user", content: userContent },
  ];
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

function pushTrace(context, event) {
  if (!Array.isArray(context?.toolTrace)) {
    return;
  }

  context.toolTrace.push({
    at: new Date().toISOString(),
    ...event,
  });
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
  const response = await axios.post(`${baseUrl}/api/chat`, {
    model,
    messages: buildMessages(context),
    stream: false,
  });

  const reply = response?.data?.message?.content || "Ollama returned an empty response.";
  pushTrace(context, {
    stage: "final_response",
    provider: "ollama",
    text: compactValue(reply, 1200),
  });
  return reply;
}

async function askOpenAI(config, context) {
  const apiKey = config.apiKey || process.env[config.apiKeyEnv || "OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  const model = config.model || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const messages = buildMessages(context);
  const tools = getOpenAIToolDefinitions();

  for (let step = 0; step < 4; step += 1) {
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

function toGeminiContents(messages) {
  const output = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      continue;
    }

    if (msg.role === "assistant") {
      output.push({ role: "model", parts: [{ text: msg.content || "" }] });
      continue;
    }

    if (msg.role === "user") {
      output.push({ role: "user", parts: [{ text: msg.content || "" }] });
      continue;
    }
  }
  return output;
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

  const model = config.model || process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const baseMessages = buildMessages(context);
  const contents = toGeminiContents(baseMessages);
  const systemInstruction = {
    parts: [{ text: buildSystemPrompt(context) }],
  };

  for (let step = 0; step < 4; step += 1) {
    const response = await axios.post(url, {
      systemInstruction,
      contents,
      tools: [{ functionDeclarations: getGeminiFunctionDeclarations() }],
      generationConfig: {
        temperature: 0.2,
      },
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

      contents.push({ role: "model", parts: [{ functionCall }] });
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

async function askWithFailover(providerState, context) {
  const { defaultProvider, providers } = providerState;
  const order = [defaultProvider, ...Object.keys(providers).filter((k) => k !== defaultProvider)];

  const traceContext = {
    ...context,
    toolTrace: [],
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
      lastError = error;
      pushTrace(traceContext, {
        stage: "provider_error",
        provider: providerName,
        error: error.message,
      });
    }
  }

  throw lastError || new Error("No enabled providers are available.");
}

module.exports = {
  askWithFailover,
};
