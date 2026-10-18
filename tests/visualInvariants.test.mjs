import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import * as d3 from 'd3';
import { placeStagePlaques, plaqueTreeObstacles } from '../replay/relations/plaquePlacement.ts';
import { TREE_FIRST_FAMILIES } from '../scripts/replayFrameLayout.mjs';
import { formatFrames, frameList, matchFindings, proposeExceptions } from './helpers/findings.mjs';
import { measurePlaqueText } from './helpers/visualFontMetrics.mjs';
import { auditVisualRecord, layoutVisualFrames, pathPolylines, plaqueRecord, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';
import { checkClipped, checkGlyphOverlap, checkLabelTypography, checkLineClearance, checkMarkDistance } from './helpers/visualRules.mjs';
import { EXCEPTIONS } from './helpers/visualExceptions.mjs';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';

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

test('findings: an exception covers exact places within its bound; new, worse and stale places fail', () => {
  assert.deepEqual(frameList('3-5,9,canopy'), ['3', '4', '5', '9', 'canopy']);
  assert.equal(formatFrames([9, 3, 4, 5, 'canopy']), '3-5,9,canopy');
  const finding = (frame, viewport, measure) => ({ rule: 'line-clearance', subtype: 'branch-text', record: 'r', subject: 's', frame, viewport, measure });
  const found = [finding(3, 'desktop', 2), finding(4, 'desktop', 2.5)];
  const [listed] = proposeExceptions(found);
  assert.deepEqual(listed.at, { desktop: '3-4' });
  assert.equal(listed.max, 2.5);
  assert.deepEqual(matchFindings(found, [listed]), { unexpected: [], exceeded: [], stale: [] });
  const spread = matchFindings([...found, finding(5, 'desktop', 1), finding(3, 'mobile', 1)], [listed]);
  assert.deepEqual(spread.unexpected.map(item => [item.frame, item.viewport]), [[5, 'desktop'], [3, 'mobile']]);
  assert.equal(matchFindings([finding(3, 'desktop', 2), finding(4, 'desktop', 3)], [listed]).exceeded.length, 1);
  assert.deepEqual(matchFindings([found[0]], [listed]).stale.map(item => [item.viewport, item.frame]), [['desktop', '4']]);
  assert.throws(() => matchFindings(found, [listed, listed]), /Duplicate exception/);
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
  // A line past a rectangle's corner clears its rounded shell.
  const corner = { ...frame, zoom: 1, lines: [{ ...spoke, halfWidth: 0.5, paths: [[{ x: 370, y: 114 }, { x: 404, y: 80 }]] }] };
  assert.deepEqual(checkLineClearance(corner), []);
  assert.equal(checkLineClearance({ ...corner, plaques: [{ ...plaque, radius: 0 }] }).length, 1);
  // A lane is clipped only at its stems: through tree text it is reported, through its own witnesses' text it is not.
  frame.texts = [text('x', 'category', box(150, 100, 80, 40)), text('a', 'category', box(-40, 100, 80, 40))];
  assert.deepEqual(subjects(checkLineClearance(frame)), ['spoke x:category']);

  const branches = { ...blank(), lines: [{ id: 'p->c', kind: 'branch', paths: [[{ x: 0, y: 0 }, { x: 0, y: 300 }]], halfWidth: 2,
    nodes: ['p', 'c'], claims: [] }], texts: [text('w', 'word', box(-50, 100, 100, 40)), text('c', 'category', box(-20, 260, 40, 40))] };
  assert.deepEqual(subjects(checkLineClearance(branches)), ['p->c w:word'], 'a branch meets its own child\'s label');
  branches.texts[0] = text('w', 'word', box(-100, 100, 100.5, 40));
  assert.deepEqual(checkLineClearance(branches), [], 'grazing the edge of a glyph box is not a crossing');

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
  const frame = { ...blank(), texts: [text('a', 'word', box(10, 10, 50, 20)), text('b', 'word', box(10, 190, 50, 20))],
    chrome: { canvas: box(0, 0, 400, 200), panel: box(0, 150, 400, 50) } };
  assert.deepEqual(checkClipped(frame).map(finding => [finding.subtype, finding.subject]),
    [['under-panel', 'b:word'], ['off-canvas', 'b:word']]);
  assert.deepEqual(checkClipped({ ...frame, chrome: undefined }), []);
});

test('the frame layout keeps TreeVisualizer\'s tree-first families', () => {
  const source = readFileSync(new URL('../components/TreeVisualizer.tsx', import.meta.url), 'utf8');
  const block = /acceptedCompositionIsTreeFirst = [\s\S]*?\);/.exec(source)[0];
  assert.deepEqual([...block.matchAll(/familyId === '([^']+)'/g)].map(match => match[1]).sort(), [...TREE_FIRST_FAMILIES].sort());
});

/* Historical defects Francis caught by eye (catalog of 18 October 2026), laid
 * out at both desktop Fit sizes. Their remaining findings match the listed
 * exceptions exactly; fixed defects stay fixed, and open ones stay flagged at
 * the reviewed frames. Index letters (#5) belong to checkOneLetterPerLabel. */

let catalog;
before(() => {
  catalog = corpus.records.filter(entry => entry.id.startsWith(CATALOG))
    .flatMap(({ id, record }) => auditVisualRecord(id, record, { viewports: DESKTOP }).findings);
});

test('catalog: findings match their listed exceptions exactly', () => {
  assert.deepEqual(matchFindings(catalog, EXCEPTIONS.filter(exception => exception.record.startsWith(CATALOG))),
    { unexpected: [], exceeded: [], stale: [] });
});

const at = (id, subject) => catalog.filter(finding => finding.record === `${CATALOG}/${id}` && finding.subject === subject);
const CASES = [
  [1, '0/analyses/0', 'b-or:category ["Coord[alternative","]"]', [], 'fixed by PR #73'],
  [2, '1/analyses/0', 'plaque(1:3 case: nominative)@subject', [], 'fixed by PR #74'],
  [2, '2/analyses/0', 'plaque(3:2 case: Nominative)@mSubject', [], 'fixed by PR #74'],
  [3, '3/analyses/0', 'plaque(0:1 theta Theme)@stolen', [[20, 'desktop'], [20, 'desktop-large']], 'open'],
  [4, '4/analyses/0', 'connector(3:3)root-cp→subject-np plaque(3:2 clauseType: declarative)@declarative-c', [[39, 'desktop']],
    'PR #76; at 1440 px, not 2560 px'],
  [9, '6/analyses/0', 'juan->juan::__leaf what1::__leaf:word',
    Array.from({ length: 11 }, (_, index) => [[20 + index, 'desktop'], [20 + index, 'desktop-large']]).flat(), 'open']
];
for (const [number, id, subject, places, status] of CASES) test(`catalog #${number}: ${subject} (${status})`, () => {
  const found = at(id, subject).map(finding => [finding.frame, finding.viewport]);
  if (!places.length) assert.deepEqual(found, []);
  else for (const place of places) assert(found.some(([frame, viewport]) => frame === place[0] && viewport === place[1]), JSON.stringify(place));
  if (number === 4) assert(found.every(([, viewport]) => viewport === 'desktop'));
});
