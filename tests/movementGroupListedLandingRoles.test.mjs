import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import * as invariants from './helpers/replayInvariants.mjs';
import { checkStepSemantics } from './helpers/replayStepInvariants.mjs';
import { checkMovementUnrendered } from './helpers/replayContractWarnings.mjs';

// Sol n4-34 (Irish, sol-final 2026-10-27, stage 2) raises three verbs to I in
// one claim whose source, landing and target are parallel lists. Both landing
// and target can name a landing, so each source must find its own items.
const leaf = (id, label, word, extra = {}) => ({ id, label, ...(word ? { word } : { silent: true }), children: [], ...extra });
const ip = (n, verb, raised, inner) => ({ id: `IP${n}`, label: 'IP', children: [
  raised
    ? { id: `i${n}`, label: 'I', children: [leaf(`m${n}`, 'V', verb, { lineageId: `V${n}` }), leaf(`tense${n}`, 'I')] }
    : leaf(`i${n}`, 'I'),
  { id: `VP${n}`, label: 'VP', children: [raised ? leaf(`v${n}`, 'V', undefined, { lineageId: `V${n}` }) : leaf(`v${n}`, 'V', verb, { lineageId: `V${n}` }),
    ...(inner ? [inner] : [])] }] });
const tree = raised => ip(0, 'said', raised, { id: 'CP1', label: 'CP', children: [leaf('c1', 'C', 'that'), ip(1, 'was', raised)] });
const raising = { relation: 'V-to-I-head-movement', anchors: { source: ['v0', 'v1'], landing: ['m0', 'm1'], target: ['i0', 'i1'] } };
const stage = (workspaceForest, relations = []) => ({ statement: 'State', stageRecord: 'Authored state.', relations, workspaceForest });
const record = () => ({ sentence: 'said that was', derivationStages: [stage([tree(false)]), stage([tree(true)], [raising])] });

test('a claim listing its landings under both landing and target moves each verb at its moment', () => {
  const authored = record(), replay = prepareReplay({ ...structuredClone(authored), includePlayback: true });
  const steps = replay.playbackSteps;
  const at = steps.findIndex(step => step.replayKind === 'relation' && step.replayRelationIdentity?.stageIndex === 1);
  assert.ok(at > 0);
  for (const id of ['m0', 'm1', 'tense0', 'tense1']) assert.equal(steps.findIndex(step => step.replayVisibleNodeIds?.includes(id)), at, `${id} appears at the moment`);
  assert.deepEqual(steps[at].movementDiagnostics ?? [], []);
  const paths = replay.relationRenderPlan.frames[1].items.filter(item => item.kind === 'trajectory' && item.relationRef.stageIndex === 1);
  assert.deepEqual(paths.map(item => `${item.sourceNodeId}->${item.targetNodeId}`).sort(), ['v0->m0', 'v1->m1']);
  const findings = [invariants.checkNoEarlyReveal(replay), invariants.checkMovementShownAsMovement(replay, authored),
    invariants.checkAttachAtMerge(replay), checkStepSemantics(replay, authored), checkMovementUnrendered(replay, authored)].flat();
  assert.deepEqual(findings, []);
});

test('the pairing comes from structure, not list order', () => {
  const shuffled = record();
  Object.assign(shuffled.derivationStages[1].relations[0].anchors, { landing: ['m1', 'm0'] });
  const replay = prepareReplay({ ...structuredClone(shuffled), includePlayback: true });
  const paths = replay.relationRenderPlan.frames[1].items.filter(item => item.kind === 'trajectory' && item.relationRef.stageIndex === 1);
  assert.deepEqual(paths.map(item => `${item.sourceNodeId}->${item.targetNodeId}`).sort(), ['v0->m0', 'v1->m1']);
});
