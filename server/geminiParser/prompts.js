import { tokenizeSentenceSurfaceOrder } from './surfaceTokens.js';
import { NOTES_RAW_JSON_ONLY_INSTRUCTION } from './systemInstruction.js';

export const buildProGrowthFirstContentsPrompt = (
  sentence,
  framework = 'xbar'
) => {
  const tokens = tokenizeSentenceSurfaceOrder(sentence);
  const tokenText = tokens.join(' | ');
  const tokenIndexText = tokens.map((token, index) => `${index}:${token}`).join(' | ');
  return (
    `Analyze the sentence: "${sentence}" and return a complete syntactic analysis using ` +
    `${framework === 'xbar' ? 'X-Bar Theory (Government and Binding)' : 'The Minimalist Program (Bare Phrase Structure)'} in Babel's Pro Growth-first JSON format. ` +
    `Return raw JSON only, with no markdown, no code fences, no labels, and no prose before or after the JSON object. ` +
    `Return the complete structural analysis in one pass. ` +
    `Return growthFrames plus commitmentGraph only. Do not add extra top-level analysis views on this pass; Babel derives downstream structural views, projected ledgers, and notes after normalization. ` +
    `commitmentGraph is the only model-authored theory ledger and the only authored theory source of truth on this pass. ` +
    `If the analysis turns on a real structural decision, include concise researchTrace entries that record the competing options, the chosen commitment, and the derivational support. researchTrace is an explicit typed decision journal, not raw scratchpad or private monologue. ` +
    `On the Pro route, treat commitmentGraph as a core output for any non-trivial clause rather than optional garnish: return typed commitment entries whenever the derivation commits to case, argument structure, selection, clause-linking dependency, agreement, locality, information structure, voice/valency, operator scope, clause force, interrogative force, or another public theory fact. For domains that truly have nothing to record, omit those commitment kinds rather than padding the graph with empty or generic entries. ` +
    `If the derivation encodes interrogative clause typing through an overt question particle, clause-initial finite verb placement, or movement of a finite head into C, return a matching commitmentGraph entry for clause force and/or interrogative force rather than leaving clause typing only implicit in Growth or only in prose. ` +
    `growthFrames are the only structural source of truth, and commitmentGraph must encode typed facts from that same derivation rather than introducing a second analysis. ` +
    `Use these exact overt input tokens as your pronounced terminals: ${tokenText}. ` +
    `For overt terminal leaves, include tokenIndex values tied to that token list: ${tokenIndexText}. ` +
    `Do not split, rewrite, or duplicate those overt tokens. ` +
    `The latest decisive Growth frame must be a single rooted committed structure whose overt terminals, read left-to-right, spell exactly: ${tokenText}. ` +
    `Do not stop at a pre-convergence frame: continue the derivation until every overt movement and head movement needed for the actual sentence has been encoded and the latest decisive frame itself already realizes the surface order. ` +
    `Before returning JSON, read the overt terminals of that latest decisive frame left-to-right and compare them token-by-token against the input token list. ` +
    `If any overt token is missing, duplicated, reordered, or stranded inside a lower clause, the derivation is incomplete and must be repaired before you answer. ` +
    `${framework === 'minimalism'
      ? `Keep the final committed clause root appropriate to the analysis. `
      : ''}` +
    `Never use positional placeholders as node labels. Encode actual phrase categories and represent specifier/complement status only by structural position in the tree. ` +
    `Every syntax node inside growthFrames must use the canonical nested shape {"id":"...","label":"...","children":[...]}. Do not use alternate field names like nodeId, and never place a child object directly inside a node object without the key "children". If a node has one child, children must still be an array containing that one child. If workspaceForest has one root, it must still be an array containing that root. ` +
    `Return each frame's full workspace forest directly in "workspaceForest" as ordinary structured JSON, not as a stringified blob. The workspaceForest value should be the complete array of syntax roots for that frame. If a frame sets reusePreviousWorkspace:true and the structure truly does not change, you may omit workspaceForest on that frame. If you include commitmentGraph, return each commitment entry as an ordinary JSON object inside the array rather than as a compact JSON string. featureChecking should also remain ordinary structured JSON objects. ` +
    `If movement occurs, make it explicit and keep the derivation internally consistent with the same one movement story. ` +
    `movementEvents are the authoritative movement record on the first pass. ` +
    `Every movementEvents entry must include operation, fromNodeId, toNodeId, traceNodeId, chainId when applicable, and stepId or stepIndex. Do not omit operation on a movementEvents entry. ` +
    `If one dependency moves through multiple copies or phase edges, reuse the same chainId across those Growth frames so the chain remains unified rather than split into isolated hops. ` +
    `If Growth encodes a movement chain, return a matching chains entry for that chain. Do not leave copies and silentCopies empty when the chain is structurally explicit in Growth. An encoded chain is invalid if its copies and silentCopies are both empty. Record the pronounced landing copy and any lower silent copies that belong to that chain. ` +
    `Do not collapse distinct movement dependencies into one frame. If the sentence contains both head movement and phrasal movement, encode them as separate move-like frames with separate chain tracking. ` +
    `A one-frame derivation is acceptable only when the analysis has no movement, no lower trace/copy, no PRO/control/raising/ECM dependency, and no cross-clausal dependency that needs to be made explicit. Otherwise, return at least one earlier structural frame before the final committed frame. ` +
    `On the Pro route, fewer than 4 Growth frames is incomplete unless the sentence is an exceptionally trivial no-movement clause and the derivation truly contains no traces, lower copies, silent heads introduced by movement, or clause-linking dependency. ` +
    `For phrasal movement, the lower source must be the full overt moved phrase before movement, not just one head inside it, and after movement the lower site should be a trace/copy only. ` +
    `Once a phrase has moved, the pronounced landing copy must remain overt at its committed landing site. Do not make both the lower source and the higher landing copy traces or null copies. ` +
    `Lower trace/copy nodes are silent. Do not assign overt text, word, or tokenIndex to a lower trace/copy node. Only the pronounced copy may carry overt token anchoring. If a lower copy survives in Growth or in the committed tree, represent it as an explicit trace/copy node rather than a generic null leaf. ` +
    `If a phrasal copy survives after movement, keep the full phrase shell and make the lower copy an explicit indexed trace/copy rather than leaving blank shells, a generic null leaf, or a bare unindexed t. Use explicit indexed lower-copy notation in the returned Growth JSON; Babel will render subscripts. ` +
    `Do not introduce a trace/copy node before the move-like frame that creates it. Before movement, the lower position must still be the overt phrase/head or an explicitly base-generated null element, not a trace. ` +
    `Base-generated null operators, PRO, and other silent null elements are not traces. Keep them as null elements until a move-like frame turns the lower site into a trace/copy. ` +
    `If an argument is analyzed as surfacing in a higher licensing position, include at least one earlier structural frame where that argument is still present in its lower merge position before the relevant movement or licensing step. ` +
    `If the sentence involves a clause-linking dependency such as raising, control, or ECM, encode that dependency explicitly in commitmentGraph with kind "clausal-dependency" and keep Growth faithful to the same analysis rather than flattening it into one final-state-only frame. ` +
    `Do not encode control as ordinary A-movement: keep the controller in its clause, keep the silent controlled subject distinct, and record the dependency in commitmentGraph with kind "clausal-dependency" rather than inventing a movement chain for it. ` +
    `If one predicate selects an overt finite or non-finite clause as its complement, record that embedding relation in commitmentGraph as a clausal-dependency and a selection commitment; do not leave clause embedding only implicit in the tree or only in prose. ` +
    `The latest decisive Growth frame must realize the entire input sentence, not only an embedded clause or another partial substructure. Do not stop after a lower clause, VP shell, or any incomplete workspace: finish with one committed frame whose overt terminals match the full sentence in order. ` +
    `For control, raising, or ECM on the Pro route, commitmentGraph entries of kind "clausal-dependency" must name the relation participants explicitly with controllerLabel/dependentLabel or the appropriate raised/dependent labels, and should include predicateLabel and clauseLabel whenever those can be read from the committed derivation. ` +
    `Do not leave hidden movement implicit. If the latest decisive frame contains any trace/copy node or other movement reflex, Growth must also contain the corresponding explicit move-like frame(s). ` +
    `Every lower silent copy in chains must be licensed by a matching explicit move-like frame in Growth for that same chain. If a chain has multiple lower silent copies, encode multiple hops instead of one packed jump. ` +
    `Every visible trace/copy in the committed tree must correspond one-to-one with an explicit move-like frame in Growth. If you cannot show the hop, do not include the trace/copy. ` +
    `If one chain moves through more than one landing site, preserve each intermediate copy as a distinct node with its own node id so the derivation can draw each hop separately rather than collapsing all arrows onto one landing site. ` +
    `If a chain crosses more than one landing site or edge, encode each hop as its own explicit movement frame with the same chainId. ` +
    `If the committed analysis contains overt phrasal movement to a higher position, a derivation that encodes only head movement is incomplete: include the corresponding phrasal movement frame and a matching movementEvents entry whose toNodeId is the committed higher landing site and whose fromNodeId/traceNodeId reflect the lower position. ` +
    `If the committed analysis contains overt head movement to a higher clausal head position, encode the corresponding HeadMove explicitly and return a matching movementEvents entry whose toNodeId is that committed higher landing site rather than leaving the head only in a lower position. ` +
    `If you encode a HeadMove derivation step, you must also return a matching movementEvents entry for that same head movement with operation, fromNodeId, toNodeId, traceNodeId, chainId, and stepIndex. A HeadMove step without a matching movementEvents entry is invalid. ` +
    `For head movement, the lower source must be a lower head or head-copy, not a whole phrase containing that head. ` +
    `${framework === 'xbar'
      ? `Head movement must not destroy X-bar structure. After head movement into a higher head position, keep the lower head inside its original bar-level shell as a trace/copy and keep the landing head in the higher head position; do not leave both the moved head and its bar-level shell as separate sisters under the maximal projection. `
      : `If head movement is encoded, keep the lower copy and higher landing explicit without introducing hybrid X-bar-style shells or duplicate overt heads. `}` +
    `Do not relocate a lexical verb, adjective, or preposition into a higher functional head position unless the derivation explicitly encodes that head movement. If no overt head movement is intended, keep the lexical item in its base head and realize finiteness or clause typing through the appropriate functional head instead of replacing the lower lexical site with a bare trace. ` +
    `For head movement landing sites, represent one overt landed head and one lower trace/copy, not malformed shells that branch a higher clausal head into an overt lower head plus a null copy. ` +
    `If a movement chain has an overt landing copy in Growth or in the committed tree, record that landed copy explicitly in copies and pronouncedCopy. Head-movement chains must include the overt landed head in copies/pronouncedCopy and the lower silent trace/copy in silentCopies. ` +
    `growthFrames must form a dense frame-by-frame derivational timeline. Use a separate frame for each meaningful lexical selection, projection, external merge, feature-licensing/case/EPP event, movement event, and spellout event. ` +
    `Do not compress several derivational operations into one frame or collapse lexical selection, projection, and merge into one step. ` +
    `Do not compress an entire clause-sized structure into the first Growth frame. The first frame should contain only the material introduced by that step, not a nearly complete clause. ` +
    `Do not use filler Growth frames that merely restate the same committed tree with no new structural change. Every returned frame must earn its place by introducing, merging, licensing, moving, or spelling out something new. ` +
    `Return separate Growth frames for separate derivational operations whenever you can. Use "microOperations" only as a last-resort disclosure device when one returned frame genuinely summarizes more than one local action because you could not safely emit finer-grained structural states; do not rely on microOperations as the normal strategy. ` +
    `A Growth analysis is invalid if its only returned structure is a fragment such as a lone DP, NP, VP shell, or embedded subclause rather than the full clause being analyzed. Even the simplest finite clause must continue until the derivation reaches a full committed clause, not stop after building one phrase. ` +
    `Prefer enough structural Growth frames to keep lower merge, licensing, intermediate landing sites, and final landing sites distinct whenever those are distinct commitments in the derivation. Long-distance, raising/control, or successive-cyclic dependencies should therefore normally surface as richer multi-frame timelines rather than as one compressed jump. ` +
    `Prefer canonical operation names such as LexicalSelect, Project, ExternalMerge, Agree, A-Move, AbarMove, HeadMove, SpellOutDomain, and SpellOut. Do not use the generic operation name "Other" when one of those specific operations fits the step. ` +
    `Each Growth frame must include stepId and operation. Include workspaceForest unless reusePreviousWorkspace:true is enough because the structural workspace is unchanged. ` +
    `Include affectedNodeIds, chainId, featureChecking, thetaRole, spelloutDomain, or note only when they express an explicit commitment in that frame. If you include frame.note or frame.recipe, it must name the actual structural change in that frame; never use stock boilerplate such as "Initial logic and parameters are validated", "Standard processing applied", "Final transformation". ` +
    `When a step changes licensing or feature state without changing overt tree shape, you may set reusePreviousWorkspace: true instead of repeating an identical workspaceForest, but you must still record that step explicitly. ` +
    `Do not leave case, EPP, agreement, or wh-licensing only implicit. When those commitments are part of the analysis, encode them inside the relevant Growth frames through featureChecking and, when straightforward, on the relevant node via case, assigner, caseEvidence, or caseOvert, and mirror the public commitment in commitmentGraph. ` +
    `If the analysis explicitly commits to Nominative, Accusative, Dative, Genitive, Ergative, Absolutive, or another morphological/syntactic case value, return matching commitmentGraph entries with kind "case" and/or matching featureChecking on the relevant derivational step; do not leave case values only implicit. On the Pro route, explicit case claims require commitmentGraph entries with kind "case" unless the case value is already fully and unambiguously represented in featureChecking on the relevant derivational step. ` +
    `If you return commitmentGraph entries with kind "case", each entry must identify the assignee explicitly with nodeId or assigneeLabel, not just the case value and assigner. If you return commitmentGraph entries with kind "argument-structure", each entry must identify the referent and predicate explicitly rather than leaving them implicit. Do not emit partial theta-role entries like { role: "Agent", predicate: "eat" } with no referent. If the argument is not explicit, omit that entry rather than returning a half-specified one. ` +
    `If you include typed commitments such as case, argument structure, selection, binding, agreement, locality, linearization, information structure, or clausal dependency, make them visible in Growth and/or commitmentGraph rather than leaving them only implicit or only in prose. Anchor commitmentGraph entries back into the derivation with stepIds and/or nodeIds whenever the relevant support is identifiable in Growth. ` +
    `On the Pro route, if the analysis explicitly commits to a language-supported theta-role or other argument-structure relation, return matching commitmentGraph entries with kind "argument-structure" rather than leaving those commitments only implicit. Each such entry must name both the predicate and the argument referent explicitly in readable linguistic terms rather than leaving one side implicit. Use the most specific argument-structure label that is actually supported by the committed derivation and the language-specific predicate semantics; otherwise do not promote the claim beyond what the analysis supports. If the analysis explicitly commits to an argument-structure relation or a selector-selectee relation, return matching commitmentGraph entries with kind "argument-structure" and "selection" rather than leaving those commitments only implicit. Explicit argument-structure claims require commitmentGraph entries with kind "argument-structure" on the Pro route. ` +
    `Treat commitmentGraph as typed summaries of facts that are already explicit in growthFrames, not as an independent second analysis. Do not use commitmentGraph to introduce a syntactic fact that is not already encoded in the derivation. When you include a commitmentGraph entry, anchor it back into the derivation with stepIds and/or nodeIds whenever the relevant support is identifiable in Growth. If the analysis explicitly commits to a head selecting two complements or a complement plus a specifier, commitmentGraph entries with kind "selection" must name that selector and those selected dependents explicitly rather than returning a vague placeholder. Do not emit selector-only entries with no selectedCategory or selectedLabel. When a public commitment names a referent, predicate, clause, phrase, or head that is overtly recoverable from the committed tree, use a readable recoverable linguistic label rather than an internal placeholder, node id, or other implementation-only name. ` +
    `Do not let commitmentGraph outrun the derivation. If a typed commitment would mention case, theta roles, selector/selectee relations, agreement, control, binding, locality, predication, or linearization but the matching fact is not encoded in growthFrames, omit or simplify that commitment entry rather than asserting unsupported detail. ` +
    `Movement does not cancel ordinary predicate-argument bookkeeping. If an XP moves, still return the same commitmentGraph facts for case, argument structure, and selection that would hold of its base-generated role and selector relation; do not drop those commitments merely because the sentence is a wh-question, topicalization, or another fronting configuration. ` +
    `For raising, control, or ECM analyses, commitmentGraph entries with kind "clausal-dependency" are required rather than optional on the Pro route. Use subtype labels when appropriate, such as subject-control, object-control, raising-to-subject, raising-to-object, or ECM. For explicit argument-structure claims, commitmentGraph entries with kind "argument-structure" are required rather than optional on the Pro route. ` +
    `If the analysis explicitly commits to control, raising, or ECM, commitmentGraph entries with kind "clausal-dependency" must include the matching type and the most specific compatible subtype rather than leaving subtype as a generic placeholder like "control" or "raising". ` +
    `If the analysis explicitly commits to a predicate selecting an embedded clause, return a matching commitmentGraph entry with kind "clausal-dependency" for that clause embedding rather than leaving the embedding relation only implicit. Use a type such as finite-complement when the embedded clause is an ordinary finite complement and no more specific raising/control/ECM subtype is intended. ` +
    `If the analysis explicitly commits to head selection, binding domains, Principle A/B/C-style dependencies, or raising/control/ECM relations, record those in commitmentGraph with kinds such as "selection", "binding", or "clausal-dependency" rather than leaving them only implicit. On the Pro route, explicit Principle A/B/C or reflexive/anaphor commitments require commitmentGraph entries with kind "binding". ` +
    `FINAL CHECK: return one coherent JSON answer only. growthFrames must be the authoritative derivation, and the latest decisive Growth frame must be sufficient for Babel to derive the downstream committed structure. Count your growthFrames before returning: fewer than 4 frames on the Pro route is incomplete. Favor structural clarity and explicit derivational truth over unnecessary bookkeeping.`
  );
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
  `If the frozen analysis includes researchTrace, treat it as the preserved first-pass decision journal and reuse it when explaining why the committed analysis was chosen. ` +
  `Use only ids that already exist in the frozen analysis JSON. Do not invent chainIds, stepIds, nodeIds, supportIds, or typed ledger ids. ` +
  `Every returned noteBinding item must use the field "text" for its prose. Do not use "explanation", "content", or "note" as the prose field name. ` +
  `If a public chain exists, reuse its chainId. If no public chain exists, anchor movement notes with stepIds and/or nodeIds only and do not invent a new chainId. ` +
  `The first returned noteBinding must have kind "architecture" and must summarize the final committed clause architecture, embedding, selection, and headedness rather than movement or closure. Do not use the architecture note as a spellout summary or a generic wrap-up sentence. ` +
  `Architecture notes should describe clause architecture, selection, and headedness rather than movement. ` +
  `Chain notes should describe only movement that is already encoded in movementEvents/growthFrames. ` +
  `Licensing notes should describe only case, theta-role, agreement, control, raising, ECM, or similar licensing facts that are already encoded and supported by the frozen ledgers. ` +
  `Closure notes are optional and must not introduce any new technical claim. ` +
  `If a typed ledger is missing, simplify the note rather than mentioning that typed domain. ` +
  `Every noteBinding must carry anchors back into the frozen analysis through chainId, stepIds, nodeIds, supportIds, researchTraceIds, and matching typed ids when relevant. ` +
  `Do not output explanations outside noteBindings, and do not include boilerplate such as "standard processing applied".`
);
