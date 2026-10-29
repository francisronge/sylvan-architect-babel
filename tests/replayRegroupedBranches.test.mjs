import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { frameStructure } from './helpers/replayInvariants.mjs';

const word = (id, surface) => ({ id, label: 'N', word: surface });
const stage = workspaceForest => ({ statement: 'State', stageRecord: 'Record', relations: [], workspaceForest });

// A retained PP dissolves both of its daughters and regroups their words under
// two new daughters, each built at its own step.
test('each regrouped branch keeps its preceding material until its own new daughter is built', () => {
  const before = [{ id: 'p', label: 'PP', children: [
    { id: 'x', label: 'XP', children: [word('a', 'one'), word('b', 'two')] },
    { id: 'y', label: 'YP', children: [word('c', 'three'), word('d', 'four')] }] }];
  const after = [{ id: 'p', label: 'PP', children: [
    { id: 'x2', label: 'XP', children: [word('a', 'one'), word('c', 'three')] },
    { id: 'y2', label: 'YP', children: [word('b', 'two'), word('d', 'four')] }] }];
  const steps = prepareReplay({ sentence: 'one three two four', framework: 'xbar',
    derivationStages: [stage(before), stage(after)], includePlayback: true }).playbackSteps;
  const firstBuild = steps.find(step => step.replayFrameIndex === 1 && step.targetNodeId === 'x2');
  const frame = frameStructure(firstBuild);
  assert.equal(frame.parent.get('x2'), 'p');
  assert.equal(frame.parent.get('b'), 'x', 'two stays in its preceding branch until YP is built');
  assert.equal(frame.parent.get('d'), 'y', 'four stays in its preceding branch until YP is built');
  assert.equal(frame.displayed.has('y2'), false);
  const secondBuild = frameStructure(steps.find(step => step.replayFrameIndex === 1 && step.targetNodeId === 'y2'));
  assert.deepEqual(['a', 'b', 'c', 'd'].map(id => secondBuild.parent.get(id)), ['x2', 'y2', 'x2', 'y2']);
  assert.equal(secondBuild.displayed.has('x') || secondBuild.displayed.has('y'), false);
});
