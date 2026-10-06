import { normalizeTier2Synonym, isRealizationDescription, relationLabelClauses } from './tier2Synonyms.ts';
import type { Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { hasIndependentCaseEndpoints } from './featureEvidence.ts';
import { establishesAssignment } from './assignmentContinuity.ts';
import { categoryLabel } from '../categoryLabel.ts';
import { participantProperties, scopeEvidence, uniqueCurrentOwners } from './evidenceScopes.ts';
import { relationAssertionFailure } from './outcomeResolver.ts';

/** A Case assertion can pair nominal properties under one exact authored key.
 * The pairing says nothing about an assigning head or a directed dependency. */
function pairedCaseProperties(evidence: Tier2FacetEvidence) {
  const clauses = relationLabelClauses(evidence.relationName).filter(clause => /\bcase\b/u.test(clause));
  if (!clauses.length || clauses.some(clause => /\b(?:no|not|never|without|absence|lack|denied|rejected|failed|blocked|unlicensed|pending|unresolved|unestablished|required|requested|expected|possible|potential|hypothetical|whether|if|unless)\b/u.test(clause))
    || relationAssertionFailure(evidence.relationName, 'case') || !establishesAssignment(evidence)) return [];
  const counts = new Map<string, number>();
  const categories = new Map<string, string>();
  const visit = (node: Tier2FacetEvidence['currentForest'][number]) => {
    counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
    categories.set(node.id, categoryLabel(node.label));
    node.children?.forEach(visit);
  };
  evidence.currentForest.forEach(visit);
  return (evidence.authoredValues ?? []).flatMap(value => {
    const anchors = (evidence.authoredCurrentAnchors ?? []).filter(anchor => anchor.key === value.key);
    if (anchors.length !== 1 || !value.items.length || anchors[0].items.length !== value.items.length
      || new Set(anchors[0].items).size !== anchors[0].items.length || value.items.some(item => !item.trim())) return [];
    if (anchors[0].items.some(id => counts.get(id) !== 1)) return [];
    if (!anchors[0].concepts.includes('feature.target') && !/\bcase\b/u.test(normalizeTier2Synonym(anchors[0].key))
      && !anchors[0].items.every(id => ['D', 'DP', 'N', 'NP', 'K', 'KP'].includes(categories.get(id)!))) return [];
    return [{ anchor: anchors[0], value }];
  });
}

/** These independent properties can survive an incomplete exact assignment.
 * A malformed registered primary still owns its unresolved assigning claim. */
export function recoverPairedCaseProperties(evidence: Tier2FacetEvidence) {
  return pairedCaseProperties(evidence).flatMap(({ anchor, value }) => value.items.map((_, index) =>
    scopeEvidence(evidence, 'plaque.structured', [{ entry: anchor, indices: [index], concept: 'plaque.anchor' }],
      [{ entry: value, indices: [index], concept: 'plaque.rows' }])));
}

/** A checked nominal property belongs to its explicitly named goal. Qualified
 * argument slots and trace roles identify a property owner, never an assigner. */
export function recoverNamedArgumentProperties(evidence: Tier2FacetEvidence) {
  const name = normalizeTier2Synonym(evidence.relationName);
  const clauses = relationLabelClauses(evidence.relationName);
  if (!establishesAssignment(evidence)) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [], values = evidence.authoredValues ?? [];
  return values.flatMap(row => {
    const key = normalizeTier2Synonym(row.key);
    if (row.items.length !== 1 || !row.items[0].trim()) return [];
    let targets: typeof anchors = [];
    if (key === 'nominal licensing' && clauses.includes('subject agreement'))
      targets = anchors.filter(entry => normalizeTier2Synonym(entry.key) === 'goal');
    if (key === 'object case' && clauses.some(clause => /^(?:matrix |embedded )?argument licensing$/u.test(clause))
      && values.some(value => normalizeTier2Synonym(value.key) === 'internal role' && value.items.length === 1 && value.items[0].trim()))
      targets = anchors.filter(entry => normalizeTier2Synonym(entry.key) === 'internal argument');
    if (row.concepts.includes('case.literal') && name === 'object trace case and government')
      targets = anchors.filter(entry => normalizeTier2Synonym(entry.key) === 'object trace');
    if (targets.length !== 1 || targets[0].items.length !== 1 || !uniqueCurrentOwners(evidence, targets[0].items)) return [];
    return [scopeEvidence(evidence, 'plaque.structured', [{ entry: targets[0], concept: 'plaque.anchor' }], [{ entry: row, concept: 'plaque.rows' }])];
  });
}

/** A form field supplies a property only when its own label clause asserts it.
 * A denied sibling claim does not change an independently authored form. */
function assertsFormProperty(evidence: Tier2FacetEvidence) {
  if (!establishesAssignment(evidence)) return false;
  const subject = /\b(?:form|realization|realisation|inflection)\b/u;
  return !relationLabelClauses(evidence.relationName).some(clause => {
    const prefix = /^(?:no|not|never|without|absence of|lack of|denied|rejected|failed|blocked|unlicensed|pending|unresolved|unestablished|required|requested|expected|possible|potential|hypothetical|whether(?: there is)?|if|unless) (.+)$/u.exec(clause);
    const suffix = /^(.+?) (?:(?:is|was|has been) )?(?:denied|rejected|failed|blocked|unlicensed|pending|unresolved|unestablished|required|requested|expected|possible|hypothetical|absent|requirement|not(?: yet)? established|never established)$/u.exec(clause);
    return [prefix?.[1], suffix?.[1]].some(value => value && subject.test(value));
  });
}

/** A denied property remains unestablished even when its owner resolves. A
 * denied sibling dependency does not invalidate an independently stated fact. */
function assertsParticipantProperty(evidence: Tier2FacetEvidence, property: string) {
  if (!/^(?:inflection|class|mood|aspect|polarity|voice|definiteness|finiteness|force|clause type)$/u.test(property)) return true;
  const names = property === 'inflection' ? ['inflection', 'inflectional form']
    : /^(?:force|clause type)$/u.test(property) ? ['force', 'clause type', 'clause typing', 'clause properties'] : [property];
  const subject = new RegExp(`(?:^| )(${names.join('|')})(?: |$)`, 'u');
  const clauses = relationLabelClauses(evidence.relationName);
  if (clauses.length <= 1 && !establishesAssignment(evidence)) return false;
  return !clauses.some(clause => {
    const prefix = /^(?:no|not|never|without|absence of|lack of|denied|rejected|failed|blocked|unlicensed|pending|unresolved|unestablished|required|requested|expected|possible|potential|hypothetical|whether(?: there is)?|if|unless) (.+)$/u.exec(clause);
    const suffix = /^(.+?) (?:(?:is|was|has been) )?(?:denied|rejected|failed|blocked|unlicensed|pending|unresolved|unestablished|required|requested|expected|possible|hypothetical|absent|requirement|not(?: yet)? established|never established)$/u.exec(clause);
    return [prefix?.[1], suffix?.[1]].some(value => value && subject.test(value))
      || subject.test(clause) && /\b(?:if|unless|whether)\b/u.test(clause)
      || subject.test(clause) && !establishesAssignment(evidence);
  });
}

/** A specified form is a requirement until the exact lexical head also records
 * that form. A participle role can identify a selected verb; neither its
 * spelling nor another node's annotation supplies the missing realization. */
function establishedVerbalForms(evidence: Tier2FacetEvidence) {
  const anchors = evidence.authoredCurrentAnchors ?? [];
  return (evidence.authoredValues ?? []).flatMap(value => {
    const match = /^(selected|licensed)(?: (verb|participle|head))? form$/u.exec(normalizeTier2Synonym(value.key));
    if (!match || value.items.length !== 1 || !value.items[0].trim()) return [];
    const qualifier = `${match[1]} ${match[2] ?? 'head'}`;
    const candidates = anchors.filter(anchor => {
      const role = normalizeTier2Synonym(anchor.key);
      return role === qualifier || /^(?:selected )?(?:participle|participial head)$/u.test(role)
        || !match[2] && /^selected (?:verb|head)$/u.test(role)
        || match[1] === 'licensed' && match[2] === 'verb' && /^(?:lexical |licensed )?verb$/u.test(role);
    });
    if (candidates.length !== 1 || candidates[0].items.length !== 1) return [];
    const anchor = candidates[0], nodes: Array<typeof evidence.currentForest[number]> = [];
    const visit = (node: typeof evidence.currentForest[number]) => {
      if (node.id === anchor.items[0]) nodes.push(node);
      node.children?.forEach(visit);
    };
    evidence.currentForest.forEach(visit);
    if (nodes.length !== 1 || nodes[0].children?.length || !nodes[0].word?.trim()) return [];
    const annotationPattern = /\[([^\[\]]*)\]|\(([^()]*)\)/gu;
    const category = nodes[0].label.replace(annotationPattern, '').trim();
    if (categoryLabel(category).replace(/(?:\^?0|⁰)$/u, '') !== 'V') return [];
    const annotations = [...nodes[0].label.matchAll(annotationPattern)]
      .flatMap(match => (match[1] ?? match[2]).split(/[,;]/u)).map(normalizeTier2Synonym);
    if (annotations.some(annotation => /\b(?:not|unrealized|unvalued|required|requested|expected|possible|hypothetical|conditional)\b/u.test(annotation))) return [];
    const literal = normalizeTier2Synonym(value.items[0]);
    if (!annotations.some(annotation => annotation === literal || annotation === `form: ${literal}`)) return [];
    return [{ anchor, value, qualifier, property: 'form' }];
  });
}

/** Whole-word support identifies a realized auxiliary only when the relation's
 * literal form matches its unique explicit host. It supplies no prior form,
 * insertion, or rewrite, and another lexical participant is not a candidate. */
function supportedAuxiliaryForms(evidence: Tier2FacetEvidence) {
  const clauses = relationLabelClauses(evidence.relationName)
    .filter(clause => /\b(?:auxiliary|do) support\b/u.test(clause));
  if (clauses.length !== 1 || !/^(?:lexical )?(?:auxiliary|do) support$/u.test(clauses[0])
    || !establishesAssignment(evidence)) return [];
  const candidates = (evidence.authoredCurrentAnchors ?? []).filter(anchor =>
    /^(?:finite head|finite auxiliary|auxiliary|auxiliary head)$/u.test(normalizeTier2Synonym(anchor.key)));
  if (candidates.length !== 1 || candidates[0].items.length !== 1) return [];
  const anchor = candidates[0], nodes: Array<typeof evidence.currentForest[number]> = [];
  const visit = (node: typeof evidence.currentForest[number]) => {
    if (node.id === anchor.items[0]) nodes.push(node);
    node.children?.forEach(visit);
  };
  evidence.currentForest.forEach(visit);
  if (nodes.length !== 1 || nodes[0].children?.length || !nodes[0].word?.trim()) return [];
  return (evidence.authoredValues ?? []).flatMap(value =>
    normalizeTier2Synonym(value.key) === 'form' && value.items.length === 1
      && value.items[0].trim() === nodes[0].word?.trim()
      ? [{ anchor, value, qualifier: normalizeTier2Synonym(anchor.key), property: 'form' }] : []);
}

/** A named allomorph belongs to its one realized lexical occurrence. Keep the
 * literal form description; the conditioner supplies neither a host nor a
 * second rewrite occurrence. Denied and provisional forms establish no plaque. */
function namedAllomorphForms(evidence: Tier2FacetEvidence) {
  const clauses = relationLabelClauses(evidence.relationName);
  if (clauses.length !== 1 || !isRealizationDescription(clauses[0]) || !establishesAssignment(evidence)) return [];
  const qualifier = /^(?:(?:contextual|conditioned|morphological|inflectional|lexical) )*(.+) allomorphy$/u.exec(clauses[0])?.[1];
  if (!qualifier) return [];
  const anchors = (evidence.authoredCurrentAnchors ?? []).filter(anchor => normalizeTier2Synonym(anchor.key) === qualifier);
  if (anchors.length !== 1 || anchors[0].items.length !== 1) return [];
  const anchor = anchors[0], nodes: Array<typeof evidence.currentForest[number]> = [];
  const visit = (node: typeof evidence.currentForest[number]) => {
    if (node.id === anchor.items[0]) nodes.push(node);
    node.children?.forEach(visit);
  };
  evidence.currentForest.forEach(visit);
  if (nodes.length !== 1 || nodes[0].children?.length || !nodes[0].word?.trim() || nodes[0].silent) return [];
  // An independently identified output host would make the association ambiguous.
  if ((evidence.authoredCurrentAnchors ?? []).some(other => other !== anchor && other.concepts.includes('rewrite.output'))) return [];
  return (evidence.authoredValues ?? []).flatMap(value => value.concepts.includes('pf.rows')
    && !value.concepts.includes('rewrite.rows') && value.items.length === 1 && value.items[0].trim()
    ? [{ anchor, value, qualifier, property: 'form' }] : []);
}

/** A property qualified by an exact participant name has an owner even when
 * a larger dependency cannot be recovered. These scopes assert properties,
 * never an assignment, successful agreement, or a connection between hosts. */
export function recoverParticipantProperties(evidence: Tier2FacetEvidence) {
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const values = evidence.authoredValues ?? [];
  const name = normalizeTier2Synonym(evidence.relationName ?? '');
  const realization = isRealizationDescription(name);
  const propertyStatement = /\b(?:valuation|specification|determination|properties)\b/u.test(name)
    && establishesAssignment(evidence);
  const supportedForms = supportedAuxiliaryForms(evidence);
  const allomorphForms = namedAllomorphForms(evidence);
  const pairedCases = pairedCaseProperties(evidence);
  const qualified = [...participantProperties(evidence), ...establishedVerbalForms(evidence), ...supportedForms, ...allomorphForms];
  const scopes = values.flatMap(value => {
    // A mapping item needs its own complete rewrite. Recasting an incomplete
    // mapping as a property plaque would hide the unresolved claim.
    if (value.concepts.includes('rewrite.rows')) return [];
    const key = normalizeTier2Synonym(value.key);
    if (key === 'lexical realization' && !assertsFormProperty(evidence)) return [];
    if (!assertsParticipantProperty(evidence, key)) return [];
    const association = qualified.find(property => property.value === value);
    if (association?.property === 'form' && !assertsFormProperty(evidence)) return [];
    if (association && !assertsParticipantProperty(evidence, association.property)) return [];
    const qualifier = association?.qualifier;
    const named = association ? [association.anchor] : [];
    const paired = anchors.filter(anchor => anchor.key === value.key);
    const caseProperty = pairedCases.some(property => property.value === value);
    // Lists under the exact same field name explicitly pair their positions.
    // A shared value is not broadcast over an unassociated list of participants.
    let candidates = named.length ? named : caseProperty || realization || propertyStatement ? paired : [];
    if (!candidates.length && value.items.length === 1) {
      // Typed properties can identify their head directly. No dependency is
      // implied by annotating a tense head with its authored tense value.
      let owners: RegExp | undefined;
      if (/^(?:tense|tense value|tense aspect|finiteness)$/u.test(key))
        owners = /^(?:tense|tense head|finite head|inflection|inflectional head)$/u;
      if (/^(?:aspect|mood|polarity|voice)$/u.test(key)) owners = new RegExp(`^${key}(?: head)?$`, 'u');
      if (key === 'lexical realization' && establishesAssignment(evidence)) owners = /^(?:inflected|lexical) verb$/u;
      if (/^(?:force|clause type)$/u.test(key)) owners = /^(?:force head|clause head|complementizer)$/u;
      if (key === 'definiteness') owners = /^(?:nominal|nominal head|determiner phrase)$/u;
      if (value.concepts.includes('case.literal') && establishesAssignment(evidence))
        owners = /^(?:case bearer|case recipient|case target|case position|recipient|argument|nominal|subject|object|possessor)$/u;
      if (value.concepts.includes('feature.rows') && /\b(?:feature determination|feature specification|agreement compatibility)\b/u.test(name))
        owners = /^(?:nominal head|finite head|inflection|feature holder|feature bearer)$/u;
      // A participial-concord claim identifies the feature bearer even when
      // an intervening mediator prevents recovery of a direct dependency.
      if (value.concepts.includes('feature.rows') && /(?:^| )participial (?:agreement|concord)$/u.test(name)
        && !/\b(?:failed|blocked|required|possible|potential|hypothetical|pending)\b/u.test(name)
        && establishesAssignment(evidence)) owners = /^(?:participle|participial head)$/u;
      if (owners) candidates = anchors.filter(anchor => owners.test(normalizeTier2Synonym(anchor.key)));
      if (value.concepts.includes('case.literal') && establishesAssignment(evidence) && !candidates.length) {
        candidates = !evidence.movement || hasIndependentCaseEndpoints(evidence)
          ? anchors.filter(anchor => anchor.concepts.includes('feature.target')) : [];
        if (!candidates.length) candidates = anchors.filter(anchor => anchor.concepts.includes('theta.arguments'));
        if (!candidates.length) {
          const roles = values.filter(entry => entry.concepts.includes('role.label')).flatMap(entry => entry.items)
            .map(normalizeTier2Synonym);
          candidates = anchors.filter(anchor => roles.includes(normalizeTier2Synonym(anchor.key)));
        }
      }
      if (!candidates.length && /^(?:tense|tense value|tense aspect|finiteness|force|clause type)$/u.test(key)) {
        candidates = anchors.filter(anchor => {
          if (anchor.items.length !== 1) return false;
          const matches: Array<typeof evidence.currentForest[number]> = [];
          const visit = (node: typeof evidence.currentForest[number]) => {
            if (node.id === anchor.items[0]) matches.push(node);
            node.children?.forEach(visit);
          };
          evidence.currentForest.forEach(visit);
          return matches.length === 1 && (/^(?:force|clause type)$/u.test(key)
            ? ['C', 'Force'].includes(categoryLabel(matches[0].label)) : ['T', 'I', 'Infl'].includes(categoryLabel(matches[0].label)));
        });
      }
    }
    if (candidates.length !== 1 || candidates[0].items.length !== value.items.length
      || !value.items.length || value.items.some(item => !item.trim())) return [];
    const anchor = candidates[0];
    // Repeated authored positions may attach distinct rows to one exact host;
    // the host itself must still occur only once in the workspace.
    if (!uniqueCurrentOwners(evidence, [...new Set(anchor.items)])) return [];
    if (key === 'lexical realization') {
      let host: typeof evidence.currentForest[number] | undefined;
      const visit = (node: typeof evidence.currentForest[number]) => { if (node.id === anchor.items[0]) host = node; node.children?.forEach(visit); };
      evidence.currentForest.forEach(visit);
      if (!host || categoryLabel(host.label) !== 'V' || host.children?.length || !host.word?.trim()) return [];
    }
    const pf = key === 'lexical realization' || realization && /^(?:(?:inflected|finite|lexical) )?(?:verbs?|predicates?|stems?)$/u.test(normalizeTier2Synonym(anchor.key))
      || allomorphForms.some(property => property.anchor === anchor && property.value === value)
      || /^(?:form|tense|tense value|tense aspect|finiteness)$/u.test(key)
        && supportedForms.some(property => property.anchor === anchor);
    if (!qualifier && !paired.includes(anchor) && !caseProperty && !pf && !/^(?:tense|tense value|tense aspect|finiteness|force|clause type|definiteness|aspect|mood|polarity|voice)$/u.test(key)
      && !value.concepts.some(concept => ['case.literal', 'feature.rows'].includes(concept))) return [];
    return value.items.map((_, index) => scopeEvidence(evidence, pf ? 'pf.structured' : 'plaque.structured',
      [{ entry: anchor, indices: [index], concept: pf ? 'rewrite.output' : 'plaque.anchor' }],
      [{ entry: value, indices: [index], concept: pf ? 'pf.rows' : 'plaque.rows' }]));
  });
  // Several properties on one host form one plaque in this relation moment.
  const grouped = new Map<string, typeof scopes>();
  for (const scope of scopes) {
    const key = JSON.stringify([scope.kind, scope.evidence.currentAnchors]);
    grouped.set(key, [...(grouped.get(key) ?? []), scope]);
  }
  return [...grouped.values()].map(group => {
    if (group.length === 1) return group[0];
    const bindings = (field: 'anchors' | 'values') => {
      const originals = field === 'anchors' ? anchors : values;
      const origins = new Map<string, Set<number>>();
      for (const scope of group) for (const [key, indices] of Object.entries(scope.origins[field])) {
        const indicesForKey = origins.get(key) ?? new Set<number>();
        indices.forEach(index => indicesForKey.add(index));
        origins.set(key, indicesForKey);
      }
      const pf = group[0].kind === 'pf.structured';
      const concept = field === 'anchors' ? pf ? 'rewrite.output' : 'plaque.anchor' : pf ? 'pf.rows' : 'plaque.rows';
      return [...origins].map(([key, indices]) => ({ entry: originals.find(entry => entry.key === key)!,
        indices: [...indices], concept }));
    };
    const merged = scopeEvidence(evidence, group[0].kind, bindings('anchors'), bindings('values'));
    // The physical host is singular even when several authored list positions
    // explicitly name it. Its provenance retains every one of those positions.
    merged.evidence.currentAnchors = group[0].evidence.currentAnchors;
    return merged;
  });
}
