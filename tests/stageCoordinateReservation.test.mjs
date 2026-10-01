import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { buildRenderableDerivationCanvasData } from '../replay/replayCompiler.ts';
import { buildStageCameraBounds, buildReplayPlaqueLayouts, measureStagePlaqueSpace, stageTreeLayoutSize } from '../replay/stageCamera.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { projectPlaqueLayout } from '../replay/relations/plaquePlacement.ts';
import { plaqueTreeObstacles, plaquesOverlap } from '../replay/relations/plaquePlacement.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';

const branch = (id, children) => ({ id, label: 'XP', children });
const leaf = (id, word) => ({ id, label: 'X', word });
const clause = prefix => branch(`${prefix}-clause`, [leaf(`${prefix}-subject`, 'someone'),
  branch(`${prefix}-bar`, [leaf(`${prefix}-head`, 'will'),
    branch(`${prefix}-vp`, [leaf(`${prefix}-verb`, 'read'), leaf(`${prefix}-object`, 'books')])])]);
const left = clause('left'), right = clause('right');
const coordinate = current => branch('coordination', [current, leaf('and', 'and'), right]);
const snapshots = [coordinate(left), coordinate({ ...left, children: [left.children[0],
  { ...left.children[1], children: [branch('left-head', [leaf('raised-verb', 'read'), leaf('tense', 'will')]), left.children[1].children[1]] }] })];
snapshots.push(coordinate(branch('left-cp', [branch('c-head', [leaf('raised-tense', 'will'), leaf('c', 'C')]), snapshots[1].children[0]])));

const stepsFor = canvases => canvases.map((canvas, replayStageStepIndex) => ({
  replayFrameIndex: 0, replayStageStepIndex, replayKind: replayStageStepIndex === canvases.length - 1 ? 'macro' : 'relation',
  replayCanvasData: buildRenderableDerivationCanvasData([canvas]),
  replayRelationLinks: [],
})).map(step => ({ ...step, replayVisibleNodeIds: d3.hierarchy(step.replayCanvasData).descendants().map(node => node.data.id) }));
const laidOut = (step, steps, size, direction = 'ltr', reserve = true) => {
  const root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
  const reservation = reserve ? buildStageCoordinateReservations(steps, 0, size).get(step.replayCanvasData) : undefined;
  return layoutSyntaxTree(root, size, direction, reservation, new Set(step.replayVisibleNodeIds));
};
const positions = tree => new Map(tree.descendants().map(node => [getNodeId(node), { x: node.x, y: node.y }]));

for (const [width, height] of [[1596, 1016], [386, 698]]) for (const direction of ['ltr', 'rtl']) {
  test(`${width}px ${direction}: new head complexes leave the other conjunct and retained syntax in place`, () => {
    const steps = stepsFor(snapshots), original = structuredClone(steps);
    const size = stageTreeLayoutSize(steps, 0, width, height);
    assert.notDeepEqual(positions(laidOut(steps[0], steps, size, direction, false)).get('right-object'),
      positions(laidOut(steps.at(-1), steps, size, direction, false)).get('right-object'), 'control reproduces the tidy-tree shift');
    const pointAtStart = positions(laidOut(steps[0], steps, size, direction));
    for (const step of steps) {
      const tree = laidOut(step, steps, size, direction), current = positions(tree);
      for (const id of ['right-clause', 'right-subject', 'right-head', 'right-verb', 'right-object', 'and']) {
        assert.deepEqual(pointAtStart.get(id), current.get(id), `${id} retains one slot across the stage`);
      }
      for (const link of tree.links()) assert(link.target.y > link.source.y, 'current branches keep pointing down');
      assert.deepEqual(tree.links().map(link => [link.source.data.id, link.target.data.id]),
        d3.hierarchy(step.replayCanvasData).links().map(link => [link.source.data.id, link.target.data.id]), 'no future parent subdivides a current branch');
    }
    assert.equal(steps[0].replayVisibleNodeIds.includes('raised-verb'), false, 'reservation never reveals the future landing');
    assert.equal(steps[0].replayVisibleNodeIds.includes('left-cp'), false, 'reservation never reveals a future parent');
    assert.deepEqual(steps, original, 'source snapshots and visibility are immutable');
    const reversed = [...steps].reverse();
    for (const step of steps) assert.deepEqual(positions(laidOut(step, reversed, size, direction)), positions(laidOut(step, steps, size, direction)));
  });
}

for (const direction of ['ltr', 'rtl']) test(`${direction}: a later wrapper cannot stretch one current daughter`, () => {
  const sister = clause('sister'), core = clause('core');
  const before = branch('root', [sister, core]);
  const after = branch('root', [sister, branch('wrapper', [core, leaf('adjunct', 'today')])]);
  const steps = stepsFor([before, before, after]);
  const size = stageTreeLayoutSize(steps, 0, 1596, 1016);
  const first = positions(laidOut(steps[0], steps, size, direction));
  const repeated = positions(laidOut(steps[1], steps, size, direction));
  const last = positions(laidOut(steps[2], steps, size, direction));
  assert.deepEqual(first, repeated);
  assert.equal(first.get('sister-clause').y, first.get('core-clause').y);
  for (const node of d3.hierarchy(sister).descendants()) assert.deepEqual(first.get(node.data.id), last.get(node.data.id));
  const dy = last.get('core-clause').y - first.get('core-clause').y;
  for (const node of d3.hierarchy(core).descendants()) {
    assert(Math.abs(last.get(node.data.id).y - first.get(node.data.id).y - dy) < 1e-8, 'the whole earlier subtree retains its branch lengths');
  }
});

for (const direction of ['ltr', 'rtl']) test(`${direction}: root growth keeps the earlier fork at its daughters' current rank`, () => {
  const head = leaf('head', 'will'), complement = clause('complement');
  const before = branch('root', [head, complement]);
  const after = branch('root', [leaf('specifier', 'someone'), branch('bar', [head, complement])]);
  const steps = stepsFor([before, before, after]);
  const size = stageTreeLayoutSize(steps, 0, 1596, 1016);
  const first = positions(laidOut(steps[0], steps, size, direction));
  const last = positions(laidOut(steps[2], steps, size, direction));
  assert.deepEqual(first.get('root'), last.get('bar'), 'the current fork occupies one normal rank above its daughters');
  assert.deepEqual(first.get('head'), last.get('head'), 'the head does not move when its new parent appears');
  assert.deepEqual(first.get('complement-clause'), last.get('complement-clause'), 'the complement stays put');
  assert.deepEqual(first, positions(laidOut(steps[1], steps, size, direction)), 'repeated frames retain the same shape');
  assert(!steps[0].replayVisibleNodeIds.includes('bar'), 'the later fork remains absent until growth');
});

test('an authored relocation keeps its earlier attachment until movement while unrelated syntax stays fixed', () => {
  const mover = branch('mover', [leaf('mover-word', 'books')]);
  const before = branch('clause', [leaf('subject', 'Ada'), branch('predicate', [leaf('verb', 'reads'), mover])]);
  const after = branch('clause', [mover, branch('new-parent', [leaf('subject', 'Ada'),
    branch('predicate', [leaf('verb', 'reads'), leaf('lower-copy', 'books')])])]);
  const steps = stepsFor([before, before, after]);
  const size = stageTreeLayoutSize(steps, 0, 1596, 1016);
  const first = positions(laidOut(steps[0], steps, size)), second = positions(laidOut(steps[1], steps, size));
  const last = positions(laidOut(steps[2], steps, size));
  assert.deepEqual(first, second, 'prior source geometry is stable before the move');
  assert.notDeepEqual(first.get('mover'), last.get('mover'), 'the source does not take its landing slot prematurely');
  assert(first.get('mover').y > first.get('predicate').y, 'the source is still beneath its original parent');
  assert.deepEqual(first.get('verb'), last.get('verb'), 'the unchanged predicate head stays in place');
  for (const step of steps) for (const link of laidOut(step, steps, size).links()) assert(link.target.y > link.source.y);
});

test('a replaced source wrapper retains its earlier children instead of placing them above their parent', () => {
  const children = [leaf('one', 'one'), leaf('two', 'two')];
  const before = branch('root', [leaf('head', 'head'), branch('old-wrapper', children)]);
  const after = branch('root', [branch('new-wrapper', children), branch('bar', [leaf('head', 'head'), leaf('copy', 'copy')])]);
  const steps = stepsFor([before, after]);
  const tree = laidOut(steps[0], steps, stageTreeLayoutSize(steps, 0, 1596, 1016));
  for (const link of tree.links()) assert(link.target.y > link.source.y, `${link.source.data.id}/${link.target.data.id}`);
});

test('promotion out of a removed wrapper preserves the source branch before the move', () => {
  const a = leaf('a', 'a'), b = leaf('b', 'b'), c = leaf('c', 'c');
  const steps = stepsFor([branch('root', [branch('old', [a, b]), c]), branch('root', [a, branch('new', [b, c])])]);
  for (const step of steps) for (const link of laidOut(step, steps, [1200, 800]).links()) {
    assert(link.target.y > link.source.y, `${link.source.data.id}/${link.target.data.id} must remain downward`);
  }
});

test('a child becoming a root cannot reuse a missing parent attachment', () => {
  const steps = stepsFor([branch('old-parent', [leaf('a', 'a')]), branch('a', [leaf('old-parent', 'old')])]);
  const maps = buildStageCoordinateReservations(steps, 0, [1200, 800]);
  assert.equal(maps.size, 2);
  for (const points of maps.values()) for (const point of points.values()) assert(Number.isFinite(point.x) && Number.isFinite(point.y));
});

test('a reserved sibling cannot bend a currently unary branch toward its empty landing', () => {
  const a = leaf('a', 'a'), b = leaf('b', 'b');
  const steps = stepsFor([branch('root', [a, { ...b, replayLayoutOnly: true }]), branch('root', [a, b])]);
  const before = positions(laidOut(steps[0], steps, [1200, 800]));
  const after = positions(laidOut(steps[1], steps, [1200, 800]));
  assert.equal(before.get('root').x, before.get('a').x);
  assert.equal(after.get('root').x, (after.get('a').x + after.get('b').x) / 2);
  assert.deepEqual(before.get('a'), after.get('a'), 'the retained child does not move when the parent becomes binary');
});

test('an unrevealed real sibling cannot bend the currently visible unary branch', () => {
  const steps = stepsFor([branch('root', [leaf('a', 'a'), leaf('b', 'b')]), branch('root', [leaf('a', 'a'), leaf('b', 'b')])]);
  steps[0].replayVisibleNodeIds = steps[0].replayVisibleNodeIds.filter(id => !id.startsWith('b'));
  const before = positions(laidOut(steps[0], steps, [1200, 800]));
  const after = positions(laidOut(steps[1], steps, [1200, 800]));
  assert.equal(before.get('root').x, before.get('a').x);
  assert.equal(after.get('root').x, (after.get('a').x + after.get('b').x) / 2);
  assert.deepEqual(before.get('a'), after.get('a'));
});

test('an authored sibling reordering receives separate contour slots without losing either order', () => {
  const a = leaf('a', 'a'), b = leaf('b', 'b');
  const steps = stepsFor([branch('root', [a, b]), branch('root', [b, a])]);
  for (const step of steps) {
    const tree = laidOut(step, steps, [1200, 800]);
    assert(tree.children[0].x < tree.children[1].x, 'each authored order keeps its two branches');
  }
});

test('an invisible future parent reserves separate workspace contours without appearing', () => {
  const source = { ...branch('cp', [branch('tp', [branch('vp', [
    branch('subject', [leaf('subject-word', 'Taro'), leaf('subject-case', 'ga')]),
    branch('vbar', [branch('v', [branch('object', [leaf('object-word', 'hon'), leaf('object-case', 'o')]),
      leaf('verb', 'read')]), { id: 'light', label: 'v' }])]), { id: 'tense', label: 'T' }]),
  { id: 'c', label: 'C[declarative]' }]), replayLayoutOnly: true };
  const steps = stepsFor([source, source]);
  steps.forEach(step => { step.replayVisibleNodeIds = step.replayVisibleNodeIds.filter(id => id !== 'cp'); });
  const original = structuredClone(steps);
  for (const [width, height] of [[1596, 1016], [390, 844]]) {
    const size = stageTreeLayoutSize(steps, 0, width, height);
    for (const step of steps) {
      const tree = laidOut(step, steps, size), obstacles = plaqueTreeObstacles(tree.descendants());
      const c = obstacles.find(obstacle => obstacle.connectorAttachment === 'c:category').connectorInk;
      const tp = obstacles.find(obstacle => obstacle.connectorAttachment === 'tp:category').connectorInk;
      assert(!plaquesOverlap(c, tp, 0), 'the independent C and TP labels retain separate spaces');
      assert(!step.replayVisibleNodeIds.includes('cp'), 'reserving the future attachment does not reveal it');
    }
  }
  assert.deepEqual(steps, original);
});

for (const [width, height] of [[1596, 1016], [390, 844]]) {
  test(`${width}px: the full earlier subject contour remains clear of a later head complex`, () => {
    const record = JSON.parse(fs.readFileSync(new URL('../fixtures/visual-relations/successive-head-movement.json', import.meta.url)));
    const steps = prepareReplay({ ...record, includePlayback: true }).playbackSteps;
    const stage = 2, size = stageTreeLayoutSize(steps, stage, width, height);
    const reservations = buildStageCoordinateReservations(steps, stage, size);
    let checked = 0;
    for (const step of steps.filter(step => step.replayFrameIndex === stage)) {
      const root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
      const visible = new Set(step.replayVisibleNodeIds);
      const tree = layoutSyntaxTree(root, size, 'ltr', reservations.get(step.replayCanvasData), visible);
      const nodes = tree.descendants().filter(node => visible.has(getNodeId(node)));
      const subject = nodes.find(node => getNodeId(node) === 'sm');
      const head = nodes.find(node => getNodeId(node) === 'cm');
      if (!subject || !head || getNodeId(subject.parent) !== 'ipm') continue;
      const obstacles = plaqueTreeObstacles(nodes);
      const subjectInk = obstacles.find(obstacle => obstacle.connectorAttachment === 'sm:category').connectorInk;
      const headInk = obstacles.filter(obstacle => obstacle.connectorAttachment === 'cm:category' && obstacle.blocksConnectors);
      assert(headInk.every(ink => !plaquesOverlap(subjectInk, ink, 0)), 'the visible DP and wrapped C feature label must not overlap');
      for (const node of nodes) {
        if (node.parent && visible.has(getNodeId(node.parent))) assert(node.y > node.parent.y);
        const children = (node.children ?? []).filter(child => visible.has(getNodeId(child)));
        for (let index = 1; index < children.length; index++) assert(children[index - 1].x < children[index].x);
      }
      checked++;
    }
    assert(checked >= 3, 'the regression must exercise the source before and after head adjunction');
  });
}

test('plaque allocation, camera bounds and painted nodes use the same reserved coordinates', () => {
  const steps = stepsFor(snapshots);
  const stage = { statement: 'The clauses are complete.', stageRecord: 'The head assigns Case.', workspaceForest: [snapshots.at(-1)],
    relations: [{ relation: 'CaseAssignment', anchors: { assigner: 'right-verb', bearer: 'right-object' }, values: { feature: 'Case', value: 'ACC' } }] };
  const plan = compileRelationRenderPlan([stage]);
  assert(plan.frames[0].items.some(item => item.kind === 'directed-path' && item.pathStyle === 'case-assignment'),
    'control needs a real Case plaque and its assigning path');
  for (const [width, height] of [[1596, 1016], [386, 698]]) for (const direction of ['ltr', 'rtl']) {
    const input = { steps, stageIndex: 0, completedCanvas: steps.at(-1).replayCanvasData, plan, width, height, direction };
    const space = measureStagePlaqueSpace(input);
    const size = stageTreeLayoutSize(steps, 0, width, height);
    const placements = buildReplayPlaqueLayouts(input)[0];
    assert(placements.size > 0);
    const bounds = buildStageCameraBounds({ ...input, plaqueLayout: placements });
    let firstRects;
    for (const [index, step] of steps.entries()) {
      const tree = laidOut(step, steps, size, direction), nodes = new Map(tree.descendants().map(node => [getNodeId(node), node]));
      for (const measured of space.scenes[index].nodes) assert.deepEqual({ x: measured.x, y: measured.y }, positions(tree).get(getNodeId(measured)));
      const rects = projectPlaqueLayout(placements, id => nodes.get(id) ?? null);
      if (firstRects) assert.deepEqual(rects, firstRects, 'the unchanged owner keeps the plaque and connector ports fixed');
      firstRects = rects;
      for (const rect of rects.values()) {
        assert(rect.x >= bounds.minX && rect.x + rect.width <= bounds.maxX);
        assert(rect.y >= bounds.minY && rect.y + rect.height <= bounds.maxY);
      }
      for (const node of tree.descendants()) assert(node.x >= bounds.minX && node.x <= bounds.maxX
        && node.y >= bounds.minY && node.y <= bounds.maxY);
    }
  }
});


test('later stages cannot stretch earlier branches or enlarge their layout budget', () => {
  const early = stepsFor([branch('early', [leaf('a', 'the'), leaf('b', 'students')])]);
  const later = stepsFor([coordinate(snapshots.at(-1))]).map(step => ({ ...step, replayFrameIndex: 1 }));
  const full = [...early, ...later];
  for (const [width, height] of [[1596, 1016], [390, 844]]) {
    const size = stageTreeLayoutSize(early, 0, width, height);
    assert.deepEqual(stageTreeLayoutSize(full, 0, width, height), size);
    assert.deepEqual(positions(laidOut(early[0], full, size)), positions(laidOut(early[0], early, size)),
      'unrelated later syntax must not change early branch proportions');
  }
});
