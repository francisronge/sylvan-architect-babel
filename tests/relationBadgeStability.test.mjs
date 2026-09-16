import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';

const positions = {
  objectNP: { x: 500, y: 200 },
  whichD: { x: 300, y: 400 },
  predicate: { x: 100, y: 300 }
};
const positionFor = (id) => positions[id] ?? null;
const options = { labelWidth: 150, labelHeight: 70, badgeGap: 46, connectorBaselineY: 800 };
const owner = (stageIndex, relationIndex = 0) => ({
  appearsAtStage: stageIndex,
  persistence: 'persistent',
  backward: false,
  priorWitnessNodeIds: [],
  relationRef: { stageIndex, relationIndex, relation: 'Authored claim', anchors: {} }
});
const badge = (stageIndex, relationIndex, extra = {}) => ({
  ...owner(stageIndex, relationIndex),
  kind: 'node-badges',
  badgeStyle: 'local-judgment',
  badges: [{ nodeId: 'objectNP', text: 'x', shape: 'plain' }],
  ...extra
});
const fallback = (stageIndex, relationIndex = 0) => ({
  ...owner(stageIndex, relationIndex),
  kind: 'fallback',
  drawing: {
    row: 2,
    instance: 1,
    marks: ['whichD', 'objectNP'].map((witness) => ({
      witness, frame: 'circle', position: null, instance: 1, backward: false
    })),
    link: { endpoints: ['whichD', 'objectNP'] }
  }
});
const bind = (items, markerScale = 1, provider = positionFor) =>
  bindRelationPlanFrame({ frames: [{ stageIndex: 0, items }] }, 0, provider, { ...options, markerScale });
const markFor = (bound, type, itemIndex, nodeId = 'objectNP') => {
  const result = bound.primitives.find((p) => p.type === type && p.itemIndex === itemIndex && p.nodeId === nodeId);
  assert.ok(result, `missing ${type} for item ${itemIndex} on ${nodeId}`);
  return result;
};
const offsetOf = (mark, point = positions.objectNP) => ({
  x: mark.x - point.x, y: mark.y - point.y, stackIndex: mark.stackIndex
});

test('saved Astra X-bar wh badges stay fixed when the next stage includes future native theta marks', () => {
  const saved = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/saved-qualification.json', import.meta.url)));
  const astra = saved.find((record) => record.name === 'astra-xbar');
  const plan = compileRelationRenderPlan(astra.derivationStages.slice(0, 2));
  const original = structuredClone(plan);
  const laterItems = plan.frames[1].items;
  assert.ok(laterItems.some((item) => item.kind === 'node-badges' && item.familyId === 'theta.grid'));
  const whIndex = (stage) => plan.frames[stage].items.findIndex((item) =>
    item.kind === 'fallback' && item.relationRef.stageIndex === 0);
  // A neutral fallback marks its own stage only; the next stage's native
  // theta marks therefore share no badge slots with it.
  assert.equal(whIndex(1), -1, 'stage-0 fallback marks do not persist into stage 1');
  // Hold node positions constant to isolate badge allocation, not D3 layout.
  const provider = (id) => positions[id] ?? { x: 0, y: 0 };
  for (const markerScale of [1, 3]) {
    const reference = bindRelationPlanFrame(plan, 0, provider, { ...options, markerScale });
    const before = bindRelationPlanFrame(plan, 0, provider, { ...options, markerScale });
    const after = bindRelationPlanFrame(plan, 1, provider, { ...options, markerScale });
    assert.deepEqual(before.failed, []);
    assert.deepEqual(after.failed, []);
    for (const nodeId of ['objectNP', 'whichD']) {
      assert.deepEqual(
        offsetOf(markFor(before, 'fallback-mark', whIndex(0), nodeId), positions[nodeId]),
        offsetOf(markFor(reference, 'fallback-mark', whIndex(0), nodeId), positions[nodeId])
      );
    }
    assert.equal(after.primitives.some((p) => p.type === 'fallback-mark'), false,
      'no fallback marks are drawn in the later stage');
  }
  assert.deepEqual(plan, original, 'binding cannot rewrite the relation plan');
});

const nativeBadges = [
  ['theta roles', { familyId: 'theta.grid', badgeStyle: 'theta-role' }],
  ['agreement lens', { badgeStyle: 'agreement-goal' }],
  ['idiom lens', { badgeStyle: 'idiom-chunk' }],
  ['boundary cuts', { badgeStyle: 'boundary-cut' }],
  ['ATB gap notation', { familyId: 'trajectory.across-the-board', badgeStyle: 'gap-notation' }],
  ['sideward gap notation', { familyId: 'trajectory.sideward', badgeStyle: 'gap-notation' }],
  ['anti-locality', { familyId: 'anti-locality.paths', badgeStyle: 'facilitator' }],
  ['improper movement', { familyId: 'improper-movement.landing', badgeStyle: 'improper-hosts' }],
  ['multidominance', { familyId: 'multidominance.shared-node', badgeStyle: 'shared-object' }],
  ['argument sharing', { familyId: 'argument-sharing.domains', badgeStyle: 'shared-object' }],
  ['intervention', { familyId: 'intervention.blocked-path', badgeStyle: 'intervener' }]
];
for (const [name, extra] of nativeBadges) {
  test(`${name} preserves its binding record without consuming a generic slot`, () => {
    const native = badge(0, 0, extra);
    // Earlier native marks must not consume slots either, including before
    // a second generic badge that really needs stack position 1.
    const bound = bind([native, badge(0, 1), fallback(0, 2)], 3);
    const clean = bind([badge(0, 1), fallback(0, 2)], 3);
    assert.deepEqual(bound.failed, []);
    assert.ok(markFor(bound, 'text-badge', 0), 'native scheduling still receives its binding record');
    assert.deepEqual(offsetOf(markFor(bound, 'text-badge', 1)), offsetOf(markFor(clean, 'text-badge', 0)));
    assert.deepEqual(offsetOf(markFor(bound, 'fallback-mark', 2)), offsetOf(markFor(clean, 'fallback-mark', 1)));
  });
}

test('native LF reconstruction indices do not consume generic positions', () => {
  const native = { ...owner(0), kind: 'coindex', familyId: 'lf.reconstruction', nodeIds: ['objectNP'], index: 'i' };
  const bound = bind([native, fallback(0, 1)]);
  assert.ok(markFor(bound, 'index-badge', 0));
  assert.equal(markFor(bound, 'fallback-mark', 1).stackIndex, 0);
});

for (const markerScale of [1, 3]) {
  test(`persistent badges keep their slots ahead of genuine future generic marks at scale ${markerScale}`, () => {
    const old = fallback(0);
    const future = badge(1, 1);
    const later = badge(1, 2);
    const before = bind([old], markerScale);
    // Match production's paint-layer order: text badges precede fallback.
    const entry = bind([future, later, old], markerScale);
    assert.deepEqual(offsetOf(markFor(entry, 'fallback-mark', 2)), offsetOf(markFor(before, 'fallback-mark', 0)));
    assert.deepEqual([markFor(entry, 'text-badge', 0).stackIndex, markFor(entry, 'text-badge', 1).stackIndex], [1, 2]);
    assert.equal(markFor(entry, 'text-badge', 1).x - markFor(entry, 'text-badge', 0).x, 46 * markerScale);
    assert.equal(markFor(entry, 'text-badge', 1).y, markFor(entry, 'text-badge', 0).y);
    const withFirstMomentOnly = bind([future, old], markerScale);
    assert.deepEqual(offsetOf(markFor(entry, 'text-badge', 0)), offsetOf(markFor(withFirstMomentOnly, 'text-badge', 0)));
    assert.deepEqual(entry.primitives.filter((p) => p.type !== 'segment').map((p) => p.itemIndex), [0, 1, 2, 2],
      'authored slot allocation must not change paint-layer order');
    const link = entry.primitives.find((p) => p.type === 'segment');
    assert.deepEqual(link.to, { x: positions.objectNP.x, y: positions.objectNP.y + options.labelHeight / 2 });
  });
}

test('same-stage mixed generic badges receive distinct slots in authored order', () => {
  const coindex = { ...owner(0, 2), kind: 'coindex', familyId: 'coreference.coindex', nodeIds: ['objectNP'], index: 'i' };
  const bound = bind([coindex, badge(0, 1), fallback(0, 0)]);
  assert.deepEqual([
    markFor(bound, 'fallback-mark', 2).stackIndex,
    markFor(bound, 'text-badge', 1).stackIndex,
    markFor(bound, 'index-badge', 0).stackIndex
  ], [0, 1, 2]);
});

test('parasitic-gap notation still consumes its real bound position', () => {
  const gap = badge(0, 0, { familyId: 'parasitic-gap.composition', badgeStyle: 'gap-notation' });
  const bound = bind([gap, fallback(0, 1)]);
  assert.equal(markFor(bound, 'text-badge', 0).stackIndex, 0);
  assert.equal(markFor(bound, 'fallback-mark', 1).stackIndex, 1);
});

test('a coalesced badge retains the slot of its earliest authored contributor', () => {
  const merged = { ...fallback(1), coalescedRefs: [owner(0).relationRef] };
  const bound = bind([badge(0, 1), merged]);
  assert.equal(markFor(bound, 'fallback-mark', 1).stackIndex, 0);
  assert.equal(markFor(bound, 'text-badge', 0).stackIndex, 1);
});

test('failed generic claims roll back their slots before a later valid badge binds', () => {
  const broken = {
    ...owner(0), kind: 'coindex', familyId: 'coreference.coindex',
    nodeIds: ['objectNP', 'missing'], index: 'i'
  };
  const bound = bind([badge(0, 1), broken]);
  assert.equal(markFor(bound, 'text-badge', 0).stackIndex, 0);
  assert.deepEqual(bound.failed.map(({ itemIndex, nodeId }) => ({ itemIndex, nodeId })), [{ itemIndex: 1, nodeId: 'missing' }]);
  assert.equal(bound.primitives.some((p) => p.itemIndex === 1), false);
});
