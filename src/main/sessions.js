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

module.exports = {
  getSessionFilePath,
  listSessions,
  loadSession,
  deleteSession,
};
