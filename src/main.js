const { autoDetectProfileId } = require("./main/profiles");
const { encrypt, decrypt, getStoredApiKey, setStoredApiKey, clearStoredApiKey } = require("./main/vault");
const { storeGet, storeSet } = require("./main/store");
const { bootstrapOllama, bootstrapSetDefaultProvider } = require("./main/bootstrap");

// Initialize main process
require("./main/index");

module.exports = {
  autoDetectProfileId,
  encrypt,
  decrypt,
  getStoredApiKey,
  setStoredApiKey,
  clearStoredApiKey,
  storeGet,
  storeSet,
  bootstrapOllama,
  bootstrapSetDefaultProvider,
};

