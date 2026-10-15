import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import fs from 'node:fs';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { buildWorkspaceLifetimeContours, prepareWorkspaceLifetimeContours } from '../replay/workspaceLifetimeContours.ts';
import { TREE_SIBLING_GAP } from '../replay/treeSpacing.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { buildStageLayoutGroups, stageTreeLayoutSize } from '../replay/stageCamera.ts';
import { getNodeId } from '../replay/displayIdentity.ts';
import { workspaceContinuityReflows } from '../replay/workspaceShapeReflows.ts';

const leaf = (id, word) => ({ id, label: 'N', word, children: [] });
const nominal = () => ({ id: 'nominal', label: 'N', children: [
  { ...leaf('modifier', 'small'), label: 'A' }, leaf('noun', 'cat')
] });
const subject = () => ({ id: 'subject', label: 'D', children: [leaf('determiner', 'the'), nominal()] });
const relative = (root, id) => {
  const parent = root.descendants().find(node => node.data.id === id);
  return parent.descendants().map(node => [node.data.id, node.x - parent.x, node.y - parent.y]);
};

test('an identical subtree keeps its shape in a larger tree and a different viewport', () => {
  const ordinary = subject();
  const larger = { id: 'clause', label: 'TP', children: [subject(), {
    id: 'predicate', label: 'VP', children: [leaf('verb', 'sleeps'), {
      id: 'adjunct', label: 'PP', children: [leaf('preposition', 'on'), {
        id: 'object', label: 'D', children: [leaf('object-d', 'the'), leaf('object-n', 'sofa')]
      }]
    }]
  }] };
  const standalone = relative(layoutSyntaxTree(d3.hierarchy(ordinary), [1000, 700]), 'nominal');
  for (const size of [[1600, 1000], [390, 844]]) {
    assert.deepEqual(relative(layoutSyntaxTree(d3.hierarchy(larger), size), 'nominal'), standalone);
  }
  const [parent, left, right] = standalone;
  assert.equal(parent[1], 0);
  assert(Math.abs(left[1] + right[1]) < 1e-8);
  assert((right[1] - left[1]) / left[2] > 1.6, 'a short binary fork must retain the requested open proportions');
});

test('intrinsic spacing matches the shared tree spacing for the same short fork', () => {
  const tree = nominal();
  const steps = [{ replayCanvasData: tree, replayVisibleNodeIds: ['nominal', 'modifier', 'noun'], replayKind: 'macro', replayFrameIndex: 0 }];
  const contour = buildWorkspaceLifetimeContours(steps)[0].nodes.get('nominal');
  const staticShape = relative(layoutSyntaxTree(d3.hierarchy(tree), [1000, 700]), 'nominal');
  const gap = contour.members.get('noun').x - contour.members.get('modifier').x;
  assert.equal(gap, staticShape[2][1] - staticShape[1][1]);
});

test('changing the drawing policy invalidates an otherwise identical contour preference', () => {
  const tree = nominal(), compose = prepareWorkspaceLifetimeContours([{ replayCanvasData: tree,
    replayVisibleNodeIds: ['nominal', 'modifier', 'noun'], replayKind: 'macro', replayFrameIndex: 0 }]);
  const initial = compose()[0].nodes.get('nominal'), points = new Map(initial.members);
  points.set('modifier', { x: -160, y: 220 }); points.set('noun', { x: 160, y: 220 });
  const preferred = new Map([[initial.incarnation, points]]);
  const gap = minimumSiblingGap => {
    const part = compose(undefined, { inheritCurrentSlots: true, preferred, minimumSiblingGap })[0].nodes.get('nominal');
    return part.members.get('noun').x - part.members.get('modifier').x;
  };
  assert.equal(gap(0), 320);
  assert.equal(gap(TREE_SIBLING_GAP), TREE_SIBLING_GAP);
  assert.equal(gap(0), 320);
});

test('measured text clearance can widen a fork without changing its retained child shapes', () => {
  const tree = { id: 'parent', label: 'P', children: [subject(), leaf('peer', 'another phrase')] };
  const ids = node => [node.id, ...node.children.flatMap(ids)];
  const steps = [{ replayCanvasData: tree, replayVisibleNodeIds: ids(tree), replayKind: 'macro', replayFrameIndex: 0 }];
  const ordinary = buildWorkspaceLifetimeContours(steps)[0].nodes.get('parent');
  const labels = new Map([[tree, new Map([['peer', [{ kind: 'terminal', width: 1600 }]]])]]);
  const measureTreeLabel = run => ({ x: -run.width / 2, y: 65, width: run.width, height: 110 });
  const wide = buildWorkspaceLifetimeContours(steps, undefined, undefined, labels, measureTreeLabel)[0].nodes.get('parent');
  const gap = part => part.members.get('peer').x - part.members.get('subject').x;
  assert(gap(wide) > gap(ordinary), 'real measured ink must be allowed to request more room');
  const childOffsets = part => {
    const origin = part.members.get('subject');
    return [...part.children[0].members].map(([id]) => [id, part.members.get(id).x - origin.x, part.members.get(id).y - origin.y]);
  };
  assert.deepEqual(childOffsets(wide), childOffsets(ordinary));
  const staticWide = layoutSyntaxTree(d3.hierarchy(tree), [1000, 700], 'ltr', undefined, undefined,
    { treeLabelRuns: labels, measureTreeLabel });
  const nodes = new Map(staticWide.descendants().map(node => [getNodeId(node), node]));
  assert.equal(nodes.get('peer').x - nodes.get('subject').x, gap(wide), 'Canopy uses the same measured clearance');
});

test('full Replay keeps local proportions across different outer structures and opaque IDs', () => {
  const shapes = [subject(), { id: 'clause', label: 'TP', children: [subject(), {
    id: 'predicate', label: 'VP', children: [leaf('verb', 'sleeps'), leaf('adverb', 'soundly')]
  }] }, { id: 'outer', label: 'CP', children: [
    { id: 'left', label: 'TP', children: [leaf('long-left', 'an unrelated clause'),
      { id: 'deep', label: 'VP', children: [leaf('long-verb', 'continues'), leaf('long-complement', 'elsewhere')] }] },
    subject()
  ] }];
  const snapshots = [];
  for (const [index, tree] of shapes.entries()) for (const [width, height] of [[1600, 948], [390, 844]]) {
    const prefix = `opaque/${index}/`;
    const rename = node => ({ ...node, id: prefix + node.id, children: node.children?.map(rename) });
    const stages = [{ statement: 'Build the phrase.', stageRecord: 'The current phrase is complete.',
      relations: [], workspaceForest: [rename(tree)] }];
    const steps = prepareReplay({ derivationStages: stages, sentence: 'the small cat sleeps soundly', includePlayback: true }).playbackSteps;
    const groups = buildStageLayoutGroups(steps, stages);
    const size = stageTreeLayoutSize(steps, 0, width, height, groups);
    const reservations = buildStageCoordinateReservations(steps, 0, size, () => size);
    const last = steps.at(-1), visible = new Set(last.replayVisibleNodeIds);
    const root = layoutSyntaxTree(d3.hierarchy(last.replayCanvasData), size, 'ltr', reservations.get(last.replayCanvasData), visible);
    snapshots.push(['subject', 'nominal'].map(id => {
      const parent = root.descendants().find(node => getNodeId(node) === prefix + id);
      return parent.descendants().filter(node => visible.has(getNodeId(node))).map(node =>
        [getNodeId(node).slice(prefix.length), Math.round((node.x - parent.x) * 1e6), Math.round((node.y - parent.y) * 1e6)]);
    }));
  }
  for (const shape of snapshots.slice(1)) assert.deepEqual(shape, snapshots[0]);
});

const waitingRelative = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/relative-clause-waiting-clearance.json', import.meta.url)));
for (const [width, height] of [[1600, 948], [390, 844]]) for (const direction of ['ltr', 'rtl']) {
  test(`${width}px ${direction}: a waiting relative clause clears existing words without losing continuity`, () => {
    const authored = JSON.stringify(waitingRelative);
    const steps = prepareReplay({ ...waitingRelative, includePlayback: true }).playbackSteps;
    const groups = buildStageLayoutGroups(steps, waitingRelative.derivationStages);
    const sizes = new Map(waitingRelative.derivationStages.map((_, i) => [i, stageTreeLayoutSize(steps, i, width, height, groups)]));
    const coordinates = new Map([...sizes].flatMap(([i, size]) =>
      [...buildStageCoordinateReservations(steps, i, size, i => sizes.get(i), direction)]));
    const render = (scene, points) => {
      const visible = new Set(scene.step.replayVisibleNodeIds);
      return layoutSyntaxTree(d3.hierarchy(scene.canvas), sizes.get(scene.step.replayFrameIndex), direction, points, visible)
        .descendants().filter(node => visible.has(getNodeId(node)) && !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace');
    };
    const scenes = steps.map(step => {
      const scene = { step, canvas: step.replayCanvasData };
      return { ...scene, nodes: new Map(render(scene, coordinates.get(scene.canvas)).map(node => [getNodeId(node), node])) };
    });
    assert.deepEqual(workspaceContinuityReflows(scenes, coordinates, render), []);
    assert.equal(JSON.stringify(waitingRelative), authored);
  });
}
