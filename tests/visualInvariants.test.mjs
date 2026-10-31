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
  auditVisualRecord, branchPoints, layoutVisualFrames, layoutWidthFindings, markMotionFindings, pathPolylines, plaqueRecord, prepareVisualRecord,
  TEXT_METRICS, VIEWPORTS
} from './helpers/visualFrames.mjs';
import {
  checkBranchGeometry, checkClipped, checkDuplicatePlaques, checkGlyphOverlap, checkLabelTypography, checkLineClearance, checkMarkDistance,
  checkMarkMotion, checkParentCentring, RULES
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
  [VIEWPORTS[0]], { steps: [28] })[0];
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
  // Catalog #4 as main cut it before PR #76, at frame 39, now 33 (1440×900): the spoke stops on the corner of [clauseType: declarative].
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
  // Catalog #9 as main laid it out before #79, at frame 22, now 19 (1440×900): Qué hangs into Juan's branch.
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

  // Catalog #2 as main placed it before PR #74: [case: nominative] above the Swedish CP at frame 31, now 28 (1440×900),
  // and [case: Nominative] above the German tree at frame 65, now 56.
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

test('control: duplicate-plaque reports one node showing the same plaque for two claims', () => {
  // Sol h1-038 (29 October held-out batch) showed two Agent grids on higherVbar at
  // steps 37-38 (now 32-33): the stage-2 theta claim and the stage-4 chain claim restating it.
  const records = JSON.parse(readFileSync(new URL('./helpers/heldoutDefectRecords.json', import.meta.url), 'utf8'));
  const { sentence, inputTokens, derivationStages } = records['sol-h1-038-a1'];
  const frames = layoutVisualFrames(prepareVisualRecord({ sentence, inputTokens, derivationStages }), [VIEWPORTS[0]], { steps: [31, 32, 33] });
  const agents = frame => frame.plaques.filter(plaque => plaque.anchorNodeId === 'higherVbar' && plaque.text === 'theta Agent');
  // The earlier grid paints once, keeping its pocket, and carries the restatement's moment.
  assert.deepEqual(frames.map(frame => agents(frame).map(plaque => plaque.claims)), [[['1:2', '3:1']], [['1:2', '3:1']], [['1:2', '3:1']]]);
  assert.deepEqual(frames.flatMap(checkDuplicatePlaques), []);
  const frame = frames[1], agent = agents(frame);
  const again = (claims, face = agent[0].face) => ({ ...frame, plaques: [...frame.plaques, { ...agent[0], id: 'again', claims, face }] });
  assert.deepEqual(subjects(checkDuplicatePlaques(again(['3:1']))), [`${agent[0].id} again`]);
  assert.deepEqual(checkDuplicatePlaques(again(['3:1', '1:2'])), [], 'one claim set painted twice is not this rule');
  assert.deepEqual(checkDuplicatePlaques(again(['3:1'], JSON.stringify(['theta-grid', null, [{ label: 'Agent', value: '' }], [['Agent', 'k']]]))),
    [], 'a grid lettering another argument paints other content');
  assert.deepEqual(checkDuplicatePlaques(again(['3:1'], null)), [], 'a path plaque labels its own arrow');
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

test('control: mark-motion reports a plaque that leaves a pocket nothing new occupies, beside its still anchor', () => {
  // Reserves are pocket occupants (replay/relations/pocketHold.ts): allocation's boxes for what a frame paints.
  const word = (id, x, y) => text(id, 'word', box(x, y, 80, 40));
  const label = (id, x, y, width = 80, height = 40) => ({ ...box(x, y, width, height), blocksConnectors: true, connectorAttachment: `${id}:terminal` });
  const key = 'theta Theme';
  const plaque = (x, y, anchor = { x: 0, y: 140 }, extra = {}) => ({ id: 'plaque(0:0 theta Theme)@read', text: 'theta Theme', rect: box(x, y, 430, 126),
    radius: 14, claims: ['0:0'], anchor, key, ...extra });
  const still = [word('the', 900, 100), word('book', 1100, 100)];
  const frame = (number, extra) => ({ ...blank(0.2), frame: number, texts: [word('read', -40, 100), ...still], reserves: [], ...extra });
  const before = frame(29, { plaques: [plaque(-540, 55)] }), after = frame(30, { plaques: [plaque(110, 55)] });
  const found = (earlier, later) => checkMarkMotion(earlier, later).map(item => [item.rule, item.subtype, item.frame, item.subject, item.measure]);
  assert.deepEqual(found(before, after), [['mark-motion', 'plaque-teleport', '29>30', 'plaque(0:0 theta Theme)@read', 650]]);
  assert.deepEqual(checkMarkMotion(before, frame(30, { plaques: [plaque(-538, 55)] })), [], 'a shift within motionUnits');
  // The old pocket spans x -540..-110 and y 55..181; carrying keeps the plaque gap (24 units) from what the later frame newly paints.
  assert.deepEqual(checkMarkMotion(before, { ...after, reserves: [label('new', -90, 90)] }), [], 'a new word 20 units away');
  assert.equal(checkMarkMotion(before, { ...after, reserves: [label('new', -80, 90)] }).length, 1, 'a new word 30 units away');
  assert.equal(checkMarkMotion({ ...before, reserves: [label('old', -90, 90)] }, { ...after, reserves: [label('old', -90, 90)] }).length, 1,
    'a word already there is not new');
  assert.deepEqual(checkMarkMotion({ ...before, reserves: [label('moved', 900, 90)] }, { ...after, reserves: [label('moved', -90, 90)] }), [],
    'a word that moved into the pocket');
  // A pocket accepted at half the gap keeps it from syntax, and the full gap from trajectories and plaques.
  const half = { pocket: { ...box(-540, 55, 430, 126), syntaxGap: 12 } };
  const trajectory = { ...box(-90, 90, 10, 10), trajectory: true };
  assert.equal(checkMarkMotion(frame(29, { plaques: [plaque(-540, 55, undefined, half)] }), { ...after, reserves: [label('new', -90, 90)] }).length, 1);
  assert.deepEqual(checkMarkMotion(frame(29, { plaques: [plaque(-540, 55, undefined, half)] }), { ...after, reserves: [trajectory] }), []);
  // Its own Case arrow: a new label across the route it drew moves it; so does a route that starts or leaves a moved source.
  const curve = { source: { x: 300, y: 40 }, control1: { x: 310, y: 40 }, control2: { x: 330, y: 40 }, target: { x: 340, y: 40 } };
  const route = (far = { x: 900, y: 0 }) => ({ ...box(292, 32, 56, 16), curve, curvePadding: 8, owner: key,
    route: { key: 'case@93', far, source: 'assigner:terminal' } });
  const routed = { ...before, reserves: [route()] };
  assert.equal(checkMarkMotion(routed, { ...after, reserves: [route()] }).length, 1, 'its own unchanged route does not block it');
  assert.deepEqual(checkMarkMotion(routed, { ...after, reserves: [route(), label('across', 310, 30, 20, 20)] }), [], 'a new label across its route');
  assert.equal(checkMarkMotion(routed, { ...after, reserves: [route(), label('assigner', 310, 30, 20, 20)] }).length, 1,
    'the label its route leaves');
  assert.deepEqual(checkMarkMotion(routed, { ...after, reserves: [route({ x: 960, y: 0 })] }), [], 'its route leaves a moved source');
  assert.deepEqual(checkMarkMotion(before, { ...after, reserves: [route()] }), [], 'its route starts');
  // Its anchor moved against the tree.
  const tree = [word('read', 160, 100), ...still];
  assert.deepEqual(checkMarkMotion(before, { ...after, texts: tree, plaques: [plaque(310, 55, { x: 200, y: 140 })] }), []);
  // Across a stage boundary a common translation of the whole tree is the camera's
  // carry, not anchor motion; within a stage the camera holds still.
  const carried = { ...after, stage: 1, texts: [word('read', 960, 100), word('the', 1900, 100), word('book', 2100, 100)],
    plaques: [plaque(1110, 55, { x: 1000, y: 140 })] };
  assert.equal(checkMarkMotion({ ...before, stage: 0 }, carried).length, 1);
  assert.deepEqual(checkMarkMotion({ ...before, stage: 0 }, { ...carried, plaques: [plaque(460, 55, { x: 1000, y: 140 })] }), [],
    'carried with the tree');
  assert.deepEqual(checkMarkMotion({ ...before, stage: 1 }, carried), [], 'the same stage: the anchor itself moved');
  // A proximity plaque beyond its nearby reach returns within it once what the earlier frame had in the nearer pocket is gone.
  const remote = frame(29, { plaques: [plaque(-1500, 55)], reserves: [label('gone', 150, 80, 50, 40)] });
  assert.deepEqual(checkMarkMotion(remote, after), []);
  assert.equal(checkMarkMotion(remote, { ...after, reserves: [label('gone', 150, 80, 50, 40)] }).length, 1, 'what blocked it is still there');
  assert.equal(checkMarkMotion({ ...remote, plaques: [plaque(-1500, 55, undefined, { joined: true })] },
    { ...after, plaques: [plaque(110, 55, undefined, { joined: true })] }).length, 1, 'a plaque its own connector joins to syntax');
});

test('control: mark-motion judges a plaque that did not leave early as main does, and accepts an early leave only where a stage begins', () => {
  // Francis, 27 October 2026 (n3-04-yue-sfp, steps 12 to 13): a θ-grid kept a pocket above a noun until N′ was projected there.
  // The schedule now leaves such a pocket early where it can; where it cannot, the plaque moves as on main, and main's rule
  // excuses a move for what the later frame newly paints (coordinator's decision on PR #285, 29 October 2026).
  const word = (id, x, y) => text(id, 'word', box(x, y, 80, 40));
  const label = (id, x, y) => ({ ...box(x, y, 80, 40), blocksConnectors: true, connectorAttachment: `${id}:category` });
  const plaque = x => ({ id: 'plaque(0:0 theta Theme)@eat', text: 'theta Theme', rect: box(x, 55, 430, 126), radius: 14, claims: ['0:0'],
    anchor: { x: 0, y: 140 }, key: 'theta Theme' });
  const frame = (number, stage, x, reserves = []) => ({ ...blank(0.2), frame: number, stage, texts: [word('eat', -40, 100)], plaques: [plaque(x)], reserves });
  const projected = label('nBar', -300, 90);
  assert.deepEqual(checkMarkMotion(frame(12, 1, -540), frame(13, 1, 110, [projected])), [], 'the projection its stage laid out in advance, as on main');
  assert.deepEqual(checkMarkMotion(frame(12, 1, -540), frame(13, 1, 110)).map(found => [found.frame, found.measure]), [['12>13', 650]],
    'nothing new in its pocket, as on main');
  assert.deepEqual(checkMarkMotion(frame(10, 0, -540), frame(11, 1, 110, [projected])), [], 'syntax a new stage paints');
  assert.deepEqual(checkMarkMotion(frame(12, 1, -540), frame(13, 1, 110, [{ ...projected, plaqueShell: true, owner: 'other' }])), [],
    'another plaque');
  // Leaving at the stage's first frame for that later projection is not a jump.
  const ahead = [frame(12, 1, 110), frame(13, 1, 110, [projected])];
  assert.deepEqual(checkMarkMotion(frame(10, 0, -540), frame(11, 1, 110), undefined, undefined, ahead), []);
  assert.equal(checkMarkMotion(frame(10, 0, -540), frame(11, 1, 110), undefined, undefined, [frame(12, 1, 110)]).length, 1,
    'nothing later takes the pocket');
  const hidden = [{ ...ahead[0], plaques: [] }, ahead[1]];
  assert.equal(checkMarkMotion(frame(10, 0, -540), frame(11, 1, 110), undefined, undefined, hidden).length, 1,
    'the plaque is hidden before the projection');
  // Only where its stage begins: within the stage it keeps its pocket until it must move
  // (PR #285 review, 29 October 2026; the unfixed audit let this through).
  assert.deepEqual(checkMarkMotion(frame(11, 1, -540), frame(12, 1, 110), undefined, undefined, [ahead[1]]).map(found => [found.frame, found.measure]),
    [['11>12', 650]], 'leaving early within a stage');
});

test('control: mark-motion reports a plaque that leaves its pocket early where its stage begins and then moves again in that stage', () => {
  // PR #285 review, 29 October 2026 (reviewed-construction#/cases/2, frames 16 to 19): a θ-grid
  // took a farther pocket where stage 1 began, clear of a projection at frame 19, and returned
  // within reach at frame 19 once a word that stood in a nearer pocket had gone. Francis
  // accepted a farther pocket instead of a jump (27 October), not a farther pocket and a jump.
  const word = (id, x, y) => text(id, 'word', box(x, y, 80, 40));
  const label = (id, x, y) => ({ ...box(x, y, 80, 40), blocksConnectors: true, connectorAttachment: `${id}:category` });
  const plaque = x => ({ id: 'plaque(0:0 theta agent)@v', text: 'theta agent', rect: box(x, 55, 430, 126), radius: 14, claims: ['0:0'],
    anchor: { x: 0, y: 140 }, key: 'theta agent' });
  const frame = (number, stage, x, reserves = []) => ({ ...blank(0.2), frame: number, stage, texts: [word('v', -40, 100)], plaques: [plaque(x)], reserves });
  const nearer = label('w', 300, 90), projected = label('nBar', -300, 90);
  const frames = [frame(10, 0, -540), frame(11, 1, 600, [nearer]), frame(12, 1, 600, [nearer]), frame(13, 1, 110, [projected])];
  assert.deepEqual(markMotionFindings(frames).map(found => [found.frame, found.measure]), [['12>13', 490]]);
  // Each judged alone, the return within reach is no jump: the word in the nearer pocket has gone.
  assert.deepEqual(checkMarkMotion(frames[2], frames[3]), []);
  // A plaque that keeps the pocket it took through the stage is not reported.
  assert.deepEqual(markMotionFindings([...frames.slice(0, 3), frame(13, 1, 600, [projected])]), []);
});

test('control: mark-motion reports a plaque that leaves its pocket early where a stage begins and moves again where the next begins', () => {
  // PR #285 review, 29 October 2026 (reviewed-construction#/cases/2 at 9ef8615): a θ-grid took a
  // farther pocket where stage 1 began at frame 16, held it through stage 2 and moved again where
  // stage 3 began at frame 26, which the audit then excused as a return within reach. The early
  // pocket is held until the anchor moves or the plaque leaves, across stage boundaries too.
  const word = (id, x, y) => text(id, 'word', box(x, y, 80, 40));
  const label = (id, x, y) => ({ ...box(x, y, 80, 40), blocksConnectors: true, connectorAttachment: `${id}:category` });
  const plaque = x => ({ id: 'plaque(0:0 theta agent)@v', text: 'theta agent', rect: box(x, 55, 430, 126), radius: 14, claims: ['0:0'],
    anchor: { x: 0, y: 140 }, key: 'theta agent' });
  const frame = (number, stage, x, reserves = []) => ({ ...blank(0.2), frame: number, stage, texts: [word('v', -40, 100)], plaques: [plaque(x)], reserves });
  const nearer = label('w', 300, 90), projected = label('nBar', -300, 90);
  const frames = [frame(10, 0, -540), frame(11, 1, 600, [nearer]), frame(12, 1, 600, [nearer, projected]), frame(13, 2, 110, [projected])];
  assert.deepEqual(markMotionFindings(frames).map(found => [found.frame, found.measure]), [['12>13', 490]]);
  // Without the early move, the return where stage 2 begins is no jump.
  assert.deepEqual(markMotionFindings([frame(11, 1, 600, [nearer]), ...frames.slice(2)]), []);
  // Its anchor moving, or the plaque leaving, ends the hold.
  const moved = { ...frames[3], plaques: [{ ...plaque(270), anchor: { x: 200, y: 140 } }] };
  assert.deepEqual(markMotionFindings([...frames.slice(0, 3), moved]), []);
  const gone = { ...frames[2], frame: 13, stage: 2, plaques: [] };
  assert.deepEqual(markMotionFindings([...frames.slice(0, 3), gone, { ...frames[3], frame: 14 }]), []);
});

test('mark-motion: plaques keep their pockets where main moved them beside a still anchor with nothing new in the way', () => {
  // Main moved each of these at the transition named (desktop): a nearer pocket at a
  // stage boundary, a pocket blocked only later in the stage, a pocket left at a stage
  // boundary for a mark the stage reveals later.
  for (const [record, from] of [['showcase/scope-ellipsis-coordination.json#/cases/2/analyses/0', 38],
    ['replay-regressions/visual-human-catalog.json#/cases/3/analyses/0', 22], ['showcase/agreement-and-case.json#/cases/5', 18]]) {
    const frames = layoutVisualFrames(prepareVisualRecord(recordOf(record)), [VIEWPORTS[0]], { steps: [from, from + 1] });
    assert.deepEqual(markMotionFindings(frames).map(found => `${found.frame} ${found.subject}`), [], record);
  }
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

  // Catalog #24 as rejected preview 3e4b4dc laid it out at frame 44, now 35 (1440×900): rows reserved for a parent not yet
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
  for (const [analysis, label, frames] of [[1, 'objhigh', [20]], [0, 'subjhigh', [20, 21]]]) {
    const replay = prepareReplay({ ...structuredClone(recordOf(`${CATALOG}/5/analyses/${analysis}`)), includePlayback: true });
    assert.deepEqual(checkOneLetterPerLabel(replay), []);
    const repeated = checkOneLetterPerLabel(replay, everyLetter);
    for (const frame of frames) assert(repeated.some(violation => violation.frame === frame && violation.detail === `${label} shows j 2 times`),
      `${label} at frame ${frame}`);
  }
});
