import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';

import { prepareReplay } from '../replay/prepareReplay.ts';
import * as display from '../replay/displayIdentity.ts';
import * as camera from '../replay/stageCamera.ts';
import * as coordinates from '../replay/stageCoordinates.ts';
import * as layout from '../replay/treeLayout.ts';
import { layoutReplayFrames } from '../scripts/replayFrameLayout.mjs';
import { checkAttachAtMerge, frameStructure } from './helpers/replayInvariants.mjs';

// Each stage gives a retained node new daughters, `child` built last; the merge
// into that node attaches them. A retained bare head can become a head complex
// (`before` is empty); its daughters are reserved beneath it, so its merge
// leaves it where it stood (`mergeMoves`).
const cases = [
  { file: 'retained-parent-attachment.json', child: 'embeddedCP', parent: 'matrixVBar', before: ['wonderV'], after: ['wonderV', 'embeddedCP'], mergeMoves: true },
  { file: 'retained-head-attachment.json', child: 'tDid', parent: 'tI', before: ['tPast'], after: ['tDid', 'tPast'], mergeMoves: true },
  { file: 'head-rewritten-in-place.json', child: 'pastInfl', parent: 'iFinite', before: [], after: ['auxDo', 'pastInfl'], mergeMoves: false }
];

for (const { file, child, parent, before, after, mergeMoves } of cases) {
  const fixture = JSON.parse(readFileSync(new URL(`../fixtures/replay-regressions/${file}`, import.meta.url), 'utf8'));
  const replay = prepareReplay({ ...fixture, includePlayback: true }), steps = replay.playbackSteps;
  const projection = steps.findIndex(step => step.replayKind === 'micro' && step.targetNodeId === child);
  const merge = steps.findIndex((step, index) => index > projection && step.replayKind === 'micro' && step.targetNodeId === parent);

  test(`${file}: ${child} stays a separate workspace until the merge into its retained parent ${parent}`, () => {
    assert(projection > 0 && merge === projection + 1, `${child} projects, then ${parent} merges with it`);
    const projected = frameStructure(steps[projection]), merged = frameStructure(steps[merge]);
    assert(frameStructure(steps[projection - 1]).displayed.has(parent), `${parent} is retained`);
    assert.equal(projected.parent.get(child), null, `the projected ${child} is its own workspace root`);
    assert.deepEqual(projected.children.get(parent) ?? [], before, `${parent} keeps its earlier daughters until its merge`);
    assert.equal(merged.parent.get(child), parent);
    assert.deepEqual(merged.children.get(parent), after);
    assert.deepEqual(checkAttachAtMerge(replay), []);
  });

  for (const [width, height] of [[1600, 948], [390, 844]]) {
    test(`${file} at ${width}px: ${child} waits at its reserved slot, and only the merge can move ${parent}`, () => {
      const { scenes } = layoutReplayFrames({ steps, stages: fixture.derivationStages, width, height, direction: 'ltr' },
        { coordinates, camera, layout, display, d3 });
      const merged = scenes[merge].nodes, stage = steps[merge].replayFrameIndex;
      const held = after.filter(id => !before.includes(id))
        .flatMap(id => merged.get(id).descendants().map(display.getNodeId)).filter(id => merged.has(id));
      const first = steps.findIndex(step => step.replayFrameIndex === stage), parentX = scenes[first].nodes.get(parent).x;
      for (let index = first; index < merge; index++) {
        const frame = scenes[index].nodes;
        // From selection on, the held material keeps the place its merge gives it.
        for (const id of held) if (frame.has(id)) {
          assert.equal(frame.get(id).x, merged.get(id).x, `${id} keeps its x at frame ${index + 1}`);
          assert.equal(frame.get(id).y, merged.get(id).y, `${id} keeps its y at frame ${index + 1}`);
        }
        assert.equal(frame.get(parent).x, parentX, `${parent} stays put at frame ${index + 1}, before its merge`);
      }
      if (mergeMoves) assert.notEqual(merged.get(parent).x, parentX, `${parent} moves at its merge`);
      else assert.equal(merged.get(parent).x, parentX, `${parent} stays put at its merge`);
    });
  }
}

// A stage that keeps a bare head's id and gives it daughters builds those
// daughters forward as their own workspaces; the head's own merge attaches them.
test('a retained bare head that becomes a head complex keeps its daughters apart until its own merge', () => {
  const node = (id, label, children = [], extra = {}) => ({ id, label, children, ...extra });
  const stage = workspaceForest => ({ statement: 'Build the clause.', stageRecord: 'The clause is built.', relations: [], workspaceForest });
  const clause = head => [node('ip', 'IP', [node('subject', 'NP', [], { word: 'She' }),
    node('iBar', 'I′', [head, node('vp', 'VP', [], { word: 'left' })])])];
  const record = { sentence: 'She did left', derivationStages: [
    stage(clause(node('infl', 'I⁰ [past]'))),
    stage(clause(node('infl', 'I⁰ [past]', [node('aux', 'V⁰', [], { word: 'did' }), node('past', 'I⁰', [], { silent: true })])))
  ] };
  const replay = prepareReplay({ ...record, includePlayback: true });
  const steps = replay.playbackSteps.filter(step => step.replayFrameIndex === 1);
  const merges = steps.filter(step => step.replayKind === 'micro' && step.targetNodeId === 'infl');
  assert.equal(merges.length, 1, 'infl has one merge step');
  assert.equal(merges[0].operation, 'ExternalMerge');
  assert.deepEqual(merges[0].sourceNodeIds, ['aux', 'past']);
  const merge = steps.indexOf(merges[0]);
  for (const step of steps.slice(0, merge)) {
    const frame = frameStructure(step);
    assert(frame.displayed.has('infl'), `${step.targetNodeId}: infl stays on screen`);
    assert.deepEqual(frame.children.get('infl') ?? [], [], `${step.targetNodeId}: infl stays bare before its merge`);
    for (const id of ['aux', 'past']) if (frame.displayed.has(id))
      assert.equal(frame.parent.get(id), null, `${step.targetNodeId}: ${id} is its own workspace`);
  }
  assert(frameStructure(steps[merge - 1]).displayed.has('past'), 'both daughters are built before the merge');
  assert.deepEqual(frameStructure(merges[0]).children.get('infl'), ['aux', 'past']);
  assert.deepEqual(checkAttachAtMerge(replay), []);
});
