# Verification

How Babel's checks work, what each one proves and how to run it. `AGENTS.md`
says which check a change needs; this document is the reference behind it.

## Setup

Use Node 24 and `npm ci`. Install the locked browser runtimes with
`npx --no-install playwright install chromium webkit`; Linux CI also installs
their system dependencies. `npm run verify:doctor` checks Node, installed
dependencies, browser executables, suite ownership and corpus inputs. It checks
prerequisites, not rendered correctness, and starts no server or provider request.

## Checks

| Command | What it proves |
|---|---|
| `npm run verify:all` | Typechecking, exception growth and every provider-free test, including the parse contract (which reuses the parser's rules; a malformed individual relation stays an explicit warning, not proof of a correct relation) and the Replay invariant sweep over every committed fixture analysis (`tests/replayInvariants.test.mjs`), whose `movement-shown-as-movement` rule fails when an authored chain or recognized movement gets its landing from construction or another relation's moment instead of its own claim's moment. `node scripts/auditReplayInvariants.mjs --out /tmp/invariants.json` runs the same invariants over fixtures and saved qualification batches. |
| `npm run verify:exceptions` | Part of `verify:all` and CI. Fails when a change adds an entry to `tests/helpers/*Exceptions.mjs`, lists a fault at more places or raises a bound without Francis's approval on that entry (`approval: { by, on, note, accepts }`, `accepts` being the entry's `at` as he accepted it), or when an entry grows beyond what its approval accepts. Approvals do not expire; renumbered frames are not growth, and unrelated later commits do not invalidate an approval. An existing approval is never edited or removed: while its entry stays within what it accepts, its by, on and note stay exactly as written (its accepts may narrow with the entry); only a new approval for a value it does not accept may replace it, never dated earlier. |
| `npm run verify:replay-offline` | Runs `verify:visual-offline` and `verify:camera-offline` in one pass, with the layout fingerprint, preparing each analysis once. CI runs it. |
| `npm run verify:visual-offline` | Lays out every committed fixture frame and Canopy offline at 1440×900 and 2560×1440 and checks overlapping text, lines through plaques or text, distant plaques and role labels, broken label wraps, clipping, branches off the one-row grid, sisters on different rows, parents more than a pixel off the midpoint of their outermost visible daughters, and plaques that jump while their anchor holds and nothing new takes the pocket they leave. Fails on findings not in `tests/helpers/visualExceptions.mjs`, beyond their bound, or stale. Also checks the layout fingerprint (below). |
| `npm run verify:camera-offline` | Runs the real camera fit on the same frames at 1440×900 and 390×844 through every adjacent step, a reversal after each arrival and direct selection. Checks settled path independence (justified forward retention only), content placement, first-paint continuity, within-stage stability, that the Canopy paints the last Replay frame's syntax unchanged (`canopy-final-frame`) and shows the whole tree centred (`canopy-placement`). Exceptions: `tests/helpers/cameraExceptions.mjs`. It does not see browser timing or painted motion between poses. |
| `npm run verify:corpus -- --baseline-root /base --candidate-root /candidate --output /tmp/comparison.json` | Compares the same records in two checkouts on the measured layout the browser paints. Fails when a movement the baseline shows as movement loses its moment or trajectory, or on a noticeable new or farther motion fault (see Motion rule). CI runs it over every committed fixture against the PR base. `--jobs N` (default up to four) sets the worker processes both checkouts share; it changes only the wall time. |
| `npm run verify:renderer-browser` | Relation drawing in Chromium: native endpoint attachment, persistence, zoom/Fit and narrow views. |
| `npm run verify:browser` | Every required browser spec, including real app failure recovery and Tree Bank save/reopen. Missing, unowned or skipped required specs fail. |
| `npm run verify:browser-webkit` | The bounded Chromium/WebKit renderer and comparison-visibility matrix. Not a substitute for reviewing UI changes in the macOS in-app browser. |
| `npm run verify:browser-visual` | Renders the human-catalogue analyses with the production renderer in Chromium at 1440×900 and 390×844 and judges every painted frame and the Canopy with the shared geometry rules, index letters, settled poses against the camera policy, and every animation frame of each Next step, rapid Next run and resize (empty or faded frames, off-canvas, jumping or blinking syntax and marks, jitter). Fails on findings not in `tests/helpers/browserVisualExceptions.mjs`, beyond their bound or stale, and on unjudged places. A rapid run that shows no fault is repeated once and a fault either run shows counts, so browser timing cannot make a listed fault look gone. macOS only (see CI). |
| `npm run verify:renderer-performance -- --baseline-root /base --report /tmp/timing.json` | First-paint budget against a base checkout; both need locked dependencies. Full preparation is reported but has no budget yet. |
| `npm run release:check` | `verify:all`, `verify:replay-offline`, `build` with `release:verify-assets`, `verify:browser` and `verify:browser-visual`, in order, stopping at the first failure. Run renderer performance beside it. |

### Layout fingerprint

`fixtures/replay-snapshots/fixture-layout.json` fingerprints, per committed
fixture analysis, every desktop Replay frame (laid-out text, branches, plaques,
role labels, connectors, every other bound relation mark, and the camera Fit, to
0.01 tree units), its Replay panel text, the Canopy and each relation's tier
(`tests/helpers/layoutSnapshot.mjs`). A refactor must leave it unchanged.
`node scripts/explainLayoutChange.mjs --baseline-root /path/to/base` shows what
moved in each changed frame. A behavior change rewrites it with
`--update-snapshot`; review the diff, never regenerate blind. Mobile and painted
motion between frames are not fingerprinted.

### Tolerance

On 27 Oct 2026 Francis asked for gates that stop raising differences he would not
notice. The checks therefore treat a measure within 5% above its listed bound as
within it, and a bound growing by at most 5% as no growth (`BOUND_TOLERANCE`,
`tests/helpers/findings.mjs`). A fault at more places always counts. Tolerated
changes are still reported: look at them in the real renderer and decide whether
he would notice.

### Motion rule

`scripts/replayMotionContinuity.mjs` decides ownership from each frame's own
step, not from either checkout's planner diagnostics. It reports syntax that
moves at a step that does not own it, and material that moves at the step
attaching it. A movement step owns the closing of the gap its phrase leaves
(`closingGroups`). Within a stage it measures layout motion; across a stage boundary
it first removes the camera carry (`carryCamera`), as the screen does. Where the
stage plan's own closing moves syntax across that boundary, the plan records it
and the carry keeps the block that holds still instead of a tied midpoint
(`carriedMedian`); everywhere else the carry is the plain median.

A new fault of at least 20 tree units (`NOTICEABLE_MOTION`), or an existing one
moving farther by at least the larger of 20 units and 10% of its old distance
(`NOTICEABLE_MOTION_GROWTH`), fails the comparison unless an approved entry of
`tests/helpers/motionExceptions.mjs` (`record`, `rule: 'motion'`, `subtype`,
`subject`, `at: { '-': { frame: distance } }`) covers it. Smaller faults are
listed as `tolerated`, covered ones as `excepted`.

With `--fixtures`, a fixture the layout fingerprint covers is judged by motion,
continuity, geometry and movement only; its Replay, plan, layout and width
changes are reviewed through the fingerprint. A fixture the change adds is judged
by motion, continuity and geometry only (`allowAddedFixtures`). Records of
`fixtures/replay-corpus/manifest.json` keep their own `allow` rules; an
intentional comparison exception needs an explicit reason. The manifest links
representative fixtures for movement and ordinary wrappers, later movement,
separately established pronunciation, multiple roots, nonmovement construction,
Tier 2 persistence and malformed claims. `--archive-manifest /private/index.json`
adds private saved records; unknown mechanism coverage is reported.

For a wider comparison, `node scripts/buildCorpusArchiveManifest.mjs --fixtures
--runs /path/batch/runs --out /tmp/archive.json` names every committed fixture
analysis with a saved sentence and every analysis of saved qualification runs;
pass it as `--archive-manifest`, with a larger `--timeout-ms` for a large archive.
Fixture analyses without a saved sentence are listed as skipped. Every changed
record still needs its own review.

## What each check can and cannot see

- The offline visual audit runs the production layout, plaque allocation, camera
  Fit and neutral-label placement with text measured from the bundled fonts. Its
  findings are leads for a native capture, not proof of a pixel. It does not see
  positions only screen refinements set, index letters, or motion between frames.
  Its rules (`tests/helpers/visualRules.mjs`) judge normalized frames, so a
  browser probe can reuse them; findings and exceptions follow
  `tests/helpers/findings.mjs`.
- The corpus comparator checks Replay, plans and the tree layout the renderer
  paints. It does not see native text rendering, plaque painting, connectors or
  the camera.
- A new guard must fail on the historical defect or a controlled bad result
  before a passing candidate is accepted; passing counts alone prove nothing.

## Discovery over saved runs

- Visual audit: `node scripts/auditReplayVisuals.mjs --fixtures --batches /path/codex-qualification --out /tmp/visual-audit.json` (mobile included).
- Camera audit: the same `auditReplayVisuals.mjs` with `--audit camera --batches /path/codex-qualification --viewports desktop,wide-short,mobile` (each `--audit` takes its own `--viewports`).
- Browser audit of a review page: `node scripts/auditReplayBrowser.mjs --page PAGE.html --cases all --out /tmp/audit` (`--dry-run`, `--shard`, `--baseline`).

## CI

CI and browser verification run on every pull request and nightly on main, not
after a merge: a pull request must be up to date with main, so it has already
verified the merged tree. Browser verification skips a pull request that changes
only Markdown. The required check is the aggregating `Provider-free verification`
job.

CI splits the heavy gates across runners without changing what they judge.
`verify:replay-offline` and `verify:corpus` each run as two shards
(`--shard I/2`, writing raw results with `--results-out` or `--snapshots-out`)
and a job that judges them together (`--merge FILE`, once per shard). The merge
selects the same analyses and options itself, refuses unless the shards hold
each analysis exactly once, and then reports, fails and checks exceptions and
fingerprints as one run does. Offline tests run as six shards balanced by the
measured file weights in `scripts/ciTestShard.mjs`, and browser specs as three
shards balanced by `ciSeconds` in `scripts/browserSuites.mjs`; both checks
fail unless every file runs exactly once. GitHub's runners differ in CPU (an
older AMD EPYC 7763 audits the same shard about 1.5 times slower than a 9V45),
so wall times vary between runs.

`verify:browser-visual` is not a CI job: Linux Chromium paints slightly
differently from macOS, where its bounds were measured. Before merging a pull
request that changes `replay/`, `components/`, styles, fonts or the visual rules,
run it on macOS against the pull request's head.

## Evidence

Browser receipts, TAP output and failure captures go outside the worktree; use
`-- --evidence /tmp/babel-browser-check` to name the directory. Failure
screenshots are always kept. Videos are off by default because no check reads
them; add `-- --video` (or `BABEL_BROWSER_VIDEO=1`) to record the app workflow,
closeout and feature-composition sessions when reviewing motion.

For archived Replay captures, run `node scripts/captureReplayArtifact.mjs --bundle
/path/input.json --out /tmp/capture --app-url http://127.0.0.1:5177` against an
already running loopback app. Captures wait for the requested painted frame and
settled camera, keep raw payloads, fingerprint loaded runtime assets and fail on
browser errors. `node scripts/buildReplayContactSheets.mjs --render-dir
/tmp/capture --out /tmp/sheets` waits for every image to decode. Both need empty
output directories; `--browser /path/to/executable` records the browser used.

Saved production review runtimes carry a complete input manifest (CSS content
membership, dependency lock, build tools, virtual entry source); rebuild older
incomplete ones. Bundle imports are recorded separately from CSS-only inputs. A
reused virtual-entry atlas needs `BABEL_TIER2_ATLAS_ENTRY_FILE` pointing to its
exact expected entry.
