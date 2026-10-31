import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { layoutVisualFrames, markMotionFindings, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';
import { checkRegionOverlap } from './helpers/visualRules.mjs';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';

/* Plaque allocation keeps plaques off region marks of other claims: an enclosure's
 * shaded box, and the outline of a domain box. Francis, 27 October 2026, on Sol
 * n3-47-en-sluicing: "tiny collisions". Main placed the subjectCase plaque of who
 * (stage 4) left of who, where the sluicing remnant's enclosure (stage 6) later
 * covered its right edge from frame 30 on. */

const record = JSON.parse(readFileSync(new URL('./helpers/regionOverlapRecord.json', import.meta.url), 'utf8'));
const subject = 'plaque(3:1 subjectCase: nominative)@who';

test('a feature plaque keeps clear of the remnant enclosure its stage draws later, without moving when it appears', () => {
  const frames = layoutVisualFrames(prepareVisualRecord(record), [VIEWPORTS[0]], { steps: Array.from({ length: 12 }, (_, i) => 23 + i) });
  const enclosed = frames.filter(frame => frame.marks.some(mark => mark.type === 'enclosure'));
  assert(enclosed.length && enclosed.every(frame => frame.plaques.some(plaque => plaque.id === subject)), 'the plaque shows beside the enclosure');
  assert.deepEqual(frames.flatMap(frame => checkRegionOverlap(frame)).map(found => `${found.frame} ${found.subject}`), []);
  assert.deepEqual(markMotionFindings(frames), []);
  const offsets = new Set(frames.flatMap(frame => frame.plaques.filter(plaque => plaque.id === subject)
    .map(plaque => `${Math.round(plaque.rect.x - plaque.anchor.x)},${Math.round(plaque.rect.y - plaque.anchor.y)}`)));
  assert.equal(offsets.size, 1, `one pocket from frame 23 through the enclosure: ${[...offsets]}`);
});

test('control: region-overlap reports a plaque on another claim\'s enclosure, or across its domain box or ellipse outline', () => {
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
  // Allocation reserves an enclosure's whole shaded box, so a plaque inside it is on it.
  const shade = { id: 'enclosure(5:0)#1', type: 'enclosure', x: 7000, y: 1800, width: 1200, height: 600 };
  assert.deepEqual(checkRegionOverlap(frame([plaque(7300, 1900)], [shade])).map(found => found.measure), [129 * 0.11], 'wholly inside an enclosure');
  // A domain ellipse, an argument domain's or a binding domain's as it paints it.
  const ellipse = { id: 'domain-ellipse(1:1)#1', type: 'domain-ellipse', cx: 0, cy: 0, rx: 2000, ry: 1000 };
  assert.deepEqual(checkRegionOverlap(frame([plaque(-180, -60)], [ellipse])), [], 'wholly inside a domain ellipse');
  assert.equal(checkRegionOverlap(frame([plaque(1800, -60)], [ellipse])).length, 1, 'across its outline');
  assert.deepEqual(checkRegionOverlap(frame([plaque(2100, -60)], [ellipse])), [], 'outside it');
  assert.deepEqual(checkRegionOverlap(frame([plaque(1638, -60)], [ellipse])), [], 'one unit beyond it, under a pixel');
  const painted = { ...ellipse, painted: { cx: 0, cy: 0, rx: 2400, ry: 1200 } };
  assert.deepEqual(checkRegionOverlap(frame([plaque(1800, -60)], [painted])), [], 'inside the ellipse a binding domain paints');
  assert.equal(checkRegionOverlap(frame([plaque(2200, -60)], [painted])).length, 1, 'across the ellipse it paints');
});

/* Plaques keep off the ellipse a binding domain paints, inside or outside it
 * (coordinator ruling, 29 October 2026: a plaque across a binding domain's ellipse is
 * a fault to fix). Where the ellipse holds a plaque attached inside its domain it
 * grows to fit it; any other plaque, a Case plaque included, stays clear of it. On
 * the unfixed allocation the theme grid of mv, outside its domain, crossed the
 * outline at frames 37-39 (5.2 px), and the Case plaque of iComplex at frames 49-50
 * (9.7 px). */
for (const [id, from, to, subject] of [
  ['replay-regressions/inserted-adjunction-segment.json#', 34, 43, 'plaque(1:6 theta theme)@mv'],
  ['replay-regressions/review-workspace-boundaries.json#/cases/1', 49, 50, 'plaque(4:1 directed-path case-assignment)@iComplex']
]) test(`${subject} keeps off the binding domain ellipse it would cross (${id})`, () => {
  const record = loadFixtureAnalyses().records.find(entry => entry.id === id).record;
  const frames = layoutVisualFrames(prepareVisualRecord(record), [VIEWPORTS[0]], { steps: Array.from({ length: to - from + 1 }, (_, i) => from + i) });
  const painted = frames.filter(frame => frame.plaques.some(plaque => plaque.id === subject)
    && frame.marks.some(mark => mark.type === 'domain-ellipse' && mark.painted));
  assert(painted.length, 'the plaque shows beside the painted ellipse');
  assert.deepEqual(frames.flatMap(frame => checkRegionOverlap(frame)).map(found => `${found.frame} ${found.subject}`), []);
  assert.deepEqual(markMotionFindings(frames), []);
});
