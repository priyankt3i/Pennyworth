const { storeGet, storeSet } = require("./store");
const { getStoredApiKey } = require("./vault");

function hasEnvKeyForProvider(providerName) {
  if (providerName === "openai") {
    return Boolean(process.env.OPENAI_API_KEY);
  }
  if (providerName === "gemini") {
    return Boolean(process.env.GEMINI_API_KEY);
  }
  return false;
}

function getProviderState() {
  return storeGet("providerConfig", {
    defaultProvider: "ollama",
    customCaCertPath: "",
    providers: {
      ollama: { enabled: true, baseUrl: "http://127.0.0.1:11434", model: "llama3.2" },
      openai: { enabled: false, model: "gpt-4o-mini" },
      gemini: { enabled: false, model: "gemini-2.0-flash" },
    },
  });
}

function normalizeProviderState(base, override) {
  const merged = {
    defaultProvider: override?.defaultProvider || base?.defaultProvider || "ollama",
    customCaCertPath: override?.customCaCertPath || base?.customCaCertPath || "",
    providers: {
      ollama: {
        ...base?.providers?.ollama,
        ...override?.providers?.ollama,
      },
      openai: {
        ...base?.providers?.openai,
        ...override?.providers?.openai,
      },
      gemini: {
        ...base?.providers?.gemini,
        ...override?.providers?.gemini,
      },
    },
  };

  merged.providers.ollama.enabled = Boolean(merged.providers.ollama.enabled);
  merged.providers.openai.enabled = Boolean(merged.providers.openai.enabled);
  merged.providers.gemini.enabled = Boolean(merged.providers.gemini.enabled);

  merged.providers.ollama.baseUrl =
    merged.providers.ollama.baseUrl || "http://127.0.0.1:11434";
  merged.providers.ollama.model = merged.providers.ollama.model || "llama3.2";
  merged.providers.openai.model = merged.providers.openai.model || "gpt-4o-mini";
  merged.providers.gemini.model = merged.providers.gemini.model || "gemini-2.0-flash";

  if (!merged.providers[merged.defaultProvider]) {
    merged.defaultProvider = "ollama";
  }

  const enabledProviders = Object.keys(merged.providers).filter(
    (providerName) => merged.providers[providerName].enabled
  );
  if (!enabledProviders.includes(merged.defaultProvider)) {
    merged.defaultProvider = enabledProviders[0] || merged.defaultProvider;
  }

  Object.keys(merged.providers).forEach((providerName) => {
    merged.providers[providerName].enabled = providerName === merged.defaultProvider;
  });

  return merged;
}

function saveProviderState(providerConfig) {
  const current = getProviderState();
  const next = normalizeProviderState(current, providerConfig);
  storeSet("providerConfig", next);
  return next;
}

async function getProviderStateForUi() {
  const providerState = getProviderState();
  const openaiStored = Boolean(await getStoredApiKey("openai"));
  const geminiStored = Boolean(await getStoredApiKey("gemini"));

  return {
    secureStorageAvailable: require("electron").safeStorage.isEncryptionAvailable(),
    defaultProvider: providerState.defaultProvider,
    customCaCertPath: providerState.customCaCertPath,
    providers: {
      ollama: {
        enabled: providerState.providers.ollama.enabled,
        baseUrl: providerState.providers.ollama.baseUrl,
        model: providerState.providers.ollama.model,
      },
      openai: {
        enabled: providerState.providers.openai.enabled,
        model: providerState.providers.openai.model,
        hasApiKey: openaiStored || hasEnvKeyForProvider("openai"),
      },
      gemini: {
        enabled: providerState.providers.gemini.enabled,
        model: providerState.providers.gemini.model,
        hasApiKey: geminiStored || hasEnvKeyForProvider("gemini"),
      },
    },
  };
}

module.exports = {
  getProviderState,
  saveProviderState,
  getProviderStateForUi,
  normalizeProviderState,
};
