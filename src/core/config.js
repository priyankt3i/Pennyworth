const fs = require("fs");
const path = require("path");

const jsonCache = new Map();

function readJson(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    throw new Error(`Unable to read JSON file metadata '${filePath}': ${error.message}`);
  }

  const cacheKey = path.resolve(filePath);
  const cached = jsonCache.get(cacheKey);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.value;
  }

  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read JSON file '${filePath}': ${error.message}`);
  }

  const cleaned = raw.replace(/^\uFEFF/, "");

  try {
    const parsed = JSON.parse(cleaned);
    jsonCache.set(cacheKey, {
      mtimeMs: stat.mtimeMs,
      value: parsed,
    });
    return parsed;
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
