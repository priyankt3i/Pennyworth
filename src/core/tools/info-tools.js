const axios = require("axios");

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

const defaultHttpsAgent = new (require("https").Agent)(); // secure by default!

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
      reply: "Good day. Pennyworth at your service. What can I help you solve?",
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

async function geocodeLocation(locationText, httpsAgent) {
  const response = await axios.get("https://geocoding-api.open-meteo.com/v1/search", {
    params: {
      name: locationText,
      count: 1,
      language: "en",
      format: "json",
    },
    timeout: 7000,
    httpsAgent: httpsAgent || defaultHttpsAgent,
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

async function geolocateByIp(httpsAgent) {
  const response = await axios.get("https://ipapi.co/json/", {
    timeout: 7000,
    httpsAgent: httpsAgent || defaultHttpsAgent,
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

async function fetchWeather(latitude, longitude, httpsAgent) {
  const response = await axios.get("https://api.open-meteo.com/v1/forecast", {
    params: {
      latitude,
      longitude,
      timezone: "auto",
      current: ["temperature_2m", "relative_humidity_2m", "apparent_temperature", "weather_code", "wind_speed_10m"],
      daily: ["temperature_2m_max", "temperature_2m_min", "weather_code"],
    },
    timeout: 7000,
    httpsAgent: httpsAgent || defaultHttpsAgent,
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

async function runWeatherToolWithOptions({ question, location, useIpLocation, agentContext, httpsAgent }) {
  const questionLocation = extractLocation(question || "");
  const explicitLocation = String(location || questionLocation || "").trim();
  const allowIpFromSettings = Boolean(agentContext?.allowIpLocation);
  const allowIp = Boolean(useIpLocation) || allowIpFromSettings;

  let geo;
  let source;

  if (explicitLocation) {
    geo = await geocodeLocation(explicitLocation, httpsAgent);
    source = `explicit location '${explicitLocation}'`;
  } else if (allowIp) {
    geo = await geolocateByIp(httpsAgent);
    source = "approximate IP-based location";
  } else {
    return {
      handled: true,
      tool: "weather",
      reply:
        "I can fetch live weather, but I need a location. Ask like 'weather in Berlin' or enable IP-based location in Settings.",
    };
  }

  const weatherData = await fetchWeather(geo.latitude, geo.longitude, httpsAgent);
  return {
    handled: true,
    tool: "weather",
    reply: buildWeatherReply(geo.label || explicitLocation || "your location", weatherData, source),
  };
}

module.exports = {
  isWeatherIntent,
  isDateTimeIntent,
  runSmallTalkTool,
  runDateTimeTool,
  runWeatherToolWithOptions,
};
