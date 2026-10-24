import assert from 'node:assert/strict';
import test from 'node:test';
import { caseAssignmentExits, caseAssignmentPlaqueCurve, caseAssignmentRoutes } from '../replay/relations/overlayGeometry.ts';
import { sampleCubic } from '../replay/relations/markGeometry.ts';
import { cubicIntersectsRect } from '../replay/relations/curveClearance.ts';
import { CATEGORY_LINE_HEIGHT } from '../replay/rendererMetrics.ts';

test('a Case row beside its source exits the source side, clear of the category below', () => {
  // Measured Japanese final-frame word and wrapped V label, in tree coordinates.
  const word = { x: 5379.99, y: 1122.62, width: 64.56, height: 68.94 };
  const lowerCategory = { x: 5268.90, y: 1175.27, width: 278.19, height: 99.71 };
  for (const direction of [-1, 1]) {
    const plaque = { x: direction > 0 ? 5928 : 4500, y: 1033.4, width: 380, height: 138 };
    const curve = caseAssignmentPlaqueCurve(word, plaque, plaque.y + 93);
    assert.equal(curve.source.y, word.y + word.height / 2);
    assert.equal(curve.source.x, direction > 0 ? word.x + word.width + 8 : word.x - 8);
    assert(!cubicIntersectsRect(curve, lowerCategory, 6), 'the arrow must not start in or cross V');
    assert(!cubicIntersectsRect(curve, word, 6), 'the arrow must leave the word clear');
  }
});

test('near-aligned Case arrows retain a visible turn into either side of the plaque', () => {
  const source = { x: -75, y: -60, width: 150, height: 60 };
  for (const direction of [-1, 1]) {
    const box = { x: direction === 1 ? 11 : -491, y: 65, width: 480, height: 238 };
    const curve = caseAssignmentPlaqueCurve(source, box, box.y + 93);
    const points = sampleCubic(curve.source, curve.control1, curve.control2, curve.target, 64);
    assert(Math.max(...points.map(point => -direction * point.x)) > 25,
      'the vertical approach needs a visible bow, even when its endpoints almost align');
    assert(direction * (curve.target.x - curve.control2.x) > 50,
      'the arrow reaches the Case row with a full horizontal turn');
    assert.equal(curve.target.y, box.y + 93);
    assert(points.every(point => direction === 1 ? point.x < box.x : point.x > box.x + box.width),
      'the whole curve remains outside the plaque');
  }
});

test('level side attachments keep a bounded bow instead of collapsing to a straight line', () => {
  // The French auxiliary and Case row differ by only nine tree units.
  const word = { x: 2976.1, y: 1773.7, width: 64, height: 69 };
  for (const direction of [-1, 1]) {
    const plaque = { x: direction < 0 ? 1792.1 : 3732.1, y: 1724.3, width: 480, height: 238 };
    const curve = caseAssignmentPlaqueCurve(word, plaque, 1817.3);
    const points = sampleCubic(curve.source, curve.control1, curve.control2, curve.target, 64);
    const bow = Math.max(...points.map((point, index) => {
      const fraction = index / (points.length - 1);
      return curve.source.y + fraction * (curve.target.y - curve.source.y) - point.y;
    }));
    assert(bow >= 45 && bow <= 76, `the long level connector needs a visible bounded bow: ${bow}`);
    assert(!cubicIntersectsRect(curve, word, 6));
    assert(!cubicIntersectsRect(curve, plaque, 6));
    assert.equal(curve.source.y, word.y + word.height / 2);
    assert.equal(curve.target.y, 1817.3);
  }
});

test('ordinary Orchard side approaches and vertically aligned arrows retain their geometry', () => {
  const source = { x: 225, y: 0, width: 150, height: 60 };
  assert.deepEqual(caseAssignmentPlaqueCurve(source, { x: -200, y: 80, width: 300, height: 200 }, 173), {
    source: { x: 300, y: 68 }, target: { x: 112, y: 173, side: 'right' },
    control1: { x: 300, y: 120.5 }, control2: { x: 188, y: 173 }
  });
  assert.deepEqual(caseAssignmentPlaqueCurve(source, { x: 200, y: 200, width: 300, height: 200 }, 293), {
    source: { x: 300, y: 68 }, target: { x: 300, y: 188, side: 'vertical' },
    control1: { x: 332, y: 128 }, control2: { x: 300, y: 128 }
  });
});

test('a Case row just above or below its word still bends instead of running straight', () => {
  // Measured Mandarin 把: its Case row sat a few units above the word's box.
  const word = { x: 1000, y: 900, width: 64, height: 69 };
  const deviation = curve => {
    const { source, target } = curve;
    const length = Math.hypot(target.x - source.x, target.y - source.y);
    return Math.max(...sampleCubic(curve.source, curve.control1, curve.control2, curve.target, 64)
      .map(point => Math.abs((target.x - source.x) * (source.y - point.y) - (source.x - point.x) * (target.y - source.y)) / length));
  };
  for (const direction of [-1, 1]) {
    for (const offset of [-20, -2, 2, 20]) {
      const rowY = offset < 0 ? word.y + offset : word.y + word.height + offset;
      const plaque = { x: direction > 0 ? 1300 : 400, y: rowY - 40, width: 280, height: 120 };
      const curve = caseAssignmentPlaqueCurve(word, plaque, rowY);
      const dx = Math.abs(curve.target.x - curve.source.x);
      assert(deviation(curve) >= 0.5 * Math.min(76, dx / 4) * 0.75,
        `row ${offset} units from the word needs a visible bend (direction ${direction})`);
      assert(!cubicIntersectsRect(curve, word, 6), 'the arrow leaves the word clear');
      assert(!cubicIntersectsRect(curve, plaque, 0), 'the arrow stays outside the plaque');
    }
  }
});

// Francis, 24 Oct: "i dont want straight arrows i want them to bend, that is
// the design of the case arrow". A bend is visible when the curve leaves its
// chord by a tenth of the chord's length, or by 30 tree units on a long arrow.
const chordSag = curve => {
  const { source, target } = curve;
  const length = Math.hypot(target.x - source.x, target.y - source.y);
  const sag = Math.max(...sampleCubic(curve.source, curve.control1, curve.control2, curve.target, 128)
    .map(point => Math.abs((target.x - source.x) * (source.y - point.y) - (source.x - point.x) * (target.y - source.y)) / length));
  return { length, sag };
};
const assertBends = (curve, message) => {
  const { length, sag } = chordSag(curve);
  assert(sag >= Math.min(length / 10, 30),
    `${message}: the curve leaves its ${length.toFixed(1)}-unit chord by only ${sag.toFixed(2)}`);
};
const mirror = (rect, axis) => ({ ...rect, x: 2 * axis - rect.x - rect.width });
const rect = ([x, y, width, height]) => ({ x, y, width, height });

test('a Case row level with the top of its source bends over instead of running straight', () => {
  // Measured do-support Replay (ship1 s1-11, frames 27-33, with the head-rewrite
  // fix): the plaque sits just left of "I⁰ [finite, past, 3sg]" and its row lies
  // a unit below the stem's exit.
  const label = rect([1437.3, 340, 305.5, 100.5]), plaque = rect([1016.3, 240, 379, 262]);
  for (const flip of [false, true]) {
    const word = flip ? mirror(label, 1500) : label, box = flip ? mirror(plaque, 1500) : plaque;
    const curve = caseAssignmentPlaqueCurve(word, box, 333);
    assertBends(curve, `do-support${flip ? ', mirrored' : ''}`);
    assert.equal(curve.source.y, word.y - 8, 'the stem leaves the top of the label');
    assert(curve.control1.y < curve.source.y, 'the stem rises before it turns');
    assert.equal(curve.control2.y, curve.target.y, 'the arrow turns fully into the Case row');
    assert(!cubicIntersectsRect(curve, word, 6), 'the arrow leaves the label clear');
    assert(!cubicIntersectsRect(curve, box, 0), 'the arrow stays outside the plaque');
  }
});

test('Case arrows that main drew along their chord bend', () => {
  // Desktop production layouts in which the main-branch curve stayed within a
  // few units of its chord: [label, plaque, Case row].
  const measured = {
    // showcase/agreement-and-case.json cases/4, frame 21: a row level with the top exit.
    'level top exit': [[1276.3, 1159, 184.8, 70], [1512.8, 1145, 379, 138], 1238],
    // replay-regressions/workspace-reservation.json cases/0, frame 21: a long row level with the bottom exit.
    'long level bottom exit': [[2872.9, 1488, 291.7, 52.5], [817.3, 1532, 379, 138], 1625],
    // visual-relations/case-collection-growth.json, frame 28: a long aligned gap.
    'long aligned gap': [[1382.7, 828, 159.6, 52.5], [1404.9, -72.7, 379, 138], 20.3],
    // replay-regressions/plaque-hold-pockets.json cases/4, frame 14: a narrow gap beside a tall label.
    'narrow gap, tall label': [[3098, 904, 269, 196.5], [2669.3, 993, 361, 138], 1086],
    // Saved run spellout-night-20261018 33-tr-evidential-relative, frame 52: a row at a tall label's foot.
    'row at a tall label\'s foot': [[4538.9, 684, 406, 196.5], [4996.9, 780, 480, 300], 873]
  };
  for (const [name, [label, plaque, rowY]] of Object.entries(measured)) {
    const word = rect(label), box = rect(plaque), curve = caseAssignmentPlaqueCurve(word, box, rowY);
    assertBends(curve, name);
    assert(!cubicIntersectsRect(curve, word, 6), `${name}: the arrow leaves the label clear`);
    assert(!cubicIntersectsRect(curve, box, 0), `${name}: the arrow stays outside the plaque`);
  }
});

test('every allocatable Case arrow bends, clear of its label and plaque', () => {
  // Labels from one-word leaves to wrapped categories, with plaques beside,
  // above and below them. The allocator rejects shafts under two category lines.
  const cases = [];
  for (const [width, height] of [[64, 52.5], [150, 70], [300, 100.5], [406, 196.5]])
    for (const gap of [30, 42, 60, 100, 200, 400, 800])
      for (const direction of [-1, 1])
        for (const offset of [-600, -300, -150, -80, -40, -20, -8, -2, 0, 2, 8, 20, 40, 80, 150, 300, 600]) {
          const word = { x: 1000, y: 1000, width, height };
          const rowY = offset < 0 ? word.y + offset : offset === 0 ? word.y + height / 2 : word.y + height + offset;
          const x = direction > 0 ? word.x + width + gap : word.x - gap - 379;
          cases.push([word, { x, y: rowY - 93, width: 379, height: 262 }, rowY]);
        }
  for (const [width, height] of [[64, 52.5], [150, 70], [300, 100.5]])
    for (const gap of [30, 60, 100, 200, 400, 800])
      for (const shift of [-150, -50, 0, 50, 150])
        for (const below of [false, true]) {
          const word = { x: 1000, y: 1000, width, height };
          const y = below ? word.y + height + gap : word.y - gap - 262;
          cases.push([word, { x: word.x + width / 2 - 190 + shift, y, width: 379, height: 262 }, y + 93]);
        }
  // Every route the allocator may fall back on bends too.
  let checked = 0, alternatives = 0;
  for (const [word, box, rowY] of cases) for (const route of caseAssignmentRoutes(word, box, rowY)) {
    const curve = caseAssignmentPlaqueCurve(word, box, rowY, route);
    if (Math.hypot(curve.target.x - curve.source.x, curve.target.y - curve.source.y) < 2 * CATEGORY_LINE_HEIGHT) continue;
    checked++;
    if (route.bend < 1 || route.exit !== caseAssignmentExits(word, box, rowY)[0]) alternatives++;
    const where = `label ${JSON.stringify(word)}, plaque ${JSON.stringify(box)}, row ${rowY}, ${route.exit} exit, bend ${route.bend}`;
    assertBends(curve, where);
    assert(!cubicIntersectsRect(curve, word, 6), `${where}: the arrow leaves the label clear`);
    assert(!cubicIntersectsRect(curve, box, 0), `${where}: the arrow stays outside the plaque`);
  }
  assert(checked > 800, `the sweep checks ${checked} allocatable arrows`);
  assert(alternatives > 20, `the sweep checks ${alternatives} alternative exits`);
});

test('a row just beyond reach may also take the side exit, never a longer arrow', () => {
  const word = { x: 1000, y: 1000, width: 150, height: 70 };
  const plaqueFor = rowY => ({ x: 1500, y: rowY - 93, width: 379, height: 262 });
  // reach = min(76, (1488 - 1158) / 4) = 76.
  assert.deepEqual(caseAssignmentExits(word, plaqueFor(1035), 1035), ['side'], 'a row beside the word');
  assert.deepEqual(caseAssignmentExits(word, plaqueFor(1070 + 76), 1070 + 76), ['side'], 'a row within reach');
  assert.deepEqual(caseAssignmentExits(word, plaqueFor(1070 + 300), 1070 + 300), ['stem'], 'a row beyond twice the reach');
  assert.deepEqual(caseAssignmentExits(word, plaqueFor(1070 + 120), 1070 + 120), ['stem', 'side'], 'a row just beyond reach');
  const length = curve => {
    const points = sampleCubic(curve.source, curve.control1, curve.control2, curve.target, 16);
    return points.slice(1).reduce((sum, point, i) => sum + Math.hypot(point.x - points[i].x, point.y - points[i].y), 0);
  };
  for (let rowY = 1070 + 77; rowY <= 1070 + 152; rowY += 5) {
    const exits = caseAssignmentExits(word, plaqueFor(rowY), rowY);
    if (exits.includes('side')) assert(length(caseAssignmentPlaqueCurve(word, plaqueFor(rowY), rowY, { exit: 'side', bend: 1 }))
      <= length(caseAssignmentPlaqueCurve(word, plaqueFor(rowY), rowY, { exit: 'stem', bend: 1 })), `row ${rowY}: the side arrow is not longer`);
  }
  // A plaque overlapping the word's columns would turn the side exit back on itself.
  const behind = { x: 690, y: 1190 - 93, width: 379, height: 262 };
  assert.deepEqual(caseAssignmentExits(word, behind, 1190), ['stem']);
});

test('a shallower route keeps the plain curve as its limit and offers only visible bends', () => {
  // Bend 0 is main's curve before every arrow had to bend: here the do-support
  // stem, which lay along its chord, is never offered.
  const label = { x: 1437.3, y: 340, width: 305.5, height: 100.5 }, plaque = { x: 1016.3, y: 240, width: 379, height: 262 };
  assert.deepEqual(caseAssignmentPlaqueCurve(label, plaque, 333, { exit: 'stem', bend: 0 }), {
    source: { x: 1590.05, y: 332 }, target: { x: 1407.3, y: 333, side: 'right' },
    control1: { x: 1590.05, y: 332.5 }, control2: { x: 1483.3, y: 333 } });
  const routes = [...caseAssignmentRoutes(label, plaque, 333)];
  assert.deepEqual(routes[0], { exit: 'stem', bend: 1 });
  assert(!routes.some(route => route.bend === 0), 'the straight plain curve is not a fallback');
  for (const route of routes) assertBends(caseAssignmentPlaqueCurve(label, plaque, 333, route), `bend ${route.bend}`);
  // The Orchard side approach already bends: its full route is its plain curve.
  const word = { x: 225, y: 0, width: 150, height: 60 }, orchard = { x: -200, y: 80, width: 300, height: 200 };
  assert.deepEqual(caseAssignmentPlaqueCurve(word, orchard, 173, { exit: 'stem', bend: 0 }),
    caseAssignmentPlaqueCurve(word, orchard, 173));
  assert.deepEqual([...caseAssignmentRoutes(word, orchard, 173)], [{ exit: 'stem', bend: 1 }]);
});
