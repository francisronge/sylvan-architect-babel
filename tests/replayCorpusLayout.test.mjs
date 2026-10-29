import assert from 'node:assert/strict';
import test, { before } from 'node:test';

import { sweepFixtureLayouts } from './helpers/replayCorpusLayoutSweep.mjs';
import { MIRROR_EXCEPTIONS } from './helpers/rtlMirror.mjs';

/* Every committed analysis is laid out in each reading direction
 * (tests/helpers/replayCorpusLayoutSweep.mjs, which spreads the records over
 * worker threads). The contour sweep reads the left-to-right plans; the mirror
 * check compares every right-to-left frame with the left-to-right one. */

let sweep;
before(async () => { sweep = await sweepFixtureLayouts(); });

test('no committed fixture is left with interleaved sister contours', () => {
  assert.deepEqual(sweep.flatMap(entry => entry.offGrid), []);
  assert.deepEqual(sweep.filter(entry => entry.statuses.includes('unresolved')).map(entry => entry.id), []);
  assert.deepEqual(sweep.filter(entry => !entry.statuses.includes('unresolved') && entry.statuses.includes('repaired'))
    .map(entry => entry.id).sort(), ['replay-regressions/diverse-recovery.json#/examples/5/analysis',
    'replay-regressions/es-wh-phase-edge-contour.json#', 'replay-regressions/hi-correlative-landing-contour.json#'],
  'a newly repaired fixture changes its established layout; review it and list it here');
});

test('right-to-left Replay is the reflection of left-to-right on every frame of every committed analysis', () => {
  const found = sweep.flatMap(entry => entry.deviations.map(deviation => ({ id: entry.id, ...deviation })));
  const key = ({ id, kind, frame }) => `${id} ${kind}${frame === null ? '' : ` frame ${frame}`}`;
  const keys = new Set(found.map(key));
  assert.deepEqual(found.filter(item => !MIRROR_EXCEPTIONS.has(key(item)))
    .map(item => `${key(item)} at ${item.viewport.join('x')}: ${item.detail}`),
  [], 'new right-to-left departures from the reflected left-to-right layout');
  assert.deepEqual([...MIRROR_EXCEPTIONS].filter(item => !keys.has(item)), [],
    'listed departures that no longer occur; remove them from tests/helpers/rtlMirror.mjs');
});
