# Tier-2 Shape Dispatch

Status: verified implementation. The provider-free repository gate and the
69-primitive Tier-1/Tier-2 visual audit passed on 2026-08-25.

## Purpose

Tier 2 renders complete generic visual facets from model-authored relation
structure when the relation name has no exact Tier-1 registration. It uses the
same production primitives as Tier 1. Tier 3 remains the neutral fallback.

The 69 vocabulary entries are visual primitives, not relation identities. One
complete facet recipe may emit several pieces. A structural condition may
select one geometry variant, such as a curve, orthogonal route, or
cross-workspace crest.

The complete executable facet catalog is
`replay/relations/tier2FacetRecipes.ts`. The deterministic vocabulary is
`replay/relations/tier2Synonyms.ts`.

## Shared role interpretation

Production registry version 14 binds recognized equivalent role wording before
checking a Tier-1 signature. `productionRoleConcepts.js` assigns the meaning of
each declared role within its owning recipe; `roleBinding.js` uses the shared
vocabulary, not a second alias list. Exact role spellings take precedence.
Ambiguous meanings and conflicting references produce explicit signature
diagnostics, never a first-match choice. Cardinality, required groups and paired
lengths still apply. Production recipes retain additional authored roles as
context; they do not satisfy missing required roles. Independent complete claims
may consume that context. Unrecovered anchors retain neutral Tier-3 marks and an
`unrecovered-evidence` diagnostic. They do not affect the Tier-1 claim's identity,
replacement group or backward witnesses. Custom closed registries may still
reject additional roles.
In deliberately open blocks, an ambiguous synonym or one competing with an
explicit slot remains an untouched open role. It cannot fill a missing required
slot by guesswork. Conflicting explicit spellings of a declared slot still fail.

The original relation and literal displays retain the authored record.
`primaryRelation` contains only the primary claim's evidence after independent
claims and residual anchors are separated.
`boundPrimaryRelation` supplies lookup keys to the drawing and companion
composition. Replay uses that same binding for an accepted Tier-1 claim and
retains the authored wording for display. Unknown relation names do not become
Tier 1 merely because their roles are familiar.

Drawing value slots use that same binder and shared value vocabulary. Prepared
keys supply scalar labels and native plaque content; verbatim rows and relation
records keep authored keys, ordering and literals. Drawing slots do not close the
open `values` contract. Empty ledgers remain valid; ambiguous aliases and multiple
values for a scalar drawing slot are diagnosed without selecting an item.
Outcome/judgment interpretation remains separate. Optional `equivalentRoles`
groups declare one existing slot explicitly and must share meaning and arity.
They do not add required roles. Replay carries the resolved registry entry ID
forward so name capitalization cannot change a registered transition.

Collision rules compare the exact participants consumed by each claim. Ambiguous
readings of the same participant set remain neutral. A preferred drawing suppresses
another only when it includes that drawing's participants; distinct claim owners
survive. Local rebracketing compares terminal identity and surface order within
the named sequence, including its descendants, rather than the whole forest.


Tier 1 still requires its complete curated recipe. Tier 2 requires each smaller
claim to be independently complete; sharing vocabulary and graphics does not
merge their acceptance rules. Unconsumed evidence stays inspectable through
fallback. No model-facing role menu or new field is involved.

Candidate aliases are not sufficient proof of a meaning. The shared vocabulary
marks context-dependent aliases separately. For example, an exact Control
registration can interpret `antecedent` in its declared controller slot, but an
unknown relation containing only `antecedent` and `silentSubject` does not prove
Control. The equivalent distinction applies to generic chunks, surface/LF
correspondence and ordinary complements. Explicit-role checks are internal to
the facet evaluator; the model receives no linguistic menu.

Dispatch passes its interpreted evidence directly to the lowerer and Replay.
An explicit feature or record-row block with exactly one current anchor can
use the existing structured plaque regardless of that anchor's role wording.
It prints the authored field names and literals without asserting a dependency,
valuation or outcome. Multiple recipients still require explicit roles; ambiguous
feature blocks, prior-only anchors and prose alone do not earn this plaque.
Exact-primary ownership and independent-claim checks remain unchanged.
Assignment roles compose from explicit domain evidence and source/recipient
direction. Qualified theta roles or a typed theta-role value can establish that
domain; a generic `role` literal or the relation title cannot. Competing feature
evidence does not select a theta reading. Literal pairing, cardinality and
missing-reference checks still apply, including to lists with equal lengths.
They do not independently repeat alias lookup. Empty authored arrays retain
their field identity, so an empty optional field cannot be treated as absence.
Different arrays under equivalent role/value keys cannot be concatenated to
guess an idiom group or positional association. Unresolved references and failed
semantic/structural checks remain available as stage-scoped diagnostics.
For an authored anchor/literal pair, an exact field-name match takes precedence.
A normalized spelling may supply the pair only when it is unique. Competing
normalized fields remain neutral with an ambiguity diagnostic; object property
order cannot choose which literal belongs to an argument. This applies to every
paired literal reader, including theta roles, Case and correspondence indices.

The approved smaller Control connector, covert path, idiom underlines and
transferred-domain mark are Tier-2 combinations. Optional enclosures add their
own pieces only when supplied and valid. Invalid supplied domains do not become
absent domains. Control and idiom painting does not depend on the enclosure
existing. Covert Replay timing requires a preceding source, new landing and
consistent prior-source references; its drawing remains the covert path, not
an overt movement arrow. Existing exact Tier-1 signatures are unchanged,
including optional fields already present in those signatures.

Previous-stage references are not automatically current-stage drawing roles. A
movement's prior source can identify its current lower endpoint when that exact
ID uniquely persists in both stages with matching root lineage. Missing,
ambiguous or replaced IDs do not authorize a search for another occurrence.
Production
Tier-1 `priorAnchors` remains an open literal block. A Tier-2 facet keeps
same-role prior witnesses in its identity and validates them against the previous
stage before emitting continuity cues. Missing witnesses are retained and
diagnosed; they cannot prove replacement. A prior landing is allowed when a
later stage refers back to an already established movement.

An explicitly anchored head-movement host or complex is accepted only when the
current tree proves its relationship to the landing. A phase head is not a
synonym for its enclosing phase projection. Movement recovery also distinguishes
an enclosing landing site from an occurrence using authored root lineage and
containment; it does not discard unrelated candidates or narrow arrays.
The generic role `head` additionally needs unique source/landing root-lineage
evidence before Tier 1 can treat it as the moved occurrence rather than its host.

## Output-Piece Ownership Audit

Node and lineage IDs are exact strings throughout normalization, inspection,
Replay and drawing lookup. Whitespace folding belongs to relation/role wording,
not identity. Generated display ownership comes from explicit provenance, never
from an authored ID's suffix spelling.

Movement occurrence recovery is shared by Tier-2 lowering and Replay in
`replay/relations/movementEvidence.ts`. Source and landing must identify distinct
occurrences with the same authored root lineage; shared descendants alone do
not suffice. The lower occurrence can itself supply the occurrence witness, without
requiring a third node or an extra authored role. Anchored context distinguishes
supported complex-head landings from phrasal landings, including bare maximal
nominals. Unsupported context produces an internal diagnostic, not an invented
subtype. Replay executes only a movement transition earned by the surviving
claim, preserves the preceding source until that moment, and does not repeat an
unchanged chain. This does not relax the exact Tier-1 signature safeguard.

For an already established movement identity, unfamiliar role names may bind
through a unique pair of exact anchored occurrences with matching root lineage,
the preceding source parent/child slot, and a changed landing. Conflicting roles,
ambiguous endpoints and repeated endpoint lists do not select a candidate. The
same verified lower anchor can fill required source and witness slots before
ordinary Tier-1 validation. Optional decoration slots are not populated merely
because they exist. Unknown movement meaning cannot be inferred from geometry.

Ordinary and carrier movement use the shared structural refusal and transition
evidence. Current landing context is checked independently of history. A complete
static drawing may survive absent history, but cannot invent a transition or a
backward cue. Prior fields contribute continuity only when their exact occurrences
were verified for this movement; unrelated prior evidence remains neutral.

Cyclic agreement must first satisfy the underlying feature-dependency meaning
check. A cycle number alone cannot promote generic licensing to Agree. Supported
outcome literals reach the same existing label through both tiers. The native
cycle renderer places that label with its badge, preserving their spacing in
one coordinate group during zoom and redraw.

Derived movement evidence records the preceding occurrence separately from the
current lower and landing IDs. The old ID may persist at either endpoint. A
fresh lower ID requires the exact prior parent and child slot, matching root
lineage, and either the retained landing ID or an explicit prior-source anchor.
No search by word spelling or unanchored lineage substitutes a different ID.
Replay restores the complete prior occurrence before movement, retains earlier
lower copies in later movements, and reads later realization from that same
prior occurrence. Supported landing-shape requirements still apply. Pronunciation
is independent: either occurrence may be pronounced or silent as authored. A
new landing or a proven relocation earns the movement moment; a later change in
pronunciation does not replay that movement.

An accepted Tier-1 head/phrasal trajectory uses the same recovered movement
timing when the recovered kind agrees with its registered family. This is not
a second acceptance path. Special trajectory recipes retain their own behavior.
The movement moment includes the shortest new ancestor chain required to
connect the landing to existing syntax; higher projections keep their own
micro-steps.

A waiting unary root projection can also be withheld until an exact persistent
phrase attaches through a neutral relation's existing current/prior ownership.
Earlier relations referencing that projection prevent deferral. This changes
display timing only; it does not earn a movement drawing or rewrite the stage.

Movement indices identify connected established occurrences, not relation-list
positions. A complete history catalogue resolves links against their own stages
and reserves numbering before playback; active links control index visibility.
Both lower and landing occurrences show their chain membership independently of
pronunciation. Numeric authored indices take precedence and reserve their numbers;
conflicts remain authored rather than receiving a generated resolution. Existing
alphabetic trace formatting, other dependency letters and Tier-3 locators retain
their separate conventions. Shared words or lineage alone do not prove movement.

When an exact movement endpoint is a wordless category leaf, attach to that
category's shell bottom. Do not request an absent lexical child, invent a null
or trace, or search for another nearby endpoint. Lexical endpoints still require
unique terminal resolution. Both plan binding and post-fit head-trajectory
refinement must honor the attachment selected by the plan.

The audited inventory contains 69 distinct visual primitives across 70 facet
output assignments. Historical counts of 71 predate the `Terminal cap` merge;
the later count of 70 treated the Pair-Merge fork and blocked-extraction
adjunct branch as separate pieces. They now share the one parameterized
`Branch overlay` primitive.

Every primitive below is explicitly assigned. `Branch overlay` is intentionally
shared by exactly two facets: Pair Merge supplies both sibling branches, while
Blocked Extraction supplies only the adjunct branch. Every other primitive has
one owning facet recipe. A recipe may emit several pieces.
Fifty recipes are claim facets that may earn dispatch. The presentation and
organization recipes own pieces for inventory purposes but cannot dispatch
independently. The executable catalog declares every recipe's anchors, values,
structural checks, outputs, and Replay transition evidence.

<!-- tier2-piece-audit:start -->
| Facet recipe | Recipe kind | Owned visual pieces |
| --- | --- | --- |
| `movement.path` | claim | `Movement curve`, `Orthogonal movement`, `Cross-workspace crest`, `Path states` |
| `movement.carrier` | claim | `Carrier arrow` |
| `gap.notation` | claim | `Gap label` |
| `identity.occurrences` | claim | `Coindex`, `Forest light` |
| `presentation.lens` | presentation companion | `Lens emphasis` |
| `control.dependency` | claim | `Rectangular domain`, `Control connector` |
| `binding.dependency` | claim | `Elliptic domain` |
| `predication.dependency` | claim | `Predication connector` |
| `parasitic-gap.paths` | claim | `Path-node rings` |
| `parasitic-gap.copy` | claim | `Copy fork` |
| `locality.boundary` | claim | `Barrier cut` |
| `ellipsis.site` | claim | `Ghosting` |
| `correspondence.alignment` | claim | `Correspondence curves`, `Correspondence index` |
| `deletion.site` | claim | `Strike` |
| `constituent.occurrence` | claim | `Constituent enclosure` |
| `constituent.region` | claim | `Gradient enclosure` |
| `pair-merge` | claim | `Branch overlay` (both branches of one shared-parent fork) |
| `multidominance` | claim | `Shared branch` |
| `argument-sharing` | claim | `Crossed domain ovals`, `Label box` |
| `idiom.chunks` | claim | `Underline`, `Domain bracket` |
| `plaque.structured` | claim | `Plaque shell` |
| `feature-sharing` | claim | `Feature vine` |
| `agreement.cycle` | claim | `Cycle badge` |
| `feature.dependency` | claim | `Feature connectors` |
| `dependent-case` | claim | `Dependent-case elbow` |
| `accord` | claim | `Accord connector`, `Boxed index` |
| `phase.domain` | claim | `Phase arc` |
| `transfer.domain` | claim | `Transfer arcs` |
| `domain.annotation` | claim | `Overlay annotation` |
| `phase.edge` | claim | `Edge outline` |
| `transfer.access` | claim | `Access path` |
| `judgment.verdict` | claim | `Verdict glyph`, `Verdict label` |
| `landing-candidates` | claim | `Candidate rail` |
| `judgment.blocked` | claim | `Blocking cross` |
| `judgment.licensed` | claim | `Licensed check` |
| `intervention` | claim | `Intervention path` |
| `blocked-extraction` | claim | `Blocked extraction curve`, `Branch overlay` (adjunct branch only) |
| `focus.prominence` | claim | `Prominence branches` |
| `focus.projection` | claim | `Projection hop`, `Feature annotation`, `Accent annotation` |
| `strong-npi` | claim | `Nested association curves`, `Feature notation` |
| `storage.ledger` | claim | `Ledger frame` |
| `scope.movement` | claim | `Covert path`, `Scope domain` |
| `operator-binding` | claim | `Ranked scope hulls`, `Variable-binding path` |
| `theta-grid` | claim | `Role grid` |
| `pf.structured` | claim | `PF plate frame`, `PF plate rows` |
| `pf.rewrite` | claim | `Rewrite arrow` |
| `pf.correspondence` | claim | `Correspondence map` |
| `pf.fission` | claim | `Bundle shell` |
| `pf.impoverishment` | claim | `Delinking mark` |
| `pf.local-dislocation` | claim | `State lanes` |
| `pf.linearization` | claim | `Comparison column layout` |
| `organization.large-anchor-set` | organizational companion | `Anchor badge`, `Anchor rail` |
<!-- tier2-piece-audit:end -->

## Dispatch Order

Dispatch is exclusive per recovered claim, not per raw relation object. A raw
relation object is an evidence envelope and may contain several independent
claims.

1. Babel extracts complete claims from authored anchors and values before
   assigning a tier.
2. An exact registered primary claim with a valid signature is owned by Tier
   1. A malformed exact primary claim is owned by Tier 3 and is never repaired
   or disguised by Tier 2.
3. A structurally complete independent claim whose exact identity is unknown
   is owned by Tier 2, even when it shares an evidence envelope with a Tier-1
   or Tier-3 primary claim.
4. A failed primary claim suppresses only its generic Tier-2 twin. Independent
   claims with disjoint evidence may survive.
5. Equivalent recovered claims coalesce after ownership. Tier 1 wins over
   Tier 2, which wins over Tier 3, while all authored provenance is retained.
6. An unknown envelope with no complete Tier-2 claim receives the existing
   Tier-3 neutral fallback.
7. If Tier 2 consumes only part of an unknown envelope, any unconsumed
   authored evidence remains a separate Tier-3 residual claim. Evidence is
   never silently discarded or owned by both claims.

Canonical Orchard cards must remain entirely Tier 1. Tier 2 is tested with
unregistered names and must not make a canonical coverage failure pass.

Each recipe is evaluated independently. Runtime dispatch resolves these known
overlaps before any Tier-2 output reaches the renderer:

- `movement.carrier` is a strict evidence superset of `movement.path`; one
  operation must not receive both movement routes;
- `plaque.structured` requires a plaque anchor and plaque rows, while
  `pf.structured` requires an explicit rewrite output and PF plate rows.
  Generic records therefore remain generic plaques and PF evidence remains a
  PF plate;
- `feature.dependency` is the generic feature relation; a `dependent-case`
  facet additionally requires the exact whole tokens `dependent` and `case` in
  the same authored feature value, while `accord` requires authored polarity
  evidence and an index. Tokenization recognizes spacing, hyphenation, and
  camel-case boundaries, so `dependent case`, `dependent-case`, and
  `DependentCase` qualify; ordinary Case labels and substring matches do not.
  Regular-expression and fuzzy matches do not qualify. A completed specialized
  facet replaces its generic twin for the same relation instance. If both
  specialized readings remain complete, they fail closed and the independently
  completed generic facet survives;
- `constituent.occurrence` requires a constituent, while `constituent.region`
  requires an authored movement carrier. The broad alias `carrier` can name
  both concepts, so that unresolved alias tie still fails closed;
- `storage.ledger` requires an explicit scope/storage host. `scope` is not a
  generic plaque-anchor alias, so a storage record cannot silently become a
  generic plaque or morphology plate. Explicitly authored independent plaque
  and storage evidence may both survive;
- outcome words and verdict glyphs are resolved by literal meaning, not merely
  by their authored field name. `blocked` and `licensed` are local outcomes;
  glyphs such as `*` are analysis verdicts. A relation envelope may therefore
  contain both claims when each has its complete evidence.

`pf.rewrite` and `pf.fission` are not an implicit collision. Their ordinary
anchor cardinalities cannot complete together. If one relation explicitly
authors both complete role and row sets, it states two claims and both facets
may draw.

These rules are encoded explicitly in runtime dispatch. Vocabulary order never
selects a winner; recipe definitions do not implement runtime dispatch.

## Evidence Boundary

Tier 2 may read only:

- literal authored anchor-role names;
- literal authored value keys and values;
- anchors resolved in the relation's own stage;
- `priorAnchors` resolved in the immediately previous stage;
- authored tree structure, workspace roots, `lineageId`, and `silent` state;
- explicit Replay timing and replacement evidence.

Tier 2 must not invent or infer:

- a missing anchor or endpoint;
- a syntax node, trace, null, copy, shell, or workspace;
- an unexpressed relation identity or theoretical claim;
- direction from tree position alone;
- correspondence pairing from unordered arrays;
- silence from typography, lexical content, or a relation name;
- movement from a construction name alone.

## Synonym Lookup

Synonyms are renderer-side and model-invisible.

The vocabularies are separate:

- Tier-1 relation identities live only in the production registry.
- The Tier-2 runtime index contains only shared anchor-role and value aliases.
- Primitive names and aliases live in the documentation and Atlas-search
  catalog. Tier-2 dispatch never loads them.

- Lookup is exact after NFKC, case, camel-case boundary, whitespace, hyphen,
  and underscore normalization.
- Every alias maps to a set of candidate concepts.
- A collision never resolves by declaration order. Complete facet signatures
  and structural conditions must disambiguate it.
- If two distinct facets remain complete, both draw.
- If mutually exclusive geometry variants remain tied, that facet fails
  closed and emits a diagnostic.
- No fuzzy matching, edit distance, embeddings, language model, prompt
  vocabulary, or prose interpretation is permitted.

An exact primitive word or registered relation identity therefore cannot select
a Tier-2 facet. Tier-2 recognition is earned by authored roles, values, anchors,
and structure.

Lexical overlap between channels is allowed. For example, registered relation
identity `Phase` and anchor-role alias `phase` normalize to the same text. The
dispatcher sends the relation name only to Tier 1 and sends authored role and
value fields only to the Tier-2 synonym index, so that overlap cannot select a
Tier-2 facet.

## Outcome Resolution

Outcome value keys use the shared value-key catalog above. Outcome literals use
a separate exact resolver.

- Babel preserves the authored literal for display and diagnostics.
- The resolver maps exact synonyms to fine-grained concepts. For example,
  `prevented` resolves to `blocked`, while `failure` and `unsuccessful` resolve
  to `failed`. `Blocked`, `failed`, `crashed`, `illicit`, and `rejected` remain
  distinct concepts.
- Each Tier-1 family and Tier-2 facet that reads an outcome declares the exact
  concepts it accepts and maps them to its own existing visual states. A
  blocked-operation family may map both `blocked` and `failed` to its blocked
  path without making those concepts globally interchangeable.
- A recognized but unaccepted concept does not earn that family's styled mark.
- An unknown literal remains visible but earns no styled outcome.
- The resolver uses exact normalization only. It performs no fuzzy or semantic
  matching.

When a recipe requires an outcome, a missing or unaccepted outcome leaves that
recipe incomplete. An incomplete registered Tier-1 relation receives the Tier-3
neutral fallback. For an unknown relation, only that Tier-2 facet is skipped;
complete sibling facets still draw. If no Tier-2 facet survives, Tier 3 draws.

The direct blocking-cross facet accepts the `blocked` concept only, including
exact synonyms such as `prevented` and `barred`. Relation-specific path facets
may additionally accept `failed`, `illicit`, `rejected`, `unlicensed`,
`impossible`, or `violation` and map them to their blocked visual state.

The current Tier-2 facet policies live beside the other requirements in
`replay/relations/tier2FacetRecipes.ts`.

## Complete Facet Recipes

Each recipe declares:

- required current or prior anchor roles and their cardinalities;
- required or optional value concepts;
- executable structure checks over the authored trees;
- accepted outcome concepts;
- the visual pieces and local evidence gates it may emit;
- permitted Replay transition kinds and the exact stage-difference checks that
  earn them.

The permitted transition kinds are `movement`, `pronunciation`, `deletion`,
`rewrite`, `fission`, and `rebracketing`. A transition rule sequences a change
already authored between two stages. It never creates or repairs a stage
difference. Judgment facets declare no transition rules.

Recovered movement requires a proven preceding source and a newly established
landing, with exact occurrence identity and supported landing structure. It
does not require the lower occurrence to become silent. Covert movement
requires the number of shared-lineage occurrences to increase but does not
require the pronounced lower occurrence to become silent. Deletion requires
the same terminal to change from overt to `silent: true`. Pronunciation state
alone never earns a movement transition.

The recipe evaluator is provider-free. It does not perform Tier dispatch.
Claim dispatch passes it unknown envelopes and disjoint extra evidence from
registered envelopes after role and value normalization.

## Facet Gates

### Movement

A movement facet requires:

1. a resolved lower/source occurrence;
2. a resolved authored witness inside that source;
3. a resolved higher/landing occurrence;
4. shared authored lineage between the occurrences;
5. a committed landing in the authored stage.

The geometry follows the resolved structure:

- one workspace and a free route: movement curve;
- an authored `route: orthogonal` value requiring a drop-across-rise lane:
  orthogonal movement;
- different workspace roots: cross-workspace crest;
- an authored containing carrier: `Carrier arrow`;
- an independently recovered constituent region around that carrier:
  `Gradient enclosure`.

Tier 2 preserves the model's lower occupant. An authored trace receives
Babel's house trace typography and indexing. A silent full word remains that
word, `null`/empty symbols remain those symbols, and no lower occupant is
converted into a trace.

### Silence And Deletion

Ghosting requires a resolved `site` or `domain` containing material authored
with `silent: true`. Only that material ghosts.

A strike requires an explicit deletion claim over resolved material. Ellipsis
or silence alone never earns a strike.

### Plaques And Grids

Plaques are ordinary Tier-2 outputs. They require a resolved anchor and
complete authored rows. Babel displays authored labels and values verbatim.

The data shape selects the recipe:

- feature bearer plus feature rows: feature plaque;
- predicate plus at least two role-named arguments: role grid;
- PF anchor plus structured input/output rows: PF plate;
- source and exponent sets with authored pairing: correspondence map.

Arbitrary values do not by themselves select a specialized plaque.

### Judgments And Blocked Extraction

A whole-analysis verdict is one compound claim: its resolved analysis anchor,
authored judgment glyph, and optional authored explanatory label. The glyph
and label are one plan item and cannot be attached to an unrelated verdict.
`IllicitAnalysis` is the Tier-1 route; `judgment.verdict` is the Tier-2 route
to the same pixels.

Blocked Extraction owns only its diagnostic curve, the restyled native branch
into its authored adjunct domain, and its local outcome. It owns no general
star or verdict label. If an independently authored movement facet already
owns the same source-to-landing operation anywhere in the completed frame,
Blocked Extraction does not duplicate that path.

### Presentation Pieces

Lens emphasis is a Tier-2 presentation output emitted by a complete facet
while its lens is active. Forest light belongs to the identity occurrence
claim. It persists with that claim and follows the same active-versus-quiet
Replay emphasis as every other relation mark. Their late DOM/canvas
application is an implementation phase, not a dispatch exclusion.

Large-array anchor badges and rails are organizational outputs. They inherit
their parent facet and never assert an extra semantic connector.

## Badge Semantics

Numbered badges share one visual component with explicit variants:

- cycle badges show `C1`, `C2`, and so on;
- anchor-array badges show plain ordinals `1`, `2`, and so on and connect to
  their role rail.

The distinct text prevents two different meanings from becoming visually
indistinguishable.

## Persistence

Every executable facet declares both a persistence policy and a replacement
policy.

Persistence has three forms:

- `while-witnesses-resolve`: a completed claim appears in its authored stage
  and every later stage where all of its authored witnesses still resolve;
- `while-active`: presentation-only ink exists only while its interface state,
  such as an active lens, is true;
- `inherit-parent`: organizational badges and rails use the completed parent
  facet's lifetime.

Every claim uses `while-witnesses-resolve`. An unknown relation is therefore
never presumed temporary. If a witness vanishes, Babel stops drawing that
claim in the affected stage. It does not retarget the mark, and earlier Replay
history remains intact.

Replacement also fails closed. A later claim replaces an earlier claim only
when its complete `priorAnchors` block resolves in the immediately preceding
stage and names the earlier claim's participants. Same-looking later geometry
is not enough. An unrelated claim coexists. Repeated authored entries remain
independent claims and are handled by the visual coalescing rule below.

Outputs inherit their facet's persistence unless they declare a narrower
policy. Forest light and coindices both persist with the identity claim. During
a Replay relation moment, the active identity family is prominent and every
other visible identity family remains quiet. Lens emphasis is emitted by the
`while-active` presentation facet. Large-array anchor badges and rails inherit
their parent facet.

## Relation Preservation And Visual Coalescing

Every authored relation instance remains independent through Tier dispatch,
diagnostics, persistence, claim counting, and Replay ownership. Identical JSON
entries never group before their complete facets exist.

Each complete claim facet derives a visual identity from its normalized facet
id, authored stage, every normalized current and prior anchor, anchor lineage
and workspace witnesses, every authored value, accepted outcome, earned
transition kinds, and output piece. Recognized aliases that satisfy the facet's
recipe normalize to the same role or value concept. Other authored keys remain
literal identity evidence instead of disappearing, even when another facet
could recognize them.

Relation names and relation indices remain provenance and do not identify the
visual piece. This is a deliberate Tier-2 rule: two unknown names may earn the
same generic facet, while Tier 3 continues to distinguish verbatim fallback
relations by name. The renderer uses the attached Tier-2 output identity rather
than the Tier-1/Tier-3 coalescing key.

Presentation and organization companions inherit the complete set of surviving
parent claim identities and add their own facet id, anchors, values, and authored
moment. They never guess one parent when several claim facets survive. Tier-2
dispatch attaches the facet identity, output identities, and parent facet ids to
each resolved facet; the renderer does not reconstruct them.
Production coalescing must consume these dispatch-attached identities. Direct
identity-helper calls without authored-entry metadata are test utilities, not a
second runtime identity path.

The renderer paints two output pieces once only when these complete visual
identities match. The shared piece retains every contributing relation
reference, so either relation moment can reveal it. A difference in stage,
anchors, lineage, workspace, values, outcome, transition evidence, facet, or
piece keeps the outputs separate. Shared anchors or screen geometry alone never
establish identity.

Operator binding does not depend on a raw relation count. Every complete
operator-variable-domain facet earns one scope hull and one binding path. The
renderer ranks the distinct operator-domain facets that are visible together.

## Required Verification

### Evidence accounting

Blocking drawings need authored negative evidence. The shared check accepts a
recognized negative outcome or an explicitly blocking role on the participant
used by that claim. Containment, a target, or an intervening node alone does not
establish failure. Contradictory or uninterpretable authored outcomes cannot be
ignored to retain a blocking mark. This applies to Tier-2 transfer access,
intervention and blocked extraction, and to the registered PostTransferAccess
and Intervention recipes whose painters include a cross. No partial version of
those Tier-1 drawings is substituted.

Binding and operator-variable candidate roles must establish their respective
meanings. Contextual synonyms are not sufficient by themselves. If both readings
remain possible, `binding-or-operator-reading` preserves them neutrally rather
than asserting both. Other independently complete claims survive. Separate
authored relations still retain separate moments.

Outcome aliases use shared interpretation in signature checks and production
lowering. A literal judgment glyph is not an outcome word. An independent claim
using the same recognized outcome cannot deprive the primary of it.

A drawing that has one literal slot accepts one value, not the first member of
a list. Production scalar slots declare that limitation in render-family metadata;
Tier-2 recipes declare matching cardinality. A diagnostic retains the original
field and list when the drawing cannot carry them. This restricts the drawing,
not the open authoring contract. Full-row and explicitly paired drawings keep
their list support. Case/Agree uses its combined single-row curve only when it
can carry all Agree values; otherwise Agree retains its full existing plaque.

Dispatch retains the complete authored relation alongside a per-field report of
the recipes using each original item and the items not recovered. A field may
support several claims. Every item index refers to the original array, including
when Tier 1, Tier 2 and a neutral remainder use different positions. An outcome
used by the registered render family remains available to that family when an
independent Tier-2 judgment uses it too. This does not relax Tier-1 requirements.

Evidence ownership is not a count of linguistic assertions or visible marks.
In particular, recognized structural witnesses and registered literal context
need not each produce an independent mark. Unknown leftovers remain attached to
the complete relation; subtracting fields does not establish a new dependency.
When a neutral claim retains current participants and another drawing has used
current anchors from the same relation, dispatch supplies `contextAnchors` with
the authored current-anchor block, except verified movement-context fields already
owned by that movement. This is derived display context,
not a new model field or proof of a particular dependency. The neutral drawing
uses that context; its unconsumed evidence remains separately recorded. Context
also participates in fallback identity so different participant sets cannot
coalesce merely because their leftover fields match.

Movement recovery records each verified host, complex or landing-site field under
its original authored key. A site must identify the immediate landing parent;
a head host must be the other head in the supported complex, and a complex anchor
must identify that parent. All referenced nodes and the parent must be unique.
Tier 1 uses the same structural check while retaining its full signature and
role requirements. An incomplete exact claim is not rescued through Tier 2.
Only a complete selected movement facet owns these context fields. They do not
add trajectory witnesses or alter drawing/replacement identity. Missing,
ambiguous or structurally unrelated context stays unresolved with its field,
node, landing and reason in inspection diagnostics, even if the independent
movement succeeds. Licensing, thematic occurrences, government and other
additional claims are not consumed merely because a trajectory exists.

Value-only and prior-only remainders do not gain current connectors. Context
never imports a recognized earlier-stage witness or earns a backward cue. The
existing Tier-3 topology, stage-only persistence and authored-position numbering
remain unchanged. Current-anchor roles, arrays and repetitions are preserved;
no subset is selected by guessing which participant an unfamiliar claim means.

The plan emits one `claim-evidence` report per relation with a neutral claim,
including exact fields and original indices, full authored context and candidate
failures. Candidate failures describe unfulfilled drawing requirements, not the
model's intended meaning. Unknown roles are reported as unknown; no guessed
linguistic explanation or public warning is added. Review exports preserve the
dispatch output `key` used by production lowering.

Lookup preserves authored group boundaries. Equivalent aliases with identical
ordered contents can identify one group; different contents, order or repetition
must not be concatenated into a joint claim or resolved by choosing one entry.
This applies to current anchors, prior anchors and literal values, including
optional evidence. Every recipe checks the original entries. An `ambiguous-group`
diagnostic names the field, interpreted role and conflicting authored keys; it
must not report those present entries as missing. Unrecovered entries remain
available through the neutral claim and original evidence report.

Pooling is permitted only where the existing drawing preserves independent
content: per-node phase-edge outlines, separately named organizational rails,
and structured/PF plaques that print each original field label and literal.
Those plaque labels also participate in drawing identity. This permission does
not extend to identity chains, paths, paired arrays or feature-sharing bundles.
Prior-order and current-order values have distinct derived concepts and retain
their separate comparison columns. No model-facing field or role menu is added.

These rules do not establish a general positional association between anchor and
value lists. That contract gap remains separate from preserving the lists.

A Transfer check may follow an explicitly anchored phase head through its unique
same-category head/projection spine to a separately attached transferred domain.
It supports `P`/`PP` as well as other labels. It stops before a higher head starts
a different projection. Category matching verifies this authored relationship;
it never establishes phasehood or transferred status on its own.

The verified Tier-2 implementation proves that:

1. every vocabulary primitive has exactly one recipe-matrix row;
2. every recipe role/value concept exists in the synonym catalog;
3. ambiguous aliases return all candidates deterministically;
4. exactly one of Tier 1, Tier 2, or Tier 3 owns each recovered claim, even
   when claims from different tiers share one authored relation envelope;
5. each facet fails locally without suppressing complete siblings;
6. movement, ghosting, plaques, judgments, presentation pieces, and
   large-array organization have provider-free fixtures;
7. canonical cards still require Tier-1 coverage;
8. every authored relation dispatches independently, while identical complete
   facet outputs may later paint once with all relation references retained;
9. one complete operator-binding facet earns its own ranked scope hull;
10. extra authored values or prior anchors keep outputs separate;
11. companions preserve their own evidence and every surviving parent claim;
12. dispatch returns finished facet and output identities consumed by the renderer.
