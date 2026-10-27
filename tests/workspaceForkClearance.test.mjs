import test from 'node:test';
import assert from 'node:assert/strict';
import * as d3 from 'd3';
import { prepareWorkspaceLifetimeContours, WorkspaceContourClearanceError } from '../replay/workspaceLifetimeContours.ts';
import { currentForkBranchesClear, forkWideningCannotClear } from '../replay/workspaceForkClearance.ts';
import { rigidPoseGraph } from '../replay/workspacePoseGraph.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { TREE_ROW_HEIGHT } from '../replay/treeSpacing.ts';
import { categoryTextLayout } from '../replay/categoryTextLayout.ts';
import { layoutCanopyVisualFrame, layoutVisualFrames, prepareVisualRecord, TEXT_METRICS, VIEWPORTS } from './helpers/visualFrames.mjs';
import { checkBranchGeometry } from './helpers/visualRules.mjs';

const atom = id => ({ id, label: id });
const fork = (id, ...children) => ({ id, label: 'IP', children });
const ids = node => [node.id, ...(node.children ?? []).flatMap(ids)];
const step = canvas => ({ replayCanvasData: canvas, replayVisibleNodeIds: ids(canvas), replayKind: 'micro', operation: 'LexicalSelect', targetNodeId: canvas.id, replayFrameIndex: 0 });
const tall = { x: -190, y: -168, width: 380, height: 189 };
function setup(steps, tallId) {
  const labels = new Map(steps.map(s => [s.replayCanvasData, new Map([[tallId, [{ kind: 'category' }]]]) ]));
  const compose = prepareWorkspaceLifetimeContours(steps, undefined, undefined, labels, () => tall);
  const initial = compose(), preferred = new Map();
  for (const frame of initial) for (const part of frame.nodes.values())
    preferred.set(part.incarnation, new Map([...part.members].map(([id, p]) => [id, { ...p }])));
  return { compose, initial, preferred };
}
const clear = shape => currentForkBranchesClear({ x: 0, y: 0 }, shape.children.map(child => ({ point: shape.members.get(child.id), obstacles: child.obstacles })));

for (const sign of [1, -1]) test(`fork clearance uses the cubic, including mirrored geometry (${sign})`, () => {
  const children = [{ point: { x: -150 * sign, y: 212 }, obstacles: [] },
    { point: { x: 150 * sign, y: 212 }, obstacles: [tall] }];
  assert.equal(currentForkBranchesClear({ x: 0, y: 0 }, children), false);
  children[0].point.x *= 2; children[1].point.x *= 2;
  assert.equal(currentForkBranchesClear({ x: 0, y: 0 }, children), true);
});

test('clear sister labels still require room for their incoming branches', () => {
  const canvas = fork('p', atom('V'), atom('I')), { compose, initial, preferred } = setup([step(canvas)], 'I');
  const part = initial[0].nodes.get('p'), points = preferred.get(part.incarnation);
  points.set('V', { x: -150, y: 212 }); points.set('I', { x: 150, y: 212 });
  const unsafe = { ...part, members: points };
  assert.equal(clear(unsafe), false);
  const frame = compose(undefined, { inheritCurrentSlots: true, preferred })[0], fixed = frame.nodes.get('p');
  assert.equal(clear(fixed), true);
  assert.ok(fixed.members.get('I').x - fixed.members.get('V').x > 300);
  assert.ok(fixed.members.get('I').x - fixed.members.get('V').x < 400);
  assert.equal(fixed.members.get('I').y, 212);
  for (const id of ['V', 'I']) assert.equal(frame.nodes.get(id), initial[0].nodes.get(id));
  assert.throws(() => compose(new Map([[part.incarnation, points]]), { inheritCurrentSlots: true, preferred }), /Selected fork branches cross child ink/);
});

test('branch clearance preserves a previously clear preferred fork exactly', () => {
  const canvas = fork('p', atom('V'), atom('I')), { compose, initial, preferred } = setup([step(canvas)], 'I');
  const part = initial[0].nodes.get('p'), points = preferred.get(part.incarnation);
  points.set('V', { x: -250, y: 212 }); points.set('I', { x: 250, y: 212 });
  const fixed = compose(undefined, { inheritCurrentSlots: true, preferred })[0].nodes.get('p');
  assert.deepEqual(fixed.members.get('V'), points.get('V')); assert.deepEqual(fixed.members.get('I'), points.get('I'));
});

test('branch clearance cannot release two locked bystanders', () => {
  const a = atom('A'), b = atom('B'), canvases = [fork('p', a, b), fork('p', a, atom('I'), b)];
  const { compose, initial, preferred } = setup(canvases.map(step), 'I');
  for (const frame of initial) {
    const points = preferred.get(frame.nodes.get('p').incarnation);
    points.set('A', { x: -230, y: 212 }); points.set('B', { x: 230, y: 212 });
    if (frame.nodes.has('I')) points.set('I', { x: 0, y: 212 });
  }
  assert.throws(() => compose(undefined, { inheritCurrentSlots: true, preferred }), error =>
    /Locked current fork branches cross child ink/.test(error.message) && !(error instanceof WorkspaceContourClearanceError));
});

for (const tallId of ['A', 'B']) test(`later locked branch clearance is reserved before the fork appears (${tallId})`, () => {
  const before = fork('p', atom('A'), atom('B'));
  const after = fork('p', ...before.children.map(node => node.id === tallId ? { ...node, label: 'changed category' } : node));
  const steps = [step(before), { ...step(after), replayKind: 'relation', operation: 'Category update' }, step(structuredClone(after))];
  const labels = new Map(steps.map((s, index) => [s.replayCanvasData, new Map(index ? [[tallId, [{ kind: 'category' }]]] : [])]));
  const compose = prepareWorkspaceLifetimeContours(steps, undefined, undefined, labels, () => tall);
  const initial = compose(), preferred = new Map();
  for (const frame of initial) for (const part of frame.nodes.values())
    preferred.set(part.incarnation, new Map([...part.members].map(([id, p]) => [id, { ...p }])));
  const safePreferred = new Map([...preferred].map(([id, points]) => [id, new Map(points)]));
  for (const frame of initial) {
    const points = safePreferred.get(frame.nodes.get('p').incarnation);
    points.set('A', { x: -250, y: 212 }); points.set('B', { x: 250, y: 212 });
  }
  const baseline = compose(undefined, { inheritCurrentSlots: true, preferred: safePreferred });
  compose.retainBaseline(baseline);
  for (const frame of initial) {
    const points = preferred.get(frame.nodes.get('p').incarnation);
    points.set('A', { x: -150, y: 212 }); points.set('B', { x: 150, y: 212 });
  }
  let request;
  assert.throws(() => compose(undefined, { inheritCurrentSlots: true, preferred, baseline }), error => {
    if (!(error instanceof WorkspaceContourClearanceError)) return false;
    request = error.preference; return true;
  });
  assert.equal(request.incarnation, initial[0].nodes.get('p').incarnation);
  assert.ok(request.increase > 0 && request.increase < 100);
  assert.equal(request.realizedGap, 300);
  const revised = new Map(preferred), points = new Map(preferred.get(request.incarnation));
  for (const [index, id] of ['A', 'B'].entries()) {
    const shift = request.side === 'both' ? (index < request.split ? -.5 : .5)
      : request.side === 'left' ? (index < request.split ? -1 : 0) : (index < request.split ? 0 : 1);
    points.set(id, { ...points.get(id), x: points.get(id).x + shift * request.increase });
  }
  revised.set(request.incarnation, points);
  const frames = compose(undefined, { inheritCurrentSlots: true, preferred: revised, baseline });
  const fresh = prepareWorkspaceLifetimeContours(steps, undefined, undefined, labels, () => tall)(undefined,
    { inheritCurrentSlots: true, preferred: revised });
  assert.deepEqual(frames, fresh);
  for (const frame of frames) assert.equal(clear(frame.nodes.get('p')), true);
  for (const id of ['A', 'B']) assert.deepEqual(frames[0].nodes.get('p').members.get(id), frames[1].nodes.get('p').members.get(id));
  assert.equal(frames[1].nodes.get('p'), frames[2].nodes.get('p'));
  assert.equal(rigidPoseGraph(frames).conflicts.length, 0);
  assert.deepEqual(preferred.get(request.incarnation).get('A'), { x: -150, y: 212 });
});

test('a widened current fork preserves its sole unchanged bystander world slot', () => {
  const right = atom('I'), before = fork('p', atom('V'), right);
  const after = { id: 'workspace', label: 'Workspace', replayOrigin: { kind: 'workspace' },
    children: [fork('p', { id: 'V', label: 'V[trace]' }, right), atom('landing')] };
  const next = step(after); next.replayKind = 'relation'; next.replayRelationIdentity = { stageIndex: 1, relationIndex: 0 };
  next.replayRelationLinks = [{ authoredRelationKey: '1:0', renderFamily: 'trajectory', priorSourceNodeId: 'V', witnessNodeId: 'V', targetNodeId: 'landing' }];
  const { compose, initial, preferred } = setup([step(before), next], 'I');
  initial.forEach((frame, index) => {
    const points = preferred.get(frame.nodes.get('p').incarnation), halfGap = index ? 150 : 250;
    points.set('V', { x: -halfGap, y: 212 }); points.set('I', { x: halfGap, y: 212 });
  });
  const frames = compose(undefined, { inheritCurrentSlots: true, preferred }), graph = rigidPoseGraph(frames);
  assert.equal(graph.conflicts.length, 0);
  assert.ok(graph.constraints.some(item => item.id === 'I'));
  assert.equal(frames[0].nodes.get('I'), frames[1].nodes.get('I'));
  assert.equal(clear(frames[1].nodes.get('p')), true);
  const roots = [0, 1].map(index => graph.union.find(graph.variables[index].get('p')));
  assert.equal(roots[0].group, roots[1].group);
  assert.ok(Math.abs(roots[0].offset.x + frames[0].nodes.get('p').members.get('I').x
    - roots[1].offset.x - frames[1].nodes.get('p').members.get('I').x) < 1e-6);
});

test('one repaired contour remains identical through its entire current lifetime', () => {
  const canvas = fork('p', atom('V'), atom('I')), next = structuredClone(canvas);
  const { compose, initial, preferred } = setup([step(canvas), step(next)], 'I');
  const points = preferred.get(initial[0].nodes.get('p').incarnation);
  points.set('V', { x: -150, y: 212 }); points.set('I', { x: 150, y: 212 });
  const frames = compose(undefined, { inheritCurrentSlots: true, preferred });
  assert.equal(frames[0].nodes.get('p'), frames[1].nodes.get('p'));
  assert.equal(rigidPoseGraph(frames).conflicts.length, 0);
  assert.equal(clear(frames[0].nodes.get('p')), true);
});

// A ternary V′ whose middle sister's feature label wraps to three lines and
// rises most of a row above it, beside a silent trace and a PP.
const ternary = () => ({ id: 'vbar', label: 'V′', children: [
  { id: 'vt', label: 'V⁰ trace', silent: true },
  { id: 'theme', label: 'NP[uφ:3.sg.fem, +wh, +Q, EPP, iT:past]', children: [
    { id: 'el', label: 'D⁰ (Spec-NP)', word: 'el' },
    { id: 'themeNbar', label: 'N′', children: [{ id: 'libro', label: 'N⁰', word: 'libro' }] }] },
  { id: 'recipient', label: 'PP', children: [{ id: 'pbar', label: 'P′', children: [
    { id: 'a', label: 'P⁰', word: 'a' },
    { id: 'maria', label: 'NP', children: [{ id: 'mariaNbar', label: 'N′', children: [{ id: 'mariaN', label: 'N⁰', word: 'María' }] }] }] }] }] });

// Branches always span one row. Francis rejected stretched branches and, on
// 24 October 2026, accepted lines that cross words and labels, so a fork that no
// widening clears keeps its row and its slots instead of lowering its daughters.
test('a fork no widening clears keeps its row and slots, and its branch crosses the inner label', () => {
  const { measureCategoryText, measureTreeInk } = TEXT_METRICS;
  const part = prepareWorkspaceLifetimeContours([step(ternary())], measureCategoryText, measureTreeInk)()[0].nodes.get('vbar');
  for (const child of part.children) assert.equal(part.members.get(child.id).y, TREE_ROW_HEIGHT, `${child.id} stays one row below`);
  assert.equal(clear(part), false);
  // Every widening still crosses the label at one height.
  assert.equal(forkWideningCannotClear({ x: 0, y: 0 }, part.children.map(child => ({ point: part.members.get(child.id), obstacles: child.obstacles }))), true);
  for (const factor of [1, 4, 64, 512]) assert.equal(currentForkBranchesClear({ x: 0, y: 0 }, part.children.map(child => ({
    point: { x: part.members.get(child.id).x * factor, y: TREE_ROW_HEIGHT }, obstacles: child.obstacles }))), false);

  const tree = layoutSyntaxTree(d3.hierarchy(ternary()), [1440, 900], 'ltr', undefined, undefined, { measureCategoryText, measureTreeInk });
  const placed = new Map(tree.descendants().map(node => [node.data.id, node]));
  for (const child of part.children) {
    assert.equal(placed.get(child.id).y - placed.get('vbar').y, TREE_ROW_HEIGHT, 'the Canopy keeps one-row branches');
    assert.ok(Math.abs(placed.get(child.id).x - placed.get('vbar').x - part.members.get(child.id).x) < 1e-6, 'the Canopy uses the packed fork');
  }
});

// Sol's Spanish n4-14 (sol-parts-20261026, "Juan quiere que se lo expliquemos a
// su hermana…"), reduced: a three-way V′ whose silent middle object carries a
// four-line feature label, then head movement of V to I. The movement makes the
// coherent planner compose that fork; it used to lower the daughters to a
// second row from the V′'s first frame through the Canopy.
const spanishClause = moved => ({ id: 'eIP', label: 'IP', children: [
  { id: 'eSubj', label: 'NP [pro, 1pl]', silent: true },
  { id: 'eIbar', label: 'I′', children: [
    { id: 'eI', label: 'I⁰', children: [
      { id: 'loCl', label: 'Cl⁰ [accusative, masculine singular]', word: 'lo' },
      moved ? { id: 'eIcore', label: 'I⁰ [present subjunctive, 1pl]', children: [
        { id: 'eV', label: 'V⁰', word: 'expliquemos', lineageId: 'explicar' },
        { id: 'eInfl', label: 'I⁰ [inflectional features]', silent: true }] }
        : { id: 'eIcore', label: 'I⁰ [present subjunctive, 1pl]', silent: true }] },
    { id: 'eVP', label: 'VP', children: [{ id: 'eVbar', label: 'V′', children: [
      moved ? { id: 'eTrace', label: 't [V⁰]', silent: true, lineageId: 'explicar' }
        : { id: 'eV', label: 'V⁰', word: 'expliquemos', lineageId: 'explicar' },
      { id: 'eObj', label: 'NP [pro, accusative, masculine singular]', silent: true },
      { id: 'goalPP', label: 'PP [Goal]', children: [{ id: 'goalPbar', label: 'P′', children: [
        { id: 'goalP', label: 'P⁰ [dative]', word: 'a' },
        { id: 'sisNP', label: 'NP', children: [{ id: 'su', label: 'D⁰ [possessive, third-person possessor]', word: 'su' },
          { id: 'sisNbar', label: 'N′', children: [{ id: 'sisN', label: 'N⁰', word: 'hermana' }] }] }] }] }] }] }] }] });

test('head movement out of a three-way V′ under a four-line inner label keeps every branch on one row', () => {
  const visual = prepareVisualRecord({ sentence: 'lo expliquemos a su hermana', inputTokens: ['lo', 'expliquemos', 'a', 'su', 'hermana'],
    derivationStages: [
      { statement: 'Build the clause.', stageRecord: 'The clause is built.', workspaceForest: [spanishClause(false)],
        relations: [{ relation: 'theta_assignment', anchors: { predicate: 'eV', theme: 'eObj', goal: 'goalPP' } }] },
      { statement: 'Raise the verb to I.', stageRecord: 'The verb raises to I.', workspaceForest: [spanishClause(true)],
        relations: [{ relation: 'V_to_I_movement', anchors: { movedHead: 'eV', landingHead: 'eIcore', sourceTrace: 'eTrace' },
          priorAnchors: { sourceHead: 'eV' } }] }] });
  assert.equal(categoryTextLayout('NP [pro, accusative, masculine singular]', TEXT_METRICS.measureCategoryText).lines.length, 4);
  const desktop = VIEWPORTS.filter(viewport => viewport.name === 'desktop');
  const frames = [...layoutVisualFrames(visual, desktop), layoutCanopyVisualFrame(visual, desktop[0])];
  assert.ok(frames.some(frame => frame.lines.some(line => line.kind === 'branch' && line.nodes[0] === 'eVbar' && line.nodes[1] === 'eTrace')),
    'the moved V leaves its trace in the V′');
  for (const frame of frames) assert.deepEqual(checkBranchGeometry(frame).map(finding => finding.detail), [], `frame ${frame.frame}`);
});

test('a Canopy fork no widening clears is packed with its slots rather than thrown away', () => {
  const canvas = fork('p', atom('A'), atom('I'), atom('B'));
  // The inner label is far taller than any branch could pass above.
  const bounds = { A: { x: -20, y: -40, width: 40, height: 45 }, I: { x: -190, y: -1e5, width: 380, height: 1e5 + 5 },
    B: { x: -700, y: -40, width: 1400, height: 45 } };
  const treeLabelRuns = new Map([[canvas, new Map(Object.keys(bounds).map(id => [id, [{ kind: 'category', id }]]))]]);
  const measureTreeLabel = runs => bounds[runs.id];
  const part = prepareWorkspaceLifetimeContours([step(canvas)], undefined, undefined, treeLabelRuns, measureTreeLabel)()[0].nodes.get('p');
  const tree = layoutSyntaxTree(d3.hierarchy(canvas), [1000, 1000], 'ltr', undefined, undefined, { treeLabelRuns, measureTreeLabel });
  const placed = new Map(tree.descendants().map(node => [node.data.id, node]));
  for (const id of ['A', 'I', 'B']) assert.deepEqual([placed.get(id).x - placed.get('p').x, placed.get(id).y - placed.get('p').y],
    [part.members.get(id).x, part.members.get(id).y], `the Canopy places ${id} as packed`);
  assert.equal(new Set(['A', 'I', 'B'].map(id => placed.get(id).y)).size, 1, 'the sisters share one row');
});
