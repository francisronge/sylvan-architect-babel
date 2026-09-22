import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePlaqueObstacleIndex, preparePlaqueColumnIntervals, plaquesOverlap } from '../replay/relations/plaqueObstacleIndex.ts';
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
    }
  }
  assert.deepEqual(preparePlaqueColumnIntervals(obstacles.slice(0, 2), 20, 0)(0, 1), [[-20, 40], [40, 100]],
    'a touching vertical edge remains a usable candidate');
  assert.deepEqual(preparePlaqueColumnIntervals([], 20)(0, 1), []);
  assert.deepEqual(obstacles, original);
});
