import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const forest = [{ id: 'clause', label: 'XP', children: [
  { id: 'nominal', label: 'NP', children: [{ id: 'noun', label: 'N', word: 'book' }] },
  { id: 'adjective', label: 'A', word: 'new' },
  { id: 'other', label: 'T', word: 'is' }
] }];
const dispatch = relation => dispatchRelationClaims({ relation, currentForest: forest, stageIndex: 0, relationIndex: 0 });
const dependencies = relation => dispatch(relation).claims.filter(claim => claim.tier === 2 && claim.facet.recipe.id === 'feature.dependency');
const plan = relation => compileRelationRenderPlan([{ statement: '', stageRecord: '', workspaceForest: forest, relations: [relation] }]).frames[0].items;

for (const [host, name, valueKey] of [['modifier', 'Attributive agreement', 'features'], ['predicate', 'Predicative agreement', 'sharedFeatures']]) {
  test(`explicit ${name} binds its exact controller and ${host}`, () => {
    const relation = { relation: name, anchors: { controller: 'noun', [host]: 'adjective' },
      values: { [valueKey]: ['Masculine', 'Singular', 'Indefinite', 'Accusative'], interpretation: 'Authored context' } };
    const original = structuredClone(relation);
    for (const anchors of [relation.anchors, Object.fromEntries(Object.entries(relation.anchors).reverse())]) {
      const input = { ...relation, anchors }, claims = dependencies(input);
      assert.equal(claims.length, 1);
      assert.deepEqual(dispatch(input).evidence.currentAnchors['feature.source'], ['adjective']);
      assert.deepEqual(dispatch(input).evidence.currentAnchors['feature.target'], ['noun']);
      const items = plan(input), paths = items.filter(item => item.kind === 'directed-path');
      assert.equal(paths.length, 4);
      assert(paths.every(item => item.fromNodeId === 'adjective' && item.toNodeId === 'noun'));
      assert.deepEqual(paths.map(item => item.featureRow.value), relation.values[valueKey]);
      assert(!items.some(item => item.pathStyle === 'case-assignment'), 'a Case-named feature is not a separate assignment');
      assert(dispatch(input).evidenceCoverage.fields.find(field => field.key === 'interpretation').unrecoveredItemIndices.length);
    }
    assert.deepEqual(relation, original);
  });

  test(`${name} never supplies missing values, chooses ambiguous endpoints, or repairs an exact claim`, () => {
    const relation = { relation: name, anchors: { controller: 'noun', [host]: 'adjective' }, values: { features: 'plural' } };
    for (const mutate of [
      r => { r.relation = 'A description'; },
      r => { r.relation = `possible ${name}`; },
      r => { r.values = {}; },
      r => { r.anchors.controller = 'missing'; },
      r => { r.anchors.controller = ['noun', 'nominal']; },
      r => { r.anchors[host] = ['adjective', 'other']; },
      r => { r.anchors[host] = 'noun'; },
      r => { r.anchors[host] = 'missing'; },
      r => { r.anchors[host === 'modifier' ? 'predicate' : 'modifier'] = 'other'; },
      r => { r.anchors.agreementMediator = 'other'; },
      r => { r.anchors.controllee = 'other'; },
      r => { r.anchors.probe = 'other'; },
      r => { r.relation = 'Agree'; }
    ]) {
      const changed = structuredClone(relation); mutate(changed);
      assert.equal(dependencies(changed).length, 0, JSON.stringify(changed));
    }
  });
}

test('an explicitly named target retains precedence over a descriptive predicate', () => {
  const relation = { relation: 'subject agreement', anchors: { controller: 'noun', target: 'other', predicate: 'adjective' }, values: { features: 'plural' } };
  assert.equal(dependencies(relation).length, 1);
  assert.deepEqual(dispatch(relation).evidence.currentAnchors['feature.source'], ['other']);
});

test('default agreement rows do not turn a contextual subject into their controller', () => {
  const relation = { relation: 'matrix finiteness and default agreement',
    anchors: { finiteHead: 'other', subject: 'nominal', lexicalVerb: 'adjective' },
    values: { agreement: 'default masculine singular', aspect: 'perfective' } };
  assert.equal(dependencies(relation).length, 0);
  assert(!plan(relation).some(item => item.kind === 'directed-path' && item.toNodeId === 'nominal'));
  assert(dispatch(relation).evidenceCoverage.fields.find(field => field.key === 'agreement').unrecoveredItemIndices.length,
    'default rows stay visible as authored evidence instead of claiming a controller');
  const explicit = { ...relation, anchors: { probe: 'other', goal: 'nominal' } };
  assert.equal(dependencies(explicit).length, 1, 'explicit authored probe and goal remain authoritative');
  const ordinary = { ...relation, values: { agreement: 'masculine singular', aspect: 'perfective' } };
  assert.equal(dependencies(ordinary).length, 1, 'ordinary finite-head/subject agreement remains supported');
});
