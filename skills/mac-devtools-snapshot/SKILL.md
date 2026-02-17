---
name: mac-devtools-snapshot
description: Capture and inspect macOS browser DevTools from Codex using repeatable screenshots. Use when the user asks you to see, debug, verify, or review what appears in DevTools (Console, Network, Elements, Application, Sources, Performance), especially on local apps.
---

# Mac DevTools Snapshot

Use this skill to inspect browser DevTools on macOS through screenshots.

## Scope

- Capture snapshots of DevTools and review them with `view_image`.
- Work with Chrome, Edge, Brave, Arc, or Safari.
- Use repeated snapshots for step-by-step debugging.

## Limits

- Do not claim live visual streaming.
- Capture and inspect in snapshots.
- Ask for user confirmation before actions that need OS permissions or GUI control.

## Workflow

1. Confirm target browser and DevTools pane (`Console`, `Network`, etc.).
2. Ensure macOS permissions are ready by running:
   - `bash /Users/francisronge/.codex/skills/screenshot/scripts/ensure_macos_permissions.sh`
3. Capture a screenshot using the helper script:
   - `bash scripts/capture_devtools_snapshot.sh "Google Chrome"`
   - Optional second arg for output path.
4. Inspect the image with `view_image` using the absolute output path.
5. Report findings with concrete evidence (errors, status codes, failing requests, stack traces).
6. Repeat snapshot capture after each requested user action.

## Commands

- Capture default output:
  - `bash scripts/capture_devtools_snapshot.sh "Google Chrome"`
- Capture to custom path:
  - `bash scripts/capture_devtools_snapshot.sh "Google Chrome" "/tmp/devtools-after-refresh.png"`

## Browser Notes

- Shortcut reference: see `references/browser-shortcuts.md`.
- If DevTools is hidden, ask the user to open it or use the browser shortcut.
