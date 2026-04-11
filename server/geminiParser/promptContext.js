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
    researchTraceIds: normalizedEntries(analysis.researchTrace, ['decisionId', 'traceId', 'id'])
  }) || {};

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
    `The syntax analysis for the sentence "${sentence}" is already frozen. ` +
    `Do not change the analysis. Write noteBindings only from the committed derivation and ledgers below. ` +
    `Return exactly one JSON object of the form {"noteBindings":[...]}. ` +
    `The noteBindings must explain the derivation encoded in Growth, not propose a different analysis. ` +
    `If researchTrace is present below, treat it as preserved first-pass decision context and, when helpful, summarize that preserved reasoning in one or two noteBindings rather than inventing new rationale. ` +
    `Use only ids already present in the frozen analysis. ` +
    `If a typed claim is not supported by a matching typed ledger, simplify the note instead of mentioning that typed domain. ` +
    `Support is note-local, not global. If one note mentions passive voice, case, theta roles, locality, scope, or another typed domain, that same note must carry the matching typed ids even if another note elsewhere already cites the same ledger entry. ` +
    `Self-audit each note before returning it: ` +
    `case language requires caseAssignmentIds; theta-role / external-argument / internal-argument language requires argumentIds; ` +
    `scope or question-operator language requires operatorScopeIds; locality or successive-cyclic language requires localityIds; ` +
    `voice or passive language requires voiceValencyIds; topic/focus/information-structure language requires informationStructureIds; ` +
    `predicate-class words like unaccusative, control predicate, or raising predicate require predicateClassIds; ` +
    `null-element words like silent complementizer or expletive require nullElementIds; ` +
    `parameter/probe language requires parameterIds/probeIds; ` +
    `word-order / V2 / head-final / head-initial language requires linearizationIds or clear structural anchors; ` +
    `movement language belongs in chain notes and those notes must carry chainId plus stepIds and/or nodeIds. ` +
    `If a note cannot satisfy those support obligations, rewrite it more simply instead of returning an unsupported claim. ` +
    `Architecture notes should stay structural. If an architecture note mentions passive voice, case, theta roles, selection, scope, locality, or information structure, attach the matching typed ids on that same architecture note rather than assuming another note covers them. ` +
    `Prefer 3-6 noteBindings: one architecture note, one note per major movement dependency when present, optional licensing notes, and optional closure only if it adds no new technical claim. ` +
    `Frozen support inventory JSON:\n${JSON.stringify({ framework, sentence, supportInventory })}\n` +
    `Frozen committed analysis JSON:\n${JSON.stringify({ framework, sentence, analysis: frozenAnalysis })}`
  );
};
