import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePlaqueObstacleIndex, preparePlaqueColumnIntervals, plaqueColumnContains, plaquesOverlap } from '../replay/relations/plaqueObstacleIndex.ts';
import { uniquePlaqueObstacles } from '../replay/relations/plaquePlacement.ts';

test('the obstacle index preserves exact collision decisions, including unbounded stems and touching edges', () => {
  const obstacles = Array.from({ length: 240 }, (_, i) => ({
    x: (i * 137 % 1200) - 600, y: (i * 71 % 900) - 450,
    width: i * 17 % 140, height: i * 23 % 150, extendsDownward: i % 23 === 0
  }));
  const original = structuredClone(obstacles);
  const index = preparePlaqueObstacleIndex(obstacles);
  for (const gap of [0, 24, 24.000001]) {
    const queries = obstacles.flatMap(box => [
      { x: box.x + box.width + gap, y: box.y, width: 8, height: 8 },
      { x: box.x, y: box.y + box.height + gap, width: 8, height: 8 },
      { x: box.x - 150, y: 100000, width: 100, height: 1 },
      { x: box.x - 10, y: box.y - 40, width: 30, height: 0, extendsDownward: true }
    ]);
    for (const box of queries) {
      assert.equal(index.overlaps(box, gap), obstacles.some(other => plaquesOverlap(box, other, gap)));
      assert.deepEqual(new Set(index.inColumn(box.x, box.width, gap)),
        new Set(obstacles.filter(other => box.x < other.x + other.width + gap && box.x + box.width + gap > other.x)));
    }
  }
  assert.deepEqual(obstacles, original, 'indexing does not reorder or mutate shared reservations');
  assert.equal(preparePlaqueObstacleIndex([]).overlaps(obstacles[0]), false);
});

test('future-frame deduplication keeps first occurrence order and distinguishes downward reservations', () => {
  const finite = { x: 0, y: 10, width: 30, height: 40 };
  const stem = { ...finite, extendsDownward: true };
  const adjacent = { ...finite, x: Number.EPSILON };
  const repeated = [finite, { ...finite }, stem, { ...stem }, adjacent];
  const unique = uniquePlaqueObstacles(repeated);
  assert.deepEqual(unique, [finite, stem, adjacent]);
  assert.equal(unique[0], finite);
  for (const y of [-40, 10, 50, 10000]) {
    const box = { x: 0, y, width: 1, height: 1 };
    assert.equal(unique.some(other => plaquesOverlap(box, other)), repeated.some(other => plaquesOverlap(box, other)));
  }
});


test('prepared column intervals retain strict gaps, touching endpoints and unbounded stems', () => {
  const obstacles = [
    { x: 0, y: 0, width: 30, height: 40 },
    { x: 0, y: 60, width: 30, height: 40 },
    { x: 80.5, y: -32.125, width: 15.75, height: 80.25 },
    { x: 80.5, y: 200, width: 5, height: 5, extendsDownward: true },
    ...Array.from({ length: 120 }, (_, i) => ({
      x: (i * 137 % 1200) - 600, y: (i * 71 % 900) - 450,
      width: i * 17 % 140, height: i * 23 % 150, extendsDownward: i % 23 === 0
    }))
  ];
  const original = structuredClone(obstacles);
  for (const height of [0, 20, 80.5, 238]) for (const gap of [0, 24, 24.000001]) {
    const prepared = preparePlaqueColumnIntervals(obstacles, height, gap);
    for (const width of [0, 1.5, 480]) for (const x of [-900, -30 - gap, 0, 30 + gap, 80.5, 96.25 + gap, 1000]) {
      const intervals = obstacles.filter(box => x < box.x + box.width + gap && x + width + gap > box.x)
        .map(box => [box.y - height - gap, box.extendsDownward ? Infinity : box.y + box.height + gap])
        .sort((a, b) => a[0] - b[0]);
      const expected = [];
      for (const interval of intervals) {
        const last = expected.at(-1);
        if (last && interval[0] < last[1]) last[1] = Math.max(last[1], interval[1]);
        else expected.push(interval);
      }
      assert.deepEqual(prepared(x, width), expected);
      for (const y of [-100000, 100000, NaN, ...expected.flatMap(([low, high]) =>
        [low, low + 1e-9, (low + high) / 2, high - 1e-9, high])]) {
        assert.equal(plaqueColumnContains(prepared(x, width), y), expected.some(([low, high]) => y > low && y < high),
          'binary membership preserves exact open boundaries, including touching intervals');
      }
    }
  }
  assert.deepEqual(preparePlaqueColumnIntervals(obstacles.slice(0, 2), 20, 0)(0, 1), [[-20, 40], [40, 100]],
    'a touching vertical edge remains a usable candidate');
  assert.deepEqual(preparePlaqueColumnIntervals([], 20)(0, 1), []);
  assert.deepEqual(obstacles, original);
});

test('rectangle traversal retains the prior left-first predicate order and short-circuit point', () => {
  const obstacles = Array.from({ length: 32 }, (_, id) => ({
    id, x: (id * 137 % 800) - 400, y: (id * 71 % 400) - 200, width: 35, height: 40
  }));
  const index = preparePlaqueObstacleIndex(obstacles);
  const cases = [
    [{ x: -1000, y: -1000, width: 2000, height: 2000 },
      [0, 6, 12, 18, 24, 30, 1, 7, 13, 19, 25, 31, 2, 8, 14, 20, 26, 3, 9, 15, 21, 27, 4, 10, 16, 22, 28, 5, 11, 17, 23, 29]],
    [{ x: -240, y: -80, width: 300, height: 170 }, [7, 13, 19, 25, 31, 2, 8, 14, 20, 26, 3, 9, 15]],
    [{ x: 0, y: 0, width: 30, height: 30, extendsDownward: true }, [3]]
  ];
  for (const [query, expected] of cases) for (const stop of [undefined, expected[0], expected.at(-1)]) {
    const visited = [];
    assert.equal(index.some(query, obstacle => {
      visited.push(obstacle.id);
      return obstacle.id === stop;
    }), stop !== undefined);
    assert.deepEqual(visited, stop === undefined ? expected : expected.slice(0, expected.indexOf(stop) + 1));
  }
});

test('flat traversal keeps exact leaf gaps, curves, touching edges and downward reservations', () => {
  const obstacles = Array.from({ length: 80 }, (_, id) => ({
    id, x: (id * 137 % 1200) - 600, y: (id * 71 % 900) - 450,
    width: id * 17 % 140, height: id * 23 % 150, extendsDownward: id % 13 === 0,
    ...(id % 11 === 0 ? { curve: {
      source: { x: (id * 137 % 1200) - 600, y: (id * 71 % 900) - 450 },
      control1: { x: 550, y: -550 }, control2: { x: -550, y: 550 },
      target: { x: 400, y: 400 }
    }, curvePadding: 6 } : {})
  }));
  const before = structuredClone(obstacles), index = preparePlaqueObstacleIndex(obstacles);
  for (const gap of [0, 24, 24.000001]) for (const obstacle of obstacles) {
    const queries = [
      { x: obstacle.x + obstacle.width + gap, y: obstacle.y, width: 8, height: 8 },
      { x: obstacle.x - 8 - gap, y: obstacle.y, width: 8, height: 8 },
      { x: obstacle.x, y: obstacle.y + obstacle.height + gap, width: 8, height: 8 },
      { x: obstacle.x, y: 100000, width: 1, height: 1 },
      { x: obstacle.x, y: -100000, width: 1, height: 1, extendsDownward: true },
      { x: obstacle.x - 10, y: obstacle.y - 40, width: 0, height: 0 },
      { x: -700, y: -700, width: 1400, height: 1400, curve: {
        source: { x: -650, y: -650 }, control1: { x: 650, y: -650 },
        control2: { x: 650, y: 650 }, target: { x: -650, y: 650 }
      } }
    ];
    for (const query of queries) {
      assert.equal(index.overlaps(query, gap), obstacles.some(other => plaquesOverlap(query, other, gap)));
      for (const predicate of [() => false, () => true, other => other.id % 7 === 3]) {
        assert.equal(index.some(query, predicate), obstacles.some(other => plaquesOverlap(query, other, 0) && predicate(other)));
      }
    }
  }
  assert.deepEqual(obstacles, before);
});

test('predicate reentry and exceptions leave later queries and their order intact', () => {
  const obstacles = Array.from({ length: 32 }, (_, id) => ({ id, x: id * 10, y: 0, width: 8, height: 8 }));
  const index = preparePlaqueObstacleIndex(obstacles), all = { x: -10, y: -10, width: 400, height: 40 };
  const visited = [];
  assert.equal(index.some(all, obstacle => {
    visited.push(obstacle.id);
    assert.equal(index.some({ x: 0, y: 0, width: 1, height: 1 }, inner => inner.id === 0), true);
    return false;
  }), false);
  assert.deepEqual(visited, obstacles.map(obstacle => obstacle.id));
  const failure = new Error('predicate failure');
  assert.throws(() => index.some(all, () => { throw failure; }), error => error === failure);
  assert.throws(() => index.some(all, undefined), TypeError, 'some still requires a predicate when a leaf matches');
  assert.equal(index.some({ x: 10000, y: 10000, width: 1, height: 1 }, undefined), false);
  assert.equal(index.some(all, obstacle => obstacle.id === 31), true);
});

test('prepared leaf edges preserve floating-point addition order at strict boundaries', () => {
  for (const origin of [-1e12, -100.125, 0, 100.125, 1e12]) {
    const obstacles = Array.from({ length: 24 }, (_, id) => ({ id,
      x: origin + id * 0.125, y: origin - id * 0.25, width: 0.1 + id * 0.125,
      height: 0.2 + id * 0.25, extendsDownward: id % 5 === 0 }));
    const index = preparePlaqueObstacleIndex(obstacles);
    for (const gap of [0, 0.1, 24.000001]) for (const obstacle of obstacles) {
      const edge = obstacle.x + obstacle.width + gap;
      for (const x of [edge - 0.0005, edge, edge + 0.0005]) {
        const query = { x, y: obstacle.y, width: 0.1, height: 0.2 };
        assert.equal(index.overlaps(query, gap), obstacles.some(box => plaquesOverlap(query, box, gap)));
        const expected = new Set(obstacles.filter(box => plaquesOverlap(query, box, 0)).map(box => box.id));
        const visited = new Set();
        index.some(query, box => { visited.add(box.id); return false; });
        assert.deepEqual(visited, expected);
      }
    }
  }
});
