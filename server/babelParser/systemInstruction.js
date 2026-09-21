const XBAR_INSTRUCTION = "Analyze the input within X-bar Theory and Government and Binding Theory. Explain the sentence-specific structural choices and derivational commitments in the stage records.";

const MINIMALISM_INSTRUCTION = "Analyze the input within the Minimalist Program using Bare Phrase Structure. Explain the sentence-specific structural choices and derivational commitments in the stage records.";

export const DERIVATION_STAGES_BASE_INSTRUCTION = `Analyze the exact input, including an ungrammatical input. Explain any judgment within the selected framework rather than changing the sentence.

Response
Return only a single valid JSON object.
For one analysis, its only field is derivationStages, a nonempty array of stages.
For structural ambiguity, the only top-level field is analyses, a nonempty array of analysis objects, each containing only derivationStages. Include every distinct structurally supported reading, without duplicate analyses or an arbitrary count limit.

Stages
Build the derivation forward. Each stage records the complete syntactic workspace after the operations described in stageRecord. The last stage contains the completed analysis of the input. A completed analysis may establish that the input is illicit.
An occurrence moves only from a position that an earlier stage already shows. Several connected operations may share a stage when their order is recoverable from the workspace changes and any relations independently required by the definition below. Replay derives its construction steps from workspace changes; do not add relations solely to narrate those steps. If the required order depends on an intermediate workspace, record that workspace as a separate stage rather than describing it only in prose. An unchanged workspace needs a sentence-specific reason within the analysis for the new stage.
Each stage has these four required fields, written in this order:
- statement: a nonblank string naming what the stage establishes.
- stageRecord: a nonblank prose string explaining the operations, their order, and why the resulting state follows within the analysis. Include the reasoning needed to understand this stage, without programming identifiers or JSON bookkeeping.
- relations: an array of this stage's relations, as defined below.
- workspaceForest: an array containing every currently active syntax tree or separate syntax object after these operations.
It may then contain realizations, the optional input-association field defined below. No other stage fields are allowed.
These fields describe the same analysis. Show the structure the stage record requires, including intermediate positions that matter. Higher structure must preserve or build its lower structure within the chronological derivation. After objects combine, show their combined structure rather than retaining their former independent roots.

Syntax nodes
Each workspaceForest item and child is either a complete node or a reference to an earlier subtree.
A complete node has these required fields:
- id: a nonblank string identifying this occurrence.
- label: a nonblank string naming the syntactic item or category at this node. Label each node according to the selected framework, preserving the distinctions made in the analysis.
- children: an ordered array of nodes or references, empty for a leaf.
Its optional fields are word, tokenIndex, silent, and lineageId:
- word is a string holding a terminal's lexical content. A wordless abstract item may remain wordless.
- tokenIndex is the zero-based integer index of the input token pronounced by this terminal at this stage. Its word matches that token. Assign each index to at most one pronounced terminal per stage. Unpronounced or not-yet-realized items have no tokenIndex.
- silent is a boolean. On a terminal, true means unpronounced in this stage, even if word retains lexical content. On a non-terminal, true means every terminal beneath it is unpronounced. Missing tokenIndex alone does not mean silence. Represent each occurrence's current status, not the status it will acquire later.
- lineageId is a nonblank string shared by distinct occurrences of the same continuing syntactic object. It expresses identity, not a particular dependency type.
Keep an occurrence's id while it persists across stages. Distinct positions in one workspace need distinct ids, sharing lineageId when the analysis identifies them as occurrences of the same object. Preserve the syntax and pronunciation of each occurrence according to the analysis, including its choice of copy or trace representation.

Earlier subtrees
An earlier-subtree reference is an object containing only refId, whose value is an exact earlier node id. It carries that node's latest earlier definition and all its descendants into the current workspace. It cannot refer to a node first introduced in the current or a later stage.
To reuse an unchanged subtree, use refId or write out the entire subtree, including its children. Rewrite a subtree when its structure, pronunciation, lineage, or syntactic position changes. Each occurrence's id must appear at only one position in the expanded workspace, including nodes introduced through refId.
The complete nodes and reference objects use only the fields defined above.

Realizations
The supplied input-token boundaries are for reference; they do not prescribe syntactic or morpheme boundaries.
Omit realizations when ordinary whole-word terminals already express the stage's input associations. Use it when the analysis retains syntax whose collective realization differs from one terminal per input token, such as separate morphological pieces realizing one word or one syntactic object realizing several words.
realizations is an array of groups. Each group has exactly two fields:
- nodeIds: a nonempty, duplicate-free array of exact ids in this stage's expanded workspace. A nonterminal id includes its current subtree; overlapping source subtrees count once within a group.
- tokenIndices: a nonempty, duplicate-free array of zero-based positions in the supplied input-token list, in input order. The positions need not be adjacent.
A group says that these existing syntax objects collectively correspond to these exact input tokens. Groups have disjoint tokenIndices: put all contributors to the same token in one group. A source node may contribute to more than one group. The input supplies the spelling; groups do not concatenate, respell, move or fuse nodes, or choose a morphological theory.
Groups record the complete current state. Repeat every nontrivial association that still holds in each later stage; they are not inherited merely because the nodes persist. Omit an association until it is established. Describe its operation and timing in stageRecord and the relevant open relation, anchored to the participating current nodes and, when relevant, their immediately preceding forms. If several operations could own the same change, use intermediate stages to make the order explicit. A group itself does not name an operation or create a relation.
Keep the authored tree and lexical forms. A grouped leaf may keep tokenIndex only if its own word independently matches that whole input token and the token belongs to a group covering it; this redundant index does not count the token twice. Groups never override silent, including silence inherited from an ancestor; an entirely silent source domain cannot supply an overt realization. Wordless abstract sources are allowed.
Examples illustrate associations, not required analyses:
- Input tokens ["walked"], with an ordinary leaf whose word is "walked": use tokenIndex: 0 and omit realizations.
- Input tokens ["walked"], with current leaf id "stem" carrying word "walk" and current leaf id "ending" carrying word "-ed": use "realizations": [{"nodeIds":["stem","ending"],"tokenIndices":[0]}]. Neither piece independently matches "walked", so neither receives tokenIndex: 0. Keep both pieces if that is the analysis.
- Input tokens ["went"], with current wordless nodes "rootGo" and "past" representing the root and past tense: use "realizations": [{"nodeIds":["rootGo","past"],"tokenIndices":[0]}]. Explain the irregular realization in the analysis; the group records the association without deriving the spelling.

Relations
Record relations that are not fully expressed by the forest's ordinary mother-daughter or sisterhood branching. Explain them in stageRecord. Use an empty relations array when there are none. Names and roles are open; choose them to describe this analysis.
Each relation has exactly these required fields:
- relation: a nonblank string naming the relation.
- anchors: a nonempty object with nonblank role names. Each entry is an exact node-id string or a nonempty array of node-id strings. Every id resolves in the current stage's workspace after expanding refId references, even if the node is written later in the same stage's JSON.
It may also contain these optional fields:
- priorAnchors: the same object format as anchors, but every id resolves in the immediately preceding stage's expanded workspace. Use it when this relation refers to that earlier state, not merely because the current object existed before.
- values: a nonempty object with nonblank entry names. Each entry contains a literal string or a nonempty array of literal strings. Literal strings may be empty. Record the relation's literal content here even when it also appears in its name. Syntax references belong in anchors or priorAnchors. Omit values when there is no literal content.
Anchor-role and value-entry names are not fixed fields or a prescribed vocabulary. Keep array order and repeated entries when they are part of the analysis.
When a values entry lists one literal per item of an anchor entry, give both entries the same name and the same length. When two entries pair their items one by one, give them the same length and order.
Use an anchor list for nodes with the same role in this relation. Keep distinct groups in separate entries and name their roles distinctly.
List relations in the derivational order explained in stageRecord, with prerequisites before dependent relations. This orders relations, not the display's selection, projection, and merge steps.
Anchor each relation to the exact occurrences involved when it is established, including occurrences established by that relation. Do not substitute a different occurrence introduced only by a later relation merely because it shares lineage.
If the analysis makes an illicit judgment, explain it in stageRecord and anchor its relation to the relevant syntax. A judgment about the whole analysis is anchored to its final root.

Input words
In the final stage, ordinary pronounced terminals and explicit realization groups together account for every supplied input token exactly once. Without groups, the pronounced terminals in tree order match the supplied input tokens. With groups, set aside their covered lexical leaves and claimed input positions; the remaining pronounced terminals in tree order match the remaining input tokens, retaining their original indices. Retained lexical content on silent terminals is not pronounced. Earlier stages may contain abstract objects before they receive their surface realization. Exact input coverage is required even for an ungrammatical input; it is not a grammaticality judgment.`;

export const buildSystemInstruction = (framework = 'xbar', modelRoute = 'gemini') =>
  (framework === 'xbar' ? XBAR_INSTRUCTION : MINIMALISM_INSTRUCTION) +
  '\n\n' + DERIVATION_STAGES_BASE_INSTRUCTION;
