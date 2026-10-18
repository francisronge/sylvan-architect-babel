import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as d3 from 'd3';
import { placeStagePlaques, plaqueTreeObstacles } from '../replay/relations/plaquePlacement.ts';
import { auditVisualRecord } from './helpers/visualAudit.mjs';
import { measurePlaqueText } from './helpers/visualFontMetrics.mjs';
import { layoutReplayVisualFrames, pathPieces, plaqueRecord, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';
import {
  checkDuplicateGlyphs, checkGlyphOverlap, checkLabelTypography, checkLineClearance, checkMarkDistance, RULES, THRESHOLDS
} from './helpers/visualInvariants.mjs';
import { KNOWN_VISUAL_DEFECTS } from './helpers/visualKnownDefects.mjs';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';

const corpus = loadFixtureAnalyses();
const recordOf = id => corpus.records.find(entry => entry.id === id).record;
const CATALOG = 'replay-regressions/visual-human-catalog.json#/cases';
// A clean frame with a plaque and 52 labels, for controlled breaks of production geometry.
const SAMPLE = 'replay-regressions/workspace-historical-continuity.json#/cases/4';
const frameOf = (id, frame, viewport = 'desktop') => layoutReplayVisualFrames(prepareVisualRecord(recordOf(id)),
  VIEWPORTS.filter(candidate => candidate.name === viewport), { steps: [frame] })[0];
const blank = (zoom = 1) => ({ view: 'replay', frame: 1, viewport: 'desktop', zoom, labels: [], stems: [], branches: [], plaques: [], roles: [], connectors: [] });
const box = (x, y, width, height) => ({ x, y, width, height });
const label = (node, kind, rect, extra = {}) => ({ id: `${node}:${kind}`, node, kind, text: node, boxes: [rect], ink: rect, cell: rect,
  halo: kind === 'word' ? 4 : 5, lines: [node], indices: [], ...extra });
const subjects = (violations, rule) => violations.filter(violation => violation.rule === rule).map(violation => violation.subject);

/* Controls: each rule reports the exact fault it forbids, in a synthetic frame
 * and in production geometry, and accepts what the design allows. */

test('control: glyph-overlap reports text or plaques painted over each other, beyond a two-pixel outline sliver', () => {
  const frame = { ...blank(), labels: [label('a', 'category', box(0, 0, 100, 40)), label('b', 'category', box(102, 0, 60, 40)),
    label('a', 'word', box(20, 30, 60, 50))] };
  assert.deepEqual(subjects(checkGlyphOverlap(frame), 'glyph-overlap'), ['a:category b:category'],
    'b sits 3 px inside a\'s outline; a node\'s own category and word never pair');
  frame.labels[1] = label('b', 'category', box(104, 0, 60, 40));
  assert.deepEqual(checkGlyphOverlap(frame), [], 'one pixel of shared outline is tolerated');
  frame.plaques.push({ id: 'plaque(0:0 case: nominative)@a', text: 'case: nominative', rect: box(30, 10, 200, 60) });
  assert.deepEqual(subjects(checkGlyphOverlap(frame), 'glyph-overlap').sort(),
    ['a:category plaque(0:0 case: nominative)@a', 'a:word plaque(0:0 case: nominative)@a', 'b:category plaque(0:0 case: nominative)@a']);

  // Production layout: clean, until a plaque is moved onto tree text.
  const real = frameOf(SAMPLE, 33);
  assert.deepEqual(checkGlyphOverlap(real), []);
  const target = real.labels.find(candidate => candidate.kind === 'category');
  const moved = { ...real, plaques: real.plaques.map((plaque, index) => index ? plaque : { ...plaque, rect: { ...plaque.rect,
    x: target.ink.x, y: target.ink.y } }) };
  assert(subjects(checkGlyphOverlap(moved), 'glyph-overlap').some(subject => subject.includes(target.id)
    && subject.includes(real.plaques[0].id)));
});

test('control: line-clearance reports a spoke cut at a plaque, a lane through text and a branch through another node\'s word', () => {
  // A direct spoke cut exactly at a visible plaque, as main's routing cuts it: its round cap touches the outline.
  const plaque = { id: 'plaque(1:0 tense: past)@t', text: 'tense: past', rect: box(400, 80, 200, 80) };
  const scale = 5, zoom = 0.15;
  const connector = { id: 'connector(1:1)a→b', relation: '1:1', route: 'direct', witnesses: ['a', 'b'], own: ['a', 'b'], itemIndex: 0,
    pieces: pathPieces('M 0 120 L 400 120 M 600 120 L 1000 120'), halfWidth: 1.5 * scale / 2 };
  const frame = { ...blank(zoom), plaques: [plaque], connectors: [connector] };
  assert.deepEqual(subjects(checkLineClearance(frame), 'line-clearance'), ['connector(1:1)a→b plaque(1:0 tense: past)@t']);
  // Stopping six marker units short (PR #76's gap) clears the outline by more than a pixel.
  connector.pieces = pathPieces(`M 0 120 L ${400 - 6 * scale} 120 M ${600 + 6 * scale} 120 L 1000 120`);
  assert.deepEqual(checkLineClearance(frame), []);
  // A lane is clipped only at its stems; through tree text it is reported, through its own witnesses' text it is not.
  frame.labels = [label('x', 'category', box(150, 100, 80, 40)), label('a', 'category', box(-40, 100, 80, 40))];
  assert.deepEqual(subjects(checkLineClearance(frame), 'line-clearance'), ['connector(1:1)a→b x:category']);

  const branches = { ...blank(), branches: [{ id: 'p->c', parent: 'p', child: 'c', points: [{ x: 0, y: 0 }, { x: 0, y: 300 }] }],
    labels: [label('w', 'word', box(-50, 100, 100, 40)), label('c', 'category', box(-20, 260, 40, 40))] };
  assert.deepEqual(subjects(checkLineClearance(branches), 'line-clearance'), ['p->c w:word'], 'a branch meets its own child\'s label');
  branches.labels[0] = label('w', 'word', box(-100, 100, 100.5, 40));
  assert.deepEqual(checkLineClearance(branches), [], 'grazing the edge of a glyph box is not a crossing');

  // Production layout: moving a word onto another node's branch is reported.
  const real = frameOf(SAMPLE, 33);
  assert.deepEqual(checkLineClearance(real), []);
  const branch = real.branches.find(candidate => Math.abs(candidate.points[0].x - candidate.points.at(-1).x) > 100);
  const word = real.labels.find(candidate => candidate.kind === 'word' && candidate.node !== branch.parent && candidate.node !== branch.child);
  const middle = branch.points[Math.floor(branch.points.length / 2)];
  const shifted = { ...word, boxes: [box(middle.x - word.ink.width / 2, middle.y - word.ink.height / 2, word.ink.width, word.ink.height)] };
  assert(subjects(checkLineClearance({ ...real, labels: real.labels.map(candidate => candidate === word ? shifted : candidate) }),
    'line-clearance').includes(`${branch.id} ${word.id}`));
});

test('control: mark-distance reports a plaque the allocator could not keep near its anchor', () => {
  const nodes = d3.tree().nodeSize([600, 300])(d3.hierarchy({ id: 'root', label: 'XP', children: [
    { id: 'left', label: 'X', word: 'first' }, { id: 'right', label: 'Y', word: 'second' }] })).descendants();
  const item = { kind: 'node-plaque', plaqueStyle: 'feature', anchorNodeIds: ['left'], rows: [{ label: 'case', value: 'nominative' }],
    relationRef: { stageIndex: 0, relationIndex: 0 } };
  const left = nodes.find(node => node.data.id === 'left');
  const place = obstacles => {
    const placed = placeStagePlaques([item], nodes, obstacles, new Map(), measurePlaqueText).get(0);
    return { ...blank(0.15), plaques: [plaqueRecord(item, placed, left)] };
  };
  assert.deepEqual(checkMarkDistance(place(plaqueTreeObstacles(nodes))), [], 'an open tree gives a nearby pocket');
  // Occupy every nearby pocket; the production allocator then takes the nearest clear pocket beyond them.
  const crowded = place([...plaqueTreeObstacles(nodes), box(left.x - 1200, left.y - 900, 2400, 1800)]);
  assert(crowded.plaques[0].distance > crowded.plaques[0].reach * (1 + THRESHOLDS.reachMargin));
  assert.deepEqual(subjects(checkMarkDistance(crowded), 'mark-distance'), ['plaque(0:0 case: nominative)@left']);
  // A Case arrow or collector joins its plaque to syntax, so distance alone is not a fault.
  assert.deepEqual(checkMarkDistance({ ...crowded, plaques: [{ ...crowded.plaques[0], connector: true }] }), []);

  const role = { id: 'role(2:0 goal)@obj', witness: 'obj', text: 'goal', reach: 100 };
  assert.deepEqual(subjects(checkMarkDistance({ ...blank(0.2), roles: [{ ...role, distance: 250 }] }), 'mark-distance'), ['role(2:0 goal)@obj']);
  assert.deepEqual(checkMarkDistance({ ...blank(0.2), roles: [{ ...role, distance: 180 }] }), [],
    'one step outward (16 px past reach at this Fit) still reads as the witness\'s own label');
});

test('control: duplicate-glyph reports one letter painted twice at one occurrence, not two chains\' letters', () => {
  const census = [{ frame: 23, glyphs: [
    { label: 'objhigh', letter: 'j', painter: 'operator-variable' }, { label: 'objhigh', letter: 'j', painter: 'qr' },
    { label: 'objhigh', letter: 'i', painter: 'identity' }, { label: 'obj', letter: 'j', painter: 'qr' }] }];
  assert.deepEqual(checkDuplicateGlyphs(census).map(violation => [violation.frame, violation.subject, violation.detail]),
    [[23, 'objhigh j', 'index j is painted 2 times at objhigh (operator-variable+qr)']]);
});

test('control: label-typography reports a wrapped line that starts with a closing mark or is a lone fragment', () => {
  const frame = lines => ({ ...blank(), labels: [label('n', 'category', box(0, 0, 10, 10), { lines })] });
  assert.deepEqual(checkLabelTypography(frame(['Coord[alternative', ']'])).map(violation => violation.detail),
    ['["Coord[alternative","]"]: line 2 starts with "]"; line 2 is the fragment "]"']);
  assert.equal(checkLabelTypography(frame(['DP[demonstrative', ',third-person,', 'singular]'])).length, 1);
  assert.equal(checkLabelTypography(frame(['C[relative,', 'operator-attractin', 'g]'])).length, 1);
  for (const accepted of [['Coord[alternative]'], ['C[alternative ', 'question]'], ['AP ', '(subject-oriented ', 'depictive)']])
    assert.deepEqual(checkLabelTypography(frame(accepted)), [], JSON.stringify(accepted));
});

/* The sweep: every rule on every Replay frame (three Fit sizes) and the Canopy
 * of every committed analysis. Faults that remain on main are listed in
 * tests/helpers/visualKnownDefects.mjs with their reason; a new fault fails, and
 * so does a listed one that no longer occurs. */

let sweep;
before(() => {
  sweep = new Map(corpus.records.map(({ id, record }) => {
    try { return [id, auditVisualRecord(record)]; } catch (error) { return [id, { error }]; }
  }));
});

test('the visual sweep lays out every committed analysis with derivationStages', () => {
  assert.deepEqual([...sweep].filter(([, result]) => result.error).map(([id, result]) => `${id}: ${result.error.message}`), []);
  assert(sweep.size > 130 && [...sweep.values()].reduce((count, result) => count + result.frames, 0) > 18000);
  for (const [, id, rule] of KNOWN_VISUAL_DEFECTS) {
    assert(sweep.has(id), `listed analysis ${id} exists`);
    assert(RULES.includes(rule), rule);
  }
});

for (const rule of RULES) test(`sweep: ${rule} holds on every committed analysis, apart from listed defects`, () => {
  const expected = new Set(KNOWN_VISUAL_DEFECTS.filter(entry => entry[2] === rule).flatMap(([, id, , listed]) => listed.map(subject => `${id} | ${subject}`)));
  const found = new Map();
  for (const [id, result] of sweep) for (const violation of result.violations ?? []) {
    if (violation.rule !== rule) continue;
    const key = `${id} | ${violation.subject}`;
    if (!found.has(key)) found.set(key, `${key}: frame ${violation.frame} [${violation.viewports.join(', ')}] ${violation.detail}`);
  }
  assert.deepEqual([...found].filter(([key]) => !expected.has(key)).map(([, text]) => text), [], 'new violations');
  assert.deepEqual([...expected].filter(key => !found.has(key)), [], 'listed defects that no longer occur; remove them');
});

/* Historical defects Francis caught by eye (catalog of 18 October 2026): each
 * rule flags its defect at the reviewed frames on main. When a fix removes its
 * listed entry, the same record must stay clean. */

const CASES = [
  { catalog: 1, id: `${CATALOG}/0/analyses/0`, rule: 'label-typography', subject: 'b-or:category ["Coord[alternative","]"]', frames: ['canopy', 45] },
  { catalog: 2, id: `${CATALOG}/1/analyses/0`, rule: 'mark-distance', subject: 'plaque(1:3 case: nominative)@subject', frames: [31] },
  { catalog: 2, id: `${CATALOG}/2/analyses/0`, rule: 'mark-distance', subject: 'plaque(3:2 case: Nominative)@mSubject', frames: [65] },
  { catalog: 3, id: `${CATALOG}/3/analyses/0`, rule: 'mark-distance', subject: 'plaque(0:1 theta Theme)@stolen', frames: [20] },
  { catalog: 4, id: `${CATALOG}/4/analyses/0`, rule: 'line-clearance', frames: [39], only: ['desktop'],
    subject: 'connector(3:3)root-cp→subject-np plaque(3:2 clauseType: declarative)@declarative-c' },
  { catalog: 5, id: `${CATALOG}/5/analyses/1`, rule: 'duplicate-glyph', subject: 'objhigh j', frames: [23] },
  { catalog: 5, id: `${CATALOG}/5/analyses/0`, rule: 'duplicate-glyph', subject: 'subjhigh j', frames: [23, 24] },
  { catalog: 9, id: `${CATALOG}/6/analyses/0`, rule: 'line-clearance', subject: 'juan->juan::__leaf what1::__leaf:word',
    frames: [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30] }
];

for (const { catalog, id, rule, subject, frames, only } of CASES) {
  const known = KNOWN_VISUAL_DEFECTS.find(([, entry, entryRule, listed]) => entry === id && entryRule === rule && listed.includes(subject));
  test(`catalog #${catalog}: ${rule} ${known ? `flags ${subject} at frames ${frames.join(', ')} (${known[0].split(':')[0]})`
    : `keeps ${subject} fixed`}`, () => {
    const hits = (sweep.get(id).violations ?? []).filter(violation => violation.rule === rule && violation.subject === subject);
    if (!known) { assert.deepEqual(hits, []); return; }
    for (const frame of frames) assert(hits.some(violation => violation.frame === frame), `frame ${frame}`);
    // Size-dependent faults: present at the listed Fit sizes, absent at the others.
    if (only) for (const hit of hits) assert.deepEqual(hit.viewports, only);
  });
}
