import type { DerivationStageRelation, SyntaxNode } from '../../types.ts';
import { scopeEvidence } from './evidenceScopes.ts';
import { POSITIVE_OUTCOMES, type Tier2AuthoredEvidenceEntry, type Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { relationAssertionFailure, resolveOutcomeLiteral } from './outcomeResolver.ts';
import { normalizeTier2Synonym } from './tier2Synonyms.ts';

const caseNames = new Set(['nominative', 'accusative', 'genitive', 'dative', 'ergative',
  'absolutive', 'instrumental', 'locative', 'oblique', 'vocative']);

const featureDimensions = new Map([
  ['singular', 'number'], ['plural', 'number'], ['dual', 'number'],
  ['masculine', 'gender'], ['feminine', 'gender'], ['neuter', 'gender'], ['common', 'gender']
]);

/** Accept feature notation, not clauses describing a possible agreement. */
function featureBundle(text: string): Map<string, string> | undefined {
  let remaining = normalizeTier2Synonym(text);
  const dimensions = new Map<string, string>();
  while (remaining) {
    const person = /^(first|second|third) person(?: |$)/u.exec(remaining);
    const item = person?.[0].trim() ?? remaining.split(' ')[0];
    const dimension = person ? 'person' : featureDimensions.get(item);
    if (!dimension || dimensions.has(dimension)) return undefined;
    dimensions.set(dimension, item);
    remaining = remaining.slice(item.length).trim();
  }
  return dimensions.size ? dimensions : undefined;
}

/** Result lists sometimes contain complete nominal assertions: a literal
 * agreement bundle on a named head, or a Case on a named argument. The complete
 * list must establish those claims with uniquely resolved owners; explanatory,
 * conditional and negative sentences remain untouched. The displayed rows keep
 * the original statements and item ownership, including their owner wording. */
export function recoverResultAssignments(relation: DerivationStageRelation, evidence: Tier2FacetEvidence) {
  const name = normalizeTier2Synonym(relation.relation);
  if (!/\b(?:agree|agreement|concord)\b/u.test(name)
    || /\b(?:no|not|non|without|failed|blocked|unlicensed|impossible|possible|potential|hypothetical|conditional|pending|if|unless|whether)\b/u.test(name)
    || relationAssertionFailure(relation.relation, 'agreement')) return [];
  const entries = evidence.authoredValues ?? [];
  const results = entries.filter(entry => normalizeTier2Synonym(entry.key) === 'result');
  if (results.length !== 1 || !Array.isArray(relation.values?.[results[0].key]) || !results[0].items.length) return [];
  const result = results[0];
  // Unknown assertions alongside the list might qualify or contradict it. Only
  // independently explicit positive outcomes can be ignored by this recovery.
  if (entries.some(entry => entry !== result && (!['status', 'outcome', 'judgment', 'verdict'].includes(normalizeTier2Synonym(entry.key))
    || entry.items.some(item => !POSITIVE_OUTCOMES.some(outcome => resolveOutcomeLiteral(item)?.concept === outcome))))) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const sources = anchors.filter(entry => entry.concepts.includes('probe'));
  const targets = anchors.filter(entry => entry.concepts.includes('goal'));
  if (sources.length !== 1 || targets.length !== 1 || sources[0].items.length !== 1 || targets[0].items.length !== 1
    || sources[0].items[0] === targets[0].items[0]) return [];
  const source = sources[0], target = targets[0];
  if (anchors.some(entry => entry !== source && entry.concepts.includes('feature.source')
    || entry !== target && entry.concepts.includes('feature.target'))) return [];
  const nodes = new Map<string, SyntaxNode[]>();
  const visit = (node: SyntaxNode) => {
    nodes.set(node.id, [...(nodes.get(node.id) ?? []), node]);
    node.children?.forEach(visit);
  };
  evidence.currentForest.forEach(visit);
  if ([source, target].some(entry => nodes.get(entry.items[0])?.length !== 1)) return [];
  const category = (entry: Tier2AuthoredEvidenceEntry) => {
    const node = entry.items.length === 1 ? nodes.get(entry.items[0]) : undefined;
    if (node?.length !== 1) return '';
    return normalizeTier2Synonym(node[0].label.replace(/(?:\s*\[[^\[\]]*\])+$/u, '').replace(/(?:\^0|⁰)$/u, ''));
  };
  const owns = (entry: Tier2AuthoredEvidenceEntry, description: string) => {
    const owner = normalizeTier2Synonym(description).replace(/^the /u, '');
    const named = anchors.filter(anchor => {
      const role = normalizeTier2Synonym(anchor.key), label = category(anchor);
      return owner === role || label && owner === `${role} ${label}`;
    });
    if (named.length) return named.length === 1 && named[0] === entry;
    const ownCategory = category(entry);
    if (owner === ownCategory && anchors.filter(anchor => category(anchor) === owner).length === 1) return true;
    if (entry !== target || !ownCategory || !owner.endsWith(` ${ownCategory}`)) return false;
    const qualifier = owner.slice(0, -(ownCategory.length + 1));
    return ['agree', 'agreement', 'concord'].some(operation => ` ${name}`.endsWith(` ${qualifier} ${operation}`));
  };
  const agreementIndices: number[] = [], caseIndices: number[] = [];
  const dimensions = new Map<string, string>();
  for (const [index, statement] of result.items.entries()) {
    const match = /^(.+?) (agreement|case) on (.+)$/u.exec(normalizeTier2Synonym(statement));
    if (!match) return [];
    const [, literal, kind, owner] = match;
    if (kind === 'agreement') {
      const features = featureBundle(literal);
      if (!features || !owns(source, owner) || owns(target, owner)) return [];
      for (const [dimension, value] of features) {
        if (dimensions.has(dimension) && dimensions.get(dimension) !== value) return [];
        dimensions.set(dimension, value);
      }
      agreementIndices.push(index);
    } else {
      if (!caseNames.has(literal) || !owns(target, owner) || owns(source, owner) || caseIndices.length) return [];
      caseIndices.push(index);
    }
  }
  return [
    { indices: agreementIndices, concept: 'feature.rows' },
    { indices: caseIndices, concept: 'case.literal' }
  ].flatMap(({ indices, concept }) => indices.length ? [scopeEvidence(evidence, 'feature.dependency', [
    { entry: source, concept: 'feature.source' }, { entry: target, concept: 'feature.target' }
  ], [{ entry: result, indices, concept }])] : []);
}
