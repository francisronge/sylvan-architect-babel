import type { DerivationStage, DerivationStageRelation } from '../types.ts';
import { projectRelationStages } from './relationStages.ts';
import { dispatchRelationStagesForPlan } from './relations/renderPlanCompiler.ts';

export type JevClaim = { id: string; stageIndex: number; relationIndex: number; relation: DerivationStageRelation };

/** The claims Jev is asked about: those recognition leaves wholly neutral,
 * as Replay dispatches them. A relation with a contract failure is not asked. */
export const neutralJevClaims = (derivationStages: DerivationStage[]): JevClaim[] => {
  const { stages, dispatches } = dispatchRelationStagesForPlan(projectRelationStages(derivationStages));
  return dispatches.flatMap((stage, stageIndex) => stage.flatMap((dispatch, relationIndex) =>
    dispatch.claims.every(claim => claim.tier === 3 && claim.reason !== 'malformed-authored-relation')
      ? [{ id: `s${stageIndex + 1}r${relationIndex + 1}`, stageIndex, relationIndex, relation: stages[stageIndex].relations[relationIndex] }]
      : []));
};
