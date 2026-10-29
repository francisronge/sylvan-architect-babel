import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { visiblePlanFrameItems } from '../replay/relations/relationFrame.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';

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

test('a neutral list grown or restated in a later stage replaces its rail at the new moment', () => {
  for (const [label, later] of [['grown', span('a', 'g')], ['restated', span('a', 'f')], ['narrowed', span('b', 'f')]]) {
    const stages = [stage([open(span('a', 'f'))]), stage([open(later)]), stage([])];
    const { timeline } = play(stages);
    const at = text => timeline.find(step => step.label === text);
    assert.deepEqual(at('stage 2 moment entry').rails.map(rail => rail.rail), ['0:0'], `${label}: the earlier rail stands until then`);
    for (const text of ['stage 2 moment 0', 'stage 3 complete']) {
      assert.deepEqual(at(text).rails.map(rail => [rail.rail, rail.lane]), [['1:0', 0]], `${label} at ${text}: one rail over the list`);
      assert.deepEqual(at(text).badges.map(badge => badge.numeral), later.map((_id, index) => index + 1));
    }
  }
});

test('a rail keeps its lane while another leaves, and a new rail takes the lowest free lane', () => {
  // The list grown in stage 2 replaces its stage-1 rail; the scope rail beside
  // it keeps its second lane, the replacement takes the first lane the old list
  // left, and a rail over other terminals starts on the first lane too.
  const stages = [stage([open(span('a', 'e')), open(span('c', 'g'), 'Scope set')]),
    stage([open(span('a', 'f')), open(span('h', 'l'), 'Other list')]), stage([])];
  const { timeline } = play(stages);
  assert.deepEqual(timeline.at(-1).rails.map(rail => [rail.rail, rail.lane]), [['0:1', 1], ['1:0', 0], ['1:1', 0]]);
});
