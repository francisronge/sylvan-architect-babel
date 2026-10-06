import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { buildStageLayoutGroups, stageTreeLayoutSize } from '../replay/stageCamera.ts';
import { visibleComponentNodes } from '../replay/visibleComponent.ts';

const { cases } = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/workspace-historical-continuity.json', import.meta.url)));
for (const [width, height] of [[1600, 1100], [390, 844]]) for (const direction of ['ltr', 'rtl']) for (const record of cases) {
  test(`${width}px ${direction}: ${record.key} keeps its complete workspace fixed through unrelated selection or Agree`, () => {
    const original = JSON.stringify(record), replay = prepareReplay({ ...record, includePlayback: true }), steps = replay.playbackSteps;
    const groups = buildStageLayoutGroups(steps, replay.replayDerivationFrames), sizeFor = stage => stageTreeLayoutSize(steps, stage, width, height, groups);
    const boundaries = {
      'fresh/english-raising/0': [[39, 40, 'matrixTCore']],
      'holdout/turkish-relative-subject/0': [[40, 41, 'rIP']],
      'archive/expansion-parasitic-gap/0': [[40, 41, 'a_tp']],
      'fresh/japanese-relative/0': [[58, 59, 'matrixIP'], [65, 66, 'matrixCP']],
      'archive/holdout-german-concord/0': [[29, 30, 'tp']],
      'fresh/english-binding/0': [[51, 52, 'mtTop']],
      'fresh/english-binding/1': [[51, 52, 'mtTop']],
      'archive/german-coordination-xbar-astra/0': [[56, 57, 'ipl']]
    }[record.key];
    const frame = number => {
      const step = steps[number - 1], size = sizeFor(step.replayFrameIndex), visible = new Set(step.replayVisibleNodeIds);
      const root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
      const coordinates = buildStageCoordinateReservations(steps, step.replayFrameIndex, size, sizeFor, direction).get(step.replayCanvasData);
      return new Map(layoutSyntaxTree(root, size, direction, coordinates, visible).descendants()
        .filter(node => visible.has(getNodeId(node)) && !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace')
        .map(node => [getNodeId(node), node]));
    };
    for (const [a, b, id] of boundaries) {
      const before = frame(a), after = frame(b), members = visibleComponentNodes(before.get(id), before);
      assert(members.length > 20);
      for (const node of members) {
        const next = after.get(getNodeId(node)); assert(next);
        assert(Math.hypot(next.x - node.x, next.y - node.y) < 1e-6, `${getNodeId(node)} moved at ${a}→${b}`);
      }
    }
    if (record.key === 'archive/expansion-parasitic-gap/0') {
      const before = frame(21), after = frame(22);
      assert.equal(steps[21].replayKind, 'relation');
      assert.equal(after.get('a_file').parent.data.id, 'a_fvp');
      assert(!before.has('a_fvp'), 'the parent arrives with its owning movement');
      assert(!before.has('a_fdp'), 'the landing is unavailable before its movement');
      assert(after.has('a_fdp'), 'the complete landing arrives at the movement');
      for (const node of visibleComponentNodes(after.get('a_fdp'), after)) {
        assert(!before.has(getNodeId(node)), 'no landing descendant is revealed early');
      }
      assert(Math.hypot(after.get('a_fdp').x - before.get('a_rdp').x,
        after.get('a_fdp').y - before.get('a_rdp').y) > 1, 'the authored source moves to a distinct landing');
      const ownsMovement = link => link.renderFamily === 'trajectory'
        && link.sourceNodeId === 'a_rdp' && link.targetNodeId === 'a_fdp';
      assert(!steps[20].replayRelationLinks.some(ownsMovement), 'the movement arrow is not premature');
      assert.equal(steps[21].replayRelationLinks.filter(ownsMovement).length, 1, 'one trajectory owns the movement');
      const movement = steps[21].replayRelationLinks.find(ownsMovement);
      assert.equal(movement.authoredRelationKey, '1:0');
      assert.equal(movement.priorSourceNodeId, 'a_rdp');
      assert.equal(movement.witnessNodeId, 'a_rdp');
      const dx = after.get('a_file').x - before.get('a_file').x;
      const dy = after.get('a_file').y - before.get('a_file').y;
      // The receiving predicate may already occupy its destination. Its entire
      // contour must remain rigid whether it translates or stays in place.
      for (const node of visibleComponentNodes(before.get('a_file'), before)) {
        const next = after.get(getNodeId(node));
        assert(Math.hypot(next.x - node.x - dx, next.y - node.y - dy) < 1e-6, 'host movement preserves its full contour');
      }
    }
    if (record.expectedFinalRelative) {
      const final = frame(steps.length), root = [...final.values()].find(node => !node.parent || !final.has(getNodeId(node.parent)));
      const key = width === 1600 ? (direction === 'ltr' ? 'desktop' : 'rtl') : (direction === 'ltr' ? 'phone' : 'phone-rtl');
      const expected = new Map(record.expectedFinalRelative[key].map(([id, x, y]) => [id, { x, y }]));
      for (const [id, point] of expected) {
        const node = final.get(id); assert(node);
        assert(Number.isFinite(node.x) && Number.isFinite(node.y));
        if (node.parent && final.has(getNodeId(node.parent))) assert(node.y > node.parent.y, `${id}: branch points down`);
        assert(Math.abs(node.y - root.y - point.y) < 1e-8, `${id} retains native final rank`);
        assert(Math.abs(node.x - root.x - point.x) < 1e-6, `${id} retains its reviewed final displacement`);
        const children = (node.children ?? []).filter(child => final.has(getNodeId(child)));
        for (let i = 1; i < children.length; i++) {
          assert(Math.abs(children[i].y - children[0].y) < 1e-8, `${id}: siblings share their rank`);
          assert(direction === 'rtl' ? children[i - 1].x > children[i].x : children[i - 1].x < children[i].x,
            `${id}: daughter order is retained`);
        }
        const checkInterval = (a, b) => {
          const before = expected.get(b).x - expected.get(a).x, after = final.get(b).x - final.get(a).x;
          assert(Math.abs(after - before) < 1e-6, `${id}: reviewed interval ${a}–${b} stays exact`);
        };
        for (const child of children) checkInterval(id, getNodeId(child));
        for (let i = 1; i < children.length; i++) checkInterval(getNodeId(children[i - 1]), getNodeId(children[i]));
      }
    }
    assert.equal(JSON.stringify(record), original);
  });
}
