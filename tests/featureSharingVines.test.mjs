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

// Sample any emitted vine (M, then L and C commands) independently of the router.
const route = path => {
  const tokens = path.match(/[MLC]|-?\d+(?:\.\d+)?/g);
  let index = 0, at;
  const read = () => ({ x: Number(tokens[index++]), y: Number(tokens[index++]) });
  const samples = [];
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === 'M' || command === 'L') {
      const to = read();
      if (at) for (let i = 1; i <= 50; i++) samples.push({ x: at.x + (to.x - at.x) * i / 50, y: at.y + (to.y - at.y) * i / 50 });
      else samples.push(to);
      at = to;
    } else {
      const c1 = read(), c2 = read(), to = read();
      for (let i = 1; i <= 200; i++) {
        const t = i / 200, u = 1 - t;
        samples.push({ x: u ** 3 * at.x + 3 * u ** 2 * t * c1.x + 3 * u * t ** 2 * c2.x + t ** 3 * to.x,
          y: u ** 3 * at.y + 3 * u ** 2 * t * c1.y + 3 * u * t ** 2 * c2.y + t ** 3 * to.y });
      }
      at = to;
    }
  }
  return samples;
};
const inside = (point, rect) => point.x > rect.x && point.x < rect.x + rect.width && point.y > rect.y && point.y < rect.y + rect.height;

// performance/german-embedded.json: "den schwierigen Bericht". The determiner's
// word sits directly above the long adjective, whose word spans the shared point.
const den = { x: 5362, y: 2934, width: 136, height: 42 };
const bericht = { x: 5966, y: 3374, width: 201, height: 42 };
const schwierigen = { x: 5366, y: 3594, width: 353, height: 53 };
const germanWords = [den, bericht, schwierigen];
const germanStarts = germanWords.map(rect => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height + 22 }));
const germanTip = { x: (germanStarts[0].x + germanStarts[1].x + germanStarts[2].x) / 3, y: schwierigen.y + schwierigen.height + 156 };

test('a vine passes beside another bearer\'s word instead of through it', () => {
  const accepted = featureSharingVinePaths(germanStarts, germanTip);
  assert(route(accepted[0]).some(point => inside(point, schwierigen)), 'control reproduces the vine through schwierigen');
  const paths = featureSharingVinePaths(germanStarts, germanTip, germanWords);
  paths.forEach((path, i) => {
    const samples = route(path);
    germanWords.forEach((word, j) => {
      if (i === j) return;
      const clearance = { x: word.x - 21, y: word.y - 21, width: word.width + 42, height: word.height + 42 };
      assert(!samples.some(point => inside(point, clearance)), `vine ${i} keeps its gap from word ${j}`);
    });
    assert.deepEqual(samples[0], germanStarts[i]);
    assert.deepEqual(samples.at(-1), { x: Number(germanTip.x.toFixed(1)), y: germanTip.y });
  });
  // Vines that never met another word keep their accepted paths.
  assert.deepEqual(paths.slice(1), accepted.slice(1));
  // The rerouted vine stays on its own side, keeping the group's horizontal order.
  const xAt = (samples, y) => samples.reduce((best, point) => Math.abs(point.y - y) < Math.abs(best.y - y) ? point : best).x;
  const sampled = paths.map(route);
  for (let y = germanStarts[2].y; y < germanTip.y - 6; y += 4) {
    const [left, right, middle] = sampled.map(samples => xAt(samples, y));
    assert(left < middle && middle < right, `horizontal order at y ${y}`);
  }
});

test('vines clear of every word keep their accepted paths', () => {
  const words = orchard.map(start => ({ x: start.x - 60, y: start.y - 64, width: 120, height: 42 }));
  assert.deepEqual(featureSharingVinePaths(orchard, orchardTip, words), featureSharingVinePaths(orchard, orchardTip));
  const staggeredWords = staggered.map(start => ({ x: start.x - 80, y: start.y - 64, width: 160, height: 42 }));
  assert.deepEqual(featureSharingVinePaths(staggered, staggeredTip, staggeredWords), featureSharingVinePaths(staggered, staggeredTip));
});
