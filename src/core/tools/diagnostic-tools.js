const { executionPlan } = require("../execution-runner");
const { getExecutionContext } = require("../execution-context");
const { executeSystemCommand } = require("./system-tools");

function getExecutionCapabilities() {
  const targets = {};
  for (const target of ["sandbox", "host"]) {
    try {
      const plan = executionPlan(target);
      targets[target] = { available: true, description: plan.description };
    } catch (error) { targets[target] = { available: false, reason: error.message }; }
  }
  return JSON.stringify({ checkedAt: new Date().toISOString(), process: getExecutionContext(), targets });
}

const DESKTOP_DIAGNOSTIC_COMMAND = `printf '=== desktop session verification ===\\n'
uid=$(id -u)
session_id="$XDG_SESSION_ID"
if [ -z "$session_id" ]; then session_id=$(loginctl show-user "$uid" -p Display --value 2>/dev/null); fi
# Resolve the host user bus rather than inheriting a Flatpak proxy address.
if [ -S "/run/user/$uid/bus" ]; then
  DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus"
  export DBUS_SESSION_BUS_ADDRESS
fi
session_type=$(loginctl show-session "$session_id" -p Type --value 2>/dev/null)
active=$(loginctl show-session "$session_id" -p Active --value 2>/dev/null)
owner=$(loginctl show-session "$session_id" -p User --value 2>/dev/null)
shell_owner=$(gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.GetConnectionUnixUser org.gnome.Shell 2>/dev/null)
if { [ "$session_type" = x11 ] || [ "$session_type" = wayland ]; } && [ "$active" = yes ] && [ "$owner" = "$uid" ] && [ "$shell_owner" = "(uint32 $uid,)" ]; then
  printf 'DESKTOP_SESSION_VERIFIED uid=%s session=%s\\n' "$uid" "$session_id"
  gsettings get org.gnome.desktop.interface enable-animations
else
  printf 'DESKTOP_SESSION_UNVERIFIED: animation setting not queried.\\n'
fi
`;

// Fixed commands, no model-supplied shell fragments. Reads only; unavailable
// probes remain explicit. Sample cumulative counters twice rather than inferring
// thrashing from the mere presence of allocated swap.
const DIAGNOSTIC_COMMAND = `
export LC_ALL=C
printf '=== identity ===\\n'
id -u
uname -r
printf '=== memory (kB) ===\\n'
cat /proc/meminfo
printf '=== pressure ===\\n'
for f in /proc/pressure/cpu /proc/pressure/memory /proc/pressure/io; do
  printf '%s\\n' "$f"
  cat "$f"
done
printf '=== swap counters sample 1 ===\\n'
grep -E '^pswp(in|out) ' /proc/vmstat
sleep 1
printf '=== swap counters sample 2 ===\\n'
grep -E '^pswp(in|out) ' /proc/vmstat
printf '=== CPU policy ===\\n'
for f in /sys/devices/system/cpu/cpu0/cpufreq/scaling_driver /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor /sys/devices/system/cpu/cpu0/cpufreq/energy_performance_preference /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq; do
  printf '%s\\n' "$f"
  cat "$f"
done
powerprofilesctl get
printf '=== process sample ===\\n'
ps -eo pid,comm,pcpu,pmem --sort=-pcpu | head -n 21
${DESKTOP_DIAGNOSTIC_COMMAND}
`;

async function diagnoseSystem({ signal } = {}) {
  const result = await executeSystemCommand(DIAGNOSTIC_COMMAND, { target: "host", signal, diagnostic: true });
  return JSON.stringify({ interpretation: "Read-only diagnostic samples. Missing probes are unknown. Process percentages and one second of swap activity are observations, not proof of the cause of lag. Desktop values are valid only following DESKTOP_SESSION_VERIFIED. Individual probe failures may occur even when the overall shell exits successfully.", result });
}
module.exports = { getExecutionCapabilities, diagnoseSystem, DIAGNOSTIC_COMMAND, DESKTOP_DIAGNOSTIC_COMMAND };
