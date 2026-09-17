# Babel Master Roadmap

Status date: 2026-09-17

This is Babel's only active implementation plan. Dated plans, audits, handoffs,
and research notebooks are evidence or history, not competing roadmaps.

## Current Baseline

| Area | Current state | Remaining boundary |
| --- | --- | --- |
| Authored contract | Each analysis contains only `derivationStages`, with four required stage fields and open relations. Optional stage `realizations` associates existing syntax with exact input tokens. Coverage, Replay, public routes and browser-local saving are verified offline; ordinary archived Replay is unchanged. | Qualify fresh model authoring under the revised prompt. Preserve recovery policy pending agreement. |
| Deterministic engine | Local repairs preserve stages and originals and report exact field/reference failures. Saved chronology conflicts remain diagnosed. | Generated display identity now records ownership and reserves authored IDs. Automatic JSON repair and public incomplete-processing policy remain unresolved. |
| Relation renderer | The September 16 fidelity repair restores Orchard placement and paint. The approved Tier-3 role labels retain its connectors and authored list positions. Orchard cards use production drawing code for every tier. Earlier checks missed a separate Tier-3 painter; their broad fidelity claim was incorrect. | Extreme text and viewport checks remain bounded. Labels wider than the available canvas still require panning; no participant-free drawing is justified. |
| Replay preparation | The measured optimization remains unchanged. Extended controls through 192 stages/958 frames complete. Forty large view cycles release all 81 workers and retain about 18–19 MB of page heap; 15 mid-preparation cancellations also recover correctly. | Instrumented 160/192-stage controls take about 12/19 seconds, with sampled worker heaps up to 182 MB and frame jumps up to 274 ms. These bounds do not establish instant preparation, exact peak memory or slower-device behavior. No layout rewrite or persistent derivation cache is introduced. |
| Current product | Working local React/Vite application with Canopy, Replay, Notes, provider routes, ambiguity selection, and a legacy Tree Bank. | Build one maintainable application with a simple public surface at `/` and an advanced research surface at `/research`; retire Notes as a duplicate top-level view. |
| Tree Bank | The merged app captures the styled tree for its browser-local preview. Eight desktop save/preview/reopen cases pass across all four archived bundles in Canopy and Replay. Previews need not show every plaque row; reopening provides the full record. | Existing icon thumbnails require a fresh save. The later durable-record migration remains separate product work. |
| Durable record layer | W17a-d pure record envelope, evidence schemas, adapter, canonical native export, and provider-free proofs exist. | No storage engine, product integration, query layer, import UI, collaboration, or publication system exists. |
| Benchmark | Extensive provider-free W13-W16 infrastructure exists for manifests, schedules, validation, statistics, review plans, reports, corrections, and release refusal. | No current item suite, approved provider run, adjudication workflow, fitted method, claim-bearing release, or benchmark web surface exists. |
| Public research site | Research archive exists. The current renderer is published as the Relation Orchard artifact in this checkout. | Ship the organized checkout and later design the benchmark/product sites without mixing their data or authority. |

The earlier renderer closeout records what passed then; it does not override
the failures found in the September outputs. Babel's full generation and
rendering path is not yet qualified across live providers and deployment conditions.
An individual model linguistic mistake is benchmark evidence, not a product
shipping blocker. The audit checklist below
owns this work; it is not a new relation-card design program.

## Architectural Boundaries

Babel consists of three connected but separate systems:

1. **Babel product/workbench**: one engine and record system exposed through a
   simple public syntax generator at `/` and an advanced research workbench at
   `/research`. Both use sentence input, provider execution, Canopy, Replay,
   Tree Bank, saved work, and export; only the research surface exposes model
   controls, provenance inspection, comparison, batch work, and experiments.
2. **Benchmark system**: frozen manifests, item suites, provider runs, typed
   validity, review, statistics, reports, corrections, and releases.
3. **Derivational data system**: a browser-local Personal Tree Bank, an
   automatic backend Generation Archive for the official hosted service, and a
   separately reviewed derivational corpus suitable for research and potential
   model training.

They share the contract and durable record types. They do not share product
state, quietly copy derivation bytes, or turn benchmark controls into ordinary
user-interface settings.

Binding rules:

- No confirmed-worse derivational output is acceptable for formatting,
  reliability, cost, latency, convenience, or implementation simplicity.
- Babel never invents linguistic content. Existing automatic JSON delimiter
  repair is under review in Program 1, not an approved general recovery policy.
  Retaining recovery requires evidence of what it preserves and what it risks.
- Babel requests complete derivations. Output allowance is never inferred from
  sentence length.
- `derivationStages` remains the sole model-authored structural source.
- Every stage requires `statement`, `stageRecord`, `relations`, and
  `workspaceForest`. Optional `realizations` groups associate current occurrence
  IDs with exact input-token positions. No other stage fields are allowed.
- Relation and anchor-role names remain open. Finite interpretation belongs in
  the renderer's derived Tier 1/Tier 2/Tier 3 pipeline.
- One analysis produces one canonical immutable durable record.
- Saving creates the analysis records and one thin saved-work wrapper
  atomically. The wrapper stores record references, selection and view state,
  metadata, and previews; it does not duplicate derivational content.
- Import and export are explicit, hash-verified actions. Local/private use is
  the minimum supported boundary.
- Personal Tree Bank saving remains explicit and browser-local.
- The official hosted service is planned to archive every generation attempt
  automatically, including separately typed malformed and failed outputs. This
  retention must be disclosed rather than secret, and its privacy, security,
  retention, and deletion rules must be approved before implementation.
- Self-hosted and forked Babel installations never upload generations to an
  official backend unless their operator explicitly configures that behavior.
- Provider settings retain their native names and meanings. Do not manufacture
  temperature or equate effort labels across providers. Record the effective
  settings and documented defaults for every run.
- The public surface does not expose provider, model, or reasoning controls.
  Its server-selected generation policy remains fully recorded in provenance.
  The research surface may expose those controls without creating a second
  parser, renderer, Tree Bank, or record format.
- The system instruction stays provider-neutral; no provider receives a hidden
  linguistic patch.
- Archive raw provider response bytes separately from parsed values and
  canonical reserialization. These are three different fidelity layers.
- The derivational database never supplies benchmark answers or held-out
  material. A released benchmark bundle may enter the database only afterward,
  through an explicit one-way import marked with its benchmark origin.
- Provider tests, model-visible prompt changes, publication, deployment,
  licensing, and hosted synchronization require separate approval.

## Execution Order

Programs run in numeric order except for small provider-free maintenance that
keeps later infrastructure buildable. The Babel shipping target covers Programs
0-6, while their detailed product features may grow through evidence and
iteration. Contract qualification is product reliability work, not a benchmark.
Benchmark D0-D3 in Programs 7-8 is deferred, non-blocking, and last.

## Program 0: Repository And Release Hygiene

Goal: make the current checkout understandable and reproducible before adding
another subsystem.

1. **Done:** Keep this file as the single active plan and `docs/README.md` as the
   documentation map.
2. **Done:** Archive the July deep-audit plans, Fable Zero Unknowns packet, and
   June Mac handoff records, with live disposition notes around them.
3. **Done:** Preserve only the current r96 Orchard bundle and intentional lab/proof
   builds; remove superseded numbered bundles and disposable captures.
4. **Done:** Make every default test independent of ignored local artifacts.
5. **Done:** Keep renderer review receipts with renderer history, not in active audit or
   artifact directories.
6. **Done:** Patch the advisory-bearing transitive `nanoid` release within the
   existing dependency range; the current registry audit reports zero vulnerabilities.
7. **Done:** Audit the release boundary before applying a license. Separate
   project-owned source and writing from third-party assets, quoted or recovered
   figures, fonts, and model/provider outputs whose redistribution terms are not
   yet established. Apply Apache License 2.0 to project-owned code as the current
   release direction, preserve required notices, and reserve the official Babel
   name and logo. A separate Creative Commons or data license remains optional
   and must not be applied indiscriminately.
8. **Done:** Implementation commit `dd34c77` was cloned into an empty directory
   and passed `npm ci`, `npm run verify:all`, `npm run build`, and the
   link/static-asset check without ignored local files. The clean clone also
   passed the 69/69 Tier-2 raster comparison and the 61-card Orchard browser
   audit. The September 16 audit established that the raster check compares
   isolated specimens, not production trees, and the card check accepted a
   separate Tier-3 painter. Those checks did not prove complete production fidelity.

Done when a new checkout contains the correctly licensed source, r96 Orchard,
compact fixtures, required notices, and all provider-free gates without relying
on this Mac's ignored files.

## Program 1: Contract Qualification

Goal: test the complete path from model instructions and outputs through parsing,
Replay, relation drawings, and the product UI. Resolve failures exposed by real
outputs before continuing qualification. This is product reliability work,
separate from the later public benchmark; it does not rank models or certify
syntactic competence.

Preparation status, 2026-08-30: the corrected contract has a reproducible
post-fix baseline; provider-free raw-output, typed-receipt, and click-through
Replay review plumbing is verified. The admission pair and 14-item qualification
set are frozen in
[`program-1.item-set.json`](contractQualification/program-1.item-set.json).
[`frozen-item-set-contract.manifest.json`](docs/implementation/contract-qualification/frozen-item-set-contract.manifest.json)
binds that set and the audited contract to source commit `732e0fa`.
Roster update, 2026-09-05: the eight candidates are GPT-6 Astra, GPT 5.6 Sol,
Claude Opus 5, Claude Fable 5.1,
Kimi K3, Muse Spark 1.2, Grok 4.6, and GLM 5.3 Flash. Gemini remains excluded.
The current local app exposes Astra, Sol, Opus 5, Fable 5.1, Kimi K3, and Grok 4.6
through exact model IDs and each model's native effort settings, initially `high`.
Meta and GLM are on hold and cannot be selected for generation. Request routing,
normalization, Replay, and saved evidence are tested with mocked provider replies;
all models remain unqualified until approved real runs. No paid generation was
performed during integration. The frozen manifests above remain historical
baselines; capture the current source and request configuration before a live run.
See
[`pre-provider-preparation-2026-08-28.md`](docs/implementation/contract-qualification/pre-provider-preparation-2026-08-28.md).

### Current Priority: Resolve The September System Audit

The 5 September run generated `Which book did John buy?` with Astra and Fable
5.1, each in Minimalism and X-bar. Four calls cost an estimated $1.73756. The
full [system audit](docs/implementation/contract-qualification/system-audit.md)
preserves the 39 findings, all 36 saved relation classifications, linguistic review,
proven Fable field/reference failure causes, cost and timing evidence, and the
unresolved cause of the missing JSON ending.
It is supporting evidence; this roadmap is the only active checklist.

#### Current reconciliation and next work

Current offline gate: 1,693 tests, typecheck and both parse-contract fixtures pass.
The release asset check passes. Approved Replay wording, Tier-3 role labels and
the September 17 movement, recognition, index and clearance repairs are merged
and pushed through `1b7ddc9`. This is local/offline evidence, not deployment qualification.

Immediate priorities after reviewing all 19 starting-point items, 39 audit
findings and Programs 0–8:

- The authorized Opus 5 passive pair is complete on source `91848d0`: one
  high-effort request per framework for `The children were given two books.`,
  through the actual public route. Both returned strict valid JSON with zero
  repairs, in 133.711 / 136.808 seconds, at an estimated $0.562445 combined from
  reported usage. There were no retries. Exact requests, provider bytes, raw
  text, receipts, source snapshot and all 94 Replay captures are retained in the
  local ignored `opus-passive-2026-09-16` qualification archive. Independent
  saved-byte processing reproduces the public stages and final trees.
  **Do not mark these visuals passed:** X-bar frame 38 announces NP-movement,
  but frame 39's later A-chain owns the actual move. The earlier empty landing
  disappears in frame 38; the trace appears in frame 39. Babel compares the
  trace's lineage with the containing IP rather than the moving DP. Resolve
  occurrence versus landing-host evidence and transition ownership generally,
  without alias patches or reordering authored relations. Then recheck layout:
  this transition also shifts unrelated nodes by up to 184 px at the measured
  fit while the camera stays fixed. Minimalism moves at its correct moment but
  lacks a specialized movement drawing; theta/Case wording exposes further
  recovery gaps. Keep genuinely unpaired feature arrays and unsupported claims
  neutral. Generated theta indices also repeat `i` on separate arguments before
  the later authored subject-chain index; review their scope without treating
  them as authored identity. At 1280×720, fitting makes the trees small and the
  final X-bar role labels crowded. All 94 frames have valid geometry with no
  measured role-text/syntax-box collisions or browser errors; zoom, pan,
  Next/Previous and Fit pass. These checks do not settle readability. The model
  analyses explain both DPs' Case but overstate some evidence: both DPs are
  plural, and the Minimalist theme is below the recipient, not an intervener
  between it and T. Linguistic adjudication remains separate. Neither response
  uses nontrivial `realizations`, so fresh model morphology authoring remains
  unqualified. No product behavior or prompt changed during this run; it does
  not explain or establish prevention of Fable's historical JSON failure.
- Two Opus annotation defects are repaired. Theta indices no longer transfer
  relation dimming to the original syntax word. Tier-3 role placement reserves
  the existing stage-wide plaque bounds before reveal and again at Fit; plaque
  positions, tree layout and annotation persistence are unchanged. Both regressions
  were reproduced before the fixes. The full offline gate passes, and browser
  checks cover all 240 current Replay frames across the saved Opus, Grok and Sol
  pairs with no measured role-label/plaque collisions or dimmed indexed words.
  All 94 Opus frames retain their original syntax coordinates, camera, panel text
  and role text. Manual zoom, Next/Previous and Fit pass. This closes the two
  reported defects, not the remaining movement, recognition or crowding findings.
- **Grid clearance verified and visually accepted on September 17.**
  The Goal/Recipient grid placement was accepted. The connector detour around
  the Theme grid was rejected because it bent awkwardly and crossed `given`.
  That routing code has been removed. Plaques now reserve the straight neutral
  connector stems as well as syntax and movement paths; small plaques search
  measured nearby gaps, including Case plaques, before using below-tree space.
  Clear carried placements retain their offsets. Role text yields to straight
  connector routes. All 240 current saved Opus, Grok and Sol Replay frames pass
  desktop checks for connector/plaque, connector/word and role/plaque collisions.
  The final X-bar stage retains one camera. The offline gate passes 1,687 tests.
  Matched close-ups are in the temporary `grid-clearance/straight.html` review.
  This does not close movement timing, recognition or Tier-3 crowding; mobile
  visual approval and universal collision freedom are not claimed.
- **September 17 follow-up, implemented and verified offline and in Replay.**
  Shared movement evidence now distinguishes a containing landing site from the
  unique anchored moved occurrence. Opus X-bar's first movement relation owns
  replacement of the empty position and the lower occurrence; the later chain
  no longer repeats the transition. The Minimalist movement earns its trajectory.
  Generic role wording does not override conflicting identities or endpoint lists.
  Typed Case/feature assignments now use the same source/recipient composition
  rule as theta assignments, recovering the three missed Opus Case claims.
  Generic government, untyped `role` values, unsupported claims and unpaired
  arrays remain neutral. No model prompt or authored record changed.
  Theta letters are allocated across the plan by exact argument/root identity;
  separate grids no longer independently restart at `i`. Authored indices are
  reserved, with a proven movement identity reusing its unambiguous authored
  letter. The six saved Opus/Grok/Sol bundles retain all 240 Replay frames.
  Browser checks cover each frame for non-finite geometry and neutral
  connector/role-label collisions with feature plaques and theta grids. The
  newly recovered Minimalist movement exposed a long connector stem crossing
  a tall plaque; below-tree placement now reserves the whole straight stem,
  choosing the nearest clear column instead of sinking below its estimated end.
  Focused movement, Case and index captures, zoom/Next/Fit checks and a narrow
  clearance check passed. The full offline gate passes 1,693 tests and both
  parse-contract fixtures. Review evidence remains outside the repository in
  `/tmp/babel-sept17-review`; this does not establish universal collision freedom.
  **Reflow reviewed and accepted on September 17:** both sides of the X-bar
  movement retain the model's three-way branching. Moving the full subject
  subtree and leaving its compact lower occurrence redistributes layout space.
  Francis accepts the resulting movement of `were`. A temporary prototype that
  retained surrounding branch positions was rejected because it preserved wider,
  stretched branches. It was not merged; preserve the current production layout.
  This transition is not an outstanding renderer defect.
  Tier-3 crowding and persistence remain discussion-only. Fresh provider calls
  remain unauthorized for this pass.
- The CI gap in Program 5 is closed: the workflow now runs `verify:all`, including
  typechecking, and the existing release asset/link check alongside build and
  dependency audits. No new test framework or product behavior changed.
- The separately authorized Sol pair is complete at `76c573b`: two successful
  public-route requests, valid JSON with zero repairs, 78 inspected Replay frames,
  and an estimated $0.417014 from reported usage. Exact requests, all 68
  creation/poll responses and originals are retained. See the
  [Sol findings](docs/implementation/contract-qualification/system-audit.md#sol-admission-pair-15-september).
- Three small Replay defects are repaired: relation-owned construction no longer
  emits an empty preceding step; hidden future parents cannot silence current
  words; and the opening lexical selection fades in. All 77 resulting Sol frames
  were checked in the app. Tree dimensions, plaque positions and camera bounds
  remain unchanged at two desktop sizes; `verify:all` passes 1,665 tests.
- Shared category reading now preserves feature annotations while applying the
  existing casing and structural rules. Explicit prior-source direction and exact
  occurrence changes recover the affected Sol movements without new relation-name
  aliases. The existing pending-CP deferral now applies, and later licensing cannot
  repeat the same movement transition. The two Sol Replays contain 76 frames.
- The follow-up audit measured all 76 current Sol frames in production Replay.
  Within each authored stage, existing node coordinates and the camera remain
  unchanged. No invalid geometry or browser errors were found. C-first selection
  is acceptable to the user; it is not an outstanding defect. No further camera
  or layout change is justified by these records. Structural checks across all
  eight saved analyses cover 283 frames: no empty structural steps or relation
  moments without any available current participant. The intentionally deferred
  unary landing parents remain visible in authored inspection, not early Replay.
- The multi-source audit confirms a drawing limit, but corrects its earlier
  classification as a safe pairing fix. One feature source can address several
  recipients; multiple sources fail the recipe's single-source limit. Equal-length
  source and recipient lists do not distinguish separate pairs from a collective
  relation. Same-name literal/anchor pairing identifies each recipient's literal,
  not its source. The prompt specifies matching order *when* entries pair; it does
  not make every equal-length pair of entries pairwise. No recognition change is
  justified without evidence of that association. Keep the existing fallback.
  Independent relations can already express separate pairs, with separate Replay
  moments; this does not solve simultaneous bundled pairs. Defer a new association
  encoding until that need is demonstrated and its contract is agreed. Sol's
  separately named subject/object Case fields do not establish pairing either;
  prefix guessing remains excluded.
  Renaming occurrence IDs and reversing field order preserve recognition and
  Replay order across all eight saved analyses, covering 138 relation comparisons.
- The two confirmed panel defects are repaired. Movement Source descriptions use
  the transition's proven preceding occurrence: Sol X-bar frames 36 and 39 now
  name did / which book rather than I-trace / DP-trace. Missing or ambiguous prior
  identity cannot substitute the current lower occurrence. Selection shows only
  its existing frame-aware heading, removing the redundant workspace Result that
  capitalized Which while the tree and heading said which. Broader authored text
  is preserved verbatim; this is not a new casing rule for model prose.
- The user-approved panel presentation is implemented: construction uses compact
  notation such as `V + DP → V′` and `N′ → NP`, with only the involved objects.
  Existing replayKind distinguishes Construction from Relation while preserving
  authored titles. Exact same-name, same-length current anchors and values share
  rows; repeated items, empty literals, unrelated values and prior anchors remain.
  Stage Record has one heading. Five focused regressions and the full offline gate
  pass. Matched browser checks cover all 76 Sol frames: SVG paths, group positions,
  labels and camera transforms are unchanged, with no invalid geometry or errors.
- Replay panel wording and role labels now follow the approved presentation.
  Plain camelCase names receive conservative display spacing; previous references
  read `role (previous stage): participant` in their existing rows. Missing or
  ambiguous participants, empty lists and empty literal strings remain distinct.
  Authored records are unchanged. Source/Landing retains specifier/complement
  descriptions for matching X-bar projections, including reversed branch order;
  it no longer calls an arbitrary first-child T head Spec,TP. All 1,680 offline
  tests, typecheck, both contract fixtures and the release asset check pass.
  Desktop browser checks cover 283 saved frames and all six fallback topologies:
  syntax positions and camera fits match the baseline, with no role/label
  collisions or invalid geometry. Zoom, Fit and the main app Replay route pass.
  This does not claim exhaustive layout correctness or mobile readability.
- The role-label stress pass covers 12 temporary controls: long names, repeated
  participants, dense fans, multiple roles on one node, successive relation
  moments, paired lists, Unicode and previous-stage references. It reproduced
  one clipped long label despite available space above its node. Placement now
  considers the existing fitted viewport and nearby vertical space before
  accepting an offscreen position. Font size, tree layout and camera fitting are
  unchanged. Only that label moves in the controls; all 283 saved frames and 133
  Orchard control frames retain their syntax/cameras, with no measured text
  collisions or invalid geometry. Dense fan paths clear role text; reveal,
  reverse playback, zoom and Fit checks pass. Text that cannot fit remains intact
  for panning; this is not an exhaustive packing or mobile-readability claim.
  The regression, full 1,681-test gate and rebuilt Orchard asset check pass.
- The authorized construction/relation prompt clarification is implemented.
  The old paragraph required connected-operation order to be represented through
  ordered relations and the workspace. It now permits order recoverable from
  workspace changes and independently required relations, and explicitly tells
  the model not to add relations solely to narrate Replay construction. The
  existing ordinary-branching exclusion, open names, framework guidance and
  intermediate-stage requirement are unchanged. This removes an instruction
  tension; it does not establish the cause of Sol's output or prove future model
  compliance. Saved records and renderer behavior are unchanged. The existing
  prompt contract test covers the boundary; `verify:all` passes 1,676 tests,
  typecheck and both fixtures. No provider calls were made.
  `server/babelParser/systemInstruction.js` SHA-256 changes from
  `9ec816b0a0149bba9e0e52fe2c3e10c97609369ab063ae6fd62a27a451ccabc6` to
  `d33c4b9cd75f03de2e96294bb81337da2fd27b2a7cdb7c94cf8e8a8299a72b2e`.
- **Completed: Orchard fidelity restoration.** The production
  Tier-3 painter used oversized marks below labels and scalar links through the
  tree; the Orchard used small measured side marks and links below participant
  subtrees. The repair transfers that allocation and paint into production and
  removes the separate Orchard painter. All six fallback cards now exercise the
  app's renderer. The 55 specialized cards preserve their geometry and styles
  through this repair; the additional reproduced Fission text overflow uses the
  existing literal-preserving wrapper. Browser checks cover all 61 cards and
  badge clearance/valid geometry across 283 saved Astra, Fable, Grok and Sol Replay
  frames. Fable's previously documented inspection copies remain distinct from
  the original records. Numbering, authored participants, recognition and Replay
  order are unchanged. `npm run orchard:build` rebuilds both published copies
  together; the release check rejects differing bundles. Focused regressions,
  all 1,675 offline tests, typecheck, both normalized fixtures and the release
  asset check pass. Manual zoom and the Sol relation reveal sequence preserve
  complete badge groups and existing mark positions; a 390px viewport check
  found no badge/label collision, without claiming general mobile readability.
- **Accepted follow-up: authored Tier-3 role labels.** After restoration, Francis
  approved replacing locators with role text, including the fan. The implementation
  keeps the approved connectors, list positions and timing, clears fan lines around
  labels, and removes backward triangles. Previous-stage participants remain in
  existing panel rows. The checks above cover this follow-up. The following literature notes
  retain the earlier research and proposal history; their references-only design
  is not the current accepted presentation.
  Sol Minimalism
  frame 33 adds the existing `Anchor rail` organizational companion to a Tier-3
  claim; its missing joining lines are restored from the existing Orchard notation.
  The broader Tier-3 presentation remains open for user review. Its principal
  problems are large neutral joining lines, repeated context beside recovered
  drawings, and weak correspondence between canvas locators and panel rows.
  The 16 September literature review supports keeping the fallback capability and
  evaluating participant references with complete authored panel content, without
  generic joining lines. This is a proposed interface design, not an established
  linguistic notation or an approved renderer change. In the reviewed sources,
  underspecification has defined semantics: [FUDG, Figure 4](https://aclanthology.org/W13-2307.pdf#page=5)
  asserts connected subgraphs; [quasi-trees, Figure 1](https://aclanthology.org/P92-1010.pdf#page=2)
  use dotted links for dominance; [UD dep](https://universaldependencies.org/u/dep/dep.html)
  still asserts a directed dependency. These do not license arbitrary neutral
  edges. [Beck et al., Figure 1 and section 4](https://aclanthology.org/2020.law-1.6.pdf#page=2)
  distinguish ambiguity, uncertainty and error; Babel lacking a drawing does not
  make the model's claim uncertain or incorrect. [Mazziotta, Figure 4](https://aclanthology.org/2021.depling-1.8.pdf#page=5)
  explains how diagram choices convey different information. No universal
  unknown-relation symbol was found in this bounded review. Compare the proposed
  references with current Tier 3 on saved cases before changing its contract.
  Preserve every participant, group, repeated occurrence, prior witness and
  literal, along with accepted numbering and known specialized drawings. No new
  participant-free graphic or uncertainty field is justified by this research.
  Current X-bar frame 40 combines `Movement curve` and `Variable-binding path`
  for licensing after the owning movement frame, without moving the tree again.
  Both claims have separate supporting evidence. Endpoint coincidence alone does
  not justify deleting either drawing; composition remains a design review.
- Keep model-analysis questions separate from rendering repairs: Sol Minimalism
  leaves object Case unexplained, gives only a brief account of why the wh edge
  does not intervene for subject raising, and mixes Bare Phrase Structure prose
  with primed category notation. The explicit no-primes instruction was removed
  in `e17fc88`; the user rejects restoring it, including a narrow replacement.
  Keep framework guidance open to the model's analysis. Its final convergence claim does not settle
  those questions. X-bar's government and locality assertions likewise require
  qualified review, not automatic certification by Babel.
- Keep future recognition repairs grounded in occurrence identity and structural
  evidence. Do not substitute additional aliases, isolated CP exceptions, or
  endpoint-only connector deletion. The latest shared repairs pass 1,671 offline
  tests. All 76 Sol frames render without invalid geometry or browser errors;
  matched desktop captures and zoom checks cover the affected drawings and timing.
- **Agreed public/research failure boundary:** Public Babel should normally
  deliver a complete usable analysis. Structured-output recovery is acceptable
  in principle, but must not change the model's linguistic analysis. If no
  trustworthy result can be processed, show a brief, clear failure diagnostic;
  unfinished stages are not the normal public result. Research and benchmarks
  preserve the original output and processing failures, with usable partial
  stages available for inspection. Recovery must not turn a failed original
  into a successful benchmark record. The exact permitted JSON transformations
  and automatic-use rules remain undecided; this agreement does not change the
  current decoder or authorize a new repair helper, retries or provider calls.
- Keep Fable's unknown generation-side failure cause and the permitted automatic
  JSON repair transformations open. Existing evidence establishes what
  arrived, not why it was generated. Do not repeat unchanged offline probes as
  though they can supply missing provider evidence or establish prevention. The
  successful Grok and Sol requests needed no JSON repair; they reduce concern
  about a universal failure but do not establish a prompt-related cause for Fable.
  Retained morphology and varied inputs still need separately approved runs.
- Preserve accepted rendering. The remaining extreme/slower-device/mobile checks
  are bounded follow-ups, and hosted verification belongs before deployment.
  The Sol findings justify focused repairs, not a general renderer or camera
  rewrite. Its apparent post-Fit curve change disappears after settling. The old
  X-bar 40→41 syntax jump is repaired with movement ownership: the corresponding
  39→40 frames now retain both node positions and camera. The follow-up above
  checks syntax positions as well as the camera across both complete Sol Replays.
- Programs 2–6 still contain the durable Tree Bank, shared public/research app,
  research workspace, operations and archive/corpus work. Benchmark Programs 7–8
  remain deferred and do not block shipping.

Compiler diagnostics remain in inspection evidence, never in the Replay bar.
The inspection-only `Audit` rows were removed after Francis rejected that
placement; retaining diagnostic evidence did not authorize adding it to Replay.
The authorized Grok admission pair is complete. Both successful outputs contain
valid JSON and needed no repair. Original response bytes, request provenance,
usage and inspection records remain in the local qualification archive. The
successful runs used a corrected verification transport. The later native-fetch
repair passes local 310-second header/body waits through both public entries;
live provider and hosted conditions remain unverified. The interrupted first
attempt has no usage receipt, so its charge remains unknown. No further provider
calls were made for the repairs below.

The first five general repairs from that audit were:

- Complete all owned children when a relation attaches a new container whose
  shell was already inserted. Unrelated future additions remain hidden.
- Schedule a neutral primary from its own current/prior evidence, including an
  incomplete registered claim; independent sibling evidence cannot authorize it.
- Attach explicit feature rows to a single unambiguous current participant using
  the existing plaque. Multiple participants still need an authored recipient.
- Interpret generic assignment directions only with explicit domain evidence;
  titles, ambiguous domains and unpaired lists do not supply missing meaning.
- Track the preceding movement occurrence separately from the current lower and
  landing IDs. A new lower ID requires proven prior identity and exact position;
  root lineage and supported landing structure remain required. The original
  silence requirement was subsequently removed as described below.

The integrated desktop comparison covers 209 baseline and 208 repaired Replay
frames across both Grok outputs and the four earlier archives. Grok Minimalism's
new head appears at its owning InternalMerge moment; Grok X-bar's neutral
wh-movement no longer introduces its landing in an earlier selection frame.
All 137 earlier tree drawings retain identical pixels; differences are confined
to the animated Replay slider. No label clipping, panel coverage, within-stage
camera change or zoom/Fit regression occurred in these checks. This is bounded
desktop evidence, not universal readability or mobile qualification. Existing
Grok claims with missing identity, unsupported structure or meaning only in
titles remain neutral; their linguistic omissions were not repaired by Babel.

The follow-up separates movement from pronunciation. A recovered movement can
draw and execute while either copy remains pronounced, preserving each stage's
authored state. An explicit prior source can identify the current lower endpoint
only when that exact occurrence still exists with matching root lineage. Invalid
or repeated endpoint lists remain neutral; exact Tier-1 safeguards are unchanged.
All three Grok Minimalism InternalMerge claims now draw movement. Grok X-bar's
incomplete movement signatures and missing root identity remain inspectable.

Future layout reservation now stops before an attached object changes parent or
retained siblings change order. Borrowing future topology cannot reorder current
children. This fixes the early Grok X-bar switch between movement-landed and base
positions without changing camera fitting. New visible structure may still need
a refit. The integrated comparison covers all 208 frames on each side, with no
label clipping, Replay-panel coverage or within-stage camera change. All 137
earlier frames retain their labels, positions and camera settings; zoom/pan and
Fit pass on all six analyses. Twelve narrow-viewport spot checks also pass.
The subsequent sibling-order guard leaves these saved playbacks byte-identical
to the browser-tested implementation; focused tests cover that additional case.

Numerical movement-copy indices are retained. The two words of a lower moved
phrase share its index; the number does not count movement steps. Other generated
dependency coindices use the existing letter notation, and circled Tier-3 numbers
remain relation locators. No notation replacement was made.

Framework introductions now select the framework and request sentence-specific
linguistic reasoning without endocentricity, branching or label prescriptions.
The base JSON contract is unchanged. Generation provenance hashes the exact new
prompt; saved requests and prose are untouched. Whether this reduces checklist
prose or changes analysis quality requires a future authorized provider check.

Committed in `08b5de4`, the shared label instruction now says, "Label each node according to the selected
framework, preserving the distinctions made in the analysis." This replaces the
blanket instruction to name a projection rather than its head, following Francis's
approval. Node fields and parser behavior are unchanged. The wording asks the model
to retain its analysis's distinctions without imposing one labeling convention on
both frameworks. Its effect on fresh model output remains unverified. The approved
unchanged-workspace instruction now asks for a "reason within the analysis",
allowing a pronunciation or interpretation claim without a tree change. The exact
input requirement and surface-token alignment are unchanged.

The separate [morphology and surface realization audit](docs/research/morphology-realization-audit.md)
is complete at that source revision. Forty-two controls in both frameworks
confirm that early abstract or separate pieces can become final whole words.
All 48 accepted results complete Replay preparation and a Tree Bank snapshot/load
round trip. At that baseline, final separate pronounced pieces could not jointly
realize one input token, and a PF plaque did not override that rule. The approved
`realizations` field now closes that representation gap, with integrated offline
proof recorded below. The audit also reproduced an emptied
prior parent lingering until Stage Record in a neutral transition anchored only
to its removed leaves. That defect is now visually confirmed and repaired: an
absent prior container leaves when its last owned child leaves. A surviving child
or a parent retained in the authored current forest prevents cleanup. Tests cover
nested ancestors, changed roots, overlapping claims, ambiguous identity and
independent workspaces; originals remain unchanged. The later no-prior audit found
missing transition-ownership evidence, already expressible through `priorAnchors`.
It does not justify a new field or assigning causation from a structural change.

The completed notation/timing pass repairs four reproduced defects:

- Gap notation reuses its exact owned display terminal, including allocated-ID
  collisions. Grok X-bar's extra floating `did` disappears; the authored lower
  occurrence remains. This is Tier-2 notation reuse, not movement recognition.
- Generic gap labels and coindices retain their accepted automatic-Fit size, then
  scale with the tree. Their stack spacing uses the same Fit reference across
  zoom and redraw. Native Orchard paint and circled Tier-3 sizing are unchanged.
- A neutral relation that already owns an exact phrase's relocation can reveal
  its waiting unary projection with that attachment. Earlier projection anchors
  prevent deferral. Grok X-bar now has 40 frames; CP first appears at its wh
  relation, frame 37, instead of the deleted premature projection step.
- Established movement chains receive stable, separate numeric indices from the
  full authored history, with both endpoints marked after their relation moment.
  Unrelated relation positions and drawing tiers do not assign those numbers.
  Numeric authored indices take precedence, generated indices avoid collisions,
  and conflicting authored indices are not repaired. Existing alphabetic trace
  typography is unchanged. Historical links resolve against their actual stages.

The integrated comparison checks 208 before and 207 after frames across the six
saved analyses. No label clipping, Replay-panel coverage, within-stage camera
change or browser error occurs. Zoom/pan/Next/Fit pass on all six; twelve narrow
spot checks pass. A separately labelled notation control confirms unchanged
initial sizing and proportional zoom with stable stacked positions after redraw.
These checks do not approve every possible annotation composition or viewport.

The later circle-badge repair preserves the complete Tier-3 group at its accepted
automatic-Fit size, then lets it scale with the syntax. Previously, four times the
tree zoom enlarged I from 16 to 63 pixels while its circle changed only from about
18 to 20 pixels. The repaired circle grows from about 18 to 72 pixels. Its number,
array position and backward cue remain in the same coordinate group. Stack offsets
and owned connectors use the Fit reference on redraw; dependent rails retain their
clearance. All 207 saved frames keep the same syntax positions and camera settings.
The browser comparison also covers 2×/4× zoom, backward/forward redraw, Fit and
eight narrow checks. This is a badge repair, without a tree-layout change.

Shared evidence-based participant recognition was deferred in that pass. No aliases,
new role interpretation, movement acceptance rule, prompt change or provider call
was added in this pass. Grok X-bar's wh signature and I-to-C identity/shape limits
are assessed in the [15 September recognition audit](docs/implementation/contract-qualification/system-audit.md#recognition-evidence-follow-up-15-september);
display timing does not certify them. Its four bounded shared-rule repairs are now implemented and verified.

Previous checkpoint: the 1,588-test cleanup removed 71 source-spelling, import-list, quantity-only and
redundant checks. Behavioral, data-preservation and declarative paint checks
remain; the useful verdict-geometry and agreement-paint tests moved into their
focused files. Product code, fixtures and rendering are unchanged. The test count
is an inventory, not browser visual approval or live-provider qualification.

Previous functionality checkpoint: request-disconnect cancellation is committed in `898626d`.
Both HTTP entry points pass scripted disconnect checks across all six enabled
models, including stalled bodies and bounded remote-cancellation failure. Ordinary
request completion, deadlines and subsequent parses remain usable. The full gate
passes 1,659 tests, typecheck and both fixtures; build and asset checks pass.
Extended Replay checks cover 64–192 stages, sampled worker memory, 40 large view
cycles and 15 cancelled preparations. No renderer change was justified or made.
The authorized large-derivation/request-lifecycle pass is complete within these
offline bounds. Provider runs, hosting changes and processing-policy decisions
await discussion with Francis. See the [extended checks](docs/implementation/contract-qualification/system-audit.md#large-replay-lifecycle-checks-14-september).

Previous checkpoint: registry lookup indexing and Replay traversal/reuse changes
are committed separately in `95bc928` and `1118817`. The full offline gate passes
1,650 tests, typecheck and both parse fixtures; production build and asset checks
pass. Complete preparation output matches in 234 comparisons covering 1,967
frames. All 137 archived desktop frames retain identical geometry. Three-run
browser medians for 64/96/128-stage controls fall from 2.8/7.9/12.6 seconds to
1.1/2.9/6.0 seconds. Startup, typing, Notes and saving did not expose another
bottleneck in these local checks. A 100-record Tree Bank opens in about 56 ms;
all 25 workers terminate across 12 view-switch cycles, without obvious runaway
main-page heap growth. These bounds do not qualify peak worker memory, slower
devices or hosted deployment. See the [measured pass and limits](docs/implementation/contract-qualification/system-audit.md#measured-optimization-pass-14-september).

Previous checkpoint: the delayed loading mark and bounded plaque text measurement
are committed separately in `dca6237` and `d2fc4ba`. The full offline gate passes
1,643 tests, typecheck and both parse fixtures; the production build and asset
check pass. All 137 saved desktop frames and nine ordinary/extreme plaque controls
retain identical geometry. Four larger controls with 80–128 stages complete in
3.9–12.6 seconds, with observed animation-frame gaps below 100 ms. They expose
remaining CPU work. That pass also treated all-rows printing as unfinished work;
Francis rejected that requirement on 14 September. A preview is sufficient, and
the complete saved record remains accessible when reopened. No all-rows print
design is required or planned.
See the [extended evidence and limits](docs/implementation/contract-qualification/system-audit.md#extended-offline-checks-13-september).

The preceding Fit and worker commits are `3f49461` and `46e4930`. Their 64-stage
controls reduced maximum animation-frame gaps from 2.6–2.8 seconds to 30–40 ms;
total preparation remained about 2.8 seconds. The larger checks extend this
evidence without claiming that compilation is now instant.

The following paragraphs preserve earlier integration checkpoints. The table and
work order below are the current disposition of the complete starting-point list.

The accepted prototype was integrated into main together with the separately
reviewed Tree Bank thumbnail fix. The combined full gate passes 1,577 tests,
typecheck and both parse fixtures; the production build passes. All 137 saved
desktop Replay frames match the accepted prototype exactly, including camera,
labels, paths, plaques and panel content. Do-support, WH participant reveal,
backward traversal, settled zoom and Fit retain their verified behavior.

The merged app also passes eight desktop Tree Bank save/preview/reopen cases:
four archived bundles in Canopy and Replay. Saved standalone SVGs retain the
live paint and labels, the stored stages are unchanged, and reopening restores
the expected Replay count. No provider call or push was made. The unrelated
local AGENTS.md edit was subsequently committed separately in `a88b2f4`.

That integration's review preview was `/tmp/babel-merged-candidate/index.html`.
This merge supersedes the earlier prototype-only checkpoint in the audit.
Remaining renderer and linguistic qualifications below are still open.

The earlier 13 September reliability pass added two bounded repairs: paired literal
fields no longer select an ambiguous spelling by property order, and recursive
layout comparisons no longer build exponentially escaped strings. The full gate
passes 1,582 tests. All 137 complete serialized Replay frames and render plans
are unchanged; 139 desktop browser comparisons, including zoom/Fit, also match.
No layout policy, prompt, JSON repair or incomplete-processing policy changed.
The [reliability audit](docs/implementation/contract-qualification/system-audit.md#reliability-audit-13-september)
records that pass's clipping control and measured long-derivation limits.

The subsequent authorized implementation contains plaque overflow, shares tree
indices within each relation evaluation, interprets qualified assignment roles
through shared evidence rules, and records generated-node ownership explicitly.
The gate passes 1,595 tests. All 137 saved frames and two zoom/Fit comparisons
retain identical desktop appearance. Existing Replay events are unchanged apart
from added internal ownership metadata. Two Fable Case diagnostics now identify
the candidate target role; missing literals still prevent a specialized drawing.
The combined 64-stage benchmark improves from 11–12 seconds to about 8.2 seconds.
No persistent cache, provider call or processing-policy change was added.

Francis rejected the subsequent general Replay repair because its coordinate
planner changed overall spacing and fitted sizing. That entire repair has been
reverted to the exact preceding source. Its 1,572-test gate and browser measurements
remain historical evidence, not visual approval or current implementation status.
Francis subsequently requested a proper repair while objecting to the changed
size, branch lengths, stage movement and detached plaques. The replacement only
changes neutral-participant binding and reveal. It preserves the restored layout,
camera and plaque placement; it does not reinstate the rejected coordinate planner.
Francis subsequently accepted the current prototype's appearance. Desktop is the
current priority; mobile qualification is deferred. Preserve this version's sizing,
fitting and plaque attachment. The historical future-position approach is a lead
for later stability work, not a reason to change the accepted preview now.

Francis then reported the specific Astra X-bar F35→36 do-support stretch and
authorized a small general repair. The cause was per-stage width/depth budgeting
and refitting, not the PF plaque's bounds. Consecutive stages now share dimensions
and fit only when their exact authored structure and ordinary node positions agree.
They retain the first stage's dimensions; upcoming content contributes to the fit
before reveal. New structure or incompatible positions starts a separate layout.
The candidate retains all 30 existing labels, branch geometry and four persistent
plaques across do-support, including zoom, backward navigation and Fit. All other
135 saved desktop Replay frames match the accepted preview. Francis accepted this
prototype for committing; the other movement-related shifts remain open.

Historical prototype checkpoint, superseded by the integrated checks above:
all four archived bundles were checked through production Replay in that
prototype: 137 frames at each of desktop and mobile sizes, plus 80 backward
revisits. The checks found no plaque/tree intersections or plaque clipping in
those saved cases. Small plaques reserve local space, large plaques use reserved
space below the terminal words, and Case connectors remain short. The restored
stage-size repair fixes Astra Minimalism F29→30, but other topology-related shifts
and active zoom/Next remain open. The narrow repair shows C's neutral badge in the
wh-licensing frame. All 274 before/after frame comparisons and four zoom/Fit pairs
retain identical camera transforms, labels, branch paths and plaque positions.
Arbitrary long-content readability remains unqualified. The
[latest evidence and limits](docs/implementation/contract-qualification/system-audit.md#prototype-and-main-reconciliation-12-september)
supersede the earlier browser-blocked status below.

| Starting-point items | Current disposition | Remaining work |
| --- | --- | --- |
| 1–4, 17: badges, plaques, generated indices and mixed drawings | Saved-case composition passes in the integrated app. Generated dependency coindices use letters; movement-copy indices retain numbers, and circled Tier-3 numbers keep their approved locator meaning. Extreme plaques through 200 rows retain their text and save/reopen correctly. Static previews need not include every row; no all-rows print design is required. | Circled Tier-3 zoom is repaired with its fitted appearance and numbering preserved. Mobile readability remains open; extreme Fit readability is not universally approved. |
| 17: Replay stability | The restored stage-size repair fixes F29→30; bounded continuity fixes Astra X-bar F35→36. Active-gesture redraw and Fit ownership defects are repaired. Manual zoom survives Canopy/Replay preparation. Five remaining within-stage shifts in earlier captures accompany structural movement; current Replay already reserves future positions. | Preserve accepted sizing and spacing. Assess a movement shift only if it is a reproducible visual defect; newly introduced structure may legitimately require movement. The theta-grid containment control, ordinary plaque geometry and all 114 name-variation Replay checks retain their prior qualifications. |
| 6, 16–17: empty relation moments | Available neutral participants survive independently. All 36 relation moments in the original Astra/Fable corpus have at least one available participant. A controlled future-only claim produces an authored timing conflict. | Do not design a participant-free graphic until a legitimate case is established. Preserve conflict diagnostics, authored order and unavailable-syntax hiding. Publication-notation research is conditional on a real need. |
| 5–8: interpretation and neutral content | The original four Astra/Fable records contain 22 relations with neutral content. The later cross-family audit covers all 59 registered entries and all 52 Tier-2 recipes; shared value/identity handoff, optional slot equivalence and claim-scoped checks are repaired. The current 1,109-pair matrix has 1,070 complete combinations, 37 competing role cases, one competing PF-input pair and one absorbed phase-edge claim; the earlier 42 mixed controls remain historical evidence. | The [15 September follow-up](docs/implementation/contract-qualification/system-audit.md#recognition-evidence-follow-up-15-september) records four shared-rule repairs, now implemented and verified. Grok wh has usable structural evidence; I-to-C remains limited by missing identity and unsupported landing shape. Preserve negative controls, exact field ownership and missing-literal boundaries. The model authors the linguistics. |
| 9: generated identity | Generated words, lexical display IDs, workspace roots and layout placeholders carry explicit ownership. Compilation reserves authored IDs from every stage; scheduling and label attachment do not parse suffixes. Collision and renamed-archive regressions pass. | Preserve opaque authored IDs when adding future display objects. |
| 10–12: repair and incomplete processing | Inspection preserves originals, usable evidence and diagnostics. Saved HTTP/text hashes reconfirm Fable's omission before Babel processing; its generation-side cause is unknown. | Investigate before changing delimiter repair or public handling of malformed JSON, mixed analysis outcomes, unresolved structure, surface mismatches and extra roots. Distinguish facts, hypotheses and prevention evidence. No helper or paid experiment is authorized. |
| 13–14: simultaneity and judgments | Separate authored relation moments remain the accepted default. | No contract change for simultaneity. Consider it only if an extremely simple unchanged-contract solution is worthwhile. Existing local licensing checks require explicit outcome and participant evidence. Request completion and convergence prose do not produce a check mark; regression tests protect this distinction. No new verdict design is planned. |
| 15–16: linguistic review and old chronology | Original conflicts remain inspectable, including Astra X-bar F32 wh licensing before its landing. | Review these claims for benchmark scoring or gold-corpus use; an individual model linguistic mistake is not a product shipping blocker. Investigate a demonstrated prompt-induced degradation separately. Do not silently rewrite the originals. |
| 18: operational qualification | Both HTTP entry points now cancel pending transport and retry waits when a client disconnects; stalled headers/bodies time out without regeneration. All six enabled models pass scripted public-route disconnect checks. Native-fetch header/body waits complete after 310 seconds through both entries. Large Replay controls complete through 958 frames; sampled worker memory, 40 large view cycles and 15 cancellations pass their bounded checks. | Live cancellation, revised-prompt compliance/cost/latency, slower devices and deployed worker/proxy behavior remain unverified. The checked-in Vercel ceiling is now 960 seconds for the default 900-second provider budget; compatible hosting still needs qualification before deployment. Further speed work needs a measured bottleneck and exact-output preservation. |
| 19: review and consolidation | The accepted prototype and Tree Bank fix are reviewed, committed and integrated into main. The combined offline gate and desktop Replay/Tree Bank checks pass; Fable was waived. | Keep the rejected attempt and remaining defects documented. Broader qualification remains open. |

Current closeout and remaining work:

The requested large-derivation and stalled/disconnected-request pass is complete.
The morphology audit and approved implementation are complete. The work below
records the remaining scope; unsettled designs and provider/hosting changes await
discussion with Francis.

1. **Circled Tier-3 zoom: complete.** The complete badge grows with the syntax
   from its unchanged fitted size. Focused geometry and production browser checks
   cover stacked marks, connectors, backward cues, zoom/redraw and Fit. Locator
   meaning, Orchard paint and tree layout are unchanged.
2. **Emptied-parent transition ownership: complete.** Browser confirmation and
   the narrow repair remove exhausted prior containers at their owning relation
   moment. Unowned siblings, authored empty parents and independent workspaces
   survive. The 84 morphology controls change only the targeted leaf-anchored
   case in each framework. The no-prior audit now confirms that a structural difference alone does not
   prove which relation transforms it; existing `priorAnchors` can supply that
   evidence. Preserve current annotations and unowned structure. The missing
   conflict diagnostic for later-owned neutral outputs is now repaired below.
3. **Final morphology representation: implemented and verified offline.** The
   [contract reuse check](docs/research/morphology-realization-audit.md#contract-reuse-check-and-proposed-extension)
   tests 52 records in both frameworks. The previous fields could not give retained
   pieces a collective final realization with their existing meanings. Optional
   stage `realizations` now supplies groups containing current `nodeIds` and input
   `tokenIndices`, while ordinary records retain the current path. The approved
   rules define source coverage, disjoint target coverage, inherited silence and
   exact Replay ownership; use intermediate stages for ambiguous timing. The
   model-facing instructions now explain omission, regular pieces and irregular
   abstract realizations. The 1,641-test gate, production build and release-asset
   checks pass. All 207 archived frames preserve complete Replay data and browser
   geometry; 14 new control frames, the actual worker and Tree Bank save/reopen
   pass. All six enabled model routes preserve groups and exact input in both
   frameworks under mocked responses. Fresh model authoring remains unmeasured.
   An existing preterminal comparison incorrectly equated `√WALK` with `walk`
   after stripping symbols. It now preserves notation in distinct category labels;
   the authored preterminal and its word both remain visible. Keep topology,
   tokenization and independent PF-ordering work separate.
4. **Prompt clarification: implemented.** Keep the approved framework-sensitive
   label wording in `08b5de4`. The unchanged-workspace instruction now permits a
   sentence-specific `reason within the analysis`. The model still derives the
   exact submitted input, including an ungrammatical input, and explains its
   judgment. This does not alter surface alignment. Fresh-output quality/compliance
   under the revised prompt remains unmeasured.
5. **General shared recognition: implemented and verified.** The
   [recognition evidence follow-up](docs/implementation/contract-qualification/system-audit.md#recognition-evidence-follow-up-15-september)
   led to exact-ID lookup throughout parsing/Replay/rendering, guarded cyclic
   agreement with visible authored outcomes, one movement validation path, and
   structural binding of uniquely proved anchored movement participants. Tier 1
   retains every required group; the verified lower occurrence may itself supply
   its witness. No new aliases, contract fields, inferred silence or syntax.
   Registry version 14 records the interpretation change. The 1,660-test gate,
   build and release assets pass. All 207 archived frames and 24 control frames
   were checked before/after in production Replay; only Grok X-bar frames 37–40
   change archived geometry for the recovered wh drawing. Zoom, Next/Previous,
   Fit and four narrow cases pass. A focused follow-up verifies cyclic outcome
   labels in both tiers and their shared zoom group. Grok I-to-C still lacks
   occurrence identity and supported landing structure; keep it neutral.
6. **JSON and incomplete processing.** Preserve malformed originals and historical
   chronology diagnostics. Fable's missing ending is confirmed before Babel;
   its cause remains unknown. Delimiter repair and public treatment of malformed,
   mixed-success, unresolved, mismatching and extra-root records stay unchanged
   pending evidence and agreement. No helper or paid experiment is authorized.
7. **Request and Replay timing repairs: implemented and verified offline.** The
   [15 September audit and repairs](docs/implementation/contract-qualification/system-audit.md#approved-repairs-and-verification)
   align provider transport with Babel's existing deadline and cancellation.
   Native header/body waits now complete after 310 seconds through both public
   entry points; all six enabled routes preserve successful output, cancel local
   connections, and retain bounded partial provider bytes on terminal read failure.
   Partial envelopes are marked incomplete and never treated as model JSON.
   Neutral transition ownership now participates in conflict diagnostics; authored
   order, tree geometry and all 207 archived Replay frames remain unchanged.
   The full offline gate passes 1,663 tests. No paid calls were made.
   Live cancellation/billing, deployed worker loading and proxies remain unverified.
   The Vercel configuration now allows 960 seconds for the existing 900-second
   provider budget and uses Node 24. It requires compatible Pro/Enterprise extended
   duration; no deployment or hosted verification was performed. Fresh provider
   calls remain deferred. Later capped checks need approved purpose/spending,
   exact prompt/config hashes, raw replies,
   usage, latency and processing receipts.
8. **Bounded visual/performance qualification.** Preserve accepted six-analysis
   desktop Replay, zoom and Fit. Mobile and extreme Fit readability are lower
   priority. Large controls through 958 frames complete; the largest takes about
   19 seconds. Profile remaining preparation/transfer/painting costs before
   optimizing, and preserve exact results. No finite matrix proves all open
   relation combinations.
9. **Representation and evaluation boundaries.** Two legacy sharing controls use
   duplicate IDs and are not valid public positive fixtures. Native shared-node
   topology needs separate design. Model linguistic mistakes belong to benchmark
   review, not automatic Babel repair or a shipping veto. Separate relation
   moments and authored judgment versus processing status are settled. No
   participant-free graphic or full-row print design is required. Programs 2
   onward retain the broader product, storage and benchmark work.

See the [dependability follow-up](docs/implementation/contract-qualification/system-audit.md#dependability-follow-up-13-september)
for the classified recognition matrix, performance measurements, public-route
checks, extreme plaque/camera fixes and renewed saved-response investigation.
The preceding follow-up gate passed 1,626 tests, typecheck and both parse-contract
fixtures; the production build and release-asset check passed. All 137 saved desktop frames
retained their accepted geometry, and five app preview cases passed. The current
1,663-test checkpoint above supersedes its gate count. Earlier counts and timings
below are historical checkpoints, not the current gate.

The integrated drawing restoration passes the 1,616-test offline gate, both
parse-contract fixtures, the production build and release-asset checks. The earlier
[shared recognition evidence](docs/implementation/contract-qualification/system-audit.md#shared-recognition-repairs-13-september)
is retained. No model-facing contract, prompt, authored analysis or new linguistic
drawing changed; native plaque extents now contribute to existing stage fitting.

Do not reopen model-owned traces/nulls/wordless heads, whole-phrase silence,
explicit list pairing, complete Tier-1 requirements, smaller Tier-2 combinations,
stage-scoped Tier 3, original-position badge numbering, source-preserving atomic
movement or the completed prompt cleanup. No reading-view button, hidden rows or
Replay-only relocation of plaque content has been approved.

The earlier proposed participant-free locator is withdrawn as a current design
direction. The contract requires nonempty current anchors. A saved-data audit found
no wholly participant-free relation moment; a controlled all-future case is a
chronology conflict. Inspection may retain such an authored claim and its diagnostic
without inventing a linguistic dependency. If a legitimate unsupported case is
established later, research linguistic notation before proposing a Tier-3 graphic.

#### Repair history and evidence

Earlier 12 September baseline: PRs #6-#11 are merged on `main` at `0a8f0cc`.
Codex and Fable completed the
[joint saved-analysis source/frame review](docs/implementation/contract-qualification/system-audit.md#joint-saved-analysis-review-12-september):
23 stages, 36 relations and 137 Replay frames. All 11 movements pass the checked
source/landing timing invariants. After the connected repairs below, the full gate passes
1,509 tests, typecheck and parse-contract verification. Fresh visual
inspection was blocked at that pass. The later prototype verification above
supersedes that limitation for its explicitly checked cases.

Shared-participant preservation is now implemented locally. Mixed neutral claims
keep authored current-participant context, separately from unconsumed
evidence. Verified movement enclosure fields are excluded once the movement
accounts for them. This restores the shared trace/variable in both reported government
cases without inventing government arrows or changing Tier-1 requirements.
The initial pass changed eleven fallback contexts across the saved analyses; all specialized plan
items and 137 Replay frames remain unchanged. This can increase visible badges
within a stage; visual composition was still unverified at that pass.

The approved connected batch is implemented locally: inspection Replay shows
existing diagnostics at the affected relation event; prior participants resolve
against the previous authored tree, with unresolved or ambiguous IDs unchanged.
Generated D3 IDs reserve authored IDs and aliases before allocation. Native
single-value slots and the two uncovered Tier-2 index slots no longer select the
first list item. Agree keeps its full plaque when a Case companion curve cannot
display all its values. Public warnings, the live prompt and saved records are
unchanged in this batch. See the audit's
[connected repair batch](docs/implementation/contract-qualification/system-audit.md#connected-repair-batch-12-september)
for the tests and remaining synthetic-ID boundary.

The subsequent [badge composition review](docs/implementation/contract-qualification/system-audit.md#badge-composition-review-12-september)
used Francis's screenshot and all 137 compiled Replay frames. Stage scoping is
correct in the data, but shared context increases final badges from 7 to 11 in
Astra Minimalism and 4 to 8 in Fable X-bar. It also exposes an accounting defect:
Fable's enclosing CP was structurally checked by movement recovery but then treated
as unhandled. Other head-host roles were unchecked. Both defects are now repaired
locally through shared structural verification and per-field evidence ownership.
Wrong or ambiguous context retains an exact diagnostic; independent claims stay
in fallback. Eighteen new tests cover these boundaries and drawing identity.
All 137 serialized Replay frames and specialized plan items remain unchanged.
Fable X-bar's final badges fall from eight to five; Astra Minimalism remains at
eleven. No prompt, analysis, layout or persistence policy changed in this repair.

At this point the next work was badge/plaque composition and generated-index
presentation. The separate prototype and its later browser evidence are recorded
above. Removing badges from Stage Record remains unapproved. Long-content
qualification, public incomplete-record handling and the broader synthetic-ID
convention remain open; the D3 allocator fix does not close those boundaries.

The subsequent [timing audit](docs/implementation/contract-qualification/system-audit.md#timing-audit-12-september)
found a separate scheduler defect: a later movement can overtake an earlier
ordinary relation when higher structure is built afterward. A conflicting control
also received a false "authored order is preserved" diagnostic. Francis then
approved the scheduler fix and the narrow stage-boundary clarification together.
Both are now implemented locally: relation order controls playback, independent
structural prerequisites can be built when needed, and future movement outputs
stay hidden with an exact diagnostic when an earlier relation requires them.
The prompt asks for an intermediate workspace when that state is needed to
represent the required order. Connected relation-owned transitions may still
share a stage. No timing field, prose interpreter or blanket extra-stage rule
was added. The four saved analyses remain unchanged; their prose-only chronology
is not retroactively repaired. See the audit for checks and exact prompt hashes.

The following dated implementation evidence records the preceding passes; older
test counts and visual checks are not claims about the latest snapshot.
On 10 September the approved preservation/diagnostic work and
connected recognition, native-drawing and Replay repairs were implemented locally.
This includes Tier-3 movement introducing its landing and necessary parent
together, without earning an arrow or relaxing a Tier-1 recipe. Original model
outputs remain unchanged. No new Babel generation or prompt change was made in
this batch.

The [connected repair evidence](docs/implementation/contract-qualification/system-audit.md#connected-repair-and-regression-evidence)
records the completed work and counterexamples found by independent checks and
Fable review. The native FProjection alias regression and missing application ink
styles are fixed. The final full gate passes 1,186 tests, typecheck and both parse
fixtures. Production-browser checks cover the four saved analyses and all 55
current Orchard cards; these are not linguistic certification or complete
coverage of every open relation composition.

The approved screenshot fixes are implemented locally: Select/Project headings
include their targets, the native PF plate wraps its text, future landing nodes
stay hidden, and C is available before head movement. The agreed display rule
introduces the waiting unary top projection with wh movement while leaving the
saved stages intact. Duplicate trace labels and unused badge-slot reservations
are removed. Batch 3 remains partial because the design decisions below are open.
The qualification page uses live production Replay, with explicit
Fable inspection copies kept separate from the failed originals. Measured UI
bounds replace fixed panel assumptions; manual pan/zoom survives frame changes.
The [Batch-3 evidence](docs/implementation/contract-qualification/system-audit.md#replay-and-live-inspection-repair)
records the earlier review corrections and desktop/mobile checks.

The [screenshot-fix evidence](docs/implementation/contract-qualification/system-audit.md#screenshot-fixes-and-presentation-boundary)
records 1,274 passing tests, typecheck, both parse fixtures and 588 checked
desktop/mobile Replay states, with Fable review and regression counterexamples.
Original relation indices also survive unnamed entries without shifting later
headings or links.

The [follow-up visual inspection](docs/implementation/contract-qualification/system-audit.md#readiness-inspection-not-ready)
found plaque/tree overlaps and same-stage camera changes. Francis subsequently
authorized the camera fix and deferred plaque placement and repeated numbers.
The [camera repair](docs/implementation/contract-qualification/system-audit.md#camera-repair-and-deferred-plaque-design)
uses all Replay layouts in a stage to calculate one fit, independent of navigation
order, without changing tree coordinates or drawings. The full gate passes 1,284
tests; 862 app/review browser states show no same-stage camera changes and retain
manual pan/zoom and Fit. The remaining plaque overlaps are not marked solved or
approved. No new stack, hidden content or numbering policy was introduced.

The [lower-DP follow-up](docs/implementation/contract-qualification/system-audit.md#lower-dp-trace-and-stage-transition)
confirms that Fable X-bar authored a compact DP trace; Replay did not discard its
children. Francis confirmed that the model decides this representation. He also
accepted `buy` occupying a different screen position after the stage changes;
that refit is not an outstanding defect. Keep the within-stage camera fix. No
cross-stage camera change or replacement of the model's compact trace is needed.

The agreed offline Batch 4 is implemented locally and reviewed. The
[prompt and provider processing evidence](docs/implementation/contract-qualification/system-audit.md#prompt-and-provider-processing)
records the reviewed wording, retry safeguards, exact diagnostics, 36 saved-output
stub runs, 64 app/review browser states and the final 1,398-test gate. Fable's
concrete verification mismatch was reproduced and fixed; its remaining caveats
are recorded there. No fresh paid Babel generation was made.

The smaller Control, covert-movement, idiom and transferred-domain drawings are
implemented for Tier 2, together with shared interpretation and evidence-ownership
fixes. The
[approval and residual-evidence rule](docs/implementation/contract-qualification/system-audit.md#tier-2-only-approvals-and-residual-evidence)
keeps complete Tier-1 requirements unchanged. The shared pipeline now distinguishes
candidate wording from explicit meaning, preserves malformed optional fields,
keeps residual anchors separate from complete Tier-1 ownership, and passes the
same interpreted evidence to drawing and Replay. Francis rejected suppressing
leftover fallback merely because another part of the same relation rendered.
Recover supported additional Tier-2 pieces and retain unresolved content through
Tier 3. That pass counted 24 neutral primary/remainder claims. The current
prototype count is 22 relations containing neutral content; these are not failed
analyses and must not be deleted to improve a coverage number. Recognition of
arbitrary new wording is not claimed solved.

The [remaining fallback inventory](docs/implementation/contract-qualification/system-audit.md#remaining-fallback-inventory)
records the then-24 entries: 10 wholly neutral relations and 14 mixed
relations, including three remainders with no canvas marks at that pass. It records
that snapshot's Replay frames, missing meanings/literals, justified neutral claims,
complex-head Transfer geometry, and the problem of subtracting shared witnesses
from a relation's remainder. Field ownership is not complete interpretation of
every assertion in a title or prose value. No saved record or rendering behavior
was changed by this follow-up.

The [broad relation-pipeline pass](docs/implementation/contract-qualification/system-audit.md#broad-relation-pipeline-pass)
adds complete original-field evidence accounting and one grouped fallback report
per relation. It fixes original array indices, preserves a registered drawing's
shared outcome, corrects complex-head/PP Transfer checks without crossing into a
different higher head's projection, and repairs missing review output identities.
The screenshot check also exposed and fixed the opaque fill on Binding outlines.
All 52 recipes have broader invariant checks. The 36 saved relations retain their
drawings, tiers and Replay frames; all then-24 neutral remainders gained diagnostics.

The [anchor-list clarification and matching correction](docs/implementation/contract-qualification/system-audit.md#anchor-list-contract-clarification)
are implemented together: open-role wording with no examples, no concatenation of
conflicting joint groups, original-field diagnostics across all recipes, and
preserved independent outlines, labelled plaques and organizational rails.
Prior/current order columns retain distinct meanings. All 36 saved relations
retain drawing content, tiers and Replay moments. Participant/value pairing was
still a contract gap at that point; the 11 September decision below closes it
for explicitly paired entries.

The [hidden-authoring-convention inventory](docs/implementation/contract-qualification/system-audit.md#hidden-authoring-conventions)
compares the live prompt with all 59 production entries, all 52 Tier-2 recipes,
parser/node helpers and Replay. It records affected code and remedies under HC01-HC22.
The approved blocking-evidence and operator/Binding work is implemented, together
with shared outcome aliases, preservation of stage-suffixed IDs, and empty-workspace
semantics. The gate passes 1,445 tests; all 36 saved relation drawings and moments
remain unchanged. The Fable review was an independent audit, not finished-diff approval.

The [node-interpretation and reference pass](docs/implementation/contract-qualification/system-audit.md#hidden-authoring-conventions)
of 11 September makes pronunciation a field-only decision shared by the parser
and Replay: `word` and `silent` decide, spelling and casing of words, labels and
ids decide nothing, and notation styling applies only to leaves that are already
unpronounced. Undocumented node keys are recorded and inert on both layers.
Carried movement endpoints and lineage continuity use exact authored identity;
a relation whose anchors do not resolve keeps its Replay moment with an exact
field diagnostic. The Babel-authored Atlas bank was migrated to the contract
rather than accommodated. The gate passes 1,455 tests; the saved
Astra/Fable Replay steps, canvases and relation plans are unchanged.

Later on 11 September Francis decided the two open node rules and both are
implemented with their contract sentences: silence on a phrase covers every
terminal beneath it on both layers, and per-item literals pair with an anchor
list only through a same-name values entry of the same length (one item with
one literal pairs regardless). He confirmed the reconstructed-surface casing
rule as intended. The gate passes 1,461 tests.

Francis then rejected pre-movement reconstruction: the contract now says an
occurrence moves only from a position an earlier stage already shows, and Babel
restores movement sources only from the preceding stage, exactly as authored.
The reconstruction path, its lowercase rule and the Replay prose classifiers are
deleted. The gate passes 1,461 tests; saved outputs are unchanged.

The five native plates now read plain fields: paired lists, node orders and
open literals, with the pairing sentence widened to any two entries. The Replay
sentence reader follows tree order. The completed hidden-convention repairs do
not establish universal recognition or settle the inventory's remaining scalar,
index-presentation and generated-ID limits. Verify those against current code
before treating the inventory as fully closed.

Tier 3 presentation, decided 12 September: a neutral fallback marks its own
stage only, and its badge number is the relation's authored position in that
stage, matching the panel. Hiding leftover anchors and one-mark-per-relation
were rejected. The later prototype improves plaques, horizontal badge groups,
mixed-tier composition and generated letter indices, with the saved-case evidence
above. General overflow/mobile qualification remains open.
At that checkpoint, free-prose recognition and literal-versus-glyph judgment
presentation remained design questions. Judgment handling was subsequently
settled, and the authorized Grok pair was completed. General recognition remains
under investigation; Astra X-bar's authored conflict stays diagnosed and
preserved. Further paid generation needs a new approved purpose and cap.

The [implementation evidence](docs/implementation/contract-qualification/system-audit.md#stage-preservation-and-diagnostics),
[movement evidence](docs/implementation/contract-qualification/system-audit.md#movement-recognition-and-replay-implementation),
and [role-binding evidence](docs/implementation/contract-qualification/system-audit.md#shared-role-binding)
record what changed and what was tested. The original four provider outputs stay
unchanged. No fresh Babel generation is authorized.

Francis requested larger connected batches instead of another relation-by-relation
sequence. The batches below group the work that already has a clear technical
direction. They do not silently approve unsettled linguistic or display choices.
First resolve any regression found in the accumulated diff. Then carry each batch
through implementation, focused tests, and review before reporting its result.
Small coherent commits are compatible with completing a substantial batch.

| Batch | Connected work | Finding IDs | Completion evidence |
| --- | --- | --- | --- |
| 1 | Preserve the answer and report the actual processing problem | 01-06, 24 | Original bytes, every analysis and original stage remain accessible; field/reference/compilation diagnostics identify the actual location and cause. |
| 2 | Make recognition, existing drawings, and Replay agree | 07-13, 20-22, 30-38 | Independently established participants, values, outcomes and timing reach the same approved drawing through Tier 1 and Tier 2. Unrecognized evidence remains intact. |
| 3 | Make the existing Replay and review UI faithful and readable | 14-19, 23, 25, 28-29 | Correct labels and literal content, native frame controls, measured text bounds, and desktop/mobile layout evidence. Unapproved Tier-3/overflow designs stay separate. |
| 4 | Finish approved prompt wording and verify the actual generation path offline | 03, 26-27, 39 | Wording matches supported fields; production-route tests verify retries, provenance, accounting and end-to-end inspection without new paid calls. |

**Batch 1: preservation and diagnostics**

- Retain the implemented no-stage-loss behavior and exact original analysis/stage
  paths. Extend field diagnostics to malformed optional node fields without
  deleting unfamiliar raw data or adding a public rejection policy.
- Check every current and prior relation anchor against its required expanded
  workspace. Report missing, future-only, previous-only, duplicate and carried
  references at their actual field or array item.
- Keep readable workspace inspection independent of full normalization. Preserve
  all analyses in a mixed response, not just the first failing analysis. A later
  self-contained workspace may be inspected without claiming its earlier
  transition was reconstructed.
- Distinguish JSON decoding, field format, reference resolution, token alignment,
  relation recognition and drawing errors. Do not label normalization success as
  linguistic or visual approval.
- Preserve every repair's exact byte edits and original response. Reproduce the
  saved Fable failures without a new call. The provider's missing `]}` has no
  demonstrated generation cause; do not promise guaranteed prevention or add an
  automatic repair as part of better diagnostics.

**Batch 2: one interpretation from claim to drawing**

- Keep shared role binding, and check its effects across all registered families.
  A complete equivalent expression can earn Tier 1; its whole curated recipe
  remains required. Tier 2 still needs independently complete smaller claims.
- Correct shared data handling before individual families: preserve ordered and
  repeated values/endpoints, retain unused array items, diagnose contradictions,
  and stop deduplication or invented labels from changing the analysis.
- Verify the exact named parents, branches, occurrence identities and projection
  paths. Pass those verified participants to the drawing instead of finding a
  similar object again. Distinguish silence, a trace role and explicit deletion.
- Stop generic licensing, membership, source/target roles or keyword presence
  from asserting an unsupported specialized relation. Keep unfamiliar or
  ambiguous claims inspectable without inventing their missing meaning.
- Complete the already-supported single theta and Case assignments, their
  literal labels and solid/dotted distinction; binder-variable paths without
  an invented scope hull; and the approved Transfer domain plus both accessible
  DP outlines. Keep phase heads distinct from their containing projections.
- Make existing Tier-1 and Tier-2 drawing branches consume the same prepared
  content. Cover theta, Case/Agree, Transfer, PF realization/correspondence,
  projection paths, fission, impoverishment, storage and candidate outcomes.
  Do not claim a drawing supports input it then ignores. Missing groupings or
  unsupported multiplicities remain explicit, not fabricated into a picture.
- Check that the approved paths, labels and shared ink styles actually ship in
  the app, rather than existing only in the Orchard page. Preserve the current
  neutral styling rules; do not import research-page layout or old glow effects.
- Give shared marks one owner within a relation when their meaning and anchors
  agree. Do not merge separate authored relations or erase qualifications.
- Finish movement and later realization together where prior syntax and authored
  relation order establish the sequence. Keep the complete landing, lower copy
  or trace, arrow and necessary new parent atomic. Preserve conflicting saved
  order with diagnostics; do not infer a new chronology from prose.
- Tier 3 keeps the same structural timing when the stages establish the
  relocation: introduce the complete landing and its necessary new parent
  together, without a trajectory. Drawing eligibility and structural timing are
  separate. This does not relax Tier-1 requirements or redesign Tier 3.
- Test all 52 recovery rules with independent positive and negative expectations,
  and their existing 69 pieces through appropriate plan/content checks. Use the
  four saved analyses and broader adversarial probes, not only renamed fixtures.

The complete-claim-plus-extra-context policy is already agreed. Implement it
without treating contradictory core evidence as harmless context. Extra evidence
must stay inspectable; a core drawing does not claim to explain it.
A standalone transferred-domain mark and smaller Control/covert-movement/idiom
drawings are implemented for Tier 2 under the linked evidence boundaries. The
connected regression checks cover smaller and complete drawings, malformed
optional evidence, shared interpretation, mixed ownership and covert timing.
They do not relax Tier 1, invent missing meaning or suppress the same relation's
unresolved Tier-3 remainder.

**Batch 3: Replay and inspection**

Implemented and checked on 10 September for the boundaries below. Long-content
overflow and remaining annotation overlap are not closed by this work.

- Restore External Merge and authored relation names as the primary Replay
  heading. Preserve punctuation, scripts and literal notation such as `x_i`.
- Expose movement values as well as Source/Landing. Use the original relation,
  not a second incomplete summary, for inspectable content.
- Share text measurement between SVG drawing and its bounds. Fix demonstrable
  clipping within the existing design. Do not silently discard rows after eight.
  The choice of an overflow interaction remains with Francis.
- Reuse the production renderer for interactive Replay inspection, including
  frame selection, play/pause, pan and zoom. Keep stage-only inspection clearly
  distinct from complete Replay and original records distinct from repair copies.
- Fix reproduced panel/header/control overlap using their actual bounds while
  preserving one fit per authored stage and manual pan/zoom. Verify desktop,
  mobile, resizing, relation persistence and motion. A layout redesign is not
  implied by correcting collisions.

Tier-3 numbering and stage persistence are settled. Francis subsequently approved
prototyping local plaques with reserved width/height and large plaques below the
terminal words, with placement reserved before their relation moments. That
prototype has the saved-case visual evidence above. General long-content and
mobile qualification remain open. No reading-view button, hidden rows or moving
selected plaque values into Replay-only content has been approved.

**Batch 4: instructions and offline end-to-end proof**

This historical batch is implemented; the evidence linked above includes its
Fable review and subsequent regression fix. Later work measured and reduced
Replay preparation cost and tested queued OpenAI through scripted public routes.
Live-provider and deployed limits remain in the current checklist above.
Neither checkpoint proves prevention of formatting errors or universal rendering
quality. The bullets below preserve the original batch scope, not pending tasks
or a renewed requirement to use Fable.

- Reconcile the existing shorter prompt draft with Francis's wording decisions
  and the actual parser. Finish already-agreed removals and clarifications in
  one coordinated change; do not ask him to reread the same draft. Keep any
  unresolved meaning change separate. No examples, role menus, new relation
  fields, or unapproved provider schemas.
- Enforce the agreed retry limits in the production path: no retry on an explicit
  rate limit, no replacement generation after a received answer fails downstream,
  and at most three total attempts for genuine temporary network/server failures
  within the deadline. Test uncertain timeouts separately; recovering an existing
  response is not another generation.
- Use stubbed responses through each active provider route to check request
  settings, exact raw response and version capture, attempt accounting, repair
  diagnostics, normalization, Replay and review. Common future comparisons use
  ordinary text containing JSON; provider-native formatting is a separate condition.
- Measure local processing and distinguish it from existing provider latency,
  usage and cost evidence. Do not invent missing billing data or claim lower
  reasoning effort is harmless without an approved comparison.
- Add regressions that fail on demonstrated defects, then run the full gate and
  one assembled production-browser pass. Review the resulting diff with Fable,
  including negative cases and remaining limits. Stop every owned process.

#### Decisions that remain

The current work order above owns these decisions:

- General evidence recognition where roles, identity or multi-part associations
  remain ambiguous. Explicit list pairing and the approved smaller Tier-2
  drawings are already implemented.
- Fresh model qualification of the optional `realizations` field for retained
  final morphology. Integrated offline behavior is verified; model authoring,
  cost and latency under the revised prompt remain unmeasured.
- Exact structured-output repair transformations and recovery rules, plus
  presentation of token mismatches or extra final roots. The public/research
  failure boundary is agreed above; Fable's generation-side cause remains unknown.
- Purpose and spending caps for further provider checks, and deployed request
  limits. Mobile and extreme Fit readability remain bounded qualification work.

Circled Tier-3 scaling and the emptied-parent transition defect are repaired
without reopening general layout. A neutral transformation without prior anchors
does not establish which earlier material it owns; the existing field can express
that evidence. No additional scheduler repair is justified by that control.
Separate relation moments,
judgment handling, ordinary plaques, generated coindices, integrated Tree Bank
previews and the decision not to require full-row static exports are settled.

Phrase-level silence and its descendant token-index diagnostic are implemented.
Movement uses an authored earlier source, without reconstructing it from a later
landing. These decisions must not be reopened as unfinished design work.

The model still owns the linguistic analysis, including ungrammatical inputs and
copy/trace choices. Keep the current anchors/values contract. Inspecting imperfect
outputs is already agreed, not a decision to reopen. The
[historical decisions](docs/implementation/contract-qualification/system-audit.md#remaining-decisions)
retain their examples; their former pending statuses are superseded here.

Do not represent this as an exact completion percentage. Some local fixes are
verified, some are partial, and several design decisions remain. Use the row
statuses and evidence below rather than the stale investigation-stage estimate.

The IDs below match the full audit. Close each row only with its resolution and
relevant test or review evidence. If an apparent defect is a legitimate analysis
choice, record why and verify that Babel presents it faithfully. Do not invent
linguistic content to make a row pass. Unresolved rows are not silently waived by
an earlier renderer closeout or a passing fixture suite.

| ID | Status | Work to resolve |
| --- | --- | --- |
| 01 | Implemented locally | Both original Fable outputs now report the exact values field at original stage 3 or 4, before reference expansion. See implementation evidence and `tests/derivationDiagnostics.test.mjs`. |
| 02 | Implemented locally | Stage conversion no longer filters malformed stages. Tests cover earlier bad fields with a complete final tree, unchanged input, and route-level raw retention. Compilation stops with a diagnostic; recovery/public presentation remains undecided. |
| 03 | Implemented; latest wording unqualified | The prompt defines values, references, chronology, inherited silence, pairing and earlier movement sources. The authorized Grok pair used the earlier prompt. Later framework/label wording remains untested with models; further calls require a new approved purpose and cap. |
| 04 | Open | Investigate why Fable's original API text lacks its outer JSON closing characters. Separately establish what each delimiter repair changes and whether any helper is necessary or admissible; prevention first. |
| 05 | Implemented locally | Inspection diagnoses exact current/prior anchor paths, including missing, future-only, previous-only, duplicate and carried references. It preserves all analyses and does not introduce a public rejection policy. |
| 06 | Diagnostics implemented; public policy undecided | Optional node-field types, duplicate token indices and extra final roots have inspection diagnostics. Public handling remains undecided. No linguistic branching validator is planned by this row. |
| 07 | Saved-case visuals checked in merged Replay | Wordless categories use category geometry with the agreed muted silent colour. Overt lexical selection remains intact. Field-based pronunciation and inherited silence are implemented; model-authored wordless heads and compact traces are accepted choices. |
| 08 | Implemented; historical conflicts preserved | Movement retains the preceding authored form and pronunciation until its relation moment. Authored lower forms and phrase silence are preserved. Movement drawing no longer requires a silent lower copy. Saved chronology conflicts remain inspection evidence. |
| 09 | Implemented locally | Saved Internal Merge cases now recover supported movement through shared evidence. Broader ambiguity and false-recognition checks continue under 32-39. |
| 10 | Saved-case repair verified | Future landing nodes remain hidden and earlier sources come from authored prior structure. The combined six-analysis Replay has been checked. The original licensing-order conflict remains diagnosed, not silently reordered. |
| 11 | Saved-case visuals checked in merged Replay | Supported abstract and overt head movements have source/host checks and arrows. Independent C construction is restored. Six-analysis verification is complete within its recorded bounds; Grok X-bar's remaining identity/signature limits belong to general recognition work. |
| 12 | Implemented locally | All eleven saved cases receive the evidenced head/phrasal distinction, including Fable's bare maximal nominal. Positive and negative structural checks are in recoveredMovement.test.mjs. |
| 13 | Saved-case visuals checked in merged Replay | Waiting unary projection appears with its owning wh relocation, including the neutral Grok X-bar case. Earlier independent projection evidence prevents deferral. The combined six-analysis check covers this timing without promoting incomplete movement evidence to an arrow. |
| 14 | Implemented | External Merge and original relation names are primary headings. Select/Project targets were restored in the screenshot fixes, with regression checks. Macro statements remain intact. |
| 15 | Implemented locally | Original relation names, punctuation, scripts and whitespace are preserved rather than passed through identifier formatting. |
| 16 | Integrated; bounded qualification | Reserved local/below-tree plaques and extreme scrolling through 200 rows are verified within recorded controls. Tree Bank save/reopen preserves all rows; static previews need not include them all. Mobile and arbitrary extreme Fit readability remain unqualified. |
| 17 | Implemented locally | Removed the eight-row truncation. Every row retains its original index and literal content; a twelve-row wordless-head control is verified in Node and desktop/mobile SVG. Visibility of a very tall plaque remains under 16. |
| 18 | Integrated; circle zoom repaired | A fallback circle locates the relation's authored position within its stage. Other dependency coindices use letters; stable movement-chain indices use numbers. The complete circle group retains its fitted appearance and grows with the syntax, including stacked marks across redraw. |
| 19 | Implemented locally | A neutral fallback marks its own stage only and returns when that stage is replayed. Tier 1 and Tier 2 retain their persistence. Hiding leftover anchors and one-mark-per-relation were rejected. Later shared-context/accounting repairs supersede the original badge counts; Astra Minimalism ends with eleven badges and Fable X-bar with five. |
| 20 | Implemented locally | Single and explicitly paired theta/Case assignments retain literal labels and repeated participants. Solid assignment and dotted collection remain distinct. Missing or mismatched associations stay neutral; title-only role/Case prose is not converted into missing fields. |
| 21 | Implemented locally | Complete Tier-1 recipes accept equivalent roles and harmless context. Missing or contradictory core roles still fail that recipe. Unused extra anchors receive an aggregated internal context diagnostic; the complete raw relation remains inspectable. |
| 22 | Saved-case visuals checked in merged Replay | Exact phase/projection witnesses, both accessible-DP outlines and the approved standalone Tier-2 transferred-domain mark are implemented. A phase head is not silently promoted, and an incomplete exact Tier-1 recipe is not rescued. |
| 23 | Bounded continuity and camera fixes integrated | Stage reservation, continuity, active zoom/Next and Fit ownership repairs are verified. Future topology cannot reorder current children. New structure can require movement; pursue only reproduced defects. The broader coordinate rewrite remains rejected. |
| 24 | Implemented locally | The review page says Normalized or Normalized after repair. Inspection separately records linguistic/visual review as unreviewed, including on successful runs. |
| 25 | Implemented locally | The self-contained qualification page mounts production TreeVisualizer and Replay controls, including play/pause, scrubbing, pan and zoom. Stage-only inspection stays distinct. Explicit correction copies carry original-response hashes and do not replace archived failures. All four saved analyses passed desktop/mobile navigation. |
| 26 | Open | Reduce evidenced cost and latency waste without weakening derivations; preserve measured versus estimated versus unknown values. |
| 27 | Implemented; live qualification pending | Offline Batch 4 implemented and tested no 429 retry, no replacement generation after downstream failure and the three-total-attempt ceiling. Timeout/recovery limits remain recorded separately; no new paid run is authorized. |
| 28 | Implemented locally | Replay reads literal original relation values, including arrays, repeated entries and whitespace. Formatting tests preserve x_i, scripts and punctuation. |
| 29 | Implemented locally | Movement panels retain Source/Landing plus all values and remaining current/prior anchors from the original relation, even when no drawing link carries them. |
| 30 | Implemented locally | Supported PF hosts and literal rows reach the existing plate without invented equations. Where an authored PF relation follows head movement, the abstract head moves first and did appears at realization. Both saved cases and registered/open variants are tested without changing the raw records. |
| 31 | Integrated; bounded composition verified | Supported binding no longer needs an invented scope hull. Generated binding coindices use letters and mixed composition retains independent claims. Extra government/ECP evidence remains separate; general recognition and arbitrary composition are still bounded. |
| 32 | Implemented locally | Generic licensing/membership/order and negated or contradictory specialized features no longer earn the reported unsupported graphics. Established bracketed feature notation remains supported. Broader recovery qualification continues under 39. |
| 33 | Implemented locally | Ordered/repeated endpoints and literal slots survive recovery. Blank slots cannot silently repair unequal pairings. Consumed array items and residual qualifiers remain distinguishable; missing labels or groupings are not invented. |
| 34 | Partial | Exact named parent, carrier and projection proofs are shared with drawing; the approved complement-to-head focus hop is retained. Overt and covert movement require whole-occurrence evidence, not one shared descendant. General argument-sharing sufficiency remains a linguistic boundary. |
| 35 | Implemented locally | The reported native branches consume prepared participants/content, including focus, theta, Case, PF morphology/correspondence, storage, Transfer, candidates and cyclic columns. Missing grouping and ambiguous step multiplicity receive diagnostics, not truncated drawings. Independent native and browser checks cover the repaired cases; universal alias/composition coverage is not claimed. |
| 36 | Integrated; bounded composition verified | Transfer/cyclic duplicates and repeated gap labels are repaired. Gap notation reuses its exact owned display terminal. Residual rails retain authored participant context with stage-scoped persistence. Saved-case mixed composition is browser-verified; arbitrary combinations remain unqualified. |
| 37 | Implemented locally | Outcome data reaches existing path/candidate graphics. Allowed outcomes do not earn blocked-only marks; contradictory same-host claims stay neutral with a cause diagnostic. All-variant native qualification remains under 39. |
| 38 | Implemented locally | Recovery checks the exact authored gap/copy, including category-typed silent occurrences and t variants. A containing VP is not that trace; ordinary silence does not imply deletion. |
| 39 | Bounded integrated qualification | Current gate: 1,676 tests, typecheck and both fixtures. The badge/transition pass compares all 207 saved frames plus 20 labelled control frames before and after, with unchanged saved syntax/cameras, no fitted label clipping or panel coverage, 2×/4× zoom, Next/Prev/Fit and eight narrow checks. The later realizations pass also preserves all 207 archived frames and checks 14 new control frames plus worker/Tree Bank save/reopen. The subsequent recognition comparison covers all 207 frames and 24 controls, with the documented Grok wh drawing change. Arbitrary compositions and slower/deployed conditions remain bounded follow-ups; the no-prior control lacks authored ownership evidence and does not establish a scheduler defect. |

Proof reconciliation beyond the original numbered findings:

- [ ] For benchmark scoring or gold-corpus use, review Fable's unexplained Case,
  look-ahead reasoning and unclear assumptions, plus the original chronology
  conflicts. Preserve model mistakes as evidence; Babel must not repair them or
  treat each as a product shipping blocker. Investigate demonstrated prompt
  degradation separately.
- [x] Render both Fable inspection copies with every change disclosed. Keep raw
  output, mechanical formatting edits, and any proposed semantic change separate;
  do not replace the saved originals or regenerate them just to inspect them.
- [x] Review all 36 original relation entries and classify the remaining neutral
  content. The later cross-family matrix also has explicit dispositions.
- [x] Complete the bounded shared recognition investigation, including Grok's
  remaining signatures, exact identity, cross-family and negative controls.
- [x] Implement and review the four shared-rule repairs. Verify the offline gate
  and integrated Replay comparisons. Current-only movement drawings and every
  Tier-1 requirement remain protected; missing evidence stays neutral.
- [x] Check all 137 prototype Replay frames on desktop/mobile, plus backward
  revisits and the fixed Astra Minimalism F29→30 transition at fit/settled zoom.
- [x] Retain available Tier-3 participants without changing existing sizing or spacing
  in the narrow prototype repair; checked against all four archived bundles.
- [x] Repair and verify the active wheel-gesture/Next and Fit lifecycle defects.
  The broader coordinate repair remains rejected and reverted.
- [x] Check ordinary integrated motion, Orchard paint/hover, labels, panels,
  identical-input casing, previews and save/reopen within the recorded bounds.
  The original available-participant audit does not justify an empty-frame graphic.
- [x] Verify the saved outputs with production Replay and the recorded offline
  route/inspection checks; complete the authorized Grok pair and its review.
- [x] Fix circled Tier-3 scaling with focused visual evidence.
- [x] Confirm and repair the emptied-parent ownership control; preserve unrelated
  structure, authored empty parents and accepted layout. The no-prior-anchor
  follow-up establishes the existing evidence boundary rather than a new repair.
- [x] Implement and verify the approved retained morphology representation
  across normalization, Replay, worker and Tree Bank. Fresh model authoring remains
  unmeasured, as recorded in the current work order.
- [ ] Complete the specifically unverified live/deployed, slower-device and
  extreme readability checks in the current work order. Review changed fixtures
  and run the completion gate after approved broad implementation.

Choose further qualification from the current work order and the explicit bounds
above. Fresh provider runs need approved conditions and a cost limit. Programs 2
onward remain on the roadmap; this audit does not replace or complete them.

### Qualification After The Audit

1. Freeze and hash the incumbent prompt, system instruction, route config,
   request carrier, engine, and test item versions.
2. Define the claims before running models: transport completion, contract
   validity, typed failure composition, structural adequacy, and stability are
   different outcomes.
3. Preserve the failure taxonomy in every receipt: transport/serialization,
   incomplete generation, contract misunderstanding, linguistic failure,
   deterministic engine failure, and valid-but-unexpected analysis.
4. Investigate the existing malformed output and, under approved conditions,
   measure whether failures recur. Evaluate whether any recovery preserves
   authored structure; do not change automatic repair before that policy is
   agreed. The model-based payload transcriber has been removed.
5. Before paid calls, verify that Babel can run the intended test items, save
   existing sample responses, and present every derivation in a convenient
   click-through review surface. This checks the testing plumbing, not models.
   No examples enter the model-facing contract merely to make tests pass.
6. For each real test batch, record the exact models, inputs, settings, maximum
   run count or spend, and where the raw outputs and review artifacts are saved.
7. Launch only with Francis's approval. Preserve every attempt and adjudicate
   every apparent regression before adopting a model-visible change.
8. Keep provider behavior evidence separate from deterministic engine tests.
9. Technically qualify every provider/model entry exposed in `/research`: its
   authentication path, request shape, native controls, response handling, and
   typed failures must work and be documented to the same product standard.
   The candidate catalog may include proprietary and open-weight models.
10. Compare qualified candidates for the likely single public model and
    recommend the model and settings that best serve students: fast, reliable,
    and generally very good. Preserve native provider names, effective settings,
    and failure evidence in the underlying record. The public UI may hide
    controls; the record may not hide provenance.
11. Run representative real provider outputs through normalization,
    compilation, Replay, Tier 1/Tier 2/Tier 3 dispatch, camera fitting, and the
    production UI. Include valid unexpected open-ontology relations and honest
    fallbacks, not only curated Orchard fixtures.

Done when the audit findings and required proof above are resolved, the
incumbent has a reproducible baseline, and every proposed contract/recovery
change has an evidence-backed adopt, reject, or hold verdict. A held experiment
does not waive an unresolved product defect.

## Program 2: Durable Personal Tree Bank

Goal: replace whole-bundle IndexedDB saves with the settled record boundary for
the user's explicit browser-local library. This is separate from automatic
backend generation retention.

### 2A. Inventory And Decision

1. Characterize the current IndexedDB schema, save/open/delete behavior,
   preview snapshots, ambiguity selection, and failure recovery.
2. Build a one-time explicit legacy export so current local saves can be
   preserved before retirement.
3. Decide the local persistence engine from required properties: atomic batch
   writes, indexes, schema upgrades, backup/export, corruption isolation, and
   browser/desktop portability. Do not choose it by familiarity alone.
4. Francis decides whether legacy entries receive import support or only a
   documented export-and-retire path.

### 2B. Record Integration

1. Adapt the selected normalized analysis to the existing W17 record and
   evidence schemas.
2. Define the thin saved-work wrapper and its versioned schema.
3. Implement one atomic save: all analysis records plus one wrapper, or no
   visible save.
4. Restore framework, selected analysis, view, Replay position where valid,
   and preview without copying authored derivation bytes into the wrapper.
5. Reopening must reconstruct the complete familiar analysis bundle from its
   ordered record references; a rerun or competing analysis is a sibling, not a
   silent replacement.
6. Validate hashes on load; quarantine invalid records without blocking valid
   work.
7. Add explicit native export/import with duplicate and collision policy.
8. Test crash interruption, partial writes, upgrades, corrupt imports,
   ambiguity bundles, Unicode, large analyses, and fresh-browser recovery.

Done when Tree Bank can round-trip a saved analysis through the durable record
format, survive interrupted writes, and recover or quarantine every entry
honestly.

## Program 3: New Babel Web Application

Goal: build one application around the completed engine, with a simple public
syntax generator and a separately entered research workbench. Do not continue
growing the current monolith and do not build two Babel implementations. The
listed capabilities are the minimum known boundary, not a prohibition on
evidence-backed additions or iteration while shipping the product.

### 3A. Shared Product Foundation

1. Define stable application boundaries around provider execution, current
   analysis state, durable records, renderer inputs, exports, and view state.
2. Prototype the complete shared flows before changing production: parse,
   inspect, Replay, save, reopen, export, and recover from failure.
3. Extract `App.tsx`, `TreeVisualizer.tsx`, and `replayCompiler.ts` by behavior
   and ownership, under existing characterization and pixel-identity gates.
   Do not redesign the relation renderer during extraction.
4. Both surfaces must use the same parser, renderer, durable records, Tree Bank,
   and current analysis state. A route changes the available controls, not the
   meaning or storage of an analysis.

### 3B. Public Babel At `/`

1. Make the first screen the usable product: sentence input, Minimalism or
   X-bar, and Generate, following the existing product unless iteration reveals
   a real reason to change it. Do not add a marketing landing page before it.
2. Keep Canopy, Derivation Replay, Tree Bank, ambiguity selection, save, and
   export. Preserve the established visual design unless a concrete product
   defect requires change.
3. Hide provider, model, and reasoning controls. Babel likely uses one
   empirically selected model and a bounded server-selected generation policy
   while recording its complete provenance. Do not place AI or provider
   branding at the front of the experience, but disclose model generation and
   backend retention honestly through appropriate About and Privacy surfaces.
   Raw responses, hashes, provider settings, token use, latency, and other
   research details never appear in the ordinary public workspace.
4. Retire Notes as a top-level view. `stageRecord` remains part of every stage
   and stays visible with its corresponding Replay frame. Decide separately,
   after auditing actual use, whether labeled bracketing and Miles Shang output
   remain as exports or are retired.
5. Keep a small Research link in the main menu or header. It opens `/research`
   without discarding the current analysis or Tree Bank.

### 3C. Research Workbench At `/research`

1. Permit direct entry and bookmarking, and provide a clear Back to Babel link.
2. Add provider, model, and native reasoning controls without changing the
   shared parser contract or manufacturing cross-provider equivalence. Preserve
   the already-working native reasoning behavior while expanding the model
   catalog deliberately. Francis chooses every model in the configured catalog.
   Arbitrary model identifiers are not a launch requirement.
3. Show generation provenance, raw and normalized outputs, and typed failures
   without leaking those details into public Babel. Add batch runs, experiments,
   and advanced exports only after their workflows are designed. Cross-run
   comparison remains a candidate rather than a settled launch requirement.
4. Opening a public analysis reveals its recorded generation details here.
   Opening a research analysis on the public surface hides advanced controls but
   does not alter or discard its provenance.

### 3D. Product Quality

1. Preserve and characterize the existing loading experience, arbitrary-count
   parse selection, and provider transport retries. Add route-level and renderer
   error boundaries and accessible keyboard/focus behavior. Decide separately
   whether user-triggered parse cancellation or additional retry UI is useful.
2. Make desktop and mobile layouts explicit. Verify all key flows with
   screenshots and interaction tests, not only component snapshots.
3. Preserve local-first operation. Hosted accounts or synchronization remain a
   later explicit decision.

Done when `/` provides the complete simple syntax-generator workflow,
`/research` provides the advanced controls over the same records, Notes has
been retired without losing stage explanations or exports, and the old
monolithic path can be removed without semantic or visual regression.

## Program 4: Syntactician Workspace

Goal: turn durable records into useful personal research infrastructure in
dependency order. All listed capabilities remain in scope, but their workflows,
information architecture, and visual form must be discovered with Francis
through product research and prototypes rather than assumed from this roadmap.
The workspace may ultimately live inside Personal Tree Bank; that placement is
not settled.

1. **Examples and Collections**: user-authored notes, judgments, citations,
   tags, and ordered collections reference immutable analysis records. These
   are genuine user notes and must remain distinct from model-authored
   `stageRecord` text shown in Replay.
2. **Notebook/Saved Work**: thin wrappers group work without embedding record
   payloads.
3. **Sibling analyses and comparison**: preserve alternatives as siblings,
   show authored and derived differences, and never rewrite the original.
4. **Structural query**: first run a real query-needs study; then implement only
   predicates supported by record structure and user evidence.
5. **Interchange**: explicit bundles with checksums, provenance, conflict
   policy, and version support.
6. **Research outputs**: export canonical bundles and faithful static or
   interactive views without claiming interchange formats preserve the full
   derivation when they only carry final trees.
7. **Group exchange**: add collaboration only after local import/export and
   attribution are reliable.
8. **Public releases**: require licensing, citation, withdrawal, correction,
   and governance decisions before any shared corpus is called a database.

Done progressively: every tranche must be useful end to end without requiring
the next tranche or a hosted account.

## Program 5: Operations And Shipping

1. **Done:** CI runs `npm ci`, `npm run verify:all` for typechecking, tests and
   parse-contract fixtures, production build, `npm run release:verify-assets`
   for release files and links, and dependency audits. Required checks fail
   the job; the complete low-severity dependency report remains informational.
2. Node 24 is selected in the package and CI. Define supported browsers, hosted
   runtime conditions and upgrade cadence.
3. Choose hosting, storage, and operations vendors after measuring the public
   model's cost, expected traffic, archive volume, privacy requirements, and
   recovery needs. Do not lock Babel to a vendor before those facts exist.
4. Keep secrets server-side, preserve provider request shapes, and add abuse
   controls appropriate to the selected host.
5. The public launch direction is anonymous generation without an account and
   without a user charge. Set explicit request, rate, and spend limits after
   selecting and costing the public model.
6. The official hosted `/research` route must not expose experimental provider
   spending to unrestricted anonymous traffic. Choose its access method after
   the provider catalog and deployment design are known. Accounts, invitations,
   and user-supplied credentials are possible mechanisms, not settled product
   requirements.
7. Keep public Babel, the research workbench, the Relation Orchard, benchmark
   reports, the Generation Archive, and reviewed corpus releases separate in
   deployment ownership. The Generation Archive has no ordinary navigation.
   Add corpus navigation only if Francis approves a publication.
8. Maintain one pre-launch checklist covering at least the fresh-checkout gate,
   contract qualification, public and research generation, complete renderer
   integration, Personal Tree Bank round trips, Generation Archive failure
   capture, reviewed-corpus promotion, mobile and desktop behavior,
   accessibility, security, privacy, abuse limits, cost limits, backups,
   monitoring, rollback, licenses, notices, links, and static assets. Add any
   further proof exposed by implementation. Passing an earlier item never
   waives a later defect.
9. Publish from a reviewed clean tree with provenance for contract, engine,
   renderer, bundle, application, and site versions.

Done when the production deployment passes the complete launch checklist, its
cost and retention behavior are bounded and disclosed, and a failed release can
be detected and rolled back without losing accepted work.

## Program 6: Generation Archive And Reviewed Derivational Corpus

Goal: build two backend research layers over the same immutable derivational
record contract. The benchmark is not a prerequisite and must never supply
answers or held-out material to either layer.

Begin implementation after contract qualification and the official hosted
generation path are stable enough to define what must be retained. Babel may
launch with a small reviewed corpus. Launch requires the archive and review
pipeline to work; it does not require a large corpus. The corpus grows through
actual reviewed use after launch.

### 6A. Automatic Generation Archive

1. Persist every attempt made through the official hosted service, including
   successful analyses and separately typed transport, malformed-output,
   contract, and deterministic-engine failures.
2. Capture every useful and legally permitted fact: input and framework,
   provider/model/native settings, contract and prompt hashes, timestamps, raw
   provider response, normalized analyses, failure evidence, engine and
   renderer versions, latency, token usage, and cost metadata. Never persist
   credentials or unavailable private reasoning traces.
3. Keep the archive out of the ordinary product UI initially. It is research
   infrastructure, not the user's Personal Tree Bank.
4. Define disclosure, privacy, security, retention, access, deletion, and
   jurisdiction rules before enabling automatic persistence.
5. Do not upload from self-hosted or forked installations by default.
6. Preserve repeated generation events independently even when their content is
   identical; internal content deduplication may not erase event provenance.

### 6B. Reviewed Derivational Corpus

1. Promote only deliberately reviewed analyses from the Generation Archive.
2. Preserve complete derivations, provenance, reviewer evidence, licensing
   status, and correction history so the result can support serious linguistic
   research and, where legally permitted, specialized-model training.
3. Define selection, review, disagreement, attribution, withdrawal,
   versioning, correction, citation, and training-eligibility policies.
4. Obtain legal decisions for model outputs, user inputs, source examples,
   screenshots, licenses, redistribution, and training use.
5. Decide later whether the Generation Archive or reviewed corpus is private,
   shared, or public. Do not expose either through Personal Tree Bank search by
   default.
6. Build any publication as a release projection with stable identifiers and
   checksums rather than exposing the mutable operational database directly.
7. Prove the promotion and correction workflow on a small reviewed set before
   scaling it. Corpus size is not a product launch metric.

Done when hosted attempts are retained honestly and securely, and reviewed
derivations can be independently cited, validated, corrected, and withdrawn
without mutating Personal Tree Bank work or benchmark archives.

## Program 7: Benchmark D0

Goal: after the product and research infrastructure are useful, publish a
development-grade, non-linguistic contract-validation release before claiming
syntactic performance. This deferred program does not block Babel shipping.

1. Reconcile the W13-W16 modules into one documented provider-free execution
   path and delete duplicate or unreachable dry-run scaffolding.
2. Define Francis-owned S0 declarations: purpose, model selection authority,
   cost ceiling, data retention, rerun policy, and release label.
3. Author versioned draft items and complete the structural/taxonomy audit
   receipts. Draft status must never imply linguistic validity.
4. Freeze an explicit model manifest and admission evidence.
5. Record each selected model's own documentation, retrieval date, native
   controls, effective request settings, and admission probe. Family-level
   documentation is not evidence for a specific model.
6. Exercise the full runner/archive/typed-failure/report/development-bundle
   path with stubs, then with approved provider executions.
7. Publish only run-level validity and typed failure evidence under D0. Do not
   report linguistic conformance, quality rankings, or benchmark scores.

Done when a third party can reconstruct every D0 run and verify its artifacts,
manifest, conditions, and limitations from released data.

## Program 8: Benchmark D1-D3

Goal: progress from engineering evidence to defensible linguistic claims only
with qualified syntactician and methods collaborators.

1. **D1 recruitment**: recruit qualified reviewers and document expertise,
   conflicts, training, and family coverage.
2. **D2 calibration**: calibrate item interpretations, judgment categories,
   disagreement handling, missingness, and adjudication. Obtain method review
   for estimands, uncertainty, and any measurement model.
3. Run complete predeclared suites; preserve invalid outputs rather than
   silently dropping them.
4. Judge every valid run in the adjudicated set; never select a representative,
   best, median, or modal run after seeing results.
5. Produce judgments, agreement evidence, score draws, sensitivity analyses,
   exposure/twin evidence, item audits, and correction plans through the
   existing hash-bound interfaces.
6. **D3 release**: satisfy the release bundler's external preconditions,
   legal/licensing review, methods sign-off, accessible report review, and
   Francis's publication approval.
7. Version corrections additively; never rewrite an earlier release.

Done when every public claim has an estimand, evidence chain, uncertainty,
review authority, and correction path.

## Decisions Still Owned By Francis

- Whether legacy Tree Bank data gets an importer or export-only retirement.
- The local persistence engine after the property comparison.
- The detailed public/research information architecture and visual direction
  within the settled shared-application and route boundary.
- The detailed syntactician-workspace workflows and interaction model.
- Whether the syntactician workspace lives inside Personal Tree Bank or beside
  it as a separate surface.
- The single model and bounded generation policy used by public Babel.
- The exact public anonymous-use limits after the selected model's cost and
  reliability are measured.
- Every model admitted to the configured `/research` catalog and how each
  proprietary or open-weight model is operated. Arbitrary model identifiers are
  excluded from the launch boundary unless Francis later approves them.
- The official hosted `/research` access method and credential policy.
- Detailed public failure presentation and retry behavior within the agreed
  public/research boundary. Babel must never silently switch providers.
- Whether contract-review artifacts live primarily inside `/research`, as
  generated click-through files, or both.
- Whether labeled bracketing and Miles Shang output remain supported exports.
- Every provider/model launch, cost ceiling, and model manifest.
- Contract/recovery adoptions after empirical comparison.
- Reviewer and methods authority for claim-bearing benchmark stages.
- Final product names for the Generation Archive and Reviewed Derivational
  Corpus, including a possible mythological name for the latter.
- Generation Archive disclosure, privacy, retention, access, and deletion
  policy.
- The Reviewed Derivational Corpus's licensing, correction model, publication
  scope and timing, and training-eligibility rules.
- Whether research writing or future public datasets receive a separate
  Creative Commons or data license after the ownership audit.
- Deployment target and public product timing.

## Explicitly Not Active

- More relation-card design without a reproducible defect.
- Provider calls as part of default verification.
- A model-authored final tree, notes ledger, compatibility ledger, or fixed
  relation ontology.
- Undisclosed server parse logging or persistence, and automatic uploads from
  self-hosted or forked installations.
- Benchmark settings inside the ordinary Babel workbench.
- A manual syntax editor before the analysis and record workflows are proven.
- Additional teaching layers beyond the model-authored Replay record without a
  concrete demonstrated need.
- Hosted sync before local persistence, export/import, integrity, and conflict
  behavior are complete.
- A public Reviewed Derivational Corpus before legal and governance decisions.

## Source Reconciliation

This roadmap incorporates the surviving decisions from the July 2026 Fable
architecture packet, the July deep-audit plans, the W17 implementation, the
W13-W16 benchmark implementation, the August relation-renderer program, and
the live checkout. Where they conflict, current code and current verified
artifacts win. Historical documents remain available under `docs/history/` but
must not be executed as plans.
