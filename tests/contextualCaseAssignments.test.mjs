import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const forest = [{ id: 'clause', label: 'IP', children: [
  { id: 'subject', label: 'DP', word: 'Mia' },
  { id: 'ibar', label: 'I′', children: [
    { id: 'inflection', label: 'I⁰', silent: true },
    { id: 'vp', label: 'VP', children: [
      { id: 'verb', label: 'V', word: 'read', lineageId: 'verb-chain' },
      { id: 'object', label: 'NP', word: 'books' }
    ] }
  ] },
  { id: 'kp', label: 'KP', children: [
    { id: 'case', label: 'K⁰ [ergative]' }, { id: 'nominal', label: 'NP', word: 'Sam' }
  ] },
  { id: 'localizer-phrase', label: 'LP', children: [
    { id: 'ground', label: 'NP', word: 'table' }, { id: 'localizer', label: 'L⁰ [postpositional localizer]' }
  ] },
  { id: 'lower-vp', label: 'VP', children: [
    { id: 'governing', label: 'V trace', silent: true, lineageId: 'verb-chain' },
    { id: 'theme', label: 'NP[singular, total object]', word: 'book' }
  ] }
] }];
const plan = (relation, currentForest = forest) => compileRelationRenderPlan([
  { statement: '', stageRecord: '', workspaceForest: currentForest, relations: [relation] }
]).frames[0].items;
const paths = (relation, currentForest = forest) => plan(relation, currentForest).filter(item => item.pathStyle === 'case-assignment');
const dispatch = relation => dispatchRelationClaims({ relation, currentForest: forest, stageIndex: 0, relationIndex: 0 });

test('a complete Case claim corroborates finite, Case, and selecting heads without changing authored records', () => {
  const cases = [
    [{ relation: 'nominative Case licensing', anchors: { finiteHead: 'inflection', licensedSubject: 'subject' }, values: { case: 'nominative' } }, 'inflection', 'subject', 'nominative'],
    [{ relation: 'nominative Case licensing', anchors: { inflection: 'inflection', subject: 'subject' } }, 'inflection', 'subject', 'nominative'],
    [{ relation: 'inherent-Case-assignment', anchors: { caseHead: 'case', nominal: 'nominal' }, values: { case: 'ergative' } }, 'case', 'nominal', 'ergative'],
    [{ relation: 'lexically selected Case', anchors: { selector: 'verb', recipient: 'object' }, values: { case: 'dative' } }, 'verb', 'object', 'dative'],
    [{ relation: 'ground_and_inherent_case_licensing', anchors: { localizer: 'localizer', ground: 'ground' }, values: { thetaRole: 'Ground', case: 'inherent oblique' } }, 'localizer', 'ground', 'inherent oblique']
  ];
  for (const [relation, from, to, literal] of cases) {
    const before = structuredClone(relation), items = plan(relation), assignment = paths(relation);
    assert.equal(assignment.length, 1, JSON.stringify(relation));
    assert.deepEqual([assignment[0].fromNodeId, assignment[0].toNodeId, assignment[0].label], [from, to, literal]);
    assert.deepEqual(assignment[0].relationRef, { stageIndex: 0, relationIndex: 0, ...before });
    assert.deepEqual(relation, before);
    assert(!items.some(item => item.kind === 'node-plaque' && item.rows?.some(row => row.value === literal)), 'no duplicate property plaque');
    const caseField = dispatch(relation).evidenceCoverage.fields.find(field => field.field === 'values' && field.key === 'case');
    if (caseField) assert.deepEqual(caseField.unrecoveredItemIndices, []);
  }
});

test('the explicit governing slot owns Case while its other chain occurrence keeps its own identity drawing', () => {
  const relation = { relation: 'Structural object Case licensing through the verbal chain',
    anchors: { governingPosition: 'governing', object: 'theme', chainHead: 'verb' },
    values: { case: 'total-object accusative, realized by singular -n' } };
  assert.deepEqual(paths(relation).map(path => [path.fromNodeId, path.toNodeId]), [['governing', 'theme']]);
  const result = dispatch(relation);
  assert(result.facets.some(facet => facet.recipe.id === 'identity.occurrences'));
  assert(result.facets.some(facet => facet.recipe.id === 'feature.dependency'));
  const changed = structuredClone(forest);
  changed[0].children[1].children[1].children[0].lineageId = 'another-chain';
  assert.deepEqual(paths(relation, changed), [], 'an unrelated head cannot be discarded as chain context');
});

test('one explicitly compound role and Case assignment retains both independent drawings', () => {
  const relation = { relation: 'matrix theme-role and case assignment', anchors: { verb: 'verb', theme: 'object' },
    values: { case: 'accusative', role: 'theme' } };
  const items = plan(relation);
  assert(items.some(item => item.plaqueStyle === 'theta-grid'));
  assert.deepEqual(paths(relation).map(path => [path.fromNodeId, path.toNodeId]), [['verb', 'object']]);
  assert(dispatch(relation).evidenceCoverage.fields.every(field => !field.unrecoveredItemIndices.length));
  for (const alternate of ['matrix theme-role', 'argument licensing', 'theme-role and Case properties'])
    assert.deepEqual(paths({ ...relation, relation: alternate }), [], alternate);
});

test('properties, contextual heads, and unrelated category labels do not supply a Case assignment', () => {
  const base = { relation: 'Case licensing', anchors: { inflection: 'inflection', subject: 'subject' }, values: { case: 'nominative' } };
  for (const relation of [
    { ...base, relation: 'Case properties' },
    { ...base, relation: 'Case marking' },
    { ...base, relation: 'subject agreement' },
    { ...base, anchors: { head: 'inflection', subject: 'subject' } },
    { ...base, anchors: { inflection: 'verb', subject: 'subject' } },
    { ...base, anchors: { finiteHead: 'vp', subject: 'subject' } },
    { ...base, anchors: { caseHead: 'inflection', nominal: 'nominal' } },
    { ...base, anchors: { marker: 'case', nominal: 'nominal' } },
    { ...base, anchors: { localizer: 'verb', ground: 'ground' }, values: { case: 'oblique', thetaRole: 'Ground' } },
    { ...base, anchors: { selector: 'verb', recipient: 'object' } },
    { ...base, anchors: { inflection: 'inflection', subject: 'verb' } }
  ]) assert.deepEqual(paths(relation), [], JSON.stringify(relation));
});

test('competing sources, unresolved occurrences, and incomplete literal pairings remain neutral', () => {
  const base = { relation: 'nominative Case licensing', anchors: { inflection: 'inflection', subject: 'subject' }, values: { case: 'nominative' } };
  for (const relation of [
    { ...base, anchors: { ...base.anchors, finiteHead: 'case' } },
    { ...base, anchors: { ...base.anchors, transitiveHead: 'verb' } },
    { ...base, anchors: { ...base.anchors, object: 'object' } },
    { ...base, anchors: { inflection: ['inflection', 'case'], subject: 'subject' } },
    { ...base, anchors: { inflection: 'missing', subject: 'subject' } },
    { ...base, anchors: { inflection: 'inflection', subject: 'missing' } },
    { ...base, values: { case: ['nominative', 'accusative'] } },
    { ...base, values: { case: '' } },
    { ...base, values: { case: 'nominative', abstractCase: 'accusative' } }
  ]) assert.deepEqual(paths(relation), [], JSON.stringify(relation));
  assert.deepEqual(paths(base, [...forest, { id: 'inflection', label: 'I' }]), [], 'duplicate exact source');
  assert.deepEqual(paths(base, [...forest, { id: 'subject', label: 'DP' }]), [], 'duplicate exact recipient');
  assert.deepEqual(paths(base, [{ id: 'inflection', label: 'I' }, { id: 'subject', label: 'DP' }]), [], 'separate workspaces');
});

test('nonasserted Case claims and competing outcomes cannot become successful assignments', () => {
  const base = { relation: 'nominative Case licensing', anchors: { inflection: 'inflection', subject: 'subject' }, values: { case: 'nominative' } };
  for (const relation of ['no nominative Case licensing', 'failed nominative Case licensing', 'possible Case licensing',
    'Case licensing is pending', 'Case licensing if the head is finite', 'Case licensing; Case licensing is blocked'])
    assert.deepEqual(paths({ ...base, relation }), [], relation);
  for (const status of ['failed', 'pending', 'unlicensed', 'undetermined'])
    assert.deepEqual(paths({ ...base, values: { ...base.values, status } }), [], status);
  assert.deepEqual(paths({ ...base, relation: 'Case Assignment' }), [], 'a malformed exact signature cannot be repaired by Tier 2');
});

test('an explicitly directed source keeps precedence over contextual assignment recovery', () => {
  const relation = { relation: 'Case licensing', anchors: { caseAssigner: 'verb', inflection: 'inflection', subject: 'subject' }, values: { case: 'accusative' } };
  assert.deepEqual(paths(relation).map(path => [path.fromNodeId, path.toNodeId]), [['verb', 'subject']]);
});

test('explicit government with a typed Case binds its unique nominal dependent', () => {
  for (const literal of ['accusative', 'opaque value']) {
    const relation = { relation: `government and ${literal} Case`, anchors: { governor: 'verb', dependent: 'object' }, values: { case: literal } };
    const original = structuredClone(relation);
    assert.deepEqual(paths(relation).map(path => [path.fromNodeId, path.toNodeId, path.label]), [['verb', 'object', literal]]);
    assert.deepEqual(relation, original);
  }
  const base = { relation: 'government and accusative Case', anchors: { governor: 'verb', dependent: 'object' }, values: { case: 'accusative' } };
  for (const relation of [
    { ...base, relation: 'accusative Case' },
    { ...base, relation: 'government' },
    { ...base, relation: 'government and Case properties' },
    { ...base, relation: 'government and nominative Case' },
    { ...base, relation: 'possible government and accusative Case' },
    { ...base, values: {} },
    { ...base, values: { case: ['accusative', 'nominative'] } },
    { ...base, anchors: { governor: 'vp', dependent: 'object' } },
    { ...base, anchors: { governor: 'verb', dependent: 'inflection' } },
    { ...base, anchors: { governor: 'missing', dependent: 'object' } },
    { ...base, anchors: { governor: 'verb', dependent: 'missing' } },
    { ...base, anchors: { governor: 'verb', dependent: ['object', 'nominal'] } },
    { ...base, anchors: { ...base.anchors, finiteHead: 'inflection' } },
    { ...base, relation: 'Case Assignment' }
  ]) assert.deepEqual(paths(relation), [], JSON.stringify(relation));
  assert.deepEqual(paths({ ...base, anchors: { ...base.anchors, object: 'theme' } }).map(path => path.toNodeId), ['theme'],
    'an independently recognized Case recipient takes precedence over the contextual dependent');
  assert.deepEqual(paths(base, [{ id: 'verb', label: 'V' }, { id: 'object', label: 'NP' }]), [], 'separate workspaces');
});
