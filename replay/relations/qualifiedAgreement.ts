import { establishesAssignment } from './assignmentContinuity.ts';
import { normalizeTier2Synonym, relationLabelClauses, namedThematicRole, isDefaultAgreementLiteral, isExplicitTier2Role } from './tier2Synonyms.ts';
import type { Tier2AuthoredEvidenceEntry, Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { resolveOutcomeLiteral, relationAssertionFailure, relationLabelOutcome } from './outcomeResolver.ts';
import { featureParticipantName, participantProperties, scopeEvidence, uniqueCurrentOwners } from './evidenceScopes.ts';
import { categoryLabel, readCategoryLabel } from '../categoryLabel.ts';
import { hasIndependentCaseEndpoints } from './featureEvidence.ts';
import { nominalConcordMembers } from './nominalConcord.ts';
import { explicitCoreferenceParticipants } from './explicitCoreference.ts';

const featureProperties = new Set(['features', 'feature bundle', 'agreement specification', 'agreement', 'number', 'person', 'gender']);
const contextualParticipant = (key: string) => /\b(?:controlled|mediator|intermediary|intervener|possible|potential|hypothetical)\b/u
  .test(normalizeTier2Synonym(key));
const subjectRole = (key: string): boolean => {
  const name = featureParticipantName(key);
  if (name === 'subject') return true;
  const qualifier = /^(.+) subject$/u.exec(name)?.[1];
  return Boolean(qualifier && (/^(?:nominative|accusative|dative|genitive|ergative|absolutive|oblique)$/u.test(qualifier)
    || namedThematicRole(qualifier)));
};

/** Agreement can name its inflectional head by category. That identifies a
 * participant only in this claim scope; it never makes T a global assigner. */
function agreementHost(entry: Tier2AuthoredEvidenceEntry, evidence: Tier2FacetEvidence): boolean {
  if (entry.concepts.includes('feature.source')) return true;
  const name = featureParticipantName(entry.key);
  if (['inflection', 'auxiliary', 'participle', 'clitic'].includes(name)) return true;
  if (name === 'raised finite features' && entry.items.length === 1) {
    const matches: Array<typeof evidence.currentForest[number]> = [];
    const visit = (node: typeof matches[number]) => { if (node.id === entry.items[0]) matches.push(node); node.children?.forEach(visit); };
    evidence.currentForest.forEach(visit);
    return matches.length === 1 && ['T', 'I', 'Infl'].includes(categoryLabel(matches[0].label).replace(/(?:\^?0|⁰)$/u, ''))
      && !matches[0].children?.length;
  }
  const category = new Map([['t', 'T'], ['i', 'I'], ['infl', 'Infl'], ['agr', 'Agr'], ['agreement', 'Agr']]).get(name);
  if (!category || entry.items.length !== 1) return false;
  const matches: typeof evidence.currentForest[number][] = [];
  const visit = (node: typeof evidence.currentForest[number]) => {
    if (node.id === entry.items[0]) matches.push(node);
    node.children?.forEach(visit);
  };
  evidence.currentForest.forEach(visit);
  if (matches.length !== 1 || /[′’']/u.test(matches[0].label)) return false;
  const head = categoryLabel(matches[0].label).replace(/(?:\^?0|⁰)$/u, '');
  const shape = readCategoryLabel(matches[0].label);
  // Conventional Agr heads may name their agreement domain (AgrO, AgrS,
  // AgrObj). The qualified role still needs one controller and literal rows;
  // an Agr phrase or compound does not supply this head-category evidence.
  const agreementHeadCategory = shape?.kind === 'head' && !shape.compound
    && /^Agr(?:[A-Z][A-Za-z]*)$/u.test(shape.category);
  return head === category || normalizeTier2Synonym(entry.key) === 'agreement head'
    && (['T', 'I', 'Infl', 'Agr'].includes(head) || agreementHeadCategory);
}

/** An explicitly named feature bearer inside the one authored goal corroborates
 * that goal's features. It is not a second agreement target. */
function nestedFeatureWitnesses(evidence: Tier2FacetEvidence): Tier2AuthoredEvidenceEntry[] {
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const goals = anchors.filter(entry => normalizeTier2Synonym(entry.key) === 'goal');
  if (goals.length !== 1 || goals[0].items.length !== 1) return [];
  const nodes = new Map<string, typeof evidence.currentForest>();
  const visit = (node: typeof evidence.currentForest[number]) => {
    nodes.set(node.id, [...(nodes.get(node.id) ?? []), node]); node.children?.forEach(visit);
  };
  evidence.currentForest.forEach(visit);
  const goalNodes = nodes.get(goals[0].items[0]);
  if (goalNodes?.length !== 1) return [];
  const contains = (node: typeof goalNodes[number], id: string): boolean =>
    node.id === id || Boolean(node.children?.some(child => contains(child, id)));
  return anchors.filter(entry => /^(?:feature bearer|nominal feature source)$/u.test(normalizeTier2Synonym(entry.key))
    && entry.items.length === 1 && entry.items[0] !== goals[0].items[0] && nodes.get(entry.items[0])?.length === 1
    && ['N', 'D'].includes(categoryLabel(nodes.get(entry.items[0])![0].label))
    && contains(goalNodes[0], entry.items[0]));
}

const featureDimension = (key: string) => {
  const property = /(?:^| )(features|feature bundle|agreement specification|specification|agreement|number|person|gender|noun class)$/u
    .exec(normalizeTier2Synonym(key))?.[1];
  return property && ['feature bundle', 'agreement specification', 'specification', 'agreement'].includes(property) ? 'features' : property;
};
const coherentFeatureRows = (rows: readonly Tier2AuthoredEvidenceEntry[]) => rows.length > 0
  && rows.every(row => row.items.length > 0 && row.items.every(item => item.trim()))
  && [...new Set(rows.map(row => featureDimension(row.key)))].every(dimension => {
    const matches = rows.filter(row => featureDimension(row.key) === dimension);
    return matches.length <= 1 || new Set(matches.map(row => JSON.stringify(row.items))).size === 1;
  });

/** An unqualified outcome belongs to this operation only when its label has
 * one claim clause. A sibling's outcome stays outside this recovered scope. */
function localOutcomes(evidence: Tier2FacetEvidence, family: 'agreement' | 'comparison') {
  const clauses = relationLabelClauses(evidence.relationName);
  return (evidence.authoredValues ?? []).filter(entry => {
    const key = normalizeTier2Synonym(entry.key);
    const qualified = family === 'agreement' ? /^(?:agreement|concord) (?:outcome|status|result)$/u
      : /^(?:comparison|agreement|selection) (?:outcome|status|result)$/u;
    return qualified.test(key) || clauses.length === 1 && (entry.concepts.includes('outcome')
      || /^(?:outcome|status|result|verdict|judgment)$/u.test(key));
  });
}

function agreementAssertion(evidence: Tier2FacetEvidence) {
  const clauses = relationLabelClauses(evidence.relationName).filter(clause => /\b(?:agree|agreement|concord)\b/u.test(clause));
  if (!clauses.length || clauses.some(clause => /\b(?:or|no|not|without|absence|lack|denied|required|requested|expected|pending|possible|potential|hypothetical|unestablished|unresolved|compatibility|mismatch|if|unless|whether|conditional)\b/u.test(clause))) return;
  const outcome = relationLabelOutcome(evidence.relationName, 'agreement');
  if (!outcome && clauses.some(clause => /\b(?:failed|failure|blocked|unsuccessful|rejected|unlicensed|violation)\b/u.test(clause))) return;
  if (relationAssertionFailure(evidence.relationName, 'agreement') && !outcome) return;
  const statuses = localOutcomes(evidence, 'agreement');
  const concepts = statuses.flatMap(entry => entry.items.map(item => resolveOutcomeLiteral(item)?.concept));
  if (concepts.some(concept => !concept) || new Set(concepts).size > 1 || outcome && concepts.some(concept => concept !== outcome)) return;
  return { statuses, outcome };
}

/** An explicit shared property on two participants earns sharing, not a
 * directional agreement or occurrence-identity claim. Contextual anchors and
 * larger ungrouped inventories do not identify the property's bearers. */
export function recoverExplicitFeatureSharing(evidence: Tier2FacetEvidence) {
  const authored = evidence.authoredCurrentAnchors ?? [];
  const rows = (evidence.authoredValues ?? []).filter(value =>
    /^shared (?:features?|person|number|gender|noun class)$/u.test(normalizeTier2Synonym(value.key)));
  const referents = explicitCoreferenceParticipants(evidence)?.participants;
  const anchors = referents ?? authored;
  if (anchors.length !== 2 || !rows.length || rows.some(row => row.items.length !== 1 || !row.items[0].trim()) || !establishesAssignment(evidence)
    || relationAssertionFailure(evidence.relationName, 'feature-sharing')
    || !uniqueCurrentOwners(evidence, anchors.flatMap(anchor => anchor.items))
    || anchors.some(anchor => anchor.items.length !== 1
      || anchor.concepts.some(concept => ['feature.source', 'feature.target', 'feature.bearers'].includes(concept))
      || /\b(?:domain|scope|context|projection|clause|intervener|candidate|possible)\b/u.test(normalizeTier2Synonym(anchor.key)))) return [];
  return [scopeEvidence(evidence, 'feature-sharing', anchors.map(entry => ({ entry, concept: 'feature.bearers' })),
    rows.map(entry => ({ entry, concept: 'feature.rows' })))];
}

/** Relative concord names the nominal head and relativizer as its bearers.
 * A determiner inside that same nominal is corroborating context; another
 * resumptive or unrelated nominal does not inherit the concord rows. */
export function recoverRelativeConcord(evidence: Tier2FacetEvidence) {
  if (normalizeTier2Synonym(evidence.relationName) !== 'relative concord' || !establishesAssignment(evidence)) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const nominals = anchors.filter(entry => normalizeTier2Synonym(entry.key) === 'nominal head');
  const relatives = anchors.filter(entry => /^(?:relativizer|relative marker)$/u.test(normalizeTier2Synonym(entry.key)));
  const determiners = anchors.filter(entry => /^(?:definite )?determiner$/u.test(normalizeTier2Synonym(entry.key)));
  const rows = (evidence.authoredValues ?? []).filter(entry => normalizeTier2Synonym(entry.key) === 'features');
  if (nominals.length !== 1 || relatives.length !== 1 || rows.length !== 1 || rows[0].items.length !== 1
    || !rows[0].items[0].trim() || anchors.some(entry => ![...nominals, ...relatives, ...determiners].includes(entry))
    || determiners.length > 1 || anchors.some(entry => entry.items.length !== 1)
    || !uniqueCurrentOwners(evidence, anchors.flatMap(entry => entry.items))) return [];
  if (determiners.length && nominalConcordMembers({ ...evidence, relationName: 'Nominal concord',
    authoredCurrentAnchors: [...nominals, ...determiners].map(entry => ({ ...entry, concepts: ['feature.bearers'] })),
    authoredValues: rows.map(entry => ({ ...entry, concepts: ['feature.rows'] })) }).length !== 2) return [];
  return [scopeEvidence(evidence, 'feature-sharing', [...nominals, ...relatives].map(entry => ({ entry, concept: 'feature.bearers' })),
    rows.map(entry => ({ entry, concept: 'feature.rows' })))];
}

/** A nominal concord inventory shares each explicitly supplied property.
 * Case in this inventory is concord, never an external assignment direction. */
export function recoverQualifiedNominalConcord(evidence: Tier2FacetEvidence) {
  const clauses = relationLabelClauses(evidence.relationName);
  if (clauses.length !== 1 || !/^(?:[\p{L}]+ )?concord$/u.test(clauses[0])
    || !agreementAssertion(evidence) || relationAssertionFailure(evidence.relationName, 'agreement')
    || !establishesAssignment(evidence)) return [];
  const rows = (evidence.authoredValues ?? []).filter(entry => entry.concepts.includes('feature.rows')
    || entry.concepts.includes('case.literal') || /^(?:definiteness|noun class)$/u.test(normalizeTier2Synonym(entry.key)));
  if (!rows.some(entry => !entry.concepts.includes('feature.rows')) || rows.some(entry => !entry.items.length || entry.items.some(item => !item.trim()))) return [];
  const typed = rows.map(entry => ({ ...entry, concepts: ['feature.rows'] }));
  const members = nominalConcordMembers({ ...evidence, authoredValues: typed });
  if (!members.length) return [];
  return [scopeEvidence(evidence, 'feature-sharing', members.map(entry => ({ entry, concept: 'feature.bearers' })),
    rows.map(entry => ({ entry, concept: 'feature.rows' })))];
}

/** An explicit controller can supply one bundle to several named agreement
 * targets. Each target keeps its own dependency; list order supplies no pair. */
export function recoverDirectedAgreementTargets(evidence: Tier2FacetEvidence) {
  const assertion = agreementAssertion(evidence);
  if (!assertion) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const controllers = anchors.filter(entry => normalizeTier2Synonym(entry.key) === 'controller');
  const targets = anchors.filter(entry => ['agreement targets', 'agreement bearers'].includes(normalizeTier2Synonym(entry.key)));
  const rows = (evidence.authoredValues ?? []).filter(entry => entry.concepts.includes('feature.rows'));
  if (controllers.length !== 1 || targets.length !== 1 || controllers[0].items.length !== 1 || !targets[0].items.length
    || anchors.some(entry => ![controllers[0], targets[0]].includes(entry) && entry.concepts.some(concept => ['feature.source', 'feature.target', 'controller'].includes(concept)))
    || !uniqueCurrentOwners(evidence, [...controllers[0].items, ...targets[0].items]) || !coherentFeatureRows(rows)) return [];
  return targets[0].items.map((_, index) => scopeEvidence(evidence, 'feature.dependency', [
    { entry: targets[0], concept: 'feature.source', indices: [index] }, { entry: controllers[0], concept: 'feature.target' }
  ], [...rows.map(entry => ({ entry, concept: 'feature.rows' })), ...assertion.statuses.map(entry => ({ entry, concept: 'outcome' }))],
  assertion.outcome && !assertion.statuses.length ? { outcome: [assertion.outcome] } : {}));
}

/** Case concord states a shared nominal property. It does not identify the
 * external assigner of that Case or authorize a directed assignment path. */
export function recoverNominalCaseConcord(evidence: Tier2FacetEvidence) {
  if (!/^(?:(?:nominal|adjectival|determiner) )?case concord$/u.test(normalizeTier2Synonym(evidence.relationName ?? ''))
    || !establishesAssignment(evidence)) return [];
  const rows = (evidence.authoredValues ?? []).filter(entry => entry.concepts.includes('case.literal'));
  const members = nominalConcordMembers({ ...evidence,
    authoredValues: rows.map(entry => ({ ...entry, concepts: ['feature.rows'] })) });
  if (!members.length) return [];
  return [scopeEvidence(evidence, 'feature-sharing', members.map(entry => ({ entry, concept: 'feature.bearers' })),
    rows.map(entry => ({ entry, concept: 'feature.rows' })))];
}

/** Each participant-qualified feature field supplies its own association to
 * the one agreement host. Different participants never inherit another's rows. */
export function recoverQualifiedAgreement(evidence: Tier2FacetEvidence) {
  const assertion = agreementAssertion(evidence);
  if (!assertion) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  if (anchors.some(entry => ['agreement targets', 'agreement bearers'].includes(normalizeTier2Synonym(entry.key)))) return [];
  if (anchors.some(entry => contextualParticipant(entry.key))) return [];
  const namedController = anchors.find(entry => normalizeTier2Synonym(entry.key) === 'controller');
  const namedTarget = anchors.find(entry => normalizeTier2Synonym(entry.key) === 'target');
  if (namedController && namedTarget && (namedController.items.length !== 1 || namedTarget.items.length !== 1
    || namedController.items[0] === namedTarget.items[0])) return [];
  const namedPair = /^(?:past )?participle agreement with (?:preceding |fronted )?(?:direct )?object$/u
    .test(normalizeTier2Synonym(evidence.relationName ?? ''));
  const typedSources = anchors.filter(entry => entry.concepts.includes('feature.source'));
  const containsTypedSource = (entry: Tier2AuthoredEvidenceEntry) => {
    if (typedSources.length !== 1 || typedSources[0].items.length !== 1 || entry.items.length !== 1
      || !/^(?:finite head|inflection|inflectional head)$/u.test(normalizeTier2Synonym(entry.key))) return false;
    const matches: Array<typeof evidence.currentForest[number]> = [];
    const visit = (node: typeof matches[number]) => { if (node.id === entry.items[0]) matches.push(node); node.children?.forEach(visit); };
    evidence.currentForest.forEach(visit);
    const contains = (node: typeof matches[number]): boolean => node.children?.some(child => child.id === typedSources[0].items[0] || contains(child)) ?? false;
    return matches.length === 1 && contains(matches[0]);
  };
  const probes = anchors.filter(entry => normalizeTier2Synonym(entry.key) === 'probe');
  const paths = new Map<string, typeof evidence.currentForest>();
  const visit = (node: typeof evidence.currentForest[number], path: typeof evidence.currentForest) => {
    paths.set(node.id, [...path, node]); node.children?.forEach(child => visit(child, [...path, node]));
  };
  evidence.currentForest.forEach(node => visit(node, []));
  const exponentContext = probes.length === 1 && probes[0].items.length === 1
    ? anchors.filter(entry => normalizeTier2Synonym(entry.key) === 'agreement bearer' && entry.items.length === 1
      && uniqueCurrentOwners(evidence, [...probes[0].items, ...entry.items])
      && ['T', 'I', 'Infl', 'Agr'].includes(categoryLabel(paths.get(probes[0].items[0])!.at(-1)!.label))
      && categoryLabel(paths.get(entry.items[0])!.at(-1)!.label) === 'V'
      && paths.get(entry.items[0])![0] === paths.get(probes[0].items[0])![0]) : [];
  const sources = anchors.filter(entry => !exponentContext.includes(entry) && (namedPair ? featureParticipantName(entry.key) === 'participle'
    : agreementHost(entry, evidence) && !(!entry.concepts.includes('feature.source') && containsTypedSource(entry))));
  if (sources.length !== 1 || sources[0].items.length !== 1) return [];
  const source = sources[0];
  const witnesses = nestedFeatureWitnesses(evidence);
  const targets = anchors.filter(entry => entry !== source && !witnesses.includes(entry) && (namedPair
    ? /^(?:(?:fronted|preceding|direct) )?object$/u.test(normalizeTier2Synonym(entry.key))
    : entry.concepts.includes('feature.target') || subjectRole(entry.key) || /^(?:subject|object|interrogative) (?:goal|argument)$/u.test(normalizeTier2Synonym(entry.key))
      || /^(?:number|person|gender) goal$/u.test(normalizeTier2Synonym(entry.key))
        && (evidence.authoredValues ?? []).some(row => normalizeTier2Synonym(row.key)
          === normalizeTier2Synonym(entry.key).replace(/ goal$/u, '') && row.items.length === 1)
      || normalizeTier2Synonym(entry.key) === 'controller'));
  const properties = participantProperties(evidence).filter(({ anchor, property }) => anchor !== source && featureProperties.has(property));
  const propertyTargets = [...new Set(properties.map(property => property.anchor))];
  // Qualified rows may name several independent goals. Unqualified rows need
  // exactly one explicit goal; neither array order nor a nearby node chooses it.
  const rows = (evidence.authoredValues ?? []).filter(entry => (entry.concepts.includes('feature.rows') || normalizeTier2Synonym(entry.key) === 'noun class')
    && !participantProperties(evidence).some(property => property.value === entry));
  const qualifiedTargets = rows.length ? targets : propertyTargets;
  if (rows.length && targets.length !== 1 || qualifiedTargets.some(target => target.items.length !== 1
    || target.items[0] === source.items[0]) || targets.some(target => !qualifiedTargets.includes(target))) return [];
  return qualifiedTargets.flatMap(target => {
    if (!uniqueCurrentOwners(evidence, [...source.items, ...target.items])) return [];
    const ownedRows = [...rows, ...properties.filter(property => property.anchor === target).map(property => property.value)];
    if (ownedRows.some(row => row.items.some(isDefaultAgreementLiteral))
      && !isExplicitTier2Role('feature.target', target.key)
      && !['controller', 'agreement controller'].includes(normalizeTier2Synonym(target.key))) return [];
    if (!coherentFeatureRows(ownedRows)) return [];
    return [scopeEvidence(evidence, 'feature.dependency', [
      { entry: source, concept: 'feature.source' }, { entry: target, concept: 'feature.target' }
    ], [...ownedRows.map(entry => ({ entry, concept: 'feature.rows' })),
      ...(assertion.outcome === relationLabelOutcome(evidence.relationName, 'case') && hasIndependentCaseEndpoints(evidence)
        ? (evidence.authoredValues ?? []).filter(entry => entry.concepts.includes('case.literal')).map(entry => ({ entry, concept: 'case.literal' })) : []),
      ...assertion.statuses.map(entry => ({ entry, concept: 'outcome' }))],
    assertion.outcome && !assertion.statuses.length ? { outcome: [assertion.outcome] } : {})];
  });
}

/** An asserted feature attraction can state its checked feature as a label.
 * The literal belongs to the existing probe/goal path, not another relation. */
export function recoverCheckedFeatureRows(evidence: Tier2FacetEvidence) {
  if (!/^(?:(?:relative|interrogative) operator )?attraction$/u.test(normalizeTier2Synonym(evidence.relationName))
    || !establishesAssignment(evidence)) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [], values = evidence.authoredValues ?? [];
  const sources = anchors.filter(entry => entry.concepts.includes('feature.source'));
  const targets = anchors.filter(entry => entry.concepts.includes('feature.target'));
  const rows = values.filter(entry => entry.concepts.includes('feature.label'));
  if ([sources, targets, rows].some(entries => entries.length !== 1 || entries[0].items.length !== 1)
    || !rows[0].items[0].trim() || !uniqueCurrentOwners(evidence, [...sources[0].items, ...targets[0].items])) return [];
  return [scopeEvidence(evidence, 'feature.dependency', [{ entry: sources[0], concept: 'feature.source' },
    { entry: targets[0], concept: 'feature.target' }], [{ entry: rows[0], concept: 'feature.rows' }])];
}

/** Interrogative Agree can explicitly name a scope head as its probe. The
 * authored wh-probe annotation and contained wh determiner corroborate the
 * exact argument; neither covert movement nor a separate variable is inferred. */
export function recoverInterrogativeAgreement(evidence: Tier2FacetEvidence) {
  const assertion = agreementAssertion(evidence);
  if (!assertion || !/\binterrogative agree\b/u.test(normalizeTier2Synonym(evidence.relationName))) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const sources = anchors.filter(entry => normalizeTier2Synonym(entry.key) === 'scope head');
  const targets = anchors.filter(entry => normalizeTier2Synonym(entry.key) === 'interrogative argument');
  const determiners = anchors.filter(entry => normalizeTier2Synonym(entry.key) === 'wh determiner');
  if ([sources, targets, determiners].some(entries => entries.length !== 1 || entries[0].items.length !== 1)
    || anchors.some(entry => ![sources[0], targets[0]].includes(entry) && entry.concepts.some(concept => ['feature.source', 'feature.target'].includes(concept)))
    || !uniqueCurrentOwners(evidence, [...sources[0].items, ...targets[0].items, ...determiners[0].items])) return [];
  const paths = new Map<string, typeof evidence.currentForest>();
  const visit = (node: typeof evidence.currentForest[number], path: typeof evidence.currentForest) => {
    paths.set(node.id, [...path, node]); node.children?.forEach(child => visit(child, [...path, node]));
  };
  evidence.currentForest.forEach(node => visit(node, []));
  const source = paths.get(sources[0].items[0])!.at(-1)!, target = paths.get(targets[0].items[0])!.at(-1)!;
  const annotations = [...source.label.matchAll(/\[([^\[\]]*)\]/gu)].flatMap(match => match[1].split(/[,;]/u)).map(normalizeTier2Synonym);
  if (categoryLabel(source.label) !== 'C' || source.children?.length || !annotations.includes('wh probe')
    || !['D', 'DP', 'N', 'NP', 'K', 'KP'].includes(categoryLabel(target.label))
    || !['D', 'Det'].includes(categoryLabel(paths.get(determiners[0].items[0])!.at(-1)!.label))
    || !paths.get(determiners[0].items[0])!.includes(target) || paths.get(source.id)![0] !== paths.get(target.id)![0]) return [];
  const scope = scopeEvidence(evidence, 'feature.dependency', [{ entry: sources[0], concept: 'feature.source' }, { entry: targets[0], concept: 'feature.target' }]);
  // The native rowless Agree path requires explicit probe and goal authority.
  scope.evidence.authoredCurrentAnchors![0].concepts = [...scope.evidence.authoredCurrentAnchors![0].concepts, 'probe'];
  scope.evidence.authoredCurrentAnchors![1].concepts = [...scope.evidence.authoredCurrentAnchors![1].concepts, 'goal'];
  scope.evidence.associatedAnchorKeys!.probe = [sources[0].key];
  scope.evidence.associatedAnchorKeys!.goal = [targets[0].key];
  return [scope];
}

/** Case assignment and feature collection can have different outcomes even
 * when they share endpoints. Keep the rows and their original item ownership
 * in separate claims so a failed collection cannot mark Case as failed. */
export function recoverIndependentFeatureOutcomes(evidence: Tier2FacetEvidence) {
  if (evidence.values.outcome?.length || !evidence.values['case.literal']?.length || !evidence.values['feature.rows']?.length) return [];
  const caseEndpoints = hasIndependentCaseEndpoints(evidence);
  if (caseEndpoints && relationLabelOutcome(evidence.relationName, 'case') === relationLabelOutcome(evidence.relationName, 'agreement')) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const sources = anchors.filter(entry => entry.concepts.includes('feature.source'));
  const targets = anchors.filter(entry => entry.concepts.includes('feature.target'));
  if (sources.length !== 1 || targets.length !== 1 || sources[0].items.length !== 1 || targets[0].items.length !== 1) return [];
  return (caseEndpoints ? ['case.literal', 'feature.rows'] : ['feature.rows']).map(concept => scopeEvidence(evidence, 'feature.dependency', [
    { entry: sources[0], concept: 'feature.source' }, { entry: targets[0], concept: 'feature.target' }
  ], (evidence.authoredValues ?? []).filter(entry => entry.concepts.includes(concept))
    .map(entry => ({ entry, concept, indices: entry.conceptItemIndices?.[concept] }))));
}

/** A specification is feature evidence only inside this explicit comparison,
 * and only when its qualifier identifies one exact participant. */
function comparisonProperties(evidence: Tier2FacetEvidence) {
  const properties = participantProperties(evidence).filter(property => featureProperties.has(property.property));
  const specifications = (evidence.authoredValues ?? []).flatMap(value => {
    if (properties.some(property => property.value === value)) return [];
    const qualifier = /^(.+) specification$/u.exec(normalizeTier2Synonym(value.key))?.[1];
    if (!qualifier || value.items.length !== 1 || !value.items[0].trim()) return [];
    const anchors = (evidence.authoredCurrentAnchors ?? []).filter(anchor =>
      featureParticipantName(anchor.key) === featureParticipantName(qualifier));
    return anchors.length === 1 && anchors[0].items.length === 1
      ? [{ anchor: anchors[0], value, qualifier, property: 'features' }] : [];
  });
  return [...properties, ...specifications].filter(property => property.value.items.length === 1);
}

function comparisonOutcome(value: string) {
  const literal = normalizeTier2Synonym(value);
  const resolved = resolveOutcomeLiteral(value)?.concept;
  if (resolved) return resolved;
  // Several explicit failure clauses may describe the same comparison. Every
  // clause must independently assert failure; provisional qualifiers stay out.
  const clauses = literal.split(/\s*;\s*/u);
  if (clauses.length > 1) return clauses.every(clause => comparisonOutcome(clause) === 'failed') ? 'failed' : undefined;
  if (/^no successful (?:(?:number|person|gender|feature) )?(?:agree|agreement|concord|matching|comparison)$/u.test(literal)) return 'failed';
  if (/\b(?:not|no|but|and|or|if|unless|whether|possible|potential|hypothetical|pending|might|may|could)\b/u.test(literal)) return;
  if (/^(?:number|person|gender|feature|agreement) mismatch$/u.test(literal)
    || /^incompatible(?: (?:in|under) [\p{L}\p{N} ]+)?$/u.test(literal)
    || /^(?:agree|agreement|concord|feature matching|comparison) cannot (?:successfully )?(?:license|match|satisfy) [\p{L}\p{N} ]+$/u.test(literal)) return 'failed';
}

/** An explicitly failed comparison with separately labelled participant
 * properties uses the existing failed feature connection. The rows keep their
 * owner qualifications; neither value is substituted for the other. */
export function recoverFailedFeatureComparison(evidence: Tier2FacetEvidence) {
  const clauses = relationLabelClauses(evidence.relationName);
  const comparisonClauses = clauses.filter(clause => /\b(?:agreement|concord|selection|licensing|matching|compatibility|number|person|gender|feature)\b/u.test(clause)
    && !/\bcase\b/u.test(clause));
  const negativeLabel = (clause: string) => /^failed\b.*\b(?:agreement|concord|licensing|matching|compatibility)$/u.test(clause)
    || /(?:^| )(?:selection|agreement|concord|compatibility|number|person|gender|feature) (?:violation|failure|mismatch|conflict)$/u.test(clause);
  if (!comparisonClauses.length || comparisonClauses.some(clause => !negativeLabel(clause)
    || /\b(?:not|no|without|absence|lack|pending|unresolved|unestablished|possible|potential|hypothetical|alleged|if|unless|whether|may|might|could)\b/u.test(clause))) return [];
  const values = evidence.authoredValues ?? [];
  const negative = new Set(['failed', 'blocked', 'rejected', 'unlicensed', 'illicit', 'violation']);
  const statuses = localOutcomes(evidence, 'comparison');
  if (statuses.some(entry => !entry.items.length || entry.items.some(value => {
    const concept = comparisonOutcome(value);
    return !concept || !negative.has(concept);
  }))) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  if (anchors.some(entry => contextualParticipant(entry.key))) return [];
  const properties = comparisonProperties(evidence);
  const pairs = [
    { source: ['determiner', 'demonstrative', 'article'], target: ['nominal', 'noun'], comparison: undefined },
    { source: ['inflection', 'auxiliary'], target: ['subject'], comparison: undefined },
    { source: ['probe', 'feature source', 'collector'], target: ['goal', 'feature target'], comparison: undefined,
      rolesIdentifyParticipants: true },
    { source: ['inflection'], target: ['verb'],
      comparison: { source: ['required features'], target: ['supplied features'] } },
    { source: ['selector', 'selecting', 'selecting auxiliary', 'modal'],
      target: ['selected', 'selected verb', 'selected phrase', 'actual complement'],
      comparison: { source: ['required', 'required form', 'required complement'], target: ['encountered', 'attested form', 'actual form', 'actual complement category'] } }
  ].flatMap(pair => {
    const ownsComparedProperty = (entry: typeof anchors[number]) => pair.comparison || pair.rolesIdentifyParticipants
      || properties.some(property => property.anchor === entry);
    const sources = anchors.filter(entry => pair.source.includes(featureParticipantName(entry.key)) && ownsComparedProperty(entry));
    const targets = anchors.filter(entry => pair.target.includes(featureParticipantName(entry.key)) && ownsComparedProperty(entry));
    if (sources.length !== 1 || targets.length !== 1 || sources[0].items.length !== 1 || targets[0].items.length !== 1
      || sources[0].items[0] === targets[0].items[0]) return [];
    const source = sources[0], target = targets[0];
    const owned = (anchor: typeof source, comparisonKeys?: string[]) => comparisonKeys
      ? values.filter(value => comparisonKeys.includes(normalizeTier2Synonym(value.key)) && value.items.length === 1)
      : properties.filter(property => property.anchor === anchor).map(property => property.value);
    const sourceValues = owned(source, pair.comparison?.source);
    const targetValues = owned(target, pair.comparison?.target);
    const complete = pair.comparison ? sourceValues.length === 1 && targetValues.length === 1
      && [...sourceValues, ...targetValues].every(value => value.items[0]?.trim())
      : coherentFeatureRows(sourceValues) && coherentFeatureRows(targetValues);
    return complete
      ? [{ source, target, values: [...sourceValues, ...targetValues] }] : [];
  });
  if (pairs.length !== 1) return [];
  const { source, target, values: comparison } = pairs[0];
  const scope = scopeEvidence(evidence, 'feature.dependency', [
    { entry: source, concept: 'feature.source' }, { entry: target, concept: 'feature.target' }
  ], [...comparison.map(entry => ({ entry, concept: 'feature.rows' })),
    ...statuses.map(entry => ({ entry, concept: 'outcome' }))], { outcome: ['failed'] });
  // Keep the authored status and its provenance intact; the drawing uses only
  // the negative concept established by that bounded assertion.
  if (statuses.length) scope.evidence.values = {
    ...scope.evidence.values,
    outcome: statuses.flatMap(entry => entry.items.map(item => comparisonOutcome(item)!))
  };
  scope.evidence.comparedFeatureKeys = comparison.map(entry => entry.key);
  return [scope];
}
