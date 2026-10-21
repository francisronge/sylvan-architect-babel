import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';
import { adaptDerivationStagesForReplay } from '../replay/authoredFrames.ts';
import { buildPlaybackStepsFromDerivationFrames } from '../replay/replayCompiler.ts';
import { registeredTrajectoryDisplayKind } from '../replay/relations/movementIdentities.ts';
import { rawCases } from '../docs/design/visual-relations-lab-cards.ts';

const collectNodes = (node, nodes = []) => {
  if (!node) return nodes;
  nodes.push(node);
  for (const child of node.children || []) collectNodes(child, nodes);
  return nodes;
};

const findNode = (forest, nodeId) => {
  for (const root of forest || []) {
    const match = collectNodes(root, []).find((node) => String(node.id || '') === nodeId);
    if (match) return match;
  }
  return null;
};

const findParentNodeId = (forest, nodeId) => {
  for (const root of forest || []) {
    for (const node of collectNodes(root, [])) {
      if ((node.children || []).some((child) => String(child.id || '') === nodeId)) {
        return String(node.id || '');
      }
    }
  }
  return '';
};

test('every Orchard phrasal movement creates a new landing host only in its relation moment', () => {
  const findings = [];
  let checkedRelationMoments = 0;

  for (const card of rawCases) {
    const stages = card.derivationStages || [];
    const steps = buildPlaybackStepsFromDerivationFrames({
      frames: adaptDerivationStagesForReplay(stages),
      sentence: card.sentence,
      replayPlan: buildDerivationReplayPlan({ derivationStages: stages })
    }
    );

    for (let stageIndex = 0; stageIndex < stages.length; stageIndex += 1) {
      const stage = stages[stageIndex];
      for (let relationIndex = 0; relationIndex < (stage.relations || []).length; relationIndex += 1) {
        const authored = stage.relations[relationIndex];
        if (registeredTrajectoryDisplayKind(authored.relation, authored.anchors) !== 'phrasal') continue;

        const relationStepIndex = steps.findIndex((step) => (
          step.replayKind === 'relation'
          && step.replayRelationIdentity?.stageIndex === stageIndex
          && step.replayRelationIdentity?.relationIndex === relationIndex
        ));
        if (relationStepIndex < 0) {
          findings.push(`${card.archetype}: ${authored.relation} has no exact relation frame`);
          continue;
        }

        const relationStep = steps[relationStepIndex];
        const link = (relationStep.replayRelationLinks || []).find((candidate) => (
          candidate.relation === authored.relation
          && Number(candidate.stepIndex) === stageIndex
        ));
        const targetNodeId = String(link?.targetNodeId || relationStep.targetNodeId || '');
        const landingHostNodeId = findParentNodeId(stage.workspaceForest, targetNodeId);
        if (!targetNodeId || !landingHostNodeId) {
          findings.push(`${card.archetype}: ${authored.relation} has no resolved target/host`);
          continue;
        }

        checkedRelationMoments += 1;
        const previousForest = stageIndex > 0
          ? stages[stageIndex - 1]?.workspaceForest || []
          : [];
        if (findNode(previousForest, landingHostNodeId)) continue;

        const sameStageEarlierSteps = steps.slice(0, relationStepIndex).filter((step) => (
          String(step.replayProgressLabel || '').startsWith(
            `Stage ${stageIndex + 1}/${stages.length}`
          )
        ));
        const constructsHostEarly = sameStageEarlierSteps.some((step) => (
          ['Project', 'ExternalMerge'].includes(String(step.operation || ''))
          && String(step.targetNodeId || '').replace(/::__leaf$/, '') === landingHostNodeId
        ));
        const constructsAncestorEarly = sameStageEarlierSteps.some((step) => {
          if (!['Project', 'ExternalMerge'].includes(String(step.operation || ''))) return false;
          const structuralTarget = findNode(
            stage.workspaceForest,
            String(step.targetNodeId || '').replace(/::__leaf$/, '')
          );
          return Boolean(
            structuralTarget
            && String(structuralTarget.id || '') !== landingHostNodeId
            && collectNodes(structuralTarget, []).some((node) => (
              String(node.id || '') === landingHostNodeId
            ))
          );
        });
        const revealsHostEarly = sameStageEarlierSteps.some((step) => (
          step.replayVisibleNodeIds || []
        ).includes(landingHostNodeId));
        const relationVisibleNodeIds = new Set(relationStep.replayVisibleNodeIds || []);
        const landingHost = findNode([relationStep.replayCanvasData], landingHostNodeId);
        const targetIsAttached = Boolean(
          (landingHost?.children || []).some((child) => String(child.id || '') === targetNodeId)
        );

        if (
          constructsHostEarly
          || constructsAncestorEarly
          || revealsHostEarly
          || !relationVisibleNodeIds.has(landingHostNodeId)
          || !relationVisibleNodeIds.has(targetNodeId)
          || !targetIsAttached
        ) {
          findings.push(
            `${card.archetype}: ${authored.relation} leaks or fails to create ${landingHostNodeId} `
            + `(hostEarly=${constructsHostEarly}, ancestorEarly=${constructsAncestorEarly}, `
            + `revealedEarly=${revealsHostEarly}, hostVisible=${relationVisibleNodeIds.has(landingHostNodeId)}, `
            + `targetVisible=${relationVisibleNodeIds.has(targetNodeId)}, attached=${targetIsAttached})`
          );
        }
      }
    }
  }

  assert.equal(rawCases.length, 98);
  assert.ok(checkedRelationMoments > 0);
  assert.deepEqual(findings, []);
});
