import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { buildStageLayoutGroups, stageTreeLayoutSize } from '../replay/stageCamera.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { checkAttachAtMerge, frameStructure } from './helpers/replayInvariants.mjs';

// Each stage gives a retained node a new daughter; the merge into that node attaches it.
const cases = [
  { file: 'retained-parent-attachment.json', child: 'embeddedCP', parent: 'matrixVBar', before: ['wonderV'], after: ['wonderV', 'embeddedCP'] },
  { file: 'retained-head-attachment.json', child: 'tDid', parent: 'tI', before: ['tPast'], after: ['tDid', 'tPast'] }
];

for (const { file, child, parent, before, after } of cases) {
  const fixture = JSON.parse(readFileSync(new URL(`../fixtures/replay-regressions/${file}`, import.meta.url), 'utf8'));
  const replay = prepareReplay({ ...fixture, includePlayback: true }), steps = replay.playbackSteps;
  const projection = steps.findIndex(step => step.replayKind === 'micro' && step.targetNodeId === child);
  const merge = steps.findIndex((step, index) => index > projection && step.replayKind === 'micro' && step.targetNodeId === parent);

  test(`${file}: ${child} stays a separate workspace until the merge into its retained parent ${parent}`, () => {
    assert(projection > 0 && merge === projection + 1, `${child} projects, then ${parent} merges with it`);
    const projected = frameStructure(steps[projection]), merged = frameStructure(steps[merge]);
    assert(frameStructure(steps[projection - 1]).displayed.has(parent), `${parent} is retained`);
    assert.equal(projected.parent.get(child), null, `the projected ${child} is its own workspace root`);
    assert.deepEqual(projected.children.get(parent), before, `${parent} keeps its earlier daughters until its merge`);
    assert.equal(merged.parent.get(child), parent);
    assert.deepEqual(merged.children.get(parent), after);
    assert.deepEqual(checkAttachAtMerge(replay), []);
  });

  for (const [width, height] of [[1600, 948], [390, 844]]) {
    test(`${file} at ${width}px: ${child} waits at its reserved slot, and only the merge recenters ${parent}`, () => {
      const groups = buildStageLayoutGroups(steps, fixture.derivationStages);
      const sizes = new Map(fixture.derivationStages.map((_, index) => [index, stageTreeLayoutSize(steps, index, width, height, groups)]));
      const points = new Map([...sizes].flatMap(([index, size]) => [...buildStageCoordinateReservations(steps, index, size, stage => sizes.get(stage))]));
      const at = index => {
        const step = steps[index], root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
        const visible = new Set(step.replayVisibleNodeIds);
        return new Map(layoutSyntaxTree(root, sizes.get(step.replayFrameIndex), 'ltr', points.get(step.replayCanvasData), visible)
          .descendants().filter(node => visible.has(getNodeId(node))).map(node => [getNodeId(node), node]));
      };
      const merged = at(merge), stage = steps[merge].replayFrameIndex;
      const held = [...merged.get(child).descendants()].map(getNodeId).filter(id => merged.has(id));
      // From selection on, the held material keeps the place its merge gives it.
      for (let index = steps.findIndex(step => step.replayFrameIndex === stage); index < merge; index++) {
        const frame = at(index);
        for (const id of held) if (frame.has(id)) {
          assert.equal(frame.get(id).x, merged.get(id).x, `${id} keeps its x at frame ${index + 1}`);
          assert.equal(frame.get(id).y, merged.get(id).y, `${id} keeps its y at frame ${index + 1}`);
        }
      }
      const prior = at(projection - 1), projected = at(projection);
      assert.equal(projected.get(parent).x, prior.get(parent).x, `${parent} stays put at the ${child} projection`);
      const daughters = after.map(id => merged.get(id).x);
      assert.equal(merged.get(parent).x, (Math.min(...daughters) + Math.max(...daughters)) / 2, `the merge centers ${parent} over its daughters`);
    });
  }
}
