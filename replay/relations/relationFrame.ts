/** Project already compiled marks for one frame without reinterpreting their authored claims. */
import {
  isPlanItemRevealed,
  type AnchorSetPlanItem,
  type RelationPlanItem,
  type RelationRenderPlan
} from './renderPlan.ts';
import { projectThetaGrid } from './thetaGridComposition.ts';


/** Combine organization only after each owner has earned this frame. Before
 * Replay filtering, different lifetimes remain separate; afterward their
 * co-visible entries share one rail per exact authored role. */
export const mergeAnchorSetOrganization = (items: RelationPlanItem[], visible: boolean): RelationPlanItem[] => {
  const result: RelationPlanItem[] = [];
  const groups = new Map<string, AnchorSetPlanItem>();
  for (const item of items) {
    if (item.kind !== 'anchor-set' || !item.organizationOwners) { result.push(item); continue; }
    const key = JSON.stringify([item.set.stageIndex, item.set.relationIndex, item.set.instanceIndex,
      ...(visible ? [] : [item.persistence, item.supersededAt, item.backward, item.showBadges, item.badgeSize])]);
    const ownBadges = item.badgeEntries ?? (item.showBadges ? item.set.roles.flatMap(role =>
      role.anchors.map(anchor => ({ roleIndex: role.roleIndex, arrayIndex: anchor.arrayIndex, badgeSize: item.badgeSize }))) : []);
    let holder = groups.get(key);
    if (!holder) {
      holder = { ...item, organizationOwners: [...item.organizationOwners], badgeEntries: ownBadges.map(entry => ({ ...entry })),
        tier2WitnessNodeIds: [...(item.tier2WitnessNodeIds ?? [])],
        set: { ...item.set, roles: item.set.roles.map(role => ({ ...role, anchors: [...role.anchors] })) } };
      groups.set(key, holder);
      result.push(holder);
      continue;
    }
    for (const role of item.set.roles) {
      const existing = holder.set.roles.find(candidate => candidate.roleIndex === role.roleIndex);
      if (!existing) { holder.set.roles.push({ ...role, anchors: [...role.anchors] }); continue; }
      for (const anchor of role.anchors) {
        if (!existing.anchors.some(candidate => candidate.arrayIndex === anchor.arrayIndex && candidate.nodeId === anchor.nodeId)) {
          existing.anchors.push(anchor);
        }
      }
      existing.anchors.sort((left, right) => left.arrayIndex - right.arrayIndex);
    }
    holder.set.roles.sort((left, right) => left.roleIndex - right.roleIndex);
    for (const badge of ownBadges) {
      const existingBadge = holder.badgeEntries!.find(candidate => candidate.roleIndex === badge.roleIndex && candidate.arrayIndex === badge.arrayIndex);
      if (!existingBadge) holder.badgeEntries!.push({ ...badge });
      else if (badge.badgeSize === 'standard') existingBadge.badgeSize = 'standard';
    }
    holder.badgeEntries!.sort((a, b) => a.roleIndex - b.roleIndex || a.arrayIndex - b.arrayIndex);
    holder.organizationOwners = [...new Set([...holder.organizationOwners!, ...item.organizationOwners])].sort();
    holder.tier2WitnessNodeIds = [...new Set([...holder.tier2WitnessNodeIds!, ...(item.tier2WitnessNodeIds ?? [])])];
    holder.priorWitnessNodeIds = [...new Set([...holder.priorWitnessNodeIds, ...item.priorWitnessNodeIds])];
    holder.occurrenceTransfers = [...new Map([...(holder.occurrenceTransfers ?? []), ...(item.occurrenceTransfers ?? [])]
      .map(transfer => [JSON.stringify(transfer), transfer])).values()];
    holder.showBadges ||= item.showBadges;
    if ((item.claimTier ?? 4) < (holder.claimTier ?? 4)) {
      holder.claimTier = item.claimTier;
      holder.persistence = item.persistence;
    }
  }
  for (const item of result) {
    if (item.kind !== 'anchor-set' || !item.organizationOwners || !item.badgeEntries) continue;
    const entryCount = item.set.roles.reduce((count, role) => count + role.anchors.length, 0);
    item.showBadges = item.badgeEntries.length > 0;
    if (!item.showBadges || item.badgeEntries.length === entryCount
      && item.badgeEntries.every(entry => !entry.badgeSize || entry.badgeSize === item.badgeSize)) delete item.badgeEntries;
  }
  return result;
};


/** Native painting binds the complete frame to retain allocation and plaque
 * indices. Compose only its visible organization in place; hidden items keep
 * their allocation, and emptied companion slots never shift another index. */
export const projectVisibleAnchorSetOrganization = (
  items: RelationPlanItem[],
  isVisible: (item: RelationPlanItem, itemIndex: number) => boolean
): RelationPlanItem[] => {
  const groups = new Map<string, number[]>();
  items.forEach((item, index) => {
    if (item.kind !== 'anchor-set' || !item.organizationOwners || !isVisible(item, index)) return;
    const key = JSON.stringify([item.set.stageIndex, item.set.relationIndex, item.set.instanceIndex]);
    const group = groups.get(key) ?? [];
    group.push(index);
    groups.set(key, group);
  });
  const projected = [...items];
  groups.forEach(indices => {
    if (indices.length < 2) return;
    const [holder, ...companions] = indices;
    projected[holder] = mergeAnchorSetOrganization(indices.map(index => items[index]), true)[0];
    for (const index of companions) {
      const item = items[index] as AnchorSetPlanItem;
      projected[index] = { ...item, set: { ...item.set, roles: [] },
        tier2WitnessNodeIds: [], badgeEntries: [], organizationOwners: [] };
    }
  });
  return projected;
};


export const visiblePlanFrameItems = (
  plan: RelationRenderPlan,
  frameIndex: number,
  playedRelationIndices: ReadonlySet<number> | null,
  activeRelationIndex: number | null = null
): RelationPlanItem[] => mergeAnchorSetOrganization((plan.frames[frameIndex]?.items ?? []).filter(item =>
  isPlanItemRevealed(item, frameIndex, playedRelationIndices, activeRelationIndex))
  .map(item => projectThetaGrid(item, frameIndex, playedRelationIndices)), true);
