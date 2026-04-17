import { NOTES_RAW_JSON_ONLY_INSTRUCTION } from './systemInstruction.js';

const normalizeOptionalText = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed || '';
};

const pruneEmptyPromptContext = (value) => {
  if (Array.isArray(value)) {
    const next = value
      .map((item) => pruneEmptyPromptContext(item))
      .filter((item) => typeof item !== 'undefined');
    return next.length > 0 ? next : undefined;
  }

  if (value && typeof value === 'object') {
    const next = Object.entries(value).reduce((acc, [key, entry]) => {
      const pruned = pruneEmptyPromptContext(entry);
      if (typeof pruned !== 'undefined') {
        acc[key] = pruned;
      }
      return acc;
    }, {});
    return Object.keys(next).length > 0 ? next : undefined;
  }

  if (typeof value === 'string') {
    return value.trim() ? value : undefined;
  }

  if (value === null || typeof value === 'undefined') return undefined;
  return value;
};

export const buildNotesSecondPassFrozenAnalysis = (analysis = {}) => (
  pruneEmptyPromptContext({
    growthFrames: analysis.growthFrames || [],
    derivationSteps: analysis.derivationSteps || [],
    movementEvents: analysis.movementEvents || [],
    chains: analysis.chains || [],
    commitmentGraph: analysis.commitmentGraph || [],
    researchTrace: analysis.researchTrace || [],
    caseAssignments: analysis.caseAssignments || [],
    argumentStructure: analysis.argumentStructure || [],
    phaseLog: analysis.phaseLog || [],
    morphologyRealization: analysis.morphologyRealization || [],
    featureLedger: analysis.featureLedger || [],
    selectionLedger: analysis.selectionLedger || [],
    linearizationLedger: analysis.linearizationLedger || [],
    bindingLedger: analysis.bindingLedger || [],
    clausalDependencies: analysis.clausalDependencies || [],
    agreementLedger: analysis.agreementLedger || [],
    predicateClassLedger: analysis.predicateClassLedger || [],
    probeLedger: analysis.probeLedger || [],
    nullElementLedger: analysis.nullElementLedger || [],
    diagnosticLedger: analysis.diagnosticLedger || [],
    parameterLedger: analysis.parameterLedger || [],
    informationStructureLedger: analysis.informationStructureLedger || [],
    operatorScopeLedger: analysis.operatorScopeLedger || [],
    voiceValencyLedger: analysis.voiceValencyLedger || [],
    localityLedger: analysis.localityLedger || [],
    predicationLedger: analysis.predicationLedger || [],
    particleLedger: analysis.particleLedger || [],
    evidentialityLedger: analysis.evidentialityLedger || [],
    mirativityLedger: analysis.mirativityLedger || [],
    honorificityLedger: analysis.honorificityLedger || [],
    switchReferenceLedger: analysis.switchReferenceLedger || [],
    logophoraLedger: analysis.logophoraLedger || [],
    eventStructureLedger: analysis.eventStructureLedger || [],
    surfaceOrder: analysis.surfaceOrder || [],
    framework: analysis.provenance?.framework,
    treeSource: analysis.provenance?.treeSource,
    completenessStatus: analysis.completenessStatus
  }) || {}
);

export const buildNotesSecondPassSupportInventory = (
  analysis = {},
  { normalizeChainType }
) => {
  const normalizedCommitmentFacts = (Array.isArray(analysis.commitmentGraph) ? analysis.commitmentGraph : [])
    .map((entry) => {
      const factId = normalizeOptionalText(entry?.factId || entry?.id);
      const kind = normalizeOptionalText(entry?.kind);
      return factId && kind ? { factId, kind } : null;
    })
    .filter(Boolean);

  const normalizedEntries = (entries, idFields) =>
    (Array.isArray(entries) ? entries : [])
      .map((entry) => {
        for (const field of idFields) {
          const value = normalizeOptionalText(entry?.[field]);
          if (value) return value;
        }
        return '';
      })
      .filter(Boolean);

  const typedIds = pruneEmptyPromptContext({
    featureEntryIds: normalizedEntries(analysis.featureLedger, ['entryId', 'id']),
    phaseIds: normalizedEntries(analysis.phaseLog, ['phaseId', 'id']),
    morphologyIds: normalizedEntries(analysis.morphologyRealization, ['realizationId', 'morphologyId', 'id']),
    caseAssignmentIds: normalizedEntries(analysis.caseAssignments, ['assignmentId', 'caseAssignmentId', 'id']),
    argumentIds: normalizedEntries(analysis.argumentStructure, ['argumentId', 'id']),
    selectionIds: normalizedEntries(analysis.selectionLedger, ['selectionId', 'id']),
    bindingIds: normalizedEntries(analysis.bindingLedger, ['bindingId', 'id']),
    dependencyIds: normalizedEntries(analysis.clausalDependencies, ['dependencyId', 'id']),
    agreementIds: normalizedEntries(analysis.agreementLedger, ['agreementId', 'id']),
    predicateClassIds: normalizedEntries(analysis.predicateClassLedger, ['predicateClassId', 'id']),
    probeIds: normalizedEntries(analysis.probeLedger, ['probeId', 'id']),
    nullElementIds: normalizedEntries(analysis.nullElementLedger, ['nullElementId', 'id']),
    diagnosticIds: normalizedEntries(analysis.diagnosticLedger, ['diagnosticId', 'id']),
    parameterIds: normalizedEntries(analysis.parameterLedger, ['parameterId', 'id']),
    informationStructureIds: normalizedEntries(analysis.informationStructureLedger, ['informationStructureId', 'id']),
    operatorScopeIds: normalizedEntries(analysis.operatorScopeLedger, ['operatorScopeId', 'id']),
    voiceValencyIds: normalizedEntries(analysis.voiceValencyLedger, ['voiceValencyId', 'id']),
    linearizationIds: normalizedEntries(analysis.linearizationLedger, ['linearizationId', 'id']),
    localityIds: normalizedEntries(analysis.localityLedger, ['localityId', 'id']),
    predicationIds: normalizedEntries(analysis.predicationLedger, ['predicationId', 'id']),
    particleIds: normalizedEntries(analysis.particleLedger, ['particleId', 'id']),
    evidentialityIds: normalizedEntries(analysis.evidentialityLedger, ['evidentialityId', 'id']),
    mirativityIds: normalizedEntries(analysis.mirativityLedger, ['mirativityId', 'id']),
    honorificityIds: normalizedEntries(analysis.honorificityLedger, ['honorificityId', 'id']),
    switchReferenceIds: normalizedEntries(analysis.switchReferenceLedger, ['switchReferenceId', 'id']),
    logophoraIds: normalizedEntries(analysis.logophoraLedger, ['logophoraId', 'id']),
    eventStructureIds: normalizedEntries(analysis.eventStructureLedger, ['eventStructureId', 'id']),
    researchTraceIds: normalizedEntries(analysis.researchTrace, ['decisionId', 'traceId', 'id'])
  }) || {};

  const commitmentFactIds = normalizedCommitmentFacts.map((entry) => entry.factId);
  const commitmentFactIdsByKind = pruneEmptyPromptContext(
    normalizedCommitmentFacts.reduce((acc, entry) => {
      if (!acc[entry.kind]) acc[entry.kind] = [];
      acc[entry.kind].push(entry.factId);
      return acc;
    }, {})
  ) || {};

  const chains = (Array.isArray(analysis.chains) ? analysis.chains : [])
    .map((chain) => ({
      chainId: normalizeOptionalText(chain?.chainId || chain?.id),
      type: normalizeChainType(chain?.type) || undefined
    }))
    .filter((entry) => entry.chainId);

  const availableTypedDomains = Object.entries(typedIds)
    .filter(([, ids]) => Array.isArray(ids) && ids.length > 0)
    .map(([field]) => field);
  const missingTypedDomains = Object.keys(typedIds)
    .filter((field) => !Array.isArray(typedIds[field]) || typedIds[field].length === 0);

  return pruneEmptyPromptContext({
    chains,
    commitmentFactIds,
    commitmentFactIdsByKind,
    typedIds,
    availableTypedDomains,
    missingTypedDomains
  }) || {};
};

export const buildNotesSecondPassPrompt = (
  sentence,
  framework = 'xbar',
  analysis = {},
  { normalizeChainType }
) => {
  const frozenAnalysis = buildNotesSecondPassFrozenAnalysis(analysis);
  const supportInventory = buildNotesSecondPassSupportInventory(analysis, { normalizeChainType });
  return (
    `${NOTES_RAW_JSON_ONLY_INSTRUCTION} ` +
    `If researchTrace is present below, treat it as preserved first-pass decision context and, when helpful, summarize that preserved reasoning in one or two noteBindings rather than inventing new rationale. ` +
    `commitmentGraph is the primary theory layer. If a typed claim is not supported by matching commitmentFactIds and is not mirrored in a projected typed ledger, simplify the note instead of mentioning that typed domain. ` +
    `Support is note-local, not global. If one note mentions passive voice, case, theta roles, locality, scope, or another typed domain, that same note must carry the matching commitmentFactIds and, when present, the matching typed ids even if another note elsewhere already cites the same ledger entry. ` +
    `Self-audit each note before returning it: ` +
    `feature-checking / EPP / valuation language requires commitmentFactIds of kind "feature" and, when present, featureEntryIds; phase / transfer / spell-out-domain language requires commitmentFactIds of kind "phase" and, when present, phaseIds; morphology / exponence / allomorphy language requires commitmentFactIds of kind "morphology" and, when present, morphologyIds; ` +
    `case language requires commitmentFactIds of kind "case" and, when present, caseAssignmentIds; theta-role / external-argument / internal-argument language requires commitmentFactIds of kind "argument-structure" and, when present, argumentIds; ` +
    `scope or question-operator language requires commitmentFactIds of kind "operator-scope" and, when present, operatorScopeIds; locality or successive-cyclic language requires commitmentFactIds of kind "locality" and, when present, localityIds; ` +
    `voice or passive language requires commitmentFactIds of kind "voice-valency" and, when present, voiceValencyIds; topic/focus/information-structure language requires commitmentFactIds of kind "information-structure" and, when present, informationStructureIds; ` +
    `particle / clause-typing-particle / discourse-particle language requires commitmentFactIds of kind "particle" and, when present, particleIds; evidential language requires commitmentFactIds of kind "evidentiality" and, when present, evidentialityIds; mirative language requires commitmentFactIds of kind "mirativity" and, when present, mirativityIds; honorific / politeness language requires commitmentFactIds of kind "honorificity" and, when present, honorificityIds; ` +
    `switch-reference language requires commitmentFactIds of kind "switch-reference" and, when present, switchReferenceIds; logophoric language requires commitmentFactIds of kind "logophora" and, when present, logophoraIds; event-structure / lexical-aspect language requires commitmentFactIds of kind "event-structure" and, when present, eventStructureIds; ` +
    `predicate-class words like unaccusative, control predicate, or raising predicate require commitmentFactIds of kind "predicate-class" and, when present, predicateClassIds; ` +
    `null-element words like silent complementizer or expletive require commitmentFactIds of kind "null-element" and, when present, nullElementIds; ` +
    `parameter/probe language requires commitmentFactIds of kind "parameter" or "probe" and, when present, parameterIds/probeIds; ` +
    `word-order / V1 / V2 / verb-second / head-final / head-initial language requires commitmentFactIds of kind "linearization" and, when present, matching linearizationIds; do not claim those word-order effects from structural anchors alone; ` +
    `selection/complement language requires commitmentFactIds of kind "selection" and, when present, selectionIds; binding language requires commitmentFactIds of kind "binding" and, when present, bindingIds; clausal dependency language requires commitmentFactIds of kind "clausal-dependency" and, when present, dependencyIds; agreement language requires commitmentFactIds of kind "agreement" and, when present, agreementIds; ` +
    `movement language belongs in chain notes and those notes must carry chainId plus stepIds and/or nodeIds. ` +
    `If a note cannot satisfy those support obligations, rewrite it more simply instead of returning an unsupported claim. ` +
    `The first returned noteBinding must have kind "architecture" and must summarize the final committed clause architecture, embedding, selection, and headedness rather than movement or closure. Do not use the architecture note as a spellout summary or a generic wrap-up sentence. ` +
    `Architecture notes should stay structural. If an architecture note mentions passive voice, case, theta roles, selection, scope, locality, or information structure, attach the matching typed ids on that same architecture note rather than assuming another note covers them. ` +
    `After the architecture note, include one note per major movement dependency when present, optional licensing notes, and optional closure only if it adds no new technical claim. Prefer 3-6 noteBindings total. ` +
    `Frozen support inventory JSON:\n${JSON.stringify({ framework, sentence, supportInventory })}\n` +
    `Frozen committed analysis JSON:\n${JSON.stringify({ framework, sentence, analysis: frozenAnalysis })}`
  );
};
