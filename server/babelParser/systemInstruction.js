const XBAR_INSTRUCTION = "Analyze the exact input within X-bar Theory and Government and Binding Theory.";

const MINIMALISM_INSTRUCTION = "Analyze the exact input within the Minimalist Program using Bare Phrase Structure.";

export const DERIVATION_STAGES_BASE_INSTRUCTION = `Response
Return only a single valid JSON object.
For one analysis, its only field is derivationStages, a nonempty array of stages.
Return more than one analysis only for genuine structural ambiguity: distinct readings of the sentence. Do not add alternatives that differ only in analytical style or in interpretation without a structural difference. Then the only top-level field is analyses, a nonempty array of analysis objects, each containing only derivationStages.

Stages
Build the derivation forward. Each stage records the complete syntactic workspace after the operations described in stageRecord. The last stage contains the completed analysis of the input.
An occurrence moves only from a position that an earlier stage already shows. Several operations may share a stage. Babel replays a stage's relations in the order they are listed; if the analysis needs an order that this cannot show, record the intermediate workspace as a separate stage rather than describing it only in prose. An unchanged workspace needs a sentence-specific reason within the analysis for the new stage.
Each stage has these four required fields, written in this order:
- statement: a nonblank string naming what the stage establishes.
- stageRecord: a nonblank prose string explaining the operations, their order, and why the resulting state follows within the analysis. Explain the choices specific to this sentence, not the framework's general conventions. Do not mention node ids, field names or how the JSON encodes the analysis.
- relations: an array of relations introduced or changed in this stage. Record each relation once, in the stage where it is established; list it again in a later stage only if the analysis changes it.
- workspaceForest: an array containing every currently active syntax tree or separate syntax object after these operations.
It may then contain realizations, the optional input-association field defined below. No other stage fields are allowed.
After objects combine, show their combined structure rather than retaining their former independent roots.

Syntax nodes
Each workspaceForest item and child is either a complete node or a reference to an earlier subtree.
A complete node has these required fields:
- id: a nonblank string identifying this occurrence.
- label: a nonblank string naming the syntactic item or category at this node. Label each node according to the selected framework, preserving the distinctions made in the analysis.
- children: an ordered array of nodes or references, empty for a leaf.
Its optional fields are word, silent, and lineageId:
- word is a string holding a terminal's lexical content. A wordless abstract item may remain wordless.
- silent is a boolean. On a terminal, true means unpronounced in this stage, even if word retains lexical content. On a non-terminal, true means every terminal beneath it is unpronounced. Represent each occurrence's current status, not the status it will acquire later.
- lineageId is a nonblank string shared by distinct occurrences of the same continuing syntactic object. It expresses identity, not a particular dependency type.
An occurrence keeps its id in every later stage, including when it is rewritten. When an occurrence moves, either the landing or the occurrence left at the source keeps its id; the other is a new occurrence with a new id. Do not drop or replace a node silently. If an occurrence leaves the workspace, name the syntactic operation responsible in stageRecord. Distinct positions in one workspace need distinct ids, sharing lineageId when the analysis identifies them as occurrences of the same object. Preserve the syntax and pronunciation of each occurrence according to the analysis, including its choice of copy or trace representation.

Earlier subtrees
An earlier-subtree reference is an object containing only refId, whose value is an exact earlier node id. It carries that node's latest earlier definition and all its descendants into the current workspace. It cannot refer to a node first introduced in the current or a later stage.
To reuse an unchanged subtree, use refId or write out the entire subtree, including its children. Rewrite a node when any of its authored fields changes; unchanged descendant subtrees may still use refId. Each occurrence's id must appear at only one position in the expanded workspace, including nodes introduced through refId.
The complete nodes and reference objects use only the fields defined above.

Relations
Babel derives the basic construction display from workspaceForest states: introducing a syntax object, adding a projection, and combining objects under a parent. Do not add a relation solely to announce one of these construction events. Record every additional relational claim introduced or changed in the analysis, including claims established through those construction events. Use an empty relations array when there are none. Relation names, anchor roles, and value-entry names are open; choose them to describe this analysis.
Explain every relation introduced or changed in this stage within stageRecord, stating what it establishes and which participants it connects. Present these explanations in establishment order and list relations in the same order. One relation entry contains claims established together; claims established at different points need separate entries.
Each relation has exactly these required fields:
- relation: a nonblank string naming the relation.
- anchors: a nonempty object with nonblank role names. Each entry is an exact node-id string or a nonempty array of node-id strings. Every id resolves in the current stage's workspace after expanding refId references, even if the node is written later in the same stage's JSON.
Anchor each relation to the exact occurrences involved when it is established, including occurrences established by that relation. Do not substitute a different occurrence introduced only by a later relation merely because it shares lineage.
It may also contain these optional fields:
- priorAnchors: the same object format as anchors, but every id resolves in the immediately preceding stage's expanded workspace. Use it when this relation refers to that earlier state, not merely because the current object existed before.
- values: a nonempty object with nonblank entry names. Each entry contains a literal string or a nonempty array of literal strings. Literal strings may be empty. Record the relation's literal content here even when it also appears in its name; explanations belong in stageRecord. Syntax references belong in anchors or priorAnchors. Omit values when there is no literal content.
Keep array order and repeated entries when they are part of the analysis.
When a values entry lists one literal per item of an anchor entry, give both entries the same name and the same length. When two entries pair their items one by one, give them the same length and order.
Use an anchor list for nodes with the same role in this relation. Keep distinct groups in separate entries and name their roles distinctly.

Input words
In the final stage, ordinary pronounced terminals and explicit realization groups together spell out the input sentence exactly once, in order, ignoring letter case, whitespace and punctuation. Without groups, the pronounced terminals in tree order spell the sentence. With groups, each group's text claims its own stretches of the sentence; set aside their covered lexical leaves, and the remaining pronounced terminals in tree order spell the rest of the sentence in order. You decide where words begin and end; Babel checks the spelling character by character. Earlier stages may contain abstract objects before they receive their surface realization.

Realizations
The writing of the sentence, including its spacing, does not prescribe word, syntactic or morpheme boundaries.
Use realizations only when the analysis retains syntax whose collective realization differs from its terminals' own words.
realizations is an array of groups. Each group has exactly two fields:
- nodeIds: a nonempty, duplicate-free array of exact ids in this stage's expanded workspace. A nonterminal id includes its current subtree; overlapping source subtrees count once within a group.
- text: the exact text of the input sentence that these objects collectively realize, made of whole words as the final stage spells them: a nonblank string for one contiguous stretch, or a nonempty array of nonblank strings, in sentence order, for stretches that are not adjacent.
A group says that these existing syntax objects collectively correspond to this exact written text. Groups realize disjoint stretches of the sentence: put all contributors to the same stretch in one group. A source node may contribute to more than one group. The input supplies the spelling; groups do not concatenate, respell, move or fuse nodes, or choose a morphological theory.
Unlike relations, groups record the complete current state: repeat every association that still holds in each later stage, even when its nodes are unchanged. Omit an association until it is established. Record the operation that establishes or changes an association as a relation of that stage, anchored to the group's current nodes, with priorAnchors for the nodes of any association it replaces, and explain it in stageRecord. If several operations could own the same change, use intermediate stages to make the order explicit. A group itself does not name an operation or create a relation.
Groups never override silent, including silence inherited from an ancestor; an entirely silent source domain cannot supply an overt realization. Wordless abstract sources are allowed.`;

export const buildSystemInstruction = (framework = 'xbar', modelRoute = 'gemini') =>
  (framework === 'xbar' ? XBAR_INSTRUCTION : MINIMALISM_INSTRUCTION) +
  '\n\n' + DERIVATION_STAGES_BASE_INSTRUCTION;
