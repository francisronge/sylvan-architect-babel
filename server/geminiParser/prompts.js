import { tokenizeSentenceSurfaceOrder } from './surfaceTokens.js';
import { NOTES_RAW_JSON_ONLY_INSTRUCTION } from './systemInstruction.js';

export const buildProGrowthFirstContentsPrompt = (
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
    `Return derivationStages on this pass. Do not add top-level movementEvents, chains, commitmentGraph, other top-level ledgers, noteBindings, or growthFrames on this pass. Babel compiles downstream structural views and notes after normalization, with final noteBindings derived from derivationStages.`,
    `Choose the strongest supported analysis inside the selected framework, not the most familiar one and not the most exotic one for its own sake.`,
    `Before writing JSON, silently establish the ordered derivational proof that makes the analysis true inside the selected framework.`,
    `Build one forward derivation. Do not begin from a completed final tree and backfill checkpoints afterward.`,
    `Use the system derivationStages contract.`,
    `Return at least four real derivationStages when possible.`,
    `Never return only one or two derivationStages.`,
    `derivationStages are the public proof of the analysis, not a construction log or caption sequence.`,
    `A stage is warranted when it makes a structural claim a later stage relies on, or when skipping it would make the next stage unexplained.`,
    `Four is a floor; split hidden commitments. No lexical shortcuts for syntactically derived surface forms; keep functional heads explicit when pronunciation anchors elsewhere.`,
    `Each derivation stage must contain exactly four fields, written inside the stage object in this order: "statement", "stageRecord", "visualRelations", "workspaceForest".`,
    `Never put statement, stageRecord, or visualRelations on the analysis object.`,
    `"statement" is a concise reader-facing headline for the stage.`,
    `"visualRelations" is a required array for relations from this stageRecord that should be visually marked on this stage; use [] only when no relation should be visually marked.`,
    `Each visualRelations item has a short open "relation" string and an "anchors" object whose open role names point to node ids in this stage's expanded workspace; anchor values may be node ids or arrays of node ids.`,
    `Do not introduce a visualRelation whose relation is absent from stageRecord.`,
    `visualRelations is not prose and not a second analysis.`,
    `stageRecord must be a required prose string containing substantive framework-internal prose for that exact stage. It is not metadata and not key-value bookkeeping, and not a restatement of statement.`,
    `Each stageRecord must explain why this workspace is a legitimate next derivational state.`,
    `Operations matter only as witnesses for the claim; do not let stageRecord become an inventory of operations.`,
    `Write stageRecord prose specific enough that it would become false or incomplete for a materially different sentence.`,
    `If one stage contains several local operations, stageRecord must say what single syntactic claim they jointly establish. If no single claim unifies them, separate the material into different derivationStages.`,
    `derivationStages are substantive derivational stages, not atomic replay steps; Babel compiles smaller replay operations downstream.`,
    `Describe each stage from its own present derivational state. Do not use a later outcome to name, justify, or structure earlier material.`,
    `Keep stageRecord reader-facing: no node ids, lineage ids, token indexes, JSON field names, or implementation identifiers in prose.`,
    `Long JSON strings are valid; do not thin derivational prose for compactness.`,
    `Keep workspaceForest compact. After a subtree has already been introduced, reuse it with {"refId":"existingNodeId"} whenever that subtree is unchanged at the current stage.`,
    `Rewrite only the material that is new or structurally changed in the current stage. Do not use the same refId twice in one stage.`,
    `Every item in workspaceForest and every item in any children array must be either a full syntax node {"id":"...","label":"...","children":[...]} or an unchanged-subtree stub {"refId":"existingNodeId"}. Never emit {}. For a true leaf, use "children":[].`,
    `Use these exact overt input tokens as your pronounced terminals: ${tokenText}.`,
    `For overt terminal leaves, include tokenIndex values tied to that token list: ${tokenIndexText}.`,
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
    `Do not author stage fields other than workspaceForest, statement, stageRecord, and visualRelations. Do not author after, change, continuityIds, movementEvents, chains, commitmentGraph, noteBindings, frame.movement, or frame.publicFacts.`,
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
) => buildProGrowthFirstContentsPrompt(sentence, framework);

export const buildParseContentsPrompt = (
  sentence,
  framework = 'xbar',
  modelRoute = 'pro'
) => {
  const basePrompt = buildSingleParseContentsPrompt(sentence, framework, modelRoute);
  return basePrompt;
};

export const NOTES_SECOND_PASS_MAX_OUTPUT_TOKENS = 8192;
export const NOTES_SECOND_PASS_TEMPERATURE = 0.2;

export const buildNotesSecondPassSystemInstruction = (framework = 'xbar') => (
  `${NOTES_RAW_JSON_ONLY_INSTRUCTION} ` +
  `You are writing Babel noteBindings only. The syntactic analysis is already frozen and committed. ` +
  `Do not choose a new analysis, do not revise syntax, and do not invent new movement, ledgers, ids, or structural commitments. ` +
  `Write compact scientific noteBindings that explain only the provided committed ${framework === 'xbar' ? 'X-Bar' : 'Minimalist'} analysis. ` +
  `Use only ids that already exist in the frozen analysis JSON. Do not invent chainIds, stepIds, nodeIds, supportIds, or commitmentFactIds. ` +
  `Every returned noteBinding item must use the field "text" for its prose. Do not use "explanation", "content", or "note" as the prose field name. ` +
  `If a public chain exists, reuse its chainId. If no public chain exists, anchor movement notes with stepIds and/or nodeIds only and do not invent a new chainId. ` +
  `The first returned noteBinding must have kind "architecture" and must summarize only the committed clause architecture and supported structural commitments already encoded in the frozen derivation. Do not use the architecture note as a spellout summary or a generic wrap-up sentence. ` +
  `Architecture notes should stay structural and should mention selection, embedding, dependency, or licensing claims only when the frozen growthFrames and commitmentFacts already support those claims. ` +
  `Chain notes should describe only movement that is already encoded in movementEvents/growthFrames. ` +
  `Licensing and structural notes should describe only public facts that are already encoded and supported by the frozen commitmentFacts and derivation. ` +
  `Closure notes are optional and must not introduce any new technical claim. ` +
  `If a supporting commitmentFact is missing, simplify the note rather than mentioning that public fact. ` +
  `Every noteBinding must carry anchors back into the frozen analysis through chainId, stepIds, nodeIds, supportIds, and commitmentFactIds when relevant. ` +
  `Do not output explanations outside noteBindings, and do not include boilerplate such as "standard processing applied".`
);
