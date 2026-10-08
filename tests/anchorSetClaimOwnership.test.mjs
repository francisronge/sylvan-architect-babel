import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan, visiblePlanFrameItems } from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';

const members = ['a', 'b', 'c', 'd', 'e'];
const forest = members.map(id => ({ id, label: 'V', word: 'read' }));
const stage = relations => ({ statement: 'Test', stageRecord: 'Test', relations, workspaceForest: forest });
const forms = (value = 'past') => ({ relation: 'Current forms', anchors: { verb: members },
  values: { verbForm: members.map(() => value) } });
const sets = items => items.filter(item => item.kind === 'anchor-set');
const entries = item => item.set.roles.map(role => ({ role: role.role, roleIndex: role.roleIndex,
  entries: role.anchors.map(anchor => [anchor.nodeId, anchor.arrayIndex]) }));
const bind = (plan, index, played, active = null) => bindRelationPlanFrame({ ...plan,
  frames: plan.frames.map((frame, i) => i === index
    ? { ...frame, items: visiblePlanFrameItems(plan, i, played, active) } : frame) }, index,
  id => ({ x: members.indexOf(id) * 180, y: 0 }));

test('independently supported generic array entries share a persistent role rail', () => {
  const plan = compileRelationRenderPlan([stage([forms()]), stage([])]);
  assert.equal(sets(visiblePlanFrameItems(plan, 0, new Set())).length, 0);
  for (const [index, played] of [[0, new Set([0])], [1, new Set()]]) {
    const items = visiblePlanFrameItems(plan, index, played);
    assert.equal(items.filter(item => item.kind === 'node-plaque').length, 5);
    assert.equal(sets(items).length, 1);
    assert.deepEqual(entries(sets(items)[0]), [{ role: 'verb', roleIndex: 0, entries: members.map((id, i) => [id, i]) }]);
    const geometry = bind(plan, index, played);
    assert.deepEqual(geometry.primitives.filter(mark => mark.type === 'anchor-set-badge').map(mark => mark.numeral), [1, 2, 3, 4, 5]);
    assert.equal(geometry.primitives.filter(mark => mark.type === 'anchor-set-rail').length, 1);
    assert.deepEqual(geometry.failed, []);
  }
});

test('generic mixed roles preserve supported organization without lending its lifetime to context', () => {
  for (const reversed of [false, true]) {
    const relation = forms();
    relation.anchors = reversed ? { context: members, verb: members } : { verb: members, context: members };
    const plan = compileRelationRenderPlan([stage([relation]), stage([])]);
    const moment = visiblePlanFrameItems(plan, 0, new Set([0]), 0);
    assert.equal(sets(moment).length, 1);
    assert.deepEqual(sets(moment)[0].set.roles.map(role => role.role), Object.keys(relation.anchors));
    const active = bind(plan, 0, new Set([0]), 0);
    assert.equal(active.primitives.filter(mark => mark.type === 'anchor-set-rail').length, 2);
    assert.equal(active.primitives.filter(mark => mark.type === 'anchor-set-badge').length, 0,
      'exact context numerals are reused, so roles sharing nodes never get duplicate badges');
    for (const [index, played] of [[0, new Set([0])], [1, new Set()]]) {
      const after = visiblePlanFrameItems(plan, index, played);
      assert.equal(sets(after).length, 1);
      assert.deepEqual(sets(after)[0].set.roles.map(role => role.role), ['verb']);
      assert.equal(sets(after)[0].set.roles[0].roleIndex, reversed ? 1 : 0);
      const geometry = bind(plan, index, played);
      assert.equal(geometry.primitives.filter(mark => mark.type === 'anchor-set-rail').length, 1);
      assert.equal(geometry.primitives.filter(mark => mark.type === 'anchor-set-badge').length, 5);
      assert(!geometry.primitives.some(mark => mark.type === 'fallback-mark'));
    }
    const reversedPlan = structuredClone(plan);
    reversedPlan.frames.forEach(frame => frame.items.reverse());
    assert.deepEqual(entries(sets(visiblePlanFrameItems(reversedPlan, 0, new Set([0]), 0))[0]), entries(sets(moment)[0]),
      'claim output order cannot change array membership or ordering');
    assert.deepEqual(sets(visiblePlanFrameItems(reversedPlan, 0, new Set([0]), 0))[0].badgeEntries,
      sets(moment)[0].badgeEntries, 'badge ownership cannot depend on the first compiled output');
  }
});

test('pure Tier 3 organization expires with its owning relation, and identical names remain distinct instances', () => {
  const open = { relation: 'Open list', anchors: { members } };
  const plan = compileRelationRenderPlan([stage([open, structuredClone(open)]), stage([])]);
  for (const active of [0, 1]) {
    const items = visiblePlanFrameItems(plan, 0, new Set([0, 1]), active);
    assert.equal(sets(items).length, 1);
    assert.equal(sets(items)[0].set.relationIndex, active);
    assert.equal(sets(items)[0].set.instanceIndex, active);
    assert.equal(sets(items)[0].showBadges, false);
    const geometry = bind(plan, 0, new Set([0, 1]), active);
    assert.equal(geometry.primitives.filter(mark => mark.type === 'anchor-set-rail').length, 1);
    assert.equal(geometry.primitives.filter(mark => mark.type === 'anchor-set-badge').length, 0);
  }
  assert.equal(sets(visiblePlanFrameItems(plan, 0, new Set([0, 1]))).length, 0);
  assert.equal(sets(visiblePlanFrameItems(plan, 1, new Set())).length, 0);
});

test('organization follows the exact replacement moment of its owner without retiring independent claims', () => {
  const identity = { relation: 'OpenChorus', anchors: { occurrences: members } };
  const replacement = { ...identity, priorAnchors: identity.anchors };
  const plan = compileRelationRenderPlan([stage([identity, forms()]), stage([replacement]), stage([])]);
  const before = visiblePlanFrameItems(plan, 1, new Set());
  assert.equal(sets(before).length, 2);
  assert(before.filter(item => item.kind === 'coindex' || item.kind === 'anchor-set').every(item => item.relationRef.stageIndex === 0));
  for (const [index, played] of [[1, new Set([0])], [2, new Set()]]) {
    const items = visiblePlanFrameItems(plan, index, played);
    assert.deepEqual(items.filter(item => item.kind === 'coindex').map(item => item.relationRef.stageIndex), [1]);
    const oldSets = sets(items).filter(item => item.relationRef.stageIndex === 0);
    assert.equal(oldSets.length, 1);
    assert.equal(oldSets[0].relationRef.relationIndex, 1, 'the independent properties keep their own organization');
    const newSets = sets(items).filter(item => item.relationRef.stageIndex === 1);
    assert.equal(newSets.length, 1);
    assert.deepEqual(newSets[0].set.roles[0].anchors.map(anchor => anchor.arrayIndex), [0, 1, 2, 3, 4]);
  }
});


test('a narrow Tier 1 plaque cannot keep a rail whose own participants disappeared', () => {
  const source = { ...stage([{ relation: 'CooperStorage', anchors: { scope: 'scope', quantifiers: members },
    values: { category: 'S' } }]), workspaceForest: [{ id: 'scope', label: 'S' }, ...forest] };
  const next = { ...source, relations: [], workspaceForest: source.workspaceForest.filter(node => node.id !== 'c') };
  const plan = compileRelationRenderPlan([source, next]);
  assert.equal(sets(visiblePlanFrameItems(plan, 0, new Set([0]))).length, 1);
  const items = visiblePlanFrameItems(plan, 1, new Set());
  assert.equal(items.filter(item => item.kind === 'node-plaque').length, 1, 'the independent scope plaque still has its own witness');
  assert.equal(sets(items).length, 0, 'missing members fail the organization closed without rewriting its authored array');
});
