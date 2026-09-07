const fs = require("fs");
const { getExecutionContext } = require("./execution-context");
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

/**
 * Check if a command/binary is executable on the host system.
 * If running inside a containerized sandbox (e.g. Flatpak), fall back to flatpak-spawn.
 */
function commandExists(binary) {
  const lookup = process.platform === "win32" ? `where ${binary}` : `command -v ${binary}`;
  let exists = tryExec(lookup) !== "unknown";
  if (!exists && process.platform === "linux") {
    // Check host binaries if running inside Flatpak sandbox
    exists = tryExec(`flatpak-spawn --host command -v ${binary}`) !== "unknown";
  }
  return exists;
}

/**
 * Parse raw /etc/os-release key-value format into a key-value object.
 */
function parseOsRelease(raw) {
  const map = {};
  if (!raw || typeof raw !== "string") {
    return map;
  }
  raw.split("\n").forEach((line) => {
    const [key, ...rest] = line.split("=");
    if (!key || rest.length === 0) {
      return;
    }
    map[key] = rest.join("=").replace(/^"|"$/g, "");
  });
  return map;
}

/**
 * Check if the os-release map represents a Freedesktop SDK Flatpak runtime base image.
 */
function isFreedesktopRuntime(map) {
  if (!map || typeof map !== "object") {
    return false;
  }
  const id = String(map.ID || "").toLowerCase();
  const name = String(map.NAME || "").toLowerCase();
  const prettyName = String(map.PRETTY_NAME || "").toLowerCase();
  return id === "freedesktop" || name.includes("freedesktop") || prettyName.includes("flatpak runtime");
}

/**
 * Read operating system release details, prioritizing host os-release mounts
 * when running inside Flatpak or container environments.
 */
function readOsRelease() {
  // Candidate mount locations where host os-release is exposed in Flatpak / Distrobox
  const hostCandidatePaths = [
    "/run/host/etc/os-release",
    "/run/host/usr/lib/os-release",
    "/var/run/host/etc/os-release",
    "/host/etc/os-release",
  ];

  // 1. First attempt reading host OS release mounts
  for (const filePath of hostCandidatePaths) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf8");
        const map = parseOsRelease(raw);
        if (Object.keys(map).length > 0 && !isFreedesktopRuntime(map)) {
          return map;
        }
      }
    } catch (error) {
      // Ignore missing or unreadable host candidate paths
    }
  }

  // 2. Check standard container/system os-release files
  const standardCandidatePaths = ["/etc/os-release", "/usr/lib/os-release"];
  let primaryMap = {};

  for (const filePath of standardCandidatePaths) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf8");
        const map = parseOsRelease(raw);
        if (Object.keys(map).length > 0) {
          if (!isFreedesktopRuntime(map)) {
            return map;
          }
          if (Object.keys(primaryMap).length === 0) {
            primaryMap = map;
          }
        }
      }
    } catch (error) {
      // Ignore unreadable standard files
    }
  }

  // 3. If standard os-release identified as Freedesktop SDK runtime, attempt flatpak-spawn to host
  if (process.platform === "linux" && isFreedesktopRuntime(primaryMap)) {
    const hostOsReleaseRaw = tryExec("flatpak-spawn --host cat /etc/os-release");
    if (hostOsReleaseRaw && hostOsReleaseRaw !== "unknown") {
      const hostMap = parseOsRelease(hostOsReleaseRaw);
      if (Object.keys(hostMap).length > 0 && !isFreedesktopRuntime(hostMap)) {
        return hostMap;
      }
    }
  }

  return primaryMap;
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
    execution: getExecutionContext(),
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
  readOsRelease,
  parseOsRelease,
  isFreedesktopRuntime,
};
