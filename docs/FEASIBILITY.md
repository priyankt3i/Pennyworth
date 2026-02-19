# Feasibility: Pennyworth (Linux Agentic Assistant)

## Verdict

Yes, this is feasible. A Linux-first MVP is practical today with Electron/Tauri + configurable LLM backends + local docs ingestion. The hardest engineering risk is reliable screen capture/overlay behavior across Wayland/X11 variants.

## Core capabilities and feasibility

- Tray-resident assistant: high feasibility
- Global summon shortcut: high feasibility
- Per-distro expert behavior: high feasibility (config + prompts + doc packs)
- Context-aware guidance from system state: high feasibility
- Local/cloud LLM switching: high feasibility
- Screen region capture + analysis: medium feasibility (Wayland restrictions vary)
- Fully autonomous repair actions: medium feasibility (needs strict safety model)

## Recommended architecture

- Desktop shell: Electron prototype, Tauri for performance-focused later builds
- AI router: unified adapter (`ollama`, `openai`, `gemini`)
- Context engine:
  - Live system facts (`/etc/os-release`, `uname`, package manager checks)
  - Session telemetry (last commands, error snippets, UI screenshot)
- Knowledge layer:
  - Distro doc registry (`distros.json`)
  - Offline doc mirror + chunk index
  - Retrieval + source citation
- Action layer:
  - Suggest commands by default
  - Optional guarded execution with confirmations and rollback hints

## Dependency stack (prototype)

- `electron`
- `axios`
- `dotenv`
- `electron-store`
- `screenshot-desktop`
- `cheerio`

## Security model to add before broad release

- Clear permission tiers: observe, suggest, execute
- Per-command consent and risk labels
- Redaction for sensitive terminal/output content
- Local encrypted store for API keys/secrets
- Audit log of actions and generated commands

## Expansion path to multi-distro

1. Add distro profiles to `config/distros.json`
2. Crawl and ingest official docs into `data/docs/<profile>`
3. Add distro-specific command recipes/tests
4. Validate command guidance via integration test matrix in containers/VMs

## Theme and product positioning

- Assistant persona: calm, precise, dry wit (Alfred/Pennyworth style)
- UX principle: one-click summon, low clutter, high trust
- Primary value: instant, context-correct guidance when user is blocked
