# Linux release phases

Scope: Linux. Use a separate branch per phase and keep README synchronized with
implemented behavior, validation evidence and remaining limitations. Branches can
build on completed prior work; merge status is tracked in Git, not asserted here.

## Completed implementation — Voice lifecycle

Branch: `fix/linux-voice-reliability`
Separate five-minute loading/two-minute inference deadlines, bounded queue, worker
replacement protection, timeout termination and user-facing status feedback.
Real microphone, slow-CPU and packaged inference checks remain release gates.

## Completed implementation — Conversation titles

Branch: `feat/linux-conversation-titles`
Automatic provider-generated names after a reply and on opening old untitled chats;
manual inline rename with matching SVG pencil/trash controls. Manual names win over
late LLM results. The title request uses a bounded first-query excerpt, no tools.

## Current phase — History performance and persistence

Branch: `fix/linux-conversation-history`

Implemented:
- Indexed SQLite metadata/messages in a dedicated worker using built-in node:sqlite.
- Transactional import of legacy JSON, retained originals and per-file import ledger.
- Cursor pagination: 50 sidebar entries/latest messages, more pages on request.
- Batched message insertion, scroll preservation and stale-page rejection.
- Persist user queries before provider calls; complete/failed/cancelled/interrupted
  states, atomic response commits and visible save warnings.
- Backend-derived recent context, sidebar updates without a transcript rescan, and
  automatic/manual naming through the new store.
- README updated for current scope, migration, backup, privacy and validation.

Validation:
- Full automated suite: 102 passed, zero failed, one real sandbox test skipped.
- Storage tests pass under both installed Node and Electron's actual Node runtime.
- Unsigned Linux directory package built; the worker inside its app archive created
  a conversation successfully using temporary test data.
- Regression tests cover legacy imports, duplicate prevention, pagination, title
  precedence, pending recovery, transaction rollback and renderer page ownership.
- Synthetic 1,000-chat/109,900-message benchmark: initial import 1.53 s; median
  sidebar page 0.40 ms and latest-message page 0.52 ms. Excludes GUI rendering.
- Sandboxed GUI smoke blocked locally by the SUID helper configuration; CI smoke
  now exercises pagination and manual renaming. Real sandbox integration remains
  unavailable locally.

Remaining validation: installed Linux GUI/scroll/focus checks and migration on real
user backups. Pagination is not full virtualization; explicitly loading all older
pages grows DOM usage. Model context remains eight completed messages. JSON backup
retention is intentional and does not provide secure deletion or reverse migration.

## Next — Agent recovery

Proposed branch: `fix/linux-agent-recovery`
Graceful OpenAI/Ollama tool-budget exhaustion and regression coverage for provider
failures/cancellation without repeating side effects.

## Then — Setup and capability feedback

Proposed branch: `fix/linux-setup-feedback`
Explain unavailable execution targets, missing dependencies and provider setup
failures before users encounter them during work.

## Release validation and fixes

Proposed branch: `fix/linux-release-validation`
Verify CI and installed workflows on supported Linux desktops; audit dependencies,
exercise security boundaries, validate upgrades/recovery, and prepare distribution
and update delivery. Fix failures found before claiming production readiness.
