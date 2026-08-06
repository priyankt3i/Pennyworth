const axios = require("axios");
const fs = require("fs");
const https = require("https");
const { getProviderState } = require("./provider-config");
const { getStoredApiKey } = require("./vault");

const PROVIDER_HEALTH_TTL_MS = 30_000;
let providerHealthCache = null;
let providerHealthCacheAt = 0;
let providerHealthInFlight = null;

function getCustomHttpsAgent(customCaCertPath) {
  if (customCaCertPath && fs.existsSync(customCaCertPath)) {
    try {
      const caCert = fs.readFileSync(customCaCertPath);
      return new https.Agent({ ca: caCert });
    } catch (err) {
      console.error("Failed to load custom CA Certificate in health check:", err.message);
    }
  }
  return null;
}

function toProviderErrorMessage(error) {
  const status = error?.response?.status;
  const apiMessage =
    error?.response?.data?.error?.message ||
    error?.response?.data?.error ||
    error?.response?.data?.message;

  if (status && apiMessage) {
    return `HTTP ${status}: ${String(apiMessage)}`;
  }
  if (status) {
    return `HTTP ${status}`;
  }
  if (error?.code) {
    return String(error.code);
  }
  return error?.message || "Connection failed";
}

function normalizeOllamaBaseUrl(baseUrl) {
  const raw = String(baseUrl || "http://127.0.0.1:11434").trim();
  return raw.replace(/\/+$/, "");
}

async function listOllamaModels(baseUrl) {
  const providerState = getProviderState();
  const httpsAgent = getCustomHttpsAgent(providerState?.customCaCertPath);
  const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
  const response = await axios.get(`${normalizedBaseUrl}/api/tags`, {
    timeout: 5000,
    httpsAgent: httpsAgent || undefined,
  });
  const models = Array.isArray(response?.data?.models) ? response.data.models : [];

  const names = Array.from(
    new Set(
      models
        .map((model) => String(model?.name || "").trim())
        .filter(Boolean)
    )
  );

  return names;
}

async function listOpenAIModels(apiKey) {
  const providerState = getProviderState();
  const httpsAgent = getCustomHttpsAgent(providerState?.customCaCertPath);
  const keyToUse = apiKey || (await getStoredApiKey("openai")) || process.env.OPENAI_API_KEY || "";
  if (!keyToUse) {
    throw new Error("OpenAI API key is missing.");
  }
  const response = await axios.get("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${keyToUse}` },
    timeout: 5000,
    httpsAgent: httpsAgent || undefined,
  });
  const rawList = Array.isArray(response?.data?.data) ? response.data.data : [];
  const modelIds = rawList
    .map((m) => String(m?.id || "").trim())
    .filter(Boolean);

  const chatModels = modelIds.filter(
    (id) => id.startsWith("gpt-") || id.startsWith("o1") || id.startsWith("o3") || id.startsWith("chatgpt-")
  );
  const otherModels = modelIds.filter((id) => !chatModels.includes(id));
  chatModels.sort();
  otherModels.sort();
  const sorted = Array.from(new Set([...chatModels, ...otherModels]));
  return sorted.length > 0 ? sorted : modelIds;
}

async function listGeminiModels(apiKey) {
  const providerState = getProviderState();
  const httpsAgent = getCustomHttpsAgent(providerState?.customCaCertPath);
  const keyToUse = apiKey || (await getStoredApiKey("gemini")) || process.env.GEMINI_API_KEY || "";
  if (!keyToUse) {
    throw new Error("Gemini API key is missing.");
  }
  const response = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${keyToUse}`, {
    timeout: 5000,
    httpsAgent: httpsAgent || undefined,
  });
  const rawList = Array.isArray(response?.data?.models) ? response.data.models : [];
  const validModels = rawList
    .filter((m) => {
      const methods = Array.isArray(m?.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
      return methods.includes("generateContent") || (m?.name && String(m.name).includes("gemini"));
    })
    .map((m) => {
      const name = String(m?.name || "").trim();
      return name.replace(/^models\//, "");
    })
    .filter(Boolean);

  const sorted = Array.from(new Set(validModels)).sort();
  return sorted;
}


async function checkOllamaHealth(config, httpsAgent) {
  if (!config?.enabled) {
    return { state: "disabled", connected: false, message: "Disabled in settings." };
  }

  const baseUrl = normalizeOllamaBaseUrl(config.baseUrl);
  try {
    await axios.get(`${baseUrl}/api/tags`, {
      timeout: 4000,
      httpsAgent: httpsAgent || undefined,
    });
    return { state: "connected", connected: true, message: "Connected." };
  } catch (error) {
    return {
      state: "error",
      connected: false,
      message: toProviderErrorMessage(error),
    };
  }
}

async function checkOpenAIHealth(config, apiKey, httpsAgent) {
  if (!config?.enabled) {
    return { state: "disabled", connected: false, message: "Disabled in settings." };
  }
  if (!apiKey) {
    return { state: "not_configured", connected: false, message: "Missing API key." };
  }

  try {
    await axios.get("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 5000,
      httpsAgent: httpsAgent || undefined,
    });
    return { state: "connected", connected: true, message: "Connected." };
  } catch (error) {
    return {
      state: "error",
      connected: false,
      message: toProviderErrorMessage(error),
    };
  }
}

async function checkGeminiHealth(config, apiKey, httpsAgent) {
  if (!config?.enabled) {
    return { state: "disabled", connected: false, message: "Disabled in settings." };
  }
  if (!apiKey) {
    return { state: "not_configured", connected: false, message: "Missing API key." };
  }

  try {
    await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
      timeout: 5000,
      httpsAgent: httpsAgent || undefined,
    });
    return { state: "connected", connected: true, message: "Connected." };
  } catch (error) {
    return {
      state: "error",
      connected: false,
      message: toProviderErrorMessage(error),
    };
  }
}

function invalidateProviderHealthCache() {
  providerHealthCache = null;
  providerHealthCacheAt = 0;
}

async function fetchProviderHealth() {
  const providerState = getProviderState();
  const httpsAgent = getCustomHttpsAgent(providerState?.customCaCertPath);

  const openaiStoredKey = await getStoredApiKey("openai");
  const geminiStoredKey = await getStoredApiKey("gemini");
  const openaiApiKey = openaiStoredKey || process.env.OPENAI_API_KEY || "";
  const geminiApiKey = geminiStoredKey || process.env.GEMINI_API_KEY || "";

  const [ollama, openai, gemini] = await Promise.all([
    checkOllamaHealth(providerState.providers.ollama, httpsAgent),
    checkOpenAIHealth(providerState.providers.openai, openaiApiKey, httpsAgent),
    checkGeminiHealth(providerState.providers.gemini, geminiApiKey, httpsAgent),
  ]);

  return { ollama, openai, gemini };
}

async function getProviderHealth(options = {}) {
  const force = Boolean(options?.force);
  const ttlMs = Number(options?.ttlMs) > 0 ? Number(options.ttlMs) : PROVIDER_HEALTH_TTL_MS;
  const ageMs = Date.now() - providerHealthCacheAt;

  if (!force && providerHealthCache && ageMs < ttlMs) {
    return {
      health: providerHealthCache,
      cached: true,
      stale: false,
      ageMs,
    };
  }

  if (providerHealthInFlight) {
    return providerHealthInFlight;
  }

  providerHealthInFlight = (async () => {
    try {
      const health = await fetchProviderHealth();
      providerHealthCache = health;
      providerHealthCacheAt = Date.now();
      return {
        health,
        cached: false,
        stale: false,
        ageMs: 0,
      };
    } catch (error) {
      if (providerHealthCache) {
        return {
          health: providerHealthCache,
          cached: true,
          stale: true,
          ageMs: Date.now() - providerHealthCacheAt,
        };
      }
      throw error;
    } finally {
      providerHealthInFlight = null;
    }
  })();

  return providerHealthInFlight;
}

module.exports = {
  listOllamaModels,
  listOpenAIModels,
  listGeminiModels,
  invalidateProviderHealthCache,
  getProviderHealth,
};
