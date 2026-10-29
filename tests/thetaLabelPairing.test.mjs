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

test('same-name labels do not move a grid off an explicitly named predicate', () => {
  // With an explicit predicate the assigner keeps its earlier reading; the labels change nothing.
  const relation = { relation: 'UnregisteredAnalysis', anchors: { argument: ['subject'], introducer: ['v'], predicate: ['pp'] },
    values: { argument: ['Agent'] } };
  const predicates = plan(relation).filter(item => item.familyId === 'theta.grid')
    .map(item => JSON.parse(item.replacementGroup).anchors.predicate);
  assert(predicates.length > 0);
  assert(predicates.every(ids => JSON.stringify(ids) === JSON.stringify(['pp'])), JSON.stringify(predicates));
});

test('a theta-marking claim names its assigner and recipient as a theta grid', () => {
  // Francis approved theta-marking as a theta relation name on 27 Oct 2026.
  for (const relation of ['theta-marking', 'external theta-marking', 'internal-theta-marking']) {
    for (const recipient of ['recipient', 'assignee']) {
      assert.deepEqual(rows(grid({ relation, anchors: { assigner: 'v', [recipient]: 'object' }, values: { role: 'Theme' } })),
        [['object', 'Theme']], `${relation} ${recipient}`);
    }
  }
  // The name alone does not supply a role, and other markings stay neutral.
  assert.equal(grid({ relation: 'theta-marking', anchors: { assigner: 'v', recipient: 'object' } }), undefined);
  assert.equal(grid({ relation: 'case marking', anchors: { assigner: 'v', recipient: 'object' }, values: { role: 'Theme' } }), undefined);
});

test('a same-name Case value is not a role label', () => {
  // On main this drew the Case path alone; the value must not also become a theta grid.
  const relation = { relation: 'UnregisteredAnalysis', anchors: { assigner: 'v', argument: 'object' }, values: { argument: 'accusative' } };
  assert.equal(grid(relation), undefined);
  assert.deepEqual(plan(relation).filter(item => item.kind === 'directed-path').map(item => [item.fromNodeId, item.toNodeId, item.label]),
    [['v', 'object', 'accusative']]);
  // A Case abbreviation, a mixed list and a value no thematic role names pair nothing as roles.
  for (const values of [{ argument: 'ACC' }, { argument: 'partitive' }]) {
    assert.equal(grid({ ...relation, values }), undefined, JSON.stringify(values));
  }
  assert.equal(grid({ relation: 'UnregisteredAnalysis', anchors: { assigner: 'v', argument: ['object', 'pp'] },
    values: { argument: ['Theme', 'accusative'] } }), undefined);
});

test('a field the role list and its own entry label differently stays neutral', () => {
  const relation = { relation: 'theta assignment', anchors: { predicate: 'v', agent: 'subject', theme: 'object' },
    values: { roles: ['Agent', 'Theme'], theme: 'Patient' } };
  assert(plan(relation).every(item => item.kind === 'fallback'));
  // Two labels that agree are one label.
  assert.deepEqual(rows(grid({ ...relation, values: { roles: ['Agent', 'Theme'], theme: 'Theme' } })),
    [['subject', 'Agent'], ['object', 'Theme']]);
});
