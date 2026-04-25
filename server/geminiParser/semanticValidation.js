export const createSemanticValidationHelpers = ({
  ParseApiError,
  cleanExplanationWhitespace,
  normalizeMovementOperation,
  normalizeChainType,
  normalizeOptionalStepText,
  normalizeKey,
  buildNodeIndexFromTree,
  collectOvertTerminalNodes,
  subtreeContainsNamedCovertCategoryLeaf
}) => {
  const GENERIC_OPERATION_ECHO_FACT_KINDS = new Set([
    'merge',
    'externalmerge',
    'internalmerge',
    'project',
    'label',
    'lexicalselect',
    'spellout',
    'spelloutdomain',
    'move',
    'movement',
    'other'
  ]);
  const NOTE_TEXT_RAISING_RE = /\braising\b/i;
  const NOTE_TEXT_CONTROL_RE = /\bcontrol\b|\bcontrolled\b/i;
  const NOTE_TEXT_SUBJECT_CONTROL_RE = /\bsubject[- ]control\b/i;
  const NOTE_TEXT_OBJECT_CONTROL_RE = /\bobject[- ]control\b/i;
  const NOTE_TEXT_ECM_RE = /\becm\b|\bexceptional case marking\b/i;
  const NOTE_TEXT_WH_CHAIN_RE = /\bwh-?movement\b|\ba-?bar movement\b|\ba-?bar\b/i;
  const NOTE_TEXT_A_CHAIN_RE = /\ba-?movement\b|\braises?\b|\bundergoes a-?movement\b/i;
  const NOTE_TEXT_HEAD_CHAIN_RE = /\bhead movement\b|\bi-?to-?c\b|\binfl to c\b|\bmoves? to c\b|\bhead-moves?\b/i;
  const NOTE_TEXT_DEPENDENCY_CONTRAST_RE = /\b(?:distinction|contrast|distinguish(?:es|ing)?|differentiat(?:e|es|ing)|versus|vs\.?|rather than|unlike)\b/i;
  const NOTE_TEXT_CASE_RE = /\b(?:nominative|accusative|ergative|absolutive|dative|genitive)\b|\bcase\b/i;
  const NOTE_TEXT_THETA_RE = /\b(?:agent|theme|patient|experiencer|goal|proposition|theta-role|theta role|external argument|internal argument)\b/i;
  const NOTE_TEXT_FEATURE_RE = /\b(?:feature checking|feature valuation|valued feature|unvalued feature|uninterpretable feature|interpretable feature|epp)\b/i;
  const NOTE_TEXT_PHASE_RE = /\b(?:phase head|phase edge|spell-?out domain|transfer(?:red)?|cyclic transfer|phase)\b/i;
  const NOTE_TEXT_MORPHOLOGY_RE = /\b(?:morphological realization|surface exponent|allomorph(?:y|ic)?|portmanteau|morpholog(?:y|ical)|exponence)\b/i;
  const NOTE_TEXT_SELECTION_RE = /\bselects?\b|\bselected as complement\b|\bselected as specifier\b|\bselector\b|\bselectee\b/i;
  const NOTE_TEXT_BINDING_RE = /\b(?:principle [abc]|binding domain|c-command|reflexive|anaphor|bound by|binds?)\b/i;
  const NOTE_TEXT_AGREEMENT_RE = /\b(?:noun class|phi-feature|class 17|default class|default agreement)\b/i;
  const NOTE_TEXT_PREDICATE_CLASS_RE = /\b(?:predicate class|unaccusative|unergative|weather predicate|expletive predicate|raising predicate|control predicate)\b/i;
  const NOTE_TEXT_PROBE_RE = /\b(?:probe direction(?:ality)?|probing domain|probe domain|search domain)\b/i;
  const NOTE_TEXT_NULL_ELEMENT_RE = /\b(?:silent complementizer|null complementizer|covert operator|expletive)\b/i;
  const NOTE_TEXT_DIAGNOSTIC_RE = /\b(?:diagnostic|idiom|agreement asymmetr|default agreement|interpretation only)\b/i;
  const NOTE_TEXT_PARAMETER_RE = /\b(?:parameter(?:ized|ization)?|probe directionality|overt subject movement|agreement domain)\b/i;
  const NOTE_TEXT_INFORMATION_STRUCTURE_RE = /\b(?:information structure|topic|focus|background|comment|contrastive topic|contrastive focus)\b/i;
  const NOTE_TEXT_OPERATOR_SCOPE_RE = /\b(?:operator scope|takes scope|outscopes|wide scope|narrow scope|scope interaction|question operator|scope)\b/i;
  const NOTE_TEXT_VOICE_VALENCY_RE = /\b(?:passive|middle voice|antipassive|causative|applicative|voice|valency)\b/i;
  const NOTE_TEXT_LINEARIZATION_RE = /\b(?:linearization|surface order|word order|verb-second|v2|head-final|head-initial)\b/i;
  const NOTE_TEXT_LOCALITY_RE = /\b(?:locality|island|phase edge|minimal link|subjacency|successive-cyclic)\b/i;
  const NOTE_TEXT_PREDICATION_RE = /\b(?:predication|secondary predication|depictive|resultative|small clause|copular predication)\b/i;
  const NOTE_TEXT_PARTICLE_RE = /\b(?:discourse particle|clause-typing particle|sentence-final particle|question particle|topic particle|focus particle|particle)\b/i;
  const NOTE_TEXT_EVIDENTIALITY_RE = /\b(?:evidential|reported evidential|inferential evidential|direct evidential|indirect evidential|evidentiality)\b/i;
  const NOTE_TEXT_MIRATIVITY_RE = /\b(?:mirative|mirativity|surprise marker)\b/i;
  const NOTE_TEXT_HONORIFICITY_RE = /\b(?:honorific|politeness|deferential|addressee honorific|subject honorific|honorificity)\b/i;
  const NOTE_TEXT_SWITCH_REFERENCE_RE = /\b(?:switch-reference|same-subject marker|different-subject marker|same subject|different subject)\b/i;
  const NOTE_TEXT_LOGOPHORA_RE = /\b(?:logophor|logophoric|logophora)\b/i;
  const NOTE_TEXT_EVENT_STRUCTURE_RE = /\b(?:event structure|lexical aspect|aktionsart|telic|atelic|accomplishment|achievement|activity|state|bounded|unbounded)\b/i;

  const noteNegatesDependency = (text, dependencyRe) => {
    const normalized = cleanExplanationWhitespace(String(text || ''));
    if (!normalized) return false;
    const source = dependencyRe.source;
    const negatedBefore = new RegExp(
      `\\b(?:without(?:\\s+requiring)?|without\\s+positing|not|no)\\b(?:\\s+[a-z-]+){0,3}\\s+${source}`,
      'i'
    );
    const negatedAfter = new RegExp(
      `${source}\\b(?:\\s+[a-z-]+){0,3}\\s+\\b(?:is\\s+)?(?:not|unnecessary|unneeded)\\b`,
      'i'
    );
    return negatedBefore.test(normalized) || negatedAfter.test(normalized);
  };

  const noteMentionsDependencyContrastively = (text, firstRe, secondRe) => {
    const normalized = cleanExplanationWhitespace(String(text || ''));
    if (!normalized) return false;
    if (
      !NOTE_TEXT_DEPENDENCY_CONTRAST_RE.test(normalized)
      && !noteNegatesDependency(normalized, firstRe)
      && !noteNegatesDependency(normalized, secondRe)
    ) {
      return false;
    }
    return firstRe.test(normalized) && secondRe.test(normalized);
  };

  const noteAssertsRaising = (text) => {
    const normalized = cleanExplanationWhitespace(String(text || ''));
    if (!normalized || !NOTE_TEXT_RAISING_RE.test(normalized)) return false;
    if (noteMentionsDependencyContrastively(normalized, NOTE_TEXT_RAISING_RE, NOTE_TEXT_CONTROL_RE)) {
      return false;
    }
    return true;
  };

  const noteAssertsControl = (text) => {
    const normalized = cleanExplanationWhitespace(String(text || ''));
    if (!normalized || !NOTE_TEXT_CONTROL_RE.test(normalized)) return false;
    if (noteMentionsDependencyContrastively(normalized, NOTE_TEXT_CONTROL_RE, NOTE_TEXT_RAISING_RE)) {
      return false;
    }
    return true;
  };

  const noteAssertsEcm = (text) => {
    const normalized = cleanExplanationWhitespace(String(text || ''));
    if (!normalized || !NOTE_TEXT_ECM_RE.test(normalized)) return false;
    if (noteMentionsDependencyContrastively(normalized, NOTE_TEXT_ECM_RE, NOTE_TEXT_CONTROL_RE)) {
      return false;
    }
    return true;
  };

  const hasMovementSupport = ({ movementEvents = [], chains = [] }, kind) => {
    const movementOperationMatchesKind = (operation, expectedKind) => {
      const normalized = normalizeMovementOperation(operation);
      const raw = normalizeKey(operation);
      if (expectedKind === 'AbarMove') {
        return normalized === 'AbarMove' || /abar|wh|front|focus|topic|operator|displac|extract|scrambl|rollup|sideward/.test(raw);
      }
      if (expectedKind === 'A-Move') {
        return normalized === 'A-Move' || /amove|raise|raising/.test(raw);
      }
      if (expectedKind === 'HeadMove') {
        return normalized === 'HeadMove' || /head.*move|head.*raise|head.*lower|lower|lowering|affix|clitic|incorpor/.test(raw);
      }
      return false;
    };
    const chainMatchesKind = (chain, expectedKind) => {
      const family = normalizeChainType(chain?.family || chain?.type);
      const raw = normalizeKey(chain?.type);
      if (expectedKind === 'AbarMove') {
        return family === 'A-bar' || /abar|wh|front|focus|topic|operator|displac|extract|scrambl|rollup|sideward/.test(raw);
      }
      if (expectedKind === 'A-Move') {
        return family === 'A' || /amove|raise|raising/.test(raw);
      }
      if (expectedKind === 'HeadMove') {
        return family === 'head' || /head.*move|head.*raise|head.*lower|lower|lowering|affix|clitic|incorpor/.test(raw);
      }
      return false;
    };
    if (kind === 'AbarMove') {
      return movementEvents.some((event) => movementOperationMatchesKind(event?.operation, kind))
        || chains.some((chain) => chainMatchesKind(chain, kind));
    }
    if (kind === 'A-Move') {
      return movementEvents.some((event) => movementOperationMatchesKind(event?.operation, kind))
        || chains.some((chain) => chainMatchesKind(chain, kind));
    }
    if (kind === 'HeadMove') {
      return movementEvents.some((event) => movementOperationMatchesKind(event?.operation, kind))
        || chains.some((chain) => chainMatchesKind(chain, kind));
    }
    return false;
  };

  const validatePronouncedCopiesAgainstCommittedTree = ({
    chains = [],
    tree = null,
    movementEvents = []
  }) => {
    if (!tree || !Array.isArray(chains) || chains.length === 0) return;
    const nodeById = buildNodeIndexFromTree(tree);
    const laterMovedCopyIds = new Set(
      (Array.isArray(movementEvents) ? movementEvents : [])
        .flatMap((event) => [String(event?.fromNodeId || '').trim(), String(event?.traceNodeId || '').trim()])
        .filter(Boolean)
    );
    for (const chain of chains) {
      const pronouncedCopyId = String(chain?.pronouncedCopy || '').trim();
      if (!pronouncedCopyId) continue;
      if (laterMovedCopyIds.has(pronouncedCopyId)) continue;
      const copies = Array.isArray(chain?.copies)
        ? chain.copies.map((value) => String(value || '').trim()).filter(Boolean)
        : [];
      const silentCopies = Array.isArray(chain?.silentCopies)
        ? chain.silentCopies.map((value) => String(value || '').trim()).filter(Boolean)
        : [];
      const distinctOtherCopies = copies.filter((copyId) => copyId && copyId !== pronouncedCopyId);
      const encodesCommittedCopyContrast = silentCopies.length > 0 || distinctOtherCopies.length > 0;
      if (!encodesCommittedCopyContrast) continue;
      const pronouncedNode = nodeById.get(pronouncedCopyId);
      if (!pronouncedNode) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          `Chain ${chain?.chainId || pronouncedCopyId} marks ${pronouncedCopyId} as the pronounced copy, but that copy does not exist in the committed tree.`,
          502
        );
      }
      const overtLeaves = collectOvertTerminalNodes(pronouncedNode);
      if (overtLeaves.length > 0) continue;
      if (subtreeContainsNamedCovertCategoryLeaf(pronouncedNode)) continue;
      throw new ParseApiError(
        'BAD_MODEL_RESPONSE',
        `Chain ${chain?.chainId || pronouncedCopyId} marks ${pronouncedCopyId} as the pronounced copy, but the committed tree leaves that copy silent.`,
        502
      );
    }
  };

  const validateNoteBindingsAgainstStructuredAnalysis = ({
    noteBindings = [],
    movementEvents = [],
    chains = [],
    commitmentGraph = [],
    clausalDependencies = [],
    caseAssignments = [],
    argumentStructure = [],
    phaseLog = [],
    morphologyRealization = [],
    featureLedger = [],
    selectionLedger = [],
    bindingLedger = [],
    agreementLedger = [],
    predicateClassLedger = [],
    probeLedger = [],
    nullElementLedger = [],
    diagnosticLedger = [],
    parameterLedger = [],
    informationStructureLedger = [],
    operatorScopeLedger = [],
    voiceValencyLedger = [],
    linearizationLedger = [],
    localityLedger = [],
    predicationLedger = [],
    particleLedger = [],
    evidentialityLedger = [],
    mirativityLedger = [],
    honorificityLedger = [],
    switchReferenceLedger = [],
    logophoraLedger = [],
    eventStructureLedger = []
  }) => {
    if (!Array.isArray(noteBindings) || noteBindings.length === 0) return;
    const NOTE_TEXT_BANNED_BOILERPLATE_RE = /\b(?:initial logic and parameters are validated|standard processing applied|final transformation)\b/i;

    const buildLedgerIdSet = (entries, ...fields) => new Set(
      (Array.isArray(entries) ? entries : [])
        .flatMap((entry) => fields.map((field) => normalizeOptionalStepText(entry?.[field])))
        .filter(Boolean)
    );
    const commitmentFactMetaById = new Map(
      (Array.isArray(commitmentGraph) ? commitmentGraph : [])
        .map((entry) => {
          const factId = normalizeOptionalStepText(entry?.factId || entry?.id);
          const kind = normalizeKey(entry?.kind);
          const subtype = normalizeKey(entry?.subtype);
          return factId && kind ? [factId, { kind, subtype }] : null;
        })
        .filter(Boolean)
    );
    const commitmentKinds = new Set(
      Array.from(commitmentFactMetaById.values())
        .map((entry) => entry?.kind)
        .filter(Boolean)
    );
    const commitmentSubtypes = new Set(
      Array.from(commitmentFactMetaById.values())
        .map((entry) => entry?.subtype)
        .filter(Boolean)
    );
    const supportIdsForBinding = (binding) =>
      Array.isArray(binding?.supportIds)
        ? binding.supportIds.map((value) => normalizeOptionalStepText(value)).filter(Boolean)
        : [];
    const explicitIdsForBinding = (binding, field) =>
      Array.isArray(binding?.[field])
        ? binding[field].map((value) => normalizeOptionalStepText(value)).filter(Boolean)
        : [];
    const hasIdsFromSet = (ids, allowedIds) =>
      ids.some((id) => allowedIds instanceof Set && allowedIds.has(id));
    const hasTypedSupport = (binding, fields = [], supportSets = []) => {
      const explicit = fields.some((field) => explicitIdsForBinding(binding, field).length > 0);
      if (explicit) return true;
      const supportIds = supportIdsForBinding(binding);
      return supportSets.some((allowedIds) => hasIdsFromSet(supportIds, allowedIds));
    };
    const hasCommitmentFactSupport = (binding, ...kinds) => {
      const allowedKinds = new Set(kinds.map((kind) => normalizeKey(kind)).filter(Boolean));
      if (allowedKinds.size === 0) return false;
      const ids = [
        ...explicitIdsForBinding(binding, 'commitmentFactIds'),
        ...supportIdsForBinding(binding)
      ];
      return ids.some((id) => allowedKinds.has(commitmentFactMetaById.get(id)?.kind));
    };
    const hasAnyCommitmentFactSupport = (binding) => {
      const ids = [
        ...explicitIdsForBinding(binding, 'commitmentFactIds'),
        ...supportIdsForBinding(binding)
      ];
      return ids.some((id) => commitmentFactMetaById.has(id));
    };
    const caseAssignmentIdSet = buildLedgerIdSet(caseAssignments, 'assignmentId', 'caseAssignmentId', 'id');
    const featureEntryIdSet = buildLedgerIdSet(featureLedger, 'entryId', 'id');
    const phaseIdSet = buildLedgerIdSet(phaseLog, 'phaseId', 'id');
    const morphologyIdSet = buildLedgerIdSet(morphologyRealization, 'realizationId', 'morphologyId', 'id');
    const argumentIdSet = buildLedgerIdSet(argumentStructure, 'argumentId', 'id');
    const selectionIdSet = buildLedgerIdSet(selectionLedger, 'selectionId', 'id');
    const bindingIdSet = buildLedgerIdSet(bindingLedger, 'bindingId', 'id');
    const dependencyIdSet = buildLedgerIdSet(clausalDependencies, 'dependencyId', 'id');
    const agreementIdSet = buildLedgerIdSet(agreementLedger, 'agreementId', 'id');
    const predicateClassIdSet = buildLedgerIdSet(predicateClassLedger, 'predicateClassId', 'id');
    const probeIdSet = buildLedgerIdSet(probeLedger, 'probeId', 'id');
    const nullElementIdSet = buildLedgerIdSet(nullElementLedger, 'nullElementId', 'id');
    const diagnosticIdSet = buildLedgerIdSet(diagnosticLedger, 'diagnosticId', 'id');
    const parameterIdSet = buildLedgerIdSet(parameterLedger, 'parameterId', 'id');
    const informationStructureIdSet = buildLedgerIdSet(informationStructureLedger, 'informationStructureId', 'id');
    const operatorScopeIdSet = buildLedgerIdSet(operatorScopeLedger, 'operatorScopeId', 'id');
    const voiceValencyIdSet = buildLedgerIdSet(voiceValencyLedger, 'voiceValencyId', 'id');
    const linearizationIdSet = buildLedgerIdSet(linearizationLedger, 'linearizationId', 'id');
    const localityIdSet = buildLedgerIdSet(localityLedger, 'localityId', 'id');
    const predicationIdSet = buildLedgerIdSet(predicationLedger, 'predicationId', 'id');
    const particleIdSet = buildLedgerIdSet(particleLedger, 'particleId', 'id');
    const evidentialityIdSet = buildLedgerIdSet(evidentialityLedger, 'evidentialityId', 'id');
    const mirativityIdSet = buildLedgerIdSet(mirativityLedger, 'mirativityId', 'id');
    const honorificityIdSet = buildLedgerIdSet(honorificityLedger, 'honorificityId', 'id');
    const switchReferenceIdSet = buildLedgerIdSet(switchReferenceLedger, 'switchReferenceId', 'id');
    const logophoraIdSet = buildLedgerIdSet(logophoraLedger, 'logophoraId', 'id');
    const eventStructureIdSet = buildLedgerIdSet(eventStructureLedger, 'eventStructureId', 'id');
    const hasPhaseLog = Array.isArray(phaseLog) && phaseLog.length > 0;
    const hasMorphologyRealization = Array.isArray(morphologyRealization) && morphologyRealization.length > 0;
    const hasFeatureLedger = Array.isArray(featureLedger) && featureLedger.length > 0;
    const hasCaseLedger = Array.isArray(caseAssignments) && caseAssignments.length > 0;
    const hasArgumentLedger = Array.isArray(argumentStructure) && argumentStructure.length > 0;
    const hasSelectionLedger = Array.isArray(selectionLedger) && selectionLedger.length > 0;
    const hasBindingLedger = Array.isArray(bindingLedger) && bindingLedger.length > 0;
    const hasAgreementLedger = Array.isArray(agreementLedger) && agreementLedger.length > 0;
    const hasPredicateClassLedger = Array.isArray(predicateClassLedger) && predicateClassLedger.length > 0;
    const hasProbeLedger = Array.isArray(probeLedger) && probeLedger.length > 0;
    const hasNullElementLedger = Array.isArray(nullElementLedger) && nullElementLedger.length > 0;
    const hasDiagnosticLedger = Array.isArray(diagnosticLedger) && diagnosticLedger.length > 0;
    const hasParameterLedger = Array.isArray(parameterLedger) && parameterLedger.length > 0;
    const hasInformationStructureLedger = Array.isArray(informationStructureLedger) && informationStructureLedger.length > 0;
    const hasOperatorScopeLedger = Array.isArray(operatorScopeLedger) && operatorScopeLedger.length > 0;
    const hasVoiceValencyLedger = Array.isArray(voiceValencyLedger) && voiceValencyLedger.length > 0;
    const hasLinearizationLedger = Array.isArray(linearizationLedger) && linearizationLedger.length > 0;
    const hasLocalityLedger = Array.isArray(localityLedger) && localityLedger.length > 0;
    const hasPredicationLedger = Array.isArray(predicationLedger) && predicationLedger.length > 0;
    const hasParticleLedger = Array.isArray(particleLedger) && particleLedger.length > 0;
    const hasEvidentialityLedger = Array.isArray(evidentialityLedger) && evidentialityLedger.length > 0;
    const hasMirativityLedger = Array.isArray(mirativityLedger) && mirativityLedger.length > 0;
    const hasHonorificityLedger = Array.isArray(honorificityLedger) && honorificityLedger.length > 0;
    const hasSwitchReferenceLedger = Array.isArray(switchReferenceLedger) && switchReferenceLedger.length > 0;
    const hasLogophoraLedger = Array.isArray(logophoraLedger) && logophoraLedger.length > 0;
    const hasEventStructureLedger = Array.isArray(eventStructureLedger) && eventStructureLedger.length > 0;
    const hasBindingLinks = (binding, ...fields) =>
      fields.some((field) => Array.isArray(binding?.[field]) && binding[field].some((value) => normalizeOptionalStepText(value)));
    const hasStructuralAnchor = (binding) =>
      Boolean(normalizeOptionalStepText(binding?.chainId))
      || hasBindingLinks(binding, 'stepIds', 'nodeIds');
    const legacyTypedSupportSpecs = [
      { fields: ['caseAssignmentIds'], supportSets: [caseAssignmentIdSet] },
      { fields: ['featureEntryIds'], supportSets: [featureEntryIdSet] },
      { fields: ['phaseIds'], supportSets: [phaseIdSet] },
      { fields: ['morphologyIds'], supportSets: [morphologyIdSet] },
      { fields: ['argumentIds'], supportSets: [argumentIdSet] },
      { fields: ['selectionIds'], supportSets: [selectionIdSet] },
      { fields: ['bindingIds'], supportSets: [bindingIdSet] },
      { fields: ['dependencyIds'], supportSets: [dependencyIdSet] },
      { fields: ['agreementIds'], supportSets: [agreementIdSet] },
      { fields: ['predicateClassIds'], supportSets: [predicateClassIdSet] },
      { fields: ['probeIds'], supportSets: [probeIdSet] },
      { fields: ['nullElementIds'], supportSets: [nullElementIdSet] },
      { fields: ['diagnosticIds'], supportSets: [diagnosticIdSet] },
      { fields: ['parameterIds'], supportSets: [parameterIdSet] },
      { fields: ['informationStructureIds'], supportSets: [informationStructureIdSet] },
      { fields: ['operatorScopeIds'], supportSets: [operatorScopeIdSet] },
      { fields: ['voiceValencyIds'], supportSets: [voiceValencyIdSet] },
      { fields: ['linearizationIds'], supportSets: [linearizationIdSet] },
      { fields: ['localityIds'], supportSets: [localityIdSet] },
      { fields: ['predicationIds'], supportSets: [predicationIdSet] },
      { fields: ['particleIds'], supportSets: [particleIdSet] },
      { fields: ['evidentialityIds'], supportSets: [evidentialityIdSet] },
      { fields: ['mirativityIds'], supportSets: [mirativityIdSet] },
      { fields: ['honorificityIds'], supportSets: [honorificityIdSet] },
      { fields: ['switchReferenceIds'], supportSets: [switchReferenceIdSet] },
      { fields: ['logophoraIds'], supportSets: [logophoraIdSet] },
      { fields: ['eventStructureIds'], supportSets: [eventStructureIdSet] }
    ];
    const hasAnyLegacyTypedSupport = (binding) =>
      legacyTypedSupportSpecs.some((spec) => hasTypedSupport(binding, spec.fields, spec.supportSets));
    const hasAnyTheorySupport = (binding) =>
      hasAnyLegacyTypedSupport(binding) || hasAnyCommitmentFactSupport(binding);
    const hasAnyCanonicalSupport = (binding) =>
      hasStructuralAnchor(binding) || hasAnyTheorySupport(binding);
    const noteMentionsGenericTheoryClaim = (text) =>
      NOTE_TEXT_CASE_RE.test(text)
      || NOTE_TEXT_THETA_RE.test(text)
      || NOTE_TEXT_FEATURE_RE.test(text)
      || NOTE_TEXT_PHASE_RE.test(text)
      || NOTE_TEXT_MORPHOLOGY_RE.test(text)
      || NOTE_TEXT_SELECTION_RE.test(text)
      || NOTE_TEXT_BINDING_RE.test(text)
      || NOTE_TEXT_AGREEMENT_RE.test(text)
      || NOTE_TEXT_PREDICATE_CLASS_RE.test(text)
      || NOTE_TEXT_PROBE_RE.test(text)
      || NOTE_TEXT_NULL_ELEMENT_RE.test(text)
      || NOTE_TEXT_DIAGNOSTIC_RE.test(text)
      || NOTE_TEXT_PARAMETER_RE.test(text)
      || NOTE_TEXT_INFORMATION_STRUCTURE_RE.test(text)
      || NOTE_TEXT_OPERATOR_SCOPE_RE.test(text)
      || NOTE_TEXT_VOICE_VALENCY_RE.test(text)
      || NOTE_TEXT_LOCALITY_RE.test(text)
      || NOTE_TEXT_PREDICATION_RE.test(text)
      || NOTE_TEXT_PARTICLE_RE.test(text)
      || NOTE_TEXT_EVIDENTIALITY_RE.test(text)
      || NOTE_TEXT_MIRATIVITY_RE.test(text)
      || NOTE_TEXT_HONORIFICITY_RE.test(text)
      || NOTE_TEXT_SWITCH_REFERENCE_RE.test(text)
      || NOTE_TEXT_LOGOPHORA_RE.test(text)
      || NOTE_TEXT_EVENT_STRUCTURE_RE.test(text);

    for (const binding of noteBindings) {
      const kind = normalizeKey(binding?.kind);
      const isClosureBinding = kind === 'closure';
      const text = cleanExplanationWhitespace(String(binding?.text || ''));
      if (!text) continue;

      if (NOTE_TEXT_BANNED_BOILERPLATE_RE.test(text)) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes contain stock boilerplate rather than structural explanation.',
          502
        );
      }

      if (
        NOTE_TEXT_WH_CHAIN_RE.test(text)
        && !hasMovementSupport({ movementEvents, chains }, 'AbarMove')
        && !hasStructuralAnchor(binding)
      ) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'A chain note mentions wh/A-bar movement but the structured derivation does not encode an A-bar chain.',
          502
        );
      }
      if (NOTE_TEXT_WH_CHAIN_RE.test(text) && !hasStructuralAnchor(binding)) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'A wh/A-bar note must anchor itself to the encoded derivation with stepIds, nodeIds, or chainId.',
          502
        );
      }

      if (
        NOTE_TEXT_A_CHAIN_RE.test(text)
        && !NOTE_TEXT_CONTROL_RE.test(text)
        && !hasMovementSupport({ movementEvents, chains }, 'A-Move')
        && !hasStructuralAnchor(binding)
      ) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention A-movement but the structured derivation does not encode an A-chain.',
          502
        );
      }
      if (NOTE_TEXT_A_CHAIN_RE.test(text) && !NOTE_TEXT_CONTROL_RE.test(text) && !hasStructuralAnchor(binding)) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'An A-movement note must anchor itself to the encoded derivation with stepIds, nodeIds, or chainId.',
          502
        );
      }

      if (
        NOTE_TEXT_HEAD_CHAIN_RE.test(text)
        && !hasMovementSupport({ movementEvents, chains }, 'HeadMove')
        && !hasStructuralAnchor(binding)
      ) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention head movement but the structured derivation does not encode a head-movement chain.',
          502
        );
      }
      if (NOTE_TEXT_HEAD_CHAIN_RE.test(text) && !hasStructuralAnchor(binding)) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'A head-movement note must anchor itself to the encoded derivation with stepIds, nodeIds, or chainId.',
          502
        );
      }

      if (NOTE_TEXT_LINEARIZATION_RE.test(text) && !isClosureBinding && !hasAnyCanonicalSupport(binding)) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention linearization or word-order facts but are neither anchored to the derivation nor supported by commitment facts or explicit support ids.',
          502
        );
      }

      if (noteMentionsGenericTheoryClaim(text) && !hasAnyCanonicalSupport(binding)) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention public theory facts but are not anchored to the derivation and do not cite supporting commitment facts or explicit support ids.',
          502
        );
      }

      if (
        (noteAssertsRaising(text) || noteAssertsControl(text) || noteAssertsEcm(text))
        && !hasAnyCanonicalSupport(binding)
      ) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention clausal dependency facts but are not anchored to the frozen derivation and do not cite supporting commitment facts or support ids.',
          502
        );
      }
    }
  };

  const shouldWarnOnSemanticValidationFailure = () => true;
  const shouldStrictlyEnforceNoteConsistency = () => String(process.env.BABEL_STRICT_NOTE_VALIDATION || '').trim() === '1';

  const runSemanticValidation = (label, validator) => {
    try {
      validator();
    } catch (error) {
      if (
        shouldWarnOnSemanticValidationFailure()
        && error instanceof ParseApiError
        && error.code === 'BAD_MODEL_RESPONSE'
      ) {
        const prefix = String(label || '').trim();
        const message = String(error.message || '').trim() || 'Semantic validation warning.';
        const warning = prefix ? `${prefix}: ${message}` : message;
        if (warning) console.warn(`[Babel semantic validation softened in production] ${warning}`);
        return;
      }
      throw error;
    }
  };

  const auditNoteConsistency = (validator) => {
    try {
      validator();
    } catch (error) {
      if (
        error instanceof ParseApiError
        && error.code === 'BAD_MODEL_RESPONSE'
        && !shouldStrictlyEnforceNoteConsistency()
      ) {
        const message = String(error.message || '').trim() || 'Note-support consistency audit failed.';
        if (message) console.warn(`[Babel note-support audit] ${message}`);
        return;
      }
      throw error;
    }
  };

  const computeCompletenessStatus = ({
    growthFrames,
    rawDerivationSteps,
    chains,
    commitmentGraph,
    caseAssignments,
    argumentStructure,
    phaseLog,
    morphologyRealization,
    featureLedger,
    selectionLedger,
    bindingLedger,
    clausalDependencies,
    agreementLedger,
    predicateClassLedger,
    probeLedger,
    nullElementLedger,
    diagnosticLedger,
    parameterLedger,
    informationStructureLedger,
    operatorScopeLedger,
    voiceValencyLedger,
    linearizationLedger,
    localityLedger,
    predicationLedger,
    particleLedger,
    evidentialityLedger,
    mirativityLedger,
    honorificityLedger,
    switchReferenceLedger,
    logophoraLedger,
    eventStructureLedger
  }) => {
    const hasGrowthFrames = Array.isArray(growthFrames) && growthFrames.length > 0;
    const hasRichSteps = Array.isArray(rawDerivationSteps) && rawDerivationSteps.some((step) =>
      Array.isArray(step?.preFeatures)
      || Array.isArray(step?.postFeatures)
      || Boolean(step?.thetaRole)
      || Boolean(step?.introducerHead)
      || Boolean(step?.phase)
      || Boolean(step?.labelDecision)
      || Boolean(step?.linearizationEffect)
      || Boolean(step?.morphologyEffect)
      || Array.isArray(step?.affectedNodeIds)
    );
    const signals = [
      hasGrowthFrames,
      hasRichSteps,
      Array.isArray(chains) && chains.length > 0,
      Array.isArray(commitmentGraph) && commitmentGraph.length > 0,
      Array.isArray(caseAssignments) && caseAssignments.length > 0,
      Array.isArray(argumentStructure) && argumentStructure.length > 0,
      Array.isArray(phaseLog) && phaseLog.length > 0,
      Array.isArray(morphologyRealization) && morphologyRealization.length > 0,
      Array.isArray(featureLedger) && featureLedger.length > 0,
      Array.isArray(selectionLedger) && selectionLedger.length > 0,
      Array.isArray(bindingLedger) && bindingLedger.length > 0,
      Array.isArray(clausalDependencies) && clausalDependencies.length > 0,
      Array.isArray(agreementLedger) && agreementLedger.length > 0,
      Array.isArray(predicateClassLedger) && predicateClassLedger.length > 0,
      Array.isArray(probeLedger) && probeLedger.length > 0,
      Array.isArray(nullElementLedger) && nullElementLedger.length > 0,
      Array.isArray(diagnosticLedger) && diagnosticLedger.length > 0,
      Array.isArray(parameterLedger) && parameterLedger.length > 0,
      Array.isArray(informationStructureLedger) && informationStructureLedger.length > 0,
      Array.isArray(operatorScopeLedger) && operatorScopeLedger.length > 0,
      Array.isArray(voiceValencyLedger) && voiceValencyLedger.length > 0,
      Array.isArray(linearizationLedger) && linearizationLedger.length > 0,
      Array.isArray(localityLedger) && localityLedger.length > 0,
      Array.isArray(predicationLedger) && predicationLedger.length > 0,
      Array.isArray(particleLedger) && particleLedger.length > 0,
      Array.isArray(evidentialityLedger) && evidentialityLedger.length > 0,
      Array.isArray(mirativityLedger) && mirativityLedger.length > 0,
      Array.isArray(honorificityLedger) && honorificityLedger.length > 0,
      Array.isArray(switchReferenceLedger) && switchReferenceLedger.length > 0,
      Array.isArray(logophoraLedger) && logophoraLedger.length > 0,
      Array.isArray(eventStructureLedger) && eventStructureLedger.length > 0
    ].filter(Boolean).length;

    if (signals >= 4) return 'full';
    if (signals >= 1) return 'partial';
    return 'minimal';
  };

  const hasMeaningfulFactValue = (value) => {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number' || typeof value === 'boolean') return true;
    if (Array.isArray(value)) return value.some((item) => hasMeaningfulFactValue(item));
    if (typeof value === 'object') return Object.values(value).some((item) => hasMeaningfulFactValue(item));
    return false;
  };

  const hasMeaningfulFactAnchors = (fact) => {
    if (!fact || typeof fact !== 'object') return false;
    if (normalizeOptionalStepText(fact?.chainId)) return true;
    if (Array.isArray(fact?.nodeIds) && fact.nodeIds.some((value) => String(value || '').trim())) return true;
    if (
      Array.isArray(fact?.participants)
      && fact.participants.some((participant) =>
        participant
        && typeof participant === 'object'
        && (
          normalizeOptionalStepText(participant.role)
          || normalizeOptionalStepText(participant.nodeId)
          || normalizeOptionalStepText(participant.label)
          || normalizeOptionalStepText(participant.value)
        )
      )
    ) {
      return true;
    }
    return Object.entries(fact).some(([field, value]) => (
      /(?:^|[A-Z])nodeId$/i.test(field)
      || field === 'nodeId'
    ) && hasMeaningfulFactValue(value));
  };

  const factHasNonAnchorDescriptor = (fact) => {
    if (!fact || typeof fact !== 'object') return false;
    const ignoredFields = new Set([
      'factId',
      'kind',
      'family',
      'frameworkLabel',
      'subtype',
      'stepIds',
      'nodeIds',
      'participants',
      'chainId',
      'sourceStepId',
      'note',
      'diagnostics'
    ]);
    return Object.entries(fact).some(([field, value]) => {
      if (ignoredFields.has(field)) return false;
      if (field === 'nodeId' || /(?:^|[A-Z])nodeId$/i.test(field)) return false;
      if (field === 'label' || /(?:^|[A-Z])label$/i.test(field)) return false;
      return hasMeaningfulFactValue(value);
    });
  };

  const isWeakOperationEchoFact = (fact, frame) => {
    if (!fact || typeof fact !== 'object') return false;
    const normalizedKind = normalizeKey(fact?.kind || fact?.family || fact?.type);
    if (!GENERIC_OPERATION_ECHO_FACT_KINDS.has(normalizedKind)) return false;
    const change = frame?.change && typeof frame.change === 'object' && !Array.isArray(frame.change)
      ? frame.change
      : null;
    const anchors = Array.isArray(change?.anchors) ? change.anchors : [];
    const moveLikeFrame = anchors.some((anchor) => {
      const role = normalizeKey(anchor?.role);
      const nodeId = normalizeOptionalStepText(anchor?.nodeId);
      return Boolean(nodeId) && /source|from|origin|lower|landing|target|destination|host|targethead|trace|residue|lowercopy|copy/.test(role);
    }) || (Array.isArray(change?.continuityIds) && change.continuityIds.length > 0);
    if (moveLikeFrame && (normalizedKind === 'move' || normalizedKind === 'movement')) {
      return false;
    }
    if (factHasNonAnchorDescriptor(fact)) return false;
    if (!hasMeaningfulFactAnchors(fact)) return true;
    const hasSpecificLabel = Boolean(
      normalizeOptionalStepText(fact?.frameworkLabel)
      || normalizeOptionalStepText(fact?.subtype)
    );
    return !hasSpecificLabel || !moveLikeFrame;
  };

  const collectFrameAuthoredCommitments = (frame) => {
    const change = frame?.change && typeof frame.change === 'object' && !Array.isArray(frame.change)
      ? frame.change
      : null;
    return change ? [change] : [];
  };

  const hasMeaningfulCommitmentAnchors = (commitment) => {
    if (!commitment || typeof commitment !== 'object') return false;
    if (Array.isArray(commitment?.anchors) && commitment.anchors.some((anchor) => {
      const nodeId = normalizeOptionalStepText(anchor?.nodeId);
      const value = normalizeOptionalStepText(anchor?.value);
      const text = normalizeOptionalStepText(anchor?.text);
      return Boolean(nodeId || value || text);
    })) {
      return true;
    }
    if (Array.isArray(commitment?.continuityIds) && commitment.continuityIds.some((value) => normalizeOptionalStepText(value))) {
      return true;
    }
    return hasMeaningfulFactAnchors(commitment);
  };

  const isWeakOperationEchoCommitment = (commitment, frame) => {
    if (!commitment || typeof commitment !== 'object') return false;
    const statement = normalizeOptionalStepText(
      commitment?.statement
      || commitment?.summary
      || commitment?.claim
      || commitment?.note
    );
    const hasEventShape = Array.isArray(commitment?.anchors) || Array.isArray(commitment?.continuityIds);
    if (!statement) {
      return hasEventShape ? true : isWeakOperationEchoFact(commitment, frame);
    }
    const normalizedStatement = normalizeKey(statement);
    const genericEcho = GENERIC_OPERATION_ECHO_FACT_KINDS.has(normalizedStatement);
    if (!genericEcho) return false;
    return !hasMeaningfulCommitmentAnchors(commitment);
  };

  const collectCompletenessWarnings = ({
    noteBindings,
    commitmentGraph,
    growthFrames,
    chains
  }) => {
    const warnings = [];
    const hasCommitmentFacts = Array.isArray(commitmentGraph) && commitmentGraph.length > 0;
    const hasAnchoredNotes = Array.isArray(noteBindings) && noteBindings.some((binding) => {
      const kind = normalizeOptionalStepText(binding?.kind);
      if (kind === 'closure') return false;
      const text = normalizeOptionalStepText(binding?.text);
      if (!text) return false;
      return Boolean(
        normalizeOptionalStepText(binding?.chainId)
        || (Array.isArray(binding?.stepIds) && binding.stepIds.length > 0)
        || (Array.isArray(binding?.nodeIds) && binding.nodeIds.length > 0)
        || (Array.isArray(binding?.supportIds) && binding.supportIds.length > 0)
        || (Array.isArray(binding?.commitmentFactIds) && binding.commitmentFactIds.length > 0)
      );
    });
    const hasNonTrivialStructure = (
      (Array.isArray(growthFrames) && growthFrames.length > 1)
      || (Array.isArray(chains) && chains.length > 0)
    );

    if (!hasCommitmentFacts && hasAnchoredNotes && hasNonTrivialStructure) {
      warnings.push('Anchored noteBindings are present but commitmentFacts are empty.');
    }

    const framesMissingCommitments = (Array.isArray(growthFrames) ? growthFrames : [])
      .map((frame, index) => {
        const commitments = collectFrameAuthoredCommitments(frame);
        if (commitments.length > 0) return null;
        return normalizeOptionalStepText(frame?.stepId)
          || normalizeOptionalStepText(frame?.frameId)
          || `frame-${index + 1}`;
      })
      .filter(Boolean);

    if (framesMissingCommitments.length > 0) {
      const preview = framesMissingCommitments.slice(0, 8).join(', ');
      const overflow = framesMissingCommitments.length - Math.min(framesMissingCommitments.length, 8);
      warnings.push(
        `Growth frames are missing required frame-local event commitments on: ${preview}${overflow > 0 ? ` (+${overflow} more)` : ''}.`
      );
    }

    const framesWithWeakCommitments = (Array.isArray(growthFrames) ? growthFrames : [])
      .map((frame, index) => {
        const commitments = collectFrameAuthoredCommitments(frame);
        if (commitments.length === 0) return null;
        const hasUsefulCommitment = commitments.some((commitment) => !isWeakOperationEchoCommitment(commitment, frame));
        if (hasUsefulCommitment) return null;
        return normalizeOptionalStepText(frame?.stepId)
          || normalizeOptionalStepText(frame?.frameId)
          || `frame-${index + 1}`;
      })
      .filter(Boolean);

    if (framesWithWeakCommitments.length > 0) {
      const preview = framesWithWeakCommitments.slice(0, 8).join(', ');
      const overflow = framesWithWeakCommitments.length - Math.min(framesWithWeakCommitments.length, 8);
      warnings.push(
        `Growth frames contain weak operation-echo event commitments on: ${preview}${overflow > 0 ? ` (+${overflow} more)` : ''}.`
      );
    }

    return warnings;
  };

  return {
    validatePronouncedCopiesAgainstCommittedTree,
    validateNoteBindingsAgainstStructuredAnalysis,
    runSemanticValidation,
    auditNoteConsistency,
    computeCompletenessStatus,
    collectCompletenessWarnings
  };
};
