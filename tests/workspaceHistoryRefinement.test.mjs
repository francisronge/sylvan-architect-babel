import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { buildStageLayoutGroups, stageTreeLayoutSize } from '../replay/stageCamera.ts';
import { getCoherentWorkspaceDiagnostics, reserveWorkspaceAttachments } from '../replay/workspacePlacement.ts';
import { compactCurrentRootForks } from '../replay/currentRootCompaction.ts';
import { retainMovementSourceSlots } from '../replay/movementSourceContinuity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { workspaceContinuityReflows } from '../replay/workspaceShapeReflows.ts';
import { earlierWorkspaceForks, prepareWorkspaceHistoryGuard, WORKSPACE_HISTORY_EVALUATION_LIMIT } from '../replay/workspaceHistoryRefinement.ts';

const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/nested-premovement-width.json', import.meta.url)));
const close = (a, b, message) => assert(Math.abs(a - b) <= 1e-6, `${message}: ${a} vs ${b}`);
const widthOf = nodes => Math.max(...nodes.map(node => node.x)) - Math.min(...nodes.map(node => node.x));
function setup(input, width, height, direction) {
  const steps = prepareReplay({ ...input, includePlayback: true }).playbackSteps;
  const groups = buildStageLayoutGroups(steps, input.derivationStages);
  const sizes = new Map(input.derivationStages.map((_, stage) => [stage, stageTreeLayoutSize(steps, stage, width, height, groups)]));
  const points = new Map();
  for (const [stage, size] of sizes) for (const [canvas, coords] of buildStageCoordinateReservations(steps, stage, size,
    stage => sizes.get(stage), direction)) points.set(canvas, coords);
  const render = (step, coords = points.get(step.replayCanvasData)) => {
    const root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
    const visible = new Set(step.replayVisibleNodeIds);
    return layoutSyntaxTree(root, sizes.get(step.replayFrameIndex), direction, coords, visible).descendants()
      .filter(node => visible.has(getNodeId(node)) && !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace');
  };
  const reserved = reserveWorkspaceAttachments(steps, sizes, direction, () => { throw Error('expected the prepared plan'); });
  const preceding = compactCurrentRootForks(steps, sizes, reserved);
  return { steps, sizes, points, preceding, render, diagnostic: getCoherentWorkspaceDiagnostics(steps)[0] };
}

for (const [width, height] of [[1600, 948], [390, 844]]) for (const direction of ['ltr', 'rtl']) {
  test(`${width}px ${direction}: head movement retains its source slot without a stretched earlier branch`, () => {
    const source = JSON.stringify(record), { steps, sizes, points, preceding, render, diagnostic } = setup(record, width, height, direction);
    assert.deepEqual(retainMovementSourceSlots([...steps].reverse(), sizes, new Map(preceding), direction), points,
      'source slots follow authored Replay order even when measurement visits frames in reverse');
    assert.equal(steps.length, 62);
    assert.equal(diagnostic.status, 'resolved');
    assert.equal(diagnostic.historyCorrections, 1);
    assert(diagnostic.historyEvaluations <= WORKSPACE_HISTORY_EVALUATION_LIMIT);
    const macros = steps.filter(step => step.replayKind === 'macro');
    const oldWidths = [10381.390635558395, 6950.625713752567, 6430.856223175966, 8319.980901287554];
    const before = new Map(render(macros[0]).map(node => [getNodeId(node), node]));
    const movement = new Map(render(steps[55]).map(node => [getNodeId(node), node]));
    close(before.get('matrixVerbBase').x, movement.get('matrixVerbTrace').x, 'the lower occurrence stays at the original source');
    close(before.get('matrixI').x, movement.get('matrixI').x, 'the receiving head opens at its existing center');
    close(before.get('matrixVBar').x, movement.get('matrixVBar').x, 'the source fork no longer contracts at movement');
    assert.equal(before.get('matrixVerbBase').data.word, 'sagte', 'source pronunciation is retained before movement');
    for (let index = 55; index < steps.length; index++) assert.deepEqual(points.get(steps[index].replayCanvasData),
      preceding.get(steps[index].replayCanvasData), 'movement and later frames keep their established layout');
    for (const id of ['matrixVerbBase', 'matrixI']) {
      const initial = new Map(render(macros[0], preceding.get(macros[0].replayCanvasData)).map(node => [getNodeId(node), node]));
      const delta = before.get(id).x - initial.get(id).x;
      for (const step of steps.slice(0, 55)) {
        const now = new Map(render(step).map(node => [getNodeId(node), node]));
        const old = new Map(render(step, preceding.get(step.replayCanvasData)).map(node => [getNodeId(node), node]));
        if (now.has(id)) close(now.get(id).x - old.get(id).x, delta, `${id} uses one translation throughout construction`);
      }
    }
    const gap = Math.abs(before.get('embeddedCP').x - before.get('matrixVerbBase').x);
    assert(gap < 6500, `old8099 gap is materially reduced: ${gap}`);
    assert(widthOf([...before.values()]) < 9000, 'the complete earlier tree also becomes narrower');
    macros.forEach((step, index) => assert(widthOf(render(step)) <= oldWidths[index] + 1e-6, `stage${index + 1} must not pay for the earlier reduction`));
    const scenes = steps.map(step => ({ step, canvas: step.replayCanvasData, nodes: new Map(render(step).map(node => [getNodeId(node), node])) }));
    assert.deepEqual(workspaceContinuityReflows(scenes, points, (scene, coords) => render(scene.step, coords)), [],
      'all construction lifetimes and unowned syntax remain rigid');
    for (const step of steps) for (const node of render(step)) {
      const children = (node.children ?? []).filter(child => step.replayVisibleNodeIds.includes(getNodeId(child)) && !child.data.replayLayoutOnly);
      for (const child of children) assert(child.y > node.y);
      for (let index = 1; index < children.length; index++) assert(direction === 'ltr'
        ? children[index].x > children[index - 1].x : children[index].x < children[index - 1].x);
    }
    for (const zoom of [0.4, 1, 2]) {
      const finalBefore = before.get('embeddedCP');
      const after = new Map(render(steps[55]).map(node => [getNodeId(node), node]));
      for (const node of finalBefore.descendants()) {
        const id = getNodeId(node);
        close((node.x - finalBefore.x) * zoom, (after.get(id).x - after.get('embeddedCP').x) * zoom, 'embedded material keeps its internal geometry during movement and zoom');
        close(node.y - finalBefore.y, after.get(id).y - after.get('embeddedCP').y, 'embedded ranks stay fixed');
      }
    }
    assert.equal(JSON.stringify(record), source, 'authored syntax, explanation and relations are untouched');
  });
}

const tree = (id, ...children) => ({ id, children });
const points = rows => new Map(rows.map(([id, x, y = 0]) => [id, { x, y }]));
function frame(roots, positions, step = { replayKind: 'macro', replayCanvasData: {} }) {
  const nodes = new Map();
  const visit = node => {
    const children = node.children.map(visit), origin = positions.get(node.id), members = new Map([[node.id, { x: 0, y: 0 }]]);
    for (const child of children) for (const [id, point] of child.members) {
      const offset = positions.get(child.id); members.set(id, { x: point.x + offset.x - origin.x, y: point.y + offset.y - origin.y });
    }
    const result = { id: node.id, incarnation: nodes.size, first: 0, last: 0, children, members, obstacles: [] };
    nodes.set(node.id, result); return result;
  };
  return { roots: roots.map(visit), nodes, step };
}
function guardFixture() {
  const roots = [tree('root', tree('left'), tree('right'))];
  const initial = points([['root', 0], ['left', -200, 200], ['right', 200, 200]]);
  const later = points([['root', 0], ['left', -100, 200], ['right', 100, 200]]);
  const frames = [frame(roots, initial), frame(roots, later), frame(roots, later)];
  const references = new Map(frames.map(f => [f.step.replayCanvasData, later]));
  const coordinates = [initial, later, later];
  return { roots, initial, later, frames, coordinates, guard: prepareWorkspaceHistoryGuard(frames, references, coordinates) };
}
test('history refinement accepts an earlier reduction while keeping the final contour', () => {
  const { roots, later, frames, guard } = guardFixture();
  assert.equal(guard.contours([frame(roots, later, frames[0].step), ...frames.slice(1)]), true);
});

for (const control of ['not-movement', 'stale-claim', 'different-parent']) test(`source-slot continuity rejects ${control}`, () => {
  const { steps, sizes, preceding } = setup(record, 1600, 948, 'ltr');
  const changed = steps.map(step => ({ ...step, replayRelationLinks: step.replayRelationLinks.map(link => ({ ...link,
    ...(control === 'not-movement' ? { movementTransition: false }
      : control === 'stale-claim' ? { authoredRelationKey: 'unrelated:0' } : { witnessNodeId: 'embeddedC' })
  })) }));
  const baseline = new Map(preceding);
  assert.equal(retainMovementSourceSlots(changed, sizes, baseline), baseline);
});
test('history refinement cannot transfer width to another completed stage', () => {
  const { roots, later, frames, guard } = guardFixture();
  const expanded = points([['root', 0], ['left', -130, 200], ['right', 130, 200]]);
  assert.equal(guard.contours([frame(roots, later, frames[0].step), frame(roots, expanded, frames[1].step), frames[2]]), false);
});
test('narrower total width cannot hide a worsened individual branch', () => {
  const roots = [tree('root', tree('left', tree('a'), tree('b')), tree('right'))];
  const reference = points([['root', 0], ['left', -100, 200], ['right', 100, 200], ['a', -110, 400], ['b', -90, 400]]);
  const expanded = points([['root', 0], ['left', -200, 200], ['right', 200, 200], ['a', -210, 400], ['b', -190, 400]]);
  const candidate = points([['root', 0], ['left', -100, 200], ['right', 100, 200], ['a', -130, 400], ['b', -70, 400]]);
  const before = frame(roots, expanded), final = frame(roots, reference);
  const guard = prepareWorkspaceHistoryGuard([before, final], new Map([[before.step.replayCanvasData, reference], [final.step.replayCanvasData, reference]]), [expanded, reference]);
  assert.equal(guard.contours([frame(roots, candidate, before.step), final]), false);
});
for (const field of ['x', 'y']) test(`history refinement cannot change final internal ${field} coordinates`, () => {
  const { roots, frames, later, guard } = guardFixture();
  const moved = new Map([...later].map(([id, point]) => [id, { ...point }])); moved.get('left')[field] += 10;
  assert.equal(guard.contours([...frames.slice(0, -1), frame(roots, moved, frames.at(-1).step)]), false);
});
test('independent roots cannot spread out behind unchanged internal contours', () => {
  const { frames, guard, coordinates } = guardFixture();
  const roots = [tree('one'), tree('two')], initial = points([['one', 0], ['two', 500]]), spread = points([['one', -50], ['two', 550]]);
  const final = frame(roots, initial), check = prepareWorkspaceHistoryGuard([frames[0], final], new Map([[frames[0].step.replayCanvasData, coordinates[0]], [final.step.replayCanvasData, initial]]), [coordinates[0], initial]);
  assert.equal(check.contours([frames[0], frame(roots, spread, final.step)]), true);
  assert.equal(check.placement([coordinates[0], spread]), false);
  assert.equal(guard.placement(coordinates), true);
});
test('only a completed fork ending at current proved movement is eligible', () => {
  const { frames, later } = guardFixture();
  const part = frames[0].roots[0], references = new Map([[part.incarnation, later]]);
  part.last = 0;
  const movement = { replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 0 }, replayRelationLinks: [{ authoredRelationKey: '1:0', movementTransition: true, priorSourceNodeId: 'left', witnessNodeId: 'left', targetNodeId: 'right' }] };
  frames[1].step = movement;
  assert.equal(earlierWorkspaceForks(frames, [part], references).length, 1);
  frames[1].step = { ...movement, replayKind: 'micro', operation: 'ExternalMerge' };
  assert.deepEqual(earlierWorkspaceForks(frames, [part], references), []);
  frames[1].step = { ...movement, replayRelationLinks: [{ ...movement.replayRelationLinks[0], authoredRelationKey: '0:0' }] };
  assert.deepEqual(earlierWorkspaceForks(frames, [part], references), []);
  frames[1].step = movement; part.last = frames.length - 1;
  assert.deepEqual(earlierWorkspaceForks(frames, [part], references), []);
});

test('opaque occurrence IDs preserve the saved reduction', () => {
  const ids = new Set();
  const visit = node => { ids.add(node.id); node.children?.forEach(visit); };
  record.derivationStages.forEach(stage => stage.workspaceForest.forEach(visit));
  const renamed = JSON.parse(JSON.stringify(record, (_, value) => typeof value === 'string' && ids.has(value) ? `opaque/${value}` : value));
  const original = setup(record, 1600, 948, 'ltr'), changed = setup(renamed, 1600, 948, 'ltr');
  assert.equal(changed.steps.length, original.steps.length);
  assert.equal(changed.diagnostic.historyCorrections, 1);
  original.steps.forEach((step, index) => {
    const before = new Map(original.render(step).map(node => [getNodeId(node), node]));
    const after = new Map(changed.render(changed.steps[index]).map(node => [getNodeId(node), node]));
    for (const [id, point] of before) {
      const next = after.get(`opaque/${id}`);
      assert(next, `renamed occurrence ${id} exists`);
      close(next.x, point.x, 'opaque IDs keep horizontal layout'); close(next.y, point.y, 'opaque IDs keep ranks');
    }
  });
});

test('a final middle root cannot shift behind unchanged forest width', () => {
  const roots = [tree('one'), tree('two'), tree('three')];
  const before = points([['one', 0], ['two', 250], ['three', 500]]);
  const after = points([['one', 0], ['two', 300], ['three', 500]]);
  const final = frame(roots, before);
  const guard = prepareWorkspaceHistoryGuard([final], new Map([[final.step.replayCanvasData, before]]), [before]);
  assert.equal(guard.contours([frame(roots, after, final.step)]), true);
  assert.equal(guard.placement([after]), false);
  const translated = new Map([...before].map(([id, point]) => [id, { x: point.x + 100, y: point.y + 20 }]));
  assert.equal(guard.placement([translated]), true);
});
