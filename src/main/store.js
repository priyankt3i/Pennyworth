const fs = require("fs");
const path = require("path");
const os = require("os");
const { app } = require("electron");

let storeCache = null;
let storePath = null;

function getStorePath() {
  if (storePath) {
    return storePath;
  }

  const userDataDir = app.getPath("userData");
  fs.mkdirSync(userDataDir, { recursive: true });

  const isBootstrapMode = process.env.npm_lifecycle_event === "start" || process.argv.includes("--bootstrap");
  if (isBootstrapMode && process.env.NODE_ENV !== "test") {
    storePath = path.join(userDataDir, "pennyworth-runtime-bootstrap-test.json");
    if (fs.existsSync(storePath)) {
      try {
        fs.unlinkSync(storePath);
      } catch (e) {
        console.warn("Failed to clean bootstrap test store:", e.message);
      }
    }
  } else {
    storePath = path.join(userDataDir, "pennyworth-runtime.json");
  }
  return storePath;
}

function readStore() {
  if (storeCache) {
    return storeCache;
  }

  try {
    const raw = fs.readFileSync(getStorePath(), "utf8");
    const clean = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const parsed = JSON.parse(clean);
    storeCache = parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error(`Failed to read runtime store: ${error.message}`);
    }
    storeCache = {};
  }

  return storeCache;
}

function writeStore(nextState) {
  storeCache = nextState;
  fs.writeFileSync(getStorePath(), JSON.stringify(nextState, null, 2), "utf8");
}

function storeGet(key, fallback = undefined) {
  const state = readStore();
  if (Object.prototype.hasOwnProperty.call(state, key)) {
    return state[key];
  }
  return fallback;
}

function storeSet(key, value) {
  const state = readStore();
  const nextState = {
    ...state,
    [key]: value,
  };
  writeStore(nextState);
}

module.exports = {
  storeGet,
  storeSet,
  getStorePath,
  readStore,
  writeStore,
};
