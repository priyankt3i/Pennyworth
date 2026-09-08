# Linux release phases

Scope: Linux. Full Windows/macOS system operations remain outside this release.
Use a separate branch per phase, validate the change, then merge before starting
its dependent phase from updated main.

## Phase 1 — Local speech lifecycle

Branch: `fix/linux-voice-reliability`

Implemented:
- Separate five-minute model loading and two-minute inference deadlines.
- Terminate timed-out workers; ignore stale events from replaced workers.
- Serialize local inference with at most two waiting requests so final audio can
  follow a live chunk. Copy submitted audio and cap each request at two minutes.
- Show model preparation, inference, completion and failure status.
- Check silence before loading the model.

Validation: 83 tests passed, zero failed, one real sandbox test skipped in the
current environment. New tests exercise queueing, audio ownership, deadlines,
worker replacement, termination and startup/send failures.

Still required: real microphone checks, first download and offline cached loading,
slow-CPU inference, rapid stop/start recordings, and packaged Linux launch.
This phase does not certify the full voice flow or change cloud routing.

## Phase 2 — Agent recovery

Proposed branch: `fix/linux-agent-recovery`
Graceful OpenAI/Ollama tool-budget exhaustion, clear incomplete-work responses,
and regression coverage for cancellation and provider failures without repeating
side effects.

## Phase 3 — Setup and capability feedback

Proposed branch: `fix/linux-setup-feedback`
Explain unavailable sandbox/host targets, missing dependencies and provider setup
failures before users encounter them during work.

## Phase 4 — Installed-app validation and release fixes

Proposed branch: `fix/linux-release-validation`
Verify Linux CI and installed workflows, audit dependencies, exercise approvals
and security boundaries on supported desktops, validate data migrations and
recovery, and fix failures found. Prepare distribution and update instructions.
Do not call the release production-ready until these gates have evidence.
