const { parentPort } = require("worker_threads");
const os = require("os");

// Suppress C++ ONNX Runtime graph optimization warnings (log level 3 = ERROR / FATAL only)
process.env.ORT_LOGGING_LEVEL = "3";

let transcriberPipeline = null;
let isBusy = false;

async function getTranscriber() {
  if (transcriberPipeline) return transcriberPipeline;
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = true;
  env.allowRemoteModels = true;

  if (env.backends?.onnx) {
    env.backends.onnx.logLevel = "fatal";
    if (env.backends.onnx.wasm) {
      const numCpus = os.cpus()?.length || 4;
      env.backends.onnx.wasm.numThreads = Math.min(4, Math.max(2, numCpus - 1));
    }
  }

  // Use INT8 quantized model for 4x faster CPU inference speed
  transcriberPipeline = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", {
    dtype: "q8",
    device: "cpu",
  });
  return transcriberPipeline;
}

function cleanWhisperHallucinations(rawText) {
  if (!rawText) return "";
  let text = rawText.trim();
  text = text.replace(/[\*\(\[\{].*?[\*\)\]\}]/gi, "").trim();

  const lower = text.toLowerCase();
  if (
    !text ||
    lower === "whispering" ||
    lower === "unintelligible" ||
    lower === "thank you." ||
    lower === "thanks for watching!" ||
    lower === "you" ||
    lower === "subtitles by"
  ) {
    return "";
  }
  return text;
}

parentPort.on("message", async (msg) => {
  const { id, pcmBuffer } = msg || {};
  if (!id || !pcmBuffer) return;

  if (isBusy) {
    parentPort.postMessage({ id, ok: false, error: "Worker is busy processing previous chunk" });
    return;
  }

  isBusy = true;
  try {
    const transcriber = await getTranscriber();

    let floatArray;
    if (Buffer.isBuffer(pcmBuffer) || pcmBuffer instanceof Uint8Array) {
      const ab = pcmBuffer.buffer.slice(
        pcmBuffer.byteOffset,
        pcmBuffer.byteOffset + pcmBuffer.byteLength
      );
      floatArray = new Float32Array(ab);
    } else if (pcmBuffer instanceof Float32Array) {
      floatArray = pcmBuffer;
    } else if (Array.isArray(pcmBuffer)) {
      floatArray = Float32Array.from(pcmBuffer);
    } else if (pcmBuffer && typeof pcmBuffer === "object") {
      floatArray = Float32Array.from(Object.values(pcmBuffer));
    } else {
      floatArray = new Float32Array(pcmBuffer);
    }

    if (!floatArray || floatArray.length === 0) {
      parentPort.postMessage({ id, ok: true, text: "" });
      return;
    }

    // Check VAD audio signal level
    let maxAbs = 0;
    for (let i = 0; i < floatArray.length; i++) {
      const abs = Math.abs(floatArray[i]);
      if (abs > maxAbs) maxAbs = abs;
    }

    if (maxAbs < 0.008) {
      parentPort.postMessage({ id, ok: true, text: "" });
      return;
    }

    // Normalize peak volume
    if (maxAbs < 0.5) {
      const scale = 0.85 / maxAbs;
      for (let i = 0; i < floatArray.length; i++) {
        floatArray[i] *= scale;
      }
    }

    const output = await transcriber(floatArray, {
      return_timestamps: false,
    });

    const rawText = (output?.text || "").trim();
    const text = cleanWhisperHallucinations(rawText);

    parentPort.postMessage({ id, ok: true, text });
  } catch (error) {
    console.warn("Whisper worker transcription error:", error);
    parentPort.postMessage({ id, ok: false, error: error.message || "Transcription failed" });
  } finally {
    isBusy = false;
  }
});
