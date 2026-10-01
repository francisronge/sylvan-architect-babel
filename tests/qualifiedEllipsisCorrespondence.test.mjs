import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const leaf = (id, word, silent = false) => ({ id, label: 'V', word, children: [], ...(silent ? { silent: true } : {}) });
const forest = [
  { id: 'antecedent', label: 'VP', children: [leaf('firstV', 'read')] },
  { id: 'site', label: 'VP', silent: true, children: [leaf('secondV', 'read', true)] },
  { id: 'licensor', label: 'I', children: [], word: 'did' }
];
const relation = (changes = {}) => ({ relation: 'VP-ellipsis licensing',
  anchors: { antecedentVP: 'antecedent', elidedVP: 'site', licensor: 'licensor' }, ...changes });
const dispatch = (r, currentForest = forest) => dispatchRelationClaims({ relation: r, currentForest, stageIndex: 0, relationIndex: 0 });
const alignments = result => result.facets.filter(facet => facet.recipe.id === 'correspondence.alignment');
const items = r => compileRelationRenderPlan([{ statement: 'Ellipsis', stageRecord: 'Authored state',
  workspaceForest: forest, relations: [r] }]).frames[0].items;

test('qualified antecedent and elided domain share the existing correspondence curve and exact ownership', () => {
  const r = relation(), original = structuredClone(r), result = dispatch(r);
  assert.equal(alignments(result).length, 1);
  assert.deepEqual(alignments(result)[0].evaluation.consumedEvidence, [
    { field: 'anchors', key: 'antecedentVP', itemIndices: [0] },
    { field: 'anchors', key: 'elidedVP', itemIndices: [0] }
  ]);
  const marks = items(r), curve = marks.filter(item => item.tier2FacetId === 'correspondence.alignment');
  assert.equal(curve.length, 1);
  assert.deepEqual(curve[0].pairs, [{ fromNodeId: 'antecedent', toNodeId: 'site' }]);
  assert(marks.some(item => item.tier2FacetId === 'ellipsis.site'));
  assert.deepEqual(marks.find(item => item.kind === 'fallback').relationRef.anchors, { licensor: 'licensor' });
  assert(!marks.some(item => item.kind === 'directed-path' || item.tier2FacetId === 'deletion.site'));
  assert.deepEqual(r, original);
});

test('an overt identity source and explicit deleted domain retain source direction and contextual fields', () => {
  const r = relation({ relation: 'Right-node-raising PF deletion', anchors: {
    deletedDomain: 'site', licensingCoordination: 'licensor', overtIdentitySource: 'antecedent'
  }, priorAnchors: { domainBeforeDeletion: 'site' }, values: { direction: 'backward deletion' } });
  const marks = items(r), curve = marks.find(item => item.tier2FacetId === 'correspondence.alignment');
  assert.deepEqual(curve.pairs, [{ fromNodeId: 'antecedent', toNodeId: 'site' }]);
  assert.deepEqual(marks.find(item => item.kind === 'fallback').relationRef.values, { direction: 'backward deletion' });
  assert.deepEqual(marks.find(item => item.kind === 'fallback').relationRef.priorAnchors, { domainBeforeDeletion: 'site' });
});

test('the correspondence does not invent silence or borrow an arbitrary relation title', () => {
  const overt = structuredClone(forest);
  delete overt[1].silent; delete overt[1].children[0].silent;
  const result = dispatch(relation(), overt);
  assert.equal(alignments(result).length, 1);
  assert(!result.facets.some(facet => facet.recipe.id === 'ellipsis.site'));
  for (const label of ['An authored relation', 'antecedent government', 'discussion of VP ellipsis',
    'possible VP ellipsis licensing', 'No VP ellipsis licensing', 'VP ellipsis licensing is pending',
    'whether VP ellipsis licensing', 'failed VP ellipsis licensing; VP ellipsis licensing'])
    assert.equal(alignments(dispatch(relation({ relation: label }))).length, 0, label);
  assert.equal(alignments(dispatch(relation({ relation: 'failed agreement; VP ellipsis licensing' }))).length, 1);
  for (const outcome of ['failed', 'pending', 'unknown', 'blocked'])
    assert.equal(alignments(dispatch(relation({ values: { outcome } }))).length, 0, outcome);
});

test('missing, repeated, competing, or list endpoints cannot manufacture an alignment', () => {
  for (const anchors of [
    { antecedentVP: 'antecedent', elidedVP: 'missing' },
    { antecedentVP: 'site', elidedVP: 'site' },
    { antecedentVP: ['antecedent', 'licensor'], elidedVP: ['site', 'secondV'] },
    { antecedentVP: 'antecedent', elidedVP: 'site', antecedentNP: 'licensor' },
    { antecedentVP: 'antecedent', elidedVP: 'site', deletedDomain: 'secondV' },
    { possibleAntecedentVP: 'antecedent', elidedVP: 'site' },
    { antecedentVP: 'antecedent', possibleElidedVP: 'site' },
    { participant: 'antecedent', elidedVP: 'site' }
  ]) assert.equal(alignments(dispatch(relation({ anchors }))).length, 0, JSON.stringify(anchors));
  assert.equal(alignments(dispatch(relation(), [...forest, leaf('antecedent', 'read')])).length, 0);
});

test('already recovered exact endpoints are drawn once', () => {
  const result = dispatch(relation({ anchors: { antecedentDomain: 'antecedent', ellipsisDomain: 'site' } }));
  assert.equal(alignments(result).length, 1);
});

test('malformed exact Tier 1 gapping is not repaired through qualified ellipsis anchors', () => {
  const result = dispatch(relation({ relation: 'Gapping' }));
  assert.equal(result.primaryClaim.tier, 3);
  assert.equal(alignments(result).length, 0);
});
