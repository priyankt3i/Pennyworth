const { storeGet } = require("./store");
const { loadDistroConfig } = require("../core/config");
const { getSystemContext } = require("../core/system-context");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "../..");

function normalizeArchLabel(arch) {
  const value = String(arch || "")
    .trim()
    .toLowerCase();
  if (value === "x64" || value === "amd64") {
    return "x86_64";
  }
  if (value === "arm64") {
    return "aarch64";
  }
  return value || "unknown";
}

function autoDetectProfileId(distroConfig, systemContext) {
  const profiles = distroConfig?.profiles || {};
  const keys = Object.keys(profiles);
  const fallbackId = distroConfig?.defaultProfile || keys[0];
  const fallbackName = profiles?.[fallbackId]?.name || fallbackId;

  if (!keys.length) {
    throw new Error("No distro profiles are configured.");
  }

  if (systemContext.platform === "win32") {
    const prettyName = String(systemContext?.distro?.prettyName || "").toLowerCase();
    const name = String(systemContext?.distro?.name || "").toLowerCase();

    let targetId = "windows_11";
    if (prettyName.includes("server 2025") || name.includes("server 2025")) {
      targetId = "windows_server_2025";
    } else if (prettyName.includes("windows 10") || name.includes("windows 10")) {
      targetId = "windows_10";
    }

    const matchedName = profiles?.[targetId]?.name || targetId;
    return {
      profileId: targetId,
      reason: `Windows system context resolved. Selected target profile: '${matchedName}'.`,
    };
  }

  if (systemContext.platform === "darwin") {
    const prettyName = String(systemContext?.distro?.prettyName || "").toLowerCase();
    const name = String(systemContext?.distro?.name || "").toLowerCase();

    let targetId = "macos_sequoia";
    if (prettyName.includes("tahoe") || prettyName.includes("16.") || name.includes("tahoe")) {
      targetId = "macos_tahoe";
    }

    const matchedName = profiles?.[targetId]?.name || targetId;
    return {
      profileId: targetId,
      reason: `macOS system context resolved. Selected target profile: '${matchedName}'.`,
    };
  }

  if (systemContext.platform !== "linux") {
    return {
      profileId: fallbackId,
      reason: `Non-Linux host (${systemContext.platform}) detected. Auto target profile: '${fallbackName}'.`,
    };
  }

  const distroId = String(systemContext?.distro?.id || "unknown").toLowerCase();
  const distroIdLike = (systemContext?.distro?.idLike || []).map((x) => String(x).toLowerCase());
  const detectedArch = normalizeArchLabel(systemContext?.arch);
  const pkgPresence = systemContext?.packageManagersPresent || {};

  let best = {
    profileId: fallbackId,
    score: -999,
    reason: `No strong match; using default profile '${fallbackId}'.`,
  };

  for (const profileId of keys) {
    const profile = profiles[profileId] || {};
    let score = 0;
    const reasons = [];
    const family = String(profile.family || "").toLowerCase();
    const profileName = String(profile.name || "").toLowerCase();
    const profileIdLower = profileId.toLowerCase();
    const supportedArch = (profile.architectures || []).map((x) => String(x).toLowerCase());
    const packageManagers = (profile.packageManagers || []).map((x) => String(x).toLowerCase());

    if (distroId === profileIdLower) {
      score += 40;
      reasons.push(`distro id '${distroId}' matched profile id`);
    } else if (profileName && profileName.includes(distroId)) {
      score += 30;
      reasons.push(`distro id '${distroId}' matched profile name`);
    }

    if (family && distroIdLike.includes(family)) {
      score += 18;
      reasons.push(`ID_LIKE matched family '${family}'`);
    }
    if (distroIdLike.includes(profileIdLower)) {
      score += 16;
      reasons.push(`ID_LIKE matched profile '${profileIdLower}'`);
    }

    const matchingPkg = packageManagers.filter((pm) => Boolean(pkgPresence[pm]));
    if (matchingPkg.length) {
      score += matchingPkg.length * 7;
      reasons.push(`package manager match (${matchingPkg.join(", ")})`);
    }

    if (supportedArch.includes(detectedArch)) {
      score += 6;
      reasons.push(`architecture '${detectedArch}' supported`);
    } else if (supportedArch.length) {
      score -= 4;
    }

    if (score > best.score) {
      best = {
        profileId,
        score,
        reason: reasons.join("; ") || "best candidate",
      };
    }
  }

  return {
    profileId: best.profileId,
    reason: best.reason,
  };
}

function applyAgentOverrides(systemContext, profile, agentContext) {
  const outputSystemContext = {
    ...systemContext,
  };
  const outputProfile = {
    ...profile,
    documentation: {
      ...(profile?.documentation || {}),
    },
  };

  if (agentContext.docsRootUrlOverride) {
    outputProfile.documentation.rootUrl = agentContext.docsRootUrlOverride;
  }

  outputSystemContext.agentOverrides = {
    docsRootUrlOverride: agentContext.docsRootUrlOverride || null,
    allowIpLocation: Boolean(agentContext.allowIpLocation),
    devMode: Boolean(agentContext.devMode),
  };

  return {
    systemContext: outputSystemContext,
    profile: outputProfile,
  };
}

function normalizeAgentContext(input) {
  const rawMaxSteps = parseInt(input?.maxToolSteps, 10);
  const maxToolSteps = Number.isInteger(rawMaxSteps) && rawMaxSteps >= 1 && rawMaxSteps <= 50 ? rawMaxSteps : 10;

  return {
    docsRootUrlOverride: String(input?.docsRootUrlOverride || "").trim(),
    allowIpLocation: Boolean(input?.allowIpLocation),
    devMode: Boolean(input?.devMode),
    tokenSaverMode: Boolean(input?.tokenSaverMode),
    maxToolSteps,
    theme: String(input?.theme || "light"),
  };
}

function getAgentContextState() {
  const raw = storeGet("agentContext", {});
  return normalizeAgentContext(raw);
}

function runtimeState() {
  const distroConfig = loadDistroConfig(ROOT_DIR);
  const systemContext = getSystemContext();
  const detection = autoDetectProfileId(distroConfig, systemContext);
  const profileId = detection.profileId;
  const agentContext = getAgentContextState();
  const profile = distroConfig.profiles[profileId];
  const contextWithOverrides = applyAgentOverrides(systemContext, profile, agentContext);

  return {
    distroConfig,
    profileId,
    profile,
    agentContext,
    detection,
    systemContext,
    contextWithOverrides,
    hostProfileName: systemContext?.distro?.prettyName || systemContext.platform,
    hostArchitecture: systemContext.arch,
  };
}

module.exports = {
  autoDetectProfileId,
  applyAgentOverrides,
  normalizeAgentContext,
  getAgentContextState,
  runtimeState,
};
