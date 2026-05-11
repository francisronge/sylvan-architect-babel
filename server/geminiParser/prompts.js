import { tokenizeSentenceSurfaceOrder } from './surfaceTokens.js';

export const buildProDerivationFirstContentsPrompt = (
  sentence,
  framework = 'xbar'
) => {
  const tokens = tokenizeSentenceSurfaceOrder(sentence);
  const tokenText = tokens.join(' | ');
  const tokenIndexText = tokens.map((token, index) => `${index}:${token}`).join(' | ');
  const frameworkName = framework === 'xbar'
    ? 'X-Bar Theory (Government and Binding)'
    : 'The Minimalist Program (Bare Phrase Structure)';
  const instructions = [
    `Analyze the sentence: "${sentence}" and return a complete syntactic analysis using ${frameworkName} in Babel's Pro Derivation JSON format.`,
    `Return raw JSON only, with no markdown, no code fences, no labels, and no prose before or after the JSON object.`,
    `Return the complete structural analysis in one pass.`,
    `Return derivationStages on this pass. Do not add fields outside the contract requested here. Babel compiles downstream structural views and notes after normalization.`,
    `Choose the strongest supported analysis inside the selected framework, not the most familiar one and not the most exotic one for its own sake.`,
    `Before writing JSON, silently establish the ordered derivational proof that makes the analysis true inside the selected framework.`,
    `For each analysis you return, build one forward derivation. Do not begin from a completed final tree and backfill checkpoints afterward.`,
    `If the sentence has clear structural ambiguity, return one complete analysis for each structurally distinct reading, up to two analyses.`,
    `Use the system derivationStages contract.`,
    `Return at least four real derivationStages when possible.`,
    `Never return only one or two derivationStages.`,
    `derivationStages are the public proof of the analysis, not a construction log or caption sequence.`,
    `A stage is warranted when it makes a structural claim a later stage relies on, or when skipping it would make the next stage unexplained.`,
    `Four is a floor; split hidden commitments. No lexical shortcuts for syntactically derived surface forms; keep functional heads explicit when pronunciation anchors elsewhere.`,
    `Each derivation stage must contain exactly four fields, written inside the stage object in this order: "statement", "stageRecord", "visualRelations", "workspaceForest".`,
    `Never put statement, stageRecord, or visualRelations on the analysis object.`,
    `"statement" is a concise reader-facing headline for the stage.`,
    `"visualRelations" is a required array for relations from this stageRecord that should be visually marked on this stage; use [] when the stage needs no extra drawn relation beyond ordinary tree geometry.`,
    `Each visualRelations item has a short open "relation" string and an "anchors" object whose open role names point to node ids in this stage's expanded workspace; anchor values may be node ids or arrays of node ids.`,
    `Every visualRelations anchor value must be the exact id of a node present in that same stage's expanded workspaceForest. Expanded means after resolving any refId used by that stage.`,
    `Do not create anchor ids by naming an intended copy, future landing, or old occurrence. If the visual relation belongs to this stage, first make both endpoints real in workspaceForest, then point anchors to those exact ids.`,
    `Before returning JSON, check every visualRelations anchor against its own stage workspaceForest. If any anchor does not resolve there, repair the stage before answering.`,
    `Do not introduce a visualRelation whose relation is absent from stageRecord.`,
    `visualRelations is not prose and not a second analysis.`,
    `An empty visualRelations array is complete and correct when the stage needs no extra drawn relation beyond the ordinary tree geometry.`,
    `visualRelations is only for relations that need an additional visual mark beyond ordinary workspaceForest branching. If ordinary tree geometry already shows the relation, keep it in stageRecord and workspaceForest and do not repeat it in visualRelations.`,
    `Do not use visualRelations for ordinary mother-daughter or sisterhood relations already encoded by workspaceForest branching. A relation that is visible solely by reading the branches belongs in stageRecord and workspaceForest, not visualRelations.`,
    `stageRecord must be a required prose string containing substantive framework-internal prose for that exact stage. It is not metadata and not key-value bookkeeping, and not a restatement of statement.`,
    `Each stageRecord must explain why this workspace is a legitimate next derivational state.`,
    `Operations matter only as witnesses for the claim; do not let stageRecord become an inventory of operations.`,
    `Write stageRecord prose specific enough that it would become false or incomplete for a materially different sentence.`,
    `If one stage contains several local operations, stageRecord must say what single syntactic claim they jointly establish. If no single claim unifies them, separate the material into different derivationStages.`,
    `derivationStages are substantive derivational stages, not atomic replay steps; Babel compiles smaller replay operations downstream.`,
    `Describe each stage from its own present derivational state. Do not use a later outcome to name, justify, or structure earlier material.`,
    `A stage workspaceForest is not an inventory of future lexical items. Do not include a head or subtree until that stage has selected it, projected it, merged it, copied it, moved it, or otherwise made it part of the public derivational state. Do not park future material as detached workspace roots.`,
    `The highest root may appear only after the lower workspace it dominates has already been built. Do not introduce a full clausal root before the stage sequence has publicly built its dominated lexical and functional spine.`,
    `If a stage introduces a high functional shell, it must preserve lower structure that is already public in earlier stages or build that lower structure inside the same coherent stage; it must not be the first unexplained appearance of the whole derivation.`,
    `Keep stageRecord reader-facing: no node ids, lineage ids, token indexes, JSON field names, or implementation identifiers in prose.`,
    `Long JSON strings are valid; do not thin derivational prose for compactness.`,
    `Keep workspaceForest compact. After a subtree has already been introduced, reuse it with {"refId":"existingNodeId"} whenever that subtree is unchanged at the current stage.`,
    `Node ids are derivational identities, not per-stage serials; reuse each id while its object persists.`,
    `Do not rename unchanged leaves; true new copies/occurrences get new ids linked by lineageId.`,
    `Rewrite only the material that is new or structurally changed in the current stage. Do not use the same refId twice in one stage.`,
    `Every workspaceForest item and child must be either {"id":"...","label":"...","children":[...]} or {"refId":"existingNodeId"}. Leaves still need id, label, and "children":[]; never emit word-only leaves or {}.`,
    `Use these exact overt input tokens as your pronounced terminals: ${tokenText}.`,
    `For overt terminal leaves, include tokenIndex values tied to that token list: ${tokenIndexText}.`,
    `For terminal leaves, "label" is the syntactic item and "word" is the exact pronounced input token when the orthographic token differs from the syntactic label.`,
    `Every pronounced terminal must carry tokenIndex. Every terminal without tokenIndex must include "silent": true.`,
    `Do not split, rewrite, or duplicate those overt tokens. In the latest decisive stage, each tokenIndex from the input list may appear on exactly one non-silent terminal leaf.`,
    `The latest decisive derivation stage must be a single rooted committed structure whose overt terminals, read left-to-right, spell exactly: ${tokenText}.`,
    `Do not stop at a pre-convergence frame. Continue until the latest decisive frame itself already realizes the surface order.`,
    `Before returning JSON, read the overt terminals of that latest decisive frame left-to-right and compare them token-by-token against the input token list.`,
    `If any overt token is missing, duplicated, reordered, or stranded inside an unfinished lower structure, repair the derivation before you answer.`,
    framework === 'minimalism'
      ? `Keep the final committed clause root appropriate to the analysis.`
      : '',
    `Never use positional placeholders as node labels. Encode actual phrase categories and represent specifier/complement status only by structural position in the tree.`,
    `Every syntax node inside derivationStages must use the canonical nested shape {"id":"...","label":"...","children":[...]}. If a node has one child, children must still be an array. If workspaceForest has one root, it must still be an array.`,
    `Return each stage's full workspace forest directly in "workspaceForest" as ordinary structured JSON, not as a stringified blob.`,
    `Do not author stage fields other than workspaceForest, statement, stageRecord, and visualRelations.`,
    `Lower trace/copy nodes are silent. Only the pronounced copy may carry overt token anchoring.`,
    `If a lower copy survives in derivationStages or in the committed tree, represent it as an explicit trace/copy node rather than a generic null leaf.`,
    `FINAL CHECK: return one coherent JSON answer only. derivationStages are authoritative, and the latest decisive stage must be sufficient for Babel to derive the downstream committed structure. Favor structural clarity, explicit derivational truth, and real stages over compressed summaries.`
  ].filter(Boolean);
  return instructions.join(' ');
};

export const buildSingleParseContentsPrompt = (
  sentence,
  framework = 'xbar',
  modelRoute = 'pro'
) => buildProDerivationFirstContentsPrompt(sentence, framework);

export const buildParseContentsPrompt = (
  sentence,
  framework = 'xbar',
  modelRoute = 'pro'
) => {
  const basePrompt = buildSingleParseContentsPrompt(sentence, framework, modelRoute);
  return basePrompt;
};
