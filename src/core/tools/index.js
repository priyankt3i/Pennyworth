const {
  isWeatherIntent,
  isDateTimeIntent,
  runSmallTalkTool,
  runDateTimeTool,
  runWeatherToolWithOptions,
} = require("./info-tools");

const {
  isWebSearchIntent,
  runWebSearchTool,
} = require("./web-tools");

const {
  runRememberFact,
  runRecallFacts,
} = require("./memory-tools");

const {
  assessCommandRisk,
  executeSystemCommand,
  readSystemFile,
  writeSystemFile,
  getSystemStatus,
} = require("./system-tools");

const { getExecutionCapabilities, diagnoseSystem } = require("./diagnostic-tools");
const OPENAI_TOOL_DEFINITIONS = [
  { type: "function", function: { name: "get_execution_capabilities", description: "Probe supported sandbox and host targets. No automatic host fallback. Availability is not authorization.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "diagnose_system", description: "Collect fixed read-only host performance probes with user approval: memory availability, pressure, swap activity, CPU driver and energy policy, processes, and verified desktop animations. Missing probes are unknown. Prefer this before performance recommendations.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  {
    type: "function",
    function: {
      name: "get_current_datetime",
      description: "Get current local date and time from host system clock.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description:
        "Get current weather using Open-Meteo. Provide a location string when available. If location missing, tool may use approximate IP location when allowed.",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "City or location (for example 'Berlin' or 'Austin, TX').",
          },
          use_ip_location: {
            type: "boolean",
            description: "Set true only if user allows approximate IP-based location.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for up-to-date information.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "execute_system_command",
      description: "Execute on an explicit target: sandbox for isolated computation, host for actual OS operations. Defaults to sandbox. Unsupported targets fail closed without fallback. Every host command requires approval. Check capabilities first. Prefer diagnose_system for performance questions.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", enum: ["sandbox", "host"], description: "Required execution target. Host needs approval; sandbox has no host home or network." },
          command: {
            type: "string",
            description: "The exact shell command to execute.",
          },
        },
        required: ["command", "target"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_system_file",
      description: "Read the text contents of a file in the local process environment, which may be sandboxed. Every read requires approval; symlinks are rejected. This tool is not a host bridge.",
      parameters: {
        type: "object",
        properties: {
          filepath: {
            type: "string",
            description: "The absolute path to the file to read.",
          },
        },
        required: ["filepath"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_system_file",
      description: "Write or replace a local process file after content review. Not a host bridge. Rejects symlinks; preserves an original backup. Parent must exist. Maximum 100 KB.",
      parameters: {
        type: "object",
        properties: {
          filepath: {
            type: "string",
            description: "The absolute path to the file to write.",
          },
          content: {
            type: "string",
            description: "The text contents to write into the file.",
          },
        },
        required: ["filepath", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_system_status",
      description: "Retrieve live system resource status, disk usage, active processes, systemd services, or network interface info.",
      parameters: {
        type: "object",
        properties: {
          aspect: {
            type: "string",
            description: "Filter by specific system aspect: 'cpu', 'memory', 'disk', 'processes', 'services', 'network', or 'all'.",
            enum: ["cpu", "memory", "disk", "processes", "services", "network", "all"],
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember_fact",
      description: "Store a persistent memory or fact about the user, their preference, or actions taken on their system (e.g. package installations or configuration changes). This persists across app restarts.",
      parameters: {
        type: "object",
        properties: {
          fact: {
            type: "string",
            description: "The fact or information to remember.",
          },
        },
        required: ["fact"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recall_facts",
      description: "Recall or search persistent memories and facts that were previously saved.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Optional search query to filter remembered facts.",
          },
        },
        additionalProperties: false,
      },
    },
  },
];

function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "additionalProperties").map(([key, value]) => [key, key === "type" && typeof value === "string" ? value.toUpperCase() : toGeminiSchema(value)]));
}
const GEMINI_FUNCTION_DECLARATIONS = OPENAI_TOOL_DEFINITIONS.map(({ function: fn }) => ({ ...fn, parameters: toGeminiSchema(fn.parameters) }));

function getOpenAIToolDefinitions() {
  return OPENAI_TOOL_DEFINITIONS;
}

function getGeminiFunctionDeclarations() {
  return GEMINI_FUNCTION_DECLARATIONS;
}

async function executeToolFunction(name, args, runtimeContext) {
  const { checkSignal } = require("../execution-runner");
  checkSignal(runtimeContext?.signal);
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Tool arguments must be an object.");
  if (name === "get_execution_capabilities") return getExecutionCapabilities();
  if (name === "diagnose_system") return diagnoseSystem({ signal: runtimeContext?.signal });
  const systemContext = runtimeContext?.systemContext || {};
  const agentContext = runtimeContext?.agentContext || {};
  const question = runtimeContext?.question || "";
  const httpsAgent = runtimeContext?.httpsAgent || null;

  if (name === "get_current_datetime") {
    return runDateTimeTool(systemContext).reply;
  }

  if (name === "get_weather") {
    const result = await runWeatherToolWithOptions({
      question,
      location: args.location,
      useIpLocation: args.use_ip_location,
      agentContext,
      httpsAgent,
    });
    return result.reply;
  }

  if (name === "web_search") {
    const result = await runWebSearchTool(question, args.query, httpsAgent);
    return result.reply;
  }

  if (name === "execute_system_command") {
    if (!args.command) {
      return "Error: command argument is required.";
    }
    return await executeSystemCommand(args.command, { target: args.target, signal: runtimeContext?.signal });
  }

  if (name === "read_system_file") {
    if (!args.filepath) {
      return "Error: filepath argument is required.";
    }
    return await readSystemFile(args.filepath, { signal: runtimeContext?.signal });
  }

  if (name === "write_system_file") {
    if (!args.filepath || args.content === undefined) {
      return "Error: filepath and content arguments are required.";
    }
    return await writeSystemFile(args.filepath, args.content, { signal: runtimeContext?.signal });
  }

  if (name === "get_system_status") {
    return getSystemStatus(args.aspect || "all");
  }

  if (name === "remember_fact") {
    return runRememberFact(args.fact);
  }

  if (name === "recall_facts") {
    return runRecallFacts(args.query);
  }

  throw new Error(`Unknown tool '${name}'.`);
}

async function runAgentTooling({ question, systemContext, agentContext, httpsAgent }) {
  const text = String(question || "");
  const smallTalk = runSmallTalkTool(text);
  if (smallTalk.handled) {
    return smallTalk;
  }

  if (isWeatherIntent(text)) {
    try {
      return await runWeatherToolWithOptions({
        question: text,
        agentContext,
        httpsAgent,
      });
    } catch (error) {
      return {
        handled: true,
        tool: "weather",
        reply: `I couldn't fetch weather right now: ${error.message}`,
      };
    }
  }

  if (isDateTimeIntent(text)) {
    return runDateTimeTool(systemContext);
  }

  if (isWebSearchIntent(text)) {
    try {
      return await runWebSearchTool(text, null, httpsAgent);
    } catch (error) {
      return {
        handled: true,
        tool: "web_search",
        reply: `I couldn't complete the web search right now: ${error.message}`,
      };
    }
  }

  return { handled: false };
}

module.exports = {
  getOpenAIToolDefinitions,
  getGeminiFunctionDeclarations,
  executeToolFunction,
  runAgentTooling,
  assessCommandRisk,
};
