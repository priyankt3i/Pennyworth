const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec, execSync } = require("child_process");

let dialog, BrowserWindow;
try {
  const electron = require("electron");
  dialog = electron.dialog;
  BrowserWindow = electron.BrowserWindow;
} catch (e) {
  // Silent fallback outside Electron
}

async function requestUserApproval(title, message, detail) {
  if (!dialog || !BrowserWindow) {
    // In headless or test environments without UI, default to DENY for security (except when explicitly allowed in tests)
    return process.env.NODE_ENV === "test";
  }

  try {
    const focused = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const result = await dialog.showMessageBox(focused || undefined, {
      type: "warning",
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

function analyzeCommandConsequences(command, risk) {
  const cmd = command.trim();
  const lower = cmd.toLowerCase();
  const consequences = [];

  if (/\bsudo\b/i.test(cmd) || /\bpkexec\b/i.test(cmd)) {
    consequences.push("• Requires elevated root privileges on your host system.");
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
    consequences.push("• Executes shell logic on your host environment.");
  }

  return [
    `Command: ${cmd}`,
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
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true }).trim();
  } catch (error) {
    return `Failed to fetch info: ${error.message}`;
  }
}

function assessCommandRisk(command) {
  const normalized = command.trim().toLowerCase();
  
  // Strip quotes to prevent quote-splitting evasion: id_r"s"a -> id_rsa
  const strippedQuotes = normalized.replace(/['"`]/g, "");
  
  // Normalize path slashes to simplify checking directory boundaries
  const unifiedPaths = strippedQuotes.replace(/\\/g, "/");
  
  // 1. Critical Blocklist (Risk 4 - Blocked)
  const blockedPatterns = [
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
    /runas/i,
    /systemctl\s+(enable|disable|stop|mask)/i,
    /registry\s+/i,
    /reg\s+(add|delete|copy|load|restore)/i,
    /rm\s+-rf/i,
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

  if (matchesLowRisk) {
    return { score: 1, category: "LOW_RISK_ALLOWLIST", reason: "Read-only query of git status, system versions, disk space, or process lists." };
  }

  // 4. Default: Medium Risk (Risk 2 - standard approval)
  return { score: 2, category: "MEDIUM_RISK", reason: "General execution query (e.g. package installers or directory scans)." };
}

async function executeSystemCommand(command) {
  const risk = assessCommandRisk(command);
  
  if (risk.score === 4) {
    return `SECURITY_BLOCKED: Command was blocked by Pennyworth's Security Guard.\nReason: ${risk.reason}\nAction: Please execute this command manually in your own terminal if it is safe.`;
  }

  let approved = false;
  const consequenceDetail = analyzeCommandConsequences(command, risk);

  if (risk.score === 1) {
    approved = true;
    console.log(`Auto-approved low-risk command: ${command}`);
  } else if (risk.score === 3) {
    approved = await requestUserApproval(
      "SECURITY ALERT: High-Risk Command Request",
      "Hermes Agent is requesting to execute a HIGH-RISK command on your host system.",
      consequenceDetail
    );
  } else {
    approved = await requestUserApproval(
      "Execute System Command",
      "Hermes Agent is requesting to execute a command on your computer.",
      consequenceDetail
    );
  }

  if (!approved) {
    return "COMMAND_EXECUTION_DENIED: The user denied permission to run this command.";
  }

  return new Promise((resolve) => {
    exec(command, { timeout: 45000, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      let output = "";
      if (stdout) {
        output += stdout;
      }
      if (stderr) {
        output += `\n--- STDERR ---\n${stderr}\n`;
      }
      if (error) {
        output += `--- ERROR ---\nExit Code: ${error.code}\n${error.message}\n`;
      }
      resolve(output || "Command executed successfully but returned no output.");
    });
  });
}

async function readSystemFile(filepath) {
  if (isSensitivePath(filepath)) {
    const approved = await requestUserApproval(
      "Read Sensitive File",
      "Hermes Agent is requesting to read a sensitive system file.",
      `File path: ${filepath}\n\nWARNING: This file may contain user credentials, keys, or API tokens.`
    );
    if (!approved) {
      return "FILE_READ_DENIED: The user denied permission to read this sensitive file.";
    }
  }

  try {
    const stats = fs.statSync(filepath);
    if (stats.isDirectory()) {
      return `Error: '${filepath}' is a directory, not a file.`;
    }
    if (stats.size > 1024 * 1024 * 5) {
      return `Error: File is too large to read directly (${(stats.size / 1024 / 1024).toFixed(2)} MB).`;
    }
    const content = fs.readFileSync(filepath, "utf8");
    return content || "(Empty file)";
  } catch (error) {
    return `Error reading file '${filepath}': ${error.message}`;
  }
}

async function writeSystemFile(filepath, content) {
  const isSensitive = isSensitivePath(filepath);
  let approved = false;

  if (isSensitive) {
    approved = await requestUserApproval(
      "SECURITY WARNING: Write Sensitive System File",
      "Hermes Agent is requesting to modify a highly sensitive system file or user credentials file.",
      `File path: ${filepath}\n\nWARNING: Modifying shell profiles, SSH key rings, system hosts, or credentials files can compromise system security or lock you out of your machine.`
    );
  } else {
    approved = await requestUserApproval(
      "Write System File",
      "Hermes Agent is requesting to write or overwrite a file on your computer.",
      `File path: ${filepath}\n\nWARNING: Modifying system files can break applications or alter OS configurations.`
    );
  }

  if (!approved) {
    return "FILE_WRITE_DENIED: The user denied permission to write this file.";
  }

  try {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filepath, content, "utf8");
    return `Successfully wrote ${content.length} characters to '${filepath}'.`;
  } catch (error) {
    return `Error writing file '${filepath}': ${error.message}`;
  }
}

function getSystemStatus(aspect = "all") {
  const isWin = os.platform() === "win32";
  const status = {};

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
  assessCommandRisk,
  executeSystemCommand,
  readSystemFile,
  writeSystemFile,
  getSystemStatus,
};
