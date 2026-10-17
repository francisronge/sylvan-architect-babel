# Sylvan Architect Babel

## What Babel is

Babel is an AI-powered environment for generating and studying syntax. Frontier models author derivations for an input sentence; Babel validates those records, derives their final structures and Replay, and draws them as interactive D3 trees and relation graphics. It is both a syntax-learning tool and a research surface for examining the syntactic and broader language capabilities of current frontier models.

Use Node 24.x and ESM. Replay tests import `.ts` modules through Node's built-in type stripping.

## Glossary

- **Parse / analysis**: one complete model-generated analysis of an input.
- **Derivation stage**: one completed model-authored syntactic state.
- **Workspace forest**: every current syntax object at that stage; it may contain one tree or several separate workspaces.
- **Stage Record**: the model-authored explanation of what a derivation stage establishes.
- **Replay**: deterministic playback compiled from the authored derivation stages.
- **Replay step**: one displayed frame within Replay.
- **Structural micro-step**: a renderer-derived selection, projection, or merge step; models do not author these.
- **Relation moment**: the Replay step where one authored relation becomes active.
- **Canopy**: the clean final-tree view.
- **Relation tiers**: Tier 1 is an exact curated relation, Tier 2 structurally recovers known visual primitives, and Tier 3 is the neutral fallback.
- **Personal Tree Bank**: the user's browser-local saved work.

## Commands

- `npm run dev` — start the Vite development runtime.
- `npm start` — start the Express runtime and provider routes.
- `npm run build` — bundle the frontend; this does not typecheck and is not a completion gate.
- `npm run verify:all` — run typecheck plus the complete offline verification path. Use this as the default completion gate.

## Commits and PRs

- Use conventional commit titles in plain language, such as `fix(renderer): keep verdict labels attached during zoom`.
- Commit bodies briefly state the problem, then the fix. Record the model and harness used when known; never guess.
- Keep each PR to one independently shippable concern. Its tests and documentation belong with it.
- UI changes need before-and-after images. Motion, Replay, or camera changes need a short recording.
- Keep PR-only evidence outside the worktree and upload it to the PR; never commit it.

## Plans and documentation

- `ROADMAP.md` is Babel's current single active roadmap.
- `README.md` describes Babel for users. Keep agent workflows, verification instructions and source ownership in `AGENTS.md` or their canonical technical documentation.
- Do not commit temporary plans, agent scratch, review transcripts, raw working output, or implementation diaries.
- Keep temporary working material outside the worktree, normally in `/tmp`.
- Put durable architecture, product constraints, and decisions in the appropriate canonical documentation.
- Update existing canonical documentation instead of creating duplicate plans or dated completion reports.
- `docs/research/` is for intentional Babel research, not agent working notes.

## Canonical ownership

- `App.tsx` owns the current analysis and view selection. `hooks/useGeneration.ts` and `services/generationState.ts` own request progress; `services/parseService.ts` owns the browser HTTP call. `hooks/useTreeBank.ts` owns save/open lifecycle.
- `services/treeBankRecords.ts` and `services/treeBankStore.ts` own immutable local records and atomic saves. `services/treeSnapshot.ts` and `services/milesNotation.ts` own snapshots and bracket serialization.
- `components/AsyncTreeVisualizer.tsx` owns preparation and view recovery. `components/ReplayPanel.tsx` owns controls and detail presentation. `components/FailurePanel.tsx` preserves failure diagnostics and downloads; view retries must retain the analysis without a provider request.
- `server/babelParser/systemInstruction.js` and `server/babelParser/prompts.js` define the model-facing prompt contract.
- `server/babelParser/routeConfig.js`, `modelRuntime.js`, and `parseRoutes.js` own provider configuration and transport behavior.
- `server/babelParser/parseNormalization.js` and `derivationCompiler.js` own parser normalization and derived structures.
- `replay/` owns React-free replay construction and replay fixture projection. Its modules must remain importable in Node and must not import React or components. `replayCompiler.ts` orchestrates stage preparation, construction and relation scheduling. `replay/relations/renderPlan.ts` owns the compiled relation contract; `relationFrame.ts` selects each frame's marks. Geometry consumes that contract without importing its compiler.
- `components/TreeVisualizer.tsx` owns React renderer state and view lifecycle. `components/renderer/` owns D3 frame painting, camera behavior, and rendered-geometry refinement. Keep pure replay construction in `replay/`.
- `types.ts` mirrors the browser-visible parse contract.
- `fixtures/` and `tests/` are the committed provider-free verification surface.

## Comments

- Comments explain how an abstraction is used, its contract, or a non-obvious invariant.
- Keep comments with the code they describe and update them when that code changes.
- Do not narrate ordinary lines or annotate self-explanatory behavior.

## Derivation contract

- `derivationStages` is the sole model-authored derivation source. Every stage requires `statement`, `stageRecord`, `relations`, and `workspaceForest`; optional `realizations` groups associate current syntax occurrence IDs with exact input-token positions. No other stage fields are allowed.
- Final trees, surface order, relation render plans, Replay steps, and stage explanations are derived from those stages. Do not reintroduce parallel authored ledgers, growth frames, commitment graphs, or compatibility aliases.
- Derivation stages are completed syntactic states, not display frames.
- `relations` uses an open ontology. Keep model-facing relation and anchor names open; finite classifications belong in derived renderer logic.
- Models return the contract as plain-text JSON. No provider JSON mode or response schema is used, so every provider answers under the same conditions; strict schemas cannot express open relation and anchor names.
- When final pronounced words independently match the complete input, normalization may omit a demonstrably mismatched optional `tokenIndex` and validate again. Record each omission in `provenance.tokenIndexCorrections` without a user-facing warning; preserve the original response. This recovery does not change syntax, words, silence or relations, and excludes pronunciation groups, ambiguous repeated-word addresses and malformed ownership.

## Product boundaries

- Personal Tree Bank is browser-local. Server-side parse storage is separate product work and must not be introduced as a Tree Bank side effect.
- Provider endpoints and outgoing request payloads are contracts. Change them only when a task explicitly targets that contract, and verify every affected provider.
- Prompt, system-instruction, and route-config changes alter contract-test conditions. Treat them as contract changes and record their exact versions in generation provenance.

## Replay and renderer safety

- Treat `docs/design/visual-relations-renderer-closeout-2026-08-25.md` and `docs/design/visual-relations-tier2-shape-dispatch-spec.md` as behavior contracts. Reopen the renderer only for a reproducible defect; run focused tests and captures plus `npm run verify:all`.
- Replay derives its finer steps from differences between completed derivation stages.
- Ordinary structural micro-steps build forward: selection precedes projection, and a parent appears only when its children are available for merge. Do not reveal a parent or descendant before its own step.
- Before movement, the source retains its preceding authored form and pronunciation. The movement moment atomically introduces the complete landing, the authored lower occurrence, trajectory, and any smallest new parent needed to attach the landing above an existing subtree. Movement recognition does not require or infer silence; pronunciation may be determined separately by the model.
- Separate authored relations receive separate moments in authored order. One relation containing multiple anchors remains one simultaneous moment.
- Relation marks appear only at their owning relation moment and then follow their defined persistence.
- Use one camera fit across the micro-steps derived from one authored stage. Existing syntax must not jitter or teleport. Invisible future-layout scaffolding may reserve space but must never become visible, subdivide a current branch, or change current syntax.
- Tier 1 and Tier 2 use the same primitives and pixels; Tier 3 remains neutral. Assign a tier per recovered claim. Tier 2 must not repair a malformed exact Tier-1 claim, but independent sibling claims may survive.
- Bind every mark to its owning claim and exact authored anchor. Keep inseparable pieces in one SVG coordinate group; never attach one by searching for the first similar mark or recompute their relative position from screen space during zoom. Zoom, pan, and fitting must preserve their internal spacing.
- Use the shared emerald neutral style and shared stage, hover, and lens emphasis. Do not add permanent relation-specific glow. Hover must not change geometry, stroke width, opacity, or layout.
- Do not change shared camera fitting, tree layout, or wrappers to repair one fixture. A shared change requires the same defect across representative desktop, mobile, Replay, and zoom cases.

## Verification and safety

- Use `npm run qualification:codex` for OpenAI qualification generations with the user's Codex OAuth. Never substitute API-key requests or a paid fallback without explicit user authorization.
- Use `npm run qualification:anthropic` for Anthropic qualification generations. Its API key comes from the macOS Keychain item `Babel Anthropic API`, whose Console organization receives the Max plan's API credits. Never use another key or organization without explicit user authorization.
- During implementation, run the smallest focused test proving the changed behavior.
- Keep heavy gates sequential. Offline tests run two files at a time; the browser gate runs specs serially and limits esbuild CPU parallelism to two. Close unneeded visible test browsers.
- Renderer startup has a PR performance budget. For renderer, layout, worker, or font changes, run `npm run verify:renderer-performance -- --baseline-root /path/to/base-checkout` with installed locked dependencies in both checkouts. A slowdown must be investigated and fixed before sign-off; do not weaken the fixture, timing boundary, or budget to make it pass. Intentional budget changes require explicit user approval.
- Behavior changes require focused regression tests.
- For relation drawing changes, run `npm run verify:renderer-browser` to check native endpoint attachment, persistence, zoom/Fit and narrow viewports. Keep this browser gate separate from the offline suite.
- Run `npm run verify:all` once before completing broad, shared, contract, fixture, or release work. Documentation-only changes do not require it.
- Wait for a real completion signal: a receipt or event, successful process exit, listening server, or rendered UI state.
- Do not treat elapsed time as proof. Bounded polling may observe a real condition when no event API exists.
- For screenshots only, a brief settle after confirmed readiness is acceptable.
- Subagents must not start their own development servers or browsers.
- The primary agent performs at most one integrated visual pass after relevant UI work is assembled.
- `test/` is gitignored; add executable tests under `tests/` as `*.test.mjs`.
- A diff in `fixtures/normalized/` or `fixtures/replay-snapshots/` is a behavior change. Review it; never accept blind regeneration.
- `.artifacts/` and `docs/research/data/` contain research harnesses, not default product gates. Do not add their provider or browser dependencies to the application unless a current task requires them.

### Verification command map

Use Node 24 and `npm ci`. Install the locked browser runtimes with
`npx --no-install playwright install chromium webkit`; Linux CI also installs
their system dependencies. `npm run verify:doctor` checks Node, installed
dependencies, browser executables, suite ownership and corpus inputs. It checks
prerequisites, not rendered correctness, and starts no server or provider request.

| Change or concern | Command and evidence |
|---|---|
| Default completion gate | `npm run verify:all` runs typechecking and provider-free tests. Contract verification reuses the parser's rules; malformed individual relations remain explicit warnings, not proof of correct relations. |
| Focused relation geometry | `npm run verify:renderer-browser` checks native endpoints, persistence, zoom/Fit and narrow views. |
| Complete browser behavior | `npm run verify:browser` runs every required browser spec, including real app failure recovery and Tree Bank save/reopen. Missing, unowned or skipped required specs fail. |
| Engine and review-page compatibility | `npm run verify:browser-webkit` runs the bounded Chromium/WebKit renderer and comparison-visibility matrix. This does not substitute for macOS in-app-browser review of relevant UI changes. |
| Shared Replay/layout changes | `npm run verify:corpus -- --baseline-root /base --candidate-root /candidate --output /tmp/comparison.json` compares the same explicit records in two checkouts. `--archive-manifest /private/index.json` adds private saved records; unknown mechanism coverage is reported. |
| Renderer preparation or startup | `npm run verify:renderer-performance -- --baseline-root /base --report /tmp/timing.json` preserves the first-paint budget and reports full preparation separately. Both checkouts need locked dependencies. Preparation distributions are informational until a separate budget is established. |

Browser receipts, TAP output and failure captures go outside the worktree. Use
`-- --evidence /tmp/babel-browser-check` for a named directory. CI retains browser
and timing artifacts. Native-browser checks and the offline corpus comparator
prove different things: the comparator checks Replay, plans and unmeasured tree
reservations; it does not measure fonts, plaques, connector painting or the camera.

The corpus manifest links representative existing fixtures for movement and
ordinary wrappers, later movement, separately established pronunciation,
multiple roots, nonmovement construction, Tier 2 persistence and malformed claims.
An intentional comparison exception requires an explicit reason. New guards
should fail on the historical defect or a controlled bad result before a passing
candidate is accepted; passing counts alone do not establish protection.

For archived Replay captures, run `node scripts/captureReplayArtifact.mjs --bundle
/path/input.json --out /tmp/capture --app-url http://127.0.0.1:5177`. The loopback
app must already be running. Captures wait for the requested painted frame and
settled camera, retain raw payloads, fingerprint loaded runtime assets and fail on
browser errors. `node scripts/buildReplayContactSheets.mjs --render-dir /tmp/capture
--out /tmp/sheets` waits for every image to decode. Both tools own isolated browser
contexts, await cleanup and require empty output directories. An optional
`--browser /path/to/executable` records the actual selected browser.

Saved production review runtimes have a complete input manifest, including CSS
content membership, dependency lock, build tools and virtual entry source. Older
incomplete runtimes must be rebuilt. Actual bundle imports are recorded separately
from CSS-only inputs, so scanning a file for styles does not hide an unintended
program import. A virtual-entry atlas also needs
`BABEL_TIER2_ATLAS_ENTRY_FILE` pointing to its exact expected entry when reused.

### Qualification runs

To enter sentences manually in Babel's normal app interface:

```sh
npm run qualification:codex:app
```

Open `http://127.0.0.1:8454/`. The sentence box, framework selector, Canopy,
Replay, Notes and browser-local Tree Bank are the actual app components.
GPT-6.1 Sol / high is selected initially; Astra and Sol are also available.
Each Parse invokes the existing OAuth qualification runner once and saves its
usual artifacts under `~/Library/Application Support/Babel/codex-qualification`.
The app explicitly fingerprints the working tree, including uncommitted changes;
the receipt records whether those sources match the named commit.
Use `-- --out DIRECTORY --port NUMBER` to change the archive or local port.
Closing the page cancels its unfinished request and retains received output.
This local interface does not enable OAuth on Babel's public provider routes.

`npm run qualification:codex` sends Babel's exact prompts directly to the Codex
Responses endpoint using a ChatGPT subscription login. It does not launch an
agent or load Codex instructions, history, tools, skills, project files or profile
configuration. It reads only the login credential file, in memory, without
copying or changing it. It never uses API keys or retries a request.

From a checkout with committed contract sources:

```sh
npm run qualification:codex -- --sentence 'Mia laughed.' --framework xbar \
  --out /tmp/babel-sol-check --run
npm run qualification:review -- --run /tmp/babel-sol-check
```

Omit `--run` to save and inspect the request without authentication or network
access. Add `--working-tree` to explicitly fingerprint current uncommitted sources;
without it, the CLI still requires committed contract sources.
Each invocation requires a new output directory. The subscription default
is GPT-6.1 Sol at high reasoning effort. An explicit `--model` selects a retained
alternative. Astra uses
`--model openai:gpt-6-astra`. An explicit `--auth-file` can select a separate Codex
login; the default is `$CODEX_HOME/auth.json` or `~/.codex/auth.json`. An expired
token requires a fresh `codex login`; the runner does not manage the account.
Keep credentials out of artifacts, repositories and public CI.

Artifacts include the exact request, source fingerprint, received SSE bytes,
terminal provider response and usage, extracted output, and the usual Babel
inspection evidence. Transport telemetry records connection events, byte/event
timings, known socket-failure reasons, and OpenAI/edge request IDs for diagnosis.
It excludes credentials, cookies, socket addresses and arbitrary error messages.
An interruption remains a failed transport observation; no replacement request
or invented usage is added.

`transport-diagnostics.ndjson` is appended during the request, with five-second
checkpoints, provider/request IDs, HTTP/TLS lifecycle events, known socket-error
codes, cancellation signals and local runner failures. It survives a killed
runner; SIGKILL itself cannot be trapped. The final receipt and telemetry remain
separate. A remote socket closure identifies a transport failure, but identifying
the responsible provider backend still requires its logs and the captured IDs.

Receipts also record hypothetical API token cost in USD using dated, sourced
Standard global rates. This estimate is not a subscription charge or invoice.
Provider-specific cache accounting avoids double-counting; reasoning is already
included in output tokens. Missing usage stays unpriced, and missing cache details
produce a range. Retained estimates keep their pricing date when rates change.

Completed responses continue through Babel's
inspection, normalization, repairs and Replay evidence. Only a provider-confirmed
complete response enters Babel processing. Partial output remains available in
`output.txt` and `response.sse`. Cancellation saves what has arrived. There is no
client-imposed generation time limit.

`--contract spellout` runs the input-segmentation experiment in
`docs/research/input-segmentation.md`. The model receives only the sentence, with
no token list, and its final words must spell the sentence.
`contractQualification/spelloutContract.js` checks that spelling and converts each
analysis into the current contract, using the model's own words as tokens, so the
parser, Replay and review run unchanged. `spellout.json` keeps the alignment. No
product route uses this variant.

The subscription endpoint requires streaming and `store: false`; background
polling and the API output-token limit are omitted and recorded as transport
differences. These are subscription development checks, not verification of the
public API request route or proof that the backend behaves identically to the
paid API. No application provider route is changed. The runner works from a
local or private remote checkout with Node 24 and `npm ci`; it does not provision
a remote machine or copy a login there.

`npm run qualification:anthropic` sends the request Babel's Anthropic route builds,
adding only `stream: true`, to the Messages API. It reads the API key from the
Keychain into memory and never writes it. Each invocation makes one request with
no retries or model fallbacks; omit `--run` to save the request without a key or
network access. The default is Claude Opus 5.5 at high effort. Artifacts and review
match the Codex runner. Its cost receipt estimates the credit charge; the Console
shows the actual one.

```sh
npm run qualification:anthropic -- --sentence 'Mia laughed.' --framework xbar \
  --out /tmp/babel-opus-check --run
```
