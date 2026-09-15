import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { __test__ as parser } from '../server/babelParser.js';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { indexHierarchyNodesByIdAndAliases } from '../replay/replayCompiler.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan, planItemDependencyNodeIds } from '../replay/relations/renderPlanCompiler.ts';
import { compileLargeAnchorSets } from '../replay/relations/largeAnchorSets.ts';
import { fallbackDrawing } from '../replay/relations/fallbackTopology.ts';

const leaf = (id, word) => ({ id, label: 'D', word, children: [] });
const state = (workspaceForest, relations = []) => ({ statement: 'An authored state.', stageRecord: 'Identity control.', relations, workspaceForest });
const normalize = stages => parser.normalizeParseBundle({ derivationStages: stages }, 'minimalism', 'Mia herself', 'fixture', true).analyses[0];

test('normalization, references and inspection keep distinct whitespace-bearing IDs', () => {
  const forest = [{ id: ' root ', label: 'TP', children: [leaf('a', 'Mia'), leaf(' a ', 'herself')] }];
  const relation = { relation: 'Binding', anchors: { binder: 'a', dependent: ' a ', domain: ' root ' } };
  const stages = [state(forest, [relation]), state([{ refId: ' root ' }], [relation])];
  const result = normalize(stages);
  assert.deepEqual(result.derivationStages[1].workspaceForest[0].children.map(node => [node.id, node.word]), [['a', 'Mia'], [' a ', 'herself']]);
  assert.deepEqual(parser.inspectDerivationWorkspaces(stages, { sentence: 'Mia herself' }).map(stage => stage.diagnostics), [[], []]);
  const mismatched = structuredClone(stages);
  mismatched[1].workspaceForest[0].refId = 'root';
  assert.throws(() => normalize(mismatched), error => error.failure?.offendingValue === 'root' && /no earlier stage defines/.test(error.message));
  const duplicate = structuredClone(stages);
  duplicate[0].workspaceForest[0].children[1].id = 'a';
  assert.throws(() => normalize(duplicate), /duplicate active node id/);
});

test('relation recognition and plan dependencies require exact anchored IDs', () => {
  const forest = [{ id: ' root ', label: 'TP', children: [leaf(' a ', 'Mia'), leaf('b', 'herself')] }];
  for (const relationName of ['Binding', 'An authored dependency']) {
    const relation = { relation: relationName, anchors: { binder: ' a ', dependent: 'b', domain: ' root ' } };
    const stages = [state(forest, [relation])];
    const dispatch = dispatchRelationClaims({ relation, currentForest: forest, stageIndex: 0, relationIndex: 0 });
    assert(dispatch.claims.some(claim => claim.tier < 3));
    const plan = compileRelationRenderPlan(stages);
    assert(plan.frames[0].items.some(item => item.kind === 'binding-domain'));
    assert(plan.frames[0].items.some(item => planItemDependencyNodeIds(item).includes(' a ')));
    relation.anchors.binder = 'a';
    const mismatched = dispatchRelationClaims({ relation, currentForest: forest, stageIndex: 0, relationIndex: 0 });
    if (relationName !== 'Binding') assert(!mismatched.claims.some(claim => claim.tier < 3));
    assert(!compileRelationRenderPlan(stages).frames[0].items.some(item => item.kind === 'binding-domain'));
    assert(parser.inspectDerivationWorkspaces(stages, { sentence: 'Mia herself' })[0].diagnostics.some(issue => issue.offendingValue === 'a'));
  }
});

test('neutral and large-array participation preserve exact references without repairing mismatches', () => {
  const ids = ['a', ' a ', 'b', ' b ', 'c'];
  const relation = { relation: 'Unclassified relation', anchors: { participants: [...ids, 'c '] } };
  const forest = ids.map(id => leaf(id, 'x'));
  const { sets } = compileLargeAnchorSets([state(forest, [relation])]);
  assert.deepEqual(sets[0].roles[0].anchors.map(anchor => [anchor.nodeId, anchor.resolved]), [...ids.map(id => [id, true]), ['c ', false]]);
  const neutral = fallbackDrawing({ relation: 'Unclassified relation', anchors: { source: ' a ', target: 'a' } });
  assert.deepEqual(neutral.marks.map(mark => mark.witness), [' a ', 'a']);
});

test('D3 identity allocation and geometry lookup retain distinct exact names and ambiguous aliases', () => {
  const root = d3.hierarchy({ id: 'root', children: [{ id: 'a' }, { id: ' a ' }, { id: 'n1' }, { id: '', aliasIds: [' n2 '] }, { id: 'other', aliasIds: [' a '] }] });
  applyVizIds(root);
  assert.deepEqual(root.children.slice(0, 3).map(getNodeId), ['a', ' a ', 'n1']);
  assert.equal(getNodeId(root.children[3]), 'n2');
  const index = indexHierarchyNodesByIdAndAliases(root.descendants());
  assert.equal(index.get('a'), root.children[0]);
  assert.equal(index.get(' n2 '), root.children[3]);
  assert(!index.has(' a '), 'a genuinely shared alias remains ambiguous');
});
