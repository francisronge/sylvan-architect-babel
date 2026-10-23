import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { frameStructure } from './helpers/replayInvariants.mjs';

// A claim that displaces nothing the preceding stage had, such as a movement claim in the
// first stage, introduces no syntax at its own moment: ordinary construction builds the
// material it names, and its moment paints the structure the preceding step painted.
const corpus = loadFixtureAnalyses();
const record = id => structuredClone(corpus.records.find(entry => entry.id === id).record);
const shape = step => {
  const structure = frameStructure(step);
  return [...structure.displayed].sort().map(id => `${id}[${(structure.children.get(id) ?? []).join(',')}]`).join(' ');
};

for (const id of ['replay-regressions/retained-root-growth.json#', 'replay-regressions/receiving-head-material.json#',
  'movement/holdout-transitions.json#/0', 'movement/clause-context.json#/cases/6']) {
  test(`${id}: first-stage claims introduce no syntax at their moments`, () => {
    const steps = prepareReplay({ ...record(id), includePlayback: true }).playbackSteps;
    const moments = steps.map((step, index) => ({ step, index }))
      .filter(({ step }) => step.replayFrameIndex === 0 && step.replayKind === 'relation');
    assert.ok(moments.length > 0);
    for (const { step, index } of moments)
      assert.equal(shape(step), shape(steps[index - 1]), `${step.operation} changes no syntax at frame ${index + 1}`);
  });
}
