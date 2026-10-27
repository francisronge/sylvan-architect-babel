import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import * as invariants from './helpers/replayInvariants.mjs';
import { checkStepSemantics } from './helpers/replayStepInvariants.mjs';
import { checkMovementUnrendered } from './helpers/replayContractWarnings.mjs';

// Opus n3-49 (What did John buy and Mary sell?, claude-final-review
// opus-parts, stage 9) names the two lower copies themselves as the sources
// of its across-the-board movement, without separate trace witnesses.
const leaf = (id, label, word, extra = {}) => ({ id, label, word, children: [], ...extra });
const conjunct = (n, verb, silent) => ({ id: `VP${n}`, label: 'V', children: [leaf(verb, 'V', verb),
  leaf(`what${n}`, 'D', 'what', { lineageId: 'wh', ...(silent ? { silent: true } : {}) })] });
const coordination = silent => ({ id: 'andP', label: '&', children: [conjunct(1, 'buy', silent),
  { id: 'andbar', label: '&', children: [leaf('and', '&', 'and'), conjunct(2, 'sell', silent)] }] });
const clause = silent => ({ id: 'CP1', label: 'C', children: [leaf('C0', 'C', 'did'), coordination(silent)] });
const atb = { relation: 'acrossTheBoardMovement', anchors: { sources: ['what1', 'what2'], landing: 'what3' } };
const stage = (workspaceForest, relations = []) => ({ statement: 'State', stageRecord: 'Authored state.', relations, workspaceForest });
const record = () => ({ sentence: 'what did buy and sell', derivationStages: [
  stage([clause(false)]),
  stage([{ id: 'CP2', label: 'C', children: [leaf('what3', 'D', 'what', { lineageId: 'wh' }), clause(true)] }], [atb])
] });

test('an across-the-board claim whose sources are the lower copies moves both to one landing at its moment', () => {
  const authored = record(), replay = prepareReplay({ ...structuredClone(authored), includePlayback: true });
  const steps = replay.playbackSteps;
  const at = steps.findIndex(step => step.replayKind === 'relation' && step.replayRelationIdentity?.stageIndex === 1);
  assert.ok(at > 0);
  for (const id of ['what3', 'CP2']) assert.equal(steps.findIndex(step => step.replayVisibleNodeIds?.includes(id)), at, `${id} appears at the moment`);
  const paths = replay.relationRenderPlan.frames[1].items.filter(item => item.kind === 'trajectory' && item.relationRef.stageIndex === 1);
  assert.deepEqual(paths.map(item => `${item.sourceNodeId}->${item.targetNodeId}`).sort(), ['what1->what3', 'what2->what3']);
  const findings = [invariants.checkNoEarlyReveal(replay), invariants.checkMovementShownAsMovement(replay, authored),
    invariants.checkAttachAtMerge(replay), checkStepSemantics(replay, authored), checkMovementUnrendered(replay, authored)].flat();
  assert.deepEqual(findings, []);
});

test('trace witnesses naming the same lower copies change nothing', () => {
  const plain = record(), witnessed = record();
  witnessed.derivationStages[1].relations[0].anchors.traceWitnesses = ['what1', 'what2'];
  const [a, b] = [plain, witnessed].map(input => prepareReplay({ ...structuredClone(input), includePlayback: true }));
  assert.deepEqual(b.playbackSteps.map(step => step.replayVisibleNodeIds), a.playbackSteps.map(step => step.replayVisibleNodeIds));
  assert.deepEqual(invariants.checkNoEarlyReveal(b), []);
});
