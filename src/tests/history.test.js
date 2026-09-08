const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Worker } = require("worker_threads");
const { openHistory } = require("../main/history-database");

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pennyworth-history-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function legacy(root, id, messages = []) {
  fs.mkdirSync(path.join(root, "sessions"), { recursive: true });
  const session = { id, title: "Untitled Chat", createdAt: "2026-01-01T00:00:00.000Z", messages };
  fs.writeFileSync(path.join(root, "sessions", `${id}.json`), JSON.stringify(session));
  return session;
}

test("migration preserves originals, reports bad files, and never resurrects deleted imports", t => {
  const root = fixture(t);
  const original = legacy(root, "legacy", [{ role: "user", content: "hello" }]);
  fs.writeFileSync(path.join(root, "sessions", "broken.json"), "{");
  let db = openHistory(root);
  assert.equal(db.list().sessions.length, 1);
  assert.equal(db.list().migrationWarnings[0].file, "broken.json");
  assert.equal(db.load({ sessionId: "legacy" }).session.messages[0].content, "hello");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "sessions", "legacy.json"))), original);
  db.delete({ sessionId: "legacy" }); db.close();
  db = openHistory(root);
  assert.equal(db.list().sessions.length, 0);
  // A repaired failed import is retried, while completed imports stay completed.
  legacy(root, "broken", [{ role: "assistant", content: "repaired" }]);
  db.close(); db = openHistory(root);
  assert.equal(db.list().sessions[0].id, "broken");
  db.close();
});

test("session keyset pages handle identical timestamps without gaps or duplicates", t => {
  const root = fixture(t);
  for (let i = 0; i < 123; i++) legacy(root, `chat-${String(i).padStart(3, "0")}`);
  const db = openHistory(root); t.after(() => db.close());
  const ids = [];
  let cursor = null;
  do {
    const page = db.list({ cursor, limit: 50 });
    assert.ok(page.sessions.length <= 50);
    assert.ok(page.sessions.every(session => !Object.hasOwn(session, "messages")));
    ids.push(...page.sessions.map(session => session.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(ids.length, 123);
  assert.equal(new Set(ids).size, 123);
  assert.equal(ids[0], "chat-122");
  assert.throws(() => db.list({ limit: 10000 }), /page size/);
});

test("message pages stay chronological and stable when a new response is appended", t => {
  const root = fixture(t);
  legacy(root, "long", Array.from({ length: 137 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `message ${i}` })));
  const db = openHistory(root); t.after(() => db.close());
  const latest = db.load({ sessionId: "long" });
  assert.equal(latest.session.messages.length, 50);
  assert.equal(latest.session.messages[0].content, "message 87");
  const run = db.begin({ sessionId: "long", question: "new question" });
  assert.equal(run.history.length, 8);
  db.finish({ sessionId: "long", requestId: run.requestId, reply: "new answer", provider: "gemini" });
  let before = latest.nextBefore;
  const all = [...latest.session.messages];
  while (before) {
    const page = db.load({ sessionId: "long", before });
    all.unshift(...page.session.messages); before = page.nextBefore;
  }
  assert.equal(all.length, 137);
  assert.equal(new Set(all.map(message => message.seq)).size, 137);
  assert.equal(all[0].content, "message 0");
  assert.throws(() => db.load({ sessionId: "long", before: -1 }), /cursor/);
});

test("failed, cancelled and interrupted prompts survive restart; duplicate replies cannot commit", t => {
  const root = fixture(t);
  let db = openHistory(root);
  const { sessionId } = db.create();
  let run = db.begin({ sessionId, question: "failed question" });
  assert.throws(() => db.begin({ sessionId, question: "duplicate" }), /already running/);
  db.finish({ sessionId, requestId: run.requestId, status: "failed" });
  run = db.begin({ sessionId, question: "cancelled question" });
  db.finish({ sessionId, requestId: run.requestId, status: "cancelled" });
  run = db.begin({ sessionId, question: "interrupted question" });
  db.close(); db = openHistory(root);
  assert.deepEqual(db.load({ sessionId }).session.messages.map(m => m.status), ["failed", "cancelled", "interrupted"]);
  run = db.begin({ sessionId, question: "successful question" });
  assert.equal(run.history.length, 0);
  db.finish({ sessionId, requestId: run.requestId, reply: "answer", provider: "ollama" });
  assert.throws(() => db.finish({ sessionId, requestId: run.requestId, reply: "duplicate" }), /not found/);
  assert.equal(db.load({ sessionId }).session.messages.length, 5);
  db.close();
});

test("title updates use metadata and respect manual changes during generation", t => {
  const root = fixture(t);
  legacy(root, "title", [{ role: "user", content: "How do I run CS2?" }]);
  const db = openHistory(root); t.after(() => db.close());
  assert.equal(db.titleContext({ sessionId: "title" }).question, "How do I run CS2?");
  db.rename({ sessionId: "title", title: "My games" });
  assert.equal(db.rename({ sessionId: "title", title: "Late title", source: "llm" }), null);
  assert.equal(db.titleContext({ sessionId: "title" }), null);
  assert.equal(db.load({ sessionId: "title" }).session.messages.length, 1);
  assert.throws(() => db.rename({ sessionId: "title", title: "\n" }), /title/);
  db.delete({ sessionId: "title" });
  assert.throws(() => db.finish({ sessionId: "title", requestId: "missing", reply: "late" }), /not found/);
});

test("history rejects linked database files and skips linked legacy conversations", { skip: process.platform === "win32" }, t => {
  const root = fixture(t);
  legacy(root, "safe");
  fs.symlinkSync(path.join(root, "sessions", "safe.json"), path.join(root, "sessions", "link.json"));
  const db = openHistory(root);
  assert.equal(db.list().sessions.length, 1);
  assert.match(db.list().migrationWarnings[0].error, /Symbolic/);
  db.close();
  const second = fixture(t);
  fs.mkdirSync(path.join(second, "history"));
  fs.symlinkSync(path.join(root, "history", "conversations.sqlite"), path.join(second, "history", "conversations.sqlite"));
  assert.throws(() => openHistory(second), /Symbolic/);
});

test("real worker imports history and serves pages without blocking its caller", async t => {
  const root = fixture(t);
  for (let i = 0; i < 100; i++) legacy(root, `worker-${i}`, [{ role: "user", content: "test" }]);
  const worker = new Worker(path.resolve(__dirname, "../main/history-worker.js"), { workerData: { root } });
  t.after(() => worker.terminate());
  const response = new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
  worker.postMessage({ id: 1, method: "list", payload: { limit: 50 } });
  let callerResponsive = false;
  await new Promise(resolve => setImmediate(() => { callerResponsive = true; resolve(); }));
  const result = await response;
  assert.equal(callerResponsive, true);
  assert.equal(result.result.sessions.length, 50);
  assert.ok(result.result.nextCursor);
});

test("a failed assistant insert rolls back the request status with the response", t => {
  const root = fixture(t);
  const db = openHistory(root); t.after(() => db.close());
  const { sessionId } = db.create();
  const run = db.begin({ sessionId, question: "persist me" });
  const { DatabaseSync } = require("node:sqlite");
  const inspector = new DatabaseSync(path.join(root, "history", "conversations.sqlite"));
  t.after(() => inspector.close());
  inspector.exec("CREATE TRIGGER reject_reply BEFORE INSERT ON messages WHEN NEW.role='assistant' BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END");
  assert.throws(() => db.finish({ sessionId, requestId: run.requestId, reply: "answer" }), /simulated/);
  const messages = db.load({ sessionId }).session.messages;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].status, "pending");
  inspector.exec("DROP TRIGGER reject_reply");
  db.finish({ sessionId, requestId: run.requestId, reply: "answer" });
  assert.equal(db.load({ sessionId }).session.messages.length, 2);
});
