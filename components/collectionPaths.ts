import { featureRowKey, pathFeatureRow } from '../replay/relations/featureComposition.ts';
import { planItemRelationRefs, type RelationPlanItem } from '../replay/relations/renderPlanCompiler.ts';
import type { PlaqueRect } from '../replay/relations/plaquePlacement.ts';

type CollectionItem = Extract<RelationPlanItem, { kind: 'directed-path' }>;
export type CollectionPath = { d: string; item: CollectionItem; failureCue?: string[] | false };

/** Font metrics can change row height; the authored feature identifies its reserved port. */
export function collectionPathAttachment(box: PlaqueRect, item: CollectionItem) {
  const key = featureRowKey(pathFeatureRow(item));
  return box.collectionRows?.find(row => row.sourceNodeId === item.toNodeId && row.featureKey === key);
}

/** Within one plaque, identical dependency ink retains all visible owners. */
export function coalesceCollectionPaths(paths: CollectionPath[]): CollectionPath[] {
  const groups = new Map<string, CollectionPath>();
  for (const path of paths) {
    const key = JSON.stringify([path.item.pathStyle, path.item.fromNodeId, path.item.toNodeId, path.d, path.item.outcome === 'blocked']);
    const previous = groups.get(key);
    if (!previous) { groups.set(key, path); continue; }
    const refs = [...new Map([...planItemRelationRefs(previous.item), ...planItemRelationRefs(path.item)]
      .map(ref => [`${ref.stageIndex}:${ref.relationIndex}`, ref])).values()];
    groups.set(key, { d: path.d, item: { ...previous.item,
      relationRef: refs[0], composedRefs: refs.slice(1), coalescedRefs: [] } });
  }
  const failedComparisons = new Map<string, string[]>();
  return [...groups.values()].map(path => {
    const identity = path.item.tier2ClaimIdentity || path.item.canonicalClaimIdentity;
    if (path.item.outcome !== 'blocked' || !identity) return path;
    // Several property rows can describe one comparison. Its compiled claim,
    // exact participants and visible owners identify the shared failure cue.
    const owners = planItemRelationRefs(path.item).map(ref => `${ref.stageIndex}:${ref.relationIndex}`).sort();
    const key = JSON.stringify([identity, path.item.fromNodeId, path.item.toNodeId, owners]);
    const routes = failedComparisons.get(key);
    if (routes) {
      routes.push(path.d);
      return { ...path, failureCue: false };
    }
    const failureCue = [path.d];
    failedComparisons.set(key, failureCue);
    return { ...path, failureCue };
  });
}
