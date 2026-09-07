# Execution safety and release validation

Pennyworth remains a development build. These controls reduce execution risks;
passing unit tests is not a security certification or proof of diagnostic accuracy.

## Targets and approvals

- `get_execution_capabilities` probes targets without authorizing commands.
- `sandbox` uses Linux Bubblewrap with separate namespaces, no network or desktop
  session bus, no host home directory, read-only runtime mounts and ephemeral
  `/tmp`. It fails closed if Bubblewrap or namespaces are unavailable. Sandbox
  probes never fall back to host execution.
- `host` currently supports native Linux verified with `systemd-detect-virt`, or
  a verified Flatpak host bridge. Nested/unsupported containers and unsupported
  platforms fail closed. This check is evidence of execution scope, not a claim
  to detect every possible namespace arrangement or hostile OS.
- Every host command needs approval for its exact command and target, including
  reads that may send private output to the selected provider. Low-risk sandbox
  queries can run automatically. Green/orange/red icons are accompanied by text
  risk and READ/WRITE/MAY WRITE labels. Unknown shell logic is never called safe.
- Regex checks provide conservative warnings and block known patterns; they are
  not a complete shell parser or a security boundary. The boundary is isolation
  plus explicit approval for unsandboxed actions.
- Process output carries target, timestamps, verification evidence, exit code,
  stdout and stderr. Missing tools, failed probes and denied actions remain
  explicit. Approval does not establish that a command succeeded.

## Files and cancellation

File tools act in the application's local filesystem view; they do not cross a
Flatpak host bridge. All file reads and writes require approval. Symlinks in the
path are rejected, and regular files are opened without following final links.
Linux direct writes traverse parent directories through file descriptors to
prevent parent-symlink races. They require an existing parent, cap reviewable
content at 100 KB, reject hard-linked targets, retain a private original backup,
and replace through a temporary file. Concurrent edits during approval require
fresh approval. Direct writes on other platforms remain disabled until equivalent
path guarantees have been implemented and tested.

Stop propagates to tool execution and is checked again after approval. Local
process groups are terminated on cancellation, timeout or excessive output.
Flatpak host commands use `--watch-bus` so the bridge ties command lifetime to its
connection. Cancellation cannot undo completed writes, stop services already
started through service managers, or promise to kill deliberately detached or
privileged processes. Do not use this shell tool as a background service manager.
Provider failover does not restart a run after a tool attempt, avoiding duplicate
side effects.

## Diagnostic evidence

`diagnose_system` uses fixed read-only host probes after approval. It reports
memory availability, pressure stall counters, swap counters one second apart,
CPU scaling driver/governor/energy preference, active power profile and a process
sample. Desktop animation queries require an active login session belonging to
the executing UID and a GNOME Shell session-bus owner with that UID. An absent or
ambiguous session is reported as unverified; no sandbox default is presented as a
host preference.

The prompt requires separate observations, hypotheses and verified causes.
`powersave`, low free RAM, or some allocated swap alone are not diagnoses. These
instructions improve model behavior but cannot guarantee correct causal reasoning.

## Application controls

Renderer scripts use a restrictive CSP and context isolation. Normal startup and packaged builds retain Electron sandboxing. The development-only `npm run dev` command uses the pre-existing `--no-sandbox` compatibility flag for machines without a configured Electron sandbox helper. This disables Electron process sandboxing for that development run; it does not disable the separate Bubblewrap command sandbox, host approvals, or file policies.
Navigation/new windows are denied. IPC checks the sender's window, main frame and
exact local renderer URL. Notifications escape text before rendering. Session IDs
are bounded identifiers, and session symlinks are rejected. The credential vault
rejects reinitialization and treats Linux `basic_text` storage as unavailable,
using the passphrase vault instead. The app does not execute downloaded shell
installers as an Ollama setup fallback.

## Release gates

Run `npm ci --legacy-peer-deps`, `npm test`, `npm run test:electron` (under Xvfb
where needed), `npm run pack`, and `npm audit`. CI tests and builds unsigned
packages on Linux, macOS and Windows; a Linux integration job requires real
Bubblewrap isolation and renderer smoke checks. Unsigned CI artifacts are for
validation, not release distribution.

Before claiming production readiness, validate on native Linux and a real Flatpak
installation: host bridge denied/available, namespace restrictions, GNOME/X11 and
Wayland sessions, multiple sessions, native approvals, cancellation during changes,
local speech inference, and packaged launch. Signing/notarization, update delivery,
and independent security review remain release work. No model test can substitute
for these checks.

References:
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Flatpak spawn lifecycle and host permissions](https://docs.flatpak.org/en/latest/flatpak-command-reference.html#flatpak-spawn)
- [Transformers.js dtype migration](https://huggingface.co/docs/transformers.js/guides/dtypes)

## Validation on this branch (2026-09-07)

- Automated suite: 78 passed, zero failures; one real Bubblewrap integration test
  skipped because this machine denies namespace creation.
- Dependency audit: zero reported vulnerabilities after Electron/build-tool
  upgrades and migration to maintained Transformers.js. Archive and image-library
  overrides are exercised by compatibility checks; review them on future upgrades.
- Local speech: quantized Whisper CPU inference completed using the upgraded
  runtime; this is a runtime smoke check, not an accuracy evaluation.
- Unsigned Linux directory package: built successfully at `dist/linux-unpacked`.
- Electron GUI smoke: blocked locally because the SUID sandbox helper is not
  configured. The sandbox was not disabled to obtain a passing result.
- Cross-platform packaging CI and real Flatpak/desktop approval checks have not
  been executed in this workspace. They remain release gates.
