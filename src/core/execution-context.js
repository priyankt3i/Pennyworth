const fs = require("fs");

function getExecutionContext({ env = process.env, exists = fs.existsSync, read = fs.readFileSync } = {}) {
  const evidence = [];
  if (env.FLATPAK_ID || exists("/.flatpak-info")) evidence.push("Flatpak");
  if (env.SNAP || env.SNAP_NAME) evidence.push("Snap");
  if (exists("/.dockerenv")) evidence.push("Docker");
  if (env.container || exists("/run/.containerenv")) evidence.push("container");
  try {
    if (/docker|kubepods|lxc|libpod/i.test(read("/proc/1/cgroup", "utf8"))) evidence.push("container cgroup");
  } catch (_) { /* Detection is best effort. */ }
  return {
    scope: evidence.length ? "sandbox/container" : "local process (host access unverified)",
    evidence,
    desktopSessionBus: Boolean(env.DBUS_SESSION_BUS_ADDRESS),
    guidance: "Commands inherit Pennyworth's process environment. Approval and sudo do not escape a sandbox. Host OS metadata does not prove host execution. Do not report sandbox gsettings/dconf values as host desktop settings. Verify the target and desktop session before claiming a host result; never silently retry outside the sandbox.",
  };
}
module.exports = { getExecutionContext };
