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
    if (kind === 'AbarMove') {
      return movementEvents.some((event) => normalizeMovementOperation(event?.operation) === 'AbarMove')
        || chains.some((chain) => normalizeChainType(chain?.type) === 'A-bar');
    }
    if (kind === 'A-Move') {
      return movementEvents.some((event) => normalizeMovementOperation(event?.operation) === 'A-Move')
        || chains.some((chain) => normalizeChainType(chain?.type) === 'A');
    }
    if (kind === 'HeadMove') {
      return movementEvents.some((event) => normalizeMovementOperation(event?.operation) === 'HeadMove')
        || chains.some((chain) => normalizeChainType(chain?.type) === 'head');
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

    const dependencyTypes = new Set(
      (clausalDependencies || [])
        .map((entry) => normalizeKey(entry?.type))
        .filter(Boolean)
    );
    const dependencySubtypes = new Set(
      (clausalDependencies || [])
        .map((entry) => normalizeKey(entry?.subtype))
        .filter(Boolean)
    );
    const buildLedgerIdSet = (entries, ...fields) => new Set(
      (Array.isArray(entries) ? entries : [])
        .flatMap((entry) => fields.map((field) => normalizeOptionalStepText(entry?.[field])))
        .filter(Boolean)
    );
    const commitmentFactsById = new Map(
      (Array.isArray(commitmentGraph) ? commitmentGraph : [])
        .map((entry) => {
          const factId = normalizeOptionalStepText(entry?.factId || entry?.id);
          const kind = normalizeKey(entry?.kind);
          return factId && kind ? [factId, kind] : null;
        })
        .filter(Boolean)
    );
    const commitmentKinds = new Set(commitmentFactsById.values());
    const hasCommitmentKindSupport = (...kinds) =>
      kinds.some((kind) => commitmentKinds.has(normalizeKey(kind)));
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
      return ids.some((id) => allowedKinds.has(commitmentFactsById.get(id)));
    };
    const hasTypedOrCommitmentSupport = (binding, { fields = [], supportSets = [], commitmentKinds: requiredKinds = [] } = {}) =>
      hasTypedSupport(binding, fields, supportSets) || hasCommitmentFactSupport(binding, ...requiredKinds);
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
    const hasAnyClausalDependencySupport =
      dependencyTypes.size > 0
      || dependencySubtypes.size > 0
      || hasCommitmentKindSupport('clausal-dependency');
    const hasControlDependency = dependencyTypes.has('control') || Array.from(dependencySubtypes).some((key) => key.includes('control'));
    const hasRaisingDependency = dependencyTypes.has('raising') || Array.from(dependencySubtypes).some((key) => key.includes('raising'));
    const hasEcmDependency = dependencyTypes.has('ecm') || Array.from(dependencySubtypes).some((key) => key === 'ecm' || key.includes('exceptionalcasemarking'));
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
    const hasStructuralOrTypedSupport = (binding, config = {}) =>
      hasStructuralAnchor(binding) || hasTypedOrCommitmentSupport(binding, config);

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

      if (noteAssertsRaising(text) && hasAnyClausalDependencySupport && !hasRaisingDependency) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention raising but clausalDependencies do not encode a raising relation.',
          502
        );
      }

      if (noteAssertsControl(text) && hasAnyClausalDependencySupport && !hasControlDependency) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention control but clausalDependencies do not encode a control relation.',
          502
        );
      }

      if (
        NOTE_TEXT_SUBJECT_CONTROL_RE.test(text)
        && hasControlDependency
        && dependencySubtypes.size > 0
        && !dependencySubtypes.has(normalizeKey('subject-control'))
      ) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention subject control but clausalDependencies do not encode subtype "subject-control".',
          502
        );
      }

      if (
        NOTE_TEXT_OBJECT_CONTROL_RE.test(text)
        && hasControlDependency
        && dependencySubtypes.size > 0
        && !dependencySubtypes.has(normalizeKey('object-control'))
      ) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention object control but clausalDependencies do not encode subtype "object-control".',
          502
        );
      }

      if (noteAssertsEcm(text) && hasAnyClausalDependencySupport && !hasEcmDependency) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention ECM but clausalDependencies do not encode an ECM relation.',
          502
        );
      }

      if (NOTE_TEXT_WH_CHAIN_RE.test(text) && !hasMovementSupport({ movementEvents, chains }, 'AbarMove')) {
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

      if (NOTE_TEXT_A_CHAIN_RE.test(text) && !NOTE_TEXT_CONTROL_RE.test(text) && !hasMovementSupport({ movementEvents, chains }, 'A-Move')) {
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

      if (NOTE_TEXT_HEAD_CHAIN_RE.test(text) && !hasMovementSupport({ movementEvents, chains }, 'HeadMove')) {
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

      if (NOTE_TEXT_CASE_RE.test(text) && !hasCaseLedger && !hasCommitmentKindSupport('case')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention case but the structured derivation does not encode case commitments in commitmentGraph or caseAssignments.',
          502
        );
      }
      if (NOTE_TEXT_CASE_RE.test(text) && !hasTypedOrCommitmentSupport(binding, {
        fields: ['caseAssignmentIds'],
        supportSets: [caseAssignmentIdSet],
        commitmentKinds: ['case']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention case but do not cite supporting commitmentGraph facts or caseAssignments.',
          502
        );
      }

      if (NOTE_TEXT_FEATURE_RE.test(text) && !hasFeatureLedger && !hasCommitmentKindSupport('feature')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention feature-checking facts but the structured derivation does not encode feature commitments in commitmentGraph or featureLedger.',
          502
        );
      }
      if (NOTE_TEXT_FEATURE_RE.test(text) && !hasTypedOrCommitmentSupport(binding, {
        fields: ['featureEntryIds'],
        supportSets: [featureEntryIdSet],
        commitmentKinds: ['feature']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention feature-checking facts but do not cite supporting commitmentGraph facts or featureLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_PHASE_RE.test(text) && !hasPhaseLog && !hasCommitmentKindSupport('phase') && !hasStructuralAnchor(binding)) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention phase or transfer facts but the structured derivation does not encode phase commitments in commitmentGraph or phaseLog.',
          502
        );
      }
      if (NOTE_TEXT_PHASE_RE.test(text) && !hasStructuralOrTypedSupport(binding, {
        fields: ['phaseIds'],
        supportSets: [phaseIdSet],
        commitmentKinds: ['phase']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention phase or transfer facts but are not anchored to the derivation or supporting commitmentGraph/phaseLog entries.',
          502
        );
      }

      if (NOTE_TEXT_MORPHOLOGY_RE.test(text) && !hasMorphologyRealization && !hasCommitmentKindSupport('morphology')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention morphology/exponence facts but the structured derivation does not encode morphology commitments in commitmentGraph or morphologyRealization.',
          502
        );
      }
      if (NOTE_TEXT_MORPHOLOGY_RE.test(text) && !hasTypedOrCommitmentSupport(binding, {
        fields: ['morphologyIds'],
        supportSets: [morphologyIdSet],
        commitmentKinds: ['morphology']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention morphology/exponence facts but do not cite supporting commitmentGraph facts or morphologyRealization entries.',
          502
        );
      }

      if (NOTE_TEXT_THETA_RE.test(text) && !hasArgumentLedger && !hasCommitmentKindSupport('argument-structure')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention theta-role or argument-structure facts but the structured derivation does not encode argument-structure commitments in commitmentGraph or argumentStructure.',
          502
        );
      }
      if (NOTE_TEXT_THETA_RE.test(text) && !hasTypedOrCommitmentSupport(binding, {
        fields: ['argumentIds'],
        supportSets: [argumentIdSet],
        commitmentKinds: ['argument-structure']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention theta-role facts but do not cite supporting commitmentGraph facts or argumentStructure entries.',
          502
        );
      }

      if (NOTE_TEXT_SELECTION_RE.test(text) && !hasSelectionLedger && !hasCommitmentKindSupport('selection') && !hasStructuralAnchor(binding)) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention selection/complement structure but the structured derivation does not encode selection commitments in commitmentGraph or selectionLedger.',
          502
        );
      }
      if (NOTE_TEXT_SELECTION_RE.test(text) && !hasStructuralOrTypedSupport(binding, {
        fields: ['selectionIds'],
        supportSets: [selectionIdSet],
        commitmentKinds: ['selection']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention selection but are not anchored to the derivation or supporting commitmentGraph/selectionLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_BINDING_RE.test(text) && !hasBindingLedger && !hasCommitmentKindSupport('binding')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention binding-domain facts but the structured derivation does not encode binding commitments in commitmentGraph or bindingLedger.',
          502
        );
      }
      if (NOTE_TEXT_BINDING_RE.test(text) && !hasTypedOrCommitmentSupport(binding, {
        fields: ['bindingIds'],
        supportSets: [bindingIdSet],
        commitmentKinds: ['binding']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention binding facts but do not cite supporting commitmentGraph facts or bindingLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_AGREEMENT_RE.test(text) && !hasAgreementLedger && !hasCommitmentKindSupport('agreement')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention agreement or noun-class facts but the structured derivation does not encode agreement commitments in commitmentGraph or agreementLedger.',
          502
        );
      }
      if (NOTE_TEXT_AGREEMENT_RE.test(text) && !hasTypedOrCommitmentSupport(binding, {
        fields: ['agreementIds'],
        supportSets: [agreementIdSet],
        commitmentKinds: ['agreement']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention agreement facts but do not cite supporting commitmentGraph facts or agreementLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_PREDICATE_CLASS_RE.test(text) && !hasPredicateClassLedger && !hasCommitmentKindSupport('predicate-class')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention predicate-class facts but the structured derivation does not encode predicate-class commitments in commitmentGraph or predicateClassLedger.',
          502
        );
      }
      if (NOTE_TEXT_PREDICATE_CLASS_RE.test(text) && !hasTypedOrCommitmentSupport(binding, {
        fields: ['predicateClassIds'],
        supportSets: [predicateClassIdSet],
        commitmentKinds: ['predicate-class']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention predicate-class facts but do not cite supporting commitmentGraph facts or predicateClassLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_PROBE_RE.test(text) && !hasProbeLedger && !hasCommitmentKindSupport('probe')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention probing or probe directionality but the structured derivation does not encode probe commitments in commitmentGraph or probeLedger.',
          502
        );
      }
      if (NOTE_TEXT_PROBE_RE.test(text) && !hasTypedOrCommitmentSupport(binding, {
        fields: ['probeIds'],
        supportSets: [probeIdSet],
        commitmentKinds: ['probe']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention probing facts but do not cite supporting commitmentGraph facts or probeLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_NULL_ELEMENT_RE.test(text) && !hasNullElementLedger && !hasCommitmentKindSupport('null-element') && !hasStructuralAnchor(binding)) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention silent/null elements but the structured derivation does not encode null-element commitments in commitmentGraph or nullElementLedger.',
          502
        );
      }
      if (NOTE_TEXT_NULL_ELEMENT_RE.test(text) && !hasStructuralOrTypedSupport(binding, {
        fields: ['nullElementIds'],
        supportSets: [nullElementIdSet],
        commitmentKinds: ['null-element']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention null-element facts but are not anchored to the derivation or supporting commitmentGraph/nullElementLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_DIAGNOSTIC_RE.test(text) && !hasDiagnosticLedger && !hasCommitmentKindSupport('diagnostic')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention diagnostics but the structured derivation does not encode diagnostic commitments in commitmentGraph or diagnosticLedger.',
          502
        );
      }
      if (NOTE_TEXT_DIAGNOSTIC_RE.test(text) && !hasTypedOrCommitmentSupport(binding, {
        fields: ['diagnosticIds'],
        supportSets: [diagnosticIdSet],
        commitmentKinds: ['diagnostic']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention diagnostics but do not cite supporting commitmentGraph facts or diagnosticLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_PARAMETER_RE.test(text) && !hasParameterLedger && !hasCommitmentKindSupport('parameter')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention parameterization but the structured derivation does not encode parameter commitments in commitmentGraph or parameterLedger.',
          502
        );
      }
      if (NOTE_TEXT_PARAMETER_RE.test(text) && !hasTypedOrCommitmentSupport(binding, {
        fields: ['parameterIds'],
        supportSets: [parameterIdSet, probeIdSet],
        commitmentKinds: ['parameter', 'probe']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention parameter facts but do not cite supporting commitmentGraph facts or parameter/probe ledger entries.',
          502
        );
      }

      if (NOTE_TEXT_INFORMATION_STRUCTURE_RE.test(text) && !hasInformationStructureLedger && !hasCommitmentKindSupport('information-structure')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention information-structure facts but the structured derivation does not encode information-structure commitments in commitmentGraph or informationStructureLedger.',
          502
        );
      }
      if (NOTE_TEXT_INFORMATION_STRUCTURE_RE.test(text) && !hasTypedOrCommitmentSupport(binding, {
        fields: ['informationStructureIds'],
        supportSets: [informationStructureIdSet],
        commitmentKinds: ['information-structure']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention information-structure facts but do not cite supporting commitmentGraph facts or informationStructureLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_OPERATOR_SCOPE_RE.test(text) && !hasOperatorScopeLedger && !hasCommitmentKindSupport('operator-scope')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention operator/scope facts but the structured derivation does not encode operator-scope commitments in commitmentGraph or operatorScopeLedger.',
          502
        );
      }
      if (NOTE_TEXT_OPERATOR_SCOPE_RE.test(text) && !hasTypedOrCommitmentSupport(binding, {
        fields: ['operatorScopeIds'],
        supportSets: [operatorScopeIdSet],
        commitmentKinds: ['operator-scope']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention scope facts but do not cite supporting commitmentGraph facts or operatorScopeLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_VOICE_VALENCY_RE.test(text) && !hasVoiceValencyLedger && !hasCommitmentKindSupport('voice-valency')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention voice/valency facts but the structured derivation does not encode voice-valency commitments in commitmentGraph or voiceValencyLedger.',
          502
        );
      }
      if (NOTE_TEXT_VOICE_VALENCY_RE.test(text) && !hasTypedOrCommitmentSupport(binding, {
        fields: ['voiceValencyIds'],
        supportSets: [voiceValencyIdSet],
        commitmentKinds: ['voice-valency']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention voice/valency facts but do not cite supporting commitmentGraph facts or voiceValencyLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_LINEARIZATION_RE.test(text) && !hasLinearizationLedger && !hasCommitmentKindSupport('linearization') && !hasStructuralAnchor(binding)) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention linearization/word-order facts but the structured derivation does not encode linearization commitments in commitmentGraph or linearizationLedger.',
          502
        );
      }
      if (NOTE_TEXT_LINEARIZATION_RE.test(text) && !isClosureBinding && !hasStructuralOrTypedSupport(binding, {
        fields: ['linearizationIds'],
        supportSets: [linearizationIdSet],
        commitmentKinds: ['linearization']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention linearization facts but are not anchored to the derivation or supporting commitmentGraph/linearizationLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_LOCALITY_RE.test(text) && !hasLocalityLedger && !hasCommitmentKindSupport('locality') && !hasStructuralAnchor(binding)) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention locality facts but the structured derivation does not encode locality commitments in commitmentGraph or localityLedger.',
          502
        );
      }
      if (NOTE_TEXT_LOCALITY_RE.test(text) && !isClosureBinding && !hasStructuralOrTypedSupport(binding, {
        fields: ['localityIds'],
        supportSets: [localityIdSet],
        commitmentKinds: ['locality']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention locality facts but are not anchored to the derivation or supporting commitmentGraph/localityLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_PREDICATION_RE.test(text) && !hasPredicationLedger && !hasCommitmentKindSupport('predication')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention predication facts but the structured derivation does not encode predication commitments in commitmentGraph or predicationLedger.',
          502
        );
      }
      if (NOTE_TEXT_PREDICATION_RE.test(text) && !hasTypedOrCommitmentSupport(binding, {
        fields: ['predicationIds'],
        supportSets: [predicationIdSet],
        commitmentKinds: ['predication']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention predication facts but do not cite supporting commitmentGraph facts or predicationLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_PARTICLE_RE.test(text) && !hasParticleLedger && !hasCommitmentKindSupport('particle')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention particle facts but the structured derivation does not encode particle commitments in commitmentGraph or particleLedger.',
          502
        );
      }
      if (NOTE_TEXT_PARTICLE_RE.test(text) && !hasTypedOrCommitmentSupport(binding, {
        fields: ['particleIds'],
        supportSets: [particleIdSet],
        commitmentKinds: ['particle']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention particle facts but do not cite supporting commitmentGraph facts or particleLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_EVIDENTIALITY_RE.test(text) && !hasEvidentialityLedger && !hasCommitmentKindSupport('evidentiality')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention evidentiality facts but the structured derivation does not encode evidentiality commitments in commitmentGraph or evidentialityLedger.',
          502
        );
      }
      if (NOTE_TEXT_EVIDENTIALITY_RE.test(text) && !hasTypedOrCommitmentSupport(binding, {
        fields: ['evidentialityIds'],
        supportSets: [evidentialityIdSet],
        commitmentKinds: ['evidentiality']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention evidentiality facts but do not cite supporting commitmentGraph facts or evidentialityLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_MIRATIVITY_RE.test(text) && !hasMirativityLedger && !hasCommitmentKindSupport('mirativity')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention mirativity facts but the structured derivation does not encode mirativity commitments in commitmentGraph or mirativityLedger.',
          502
        );
      }
      if (NOTE_TEXT_MIRATIVITY_RE.test(text) && !hasTypedOrCommitmentSupport(binding, {
        fields: ['mirativityIds'],
        supportSets: [mirativityIdSet],
        commitmentKinds: ['mirativity']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention mirativity facts but do not cite supporting commitmentGraph facts or mirativityLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_HONORIFICITY_RE.test(text) && !hasHonorificityLedger && !hasCommitmentKindSupport('honorificity')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention honorificity facts but the structured derivation does not encode honorificity commitments in commitmentGraph or honorificityLedger.',
          502
        );
      }
      if (NOTE_TEXT_HONORIFICITY_RE.test(text) && !hasTypedOrCommitmentSupport(binding, {
        fields: ['honorificityIds'],
        supportSets: [honorificityIdSet],
        commitmentKinds: ['honorificity']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention honorificity facts but do not cite supporting commitmentGraph facts or honorificityLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_SWITCH_REFERENCE_RE.test(text) && !hasSwitchReferenceLedger && !hasCommitmentKindSupport('switch-reference')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention switch-reference facts but the structured derivation does not encode switch-reference commitments in commitmentGraph or switchReferenceLedger.',
          502
        );
      }
      if (NOTE_TEXT_SWITCH_REFERENCE_RE.test(text) && !hasTypedOrCommitmentSupport(binding, {
        fields: ['switchReferenceIds'],
        supportSets: [switchReferenceIdSet],
        commitmentKinds: ['switch-reference']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention switch-reference facts but do not cite supporting commitmentGraph facts or switchReferenceLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_LOGOPHORA_RE.test(text) && !hasLogophoraLedger && !hasCommitmentKindSupport('logophora')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention logophoric facts but the structured derivation does not encode logophora commitments in commitmentGraph or logophoraLedger.',
          502
        );
      }
      if (NOTE_TEXT_LOGOPHORA_RE.test(text) && !hasTypedOrCommitmentSupport(binding, {
        fields: ['logophoraIds'],
        supportSets: [logophoraIdSet],
        commitmentKinds: ['logophora']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention logophoric facts but do not cite supporting commitmentGraph facts or logophoraLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_EVENT_STRUCTURE_RE.test(text) && !hasEventStructureLedger && !hasCommitmentKindSupport('event-structure')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention event-structure or lexical-aspect facts but the structured derivation does not encode event-structure commitments in commitmentGraph or eventStructureLedger.',
          502
        );
      }
      if (NOTE_TEXT_EVENT_STRUCTURE_RE.test(text) && !hasTypedOrCommitmentSupport(binding, {
        fields: ['eventStructureIds'],
        supportSets: [eventStructureIdSet],
        commitmentKinds: ['event-structure']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention event-structure or lexical-aspect facts but do not cite supporting commitmentGraph facts or eventStructureLedger entries.',
          502
        );
      }

      if ((noteAssertsRaising(text) || noteAssertsControl(text) || noteAssertsEcm(text)) && !hasTypedOrCommitmentSupport(binding, {
        fields: ['dependencyIds'],
        supportSets: [dependencyIdSet],
        commitmentKinds: ['clausal-dependency']
      })) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention clausal dependency facts but do not cite supporting commitmentGraph facts or clausalDependencies entries.',
          502
        );
      }
    }
  };

  const shouldWarnOnSemanticValidationFailure = () => process.env.NODE_ENV === 'production';
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
    researchTrace,
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
      Array.isArray(researchTrace) && researchTrace.length > 0,
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

  return {
    validatePronouncedCopiesAgainstCommittedTree,
    validateNoteBindingsAgainstStructuredAnalysis,
    runSemanticValidation,
    auditNoteConsistency,
    computeCompletenessStatus
  };
};
