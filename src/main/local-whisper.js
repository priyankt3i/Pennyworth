const path = require("path");
const { Worker } = require("worker_threads");

// Separate cold model loading (including first download) from CPU inference.
function createTranscriptionService({
  createWorker = () => new Worker(path.join(__dirname, "whisper-worker.js")),
  loadTimeoutMs = 300000,
  inferenceTimeoutMs = 120000,
} = {}) {
  let worker = null;
  let active = null;
  let requestId = 0;
  const queue = [];

  function status(request, stage) {
    try { request.onStatus?.(stage); } catch (_) { /* UI lifetime is independent. */ }
  }
  function finish(request, result) {
    clearTimeout(request.timer);
    status(request, result.ok ? "complete" : "error");
    request.resolve(result);
  }
  function terminateWorker(error = "Worker terminated") {
    const previous = worker;
    worker = null;
    const requests = [...(active ? [active] : []), ...queue.splice(0)];
    active = null;
    for (const request of requests) finish(request, { ok: false, error });
    if (previous) {
      try { Promise.resolve(previous.terminate()).catch(() => {}); } catch (_) {}
    }
  }
  function arm(request, timeout, error) {
    clearTimeout(request.timer);
    request.timer = setTimeout(() => {
      if (active === request) terminateWorker(error);
    }, timeout);
  }
  function pump() {
    if (active || !queue.length) return;
    active = queue.shift();
    try {
      if (!worker) {
        const current = createWorker();
        worker = current;
        current.on("message", message => {
          if (worker !== current || !active || message.id !== active.id) return;
          if (message.stage) {
            if (message.stage === "transcribing") {
              arm(active, inferenceTimeoutMs, "Local transcription timed out. Please retry with a shorter recording.");
            }
            status(active, message.stage);
            return;
          }
          const completed = active;
          active = null;
          finish(completed, { ok: Boolean(message.ok), text: message.text, error: message.error });
          pump();
        });
        current.on("error", error => {
          if (worker === current) terminateWorker(error.message);
        });
        current.on("exit", () => {
          if (worker === current) terminateWorker("Local speech worker exited. Please retry.");
        });
      }
      status(active, "loading");
      arm(active, loadTimeoutMs, "Local speech model loading timed out. Check your connection for the first download and retry.");
      worker.postMessage({ id: active.id, pcmBuffer: active.buffer });
    } catch (error) {
      terminateWorker(error.message);
    }
  }
  async function transcribeLocalPcm(samples, { onStatus } = {}) {
    let buffer;
    try {
      if (samples instanceof Float32Array) {
        buffer = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
      } else if (Array.isArray(samples)) {
        buffer = Buffer.from(new Float32Array(samples).buffer);
      } else {
        buffer = Buffer.from(samples);
      }
      if (!buffer.length || buffer.length % 4) throw new Error("Invalid PCM audio.");
      if (buffer.length > 16000 * 4 * 120) throw new Error("Local recordings must be at most two minutes.");
    } catch (error) { return { ok: false, error: error.message }; }
    // Keep memory bounded while allowing final audio to follow a live request.
    if (queue.length >= 2) return { ok: false, error: "Local speech queue is full. Please retry shortly." };
    return new Promise(resolve => {
      queue.push({ id: ++requestId, buffer: Buffer.from(buffer), resolve, onStatus });
      pump();
    });
  }
  return { transcribeLocalPcm, terminateWorker };
}

module.exports = { ...createTranscriptionService(), createTranscriptionService };
