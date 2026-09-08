const { parentPort, workerData } = require("worker_threads");
const { openHistory } = require("./history-database");
const history = openHistory(workerData.root);
const methods = new Set(["list", "load", "create", "rename", "delete", "begin", "finish", "titleContext"]);
parentPort.on("message", ({ id, method, payload }) => {
  try {
    if (!methods.has(method)) throw new Error("Unknown history operation.");
    parentPort.postMessage({ id, result: history[method](payload) });
  } catch (error) { parentPort.postMessage({ id, error: error.message }); }
});
