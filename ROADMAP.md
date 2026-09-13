# Babel Master Roadmap

Status date: 2026-09-13

This is Babel's only active implementation plan. Dated plans, audits, handoffs,
and research notebooks are evidence or history, not competing roadmaps.

## Current Baseline

| Area | Current state | Remaining boundary |
| --- | --- | --- |
| Authored contract | Implemented: each analysis is only four-field `derivationStages`; `relations` is open; `values` and immediate-prior `priorAnchors` are supported. | Empirically qualify model-facing choices before changing the contract or recovery policy. |
| Deterministic engine | Local repairs preserve stages and originals and report exact field/reference failures. Saved chronology conflicts remain diagnosed. | Synthetic identity, automatic JSON repair and public incomplete-processing policy remain unresolved. |
| Relation renderer | The accepted prototype retains available Tier-3 participants and prevents the do-support stretch, preserving the preceding layout and all other 135 saved desktop frames. | Other Replay shifts, no-participant presentation, long-content and application/export qualification remain open. The broader coordinate rewrite remains rejected. |
| Current product | Working local React/Vite application with Canopy, Replay, Notes, provider routes, ambiguity selection, and a legacy Tree Bank. | Build one maintainable application with a simple public surface at `/` and an advanced research surface at `/research`; retire Notes as a duplicate top-level view. |
| Tree Bank | The prototype retains the baseline browser-local IndexedDB v1 implementation. Main has a separately verified thumbnail fix. | Main and its thumbnail fix are outside this prototype checkpoint. The later durable-record migration remains separate product work. |
| Durable record layer | W17a-d pure record envelope, evidence schemas, adapter, canonical native export, and provider-free proofs exist. | No storage engine, product integration, query layer, import UI, collaboration, or publication system exists. |
| Benchmark | Extensive provider-free W13-W16 infrastructure exists for manifests, schedules, validation, statistics, review plans, reports, corrections, and release refusal. | No current item suite, approved provider run, adjudication workflow, fitted method, claim-bearing release, or benchmark web surface exists. |
| Public research site | Research archive exists. The current renderer is published as the Relation Orchard artifact in this checkout. | Ship the organized checkout and later design the benchmark/product sites without mixing their data or authority. |

The earlier renderer closeout records what passed then; it does not override
the failures found in the September outputs. Babel's full generation and
rendering path is not yet qualified for shipping. The audit checklist below
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

Francis accepted the prototype and requested commits of its resolved work on
13 September, then explicitly limited the scope to `Babel-proto`. This branch
contains the inherited evidence/timing repairs, plaque/badge composition,
generated letter coindices, stage-size reservation, narrow neutral-participant
repair and bounded stage continuity. Codex reviewed and separated the changes
into coherent commits. The final production sources match the verified preview;
the full gate passes 1,574 tests, typecheck and both parse fixtures.
The current preview is `/tmp/babel-stage-continuity-candidate/index.html`.

Main and its separate Tree Bank thumbnail repair remain untouched and outside
this checkpoint. No merge, combined-app qualification, push or paid run is part
of this work. Prototype approval covers the checked appearance and fixes; it does
not certify every renderer case or the saved linguistic analyses.

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

All four archived bundles were checked through production Replay in that
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
| 1–4, 17: badges, plaques, generated indices and mixed drawings | Saved-case composition passes in the prototype. Generated coindices use letters there; circled Tier-3 numbers keep their approved locator meaning. | Preserve the accepted appearance; stress long values/many rows and verify application exports. Mobile readability is deferred. |
| 17: Replay stability | The restored stage-size repair fixes F29→30. The new bounded continuity rule fixes Astra X-bar F35→36 without changing existing proportions or plaque attachment. The broader coordinate rewrite remains rejected. | Resolve other within-stage shifts separately while preserving accepted sizing and spacing; qualify active zoom/Next. |
| 6, 16–17: empty relation moments | The narrow repair shows ① at C in Astra X-bar F32. F33 adds the operator badge and connector. Available neutral participants survive independently in partial pairs and fans. Layout and sizing match the restored prototype exactly; Francis accepts its current appearance. | Preserve the accepted appearance. Design the no-participant state below. Complete specialized dependencies remain atomic, unavailable syntax stays hidden and the original timing diagnostic remains. |
| 5–8: interpretation and neutral content | Shared-participant preservation is fixed. Current plans contain neutral content in 22 of 36 relations, not 24. | Audit equivalent roles with negative controls; distinguish drawable wh licensing/percolation, Spec-head agreement, government and PF context from unsupported meaning. Title/prose evidence remains a policy boundary. Preserve contextual prose without manufacturing extra dependencies. |
| 9: generated identity | D3 allocation reserves authored IDs. | Remove the broader dependence on synthetic suffix spelling without reinterpreting open authored IDs. |
| 10–12: repair and incomplete processing | Inspection preserves originals, usable evidence and diagnostics. | Decide permitted JSON transformations and automatic use, then public handling of malformed/mixed/unresolved results, surface mismatches and extra roots. Fable's missing ending still has no proven generation-side cause. No helper or paid experiment is authorized. |
| 13–14: simultaneity and judgments | Ordinary relation order and required intermediate stages are settled. | Define genuinely simultaneous separate relations and distinguish authored judgment literals from inferred verdict symbols. |
| 15–16: linguistic review and old chronology | Original conflicts remain inspectable, including Astra X-bar F32 wh licensing before its landing. | Qualified review must establish each analysis's assumptions, including Fable's object Case, early did, wh status and government claims. Do not silently rewrite the originals. |
| 18: operational qualification | Offline provider and adapter checks exist. | Exercise queued OpenAI polling through the full public route and measure long-derivation processing before caching. Real-model compliance, revised-prompt cost/latency and caching benefit remain unmeasured. |
| 19: review and consolidation | The rejected rewrite remains reverted. Codex reviewed the accepted prototype changes for coherent commits; Fable was waived. | Main integration is outside this checkpoint. Keep the rejected attempt and remaining defects documented. |

Next work, in order:

1. Preserve the committed prototype's accepted desktop sizing, fitting and plaque
   attachment. Investigate the remaining within-stage shifts and active zoom/Next
   as separate reproducible defects. Mobile work is deferred.
2. Qualify long plaque values/many rows, identical-sentence casing and application
   exports. Design the still-unimplemented no-participant Tier-3 presentation.
   Main integration and the separate Tree Bank fix are outside the current scope.
3. Complete the shared interpretation audit with positive and negative examples.
   Explain each of the 22 neutral-content relations. The wh-licensing frame
   remains a preserved conflicting claim requiring a visible neutral representation;
   a relation moment does not prove licensing succeeded. Missing geometry must
   not erase the available participant marks.
4. Resolve synthetic identity and the concrete processing, repair, simultaneity
   and judgment policies. Keep these separate from the completed prompt cleanup.
5. Complete linguistic review and offline public-route/performance qualification.
   Propose a bounded live qualification run only after its purpose, cost and
   remaining questions are concrete. Further paid generation remains unauthorized.

Do not reopen model-owned traces/nulls/wordless heads, whole-phrase silence,
explicit list pairing, complete Tier-1 requirements, smaller Tier-2 combinations,
stage-scoped Tier 3, original-position badge numbering, source-preserving atomic
movement or the completed prompt cleanup. No reading-view button, hidden rows or
Replay-only relocation of plaque content has been approved.

The remaining no-participant case needs a Tier-3 presentation state, not another
linguistic relation family. Proposed direction: reuse the existing relation
locator in reserved canvas space, with the missing/future-participant explanation
in Replay. Its placement and wording still need review. Never attach it to an
unrelated node or draw an absent endpoint. This applies to an otherwise blank
authored relation moment; contextual prose left over from an already drawn claim
does not automatically earn an additional graphic. No such new presentation was
implemented; the subsequent general Replay repair has been reverted.

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
above. General overflow/mobile qualification and integration remain open.
Free-prose recognition and literal-versus-glyph judgment presentation remain
explicit design questions. Astra X-bar's conflicting authored order stays
diagnosed and preserved. No fresh paid generation.

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

Implemented locally; the evidence linked above includes the Fable review and
subsequent regression fix. This completes the agreed offline batch, not proof
that the new prompt prevents all formatting errors or that the renderer is
ready to ship. Long-derivation evidence-recomputation cost remains a measured-work
follow-up; queued OpenAI responses have runtime tests but not a full public-route
polling test.

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

Only concrete unresolved cases need more discussion:
- ambiguous or unsupported multi-part associations beyond the implemented
  explicit pairing rule; the smaller Control, covert-movement, idiom and
  standalone Transfer drawings are approved and implemented for Tier 2;
- genuinely simultaneous separate relations; saved chronology conflicts remain
  preserved and diagnosed under the settled ordinary-order rule;
- long-content interaction and mobile layout; shared current-participant context,
  Tier-3 numbering and stage persistence are implemented, with prototype saved-case
  visuals checked and assembled application qualification still pending;
- authored judgment literals versus inferred verdict symbols; generated letter
  coindices are accepted in the prototype;
- automatic formatting repair and public handling of incomplete processing,
  token mismatches or extra final roots.

Phrase-level silence and its descendant token-index diagnostic are implemented.
Movement uses an authored earlier source, without reconstructing it from a later
landing. These decisions must not be reopened as unfinished design work.

The model still owns the linguistic analysis, including ungrammatical inputs and
copy/trace choices. Keep the current anchors/values contract. Inspecting imperfect
outputs is already agreed, not a decision to reopen. The
[recorded decisions](docs/implementation/contract-qualification/system-audit.md#remaining-decisions)
and their examples define these boundaries.

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
| 03 | Implemented; live qualification pending | The prompt now defines values, current/prior references, chronology, retained silent words, inherited phrase silence, explicit pairing and earlier movement sources. Node-field diagnostics are implemented. No new relation field or provider schema was added; fresh model qualification remains unauthorized. |
| 04 | Open | Investigate why Fable's original API text lacks its outer JSON closing characters. Separately establish what each delimiter repair changes and whether any helper is necessary or admissible; prevention first. |
| 05 | Implemented locally | Inspection diagnoses exact current/prior anchor paths, including missing, future-only, previous-only, duplicate and carried references. It preserves all analyses and does not introduce a public rejection policy. |
| 06 | Partial | Optional node-field types, duplicate token indices and extra final roots have inspection diagnostics. Linguistic branching constraints and public acceptance remain decisions, not new implicit validators. |
| 07 | Saved-case prototype visuals checked; integration pending | Wordless categories use category geometry with the agreed muted silent colour. Overt lexical selection remains intact. Field-based pronunciation and inherited silence are implemented; model-authored wordless heads and compact traces are accepted choices. |
| 08 | Partial | Saved movement sources remain overt until movement; authored lower forms and retained silent words are preserved. Phrase-level silence is implemented. Conflicting saved chronology remains open. |
| 09 | Implemented locally | Saved Internal Merge cases now recover supported movement through shared evidence. Broader ambiguity and false-recognition checks continue under 32-39. |
| 10 | Partial | The screenshot fixes hide future landing nodes and restore C before head movement. Earlier movement sources now come only from authored prior structure. The saved licensing-order conflict remains diagnosed, not silently reordered; inspect the combined result. |
| 11 | Saved-case prototype visuals checked; integration pending | Saved abstract and overt head movements have source/host checks and arrows; complete equivalent roles qualify for Tier 1. The screenshot fixes restore independent C construction. Verify the combined Replay against the saved records. |
| 12 | Implemented locally | All eleven saved cases receive the evidenced head/phrasal distinction, including Fable's bare maximal nominal. Positive and negative structural checks are in recoveredMovement.test.mjs. |
| 13 | Saved-case prototype visuals checked; integration pending | The approved display rule introduces the waiting unary top projection with wh movement, while preserving earlier CP in the saved stages. Fallback movement introduces its landing and necessary parent together without earning an arrow. Verify the combined Replay. |
| 14 | Implemented | External Merge and original relation names are primary headings. Select/Project targets were restored in the screenshot fixes, with regression checks. Macro statements remain intact. |
| 15 | Implemented locally | Original relation names, punctuation, scripts and whitespace are preserved rather than passed through identifier formatting. |
| 16 | Prototype verified on saved cases | Reserved local/below-tree plaques pass the four-archive desktop/mobile collision checks. Arbitrary long values, many rows, mobile readability and integrated exports still need qualification. |
| 17 | Implemented locally | Removed the eight-row truncation. Every row retains its original index and literal content; a twelve-row wordless-head control is verified in Node and desktop/mobile SVG. Visibility of a very tall plaque remains under 16. |
| 18 | Accepted in the prototype | A fallback badge shows the relation's authored position within its stage. It is a locator, never a score or a linguistic index. The separate prototype uses letters for generated coindices, replacing the misleading Binding relation-position default there. |
| 19 | Implemented locally | A neutral fallback marks its own stage only and returns when that stage is replayed. Tier 1 and Tier 2 retain their persistence. Hiding leftover anchors and one-mark-per-relation were rejected. Later shared-context/accounting repairs supersede the original badge counts; Astra Minimalism ends with eleven badges and Fable X-bar with five. |
| 20 | Implemented locally | Single and explicitly paired theta/Case assignments retain literal labels and repeated participants. Solid assignment and dotted collection remain distinct. Missing or mismatched associations stay neutral; title-only role/Case prose is not converted into missing fields. |
| 21 | Implemented locally | Complete Tier-1 recipes accept equivalent roles and harmless context. Missing or contradictory core roles still fail that recipe. Unused extra anchors receive an aggregated internal context diagnostic; the complete raw relation remains inspectable. |
| 22 | Saved-case prototype visuals checked; integration pending | Exact phase/projection witnesses, both accessible-DP outlines and the approved standalone Tier-2 transferred-domain mark are implemented. A phase head is not silently promoted, and an incomplete exact Tier-1 recipe is not rescued. |
| 23 | Partial; bounded continuity accepted | Stage-size reservation fixes F29→30, and bounded continuity fixes Astra X-bar F35→36. Other saved within-stage shifts and active zoom/Next remain open. The broader coordinate rewrite remains rejected. |
| 24 | Implemented locally | The review page says Normalized or Normalized after repair. Inspection separately records linguistic/visual review as unreviewed, including on successful runs. |
| 25 | Implemented locally | The self-contained qualification page mounts production TreeVisualizer and Replay controls, including play/pause, scrubbing, pan and zoom. Stage-only inspection stays distinct. Explicit correction copies carry original-response hashes and do not replace archived failures. All four saved analyses passed desktop/mobile navigation. |
| 26 | Open | Reduce evidenced cost and latency waste without weakening derivations; preserve measured versus estimated versus unknown values. |
| 27 | Implemented; live qualification pending | Offline Batch 4 implemented and tested no 429 retry, no replacement generation after downstream failure and the three-total-attempt ceiling. Timeout/recovery limits remain recorded separately; no new paid run is authorized. |
| 28 | Implemented locally | Replay reads literal original relation values, including arrays, repeated entries and whitespace. Formatting tests preserve x_i, scripts and punctuation. |
| 29 | Implemented locally | Movement panels retain Source/Landing plus all values and remaining current/prior anchors from the original relation, even when no drawing link carries them. |
| 30 | Implemented locally | Supported PF hosts and literal rows reach the existing plate without invented equations. Where an authored PF relation follows head movement, the abstract head moves first and did appears at realization. Both saved cases and registered/open variants are tested without changing the raw records. |
| 31 | Prototype verified on saved cases | The supported binder-variable path no longer requires an invented scope hull. The prototype replaces generated numeric coindices with letters and improves mixed composition. Extra government/ECP evidence remains separate; general composition coverage remains open; main integration is outside this checkpoint. |
| 32 | Implemented locally | Generic licensing/membership/order and negated or contradictory specialized features no longer earn the reported unsupported graphics. Established bracketed feature notation remains supported. Broader recovery qualification continues under 39. |
| 33 | Implemented locally | Ordered/repeated endpoints and literal slots survive recovery. Blank slots cannot silently repair unequal pairings. Consumed array items and residual qualifiers remain distinguishable; missing labels or groupings are not invented. |
| 34 | Partial | Exact named parent, carrier and projection proofs are shared with drawing; the approved complement-to-head focus hop is retained. Overt and covert movement require whole-occurrence evidence, not one shared descendant. General argument-sharing sufficiency remains a linguistic boundary. |
| 35 | Implemented locally | The reported native branches consume prepared participants/content, including focus, theta, Case, PF morphology/correspondence, storage, Transfer, candidates and cyclic columns. Missing grouping and ambiguous step multiplicity receive diagnostics, not truncated drawings. Independent native and browser checks cover the repaired cases; universal alias/composition coverage is not claimed. |
| 36 | Prototype verified on saved cases | Transfer/cyclic duplicates and the duplicated gap-notation I are repaired. Residual rails retain authored current-participant context with stage-scoped persistence. Saved-case mixed composition has prototype browser evidence; broader composition and integration remain to be qualified. Independent claims are not deleted. |
| 37 | Implemented locally | Outcome data reaches existing path/candidate graphics. Allowed outcomes do not earn blocked-only marks; contradictory same-host claims stay neutral with a cause diagnostic. All-variant native qualification remains under 39. |
| 38 | Implemented locally | Recovery checks the exact authored gap/copy, including category-typed silent occurrences and t variants. A containing VP is not that trace; ordinary silence does not imply deletion. |
| 39 | Partial | The bounded stage-continuity candidate has a 1,574-test gate, all 137 saved desktop frame comparisons and focused do-support zoom/Fit/backward recordings. It preserves the other 135 frames. The broader coordinate rewrite remains rejected. Main's 1,512-test gate includes Tree Bank. The prototype diff has been reviewed for committing. Application/export checks and linguistic review remain open; main integration is outside scope. |

Additional required proof from the audit, beyond the numbered findings:

- [ ] Discuss the completed Codex/Fable review of all four analyses with Francis,
  including lexical
  selection/projection, theta and Case, Agree/wh licensing, locality/Transfer,
  head movement, do-support, and operation order. Resolve Fable Minimalism's
  unexplained object Case and look-ahead account, necessary operation interleaving,
  and relations that refer to a landing before its movement moment. Keep
  legitimate framework choices separate from errors and unspecified assumptions.
- [x] Render both Fable inspection copies with every change disclosed. Keep raw
  output, mechanical formatting edits, and any proposed semantic change separate;
  do not replace the saved originals or regenerate them just to inspect them.
- [ ] Recheck all 36 relation entries against approved Tier 1/Tier 2 drawings.
  Every remaining fallback needs an explanation. Do not force a known drawing
  where the authored evidence does not support it.
- [x] Check all 137 prototype Replay frames on desktop/mobile, plus backward
  revisits and the fixed Astra Minimalism F29→30 transition at fit/settled zoom.
- [x] Retain available Tier-3 participants without changing existing sizing or spacing
  in the narrow prototype repair; checked against all four archived bundles.
- [ ] Resolve the remaining saved transition findings and qualify active zoom/Next.
  The broader coordinate repair remains rejected and reverted.
- [ ] Qualify the assembled app's motion, hover, text bounds, panels, exports and
  identical-input casing, plus the no-participant presentation decision.
  Still screenshots and an unchanged camera transform alone are insufficient.
- [ ] Verify the same saved outputs through the production generation/review
  path, with focused regression tests for these failure classes. Review any
  changed fixtures rather than accepting regenerated results blindly; run the
  repository completion gate after approved broad implementation.

Resume broader qualification only when these findings have explicit resolutions
and the saved outputs can be inspected faithfully. Fresh provider runs still
need approved conditions and a cost limit. Programs 2 onward remain on the
roadmap; this audit does not replace or complete them.

### Qualification After The Audit

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
