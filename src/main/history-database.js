const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const { checkedPath, openRegularFile } = require("../core/safe-path");

function validId(id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid session ID.");
  return id;
}
function pageSize(value = 50) {
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error("Invalid page size.");
  return value;
}
function validText(text) {
  if (typeof text !== "string" || !text.trim() || Buffer.byteLength(text) > 1024 * 1024) throw new Error("Message must contain text and be at most 1 MB.");
  return text;
}
function openHistory(root) {
  checkedPath(root);
  const directory = checkedPath(path.join(root, "history"));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const filename = checkedPath(path.join(directory, "conversations.sqlite"));
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const candidate = checkedPath(filename + suffix);
    if (fs.existsSync(candidate)) {
      const stat = fs.lstatSync(candidate);
      if (!stat.isFile() || stat.nlink !== 1) throw new Error("Unsafe history database file.");
    }
  }
  const fd = fs.openSync(filename, fs.constants.O_CREAT | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW, 0o600);
  fs.closeSync(fd);
  fs.chmodSync(filename, 0o600);
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > 1) { db.close(); throw new Error("History was created by a newer app version."); }
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, titleSource TEXT,
      titleProvider TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS session_order ON sessions(updatedAt DESC, id DESC);
    CREATE TABLE IF NOT EXISTS messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'complete', requestId TEXT
    );
    CREATE INDEX IF NOT EXISTS message_order ON messages(sessionId, seq DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS one_pending_request ON messages(sessionId) WHERE status='pending';
    CREATE INDEX IF NOT EXISTS message_request ON messages(requestId);
    CREATE TABLE IF NOT EXISTS imports (filename TEXT PRIMARY KEY);
    PRAGMA user_version=1;
  `);
  const transaction = fn => {
    db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  const migrationWarnings = [];
  const legacy = checkedPath(path.join(root, "sessions"));
  if (fs.existsSync(legacy)) {
    for (const file of fs.readdirSync(legacy).filter(name => name.endsWith(".json"))) {
      if (db.prepare("SELECT 1 FROM imports WHERE filename=?").get(file)) continue;
      try {
        const id = validId(file.slice(0, -5));
        const { fd, stat } = openRegularFile(path.join(legacy, file));
        let session;
        try {
          if (stat.size > 10 * 1024 * 1024) throw new Error("File exceeds 10 MB migration limit.");
          session = JSON.parse(fs.readFileSync(fd, "utf8"));
        } finally { fs.closeSync(fd); }
        if (session.id !== id || !Array.isArray(session.messages)) throw new Error("Invalid conversation structure.");
        for (const message of session.messages) {
          if (!["user", "assistant"].includes(message.role) || typeof message.content !== "string") throw new Error("Invalid message structure.");
        }
        const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : new Date(0).toISOString();
        transaction(() => {
          if (!db.prepare("SELECT 1 FROM sessions WHERE id=?").get(id)) {
            db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?)").run(id, String(session.title || "Untitled Chat"), session.titleSource || null, session.titleProvider || null, date(session.createdAt), date(session.updatedAt || session.createdAt));
            const insert = db.prepare("INSERT INTO messages(sessionId,role,content) VALUES(?,?,?)");
            for (const message of session.messages) insert.run(id, message.role, message.content);
          }
          db.prepare("INSERT INTO imports VALUES(?)").run(file);
        });
      } catch (error) { migrationWarnings.push({ file, error: error.message }); }
    }
  }
  // A pending request at startup was interrupted before a response was committed.
  db.exec("UPDATE messages SET status='interrupted' WHERE status='pending'");
  const metadata = id => db.prepare("SELECT * FROM sessions WHERE id=?").get(validId(id));
  const required = id => { const session = metadata(id); if (!session) throw new Error("Session not found."); return session; };
  const needsTitle = session => session.titleSource !== "manual" && session.titleSource !== "llm" && (!session.title || session.title === "Untitled Chat");
  return {
    list({ cursor = null, limit = 50 } = {}) {
      limit = pageSize(limit);
      let rows;
      if (cursor) {
        validId(cursor.id);
        if (typeof cursor.updatedAt !== "string") throw new Error("Invalid conversation cursor.");
        rows = db.prepare("SELECT * FROM sessions WHERE (updatedAt,id)<(?,?) ORDER BY updatedAt DESC,id DESC LIMIT ?").all(cursor.updatedAt, cursor.id, limit + 1);
      } else rows = db.prepare("SELECT * FROM sessions ORDER BY updatedAt DESC,id DESC LIMIT ?").all(limit + 1);
      const hasMore = rows.length > limit;
      const sessions = rows.slice(0, limit);
      const last = sessions.at(-1);
      return { sessions, nextCursor: hasMore ? { id: last.id, updatedAt: last.updatedAt } : null, migrationWarnings };
    },
    load({ sessionId, before = null, limit = 50 }) {
      const session = required(sessionId);
      limit = pageSize(limit);
      if (before !== null && (!Number.isSafeInteger(before) || before < 1)) throw new Error("Invalid message cursor.");
      const rows = db.prepare("SELECT seq,role,content,status FROM messages WHERE sessionId=? AND seq<? ORDER BY seq DESC LIMIT ?").all(sessionId, before || Number.MAX_SAFE_INTEGER, limit + 1);
      const hasMore = rows.length > limit;
      const messages = rows.slice(0, limit).reverse();
      return { session: { ...session, messages }, nextBefore: hasMore ? messages[0].seq : null };
    },
    create() {
      const id = randomUUID(), now = new Date().toISOString();
      db.prepare("INSERT INTO sessions VALUES(?, 'Untitled Chat', NULL, NULL, ?, ?)").run(id, now, now);
      return { sessionId: id, session: { ...metadata(id), messages: [] } };
    },
    rename({ sessionId, title, source = "manual" }) {
      if (typeof title !== "string" || !title.trim() || title.trim().length > 80 || /[\x00-\x1f\x7f]/.test(title)) throw new Error("Use a title of 1–80 characters without control characters.");
      if (!["manual", "llm"].includes(source)) throw new Error("Invalid title source.");
      const session = required(sessionId);
      if (source === "llm" && !needsTitle(session)) return null;
      db.prepare("UPDATE sessions SET title=?,titleSource=? WHERE id=?").run(title.trim(), source, sessionId);
      return metadata(sessionId);
    },
    titleContext({ sessionId }) {
      const session = required(sessionId);
      if (!needsTitle(session)) return null;
      const message = db.prepare("SELECT content FROM messages WHERE sessionId=? AND role='user' ORDER BY seq LIMIT 1").get(sessionId);
      return message ? { ...session, question: message.content.slice(0, 2000) } : null;
    },
    delete({ sessionId }) {
      return db.prepare("DELETE FROM sessions WHERE id=?").run(validId(sessionId)).changes > 0;
    },
    begin({ sessionId, question }) {
      required(sessionId); validText(question);
      return transaction(() => {
        if (db.prepare("SELECT 1 FROM messages WHERE sessionId=? AND status='pending'").get(sessionId)) throw new Error("A request is already running for this conversation.");
        const history = db.prepare("SELECT role,content FROM messages WHERE sessionId=? AND status='complete' ORDER BY seq DESC LIMIT 8").all(sessionId).reverse();
        const requestId = randomUUID();
        db.prepare("INSERT INTO messages(sessionId,role,content,status,requestId) VALUES(?,'user',?,'pending',?)").run(sessionId, question, requestId);
        db.prepare("UPDATE sessions SET updatedAt=? WHERE id=?").run(new Date().toISOString(), sessionId);
        return { requestId, history, session: metadata(sessionId) };
      });
    },
    finish({ sessionId, requestId, reply, provider, status = "complete" }) {
      validId(sessionId);
      if (!["complete", "failed", "cancelled"].includes(status)) throw new Error("Invalid request status.");
      if (status === "complete") validText(reply);
      return transaction(() => {
        const request = db.prepare("SELECT 1 FROM messages WHERE sessionId=? AND requestId=? AND status='pending'").get(sessionId, requestId);
        if (!request) throw new Error("Pending conversation request not found.");
        db.prepare("UPDATE messages SET status=? WHERE requestId=?").run(status, requestId);
        if (status === "complete") db.prepare("INSERT INTO messages(sessionId,role,content,requestId) VALUES(?,'assistant',?,?)").run(sessionId, reply, requestId);
        db.prepare("UPDATE sessions SET updatedAt=?,titleProvider=COALESCE(titleProvider,?) WHERE id=?").run(new Date().toISOString(), provider || null, sessionId);
        return metadata(sessionId);
      });
    },
    close() { db.close(); },
  };
}
module.exports = { openHistory };
