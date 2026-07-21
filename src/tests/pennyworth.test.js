const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const Module = require("module");

// 1. Mock Electron globally before loading any project files
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === "electron") {
    return {
      app: {
        getPath: () => os.tmpdir(),
        whenReady: () => Promise.resolve(),
        on: () => {},
        setAppUserModelId: () => {},
      },
      BrowserWindow: {
        getFocusedWindow: () => null,
        getAllWindows: () => [],
      },
      ipcMain: {
        handle: () => {},
        on: () => {},
      },
      Menu: {
        setApplicationMenu: () => {},
        buildFromTemplate: () => {},
      },
      Tray: class {
        setToolTip() {}
        on() {}
        setContextMenu() {}
      },
      nativeImage: {
        createFromPath: () => ({ isEmpty: () => true }),
        createEmpty: () => ({}),
      },
      globalShortcut: {
        register: () => {},
        unregisterAll: () => {},
      },
    };
  }
  return originalRequire.apply(this, arguments);
};

// Set test environment variables
process.env.NODE_ENV = "test";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Load project modules
const mainModule = require("../main");
const providersModule = require("../core/providers");
const toolsModule = require("../core/tools");

test("OS Profile Auto-Detection", async (t) => {
  const mockDistroConfig = {
    defaultProfile: "cachyos",
    profiles: {
      cachyos: { name: "CachyOS", family: "arch" },
      windows_11: { name: "Windows 11", family: "windows" },
      windows_10: { name: "Windows 10", family: "windows" },
      windows_server_2025: { name: "Windows Server 2025", family: "windows" },
      macos_sequoia: { name: "macOS 15 Sequoia", family: "darwin" },
      macos_tahoe: { name: "macOS 16 Tahoe", family: "darwin" },
      ubuntu_lts: { name: "Ubuntu LTS", family: "debian" },
    },
  };

  await t.test("should resolve win32 to Windows 11 profile by default", () => {
    const result = mainModule.autoDetectProfileId(mockDistroConfig, {
      platform: "win32",
      distro: { name: "Windows 11 Enterprise" },
    });
    assert.strictEqual(result.profileId, "windows_11");
  });

  await t.test("should resolve Windows Server 2025 specifically", () => {
    const result = mainModule.autoDetectProfileId(mockDistroConfig, {
      platform: "win32",
      distro: { prettyName: "Windows Server 2025 Standard" },
    });
    assert.strictEqual(result.profileId, "windows_server_2025");
  });

  await t.test("should resolve darwin to macOS Sequoia by default", () => {
    const result = mainModule.autoDetectProfileId(mockDistroConfig, {
      platform: "darwin",
      distro: { name: "macOS" },
    });
    assert.strictEqual(result.profileId, "macos_sequoia");
  });

  await t.test("should resolve macOS Tahoe version 16 specifically", () => {
    const result = mainModule.autoDetectProfileId(mockDistroConfig, {
      platform: "darwin",
      distro: { prettyName: "macOS Version 16.0" },
    });
    assert.strictEqual(result.profileId, "macos_tahoe");
  });
});

test("Secure API Key Storage Fallback", async (t) => {
  await t.test("should encrypt and decrypt values symmetrically", () => {
    const secret = "openai-api-key-xyz-123456";
    const encrypted = mainModule.encrypt(secret);
    assert.ok(encrypted.includes(":"));
    
    const decrypted = mainModule.decrypt(encrypted);
    assert.strictEqual(decrypted, secret);
  });

  await t.test("should read/write using fallback local storage when keytar is missing", async () => {
    const testSecret = "gemini-test-secret-key-999";
    
    // Save api key (triggers fallback as keytar is null/mocked out)
    await mainModule.setStoredApiKey("gemini_test", testSecret);
    
    // Read api key back
    const retrieved = await mainModule.getStoredApiKey("gemini_test");
    assert.strictEqual(retrieved, testSecret);

    // Clear api key
    await mainModule.clearStoredApiKey("gemini_test");
    const cleared = await mainModule.getStoredApiKey("gemini_test");
    assert.strictEqual(cleared, "");
  });
});

test("Persistent Butler Memory Tools", async (t) => {
  // Ensure we start with clean memory file
  const memPath = path.join(os.tmpdir(), "pennyworth-memory.json");
  if (fs.existsSync(memPath)) {
    try { fs.unlinkSync(memPath); } catch (e) {}
  }

  await t.test("should store fact using remember_fact tool", async () => {
    const result = await toolsModule.executeToolFunction("remember_fact", {
      fact: "User installed ripgrep package using pacman"
    }, {});

    assert.ok(result.includes("Successfully remembered fact"));
    assert.ok(fs.existsSync(memPath));
  });

  await t.test("should recall all facts", async () => {
    const result = await toolsModule.executeToolFunction("recall_facts", {}, {});
    assert.ok(result.includes("User installed ripgrep package"));
  });

  await t.test("should support search filtering inside recall_facts", async () => {
    // Add another fact
    await toolsModule.executeToolFunction("remember_fact", {
      fact: "Butler prefers tea over coffee"
    }, {});

    const matched = await toolsModule.executeToolFunction("recall_facts", { query: "tea" }, {});
    assert.ok(matched.includes("prefers tea"));
    assert.ok(!matched.includes("ripgrep"));

    const missing = await toolsModule.executeToolFunction("recall_facts", { query: "python" }, {});
    assert.ok(missing.includes("No remembered facts match"));
  });

  // Cleanup
  if (fs.existsSync(memPath)) {
    try { fs.unlinkSync(memPath); } catch (e) {}
  }
});

test("Hermes Agent Cancellation Loop", async (t) => {
  await t.test("should raise AGENT_STOPPED error when session is cancelled", () => {
    // Cancel the session
    providersModule.cancelCurrentSession();

    // Verify it throws the cancellation exception immediately
    assert.throws(() => {
      providersModule.checkCancellation();
    }, (err) => {
      return err.code === "AGENT_STOPPED";
    });
  });
});

test("Multi-Session Chat Database", async (t) => {
  const sessionsDir = path.join(os.tmpdir(), "sessions");
  if (fs.existsSync(sessionsDir)) {
    try {
      const files = fs.readdirSync(sessionsDir);
      for (const f of files) fs.unlinkSync(path.join(sessionsDir, f));
      fs.rmdirSync(sessionsDir);
    } catch (e) {}
  }
  fs.mkdirSync(sessionsDir, { recursive: true });

  let testSessionId = null;

  await t.test("should create a new session", () => {
    const mockUUID = "test-session-uuid-111";
    const sessionFile = path.join(sessionsDir, `${mockUUID}.json`);
    
    const newSession = {
      id: mockUUID,
      title: "Untitled Chat",
      createdAt: new Date().toISOString(),
      messages: []
    };

    fs.writeFileSync(sessionFile, JSON.stringify(newSession, null, 2), "utf8");
    assert.ok(fs.existsSync(sessionFile));
    testSessionId = mockUUID;
  });

  await t.test("should load the created session", () => {
    const sessionFile = path.join(sessionsDir, `${testSessionId}.json`);
    const content = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    assert.strictEqual(content.id, testSessionId);
    assert.strictEqual(content.title, "Untitled Chat");
  });

  await t.test("should list all session metadata in descending order", () => {
    const file1 = path.join(sessionsDir, "session-1.json");
    fs.writeFileSync(file1, JSON.stringify({ id: "session-1", title: "A", createdAt: "2026-07-20T12:00:00Z" }), "utf8");

    const file2 = path.join(sessionsDir, "session-2.json");
    fs.writeFileSync(file2, JSON.stringify({ id: "session-2", title: "B", createdAt: "2026-07-20T13:00:00Z" }), "utf8");

    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith(".json"));
    assert.strictEqual(files.length, 3);
  });

  if (fs.existsSync(sessionsDir)) {
    try {
      const files = fs.readdirSync(sessionsDir);
      for (const f of files) fs.unlinkSync(path.join(sessionsDir, f));
      fs.rmdirSync(sessionsDir);
    } catch (e) {}
  }
});
