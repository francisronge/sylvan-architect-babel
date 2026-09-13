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
