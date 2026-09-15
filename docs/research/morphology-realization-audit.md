# Morphology and surface realization audit

The original capability audit requested by Francis, dated 14 September 2026,
describes Babel at `08b5de4`, using Node `v24.16.0`. That investigation changed no
contract, prompt, analysis or drawing. Its baseline findings remain below; the
[follow-up](#contract-reuse-check-and-proposed-extension) records the optional
`realizations` contract approved and implemented on 15 September. Offline
integration and browser verification are complete; fresh model authoring remains
unmeasured.
[ROADMAP.md](../../ROADMAP.md#current-reconciliation-and-next-work) owns the work
order. The model continues to author the linguistics.

## Answer at the audited baseline

Babel already accepts separate morphological pieces in earlier stages followed
by one pronounced word in a later stage. For example, an abstract root and tense
head can become a terminal whose `word` is `walked`. The final terminal supplies
the existing input alignment. No additional permanent mapping is necessary for
that representation.

At that baseline, Babel cannot accept a final tree in which two pronounced terminals,
`walk` and `-ed`, jointly realize the single input token `walked`. The limitation
is shared by the prompt and final-surface checker. A realization plaque does not
override it. Likewise, one terminal containing `has walked` does not match the
two input tokens `has` and `walked`.

These are different representations. Requiring every analysis to collapse its
final morphology into one terminal per input token would restrict the model's
analysis. Supporting retained internal morphology requires a representation
decision, not a spelling repair or another relation alias.

## What was examined

The audit follows the complete data path: prompt and input tokenization; node,
reference and relation fields; workspace inspection; public normalization's
final-root selection; all eight registered PF/morphology families and their
Tier-2 recipes; Replay transitions; pronunciation, casing and derived identity;
renderer annotations; and Tree Bank snapshot/reopen serialization.

The primary check ran 42 controls in both frameworks through the exact
`normalizeParseBundle` function used by provider routes and workspace inspection.
All 48 accepted results also completed the app's `prepareReplay` entry point and
a Tree Bank snapshot/load round trip. All 84 checks preserved the supplied
payload. A separate review inspected the PF readers and ran nine direct compiler
controls. No provider calls, HTTP server, browser pass or production changes were
made. Compiler-visible node sets establish timing observations below; they do
not constitute visual approval.

Temporary executable controls and raw results are under
`/tmp/babel-morphology-audit/`. This document retains the scenarios, outcomes,
source references and design boundaries. The existing 1,614-test gate was not
rerun for this documentation-only audit.

The tested system-instruction hashes are:

| Framework | SHA-256 |
| --- | --- |
| X-bar | `7c9383c0fabe4b7c879a706e97514a47060c68fb18b9365ed1fe026fb656609e` |
| Minimalism | `a74bcc96e174fb054abd4bb6da0dc9971bcb325c80cc4b3d9c00247103560bb7` |

This covers the audited implementation's relevant paths and known design
dimensions. It does not certify every morphological theory, language, open
relation name, model response or visual composition.

## The distinctions Babel needs to preserve

- An **input token** is a position in Babel's supplied token list. It is not
  necessarily a whitespace-delimited word or a linguistic morpheme.
- A **syntactic terminal** is a leaf in the model's tree. It may be abstract,
  pronounced, or explicitly silent in that stage.
- A **surface realization** is the form that the analysis associates with its
  syntactic material. Its relation to syntactic terminals need not be one-to-one.
- A **relation annotation** records or illustrates a claim. Its text does not
  execute a linguistic rule on the tree.

The user's proposal to introduce phonological content later is linguistically
reasonable. Halle and Marantz explicitly separate syntactic terminals from
their phonological realization and discuss merger, fusion and fission. This
supports allowing such analyses; it does not prescribe Distributed Morphology
for every Babel derivation. See *Distributed Morphology and the Pieces of
Inflection*, pp. 111–117, in the
[authors' paper](https://web.mit.edu/morrishalle/pubworks/papers/1993_Halle_Marantz_Hale_Keyser_Distributed_Morphology_Pieces_of_Inflection.pdf).

## Audited representation and processing

| Part | Established behavior | Consequence |
| --- | --- | --- |
| Prompt | Earlier stages may contain abstract objects before surface realization. Only the final stage must match the input-token sequence. | Earlier stages do not need to contain the final spoken words. |
| `word` | A nonblank `word` on a leaf counts as pronounced unless that leaf or an ancestor is explicitly silent. | Missing `tokenIndex` does not make `walk` or `-ed` silent. |
| Wordless nodes | Labels alone do not supply pronounced content. | A root label or `T[past]` can remain abstract. |
| `silent` | Silence is stage-specific and inherited through a whole subtree. | Retained silent material is supported, but must not be invented to pass alignment. |
| Nonterminal `word` | The pronunciation collector reads leaves. A parent's `word: "walked"` does not replace or realize its children. | Adding a word above `walk` and `-ed` is not an existing grouping mechanism. |
| `tokenIndex` | One scalar input-token position; the prompt permits only one pronounced terminal per index in each stage. | Two final pieces cannot currently share a token as a collective realization. |
| `lineageId` | Identity of continuing syntactic objects, independent of dependency type. | Shared lineage neither fuses forms nor groups their pronunciation. |
| `surfaceSpan` | Derived from aligned terminal indices. Each overt leaf receives a singleton span. | It is not an authored many-to-many realization mechanism. |
| Final normalization | Compares pronounced leaf strings in tree order against input tokens, including equal sequence lengths. Case, NFC and edge punctuation are normalized. | No joining, affix stripping, spelling transformation or token reordering occurs. |
| Earlier stages | Their surface need not match the final input. Workspace inspection separately reports malformed fields, references and duplicate indices. | A valid final surface does not certify every earlier authored field. One control with duplicated earlier indices normalizes but retains inspection diagnostics. |
| Final root | Only the last stage supplies the final candidate. Multiple roots remain a separate processing-policy concern. | An earlier matching word is not substituted for a mismatching final analysis. |
| References | `refId` carries the latest earlier definition; a changed structure must be authored again. | Writing a new realization in relation prose does not update a carried tree. |
| Relation fields | Anchors identify exact current/prior nodes. Values are strings or string lists. | Free prose, nested objects and invented field names are not a hidden alignment API. |

Implementation owners:
[prompt](../../server/babelParser/systemInstruction.js),
[tokenizer](../../server/babelParser/surfaceTokens.js),
[pronunciation](../../server/babelParser/nodePronunciation.js),
[workspace and final alignment](../../server/babelParser/derivationCompiler.js),
[normalization](../../server/babelParser/parseNormalization.js),
[spans and sequence comparison](../../server/babelParser/syntaxTree.js),
[browser contract](../../types.ts).

### How the model can express the supported case

For a one-token input `walked`, the following are illustrative workspace roots,
not a prescribed linguistic analysis or additional prompt examples.

Earlier:

```json
{
  "id": "domain", "label": "V",
  "children": [
    { "id": "root", "label": "√WALK", "children": [] },
    { "id": "tense", "label": "T[past]", "children": [] }
  ]
}
```

Later, if the analysis combines them into one terminal:

```json
{ "id": "realized", "label": "V", "word": "walked", "tokenIndex": 0, "children": [] }
```

The model can explain the change in its Stage Record and refer to the exact
earlier and later objects in an open relation:

```json
{
  "relation": "Morphological combination",
  "anchors": { "result": "realized" },
  "priorAnchors": { "input": "domain" },
  "values": { "exponent": "walked" }
}
```

The relation name is illustrative. The tested neutral relation owns the change
through its exact current result and prior domain. It does not gain a specialized
linguistic drawing merely from this name. The same final representation can use
the old domain ID when the analysis treats it as the continuing occurrence.

The tree change already identifies the final word. The extra relation expresses
the operation and its timing; it is not a second permanent surface ledger.
Without a relation, the final representation still normalizes, but Replay uses
ordinary structural construction rather than a named realization moment.

## Existing PF drawings

All eight registered families were inspected alongside their Tier-2 shapes.
These drawings do not define additional input alignment.

| Family | Existing expression | Boundary |
| --- | --- | --- |
| PF realization | Plaque with authored realization rows, possibly several targets | Does not concatenate terminal strings or validate an equation against the tree |
| Vocabulary insertion | Literal input/output row or other authored rows on an anchored terminal | Does not perform insertion on an unchanged workspace |
| Phrasal spell-out | Exponent annotation beside an anchored phrase | Does not suppress that phrase's pronounced descendants |
| Many-to-many correspondence | Paired literal source/exponent associations | Strings are not exact terminal IDs or input-token positions |
| Fission | Two current output feature bundles; a prior input can witness their transition | Exact Tier 1 can draw outputs alone; Tier-2 fission recovery requires the prior input. Neither supplies general fusion or arbitrary-cardinality alignment. |
| Impoverishment | Feature hierarchy and explicit delinking position | Does not decide pronunciation or spellings |
| Local dislocation | Authored rebracketing of an ordered sequence | Does not infer word boundaries or join its members |
| Cyclic linearization | Authored precedence comparison | Does not map morphology to input tokens |

The correspondence plaque intentionally combines equal literal labels. Two
different terminals printed identically would therefore not remain distinct
alignment identities in this display. Empty exponents leave sources unlinked;
unequal source/exponent lists refuse this drawing. These established display
rules should not be repurposed into hidden surface semantics.

Tier-2 rewrite can refer to one prior subtree as its input and one current output.
The input need not be a single morphological leaf. This already offers a way to
illustrate some composite-to-single transitions without adding a fusion alias.
Recognition and transition ownership remain separate questions.

Sources:
[registry](../../replay/relationDispatch/productionRegistry.js),
[Tier-2 recipes](../../replay/relations/tier2FacetRecipes.ts),
[render families](../../replay/relations/renderFamilies.ts),
[literal and plaque compilation](../../replay/relations/renderPlanCompiler.ts),
[native correspondence content](../../replay/relations/nativeDrawingContent.ts),
[painter](../../components/TreeVisualizer.tsx).

## Replay findings requiring follow-up

The controls isolate ownership from recognition. They preserve a correct final
`walked` terminal while varying only the relation's available transition evidence.

| Transition control | Compiled result |
| --- | --- |
| PF realization with current output and prior whole domain | Complete changed structure appears at its relation moment, with same or new result ID |
| Neutral combination with current output and prior whole domain | Complete changed structure appears at its relation moment |
| Neutral combination with only the removed prior component leaves | The old, now-empty domain remains in the relation frame's visible node set, then disappears at Stage Record |
| Neutral combination without prior anchors | The result appears in selection/projection before the relation |
| Abstract input becomes two final output words with PF realization | Both words appear at the relation moment in the tested completed workspace |

The table records the original audit result. The residual parent was subsequently
confirmed visually and repaired on 14 September: an absent prior container retires
when its last child has left through owned edits. Nested exhausted ancestors retire
with it. A surviving sibling, a parent retained in the current authored state or
an independently empty item prevents deletion. Regression controls cover changed
root identity, relocation, overlapping claims, ambiguous IDs, independent workspaces
and source immutability. Re-running all 84 controls changes only this leaf-anchored
case in each framework. The browser now shows the same resulting tree at the
relation moment and Stage Record. This repair adds no morphology representation
and does not broaden which relations own transitions.

The no-prior case is different. A current result and a final tree do not always
identify which preceding objects the relation transforms. Establish when the
delta proves that association and when the model omitted necessary evidence.
Do not fix it by guessing from the title or forcing a curated PF name. Do not
introduce unavailable future nodes to fill a relation frame.

These findings belong to the general Replay ownership and recognition work.
They do not justify a camera/layout rewrite or a new participant-free graphic.
The [Replay compiler](../../replay/replayCompiler.ts) and
[preparation entry point](../../replay/prepareReplay.ts) were exercised; their
appearance in an integrated browser remains unverified for these new controls.

## Control inventory

Both frameworks produced the same normalization outcome in every row. Accepted
means local normalization, Replay preparation and snapshot round trip completed.
It does not mean the illustrative analysis is linguistically correct.

| # | Control | Result |
| --- | --- | --- |
| 1 | Ordinary whole word | Accepted |
| 2 | Wordless components, then whole word using domain ID | Accepted |
| 3 | Wordless components, then whole word using new ID | Accepted |
| 4 | Earlier overt pieces, then whole word | Accepted |
| 5 | Wordless components, then whole word without a relation | Accepted; ordinary construction |
| 6 | Neutral transition anchored to prior domain | Accepted; atomic transition |
| 7 | Neutral transition anchored only to prior leaves | Accepted; residual-parent timing finding |
| 8 | Neutral transition with no prior anchors | Accepted; output constructed before relation |
| 9 | `study` and `-ed`, then authored `studied` | Accepted |
| 10 | Abstract root and tense, then authored `went` | Accepted |
| 11 | Final `walk` and `-ed`, no indices | Surface mismatch |
| 12 | Final pieces sharing token index zero | Surface mismatch and duplicate-index diagnostic |
| 13 | Final pieces with separate indices | Surface mismatch |
| 14 | Final `walk` and `ed`, without a hyphen | Surface mismatch |
| 15 | Final `walked` and `ed` | Surface mismatch |
| 16 | Parent `word: walked` above overt pieces | Surface mismatch |
| 17 | Parent `word: walked` above wordless children | Surface mismatch |
| 18 | Final pieces with `walked` only in PF values | Surface mismatch |
| 19 | Final pieces with phrasal exponent `walked` | Surface mismatch |
| 20 | Final pieces with correspondence literals | Surface mismatch |
| 21 | Final pieces sharing lineage | Surface mismatch |
| 22 | Final pieces claiming the same surface span | Surface mismatch |
| 23 | Whole word and explicitly silent suffix | Accepted |
| 24 | Whole word and explicitly silent retained domain | Accepted |
| 25 | Whole word and wordless abstract suffix | Accepted |
| 26 | One terminal `has walked` for two tokens | Surface mismatch |
| 27 | Earlier abstract input, then two whole-word outputs | Accepted |
| 28 | Repeated `had had` with distinct token positions | Accepted |
| 29 | Repeated `had had` with a shared token position | Alignment failure and duplicate-index diagnostic |
| 30 | Tree order opposite to token-index order | Surface mismatch |
| 31 | `a`, `part` for input `a part` | Accepted |
| 32 | Same pieces for input `apart` | Surface mismatch |
| 33 | Case, punctuation and NFC variation of `Café` | Accepted under existing normalization |
| 34 | Input `walk-ed` with leaves `walk`, `ed` | Accepted under current tokenization |
| 35 | Input `Mia's` with leaves `Mia`, `'s` | Accepted under current possessive tokenization |
| 36 | Input `can't`, one matching terminal | Accepted |
| 37 | Input `can't`, separate `ca` and `n't` | Surface mismatch |
| 38 | Japanese input with its supplied four-token segmentation | Accepted |
| 39 | Matching earlier stage, mismatching final stage | Final surface mismatch |
| 40 | Whole `walked` tree, relation claims output `ran` | Accepted; annotation does not rewrite or certify the tree |
| 41 | Unchanged realized subtree carried by `refId` | Accepted |
| 42 | Early duplicate indices, later correct whole word | Accepted with earlier inspection diagnostic |

The tokenizer's possessive and hyphen behavior is an existing convention, not
evidence that morphology in general is supported. Existing multilingual tests
also cover emoji, symbols, RTL scripts and fallback tokenization. Changes to
tokenization would alter model inputs and require separate provenance and
compatibility review.

## Why adjacency is insufficient

`walk` plus `-ed` can be an analysis of `walked`. Babel should be able to record
that claim. It cannot safely make the claim merely because two labels are next
to each other. The same operation would need to distinguish:

- Two words, such as `a part`, from components of one word, such as `apart`.
- A morphological boundary hyphen from literal input punctuation.
- Direct joining from spelling alternation, suppletion and nonconcatenative forms.
- Two occurrences of the same printed word in one sentence.
- Adjacent components from discontinuous realization or components brought
  together only in a later stage.
- A suffix label from an independently pronounced terminal.

If the model writes `walked` and then another pronounced `ed`, treating the pair
as just `walked` would delete authored content. If `ed` is only an abstract label,
or the analysis explicitly makes it silent, the current field rules already
distinguish that case. Babel must not choose one interpretation from spelling.

The input string supplies the target spelling, but does not always establish
which syntactic objects jointly realize which occurrence of it. Where the final
tree already makes that correspondence explicit, a second mapping is unnecessary.

## Options for retained final morphology

No option below is adopted. The requirement is to preserve the model's final
structure while recording its connection to exact input-token occurrences.
Alignment must not depend on earning Tier 1 or Tier 2.

| Option | Benefit | Cost or unresolved boundary |
| --- | --- | --- |
| Current stages end with one terminal per input token | Already works; no new field or alignment table | Only suitable when the model's analysis actually has that final representation |
| Several terminals share existing `tokenIndex` | Small vocabulary change for many terminals realizing one token | Changes scalar semantics and word matching; cannot express one terminal realizing several tokens; duplicate-index checks cannot simply be removed |
| A small explicit association between node occurrences and input-token occurrences | Can cover one-to-many and many-to-many without relation-name guessing | Requires a contract design and coordinated consumers; compare node-local lists against a group representation before choosing |
| Allow a nonterminal to carry a realization for its domain | Convenient for a constituent pronounced as one word | Must distinguish surface ownership from silent descendants, nested domains and overlapping or discontinuous realizations; current `word` semantics do not do this |
| Derive alignment from existing PF relations | Could reuse some already explicit claims | Current open roles, literal strings and repeated-word ambiguity do not supply a uniform occurrence mapping; making recognition mandatory recreates the alias problem |
| Automatically join adjacent strings | Appears simple for regular concatenation | Reject as a general solution: it guesses linguistic grouping and spelling and can hide doubled content |

These were the alternatives at the original audit checkpoint. The follow-up
contract reuse check below recommends explicit stage-contained groups, including
existing domains as possible sources. The field is not implemented. A
scalar-index relaxation alone is insufficient for the required cardinalities.

### Requirements for that design

1. Preserve existing one-word terminals and saved records without migration or
   reinterpretation. Omitted alignment must retain its established meaning.
2. Identify exact node occurrences and input positions, including repeated words;
   strings and lineage alone are insufficient.
3. Keep early abstraction, current-stage pronunciation, zero realization and
   future realization distinct. Do not mark morphology silent as a workaround.
4. Cover several terminals to one token, one terminal to several tokens,
   many-to-many, and any agreed discontinuous or overlapping case explicitly.
5. Separate the displayed morphological form from the supplied orthographic form.
   Do not require concatenation to produce irregular or spelling-changing output.
6. Define ordering, coverage, unassigned content and contradictory associations.
   Diagnose them without silently dropping stages or forcing a linguistic verdict.
7. Keep movement occurrence identity separate from surface identity. Two copies
   need not share pronunciation; shared token ownership must not merge their IDs.
8. Keep relations and tiers independent of surface validity. Neutral terminology
   must be able to express the same alignment as curated terminology.
9. Preserve snapshot/reopen, raw-response inspection and exact generation
   provenance. Do not reinterpret older `tokenIndex` records under new rules.
10. Qualify relation timing and readable rendering before adopting the extension.
    New morphology must not reopen accepted plaque, camera or badge appearance.

## Consumers and remaining proof

| Consumer | Audit result or required proof for a future extension |
| --- | --- |
| Prompt and provenance | Current wording expressly imposes final one-to-one alignment. Any extension changes contract-test conditions and needs exact new prompt hashes. The earlier-stage exception should remain. |
| Inspector and normalizer | Need one shared definition of realization membership, not separate permissive checks. Current duplicate-index and final-surface failures are intentional under the present contract. |
| Tree order and spans | Current leaf ordering and singleton spans cannot express every discontinuous or shared realization. Decide the semantics before changing validation. |
| Replay and display identity | Token index participates in derived keys, signatures and pronunciation restoration. Preserve opaque authored occurrence identity. Test changed cardinality and ID reuse independently of spelling. |
| Tree labels, gap labels and casing | Current consumers read a single terminal form and one token index. A future collective realization needs explicit ownership so labels do not duplicate, vanish or inherit the wrong casing. |
| Sentence heading | The app prefers the supplied sentence. Its archive fallback and Replay snapshots join pronounced leaf strings with spaces. They must not reconstruct a future grouped surface incorrectly. |
| PF rendering | Existing annotations may be reused after a representation decision. A new graphic is not inherently necessary. Plaque literals must not become instructions that mutate syntax. |
| Tree Bank | Current snapshots preserve the complete normalized tree and authored stages in all 48 accepted controls. Browser rendering was not rerun. New top-level alignment data would require snapshot-field review; node fields also require contract/replay preservation. |
| Static previews and printing | They capture the current drawing. Full-row plaque printing remains out of scope and is not a reopened defect. New morphology would need readable display checks, not an export-policy redesign. |
| Inspection and public errors | Unsupported final alignment remains a mismatch under current behavior. How incomplete research is presented remains a separate unresolved policy. No JSON repair can establish morphological meaning. |
| Model behavior | No new generation was run. There is no evidence yet that the revised prompt worsens or improves morphology. A later capped check should preserve early structures, final structures, relations and all processing receipts. |

Existing executable evidence includes
[pronunciation tests](../../tests/nodePronunciation.test.mjs),
[tree-order tests](../../tests/pronouncedTerminals.test.mjs),
[input generality](../../tests/inputGenerality.test.mjs),
[diagnostics](../../tests/derivationDiagnostics.test.mjs),
[PF sequencing](../../tests/replayMovementSequencing.test.mjs) and
[native content](../../tests/nativeRelationContent.test.mjs).
Low-level morphology drawings that bypass public normalization must remain
labelled as such; they are not proof of end-to-end acceptance.

The later design also needs controls for portmanteaux, multiple exponence,
circumfixes/infixes, nonadjacent realizations, genuinely zero realization,
reduplication, overlapping groups, omitted tokens, extra terminals, invalid
references and mixed successful/unsuccessful analyses. These are requirements
for evaluating a new representation, not claims that new support was tested here.

## Agreed direction and next implementation

Keep the already supported early-pieces-to-final-word path. The neutral
transition's residual-parent repair is complete as recorded above.
Implement retained final morphology separately, starting from explicit occurrence
alignment rather than alias recognition or automatic concatenation. The user
approved the optional association field and requires especially clear authoring
instructions. The concrete rules below define the accepted contract;
the implementation and its verification are recorded at the end of the follow-up.
The earlier sections preserve the original audit baseline.

The user approved the prompt change from `syntactic reason` to `reason within the
analysis` on 15 September; it is implemented separately from realization groups.
It permits a PF or interpretation claim with an unchanged workspace. Changing a
word or structure already changes the workspace. The exact-input requirement and
surface alignment remain unchanged. The approved framework-sensitive label
instruction is already committed and is not reopened by this audit.


## Contract reuse check and proposed extension

This follow-up examined `b4abef8` after the badge and emptied-parent repairs. That
reuse investigation changed no product, prompt or fixture files and made no
provider call. The user approved implementation of the optional association field
on 15 September. Its rules below are now implemented and verified offline;
fresh model compliance remains unmeasured. The separately approved
unchanged-workspace prompt clarification is recorded above.

The current-code check runs 52 concrete records in both frameworks, including
the original 42 controls and ten additional field-reuse combinations. All 104
outcomes match the expected current behavior. The 54 normalized results also
complete Replay preparation and snapshot/load round trips without changing the
supplied records. Some normalized records deliberately retain diagnostics;
normalization alone is not a claim of a fully valid analysis. Scripts and results
are in `/tmp/babel-morphology-contract-review/`.

### What reuse actually permits

The existing contract can retain abstract root/feature structure before a whole
word appears, keep a whole-word leaf alongside an abstract feature node, or end
with several ordinary words. It can describe a collective realization in open
relation anchors and literal values. However, those annotations do not change
how Babel checks the final surface.

Two final lexical forms `walk` and `-ed` cannot jointly count as the input token
`walked`. A final `has walked` leaf cannot count as two input tokens. Shared
`tokenIndex`, a list supplied in that scalar field, shared `lineageId`, a wide
`surfaceSpan`, a parent's `word`, and explicit token/exponent strings in relation
values all fail to supply the missing association under their existing meanings.

An extra standalone `walked` workspace beside an abstract morphological tree
normalizes with `DERIVATION_FINAL_WORKSPACE_MULTIPLE_ROOTS`. The selected final
tree is the standalone word. This is not a satisfactory way to retain the
morphological analysis as the final tree. Making an affix silent or abstract is
appropriate only when that is what the model's analysis claims.

### One recommended representation

Add one optional field, `realizations`, to a completed derivation stage. Keep its
four current required fields. Each group contains exactly the current syntax
occurrence IDs and the input-token positions that the model associates with them:

```json
"realizations": [
  { "nodeIds": ["root", "past"], "tokenIndices": [0] }
]
```

For the one-token input `walked`, this says that the existing `root` and `past`
objects jointly correspond to that occurrence of `walked`. It neither creates a
new syntax node nor declares fusion. The original tree, labels and lexical forms
remain authored as before. A source can instead name an existing subtree for a
phrasal realization. Several target positions allow one or more syntax objects
to correspond to several input tokens, including separated positions.

The input already provides the target spelling; do not add a second `exponent`
string to this field. Phonological forms, explanations and linguistic operations
remain available in nodes and open relations. This field records exact input
association, not a phonological derivation or a spelling algorithm. In particular,
linking a root and tense to a token does not certify that the linguistic claim is
correct.

Approved rules:

1. Omission retains today's final-alignment behavior. Ordinary whole-word
   analyses need no new field. Existing records are not migrated or reinterpreted.
2. Groups describe associations established in the completed stage. They are
   current state, not an implicit cumulative ledger or a command to alter syntax.
   When using groups, record all nontrivial associations that still hold there.
3. `nodeIds` is a nonempty set of exact current-stage occurrence IDs;
   `tokenIndices` is a nonempty, duplicate-free list of in-range input positions
   in surface order. A nonterminal source covers its current subtree. Source
   coverage is deduplicated within a group; arbitrary spelling or lineage never
   identifies a source.
4. Target token sets are disjoint. Several pieces contributing to the same token
   belong in one group. A source may participate in several groups, allowing one
   feature or domain to contribute to more than one realized word.
5. Group-covered lexical leaves obtain their collective association from the
   group. A direct `tokenIndex` may remain as redundant metadata only when it
   independently satisfies today's whole-word rule and names a token claimed by
   a group covering that leaf. Count that token once. Thus `walked` may retain a
   valid direct index when an abstract tense head joins its group; `walk` cannot
   claim that direct index for input `walked`. Report conflicting assignments
   rather than discarding them. For remaining ordinary leaves, remove the claimed
   token positions and perform the existing ordered string comparison against
   the remaining input. Preserve and check authored direct indices against the
   original input positions.
6. Wordless abstract sources may participate. Effective silence includes silence
   inherited from an ancestor: directly naming a descendant never bypasses
   whole-phrase silence. Silent occurrences remain excluded from overt lexical
   coverage and cannot independently supply an overt realization. Existing
   silence and wordless-node conventions remain available; no empty-token group
   is necessary for this first extension.
7. Validate references, field shapes, ownership conflicts and coverage. Do not
   concatenate strings, correct spellings, replace authored words, infer silence,
   require a recognized relation name, or pronounce extra material to pass a check.
8. Input indices describe the claimed surface association. They never reorder
   the authored children, move nodes or merge movement identities. Exact sets
   remain available for discontinuous associations; a legacy `surfaceSpan` must
   not be treated as their exact membership.

This is preferable to extending the scalar `tokenIndex`: the scalar's current
whole-word meaning can stay intact, while a group directly expresses a collective
claim. Node-local lists repeat the same group on several nodes and require a rule
for deciding whether repeated lists mean individual or joint realization. A
parent-only `word` rule cannot name arbitrary contributing nodes and changes
pronunciation semantics for existing nonterminals. Relation-name recognition
would recreate the alias problem. The proposed groups are within the existing
sole authored derivation source, not another final tree or a separate analysis
ledger.

The linguistic motivation is the distinction between syntactic pieces and their
realization, rather than any particular morphological theory. Halle and Marantz
explicitly distinguish syntax, realization and changes in correspondence, including
merger that retains separate terminals and fusion that does not, on pp. 111–117
of [their paper](https://web.mit.edu/morrishalle/pubworks/papers/1993_Halle_Marantz_Hale_Keyser_Distributed_Morphology_Pieces_of_Inflection.pdf).
As a data-format comparison, [CoNLL-U](https://universaldependencies.org/format.html#words-tokens-and-empty-nodes)
separately records surface tokens and syntactic words, including Spanish `al`
corresponding to `a` and `el`. That supports making the distinction explicit;
Babel need not adopt UD's syntactic units or morphological theory.

### Required integration and the timing boundary

This is a small data addition with coordinated implementation work, not a
one-line validation relaxation.

| Existing owner | Necessary change |
| --- | --- |
| `systemInstruction.js`, stage validation and `types.ts` | Permit the optional fifth stage field and define the groups. Qualify exact prompt hashes using the existing provenance mechanism. |
| Normalization and workspace inspection | Share one pure coverage resolver for direct terminals and explicit groups. Preserve original input and field-level diagnostics. |
| `syntaxTree.js` and surface consumers | Separate declared realized input coverage from concatenating displayed leaf forms. Do not manufacture shared scalar indices or false contiguous spans. |
| Replay adapters, stage signatures and playback state | Preserve groups and recognize association changes even when the forest is unchanged. Keep them separate from syntax construction and layout. |
| Rendering and casing | Preserve the authored morphology on the tree and keep the full input in the sentence heading. Make the exact association inspectable; reuse existing PF drawings where their own claims support them. A group alone does not require a new plaque or duplicate whole-word terminal. |
| Tree Bank and snapshots | Existing snapshots deep-copy complete stages. Verify preservation and reconstruction; no new storage service or migration is indicated. |

One genuine timing issue must not be hidden by this proposal. Two relations can
have the same participants, so a list of node IDs alone cannot always establish
which relation introduced a new realization. Current nonmovement transition
checking also compares only forests, so an unchanged tree with changed groups
needs explicit handling.

Approved first-version policy: use existing exact current/prior relation
ownership when it identifies one owner. An intermediate completed stage can
separate competing operations under the existing chronology rule. It does not
supply a missing owner: a stage with no witnessing relation still establishes no
relation moment for the association change. Preserve the completed state and
report missing ownership in inspection without inventing a moment. Future
authoring must supply the witnessing relation when claiming that operation.
Never choose an owner from a title, an alias or proximity. Do not add
`relationIndex`, event IDs or another timing system now. If the user later needs
several ambiguous realization changes in a single stage, that is a separate,
concrete extension request. The completed state and any unresolved timing evidence
must remain inspectable under the existing processing policy.

### Scope and decisions

The user confirmed that Babel must derive the exact submitted input, including
an ungrammatical input. The model can depict that input and explain why its
structure is illicit. Realization groups change how authored syntax corresponds
to those exact input tokens; they do not authorize substitution, omission, an
invented grammatical sentence, or treating input coverage as a grammaticality
verdict. The hypothetical possibility of an analysis ending without a complete
sentence tree is not grounds for relaxing this requirement.

The model-facing instructions define the optional field after `workspaceForest`
and explain both lists, ordinary direct indices and collective association. Their
examples cover omission for a whole-word `walked` terminal, separate `stem` and
`ending` leaves carrying `walk` and `-ed` for input tokens `["walked"]`, and
wordless `rootGo` and `past` nodes for `["went"]`. These illustrate permitted
associations without requiring those syntactic analyses. Groups record
associations already established in that stage; they do not automatically
pronounce, move, fuse or respell nodes. Existing relations and stage records
describe the operation and its timing. Fresh model compliance with these
instructions remains unmeasured.

Necessary now: the optional group field, shared
coverage checking, state/consumer preservation and focused controls for many-to-one,
one-to-many, repeated tokens, irregular forms, domains, overlapping sources,
silence and omitted/conflicting associations. Include ordinary-record parity and
Replay timing checks before any visual change is presented for approval.

Can wait: character/phoneme alignment inside tokens, a phonological transducer,
a separate PF tree, new special-purpose morphology graphics, automatic spelling,
new relation vocabulary, storage architecture, tokenizer changes and a general
layout or linearization rewrite. The association can identify separate target
positions without constructing an independent PF-ordering system.

The user approved this optional stage field and has specified the exact-input
and authoring requirements above. The recommended handling of ambiguous timing
follows the existing intermediate-stage rule rather than adding another field.
The scoped implementation passes `npm run verify:all`: typecheck, 1,640 tests and
parse-contract verification. The production build and release-asset check also
pass. Focused controls cover regular and irregular collective realization,
one-to-many and discontinuous targets, repeated tokens, shared sources, current
subtree domains, inherited silence, redundant direct indices, malformed groups,
exact IDs, omitted state and ambiguous or unavailable timing. A realization
cannot activate at its relation moment until its complete current source domain
is visible. Unresolved ownership remains inspection metadata.

All six enabled model routes, in both frameworks, preserve the groups, original
input, raw output and prompt hashes under mocked provider responses. Public
response bundles now retain the supplied input in their existing `sentence`
field. This allows saved Replay to use the original tokens instead of trying to
reconstruct them from morphological pieces.

The six archived Grok/Astra/Fable analyses retain byte-identical complete Replay
output across 207 frames. The integrated production-renderer browser comparison
also finds identical syntax labels, badge bounds and camera transforms at every
archived frame, with manual zoom and Fit behavior preserved. Two explicitly
labelled authoring controls add 13 inspected frames. The actual app worker,
Tree Bank thumbnail, save and reopen preserve `walk` plus `-ed` for input
`walked`. These controls test representation, not linguistic correctness.
Temporary review images, recording, executable controls and results are under
`/tmp/babel-realizations-review/`; they are not committed product fixtures.

No provider calls were made. Fresh model compliance, cost and latency for the
new instructions remain unmeasured. This feature adds no morphology-specific
graphic, spelling algorithm, topology change or relaxed exact-input policy.

Separate existing limitations:

- Literal multidominance is unavailable: one node cannot occupy two parent
  positions in the same expanded workspace. Distinct IDs with shared lineage
  express related occurrences, not one shared node. This affects analyses that
  require actual shared structure, but does not need repair for realization groups.
- Outside explicit associations, current final tree order is also input order.
  Independent abstract order and PF linearization require their own demonstrated
  representation need. Do not quietly turn this morphology work into a new
  linearization engine.
- Input positions belong to Babel's supplied tokenization, which already makes
  choices about possessives, hyphens and punctuation. They are addresses into that
  input, not declarations of universally correct morphological or syntactic units.
  Changing tokenization is separate from allowing several syntax objects to share
  those addresses.
