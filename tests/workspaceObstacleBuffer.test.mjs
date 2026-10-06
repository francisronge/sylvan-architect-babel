import assert from 'node:assert/strict';
import test from 'node:test';
import { composeWorkspaceObstacleBuffer, workspaceObstacleBuffer } from '../replay/workspaceObstacleBuffer.ts';
import { translateWorkspaceObstacles } from '../replay/workspaceObstacleTranslation.ts';
import { plaqueBranchObstacles } from '../replay/relations/plaquePlacement.ts';
import { createWorkspaceContourPairPreparer, prepareWorkspaceContourPair, workspaceContourPairCollision } from '../replay/workspaceContourPairs.ts';
import { currentForkBranchCollision } from '../replay/workspaceForkClearance.ts';

test('nested buffered contours preserve exact ordered translation, metadata, curves and signed zero', () => {
  const own = [{ x: -0, y: -0, width: 20, height: 12, terminalStemNodeId: 'word',
    connectorInk: { x: 1, y: 2, width: 3, height: 4 }, blocksConnectors: false }];
  let expected = own, actual = workspaceObstacleBuffer(own);
  for (const [x, y] of [[1 / 3, -0], [2 ** 53, 220], [-(2 ** 53), 1 / 7], [-0, -0]]) {
    const branches = plaqueBranchObstacles({ x: 0, y: 0 }, { x, y }, true);
    expected = [...own, ...translateWorkspaceObstacles(expected, x, y), ...branches];
    actual = composeWorkspaceObstacleBuffer(own, [{ obstacles: actual, x, y }], branches);
  }
  assert.deepEqual(actual.rectangles(), expected);
  assert.equal(actual.rectangle(0), actual.rectangle(0));
  assert.equal(actual.rectangles(), actual.rectangles());
  assert.equal(actual.rectangle(1).connectorInk, own[0].connectorInk);
  const curveRects = actual.rectangles().filter(rect => rect.curve);
  assert.equal(curveRects[0].curve, curveRects[1].curve);
});

test('buffered pair separation and exact first witnesses match object contours across translated candidates', () => {
  const prepare = createWorkspaceContourPairPreparer();
  const own = [{ x: -25, y: -15, width: 50, height: 20 }];
  const branches = plaqueBranchObstacles({ x: 0, y: 0 }, { x: 120, y: 220 }, true);
  const left = composeWorkspaceObstacleBuffer(own, [], branches);
  for (const x of [-100, -0, 0, 1 / 3, 100, 2 ** 53]) {
    const right = composeWorkspaceObstacleBuffer([], [{ obstacles: left, x, y: 0 }], []);
    const actual = prepare(left, right), expected = prepareWorkspaceContourPair(left.rectangles(), right.rectangles());
    assert.ok(Object.is(actual.separation, expected.separation));
    for (const dx of [-400, -100, -0, 0, 1 / 7, 100, 400])
      assert.deepEqual(workspaceContourPairCollision(actual, dx), workspaceContourPairCollision(expected, dx));
  }
});

test('finite and nonfinite exceptional bounds preserve the original pair fallback and fork contact order', () => {
  const prepare = createWorkspaceContourPairPreparer();
  for (const y of [-0, NaN, Infinity, -Infinity, Number.MAX_VALUE]) {
    const a = [{ x: -5, y, width: 20, height: y === Number.MAX_VALUE ? y : 10 }];
    const b = [{ x: -10, y: 0, width: 40, height: 20 }];
    const actual = prepare(workspaceObstacleBuffer(a), workspaceObstacleBuffer(b));
    const expected = prepareWorkspaceContourPair(a, b);
    assert.ok(Object.is(actual.separation, expected.separation));
    assert.deepEqual(workspaceContourPairCollision(actual, 0), workspaceContourPairCollision(expected, 0));
  }
  const parent = { x: 0, y: 0 };
  const children = [{ point: { x: -150, y: 212 }, obstacles: [] },
    { point: { x: 150, y: 212 }, obstacles: [{ x: -400, y: -190, width: 350, height: 170 }] }];
  const expected = currentForkBranchCollision(parent, children);
  assert.ok(expected);
  assert.deepEqual(currentForkBranchCollision(parent, children.map(child => ({ ...child,
    obstacles: workspaceObstacleBuffer(child.obstacles) }))), expected);
});

test('clear bounds queries do not materialize descendant rectangles, and later compositions retain earlier buffers', () => {
  const base = workspaceObstacleBuffer([{ x: 0, y: 0, width: 10, height: 10 }]);
  const left = composeWorkspaceObstacleBuffer([], [{ obstacles: base, x: 0, y: 0 }], []);
  const right = composeWorkspaceObstacleBuffer([], [{ obstacles: base, x: 100, y: 0 }], []);
  let materializations = 0;
  for (const buffer of [left, right]) {
    const original = buffer.rectangle.bind(buffer);
    buffer.rectangle = index => { materializations++; return original(index); };
  }
  assert.equal(workspaceContourPairCollision(createWorkspaceContourPairPreparer()(left, right), 0), undefined);
  assert.equal(currentForkBranchCollision({ x: 0, y: 0 }, [
    { point: { x: -100, y: 220 }, obstacles: left }, { point: { x: 100, y: 220 }, obstacles: right }
  ]), undefined);
  assert.equal(materializations, 0);
  const nested = composeWorkspaceObstacleBuffer([], [{ obstacles: left, x: 50, y: 70 }], []);
  assert.deepEqual(nested.rectangle(0), { x: 50, y: 70, width: 10, height: 10 });
  assert.deepEqual(left.rectangle(0), { x: 0, y: 0, width: 10, height: 10 });
});

test('translated native curves are deferred until contact and remain shared by their sampled bounds', () => {
  const branches = plaqueBranchObstacles({ x: 0, y: 0 }, { x: 100, y: 220 }, true);
  const base = workspaceObstacleBuffer(branches);
  let resolved = 0;
  const original = base.curve.bind(base);
  base.curve = index => { resolved++; return original(index); };
  const first = composeWorkspaceObstacleBuffer([], [{ obstacles: base, x: 1 / 3, y: 1 / 7 }], []);
  const nested = composeWorkspaceObstacleBuffer([], [{ obstacles: first, x: 2 ** 53, y: 220 }], []);
  const remote = workspaceObstacleBuffer([{ x: 0, y: -100, width: 10, height: 10 }]);
  assert.equal(workspaceContourPairCollision(createWorkspaceContourPairPreparer()(nested, remote), 0), undefined);
  assert.equal(resolved, 0);
  const expected = translateWorkspaceObstacles(translateWorkspaceObstacles(branches, 1 / 3, 1 / 7), 2 ** 53, 220);
  assert.deepEqual(nested.rectangle(0), expected[0]);
  assert.ok(resolved > 0);
  assert.equal(nested.rectangle(0).curve, nested.rectangle(1).curve);
  assert.deepEqual(nested.rectangles(), expected);
  assert.deepEqual(first.rectangles(), translateWorkspaceObstacles(branches, 1 / 3, 1 / 7));
});
