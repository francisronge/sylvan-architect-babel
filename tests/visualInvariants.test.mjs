import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { placeStagePlaques, plaqueTreeObstacles } from '../replay/relations/plaquePlacement.ts';
import { TREE_FIRST_FAMILIES } from '../replay/stageCamera.ts';
import { formatFrames, frameList, matchFindings, proposeExceptions } from './helpers/findings.mjs';
import { measurePlaqueText, measureRun } from './helpers/visualFontMetrics.mjs';
import {
  auditVisualRecord, branchPoints, layoutVisualFrames, layoutWidthFindings, pathPolylines, plaqueRecord, prepareVisualRecord, TEXT_METRICS, VIEWPORTS
} from './helpers/visualFrames.mjs';
import {
  checkBranchGeometry, checkClipped, checkGlyphOverlap, checkLabelTypography, checkLineClearance, checkMarkDistance, checkParentCentring, RULES
} from './helpers/visualRules.mjs';
import { EXCEPTIONS } from './helpers/visualExceptions.mjs';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { checkOneLetterPerLabel } from './helpers/replayInvariants.mjs';

/* Fast controls and the reviewed historical cases. The exhaustive fixture sweep
 * is `npm run verify:visual-offline`. */

const corpus = loadFixtureAnalyses();
const recordOf = id => corpus.records.find(entry => entry.id === id).record;
const CATALOG = 'replay-regressions/visual-human-catalog.json#/cases';
const DESKTOP = VIEWPORTS.filter(viewport => viewport.name !== 'mobile');
// A clean frame with a plaque and 52 labels, for controlled breaks of production geometry.
const sample = () => layoutVisualFrames(prepareVisualRecord(recordOf('replay-regressions/workspace-historical-continuity.json#/cases/4')),
  [VIEWPORTS[0]], { steps: [33] })[0];
const blank = (zoom = 1) => ({ frame: 1, viewport: 'desktop', zoom, texts: [], plaques: [], lines: [] });
const box = (x, y, width, height) => ({ x, y, width, height });
const text = (node, kind, rect, extra = {}) => ({ id: `${node}:${kind}`, kind, text: node, boxes: [rect], halo: kind === 'word' ? 4 : 5,
  nodes: [node], claims: [], ...extra });
const subjects = violations => violations.map(violation => violation.subject).sort();

test('findings: an exception covers exact places within each place\'s bound; new, worse and stale places fail', () => {
  assert.deepEqual(frameList('3-5,9,canopy'), ['3', '4', '5', '9', 'canopy']);
  assert.equal(formatFrames([9, 3, 4, 5, 'canopy']), '3-5,9,canopy');
  const finding = (frame, viewport, measure) => ({ rule: 'line-clearance', subtype: 'branch-text', record: 'r', subject: 's', frame, viewport, measure });
  const found = [finding(3, 'desktop', 2), finding(4, 'desktop', 2), finding(5, 'desktop', 2.5), finding(3, 'desktop-large', 1.86)];
  const [listed] = proposeExceptions(found);
  assert.deepEqual(listed.at, { desktop: { '3-4': 2, '5': 2.5 }, 'desktop-large': { '3': 1.86 } });
  assert.deepEqual(matchFindings(found, [listed]), { unexpected: [], exceeded: [], stale: [] });
  const spread = matchFindings([...found, finding(6, 'desktop', 1), finding(3, 'mobile', 1)], [listed]);
  assert.deepEqual(spread.unexpected.map(item => [item.frame, item.viewport]), [[6, 'desktop'], [3, 'mobile']]);
  // One place may not borrow another's bound: 1.86 rising to 2.63 fails although desktop reaches 2.5.
  const worse = matchFindings([...found.slice(0, 3), finding(3, 'desktop-large', 2.5)], [listed]);
  assert.deepEqual(worse.exceeded.map(({ finding: item, bound }) => [item.viewport, item.measure, bound]), [['desktop-large', 2.5, 1.86]]);
  assert.deepEqual(matchFindings(found.slice(1), [listed]).stale.map(item => [item.viewport, item.frame]), [['desktop', '3']]);
  assert.throws(() => matchFindings(found, [listed, listed]), /Duplicate exception/);
});

test('fonts: a grapheme measures alike precomposed or decomposed, and a stacked mark raises its ink', () => {
  const font = { family: 'Quicksand', size: 42, weight: 900 };
  assert.deepEqual(measureRun('a\u0301', font), measureRun('\u00e1', font));
  assert.deepEqual(measureRun('o\u0323\u0302', font), measureRun('\u1ed9', font));
  assert(measureRun('\u00e1', font).ascent > measureRun('a', font).ascent + 2 / 0.25, 'the acute rises above the x-height');
  assert(measureRun('q\u0301', font).ascent > measureRun('q', font).ascent, 'a mark with no precomposed form still counts');
  assert.equal(measureRun('q\u0301', font).width, measureRun('q', font).width, 'a combining mark adds no advance');
});

test('control: glyph-overlap reports text or plaques painted over each other, beyond a two-pixel outline sliver', () => {
  const frame = { ...blank(), texts: [text('a', 'category', box(0, 0, 100, 40)), text('b', 'category', box(102, 0, 60, 40)),
    text('a', 'word', box(20, 30, 60, 50))] };
  assert.deepEqual(subjects(checkGlyphOverlap(frame)), ['a:category b:category'],
    'b sits 3 px inside a\'s outline; one node\'s category and word never pair');
  frame.texts[1] = text('b', 'category', box(104, 0, 60, 40));
  assert.deepEqual(checkGlyphOverlap(frame), [], 'one pixel of shared outline is tolerated');
  const role = (claim, x) => ({ id: `role(${claim})@${x}`, kind: 'role', text: 'goal', boxes: [box(x, 200, 50, 10)], halo: 1, nodes: [], claims: [claim] });
  frame.texts.push(role('1:0', 0), role('1:0', 20), role('2:0', 40));
  assert.deepEqual(subjects(checkGlyphOverlap(frame)), ['role(1:0)@0 role(2:0)@40', 'role(1:0)@20 role(2:0)@40'],
    'pieces of one mark are laid out together; another mark\'s text is not');
  frame.texts.splice(3);
  frame.plaques.push({ id: 'plaque@a', text: 'case: nominative', rect: box(30, 10, 200, 60), claims: [] },
    { id: 'shell@a', text: 'collection', rect: box(20, 0, 300, 100), claims: [] });
  assert.deepEqual(subjects(checkGlyphOverlap(frame)), ['a:category plaque@a', 'a:category shell@a', 'a:word plaque@a', 'a:word shell@a',
    'b:category plaque@a', 'b:category shell@a'], 'a plaque over text overlaps; a shell nesting a plaque does not');

  // Production layout: clean, until a plaque is moved onto tree text.
  const real = sample(), target = real.texts.find(item => item.kind === 'category');
  assert.deepEqual(checkGlyphOverlap(real), []);
  const moved = { ...real, plaques: real.plaques.map((plaque, index) => index ? plaque : { ...plaque, rect: { ...plaque.rect,
    x: target.boxes[0].x, y: target.boxes[0].y } }) };
  assert(subjects(checkGlyphOverlap(moved)).some(subject => subject.includes(target.id) && subject.includes(real.plaques[0].id)));
});

test('control: line-clearance reports a spoke cut at a plaque, a lane through text and a branch through another node\'s word', () => {
  // A direct spoke cut exactly at a visible plaque, as main's routing cut it before PR #76: its round cap touches the outline.
  const scale = 5, plaque = { id: 'plaque@t', text: 'tense: past', rect: box(400, 80, 200, 80), radius: 14, claims: ['1:0'] };
  const spoke = { id: 'spoke', kind: 'connector', paths: pathPolylines('M 0 120 L 400 120 M 600 120 L 1000 120'), halfWidth: 1.5 * scale / 2,
    nodes: ['a', 'b'], claims: ['1:1'] };
  const frame = { ...blank(0.15), plaques: [plaque], lines: [spoke] };
  assert.deepEqual(subjects(checkLineClearance(frame)), ['spoke plaque@t']);
  assert.deepEqual(checkLineClearance({ ...frame, plaques: [{ ...plaque, claims: ['1:1'] }] }), [], 'a leader meets its own plaque');
  // Stopping six marker units short (PR #76's gap) clears the outline by more than a pixel.
  spoke.paths = pathPolylines(`M 0 120 L ${400 - 6 * scale} 120 M ${600 + 6 * scale} 120 L 1000 120`);
  assert.deepEqual(checkLineClearance(frame), []);
  // Catalog #4 as main cut it before PR #76, at frame 39 (1440×900): the spoke stops on the corner of [clauseType: declarative].
  const historical = { ...blank(0.1401), plaques: [{ id: 'clauseType', text: 'clauseType: declarative', rect: box(1472.5, 375.4, 360, 129.2),
    radius: 14, claims: ['3:2'] }], lines: [{ id: 'spoke', kind: 'connector', halfWidth: 2.7, nodes: [], claims: ['3:3'],
    paths: [[{ x: 2277.6, y: 5.2 }, { x: 1832.5, y: 460.6 }], [{ x: 1789.5, y: 504.6 }, { x: 1693, y: 603.3 }]] }] };
  assert.deepEqual(subjects(checkLineClearance(historical)), ['spoke clauseType']);
  // An accepted contact cannot cover a crossing: a spoke through the plaque's centre is its own subtype, measured as depth.
  const accepted = proposeExceptions(checkLineClearance(historical).map(found => ({ ...found, record: 'r' })));
  const through = { ...historical, lines: [{ ...historical.lines[0], paths: [[{ x: 1400, y: 440 }, { x: 1900, y: 440 }]] }] };
  const crossing = checkLineClearance(through).map(found => ({ ...found, record: 'r' }));
  assert.deepEqual(crossing.map(found => found.subtype).sort(), ['connector-plaque', 'connector-plaque-crossing']);
  assert.deepEqual(matchFindings(crossing, accepted).unexpected.map(found => found.subtype), ['connector-plaque-crossing']);
  // A line past a rectangle's corner clears its rounded shell.
  const corner = { ...frame, zoom: 1, lines: [{ ...spoke, halfWidth: 0.5, paths: [[{ x: 370, y: 114 }, { x: 404, y: 80 }]] }] };
  assert.deepEqual(checkLineClearance(corner), []);
  assert.deepEqual(checkLineClearance({ ...corner, plaques: [{ ...plaque, radius: 0 }] }).map(found => found.subtype).sort(),
    ['connector-plaque', 'connector-plaque-crossing']);
  // A lane is clipped only at its stems: through tree text it is reported, through its own witnesses' text it is not.
  frame.texts = [text('x', 'category', box(150, 100, 80, 40)), text('a', 'category', box(-40, 100, 80, 40))];
  assert.deepEqual(subjects(checkLineClearance(frame)), ['spoke x:category']);

  const branches = { ...blank(), lines: [{ id: 'p->c', kind: 'branch', paths: [[{ x: 0, y: 0 }, { x: 0, y: 300 }]], halfWidth: 2,
    nodes: ['p', 'c'], claims: [] }], texts: [text('w', 'word', box(-50, 100, 100, 40)), text('c', 'category', box(-20, 260, 40, 40))] };
  assert.deepEqual(subjects(checkLineClearance(branches)), ['p->c w:word'], 'a branch meets its own child\'s label');
  branches.texts[0] = text('w', 'word', box(-100, 100, 100.5, 40));
  assert.deepEqual(checkLineClearance(branches), [], 'grazing the edge of a glyph box is not a crossing');
  // Catalog #9 as main laid it out before #79, at frame 22 (1440×900): Qué hangs into Juan's branch.
  const hanging = { ...blank(0.2271), texts: [text('what1::__leaf', 'word', box(3409, 1172.3, 143.1, 53.9))],
    lines: [{ id: 'juan->juan::__leaf', kind: 'branch', paths: [branchPoints({ x: 3438.8, y: 1100 }, { x: 3438.8, y: 1320 })],
      halfWidth: 2, nodes: ['juan', 'juan::__leaf'], claims: [] }] };
  assert.deepEqual(subjects(checkLineClearance(hanging)), ['juan->juan::__leaf what1::__leaf:word']);

  // Production layout: moving a word onto another node's branch is reported.
  const real = sample();
  assert.deepEqual(checkLineClearance(real), []);
  const branch = real.lines.find(line => line.kind === 'branch' && Math.abs(line.paths[0][0].x - line.paths[0].at(-1).x) > 100);
  const word = real.texts.find(item => item.kind === 'word' && !item.nodes.some(node => branch.nodes.includes(node)));
  const middle = branch.paths[0][12], [glyphs] = word.boxes;
  const shifted = { ...word, boxes: [box(middle.x - glyphs.width / 2, middle.y - glyphs.height / 2, glyphs.width, glyphs.height)] };
  assert(subjects(checkLineClearance({ ...real, texts: real.texts.map(item => item === word ? shifted : item) })).includes(`${branch.id} ${word.id}`));
});

test('control: mark-distance reports a plaque left far from its anchor, as the allocator leaves it when every nearby pocket is taken', () => {
  const nodes = d3.tree().nodeSize([600, 300])(d3.hierarchy({ id: 'root', label: 'XP', children: [
    { id: 'left', label: 'X', word: 'first' }, { id: 'right', label: 'Y', word: 'second' }] })).descendants();
  const item = { kind: 'node-plaque', plaqueStyle: 'feature', anchorNodeIds: ['left'], rows: [{ label: 'case', value: 'nominative' }],
    relationRef: { stageIndex: 0, relationIndex: 0 } };
  const left = nodes.find(node => node.data.id === 'left');
  const place = obstacles => ({ ...blank(0.15), plaques: [plaqueRecord(item,
    placeStagePlaques([item], nodes, obstacles, new Map(), measurePlaqueText).get(0), left)] });
  assert.deepEqual(checkMarkDistance(place(plaqueTreeObstacles(nodes))), [], 'an open tree gives a nearby pocket');
  const crowded = place([...plaqueTreeObstacles(nodes), box(left.x - 1200, left.y - 900, 2400, 1800)]);
  assert.deepEqual(subjects(checkMarkDistance(crowded)), ['plaque(0:0 case: nominative)@left']);
  assert.deepEqual(checkMarkDistance({ ...crowded, plaques: [{ ...crowded.plaques[0], joined: true }] }), [], 'a Case arrow joins it');
  const [far] = crowded.plaques, leader = { id: 'leader', kind: 'connector', halfWidth: 1, nodes: [], claims: ['0:0'],
    paths: [[{ x: far.rect.x - 10, y: far.rect.y }, { x: far.anchor.x, y: far.anchor.y }]] };
  assert.deepEqual(checkMarkDistance({ ...crowded, lines: [leader] }), [], 'a leader of its own claim ties it to syntax');

  // Catalog #2 as main placed it before PR #74: [case: nominative] above the Swedish CP at frame 31 (1440×900),
  // and [case: Nominative] above the German tree at frame 65.
  for (const [zoom, rect, anchor] of [[0.1472, box(-114.6, -657.2, 360, 129.2), { x: 65.4, y: 0 }],
    [0.0766, box(2721.2, -312.9, 360, 129.2), { x: 2975.7, y: 220 }]]) {
    const [found] = checkMarkDistance({ ...blank(zoom), plaques: [{ id: 'nominative', text: 'case: nominative', rect, anchor, claims: [] }] });
    assert(found.measure > 1.1, `${found.detail}`);
  }
  const role = { id: 'role(2:0 goal)@obj', kind: 'role', text: 'goal', boxes: [], nodes: [], claims: ['2:0'], reach: 100 };
  assert.deepEqual(subjects(checkMarkDistance({ ...blank(0.2), texts: [{ ...role, distance: 250 }] })), ['role(2:0 goal)@obj']);
  assert.deepEqual(checkMarkDistance({ ...blank(0.2), texts: [{ ...role, distance: 180 }] }), [],
    'one step outward (16 px past reach at this Fit) still reads as the witness\'s own label');
});

test('control: label-typography reports a closing mark starting a line, a lone remnant and an opening mark ending one', () => {
  const frame = lines => ({ ...blank(), texts: [text('n', 'category', box(0, 0, 10, 10), { lines })] });
  const kinds = lines => checkLabelTypography(frame(lines)).map(finding => finding.subtype).sort();
  // Catalog #1 as main wrapped it before PR #73.
  assert.deepEqual(kinds(['Coord[alternative', ']']), ['closing-start', 'fragment']);
  assert.deepEqual(kinds(['DP[demonstrative', ',third-person,', 'singular]']), ['closing-start']);
  assert.deepEqual(kinds(['C[relative,', 'operator-attractin', 'g]']), ['fragment']);
  assert.deepEqual(kinds(['Appl (', 'low, recipient-oriented)']), ['opening-end']);
  for (const accepted of [['Coord[alternative]'], ['Coord', '[alternative]'], ['AP ', '(subject-oriented ', 'depictive)']])
    assert.deepEqual(kinds(accepted), [], JSON.stringify(accepted));
});

test('control: clipped reports text under the Replay panel or past the canvas, when the screen chrome is known', () => {
  // The offline adapter carries the panel and canvas through the fitted camera: clean, until a word is pushed under the panel.
  const real = sample(), word = real.texts.find(item => item.kind === 'word'), { panel } = real.chrome;
  assert.deepEqual(checkClipped(real), []);
  const under = { ...word, boxes: [box(panel.x + 10, panel.y + 10, word.boxes[0].width, word.boxes[0].height)] };
  assert.deepEqual(checkClipped({ ...real, texts: real.texts.map(item => item === word ? under : item) })
    .map(found => [found.subtype, found.subject]), [['under-panel', word.id]]);
  const frame = { ...blank(), texts: [text('a', 'word', box(10, 10, 50, 20)), text('b', 'word', box(10, 190, 50, 20))],
    chrome: { canvas: box(0, 0, 400, 200), panel: box(0, 150, 400, 50) } };
  assert.deepEqual(checkClipped(frame).map(finding => [finding.subtype, finding.subject]),
    [['under-panel', 'b:word'], ['off-canvas', 'b:word']]);
  assert.deepEqual(checkClipped({ ...frame, chrome: undefined }), []);
});

test('control: parent-centring reports a parent off the midpoint of its outermost daughters', () => {
  const branch = (parent, child, from, to) => ({ id: `${parent}->${child}`, kind: 'branch', paths: [branchPoints(from, to)],
    halfWidth: 2, nodes: [parent, child], claims: [] });
  // The shape Francis rejected in a construction-kernel layout experiment (d56a1e0): in there-insertion
  // (spellout-v3 03, analysis 1) at frame 18, Num pinned at its grown position over "three" and "cats"
  // before N and P merge into the wider N.
  const num = { x: 5430.9, y: 1540 }, three = { x: 4938.8, y: 1760 }, cats = { x: 5463.8, y: 1760 };
  const pinned = { ...blank(0.1), lines: [branch('restrictedNum', 'three', num, three), branch('restrictedNum', 'cats', num, cats)] };
  assert.deepEqual(checkParentCentring(pinned).map(found => [found.subtype, found.subject, found.measure]), [['offset', 'restrictedNum', 22.96]]);
  const centred = { ...blank(0.1), lines: [branch('restrictedNum', 'three', { x: 5201.3, y: 1540 }, three),
    branch('restrictedNum', 'cats', { x: 5201.3, y: 1540 }, cats)] };
  assert.deepEqual(checkParentCentring(centred), []);
  const single = { ...blank(1), lines: [branch('p', 'a', { x: 10, y: 0 }, { x: 10, y: 220 }),
    { id: 'a:stem', kind: 'stem', paths: [[{ x: 10, y: 240 }, { x: 10, y: 285 }]], halfWidth: 1.5, nodes: ['a'], claims: [] }] };
  assert.deepEqual(checkParentCentring(single), [], 'one visible daughter: the parent stands over it; stems are not daughters');
  assert.deepEqual(checkParentCentring({ ...single, lines: [branch('p', 'a', { x: 11.5, y: 0 }, { x: 10, y: 220 })] })
    .map(found => found.measure), [1.5]);
});

test('control: branch-geometry reports a branch stretched over two rows and sisters on different rows', () => {
  const branch = (parent, child, from, to) => ({ id: `${parent}->${child}`, kind: 'branch', paths: [branchPoints(from, to)],
    halfWidth: 2, nodes: [parent, child], claims: [] });
  const rows = { ...blank(0.5), rowHeight: 220,
    lines: [branch('p', 'a', { x: 0, y: 0 }, { x: -100, y: 220 }), branch('p', 'b', { x: 0, y: 0 }, { x: 100, y: 220 })] };
  assert.deepEqual(checkBranchGeometry(rows), []);
  rows.lines.push({ id: 'b:stem', kind: 'stem', paths: [[{ x: 100, y: 240 }, { x: 100, y: 285 }]], halfWidth: 1.5, nodes: ['b'], claims: [] },
    { id: 'trajectory', kind: 'connector', paths: [[{ x: -100, y: 220 }, { x: 300, y: 900 }]], halfWidth: 2, nodes: ['a', 'z'], claims: [] });
  assert.deepEqual(checkBranchGeometry(rows), [], 'word stems and relation connectors are not syntax branches');
  rows.lines[1] = branch('p', 'b', { x: 0, y: 0 }, { x: 100, y: 440 });
  assert.deepEqual(checkBranchGeometry(rows).map(found => [found.subtype, found.subject, found.measure]),
    [['span', 'p->b', 110], ['sisters', 'p children', 110]]);
  assert.deepEqual(checkBranchGeometry({ ...rows, rowHeight: undefined }), [], 'frames without a known row are not tested');

  // Catalog #24 as rejected preview 3e4b4dc laid it out at frame 44 (1440×900): rows reserved for a parent not yet
  // inserted stretch C′→TP and T′→T, T′→VP over two rows beside one-row sisters (the C head, the subject).
  const at = { matrixClause: { x: 6597.2, y: 440 }, matrixTP: { x: 5795.6, y: 880 }, le: { x: 7398.8, y: 660 },
    subjectHigher: { x: 4717.5, y: 1100 }, matrixT: { x: 6161.3, y: 1320 }, matrixVP: { x: 6873.8, y: 1320 } };
  const goopy = { ...blank(0.1215), rowHeight: 220, lines: [['matrixClause', 'matrixTP'], ['matrixClause', 'le'],
    ['matrixTP', 'subjectHigher'], ['matrixTP', 'matrixT'], ['matrixTP', 'matrixVP']].map(([parent, child]) => branch(parent, child, at[parent], at[child])) };
  assert.deepEqual(checkBranchGeometry(goopy).map(found => [found.subtype, found.subject]), [['span', 'matrixClause->matrixTP'],
    ['span', 'matrixTP->matrixT'], ['span', 'matrixTP->matrixVP'], ['sisters', 'matrixClause children'], ['sisters', 'matrixTP children']]);

  // Production layout keeps every branch on one row; lowering one child a row is reported.
  const real = sample();
  assert.deepEqual(checkBranchGeometry(real), []);
  const lowered = real.lines.find(line => line.kind === 'branch');
  const stretched = { ...lowered, paths: [branchPoints(lowered.paths[0][0], { ...lowered.paths[0].at(-1), y: lowered.paths[0].at(-1).y + 220 })] };
  assert(checkBranchGeometry({ ...real, lines: real.lines.map(line => line === lowered ? stretched : line) })
    .some(found => found.subtype === 'span' && found.subject === lowered.id));
});

test('a fork whose daughters all wait for one later wrapper keeps one-row branches until the wrapper arrives', () => {
  // GPT-6.1 Sol pt-enclisis.B: VP0 = [V0 D0] waits for the clitic complex VH across stages, and at the first
  // moment of the last stage TP0 = [TH vA] waits for T′. Reserved rows drew those branches two rows long.
  const cases = [['clitic-wrapper-across-stages', 0, 'VP0', 'VH'], ['finite-wrapper-within-stage', 1, 'TP0', 'TI']];
  for (const [name, index, parent, wrapper] of cases) {
    const visual = prepareVisualRecord(recordOf(`replay-regressions/reserved-wrapper-fork.json#/cases/${index}`));
    const frames = layoutVisualFrames(visual, [VIEWPORTS[0]]);
    const waiting = frames.filter(frame => frame.lines.some(line => line.kind === 'branch' && line.nodes[0] === parent)
      && !frame.texts.some(text => text.nodes.includes(wrapper)));
    assert(waiting.length, `${name}: ${parent} is drawn before ${wrapper} exists`);
    assert.deepEqual(frames.flatMap(frame => checkBranchGeometry(frame).map(found => `${frame.frame} ${found.subject}`)), [], name);
  }
});

test('control: layout-width compares every viewport with the first, in Replay and the Canopy, and reports text that follows the window', () => {
  // verify:visual-offline audits the desktop sizes only; this covers the mobile comparison. The fixture is the
  // reference-canvas regression's (tests/plaqueLayoutJob.test.mjs).
  const visual = prepareVisualRecord(recordOf('replay-regressions/hi-correlative-landing-contour.json#'));
  assert.deepEqual(layoutWidthFindings(visual, VIEWPORTS), []);
  // The renderer measures text in the page, so a tree font sized by the window would reach layout through these
  // measures. Text 60% wider at mobile alone moves nodes beyond one translation, in Replay and the Canopy.
  const by = 1.6, wider = { ...TEXT_METRICS, measureCategoryText: text => TEXT_METRICS.measureCategoryText(text) * by,
    measureTreeInk: (text, style) => {
      const ink = TEXT_METRICS.measureTreeInk(text, style);
      return ink && { ...ink, width: ink.width * by, left: ink.left * by, right: ink.right * by };
    },
    measureTreeLabel: runs => {
      const bounds = TEXT_METRICS.measureTreeLabel(runs);
      return bounds && { ...bounds, x: bounds.x * by, width: bounds.width * by };
    } };
  const found = layoutWidthFindings(visual, VIEWPORTS, { metrics: viewport => viewport.name === 'mobile' ? wider : TEXT_METRICS });
  assert.deepEqual([...new Set(found.map(finding => `${finding.rule} ${finding.viewport}`))], ['layout-width desktop~mobile']);
  assert(found.some(finding => Number.isInteger(finding.frame)) && found.some(finding => finding.frame === 'canopy'), JSON.stringify(found));
  assert(found.every(finding => RULES.includes(finding.rule)), 'the discovery summary lists every reported rule');
});

test('TreeVisualizer classifies tree-first families through the shared list the frame layout fits with', () => {
  const source = readFileSync(new URL('../components/TreeVisualizer.tsx', import.meta.url), 'utf8');
  assert.match(source, /acceptedCompositionIsTreeFirst = isTreeFirstComposition\(/u);
  assert(TREE_FIRST_FAMILIES.size > 0);
  for (const family of TREE_FIRST_FAMILIES) assert(!source.includes(`'${family}'`), `${family} has one owner, replay/stageCamera.ts`);
});

/* Historical defects Francis caught by eye (catalog of 18 October 2026), laid
 * out at both desktop Fit sizes. Their remaining findings match the listed
 * exceptions exactly; fixed defects stay fixed, with their pre-fix geometry as
 * the controls above, and open ones stay flagged at the reviewed frames.
 * Catalog #5's index letters are checked by #75's checkOneLetterPerLabel. */

const RECORDS = [CATALOG, 'replay-regressions/es-wh-phase-edge-contour.json#'];
let catalog;
before(() => {
  catalog = corpus.records.filter(entry => RECORDS.some(prefix => entry.id.startsWith(prefix)))
    .flatMap(({ id, record }) => auditVisualRecord(id, record, { viewports: DESKTOP }).findings);
});

test('catalog: findings match their listed exceptions exactly', () => {
  assert.deepEqual(matchFindings(catalog, EXCEPTIONS.filter(exception => RECORDS.some(prefix => exception.record.startsWith(prefix)))),
    { unexpected: [], exceeded: [], stale: [] });
});

const CASES = [
  [1, `${CATALOG}/0/analyses/0`, 'b-or:category ["Coord[alternative","]"]', [], 'fixed by #73'],
  [2, `${CATALOG}/1/analyses/0`, 'plaque(1:3 case: nominative)@subject', [], 'fixed by #74'],
  [2, `${CATALOG}/2/analyses/0`, 'plaque(3:2 case: Nominative)@mSubject', [], 'fixed by #74'],
  [3, `${CATALOG}/3/analyses/0`, 'plaque(0:1 theta Theme)@stolen', [], 'fixed by the second look for remote plaques'],
  [4, `${CATALOG}/4/analyses/0`, 'connector(3:3)root-cp→subject-np plaque(3:2 clauseType: declarative)@declarative-c', [], 'fixed by #76'],
  [9, RECORDS[1], 'juan->juan::__leaf what1::__leaf:word', [], 'fixed by #79'],
  [24, `${CATALOG}/6/analyses/0`, 'matrixClause->matrixTP', [], 'preview 3e4b4dc rejected, main keeps one row']
];
for (const [number, record, subject, places, status] of CASES) test(`catalog #${number}: ${subject} (${status})`, () => {
  const found = catalog.filter(finding => finding.record === record && finding.subject === subject).map(finding => [finding.frame, finding.viewport]);
  if (!places.length) assert.deepEqual(found, []);
  else for (const place of places) assert(found.some(([frame, viewport]) => frame === place[0] && viewport === place[1]), JSON.stringify(place));
});

test('catalog #5: each index letter is painted once at its label (fixed by #75), and painting every claimed letter repeats it', () => {
  // Before #75, operator-variable binding and quantifier raising each painted the chain's letter: a faint j beside a bright j.
  const everyLetter = () => () => ({ draw: 'glyph', label: null, alsoFor: [] });
  for (const [analysis, label, frames] of [[1, 'objhigh', [23]], [0, 'subjhigh', [23, 24]]]) {
    const replay = prepareReplay({ ...structuredClone(recordOf(`${CATALOG}/5/analyses/${analysis}`)), includePlayback: true });
    assert.deepEqual(checkOneLetterPerLabel(replay), []);
    const repeated = checkOneLetterPerLabel(replay, everyLetter);
    for (const frame of frames) assert(repeated.some(violation => violation.frame === frame && violation.detail === `${label} shows j 2 times`),
      `${label} at frame ${frame}`);
  }
});
