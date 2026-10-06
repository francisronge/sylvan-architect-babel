import test from 'node:test';
import assert from 'node:assert/strict';
import { translateWorkspaceObstacles, translateWorkspaceContourObstacles } from '../replay/workspaceObstacleTranslation.ts';
import { plaqueTreeObstacles } from '../replay/relations/plaquePlacement.ts';
import { cubicIntersectsRect } from '../replay/relations/curveClearance.ts';

const curve = () => ({ source: { x: -0, y: -17 }, control1: { x: -0, y: 98.5 },
  control2: { x: 2300, y: 98.5 }, target: { x: 2300, y: 214 } });
const box = (c = curve()) => ({ x: -5, y: -22, width: 2310, height: 241, curve: c, curvePadding: 5 });
// Frozen lifetime translator: keep both additions in sequential translations.
const legacy = (rect, dx, dy) => ({ ...rect, x: rect.x + dx, y: rect.y + dy,
  ...(rect.curve ? { curve: { source: { x: rect.curve.source.x + dx, y: rect.curve.source.y + dy },
    control1: { x: rect.curve.control1.x + dx, y: rect.curve.control1.y + dy },
    control2: { x: rect.curve.control2.x + dx, y: rect.curve.control2.y + dy },
    target: { x: rect.curve.target.x + dx, y: rect.curve.target.y + dy } } } : {}) });

function nativeBranches() {
  const parent = { data: { id: 'p', label: 'P' }, x: -35, y: -15, parent: null, children: [] };
  const child = { data: { id: 'n', label: 'N', word: 'word' }, x: 2100, y: 225, parent, children: [] };
  parent.children.push(child);
  return plaqueTreeObstacles([parent, child], undefined, true).filter(rect => rect.curve);
}

test('native sampled branches keep exact values and one translated curve per batch', () => {
  const source = nativeBranches(), before = structuredClone(source);
  assert.equal(source.length, 32);
  assert.equal(new Set(source.map(rect => rect.curve)).size, 1);
  const expected = source.map(rect => legacy(rect, -87.5, 440));
  for (const point of Object.values(source[0].curve)) Object.freeze(point);
  Object.freeze(source[0].curve);
  source.forEach(Object.freeze); Object.freeze(source);
  const actual = translateWorkspaceObstacles(source, -87.5, 440);
  assert.deepEqual(actual, expected);
  assert.deepEqual(source, before);
  assert.equal(new Set(actual.map(rect => rect.curve)).size, 1);
  assert.notEqual(actual[0].curve, source[0].curve);
  source.forEach((rect, index) => assert.notEqual(actual[index], rect));
  for (const key of Object.keys(source[0].curve)) assert.notEqual(actual[0].curve[key], source[0].curve[key]);
});

test('rectangles and unrelated metadata retain their original value and ownership rules', () => {
  const connectorInk = { x: 1, y: 2, width: 3, height: 4 };
  const source = [{ x: -0, y: 5, width: 6, height: 7, connectorInk, connectorAttachment: 'n:category',
    blocksConnectors: true, terminalStemNodeId: 'stem', extendsDownward: true },
    { x: 1, y: 2, width: 3, height: 4, curve: undefined }];
  const actual = translateWorkspaceObstacles(source, 4, -10);
  assert.deepEqual(actual, source.map(rect => legacy(rect, 4, -10)));
  assert.equal(actual[0].connectorInk, connectorInk);
  assert.equal(Object.hasOwn(actual[0], 'curve'), false);
  assert.equal(Object.hasOwn(actual[1], 'curve'), true);
  actual[0].x = 999;
  assert.ok(Object.is(source[0].x, -0));
});

test('equal-valued distinct input curves are not merged', () => {
  const a = curve(), b = curve(), source = [box(a), box(b), box(a)];
  const actual = translateWorkspaceObstacles(source, 0, 0);
  assert.deepEqual(actual, source.map(rect => legacy(rect, 0, 0)));
  assert.equal(actual[0].curve, actual[2].curve);
  assert.notEqual(actual[0].curve, actual[1].curve);
});

test('separate calls do not reuse geometry after source mutation or a changed offset', () => {
  const c = curve(), source = [box(c), box(c)];
  const first = translateWorkspaceObstacles(source, 10, 20), saved = structuredClone(first);
  c.source.x = 500;
  const second = translateWorkspaceObstacles(source, 10, 20);
  const third = translateWorkspaceObstacles(source, -10, -20);
  assert.deepEqual(second, source.map(rect => legacy(rect, 10, 20)));
  assert.deepEqual(third, source.map(rect => legacy(rect, -10, -20)));
  assert.deepEqual(first, saved);
  assert.notEqual(first[0].curve, second[0].curve);
  assert.notEqual(second[0].curve, third[0].curve);
});

test('successive ancestor translations retain floating-point order and curve sharing', () => {
  const c = curve(); c.source.x = 2 ** 53; c.control1.y = -0;
  const source = [box(c), box(c)], offsets = [[1, -0], [-(2 ** 53), 220], [0.125, -110]];
  let expected = source, actual = source;
  for (const [dx, dy] of offsets) {
    expected = expected.map(rect => legacy(rect, dx, dy));
    actual = translateWorkspaceObstacles(actual, dx, dy);
    assert.deepEqual(actual, expected);
    assert.equal(actual[0].curve, actual[1].curve);
  }
});

test('signed zero, nonfinite and large coordinates retain exact numeric results', () => {
  for (const value of [-0, 0, NaN, Infinity, -Infinity, 2 ** 53, Number.MAX_VALUE]) {
    const c = curve(); c.source.x = value; c.control1.y = value;
    const source = [{ ...box(c), x: value, y: value }, box(c)];
    for (const [dx, dy] of [[0, -0], [-0, 0], [-1, 220], [-(2 ** 53), Infinity]])
      assert.deepEqual(translateWorkspaceObstacles(source, dx, dy), source.map(rect => legacy(rect, dx, dy)));
  }
});

test('precise branch collision decisions retain the legacy inputs', () => {
  const source = nativeBranches();
  const probes = [{ x: -100, y: -100, width: 40, height: 40 },
    { x: 1950, y: 70, width: 150, height: 110 }, { x: 1000, y: 100, width: 10, height: 10 }];
  for (const [dx, dy] of [[0, 0], [-2200, 440], [250.25, -220], [-0, -0]]) {
    const actual = translateWorkspaceObstacles(source, dx, dy), expected = source.map(rect => legacy(rect, dx, dy));
    for (let index = 0; index < source.length; index++) for (const probe of probes)
      assert.equal(cubicIntersectsRect(actual[index].curve, probe, actual[index].curvePadding),
        cubicIntersectsRect(expected[index].curve, probe, expected[index].curvePadding));
  }
});

test('contour branch ranges preserve mixed label metadata and exact native branch geometry', () => {
  const branches = nativeBranches();
  const label = { x: -0, y: 15, width: 30, height: 10, terminalStemNodeId: 'stem',
    connectorInk: { x: 5, y: 6, width: 7, height: 8 }, blocksConnectors: true };
  const source = [label, ...branches, { ...label, x: 44 }, ...branches, label];
  const ranges = [[1, 33], [34, 66]];
  let expected = source, actual = source;
  for (const [dx, dy] of [[0, -0], [-35.25, 220], [2 ** 53, -110], [-(2 ** 53), 0]]) {
    expected = expected.map(rect => legacy(rect, dx, dy));
    actual = translateWorkspaceContourObstacles(actual, dx, dy, ranges);
    assert.deepEqual(actual, expected);
    assert.equal(actual[0].connectorInk, label.connectorInk);
    assert.equal(actual[1].curve, actual[65].curve, 'separated ranges preserve shared curves');
    assert.equal(Object.hasOwn(actual[0], 'curve'), false);
  }
  assert.ok(Object.is(source[0].x, -0), 'source geometry is untouched');
});

test('empty contour branch ranges retain arbitrary obstacle fields', () => {
  const source = [{ ...box(), terminalStemNodeId: 'custom', blocksConnectors: false }];
  assert.deepEqual(translateWorkspaceContourObstacles(source, 14, -9, []),
    source.map(rect => legacy(rect, 14, -9)));
});
