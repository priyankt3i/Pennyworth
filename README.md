# Pennyworth

Pennyworth is a cross-platform desktop AI assistant (Electron) designed to feel like a true system copilot: always available from the tray, context-aware about the host, and capable of using tools (web, weather, date/time, local docs) to answer real troubleshooting questions.

## Vision

Original goal: build a Batman-style butler for Linux power users (starting with Arch/CachyOS), then expand to broader distro families and eventually support full Windows/macOS/Linux parity with strong auto-detection and minimal manual setup.

Current state: the prototype already runs cross-platform and includes the core agent/tooling loop, but still needs full duplex voice, richer screen/terminal awareness, and guarded action execution to become a true "copilot on steroids."

## Current Progress (Implemented)

- Electron desktop shell with:
  - tray icon + double-click summon
  - global shortcut: `Ctrl+Shift+Space`
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
  - provider failover routing
  - provider health checks in settings
  - API key entry in settings (saved via `keytar` when available)
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
  - screenshot capture + region selection attachment
  - speech-to-text input (browser speech recognition)
  - markdown chat rendering
  - developer trace panel for provider/tool execution visibility
  - failure messages surfaced in UI instead of silent errors

## Current Limits

- Voice is input-only right now (no real two-way voice conversation with TTS playback).
- Screen context is capture-on-demand, not continuous live screen share.
- No terminal streaming parser yet (user still pastes errors manually in most flows).
- RAG is lexical retrieval, not embeddings/vector search yet.
- No safe action-execution engine yet (assistant advises; it does not automatically run privileged system actions).

## Roadmap Toward "True Copilot"

### Phase 1: Stabilize Core Agent (Now)

1. Harden provider/tool error handling and trace visibility.
2. Add stronger docs ingestion + chunking quality for distro knowledge.
3. Improve cross-platform packaging reliability and first-run diagnostics.

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
- `src/core/rag.js`: local docs retrieval
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
