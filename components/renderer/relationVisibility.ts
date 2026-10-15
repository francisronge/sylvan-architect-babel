import type { BoundPrimitive, PlanPositionProvider } from '../../replay/relations/boundGeometry.ts';
import { planItemDependencyNodeIds, type RelationPlanItem } from '../../replay/relations/renderPlan.ts';

/** Specialized marks require all witnesses; neutral fallback participation is independent. */
export function createPrimitiveVisibility(frameItems: readonly RelationPlanItem[], resolveOverlayAnchor: PlanPositionProvider) {
  const witnessVisibilityCache = new Map<number, boolean>();
  const itemWitnessesVisible = (planItemIndex: number): boolean => {
    const cached = witnessVisibilityCache.get(planItemIndex);
    if (cached !== undefined) return cached;
    const planItem = frameItems[planItemIndex];
    // A mark never draws on hidden syntax: every node id it depends on
    // must currently resolve against visible structure.
    const visible = Boolean(planItem)
      && planItemDependencyNodeIds(planItem).every((nodeId) => Boolean(resolveOverlayAnchor(nodeId)));
    witnessVisibilityCache.set(planItemIndex, visible);
    return visible;
  };
  const primitiveWitnessesVisible = (primitive: BoundPrimitive): boolean => {
    // Neutral participation is independent; a connector still needs both endpoints.
    if (frameItems[primitive.itemIndex]?.kind === 'fallback') {
      if (primitive.type === 'fallback-mark') return Boolean(resolveOverlayAnchor(primitive.nodeId));
      if (primitive.type === 'segment') {
        return primitive.witnessNodeIds.every(nodeId => Boolean(resolveOverlayAnchor(nodeId)));
      }
    }
    return itemWitnessesVisible(primitive.itemIndex);
  };

  return primitiveWitnessesVisible;
}
