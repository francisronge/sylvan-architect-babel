import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { advanceFittedCamera } from '../components/treeViewport.ts';
import { EXCEPTIONS } from './helpers/cameraExceptions.mjs';
import {
  checkCameraTrace, checkContentPlacement, checkFirstPaintContinuity, checkSettledPathIndependence, checkWithinStageStability,
  poseDistance
} from './helpers/cameraInvariants.mjs';
import { auditCameraRecord, CAMERA_VIEWPORTS, traceCamera } from './helpers/cameraTrace.mjs';
import { matchFindings } from './helpers/findings.mjs';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { prepareVisualRecord } from './helpers/visualFrames.mjs';

const corpus = loadFixtureAnalyses();
const recordOf = id => corpus.records.find(entry => entry.id === id).record;
const viewport = name => CAMERA_VIEWPORTS.find(entry => entry.name === name);
const traceOf = (id, name = 'desktop') => traceCamera(prepareVisualRecord(recordOf(id)), viewport(name));
const translate = (pose, dx, dy = 0) => ({ ...pose, x: pose.x + dx, y: pose.y + dy });
const copy = trace => ({ ...trace, direct: trace.direct.map(pose => ({ ...pose })),
  passes: trace.passes.map(pass => ({ ...pass, steps: pass.steps.map(step => ({ ...step })) })) });
const passOf = (trace, name) => trace.passes.find(pass => pass.name === name).steps;
const crossing = (trace, name) => passOf(trace, name).findIndex(step => trace.frames[step.from].stage !== trace.frames[step.to].stage
  && !trace.frames[step.to].final && [...trace.frames[step.to].nodes.keys()].some(id => trace.frames[step.from].nodes.has(id)));
const within = (trace, name) => passOf(trace, name).findIndex(step => trace.frames[step.from].stage === trace.frames[step.to].stage
  && !trace.frames[step.from].final && !trace.frames[step.to].final);
const step = (trace, name, index) => ({ ...passOf(trace, name)[index], at: `${passOf(trace, name)[index].from + 1}>${passOf(trace, name)[index].to + 1}` });

/* Controls: an unbroken trace of the real camera satisfies every rule, and each
 * checker reports the exact break its rule forbids. */

const CONTROL = 'normalized/what-did-mia-see.xbar.json#/analyses/0';
const control = traceOf(CONTROL);

test('control: the unbroken trace satisfies every camera rule at desktop and mobile', () => {
  assert.deepEqual(checkCameraTrace(control).findings, []);
  assert.deepEqual(checkCameraTrace(traceOf(CONTROL, 'mobile')).findings, []);
  assert(crossing(control, 'forward') >= 0 && within(control, 'forward') >= 0, 'the control crosses stages and steps within one');
});

test('control: settled-path-independence reports Prev and Next settling away from direct selection', () => {
  const backward = copy(control), index = within(backward, 'backward'), prev = step(backward, 'backward', index);
  passOf(backward, 'backward')[index].settled = translate(prev.settled, 40);
  assert.deepEqual(checkSettledPathIndependence(backward).findings.map(finding => [finding.subtype, finding.frame]), [['backward', prev.at]]);

  // Within one stage, Prev may keep the stage's accepted pose, as Next does.
  const kept = copy(control), retained = translate(prev.settled, 30);
  Object.assign(passOf(kept, 'backward')[index], { before: retained, settled: retained });
  const { findings, allowed } = checkSettledPathIndependence(kept);
  assert.deepEqual([findings, allowed.map(entry => [entry.frame, entry.keptStagePose])], [[], [[prev.to + 1, true]]]);
  // Into an earlier stage, or out of the completed last Stage Record, it refits.
  for (const leaving of [crossing(control, 'backward'), 0]) {
    const stale = copy(control), out = step(stale, 'backward', leaving), held = translate(out.before, 30);
    Object.assign(passOf(stale, 'backward')[leaving], { before: held, settled: held });
    assert.deepEqual(checkSettledPathIndependence(stale).findings.map(finding => [finding.subtype, finding.frame]), [['backward', out.at]]);
  }

  const zoomed = copy(control), entry = crossing(zoomed, 'forward'), next = step(zoomed, 'forward', entry);
  passOf(zoomed, 'forward')[entry].settled = { ...zoomed.direct[next.to], k: zoomed.direct[next.to].k * 1.2 };
  const [found] = checkSettledPathIndependence(zoomed).findings;
  assert.deepEqual([found.subtype, found.frame], ['retention', next.at]);
  assert.match(found.detail, /zooms in past the stage fit/);
});

/* Two stages share three nodes. Where the second stage keeps their coordinates,
 * the retained wider view holds them still: the documented exception. Where it
 * lays the same syntax out 3000 units away and the view is not carried, as before
 * PR #77 in #7's record, retaining it parks the tree at the edge. */
function stagedTrace(shift) {
  const view = { left: 16, top: 73, right: 1424, bottom: 608 };
  const node = (x, y, ...ancestors) => ({ x, y, ancestors });
  const first = new Map([['a', node(1000, 200)], ['b', node(800, 400, 'a')], ['c', node(1200, 400, 'a')]]);
  const second = new Map([...first].map(([id, point]) => [id, { ...point, x: point.x + shift }]));
  second.set('d', node(1200 + shift, 600, 'c', 'a'));
  const frame = (stage, nodes, minX, maxX) => ({ stage, final: false, nodes, bounds: { minX, maxX, minY: 200, maxY: 730 },
    envelope: { minX: minX - 220, maxX: maxX + 220, minY: 40, maxY: 890 } });
  const frames = [frame(0, first, 0, 2000), frame(1, second, 800 + shift, 1200 + shift)];
  const fit = ({ envelope: { minX, maxX, minY, maxY } }) => {
    const k = Math.min((view.right - view.left) / (maxX - minX), (view.bottom - view.top) / (maxY - minY));
    return { x: (view.left + view.right - (minX + maxX) * k) / 2, y: (view.top + view.bottom - (minY + maxY) * k) / 2, k };
  };
  const direct = frames.map(fit);
  const settled = advanceFittedCamera(direct[0], direct[1], frames[1].envelope, view);
  return { canvas: { width: 1440, height: 900 }, view, frames, direct,
    passes: [{ name: 'forward', steps: [{ from: 0, to: 1, before: direct[0], first: direct[0], settled }] }] };
}

test('control: settled-path-independence allows only retention that holds unmoved syntax steadier', () => {
  const retained = stagedTrace(0);
  assert(retained.passes[0].steps[0].settled.k < retained.direct[1].k, 'forward playback retains the wider view');
  const { findings, allowed } = checkSettledPathIndependence(retained);
  assert.deepEqual(findings, []);
  assert.deepEqual(allowed.map(entry => [entry.frame, entry.retainedTravelPx]), [[2, 0]]);

  const parked = stagedTrace(3000);
  const [found] = checkSettledPathIndependence(parked).findings;
  assert.deepEqual([found.subtype, found.frame], ['retention', '1>2']);
  assert.match(found.detail, /unmoved syntax travels .* under the retained view but .* under the fit/);
  assert.deepEqual(checkContentPlacement(parked).map(finding => [finding.subtype, finding.frame]), [['pinned', 2]]);
});

test('control: content-placement reports a pinned tree and syntax under the panel or header', () => {
  const index = control.frames.findIndex(frame => !frame.final), view = control.view;
  const pose = control.direct[index], envelope = control.frames[index].envelope, small = { ...pose, k: pose.k * 0.5 };
  const pinned = copy(control);
  pinned.direct[index] = { ...small, x: view.right - envelope.maxX * small.k,
    y: (view.top + view.bottom - (envelope.minY + envelope.maxY) * small.k) / 2 };
  const [found] = checkContentPlacement(pinned);
  assert.deepEqual([found.subtype, found.frame], ['pinned', index + 1]);
  assert(found.measure > 0.5 && /pinned to the right edge/.test(found.detail));
  for (const [shift, side] of [[view.bottom - view.top, 'under the Replay panel'], [-(view.bottom - view.top), 'under the header']]) {
    const clipped = copy(control);
    clipped.direct[index] = translate(pose, 0, shift);
    const subtypes = checkContentPlacement(clipped).filter(finding => finding.frame === index + 1);
    assert.deepEqual(subtypes.map(finding => finding.subtype).sort(), ['bounds-clipped', 'syntax-clipped'], side);
    assert.match(subtypes.find(finding => finding.subtype === 'syntax-clipped').detail, new RegExp(side));
  }
});

test('control: first-paint-continuity reports an empty first paint and a teleport, not a small settle', () => {
  const index = crossing(control, 'forward'), next = step(control, 'forward', index);
  const paint = dx => {
    const broken = copy(control);
    passOf(broken, 'forward')[index].first = translate(next.before, dx);
    return checkFirstPaintContinuity(broken).map(finding => [finding.subtype, finding.frame, finding.measure > 0]);
  };
  assert.deepEqual(paint(4000), [['off-canvas:unmoved', next.at, true], ['jump:camera', next.at, true]]);
  assert.deepEqual(paint(60), [['jump:camera', next.at, true]]);
  assert.deepEqual(paint(10), []);
});

test('control: within-stage-stability reports a camera change between micro-steps unless the pose overflowed', () => {
  const index = within(control, 'forward'), next = step(control, 'forward', index);
  const broken = copy(control);
  passOf(broken, 'forward')[index].settled = translate(next.before, 30);
  assert.deepEqual(checkWithinStageStability(broken).map(finding => [finding.subtype, finding.frame, finding.measure]), [['change', next.at, 30]]);
  passOf(broken, 'forward')[index].before = { ...next.before, k: next.before.k * 3 };
  assert.deepEqual(checkWithinStageStability(broken), [], 'documented overflow may pan or reduce scale');
});

/* Historical defect #7 (catalog #7: bughunt 12-en-whose-relative a1, frames
 * 20→21). Before PR #77, a forward stage entry kept the previous pose under
 * advanceFittedCamera without carrying it into the new stage's coordinates, and
 * began from the painted transform. Replaying that rule on this layout stays
 * flagged; the catalog test below checks the current camera. */
const WHOSE = 'replay-regressions/visual-human-catalog.json#/cases/3/analyses/0';
for (const name of ['desktop', 'wide-short', 'mobile']) test(`historical #7: the pre-#77 stage entry is flagged at ${name}`, () => {
  const trace = traceOf(WHOSE, name);
  const before = passOf(trace, 'forward').find(entry => entry.to === 19).settled;
  const settled = advanceFittedCamera(before, trace.direct[20], trace.frames[20].envelope, trace.view);
  const historical = { ...trace, frames: [trace.frames[19], trace.frames[20]], direct: [trace.direct[19], trace.direct[20]],
    passes: [{ name: 'forward', steps: [{ from: 0, to: 1, before, first: before, settled }] }] };
  const found = checkCameraTrace(historical).findings.map(finding => `${finding.rule}/${finding.subtype}`);
  assert(found.includes('first-paint-continuity/jump:stage-coordinates'), 'the step first paints the tree away from where it was');
  // The wide canvas keeps part of the tree in view; the others lose it.
  if (name !== 'wide-short') assert(found.includes('first-paint-continuity/off-canvas:unmoved'), 'then flies it in from beyond the canvas');
  // The stage fit shrinks on mobile, so retention does not apply there.
  if (name !== 'mobile') assert(found.includes('settled-path-independence/retention') && found.includes('content-placement/pinned'),
    'Next parks the tree where direct selection centres it');
});

/* Historical defects Francis caught by eye (catalog of 18 October 2026) through
 * the current camera, at desktop and mobile: their findings match the listed
 * exceptions exactly. `npm run verify:camera-offline` checks every fixture. */
const CATALOG = 'replay-regressions/visual-human-catalog.json#/cases';
let catalog;
before(() => {
  catalog = corpus.records.filter(entry => entry.id.startsWith(CATALOG)).flatMap(({ id, record }) =>
    auditCameraRecord(id, record, { viewports: [viewport('desktop'), viewport('mobile')] }).findings);
});

test('catalog: camera findings match their listed exceptions exactly', () => {
  assert.deepEqual(matchFindings(catalog, EXCEPTIONS.filter(exception => exception.record.startsWith(CATALOG))),
    { unexpected: [], exceeded: [], stale: [] });
});

test('catalog #7: since PR #77, Next into frame 21 carries the view and paints the syntax in place', () => {
  assert.deepEqual(catalog.filter(finding => finding.record === WHOSE && finding.rule !== 'within-stage-stability'), []);
});

/* Historical defect found by these checks: before PR #81, Prev inside a stage
 * entered with a retained view refit the camera to direct selection's pose.
 * Replayed on this layout, that refit stays flagged; keeping the stage's pose
 * passes both rules. */
test('historical Prev refit: leaving a retained stage pose on Prev within the stage is flagged', () => {
  const trace = traceOf(WHOSE), index = passOf(trace, 'next-then-prev').findIndex(entry => entry.from === 21 && entry.to === 20);
  const prev = step(trace, 'next-then-prev', index);
  assert(poseDistance(prev.before, trace.direct[20], trace.frames[20]) > 1, 'Next retained a view other than direct selection\'s');
  const replay = settled => {
    const broken = copy(trace);
    passOf(broken, 'next-then-prev')[index].settled = settled;
    return checkCameraTrace(broken).findings.filter(finding => finding.frame === '22>21').map(finding => `${finding.rule}/${finding.subtype}`);
  };
  assert.deepEqual(replay(trace.direct[20]), ['within-stage-stability/prev-refit']);
  assert.deepEqual(replay(prev.before), []);
});

test('catalog #7: since PR #81, Prev inside the forward-retained stage keeps its camera', () => {
  assert.deepEqual(catalog.filter(finding => finding.subtype === 'prev-refit'), []);
  assert.deepEqual(catalog.filter(finding => finding.record === WHOSE), []);
});

test('a stage that paints a cyclic-linearization plate is judged against the view its tree is fitted into', () => {
  const ids = ['one', 'two', 'three', 'four', 'five'];
  const forest = [{ id: 'root', label: 'TP', children: ids.map(id => ({ id, label: 'D', word: id, children: [] })) }];
  const relation = { relation: 'CyclicLinearization', anchors: { order: ids }, priorAnchors: { order: ids }, values: { outcome: 'conflict' } };
  const stage = relations => ({ statement: 'Test', stageRecord: 'Test', relations, workspaceForest: structuredClone(forest) });
  const trace = traceCamera(prepareVisualRecord({ sentence: 'one two three four five', derivationStages: [stage([]), stage([relation])] }), viewport('desktop'));
  const last = trace.frames.length - 1, fit = trace.frames[last].view;
  assert(fit.right < trace.view.right, 'the plate takes a column beside the tree');
  assert.deepEqual(checkContentPlacement(trace), []);
  // A pose that paints the whole tree into the plate's column, inside the whole view.
  const points = [...trace.frames[last].nodes.values()], xs = points.map(point => point.x), ys = points.map(point => point.y);
  const k = (trace.view.right - fit.right - 20) / (Math.max(...xs) - Math.min(...xs));
  const intruding = { ...copy(trace), passes: [] };
  intruding.direct[last] = { k, x: fit.right + 10 - Math.min(...xs) * k, y: (fit.top + fit.bottom) / 2 - (Math.min(...ys) + Math.max(...ys)) / 2 * k };
  assert.deepEqual(checkContentPlacement({ ...intruding, frames: intruding.frames.map(({ view: _view, ...frame }) => frame) })
    .filter(found => found.subtype === 'syntax-clipped'), [], 'the pose is inside the whole view');
  assert(checkContentPlacement(intruding).some(found => found.subtype === 'syntax-clipped' && found.frame === last + 1));
});
