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

const OPENAI_TOOL_DEFINITIONS = [
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
      description: "Execute a shell command on the host system. Always check systemContext to ensure the command matches the operating system (e.g. bash for Linux, PowerShell/CMD for Windows). Sudo/root commands are allowed but will require user approval.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The exact shell command to execute.",
          },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_system_file",
      description: "Read the text contents of a file on the host system (e.g. log files, configuration files, scripts). Reading highly sensitive files will prompt the user for permission.",
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
      description: "Write or overwrite text content to a file on the host system. This will prompt the user for confirmation.",
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

const GEMINI_FUNCTION_DECLARATIONS = [
  {
    name: "get_current_datetime",
    description: "Get current local date and time from host system clock.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    name: "get_weather",
    description:
      "Get current weather using Open-Meteo. Use location when available, or use approximate IP location only when allowed.",
    parameters: {
      type: "OBJECT",
      properties: {
        location: {
          type: "STRING",
          description: "City or location like Berlin or Austin, TX",
        },
        use_ip_location: {
          type: "BOOLEAN",
          description: "True if user has permitted approximate IP location usage",
        },
      },
    },
  },
  {
    name: "web_search",
    description: "Search web for up-to-date info.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "Search query",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "execute_system_command",
    description: "Execute a shell command on the host system. Check systemContext to match the OS (bash for Linux, PowerShell for Windows).",
    parameters: {
      type: "OBJECT",
      properties: {
        command: {
          type: "STRING",
          description: "The shell command to run.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "read_system_file",
    description: "Read the text contents of a file on the host system.",
    parameters: {
      type: "OBJECT",
      properties: {
        filepath: {
          type: "STRING",
          description: "Absolute path to the file.",
        },
      },
      required: ["filepath"],
    },
  },
  {
    name: "write_system_file",
    description: "Write or overwrite text content to a file on the host system. Prompts the user for approval.",
    parameters: {
      type: "OBJECT",
      properties: {
        filepath: {
          type: "STRING",
          description: "Absolute path to write to.",
        },
        content: {
          type: "STRING",
          description: "Content to write.",
        },
      },
      required: ["filepath", "content"],
    },
  },
  {
    name: "get_system_status",
    description: "Retrieve live system status (cpu, memory, disk, processes, services, network, or all).",
    parameters: {
      type: "OBJECT",
      properties: {
        aspect: {
          type: "STRING",
          description: "Filter by 'cpu', 'memory', 'disk', 'processes', 'services', 'network', or 'all'.",
          enum: ["cpu", "memory", "disk", "processes", "services", "network", "all"],
        },
      },
    },
  },
  {
    name: "remember_fact",
    description: "Store a persistent memory or fact about the user, their preference, or actions taken on their system. This persists across app restarts.",
    parameters: {
      type: "OBJECT",
      properties: {
        fact: {
          type: "STRING",
          description: "The fact or information to remember.",
        },
      },
      required: ["fact"],
    },
  },
  {
    name: "recall_facts",
    description: "Recall or search persistent memories and facts that were previously saved.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "Optional search query to filter remembered facts.",
        },
      },
    },
  },
];

function getOpenAIToolDefinitions() {
  return OPENAI_TOOL_DEFINITIONS;
}

function getGeminiFunctionDeclarations() {
  return GEMINI_FUNCTION_DECLARATIONS;
}

async function executeToolFunction(name, args, runtimeContext) {
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
    return await executeSystemCommand(args.command);
  }

  if (name === "read_system_file") {
    if (!args.filepath) {
      return "Error: filepath argument is required.";
    }
    return await readSystemFile(args.filepath);
  }

  if (name === "write_system_file") {
    if (!args.filepath || args.content === undefined) {
      return "Error: filepath and content arguments are required.";
    }
    return await writeSystemFile(args.filepath, args.content);
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
