const path = require("path");
const { Worker } = require("worker_threads");
let worker;
let nextId = 0;
const pending = new Map();
function request(method, payload) {
  if (!worker) {
    const current = new Worker(path.join(__dirname, "history-worker.js"), {
      workerData: { root: require("electron").app.getPath("userData") },
    });
    worker = current;
    const fail = error => {
      if (worker !== current) return;
      worker = null;
      for (const { reject } of pending.values()) reject(error);
      pending.clear();
    };
    current.on("message", ({ id, result, error }) => {
      const resolver = pending.get(id);
      if (!resolver || current !== worker) return;
      pending.delete(id);
      if (error) resolver.reject(new Error(error)); else resolver.resolve(result);
      if (!pending.size) current.unref();
    });
    current.on("error", fail);
    current.on("exit", () => fail(new Error("History worker stopped. Please retry.")));
  }
  worker.ref();
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    try { worker.postMessage({ id, method, payload }); }
    catch (error) { pending.delete(id); reject(error); if (!pending.size) worker.unref(); }
  });
}
module.exports = Object.fromEntries(["list", "load", "create", "rename", "delete", "begin", "finish", "titleContext"].map(method => [method, payload => request(method, payload)]));
