import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { reserveWorkspaceAttachments } from '../replay/workspacePlacement.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';

const node = (id, children = []) => ({ id, label: id, ...(children.length ? { children } : {}) });
const forest = (...children) => ({ ...node('workspace', children), replayOrigin: { kind: 'workspace' } });
function scenario({ changedChild = false, ambiguous = false, attached = true, relation = true } = {}) {
  const earlier = forest(node('a'), node('loose'));
  const before = forest(node('r', [node('a'), node('b')]), node('loose'));
  const component = node('r', [node('lower'), node(changedChild ? 'replacement' : 'b')]);
  const after = forest(attached ? node('parent', [node('a'), component]) : component, node('loose'));
  const later = forest(node('r', [node('lower'), node('new-child')]), node('loose'));
  const links = [{ authoredRelationKey: '1:0', priorSourceNodeId: 'a', witnessNodeId: 'lower' }];
  if (ambiguous) links.push({ authoredRelationKey: '1:0', priorSourceNodeId: 'a', witnessNodeId: 'b' });
  const steps = [earlier, before, after, later].map((canvas, i) => ({
    replayCanvasData: canvas, replayFrameIndex: i < 2 ? 0 : i - 1,
    replayStageStepIndex: i === 1 ? 1 : 0,
    replayKind: i === 0 ? 'micro' : i === 1 ? 'macro' : i === 2 && relation ? 'relation' : 'micro',
    replayVisibleNodeIds: d3.hierarchy(canvas).descendants().filter(n => n.data.id !== 'workspace').map(n => n.data.id),
    replayRelationLinks: i >= 2 ? links : []
  }));
  const raw = [
    { a: [10, 20], loose: [200, 0] },
    { r: [20, 0], a: [10, 20], b: [30, 20], loose: [200, 0] },
    { parent: [100, 0], a: [80, 20], r: [120, 20], lower: [90, 60], b: [150, 60], replacement: [150, 60], loose: [200, 0] },
    { r: [220, 0], lower: [200, 20], 'new-child': [240, 20], loose: [300, 0] }
  ];
  const originals = new Map(steps.map((step, i) => [step.replayCanvasData,
    new Map(Object.entries(raw[i]).map(([id, [x, y]]) => [id, { x, y }]))]));
  const sizes = new Map([[0, [400, 200]], [1, [500, 200]], [2, [600, 200]]]);
  const baseline = stage => new Map(steps.filter(s => s.replayFrameIndex === stage)
    .map(s => [s.replayCanvasData, originals.get(s.replayCanvasData)]));
  const positions = (index, maps, direction) => {
    const step = steps[index], root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
    const visible = new Set(step.replayVisibleNodeIds);
    return new Map(layoutSyntaxTree(root, sizes.get(step.replayFrameIndex), direction, maps.get(step.replayCanvasData), visible)
      .descendants().filter(n => visible.has(getNodeId(n))).map(n => [getNodeId(n), { x: n.x, y: n.y }]));
  };
  return { steps, sizes, originals, baseline, positions };
}

for (const direction of ['ltr', 'rtl']) test(`${direction}: reservation translates the component's own geometry from first selection through attachment`, () => {
  const { steps, sizes, originals, baseline, positions } = scenario();
  const unchanged = JSON.stringify(steps), oldCoordinates = structuredClone(originals);
  const plan = reserveWorkspaceAttachments(steps, sizes, direction, baseline);
  const selection = positions(0, plan, direction), before = positions(1, plan, direction), after = positions(2, plan, direction);
  assert.deepEqual(selection.get('a'), before.get('a'), 'selection starts at its later location');
  assert.deepEqual(before.get('a'), after.get('lower'), 'old place belongs to the exact lower witness');
  assert.deepEqual(before.get('r'), after.get('r'), 'the enclosing component does not jump');
  assert.deepEqual(before.get('b'), after.get('b'), 'untouched sister stays fixed');
  assert.equal(Math.abs(after.get('b').x - after.get('lower').x), 20, 'original width survives the wider future scene');
  assert.equal(after.get('b').y - after.get('r').y, 20, 'future ranks do not stretch current branches');
  assert.deepEqual(plan.get(steps[3].replayCanvasData), originals.get(steps[3].replayCanvasData), 'a changed attachment ends reservation');
  assert.deepEqual(originals, oldCoordinates, 'baseline maps are immutable');
  assert.equal(JSON.stringify(steps), unchanged, 'visibility, records and timing are immutable');
  assert.deepEqual(reserveWorkspaceAttachments([...steps].reverse(), new Map([...sizes].reverse()), direction, baseline),
    plan, 'measurement order cannot change the plan');
});

for (const [name, options] of [
  ['changed topology', { changedChild: true }],
  ['ambiguous lower witness', { ambiguous: true }],
  ['still independent workspace', { attached: false }],
  ['ordinary construction boundary', { relation: false }]
]) test(`${name} keeps its original geometry`, () => {
  const { steps, sizes, originals, baseline } = scenario(options);
  assert.deepEqual(reserveWorkspaceAttachments(steps, sizes, 'ltr', baseline), originals);
});
