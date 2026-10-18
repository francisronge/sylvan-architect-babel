import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { frameStructure } from './helpers/replayInvariants.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/unchanged-witness-container.json', import.meta.url), 'utf8'));

test('a relation that refers to an unchanged earlier constituent does not own the merges around it', () => {
  const steps = prepareReplay({ ...fixture, includePlayback: true }).playbackSteps;
  const stage = steps.map((step, index) => ({ step, index })).filter(({ step }) => step.replayFrameIndex === 2);
  const build = id => stage.find(({ step }) => step.replayKind === 'micro' && step.targetNodeId === id);
  assert.ok(build('matrixVBar'), 'V′ has its own construction step');
  assert.ok(build('matrixVP'), 'VP has its own construction step');
  const firstRelation = stage.find(({ step }) => step.replayKind === 'relation');
  assert.ok(build('matrixVP').index < firstRelation.index);
  const licensing = stage.find(({ step }) => step.replayKind === 'relation' && step.targetNodeId === 'smallClauseSubject');
  const before = frameStructure(steps[licensing.index - 1]), at = frameStructure(licensing.step);
  assert.deepEqual([...at.displayed].filter(id => !before.displayed.has(id)), [], 'the licensing moment reveals no syntax');
  assert.equal(before.parent.get('smallClause'), 'matrixVBar');
});
