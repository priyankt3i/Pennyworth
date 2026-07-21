const fs = require("fs");
const path = require("path");
const { app } = require("electron");

function getSessionFilePath(sessionId) {
  const sessionsDir = path.join(app.getPath("userData"), "sessions");
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }
  return path.join(sessionsDir, `${sessionId}.json`);
}

function listSessions() {
  const sessionsDir = path.join(app.getPath("userData"), "sessions");
  if (!fs.existsSync(sessionsDir)) {
    return [];
  }
  const files = fs.readdirSync(sessionsDir).filter((file) => file.endsWith(".json"));
  const sessions = [];

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), "utf8"));
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
    return JSON.parse(fs.readFileSync(filepath, "utf8"));
  }
  return null;
}

function deleteSession(sessionId) {
  const filepath = getSessionFilePath(sessionId);
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
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
