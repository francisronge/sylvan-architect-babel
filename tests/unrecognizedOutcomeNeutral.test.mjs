import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverCompoundAssignments } from '../replay/relations/compoundAssignments.ts';
import { buildTier2FacetEvidence } from '../replay/relations/relationEvidence.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { dispatchStageRelations } from '../replay/relations/tier2RelationDispatch.ts';

const leaf = (id, label, extra = {}) => ({ id, label, children: [], ...extra });
const node = (id, label, children) => ({ id, label, children });
const stage = (relation, workspaceForest) => ({ statement: 'State', stageRecord: 'Authored explanation', workspaceForest, relations: [relation] });
const drawn = (relation, workspaceForest) => {
  const s = stage(relation, workspaceForest);
  return { dispatch: dispatchStageRelations([s])[0][0], items: compileRelationRenderPlan([s]).frames[0].items };
};

// Saved run night3-20261019/runs/51-en-tough, analysis 0, stage 2. Its stage
// record says the C head's edge requirement "will attract the object operator"
// but is not satisfied in this workspace; stage 3 satisfies it by moving the
// operator. The status is pending, so it earns neither the successful
// connector it used to draw nor a failed one.
const toughForest = [node('cpCore', 'CP', [
  leaf('c', 'C[nonfinite, operator-edge]', { silent: true }),
  node('tpInf', 'TP', [leaf('to', 'T[nonfinite]', { word: 'to' }),
    node('vpAgent', 'vP', [leaf('pro', 'DP[PRO]', { silent: true }),
      node('vCore', 'vP', [leaf('v', 'v', { silent: true }),
        node('vp', 'VP', [leaf('read', 'V', { word: 'read' }), leaf('opLow', 'DP[operator]', { lineageId: 'operator', silent: true })])])])])])];
const edgeRequirement = { anchors: { goal: 'opLow', probe: 'c' }, relation: 'operator-edge requirement',
  values: { requirement: 'operator at the CP edge', status: 'unsatisfied' } };

const forest = [node('cp', 'CP', [leaf('c', 'C', { word: 'that' }), node('tp', 'TP', [
  leaf('dp', 'DP', { word: 'Mia', lineageId: 'mia' }),
  node('tbar', "T'", [leaf('t', 'T', { word: 'will' }), node('vp', 'VP', [leaf('v', 'V', { word: 'see' }), leaf('obj', 'DP', { word: 'him' })])])])])];
const agreement = { relation: 'phi agreement', anchors: { probe: 't', goal: 'dp' }, values: { features: '3sg' } };
const binding = { relation: 'pronominal binding', anchors: { binder: 'dp', bound: 'obj' }, values: {} };

test('an unrecognized status keeps the saved edge requirement neutral and visible', () => {
  const before = structuredClone(edgeRequirement);
  assert.deepEqual(buildTier2FacetEvidence({ relation: edgeRequirement, currentForest: toughForest }).values.outcome, ['unsatisfied']);
  const { dispatch, items } = drawn(edgeRequirement, toughForest);
  assert.deepEqual(dispatch.claims.map(claim => claim.tier), [3]);
  assert.deepEqual(items.map(item => [item.kind, item.claimTier]), [['fallback', 3]]);
  assert.equal(items[0].relationRef.values.status, 'unsatisfied');
  assert.deepEqual(edgeRequirement, before);

  // Without the status, or with a recognized failure, the same envelope draws.
  const { status: _, ...withoutStatus } = edgeRequirement.values;
  for (const [values, outcome] of [[withoutStatus, undefined], [{ ...withoutStatus, status: 'failed' }, 'blocked']]) {
    const paths = drawn({ ...edgeRequirement, values }, toughForest).items.filter(item => item.kind === 'directed-path');
    assert.deepEqual(paths.map(item => [item.claimTier, item.tier2FacetId, item.fromNodeId, item.toNodeId, item.outcome]),
      [[2, 'feature.dependency', 'c', 'opLow', outcome]], JSON.stringify(values));
  }
});

test('an unrecognized outcome, status or result word never draws a successful form', () => {
  for (const relation of [agreement, binding]) {
    assert(drawn(relation, forest).items.some(item => item.claimTier === 2), relation.relation);
    for (const key of ['outcome', 'status', 'result']) {
      for (const literal of ['zorked', ['zorked', 'still zorked']]) {
        const changed = { ...relation, values: { ...relation.values, [key]: literal } };
        const { dispatch, items } = drawn(changed, forest);
        assert.deepEqual(dispatch.claims.map(claim => claim.tier), [3], JSON.stringify(changed));
        assert(items.every(item => item.kind === 'fallback'), JSON.stringify(changed));
      }
    }
  }
});

test('a proven movement keeps its path beside an outcome it cannot read', () => {
  const prior = [node('tp', 'TP', [leaf('t', 'T', { word: 'will' }), node('vp', 'VP', [
    leaf('dpLow', 'DP', { word: 'Mia', lineageId: 'mia' }), leaf('v', 'V', { word: 'leave' })])])];
  const current = [node('tp', 'TP', [leaf('dp', 'DP', { word: 'Mia', lineageId: 'mia' }), node('tbar', "T'", [
    leaf('t', 'T', { word: 'will' }), node('vp', 'VP', [leaf('dpLow', 'DP', { word: 'Mia', lineageId: 'mia', silent: true }),
      leaf('v', 'V', { word: 'leave' })])])])];
  const raising = result => ({ relation: 'subject raising', anchors: { source: 'dpLow', landing: 'dp' },
    priorAnchors: { source: 'dpLow' }, values: { result } });
  const items = result => compileRelationRenderPlan([stage({ relation: 'base', anchors: {} }, prior),
    stage(raising(result), current)]).frames[1].items.filter(item => item.relationRef?.relationIndex === 0);
  assert.deepEqual(items('subject at the TP edge').filter(item => item.kind === 'trajectory')
    .map(item => [item.claimTier, item.sourceNodeId ?? item.fromNodeId, item.targetNodeId ?? item.toNodeId]), [[2, 'dpLow', 'dp']]);
  assert(items('subject at the TP edge').some(item => item.kind === 'fallback' && item.relationRef.values.result === 'subject at the TP edge'));
});

test('a verdict field keeps an unrecognized literal as its judgment', () => {
  for (const relation of [
    { relation: 'local judgment', anchors: { analysis: 'tp' }, values: { verdict: '?' } },
    { relation: 'grammaticality judgment', anchors: { analysis: 'tp' }, values: { status: 'marginal' } }
  ]) {
    const { values } = buildTier2FacetEvidence({ relation, currentForest: forest });
    assert.equal(values.outcome, undefined, relation.relation);
    assert.deepEqual(values.verdict, Object.values(relation.values), relation.relation);
  }
});

test('assignment recovery does not split an envelope whose outcome it cannot read', () => {
  const compound = [node('root', 'X', [node('left', 'X', [leaf('a', 'X'), leaf('b', 'X')]), node('right', 'X', [leaf('c', 'X'), leaf('d', 'X')])])];
  const relation = status => ({ relation: 'An open joint claim', anchors: { licensers: ['a', 'c'], caseRecipients: ['b', 'd'] },
    values: { caseRecipients: ['nominative', 'nominative'], status } });
  const scopes = status => recoverCompoundAssignments(buildTier2FacetEvidence({ relation: relation(status), currentForest: compound }));
  assert.equal(scopes('licensed').length, 2);
  assert.deepEqual(scopes('zorked'), []);
});
