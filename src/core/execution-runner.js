const fs = require("fs");
const { spawn, spawnSync } = require("child_process");
const { getExecutionContext } = require("./execution-context");

function stopped() {
  return Object.assign(new Error("AGENT_STOPPED: Execution terminated by user."), { code: "AGENT_STOPPED" });
}
function checkSignal(signal) { if (signal?.aborted) throw stopped(); }

function sandboxArgs() {
  const args = ["--die-with-parent", "--new-session", "--unshare-all", "--cap-drop", "ALL", "--clearenv",
    "--setenv", "PATH", "/usr/bin:/bin", "--setenv", "HOME", "/tmp", "--setenv", "LANG", "C.UTF-8"];
  // No home directory, host /tmp, D-Bus, devices or network are exposed.
  for (const dir of ["/usr", "/bin", "/sbin", "/lib", "/lib64"]) {
    if (fs.existsSync(dir)) args.push("--ro-bind", dir, dir);
  }
  args.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--chdir", "/tmp");
  return args;
}

function executionPlan(target = "sandbox", { context = getExecutionContext(), probe = spawnSync, platform = process.platform } = {}) {
  if (!["sandbox", "host"].includes(target)) throw new Error("Unknown execution target; choose sandbox or host.");
  if (target === "sandbox") {
    if (platform !== "linux") throw new Error("SANDBOX_UNAVAILABLE: Isolated command execution is currently supported on Linux only. No host fallback was attempted.");
    const args = sandboxArgs();
    const result = probe("/usr/bin/bwrap", [...args, "--", "/bin/true"], { timeout: 5000, encoding: "utf8", maxBuffer: 65536 });
    if (result.error || result.status !== 0) throw new Error("SANDBOX_UNAVAILABLE: Bubblewrap is missing or namespaces are disabled. No host fallback was attempted.");
    return { target, verified: true, description: "Isolated Linux sandbox: no host home, session bus or network; temporary writes only", executable: "/usr/bin/bwrap", prefix: [...args, "--", "/bin/sh", "-c"] };
  }
  if (platform === "linux") {
    if (context.evidence.includes("Flatpak")) {
      // Verify the bridge reaches a non-container execution environment. A
      // missing helper, denied bridge, or nested container fails closed.
      const result = probe("/usr/bin/flatpak-spawn", ["--host", "--watch-bus", "/usr/bin/systemd-detect-virt", "--container"], { timeout: 5000, encoding: "utf8", maxBuffer: 65536 });
      if (result.error || result.status !== 1 || String(result.stdout).trim() !== "none") throw new Error("HOST_UNAVAILABLE: Flatpak host bridge could not be verified.");
      return { target, verified: true, description: "Host via verified Flatpak bridge (desktop session still requires verification)", executable: "/usr/bin/flatpak-spawn", prefix: ["--host", "--watch-bus", "/bin/sh", "-c"] };
    }
    if (context.evidence.length) throw new Error("HOST_UNAVAILABLE: No supported host bridge for this container.");
    const result = probe("/usr/bin/systemd-detect-virt", ["--container"], { timeout: 5000, encoding: "utf8", maxBuffer: 65536 });
    if (result.error || result.status !== 1 || String(result.stdout).trim() !== "none") throw new Error("HOST_UNAVAILABLE: Native host execution could not be verified.");
    return { target, verified: true, description: "Native Linux host process (desktop session still requires verification)", executable: "/bin/sh", prefix: ["-c"] };
  }
  // No unsupported platform is silently treated as a verified host.
  throw new Error("HOST_UNAVAILABLE: Verified host execution is currently supported on Linux only.");
}

function runProcess(plan, command, { signal, timeoutMs = 45000, maxBytes = 10 * 1024 * 1024 } = {}) {
  checkSignal(signal);
  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString();
    const child = spawn(plan.executable, [...plan.prefix, command], {
      detached: process.platform !== "win32", windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      // Drop inherited API keys and shell startup hooks from command processes.
      env: Object.fromEntries(["PATH", "HOME", "USER", "LOGNAME", "LANG", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XDG_SESSION_ID", "DBUS_SESSION_BUS_ADDRESS", "SystemRoot"].filter(k => process.env[k]).map(k => [k, process.env[k]])),
    });
    let stdout = "", stderr = "", bytes = 0, failure = null;
    const kill = () => {
      if (!child.pid) return;
      try {
        if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch (_) { /* Already exited. */ }
    };
    const abort = () => { failure = stopped(); kill(); };
    const timer = setTimeout(() => { failure = new Error("COMMAND_TIMEOUT: Process group terminated."); kill(); }, timeoutMs);
    const collect = key => chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) { failure = new Error("COMMAND_OUTPUT_LIMIT: Process group terminated."); kill(); return; }
      if (key === "stdout") stdout += chunk.toString(); else stderr += chunk.toString();
    };
    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    child.once("error", error => { cleanup(); reject(error); });
    child.once("close", (exitCode, terminationSignal) => {
      cleanup();
      // Reap ordinary background descendants as well; no persistent services
      // should be launched through this short-lived shell tool.
      kill();
      if (failure) return reject(failure);
      resolve({ target: plan.target, verified: plan.verified, execution: plan.description, startedAt, finishedAt: new Date().toISOString(), exitCode, terminationSignal, success: exitCode === 0, stdout, stderr });
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
module.exports = { executionPlan, sandboxArgs, runProcess, checkSignal };
