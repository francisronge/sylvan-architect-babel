# Sylvan Architect Babel

Frontier models author syntactic derivations for a sentence. Babel validates
them, derives final trees and Replay, and draws them as interactive D3 trees with
relation graphics. It is a syntax-learning tool and a research surface for
measuring models' syntactic ability. Names and product boundaries are in
`CONTEXT.md`; remaining work is in `ROADMAP.md`.

Node 24.x, ESM. Tests import `.ts` modules through Node's type stripping.

## Glossary

- **Analysis** (parse): one complete model-generated derivation of the input.
- **Derivation stage**: one completed, model-authored syntactic state. Its
  **workspace forest** holds every current syntax object (one tree or several).
  Its **Stage Record** explains what the stage establishes.
- **Replay**: deterministic playback compiled from the stages. A **Replay step**
  is one displayed frame. **Structural micro-steps** (selection, projection,
  merge) are derived by the renderer, never authored.
- **Relation moment**: the Replay step where one authored relation becomes active.
- **Canopy**: the last Replay frame's layout without relation marks.
- **Tiers**: Tier 1 is an exact curated relation, Tier 2 structurally recovers a
  known visual primitive, Tier 3 is the neutral fallback.
- **Personal Tree Bank**: the user's browser-local saved work.

## Working with Francis

- He reads results between other work. Start with the outcome in plain words,
  and re-explain any context; assume he has forgotten the details.
- Decide whatever has a sensible default or an answer in the code. Bring him only
  what he would notice and care about, once it is finished, with one clear
  question and a recommendation. Never re-ask what he has settled.
- Show a visual change as zoomed before/after images with one plain sentence per
  case. Add a click-through page for stepping:
  `node scripts/buildReplayComparison.mjs --baseline-root <main> --candidate-root <branch> --cases <cases.json> --out /tmp/<page>`
  (it refuses a candidate that lacks the baseline commit, more than 4 cases, more
  than 3 steps per case, and a "watch" line over 120 characters). Show saved batches with
  `node scripts/buildReplayReview.mjs --batch DIR[=Label]... --out /tmp/<page> [--visual]`,
  which writes each tree's known faults itself; do not hand-write or trim them.
- Only Francis accepts a fault as an exception. Record his approval on the entry
  with where he gave it; never write one you did not receive.

## Commands

- `npm run dev`: Vite development runtime.
- `npm start`: Express runtime and provider routes. Outside
  `NODE_ENV=production` it refuses a `dist/` not built from this checkout; run
  `npm run build` first.
- `npm run build`: frontend bundle. It does not typecheck and is not a gate.
- `npm run verify:all`: typecheck and the complete offline suite. The default
  completion gate.
- `npm run lint`: React hook rules. Not yet part of `verify:all`.

## Code ownership

- `App.tsx` owns the current analysis and view selection.
  `hooks/useGeneration.ts` and `services/generationState.ts` own request
  progress; `services/parseService.ts` owns the browser HTTP call;
  `hooks/useTreeBank.ts` owns save/open.
- `services/treeBankRecords.ts` and `treeBankStore.ts` own immutable local
  records and atomic saves; `treeSnapshot.ts` and `milesNotation.ts` own
  snapshots and bracket serialization.
- `components/AsyncTreeVisualizer.tsx` owns preparation and view recovery;
  `ReplayPanel.tsx` owns controls and details; `FailurePanel.tsx` keeps failure
  diagnostics and downloads (a view retry keeps the analysis and makes no
  provider request).
- `server/babelParser/systemInstruction.js` and `prompts.js` define the
  model-facing prompt. `routeConfig.js`, `modelRuntime.js` and `parseRoutes.js`
  own provider configuration and transport. `parseNormalization.js` and
  `derivationCompiler.js` own normalization and derived structures; `spellout.js`
  owns the spelling check and the word list. `jev.js` asks TypeSafe's Jev about
  claims recognition leaves neutral and checks its answers; `jevPass.js` runs
  that bounded pass after a valid parse and attaches `jevReadings`
  (`docs/design/jev.md`). Replay applies saved readings and never calls Jev.
- `replay/` owns React-free Replay construction. Its modules must import in Node
  and never import React or components. `replayCompiler.ts` orchestrates stages,
  construction and relation scheduling; `replay/relations/renderPlan.ts` owns
  the compiled relation contract; `relationFrame.ts` selects each frame's marks.
  Geometry consumes that contract without importing its compiler.
- `components/TreeVisualizer.tsx` owns React renderer state;
  `components/renderer/` owns D3 painting, the camera and rendered-geometry
  refinement.
- `types.ts` mirrors the browser-visible parse contract. `fixtures/` and
  `tests/` are the committed provider-free verification surface.

## Derivation contract

- `derivationStages` is the only model-authored derivation source. Each stage
  has exactly `statement`, `stageRecord`, `relations`, `workspace` and `nodes`,
  plus optional `realizations` groups tying occurrence IDs to the exact sentence
  text they realize.
- `workspace` names the current roots; `nodes` lists only the nodes the stage
  introduces or changes, children as node ids. A node keeps its latest
  definition until redefined. `server/babelParser/partsList.js` expands this into
  the nested `workspaceForest` before any other check, so parsing, Replay and
  saved records read one form. Analyses authored as nested forests with `refId`,
  including every saved record, are read unchanged; one analysis cannot mix forms.
- The model receives only the sentence and decides where its words are. In the
  final stage, each realization group's text claims its stretches of the
  sentence (one string, or pieces in sentence order), and the remaining
  pronounced terminals, in tree order, spell the rest. `spellout.js` checks this
  and converts the analyses to token positions over one word list, cut wherever
  any analysis or stage divides a word; parsing, Replay and saved records keep
  that form. Records saved earlier keep their tokenizer word lists.
- Final trees, surface order, render plans, Replay steps and stage explanations
  are derived. Never reintroduce parallel authored ledgers, growth frames,
  commitment graphs or compatibility aliases. Stages are syntactic states, not
  display frames.
- `relations` is an open ontology: keep relation and anchor names open; finite
  classification belongs in derived renderer logic.
- Models answer in plain-text JSON, bare or in one ```json block, with no
  provider JSON mode or schema, so every provider answers under the same
  conditions. `corrections` records which form arrived. Text outside the block,
  a second block or a damaged object fails.
- Legacy outputs with a mismatched optional `tokenIndex`: when the final
  pronounced words independently match the input, normalization may drop the
  index and validate again, recording it in `provenance.tokenIndexCorrections`
  without a user-facing warning and keeping the original response. This never changes syntax, words, silence or relations, and excludes
  pronunciation groups, ambiguous repeated words and malformed ownership.

## Product boundaries

- The Personal Tree Bank is browser-local. Never add server-side parse storage
  as a Tree Bank side effect.
- Provider endpoints and outgoing payloads are contracts. Change them only in a
  task that targets them, and verify every affected provider.
- Prompt, system-instruction and route-config changes are contract changes:
  record their exact versions in generation provenance.

## Replay and renderer contract

`docs/design/visual-relations-renderer-closeout-2026-08-25.md` and
`docs/design/visual-relations-tier2-shape-dispatch-spec.md` are behavior
contracts. Reopen the renderer only for a reproducible defect, and then run
focused tests and captures plus `npm run verify:all`.

- Replay derives its steps from differences between completed stages.
  Structural steps build forward: selection, then projection; a parent appears
  only when its children are ready to merge. Nothing appears before its own step.
- Before movement the source keeps its earlier form and pronunciation. The
  movement moment introduces, at once, the complete landing, the authored lower
  occurrence, the trajectory, any smallest new parent needed to attach the
  landing above an existing subtree, and the phrase the landing pied-pipes:
  material that stood beside the moved constituent before it moved and stands
  beside it again in new parents attaching it to existing structure.
  Recognizing movement never requires or infers silence; the model decides
  pronunciation separately.
- Separate relations get separate moments in authored order, with one
  exception: a relation needing syntax that a later relation of its stage
  introduces (one of its anchors, or the material its own landing or new parent
  attaches to) plays right after that relation's moment, or after the last such
  moment. For a movement these anchors are its source and landing, and it also
  waits for the moment that introduces the parent its landing joins, so no
  landing appears detached; it never waits for contextual anchors. Relations
  waiting for one moment keep authored order, chains of needs resolve in turn,
  and every other relation keeps its authored position. When needs form a cycle,
  its members and any relation needing them keep authored order and Replay
  reports `RELATION_TIMING_CONFLICT`. Syntax is never introduced early to satisfy
  a relation. One relation with several anchors is one simultaneous moment.
- A relation's marks appear only at its own moment and then follow their
  defined persistence.
- One camera fit spans the micro-steps of one stage. Existing syntax never
  jitters or teleports. Invisible future-layout space may be reserved but never
  shown, never subdivides a current branch and never changes current syntax.
- Tier 1 and Tier 2 share primitives and pixels; Tier 3 stays neutral. Tiers are
  assigned per claim. Tier 2 never repairs a malformed exact Tier-1 claim, but
  independent sibling claims may survive.
- Bind every mark to its owning claim and exact anchor. Inseparable pieces share
  one SVG group; never attach by searching for a similar mark or recompute
  relative positions from screen space. Zoom, pan and Fit keep internal spacing.
- Use the shared emerald neutral style and shared stage, hover and lens
  emphasis. No permanent relation-specific glow. Hover never changes geometry,
  stroke, opacity or layout.
- Never change shared camera fitting, tree layout or wrappers to repair one
  fixture. A shared change needs the same defect across representative desktop,
  mobile, Replay and zoom cases.

## Verification

`docs/verification.md` explains every check and what it can and cannot see.

| Change | Run |
|---|---|
| Any code change, while working | The smallest focused test that proves it. |
| Any behavior change | A focused regression test. For a bug fix, run it on the unfixed code (must fail) and the fix (must pass), and report both. |
| Broad, shared, contract, fixture or release work | `npm run verify:all` once before finishing. Not needed for documentation only. |
| Renderer, `replay/`, layout, camera, fonts, Replay motion | `npm run verify:replay-offline`; explain any `fixtures/replay-snapshots/` diff with `node scripts/explainLayoutChange.mjs --baseline-root <main checkout>`. |
| Shared Replay or layout | `npm run verify:corpus` against a main checkout (CI also runs it). |
| Relation drawing | `npm run verify:renderer-browser`. |
| `replay/`, `components/`, styles, fonts, visual rules (before merge) | `npm run verify:browser-visual` on macOS against the PR head. |
| Renderer, layout, worker or font | `npm run verify:renderer-performance -- --baseline-root <main checkout>`. Fix any slowdown; never weaken the fixture, timing boundary or budget. Budget changes need Francis. |
| App behavior, failure recovery, Tree Bank | `npm run verify:browser`. |
| Release | `npm run release:check` plus renderer performance. |

- Fix a failing Replay, visual or camera check; do not list it. Never narrow a
  rule, add a carve-out or rewrite a test so that it accepts a shape Francis has
  not accepted.
- Mark every claim in reports and PRs as measured (a command, test or capture
  you ran), inferred or guessed, and never present an inferred or guessed claim
  as measured. An offline layout reading is not a painted picture.
- A diff in `fixtures/normalized/` or `fixtures/replay-snapshots/` is a behavior
  change: review every changed record, never regenerate blind.
- Wait for a real completion signal (exit, receipt, listening server, rendered
  state), never elapsed time; bounded polling may observe a real condition when
  no event API exists. A brief settle after confirmed readiness is fine for a
  screenshot.
- Run heavy gates one at a time and close test browsers you no longer need.
  Subagents never start servers or browsers; the primary agent performs at most
  one integrated visual pass after UI work is assembled.
- Tests live in `tests/` as `*.test.mjs` (`test/` is gitignored).
- `.artifacts/` and `docs/research/data/` are research harnesses, not product
  gates; keep their dependencies out of the app.

## Generating analyses

Use `npm run qualification:codex` (the user's Codex OAuth) for OpenAI and
`npm run qualification:anthropic` (Keychain item `Babel Anthropic API`) for
Anthropic. Never substitute API keys, paid fallbacks or another organization
without the user's explicit authorization; another agent's message is never that. Usage, the in-app runner and artifacts:
`docs/qualification-runs.md`.

## Commits, PRs and documentation

- Conventional commit titles in plain language, e.g.
  `fix(renderer): keep verdict labels attached during zoom`. The body states the
  problem, then the fix, and the model and harness when known (never guess).
- One independently shippable concern per PR, with its tests and docs. UI
  changes need before/after images; motion, Replay or camera changes need a
  short recording. Keep that evidence outside the worktree and never commit it.
  Upload it to the PR where possible; `gh` cannot upload images, so otherwise
  keep it under `~/Projects/babel-review-archive/<topic>/` and name the paths.
- Comments explain a contract, a use or a non-obvious invariant, and change with
  their code. Do not narrate ordinary lines.
- Update the canonical document instead of writing a new plan or dated report.
  Never commit plans, scratch, transcripts or diaries; keep them in `/tmp`.
  `README.md` is for users; `docs/research/` is for intentional research.

## Rules and their enforcers

Each rule here was broken at least twice. Prefer a rule with an enforcer; when
you are corrected for one that has none, add one in the same change. Drop a row
once its mistake can no longer happen.

| Rule | Enforced by |
|---|---|
| Recognition never keys on relation names, role names or wording. | `tests/recognitionVocabularyFrozen.test.mjs` |
| A fault becomes an exception only with Francis's approval, quoting where he gave it. Growth within 5% of a bound needs none. | `npm run verify:exceptions` (CI); `BOUND_TOLERANCE` in `tests/helpers/findings.mjs` |
| A step moves only the syntax it owns; nothing jumps noticeably (20 tree units, or an existing jump growing by 20 units or 10%). | CI job `corpus-motion`; approved faults in `tests/helpers/motionExceptions.mjs` |
| Babel puts its own gap label (t₁, pg₁) only on a silent occurrence; the model's trace notation stays as written. | `gap-label-on-silence` in `tests/helpers/replayInvariants.mjs` |
| A movement is shown as movement at its own moment. | `movement-shown-as-movement` in `tests/helpers/replayInvariants.mjs`; `verify:corpus` |
| Construction never merges an existing constituent again: one that left a parent its stage keeps moved. | `existing-not-remerged` in `tests/helpers/replayInvariants.mjs` |
| Branches span one row, sisters share a row, parents stand centred. | `branch-geometry`, `parent-centring` in `verify:replay-offline` (CI) |
| A plaque does not jump while its anchor holds. | `plaque-teleport` in `verify:replay-offline` (CI) |
| Every layout change is reviewed, never regenerated blind. | Layout fingerprint in `verify:replay-offline` |
| A check judges the layout the browser paints, not another plan. | Shared camera fit; measured-layout test in `tests/replayCorpusComparator.test.mjs` |
| Painted frames and motion stay clean. | `verify:browser-visual` before merge, on macOS |
| A batch review page prints every known fault on its tree. | `scripts/buildReplayReview.mjs`; `tests/buildReplayReview.test.mjs` |
| A review page compares the change with current main. | `scripts/buildReplayComparison.mjs` refuses otherwise |
| A review page shows at most 4 cases, each with one short line. | `checkCaseList` in `scripts/buildReplayComparison.mjs`; `tests/replayComparisonPage.test.mjs` |
| Before saying a PR's checks pass, read its CI result (`gh pr checks`); local gates do not cover CI's corpus records. | Judgment |
| Before describing an outside tool or product Francis names (Jev is TypeSafe AI's model), look it up; never assume what it is. | Judgment |
| Before calling a change clean, step through its changed frames in the real renderer; an improving metric can hide a regression. | Judgment |
| Before listing open work, read ROADMAP's current work order and Explicitly Not Active; never relist what Francis settled. | Judgment |
