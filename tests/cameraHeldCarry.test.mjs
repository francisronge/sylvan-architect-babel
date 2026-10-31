import assert from 'node:assert/strict';
import test from 'node:test';
import { paintedShift } from '../replay/cameraCarry.ts';
import { carryCamera } from '../components/treeViewport.ts';
import { auditCameraRecord } from './helpers/cameraTrace.mjs';
import { checkFirstPaintContinuity } from './helpers/cameraInvariants.mjs';
import { VIEWPORTS } from './helpers/visualFrames.mjs';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';

/* The camera carry across a stage crossing holds still the syntax the crossing
 * leaves in place, and never splits the difference between two blocks of it:
 * - when a lowered subtree leaves the held syntax in two equal blocks, the carry
 *   follows the block the rest of the unmoved syntax agrees with;
 * - when the movement opening a stage closes the room it leaves, the stage plan
 *   records the syntax that closing does not move (stageCoordinates.entryCarry)
 *   and the carry holds it, so the closing side slides toward the gap, unless
 *   that would first paint shared syntax farther beyond the view. */

const point = (x, y, parentId = null) => ({ x, y, parentId });

test('a lowered crossing whose held syntax splits evenly follows the block the other unmoved syntax shares', () => {
  // Spanish V-to-v: v is lowered under the new complex head; Ana stays and the
  // trace beside the head is pushed 300 right, so the held nodes split 2:2.
  const before = new Map([['pred', point(0, 0)], ['ana', point(-100, 100, 'pred')], ['core', point(100, 100, 'pred')],
    ['v', point(80, 200, 'core')], ['venga', point(120, 200, 'core')], ['anaWord', point(-100, 300, 'ana')], ['vengaWord', point(120, 300, 'venga')]]);
  const after = new Map([['pred', point(5, 0)], ['ana', point(-100, 100, 'pred')], ['core', point(110, 100, 'pred')],
    ['head', point(-20, 200, 'core')], ['v', point(60, 300, 'head')], ['venga', point(420, 200, 'core')],
    ['anaWord', point(-100, 300, 'ana')], ['vengaWord', point(420, 300, 'venga')]]);
  assert.deepEqual(paintedShift(before, after), { x: 0, y: 0 });
});

const fixtures = new Map(loadFixtureAnalyses().records.map(entry => [entry.id, entry.record]));
const desktop = VIEWPORTS.find(viewport => viewport.name === 'desktop');
const jumpsAt = (id, frames) => auditCameraRecord(id, fixtures.get(id), { viewports: [desktop] }).findings
  .filter(finding => finding.rule === 'first-paint-continuity' && finding.subtype.startsWith('jump') && frames.includes(finding.frame));

test('Spanish V-to-v: crossing into the head movement keeps the unmoved syntax still', () => {
  assert.deepEqual(jumpsAt('replay-regressions/workspace-spanish-continuity.json#', ['6>7', '7>6']), []);
});

for (const [id, frames] of [
  ['movement/clause-context.json#/cases/3', ['39>40', '40>39']],
  ['movement/holdout-transitions.json#/0', ['27>28', '28>27']],
  ['replay-regressions/diverse-recovery.json#/examples/3/analysis', ['46>47', '47>46']]
]) test(`${id}: a crossing whose movement closes its room holds the rest of the syntax still`, () => {
  assert.deepEqual(jumpsAt(id, frames), []);
});

test('the held carry yields to the ordinary carry where it would paint shared syntax farther beyond the view', () => {
  // The held node stays; the closing node slides 400 left. Holding the held node
  // puts the closing node 300 beyond the view's left edge; the ordinary carry (the
  // midpoint) puts it 100 beyond.
  const before = new Map([['held', point(500, 0)], ['closing', point(100, 0)]]);
  const after = new Map([['held', point(500, 0)], ['closing', point(-300, 0)]]);
  const pose = { x: 0, y: 0, k: 1 }, view = { left: 0, right: 1000, top: -10, bottom: 10 };
  assert.deepEqual(carryCamera(pose, before, after, { held: ['held'] }), pose);
  assert.deepEqual(carryCamera(pose, before, after, { held: ['held'] }, view), { x: 200, y: 0, k: 1 });
  const wide = { left: -1000, right: 1000, top: -10, bottom: 10 };
  assert.deepEqual(carryCamera(pose, before, after, { held: ['held'] }, wide), pose);
});

test('the tie carry yields where it would hide unmoved syntax, even when it paints the farthest node less far off', () => {
  // The lowered tie above, plus one reattached node that both carries paint far
  // off. The tie's end paints that node 750 px off instead of 900, but takes two
  // unmoved words 70 px off the canvas that the ordinary carry keeps in view
  // (GPT-6.1 Sol's reproduction in the review of #348).
  const before = new Map([['pred', point(0, 0)], ['ana', point(-100, 100, 'pred')], ['core', point(100, 100, 'pred')],
    ['v', point(80, 200, 'core')], ['venga', point(120, 200, 'core')], ['anaWord', point(-100, 300, 'ana')],
    ['vengaWord', point(120, 300, 'venga')], ['moved', point(0, 200, 'ana')]]);
  const after = new Map([['pred', point(5, 0)], ['ana', point(-100, 100, 'pred')], ['core', point(110, 100, 'pred')],
    ['head', point(-20, 200, 'core')], ['v', point(60, 300, 'head')], ['venga', point(420, 200, 'core')],
    ['anaWord', point(-100, 300, 'ana')], ['vengaWord', point(420, 300, 'venga')], ['moved', point(-1000, 200, 'core')]]);
  const pose = { x: 250, y: 0, k: 1 }, view = { left: 0, right: 600, top: 0, bottom: 700 };
  const first = carryCamera(pose, before, after, {}, view);
  assert.deepEqual(first, carryCamera(pose, before, after, { tie: false }, view));
  const frame = (nodes, stage) => ({ stage, nodes: new Map([...nodes].map(([id, node]) => {
    const ancestors = [];
    for (let at = node.parentId; at && nodes.has(at); at = nodes.get(at).parentId) ancestors.push(at);
    return [id, { ...node, ancestors }];
  })) });
  const findings = checkFirstPaintContinuity({ canvas: { width: 600, height: 700 }, frames: [frame(before, 0), frame(after, 1)],
    passes: [{ name: 'forward', steps: [{ from: 0, to: 1, before: pose, first, settled: first }] }] });
  assert.equal(findings.some(finding => finding.subtype === 'off-canvas:unmoved'), false);
});
