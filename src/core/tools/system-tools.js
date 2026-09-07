const fs = require("fs");
const { getExecutionContext } = require("../execution-context");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");
const crypto = require("crypto");
const { checkedPath, openRegularFile, openParent } = require("../safe-path");
const { executionPlan, runProcess, checkSignal } = require("../execution-runner");

let dialog, BrowserWindow, nativeImage;
try {
  const electron = require("electron");
  dialog = electron.dialog;
  nativeImage = electron.nativeImage;
  BrowserWindow = electron.BrowserWindow;
} catch (e) {
  // Silent fallback outside Electron
}

function riskIcon(title) {
  if (!nativeImage?.createFromBitmap) return undefined;
  const high = /HIGH|CRITICAL|Sensitive|WARNING/.test(title);
  const pixels = Buffer.alloc(32 * 32 * 4);
  const [r, g, b] = high ? [220, 38, 38] : /LOW/.test(title) ? [22, 163, 74] : [217, 119, 6];
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const offset = (y * 32 + x) * 4;
    if ((x - 15.5) ** 2 + (y - 15.5) ** 2 <= 225) {
      pixels.set([b, g, r, 255], offset);
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: 32, height: 32 });
}

async function requestUserApproval(title, message, detail) {
  if (!dialog || !BrowserWindow) {
    return false; // Missing approval UI always fails closed, including tests.
  }

  try {
    const focused = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const result = await dialog.showMessageBox(focused || undefined, {
      type: "warning",
      icon: riskIcon(title),
      buttons: ["Approve", "Deny"],
      defaultId: 1,
      cancelId: 1,
      title,
      message,
      detail,
    });

    return result.response === 0;
  } catch (error) {
    console.error("Failed to render approval dialog:", error);
    return false; // Default to deny on UI error
  }
}

function classifyCommandAccess(command) {
  // Conservative: shell composition, expansion and arbitrary scripts may write.
  if (/[;&|><`$\n\r]/.test(command)) return "MAY WRITE (shell logic or redirection)";
  const cmd = command.trim();
  if (/^(?:gsettings\s+(?:set|reset|reset-recursively)|dconf\s+(?:write|reset|load)|(?:touch|mkdir|rm|mv|cp|chmod|chown|tee)\b|(?:npm|pip|apt|dnf)\s+(?:install|remove|uninstall))\b/i.test(cmd)) return "WRITE";
  if (/^(?:pwd|whoami|hostname)$|^(?:uname|df|free)(?:\s+[-\w]+)*$/.test(cmd) ||
      /^(?:gsettings\s+(?:get|list-recursively|list-keys|list-schemas)|dconf\s+read)\s+[\w./:-]+(?:\s+[\w.-]+)?$/.test(cmd) ||
      /^(?:git status|git log|git diff|systemctl status|ps aux)(?:\s+[-\w./]+)*$/.test(cmd) && !/--(?:output|ext-diff|textconv|exec)/.test(cmd)) return "READ";
  return "MAY WRITE (effects not verified)";
}

function analyzeCommandConsequences(command, risk, execution = getExecutionContext().scope) {
  const cmd = command.trim();
  const consequences = [];

  if (/\bsudo\b/i.test(cmd) || /\bpkexec\b/i.test(cmd)) {
    consequences.push("• Requires elevated root privileges in the execution environment.");
  }
  if (/\b(pacman|apt|dnf|zypper|yay|paru|npm|pip|cargo)\s+(install|-s|add)\b/i.test(cmd)) {
    consequences.push("• Downloads and installs new software packages onto your machine.");
  }
  if (/\b(pacman|apt|dnf|zypper|yay|paru|npm|pip)\s+(remove|purge|uninstall|-r)\b/i.test(cmd)) {
    consequences.push("• Removes existing software packages and dependencies from your system.");
  }
  if (/\bsystemctl\s+(stop|disable|mask)\b/i.test(cmd)) {
    consequences.push("• Stops or disables a running system service, which may impact system functionality.");
  }
  if (/\bsystemctl\s+(start|enable|restart)\b/i.test(cmd)) {
    consequences.push("• Starts or restarts a system service on your machine.");
  }
  if (/\b(rm|del|unlink)\b/i.test(cmd)) {
    consequences.push("• Permanently deletes files or directories from your disk.");
  }
  if (/\b(iptables|ufw|netsh)\b/i.test(cmd)) {
    consequences.push("• Modifies network firewall rules and active ports.");
  }

  if (consequences.length === 0) {
    consequences.push("• Executes shell logic in the execution environment.");
  }

  return [
    `Command: ${cmd}`,
    `Access: ${classifyCommandAccess(command)}`,
    `Execution: ${execution}`,
    `Risk Assessment: ${risk.category} (Score: ${risk.score}/4)`,
    `Reason: ${risk.reason}`,
    "",
    "Expected Consequences:",
    ...consequences,
  ].join("\n");
}

function isSensitivePath(filepath) {
  const normalized = String(filepath || "").toLowerCase().replace(/\\/g, "/");
  const patterns = [
    /id_rsa/, /id_dsa/, /id_ecdsa/, /id_ed25519/,
    /authorized_keys/, /known_hosts/,
    /\.bashrc/, /\.zshrc/, /\.profile/, /\.bash_profile/, /\.bash_login/, /\.bash_logout/,
    /\.env/,
    /shadow/, /etc\/passwd/, /master\.passwd/, /etc\/group/, /etc\/gshadow/, /etc\/sudoers/, /etc\/hosts/,
    /sam\b/, /system32\/config/,
  ];
  return patterns.some((p) => p.test(normalized));
}

function tryRunCommand(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 5000 }).trim();
  } catch (error) {
    return `Failed to fetch info: ${error.message}`;
  }
}

function assessCommandRisk(command) {
  if (typeof command !== "string" || !command.trim() || command.length > 16000 || command.includes("\0")) throw new Error("Invalid command: expected 1–16000 characters without NUL.");
  const normalized = command.trim().toLowerCase();
  
  // Strip quotes to prevent quote-splitting evasion: id_r"s"a -> id_rsa
  const strippedQuotes = normalized.replace(/['"`]/g, "");
  
  // Normalize path slashes to simplify checking directory boundaries
  const unifiedPaths = strippedQuotes.replace(/\\/g, "/");
  
  // 1. Critical Blocklist (Risk 4 - Blocked)
  const blockedPatterns = [
    /\brm\s+(?:(?:--[\w-]+|-[a-z]+)\s+)+(?:\/|~)(?:\s|$|\*)/i,
    /rm\s+-rf\s+\//,
    /rm\s+-rf\s+\\\*/,
    /del\s+\/s\s+\/f\s+\/q\s+c:/,
    /format\s+[c-z]:/i,
    /mkfs/i,
    /dd\s+if=/i,
    /(curl|wget|fetch|powershell\s+-Command\s+.*?Invoke-WebRequest).*?\|\s*(bash|sh|cmd|pwsh)/i,
    /chmod\s+-r\s+777\s+\//,
    /chown\s+-r/i,
    /passwd\s+root/i,
    /net\s+user\s+.*?\s+\/add/i,
    /id_rsa/i,
    /id_dsa/i,
    /id_ecdsa/i,
    /id_ed25519/i,
    /\.env/i,
    /shadow/i,
    /etc\/passwd/i,
    /master\.passwd/i,
    /sam\b/i,
    /system32\/config/i,
    /authorized_keys/i,
    /known_hosts/i,
    
    // Obfuscated credential folder scanning
    /\.ssh\b/i,
    /\.aws\b/i,
    /\.kube\b/i,
    /\.git-credentials\b/i,
    
    // Windows/PowerShell Destructive equivalents
    /remove-item\s+.*?-recurse.*?-force/i,
    /remove-item\s+.*?-force.*?-recurse/i,
    /rmdir\s+\/s\s+\/q\s+c:/i,
    /rd\s+\/s\s+\/q\s+c:/i,
    /clear-disk/i,
    /initialize-disk/i,
    /format-volume/i,
    /format-disk/i,
    /(invoke-expression|iex)\s*\(.*?(downloadstring|downloadfile)/i,
    /(invoke-webrequest|iwr).*?\|\s*(iex|invoke-expression)/i,
    /new-localuser/i,
    /add-localgroupmember/i,
    /reg\s+save\s+(hklm\\sam|hklm\\system)/i,
    
    // Variable substitution indirection detection
    /=[a-z0-9_.\-\/]+;.*?(cat|type|get-content|gc)\s+\$/i,
  ];

  if (blockedPatterns.some(pattern => pattern.test(unifiedPaths))) {
    return { score: 4, category: "CRITICAL_BLOCKED", reason: "Destructive pattern, sensitive credential directory access, or download-and-execute shell pipe detected." };
  }

  // 2. High Risk (Risk 3 - Mandatory explicit approval)
  const highRiskPatterns = [
    /sudo\s+/i,
    /pkexec\s+/i,
    /runas/i,
    /systemctl\s+(enable|disable|stop|mask)/i,
    /registry\s+/i,
    /reg\s+(add|delete|copy|load|restore)/i,
    /\b(rm|unlink|rmdir|chmod|chown|pkill|kill|swapoff)\b/i,
    /[;&|><`$\n\r]/,
    /\b(python[0-9.]*|node|perl|ruby|bash|sh|powershell|pwsh)\s+(?:-[ce]|-command)\b/i,
    /del\s+/i,
    /netsh\s+/i,
    /iptables\s+/i,
    /ufw\s+/i,
    
    // Windows/PowerShell High Risk equivalents
    /stop-service/i,
    /disable-service/i,
    /set-service/i,
    /set-itemproperty/i,
    /remove-itemproperty/i,
    /new-itemproperty/i,
    /set-netfirewallrule/i,
    /disable-netfirewallrule/i,
    /restart-computer/i,
    /stop-computer/i,
  ];

  if (highRiskPatterns.some(pattern => pattern.test(unifiedPaths))) {
    return { score: 3, category: "HIGH_RISK", reason: "Modifies system services, registry settings, networking, or deletes files." };
  }

  // 3. Low Risk Allowlist (Risk 1 - Auto-allow)
  const lowRiskPrefixes = [
    "git status",
    "git diff",
    "git log",
    "npm test",
    "node -v",
    "npm -v",
    "python --version",
    "python3 --version",
    "pip --version",
    "pip3 --version",
    "ollama list",
    "ollama --version",
    "df -h",
    "free -h",
    "uname -a",
    "hostname",
    "whoami",
    "pwd",
    "ls -l",
    "dir",
    "systemctl status",
    "ps aux",
  ];

  const matchesLowRisk = lowRiskPrefixes.some(prefix => {
    return normalized === prefix || normalized.startsWith(prefix + " ");
  });

  if (matchesLowRisk && ["git status", "git diff", "git log", "df -h", "free -h", "uname -a", "hostname", "whoami", "pwd", "ps aux"].includes(normalized)) {
    return { score: 1, category: "LOW_RISK_ALLOWLIST", reason: "Read-only query of git status, system versions, disk space, or process lists." };
  }

  // 4. Default: Medium Risk (Risk 2 - standard approval)
  return { score: 2, category: "MEDIUM_RISK", reason: "General execution query (e.g. package installers or directory scans)." };
}

async function executeSystemCommand(command, { target = "sandbox", signal, diagnostic = false } = {}) {
  checkSignal(signal);
  const risk = diagnostic ? { score: 2, category: "MEDIUM_RISK", reason: "Fixed read-only diagnostic probes; host output shared with selected provider." } : assessCommandRisk(command);
  const access = diagnostic ? "READ (fixed diagnostic probes)" : classifyCommandAccess(command);
  if (risk.score === 4) return "SECURITY_BLOCKED: " + risk.reason;
  const plan = executionPlan(target);
  // Even known reads require consent on the host: reading may disclose private
  // data to the selected provider. Approval is for this exact target and command.
  const needsApproval = target === "host" || risk.score !== 1;
  if (needsApproval) {
    const high = risk.score >= 3;
    const label = high ? "HIGH" : risk.score === 1 ? "LOW" : "MEDIUM";
    const approved = await requestUserApproval(
      high ? "🔴 HIGH RISK — Command Approval" : risk.score === 1 ? "🟢 LOW RISK — Command Approval" : "🟠 MEDIUM RISK — Command Approval",
      `${label} RISK · ${access} · ${target.toUpperCase()}`,
      analyzeCommandConsequences(command, risk, plan.description).replace(`Access: ${classifyCommandAccess(command)}`, `Access: ${access}`) + "\n\nOutput will be sent to your selected AI provider. Approval does not grant future commands permission."
    );
    checkSignal(signal);
    if (!approved) return "COMMAND_EXECUTION_DENIED: Command was not approved.";
  }
  checkSignal(signal);
  return JSON.stringify(await runProcess(plan, command, { signal }), null, 2);
}

async function readSystemFile(filepath, { signal } = {}) {
  checkSignal(signal);
  let opened;
  try {
    filepath = checkedPath(filepath);
    const approved = await requestUserApproval(
      isSensitivePath(filepath) ? "🔴 Read Sensitive File" : "🟠 Read File",
      "Pennyworth requests READ access in its local process environment.",
      `File: ${filepath}\nExecution: ${getExecutionContext().scope}\nContent will be sent to your selected AI provider. This is not a host bridge.`
    );
    checkSignal(signal);
    if (!approved) return "FILE_READ_DENIED: File read was not approved.";
    opened = openRegularFile(filepath);
    if (opened.stat.size > 5 * 1024 * 1024) throw new Error("File exceeds the 5 MB limit.");
    const content = fs.readFileSync(opened.fd, "utf8");
    return JSON.stringify({ execution: getExecutionContext(), filepath, readAt: new Date().toISOString(), content });
  } catch (error) {
    if (error.code === "AGENT_STOPPED") throw error;
    return `FILE_READ_ERROR: ${error.message}`;
  } finally { if (opened) fs.closeSync(opened.fd); }
}

async function writeSystemFile(filepath, content, { signal } = {}) {
  checkSignal(signal);
  let temporary, parent;
  try {
    filepath = checkedPath(filepath);
    parent = openParent(filepath);
    const anchored = parent.anchored;
    if (typeof content !== "string" || Buffer.byteLength(content) > 100000) throw new Error("File writes require text of at most 100 KB for review.");
    const dir = path.dirname(filepath);
    if (!fs.statSync(checkedPath(dir)).isDirectory()) throw new Error("Parent directory must already exist.");
    const before = fs.existsSync(anchored) ? fs.lstatSync(anchored) : null;
    if (before && (!before.isFile() || before.nlink !== 1)) throw new Error("Only regular files with a single link may be replaced.");
    if (before && (before.size > 5 * 1024 * 1024 || (before.mode & 0o7000))) throw new Error("Existing file is too large or has privileged permission bits.");
    const digest = crypto.createHash("sha256").update(content).digest("hex");
    const approved = await requestUserApproval(
      isSensitivePath(filepath) ? "🔴 HIGH RISK — Write Sensitive File" : "🟠 Write File",
      "Pennyworth requests WRITE access in its local process environment.",
      `File: ${filepath}\nExecution: ${getExecutionContext().scope}\nAction: ${before ? "Replace (original backup retained)" : "Create"}\nSHA-256: ${digest}\n\nComplete proposed content:\n${content}`
    );
    checkSignal(signal);
    if (!approved) return "FILE_WRITE_DENIED: File write was not approved.";
    checkedPath(filepath);
    const after = fs.existsSync(anchored) ? fs.lstatSync(anchored) : null;
    if (Boolean(before) !== Boolean(after) || (before && (before.ino !== after.ino || before.dev !== after.dev || before.mtimeMs !== after.mtimeMs || before.size !== after.size))) throw new Error("File changed during approval; request a fresh approval.");
    let backup = null;
    if (before) {
      backup = filepath + `.pennyworth-backup-${crypto.randomUUID()}`;
      const source = fs.openSync(anchored, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      let backupFd;
      try {
        backupFd = fs.openSync(`/proc/self/fd/${parent.fd}/${path.basename(backup)}`, "wx", 0o600);
        const original = fs.readFileSync(source);
        fs.writeFileSync(backupFd, original);
        fs.fsyncSync(backupFd);
      } finally { fs.closeSync(source); if (backupFd !== undefined) fs.closeSync(backupFd); }
    }
    temporary = `/proc/self/fd/${parent.fd}/.pennyworth-${crypto.randomUUID()}.tmp`;
    const fd = fs.openSync(temporary, "wx", before ? before.mode & 0o777 : 0o600);
    try {
      fs.writeFileSync(fd, content);
      if (before) { fs.fchownSync(fd, before.uid, before.gid); fs.fchmodSync(fd, before.mode & 0o777); }
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    checkSignal(signal);
    checkedPath(filepath);
    const currentParent = fs.statSync(dir);
    const heldParent = fs.fstatSync(parent.fd);
    if (currentParent.ino !== heldParent.ino || currentParent.dev !== heldParent.dev) throw new Error("Parent directory changed during approval.");
    if (before) {
      const latest = fs.lstatSync(anchored);
      if (latest.ino !== before.ino || latest.mtimeMs !== before.mtimeMs || latest.size !== before.size) throw new Error("File changed before replacement.");
      fs.renameSync(temporary, anchored);
    } else {
      fs.linkSync(temporary, anchored); // Atomic create; never overwrite a raced-in file.
      fs.unlinkSync(temporary);
    }
    temporary = null;
    return JSON.stringify({ success: true, filepath, backup, sha256: digest, execution: getExecutionContext(), writtenAt: new Date().toISOString() });
  } catch (error) {
    if (error.code === "AGENT_STOPPED") throw error;
    return `FILE_WRITE_ERROR: ${error.message}`;
  } finally {
    if (temporary) { try { fs.unlinkSync(temporary); } catch (_) {} }
    if (parent) fs.closeSync(parent.fd);
  }
}

function getSystemStatus(aspect = "all") {
  const isWin = os.platform() === "win32";
  const status = { execution: getExecutionContext() };

  if (aspect === "cpu" || aspect === "memory" || aspect === "all") {
    status.resources = {
      cpuCores: os.cpus().length,
      cpuModel: os.cpus()[0]?.model || "unknown",
      totalMemoryGb: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2),
      freeMemoryGb: (os.freemem() / 1024 / 1024 / 1024).toFixed(2),
      loadAverage: os.platform() !== "win32" ? os.loadavg() : "N/A",
    };
  }

  if (aspect === "disk" || aspect === "all") {
    if (isWin) {
      status.disk = tryRunCommand("powershell -NoProfile -Command \"Get-Volume | Select-Object DriveLetter, FileSystemLabel, SizeRemaining, Size | Format-Table\"");
    } else {
      status.disk = tryRunCommand("df -h /");
    }
  }

  if (aspect === "processes" || aspect === "all") {
    if (isWin) {
      status.processes = tryRunCommand("powershell -NoProfile -Command \"Get-Process | Sort-Object CPU -Descending | Select-Object -First 20 -Property Name, Id, CPU, WorkingSet | Format-Table\"");
    } else {
      status.processes = tryRunCommand("ps aux --sort=-%cpu | head -n 25");
    }
  }

  if (aspect === "services" || aspect === "all") {
    if (os.platform() === "linux") {
      status.services = tryRunCommand("systemctl list-units --type=service --state=active --no-legend | head -n 30");
    } else if (isWin) {
      status.services = tryRunCommand("powershell -NoProfile -Command \"Get-Service | Where-Object {$_.Status -eq 'Running'} | Select-Object -First 20 -Property Name, DisplayName, Status | Format-Table\"");
    } else {
      status.services = "Not supported on this platform";
    }
  }

  if (aspect === "network" || aspect === "all") {
    status.network = {
      interfaces: os.networkInterfaces(),
    };
  }

  return JSON.stringify(status, null, 2);
}

module.exports = {
  classifyCommandAccess,
  analyzeCommandConsequences,
  requestUserApproval,
  assessCommandRisk,
  executeSystemCommand,
  readSystemFile,
  writeSystemFile,
  getSystemStatus,
};
