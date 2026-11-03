# Babel Harnesses

This folder holds research harness helpers. Nothing in the app imports them.

- `helpers/loadPlaywright.cjs` loads Playwright's Chromium for browser
  harnesses (`scripts/verifyRelationOrchard.cjs` and the research scripts under
  `docs/research/data/`). Set `BABEL_CHROME_BIN` only when using a specific
  local Chrome/Chromium executable.
- `helpers/surfaceTokens.cjs` is an older CommonJS surface tokenizer kept for
  research scripts; no current script imports it.

Current topology:

- Live UI/API harnesses should default to `http://127.0.0.1:5177`
- Provider generations for qualification go through `npm run qualification:codex` and `npm run qualification:anthropic` (see `AGENTS.md`).

The harnesses that called the removed `modelRoute` routes (Gemini, and the
GPT and Claude routes with server-default models) were deleted with those
routes, as was the `capture_flavor_mixed10.cjs` UI warm-up once its selectors,
the Replay panel and the `derivationSteps` and `resolvedVisualRelations` fields
it read no longer existed; they remain in Git history. Historical, stale,
costly, or one-off harnesses live outside the current harness surface. The old
100-tree dual-route gauntlet is historical evidence for published research,
not a current runnable default; its local-only working copy belongs under
`.local-tests/legacy-harnesses/`.
