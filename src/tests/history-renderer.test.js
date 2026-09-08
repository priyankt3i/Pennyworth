const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const vm = require("vm");
const path = require("path");

// Minimal DOM fixture for batching and asynchronous page ownership, not visual styling.
class Element {
  constructor(tag = "div") { this.tag = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.className = ""; this.classList = { toggle() {}, add() {}, remove() {} }; this.scrollTop = 0; }
  set innerHTML(value) { this.children = []; this.html = value; }
  get scrollHeight() { return this.children.length * 20; }
  appendChild(child) {
    if (child.tag === "fragment") { for (const node of [...child.children]) this.appendChild(node); return; }
    child.parent = this; this.children.push(child);
  }
  prepend(child) {
    const nodes = child.tag === "fragment" ? child.children : [child];
    nodes.forEach(node => { node.parent = this; }); this.children.unshift(...nodes);
  }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  setAttribute() {}
  querySelector(selector) {
    for (const child of this.children) {
      if (child.className.split(" ").includes(selector.slice(1))) return child;
      const match = child.querySelector(selector); if (match) return match;
    }
    return null;
  }
}
function renderer(loadSession) {
  const el = Object.fromEntries(["chat", "sessionsList", "loader", "sendBtn", "captureBtn", "voiceBtn", "promptInput", "newChatBtn"].map(name => [name, new Element()]));
  const context = vm.createContext({
    el, state: { sessions: [], history: [], isBusy: false }, console,
    window: { pennyworth: { loadSession } },
    document: { createElement: tag => new Element(tag), createDocumentFragment: () => new Element("fragment") },
    setStatus() {}, renderToolTrace() {},
  });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../renderer/chat.js"), "utf8"), context);
  vm.runInContext("renderMarkdown = text => text", context);
  return context;
}
function page(prefix, offset, nextBefore) {
  return { ok: true, nextBefore, session: { messages: Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `${prefix}-${offset + i}`, status: "complete" })) } };
}

test("renderer opens a bounded message page and prepends older messages without expanding model history", async () => {
  const calls = [];
  const context = renderer(async (id, options) => { calls.push(options); return options ? page("A", 0, null) : page("A", 50, 51); });
  await context.switchSessionFlow("A");
  assert.equal(context.el.chat.children.filter(child => child.className.startsWith("message ")).length, 50);
  assert.equal(context.state.history.length, 8);
  const button = context.el.chat.querySelector(".history-load-more");
  await button.listeners.click();
  assert.equal(context.el.chat.children.length, 100);
  assert.equal(context.state.history.length, 8);
  assert.equal(context.el.chat.children[0].querySelector(".message-body").html, "A-0");
  assert.equal(context.el.chat.children.at(-1).querySelector(".message-body").html, "A-99");
  assert.equal(calls[1].before, 51);
});

test("a delayed older-message page cannot leak into a different conversation", async () => {
  let resolveOlder;
  const context = renderer((id, options) => options ? new Promise(resolve => { resolveOlder = resolve; }) : Promise.resolve(page(id, 50, 51)));
  await context.switchSessionFlow("A");
  const loading = context.el.chat.querySelector(".history-load-more").listeners.click();
  await context.switchSessionFlow("B");
  resolveOlder(page("A", 0, null));
  await loading;
  assert.equal(context.state.activeSessionId, "B");
  assert.equal(context.el.chat.children.filter(child => child.className.startsWith("message ")).length, 50);
  assert.equal(context.el.chat.children.at(-1).querySelector(".message-body").html, "B-99");
});

test("new chat selects and lists the created conversation without referencing a sent message", async () => {
  const context = renderer();
  const statuses = [];
  context.setStatus = (message, kind) => statuses.push({ message, kind });
  context.window.pennyworth.newSession = async () => ({ ok: true, sessionId: "new-chat", session: { id: "new-chat", title: "Untitled Chat", updatedAt: "2026-01-01" } });
  vm.runInContext("checkActiveProviderStatus = async () => true", context);
  await context.createNewSessionFlow();
  assert.equal(context.state.activeSessionId, "new-chat");
  assert.equal(context.state.sessions[0].id, "new-chat");
  assert.equal(context.state.isBusy, false);
  assert.equal(context.el.newChatBtn.disabled, false);
  assert.equal(statuses.at(-1).message, "New chat ready.");
  assert.equal(context.el.chat.children.length, 1);
});

test("new-chat storage failure shows its underlying reason without replacing the active chat", async () => {
  const context = renderer();
  context.state.activeSessionId = "existing";
  const statuses = [];
  context.setStatus = message => statuses.push(message);
  context.window.pennyworth.newSession = async () => ({ ok: false, error: "disk full" });
  await context.createNewSessionFlow();
  assert.equal(context.state.activeSessionId, "existing");
  assert.equal(context.state.isBusy, false);
  assert.match(statuses.at(-1), /disk full/);
});
