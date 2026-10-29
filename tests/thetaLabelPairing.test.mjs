import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const leaf = (id, label = 'DP') => ({ id, label, word: id });
const forest = [{ id: 'vp', label: 'VP', children: [leaf('subject'), { id: 'vbar', label: "V'", children: [leaf('v', 'V'),
  leaf('object'), leaf('pp', 'PP')] }] }];
const plan = relation => {
  const original = structuredClone(relation);
  const result = compileRelationRenderPlan([{ statement: 'state', stageRecord: 'record', relations: [relation], workspaceForest: forest }]);
  assert.deepEqual(relation, original, 'recognition must not rewrite the authored record');
  return result.frames.at(-1).items;
};
const grid = relation => plan(relation).find(item => item.plaqueStyle === 'theta-grid');
const rows = item => item?.thetaRoles?.map(({ nodeId, label }) => [nodeId, label]);

test('an assigner with role labels listed under its argument field draws that grid', () => {
  // The same-name list pairs by the contract; it also makes the assigner the grid's predicate.
  assert.deepEqual(rows(grid({ relation: 'UnregisteredAnalysis', anchors: { assigner: 'v', argument: ['object', 'pp'] },
    values: { argument: ['Theme', 'Source'] } })), [['object', 'Theme'], ['pp', 'Source']]);
  // An unequal list pairs nothing and stays neutral.
  assert.equal(grid({ relation: 'UnregisteredAnalysis', anchors: { assigner: 'v', argument: ['object', 'pp'] },
    values: { argument: ['Theme'] } }), undefined);
});

test('a role-label list that names each argument field pairs each label with its field', () => {
  // The literals name the fields, so the pairing is by name rather than by position.
  for (const relation of ['UnregisteredAnalysis', 'theta assignment']) {
    assert.deepEqual(rows(grid({ relation, anchors: { predicate: 'v', agent: 'subject', theme: 'object' },
      values: { roles: ['Agent', 'Theme'] } })), [['subject', 'Agent'], ['object', 'Theme']]);
    assert.deepEqual(rows(grid({ relation, anchors: { predicate: 'v', agent: 'subject', theme: 'object' },
      values: { roles: ['Theme', 'Agent'] } })), [['subject', 'Agent'], ['object', 'Theme']]);
    // Open field names earn the same pairing when the list names them.
    assert.deepEqual(rows(grid({ relation, anchors: { predicate: 'v', speaker: 'subject', content: 'object' },
      values: { roles: ['Speaker', 'Content'] } })), [['subject', 'Speaker'], ['object', 'Content']]);
    assert.deepEqual(rows(grid({ relation, anchors: { predicate: 'v', theme: 'object', source: 'pp' },
      values: { roles: ['Theme', 'Source'] } })), [['object', 'Theme'], ['pp', 'Source']]);
  }
  // A list that names no field, or one field twice, pairs nothing.
  for (const roles of [['Agent', 'Patient'], ['Agent', 'Agent'], ['Agent']]) {
    assert.equal(grid({ relation: 'UnregisteredAnalysis', anchors: { predicate: 'v', agent: 'subject', theme: 'object' },
      values: { roles } }), undefined, roles.join());
  }
  // Without an explicit predicate the list names participants of nothing.
  assert.equal(grid({ relation: 'UnregisteredAnalysis', anchors: { head: 'v', speaker: 'subject', content: 'object' },
    values: { roles: ['Speaker', 'Content'] } }), undefined);
});
