const axios = require("axios");
const https = require("https");
const customHttpsAgent = new https.Agent({
  rejectUnauthorized: false,
});
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec, execSync } = require("child_process");

let dialog, BrowserWindow;
try {
  const electron = require("electron");
  dialog = electron.dialog;
  BrowserWindow = electron.BrowserWindow;
} catch (e) {
  // Silent fallback if loaded outside Electron main process context (e.g., tests)
}

const WEATHER_CODE_MAP = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Freezing drizzle",
  57: "Heavy freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

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

function isWeatherIntent(question) {
  return /\b(weather|temperature|forecast|rain|humidity|wind|hot|cold|snow)\b/i.test(question || "");
}

function isDateTimeIntent(question) {
  const text = String(question || "").toLowerCase();
  if (
    /\b(current\s+time|what(?:'s|\s+is)\s+the\s+time|time\s+now|current\s+date|today'?s\s+date|date\s+and\s+time|what\s+day\s+is\s+it|what\s+date\s+is\s+it)\b/.test(
      text
    )
  ) {
    return true;
  }

  const hasDateOrTimeToken = /\b(date|time|day)\b/.test(text);
  const hasNowToken = /\b(now|today|current|right\s+now)\b/.test(text);
  const hasQuestionToken = /\b(what|whats|what's|tell\s+me)\b/.test(text);

  if (hasDateOrTimeToken && (hasNowToken || hasQuestionToken)) {
    return true;
  }

  if (/\bwhat\s+date\s+today\b/.test(text) || /\bdate\s+today\b/.test(text)) {
    return true;
  }

  return false;
}

function isWebSearchIntent(question) {
  const text = String(question || "");
  if (
    /\b(lookup|look\s+up|search\s+(?:the\s+)?web|web\s+search|search\s+online|find\s+online|latest\s+news|what\s+is\s+happening\s+with|google)\b/i.test(
      text
    )
  ) {
    return true;
  }

  if (/\b(latest|news|today)\b/i.test(text) && /\b(on|about|regarding)\b/i.test(text)) {
    return true;
  }

  return false;
}

function runSmallTalkTool(question) {
  const text = String(question || "").trim().toLowerCase();

  if (/^(thanks|thank you|thx)[!. ]*$/i.test(text)) {
    return {
      handled: true,
      tool: "small_talk",
      reply: "Always a pleasure. Open Pennyworth whenever you need backup.",
    };
  }

  if (/^how are you(?: doing)?[?.! ]*$/i.test(text)) {
    return {
      handled: true,
      tool: "small_talk",
      reply: "Running sharp and ready. What should we tackle next?",
    };
  }

  if (/^(hi|hello|hey|yo|sup|good morning|good afternoon|good evening)[!. ]*$/i.test(text)) {
    return {
      handled: true,
      tool: "small_talk",
      reply: "Good day. Hermes at your service. What can I help you solve?",
    };
  }

  return { handled: false };
}

function extractLocation(question) {
  const text = question || "";
  const match = text.match(/\b(?:in|at|for)\s+([a-zA-Z][a-zA-Z\s,.-]{1,60})/i);
  if (!match) {
    return "";
  }
  return match[1].trim().replace(/[?.!,;:]+$/g, "");
}

function weatherCodeToLabel(code) {
  return WEATHER_CODE_MAP[Number(code)] || `Weather code ${code}`;
}

function normalizeSearchQuery(question) {
  let q = String(question || "").trim();
  q = q.replace(
    /^\s*(look\s*up|lookup|search\s*(?:the\s*)?web\s*(?:for)?|search\s*online\s*(?:for)?|google\s*(?:for)?|find\s*online\s*(?:for)?)\s*/i,
    ""
  );
  return q.trim();
}

async function geocodeLocation(locationText) {
  const response = await axios.get("https://geocoding-api.open-meteo.com/v1/search", {
    params: {
      name: locationText,
      count: 1,
      language: "en",
      format: "json",
    },
    timeout: 7000,
    httpsAgent: customHttpsAgent,
  });

  const first = response?.data?.results?.[0];
  if (!first) {
    throw new Error(`Could not resolve location '${locationText}'.`);
  }

  return {
    latitude: first.latitude,
    longitude: first.longitude,
    label: [first.name, first.admin1, first.country].filter(Boolean).join(", "),
  };
}

async function geolocateByIp() {
  const response = await axios.get("https://ipapi.co/json/", {
    timeout: 7000,
    httpsAgent: customHttpsAgent,
  });
  const body = response?.data || {};

  if (!body.latitude || !body.longitude) {
    throw new Error("IP location lookup did not return coordinates.");
  }

  return {
    latitude: body.latitude,
    longitude: body.longitude,
    label: [body.city, body.region, body.country_name].filter(Boolean).join(", "),
  };
}

async function fetchWeather(latitude, longitude) {
  const response = await axios.get("https://api.open-meteo.com/v1/forecast", {
    params: {
      latitude,
      longitude,
      timezone: "auto",
      current: ["temperature_2m", "relative_humidity_2m", "apparent_temperature", "weather_code", "wind_speed_10m"],
      daily: ["temperature_2m_max", "temperature_2m_min", "weather_code"],
    },
    timeout: 7000,
    httpsAgent: customHttpsAgent,
  });

  return response?.data || {};
}

function buildWeatherReply(locationLabel, weatherData, coordinatesSource) {
  const current = weatherData.current || {};
  const daily = weatherData.daily || {};
  const todayMax = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[0] : undefined;
  const todayMin = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[0] : undefined;
  const todayCode = Array.isArray(daily.weather_code) ? daily.weather_code[0] : undefined;

  const lines = [
    `Weather for ${locationLabel}:`,
    `- Now: ${current.temperature_2m ?? "?"}C, ${weatherCodeToLabel(current.weather_code)}, humidity ${current.relative_humidity_2m ?? "?"}%`,
    `- Feels like: ${current.apparent_temperature ?? "?"}C, wind ${current.wind_speed_10m ?? "?"} km/h`,
  ];

  if (todayMax !== undefined || todayMin !== undefined || todayCode !== undefined) {
    lines.push(
      `- Today: ${weatherCodeToLabel(todayCode)} (min ${todayMin ?? "?"}C, max ${todayMax ?? "?"}C)`
    );
  }

  lines.push(`- Source: Open-Meteo (${coordinatesSource})`);
  return lines.join("\n");
}

function decodeDuckDuckGoUrl(rawUrl) {
  if (!rawUrl) {
    return "";
  }

  try {
    const url = new URL(rawUrl, "https://duckduckgo.com");
    const encoded = url.searchParams.get("uddg");
    if (encoded) {
      return decodeURIComponent(encoded);
    }
    return url.toString();
  } catch (error) {
    return rawUrl;
  }
}

async function duckDuckGoSearch(query, limit = 5) {
  const response = await axios.get("https://duckduckgo.com/html/", {
    params: { q: query },
    headers: {
      "User-Agent": "Mozilla/5.0 (Pennyworth)",
    },
    timeout: 9000,
    httpsAgent: customHttpsAgent,
  });

  const $ = cheerio.load(response.data || "");
  const rows = [];

  $(".result").each((_, node) => {
    if (rows.length >= limit) {
      return;
    }

    const titleAnchor = $(node).find("a.result__a").first();
    const snippetNode = $(node).find(".result__snippet").first();
    const title = titleAnchor.text().trim();
    const href = titleAnchor.attr("href") || "";
    const url = decodeDuckDuckGoUrl(href);
    const snippet = snippetNode.text().trim();

    if (title && url) {
      rows.push({ title, url, snippet });
    }
  });

  return rows;
}

function buildWebReply(query, results) {
  if (!results.length) {
    return `I ran a web lookup for '${query}' but found no reliable results.`;
  }

  const lines = [`Web results for '${query}':`];
  results.forEach((row, index) => {
    lines.push(`${index + 1}. ${row.title}`);
    lines.push(`   ${row.url}`);
    if (row.snippet) {
      lines.push(`   ${row.snippet}`);
    }
  });
  lines.push("Source: DuckDuckGo web search");
  return lines.join("\n");
}

function runDateTimeTool(systemContext) {
  const now = new Date();
  const localDate = now.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const localTime = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  return {
    handled: true,
    tool: "datetime",
    reply: `Current date and time:\n- Date: ${localDate}\n- Time: ${localTime}\n- Host timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}\n- Host platform: ${systemContext.platform}`,
  };
}

async function runWeatherToolWithOptions({ question, location, useIpLocation, agentContext }) {
  const questionLocation = extractLocation(question || "");
  const explicitLocation = String(location || questionLocation || "").trim();
  const allowIpFromSettings = Boolean(agentContext?.allowIpLocation);
  const allowIp = Boolean(useIpLocation) || allowIpFromSettings;

  let geo;
  let source;

  if (explicitLocation) {
    geo = await geocodeLocation(explicitLocation);
    source = `explicit location '${explicitLocation}'`;
  } else if (allowIp) {
    geo = await geolocateByIp();
    source = "approximate IP-based location";
  } else {
    return {
      handled: true,
      tool: "weather",
      reply:
        "I can fetch live weather, but I need a location. Ask like 'weather in Berlin' or enable IP-based location in Settings.",
    };
  }

  const weatherData = await fetchWeather(geo.latitude, geo.longitude);
  return {
    handled: true,
    tool: "weather",
    reply: buildWeatherReply(geo.label || explicitLocation || "your location", weatherData, source),
  };
}

async function runWebSearchTool(question, queryOverride) {
  const query = String(queryOverride || normalizeSearchQuery(question)).trim();
  if (!query) {
    return {
      handled: true,
      tool: "web_search",
      reply: "Tell me what to search for. Example: 'search the web for latest CachyOS updates'.",
    };
  }

  const results = await duckDuckGoSearch(query, 5);
  return {
    handled: true,
    tool: "web_search",
    reply: buildWebReply(query, results),
    data: { query, results },
  };
}

// Hermes System Integration Helpers
function requestUserApproval(title, message, detail) {
  if (!dialog || !BrowserWindow) {
    return true; // Auto-approve outside Electron (e.g. tests or command-line scripts)
  }

  const focusedWindow = BrowserWindow.getFocusedWindow();
  const choice = dialog.showMessageBoxSync(focusedWindow || null, {
    type: "warning",
    buttons: ["Approve", "Deny"],
    defaultId: 1, // Deny by default
    cancelId: 1,  // Deny on escape
    title: title,
    message: message,
    detail: detail,
  });

  return choice === 0;
}

function isSensitivePath(filepath) {
  const normalized = path.normalize(filepath).toLowerCase();
  const sensitivePatterns = [
    "shadow",
    "passwd",
    "secret",
    "keyring",
    "private_key",
    "id_rsa",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    ".env",
    "credentials",
    "config/providers.json", // Protect system LLM configuration
    ".bash_history",
    ".zsh_history",
  ];
  return sensitivePatterns.some((pattern) => normalized.includes(pattern));
}

function tryRunCommand(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true }).trim();
  } catch (error) {
    return `Failed to fetch info: ${error.message}`;
  }
}

// Hermes Core System Tools
async function executeSystemCommand(command) {
  const approved = requestUserApproval(
    "Execute System Command",
    "Hermes Agent is requesting to execute a terminal command on your computer.",
    `Command:\n${command}\n\nWARNING: Executing commands can alter system state, modify settings, or install packages.`
  );

  if (!approved) {
    return "COMMAND_EXECUTION_DENIED: The user denied permission to run this command.";
  }

  return new Promise((resolve) => {
    exec(command, { timeout: 45000, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      let output = "";
      if (stdout) {
        output += `--- STDOUT ---\n${stdout}\n`;
      }
      if (stderr) {
        output += `--- STDERR ---\n${stderr}\n`;
      }
      if (error) {
        output += `--- ERROR ---\nExit Code: ${error.code}\n${error.message}\n`;
      }
      resolve(output || "Command executed successfully but returned no output.");
    });
  });
}

async function readSystemFile(filepath) {
  if (isSensitivePath(filepath)) {
    const approved = requestUserApproval(
      "Read Sensitive File",
      "Hermes Agent is requesting to read a sensitive system file.",
      `File path: ${filepath}\n\nWARNING: This file may contain user credentials, keys, or API tokens.`
    );
    if (!approved) {
      return "FILE_READ_DENIED: The user denied permission to read this sensitive file.";
    }
  }

  try {
    const stats = fs.statSync(filepath);
    if (stats.isDirectory()) {
      return `Error: '${filepath}' is a directory, not a file.`;
    }
    if (stats.size > 1024 * 1024 * 5) {
      return `Error: File is too large to read directly (${(stats.size / 1024 / 1024).toFixed(2)} MB).`;
    }
    const content = fs.readFileSync(filepath, "utf8");
    return content || "(Empty file)";
  } catch (error) {
    return `Error reading file '${filepath}': ${error.message}`;
  }
}

async function writeSystemFile(filepath, content) {
  const approved = requestUserApproval(
    "Write System File",
    "Hermes Agent is requesting to write or overwrite a file on your computer.",
    `File path: ${filepath}\n\nWARNING: Modifying system files can break applications or alter OS configurations.`
  );

  if (!approved) {
    return "FILE_WRITE_DENIED: The user denied permission to write this file.";
  }

  try {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filepath, content, "utf8");
    return `Successfully wrote ${content.length} characters to '${filepath}'.`;
  } catch (error) {
    return `Error writing file '${filepath}': ${error.message}`;
  }
}

function getSystemStatus(aspect = "all") {
  const isWin = os.platform() === "win32";
  const status = {};

  if (aspect === "cpu" || aspect === "memory" || aspect === "all") {
    status.resources = {
      cpuCores: os.cpus().length,
      cpuModel: os.cpus()[0]?.model || "unknown",
      totalMemoryGb: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2),
      freeMemoryGb: (os.freemem() / 1024 / 1024 / 1024).toFixed(2),
      loadAverage: os.platform() !== "win32" ? os.loadavg() : "N/A",
    };
  }

  if (aspect === "disk" || aspect === "all") {
    if (isWin) {
      status.disk = tryRunCommand("powershell -NoProfile -Command \"Get-Volume | Select-Object DriveLetter, FileSystemLabel, SizeRemaining, Size | Format-Table\"");
    } else {
      status.disk = tryRunCommand("df -h /");
    }
  }

  if (aspect === "processes" || aspect === "all") {
    if (isWin) {
      status.processes = tryRunCommand("powershell -NoProfile -Command \"Get-Process | Sort-Object CPU -Descending | Select-Object -First 20 -Property Name, Id, CPU, WorkingSet | Format-Table\"");
    } else {
      status.processes = tryRunCommand("ps aux --sort=-%cpu | head -n 25");
    }
  }

  if (aspect === "services" || aspect === "all") {
    if (os.platform() === "linux") {
      status.services = tryRunCommand("systemctl list-units --type=service --state=active --no-legend | head -n 30");
    } else if (isWin) {
      status.services = tryRunCommand("powershell -NoProfile -Command \"Get-Service | Where-Object {$_.Status -eq 'Running'} | Select-Object -First 20 -Property Name, DisplayName, Status | Format-Table\"");
    } else {
      status.services = "Not supported on this platform";
    }
  }

  if (aspect === "network" || aspect === "all") {
    status.network = {
      interfaces: os.networkInterfaces(),
    };
  }

  return JSON.stringify(status, null, 2);
}

function getMemoryFilePath() {
  return path.join(app.getPath("userData"), "pennyworth-memory.json");
}

function readMemory() {
  try {
    const memoryPath = getMemoryFilePath();
    if (fs.existsSync(memoryPath)) {
      return JSON.parse(fs.readFileSync(memoryPath, "utf8"));
    }
  } catch (error) {
    console.error("Failed to read butler memory:", error);
  }
  return [];
}

function writeMemory(memories) {
  try {
    const memoryPath = getMemoryFilePath();
    fs.writeFileSync(memoryPath, JSON.stringify(memories, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to write butler memory:", error);
  }
}

async function executeToolFunction(name, args, runtimeContext) {
  const safeArgs = args && typeof args === "object" ? args : {};
  const systemContext = runtimeContext?.systemContext || { platform: "unknown" };
  const agentContext = runtimeContext?.agentContext || {};
  const question = runtimeContext?.question || "";

  if (name === "get_current_datetime") {
    return runDateTimeTool(systemContext).reply;
  }

  if (name === "get_weather") {
    const result = await runWeatherToolWithOptions({
      question,
      location: safeArgs.location,
      useIpLocation: safeArgs.use_ip_location,
      agentContext,
    });
    return result.reply;
  }

  if (name === "web_search") {
    const result = await runWebSearchTool(question, safeArgs.query);
    return result.reply;
  }

  if (name === "execute_system_command") {
    if (!safeArgs.command) {
      return "Error: command argument is required.";
    }
    return await executeSystemCommand(safeArgs.command);
  }

  if (name === "read_system_file") {
    if (!safeArgs.filepath) {
      return "Error: filepath argument is required.";
    }
    return await readSystemFile(safeArgs.filepath);
  }

  if (name === "write_system_file") {
    if (!safeArgs.filepath || safeArgs.content === undefined) {
      return "Error: filepath and content arguments are required.";
    }
    return await writeSystemFile(safeArgs.filepath, safeArgs.content);
  }

  if (name === "get_system_status") {
    return getSystemStatus(safeArgs.aspect || "all");
  }

  if (name === "remember_fact") {
    const fact = String(safeArgs.fact || "").trim();
    if (!fact) {
      return "Error: No fact provided.";
    }
    const memories = readMemory();
    memories.push({
      at: new Date().toISOString(),
      fact,
    });
    writeMemory(memories);
    return `Successfully remembered fact: "${fact}"`;
  }

  if (name === "recall_facts") {
    const query = String(safeArgs.query || "").trim().toLowerCase();
    const memories = readMemory();
    const filtered = query
      ? memories.filter((m) => String(m.fact).toLowerCase().includes(query))
      : memories;

    if (!filtered.length) {
      return query ? `No remembered facts match "${query}".` : "No remembered facts found.";
    }

    return filtered
      .map((m) => `[${new Date(m.at).toLocaleString()}] ${m.fact}`)
      .join("\n");
  }

  throw new Error(`Unknown tool '${name}'.`);
}

async function runAgentTooling({ question, systemContext, agentContext }) {
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
      return await runWebSearchTool(text);
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
};
