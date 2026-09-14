# Morphology and surface realization audit

This is a separate capability audit requested by Francis, dated 14 September
2026. It describes Babel at `08b5de4`, using Node `v24.16.0`. It does not adopt
a new contract, change the prompt, repair an analysis, or approve a new drawing.
[ROADMAP.md](../../ROADMAP.md#current-reconciliation-and-next-work) owns the work
order. The model continues to author the linguistics.

## Answer

Babel already accepts separate morphological pieces in earlier stages followed
by one pronounced word in a later stage. For example, an abstract root and tense
head can become a terminal whose `word` is `walked`. The final terminal supplies
the existing input alignment. No additional permanent mapping is necessary for
that representation.

Babel cannot currently accept a final tree in which two pronounced terminals,
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

This covers the current implementation's relevant paths and known design
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

## Current representation and processing

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

The smallest complete extension has not yet been selected. First settle the
required cardinalities and whether final syntax may differ in order from its
surface realization. Then compare the explicit-association and domain-realization
options against the scenarios below. A scalar-index relaxation alone should not
be described as a general solution.

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

## Recommended next decision

Keep the already supported early-pieces-to-final-word path. The neutral
transition's residual-parent repair is complete as recorded above; the
representation decisions remain open.
Design retained final morphology separately, starting from explicit occurrence
alignment rather than alias recognition or automatic concatenation. The user
wants this capability; the contract format and implementation remain undecided.

The proposed prompt change from `syntactic reason` to `reason within the analysis`
concerns a new PF or interpretation claim with an unchanged workspace. Changing
a word or structure already changes the workspace. The clarification does not
add or repair surface alignment. It remains a separate wording decision. The
approved framework-sensitive label instruction is already committed and is not
reopened by this audit.
