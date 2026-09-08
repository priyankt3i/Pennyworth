// Synthetic data only; never opens the application's userData directory.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Worker } = require("worker_threads");
const { performance } = require("perf_hooks");
const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "pennyworth-history-bench-"));
const directory = path.join(root, "sessions");
fs.mkdirSync(directory);
const messages = count => Array.from({ length: count }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `Message ${i}: ${"Synthetic history text. ".repeat(20)}` }));
const normal = messages(100);
for (let i = 0; i < 1000; i++) {
  const id = `session-${String(i).padStart(4, "0")}`;
  fs.writeFileSync(path.join(directory, `${id}.json`), JSON.stringify({ id, title: `Conversation ${i}`, createdAt: "2026-01-01T00:00:00.000Z", messages: i === 0 ? messages(10000) : normal }));
}
const scanStart = performance.now();
for (const file of fs.readdirSync(directory)) JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
const scanMs = performance.now() - scanStart;
const worker = new Worker(path.resolve(__dirname, "../src/main/history-worker.js"), { workerData: { root } });
let id = 0;
const pending = new Map();
worker.on("message", response => {
  const { resolve, reject } = pending.get(response.id);
  pending.delete(response.id);
  response.error ? reject(new Error(response.error)) : resolve(response.result);
});
worker.on("error", error => { for (const { reject } of pending.values()) reject(error); pending.clear(); });
const request = (method, payload) => new Promise((resolve, reject) => {
  pending.set(++id, { resolve, reject }); worker.postMessage({ id, method, payload });
});
(async () => {
  try {
    const started = performance.now();
    const firstPage = await request("list", { limit: 50 });
    const migrationMs = performance.now() - started;
    if (firstPage.migrationWarnings.length) throw new Error("Fixture migration failed.");
    const measure = async (method, payload) => {
      const times = [];
      for (let i = 0; i < 25; i++) {
        const start = performance.now();
        await request(method, payload); times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      return { medianMs: +times[12].toFixed(2), p95Ms: +times[23].toFixed(2) };
    };
    console.log(JSON.stringify({
      conversations: 1000, totalMessages: 109900, longestConversation: 10000,
      legacyFullScanMs: +scanMs.toFixed(2), initialWorkerMigrationMs: +migrationMs.toFixed(2),
      sidebar50: await measure("list", { limit: 50 }),
      latest50: await measure("load", { sessionId: "session-0000", limit: 50 }),
      note: "Warm storage and worker round trips only; excludes renderer and provider latency.",
    }, null, 2));
  } finally { await worker.terminate(); fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
