# Pennyworth

Pennyworth is a cross-platform desktop AI assistant (Electron) designed to feel like a true system copilot: always available from the tray, context-aware about the host, and capable of using tools to help troubleshoot, manage, and configure your system. It includes **Hermes**, an agentic system handler with command execution sandboxing, command risk scoring, and persistent memory.

## Vision

**Original goal:** Build a Batman-style butler for Linux power users (starting with Arch/CachyOS), then expand to broader distro families and eventually support full Windows/macOS/Linux parity with strong security boundaries.

**Current state:** The prototype runs on Windows/macOS/Linux with production-grade security hardening, modular architecture, comprehensive provider tool-calling support, local RAG, screenshot-to-model chat context, robust fail-safes, and 40+ pre-configured distro profiles.

## Current Progress (Implemented)

### Core Architecture & Stability
- **Modular Refactor (PR #5, Complete):**
  - `src/main.js` split into 9 specialized controllers (`store.js`, `vault.js`, `sessions.js`, `provider-config.js`, `health.js`, `bootstrap.js`, `profiles.js`, `ipc-handlers.js`, `index.js`)
  - `src/core/tools.js` split into 5 focused modules (`info-tools.js`, `web-tools.js`, `memory-tools.js`, `system-tools.js`, `index.js`)
  - `src/renderer/app.js` split into 5 UI components (`dom.js`, `toasts.js`, `settings.js`, `chat.js`, `app.js`)
  - All 29 unit tests passing post-refactor ✓

### Electron Desktop Shell
- Tray icon + double-click summon
- Global shortcut: `Ctrl+Shift+Space`
- Frameless app window + in-app window controls (minimize/maximize/close-to-tray)
- Settings modal + runtime provider badges
- Custom app/taskbar/tray icons from `public/pennyworth.ico` and `public/pennyworth.png`

### System Awareness & Distro Support
- **Auto-detection:** Host platform, architecture, distro/profile
- **40+ Pre-configured Profiles:** Arch family (CachyOS, EndeavourOS, Manjaro, SteamOS, Garuda, Artix, BlackArch), Debian/Ubuntu family (Mint, Pop!_OS, Kali, Zorin, MX, Raspberry Pi, Parrot, elementary, Deepin, Bodhi, Tails), Fedora/RHEL family (Workstation, RHEL, AlmaLinux, Rocky, Nobara, CentOS, Amazon Linux, Asahi), openSUSE, Gentoo, independent distros (NixOS, Solus, Void, Alpine, Clear, Slackware, Qubes), BSD (FreeBSD, OpenBSD), Windows (10, 11, Server 2025), macOS (Sequoia, Tahoe), ChromeOS, Haiku
- System fingerprint context (kernel, desktop, package-manager presence, etc.)

### Security Hardening (PRs #4, #6, #8 — Complete)
- **Electron safeStorage Vault:**
  - Built-in OS keychain integration (DPAPI on Windows, Keychain on macOS, Libsecret on Linux)
  - PBKDF2 fallback with 100,000 iterations + random per-install salting for offline environments
  - Backwards-compatible migration path (no user lockout on update) ✓
  
- **Custom Corporate CA Certificate Support:**
  - Root CA Certificate Path input in UI settings
  - Secure `https.Agent` instantiation for all outgoing tool requests
  - Eliminates blanket `NODE_TLS_REJECT_UNAUTHORIZED` bypass
  - Enforced across all health checks and provider connectivity (PR #8) ✓

- **Command Security Sandbox (Risk Scoring Model):**
  - **Score 1 (Low Risk):** Read-only commands (e.g. `git status`, `df -h`, `ollama list`) → auto-approved
  - **Score 2 (Medium Risk):** Standard actions (e.g. package management) → user approval popup
  - **Score 3 (High Risk):** Service/registry/network modifications → prominent warning window
  - **Score 4 (Critical Risk - Blocked):** Destructive commands, download-and-execute pipes → automatically blocked
  - **Sensitive Path Filter:** Blocks access to SSH keys (`id_rsa`, `id_ed25519`, `authorized_keys`), shell startup files (`.bashrc`, `.zshrc`, `.profile`), credential files (`.env`, `.kube`, `.aws`), registry hives
  - **Obfuscation Defenses (PR #6):**
    - Quote-stripping pre-processing (defeats `cat ~/.s"s"h/id_r's'a` bypasses)
    - Variable substitution scanning (detects `a=.env; cat $a` indirection)
    - Folder boundary scanning (blocks any command accessing `.ssh`, `.aws`, `.kube` folders)
  - **Windows/PowerShell Parity:** Blocks `Remove-Item -Path C:\\ -Recurse -Force`, `Clear-Disk`, `Format-Disk`, credential extraction (`reg save hklm\sam`), service manipulation, firewall rule disabling

- **Elevated Prompt for Sensitive Operations:**
  - Electron native `dialog.showMessageBoxSync()` for approval gates
  - Risk descriptions and privilege implications displayed before execution

### Provider Layer (Multi-Model + Tool-Calling)
- **Supported Providers:** Ollama (local), OpenAI, Gemini
- **Native Tool-Calling Support:**
  - Ollama: OpenAI-compatible tool specifications (`/api/chat` loop)
  - OpenAI: Tool Definitions
  - Gemini: Function Declarations
- **Single Active Provider Selection:** Tabbed LLM section in settings
- **Provider Health Checks:** Real-time status in settings panel
- **API Key Management:** Encrypted storage via Electron safeStorage or local PBKDF2 vault
- **Model Auto-Discovery:** Ollama model dropdown auto-populated
- **Provider Failover Routing:** Attempts all enabled providers in order, falls back gracefully
- **No-Provider Fallback:** Icon and guided status/help messaging when all providers disabled

### Agentic Tool Use (Hermes System Handler)
- **Information Tools:**
  - `get_current_datetime`: System clock + timezone
  - `get_weather`: Open-Meteo integration with optional IP-location permission
  - `web_search`: DuckDuckGo fresh web lookup

- **System Administration Tools:**
  - `execute_system_command`: Shell execution (bash/sh on Linux/macOS, PowerShell/CMD on Windows) with risk scoring
  - `read_system_file`: Config/log inspection with sensitive path filtering
  - `write_system_file`: Script generation + config updates with approval gates
  - `get_system_status`: Live host state (CPU model/utilization, memory, disk, processes, systemd services, network adapters)

- **Memory & Knowledge Tools:**
  - `remember_fact`: Persistent butler memory (saves to `pennyworth-memory.json`)
  - `recall_facts`: Fuzzy search over learned facts
  - Memories automatically injected into Hermes' system prompt on boot

### Retrieval-Augmented Generation (RAG)
- **Local Docs Retrieval:** Lexical keyword scoring from `data/docs/<profile>` directory
- **Distro Docs Crawler:** `scripts/crawl-docs.js` pulls distro documentation locally
- **Profile-Aware:** Docs matched to detected or user-selected distro

### UI/UX & Notifications
- **Screenshot Capture:**
  - Monitor selection + region selection UI
  - Capture flow hides app before screenshot to avoid self-capture artifacts
  - Screenshot payload sent with chat requests to compatible providers/models
  - Full vision-model support for screenshot interpretation

- **Input Methods:**
  - Speech-to-text input (browser speech recognition API)
  - Markdown chat rendering
  - Message history with session persistence

- **Real-Time Feedback:**
  - Developer trace panel for provider/tool execution visibility
  - Live status bar updates as trace events fire (exact actions Hermes is performing)
  - Failure messages surfaced in UI instead of silent errors

- **Toast Notifications:**
  - Dismissible floating cards (top-right) for warnings/errors
  - Auto-fade for success/info messages after 6 seconds
  - Notification history modal with bell icon (🔔) and red unread badge
  - Color-coded timeline (Red = error, Yellow = warning, Green = success, Blue = info)
  - Clear History button to reset logs

- **Dynamic Stop Button:**
  - Red Stop button appears when busy (replaces Send)
  - Cancels tool-calling loop execution immediately
  - Raises `AGENT_STOPPED` error at next step

### Testing & CI/CD
- **Unit Test Suite:** 29 tests covering:
  - Command risk scoring (Low, Medium, High, Blocked)
  - Sensitive path blocking (SSH keys, credentials, shell configs)
  - Obfuscation bypass detection (quote-stripping, variable indirection)
  - Windows PowerShell destructive command blocking
  - Session management and metadata sorting
  - Vault operations and API key encryption
- **GitHub Actions Pipeline:** `.github/workflows/test.yml`
  - Runs headless tests on Node v22
  - Triggered on every push to `main` and all PR merge targets
  - All 29 tests passing ✓

## Current Limits

- Voice is input-only right now (no TTS playback for two-way voice conversation yet).
- Screen context is capture-on-demand, not continuous live screen share.
- No terminal streaming parser yet (user still pastes errors manually in most flows).
- RAG is lexical retrieval (keyword scoring), not embeddings/vector search yet.
- No autonomous action-execution engine yet (assistant advises; approval gates required for all system-changing actions).
- Visual reasoning quality depends on selected model/provider capabilities (vision-capable model required for screenshot interpretation).

## Roadmap Toward "True Copilot"

### Phase 1: Stabilize Core Agent (Complete)
1. ✅ Harden provider/tool error handling and trace visibility (DONE — PR #5 refactor, trace events)
2. ✅ Docs ingestion + chunking quality for distro knowledge (DONE — lexical RAG, crawl-docs.js)
3. ✅ Cross-platform packaging reliability and first-run diagnostics (DONE — bootstrap.js, health checks)
4. ✅ Provider/model readiness checks before chat send (DONE — health.js, provider state validation)
5. ✅ Enterprise security: safeStorage vault, PBKDF2 fallback, CA cert support (DONE — PR #4, #6, #8)

### Phase 2: Real Copilot Experience
1. Full voice chat:
   - Push-to-talk + optional wake-word mode
   - Speech-to-text (done) + text-to-speech for conversational loop
2. Share-screen modes:
   - One-shot capture (done) plus continuous session share (next)
   - OCR + UI element detection so Pennyworth can reference on-screen errors directly
3. Terminal co-pilot mode:
   - Detect shell errors in real time
   - Propose fixes with confidence, risk, and rollback guidance
4. **Persistent Memory Enhancements:**
   - `remember_fact` and `recall_facts` tools (DONE — foundational)
   - User-controlled privacy settings for memory retention
   - Memory exports/backups

### Phase 3: Safe Agentic Actions
1. ✅ Explicit approval gates before any system-changing command (DONE — risk scoring + dialogs)
2. ✅ Dry-run plans and command previews (DONE foundation — shown in UI before approval)
3. Audit log/history of actions taken (foundation laid in trace system)
4. Sandboxed executor profiles per distro family

### Phase 4: Rich Knowledge + Memory
1. Embeddings-based RAG with citations across distro docs (vector search instead of keyword scoring)
2. Advanced memory with multi-session context and learning
3. Continuous OS profile expansion (currently 40+ distros, room for more specialized profiles)

## Project Structure

```
src/
  main.js                    # Electron entry point (routes to main/index.js for non-test)
  main/                      # Main process controllers
    index.js                 # App lifecycle, tray, window, shortcuts
    store.js                 # Configuration read/write
    vault.js                 # safeStorage + PBKDF2 encryption/decryption
    sessions.js              # Chat history persistence
    provider-config.js       # Provider state management
    health.js                # LLM connection status checks
    bootstrap.js             # Installer helpers (winget, curl)
    profiles.js              # System detection & distro profiling
    ipc-handlers.js          # Electron IPC channel bindings
  
  core/
    providers.js             # Provider orchestration & failover
    tools.js                 # Tool exports gateway
    tools/                   # Tool modules
      index.js               # API schema + orchestration
      info-tools.js          # Weather, datetime, web search
      web-tools.js           # DuckDuckGo scraper, URL utilities
      memory-tools.js        # Butler memory (remember/recall)
      system-tools.js        # Command security, execution, file ops
    rag.js                   # Local docs retrieval
  
  renderer/
    index.html               # UI structure
    app.js                   # Page boot + shortcuts
    dom.js                   # DOM element cache
    toasts.js                # Notification system
    settings.js              # Settings modal
    chat.js                  # Chat history + speech input
    styles.css               # UI styling

config/
  distros.json               # 40+ distro profiles with docs roots, package managers, update commands
  providers.json             # Provider defaults & enable/disable flags

data/
  docs/<profile>/            # Local distro documentation (crawled)

scripts/
  crawl-docs.js              # Distro docs ingestion helper
  init-config.js             # Bootstrap config on first run
  normalize-json.js          # JSON formatting utility

.github/
  workflows/
    test.yml                 # GitHub Actions CI (Node v22, headless tests)
```

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Initialize provider config:

```bash
npm run init:config
```

3. Normalize JSON (recommended on Windows):

```bash
npm run json:normalize
```

4. Run the app:

```bash
npm run dev
```

5. Optional: crawl docs for CachyOS:

```bash
npm run crawl:docs -- cachyos 50
```

## Testing

Run the full test suite locally:

```bash
npm test
```

This runs all 29 unit tests covering:
- Command risk scoring and blocking
- Sensitive path protection
- Vault encryption/decryption
- Session management
- Provider health checks
- Obfuscation bypass detection

The CI pipeline runs tests automatically on every push to `main` and PR merge targets via GitHub Actions.

## Build Targets

```bash
npm run dist:win
npm run dist:mac
npm run dist:linux
```

or all configured targets:

```bash
npm run dist
```

## Provider + Key Setup

### Ollama (Local)
- Requires Ollama running locally (default: `http://127.0.0.1:11434`)
- Model auto-discovery dropdown in settings
- No API key required

### OpenAI
- Enable provider in settings
- Set API key in settings (encrypted via safeStorage or local vault)
- Default model: `gpt-4o-mini`

### Gemini
- Enable provider in settings
- Set API key in settings (encrypted via safeStorage or local vault)
- Default model: `gemini-2.0-flash`

**Keys are stored securely:**
- Electron's native `safeStorage` on all platforms (DPAPI/Keychain/Libsecret)
- Falls back to local PBKDF2 vault (100,000 iterations + random salt) if system keychain unavailable
- Sensitive path protection prevents accidental credential leaks

## Security & Corporate Network Support

### Custom Corporate CA Certificate
If you're behind a corporate SSL-intercepting firewall:

1. Export your Root CA certificate as a `.pem` file
2. In Pennyworth settings, enable "Custom Root CA Certificate Path"
3. Browse to your CA `.pem` file
4. All HTTPS tool requests now validate against your CA (blocks MITM while maintaining connectivity)

**Note:** This replaces the old blanket `NODE_TLS_REJECT_UNAUTHORIZED` bypass. All health checks and provider connectivity now enforce the custom CA agent.

### Sensitive Path Protection
Hermes automatically blocks access to:
- SSH keys (`~/.ssh/id_rsa`, `id_ed25519`, `authorized_keys`)
- Credential files (`~/.env`, `~/.kube/config`, `~/.aws/credentials`)
- Shell startup files (`~/.bashrc`, `~/.zshrc`, `~/.profile`)
- Windows registry credential hives (`HKLM\sam`, etc.)
- Command execution of privileged operations without approval

### Obfuscation & Bypass Defense
The command security system detects and blocks:
- Quote-splitting evasion (`cat ~/.s"s"h/id_r's'a` → blocked as `~/.ssh/id_rsa`)
- Variable substitution indirection (`a=.env; cat $a` → blocked)
- Directory-level credential folder access (any command touching `.ssh`, `.aws`, `.kube`)
- Windows PowerShell destructive operations (recursive deletes, partition wipes, service disables, registry extraction)

## Notes

- Building mac artifacts is most reliable on macOS hosts.
- Building Linux artifacts is most reliable on Linux hosts.
- Screenshot behavior may vary by desktop/compositor (especially on Wayland).
- For screenshot-aware answers, choose a vision-capable provider/model (e.g., GPT-4 Vision, Gemini 2.0 Flash).
- All system-changing operations require explicit user approval via native OS dialogs.
- Trace logs are visible in the developer panel for debugging provider/tool execution.

## Hermes Agent: Agentic PC & Linux Handler

**Hermes** is Pennyworth's core agentic system handler — a safe remediation copilot that allows your selected LLM to directly interact with, troubleshoot, and configure your host operating system while respecting strict security boundaries.

### Core Capabilities

**Host System Identification:**
- Automatically reads platform type, distro profiles, architecture, kernel version, hardware resources, and package manager presence (`pacman`, `yay`, `paru`, `apt`, `dnf`, `brew`, etc.)
- Surfaces this context to the LLM so it can make OS-specific recommendations

**System Execution & Configuration Tools:**
- `execute_system_command`: Runs shell commands with risk scoring (Low/Medium/High/Blocked)
- `read_system_file`: Inspects configs, logs, service files with sensitive path filtering
- `write_system_file`: Generates and updates scripts and configuration files with approval gates
- `get_system_status`: Queries live CPU, memory, disk, processes, systemd services, network adapters

**Persistent Butler Memory:**
- `remember_fact`: Learns and stores facts about the system/user on disk (`pennyworth-memory.json`)
- `recall_facts`: Fuzzy-searches prior learned facts to inform future recommendations

### Safety & Approval Gate

**Native Dialog Approvals:**
- Any invocation of `execute_system_command` or `write_system_file` triggers Electron's native `dialog.showMessageBoxSync()` to display the proposed action and risk implications
- User explicitly approves before execution (no silent background changes)

**Sensitive Path Filter:**
- Attempts to read SSH keys, private credentials, or shell histories are automatically intercepted and blocked
- Write attempts to sensitive paths trigger elevated warning prompts
- Obfuscated bypass attempts (quote-splitting, variable substitution, folder-level access) are detected and blocked

**Command Risk Scoring:**
- Low-risk read commands auto-approved
- Medium-risk package management prompts for approval
- High-risk service/registry modifications show prominent warnings
- Critical-risk destructive commands (rm -rf /, format, add admin users) automatically blocked

### Model Tool Calling Support

All three providers support native tool-calling out of the box:
- **Ollama (Local Models):** OpenAI-compatible tool specifications (llama3.2, qwen2.5-coder, etc.)
- **OpenAI (Cloud):** Tool Definitions
- **Gemini (Cloud):** Function Declarations

Hermes intelligently selects the appropriate tool-calling flow based on the active provider.

### Advanced Capabilities & UI Refinements

**Dynamic Stop Button:**
- Chat button morphs into a red **Stop** button when Hermes is busy
- Clicking it halts execution immediately by raising an `AGENT_STOPPED` error

**Real-Time Activity Streaming:**
- Status bar updates dynamically as trace events fire, showing exact action (e.g., "Executing: sudo pacman -Syu")
- Trace panel logs full tool execution history for debugging

**Toast Notifications + History Modal:**
- Floating toast cards display alerts, warnings, and status updates
- Bell icon (🔔) with unread badge in header shows notification history
- Color-coded timeline with timestamps for all system events
- Clear History button to reset logs

**Enterprise-Grade Credentials Fallback:**
- Integrates secure fallback key management vault
- If Electron's `safeStorage` fails to load (headless/minimal Linux), falls back to local PBKDF2 encryption
- No credentials ever stored in plaintext

**GitHub Actions CI Pipeline:**
- `.github/workflows/test.yml` runs headless unit tests on Node v22
- Triggered on every push to `main` and all PR merge targets
- 29 tests validate command security, vault ops, provider health, session management
