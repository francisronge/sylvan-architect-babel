import assert from 'node:assert/strict';
import test from 'node:test';
import { featureSharingVinePath, featureSharingVinePaths } from '../replay/relations/markGeometry.ts';

const orchard = [{ x: 218.7, y: 559 }, { x: 653.7, y: 763 }, { x: 1090.6, y: 1171 }, { x: 1524.3, y: 1171 }];
const orchardTip = { x: 871.8, y: 1305 };
const staggered = [{ x: 1818, y: 2051 }, { x: 1364.1, y: 1206.6 }, { x: 2728.7, y: 1839.9 }];
const staggeredTip = { x: 1970.3, y: 2185 };

// Read the emitted SVG, including any vertical departure, independently of the
// routing implementation. Compare horizontal order at dense common y samples.
const points = path => {
  const n = path.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const start = { x: n[0], y: n[1] };
  const stem = path.includes(' L ');
  const offset = stem ? 4 : 2;
  const bend = stem ? { x: n[2], y: n[3] } : start;
  const c1 = { x: n[offset], y: n[offset + 1] };
  const c2 = { x: n[offset + 2], y: n[offset + 3] };
  const tip = { x: n[offset + 4], y: n[offset + 5] };
  return [start, ...Array.from({ length: 401 }, (_, i) => {
    const t = i / 400, u = 1 - t;
    return { x: u ** 3 * bend.x + 3 * u ** 2 * t * c1.x + 3 * u * t ** 2 * c2.x + t ** 3 * tip.x,
      y: u ** 3 * bend.y + 3 * u ** 2 * t * c1.y + 3 * u * t ** 2 * c2.y + t ** 3 * tip.y };
  })];
};
const crossings = paths => {
  const curves = paths.map(points).sort((a, b) => a[0].x - b[0].x);
  const xAt = (curve, y) => {
    const j = curve.findIndex(p => p.y >= y);
    if (j <= 0) return curve[0].x;
    const a = curve[j - 1], b = curve[j];
    return a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y);
  };
  return curves.some((left, i) => {
    const right = curves[i + 1];
    if (!right || left[0].x === right[0].x) return false;
    const low = Math.max(left[0].y, right[0].y), high = left.at(-1).y;
    return Array.from({ length: 1000 }, (_, sample) => low + (high - low) * sample / 1000)
      .some(y => xAt(left, y) > xAt(right, y) + 0.05);
  });
};

test('Orchard D5 keeps its accepted vine paths byte for byte', () => {
  assert.deepEqual(featureSharingVinePaths(orchard, orchardTip), orchard.map(start => featureSharingVinePath(start, orchardTip)));
});

test('staggered bearers meet only at the shared point, including mirrored and reordered groups', () => {
  assert(crossings(staggered.map(start => featureSharingVinePath(start, staggeredTip))), 'control reproduces the reported crossing');
  for (const mirror of [1, -1]) {
    const starts = staggered.map(p => ({ x: mirror * p.x, y: p.y }));
    const tip = { ...staggeredTip, x: mirror * staggeredTip.x };
    const paths = featureSharingVinePaths(starts, tip);
    assert.equal(crossings(paths), false);
    assert.deepEqual(featureSharingVinePaths([...starts].reverse(), tip).reverse(), paths);
    paths.forEach((path, i) => {
      assert.deepEqual(points(path)[0], starts[i]);
      assert.deepEqual(points(path).at(-1), tip);
    });
  }
});

test('two, four and six staggered vines remain ordered without changing their convergence', () => {
  for (const heights of [[0, 1000], [0, 950, 500, 1000], [0, 1500, 10, 1400, 20, 1000]]) {
    const starts = heights.map((y, i) => ({ x: i * 200, y }));
    const tip = { x: (starts.length - 1) * 100, y: Math.max(...heights) + 134 };
    const paths = featureSharingVinePaths(starts, tip);
    assert.equal(crossings(paths), false);
    assert(paths.every(path => JSON.stringify(points(path).at(-1)) === JSON.stringify(tip)));
  }
});
