import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchStageRelations } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';

const node = (id, children = []) => ({ id, label: 'X', children });
const forest = [node('root', [node('left', [node('a'), node('b')]), node('right', [node('c'), node('d')])])];
const stage = (relation, workspaceForest = forest) => ({ statement: 'State', stageRecord: 'Authored explanation', workspaceForest, relations: [relation] });
const facets = s => dispatchStageRelations([s])[0][0].facets;

test('explicit paired compound assignments keep both owners and one simultaneous relation moment', () => {
  for (const [source, target, literals, kind] of [
    ['predicates', 'arguments', ['Agent', 'Theme'], 'theta-grid'],
    ['thetaAssigners', 'thetaBearers', ['Agent', 'Theme'], 'theta-grid'],
    ['governors', 'caseBearers', ['objective', 'objective'], 'feature.dependency'],
    ['licensers', 'caseRecipients', ['nominative', 'nominative'], 'feature.dependency']
  ]) for (const reverse of [false, true]) {
    const order = xs => reverse ? [...xs].reverse() : xs;
    const relation = { relation: 'An open joint claim', anchors: { [source]: order(['a', 'c']), [target]: order(['b', 'd']) },
      values: { [target]: order(literals) } };
    const s = stage(relation), original = structuredClone(s), claims = facets(s);
    assert.deepEqual(claims.map(f => f.recipe.id), [kind, kind]);
    assert.equal(new Set(claims.map(f => f.facetIdentity)).size, 2);
    for (const [i, claim] of claims.entries()) {
      assert.deepEqual(claim.evaluation.consumedEvidence.find(ref => ref.key === source).itemIndices, [i]);
      assert.deepEqual(claim.evaluation.consumedEvidence.find(ref => ref.field === 'values').itemIndices, [i]);
    }
    const plan = compileRelationRenderPlan([s]);
    const marks = plan.frames[0].items.filter(item => kind === 'theta-grid' ? item.plaqueStyle === 'theta-grid' : item.pathStyle === 'case-assignment');
    assert.equal(marks.length, 2);
    const replay = prepareReplay({ sentence: '', derivationStages: [s], includePlayback: true }).playbackSteps;
    assert.equal(replay.filter(step => step.replayKind === 'relation').length, 1);
    assert.deepEqual(s, original);
  }
});

test('equal lengths, collective structure, crossed order and unpaired values cannot create assignments', () => {
  const relation = { relation: 'An open joint claim', anchors: { predicates: ['a', 'c'], arguments: ['b', 'd'] }, values: { arguments: ['Agent', 'Theme'] } };
  for (const s of [
    stage(relation, [node('root', ['a', 'b', 'c', 'd'].map(id => node(id)))]),
    stage({ ...relation, anchors: { ...relation.anchors, arguments: ['d', 'b'] } }),
    stage({ ...relation, anchors: { sources: ['a', 'c'], participants: ['b', 'd'] }, values: { participants: ['Agent', 'Theme'] } }),
    stage({ ...relation, values: { roles: ['Agent', 'Theme'] } }),
    stage({ ...relation, values: { arguments: ['Agent'] } }),
    stage({ ...relation, values: { ...relation.values, status: 'unknown' } }),
    stage({ ...relation, values: { ...relation.values, outcome: 'failed' } }),
    stage({ ...relation, relation: 'ThetaAssignment' })
  ]) assert.equal(facets(s).filter(f => f.evidence).length, 0);
});

test('structural grouping is independent of script, category names and phrase order', () => {
  for (const ids of [['動詞甲', '項甲', '動詞乙', '項乙'], ['فعل١', 'اسم١', 'فعل٢', 'اسم٢'], ['a', 'b', 'c', 'd']]) {
    const [a, b, c, d] = ids;
    const f = [node('root', [node('first', [node(b), node(a)]), node('second', [node(d), node(c)])])];
    const claims = facets(stage({ relation: '自由な名前', anchors: { theta_assigners: [a, c], 'theta bearers': [b, d] },
      values: { 'theta bearers': ['任意役割', 'دور'] } }, f));
    assert.equal(claims.length, 2);
    assert.deepEqual(claims.map(c => c.evidence.values['role.label'][0]), ['任意役割', 'دور']);
  }
});

test('Case nominals and agreement controllers need explicit supporting values and a distinct licenser', () => {
  for (const source of ['licenser', 'licensor', 'governor']) {
    const s = stage({ relation: 'Open claim', anchors: { [source]: 'a', nominal: 'b', caseExponent: 'c' }, values: { case: 'accusative' } });
    const result = dispatchStageRelations([s])[0][0];
    assert.deepEqual(result.facets.map(f => f.recipe.id), ['feature.dependency']);
    assert.deepEqual(result.evidenceCoverage.fields.find(f => f.key === 'caseExponent').unrecoveredItemIndices, [0]);
    assert.equal(facets(stage({ ...s.relations[0], values: {} })).length, 0);
  }
  const relation = { relation: 'Open agreement', anchors: { agreementController: 'b', finiteHead: 'a' },
    values: { person: 'third', number: 'singular', gender: 'feminine' } };
  const result = facets(stage(relation));
  assert.deepEqual(result.map(f => f.recipe.id), ['feature.dependency']);
  assert.equal(result[0].evaluation.consumedEvidence.filter(ref => ref.field === 'values').length, 3);
  assert.equal(facets(stage({ ...relation, anchors: { subject: 'b', head: 'a' } })).length, 0);
  assert.equal(facets(stage({ ...relation, values: {} })).length, 0);
  for (const values of [
    { ...relation.values, features: 'plural' },
    { person: ['first', 'third'], number: 'singular' },
    { person: 'third', Person: 'first' }
  ]) assert.equal(facets(stage({ ...relation, values })).length, 0, 'competing bundles or dimensions remain ambiguous');
});

test('registered theta accepts the same proven multiple assignments as an open name', () => {
  for (const name of ['ThetaAssignment', 'Theta-role assignment']) {
    const relation = { relation: name, anchors: { thetaAssigners: ['a', 'c'], thetaBearers: ['b', 'd'] },
      values: { thetaBearers: ['Agent', 'Theme'] } };
    const s = stage(relation), original = structuredClone(s);
    const result = dispatchStageRelations([s])[0][0];
    assert.equal(result.primaryClaim.tier, 1);
    assert.equal(result.facets.length, 0, 'the registered reader owns the complete claim');
    const grids = compileRelationRenderPlan([s]).frames[0].items.filter(item => item.plaqueStyle === 'theta-grid');
    assert.deepEqual(grids.map(grid => [grid.anchorNodeIds, grid.thetaRoles.map(role => [role.nodeId, role.label])]),
      [[['a'], [['b', 'Agent']]], [['c'], [['d', 'Theme']]]]);
    assert.equal(new Set(grids.map(grid => grid.tier2ClaimIdentity)).size, 2);
    assert.equal(prepareReplay({ sentence: '', derivationStages: [s], includePlayback: true }).playbackSteps
      .filter(step => step.replayKind === 'relation').length, 1);
    assert.deepEqual(s, original);
    for (const invalid of [
      stage({ ...relation, values: { thetaBearers: ['Agent'] } }),
      stage({ ...relation, anchors: { ...relation.anchors, thetaBearers: ['d', 'b'] } }),
      stage({ ...relation, values: { ...relation.values, outcome: 'failed' } }),
      stage(relation, [node('root', ['a', 'b', 'c', 'd'].map(id => node(id)))]),
      stage(relation, [node('root', [node('a'), node('b')])])
    ]) {
      const rejected = dispatchStageRelations([invalid])[0][0];
      assert.equal(rejected.primaryClaim.tier, 3);
      assert.equal(rejected.facets.length, 0, 'an incomplete registered claim is not rescued through Tier 2');
    }
  }
});
