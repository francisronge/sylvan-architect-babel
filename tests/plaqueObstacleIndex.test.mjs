import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePlaqueObstacleIndex, plaquesOverlap } from '../replay/relations/plaqueObstacleIndex.ts';
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
