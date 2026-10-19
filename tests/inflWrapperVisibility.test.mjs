import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { hidePendingInflSpecifierWrappers, hidePendingInflSpecifierWrappersInStep } from '../replay/playbackVisibility.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { checkParentAfterChildren, frameStructure } from './helpers/replayInvariants.mjs';
import { checkStepSemantics } from './helpers/replayStepInvariants.mjs';

test('a complete authored unary parent stays visible at its construction step', () => {
  for (const label of ['TP', 'T', 'IP', 'Infl', 'XP']) {
    const step = { replayKind: 'micro', operation: 'Project', targetNodeId: 'parent', sourceNodeIds: ['child'],
      replayVisibleNodeIds: ['parent', 'child'], replayCanvasData: {
        id: 'parent', label, children: [{ id: 'child', label }]
      } };
    const original = structuredClone(step);
    assert.equal(hidePendingInflSpecifierWrappersInStep(step), step, label);
    assert.deepEqual(step, original);
  }
});

test('a future first daughter still withholds its inflection wrapper until that daughter is current', () => {
  const step = { replayKind: 'micro', operation: 'ExternalMerge', targetNodeId: 'parent',
    replayVisibleNodeIds: ['parent', 'spine'], replayCanvasData: {
      id: 'parent', label: 'TP', children: [
        { id: 'future', label: 'DP', replayLayoutOnly: true }, { id: 'spine', label: 'TP' }
      ]
    } };
  const original = structuredClone(step);
  const pending = hidePendingInflSpecifierWrappersInStep(step);
  assert.deepEqual(pending.replayVisibleNodeIds, ['spine']);
  assert.equal(pending.replayCanvasData.replayLayoutOnly, true);
  assert.deepEqual(step, original);
  const complete = { ...step, replayVisibleNodeIds: ['parent', 'future', 'spine'], replayCanvasData: {
    ...step.replayCanvasData, children: [{ id: 'future', label: 'DP' }, { id: 'spine', label: 'TP' }]
  } };
  assert.equal(hidePendingInflSpecifierWrappersInStep(complete), complete);
});

test('a projection painted at the preceding step is retained, not withheld again for its new specifier', () => {
  const canvas = specifier => ({ id: 'tp', label: 'T', children: [
    { id: 'subject', label: 'D', ...(specifier ? {} : { replayLayoutOnly: true }) }, { id: 'inner', label: 'T' }
  ] });
  const shown = { replayKind: 'relation', replayVisibleNodeIds: ['tp', 'inner'],
    replayCanvasData: { id: 'tp', label: 'T', children: [{ id: 'inner', label: 'T' }] } };
  const pending = { replayKind: 'micro', operation: 'ExternalMerge', targetNodeId: 'inner',
    replayVisibleNodeIds: ['tp', 'inner'], replayCanvasData: canvas(false) };
  const landed = { replayKind: 'relation', replayVisibleNodeIds: ['tp', 'subject', 'inner'], replayCanvasData: canvas(true) };
  const [, kept, complete] = hidePendingInflSpecifierWrappers([shown, pending, landed]);
  assert.deepEqual(kept.replayVisibleNodeIds, ['tp', 'inner']);
  assert.equal(kept.replayCanvasData.replayLayoutOnly, undefined);
  assert.equal(complete, landed);
  const [withheld] = hidePendingInflSpecifierWrappers([pending]);
  assert.deepEqual(withheld.replayVisibleNodeIds, ['inner'], 'a projection not yet painted still waits for its specifier');
});

test('a retained T stays over the new T inserted beneath it until its subject lands (17-fr-clitic-climbing-causative)', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/retained-inflection-projection.json', import.meta.url), 'utf8'));
  const replay = prepareReplay({ ...fixture, includePlayback: true }), steps = replay.playbackSteps;
  const merge = steps.findIndex(step => step.replayKind === 'micro' && step.targetNodeId === 'tinner');
  assert.equal(steps[merge - 1].replayRelationIdentity?.relationIndex, 0, 'the clitic moment precedes the merge');
  const atMerge = frameStructure(steps[merge]);
  assert.equal(atMerge.parent.get('tinner'), 'tp');
  assert.equal(atMerge.parent.get('cliticHead'), 'tinner');
  assert.equal(atMerge.parent.get('voiceProj'), 'tinner');
  assert.equal(atMerge.displayed.has('marieHigh'), false, 'the subject still waits for its own moment');
  const stage = steps.flatMap((step, index) => step.replayFrameIndex === 3 ? [index] : []);
  assert.deepEqual(stage.filter(index => !frameStructure(steps[index]).displayed.has('tp')), [], 'tp is painted at every step of stage 4');
  assert.deepEqual(checkStepSemantics(replay, fixture), []);
  assert.deepEqual(checkParentAfterChildren(replay), []);
});
