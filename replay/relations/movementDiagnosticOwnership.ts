import type { DerivationStageRelation, SyntaxNode } from '../../types.ts';
import { productionRelationRegistry } from '../relationDispatch/productionRegistry.js';
import { findRelationRegistryEntry } from '../relationDispatch/relationRegistry.js';
import type { RecoveredMovement } from './movementEvidence.ts';
import { foldMovementIdentityKey, isMovementIdentity } from './movementIdentities.ts';
import type { RelationClaimDispatch } from './relationClaims.ts';

/** A rejected movement candidate can describe an earlier event's context.
 * Keep the rejection in claim evidence, without attributing it to a second
 * authored movement when prior ownership, a recovered static claim, or exact
 * unchanged positional/lineage evidence establishes that context.
 */
export function isPriorMovementContextFailure(
  relation: DerivationStageRelation,
  dispatch: RelationClaimDispatch,
  earlierMovements: readonly RecoveredMovement[]
): boolean {
  const evidence = dispatch.evidence;
  const chainIdentity = ['achain', 'abarchain', 'whchain', 'headchain']
    .includes(foldMovementIdentityKey(relation.relation));
  // A lineage refusal pairs a landing with a cited occurrence of another
  // chain; only the earlier-owner reading below can explain it as context.
  if (evidence.movement || !['MOVEMENT_ENDPOINTS_UNRESOLVED', 'MOVEMENT_WITNESS_OUTSIDE_SOURCE',
    'MOVEMENT_TARGET_IS_LOWER_WITNESS', 'MOVEMENT_LINEAGE_UNPROVEN'].includes(evidence.movementFailure ?? '')
    || isMovementIdentity(relation.relation) && !chainIdentity
    || findRelationRegistryEntry(productionRelationRegistry, relation.relation)
    || evidence.authoredPriorAnchors?.some(entry => entry.concepts.includes('movement.source'))
    || dispatch.facets.some(facet => facet.evaluation.earnedTransitions.includes('movement'))) return false;

  const index = (forest: readonly SyntaxNode[]) => {
    const nodes = new Map<string, { node: SyntaxNode; parent: string | null; slot: number }>();
    const duplicates = new Set<string>();
    const visit = (node: SyntaxNode, parent: string | null, slot: number) => {
      if (nodes.has(node.id)) duplicates.add(node.id);
      nodes.set(node.id, { node, parent, slot });
      node.children?.forEach((child, childSlot) => visit(child, node.id, childSlot));
    };
    forest.forEach((node, slot) => visit(node, null, slot));
    return { nodes, duplicates };
  };
  const current = index(evidence.currentForest), prior = index(evidence.priorForest ?? []);
  const anchors = Object.values(relation.anchors).flat();
  if (anchors.some(id => !current.nodes.has(id) || current.duplicates.has(id))) return false;
  const unchanged = (id: string) => {
    const now = current.nodes.get(id), before = prior.nodes.get(id);
    return Boolean(now && before && !prior.duplicates.has(id) && now.parent === before.parent
      && now.slot === before.slot && JSON.stringify(now.node) === JSON.stringify(before.node));
  };
  const fields = evidence.authoredCurrentAnchors ?? [];
  const directional = fields.filter(entry => entry.concepts.some(concept =>
    concept === 'movement.source' || concept === 'movement.landing'));
  const witnesses = fields.filter(entry => entry.concepts.includes('movement.witness'));
  const identities = dispatch.facets.filter(facet => facet.recipe.id === 'identity.occurrences')
    .map(facet => (facet.evidence ?? evidence).currentAnchors.occurrences ?? []);
  const directedPair = directional.some(entry => entry.concepts.includes('movement.source'))
    && directional.some(entry => entry.concepts.includes('movement.landing'));
  // An established identity group can be restated in a later stage without
  // another movement owner. Exact content and parent/child slots must persist;
  // a directed pair still asserts movement and retains its refusal. One field
  // may list the group's distinct members, as do-support lists the lower copies
  // of T raised across the board, once their lineages gain and move no
  // occurrence in this stage: the listing then restates an earlier chain.
  const listed = [...directional, ...witnesses].some(entry => entry.items.length !== 1);
  const settledLineages = (ids: readonly string[]) => [...new Set(ids.map(id => current.nodes.get(id)?.node.lineageId))]
    .every(lineage => {
      const now = [...current.nodes.values()].filter(entry => entry.node.lineageId === lineage);
      return Boolean(lineage) && now.length === [...prior.nodes.values()].filter(entry => entry.node.lineageId === lineage).length
        && now.every(entry => {
          const before = prior.nodes.get(entry.node.id);
          return before && !current.duplicates.has(entry.node.id) && !prior.duplicates.has(entry.node.id)
            && before.parent === entry.parent && before.slot === entry.slot;
        });
    });
  if (!chainIdentity && evidence.movementFailure === 'MOVEMENT_ENDPOINTS_UNRESOLVED' && !directedPair
    && directional.length > 0 && [...directional, ...witnesses].every(entry => new Set(entry.items).size === entry.items.length)
    && identities.some(ids => ids.length > 1
      && new Set(ids).size === ids.length && ids.every(unchanged) && (!listed || settledLineages(ids))
      && [...directional, ...witnesses].every(entry => entry.items.every(id => ids.includes(id))))) return true;
  const earlierChain = (ids: readonly string[]) => earlierMovements.some(movement => {
    const members = new Set([movement.sourceNodeId, movement.targetNodeId, movement.witnessNodeId]);
    return movement.transition && ids.includes(movement.sourceNodeId) && ids.includes(movement.targetNodeId)
      && ids.every(id => members.has(id) || unchanged(id));
  });
  // A chain inventory can describe a transition already owned by an earlier
  // relation. Its name alone must not demand a second transition. Directed
  // endpoints and changed members without an earlier owner remain errors.
  // A pair directs one movement; head, foot and intermediate copies naming
  // several distinct lower occurrences inventory the chain's hops instead.
  const lowerCopies = new Set(directional.filter(entry => entry.concepts.includes('movement.source')).flatMap(entry => entry.items));
  if (chainIdentity) return evidence.movementFailure === 'MOVEMENT_ENDPOINTS_UNRESOLVED' && witnesses.length === 0
    && (directional.length === 0 || lowerCopies.size > 1
      && directional.every(entry => new Set(entry.items).size === entry.items.length))
    && identities.some(ids => ids.length > 1 && new Set(ids).size === ids.length
      && anchors.every(id => ids.includes(id) || unchanged(id))
      && directional.every(entry => entry.items.every(id => ids.includes(id)))
      && (ids.every(unchanged) || earlierChain(ids)));
  if (listed) return false;

  // A positional reference is not an instruction to move. A neutral claim may
  // name a base position alongside its independently established raised member.
  // Require exact lineage and either an earlier owner or unchanged prior slots;
  // an isolated source, a new landing, or two directed roles proves no context.
  const position = directional.length === 1 && witnesses.length === 0
    && directional[0].concepts.includes('movement.source')
    && /^(?:base|lower|thematic)\s*position$/i.test(directional[0].key)
    ? directional[0].items[0] : undefined;
  if (position && evidence.movementFailure === 'MOVEMENT_ENDPOINTS_UNRESOLVED') {
    const lineage = current.nodes.get(position)?.node.lineageId;
    const partners = [...new Set(anchors)].filter(id => id !== position && lineage
      && current.nodes.get(id)?.node.lineageId === lineage);
    if (partners.length === 1) {
      const ids = [position, partners[0]];
      if ((!identities.length || identities.some(group => ids.every(id => group.includes(id))))
        && anchors.every(id => ids.includes(id) || unchanged(id))
        && (ids.every(unchanged) || earlierChain(ids))) return true;
    }
  }
  // A claim naming only the landing of a movement an earlier claim of the stage
  // draws, such as pied-piping describing the moved phrase, states no second
  // movement. Its other anchors stay in place or travel inside that landing.
  const contains = (node: SyntaxNode, id: string): boolean => node.id === id
    || Boolean(node.children?.some(child => contains(child, id)));
  if (evidence.movementFailure === 'MOVEMENT_ENDPOINTS_UNRESOLVED' && !witnesses.length && directional.length
    && !Object.keys(relation.priorAnchors ?? {}).length
    && directional.every(entry => entry.concepts.includes('movement.landing') && !entry.concepts.includes('movement.source'))
    && earlierMovements.some(movement => {
      const landing = current.nodes.get(movement.targetNodeId)?.node;
      return movement.transition && landing
        && directional.every(entry => entry.items.every(id => id === movement.targetNodeId))
        && anchors.every(id => contains(landing, id) || unchanged(id));
    })) return true;
  if (!dispatch.facets.some(facet => ['identity.occurrences', 'binding.dependency'].includes(facet.recipe.id))) return false;

  const candidates = earlierMovements.filter(movement => movement.transition
    && anchors.includes(movement.sourceNodeId));
  if (evidence.movementFailure === 'MOVEMENT_TARGET_IS_LOWER_WITNESS') {
    return candidates.some(movement => !prior.nodes.has(movement.sourceNodeId)
      && Boolean(current.nodes.get(movement.sourceNodeId)?.node.lineageId)
      && identities.some(ids => ids.includes(movement.sourceNodeId)
        && ids.every(id => id === movement.sourceNodeId || unchanged(id))
        && ids.some(id => id !== movement.sourceNodeId && unchanged(id)
          && current.nodes.get(id)?.node.lineageId === current.nodes.get(movement.sourceNodeId)?.node.lineageId)
        && [...directional, ...witnesses].every(entry => entry.items.every(id => ids.includes(id)))));
  }

  // An explicitly directed new pair remains a movement assertion, even if
  // another claim in the envelope also earns an identity or binding drawing.
  if (directedPair) return false;
  // An occurrence sharing its lineage with no other occurrence cannot be an end
  // of any movement; a landing-like field naming it, such as a government
  // claim's head, cites context.
  const hasOtherOccurrence = (id: string): boolean => {
    const lineage = current.nodes.get(id)?.node.lineageId;
    return Boolean(lineage) && [...current.nodes.values(), ...prior.nodes.values()]
      .some(entry => entry.node.id !== id && entry.node.lineageId === lineage);
  };
  return candidates.some(movement => {
    const members = new Set([movement.sourceNodeId, movement.targetNodeId, movement.witnessNodeId]);
    return anchors.includes(movement.targetNodeId) && directional.length > 0
      && directional.every(entry => entry.items.every(id => members.has(id) || !hasOtherOccurrence(id)))
      && witnesses.every(entry => entry.items.every(id => members.has(id) || unchanged(id)
        && Boolean(current.nodes.get(id)?.node.lineageId)
        && current.nodes.get(id)?.node.lineageId !== current.nodes.get(movement.sourceNodeId)?.node.lineageId));
  });
}
