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

function requestUserApproval(title, message, detail) {
  if (!dialog || !BrowserWindow) {
    return true; // Auto-approve in test/headless environments
  }

  const focused = BrowserWindow.getFocusedWindow();
  const choice = dialog.showMessageBoxSync(focused || undefined, {
    type: "warning",
    buttons: ["Approve", "Deny"],
    defaultId: 1,
    cancelId: 1,
    title,
    message,
    detail,
  });

  return choice === 0;
}

function isSensitivePath(filepath) {
  const normalized = String(filepath || "").toLowerCase().replace(/\\/g, "/");
  const patterns = [
    /id_rsa/,
    /\.env/,
    /shadow/,
    /etc\/passwd/,
    /master\.passwd/,
    /sam\b/,
    /system32\/config/,
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
    /\.env/i,
    /shadow/i,
    /etc\/passwd/i,
    /master\.passwd/i,
    /sam\b/i,
    /system32\/config/i,
  ];

  if (blockedPatterns.some(pattern => pattern.test(normalized))) {
    return { score: 4, category: "CRITICAL_BLOCKED", reason: "Destructive pattern or download-and-execute shell pipe detected." };
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
  ];

  if (highRiskPatterns.some(pattern => pattern.test(normalized))) {
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
  if (risk.score === 1) {
    approved = true;
    console.log(`Auto-approved low-risk command: ${command}`);
  } else if (risk.score === 3) {
    approved = requestUserApproval(
      "SECURITY ALERT: High-Risk Command Request",
      `Hermes Agent is requesting to execute a HIGH-RISK command on your system.`,
      `Command:\n${command}\n\nReason: ${risk.reason}\n\nWARNING: Modifying system files, registry edits, or networking configurations can damage your operating system.`
    );
  } else {
    approved = requestUserApproval(
      "Execute System Command",
      "Hermes Agent is requesting to execute a command on your computer.",
      `Command:\n${command}\n\nReason: ${risk.reason}`
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
    const approved = requestUserApproval(
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
  const approved = requestUserApproval(
    "Write System File",
    "Hermes Agent is requesting to write or overwrite a file on your computer.",
    `File path: ${filepath}\n\nWARNING: Modifying system files can break applications or alter OS configurations.`
  );

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
