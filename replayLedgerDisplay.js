export const stringifyLedgerAtom = (value) => String(value || '').trim();

export const isLedgerPlaceholderText = (value) => {
  const normalized = stringifyLedgerAtom(value).toLowerCase();
  if (!normalized) return true;
  return normalized === 'none'
    || normalized === 'null'
    || normalized === 'n/a'
    || normalized === 'unspecified category'
    || normalized === 'unspecified selector'
    || normalized.startsWith('unspecified ');
};

export const hasMeaningfulLedgerText = (value) => !isLedgerPlaceholderText(value);

export const unwrapLedgerCategoryWrapper = (value) => {
  const raw = stringifyLedgerAtom(value);
  if (!raw) return null;
  const match = raw.match(/^([A-Za-z][A-Za-z0-9'_-]*)\s*\((.+)\)$/);
  if (!match) return null;
  const category = stringifyLedgerAtom(match[1]);
  const inner = stringifyLedgerAtom(match[2]);
  if (!category || !inner) return null;
  return { category, inner };
};

export const normalizeLedgerDisplay = (
  value,
  { categoryHint = '', preferInner = false } = {}
) => {
  const raw = stringifyLedgerAtom(value);
  if (!raw) return '';
  const wrapper = unwrapLedgerCategoryWrapper(raw);
  if (!wrapper) return raw;
  const innerLooksSilent = /^(?:∅|null(?:\s+[A-Za-z]+)*)$/i.test(wrapper.inner);
  if (innerLooksSilent) {
    return wrapper.category;
  }
  const hinted = stringifyLedgerAtom(categoryHint);
  if (hinted && wrapper.category.toLowerCase() === hinted.toLowerCase()) {
    return wrapper.inner;
  }
  return preferInner ? wrapper.inner : raw;
};

export const humanizeLedgerFallbackId = (value) => {
  const raw = stringifyLedgerAtom(value);
  if (!raw) return '';
  const wrapper = unwrapLedgerCategoryWrapper(raw);
  if (wrapper) return wrapper.inner;
  const indexedShellMatch = raw.match(/^([A-Za-z][A-Za-z0-9']*)(\d+)$/);
  if (indexedShellMatch) {
    return indexedShellMatch[1];
  }
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\b(mat|matrix|emb|embedded|subj|obj|arg|comp)\b/gi, (token) => token.toLowerCase())
    .replace(/\s+/g, ' ')
    .trim();
};

export const humanizeLedgerStructuralHead = (value) => {
  const raw = stringifyLedgerAtom(value);
  if (!raw) return '';
  const wrapper = unwrapLedgerCategoryWrapper(raw);
  if (wrapper?.category) return wrapper.category;
  const match = raw.match(/^(cp|cbar|c|inflp|inflbar|infl|tp|tbar|t|vp|vbar|v|dp|dbar|d|np|nbar|n|pp|pbar|p|ap|abar|a|ip|ibar|i)(?:[_-]|$)/i);
  if (match) {
    const matchedToken = match[1];
    const token = matchedToken.toLowerCase();
    if (token === 't' || token === 'tp' || token === 'tbar' || token === 'i' || token === 'ip' || token === 'ibar') {
      return 'Infl';
    }
    if (token === 'infl' || token === 'inflp' || token === 'inflbar') return 'Infl';
    if (token === 'c' || token === 'cp' || token === 'cbar') return 'C';
    if (token === 'v' || token === 'vp' || token === 'vbar') {
      if (token === 'v') return matchedToken === 'v' ? 'v' : 'V';
      return token.toUpperCase();
    }
    if (token === 'd' || token === 'dp' || token === 'dbar') return token === 'd' ? 'D' : token.toUpperCase();
    if (token === 'n' || token === 'np' || token === 'nbar') return token === 'n' ? 'N' : token.toUpperCase();
    if (token === 'p' || token === 'pp' || token === 'pbar') return token === 'p' ? 'P' : token.toUpperCase();
    if (token === 'a' || token === 'ap' || token === 'abar') return token === 'a' ? 'A' : token.toUpperCase();
  }
  return humanizeLedgerFallbackId(raw);
};

const isStructuralProjectionText = (value = '') => /^[A-Za-z][A-Za-z0-9'_-]*P$/.test(stringifyLedgerAtom(value));

export const formatSelectionReplayEntry = ({
  selector = '',
  selectedLabel = '',
  selectedCategory = '',
  relation = ''
} = {}) => {
  const normalizedSelector = normalizeLedgerDisplay(selector, { preferInner: false });
  const rawCategory = stringifyLedgerAtom(selectedCategory);
  const categoryWrapper = unwrapLedgerCategoryWrapper(rawCategory);
  const category = categoryWrapper ? categoryWrapper.category : rawCategory;
  const rawSelectedLabel = stringifyLedgerAtom(selectedLabel);
  const selectedWrapper = unwrapLedgerCategoryWrapper(rawSelectedLabel);
  const label = humanizeLedgerFallbackId(
    normalizeLedgerDisplay(selectedLabel, { categoryHint: selectedCategory, preferInner: true })
  );
  const selected = (() => {
    if (hasMeaningfulLedgerText(category) && isStructuralProjectionText(category)) {
      if (categoryWrapper && hasMeaningfulLedgerText(categoryWrapper.inner)) {
        return `${category} (${categoryWrapper.inner})`;
      }
      if (selectedWrapper && selectedWrapper.category.toLowerCase() === category.toLowerCase()) {
        return selectedWrapper.inner ? `${category} (${selectedWrapper.inner})` : category;
      }
      if (hasMeaningfulLedgerText(label) && label.toLowerCase() !== category.toLowerCase()) {
        return `${category} (${label})`;
      }
      return category;
    }
    if (hasMeaningfulLedgerText(label) && hasMeaningfulLedgerText(category)) {
      const normalizedLabel = label.toLowerCase();
      const normalizedCategory = category.toLowerCase();
      if (normalizedLabel !== normalizedCategory) {
        return `${label} [${category}]`;
      }
    }
    return label || category || 'unspecified category';
  })();

  if (!hasMeaningfulLedgerText(normalizedSelector) || !hasMeaningfulLedgerText(selected)) return '';
  return relation ? `${normalizedSelector} selects ${selected} (${relation})` : `${normalizedSelector} selects ${selected}`;
};

export const formatCaseAssignmentReplayEntry = ({
  assignee = '',
  assignedCase = '',
  assigner = '',
  mechanism = '',
  position = ''
} = {}) => {
  const normalizedAssignee = normalizeLedgerDisplay(assignee, { preferInner: true });
  const normalizedCase = stringifyLedgerAtom(assignedCase) || 'Unspecified case';
  const normalizedAssigner = normalizeLedgerDisplay(assigner, { preferInner: false });
  const assignerDisplay = hasMeaningfulLedgerText(normalizedAssigner)
    ? humanizeLedgerStructuralHead(normalizedAssigner)
    : '';
  const extras = [
    assignerDisplay ? `by ${assignerDisplay}` : '',
    stringifyLedgerAtom(mechanism) ? `via ${stringifyLedgerAtom(mechanism)}` : '',
    stringifyLedgerAtom(position) ? `at ${stringifyLedgerAtom(position)}` : ''
  ].filter(Boolean).join(', ');
  if (!hasMeaningfulLedgerText(normalizedAssignee)) return '';
  return extras ? `${normalizedAssignee}: ${normalizedCase} (${extras})` : `${normalizedAssignee}: ${normalizedCase}`;
};

export const formatThetaAssignmentReplayEntry = ({
  referent = '',
  role = '',
  predicate = '',
  introducer = '',
  position = ''
} = {}) => {
  const normalizedReferent = normalizeLedgerDisplay(referent, { preferInner: true });
  const normalizedRole = stringifyLedgerAtom(role);
  const normalizedPredicate = normalizeLedgerDisplay(predicate, { preferInner: true });
  const normalizedIntroducer = normalizeLedgerDisplay(introducer, { preferInner: true });
  if (
    !hasMeaningfulLedgerText(normalizedReferent)
    || !hasMeaningfulLedgerText(normalizedRole)
    || !hasMeaningfulLedgerText(normalizedPredicate)
  ) {
    return '';
  }
  const extras = [
    normalizedPredicate ? `of ${normalizedPredicate}` : '',
    normalizedIntroducer ? `introduced by ${normalizedIntroducer}` : '',
    stringifyLedgerAtom(position) ? `at ${stringifyLedgerAtom(position)}` : ''
  ].filter(Boolean).join(', ');
  const head = `${normalizedReferent}: ${normalizedRole}`;
  return extras ? `${head} (${extras})` : head;
};

export const formatBindingReplayEntry = ({
  antecedent = '',
  dependent = '',
  principle = '',
  relation = '',
  status = ''
} = {}) => {
  const normalizedAntecedent = normalizeLedgerDisplay(antecedent, { preferInner: true });
  const normalizedDependent = normalizeLedgerDisplay(dependent, { preferInner: true });
  const normalizedPrinciple = stringifyLedgerAtom(principle);
  const normalizedRelation = stringifyLedgerAtom(relation);
  const normalizedStatus = stringifyLedgerAtom(status);
  const hasCoreRelation = hasMeaningfulLedgerText(normalizedAntecedent) || hasMeaningfulLedgerText(normalizedDependent);
  const hasBindingFact = ['A', 'B', 'C'].includes(normalizedPrinciple.toUpperCase())
    || hasMeaningfulLedgerText(normalizedRelation)
    || hasMeaningfulLedgerText(normalizedStatus);
  if (!hasCoreRelation && !hasBindingFact) return '';
  const details = [
    normalizedPrinciple ? `Principle ${normalizedPrinciple}` : '',
    normalizedRelation,
    normalizedStatus
  ].filter(Boolean).join(', ');
  const core = `${normalizedAntecedent} -> ${normalizedDependent}`.trim();
  return details ? `${core} (${details})` : core;
};

export const formatClausalDependencyReplayEntry = ({
  label = '',
  controller = '',
  dependent = '',
  predicate = '',
  clause = '',
  evidence = ''
} = {}) => {
  const normalizedLabel = stringifyLedgerAtom(label);
  const lowered = normalizedLabel.toLowerCase();
  const controlLike = lowered.includes('control');
  const raisingLike = lowered.includes('raising');
  const ecmLike = lowered.includes('ecm');
  const complementLike = lowered.includes('complement');
  const preserveDependentWrapper = raisingLike || complementLike;
  const normalizedController = normalizeLedgerDisplay(controller, { preferInner: true });
  const normalizedDependent = normalizeLedgerDisplay(dependent, { preferInner: !preserveDependentWrapper });
  const normalizedPredicate = normalizeLedgerDisplay(predicate, { preferInner: true });
  const normalizedClause = normalizeLedgerDisplay(clause, { preferInner: !preserveDependentWrapper });
  const dependentInner = unwrapLedgerCategoryWrapper(normalizedDependent)?.inner || '';
  const comparableDependent = stringifyLedgerAtom(dependentInner || normalizedDependent).toLowerCase();
  const comparableClause = stringifyLedgerAtom(normalizedClause).toLowerCase();
  const clauseIsRedundant = comparableClause
    && comparableDependent
    && (
      comparableClause === comparableDependent
      || comparableDependent.includes(comparableClause)
    );
  const relationalCore = (() => {
    if (normalizedController && normalizedDependent && controlLike) return `${normalizedController} controls ${normalizedDependent}`;
    if (normalizedController && normalizedDependent && raisingLike) return `${normalizedController} raises with ${normalizedDependent}`;
    if (normalizedController && normalizedDependent && ecmLike) return `${normalizedController} licenses ${normalizedDependent}`;
    if (normalizedController && normalizedDependent) return `${normalizedController} -> ${normalizedDependent}`;
    if (raisingLike && normalizedDependent) return `from ${normalizedDependent}`;
    return '';
  })();
  const extras = [
    normalizedPredicate ? `predicate ${normalizedPredicate}` : '',
    normalizedClause && !clauseIsRedundant ? `clause ${normalizedClause}` : '',
    stringifyLedgerAtom(evidence)
  ].filter(Boolean).join(', ');
  if (relationalCore && extras) return `${normalizedLabel}: ${relationalCore} (${extras})`;
  if (relationalCore) return `${normalizedLabel}: ${relationalCore}`;
  if (normalizedDependent && extras) return `${normalizedLabel}: ${normalizedDependent} (${extras})`;
  if (normalizedDependent) return `${normalizedLabel}: ${normalizedDependent}`;
  if (extras) return `${normalizedLabel}: ${extras}`;
  return normalizedLabel;
};

export const formatAgreementReplayEntry = ({
  probe = '',
  goal = '',
  feature = '',
  value = '',
  morphology = '',
  status = '',
  direction = '',
  domain = '',
  defaultValue = false
} = {}) => {
  const normalizedProbe = normalizeLedgerDisplay(probe, { preferInner: false });
  const normalizedGoal = normalizeLedgerDisplay(goal, { preferInner: true });
  const normalizedFeature = stringifyLedgerAtom(feature);
  const normalizedValue = stringifyLedgerAtom(value);
  const normalizedMorphology = stringifyLedgerAtom(morphology);
  const normalizedStatus = stringifyLedgerAtom(status);
  const normalizedDirection = stringifyLedgerAtom(direction);
  const normalizedDomain = stringifyLedgerAtom(domain);
  const core = (() => {
    if (normalizedProbe && normalizedGoal) {
      const featurePart = normalizedFeature ? ` in ${normalizedFeature}` : '';
      const valuePart = normalizedValue ? ` = ${normalizedValue}` : '';
      return `${normalizedProbe} agrees with ${normalizedGoal}${featurePart}${valuePart}`;
    }
    if (normalizedProbe && defaultValue && normalizedValue) {
      const featurePart = normalizedFeature ? ` ${normalizedFeature}` : '';
      return `${normalizedProbe} shows default${featurePart} ${normalizedValue}`;
    }
    if (normalizedProbe && normalizedValue) {
      const featurePart = normalizedFeature ? ` ${normalizedFeature}` : '';
      return `${normalizedProbe}: ${featurePart.trim()} ${normalizedValue}`.replace(/\s+/g, ' ').trim();
    }
    return '';
  })();
  const extras = [
    normalizedMorphology ? `morphology ${normalizedMorphology}` : '',
    normalizedStatus ? `status ${normalizedStatus}` : '',
    normalizedDirection ? `probe ${normalizedDirection}` : '',
    normalizedDomain ? `domain ${normalizedDomain}` : '',
    defaultValue && !normalizedGoal ? 'default agreement' : ''
  ].filter(Boolean).join(', ');
  if (core && extras) return `${core} (${extras})`;
  return core || extras;
};

export const formatPredicateClassReplayEntry = ({
  predicate = '',
  classification = '',
  subtype = '',
  diagnostics = [],
  evidence = ''
} = {}) => {
  const normalizedPredicate = normalizeLedgerDisplay(predicate, { preferInner: true });
  const normalizedClass = stringifyLedgerAtom(classification);
  const normalizedSubtype = stringifyLedgerAtom(subtype);
  const normalizedDiagnostics = Array.isArray(diagnostics)
    ? diagnostics.map((value) => stringifyLedgerAtom(value)).filter(Boolean)
    : [];
  const core = [normalizedPredicate, normalizedClass || normalizedSubtype].filter(Boolean).join(': ');
  const extras = [
    normalizedSubtype && normalizedSubtype !== normalizedClass ? normalizedSubtype : '',
    normalizedDiagnostics.length > 0 ? `diagnostics ${normalizedDiagnostics.join('; ')}` : '',
    stringifyLedgerAtom(evidence)
  ].filter(Boolean).join(', ');
  if (core && extras) return `${core} (${extras})`;
  return core || extras;
};

export const formatProbeReplayEntry = ({
  probe = '',
  goal = '',
  feature = '',
  direction = '',
  domain = '',
  locality = '',
  outcome = ''
} = {}) => {
  const normalizedProbe = normalizeLedgerDisplay(probe, { preferInner: false });
  const normalizedGoal = normalizeLedgerDisplay(goal, { preferInner: true });
  const normalizedFeature = stringifyLedgerAtom(feature);
  const normalizedDirection = stringifyLedgerAtom(direction);
  const normalizedDomain = stringifyLedgerAtom(domain);
  const normalizedLocality = stringifyLedgerAtom(locality);
  const normalizedOutcome = stringifyLedgerAtom(outcome);
  const core = (() => {
    if (normalizedProbe && normalizedGoal) {
      return `${normalizedProbe} probes ${normalizedGoal}${normalizedFeature ? ` for ${normalizedFeature}` : ''}`;
    }
    if (normalizedProbe) {
      return `${normalizedProbe}${normalizedFeature ? ` probes for ${normalizedFeature}` : ' probes'}`;
    }
    return '';
  })();
  const extras = [
    normalizedDirection ? `direction ${normalizedDirection}` : '',
    normalizedDomain ? `domain ${normalizedDomain}` : '',
    normalizedLocality ? `locality ${normalizedLocality}` : '',
    normalizedOutcome ? `outcome ${normalizedOutcome}` : ''
  ].filter(Boolean).join(', ');
  if (core && extras) return `${core} (${extras})`;
  return core || extras;
};

export const formatNullElementReplayEntry = ({
  label = '',
  kind = '',
  controller = '',
  antecedent = '',
  licensing = '',
  evidence = ''
} = {}) => {
  const normalizedLabel = stringifyLedgerAtom(label) || '∅';
  const normalizedKind = stringifyLedgerAtom(kind);
  const normalizedController = normalizeLedgerDisplay(controller, { preferInner: true });
  const normalizedAntecedent = normalizeLedgerDisplay(antecedent, { preferInner: true });
  const normalizedLicensing = stringifyLedgerAtom(licensing);
  const core = normalizedKind ? `${normalizedLabel}: ${normalizedKind}` : normalizedLabel;
  const extras = [
    normalizedController ? `controller ${normalizedController}` : '',
    normalizedAntecedent ? `antecedent ${normalizedAntecedent}` : '',
    normalizedLicensing ? `licensed by ${normalizedLicensing}` : '',
    stringifyLedgerAtom(evidence)
  ].filter(Boolean).join(', ');
  if (core && extras) return `${core} (${extras})`;
  return core || extras;
};

export const formatDiagnosticReplayEntry = ({
  diagnostic = '',
  observation = '',
  supports = '',
  status = '',
  evidence = ''
} = {}) => {
  const normalizedDiagnostic = stringifyLedgerAtom(diagnostic);
  const normalizedObservation = stringifyLedgerAtom(observation);
  const normalizedSupports = stringifyLedgerAtom(supports);
  const normalizedStatus = stringifyLedgerAtom(status);
  const core = [normalizedDiagnostic, normalizedObservation].filter(Boolean).join(': ');
  const extras = [
    normalizedSupports ? `supports ${normalizedSupports}` : '',
    normalizedStatus ? `status ${normalizedStatus}` : '',
    stringifyLedgerAtom(evidence)
  ].filter(Boolean).join(', ');
  if (core && extras) return `${core} (${extras})`;
  return core || extras;
};

export const formatParameterReplayEntry = ({
  parameter = '',
  value = '',
  domain = '',
  language = '',
  evidence = ''
} = {}) => {
  const normalizedParameter = stringifyLedgerAtom(parameter);
  const normalizedValue = stringifyLedgerAtom(value);
  const normalizedDomain = stringifyLedgerAtom(domain);
  const normalizedLanguage = stringifyLedgerAtom(language);
  const core = [normalizedParameter, normalizedValue].filter(Boolean).join(': ');
  const extras = [
    normalizedDomain ? `domain ${normalizedDomain}` : '',
    normalizedLanguage ? `language ${normalizedLanguage}` : '',
    stringifyLedgerAtom(evidence)
  ].filter(Boolean).join(', ');
  if (core && extras) return `${core} (${extras})`;
  return core || extras;
};

export const formatInformationStructureReplayEntry = ({
  label = '',
  role = '',
  scope = '',
  evidence = ''
} = {}) => {
  const normalizedLabel = normalizeLedgerDisplay(label, { preferInner: true });
  const normalizedRole = stringifyLedgerAtom(role);
  const normalizedScope = stringifyLedgerAtom(scope);
  const core = [normalizedLabel, normalizedRole].filter(Boolean).join(': ');
  const extras = [
    normalizedScope ? `scope ${normalizedScope}` : '',
    stringifyLedgerAtom(evidence)
  ].filter(Boolean).join(', ');
  if (core && extras) return `${core} (${extras})`;
  return core || extras;
};

export const formatOperatorScopeReplayEntry = ({
  operator = '',
  scope = '',
  operatorType = '',
  relation = '',
  evidence = ''
} = {}) => {
  const normalizedOperator = normalizeLedgerDisplay(operator, { preferInner: true });
  const normalizedScope = normalizeLedgerDisplay(scope, { preferInner: true });
  const normalizedType = stringifyLedgerAtom(operatorType);
  const normalizedRelation = stringifyLedgerAtom(relation);
  const core = (() => {
    if (normalizedOperator && normalizedScope) {
      return `${normalizedOperator}${normalizedRelation ? ` ${normalizedRelation}` : ' scopes over'} ${normalizedScope}`;
    }
    return [normalizedOperator, normalizedScope].filter(Boolean).join(' -> ');
  })();
  const extras = [
    normalizedType ? `type ${normalizedType}` : '',
    stringifyLedgerAtom(evidence)
  ].filter(Boolean).join(', ');
  if (core && extras) return `${core} (${extras})`;
  return core || extras;
};

export const formatVoiceValencyReplayEntry = ({
  predicate = '',
  voice = '',
  valency = '',
  externalArgument = '',
  internalArgument = '',
  evidence = ''
} = {}) => {
  const normalizedPredicate = normalizeLedgerDisplay(predicate, { preferInner: true });
  const normalizedVoice = stringifyLedgerAtom(voice);
  const normalizedValency = stringifyLedgerAtom(valency);
  const core = [normalizedPredicate, normalizedVoice || normalizedValency].filter(Boolean).join(': ');
  const extras = [
    normalizedValency && normalizedValency !== normalizedVoice ? `valency ${normalizedValency}` : '',
    stringifyLedgerAtom(externalArgument) ? `external ${stringifyLedgerAtom(externalArgument)}` : '',
    stringifyLedgerAtom(internalArgument) ? `internal ${stringifyLedgerAtom(internalArgument)}` : '',
    stringifyLedgerAtom(evidence)
  ].filter(Boolean).join(', ');
  if (core && extras) return `${core} (${extras})`;
  return core || extras;
};

export const formatLinearizationReplayEntry = ({
  domain = '',
  order = [],
  mechanism = '',
  effect = '',
  evidence = ''
} = {}) => {
  const normalizedDomain = normalizeLedgerDisplay(domain, { preferInner: true });
  const normalizedOrder = Array.isArray(order)
    ? order.map((value) => stringifyLedgerAtom(value)).filter(Boolean)
    : [];
  const normalizedMechanism = stringifyLedgerAtom(mechanism);
  const normalizedEffect = stringifyLedgerAtom(effect);
  const normalizedEvidence = stringifyLedgerAtom(evidence);
  if (normalizedEvidence && normalizedOrder.length === 0 && !normalizedMechanism && !normalizedEffect) {
    return normalizedDomain ? `${normalizedDomain}: ${normalizedEvidence}` : normalizedEvidence;
  }
  const core = [
    normalizedDomain,
    normalizedOrder.length > 0 ? normalizedOrder.join(' < ') : normalizedEffect
  ].filter(Boolean).join(': ');
  const extras = [
    normalizedMechanism ? `via ${normalizedMechanism}` : '',
    normalizedEffect && normalizedOrder.length > 0 ? normalizedEffect : '',
    normalizedEvidence
  ].filter(Boolean).join(', ');
  if (core && extras) return `${core} (${extras})`;
  return core || extras;
};

export const formatLocalityReplayEntry = ({
  dependencyType = '',
  moving = '',
  landing = '',
  boundary = '',
  status = '',
  evidence = ''
} = {}) => {
  const normalizedDependencyType = stringifyLedgerAtom(dependencyType);
  const normalizedMoving = normalizeLedgerDisplay(moving, { preferInner: true });
  const normalizedLanding = normalizeLedgerDisplay(landing, { preferInner: true });
  const normalizedBoundary = stringifyLedgerAtom(boundary);
  const normalizedStatus = stringifyLedgerAtom(status);
  const normalizedEvidence = stringifyLedgerAtom(evidence);
  if (normalizedEvidence && !normalizedMoving && !normalizedLanding && !normalizedBoundary && !normalizedStatus) {
    return normalizedDependencyType ? `${normalizedDependencyType}: ${normalizedEvidence}` : normalizedEvidence;
  }
  const core = (() => {
    if (normalizedMoving && normalizedLanding) {
      return `${normalizedMoving} -> ${normalizedLanding}`;
    }
    return [normalizedDependencyType, normalizedMoving, normalizedLanding].filter(Boolean).join(': ');
  })();
  const extras = [
    normalizedDependencyType && !(core || '').includes(normalizedDependencyType) ? normalizedDependencyType : '',
    normalizedBoundary ? `boundary ${normalizedBoundary}` : '',
    normalizedStatus ? `status ${normalizedStatus}` : '',
    normalizedEvidence
  ].filter(Boolean).join(', ');
  if (core && extras) return `${core} (${extras})`;
  return core || extras;
};

export const formatPredicationReplayEntry = ({
  predicate = '',
  subject = '',
  relation = '',
  evidence = ''
} = {}) => {
  const normalizedPredicate = normalizeLedgerDisplay(predicate, { preferInner: true });
  const normalizedSubject = normalizeLedgerDisplay(subject, { preferInner: true });
  const normalizedRelation = stringifyLedgerAtom(relation);
  const core = (() => {
    if (normalizedSubject && normalizedPredicate) {
      return `${normalizedSubject} predicates with ${normalizedPredicate}`;
    }
    return [normalizedSubject, normalizedPredicate, normalizedRelation].filter(Boolean).join(': ');
  })();
  const extras = [
    normalizedRelation ? `relation ${normalizedRelation}` : '',
    stringifyLedgerAtom(evidence)
  ].filter(Boolean).join(', ');
  if (core && extras) return `${core} (${extras})`;
  return core || extras;
};
