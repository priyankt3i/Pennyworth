# Pennyworth

Pennyworth is a cross-platform desktop AI assistant (Electron) designed to feel like a true system copilot: always available from the tray, context-aware about the host, and capable of using tools (web, weather, date/time, local docs) to answer real troubleshooting questions.

## Vision

Original goal: build a Batman-style butler for Linux power users (starting with Arch/CachyOS), then expand to broader distro families and eventually support full Windows/macOS/Linux parity with strong auto-detection and minimal manual setup.

Current state: the prototype runs on Windows/macOS/Linux, has provider tool-calling and local-doc retrieval, and now includes frameless desktop UX, screenshot-to-model chat context, and robust failure surfacing. It still needs full duplex voice, deeper terminal/screen understanding, and safe action execution to become a true "copilot on steroids."

## Current Progress (Implemented)

- Electron desktop shell with:
  - tray icon + double-click summon
  - global shortcut: `Ctrl+Shift+Space`
  - frameless app window + in-app window controls (minimize/maximize/close-to-tray)
  - settings modal + runtime badges
- Branding:
  - custom app/taskbar/tray icons from `public/pennyworth.ico` and `public/pennyworth.png`
  - in-app logo in the header
- System awareness:
  - host platform + architecture detection
  - distro/profile auto-targeting (no manual profile/arch selection required)
  - system fingerprint context (kernel, desktop, package-manager presence, etc.)
- Provider layer:
  - `ollama`, `openai`, `gemini`
  - single active provider selection in settings (tabbed LLM section)
  - provider failover routing
  - provider health checks in settings
  - no-provider fallback icon and guided status/help messaging
  - API key entry in settings (saved via `keytar` when available)
  - Ollama model auto-discovery for dropdown model selection
- Agentic tool use:
  - `get_current_datetime`
  - `get_weather` via Open-Meteo (with optional IP-location permission)
  - `web_search` for fresh web lookup
  - native tool/function-calling loops for OpenAI and Gemini
  - deterministic fallback tool routing for Ollama
- RAG (prototype):
  - local docs retrieval from `data/docs/<profile>`
  - docs crawler script for pulling distro docs locally
- UI/UX:
  - screenshot capture with monitor selection + region selection
  - capture flow hides app before screenshot to avoid self-capture artifacts
  - screenshot payload is sent with chat requests to compatible providers/models
  - speech-to-text input (browser speech recognition)
  - markdown chat rendering
  - developer trace panel for provider/tool execution visibility
  - failure messages surfaced in UI instead of silent errors

## Current Limits

- Voice is input-only right now (no real two-way voice conversation with TTS playback).
- Screen context is capture-on-demand, not continuous live screen share.
- No terminal streaming parser yet (user still pastes errors manually in most flows).
- RAG is lexical retrieval (keyword scoring), not embeddings/vector search yet.
- No safe action-execution engine yet (assistant advises; it does not automatically run privileged system actions).
- Visual reasoning quality depends on selected model/provider capabilities (vision-capable model required for screenshot interpretation).

## Roadmap Toward "True Copilot"

### Phase 1: Stabilize Core Agent (Now)

1. Harden provider/tool error handling and trace visibility.
2. Add stronger docs ingestion + chunking quality for distro knowledge.
3. Improve cross-platform packaging reliability and first-run diagnostics.
4. Add better provider/model readiness checks before chat send.

### Phase 2: Real Copilot Experience

1. Full voice chat:
  - push-to-talk + wake-word optional mode
  - speech-to-text + text-to-speech for conversational loop
2. Share-screen modes:
  - one-shot capture (done) plus continuous session share (next)
  - OCR + UI element detection so Pennyworth can reference on-screen errors directly
3. Terminal co-pilot mode:
  - detect shell errors in real time
  - propose fixes with confidence, risk, and rollback guidance

### Phase 3: Safe Agentic Actions

1. Add explicit approval gates before any system-changing command.
2. Add dry-run plans and command previews.
3. Add audit log/history of actions taken.
4. Add sandboxed executor profiles per distro family.

### Phase 4: Rich Knowledge + Memory

1. Embeddings-based RAG with citations across distro docs.
2. Persistent user/system memory with privacy controls.
3. Expand `config/distros.json` coverage:
   - Arch family (CachyOS, EndeavourOS, Manjaro)
   - Debian/Ubuntu/Mint
   - Fedora/RHEL family

## Project Structure

- `src/main.js`: Electron main process, tray/window, IPC handlers, runtime state
- `src/renderer/*`: UI, chat behavior, settings, trace panel, theme
- `src/core/providers.js`: provider orchestration + failover + tool-call loops
- `src/core/tools.js`: tool definitions + execution (`datetime`, `weather`, `web_search`)
- `src/core/rag.js`: local docs retrieval (lexical prototype)
- `config/distros.json`: distro profiles, architectures, docs roots
- `config/providers.json`: provider defaults and enable/disable flags
- `scripts/crawl-docs.js`: local documentation ingestion helper

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

- Ollama: local endpoint + model in settings
- OpenAI: enable provider + set API key in settings
- Gemini: enable provider + set API key in settings

Keys entered in settings are stored via OS keychain integration (`keytar`) when available.

## Notes

- Building mac artifacts is most reliable on macOS hosts.
- Building Linux artifacts is most reliable on Linux hosts.
- Screenshot behavior may vary by desktop/compositor (especially on Wayland).
- For screenshot-aware answers, choose a vision-capable provider/model.

## Hermes Agent: Agentic PC & Linux Handler

Pennyworth includes **Hermes**, an agentic system handler designed as a safe remediation copilot. It allows the selected LLM to directly interact with, troubleshoot, and configure the host operating system.

### Core Capabilities
*   **Host System Identification**: Automatically reads platform type, distro profiles, architecture, kernel version, hardware resources, and present package managers (`pacman`, `yay`, `paru`, `apt`, `dnf`, `zypper`), and passes this to the LLM on every turn.
*   **System execution & configuration tools**:
    *   `execute_system_command`: Runs shell commands (supports bash/sh for Linux/macOS and PowerShell/CMD for Windows).
    *   `read_system_file`: Inspects host files, configurations, and logs.
    *   `write_system_file`: Generates script files and updates system configuration targets.
    *   `get_system_status`: Inspects live host state (CPU model/utilization, free/total memory, disk volume size, running processes, active systemd services, and network adapters).

### Safety & Approval Gate
*   **Native Dialog Approvals**: To prevent unintended system modification, any invocation of `execute_system_command` or `write_system_file` calls Electron's native `dialog.showMessageBoxSync`, forcing the main execution thread to pause and request authorization from the user via a modal dialog window.
*   **Sensitive Path Filter**: Attempts to read user credential patterns, private SSH keys (`id_rsa`), API config files, or shell histories via `read_system_file` are automatically intercepted and require explicit user authorization.

### Model Tool Calling Support
*   **Local Models (Ollama)**: Upgraded `/api/chat` communication loop with Ollama to support native OpenAI-compatible tool specifications. Local offline models (like `llama3.2` or `qwen2.5-coder`) can call host tools as seamlessly as OpenAI and Gemini.
*   **Commercial Models (OpenAI & Gemini)**: Native tool calling loop using Gemini Function Declarations and OpenAI Tool Definitions.

### Advanced Capabilities & UI Refinements

*   **Butler Persistent Memory Engine**: Equipped Hermes with `remember_fact` and `recall_facts` tools. Memories are saved on disk to a dedicated `pennyworth-memory.json` file in the user data folder. During startup, the backend automatically reads this file and injects all memories directly into the initial model prompt instructions, retaining facts about system changes, configurations, or preferences across restarts.
*   **Live UI Activity Streaming**: Replaced static status indications with a dynamic event listener. The status bar in the bottom-left updates in real-time as trace events fire, detailing the exact action Hermes is taking (e.g. `Hermes is thinking...`, `Executing tool: execute_system_command...`, `Ready`).
*   **Dynamic Stop Button & Cancellation Gates**: The chat button morphs into a red **Stop** button when busy. Clicking it halts execution immediately by raising an `AGENT_STOPPED` error at the next provider step boundary. Inputs are disabled while busy to prevent double-submit bugs.
*   **Enterprise-Grade Credentials Fallback**: Integrates a secure fallback key management vault. If Electron's `keytar` native keychain fails to load (common in headless/minimal Linux configurations), it defaults to encrypting credentials locally using AES-256-CBC and a machine-derived key signature.
*   **Global Corporate Proxy SSL Bypass**: Sets `NODE_TLS_REJECT_UNAUTHORIZED = "0"` at startup to globally bypass SSL handshake certificate errors (such as `unable to get local issuer certificate` and `ECONNRESET`), ensuring out-of-the-box compatibility with corporate intercepting firewalls.
*   **Responsive Viewport Grid & Activity Pill**: Refactored the UI loader into a floating, non-blocking notification pill. Combined this with `min-height: 0` layout grid constraints on the main workspace wrapper to prevent developer trace content from pushing composer tools off-screen, maintaining perfect viewport responsiveness.
*   **GitHub Actions CI Pipeline**: Configured a Node.js workflow `.github/workflows/test.yml` running headless unit tests (`npm test`) on Node v22 for every push and PR merge target to `main`, validating host profile matching, key encryption, session database, and memory tool logic.