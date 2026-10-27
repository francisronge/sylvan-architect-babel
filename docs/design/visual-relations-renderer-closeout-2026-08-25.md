# Visual Relations Renderer Closeout

Status: renderer behavior contract. It states rules only; open renderer work is
listed in [`ROADMAP.md`](../../ROADMAP.md) and earlier review evidence is in
[`docs/history/renderer/`](../history/renderer/README.md).

## Scope

- Tier-1 curated relations and Tier-2 structural facets use the same production
  renderer pieces.
- The audited Tier-2 inventory contains 69 distinct primitives across 70 output
  assignments owned by 52 executable recipes. `Branch overlay` is shared by
  Pair Merge and Blocked Extraction with different authored branch sets.
- The 69-piece raster comparison compares isolated specimens. It is not
  production-tree parity evidence.
- Illicit-analysis verdicts bind the glyph and optional open label to one exact
  analysis anchor and keep that compound together through camera zoom.
- Archived construction examples remain ordinary primitive compositions; they
  do not restore retired renderer identities.
- Relation hover uses the shared emerald ink with a `6px`, alpha `0.50` halo.
  It changes no stroke width, geometry, opacity, or layout.
- Movement paths keep their original stroke behavior; they do not use
  screen-sized strokes.
- Pair Merge follows both native branches of its shared-parent fork. Blocked
  Extraction reuses the same branch overlay for its adjunct branch only; Phase
  remains a separate solid domain cap.

The production Orchard loads
`visual-relations-current-lab.production-only-audit.r96.bundle.js`.
`npm run orchard:build` builds it from the production renderer and copies the
identical artifact to the research site's `relation-orchard.bundle.js`.

Drawing paint is owned by the renderer in
[`relation-visuals.css`](../../components/renderer/relation-visuals.css). The app
imports it and the Tier-2 review build includes it. Both Orchard pages link the
research site's exact copy, which `npm run orchard:build` refreshes and
`tests/relationVisualStyles.test.mjs` compares byte for byte.
Keep page layout and lens visibility outside that stylesheet. Hover uses the
shared ink/halo class without replacing relation-moment opacity.

### Construction geometry and attachment continuity

Replay builds each authored stage's coordinate budget and branch proportions
locally. Camera fitting includes revealed syntax and owned marks, with one fit
across the stage's steps. The painter, plaque allocator and camera consume the
same reservations.

Local drawing proportions use a 375-unit sibling pitch and a 220-unit row from
`replay/treeSpacing.ts`. Whole-tree depth, leaf count and viewport dimensions do
not select those proportions. Identical material subtrees retain the same local
shape across containing trees; measured labels, words and branch clearance may
require more room. Camera fitting scales the complete drawing. It never squeezes
individual forks back into a previous whole-tree width. Dense full-tree
overviews can therefore require zoom; that alone is not a defect.

Replay prepares intrinsic contours once through the construction history and
then applies its existing attachment and continuity constraints. The Canopy is
the last Replay frame without its relation marks: every Canopy node takes the
place of its occurrence in that frame, through the one frame layout both views
use (`components/renderer/frameTreeLayout.ts`), and only the camera Fit differs.
The Canopy waits behind the layout cover for that frame. A Replay layout that
fails, or a last frame that does not show every Canopy node exactly once, is a
layout fault: the Canopy shows it as Replay does, with Retry, and never draws
another layout in its place. Only an analysis without derivation stages, such as
an older saved record holding just its tree, is laid out with the same contour
packing with native text measurements; the tree's SVG then reads
`data-babel-canopy-layout="fresh"` (otherwise `"replay-frame"`). The Canopy's
Fit has no minimum scale: it always shows the whole tree, centred in the usable
view, and the user zooms in to read. The camera audit's `canopy-final-frame` and
`canopy-placement` rules check every committed analysis at desktop and
mobile. Established movement slots
remain owned by their exact occurrences. If the spoken source cannot safely use
the smaller lower-occurrence slot, retain its established slot after that
movement instead of pulling unchanged ancestors inward. This fallback must pass
the same ink, ownership and motion checks as source compaction.

A proved head movement may add one member directly to an existing receiving
head, beside its complete ordered prior contents. Those retained contents own
their clearance translation at that movement moment. Earlier selection and
projection steps cannot open that gap. Each unchanged component keeps its
internal contour; reordered contents, a phrasal landing, or a source already
inside the receiver do not establish this receiving boundary.

A separate placement pass may reserve the future root position of an independent
workspace component when a relation opens its attachment stage. The component's
child lists must survive that attachment, allowing an exact authored lower witness
to replace its prior source. Its earlier completed geometry supplies every
internal offset; future syntax supplies only the attachment position. Construction
therefore starts in that reserved space without exposing future nodes or extending
early branches. The reservation ends when the component disappears or its current
parent/child attachments become incompatible. Ambiguous witnesses do not qualify.

Do not use an analysis-wide coordinate and sibling-rank reservation. The
bounded workspace placement in `replay/workspacePlacement.ts` does not lock moved occurrences to their final landing positions or import future
branch heights. A source's reserved place transfers to its exact lower witness;
the real landing still appears at the authored movement moment. Ordinary camera
fitting continues to frame each stage, and manual zoom remains under user control.

Independent workspace components may reserve their future left/right order after
construction planning. This may look through a new intermediate projection only
while the first attachment and sibling order persist uniquely. It cannot change
selection timing, reorder a genuine syntax parent's children, or import future
branch heights. Unknown or interleaving component slots keep their existing order.

This also covers a detached input merging around an unchanged child already inside
a tree. The exact current merge inputs and replaced parent slot establish the
receiving host. If the inputs would exchange sides, reserve the complete join
through their preceding construction lifetimes. A successful contour solve alone
does not prove that order is stable: merge participants may translate rigidly.
Reject a reservation that widens any earlier completed syntax root. The envelope
between independent forest roots may grow to reserve their eventual sides; their
internal widths and the final tree remain unchanged. Actual movement still owns
its separate relation moment.

Writing direction follows the input's Unicode first-strong direction and applies
only to presentation coordinates. Stored children, tokens, glyphs and syntactic
dependencies are never reversed.

When an unchanged workspace component carries coordinates across stages, preserve
its position after applying the writing direction. Coordinates are planned once,
left to right, for both directions. RTL reflection uses the current canvas width,
so each stage's reservations are first translated as a whole by its width less the
completed stage's width; every frame of every stage then reflects about that one
axis, and RTL Replay is the LTR Replay reflected, with the same rows, relative
positions and motion. Rebasing only the carried component would change its
clearance from other syntax and can introduce collisions. The reservation cache,
painter and bounds calculation share that reflection. This changes the drawing
origin, not its internal spacing or automatic fit; a manually positioned camera
retains the component.

Relation plaques and neutral role labels mirror as well (Francis, 22 October
2026: "mirror them too"). Plaques are allocated on the LTR layout and each
placement is reflected about the same axis, so a pocket the LTR search finds
right of its anchor stands left of it RTL, and row ports and side edges reflect
with it. A shell drawn narrower than a later phase reserves that width only
while plaques are allocated; reflected, it reserves its drawn shell, and its wider
phase has its own reflected placement. Role labels try the reading-direction
side of their witness first (below). Plaque and label text stays upright.

Generated sentence-initial casing does not change an authored subtree's identity.
For geometry retention only, compare a generated word child's initial capitalization
against its exact unchanged owner. Authored spelling, pronunciation, identity,
ownership, attachment and all other display content remain exact. Rendered text
keeps its current casing.

Construction diffing includes child-list growth on existing occurrence IDs.
Attaching a complement beneath a retained parent receives its own merge step.
Growth from no children counts: a retained bare head that becomes a head complex
under its own ID stays bare while its new daughters are built as separate
workspaces, and its own merge step attaches them.
Replacing an existing child with a new wrapper around it belongs to the wrapper's
construction; the existing parent and unaffected branches remain visible. Do not
hide or rebuild a parent that was already merged. Attachments owned by an authored
movement relation remain part of that atomic moment.
A future wrapper must not deepen only one current daughter before it is built.
Final visibility refinement runs before structural-step validation and progress
counting. An invisible future target cannot receive a construction step or grant
a current receiving attachment. Authored unary parents remain ordinary syntax;
matching labels alone do not authorize hiding them.
When its sister retains the current attachment, use that sister’s reserved rank
and translate the wrapped daughter’s current subtree as a unit. Retained entry
coordinates must be accounted for before this translation. This changes neither
construction timing nor the ordinary branch spacing inside the subtree.

A current top fork need not reserve a future movement landing by stretching its
head branch. Its receiving component may use one rigid inward translation
throughout its compatible construction lifetime. The head stays fixed; the
proved movement opens the additional space. This applies both to a new wrapper
and an exact landing that turns an existing unary projection into a binary fork
around its sole retained child. Adding a daughter to an existing fork does not
release unrelated peers. Ordinary merges retain all internal subtree offsets.

An unbranched moving source must not sit farther out than its replacement lower
occurrence when both occupy the same parent slot beside stationary siblings.
The compact lower slot may be reserved throughout the source's construction.
An existing unbranched receiving head may likewise retain its movement-time
center. Current labels and pronunciation remain unchanged; new children appear
only at movement. Recenter affected ancestors, keep retained interiors rigid,
and reject the whole proposal if measured ink, earlier construction, or motion
ownership would conflict. This applies at inner forks as well as outer ones.

Compaction is bounded by measured current ink across that lifetime. It must
preserve branch direction and sibling order, clear the current fork, and add no
unowned motion or unchanged-subtree reflow. Camera fitting, painting and plaque
allocation continue to consume the same stage reservations and existing fit
policy.

### Plaque lifetime placement

Compound Case/feature claims reveal the plaque immediately, then draw its new
dotted collector within the same relation moment. The short reveal uses a mask;
the original dash pattern, width and path remain unchanged. Reduced motion,
final views and already-visible collectors show the complete mark immediately.
Font or viewport remounts continue the same reveal, and manual camera gestures
finish it without replaying it.

Orchard D6 authors CaseAssignment and two Agree claims. Production composes
their three value rows into one plaque while Replay preserves three relation
moments. Each dotted collection path appears at its own Agree moment. A single
authored relation has one moment; if that one claim licenses both a plaque and
a connector, the connector reveal runs within that moment. It does not imply
that one claim can supply D6's distinct number and gender dependencies without
their source and target evidence.

An asserted feature-licensing claim may name its recipient by an open role.
One explicit licenser, one unambiguous current recipient, and an independently
authored feature literal earn the existing feature plaque and dotted connector.
The plaque preserves the literal without a Case or agreement heading. A
particle/exponent remains context; it does not become another recipient. Missing
values, competing endpoints, denied claims and Case notation do not qualify.

Level Case-plaque side entries retain a bounded curve above the gap, keeping the
word exit and plaque approach clear. Allocation and painting use the same curve.
Several feature rows of one failed comparison retain their separate collectors
but share one failure cue, identified by the exact compiled claim, endpoint pair
and visible authored owners. Center that cue between the arc-length midpoints of
its visible row routes in tree coordinates. A single route keeps its midpoint.
Independent failed comparisons keep separate cues.
An explicitly blocked Case dependency retains its solid curve and literal row,
with the same failed-dependency cue and no successful arrowhead. If that Case
curve and feature collectors belong to one exact failed claim, they share the
cue across their routes. Independently successful Case keeps its arrow and
does not join a failed agreement cue.

Identity lighting uses one common source and one light per exact participating
terminal, including authored wordless witnesses. Repeated claims retain their
owners without adding light twice. The canvas repaints on camera, viewport or
Replay changes and remains idle otherwise.

Binding ellipses retain the accepted padded-rectangle geometry and the whole
authored domain. Replay reserves their extent across the stage before reveal;
the existing containment correction pans or scales only when needed. Static
painting measures the same ellipse before fitting. This prevents a whole-clause
ellipse from being cut off without silently narrowing its scope.

The idiom domain bracket keeps its 320-unit right gutter, 96-unit cap and
80-unit vertical margins when they fit. At initial fitting, bound its gutter
and cap to the remaining right viewport. The path then stays in the domain's
tree coordinate group through zoom and pan.

Shared-feature vine plaques measure the complete typed feature text and wrap it
within a bounded width. The original short plaque keeps its 248-by-92 dimensions;
longer content and camera reservations use the same measured layout. Single
association curves retain each endpoint's own height, including when the two
anchors occupy different levels.

Fixed native plaques also reserve their complete measured footprint before other
plaques choose a pocket. Shared-feature vines and dependent-case state plaques
keep their original positions and connectors; an overlapping PF or feature plaque
must choose another position. Reservations cover retained label/index variants,
including variants that reverse the vertical order of dependent-case bearers.
The worker probes native plaque text using the same authored-occurrence alias
index as allocation. A missing metric fails instead of substituting different ink.
The stage camera fits that same measured footprint, not one derived from
nominal word and category boxes.

Vines are routed as a group. If staggered bearer heights make the independent
curves cross, their inward bends begin later so their horizontal order remains
intact. Endpoints and the shared plaque stay fixed. Noncrossing groups, including
Orchard D5, retain their original paths. A vine whose path would run through
another bearer's word (a determiner above a long adjective) instead sidesteps
evenly to that word's side, keeping its 22-unit word gap, passes it and then
takes the accepted curve into the shared point. It passes on the side that keeps
the group's horizontal order, and keeps its original path when the sidestep
would be steeper than one across per two down, meet another word or cross
another vine.

Literal-only PF plates use the measured width of their heading and rows, up to
the existing 590-unit wrapping width. Short plates can therefore use the shared
nearby placement search. Native rewrite and zero-realization columns retain
their accepted dimensions. Allocation and painting use the same font metrics;
all contributors and lifetime reservations remain unchanged.

Replay reserves a plaque's content size and anchor-relative position across
compatible participant geometry, including ordinary structural reveals. When an
authored relation changes an exact participant or effective Case source, allocation
revalidates the previous pocket against the new geometry and may choose a nearer
clear pocket. A construction step that changes the effective Case source, as when
a bare head's merge makes it a head complex whose arrow leaves its one word, does
the same; its other attachments do not. Valid equally near pockets remain stable. Each Replay step selects
its scheduled placement, and the camera includes every placement in its authored
stage. Camera measurement projects a plaque only in scenes where its attachment
is visible; hidden attachment coordinates do not describe painted content. The
stage-wide union still reserves its later visible placement before reveal.
The worker, painter and camera consume the same stage and step maps.

A plaque shown at consecutive Replay steps keeps its pocket, carried with its
anchor, unless the anchor moves or the later step newly paints something in the
pocket's way; Francis objected to plaques that "switch position randomly".
Within a stage the anchor moves on screen; across a stage boundary it moves only
against the camera's carry (`carryCamera`). What a step paints is what allocation
reserves for it: its visible syntax, its revealed marks with their reserved stems
and routes, the other plaques it shows with their Case arrows and their collectors
of rows already shown. Syntax, marks, rows and plaques revealed later do not count.
Something is new when the earlier step had nothing of the same kind at the same
place, carried with the anchor; what already stood there when the plaque was
shown does not move it now. A new occupant is in the way when it comes within the
gap carrying keeps: the plain plaque gap from syntax and connectors, or the
narrower margin a pocket brought near was accepted at, and always the full gap
from trajectories and other plaques (half the margin from an arrow is under a
pixel when a small screen fits a large tree). A new label or plaque across a Case
arrow or collector the plaque already drew is in the way too. When the plaque's
own Case arrow or collectors start, end, meet another row or leave a source that
moved, its pocket is kept only where every allocation rule accepts them. The
schedule may still move a plaque at a phase or stage boundary, because its pocket
is blocked later in the phase, because a nearer pocket opened, or because a later
mark of the new stage reserves it. The plaque then waits and moves at the step that
blocks its pocket or moves its anchor. One exception lets a plaque that shows its
owner only by proximity, left beyond its nearby reach, return within it: it takes
its nearer scheduled pocket at the step where what the previous step painted there
has gone. A claim a later movement transfers to a lower occurrence keeps one plaque
identity, its authored occurrence's, across that movement. The camera includes
every step's placement. `replay/relations/pocketHold.ts` is this rule's one
definition: the schedule moves a plaque only where it allows, and the offline visual
audit reads the schedule's own occupants and reports every other jump
(`mark-motion`, `plaque-teleport`).

A plaque without its own Case arrow or collector shows its owner only by
proximity. Among compact plaques placed together, such plaques choose their
pockets before Case and collection plaques, whose connectors still join them to
their owners from a farther pocket. One anchor-relative pocket clear at every position of a moving anchor
can lie beyond all of the plaque's nearby pockets. Such a remote plaque instead
takes a pocket for each position that an authored movement carries its anchor to,
inside the moved phrase or the complex head that movement forms. Reflow, merges
and other phrases' movement do not count. At each such movement it keeps its
pocket unless a clear pocket is at least a quarter nearer, or nearby while its own
is not. Until it is placed at that movement its old pocket stays reserved, so
allocation order cannot hand the pocket to another plaque first. Between those
movements it keeps one offset, and plaques placed later avoid its pocket as they
avoid any other.

A proximity plaque still beyond its nearby reach once every phase is allocated
gets a second look for each run of consecutive phases in which it keeps one
anchor-relative pocket. It may take the nearest pocket that, in every scene of the
run, keeps half the margin (12 units) from syntax and connectors, and the full
margin from trajectories and every other plaque's allocated pocket. Half the
margin from a trajectory is under a pixel when a small screen fits a large tree. The run moves
there only when that pocket is nearby and at most three quarters of the old
distance, and only if the change of pocket at either end of the run grows no
longer. No other plaque is allocated again, so a plaque within reach never moves
and none moves farther, and a plaque changes pocket only where the allocation
already changes it. A stage enters the schedule, and early delivery, only after
every remote run covering it has been decided; a requested stage that such a
run covers can therefore wait for later phases.

Reservations account for tree ink, trajectories, neutral connector stems and
already allocated claims. A control dependency is painted after fitting as a
dashed orthogonal elbow between measured labels; allocation reserves the same
elbow (`controlDependencyRoute`) from estimated labels in every scene that
paints it, and its runs keep the full plaque gap, as trajectories do. The nearest clear pocket search has no arbitrary radius
cutoff that sends an otherwise local plaque beneath the tree. The fixed nearby pockets usually keep slack, but
that search slides a plaque flush against what blocks it, and at the plain gap such plaques hugged their labels and
words (Francis, 23 October 2026: "some plaques are sitting / hugging very tightly to its terminal/node"). A pocket the
search finds is nudged, by up to twice `PLAQUE_SCAN_TEXT_EXTRA` (10 units) on each axis, to the nearest clear pocket
keeping that much more than the gap from category labels and words, if one is nearby and nearer than the prior pocket;
otherwise it stays. The second look's search keeps the same extra beyond its half margin. Fixed pockets, pocket
validity and carrying keep the plain gap, so no accepted pocket moves for the wider one. Later spelling
changes reserve the largest required box at first appearance. The planner is
memoized across Replay steps; it does not move branches, reveal future syntax or
alter relation timing. Transparent hulls are not obstacles.
Collection clearance considers horizontal as well as vertical pockets. Candidate
coordinates come from the existing curved path and opaque obstacles; each
candidate is checked before acceptance. This does not reroute the Orchard
connector. Source-label measurements and Case blockers are reused during the
search rather than rebuilt for every candidate.

The collision search removes repeated placement rectangles from future frames
and uses an immutable spatial index to reject distant obstacles before exact
intersection checks. Connector attachment exclusions retain their original ink
metadata. Rectangle queries traverse a prepared left-first branch list with
subtree skip indices. Cached branch bounds retain the exact original arithmetic;
leaf overlap, curve checks and predicate order remain unchanged. Curved queries
retain their recursive branch tests. This changes query overhead, not candidate
order, clearances or chosen placements.

Browser allocation waits for the category and plaque fonts, including
the record's script subsets and the generated theta-grid heading. Font loading
also includes generated chain-index glyphs before the first frame. It therefore
does not repeat the initial allocation or stall a later relation frame.
The normal semibold fallback-role face is requested from its shared style too:
binding an unrevealed relation can measure that face before its drawing appears.

Browser font collection probes an isolated input snapshot in yielding batches;
it must not compute coordinate reservations or allocate plaques. The layout
worker prepares both from those exact metrics. Its canvas ordinals are rebound
to the initiating input's original canvas objects only after checking current
input identity, measurement identity, stage coverage and finite node coordinates.
Painting and both camera bounds paths consume that result. A stale or incomplete
result fails without falling back to synchronous Replay planning. Cancelling an
analysis removes queued work or terminates its active worker. Layout workers run
one at a time within the page, including when the Orchard mounts all its cards.

The page retains its two most recently used layout results in memory. Reopening
still measures current fonts and requires an exact input and metric match.
Results store canvas ordinals, never another view's canvas identities, and pass
the same binding checks before display. Copies isolate each view from mutations
in a later view. Failed, cancelled or mismatched results cannot populate this
cache; a cache miss uses the ordinary worker. Nothing is written to browser or
server storage.

Within one layout job, obstacle indexes skip vertically disjoint ranges while
preserving collision order and arithmetic. Repeated horizontal trials can reuse
exact vertical-contact patterns within a bounded cache. Topology-only slot
witnesses and unchanged contour frames are reused, but each trial rereads its
current coordinates. Numeric obstacle hashes only select candidate buckets;
exact equality determines deduplication. These optimizations retain the chosen
geometry, candidate order and clearance rules. A contour materializes its copied
obstacles only when a parent or accepted plan consumes them. The deferred work
captures that contour's immutable members and children, so later accepted or
rejected trials cannot change its geometry. Candidate scoring can discard an
unused contour without allocating its complete obstacle array.

Short category labels are measured with the same text layout as wrapped labels;
clearance does not reserve a minimum 150-unit label width. Connector checks
subdivide the actual cubic against nearby ink, so empty corners of coarse sample
rectangles cannot reject clear pockets. Stroke margins remain reserved, and these
measurements do not change the rendered Orchard paths.

Near-aligned Case side attachments use both horizontal and vertical separation
to size their approach, capped at the existing 76-unit handle. They retain a
curved turn into the Case row instead of collapsing into a straight stem with a
tiny hook. Ordinary wide side approaches and vertical attachments retain their
accepted geometry; placement checks use the same curve as the painter.
Case rows beside the source label use its facing side as the origin, so the
arrow does not leave through a wrapped label below it. The source identity and
separate Case plaques remain unchanged; tree layout is not adjusted.

Dotted collectors sharing one exact source may leave the plaque's bottom or top
when that source is mostly below or above it. If the nearest attachment point is
blocked, an otherwise clear placement can use another point along the same edge.
Distinct feature rows reserve separate attachment points. The allocator verifies
each route through future frames and retains its plaque-local offset with the
feature row. Painting finds that port by the exact source and feature identity,
not a measured row height that can change when fonts load. Identical collector
paths within one plaque paint once while retaining all their claim owners.
Ports fit the narrowest shell in the claim's lifetime. Clearance
uses each stage's painted dimensions and row positions, including other plaques'
connector obstacles; the largest box still reserves space. A blocked vertical
route can still use the side.
Collectors with distinct sources retain their row-side associations, including
D6's Number and Gender paths. Curve handles, dash styling, ownership and reveal
timing remain shared with the existing drawing. Case plaques also reserve at least
two category-line heights between the arrow's source and target; collision
clearance alone must not reduce the shaft to an almost invisible fragment.
Allocation measures the arrow's source as the painter does: the native text box
of the source's word or category label in that scene, the union of its retained
label variants. Without label measurements it keeps the estimated box.

Allocation runs in a worker after chunked browser text measurement.

Reserved connector obstacles carry their precise cubic and stroke margin through
future-stage translations. A new plaque tests that same curve rather than the
empty corners of its bounding rectangle. Clearance is therefore independent of
which claim was allocated first, and an established plaque such as a theta grid
does not move when a later Case arrow appears.

Stability can require a more distant initial pocket in a dense changing tree. It
does not guarantee every connector remains short. Different overlapping claims
(for example an earlier Theme grid and a later Agent-plus-Theme grid) are not exact
duplicates; consolidating those inventories requires preserving ownership per row.

## Accepted Tier-3 role labels

Orchard cards paint Tier 3 with the production overlay; they supply records only
and have no separate painter. Allocation reserves every Tier-3 mark before the
stage's relation moments reveal it. The complete groups retain their automatic
Fit size and enlarge with manual zoom. Hover and emphasis use shared production
ink. Fission text stays inside its bundle through the existing measured text
wrapper, and literal values are preserved.

Tier-3 witnesses carry their authored role names as text, not circle or box
locators or backward triangles. List positions appear as `[1]`, `[2]`,
and so on; equal positions across paired lists retain their correspondence.
Two scalar witnesses have the accepted connector
below their subtrees, a scalar plus an array has a fan, and unpaired witnesses
have no invented links. Fan paths leave measured gaps around syntax and role
labels. Scalar connector stems use the same label clearance. A fan spoke whose
stroke would meet a visible plaque stops short of it on each side, leaving four
marker units of dark space beyond the spoke's shadow at every automatic Fit.
Spokes that only pass beside a plaque stay whole, and role labels do not move.
Attachment wins over plaque clearance: when the gap would separate a spoke from
either of its role labels, that plaque cuts the spoke only at its own edge, or
not at all if even its edge reaches the label. Repeated witnesses retain every authored role label; a fan does not draw
a spoke from a node to itself.

The existing Replay rows identify previous-stage references with
`role (previous stage): participant`. No triangle or extra panel section is
needed. Plain camelCase names receive conservative display spacing. The Replay
panel also spaces snake_case relation and role names, and Tier-3 tree role
labels and the Ordering rail caption space them the same way. Other
punctuation, single-letter notation such as `x_i`, non-Latin names and authored
record strings remain unchanged. Unavailable references and empty collections
have distinct readable descriptions.

Source/Landing descriptions use “specifier” and “complement” only when matching
authored X-bar levels establish them, independent of left/right branch order.
Other positions use node/parent descriptions without repeated identical labels.
The renderer does not infer a position from child order alone.

Complete role labels share the tree scale during manual zoom, preserving their
fitted size and stage-wide placement. The production painter and topology are
shared with every Orchard fallback card.

Tier-3 annotations appear only during their owning Replay relation moment. Earlier neutral claims remain available by
returning to their frame; they do not accumulate on later relation frames or the
Stage Record. Complete-stage inspection retains all claims. The plan still
reserves their geometry before reveal, so this visibility rule does not change
syntax layout, plaque placement or camera fitting. Tier 1 and Tier 2 retain
their existing persistence.

Replay allocates neutral-label clearance within each owning relation moment.
Labels and routes from other, mutually exclusive moments cannot displace the
current labels or cut holes in its fan. Positions are still computed before
reveal, and syntax and plaque obstacles remain reserved. Static inspection keeps
the combined allocation because its claims can be displayed together. Vertical
clearance uses label height rather than the width of the authored role name.

A role label takes the first free of its five preferred spots: after its
witness label in reading direction (right of it LTR, left of it RTL), before it,
above, above after and above before. When all five are taken,
it takes the nearest free spot on either side or in the rows above and below,
equal distances again going to the reading-direction side,
searched in steps of its own height out to twice its farthest preferred spot. A
free spot inside the fitted viewport comes first; when none is free inside it,
a label that could fit the viewport takes the free spot that leaves it least. If
nothing within that reach is free, the label takes the spot there that overlaps
least. It never covers its own witness label and never moves beyond that reach.

When a neutral role annotates a witness already enclosed by a phase-edge
outline, its placement reserves that outline's padding as well as the category
text. After all deferred relation marks are drawn, neutral role placement also
reserves measured relation text, filled plaques and the strokes of paths and
outlines in tree coordinates. Open outlines reserve their strokes, not their
empty interiors. Invisible hit targets and the neutral labels themselves do
not become obstacles. A review host hidden until the first render commits still
receives the same measurement as a visible host.

Only neutral label positions and their attached fans yield to these obstacles.
The tree, camera and established relation graphics remain fixed. Manual zoom
scales the complete groups together. Clearance remains limited by the available
space; this allocation is not a guarantee for every possible authored scene.

Identity illumination targets each actual displayed leaf of an occurrence,
including an authored wordless category witness. It never averages a phrase's
terminal positions into a light target between words. Target measurements follow
the displayed text through zoom and pan; illumination does not assign pronunciation.

Plaque placement reserves syntax, movement trajectories and the straight stems
of neutral links across the complete stage. Small plaques try measured nearby gaps when the usual pockets are blocked;
large plaques retain their below-subtree placement. A carried plaque keeps its
offset unless new stage geometry occupies it. Neutral lower connectors retain straight stems and separate lanes. Plaques
yield to their reserved stems; the lower lanes clear plaque bottoms. They also drop below tree text of
the stage that their turns or runs would cross, to the nearest gap within one tree row; where unrelated text
leaves no such gap, they keep their local floor rather than descend beneath it. Visible tree text is
painted in front of every neutral connector: a mask hides the connector only under the letters and their dark
outline, as movement curves pass behind labels. Role text
yields to the connector routes. These allocations precede relation reveal, so revealing a plaque
does not move existing syntax or annotations.

Role grids are horizontal tables: adding a longer role or another column must
not send an otherwise compact grid beneath its entire argument subtree. Grids
within the existing local height limit use the nearby predicate search at their
full measured width. Tall grids and other large text plaques retain the
below-subtree rule. Collision checks and lifetime reservations are unchanged.

## Extreme text overflow

Ordinary text plaques retain their accepted geometry and placement. Only content
exceeding forty row-font heights uses a twenty-row-font-height scroll viewport.
The entire stage reserves that viewport before any of its rows appear. All rows
remain in the authored record and SVG; wheel and keyboard input scroll the plaque
without changing the tree camera. Small/local and larger/below-subtree placement
continue to use the shared allocator. This exception does not introduce a reading
view or a new relation drawing. No silent row cap, hidden rows or relocation of
plaque values into Replay-only text is approved.

Tree Bank previews capture the visible portion at its correct bounds, with all
rows preserved in the saved analysis. A static thumbnail does not promise a full
print layout for extreme content.

The organizational Anchor rail includes its Orchard joining lines. A rail whose claim draws nothing but neutral marks keeps the recognized rail's lifetime instead of expiring with them: it joins the neutral role labels at its moment and numbers its own entries afterwards (Francis, 27 Oct 2026). A neutral role beside a recognized one still lends that role no lifetime. Bound geometry
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
their lower turn clears those endpoints and local plaques, not unrelated deeper syntax;
dependent rails remain below the deepest connector lane. Native Orchard paint
and the initial fitted appearance are unchanged.

Long category labels wrap at measured display width without abbreviating or
changing their characters. Combining sequences stay intact. Lines break between
words; a word that fits on a line stays whole even when that adds a line. A label
takes at most four lines, because a taller one pushes its sisters' row down: one
that would need more widens its lines, up to twice the normal width, when that
splits no more words. Wrapped categories
use the same multiline bounds for plaque obstacles and stage Fit. Native branch
geometry never depends on label height: a fork that no widening can clear of an
inner sister's wrapped label keeps its row and slots, and its branch crosses
that label. Category glyphs and their dark stroke
paint over branches without masking the surrounding multiline rectangle. The
incoming branch remains visible between and outside the glyphs. Short
labels preserve their existing bounds and native branches.
Wrapping does not change child order, tree spacing or the authored notation.

Plaque text wraps within its plaque's width without changing its characters.
Its lines break where category labels break, at a space or after a comma
first, then after a slash or hyphen joining two words or before an opening
bracket, and never before a colon, comma or closing mark: an overflowing one
hangs past the width, and the plaque widens to hold that line. Whitespace at a
break is the break itself, painted and measured on neither line, so a plaque
is as wide as its widest visible line. Only a word wider than a whole line
splits.

Manual zoom and pan persist across Replay frames. Fit clears that manual choice
and restores automatic stage framing. Programmatic camera updates never become
manual input, even while D3 still carries the source event of an unfinished wheel
gesture. One zoom dispatcher remains attached to the current tree group across
redraws. These lifecycle rules do not change tree layout or the stage-fit math.

A canvas resize leaves the painted tree untouched until the size has stayed
unchanged for 120 ms. One redraw then refits the camera without animation.
Automatic framing fits the new viewport. A manual camera keeps its scale and
viewport centre. Manual poses are recorded and restored against the SVG's own
size, which changes before a held frame is redrawn. Before the first painted
frame, sizes apply at once.
Replay and Canopy layout read no window size. Every canvas lays out at one
1600×948 reference canvas, so an analysis draws the same tree in every window and
on every device, and a resize reuses the prepared coordinates and plaques. If a layout key ever changes with
the viewport, the earlier frame stays on screen with its own viewport until the
new layout is ready, and the swap is one redraw. The offline visual audit reports
`layout-width` when any audited viewport lays out a Replay frame or the Canopy
differently from the first one, beyond one translation per stage.
`verify:visual-offline` compares the two desktop sizes;
`tests/visualInvariants.test.mjs` compares mobile and proves that text measured
wider at one viewport is reported. The layout cover belongs to opening and
non-viewport changes. Until the settled viewport is drawn, the tree carries
`data-babel-viewport-pending` and capture readiness waits for it to clear.

## Replay preparation

The compiled relation contract is in `replay/relations/renderPlan.ts`; claim
recognition and recipe eligibility are separate from family plan compilation.
Each family plan module lowers both registered and structurally recovered claims.
`planPersistence.ts` and `planCoalescence.ts` apply lifetime and composition;
`relationFrame.ts` projects marks using exact played relation identities.

`boundGeometry.ts` holds the DOM-free geometry contract. `geometryBinding.ts`
orchestrates typed path, region, annotation and neutral handlers.
`geometryContext.ts` owns allocation state and its per-item rollback together.
Composition and geometry consume the compiled contract without importing its
compiler. `replay/types.ts` holds the shared derived Replay contract.

`replayCompiler.ts` orchestrates stage preparation, construction and relation
scheduling. The current stage is explicit input to finalization; the preceding
stage cursor advances afterwards. Canvas projection, movement transitions,
layout, visibility and presentation have independent owners. Workspace placement
separates attachment proposals and search from rendered-plan validation.

Relation moments follow authored order with one exception, because Babel must
not limit how a model orders the claims of one stage. A relation needing syntax that a later relation of its stage introduces plays right
after that relation's moment, or after the last such moment when it needs
several. Its needs are its current anchors (for a movement, its source and
landing) and, for a relation that builds structure, the material its new
landing host or parent attaches to, followed through the construction that
builds them. A movement also needs the parent each landing joins when another
relation's moment introduces it, so a landing never appears without its
parent. A movement does not wait for its other, contextual anchors. The
introducing relation may be a recognized movement, a neutral transition or
another rewrite; its tier does not change the order. Relations waiting for the same moment keep authored order, a
chain of needs resolves in turn, and every other relation keeps its authored
position. A construction step already under way, which may build what the
waiting relation needs, completes first. `replay/relationMomentOrder.ts` computes
the order once per stage, and `stageScheduling.ts` plays it without introducing
syntax early. Needs that form a cycle cannot all be met: the cycle's members keep
authored order among themselves, a relation needing a member keeps its authored
position relative to it, and Replay reports the unavailable syntax as
`RELATION_TIMING_CONFLICT`. A realization that plays after a movement still owns
the later pronunciation of that movement's landing. The authored record, the
relation plan and each relation's marks are unchanged; only the order of moments
within the stage differs.

`TreeVisualizer.tsx` connects React state with `components/renderer/treeFrame.ts`,
which owns frame drawing order and disposal. `relationScene.ts` binds the plan
and dispatches family painters; `frameCamera.ts` owns fitting and retained pose.
Initial geometry supports painting and fit. `relationRefinements.ts` then routes
rendered-label measurements to binding, plaque and trajectory refinements, which
own the final label-dependent positions. `fallbackDrawing.ts` owns neutral-mark
measurement, placement and its final ink-obstacle pass.
Painter tests import these owners directly; native browser checks remain necessary
for fonts, pixels, camera behavior and motion. None of these ownership boundaries
changes relation tiers, persistence, authored fields or playback order.

`replay/prepareReplay.ts` assembles the existing Replay compiler and relation plan
without React or DOM access. The application invokes it through a dedicated worker
before mounting `TreeVisualizer`. Archived reviews use the same asynchronous
wrapper. Standalone build tooling embeds the existing worker entry points as blob
workers; the app's Vite build emits worker assets. Orchard fixtures may still
prepare Replay directly, but use the same worker for plaque allocation. Neither
path has separate linguistic or scheduling rules.

Stage coordinates reserve the full contour of a source subtree before movement,
including branches that its later compact copy no longer contains. The reservation
uses actual constituent order and one spacing transform for the stage. A hidden
future parent may reserve ordered slots without becoming visible or changing a
current branch. Independent workspace objects do not establish sibling-order
constraints. Camera bounds, plaque allocation and painting use these same
coordinates. A new authored stage can require a new reservation; its subsequent
micro-steps keep unchanged syntax stationary.

Retentions move only their own members, so a sister placed against another layout
can end up under them. Ordered direct daughters do not prevent this; a one-word
specifier's word leaf occupies the row of a lower specifier. After planning, each
painted frame is checked for sister subtrees that interleave on a shared row. If
none do, the established plan stands. Otherwise Replay plans once more with that
check applied to two passes. The stage-local retention of a waiting workspace keeps
its stage's own layout, and each attachment lifetime ends before the first scene
its members would interleave. Coherent solving, component lifetimes, root
compaction and movement-source slots are unchanged. The second plan is used only
if every frame is then ordered, and the outcome is recorded per layout.

The repair trades interleaving for motion. The second plan is accepted on contour
order alone; it is not compared with the established plan for motion or ink
clearance. Ending a lifetime early lets the lower occurrence take its compact slot
at its own movement moment, and its ancestors recentre over it. In the committed
Hindi correlative, the trace rD0 moves 412.5 units and rD1 787.5 units at their
movement moments, with their ancestors following by half and a quarter of that.
No syntax outside those movements moves. The row matching relies on the shared
220-unit row grid, which the regression suite checks for every committed fixture.

A previously selected standalone head can build the receiving projection needed
by an earlier movement before a later relation adjoins another head to it. The
later adjunction owns its complex head and lower occurrence, not the earlier
receiving projection. A complete moving head carries its unchanged ordered
members at the same moment. A later chain description of one carried member
keeps its own relation drawing but cannot withhold that member or introduce its
trace early. This requires exact prior and current head assemblies and an
unchanged lower witness in the same parent and child slot.

The same receiving-context rule applies to nested phrasal movements. When an
earlier movement needs a new projection that will later receive another landing,
Replay first builds that projection from its available child. The later landing
and its lower occurrence still appear together at their own relation moment.
This keeps the earlier landing attached without exposing the later movement.

Canvases in one stage share a vertical rank unit before retaining coordinates.
A movement that changes canvas depth must not mix two D3 height scales across
current siblings. Ordinary equal-depth stages retain their existing geometry.
When a stage starts with a relation elsewhere, an unchanged independent workspace
awaiting a later attachment retains its completed component coordinates. Its new
surrounding parents are centered at their actual construction steps. This applies
only when every current branch remains valid, and does not change camera fitting.

Each stage lays out its own forest, so unchanged sisters may slide sideways when a
stage begins, for example into the gap a raised subject leaves. That reflow is
accepted product behavior; it is not a teleport. A lower occurrence is drawn where
the authored tree places it and need not stay within its source's earlier
horizontal span.

An ordinary construction boundary can also resize or reorder completed workspace
objects. Reserve their first attachment positions through their earlier scenes.
Compose that reservation backwards through prior movement, keeping the source
inside its current parent until its authored movement. If the attachment's compact
copies leave insufficient room for that earlier form, retain the component's own
shape through its first attachment stage. Validate complete lifetimes against
labels, words, native branches and adjacent-frame continuity. Reject new overlaps,
invalid branches, increased construction displacement or a new displacement of
previously stationary syntax. Preserve the established placement when neither
reservation is valid. Future syntax remains invisible.

If those stage reservations still move an unchanged independent root or deform
an identical subtree at any adjacent Replay boundary, plan the complete visible
subtrees across Replay together. Compare complete visible material and ordered
children; rigid translation does not count as internal deformation. Each material subtree keeps
one internal contour throughout its lifetime. Exact temporal witnesses bind
unchanged syntax to the same positions; only the current construction or
movement can authorize a translation. A pronunciation or spelling change alone
does not authorize movement. Accept the replacement only as a complete plan,
after the renderer reproduces its coordinates and passes current rank, order
and clearance checks. Incoming fork branches must also clear the other
children's label envelopes. Keep the prior plan and an infeasibility diagnostic
when those constraints cannot be satisfied. Already stable plans remain intact.

Syntax stands from its first frame where it will be once attached. A waiting
workspace or a newly selected head appears at its attachment slot and keeps it
until its own merge, which then moves nothing already on screen. A piece that
attaches through a parent inserted above an existing host waits at its final x
and on its final row, one row below that host's current row, so the insertion
lowers only the host. A slot holds only while every
painted member keeps the parent it attaches with, every frame stays valid and
no ink collision is added. Placements that span stages use stage frames
translated, as a whole, by the median shift of the unmoved syntax they share
with the next stage, as the camera carry does, with the completed stage as the
anchor. A plan that still shows motion is replaced by such a plan only when it
removes motion, adds none, moves no join farther and keeps the final tree, or,
within stages, when no painted node moves farther. One translation of the whole
final tree is the same tree, since the stage camera fits it. A daughter that
keeps its painted parent stays one row below it, so when the step owning that
parent moves it to another row, the daughter's own motion is what remains.

A later locked fork may require more clearance than its earlier incarnation
reserved. Carry that measured requirement back only through the same ordered
children to a fork with a free separating side. Adjust that earlier preference,
then revalidate the complete plan; never move a locked later child to make room.
Apply its deficit to the realized child gap, which may already exceed the stored
preference. Repeatedly adding that deficit to a smaller preference can leave the
actual geometry unchanged and exhaust the correction budget.
Bounded correction failure keeps the accepted coordinates. A new unary Project
can attach its exact unchanged source at the same prior parent slot. Extraction
can likewise translate the unique remaining host at that slot when it contains
the authored source before movement and the lower witness afterward. Neither
rule releases an unrelated branch or changes a retained subtree's internal shape.
Movement ownership permits translation; it does not require it. Preserve an
already stationary component across an owned boundary when the mandatory pose
equations and clearance throughout its lifetime permit that placement. Reject an
optional stationary tie without changing the required equations when it would
create a collision. The same preference applies to unchanged receiving material
outside the actual source, lower occurrence, and landing. An independent input
to ordinary External Merge can wait at its eventual attachment position, or the
nearest clear position if an exact tie conflicts with earlier visible material.
For a retained host under a new ordinary wrapper, reserve its eventual horizontal
position on the preceding current row. Inserting the new parent may lower the
host by one rank; it must not send the host sideways to the wrapper's center.
If the accepted layout already keeps a distinct lower
witness at the source's attachment point, retain that position when the current
trajectory replaces the source in the same connected, ordered parent slot.
Measure this at the actual boundary, not from a later preferred pose. Its
descendants retain their own authored structure.
Use the compiler's proved source, lower occurrence and landing to authorize
movement, including a neutral drawing whose syntactic transition is established.
An exact newly inserted wrapper can attach its retained host through connected
new unary ancestors to the binary receiver. Stop at an existing ancestor or a
different ordered slot; the relation's name alone never grants motion.
Outside current movement ownership, a topology-stable category, word or silence
update keeps its existing point constraints. Adding or removing a generated word
terminal also keeps its exact retained head stationary when its connected parent,
category and silence are unchanged. Require the terminal's current owner
provenance and matching authored word; an authored child or alias is insufficient.
A shell containing an owned changing
child can recenter while its unrelated descendants remain fixed. A new wrapper
under the current movement may inherit the old fork's
child slots only when it takes that complete ordered list of unchanged children,
retains the fork's own material, and contains the authored lower witness while
its sister is the current landing. The two material lifetimes remain distinct.

Refinement of a feasible plan only chooses visual proportions. Stop that search
when every point shifts horizontally by at most one percent of its final root's
previous width, measured relative to that root, every local edge and sibling gap
stays within ten percent, and relative vertical positions are unchanged. A small
tree inside a large forest gets its own budget.
When current-rank repair has already corrected legacy vertical positions,
horizontal refinement may instead retain that complete native composition's
relative heights. Require a copied reference for every frame, exact ordered
topology and material lifetimes, complete finite coordinates, and full renderer
validation before stopping. A rejected rendering continues the existing search
and retained-plan fallback. The horizontal limits remain unchanged.
Zero spans and edge direction must be preserved. These limits never relax
temporal, syntax or collision constraints.
Rank feasible candidates by their worst normalized local, root-displacement and
width deviation before aggregate displacement. Every root retains its own width
and displacement guards. A contraction blocked by a measured contact may pair
with contraction of that contact's free fork, within the same bounded search.
Retain necessary space when narrowing it would cross a current branch or label
at any earlier frame, even if the finished tree alone could be narrower.
An expanded completed-stage fork that ends at a proved movement may receive a
bounded earlier-stage refinement after the final-frame search. Its own current
children define the reference span. Accept a reduction only if no completed root
or forest widens, no completed-stage edge or sibling gap moves farther from its
own reference, and the final contour and relative root placement stay unchanged.
The candidate still passes the shared continuity and paint-clearance checks.
Retain remaining space when further contraction would worsen another stage.
When movement or ordinary merge inserts a new parent around an unchanged
receiving component, the component may occupy that parent's outer attachment
slot beforehand.
Recover the replaced child slot through the same structural proof used for
movement ownership, regardless of whether the receiver is a leaf, unary chain,
or branching compound. Ordinary merge requires a new wrapper with its complete
current source list, exactly one retained child in the replaced parent slot,
and detached remaining inputs. Relation names grant no layout permission.
Carry one rigid translation through its compatible construction lifetime;
introduce the new parent and daughters only at their owning step.
Settle movement source and receiving slots together before following ordinary
and movement wrappers backward. Later wrappers cannot undo an accepted movement
contraction. A peer containing the current movement source may recenter over
its authored lower occurrence; unrelated peers must retain their positions.
Accept the placement only when current ink remains clear, unrelated components
stay stationary, and no earlier completed workspace widens. Check both node spans
and measured painted bounds for each root and the whole forest; a long word can
extend beyond stationary outer nodes. Source-containing
hosts retain their own contour rule. Authored syntax and later geometry remain
unchanged.
Packing uses immutable obstacle pairs. Separation-only checks defer contact
lists. A vertical index skips only obstacles that end before the current one;
exact contact checks reject disjoint scalar bounds before copying curves.
Sampled rectangles keep their shared curve through each rigid translation,
without retaining geometry across calls. Contact order, arithmetic and collision
tolerances stay unchanged.

A successful composition may certify that every child slot of a fork is locked.
Direct gap trials can then reject an X-only preference change without composing
the same geometry again. Compare all consumed inputs with copied values from
that accepted composition, and require unchanged roots, heights and preceding
dependencies. Preserve the evaluation count and ordinary equal-score rejection;
do not skip seed or paired-clearance trials, or alter the composer's cached state.

Vertical rank inheritance requires the complete current children and a current
native row, or a same-material parent identity. A future wrapper cannot lend its
height to today's branch. Plain single-font labels use the exact displayed
string's glyph ascent and descent at each painted baseline, retaining the full
stroke-miter reach and existing horizontal SVG envelope. Styled indices and
unavailable glyph metrics retain the full SVG envelope. The worker receives the
same complete measured bounds; it does not substitute raw authored text for the
displayed label.

When a root gains a specifier and an inserted parent takes over its complete
ordered daughter list, the earlier root keeps that fork's height until insertion.
Its daughters remain stationary. Apply this only to visible component roots,
an unseen successor fork, and consistent retained daughter offsets. An internal
parent must not borrow this position: doing so would change its incoming branch
or its spacing from sisters. Stage and cross-stage reservations use the same rule.

Automatic camera changes between adjacent Replay steps interpolate over 360 ms.
They start at the currently painted transform, can be interrupted by another step,
and yield immediately to manual pan or zoom. Reduced-motion preferences use an
immediate fit. Structural micro-steps still share one authored-stage fit. Only the
completed last Stage Record releases earlier source-position bounds and fits the
finished drawing; Fit uses those same final bounds. This does not compact or
recenter the tree's internal coordinates.
Forward playback also retains an already fitting view when a new stage could
merely zoom in. Actual overflow can still pan or reduce scale. A retained view
that would leave the new stage lopsided on an axis it does not pan, with a
quarter of the view more empty on one side of it than on the other, gives way
to that stage's own fit. Prev within the
same stage keeps that stage's current view rather than refitting, so a stage
keeps one camera in both directions. Each stage lays
out its syntax in its own coordinates, so a step into another stage translates
both that view and the animation's starting pose by the median coordinate shift
of the shared syntax whose shared ancestors are unchanged. This removes the
common translation between the two layouts; residual layout changes still move,
and a reattached constituent appears at its new place. Explicit Fit, nonadjacent
frame selection, Prev into an earlier stage and the completed last Stage Record,
including Prev out of it, retain their existing fitting behavior.
Stage framing retains its existing margins for ordinary labels. When a revealed
label exceeds those margins, expand the shared stage envelope by only that
excess, using the same styled text bounds as layout. Include every revealed
label variant across the stage without reserving never-visible future syntax.

Detached morphology panels retain a clear preferred position. If that position
covers the tree, choose the nearest available position inside the space between
the Replay header and controls. Move the complete panel in one coordinate group;
do not resize its contents or change syntax coordinates to make room.
During an automatic camera transition, resolve that placement against the
destination fit. The panel then travels with the tree without being repositioned
from an intermediate screen transform. Retained manual framing uses its own pose.

After the stage contour pass, independent final workspace components receive
one rigid translation each when their visible ink collides. The clearance
constraint covers every scene in that stage. Membership must follow one unique
final component; ambiguous earlier components retain their original layout.
This does not change internal branches, syntax visibility or camera fitting.

A binding ellipse must enclose its authored domain without capturing excluded
syntax. Keep the accepted ellipse when its existing boundary is correct. If it
includes outside node labels, fit the actual member ink and inside owned plaques
and accept the tighter ellipse only if every excluded label remains outside.
For a valid constrained enclosure, choose the horizontal center and radius
together from the actual ink corners. The smallest feasible radius avoids
compensating for the reduced height with empty side margins. Keep the existing
constrained ellipse if shifting its center would include excluded syntax.
Camera bounds and both renderer measurement phases use this same geometry.
Include the normal font envelope alongside browser glyph bounds. At a tiny
initial fit, a browser may report a shorter glyph box that grows after zoom;
the enclosure must reserve that full height without changing its authored domain.

After fonts are ready, browser text measurements are captured in chunks that yield
between stages. A second worker receives these exact metrics and allocates plaques
across their compatible geometry phases. The serializable job uses the same
allocator as the direct path, with no approximated replacement font metrics.
The job snapshots its serializable input and native text metrics. Coordinate
planning remains in the worker. A completed result can be rebound only to its
still-current measured input and original canvas identities. The bounded recent
result cache follows the same checks after fresh font measurement; it never
supplies another input's coordinates or relaxes allocation checks.
Missing measurements fail visibly. Input changes, retries and unmounting cancel
obsolete jobs; stale results cannot supply placements for another input. A
layout request pairs one immutable content revision with a viewport. When only
the viewport changes, the last displayed result of that revision stays on screen
with its own viewport until the new request covers the displayed camera group.
Progress for another group does not replace it, and it never positions the new
viewport.

The tree waits for this allocation before revealing its first complete drawing.
The rendered-frame receipt is written only after the full D3 drawing completes;
slider updates and the intermediate loading view do not count as readiness.

Each preparation owns one worker. Completion, failure, view changes and unmounting
release it; stale results cannot mount a previous analysis. A failed preparation
shows a retryable view error and leaves the authored record intact. The camera
choice survives preparation when switching between Canopy and Replay. Display-only
changes such as glyphing do not prepare the same Replay again.

Preparation reuses the parse animation's loading mark at a smaller size. It stays
invisible for 200 ms, so quick preparations do not flash an indicator; completion
never waits for the animation. Screen readers receive a status immediately, and
reduced-motion preferences disable the spinning and pulsing decoration.
Preparation and layout show no written loading messages. The existing loading
mark supplies feedback; the layout cover remains blank until the tree is ready.
Actual preparation failures retain their error message and Retry control.

The workers remove compilation and plaque allocation from the app's UI thread,
not their CPU cost. Message transfer, font measurement and D3 layout/painting still
involve the UI thread. There is no persistent
cache, worker pool, automatic provider retry or change to JSON processing. Canopy
preparation includes the Replay steps and waits for their layout, since the Canopy
paints the last Replay frame's places; each view still prepares when it mounts.

Within one compilation, interpreted stage relations are reused when constructing
cumulative links. Links still resolve against their current forest and relation
limit. Tree lookups for casing and visible-token accounting are local to one
canvas. They preserve first-preorder ID/alias resolution, inherited flags and
existing count rules. Subtree continuity signatures are built bottom-up once per
canvas. Future-layout candidates retain the same chronological eligibility and
stopping rules; only their construction is deferred, newest first, until the last
valid candidate is found. Each candidate retains its own allowed occurrence IDs.
These caches remain local to one compilation and preserve the serialized result.

On the reference bundled runtime at a 1600px desktop viewport, a usable Replay
should open within 2 seconds, and ordinary rendered frame changes should stay
below 100 ms at the 95th percentile.

An extreme 96-stage left- or right-nested derivation still exceeds the 2-second
target in preparation alone, before browser allocation and drawing. The worker
keeps the interface available while this work completes.

Plaque allocation also reuses a request's sorted obstacle intervals and a future
scene's row-visibility answers. Curve sampling and candidate expansion preserve
their arithmetic and first-occurrence order while avoiding temporary arrays.

Replay preparation shares one ordered relation resolver between its final links,
movement-chain catalogue and playback construction. The resolver belongs to one
immutable preparation request; independent calls still resolve their own input.
This removes duplicate claim recovery without caching across analyses or changing
recognition, relation order, or the prepared Replay output.

Realization changes appear at a relation moment only when its exact current and
prior references uniquely cover the change. Complete direct coverage takes
precedence over continuity inferred through a movement's containing domains.
Realization ownership follows recovered claims, not participant overlap alone.
An exact recovered PF output takes precedence over bare shared-node coverage,
including unknown participant roles and wholly neutral Tier-3 claims. This does
not promote, consume or reorder those claims. Without a validated owner, multiple
coverage-only candidates remain ambiguous, unless exactly one of them states the
realized text of every new group in a value (caseless, as the spelling check
compares), whatever its names. That relation owns the change when its anchors
lie within the groups, its authored outcome is established, its values spell no other
input, any PF output it recovers is the group, and no other candidate asserts a
realization of its own. Output and association domains must
have exactly the same uniquely resolved leaves; a group can name a complete
head or its contributors, including redundant enclosing output anchors.
Neutral descriptive values remain in their residual claim. A conditioner of a
different recovered PF output remains context only for that output.
An explicit input sequence must match the actual input tokens at the declared
positions before it can distinguish token association from a separate spelling
rewrite. It does not override another PF association, an explicit unsupported
PF assertion or a malformed exact claim.
A pronunciation transfer can have its own later relation moment when
exact pronounced/unpronounced anchors, lineage and authored pronunciation states
prove ownership; movement and pronunciation remain separate operations.

A realization group whose sentence text its pronounced leaves do not spell, by
the spelling check's caseless comparison, is drawn with the PF realization
plate: one literal row, its contributors' words rewritten as the realized text
(`do → did`), sized to that text (`replay/realizationDisplay.ts`). It is anchored
on the pronounced contributors (the group's occurrences when none is pronounced)
and attaches at the word itself when its anchor holds one; it chooses its pocket
after every relation's plaque, so it never displaces one. The plate
shows exactly while Replay holds the group active (below), and in the Canopy for
the final stage; it never first appears at a Stage Record. The relation whose
moment shows it focuses it. A relation's own realization, spell-out or
correspondence plate on the same syntax that already shows the text, in one
value or across one label's rows, draws instead.

Replay makes a realization change active at a relation moment, never at the
Stage Record (`scheduleRealizationChanges` in `replay/realizationReplay.ts`):
its owner's moment; with several covering relations and no owner, the latest
covering relation's moment, when all of them have played; with no covering
relation, the stage's last relation moment. A change whose syntax is not yet
displayed at that moment waits for the stage's next one. A stage without
relation moments has no moment to show its changes: they appear from the next
stage (`REALIZATION_NO_MOMENT`), and no moment is invented; such a plate has no
relation (`UNOWNED_RELATION_INDEX`).

An unchanged enclosing rewrite domain is context only when its changed terminals are proved
rewrite outputs and every other terminal is an explicit unchanged conditioner.
These proofs do not consume an independent PF or input-association assertion.
A scalar `inputAssociation` can be proved disjoint from another change only
when its entire value matches `<word> corresponds collectively to <piece> and
<piece> ...`, corroborated by one unique recovered PF output occurrence and its
sole authored realization group. The consecutive input positions must supply
the exact ordered pieces, whose concatenation equals the current terminal word.
Repeated forms, overlapping mappings, missing tokens, extra prose, and competing
claims retain ambiguity. Both previous and current changed groups must be
disjoint in occurrence IDs and token positions. This bounds only the assertion's
scope; it grants no new owner or priority and preserves the original residual
text. No particular script, sentence, relation index, or occurrence ID is special.

A scalar `pronunciation` assertion stating only `lower [complex] head suppressed`,
`lower [complex] V suppressed`, `lower copy suppressed` or `lower occurrence
suppressed` can be scoped to a supported movement's exact lower occurrence.
That occurrence must be authored silent, and both its current and prior domains
must resolve uniquely. They must be disjoint from the respective current and
prior association contributor domains. Head assertions require head movement;
complex-head assertions require a source with children. This excludes lower-copy
suppression from ownership of a separate higher-head word association, while
retaining the literal in its neutral claim. Negated, conditional, mixed or list
assertions, unavailable silence, duplicate occurrences and associations retiring
the lower copy remain competing claims. No silence or token association is inferred.

When no relation directly names the complete change, a proved phrase movement
can carry renamed descendant associations through its exact source and landing.
Their ordered content and topology must be unchanged, with unique correspondence
and no contradictory lineage. Similar words elsewhere, changed content and
indistinguishable unproved siblings are insufficient. Unsupported ownership and
multiple PF owners retain their ambiguity. Replay retains the earlier association until
the latest covering relation's moment and shows the completed association there.
It does not guess ownership from open prose, relation names or linguistic expectations.
Diagnostics list the candidate relation numbers. A direct owner waits for the
moment that introduces its participants; one whose participants are still not
visible at its moment waits for the stage's next relation moment without handing
ownership to it. The Japanese stem/allomorph and
orthographic-association regression exercises competing direct coverage without
changing the authored structure or pronunciation.

## Movement witnesses, construction and marks

Head adjunction keeps its original terminal attachment in its first movement
instance. The enclosing head complex identifies its landing position without
redirecting the arrow to that complex's label. If a later authored head movement
takes that exact complex as its prior source, the earlier arrow retains the intermediate
position through that movement's exact lower witness. This switch occurs at the
later relation moment, never at an earlier structural micro-step. Plain terminal
landings and phrasal movements retain their existing attachment rules.

Terminal attachment follows authored lexical material, not the spelling of its
label or word. An authored word such as `I` remains a terminal even when its
spelling also names a category. Geometry estimates, painting and measurement use
the same node-aware decision.

When the exact departure witness is a wordless leaf or subtree, the arrow attaches
to that anchored occurrence's displayed category label. Its semantic source stays
the complete moved object. Geometry binding and later refinement use the same
departure occurrence; neither searches for another terminal or substitutes an
enclosing phrase. A retained head landing that becomes compound uses that exact
head's label, following the existing compound-head attachment rule. Missing
anchors and ambiguous multi-terminal phrase endpoints remain undrawn.

The same exact replacement rule preserves earlier phrasal movement and Case
marks when a later movement leaves an authored lower witness. Before that
movement, those marks still bind to the preceding occurrence. Afterward, they
bind to its lower witness, preserving the intermediate position and original
claim ownership. A missing anchor without a unique explicit replacement still
ends the mark's persistence.

Plaque measurement, obstacle reservation, allocation and painting use the same
Replay-moment occurrence. A pending replacement cannot allocate against the
future lower witness. The exact replacement moment ends that geometry phase
even when the witness has the preceding occurrence's coordinates. Rewinding
restores the earlier occurrence and its reserved plaque.

An earlier trajectory retains its landing position even when the moving phrase
keeps the same occurrence ID at the next landing. Its endpoint transfers to the
exact lower witness at that next movement moment; rewind restores the preceding
endpoint. Other surviving marks continue to reference their own occurrences.
Descriptions sharing one movement curve retain that sharing through the same
endpoint transfer, with all contributing authored claims preserved.

A movement can own a realization change on descendants of its exact source and
landing when no relation directly covers the complete change. The complete old and new groups must cover the same input tokens,
and their members must pair uniquely by exact ID or explicit lineage within
those two movement domains. Apply that group change at the movement moment.
Competing inferred owners still wait for the latest of their moments. Neither silence nor relation
prose establishes this association.

An existing empty head position can receive newly introduced source-linked
material. Keep the position's preceding authored content until that movement;
an existing target ID alone does not mean the movement has already happened.

At that moment, the proven receiving container takes its current own label and
silence state. This does not transfer ownership of its other children or later
realization claims. A later exact realization owner still controls that
container's word and token metadata.

A movement envelope may also contain contextual claims. If a current contextual
anchor is introduced only by a later relation, report the timing conflict while
preserving the independently proved movement and its moment: a movement does not
wait for context, since waiting can cost a later landing its reserved slot and
shift unmoved syntax. Do not reveal that
context early or delay valid sibling claims. Prior-stage witnesses remain prior
evidence and need not be present in the current drawing.

Restoring a prior source also restores its effective pronunciation before its
owning moment, including silence inherited from its preceding ancestors. A
display-only boundary on that exact source prevents current ancestor silence
from dimming it prematurely. Its descendants retain their own authored silence;
current ancestors and sibling occurrences keep their current fields. The
boundary ends when that source's relation becomes active.

Ordinary construction applies to the complete workspace forest. Introducing a
new root cannot skip ready selections, projections or binary merges inside a
retained root. An unrelated pending rewrite cannot withhold ordinary merges
whose preceding operands are already available. Pending relation-owned outputs
and relocations retain their own timing.

A neutral claim that names an earlier phrase in `priorAnchors` and a new parent
of it in `anchors` restates that phrase; the new parent alone does not make the
claim its owner. When that parent takes over the phrase's own slot and is the
only new or changed material there apart from what the stage's recovered
movements own at their moments (its other daughters are earlier workspaces that
join whole and unchanged, no claim that can own a change names that material,
its earlier form or an ancestor, and everything else the claim names is earlier
material unchanged under its earlier parent), ordinary construction builds it
with its own External Merge before the claim's moment, which then adds only the
claim's marks. Anything else keeps the claim's atomic rewrite. A movement's
landing parent inside the phrase is then the movement's, and arrives at its
moment.

The model may give the new id to either node around a movement's new landing
parent. When the landing's parent keeps its preceding id, the new node is the
landing's only sister and holds that parent's earlier daughters in order. Each
slot holds the earlier daughter itself or a node new in the stage that contains
it, such as the complex another movement of the stage forms there. That sister
gets no construction step. Until the movement, the kept parent shows its
daughters as the stage has changed them so far, and the movement moment inserts
the sister together with the landing, the lower occurrence and the trajectory.
When the sister's daughters come from another relation's moment, the movement
waits for that moment.

A new occurrence replacing another chain member in the same retained parent
slot is that member's lower witness. A later chain description must not use it
as a fresh landing and postpone its appearance. For an actual chain extension,
the uniquely anchored replacement of the explicit preceding source identifies
the active lower occurrence; unchanged earlier members remain separate evidence.
An operator contained inside an explicitly identified higher occurrence does
not compete with that occurrence as the movement endpoint.

A proved movement passes its exact recovered source, landing and witness into
Replay even when the source is named only in `priorAnchors`. Each recovered
endpoint must still identify one current occurrence. This handoff preserves the
authored anchor blocks; it does not add guessed anchors or bypass drawing eligibility.

Detached workspace objects reserve their first attachment independently. A later
wrapper around one object must not strand other, still-detached objects in
temporary layout positions. Lookahead may contract that later wrapper in its
invisible layout copy, preserving the first parent slot and sibling order.
Relocation outside that slot ends lookahead. Authored syntax remains unchanged,
and every future parent stays hidden until its own Replay step.

A reserved component's outside slot is independent of head order inside it.
Internal rearrangement must not put an unrelated detached root on the opposite
side. This lookup requires unique component identities and retention of all
current material within each component until its first attachment; a split or
ambiguous component cannot supply an earlier slot. Reorder only synthetic
workspace children, preserving authored syntax and current branch heights.

Copy-junction circles and their hit targets share one marker coordinate group.
Read the fitted camera scale when deferred drawing runs, then use the shared
zoom handler and existing scale cap. Previous navigation or zoom state must not
change the marker size at the same final camera.

Plaque allocation reserves the existing predication connector segments across
compatible Replay scenes. The painter and planner share the unchanged elbow
calculation; label variants expand the reservation, not the line. A plaque
collision changes the plaque pocket, never the connector path or syntax layout.
The selected pocket persists until its existing attachment-lifetime rules permit
a change.
