import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const low = { id: 'low', label: 'DP', word: 'every book', lineageId: 'quantifier' };
const high = { ...low, id: 'high', silent: true };
const body = { id: 'body', label: 'TP', children: [{ id: 'verb', label: 'V', word: 'read' }, low] };
const tree = [{ id: 'root', label: 'TP', children: [high, body] }, { id: 'other', label: 'TP' }];
const draw = relation => compileRelationRenderPlan([
  { statement: '', stageRecord: '', workspaceForest: [body], relations: [] },
  { statement: '', stageRecord: '', workspaceForest: tree, relations: [relation] }
]).frames[1].items.filter(item => item.kind === 'quantifier-raising');

test('recovered QR boxes the named scope body, matching Orchard with its landing outside that body', () => {
  const native = draw({ relation: 'QuantifierRaising', anchors: { pronouncedQP: 'low', lfQP: 'high', scopeDomain: 'body' } });
  const shape = ({ kind, pronouncedNodeId, lfNodeId, scopeDomainNodeId, index }) =>
    ({ kind, pronouncedNodeId, lfNodeId, scopeDomainNodeId, index });
  assert.equal(native.length, 1);
  for (const role of ['scopeDomain', 'scopeHost', 'adjunctionDomain']) {
    const recovered = draw({ relation: 'covert object Internal Merge',
      anchors: { higherOccurrence: 'high', lowerOccurrence: 'low', [role]: 'body' },
      values: { motivation: 'inverse quantifier scope' } });
    assert.equal(recovered.length, 1);
    assert.deepEqual(shape(recovered[0]), shape(native[0]));
    assert.equal(recovered[0].claimTier, 2);
  }
});

test('a QR scope box is optional, but a supplied domain must contain the lower occurrence', () => {
  const relation = { relation: 'covert object Internal Merge',
    anchors: { higherOccurrence: 'high', lowerOccurrence: 'low' }, values: { motivation: 'inverse quantifier scope' } };
  assert.equal(draw(relation)[0].scopeDomainNodeId, undefined);
  for (const role of ['scopeDomain', 'adjunctionDomain'])
    for (const scopeDomain of ['high', 'other', 'missing']) {
      const items = draw({ ...relation, anchors: { ...relation.anchors, [role]: scopeDomain } });
      assert(!items.some(item => item.scopeDomainNodeId === scopeDomain));
    }
  assert.equal(draw({ ...relation, anchors: { ...relation.anchors, scopeDomain: 'root' } })[0].scopeDomainNodeId, 'root');
});

test('a contained operator corroborates one QR trajectory without adding an ordinary duplicate', () => {
  const source = { id: 'low', label: 'DP', lineageId: 'quantifier', children: [{ id: 'operatorLow', label: 'D', lineageId: 'operator', word: 'a' }] };
  const prior = [{ id: 'body', label: 'TP', children: [source] }];
  const current = [{ id: 'root', label: 'TP', children: [
    { id: 'high', label: 'DP', lineageId: 'quantifier', children: [{ id: 'operatorHigh', label: 'D', lineageId: 'operator', word: 'a' }] },
    { id: 'body', label: 'TP', children: [structuredClone(source)] }
  ] }];
  const items = compileRelationRenderPlan([
    { statement: '', stageRecord: '', workspaceForest: prior, relations: [] },
    { statement: '', stageRecord: '', workspaceForest: current, relations: [{ relation: 'covert object Internal Merge',
      anchors: { higherOccurrence: 'high', lowerOccurrence: 'low', operator: 'operatorHigh', scopeDomain: 'body' }, priorAnchors: { source: 'low' } }] }
  ]).frames[1].items;
  assert.equal(items.filter(item => item.kind === 'quantifier-raising').length, 1);
  assert.equal(items.filter(item => item.kind === 'trajectory').length, 0);
});
