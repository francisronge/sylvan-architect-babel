import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { visiblePlanFrameItems } from '../replay/relations/relationFrame.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { planItemRelationRefs } from '../replay/relations/renderPlan.ts';

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

// Francis, 27 Oct 2026, on Sol n4-02's rail vanishing after one frame: "Why does
// the rail disappear after one frame???" The rail is a designed drawing, so it
// persists even when its claim draws nothing but neutral marks.
const others = ['f', 'g', 'h', 'i', 'j'];
const wideForest = [...members, ...others, 'z'].map(id => ({ id, label: 'V', word: 'read' }));
const wideStage = relations => ({ ...stage(relations), workspaceForest: wideForest });
const railView = (plan, index, played, active = null) => {
  const items = visiblePlanFrameItems(plan, index, played, active);
  const geometry = bindRelationPlanFrame({ ...plan, frames: plan.frames.map((frame, i) => i === index
    ? { ...frame, items } : frame) }, index, id => ({ x: wideForest.findIndex(node => node.id === id) * 180, y: 0 }));
  const badges = geometry.primitives.filter(mark => mark.type === 'anchor-set-badge');
  return {
    sets: sets(items),
    rails: geometry.primitives.filter(mark => mark.type === 'anchor-set-rail')
      .map(({ x1, x2, y, lane }) => ({ x1, x2, y, lane })),
    badges: badges.map(({ nodeId, x, y, numeral, stackIndex }) => ({ nodeId, x, y, numeral, stackIndex })),
    badgedNodes: badges.map(badge => badge.nodeId)
  };
};
const open = (anchors, relation = 'Open list') => ({ relation, anchors });

test('a pure Tier 3 rail is fixed from its own moment on and persists after it', () => {
  const plan = compileRelationRenderPlan([wideStage([open({ members }), { relation: 'Other note', anchors: { thing: 'z' } }]),
    wideStage([])]);
  assert.equal(sets(visiblePlanFrameItems(plan, 0, new Set())).length, 0, 'nothing before its moment');
  const own = railView(plan, 0, new Set([0]), 0);
  assert.equal(own.rails.length, 1);
  assert.deepEqual(own.badges.map(badge => badge.numeral), [1, 2, 3, 4, 5],
    'its own moment already numbers its entries, as a recognized rail does');
  for (const [label, later] of [['next relation moment', railView(plan, 0, new Set([0, 1]), 1)],
    ['later stage', railView(plan, 1, new Set())]]) {
    assert.deepEqual(later.rails, own.rails, `${label}: the rail does not move at a moment it does not own`);
    assert.deepEqual(later.badges, own.badges, `${label}: no numeral appears or moves after its moment`);
  }
});

test('a pure Tier 3 rail takes its identity from its entries, never from relation or role names', () => {
  const entries = view => view.sets.map(item => `${item.set.stageIndex}:${item.set.roles.flatMap(role =>
    role.anchors.map(anchor => anchor.nodeId)).join('')}`).sort();
  const unique = view => assert.equal(new Set(view.badgedNodes).size, view.badgedNodes.length,
    'no node carries two numerals');
  const different = compileRelationRenderPlan([wideStage([open({ members })]), wideStage([open({ members: others })]), wideStage([])]);
  assert.deepEqual(entries(railView(different, 2, new Set())), ['0:abcde', '1:fghij'],
    'a later rail over different entries is an independent claim');
  const renamed = compileRelationRenderPlan([wideStage([open({ members })]),
    wideStage([open({ items: members }, 'Open list (restated)')]), wideStage([])]);
  assert.deepEqual(entries(railView(renamed, 1, new Set())), ['0:abcde'], 'the earlier rail stands until the restatement');
  for (const view of [railView(renamed, 1, new Set([0]), 0), railView(renamed, 2, new Set())]) {
    assert.deepEqual(entries(view), ['1:abcde'], 'a restatement over the same entries replaces the earlier rail');
    unique(view);
  }
  const repeated = compileRelationRenderPlan([wideStage([open({ members }), open({ members })]), wideStage([])]);
  const first = railView(repeated, 0, new Set([0]), 0);
  for (const view of [railView(repeated, 0, new Set([0, 1]), 1), railView(repeated, 1, new Set())]) {
    assert.equal(view.rails.length, 1, 'identical restatements in one stage share one rail');
    assert.deepEqual(view.badges, first.badges);
    unique(view);
  }
  const shared = sets(visiblePlanFrameItems(repeated, 0, new Set([0, 1]), 1))[0];
  assert.deepEqual(planItemRelationRefs(shared).map(ref => ref.relationIndex).sort(), [0, 1],
    'the shared rail keeps both authored moments');
});

test('a malformed exact claim keeps only neutral ink beside its persisting rail', () => {
  // Sol n4-02's shape: a registered name whose parallel arrays fail its signature.
  const theta = { relation: 'theta-role assignment', anchors: { predicates: members, arguments: others } };
  const plan = compileRelationRenderPlan([wideStage([theta]), wideStage([])]);
  assert.ok(plan.diagnostics.some(d => d.kind === 'signature-incomplete'), 'the exact claim stays malformed');
  const kinds = items => items.map(item => `${item.kind}:T${item.claimTier}`).sort();
  assert.deepEqual(kinds(visiblePlanFrameItems(plan, 0, new Set([0]), 0)), ['anchor-set:T3', 'fallback:T3'],
    'Tier 1 and Tier 2 draw nothing for it');
  assert.deepEqual(kinds(visiblePlanFrameItems(plan, 1, new Set())), ['anchor-set:T3'],
    'its neutral labels expire; only the organization of its authored arrays persists');
  const own = railView(plan, 0, new Set([0]), 0), later = railView(plan, 1, new Set());
  assert.equal(own.rails.length, 2);
  assert.equal(own.badges.length, 10);
  assert.deepEqual([later.rails, later.badges], [own.rails, own.badges]);
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
