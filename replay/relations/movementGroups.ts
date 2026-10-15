import { recoverMovementEvidence } from './movementEvidence.ts';
import type { Tier2AuthoredEvidenceEntry, Tier2FacetEvidence } from './tier2FacetTypes.ts';
import { buildTier2SynonymIndex, normalizeTier2Synonym, relationRoleConcepts } from './tier2Synonyms.ts';

const vocabulary = buildTier2SynonymIndex();
const endpointConcept = (entry: Tier2AuthoredEvidenceEntry, concept: string) => {
  const role = normalizeTier2Synonym(entry.key).replace(/^(?:shared|prior) /u, '')
    .replace(/\b(occurrences|copies|sources|heads|phrases|constituents)$/u, noun => noun === 'copies' ? 'copy' : noun.slice(0, -1));
  return relationRoleConcepts(vocabulary, role).includes(concept);
};

/** Several movements may share one relation moment. Match each lower occurrence
 * to its unique preceding position and landing by proof, never by list order. */
export function recoverMovementGroups(evidence: Tier2FacetEvidence) {
  const current = evidence.authoredCurrentAnchors ?? [];
  const prior = evidence.authoredPriorAnchors ?? [];
  const sourceRole = (entry: Tier2AuthoredEvidenceEntry) => endpointConcept(entry, 'movement.source');
  const sources = current.filter(sourceRole);
  const priorSources = prior.filter(sourceRole);
  const targets = current.filter(entry => endpointConcept(entry, 'movement.landing'));
  if (sources.length !== 1 || priorSources.length !== 1 || !targets.length) return [];
  const source = sources[0], previous = priorSources[0];
  const listedTargets = targets.filter(target => target.items.length > 1);
  if (listedTargets.length > 1) return [];
  const listedTarget = listedTargets[0];
  const targetChoices = listedTarget ? listedTarget.items.map((_, index) => index) : [0];
  if (source.items.length < 2 || targets.some(target => !target.items.length || new Set(target.items).size !== target.items.length) || previous.items.length !== source.items.length
    || new Set(source.items).size !== source.items.length || new Set(previous.items).size !== previous.items.length
    || targets.some(target => target.items.some(id => source.items.includes(id)))) return [];
  const pairs = source.items.map(sourceId => previous.items.flatMap((priorId, priorIndex) => targetChoices.flatMap(targetIndex => {
    const result = recoverMovementEvidence({ relation: 'Authored movement group',
      anchors: Object.fromEntries(current.map(entry => [entry.key, entry === source ? sourceId : entry === listedTarget ? entry.items[targetIndex] : [...entry.items]])),
      priorAnchors: Object.fromEntries(prior.map(entry => [entry.key, entry === previous ? priorId : [...entry.items]]))
    }, evidence.currentForest, evidence.priorForest);
    return result.movement ? [{ movement: result.movement, diagnostics: result.diagnostics, priorIndex, targetIndex }] : [];
  })));
  if (pairs.some(matches => matches.length !== 1)
    || new Set(pairs.map(matches => matches[0].priorIndex)).size !== source.items.length
    || listedTarget && (listedTarget.items.length !== source.items.length
      || new Set(pairs.map(matches => matches[0].targetIndex)).size !== listedTarget.items.length)
    || !pairs.some(matches => matches[0].movement.transition)) return [];
  const targetEntries = pairs.map(([{ movement }]) => targets.find(entry => entry.items.includes(movement.targetNodeId)));
  if (targetEntries.some(entry => !entry)) return [];
  const values = (evidence.authoredValues ?? []).filter(entry => entry.concepts.some(concept => ['outcome', 'movement.route'].includes(concept)));
  const scoped = (entry: Tier2AuthoredEvidenceEntry, index: number, concepts: string[]) => ({
    ...entry, items: [entry.items[index]], concepts,
    conceptItemIndices: Object.fromEntries(concepts.map(concept => [concept, [0]]))
  });
  return pairs.map(([{ movement, diagnostics, priorIndex }], index) => {
    const target = targetEntries[index]!;
    const targetIndex = target.items.indexOf(movement.targetNodeId);
    const transition = pairs.some(([pair]) => pair.movement.targetNodeId === movement.targetNodeId && pair.movement.transition);
    return { kind: 'movement.path' as const,
      origins: { anchors: { [source.key]: [index], [target.key]: [targetIndex],
        ...Object.fromEntries((movement.context ?? []).map(context => [context.key, [current.find(entry => entry.key === context.key)!.items.indexOf(context.nodeId)]])) }, priorAnchors: { [previous.key]: [priorIndex] },
        values: Object.fromEntries(values.map(entry => [entry.key, entry.items.map((_, i) => i)])) },
      evidence: { currentForest: evidence.currentForest, priorForest: evidence.priorForest,
        // A retained-ID source can establish a shared landing for other
        // proven sources. Independent landings keep their own transition.
        movement: { ...movement, transition, priorAnchorKeys: [previous.key] },
        movementDiagnostics: diagnostics,
        currentAnchors: { 'movement.source': [movement.sourceNodeId], 'movement.witness': [movement.witnessNodeId],
          'movement.landing': [movement.targetNodeId] },
        priorAnchors: { 'movement.source': [movement.priorSourceNodeId] },
        authoredCurrentAnchors: [scoped(source, index, ['movement.source', 'movement.witness']), scoped(target, targetIndex, ['movement.landing'])],
        authoredPriorAnchors: [scoped(previous, priorIndex, ['movement.source'])],
        values: Object.fromEntries(['outcome', 'movement.route'].flatMap(concept => evidence.values[concept]
          ? [[concept, evidence.values[concept]]] : [])), authoredValues: values
      } satisfies Tier2FacetEvidence
    };
  });
}
