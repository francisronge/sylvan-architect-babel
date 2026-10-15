---
name: verify-babel
description: Verify changes to Babel's Replay, renderer, parser contract, application flows or review tooling with its maintained offline and browser commands, retaining exact evidence and coverage limits.
---

# Verify Babel

Read the repository's AGENTS.md for behavior contracts and the verification
command map. This skill routes verification; it does not define another contract
or roadmap.

## Launch and Doctor

Run `npm run verify:doctor` to check Node 24, installed lock versions, required
browser ownership, corpus inputs and Chromium/WebKit availability. Doctor starts
no server and proves prerequisites only. Repair its concrete failures before
running the affected gate. Use the project's existing locked dependencies.

Browser tests start isolated local servers and disposable contexts themselves.
For manual app inspection, reuse a suitable existing server or retain the session
ID of one you start. Artifact capture needs an already running loopback app. Never
use the user's browser-local Tree Bank for test seeding. Provider execution is a
separate task; these verification commands do not require fresh parses.

## Drive the affected workflow

Use the AGENTS.md verification command map, selecting by the changed mechanism:

- Shared Replay or layout: the maintained corpus comparator against an explicit
  baseline, including both movement and ordinary construction controls. Add a
  private archive manifest when broader saved-record comparison is relevant.
- Relation painting: the focused native renderer gate and the complete browser
  gate, which covers persistence, zoom/Fit, recipes and application integration.
- Application state, errors or storage: the complete browser gate. A fixture
  setter does not prove the real save/reopen or failure-recovery user path.
- Review pages, image presentation or engine compatibility: the bounded
  Chromium/WebKit gate. Inspect the first usable viewport in the in-app browser
  for relevant UI changes; decoded assets alone do not prove visible content.
- Renderer preparation or runtime-building changes: the paired performance
  command with installed baseline dependencies. Keep the existing opening budget;
  complete-preparation measurements are separately reported.

Use `npm run verify:all` as the broad completion gate. Do not silently omit a
required browser file or accept skipped coverage. Subagents follow the repository's
server/browser restrictions; the primary agent performs the integrated visual pass.

## Evidence

Retain named receipts and failed captures outside the worktree. The browser runner
records its executed denominator; the corpus comparator records exact inputs,
source identities and exceptions; capture records actual painted/camera frames
and raw payloads. Include those paths when reporting results.

Prove a new guard catches the old defect or a controlled bad result. Keep useful
positive and unrelated controls. Distinguish parser warnings from fatal failures,
offline geometry from native painting, and a prerequisite check from a user-flow
check. Report unverified coverage rather than extrapolating from passing counts.

## Cleanup

Await owned browser/context and server shutdown on success and failure. Confirm
owned shell sessions exited. Preserve user-owned processes, storage and existing
dirty work. Update the existing roadmap or canonical docs only where the changed
workflow needs it; keep run-specific evidence outside the worktree.
