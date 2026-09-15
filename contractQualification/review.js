import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import {
  compileRelationRenderPlan,
  planItemRelationRefs
} from '../replay/relations/renderPlanCompiler.ts';
import { dispatchRelationClaimBatch } from '../replay/relations/tier2RelationDispatch.ts';

const relationKey = ({ stageIndex, relationIndex }) => `${stageIndex}:${relationIndex}`;

const compactRelationRef = (reference) => ({
  stageIndex: reference.stageIndex,
  relationIndex: reference.relationIndex,
  relation: reference.relation,
  anchors: reference.anchors,
  ...(reference.priorAnchors ? { priorAnchors: reference.priorAnchors } : {}),
  ...(reference.values ? { values: reference.values } : {})
});

const compactClaim = (claim) => ({
  tier: claim.tier,
  kind: claim.kind,
  canonicalClaimIdentity: claim.canonicalClaimIdentity,
  consumedEvidence: claim.consumedEvidence,
  ...(claim.registryEntryId ? { registryEntryId: claim.registryEntryId } : {}),
  ...(claim.reason ? { reason: claim.reason } : {}),
  ...(claim.facet ? {
    facet: {
      id: claim.facet.recipe.id,
      identity: claim.facet.facetIdentity,
      outputIdentities: claim.facet.outputIdentities.map((output) => output.key)
    }
  } : {})
});

const compactPlanItem = (item, itemIndex) => ({
  itemIndex,
  kind: item.kind,
  tier: item.claimTier ?? null,
  familyId: item.familyId ?? null,
  canonicalClaimIdentity: item.canonicalClaimIdentity ?? null,
  persistence: item.persistence,
  relationRefs: planItemRelationRefs(item).map(compactRelationRef),
  tier2FacetId: item.tier2FacetId ?? null,
  tier2OutputPieces: item.tier2OutputPieces ?? [],
  tier2OutputIdentities: item.tier2OutputIdentities ?? []
});

const compactReplayStep = (step, frameIndex, claimsByRelation) => {
  const replayRelationIdentity = step.replayRelationIdentity
    ? {
        stageIndex: step.replayRelationIdentity.stageIndex,
        relationIndex: step.replayRelationIdentity.relationIndex
      }
    : null;
  const introducedClaims = replayRelationIdentity
    ? claimsByRelation.get(relationKey(replayRelationIdentity)) ?? []
    : [];

  return {
    frameIndex,
    operation: String(step.operation || ''),
    replayKind: step.replayKind ?? null,
    sourceFrameIndex: step.sourceFrameIndex ?? null,
    visualFrameIndex: step.visualFrameIndex ?? null,
    replayFrameIndex: step.replayFrameIndex ?? null,
    replayRelationIdentity,
    replayProgressLabel: String(step.replayProgressLabel || ''),
    targetNodeId: String(step.targetNodeId || ''),
    targetLabel: String(step.targetLabel || ''),
    sourceNodeIds: Array.isArray(step.sourceNodeIds) ? step.sourceNodeIds : [],
    sourceLabels: Array.isArray(step.sourceLabels) ? step.sourceLabels : [],
    replayVisibleNodeIds: Array.isArray(step.replayVisibleNodeIds)
      ? step.replayVisibleNodeIds
      : [],
    stageRecord: String(step.stageRecord || ''),
    note: String(step.note || ''),
    detailBlocks: Array.isArray(step.detailBlocks) ? step.detailBlocks : [],
    movementDiagnostics: Array.isArray(step.movementDiagnostics) ? step.movementDiagnostics : [],
    ...(step.replayRealizations ? { replayRealizations: step.replayRealizations } : {}),
    ...(step.replayRealizationDiagnostics ? { replayRealizationDiagnostics: step.replayRealizationDiagnostics } : {}),
    introducedClaims
  };
};

export const buildQualificationAnalysisEvidence = (analysisBundle) => {
  const analysis = analysisBundle?.analyses?.[0];
  if (!analysis) throw new Error('Qualification evidence requires one analysis.');
  const stages = Array.isArray(analysis.derivationStages) ? analysis.derivationStages : [];
  const relationEntries = stages.flatMap((stage, stageIndex) => (
    dispatchRelationClaimBatch({
      relations: Array.isArray(stage.relations) ? stage.relations : [],
      stageIndex,
      currentForest: Array.isArray(stage.workspaceForest) ? stage.workspaceForest : [],
      ...(stageIndex > 0
        ? {
            priorForest: Array.isArray(stages[stageIndex - 1]?.workspaceForest)
              ? stages[stageIndex - 1].workspaceForest
              : []
          }
        : {})
    }).map(({ relation, dispatch }) => ({
      stageIndex,
      relationIndex: dispatch.relationInstance.relationIndex,
      relation: relation.relation,
      claims: dispatch.claims.map(compactClaim),
      diagnostics: dispatch.diagnostics
    }))
  ));
  const claimsByRelation = new Map(relationEntries.map((entry) => [
    relationKey(entry),
    entry.claims
  ]));
  const claims = relationEntries.flatMap((entry) => entry.claims.map((claim) => ({
    stageIndex: entry.stageIndex,
    relationIndex: entry.relationIndex,
    relation: entry.relation,
    ...claim
  })));
  const tierCounts = { tier1: 0, tier2: 0, tier3: 0 };
  claims.forEach((claim) => {
    tierCounts[`tier${claim.tier}`] += 1;
  });

  const renderPlan = compileRelationRenderPlan(stages);
  const playback = buildReplayPlayback(analysisBundle);

  return {
    schemaVersion: 1,
    replay: {
      schemaVersion: 1,
      sentence: playback.sentence,
      frameCount: playback.steps.length,
      frames: playback.steps.map((step, frameIndex) => (
        compactReplayStep(step, frameIndex, claimsByRelation)
      ))
    },
    renderer: {
      schemaVersion: 1,
      registryId: renderPlan.registryId,
      registryVersion: renderPlan.registryVersion,
      stageCount: renderPlan.stageCount,
      tierCounts,
      relations: relationEntries,
      frames: renderPlan.frames.map((frame) => ({
        stageIndex: frame.stageIndex,
        items: frame.items.map(compactPlanItem)
      })),
      diagnostics: renderPlan.diagnostics,
      unregistered: renderPlan.unregistered
    }
  };
};
