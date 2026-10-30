import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { checkMovementUnrendered } from './helpers/replayContractWarnings.mjs';
import { checkMovementShownAsMovement } from './helpers/replayInvariants.mjs';
import { canonicalId } from './helpers/canonicalIds.mjs';

// Claude Opus 5.5 (held-out batch heldout-20261029, h1-023) names each phrasal
// movement {mover, trace, target}: `mover` is an open field, `trace` the lower
// occurrence and `target` the head whose projection receives the landing. The
// mover keeps its ID at the landing and the new trace holds its exact preceding
// slot, so structure proves the pair; the target head is context.
const fixture = JSON.parse(readFileSync(new URL('./helpers/keptLandingAttractingHeadRecord.json', import.meta.url), 'utf8'));
const record = { sentence: fixture.sentence, inputTokens: fixture.inputTokens, derivationStages: fixture.derivationStages };
const MOVEMENTS = [
  { key: '5:2', trace: 'e_shetr', landing: 'e_she', head: 'e_t' },
  { key: '6:0', trace: 'e_objtr', landing: 'e_obj', head: 'e_than' },
  { key: '13:2', trace: 'm_rosatr', landing: 'm_rosa', head: 'm_t' }
];
const recover = (stageIndex, relation) => recoverMovementEvidence(relation,
  record.derivationStages[stageIndex].workspaceForest, record.derivationStages[stageIndex - 1].workspaceForest);

test('a kept-ID landing beside the head a target field names is the landing, and that head stays context', () => {
  for (const { key, trace, landing, head } of MOVEMENTS) {
    const [stageIndex, relationIndex] = key.split(':').map(Number);
    const relation = record.derivationStages[stageIndex].relations[relationIndex];
    assert.equal(relation.anchors.target, head, `${key} names the head as target`);
    const { movement, failure } = recover(stageIndex, relation);
    assert.equal(failure, undefined, `${key} is recognized`);
    assert.deepEqual([movement.sourceNodeId, movement.targetNodeId, movement.priorSourceNodeId, movement.trajectoryKind],
      [trace, landing, landing, 'phrasal'], `${key} moves ${landing} from ${trace}`);
    assert.equal(movement.roles.target, undefined, `${key} leaves the attracting head out of the endpoints`);
  }
  const replay = prepareReplay({ ...structuredClone(record), includePlayback: true });
  for (const { key, trace, landing } of MOVEMENTS) {
    const stageIndex = Number(key.split(':')[0]);
    const paths = replay.relationRenderPlan.frames[stageIndex].items.filter(item => item.kind === 'trajectory'
      && `${item.relationRef.stageIndex}:${item.relationRef.relationIndex}` === key);
    // Replay reads the hop source-kept: the same occurrences under the other ids.
    assert.deepEqual(paths.map(item => [item.sourceNodeId, item.targetNodeId]),
      [[canonicalId(replay, trace, stageIndex), canonicalId(replay, landing, stageIndex)]], `${key} draws its arrow`);
  }
  assert.deepEqual(checkMovementUnrendered(replay, record), []);
  assert.deepEqual(checkMovementShownAsMovement(replay, record), []);
});

test('control: a target field naming a phrase, not a head, leaves the movement unproven', () => {
  // vP held the lower occurrence; it is no attracting head.
  const relation = { ...record.derivationStages[5].relations[2], anchors: { mover: 'e_she', trace: 'e_shetr', target: 'e_vP' } };
  assert.equal(recover(5, relation).failure, 'MOVEMENT_LINEAGE_UNPROVEN');
});
