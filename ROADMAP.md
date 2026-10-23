# Babel Roadmap

Status date: 2026-10-21

This is Babel's single list of remaining work, in order. Completed work and its
evidence live in Git history. Durable rules and contracts live in the canonical
documents listed in [the documentation map](docs/README.md).

Babel must accommodate all languages. Test languages expose general limitations;
they do not define a supported-language allowlist or authorize language-specific
syntactic rules. Desktop remains the primary experience.

## Current work order

1. Run Claude Opus 5.5/high batches through `npm run qualification:anthropic` once
   the Max plan's monthly API credits can be claimed (around 2026-10-24). Spend
   only those credits.
2. Renderer follow-ups left after the October renderer pass. Each has saved
   evidence.
   - Plaques left far from their anchor (catalog #3): a second look after
     allocation brings 7 of the 63 listed plaques within reach, and an eighth
     for part of its life, without moving any other plaque. The other 55 need a
     decision: 11 have no room, 19 lose the near pocket to later syntax while
     their anchor stands still, 10 to positions their anchor reaches by reflow,
     7 to a plaque placed earlier, 7 to other plaques' final pockets or the
     quarter-nearer condition, and 1 whose nearer pocket lies too close to a
     movement arrow, since a plaque brought near keeps the full gap from arrows.
   - A host drops a row when a parent is inserted above it. This stays instant
     (no glide), so it needs a layout answer or acceptance.
   - A `RELATION_TIMING_CONFLICT` cycle that no order satisfies: in the
     Icelandic case transfer, continued V-to-I and I-to-C each own part of one
     moving head complex. It needs a decision about which claim introduces the
     shared head complex. A movement also does not wait for a
     contextual anchor, so the Icelandic raising chain's verb-trace role lacks
     its anchor at its moment (waiting would cost the subject landing its
     reserved slot and shift the matrix IP about 120 px).
   - Movements still drawn as copies without an arrow: the Hungarian verbal
     particle's topicalization (night3 14-hu-verbal-particle), and hop 8:0 of
     the long tough relative (night4 09-en-tough-relative-long), whose claim
     names only the landing and the new trace. Both belong with recognition
     (item 3).
   - After a failed parse in Derivation Replay, the sentence input stays
     visible: the failure panel has no dismiss control.
   - A wrapped category line can start with the space that overflowed the
     line before (22 saved labels).
   - Mobile calibration and a desktop minimum-zoom clamp.
3. Recognition:
   - Neutral relations can earn a shared-lineage coindex or a single-host
     plaque from structure alone; the adjunction fork stays off because
     structure cannot tell scope from modification (see the
     [dispatch spec](docs/design/visual-relations-tier2-shape-dispatch-spec.md#structure-only-recognition-of-neutral-relations)).
     Run the same geometry-first experiment for movement and the other
     relations: measure the wrong-picture rate where Babel already draws, and
     decide whether each further measured rule can claim its whole envelope.
   - Later, consider Jev as a fallback.
4. Merge duplicated layout checks without changing a pixel, proving identical
   output with the fixture layout fingerprint (`npm run verify:visual-offline`)
   and `npm run verify:corpus`, and fix the one remaining stretched branch in
   Indonesian control analysis 2.

## Execution Order

Programs run in numeric order, except for small provider-free maintenance that
keeps later work buildable. Launch requires Programs 1 through 6, as defined in
[CONTEXT.md](CONTEXT.md). The benchmark in Programs 7 and 8 is deferred, does
not block launch and comes last.

## Program 1: Contract Qualification

Qualification tests the path from model instruction to authored record, parser,
Replay and production renderer. Batches follow the
[contract qualification rules](CONTEXT.md#contract-qualification-rules) and run
through the commands in [AGENTS.md](AGENTS.md#qualification-runs).

1. Technically qualify every offered research provider and the chosen public
   route: authentication, native controls, request/response shape, exact
   raw/version capture, typed failures and deployed limits.
2. Prove a single owner for a pronunciation association when movement and a
   separate morphology claim name the same contributors. Until one owner is
   proved, the association stays at the Stage Record. Do not prescribe model role
   names or force a drawing to eliminate that conservative fallback.
3. Adjudicate the reading distinctions still open in saved analyses, and decide
   what counts as a distinct reading:
   - the Mandarin and Arabic alternatives. One Arabic alternative assumes a past
     nonverbal matrix clause without the copula required by the
     [Standard Arabic past-time contrast](https://marz.kau.edu.sa/Files/320/Researches/74322_47483.pdf);
     it stays inspectable with its review limitation;
   - the Thai alternatives, which may repeat one interpretation under different
     theoretical accounts, and the Dutch analyses, which combine three temporal
     scopes with two role assignments, the latter requiring personification.

Complete when demonstrated product defects have verified resolutions and each
contract/recovery proposal has an evidence-backed adopt, reject or hold decision.
Perfect model analyses, a large corpus and an endless qualification loop are not
release criteria.

## Program 2: Durable Personal Tree Bank

[derivationalDatabase/README.md](derivationalDatabase/README.md#browser-local-tree-bank)
describes the browser-local record layer. The remaining work is explicit import
and export, designed with the new application in Program 3.

1. Design explicit backup, import and export with the application. Version-1
   entries keep their existing read path and do not need a migration project.
2. Decide whether a legacy importer or an export-and-retire interface is needed.
3. Implement native import and export as explicit, hash-verified actions, with a
   duplicate and collision policy, corrupt-import tests and export-based recovery
   in a fresh browser. Local and private use is the minimum supported boundary.
4. Local Tree Bank records are not W17 export envelopes. The export adapter must
   distinguish unavailable evidence from recorded evidence and never invent
   missing evidence, such as dated provider-notice references.

Done when a saved analysis round-trips through export and import, including
recovery in a fresh browser, and every corrupt or colliding import is
quarantined or reported honestly.

## Program 3: New Babel Web Application

Goal: build one application around the completed engine, with a simple public
syntax generator and a separately entered research workbench. Do not continue
growing the current monolith and do not build two Babel implementations.

### 3A. Shared Product Foundation

1. Define stable application boundaries around provider execution, current
   analysis state, durable records, renderer inputs, exports, and view state.
2. Prototype the complete shared flows before changing production: parse,
   inspect, Replay, save, reopen, export, and recover from failure.
3. Both surfaces must use the same parser, renderer, durable records, Tree Bank,
   and current analysis state. A route changes the available controls, not the
   meaning or storage of an analysis.

### 3B. Public Babel At `/`

1. Make the first screen the usable product: sentence input, Minimalism or
   X-bar, and Generate, following the existing product unless iteration reveals
   a real reason to change it. Do not add a marketing landing page before it.
2. Keep Canopy, Derivation Replay, Tree Bank, ambiguity selection, save, and
   export. Preserve the established visual design unless a concrete product
   defect requires change.
3. Hide provider, model, and reasoning controls. Babel uses one empirically
   selected model and a bounded server-selected generation policy while
   recording its complete provenance. Do not place AI or provider
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
   parse selection, and the single provider request per parse (no automatic
   transport retry; a retry on the public site may come later). Add route error
   boundaries with the application split. Decide separately whether
   user-triggered parse cancellation or additional retry UI is useful.
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

1. Define supported browsers, hosted runtime conditions and upgrade cadence.
   Node 24 is already selected in the package and CI.
2. Choose hosting, storage, and operations vendors after measuring the public
   model's cost, expected traffic, archive volume, privacy requirements, and
   recovery needs. Do not lock Babel to a vendor before those facts exist.
3. Keep secrets server-side, preserve provider request shapes, and add abuse
   controls appropriate to the selected host.
4. The public launch direction is anonymous generation without an account and
   without a user charge. Set explicit request, rate, and spend limits after
   selecting and costing the public model.
5. The official hosted `/research` route must not expose experimental provider
   spending to unrestricted anonymous traffic. Choose its access method after
   the provider catalog and deployment design are known. Accounts, invitations,
   and user-supplied credentials are possible mechanisms, not settled product
   requirements.
6. Keep public Babel, the research workbench, the Relation Orchard, benchmark
   reports, the Generation Archive, and reviewed corpus releases separate in
   deployment ownership. The Generation Archive has no ordinary navigation.
   Add corpus navigation only if Francis approves a publication.
7. Maintain one pre-launch checklist covering at least the fresh-checkout gate,
   contract qualification, public and research generation, complete renderer
   integration, Personal Tree Bank round trips, Generation Archive failure
   capture, reviewed-corpus promotion, mobile and desktop behavior,
   accessibility, security, privacy, abuse limits, cost limits, backups,
   monitoring, rollback, licenses, notices, links, and static assets. Add any
   further proof exposed by implementation. Passing an earlier item never
   waives a later defect.
8. Publish from a reviewed clean tree with provenance for contract, engine,
   renderer, bundle, application, and site versions.

Done when the production deployment passes the complete launch checklist, its
cost and retention behavior are bounded and disclosed, and a failed release can
be detected and rolled back without losing accepted work.

## Program 6: Generation Archive And Reviewed Derivational Corpus

Goal: build two backend research layers over the same immutable derivational
record contract. The benchmark is not a prerequisite and must never supply
answers or held-out material to either layer.

Begin implementation after contract qualification and the official hosted
generation path are stable enough to define what must be retained.

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
syntactic performance.

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

- Separate approval for provider tests, model-visible prompt changes,
  publication, deployment, licensing, and hosted synchronization.
- The import/export experience, including any legacy importer or export-only
  retirement, during application design.
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
- Reintroducing automatic JSON delimiter repair. Francis removed it on 22 Oct
  2026: a response whose brackets do not balance now fails as
  `TRANSPORT_JSON_DELIMITERS_BALANCED` with its raw output. A stricter rule that
  only drops stray closers after the complete value
  (`exp/json-repair-preserve-nesting`) is held for the public app.
- Reintroducing the model-based payload transcriber.
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
