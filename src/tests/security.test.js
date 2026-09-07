const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { createRequire } = require("module");
const { executionPlan, sandboxArgs, runProcess } = require("../core/execution-runner");

function load(relative, overrides = {}) {
  const filename = path.resolve(__dirname, relative);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    require: name => name in overrides ? overrides[name] : localRequire(name),
    module, exports: module.exports, __dirname: path.dirname(filename), process, Buffer, console,
    setTimeout, clearTimeout,
  }, { filename });
  return module.exports;
}
function temporary(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pennyworth-security-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function fileTools(approve) {
  return load("../core/tools/system-tools.js", { electron: {
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    dialog: { showMessageBox: approve },
  } });
}

test("session traversal and symlinks cannot escape session storage", t => {
  const dir = temporary(t);
  const sessions = load("../main/sessions.js", { electron: { app: { getPath: () => dir } } });
  for (const id of ["../settings", "..\\settings", "/tmp/x", "a/b", "", null, "a".repeat(129)]) {
    assert.throws(() => sessions.getSessionFilePath(id), /Invalid session/);
  }
  fs.writeFileSync(sessions.getSessionFilePath("valid-id"), '{"id":"valid-id"}');
  assert.equal(sessions.loadSession("valid-id").id, "valid-id");
  if (process.platform !== "win32") {
    fs.symlinkSync(path.join(dir, "outside.json"), path.join(dir, "sessions", "alias.json"));
    assert.throws(() => sessions.deleteSession("alias"), /Symbolic links/);
  }
});

test("file aliases, including parent links, are rejected before approval", { skip: process.platform !== "linux" }, async t => {
  const dir = temporary(t);
  fs.writeFileSync(path.join(dir, ".env"), "DUMMY_ONLY");
  fs.symlinkSync(path.join(dir, ".env"), path.join(dir, "notes.txt"));
  fs.mkdirSync(path.join(dir, "real"));
  fs.symlinkSync(path.join(dir, "real"), path.join(dir, "alias-dir"));
  let approvals = 0;
  const tools = fileTools(async () => { approvals++; return { response: 0 }; });
  assert.match(await tools.readSystemFile(path.join(dir, "notes.txt")), /Symbolic links/);
  assert.match(await tools.writeSystemFile(path.join(dir, "alias-dir", "new"), "test"), /Symbolic links/);
  assert.equal(approvals, 0);
  assert.equal(fs.readFileSync(path.join(dir, ".env"), "utf8"), "DUMMY_ONLY");
});

test("all reads require approval; absent UI denies even under NODE_ENV=test", async t => {
  const dir = temporary(t);
  const filepath = path.join(dir, "public.txt");
  fs.writeFileSync(filepath, "dummy");
  const tools = load("../core/tools/system-tools.js", { electron: {} });
  assert.match(await tools.readSystemFile(filepath), /FILE_READ_DENIED/);
});

test("writes show full content and preserve original backup", { skip: process.platform !== "linux" }, async t => {
  const dir = temporary(t);
  const filepath = path.join(dir, "config.txt");
  fs.writeFileSync(filepath, "before");
  let detail;
  const tools = fileTools(async (_, options) => { detail = options.detail; return { response: 0 }; });
  const result = JSON.parse(await tools.writeSystemFile(filepath, "after"));
  assert.equal(result.success, true);
  assert.match(detail, /Complete proposed content:\nafter/);
  assert.equal(fs.readFileSync(filepath, "utf8"), "after");
  assert.equal(fs.readFileSync(result.backup, "utf8"), "before");
});

test("cancellation or changing a file during approval prevents writes", { skip: process.platform !== "linux" }, async t => {
  const dir = temporary(t);
  const filepath = path.join(dir, "config.txt");
  fs.writeFileSync(filepath, "before");
  const controller = new AbortController();
  const cancelled = fileTools(async () => { controller.abort(); return { response: 0 }; });
  await assert.rejects(cancelled.writeSystemFile(filepath, "after", { signal: controller.signal }), /AGENT_STOPPED/);
  assert.equal(fs.readFileSync(filepath, "utf8"), "before");
  const raced = fileTools(async () => { fs.unlinkSync(filepath); fs.symlinkSync(path.join(dir, "other"), filepath); return { response: 0 }; });
  assert.match(await raced.writeSystemFile(filepath, "after"), /Symbolic links/);
  assert.equal(fs.existsSync(path.join(dir, "other")), false);
});

test("host approval binds command and target; denial and cancellation never execute", async () => {
  let executions = 0, options;
  const controller = new AbortController();
  const runner = {
    executionPlan: target => ({ target, description: "verified host fixture" }),
    runProcess: async () => { executions++; },
    checkSignal: signal => { if (signal?.aborted) throw Object.assign(new Error("AGENT_STOPPED"), { code: "AGENT_STOPPED" }); },
  };
  const electron = {
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    dialog: { showMessageBox: async (_, detail) => { options = detail; return { response: 1 }; } },
  };
  const tools = load("../core/tools/system-tools.js", { electron, "../execution-runner": runner });
  assert.match(await tools.executeSystemCommand("pwd", { target: "host" }), /DENIED/);
  assert.match(options.detail, /Command: pwd/);
  assert.match(options.detail, /verified host fixture/);
  assert.match(options.message, /READ.*HOST/);
  electron.dialog.showMessageBox = async () => { controller.abort(); return { response: 0 }; };
  await assert.rejects(tools.executeSystemCommand("pwd", { target: "host", signal: controller.signal }), /AGENT_STOPPED/);
  assert.equal(executions, 0);
});

test("risk scoring blocks reordered destructive flags and never auto-approves extra shell options", () => {
  const { assessCommandRisk } = require("../core/tools/system-tools");
  for (const command of ["rm -fr /", "rm -r -f /", "rm --recursive --force /", "rm -rf /"]) assert.equal(assessCommandRisk(command).score, 4, command);
  for (const command of ["git diff --no-index /etc/hosts /etc/fstab", "git status; touch x", "npm test", "pwd > x"]) assert.notEqual(assessCommandRisk(command).score, 1, command);
});

test("host target fails closed for unsupported and nested containers", () => {
  const native = { evidence: [] };
  const none = () => ({ status: 1, stdout: "none\n" });
  assert.equal(executionPlan("host", { context: native, platform: "linux", probe: none }).target, "host");
  assert.throws(() => executionPlan("host", { context: { evidence: ["Docker"] }, platform: "linux", probe: none }), /HOST_UNAVAILABLE/);
  assert.throws(() => executionPlan("host", { context: native, platform: "linux", probe: () => ({ status: 127 }) }), /HOST_UNAVAILABLE/);
  const plan = executionPlan("host", { context: { evidence: ["Flatpak"] }, platform: "linux", probe: none });
  assert.ok(plan.prefix.includes("--watch-bus"));
  assert.throws(() => executionPlan("host", { context: { evidence: ["Flatpak"] }, platform: "linux", probe: () => ({ status: 0, stdout: "docker" }) }), /HOST_UNAVAILABLE/);
  assert.throws(() => executionPlan("other"), /Unknown execution target/);
});

test("sandbox configuration has no host home, bus, or network mounts", () => {
  const args = sandboxArgs();
  assert.ok(args.includes("--unshare-all"));
  assert.ok(args.includes("--clearenv"));
  assert.equal(args.includes("/home"), false);
  assert.equal(args.includes("/run"), false);
  assert.equal(args.includes("--share-net"), false);
});

test("process runner reports provenance and removes inherited secrets", async () => {
  process.env.PENNYWORTH_TEST_SECRET = "dummy-not-for-child";
  try {
    const result = await runProcess({ executable: process.execPath, prefix: ["-e"], target: "test", verified: false, description: "test process" }, 'console.log(process.env.PENNYWORTH_TEST_SECRET || "absent")');
    assert.equal(result.stdout.trim(), "absent");
    assert.equal(result.exitCode, 0);
    assert.equal(result.target, "test");
    assert.ok(result.startedAt && result.finishedAt);
  } finally { delete process.env.PENNYWORTH_TEST_SECRET; }
});

test("cancellation terminates running shell descendants before delayed writes", { skip: process.platform !== "linux" }, async t => {
  const dir = temporary(t);
  const marker = path.join(dir, "marker");
  const controller = new AbortController();
  const pending = runProcess({ executable: "/bin/sh", prefix: ["-c"], target: "test" }, `sleep 0.4; echo unexpected > '${marker}'`, { signal: controller.signal });
  setTimeout(() => controller.abort(), 60);
  await assert.rejects(pending, /AGENT_STOPPED/);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(fs.existsSync(marker), false);
});

test("timeouts and output limits terminate commands", async () => {
  const plan = { executable: process.execPath, prefix: ["-e"], target: "test" };
  await assert.rejects(runProcess(plan, "setInterval(() => {}, 1000)", { timeoutMs: 60 }), /COMMAND_TIMEOUT/);
  await assert.rejects(runProcess(plan, 'console.log("x".repeat(10000))', { maxBytes: 100 }), /COMMAND_OUTPUT_LIMIT/);
});

test("IPC rejects missing sender, foreign windows and child frames", () => {
  let callback;
  const sender = { isDestroyed: () => false };
  const security = load("../main/ipc-security.js", { electron: {
    BrowserWindow: { fromWebContents: contents => contents === sender ? {} : null },
    ipcMain: { handle: (_, handler) => { callback = handler; } },
  } });
  const frame = { url: security.rendererUrl };
  sender.mainFrame = frame;
  security.guardedIpcMain.handle("test", () => "ok");
  assert.throws(() => callback(null), /Untrusted/);
  assert.throws(() => callback({ sender, senderFrame: { url: security.rendererUrl } }), /Untrusted/);
  assert.equal(callback({ sender, senderFrame: frame }), "ok");
  frame.url = "https://example.com";
  assert.throws(() => callback({ sender, senderFrame: frame }), /Untrusted/);
});

test("notification messages remain escaped text in toasts and history", () => {
  const appended = [];
  const context = {
    state: { notifications: [], unreadNotificationsCount: 0 },
    el: { toastContainer: { appendChild: node => appended.push(node) }, notificationsList: { appendChild: node => appended.push(node) } },
    document: { createElement: () => ({ dataset: {}, querySelector: () => ({ addEventListener() {} }) }) },
    setTimeout() {},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../renderer/chat.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../renderer/toasts.js"), "utf8"), context);
  vm.runInContext('pushNotification("error", "<img src=x onerror=alert(1)>"); renderNotificationsList();', context);
  assert.equal(appended.length, 2);
  for (const node of appended) { assert.ok(!node.innerHTML.includes("<img")); assert.ok(node.innerHTML.includes("&lt;img")); }
});

test("OpenAI and Gemini share execution target policy and diagnostic tools", () => {
  const tools = require("../core/tools");
  const openai = tools.getOpenAIToolDefinitions().map(t => t.function);
  const gemini = tools.getGeminiFunctionDeclarations();
  const a = openai.find(t => t.name === "execute_system_command");
  const b = gemini.find(t => t.name === a.name);
  assert.equal(a.description, b.description);
  assert.ok(a.parameters.required.includes("target"));
  assert.ok(b.parameters.required.includes("target"));
  for (const definitions of [openai, gemini]) assert.ok(definitions.some(t => t.name === "diagnose_system"));
});

test("basic_text key storage is rejected and existing vaults cannot be reset", () => {
  const values = new Map([["vaultSentinel", "existing"]]);
  const vault = load("../main/vault.js", {
    electron: { safeStorage: { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "basic_text" } },
    "./store": { storeGet: key => values.get(key), storeSet: (key, value) => values.set(key, value) },
  });
  assert.equal(vault.secureStorageAvailable(), false);
  assert.throws(() => vault.setupVault("new-long-passphrase"), /already initialized/);
  assert.equal(values.get("vaultSentinel"), "existing");
});

test("archive dependency override preserves zip round trips", () => {
  const { createRequire } = require("module");
  const transformersRequire = createRequire(require.resolve("@huggingface/transformers"));
  const ortRequire = createRequire(transformersRequire.resolve("onnxruntime-node"));
  const Zip = ortRequire("adm-zip");
  const zip = new Zip();
  zip.addFile("fixture.txt", Buffer.from("dummy archive"));
  assert.equal(new Zip(zip.toBuffer()).readAsText("fixture.txt"), "dummy archive");
});

test("desktop diagnostics require matching active graphical session and bus owner", { skip: process.platform !== "linux" }, async () => {
  const { DESKTOP_DIAGNOSTIC_COMMAND } = require("../core/tools/diagnostic-tools");
  const plan = { executable: "/bin/sh", prefix: ["-c"], target: "fixture" };
  const fixture = `
    id() { echo 12345; }
    loginctl() {
      case "$4" in
        Display) echo session-fixture ;;
        Type) echo wayland ;;
        Active) echo yes ;;
        User) echo 12345 ;;
      esac
    }
    gsettings() { echo ANIMATION_QUERY_EXECUTED; }
    XDG_SESSION_ID=session-fixture
  `;
  const matched = await runProcess(plan, fixture + '\ngdbus() { echo "(uint32 12345,)"; }\n' + DESKTOP_DIAGNOSTIC_COMMAND);
  assert.match(matched.stdout, /DESKTOP_SESSION_VERIFIED/);
  assert.match(matched.stdout, /ANIMATION_QUERY_EXECUTED/);
  const mismatch = await runProcess(plan, fixture + '\ngdbus() { echo "(uint32 99999,)"; }\n' + DESKTOP_DIAGNOSTIC_COMMAND);
  assert.match(mismatch.stdout, /DESKTOP_SESSION_UNVERIFIED/);
  assert.doesNotMatch(mismatch.stdout, /ANIMATION_QUERY_EXECUTED/);
});
