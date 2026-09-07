const axios = require("axios");
const { saveProviderState } = require("./provider-config");
const { executeSystemCommand } = require("../core/tools/system-tools");

async function checkOllamaRunning() {
  try {
    const res = await axios.get("http://127.0.0.1:11434/api/tags", { timeout: 2000 });
    return res.status === 200;
  } catch (_) { return false; }
}

async function startOllamaService() {
  if (await checkOllamaRunning()) return true;
  // Use the same verified target and approval path as all system changes.
  // Never download and execute an installer as a fallback for a failed start.
  const result = await executeSystemCommand("systemctl start ollama", { target: "host" });
  if (result.includes("DENIED") || result.includes("SECURITY_BLOCKED")) return false;
  let status;
  try { status = JSON.parse(result); } catch (_) { return false; }
  if (!status.success) return false;
  for (let i = 0; i < 10; i++) {
    if (await checkOllamaRunning()) return true;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

async function bootstrapOllama() {
  try {
    if (await checkOllamaRunning()) return { ok: true, message: "Ollama is already running." };
    if (await startOllamaService()) return { ok: true, message: "Ollama service started." };
    return { ok: false, error: "Ollama could not be started. Install it using the official instructions at https://ollama.com/download, then start it and retry. Pennyworth does not download and execute shell installers." };
  } catch (error) { return { ok: false, error: error.message }; }
}

function bootstrapSetDefaultProvider(provider, model) {
  saveProviderState({ defaultProvider: provider, providers: { ollama: { enabled: true, model } } });
  return { ok: true };
}
module.exports = { checkOllamaRunning, startOllamaService, bootstrapOllama, bootstrapSetDefaultProvider };
