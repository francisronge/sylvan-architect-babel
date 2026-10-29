import assert from 'node:assert/strict';
import test from 'node:test';
import { scopeDomainPaint } from '../replay/relations/scopeDomainPaint.ts';

// Sol n4-39 (center embedding, sol-cfc 27 Oct 2026): the small cat-clause domain
// appears at stage 2, the large rat-clause domain at stage 6's third moment.
// Ranking every domain of the stage turned the cat domain orange at stage 7's
// first step; ranking only revealed domains moved its binding lane at the rat's
// moment and put it outside the rat's. Francis: "Why does it change colour in a
// random frame, it's only supposed to have a different colour if there are multiple."
const scope = (domain, stageIndex, relationIndex, members) => ({
  kind: 'operator-variable-binding', scopeDomainNodeId: domain, appearsAtStage: stageIndex,
  scopeMemberNodeIds: Array.from({ length: members }, (_, index) => `${domain}-m${index}`),
  relationRef: { stageIndex, relationIndex, relation: 'x', anchors: {} }
});
const planOf = frames => ({ frames: frames.map((items, stageIndex) => ({ stageIndex, items })) });
const micro = stageIndex => ({ replayKind: 'micro', replayFrameIndex: stageIndex });
const moment = (stageIndex, relationIndex) => ({ replayKind: 'relation', replayFrameIndex: stageIndex,
  replayRelationIdentity: { stageIndex, relationIndex } });
const revealedAt = (item, step, played) => item.appearsAtStage < step.replayFrameIndex
  || item.relationRef.stageIndex === step.replayFrameIndex && played.has(item.relationRef.relationIndex);

/** Each step's paint of every domain on screen, as the renderer reveals them. */
function paintedSteps(plan, steps) {
  return steps.map((step, stepIndex) => {
    const played = new Set(steps.slice(0, stepIndex + 1).filter(other => other.replayKind === 'relation'
      && other.replayRelationIdentity.stageIndex === step.replayFrameIndex).map(other => other.replayRelationIdentity.relationIndex));
    const items = plan.frames[step.replayFrameIndex].items;
    const paint = scopeDomainPaint(plan, step.replayFrameIndex, steps, stepIndex);
    return new Map(items.flatMap((item, itemIndex) => revealedAt(item, step, played)
      ? [[item.scopeDomainNodeId, paint.get(itemIndex)]] : []));
  });
}
/** Every change in a shown domain's paint between adjacent steps. */
const changes = (painted, fields) => painted.slice(1).flatMap((now, index) => [...now].flatMap(([domain, paint]) => {
  const before = painted[index].get(domain);
  return before && fields.some(field => before[field] !== paint[field]) ? [`${index}->${index + 1} ${domain}`] : [];
}));

const cat = scope('cat', 0, 0, 12), rat = scope('rat', 1, 2, 30);
const n439 = planOf([[cat], [cat, rat], [cat, rat]]);
const n439Steps = [micro(0), moment(0, 0), micro(0), micro(1), moment(1, 0), moment(1, 1), moment(1, 2), micro(2), moment(2, 0)];

test('a later domain never moves a shown domain\'s hull or lane, and the larger domain stays outside', () => {
  const painted = paintedSteps(n439, n439Steps);
  assert.deepEqual(changes(painted, ['rank', 'count']), []);
  const together = painted.at(-1);
  assert.ok(together.get('rat').rank < together.get('cat').rank, 'the larger domain takes the outer hull padding');
  const laneOffset = ({ rank, count }) => count - rank - 1;
  assert.ok(laneOffset(together.get('rat')) > laneOffset(together.get('cat')), 'and the outer binding lane');
});

test('a shown domain keeps its colour while others appear; one domain alone is the base colour', () => {
  const painted = paintedSteps(n439, n439Steps);
  assert.deepEqual(changes(painted, ['colourSlot']), []);
  assert.deepEqual(painted.map(step => step.get('cat')?.colourSlot), [undefined, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(painted.map(step => step.get('rat')?.colourSlot), [undefined, undefined, undefined, undefined, undefined, undefined, 1, 1, 1]);
});

test('a domain left alone when another retires returns to the base colour at that step, and only then', () => {
  const a = scope('a', 0, 0, 10), b = scope('b', 1, 0, 20), c = scope('c', 2, 1, 5);
  const plan = planOf([[a], [a, b], [b, c]]);
  const steps = [moment(0, 0), moment(1, 0), micro(2), moment(2, 1)];
  const painted = paintedSteps(plan, steps);
  assert.deepEqual(changes(painted, ['rank', 'count']), []);
  // Francis: "it's only supposed to have a different colour if there are multiple".
  assert.deepEqual(painted.map(step => Object.fromEntries([...step].map(([domain, paint]) => [domain, paint.colourSlot]))),
    [{ a: 0 }, { a: 0, b: 1 }, { b: 0 }, { b: 0, c: 1 }]);
  assert.deepEqual(changes(painted, ['colourSlot']), ['1->2 b'], 'b recolours only at the step that retires a');
});

test('colour follows played order, not authored relation order', () => {
  const early = scope('early', 0, 1, 10), late = scope('late', 0, 0, 10);
  const painted = paintedSteps(planOf([[late, early]]), [moment(0, 1), moment(0, 0)]);
  assert.deepEqual([...painted.at(-1)].map(([domain, paint]) => [domain, paint.colourSlot]).sort(), [['early', 0], ['late', 1]]);
});

test('two items on one domain node are one domain', () => {
  const first = scope('d', 0, 0, 10), restated = scope('d', 0, 1, 10), other = scope('e', 1, 0, 30);
  const painted = paintedSteps(planOf([[first, restated], [first, restated, other]]), [moment(0, 0), moment(0, 1), moment(1, 0)]);
  assert.deepEqual(changes(painted, ['colourSlot', 'rank', 'count']), []);
  assert.deepEqual(painted.at(-1).get('e'), { rank: 0, count: 2, colourSlot: 1 });
  assert.deepEqual(painted.at(-1).get('d'), { rank: 1, count: 2, colourSlot: 0 });
});
