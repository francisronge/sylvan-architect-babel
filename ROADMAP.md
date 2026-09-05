# Babel Master Roadmap

Status date: 2026-08-28

This is Babel's only active implementation plan. Dated plans, audits, handoffs,
and research notebooks are evidence or history, not competing roadmaps.

## Current Baseline

| Area | Current state | Remaining boundary |
| --- | --- | --- |
| Authored contract | Implemented: each analysis is only four-field `derivationStages`; `relations` is open; `values` and immediate-prior `priorAnchors` are supported. | Empirically qualify model-facing choices before changing the contract or recovery policy. |
| Deterministic engine | Implemented and provider-free verified: normalization, compilation, Replay, Notes, surface order, failure classes, and invention checks. | Expand characterization only when a real defect or contract experiment requires it. |
| Relation renderer | **Subsystem closed and provider-free verified.** Tier 1, Tier 2, Tier 3, micro-step buildup, persistence, camera fitting, hover, and the 69-primitive inventory pass the current fixture gate. | Qualify the full provider-contract-to-product integration before shipping. Do not reopen visual design without a concrete defect. |
| Current product | Working local React/Vite application with Canopy, Replay, Notes, provider routes, ambiguity selection, and a legacy Tree Bank. | Build one maintainable application with a simple public surface at `/` and an advanced research surface at `/research`; retire Notes as a duplicate top-level view. |
| Tree Bank | Functional browser-local IndexedDB v1 storing whole parse bundles. | Replace the legacy entry with durable per-analysis records and a thin saved-work wrapper. |
| Durable record layer | W17a-d pure record envelope, evidence schemas, adapter, canonical native export, and provider-free proofs exist. | No storage engine, product integration, query layer, import UI, collaboration, or publication system exists. |
| Benchmark | Extensive provider-free W13-W16 infrastructure exists for manifests, schedules, validation, statistics, review plans, reports, corrections, and release refusal. | No current item suite, approved provider run, adjudication workflow, fitted method, claim-bearing release, or benchmark web surface exists. |
| Public research site | Research archive exists. The current renderer is published as the Relation Orchard artifact in this checkout. | Ship the organized checkout and later design the benchmark/product sites without mixing their data or authority. |

The renderer is therefore done as a deterministic subsystem. This is not a
claim that the complete provider-contract-to-product renderer integration has
been qualified. Its large source files are maintainability debt, not unfinished
renderer semantics.

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
- Babel never invents linguistic content. Recovery is off by default and may
  exist only when bounded evidence proves what it preserves and what it risks.
- Babel requests complete derivations. Output allowance is never inferred from
  sentence length.
- `derivationStages` remains the sole model-authored structural source.
- Every stage has exactly `statement`, `stageRecord`, `relations`, and
  `workspaceForest`.
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
   audit.

Done when a new checkout contains the correctly licensed source, r96 Orchard,
compact fixtures, required notices, and all provider-free gates without relying
on this Mac's ignored files.

## Program 1: Contract Qualification

Goal: test the current model-facing contract as an empirical interface without
mixing that work into renderer completion or the later public benchmark. This
program answers whether Babel can reliably operate its product; it does not rank
models or claim syntactic competence.

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

1. Freeze and hash the incumbent prompt, system instruction, route config,
   request carrier, engine, and test item versions.
2. Define the claims before running models: transport completion, contract
   validity, typed failure composition, structural adequacy, and stability are
   different outcomes.
3. Preserve the failure taxonomy in every receipt: transport/serialization,
   incomplete generation, contract misunderstanding, linguistic failure,
   deterministic engine failure, and valid-but-unexpected analysis.
4. First measure whether malformed outputs still occur. Keep automatic recovery
   only for demonstrated transport or JSON failures that cannot change authored
   linguistic content. The model-based payload transcriber has been removed.
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

Done when the incumbent has a reproducible baseline and every proposed
contract/recovery change has an evidence-backed adopt, reject, or hold verdict.

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

1. Add CI for `npm ci`, `npm run verify:all`, build, fixture/link checks, and
   scoped dependency auditing.
2. Define supported Node/browser/runtime versions and upgrade cadence.
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
- Public failure and retry behavior. Babel must never silently switch providers.
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
