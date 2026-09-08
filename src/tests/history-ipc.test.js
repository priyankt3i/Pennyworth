const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

function handlers(historyStore, askWithFailover) {
  const registered = {};
  const filename = path.resolve(__dirname, "../main/ipc-handlers.js");
  const localRequire = createRequire(filename);
  const config = { providers: { ollama: { enabled: true }, openai: {}, gemini: {} } };
  const overrides = {
    electron: {},
    "./history": { titleContext: async () => null, ...historyStore },
    "./ipc-security": { guardedIpcMain: { on() {}, handle: (name, callback) => { registered[name] = callback; } } },
    "./store": { storeGet() {}, storeSet() {} },
    "./vault": { getStoredApiKey: async () => "" },
    "./bootstrap": {},
    "./provider-config": { getProviderState: () => config },
    "./health": {},
    "./profiles": { getAgentContextState: () => ({}), runtimeState: () => ({ contextWithOverrides: { systemContext: {} } }) },
    "./local-whisper": {},
    "../core/rag": { retrieveContext: () => [] },
    "../core/providers": { askWithFailover, cancelCurrentSession() {} },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, exports: module.exports, __dirname: path.dirname(filename),
    require: name => Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name),
    console, process, Buffer, setTimeout, clearTimeout,
  });
  module.exports.registerIpcHandlers(() => null);
  return registered;
}
const event = { sender: { isDestroyed: () => false, send() {} } };
const pending = { requestId: "request", session: { id: "chat" }, history: [{ role: "user", content: "saved context" }] };

test("ask persists query first and ignores renderer-supplied model history", async () => {
  const calls = [];
  const ipc = handlers({
    begin: async () => { calls.push("begin"); return pending; },
    finish: async () => { calls.push("finish"); return pending.session; },
  }, async (_config, context) => {
    calls.push("provider");
    assert.equal(context.history[0].content, "saved context");
    return { reply: "answer", provider: "ollama" };
  });
  const result = await ipc["pennyworth:ask"](event, { sessionId: "chat", question: "hello", history: [{ role: "user", content: "untrusted context" }] });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["begin", "provider", "finish"]);
});

test("cancellation during pending persistence prevents provider execution and saves cancellation", async () => {
  let resolveBegin;
  let finished;
  const ipc = handlers({
    begin: () => new Promise(resolve => { resolveBegin = resolve; }),
    finish: async payload => { finished = payload; return pending.session; },
  }, async () => { assert.fail("Provider must not run after cancellation"); });
  const resultPromise = ipc["pennyworth:ask"](event, { sessionId: "chat", question: "hello" });
  await ipc["pennyworth:cancel-agent"](event, "chat");
  resolveBegin(pending);
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(finished.status, "cancelled");
});

test("a save failure returns the generated reply with an explicit warning", async () => {
  const ipc = handlers({
    begin: async () => pending,
    finish: async payload => { if (payload.reply) throw new Error("disk full"); return pending.session; },
  }, async () => ({ reply: "keep this answer", provider: "ollama" }));
  const result = await ipc["pennyworth:ask"](event, { sessionId: "chat", question: "hello" });
  assert.equal(result.ok, true);
  assert.equal(result.reply, "keep this answer");
  assert.match(result.saveError, /could not be saved: disk full/);
});

test("IPC persists incomplete replies with their explicit outcome", async () => {
  let saved;
  const ipc = handlers({
    begin: async () => pending,
    finish: async payload => { saved = payload; return pending.session; },
  }, async () => ({ reply: "Work remains.", provider: "ollama", outcome: "incomplete" }));
  const result = await ipc["pennyworth:ask"](event, { sessionId: "chat", question: "hello" });
  assert.equal(result.outcome, "incomplete");
  assert.equal(saved.status, "incomplete");
});

test("IPC saves cancellation evidence and returns it to the renderer", async () => {
  let saved;
  const ipc = handlers({
    begin: async () => pending,
    finish: async payload => { saved = payload; return pending.session; },
  }, async () => { throw Object.assign(new Error("AGENT_STOPPED"), { code: "AGENT_STOPPED", recoveryReport: "Run cancelled. A tool already ran." }); });
  const result = await ipc["pennyworth:ask"](event, { sessionId: "chat", question: "hello" });
  assert.equal(saved.status, "cancelled");
  assert.equal(saved.report, result.recoveryReport);
  assert.match(result.recoveryReport, /tool already ran/);
});
