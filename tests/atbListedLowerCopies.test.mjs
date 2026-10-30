import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import * as invariants from './helpers/replayInvariants.mjs';
import { checkStepSemantics } from './helpers/replayStepInvariants.mjs';
import { checkMovementUnrendered } from './helpers/replayContractWarnings.mjs';
import { canonicalId } from './helpers/canonicalIds.mjs';

// Opus s03 (John likes and Mary hates the new mayor, claude-final2
// opus-stress, stage 8): right node raising moves the shared object across
// the board. The landing keeps the first object's id, the lower copies are
// listed under "traces" (a fresh t1 and the second object, which keeps its
// id), and the preceding sources are listed only in priorAnchors.
const leaf = (id, label, word, extra = {}) => ({ id, label, word, children: [], ...extra });
const object = (n) => ({ id: `dp${n}`, label: 'DP', lineageId: 'mayor', children: [leaf(`d${n}`, 'D', 'the'), leaf(`n${n}`, 'N', 'mayor')] });
const trace = (id) => leaf(id, 't', undefined, { lineageId: 'mayor', silent: true });
const conjunct = (n, verb, complement) => ({ id: `ip${n}`, label: 'IP', children: [leaf(`s${n}`, 'DP', n === 1 ? 'John' : 'Mary'),
  { id: `vp${n}`, label: 'VP', children: [leaf(`v${n}`, 'V', verb), complement] }] });
const coordination = (left, right) => ({ id: 'conjp1', label: 'ConjP', children: [conjunct(1, 'likes', left),
  { id: 'conjbar', label: "Conj'", children: [leaf('conj', 'Conj', 'and'), conjunct(2, 'hates', right)] }] });
const atb = { relation: 'across-the-board rightward movement', anchors: { moved: 'dp1', traces: ['t1', 'dp2'], adjunctionHost: 'conjp1' },
  priorAnchors: { sources: ['dp1', 'dp2'] } };
const stage = (workspaceForest, relations = []) => ({ statement: 'State', stageRecord: 'Authored state.', relations, workspaceForest });
const record = (relation = atb) => ({ sentence: 'John likes and Mary hates the mayor', derivationStages: [
  stage([coordination(object(1), object(2))]),
  stage([{ id: 'conjp2', label: 'ConjP', children: [coordination(trace('t1'), trace('dp2')), object(1)] }], [relation])
] });

test('lower copies listed as traces beside prior sources move to the one shared landing at its moment', () => {
  const authored = record(), replay = prepareReplay({ ...structuredClone(authored), includePlayback: true });
  const steps = replay.playbackSteps;
  const at = steps.findIndex(step => step.replayKind === 'relation' && step.replayRelationIdentity?.stageIndex === 1);
  assert.ok(at > 0);
  const paths = replay.relationRenderPlan.frames[1].items.filter(item => item.kind === 'trajectory' && item.relationRef.stageIndex === 1);
  // The authored lower copies and landing, as Replay names them (each source keeps its id).
  const id = name => canonicalId(replay, name, 1);
  assert.deepEqual(paths.map(item => `${item.sourceNodeId}->${item.targetNodeId}`).sort(),
    [`${id('dp2')}->${id('dp1')}`, `${id('t1')}->${id('dp1')}`].sort());
  assert.equal(steps.findIndex(step => step.replayVisibleNodeIds?.includes('conjp2')), at, 'the new adjunction segment appears at the moment');
  const findings = [invariants.checkNoEarlyReveal(replay), invariants.checkMovementShownAsMovement(replay, authored),
    invariants.checkAttachAtMerge(replay), checkStepSemantics(replay, authored), checkMovementUnrendered(replay, authored)].flat();
  assert.deepEqual(findings, []);
});

test('a listed copy that holds no preceding source slot proves no group', () => {
  const unrelated = record({ ...atb, anchors: { ...atb.anchors, traces: ['t1', 'conj'] } });
  const replay = prepareReplay({ ...structuredClone(unrelated), includePlayback: true });
  assert.deepEqual(replay.relationRenderPlan.frames[1].items.filter(item => item.kind === 'trajectory' && item.relationRef.stageIndex === 1), []);
});
