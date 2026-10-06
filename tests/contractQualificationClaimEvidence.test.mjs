import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQualificationAnalysisEvidence } from '../contractQualification/review.js';
import { compileRelationRenderPlan, planItemRelationRefs } from '../replay/relations/renderPlanCompiler.ts';

const stage = (workspaceForest, relations, realizations) => ({
  statement: 'Completed authored state.',
  stageRecord: 'The syntax and its realization are supplied by the author.',
  workspaceForest, relations,
  ...(realizations === undefined ? {} : { realizations })
});
const bundle = stages => ({
  sentence: 'wholeword', inputTokens: ['wholeword'], framework: 'xbar',
  requestedModelRoute: 'saved-test-model', requestedReasoningEffort: 'high',
  analyses: [{ derivationStages: stages, provenance: { source: 'saved-response', responseSha256: 'unchanged' } }]
});
const relationClaims = (evidence, stageIndex, relationIndex) => evidence.renderer.relations
  .find(entry => entry.stageIndex === stageIndex && entry.relationIndex === relationIndex).claims;
const pfClaim = claims => claims.find(claim => claim.facet?.id === 'pf.structured');
const pfItems = (stages, stageIndex, relationIndex) => compileRelationRenderPlan(stages).frames[stageIndex].items
  .filter(item => item.tier2FacetId === 'pf.structured' && planItemRelationRefs(item)
    .some(ref => ref.stageIndex === stageIndex && ref.relationIndex === relationIndex));
const introducedClaims = (evidence, stageIndex, relationIndex) => {
  const moments = evidence.replay.frames.filter(frame => frame.replayRelationIdentity?.stageIndex === stageIndex
    && frame.replayRelationIdentity.relationIndex === relationIndex);
  assert.equal(moments.length, 1);
  return moments[0].introducedClaims;
};

test('qualification reports exact realization groups in claims, tier counts, and their Replay moment', () => {
  const ids = ['agreement', 'aspect', 'objectAgreement', 'stem'];
  const forest = [{ id: 'host', label: 'I⁰', children: ids.map((id, index) => ({ id, label: 'X⁰', word: `part${index}` })) }];
  const relation = { relation: 'An authored word association',
    anchors: { contributors: ids, context: 'host' },
    values: { morphologicalOrder: 'The authored order.', surfaceWord: 'wholeword' } };
  for (const realizations of [
    [{ nodeIds: ids, tokenIndices: [0] }],
    [],
    [{ nodeIds: ids.slice(0, 3), tokenIndices: [0] }]
  ]) {
    const input = bundle([stage(forest, [relation], realizations)]), original = structuredClone(input);
    const evidence = buildQualificationAnalysisEvidence(input);
    assert.equal(evidence.renderer.relations[0].relation, relation.relation);
    const claims = relationClaims(evidence, 0, 0), claim = pfClaim(claims);
    const items = pfItems(input.analyses[0].derivationStages, 0, 0);
    const exactGroup = realizations[0]?.nodeIds.length === ids.length;
    assert.equal(items.length, exactGroup ? 1 : 0);
    assert.equal(Boolean(claim), exactGroup, 'reported recovery must agree with the rendered PF plate');
    assert.equal(evidence.renderer.tierCounts.tier2, exactGroup ? 1 : 0);
    assert.deepEqual(introducedClaims(evidence, 0, 0), claims);
    if (claim) {
      assert.equal(claim.tier, 2);
      assert.deepEqual(claim.facet.outputIdentities, items[0].tier2OutputIdentities);
      assert(claim.consumedEvidence.some(ref => ref.field === 'values' && ref.key === 'surfaceWord'));
      assert(claims.some(item => item.tier === 3), 'unrecovered authored context stays neutral');
    }
    assert.deepEqual(input, original, 'reporting must preserve authored input and provenance');
  }
});

test('qualification carries prior realization groups without borrowing them as current evidence', () => {
  const ids = ['oldA', 'oldB', 'newA', 'newB'];
  const forest = [{ id: 'root', label: 'XP', children: ids.map(id => ({ id, label: 'X', word: id })) }];
  const prior = stage(forest, [{ relation: 'Prior spelling', anchors: { contributors: ids.slice(0, 2) },
    values: { surfaceForm: 'wholeword' } }], [{ nodeIds: ids.slice(0, 2), tokenIndices: [0] }]);
  const current = stage(forest, [{ relation: 'Later spelling', anchors: { contributors: ids.slice(2) },
    priorAnchors: { previousContributors: ids.slice(0, 2) }, values: { surfaceForm: 'wholeword' } }],
  [{ nodeIds: ids.slice(2), tokenIndices: [0] }]);
  const input = bundle([prior, current]), original = structuredClone(input);
  const evidence = buildQualificationAnalysisEvidence(input), claims = relationClaims(evidence, 1, 0);
  const claim = pfClaim(claims), items = pfItems(input.analyses[0].derivationStages, 1, 0);
  assert(claim);
  assert.equal(items.length, 1);
  assert.deepEqual(claim.facet.outputIdentities, items[0].tier2OutputIdentities);
  assert(claim.consumedEvidence.some(ref => ref.field === 'priorAnchors' && ref.key === 'previousContributors'));
  assert.equal(claims.some(item => item.tier === 3), false, 'the proved prior group is part of the recovered claim');
  assert.deepEqual(introducedClaims(evidence, 1, 0), claims);
  assert.deepEqual(input, original);

  const absentCurrent = structuredClone(input);
  delete absentCurrent.analyses[0].derivationStages[1].realizations;
  const withoutCurrent = buildQualificationAnalysisEvidence(absentCurrent);
  assert.equal(pfClaim(relationClaims(withoutCurrent, 1, 0)), undefined);
  assert.equal(pfItems(absentCurrent.analyses[0].derivationStages, 1, 0).length, 0);
});

test('qualification shares production assignment history when later claims restate an earlier assignment', () => {
  const forest = [{ id: 'vp', label: 'VP', children: [
    { id: 'verb', label: 'V', word: 'read' }, { id: 'object', label: 'NP', word: 'books' }
  ] }];
  const stages = [
    stage(forest, [{ relation: 'ThetaAssignment', anchors: { predicate: 'verb', Theme: 'object' } }]),
    stage(forest, [{ relation: 'Restatement', anchors: { verbalChain: 'verb', thetaPosition: 'object' },
      values: { thetaPosition: 'Theme' } }])
  ];
  const input = { ...bundle(stages), sentence: 'read books', inputTokens: ['read', 'books'] };
  const original = structuredClone(input), evidence = buildQualificationAnalysisEvidence(input);
  const claims = relationClaims(evidence, 1, 0);
  assert(claims.some(claim => claim.facet?.id === 'theta-grid'));
  assert(compileRelationRenderPlan(stages).frames[1].items.some(item => item.plaqueStyle === 'theta-grid'
    && planItemRelationRefs(item).some(ref => ref.stageIndex === 1 && ref.relationIndex === 0)));
  assert.deepEqual(introducedClaims(evidence, 1, 0), claims);
  assert.deepEqual(input, original);
});
