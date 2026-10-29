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
