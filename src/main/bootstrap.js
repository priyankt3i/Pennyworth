const { exec, execSync } = require("child_process");
const axios = require("axios");
const { saveProviderState } = require("./provider-config");

async function checkOllamaRunning() {
  try {
    const res = await axios.get("http://127.0.0.1:11434/api/tags", { timeout: 2000 });
    return res.status === 200;
  } catch (error) {
    return false;
  }
}

async function startOllamaService() {
  const isWin = process.platform === "win32";
  const startCmd = isWin
    ? "powershell -NoProfile -Command \"Start-Process -FilePath $env:localappdata\\Programs\\Ollama\\Ollama.exe -WindowStyle Hidden\""
    : "systemctl start ollama || service ollama start";
  
  try {
    exec(startCmd, { windowsHide: true });
    // Wait for the server port to boot
    for (let i = 0; i < 15; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (await checkOllamaRunning()) return true;
    }
  } catch (e) {
    console.error("Failed to start Ollama background process:", e.message);
  }
  return false;
}

async function bootstrapOllama() {
  try {
    if (await checkOllamaRunning()) {
      return { ok: true, message: "Ollama is already running." };
    }

    if (await startOllamaService()) {
      return { ok: true, message: "Ollama service started." };
    }

    // Install if not running and cannot start
    const isWin = process.platform === "win32";
    if (isWin) {
      // Check if winget is available
      try {
        execSync("winget --version");
      } catch (e) {
        throw new Error("winget package manager is not available. Please install Ollama manually from https://ollama.com.");
      }

      console.log("Installing Ollama via winget...");
      execSync("winget install Ollama.Ollama --accept-source-agreements --accept-package-agreements", { stdio: "inherit" });
    } else {
      console.log("Installing Ollama via curl script...");
      execSync("curl -fsSL https://ollama.com/install.sh | sh", { stdio: "inherit" });
    }

    if (await startOllamaService()) {
      return { ok: true, message: "Ollama installed and started successfully." };
    }

    throw new Error("Ollama installed but failed to boot the background API port.");
  } catch (error) {
    console.error("Bootstrap installation failed:", error);
    return { ok: false, error: error.message };
  }
}

function bootstrapSetDefaultProvider(provider, model) {
  const providerState = {
    defaultProvider: provider,
    providers: {
      ollama: {
        enabled: true,
        model: model,
      }
    }
  };
  saveProviderState(providerState);
  return { ok: true };
}

module.exports = {
  checkOllamaRunning,
  startOllamaService,
  bootstrapOllama,
  bootstrapSetDefaultProvider,
};
