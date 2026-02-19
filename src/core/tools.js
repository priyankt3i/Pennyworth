const axios = require("axios");
const cheerio = require("cheerio");

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
  const response = await axios.get("https://ipapi.co/json/", { timeout: 7000 });
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

  throw new Error(`Unknown tool '${name}'.`);
}

async function runAgentTooling({ question, systemContext, agentContext }) {
  const text = String(question || "");

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
