import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { projectVisibleAnchorSetOrganization, visiblePlanFrameItems } from '../replay/relations/relationFrame.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { isPlanItemRevealed } from '../replay/relations/renderPlan.ts';
import { RELATION_BINDING_METRICS } from '../replay/rendererMetrics.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';

// Rails shown together over shared terminals take distinct lanes and badge
// slots, and each keeps them while it stays on screen (anchorRailBands.ts).
const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
const stage = (relations, present = ids) => ({ statement: 'Test', stageRecord: 'Test', relations,
  workspaceForest: present.map(id => ({ id, label: 'V', word: 'read' })) });
const open = (members, relation = 'Open list') => ({ relation, anchors: { members } });
const forms = members => ({ relation: 'Current forms', anchors: { verb: members }, values: { verbForm: members.map(() => 'past') } });
const span = (from, to) => ids.slice(ids.indexOf(from), ids.indexOf(to) + 1);

const view = (plan, index, played, active = null) => {
  const items = visiblePlanFrameItems(plan, index, played, active);
  const geometry = bindRelationPlanFrame({ ...plan, frames: plan.frames.map((frame, i) => i === index ? { ...frame, items } : frame) },
    index, id => ({ x: ids.indexOf(id) * 180, y: 0 }));
  const owner = primitive => `${items[primitive.itemIndex].set.stageIndex}:${items[primitive.itemIndex].set.relationIndex}`;
  return {
    rails: geometry.primitives.filter(mark => mark.type === 'anchor-set-rail')
      .map(rail => ({ rail: owner(rail), x1: rail.x1, x2: rail.x2, y: rail.y, lane: rail.lane })),
    badges: geometry.primitives.filter(mark => mark.type === 'anchor-set-badge')
      .map(badge => ({ rail: owner(badge), nodeId: badge.nodeId, x: badge.x, y: badge.y, numeral: badge.numeral }))
  };
};

/** Every Replay step: each stage's entry, each relation moment in turn, and the completed stage. */
const steps = (plan, stages) => plan.frames.flatMap((_frame, index) => [
  [index, new Set(), null],
  ...stages[index].relations.map((_relation, relationIndex) =>
    [index, new Set(Array.from({ length: relationIndex + 1 }, (_unused, i) => i)), relationIndex]),
  [index, null, null]
].map(([frame, played, active]) => ({ label: `stage ${frame + 1} ${played === null ? 'complete' : `moment ${active ?? 'entry'}`}`,
  ...view(plan, frame, played, active) })));

const assertNoCollisions = ({ label, rails, badges }) => {
  rails.forEach((left, index) => rails.slice(index + 1).forEach(right => assert.ok(
    left.lane !== right.lane || left.x2 < right.x1 || right.x2 < left.x1,
    `${label}: rails ${left.rail} and ${right.rail} share lane ${left.lane} over ${Math.max(left.x1, right.x1)}–${Math.min(left.x2, right.x2)}`)));
  const positions = badges.map(badge => `${badge.x},${badge.y}`);
  assert.equal(new Set(positions).size, positions.length, `${label}: two numerals at one point`);
};

/** A rail's lane and numerals never change while it stays on screen. */
const assertStable = timeline => {
  const seen = new Map();
  let previous = new Set();
  for (const step of timeline) {
    const shown = new Set(step.rails.map(rail => rail.rail));
    for (const rail of shown) {
      const drawing = JSON.stringify([step.rails.filter(r => r.rail === rail).map(({ lane, y }) => [lane, y]),
        step.badges.filter(b => b.rail === rail)]);
      if (previous.has(rail)) assert.equal(drawing, seen.get(rail), `${step.label}: rail ${rail} moved while on screen`);
      seen.set(rail, drawing);
    }
    previous = shown;
  }
};

const play = stages => {
  const plan = compileRelationRenderPlan(stages);
  const timeline = steps(plan, stages);
  timeline.forEach(assertNoCollisions);
  assertStable(timeline);
  return { plan, timeline };
};

test('overlapping neutral rails take distinct lanes and badge slots from their own moments on', () => {
  const stages = [stage([open(span('a', 'e')), open(span('c', 'g'), 'Scope set')]), stage([])];
  const { timeline } = play(stages);
  const last = timeline.at(-1);
  assert.deepEqual(last.rails.map(rail => [rail.rail, rail.lane]), [['0:0', 0], ['0:1', 1]]);
  assert.equal(last.badges.length, 10, 'both rails keep every numeral');
});

test('a neutral rail over a recognized rail takes the next lane, and a lone rail keeps lane 0', () => {
  const { timeline } = play([stage([forms(span('a', 'e')), open(span('c', 'g'))]), stage([])]);
  assert.deepEqual(timeline.at(-1).rails.map(rail => [rail.rail, rail.lane]), [['0:0', 0], ['0:1', 1]]);
  const apart = play([stage([forms(span('a', 'e')), open(span('f', 'j'))]), stage([])]).timeline.at(-1);
  assert.deepEqual(apart.rails.map(rail => rail.lane), [0, 0], 'rails over separate terminals share the first lane');
});

test('recognized rails restated over shared entries in a later stage never meet', () => {
  const { timeline } = play([stage([forms(span('a', 'e'))]), stage([forms(span('a', 'f'))]), stage([])]);
  assert.deepEqual(timeline.at(-1).rails.map(rail => rail.lane), [0, 1]);
});

test('recognized rails restated with the same entries in a later stage draw one rail', () => {
  // Restatements number the same sequence, so they share a band and their
  // copies coincide, as before rails had bands.
  const plan = compileRelationRenderPlan([stage([forms(span('a', 'e'))]), stage([forms(span('a', 'e'))]), stage([])]);
  assert.deepEqual(plan.frames.flatMap(frame => frame.items.filter(item => item.kind === 'anchor-set').map(item => item.railBand ?? 0)),
    [0, 0, 0, 0, 0]);
  const bound = bindRelationPlanFrame({ ...plan, frames: plan.frames.map((frame, i) => i === 2 ? { ...frame, items: visiblePlanFrameItems(plan, 2, null) } : frame) },
    2, id => ({ x: ids.indexOf(id) * 180, y: 0 }), { badgeObstacles: [] });
  const drawn = type => new Set(bound.primitives.filter(mark => mark.type === type)
    .map(mark => JSON.stringify(type === 'anchor-set-rail' ? [mark.y, mark.lane] : [mark.nodeId, mark.numeral, mark.x, mark.y])));
  assert.equal(drawn('anchor-set-rail').size, 1, 'one rail line');
  assert.equal(drawn('anchor-set-badge').size, 5, 'one row of numerals');
});

test('only an exact restatement in a later stage replaces a neutral rail; a grown, narrowed or reordered list stands beside it', () => {
  // The same entries in the same order restate the claim. A subset, superset
  // or reordering numbers differently, so it is a different claim, and both
  // rails stay.
  for (const [label, later, replaces] of [['restated', span('a', 'f'), true], ['reordered', span('a', 'f').reverse(), false],
    ['grown', span('a', 'g'), false], ['narrowed', span('b', 'f'), false]]) {
    const stages = [stage([open(span('a', 'f'))]), stage([open(later)]), stage([])];
    const { timeline } = play(stages);
    const at = text => timeline.find(step => step.label === text);
    assert.deepEqual(at('stage 2 moment entry').rails.map(rail => rail.rail), ['0:0'], `${label}: the earlier rail stands until then`);
    for (const text of ['stage 2 moment 0', 'stage 3 complete']) {
      assert.deepEqual(at(text).rails.map(rail => [rail.rail, rail.lane]), replaces ? [['1:0', 0]] : [['0:0', 0], ['1:0', 1]],
        `${label} at ${text}`);
      assert.deepEqual(at(text).badges.filter(badge => badge.rail === '1:0').map(badge => badge.numeral), later.map((_id, index) => index + 1));
    }
  }
});

test('one claim\'s moment never removes another claim\'s rail over a subset or superset of its entries', () => {
  const ten = span('a', 'j'), scope = span('c', 'g');
  for (const [first, second] of [[open(ten), open(scope, 'Scope set')], [open(scope, 'Scope set'), open(ten)]]) {
    const { timeline } = play([stage([first]), stage([second]), stage([])]);
    assert.deepEqual(timeline.at(-1).rails.map(rail => [rail.rail, rail.lane]), [['0:0', 0], ['1:0', 1]],
      `${first.relation} then ${second.relation}: both rails stay on separate bands`);
    assert.equal(timeline.at(-1).badges.length, ten.length + scope.length, 'each keeps every numeral');
  }
  // A restatement in stage 2 retires only the rail it restates.
  const { timeline } = play([stage([open(span('a', 'e')), open(span('c', 'g'), 'Scope set')]), stage([open(span('a', 'e'))]), stage([])]);
  assert.deepEqual(timeline.at(-1).rails.map(rail => [rail.rail, rail.lane]), [['0:1', 1], ['1:0', 0]]);
});

test('a list restated in reverse within one stage is its own rail with its own numerals and band', () => {
  const list = span('a', 'f');
  const { plan, timeline } = play([stage([open(list), open([...list].reverse())]), stage([])]);
  assert.deepEqual(plan.frames[0].items.filter(item => item.kind === 'anchor-set').map(item => item.railBand ?? 0), [0, 1]);
  const last = timeline.at(-1);
  assert.deepEqual(last.rails.map(rail => [rail.rail, rail.lane]), [['0:0', 0], ['0:1', 1]]);
  assert.deepEqual(last.badges.filter(badge => badge.nodeId === 'a').map(badge => [badge.rail, badge.numeral]), [['0:0', 1], ['0:1', 6]]);
});

test('a superseded rail\'s badges never push its replacement\'s badges, as the renderer binds them', () => {
  // The renderer binds every item of the frame, the hidden predecessor too
  // (relationScene.ts), with badge clearance and item reveal.
  const list = span('a', 'f');
  const stages = [stage([open(list)], list), stage([open(list)], list), stage([], list)];
  const plan = compileRelationRenderPlan(stages);
  const rows = [[0, new Set([0]), 0], [0, null, null], [1, new Set(), null], [1, new Set([0]), 0], [1, null, null], [2, new Set(), null]]
    .map(([index, played, active]) => {
      const revealed = item => isPlanItemRevealed(item, index, played, active);
      const items = projectVisibleAnchorSetOrganization(plan.frames[index].items, revealed);
      const shown = new Set(items.flatMap((item, itemIndex) => revealed(item) ? [itemIndex] : []));
      const geometry = bindRelationPlanFrame({ ...plan, frames: plan.frames.map((frame, i) => i === index ? { ...frame, items } : frame) },
        index, id => ({ x: ids.indexOf(id) * 180, y: 0 }),
        { ...RELATION_BINDING_METRICS, badgeObstacles: [], isItemRevealed: itemIndex => shown.has(itemIndex) });
      return JSON.stringify(geometry.primitives.filter(mark => mark.type === 'anchor-set-badge' && shown.has(mark.itemIndex))
        .map(badge => [badge.nodeId, badge.numeral, badge.x, badge.y]));
    });
  assert.equal(new Set(rows).size, 1, `the badges hold through the replacement: ${rows.join(' | ')}`);
});

test('a list grown within one stage keeps both rails, on separate bands with separate numerals', () => {
  // Coordinator decision B: two claims, each numbered faithfully, never colliding.
  const { timeline } = play([stage([open(span('a', 'e')), open(span('a', 'f'))]), stage([])]);
  const last = timeline.at(-1);
  assert.deepEqual(last.rails.map(rail => [rail.rail, rail.lane]), [['0:0', 0], ['0:1', 1]]);
  assert.equal(last.badges.length, 11);
});

test('a rail keeps its lane while another leaves, and a new rail takes the lowest free lane', () => {
  // The restated list in stage 2 replaces its stage-1 rail; the scope rail
  // beside it keeps its second lane, the restatement takes the first lane the
  // old list left, and a rail over other terminals starts on the first lane too.
  const stages = [stage([open(span('a', 'e')), open(span('c', 'g'), 'Scope set')]),
    stage([open(span('a', 'e')), open(span('h', 'l'), 'Other list')]), stage([])];
  const { timeline } = play(stages);
  assert.deepEqual(timeline.at(-1).rails.map(rail => [rail.rail, rail.lane]), [['0:1', 1], ['1:0', 0], ['1:1', 0]]);
});

test('bands follow the order Replay plays a stage\'s moments, not authored order', () => {
  // The open list names b's landing, so Replay plays it right after the
  // movement (orderRelationMoments): the scope set comes first and stands
  // alone on the first lane; the list joins it on the next.
  const ps = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const phrase = (id, silent = false) => ({ id, label: 'DP', lineageId: id.replace(/_hi$/, '').toUpperCase(),
    word: id.replace(/_hi$/, ''), ...(silent ? { silent: true } : {}) });
  const record = { sentence: 'b p1 p2 p3 p4 p5', derivationStages: [
    { statement: 'Phrases.', stageRecord: 'Six phrases are built.', relations: [], workspaceForest: [phrase('b'), ...ps.map(id => phrase(id))] },
    { statement: 'Movement.', stageRecord: 'b moves.', relations: [
      open(['b_hi', ...ps.slice(0, 4)]), open(ps, 'Scope set'),
      { relation: 'Internal Merge', anchors: { lowerCopy: 'b', higherCopy: 'b_hi' }, priorAnchors: { source: 'b' } }],
    workspaceForest: [{ id: 'root', label: 'XP', children: [{ id: 'host_b', label: 'XP', children: [phrase('b_hi'), phrase('b', true)] },
      ...ps.map(id => phrase(id))] }] }] };
  const { playbackSteps: replaySteps, relationRenderPlan: plan } = prepareReplay({ ...record, includePlayback: true });
  const moments = replaySteps.filter(step => step.replayKind === 'relation' && step.replayFrameIndex === 1);
  assert.deepEqual(moments.map(step => step.replayRelationIdentity.relationIndex), [1, 2, 0], 'the stage is reordered');
  const order = ['b_hi', 'b', ...ps];
  const lanes = replaySteps.map((step, index) => {
    const played = new Set(replaySteps.slice(0, index + 1).filter(other => other.replayKind === 'relation'
      && other.replayFrameIndex === step.replayFrameIndex).map(other => other.replayRelationIdentity.relationIndex));
    const items = visiblePlanFrameItems(plan, step.replayFrameIndex, played, step.replayKind === 'relation'
      ? step.replayRelationIdentity.relationIndex : null);
    const geometry = bindRelationPlanFrame({ ...plan, frames: plan.frames.map((frame, i) => i === step.replayFrameIndex ? { ...frame, items } : frame) },
      step.replayFrameIndex, id => order.includes(id) ? { x: order.indexOf(id) * 180, y: 0 } : null);
    const rails = geometry.primitives.filter(mark => mark.type === 'anchor-set-rail');
    const badges = geometry.primitives.filter(mark => mark.type === 'anchor-set-badge').map(badge => `${badge.x},${badge.y}`);
    assert.equal(new Set(badges).size, badges.length, `step ${index + 1}: two numerals at one point`);
    return rails.map(rail => `${items[rail.itemIndex].set.relationIndex}:${rail.lane}`).sort().join(' ');
  }).filter(Boolean);
  assert.deepEqual([...new Set(lanes)], ['1:0', '0:1 1:0'], 'the scope set keeps the first lane from its own moment on');
});

test('bands do not depend on whether playback is requested', () => {
  // The same record as above: the moment order reverses the authored bands.
  const ps = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const phrase = (id, silent = false) => ({ id, label: 'DP', lineageId: id.replace(/_hi$/, '').toUpperCase(),
    word: id.replace(/_hi$/, ''), ...(silent ? { silent: true } : {}) });
  const record = { sentence: 'b p1 p2 p3 p4 p5', derivationStages: [
    { statement: 'Phrases.', stageRecord: 'Six phrases are built.', relations: [], workspaceForest: [phrase('b'), ...ps.map(id => phrase(id))] },
    { statement: 'Movement.', stageRecord: 'b moves.', relations: [
      open(['b_hi', ...ps.slice(0, 4)]), open(ps, 'Scope set'),
      { relation: 'Internal Merge', anchors: { lowerCopy: 'b', higherCopy: 'b_hi' }, priorAnchors: { source: 'b' } }],
    workspaceForest: [{ id: 'root', label: 'XP', children: [{ id: 'host_b', label: 'XP', children: [phrase('b_hi'), phrase('b', true)] },
      ...ps.map(id => phrase(id))] }] }] };
  const bands = includePlayback => prepareReplay({ ...structuredClone(record), includePlayback }).relationRenderPlan.frames
    .map(frame => frame.items.filter(item => item.kind === 'anchor-set').map(item => [item.set.relationIndex, item.railBand ?? 0]));
  assert.deepEqual(bands(true), [[], [[0, 1], [1, 0]]]);
  assert.deepEqual(bands(false), bands(true));
});
