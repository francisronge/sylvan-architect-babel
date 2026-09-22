import { recoverMovementEvidence } from './movementEvidence.ts';
import { buildTier2SynonymIndex, normalizeTier2Synonym, relationRoleConcepts } from './tier2Synonyms.ts';
import type { Tier2AuthoredEvidenceEntry, Tier2FacetEvidence } from './tier2FacetRecipes.ts';

const vocabulary = buildTier2SynonymIndex();
const endpointConcept = (entry: Tier2AuthoredEvidenceEntry, concept: string) => {
  const role = normalizeTier2Synonym(entry.key).replace(/^(?:shared|prior) /u, '')
    .replace(/\b(occurrences|copies|sources|heads|phrases|constituents)$/u, noun => noun === 'copies' ? 'copy' : noun.slice(0, -1));
  return relationRoleConcepts(vocabulary, role).includes(concept);
};

/** One explicit landing may receive several source occurrences at one
 * relation moment. Every source still needs its own unique preceding position. */
export function recoverSharedMovement(evidence: Tier2FacetEvidence) {
  const current = evidence.authoredCurrentAnchors ?? [];
  const prior = evidence.authoredPriorAnchors ?? [];
  const sourceRole = (entry: Tier2AuthoredEvidenceEntry) => endpointConcept(entry, 'movement.source');
  const sources = current.filter(sourceRole);
  const priorSources = prior.filter(sourceRole);
  const targets = current.filter(entry => endpointConcept(entry, 'movement.landing'));
  if (sources.length !== 1 || priorSources.length !== 1 || !targets.length) return [];
  const source = sources[0], previous = priorSources[0];
  if (!source.items.length || targets.some(target => target.items.length !== 1) || previous.items.length !== source.items.length
    || new Set(source.items).size !== source.items.length || new Set(previous.items).size !== previous.items.length
    || targets.some(target => source.items.includes(target.items[0]))) return [];
  const pairs = source.items.map(sourceId => previous.items.flatMap((priorId, priorIndex) => {
    const result = recoverMovementEvidence({ relation: 'Authored shared dependency',
      anchors: Object.fromEntries(current.map(entry => [entry.key, entry === source ? sourceId : [...entry.items]])),
      priorAnchors: Object.fromEntries(prior.map(entry => [entry.key, entry === previous ? priorId : [...entry.items]]))
    }, evidence.currentForest, evidence.priorForest);
    return result.movement ? [{ movement: result.movement, diagnostics: result.diagnostics, priorIndex }] : [];
  }));
  if (pairs.some(matches => matches.length !== 1)
    || new Set(pairs.map(matches => matches[0].priorIndex)).size !== source.items.length
    || new Set(pairs.map(matches => matches[0].movement.targetNodeId)).size !== 1
    || !pairs.some(matches => matches[0].movement.transition)) return [];
  const target = targets.find(entry => entry.items[0] === pairs[0][0].movement.targetNodeId);
  if (!target) return [];
  const values = (evidence.authoredValues ?? []).filter(entry => entry.concepts.some(concept => ['outcome', 'movement.route'].includes(concept)));
  const scoped = (entry: Tier2AuthoredEvidenceEntry, index: number, concepts: string[]) => ({
    ...entry, items: [entry.items[index]], concepts,
    conceptItemIndices: Object.fromEntries(concepts.map(concept => [concept, [0]]))
  });
  return pairs.map(([{ movement, diagnostics, priorIndex }], index) => ({ kind: 'movement.path' as const,
    origins: { anchors: { [source.key]: [index], [target.key]: [0],
      ...Object.fromEntries((movement.context ?? []).map(context => [context.key, [0]])) }, priorAnchors: { [previous.key]: [priorIndex] },
      values: Object.fromEntries(values.map(entry => [entry.key, entry.items.map((_, i) => i)])) },
    evidence: { currentForest: evidence.currentForest, priorForest: evidence.priorForest,
      // One source can retain its ID at the landing. Its proved relocation
      // establishes the new shared landing for the other exact source pairs.
      movement: { ...movement, transition: true, priorAnchorKeys: [previous.key] },
      movementDiagnostics: diagnostics,
      currentAnchors: { 'movement.source': [movement.sourceNodeId], 'movement.witness': [movement.witnessNodeId],
        'movement.landing': [movement.targetNodeId] },
      priorAnchors: { 'movement.source': [movement.priorSourceNodeId] },
      authoredCurrentAnchors: [scoped(source, index, ['movement.source', 'movement.witness']), scoped(target, 0, ['movement.landing'])],
      authoredPriorAnchors: [scoped(previous, priorIndex, ['movement.source'])],
      values: Object.fromEntries(['outcome', 'movement.route'].flatMap(concept => evidence.values[concept]
        ? [[concept, evidence.values[concept]]] : [])), authoredValues: values
    } satisfies Tier2FacetEvidence
  }));
}
