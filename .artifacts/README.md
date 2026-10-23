# Babel Harnesses

This folder contains historical sweep and capture scripts.

Current harnesses:

- `capture_flavor_mixed10.cjs`
  UI warm-up covering Canopy, Derivation Replay, and Notes on the local app.

Current topology:

- Live UI/API harnesses should default to `http://127.0.0.1:5177`
- Browser harnesses require Playwright. Set `BABEL_CHROME_BIN` only when using a specific local Chrome/Chromium executable.
- Provider generations for qualification go through `npm run qualification:codex` and `npm run qualification:anthropic` (see `AGENTS.md`).

The harnesses that called the removed `modelRoute` routes (Gemini, and the
GPT and Claude routes with server-default models) were deleted with those
routes; they remain in Git history. Historical, stale, costly, or one-off
harnesses live outside the current harness surface. The old 100-tree
dual-route gauntlet is historical evidence for published research, not a
current runnable default; its local-only working copy belongs under
`.local-tests/legacy-harnesses/`.
