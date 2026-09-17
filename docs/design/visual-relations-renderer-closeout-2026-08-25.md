# Visual Relations Renderer Closeout

Date: 2026-08-25

Status: historical closeout, corrected by the September 16 fidelity audit below.

## Scope

- Tier-1 curated relations and Tier-2 structural facets use the same production
  renderer pieces.
- The audited Tier-2 inventory contains 69 distinct primitives across 70 output
  assignments owned by 52 executable recipes. `Branch overlay` is shared by
  Pair Merge and Blocked Extraction with different authored branch sets.
- Illicit-analysis verdicts bind the glyph and optional open label to one exact
  analysis anchor and keep that compound together through camera zoom.
- Archived construction examples remain ordinary primitive compositions; they
  do not restore retired renderer identities.
- Relation hover uses the shared emerald ink with a `6px`, alpha `0.50` halo.
  It changes no stroke width, geometry, opacity, or layout.
- Pair Merge follows both native branches of its shared-parent fork. Blocked
  Extraction reuses the same branch overlay for its adjunct branch only; Phase
  remains a separate solid domain cap.

The production Orchard loads
`visual-relations-current-lab.production-only-audit.r96.bundle.js`.
`npm run orchard:build` builds it from the production renderer and copies the
identical artifact to the research site's `relation-orchard.bundle.js`.

Drawing paint is shared in
[`relation-visuals.css`](../research/relation-orchard/relation-visuals.css). The app
imports it, both Orchard pages link it, and the Tier-2 review build includes it.
Keep page layout and lens visibility outside that stylesheet. Hover uses the
shared ink/halo class without replacing relation-moment opacity. See the
[production restoration and verification](../implementation/contract-qualification/system-audit.md#repairs-and-verification)
for the September integration corrections; the original review below is retained.

## September 16 fidelity correction

The previous complete-integration claim was wrong for Tier 3. Its Orchard cards
disabled the production overlay and painted a separate implementation. Production
put larger circles below labels and ran scalar stems through syntax. The card
verification accepted the substitute painter. The 69-piece raster comparison
also compares isolated specimens, so it is not production-tree parity evidence.

Production now uses the accepted measured side placement, small rounded boxes and
circles, centered numbers, backward triangles, trimmed fan spokes and links below
the participating subtrees. Allocation reserves every mark before the stage's
relation moments reveal them. The complete groups retain their automatic Fit size
and enlarge with manual zoom. Hover and emphasis still use shared production ink.
The duplicate Orchard painter is removed; its cards supply records only.

The 55 specialized cards retain their geometry and styles through this change.
One additional reproduced defect, Fission text outside its bundle, is repaired
with the existing measured text wrapper. Literal values are preserved. All 61
cards render; 283 saved Replay frames pass badge-to-label clearance and finite
geometry checks. These checks do not establish universal layout correctness.
The user-approved literal-role annotation redesign remains separate backlog work.

## Accepted Tier-3 role labels

The subsequent user-approved text trial supersedes the circle/box locators and
backward triangles described in the preceding restoration history. Current
witnesses carry their authored role names. List positions appear as `[1]`, `[2]`,
and so on; equal positions across paired lists retain their correspondence.
Topology remains unchanged: two scalar witnesses have the accepted connector
below their subtrees, a scalar plus an array has a fan, and unpaired witnesses
have no invented links. Fan paths leave measured gaps around syntax and role
labels. Repeated witnesses retain separate owned endpoints.

The existing Replay rows identify previous-stage references with
`role (previous stage): participant`. No triangle or extra panel section is
needed. Plain camelCase names receive conservative display spacing; punctuation,
notation and authored record strings remain unchanged. Unavailable references
and empty collections have distinct readable descriptions.

Source/Landing descriptions use “specifier” and “complement” only when matching
authored X-bar levels establish them, independent of left/right branch order.
Other positions use node/parent descriptions without repeated identical labels.
The renderer does not infer a position from child order alone.

Complete role labels share the tree scale during manual zoom, preserving their
fitted size and stage-wide placement. The production painter and topology are
shared with every Orchard fallback card.

On September 17, Francis approved showing Tier-3 annotations only during their
owning Replay relation moment. Earlier neutral claims remain available by
returning to their frame; they do not accumulate on later relation frames or the
Stage Record. Complete-stage inspection retains all claims. The plan still
reserves their geometry before reveal, so this visibility rule does not change
syntax layout, plaque placement or camera fitting. Tier 1 and Tier 2 retain
their existing persistence.

Plaque placement reserves syntax, movement trajectories and the straight stems
of neutral links across the complete stage. Small plaques try measured nearby gaps when the usual pockets are blocked;
large plaques retain their below-subtree placement. A carried plaque keeps its
offset unless new stage geometry occupies it. Neutral lower connectors retain straight stems and separate lanes. Plaques
yield to their reserved stems; the lower lanes clear plaque bottoms. Role text
yields to the connector routes. These allocations precede relation reveal, so revealing a plaque
does not move existing syntax or annotations. The straight-connector revision was visually accepted on September 17; its
bounded verification and remaining work are recorded in the roadmap.

## Extreme text overflow

Ordinary text plaques retain their accepted geometry and placement. Only content
exceeding forty row-font heights uses a twenty-row-font-height scroll viewport.
The entire stage reserves that viewport before any of its rows appear. All rows
remain in the authored record and SVG; wheel and keyboard input scroll the plaque
without changing the tree camera. Small/local and larger/below-subtree placement
continue to use the shared allocator. This exception does not introduce a reading
view or a new relation drawing.

Tree Bank previews capture the visible portion at its correct bounds, with all
rows preserved in the saved analysis. A static thumbnail does not promise a full
print layout for extreme content. See the [dependability evidence](../implementation/contract-qualification/system-audit.md#extreme-plaque-overflow-and-active-camera-gestures).

The organizational Anchor rail includes its Orchard joining lines. Bound geometry
retains the exact marks belonging to its authored relation, including existing
neutral badges, and carries their joins through Fit and zoom. It does not select
another claim's mark because the two claims share a node.

## Camera input ownership

Gap notation reuses an existing category or terminal belonging to the exact
authored occurrence. Generated terminal ownership is explicit metadata; an ID's
spelling never proves ownership. A distinct authored annotation remains visible.
Generic gap labels, coindices and complete Tier-3 role labels retain their
accepted size at automatic Fit, then share the tree's scale during manual zoom.
Their size and stacked offsets use that same Fit reference when redrawn under a
retained manual camera. Each role label and its array position stay in one coordinate group. Fan connectors follow the fitted marks;
two-scalar connectors start below their participating subtrees, as in the Orchard;
dependent rails remain below the deepest connector lane. Native Orchard paint
and the initial fitted appearance are unchanged.

Manual zoom and pan persist across Replay frames. Fit clears that manual choice
and restores automatic stage framing. Programmatic camera updates never become
manual input, even while D3 still carries the source event of an unfinished wheel
gesture. One zoom dispatcher remains attached to the current tree group across
redraws. These lifecycle rules do not change tree layout or the stage-fit math.

## Replay preparation

`replay/prepareReplay.ts` assembles the existing Replay compiler and relation plan
without React or DOM access. The application invokes it through a dedicated worker
before mounting `TreeVisualizer`. The standalone Orchard and archived-review
renderers invoke the same function directly, so their self-contained builds do not
need a worker asset. Neither path has separate linguistic or scheduling rules.

Each preparation owns one worker. Completion, failure, view changes and unmounting
release it; stale results cannot mount a previous analysis. A failed preparation
shows a retryable view error and leaves the authored record intact. The camera
choice survives preparation when switching between Canopy and Replay. Display-only
changes such as glyphing do not prepare the same Replay again.

Preparation reuses the parse animation's loading mark at a smaller size. It stays
invisible for 200 ms, so quick preparations do not flash an indicator; completion
never waits for the animation. Screen readers receive a status immediately, and
reduced-motion preferences disable the spinning and pulsing decoration.

The worker removes compilation from the app's UI thread, not its CPU cost. Message
transfer and D3 layout/painting still involve the UI thread. There is no persistent
cache, worker pool, automatic provider retry or change to JSON processing. Canopy
preparation omits Replay steps; switching into Replay prepares those steps then.

Within one compilation, interpreted stage relations are reused when constructing
cumulative links. Links still resolve against their current forest and relation
limit. Tree lookups for casing and visible-token accounting are local to one
canvas. They preserve first-preorder ID/alias resolution, inherited flags and
existing count rules. Neither reuse mechanism survives a new preparation or
changes the serialized result.

## Review

Fable reviewed the broad renderer closeout and returned **GREEN**, with no
P0-P2 findings. Its residual notes concerned extreme-length verdict labels,
the general support-line condition used to suppress duplicate raw relation
detail, a documentation ambiguity around carrier/enclosure ownership, and the
set-based archived-ACD guard. A post-hover no-tools follow-up was attempted but
could not run because the Claude account had exhausted its usage credits; no
model was substituted.

Ox Alpha reviewed the final live state in the existing Babel OpenCode session,
including the stronger hover. It returned **GREEN** apart from one P2
documentation ambiguity: the movement section appeared to assign both Carrier
arrow and Gradient enclosure to `movement.carrier`. The specification now
states their separate owners: `movement.carrier` and `constituent.region`.

Neither reviewer changed repository files.

## Verification

- Live Chrome: active verdict computed to
  `drop-shadow(rgba(52, 211, 153, 0.5) 0px 0px 6px)`; its bounding box was
  identical before and after hover.
- `node --test tests/treeVisualizerReplayDomState.test.mjs`: 30/30 passed.
- `node --test tests/tier2PrimitiveRecipes.test.mjs`: 27/27 passed.
- `npm run verify:all`: typecheck passed, 1016/1016 tests passed, and both
  normalized parse-contract fixtures passed.

No provider parse, model parse, fixture regeneration, commit, push, or deploy
was performed. The pre-closeout Tier-2 specification backup is at
`/private/tmp/visual-relations-tier2-shape-dispatch-spec.pre-closeout-20260825.md`.
