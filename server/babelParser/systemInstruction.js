const XBAR_INSTRUCTION = "Analyze the exact input within X-bar Theory and Government and Binding Theory.";

const MINIMALISM_INSTRUCTION = "Analyze the exact input within the Minimalist Program.";

// Bare Phrase Structure is named where it applies, in the label field. Named in
// the opening task line, it made GPT-6.1 Sol narrate its notation ("labels
// identify projecting heads rather than bar levels") in the first stage record.
// Left unnamed, labels drift to X-bar style.
const labelNotation = (framework) => (framework === 'xbar'
  ? 'Label each node according to the selected framework'
  : 'Label each node in Bare Phrase Structure notation');

// Measured for Minimalism only (GPT-6.1 Sol): told to avoid "the framework's
// general conventions", it also left out the mechanisms behind each step
// (valuation, EPP). X-bar keeps its wording until it is measured.
const stageRecordFocus = (framework) => (framework === 'xbar'
  ? "Explain the choices specific to this sentence, not the framework's general conventions."
  : 'Explain the choices this sentence required.');

// Measured for Minimalism only (GPT-6.1 Sol): naming "copy or trace" made the
// representation a topic, narrated in stage records ("leaving a copy rather than
// a trace"). Either remains open; X-bar keeps the clause until it is measured.
const occurrenceRepresentation = (framework) => (framework === 'xbar'
  ? ', including its choice of copy or trace representation'
  : '');

// X-bar analyses may record a level of representation such as D-structure as
// one stage. Minimalism has no such level; offered there, the sentence led
// GPT-6.1 Sol to build whole clause skeletons first and change them inside later.
const completeStructure = (framework) => (framework === 'xbar'
  ? ' A stage may establish a complete structure at once, such as a level of representation the analysis distinguishes.'
  : '');

// Bare Phrase Structure has no bar levels and no separate projection step: a
// label comes from Merge. So only the X-bar instruction names a projection
// among the construction events Babel derives from the workspace states.
const constructionEvents = (framework) => (framework === 'xbar'
  ? 'introducing a syntax object, adding a projection, and combining objects under a parent'
  : 'introducing a syntax object and merging objects under a parent');

export const buildDerivationStagesInstruction = (framework = 'minimalism') => `Response
Return only a single valid JSON object, either bare or inside one Markdown code block opened with \`\`\`json, and nothing else.
For one analysis, its only field is derivationStages, a nonempty array of stages.
When the sentence has readings that need different structures, return one analysis for each reading. Then the only top-level field is analyses, a nonempty array of analysis objects, each containing only derivationStages.

Stages
Build the derivation forward. Each stage records the complete syntactic workspace after the operations described in stageRecord.${completeStructure(framework)} The last stage contains the completed analysis of the input.
An occurrence moves only from a position that an earlier stage already shows. Several operations may share a stage. Babel replays a stage's relations in the order they are listed; if the analysis needs an order that this cannot show, record the intermediate workspace as a separate stage rather than describing it only in prose. An unchanged workspace needs a sentence-specific reason within the analysis for the new stage.
Each stage has these five required fields, written in this order:
- statement: a nonblank string naming what the stage establishes.
- stageRecord: a nonblank prose string explaining the operations, their order, and why the resulting state follows within the analysis. ${stageRecordFocus(framework)} Do not mention node ids, field names or how the JSON encodes the analysis.
- relations: an array of relations introduced or changed in this stage. Record each relation once, in the stage where it is established; list it again in a later stage only if the analysis changes it.
- workspace: an array of node ids naming the root of every currently active syntax tree or separate syntax object after these operations.
- nodes: the syntax this stage introduces or changes, written as trees, defined below.
It may then contain realizations, the optional input-association field defined below. No other stage fields are allowed.
After objects combine, name only their combined root in workspace rather than retaining their former independent roots.

Syntax nodes
A stage's workspace contains each root it names and, through children, every node beneath those roots. A node that no root reaches is not in the current workspace.
Each node keeps its latest definition until a later stage redefines it. List a node in nodes in the stage that introduces it and in every later stage that changes any of its fields, including its children, and in no other stage. A node whose own fields are unchanged is not listed again when something beneath it changes.
Write what the stage builds as trees: a node's children are written in place, from left to right, and a child that already exists unchanged is named by its id. Each node, written in place or as its own nodes entry, has these required fields:
- id: a nonblank string identifying this occurrence. Within one stage's nodes, each id appears once.
- label: a nonblank string naming the syntactic item or category at this node. ${labelNotation(framework)}, preserving the distinctions made in the analysis.
Its optional fields are children, word, silent, lineageId, and copyOf:
- children: an ordered array of the node's daughters from left to right, each a node written in place or the id of a node defined in this or an earlier stage. Omit children, or use an empty array, for a leaf.
- word is a string holding a terminal's lexical content. A wordless abstract item may remain wordless.
- silent is a boolean. On a terminal, true means unpronounced in this stage, even if word retains lexical content. On a non-terminal, true means every terminal beneath it is unpronounced. Represent each occurrence's current status, not the status it will acquire later.
- lineageId is a nonblank string shared by distinct occurrences of the same continuing syntactic object. It expresses identity, not a particular dependency type.
- copyOf is the id of a node defined in this or an earlier stage. The entry is then a new occurrence with that node's structure as this stage defines it: Babel gives it the copied node's label, fields and complete subtree, and names each node inside the copy by this entry's id, a slash and the copied node's id, as in copy/original. An entry with copyOf has no children or word and may omit label; label, silent and lineageId, when given, apply to the entry itself.
Write each node's id as its last field, after its children. An occurrence keeps its id in every later stage, including when it is redefined. When an occurrence moves, either the landing or the occurrence left at the source keeps its id; the other is a new occurrence with a new id. Each id stands at only one position in the workspace: it is one root or the child of one parent, and never beneath itself. Distinct positions in one workspace need distinct ids, sharing lineageId when the analysis identifies them as occurrences of the same object. Preserve the syntax and pronunciation of each occurrence according to the analysis${occurrenceRepresentation(framework)}.
Nodes use only the fields defined above.

Relations
Babel derives the basic construction display from the workspace states: ${constructionEvents(framework)}. Do not add a relation solely to announce one of these construction events. Record every additional relational claim introduced or changed in the analysis, including claims established through those construction events. Use an empty relations array when there are none. Relation names, anchor roles, and value-entry names are open; choose them to describe this analysis.
Explain every relation introduced or changed in this stage within stageRecord, stating what it establishes and which participants it connects. Present these explanations in establishment order and list relations in the same order. One relation entry contains claims established together; claims established at different points need separate entries.
Each relation has exactly these required fields:
- relation: a nonblank string naming the relation.
- anchors: a nonempty object with nonblank role names. Each entry is an exact node-id string or a nonempty array of node-id strings. Every id resolves in the current stage's workspace, whether the node is listed in this stage's nodes or defined in an earlier stage.
Anchor each relation to the exact occurrences involved when it is established, including occurrences established by that relation. Do not substitute a different occurrence introduced only by a later relation merely because it shares lineage.
It may also contain these optional fields:
- priorAnchors: the same object format as anchors, but every id resolves in the immediately preceding stage's workspace. Use it when this relation refers to that earlier state, not merely because the current object existed before.
- values: a nonempty object with nonblank entry names. Each entry contains a literal string or a nonempty array of literal strings. Literal strings may be empty. Record the relation's literal content here even when it also appears in its name; explanations belong in stageRecord. Syntax references belong in anchors or priorAnchors. Omit values when there is no literal content.
Keep array order and repeated entries when they are part of the analysis.
When a values entry lists one literal per item of an anchor entry, give both entries the same name and the same length. When two entries pair their items one by one, give them the same length and order.
Use an anchor list for nodes with the same role in this relation. Keep distinct groups in separate entries and name their roles distinctly.

Input words
In the final stage, read the pronounced terminals in tree order: they spell out the input sentence exactly once, in order, ignoring letter case, whitespace and punctuation. Where a realization group covers terminals, its text is read in their place, starting where the first of them stands. You decide where words begin and end; Babel checks the spelling character by character. Earlier stages may contain abstract objects before they receive their surface realization.

Realizations
The writing of the sentence, including its spacing, does not prescribe word, syntactic or morpheme boundaries.
Use realizations only when the analysis retains syntax whose collective realization differs from its terminals' own words.
realizations is an array of groups. Each group has exactly two fields:
- nodeIds: a nonempty, duplicate-free array of exact ids in this stage's workspace. A nonterminal id includes its current subtree; overlapping source subtrees count once within a group.
- text: the exact text of the input sentence that these objects collectively realize, made of whole words as the final stage spells them: a nonblank string for one contiguous stretch, or a nonempty array of nonblank strings, in sentence order, for stretches that are not adjacent.
A group says that these existing syntax objects collectively correspond to this exact written text. Groups realize disjoint stretches of the sentence: put all contributors to the same stretch in one group. A source node may contribute to more than one group. The input supplies the spelling; groups do not concatenate, respell, move or fuse nodes, or choose a morphological theory.
Unlike relations, groups record the complete current state: repeat every association that still holds in each later stage, even when its nodes are unchanged. Omit an association until it is established. Record the operation that establishes or changes an association as a relation of that stage, anchored to the group's current nodes, with priorAnchors for the nodes of any association it replaces, and explain it in stageRecord. If several operations could own the same change, use intermediate stages to make the order explicit. A group itself does not name an operation or create a relation.
Groups never override silent, including silence inherited from an ancestor; an entirely silent source domain cannot supply an overt realization. Wordless abstract sources are allowed.`;

export const buildSystemInstruction = (framework = 'minimalism') =>
  (framework === 'xbar' ? XBAR_INSTRUCTION : MINIMALISM_INSTRUCTION) +
  '\n\n' + buildDerivationStagesInstruction(framework);
