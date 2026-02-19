const fs = require("fs");
const path = require("path");

function readJson(filePath) {
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read JSON file '${filePath}': ${error.message}`);
  }

  const cleaned = raw.replace(/^\uFEFF/, "");

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    throw new Error(`Invalid JSON in '${filePath}': ${error.message}`);
  }
}

function loadDistroConfig(rootDir) {
  return readJson(path.join(rootDir, "config", "distros.json"));
}

function loadProviderConfig(rootDir) {
  const preferred = path.join(rootDir, "config", "providers.json");
  const fallback = path.join(rootDir, "config", "providers.example.json");
  const source = fs.existsSync(preferred) ? preferred : fallback;
  return readJson(source);
}

module.exports = {
  loadDistroConfig,
  loadProviderConfig,
};
