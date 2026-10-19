import type { NodePlaquePlanItem, PlanRelationRef, RelationPlanItem } from './renderPlan.ts';
import { planItemRelationRefs } from './renderPlan.ts';

type Grid = NodePlaquePlanItem & { thetaRoles: NonNullable<NodePlaquePlanItem['thetaRoles']> };
const isGrid = (item: RelationPlanItem): item is Grid => item.kind === 'node-plaque'
  && item.plaqueStyle === 'theta-grid' && Boolean(item.thetaRoles?.length);
const rowKey = (role: Grid['thetaRoles'][number]) => JSON.stringify([role.nodeId, role.label, role.index]);
const drawingKey = (item: RelationPlanItem) => JSON.stringify([
  item.relationRef.stageIndex, item.relationRef.relationIndex, item.tier2ClaimIdentity ?? null
]);
const uniqueRefs = (refs: PlanRelationRef[]) => refs.filter((ref, i) => refs.findIndex(other =>
  other.stageIndex === ref.stageIndex && other.relationIndex === ref.relationIndex) === i);

const precedes = (left: PlanRelationRef, right: PlanRelationRef) => left.stageIndex < right.stageIndex
  || left.stageIndex === right.stageIndex && left.relationIndex < right.relationIndex;

/** The moment in this frame's stage at which a badge's grid first composes,
 * or undefined when the badge yields from the stage's start. A grid composes
 * once the badge's own relation and a contributor have both played, so a
 * contributor before the badge composes it at the badge's own moment: the
 * badge never shows apart from the grid. A composition from an earlier stage
 * stays effective when a later stage restates its contributors. Only another
 * contributing grid composes with it: an identical restatement of the
 * badge's own claim was coalesced into its grid before composition and
 * composes nothing. */
const composingMoment = (badge: RelationPlanItem, group: readonly Grid[], frameIndex: number) => {
  const own = badge.relationRef, ownRefs = planItemRelationRefs(badge);
  const refs = uniqueRefs(group.filter(grid => drawingKey(grid) !== drawingKey(badge)).flatMap(planItemRelationRefs))
    .filter(ref => !ownRefs.some(other => other.stageIndex === ref.stageIndex && other.relationIndex === ref.relationIndex));
  if (refs.some(ref => !precedes(own, ref) || ref.stageIndex < frameIndex)) return undefined;
  return refs.filter(ref => ref.stageIndex === frameIndex).sort((left, right) => left.relationIndex - right.relationIndex)[0];
};

/** Combine overlapping inventories of the same exact predicate. Each row keeps
 * its own authored moments; neither whole relations nor their history merge.
 * The composed grid replaces its contributors' theta badges. A badge that was
 * already on screen yields at the moment of the relation that composes with
 * it, not at the start of that relation's stage. */
export function composeThetaGrids(items: RelationPlanItem[], predicateLineage: (grid: Grid) => string | undefined,
  frameIndex: number): RelationPlanItem[] {
  const groups: Grid[][] = [];
  for (const item of items) {
    if (!isGrid(item) || item.backward || new Set(item.thetaRoles.map(role => role.nodeId)).size !== item.thetaRoles.length) continue;
    const compatible = groups.filter(group => {
      const first = group[0];
      if (predicateLineage(first) !== predicateLineage(item)
        || JSON.stringify(first.anchorNodeIds) !== JSON.stringify(item.anchorNodeIds)
        || JSON.stringify(first.supersededAt) !== JSON.stringify(item.supersededAt)) return false;
      const rows = group.flatMap(grid => grid.thetaRoles);
      return rows.some(row => item.thetaRoles.some(other => rowKey(row) === rowKey(other)))
        && rows.every(row => item.thetaRoles.every(other => row.nodeId !== other.nodeId || rowKey(row) === rowKey(other)));
    });
    // Different existing inventories must also agree with one another.
    const rows = [...compatible.flat().flatMap(grid => grid.thetaRoles), ...item.thetaRoles];
    if (rows.some(row => rows.some(other => row.nodeId === other.nodeId && rowKey(row) !== rowKey(other)))) continue;
    if (!compatible.length) groups.push([item]);
    else {
      const merged = compatible.flat().concat(item);
      compatible.forEach(group => groups.splice(groups.indexOf(group), 1));
      groups.push(merged);
    }
  }
  const replacements = new Map<RelationPlanItem, RelationPlanItem>();
  const removed = new Set<RelationPlanItem>();
  for (const group of groups.filter(group => group.length > 1)) {
    group.sort((left, right) => items.indexOf(left) - items.indexOf(right));
    const [first] = group;
    const roles = new Map<string, Grid['thetaRoles'][number]>();
    for (const grid of group) for (const role of grid.thetaRoles) {
      const key = rowKey(role), prior = roles.get(key);
      roles.set(key, { ...role, relationRefs: uniqueRefs([...(prior?.relationRefs ?? []), ...planItemRelationRefs(grid)]) });
    }
    const thetaRoles = [...roles.values()];
    const refs = uniqueRefs(group.flatMap(planItemRelationRefs));
    const grid: Grid = { ...first, thetaRoles, rows: thetaRoles.map(role => ({ label: role.label, value: '' })),
      coalescedRefs: [], composedRefs: refs.filter(ref => ref !== first.relationRef),
      // Dependencies now belong to the displayed rows, rather than a contributor's full inventory.
      tier2WitnessNodeIds: [] };
    replacements.set(first, grid);
    group.slice(1).forEach(item => removed.add(item));
    const keys = new Set(group.map(drawingKey));
    const badges = items.filter(item => item.kind === 'node-badges' && item.badgeStyle === 'theta-role' && keys.has(drawingKey(item)));
    badges.forEach(item => {
      const yieldAt = composingMoment(item, group, frameIndex), prior = item.supersededAt;
      if (!yieldAt) removed.add(item);
      else if (!(prior?.stageIndex === frameIndex && prior.relationIndex <= yieldAt.relationIndex))
        replacements.set(item, { ...item, supersededAt: yieldAt });
    });
  }
  return items.filter(item => !removed.has(item)).map(item => replacements.get(item) ?? item);
}

/** Reserve the complete inventory, but paint only rows whose relation has played. */
export function projectThetaGrid(item: RelationPlanItem, frameIndex: number,
  played: ReadonlySet<number> | null): RelationPlanItem {
  if (!isGrid(item) || !item.thetaRoles.some(role => role.relationRefs)) return item;
  const thetaRoles = item.thetaRoles.flatMap(role => {
    const relationRefs = role.relationRefs?.filter(ref => played === null || ref.stageIndex < frameIndex
      || (ref.stageIndex === frameIndex && played.has(ref.relationIndex)));
    return relationRefs?.length ? [{ ...role, relationRefs }] : [];
  });
  return { ...item, thetaRoles, rows: thetaRoles.map(role => ({ label: role.label, value: '' })) };
}
