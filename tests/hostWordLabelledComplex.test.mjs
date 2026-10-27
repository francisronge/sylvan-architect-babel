import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { checkMovementUnrendered } from './helpers/replayContractWarnings.mjs';

// Opus n3-37 (Dutch cross-serial verbs, claude-final-review opus-parts,
// stage 3): heads carry category labels, but each projection and the verb
// cluster carry the head's word. zwemmen adjoins to helpen, forming
// [helpen [V helpen] [V zwemmen]].
const leaf = (id, label, word, lineageId, silent) => ({ id, label, word, ...(lineageId ? { lineageId } : {}), ...(silent ? { silent } : {}), children: [] });
const swimPhrase = silent => ({ id: 'zwP', label: 'zwemmen', children: [leaf('marie', 'D', 'Marie'), leaf('zwemmen', 'V', 'zwemmen', 'L_zw', silent)] });
const stage = (workspaceForest, relations = []) => ({ statement: 'State', stageRecord: 'Authored state.', relations, workspaceForest });
const relation = { relation: 'headMovement', anchors: { source: 'zwemmen', landing: 'zwemmen2', host: 'helpen' } };
const stages = (clusterLabel = 'helpen') => [
  stage([{ id: 'helP', label: 'helpen', children: [swimPhrase(false), leaf('helpen', 'V', 'helpen', 'L_help')] }]),
  stage([{ id: 'helP', label: 'helpen', children: [swimPhrase(true), { id: 'cluster', label: clusterLabel, lineageId: 'L_cluster',
    children: [leaf('helpen', 'V', 'helpen', 'L_help'), leaf('zwemmen2', 'V', 'zwemmen', 'L_zw')] }] }], [relation])
];
const recover = derivation => recoverMovementEvidence(relation, derivation[1].workspaceForest, derivation[0].workspaceForest);

test('a complex labelled by its host\'s word is that host\'s head complex', () => {
  const { movement, failure } = recover(stages());
  assert.equal(failure, undefined);
  assert.deepEqual([movement?.sourceNodeId, movement?.targetNodeId, movement?.trajectoryKind], ['zwemmen', 'zwemmen2', 'head']);
  assert.deepEqual(movement.context, [{ key: 'host', nodeId: 'helpen', kind: 'head-landing' }]);
  const record = { sentence: 'Marie helpen zwemmen', derivationStages: stages() };
  const replay = prepareReplay({ ...structuredClone(record), includePlayback: true });
  assert.deepEqual(checkMovementUnrendered(replay, record), []);
  assert.ok(replay.relationRenderPlan.frames[1].items.some(item => item.kind === 'trajectory'
    && item.sourceNodeId === 'zwemmen' && item.targetNodeId === 'zwemmen2'));
});

test('a parent bearing another word names no host', () => {
  assert.notEqual(recover(stages('zwemmen')).movement?.trajectoryKind, 'head');
});
