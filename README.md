# Pennyworth

Pennyworth is a Linux-first Electron desktop assistant with Ollama, OpenAI and
Gemini chat, approved system tools, screenshots, voice input and local history.
**This is a development build, not a production release or security certification.**
Windows/macOS packaging configurations exist, but full system control on those
platforms is outside the current release scope.

[Quick start](#run-locally-on-linux) · [Features](#features) · [Roadmap](#product-direction-and-improvement-roadmap) · [Evaluation plan](#planned-provider-and-product-evaluation) · [Validation](#validation-and-performance)

## Project status

Active development targets Linux. Voice reliability, automatic conversation titles,
paginated history and agent recovery are implemented. Setup feedback, installed-app
validation and release distribution remain in progress or planned. Implementation
and automated test results do not establish production readiness.

See the [Linux release plan](docs/LINUX-RELEASE-PLAN.md) for branch-level progress and
[execution safety documentation](docs/EXECUTION-SAFETY.md) for supported execution
boundaries and release gates.

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
  eight eligible messages: completed exchanges, incomplete replies and saved
  cancellation reports. Cancellation reports keep prior side effects visible to
  the model on continuation; failed/cancelled user prompts are excluded. Older
  display pages do not expand model context. Token budgeting remains future work.

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

## Agent recovery and tool limits

The tool-round setting allows 1–50 rounds. A round may contain multiple tool calls.
At the limit, OpenAI, Ollama and Gemini receive one additional request to summarize
collected results with tools disabled. Returned tool calls on that final turn are
ignored. The summary is labelled **incomplete**, includes a limit notice and is
saved with that label. Normal answers do not incur an extra summary request.

Provider requests have per-request timeouts: OpenAI 30 seconds, Gemini 60 seconds,
Ollama 120 seconds (including its web-result synthesis). These are not total-run
deadlines. Timeout, connection, API-access, quota and service errors have actionable
messages. There are no automatic retries of a tool attempt.

If a provider fails after tool execution starts, the app does not fail over and
repeat work. It saves an incomplete report containing the last eight tool attempts
and bounded output excerpts. Empty or tool-only final summaries also use this
report. Tool results distinguish reported success/failure, denial/blocking, and
output whose success has not been verified. These labels describe evidence, not
proof that the overall user objective is complete.

Cancellation stays cancellation, even if a late provider response arrives. If tools
already started, a cancellation report is displayed and saved. Completed effects
are not rolled back; verify their state before asking to continue. Automatic replay
is prevented within the failed run; a later user-requested continuation still needs
model judgment, tool verification and the usual approvals.

OpenAI summary turns use `tool_choice: "none"`, as documented in the
[official API reference](https://developers.openai.com/api/reference/cli/resources/chat).
Provider-limit, cancellation and recovery tests use mocked responses; live provider
and GUI validation remains required for this phase.

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

## Validation and performance

```sh
npm test
node scripts/history-benchmark.js
npm run test:electron                 # use xvfb-run -a on headless Linux
npm run pack -- --linux
npm run dist:linux
```

Current branch validation: **136 tests passed, zero failed, one real sandbox test
skipped**. The history-phase unsigned Linux directory package built successfully, and its
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

## Product direction and improvement roadmap

The intended focus is **evidence-based Linux troubleshooting with understandable
approvals and verifiable results**. Existing foundations include distro context,
fixed diagnostic probes, explicit execution targets, guarded file operations and
recovery reports. Their combination supports this direction; we have not established
superior task completion or security compared with other assistants.

Conversation titles, local models, voice and efficient storage are expected product
capabilities. Our proposed differentiation is completing common Linux maintenance
workflows reliably, with evidence of what changed and whether the fix worked.

The following are improvement ideas, not completed capabilities or release promises:

| Improvement | Intended user benefit | Evidence needed before claiming completion |
| --- | --- | --- |
| Tested Linux repair workflows | Guided help for Steam/gaming, audio, package failures and performance problems | Reproducible tasks with known faults and independently checked outcomes |
| Diagnosis before changes | Recommendations based on the actual machine rather than generic instructions | Correct cause identification; fewer unnecessary commands and unsupported claims |
| Before/after verification | A clear answer to “did the fix work?” | Recorded preconditions, applied changes and task-specific postcondition checks |
| Reversible changes | Recover from an unsuitable configuration change | Tested backups/undo for explicitly supported operations; honest limits for irreversible effects |
| Capability-aware setup | Explain missing tools, permissions and unsupported environments early | First-run tests on supported native Linux and Flatpak installations |
| Better context management | Continue long troubleshooting sessions without losing key evidence | Token-budgeted context and summaries that preserve decisions, approvals and action outcomes |
| Measured privacy controls | Understand what stays local and what is sent to providers | Documented data flows, retention/export controls and tests for sensitive-data handling |
| Published task evaluations | Choose providers and judge releases using repeatable evidence | Versioned fixtures, configurations, results and disclosed limitations |

For example, a future “Run CS2 on Zorin” workflow should inspect the relevant OS,
graphics driver and Steam installation, propose an evidence-based change, obtain
approval, apply it, and verify the outcome. Where supported, it should offer a tested
reversal. The current app has parts of this workflow; it is not yet a validated,
complete repair procedure.

### Related projects

The following projects inform our evaluation plan. Descriptions reflect their
published documentation reviewed on September 7, 2026; they are not hands-on results.

| Project | Relevant overlap | Comparison focus |
| --- | --- | --- |
| [Newelle](https://github.com/qwersyk/Newelle) | Linux desktop assistant with local/cloud models, voice, commands and chat management | Closest desktop-workflow comparison: onboarding, diagnosis and usability |
| [Goose](https://github.com/aaif-goose/goose) | Desktop/CLI agent with multiple providers and MCP extensions | General automation and task completion |
| [Open Interpreter](https://www.openinterpreter.com/docs/terminal/sandbox) | Local execution with sandbox and approval policies | Execution boundaries, approvals and recovery |
| [Warp](https://www.warp.dev/ai) | Natural-language terminal workflows with command approval | Terminal-based troubleshooting and user intervention |
| [AIChat](https://github.com/sigoden/aichat) | Multi-provider shell assistance, sessions, RAG and tools | CLI baseline for OS-aware assistance |

Local execution, approvals and sandboxing already exist in other products. We will
not describe these as unique to Pennyworth or claim a security advantage without
comparative evidence.

## Planned provider and product evaluation

**Status: planned. No live comparative benchmark has been completed.** Existing
mocked provider tests and the synthetic history benchmark measure different things
and must not be presented as proof of real-world superiority.

### Track A — Providers inside Pennyworth

Compare the same Pennyworth version and task fixtures across supported backends.
Provider quality and model quality must be reported separately.

| Provider/runtime | Planned coverage | Integration status |
| --- | --- | --- |
| OpenAI | A lower-cost and a more capable tool-capable model available at test time | Supported |
| Google Gemini | A lower-cost and a more capable tool-capable model available at test time | Supported |
| Ollama | At least two locally runnable tool-capable models, covering different sizes | Supported; record model digest, quantization and hardware |
| Anthropic Claude | Potential additional provider comparison | Future integration; not currently supported directly |
| OpenRouter / other compatible services | Potential additional model access | Future integration; compatibility must be implemented and verified first |

Record exact model identifiers, versions/digests where available, test date,
parameters, context/tool limits and provider account constraints. Do not label a
configuration simply “latest.” Treat model refusals, tool-schema incompatibility,
timeouts and quota failures as explicit outcomes.

### Track B — Pennyworth against other assistants

Use Newelle, Goose, Open Interpreter, Warp and AIChat where the chosen versions can
perform the task on the test platform. Run two separately labelled comparisons:

1. **Matched-model comparison:** same model and task, comparable budgets and
   permissions, to assess the application/tooling contribution.
2. **Default-product comparison:** each product's documented recommended setup,
   to assess the experience users actually receive. Disclose model, cost and
   capability differences; do not combine these results with matched-model scores.

A missing feature is recorded as unsupported. Installation failures, environmental
blocks and product failures must be distinguished rather than silently excluded.
Security conclusions require inspection and testing, not inference from feature lists.

### Initial test suite and method

Start with at least 20 versioned scenarios and three independent runs per eligible
configuration. Publish counts and variability; three runs are an initial sample,
not sufficient evidence for broad reliability claims.

- **Diagnosis:** seeded package, service, audio and resource-pressure problems,
  including healthy machines where no change is required.
- **Changes and verification:** approved configuration changes, failed commands,
  recovery after partial work and supported rollback procedures.
- **Execution controls:** denied approvals, unavailable sandboxes, misleading tool
  output, prompt injection in retrieved content and cancellation during execution.
- **Provider failures:** invalid credentials, rate limits, connection loss, empty
  responses and exhausted tool budgets; verify that prior actions are not replayed.
- **Desktop reliability:** new chats, automatic/manual titles, long histories,
  restart persistence, screenshots and voice where supported.

Use disposable Linux installations or snapshots with synthetic data and known
starting states. Begin with pinned Zorin/Ubuntu, Fedora and an Arch-family image;
record exact versions, desktop/session type and native versus Flatpak execution.
Use dedicated native hardware for GPU/gaming checks, since VM results do not establish
real gaming compatibility. Never use a personal workstation as a destructive fixture.

Reset the environment for each run, reuse equivalent task prompts and approval
rules, and randomize run order where practical. Freeze tool definitions, retrieved
documents and starting context for Track A. Log product-specific differences for
Track B. Set and disclose time, token and spending budgets before running paid APIs.
Use synthetic prompts, redact credentials and publish only reviewable test artifacts.

### Metrics and reporting

| Metric | Measurement |
| --- | --- |
| Verified task success | Independent postcondition checks, not the assistant's claim |
| Diagnostic accuracy | Correct cause identification against seeded ground truth |
| Unnecessary or unauthorized changes | Files/settings changed outside the required and approved scope |
| Recovery quality | Repeated side effects, preserved evidence and successful supported rollback |
| Human effort | Approval count, manual commands and interventions required |
| Responsiveness | Time to useful feedback, total completion time, median and p95 latency |
| Resource/cost | Token usage, API charges including title requests, peak memory and local hardware use |
| Outcome honesty | False success claims and correct incomplete/failed/cancelled reporting |

Publish task-level results alongside aggregates, exact configurations, sanitized
traces, observed failures and a reproduction guide. Include sample counts and
uncertainty; avoid a single score that hides safety or compatibility failures.
Any observed unauthorized write, credential disclosure or automatic replay of a
side-effecting action blocks release until fixed and retested. Zero observed failures
in a finite suite is not a security certification.

Proposed sequence: define fixtures and acceptance checks, run the three supported
backends, compare products, then use the results to prioritize repair workflows and
release fixes. Additional providers remain a separate implementation decision.

## Remaining release work

- Native Linux and real Flatpak tests for approvals, execution boundaries, desktop
  sessions, cancellation, first-run setup and installed-package behavior.
- Live-provider and installed-UI verification of tool-limit summaries and recovery
  reports, including slow local models.
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
- `src/core/providers.js`, `agent-recovery.js`, `conversation-title.js`: chat, recovery
  reports and background naming.
- `src/core/execution-runner.js`, `safe-path.js`, `tools/`: execution and file controls.
- `src/renderer/chat.js`, `settings.js`, `app.js`: conversation UI, settings and startup.
- `src/tests/`: automated regression checks; `scripts/electron-smoke.js`: GUI smoke.
- `config/distros.json`, `data/docs/`: distro profiles and retrieved documentation.
