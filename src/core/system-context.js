const fs = require("fs");
const os = require("os");
const { execSync } = require("child_process");

const SYSTEM_CONTEXT_TTL_MS = 60_000;
let systemContextCache = null;
let systemContextCacheAt = 0;

function tryExec(command) {
  try {
    const output = execSync(command, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
    return output || "unknown";
  } catch (error) {
    return "unknown";
  }
}

function commandExists(binary) {
  const lookup = process.platform === "win32" ? `where ${binary}` : `command -v ${binary}`;
  return tryExec(lookup) !== "unknown";
}

function readOsRelease() {
  try {
    const raw = fs.readFileSync("/etc/os-release", "utf8");
    const map = {};
    raw.split("\n").forEach((line) => {
      const [key, ...rest] = line.split("=");
      if (!key || rest.length === 0) {
        return;
      }
      map[key] = rest.join("=").replace(/^"|"$/g, "");
    });
    return map;
  } catch (error) {
    return {};
  }
}

function inferWindowsFamilyFromRelease(release) {
  const value = String(release || "");
  const parts = value.split(".");
  const build = Number(parts[2] || parts[parts.length - 1]);

  if (Number.isFinite(build) && build >= 22000) {
    return "Windows 11";
  }
  return "Windows 10";
}

function resolveWindowsInfo() {
  const release = os.release();
  const captionRaw = tryExec("powershell -NoProfile -Command \"(Get-CimInstance Win32_OperatingSystem).Caption\"");
  const versionRaw = tryExec("powershell -NoProfile -Command \"(Get-CimInstance Win32_OperatingSystem).Version\"");

  const caption =
    captionRaw !== "unknown"
      ? captionRaw.replace(/^Microsoft\s+/i, "").trim()
      : inferWindowsFamilyFromRelease(release);

  const version = versionRaw !== "unknown" ? versionRaw : release;
  const prettyName = caption.includes(version) ? caption : `${caption} ${version}`;

  return {
    name: caption,
    prettyName,
    versionId: version,
  };
}

function resolveDistro(osRelease, platform) {
  if (platform === "linux") {
    const idLike = String(osRelease.ID_LIKE || "")
      .split(/\s+/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    return {
      id: osRelease.ID || "unknown",
      name: osRelease.NAME || "unknown",
      prettyName: osRelease.PRETTY_NAME || "unknown",
      versionId: osRelease.VERSION_ID || "unknown",
      idLike,
    };
  }

  if (platform === "win32") {
    const windowsInfo = resolveWindowsInfo();
    return {
      id: "windows",
      name: windowsInfo.name,
      prettyName: windowsInfo.prettyName,
      versionId: windowsInfo.versionId,
      idLike: [],
    };
  }

  return {
    id: platform,
    name: platform,
    prettyName: `${platform} ${os.release()}`,
    versionId: os.release(),
    idLike: [],
  };
}

function resolveKernel(platform) {
  if (platform === "linux" || platform === "darwin") {
    return tryExec("uname -r");
  }
  return os.release();
}

function resolveGpu(platform) {
  if (platform !== "linux" || !commandExists("lspci")) {
    return "unknown";
  }

  const lspciOutput = tryExec("lspci");
  if (lspciOutput === "unknown") {
    return "unknown";
  }

  const gpuLine = lspciOutput
    .split("\n")
    .find((line) => /(vga|3d|display)/i.test(line));

  return gpuLine || "unknown";
}

function resolvePackageManagers(platform) {
  if (platform !== "linux") {
    return {
      pacman: false,
      apt: false,
      dnf: false,
      zypper: false,
      paru: false,
      yay: false,
    };
  }

  return {
    pacman: commandExists("pacman"),
    apt: commandExists("apt"),
    dnf: commandExists("dnf"),
    zypper: commandExists("zypper"),
    paru: commandExists("paru"),
    yay: commandExists("yay"),
  };
}

function buildSystemContext() {
  const platform = os.platform();
  const osRelease = readOsRelease();

  return {
    hostname: os.hostname(),
    platform,
    arch: os.arch(),
    kernel: resolveKernel(platform),
    desktop:
      platform === "linux"
        ? process.env.XDG_CURRENT_DESKTOP || "unknown"
        : platform === "win32"
          ? "windows-shell"
          : "unknown",
    sessionType: platform === "linux" ? process.env.XDG_SESSION_TYPE || "unknown" : "native",
    distro: resolveDistro(osRelease, platform),
    hardware: {
      cpuModel: os.cpus()?.[0]?.model || "unknown",
      cpuCount: os.cpus()?.length || 0,
      memoryGb: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(2)),
      gpu: resolveGpu(platform),
    },
    packageManagersPresent: resolvePackageManagers(platform),
  };
}

function getSystemContext(options = {}) {
  const force = Boolean(options?.force);
  const ttlMs = Number(options?.ttlMs) > 0 ? Number(options.ttlMs) : SYSTEM_CONTEXT_TTL_MS;

  if (!force && systemContextCache && Date.now() - systemContextCacheAt < ttlMs) {
    return systemContextCache;
  }

  const context = buildSystemContext();
  systemContextCache = context;
  systemContextCacheAt = Date.now();
  return context;
}

module.exports = {
  getSystemContext,
};
