import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const leaf = (id, label, word) => ({ id, label, ...(word ? { word } : {}) });
const forest = [{ id: 'cp', label: 'CP', children: [leaf('who', 'DP', 'who'), { id: 'cbar', label: "C'", children: [
  leaf('c', 'C'), { id: 'ip', label: 'IP', children: [leaf('subject', 'NP', 'teacher'), leaf('infl', 'I', 'si')] }] }] }];
const items = relation => compileRelationRenderPlan([{ statement: '', stageRecord: '', relations: [relation], workspaceForest: forest }])
  .frames[0].items;
const connectors = relation => items(relation).filter(item => item.kind === 'directed-path')
  .map(item => [item.fromNodeId, item.toNodeId, item.label]);

// Francis approved on 27 Oct 2026 (relayed by the coordinating agent) that one feature
// label such as +wh or +hon between two dependency participants draws a dependency
// with that label on its connector.
test('one feature label between a head and its specifier draws a labelled dependency', () => {
  for (const relation of ['spec-head-agreement', 'wh-criterion', 'An unfamiliar name']) {
    assert.deepEqual(connectors({ relation, anchors: { specifier: 'who', head: 'c' }, values: { feature: '+wh' } }),
      [['c', 'who', '+wh']], relation);
  }
  assert.deepEqual(connectors({ relation: 'Spec-head honorific agreement', anchors: { controller: 'subject', target: 'infl' },
    values: { feature: '+hon' } }), [['infl', 'subject', '+hon']]);
});

test('a feature label that is prose, or competes with another, draws no dependency', () => {
  for (const values of [{ feature: 'operator binding (aL)' }, { features: 'unrelated description' }, { feature: '+wh', featureMark: '+Q' }]) {
    assert.deepEqual(connectors({ relation: 'spec-head-agreement', anchors: { specifier: 'who', head: 'c' }, values }), [], JSON.stringify(values));
  }
  assert.deepEqual(connectors({ relation: 'spec-head-agreement', anchors: { specifier: 'who', head: 'who' }, values: { feature: '+wh' } }), []);
  assert.deepEqual(connectors({ relation: 'c-selection', anchors: { selector: 'c', selectee: 'ip' }, values: { feature: '+finite' } }), []);
});
