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
    clausalDependencies = [],
    caseAssignments = [],
    argumentStructure = [],
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
    predicationLedger = []
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
    const hasAnyClausalDependencySupport = dependencyTypes.size > 0 || dependencySubtypes.size > 0;
    const hasControlDependency = dependencyTypes.has('control') || Array.from(dependencySubtypes).some((key) => key.includes('control'));
    const hasRaisingDependency = dependencyTypes.has('raising') || Array.from(dependencySubtypes).some((key) => key.includes('raising'));
    const hasEcmDependency = dependencyTypes.has('ecm') || Array.from(dependencySubtypes).some((key) => key === 'ecm' || key.includes('exceptionalcasemarking'));
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
    const hasBindingLinks = (binding, ...fields) =>
      fields.some((field) => Array.isArray(binding?.[field]) && binding[field].some((value) => normalizeOptionalStepText(value)));
    const hasStructuralAnchor = (binding) =>
      Boolean(normalizeOptionalStepText(binding?.chainId))
      || hasBindingLinks(binding, 'stepIds', 'nodeIds');
    const hasStructuralOrTypedSupport = (binding, ...fields) =>
      hasBindingLinks(binding, ...fields) || hasStructuralAnchor(binding);

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

      if (NOTE_TEXT_CASE_RE.test(text) && !hasCaseLedger) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention case but the structured derivation does not encode caseAssignments.',
          502
        );
      }
      if (NOTE_TEXT_CASE_RE.test(text) && !hasBindingLinks(binding, 'caseAssignmentIds', 'supportIds')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention case but do not cite supporting caseAssignments with supportIds/caseAssignmentIds.',
          502
        );
      }

      if (NOTE_TEXT_THETA_RE.test(text) && !hasArgumentLedger) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention theta-role or argument-structure facts but the structured derivation does not encode argumentStructure.',
          502
        );
      }
      if (NOTE_TEXT_THETA_RE.test(text) && !hasBindingLinks(binding, 'argumentIds', 'supportIds')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention theta-role facts but do not cite supporting argumentStructure entries.',
          502
        );
      }

      if (NOTE_TEXT_SELECTION_RE.test(text) && !hasSelectionLedger && !hasStructuralAnchor(binding)) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention selection/complement structure but the structured derivation does not encode selectionLedger.',
          502
        );
      }
      if (NOTE_TEXT_SELECTION_RE.test(text) && !hasStructuralOrTypedSupport(binding, 'selectionIds', 'supportIds')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention selection but are not anchored to the derivation or supporting selectionLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_BINDING_RE.test(text) && !hasBindingLedger) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention binding-domain facts but the structured derivation does not encode bindingLedger.',
          502
        );
      }
      if (NOTE_TEXT_BINDING_RE.test(text) && !hasBindingLinks(binding, 'bindingIds', 'supportIds')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention binding facts but do not cite supporting bindingLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_AGREEMENT_RE.test(text) && !hasAgreementLedger) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention agreement or noun-class facts but the structured derivation does not encode agreementLedger.',
          502
        );
      }
      if (NOTE_TEXT_AGREEMENT_RE.test(text) && !hasBindingLinks(binding, 'agreementIds', 'supportIds')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention agreement facts but do not cite supporting agreementLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_PREDICATE_CLASS_RE.test(text) && !hasPredicateClassLedger) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention predicate-class facts but the structured derivation does not encode predicateClassLedger.',
          502
        );
      }
      if (NOTE_TEXT_PREDICATE_CLASS_RE.test(text) && !hasBindingLinks(binding, 'predicateClassIds', 'supportIds')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention predicate-class facts but do not cite supporting predicateClassLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_PROBE_RE.test(text) && !hasProbeLedger) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention probing or probe directionality but the structured derivation does not encode probeLedger.',
          502
        );
      }
      if (NOTE_TEXT_PROBE_RE.test(text) && !hasBindingLinks(binding, 'probeIds', 'supportIds')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention probing facts but do not cite supporting probeLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_NULL_ELEMENT_RE.test(text) && !hasNullElementLedger && !hasStructuralAnchor(binding)) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention silent/null elements but the structured derivation does not encode nullElementLedger.',
          502
        );
      }
      if (NOTE_TEXT_NULL_ELEMENT_RE.test(text) && !hasStructuralOrTypedSupport(binding, 'nullElementIds', 'supportIds')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention null-element facts but are not anchored to the derivation or supporting nullElementLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_DIAGNOSTIC_RE.test(text) && !hasDiagnosticLedger) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention diagnostics but the structured derivation does not encode diagnosticLedger.',
          502
        );
      }
      if (NOTE_TEXT_DIAGNOSTIC_RE.test(text) && !hasBindingLinks(binding, 'diagnosticIds', 'supportIds')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention diagnostics but do not cite supporting diagnosticLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_PARAMETER_RE.test(text) && !hasParameterLedger) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention parameterization but the structured derivation does not encode parameterLedger.',
          502
        );
      }
      if (NOTE_TEXT_PARAMETER_RE.test(text) && !hasBindingLinks(binding, 'parameterIds', 'supportIds')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention parameter facts but do not cite supporting parameterLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_INFORMATION_STRUCTURE_RE.test(text) && !hasInformationStructureLedger) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention information-structure facts but the structured derivation does not encode informationStructureLedger.',
          502
        );
      }
      if (NOTE_TEXT_INFORMATION_STRUCTURE_RE.test(text) && !hasBindingLinks(binding, 'informationStructureIds', 'supportIds')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention information-structure facts but do not cite supporting informationStructureLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_OPERATOR_SCOPE_RE.test(text) && !hasOperatorScopeLedger) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention operator/scope facts but the structured derivation does not encode operatorScopeLedger.',
          502
        );
      }
      if (NOTE_TEXT_OPERATOR_SCOPE_RE.test(text) && !hasBindingLinks(binding, 'operatorScopeIds', 'supportIds')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention scope facts but do not cite supporting operatorScopeLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_VOICE_VALENCY_RE.test(text) && !hasVoiceValencyLedger) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention voice/valency facts but the structured derivation does not encode voiceValencyLedger.',
          502
        );
      }
      if (NOTE_TEXT_VOICE_VALENCY_RE.test(text) && !hasBindingLinks(binding, 'voiceValencyIds', 'supportIds')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention voice/valency facts but do not cite supporting voiceValencyLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_LINEARIZATION_RE.test(text) && !hasLinearizationLedger && !hasStructuralAnchor(binding)) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention linearization/word-order facts but the structured derivation does not encode linearizationLedger.',
          502
        );
      }
      if (NOTE_TEXT_LINEARIZATION_RE.test(text) && !isClosureBinding && !hasStructuralOrTypedSupport(binding, 'linearizationIds', 'supportIds')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention linearization facts but are not anchored to the derivation or supporting linearizationLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_LOCALITY_RE.test(text) && !hasLocalityLedger && !hasStructuralAnchor(binding)) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention locality facts but the structured derivation does not encode localityLedger.',
          502
        );
      }
      if (NOTE_TEXT_LOCALITY_RE.test(text) && !isClosureBinding && !hasStructuralOrTypedSupport(binding, 'localityIds', 'supportIds')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention locality facts but are not anchored to the derivation or supporting localityLedger entries.',
          502
        );
      }

      if (NOTE_TEXT_PREDICATION_RE.test(text) && !hasPredicationLedger) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention predication facts but the structured derivation does not encode predicationLedger.',
          502
        );
      }
      if (NOTE_TEXT_PREDICATION_RE.test(text) && !hasBindingLinks(binding, 'predicationIds', 'supportIds')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention predication facts but do not cite supporting predicationLedger entries.',
          502
        );
      }

      if ((noteAssertsRaising(text) || noteAssertsControl(text) || noteAssertsEcm(text)) && !hasBindingLinks(binding, 'dependencyIds', 'supportIds')) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Notes mention clausal dependency facts but do not cite supporting clausalDependencies entries.',
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
    predicationLedger
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
      Array.isArray(predicationLedger) && predicationLedger.length > 0
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
