import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { layoutVisualFrames, markMotionFindings, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';
import { checkRegionOverlap } from './helpers/visualRules.mjs';

/* Plaque allocation keeps plaques off region marks of other claims: an enclosure's
 * shaded box, and the outline of a domain box. Francis, 27 October 2026, on Sol
 * n3-47-en-sluicing: "tiny collisions". Main placed the subjectCase plaque of who
 * (stage 4) left of who, where the sluicing remnant's enclosure (stage 6) later
 * covered its right edge from frame 34 on. */

const record = JSON.parse(readFileSync(new URL('./helpers/regionOverlapRecord.json', import.meta.url), 'utf8'));
const subject = 'plaque(3:1 subjectCase: nominative)@who';

test('a feature plaque keeps clear of the remnant enclosure its stage draws later, without moving when it appears', () => {
  const frames = layoutVisualFrames(prepareVisualRecord(record), [VIEWPORTS[0]], { steps: Array.from({ length: 14 }, (_, i) => 27 + i) });
  const enclosed = frames.filter(frame => frame.marks.some(mark => mark.type === 'enclosure'));
  assert(enclosed.length && enclosed.every(frame => frame.plaques.some(plaque => plaque.id === subject)), 'the plaque shows beside the enclosure');
  assert.deepEqual(frames.flatMap(frame => checkRegionOverlap(frame)).map(found => `${found.frame} ${found.subject}`), []);
  assert.deepEqual(markMotionFindings(frames), []);
  const offsets = new Set(frames.flatMap(frame => frame.plaques.filter(plaque => plaque.id === subject)
    .map(plaque => `${Math.round(plaque.rect.x - plaque.anchor.x)},${Math.round(plaque.rect.y - plaque.anchor.y)}`)));
  assert.equal(offsets.size, 1, `one pocket from frame 27 through the enclosure: ${[...offsets]}`);
});

test('control: region-overlap reports a plaque across another claim\'s region box outline', () => {
  const plaque = (x, y, claims = ['3:1']) => ({ id: 'plaque(3:1 subjectCase: nominative)@who', text: 'subjectCase: nominative',
    rect: { x, y, width: 360, height: 129 }, radius: 14, claims });
  const frame = (plaques, marks) => ({ frame: 37, viewport: 'desktop', zoom: 0.11, texts: [], lines: [], plaques, marks });
  const box = { id: 'enclosure(5:0)#1', type: 'enclosure', x: 7496, y: 1910, width: 300, height: 210 };
  assert.deepEqual(checkRegionOverlap(frame([plaque(7257, 2018)], [box])).map(found => [found.rule, found.subtype, found.measure]),
    [['region-overlap', 'plaque', 11.22]], 'main: 121 units across its left edge, 102 into its height');
  assert.deepEqual(checkRegionOverlap(frame([plaque(7824, 1915)], [box])), [], 'beside it');
  assert.deepEqual(checkRegionOverlap(frame([plaque(7257, 2018, ['5:0'])], [box])), [], 'its own claim\'s region');
  const domain = { id: 'domain-region(1:1)#1', type: 'domain-region', x: -2000, y: -1000, width: 4000, height: 2000 };
  assert.deepEqual(checkRegionOverlap(frame([plaque(-180, -60)], [domain])), [], 'wholly inside a domain box');
  assert.equal(checkRegionOverlap(frame([plaque(1800, -60)], [domain])).length, 1, 'across its outline');
  assert.deepEqual(checkRegionOverlap(frame([plaque(2100, -60)], [domain])), [], 'outside it');
});
