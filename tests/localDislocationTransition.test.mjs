import assert from 'node:assert/strict';
import test from 'node:test';
import { __test__ } from '../server/babelParser.js';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';

const forest = [{ id: 'root', label: 'XP', children: ['a', 'b', 'c'].map(id => ({
  id, label: 'N', word: id, children: []
})) }];
const relation = name => ({ relation: name, anchors: { sequence: ['a', 'b', 'c'] },
  values: { beforeGroupSizes: ['1', '2'], afterGroupSizes: ['2', '1'] } });

test('first-stage explicit PF partitions draw the same lanes in native and open records without inventing a prior stage', () => {
  const content = [];
  for (const name of ['LocalDislocation', 'An explicit PF regrouping']) {
    const r = relation(name);
    const authored = { derivationStages: [{ statement: 'PF groups the sequence.',
      stageRecord: 'The authored PF partitions differ.', relations: [r], workspaceForest: forest }] };
    const bundle = __test__.normalizeParseBundle(authored, 'xbar', 'a b c', 'grok', true);
    const items = compileRelationRenderPlan(bundle.analyses[0].derivationStages).frames[0].items;
    const lanes = items.filter(item => item.familyId === 'pf.local-dislocation');
    assert.equal(lanes.length, 1, name);
    assert.equal(items.some(item => item.kind === 'fallback'), false, name);
    content.push(lanes[0].nativeContent);
  }
  assert.deepEqual(content, [
    { kind: 'local-dislocation', beforeGroupSizes: [1, 2], afterGroupSizes: [2, 1] },
    { kind: 'local-dislocation', beforeGroupSizes: [1, 2], afterGroupSizes: [2, 1] }
  ]);
  const facet = dispatchRelationClaims({ relation: relation('An explicit PF regrouping'), currentForest: forest,
    stageIndex: 0, relationIndex: 0 }).facets.find(facet => facet.recipe.id === 'pf.local-dislocation');
  assert(facet);
  assert.deepEqual(facet.evaluation.earnedTransitions, []);
});
