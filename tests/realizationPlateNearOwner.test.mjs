import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { layoutVisualFrames, prepareVisualRecord, realizationDistanceFindings, VIEWPORTS } from './helpers/visualFrames.mjs';
import { checkMarkDistance, checkRealizationDistance, plaqueNearbyReach } from './helpers/visualRules.mjs';
import { nearbyPlaqueReach } from '../replay/relations/plaquePlacement.ts';
import { returnsWithinReach } from '../replay/relations/pocketHold.ts';

/* A realization group's plate takes the nearest clear pocket to its owner, whatever
 * its width. Francis, 27 October 2026, on Sol n4-26-tr-long-embedded: "Plaque very
 * low". Main sent plates wider than the 480-unit local pocket below their subtree;
 * this 590-unit plate for oku -DIK-AGR.3SG -(n)I stood 5.9 nearby reaches from its
 * verb, below the whole tree, from frame 77 on. */

const record = JSON.parse(readFileSync(new URL('./helpers/realizationPlateRecord.json', import.meta.url), 'utf8'));

test('a wide realization plate stands by its owner, in the nearest pocket that stays clear', () => {
  const frames = layoutVisualFrames(prepareVisualRecord(record), [VIEWPORTS[0]], { steps: Array.from({ length: 30 }, (_, i) => 77 + i) });
  const plates = frames.flatMap(frame => frame.plaques.filter(plaque => plaque.realization && plaque.id.includes('okuduğunu')));
  assert.equal(plates.length, 30, 'the plate shows from frame 77');
  for (const plate of plates) {
    const size = plate.size ?? plate.rect;
    const distance = Math.hypot(plate.rect.x + size.width / 2 - plate.anchor.x, plate.rect.y + size.height / 2 - plate.anchor.y);
    assert(distance < 1.5 * plaqueNearbyReach(size), `${Math.round(distance)} units from its owner`);
  }
  assert.deepEqual(realizationDistanceFindings(frames), []);
});

test('control: a realization plate far from its owner is reported only while a nearer pocket stays clear', () => {
  const plate = (x, y) => ({ id: 'plaque(3:1 : oku → okuduğunu)@eV::__leaf', text: 'oku', rect: { x, y, width: 590, height: 182 }, radius: 14,
    claims: ['3:1'], realization: true, anchor: { x: 0, y: 0 } });
  const frame = (plaque, reserves) => ({ frame: 83, viewport: 'desktop', zoom: 0.08, texts: [], lines: [], plaques: [plaque], reserves });
  assert.deepEqual(checkRealizationDistance(frame(plate(-1500, 2700), [])).map(found => [found.rule, found.subtype]),
    [['mark-distance', 'realization']], 'below the tree with open space beside its owner');
  assert.deepEqual(checkRealizationDistance(frame(plate(100, 60), [])), [], 'beside its owner');
  const wall = [{ x: -6000, y: -6000, width: 12000, height: 8660 }];
  assert.deepEqual(checkRealizationDistance(frame(plate(-1500, 2700), wall)), [], 'every nearer pocket is taken');
});

test('control: mark-distance still reports a realization plate beyond its reach where every nearer pocket is taken', () => {
  // A plate the realization subtype passes, since nothing nearer is clear, is still a
  // plaque standing beyond its nearby reach, as it was before that subtype.
  const plate = (width, height, distance) => ({ id: 'plaque(3:1 : oku → okuduğunu)@eV::__leaf', text: 'oku',
    rect: { x: -width / 2, y: distance - height / 2, width, height }, radius: 14, claims: ['3:1'], realization: true, anchor: { x: 0, y: 0 } });
  // Reserved boxes over every pocket nearer than the plate by the audit's margin.
  const frame = plaque => ({ frame: 83, viewport: 'desktop', zoom: 0.08, texts: [], lines: [], plaques: [plaque],
    reserves: [{ x: -6000, y: -6000, width: 12000, height: 6000 + (plaque.rect.y + plaque.rect.height / 2) / 1.1 + plaque.rect.height }] });
  const judged = plaque => [...checkMarkDistance(frame(plaque)), ...checkRealizationDistance(frame(plaque))]
    .map(found => [found.rule, found.subtype, Math.round(found.measure * 100) / 100]);
  const small = plate(200, 40, 2.12 * plaqueNearbyReach({ width: 200, height: 40 }));
  assert.deepEqual(judged(small), [['mark-distance', 'plaque', 2.12]], 'a 200 by 40 plate');
  // Allocation places a plate wider than the local pocket beside its owner too (placedLocally).
  const wide = plate(590, 182, 2.12 * plaqueNearbyReach({ width: 590, height: 182 }));
  assert.deepEqual(judged(wide), [['mark-distance', 'plaque', 2.12]], 'a 590 by 182 plate');
});

test('a realization plate wider than the local pocket has the nearby reach of the pocket it is placed in', () => {
  // Allocation places such a plate beside its owner, as it places a wide theta grid,
  // so the schedule brings it near (bringNear) and lets it return within reach.
  const wide = { width: 590, height: 182 };
  assert.equal(nearbyPlaqueReach(wide), Infinity, 'a wide plaque of another kind goes below its subtree');
  assert.equal(nearbyPlaqueReach({ ...wide, realizedForm: true }), nearbyPlaqueReach({ ...wide, thetaGrid: true }));
  assert(Number.isFinite(nearbyPlaqueReach({ ...wide, realizedForm: true })));
  const anchor = { x: 0, y: 0 }, far = { x: -295, y: 2000, ...wide }, near = { x: 110, y: -91, ...wide };
  const blocker = { x: 120, y: -80, width: 40, height: 40 };
  assert.equal(returnsWithinReach({ before: { pocket: far, anchor }, after: { pocket: near, anchor }, owner: 'plate', move: { x: 0, y: 0 },
    realizedForm: true }, [blocker], []), true, 'it comes back within reach once what blocked the nearer pocket has gone');
});
