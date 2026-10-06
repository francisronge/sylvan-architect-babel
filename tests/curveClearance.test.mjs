import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleCubic } from '../replay/relations/markGeometry.ts';
import { cubicIntersectsRect } from '../replay/relations/curveClearance.ts';
import { plaquesOverlap, preparePlaqueObstacleIndex, translateObstacle, prepareImmutableObstacleTranslations } from '../replay/relations/plaqueObstacleIndex.ts';

test('a long diagonal connector does not occupy the empty corners of its sample rectangles', () => {
  const curve = { source: { x: 0, y: 0 }, control1: { x: 1000, y: 1000 },
    control2: { x: 2000, y: 2000 }, target: { x: 3000, y: 3000 } };
  const clear = { x: 65, y: 20, width: 10, height: 10 };
  const blocked = { x: 45, y: 45, width: 10, height: 10 };
  assert.equal(cubicIntersectsRect(curve, clear, 6), false);
  assert.equal(cubicIntersectsRect(curve, blocked, 6), true);
  assert.equal(preparePlaqueObstacleIndex([clear]).some({ x: 0, y: 0, width: 3000, height: 3000 },
    rect => cubicIntersectsRect(curve, rect, 6)), false);
  assert.equal(preparePlaqueObstacleIndex([clear, blocked]).some({ x: 0, y: 0, width: 3000, height: 3000 },
    rect => cubicIntersectsRect(curve, rect, 6)), true);
});

test('curve clearance catches the bowed middle, tangent contact, and the stroke margin', () => {
  const curve = { source: { x: 0, y: 0 }, control1: { x: 0, y: 100 },
    control2: { x: 100, y: 100 }, target: { x: 100, y: 0 } };
  assert.equal(cubicIntersectsRect(curve, { x: 49, y: 74, width: 2, height: 2 }, 0), true);
  assert.equal(cubicIntersectsRect(curve, { x: 49, y: 75, width: 2, height: 2 }, 0), true);
  assert.equal(cubicIntersectsRect(curve, { x: 49, y: 78, width: 2, height: 2 }, 4), true);
  assert.equal(cubicIntersectsRect(curve, { x: 49, y: 78, width: 2, height: 2 }, 2), false);
  assert.equal(cubicIntersectsRect(curve, { x: 45, y: 0, width: 10, height: 10 }, 0), false);
});

test('placing a plaque beside a reserved arrow uses the same ink clearance as placing the arrow beside the plaque', () => {
  const curve = { source: { x: 0, y: 0 }, control1: { x: 100, y: 100 },
    control2: { x: 200, y: 200 }, target: { x: 300, y: 300 } };
  const obstacle = { x: -8, y: -8, width: 316, height: 316, curve, curvePadding: 8 };
  const clear = { x: 160, y: 40, width: 40, height: 40 }, blocked = { x: 140, y: 140, width: 40, height: 40 };
  assert(!plaquesOverlap(clear, obstacle));
  assert(plaquesOverlap(blocked, obstacle));
  assert.equal(preparePlaqueObstacleIndex([obstacle]).overlaps(clear), false);
  const shifted = translateObstacle(obstacle, 2000, -700);
  assert(!plaquesOverlap(translateObstacle(clear, 2000, -700), shifted));
  assert(plaquesOverlap(translateObstacle(blocked, 2000, -700), shifted));
  assert.deepEqual(obstacle.curve, curve, 'projecting a future frame cannot mutate the original curve');
});

test('stationary obstacle reuse preserves signed zero and every original curve addition', () => {
  const points = [{ x: 1e30, y: -1e30 }, { x: -0, y: 0 }, { x: 0.125, y: -400.5 }, { x: 123, y: 456 }];
  const curve = { source: points[0], control1: points[1], control2: points[2], target: points[3] };
  const box = { x: 1e30, y: -0, width: 120, height: 300, curve, curvePadding: 8 };
  const original = structuredClone(box);
  for (const [dx, dy] of [[0, 0], [-0, -0], [1, 1], [0.125, -400.5], [1e30, -1e30]]) {
    const point = p => ({ x: p.x + dx, y: p.y + dy });
    const expected = { ...box, x: box.x + dx, y: box.y + dy,
      curve: { source: point(curve.source), control1: point(curve.control1),
        control2: point(curve.control2), target: point(curve.target) } };
    assert.deepEqual(translateObstacle(box, dx, dy), expected);
  }
  assert.deepEqual(box, original);
  const stationary = { x: 10, y: 20, width: 30, height: 40 };
  assert.equal(translateObstacle(stationary, 0, 0), stationary);
  assert.notEqual(translateObstacle(box, 0, 0), box, 'adding positive zero must still change the negative-zero coordinates');
});

test('scene translation reuse keeps offset signs, metadata and schedule ownership separate', () => {
  const curve = { source: { x: -0, y: -0 }, control1: { x: 10, y: 20 },
    control2: { x: 30, y: 40 }, target: { x: 50, y: 60 } };
  const scene = [{ x: -0, y: -0, width: 70, height: 80, curve, curvePadding: 6, owner: 'source' }];
  const translate = prepareImmutableObstacleTranslations();
  for (const [dx, dy] of [[0, 0], [-0, -0], [12.5, -9.125], [NaN, Infinity]]) {
    const actual = translate(scene, dx, dy);
    assert.deepEqual(actual, scene.map(box => translateObstacle(box, dx, dy)));
    assert.equal(translate(scene, dx, dy), actual);
  }
  assert.notEqual(translate(scene, 0, 0), translate(scene, -0, -0));
  assert(Object.is(translate(scene, 0, 0)[0].x, 0));
  assert(Object.is(translate(scene, -0, -0)[0].x, -0));
  const independent = scene.map(box => ({ ...box, owner: 'independent' }));
  assert.equal(translate(independent, 0, 0)[0].owner, 'independent');
  scene[0].width = 200;
  assert.equal(prepareImmutableObstacleTranslations()(scene, 0, 0)[0].width, 200,
    'a later schedule cannot reuse a stale translated array');
});


test('cubic sampling retains exact coordinates at every collision-planning resolution', () => {
  const curves = [
    [{ x: -123.5, y: 987.25 }, { x: 1e5, y: -230.75 }, { x: -47.625, y: 5000 }, { x: 641.25, y: 9.5 }],
    [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }]
  ];
  for (const [from, c1, c2, to] of curves) for (const samples of [0, 1, 16, 32, 64, 3.5, -1, NaN]) {
    const expected = Array.from({ length: samples + 1 }, (_, index) => {
      const t = index / samples, u = 1 - t;
      return {
        x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
        y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y
      };
    });
    assert.deepEqual(sampleCubic(from, c1, c2, to, samples), expected);
  }
  assert.throws(() => sampleCubic(...curves[0], Infinity), RangeError);
});

test('subdivision preserves endpoint, interior and padded contact over different coordinate scales', () => {
  for (const scale of [0.125, 1, 1024, 1e6]) for (const offset of [-1e9, -15.75, 0, 1e9]) {
    const point = (x, y) => ({ x: offset + x * scale, y: offset + y * scale });
    const curve = { source: point(0, 0), control1: point(0, 100),
      control2: point(100, 100), target: point(100, 0) };
    const rect = (x, y, width, height) => ({ ...point(x, y), width: width * scale, height: height * scale });
    assert.equal(cubicIntersectsRect(curve, rect(0, 0, 0, 0), 0), true);
    assert.equal(cubicIntersectsRect(curve, rect(100, 0, 0, 0), 0), true);
    assert.equal(cubicIntersectsRect(curve, rect(50, 75, 0, 0), 0), true);
    assert.equal(cubicIntersectsRect(curve, rect(49, 78, 2, 2), 4 * scale), true);
    assert.equal(cubicIntersectsRect(curve, rect(49, 78, 2, 2), 2 * scale), false);
    assert.equal(cubicIntersectsRect(curve, rect(40, 0, 20, 10), 0), false);
  }
});
