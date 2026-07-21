if (process.env.NODE_ENV !== "test") {
  require("./main/index");
} else {
  const { autoDetectProfileId } = require("./main/profiles");
  const { encrypt, decrypt, getStoredApiKey, setStoredApiKey, clearStoredApiKey } = require("./main/vault");
  const { storeGet, storeSet } = require("./main/store");
  const { bootstrapOllama, bootstrapSetDefaultProvider } = require("./main/bootstrap");

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
}
