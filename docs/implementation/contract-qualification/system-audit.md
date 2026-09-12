# Babel generation and renderer audit

Evidence baseline: 5 September 2026. Preserved in the repository on 7 September 2026 at Francis's request. This document records findings, not implementation status. The active checklist and work order are in [Program 1 of ROADMAP.md](../../../ROADMAP.md#current-priority-resolve-the-september-system-audit). No proposed fix was approved by preserving this audit.

The [field-by-field contract audit](#field-by-field-contract-audit) adds the 7 September inspection of the exact sent instructions, request formatting settings, every authored field, and error propagation. It includes 58 local probes and reproductions of both Fable failures. It does not change product behavior.

On 8 September, Francis reaffirmed the work order: continue inspecting and grilling across the system, record agreed decisions and newly discovered problems here, and implement only after reaching shared understanding. Agreement on an individual fix is not permission to start it during this discussion. No further provider calls are authorized.

On 9 September, Francis approved the bounded wording review followed by stage-preservation and diagnostic implementation. The [implementation evidence](#stage-preservation-and-diagnostics) below distinguishes those changes from the original observations and still-open proposals. Status remains in ROADMAP.md. A broader relation-format redesign is still an option for discussion, not an approved implementation.

## Read this first

These outputs expose failures across Babel's parser, relation recovery, Replay, and presentation. They are not a collection of unrelated visual blemishes, and they are not sufficient evidence that the models cannot produce the analyses.

The most consequential findings are:

1. **Babel caused the misleading Fable reference errors.** Fable used the wrong container shape for three `values` fields. Babel discarded their entire stages, then complained that subsequent references to nodes in those discarded stages did not exist. Those nodes do exist in Fable's original history.
2. **Movement recovery and movement playback are disconnected.** The generic relation recipes reject several well-supported movements. Separately, Replay's atomic movement machinery still depends on registered movement identities. Merely adding aliases to the classifier would not finish the repair.
3. **The empty-looking nodes have several different causes.** Some are legitimate abstract or null heads. Others are silent copies whose lexical words the contract explicitly tells the model to remove. Replay then changes their pronunciation too early because it has not recognized the movement. Inventing terminal children would conceal this distinction.
4. **The clipping plaque is an existing approved Agree design receiving text it cannot fit.** Its geometry uses a character-count approximation that does not match the rendered font. Additional rows can also be silently discarded.
5. **The review at audit time used production-renderer screenshots.** Most of the visible defects therefore exist in Babel proper. That review added scaling and interaction limitations of its own; the later live-inspection repair below replaces its screenshot playback.
6. **The saved estimate is $1.73756 for four generations, not a hidden retry cascade.** Most cost and elapsed time came from model output and reasoning. Both Fable analyses can be recovered for inspection without another provider call or any node-ID change.

I initially made implementation changes during this audit. After Francis corrected the scope, I removed all of those code and test changes, including the Tier 3 changes. At the end of that audit, the only tracked modification was the pre-existing `App.tsx` change. No implementation from the audit was committed or pushed.

Withdrawn experimental results from the temporary `current/` directory are excluded from this evidence set. The `*.baseline-evidence.json` files were collected after restoring the original implementation.

## Accumulated-diff review

On 10 September Francis requested larger connected batches and a regression
review before continuing. The four batches and all 39 finding statuses are now
reconciled in ROADMAP.md. This review changed documentation only. It did not
change production code, prompt text, provider settings or saved model outputs.

The reviewed snapshot contains 47 modified or untracked files against HEAD,
including the new role-binding, movement, inspection and test files that a plain
tracked diff would omit. File hashes confirmed that product inputs did not change
during the review. The full gate passed typecheck, 1,091 tests and both committed
parse fixtures. The 86 broader relation probes were rerun against current code.
Their selected claims differ from the earlier run only in the two intended
safeguards: a phase head no longer becomes its containing phase, and shared
descendant lineage no longer establishes whole-constituent movement. The other
known probe failures remain. This is not an all-family visual sign-off.

### Confirmed drawing-input regression

Finding 35 also affects the newly accepted equivalent Tier-1 roles, not just the
older Tier-2 path. A local FProjection record uses accentBearer a, projections
[mid, root], and values feature F / accent H*. Its workspace is a DP root over
an NP mid over the lexical N a. Changing only projections to projectionNodes,
or also accentBearer to accented, preserves the prepared drawing plan and earns
Tier 1 under registry version 12. The old registry version 11 leaves that spelling
as a signature-incomplete fallback under the same dispatch check.

The native renderer still reads raw relationRef.anchors.accentBearer and
relationRef.anchors.projections at TreeVisualizer.tsx lines 3872-3874. It does not
use the resolved path that the plan supplies. The browser comparison reproduced
the following on both 1600 x 1100 desktop and 390 x 844 mobile:

| Input spelling | Native F-projection paths | Native feature labels |
| --- | --- | --- |
| accentBearer + projections | 2 | 3 |
| accentBearer + projectionNodes | 0 | 1 |
| accented + projectionNodes | 0 | 1 |

This is a blocking correctness defect in the accumulated change: newly recognized
input is presented as the curated drawing but loses its projection paths.
The same plan comparison passes, demonstrating why plan equality alone is
insufficient. The fix belongs in Batch 2: make the existing drawing consume the
resolved path, participants and annotations, and test the actual SVG content.
Keep the original relationRef for inspection. Do not rename the raw record or
add another alias interpreter inside D3. Check every special drawing branch that
rereads raw anchors, not just FProjection.

### Existing style parity gap

The canonical FProjection comparison also has nearly invisible feature text and
unpainted paths in the app. Its path and text styling is defined in the Orchard's
orchard.html at lines 1350 and 1439-1457, but the application styles only include
the F-projection arrowhead in the shared ink rules. The specializer relies on
those missing class styles rather than assigning them inline. This gap predates
the reviewed diff; TreeVisualizer's specializer and styles.css were already in
that state. Extend findings 35 and 39 to check approved styling in the production
app as well as the Orchard. Do not copy Orchard-wide layout or obsolete glow
rules into Babel. Path elements existing in the DOM are not proof of readable
graphics. No styling change was made in this review.

The local browser used the production app at 127.0.0.1:5177 and the existing
analysis-injection hook. It loaded fixtures only, blocked provider and external
requests, exercised native Replay selection, and captured all six states. No
console errors or framework overlay occurred. The owned browser closed; the
pre-existing development server was not stopped. Browser plugin was unavailable,
so the check used the installed Playwright. Evidence is temporarily retained at
/tmp/babel-connected-review-QE5mCw/native-alias-evidence.json and the corresponding
canonical/equivalent-projections/equivalent-both screenshots. The exact reproducer
above remains here independently of those temporary files.

### Fable review and checked concerns

Fable 5.1's first read-only review reached its 24-turn limit without findings.
It is not a completed review. A second code-only review completed in seven turns.
Its suggestions were checked rather than counted as confirmed regressions:

| Concern | Follow-up result |
| --- | --- |
| Two movement-source roles with different IDs stop earning Tier 1. | Reproduced using registered AbarMove; Fable's literal WhMove example is unregistered in both versions. Source dp-low and from vp-1 previously passed the signature and now produce a conflicting-role-bindings diagnostic. That is the intended ambiguity safeguard, not permission to choose one silently. |
| Reusing an existing T host reveals a raised verb early. | Not reproduced. Two stages retain host t1 and introduce v-raised under it with a silent v-low below. No earlier Replay step exposes v-raised; the movement moment contains the full landing. |
| An Agree/Case companion is lost with assigner T, bearer dp, source T. | Not reproduced: the equivalent repeated source is bound consistently and both complete claims remain Tier 1. Excluding genuinely incomplete companions is intentional; no-salvage protection remains. |
| A ParseApiError without supplied details causes a missing failure object. | Not reproduced. The constructor always creates failure, including fieldPath, even for a transport error without details. The fail-fast malformed-stage behavior itself is the agreed no-stage-loss change. |
| Wordless movement arrows lack attachment metadata. | The renderer obtains attachment attributes from the compiled trajectory plan at lines 4918-4919, not from Replay link metadata. The existing saved-head browser evidence and focused geometry tests cover the shell attachments; no new regression was established. |
| Tree-index lineage is unavailable or inspection output directories do not exist. | The index retains SyntaxNode fields and the movement tests exercise the root-lineage check. buildContractQualificationDryRun creates each attempt directory before writing inspection output. Neither suspicion reproduced. |
| Replay may repeat expensive dispatch work during scrubbing. | Repeated classification is visible in the code. Its incremental cost was not benchmarked in this review; a quadratic slowdown was not established. Measure and remove duplicate work where the shared prepared claim can be reused. |

Fable did not render the drawings, and its review did not identify the confirmed
native FProjection mismatch found by the primary review. Neither review nor the
passing suite proves the entire diff regression-free. Batch 2 must close that
mismatch before shared role binding is treated as complete end to end.

## Connected repair and regression evidence

Francis approved Batches 1 and 2 together, including the Tier-3 movement timing
correction. The changes below implement the agreed behavior; the active finding
statuses remain in ROADMAP.md. No model-facing field, prompt, provider setting,
automatic repair or public acceptance policy was added by this batch.

### Preservation and timing

- Inspection retains every original analysis and stage, including malformed
  ones. It identifies the actual field and original position for bad containers,
  optional node-field types, token alignment and current/prior references. Later
  self-contained workspaces remain inspectable after a broken stage without
  claiming that the broken transition was reconstructed. Stale reference caches
  are cleared rather than used as a guessed history.
- Qualification success also retains inspection evidence. The page now says
  Normalized, not Valid; linguistic and visual review remain explicitly separate.
- Movement recognition and drawing eligibility are separate. A movement with
  sufficient stage/occurrence evidence but an incomplete Tier-1 drawing can stay
  Tier 3 while introducing its entire landing and necessary attachment parent in
  one moment. It earns no arrow and does not bypass the complete Tier-1 recipe.
  The regression uses Fable Minimalism's final stage with AbarMove source dp_wh
  and landing dp_wh_hi but no required trace witness: cp_full and the whole
  landing are absent before that moment and present together at it.
- In Astra Minimalism and Fable X-bar, abstract head movement precedes a separate
  authored realization relation on that head. Replay now moves the abstract head
  first and introduces did at realization. Registered and open-relation variants
  are tested. Unknown prose does not establish a new timing rule, and conflicting
  authored order is still diagnosed rather than silently rewritten.

### Recognition and existing drawings

| Failure class | Implemented correction |
| --- | --- |
| Ordered arrays treated as sets or shortened before pairing | Preserve repeated endpoints, literal values and blank slots. Unequal or blank required role/Case associations do not become invented labels. Optional missing annotations do not erase an independently supported drawing. Unused items remain identifiable in the original record. |
| Generic roles or feature words imply stronger meanings | Require the distinctive supported evidence. Negated or contradictory assertions do not earn affirmative graphics; a polarity minus value is not itself a denial. Established bracketed feature notation remains supported. |
| Structure checks accept the wrong occurrence | Bind exact named parents, carriers and projection paths. Preserve the approved object-accent-to-selecting-head first hop in I9. Covert as well as overt movement cannot establish whole-object identity from a shared descendant alone. |
| Correct recognition loses content in D3 | Existing specializers read prepared participants and content for focus, theta, Case/Agree, Transfer, PF realization/correspondence, fission, impoverishment, storage, candidate outcomes and cyclic columns. Raw relationRef stays available for inspection, not as another role interpreter. |
| Plaques promise unsupported content | Require explicit associations for correspondence and fission, a unique delinking edge, complete cyclic comparison columns and an unambiguous supported authored Case step. Otherwise preserve neutral inspection with a cause diagnostic; do not truncate into a purported full drawing. |
| Independent pieces suppress or duplicate one another | Schedule native drawings by relation and family, keeping their inseparable pieces together. Focus projection and storage both survive in one relation, in either order. Argument-sharing ovals do not depend on an optional role badge. Transfer edges and equivalent cyclic/generic paths are not drawn twice. |
| Complete Tier 1 is vetoed by harmless context | Keep the complete recipe and all original context. Missing or contradictory core participants still fail the exact recipe. Unclaimed extra anchors receive one internal unrendered-context notice after companion consumption; this does not reject the analysis. |
| Approved graphics depend on Orchard-only CSS | Ship the existing native ink styles in the app, including focus, morphology, storage, Case and cyclic columns/anchor rails. No research-page layout or Tier-3 redesign was imported. |

Cyclic columns use the exact current and prior workspace witnesses, or explicitly
authored prior/current literal columns. Generic order prose alone does not supply
two columns. Dependent Case retains the previous default when no step is authored;
an explicit unknown step does not silently select that default.

### Review and verification limits

Two bounded Fable 5.1 code reviews examined frozen source changes. Confirmed
findings were reproduced and repaired, including optional-label dependence,
feature-notation narrowing, blank required labels, incomplete native columns and
unknown Case-step defaults. The reviews were not visual sign-offs. Their proposed
scalar-Transfer regression, rawBytes scope error, snapshot mutation, missing-source
crash and lost earlier Transfer-edge persistence did not reproduce. A direct
qualification run also disproved the claim that unrendered-context rejects a
complete analysis: its bundle, Replay and graphics remain available with
valid-pending-review status. Fixture-specific empty-diagnostic assertions are not
a public acceptance gate.

Independent checks reproduced four further shared defects before repair: blank
slot erasure, sibling drawing suppression, negated specialized features, and
descendant-only covert identity. The original 23 checks subsequently passed,
along with 31 positive/hypothesis controls and all 55 current Orchard plans.
Additional follow-up screens distinguish actual behavior from review hypotheses.
The durable regressions are in tests/derivationDiagnostics.test.mjs,
workspaceInspection.test.mjs, recoveredMovement.test.mjs, tier2Batch2.test.mjs,
nativeRelationContent.test.mjs and the focused existing relation suites.

After the final fixes, npm run verify:all exits successfully: TypeScript,
1,186 tests and both normalized parse fixtures pass. The final log is
/tmp/babel-connected-settled-gate.log. Two older cyclic persistence tests now
provide the complete prior/current columns their drawing requires; their
persistence assertions remain unchanged, and missing-column negative tests
still verify fallback. Git diff --check also passes.

The integrated production-app pass captured 551 states across the four saved
analyses, 55 current Orchard cards and three targeted controls. It exercised
desktop/mobile Replay, Prev/Next and zoom, with zero runtime errors or provider
requests. All checked movement paths and the Tier-3 parent/landing timing passed.
Two initial mobile focus assertions sampled between deferred redraws; the PNG
already showed the paths. Focused rechecks sample the actual native drawing and
pass. Separate 28-state follow-up evidence covers I9, combined focus/storage,
unlabelled sharing and all three cyclic-order spellings. A temporary driver's
attempt to select a frame before Replay mounted was corrected in the driver,
not in Babel core.

The evidence remains outside the worktree under
/tmp/babel-connected-visual-4LTsDK and /tmp/babel-connected-followup-4PbkMx,
with cyclic follow-up under /tmp/babel-connected-followup-mE09gw. The first
follow-up contains 16 successful states before the driver's mount-timing failure;
the separate cyclic run supplies the remaining 12 successful states. Recordings
and screenshots are evidence of those checked cases, not proof that layout is
finished: Replay panels still overlap syntax or marks on compact viewports.

The 52-rule/69-piece inventory still has coverage gaps. Recipe-generated tests
and metadata-stripped plan comparisons are execution checks, not independent
proof of every recovered meaning. Native drawing-function tests use a minimal
SVG/selection double; the browser checks separately establish actual rendering.
Unsettled smaller Control/covert/idiom drawings, standalone transferred domains,
general argument-sharing evidence, plaque partition/overflow and Tier-3 stacking
remain decisions. Babel has not received a complete renderer qualification.

## Replay and live inspection repair

Francis approved Batch 3 on 10 September. This work changes presentation and
inspection, not the model-facing contract, provider requests, automatic repair,
or Tier-3 composition. The four original outputs remain unchanged.

| Defect | Correction and proof |
| --- | --- |
| Operation/name hidden in the corner, with rewritten or incomplete support text | The primary white heading names External Merge or the exact authored relation. Panels read original anchors and values, retaining repeated/list entries, punctuation and scripts. Movement still has Source/Landing, followed by remaining evidence. Macro moments retain the original stage statement. `replayPanelContent.test.mjs` checks all four saved analyses and independent literal-content cases. |
| Plaque wrapping disagrees with its shell; rows disappear after eight | `plaqueTextLayout.ts` prepares every row, its index, line breaks and bounds. Production SVG supplies actual font metrics and paints that same layout. Grapheme wrapping preserves unbroken and multilingual text; font readiness and later font loading trigger remeasurement. `plaqueTextLayout.test.mjs` and browser ink-versus-shell checks cover long text, twelve rows, Unicode and zoom. |
| Agree plaque vanishes on a wordless head | Placement previously required the anchor's terminal rectangle. The exact wordless category rectangle is now usable without adding a terminal or choosing a different anchor. Astra Minimalism's transitiveV probe and an independent FeatureBundle control reproduce the correction. |
| Replay overlaps syntax or cyclic columns | Fit bounds use the measured header, panel and external app controls. The existing cyclic plate and tree use the same remaining area, beside one another or stacked on narrow canvases. Manual zoom/pan survives frame changes; Fit tree restores automatic fitting. `treeViewport.test.mjs` covers the geometry, supplemented by production-browser checks. This does not solve every annotation overflow. |
| Screenshot review cannot behave like Babel | The offline page bundles production TreeVisualizer, Replay, fonts and styles. Native controls scrub and play actual frames. Raw response, normalized record, diagnostics, archived Replay and corrections remain separate views. Original failures remain failures in their archived record; explicit hash-bound inspection copies provide the two Fable Replays. The live review tests check rendering, all evidence views, copy provenance and unchanged source files. |

### Review corrections

A bounded Fable 5.1 code review identified lost macro statement text and an inline
script hazard. Both were reproduced and fixed. Fable's suggested replacement of
the operation heading with recipe text was not adopted: the original statement
is supporting text at its macro moment, while the required operation heading
stays prominent. Note deduplication now compares only text actually displayed.
For the HTML hazard, a runtime string containing `<!-- <script></script>` made
the original offline page fail to execute; escaping the comment opener preserves
the string and fixes the browser reproduction.

Independent review also found an unsafe numeric camera cache introduced during
this batch. In Astra Minimalism frames 23 to 26, layout width changes from 6060
to 5880 despite the same authored stage and active future scaffolding. Reusing
the transform miscenters the fit by 19.15px. The cache was removed before final
verification; automatic fitting retains the existing full-stage computation.
User-requested pan/zoom remains separately preserved. This is not proof that all
pre-existing layout motion is resolved.

Other review concerns were checked rather than treated as findings. Header
height remained 36.5px in every checked desktop/mobile state. Painted plaque
fonts match the measurement styles, including the already-uppercase feature
title. Node 24 and the tested browser support Intl.Segmenter; no speculative
legacy fallback was added. Larger measured line boxes keep text inside their
shell; long-content viewport overflow remains open. Measurement cost and Fit
tree's full SVG redraw have not been separately profiled.

### Verification and limits

The final `npm run verify:all` passes TypeScript, 1,225 tests and both committed
parse fixtures, with no snapshot regeneration. Two old source-text assertions
required the removed heading suppression and fixed cyclic threshold. Those
assertions were removed; actual headings and measured placement are covered by
the new behavior tests and browser checks. Other assertions remain intact.

The production-app pass covered 254 states from all four saved analyses,
seven representative Orchard cards and the twelve-row wordless-head control on
1600 x 1100 and 390 x 844 viewports. Its assertions reported no runtime errors,
provider requests, feature-plaque ink outside its shell, panel horizontal
overflow, or tree-label collisions with the measured header/panel. This was
not an all-plaque check: the PF plate uses a separate painter and was omitted.
The screenshot findings below supersede the broader wrapping claim. The rebuilt self-contained page adds
eight desktop/mobile cases with native play/pause, Prev/Next and scrubbing;
all original statements, raw responses and copy corrections remain accessible.
Full Replay counts are 36/38/27/36 for Astra Minimalism/X-bar and Fable
Minimalism/X-bar. These are not the old compact screenshot-frame counts.

Temporary evidence is in `/tmp/babel-batch3-verified-aiK3eE/evidence.json`,
`/tmp/babel-batch3-review-verified-rD2NTx/evidence.json` and their PNG/video files.
The review page is `/tmp/babel-replay-review-20260910/index.html`; its receipt
records bundled source hashes. The final gate log is
`/tmp/babel-batch3-final-gate.log`. Owned browser and review processes exited;
the pre-existing development server was left running.

Tall plaques and some annotation rails can still extend behind Replay. Small
mobile overviews still require zoom to read fine detail. Tier-3 numbering,
stacking and the long-content interaction remain for one design review, with no
new reading-view button or selective removal of plaque values. The screenshot
findings below reopen the connected renderer work before Batch 4. No further
Babel generation is authorized.

### Screenshot review reopens renderer work

Francis's 10 September manual review exposed missed defects and a new heading
regression. These observations were reproduced against the current offline
production bundle, not attributed to stale screenshots. Frame numbers below
refer to the live 36/38/27/36-frame review. This follow-up changed documentation
only; saved analyses, prompt, production code and Tier-3 design remain unchanged.

| Screenshot / existing findings | Confirmed cause and owner | Correction to investigate and required proof |
| --- | --- | --- |
| 1: round 1 beside Agree; 18/19/36 | The circles are not Agree marks. In Astra Minimalism F29 and F33 they belong to earlier Internal Merge relations, whose unused `licensor` anchors are `transitiveV` and `finiteT`. Their fallback marks persist beside independently owned Agree plaques. `renderPlanCompiler.ts` resets fallback instance counting for each relation name in each stage, hence many unrelated 1s. | Distinguish necessary residual claims from contextual anchors; do not remove actual unsupported claims or silently redesign Tier 3. Check owner IDs and final native marks when recovered and fallback pieces coexist. |
| 2: apparently empty head movement; 11/30 | Astra Minimalism explicitly introduces abstract past T, moves it to C at F29, and realizes it as did at F30. The arrow has an earlier T source; it is not moving an invented word. Astra X-bar similarly realizes the moved I only at F37. | Preserve authored abstract structure and realization timing. Test actual source/landing presence, not whether the head already has a pronounced word. This does not certify every claim in either analysis. |
| 3: PF text overflow; 16/35/39 | `TreeVisualizer.tsx` routes realization to `renderPfRealizationPlate`, bypassing shared plaque layout. Its shell is 590 tree units wide and its scalar row is unwrapped. Astra Minimalism F30 has a 326.59px text line in a 159.45px shell at the checked zoom. | Bring every supported native plaque painter under actual ink-versus-shell checks; use measured layout without rewriting or dropping literal values. The earlier feature-plaque-only check missed this path. |
| 4: Internal Merge arrow plus U-shaped connector; 18/19/36 | Astra Minimalism F33 recovers Tier-2 movement from `edgeObjectDP` to `frontedObjectDP`. The same relation's remaining `licensor: questionC` and `thematicOccurrence: objectDP` produce a Tier-3 two-anchor rail. Other earlier fallback marks remain visible. This is mixed per-claim output, not the whole movement falling back. | Review residual evidence ownership across recovered claims. Preserve the complete record and meaningful independent claims; merely being an unconsumed anchor must not be confused with a proven additional dependency. Keep unresolved fallback display policy explicit. |
| 5: badge moves when buy is selected; 23/36/39 | Astra X-bar F14 to F15 leaves the object NP coordinates and canvas size unchanged. A future theta-grid badge is allocated first at stage entry, before its F19 moment. It consumes stack slot 0, moving the persistent wh badge to slot 1. DOM y changes 1342 to 1480 at marker scale 3, a 35.95px screen shift. The native theta painter then uses different placement from this generic stack reservation. | Only actual, appropriately timed marks may reserve shared badge slots. Test persistent owner-relative positions before/after an unrelated selection and before the future relation activates. Do not patch camera fitting for this defect. |
| 6: Select / Project loses its target; 14/39 | Batch 3 changed `formatPlaybackOperationTitle` to return the operation alone. Generated recipes still identify Select buy and Project V. The new tests explicitly expected the shortened labels, so they encoded the regression. | Restore the selected word/projected category in the primary structural heading; preserve exact authored relation headings separately. Assert Select buy and Project V in the actual Replay panel. |
| 7: CP hangs left; 13/23 | Astra X-bar F30 has an authored unary `questionCP -> questionCbar`. Future-layout scaffolding also places the later `frontedNP` beneath that CP for D3 layout, then hides it. CP is centered over the future two-child topology rather than its current only child. The unseen NP edge is not painted at this frame. | The subsequent approved presentation rule below withholds an unneeded unary top projection until the phrasal landing attaches. Saved stages retain the earlier CP. Do not apply this to every CP or hide an earlier relation's required anchor. |
| 8: bare landing NP at wh licensing; 10/13/39 | Astra X-bar F33 initially hides `frontedNP` correctly. `carryReplayRelationLinksForward` then promotes every referenced anchor to visible, including this `replayLayoutOnly` placeholder. Its children stay hidden until F34 movement. Separately, the authored relation order places licensing of this landing before its movement; an existing diagnostic records that conflict. | Carry-forward must not expose suppressed/future syntax. Preserve the original relation and diagnostic. Do not silently reorder it or attach it to another occurrence. Choosing how to show an unavailable-anchor moment remains distinct from fixing the visibility leak. |
| 9a: floating I; 36/38 | Fable X-bar F30 paints the actual lower node `i1` as a muted category I. Independently, the recovered `gap.notation` piece copies that node's label into a second `vr-badge-gap-notation` I. Both belong to the same movement's representation. | Use the authored occurrence's displayed notation without adding a redundant second label. Test category-typed traces, explicit trace notation and retained silent copies through the production renderer; do not substitute t automatically. |
| 9b: C arrives late during head movement; 10/11/13 | Fable X-bar's recovered head movement also satisfies the fallback/nonmovement-transition check through `priorAnchors`. That suppresses all structural micro-steps, including Select c0. F30 introduces i2 and ancestor shells c1/cbar1/cp1; c0 remains hidden until the completed-stage F32. Do-support F31 is separate. | Movement recovery and structural-step scheduling must share the same classification. Preserve independent prerequisites, attach only necessary new movement parents atomically, and compare every moment with the completed stage. CP before wh is explicitly authored in both X-bar records; missing C and premature shells are separate playback errors. |
| 10: 3 and binding curve; 18/31/36 | Fable X-bar F35 recovers the approved operator-variable path from lower dp1 to binder dp3, not Sideward Movement. A separate earlier wh trajectory persists. The displayed 3 is not model-authored: `tier2RenderPlanCompiler.ts` defaults the binding index to relation position plus one. | Keep binding distinct from movement. Review consistent displayed coindex notation and simultaneous paths; a relation-list position is not an authored linguistic index. Test with/without an explicit index and with an earlier movement on the same endpoints. |

The two X-bar records explicitly create CP with only C' before adding the wh
specifier. Fable's stage 4 says: "The specifier of CP has not yet been introduced;
CP at this stage projects only from C'." The later approval distinguishes the
saved analysis from its displayed sequence: Replay may withhold that unary top
projection until wh movement without deleting it from the saved stage. A
recognized head movement does not justify revealing every higher projection.

Abstract heads moving before pronunciation have a linguistic basis, independently
of Babel: [Embick and Noyer (2001), sections 2 and 7.2](https://babel.ucsc.edu/~hank/mrg.readings/embick%26noyer2001.pdf)
distinguish abstract terminals from later exponents and discuss T-to-C followed
by do-support. This supports the possibility, not wholesale approval of these
models' analyses or a requirement to use that treatment.

The read-only production-browser pass reproduced 16 relevant states at
1600 x 1100, blocking non-file requests, with no runtime errors or external
requests. Evidence: `/tmp/babel-user-screens-c41dSX/evidence.json` and adjacent
PNGs. Separate replay probes distinguish authored trees, hidden scaffolding,
visibility after carry-forward, and mark ownership. The browser exited and
both read-only review agents were closed. No new generation or renderer fix
was performed during this explanation pass.

### Screenshot fixes and presentation boundary

Francis approved the connected fixes, including delaying the displayed unary
top projection until the phrasal movement. This is a Replay presentation rule,
not a claim that the model authored a different earlier stage. No original
record, relation order, prompt or tier-acceptance policy was changed.

Implemented:

- Selection and projection headings identify their target again: Select buy and
  Project V. Authored relation headings remain literal. Step counts are recounted
  after all Replay insertions and removals, not only for CP deferrals.
- Carry-forward cannot reveal a hidden future landing through an earlier
  relation's anchor. Astra X-bar still records the licensing-before-movement
  conflict; Replay does not silently reorder it or substitute an anchor.
- Recovered movement no longer triggers the unrelated fallback-transition rule
  that suppressed independent C construction. A separate later PF change stays
  at its own relation moment, including when it affects an unrelated node.
- An existing unary workspace root can wait for an evidenced phrasal landing
  that supplies its second child. Its carried child and independent workspaces
  remain visible. An earlier current or prior anchor prevents withholding the
  root. No category names are hardcoded, and no-movement cases are unchanged.
- A gap annotation reuses the exact occurrence's already displayed notation
  when it matches, including supported subscript formatting. Fable's real
  lower I remains; the second floating I does not. Different authored notation
  is not suppressed. Reuse also avoids reserving an unused badge slot.
- Native painters no longer consume generic badge slots they do not use.
  Generic marks allocate in authored order, so future marks do not displace
  persistent marks on an unrelated selection. Paint order is unchanged.
- The native PF plate now measures and wraps both literal prose and rewrite
  columns. It retains every visible row, its owner, arrow and final-row emphasis.
  This fixes text escaping its shell, not all overlapping annotation layouts.

Fable's read-only review led to progress recounting for every analysis, the
prior-anchor safeguard and a regression for unrelated PF timing. The review
also exposed original relation indices being lost when an unnamed entry was
filtered. Derived Replay identities and link limits now retain original array
positions, so later headings and marks cannot shift onto a sibling. The raw
entry remains untouched. This does not make its missing name valid.

Verification: `npm run verify:all` passed 1,274 tests, typecheck and both parse
fixtures. Focused checks cover all eleven saved movements, projection deferral
with and without earlier anchors, no-movement controls, independent workspaces,
PF timing, actual native painter execution and exact badge allocation.

One integrated production-browser pass checked 588 Replay states at 1600 x 1100
and 390 x 844: all frames from the four saved analyses and Orchard A1, A2, C, D,
D6, H6 and I9. Assertions cover visible CP/landing/C nodes, headings, duplicate
I, persistent badge coordinates, and feature/PF ink within measured shells,
including zoom. Next/Prev, Play/Pause, scrubbing, raw response and correction
views also passed on the offline page. No runtime errors or external requests
occurred. Screenshots and a recording are in
`/tmp/babel-screenshot-fixes-13f6cn/`; before captures remain in
`/tmp/babel-user-screens-c41dSX/`. The browser and review process exited.

The rebuilt inspection page is `/tmp/babel-replay-fixed-20260910-r3/index.html`.
The final follow-up corrects diagnostic wording to describe the original ordering
conflict without claiming the now-hidden landing is displayed early, and binds
relation-link limits to original indices. All 68 focused Replay checks passed
afterward. All outputs and Fable correction provenance remain available. No new
Babel generation was made.

Still open: Tier-3 instance numbers and stacking, residual-context connectors,
the binding index derived from relation position, overlapping persistent marks,
and long-plaque interaction. Small mobile overview text still requires zoom.
These are not marked solved by passing geometry or runtime checks. Review these
display decisions next; Batch 4's prompt and provider-stub work remains on the
roadmap and needs no fresh paid generation.

### Readiness inspection: not ready

The follow-up inspection checked every Replay frame on the rebuilt offline page:
137 frames across the four saved analyses at both 1600 x 1100 and 390 x 844,
274 measured states. Desktop captures cover every frame; mobile captures cover
the last seven of each analysis. Fable uses the separately labelled inspection
copies, not newly successful provider responses. The page imports production
`TreeVisualizer`; these failures are not a second renderer in the review page.

The previous assertions proved that plaque text fits inside its own shell.
They did not prove that the shell avoids the tree, other badges or paths.
The new inspection found overlaps in 48 measured states. Repetition across
frames and viewports does not make these 48 independent bugs.

| Remaining defect | Exact evidence | Cause and required check |
| --- | --- | --- |
| Agree plaques obscure syntax | Astra Minimalism frame 18 hides V and buy; frame 25 also overlaps N in the lower wh copy; later badges intersect both plaques | The accepted feature painter places a plaque relative to its anchor and avoids previously placed feature plaques, but not tree labels or generic badges. `refineFeaturePlaques` skips accepted placements. Verify occupied geometry across drawing types, retaining exact claim/anchor ownership and the approved drawings. |
| PF plaques and badges overlap | Astra X-bar frames 36-37; Fable X-bar frames 35-37 | PF candidate placement checks category/terminal labels, but excludes fallback badges. Check the composed drawing rather than each painter's own bounds. |
| Automatic fit changes within one authored stage | Fable Minimalism frames 25-26, stage 5, changes scale from 0.27553 to 0.30399 on desktop. Further same-stage changes occur in all four analyses, ten transitions per viewport | `derivationFrameFitNodes` chooses the current hidden layout scaffold or completed-stage forest; fitting runs again for each step and includes current overlay bounds. In this example the scaffold has 28 nodes before movement, the completed forest 26. The fit is not stage-stable. Check the camera transform and surviving node positions across every step of a stage, including source-to-lower-copy changes. Manual camera preservation is a different invariant and still passes. |
| Numbered fallback clutter and residual connectors remain | Final Astra Minimalism, Astra X-bar and Fable X-bar views retain 10, 8 and 13 numbered badges respectively; Fable binding still uses the derived 3 | These are the already open numbering, residual-claim and composition decisions. A successful movement drawing does not establish that its sibling fallback marks are appropriate. Do not silently remove authored information or redesign Tier 3 during inspection. |

The corrected Select/Project headings, deferred CP/complete wh landing, C before
head movement and removal of the duplicate I remain visible in the captures.
No measured category/terminal labels or feature/PF shells were outside the
automatic-fit viewport or behind the Replay panel. This is not a guarantee for
all path intersections. Mobile overview text remains too small to read without
zoom. All eight manual zoom/pan/Prev checks retained the chosen camera. Raw
response, corrections, tier coverage and stage inspection remained accessible.

Evidence is `/tmp/babel-readiness-JUQs9j/evidence.json` and adjacent captures.
There were no runtime errors or external requests. The inspection browser
closed. No product code, prompt, original analysis or Tier-3 policy changed in
this inspection. This page did not pass readiness; the subsequent camera repair
and decision to defer plaque placement are recorded below.

### Camera repair and deferred plaque design

Francis authorized the camera repair and asked to leave plaques and repeated
numbers alone for now. Covering tree labels is not newly approved or forbidden.
There is no agreed placement/overflow design for several long plaques. Moving
them to the side may require much more canvas space or make the fitted tree too
small. Do not impose a new stack, hide values or shorten authored content as a
side effect of the camera repair.

Replay now fits the union of the layouts used within one authored stage. It
includes the pre-movement source material and the post-movement layout, plus
nominal relation bounds where the existing composition includes them in fitting.
The calculation does not read the currently visible labels or camera. Visiting
the final step first, going backwards and direct scrubbing give the same fit.
It is memoized per stage and viewport; manual pan/zoom still takes precedence.
The underlying syntax, node coordinates, relation drawing recipes, plaque
placement and badge numbering are unchanged. This fixes automatic camera
changes, not every change in tree geometry during structural operations.

`npm run verify:all` passed 1,284 tests, typecheck and both parse fixtures.
Ten new focused tests cover all saved stages on desktop/mobile, reversed step
order, source-leaf disappearance, input immutability and tree-first fitting.
The browser checked 862 states in the app and offline review at 1600 x 1100 and
390 x 844: the four saved analyses and Orchard A1, A2, C, D, D6, H6 and I9.
There were no same-stage camera changes, no clipped measured tree labels and
no labels behind the Replay panel in automatic fit. Direct/reverse navigation,
manual zoom/pan and Fit passed. Runtime errors and external requests were zero.
The initial temporary browser script supplied stage-only fixtures where the app
requires complete bundles; that script error was corrected before this pass.

Before captures remain in `/tmp/babel-readiness-JUQs9j/`. After captures, the
measurement receipt and a short playback recording are in
`/tmp/babel-camera-check-B3nu3J/`. The verified offline page is
`/tmp/babel-camera-fixed-20260910/index.html`. The temporary browser exited; the
pre-existing Vite process was left alone. The final memo cleanup removes an
unused relation-link argument/dependency; all 40 focused checks pass afterward.
No new provider generation, prompt edit or linguistic change was made.

Plaque overlaps, repeated numbers, residual-context connectors and binding index
notation remain open. They do not block the already agreed offline Batch-4
prompt/provider work, and they are not a reason to request new paid generations.

### Lower DP trace and stage transition

Francis's follow-up identifies Fable X-bar frames 33-34 on the camera-fixed page.
These expose two different causes, not lost children in Replay.

- The original S4 lower `dp1` contains D', D/Which, NP, N' and N/book. In the
  original S5 JSON, Fable replaces it with `label: "DP"`, `silent: true`,
  `children: []`. Its features include `trace`, and the movement relation names
  `dp1` as its trace and `dp3` as the moved phrase. The Stage Record explicitly
  says the moved DP leaves a trace in object position. This is a compact
  phrase-level trace, not a claim that the phrase became a head.
- The inspection correction only wraps the earlier malformed PF values array.
  Its receipt confirms no nodes or references changed. The saved record and
  compiled movement frame retain exactly the lower form authored by Fable.
  Astra X-bar and both Minimalist wh cases retain their authored lower branching
  structures; there is no general Replay rule collapsing phrasal sources.
- `buy` keeps the same V parent, V' attachment and depth across Fable's movement.
  The desktop capture moves its text top from about 540px to 674px because S4
  ends and S5 begins: fit scale changes from 0.22190 to 0.30399. Unscaled leaf y
  actually changes from 1489.09 to 1470, slightly upward. The lower trace reduces
  maximum layout depth from 11 to 8 and node count from 36 to 29. These are
  positions in two different stage views, not evidence that V moved syntactically.

Francis clarified that this stage transition is acceptable: `buy` occupies a
different screen position in the new stage, rather than jumping within one.
The audit's initial classification as an outstanding camera defect was too
strong and is withdrawn. The same refit predates the camera repair. Keep the
within-stage stability fix; no cross-stage camera repair is required for this
example. A different fit between stages is not itself a defect.

Raw evidence: the original `attempts/fable-xbar/raw-output.txt` and
`audit/fable-xbar.salvage.json` in the saved admission run. Browser evidence:
`/tmp/babel-camera-check-B3nu3J/evidence.json`, review desktop frames 33-34,
compared with `/tmp/babel-readiness-JUQs9j/evidence.json`.

Francis also confirmed that the model decides the copy/trace representation.
Keep the authored compact DP trace; do not restore the previous outline or add
a display convention for it. Neither item requires a renderer or prompt change.
The broader audit remains open; resume the agreed offline Batch-4 work.

## Repair proposal

Implementation scope update: Francis approved Roadmap Batches 1 and 2 together,
including regression review with Fable and local browser verification, but no
new Babel generation. His Tier-3 clarification resolves one timing question:
when the authored stages prove a relocation, its fallback moment introduces
the complete landing and the new parent needed to attach it. The parent must
not appear as an earlier dangling projection. This does not authorize a movement
arrow, promote the claim, fill a missing Tier-1 role, or change fallback styling.
If source identity or order cannot be established, retain that limitation in
diagnostics rather than inventing the transition. Findings 10 and 13 include
this case. The roadmap tracks implementation and verification status.

The proposal below was prepared after the 9 September batch discussion without
accompanying product changes. Its unresolved choices remain proposals; the later
authorization above applies to Roadmap Batches 1 and 2. The
[roadmap work order](../../../ROADMAP.md#repair-work-order) groups every numbered
finding. The original evidence remains below.

### What to simplify first

Keep the current record fields and the approved drawings. The immediate repair does not require a new relation language, a second model to rewrite answers, or a replacement renderer.

There are three different problems behind "the JSON failed":

| Problem | Actual example | Simplest response |
| --- | --- | --- |
| The text is not complete JSON. | Fable Minimalism is missing its final `]}`. | Preserve the bytes and exact parsing location. Its separately labelled inspection copy can use the documented two-character edit. Automatic repair is not decided, and the generation cause is still unknown. |
| The JSON is readable, but a field has the wrong format. | Fable X-bar puts a list directly in `values`. | Define the format clearly and diagnose that field. Let inspection access usable syntax without renaming the list or removing its stage. |
| The data is readable, but Babel interprets or draws it incorrectly. | Supported movement falls back, and Replay builds its landing too early. | Fix recognition and Replay together. A stricter JSON format cannot solve this. |

The main implementation simplification is to stop making all inspection depend on successful final-tree compilation. `normalizeParseResult` currently requires a compiled final tree before returning any stages. Its relation checks can prevent otherwise readable workspace data reaching inspection. Use the existing workspace expansion and production renderer for inspection too, with each original stage and diagnostic retained. Do not build a second parser or renderer that guesses different meanings.

This does not mean "catch the exception and call it valid." A malformed relation can remain available as authored data while a resolvable workspace is inspected. A missing subtree reference prevents expanding that subtree; it must not cause a substitute tree, stale earlier version, or a shortened Replay that appears complete. A later self-contained tree can still be inspected without claiming its missing transition was reconstructed. Unchanged raw output, inspection availability, and successful full compilation are separate facts. The public app's presentation of incomplete processing remains undecided.

Diagnostics should state what actually failed: JSON decoding, the particular field type, a reference in its required stage, final token alignment, relation recognition, or drawing. Include the original location and observed/expected data. Separate an observed failure from its underlying explanation: the wrong `values` container is known; why the provider omitted two closing characters is not. A Babel exception must not be attributed to model linguistics without evidence.

For relation work, compute the supported participants, content, and movement once, then pass that result to both Replay and the existing drawing. Today those consumers make different decisions. Reuse the current render-plan machinery rather than add another general classification layer. Test the resulting behavior independently of the recipe declarations. Do not add prompt aliases or particular linguistic instructions to make a broken drawing pass.

### Prompt and provider processing

Batch 4 uses the already-reviewed wording below. The current X-bar system text is
6,737 UTF-8 bytes, down from 19,729; Minimalism is 6,621, down from 19,983. These
are byte measurements, not token counts or measured inference savings. The
sentence request contains JSON-encoded input and the existing tokenizer's array.
The framework, ambiguity policy and format definitions no longer repeat there.

Active OpenAI, Anthropic, Kimi and Grok adapters send the same selected-framework
instructions and ordinary text containing JSON. OpenAI/Grok/Kimi no longer add
JSON-object mode; Anthropic no longer appends another JSON instruction. Endpoints,
reasoning settings, output allowances, background and storage settings are
unchanged. Gemini/local historical routes are not part of this common comparison.
The original September requests and outputs remain unchanged and retain their
original, unequal formatting conditions.

Each request records the exact sent-body hash, system-text hash, sentence-request
hash and qualified template hash. `sentGenerationConfig.textFormatType` explicitly
records text mode. Current system hashes are
`c7acc64da1b78677cdc531302f26d17ea6a8953cdad214075465f0ef3241a0a7`
for X-bar and
`73224a6e4db419fdc33cf4b1fd4fb4cb1cdfdb2c3b2b6ddbfb0d0cae09b6a096`
for Minimalism. Historical contract manifests are not overwritten.

Transport retries now distinguish an explicit rate limit, uncertain timeout,
received answer, completed stop, application failure and recognized temporary
transport/server failure. Only the last category retries, at most three total
attempts, within the route deadline. A failed OpenAI retrieval keeps its response
ID and cannot restart generation. Retrieval and existing best-effort cancellation
are not counted as new generations. Cancellation remains best-effort, not proof
that the provider stopped work or billing. Its request and body cleanup now have
an independent five-second timeout; an aborted generation signal cannot prevent
the cancellation request. This does not introduce automatic retrieval recovery
or claim every failed network submission was unbilled.

The JSON decoder retains the original engine error and, when reported by Node,
its byte position in both the trimmed candidate and original response. This is
the observed parsing cause, not an explanation of why the model/provider produced
that text. The existing delimiter transformations are unchanged. Successful and
failed generation records retain those diagnostics, each attempted byte edit,
and separate decoding and normalization times. Wrong container types retain
their original stage and field path. Internal engine exceptions keep their own
name/message and processing step in server diagnostics instead of being labelled
as model linguistic failures. No new frontend warning or public failure policy
was introduced.

The portable tests cover all six active models and every configured reasoning
setting through their real adapters with fetch stubbed. They also cover malformed
stages, production-mode error projection, raw bytes, prompt/request hashes, retry
reasons, Replay, tier evidence and Tree Bank persistence. Separate reduced
regressions reproduce both original Fable failures. Delimiter tests preserve
escaped and Unicode node-reference strings across all three transformations.

The full saved-output replay is in `/tmp/babel-batch4-offline-me5zTk/summary.json`.
All 36 stub runs made exactly one simulated generation: 24 compiled Replay from
Astra originals or the already-approved Fable inspection corrections; 12 retained
the malformed Fable originals for complete stage inspection. Minimalism still
reports missing outer closers at byte 6,819, followed by the wrong values container
in stage 3. X-bar reports its values container in stage 4. No stage/reference was
deleted, raw hashes stayed unchanged, and the original outcomes were not promoted
to successful runs. Correction records remain separate from model output.

In this local pass, decoding took 0.02-1.28 ms and normalization 0.10-2.18 ms.
Replay compilation took 30.9-118.2 ms and the separate coverage/evidence builder
33.9-130.5 ms. Whole qualification inspection includes its own Replay/evidence
work, so these measurements must not be summed as disjoint pipeline phases.
They do not measure provider inference or prove a new model cost estimate.
No live Babel generation requests or additional Babel generation charges were
incurred. The independent code review used the authenticated Claude Code
subscription, not Babel's API credentials.

The final offline gate passes 1,398 tests, typecheck and both parse fixtures;
`/tmp/babel-batch4-reviewed-verify.log` records the result. All 15 production-mode
route tests also pass. The assembled browser check covers 64 app/review states
across desktop and mobile, including raw responses, original failed stages,
correction records and compiled inspection copies. Evidence and screenshots are
in `/tmp/babel-batch4-browser-WYLvGp/`. No browser runtime errors, horizontal page
overflow or external requests occurred. This verifies rendering compatibility,
not the unresolved plaque/connector designs or linguistic quality.

Claude Fable 5.1 (`claude-fable-5-1`) reviewed the accumulated dirty diff read-only.
The transcript is temporary evidence at `/tmp/babel-batch4-fable-review.json`.
The review was not an exhaustive proof; it ran no tests or browser. It noticed
concurrent retry refinements and re-read that runtime. The primary agent then
reproduced its concrete finding, applied the correction and ran the final gate.

| Review item | Disposition |
| --- | --- |
| The invention detector required a licensed movement drawing before accepting recovered endpoint order, falsely flagging approved Tier-3 landing timing. | Reproduced by a failing regression, then fixed. Endpoint evidence and arrow permission are checked separately. Incorrect endpoints still fail; adding an unlicensed trajectory now has its own diagnostic. No Replay or drawing policy changed. |
| The dispatch spec still said additional roles are prohibited, although production accepts extra context. | Corrected the spec to describe the existing approved behavior: complete required roles remain mandatory, independent claims may consume context, and remaining context gets a diagnostic. |
| Ordinary text mode can contain fenced JSON, which the current decoder cannot compile. | Added all-six-route checks preserving the exact fenced response and decoding cause without another generation. No fence repair or prompt instruction was added. These stubs cannot measure how often models will do this. |
| Requiring a textual Stage Record narrows the old coercing implementation. | Intentional earlier contract correction, not a new discard policy. Historical non-string records remain inspectable and get a field diagnostic; they do not silently become valid prose. |
| A wrapping Replay header might change the camera fit within a stage. | Not reproduced. A targeted follow-up at 386px checked all 137 saved frames: header height and camera transform stayed identical within each stage. Evidence: `/tmp/babel-batch4-header-check.json`. Other widths or longer future records are not proven. |
| Replay repeatedly computes relation evidence while rebuilding earlier links. | Code-level performance concern remains open. The small-run timings above are not a long-derivation scaling test. Measure before adding caching or changing compilation. |

Additional route tests now prove the three-attempt transient-server cap for all
six active models. OpenAI background retrieval/cancellation has focused runtime
tests; a queued background response is not yet exercised through the entire
public route. Cancellation assertions were moved outside a fetch mock that could
swallow them, so the test genuinely checks the independent signal and headers.
Both temporary browsers and the reviewer exited; the pre-existing development
server was left running.

Raw in-body artifacts retain the existing bounded-size policy and explicit
truncation/hash metadata. This batch does not add unlimited server storage or
settle automatic repair, public incomplete-result handling, extra final roots,
phrase-level silence or simultaneous-relation semantics.

### Reviewed prompt wording

The replacement below is implemented in the live prompt in Batch 4, following Francis's wording review and approval to proceed. It defines the existing format once and removes repeated checklists and exhortations. Offline checks establish request construction and parser behavior, not how a model will respond to this wording. No fresh generation is authorized.

Use exactly one framework introduction, followed by the common instructions. These retain the current framework restrictions. Whether those restrictions cover every intended theoretical variant is a separate linguistic question, not something to loosen under a wording cleanup.

Minimalism introduction:

```text
Analyze the input within the Minimalist Program using Bare Phrase Structure. Use consistent, framework-internal labels without bar-level prime notation or X-bar shells. Keep structure endocentric and Merge outputs binary. Explain the sentence-specific structural choices and derivational commitments in the stage records.
```

X-bar introduction:

```text
Analyze the input within X-bar Theory and Government and Binding Theory. Use consistent X-bar constituent labels and endocentric projections headed by the corresponding lexical or functional category. Phrasal nodes have one or two children in every stage. Attach overt words at heads, not directly at intermediate or maximal projections. Explain the sentence-specific structural choices and derivational commitments in the stage records.
```

Common instructions:

```text
Analyze the exact input, including an ungrammatical input. Explain any judgment within the selected framework rather than changing the sentence.

Response
Return only a single valid JSON object.
For one analysis, its only field is derivationStages, a nonempty array of stages.
For structural ambiguity, the only top-level field is analyses, a nonempty array of analysis objects, each containing only derivationStages. Include every distinct structurally supported reading, without duplicate analyses or an arbitrary count limit.

Stages
Build the derivation forward. Each stage records the complete syntactic workspace after the operations described in stageRecord. The last stage contains the completed analysis of the input. A completed analysis may establish that the input is illicit.
Include the intermediate states needed to explain how the derivation proceeds. Several connected operations may share a stage when their order and effects are explicit. An unchanged workspace needs a sentence-specific syntactic reason for the new stage.
Each stage has exactly these four fields, written in this order:
- statement: a nonblank string naming what the stage establishes.
- stageRecord: a nonblank prose string explaining the operations, their order, and why the resulting state follows within the analysis. Include the reasoning needed to understand this stage, without programming identifiers or JSON bookkeeping.
- relations: an array of this stage's relations, as defined below.
- workspaceForest: an array containing every currently active syntax tree or separate syntax object after these operations.
These fields describe the same analysis. Show the structure the stage record requires, including intermediate positions that matter. Higher structure must preserve or build its lower structure within the chronological derivation. After objects combine, show their combined structure rather than retaining their former independent roots.

Syntax nodes
Each workspaceForest item and child is either a complete node or a reference to an earlier subtree.
A complete node has these required fields:
- id: a nonblank string identifying this occurrence.
- label: a nonblank string naming the syntactic item or category at this node. A projection's label names the projection, not merely its head.
- children: an ordered array of nodes or references, empty for a leaf.
Its optional fields are word, tokenIndex, silent, and lineageId:
- word is a string holding a terminal's lexical content. A wordless abstract item may remain wordless.
- tokenIndex is the zero-based integer index of the input token pronounced by this terminal at this stage. Its word matches that token. Assign each index to at most one pronounced terminal per stage. Unpronounced or not-yet-realized items have no tokenIndex.
- silent is a boolean. On a terminal, true means unpronounced in this stage, even if word retains lexical content. Missing tokenIndex alone does not mean silence. Represent each occurrence's current status, not the status it will acquire later.
- lineageId is a nonblank string shared by distinct occurrences of the same continuing syntactic object. It expresses identity, not a particular dependency type.
Keep an occurrence's id while it persists across stages. Distinct positions in one workspace need distinct ids, sharing lineageId when the analysis identifies them as occurrences of the same object. Preserve the syntax and pronunciation of each occurrence according to the analysis, including its choice of copy or trace representation.

Earlier subtrees
An earlier-subtree reference is an object containing only refId, whose value is an exact earlier node id. It carries that node's latest earlier definition and all its descendants into the current workspace. It cannot refer to a node first introduced in the current or a later stage.
To reuse an unchanged subtree, use refId or write out the entire subtree, including its children. Rewrite a subtree when its structure, pronunciation, lineage, or syntactic position changes. Each occurrence's id must appear at only one position in the expanded workspace, including nodes introduced through refId.
The complete nodes and reference objects use only the fields defined above.

Relations
Record relations that are not fully expressed by the forest's ordinary mother-daughter or sisterhood branching. Explain them in stageRecord. Use an empty relations array when there are none. Names and roles are open; choose them to describe this analysis.
Each relation has exactly these required fields:
- relation: a nonblank string naming the relation.
- anchors: a nonempty object with nonblank role names. Each entry is an exact node-id string or a nonempty array of node-id strings. Every id resolves in the current stage's workspace after expanding refId references, even if the node is written later in the same stage's JSON.
It may also contain these optional fields:
- priorAnchors: the same object format as anchors, but every id resolves in the immediately preceding stage's expanded workspace. Use it when this relation refers to that earlier state, not merely because the current object existed before.
- values: a nonempty object with nonblank entry names. Each entry contains a literal string or a nonempty array of literal strings. Literal strings may be empty. Record the relation's literal content here even when it also appears in its name. Syntax references belong in anchors or priorAnchors. Omit values when there is no literal content.
Anchor-role and value-entry names are not fixed fields or a prescribed vocabulary. Keep array order and repeated entries when they are part of the analysis.
List relations in the derivational order explained in stageRecord, with prerequisites before dependent relations. This orders relations, not the display's selection, projection, and merge steps.
If the analysis makes an illicit judgment, explain it in stageRecord and anchor its relation to the relevant syntax. A judgment about the whole analysis is anchored to its final root.

Input words
In the final stage, the pronounced terminals in tree order match the supplied input tokens. Retained lexical content on silent terminals is not pronounced. Earlier stages may contain abstract objects before they receive their surface realization.
```

The sentence-specific request would contain only the sentence and the indexed token data. The selected framework is already in the system instruction. Proposed request template:

```text
Sentence: <JSON-encoded input string>
Input tokens, indexed from zero: <JSON array of the existing tokenizer's strings>
```

The application substitutes actual serialized data for those two placeholders. They are not sent literally. This changes how the request displays its existing token list, not the output fields or tokenization. It avoids repeating the output shape, ambiguity policy, chronology, and field restrictions in both messages.

Following Francis's wording review, the prompt retains the direct instruction to build forward and omits the private-thinking instruction. It asks for a single valid JSON object without listing presentation formats. A stage is defined by its complete syntactic workspace after the described operations, not by display frames. The restriction on depicting rejected operations is removed because an analysis may need to show an illicit configuration. It no longer explains where Babel draws a word. The subtree-reuse sentence now says to use refId or write the entire subtree including its children, replacing the unclear phrase "carried structure." These changes do not choose a copy/trace convention or settle subtree silence or simultaneous relations. The earlier full current-versus-draft comparison remains historical review evidence.

### Meaning that still needs review

| Topic | Treatment in the draft | Decision or implementation still needed |
| --- | --- | --- |
| Wrong container types | Every required/optional field has a format, including the outer values object. | Align node and prose validation with those definitions. Keep diagnostics separate from public display policy. |
| Whole-phrase silence | Defines the agreed terminal case only. | Agree on a phrase's scope. Recommended meaning: a wholly silent occurrence contributes no pronounced descendants; partial silence is marked on the smaller affected occurrences. Do not apply that flag to other lineage-linked copies. Conflicting child status needs a diagnostic, not an invented pronunciation. |
| Genuine simultaneous relations | Retains agreed order for sequential relations. It does not claim that shared stages or list order encode concurrency. | Work through one concrete simultaneous case. One relation with several anchors already owns one moment; merging separate claims just for timing can lose their identities. Free prose about simultaneity is not a deterministic timing format. |
| Several participant/value pairings | Leaves anchors and values unchanged. | Ambiguous separate arrays do not acquire pairings through order, matching names, or a shorter prompt. Resolve the actual compound cases before saying the contract covers them. No new field is proposed for the four saved outputs. |
| Node labels and pronunciation | Explicit terminal word/index instructions; no capitalization rule. | Remove reliance on undocumented fields or capitalization only after tracing their consumers. Preserve extra raw data for diagnosis; do not silently promote features or aliasIds to authored fields. |
| Moving an unchanged subtree | Retains the existing instruction to rewrite when its position changes. | A position-only move may be able to reuse the same subtree representation. Check identity and Replay behavior before relaxing this instruction for output efficiency. It is not needed to fix the wrong values containers. |
| Completed versus grammatical | Uses completed analysis instead of implying every input must converge grammatically. | This does not remove the exact-input obligation or decide what the app does with mismatched words or additional final roots. |
| Relation names in prose | Requires the prose to explain each relation, without a second exact-text matching rule. | Review removal of the old wording requiring each relation name to occur literally in stageRecord. Semantic consistency remains required; Babel must not reconstruct missing data from prose. |
| Framework neutrality | Retains existing BPS/GB, endocentricity, label, and branching restrictions. | Open relation names do not make these theoretical choices universal. Their scope must be intentional. Do not claim deterministic validation proves linguistic correctness or Universal Grammar. |

No additional correctness checklist follows the draft. Repeating these definitions would restore the redundancy being removed. Shorter wording is a candidate improvement, not evidence that models will never misunderstand it. Review its meaning first, then test it under approved comparable provider conditions.

### Response format options

Changing the text format and changing the analysis model are separate choices. All alternatives below would have to retain the same trees, identities, relation meanings, ambiguity handling, and original evidence.

| Option | Benefit | Remaining problems and recommendation |
| --- | --- | --- |
| Keep one JSON document and separate inspection from complete compilation | Fewest new conventions; existing saved records and parser remain usable. Fixes the demonstrated wrong-field/history-loss problem without changing anchors or values. | Missing JSON syntax still needs a separately identified recovery path for structured inspection. Recommended first step, not proof the current format is permanently best. |
| One JSON stage per line | Each valid line is independently readable; no outer stages-array ending to forget. | Still has nested trees, escaping, field rules, and references. Needs explicit analysis grouping and completion conventions without limiting the number of analyses. A missing stage may make later refIds unusable. Best alternative to compare if document-level fragility remains material. |
| Standard JSON text sequences | Separates records and permits parsing to resume after a damaged record. | Uses a record-separator control character, an extra authoring convention. Does not establish that the complete derivation arrived. No advantage established here over ordinary lines for model authoring. |
| Labeled-bracket trees with separate relation records | Could make trees shorter and closer to linguists' notation; already considered in the old Fable plan. | Must specify escaping, ids, lineage, silent status, reuse, relation references, stages, and multiple analyses. Brackets alone do not carry that information. A serious alternative only after demonstrating a simpler complete grammar, not just a prettier tree example. |
| Provider-constrained structured output | Can constrain JSON syntax and supported field shapes on supported routes. | Does not establish valid linguistic reasoning or all cross-stage references. Provider support and failure cases must be checked per selected model. It remains a separately approved comparison, not the shared baseline or an automatic adoption. |
| YAML, XML, or a custom text notation | Different presentation of the same information. | Switching alone removes neither field definitions nor identity/timing requirements. No saved-run evidence establishes a reliability or simplicity advantage. Do not add a second production parser speculatively. |

[JSON Lines](https://jsonlines.org/) requires each line to be a valid JSON value. [RFC 7464](https://www.rfc-editor.org/rfc/rfc7464#section-2.3) specifies recovery between separated JSON records; it does not supply application-level completeness or stable stage identities. These formats support isolating text damage, not skipping stages in a supposedly complete derivation. [Anthropic's structured-output documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) describes schema-constrained output and its exceptions. This proposal does not assume every chosen Babel model supports it.

An offline representation check serialized each saved stage as one JSON line and parsed the lines back. All seven Astra Minimalism, six Astra X-bar, and five stages in each Fable analysis retained identical parsed content and order. Fable Minimalism first used only the documented `]}` append in memory; original files and hashes stayed unchanged. Its stage-3 and stage-5 values arrays, and Fable X-bar's stage-4 values array, remained incorrectly shaped after conversion. This proves the distinction between framing and field-format problems, not that a model would generate the line-based format reliably. It did not test multi-analysis grouping, lost-stage recovery, or new model output.

Objects and arrays also have different semantics: JSON object-key order must not become a hidden timing or pairing convention, while array order is meaningful. Duplicate object names can lose data in ordinary parsing. Preserve original bytes and include duplicate-name behavior in the ingress review, without building a bespoke JSON parser. See [RFC 8259, objects](https://www.rfc-editor.org/rfc/rfc8259#section-4). These are transport checks, not extra model-facing linguistic rules.

There is no general operation that can normalize ambiguous or absent information into a guaranteed faithful analysis. Syntax-only recovery may restore readability in a known case; it cannot infer the intended node when a reference is genuinely missing or the intended association between unrelated arrays. The achievable design goal is to preserve the answer, make usable parts inspectable, and state exactly what processing remains unresolved. That avoids converting one local formatting error into the loss of the entire research result.

### Efficiency and progress

Measure the whole built system-plus-input request, not just removed source-code lines. The draft size comparison below uses UTF-8 bytes, not estimated model tokens. No new provider run has tested its reliability or latency.

For `Which book did John buy?`, using the current local prompt builders and exactly the draft blocks above:

| Framework | Current system + request | Draft system + request | Reduction |
| --- | ---: | ---: | ---: |
| Minimalism | 21,043 bytes | 6,726 bytes | 68.0% |
| X-bar | 20,780 bytes | 6,842 bytes | 67.1% |

The current request contributes 1,060 or 1,051 bytes; the proposed two-line request contributes 105 bytes. These counts exclude provider envelopes and any transport-level suffix. They compare the current local wording, including the earlier approved clarifications, with the revised draft, not the older September request snapshots. Counts are reproducible by extracting the prompt draft's first three text blocks and combining the corresponding introduction with the common instructions, then serializing the existing input tokens in the request template. Do not describe byte savings as equivalent token, cost, or latency savings.

The original four-call estimate allocated $0.20301 to input and $1.53455 to output. Even eliminating all input cost would therefore save only about 11.7% at that run's rates and usage. Prompt cleanup matters for clarity, but cannot honestly promise to turn the observed 84-195 second generations into instant results. Preserve useful subtree reuse and substantive reasoning. Investigate repeated output and the app's retry behavior; do not reduce the derivation or change reasoning effort as an unmeasured cost fix.

Progress estimate for this repair effort only: approximately **25% complete**, with a plausible range of **15-35%**. This is an engineering estimate, not a test score, model-success rate, or percentage of the original renderer built. The investigation and many decisions are far ahead of implementation. Two of 39 findings have local fixes, one is partial, broad recognition/Replay fixes remain, and integrated visual verification is still due. The existing renderer and approved drawings remain substantial reusable work. No model is newly qualified by this proposal.

The order is diagnosis and inspection, prompt-meaning review, shared recognition and movement, presentation, then end-to-end verification. Review a concrete proposal when a decision actually blocks that work. Do not make another open-ended grilling pass a prerequisite for already-understood fixes. Conversely, do not use the desire to finish quickly as permission to redesign Tier 3 or settle new contract meanings implicitly.

## Evidence and scope

The sentence was `Which book did John buy?` in Minimalism and X-bar, once per model. There were four generation POSTs, not two Fable generations followed by two retries.

Original run directory:

[Original saved run](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05)

That directory retains exact requests, raw output, provider envelopes, usage, source snapshots, normalization diagnostics, and the successful Astra records. No original raw response was overwritten by the audit.

Supporting files below are local-only evidence under the ignored `.artifacts/` run directory. They were copied out of `/tmp` without changing their contents. These links work in the local checkout, not in a fresh clone or on GitHub. The complete issue and relation tables, findings, measurements, limitations, and source-code links are preserved in this tracked document; raw provider outputs and generated inspection records are not published by this change.

Read-only audit evidence:

- [All relation classifications, recipe failures, timings, and repair differences](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05/audit/evidence.json)
- [Astra Minimalism baseline](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05/audit/astra-minimalism.baseline-evidence.json)
- [Astra X-bar baseline](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05/audit/astra-xbar.baseline-evidence.json)
- [Fable Minimalism inspection baseline](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05/audit/fable-minimalism.baseline-evidence.json)
- [Fable X-bar inspection baseline](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05/audit/fable-xbar.baseline-evidence.json)
- [Latest saved review page](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05/review-webapp/index.html)

Frame numbers below are one-based. Astra numbers refer to that latest review. Fable numbers refer to Replay compiled from separately labelled inspection copies, not frames that were successfully rendered in the original run.

| Analysis | Authored stages | Replay frames | Tier 1 claims | Tier 2 claims | Tier 3 claims |
| --- | ---: | ---: | ---: | ---: | ---: |
| Astra Minimalism | 7 | 47 | 1 | 3 | 10 |
| Astra X-bar | 6 | 41 | 0 | 0 | 11 |
| Fable Minimalism, inspection copy | 5 | 35 | 2 | 0 | 3 |
| Fable X-bar, inspection copy | 5 | 36 | 0 | 0 | 9 |

There are 36 authored relation objects. Counts above are recovered claims, so a relation with a Tier 2 drawing and an unrepresented remainder can contribute both Tier 2 and Tier 3. This is the documented dispatch policy, not an arithmetic error.

## Pipeline ownership

The actual path in this run was:

```text
Saved system instruction + framework prompt + model configuration
  -> provider adapter, one generation POST per attempt
  -> saved provider envelope and raw text
  -> JSON extraction and delimiter repair
  -> relation/stage shape checks
  -> subtree refId expansion
  -> normalization and final-tree selection
  -> deterministic Replay compilation
  -> relation classification and render-plan compilation
  -> production React/D3 TreeVisualizer
  -> screenshots displayed by the review HTML
```

The paid script called the adapter and qualification functions directly. It did not exercise the entire Express request, retry, and client-restoration path. Shared code was used, but this was not a complete end-to-end test of the public generation route.

Relevant owners:

| Layer | Source |
| --- | --- |
| Model-facing instructions | [systemInstruction.js](../../../server/babelParser/systemInstruction.js#L65), [prompts.js](../../../server/babelParser/prompts.js) |
| Relation shape checks, discarded stages, subtree references | [derivationCompiler.js](../../../server/babelParser/derivationCompiler.js#L38) |
| Error handling and final-tree acceptance | [parseNormalization.js](../../../server/babelParser/parseNormalization.js#L43) |
| Replay construction and movement timing | [replayCompiler.ts](../../../replay/replayCompiler.ts#L1592) |
| Literal role vocabulary | [tier2Synonyms.ts](../../../replay/relations/tier2Synonyms.ts#L34) |
| Structural recovery requirements | [tier2FacetRecipes.ts](../../../replay/relations/tier2FacetRecipes.ts#L384) |
| Tier assignment and persistence | [renderPlanCompiler.ts](../../../replay/relations/renderPlanCompiler.ts#L1130) |
| Bound overlay geometry | [geometryBinding.ts](../../../replay/relations/geometryBinding.ts#L1714) |
| D3 drawing, Replay panel, camera | [TreeVisualizer.tsx](../../../components/TreeVisualizer.tsx#L6179) |
| Static review page | [reviewPage.js](../../../contractQualification/reviewPage.js#L7) |
| Saved capture procedure | [babel-admission-capture.mjs](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05/audit/babel-admission-capture.mjs) |

## Issue table

Severity describes the effect on interpreting the analysis, not whether the input sentence is grammatical. High means the problem hides, changes, or misrepresents an important part of the derivation. Medium means an important distinction or claim is unclear. None means a presentation or operational problem without an identified linguistic change.

This table records the original findings and proposed remedies. Implemented work is distinguished in the evidence sections above and the current ROADMAP.md statuses. Diagnostic detection and the decision to reject or block an analysis remain separate decisions.

| ID | Symptom and exact example | Root cause and owning layer | Linguistic severity | UI severity | Proposed fix and scope | Regression proof needed |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | Fable Minimalism reports missing `d_john_hi`; X-bar reports missing `c1`. | Invalid relation `values` causes the whole stage to return null. Filtering removes it before reference expansion. `parseNormalization` handles only one class of collected issue early. Parser/validator. | High: valid authored history is removed. | High: both analyses become unavailable. | Preserve original stage positions and report the primary malformed field before dependent checks. Do not normalize a shortened history as the original analysis. General parser fix. | A malformed stage followed by a valid reference must identify the malformed relation at its original path; no false missing-reference diagnosis. |
| 02 | A malformed stage can vanish without any visible failure. Expanded Astra copy with S3 `values` changed to an array is accepted as six stages instead of seven. | Collected validation issues are ignored once a final tree is found. Parser/validator. | High: analysis content disappears. | High: successful status hides loss. | Keep every stage and its diagnostic available; define separately what can be compiled/displayed. General. | Accepted or failed outcome must never silently lose an authored stage. |
| 03 | Fable writes `values: ["phi", "Nom"]`, `values: ["wh"]`, and `values: ["did"]`. | Prompt explains permitted individual values but does not explicitly state that the outer `values` field is a named object. Validator requires that object. Prompt/validator mismatch. | Low for these exact arrays; literals are intelligible. | High through issue 01. | Clarify outer container shape in the written contract without adding an ontology menu, example analyses, or a provider JSON Schema. General. | Correctly distinguish a literal array inside a named field from an array used as the whole block. |
| 04 | Fable Minimalism needs `]}` appended at byte 6819. | Raw output is missing the final two container closers despite `end_turn`, well below its token cap. Exact generation cause is not observable. JSON ingress/model formatting. | Low for this exact EOF repair; higher for arbitrary delimiter edits. | Medium: repair needs explicit inspection. | Preserve exact byte edits and distinguish EOF completion from interior delimiter changes. Do not assume all successful JSON repairs preserve meaning. General. | Byte-level diff and ID/reference literal equality; malformed nested examples must not silently reassign container ownership. |
| 05 | A nonexistent relation goal is accepted by strict normalization. | Relation shape checks validate strings, not membership in the expanded stage. Validator. | High: a claim can lack its stated witness. | High: missing or misleading mark without a useful parse diagnostic. | Add exact current/prior anchor resolution diagnostics after expansion, with stage and relation paths. General; rejection policy remains open. | Existing, missing, previous-only, future-only, and array anchors, including nodes carried by `refId`. |
| 06 | Extra final root, three-child Minimalist root, and `silent: "false"` all pass. | Final selection can find a matching root without establishing whole-workspace convergence; node/linguistic constraints are only partly checked. Validator/contract. | High for unmerged work and malformed silent type; framework branching requires a stated policy. | Medium. | Separate structural schema checks, convergence checks, and linguistic review. Do not claim comprehensive validation. General. | Root completeness and boolean-type diagnostics; framework checks must be explicit rather than covertly imposed. |
| 07 | Bare D/v/T/I/C; e.g. Astra Minimalism F11, F13, F24. | Raw stages author null or abstract heads. Renderer makes structural steps from those nodes. No dropped overt child established in these examples. Contract/display semantics. | Medium if pedagogical labels imply an operation the analysis did not make; an authored abstract head alone is not a defect. | Bare abstract presentation accepted by Francis; unexplained missing material still needs review. | Preserve intentionally abstract heads as authored. Investigate missing lexical content separately; do not invent a word or null under every category. Astra's buy selection/projection is already correct. General. | Preserve the working overt lexical selection before projection; an abstract head remains abstract; genuine missing material and premature word disappearance are diagnosed separately. |
| 08 | John vanishes at the lower position; lower copies leave bare category labels. Astra Minimalism F26-F32. | Contract requires silent copies to drop `word` and `tokenIndex`; Replay applies the post-stage pronunciation before the unrecognized movement moment. Contract plus Replay. | High for premature disappearance; copying notation itself is a model-owned choice. | High. | Restore source visibility until a proven movement moment. Align the prompt with authored copy/trace preservation; retain lexical content when the model authors a full silent copy. Do not reconstruct missing words or substitute traces as a repair. General. | Source remains overt before movement; landing and authored lower form appear together; retained silent words do not count as pronounced tokens; no fabricated word or trace. |
| 09 | Astra Internal Merge F21/F32/F44 all become Tier 3. | `higherOccurrence` is absent from movement landing aliases. The recipe requires a separate witness role even where the lower occurrence supplies that evidence; it does not require a third distinct node. Later chain roles are also unrecognized. Classifier/signature. | High: a supported movement loses its readable representation. | High. | Recover source/landing from exact roles plus occurrence identity and stage evidence. Review two-anchor copy signatures. Do not classify from the string Internal Merge alone. General. | Phrasal moves, successive-cyclic moves, multiple candidate occurrences, compact category-typed traces, and nonmovement same-lineage counterexamples. |
| 10 | Existing constituents are rebuilt. Astra Minimalism John F26-F30 precedes movement F32; higher T F34-F38 precedes F39. | Replay restoration, landing withholding, and new-parent grouping depend on registered trajectory identities, not the generic recovered claim. Replay/renderer integration. | High: displayed derivation is different from the authored operation. | High. | Use a shared, evidence-backed movement decision for drawing and Replay ownership. General architectural repair. | Before/at/after tests for complete landing, lower copy, arrow, and smallest new parent; no descendant reconstruction. |
| 11 | I-to-C/head movement falls back. Astra X-bar builds the landing before F33; Fable X-bar introduces it at F30 but without a trajectory. | Unrecognized moved-head roles, current/prior source mismatch, and overt-word requirements exclude abstract I/T. All four saved head movements have earlier sources. Classifier plus Replay. | High. | High. | Admit proven movement of abstract heads without requiring an earlier pronounced word. Require an identifiable earlier source and current lower witness according to the authored convention. Preserve Fable X-bar's already atomic introduction. General. | Valid abstract I movement; absent earlier source; unrelated same-labelled head; head versus landing host; no inferred movement of the host. |
| 12 | Head/phrasal handling would remain wrong after role recovery. | Offline role-mapped controls lower all four head paths as phrasal. Conversely, calling the existing head-like helper on Fable's bare maximal D John returns true from its category labels. The anchored structural context distinguishes all eleven saved cases; the failure is in recovery, not missing subtype information. Tier-2 lowering and Replay subtype inference. | High if these results drive the repaired playback. | High. | Recover the authored movement subtype from roles and anchored structure, including source/landing attachment, rather than default-phrasal or isolated category/child-count rules. No new fallback policy is justified by these examples. | Bare maximal nominal A-movement must not become head adjunction; genuine head adjunction must retain the head design; roles naming a host must not replace the moved node as the endpoint. |
| 13 | CP appears left of the current structure; Astra X-bar F33. CP is also introduced before its movement in several sequences. | No model coordinates exist. Replay uses future topology for layout and fails to group unrecognized movement with its new parent. Current S4 CP has only C' before later wh attachment. Replay/layout. | High for order; medium for spatial implication. | High. | Fix movement ownership first. Then instrument current versus future-layout coordinates to determine exactly which centering rule exposes future geometry. General only after representative evidence. | Same-frame attachment above an existing tree, unary current parent with a future sibling, and stable current branches across desktop/mobile. Exact CP centering cause still needs coordinate-level isolation. |
| 14 | External Merge and relation names are hard to find. Astra Minimalism F9 has only Inputs/Result in the body; F18 Agree shows Probe/Goal prominently; F33 I-to-C similarly. | The August 28 change `3aebc8c` gates the previously unconditional white body heading on `!showOperationLabel`. Different recipe/operation strings now suppress it while exposing a small right-hand label. Production Replay UI, not missing metadata or review-page-only behavior. | Medium. | High. | Show External Merge as the white primary heading immediately above Inputs. Keep progress at the top right. Give authored relation names the same primary hierarchy. General Replay panel fix. | Assert rendered heading presence and placement for selection, projection, External Merge, and relations, including differing recipe/operation strings, long names, and absent or multiple metadata blocks. |
| 15 | WH percolation name appears awkwardly normalized. Astra X-bar F13. | Generic title formatting also changes punctuation/casing of authored names. Replay/UI. | Low to medium for notation-sensitive names. | Medium. | Preserve the authored relation title while formatting only generated structural operation labels. General. | Wh, A-prime, I-to-C, non-Latin labels, punctuation, and long titles remain identifiable. |
| 16 | Probe plaque clips text. Astra Minimalism F18. | Approved Agree branch packs open `values` into a fixed-width plaque; duplicate 22-character wrapping does not match the 30px monospace font and tracking. Relation renderer/geometry/CSS. | Medium: literal content becomes unreadable. | High. | Share one measured text layout between fit bounds and SVG drawing. Content ownership and overflow remain under discussion; do not classify strings as prose/notation to move them without an agreed rule. General, not a bigger box for one fixture. | Long literal, long unbroken token, multiple scripts, title width, zoom, and bounds checked against actual rendered text. |
| 17 | Some plaque contents would disappear entirely. | Both drawing and bounds call `slice(0, 8)` on rows. Renderer. | High when omitted values matter. | High. | Preserve and expose all authored rows; agree on overflow behavior. General. | More than eight rows must remain inspectable, without text outside bounds. |
| 18 | Every fallback badge seems to say 1. | Counter resets per relation name within a stage. Different relation names therefore each receive instance 1. Renderer. | Medium: identity is unclear, not a truth score. | High. | Audit meaning of relation-instance and array-position labels before any redesign. Tier 3 remains unchanged. | Several differently named relations, repeated names, shared endpoints, and ordered arrays are distinguishable. |
| 19 | Tier 3 badges and rails accumulate over the tree. Astra X-bar F33 and later. | Many relations fall back; persistent fallback witnesses remain; topology layout stacks marks locally without a readable overall composition. Classifier plus Tier 3 composition. | High for comprehensibility. | High. | Reduce unjustified fallback first. Then agree on simultaneous visibility and identification requirements. No new selector or stacking design is approved here. | Many legitimate unknowns remain readable and individually inspectable; no evidence silently dropped. |
| 20 | Existing theta/Case drawings are missed. Astra X-bar F19/F20/F25/F26. | Singular argument/recipient role gaps; theta recipe demands at least two arguments and two role literals. A role-only Case control then selects dotted collection geometry instead of solid Case-assignment geometry, and leaves the Case literal out of the path label. Classifier and Tier-2 lowering. | Medium. | High. | Support complete single assignments; preserve role/value pairing and literal Case content. Distinguish assignment from collection using the authored evidence. General, not aliases alone. | Single Theme/Agent assignment; aligned and mismatched arrays; missing literal role; solid assignment versus dotted collection; Case labels retained. |
| 21 | Adding useful context breaks an exact Agree. Astra Minimalism F31. | S5 authors probe `finiteT`, goal `johnD`, and `inactiveIntervener: edgeWhichD`. The Agree signature permits only probe/goal, so dispatch reports `unexpected-role`; Tier 2 cannot rescue the same malformed Tier 1 claim under current policy. Registry/claim extraction, not a rejected analysis. | Medium. | High. | Agreed on 8 September: a complete supported claim retains its approved drawing when additional context is present. Keep extra anchors and values inspectable without claiming the drawing explains them. Distinguish extra context from missing or contradictory core information; do not bypass malformed-primary protection indiscriminately. General policy decision; implementation remains deferred. | Exact Agree with and without extra context, preservation of all extra anchors/values, contradictory or incomplete core evidence, and disjoint surviving claims. |
| 22 | Transfer draws a Phase arc around one leaf plus fallback, not the transferred-domain mark. Astra Minimalism F22/F45. | `phaseHead` is conflated with phase phrase; its singleton subtree becomes the Phase arc. The combined Transfer recipe then requires that same leaf to contain the edge and complement, exactly one edge, and all three parts before drawing any Transfer component. `complementDomain` is also missed. Classifier and recipe composition. | Medium: phase head, phase domain, and transferred domain are distinct. | High. | Recover the explicitly identified transferred domain using the existing SOD component. Francis approved one VP transfer mark plus the existing small edge outline around each explicitly accessible DP label in F22, in one relation moment. Keep head/domain semantics separate. Head-to-phase geometry and the missing-edge case remain for discussion. General; implementation paused. | Leaf head versus containing phrase; head/complement siblings; two accessible phrases in one Transfer moment; explicit complement with no edge; SOD without a fabricated edge; no phase arc restricted to the head by alias accident. |
| 23 | Relations overlap the native Replay panel. Astra X-bar F33, Fable Minimalism F23, Fable X-bar F36. Both Fable final mobile frames also collide with the header and side controls. | Camera fit reserves a fixed bottom allowance rather than measured panel bounds. Panel/header/control dimensions and positioning are independent. Production layout. | None in data; medium in readability. | High. | Check tree/overlay bounds against actual panel, header and control geometry without breaking stage-stable fitting. Desktop and mobile reproduction confirmed in the full Fable frame pass; redesign remains unapproved. | Expanded panel, long metadata, multiple overlays, 1600 x 1100 and 390 x 844, viewport resize, manual zoom, and whole-stage fit. |
| 24 | Review says Valid although failures above remain. | Label means normalization succeeded, not linguistic or renderer verification. Test page/qualification UI. | High risk of false interpretation. | Medium. | State parse/normalization result and review status separately. General review fix. | Valid JSON with missing anchor, accepted but unreviewed record, repaired record, and failed compilation remain distinct. |
| 25 | Review looks like Babel but controls inside the tree image do not work; smaller screens shrink everything. | It is a scaled PNG, not a mounted TreeVisualizer. Review HTML. | None in source. | High for inspection. | Decide between a live shared-component review and native-size captures with clear limits. Keep evidence controls outside the tree. General review work. | All frames reachable; native Replay text inspectable; zoom/pan/hover tested only in a live component. |
| 26 | Large cost and wait; concern about hidden retries. | High-effort output dominates cost; runner is sequential; provider inference dominates observed wait. No retry cascade in this run. Provider/test runner. | None. | High waiting burden. | Reduce avoidable formatting failures and duplicated prose; test effort empirically. Parallel independent calls only with a budget. General operational work. | Count generation POSTs, record usage once, distinguish GET polling, failed calls, cached input, and unknown billing. |
| 27 | Future public behavior could retry differently from this test. | Production runtime supports up to three transport attempts; this runner restricted each case to one generation POST. Route/test parity. | None directly. | Medium. | Review retries and spending behavior separately before public qualification. No retry policy change here. | Full route tests for retryable failure, terminal failure, budget accounting, and no silent provider switch. |
| 28 | Replay changes an authored literal `x_i` into `x i`. Local nonmovement relation probe on 8 September, not a new model generation. | `buildRelationParticipantSupportLines` routes relation values through `formatReplaySupportValue`, which replaces underscores and processes text as identifiers. Replay text formatting. | Medium: notation can change meaning. | Medium. | Preserve literal relation values; keep identifier-to-display formatting confined to actual identifiers and separately agreed notation conversions. General; no fix applied. | Underscores, indexed notation, multiline values, arrays, and identifier-looking literals survive display without semantic rewriting. |
| 29 | Movement Replay support shows Source/Landing but omits supplied relation values. Local AbarMove probe on 8 September. | `buildReplaySupportLines` returns from the movement branch before appending values. `buildRelationReplayBlocks` contains only relation names/anchors, and TreeVisualizer suppresses that block when support lines exist. Replay details/UI. | Medium when values contain qualifications to the displayed movement. | Medium. | Ensure full authored relation values remain inspectable for movement as well as other relations, using one authoritative record. Do not assume the Replay bar is already a complete alternative to a plaque. General; presentation pending. | A movement relation with values exposes every value as well as Source/Landing; no hidden omission when detail blocks are filtered; comparison with nonmovement display. |
| 30 | All three do-support relations fall back despite identifiable realized tense hosts. Astra Minimalism F40, Astra X-bar F40, Fable X-bar F31. | Unrecognized host roles and mandatory special PF rows block the existing plate. The renderer accepts ordinary scalar values. In two analyses did also appears before the PF relation: Astra Minimalism F34 and Fable X-bar F30. Classifier/recipe plus Replay ownership. | Medium for missing drawing; high for misleading realization timing. | High. | Recover a supported realization without inventing an input/output equation or splitting prose. Keep raw Fable values separate from the inspection wrapper. Resolve movement and later realization on the same node together. General; timing treatment remains for discussion. | Scalar tense/exponent values; prose preserved verbatim; same-ID and lineage continuations; abstract source; no repeat event for unchanged pronunciation; movement then PF timing; wrapper not treated as model evidence. |
| 31 | Fable X-bar F35 loses its binder-variable drawing because it lacks a scope domain. | Tier 2 bundles Variable-binding path and Ranked scope hulls behind a mandatory scope anchor. The Tier-1 registry, plan, geometry binder, and renderer already permit the path without that enclosure. Recipe overconstraint. | Medium: supported dependency hidden. | High. | Recover the existing path from the authored binder and variable. Omit an unexpressed scope hull and preserve separate lexical-governor/ECP evidence without turning it into another movement. General. | Binding path with and without explicit domain; no invented scope; unresolved variable; extra governor retained; binding after movement does not move the constituent again. |
| 32 | Generic licensor/licensee selects strong-NPI; either sequence/order with two order rows selects both local dislocation and cyclic linearization. Local cases B10-B11 and B74-B75 below. | Broad role aliases satisfy specialized recipes without evidence of their distinctive meaning. Collision handling covers only a few named pairs. Synonyms/recognition/composition. | High: the drawing asserts more than the record establishes. | High. | Require evidence for each specialized claim. Distinguish genuinely simultaneous claims from competing interpretations of the same evidence. Do not fix this by asking models to use a closed relation menu. General. | Ordinary licensing without polarity/focus; rebracketing versus precedence; complete specialized controls; ambiguous and independent overlapping claims. |
| 33 | Two Theme values collapse into one; three arguments with two roles get an invented third label; an extra role or correspondence index is omitted. An unknown item beside a recognized outcome disappears from residual evidence. B06-B09, B13, B55. | Deduplication treats ordered arrays as sets. Role/value pairing lacks an equality check. Lowering reads the first index, and consumption tracks whole keys rather than individual items. Evidence normalization/lowering. | High: associations, literals, and qualifications change. | High. | Preserve ordered occurrences and literal multiplicity. Validate explicit pairing without guessing missing labels. Track which values each recovered claim actually uses. Preserve the original relation separately. General. | Repeated labels and endpoints, unequal arrays in both directions, distinct pair indices, partially recognized arrays, and raw-record equality. |
| 34 | A shared node is connected to the wrong named parents; focus emphasis names nonexistent native edges; unrelated projection hops and descendant-only movement identity pass. B29-B30, B32, B46-B47, B49. | Checks establish that some suitable structure exists, not that the exact authored participants have the claimed relationship. Lowering can then bind different objects. Structural recovery/lowering. | High: relations can attach to the wrong syntax. | High. | Return and use the exact structural witness that passed the check. Whole-constituent identity cannot follow from one shared descendant. Do not infer a carrier from an unrelated anchor. General. | Wrong versus actual parents, nested focus siblings, ordered ancestor paths, self-hops, descendant-only lineage overlap, and unrelated carriers. |
| 35 | Correctly compiled theta rows are ignored by the production theta drawing; PF and F-projection drawings reread different raw fields. Three-output fission reaches a renderer that only accepts two. B05, B27-B28, B73-B75, B82, B85. | Several TreeVisualizer specializers use Tier-1-shaped raw relation data instead of normalized plan fields. Tier-2 recognition and the actual drawing have different input contracts. Renderer/plan integration. | High: participants and meanings are omitted or replaced. | High: a recognized piece can be absent or wrong. | Give Tier 1 and Tier 2 one explicit drawing input for the same existing piece. Preserve raw data for inspection, not as a second classifier inside D3. Reconcile actual supported multiplicities before extending designs. General. | Recognized aliases must produce the same content and anchors as canonical inputs in the production component; verify actual SVG text and marks, not just piece metadata. |
| 36 | One Transfer emits its edge outline twice. Cyclic Agree emits cyclic and generic paths over the same endpoints. Some plaques repeat values already represented by another recovered piece. B21, B25, B48, B62. | Outputs are identified by their recipe, so equivalent marks from different recipes remain distinct. Generic plaque lowering also rereads all raw values. Composition/ownership. | Medium: duplicates can imply extra claims. | High. | Define ownership of repeated geometry and shared evidence within one authored relation. Reuse a common mark only when meaning and anchors agree. Keep separate authored relations separate. Plaque content policy remains for discussion. General. | Transfer plus edge, cyclic plus generic dependency, shared anchors, independent relations, and full inspectability of all values without assuming an approved plaque/replay partition. |
| 37 | Blocked movement is reported as emitting Path states, but its trajectory has no outcome and the renderer always adds an arrowhead. One host declared both licensed and rejected gets two licensed paths and conflicting badges. B12, B77. | Movement lowering drops the recovered outcome. Candidate lowering checks membership in the licensed list first. Outcome handling is inconsistent across pieces. Lowering/renderer. | High: failed and successful claims can be confused. | High. | Carry the resolved state through the drawing input; do not choose one side of contradictory evidence silently. Retain the contradiction and give an exact internal diagnostic. General; public failure policy unchanged. | Blocked/licensed/unspecified paths through native drawing; no arrowhead on the approved blocked style; contradictory per-host outcomes and distinct valid hosts. |
| 38 | A silent DP explicitly anchored as a gap fails recognition, as does t_alpha; a VP containing a t child passes and receives the gap badge on the VP. Unpronounced material selects deletion/strike. B35-B39. | Trace detection searches descendants using a narrow surface regex. Silence/deletion aliases conflate different claims. Recognition/anchor binding. | High: the wrong object or operation is represented. | High. | Establish the role of the exact authored occurrence independently of its notation. Distinguish silence, traces, and deletion. Convert only agreed notation; never invent deletion or erase lexical content. General; extends finding 08. | Category-typed traces, authored t variants, full silent copies, a containing VP, ordinary silent heads, and explicit deletion controls. |
| 39 | All 87 existing focused tests pass while the new local cases expose findings 32-38. | Much of the broad coverage constructs inputs from the same recipes being tested. The 69-piece parity check compares a Tier-2 plan with its own metadata removed, not every piece against independent Tier-1/native-render expectations. Test design. | None directly; false assurance permits high-severity defects. | High verification risk. | Keep useful execution tests. Add independent expected meaning, negative cases, content/anchor assertions, and production-component checks for shared drawings. General. | Every rule exercised independently; representative compositions and aliases through D3 and Replay; regression tests must fail on the identified incorrect behavior. |

### Additional validation probes

These were local copies of the expanded Astra Minimalism record, not edits to saved originals or new committed fixtures. Each was passed through strict `normalizeParseBundle`:

| Mutation | Observed result |
| --- | --- |
| Replace S3 Agree goal with `nonexistent_node` | Accepted, seven stages |
| Add a silent `unmerged-extra` root beside the final CP | Accepted, seven stages; Canopy tree is the matching CP |
| Add a third silent child to final Minimalist CP | Accepted, seven stages |
| Set final CP `silent` to the string `false` | Accepted, seven stages |
| Replace S3 Agree `values` with an array | Accepted, six stages; S3 disappeared |

These establish gaps in detection and reporting. They do not settle whether an imperfect model analysis should be rejected, shown with diagnostics, or offered for inspection in some other way.

## Fable failure reconstruction

### Minimalism

1. Raw output has five stages. S3 introduces `d_john_hi` in the raised subject position.
2. S3 Agree has `values: ["phi", "Nom"]`. S5 Agree has `values: ["wh"]`.
3. The JSON parser appends exactly `]}` at byte 6819. It does not edit an ID.
4. Relation normalization rejects the outer array shape. Stage normalization drops S3 and S5.
5. Original S4 uses `refId: "d_john_hi"`, correctly referring to original S3.
6. The shortened history no longer contains that definition. Babel reports an unresolved reference at `derivationStages[2]`, which is not its original position.

### X-bar

1. Raw JSON is valid. No delimiter repair activates.
2. S4 includes a do-support relation with `values: ["did"]`, alongside the movement and the new complex C `c1`.
3. Babel rejects that relation shape and drops S4, including `c1`.
4. S5 correctly carries `refId: "c1"` from S4.
5. Babel now reports an unresolved reference at renumbered stage index 3.

The reference failures are therefore downstream symptoms of Babel's handling of a shape error. It would be wrong to rewrite Fable's IDs to make the shortened history work.

### Inspection copies

I prepared separate diagnostic copies before the scope correction. They use the original linguistic trees and references. Each offending array is wrapped as `{ "notation": originalArray }`. The key `notation` is mine, not Fable's. It supplies the required container without guessing that a literal is a particular feature bundle or PF map.

| Copy | Changes | Result |
| --- | --- | --- |
| Fable Minimalism | Append two EOF closers; wrap two arrays | All five stages normalize; 35 Replay frames compile |
| Fable X-bar | Wrap one array; no delimiter edits | All five stages normalize; 36 Replay frames compile |

No tree, node ID, `refId`, anchor, or lineage was changed. These are not untouched raw outputs, not provider-generated corrected answers, and not an approved production repair policy. The container change can affect which visual recipes accept literal values, so resulting classifications are explicitly inspection results.

- [Minimalism exact change log](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05/audit/fable-minimalism.salvage.json)
- [Minimalism inspection payload](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05/audit/fable-minimalism.payload.json)
- [Minimalism normalized inspection record](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05/audit/fable-minimalism.bundle.json)
- [X-bar exact change log](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05/audit/fable-xbar.salvage.json)
- [X-bar inspection payload](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05/audit/fable-xbar.payload.json)
- [X-bar normalized inspection record](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05/audit/fable-xbar.bundle.json)

These copies have been compiled, not captured into a new visual review. I did not change the review page or continue rendering work after the audit-only correction.

### What can and cannot be concluded about JSON repair

Fable Minimalism ended with `end_turn`, not a token-limit stop. Its 5,779 billed output tokens were below the 20,000 output cap. The record does not establish why the model stopped two delimiters early. The prompt ambiguity helps explain the `values` shape but does not prove the cause of the missing closers.

The repair pass can insert or remove structural punctuation outside strings. The actual Minimalism edit did not change reference literals. More generally, unchanged ID strings do not prove unchanged structure: a delimiter inserted in a different position can change which object or stage contains a reference. Repair diagnostics must preserve both byte edits and the resulting structural differences. No provider call is used for this local pass.

## Every relation compared with the approved drawings

The approved source is the Orchard together with the [renderer closeout](../../../docs/design/visual-relations-renderer-closeout-2026-08-25.md) and [Tier 2 specification](../../../docs/design/visual-relations-tier2-shape-dispatch-spec.md#L38). Relevant existing drawings include A1 phrasal movement, A2 head movement, D agreement, D6 Case/feature collection, E2 phase, E4 Transfer, J theta roles, I1B operator-variable binding, and H PF realization.

An open relation name does not have to be an approved Tier 1 identity to be legal. It should receive a known drawing only when its authored evidence supports it. The expected column below is therefore sometimes conditional. Renaming a relation in the model prompt is not the proposed solution. The 8 September follow-up rechecked all 36 objects, including all 33 with some Tier-3 fallback. The revised expectations below correct earlier claims that current recipe failure necessarily meant missing model information.

### Astra Minimalism

| Frame | Relation and current result | Approved drawing / expected result | Why this result happened |
| --- | --- | --- | --- |
| 18 | Agree: T1 `agree.plaque` | T1 Agree is appropriate; plaque layout is defective. | Exact probe/goal match. Open locality and valuation rows overflow the approved plaque geometry. |
| 21 | Internal Merge: T3 | T2 phrasal movement is supported by the lower/edge DP occurrences and stage change. | `higherOccurrence` is not a landing alias; separate witness requirement rejects the lower-copy pair. |
| 22 | Transfer: T2 Phase arc + T3 remainder | Existing E4 SOD component is supported by `transferredDomain: lexicalVP`. Both accessible DPs are explicitly identified outside it; do not arbitrarily keep only one. | Leaf `transitiveV` is treated as the phase subtree. Recipe wrongly requires that leaf to contain VP and an edge, and permits only one edge. This is more than a missing alias. |
| 31 | Agree: T3, malformed registered signature | Agreed target: retain the approved Agree drawing for the complete probe/goal claim and keep the extra inactive-intervener evidence inspectable. Not implemented. | Extra anchor invalidates exact signature. Current rules forbid Tier 2 from rescuing that same primary claim. |
| 32 | Internal Merge: T3 | T2 phrasal subject movement. | Same role and witness gap as F21, followed by Replay reconstruction of the landing. |
| 39 | Head movement: T3, malformed registered signature | A2 head drawing can express this T-to-C chain; exact registration and abstract-source recovery must be reviewed. | Exact name matches a curated family but supplied roles do not match its signature. Earlier abstract T exists. Do not bypass Tier 1 protection. |
| 40 | Do-support: T3 | Existing PF plate can preserve the realization prose at `raisedT`, whose earlier same-lineage T was wordless. No need to invent an equation or move lexical V. | `supportedTense` and scalar `realization` are missed; a special row field is not required by the actual plate. Realization timing also needs repair. |
| 43 | Wh-Agree: T2 feature connector + T3 remainder | Recovered feature dependency is appropriate; extra evidence must remain inspectable. | Probe/goal match. The nonintervening-subject witness and other unconsumed material remain fallback evidence. |
| 44 | Internal Merge: T3 | T2 successive-cyclic phrasal move from the intermediate edge to CP. | Higher/intermediate/thematic roles do not provide the expected role signature. Must distinguish immediate source from original thematic occurrence. |
| 45 | Transfer: T2 Phase arc + T3 remainder | Existing SOD component is supported by `complementDomain: subjectTP`; `completedRoot` identifies CP. No explicit edge is needed to know which domain this relation transfers. | Missed complement alias, head/phrase conflation, and all-pieces-required recipe. No edge is named on this relation; do not invent a wh-edge outline from the tree alone. |
| 46 | Convergence: T3 | Preserve the open relation; no name-specific ban or automatic removal is approved. No verdict symbol follows merely from its title or a completed tree. | The saved relation repeats part of the final conclusion, but the prompt's existing exclusion concerns claims fully expressed by ordinary branching. That is not a general ban on judgments or summaries. Apply the actual evidence boundary rather than add a Convergence-specific rule. |

### Astra X-bar

| Frame | Relation and current result | Approved drawing / expected result | Why this result happened |
| --- | --- | --- | --- |
| 13 | wh-feature percolation: T3 | The feature and both participants are explicit, but a directed transfer/projection is not established by those roles alone under the current evidence boundary. T3 remains justified pending discussion. | Containment shows D inside NP, not the direction of feature transfer. `[+wh]` is not focus; the approved F-projection also expects an accent bearer. Do not choose its design from the title. |
| 19 | internal theta-assignment: T3 | T2 Role grid for a single Theme assignment. | Singular `argument` missing; recipe requires two arguments and two role literals, so the scalar `thetaRole` also fails cardinality. |
| 20 | accusative Case assignment: T3 | Existing solid Case-assignment path, with the authored accusative literal. | `recipient` is missed. A role-only fix earns generic dotted collection, not solid assignment, and `Case` is not consumed into its label. |
| 25 | external theta-assignment: T3 | T2 Role grid for a single Agent assignment. | Same single-argument/cardinality defect as F19. |
| 26 | nominative Case assignment: T3 | Existing solid Case-assignment path, with the authored nominative literal. | Same role, path-style, and literal-label defects as F20. |
| 33 | I-to-C movement: T3 | T2 head movement with abstract earlier I. | `raisedHead` is not a landing; `trace` is only a witness, not the source; current generic movement timing requires prior overt lexical material. |
| 34 | head government: T3 | No complete approved government-specific claim recovered. T3 is justified for this payload. | A governor and trace with ECP in values are not automatically Case, Control, or a movement event. |
| 36 | wh licensing: T3 | Feature and participants are known; a direction-specific valuation drawing is not yet justified. Keep this separate from the supported movement in F37. | `operator` and `interrogativeHead` do not identify who values or licenses whom. Tree position cannot decide that. The earlier landing reference also conflicts with the following movement moment. |
| 37 | A'-chain: T3 | Existing phrasal movement/identity drawings can represent the change with structural evidence. | `head`/`foot` are not movement roles. Chain inspection alone must not cause a repeated movement if no new occurrence is introduced. |
| 38 | lexical government: T3 | T3 is justified without a complete approved facet. | No government recipe is supplied merely by governor/trace and ECP. |
| 40 | do-support: T3 | Existing PF realization plate is supported. Same `raisedI`, earlier abstract and now did, plus literal `tense: past` and `exponent: did`. | Host aliases and mandatory special rows block it. Ordinary scalar fields already suffice for the plate. Its current first did frame is correctly the PF relation; preserve that timing. |

### Fable Minimalism, inspection copy

| Frame | Relation and current result | Approved drawing / expected result | Why this result happened |
| --- | --- | --- | --- |
| 22 | Agree: T1 `agree.plaque` | Existing Agree; only the literal-container shape was adapted. | Probe/goal are exact curated roles. |
| 23 | Internal Merge chain: T3 | T2 subject/phrasal movement, including a bare maximal D. | Higher/lower copy roles are recognized but the separate witness requirement fails. |
| 30 | head movement chain: T3 | T2 head movement. | Same redundant-witness gap. Source T is genuinely present before movement. |
| 33 | Agree: T1 `agree.plaque` | Existing Agree; literal-container adaptation remains labelled. | Probe/goal are exact. |
| 34 | Internal Merge chain: T3 | T2 phrasal wh movement. | Same witness gap despite existing source, landing, and lineage. |

### Fable X-bar, inspection copy

| Frame | Relation and current result | Approved drawing / expected result | Why this result happened |
| --- | --- | --- | --- |
| 14 | theta-marking Theme: T3 | Role grid exists, but Theme is only inside the relation name. T3 remains honest until literal role evidence is represented or the policy changes. | `argument` and predicate-role mismatch; no role value to place in the grid. Do not scrape Theme from prose/name. |
| 15 | accusative Case assignment under government: T3 | Case drawings exist; recovery requires an unambiguous assignment signature. | `governor`/`caseMarked` are not supported feature roles; no separate Case literal. A governor is not always a Case assigner. |
| 27 | theta-marking Agent by predication: T3 | Same literal-role limitation as F14. | Predicate exists, but argument/cardinality and missing role value block the grid. |
| 28 | nominative Case assignment under government: T3 | Same Case-signature question as F15. | Generic government must not be silently interpreted as a different relation. |
| 30 | I-to-C head movement with ECP claim: T3 | T2 head movement is structurally supported; ECP remains a separate claim. | `movedHead`/`landingHead` are not recognized; prior source exists. Must anchor the path to moved I, not complex C. |
| 31 | do-support: T3 | Existing PF plate can retain did at the authored tense host, with prior I established by lineage. This is an inspection copy, not a successfully parsed original. | `tenseHost` is missed and special rows are required. `notation` was added by the inspection repair, not Fable. Did already appears at head movement F30, before this PF moment. |
| 33 | wh-movement: T3 | T2 phrasal movement using prior DP, current typed trace, and new DP. | `movedPhrase` is missed. `landingSite` points to the containing CP, not the moved DP. Accepting that alias blindly would choose the wrong endpoint. |
| 34 | Spec-head agreement / wh-Criterion: T3 | Named wh participants are clear, but the record does not specify valuation direction in permitted relation evidence. T3 remains justified pending discussion. | Specifier/head positions do not establish a probe-goal direction. A title-only wh-Criterion assertion is not a complete recoverable feature claim. |
| 35 | antecedent A'-binding / ECP: T3 | Existing I1B binding path is supported without a scope hull. Binder and variable are already recognized roles; no domain need be invented. | Tier 2 unnecessarily bundles path and hull. Tier 1 and the renderer already make the domain optional. Keep lexical-governor/ECP context separate and do not replay movement again. |

### All-relation follow-up: Transfer and other avoidable fallbacks

On 8 September, the follow-up checked all 36 saved relation objects against production dispatch, recipe requirements, compiled drawings, authored anchors, and current/prior tree structure. Three receive Tier 1 alone. Thirty receive only Tier 3, and three receive a Tier-2 piece plus a Tier-3 remainder. The eleven movement cases are covered in the focused movement check; the tables above now incorporate the other results.

This was offline investigation, not implementation. Fourteen isolated recipe evaluations and six drawing-compiler controls reproduced the restrictions below. Controls changed evaluator inputs or used curated names solely to test downstream capabilities. They are not repaired model answers, proposed prompt vocabulary, or proof that recognition should use relation titles. Raw-response hashes stayed unchanged. Temporary reproduction files are `/tmp/babel-all-relations-check-2026-09-08.mjs` and its `.json` output. No provider calls, browser sessions, visual redesign, or committed tests were made.

#### Transfer

Both Astra Transfer relations identify a transferred domain. The earlier audit understated that evidence.

- **S4 / F22:** `phaseHead` names leaf v `transitiveV`; `transferredDomain` names its sibling VP `lexicalVP`. `accessibleWhOccurrence` names `edgeObjectDP`, and `accessibleSubject` names `johnDP`. Those two DPs occupy distinct specifier positions outside VP along the vP structure. There is evidence for the transferred VP and both accessible participants. A one-edge recipe must not choose one and lose the other.
- **S7 / F45:** `phaseHead` names C `questionC`, `complementDomain` names TP `subjectTP`, and `completedRoot` names CP `questionCP`. No separate edge is named on this Transfer relation. This does not make the transferred TP unknown. Nor does the presence of a fronted DP authorize pretending the model separately anchored it as this relation's edge.

There are four separate implementation problems. First, the synonym index treats a phase head as interchangeable with a phase phrase. `phase.domain` collects the anchored subtree, so these two Phase marks contain only the v/C leaf. Second, `transfer.domain` demands that this same leaf contain its edge and complement. Even a control supplying an edge fails both containment checks. Third, the edge cardinality is exactly one. Fourth, all three components are mandatory before any Transfer component is emitted, while `complementDomain` is not recognized at all.

The approved E4 card instead anchors a vP projection, an edge DP, and a VP complement. Its SOD component is drawn independently at the complement anchor. The production compiler also emits Phase, edge, and SOD as separate plan items. The name `headNodeId` in the drawing API does not establish that its syntactic input must be a lexical head; E4 passes vP/VP projection nodes. Do not solve the conflation by blindly substituting a nearest ancestor or changing the geometry around one sample.

Approved during grilling on 8 September: for S4 / F22, keep the existing transferred-VP mark and place the existing small edge outline around each explicitly accessible DP label, Which book and John. These are label outlines, not enclosures around the entire phrases. Both outlines belong to the same Transfer relation moment. They do not create extra transfers or movements. Only explicitly authored accessible participants receive these outlines; do not automatically mark every DP or infer unnamed edges. Implementation remains paused while grilling continues.

Francis clarified the intended distinction: Tier 1 keeps its complete curated composition; Tier 2 assembles recognized existing pieces from the evidence for each piece. Two accessible DPs require two instances of the existing edge outline, not a new relation identity or curated design. Recommendation: a transferred-domain mark can express the complete claim that the identified domain was transferred without also asserting an accessible edge. An edge outline expresses a separate claim. Tier 2 still needs sufficient semantic and structural evidence for each piece, and some pieces only make sense together. The existence of drawable geometry alone is not sufficient.

The malformed-Tier-1 guard remains. An offline dispatch check confirmed that the saved name `Transfer` is unregistered, while an isolated exact `TransferDomain` with phase and complement but no edge stays Tier 3 with `missing-role: anchors.edge` and no Tier-2 claim. Do not weaken or rename an incomplete exact claim to recover its own components through Tier 2. Independently supported claims must not discard the unresolved content. A later implementation needs a regression check for this boundary.

Remaining work concerns recognition and geometry, not whether every Transfer must display an edge. S7's completion value explicitly says the TP is transferred, but `complementDomain` by itself does not mean transferred. The current synonym list already treats plain `complement` as `transfer.domain`. Relaxing the combined recipe without reviewing that alias would risk false Transfer marks. Establish how permitted evidence supports the claim without reading the relation title or interpreting free prose as renderer instructions. Also distinguish a phase head from its containing phase before selecting phase geometry. No parser, prompt, recipe, or renderer changes are approved by this clarification.

Sources: [E4 and E4b authored examples](../../design/visual-relations-current-lab.tsx#L6217), [role conflation](../../../replay/relations/tier2Synonyms.ts#L82), [combined recipe](../../../replay/relations/tier2FacetRecipes.ts#L565), [Tier-2 lowering](../../../replay/relations/tier2RenderPlanCompiler.ts#L628), and [production Transfer composition](../../../replay/relations/renderPlanCompiler.ts#L2156).

#### Theta and Case

Astra's two theta relations each provide a predicate, one argument, and a literal Theme or Agent. Mapping the singular argument still fails the two-argument/two-label minimum. Allowing one of each completes the recipe, and the curated compiler already draws a one-row theta grid. The literal and its argument must remain paired; merely lowering both minima would not address mismatched multi-argument arrays.

Astra's two Case relations explicitly provide assigner, recipient, and accusative/nominative. Mapping recipient to the recognized target produces a path, but the path is the dotted, arrowless `case-agree` collection curve. Curated CaseAssignment instead uses the solid arrowed `case-assignment` path. The control also leaves the `Case` literal out of the path label because that key is not consumed as feature rows. Therefore an alias-only fix would pass a "something rendered" test while still missing the approved drawing and its literal content.

Fable's theta titles contain Theme/Agent without relation values assigning those literals. Its undeclared node `features` field contains an unpaired `Agent, Theme` string; that is neither the supported node contract nor a role-to-argument mapping. The two Case titles similarly supply their Case labels, but the relation bodies only name governor and caseMarked. A later S5 node annotation says accusative, but that is not evidence available to the earlier S2 relation under the current contract. These four relations should not be silently repaired by title scraping, looking ahead, or adopting the undeclared field. The agreed neutral clarification about literal content in open values remains relevant.

Sources: [theta recipe](../../../replay/relations/tier2FacetRecipes.ts#L687), [single-grid drawing](../../../replay/relations/renderPlanCompiler.ts#L2840), [generic feature lowering](../../../replay/relations/tier2RenderPlanCompiler.ts#L590), [curated assignment](../../../replay/relations/renderPlanCompiler.ts#L1952), and [solid/dotted geometry](../../../replay/relations/geometryBinding.ts#L1239).

#### PF realization and its timing

All three do-support relations identify a tense host that acquires did. Astra X-bar is the clearest case: `supportedHead` and `priorAnchors.abstractHead` name the same I across stages; its values explicitly give past and did. Astra Minimalism provides supported T, an unchanged lexical verb, and a full realization sentence. Fable X-bar provides a tense host and the literal did in its originally malformed values array. The previous abstract I/T is identifiable by unchanged ID or unique lineage in all three.

The existing PF plate accepts ordinary named scalar values. It does not require the special PF-row property demanded by Tier 2. Controls retaining the original literal contents at those hosts complete the PF recipe and earn a pronunciation transition. This supports recovery of an existing realization plate, not inventing an input/output equation from prose. Fable's synthetic `notation` key must not become the semantic reason for recognizing its original analysis. Keep the repair label and the original array visible in internal evidence.

Timing is a separate issue. Current Replay first shows did at Astra Minimalism F34, before head movement F39 and PF F40. Fable X-bar shows did with head movement F30, before PF F31. Astra X-bar first shows it at its PF relation F40, which is already the expected order. The first two analyses combine head movement and realization in one completed stage, so fixing the whole-constituent move alone would still reveal the later lexical realization too early. Their intermediate pronunciation and relation ownership need discussion; do not silently reauthor the saved trees.

Sources: [curated PF example](../../design/visual-relations-current-lab.tsx#L7003), [PF recipe](../../../replay/relations/tier2FacetRecipes.ts#L692), [plate lowering](../../../replay/relations/tier2RenderPlanCompiler.ts#L924), and [pronunciation comparison](../../../replay/relations/tier2FacetRecipes.ts#L1073). Timing here was checked in compiled visible Replay nodes, not a fresh browser recording.

#### Binding without an invented scope

Fable X-bar F35 supplies binder `dp3` and variable `dp1`; the synonym index already recognizes both. Its lexicalGovernor is additional evidence, not a scope domain. The current Tier-2 recipe requires a domain and therefore withholds the path. But the Tier-1 registry and the complete downstream renderer already make the scope optional. A control using those two existing endpoints compiles the operator-variable item without a domain. Its path and indices do not require inventing a CP/IP scope hull or replaying the preceding movement.

This corrects the earlier conclusion that absence of a scope anchor justified losing the entire drawing. Recovering the path does not explain or certify the separate ECP/government claim. Those qualifications must remain inspectable.

Sources: [optional Tier-1 scope](../../../replay/relationDispatch/productionRegistry.js#L101), [production path](../../../replay/relations/renderPlanCompiler.ts#L1302), [mandatory Tier-2 scope](../../../replay/relations/tier2FacetRecipes.ts#L678), [geometry binding](../../../replay/relations/geometryBinding.ts#L1883), and [optional rendered enclosure](../../../components/TreeVisualizer.tsx#L5132).

#### Cases that remain unresolved

The three wh-feature/percolation/licensing relations provide participants, and Astra also provides the `[+wh]` literal. Unlike the movement cases, their structural positions do not establish the direction or kind of feature valuation. `determiner`/`nominal` and `whOperator`/`whHead` identify participants, not a source-target assignment. Reading the title as instructions, treating a wh feature as focus, or using undeclared node features would cross the agreed evidence boundary. These remain for discussion; this check does not approve a new generic drawing or a prompt menu.

Astra's head-government and lexical-government relations explicitly name governor, trace, and ECP licensing. No approved government-specific recipe was found. Those roles do not by themselves make a Case assignment, Control dependency, or another movement. Its Convergence relation contains a grammaticality sentence, not an authored verdict glyph or exact accepted outcome. A later grilling clarification below questions whether that relation needs a separate moment at all. The three already successful Agree drawings and Wh-Agree's recovered probe-goal component remain supported; the failed Agree with an extra intervener is covered by the existing decision in finding 21.

Francis questioned the Convergence relation because the derivation already ends in its completed structure and the contract excludes branch-encoded relations. The exact S7 relation adds only the CP root, `judgment: Grammatical matrix constituent question.`, and the surface sentence. The same Stage Record already explains Case, agreement, edge requirements, and final convergence. In the subsequent six-question follow-up, Francis rejected steering the model through a specific restriction on Convergence. The earlier proposal to direct ordinary completion summaries out of relations is withdrawn as an unapproved extension of the existing rule. Preserve the open ontology and the current distinction between ordinary branching and additional relational content. A completed tree is not proof of grammaticality; a relation's name alone is not permission to draw a verdict. Do not strip or rename the saved relation.

#### Diagnostic requirements

For every recovered or unrecovered part, diagnostics need the original stage and relation index, exact field, resolved node, matched concept, chosen drawing, and unused evidence. Distinguish an unknown alias from a missing field, unresolved node, failed structural condition, unavailable drawing, ambiguous direction, and missing Replay timing integration. Two bare `check:contains` strings do not explain that a phase-head leaf was wrongly tested as the enclosing phrase. A successful path also does not establish that its assignment/collection style, literal labels, or event timing are correct. These are internal diagnostic requirements; public warnings and rejection policy are not approved by this audit.

### Broader Tier-2 reliability review

The 8 September code/data review covers all 69 vocabulary pieces and all 52 recovery rules, including 50 claim rules and two presentation/organization companions. It follows recognition through plan construction and the relevant production drawing branches. It adds findings 32-39 above. This is not a visual sign-off or an implementation closeout.

Francis's distinction holds. Tier 1 keeps its complete curated recipe. Tier 2 may assemble supported existing pieces without supplying that entire recipe. Each piece still needs evidence for what it communicates and its exact anchors. Some pieces belong together: an arrow needs a directed dependency, and a frame without its rows is not a separate linguistic claim. A lens is presentation, not syntax. Do not turn 69 pieces into 69 unrelated semantic classifiers or new Replay moments.

#### Evidence and limits

The local script `/tmp/babel-tier2-system-review.mjs` ran 86 hand-written cases through production evidence building, recipe evaluation, dispatch, and plan compilation. `/tmp/babel-tier2-system-review.json` contains the inputs, resolved concepts, selected recipes, residual evidence, plan items, and source hashes. Cases below use the prefix B to distinguish them from saved Replay frame numbers and main issue IDs. The examples are renderer probes, not proposed linguistic analyses or additions to the model-facing prompt.

Every rule dispatches in at least one case, and every named piece appears in at least one compiled plan's metadata. Some cases deliberately lack or contradict required evidence. Reproducing their acceptance is evidence of a bug, not a passing correctness test. Four audited production source hashes were unchanged before and after the run.

The existing four focused suites passed, 87 tests total: `tier2PrimitiveRecipes`, `tier2RelationDispatch`, `tier2RenderPlanCompiler`, and `tier2ProviderFreeVerification`. Their generated all-rule cases and first-anchor-deletion negatives do not establish that the rules express the right requirements. The broad parity test compares a Tier-2 plan with the same plan stripped of Tier-2 metadata; a separate movement test does compare Tier 1 and Tier 2. Neither establishes native parity for all 69 pieces. Sources: [generated cases](../../../tests/tier2ProviderFreeVerification.test.mjs#L76) and [parity checks](../../../tests/tier2ProviderFreeVerification.test.mjs#L464).

No production code, prompts, fixtures, or tests changed. No provider calls or new browser session ran. Native SVG behavior described below is traced from production source, not a fresh capture. Long text, responsive layout, zoom, camera, all pairwise compositions, and interactive timing still require targeted verification after approved fixes. The saved-record movement/PF timing findings remain open.

#### Reproducible failures beyond the saved outputs

These examples remain here even after temporary files are removed.

| Cases | Input and observed result | Why it matters |
| --- | --- | --- |
| B10-B11 | An unregistered relation supplies only `licensor: a` and `licensee: b`, with ordinary nodes. Both `feature.dependency` and `strong-npi` complete. A note explicitly saying there is no polarity/focus assertion does not prevent selection. | Endpoints with general licensing roles do not establish strong-NPI licensing. The solution is sufficient structured evidence, not reading prose to veto an otherwise unsafe default. |
| B06-B08 | `arguments: [a,b,c]`, `thetaRole: [Agent,Theme]` yields a third grid row labelled `3`. Two arguments with `[Theme,Theme]` fail after deduplication. Two arguments with `[Agent,Theme,Goal]` complete but omit Goal from the grid and residual claim. | Array order and repetition can express associations. They are not disposable duplicates. |
| B09, B55 | Correspondence sources `[a,b]` with targets `[c,c]` fail after c is deduplicated. Two ordinary pairs with `index: [i,j]` get i on all four endpoints. | Repeated endpoints and separate pair labels must survive. An unsupported pairing must be diagnosed, not silently simplified. |
| B13-B14 | `outcome: [licensed,UNINTERPRETED_QUALIFIER]` selects licensed drawings and consumes the whole field. The unknown item remains in the raw record but not in residual evidence. By contrast, `[licensed,blocked]` correctly fails the single-outcome check. | Recognition must account for individual values, including ones it cannot interpret. |
| B21-B23 | Phase root, edge a, complement VP emits two edge marks on a through `transfer.domain` and `phase.edge`. Exact `TransferDomain` missing its edge remains Tier 3. Plain complement alone does not draw Transfer. | Preserve the last two safeguards; fix duplicate composition and the separately agreed Tier-2 domain recovery. |
| B29, B81 | a and b are siblings under inner TP, inside root CP. With `domain: root`, focus lowering produces root-to-a and root-to-b emphasis, although those are not native branches. Direct children of root work. | A successful containment check must return the actual parent to the drawing. |
| B32, B80 | Shared node has parents actual1/actual2. Authored `parents: [a,b]` are unrelated. The recipe still completes and the plan names a/b as parents. Using actual1/actual2 also passes. | Having two parents somewhere is not evidence for the two parents named by the claim. |
| B30, B47 | F-projection accepts unrelated projection nodes. When the accent bearer is also the first listed projection node, lowering emits a self-hop before the upward hop. | Establish the exact authored chain and avoid manufacturing a link from an item to itself. |
| B46, B49 | Source DP and destination CP with different root identities pass movement identity through one shared descendant lineage. An unrelated `movedCarrier` also selects the carrier drawing and suppresses the ordinary path. | Root/occurrence identity and carrier membership need direct evidence. These examples must not authorize moving an unrelated whole constituent. |
| B35-B39 | `unpronouncedMaterial` on a silent node produces Strike. `gap` on silent DP or t_alpha fails; `gap` on a VP containing t produces `ti` on the VP. Plain t passes. | Silence does not mean deletion; notation matching must not substitute for the exact occurrence's role. |
| B62 | One probe, two goals, and `cycle: C2` emit two cyclic paths plus two generic feature paths on those same pairs. | Recognizing a specialized dependency and its generic component should not automatically draw both copies. |
| B74-B75 | `sequence: [a,b]` with rebracketing rows and `order: [a,b,c]` with precedence rows each select both PF rules. | Shared array-shaped input does not establish two different operations. |
| B12, B77 | The same candidate host in licensed and rejected lists receives two licensed paths plus check/cross badges. A blocked movement reports Path states in metadata but its trajectory has no state; production always attaches an arrowhead. | Outcome must remain attached to the exact claim and reach the actual drawing. Contradictions need diagnostics, not an arbitrary winner. |

Sources: [deduplicating evidence](../../../replay/relations/tier2RelationDispatch.ts#L210), [limited collision handling](../../../replay/relations/tier2RelationDispatch.ts#L272), [structural checks and trace lookup](../../../replay/relations/tier2FacetRecipes.ts#L854), [whole-key evidence consumption](../../../replay/relations/tier2FacetRecipes.ts#L1280), [movement lowering](../../../replay/relations/tier2RenderPlanCompiler.ts#L286), [candidate lowering](../../../replay/relations/tier2RenderPlanCompiler.ts#L746), [trajectory binding](../../../replay/relations/geometryBinding.ts#L887), and [unconditional trajectory arrowhead](../../../components/TreeVisualizer.tsx#L4910).

#### Recognition and the drawing disagree

TreeVisualizer invokes family-specific drawing code for Tier 2 as well as Tier 1. Several branches ignore the normalized plan content and interpret the original relation again. An approved design existing in the Orchard does not make these alternate inputs compatible with it.

| Existing drawing | Tier-2 result versus production input | Required correction, not yet implemented |
| --- | --- | --- |
| Theta grid | B05 compiles Agent/Theme rows for a/b. The custom renderer enumerates raw anchor keys, treats `arguments` as the role label, and takes only the first member of that array. | Draw the resolved role/argument pairs, preserving all literal role values. |
| F-projection | B85 resolves `projectionNodes` and produces hops/annotations. The custom renderer reads raw `projections` instead. | Use the same resolved path and annotations that were validated. |
| PF correspondence | B73 supplies current source/target anchors and correspondence rows. The custom renderer requires raw `values.sources`, `values.exponents`, and `values.correspondence`; without them it removes its layer. | Reconcile the structured drawing input with the actual mapping evidence. Do not fabricate mappings or merely rename unrelated fields. |
| Fission | B27 allows three outputs; the renderer removes its layer unless there are exactly two. Even B82 with two outputs provides generic feature rows, while drawing reads `inputFeatures`, `outputOneFeatures`, and `outputTwoFeatures`. | Establish the supported bundle mapping and multiplicity. Recognition must not claim a complete bundle drawing while its content is missing. More than two outputs needs a deliberate repeated-piece design decision. |
| Impoverishment | B28 requires `anchors.featureHierarchy`, a list of syntax IDs. Drawing instead requires `values.featureHierarchy`, a list of feature literals, and removes its layer when absent. | Separate syntax anchoring from the authored feature hierarchy. Resolve the exact removed feature/link; never substitute an arbitrary position. |
| Local dislocation | B74 carries before/after rows. Drawing ignores those rows and uses raw `beforeGroupSizes`/`afterGroupSizes`; without them it reconstructs identical grouping from current nodes. | Carry the established before/after grouping into the drawing without reinterpreting free prose. |
| Cyclic linearization | B75 needs only current order plus rows. The custom comparison expects current/prior order via an anchor-set plan item and raw order fields; missing prior pairs stop that comparison. Without the special branch, a generic plaque may remain. | Distinguish a genuine before/after comparison from a generic list. Share resolved ordered states with the existing comparison drawing. |

Sources: [PF correspondence](../../../components/TreeVisualizer.tsx#L2745), [fission and impoverishment](../../../components/TreeVisualizer.tsx#L2914), [local dislocation](../../../components/TreeVisualizer.tsx#L3183), [cyclic comparison](../../../components/TreeVisualizer.tsx#L3266), [F-projection](../../../components/TreeVisualizer.tsx#L3867), and [theta](../../../components/TreeVisualizer.tsx#L3999).

The strong-NPI custom branch also expects a full focus configuration, but its guard allows a generic drawing when the focus pair is absent. It would be incorrect to claim every two-anchor case disappears. The confirmed problem is unjustified strong-NPI recognition; alternate field names still need end-to-end verification. The proposed shared drawing input must preserve deliberate generic-versus-curated behavior rather than deleting those guards indiscriminately.

#### All rules and pieces

This matrix covers every current rule and all 69 unique piece names. Branch overlay occurs in two rules. The evidence column describes what the piece communicates and the requirements to settle; it is not a new approved contract. A bounded positive result establishes only that the listed local case compiles. It is not proof of every valid spelling, combination, timing, or pixel. Main finding numbers identify shared fixes rather than 52 separate implementation projects.

| Recovery rule | Existing pieces | Evidence and composition boundary | Review result |
| --- | --- | --- | --- |
| `movement.path` | Movement curve; Orthogonal movement; Cross-workspace crest; Path states | Proven movement of the anchored occurrence, exact departure/landing, and any authored route/state. Route and outcome modify that path; they are not separate operations. | B46 falsely accepts descendant-only identity; B77 drops state. B78-B79 exercise alternate routes. Findings 09-13, 34, 37; Replay integration remains open. |
| `movement.carrier` | Carrier arrow | Movement plus an identified carrier and its relationship to the moved material. | B49 accepts an unrelated carrier and lowering ignores it. Finding 34. Preserve the ordinary path unless the specialized claim is actually supported. |
| `gap.notation` | Gap label | Exact authored gap/trace role, not a prescribed spelling or any containing subtree. | B36-B39 expose both missed and wrong-node recognition. Finding 38. |
| `identity.occurrences` | Coindex; Forest light | Authored occurrence identity/grouping. Light is presentation of that group, not another identity claim. | B50 and B76 compile groups; B17 correctly cannot turn one repeated ID into two occurrences. Pair/index handling still needs finding 33 and native review. |
| `presentation.lens` | Lens emphasis | An active lens and a supported owning claim. | B50 exercises the companion. It must not establish a relation or replace the claim's own emphasis rules. |
| `control.dependency` | Rectangular domain; Control connector | Controller/controllee dependency; an enclosure additionally needs its domain. | B02 loses the whole connector without a domain; B03 compiles both. Decide whether the existing connector can stand alone, without silently changing Tier 1. |
| `binding.dependency` | Elliptic domain | Authored binding dependency and an identified domain for the enclosure. | B41 also selects operator-binding from the same evidence. Decide composition versus competing readings; no second claim follows merely from two matching rules. Findings 32, 36. |
| `predication.dependency` | Predication connector | Distinct predicand and predicate endpoints; one relation may name several predicates. | B51 compiles two connectors. B16 self-predication and B42 unresolved node do not complete. Preserve these exact-witness safeguards. |
| `parasitic-gap.paths` | Path-node rings | Two authored dependency paths and their ordered members. Rings describe those paths, not arbitrary node lists. | B52 compiles both lists. Path order/connectivity and overlap need explicit expectations under findings 33-34. |
| `parasitic-gap.copy` | Copy fork | Filler, ordinary gap, and parasitic gap occurrences in their stated relationship. | B53 compiles multiple gaps. Trace lookup inherits finding 38; multiplicity must preserve each gap's role. |
| `locality.boundary` | Barrier cut | A stated boundary/locality claim and its exact domain/boundary anchors. | B54 compiles the mark. Generic containment alone must not establish a crossing violation or its outcome. |
| `ellipsis.site` | Ghosting | Authored silent material at the identified site. Ellipsis and silence are not interchangeable linguistic claims. | B34 accepts a site because one descendant is silent. Decide precisely which material is ghosted and what, if anything, establishes ellipsis. Finding 38. |
| `correspondence.alignment` | Correspondence curves; Correspondence index | Explicit pairings; indices belong to those pairings. | B09 loses a repeated target; B55 collapses distinct indices. Finding 33. Lines and labels must share pair ownership. |
| `deletion.site` | Strike | An authored deletion claim on exact material, not mere lack of pronunciation. | B35 selects Strike from unpronouncedMaterial. Finding 38. |
| `constituent.occurrence` | Constituent enclosure | An identified constituent occurrence. | B56 compiles an enclosure. Keep the existing ambiguity guard against simultaneously treating it as a carrier region. |
| `constituent.region` | Gradient enclosure | An explicitly identified carrier/chunk region. | B57 compiles the region. Mere mention of a carrier must not prove an unrelated movement, as B49 shows. |
| `pair-merge` | Branch overlay | Authored host/adjunct pair on the actual two-way branch. | B58 native siblings pass; B59 non-siblings fail. Preserve the approved whole-branch geometry; no redesign proposed. |
| `multidominance` | Shared branch | The exact shared node and its actual named parents. | B32 accepts wrong parents; B80 is the valid control. Finding 34. |
| `argument-sharing` | Crossed domain ovals; Label box | Shared argument and named predicate domains; label remains authored. | B31/B83 compile without establishing the argument's structural relationship to those domains. Agree what evidence is necessary without imposing one theory's domination requirement. |
| `idiom.chunks` | Underline; Domain bracket | Authored cointerpreted chunks; a domain bracket needs its identified domain. | B33 without domain fails; B60 with it compiles. Decide whether the underline is independently meaningful, not a reason to infer an interpretation domain. |
| `plaque.structured` | Plaque shell | An anchored record with literal rows. Shell and content belong together. | Reserved row names gate recovery; B48 repeats theta content in the generic plaque. Findings 16-17, 36. All values must remain inspectable; display policy stays open. |
| `feature-sharing` | Feature vine | Authored sharing among bearers, with feature content preserved. | B61 compiles three bearers. Repeated literals and exact participants need finding 33; no inferred agreement direction. |
| `agreement.cycle` | Cycle badge | An explicitly numbered/named cycle of the stated dependency. | B62 produces duplicate generic and cyclic paths. Finding 36. Badge and path refer to the same claim. |
| `feature.dependency` | Feature connectors | Directed feature relationship established by roles and values. Assignment, collection, and generic dependency are not identical. | Generic source/target and licensing aliases overrecognize. Solid Case versus dotted collection remains finding 20; B10/B62 add findings 32, 36. |
| `dependent-case` | Dependent-case elbow | Explicit dependent-Case evidence and its ordered participants. | B63 exercises selection. Keep the existing Case/polarity ambiguity guard; direction and exact value checks remain necessary. |
| `accord` | Accord connector; Boxed index | Authored polarity accord, its participants and literal feature/index. | B64 exercises connector/index. Preserve distinction from ordinary agreement; verify aliases and literals through the custom scope-information renderer. |
| `phase.domain` | Phase arc | An explicitly identified phase domain, not an isolated phase head treated as the enclosing phrase. | B18 reproduces head/domain confusion. Findings 22, 34. The arc alone does not establish Transfer. |
| `transfer.domain` | Transfer arcs | Explicitly transferred material at an exact domain. A larger curated Transfer recipe may require more. | B19 with transferredDomain alone fails. B21 duplicates the edge. Findings 22, 36. Plain complement remains insufficient; exact incomplete Tier 1 remains protected. |
| `domain.annotation` | Overlay annotation | Authored literal label on its exact domain. | B65 compiles the supplied text. Long text and shared fitting remain findings 16-17; do not infer a semantic judgment from prose. |
| `phase.edge` | Edge outline | Every explicitly accessible edge occurrence. Repeated outlines are one authored relation, not extra Transfer events. | B20 with two edges fails the single-edge limit; B21 duplicates one. Findings 22, 36. Two DP-label outlines are already approved. |
| `transfer.access` | Access path | Authored source/target access claim, transferred domain, and any stated failure. | B66 compiles blocked access. It must not become a movement transition. Outcome and exact membership need focused proof. |
| `judgment.verdict` | Verdict glyph; Verdict label | An authored verdict and optional literal label on the judged analysis. | B84 compiles both. Convergence prose is not a glyph; placement/spacing and judgment-versus-summary decisions remain open. |
| `landing-candidates` | Candidate rail | Named candidate hosts, each with its own stated status. | B12 silently prefers licensed for a contradictory host. Finding 37. Candidate alternatives do not authorize replaying multiple successful movements. |
| `judgment.blocked` | Blocking cross | Explicit blocked outcome on the exact judged object. | B67 compiles the local cross. Preserve its owner and do not infer ungrammaticality from an unrelated failure. |
| `judgment.licensed` | Licensed check | Explicit licensed outcome on the exact judged object. | B13 loses the unrecognized item alongside licensed. Findings 33, 37. |
| `intervention` | Intervention path | Authored dependency, intervener and endpoint roles, with explicit outcome. | B68 compiles blocked intervention. Exact role relationships need stronger proof than generic node existence. Finding 34. |
| `blocked-extraction` | Blocked extraction curve; Branch overlay | Authored attempted extraction and the adjunct branch/domain that blocks it. | B69 compiles both pieces. Keep the approved adjunct-branch overlay distinct from Pair Merge's whole fork; do not infer a successful landing. |
| `focus.prominence` | Prominence branches | Authored prominence contrast on the actual native branches. | B29 produces nonexistent root-to-descendant edges; B81 is the direct-child control. Finding 34. |
| `focus.projection` | Projection hop; Feature annotation; Accent annotation | Authored upward projection path and literal feature/accent content. | B30/B47 accept wrong/self hops; B85 exposes raw-field disagreement. Findings 34-35. Neither annotations nor node labels authorize extra movement. |
| `strong-npi` | Nested association curves; Feature notation | Strong-NPI licensing evidence; full focus configuration only where actually supplied. | B10/B11 overrecognize ordinary licensing. B86 adds a feature but alone does not establish the full claim. Finding 32; custom-versus-generic guard needs native verification. |
| `storage.ledger` | Ledger frame | Authored stored content associated with its scope/domain. Frame and rows form one display. | B43 ordinary stored value fails; B70 reserved rows compile. Review recovery without guessing which arbitrary values mean storage; verify content in the custom renderer. |
| `scope.movement` | Covert path; Scope domain | Proven covert dependency/movement; domain enclosure additionally needs scope evidence. | B45 loses a path without scope; B71 compiles with it. Decide grouping as for finding 31; retain identity and timing requirements. |
| `operator-binding` | Ranked scope hulls; Variable-binding path | Authored binder/variable pair; hulls require separately supplied domains/ranks. | B01 loses the path without scope; B41 selects two binding rules together. Findings 31-32, 36. No invented scope. |
| `theta-grid` | Role grid | Explicit predicate and argument/role pairs, including a single assignment. | B04 rejects one; B06-B08 change labels/cardinality; B05's native drawing ignores compiled pairs. Findings 20, 33, 35. |
| `pf.structured` | PF plate frame; PF plate rows | Authored realization at its host with literal content. Frame/rows stay together. | B24 ordinary values fail; B25 mixes verdict content into PF rows. Findings 30, 36. Host realization and Replay timing need joint repair. |
| `pf.rewrite` | Rewrite arrow | Authored prior input, current output, and rewrite correspondence. | B72 compiles an explicit mapping. Do not invent an equation from do-support prose or infer a syntactic movement from this arrow. |
| `pf.correspondence` | Correspondence map | Authored sources, outputs, and explicit mapping. | B73 completes recognition but does not supply the custom renderer's expected data. Finding 35; preserve many-to-many associations. |
| `pf.fission` | Bundle shell | Authored input/output feature bundles and their split, with prior input when a transition is claimed. | B26 without source fails; B27/B82 expose output-count/content mismatch. Finding 35. Bundle shells are not permission to invent absent feature allocation. |
| `pf.impoverishment` | Delinking mark | Authored feature hierarchy and exact removed feature/link on the terminal. | B28 confuses syntax anchors and feature literals. Finding 35. A position must not default to the first link when unresolved. |
| `pf.local-dislocation` | State lanes | Actual authored before/after grouping. | B74 selects both order rules and native grouping ignores compiled rows. Findings 32, 35. |
| `pf.linearization` | Comparison column layout | Authored ordered states and the precedence comparison they support. | B75 has the same collision and lacks the special drawing's prior-state data. Findings 32, 35. |
| `organization.large-anchor-set` | Anchor badge; Anchor rail | Organization of a supported claim with many participants, not a new linguistic relation. | B76 exercises the companion. Preserve exact participant identity and label meaning; multiple-claim clutter remains deferred, not solved by more numbering. |

#### Shared correction order

These are proposed implementation boundaries, not permission to begin implementation.

1. Agree on what constitutes a supported piece: meaning, exact anchors, necessary companions, ordered values, and ambiguous evidence. Begin with the already approved repeated Transfer edges and the proposed independent domain/path cases. Do not demand an entire Tier-1 recipe or weaken an exact one.
2. Make recognition produce one complete drawing input for each supported claim. Include exact resolved participants, literals, pairings, outcome, and evidence locations. The existing Tier-1 and Tier-2 drawings should consume that same input. Keep the original relation intact for inspection.
3. Resolve overlapping pieces within a relation without duplicating geometry or hiding unused values. Keep separate authored relations in their authored moments. Share recognized movement/PF transitions with Replay rather than rediscovering them from names.
4. Add independently specified positive and near-miss tests for each changed behavior. Verify actual production marks, text, and Replay boundaries, then representative combinations, long values, desktop/mobile, and zoom with browser approval. Metadata coverage alone is insufficient.

Internal diagnostics must distinguish insufficient meaning, unresolved anchor, wrong structural relationship, ambiguous interpretation, conflicting outcomes, mismatched array lengths, unused array items, and a plan the drawing cannot consume. Name the original stage/relation/field and exact involved nodes or values. Report recognized versus actually rendered pieces separately. Do not claim that every unexpected input has one provable linguistic cause, or turn these diagnostics into an unapproved public warning/rejection policy.

Keep this work alongside the unresolved parser, prompt, diagnostics, and linguistic findings. No new Tier-3 design, prompt menu, paid generation, or production change is authorized by this review.

#### Grilling follow-up: linguistic meaning and missing enclosures

Francis did not give blanket approval to omit the Control, covert-movement, or idiom domain marks. He asked whether each remaining piece has a linguistically defensible meaning, rather than rescuing an incomplete claim. Distinguish three things: a missing graphical enclosure; no separate domain anchor although the relevant structure exists; and missing information essential to the dependency itself. Only the first two can justify a smaller Tier-2 drawing, and only when its own meaning and exact participants are established. Do not erase or ignore an explicitly authored conflicting domain. Incomplete exact Tier-1 claims retain their existing protection. Drawing an authored claim also does not certify its grammatical correctness.

- Control: in the PRO analysis used by the Orchard card, the connector states who controls the embedded subject. The embedded clause remains in the tree without a rectangle around it. [Norvin Richards's MIT control notes](https://web.mit.edu/norvin/www/24.902/control.html) distinguish this dependency from raising and discuss the separate clause structure. The design inference is that a connector can express an established Control dependency without an additional domain highlight. Two merely coindexed nodes do not establish Control, and the renderer must not invent PRO or its clause.
- Covert movement: a path can express an authored movement between actual lower and higher occurrences without another outline around its scope. The landing and interpretation cannot be absent and supplied by Babel. [Chris Barker's discussion of QR](https://semanticsarchive.net/Archive/TE4ODA3N/barker-quantifier-raising.pdf), section 2, explicitly relates source and raised structures; section 4 distinguishes movement from in-situ accounts of scope. The design inference is about omitting an outline, not dispensing with scope or treating every scope dependency as movement.
- Idiom cointerpretation: the Orchard's source makes the pieces' meanings explicit. [Ahn, figure 94 and its surrounding discussion](https://www.byronahn.com/pub/Ahn-Mapping-OUT-Argument-Structure.pdf#page=27), identifies underlines as idiom chunks interpreted together and separately discusses the interpretation domain needed by that analysis. Underlines can therefore state chunk membership/cointerpretation without also drawing a domain bracket. This does not show that the domain requirement has been satisfied. [Bruening's alternative account](https://udel.edu/~bruening/Downloads/IdiomsLocality2NA.pdf) disputes universal phase-locality restrictions on idioms; Babel must not impose one fixed VP/TP/phase boundary across theories. Exact chunk membership and an authored idiomatic relationship remain necessary.

These are source-supported arguments for the smaller drawings, not claims that the sources endorse Babel's Tier-2 implementation. The recoverable machine evidence for each still needs specification; a general role alias or a matching relation title alone is not enough.

The other answers to the six-question batch are recorded as follows:

- Phase placement: Francis agrees with locating the projection of an explicitly authored phase head only when the relevant projection is unambiguous. Explain this as locating the model's phase in its existing tree, never inferring phasehood from a C/v label or confusing the phase with its transferred complement. Exact projection identification remains an implementation requirement, not an assumed capability of current code.
- Pairing: no implicit positional-pairing convention is approved. Separate arrays can have equal lengths while their associations remain unclear. Preserve order and repetition, but do not assume that the first literal belongs to the first anchor. Recommended direction for discussion: keep each association explicitly linked in an open representation; assess how this fits the existing flat anchors/values contract before proposing a change. Do not split one authored relation into separate moments merely to work around encoding. Findings 20 and 33 include both encoding clarity and data preservation.
- Repeated drawings: conditional agreement to repeat an existing design for additional model-authored participants, including fission outputs, only if it retains the same linguistic meaning and the necessary information is present. This is not approval to invent feature allocation or expand every fixed two-way drawing automatically. New arrangement still needs visual review.
- Movement and later realization: the renderer follows the model's chronology. Francis agrees with revealing did at the later realization moment when preceding state and authored relations establish that order. The agent owns identifying necessary general contract clarifications; Babel must not invent that sequence from linguistic expectations or independently prescribe a do-support analysis. No production or prompt edit is authorized during grilling.
- Open relations: withdraw the proposed special treatment of Convergence. The current [prompt](../../../server/babelParser/systemInstruction.js#L96) reserves relations for content not fully expressed by ordinary mother-daughter or sisterhood geometry, repeated at lines 112-113. It does not establish a blacklist of relation names. Do not expand this rule into forbidding particular judgments or completion claims.

#### Proposed evidence rules and explicit associations

This follow-up inspected the current relation type, prompt, relation validation, Tier-2 aliases/recipes/lowering, and saved Astra/Fable payloads. It is a proposal for discussion, not an approved contract or implementation. No production, prompt, Tier-3, or provider changes were made.

**The immediate problem is not simply a required domain.** Six additional read-only dispatch checks reproduce the following results. All use an unregistered relation name; the two test participants share a lineage and sit under one root. These deliberately minimal objects test recognition gates, not linguistic validity or visual correctness.

| Authored roles | Current selected pieces/rules | What the check establishes |
| --- | --- | --- |
| `antecedent`, `silentSubject`, `domain` | `control.dependency` | Broad reference/subject roles become Control without evidence distinguishing it from other dependencies. |
| `controller`, `controllee` | Tier 3 | The more specific roles do not overcome the required domain. |
| `members`, `domain` | `identity.occurrences` and `idiom.chunks` | Generic membership becomes both identity and idiomatic cointerpretation. |
| `idiomChunks` | Tier 3 | Explicit chunk roles do not overcome the required domain. |
| `source`, `target`, `domain` | `feature.dependency` and `scope.movement` | Generic endpoints with shared lineage become feature dependency and covert movement; the check supplies no covert interpretation. |
| `pronouncedQP`, `lfQP` | Tier 3 | More specific occurrence roles still encounter the domain gate; these roles alone are not a positive linguistic test of QR. |

The broad substitutions are in [tier2Synonyms.ts](../../../replay/relations/tier2Synonyms.ts); the three bundled requirements are in [tier2FacetRecipes.ts](../../../replay/relations/tier2FacetRecipes.ts). Simply deleting the domain requirements would enlarge false recognition. Preserve the original role/value and the exact evidence supporting each meaning; an alias candidate is not evidence that all of its possible meanings were authored.

**Proposed minimum evidence for the smaller drawings:**

| Drawing | What the model must establish | What Babel may omit, and what it must not infer |
| --- | --- | --- |
| Control connector | An explicit controller-controlled dependency, with its exact participants present in the authored structure. Recognized role/value evidence must distinguish Control from generic reference. | Omit the extra domain rectangle when no domain highlight is authored. Do not infer Control from coindexation, silence, or an antecedent role; do not create a subject/clause or impose PRO spelling, a fixed clause label, or one theory of Control. |
| Covert-movement path | An explicit covert-movement dependency, its exact source and landing occurrences, their authored identity, and direction. The record must distinguish movement from a static scope or PF/LF correspondence. An animated transition also needs the preceding state and authored chronology. | Omit the scope outline when the path is independently established. Do not invent a landing, scope boundary, variable, or pronunciation choice. Shared lineage, a silent node, or generic source/target roles alone do not establish covert movement. |
| Idiom underlines | An explicit idiomatic cointerpretation claim and the exact chunks belonging to that claim. Preserve grouping if more than one idiom is present. | Omit the domain bracket without certifying that an interpretation-domain condition is satisfied. Do not infer idiomaticity from familiar words or generic membership, add missing chunks, or impose a universal VP/TP/phase boundary. |

These are evidence requirements for selecting marks, not a new test of whether an analysis is grammatical. Babel checks what the model represented and where its participants are; it does not independently prove the model's linguistic account. The linguistic sources and limits are in the preceding subsection. Open roles/values remain open: no mandatory linguistic vocabulary, relation menu, theory choice, or model-facing examples are proposed. Unknown wording may remain unrecognized; the original claim stays intact.

An explicitly authored contradictory or unresolved domain cannot be silently treated as an absent optional decoration. Retain it and diagnose the actual problem. Incomplete exact Tier-1 claims still cannot be reduced to these Tier-2 versions; do not rename a claim to evade that protection. Control and idiom lowering already emit their connectors/underlines separately from their domains, and the QR plan type already permits an absent scope domain. This identifies reusable drawing inputs, not a completed visual proof.

**Associations: what already fits, and what does not.** The existing shape permits only `relation`, `anchors`, optional `priorAnchors`, and optional `values`. Anchors and values are flat role-to-string/list maps. It has no general grouped-entry field or declared rule linking positions across different arrays.

- Astra X-bar S2 already links one `argument: objectNP` and `thetaRole: Theme` within one relation; S3 separately links `argument: johnNP` and `thetaRole: Agent`. Neither needs an array-pairing rule or a contract extension. Fable's missing literal values remain the separately recorded issue; no label is supplied from its title by this proposal.
- Astra's two accessible Transfer participants are two explicitly identified participants of one claim, not two parallel lists that need zipping. Repeating the approved edge outline does not itself require a new field.
- Where the role names directly establish who relates to whom, keep that representation. A scalar-to-list or set-to-set claim must retain its authored group meaning; list shape alone does not license pairwise arrows or a Cartesian product.
- A general relation containing several distinct participant/value associations cannot reliably encode them as unrelated flat lists without an additional convention. Equal lengths do not prove correspondence. Parsing arrows out of prose, inventing numbered role suffixes, or splitting the relation into new Replay moments would create different problems.

**Proposal for that genuine multi-association case:** consider one optional `associations` list inside the existing relation. Each entry keeps its own `anchors`, optional `priorAnchors`, and optional `values` together. It has no separate relation name, stage, ID, or Replay moment, and cannot recursively contain more associations. Simple relations stay unchanged. Parent fields remain relation-wide context; they are not zipped, copied into entries, or silently paired with entry-specific values. Each entry explicitly includes the participants needed for its own association, even when a shared participant is repeated. This adds grouping, not a finite linguistic ontology.

This is an explicit proposal to extend the contract, not a field that works today: the current validator rejects it. It adds nesting and some possible repetition, so it must be justified by the multi-association use case rather than required for every relation. Adopting it would require coordinated prompt/type/validator/reference-resolution/provenance/renderer work. All node references would remain subject to their existing current/prior-stage scope. Preserve entry order, repeated literals, repeated participants, and many-to-one associations. Grouping does not establish linguistic meaning or independently earn a tier. Exact Tier-1 protection and ownership of any genuinely separate claims must remain explicit; adding an association is not permission to label a missing part an independent sibling. No existing unpaired record is automatically rewritten into groups.

**Diagnostics and future regression checks:** identify the original stage, relation, field, and array/association item. Say, for example, that available roles do not distinguish Control from reference, that a particular landing ID is unresolved, or that no association links the two lists. Do not report an unexplained mismatch as a model reasoning failure. Test these six recognition contrasts with properly structured positive examples; explicit versus absent versus conflicting domains; intact exact Tier-1 protection; unrelated nodes sharing only a descendant lineage; in-situ scope without movement; repeated labels/targets; array permutations; and one simultaneous relation moment for multiple associations. Verify actual primitive inputs and painted content, not only selected recipe names. Internal diagnostics do not decide frontend warnings or rejection policy.

Francis conditionally approved optional grouping on 9 September: add it only if it is genuinely necessary. Before adopting an extension, demonstrate a concrete multi-association case that the existing format cannot express unambiguously without an additional convention, and check whether a simpler clarification suffices. This is not approval of the exact `associations` syntax, extra nesting for simple relations, or implementation during grilling. The false recognition above remains a confirmed defect, not a discretionary design preference.

The remaining-rule check below completes that technical investigation. The three smaller drawings retain their proposed semantic boundaries; production and prompt changes remain deferred until the shared review is complete.

#### Remaining matching rules and grouping necessity

The 9 September follow-up reviewed all 52 rule definitions, their role/value aliases, structural checks, collision handling, evidence consumption, plan construction, and relevant native drawing branches. It reran the earlier 86-case baseline and added 77 targeted probes in `/tmp/babel-recognition-followup.mjs`. The corresponding JSON retains each probe's input forests, original relation, rule evaluations, selected claims, unused evidence, diagnostics, plan items, and bound geometry. Nine production/contract file hashes remained unchanged. The four existing focused suites again passed all 87 tests. No production, prompt, fixture, or executable test changed; no provider or browser ran.

The new probes use hand-written records, not additional model outputs. Bound geometry uses synthetic coordinates to inspect content and outcomes, not to verify appearance or camera behavior. Native rendering observations below follow the actual TreeVisualizer branches and their guards; they are not new browser captures. The existing all-rule matrix remains the catalog. The results below extend findings 22 and 32-39 rather than creating a second issue list.

**Confirmed causes and reproductions**

| Probes / findings | Exact result | Owning cause and required correction |
| --- | --- | --- |
| N01-N03, N15; 32 | Generic `members` becomes coindexation. `antecedent`, `pronoun`, and a containing `domain` become a binding-domain drawing. `host` plus a sibling `member` becomes the Pair-Merge fork. `quantifier`, `pronoun`, and `domain` become an operator-variable binding path. | Role aliases promote a possible reading into an established claim. Membership does not itself assert identity; reference does not itself assert binding; being siblings does not itself assert the special attachment. Require the meaning of the selected mark, not just resolvable endpoints. |
| N05-N07, N13, N49; 32 | `participants` plus `features` selects feature sharing and lens emphasis; `searcher`, `target`, and `iteration` select Cyclic Agree; generic source/target selects a feature connector; ordinary licensor/licensee also selects strong-NPI. `domains` plus an `argument` outside them selects argument sharing. | These inputs do not distinguish sharing from feature possession, Agree from another search, or an arbitrary argument from a shared one. Do not solve this by imposing a new linguistic theory or requiring the model to use a fixed vocabulary. Some native specializers also cannot consume these alternate roles, which is separately finding 35. |
| N08-N09; 32 | `features: "not dependent Case"` selects the dependent-Case elbow. `features: "no polarity accord"` plus an index selects Accord. Both supersede the generic feature drawing. | `value-token` checks only whether particular words occur anywhere in one literal. It does not establish an affirmative claim. Replace this criterion with sufficient explicit evidence. Do not add a growing list of negation exceptions or interpret arbitrary prose. Unrecognized literal text remains intact. |
| N11-N12; 22, 32, 36 | Generic `edge` creates a mark labelled Phase edge. `phase`, `edge`, and ordinary `complement` select Transfer as well as Phase and edge, despite no transferred-material claim. | A phase and its complement do not, by themselves, state that Transfer occurred. Plain complement alone correctly fails, as B23 showed; this combined counterexample exposes the remaining inference. Preserve phase versus Transfer versus accessibility, and avoid the duplicate edge mark. |
| O-access/O-intervention/O-extraction; 37 | With the same exact endpoints, each of absent, `allowed`, `blocked`, `illicit`, and unknown outcomes still selects the blocked-family drawing. In particular, `allowed` is consumed, `outcomeConcept` becomes null, and bound geometry is blocked. No outcome-mismatch diagnostic is emitted. | Optional outcome cardinality is checked, but an authored recognized outcome outside the recipe's accepted set does not make the recipe incomplete. Lowering/binding then uses an inherently blocked drawing. Native Transfer access and intervention unconditionally draw a cross; native extraction draws its blocked-diagnostic curve but does not append that generic cross. Preserve the actual outcome or withhold the unsupported specialized mark, without rejecting the analysis or inventing a new positive design. |
| O-feature-illicit, N47; 33, 37 | A recognized `illicit` feature outcome outside that recipe's accepted set is consumed but omitted from the drawing. A known outcome beside `UNKNOWN` consumes the entire value field and loses the unknown item from residual evidence. | Accepted, unsupported, absent, and conflicting outcomes must remain distinct. Track consumption per item and report the precise field and drawing limitation. Keeping the raw JSON alone does not make the unused evidence accounted for. |
| N18-N23; 34, 38 | The carrier rule accepts identical source/landing IDs and an unrelated carrier. The ordinary path accepts a lower witness containing ordinary overt material; a containing VP is labelled as a gap because a descendant is t. Wrong shared parents and disconnected F-projection hops also pass. | Preserve the exact occurrence and structural witness, not a matching descendant or an unrelated node. The carrier variant currently omits the ordinary path's distinct-endpoint check. An overt lower occurrence is not automatically invalid, but these checks must not claim that they established a trace, deletion, or movement chronology. No trace insertion is authorized. |
| N24-N29, N54; 20, 33, 37 | A host in both candidate-status lists gets two licensed plan paths plus contradictory badges. Reordering one correspondence list silently changes the pairs; repeated targets collapse and prevent recognition. Separate indices become the first index on all endpoints. Theta still invents a row number for a missing role, loses repeated roles, and fails a complete single assignment. | Pairing, repetition, and status belong to explicit associations. Neither declaration order nor equal list lengths proves an association under the current prompt. Do not invent labels or choose one conflicting status. |
| N14, N24, N50; 35 | Ordinary scope rows select Cooper Storage, whose native branch ignores those rows and displays its own category/qstore/retrieved fields, including empty lists that were never authored. Candidate-only Tier-2 plans lack the forbidden-region and anti-locality items required by the native improper-movement branch. It returns without drawing and suppresses the generic route. | A plan can select a piece that is absent or says something different in the real component. Candidate geometry additionally marks even a licensed-only path as blocked, but the current native guard prevents claiming this particular probe visibly shows that cross. Fix the common drawing input and report an undrawn recognized piece. Do not invent the missing full Tier-1 context. |
| N30-N34; 33, 35 | Arbitrary strings under `correspondences` complete the PF correspondence recipe. A prior input and three outputs plus an undivided feature list complete fission and earn fission timing without output-specific feature allocation. An unresolved `removedLink` literal completes impoverishment. A single prior-order or current-order list selects both dislocation and linearization. | Cardinality/field names do not establish mapping, feature allocation, a particular removed link, or a before/after regrouping. Preserve complete independently authored content and pass it to the existing drawing; do not treat a selected recipe or a structural difference as a complete morphological account. |

Sources: [alias normalization and collision handling](../../../replay/relations/tier2RelationDispatch.ts#L210), [word-presence and structural tests](../../../replay/relations/tier2FacetRecipes.ts#L919), [recipe outcome validation and whole-key consumption](../../../replay/relations/tier2FacetRecipes.ts#L1247), [outcome lowering](../../../replay/relations/tier2RenderPlanCompiler.ts#L112), [blocked geometry](../../../replay/relations/geometryBinding.ts#L1270), [Transfer access cross](../../../components/TreeVisualizer.tsx#L5216), [intervention cross](../../../components/TreeVisualizer.tsx#L4194), [native candidate guard](../../../components/TreeVisualizer.tsx#L2408), and [Cooper Storage's replacement rows](../../../components/TreeVisualizer.tsx#L3658).

**Do not classify every generic piece as a linguistic invention.** N17 ghosts only the explicitly silent child, not its overt sibling or the whole VP. This is a faithful silence mark even though its rule is named `ellipsis.site`; deletion-event ownership needs separate evidence. N51's primary/secondary rings mark the exact authored path members and do not draw extra connecting tree edges. N52's boundary mark alone is not a verdict cross. N39-N40's constituent outline and literal caption add no unexpressed theoretical claim. A more specialized internal family name is not, by itself, proof that its generic visual piece overclaims.

Several safeguards held: no phase from a C-labelled node alone; no predication connector to a missing node; no independent lens or large-array organization without a supported parent; no rescue of incomplete exact Control/Transfer through Tier 2. Conflicting dependent-Case/Accord readings suppress those specialized drawings and produce a collision diagnostic, although a generic feature drawing survives. These are bounded controls, not proof of full correctness. Explicit predicand/predicate roles, named path/gap roles, literal plaques and verdicts, and PF input/output records still need their specific evidence/content requirements from the all-rule matrix, not a blanket ban on broad words or new renderer-driven authoring requirements.

**The shared correction is architectural, not a list of word bans.** The current dispatcher treats every completed signature as a claim; most ambiguous combinations produce no diagnostic. The existing specification also says that two complete facets both draw and explicitly approves the token-presence tests. Those clauses must be revised along with the code. Keep candidate word meanings separate until the exact authored context establishes a drawable claim. Then produce one drawing input containing its meaning, exact participants, literals, associations, and outcome. A generic piece may survive only when its own statement is complete. A missing or contradictory essential part must not be renamed as optional context. Preserve the existing exact Tier-1 protection.

Recognition, plan validation, and actual drawing need separate diagnostic results. For example: the `allowed` value is incompatible with the selected blocked-access graphic; a candidate plan is missing input required by the native branch; the role `members` does not establish occurrence identity; or a value list has no defined link to an anchor list. Retain original stage/relation/field/item locations and the actual matched aliases/checks. These are internal facts, not a new frontend failure policy. Do not label a relation linguistically wrong merely because Babel cannot recognize its vocabulary.

**Does grouping really need a new field?** The simple participant/role example was not sufficient justification. An explicitly declared positional convention can encode homogeneous pairs and many-to-many links using repeated endpoints. A local comparison demonstrated that without deduplicating the lists. Many-to-many cardinality alone therefore does not prove that nested entries are necessary. The existing bug is that Babel assumes a convention the prompt never states and then destroys repetitions.

The stronger existing case is [Orchard fission](../../design/visual-relations-current-lab.tsx#L7159): one output has its own feature bundle, another has a different bundle, and shared feature literals occur in both. Its current fields `outputOneFeatures` and `outputTwoFeatures` hide an output-position convention in field names. Francis has conditionally accepted additional outputs when the same drawing and linguistic meaning apply. A third output, or bundles of different sizes, requires explicit association information. Two different allocations, A with F1/F2 and B with F3 versus A with F1 and B with F2/F3, flatten to the identical output list and feature list. The local comparison confirms that loss; Babel cannot reconstruct the allocation from the flattened data.

| Alternative | Assessment |
| --- | --- |
| Keep current scalar/role-linked records | Correct for the saved Astra assignments and repeated Transfer edges. No extension needed for them. |
| Declare all arrays parallel by position | Works for homogeneous paired columns with repetitions preserved. Applied globally it wrongly couples independent participant sets, feature sets, and paths. It cannot express differently sized per-participant lists without another convention. |
| Number role/value keys or reference indices | Can encode the allocation, but needs a documented grouping/reference grammar and exact handling of absent, repeated, or reordered groups. Extending outputOne/outputTwo repeatedly is not an open general solution. |
| Put maps into literal strings | The [Orchard PF correspondence card](../../design/visual-relations-current-lab.tsx#L7113) already uses `source=>exponent` strings, so claiming the current contract cannot express any mapping would be wrong. The native parser splits those strings and indexes positions by label. Repeated labels collapse in its Map, and malformed/unmatched links are silently omitted. This approach needs its own escaping/identity grammar and should not become a second general serialization format inside values. |
| Split one relation into several | Unnecessarily changes authored grouping and Replay timing. Not acceptable as an encoding workaround. |
| Optional explicit groups | Keeps each participant or group with its own literal values/lists; supports repeated endpoints and differently sized bundles without making simple relations verbose. This is the recommended extension for that demonstrated need, not the only theoretically possible encoding. |

The result supports Francis's conditional approval of grouping for genuine compound associations. The exact optional field and its scope rules still need review with the rest of the contract clarifications. Preserve collective groups rather than expanding them into all possible pairs. Some PF correspondence participants are authored feature/exponent literals, not syntax nodes; grouping must not create fake node IDs for them. Keep syntax anchors and literal contents distinct. One authored relation retains one moment. Do not convert existing exact Tier-1 cards, add fixed linguistic role names, insert examples into the prompt, or rewrite saved model records as a side effect.

Next: review the exact minimal contract clarification, including grouping only where needed, alongside the already agreed literal-value and chronology clarifications. Implementation remains deferred until that shared review is complete. The first implementation work should make diagnostics and data preservation reliable, then correct recognition and shared drawing inputs against these reproductions. Future regression tests must assert the intended meaning, exact anchors/content/outcome, and actual native marks or an explicit undrawn result; selection metadata and synthetic geometry alone are insufficient.

#### Association format comparison and recommendation

Historical comparison: the optional-field recommendation in this subsection is superseded by the no-new-fields repair direction below. It is not an active implementation prerequisite.

Francis requested a complete comparison and a recommendation, not successive requests to approve an incompletely considered format. This comparison supersedes the provisional choice discussion above. It does not authorize implementation. Explicit association information is necessary for the demonstrated compound cases; a field specifically named `associations` is not logically necessary. The recommendation below is based on adoption cost and clarity, not the claim that alternatives cannot encode the data.

**Requirements used to compare formats.** Preserve simple existing records; open relation, role, and literal names; exact current/prior-stage references; separately named values on the same participant; unequal feature bundles; repeated participants, values, and associations; one-to-many and many-to-many associations; collective groups without inventing pairwise links; relation-wide versus association-specific information; and one moment per authored relation. Literal PF participants must remain literals, not fabricated syntax nodes. No new fixed participant count, paired-list length, or two-output ceiling is justified. The comparison concerns these evidenced requirements, not every conceivable future linguistic data model.

**Alternatives examined**

| Format family | Can it carry the required information? | Adoption judgment |
| --- | --- | --- |
| Keep current flat fields and give each case specially named keys | Particular cases already work. General compound associations need a convention linking those keys. | Preserve these records; do not extend outputOne/outputTwo-style naming into a general format. |
| Match a value key to an anchor key | Yes for one participant or explicitly collective group with one attached literal/list. More kinds of values and repeated assignments need additional structure; identical current/prior role names also need explicit scope. | A real alternative for the simple Fission allocation example. It is not a complete replacement for compound records by itself. |
| Match named groups across nested `anchors`, `priorAnchors`, and `values` | Yes. Put each group's role maps in all relevant blocks and join them by an explicit group name. Preserve array order separately rather than relying on object-key order. | Strongest general no-new-top-level-field alternative. Adds group identifiers, joins, missing-group diagnostics, and richer shapes in every existing block. More distributed authoring than keeping a group together. |
| Parallel arrays, tuples, or tables | Yes with an explicit row convention, nested cells for bundles/groups, and a representation for absent cells. A swap can remain structurally valid while changing the association. | Suitable for constrained tabular input; not recommended as Babel's general relation format. Do not mistake equal lengths for evidence that rows were intended. |
| Richer `values` | A literal-only object keyed by a participant role handles attributes. Fully general records also need explicit association membership and scope. One complete variant nests association records containing anchors and literals inside `values`. | Viable, but the complete variant changes `values` from literal content to a mixture of literal content and node references. Existing readers stringify values. Moving the same grouping under this field does not remove its structure or adoption work. |
| Richer `anchors`, with values attached to participant descriptors | Handles participant attributes directly. Multi-participant and literal-only associations require compound records within the anchor block. | Viable after extending it, but makes `anchors` contain more than syntax references and changes every anchor reader. No advantage over an explicit group list for the full requirements. |
| Optional `associations` beside existing fields | Yes for all compared cases, using existing current/prior/literal blocks within each group. A group can have several participants or only literal content; the parent relation retains its syntax anchors. | **Recommended for Babel now.** Local grouping; no additional authored IDs or positional joins; existing simple block shapes and meanings stay intact. |
| A compound relation as a nested array whose first item is the common record and remaining items are groups | Yes. This moves the grouping into the `relations` item shape without a new field name. | Credible compact syntax, but requires a special first-item rule and makes relation items object-or-array. Less explicit than a named group list for little structural saving. |
| Split into separate relation records and add a common group/batch reference | Yes if a new grouping mechanism preserves their common meaning and single moment. Splitting alone does not. | Moves rather than removes the grouping, duplicates context, and confuses independent relations with parts of one relation. Not the encoding workaround to adopt. |
| Unified structured relation content with explicitly typed node references and literal data | Yes. This can replace the separated anchor/value blocks, with grouping wherever the authored content needs it. | A defensible clean-slate design. Broad contract replacement, reference traversal, registry, Replay, fallback, and saved-record work. Not justified for this repair when an additive format covers the current cases. |
| Explicit links into separate data, using indexes, paths, or local entity IDs | Yes. Can distinguish separately identified same-labelled literal entities and refer to a shared item repeatedly. | Best when independent reusable entity identity is genuinely required. Introduces a second reference system, reference validation, and update rules. Do not add it merely to associate an output with its feature bundle. |
| Structured strings, arrow notation, embedded JSON, or a small relation language | Yes if its grammar is specified precisely. Existing PF strings demonstrate a narrow version. | Requires another escaping/parsing/reference convention inside JSON. Not simpler to author or diagnose than ordinary grouped records. |

Inferring pairings from Stage Record, relation names, or a helper model is not an alternative encoding. It makes interpretation part of the recovery path and cannot guarantee faithful recovery of an unspecified association. Changing JSON to another serialization format does not itself supply the missing grouping either.

Standards check: JSON objects do not provide semantic member order, and duplicate object keys are not an interoperable way to preserve repeated assignments. Arrays provide ordered entries. See [RFC 8259, sections 1 and 4-5](https://www.rfc-editor.org/rfc/rfc8259.html#section-4). [JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901.html) provides a standard way to address an existing JSON value, but does not define the linguistic meaning of a link. These facts inform the comparison; they do not mandate a Babel format.

**Concrete checks.** `/tmp/babel-relation-format-comparison.mjs` compares three complete candidate encodings on 12 hand-authored specimens, including Orchard-derived Fission/PF examples and the saved single-assignment/repeated-edge shapes. All 36 encode/decode checks preserved the specified content. The report also includes 10 checks/counterexamples for lost flat-list allocation, the successful simple matching-role alternative, repeated-node overwriting in a single-entry map, position swaps, current/prior ambiguity, unmatched group names, separate parent/local outcomes, literal-only groups, and preservation of generic roles without adding linguistic meaning. These are representation checks, not production tests or evidence of model compliance. No original model output was rewritten.

The three compared complete shapes were:

1. Existing fields plus one optional association list, with each group stored together.
2. Groups split across the three existing fields, linked by common names and an explicit order.
3. Association records nested inside a structured `values` wrapper, with relation-wide literals stored separately inside that wrapper.

All three work as data formats. The first has the least linking machinery and keeps the current meaning of `values` and `anchors`. The second is the serious alternative if avoiding a new top-level field is a stronger priority than keeping each group together. The third preserves top-level field count but moves reference-bearing structure into a field currently reserved for literals. Smaller field count is not smaller overall grammar. The JSON byte counts in the temporary report are illustrative only, not model token counts, billed cost estimates, or proof of generation reliability.

**Recommended details.** Use one optional, nonempty `associations` list in a relation. Each entry is a nonempty record containing whichever of the existing `anchors`, `priorAnchors`, and `values` blocks it needs. Blocks use their existing named string/string-list grammar and exact stage scopes. In particular, an entry may contain only `values` for a literal PF association; my earlier wording that every entry needs anchors was too restrictive. The parent relation remains anchored in the current syntax. It need not repeat every association endpoint at parent level solely to make an endpoint index; Babel can derive that index without altering the authored record.

Keep each association's required participants together. Parent fields are relation-wide context, not defaults copied into entries, and entry values are not overrides of parent values. Preserve contradictory statements as authored and diagnose the specific conflict when recognized. Do not merge same-labelled literals across groups, zip arrays, expand collective groups into pairwise links, or treat repeated entries as duplicates to delete. Group order is retained for inspection; groups do not receive separate Replay times or independently earn a relation tier. Missing parts of an exact Tier-1 claim cannot become independent claims just by being placed in groups.

This solves association ownership without imposing a menu of linguistic roles or changing approved drawings. It does not supply unexpressed semantic identity: if a future record distinguishes two same-labelled literal entities and reuses one by identity, that identity must be authored explicitly, not inferred by merging text. The link/entity-table alternative above addresses that separate demand; no evidence from this run warrants imposing a second ID system on every relation. Likewise, one group list is not a claim that arbitrary nested linguistic analyses can be reconstructed from flat literals. Keep the representation change scoped to the actual relations under repair.

**Adoption work is concrete, not a promise that an optional field is free.** The current [validator](../../../server/babelParser/derivationCompiler.js#L79) admits exactly four relation fields. [Replay relation reconstruction](../../../replay/replayCompiler.ts#L6930), [plan references](../../../replay/relations/renderPlanCompiler.ts#L994), and [claim identity/evidence consumption](../../../replay/relations/tier2RelationDispatch.ts#L148) reconstruct those fields explicitly. A new field would otherwise be rejected or lost. Richer existing fields are not already supported either: both dispatchers expect flat blocks, and [native PF value readers](../../../components/TreeVisualizer.tsx#L2796) coerce entries to strings. [Neutral topology](../../../replay/relations/fallbackTopology.ts#L93) currently reads only parent anchor blocks.

Before any live prompt uses grouping: update the contract types, parser diagnostics and preservation, all current/prior reference visitors, Replay/plan copies and identity keys, claim evidence ownership, drawing inputs, saved/exported records, and inspection of unrecognized grouped content. Preserve group locations in diagnostics. Feed complete verified inputs to the existing drawings; do not flatten groups into extra authored relations or rescue malformed Tier 1. New-format references and values must remain inspectable even if their meaning is unrecognized. This is not approval to redesign Tier-3 badges or plaques. Do not reinterpret old saved key names as newly declared associations, invent links for saved outputs, or activate more than one new authoring format as competing alternatives.

**Decision for review:** recommend the optional group list, keep existing simple records, and withdraw the suggestion that matching names alone solves the whole problem. If adopted, implement diagnostics and lossless passage through the system before changing the prompt, then update claim recognition and shared drawing inputs. The broader audit and its pending linguistic/Replay decisions remain open. No implementation, provider call, or new UI design was authorized by this comparison.

**Subsequent agreement:** Francis accepts the optional group-list direction. He also clarified that elegance includes clear, simple model instructions that do not make authoring the derivation unnecessarily difficult. Implementation convenience and compatibility are not sufficient reasons to choose a format. Keep ordinary relations simple and define the grouped case using the same familiar blocks. The detailed renderer evidence rules in this audit are not additional instructions to paste into the model prompt. The comparison establishes representational feasibility, not which format models author most reliably. Exact prompt wording still needs review; no live prompt edit, production implementation, or provider call follows from this agreement during grilling.

#### Current direction: repair without new fields

Francis subsequently questioned the additional field and a proposed unified-content alternative, emphasizing that the existing relation system was built around anchors and values. He agreed to retaining the current fields and fixing the instructions and implementation, provided the full problem set remains addressed. This supersedes the earlier optional-group agreement for this repair. Keep `relation`, `anchors`, optional `priorAnchors`, and optional `values`; do not introduce `associations`, a replacement `content` format, richer container types, or disguised grouping/reference syntax as an unreviewed shortcut.

The saved Astra single assignments and repeated Transfer edges already fit these fields. The original failed Fable `values` arrays expose an omitted outer-container definition, not a missing association structure. A general format for arbitrary compound associations is a separate design question and is not a prerequisite for correcting those outputs. The existing Fission/PF cards also already express their specific associations, although their implementation and generalization expose the problems recorded above. Preserve those distinctions: neither the original failures nor all broader stress-test findings are solved merely by keeping or changing the field names.

All 39 audit findings remain tracked. In particular, finding 33's ambiguous pairing cases remain open; no global positional pairing, matching-key convention, or inferred association is adopted here. Correct data loss independently of deciding how an ambiguous record should be represented. Do not silently drop a finding, invent missing information, or treat a successful fixture as proof that the general defect is fixed. Fable's missing closing delimiters still have no demonstrated generation cause or guaranteed prevention. That uncertainty is not evidence for adding fields or approving automatic repair.

**Draft clarifications for review, not live prompt text.** These keep the existing field types and the open ontology. They replace the affected explanations when approved rather than being appended beside contradictory instructions:

- A relation has a `relation` string and an `anchors` object. It may also have `priorAnchors` and `values`. Relation names, anchor roles, and value names are open. `anchors` is a nonempty object whose named entries are exact current-stage node IDs or nonempty lists of those IDs. Resolve them in the expanded workspace, including carried subtrees.
- `values`, when present, is a nonempty object with named entries. Each entry contains a string or a nonempty list of strings. Put the relation's literal content in these entries, including literal content also mentioned in its name. Use anchor blocks for syntax references. Omit `values` when the relation has no literal content to record.
- `priorAnchors` has the same named node-ID/list format as `anchors`, but resolves only in the immediately preceding stage. Use it when the relation explicitly compares with or continues those earlier witnesses. A reference to a node written later inside the current stage's JSON is still a current-stage reference, not a reference to a future stage.
- List relations in the derivational order established by `stageRecord`, with prerequisites before the relations that depend on them. This clarifies the already agreed chronology; it does not ask for model-authored structural micro-steps. Keep the existing exclusion of claims fully expressed by ordinary branching, without adding relation-name exclusions.
- A terminal may retain its lexical content in `word` while being marked `silent: true`. Use `tokenIndex` only when that terminal pronounces an input token in the current stage. A retained `word` does not by itself make the occurrence pronounced. An intentionally wordless terminal may remain wordless. This separates retained text from pronunciation without choosing a trace/copy analysis for the model.

The literal wording must not silently disallow empty strings currently accepted inside `values`, prescribe particular role names, add provider schemas, or turn the audit's recognition requirements into a model-facing menu. The silent-word clarification must also replace the conflicting final checklist clause. Subtree silence, simultaneous claims, and handling previously saved inconsistent orders retain their recorded open questions; these short drafts do not settle them by omission.

Next work is review of these bounded wording changes followed by the agreed implementation order: preservation and precise diagnostics, then reference/claim recovery and Replay ownership, then drawing/UI corrections with their remaining design decisions. Verify each fix against the original evidence and independent regression cases. Do not declare the full audit resolved or the contract empirically qualified before that evidence exists. No live prompt, production code, provider call, or Tier-3 redesign has changed during this decision.

#### Stage preservation and diagnostics

Francis subsequently approved this first implementation and clarified that retaining the fields is a working direction, not a permanent ban on redesign. Any proposed replacement must demonstrate simpler model instructions and reliable interpretation, including compatibility with the approved drawings and saved records. No alternative is adopted by that clarification.

Stage conversion now reports a malformed field before expanding subtree references. It no longer returns null for a bad stage and filters that stage from the history. The original input is not mutated. The error carries the original analysis/stage index, exact field path, processing step, observed value, expected format, and a readable explanation. Genuine missing subtree references report their actual reference path instead of a generic error. These details survive the production generation error wrapper and qualification receipt.

Stage Record validation also checks the actual string type before normalization. Numbers, booleans, arrays, and objects must not be converted into prose. Focused regression cases preserve the original payload and report the original stage's `stageRecord` field, observed value, and expected nonblank string. Rechecking the four saved outputs retains Astra's seven and six stages and identifies the original Fable `values` errors in stages three and four, respectively, without changing saved bytes or parsed input.

The internal behavior is explicit: a malformed record does not produce a shortened normalized analysis or Replay. Compilation stops with its diagnostic; the existing evidence path retains the raw answer. This is not a grammaticality test, an automatic correction, a recovered Fable rendering, or a new public error design. The existing API raw-output size cap is unchanged; complete saved-run files remain the evidence for these four outputs. General retention policy remains separate work.

The qualification path now also returns a separate inspection record when readable JSON cannot complete compilation. It retains the parsed payload, original analysis and stage positions, raw-output hash, and JSON-repair diagnostics. Each workspace uses the production subtree-expansion function, independently of relation-field validation and final-sentence matching. Relation values are not renamed or wrapped. A broken workspace retains its diagnostic and blocks subsequent expansion rather than allowing stale history; no stage is omitted. The dry-run writer saves `inspection.json`, and the review builder includes it in Diagnostics. This is inspection data, not a normalized analysis or compiled Replay.

Both original Fable responses produce five expanded inspection workspaces. Minimalism uses the existing documented closing-delimiter repair; X-bar uses none. Original raw files remain unchanged. Regression tests cover malformed values, preserved relations, repair provenance, separate analyses, sentence mismatch, and blocked expansion after a broken workspace. The full offline gate passes with 1,030 tests.

`scripts/buildWorkspaceInspection.mjs OUTPUT.html INSPECTION.json [...]` builds a self-contained local stage viewer. It uses `TreeVisualizer` and the shared forest-to-canvas function, with no authored stages passed into Replay or relation compilation. Stage selection shows the expanded workspace and original Stage Record; original fields and repair diagnostics remain expandable. This is syntax-only stage inspection, not repaired Replay or relation coverage. The page embeds its fonts and data and blocks network connections. An additional export test passes for exact data preservation, script escaping, and self-contained output. The page has been built for both Fable records; browser verification remains pending permission. No production renderer, prompt, or public error-policy change accompanies this viewer.

Prompt review applied the bounded clarifications above to the existing instructions, including their repeated checklist and the input-token wording in prompts.js. The outer values object and individual string/list entries are explicit. Current anchors and immediate-prior anchors have distinct scopes; same-stage serialization order is not stage chronology. Relation order follows Stage Record. Silent terminal words may remain without becoming pronounced or requiring a particular copy/trace notation. No model-facing association field, linguistic vocabulary list, example analysis, provider schema, or geometry instruction was added.

The exact saved-output check produced:

| Original output | Current diagnostic or result | Evidence preservation |
| --- | --- | --- |
| Astra Minimalism | Seven normalized stages, as before | Raw bytes and parsed input unchanged |
| Astra X-bar | Six normalized stages, as before | Raw bytes and parsed input unchanged |
| Fable Minimalism | Stage 3, `$.derivationStages[2].relations[0].values`: expected a nonempty named object; received an array | Raw bytes and parsed input unchanged. Existing ingress still records only `]}` appended at byte 6819. |
| Fable X-bar | Stage 4, `$.derivationStages[3].relations[1].values`: expected a nonempty named object; received an array | Raw bytes and parsed input unchanged; no JSON repair |

Regression coverage in `tests/derivationDiagnostics.test.mjs` uses reduced reproductions of both failures, not rewritten raw model outputs. It covers subsequent malformed fields at their original stage, invalid stages followed by a complete final tree, a genuine missing refId, duplicate IDs introduced by a carried subtree, second-analysis locations, retained silent words, open literal content, qualification receipts, and the actual route using a local stub with one generation call. Fixing a shape for inspection in a test is explicit; normalization never performs that correction.

Verification passed: `npm run verify:all` completed typecheck, all 1,027 tests, and both committed parse-contract checks. The new diagnostic file contains 12 regression tests. The first full check caught a prompt assertion tied to superseded wording; it now checks the explicit object/entry requirement and literal-content instruction. No fixture was regenerated. Passing these checks does not establish correct remaining relation drawings or reliability under a new paid generation.

The changed prompt source hashes are `systemInstruction.js`: `9b44a65f43eeda3133f9dd43a849789aaa564a42c29aa1fa8467fd33334c4201`, and `prompts.js`: `ad9dd84631855ed2fcac0e863b24936f239e295da2cf8bc7817f367d227ae731`. Generation records already hash the exact built system instruction and input prompt; that mechanism remains in place. The old run's requests are unchanged and do not become evidence of model performance under the clarified instructions. No provider call or browser was started. Provider transport, renderer code, JSON repair policy, and retry policy are unchanged.

#### Tier-2-only approvals and residual evidence

Francis approved the following smaller combinations for Tier 2 only. They do not
become Tier 1 or relax any complete curated Tier-1 recipe:

- An explicit Control dependency with its exact participants may use the existing
  Control connector without an additional domain rectangle.
- Explicit covert movement with its exact source, landing, identity and direction
  may use the existing covert path without an additional scope outline. Movement
  timing still requires the preceding state and authored chronology.
- Explicit idiomatic cointerpretation with its exact grouped chunks may use the
  existing underlines without an additional interpretation-domain bracket.
- An explicitly identified transferred domain may use the existing transferred-
  domain mark without an accessible-edge outline. Plain complement membership
  does not establish Transfer.

These approve independently complete smaller claims, not arbitrary fragments of
incomplete claims. Missing structure, ambiguous participants, conflicting domain
information and incomplete exact Tier-1 recipes keep their existing safeguards.
No model-facing role menu, new field, or theoretical default is authorized.

Francis rejected proposal 3, which would have suppressed an additional fallback
connector merely because the recognized part of the relation already rendered.
The proposal is withdrawn. One authored relation can contain several claims or
facets, with different tiers. A successful Tier-1 or Tier-2 drawing does not
exhaust the whole relation. Recognize independently supported additional pieces
through Tier 2 where possible; preserve the unresolved remainder through neutral
Tier 3. Do not call unrecognized content disposable context or silently move it
out of the drawing because no matcher consumed it. Neutral fallback preserves
the authored evidence without asserting a new recognized linguistic dependency.

The Internal Merge example's question-head and earlier thematic-occurrence
anchors must therefore remain accounted for. Their presence alone does not
establish a particular extra Tier-2 dependency, but failure to recognize one
does not authorize dropping their fallback. Improving mixed-tier composition,
numbering and plaque layout is separate design work; current Tier 3 stays intact.

The four cases are implemented as part of the shared claim-pipeline work below.

#### Shared claim pipeline

The implementation addresses shared failures rather than matching the four
example strings. Model-facing fields, prompt, provider transport, saved analyses,
Tier-1 signatures and Tier-3 drawing design are unchanged.

| Failure | Owning layer and fix | Regression evidence |
| --- | --- | --- |
| Generic `antecedent`/`silentSubject`, chunks, source/target or complement roles could imply a specific claim. | Vocabulary now distinguishes context-dependent aliases from wording that identifies the meaning. The facet evaluator checks that evidence before using a specialized drawing. Exact Tier 1 still supplies its registered context. | Positive and near-miss cases, including shared lineage without explicit covert movement. |
| Optional enclosure and core drawing were inseparable. | Control, idiom, covert movement and transferred-domain recipes earn the smaller approved pieces. Supplied domains must still be valid. Control and idiom painters no longer require a rectangle/bracket to paint their connectors/underlines. | Plan and production-painter tests, before/after browser captures, full Control/idiom comparisons. |
| Empty arrays were treated as absent fields. | Shared normalization retains empty fields' candidate meanings. An optional field supplied empty fails its cardinality check and is preserved. | Empty string, empty array, missing reference and incompatible domain tests across all four cases. |
| Separate arrays could be concatenated into a guessed group or pairing. | The evaluator requires consistent arrays under equivalent keys for grouped idioms and positional role/value associations. Different arrays remain unresolved. | Distinct idiom groups, competing argument arrays and competing role-label arrays. Repeated entries within one authored array stay intact. |
| Lowering and Replay repeated interpretation independently. | Both now consume dispatch's interpreted evidence. A custom-vocabulary test proves that lowering uses the accepted binding instead of repeating default lookup. | Shared-evidence test, all 69 pieces, existing movement checks and covert Replay check. |
| A complete Tier 1 claim could absorb extra anchors without drawing them. | Independent Tier 2 claims consume their own evidence. Remaining anchors receive a separate Tier 3 claim and `unrecovered-evidence` diagnostic. They are excluded from Tier-1 identity, replacement refs and prior cues. | One envelope containing Tier 1, Tier 2 and Tier 3, plus backward-continuity isolation. |
| Covert movement timing depended on one registered name. | A complete covert facet supplies source, landing and earned transition to Replay. The landing and necessary parent appear together, without substituting an overt arrow. A conflicting prior source stays unresolved with the actual node named in diagnostics. | No early landing, unchanged-stage negative, conflicting prior reference and exact output-kind checks. |
| An open SVG Control path acquired a black triangular fill. | The existing connector and open arrowhead explicitly use no fill. | Browser computed-style check and captured production drawing. |

These rules improve deterministic interpretation; they do not establish a general
natural-language understanding of every possible relation or field name. Unknown
wording, unsupported semantic detail and ambiguous associations still need neutral
fallback. The all-recipe tests check the existing 52 recipes and 69 pieces, not
the linguistic correctness of all imaginable descriptions. No helper model or
automatic linguistic rewriting was added.

Current saved-output coverage, using the preserved Astra records and the previously
approved Fable inspection copies:

| Analysis | Authored relations | Tier 1 claims | Tier 2 claims | Neutral primary/remainder claims |
| --- | ---: | ---: | ---: | ---: |
| Astra Minimalism | 11 | 3 | 6 | 9 |
| Astra X-bar | 11 | 0 | 9 | 7 |
| Fable Minimalism inspection copy | 5 | 2 | 3 | 0 |
| Fable X-bar inspection copy | 9 | 0 | 6 | 8 |

Claim counts can exceed relation counts. The 24 neutral claims are not failed
analyses. They include extra licensing/context anchors, literal qualifiers and
unrecognized dependencies. They remain available for the mixed-tier design
discussion; successful core rendering is not permission to discard them.

Fable's first review identified residual anchors contaminating primary identity,
conflicting covert prior-source evidence being consumed, and a residual borrowing
the primary's backward witnesses. All three were reproduced, corrected and tested.
Its reported Transfer test contradiction was not reproduced: that existing test
earns independent edge outlines, not the unsupported transferred-domain mark.
Authored field spelling in evidence references is intentional, so diagnostics and
saved qualification records can identify the original field exactly.

The final Fable review approved the Control/idiom painter changes and raised two
further prior-reference concerns. End-to-end reproductions did not substantiate
the claimed silent loss: covert prior witnesses remain in the facet identity and
original relation reference, and unresolved IDs already produce exact
`prior-anchor-unresolved` diagnostics with no backward or replacement cue.
Production Tier-1 `priorAnchors` is intentionally open literal payload, not a
closed set of current-stage drawing roles. Two regression tests now cover these
boundaries, including a legitimate reference to an earlier silent landing; the
suggested blanket ban on prior landings was not adopted. The review's contextual
alias observations describe the intended meaning boundary. An injected lookup
alias alone cannot promote context into explicit linguistic meaning.

Verification: the broad offline gate passes typechecking, 1,421 tests and both
committed parse-contract fixtures. All 55 canonical cards remain Tier 1 in the
plan/geometry checks. The integrated production-app/review pass checked 1,002
states on desktop and mobile, including every saved Replay frame, the four smaller
drawings, full Control/idiom drawings and zoom captures. It reported no browser
errors or attempted external/provider requests and closed its browser. These
checks do not certify unresolved plaque composition or all linguistic analyses.
Local screenshots and Replay recordings are under
`/tmp/babel-claim-pipeline-9BuSQC`; it is temporary evidence, not a repository asset.
No new Babel generation was made. Fable review used the existing Claude Code
subscription, not Babel's provider keys. Numbering, stacking, long-plaque layout,
binding notation, conflicting authored orders and public failure policy remain open.

#### Remaining fallback inventory

This is the follow-up to the shared-pipeline implementation, using current
dispatch, plan compilation and Replay on all 36 saved relation objects. It is
an audit, not a change to rendering or acceptance policy. Stage/relation/frame
numbers below are one-based and refer to the current compiled Replay, not older
screenshots elsewhere in this audit.

The inputs are the preserved Astra bundles and the previously approved Fable
inspection copies in `/tmp/babel-batch4-offline-me5zTk`. Those files are
**offline provider-stub results**, not new provider responses: their `request`
describes the offline replay of old evidence under the current code. It must
not be cited as the prompt that originally produced the saved answer. Original
raw hashes remain in their source metadata. No new provider calls or browser
sessions were made for this follow-up.

There are 24 neutral primary/remainder claims across the 36 relations:

- 10 relations have only Tier 3.
- 14 have a recognized drawing plus a Tier-3 remainder.
- Three of those remainders have no current anchors and produce no canvas marks.
  Two retain only values; one retains a previous-stage witness.
- Fable Minimalism's five relations have no neutral remainder.

These numbers measure code ownership, not linguistic correctness or complete
semantic interpretation. In particular, a title or a single prose value can
contain several assertions that the coverage counter does not distinguish.

**Astra Minimalism: all nine remainders**

| Stage / relation / frame | Current result and remaining evidence | Cause and disposition |
| --- | --- | --- |
| S4 R1 F20, Internal Merge | Movement is Tier 2. `licensor: transitiveV`, chain description and pronunciation remain neutral; one badge on v. | The movement recipe identifies occurrences, not a licensing dependency. v is an authored participant, but no complete extra licensing primitive is established. Retain it; do not automatically connect it to a guessed licensee. |
| S4 R2 F21, Transfer | The transferred VP and both edge outlines are Tier 2. Only the locality sentence remains neutral; zero fallback marks. | The sentence explains inaccessibility. It does not author an attempted access source/target for the blocked-access drawing. This is preserved literal content, not failed Transfer geometry. |
| S5 R1 F25, Agree | Tier-1 plaque plus a badge on `inactiveIntervener: edgeWhichD`. | An explicitly inactive intervener must not become a positive intervention/blocking mark. The participant and qualification remain relevant; no approved independent inactive-intervener drawing is established. |
| S5 R2 F26, Internal Merge | Movement is Tier 2. `licensor: finiteT`, A-chain, EPP trigger and pronunciation remain neutral. | Same licensing/occurrence distinction as S4 R1. The wording does not authorize treating the subject's movement as an additional generic probe-goal relation. |
| S6 R2 F30, Do-support | PF plaque on `raisedT`; badge on `lexicalVerb: buyV`. | The realization sentence explicitly mentions unchanged buy and stays on the plaque. The extra anchor relates that sentence to V but does not identify another realization or movement. Preserve the connection to the parent relation; do not delete V because the PF plate drew. |
| S7 R1 F32, Wh-Agree | Tier-2 feature path; `nonInterveningSubject`, valuation and locality remain neutral. | Probe/goal establish the path. Nonintervention is not intervention. Singular `valuation` is not the recognized feature-row key, and the neutral drawing does not print the prose. Literal presentation and semantic recovery are separate issues. |
| S7 R2 F33, Internal Merge | Tier-2 movement; remaining `licensor: questionC` and `thematicOccurrence: objectDP` form a neutral two-anchor connector. | The connector comes from applying fallback topology after subtracting movement endpoints. It is not another movement and not proof of an independent C-to-thematic-position dependency. The full relation must remain its context; changing this composition requires the shared-anchor decision below. |
| S7 R3 F34, Transfer | Entire relation is Tier 3. | Two independent blockers: transferred status appears in the title/completion sentence, not an explicit transferred-domain role; and `questionC` is inside `complexC`, whereas TP is a sibling of `complexC`. The structural check incorrectly requires the anchored head itself to share TP's parent. Fixing either blocker alone does not recover this saved case. |
| S7 R4 F35, Convergence | Entire relation is Tier 3; root badge. | `root` is not an analysis-anchor alias; judgment is a sentence, not an explicit glyph. Preserve the authored judgment and surface statement. Do not infer a success symbol or suppress the relation because the tree is complete. A latent verdict-slot issue is described below. |

**Astra X-bar: all seven remainders**

| Stage / relation / frame | Current result and remaining evidence | Cause and disposition |
| --- | --- | --- |
| S1 R1 F13, wh-feature percolation | Entire relation is Tier 3; determiner-to-nominal neutral connector. | Roles identify D and NP; `[+wh]` is present. Those category roles alone do not specify directional feature propagation. No dedicated approved percolation recipe was found. Mapping determiner/nominal globally to source/target would invent direction in other relations; focus projection is not a substitute. |
| S4 R1 F29, I-to-C movement | Movement and gap notation are Tier 2; complex-head `host` and constraint remain neutral. | Recovery correctly chooses raised I as the landing, but has no separate output ownership for the anchored containing complex. The host is structurally identifiable context, not an extra moved occurrence. Retain it while resolving how context attaches to the movement claim. |
| S4 R2 F30, head government | Gap notation is recovered; governor and ECP qualification remain neutral. The gap mark can already persist from F29. | There is no approved government-specific recipe. Subtracting the trace from this envelope leaves only a governor badge, so the neutral remainder no longer depicts both participants together. The raw relation still retains both. This exposes shared-evidence composition, not a missing movement alias. |
| S5 R1 F32, wh licensing | Entire relation is Tier 3. | `operator` and `interrogativeHead` plus `[+wh]` do not select a known directed feature recipe under the current evidence rules. Do not convert every interrogative head/operator pair to probing, movement or valuation. Authored order remains the separately recorded issue. |
| S5 R2 F33, A'-chain | Movement is Tier 2; Theme, accusative and Subjacency values remain neutral with zero fallback marks. | The chain is known; these values qualify it. They do not identify a new theta assigner or Case assigner. Reusing the two movement endpoints for a Case arrow would be wrong. Preserve the qualifications without calling them three missing drawings. |
| S5 R3 F34, lexical government | Entire relation is Tier 3. | Governor and trace roles describe government, for which no approved recipe was found. The `trace` anchor names a fully structured silent NP; gap typography deliberately does not replace that whole shell with a leaf trace. This is not a malformed node or missing lower occurrence. |
| S6 R1 F36, do-support | PF plate is Tier 2; `priorAnchors.abstractHead: raisedI` remains neutral. No current marks; prior-only topology. | `abstractHead` is not interpreted as this PF facet's prior realization host. The same ID proves the temporal identity here, but an abstract head in general need not be a realization input. Preserve the explicit earlier witness; improve temporal ownership without creating an equation or extra generation. |

**Fable X-bar: all eight remainders**

| Stage / relation / frame | Current result and remaining evidence | Cause and disposition |
| --- | --- | --- |
| S2 R1 F14, theta-marking (Theme) | Entire relation is Tier 3. | Theme exists in the title, not values; `assigner` is not a predicate-role alias for theta-grid recovery. Supplying either the literal or predicate role alone in an isolated control still fails; supplying both earns the existing grid. This demonstrates two missing machine-readable distinctions, not an inability to draw one argument. |
| S2 R2 F15, accusative Case under government | Entire relation is Tier 3. | `governor`/`caseMarked` do not bind the Case endpoints; accusative occurs only in the title. Isolated roles-only and literal-only controls both fail; both together earn the existing solid Case arrow. Government alone is not synonymous with Case assignment. |
| S3 R1 F27, theta-marking (Agent) by predication | Entire relation is Tier 3. | Predicate/argument already fit the grid. The Agent literal appears only in the title. A control adding the explicit literal earns the grid. Do not infer Agent from subject position or conflate the title's predication claim with all possible predicate/argument relations. |
| S3 R2 F28, nominative Case under government | Entire relation is Tier 3. | Same role/literal boundary as S2 R2. Do not infer nominative from I or from the subject's position. |
| S4 R1 F31, I-to-C head movement | Movement and gap notation are Tier 2; `landingHead: c1` remains neutral. | c1 is the containing complex C, not the moved I i2. Recovery correctly distinguishes them. There is no independent existing mark earned simply by naming the complex; retaining its relation to the path is a context-ownership problem. The ECP assertion in the title is not separately counted as a facet. |
| S5 R1 F34, wh-movement | Movement and gap notation are Tier 2; `landingSite: cp1` remains neutral. | CP contains the actual landing dp3. Do not move CP or draw a second movement. The site is useful authored context, not automatically a new dependency. Subjacency in the title is not a separately interpreted proof. |
| S5 R2 F35, Spec-head agreement / wh-Criterion | Entire relation is Tier 3. | `whOperator`/`whHead` and the title describe the intended dependency for a reader, but there is no matching role-directed recipe. Geometry cannot decide a probe/goal direction or replace Spec-head agreement with a different linguistic account. Keep neutral pending supported semantic interpretation. |
| S5 R3 F36, antecedent A'-binding / ECP | Binding path is Tier 2; `lexicalGovernor: v1` remains neutral. | Binder/variable suffice for the approved binding path. The extra governor does not suffice for an approved government drawing. Subtraction also separates that governor from the variable it governs; retain the full relation context rather than pretending the badge is a complete government analysis. |

**Connected implementation findings**

1. **Evidence ownership is not complete claim interpretation.**
   `tier2RelationDispatch.ts` subtracts consumed anchor/value entries. That is
   useful bookkeeping, but an entry is not necessarily one linguistic assertion.
   Several assertions can share an anchor or occur inside one sentence/title.
   S4 head government and Fable's binding/government example prove the shared-anchor
   case. Astra's movement licensing and chain qualifications show the converse:
   an unused field need not describe an independent drawable dependency.
   Keep the original envelope associated with every part. Do not make consumed
   anchors semantically unavailable to another supported claim, and do not
   invent a new claim from leftovers merely because they form two scalars.
   The current code preserves the raw record; this finding concerns interpretation
   and display composition, not lost bytes. It reopens no Tier-1 requirements.

2. **Most fallbacks still lack an explanation of why recovery stopped.**
   Only three of the 24 entries have an `unrecovered-evidence` or failed-facet
   diagnostic explaining a relevant blocker. `facetDiagnostics` is filtered to
   recipes whose required roles and values are already present. Missing aliases,
   missing literal fields and unregistered-only cases therefore usually report
   nothing useful. Transfer's bare `check:transfer-configuration` also hides the
   actual parent mismatch. Internal reporting should list exact original fields,
   supported meanings, unresolved remainder, and the specific failed check when
   there is a supported candidate. Do not dump 52 unrelated recipe failures or
   pretend an unknown term has a known intended meaning. Add no public warning.

3. **Transfer checks cannot yet follow an explicitly anchored head through a
   complex head.** `transfer-configuration` looks for an immediate common parent
   of head and complement. `questionC -> complexC -> coreCP`, with TP under
   coreCP, is the exact missed shape. A control changing only `complementDomain`
   to `transferredDomain` still fails; also pointing the test at `complexC`
   passes. Those controls are not repaired analyses. The fix must verify the
   anchored head's containing complex/projection in the authored tree, reject
   unrelated/ambiguous ancestors, and never assume every C is a phase. Preserve
   supplied head evidence rather than dropping it to make the optional-head
   recipe pass. The separate explicit-transfer meaning boundary remains.

4. **Name/prose interpretation remains an unsolved policy and capability limit.**
   Generic participant names do not establish every meaning; the finite matcher
   also misses meanings clear to a human from the whole relation. Fable's four
   theta/Case descriptions and the three wh descriptions expose this boundary.
   The clean prompt already asks for literal content in values; it does not make
   the old records contain it. Do not retroactively blame the models using an
   offline stub's newer prompt. No title scraping, helper model, closed ontology,
   new contract field or automatic semantic rewriting was authorized here.

5. **A verdict alias change would expose an existing literal/glyph mismatch.**
   In an isolated control, changing Convergence's `root` role to `analysis`
   completes `judgment.verdict`. The lowerer passes the entire sentence
   `Grammatical matrix constituent question.` as its `judgment`, the slot used
   for the verdict glyph. It does not infer a star/check, but it does treat
   prose as glyph content. The original record remains neutral. Do not add the
   root alias as a stand-alone fix. Separate literal judgment presentation from
   explicit glyph evidence without restricting which linguistic judgments the
   model may make.

6. **Tier coverage must distinguish retained content from visible ink.**
   The two value-only residuals draw no marks because `fallbackTopology.ts`
   intentionally ignores values. The prior-only residual also has no current
   badge. Their literal content remains available through the complete relation
   in Replay/inspection, but no new plaque is implied. Conversely, every fallback
   drawn in these four records receives instance 1 because the counter resets
   by name within the stage. That is an instance counter, not confidence, tier,
   number of problems or a syntactic index. The existing numbered design is
   unchanged. Reporting must not equate these records with failed analyses or
   promise all retained prose is printed on the tree.

Checks outside the fallback set: Astra's two Case relations now lower as solid
`case-assignment` paths with accusative/nominative labels, not dotted collection
curves. Its two theta relations produce one-row grids with the correct literals.
All eleven saved movements produce their recovered paths, including the five
Fable movements; extra fallback does not mean movement itself failed. Fable
Minimalism's five relations receive supported drawings, but this does not certify
every assertion in their Stage Records. Repeating a gap mark can be visually
coalesced with its earlier instance; that is not evidence the later government
claim was fully interpreted.

Reproductions: `/tmp/babel-fallback-audit.mjs` and `.json` record every relation,
resolved anchor, current Replay frame, candidate result, compiled item and
diagnostic. `/tmp/babel-fallback-controls.mjs` and `.json` contain 12 isolated
input controls, including the complex-head and verdict checks. They alter only
in-memory copies to locate blockers, never the saved records. No production
files, committed tests, prompt or Tier-3 design changed; documentation-only
changes do not require rerunning the full gate. These are code/plan checks, not
another visual sign-off.

Next implementation order: make the internal fallback reasons complete and
specific; fix the independently reproducible complex-head structural check;
then settle shared-anchor/context accounting before changing mixed-tier layout.
Recognition from free prose and the literal/glyph boundary require an explicit
design decision, not an expanding list of accidental aliases. Keep all unresolved
content while those decisions remain open.

#### Broad relation-pipeline pass

The approved follow-up reviewed the existing rule set, not only the saved
Transfer example. No prompt, model-facing field, saved analysis or Tier-3 visual
design changed. Findings and verification distinguish implementation defects
from meanings the current machinery cannot establish.

| Finding | Change and boundary |
| --- | --- |
| Most neutral claims had no useful internal explanation. | Every neutral primary/remainder now has one `claim-evidence` report with full authored context, exact fields, original item indices and relevant candidate failures. A missing role no longer prevents reporting why its candidate failed. Candidates are possibilities, not claims about the model's intent. Their failures are grouped rather than emitted as a dozen separate warnings for a generic `target`. No public warning was added. |
| Field subtraction obscured shared context. | Dispatch now reports all owners of every original field/item and retains the complete relation beside that accounting. An unused field is not treated as proof of an independent dependency. This does not yet change the neutral drawing's geometry or reconnect a governor badge to an already-consumed trace; that is still a composition decision. |
| Partial-array references used positions in the shortened remainder. | Tier-1 context and Tier-3 remainder references now retain original positions. A Tier-2 outcome at index 0 and qualifications at indices 1 and 2 remain traceable to those exact original slots. No array or literal is rewritten. |
| An independent Tier-2 judgment could remove the registered primary's outcome. | If the registered render family uses outcomes, its authored `values.outcome` remains available while Tier 2 also uses it. A failed Binding can no longer turn into the renderer's licensed default merely because a sibling judgment used the same value. Tests cover both positive and negative outcomes. Other values are not indiscriminately copied back into the primary. |
| Transfer demanded an immediate head/domain sibling relationship. | Its check now follows an unambiguous same-category head complex and projection spine. Tests vary C, v, P and an arbitrary Z label, with two accessible edges, unrelated ancestors, separate workspaces, nested higher heads and edges inside the transferred domain. P is not stripped to an empty category. The walk stops at a different higher head rather than accepting its edge for the lower phase. No phase inference from labels was added. |
| The review export read a nonexistent output-identity property. | It now exports the same `key` that dispatch and production lowering use. A regression compares review claim identities with the emitted plan, not merely with a nonempty field. |
| The Binding ellipse covered the syntax with an opaque black fill. | The targeted outcome screenshot exposed this pre-existing SVG-default bug. The production Binding ellipse now explicitly uses `fill="none"`, matching its outline design. This affects both tiers using that painter, without changing geometry or Tier 3. A focused source guard and real-browser computed-style check cover the regression. |

**Breadth and proof.** All 52 recipes are exercised with 176 required-anchor
removal/unresolved-reference variations, 22 required-value omissions, field-order
and open-title variations, and unknown additional fields. Existing checks still
exercise all 69 output pieces and all 55 canonical Tier-1 cards. These generated
checks prove consistent execution of the declared rules; they are not independent
linguistic certification of those rules.

The 86 hand-written audit cases exercise 37 of the 52 recipes. Their compiled
drawings remain unchanged against the pre-pass baseline. All 36 saved relations
retain their compiled drawings, tiers and Replay frames. All 24 neutral remainders
now have evidence reports; they have not been suppressed or relabelled as success.
The saved final Transfer remains neutral because its explicit transferred-domain
meaning is still missing from machine-recognized fields. The structural repair
does not silently reinterpret `complementDomain` or the completion prose.

The integrated production-app/review browser pass covered 1,084 desktop/mobile
states, all saved Replay frames, the smaller Tier-2 pieces, mixed-tier records,
the complex-head regression, and zoom/pan checks. It reported no runtime errors,
horizontal page overflow or provider requests. Screenshots show the existing
SOD mark replacing the incorrect neutral fallback in the synthetic complex-head
case. This is regression evidence, not a claim that mobile readability or all
remaining plaque composition is solved. The final offline gate passed 1,432
tests, typechecking and both parse fixtures. Temporary evidence is under
`/tmp/babel-relations-wide-NAAdqH`; it is not a repository asset.

Fable's read-only Claude Code review identified the P-label regression, shared
outcome loss, CP-recursion risk, partial Tier-1 array accounting, noisy diagnostics
and missing review identities. Those were reproduced and corrected. Its report
predated the final corrections; final verification was performed by the primary
agent, not a second Fable sign-off. The head's lack of an independent glyph is
not itself a defect: it verifies the configuration and remains in the full
relation. The approved Tier-2 Transfer drawing need not invent a phase-head arc.

**Additional open findings from the broad review.**

1. Distinct unbounded alias groups can still be combined. For example,
   `occurrences: [a,b]` and `copies: [c,d]` can become one four-member identity
   drawing. Paired associations and idiom groups already refuse this merger,
   but that does not settle every grouping rule. A blanket ban would also break
   the approved separate `accessibleWhOccurrence` and `accessibleSubject`
   witnesses. Distinguish one joint group from independently drawable members
   before changing all unbounded roles. Do not silently choose one group.
2. Some negative drawings need stronger evidence. An unregistered relation with
   `source`, `target` and `transferredDomain`, with the target inside that domain,
   currently earns `transfer.access` without an outcome. Its production drawing
   includes a blocking cross. The intervention drawing also paints a cross while
   its recipe permits an absent outcome. Presence in a domain or being an
   intervening participant does not, by itself, establish an authored failed
   dependency. Decide how explicit negative role wording and outcome values
   establish the complete claim; do not add failure judgments by default.
3. `operator`, `variable` and `domain` can earn both the elliptic Binding
   presentation and operator-variable drawing. The shared-participant test proves
   that evidence remains available to both existing rules, not that those must
   always count as two independent linguistic claims. Their semantic overlap
   needs a deliberate rule before suppressing either output.
4. Free-prose interpretation, literal judgment versus a glyph, and how mixed-tier
   context remains visible are still open. Finite role lookup cannot guarantee
   recognition of arbitrary phrasing. The new reports make this limit observable;
   they do not solve it through a hidden model, closed ontology or title scraping.

These are the next connected interpretation decisions, before changing Tier-3
numbering, stacking or plaque placement. The original derivations remain intact.
No fresh Babel provider generations were made. The targeted post-review browser
check confirmed the shared Binding outcome changes from the erroneous licensed
state to the authored failed state, and its ellipse has no fill, on desktop and
mobile. The Fable review and all browser checks exited. The pre-existing user
Vite server on port 5177 was left running; no new server was started.

#### Anchor-list contract clarification

Francis approved the general rules against guessed grouping, unauthored failure
marks and duplicate claims that discard other content. He then identified a
missing prerequisite: the model cannot reliably follow an unstated grouping
convention. Following his approval, the two-sentence clarification below is now
in the live shared instruction for both frameworks. No examples, fixed role
names or new fields were added. Dispatch, saved records and Tier-3 presentation
remain unchanged by this clarification.

The live Relations section defines anchors as node-id strings or nonempty lists
of node-id strings. It keeps names open and preserves meaningful array order and
repetition. At inspection time it did not explain list grouping; participant/value
pairing remains undefined after this addition. The per-request prompt contains only the sentence
and indexed input tokens, so it adds no such convention.

Five direct, provider-free checks against current dispatch confirmed:

| Authored input | Current behavior |
| --- | --- |
| `chainOccurrences: [a,b]` | Recovers one identity drawing. This is recognition of an authored role, not independent proof of the model's linguistic analysis. |
| `occurrences: [a,b]`, `copies: [c,d]` | Joins both lists into one four-member identity drawing. Original fields survive in evidence, but the drawing uses the combined list. |
| `firstChainOccurrences: [a,b]`, `secondChainOccurrences: [c,d]` | Preserves both entries but recovers neither identity drawing. More descriptive open names do not automatically become recognized names. |
| `accessibleWhOccurrence: a`, `accessibleSubject: b` | Recovers the independently supported phase-edge marks together. Preventing joint-group invention must not prohibit these independent marks. |
| `arguments: [a,b]`, `thetaRole: [Agent,Theme]`, with a predicate | Recovers a theta grid pairing a with Agent and b with Theme. `literalThetaRoles` pairs by position, while `paired-values` checks length and nonblank labels. The prompt does not state this pairing convention. |

All five checks left the supplied relation objects unchanged. The defect is in
derived interpretation, not loss of the raw JSON. No generation or browser was
started, and these checks do not measure how a model responds to new wording.

**Approved addition, implemented:**

> Use an anchor list for nodes with the same role in this relation. Keep distinct groups in separate entries and name their roles distinctly.

The existing open-name and array-order sentences remain. This addition also applies
to priorAnchors through its existing same-format definition. It introduces no
fixed linguistic vocabulary, required role or new field. Separate groups may
overlap in membership; separate entries do not imply disjointness. The role and
authored claim still determine whether a list describes a chain, independently
accessible nodes or another collection. A list alone does not establish identity.

This clarification is deliberately limited. Flat named lists can preserve
separate groups, but the current contract has no general machine-readable rule
identifying which anchor/value lists correspond, how several associations belong
to different groups, or how distinct claims share one simultaneous moment.
Explanatory prose can communicate intent to a reader; current role lookup does
not generally interpret that prose. Adding descriptive names does not solve
recognition, and requiring separate relation records would change Replay timing.
Do not adopt either as a claimed complete solution.

The shared prompt-contract test covers both frameworks. Generation provenance
already hashes the exact sent system instruction, so subsequent requests will
identify the revised contract without relabelling earlier saved generations.
No new provider generation was made to test this wording.

**Connected implementation.** Francis directed the prompt and matching correction
to be completed together. Shared lookup now leaves a conflicting joint-group
concept unresolved instead of concatenating separate entries. Every recipe
checks its original current, prior and value entries, including optional ones.
Identical alias groups retain one ordered lookup list; different order or
repetition counts remain meaningful differences. No group is selected as a
partial rescue. Diagnostics name the conflicting authored keys and do not
misreport present lists as missing fields. Raw groups and their original item
indices remain inspectable through neutral fallback.

The implementation preserves independently drawn phase edges, organizational
rails that keep their original role groups, and plaques that print each field
label with its literals. It does not impose one joint group on those drawings.
Literal plaque field names now participate in drawing identity, so changing a
field's meaning cannot disappear merely because its string values are unchanged.

Regression checks exposed another conflation: prior-order and current-order
values shared one lookup concept. They now use distinct derived concepts; the
existing comparison painter reads those separate lists. This is an internal
meaning distinction, not a new model-facing field or linguistic constraint.

Tests reproduce the original concatenation before the fix and cover conflicts,
equivalent aliases, field reordering, repeated items, optional evidence, prior
anchors, literal values, surviving independent marks and exact cause reporting.
Generated checks exercise all 52 recipes against competing groups in the
evidence each uses. Existing organizational and labelled-plaque tests caught
overly broad restrictions during implementation; those regressions were fixed,
not accepted as expected output. All 36 saved Astra/Fable relations retain their
compiled drawing content, tiers and Replay moments against the previous audit
baseline. No saved output, provider call, browser session, drawing style or Tier-3
layout changed. The full offline gate passes 1,439 tests, typechecking and both
parse fixtures; all verification processes exited.

Existing positional participant/value pairing remains a separate contract gap,
not an approved rule merely because code currently performs it. This pass adds
no all-to-all or first-with-first convention, splits no relation records, and
introduces no new field.

#### Hidden authoring conventions

This inventory compares the live shared prompt with the parser, node helpers,
all 59 registered production entries, all 52 Tier-2 recipes, their production
lowering, and Replay consumers. Fable independently reviewed the parser/node/
Replay paths through subscription-backed Claude Code. The primary review checked
its claims against code and local reproductions. This is a current-code audit,
not a claim to recognize every possible future linguistic expression.

The key distinction: a finite recognizer may leave unfamiliar meaning neutral.
It must not silently reinterpret a contract field, fabricate an association, or
require a private notation and then blame the model for not providing it.
Unknown meaning, incomplete drawing evidence, malformed transport and a defect
in Babel's interpretation need different diagnostics.

| ID | Hidden assumption and affected code | Evidence and simplest remedy | Status |
| --- | --- | --- | --- |
| HC01 | Joint groups are concatenated when several keys normalize to the same role. `tier2RelationDispatch.normalizeBlock`, every recipe. | `occurrences:[a,b]` plus `copies:[c,d]` must not become one chain. Preserve original groups; diagnose ambiguity, while retaining genuinely independent pieces. The approved prompt sentence explains grouping without examples or a vocabulary. | Fixed in the connected grouping pass above. |
| HC02 | Prior/current order columns share one value concept. Synonyms, native linearization preparation. | Separate their meanings before lookup; retain original order and repetitions. | Fixed in the grouping pass. |
| HC03 | Equal-length lists imply pairwise correspondence. `literalThetaRoles`, `paired-values`, `paired-cardinality`, `feature-dependency`, Tier-1 ATB and gapping lowering, PF fission output slots. | Theta arguments/roles, Case targets/labels, gap nodes/indices, correspondence endpoints/indices, correlates/remnants, ATB sources/witnesses and fission outputs/features use positions as associations. Equal lengths alone prove none of these. One node/one value is not the same ambiguity. Prefer actual containment/identity where it establishes a unique association, otherwise an explicit shared association rule. Do not silently add a blanket zip rule or a new field. | Decided and implemented, 11 September. The contract now states the rule: a values entry that lists one literal per item of an anchor entry carries the same name and the same length; two anchor entries that pair item by item have the same length and order. `pairedLiterals` in `tier2FacetRecipes.ts` is the one resolver: same-name and same-length pairs by position; one item with one literal pairs regardless of name; a same-name entry of the wrong length blocks the drawing with a reason; a differently named list is not a pairing and stays in the residue (an optional annotation is merely context, a required one fails the recipe). Theta grids, Case literals, gap notation, correspondence indices and Tier-1 gapping labels all use it; the same-name entry is consumed with the drawing. Native-plate string formats (HC05) remain separate. |
| HC04 | Scalar consumers take the first item even though values remain open lists. `renderPlanCompiler.scalarValue`, direct `[0]` consumers, Tier-2 `firstValue`. | Many Tier-2 scalar recipes already enforce max 1. Tier-1 values do not. Structured PF preparation also has exact cardinality checks. Audit each scalar against its eligibility check; multiple unequal literals must stay available rather than silently selecting one. Preserve raw values and report which original slots the drawing uses. | Remaining shared content-validation work. |
| HC05 | Native plates require literal field spellings and mini-languages not in the prompt. `nativeDrawingContent`, Tier-1 PF branches, Tier-2 native checks. | Correspondence requires `=>` and unique matching source/exponent strings; fission expects input/first/second feature rows and exactly two outputs; impoverishment expects a uniquely named cut in an ordered hierarchy; linearization uses `<`; rebracketing uses brackets; storage expects category/qstore/retrieved rows; Dependent Case step accepts only `1` or `2`. First use the same normalized meanings in both tiers and prepare content before claiming successful drawing eligibility. Then decide any genuinely necessary generic association syntax once, instead of teaching a separate serialization trick for every card. Keep unsupported literals visible. | Fixed, 11 September. No plate reads a private syntax any more. Correspondence pairs the sources and exponents lists item by item, with repeated literals for many-to-many and blank slots unlinked. Fission takes the two output terminals from anchors and one feature-bundle literal per output through the same-name rule. Linearization reads node orders from anchors and priorAnchors and renders the precedence rows itself. Local dislocation is claimed only when the prior and current trees regroup the sequence with unchanged terminal order. The dependent-Case step is any single literal, shown as written. Tier 1 and Tier 2 read the same evidence. The pairing sentence now covers any two entries. |
| HC06 | Literal meanings have another private grammar. `featureNotationStatus`, `explicit-npi`, outcome resolver, movement-route and glyph readers. | Exact feature tokens, polarity/dependent-Case notations, `strong NPI`, bounded outcome words and `orthogonal` affect eligibility. These are finite recognition limits, not mandatory authoring rules. Negation/qualification must remain distinguishable; diagnostic wording must say unsupported interpretation, not missing authored data. Sharing one reader avoids different tiers disagreeing; arbitrary prose remains an explicit limitation. | Finite limits retained and documented; do not expand the prompt into their dictionary. |
| HC07 | Outcomes work only under the literal key `outcome` in parts of Tier 1, although matching recognizes `status`, `result` and `judgment`. An independent facet can consume that same evidence. | Shared outcome-role lookup now feeds the painter and signature checks; ownership retains a recognized outcome needed by the primary. A literal judgment such as `*` remains a separate glyph, not an outcome word. Tests exercise both polarities and equivalent keys. | Fixed. |
| HC08 | Potential obstacles imply failed dependencies. Transfer access and Intervention painters always include a cross, while the old eligibility tests called their absent-outcome geometry neutral. Tier-2 blocked extraction also inferred the negative meaning from structural anchors. | Require an authored negative outcome or an explicitly blocking participant role belonging to that drawing. Known `blocker`, `inaccessibleGoal` and `blockedDomain` meanings are supported; mere `intervener`, `target` or containment are not enough. Explicit positive/uninterpretable outcomes cannot be ignored to retain a cross. Complete Tier-1 recipes remain complete; these are eligibility checks, not partial rescue. | Fixed for these shared negative-claim paths. No pixels or symbols redesigned. |
| HC09 | Overlapping aliases establish multiple linguistic claims. Binding and operator-variable recipes. | `operator`, `variable`, `domain` previously earned both drawings. Contextual aliases now fill slots only when the relevant meaning is established. A remaining hybrid tie stays neutral with `binding-or-operator-reading`, retaining other independent pieces and original fields. Distinct relation records still have distinct moments. | Fixed. |
| HC10 | Generated coindices can look model-authored. `tier2RenderPlanCompiler` identity, Binding, scope movement and operator-binding; Tier-1 chain allocation, parasitic-gap defaults and gapping labels. | Relation position, `i`, or first-encounter order supplies some indices. Theta table pointers and Tier-3 numbered badges are presentation labels, not automatically linguistic coindexation. Keep that distinction explicit. Prefer authored coindices; otherwise choose one documented presentation policy with provenance rather than reading list positions as linguistic identity. | Index presentation remains a decision. Badges unchanged. |
| HC11 | Replay treats an ID suffix as bookkeeping. Former `normalizeReplayStructuralNodeId`. | `dp_stage1` and `dp_stage3` both became `dp`. Their names are opaque occurrence IDs, not instructions to strip a suffix. The suffix rewrite is removed and both remain distinct in canvas data. | Fixed; regression test added. |
| HC12 | Other node-ID text still affects behavior. `resolveCarriedRelationEndpointForCanvas`, `stripSyntheticReplayLeafSuffix`, synthetic workspace/leaf IDs, continuity preparation. | Endpoint remapping filters by the prefix before `_`/`:` and scores `trace`/`final`; `cp_` affects reserved layout space; synthesized names can collide with authored IDs; unresolved IDs are prettified into English. Replace text heuristics with exact IDs, explicit generated-node metadata and unique authored identity matches. Reserve renderer IDs through a collision-free mapping, not an unstated model naming rule. Never choose the first ambiguous lineage mate. | Fixed for endpoints: a carried movement link keeps its authored endpoint ids and is simply not drawn on a canvas that lacks one; the prefix filter, `trace`/`final` scoring and the `__silent` id convention are gone. Replay's own display-leaf ids stay in the `::__` namespace. Prettified unresolved ids in panel text remain a presentation limit. |
| HC13 | Lineage is sometimes treated as an occurrence ID, and reconstruction needs more correspondence evidence than its callers report. `prepareDerivationReplay` continuity seeding and `buildPreMovementStructuralForest`. | `previousVisibleNodeIds.has(lineageId)` compares different concepts. Restoration without a prior source also needs a unique lineage counterpart for each newly silent leaf and can abort when one is missing. Use exact previous occurrences first; report the specific unreconstructable leaf. Do not give every descendant its ancestor's lineage: that would assert an unauthored identity and can make siblings indistinguishable. | Fixed. Continuity compares the current lineageId with the lineageIds of previously visible occurrences. Reconstruction no longer exists: the contract now says an occurrence moves only from a position an earlier stage already shows, so every movement source is restored exactly from the preceding stage, and a source that is not there leaves the stage as authored with the existing unproven-source diagnostic. Ancestor-lineage inheritance rejected. |
| HC14 | Word spelling overrides authored pronunciation. Server `derivationHelpers`/`syntaxTree`, Replay surface/trace helpers and terminal filters. | Direct reproduction: `{label:'N',word:'copy',tokenIndex:0}` is excluded by both server and Replay overt collectors. `trace`, `null`, `pro`, bracketed words and index-like strings meet related special cases; Replay filters subscript-like words too. Use the existing `word`, `silent`, `tokenIndex` fields consistently. An explicitly pronounced input token must not become a trace because of its spelling. Keep notation interpretation in the unpronounced-display path. | Fixed. `server/babelParser/nodePronunciation.js` is the single field-based classification (`isPronouncedLeaf`, `isSilentWordLeaf`, `isWordlessLeaf`); the parser's overt collectors and every Replay pronunciation decision use it. `t`/`∅` notation is read only on leaves that are already unpronounced. |
| HC15 | Label casing decides whether a wordless node is spoken or styled as a word. Server structural-label lists differ from Replay's lists. | Reproduced `appl`/`voice` as server overt tokens while `Appl`/`Voice` are excluded; Replay counts both forms. `Neg` is excluded by server but counted by Replay. The prompt says lexical content is in `word`. One field-based classification should serve both layers; no extra capitalization instruction for the model. Preserve the approved category treatment and the model's wordless/null/copy choice. | Fixed. A wordless leaf is an abstract category whatever its label spells or however it is cased; `STRUCTURAL_LEAF_LABELS`, the casing tests and the label-fallback surface are removed. The Atlas lab bank, which authored silent lexical content in labels, now authors it in `word`. |
| HC16 | Silent notation is canonicalized as meaning, and parent silence differs by consumer. `canonicalizeCovertSurface`, Replay inherited-silence/ghost checks, server terminal-silence checks. | Lowercase `pro` is canonicalized to `PRO` by the covert-surface helper. Several Replay helpers inherit `silent` or `ghost` from ancestors while the current prompt defines terminal silence. Preserve semantic distinctions and separate notation styling from pronunciation. Settle the existing whole-subtree silence question once; do not solve it by silently deleting words or inferring identities. | Fixed, 11 September. Whole-subtree silence is decided: `silent: true` on a non-terminal leaves every terminal beneath it unpronounced, on both layers. The contract sentence is added; `nodePronunciation.js` walks leaves with the inherited flag; the parser's overt collectors, surface spans and inspection use it, and a token index beneath a silent ancestor is reported as `DERIVATION_TOKEN_INDEX_SILENT` and fails token alignment. The parser no longer canonicalizes `pro` or `null`; surfaces are read as written. |
| HC17 | Undocumented node metadata participates in interpretation. `aliasIds`, `type`, `silentFeature`, `ghost`, `surfaceSpan` and renderer-generated fields. | Expansion copies extra fields; consumers may resolve aliases, infer traces/silence or accept spans from them. Separate authored contract data from Babel-generated display metadata. Keep the raw record and report unexpected fields internally; do not introduce public rejection as a side effect. | Fixed. The parser no longer reads `type`, `silentFeature` or authored `aliasIds`; every non-contract node key is recorded as `node_field_ignored:<stage>:<path>` in the integrity flags while inspection keeps the raw node. Replay projects authored nodes to contract fields before adding its own `ghost`, `replayLayoutOnly` or `aliasIds` metadata, so an authored key with one of those names is inert. |
| HC18 | An empty workspace means reuse the preceding one. `adaptDerivationStagesForReplay`. | An authored empty array means no current objects, not an implicit reference. Replay adaptation now preserves it. The regression checks both its result and unchanged input. | Fixed. |
| HC19 | First two anchors imply directional endpoints; unresolved anchors disappear. `buildResolvedRelationLinksFromFrames`, `resolveRelationAnchors`, `isRenderableReplayRelation`. | An unfamiliar three-member relation gets legacy source/target fields from the first two resolved items; that alone is not proof that an arrow appears in production. A relation with no resolved current anchors can lose its Replay moment. Keep fallback participants unordered unless direction is established. Preserve the relation event and attach exact stage/key/index diagnostics for unresolved witnesses; do not manufacture nodes or select remaining anchors as a repair. | Fixed. `classifyRelationAnchors` reports every unresolved anchor at its authored field; the relation keeps its Replay moment with a `RELATION_ANCHOR_UNRESOLVED` diagnostic even when nothing resolved. Unregistered relations record `authored-anchor-order` provenance and only trajectory families draw direction. Public failure behavior unchanged. |
| HC20 | Movement/frame preparation adds naming and chronology assumptions. `baseGenerationSurface`, movement-stage comparison, first-leaf selection, first-active-link detail rows. | A fallback lowercases initial D/C words; other paths choose the first lexical leaf or first active link. Prefer exact authored prior surfaces, stable occurrence identity and the owning relation's complete details. Movement evidence is expected in the stage where its result first exists. The prompt already requires chronological relations and persistent occurrence IDs; diagnose violations instead of adding duplicate prose or reordering the analysis. | Fixed. Pre-movement surfaces are never reconstructed from the landing, so the lowercase rule and the first-leaf selection are deleted with the reconstruction path. An authored prior-stage occurrence is restored exactly. The Replay boilerplate-text filter and the legacy detail-block classifiers are removed; the local model route records its own name. |
| HC21 | Order and span interpretation differs by consumer. Final server alignment versus `collectPronouncedTerminalSequence`. | The final prompt explicitly requires tree order to match input. The sentence fallback collector sorts fully indexed terminals, and also reads undeclared authored spans. Keep token identity, tree order and presentation order distinct. Validate final order from traversal; never use sorting to hide a mismatch. This is not a newly discovered model-facing requirement. | Fixed, 11 September. The Replay sentence reader returns pronounced words in tree order through the shared pronunciation module; it no longer sorts by token index or reads spans. A token index that disagrees with tree position is reported by the parser's token alignment. |
| HC22 | Dead prose classifiers and provider-route labels remain. `buildReplayDisplayDetailBlocks`, old low-signal/operation regexes, local-model `promptRoute`. | Current detail producers use Stage Record/Relations, not the legacy titles that move Case/selection/locality prose. Verify callers and remove unreachable routing, not add instructions that could activate it. The local provider borrows the `gemini` route name and defaults; separate actual transport from configuration provenance, checking defaults before changing it. | Remaining cleanup; no provider request/configuration changed here. |

Every proposed remedy above applies to a class of inputs. Tests should vary
unknown labels, opaque/Unicode IDs, field order, aliases, array length/order,
duplicate values, absent versus contradictory evidence, and current/prior
references. Passing the existing model samples alone is insufficient.

**Association recommendation.** First remove associations that can be recovered
unambiguously from authored identity or containment. For arbitrary remaining
participant/value pairings, the current flat fields do not contain a universal
association rule. The smallest contract change worth comparing is one explicit
matching-key/list rule using the existing fields. It must say which lists pair,
whether scalar values apply to a whole group, and what nesting it cannot express.
Simply saying "preserve array order" does not answer those questions. A grouped
record can express more, at the cost of another shape. Neither alternative was
implemented in this pass. No per-relation examples, mandatory role vocabulary,
associations field, prompt decoder model or implicit zip rule was added.

**Review corrections.** Fable's report is evidence to check, not an authority.
The live prompt already defines persistent IDs, values as an object, chronological
relations and retained words on silent terminals. Those are not missing
instructions. Its suggestion to inherit ancestor lineage would invent identity
and was not adopted. A suspected lost-collision-diagnostic path was also checked:
Tier-2 lowering already emits those diagnostics. Emitting them a second time
caused a test failure, so that attempted change was removed. Specialized feature
drawings legitimately retain unmatched prose as residual content; an overly
broad collision guard was removed after regression tests exposed that loss.

**Implemented and verified.** HC07-HC09, HC11 and HC18 are implemented locally,
alongside HC01-HC02 from the preceding connected work. Negative diagnostics
include the actual reason, not just a missing-field label. The two blocking
families' old positive fixture examples now explicitly author `blocked`; the
test that mistakenly described Intervention's unconditional cross as neutral
now checks that absent negative evidence cannot authorize it. Known Tier-1
BlockedExtraction names already explicitly state a negative claim; the new
Tier-2 rule does not read arbitrary relation titles as such proof. No approved
primitive has been cosmetically changed or partially rescued.

The full gate passes 1,445 tests, typechecking and both parse fixtures. All 59
registry entries and 52 recipes were included in the code inventory; the existing
executable Orchard/Atlas parity checks pass. A comparison of all 36 saved
Astra/Fable relations finds no changes in compiled drawing content, tiers,
facets or Replay relation frames. This is not a new pixel-by-pixel browser signoff.
No fresh Babel generation, prompt rewrite, Tier-3 redesign or public failure
warning was introduced. The read-only Fable audit completed; it was not a second
review of the finished implementation diff.

**Node interpretation and exact references, 11 September.** HC14, HC15, HC17
and HC19 are implemented; HC12, HC13, HC16 and HC20 are implemented to the
boundaries recorded in their rows. The shared rule is one module,
`server/babelParser/nodePronunciation.js`: a leaf is pronounced when it has a
`word` and is not `silent`; a wordless leaf is abstract; spelling and casing of
`word`, `label` and `id` decide nothing. The parser's `derivationHelpers.js`,
its structural-label set and covert-surface canonicalization are deleted;
Replay's `word || label` pronunciation checks, sentence-token surface set and
"abstract leaf" class are replaced by the same predicates, with notation
styling applied only to leaves that are already unpronounced. Reproductions
that previously failed now pass: `{label:'N', word:'copy', tokenIndex:0}` is
pronounced on both layers; `appl`, `Appl`, `voice`, `Neg` and `book` without a
word are abstract on both layers; a token index on a silent terminal is a
token-alignment diagnostic, not a reinterpretation.

Two Babel-authored data sets depended on the old label convention and were
migrated, not accommodated: the Atlas lab bank's `silentLexicalNode` and its
pre-movement reconstruction now author lexical content in `word`, and the
wordless-category expectations that encoded label spelling were corrected. The
sequencing test's node finder resolves Replay's `aliasIds` like the compiler
does. `tests/nodePronunciation.test.mjs` and `tests/replayReferenceHandling.test.mjs`
hold the new regressions.

Verification: the full gate passes 1,455 tests, typecheck and both parse
fixtures; `npm run build` succeeds. A step-by-step digest of Replay steps,
visible ids, canvases, active links, panel content and compiled relation plans
for the four saved Astra/Fable analyses and both committed fixtures is identical
before and after the change. No prompt change, paid generation, Tier-3 redesign
or public failure warning was introduced.

**Two contract decisions, 11 September.** Francis decided whole-subtree
silence (HC16) and positional pairing (HC03) and approved their wording. Both
sentences are in the live prompt; no examples or vocabulary were added. Francis
also confirmed the reconstructed-surface casing rule (HC20) as intended
presentation. The pairing rule has one deliberate limit: an anchor entry pairs
with one same-name literal list, so a recipe with two per-item annotations
(gap index and gap label) receives the first through the name and keeps the
other as residue. The two Batch-2 test files that had authored the old implicit
pairing were migrated to same-name entries. `tests/silenceAndPairing.test.mjs`
holds the regressions. The gate passes 1,461 tests; the saved
Astra/Fable steps, canvases and relation plans are unchanged.

**Base position before movement, 11 September.** Francis rejected the
pre-movement reconstruction outright: a derivation that never shows the moved
occurrence in its base position is not an end-to-end derivation. The contract
now states it: "An occurrence moves only from a position that an earlier stage
already shows." Babel deletes the reconstruction path, the reconstructed-surface
lowercase rule and the unrestorable-leaf question with it. Both saved Astra and
Fable outputs already satisfied the sentence; the five single-stage movement
tests were re-authored with a base stage. HC22 is closed by the prose-classifier
removal. The gate passes 1,461 tests; the saved Astra/Fable digest is
unchanged.

**Plates read plain fields, 11 September.** Francis kept all five plates and
rejected private formats. The pairing sentence now reads "When two entries pair
their items one by one", and the `=>`, `<`, bracket, `outputOne`/`outputTwo`
and `1`/`2` readers are deleted. The lab cards that authored them were
re-authored in plain form. The gate passes 1,461 tests; the saved Astra/Fable
digest is unchanged.

HC21 is closed the same day: every code row of this inventory is now resolved
or decided. What remains is design (Tier 3 presentation) and process (the joint
review of the four saved analyses in Replay before any paid run). No return to
sentence-by-sentence patching, and no claim that finite lookup makes open prose
universally decidable.

#### Remaining decisions

These require concrete examples and discussion before their implementation, not another repetition of settled principles:

1. **Ambiguous relation evidence and grouping.** How to state several participant/value associations clearly and what to do when the saved record does not establish a pairing or direction. The smaller Control, covert-movement, idiom and transferred-domain combinations and their connected regression checks are implemented under the evidence boundaries immediately above. The existing fields remain the working format, with redesign available if its benefits and costs are demonstrated. No implicit array pairing, title scraping, or partial Tier-1 rescue is approved.
2. **Timing beyond ordinary ordered relations.** How genuinely simultaneous claims are represented and how previously saved conflicting orders are inspected. Do not silently rearrange a saved analysis. Normal forward chronology, complete movement landings, and model ownership are already agreed.
3. **Silence over a whole subtree.** Whether a phrase-level silent mark makes descendants unpronounced, or whether terminal status must be explicit, and how conflicting markings are diagnosed. Terminal words may remain on silent copies; the model still chooses copy versus trace.
4. **Plaques and Tier 3.** Decided 12 September for Tier 3: a neutral fallback marks its own stage only, and its numeral is the relation's authored position in that stage. Hiding leftover anchors and one-mark-per-relation were rejected. Still open: long values, many rows, mobile interaction, and exports. No overflow button or moving selected values into Replay-only content is approved.
5. **Incomplete-record handling.** Whether any formatting correction is automatic, how partially compilable or multi-analysis responses remain inspectable, and what the public app does if processing cannot finish. Surface-token mismatches, extra final roots, and conflicting field types need precise diagnostics separately from deciding display behavior. Ungrammatical sentences remain legitimate inputs, not grounds for discarding an analysis. No regeneration after a downstream processing failure is already agreed.

The unknown cause of Fable's missing ending and the remaining code/visual checks are investigations, not decisions Francis must guess. Their uncertainty does not block settled fixes or authorize a helper. Next implementation can address stage-scoped anchor diagnostics and recognized movement/Replay ownership; remaining policy and display choices must stay explicit.

Batch-discussion clarification: Francis conditionally accepts whole-phrase silence but requests its linguistic edge cases before implementation. He has not chosen simultaneous versus sequential presentation for concurrent relations; sharing a completed derivation stage must not be confused with simultaneous operations. Stage Record, relations, and trees must describe one consistent derivation. Preparing explicitly distinguished debugging copies, inspecting available trees despite formatting problems, and evaluating what the provider actually returned are routine requirements, not questions to reopen. Such copies must not replace the original evidence or become silent production corrections. Public incomplete-record behavior and automatic repair remain separate from this agreement. No runtime or prompt change follows from this clarification.

### Approval is not established by a successful render

The clipping F18 plaque can be traced to the existing Agree branch. It is not a new probe design added by the review page. The bad fit is nevertheless real. The current Tier 2 Phase drawing is also an existing piece, but it does not mean the full Transfer statement has been drawn.

All current claims were checked against dispatch evidence and the documented drawing inventory. The later shared-pipeline pass captured the Fable inspection copies and checked the approved smaller drawings in the production renderer. A fresh pixel-by-pixel comparison of every generated mark with every Orchard example remains outside that pass. These limits prevent calling this a complete visual sign-off.

## Linguistic reconstruction

These are audits of the analyses' stated commitments and visible structure, not expert-certified gold analyses. A difference between two legitimate frameworks is not automatically a model failure.

### Astra Minimalism

The seven stages build the wh object, merge it with buy, introduce transitive v and John, move the object to the vP edge and Transfer VP, introduce T and raise John, form a C/T complex with do-support, then front the wh DP and Transfer TP.

The analysis supplies a coherent reason for T probing past the object: it adopts an Activity Condition under which the accusative object is inactive for phi/Case Agree. It uses the vP edge to keep the wh object accessible after VP Transfer. Those are stated assumptions, not evidence that Babel should infer the same derivation for every sentence.

The lower John and wh material are authored as silent at completed movement stages. The words did not simply disappear from the model's final tree. The faulty intermediate display comes from applying that completed state before the movement moment.

Earlier `finiteT` exists before the T-to-C stage. `raisedT` shares its continuing identity. C is separately externally introduced. The model is not claiming that lexical V buy moved to C, and the PF realization `did` is explained as support for the raised tense. Babel's micro-steps make those distinctions difficult to see.

Theta relations are often explained in the stage prose and witnessed by selection/branching rather than authored as separate relations. The prompt expressly excludes duplicate marks for what ordinary branching fully expresses. Their absence from `relations` alone is not proof that theta assignment was omitted.

### Astra X-bar

This uses a nominal projection for the object with a determiner phrase in its structure, merges buy, builds IP with John, raises abstract I into C, forms the wh dependency, and finally realizes past tense as did. It explicitly adopts a traditional X-bar/GB-style subject position. That differs from VP-internal subject movement but is not automatically a mistake within the declared analysis.

The earlier I source is present. `did` is introduced at a later PF stage, not substituted for a nonexistent earlier head. The draw-before-move behavior is a Replay problem.

There is a real sequencing question in S5. The first relation is wh licensing anchored to the final fronted NP; the second is the A'-chain. The completed stage contains that NP, but a frame-by-frame presentation must decide which moment introduces it. If the chain relation is treated as the movement event, the preceding relation cannot display a future landing without violating the requested timing. The contract describes post-states and authored relation order, but does not fully resolve this combination. This needs an explicit timing rule, not an arbitrary reorder of model statements.

The CP with only C' is already authored in S4. Its leftward position is not model-authored geometry. The replay/layout layer must explain why that unary current structure is displaced while reserving later material.

### Fable Minimalism

The model builds VP, then vP with John, then T/Agree/subject raising, C/head movement, and final wh movement. John is explicitly a lexical D that is both minimal and maximal. A missing NP under that John is not, by itself, an error.

There is an internal completeness problem worth reviewing: S2 states that no Case or agreement features have yet been valued. S3 explains nominative on John, but later stages do not establish the object's accusative licensing while the final account claims convergence. This is an omission relative to the analysis's own promised account, not something the renderer should fill in.

T is spelled out as did early, justified by its future nonadjacency to the lexical verb at spell-out. This is in tension with the prompt's strict forward-only presentation. It may be a look-ahead explanation of PF realization rather than an impossible theory, but the prompt and the displayed chronology should not pretend there is no tension.

There is no explicit intermediate vP-edge wh step. Under a strong-v phase analysis this needs an account of accessibility. Fable does not specify that phase assumption clearly enough to call the omission categorically illicit. Babel must not insert an edge stop on its behalf.

### Fable X-bar

The original analysis has an earlier I source, later complex C, do-support, and a fronted DP. Its invalid-reference diagnosis does not undermine those linguistic objects: it was caused by Babel discarding their stage.

The lower wh occurrence is deliberately a category-typed silent trace, with `label: "DP"`, `lineageId: "whbook"`, and a relation explicitly anchoring it as `trace`, rather than a fully expanded silent copy. The new high DP is fully structured. Francis accepted this representation during the 8 September grilling. It does not require a separate t glyph or the undeclared node features to establish its trace role. The remaining defects concern recovery and timing, not permission to use this notation.

The null D associated with John and the earlier abstract I are distinct from that trace. The authored record distinguishes their roles; similar bare category labels are not, by themselves, a rendering defect or permission to insert trace symbols.

The ECP, government, wh-Criterion, and Subjacency statements should be reviewed as theoretical claims, not treated as proven by a generic badge. A'-binding of a variable is not automatically an error under a Condition C argument; the distinction between A- and A'-binding matters. I have not promoted those claims to gold judgments.

### What the linguistic sources settle

Bare Phrase Structure does not make lexical item, head, and maximal projection mutually exclusive types. This is why the proposed test cannot equate a leaf node with head movement, and why lexical-word/category display steps should not be described as universally required syntactic operations. See [Chomsky, Bare Phrase Structure](https://biolinguistica.wordpress.com/wp-content/uploads/2010/03/chomsky-bare-phrase-structure.pdf).

Phase theories distinguish transferred complements from accessible phase edges. That supports checking Astra's explicitly stated edge/Transfer sequence, but does not justify adding an unmentioned edge step to Fable. See [Chomsky, Derivation by Phase](https://faculty.georgetown.edu/rtk8/Chomsky2001DbP.pdf).

Morphological realization can be separated from narrow-syntactic head movement. A later did exponent is therefore not automatically an illegal spontaneous syntactic object. Its source and the model's chosen chronology still need inspection. See [Embick and Noyer, Movement Operations after Syntax](https://babel.ucsc.edu/~hank/mrg.readings/embick%26noyer2001.pdf).

### Full Fable frame pass

9 September follow-up. Read both original responses, all ten Stage Records and forests, all fourteen relations, and every compiled inspection frame. Recompiled the existing disclosed inspection payloads with current production code: the complete evidence objects equal the saved baselines, including all 35 Minimalism and 36 X-bar frames. This does not make the inspection wrappers model-authored. Minimalism still needs the disclosed final `]}` and two `values` wrappers; X-bar needs one wrapper and no delimiter repair. The newer syntax-only inspector does not apply those wrappers and is not Replay.

Local checks found no duplicate IDs within any expanded stage, and all 32 current/prior relation-anchor references resolve in their required stages. Both final forests contain one root and yield `Which book did John buy` from their overt words. Neither result certifies the linguistic explanation. All five movement sources exist before movement, and their landings preserve the authored lineage. Source files and parsed original payloads remained unchanged. Reproduction: `/tmp/babel-fable-full-pass.mjs`.

With Francis's permission, a local Playwright session loaded those inspection bundles into the actual app at `http://127.0.0.1:5177/?devCapture=1`. Browser plugin was unavailable. All 71 desktop frames were captured at 1600 x 1100, reviewed in frame-ordered contact sheets, and checked against their frame data. Both final frames were also captured at 390 x 844. No page exceptions or API/external requests were observed; API and external requests were blocked by the capture script. The temporary browser closed. The existing development server was reused, not started or stopped by this pass.

Evidence is outside the worktree at `/tmp/babel-fable-visual-Jz3yzD/`, with per-frame PNGs, twelve contact sheets and `evidence.json`. The capture script left the generation picker on its default Astra setting while injecting the saved Fable bundle. That picker is not provenance; these are Fable's saved records, not new Astra output. Do not use the picker label to identify a captured analysis. Captures retain this limitation rather than altering the evidence. This was a stepped-frame inspection, not an autoplay, manual-zoom, or export verification.

#### Every stage and frame

Ranges below exhaust both compiled sequences. Individual selection/projection/merge frames inside each range were checked, not just the final state.

| Analysis / stage / frames | Authored analysis | Replay and review result |
| --- | --- | --- |
| Minimalism S1, F1-9 | Build which-book DP, then merge it with buy into VP. | F1/2 select buy and project V with its lexical child. F3-6 do the same for which and book; F7 builds DP; F8 builds VP; F9 shows Stage Record. No missing lexical child here. Selecting buy before assembling its complement does not reverse the two merge operations. External Merge loses the main white heading. |
| Minimalism S2, F10-15 | Introduce silent v; merge John in its thematic position. John is explicitly bare D, both minimal and maximal. | F10/11 select/project John; F12 introduces wordless v; F13 builds inner vP; F14 adds John; F15 shows Stage Record. Wordless v is authored, and there is no missing NP requirement under John. No separate theta relation was authored, so no theta drawing should be invented. |
| Minimalism S3, F16-24 | Merge T, Agree with John, then move John to Spec-TP. T already contains did in this completed state. | F16/17 reselect/reproject the higher John; F18/19 introduce did/T; F20/21 build TP. Agree follows at F22, movement at F23, prose at F24. The subject has already moved visually before Agree, while lower John has already lost its word. This reverses the intended relation timing. T1 Agree works only in the disclosed inspection copy; movement is T3. Findings 01, 03, 08-13. |
| Minimalism S4, F25-31 | Add interrogative C; move existing T into a complex C. | F25/26 reselect/reproject did/T; F27 selects C; F28 calls construction of the complex C External Merge; F29 attaches CP; only F30 names head movement. Source T exists in S3, so this is not invented source syntax. Replay presents the landing as new material and hides the old did too soon. F31's authored statement says did is in second position, but this intermediate tree still begins with did; second position describes the eventual clause, not this stage. |
| Minimalism S5, F32-35 | C Agrees with the lower wh-DP, then moves it to Spec-CP. | F32 introduces the higher DP and parent CP as External Merge before Agree F33 and movement F34. F35 is Stage Record. The lower DP retains its D/N children but no words, exactly as authored under the old prompt. Final overt order is correct. The early landing and silence are Replay defects, not a reason to change the final tree. |
| X-bar S1, F1-9 | Build D'/DP around which and N'/NP around book. | F1-4 build book/N/N'/NP, F5/6 select/project which/D, F7 combines D with NP, F8 projects DP, F9 shows prose. The model's prose describes projection types, not a separately encoded lexical selection schedule. No dropped overt word or forced null is found. |
| X-bar S2, F10-16 | Merge buy with object DP; assign Theme and accusative. | F10/11 select/project buy/V; F12 builds V'; F13 projects VP; F14/15 display the two relations as T3; F16 shows prose. Theme and accusative occur in relation names/prose, not supported named values. These cannot be fixed merely by relaxing an alias. Preserve the assertions without pretending Babel recovered their missing structured literals. |
| X-bar S3, F17-29 | Abstract I selects VP; John is base-generated in Spec-IP with a silent D; predication assigns Agent and finite I assigns nominative. | F17/18 introduce I/I'; F19-25 build John's DP; F26 combines IP; F27/28 show the two T3 relations; F29 shows prose. John is not supposed to move in this analysis. I's lack of a word precedes its later realization and is intentional. The undeclared node features do not authorize new drawings. |
| X-bar S4, F30-32 | I moves to C, leaving a trace; do-support then realizes tense as did. | F30 introduces the whole complex C, lower I trace, and CP together. Preserve this working atomic introduction. Its movement curve is missing because dispatch is T3. Did is already visible at F30, before its separate realization relation F31. F32 is prose. This exposes the distinction between a completed state's word and the earlier movement moment, not a missing source. |
| X-bar S5, F33-36 | Move wh-DP to Spec-CP; establish wh-Criterion agreement, then A'-binding/ECP claims. | F33 introduces the complete landing and compact DP trace at the movement moment. No rebuild is needed. F34 displays wh-Criterion; F35 displays binding; F36 shows prose. All three are T3. Binding can use the existing independent path, but positions alone do not establish directional feature valuation. The final tree has the correct overt order. |

#### What remains linguistically uncertain

- **Minimalism object Case is not accounted for.** S2 explicitly postpones all Case/agreement valuation. S3 gives John nominative; S5 claims convergence without explaining object Case. This is an incompleteness in Fable's explanation, not a parser failure or permission for Babel to assign accusative.
- **Minimalism did is explained using a future condition.** S3 invokes nonadjacency at spell-out before C is introduced. The tree is intelligible, but the explanation relies on the later question derivation. This belongs in the chronology/realization review, not an automatic rejection rule. Structural Lowering and linear adjacency are distinct in published morphology accounts; do not substitute one merely because the other wording seems imprecise. See [Embick and Marantz, Architecture and Blocking, section on T-Lowering](https://www.ling.upenn.edu/~embick/arch-block.pdf).
- **Minimalism wh-feature status is underspecified.** S1 calls the DP's wh-feature unvalued; S5 explains valuation of C's wh-feature without explicitly returning to the DP's earlier description. The text does not identify enough feature distinctions to establish whether it means the same feature, a matching feature, or loose terminology. Preserve this as a question about the model's account, not a renderer-invented valuation.
- **No intermediate vP edge or Transfer is authored by Fable.** Neither should be inserted simply because Astra uses them. A phase-based objection requires establishing that Fable adopts the relevant phase/accessibility assumptions.
- **X-bar's framework choice is not a defect.** It adopts a traditional base-generated Spec-IP subject, government/Case, ECP and the wh-Criterion. X-bar notation does not itself entail every one of those GB assumptions. The prose's claim that Spec-IP is *the* canonical GB base position is broader than the range of GB analyses. Review the chosen account on its own terms rather than silently turning it into Minimalism.
- **A'-binding is not automatically a Condition C violation.** Do not confuse A-binding with A'-binding when reviewing the variable claim. The ECP/Subjacency/government explanations remain theoretical claims, not results certified by Babel's rendering.

These extend the existing linguistic review rather than create new linguistic validation gates. The saved analyses remain inspectable. No model rerun or silently rewritten explanation is warranted by this pass.

#### Visual results and regression requirements

The production captures confirm findings 14, 18 and 19: External Merge and many relation names lose the main body heading; fallback markers repeat `1`; persistent connectors accumulate. Minimalism F23 and X-bar F36 show connectors crossing behind the Replay panel. The instance number is not a score or a count of successful linguistic checks.

The captures extend existing panel-layout finding 23. At 390 x 844, both final frames put the panel over much of the tree; the header wraps into the panel and the side controls cover text. At desktop size, the longer final X-bar Stage Record also competes with syntax and relation routes. `TreeVisualizer.tsx` places the panel absolutely at `left-8 bottom-24`, with up to `44vh` height, while ordinary Replay fitting reserves a fixed 170px at the bottom rather than its actual rectangle. The header and side controls are positioned independently. These are production layout rules; neither model supplies those coordinates.

The camera transform was identical across every captured frame within each of the ten stages. Do not conflate the panel collisions with within-stage camera jitter. Fable X-bar S4's CP is authored with only C' below it; its leftward location is visible, but this pass does not establish a new geometry cause or authorize changing that syntax. Early stages occupy little of the screen while future geometry is reserved; any framing change must preserve the agreed stability rule.

Regression work should cover all five Fable movements: bare maximal D, overt T, full DP copy, abstract I, and compact DP trace. Check source visibility, exact endpoints, whole landing/parent introduction, subtype, and relation timing together. Preserve X-bar's already-correct atomic introductions. Add a separate movement-then-realization check, source-versus-host labels that remain distinguishable, and panel/header/control collision checks on long Stage Records at both viewport sizes. Do not force new null children, extra node features, or a different subject theory to make these checks pass.

## Contract and representation decisions exposed by the run

These should be discussed before implementing broad repairs:

1. **Silent copy versus trace versus abstract head.** The model owns these choices. Babel must preserve an authored silent copy rather than convert it into a trace, and must not invent words for an abstract head. The current prompt's ban on silent `word` fields conflicts with retained lexical-copy display. Exact field wording and how to recognize an otherwise category-only typed trace remain to be discussed.
2. **Derived micro-steps versus authored operations.** The model supplies completed states. Babel creates Select/Project/External Merge frames. Those are a pedagogical decomposition, not separately authored model claims. They must respect established movement identity and should not imply that every linguistic framework performs an independent unary projection operation.
3. **Relation order and state ownership.** Agreed on 8 September: the written contract must explicitly require relation order to follow the model's derivational chronology and agree with Stage Record, with prerequisites established first. Separate relations keep separate Replay moments. The prompt currently leaves this ordering implicit; correction is pending. Simultaneous claims and handling previously saved conflicting orders remain unresolved.
4. **Complete known claim plus extra context.** Agreed: extra context alone must not downgrade a complete supported claim. Preserve the approved drawing and all additional evidence, without treating unsupported context as covered by that drawing. The general implementation must still distinguish extra context from missing or contradictory core information. Finding 21 remains open until implemented and verified.
5. **Unknown names versus insufficient information.** Some failures are recoverable role vocabulary gaps. Others lack the values or domain anchors needed for the desired drawing. Agreed on 8 September: literal relation content belongs in open named `values`, even when also mentioned in the relation title. Tier 2 must not infer that content by interpreting arbitrary titles. Clarify this as a general representation rule, not a request for particular relations or drawings. Preserve the neutral, open ontology: no suggested relation names, role inventories, theoretical commitments, example analyses, or example linguistic values in the model-facing clarification. Exact wording remains pending; no prompt change is authorized during grilling.
6. **Diagnostics versus rejection.** A failed machine-shape check, an ungrammatical sentence, a disputed linguistic analysis, and incomplete renderability are different outcomes. This audit does not choose the user's failure/retry policy.

The three reference mechanisms also need to be explained distinctly: `id` identifies an occurrence, `lineageId` relates continuing objects across occurrences, and `refId` carries an unchanged subtree from an earlier stage. `priorAnchors` is narrower than `refId`: it refers only to the immediately previous stage. Relations can reference nodes serialized later in their own stage object; that is not an illegal reference to a future derivation stage.

The evidence for decision 5 is Fable X-bar S2, `theta-marking (Theme)`, which supplies assigner/argument anchors but no `values`. S3 similarly places Agent only in the relation title. These are audit examples, not proposed prompt examples. The agreed clarification must not tell models to produce those relations, supply missing values to saved outputs, or favor claims Babel already knows how to draw. Renderer coverage follows the model's analysis, not the reverse.

### Grilling decision: intentionally wordless heads

#### Category typography versus leaf presentation

The Fable inspection exposed a shared renderer defect, not a change to the authored syntax: Minimalism stages 4-5 contain `c_q`, labelled C, with `silent: true`, no word, and no children. X-bar stages 4-5 contain the equivalent `c0`. `TreeVisualizer` gives category typography only to nodes with children or nodes satisfying `shouldExpandPreterminalLeaf`, which requires a distinct nonempty word. Consequently, wordless category labels receive terminal typography and dashed extensions. Removing `silent` alone does not solve this: unclassified abstract leaves use the same italic muted text and dashed extension.

Local production canvas checks covered silent C, abstract I without a silence flag, V with overt buy, N retaining silent book, silent category-only DP, explicit trace notation, and a null symbol. Word-bearing V/N materialize a category plus lexical display child; wordless C/I/DP do not. Explicit traces and nulls remain separately recognized. Actual Fable examples include abstract I in X-bar stage 3, silent v in Minimalism stage 2, and a category-only lower DP in X-bar stage 5. The latter must not be converted into a t merely to select a drawing style.

Proposed correction: distinguish a category label from lexical or trace/null content before choosing typography and branch treatment. Preserve model-authored silence, copy/trace notation, and the absence of a word. Do not introduce null children, restore omitted words, or decide that a category-only lower occurrence is an ordinary unmoved head. The exact silence emphasis for category-only occurrences remains a presentation decision. This pass inspected source and production canvas helpers only; no renderer changes or browser verification were performed.

Francis approved muted colour with category geometry for silent wordless categories. The local renderer now includes wordless leaves recognized by the existing category classifier in category-label drawing, and excludes them from terminal-label drawing and its dashed extension. Explicit words and token positions take precedence; recognized trace/null notation retains its existing treatment. No new children, linguistic classifications, or camera/layout changes are introduced. Focused tests cover C/T/I/v/D/N/DP, silence flags, overt and retained silent words, traces, and nulls. The full gate passes with 1,033 tests. The rebuilt inspection page is available; browser verification remains pending permission. This does not claim the existing category-name recognizer covers every open label.

Research check after Francis questioned the appearance: academic diagrams do allow a category/feature-labelled head to terminate a branch without a separate word or null beneath it. In [Embick and Noyer's handbook draft](https://dingo.sbs.arizona.edu/~hharley/courses/PDF/EmbickNoyerDM.pdf#page=13), example (17) ends in v and T[past]; example (19) separately shows exponents, including zero under v. This directly distinguishes abstract structure from realization. [Chomsky's Bare Phrase Structure](https://biolinguistica.wordpress.com/wp-content/uploads/2010/03/chomsky-bare-phrase-structure.pdf#page=10), discussion of (32), treats heads as terminals themselves rather than obligatory category-over-word layers. Its schematic diagrams alone should not be treated as fully lexicalized analyses. [Bošković's Null C in English as an Enclitic](https://boskovic.linguistics.uconn.edu/wp-content/uploads/sites/2801/2019/05/nullCridjanovic6.pdf#page=1), example (1a), uses bare C for the null complementizer in bracket notation. Conversely, [BU's CP handout](https://ling-blogs.bu.edu/lx422s23/assets/pdf/lx422-11-cp-article.pdf#page=11) draws explicit null notation under C alongside bare v and abbreviated angle-bracketed copies. The two downloaded tree PDFs and the Chomsky diagrams were visually inspected. These examples establish legitimate alternatives, not their statistical prevalence or the correctness of every Fable node. Do not impose a universal null-child requirement on aesthetic grounds. Compact academic geometry also does not validate Babel's particular spacing, colours, or animation. No prompt or renderer change follows from this research check.

Francis accepts Astra's abstract T without a word in stage 5, followed by its realization as did in stage 6. Its bare visual presentation is also acceptable when it follows the model's analysis. A preference for null notation in some cases does not authorize adding nulls or words everywhere. His concern is the number of apparently leafless nodes and whether they reflect real omissions, not a requirement that every head have a pronounced child. Finding 07 remains open for the other cases; this particular abstract-head question is settled.

Correction to my grilling example: Astra did not omit buy during selection. Its raw record stores `label: "V"` and `word: "buy"` on the same node. Babel derives the displayed word beneath that category. The saved Replay data and production screenshots show [F7 Select buy](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05/review-webapp/astra-minimalism/analysis-1/replay-06.png), [F8 Project V above buy](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05/review-webapp/astra-minimalism/analysis-1/replay-07.png), and [F9 External Merge into VP](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05/review-webapp/astra-minimalism/analysis-1/replay-08.png). That sequence already works. The separate F11 selection is the authored light verb v, not lexical V/buy. Do not turn my mistaken example into a renderer fix. Silent lower copies losing words and moved material being rebuilt remain separate evidenced problems.

### Grilling clarification: operation heading placement

Francis wants the white External Merge heading immediately above Inputs, not displaced to the top right. This is a derived structural micro-step, not a request to make the model author an External Merge relation.

Git history confirms the older Replay panel always rendered `activeRecipeDisplay` in a white heading before its support lines. Commit `3aebc8c`, "Integrate the relation renderer pipeline", on August 28 introduced the condition that hides this heading whenever the top-right operation label is shown. The comparison distinguishes `External Merge` from `External Merge into VP`, so an ordinary recipe difference removes the primary heading. Selection/projection can behave differently because their operation title already includes the recipe. This is a production UI regression. No UI fix has been applied during grilling.

### Grilling clarification: the model chooses the lower occurrence

Francis reaffirmed that the model chooses whether to author a full silent copy, a trace, or another representation justified by its analysis. Babel displays that choice. An authored silent lexical copy retains its lexical content and is shown unpronounced; an authored trace can use Babel's display notation without becoming a different syntactic object. Do not force these into a closed model-facing menu or assign one representation automatically by framework.

The renderer already contains this distinction. `formatAuthoredWitnessSurface` preserves lexical text and nulls; the lexical movement display path adds a chain index without converting a word into a trace. `materializeReplayPreterminals` retains a silent `word` as a silent displayed leaf. Tests in `replaySilentSemantics.test.mjs` and `relationProductionRepair.test.mjs` cover these behaviors. One older test description in `replayMovementSequencing.test.mjs` still says a copy becomes a trace, but its assertion checks only the returned chain index. Correct that misleading wording with the eventual fix; it is not evidence that trace substitution remains approved.

The prompt disagrees with this representation in two places: the terminal-field instruction and its final checklist forbid `word` on silent occurrences. It does not ban every lexical string in `label`, but a record using `label: "N"` and `word: "John"` loses John when it follows that instruction. Requiring retention of structure and lineage does not preserve that text.

Agreed direction on 8 September, with implementation deferred: separate retained lexical content from pronunciation. A model can retain the word and mark the occurrence silent; silence excludes it from the pronounced sentence without erasing it from the drawing. The existing terminal-surface helper already excludes an explicitly silent terminal even if it retains `word`. Exact field wording and complete parser/Replay behavior, including silent descendants, still need verification before implementation. Do not backfill the saved model output with invented lexical content, and do not present this clarification as a fix for the separate movement-recognition and timing defects. Continue grilling rather than pausing the wider investigation to draft or implement this individual fix.

Fable's original X-bar S5 authors `dp1` as a silent `DP` with no children or word. Its `features` array includes `trace`, and the wh-movement relation anchors `trace` to `dp1`. S4 similarly labels the lower head `I` and identifies it as a trace. Francis clarified that the silent DP can itself represent the trace of the moved phrase; a separate `t` symbol is not required. Here the authored relation explicitly identifies that role. Silence or a bare category alone would not establish it.

The proposed requirement for additional trace notation in `workspaceForest` is withdrawn. This example is not a missing-trace defect merely because it displays `DP` rather than `t`, and it does not require another decision about who chooses the representation. Preserve the model's analysis and distinguish notation from movement recognition and timing. The prompt's erasure of lexical content from retained silent copies remains a separate confirmed problem. No production change is authorized by this clarification.

### Grilling decision: relation order within a stage

Astra X-bar S5 is a completed wh-movement state. Its statement is "Move the complete wh-NP to Spec CP." Its relations list wh licensing first, anchored to the new `frontedNP`, then A'-chain, linking `frontedNP` to `objectNP`, then lexical government. These become relation frames 36-38. The Stage Record describes movement establishing licensing; the relation list is not explicitly described as a chronology.

Replay gives separate relations their authored-order moments, and recognized movement is meant to introduce the landing at its owning moment. Recovering this chain as movement without settling ordering therefore leaves an earlier licensing moment referring to a landing withheld until the later chain moment. This is an additional requirement for fixing findings 09-10, not a reason to reorder the saved analysis silently. The name A'-chain alone must not trigger movement when no structural change occurred.

The prompt permits multiple connected operations when their order is clear in Stage Record, but never explicitly assigns chronological meaning to relation-array order. Francis agreed on 8 September that this must be made explicit: relation order follows the model's derivational chronology, agrees with Stage Record, and establishes prerequisites before dependent relations. He expected a chronological derivation already to imply this. The defect is the mismatch between a prose chronology requirement and the ordered list Replay actually consumes, not absence of a chronological stage contract.

This preserves separate ordered moments without making Babel infer chronology from prose. It does not authorize a new timing field, an ontology menu, per-frame model authoring, or treating every relation as a structural operation. Implementation remains deferred. Simultaneous claims and the treatment of existing outputs remain to be discussed. Regression coverage must include a movement followed by a relation requiring its landing, plus a conflicting saved order that must not be silently rewritten or reported as correct playback.

### Focused movement check: saved outputs

The 8 September read-only follow-up traced all eleven movement relations through current production classification and Replay. It used the saved Astra normalized records and the already labelled Fable inspection copies, whose only source edits are described above. No new model output, source repair, browser session, or production change was made. These results extend findings 08-13 rather than create a second checklist.

All eleven have an identifiable source in the preceding stage, a lower occurrence in the current stage, and a landing sharing the source's authored lineage. All eleven currently dispatch to Tier 3. A follow-up inspection of the anchored structural context establishes head versus phrasal movement in each saved case, as listed below. This is not certification of every linguistic claim in those analyses.

| Model | Stage / relation frame | Earlier source / current landing | Movement | First visible landing frame |
| --- | --- | --- | --- | --- |
| Astra Minimalism | S4 / F21 | `objectDP` / `edgeObjectDP` | Phrasal | F20, External Merge |
| Astra Minimalism | S5 / F32 | `johnDP` / `raisedJohnDP` | Phrasal | F29, External Merge; lexical rebuilding starts at F26 |
| Astra Minimalism | S6 / F39 | `finiteT` / `raisedT` | Head | F35, Project; did selection starts at F34 |
| Astra Minimalism | S7 / F44 | `edgeObjectDP` / `frontedObjectDP` | Phrasal | F42, External Merge |
| Astra X-bar | S4 / F33 | `tenseI` / `raisedI` | Head | F28, Select |
| Astra X-bar | S5 / F37 | `objectNP` / `frontedNP` | Phrasal | F36, wh licensing |
| Fable Minimalism | S3 / F23 | `d_john` / `d_john_hi` | Phrasal | F17, Project; John selection starts at F16 |
| Fable Minimalism | S4 / F30 | `t_did` / `t_did_hi` | Head | F26, Project; did selection starts at F25 |
| Fable Minimalism | S5 / F34 | `dp_wh` / `dp_wh_hi` | Phrasal | F32, External Merge |
| Fable X-bar | S4 / F30 | `i1` / `i2` | Head | F30, its own relation moment |
| Fable X-bar | S5 / F33 | `dp1` / `dp3` | Phrasal | F33, its own relation moment |

The four head movements retain an I/T head from its earlier position and place its new occurrence beside a C head inside a complex C node. Six phrasal movements carry an explicitly structured DP/NP into a phrasal landing position. Fable Minimalism's remaining case carries bare D John from a position beside vP inside vP to a position beside TP inside TP. That context distinguishes the whole nominal in a specifier position from a head incorporated into a complex head, despite D being childless. No relation-title parsing, Stage Record interpretation, extra node property, or model-facing subtype menu is needed to establish these distinctions in the saved examples.

The follow-up records each exact node, its parent, siblings, and ancestry before and after movement. Its sample-specific assertions confirm four complex-head landings, six DP/NP landings, and the bare nominal case. These observations are evidence for the repair, not a general classifier implementation or a claim that the same small set of label checks covers every future analysis. Temporary reproduction: `/tmp/babel-movement-context-check-2026-09-08.mjs` and its `.json` output.

The first nine cases expose the landing before the movement relation and already show the source silent at the start of that stage's playback. Both Fable X-bar cases instead use the fallback's explicit `priorAnchors` to introduce the changed structure at the relation moment. Their timing is not the same defect, but neither has a movement trajectory. In Astra's final successive-cyclic move the immediate source is `edgeObjectDP`, not the older thematic `objectDP`. In Fable X-bar, `landingSite: cp1` names the containing CP while `movedPhrase: dp3` names the actual landing. Likewise `landingHead: c1` is the complex host, not the moved I `i2`. Adding aliases without checking exact endpoints would create new errors.

Isolated controls replaced each relation with a neutral test name and known source, trace-witness, and landing roles, leaving the trees unchanged. The source and witness deliberately referenced the same lower node. All eleven then completed the existing path recipe. Thus the current gate demands an additional role, not a third distinct object. These controls bypass the known naming/signature blocks solely to test subsequent code; they remove other relation content and are not proposed repairs or corrected model answers.

Those controls exposed three further blockers:

- **Transition detection excludes legitimate representations.** Seven earned movement timing; four did not. Three have an abstract earlier I/T with no `word`. Fable X-bar's fourth case replaces a structured DP with the compact category-typed trace already accepted during grilling. `sourceBecameLowerOccurrence` requires a matched node that was previously both a leaf and word-bearing. The earlier DP is not a leaf, and the abstract heads are not word-bearing. Do not force a different model notation to satisfy this test. Repeating an unchanged completed stage correctly earned no new movement in all eleven controls; preserve that safeguard.
- **Tier-2 movement is not connected to Replay movement ownership.** The controls all produced Tier-2 trajectory plan items, but their Replay relation moments still had no movement handling. `buildAuthoredRelationLinksForFrames`, pre-movement source restoration, and relation placement use registered trajectory identity rules instead of the recovered Tier-2 result. Even in the original outputs, the name-based `stepRepresentsMovement` helper can return true while the actual link remains `authored-anchor-link` and the step has no `trajectoryKind`. A movement-looking label is not proof of working movement playback.
- **Head/phrasal selection remains unreliable.** The `movement.path` lowering branch emits phrasal, roll-up, or sideward trajectories, never head trajectories. All four same-workspace head controls therefore became phrasal paths. Separately, a direct call to `isHeadLikeResolvedRelation` on the real Fable John nodes returned true because both labels are D. Fable's Stage Record describes subject Internal Merge to the specifier of T. Reusing that helper blindly would also be wrong.

Relevant code: [path recipe and transition checks](../../../replay/relations/tier2FacetRecipes.ts#L384), [lowering](../../../replay/relations/tier2RenderPlanCompiler.ts#L289), [source restoration](../../../replay/replayCompiler.ts#L1592), [fallback ownership](../../../replay/replayCompiler.ts#L1878), [head-like helper](../../../replay/replayCompiler.ts#L4969), and [Replay links](../../../replay/replayCompiler.ts#L7067). The focused assertions also confirmed unchanged raw-response hashes. Temporary reproducibility files are `/tmp/babel-movement-check-2026-09-08.mjs` and `/tmp/babel-movement-check-2026-09-08.json`; the findings here do not depend on retaining those temporary files.

Implementation already implied by agreed rules: preserve the previous source until the movement moment; introduce its complete landing, authored lower form, path, and required parent together; connect classification to Replay; support abstract heads and compact traces; keep endpoint recovery model-invisible. Regression coverage must cross these dimensions, include Fable X-bar's already working atomic introduction, and check that existing chains do not move again. Diagnostics must distinguish unresolved roles, missing nodes, failed continuity checks, unsupported subtype, and missing Replay integration. The current empty transition list does not explain which check failed. This check did not resolve CP's horizontal coordinates or verify pixels, zoom, or camera fitting.

The proposed generic-curve question is withdrawn. Failure of the existing classifier was not evidence that the model omitted the information. All eleven saved examples provide the head/phrasal distinction through the anchored context. They therefore call for classifier and Replay fixes under the existing decisions, not an additional subtype field, a forced notation, or a new fallback policy. Any future proposal for unresolved-subtype behavior must first identify a concrete case that remains unresolved after checking all permitted authored evidence.

### Movement recognition and Replay implementation

Francis subsequently approved fixing movement recognition and Replay together.
The local implementation uses `replay/relations/movementEvidence.ts` to recover
exact source, lower witness, landing, and supported head/phrasal context from
authored anchors and stage trees. It does not parse relation titles or Stage
Record prose, add model-facing fields, rename authored roles, or edit the trees.
The same recovered movement feeds Tier-2 lowering and Replay, subject to the
existing claim-ownership rules. Accepted Tier-1 head/phrasal trajectories now
use that timing evidence when their registered kind agrees. A malformed exact
Tier-1 claim is still not salvaged through Tier 2.

Replay restores the actual preceding source until movement, including earlier
silent descendants. Movement introduces the complete landing, its authored
lower form, the path, and the shortest new parent chain needed to connect the
landing to existing syntax together. Higher projections keep their own steps. Abstract
heads need no earlier word. A compact trace can retain its authored label.
Repeated completed chains do not earn another transition. Head drawings use
the existing head attachment rather than the phrasal default. Root lineage,
not merely a shared descendant, establishes endpoint identity for the path.

The saved regression input is `fixtures/movement/saved-qualification.json`.
It contains the four complete expanded stage sequences and the original raw
response hashes. Its Fable inspection corrections are labelled: wrap malformed
values lists and, for Minimalism, append the missing final delimiters. These
are the existing inspection copies, not new production repair behavior.

`tests/recoveredMovement.test.mjs` checks all eleven saved movement cases against
the production render plan and Replay. All five Fable cases and four Astra cases
now pass complete landing/source/immediate-parent timing checks. Two additional
regressions cover multi-parent attachment in Fable Minimalism and Astra X-bar.
At that first movement pass, two exceptions remained. The shared binding work
below subsequently resolved the first:

- Astra Minimalism S6 uses the exact registered name `Head movement`, but its
  authored roles do not satisfy that Tier-1 signature. It remains Tier 3, with
  an internal `registered-signature-incomplete` explanation and exact endpoints.
  Changing the signature or ownership policy requires a separate decision.
- Astra X-bar S5 lists wh licensing before the A'-chain while anchoring licensing
  to its new landing. Replay preserves that order and reports which earlier
  relation needs the later landing. It is not certified as atomic movement
  playback, and the original response has not been reordered.

Additional checks cover missing/duplicate references, contradictory prior
source anchors, unrelated root lineages, host-versus-occurrence confusion,
unchanged chains, and compact traces. Internal movement diagnostics identify
unresolved roles, missing nodes, unsupported structural context, missing prior
continuity, and signature/order conflicts. Qualification frame evidence now
retains those messages. They introduce no public warning UI.

Verification on 10 September: `npm run verify:all` passed typechecking, all
1,067 tests, and both committed parse-contract checks. The saved-movement suite
has 34 tests. Existing Replay snapshots were not regenerated; canonical Orchard
cards still pass Tier-1 verification. The test fixture generator supplies root
lineage for the stricter path condition. No new Babel generations, prompt changes,
provider-setting changes, or Tier-3 redesign were made. Fable 5.1 reviewed the
work through the approved Claude Code account; that is separate from Babel's
four-call generation run.

#### Production browser follow-up

With permission, one integrated production-app pass traversed all 143 then-current
frames across the four saved analyses, followed by targeted regression captures
as defects were corrected. This used the real App and TreeVisualizer, not a
parallel SVG renderer. Browser and Node Replay counts were checked against each
other. Saved bundle stages match the committed movement fixture; original raw
outputs remain unchanged. Only localhost requests were allowed; no provider
request was attempted. The owned browser was closed after each pass. The
pre-existing Babel development server was not restarted or terminated.

The final 47 captures check every movement moment and its preceding frame,
mobile moments/final views, zoom and pan. Actual SVG paths now exist for all ten
drawable movements. This is stronger than merely finding a trajectory in the
render plan. Prev, Next and keyboard scrubbing work in all four analyses;
Fable Minimalism also passed Play/Pause across a movement moment. Browser errors
and geometry-binding failures were empty. The exact Tier-1 exception still has
no head arrow; the ordering exception has an arrow but still reveals the landing
early. These exceptions are not counted as correct atomic playback.

Local before evidence: `/tmp/babel-movement-visual-DqQ12X/`. Final evidence,
screenshots and recording: `/tmp/babel-movement-visual-wtlQ92/`. These temporary
files are review evidence, not another implementation plan or committed assets.
Frame numbers below use the specified before/after capture set; folding a
redundant structural step changes later frame numbers, not authored stages.

| Existing finding | Exact symptom and root cause | Ownership / severity | Correction and regression status |
| --- | --- | --- | --- |
| 08-13 | Fable Minimalism before F20/F23 and Fable X-bar F30/F33 had recognized trajectories but no visible arrows. The binder demanded a lexical endpoint beneath an authored wordless D, T, I or DP. | Plan binding and renderer; high visual loss, no missing model dependency. | Fixed in both Tier-1/Tier-2 plans and head-path refinement: use that exact category's shell bottom. Tests bind all ten saved paths through real geometry resolution; terminal ambiguity stays strict. No invented lexical child. |
| 09-13 | Before Fable Minimalism F23, new `c_complex` was detached from `tp_full`; `cp1` appeared at F24. Astra X-bar F29 similarly withheld `questionCbar` until F30. Replay grouped only the landing's immediate parent. | Replay; high chronological distortion. Completed model stages already connected these structures. | Two tests first reproduced the failures, then passed with shortest-new-parent-chain grouping. Final Fable F23 includes CP; Astra F29 includes C-bar. Astra's higher CP still gets its own Project step. No layout or authored-tree changes. |
| 08-13 | A saved movement renamed into an already valid Tier-1 signature took old timing and could expose its landing shell early. It also received a false unlicensed-drawing diagnostic. | Replay/diagnostics; high timing error and misleading cause. | Accepted matching Tier-1 head/phrasal trajectories now share recovered transition timing. Separate head and phrasal controls prevent early landing and false rejection messages. Signature acceptance is unchanged. |
| 08, 24 | Generic `head`, `source`, `target` or `trace` roles on government/licensing could generate movement-failure messages without a movement claim. | Diagnostics; misleading attribution. | Fixed candidate gating. Specific occurrence roles, shared endpoint lineage or a complete source/witness/landing association are needed before reporting movement failure. Negative government/licensing tests added. |
| 08-13 | A complex head with an explicit lexical/null exponent child was classified differently from a childless host merely because it had children. | Movement recognition; possible false subtype. | Fixed for supported complex-head structure; two exponent forms tested. Primed projections are excluded from this head-host check. This remains contextual recognition, not a universal label-based head/phrase classifier. |
| 08, 30-38 | Astra Minimalism S6 has exact `Head movement` but `higherOccurrence`, `lowerOccurrence`, `attractingHead`, `complexHead` failed the literal signature. Tier-2 ownership blocked the same claim despite complete endpoints. | Registry/binding policy; high avoidable fallback. | Fixed after Francis approved equivalent-role binding. Registry v12 accepts the complete description, verifies its host/complex anchors, and uses the original Tier-1 drawing and atomic Replay timing. Malformed primaries remain protected. |
| 09-13, 24 | Astra X-bar S5 wh licensing references `frontedNP` before the later A'-chain introduces it. The earlier relation requires the new anchor; the Stage Record describes a different order. | Authored relation order plus Replay exposure; high inconsistency. | Original order preserved. Both involved relation moments now carry the exact dependency diagnostic. No general linguistic rule that licensing always follows movement is inferred. |
| 23, 25 | On 390px mobile, measured category text falls to roughly 3-4px in several frames; Replay panels and controls collide. Stacked fallback connectors still cross the reading area. | Shared fitting and UI composition; high usability failure. | Still open. Actual paths, functioning controls and an error-free console do not establish readable mobile layout. No Tier-3 or shared-camera redesign was made here. |

#### Recognition: remaining root causes

Fable's independent read-only review confirmed that role handling is split
between the registry, Tier-2 vocabulary, movement evidence and render families.
The concrete contradiction is that ownership normalizes some role spellings
while Tier-1 validation uses literal keys. An anchor can therefore count as
owned by a recipe that refuses to accept that same anchor. Adding aliases to
only one list does not fix this inconsistency.

A second reproduced boundary needs care: change the saved Fable subject relation
to an open relation with `source`, `traceWitness`, `landing`, then remove the
lower occurrence's explicit silence. The new movement evidence reports
`MOVEMENT_LOWER_FORM_UNPROVEN`; the older path recipe can still earn a static
`movement.path`, but earns no movement transition. Do not automatically erase
that path or grant it animation. A completed dependency drawing and a newly
occurring movement are different claims. The next binding work must make this
distinction explicit and ensure both use consistent endpoint/type evidence.
It must test overt lower occurrences, completed chains, and genuinely new
movement separately.

Fable's bounded follow-up review produced one further reproduced attachment
failure: a new sibling wrapping an existing TP was not recognized as a connection
to existing syntax. The parent search now recognizes existing syntax inside
that sibling, and the sibling is built before the movement attachment. A test
also anchors an intermediate complex head and checks every folded host for early
appearance and duplicate construction. Prerequisite filtering excludes the
whole folded host chain, not only its topmost node. Existing inactive-host
filtering already hides the complete chain; the review's possible early-host
leak was conditional on code absent from its excerpts, not a demonstrated bug.

Two diagnostic corrections follow that review: a registered head/phrasal kind
that contradicts recovered context now reports `MOVEMENT_KIND_CONFLICT` rather
than silently bypassing recovered timing; ordering diagnostics now use the
transition actually earned by the surviving claim. This does not resolve a
contradictory authored subtype for the model.

Remaining review limits: generic `head` and `target` can identify different nodes
and become ambiguous in the current role picker; three-occurrence chains and
unfamiliar projection conventions need the planned binding work. The phrasal
post-fit refinement reads an explicit witness for terminal-source geometry,
whereas the head refinement can use the exact source when the witness is absent.
The initial bound path still exists; this is a refinement consistency gap to
test during the remaining renderer review, not a missing-arrow claim. Hypothetical
undefined-input failures must first be reproduced through the real dispatch and
normalization path; no extra defensive wrappers were added for fabricated
accepted-facet objects. The reviews were read-only, not independent browser or
full-suite executions, and did not certify the entire renderer.

Subsequently approved and implemented: bind equivalent role spellings once,
then use the same binding for recipe validation, ownership, drawing and Replay.
Retain original role text and record why each binding was accepted. For Astra,
the lower/higher occurrence roles identify the two occurrences; its extra head
and complex-head anchors supply context rather than another movement endpoint.
Verify those relationships in the actual tree. Do not accept arbitrary extra
roles or drop contradictory ones. A complete equivalent expression can satisfy
Tier 1; an incomplete claim must not be rescued by quietly weakening its recipe.

This should be tested across all relation families, including negative controls:
generic source/target/domain must not automatically imply control, covert
movement, Case or idiomaticity. Tree geometry checks an authored claim; it
cannot supply missing linguistic meaning. All role names remain open to models.
No new associations field, primitive menu or model-authored display instruction
is proposed for this correction.

#### Shared role binding

Francis approved complete equivalent descriptions qualifying for the existing
Tier-1 drawing, while reaffirming that Tier 1 needs the whole drawing and Tier 2
needs independently complete smaller claims. Production registry version 12
implements this with a shared vocabulary and per-recipe meanings. It does not
relax required participants, cardinalities, paired lists, or unknown-role checks.
Ambiguous and conflicting bindings identify the authored roles and references.
Original fields remain in `primaryRelation`, literal displays and render-plan
provenance; bound keys are used for lookup only. Replay retains original role
wording for display. Companion Case/Agree and Phase/Transfer lookup uses the same
binding and does not compose an invalid primary.

Astra Minimalism S6 now earns the original Tier-1 head-movement drawing.
`higherOccurrence` and `lowerOccurrence` identify its endpoints;
`attractingHead` and `complexHead` are checked against the actual landing parent
and sibling. Wrong context anchors remain diagnosed fallback. Its source,
landing and attachment now pass the same atomic timing checks as the other
saved movements. The Astra X-bar licensing-before-movement conflict remains
open and is not reordered.

Movement recovery now uses the shared role vocabulary too. Separate anchors
may distinguish the moved occurrence from its enclosing landing site only when
root lineage and containment prove that distinction. Unrelated candidates and
multi-item endpoint arrays remain unresolved. The unsafe `phase head` to
`phase` equivalence is removed; finding 22 still needs actual projection and
Transfer-composition work.

Regression coverage includes every declared production role's spelling variants,
eight families' equivalent drawings, untouched original records, incomplete
Tier-1 protection, independent Tier-2 siblings, ambiguous/conflicting aliases,
head-context checks, Case/Agree ownership, and all eleven saved movements.
The no-invention check verifies bound-role provenance and recovered endpoints,
including deliberately wrong roles and arrows. This is not a solution for
arbitrary unfamiliar vocabulary, compound value pairing, extra-context policy
in other families, or the remaining layout defects.

Fable 5.1's bounded read-only review found two regressions in the initial draft:
synonyms could take over deliberately open roles, and a bare `head` could bind
to the landing without distinguishing it from the host. Both were reproduced
and fixed. Open-role competition now leaves those original roles untouched;
generic `head` needs unique source/landing root-lineage evidence. An additional
negative check suppresses successful-movement diagnostics on registered
nonmovement claims such as BlockedExtraction. Scalar `goal`/`goals`/`target`
alternatives were verified to produce identical MultipleAgree geometry; the
existing contract accepts a scalar or list. Ambiguous `trace` roles remain
diagnosed rather than being assigned by elimination. The review did not execute
tests or certify the full renderer.

Final verification: typecheck, all 1,091 tests and both committed parse-contract
checks passed. No committed Replay snapshots were regenerated. The integrated
production-browser pass captured 47 desktop/mobile/zoom/pan states, confirmed
all eleven movement paths and exercised Prev/Next, the slider and Play/Pause.
No browser errors or geometry-binding failures occurred. Evidence and recording:
`/tmp/babel-movement-visual-fdrdNX/`. After the review corrections, all four saved
Replay counts and captured movement endpoints were rechecked unchanged: Astra
Minimalism 36, Astra X-bar 38, Fable Minimalism 27, Fable X-bar 36. The reduction
from Astra Minimalism's former 40 frames comes from its newly recognized atomic
head movement, not removal of an authored stage. Mobile fitting and control
overlap remain visible, as does the Astra X-bar order conflict. The owned browser
and review processes exited. No new Babel generation or provider-setting change.

For chronology, the current live prompt already asks for relations in Stage
Record order with prerequisites first; these saved answers predate that wording.
The remaining requirement is neutral: an anchor used at a relation moment must
be available at that point in the authored derivation. If licensing triggers a
later movement, it can refer to the pre-movement object. If it concerns the
landed object, that object must have been introduced. Babel must not choose
between these analyses or reorder relations by reading the prose. The historical
response stays unchanged; any reordered inspection comparison must be labelled.

#### What finite drawings can and cannot solve

A finite set of graphics can express many unbounded combinations. Vega, for
example, separates a finite mark vocabulary from data, encodings and grouped
composition. That is a useful graphics analogy, not a solution to semantic
interpretation. [Vega marks](https://vega.github.io/vega/docs/marks/).

Babel still has to establish what an openly named relation claims. There is no
evidence for a deterministic method that correctly interprets every arbitrary
name. Better language models might help interpret unfamiliar wording, but an
extra interpreter would add another fallible analysis, cost and latency. A
bounded vocabulary with evidence checks and honest fallback remains the simpler
design. Expanding tested equivalents helps; blindly expanding strings does not.

Head versus phrase cannot safely come from "has children" or "label ends in P"
alone. Bare Phrase Structure permits one object to be both minimal and maximal
depending on its context. [MIT phrase-structure notes](https://web.mit.edu/norvin/www/24.902/phrasestructure2.html).
Traditional head adjunction is one supported configuration, not the only
linguistic account of head movement. [MIT head-movement notes](https://ocw.mit.edu/courses/24-951-introduction-to-syntax-fall-2003/ee67913c61d552bf1a69276883b11e0c_ho_head_mvt.pdf).
The implementation supports the saved configurations; unfamiliar projection
conventions and ambiguous multi-occurrence chains remain recognition limits.

#### Formatting and transport: recommendation unchanged

Keep four questions separate: is the response readable JSON; do its fields and
references resolve; does Babel recognize the authored claim; does its drawing
execute correctly? A repair to one cannot prove the other three. Changing JSON
to YAML, XML or a custom notation would not remove cross-stage identity or
linguistic consistency requirements. No new evidence explains Fable's final two
missing delimiters, and no new paid experiment was performed to speculate on it.

Constrained decoding can enforce a supported output grammar without imposing a
linguistic ontology. However, it is not a drop-in cross-provider solution for
the present representation. OpenAI supports recursive schemas, but requires
closed object properties in strict mode. [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
Claude's current documentation excludes recursive schemas and requires closed
object properties; truncation can still leave incomplete output. [Claude
Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).
Babel's recursive trees and open anchor/value keys would therefore need a
different encoding for a common strict schema. Open strings could remain open,
but that encoding change and its effects on models need approval and testing.
Schema compliance would still not prove correct references or linguistics.

Separately framed JSON records could contain a malformed stage without making
every other record unreadable. RFC 7464 explicitly supports recovery past an
invalid record. It does not guarantee that a record is present, valid, ordered
correctly or linguistically consistent. [JSON Text Sequences](https://www.rfc-editor.org/rfc/rfc7464.html).
That is a future containment option, not a repair or an adopted transport. For
now preserve the original answer, expose exact internal diagnostics, and keep
inspection copies distinct. No helper, retry, public failure policy or provider
format was changed during this follow-up. Status remains in ROADMAP.md.

### Open grilling question: relation text on the tree

Astra Minimalism F18 contains compact valuation text and a full locality explanation in the same Agree `values` object. The renderer places both in the feature plaque. The explanatory row reads "The object is the closest goal when v probes its VP complement." It is not copied from Stage Record. The whole string is a valid named value; its suitability for a compact plaque is a different question. Both drawing and bounds cap rows at eight; finding 17 concerns omitted display content, not evidence that this three-row example itself exceeded the cap.

Francis's tentative preference is to keep all authored values associated with their plaque and solve space as a display problem. He considers automatic prose/notation separation unrealistic, but explicitly has not approved the replacement design. He finds a larger-reading-view button ugly and wants to leave overflow undecided, even if expansion eventually proves necessary. Do not treat this as approval to add a button, reading view, or any other overflow interaction. The earlier proposal to move explanatory values to Replay must not become an implicit implementation decision.

Current code does not classify Agree strings as notation or prose. `verbatimRows` puts every authored value into plaque rows; the nonmovement Replay support path also reads those values. Thus these values can appear in both places already. Heuristics based on length, punctuation, language, or names such as locality cannot reliably establish linguistic importance or explanation status. Adding model-authored display hints would make routing explicit but expand the contract and couple model output to UI; it is not an approved solution.

Recommended direction for discussion: retain all of a plaque's authored values as its content, and keep Stage Record as stage prose. Replay may mirror relation values from that same record, but must not become the destination for a guessed subset. This rule is local to drawings that already use plaques, not a demand to turn every relation value into a plaque. Preserve literal text and array order. Use measured text wrapping and bounds, not semantic filtering, fixed character counts, silent row caps, or automatic summaries.

The unresolved tradeoff is finite screen space. Unbounded text cannot all remain visible and readable beside a large tree. Growing every plaque can force the camera to shrink the tree or create collisions; scrolling or expansion needs usable mobile/keyboard behavior, stable Replay geometry, and an explicit export policy. A full reading view opened from an oversized plaque is a candidate, not an approved design. Any compact view must disclose overflow and make all content reachable. Do not promise zero layout problems before testing long notation, prose, many rows, simultaneous plaques, small screens, zoom, and exports. No implementation or visual redesign is authorized here.

Two further offline probes exposed findings 28-29 while checking whether Replay could serve as the complete text view. In a nonmovement relation, authored `notation: "x_i"` becomes `Notation: x i`. In a movement relation, supplied values disappear from Source/Landing support. These are runtime function results plus inspection of the detail-block path, not browser captures or provider calls. Both must be addressed before promising exact, complete relation text in Replay.

### Grilling clarification: convergence checks

Finding 06's saved offline probe adds a separate silent root beside Astra's final CP. Normalization accepts the analysis and selects the CP as `tree`; the other root remains in `derivationStages` but is absent from that selected final tree. `selectCommittedDerivationRoot` accepts exactly one sentence-matching candidate, which is not the same as requiring the workspace to contain exactly one root. App passes `activeParse.tree` to Canopy; the multi-workspace Replay path is enabled only when animated. This is not evidence that Astra actually authored an extra final root in the original response.

Francis expects the model to complete and converge its analysis. I prematurely turned this deliberately altered test into a proposal for showing leftover trees in Canopy. That proposal is withdrawn. The established finding is only that this altered record still passes normalization and produces a selected final tree. Its policy implications remain unresolved under finding 06. Calling it a convergence-check requirement wrongly suggested an agreed validation policy and blurred structural accounting with linguistic convergence.

Do not equate an ungrammatical input with an unfinished analysis: a complete account of its ungrammaticality is still possible. Neither a linguistic convergence validator nor a new final-view requirement is agreed. This probe does not authorize deleting leftovers, automatic repairs, rejection, retries, public warnings, or a Canopy redesign, and is not evidence that either model produced this error.

### Open grilling question: repeating a generation after a transport failure

Finding 27 concerns existing app behavior, not an extra call observed in the September run. The active provider route wraps `generate` in `runWithTransportRetries`, which defaults to at most three attempts, subject to the remaining request time. Network errors, timeouts, HTTP 429, and HTTP 5xx can trigger another attempt. Normalization and JSON repair happen outside that loop, so these are not retries prompted by Fable's malformed fields.

A timeout does not establish whether the provider accepted or completed the original request. Calling generation again can therefore repeat work whose result was not received. This is not a claim that the saved run incurred duplicate charges. Its four generation POSTs remain the established count.

Francis explained that retries were originally intended mainly for Gemini infrastructure/network errors and opposes repeated rate-limit attempts. He confirmed that "something failed" means Babel received an answer but could not parse, validate, or render it. Agreed: preserve that answer and its actual diagnostics; do not automatically generate a replacement because of a downstream processing failure. This is distinct from local JSON repair, whose policy is not settled by this decision, and does not decide public error presentation.

Also agreed on 8 September: an explicit rate-limit response stops automatic retries immediately. Do not make the current two further short-backoff requests after HTTP 429. Preserve the response and diagnostic; this decision does not prescribe a public warning or authorize a scheduled retry.

Francis also approved retaining at most three total attempts for genuinely temporary network/server failures, subject to the request deadline. This means the first attempt plus up to two retries, not three additional retries. Record each attempt and apply the agreed exclusions. This is an agreed bound, not evidence that three is an empirically optimal number.

Distinguish fetching an existing response from resubmitting generation; the current outer loop can do the latter. An uncertain failure can mean a replacement generation repeats work, so recovering an existing request where possible must remain distinct from starting again. Exact timeout/recovery behavior still needs verification when implementing the decision. No implementation or new provider call is authorized during grilling.

## Cost audit

The saved runner estimated both models at $10 per million input tokens and $50 per million output tokens. The figures below reproduce its estimate. They are not a provider invoice or a new balance check.

| Model/framework | Input tokens | Output tokens, including reasoning | Reasoning subset | Cached input | Estimated USD |
| --- | ---: | ---: | ---: | ---: | ---: |
| Astra Minimalism | 3,902 | 10,581 | 5,178 | 0 | 0.56807 |
| Astra X-bar | 3,870 | 8,092 | 4,660 | 0 | 0.44330 |
| Fable Minimalism | 6,309 | 5,779 | 3,061 | 0 | 0.35204 |
| Fable X-bar | 6,220 | 6,239 | 2,708 | 0 | 0.37415 |
| Total | 20,301 | 30,691 | 15,607 | 0 | **1.73756** |

The actual model IDs were `gpt-6-astra` and `claude-fable-5-1`, both high effort, with 20,000 output-token caps. Astra used background Responses requests with JSON-object format and stored responses. Fable did not use a full schema-constrained record format.

There were exactly four generation POSTs. Astra Minimalism additionally had 36 response-status GETs; Astra X-bar had 28. Those are polling the original response, not generating more analyses. Fable had one generation POST per framework. There were no model repair calls, transcriber calls, secondary relation-generation calls, or full-derivation retries.

At the saved rates:

- Input was $0.20301.
- Output was $1.53455, about 88.3% of the total.
- Reasoning was $0.78035 of that output, about 44.9% of the total, not an additional bill on top.
- The remaining output was $0.75420.

The record preserves the roughly 20KB system instruction sent repeatedly. This was not the entire chat history. Repeated full syntax where it changes, long stage explanations, and relation metadata all consume output tokens. No separate tokenizer accounting divides visible output into trees versus prose versus relation fields, so an exact dollar attribution to each would be invented.

Fable's failures wasted immediate usability of the results, not money on hidden regenerations. The local inspection recovery costs no API tokens.

### Cost reductions that do not require deleting linguistic content

First fix diagnostic/history loss so a mechanical shape problem does not tempt an expensive whole-answer retry. Clarify ambiguous container requirements. Preserve unchanged-subtree references. Remove duplicate instruction prose only after checking that each remaining instruction has a clear purpose. Use provider prompt caching where supported and actually verify a cache hit. Record the request and response once while retaining lightweight polling metadata.

Reasoning effort is a later empirical comparison, not an automatic downgrade. Parallel independent calls can shorten elapsed time but do not reduce token cost. Reducing substantive stages or deleting hard linguistic explanations simply to obtain cheaper output would change the task and is not recommended by this audit.

## Speed audit

| Analysis | Saved request wall time | Available provider timing |
| --- | ---: | --- |
| Astra Minimalism | 195.155 seconds | Provider creation-to-completion about 188 seconds |
| Astra X-bar | 150.628 seconds | Provider creation-to-completion about 148 seconds |
| Fable Minimalism | 84.147 seconds | No separate inference/network breakdown preserved |
| Fable X-bar | 85.968 seconds | No separate inference/network breakdown preserved |
| Sequential total | **515.898 seconds, about 8m36s** | Excludes later visual capture work |

The large wait is principally generation time. The saved telemetry does not justify assigning exact milliseconds to network, reasoning, and output streaming separately.

I re-ran local parsing and Replay/classification on saved data using the restored code. These are one-pass local measurements, not historical timings or a benchmark:

| Analysis | JSON ingress | Normalization | Replay plus classification |
| --- | ---: | ---: | ---: |
| Astra Minimalism | 0.14ms | 1.93ms | 84.12ms |
| Astra X-bar | 0.07ms | 0.65ms | 57.22ms |
| Fable Minimalism inspection | 1.29ms | 0.58ms | 23.82ms |
| Fable X-bar inspection | 0.05ms | 0.57ms | 52.29ms |

Local delimiter repair was not the minute-scale bottleneck. DOM drawing, layout, screenshots, and interaction latency were not individually instrumented in the original run. I cannot give an exact rendering-time total from those records.

For an initial high-effort research run this establishes the cost of the chosen configuration, not acceptable public-generator latency. A public expectation of fast generation still needs a separate measured model/effort decision.

## Production versus review-page behavior

The latest page was produced by loading normalized records into the actual local app through development capture setters, selecting Replay, and capturing `.tree-canvas-bg` for every Astra frame. It includes the native Replay panel and uses the production D3 code. It does not duplicate movement, tree layout, or relation drawing logic.

Earlier review images hid more of the native UI. Those older images should not be used to judge whether a label exists in the current Replay panel.

The static page adds these limitations:

- It displays images with `object-fit: contain`. Resizing the review shrinks tree, text, and controls together.
- Native zoom, hover, pan, Replay-panel scrolling, and control clicks cannot work inside the PNG.
- The external review navigation changes images. It is not exercising the native slider at review time.
- Still frames cannot prove motion continuity, animation timing, or interactive camera behavior.
- Its Valid status means the record normalized. It is not a review verdict.
- The capture check establishes frame/header agreement and nonzero visible labels. It does not establish correct movement, complete text, or collision-free geometry.
- The latest generated page used a temporary model/framework label correction that is not yet the general behavior of the tracked generator. Re-generating from tracked code can therefore restore ambiguous sentence-only choices.

The saved camera checks show exactly one transform within each authored Astra stage. Thus there is evidence that the stage-stable camera rule works in these captures. There is no basis to call every apparent movement a camera refit. Wrongly revealed nodes, future topology, relation overlays, and transitions between stages remain separate concerns.

Representative native evidence:

- [Astra Minimalism F18, approved Agree plaque clipping](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05/review-webapp/astra-minimalism/analysis-1/replay-17.png)
- [Astra X-bar F33, CP placement and accumulated rails](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05/review-webapp/astra-xbar/analysis-1/replay-32.png)

## Field-by-field contract audit

Completed 7 September 2026, without modifying prompts, parser, renderer, repair behavior, or saved model responses. This extends findings 01-06 and the representation questions in 07-13 and 21; their implementation status remains in the roadmap.

### Evidence and method

I compared both frameworks' saved Astra and Fable requests with the sent source snapshots. The current `systemInstruction.js`, `prompts.js`, `derivationCompiler.js`, `parseNormalization.js`, `syntaxTree.js`, `derivationHelpers.js`, `validationErrors.js`, and `modelRuntime.js` are byte-identical to those run snapshots. The local probes therefore exercise the same implementations responsible for these failures.

I ran 58 probes, including a baseline, against clones of the expanded seven-stage Astra Minimalism record. I separately reproduced each Fable failure from its raw response. All 58 probe inputs remained unchanged by the calls; the damaging deletion occurs in the returned normalization, not by overwriting the raw JSON. These are diagnostic experiments, not approved behavior changes or new committed regression tests.

Local-only supporting evidence:

- [Probe procedure](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05/audit/babel-field-contract-probes.mjs)
- [All probe outcomes and original Fable failures](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05/audit/babel-field-contract-probes.json)

### What Astra and Fable actually received

| Setting | Astra | Fable |
| --- | --- | --- |
| Model | `gpt-6-astra` | `claude-fable-5-1` |
| Effort | `high` | `high` |
| Output token limit | 20,000 | 20,000 |
| Formatting request | `text.format.type: "json_object"` | No equivalent formatting parameter |
| Provider JSON Schema | None | None |
| Tool schema | None | None |
| Sentence prompt | Same text for the same framework | Same text for the same framework |
| System instruction | Shared framework and contract text | Same text plus `Return exactly one valid JSON object and no prose.` |

JSON-object mode asks for valid JSON syntax. A JSON Schema would additionally prescribe the fields and their types. The saved Astra requests use the former, not the latter. No provider was given a schema for Babel's record.

The shared system text is 19,092 characters for Minimalism and 18,838 for X-bar. Fable's extra reminder adds 52 characters. It adds no field definitions. Astra's syntax constraint is a real difference in this comparison, so the outcomes cannot establish that Astra independently followed the formatting instructions better. It also does not resolve the missing definition of `values` for either model. No setting is changed here, and there is no proposal to add a provider JSON Schema.

### Field-by-field findings

In the table, "accepted" means normalization returned a bundle. It does not mean the analysis was linguistically reviewed, rendered correctly, or even preserved completely.

| Field or boundary | Sent instructions | Actual checks and observed behavior | Required clarification or correction |
| --- | --- | --- | --- |
| Top-level object | Exactly one raw JSON object, no prose or fences. | Strict JSON parsing enforces this after whitespace/BOM trimming and possible delimiter repair. | Separate exact original bytes, formatting edits, and record-shape diagnostics. Do not treat successful parsing as proof of unchanged structure. |
| `analyses` | Optional ambiguity envelope, containing analysis objects with only `derivationStages`; no arbitrary two-analysis limit. | Envelope and nonempty array are checked. One analysis throwing stops the whole bundle. Its diagnostic lacks the `analyses` index. | Preserve which analysis failed and the original response. Presentation/recovery for a partially usable bundle is not decided here. |
| `derivationStages` | Ordered completed states, ending with convergence. Array shown in the output shape. | Wrong type gets a misleading four-stage-fields rule name. An empty array becomes `INCOMPLETE_GENERATION`. | State the array requirement directly and distinguish wrong field type from absence of a completed derivation. |
| Stage's four fields | Exactly `statement`, `stageRecord`, `relations`, `workspaceForest`, written in that order. | Exact keys checked; object-key order is not enforced. A null stage or extra field can remove the stage while the bundle succeeds. | Keep history intact. Key order is an authoring convention, not an additional rejection requirement. |
| `statement` | Concise reader-facing headline. | Requires a nonblank string. A numeric value removes its stage; a later good final tree can conceal the loss. | Explicit string/nonblank definition and an original-path diagnostic, without filtering the stage out. |
| `stageRecord` | Explicitly a required prose string. | Checked through `String(value)`, then the original value is returned. An object, array, or nonzero number passes unchanged. A blank string throws before reference expansion. | Match the already stated string requirement. Do not stringify malformed data into prose. This is an implementation mismatch, not missing model guidance. |
| `relations` | Required array, possibly empty. | Shape is checked, but a wrong type removes the whole stage. | Diagnose the array field without deleting the stage. |
| Relation object's keys and `relation` | Short open relation string, anchors, optional values/priorAnchors. | Only these four keys permitted; `relation` must be nonblank. All relation-shape errors use the same whole-relation path and rule. | State the exact container shape once. Preserve open names and identify the particular malformed field. |
| `anchors` | Object with open role names pointing to current-stage node IDs or arrays of IDs. | Requires a nonempty object, nonblank keys and IDs, and nonempty arrays. Never checks that the nodes actually exist in this stage. Missing and future-only IDs pass. | Explain nonempty containers and omission rules. Resolve current-stage witnesses after expansion and record exact missing IDs. |
| `priorAnchors` | Optional witnesses from the immediately preceding stage, same shape as anchors. | Shape checked, membership and temporal scope unchecked. An invented preceding witness on the first stage passes. An empty object instead removes the stage. | Explicitly distinguish current anchors from preceding-stage anchors; diagnose unavailable witnesses without confusing them with `refId`. |
| `values` | Says each value is a string or nonempty array of strings. Does not define the outer container as an object. | Requires a nonempty named object, with nonblank keys. Outer string/array and empty object are invalid. Fable authored three outer arrays. | This is the direct omitted format requirement. Explain outer object versus each contained literal, and omit the optional block when there are no entries. No ontology menu is necessary. |
| `values` entries | Literal notation, not endpoint IDs. | Strings, including empty strings, or nonempty arrays of strings, including empty elements. The parser cannot know whether an arbitrary literal was intended as an ID. | Keep notation separate from endpoints. Do not secretly tighten empty-literal rules or infer semantics from a coincidental ID-shaped string. |
| `workspaceForest` | Array of complete syntax nodes or prior references. | Array/node shapes checked during expansion. Empty intermediate forests pass. Final selection can choose one matching root while additional roots remain. | Distinguish shape diagnostics from a review of whole-workspace convergence. A matching root is not proof that the entire workspace is complete. |
| Node `id` | Required in complete-node shape; stable occurrence identity, reused while the object persists. | Nonblank string and stage uniqueness checked. Surrounding whitespace is trimmed for lookup but retained in returned nodes. No proof of semantic continuity across rewritten versions. | Specify consistent exact identity handling. Do not confuse validation of IDs with verification of the linguistic identity claim. |
| Node `label` | Required syntactic item/category. Must not substitute a category for missing structure. | Nonblank string checked. With no `word`, pronunciation can be guessed from the label and its capitalization. A probe using `which` as its lexical label succeeds; `Which` without `word`/`tokenIndex` is treated as an empty structural head and fails. | Resolve lexical-label versus category-label responsibilities. Capitalization must not secretly determine whether genuine lexical material is spoken. |
| Node `children` | Required array, including on leaves. Framework instructions impose branching constraints. | Required array checked; unary/binary and endocentricity are not checked here. A third silent child on a Minimalist phrase passes. | Separate serialized tree integrity from linguistic evaluation. Do not present normalization as framework certification. |
| Node `word` | Only an overt terminal pronouncing the supplied input token. Must be removed from silent occurrences. | Its type and placement are not generally checked. An object-valued word in an earlier stage and a word on the final nonterminal pass. | Diagnose wrong type/placement. Separately decide the silent-copy representation with Francis; do not manufacture lexical children. |
| Node `tokenIndex` | Unique per overt terminal per stage and matched to the supplied indexed tokens. | Wrong or duplicate earlier indexes pass. Final-root indexes are checked, but failures become a generic incomplete-derivation error. Missing indexes can be derived on the Canopy tree while remaining absent in the returned final stage. | Make the existing per-stage promise and derived-tree behavior explicit. Preserve the real cause when alignment fails. Whether mismatches block display remains undecided. |
| Node `silent` | Set `true` for unpronounced material in that stage. | No general boolean check. The string `"false"` passes. A silent parent with overt descendants also passes, since terminal collection tests leaves rather than inherited silence. | Define node-local versus subtree-wide silence and verify that every consumer agrees. Do not adopt an inheritance rule without the representation decision. |
| Node `lineageId` | Shared identity across distinct occurrences; not a dependency classification. | No string/nonblank check. An object-valued lineage passes. | State and diagnose its shape. Keep identity evidence distinct from a movement claim. |
| Undeclared node property `features` | The ordinary word features appears in prose, but no JSON field named `features` is declared. | Models authored this extra node property. Copied through with other extra fields; even `features: 42` passes. Absent from the browser `SyntaxNode` declaration. | Do not present this as an agreed field or add it to legitimize the output. Reconcile the vague prose and extra-field handling with the existing relation `values` design. |
| `refId` object | Exactly one reference field for an unchanged subtree from an earlier stage. No duplicate occurrence in one stage. | Shape, earlier lookup, and duplicate active IDs checked. Lookup keeps the latest earlier definition, not exclusively the previous stage. A malformed stage can be removed before lookup. | State the latest-earlier-version rule and distinguish it from immediately-previous `priorAnchors`. Preserve original stage indexes before checking references. |
| Other node fields | No complete optional-node-field definition. The prompt forbids aliases/shorthand and ends with a broad ban on extra fields. | Arbitrary node fields survive. `aliasIds` can resolve a `refId` despite the prompt's ban. `type` and `silentFeature` have pronunciation behavior. `surfaceSpan`, not requested by the prompt, can affect final validation. | Audit the raw node boundary separately from derived/browser fields. Undocumented fields must not accidentally become an alternate authored contract. Do not delete product metadata indiscriminately. |
| Final surface comparison | Exact supplied token strings/order in the sentence prompt. Ungrammatical inputs must still be analyzed as written. | Comparison lowercases and strips edge punctuation/symbols. `WHICH` matches `Which`. Alignment is applied to a final-root candidate, not every earlier stage. | Document the comparison actually intended. Token accounting is not a grammaticality judgment and cannot establish the quality of the derivation. |

Source owners are [systemInstruction.js](../../../server/babelParser/systemInstruction.js), [prompts.js](../../../server/babelParser/prompts.js), [derivationCompiler.js](../../../server/babelParser/derivationCompiler.js), [parseNormalization.js](../../../server/babelParser/parseNormalization.js), [derivationHelpers.js](../../../server/babelParser/derivationHelpers.js), [syntaxTree.js](../../../server/babelParser/syntaxTree.js), and [surfaceTokens.js](../../../server/babelParser/surfaceTokens.js).

The browser declaration in [types.ts](../../../types.ts#L1) is not a schema sent to either model. It allows optional `id`/`children`, lacks `features`, and describes IDs as optional D3 indexing. That description is unsuitable as a guide to the authored identity contract. However, a browser type also contains derived data, so it should not simply be copied into the model prompt or treated as the raw response specification.

### Instructions and downstream assumptions that need reconciliation

These are specific problems, not a claim that the whole prompt is contradictory:

1. **Bare heads are explicitly permitted and can be intentional.** Earlier stages may contain abstract objects without `word` or `tokenIndex`, and complete nodes may have empty `children`. Francis accepts this when it reflects the model's analysis; he does not require a terminal child under every category. A node with `word` can also have empty `children` in the stored record because Babel derives its displayed lexical leaf. Investigate genuinely missing material and misleading Replay steps without classifying all such nodes as errors.
2. **Silent nodes are forbidden from retaining `word`.** The raw lower D/N nodes therefore need not be model omissions. Lexical text in `label` is not explicitly banned, but lexical text stored in `word` must disappear under this instruction. Francis reaffirmed that the model chooses the lower representation; the renderer already supports retained silent lexical copies and authored traces. Reconcile the field instructions with that distinction without making Babel choose or repair the analysis.
3. **Open relation names meet finite renderer rules.** The model is not told to use a curated menu, appropriately. But a structurally valid open claim can miss the classifier's role aliases or exact signature. Astra's extra Agree witness is a concrete example. This is not evidence of invalid JSON or invalid node references. It needs claim recovery work, not stronger accusations in the prompt.
4. **Relation order and movement ownership are underspecified.** The prompt says connected operations may share a stage if their order can be recovered. It does not plainly define relation-array order as Replay moment order. The implementation uses that order and separately requires recognized movement to own the landing, lower occurrence, and new parent. Francis agreed to state the ordering requirement explicitly and align it with Stage Record; implementation remains deferred. Fixing movement recovery/ownership is still required alongside the wording correction.
5. **Two different backward references need a clear distinction.** `refId` can reuse the latest definition from any earlier stage; `priorAnchors` must name a witness in the immediately preceding stage. The latter exception is followed by broad instructions that every relation anchor must exist in the current stage. Name the two fields explicitly wherever their scopes differ.
6. **Repeated instructions still leave missing field definitions.** Branching-only relation exclusions and forward-building/silent-copy rules recur several times. One clause says the higher root must follow lower structure already shown in the stage sequence; the next permits building lower structure in the same coherent stage. The final checklist also adds an apparent exception to the same-occurrence prohibition for distinct lineage-linked copies. Rewrite those once, distinguishing a single occurrence from multiple related occurrences. Repetition and tension are verified; their effect on a particular model token is not measurable from this run.

The prompt also tells the model not to omit structure to save tokens, while asking for every genuinely distinct analysis. A finite output budget still exists. This is a future capacity question, not the explanation for Fable's present EOF damage: its response was well below the configured cap.

### Diagnostic failures reproduced

**Implementation requirement: emit actual runtime diagnostics, not just audit descriptions.** Each failure must have a plain-English explanation and structured details identifying the processing step, original analysis/stage, exact field path or byte position, observed value, and expected form. Preserve these with the run's raw evidence. A generic `BAD_MODEL_RESPONSE` label is not a sufficient explanation.

- State the first observed problem and any established downstream consequences. Do not replace a field error with a later missing-reference or nonconvergence error, or blame the model for a Babel processing defect. Mark dependent checks as unavailable when the prerequisite failed.
- Distinguish the observed defect from its underlying cause. Report a proven cause clearly; explicitly say when it is unknown. Do not label a failure `contract_misunderstanding` merely because parsing failed.
- Any repair that runs must retain its transformation name, exact inserted/removed bytes and original location, plus its outcome. A successful repaired parse must not hide that a repair occurred. This requirement does not authorize keeping or adding a repair.
- Regression tests must assert the diagnostic content and original locations, not merely that something throws. Cover both Fable failures, a genuine missing reference, and dependent errors caused by an earlier processing failure.

Required message examples, based on this run: `Stage 3, relations[0].values: expected an object with named entries; received an array.` For the JSON ending: `The original provider text ends at byte 6819 without closing derivationStages and the outer object. Provider stop reason: end_turn. Why generation ended there is unknown.` The second message must not claim truncation at the output limit or a model reasoning failure. Internal diagnostics do not imply public frontend warnings, a rejection policy, or automatic retries. Implementation remains pending approval.

| Probe or original case | What happened | What the internal diagnostic must retain |
| --- | --- | --- |
| Fable Minimalism | S3 and S5 fail relation-shape checks. Both are removed. Original S4 is called stage index 2 and loses its valid reference to `d_john_hi` from S3. | Original analysis and stage positions; exact paths `$.derivationStages[2].relations[0].values` and `$.derivationStages[4].relations[0].values`; outer array versus expected object; reference dependency on the affected stage. |
| Fable X-bar | S4's `values: ["did"]` removes S4. Original S5 loses its valid `c1` reference and is reported at index 3. | Original path `$.derivationStages[3].relations[1].values`, actual and expected type, and the fact that `c1` was authored in that stage. |
| Malformed stage followed by independent complete stages | Null stage, wrong statement type, bad relation, or extra stage field can produce a six-stage success from seven stages. Some cases carry no specific integrity flag. | Every original stage and every recorded field issue, even if another stage yields a renderable final tree. No successful shortened substitute. |
| Actual missing `refId`, wrong node shape, duplicate node | Human message has partial location; structured failure is generic `BAD_MODEL_RESPONSE`, stage `null`, path `$`, offending value `null`. | Exact original analysis/stage/node path, missing field or referenced ID, expected shape and observed value. Do not make callers parse error-message prose. |
| Final token index `999` or string `"0"`; incorrect span | The final words still match. Candidate normalization catches the actual alignment error and returns `null`; the caller reports that the derivation did not converge. | The alignment error itself. Do not replace it with a guessed incomplete-generation cause or regenerate a complete derivation on that basis. |
| Bad `stageRecord` in the second analysis | Whole bundle throws. Path says `$.derivationStages[0].stageRecord` without indicating the second analysis. | Full `$.analyses[1]...` path and independent status for each original analysis. How much can be displayed is a separate decision. |

The qualification runner preserves the failure object supplied by normalization. It does not originate the false missing references. The information is already lost upstream. [contractQualification/run.js](../../../contractQualification/run.js#L213) records the processing phase and repair diagnostics, but cannot reconstruct a discarded stage or a swallowed alignment cause.

[validationErrors.js](../../../server/babelParser/validationErrors.js#L115) also maps a bare `BAD_MODEL_RESPONSE` code to `contract_misunderstanding`. That classification is not proof that the model misunderstood anything. In these Fable cases Babel's own filtering produced the reported missing-reference condition. Diagnostics should distinguish the observed violation, the processing step that raised it, and any dependent checks that cannot be trusted. Attribution to model reasoning requires separate evidence.

There is useful existing repair evidence. Fable Minimalism has exactly one `append_closers_at_end_of_output` edit: `]}` at byte 6819, hexadecimal `5d7d`. No ID text changes. Fable X-bar needs no JSON repair. Neither run shows the automatic delimiter pass rewriting `values` or node references. Interior delimiter repair remains a separate structural-risk question because changing container ownership can change meaning without editing any ID characters.

The existing Fable inspection copies wrap the three unchanged literal arrays in a named `notation` field and keep all five stages. They normalize with all original IDs and references. That is evidence that the missing-reference messages were caused by stage deletion. It is not evidence that the whole linguistic derivation is correct, nor approval to add this wrapping as an automatic product repair.

### Deeper trace of Fable's missing closing characters

Follow-up on 7 September, using saved bytes and local adapter replay only. [Trace procedure](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05/audit/babel-fable-ending-audit.mjs) and [results](../../../.artifacts/contract-qualification/astra-fable-admission-2026-09-05/audit/babel-fable-ending-audit.json) are local-only evidence. No request reached a provider during this check.

The captured HTTP response is a complete, valid API envelope. Its single text block already lacks the final `]}`. That text is exactly the same in `generation.json`, `summarizeGeneration`, and `raw-output.txt`. The complete HTTP bytes also match the capture's recorded hash, the generation's raw response, and the retained generation-record artifact, which is not truncated. Replaying the saved response through the actual Anthropic adapter, with networking replaced by the saved response, produces the exact recorded request and output text for both Fable cases. The adapter and JSON parser source are unchanged from the run snapshots.

This rules out Babel removing the final characters during extraction, joining text blocks, saving the output, or retaining the diagnostic artifact. There was one text block, no requested streaming, and no custom stop sequence. The API reported HTTP 200, `stop_reason: end_turn`, `stop_sequence: null`, and `stop_details: null`. Reported output was 5,779 tokens against a 20,000-token allowance. No client timeout interrupted the successful response path. Anthropic documents `end_turn` as a natural end, distinct from output-limit and custom-sequence stops. It does not certify the JSON contained in the model's text. [Official stop-reason documentation](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons).

The syntax of the ending is more specific than arbitrary malformed JSON:

- All five individual stage objects are closed and parse independently, with all four required fields.
- The final stage includes its relation array and complete serialized workspace and explicitly says the derivation converges. This is not proof of linguistic correctness, but no part of a stage is cut off mid-field.
- The only unclosed containers are the outer response object, opened at character 0, and its `derivationStages` array, opened at character 20.
- Appending `]}` closes only those two outer containers. It does not move a relation into another stage, change an ID, or supply another derivational step.
- Fable wrote this response on one physical line, with a maximum JSON nesting depth of 22. Its ending contains 20 consecutive closing brackets/braces before stopping two short. Babel did not request minified, single-line JSON.
- Fable X-bar is also one line but reaches depth 18 and closes successfully. Astra's two responses use multiple lines and close successfully, but their JSON-object mode makes them unsuitable controls for the effect of whitespace alone.

The leading explanation is an outer-container closing oversight in the generated text after finishing the deepest part of the last tree. That is an inference from where the response ends, not access to the model's reason for stopping. The API returned no readable reasoning text. The trace cannot distinguish a model-generation mistake from an unreported provider-side issue, or prove that nesting, formatting, prompt repetition, or a specific instruction caused the mistake.

Two causes must remain separate. The omitted `values` object definition is an established Babel prompt defect, and deleting stages is an established Babel parser defect. Neither establishes why the provider returned an unclosed outer wrapper. Raising the token cap, restoring allegedly lost text blocks, or changing subtree IDs would not address what this evidence shows. A broad prompt rewrite would change several possible causes at once. It must not be used to claim that a particular cause of this ending has been identified.

### Field origins and prior decisions

Further history check on 7 September, following Francis's correction:

- **`features` was not a declared node field.** The sentence about preserving a silent occurrence's "label, features, structure, and lineageId" is present in commit `8997d923`, 5 June. A second general reference to features was added in `46dfcbeb`, 28 August, when the surface-order instructions changed. Neither passage defines a JSON property. The June `SyntaxNode` type also lacks it; that old file's `features?: string[]` belongs to the now-obsolete `ChainLedgerEntry`, not syntax nodes. These commits establish when the wording is visible in repository history, not Francis's approval of a field. The current [node expansion](../../../server/babelParser/derivationCompiler.js#L301) copies extra properties without interpreting their presence as a contract error. My earlier description wrongly promoted an observed extra property into an agreed contract field.
- **The relation design already has a home for literal feature notation.** The corrected Fable architecture defines relation `values` as `Record<string, string | string[]>`, beside node-pointing `anchors`. Section P2 of its [answered-unknowns dossier](../../history/architecture/fable-zero-unknowns-2026-07-17/babel-answered-unknowns-dossier.md) also rejects `features` as the name of the general relation-literal container because it would narrow the ontology. That naming decision is not a ban on discussing linguistic features; it is not permission for a separate node field either.
- **Astra inherited JSON-object mode from product code.** It is already present in the June `8997d923` OpenAI request, later extracted into `buildOpenAIRequestBody`. The September runner called that builder directly. The six-model integration `64dc563` also added JSON-object settings to Kimi and Grok. No separate comparison qualifying OpenAI's mode was identified in this investigation. Absence of a provider JSON Schema does not make the conditions equivalent: Astra still received an extra formatting constraint that Fable did not.
- **The corrected plan did not endorse that as the shared baseline.** [Corrected canonical architecture, section 5.3](../../history/architecture/fable-zero-unknowns-2026-07-17/babel-corrected-canonical-architecture.md#53-carrier) says provider-native JSON modes are separate provider-specific experiments, never the common comparison condition. Product adoption requires its own evidence that derivations are not worsened. The four September calls remain useful product-failure evidence, but cannot establish comparative unassisted formatting reliability. The current shared comparison must use ordinary text responses containing JSON, without a provider JSON mode or schema, as Francis has now reiterated. Provider-specific options require separate approval and labelling.
- **Prevention was the intended starting point.** Section 5.6 permits the conclusion that no repair is needed. EOF closure is not a default addition, interior delimiter removal is rejected in the corrected plan, and two-pass model transcription is rejected. The [August reconciliation](../../history/architecture/2026-07-fable-packet-audit.md) left recovery qualification open; it did not establish that the remaining helper was safe or needed. None of this authorizes changing the current helper during this audit, or revives older rejection/display policies that Francis has since disputed.

### What can still explain the Fable ending

The sent JSON-shape illustrations include their outer closing brackets. No instruction requests minified JSON, a partial object, or omission of the outer wrapper. The saved request contains one user message and no assistant prefill, tool exchange, continuation, or compaction history. Known conversation-history and tool-loop stopping problems therefore do not explain this request.

| Candidate cause | Evidence and current conclusion |
| --- | --- |
| Babel removed the ending | Excluded by exact saved API-text and adapter-replay comparisons above. |
| Output cap, custom stop sequence, client timeout, or refusal | Not supported by the recorded request, complete HTTP response, token usage, and `end_turn` result. |
| Copied an unclosed outer-wrapper example | The actual sent examples close the wrapper. No such malformed example was found. |
| The `values` mismatch or stage filtering removed the characters | Excluded by processing order. The characters were already missing before JSON parsing or stage validation. |
| Single-line deeply nested serialization made closure less reliable | Plausible and testable. Twenty closers finish all five stage objects, leaving only the two outer containers. One damaged response cannot establish nesting or whitespace as its cause. |
| A particular prompt instruction or Fable-specific behavior triggered the stop | Open. The available comparison changes framework, tree shape, and prompt wording together. Astra additionally changes model and formatting mode. Neither isolates a cause. |
| Anthropic transformed the generated content before returning it | Not established or excluded by client evidence. The API envelope is the earliest artifact available to Babel, not a token-level trace inside the provider. |

Anthropic's [Messages reference](https://platform.claude.com/docs/en/api/typescript/messages) documents provider-side request transformation and output parsing. Therefore an intact HTTP envelope cannot, by itself, distinguish a model emission error from an internal provider transformation. The saved HTTP metadata includes a request ID and the envelope includes a message ID, which could support a provider investigation without disclosing credentials. No support message has been sent. The [Fable 5.1 prompting guide](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1#finish-the-whole-task) discusses early stopping in complex asynchronous work, not this single-response JSON defect; it is not evidence of this case's cause.

### Final offline check and discussion handoff

On 7 September Francis declined the proposed paid diagnostic repetitions. **No further provider calls, including small probes, are authorized.** The next work is discussion of the remaining contract and system decisions, not another generation experiment. The declined proposal is not a queued task or a prerequisite for continuing that discussion.

The final offline pass reran the saved-response trace through Babel's actual Anthropic adapter with network calls replaced by local responses. Both Fable requests and extracted texts matched exactly again. Minimalism still has five complete stage objects and only the outer `]}` missing; X-bar has five complete stages and no JSON damage. The request/capture, delimiter-repair, and reference-expansion code supplied no additional cause. Replaying saved bytes confirms what Babel did with this response; it does not measure how Fable would respond to a changed prompt.

**No exact generation-side cause or proven prevention fix was found.** The following distinctions carry forward:

- The `values` outer-object definition is missing from the prompt. Clarifying that existing requirement addresses a demonstrated contract defect, not a proven cause of the missing ending.
- Babel deletes stages containing those malformed `values`, which creates the false missing-reference errors. Preserving all original stages and reporting the actual field and location addresses a demonstrated parser/diagnostic defect. It does not require deciding a rejection policy or adding automatic repair.
- `features` is an undeclared node property, not a newly agreed field. Four-field stages and open relation anchors/values remain the agreed design.
- Astra's provider JSON mode made the formatting conditions unequal. Future shared comparisons must not inherit that mode. Correcting comparison conditions is not a Fable JSON fix.
- The omitted ending remains an open serialization defect, separate from linguistic validity. No frontend failure display, Tier 3 redesign, automatic field correction, or helper-retention decision follows from this investigation.

For later discussion, clearer output-completion wording and indentation could be tried without changing the linguistic record or adding a helper. They are untested prevention candidates, not fixes demonstrated by this sample; the prompt already requests one valid JSON object. The older plan's stage-per-line format would remove the outer list/object requirement but would still require correctly closed stage trees and a separately agreed format change. It is not justified as an immediate solution here. Appending `]}` makes this saved document parse, but is recovery, not prevention or proof of cause. The existing labelled inspection copies do not authorize automatic product repair.

The offline investigation is paused, not resolved. Do not claim this defect is fixed, harmless, or evidence that a helper is necessary. Return to it when Francis approves relevant new evidence or changes; meanwhile continue grilling the remaining decisions.

### Conclusion and next decision

Babel omitted a required `values` container definition and then mishandled the resulting shape mismatch. Those are demonstrated Babel defects. Fable's missing two closing characters are already absent from the API's text, and only the two outer containers remain open. The generation-side reason for stopping there is not established. The formatting-mode difference is relevant; neither model capability nor prompt clarity alone can establish a guarantee of perfect serialization.

The final requested offline check is complete. Francis has deferred further provider calls and directed a return to grilling. Continue from the narrowed findings above, then resolve the remaining representation and behavior questions before implementation. Clarify the existing `values` object rule without adding a node `features` field. Fixing diagnostic/history handling does not require adopting automatic repair, a rejection policy, or a frontend warning.

Model ownership of copy/trace choice, the white primary Replay heading, keeping a complete supported drawing despite extra context, and explicit chronological relation order are agreed above. Exact silent-field instructions, recognition of category-only traces, simultaneous claims, and handling previously saved conflicting orders remain unresolved. Intentionally wordless heads are accepted; other apparently missing material still needs case-specific review. No new renderer design, provider JSON Schema, paid run, or semantic repair is approved by this audit. Keep the remaining findings open while those decisions are made.

## Dependencies identified by the audit

The following dependencies explain the suggested order. Track approval, progress, and closure only in [ROADMAP.md](../../../ROADMAP.md#current-priority-resolve-the-september-system-audit).

1. Correct diagnostic/history handling. Preserve original stages and references and expose the actual shape error. Review final-workspace and anchor checks as diagnostics without silently deciding a new rejection policy.
2. Resolve the representation and timing questions above. Especially silent copies, typed traces, bare maximal items, and relation order within completed stages.
3. Connect evidence-backed movement recovery to Replay's existing atomic movement machinery. Review role coverage and head/phrasal distinctions together. Do not repair this by renaming model relations or treating every shared lineage as movement.
4. Correct Replay title hierarchy and shared plaque text layout. Verify that the approved drawing remains recognizable with arbitrary legitimate literal content.
5. Re-evaluate which relations still genuinely require Tier 3. Only then discuss its composition design. No Tier 3 redesign is agreed or applied.
6. Capture the original Astra records and clearly labelled Fable inspection records with the shared production component. Compare frames and motion, desktop/mobile, manual zoom, and panel bounds.

Focused tests should cover the behavioral classes in the issue table, not just snapshot this sentence. Existing parser, Replay, Tier 2, relation-panel, and render-plan test modules are the natural homes. The important missing integration test is a model-shaped noncurated movement description passing through normalization, classification, Replay timing, and the actual drawing together.

## Remaining limits

No new provider calls were made for this audit. No fresh browser session or visual capture was started. No comprehensive live motion/mobile/zoom sign-off was performed. No new rejection policy, Tier 3 design, prompt, classifier change, or repair policy was adopted. No fresh full-suite pass is claimed for unchanged code.

The CP centering mechanism needs coordinate-level isolation before a geometry fix. Fable's exact reason for missing EOF punctuation is not recoverable from telemetry. The linguistic claims need maintainer review and, for gold-corpus use, qualified external review. The saved pricing totals are estimates rather than account debits.

**Conclusion: these outputs do not support calling the full Babel pipeline finished or shippable.** They identify several general failures and several design questions. The next step is to agree on that distinction and the repair order, not to patch Tier 3 or make this one sentence look successful.
