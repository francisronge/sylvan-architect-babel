import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareWorkspaceLifetimeContours } from '../replay/workspaceLifetimeContours.ts';
const atom = id => ({ id, label: 'N' });
const fork = (id, ...children) => ({ id, label: 'P', children });
const ids = n => [n.id, ...(n.children ?? []).flatMap(ids)];
function fixture(option) {
  const source = () => fork('source', atom('word'));
  const before = fork('host', atom('head'), fork('pred', source(), fork('still', atom('bystander'))));
  const pred = fork('pred', atom('lower'), fork('still', atom('bystander')));
  const after = fork('wrapper', source(), fork('host', atom('head'), pred));
  if (option === 'wrong-parent') pred.children[0] = fork('other-parent', atom('lower'));
  if (option === 'reordered') pred.children.reverse();
  if (option === 'extra-child') pred.children.splice(1, 0, atom('extra'));
  const step = (canvas, move) => ({ replayCanvasData: canvas, replayVisibleNodeIds: ids(canvas), replayKind: move ? 'relation' : 'micro', ...(move ? {
    replayRelationIdentity: { stageIndex: 1, relationIndex: 0 },
    replayRelationLinks: [{ authoredRelationKey: '1:0', renderFamily: 'trajectory', priorSourceNodeId: 'source', witnessNodeId: 'lower', targetNodeId: 'source' }]
  } : {}) });
  const steps = [step(before, false), step(after, true)], link = steps[1].replayRelationLinks[0];
  if (option === 'stale') link.authoredRelationKey = '0:0';
  if (option === 'nonmovement') link.renderFamily = 'authored-anchor-link';
  if (option === 'structural') steps[1].replayKind = 'micro';
  if (option === 'same-id') {
    after.children[0].id = 'landing'; pred.children[0].id = 'source';
    steps[1].replayVisibleNodeIds = ids(after);
    link.witnessNodeId = 'source'; link.targetNodeId = 'landing';
  }
  const sourcePoint = { x: option === 'mirrored' ? -600 : 600, y: 600 };
  const witnessPoint = { ...sourcePoint };
  if (['moving-x', 'mutate-moving-to-fixed', 'later-fixed-reference'].includes(option)) witnessPoint.x += 40;
  if (option === 'moving-y') witnessPoint.y += 40;
  if (option === 'nonfinite') witnessPoint.x = NaN;
  const accepted = new Map([[before, new Map([['source', sourcePoint]])], [after, new Map([[link.witnessNodeId, witnessPoint]])]]);
  if (option === 'missing-boundary') accepted.delete(before);
  if (option === 'missing-point') accepted.get(after).clear();
  if (option === 'later-fixed-reference') {
    const later = structuredClone(after); steps.push(step(later, false));
    accepted.set(later, new Map([[link.witnessNodeId, { ...sourcePoint }]]));
  }
  const compose = prepareWorkspaceLifetimeContours(steps, undefined, undefined, undefined, undefined, 'ltr', option === 'missing-references' ? undefined : accepted);
  if (option === 'mutate-after-prepare') witnessPoint.x += 40;
  if (option === 'mutate-moving-to-fixed') witnessPoint.x = sourcePoint.x;
  const initial = compose(), preferred = new Map();
  for (const frame of initial) for (const c of frame.nodes.values()) preferred.set(c.incarnation, new Map([...c.members].map(([id, p]) => [id, { ...p }])));
  for (let i = 0; i < 2; i++) {
    const points = preferred.get(initial[i].nodes.get('host').incarnation);
    points.set('head', { x: i ? -1000 : -1500, y: 300 }); points.set('pred', { x: i ? 1000 : 1500, y: 300 });
    const inner = initial[i].nodes.get('pred'), slots = preferred.get(inner.incarnation);
    inner.children.forEach((child, index) => slots.set(child.id, { x: index ? 900 : i ? -300 : -900, y: 300 }));
  }
  return { steps, compose, preferred };
}
const dx = (shape, id) => shape.members.get(id).x - shape.members.get('head').x;
for (const option of [undefined, 'mirrored', 'mutate-after-prepare']) test(`stationary accepted witness keeps its source slot without copying source syntax: ${option ?? 'default'}`, () => {
  const f = fixture(option), input = JSON.stringify(f.steps), frames = f.compose(undefined, { inheritCurrentSlots: true, preferred: f.preferred });
  const a = frames[0].nodes.get('host'), b = frames[1].nodes.get('host');
  for (const id of ['still', 'bystander']) assert.ok(Math.abs(dx(a, id) - dx(b, id)) < 1e-6);
  assert.ok(Math.abs(dx(a, 'source') - dx(b, 'lower')) < 1e-6);
  assert.equal(frames[0].nodes.get('source').children.length, 1);
  assert.equal(frames[1].nodes.get('lower').children.length, 0);
  assert.equal(JSON.stringify(f.steps), input);
});
for (const option of ['stale', 'nonmovement', 'structural', 'wrong-parent', 'reordered', 'extra-child', 'same-id', 'missing-references', 'missing-boundary', 'missing-point', 'moving-x', 'moving-y', 'nonfinite', 'mutate-moving-to-fixed', 'later-fixed-reference']) test(`lower root cannot borrow the source slot through ${option}`, () => {
  const f = fixture(option);
  let frames;
  try { frames = f.compose(undefined, { inheritCurrentSlots: true, preferred: f.preferred }); }
  catch (error) { assert.match(String(error), /current slots|current ranks|clear/); return; }
  const a = frames[0].nodes.get('host'), b = frames[1].nodes.get('host');
  assert.ok(Math.abs(dx(a, 'source') - dx(b, f.steps[1].replayRelationLinks[0].witnessNodeId)) > 1);
});
