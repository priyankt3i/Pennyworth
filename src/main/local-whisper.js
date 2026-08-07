const path = require("path");
const { Worker } = require("worker_threads");

let worker = null;
const pendingRequests = new Map();
let requestId = 0;

function getWorker() {
  if (!worker) {
    const workerPath = path.join(__dirname, "whisper-worker.js");
    worker = new Worker(workerPath);

    worker.on("message", (msg) => {
      const { id, ok, text, error } = msg;
      const resolver = pendingRequests.get(id);
      if (resolver) {
        clearTimeout(resolver.timeout);
        pendingRequests.delete(id);
        if (ok) {
          resolver.resolve({ ok: true, text });
        } else {
          resolver.resolve({ ok: false, error });
        }
      }
    });

    worker.on("error", (err) => {
      console.warn("Whisper worker error:", err);
      for (const resolver of pendingRequests.values()) {
        clearTimeout(resolver.timeout);
        resolver.resolve({ ok: false, error: err.message });
      }
      pendingRequests.clear();
      terminateWorker();
    });

    worker.on("exit", (code) => {
      if (code !== 0) {
        console.warn(`Whisper worker stopped with exit code ${code}`);
      }
      for (const resolver of pendingRequests.values()) {
        clearTimeout(resolver.timeout);
        resolver.resolve({ ok: false, error: "Worker exited" });
      }
      pendingRequests.clear();
      worker = null;
    });
  }
  return worker;
}

function terminateWorker() {
  if (worker) {
    try {
      worker.terminate();
    } catch (e) {}
    worker = null;
  }
  for (const resolver of pendingRequests.values()) {
    clearTimeout(resolver.timeout);
    resolver.resolve({ ok: false, error: "Worker terminated" });
  }
  pendingRequests.clear();
}

async function transcribeLocalPcm(pcmFloat32Data) {
  return new Promise((resolve) => {
    const currentWorker = getWorker();
    const id = ++requestId;

    const timeout = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        resolve({ ok: false, error: "Transcription timeout" });
      }
    }, 10000);

    pendingRequests.set(id, { resolve, timeout });

    let buffer;
    if (pcmFloat32Data instanceof Float32Array) {
      buffer = Buffer.from(pcmFloat32Data.buffer, pcmFloat32Data.byteOffset, pcmFloat32Data.byteLength);
    } else if (Buffer.isBuffer(pcmFloat32Data)) {
      buffer = pcmFloat32Data;
    } else if (Array.isArray(pcmFloat32Data)) {
      buffer = Buffer.from(new Float32Array(pcmFloat32Data).buffer);
    } else {
      buffer = Buffer.from(pcmFloat32Data);
    }

    currentWorker.postMessage({ id, pcmBuffer: buffer });
  });
}

module.exports = {
  transcribeLocalPcm,
  terminateWorker,
};
