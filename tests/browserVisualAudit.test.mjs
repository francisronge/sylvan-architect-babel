// scripts/auditReplayBrowser.mjs measures painted Replay and judges it with the
// shared rules. These tests rebuild the painted geometry of defects found by
// eye in Replay review (numbered as in that catalogue), check that each is
// flagged and its repaired form is not, control the evidence accounting, and
// run the serialized page probe in a fake DOM.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkFrame } from './helpers/visualRules.mjs';
import { checkCameraTrace } from './helpers/cameraInvariants.mjs';
import { cameraFrame, cameraView, letterFindings, toFrameModel, viewportName } from '../scripts/visualAudit/frameModel.mjs';
import { firstPaintedPose, judgeRapidStepping, judgeResize, judgeStageSyntax, judgeStepMotion } from '../scripts/visualAudit/motionRules.mjs';
import {
  applyShard, estimateRuntime, extractPageRecords, parseFrameSpec, parseResizeSequence, parseShard, parseViewports,
  resolveFrames, sampleCases, selectCases, stageEntryFrames, traversalRange
} from '../scripts/visualAudit/plan.mjs';
import { compareWithBaseline, coverageKey, gateVerdict, receiptMatches, renderIndexHtml, summarize } from '../scripts/visualAudit/report.mjs';
import { catalogRecords } from '../scripts/visualAudit/reviewPage.mjs';
import {
  classifyGraphic, classifyText, colorAlpha, isNodeRefAttribute, parseCamera, parseStageLabel, probeScript, splitRefs, splitSubpaths
} from '../scripts/visualAudit/pageProbe.mjs';
import { createAuditDom } from './helpers/fakeAuditDom.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const rules = findings => findings.map(item => `${item.rule}${item.subtype ? `/${item.subtype}` : ''}`).sort();
// A painted snapshot in CSS pixels under camera translate(720,380) scale(0.4) in an SVG at (0, 60).
const CAMERA = { x: 720, y: 380, k: 0.4 }, ORIGIN = { x: 0, y: 60 };
const screen = (x, y) => [ORIGIN.x + CAMERA.x + x * CAMERA.k, ORIGIN.y + CAMERA.y + y * CAMERA.k];
const screenBox = (x, y, width, height) => ({ x: screen(x, y)[0], y: screen(x, y)[1], width: width * CAMERA.k, height: height * CAMERA.k });
const label = (uid, kind, text, nodeId, box, extra = {}) => ({ uid, kind, text, nodeId, owners: [], refs: [], box, inkBoxes: [box],
  strokePx: (kind === 'category' ? 10 : 8) * CAMERA.k, lines: [], opacity: 1, plaque: null, host: null, ...extra });
const snapshotOf = (extra = {}) => ({ camera: CAMERA, origin: ORIGIN, canvas: { x: 0, y: 60, width: 1440, height: 840 },
  nodes: [], edges: [], texts: [], plaques: [], connectors: [], branches: [], panel: null, header: null, ...extra });
const modelOf = (snapshot, anchorsFor) => toFrameModel(snapshot, { frame: 12, viewport: 'desktop', anchorsFor }).model;

test('probe helpers classify renderer classes and parse the page', () => {
  assert.equal(classifyText({ tag: 'text', classes: ['category-label'] }), 'category');
  assert.equal(classifyText({ tag: 'tspan', classes: ['babel-theta-terminal-index', 'babel-relation-index'] }), 'index');
  assert.equal(classifyText({ tag: 'text', classes: ['babel-theta-grid-index', 'babel-relation-index'], inPlaque: true }), 'plaque-text');
  assert.equal(classifyText({ tag: 'text', classes: ['vr-fallback-role'], owned: true }), 'relation-label');
  const graphic = (tag, classes, extra = {}) => classifyGraphic({ tag, classes, ...extra });
  assert.deepEqual(graphic('path', ['branch']), { type: 'branch' });
  assert.deepEqual(graphic('line', [], { inNodeGroup: true }), { type: 'stem' });
  assert.deepEqual(graphic('rect', ['babel-feature-plaque-shell']), { type: 'plaque' });
  assert.deepEqual(graphic('path', ['vr-fallback-segment'], { owned: true }), { type: 'connector', kind: 'fallback' });
  assert.deepEqual(graphic('path', ['vr-fallback-shadow'], { owned: true }), { type: 'ignore' });
  assert.deepEqual(graphic('path', ['babel-trajectory-path']), { type: 'connector', kind: 'trajectory' });
  assert.deepEqual(graphic('path', ['something']), { type: 'ignore' }, 'unowned ink is not a relation connector');
  assert(isNodeRefAttribute('data-feature-anchor') && isNodeRefAttribute('data-trajectory-from') && !isNodeRefAttribute('data-plaque-domain'));
  assert.deepEqual(splitRefs('["a",["b"]]'), ['a', 'b']);
  assert.deepEqual(parseStageLabel('DERIVATION SEQUENCE ACTIVEReplay Frame 21/68 · Stage 2/5 · Step 1/4'),
    { frame: 21, frameCount: 68, stage: 2, stageCount: 5, step: 1, stepCount: 4 });
  assert.deepEqual(parseCamera('translate(75.5,-223.6) scale(0.2149)'), { x: 75.5, y: -223.6, k: 0.2149 });
  assert.equal(colorAlpha('rgb(3 19 14 / 90%)'), 0.9);
  assert.deepEqual(splitSubpaths([[0, 0], [5, 0], [100, 0], [105, 0]], 10), [[[0, 0], [5, 0]], [[100, 0], [105, 0]]]);
  assert.equal(viewportName({ width: 1440, height: 900 }), 'desktop');
  assert.equal(viewportName({ width: 390, height: 844 }), 'mobile');
});

test('the adapter converts painted pixels to tree units with the offline audit\'s ids', () => {
  const word = label('t0', 'word', 'Qué', 'queD', screenBox(-90, 70, 180, 60));
  const model = modelOf(snapshotOf({ nodes: [{ id: 'queD', tx: 0, ty: 0, leaf: true, opacity: 1 }], texts: [word],
    branches: [{ kind: 'branch', source: 'cp', target: 'queD', points: [screen(0, -300), screen(0, 0)], strokePx: 1.6, opacity: 0.6 }] }));
  assert.equal(model.zoom, 0.4);
  assert.deepEqual(model.texts.map(text => [text.id, text.nodes, text.halo]), [['queD:word', ['queD'], 4]]);
  assert.deepEqual(model.texts[0].boxes, [{ x: -90, y: 70, width: 180, height: 60 }]);
  assert.deepEqual(model.lines.map(line => [line.id, line.kind, line.halfWidth, line.paths[0]]),
    [['cp->queD', 'branch', 2, [{ x: 0, y: -300 }, { x: 0, y: 0 }]]]);
  assert.deepEqual(model.chrome.canvas, { x: -1800, y: -950, width: 3600, height: 2100 });
});

test('#9: a branch through another node\'s hanging word is flagged by the shared rules', () => {
  const que = label('t0', 'word', 'Qué', 'queDP', screenBox(-390, 370, 180, 60));
  const branch = target => ({ kind: 'branch', source: 'cbar', target, points: [screen(-100, 300), screen(-450, 600)], strokePx: 2, opacity: 0.6 });
  const flagged = checkFrame(modelOf(snapshotOf({ texts: [que], branches: [branch('juanDP')] })));
  assert.deepEqual(rules(flagged), ['line-clearance/branch-text']);
  assert.equal(flagged[0].subject, 'cbar->juanDP queDP:word');
  assert.deepEqual(checkFrame(modelOf(snapshotOf({ texts: [que], branches: [branch('queDP')] }))), [], 'its own branch ends at it');
});

test('#4: a fan spoke cut at another claim\'s plaque touches it; a few pixels of clearance do not', () => {
  const plaque = { uid: 'p0', cls: 'babel-feature-plaque-shell', owners: ['2:0'], refs: [], box: screenBox(400, 860, 300, 80), radiusPx: 7, opacity: 1 };
  const spoke = end => ({ uid: 'c0', piece: 0, cls: 'vr-fallback-segment', kind: 'fallback', owners: ['4:0'], refs: ['subj'],
    points: [screen(100, 900), screen(end, 900)], strokePx: 0.75, opacity: 1, masked: false });
  const touching = checkFrame(modelOf(snapshotOf({ plaques: [plaque], connectors: [spoke(400)] })));
  assert.deepEqual(rules(touching), ['line-clearance/connector-plaque']);
  assert.match(touching[0].subject, /^connector\(4:0\)subj plaque\(2:0 \)@/);
  assert.deepEqual(checkFrame(modelOf(snapshotOf({ plaques: [plaque], connectors: [spoke(392)] }))), []);
  assert.deepEqual(checkFrame(modelOf(snapshotOf({ plaques: [{ ...plaque, owners: ['4:0'] }], connectors: [spoke(400)] }))), [],
    'a connector may end at its own claim\'s plaque');
});

test('#1 and #2: wrapped closing marks and a floating plaque are flagged by the shared rules', () => {
  const coord = label('t0', 'category', 'Coord[alternative ]', 'coord', screenBox(-100, -110, 200, 100),
    { inkBoxes: [screenBox(-100, -110, 200, 40), screenBox(-10, -60, 20, 40)],
      lines: [{ text: 'Coord[alternative' }, { text: ']' }] });
  assert.deepEqual(rules(checkFrame(modelOf(snapshotOf({ texts: [coord] })))),
    ['label-typography/closing-start', 'label-typography/fragment']);
  const anchor = { id: 'subject', tx: 0, ty: 0, leaf: false, opacity: 1 };
  const plaqueAt = units => ({ uid: 'p0', cls: 'babel-feature-plaque-shell', owners: ['3:1'], refs: [], anchor: 'subject',
    box: screenBox(-180, -units - 64.5, 360, 129), radiusPx: 7, opacity: 1 });
  const far = checkFrame(modelOf(snapshotOf({ nodes: [anchor], plaques: [plaqueAt(754)] })));
  assert.deepEqual(far.map(item => [item.rule, item.subtype, item.measure]), [['mark-distance', 'plaque', 1.81]]);
  assert.deepEqual(checkFrame(modelOf(snapshotOf({ nodes: [anchor], plaques: [plaqueAt(300)] }))), []);
  const unanchored = { ...plaqueAt(754), anchor: null };
  assert.equal(checkFrame(modelOf(snapshotOf({ nodes: [anchor], plaques: [unanchored] }), () => ['subject'])).length, 1,
    'an authored anchor stands in where the DOM names none');
});

test('relation ink under the Replay panel is clipped; without screen chrome nothing is clipped', () => {
  const connector = { uid: 'c0', piece: 0, cls: 'babel-collection-ink', kind: 'relation', owners: ['1:0'], refs: [],
    points: [[1050, 760], [1300, 760]], strokePx: 1, opacity: 1, masked: false };
  const panel = { x: 1000, y: 700, width: 420, height: 180 };
  const clipped = checkFrame(modelOf(snapshotOf({ connectors: [connector], panel })));
  assert.deepEqual(rules(clipped), ['clipped/under-panel']);
  const { chrome, ...offline } = modelOf(snapshotOf({ connectors: [connector], panel }));
  assert.equal(chrome.panel.width, 1050);
  assert.deepEqual(checkFrame(offline), [], 'the offline adapter supplies no chrome');
});

test('#5: one index letter painted twice at one label is repeated, using the painters\' placement attributes', () => {
  const every = label('t0', 'word', 'every', 'everyD', screenBox(-90, 70, 180, 60));
  const glyph = (uid, placement, box = screenBox(95, 60, 30, 40)) => label(uid, 'index', 'j', null, box, { placement, strokePx: 0 });
  const operator = glyph('t1', { role: 'operator', operator: 'everyD' });
  const qr = glyph('t2', { pronounced: 'everyD', lf: 'farDP' }, screenBox(100, 50, 40, 50));
  const found = letterFindings(snapshotOf({ texts: [every, operator, qr] }), { record: 'r', frame: 23, viewport: 'desktop' });
  assert.deepEqual(found.map(item => [item.rule, item.subtype, item.subject, item.measure]), [['one-letter-per-label', 'repeated', 'everyD:word j', 2]]);
  assert.deepEqual(letterFindings(snapshotOf({ texts: [every, operator, { ...qr, text: 'k' }] }), { record: 'r', frame: 23, viewport: 'desktop' }), []);
  const inline = label('t3', 'index', 'j', 'everyD', screenBox(92, 90, 20, 30), { host: 't0', cls: 'babel-identity-index babel-relation-index' });
  assert.equal(letterFindings(snapshotOf({ texts: [every, inline, operator] }), { record: 'r', frame: 23, viewport: 'desktop' }).length, 1,
    'an inline coindex and a letter beside it');
  assert.deepEqual(letterFindings(snapshotOf({ texts: [every, operator, glyph('t4', {})] }), { record: 'r', frame: 23, viewport: 'desktop' }), [],
    'a letter without placement attributes is not attributed by guess');
});

// Motion samples: positions by node id ([x, y, parent?]), one frame per 16.7 ms.
const CANVAS = { x: 0, y: 60, width: 1440, height: 840 };
const sample = (t, positions, extra = {}) => ({ t, gen: 1, visibility: 1, cover: 0, canvas: CANVAS, marks: [],
  nodes: Object.entries(positions).map(([id, [x, y, parent = null, opacity = 1]]) => [id, x, y, opacity, parent]), ...extra });
const ids = Array.from({ length: 15 }, (_, index) => `n${index}`);
const placed = (dx = 0, dy = 0) => Object.fromEntries(ids.map((id, index) => [id, [300 + 40 * index + dx, 400 + dy]]));
const smooth = (from, to, frames, t0) => Array.from({ length: frames }, (_, index) => {
  const p = (index + 1) / frames, e = p * p * (3 - 2 * p);
  return sample(t0 + 16.7 * (index + 1), placed(from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e));
});
const place = { record: 'r', viewport: 'desktop', frame: '20>21' };

test('#7: Next into a new stage that paints retained syntax off the canvas and flies it back is flagged', () => {
  const before = sample(0, placed());
  const flyIn = [before, sample(20, placed(1500, 600)), ...smooth([1500, 600], [-100, 20], 22, 20), sample(420, placed(-100, 20))];
  const findings = judgeStepMotion(flyIn, { place });
  assert.deepEqual(rules(findings), ['step-motion/empty-frame', 'step-motion/fly-in', 'step-motion/offcanvas', 'step-motion/teleport']);
  assert.deepEqual([findings[0].record, findings[0].frame, findings[0].viewport], ['r', '20>21', 'desktop']);
  assert.equal(findings.find(item => item.subtype === 'offcanvas').measure, 15);
  assert.deepEqual(judgeStepMotion([before, ...smooth([0, 0], [-100, 20], 22, 0), sample(420, placed(-100, 20))]), []);
});

test('#7: one jumping root is caught though the median holds; a reattached constituent may move', () => {
  const base = { ip: [700, 300], ibar: [760, 360, 'ip'], v: [720, 420, 'ibar'], vbar: [800, 420, 'ibar'], verb: [800, 480, 'vbar'],
    waiting: [900, 300], dp: [860, 480, 'vbar'] };
  const jumped = { ...base, waiting: [1300, 300] };
  const jump = judgeStepMotion([sample(0, base), sample(17, jumped), sample(34, jumped)]);
  assert.deepEqual(rules(jump), ['step-motion/node-jump'], 'the median of seven retained nodes does not move');
  assert.match(jump[0].detail, /waiting by 400px/);
  const moved = { ...base, root: [500, 240], dp: [300, 360, 'root'] };
  assert.deepEqual(judgeStepMotion([sample(0, base), sample(17, moved), sample(34, moved)]), [], 'the moved DP jumps to its landing');
});

test('#10: a covered resize, a second settle after shrinking back, and anything that vanishes are flagged', () => {
  const settled = (t0, count, positions, extra) => Array.from({ length: count }, (_, index) => sample(t0 + 16.7 * index, positions, extra));
  const ghost = [...settled(0, 3, placed()), ...settled(50, 12, placed(), { cover: 0.9 }), ...settled(260, 10, placed(80, 40))];
  const faded = judgeResize(ghost, { place: { ...place, frame: 'resize:1440x900>1915x1197@68' } });
  assert.deepEqual(rules(faded), ['resize-motion/faded']);
  assert(faded[0].metrics.durationMs >= 190 && faded[0].metrics.durationMs <= 215);
  assert.deepEqual(judgeResize([...settled(0, 3, placed()), ...settled(50, 10, placed(80, 40))]), [], 'one clean refit');
  const twice = [[0, 0], [0, 0], [-60, -30], [-60, -30], [-60, -30], [-60, -30], [-90, -40], [-90, -40], [-90, -40]]
    .map((offset, index) => sample(16.7 * index, placed(...offset)));
  assert.deepEqual(judgeResize(twice).map(item => [item.subtype, item.metrics.episodes]), [['jitter', 2]]);
  const without = Object.fromEntries(Object.entries(placed()).slice(0, 14));
  assert.deepEqual(rules(judgeResize([sample(0, placed()), sample(17, without), sample(34, without)])), ['resize-motion/node-vanished'],
    'a node that never comes back is not a blink but is still gone');
  const mark = marks => ({ marks });
  assert.deepEqual(rules(judgeResize([sample(0, placed(), mark([['3:0|babel-theta-terminal-index', 1]])), sample(17, placed(), mark([]))])),
    ['resize-motion/mark-vanished']);
  assert.deepEqual(rules(judgeResize([sample(0, placed(), mark([['3:0|x', 1]])), sample(17, placed(), mark([])), sample(34, placed(), mark([['3:0|x', 1]]))])),
    ['resize-motion/mark-blink']);
});

test('#14: rapid Next flicker — empty frames, opacity dips, snap-backs and blinking later nodes', () => {
  const base = (t, dx = 0, extra = {}) => sample(t, placed(dx), extra);
  const series = mutate => Array.from({ length: 14 }, (_, index) => mutate(index, base(16.7 * index, index * 4)));
  assert.deepEqual(judgeRapidStepping(series((index, frame) => frame)), []);
  assert.deepEqual(rules(judgeRapidStepping(series((index, frame) => index === 6 ? { ...frame, visibility: 0.4 } : frame))), ['rapid-motion/faded']);
  assert.deepEqual(rules(judgeRapidStepping(series((index, frame) => index === 6 ? { ...frame, nodes: [] } : frame))), ['rapid-motion/empty-frame']);
  const back = series((index, frame) => index === 6 ? base(frame.t, 24 + 120) : index === 7 ? base(frame.t, 22) : frame);
  assert(rules(judgeRapidStepping(back)).includes('rapid-motion/snap-back'));
  const later = series((index, frame) => index < 4 || index === 8 || index === 9 ? frame : { ...frame, nodes: [...frame.nodes, ['newDP', 900, 500, 1, null]] });
  assert.deepEqual(rules(judgeRapidStepping(later)), ['rapid-motion/node-blink']);
  const quieted = series((index, frame) => ({ ...frame, marks: [['3:0|babel-feature-plaque', index >= 4 && index <= 8 ? 0.3 : 1]] }));
  assert.deepEqual(judgeRapidStepping(quieted), [], 'a mark quieted by another relation moment still paints');
});

test('settled syntax moving inside a stage is flagged unless its step owns it, by the shared ownership', () => {
  const light = (number, positions, { stage = 2, step = { target: 'v', links: [] } } = {}) => ({ ...cameraFrame({ frame: { stage },
    nodes: Object.entries(positions).map(([id, [tx, ty]]) => ({ id, tx, ty })),
    edges: Object.entries(positions).filter(([, [, , parent]]) => parent).map(([id, [, , parent]]) => ({ source: parent, target: id })) },
  { step }), number });
  const tree = ({ waitingX = 900, ipX = 0, ibarX = 60 } = {}) => ({ ip: [ipX, 0], ibar: [ibarX, 60, 'ip'], v: [20, 120, 'ibar'], w: [100, 120, 'ibar'],
    waiting: [waitingX, 0] });
  const place = { place: { record: 'r', viewport: 'desktop' } };
  assert.deepEqual(judgeStageSyntax([light(5, tree()), light(6, tree({ waitingX: 902 }))], place)
    .map(item => [item.rule, item.subject, item.frame, item.measure]), [['syntax-continuity', 'waiting', '5>6', 2]], 'one shifted root');
  assert.deepEqual(judgeStageSyntax([light(5, tree()), light(6, tree({ waitingX: 902 }), { step: { target: 'waiting', links: [] } })]), [],
    'the step that targets it owns it');
  assert.deepEqual(judgeStageSyntax([light(5, tree()), light(6, tree({ ipX: 30, ibarX: 90 }))]), [],
    'ancestors recentring over the step\'s own change (the V-to-C and Spec-IP moments of catalogue cases 1 and 4)');
  assert.deepEqual(rules(judgeStageSyntax([light(5, tree()), light(6, { ...tree(), w: [140, 120, 'ibar'] })])), ['syntax-continuity/retained-node-moves'],
    'a sibling of the target is not owned');
  assert.deepEqual(judgeStageSyntax([light(5, tree()), light(6, { ...tree(), w: [400, 120, 'waiting'] })]), [], 'reattached syntax is owned');
  assert.deepEqual(judgeStageSyntax([light(5, tree()), light(6, tree({ waitingX: 902 }), { stage: 3 })]), [], 'a new stage has its own coordinates');
  assert.deepEqual(judgeStageSyntax([light(5, tree()), light(6, tree({ waitingX: 902 }), { step: null })]), [], 'an unknown step is not judged');
});

test('gate policy: a painted motion fault counts only if its immediate re-run shows it again', () => {
  const finding = (rule, subtype, reproduced) => ({ rule, subtype, record: 'r', subject: '@view', frame: '42>43', viewport: 'desktop',
    measure: 165, detail: '', reproduced });
  const once = gateVerdict([finding('step-motion', 'fly-in', false)], []);
  assert.deepEqual([once.unexpected.length, once.warnings.map(item => item.subtype)], [0, ['fly-in']], 'a one-off is a warning');
  assert.equal(gateVerdict([finding('step-motion', 'fly-in', true)], []).unexpected.length, 1, 'a reproduced fault fails');
  assert.equal(gateVerdict([finding('step-motion', 'fly-in', null)], []).unexpected.length, 1, 'a fault never re-run still fails');
  assert.equal(gateVerdict([finding('glyph-overlap', 'text', false)], []).unexpected.length, 1, 'static geometry has no re-run exemption');
  const listed = [{ rule: 'step-motion', subtype: 'fly-in', record: 'r', subject: '@view', at: { desktop: { '42>43': 100 } }, reason: 'x' }];
  const beyond = gateVerdict([finding('step-motion', 'fly-in', false)], listed);
  assert.deepEqual([beyond.exceeded.length, beyond.stale.length, beyond.warnings.length], [0, 0, 1], 'beyond its bound once: a warning, not stale');
});

test('#7: the camera policy flags a stage entry that keeps a view framing none of the new stage, and allows a justified one', () => {
  const light = (stage, dx) => ({ frame: { stage }, canvas: { x: 0, y: 0, width: 1440, height: 900 }, origin: { x: 0, y: 0 },
    header: { x: 1100, y: 24, width: 300, height: 30 }, panel: { x: 1000, y: 700, width: 420, height: 180 },
    nodes: [['a', 0], ['b', 200], ['c', 400]].map(([id, x]) => ({ id, tx: x + dx, ty: 300 })), edges: [{ source: 'a', target: 'b' }, { source: 'a', target: 'c' }] });
  const trace = settledPose => ({ ...cameraView(light(1, 0)), frames: [cameraFrame(light(1, 0)), cameraFrame(light(2, 3000))],
    direct: Object.assign([], { 1: { x: -2700, y: 0, k: 1 } }), passes: [{ name: 'next', steps: [{ from: 0, to: 1, before: { x: 300, y: 0, k: 1 },
      first: settledPose, settled: settledPose }] }] });
  const parked = checkCameraTrace(trace({ x: 300, y: 0, k: 1 }));
  assert(parked.findings.some(item => item.rule === 'settled-path-independence' && item.subtype === 'retention' && item.frame === '1>2'));
  const kept = checkCameraTrace(trace({ x: -2698, y: 0, k: 1 }));
  assert(!kept.findings.some(item => item.rule === 'settled-path-independence'));
  assert.equal(kept.allowed.length, 1, 'retention that holds shared syntax as still as the fit is allowed');
  assert.deepEqual(firstPaintedPose([{ gen: 1, transform: { x: 0, y: 0, k: 1 } }, { gen: 1, transform: { x: 0, y: 0, k: 1 } },
    { gen: 2, transform: { x: 5, y: 0, k: 1 } }]), { x: 5, y: 0, k: 1 });
});

test('accounting: a baseline finding resolves only where the same check judged the same place again', () => {
  const finding = (frame, rule = 'glyph-overlap', subtype = 'text') => ({ rule, subtype, record: 'r', subject: 'a:word b:word', frame, viewport: 'desktop', measure: 3, detail: '' });
  const baseline = { findings: [finding(30), finding('20>21', 'step-motion', 'teleport')],
    coverage: [coverageKey('r', 'desktop', 'static', 30), coverageKey('r', 'desktop', 'motion', '20>21')] };
  const frameOne = compareWithBaseline({ findings: [finding(1)], coverage: [coverageKey('r', 'desktop', 'static', 1)] }, baseline);
  assert.deepEqual(frameOne.resolved, [], 'a frame-1 finding does not resolve an unaudited frame-30 finding');
  assert.deepEqual(frameOne.uncovered.map(item => item.frame), [30, '20>21']);
  assert.deepEqual(frameOne.rows.map(row => row.status), ['new']);
  const clean = compareWithBaseline({ findings: [], coverage: [coverageKey('r', 'desktop', 'static', 30)] }, baseline);
  assert.deepEqual(clean.resolved.map(item => item.frame), [30], 'a clean rerun resolves what it judged');
  assert.deepEqual(clean.uncovered.map(item => item.frame), ['20>21'], '...and only that: the motion check did not run');
  const staticOnly = compareWithBaseline({ findings: [], coverage: [coverageKey('r', 'desktop', 'static', '20>21')] }, baseline);
  assert.deepEqual(staticOnly.resolved, [], 'another check at the same token covers nothing');
  const again = compareWithBaseline({ findings: [finding(30)], coverage: baseline.coverage }, baseline);
  assert.deepEqual(again.rows.map(row => row.status), ['known']);
  assert.deepEqual(again.resolved.map(item => item.rule), ['step-motion']);
});

test('accounting: resume reuses a receipt only from the same sources and configuration', () => {
  const expected = { source: 's1', config: 'c1' };
  assert(receiptMatches({ fingerprint: { source: 's1', config: 'c1' } }, expected));
  assert(!receiptMatches({ fingerprint: { source: 's0', config: 'c1' } }, expected), 'changed sources or page');
  assert(!receiptMatches({ fingerprint: { source: 's1', config: 'c0' } }, expected), 'changed checks, frames or thresholds');
  assert(!receiptMatches({ fingerprint: expected, error: 'Replay: timeout' }, expected), 'a failed receipt is re-audited');
  assert(!receiptMatches({}, expected), 'an old receipt without fingerprints');
});

test('report: summary and index show flagged places, escaped', () => {
  const rows = [{ rule: 'glyph-overlap', subtype: 'text', record: 'r', subject: 'a b', frame: 3, viewport: 'desktop', measure: 3,
    detail: '<b>word</b> overlaps', status: 'new' }];
  const summary = summarize([{ id: 'r', coverage: ['x', 'y'] }], rows);
  assert.deepEqual([summary.placesJudged, summary.flaggedPlaces, summary.byRule['glyph-overlap/text'].new], [2, 1, 1]);
  const html = renderIndexHtml({ report: { summary, baseline: { new: 1, known: 0, resolved: 0, uncovered: 0 } }, rows });
  assert.match(html, /desktop · static · 3/);
  assert.doesNotMatch(html, /<b>word<\/b>/);
});

test('plan: pages, viewports, frames, cases, shards, samples and estimates', () => {
  const records = ['hunt1/12-en-whose-relative/0', 'hunt2/20-en-scope/0', 'hunt2/20-en-scope/1', 'spellout/21-es-wh-inversion/0']
    .map(id => ({ id, sentence: id, derivationStages: [] }));
  assert.equal(extractPageRecords(`<script id="replay-records" type="application/json">${JSON.stringify({ records })}</script>`).records.length, 4);
  assert.throws(() => extractPageRecords('<html></html>'), /replay-records/);
  assert.deepEqual(parseViewports('1440x900,390x844').map(v => v.label), ['1440x900', '390x844']);
  assert.deepEqual(parseResizeSequence('1.33,1,0.8,1', { width: 1440, height: 900 }).map(size => size.label),
    ['1915x1197', '1440x900', '1152x720', '1440x900'], 'grow, shrink back out, shrink, grow back');
  assert.throws(() => parseFrameSpec('later'));
  assert.deepEqual(resolveFrames(parseFrameSpec('stage-entry,final'), 30, [5, 12]), [5, 12, 30]);
  assert.deepEqual(traversalRange(['20-21'], 68, [20, 21]), { start: 19, end: 21 });
  assert.deepEqual(stageEntryFrames([1, 1, 1, 2, 2, 3]), [4, 6]);
  assert.deepEqual(selectCases(records, { cases: 'hunt2/*' }).map(entry => entry.id), ['hunt2/20-en-scope/0', 'hunt2/20-en-scope/1']);
  assert.deepEqual(selectCases(records, { caseSpecs: ['hunt1/12-en-whose-relative/0@1-21,40'] }), [{ id: 'hunt1/12-en-whose-relative/0', frames: '1-21,40' }]);
  assert.throws(() => selectCases(records, { cases: 'hunt3/*' }), /Unknown saved analyses/);
  const all = selectCases(records, { cases: 'all' });
  assert.deepEqual([1, 2, 3].flatMap(index => applyShard(all, parseShard(`${index}/3`))).map(entry => entry.id).sort(), all.map(entry => entry.id).sort());
  assert.deepEqual(sampleCases(all, 2, 7), sampleCases(all, 2, 7));
  const one = estimateRuntime({ cases: [{ traversed: 40, audited: 41, direct: 6, rapid: 2 }], viewports: 2 });
  assert(one.seconds > estimateRuntime({ cases: [{ traversed: 40, audited: 41, direct: 6, rapid: 2 }], viewports: 2, fast: true }).seconds);
});

test('the bounded check audits the catalogue analyses under the offline audit\'s record ids', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/replay-regressions/visual-human-catalog.json'), 'utf8'));
  const records = catalogRecords(fixture);
  assert.equal(records.length, fixture.cases.reduce((sum, entry) => sum + entry.analyses.length, 0));
  assert.equal(records[0].id, 'replay-regressions/visual-human-catalog.json#/cases/0/analyses/0');
  assert(records.every(record => record.sentence && record.derivationStages.length));
});

test('the serialized page probe collects geometry the shared rules judge, and samples every frame', async () => {
  const dom = createAuditDom();
  const { element: el } = dom;
  const text = (attrs, content, localBox, extra = {}) => Object.assign(el('text', attrs, ...[content].flat()), { localBox, ...extra });
  const node = (id, x, y, ...children) => el('g', { class: 'node-group', 'data-node-group-id': id, transform: `translate(${x},${y})`, opacity: 1 }, ...children);
  const outlined = { computed: { stroke: '#020806', paintOrder: 'stroke', fontSize: '42px' } };
  const category = (id, lines) => {
    const spans = lines.map((line, index) => {
      const y = -10 - (lines.length - 1 - index) * 48;
      return Object.assign(el('tspan', { y }, line), { localBox: { x: -100, y: y - 50, width: 200, height: 52 }, baseline: y });
    });
    const box = { x: -100, y: -60 - (lines.length - 1) * 48, width: 200, height: 52 * lines.length };
    return Object.assign(text({ class: 'category-label', 'data-category-node-id': id, 'stroke-width': 10 }, spans, box, { baseline: -10 }), outlined);
  };
  const word = (id, content, ...children) => Object.assign(text({ class: 'terminal-label', 'data-node-id': id, 'stroke-width': 8 }, [content, ...children],
    { x: -90, y: 70, width: 180, height: 60 }, { baseline: 115 }), outlined);
  const stem = () => Object.assign(el('line', { 'stroke-width': 3, 'stroke-dasharray': '8,8' }), { points: [[0, 20], [0, 65]] });
  const branch = (source, target, points) => Object.assign(el('path', { class: 'branch', 'data-source-node-id': source, 'data-target-node-id': target, opacity: 0.6, 'stroke-width': 4 }), { points });
  const identity = Object.assign(el('tspan', { class: 'babel-identity-index babel-relation-index', 'data-vr-owner-refs': '1:1' }, 'j'),
    { localBox: { x: 92, y: 90, width: 30, height: 40 } });
  const treeGroup = el('g', { transform: 'translate(700,100) scale(0.5)' },
    branch('cp', 'queDP', [[0, 0], [-300, 300]]), branch('cp', 'cbar', [[0, 0], [300, 300]]),
    branch('cbar', 'juanDP', [[300, 300], [-100, 300], [-450, 600]]),
    node('cp', 0, 0, category('cp', ['Coord[alternative', ']'])),
    node('queDP', -300, 300, word('queDP', 'Qué'), stem()), node('cbar', 300, 300, category('cbar', ['C′'])),
    node('juanDP', -450, 600, word('juanDP', 'every', identity), stem()),
    el('g', { class: 'vr-overlay-layer' },
      el('g', { class: 'vr-item', 'data-vr-owner-refs': '4:0' },
        el('g', { class: 'vr-fallback-connector' },
          Object.assign(el('path', { class: 'vr-fallback-shadow', 'stroke-width': 3.6 }), { points: [[100, 900], [400, 900]] }),
          Object.assign(el('path', { class: 'vr-fallback-segment vr-fallback-segment-direct', 'stroke-width': 1.5 }), { points: [[100, 900], [400, 900]] }))),
      el('g', { class: 'vr-item', 'data-vr-owner-refs': '1:1' },
        text({ class: 'babel-binding-index babel-relation-index', 'data-binding-anchor': 'juanDP' }, 'j', { x: -355, y: 680, width: 30, height: 40 }))),
    el('g', { class: 'babel-feature-relation-layer' },
      el('g', { class: 'babel-feature-plaque vr-item', 'data-feature-anchor': 'cbar', 'data-plaque-location': 'local', 'data-vr-owner-refs': '2:0' },
        Object.assign(el('rect', { class: 'babel-feature-plaque-shell', rx: 14 }), { localBox: { x: 400, y: 860, width: 300, height: 80 } }),
        text({ class: 'babel-feature-text' }, [Object.assign(el('tspan', { x: 420, y: 905 }, 'clauseType: declarative'),
          { localBox: { x: 420, y: 880, width: 260, height: 40 } })], { x: 420, y: 880, width: 260, height: 40 }, { baseline: 905 }))),
    // A Case plaque as caseFeatureDrawing paints it: shell and title in the frame group, rows beside it.
    el('g', { class: 'babel-agreement-case-relation-layer' },
      el('g', { class: 'babel-feature-plaque babel-case-feature-plaque', 'data-feature-placement': 'accepted' },
        el('g', { class: 'babel-feature-plaque-frame vr-item', 'data-vr-owner-refs': '5:0 5:1' },
          Object.assign(el('rect', { class: 'babel-feature-plaque-shell', rx: 12 }), { localBox: { x: 900, y: 100, width: 400, height: 160 } }),
          text({ class: 'babel-feature-plaque-title' }, 'CASE / AGREEMENT', { x: 920, y: 110, width: 240, height: 30 }, { baseline: 132 })),
        el('g', { class: 'babel-feature-row vr-item', 'data-vr-owner-refs': '5:1', 'data-feature-anchor': 'cbar' },
          text({ class: 'babel-feature-text' }, [Object.assign(el('tspan', { x: 922, y: 200 }, '[Case: accusative]'),
            { localBox: { x: 922, y: 180, width: 300, height: 40 } })], { x: 922, y: 180, width: 300, height: 40 }, { baseline: 200 })))),
    // A neutral role label of another claim placed over that plaque.
    el('g', { class: 'vr-item', 'data-vr-owner-refs': '6:0' },
      el('g', { class: 'vr-fallback-mark' }, text({ class: 'vr-fallback-role' }, 'Theme', { x: 1150, y: 200, width: 120, height: 40 }, { baseline: 230 }))));
  const svg = Object.assign(el('svg', { 'data-babel-tree': 'true', 'data-babel-rendered-step': '2', 'data-babel-camera-settled-step': '2' }, treeGroup),
    { box: { x: 0, y: 60, width: 1440, height: 840 } });
  const next = Object.assign(el('button', {}, 'Next'), { onclick: () => treeGroup.setAttribute('transform', 'translate(3000,900) scale(0.5)') });
  const slider = el('input', { 'aria-label': 'Replay frame', max: 4, value: 2 });
  let jumped = null;
  slider.addEventListener('input', () => { jumped = slider.value; });
  const panel = Object.assign(el('div', { 'data-babel-replay-panel': 'true', 'data-babel-replay-kind': 'micro' }, el('button', {}, 'Prev'), next, slider),
    { box: { x: 1000, y: 700, width: 420, height: 180 } });
  const header = Object.assign(el('div', { 'data-babel-replay-header': 'true' }, el('div', {}, 'DERIVATION SEQUENCE ACTIVE'),
    el('div', {}, 'Replay Frame 3/5 · Stage 2/3 · Step 1/2')), { box: { x: 1100, y: 84, width: 300, height: 30 } });
  dom.document.body.append(el('main', {}, el('section', {}, el('div', { class: 'tree-container' }, header, panel, svg))));
  const restore = dom.install();
  try {
    new Function(probeScript())();
    const audit = dom.window.__babelAudit;
    const snapshot = audit.collect();
    assert.deepEqual(snapshot.errors, []);
    assert.deepEqual([snapshot.camera, snapshot.origin, snapshot.panel], [{ x: 700, y: 100, k: 0.5 }, { x: 0, y: 60 }, { x: 1000, y: 700, width: 420, height: 180 }]);
    assert.deepEqual(snapshot.frame, { frame: 3, frameCount: 5, stage: 2, stageCount: 3, step: 1, stepCount: 2, kind: 'micro', view: 'Replay',
      rendered: '2', settled: '2', activeRelation: null });
    assert.deepEqual(snapshot.texts.map(item => [item.kind, item.text, item.nodeId, item.host, item.strokePx]), [
      ['category', 'Coord[alternative ]', 'cp', null, 5], ['word', 'Qué', 'queDP', null, 4], ['category', 'C′', 'cbar', null, 5],
      ['word', 'every', 'juanDP', null, 4], ['index', 'j', 'juanDP', 't3', 0], ['index', 'j', null, null, 0],
      ['plaque-text', 'clauseType: declarative', null, null, 0], ['plaque-text', 'CASE / AGREEMENT', null, null, 0],
      ['plaque-text', '[Case: accusative]', null, null, 0], ['relation-label', 'Theme', null, null, 0]]);
    assert.deepEqual(snapshot.texts.filter(item => item.kind === 'plaque-text').map(item => item.plaque), ['p0', 'p1', 'p1'],
      'a Case plaque\'s rows belong to it through the painter\'s plaque group');
    assert.equal(snapshot.texts[0].inkBoxes.length, 2, 'one glyph box per wrapped line');
    assert.deepEqual(snapshot.texts[5].placement.anchor, 'juanDP');
    assert.deepEqual(snapshot.plaques.map(item => [item.anchor, item.radiusPx, item.joined]), [['cbar', 7, false], [null, 6, true]]);
    assert.deepEqual(snapshot.branches.map(item => item.kind), ['branch', 'branch', 'branch', 'stem', 'stem']);
    const { model } = toFrameModel(snapshot, { frame: 3, viewport: 'desktop' });
    assert.deepEqual(model.texts.map(item => item.id), ['cp:category', 'queDP:word', 'cbar:category', 'juanDP:word', 'index(1:1 j)@juanDP',
      'role(6:0 Theme)@']);
    assert.deepEqual(model.lines.map(item => item.id), ['cp->queDP', 'cp->cbar', 'cbar->juanDP', 'queDP:stem', 'juanDP:stem', 'connector(4:0)']);
    const overlaps = checkFrame(model).filter(item => item.rule === 'glyph-overlap' && item.subtype === 'text-plaque');
    assert.deepEqual(overlaps.map(item => [item.subtype, item.subject]),
      [['text-plaque', 'plaque(5:0/5:1 CASE / AGREEMENT; [Case: accusative])@ role(6:0 Theme)@']],
      'the role label of another claim overlaps the plaque; the plaque\'s own rows do not');
    const found = rules(checkFrame(model));
    for (const rule of ['line-clearance/branch-text', 'line-clearance/connector-plaque', 'label-typography/closing-start']) assert(found.includes(rule), `${rule} in ${found}`);
    assert.deepEqual(letterFindings(snapshot, { record: 'r', frame: 3, viewport: 'desktop' }).map(item => item.subject), ['juanDP:word j']);
    const light = audit.collect({ light: true });
    assert.deepEqual([light.light, light.edges.length, Boolean(light.panel)], [true, 3, true]);
    assert.deepEqual([...cameraFrame(light).nodes.get('juanDP').ancestors], ['cbar', 'cp']);

    assert.equal(audit.jumpTo(4), true);
    assert.equal(jumped, '4');
    const started = audit.startSampler();
    dom.renderFrame(); dom.renderFrame();
    assert.equal(await started, 1);
    assert.equal(audit.clickNext(), true);
    dom.renderFrame();
    treeGroup.setAttribute('transform', 'translate(700,100) scale(0.5)');
    for (let index = 0; index < 4; index++) dom.renderFrame();
    const { frames, clicks } = audit.stopSampler();
    assert.equal(clicks.length, 1);
    assert.equal(frames.length, 7, 'one sample per rendering update');
    assert.deepEqual(frames[0].nodes.find(entry => entry[0] === 'juanDP').slice(3), [1, 'cbar'], 'samples carry each node\'s parent');
    assert.equal(dom.document.querySelector('[data-babel-audit-probe]'), null, 'the sampler removes its probe');
    assert(rules(judgeStepMotion(frames)).includes('step-motion/teleport'));
    audit.showOverlay([{ box: { x: 1, y: 2, width: 3, height: 4 }, color: '#f87171', label: '1' }]);
    assert(dom.document.getElementById('babel-audit-overlay'));
    audit.clearOverlay();
    assert.equal(dom.document.getElementById('babel-audit-overlay'), null);
  } finally { restore(); }
});

test('the CLI plans a dry run from a review page without a browser', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/replay-regressions/coordination-and-ellipsis.json'), 'utf8'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-visual-audit-'));
  try {
    const page = path.join(dir, 'page.html');
    fs.writeFileSync(page, `<!doctype html><script id="replay-records" type="application/json">${JSON.stringify([
      { id: 'fixture/0', sentence: fixture.sentence, inputTokens: fixture.inputTokens, derivationStages: fixture.derivationStages }])}</script>`);
    const run = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts/auditReplayBrowser.mjs'), '--page', page, ...args], { encoding: 'utf8' });
    const planned = run('--cases', 'all', '--dry-run', '--viewports', '1440x900', '--out', path.join(dir, 'plan'));
    assert.equal(planned.status, 0, planned.stderr);
    const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan', 'plan.json'), 'utf8'));
    assert.equal(plan.frameCounts, 'prepareReplay');
    assert(plan.rows[0].frameCount > 1 && plan.estimate.seconds > 0);
    const unknown = run('--cases', 'missing/0', '--dry-run');
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /Unknown saved analyses: missing\/0/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
