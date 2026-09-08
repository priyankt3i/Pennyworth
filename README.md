# Pennyworth

Pennyworth is a Linux-first Electron desktop assistant with Ollama, OpenAI and
Gemini chat, approved system tools, screenshots, voice input and local history.
**This is a development build, not a production release or security certification.**
Windows/macOS packaging configurations exist, but full system control on those
platforms is outside the current release scope.

## Current development state

The Linux work is proceeding in focused branches. See the
[phase plan](docs/LINUX-RELEASE-PLAN.md) and
[execution safety and release gates](docs/EXECUTION-SAFETY.md).

| Phase | Branch | Implementation state |
| --- | --- | --- |
| Voice reliability | `fix/linux-voice-reliability` | Separate loading/inference deadlines, bounded queue, worker recovery and status feedback |
| Conversation naming | `feat/linux-conversation-titles` | Background LLM titles and manual SVG rename control |
| History performance and persistence | `fix/linux-conversation-history` | Worker-backed SQLite, paginated lists/messages, transactional saves and JSON migration |
| Agent recovery | `fix/linux-agent-recovery` (planned) | Consistent tool-limit responses and provider failure handling |
| Setup feedback | `fix/linux-setup-feedback` (planned) | Clear capability/dependency availability before tool use |
| Linux release validation | `fix/linux-release-validation` (planned) | Installed-app checks, security validation and distribution preparation |

These describe the code in this checkout, not deployment or merge status. Update
this README and the phase plan when a phase changes behavior or validation status.

## Features

- Tray access, click to summon, `Ctrl+Shift+Space`, and close-to-tray window controls.
- Provider/model selection, connection checks, encrypted API credentials and custom
  CA support in the provider clients. Screenshots require a vision-capable model.
- Shared tool definitions for Ollama, OpenAI and Gemini; configurable tool rounds
  (1–50), concise response mode and a developer trace panel with copy/clear controls.
- Explicit Linux sandbox/host execution targets, native approvals, file protections,
  cancellation and fixed diagnostic probes. Provider failover stops after a tool
  attempt to avoid repeating side effects.
- Host/distro detection, local documentation retrieval and persistent fact tools.
  A distro profile is context, not proof that every action works on that distro.
- Light/dark themes, Markdown replies and visible error notifications.

## Conversations

### Automatic names and manual rename

After a successful reply, a background request asks the answering provider to name
an untitled conversation using up to 2,000 characters of its first query. This is
an additional LLM request and may incur provider charges. Existing untitled chats
are named when opened, using their saved provider or the current provider if none
was recorded. Title failures leave the conversation usable and retry on a later
open/reply. No system tools are available to the title request.

For example, “how do we make cs2 run on zorin?” can become “Running CS2 on Zorin OS.”
The exact wording is model-generated. Hover over a sidebar row or focus its controls
with the keyboard to reveal matching SVG pencil/trash icons. Use the pencil to
rename, Enter to save and Escape to cancel. Manual titles always take precedence.

### Loading and saving

- The sidebar fetches 50 metadata records at a time. **Load more conversations**
  fetches the next page without reading complete transcripts.
- Opening a conversation loads its latest 50 messages. **Load older messages**
  prepends another page while preserving scroll position. Explicitly loading more
  pages expands the rendered history; this is pagination, not full virtualization.
- SQLite runs in a dedicated worker. Indexed queries and disk operations do not
  run in Electron's main process. Replies update the affected sidebar entry.
- User queries are committed before provider execution. Successful replies and
  request status are committed together. Failed/cancelled queries remain visible;
  unfinished requests become `interrupted` after restart.
- Save failures are surfaced. If a reply cannot be saved, it remains displayed
  with a warning so it can be copied before closing the app.
- Model context is separate from displayed history: the backend supplies the last
  eight completed messages. Older pages and failed prompts are not automatically
  added to model context. Token-budgeted context/summarization remains future work.

### Storage, migration and recovery

History lives under Electron's `app.getPath("userData")`:

```text
history/conversations.sqlite       # current conversations and messages
history/conversations.sqlite-wal   # may exist while the app is running
history/conversations.sqlite-shm   # may exist while the app is running
sessions/*.json                    # retained legacy history, if present
```

On Linux, `userData` is normally beneath `$XDG_CONFIG_HOME` or `~/.config`, in the
application's directory; development and packaged app names can differ.

First access imports valid legacy JSON files in the worker. Each file is imported
in a transaction and recorded so restarts do not duplicate it or resurrect a
conversation deleted after import. Originals remain unchanged. Malformed, linked
or oversized files are skipped with a notification; the import limit is 10 MB per
legacy file. Fixing a skipped file and restarting retries its import. New messages
are limited to 1 MB each.

**Back up before upgrading:** fully quit Pennyworth, then copy the entire `userData`
directory, including any SQLite sidecars. Do not copy just the database while the
app is running. To restore, quit the app and restore the complete backup. If the
database cannot be opened, the app reports an error rather than resetting history.
Import error filenames/details are returned by the history-list IPC response;
retained JSON files can be inspected to repair failed imports.

History is local plaintext protected by filesystem permissions, not encrypted by
the credential vault. Legacy backups also contain conversation text. Deleting an
imported chat removes the active database records but does not erase its retained
JSON backup or securely erase disk blocks. Older app versions do not see messages
written only to SQLite; keep a backup and avoid using old/new versions concurrently.

## Voice input

Local Whisper is the default. It runs quantized CPU inference in a worker and
requires an initial model download; cached inference can work offline. Model
loading has a five-minute deadline and inference a separate two-minute deadline.
At most two requests wait behind the active request. Timeouts terminate the worker,
and a later request can create a replacement.

The UI reports model preparation, transcription, completion and failure. Settings
also expose OpenAI, Gemini, Groq and automatic transcription choices. Cloud routing,
real microphone behavior, slow CPUs and packaged inference still need end-to-end
validation. Voice is input-only; text-to-speech is not implemented.

## Run locally on Linux

Use Node 22.13 or newer (Node 24 recommended). History uses built-in `node:sqlite`;
the installed Electron runtime was checked for support.

```sh
npm ci --legacy-peer-deps
npm run init:config
npm run dev
```

The development command includes `--no-sandbox` for Electron compatibility. Normal
startup (`npm start`) and packaged builds retain Electron sandboxing and require a
working system sandbox configuration. This is separate from the Bubblewrap sandbox
used by command tools. Do not distribute a build with Electron sandboxing disabled.

Configure the provider in Settings:

- **Ollama:** running service, endpoint (default `http://127.0.0.1:11434`) and a
  downloaded model. The setup flow may request approval to start the Linux service;
  it does not execute downloaded shell installers.
- **OpenAI:** API key and model; default `gpt-4o-mini`.
- **Gemini:** API key and model; default `gemini-2.5-flash`.

Keys use Electron safeStorage when a secure backend is available, otherwise the
passphrase vault. Linux `basic_text` is rejected. This does not encrypt chat history.

Optional local documentation ingestion:

```sh
npm run crawl:docs -- cachyos 50
```

## Validation and performance

```sh
npm test
node scripts/history-benchmark.js
npm run test:electron                 # use xvfb-run -a on headless Linux
npm run pack -- --linux
npm run dist:linux
```

Current branch validation: **102 tests passed, zero failed, one real sandbox test
skipped**. The unsigned Linux directory package built successfully, and its
packaged SQLite worker created a conversation using isolated temporary data.

The synthetic history benchmark creates and deletes its own temporary fixtures;
it never opens your actual history. On this workspace, with 1,000 conversations,
109,900 messages and one 10,000-message chat:

| Operation | Measured time |
| --- | --- |
| One legacy full-transcript scan | 149 ms |
| Initial worker startup + import | 1.53 s |
| Fetch 50 sidebar entries | 0.40 ms median / 1.13 ms p95 |
| Fetch latest 50 messages of the long chat | 0.52 ms median / 1.36 ms p95 |

These are synthetic, warm storage-plus-worker timings, not guarantees of UI latency.
The benchmark reports results for your hardware. Renderer tests check page batching
and stale-response isolation; storage tests cover migration, pagination, title
precedence, failure states, restart recovery and transaction rollback.

The sandboxed Electron GUI smoke is blocked locally by a misconfigured SUID sandbox
helper. History storage/worker tests pass under Electron's actual Node runtime.
The GUI smoke includes sidebar/message pagination and renaming checks for CI; an
unexecuted GUI check is not a passing GUI check. Real Bubblewrap isolation also
remains unavailable in this workspace. See the phase plan for the latest suite count.

CI is configured for tests and unsigned directory packages on Linux/macOS/Windows,
plus a Linux job requiring real Bubblewrap isolation and an Xvfb renderer smoke.
Cross-platform jobs are compatibility checks, not a claim of full product support.

## Remaining release work

- Native Linux and real Flatpak tests for approvals, execution boundaries, desktop
  sessions, cancellation, first-run setup and installed-package behavior.
- More consistent OpenAI/Ollama handling when tool limits are reached.
- Dependency/capability feedback, voice end-to-end checks, and broader upgrade and
  credential recovery validation.
- Independent security review, distribution/signing decisions, and tested update
  and rollback delivery. No production security certification is claimed.
- Windows/macOS command execution and non-Linux direct writes are disabled; full
  parity remains outside this Linux release.

## Code map

- `src/main/history.js`, `history-worker.js`, `history-database.js`: async history
  bridge, worker and SQLite storage/migration.
- `src/main/ipc-handlers.js`, `ipc-security.js`: guarded application operations.
- `src/main/local-whisper.js`, `whisper-worker.js`: local speech lifecycle/inference.
- `src/core/providers.js`, `conversation-title.js`: chat and background naming.
- `src/core/execution-runner.js`, `safe-path.js`, `tools/`: execution and file controls.
- `src/renderer/chat.js`, `settings.js`, `app.js`: conversation UI, settings and startup.
- `src/tests/`: automated regression checks; `scripts/electron-smoke.js`: GUI smoke.
- `config/distros.json`, `data/docs/`: distro profiles and retrieved documentation.
