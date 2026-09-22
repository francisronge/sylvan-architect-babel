import { featureRowKey, pathFeatureRow } from '../replay/relations/featureComposition.ts';
import { planItemRelationRefs, type RelationPlanItem } from '../replay/relations/renderPlanCompiler.ts';
import type { PlaqueRect } from '../replay/relations/plaquePlacement.ts';

type CollectionItem = Extract<RelationPlanItem, { kind: 'directed-path' }>;
export type CollectionPath = { d: string; item: CollectionItem };

/** Font metrics can change row height; the authored feature identifies its reserved port. */
export function collectionPathAttachment(box: PlaqueRect, item: CollectionItem) {
  const key = featureRowKey(pathFeatureRow(item));
  return box.collectionRows?.find(row => row.sourceNodeId === item.toNodeId && row.featureKey === key);
}

/** Within one plaque, identical ink for the same endpoints retains all visible owners. */
export function coalesceCollectionPaths(paths: CollectionPath[]): CollectionPath[] {
  const groups = new Map<string, CollectionPath>();
  for (const path of paths) {
    const key = JSON.stringify([path.item.fromNodeId, path.item.toNodeId, path.d]);
    const previous = groups.get(key);
    if (!previous) { groups.set(key, path); continue; }
    const refs = [...new Map([...planItemRelationRefs(previous.item), ...planItemRelationRefs(path.item)]
      .map(ref => [`${ref.stageIndex}:${ref.relationIndex}`, ref])).values()];
    groups.set(key, { d: path.d, item: { ...previous.item,
      relationRef: refs[0], composedRefs: refs.slice(1), coalescedRefs: [] } });
  }
  return [...groups.values()];
}
