import type { SyntaxNode } from '../../types.ts';
import { categoryLabel, readCategoryLabel } from '../categoryLabel.ts';
import { scopeEvidence, uniqueCurrentOwners } from './evidenceScopes.ts';
import type { Tier2AuthoredEvidenceEntry, Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { normalizeTier2Synonym, relationLabelClauses } from './tier2Synonyms.ts';
import { establishesAssignment } from './assignmentContinuity.ts';

export type ExplicitCoreferenceParticipants = {
  participants: readonly Tier2AuthoredEvidenceEntry[];
  index?: Tier2AuthoredEvidenceEntry;
};
const declaredTopicBindingRows = (evidence: Tier2FacetEvidence) =>
  /^(?:integrated )?topic resumption dependency$/u.test(normalizeTier2Synonym(evidence.relationName ?? ''))
    ? (evidence.authoredValues ?? []).filter(entry => normalizeTier2Synonym(entry.key) === 'dependency'
      && entry.items.length === 1 && /^syntactically licensed topic binding$/u.test(normalizeTier2Synonym(entry.items[0]))) : [];

/** Plain co-reference identifies referents, not copies or a syntactic binder.
 * The explicit claim belongs to the complete pair of current nominal anchors;
 * participant names and shared lineage do not supply that interpretation. */
export function explicitCoreferenceParticipants(evidence: Tier2FacetEvidence): ExplicitCoreferenceParticipants | undefined {
  if (declaredTopicBindingRows(evidence).length === 1) return;
  const topicNullResumption = normalizeTier2Synonym(evidence.relationName) === 'topic linked null object resumption';
  // Discourse reference and syntactic occurrence identity are separate claims.
  // A denial of the latter cannot negate an explicit positive reference claim.
  if (topicNullResumption && !evidence.associatedAnchorKeys?.['coreference.participants']) {
    const dependencies = (evidence.authoredValues ?? []).filter(entry => normalizeTier2Synonym(entry.key) === 'dependency');
    if (dependencies.length !== 1 || dependencies[0].items.length !== 1) return;
    const clauses = relationLabelClauses(dependencies[0].items[0]);
    if (!/^(?:discourse )?anaphoric co ?reference$/u.test(clauses[0])
      || clauses.slice(1).some(clause => !/^(?:not|no) syntactic occurrence identity$/u.test(clause))) return;
  }
  const referentialDependency = (clause: string) => /\b(?:anaphoric|referential|resumption|resumptive) dependency$/u.test(clause)
    || /^(?:left|right) dislocation resumption$/u.test(clause)
    || /\btopic resumption$/u.test(clause) || /^topic linked null object resumption$/u.test(clause);
  const clauses = relationLabelClauses(evidence.relationName).filter(clause => /\b(?:co ?reference|same reference|coindexation)\b/u.test(clause)
    || /^referential identity(?: of (?:(?:reconstructed|interpreted) )?[\p{L} ]+)?$/u.test(clause)
    || /\brelative antecedence$/u.test(clause) || referentialDependency(clause));
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const grouped = anchors.filter(entry => entry.concepts.includes('coreference.participants'));
  const nodes = new Map<string, SyntaxNode[]>();
  const visit = (node: SyntaxNode) => {
    nodes.set(node.id, [...(nodes.get(node.id) ?? []), node]);
    node.children?.forEach(visit);
  };
  evidence.currentForest.forEach(visit);
  // A discourse head licenses the assertion, but is not one of its referents.
  // Both its declared role and its non-nominal category must identify context.
  // An explicit anaphoric/resumption dependency names its referents separately
  // from contextual quantifiers and topic heads. It asserts no copy or binder.
  const antecedents = anchors.filter(entry => /^(?:(?:hanging|dislocated|discourse) )?(?:topic|antecedent|referent|referential nominal)$/u.test(normalizeTier2Synonym(entry.key))
    || /^(?:antecedent (?:object|nominal|phrase|argument)|peripheral nominal)$/u.test(normalizeTier2Synonym(entry.key)));
  const anaphors = anchors.filter(entry => /^(?:resumptive|pronoun|anaphor|(?:pronominal|resumptive|anaphoric|null) (?:subject|object|pronoun|argument|nominal|occurrence|clitic))$/u.test(normalizeTier2Synonym(entry.key)));
  if (clauses.some(clause => /^referential identity/u.test(clause))) anaphors.push(...anchors.filter(entry =>
    /^(?:reconstructed|interpreted) (?:object|nominal|phrase|argument)$/u.test(normalizeTier2Synonym(entry.key))));
  // An explicitly named nominal inside a topical PP identifies the referent;
  // the enclosing topic and its clitic remain separate authored context.
  const referentialNominals = antecedents.filter(entry => normalizeTier2Synonym(entry.key) === 'referential nominal');
  const topicEntries = antecedents.filter(entry => normalizeTier2Synonym(entry.key) === 'topic');
  const contains = (node: SyntaxNode, id: string): boolean => node.id === id || Boolean(node.children?.some(child => contains(child, id)));
  const nominalTopic = referentialNominals.length === 1 && topicEntries.length === 1
    && referentialNominals[0].items.length === 1 && topicEntries[0].items.length === 1
    && nodes.get(topicEntries[0].items[0])?.length === 1
    && contains(nodes.get(topicEntries[0].items[0])![0], referentialNominals[0].items[0]);
  const referents = nominalTopic ? antecedents.filter(entry => entry !== topicEntries[0]) : antecedents;
  const namedPair = clauses.length > 0 && referents.length === 1 && anaphors.length === 1
    ? [...referents, ...anaphors] : undefined;
  if (topicNullResumption && !evidence.associatedAnchorKeys?.['coreference.participants']
    && (!namedPair || grouped.length || anchors.some(entry => !namedPair.includes(entry)
      && entry.concepts.some(concept => ['binder', 'dependent', 'operator', 'variable'].includes(concept))))) return;
  const participants = grouped.length ? grouped : namedPair ?? anchors.filter(entry =>
    !/^discourse (?:licen[cs](?:or|er)|head)$/u.test(normalizeTier2Synonym(entry.key))
    || entry.items.length !== 1 || nodes.get(entry.items[0])?.length !== 1
    || categoryLabel(nodes.get(entry.items[0])![0].label) !== 'Disc');
  if (/^(?:possible|potential|hypothetical|pending|unresolved) /u.test(normalizeTier2Synonym(evidence.relationName ?? ''))) return;
  if ((!clauses.length && !grouped.length) || clauses.length > 1 || !establishesAssignment(evidence)
    || clauses.some(clause => /\b(?:no|not|non|without|absence|lack|failed|blocked|unlicensed|denied|rejected|possible|potential|hypothetical|conditional|pending|unresolved|if|unless|whether|binding|bound|control|movement|moved|copy|copies|chain|variable)\b/u
      .test(clause.replace(/\bnon ?binding\b/gu, '')))) return;
  if (clauses.some(referentialDependency) && !grouped.length && !namedPair) return;
  const ids = participants.flatMap(entry => entry.items);
  if (ids.length !== 2 || new Set(ids).size !== 2 || participants.some(entry => !entry.items.length)) return;
  if (participants.some(entry => /\b(?:binder|bound|variable|controller|controllee|copy|copies|movement|landing|trace)\b/u
    .test(normalizeTier2Synonym(entry.key)))) return;
  const values = evidence.authoredValues ?? [];
  const indices = values.filter(entry => entry.concepts.includes('index'));
  if (indices.length > 1 || indices.length && (indices[0].items.length !== 1 || !indices[0].items[0].trim())) return;
  if (ids.some(id => nodes.get(id)?.length !== 1 || !['D', 'DP', 'N', 'NP'].includes(categoryLabel(nodes.get(id)![0].label)))) return;
  return { participants, index: indices[0] };
}

export function recoverExplicitCoreference(evidence: Tier2FacetEvidence) {
  const claim = explicitCoreferenceParticipants(evidence);
  if (!claim) return [];
  return [scopeEvidence(evidence, 'coreference.coindex',
    claim.participants.map(entry => ({ entry, concept: 'coreference.participants' })),
    claim.index ? [{ entry: claim.index, concept: 'index' }] : [])];
}

/** Named binding qualifies its dependent without turning contextual exponents
 * into participants. An association without a binding assertion earns no path. */
export function recoverNamedBinding(evidence: Tier2FacetEvidence) {
  const label = normalizeTier2Synonym(evidence.relationName ?? '');
  const topicBinding = /^topic(?: |[–—])subject binding$/u.test(label);
  const resumptiveBinding = /^(?:resumptive (?:operator )?|relative operator )binding$/u.test(label);
  const questionBinding = label === 'interrogative binding';
  const bindingRows = declaredTopicBindingRows(evidence);
  const declaredTopicBinding = bindingRows.length === 1;
  if ((!topicBinding && !resumptiveBinding && !declaredTopicBinding && !questionBinding) || !establishesAssignment(evidence)) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const binders = anchors.filter(entry => questionBinding ? normalizeTier2Synonym(entry.key) === 'question head' : topicBinding || declaredTopicBinding
    ? normalizeTier2Synonym(entry.key) === 'topic' : entry.concepts.includes('binder'));
  const dependents = anchors.filter(entry => questionBinding ? normalizeTier2Synonym(entry.key) === 'wh determiner' : topicBinding ? normalizeTier2Synonym(entry.key) === 'subject'
    : entry.concepts.includes('dependent') || /^resumptive (?:subject|object|argument|pronoun|nominal|occurrence|clitic)$/u.test(normalizeTier2Synonym(entry.key)));
  const domains = anchors.filter(entry => entry.concepts.includes('domain'));
  const optionalValues = (evidence.authoredValues ?? []).filter(entry => entry.concepts.some(concept => ['index', 'outcome'].includes(concept)));
  if (['index', 'outcome'].some(concept => optionalValues.filter(entry => entry.concepts.includes(concept)).length > 1)
    || optionalValues.some(entry => entry.items.length !== 1 || !entry.items[0].trim())) return [];
  if (binders.length !== 1 || dependents.length !== 1 || anchors.some(entry =>
    ![binders[0], dependents[0]].includes(entry) && entry.concepts.some(concept => ['binder', 'dependent'].includes(concept)))) return [];
  const ids = [...binders[0].items, ...dependents[0].items];
  if (ids.length !== 2 || !uniqueCurrentOwners(evidence, ids) || domains.length > 1
    || domains.some(entry => entry.items.length !== 1 || !uniqueCurrentOwners(evidence, entry.items))) return [];
  if (questionBinding) {
    const phrases = anchors.filter(entry => normalizeTier2Synonym(entry.key) === 'wh phrase');
    if (phrases.length !== 1 || phrases[0].items.length !== 1 || !uniqueCurrentOwners(evidence, [...ids, ...phrases[0].items])
      || anchors.some(entry => ![binders[0], dependents[0]].includes(entry)
        && entry.concepts.some(concept => ['operator', 'variable'].includes(concept)))) return [];
    const nodes = new Map<string, SyntaxNode>();
    const visit = (node: SyntaxNode) => { nodes.set(node.id, node); node.children?.forEach(visit); };
    evidence.currentForest.forEach(visit);
    const head = nodes.get(ids[0])!, dependent = nodes.get(ids[1])!, phrase = nodes.get(phrases[0].items[0])!;
    const headShape = readCategoryLabel(head.label), dependentShape = readCategoryLabel(dependent.label);
    const contains = (node: SyntaxNode, id: string): boolean => node.id === id || Boolean(node.children?.some(child => contains(child, id)));
    const headLabel = normalizeTier2Synonym(head.label);
    if (headShape?.kind !== 'head' || headShape.compound || !['C', 'Force', 'Q'].includes(headShape.category)
      || !/(?:^|[\s\[:;,])(?:\+?q|interrogative)(?:[\s\],;:]|$)/u.test(headLabel)
      || /\b(?:no|not|non|without|possible|potential|hypothetical|pending|unresolved|required)\b/u.test(headLabel)
      || dependentShape?.kind !== 'head' || dependentShape.compound || !['D', 'Det'].includes(dependentShape.category)
      || !['D', 'DP', 'DetP', 'N', 'NP', 'K', 'KP'].includes(categoryLabel(phrase.label)) || !contains(phrase, dependent.id)) return [];
  }
  return [scopeEvidence(evidence, 'binding.dependency', [
    { entry: binders[0], concept: 'binder' }, { entry: dependents[0], concept: 'dependent' },
    ...domains.map(entry => ({ entry, concept: 'domain' }))
  ], [...optionalValues.map(entry => ({ entry, concept: entry.concepts.includes('index') ? 'index' : 'outcome' })),
    ...(declaredTopicBinding ? [{ entry: bindingRows[0], concept: 'interpretation.label' }] : [])])];
}
