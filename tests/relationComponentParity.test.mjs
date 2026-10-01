import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
const leaf = (id, extra = {}) => ({ id, label: 'DP', word: id, ...extra });
const forest = [{ id: 'root', label: 'TP', children: [leaf('a'), { id: 'body', label: 'TP', children: [leaf('b'), leaf('c')] }] }];
const stage = (relations, workspaceForest = forest) => ({ statement: '', stageRecord: '', relations, workspaceForest });
const compile = relations => compileRelationRenderPlan([stage(relations)]);
const point = id => ({ x: ['root', 'a', 'body', 'b', 'c'].indexOf(id) * 180, y: id === 'root' ? 0 : id === 'body' ? 100 : 200 });
const paint = plan => bindRelationPlanFrame(plan, 0, point).primitives;

test('complete recovered control has the same domain, connector and two indices as Tier 1', () => {
  const anchors = { controller: 'a', controllee: 'b', domain: 'body' };
  const native = compile([{ relation: 'Control', anchors }]);
  const recovered = compile([{ relation: 'obligatory subject control', anchors }]);
  assert.deepEqual(paint(recovered), paint(native));
  const coindex = recovered.frames[0].items.find(i => i.familyId === 'control.dependency' && i.kind === 'coindex');
  assert.deepEqual(coindex.nodeIds, ['a', 'b']);
  assert.equal(coindex.index, 'i');
  assert.equal(coindex.claimTier, 2);
});

test('control retains explicit indices and does not invent an unprovided domain', () => {
  const items = compile([{ relation: 'obligatory subject control', anchors: { controller: 'a', controlledSubject: 'b' }, values: { index: 'k' } }]).frames[0].items;
  assert.equal(items.find(i => i.kind === 'coindex').index, 'k');
  assert(!items.some(i => i.domainStyle === 'control-domain'));
  assert.equal(items.filter(i => i.kind === 'directed-path').length, 1);
});

test('mixed native and recovered control uses one stable dependency-index allocation', () => {
  const relations = ['Control', 'obligatory subject control'].map((relation, i) => ({ relation,
    anchors: { controller: 'a', controllee: i ? 'c' : 'b', domain: 'body' } }));
  const plan = compileRelationRenderPlan([stage(relations), stage([{ ...relations[1], values: { index: 'j' } }])]);
  const indices = plan.frames[0].items.filter(i => i.kind === 'coindex' && i.familyId === 'control.dependency');
  assert.deepEqual(indices.map(i => i.index), ['i', 'j']);
  assert.equal(plan.frames[1].items.filter(i => i.kind === 'coindex' && i.familyId === 'control.dependency').at(-1).index, 'j');
});

test('recovered phase arcs share Tier-1 primary and secondary geometry', () => {
  const native = compile(['body', 'root'].map(phase => ({ relation: 'Phase', anchors: { phase } })));
  const recovered = compile(['body', 'root'].map(phase => ({ relation: 'phase membership', anchors: { phase } })));
  assert(recovered.frames[0].items.every(i => i.claimTier === 2));
  assert.deepEqual(paint(recovered), paint(native));
  assert.deepEqual(recovered.frames[0].items.filter(i => i.domainStyle === 'phase').map(i => i.phasePrimary), [true, false]);
  const mixed = compile([{ relation: 'Phase', anchors: { phase: 'body' } }, { relation: 'phase membership', anchors: { phase: 'root' } }]);
  assert.deepEqual(paint(mixed), paint(native));
  const withEdge = name => compile([{ relation: name, anchors: { phase: 'body', edge: 'b' } }]);
  const recoveredWithEdge = withEdge('phase membership');
  assert.equal(recoveredWithEdge.frames[0].items.filter(i => i.domainStyle === 'transfer-edge').length, 1,
    'the independently recovered edge outline remains visible');
});

test('intervention preserves the same attempted path and blocker as Tier 1', () => {
  const anchors = { probe: 'a', intervener: 'b', target: 'c' }, values = { outcome: 'blocked' };
  const native = compile([{ relation: 'Intervention', anchors, values }]);
  const recovered = compile([{ relation: 'interrogative intervention', anchors, values }]);
  assert.deepEqual(paint(recovered), paint(native));
  assert.equal(recovered.frames[0].items.filter(i => i.badgeStyle === 'intervener').length, 1);
  const independent = compile([{ relation: 'interrogative intervention', anchors: { probe: 'a', intendedGoal: 'c', intervener: 'b', judgedAnchor: 'root' }, values }]);
  assert(independent.frames[0].items.some(i => i.badgeStyle === 'local-judgment'), 'a separately anchored judgment survives');
});

test('the shared modifier fork does not change native PairMerge branches', () => {
  const native = compile([{ relation: 'PairMerge', anchors: { pairMember: 'b', host: 'c' } }]);
  const recovered = compile([{ relation: 'relative-clause restriction', anchors: { modifier: 'b', nominalHead: 'c' } }]);
  assert.deepEqual(paint(recovered), paint(native));
});

test('different recovered QR dependencies do not reuse the same index', () => {
  const low = n => leaf('low'+n, { lineageId: 'q'+n });
  const high = n => leaf('high'+n, { lineageId: 'q'+n, silent: true });
  const prior = [{ id: 'body', label: 'TP', children: [low(1), low(2)] }];
  const current = [{ id: 'outer', label: 'TP', children: [high(1), high(2), ...prior] }];
  const draw = native => compileRelationRenderPlan([stage([], prior), stage([1, 2].map(n => native
    ? { relation: 'QuantifierRaising', anchors: { pronouncedQP: 'low'+n, lfQP: 'high'+n, scopeDomain: 'body' } }
    : { relation: 'covert object Internal Merge', anchors: { lowerOccurrence: 'low'+n, higherOccurrence: 'high'+n, scopeHost: 'body' }, values: { motivation: 'inverse quantifier scope' } }), current)]);
  const items = p => p.frames[1].items.filter(i => i.kind === 'quantifier-raising');
  assert.deepEqual(items(draw(false)).map(i => i.index), ['i', 'j']);
  assert.deepEqual(items(draw(false)).map(i => [i.pronouncedNodeId, i.lfNodeId, i.scopeDomainNodeId, i.index]),
    items(draw(true)).map(i => [i.pronouncedNodeId, i.lfNodeId, i.scopeDomainNodeId, i.index]));
});
