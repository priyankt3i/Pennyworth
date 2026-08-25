const fs = require("fs");
const path = require("path");

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "with",
  "this",
  "what",
  "when",
  "where",
  "how",
  "are",
  "you",
  "today",
  "from",
  "have",
  "your",
  "can",
  "please",
  "need",
  "help",
  "about",
]);

const RAG_HINTS = new Set([
  "linux",
  "arch",
  "cachyos",
  "debian",
  "ubuntu",
  "fedora",
  "rhel",
  "kernel",
  "terminal",
  "shell",
  "bash",
  "zsh",
  "pacman",
  "paru",
  "yay",
  "apt",
  "dnf",
  "zypper",
  "grub",
  "boot",
  "driver",
  "gpu",
  "wifi",
  "bluetooth",
  "package",
  "install",
  "update",
  "upgrade",
  "error",
  "sudo",
  "systemd",
  "service",
]);

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...walkFiles(full));
    } else if (entry.isFile() && /\.(md|txt|json)$/i.test(entry.name)) {
      output.push(full);
    }
  }
  return output;
}

function scoreDocument(content, queryTokens) {
  if (!content || queryTokens.length === 0) {
    return 0;
  }
  const lower = content.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    const hits = lower.split(token).length - 1;
    score += hits;
  }
  return score;
}

function snippet(content, queryTokens, limit = 700) {
  if (!content) {
    return "";
  }
  const lower = content.toLowerCase();
  let index = 0;
  for (const token of queryTokens) {
    const pos = lower.indexOf(token);
    if (pos !== -1) {
      index = Math.max(0, pos - 120);
      break;
    }
  }
  return content.slice(index, index + limit).replace(/\s+/g, " ");
}

function shouldUseRag(question, queryTokens) {
  const lower = String(question || "").toLowerCase();

  if (
    /\b(weather|forecast|time|date|search\s+web|look\s+up|latest\s+news|google)\b/.test(lower)
  ) {
    return false;
  }

  return queryTokens.some((token) => RAG_HINTS.has(token));
}

function retrieveContext(rootDir, profile, question, limit = 3) {
  if (!profile) {
    return [];
  }
  const docsRoot = path.join(rootDir, "data", "docs", profile);
  const files = walkFiles(docsRoot);
  const queryTokens = tokenize(question);

  if (!shouldUseRag(question, queryTokens)) {
    return [];
  }

  const minScore = 2;
  const ranked = files
    .map((filePath) => {
      const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
      const score = scoreDocument(content, queryTokens);
      return {
        filePath,
        score,
        excerpt: snippet(content, queryTokens),
      };
    })
    .filter((row) => row.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return ranked.map((row) => ({
    file: path.relative(rootDir, row.filePath),
    excerpt: row.excerpt,
  }));
}

module.exports = {
  retrieveContext,
};
