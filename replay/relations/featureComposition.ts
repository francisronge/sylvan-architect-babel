import { planItemRelationRefs, planItemsShareAuthoredStage, type DirectedPathPlanItem,
  type NodePlaquePlanItem, type RelationPlanItem } from './renderPlanCompiler.ts';

type Entry<T> = { item: T; index: number };
export type FeatureRow = { label: string; value: string };
export const featureRowKey = (row: FeatureRow) => JSON.stringify([row.label, row.value]);
export const pathFeatureRow = (item: DirectedPathPlanItem): FeatureRow =>
  item.featureRow ?? { label: '', value: item.label ?? '' };

/** One relation moment can describe several collections on one host. Combine
 * their physical plaque while keeping each row's exact claim-to-path binding.
 * Different moments and replacement lifetimes remain separate. */
export function composeFeatureBundles(items: RelationPlanItem[]): RelationPlanItem[] {
  const groups = new Map<string, NodePlaquePlanItem[]>();
  for (const item of items) {
    if (item.kind !== 'node-plaque' || item.plaqueStyle !== 'feature' || !item.tier2ClaimIdentity
      || item.backward || item.rowRefs || item.anchorNodeIds.length !== 1) continue;
    const moments = [...new Set(planItemRelationRefs(item).map(ref => `${ref.stageIndex}:${ref.relationIndex}`))].sort();
    const key = JSON.stringify([item.anchorNodeIds, moments, item.supersededAt, item.title, item.positionNodeIds]);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const replacements = new Map<RelationPlanItem, NodePlaquePlanItem>();
  const removed = new Set<RelationPlanItem>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const rows = new Map<string, { row: FeatureRow; claims: Set<string> }>();
    for (const item of group) item.rows.forEach((row, index) => {
      const key = featureRowKey(row), entry = rows.get(key) ?? { row, claims: new Set<string>() };
      (item.featureRowClaims?.[index] ?? [item.tier2ClaimIdentity!]).forEach(claim => entry.claims.add(claim));
      rows.set(key, entry);
    });
    const [first, ...rest] = group;
    replacements.set(first, { ...first,
      rows: [...rows.values()].map(entry => entry.row),
      featureRowClaims: [...rows.values()].map(entry => [...entry.claims]),
      tier2WitnessNodeIds: [...new Set(group.flatMap(item => item.tier2WitnessNodeIds ?? []))],
      tier2OutputIdentities: [...new Set(group.flatMap(item => item.tier2OutputIdentities ?? []))]
    });
    rest.forEach(item => removed.add(item));
  }
  return items.filter(item => !removed.has(item)).map(item => replacements.get(item) ?? item);
}

/** Exact claim ownership wins over a coincidentally nearby bundle. */
export function collectionPlaque(items: RelationPlanItem[], path: DirectedPathPlanItem) {
  const row = pathFeatureRow(path);
  const bundles = items.flatMap((item, index): Entry<NodePlaquePlanItem>[] =>
    item.kind === 'node-plaque' && item.plaqueStyle === 'feature'
      && item.anchorNodeIds[0] === path.fromNodeId && planItemsShareAuthoredStage(item, path)
      && item.rows.some(candidate => featureRowKey(candidate) === featureRowKey(row)) ? [{ item, index }] : []);
  const owned = bundles.filter(({ item }) => (item.featureRowClaims
    ? item.rows.some((candidate, index) => featureRowKey(candidate) === featureRowKey(row)
      && Boolean(path.tier2ClaimIdentity && item.featureRowClaims![index].includes(path.tier2ClaimIdentity)))
    : item.tier2ClaimIdentity === path.tier2ClaimIdentity)
    && planItemRelationRefs(item).some(a => planItemRelationRefs(path)
      .some(b => a.stageIndex === b.stageIndex && a.relationIndex === b.relationIndex)));
  return owned.length === 1 ? owned[0] : bundles.length === 1 ? bundles[0] : undefined;
}

/** A collection can share Case's bearer, or describe the same assigner–recipient pair. */
export function collectionAssignment(items: RelationPlanItem[], path: DirectedPathPlanItem): number | undefined {
  const assignment = uniqueCollectionAssignment(items, path);
  if (assignment === undefined) return undefined;
  const bundle = collectionPlaque(items, path);
  // A physical bundle cannot be split between Case plaques and a standalone
  // plaque. All its rows must share the same Case attachment to join it.
  if (bundle && items.some(candidate => candidate.kind === 'directed-path' && candidate.pathStyle === 'case-agree'
    && collectionPlaque(items, candidate)?.index === bundle.index
    && uniqueCollectionAssignment(items, candidate) !== assignment)) return undefined;
  return assignment;
}

function uniqueCollectionAssignment(items: RelationPlanItem[], path: DirectedPathPlanItem): number | undefined {
  const candidates = items.flatMap((item, index) => item.kind === 'directed-path'
    && item.pathStyle === 'case-assignment' && planItemsShareAuthoredStage(item, path)
    && (item.toNodeId === path.fromNodeId
      || (item.fromNodeId === path.fromNodeId && item.toNodeId === path.toNodeId)) ? [index] : []);
  if (candidates.length !== 1) return undefined;
  const assignment = items[candidates[0]] as DirectedPathPlanItem;
  const incoming = items.filter(item => item.kind === 'directed-path' && item.pathStyle === 'case-assignment'
    && item.toNodeId === assignment.toNodeId && planItemsShareAuthoredStage(item, assignment));
  return incoming.length === 1 ? candidates[0] : undefined;
}

/** Physical grouping never changes a row's semantic owner or its contributing relation moments. */
export function caseFeatureComposition(items: RelationPlanItem[], assignmentIndex: number) {
  const assignment = items[assignmentIndex];
  if (assignment?.kind !== 'directed-path' || assignment.pathStyle !== 'case-assignment') return undefined;
  const incoming = items.filter(item => item.kind === 'directed-path' && item.pathStyle === 'case-assignment'
    && item.toNodeId === assignment.toNodeId && planItemsShareAuthoredStage(item, assignment));
  const collections = incoming.length !== 1 ? [] : items.flatMap((item, index): Entry<DirectedPathPlanItem>[] =>
    item.kind === 'directed-path' && item.pathStyle === 'case-agree'
      && collectionAssignment(items, item) === assignmentIndex ? [{ item, index }] : []);
  const paired = collections.some(({ item }) => item.fromNodeId === assignment.fromNodeId
    && item.toNodeId === assignment.toNodeId);
  const outgoing = items.filter(item => item.kind === 'directed-path' && item.pathStyle === 'case-assignment'
    && item.fromNodeId === assignment.fromNodeId && planItemsShareAuthoredStage(item, assignment));
  const bundles = incoming.length !== 1 ? [] : items.flatMap((item, index): Entry<NodePlaquePlanItem>[] => {
    if (item.kind !== 'node-plaque' || item.plaqueStyle !== 'feature'
      || !planItemsShareAuthoredStage(item, assignment)) return [];
    const ownedCollections = items.filter(candidate => candidate.kind === 'directed-path'
      && candidate.pathStyle === 'case-agree' && collectionPlaque(items, candidate)?.index === index);
    // A bundle already connected elsewhere cannot be borrowed by a nearby Case plaque.
    if (ownedCollections.length && !ownedCollections.every(candidate =>
      collections.some(entry => entry.item === candidate))) return [];
    const anchor = item.anchorNodeIds[0];
    return ownedCollections.length > 0 || anchor === assignment.toNodeId
      || (paired && outgoing.length === 1 && anchor === assignment.fromNodeId) ? [{ item, index }] : [];
  });
  const rows: Array<FeatureRow & { ownerNodeId: string; sourceNodeId?: string; ownerIndices: number[] }> = [];
  const add = (row: FeatureRow, ownerNodeId: string, index: number, sourceNodeId?: string) => {
    const candidates = rows.filter(candidate => candidate.ownerNodeId === ownerNodeId
      && featureRowKey(candidate) === featureRowKey(row)
      && (!sourceNodeId || !candidate.sourceNodeId || candidate.sourceNodeId === sourceNodeId));
    const existing = candidates.length === 1 ? candidates[0] : undefined;
    if (existing) {
      if (!existing.ownerIndices.includes(index)) existing.ownerIndices.push(index);
      if (sourceNodeId) existing.sourceNodeId = sourceNodeId;
    } else rows.push({ ...row, ownerNodeId, sourceNodeId, ownerIndices: [index] });
  };
  const caseRow = pathFeatureRow(assignment);
  add({ ...caseRow, label: caseRow.label || 'Case' }, assignment.toNodeId, assignmentIndex);
  collections.forEach(({ item, index }) => add(pathFeatureRow(item), item.fromNodeId, index, item.toNodeId));
  bundles.forEach(({ item, index }) => item.rows.forEach(row => {
    const sources = collections.filter(entry => collectionPlaque(items, entry.item)?.index === index
      && featureRowKey(pathFeatureRow(entry.item)) === featureRowKey(row));
    add(row, item.anchorNodeIds[0], index, sources.length === 1 ? sources[0].item.toNodeId : undefined);
  }));
  const firstOwner = (row: typeof rows[number]) => row.ownerIndices.flatMap(index => planItemRelationRefs(items[index]))
    .sort((a, b) => a.stageIndex - b.stageIndex || a.relationIndex - b.relationIndex)[0];
  rows.sort((a, b) => {
    const left = firstOwner(a), right = firstOwner(b);
    return left.stageIndex - right.stageIndex || left.relationIndex - right.relationIndex;
  });
  return { assignment, assignmentIndex, bundles, collections, rows };
}

export function featurePlaqueAssignment(items: RelationPlanItem[], plaqueIndex: number): number | undefined {
  const candidates = items.flatMap((_, i) => caseFeatureComposition(items, i)?.bundles
    .some(bundle => bundle.index === plaqueIndex) ? [i] : []);
  return candidates.length === 1 ? candidates[0] : undefined;
}
