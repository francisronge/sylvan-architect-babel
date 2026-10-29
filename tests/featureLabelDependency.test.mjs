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

const neutral = relation => items(relation).every(item => item.kind === 'fallback');

test('a Case claim that also carries a feature label stays a Case claim, not a labelled dependency', () => {
  // The label alone is a dependency's whole content; beside a Case literal it is not.
  assert(neutral({ relation: 'Case assignment', anchors: { specifier: 'subject', head: 'infl' },
    values: { case: 'nominative', feature: '+wh' } }));
  assert(neutral({ relation: 'Case', anchors: { head: 'infl', specifier: 'subject' }, values: { feature: '+hon', case: 'nom' } }));
});

test('only a signed feature is a label; a bare word states no feature value', () => {
  for (const feature of ['yes', 'no', 'none', 'false', 'unvalued', 'Rel', '±wh', '-']) {
    assert(neutral({ relation: 'spec-head agreement', anchors: { specifier: 'who', head: 'c' }, values: { feature } }), feature);
  }
  for (const feature of ['-wh', '−wh', '[+Q]']) {
    assert.deepEqual(connectors({ relation: 'spec-head agreement', anchors: { specifier: 'who', head: 'c' }, values: { feature } }),
      [['c', 'who', feature]], feature);
  }
  // A probe and goal already draw their connector; an unsigned label stays beside it, as before.
  const probeGoal = items({ relation: 'relAgree', anchors: { probe: 'c', goal: 'who' }, values: { feature: 'rel' } });
  assert.deepEqual(probeGoal.filter(item => item.kind === 'directed-path').map(item => item.label ?? null), [null]);
  assert(probeGoal.some(item => item.kind === 'fallback'));
});

test('a signed label is a feature only when letters follow the sign', () => {
  // On 50c09be '+1-555-0100' and '+3' drew as feature labels between a head and its specifier.
  for (const feature of ['+1-555-0100', '+3', '+3sg', '+wh+', '+wh.', '+wh:3', '[+3]', '->']) {
    assert(neutral({ relation: 'spec-head agreement', anchors: { specifier: 'who', head: 'c' }, values: { feature } }), feature);
  }
  for (const feature of ['+wh', '[+Q]', '-EPP', '+uwh']) {
    assert.deepEqual(connectors({ relation: 'spec-head agreement', anchors: { specifier: 'who', head: 'c' }, values: { feature } }),
      [['c', 'who', feature]], feature);
  }
});
