import type { DerivationStageRelation, SyntaxNode } from '../../types.ts';
import type { RecoveredMovement } from './movementEvidence.ts';
import type { RelationClaimDispatch } from './tier2RelationDispatch.ts';
import { foldMovementIdentityKey, isMovementIdentity } from './movementIdentities.ts';
import { findRelationRegistryEntry, productionRelationRegistry } from '../relationDispatch/index.js';

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
  if (evidence.movement || !['MOVEMENT_ENDPOINTS_UNRESOLVED', 'MOVEMENT_WITNESS_OUTSIDE_SOURCE',
    'MOVEMENT_TARGET_IS_LOWER_WITNESS'].includes(evidence.movementFailure ?? '')
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
  if ([...directional, ...witnesses].some(entry => entry.items.length !== 1)) return false;
  const identities = dispatch.facets.filter(facet => facet.recipe.id === 'identity.occurrences')
    .map(facet => (facet.evidence ?? evidence).currentAnchors.occurrences ?? []);
  const directedPair = directional.some(entry => entry.concepts.includes('movement.source'))
    && directional.some(entry => entry.concepts.includes('movement.landing'));
  const earlierChain = (ids: readonly string[]) => earlierMovements.some(movement => {
    const members = new Set([movement.sourceNodeId, movement.targetNodeId, movement.witnessNodeId]);
    return movement.transition && ids.includes(movement.sourceNodeId) && ids.includes(movement.targetNodeId)
      && ids.every(id => members.has(id) || unchanged(id));
  });
  // A chain inventory can describe a transition already owned by an earlier
  // relation. Its name alone must not demand a second transition. Directed
  // endpoints and changed members without an earlier owner remain errors.
  if (chainIdentity) return evidence.movementFailure === 'MOVEMENT_ENDPOINTS_UNRESOLVED'
    && directional.length === 0 && witnesses.length === 0
    && identities.some(ids => ids.length > 1 && new Set(ids).size === ids.length
      && anchors.every(id => ids.includes(id) || unchanged(id))
      && (ids.every(unchanged) || earlierChain(ids)));

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
  if (!dispatch.facets.some(facet => ['identity.occurrences', 'binding.dependency'].includes(facet.recipe.id))) return false;
  // An established identity group can be restated in a later stage without
  // another movement owner. Exact content and parent/child slots must persist;
  // a directed pair still asserts movement and retains its refusal.
  if (evidence.movementFailure === 'MOVEMENT_ENDPOINTS_UNRESOLVED' && !directedPair
    && directional.length > 0 && identities.some(ids => ids.length > 1
      && new Set(ids).size === ids.length && ids.every(unchanged)
      && [...directional, ...witnesses].every(entry => entry.items.every(id => ids.includes(id))))) return true;

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
  return candidates.some(movement => {
    const members = new Set([movement.sourceNodeId, movement.targetNodeId, movement.witnessNodeId]);
    return anchors.includes(movement.targetNodeId) && directional.length > 0
      && directional.every(entry => entry.items.every(id => members.has(id)))
      && witnesses.every(entry => entry.items.every(id => members.has(id) || unchanged(id)
        && Boolean(current.nodes.get(id)?.node.lineageId)
        && current.nodes.get(id)?.node.lineageId !== current.nodes.get(movement.sourceNodeId)?.node.lineageId));
  });
}
