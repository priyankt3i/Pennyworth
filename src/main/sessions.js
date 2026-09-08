const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { checkedPath, openRegularFile, openParent } = require("../core/safe-path");

function getSessionFilePath(sessionId) {
  if (typeof sessionId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) throw new Error("Invalid session ID.");
  const sessionsDir = checkedPath(path.join(app.getPath("userData"), "sessions"));
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }
  return checkedPath(path.join(sessionsDir, `${sessionId}.json`));
}

function listSessions() {
  const sessionsDir = checkedPath(path.join(app.getPath("userData"), "sessions"));
  if (!fs.existsSync(sessionsDir)) {
    return [];
  }
  const files = fs.readdirSync(sessionsDir).filter((file) => file.endsWith(".json"));
  const sessions = [];

  for (const file of files) {
    try {
      const data = loadSession(file.slice(0, -5));
      sessions.push({
        id: data.id,
        title: data.title || "Untitled Chat",
        createdAt: data.createdAt,
        updatedAt: data.updatedAt || data.createdAt,
      });
    } catch (e) {
      console.warn("Failed to read session file:", file, e.message);
    }
  }

  sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return sessions;
}

function loadSession(sessionId) {
  const filepath = getSessionFilePath(sessionId);
  if (fs.existsSync(filepath)) {
    const { fd, stat } = openRegularFile(filepath);
    try {
      if (stat.size > 10 * 1024 * 1024) throw new Error("Session file too large.");
      return JSON.parse(fs.readFileSync(fd, "utf8"));
    } finally { fs.closeSync(fd); }
  }
  return null;
}

function deleteSession(sessionId) {
  const filepath = getSessionFilePath(sessionId);
  if (fs.existsSync(filepath)) {
    const parent = process.platform === "linux" ? openParent(filepath) : null;
    try { fs.unlinkSync(parent ? parent.anchored : filepath); } finally { if (parent) fs.closeSync(parent.fd); }
    return true;
  }
  return false;
}

function needsAutomaticTitle(session) {
  return Boolean(session && session.titleSource !== "manual" && session.titleSource !== "llm" &&
    (!session.title || session.title === "Untitled Chat"));
}

function renameSession(sessionId, title, source = "manual") {
  if (typeof title !== "string" || !title.trim() || title.trim().length > 80 || /[\x00-\x1f\x7f]/.test(title)) {
    throw new Error("Use a title of 1–80 characters without control characters.");
  }
  const session = loadSession(sessionId);
  if (!session) throw new Error("Session not found.");
  if (source === "llm" && !needsAutomaticTitle(session)) return null;
  session.title = title.trim();
  session.titleSource = source;
  const filepath = getSessionFilePath(sessionId);
  const parent = process.platform === "linux" ? openParent(filepath) : null;
  const destination = parent ? parent.anchored : filepath;
  const temporary = `${destination}.${require("crypto").randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(session, null, 2), "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, destination);
    if (parent) fs.fsyncSync(parent.fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") console.warn("Session temporary cleanup failed."); }
    if (parent) fs.closeSync(parent.fd);
  }
  return { id: sessionId, title: session.title };
}

module.exports = {
  needsAutomaticTitle,
  renameSession,
  getSessionFilePath,
  listSessions,
  loadSession,
  deleteSession,
};
