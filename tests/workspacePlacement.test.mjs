import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { reserveWorkspaceAttachments } from '../replay/workspacePlacement.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { paintedShift } from '../replay/cameraCarry.ts';

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
  // Whether a node holds its place into step `index`: at the same coordinates,
  // or across a stage crossing carried with the rest of the tree (each stage
  // lays out its own coordinates, and the camera carries the shared syntax).
  const stillInto = (index, maps, direction, id) => {
    const painted = at => {
      const step = steps[at], root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
      const visible = new Set(step.replayVisibleNodeIds);
      const nodes = layoutSyntaxTree(root, sizes.get(step.replayFrameIndex), direction, maps.get(step.replayCanvasData), visible)
        .descendants().filter(n => visible.has(getNodeId(n)));
      return new Map(nodes.map(n => [getNodeId(n), { x: n.x, y: n.y,
        parentId: n.parent && visible.has(getNodeId(n.parent)) ? getNodeId(n.parent) : null }]));
    };
    const before = painted(index - 1), after = painted(index);
    const moved = carry => Math.hypot(after.get(id).x - carry.x - before.get(id).x, after.get(id).y - carry.y - before.get(id).y);
    return moved({ x: 0, y: 0 }) <= 1e-6 || (steps[index - 1].replayFrameIndex !== steps[index].replayFrameIndex
      && moved(paintedShift(before, after)) <= 1e-6);
  };
  return { steps, sizes, originals, baseline, positions, stillInto };
}

for (const direction of ['ltr', 'rtl']) test(`${direction}: reservation translates the component's own geometry from first selection through attachment`, () => {
  const { steps, sizes, originals, baseline, positions, stillInto } = scenario();
  const unchanged = JSON.stringify(steps), oldCoordinates = structuredClone(originals);
  const plan = reserveWorkspaceAttachments({ steps, sizes, direction, coordinatesForStage: baseline });
  const selection = positions(0, plan, direction), before = positions(1, plan, direction), after = positions(2, plan, direction);
  assert.deepEqual(selection.get('a'), before.get('a'), 'selection starts at its later location');
  assert.deepEqual(before.get('a'), after.get('lower'), 'old place belongs to the exact lower witness');
  assert.deepEqual(before.get('r'), after.get('r'), 'the enclosing component does not jump');
  assert.deepEqual(before.get('b'), after.get('b'), 'untouched sister stays fixed');
  assert.equal(Math.abs(after.get('b').x - after.get('lower').x), 20, 'original width survives the wider future scene');
  assert.equal(after.get('b').y - after.get('r').y, 20, 'future ranks do not stretch current branches');
  const attachmentPoints = points => new Map([...points].filter(([id]) => id !== 'loose'));
  assert.deepEqual(attachmentPoints(plan.get(steps[3].replayCanvasData)),
    attachmentPoints(originals.get(steps[3].replayCanvasData)), 'a changed attachment ends its component reservation');
  for (let index = 1; index < steps.length; index++) {
    assert.ok(stillInto(index, plan, direction, 'loose'),
      'the separate unchanged workspace remains fixed throughout its lifetime');
  }
  assert.deepEqual(originals, oldCoordinates, 'baseline maps are immutable');
  assert.equal(JSON.stringify(steps), unchanged, 'visibility, records and timing are immutable');
  assert.deepEqual(reserveWorkspaceAttachments({ steps: [...steps].reverse(), sizes: new Map([...sizes].reverse()), direction, coordinatesForStage: baseline }),
    plan, 'measurement order cannot change the plan');
});

for (const [name, options] of [
  ['changed topology', { changedChild: true }],
  ['ambiguous lower witness', { ambiguous: true }],
  ['still independent workspace', { attached: false }],
  ['ordinary construction boundary', { relation: false }]
]) test(`${name} rejects attachment reservation while keeping the independent workspace stable`, () => {
  const { steps, sizes, originals, baseline, positions, stillInto } = scenario(options);
  const originalSteps = JSON.stringify(steps), originalCoordinates = structuredClone(originals);
  const plan = reserveWorkspaceAttachments({ steps, sizes, direction: 'ltr', coordinatesForStage: baseline });
  const before = positions(1, plan, 'ltr'), after = positions(2, plan, 'ltr');
  const separate = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) > 1e-6;
  // Rejecting this correspondence must not prevent the general planner from
  // repairing unrelated motion elsewhere in the same synthetic sequence.
  assert(separate(before.get('a'), after.get('lower')), 'an invalid pairing cannot inherit the source slot');
  if (options.ambiguous) assert(separate(before.get('a'), after.get('b')), 'neither ambiguous witness inherits the source slot');
  if (options.changedChild) assert.deepEqual(before.get('a'), after.get('a'), 'the surviving source stays fixed');
  if (options.attached === false) assert.deepEqual(before.get('b'), after.get('b'), 'the unchanged sister stays fixed');
  if (options.ambiguous || options.relation === false) {
    for (const [canvas, coordinates] of originals) {
      for (const [id, point] of coordinates) if (id !== 'loose') {
        assert.deepEqual(plan.get(canvas).get(id), point, `${name}: ${id} does not receive an attachment reservation`);
      }
    }
  }
  for (let index = 1; index < steps.length; index++) {
    assert.ok(stillInto(index, plan, 'ltr', 'loose'),
      'unrelated selection and topology changes cannot teleport the independent workspace');
  }
  assert.deepEqual(originals, originalCoordinates);
  assert.equal(JSON.stringify(steps), originalSteps);
});
