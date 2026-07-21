const fs = require("fs");
const path = require("path");
const os = require("os");

let app;
try {
  app = require("electron").app;
} catch (e) {
  // Silent fallback
}

function getMemoryFilePath() {
  if (!app) {
    return path.join(os.tmpdir(), "pennyworth-memory.json");
  }
  return path.join(app.getPath("userData"), "pennyworth-memory.json");
}

function readMemory() {
  try {
    const memoryPath = getMemoryFilePath();
    if (fs.existsSync(memoryPath)) {
      return JSON.parse(fs.readFileSync(memoryPath, "utf8"));
    }
  } catch (error) {
    console.error("Failed to read butler memory:", error);
  }
  return [];
}

function writeMemory(memories) {
  try {
    const memoryPath = getMemoryFilePath();
    fs.writeFileSync(memoryPath, JSON.stringify(memories, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to write butler memory:", error);
  }
}

function runRememberFact(fact) {
  const cleanFact = String(fact || "").trim();
  if (!cleanFact) {
    return "Error: No fact provided.";
  }
  const memories = readMemory();
  memories.push({
    at: new Date().toISOString(),
    fact: cleanFact,
  });
  writeMemory(memories);
  return `Successfully remembered fact: "${cleanFact}"`;
}

function runRecallFacts(query) {
  const cleanQuery = String(query || "").trim().toLowerCase();
  const memories = readMemory();
  const filtered = cleanQuery
    ? memories.filter((m) => String(m.fact).toLowerCase().includes(cleanQuery))
    : memories;

  if (!filtered.length) {
    return cleanQuery ? `No remembered facts match "${cleanQuery}".` : "No remembered facts found.";
  }

  return filtered
    .map((m) => `[${new Date(m.at).toLocaleString()}] ${m.fact}`)
    .join("\n");
}

module.exports = {
  runRememberFact,
  runRecallFacts,
};
