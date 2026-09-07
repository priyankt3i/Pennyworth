const crypto = require("crypto");
const { safeStorage } = require("electron");
const { storeGet, storeSet } = require("./store");

let sessionEncryptionKey = null;
function secureStorageAvailable() {
  return safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== "basic_text";
}

const STATIC_SALT_FALLBACK = "pennyworth-vault-salt-secure-unique-string-1337";

function getActiveSalt() {
  const storedSalt = storeGet("vaultSalt");
  if (storedSalt) {
    return storedSalt;
  }
  // Fallback to static salt only if vault Sentinel is already present on disk (old setup)
  if (storeGet("vaultSentinel")) {
    return STATIC_SALT_FALLBACK;
  }
  return null;
}

function deriveKeyFromPassphrase(passphrase, salt = null) {
  const activeSalt = salt || getActiveSalt() || STATIC_SALT_FALLBACK;
  return crypto.pbkdf2Sync(passphrase, activeSalt, 100000, 32, "sha256");
}

function getEncryptionKey() {
  if (process.env.NODE_ENV === "test") {
    return deriveKeyFromPassphrase("test-suite-passphrase");
  }
  if (!sessionEncryptionKey) {
    throw new Error("VAULT_LOCKED");
  }
  return sessionEncryptionKey;
}

function encrypt(text) {
  try {
    const iv = crypto.randomBytes(12);
    const key = getEncryptionKey();
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
  } catch (error) {
    console.error("Encryption failed:", error.message);
    throw error;
  }
}

function decrypt(encryptedText) {
  try {
    const parts = encryptedText.split(":");
    const key = getEncryptionKey();

    if (parts.length === 3) {
      // AES-256-GCM authenticated decryption
      const iv = Buffer.from(parts[0], "hex");
      const tag = Buffer.from(parts[1], "hex");
      const encrypted = parts[2];
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      let decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    } else if (parts.length === 2) {
      // Legacy AES-256-CBC decipher fallback
      const iv = Buffer.from(parts[0], "hex");
      const encrypted = parts[1];
      const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
      let decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    }
    return "";
  } catch (error) {
    console.error("Decryption failed:", error.message);
    throw error;
  }
}

async function getStoredApiKey(account) {
  try {
    if (secureStorageAvailable()) {
      const encryptedHex = storeGet(`secret_${account}`);
      if (encryptedHex) {
        const buffer = Buffer.from(encryptedHex, "hex");
        return safeStorage.decryptString(buffer);
      }
      return "";
    }
  } catch (error) {
    console.warn("safeStorage read failed, falling back to local vault:", error.message);
  }

  // Fallback to local passphrase vault
  const encrypted = storeGet(`secret_fallback_${account}`);
  if (encrypted) {
    try {
      return decrypt(encrypted);
    } catch (e) {
      return "";
    }
  }
  return "";
}

async function setStoredApiKey(account, value) {
  try {
    if (secureStorageAvailable()) {
      const buffer = safeStorage.encryptString(value);
      storeSet(`secret_${account}`, buffer.toString("hex"));
      storeSet(`secret_fallback_${account}`, undefined);
      return;
    }
  } catch (error) {
    console.warn("safeStorage write failed, falling back to local vault:", error.message);
  }

  // Fallback to local passphrase vault
  try {
    const encrypted = encrypt(value);
    storeSet(`secret_fallback_${account}`, encrypted);
    storeSet(`secret_${account}`, undefined);
  } catch (e) {
    if (e.message === "VAULT_LOCKED") {
      throw new Error("Local credential vault is locked or uninitialized. Please initialize or unlock your vault first under the Security Vault settings.");
    }
    throw e;
  }
}

async function clearStoredApiKey(account) {
  storeSet(`secret_${account}`, undefined);
  storeSet(`secret_fallback_${account}`, undefined);
}

function getVaultStatus() {
  const hasSafeStorage = secureStorageAvailable();
  const isSetup = Boolean(storeGet("vaultSentinel"));
  const isLocked = !hasSafeStorage && !sessionEncryptionKey;
  return { hasSafeStorage, isSetup, isLocked };
}

function setupVault(passphrase) {
  if (storeGet("vaultSentinel")) throw new Error("Vault is already initialized. Reinitialization would make existing credentials unreadable.");
  if (!passphrase || passphrase.length < 8) {
    throw new Error("Passphrase must be at least 8 characters long.");
  }
  const newSalt = crypto.randomBytes(32).toString("hex");
  storeSet("vaultSalt", newSalt);

  sessionEncryptionKey = deriveKeyFromPassphrase(passphrase, newSalt);
  const sentinel = encrypt("pennyworth-vault-unlocked-sentinel");
  storeSet("vaultSentinel", sentinel);
  return true;
}

function unlockVault(passphrase) {
  const sentinel = storeGet("vaultSentinel");
  if (!sentinel) {
    throw new Error("Vault is not initialized.");
  }
  const activeSalt = getActiveSalt();
  const tempKey = deriveKeyFromPassphrase(passphrase, activeSalt);

  try {
    const parts = sentinel.split(":");
    let decrypted = "";
    if (parts.length === 3) {
      const iv = Buffer.from(parts[0], "hex");
      const tag = Buffer.from(parts[1], "hex");
      const encrypted = parts[2];
      const decipher = crypto.createDecipheriv("aes-256-gcm", tempKey, iv);
      decipher.setAuthTag(tag);
      decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");
    } else {
      const iv = Buffer.from(parts[0], "hex");
      const encrypted = parts[1];
      const decipher = crypto.createDecipheriv("aes-256-cbc", tempKey, iv);
      decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");
    }

    if (decrypted === "pennyworth-vault-unlocked-sentinel") {
      sessionEncryptionKey = tempKey;
      return true;
    }
  } catch (e) {}

  throw new Error("Incorrect master passphrase.");
}

module.exports = {
  secureStorageAvailable,
  encrypt,
  decrypt,
  getStoredApiKey,
  setStoredApiKey,
  clearStoredApiKey,
  getVaultStatus,
  setupVault,
  unlockVault,
};
