import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const forest = [{ id: 'tp', label: 'TP', children: [
  { id: 't', label: 'T', word: 'has' }, { id: 's', label: 'DP', word: 'she' },
  { id: 'v', label: 'V', word: 'seen' }, { id: 'm', label: 'v' }
] }];
const dispatch = relation => dispatchRelationClaims({ relation, currentForest: forest, stageIndex: 0, relationIndex: 0 });
const plan = relation => compileRelationRenderPlan([{ statement: '', stageRecord: '', workspaceForest: forest, relations: [relation] }]).frames[0].items;
const has = (relation, id) => dispatch(relation).facets.some(facet => facet.recipe.id === id);

test('a local agreement verdict cannot promote a contextual root into a clause judgment', () => {
  const relation = { relation: 'subject agreement', anchors: { root: 'tp', probe: 't', goal: 's' },
    values: { verdict: 'failed', features: 'plural' } };
  assert(has(relation, 'feature.dependency'));
  assert(!has(relation, 'judgment.verdict'));
  assert(plan(relation).some(item => item.pathStyle === 'case-agree' && item.outcome === 'blocked'));
  assert(has({ relation: 'An unfamiliar assessment', anchors: { root: 'tp' }, values: { verdict: 'grammatical' } }, 'judgment.verdict'));
  assert(has({ ...relation, relation: 'grammaticality judgment' }, 'judgment.verdict'));
});

test('a generic verb plus an agent does not assert a thematic inventory', () => {
  for (const relation of ['binding', 'Case licensing', 'adjunction', 'not an argument assignment']) {
    assert(!has({ relation, anchors: { verb: 'v', agent: 's' } }, 'theta-grid'), relation);
  }
  assert(has({ relation: 'Argument structure', anchors: { verb: 'v', agent: 's' } }, 'theta-grid'));
  assert(has({ relation: 'An unfamiliar claim', anchors: { predicate: 'v', agent: 's' } }, 'theta-grid'));
});

test('qualified Case role recovery does not bypass denial of that same Case claim', () => {
  const anchors = { nominativeAssigner: 't', nominativeRecipient: 's' };
  for (const relation of ['no Case assignment', 'pending Case assignment'])
    assert(!has({ relation, anchors }, 'feature.dependency'), relation);
  assert(has({ relation: 'no agreement', anchors }, 'feature.dependency'));
  assert(plan({ relation: 'failed Case assignment', anchors }).some(item =>
    item.pathStyle === 'case-assignment' && item.outcome === 'blocked'));
});

test('an agreeing verb and unique controller identify a dependency without absorbing its context', () => {
  const relation = { relation: 'An independently named claim',
    anchors: { agreeingVerb: 'v', agreementController: 's', clause: 'tp' }, values: { agreement: 'feminine singular' } };
  const path = plan(relation).find(item => item.pathStyle === 'case-agree');
  assert.equal(path?.fromNodeId, 'v'); assert.equal(path?.toNodeId, 's');
  for (const extra of [{ agreeingHead: 't' }, { controller: 't' }, { agreementMediator: 'm' }])
    assert(!has({ ...relation, anchors: { ...relation.anchors, ...extra } }, 'feature.dependency'));
  const compound = { ...relation, relation: 'derivational convergence',
    values: { ...relation.values, judgment: 'grammatical' } };
  assert(has(compound, 'feature.dependency'));
  assert(has(compound, 'judgment.verdict'));
  assert(!plan(compound).some(item => item.pathStyle === 'case-agree' && item.outcome === 'blocked'));
});

test('mediated participial concord can show its host property without inventing a direct connection', () => {
  const relation = { relation: 'movement licensed participial concord',
    anchors: { agreementMediator: 'm', controller: 's', participle: 'v' }, values: { agreement: 'masculine plural' } };
  assert(plan(relation).some(item => item.kind === 'node-plaque' && item.anchorNodeIds[0] === 'v'));
  assert(!plan(relation).some(item => item.kind === 'directed-path'));
  assert(!has({ ...relation, anchors: { ...relation.anchors, participialHead: 't' } }, 'plaque.structured'));
});

test('an explicit Case licensing claim binds its corroborated inflection head and unique recipient', () => {
  const relation = { relation: 'nominative Case licensing', anchors: { inflection: 't', subject: 's' } };
  const items = plan(relation);
  assert(items.some(item => item.pathStyle === 'case-assignment' && item.fromNodeId === 't' && item.toNodeId === 's'));
  assert(!items.some(item => item.kind === 'node-plaque'));
  assert(!plan({ ...relation, anchors: { ...relation.anchors, transitiveHead: 'v' } })
    .some(item => item.pathStyle === 'case-assignment'));
});

test('agreement evidence cannot manufacture a Case assigner in the same record', () => {
  const relation = { relation: 'nominative Case and subject agreement',
    anchors: { inflection: 't', subject: 's' }, values: { case: 'nominative', agreement: 'third-person plural' } };
  const items = plan(relation);
  assert(items.some(item => item.pathStyle === 'case-agree' && item.fromNodeId === 't' && item.toNodeId === 's'));
  assert(items.some(item => item.kind === 'node-plaque' && item.anchorNodeIds.includes('s')
    && item.rows.some(row => row.value === 'nominative')));
  assert(!items.some(item => item.pathStyle === 'case-assignment'));
  const explicit = plan({ ...relation, anchors: { caseAssigner: 't', subject: 's' } });
  assert(explicit.some(item => item.pathStyle === 'case-assignment'));
});

test('richer result claims replace only their weaker generic endpoint claim', () => {
  const relation = { relation: 'T-subject Agree', anchors: { probe: 't', goal: 's' },
    values: { result: ['third-person singular agreement on T', 'nominative Case on the subject DP'] } };
  const d = dispatch(relation);
  assert.equal(d.facets.filter(facet => facet.recipe.id === 'feature.dependency').length, 2);
  const paths = plan(relation).filter(item => item.kind === 'directed-path');
  assert.equal(paths.filter(item => item.pathStyle === 'case-agree').length, 1);
  assert.equal(paths.filter(item => item.pathStyle === 'case-assignment').length, 1);
  assert(d.evidenceCoverage.fields.every(field => !field.unrecoveredItemIndices.length));
});

test('distinct authored fields and repeated list entries retain their evidence even when literals match', () => {
  const distinct = { relation: 'agreement', anchors: { auxiliary: 't', subject: 's', controller: 's' },
    values: { subjectFeatures: 'plural', controllerFeatures: 'plural' } };
  assert(dispatch(distinct).evidenceCoverage.fields.filter(field => field.field === 'values')
    .every(field => !field.unrecoveredItemIndices.length));
  const repeated = { relation: 'feature specification', anchors: { holder: ['s', 's'] }, values: { holder: ['plural', 'plural'] } };
  assert.equal(plan(repeated).find(item => item.kind === 'node-plaque')?.rows.length, 2);
  assert.deepEqual(dispatch(repeated).evidenceCoverage.fields.find(field => field.field === 'values').recognizedBy[0].itemIndices, [0, 1]);
});

test('an explicitly covert operation earns the QR path and its named sister scope domain', () => {
  const priorForest = [{ id: 'clause', label: 'TP', children: [
    { id: 'head', label: 'T' }, { id: 'vp', label: 'VP', children: [
      { id: 'verb', label: 'V', word: 'read' }, { id: 'lower', label: 'DP', word: 'a book', lineageId: 'object' }
    ] }
  ] }];
  const currentForest = [{ id: 'outer', label: 'TP', children: [
    { id: 'higher', label: 'DP', word: 'a book', lineageId: 'object', silent: true }, ...structuredClone(priorForest)
  ] }];
  const relation = { relation: 'covert object Internal Merge',
    anchors: { higherOccurrence: 'higher', lowerOccurrence: 'lower', scopeHost: 'clause' }, priorAnchors: { priorSource: 'lower' } };
  const d = dispatchRelationClaims({ relation, currentForest, priorForest, stageIndex: 1, relationIndex: 0 });
  assert(d.facets.some(facet => facet.recipe.id === 'scope.movement'));
  assert(!d.facets.some(facet => facet.recipe.id === 'movement.path'));
  assert.deepEqual(d.evidenceCoverage.fields.find(field => field.key === 'scopeHost').unrecoveredItemIndices, []);
  const stages = [{ statement: '', stageRecord: '', workspaceForest: priorForest, relations: [] },
    { statement: '', stageRecord: '', workspaceForest: currentForest, relations: [relation] }];
  const items = compileRelationRenderPlan(stages).frames[1].items;
  assert(items.some(item => item.kind === 'quantifier-raising'));
  assert.equal(items.find(item => item.kind === 'quantifier-raising').scopeDomainNodeId, 'clause');
  const ordinary = dispatchRelationClaims({ relation: { ...relation, relation: 'object Internal Merge' }, currentForest, priorForest, stageIndex: 1, relationIndex: 0 });
  assert(ordinary.facets.some(facet => facet.recipe.id === 'movement.path'));
  assert(!ordinary.facets.some(facet => facet.recipe.id === 'scope.movement'));
});
