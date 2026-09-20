import { planItemRelationRefs, planItemsShareAuthoredStage, type DirectedPathPlanItem,
  type NodePlaquePlanItem, type RelationPlanItem } from './renderPlanCompiler.ts';

type Entry<T> = { item: T; index: number };
export type FeatureRow = { label: string; value: string };
export const featureRowKey = (row: FeatureRow) => JSON.stringify([row.label, row.value]);
export const pathFeatureRow = (item: DirectedPathPlanItem): FeatureRow =>
  item.featureRow ?? { label: '', value: item.label ?? '' };

/** Exact claim ownership wins over a coincidentally nearby bundle. */
export function collectionPlaque(items: RelationPlanItem[], path: DirectedPathPlanItem) {
  const row = pathFeatureRow(path);
  const bundles = items.flatMap((item, index): Entry<NodePlaquePlanItem>[] =>
    item.kind === 'node-plaque' && item.plaqueStyle === 'feature'
      && item.anchorNodeIds[0] === path.fromNodeId && planItemsShareAuthoredStage(item, path)
      && item.rows.some(candidate => featureRowKey(candidate) === featureRowKey(row)) ? [{ item, index }] : []);
  const owned = bundles.filter(({ item }) => item.tier2ClaimIdentity === path.tier2ClaimIdentity
    && planItemRelationRefs(item).some(a => planItemRelationRefs(path)
      .some(b => a.stageIndex === b.stageIndex && a.relationIndex === b.relationIndex)));
  return owned.length === 1 ? owned[0] : bundles.length === 1 ? bundles[0] : undefined;
}

/** Case and collection meet at the same bearer, within an authored stage. */
export function caseFeatureComposition(items: RelationPlanItem[], assignmentIndex: number) {
  const assignment = items[assignmentIndex];
  if (assignment?.kind !== 'directed-path' || assignment.pathStyle !== 'case-assignment') return undefined;
  const assignments = items.filter(item => item.kind === 'directed-path' && item.pathStyle === 'case-assignment'
    && item.toNodeId === assignment.toNodeId && planItemsShareAuthoredStage(item, assignment));
  const bundles = items.flatMap((item, index): Entry<NodePlaquePlanItem>[] =>
    item.kind === 'node-plaque' && item.plaqueStyle === 'feature'
      && item.anchorNodeIds[0] === assignment.toNodeId && planItemsShareAuthoredStage(item, assignment)
      ? [{ item, index }] : []);
  const bundle = assignments.length === 1 && bundles.length === 1 ? bundles[0] : undefined;
  const collections = items.flatMap((item, index): Entry<DirectedPathPlanItem>[] =>
    item.kind === 'directed-path' && item.pathStyle === 'case-agree' && assignments.length === 1
      && item.fromNodeId === assignment.toNodeId && planItemsShareAuthoredStage(item, assignment)
      && (!collectionPlaque(items, item) || collectionPlaque(items, item)?.index === bundle?.index)
      ? [{ item, index }] : []);
  const rows: Array<FeatureRow & { ownerIndices: number[] }> = [];
  const add = (row: FeatureRow, index: number) => {
    const existing = rows.find(candidate => featureRowKey(candidate) === featureRowKey(row));
    if (existing) {
      if (!existing.ownerIndices.includes(index)) existing.ownerIndices.push(index);
    } else rows.push({ ...row, ownerIndices: [index] });
  };
  add(pathFeatureRow(assignment), assignmentIndex);
  collections.forEach(({ item, index }) => add(pathFeatureRow(item), index));
  bundle?.item.rows.forEach(row => add(row, bundle.index));
  return { assignment, assignmentIndex, bundle, collections, rows };
}

export function featurePlaqueAssignment(items: RelationPlanItem[], plaqueIndex: number): number | undefined {
  const index = items.findIndex((_, i) => caseFeatureComposition(items, i)?.bundle?.index === plaqueIndex);
  return index < 0 ? undefined : index;
}
