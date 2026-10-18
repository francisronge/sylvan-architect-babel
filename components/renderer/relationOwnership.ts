import {
  planItemDependencyNodeIds,
  planItemRelationRefs,
  type RelationPlanItem
} from '../../replay/relations/renderPlan.ts';
import type { DrawingLayer, RelationEmphasis } from './drawingContext.ts';

interface RelationOwnershipContext {
  deferredAcceptedRelationDraws: (() => void)[];
  g: DrawingLayer;
}
export const relationLayerKey = (item: RelationPlanItem) =>
  JSON.stringify([item.relationRef.stageIndex, item.relationRef.relationIndex, item.tier2ClaimIdentity ?? null]);
export const acceptedRelationDrawingKey = (item: RelationPlanItem) =>
  JSON.stringify([relationLayerKey(item), item.familyId]);
export const decorateRelationElement = (
  element: SVGElement,
  item: RelationPlanItem,
  emphasis: RelationEmphasis
) => {
  element.classList.add('vr-item');
  element.setAttribute('data-vr-stage-index', String(item.relationRef.stageIndex));
  element.setAttribute('data-vr-relation-index', String(item.relationRef.relationIndex));
  element.setAttribute(
    'data-vr-owner-refs',
    planItemRelationRefs(item)
      .map((ref) => `${ref.stageIndex}:${ref.relationIndex}`)
      .join(' ')
  );
  element.setAttribute('data-vr-emphasis', emphasis ?? 'none');
  // A step glide moves a mark with the nodes it is bound to.
  element.setAttribute('data-vr-node-ids', JSON.stringify(planItemDependencyNodeIds(item)));
  element.classList.toggle('vr-relation-active', emphasis === 'active');
  return element;
};

export function createRelationOwnership({ deferredAcceptedRelationDraws, g }: RelationOwnershipContext) {
  const queueAcceptedRelationDraw = (
    item: RelationPlanItem,
    emphasis: RelationEmphasis,
    draw: () => void
  ) => {
    deferredAcceptedRelationDraws.push(() => {
      const before = new Set(g.selectAll<SVGElement, unknown>('*').nodes());
      draw();
      const after = g.selectAll<SVGElement, unknown>('*').nodes();
      const added = new Set(after.filter((element) => !before.has(element)));
      const excludedContainers = new Set([
        'defs',
        'marker',
        'clippath',
        'filter',
        'lineargradient',
        'radialgradient',
        'stop'
      ]);
      const isSharedRelationContainer = (element: SVGElement) => [
        'babel-feature-relation-layer',
        'babel-agreement-case-relation-layer',
        'babel-case-feature-plaque',
        'babel-domain-locality-relation-layer'
      ].some((className) => element.classList.contains(className));
      after.forEach((element) => {
        if (!added.has(element)) return;
        if (excludedContainers.has(element.tagName.toLowerCase())) return;
        if (isSharedRelationContainer(element)) return;
        if (element.hasAttribute('data-vr-stage-index')) return;
        if (
          element.parentElement instanceof SVGElement
          && added.has(element.parentElement)
          && !isSharedRelationContainer(element.parentElement)
        ) return;
        decorateRelationElement(element, item, emphasis);
      });
    });
  };
  return { queueAcceptedRelationDraw };
}
