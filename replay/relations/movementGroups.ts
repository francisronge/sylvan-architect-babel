import { type RecoveredMovement, recoverMovementEvidence } from './movementEvidence.ts';
import { containsOccurrence, indexMovementOccurrences, sameMovementSourceSlot } from './movementSourceEvidence.ts';
import type { Tier2AuthoredEvidenceEntry, Tier2FacetEvidence } from './tier2FacetTypes.ts';
import { buildTier2SynonymIndex, normalizeTier2Synonym, relationRoleConcepts } from './tier2Synonyms.ts';

const vocabulary = buildTier2SynonymIndex();
const endpointConcept = (entry: Tier2AuthoredEvidenceEntry, concept: string) => {
  const role = normalizeTier2Synonym(entry.key).replace(/^(?:shared|prior) /u, '')
    .replace(/\b(occurrences|copies|sources|heads|phrases|constituents)$/u, noun => noun === 'copies' ? 'copy' : noun.slice(0, -1));
  return relationRoleConcepts(vocabulary, role).includes(concept);
};

/** Several movements may share one relation moment. Match each lower occurrence
 * to its unique preceding position and landing by proof, never by list order.
 * Without a prior source list, each source must be the retained occurrence that
 * already stood in the preceding stage, as a single movement may be. */
export function recoverMovementGroups(evidence: Tier2FacetEvidence) {
  const current = evidence.authoredCurrentAnchors ?? [];
  const prior = evidence.authoredPriorAnchors ?? [];
  const sourceRole = (entry: Tier2AuthoredEvidenceEntry) => endpointConcept(entry, 'movement.source');
  const sources = current.filter(sourceRole);
  const priorSources = prior.filter(sourceRole);
  const targets = current.filter(entry => endpointConcept(entry, 'movement.landing'));
  if (!sources.length) {
    const listed = recoverListedLowerCopies(evidence, current, prior, priorSources);
    return listed ? movementGroupScopes(evidence, current, listed.source, [listed.target], listed.previous, false, listed.pairs) : [];
  }
  const retained = !priorSources.length && sources.length === 1
    && sources[0].items.every(id => (evidence.priorForest ?? []).some(root => containsOccurrence(root, id)));
  if (sources.length !== 1 || (priorSources.length !== 1 && !retained) || !targets.length) return [];
  const source = sources[0], previous = retained ? source : priorSources[0];
  // A claim may list the landings under more than one landing-like role, such
  // as landing and target. Each source tries every item of each listed role,
  // and the proof alone picks the item that belongs to it.
  const listedTargets = targets.filter(target => target.items.length > 1);
  const choices = listedTargets.reduce<number[][]>((combos, target) =>
    combos.flatMap(combo => target.items.map((_, index) => [...combo, index])), [[]]);
  if (choices.length > 64) return [];
  if (source.items.length < 2 || targets.some(target => !target.items.length || new Set(target.items).size !== target.items.length) || previous.items.length !== source.items.length
    || new Set(source.items).size !== source.items.length || new Set(previous.items).size !== previous.items.length
    || targets.some(target => target.items.some(id => source.items.includes(id)))) return [];
  // Occurrences of one shared lineage, as in across-the-board movement, can
  // each pair with every listed landing. A landing commands the position it
  // displaces, so among proven candidates only a landing whose parent
  // contains the source pairs with it.
  const { parents } = indexMovementOccurrences(evidence.currentForest ?? []);
  const commands = (targetId: string, sourceId: string): boolean => {
    const parent = parents.get(targetId);
    return Boolean(parent && containsOccurrence(parent, sourceId));
  };
  const pairs = source.items.map(sourceId => {
    const matches = previous.items.flatMap((priorId, priorIndex) => retained && priorId !== sourceId ? [] : choices.flatMap(choice => {
      const chosen = (entry: Tier2AuthoredEvidenceEntry) => listedTargets.indexOf(entry);
      const result = recoverMovementEvidence({ relation: 'Authored movement group',
        anchors: Object.fromEntries(current.map(entry => [entry.key, entry === source ? sourceId
          : chosen(entry) >= 0 ? entry.items[choice[chosen(entry)]] : [...entry.items]])),
        priorAnchors: Object.fromEntries(prior.map(entry => [entry.key, entry === previous ? priorId : [...entry.items]]))
      }, evidence.currentForest, evidence.priorForest);
      return result.movement ? [{ movement: result.movement, diagnostics: result.diagnostics, priorIndex, choice }] : [];
    }));
    const commanding = matches.filter(match => commands(match.movement.targetNodeId, match.movement.sourceNodeId));
    return matches.length > 1 && commanding.length === 1 ? commanding : matches;
  });
  if (pairs.some(matches => matches.length !== 1)
    || new Set(pairs.map(matches => matches[0].priorIndex)).size !== source.items.length
    || listedTargets.some((target, listIndex) => target.items.length !== source.items.length
      || new Set(pairs.map(matches => matches[0].choice[listIndex])).size !== target.items.length)
    || !pairs.some(matches => matches[0].movement.transition)) return [];
  return movementGroupScopes(evidence, current, source, targets, previous, retained, pairs.map(([match]) => match));
}

type GroupPair = { movement: RecoveredMovement; diagnostics: string[]; priorIndex: number };

/** One movement.path scope per proven pair, in the order of the source list. */
function movementGroupScopes(evidence: Tier2FacetEvidence, current: readonly Tier2AuthoredEvidenceEntry[],
  source: Tier2AuthoredEvidenceEntry, targets: readonly Tier2AuthoredEvidenceEntry[],
  previous: Tier2AuthoredEvidenceEntry, retained: boolean, pairs: readonly GroupPair[]) {
  const targetEntries = pairs.map(({ movement }) => targets.find(entry => entry.items.includes(movement.targetNodeId)));
  if (targetEntries.some(entry => !entry)) return [];
  const values = (evidence.authoredValues ?? []).filter(entry => entry.concepts.some(concept => ['outcome', 'movement.route'].includes(concept)));
  const scoped = (entry: Tier2AuthoredEvidenceEntry, index: number, concepts: string[]) => ({
    ...entry, items: [entry.items[index]], concepts,
    conceptItemIndices: Object.fromEntries(concepts.map(concept => [concept, [0]]))
  });
  return pairs.map(({ movement, diagnostics, priorIndex }, index) => {
    const target = targetEntries[index]!;
    const targetIndex = target.items.indexOf(movement.targetNodeId);
    const transition = pairs.some(pair => pair.movement.targetNodeId === movement.targetNodeId && pair.movement.transition);
    return { kind: 'movement.path' as const,
      origins: { anchors: { [source.key]: [index], [target.key]: [targetIndex],
        ...Object.fromEntries((movement.context ?? []).map(context => [context.key, [current.find(entry => entry.key === context.key)!.items.indexOf(context.nodeId)]])) },
        priorAnchors: retained ? {} : { [previous.key]: [priorIndex] },
        values: Object.fromEntries(values.map(entry => [entry.key, entry.items.map((_, i) => i)])) },
      evidence: { currentForest: evidence.currentForest, priorForest: evidence.priorForest,
        // A retained-ID source can establish a shared landing for other
        // proven sources. Independent landings keep their own transition.
        movement: { ...movement, transition, ...(retained ? {} : { priorAnchorKeys: [previous.key] }) },
        movementDiagnostics: diagnostics,
        currentAnchors: { 'movement.source': [movement.sourceNodeId], 'movement.witness': [movement.witnessNodeId],
          'movement.landing': [movement.targetNodeId] },
        priorAnchors: { 'movement.source': [movement.priorSourceNodeId] },
        authoredCurrentAnchors: [scoped(source, index, ['movement.source', 'movement.witness']), scoped(target, targetIndex, ['movement.landing'])],
        authoredPriorAnchors: retained ? [] : [scoped(previous, priorIndex, ['movement.source'])],
        values: Object.fromEntries(['outcome', 'movement.route'].flatMap(concept => evidence.values[concept]
          ? [[concept, evidence.values[concept]]] : [])), authoredValues: values
      } satisfies Tier2FacetEvidence
    };
  });
}

/** The lower copies of a shared landing can be listed under a field no source
 * role names, such as a list of traces, beside the preceding sources listed in
 * priorAnchors. Each listed copy must hold exactly one preceding source's slot
 * by lineage and exact position, and the claim's only other anchored
 * occurrence of that lineage, which commands every copy, is the landing. A copy
 * the ordinary reader cannot pair on its own, one that kept its own id in its
 * own slot, shares the landing a sibling pair proves. */
function recoverListedLowerCopies(evidence: Tier2FacetEvidence, current: readonly Tier2AuthoredEvidenceEntry[],
  prior: readonly Tier2AuthoredEvidenceEntry[], priorSources: readonly Tier2AuthoredEvidenceEntry[]) {
  if (priorSources.length !== 1) return;
  const previous = priorSources[0], now = indexMovementOccurrences(evidence.currentForest ?? []);
  const before = indexMovementOccurrences(evidence.priorForest ?? []);
  const lineage = before.nodes.get(previous.items[0] ?? '')?.lineageId;
  if (!lineage || previous.items.length < 2 || new Set(previous.items).size !== previous.items.length
    || previous.items.some(id => before.duplicates.has(id) || before.nodes.get(id)?.lineageId !== lineage)) return;
  const holds = (copyId: string, priorId: string) => !now.duplicates.has(copyId)
    && now.nodes.get(copyId)?.lineageId === lineage && sameMovementSourceSlot(now, before, copyId, priorId);
  const lists = current.filter(entry => entry.items.length === previous.items.length && new Set(entry.items).size === entry.items.length
    && previous.items.every(priorId => entry.items.filter(id => holds(id, priorId)).length === 1));
  if (lists.length !== 1) return;
  const source = lists[0];
  const landings = [...new Set(current.filter(entry => entry !== source && entry.items.length === 1).map(entry => entry.items[0]))]
    .filter(id => now.nodes.get(id)?.lineageId === lineage && !now.duplicates.has(id) && !source.items.includes(id));
  const landingParent = landings.length === 1 ? now.parents.get(landings[0]) : undefined;
  if (!landingParent || source.items.some(id => !containsOccurrence(landingParent, id))) return;
  const landing = landings[0], target = current.find(entry => entry !== source && entry.items.length === 1 && entry.items[0] === landing)!;
  const read = source.items.map(copyId => {
    const priorIndex = previous.items.findIndex(priorId => holds(copyId, priorId));
    const result = recoverMovementEvidence({ relation: 'Authored movement group',
      anchors: Object.fromEntries(current.map(entry => [entry.key, entry === source ? copyId : [...entry.items]])),
      priorAnchors: Object.fromEntries(prior.map(entry => [entry.key, entry === previous ? previous.items[priorIndex] : [...entry.items]]))
    }, evidence.currentForest, evidence.priorForest);
    const proven = result.movement?.sourceNodeId === copyId && result.movement.targetNodeId === landing;
    return { copyId, priorIndex, movement: proven ? result.movement : undefined, diagnostics: result.diagnostics };
  });
  const sibling = read.find(entry => entry.movement?.transition)?.movement;
  if (!sibling) return;
  const pairs: GroupPair[] = [];
  for (const { copyId, priorIndex, movement, diagnostics } of read) {
    if (movement) { pairs.push({ movement, diagnostics, priorIndex }); continue; }
    if (copyId !== previous.items[priorIndex]) return;
    pairs.push({ movement: { ...sibling, priorSourceNodeId: copyId, sourceNodeId: copyId, witnessNodeId: copyId,
      roles: {}, priorAnchorKeys: undefined }, diagnostics: [], priorIndex });
  }
  return { source, target, previous, pairs };
}
