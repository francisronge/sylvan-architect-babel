# Visual Relations Renderer Closeout

Date: 2026-08-25

Status: verified and closed.

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

Drawing paint is shared in
[`relation-visuals.css`](../research/relation-orchard/relation-visuals.css). The app
imports it, both Orchard pages link it, and the Tier-2 review build includes it.
Keep page layout and lens visibility outside that stylesheet. Hover uses the
shared ink/halo class without replacing relation-moment opacity. See the
[production restoration and verification](../implementation/contract-qualification/system-audit.md#repairs-and-verification)
for the September integration corrections; the original review below is retained.

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

## Camera input ownership

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
