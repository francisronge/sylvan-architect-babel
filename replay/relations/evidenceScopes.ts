import type { Tier2AuthoredEvidenceEntry, Tier2FacetEvidence, Tier2FacetId } from './tier2FacetRecipes.ts';
import { normalizeTier2Synonym } from './tier2Synonyms.ts';
import type { SyntaxNode } from '../../types.ts';

/** Exact authored owners must occur once in the current workspace. */
export function uniqueCurrentOwners(evidence: Pick<Tier2FacetEvidence, 'currentForest'>, ids: readonly string[]): boolean {
  const counts = new Map<string, number>();
  const visit = (node: SyntaxNode) => {
    counts.set(node.id, (counts.get(node.id) ?? 0) + 1); node.children?.forEach(visit);
  };
  evidence.currentForest.forEach(visit);
  return ids.length > 0 && new Set(ids).size === ids.length && ids.every(id => counts.get(id) === 1);
}

export type EvidenceScope = {
  kind: Tier2FacetId;
  evidence: Tier2FacetEvidence;
  origins: Record<'anchors' | 'values', Record<string, number[]>>;
  restates?: { stageIndex: number; relationIndex: number };
};

type Binding = { entry: Tier2AuthoredEvidenceEntry; concept: string; indices?: readonly number[] };

/** Restrict a claim to proven bindings while retaining each authored item’s
 * location. Derived literals have no fabricated authored-field ownership. */
export function scopeEvidence<Kind extends Tier2FacetId>(
  source: Tier2FacetEvidence,
  kind: Kind,
  anchors: Binding[],
  values: Binding[] = [],
  derivedValues: Record<string, readonly string[]> = {}
): EvidenceScope & { kind: Kind } {
  const bind = (bindings: Binding[]) => {
    const concepts: Record<string, string[]> = {};
    const origins: Record<string, number[]> = {};
    const authored = bindings.map(({ entry, concept, indices = entry.items.map((_, index) => index) }) => {
      const items = indices.map(index => entry.items[index]);
      origins[entry.key] = [...new Set([...(origins[entry.key] ?? []), ...indices])];
      (concepts[concept] ??= []).push(...items);
      return { key: entry.key, items, concepts: [concept], conceptItemIndices: { [concept]: items.map((_, index) => index) } };
    });
    return { concepts, origins, authored };
  };
  const a = bind(anchors), v = bind(values);
  return {
    kind, origins: { anchors: a.origins, values: v.origins },
    evidence: {
      relationName: source.relationName,
      currentForest: source.currentForest,
      currentAnchors: a.concepts, values: { ...derivedValues, ...v.concepts },
      authoredCurrentAnchors: a.authored, authoredValues: v.authored,
      associatedAnchorKeys: Object.fromEntries(Object.keys(a.concepts).map(concept =>
        [concept, a.authored.filter(entry => entry.concepts.includes(concept)).map(entry => entry.key)]))
    }
  };
}

/** Qualified property names identify their participant independently of any
 * dependency. Ambiguous names and unequal lists establish no association. */
const participantNames = new Map([
  ['finite head', 'inflection'], ['inflectional head', 'inflection'],
  ['participial', 'participle'], ['participial head', 'participle'], ['verbal', 'verb']
]);
export const participantName = (key: string): string => {
  const name = normalizeTier2Synonym(key);
  if (participantNames.has(name)) return participantNames.get(name)!;
  const base = name.replace(/^(?:finite|inflected|lexical) /u, '').replace(/ (?:head|exponent|stem)$/u, '');
  return participantNames.get(base) ?? base;
};

/** A feature bearer can qualify its nominal role without changing the owner.
 * Position qualifiers remain distinct: upper/lower subjects are not aliases.
 * This is not a general identification of Case or tense owners. */
export const featureParticipantName = (key: string): string =>
  /^(?:(?:quirky|pronominal|null|overt) )?(subject|object)(?: (?:determiner|nominal|dp|np|phrase|constituent))?$/u.exec(normalizeTier2Synonym(key))?.[1]
    ?? participantName(key);

const participantPropertyNames = 'features|feature bundle|agreement specification|agreement|person|number|gender|case|tense|form|inflection|class|mood|aspect|polarity|voice|definiteness|finiteness';
const qualifiedParticipantProperty = new RegExp(`^(.*?) (${participantPropertyNames})$`, 'u');
const unqualifiedParticipantProperty = new RegExp(`^(?:${participantPropertyNames})$`, 'u');
/** Lexical form and inflection fields need their own realization and host
 * proof. A sole participant does not establish that a form was realized. */
export const isUnqualifiedGrammaticalProperty = (key: string): boolean => {
  const property = normalizeTier2Synonym(key);
  return unqualifiedParticipantProperty.test(property) && property !== 'form' && property !== 'inflection';
};

export function participantProperties(evidence: Tier2FacetEvidence) {
  return (evidence.authoredValues ?? []).flatMap(value => {
    const match = qualifiedParticipantProperty.exec(normalizeTier2Synonym(value.key));
    if (!match) return [];
    const [, qualifier, property] = match;
    // A selected or required form needs independent realization evidence;
    // qualification alone identifies no current form for that participant.
    if (property === 'form' && /\b(?:selected|required|requested|expected|possible|potential|hypothetical|previous|prior|alternative)\b/u.test(qualifier)) return [];
    const nameOf = /^(?:features|feature bundle|agreement specification|agreement|person|number|gender)$/u.test(property)
      ? featureParticipantName : participantName;
    let anchors = (evidence.authoredCurrentAnchors ?? []).filter(anchor =>
      [qualifier, `${qualifier} head`, `${qualifier} argument`].map(nameOf).includes(nameOf(anchor.key))
      || property === 'case' && nameOf(anchor.key) === `${qualifier} goal`
      || normalizeTier2Synonym(anchor.key) === qualifier);
    if (!anchors.length) {
      // An explicit role label can name the same participant at another level:
      // objectRole: Experiencer identifies which anchor owns objectCase.
      const roleNames = (evidence.authoredValues ?? []).filter(entry => entry.concepts.includes('role.label')
        && normalizeTier2Synonym(entry.key) === `${qualifier} role`).flatMap(entry => entry.items).map(participantName);
      if (roleNames.length === 1) anchors = (evidence.authoredCurrentAnchors ?? [])
        .filter(anchor => participantName(anchor.key) === roleNames[0]);
    }
    if (!anchors.length) {
      // The clitic claim explicitly names the nominal role of its one
      // pronominal argument; this associates features, not another dependency.
      if (/^(?:subject|object)$/u.test(qualifier)
        && normalizeTier2Synonym(evidence.relationName) === `${qualifier} clitic licensing`
        && /^(?:features|feature bundle|agreement specification|agreement|person|number|gender)$/u.test(property))
        anchors = (evidence.authoredCurrentAnchors ?? []).filter(anchor =>
          /^(?:pronominal argument|(?:pronominal|resumptive) clitic|clitic argument)$/u.test(normalizeTier2Synonym(anchor.key)));
    }
    if (!anchors.length) {
      // A participant-qualified dependency label can name its unique target:
      // subject Agree with probe/goal also identifies the owner of subjectCase.
      // This associates a property; it does not assert another dependency.
      const label = normalizeTier2Synonym(evidence.relationName ?? '');
      const describesTarget = ['agree', 'agreement', 'concord'].some(operation =>
        ` ${label}`.endsWith(` ${qualifier} ${operation}`))
        || qualifier === 'subject' && property === 'case' && /\bfinite (?:agree|agreement)\b/u.test(label)
          && !/\bobject\b/u.test(label);
      const authored = evidence.authoredCurrentAnchors ?? [];
      const sources = authored.filter(anchor => anchor.concepts.includes('feature.source')
        || qualifier === 'subject' && property === 'case' && normalizeTier2Synonym(anchor.key) === 'tense');
      if (describesTarget && !/\b(?:possible|potential|hypothetical)\b/u.test(label)
        && sources.length === 1 && sources[0].items.length === 1)
        anchors = authored.filter(anchor => anchor.concepts.includes('feature.target'));
    }
    if (anchors.length !== 1 || !value.items.length || anchors[0].items.length !== value.items.length
      || value.items.some(item => !item.trim())) return [];
    if (!uniqueCurrentOwners(evidence, [...new Set(anchors[0].items)])) return [];
    return [{ anchor: anchors[0], value, qualifier, property }];
  });
}
