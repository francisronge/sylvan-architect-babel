import assert from 'node:assert/strict';
import test from 'node:test';
import { fallbackLabelRect, placeFallbackMark } from '../replay/relations/fallbackGeometry.ts';

// A 68×18 role box beside a 40×40 label: its preferred spots are 57 to 67 units
// from the label's centre, so it searches up to 134 units.
const label = { x: 0, y: 0, width: 40, height: 40 };
const mark = { labelRect: label, textWidth: 60, textHeight: 14 };
const centre = { x: 20, y: 20 };
const reach = Math.hypot(40 + 37 - 20, 20 + 15);
const distance = point => Math.hypot(point.x - centre.x, point.y - centre.y);
const meets = (a, b) => a.x < b.x + b.width - 0.5 && a.x + a.width > b.x + 0.5 && a.y < b.y + b.height - 0.5 && a.y + a.height > b.y + 0.5;
// Syntax fills the label's row and the row above it for 2000 units on each side.
const row = [label, { x: -2000, y: -40, width: 1980, height: 80 }, { x: 60, y: -40, width: 1940, height: 80 },
  { x: -20, y: -40, width: 80, height: 40 }];
const place = (occupied, viewport) => {
  const reserved = occupied.map(rect => ({ ...rect }));
  const point = placeFallbackMark(mark, 1, reserved, viewport);
  return { point, box: fallbackLabelRect({ ...mark, ...point }, 1), reserved };
};

test('a crowded role takes the nearest free spot across rows instead of stepping along its row', () => {
  const { point, box, reserved } = place(row);
  // Stepping right one label width at a time used to pass the whole row, 2000 units out.
  assert.deepEqual(point, { x: 20, y: 56 });
  assert(distance(point) <= 2 * reach);
  assert(!row.some(rect => meets(box, rect)), 'the role clears every reserved box');
  assert.deepEqual(reserved.at(-1), box, 'the placed role reserves its own box');
});

test('a free spot inside the fitted viewport comes before a nearer one outside it', () => {
  const viewport = { x: -1000, y: -1000, width: 2000, height: 1040 };
  const { point, box } = place(row, viewport);
  assert.deepEqual(point, { x: 20, y: -52 });
  assert(box.y >= viewport.y && box.y + box.height <= viewport.y + viewport.height);
  assert(!row.some(rect => meets(box, rect)));
});

test('with nothing free within twice its reach, a role overlaps least and never covers its own label', () => {
  const crowded = [label, { x: -5000, y: -5000, width: 10000, height: 10000 }];
  const { point, box } = place(crowded);
  // Every spot is equally covered, so the nearest spot clear of the label wins.
  assert.deepEqual(point, { x: 20, y: -15 });
  assert(!meets(box, label));
  assert(distance(point) <= 2 * reach);
});

test('a free preferred spot keeps its Orchard order', () => {
  assert.deepEqual(place([label]).point, { x: 77, y: 20 });
  assert.deepEqual(place([label, { x: 60, y: 0, width: 100, height: 40 }]).point, { x: -37, y: 20 });
});
