# Babel Master Roadmap

Status date: 2026-10-08

This is Babel's only active implementation plan. Dated plans, audits, handoffs,
and research notebooks are evidence or history, not competing roadmaps.

Babel must accommodate all languages. Test languages expose general limitations;
they do not define a supported-language allowlist or authorize language-specific
syntactic rules.

## Current priority: fresh contract checks and application foundations

The verified contract, Replay, renderer and performance guard are merged. The
current closeout adds faithful failed-output inspection, error containment and
behavior-preserving extraction of application responsibilities. The bounded
ten-request Codex OAuth comparison is complete; its newly reproduced renderer
defects have general fixes and focused evidence. Application design remains
separate. Desktop remains the primary experience.

The historical corpus audit and drawing inventory remain completed evidence.
The following acceptance criteria govern any newly reproduced defect; they do
not authorize restarting those sweeps:

1. Every drawing recipe can be reached from a valid public record through
   normalization, Replay, exact-anchor binding and the production painter.
2. Every unresolved claim in the saved corpus has been checked against the
   evidence actually supplied. Repair missed associations without inventing
   linguistic facts, forcing relation names or discarding neutral content.
3. Replay preserves exact occurrences, intermediate movement landings, authored
   pronunciation and one simultaneous moment for each authored relation.
4. Plaques, connectors and domain graphics remain legible, stable and attached
   during playback, fitting, zoom and analysis switching.
5. Evaluate unfamiliar holdout records without changing the candidate to fit
   those records. Separate model mistakes from demonstrated prompt, processing
   or rendering defects; perfect model analyses are not the release criterion.
   Set product acceptance criteria before the run. Show only questionable
   examples for judgment, with every returned analysis available for inspection.
6. The full offline gate passes. In the local bundled runtime at 1600px desktop,
   usable Replay should open within 2 seconds and ordinary frame changes should
   have a 95th percentile below 100ms. Measure rendered frames, not slider input.

### Current contract and renderer result

The saved-source audit reviewed 293 analysis records from 220 returned generations:
285 accepted records and eight preserved failures. Exact sent prompts exist for
178 analyses; the other 115 cannot support exact historical prompt attribution.
This was a source audit, not a new browser sweep of every frame or a claim that
every linguistic analysis is correct. No saved authored record was rewritten.

Shared fixes now preserve unchanged workspace components, recognize independently
supported movement and feature claims, and bind realization changes to their
owning relation moments. The three Japanese input-association timing repairs
leave the other 282 accepted Replay projections unchanged. False prior-movement
warnings are removed while genuine unavailable-occurrence diagnostics remain.
Canonical behavior and limits are recorded in the renderer closeout and Tier-2
shape-dispatch specifications.

The opening-speed finding is resolved on the reference Mac. The earlier closeout
comparison measured 899.6 ms against 839.1 ms for the historical checkpoint,
within the unchanged 100 ms allowance and below the two-second target. Layout
preparation runs in a serial worker with exact font metrics, bounded in-memory
reuse and cancellation. Completed geometry, final Replay and worker termination
are checked separately from the first visible frame. These measurements are
local evidence, not a promise for every device or network.

The last camera correction excludes plaques whose attachment is hidden in that
scene, while retaining their later visible position in the shared stage fit.
Desktop and phone-width checks preserved world coordinates, stage framing and
manual zoom. The complete assembled gate passed 4,277 tests, typechecking and
both parse-contract fixtures. User-reviewed light intensity remains unchanged.

The approved prompt cleanup removes repetition and worked language examples,
clarifies that unchanged subtrees can be reused inside a larger structure, and
requires relation order to match the establishing operations in the stage record,
including independent operations. Relation and anchor names remain open. Four
Codex OAuth requests with GPT-6.1 Sol/high returned five reviewed analyses after
the cleanup. The final ordering sentence was approved afterward and has offline
coverage. The matched five-case batch completed five requests with GPT-6 Astra
and five with GPT-6.1 Sol, both at high effort through Codex OAuth. Astra returned
six analyses and Sol seven. All ten used the same frozen source fingerprint;
all 13 analyses were audited. One initial Sol preflight stopped before any
provider request because local implementation changed the audited files. The
remaining requests used the frozen starting checkout; no sent request was
retried and no paid fallback was used.

The batch found one concrete relation-ordering/interleaving error in Sol's
German Stage Record, an under-specified sequence in Astra's German explanation,
and minor omitted Case explanations in Astra's Japanese and Spanish records.
These are preserved model findings, not demonstrated new prompt ambiguities.
No authored record or model-facing prompt was changed during that audit. Every
returned analysis, original response and diagnostic is retained outside the
source tree. The subsequent prompt clarification is recorded below.

Fresh records also exposed two movement-recognition gaps: an intact head
assembly at a new receiving head, and a contextual projecting head mistaken for
a competing phrase landing. General structural proofs recover four missing
paths; exact Tier-1 and ambiguity controls remain protected. Focused native
checks cover the owning moments on desktop and phone, with before/after images
and a short recording. A Spanish governor/dependent Case claim repeated in two
alternatives now recovers from a complete assignment label naming the exact
separately supplied Case value, without requiring the word “Case” in that label.
Missing values, ambiguous participants, negated claims and malformed exact
Tier-1 claims remain neutral. This work does not restart exhaustive browser sweeps.

The assembled local change passes 4,362 tests, typechecking, both parse-contract
fixtures and the production build. All 13 returned analyses open and reach their
final rendered Replay frame without browser errors or additional generation
requests. This opening check is not an exhaustive visual review of every frame.
The unchanged performance gate measures an 876.8 ms candidate median against
876.2 ms for the starting checkout, using five alternating samples per revision.
Both satisfy the two-second reference target; the relative comparison passes.
Application foundations and recognition fixes were local at that checkpoint.
Their current closeout is tracked in [PR #24](https://github.com/francisronge/sylvan-architect-babel/pull/24)
and [PR #25](https://github.com/francisronge/sylvan-architect-babel/pull/25).
Temporary verification servers and browsers were stopped; the existing local
review server remains available.

Exhaustive browser sweeps and the old twelve-request schedule remain stopped.
Original analyses, failures and review media are retained outside the source tree.
The focused contract, Replay, renderer, performance-guard and dependency-fix
PRs (#18–22) are merged. Provider-free verification and renderer performance are
required checks, with up-to-date branches and administrator enforcement. The
new Tree Bank record integration is merged in
[PR #23](https://github.com/francisronge/sylvan-architect-babel/pull/23).
It passed 4,301 tests, typechecking, both parse-contract fixtures and
a production build. Its reference startup median was 882 ms against 873 ms for
the base, within the unchanged allowance. The Vercel application remains paused;
no application deployment or shipment follows from these checks.

The latest varied qualification batch contains 14 analyses from ten Codex OAuth
requests, split between GPT-6 Astra and GPT-6.1 Sol across French, Hindi, Japanese,
Korean and Hungarian. General fixes now recover complete joint-realization
groups, explicit probe/controller agreement, causee Case and focus associations.
Nested phrasal movement builds independently available receiving context before
an earlier landing needs it, while preserving the later movement's own moment.
Trace display now preserves the model's notation verbatim. No authored analysis
or prompt changed during these repairs.

The assembled repairs pass 4,465 tests, typechecking and both parse-contract
fixtures. All 656 Replay frames were exercised at desktop width, with 73 phone
states and selected before/after, zoom and movement captures. No browser errors,
invalid geometry or movement timing conflicts remain in that batch. Geometry
checks also cover both text directions. Reference startup measures 922 ms versus
921 ms before the repairs, within the unchanged budget. Native before/after
captures and Replay recordings accompany
[the renderer PR](https://github.com/francisronge/sylvan-architect-babel/pull/25).
This is bounded verification, not a claim of universal renderer correctness.
The French construction order does not establish a need for a scheduling change:
building a wrapper around an existing subtree does not activate its later
licensing relation. The prompt now names the basic construction display Babel
derives and excludes only entries that merely announce those construction events.
Additional relational claims still require records, including claims established
through construction; relation names and theoretical choices remain open. Fresh
generation evidence for this clarification is recorded below. Diminishing
returns have not been established by these selected samples.

The October 8 qualification used five new sentences in Italian, Portuguese,
Russian, Irish and Indonesian, each sent once to GPT-6 Astra and GPT-6.1 Sol at
high effort through Codex OAuth. All ten requests completed without retries or
paid fallbacks and returned 13 analyses, 65 stages and 143 relations. All requests
used the frozen contract fingerprint
`384879130559a035c79fdd4da06c0a78f065c00480e6abf322fe1f8641efe68c`.
Review of every Stage Record and relation found no definite recurrence of the
construction-exemption, explanation or relation-ordering defects. This result
does not establish universal linguistic correctness or a stable error rate.

The fresh records exposed ten missed drawings across seven analyses. Shared
evidence rules now recover two clitic paths, six theta-role assignments and two
modifier attachments. They require exact occurrence or structural evidence,
retain ambiguity and negation controls, and leave authored records unchanged.
The same comparison leaves drawing assignments and Replay sequences unchanged
in all 285 older accepted analyses. The assembled gate passes 4,487 tests,
typechecking and both parse-contract fixtures. Native verification exercised
all 526 desktop frames and 78 phone states, followed by focused captures of the
last two role recoveries. No browser errors or invalid geometry were found.
The unchanged startup gate measured 932 ms against 927 ms for the frozen source.
All returned analyses remain in the local generation archive and native review.
Focused before/after images and a movement recording are uploaded to
[PR #25](https://github.com/francisronge/sylvan-architect-babel/pull/25).
The renderer was adapted after this batch, so these corrected drawings are
regression evidence rather than an untouched holdout result. No further prompt
change is justified by this batch. The changes are packaged in PRs #23–26;
required checks and automated review govern their merge. Automated review also
identified parser ownership displaced into Replay during the application
extraction. The correction restores canonical authored-stage rules to the
derivation compiler and keeps realization rules with the parser. Browser
inspection reuses the pure rules with its own diagnostic policy. Rule bodies
are unchanged; all 4,488 tests, typechecking and both contract fixtures pass.
The original generation fingerprints remain intact.

### Earlier integrated contract and renderer evidence

The September 29 pass audited all 156 saved analyses and 69 new analyses,
comprising 2,257 authored relations. It checked every declared drawing recipe
and every retained neutral claim against the supplied evidence. Shared recovery
and ownership rules resolve all supported misses found in this corpus. No
language-specific syntax rule, model-facing prompt change or authored-record
repair was introduced.

The 48 new requests used GPT-6.1 Sol/high through Codex OAuth, with no retries,
JSON repair or paid fallback. The first 32 requests produced 46 analyses; the
16 independently preselected requests produced 23. All 69 preserve input-token
accounting, occurrence IDs and raw authored stages. The independent candidate's
initial failures remain preserved. Its later repaired drawings are adapted
results, not independent success evidence or an estimate of 80% general quality.

The complete drawing inventory now has production evidence for all 55 recipes,
115 accepted family/outcome combinations and 89 witness/expiry controls. The
browser pass checks 646 drawing views and 46 exact Tier-1/Tier-2 primary-drawing
comparisons. Every new Replay and every changed older analysis is selectable.
All 9,104 frames across 99 analyses rendered at desktop and narrow widths, with
no invalid paths, visible tree errors, browser errors or generation requests.

The earlier thirteen trees remain approved, and Francis has inspected every
frame of all 69 newest analyses. The [fitting comparison](https://babel-fitting-preview-20261001.vercel.app/comparison/)
retains the original Before runtime and the corrected current runtime, with
shared playback, arrow keys, zoom and desktop/phone views. Do not request another
review of unchanged analyses. [Overlap close-ups](https://babel-fitting-preview-20261001.vercel.app/overlaps/gallery.html)
show the five representative warnings and link to all 39 flagged analyses.

Francis has now inspected every Replay frame in all 69 newest analyses. The
September 30 follow-up also read all 355 Stage Records and checked them against
the authored forests and relations. It found no additional definite statement
or Stage Record contradiction. The user review exposed two workspace placement
defects and a binding-enclosure defect. The October 1 screen-motion recheck
exposed remaining subtree jumps and historical camera bounds. R28 now includes
their repairs and measured playback continuity; the earlier coordinate and SVG
checks alone had not proved screen continuity at stage boundaries.

The October 1 end-to-end pass closes R29's disappearing adjunct branch and
preserves R28/R30's motion, fitting and unstretched-branch repairs. Across 225
analyses and 9,804 frames in four width/direction configurations, every final
drawing and stage budget is unchanged. All 222 unaffected analyses retain every
coordinate. The three affected analyses retain their existing branch until the
new adjunct parent appears. Focused controls cover nested wrappers, asymmetric
sisters, real workspace forests and forward/reverse playback.

The old overlap counts measured reserved clearance rectangles. Twelve warning
frames also counted the same descendants twice through a hidden parent. The
narrower text/branch check found no colored-glyph intersections. Browser
close-ups show tight but separate French labels, separate Arabic phone labels,
and the repaired English branch. No additional shared layout change follows
from those warnings. The gallery keeps these examples available for judgment.

The Orchard restores the original Babel Reborn sources: Moortgat, Sadrzadeh and
Wijnholds Figures 7 and 12 for M1's copy fork; Jou examples 125 and 126 for O5's
ordered Case rows; and PDT Figure 3.1 for O6's reference overlay. O5 now follows
the cited Korean example. Unrelated previews are removed. All six neutral
fallback cards open paused on their relation moment, and all 55 source pills
align their title, badge and disclosure control vertically.

Q3 now passes the preselected local opening target. Across three fresh browser
contexts per width, the complex Turkish tree opens in 1.70–1.72 seconds at 1600px
and 1.71–1.77 seconds at 390px, versus 2.34–2.38 seconds before the final
optimization. Desktop frame-change p95 is 8.5ms. Every one of 2,684 placement
schedules and 671 complete Replay outputs remains equal to the prior version.

The final fresh-checkout gate passes typecheck, all 2,806 tests, both
parse-contract fixtures, build and release-asset verification. Both published
Orchard bundles and their content-versioned asset links rebuild exactly. The
production dependency audit passes after compatible transitive lockfile fixes.
The source/replay release is merged in PR #16, and the live Orchard's corrected
sources and six initial relation frames have been checked. The fitting and
picture reviews are publicly available. Release receipts, captures and the
controlled timings are retained in [end-to-end verification](/Users/francisronge/.codex/visualizations/2026/09/12/01a0971f-0986-7370-904b-e4a1c4693d82/closeout-20260926/review/end-to-end-proof-20261001/summary.json).

The six older Sol record errors remain inspectable model outputs. Four have
final-order conflicts, one pronounces a lower copy, and Hindi duplicates an
intermediate workspace while retaining correct final order. The audit found no
demonstrated prompt cause. These errors do not justify speculative prompt rules
or automatic linguistic repair. No equivalent accounting failure occurs in the
69 new GPT-6.1 Sol analyses.

The September 29 retained evidence ledger has 221 wholly neutral and 1,143 partly drawn
relation records. Every retained field has an explicit evidence, depiction or
context explanation. These counts include model claims without an existing
drawing, absent or ambiguous required participants, and explanatory fields that
do not assert another drawable dependency. They are not counts of supported
drawings Babel failed to recover. One Arabic mood recipient remains ambiguous
between T and V; the renderer keeps that claim neutral rather than guessing.

The same-anchor changed-value mechanism passes deterministic Replay tests.
None of the 69 new analyses naturally authors that exact continuation. This is
an observational limit, not a defect or a reason to rerun until a preferred
example appears. Likewise, the finite recipe inventory does not claim to cover
all future open-ontology wording.

### What remains before Babel can ship

The reported contract/renderer defects have focused regression and visual proof.
The newer Tree Bank and application-foundation changes are merged in PRs #23–24.
The Replay and prompt closeout is tracked in PRs #25–26. Retain model-authored mistakes
as inspectable evidence; they are not permission to silently repair analyses or
restart qualification indefinitely. A new renderer blocker requires a reproduced
defect. Earlier measurements below describe historical checkpoints and are
superseded by the current result above.

The larger application launch scope remains Programs 0–6 below. It is separate
from this pass and does not supply the next contract/renderer task. No larger application launch
date is authorized by these receipts.

| Remaining product work | Current evidence and required result |
| --- | --- |
| Generation policy and provider qualification | Codex OAuth generations qualify that development transport, not the hosted API routes. Choose the public model/settings, measure its actual route, and qualify each research provider that will be offered. Keep failures and model mistakes inspectable; do not require perfect linguistic analyses. |
| Durable Personal Tree Bank, Program 2 | Immutable local analysis records, shared generation context, atomic wrappers, integrity checks, cross-tab refresh and exact saved-view restoration are merged in [PR #23](https://github.com/francisronge/sylvan-architect-babel/pull/23). Old entries remain readable without migration. Import/export and its W17 adapter remain deferred to the design work; no missing evidence is invented. |
| Shared public/research application, Program 3 | The current `App.tsx` still exposes one workspace with model controls and a Notes tab. Build the shared `/` and `/research` flows, retain Replay explanations, and safely separate application responsibilities without redesigning the verified relation drawings. |
| Product failure inspection, Program 3 | Merged in [PR #24](https://github.com/francisronge/sylvan-architect-babel/pull/24): a failed renderer view can retry without losing the active analysis. Failed model outputs offer diagnostic stage/Replay inspection where readable structure survives; raw bytes and downloads remain available otherwise. The original input is retained, and bounded browser expansion prevents malicious or accidental reference growth from freezing inspection. Public/research presentation remains a separate design decision. |
| Syntactician workspace, Program 4 | Collections, user notes/judgments/citations, sibling-analysis work, query needs, interchange and research exports still require product design and integration. These planned capabilities are separate from the existing flat saved-tree library. |
| Hosted operation, Program 5 | CI and basic local request controls exist. Hosting, supported runtime conditions, public request/spend limits, research access, deployed error handling, accessibility, privacy/security, backups, monitoring and rollback still need decisions or launch proof. The recorded production application is paused. |
| Generation Archive and reviewed corpus, Program 6 | Request provenance and pure record schemas exist; the automatic hosted archive and review/promotion/correction workflow are not integrated. Define retention, deletion, access and licensing rules before implementation. A small working reviewed set is sufficient; a large corpus is not a launch gate. |

The benchmark in Programs 7–8 remains deferred and does not block launch.
Model-authored mistakes, the explained Icelandic spacing, small full-tree mobile
overviews and already-approved visual repairs must not be relabeled as new
blocking renderer defects. New geometry work requires a reproducible example.

### Current problem register and closure criteria

This register governs the renderer/contract closeout. Earlier dated sections
below are history; their open wording does not supersede this register. The
audited candidate passes the recorded recognition, Replay and paint checks.
R28–R30 record the later visual defects and verified repairs. Q3 records the
now-passing local opening target. This
does not qualify the whole application. A rejected record is not proof that its
linguistic analysis is invalid.
Keep the original outputs unchanged throughout investigation. A model-authored
contract mistake may remain a benchmark observation after its cause and faithful
product handling are assessed. It does not by itself justify another prompt
rule, automatic linguistic repair, or a demand for perfect model output.

The September 26 review contains **28 requests / 36 analyses**, with the older
**97 analyses in a separate archive**. The September 27 Astra qualification adds
**8 requests / 10 analyses** in its own review. All new analyses must stay selectable,
including rejected outputs. Each issue below has a concrete observation and a closure
condition; investigate shared causes before adding special cases.

The September 28 independent frozen holdout adds **8 requests / 13 analyses**.
Its [review](http://127.0.0.1:8453/closeout/holdout/) separates five confirmed
finding groups from all thirteen new trees. All returned records pass the input
and stage-fidelity checks; R21–R22 record the frozen renderer failures and
their verified repairs.

Future tree generations use **GPT-6.1 Sol through Codex OAuth**, as requested
September 29. The subscription runner now defaults to that model at high effort.
This supersedes the September 27 Astra preference. Preserve the actual model in
older generation provenance; this change does not relabel older records,
authorize API-key fallback or change the public API generation defaults.

#### September 27 review findings and repair order

The user reviewed all 36 new entries and reported the cases below. This completes
the first human pass through the available views, not approval of the unresolved
defects. Hindi Stage 4 is drawable in inspection, but the user requires normal frame-by-frame
Replay as well. Display identities must preserve both authored positions and leave
ambiguous relation references neutral. Do not request
another full review of unchanged entries. Use these exact records and transitions
for the next before/after review; preserve their original authored outputs.
Numbers refer to the current 36-entry selector; keys remain stable if it changes.

| Review entry | Record and exact view | Finding | Work item |
| --- | --- | --- | --- |
| 4 | Hindi, `hindi-letter/0`, Replay 1–47 | Ordinary Replay now preserves both authored copies at frame 40 using display-only occurrence identities. | C2, R2 |
| 8 | Portuguese, `portuguese-relative/0`, especially [Replay 28 → 29](http://127.0.0.1:8453/closeout/#new/portuguese-relative%2F0/replay/28), 31 → 32 and 33 → 34 | Frame 28→29 retains the selected heads exactly. Reinspection identifies 31→32 as PP movement adding CP and 33→34 as new construction with stage fitting; neither is a confirmed placement defect. | R6 |
| 21 | Greek Analysis 2, `greek-embedding/1`, [Replay 36 → 37](http://127.0.0.1:8453/closeout/#new/greek-embedding%2F1/replay/36), Stage 2 → 3 | The existing VP changes its right daughter; a CP attaches beneath the old V′ in the same frame as the described adjunct merge. That CP attachment has no separate structural micro-step. | R7 |
| 24 | English, `english-long/0`, [Replay 22–25](http://127.0.0.1:8453/closeout/#new/english-long%2F0/replay/24), Stage 3 | The displayed `The`→`the` change no longer splits D/N heights. Frames 22–25 are repaired; early frames retain their prior geometry. | R8 |
| 25 | “Lena must to leave yesterday.”, `english-modal-mismatch/0`, [Replay 20 → 21](http://127.0.0.1:8453/closeout/#new/english-modal-mismatch%2F0/replay/20), Stage 3 → 4 | `must` starts on the left and stays there. The small stage-boundary adjustment is not the repaired side-switch and is not a confirmed remaining defect. | R6 |
| 30 | Arabic Analysis 1, `arabic-letter-negative/0`, [Replay 16 → 17](http://127.0.0.1:8453/closeout/#new/arabic-letter-negative%2F0/replay/16), 19 → 20, 22 → 23 and 26 → 27 | The loose Neg was placed inside the clause before moving outside at 19→20. Repair its component side; 22→23 also includes whole-scene stage fitting. | R6 |

The user rejected the analysis-wide layout/rank repair because it stretched early
branches and changed the fit. It remains reverted. R8 now has a narrower display-
casing correction. R6 has a detached-component ordering correction. Six tests
that demanded identical coordinates across genuine stage growth or movement
were too strict; retain exact stability within each stage and test the required
component side across stages instead. Further
corrections must preserve ordinary early-tree proportions, not reserve the
complete final tree's dimensions at every earlier stage. Hindi needs ordinary Replay controls,
and Greek must retain its already-built VP while the new V′ wrapper is introduced.
No new generations or prompt rules are needed for these renderer corrections.

#### Contract and generated records

- [x] **C1 — Pronunciation inconsistency diagnosed.** In “Which recipe did
  Nadia say that Tomas had forgotten?”, Analysis 1, Stage 3 declares the lower
  object silent in prose but reuses `cprimeEmb` with that object still pronounced.
  Stage 7 retains it. Raw reference expansion and inspection agree exactly. This
  is a model inconsistency; do not infer silence from prose or suppress its copy.
- [x] **C2 — Duplicate workspace diagnosed and inspectable.** Hindi “मीरा ने
  अपने भाई को चिट्ठी भेजी।”, Analysis 1, Stage 4 keeps `ditransitiveV` independently
  and within `lowerV`, duplicating nine IDs and five pronounced positions.
  Stages 5–6 remove the duplication, and final input order is correct. Normal
  47-frame Replay now shows both Stage-4 positions using display-only identities.
  Canonical normalization still rejects the original record. No source correction
  or extra prompt rule is justified by the saved evidence. Independent roots
  remain valid; duplicating the same occurrence is a different condition.
- [x] **C3 — Four final-order discrepancies diagnosed.** These are authored
  record errors under the existing input-accounting contract:
  - German “Den alten Schlüssel hat Emil seiner Nachbarin gestern
    zurückgegeben.”, Analysis 1, Stages 5–6 puts `hat` after TP despite its
    own clause-initial-C explanation.
  - Turkish “Çocukların okuduğu kitapları öğretmen masaya koydu.”, Analysis 1,
    Stage 5 puts `öğretmen` before the object. Its realization group accounts
    only for `okuduğu`, not that reordering.
  - Greek “Η Μαρία είπε ότι ο Νίκος θα φύγει αύριο.”, Analyses 1–2,
    Stages 2–5 puts `θα` before `ο Νίκος`. Neither supplies a realization group.
  Independent raw expansion reproduces all four; the renderer did not reorder
  them. These dispositions do not reject the models' syntactic theories.
  Preserve their outputs and do not sort syntax by token index.
- [x] **C4 — Prompt-regression investigation completed with explicit limits.**
  All 34 stages in the six affected analyses match independent raw expansion.
  All five actual failing request payloads match the current canonical Sol/high
  builder exactly. September 25–26 shared instructions also match, apart from
  the selected framework opening. The exact-input, reference-rewrite and
  consumed-root requirements were present. No demonstrated prompt contradiction
  or ambiguity warrants another rule. Keep these as diagnosed benchmark outcomes.
  All 97 archived analyses pass the independent final-order check, with raw
  responses available for 74. That selected corpus comprises 69 Astra, 15 Sol
  and 13 GPT-5.6 Sol analyses; all 36 September-26 analyses are Sol on different
  inputs. This is not a controlled comparison or evidence of population error
  rates. Why this sample has more mistakes remains unknown; no causal claim is
  needed to close the bounded diagnosis. Canonical rejection and faithful
  inspection remain distinct outcomes.
- [x] **C5 — Preserve real relation updates.** Exact unchanged claims do not
  receive another moment. A changed claim receives its own simultaneous moment;
  previous values and exact anchor ownership persist until that moment. Tests
  cover seeking, explicit predecessor replacement, collection updates without
  prior anchors and retained provenance. All 69 newest analyses have no exact
  unchanged relation duplicates. None naturally supplies the exact same-name,
  same-anchor, same-value-key update, so that model observation remains absent.
  Deterministic mechanism coverage closes this implementation requirement; the
  observational limit does not justify extra model instructions or reruns.

#### Renderer and inspection

- [x] **R1 — Correct the deferred-projection review description.** In the
  targeted German focus example, Replay shows C′, not the CP named by the review
  card. The unchanged authored Stage 1 has a one-child CP above C′; Replay already
  defers that parent until its second branch arrives. The earlier card confused
  the record with the visible Replay and wrongly presented this as a new display
  decision. Keep the existing construction rule and the authored-stage comparison.
- [x] **R2 — Make Hindi available as ordinary Replay, including duplicate positions.**
  Hindi now has 47 frames with Prev, Play, Next and seeking. Frame 40 preserves
  both full copies; later relations occur at 42–43 and 46; frame 47 is final.
  Display-only occurrence identities keep each position separate and preserve
  ancestry continuity. Authored syntax, words, pronunciation and raw output remain
  unchanged. Unique relation anchors follow their exact display occurrence;
  ambiguous current/prior targets retain a neutral moment rather than selecting
  a copy. Provenance retains the original IDs. All 47 frames rendered in the
  browser; normal selector access, narrow Replay, zoom/Fit, and Next/Prev passed.
  The actual in-app tab was also verified and left at frame 1.
- [x] **R3 — Withdraw the Hindi overlap as a normal-Replay issue.** Reproduced
  at 1166px width: the second line of `V[perfective,feminine,singular]` overlaps
  `v[transitive]` in the authored Stage-1 separate-root view. Nearby `T[past]`
  does not overlap in the current capture. This is distinct from the duplicated
  Stage-4 workspace and is not a claim that ordinary Hindi Replay is missing.
  The current browser check opens the equivalent normal Replay frame 17 at
  1166px and finds no overlap; the earlier review also linked the wrong frame.
  Remove the pending Replay decision. No tree or camera change is warranted.
  The old authored-stage inspection capture is not evidence of a Replay defect.
- [x] **R4 — Older authored relation-order conflicts have faithful handling.** Seven
  distinct conflicts survive in four older analyses: “لم يكتب الطالب الرسالة.”
  Stage 3; “Mér líkar þessi bók.” Stages 2–3; “No student has ever read this book.”
  Stage 6; and “Mia seems to want to leave.” Stage 4. A claim names an occurrence
  that a later authored relation introduces. Preserve authored order and inspect
  the affected moments; never expose future syntax early to make them draw.
  Browser captures verify readable authored text, available-anchor marks and no
  premature future syntax. Drawings requiring the unavailable participant wait
  until it exists; a moment-only neutral mark expires under its normal policy.
  These individual old model choices are not automatically product blockers or
  a requirement that the user review all old analyses again.
- [x] **R5 — Complete the finite drawing-state inventory.** All 55 declared
  recipes, 115 accepted family/outcome combinations and 89 witness/expiry
  controls now have public-record-to-production-paint evidence. The atlas has
  446 specimens; 646 desktop/narrow browser checks pass. All 46 Tier-1/Tier-2
  primary-drawing comparisons pass. Transfer-access companion domains are
  verified independently; PF comparisons use the same completed visibility.
  Blocked carriers remain dashed and have no successful arrowhead. The narrow
  idiom bracket defect found in this pass is fixed under R26. Original failed
  receipts and the corrected readiness/paint checks remain preserved.
  This closes the known finite inventory, not every possible future claim.
  Earlier approved trees need no repeated review; R26's changed views remain
  available for human judgment.
- [x] **R6 — Arabic detached Neg placement corrected and verified.**
  The modal side-switch and Portuguese 28→29 are already repaired. The user
  questioned the remaining examples; reinspection found Portuguese 31→32 is
  actual PP movement adding CP, 33→34 is new construction with stage fitting,
  and the small modal adjustment is not a return of the side-switch. Withdraw
  those as confirmed defects. No further change was made to those records.
  Arabic's loose Neg genuinely started on the wrong side of the clause. Internal
  head movement inside a reserved component blocked its outside-position lookup.
  Component ordering now follows that component's unique first attachment while
  requiring its current material to remain inside it before attachment. Splitting
  or ambiguous components remain ineligible. Only synthetic workspace order
  changes; authored children, branch heights, frame order and visible syntax do
  not. The exact 36-analysis comparison changes horizontal positions only in
  Arabic Analyses 1–2, frames 1–19; all coordinates in the other 34 analyses match.
  Desktop/narrow and LTR/RTL tests pass. The user approved the Arabic result.
  The rejected analysis-wide reservation
  remains reverted; no whole-tree future dimensions are imposed on early frames.
- [x] **R7 — Give complement attachment its moment without rebuilding existing VP.**
  Greek entry 21, Analysis 2 attaches CP beneath the existing V′ at frame 37,
  then introduces the adjunct wrapper at frame 38. The already-merged VP and its
  left DP remain visible. Frame 39 is the Stage Record; Replay has 44 frames.
  The attempted extra VP merge and temporary VP removal were explicitly rejected
  by the user and reverted. The existing VP was built in Stage 1; changing its
  right subtree does not require erasing and rebuilding it. Child-list growth
  still receives its attachment moment, and movement-owned attachments remain
  atomic. The rollback initially left frame 37’s right branch drooping: coordinate
  reservation placed the inner V′ at its later depth beneath an unbuilt wrapper.
  That earlier screenshot was not covered by the frame-38 presence check. The
  reservation now keeps a currently direct daughter beside its unchanged sister
  until the wrapper is built, translating its subtree without stretching it.
  Exact frame-37 regressions cover desktop/narrow and LTR/RTL; browser checks cover
  frames 36–39, rewind and zoom. The 44-frame sequence and authored records remain
  unchanged. All coordinates in the four other reviewed construction fixtures
  match the pre-fix runtime. The later R8 correction also preserves these Greek frames.
- [x] **R8 — Align same-depth siblings without changing other branch heights.**
  English entry 24's D retains authored `word: "the"`, but its generated display
  child changes `The`→`the` at frame 24. Comparing that display spelling literally
  incorrectly broke D's geometry continuity while N retained its earlier rank.
  The retained-subtree comparison now recognizes first-letter display casing only
  when the child is owned by that unchanged authored word. All other fields,
  spelling changes, pronunciation, identity, ownership and attachment remain exact.
  Only frames 22–25 change. Frame 12 and every other frame retain their coordinates;
  source and displayed casing are untouched. Desktop/narrow and LTR/RTL tests cover
  the same-rank result, and browser captures verify next/rewind. The authored lower
  DP remains visible at movement frame 19; its absent words are the unchanged
  model record, not this layout correction.
- [x] **R9 — Resolve proven collection updates without obsolete plaques.**
  A unique later feature collection on the same directed occurrences and exact
  field names supersedes its earlier value at the new relation moment. Occurrence
  identities must persist uniquely with unchanged lineage and compatible outcomes.
  The old plaque and its owned connectors retire together; rewinding restores
  them. Competing values, different fields, malformed prior witnesses and changed
  outcomes remain distinct. No model prompt rule was added. Twelve focused
  update/history tests and the browser example cover this boundary. Ordinary
  Agree claims without recovered collection structure retain their existing policy.
- [x] **R10 — Retain the failure cue on a recovered feature comparison.**
  The new Astra English analysis “These pilot have arrived.”, Replay 9, correctly
  produces two blocked feature paths, but the collection painter displays normal
  dotted connectors. The Case/Agree geometry branch drops the outcome, and the
  native plaque routes do not restore it. The frozen renderer reproduces this
  defect; recognition exposed it rather than introducing it. Preserve the
  existing plaque and dotted route and decorate only an already-derived blocked
  path. Do not infer failure from raw native Agree metadata, invent a drawing
  family, or mark successful sibling rows as failed. All three collection paint
  routes now retain the existing failure cross with exact collector ownership.
  The path and cross share local coordinates and the reveal mask; successful
  sibling paths keep their own outcome. Canonical public-fixture tests cover
  standalone, Case-composed and unpaired paths plus the native-status control.
  Browser checks confirm both crosses in English Replay 9, correct active/quiet
  ownership, Next/Prev, seeking, zoom, Fit and narrow layouts. Before/after images
  and a short recording are retained outside the worktree. The final offline
  gate passes all 2,432 tests with no skips or TODOs.
- [x] **R11 — Keep the Greek role grid near its predicate.**
  The user confirmed that Astra Greek Analysis 1, Replay 45, placed the grid too
  low. Its longer role label exceeded the generic local width limit, bypassing
  nearby placement. Compact-height role grids now search near their predicate
  at their full measured width; the existing priority for smaller plaques stays
  intact. Tall grids and other large plaques keep the below-subtree rule.
  Replay 45 now places the grid beside `πιστεύει`. Forward/reverse playback,
  seeking, zoom/Fit and narrow views pass. The 143-analysis comparison preserves
  all tree coordinates and records; 492 changed visible placements have no new
  syntax overlaps or failed connector clearance. Wide-grid placements change
  in 24 analyses; two other plaques move to avoid the newly nearby grids.
  All 2,456 offline tests pass. Captures and the recording remain outside the
  worktree. Tree layout, camera algorithms and authored relations are unchanged.
- [x] **R12 — Complete Turkish attachment at the owning relation moment.**
  Astra entry 7, Turkish Analysis 2, Replay 47 now introduces the new local NP
  with its existing object and temporal adjunct together. Frame 48 no longer
  finishes a missing attachment. The compiler change affects only frame 47
  across 143 saved analyses, with no frame-count changes. Desktop and 390px
  browser checks confirm identical node coordinates and camera at 47 and 48,
  including Next, Prev and rewind. The stage's reserved positions reflect the
  corrected attachment; other analyses' construction is unchanged.
- [x] **R13 — Preserve the Arabic plaque through selection.**
  Astra entry 5, Arabic Replay 32→33 now keeps the Case/Agree plaque's position
  relative to its assigning occurrence. Attachment changes use available parents
  and each boundary's actual Replay visibility, not future parents or the union
  of later reveals. The Case curve formula is unchanged. The final pocket clears
  later syntax and produces a curved route in this example.
  A regression audit also found a preliminary collection reservation replacing
  an accepted pocket in saved German coordination frames 55–60. Accepted pockets
  now persist until their actual geometry boundary. Browser checks confirm stable
  Arabic 32→33 and German 56→57 at desktop and 390px widths. The last correction
  changes only that German record across 143 analyses; connector clearance passes.
- [x] **R14 — Separate binding indices from their paths.**
  The `operator-binding` Tier 2 recipe uses the same path and optional scope-hull
  painter as Orchard I1b, Operator / Variable Binding. The overlapping index
  placement already exists in the August 17 checkpoint; the August 28 integration
  preserved it. Measured index ink now clears the curve and arrowhead. Browser
  comparisons confirm unchanged paths and hulls in Orchard frame 66 and unchanged
  binding paths in fresh Turkish, Hindi and Japanese examples through zoom/Fit.
  The correction changes only index placement, not scope or relation recognition.
- [x] **R15 — Reserve Case plaques from the assigning occurrence only.**
  The Arabic regression audit exposed an older Icelandic allocation defect in
  `untouched2-icelandic/0`, Stage 3. Allocation no longer substitutes the recipient
  for the unavailable assigning occurrence `tI`. Its reservations start at the
  actual source reveal, Replay 29. Focused tests cover source-before-recipient,
  unavailable source, neutral one-anchor plaques and the saved Icelandic record.
  Browser checks at frames 28, 29 and 36 confirm that Case arrows clear the labels.

- [x] **R16 — Restore context and distinguish review decisions from findings.**
  The review wrapper now displays the saved explanations beside each tree. The
  Astra page separates the one Greek placement choice, the user's five questions
  with their answers and exact frame links, and optional browsing of all ten
  analyses. The Turkish prose/tree mismatch remains a model observation rather
  than an approval task. Existing deep links and browser-local notes persist.
  The review exposes Replay only; redundant status, provenance and one-of-one
  analysis subtitles are removed. Full-size frame links remain beside the
  comparisons. Renderer runtime,
  records and Replay are unchanged.

- [x] **R17 — Recover the authored QR scope box.**
  In “Every student read a book,” Analysis 2, Replay 26, `scopeHost` names the
  finite clause containing the lower occurrence. Recovery now accepts that role
  and checks containment of the lower occurrence, matching Orchard; the raised
  occurrence can sit outside the box. The box remains optional when no domain
  is authored. Rechecking all 143 analyses and 1,450 relations changes exactly
  this one render plan; authored records and Replay moments are unchanged.
- [x] **R18 — Clear neutral labels from their own phase-edge outlines.**
  French Replay 14 and Japanese Replay 16 placed neutral role text over the
  padding of the edge rectangle. Label placement now reserves that existing
  outline. Browser comparisons confirm unchanged syntax and box geometry,
  with clearance through zoom, Fit, rewind and 390px views. This bounded fix
  does not claim general collision avoidance for every relation graphic.
  Both repairs pass all 2,498 offline tests, production and Orchard builds, and
  the integrated browser comparison against the existing Orchard recipes.
- [x] **R19 — Compare complete Tier-1 and Tier-2 drawings, including indices.**
  Compared the 55 recipe inventories against the shared drawing components and
  added complete-plan tests for control, QR, phase arcs, intervention and the
  modifier fork. Recovered control now supplies matching indices, including
  authored literals, through the existing control painter. QR uses the shared
  occurrence-based index allocator; recovered phase arcs share the curated
  primary/secondary ordering. Intervention's own blocked outcome no longer
  adds a second generic goal mark; independently anchored judgments survive.
  Existing edge outlines remain intact. Partial evidence still earns only its
  supported components: the saved “Mia seems to want to leave” record supplies
  no control domain, so its missing box is not a renderer omission.
  Across 143 saved analyses and 1,450 relations, twenty control claims gain
  indices; thirty other plans only renumber generated dependency/theta letters
  as those indices reserve their symbols. Authored records, stages and Replay
  frame counts are unchanged. This is a bounded component audit, not proof of
  every possible combination of authored claims.
- [x] **R20 — Check neutral-label collisions with other relation graphics.**
  The before/after browser comparison covers all 285 relation moments in the
  28-analysis drawing review. Twenty-eight frames across fourteen analyses
  contained collisions with binding, Case, movement, index text or plaque ink.
  Neutral label placement now yields to the measured finished drawings;
  open outlines reserve strokes rather than their empty interiors. It ignores
  invisible hit targets and handles a review wrapper hidden until render commit.
  No collisions remain in that desktop or 390px sweep. Syntax-node positions
  are unchanged in every desktop comparison. Exact-link opening, zoom, Fit and
  forward/reverse stepping pass on representative changed frames. Arbitrary
  dense scenes can still exhaust placement space; this is not a universal
  no-overlap guarantee.
  The review starts with three changed examples: control Replay 25, Hindi
  Replay 35/38/41, and Arabic Replay 41. All ten newest analyses and the previous
  drawing catalog remain accessible. The full offline gate passes 2,509 tests;
  all 114 production recipe browser cases and the hidden-host measurement
  regression pass. Production/Orchard builds and release assets pass. No fresh
  generations or model-facing prompt changes were made for this pass. The user
  reviewed these three comparisons and approved them on September 28.

- [x] **R21 — Stop descriptive chain claims from delaying movement traces.**
  The saved English intermediate trace now appears with successive movement at
  Replay 54, rather than the later government claim at 56. Icelandic subject
  fronting likewise introduces its lower trace immediately. A new occurrence
  occupying another member's proven preceding slot cannot claim a fresh landing.
  An explicit preceding source selects the active hop while unchanged earlier
  chain members remain separate evidence. Icelandic's extended-chain relation
  now recovers its actual raising hop. Saved-record tests cover both directions
  of the distinction without altering authored stages or pronunciation.
- [x] **R22 — Recover supported claims exposed by the independent holdout.**
  All five finding groups now use the existing drawings:
  - Japanese readings 2–3 recover covert movement and its scope domain. The
    contained operator does not compete with the explicit higher occurrence.
  - Arabic head movement accepts equivalent optional witness roles through the
    Tier-1 signature, registry version 24. Resumptive binding, relative
    adjunction and the explicit object theta role recover their supported parts.
  - English same-lineage chain members can occupy one `positions` list. French
    coreference separates its two nominal referents from the declared discourse
    head; neither rule invents movement or binding.
  - The two English agreement conflicts retain both participant specifications
    and show the existing failure marks. Conditional, contradictory, missing
    and competing evidence remains guarded.
  No prompt changes, new generations or edits to model records were required.
  All 124 holdout relation/forest hashes remain unchanged. All 143 older
  analyses retain identical Replay structure and frame order. Two older failed
  comparisons now consume their explicit negative status as drawing evidence;
  their trees and relation moments are unchanged.
  The repaired holdout has 638 Replay frames. Thirty spurious construction
  frames disappear because the two Japanese landings and Icelandic raising
  landing now appear complete at their movement moments. Every authored
  relation still receives exactly one moment. The frozen 668-frame version
  remains separately available for comparison.
  The full offline gate passes: 2,530 tests, typecheck and parse fixtures.
  Chromium checks cover all 638 frames, all thirteen analysis selectors,
  Next/Prev, rewind, zoom/Fit and 150 narrow frames, with no runtime errors,
  invalid geometry or neutral-label/ink collisions. Exact-frame links and
  close-up captures cover the five repairs. The source and before/after evidence
  are archived outside the worktree; no shared layout or camera code changed.
  Other neutral records still require their own evidence: a trace-only LF
  interpretation does not provide two full copies, negative scope does not
  imply QR, and batched Case assignment does not authorize guessed pairings.
  Q3's deployment/browser checks and C5's coverage gap remain separate.
- [x] **R23 — Keep successive movement arrows at their intermediate landings.**
  A phrase retaining its occurrence ID at a higher landing no longer pulls an
  earlier arrow up with it. The earlier endpoint transfers to the exact authored
  lower witness at the next movement moment and reverses correctly on rewind.
  Repeated descriptions retain one shared curve and both claims' ownership.
  Across 156 saved analyses, only the two English question readings and one older
  Swedish analysis change arrow endpoints; all trees and Replay frame sequences
  remain identical. Five regression tests cover the saved case, renamed IDs,
  ambiguous evidence, a third hop and shared-curve continuity. The full offline
  gate passes 2,535 tests. Desktop and phone-sized browser checks cover the two
  hops, rewind, zoom/Fit, final persistence and all thirteen embedded Replays with
  workers blocked. Builds and release assets pass; evidence is archived outside
  the worktree. No model records, prompt, tree layout or camera code changed.
- [x] **R24 — Repair branch ranks, workspace continuity and connector marks.**
  - Arabic readings 1–2, frames 19–22: all canvases in a stage now use one
    vertical rank unit before coordinates are retained. Direct daughters stay
    level when a movement changes the canvas depth. The earlier rejected global
    branch-height rewrite remains absent.
  - Arabic reading 2, frames 49–58: the unchanged independent books subtree
    retains its completed coordinates while the next stage opens with a relation
    elsewhere and later attaches it. Its topic merge remains frame 54. This does
    not lock the camera across authored stages; the existing stage fit still runs.
  - French Case plaque: nearly level side-entry connectors retain a bounded bow
    and word/category clearance. Ordinary Orchard approach geometry is unchanged.
  - English number conflict: both values and paths remain, with one X owned by
    the exact failed comparison. Separate comparisons retain separate marks.
  - **Corrected diagnosis — Icelandic frame 37:** the native single-frame layout
    was an unsuitable spacing comparison. Replay reserves the incoming subject
    and later head slots. Before that arrival, IP is unary over I′ and must stay
    centered on it. Closing only the C–IP gap would create an overlap or bend that
    unary branch. Its geometry is unchanged. A future compact-slot refinement
    must handle all arriving contours together; it is not a safe local tightening.
  Verification: all 156 saved records and Replay sequences are unchanged; 146
  analyses retain exact coordinates. Ten have stage-rank corrections, including
  the Arabic workspace repair. The coordinate audit finds no new reversed,
  upward or increasingly tilted sibling branches. Reviewed Greek, Students,
  modal English, Portuguese and earlier Arabic layouts remain exact. The full
  offline gate passes 2,555 tests. All 638 frames in the thirteen current Replays
  render at phone width with workers unavailable; desktop checks cover the
  reported frames, rewind and zoom/Fit. Orchard and release assets pass. Captures
  and a recording remain outside the worktree. No prompt changes or generations.
- [x] **R24 follow-up — Preserve the retained workspace's RTL drawing origin.**
  Arabic reading 2 widens its canvas from 6,060 to 7,140 units at frame 50.
  Reflection previously added an unintended 1,080-unit shift to the unchanged
  books subtree. The retained scene now carries its origin forward. Translate
  the whole scene: pinning only the component introduced a label collision and
  was rejected during visual verification. Every branch shape and inter-component
  clearance remains unchanged. The books subtree retains its drawing coordinates
  through frames 49–58 and its screen position with a manually positioned camera.
  Automatic fitting remains unchanged; this is not a fix for the clause jump below.
  Verification: all 156 saved records and Replay sequences remain exact; only
  this reading's RTL frames 50–58 change coordinates, by one uniform translation.
  Desktop and phone checks cover those frames, rewind, manual zoom, Fit, syntax
  label collisions and representative Arabic, French, English and Icelandic
  controls. The full offline gate passes 2,556 tests. Builds and release assets
  pass. Captures, browser checks and a recording are retained outside the worktree.
- [x] **R24 follow-up — Build the Arabic clause in its reserved attachment position.**
  The approved prototype is integrated into the shared Replay coordinate planner.
  A qualifying independent component starts in the space its later attachment
  needs, using its own earlier branch geometry. The source's old place transfers
  to its exact lower witness at movement; the landing, trajectory and later
  parents retain their original reveal moments. Incompatible attachments and
  ambiguous witnesses keep the ordinary layout. The clause stays put from its
  selection through frames 49–58; the existing books-workspace repair is retained.
  This replaces the rejected sliding animation and broad future-rank reservation.
  Production matches the accepted prototype across 26,372 coordinate checks on
  156 saved analyses. Only the same four analyses qualify. Browser checks cover
  all 198 frames of those four analyses at desktop and phone widths, actual
  production workers, Next/Prev, manual zoom and Fit, plus the normal Arabic
  review at 49→50. Syntax and cameras match the prototype, with no new syntax-label
  overlaps. The existing mobile full-tree readability limits remain; one English
  phone view fits up to 6.72% smaller than before the prototype.
  The full offline gate passes 2,566 tests, typecheck and both contract fixtures.
  Before/after captures and recordings remain outside the worktree. No prompt
  changes, regenerated analyses or authored-record edits were needed.
- [x] **R24 follow-up — Center the shared agreement X.** Both feature rows
  belong to one failed comparison. Its single X now sits between their connector
  midpoints, retaining exact ownership and the existing paths. Desktop and phone
  checks cover rewind, zoom, pan and Fit; tree coordinates, paths and camera
  transforms match the preceding build. Single-route failures and independent
  comparisons retain their own marks. All 2,555 offline tests pass. The updated
  Replay, before/after captures and recording remain outside the worktree.
- [x] **R25 — Recover explicit form, reference and participant properties.**
  Named lexical allomorphs reuse the existing PF plaque without manufacturing a
  prior occurrence or rewriting a conditional literal. Explicit topic/pronoun
  dependencies receive coindices without being reclassified as binding or copy
  identity. Qualified nominal roles and explicit clitic-role labels identify
  independently authored feature properties. Default agreement receives no
  invented dependency arrow. Ambiguous, denied, silent and missing evidence
  remains guarded. Eight relation records change in the thirteen-record holdout;
  all 143 older drawing dispositions and all 156 Replay structures, visibility
  sequences and frame orders remain exact. Authored records are unchanged.
  Seven regression tests cover exact item ownership, renamed IDs, a different
  language, default agreement, denied outcomes and competing participants.
  Browser comparison verifies identical node geometry and camera transforms at
  all eight moments, seeking, zoom/Fit, four narrow views and all three review
  cards. The offline gate passes 2,573 tests, typecheck and both parse fixtures;
  the frontend build passes. Before/after images, a recording and the remaining
  neutral-evidence audit stay outside the worktree. No prompt change or new
  generation was needed. On September 29, Francis reviewed all thirteen latest
  trees and approved them. This closes the current visual review, while the
  remaining uncertain evidence associations retain the bounded work above.

- [x] **R26 — Complete the full corpus repair and Replay audit.** Shared
  evidence rules recover qualified Case and agreement, feature and form
  properties, exact operator/binding pairs, relative predication/attachment,
  focus, phase-edge, ellipsis correspondence, PF rewrites and grouped realization
  ownership. Each recovered part stays bound to its asserted claim and exact
  participant. Ambiguous or unsupported siblings remain neutral. No Tier-2
  recovery repairs malformed exact Tier-1 evidence.
  Replay now keeps unproven landings at their own moment, constructs retained
  roots forward, preserves independent context around rewrites and retains the
  prior authored source pronunciation until its actual owning event. The full
  audit covers 9,804 frames, 459 movement transitions and 6,359 new edges in 225
  analyses, with no early traces, late first appearances or topology discrepancy.
  Comparing the original candidate yields 208 identical Replay sequences and
  17 explained repairs. All authored records remain unchanged.
  Positive Case paths retain exact native geometry; blocked Case uses the same
  curve with a failure mark and no success arrowhead. The idiom bracket preserves
  desktop geometry and reduces only its initial gutter/cap when a narrow viewport
  lacks space. Before/after checks prove unchanged branches and camera transforms.
  Root browser checks cover 9,104 Replay frames, all 19 changed older analyses,
  seeking, actual Next clicks, zoom and analysis switching. The current offline
  receipt passes 2,671 tests, typecheck and both contract fixtures. All 55 Orchard
  cards and all 59 source images load. Screenshots, 19 short recordings, raw
  first attempts and exact source receipts stay outside the worktree.
  Evidence: [full-pass proof](/Users/francisronge/.codex/visualizations/2026/09/12/01a0971f-0986-7370-904b-e4a1c4693d82/full-pass-proof-20260929/summary.json).
- [x] **R27 — Reduce immutable plaque-query overhead without changing drawings.**
  Rectangle collision queries use a prepared left-first branch list with cached
  exact bounds and subtree skip indices. Leaf collision rules, curved-query
  recursion, predicate order, candidate selection and tolerances remain exact.
  The captured browser-metrics job takes 13.95% less allocation time in Node.
  All 2,684 schedules match across 225 analyses and 446 recipe/state controls
  at desktop/narrow widths and both directions. Independent review passes 81
  checks, including 8,892 differential queries and numeric-boundary cases.
  Real Chromium preserves all 60 Turkish frames at both widths, including every
  native shape and camera transform. Opening improves from 2.60 to 2.35 seconds
  at desktop and 2.64 to 2.35 seconds narrow. This does not meet Q3's 2-second
  target. The full offline gate and build pass against the final source freeze.

- [x] **R28 — Repairs verified and changed views accepted.**
  Francis inspected every frame in all 69 newest trees. All 355 authored Stage
  Records were checked against their syntax and relations; no additional
  definite record contradiction was found. Deliberately unconverged forests
  remain inspectable. The prior casing, relation ownership, source attribution,
  Korean binding enclosure and Turkish independent-workspace repairs remain in
  place, with their evidence preserved below.

  The October 1 motion recheck showed that retaining seven waiting heads had
  not retained complete subtree shapes or camera continuity. The corrected
  reservation now follows a component's complete attachment history, preserves
  its pre-movement source ancestry, and validates branch order, independent ink
  clearance and unchanged-node motion before accepting it. The reported #35
  frames 36–37, #37 frames 41–42 and 54–55, #41 frames 30–31 and #43 frames 33–34
  now retain exact existing-node coordinates. Portuguese 34–35 also retains its
  stationary heads while the authored subject movement remains visible.

  Adjacent Replay camera changes interpolate over 360ms from the painted pose;
  manual zoom/pan cancels them immediately. Reduced-motion mode, direct seeking
  and explicit Fit remain immediate. Construction keeps one fit per authored
  stage. Only the final Stage Record releases historical source positions and
  fits the completed drawing. #66 is 55.9% larger on desktop and 49.9% larger on
  phone. #35's final syntax coordinates and all other final tree coordinates
  remain unchanged; no fixture-specific centering rule was introduced.

  The subsequent side-by-side review found a branch-proportion regression in
  #66's earlier frames: backward reservation imports a future vertical level.
  R30 repairs that defect by retaining the current root fork at its daughters'
  normal height. The original checks below did not detect branch proportions;
  the added tests and four-configuration corpus comparison cover this repair.

  Verification compares all 225 retained analyses and 9,804 frames at desktop
  and phone widths in both directions. It finds no new stationary-node jumps,
  worse ordinary construction displacement, increased workspace ink overlap,
  malformed branches, final-coordinate changes, prepared Replay changes or
  authored-input changes. Pre-existing numeric ink intersections are not all
  eliminated. The integrated browser pass measures the reported boundaries,
  final fitting, playback/seek, manual zoom, owned relation geometry and reduced
  motion at both widths. The temporary public review contains only the two
  current changed items, with all 69 trees still available and no horizontal
  page overflow. No provider was called.

  Typecheck, all 2,755 offline tests, both parse-contract fixtures, frontend
  build, Orchard build/verification and release-asset verification pass. Failed
  prototypes and initial harness failures remain recorded with their successful
  corrections. Temporary verification browsers exited; the local review server
  and public phone link remain running for review.

  Current source hashes, comparison receipts, before/after images and short
  motion recordings: [motion and fitting proof](/Users/francisronge/.codex/visualizations/2026/09/12/01a0971f-0986-7370-904b-e4a1c4693d82/closeout-20260926/review/motion-fix-proof-20261001/summary.json).
  Earlier evidence: [initial follow-up](/Users/francisronge/.codex/visualizations/2026/09/12/01a0971f-0986-7370-904b-e4a1c4693d82/closeout-20260926/review/review-followup-proof-20260930/summary.json),
  [source correction](/Users/francisronge/.codex/visualizations/2026/09/12/01a0971f-0986-7370-904b-e4a1c4693d82/closeout-20260926/review/source-correction-proof-20260930/summary.json),
  [workspace/enclosure repair](/Users/francisronge/.codex/visualizations/2026/09/12/01a0971f-0986-7370-904b-e4a1c4693d82/closeout-20260926/review/r28-renderer-proof-20261001/summary.json),
  [screen-motion recheck](/Users/francisronge/.codex/visualizations/2026/09/12/01a0971f-0986-7370-904b-e4a1c4693d82/closeout-20260926/review/motion-recheck-proof-20261001/summary.json),
  [enclosure width](/Users/francisronge/.codex/visualizations/2026/09/12/01a0971f-0986-7370-904b-e4a1c4693d82/closeout-20260926/review/binding-width-proof-20261001/summary.json).
  Q3's previously measured 2.21-second desktop and 2.22-second narrow Turkish
  opening remains a separate performance limit; this repair does not close it.


- [x] **R29 — Preserve existing syntax below an unrevealed adjunct parent.**
  English ellipsis frames 52–55 now retain `ipB → ibarB` while the future outer
  I′ is hidden. Frame 56 performs the one new adjunct attachment. The same
  shared fix restores Arabic frames 48–52 and Turkish frames 44–46. Current
  sibling order comes from the visible attachment, and temporary construction
  containers do not distort the real tree's layout budget. Real authored
  workspace forests retain their prior sizing. Nested-wrapper and asymmetric
  sister regressions pass. The 225-analysis, four-configuration audit preserves
  all final coordinates and every coordinate in the 222 unaffected analyses,
  with no new overlap or malformed-branch warnings. Chromium, WebKit and Firefox
  pass the affected frames at desktop and phone widths. The real app also
  preserves multiple roots, revised feature values and malformed-relation
  evidence through Tree Bank save/reopen.
  [Before/after pictures and live frames](https://babel-fitting-preview-20261001.vercel.app/overlaps/gallery.html).

- [x] **R30 — Reserve future space without stretching current branches.**
  In #66, `holdout-mandarin-negative-relative/0`, the published comparison's
  frame 15 has `rcTP → rcT` separated by 212 layout units before and 431.58
  after. The new layout leaves an empty level for `rcTProjection`, which first
  appears at frame 19. At that point the two visible branches each span 215.79
  units. This is raw layout geometry, independent of camera scale. The older
  runtime already reserves that level within stage 2 (frame 18); backward
  attachment reservation now imports it into stage 1 as well. Existing checks
  for branch order, intersections and stationary-node motion do not reject
  this distortion. Stage and cross-stage reservation now keep a visible root
  at the unseen successor fork with its identical ordered daughters. All
  daughters stay fixed; internal parents and inconsistent offsets are excluded.
  The repair changes only six earlier root heights across four of 225 analyses.
  Across all 9,804 frames at desktop/phone widths in both directions, final
  geometry and authored/compiled records remain identical, with no added
  overlaps, malformed branches or stationary/construction jumps. Focused tests
  include the Mandarin case, English infinitival growth and negative controls.
  Typecheck, all 2,772 tests, both parse-contract fixtures and the frontend build
  pass. Desktop/phone browser checks cover frames 14–20, the previously reported
  stage-boundary jumps, shared stage fit, arrow keys, manual zoom and final Fit.
  The corrected runtime is used in the local and shared fitting comparison.
  [Repair evidence and recording](/Users/francisronge/.codex/visualizations/2026/09/12/01a0971f-0986-7370-904b-e4a1c4693d82/closeout-20260926/review/branch-fix-proof-20261001/summary.json).
  [Original diagnosis](/Users/francisronge/.codex/visualizations/2026/09/12/01a0971f-0986-7370-904b-e4a1c4693d82/closeout-20260926/review/branch-spacing-proof-20261001/evidence.json).

The follow-up pass rendered all 475 Replay frames in the ten fresh Astra analyses,
checked selection from the review menu, forward/reverse playback, narrow views,
zoom/Fit, and Orchard binding paths/hulls. Representative older plaque scenes
were checked before and after. `npm run verify:all` passes 2,455 tests with no
failures, skips or TODOs; build and release-asset verification pass. Captures and
short recordings remain outside the worktree. R11 is now repaired as recorded
above; the subsequent R3 recheck withdraws that Replay issue. These fixes do not close the entire
renderer roadmap.

Two further Astra observations are explained, not confirmed defects. Entry 4,
Greek, authors both clauses in its first stage; Replay 1–51 therefore share that
large stage's camera fit. Keep its current camera behavior. Entry 10, Japanese,
Replay 24 is the authored “relative operator Internal Merge” from the v-edge to
the C-edge; its nearly vertical arrow is the ordinary phrasal movement path.
The category D does not turn that relation into head movement. No rendering or
record change is justified by either observation.

All 36 original analyses remain available. Their raw outputs are unchanged.
The September 27 audit includes all 1,475 Replay frames at desktop and narrow
widths. Recognition changes are separately enumerated under Q1. The integrated browser pass completed 57 checks, including Arabic forward/
backward playback at desktop and narrow widths and unchanged English, Greek,
Portuguese and modal views. All 2,411 offline tests pass with zero skips or TODOs;
typecheck, contract fixtures, build and release assets pass. Evidence remains
outside the worktree.

#### Recognition boundaries and qualification

- [x] **Q1 — Saved-record recognition and repaired paint verified.**
  All 189 relations in the current 36 analyses were checked, including Hindi:
  145 fully drawn, 30 partial and 14 wholly neutral. The 233 recovered claims
  comprise 7 Tier 1, 182 Tier 2 and 44 neutral claims. The latter are 28 contextual
  residues, 13 claims without a designed depiction and 3 missing-witness cases:
  English ellipsis frame 45 has an ambiguous focus associate; Finnish frames 29
  and 34 lack a selecting requirement and a directional Case assigner respectively.
  Hindi frame 42 now recovers ergative Case from corroborated title, qualified
  participants and the authored K feature. No extra linguistic fact is inferred.
  Comparing all 97 older analyses exposed 13 real defects: ten lost theta grids,
  degree-sign head notation, QR mistaken for head movement, and duplicate nominal
  concord painting from identical evidence. Shared evidence/ownership fixes
  recover those without changing other claims. Twenty other changed records
  were supported recovery or ownership changes. Final archive totals are 443
  fully drawn, 592 partial and 125 neutral records; no authored record changed.
  The focused recognition gate passes 141 tests. Every current relation still
  owns exactly one Replay moment. The later Q4 audit found further recoverable
  components, so this earlier pass did not establish recognition completeness.
  The integrated browser pass covers every changed older record,
  the Hindi recovery and the seven old timing conflicts; no browser errors or
  invalid SVG paths occurred. Representative restored marks were inspected.
- [x] **Q2 — Astra holdout diagnosed and recognition misses repaired.**
  Eight preselected unfamiliar inputs were sent once through Codex OAuth to
  GPT-6 Astra/high, producing ten analyses. No retry or paid API fallback occurred.
  Candidate `491af9256edf432cc46dd61afd7e0c5bc020045d` stayed unchanged. All ten
  pass canonical processing, exact input accounting and independent raw-stage
  fidelity. All 101 relation records retain their authored moments; no exact
  duplicates or judgment-named relation records occur. The deviant input “These
  pilot have arrived.” remains unchanged and receives explicit agreement-conflict
  claims. Turkish Analysis 2, Stage 3 contradicts its own VP-adjunction explanation
  by placing the adverb under NP; preserve this model error for review.
  The frozen renderer draws 24 records fully and 58 partly, leaving 19 neutral.
  Its 77 neutral claims comprise 40 contextual residues, ten missing-witness
  cases, seven claims without designed drawings and twenty records with supported
  components that recognition missed. These are qualification failures of that
  version. Shared evidence repairs must preserve the frozen results and be
  reported as repairs informed by this batch, not an independent holdout pass.
  All ten analyses are selectable in normal Replay. All 475 frames rendered in
  local Chromium; first/last frames, backward navigation, Fit and narrow views
  passed. Maximum opening was 1,340ms; frame-change p95 was 18.18ms. This is a
  purposive diagnostic sample, not evidence of an 80% population-quality rate.
  Follow-up shared evidence repairs recover all twenty missed components.
  The adapted renderer has 34 fully drawn, 55 partial and 12 neutral records;
  its 182 claims comprise 8 Tier 1, 107 Tier 2 and 67 neutral claims. Every
  remaining neutral claim was classified in that pass: 46 contextual residues, 14 missing
  witnesses and 7 without a designed depiction. Examples include a Turkish
  repositioning claim without prior-root identity, a Greek particle without
  directed feature roles, and English interrogative scope without a specified
  domain. Q4 supersedes that classification with further evidence-backed repairs.
  No prompt, source record, recipe family or tree layout changed.
  All 1,349 saved relation render plans across 133 analyses remain identical.
  The 750 focused tests and an independent boundary review pass. The adapted
  475-frame browser pass also passes. The final run after R10's repair reports
  maximum opening 1,345ms, frame p95 19.76ms and zero browser errors. Visual
  inspection of all twenty repaired moments exposed R10 (now repaired) and
  raised R11 (subsequently confirmed and repaired). All ten new analyses start at frame 1 when
  selected. The two new review cards open the Turkish authored mismatch and
  Greek grid placement; they do not require another pass through older analyses.
  The earlier review's 45 Replay views retain identical frame identities and
  order after rebuilding against the final runtime. Recognition counts and
  automated checks do not substitute for human visual approval.
- [x] **Q3 — Meet the two-second local opening target with identical output.**
  The complex Turkish relative-subject tree previously exceeded the target.
  Fixed crossing bounds and sample weights are now prepared once, a known
  blocker can reject a nearby connector candidate before the complete query,
  and exact string normalization has a bounded cache. A miss still runs the
  complete collision query. Candidate order, collision rules, typography and
  drawing geometry are unchanged. The cache retains at most 2,048 strings and
  bypasses keys or results over 4,096 characters; input coercion still occurs
  on every call.
  In three fresh Chromium contexts per width, desktop openings are
  1,705 / 1,703 / 1,723ms and phone-width openings are 1,772 / 1,750 / 1,710ms.
  The matched previous runtime takes 2,342–2,376ms. Frame-change p95 is 8.5ms
  desktop and 8.4ms narrow, below the preselected 100ms limit. These are local
  desktop-browser measurements at two viewport widths, not physical-phone or
  universal hardware guarantees. All 2,684 schedule comparisons across the 225
  corpus analyses and 446 controls in four configurations are exact; all 671
  complete Replay outputs match. The 63 focused tests and final 2,806-test
  fresh-checkout gate pass. Original slower measurements remain in the evidence.
  [Controlled browser timings and verification](/Users/francisronge/.codex/visualizations/2026/09/12/01a0971f-0986-7370-904b-e4a1c4693d82/closeout-20260926/review/end-to-end-proof-20261001/performance.json).
- [x] **Q4 — Audit drawing variety against the actual records.**
  Rechecked all 143 saved analyses and 1,450 authored relation records against
  all 53 linguistic drawing recipes and two interface companions. Repetition
  has two causes: the corpus contains many ordinary feature dependencies,
  movements and theta assignments, and the recognizer missed supported parts
  of 24 records. Shared evidence recovery now restores ten Case paths, seven
  phase-edge outlines, two ellipsis correspondences, two stem rewrites, two
  form properties and one relative-modifier fork. These use existing primitives;
  exact Tier-1 failures are not repaired by Tier 2 and unsupported context stays
  neutral. All eight saved Astra request payloads match the current prompt;
  no prompt change or new generation is justified or performed.
  The corpus reaches 25 recipe families, up from 23; the ten newest analyses
  reach twelve, up from ten. Of the 28 unobserved linguistic recipes, sixteen
  require claims absent from the records, eleven lack the details their drawing
  needs, and one is already represented by ellipsis ghosting. For example, 21
  order-related records provide no complete prior/current ordering columns for
  the cyclic-linearization rail. Eleven exponent/allomorph/correspondence records
  provide no complete paired inventories for the PF correspondence map. French
  mediated concord retains its agreement plaque and neutral mediator context;
  a direct connector would incorrectly skip the explicitly authored v mediator.
  The latest 101 relation records now comprise 34 fully drawn, 56 partly drawn
  and eleven wholly neutral records. Their 67 neutral claim components include
  contextual residue; they are not 67 wholly failed relations.
  Authored records, relation order and frame identities remain unchanged.
  The minimal Drawings review links the six repair types, existing vines,
  control, predication, scope, adjunction, intervention, idioms and parasitic
  gaps to exact Replay frames. All ten latest Astra analyses remain selectable;
  no repeat review of all 143 saved analyses is requested. The integrated visual
  pass covers every card, representative before/after geometry, zoom/Fit at
  desktop and 390px, and all 475 newest frames. Recognition coverage does not
  establish a population-quality percentage or replace human drawing judgment.
  Visual inspection caught a regression introduced by the new stem recovery:
  the drawing consumed the exact lexical witnesses, delaying the terminal's
  update until the Stage Record. Replay now keeps the recovered input/output
  evidence for its owning transition. Japanese 書く→書い and 読む→読ん update
  at frames 35 and 36 respectively. A generic PF row using the very same
  original stem-value item is subsumed by the rewrite; independent whole-word
  and sibling rows remain. Focused browser checks verify both moments, rewind,
  seeking and narrow views. Across 143 analyses and 5,955 frames, final Replay
  canvas geometry, visibility, order and relation moments match the pre-recovery
  baseline. All 2,495 offline tests pass with no skips or TODOs; production build,
  Orchard build and release-asset verification pass. Captures and short recordings
  remain outside the worktree. This bounded audit is complete; Q3 and human
  review of the changed drawings remain distinct qualification limits.
  Subsequent user review found the additional missed QR component recorded in
  R17; the audit's completion did not establish that every component was correct.
- [x] **Q5 — Freeze the approved candidate and run an independent holdout.**
  Candidate `bc1c099171ab9c56de437ecc2f918b3ba8da17ad` is archived with source
  hashes and a recoverable Git bundle outside the worktree. Eight inputs were
  selected and hashed before dispatch, with no exact repeats among the previous
  143 analyses. GPT-6 Astra/high through Codex OAuth returned thirteen analyses
  from eight first attempts, with no retries or paid fallback. Prompt, renderer,
  runner configuration and archived responses stayed unchanged during the run.
  All thirteen pass canonical processing, exact final input accounting and
  independent raw-reference expansion. No JSON repair, identical repeated
  relation record or raw/normalized stage mismatch occurred. The deviant English
  input remains deviant. These checks do not certify the model's linguistics.
  The frozen candidate's 124 relation records comprise 25 fully drawn, 58 partial
  and 41 wholly neutral records; its 199 claims comprise 10 Tier 1, 90 Tier 2 and
  99 neutral claims. Neutral claim totals include contextual residue and must
  not be reported as the number of missing drawings or a failure percentage.
  All 668 Replay frames rendered in local Chromium; all thirteen analyses are
  selectable. Next/Prev, rewind, zoom/Fit and 150 representative narrow frames
  passed. Desktop and narrow relation checks found no neutral-label/ink collision
  or invalid geometry. Maximum opening was 930ms and frame-change p95 21.54ms
  at 1600px. The unchanged candidate passes `npm run verify:all`: 2,509 tests
  plus typecheck and fixtures. All five finding cards and fifteen exact-frame
  links were also checked, including returning between different analyses.
  R21–R22 recorded defects in this frozen candidate and are now repaired in
  a separate review. The original review preserves the frozen defects for
  comparison; it does not silently substitute the repaired runtime. No contract/prompt change is justified by these results. This is a
  purposive diagnostic sample, not an estimate of 80% population quality. Q3's
  browser/deployment limits and C5's changed-value coverage remain separate.

#### Review access

- [x] **Restore the local review after the server stopped.** Restart the HTTP
  server independently of the command session and reload the existing in-app
  page. Keep all 36 new analyses and the separate older archive accessible.
  This fixes the refused connection, not the unresolved record or drawing issues
  above. A temporary local review is not a production hosting solution.
- [x] **Use hosted Orchard sources independently of the local server.** The
  public Orchard already serves its source images through GitHub Pages: all 59
  unique referenced image URLs returned HTTP 200, and its bundle contains no
  localhost links. Replace the two local Chrome Orchard tabs and the broken
  Norris image tab with their public equivalents. No public deployment change
  was needed; the failed URL belonged to the stopped local server on port 8441.

The known repaired regressions remain covered: atomic movement branches, stable
stage coordinates, category/terminal casing, Case and feature ownership, shared
plaques, connector timing, PF plaque continuity, pointer-induced blue outlines,
analysis selection and first-frame reset. Reopen one only on concrete evidence.
The reported two-root controls overlap was not reproduced and is withdrawn.
Small fitted labels alone are not proof of missing syntax. The R3 authored-stage
capture must not be presented as an unresolved normal-Replay collision.

The September 26 generations are complete: 28 requests through GPT-6 Sol with
Codex OAuth produced 36 analyses. Four initial confirmation requests returned
HTTP 429 without model output; their receipts were preserved and only those
transport failures were resubmitted. No model output was regenerated. All calls
used the same frozen prompt and contract. None of the 189 authored relations is
a judgment-named relation or an exact unchanged duplicate; normalization did not
rewrite the expanded authored records that it accepted.

The independent checks did **not** qualify the candidate. The first 20 requests
produced five contract-failing analyses across four requests, plus recognizer
misses and unsupported drawings. After repairs and a second renderer freeze,
eight confirmation requests produced eleven analyses, including one further
contract failure and additional recognition misses. Repairs based on either
batch are diagnostic adaptation, not a passing holdout result. The six flagged
analyses comprise surface-order conflicts in German, Turkish
and both Greek alternatives, duplicated Hindi workspace identities, and a
pronounced lower copy in the English embedded question. The register above
separates demonstrated record contradictions from the ordering cases that need
representation review. All original outputs remain reviewable.

On the adapted renderer, the 189 relations comprise 144 fully drawn records,
28 with a drawing plus neutral content, 14 wholly neutral records, and three
Hindi relation records whose full timeline cannot be dispatched. Every remaining neutral
or partial record has an evidence-based disposition. Thirteen wholly neutral
claims lack a matching designed drawing; one additive association leaves its
associate ambiguous. These are record counts, not linguistic-quality scores.
Isolated later Hindi stages still recover binding and agreement without
pretending the earlier duplicate identities are resolved.

All 114 public drawing examples, spanning 55 recipes in both frameworks, pass
production-painter checks. The full offline gate passes 2,300 tests, typecheck
and parse-contract verification. Positive drawing fixtures do not cover every
outcome variant. Shipping still requires closure of the current problem register,
including
faithful handling of record inconsistencies, inspection limitations, remaining
visual defects and independent qualification. Model perfection is not required;
original mistakes must remain inspectable without being silently repaired. No 80%
population-quality claim is established by these purposive cases.

The milestone is ready when these items are closed with no known blocking
renderer/contract defect and the user has reviewed the remaining visual choices.
Recipe reachability, a green test suite, or a successful prompt rerun alone cannot
close it. The broader application launch still needs the later deployment,
provider, storage and product work described below.

The previous corpus contained 59 analyses and 806 authored relations. Its
16 observed Tier-2 recipes did not establish renderer completeness. The current
inventory contains 55 recipes and 69 drawing pieces. Recipe reachability and
recognition of independently authored claims are separate checks; neither a
high Tier-1 count nor eliminating every neutral relation is a release target.

The September 22 qualification review combines those saved records with 19
Codex-OAuth requests made under the then-current prompt contract. It exposes all
82 analyses in one chooser, paused at Replay frame one. Across 1,076 authored
relations and 3,502 Replay frames, the audit found no missing or duplicated
relation moments. Public-record tests reach all 54 declared recipe families through normalization,
Replay and bound geometry; the current production atlas separately checks painting; 19 Tier-2 recipe families
occur naturally in these records. The audit recorded another 269 wholly neutral relations under its then-current
rules. That historical count does not prove each fallback was necessary. Recheck
those records against current recognition and the complete authored evidence.
Neutral presentation does not judge their linguistic interpretation.
The last untouched Tamil and Polish records needed no renderer adaptation.
Human visual and linguistic review of the complete chooser remains a release
decision; passing structural checks does not certify either.

A preselected September 25 holdout used four GPT-6 Sol requests through Codex
OAuth, producing eight analyses with 31 stages, 49 authored relations and 290
Replay frames. All requests completed and all 49 relations retained one moment.
Before the closeout recognition repair, nine relations drew completely; six
more earned a Tier-2 drawing with neutral context, and 34 were wholly neutral.
No Tier-1 relation occurred. Qualified occurrence roles now recover
the previously missed head and wh paths through exact lineage and prior
position. An anchored T/I/Infl head and subject also recover authored finite
agreement features. Neither change declares relation names as identities. The
holdout therefore found a real coverage gap, not a release pass. The audit of
focus, argument-role, grouped Case and inflection claims produced the repairs
recorded above. Remaining fallback dispositions and wider recognition coverage
are still open. Browser inspection at
1600 × 900 confirmed
that the saved two-root analysis displays its detached D and finite IP as
separate Canopy roots, and that its speech-repair claim appears as a neutral
relation moment in a diagnostic Replay. The original request's failure receipt
is preserved. Reprocessing the same saved output with the current parser accepts
both roots and retains all six relations across 26 Replay frames; its acceptance
is no longer blocked by the single-root rule. The earlier diagnostic capture
alone did not qualify the normal application
workflow. The subsequent closeout browser check covers the normal application
and save/reopen. The earlier controls-overlap claim was not reproduced and is
withdrawn. Small labels at full-stage Fit remain an overview-readability
observation, with manual zoom verified; they are not evidence of missing syntax.
The short English
nominal fragment was incorrectly listed as a parse defect; it is a legitimate
reading with a small tree. The German holdout exposed a separate Replay
visibility defect. Its authored fourth stage has binary TP → DP + T′ and
T′ → T + vP, but the old Replay hid T′ and the silent T head in frames 26–29.
The current scheduler preserves TP → T + vP at the V-to-T moment, then reveals
DP + T′ together at subject movement. The updated review shows the authored
branches through frames 26–29. In the English wh holdout, the model authored
T-to-C movement with C and TP in separate workspaces, then repeated that claim
after attaching C to TP. The cross-workspace crest now yields to the head path
at the later relation moment instead of remaining as a second curve. The model
restates the same T-to-C relation again in the final stage; Replay retains that
authored moment and shares its existing path. These repairs do not certify the
linguistic analyses or complete visual sign-off.

The relation field now asks for relations introduced or changed in the current
stage. A matched check changed only that prompt line and used two GPT-6 Sol
Codex-OAuth requests at high effort. The new outputs contain three analyses and
13 relations with no repeated unchanged claim records. The wh example records
T-to-C once instead of three times; the Omar example has no repeated claims,
compared with ten repeated entries in its earlier output. Omar now has two
analyses rather than four, so this is a small diagnostic result, not a controlled
estimate of reliability. Neither new output contains a same-anchor value update;
retention of such updates remains untested in fresh output. Existing saved
analyses and the parser's acceptance behavior are unchanged. Exact request
bodies, prompt hashes, raw outputs and the before/after Replay review are saved
under `relation-timing-20260925` in the qualification evidence directory.

Of the 34 neutral moments, 29 come from four readings of “Only Omar gave the red
book to Lina”: six focus restrictions, six verbal argument inventories, six
paired structural-Case claims, six past-inflection claims, four PP-modification
claims and one goal-role claim. Those categories recur across stages and must
be assessed as distinct authored moments, not 29 distinct drawing designs.
The other five are in “These child laughs.”: three failed nominal agreements,
one positive nominal agreement and one Case claim without a Case value. These records have now been inspected and reprocessed; the closeout checklist
records the recoveries and the specific reasons for retained neutral moments.
The September 25 closeout uses only saved outputs: 15 analyses, 84 authored
relations and 501 Replay frames. Every relation keeps one moment, with no
provider request. The current offline gate passes typecheck, 2,044 tests and
both parse-contract fixtures. Additional browser checks pass the normal app's
save/reopen workflow, exact review links, analysis reset, Next, zoom and Fit.
Evidence is under `closeout-20260925`; the review is served alongside the earlier
holdout under `closeout-current/review.html`. These checks do not replace the
final bundled-runtime performance and release-asset qualification below.

The earlier final 1600px bundled-runtime sweep rendered all 3,502 frames with no
invalid SVG paths or browser errors. Replay frame changes had a 12.3ms 95th
percentile; the slowest analysis opened in 1.86 seconds. The focused French
transition that had paused for about 740ms after a late font load now takes
about 8ms after preloading the renderer-generated glyph subset.

Of the 82 analyses, 58 end with a relation named for judgment, grammaticality,
or convergence: 9 of the 23 fresh analyses and 49 of the 59 older ones. The
September 23 prompt revision removes explicit verdict and illicit-input
instructions. The contract still requires exact input coverage and keeps
relation names open. All 82 analyses predate that revision, so they cannot
show whether it reduces unprompted verdicts.

Preserve these decisions:

- Relations and anchor names remain open. Drawing classifications are derived.
- A shared constituent can appear once in the tree while an explicit relation
  names additional parents or predicate domains. Do not repeat an occurrence ID
  in the tree, or infer sharing merely from matching lineage.
- An explicit many-source movement with one landing is one relation moment.
  Match each source to its own preceding occurrence; never pair arrays by order.
- A compound plaque appears before its collector draws, within its existing
  relation moment. Reduced-motion presentation is immediate. Persistent
  collectors do not replay their reveal when another owner restates a claim.
- Identity lights use one shared source and light each participating terminal
  once. Chain ownership remains distinct. A static scene schedules no repeated
  canvas painting.
- Load the renderer's own heading and chain-index font subsets before Replay
  appears; a font arriving during fast scrubbing must not trigger a second
  layout pass at a stage boundary.
- Qualification review opens each newly selected analysis paused at frame one.
  Its Play control starts playback explicitly.
- Binding domains retain their entire authored scope. Reserve enough room to
  contain their accepted ellipse; do not narrow its linguistic domain to fit.
- When several relations cover the same realization change without a unique
  owner, show that change at the Stage Record and retain the diagnostic.
- New OpenAI qualification uses GPT-6 Astra through `qualification:codex` with
  Codex OAuth. No API-key substitution or paid fallback is authorized.

Qualification evidence stays outside the repository under
`/Users/francisronge/.codex/visualizations/2026/09/12/01a0971f-0986-7370-904b-e4a1c4693d82`.
Earlier receipts preserve all actual transports, including ten mistaken paid-API
attempts from the September 22 initial batch, eight completed and two failed.
The subsequent requests use the dedicated OAuth harness. Do not relabel or
replace those earlier records.

The earlier bundled-runtime checks covered 2,360 frames, recorded-response
failure/retry, Canopy/Replay switching and analysis switching. Dense Replay
opened in 1.81–1.84 seconds with frame changes around 31ms at the 95th percentile.
The 96-stage synthetic stress input still took 2.1–2.2 seconds to compile before
layout. Recheck affected paths after this pass; deployed loading and slow devices
remain separate qualification work.

## Earlier app workflow evidence

The local workflow is checked with saved fixture replies through the real input,
request handler, Canopy, Replay, analysis selection, Tree Bank, reload/reopen and
bracket export. Desktop and 390px browser tests also cover failed-request recovery
and real IndexedDB transactions aborted after request success. No provider call
or user library was used in this pass.

Tree Bank now waits for transaction commit before reporting save/delete success.
A failed save stays absent, a failed delete stays present, and retry works.
Save errors are visible in the workspace. Saved framework metadata belongs to
the completed analysis, not the controls for the next request. The current
IndexedDB schema and saved-bundle format are unchanged.

Later app work, after the pipeline work above:

1. Verify compact-screen readability in the full app. The 390px workflow capture
   leaves the early Replay tree extremely small when the header, input and Replay
   panel are all open. Passing control interactions does not qualify this layout.
2. Finish Program 1's outstanding live/deployed and slow-device evidence under
   agreed provider conditions. Replayed fixture responses do not qualify live
   provider transport or establish linguistic accuracy.
3. Complete Program 2's durable records, backup/export and recovery work. The
   transaction repair does not add imports, migrations, integrity checks or
   saved Replay-position restoration.
4. Build Program 3's shared public/research application boundary. The current
   frontend still presents one workbench with model controls and Notes.
5. Complete the launch decisions and operational checks in Program 5. A local
   workflow pass does not establish deployment, cost limits or recovery readiness.

## Earlier multilingual qualification

Twenty matched Babel-only subscription requests on `300d2eb` completed: English
negation and raising/control, Japanese, Turkish and Arabic, each with Astra/Sol
and both frameworks at high effort. All returned strict JSON without repair,
with matching receipt hashes. The set contains 95 stages, 302 relations and 846
Replay frames. Median request times were 113 seconds for Astra and 225 for Sol.
No retry or paid API fallback was used. Records and all frame contact sheets were
reviewed; selected failures received full-size checks, with an Arabic mobile
check and Japanese zoom/Fit. This is not linguistic certification or exhaustive
animation/hover qualification. Evidence remains in
`/tmp/babel-multilingual-20260919` and the visual review in
`/tmp/babel-sept17-review/universal-check`.

The existing realizations contract accommodates Japanese inflection, Turkish
stem-plus-suffix realization and Arabic article-plus-noun realization. No new
contract field is justified by this batch.

The five authorized follow-ups are now implemented or investigated:

- Replay keeps an exact replacement witness in the structural change even when
  drawing dispatch consumes its anchor. Astra Japanese X-bar's `verbTrace` now
  appears with the movement at frame 29 and survives the following claims.
  A later chain restatement cannot take ownership of the same transition.
- Movement recovery distinguishes the moved occurrence, its host and the
  resulting complex through lineage and tree structure. Direction plus an
  occurrence type supplies a candidate role across heads, phrases and complexes;
  it does not prove movement by itself. Conflicting endpoints still refuse a
  trajectory. Atomic PRO landings can use their authored projection context.
  Independent hosts remain available before movement: Sol English X-bar's `has`
  now appears before auxiliary selection, and Astra Arabic Minimalism's T before
  agreement. The moving source retains its preceding authored state.
- Long category labels wrap without changing their characters or font size.
  Measured multiline bounds inform plaque clearance and Fit. Wrapped labels
  occlude native branches without changing their curve or endpoints. This
  corrects the flattened I′ branch introduced by moving its endpoint above a
  tall label. Short labels retain their previous camera bounds and branch paths. This fixes
  the reported Arabic clipping and overlap without stretching the tree.
- Construction-stage casing uses the authored determiner context and resolved
  phrasal movement, rather than the operation title. The reported `No`/`no`
  flicker is gone; proper names keep their existing treatment.
- Realization timing was investigated without changing the contract. Astra
  Japanese X-bar has four anchor-based candidates for one new realization
  association: two formation/mapping descriptions, a chain claim and a Case
  preservation claim. References alone cannot select a unique owner. Replay
  therefore keeps its existing Stage Record activation and ambiguity diagnostic.
  A focused regression protects that choice and preserves the authored records.

Verification covers 27 saved analyses, 133 stages and all 417 authored relations
in order, with no mutation of their source records. The complete offline gate
passes 1,745 tests plus typecheck and both parse fixtures. Desktop comparisons,
mobile wrapping, forward movement, zoom/Fit and seven older saved analyses were
checked in the browser. Review evidence remains outside the repository in
`/tmp/babel-sept17-review/five-repairs`.

The subsequent recognition/input pass recovers 21 previously missed relation
occurrences in these saved records: 15 thematic assignments and six Case
dependencies. Registry version 16 interprets explicit thematic source/argument
qualifications and licensed phrase recipients through the shared binder. An
`introducer` needs thematic evidence without a competing feature interpretation.
The drawings retain exact participants and authored literals. Multiple sources,
unclear chain-to-role associations, unpaired values and unknown role meanings
remain neutral. An attracting head in phrasal movement is contextual evidence,
not a missing trajectory: the path is recovered and that head keeps its Tier-3
annotation. The older Sol raising/control future-anchor conflict remains
diagnosed without reordering its claims. New runs remain paused.

Replay text comparison now preserves combining marks and normalizes canonical
Unicode spellings, avoiding false matches such as `मैं` with `म` or `أحبّ` with
`أحب`. Parser comparisons explicitly use Unicode default casing. Initial-letter
case changes share one complete-code-point helper across Replay and rendering,
so supplementary-plane letters are handled without splitting surrogate pairs.
These changes do not identify a language or prescribe its casing conventions.

Input-token preservation is implemented. New requests capture `inputTokens`
once and carry the exact list through normalization, Replay preparation,
qualification review and browser-local saving. The `unicode-word-v2` tokenizer
removes the English-specific apostrophe-s split, including its mistaken split
of contractions. The prompt-template fingerprint includes the tokenizer version.
Older saved bundles without this metadata retain the legacy boundary rule and
are not rewritten on load. Their original ICU segmentation cannot be recovered
with certainty because those records never stored the token list.

Sol Japanese X-bar explicitly calls `ん` a nasal-onbin component and represents
it as `M` within a complex V, with every supplied token attached to a terminal.
Astra, given the same split, explicitly keeps `読ん` as one stem associated with
two token positions. The split may have influenced Sol, but these records cannot
establish causation or justify rewriting its analysis. Token positions remain
input addresses, not prescribed syntactic or morphological units. The later
approved RTL implementation below changes presentation coordinates while keeping
authored child order and token positions intact.

This follow-up passes 1,751 tests, typecheck and both parse-contract fixtures.
All 27 saved analyses retain 133 stages, 417 authored relations and 1,230 Replay
frames. Targeted Arabic/Japanese before-and-after captures, forward Replay,
zoom/Fit, a mobile view and the Turkish movement-context control passed with no
browser errors. Evidence remains in `/tmp/babel-sept17-review/universal-followup`
and `/tmp/babel-universal-followup`; no new provider request was made.

The September 20 authorized follow-up also checked the current application using
mocked saved responses: analysis switching, Canopy/Replay, keyboard stepping,
save/reload/reopen, bracket-notation export and failed-request recovery. The
submit button now has an accessible name and the collapsed input panel is a
keyboard-operable button. This is existing-flow verification, not a Tree Bank
upgrade or application redesign.

Three long-label/dense-relation cases were checked at desktop and 390px widths.
The inspected frames have no clipped labels or non-finite paths; whole-tree Fit
still requires zoom for readable text on dense mobile trees. On this machine,
64-stage synthetic preparation took 0.58–1.21 seconds. The saved Astra raising
view became ready in 396ms with 4× browser CPU throttling; the longest observed
50ms main-thread heartbeat gap was 91ms. These are local observations, not a
cross-device performance guarantee. No layout or camera policy changed.

Targeted linguistic research distinguishes under-justified analysis from
renderer defects. [NINJAL's conjugation table, printed page 39](https://repository.ninjal.ac.jp/record/1862/files/kk_nkss_022.pdf)
lists `yom-/yon-` as stem forms. [Youngberg, page 31](https://repository.essex.ac.uk/31336/1/glossa-5443-youngberg.pdf#page=31)
discusses competing analyses of onbin stems; neither source establishes Sol's
separate M head for `ん`. Preserve that authored choice rather than silently
correcting it. [MIT's movement notes](https://ocw.mit.edu/courses/24-951-introduction-to-syntax-fall-2003/1e3a1d0873ad7a05f32451088daa9c6e_ln5a_movement.pdf)
support distinguishing thematic from Case positions in chains. The saved X-bar
English `thetaPosition` names a nominal recipient, while the Turkish one names
a verbal source position. Chain membership and matching role strings therefore
cannot alone determine assignment endpoints. The subsequent continuity rule below
also requires earlier established assignments and exact structural evidence.

A temporary RTL Canopy comparison established the subsequently approved direction
rule, preserving labels, authored child identities and every connection.
The six-item review, sources and captures are in
`/tmp/babel-sept17-review/next-checks`; scripts and verification evidence are in
`/tmp/babel-authorized-six`. No provider calls were made. The offline gate passes
1,756 tests, typecheck and both parse fixtures. All 27 saved analyses retain the
same displayed syntax and ordering across 1,230 frames. Tree Bank upgrades,
public/research redesign, migrations, hosting and corpus/benchmark work remain
out of this pass.

### Approved direction and assignment follow-up

Production Canopy, Replay and inspection views use the browser's Unicode
first-strong direction for the input sentence. RTL reflects the shared horizontal
tree coordinates before relations, plaque reservation and Fit are computed. It
does not reverse stored children, token addresses, glyphs or syntactic dependencies.
There is no language allowlist. Native Arabic, Hebrew, Japanese and mixed-script
direction checks, desktop/mobile views and zoom/Fit cover this presentation change.

Registry version 17 recovers 15 additional assignment claims across 12 of the
saved relations by following earlier explicit assignments through proven movement
and stable occurrence positions. One further Case claim uses the general
`licensed <category>` recipient rule. The chain rule does not interpret
`thetaPosition` as a fixed linguistic role: the English nominal recipient and the
Turkish verbal source are established from their own earlier claims. Compound
claims keep one simultaneous relation moment and separate exact drawing owners.
An unchanged restatement reuses an earlier grid when its content and lifetime
agree, including across tiers. A grid's predicate label no longer chooses an
arbitrary word from a branching VP.

All 417 authored relations in 27 saved analyses were inventoried, including their
remaining unconsumed fields. Residual prose, contextual anchors, clause typing,
scope and morphological claims are not automatically renderer failures. Remaining
dispatch gaps include multiple sources/recipients and Case descriptions whose
bearer the current reader does not establish. The existing prompt already tells
models to give paired entries the same length and order. First assess which
compound records that convention resolves; equal lengths alone do not identify
every possible pairing. Optional grouping within a relation is only a possible
follow-up if a concrete association cannot be expressed by the existing contract.
This audit does not establish that a new field is needed. Discuss any proposed
contract change before implementing it; do not rewrite a model's analysis.

Input-token regressions cover possessives, contractions, Turkish suffixes, Arabic
articles, Japanese multi-token stems and mixed scripts through normalization,
Replay and saved-record reopening. All 27 saved analyses retain identical displayed
syntax and relation order across 1,230 frames. The direct before/after review and
RTL movement recording remain outside the worktree at
`/tmp/babel-sept17-review/direction-evidence`; verification scripts and the complete
fallback inventory are in `/tmp/babel-direction-evidence`. No new generation,
provider, prompt or storage changes were made.
The final offline gate passes 1,766 tests, typecheck and both parse fixtures.

### Current recognition and Replay follow-through

- Registry 18 reads structurally corroborated paired compound assignments through
  the existing contract, including independent drawing ownership within one relation
  moment. Case nominals and explicit agreement-controller/finite-head pairs use
  shared evidence rules. Distinct scalar feature dimensions retain their values;
  conflicting bundles remain unresolved. No new grouping field or prompt vocabulary
  was added. Exact malformed primary claims still cannot be repaired as Tier 2.
- The approved realization timing policy is protected: a unique established owner
  activates the change; ambiguous ownership waits for the completed Stage Record.
  Relation wording or array order cannot choose the winner.
- Plaques reserve their largest content size and a clear anchor-relative pocket
  across their visible lifetime before appearing. They retain that offset through
  later branches and stage changes. The shared tree layout is unchanged. Dense
  future geometry can require a more distant initial pocket; stability is not a
  guarantee of short connectors.
- Browser verification reproduced lost quiet/active styling after a renderer
  redraw without a relation change. Newly mounted marks now receive the same
  current emphasis after drawing. A focused browser regression checks resizing
  and hover without path, stroke-width, opacity or bounding-box changes.
- Prompt review found no instruction requiring Sol's separate Japanese nasal
  component, unary projections or a particular assignment analysis. Sol explicitly
  calls the component morphological, not an independent argument-taking head.
  The existing realization groups permit Astra's alternative single-stem analysis.
  The old input segmentation could influence the choice, but the saved comparison
  does not prove causation. No prompt change or new generation was made.
- Overlapping theta inventories now share one grid per exact predicate when their
  role assignments agree. Each row retains its authored relation references and
  appears only after its own moment. Earlier Theme hover does not highlight a later
  Agent. Prior-state claims, conflicting roles, repeated recipients and changed
  predicate lineage remain separate. The grid reserves room for later rows and
  keeps its placement identity as it grows.
- Registry 19 accepts complete multiple-predicate theta assignments through the
  same structural pairing check used for open relation names. Sol's saved negation
  relation now draws both assignments under its unchanged registered name. Missing,
  ambiguous or contradictory pairings still fail the registered signature; Tier 2
  does not bypass that check. Shared evidence normalization has one implementation.


Verification and direct comparisons are in `/tmp/babel-current-six-20260920` and
`/tmp/babel-sept17-review/current-six`. The saved-record audit covers 27 analyses,
133 stages and 417 relations; their 1,230 Replay frames retain the same displayed
syntax and relation order. The placement pass covers desktop and 390px layouts;
targeted browser checks cover actual movement, Case/role drawings, zoom, Fit and
shared quiet/hover treatment. This is bounded evidence, not certification of every
possible model analysis. All temporary research and review material remains outside
the worktree.
The offline gate passes 1,772 tests, typecheck and both parse-contract fixtures.
The separate browser redraw/hover regression also passes; run it with
`node --test tests/browser/relationEmphasis.test.mjs`.

Pause new generation while these defects are repaired. Reuse the saved records
for regressions and show only one or two directly relevant comparisons for each
change. Subsequent generation should answer a specific unresolved question in a
small batch; the user does not need to review all twenty analyses before repairs.

The subsequent human frame review found further reproducible defects. Pending
head adjunction now retains the old host branch, and movement attaches the host
without advancing its later pronunciation. This repairs Astra Arabic frame 17
and Turkish frame 25. Invisible reservations no longer cut neutral connectors.
Complex Case assigners use their category rather than the gap between words;
plaque placement also checks the curved approach throughout the claim's lifetime.
Movement paths pass behind visible text, and unchanged chain restatements share
their path after embedding. An explicitly authored unary IP remains visible but
is not pulled sideways by its future landing.

Verification retains all 27 source analyses, 133 stages, 417 relation moments and
1,230 Replay frames. The desktop/mobile layout audit found no plaque collisions
or changed attachment offsets; reported transitions, zoom, Fit and hover received
browser checks. The offline gate passes 1,788 tests, typecheck and both fixtures;
the two browser regressions pass. Before/after images and recordings are in the
temporary review at `/tmp/babel-sept17-review/frame-repairs`.

A later review found two remaining binding curves in the final Astra relative
clause. A scoped binding and its unscoped restatement now share one curve and its
indices. The domain retains its own timing and emphasis; the current claim owns
hover on the shared curve. Focused regressions cover both claim orders and keep
different scopes, indices, occurrence lineages and prior-state claims separate.
The exact before/after preserves tree positions and all movement paths. Replay,
mobile, zoom and Fit pass, alongside the 1,791-test offline gate.

The follow-up checks all 27 saved analyses for duplicate Case, agreement, theta
and domain drawings. Shared role reading recovers 14 additional claims: seven
agreement claims, five control claims and two Case assignments. A registered
Agree restatement now shares its existing plaque despite equivalent recipient
wording; both Replay moments retain ownership. Different targets and histories
remain separate. In two saved X-bar analyses, similar theta grids name the moved
phrase and its lower occurrence respectively; those are not exact duplicates.

All 1,230 Replay frames retain their syntax and relation order. The 14 changed
relation frames preserve tree coordinates; desktop, 390px, following-frame,
hover, zoom and Fit checks pass. The agreement-sharing browser regression also
checks reveal timing and quiet hover. Before/after captures and short recordings
are under `/tmp/babel-sept17-review/drawing-audit`. No new parses were generated.
The final gate passes 1,797 tests, typecheck and both fixtures; both emphasis
browser regressions pass.

## Earlier baseline

The preceding varied subscription batch made eight Babel-only OAuth requests on
`707af42`, covering coordination, relatives, negation and raising/control in both
frameworks with Sol/Astra at high effort. Seven completed in 93–183 seconds:
38 stages, 115 relation occurrences and 374 Replay frames. All seven outputs
parse as strict JSON, require no repair and match their saved receipt hashes.
Sol's relative X-bar stream ended before any analysis text or completion event;
its cause is unproven. No retry or API-key fallback was made. The remaining
three unstarted jobs then ran once. Exact requests, contract fingerprints,
streams and receipts are in `/tmp/babel-varied-batch-20260917`.

The first pass inspected the records and captured all 374 desktop frames, but
its visual review missed defects later identified by Francis. The established-
movement-restatement repair remains retained. The September 19 follow-up fixes
future scaffolds detaching existing children, binds relation geometry to the
currently displayed syntax, excludes hidden future leaves from sentence-initial
casing, and retains an explicitly referenced prior landing witness until the
movement replaces it. No authored tree, relation or pronunciation is rewritten.

Ordinary multiline plaques now search local pockets instead of being sent below
the tree by a 170-unit height cutoff. Transparent hulls do not exclude plaques.
Tier-3 counter-lane stems clear intervening labels; nearly vertical dotted Agree
collections no longer use sideways handles that produce an S-loop. Same-scale
forward Replay steps retain the current camera when the new bounds already fit.
Fit remains explicit and manual camera positions survive forward steps.

The subsequent selection review found a remaining layout mismatch: a stage could
adopt a large future scaffold only after movement, stretching its earlier, smaller
canvases to that scaffold's dimensions. Construction stages now use future context
only when it also preserves their pre-movement structure. The scalar Tier-3
connector's turn now follows its own participant bottoms, not the whole tree's
deepest label; local plaque clearance remains enforced. The short curved Case
arrow is unchanged.

The value/casing follow-up now recognizes explicit `agreement`, `phiFeatures`
and `valuedCase` fields through the shared value vocabulary. A dependency with
both Case and feature values retains its recipient-specific Case drawing and
displays the other rows in the existing source feature plaque. Previously the
lowerer could consume both value sets but only draw Case. `governor` also works
with an independently recognized recipient and explicit Case; government alone
does not establish that meaning. Atomic D names/pronouns retain authored capitals,
including Mia with tokenIndex 0. A D with a nominal complement still permits
sentence-position casing of determiners. A bare D/Which cannot be distinguished
from D/Mia using the current evidence, so its authored spelling is preserved.

Untitled plaques now use ordinary top padding instead of reserving a missing
heading row. Empty and whitespace-only titles behave like absent titles; titled
plaques retain their geometry. The actual agreement plaque, a titled T-probe,
mobile size and zoom were checked in the production renderer.

Verification: 1,736 tests, typecheck and both contract fixtures pass. All 374 new
frames were checked in the browser for render completion, console errors and
non-finite SVG geometry. The reported transitions, an older Sol morphology
example, desktop/mobile layouts, manual zoom and Fit were visually inspected.
Across 27 analyses / 1,183 frames, claim ownership and authored relation order
remain unchanged. Matched screenshots, a camera recording and live Replay are
in `/tmp/babel-sept17-review/varied-repairs`; evidence is not committed.
The later layout/connector comparisons are in `/tmp/babel-sept17-review/layout-correction`.
That follow-up also preserves the exact visible syntax, drawing plans and relation
order across all 27 saved analyses. Focused desktop/mobile and zoom checks cover
the reported selection sequence and connector, with the older inflection case
checked after its layout changed. These are targeted checks, not a new linguistic
qualification of the batch.

The value/casing comparison preserves syntax connections, every frame and authored
relation order across all 27 analyses / 1,183 frames. Eight relation occurrences
gain recognized values or Case drawing; the only word changes are mia to Mia in
the two affected analyses. The substantive compound review distinguishes coherent
linguistic claims from incomplete machine-readable associations. Equal-length
arrays or similarly prefixed names alone do not distinguish paired assignments
from collective groups. Separate relations can express explicit pairs, but give
them separate Replay moments; they do not preserve a simultaneous compound claim.
Keep genuinely ambiguous groups neutral rather than splitting or rewriting them.
Sol's passive record repeats the identical assigning occurrence twice, which is
not ambiguous. Its failure exposes contextual source binding, raw-array arity
and native literal-reading gaps. A controlled scalar-source version also prints
"Assignments" twice instead of the supplied Theme/Goal values unless the paired
field is named `arguments`. These handoffs are now repaired in registry version
15 and the existing theta-grid reader. The registered predicate slot accepts an
assigner and counts exact distinct IDs; authored arrays remain unchanged. Open
same-name/same-length fields supply their literal labels, including repetitions.
Different sources, different occurrences sharing lineage, mismatched label lists
and competing normalized value keys retain their failure boundaries. The new
controls also preserve role-key labels alongside explicit argument labels.
Across 27 saved analyses and 1,183 frames, only two passive relation occurrences
change classification, from Tier 3 to the native theta grid. Syntax, frame counts
and authored relation order are unchanged. Desktop/mobile, zoom, the second
occurrence and next-relation persistence were checked in production Replay.
Evidence is in `/tmp/babel-sept17-review/theta-reader`, outside the worktree.
The targeted desktop/mobile, movement and zoom comparisons are in
`/tmp/babel-sept17-review/value-casing-review`, alongside the earlier evidence.

Remaining boundaries: the Astra relative-clause Case plaque changes pockets at
14→15 because its carried box would overlap the new v label and adjacent branches.
Stage reservation triggers that change before the new syntax appears. Keeping
the box fixed would create a collision; changing reservation timing is a separate
design choice, not a verified allocator fix. Quiet movement uses the Orchard's
single 0.3 opacity multiplier and 2.1-unit stroke, with no double fading. Small
fitted trees can make that stroke subpixel. No rejected thickness restyle is
retained. These checks do not certify every arrangement. The old interrupted
Sol stream's exact cause cannot be recovered because its error handler discarded
the exception. Future subscription failures record the operation and standard
error codes without logging credentials or making an automatic retry.
Its saved stream has complete metadata events but no analysis, error or completion
receipt. The runner had no fixed generation timer; no new retry was made.

Recognition remains bounded. Ordered multi-source/recipient arrays expose both
plural/qualified-role coverage gaps and recipes restricted to one source. Reopen
shared decomposition only with demonstrated association evidence and negative
controls; prefix matching is unsafe for chain heads versus lower positions.
Some attracting-head context on atomic nominal movement also stays neutral even
when the movement path is recovered. No separate model interpreter is planned.
Sol negation frame 32 and raising X-bar frame 62 reference higher occurrences
introduced by the following movement. Their prose and selected analyses are
coherent: lower-subject agreement precedes raising, and the absence of an external
theta role for seem holds before raising. The exact occurrence anchors conflict
with that order. The prompt requires completed-stage anchors and derivational
ordering but does not explicitly distinguish availability at the relation moment.
The approved generic clarification is now in the shared prompt: anchor each
relation to the exact occurrences involved when it is established, including
occurrences established by that relation; do not substitute a different occurrence
introduced only by a later relation merely because it shares lineage. Saved
records and diagnostics are preserved. Generation provenance already hashes the
exact framework-specific system instruction; new runs receive the revised hash.
The fresh matched batch above now exercises that clarification. Its remaining
timing conflicts require Replay ownership investigation; they do not reproduce
the earlier substitution of a later subject occurrence for a current one.
The linguistic distinction is consistent with Richards's MIT notes on
[Agree and movement](https://web.mit.edu/norvin/www/24.956/handout2.pdf) and
[raising/control](https://web.mit.edu/norvin/www/24.902/control.html).
This batch does not certify the linguistic
analyses, the API route or deployed hosting. Earlier baseline counts below record
their respective checks; the current retained-code gate is the one above.

Subscription testing: `npm run qualification:codex` uses the existing Babel
prompts, normalization and Replay with no agent instructions or tools, no
API-key fallback and no automatic retries. Sol's subscription smoke response
completed in 126 seconds with valid JSON, no repairs and 26 Replay frames. Its
stream was reprocessed offline after fixing completion events that omit output
already delivered in message events; no repeat generation was needed. The
provider echoed the exact Babel instruction and an empty tools list. Astra then
completed the same X-bar sentence in 37 seconds with valid JSON, no repairs and
18 Replay frames, using the corrected runner end to end. Both are inspectable
through the existing review UI. Both examples are X-bar. Review of their 17
relations and all 44 Replay frames found a theta-grid text collision and one
Case-recognition miss. The grid now measures its predicate and role columns,
reuses that layout for placement and painting, and wraps long literals without
dropping content. Short grids retain their geometry. The original Sol grid's
overlap is cleared with unchanged syntax and fitted camera; multi-column,
wrapped-text, zoom and narrow-viewport controls are checked. The full offline
gate passes 1,707 tests.

The `licenser` miss is repaired through shared licensing source/recipient
wording. The same equivalents now reach registered binding, contextual
probe/goal candidates, typed Case/feature and theta assignment, and polarity
licensing. Untyped licensing does not establish Agree; ambiguous sources,
unpaired literals and unsupported meaning remain neutral. Fable 5.1's read-only
review found no blocking issue. Its two coverage notes are pinned in regression
checks: unqualified licensing direction with typed theta evidence, and preservation
of unresolved theta content beside an independently supported Case drawing.
This remains bounded exact interpretation, not arbitrary-language understanding.
The original Astra Case relation changes from Tier 3 to the existing Tier-2 Case
drawing. Its Replay steps, syntax and fitted camera are unchanged in the browser.
The two short runs alone do not qualify the paid API route or broader derivations.
Their chosen older GB subject analysis is not a demonstrated missing-movement
defect. Sol's 16→17
camera refit accommodates the new IP parent; existing node coordinates remain
unchanged, so no layout repair is warranted by that transition.

The subsequent subscription batch contains eight analyses: four sentences
covering wh-movement, passive, embedding/reflexive binding and past-tense
morphology, each in Minimalism and X-bar, split between Sol and Astra at high
effort. All eight completed in 77–283 seconds with valid raw JSON and no repair.
Exact requests, contract fingerprints, response streams, outputs and receipts
remain outside the worktree in `/tmp/babel-recognition-batch-20260917`; all raw
output hashes match their receipts. The production review navigated and captured
all 390 frames, inspected their contact sheets and checked representative and
problematic frames at full size. No browser console errors were recorded. The
recognition patch leaves all 811 compared Replay steps unchanged across twenty
saved analyses; its only changed claim classification is the earlier Astra Case
example. This is bounded desktop checking, not universal visual approval.
The initial review missed Sol Minimalism movement frames 42→43: the movement frame
introduces the moved head and its local C host, but the C′ joining that host to
TP appears in a later ExternalMerge micro-step. The landing-host walk stops at
the previously selected free C head rather than reaching the source-containing
clause. This is now repaired: the necessary new path joins the source workspace
in the movement moment; unrelated higher projections keep their own steps. The
example now has 53 frames instead of 54. Frame capture alone had not established
correct transition timing.

The batch exposed repeated Tier-2 claims accumulating identical plaques and
overlapping binding-domain shading. The repair separates full occurrence identity
from persistent output identity. Current-state claims without transition rules
or prior references coalesce across stage/workspace growth; exact occurrence IDs,
lineages, values, outcomes and output pieces remain identity evidence. Every
Replay moment and contributing reference survives. Different supersession times
remain separate, and Case composition uses all preserved authored stages. A
later feature bundle is not revealed early through a carried Case mark.
The reported movement frame contains five copies of its Theme grid and four of
its Agent grid; the final embedding frame overlays six copies of one binding
domain. These now paint as one Theme grid, one Agent grid and one domain.
Separately, Case plaque placement can choose a box above its assigner; the
connector's aligned-x case became a straight upward arrow. It now has a short
curve within the vertical gap, with its arrowhead directed into the plaque.
Other routes, tree placement and shared camera logic are unchanged.

Verification: 1,712 tests, typechecking and both parse-contract fixtures pass.
Twenty saved analyses preserve recognition, every relation moment/order and all
drawing references. Nineteen retain identical Replay steps; only the reported
Sol transition changes. The production browser pass covers all eight new final
views, the affected movement, earlier Case examples, zoom, stepping/Fit and a
narrow Case view, with no console errors. Fable independently reviewed the
initial patch; its composition and arrow-direction findings have focused
regressions. Before/after captures, stepped recording and review remain outside
the worktree under `/tmp/babel-sept17-review/renderer-repairs`. This is bounded
verification, not a claim that all rendering or linguistic issues are resolved.
Other recognition gaps include unfamiliar role names, compound role/value groups
and relation restatements without enough movement evidence. More aliases alone
cannot resolve arbitrary language. Francis does not want a separate model
interpretation pass; do not pursue that proposal. Continue investigating shared
deterministic evidence rules and retain neutral claims when evidence is missing.

The follow-up recognition audit covers all 166 relation occurrences in those
eight analyses, comprising 94 distinct envelopes within their analyses. Two
small shared repairs are retained. Native scalar value keys now share their
concept catalog with Tier 2, so `role` no longer loses its literal outside a
registered title. Also, a thematic participant alone no longer establishes
predication. The existing explicit-role check keeps it neutral; registered
Predication and explicit predicand roles retain their drawings.

Across twenty saved analyses, five relation occurrences now earn a theta grid
and four lose an unsupported predication connector. Every authored relation and
its order survive. Nineteen retain identical playback steps. In the older Sol
Minimalism record, removing that false classification lets the existing
structural ownership rule put the VP merge in its authored relation moment;
the redundant preceding merge step disappears, reducing 34 frames to 33.
The eight newer analyses retain their frame counts and structural playback.
No prompt, saved record, tree layout or camera rule changes.

Remaining recognition findings are distinct:

- Unfamiliar roles such as `nominal`, `introducer` and `governingCategory` do
  not all establish their slots in the current shared vocabulary. A unique
  leftover participant is not proof of its role. Do not infer Case assignment
  from a nominal category or government alone.
- Compound qualified groups, such as separate nominative/accusative sources
  and recipients, need claim-scoped role/value association. A common prefix or
  equally sized lists alone must not choose pairings. The later review separates
  Sol's repeated identical assigner from genuinely different sources: repeated
  list entries are permitted by the contract. Its raw-array arity rejection and
  loss of open paired literal labels are native-reader gaps, not proof of a
  malformed linguistic claim. The exact-claim reader is now repaired, preserving
  the rule that Tier 2 must not rescue malformed Tier-1 claims.
- The compound follow-up confirms six relevant envelopes in the batch. Same-name
  values establish the recipient/literal correspondence, but do not independently
  pair multiple assigners with those recipients. Later statements also distinguish
  chain heads and lower positions, so grouping by a shared Case prefix would hide
  a real distinction. No new grouping rule or alias was added. Existing separate
  relations and scalar-predicate/list-argument records express explicit
  assignments, but separate relations change simultaneous groups into successive
  moments. No contract expansion is required for the repeated-source repair. General
  recognition of the compound records remains an investigation, not a completed
  repair or a reason to rewrite saved analyses.
- Repeated chain statements without a new transition, clause-force claims,
  government constraints, pronunciation and explanatory prose remain available
  neutrally. Their presence does not establish an additional drawable dependency.

Focused checks cover literal ownership and conflicts, explicit versus contextual
predication, and preservation of the authored merge moment and unrelated syntax.
The complete gate passes 1,715 tests, typechecking and both contract fixtures.
Before/after production captures and the audit data remain outside the worktree
under `/tmp/babel-sept17-review/recognition-audit` and
`/tmp/babel-recognition-audit.json`. Independent review and browser checks cover the changed frames, eight final
views, zoom, stepping/Fit and a narrow view, with no console errors. No new parses
were run.

The passive X-bar movement repair is now coordinated with Replay. A rebuilt
source parent can establish the old slot through unchanged ordered sisters,
matching label/arity and unambiguous IDs. Replay restores enclosing containers
that are exactly unchanged apart from their IDs after undoing movement, then
introduces their replacements with the movement. Independent changes and
unrelated syntax are preserved. This replaces the earlier discarded experiment
in `/tmp/babel-rebuilt-source-investigation.diff`; no role aliases, prompt,
contract, pronunciation, layout or camera changes were needed.

The saved Sol A-movement now earns its existing Tier-1 trajectory. All twenty
saved analyses retain their 809 frames and authored relation order; nineteen
have identical playback. Only the affected movement and its persistent drawing
change. Regressions cover both retained-ID conventions, prior-container timing,
unrelated syntax and rejected ambiguous source slots. The complete offline gate
passes 1,717 tests, typechecking and both contract fixtures. Production browser
checks cover the preceding/movement/following frames, all eight final views,
zoom, Next/Prev/Fit and a narrow view, with no console errors. Matched images
and a stepped comparison remain in `/tmp/babel-sept17-review/passive-movement`.
No new model calls were made.

The subsequent passive-frame check found two painting defects: identity light
averaged a phrase's terminal positions, and invisible Tier-3 moments occupied
space that pushed current role labels away. Light now targets displayed leaves,
including wordless witnesses. Neutral clearance is scoped to its relation moment;
all authored roles remain, without a redundant spoke connecting a node to itself.
Vertical label clearance now uses text height. The movement arrow was still
present, but its subpixel fitted stroke became nearly invisible at the normal
30% quiet opacity. Francis rejected a screen-sized stroke experiment; original
movement styling and dimming are retained. No arrow-persistence repair is claimed.
All twenty records retain identical plans and their 809 Replay frames. The final
gate passes 1,720 tests, typechecking and both contract fixtures. Matched frame
45–47 captures have identical cameras; review material is outside the repository
in `/tmp/babel-sept17-review/passive-annotations`.

Sol's X-bar morphology response uses `realizations` to associate retained `walk`
and `-ed` occurrences with the input token `walked`; raw authoring, normalization
and Replay preserve that association. Astra's whole-word analysis needs no such
group. This provides one fresh split-morphology example, not broad qualification.
Fable independently reviewed the recognition patch and seven new analyses; the
eighth was reviewed separately. Linguistic review remains advisory: some models
leave object Case unexplained, Sol's passive X-bar PP prose and attachment differ,
and some authored relation orders require structure introduced by a later
movement. Preserve these records and diagnostics. Subscription testing does not
qualify the paid API transport or hosted deployment.

| Area | Current state | Remaining boundary |
| --- | --- | --- |
| Authored contract | Each analysis contains only `derivationStages`, with four required stage fields and open relations. Optional stage `realizations` associates existing syntax with exact input tokens. Coverage, Replay, public routes and browser-local saving are verified offline; ordinary archived Replay is unchanged. One fresh Sol split-morphology example preserves its authored association through normalization and Replay. | Broader fresh morphology, language and provider coverage remains unqualified. |
| Deterministic engine | Local repairs preserve stages and originals and report exact field/reference failures. Saved chronology conflicts remain diagnosed. | Generated display identity now records ownership and reserves authored IDs. Recovery behavior stays unchanged; reopen its policy only if a new failure warrants it. |
| Relation renderer | The September 16 fidelity repair restores Orchard placement and paint. The approved Tier-3 role labels retain its connectors and authored list positions. Orchard cards use production drawing code for every tier. Earlier checks missed a separate Tier-3 painter; their broad fidelity claim was incorrect. | Extreme text and viewport checks remain bounded. Labels wider than the available canvas still require panning; no participant-free drawing is justified. |
| Replay preparation | Repeated complete-workspace layout traversals are eliminated. Extended controls through 192 stages/1,472 frames complete with unchanged compiled results. Earlier testing of forty large view cycles released all 81 workers and retained about 18–19 MB of page heap; 15 mid-preparation cancellations also recovered correctly. | The September 17 controls take 7.43 seconds for a balanced 1,472-frame derivation and 22.98 seconds for a deeply nested 959-frame derivation. Earlier controls sampled worker heaps up to 182 MB; memory was not re-profiled in the later pass. These bounds do not establish instant preparation, exact peak memory or slower-device behavior. No layout rewrite or persistent derivation cache is introduced. |
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
  repair stays unchanged. Its policy is deferred unless a new failure warrants
  investigation; it is not current implementation work.
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

Current offline gate: 1,695 tests, typecheck and both parse-contract fixtures pass.
The release asset check passes. Approved Replay wording, Tier-3 role labels and
the September 17 movement, recognition, index and clearance repairs are merged
and pushed through `1b7ddc9`. The verified visibility and preparation follow-ups
are `cf3fdf7` and `ec36a89`. This is local/offline evidence, not deployment qualification.

The September 17 follow-up is limited to the recognition audit and measured
large-derivation improvements, plus the approved relation-only Tier-3 visibility
rule. Other implementation or provider work waits for discussion. Historical
JSON failure and recovery-policy entries below are retained as evidence, not
active tasks; reopen them only if a new failure makes them relevant.

Reconciliation of the 19 starting-point items, 39 audit findings and Programs 0–8:

- **September 17 follow-up completed:** Tier-3 annotations now appear only on
  their owning Replay relation frame. Going back restores them; the Stage Record
  does not accumulate them. Tier 1 and Tier 2 retain their persistence. The same
  complete-stage plan reserves space before reveal, preserving accepted syntax,
  plaque positions and camera fitting. Two focused regression tests cover
  forward/backward playback, scrubbing, Stage Records and mixed known/neutral
  claims. All 240 saved Opus/Grok/Sol frames retain identical browser syntax
  labels, coordinates and cameras. Opus X-bar frame 47 drops from 18 neutral
  labels to its one current label; frame 48 has none. Zoom, pan, Next and Fit pass.
- **Remaining recognition audit:** All 102 authored relations across ten saved
  analyses were reviewed, including complete fallbacks and residual content.
  Renamed occurrence IDs and reversed field order preserve all 102 dispatch
  results. The full gate includes the existing cross-family positive, missing-
  evidence, ambiguity and mixed-claim controls. No further general recognition
  change is justified by this set. Remaining cases include missing or untyped
  literals, absent occurrence identity, unestablished source/recipient pairing,
  prose-only interpretation, and claims without an approved drawing. Preserve
  them neutrally; no aliases, prompt edits or inferred linguistics were added.
- **Measured large-Replay optimization:** Each structural step previously expanded
  the same complete workspace once per participating node. It now expands that
  root once per step. Partial unrevealed-clause handling is unchanged. No layout
  rewrite or persistent cache is introduced. Complete preparation results are
  identical across 377 saved frames, 64/192-stage nested and balanced controls,
  and a detached-workspace control. Three-run local medians change from 11.08 to
  7.43 seconds for 1,472 balanced frames, and 24.47 to 22.98 seconds for 959 deeply
  nested frames. These are bounded measurements, not a universal speed claim.
  `node scripts/benchmarkReplay.mjs 64 192` now measures the full worker preparation
  function with left, right and balanced controls. The actual app worker renders
  the 192-stage balanced control; direct frame jumps, Fit, view switching and
  mid-preparation cancellation/reopening pass without browser errors. The full
  gate passes 1,695 tests, typecheck and both fixtures; build and release assets
  pass. Review evidence is outside the repository at
  `/tmp/babel-sept17-review/followup`. No paid requests were made.

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
  Francis subsequently approved Tier-3 annotations only on their owning relation
  frame, with earlier claims reachable through Replay. Fresh provider calls
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
- **Deferred unless a new failure occurs:** historical malformed-output
  investigation and changes to structured-output recovery. Successful later
  requests do not establish the cause of an older failure. No further probes,
  repair helpers or provider calls are part of the current work.
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
| 10–12: repair and incomplete processing | Inspection preserves originals, usable evidence and diagnostics. Saved HTTP/text hashes reconfirm Fable's omission before Babel processing; its generation-side cause is unknown. | Deferred by Francis on September 17 unless a new failure occurs. Preserve originals and current behavior; no helper or paid experiment is authorized. |
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
6. **Deferred unless a new failure occurs.** Structured-output repair and
   incomplete-processing policy are not active work. Preserve originals,
   diagnostics and current behavior. No helper or paid experiment is authorized.
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
   priority. The September 17 follow-up above qualifies controls through 1,472 frames
   and removes measured duplicate layout traversal. Further preparation, transfer
   or painting optimization requires fresh profiling and unchanged results. No
   finite matrix proves all open relation combinations.
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

Historical Tier 3 presentation, decided 12 September and superseded by the
September 17 relation-only visibility decision: a neutral fallback marks its own
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

Tier-3 numbering is settled. The September 17 decision supersedes stage persistence
with visibility at the owning Replay relation moment only. Francis previously approved
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
  drawings are already implemented. The eight-parse subscription batch confirms
  that vocabulary consolidation alone is insufficient. Evaluate unfamiliar
  wording against existing drawing requirements without changing the authored
  analysis. A separate model interpretation pass is not wanted and is not part
  of the implementation plan.
- Broader model qualification of optional `realizations` for retained final
  morphology. One fresh Sol X-bar `walk` + `-ed` association works; other
  realizations and languages remain unmeasured.
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
| 04 | Deferred unless a new failure occurs | Historical bytes and diagnostics remain available. Francis removed this investigation and recovery-policy work from the active agenda on September 17. |
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
| 19 | Integrated; visibility revised September 17 | A neutral fallback now marks only its owning Replay relation moment and returns when that frame is revisited. Tier 1 and Tier 2 retain their persistence. Hiding leftover anchors and one-mark-per-relation were rejected. Earlier badge counts are historical; final Replay Stage Records now carry no Tier-3 marks. |
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

IndexedDB is the selected browser-local engine. New saves use immutable,
content-addressed analysis records and one shared generation-context record;
the saved-work wrapper holds their ordered references and view state. Existing
version-1 entries remain readable and are not migrated or removed automatically.
Import/export and any legacy transition interface are deferred to the later
application design work. Automatic Generation Archive retention remains separate.

1. Complete: characterize save/open/delete, preview snapshots, ambiguity
   selection, view restoration and failure recovery.
2. Complete: retain IndexedDB for atomic browser-local writes, versioned
   stores, indexed records and cross-tab updates.
3. Deferred with application design: explicit backup/import/export. Months-old
   entries do not require a migration project; their existing read path remains.
4. Decide any legacy import or export-and-retire interface during that work.

### 2B. Record Integration

The current Tree Bank integration preserves the complete received analysis and
generation JSON, commits records, wrapper, and preview atomically, validates
integrity when opening, and restores the selected analysis, view, and Replay
position. Invalid data stays in place and reports an error without blocking
other saves. Preview bytes load separately; identical content can be shared
across explicit saves. Cross-tab changes refresh the library.

These local records are explicitly not W17 export envelopes. Current runtime
responses do not supply every required W17 evidence field, including dated
provider-notice references. The native-record adapter must preserve that
distinction when import/export is designed; it must not invent missing evidence.
Browser-local storage still depends on its origin and browser retention policy.

1. Complete: immutable local analysis records, shared generation context and a
   versioned saved-work wrapper with ordered references.
2. Complete: atomic records/wrapper/preview writes, or no visible save.
3. Complete: restore framework, selected analysis, view and valid Replay
   position; load preview bytes separately.
4. Complete: reconstruct the complete received bundle without silent replacement
   of alternatives, reruns or authored data.
5. Complete: validate hashes and metadata on load; preserve unreadable bytes in
   place and report the error without blocking other entries.
6. Complete: focused interrupted-write, quota, upgrade, ambiguity, Unicode,
   corruption and cross-tab checks, plus browser save/reopen/reload evidence.
7. Deferred: native import/export, duplicate/collision policy, corrupt-import
   tests and export-based recovery in a fresh browser. The W17 adapter must
   distinguish unavailable evidence from recorded evidence.

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

Application boundaries implemented in the current local change:

- `App.tsx`: storage lives in `services/treeBankRecords.ts` and
  `services/treeBankStore.ts`. Snapshot capture, bracket-notation serialization
  and generation state now have separate owners, preserving current provider
  requests, preview pixels and save/reopen behavior.
- `TreeVisualizer.tsx`: `ReplayPanel.tsx` now owns the existing controls and
  detail presentation. Playback state, camera, DOM measurement and D3 painting
  remain together. Local error boundaries and owned callback guards contain
  rendering failures without discarding the current analysis. A later painter
  extraction needs a shared drawing context; it is not part of this change.
- `replayCompiler.ts`: pure panel/detail formatting and trace/index notation now
  live in separate React-free modules. Movement ownership, pre-movement source
  state and structural scheduling remain in one compiler. Existing exports and
  authored fields retain their meaning.
- Failed-output inspection shares authored-workspace and realization rules with
  server validation. A diagnostic dialog exposes readable stages and Replay;
  original bytes, diagnostics and downloads remain separate from accepted parses.
  Browser-only expansion limits prevent malformed references from freezing the
  view without weakening the server contract.

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
   parse selection, and provider transport retries. Renderer and diagnostic
   inspection error boundaries are implemented locally, including owned D3,
   animation, resize and deferred callbacks. Retry remounts the view without a
   provider request; closing inspection restores keyboard focus. Future route
   boundaries belong with the eventual application split. Decide separately
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

- The import/export experience, including any legacy importer or export-only
  retirement, during application design. IndexedDB is already selected; old
  entries remain readable without an automatic migration.
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
