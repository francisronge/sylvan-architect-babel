import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const leaf = (id, label, word) => ({ id, label, ...(word ? { word } : {}) });
const clause = [{ id: 'cp', label: 'CP', children: [leaf('who', 'DP', 'who'), { id: 'cbar', label: "C'", children: [
  leaf('c', 'C'), { id: 'ip', label: 'IP', children: [leaf('subject', 'NP', 'teacher'), leaf('infl', 'I', 'si')] }] }] }];
const nominal = [{ id: 'np', label: 'NP', children: [leaf('a', 'A', 'big'), leaf('n', 'N', 'dog')] }];
const connectors = (relation, forest = clause) => compileRelationRenderPlan([{ statement: '', stageRecord: '', relations: [relation],
  workspaceForest: forest }]).frames[0].items.filter(item => item.kind === 'directed-path')
  .map(item => [item.fromNodeId, item.toNodeId, item.label ?? null]);

// The contract lets any values entry be one literal or a nonempty array of
// literals, so a one-item array states the same content as the literal itself.
test('a lone feature label written as a one-item array draws like the literal', () => {
  const relation = values => ({ relation: 'spec-head agreement', anchors: { specifier: 'who', head: 'c' }, values });
  assert.deepEqual(connectors(relation({ feature: '+wh' })), [['c', 'who', '+wh']]);
  assert.deepEqual(connectors(relation({ feature: ['+wh'] })), [['c', 'who', '+wh']]);
  assert.deepEqual(connectors(relation({ feature: ['+wh', '+Q'] })), []);
});

test('a phi bundle whose dimensions are one-item arrays draws like scalar dimensions', () => {
  const relation = values => ({ relation: 'spec-head agreement', anchors: { specifier: 'subject', head: 'infl' }, values });
  const scalar = connectors(relation({ person: '3', number: 'sg' }));
  assert(scalar.length > 0);
  assert.deepEqual(connectors(relation({ person: ['3'], number: ['sg'] })), scalar);
  assert.deepEqual(connectors(relation({ person: ['3', '1'], number: ['sg'] })), []);
  assert.deepEqual(connectors(relation({ person: ['none'], number: ['sg'] })), []);
});

// 4e2d1d8 read concord claims as agreement; for a directed nominal concord with
// one target written as a scalar, that reading turned the controller into a
// goal and the target into a probe, and the claim fell back to neutral.
test('a directed nominal concord keeps its controller-to-target reading for a scalar target', () => {
  for (const target of ['a', ['a']]) {
    assert.deepEqual(connectors({ relation: 'nominal concord', anchors: { controller: 'n', target }, values: { number: 'sg' } }, nominal),
      [['n', 'a', null]], JSON.stringify(target));
  }
});
