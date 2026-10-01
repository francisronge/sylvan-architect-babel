import type { DerivationStage } from '../../types.ts';
import { exactRealizationGroup, sameRealizationMembers } from '../realizationGroups.ts';
import type { NodePlaquePlanItem, RelationPlanItem } from './renderPlanCompiler.ts';

/** Link explicit group transfers to their still-live PF claims, including across unaltered stages. */
export function realizationPlatePredecessors(
  items: readonly RelationPlanItem[],
  stages: readonly DerivationStage[]
): Map<RelationPlanItem, string | undefined> {
  const plates = items.filter((item): item is NodePlaquePlanItem => item.kind === 'node-plaque'
    && item.tier2FacetId === 'pf.structured' && item.plaqueStyle === 'realization');
  const retired = new Set<RelationPlanItem>();
  const predecessors = new Map<RelationPlanItem, string | undefined>();
  const association = (item: NodePlaquePlanItem, stageIndex: number) => {
    const stage = stages[stageIndex];
    return stage && exactRealizationGroup(item.anchorNodeIds, stage.realizations, stage.workspaceForest);
  };
  for (const next of plates) {
    const stageIndex = next.appearsAtStage;
    const stage = stages[stageIndex], priorStage = stages[stageIndex - 1];
    if (!priorStage) continue;
    const currentGroup = association(next, stageIndex);
    const priorIds = Object.values(stage.relations[next.relationRef.relationIndex]?.priorAnchors ?? {}).flat();
    const priorGroup = exactRealizationGroup(priorIds, priorStage.realizations, priorStage.workspaceForest);
    if (!currentGroup || !priorGroup || !sameRealizationMembers(currentGroup.tokenIndices, priorGroup.tokenIndices)) continue;
    const candidates = plates.filter(previous => previous.appearsAtStage < stageIndex && !retired.has(previous)
      && sameRealizationMembers(previous.anchorNodeIds, priorGroup.nodeIds)
      && stages.slice(previous.appearsAtStage, stageIndex).every((_stage, offset) => {
        const group = association(previous, previous.appearsAtStage + offset);
        return group && sameRealizationMembers(group.tokenIndices, priorGroup.tokenIndices);
      }));
    // A complete transfer does not identify which of several independent PF
    // claims it replaces. Keep them until an exact predecessor is proved.
    const previous = candidates.length === 1 ? candidates[0] : undefined;
    predecessors.set(next, previous?.replacementGroup);
    if (previous) retired.add(previous);
  }
  return predecessors;
}
