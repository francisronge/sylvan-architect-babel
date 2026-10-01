import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const forest = [
  { id: 'licenser', label: 'v[transitive]' },
  { id: 'verb', label: 'V[perfective,feminine,singular]', word: 'sent' },
  { id: 'nominal', label: 'K', children: [
    { id: 'noun', label: 'N', word: 'Mira' }, { id: 'marker', label: 'K[erg]', word: 'ne' }
  ] },
  { id: 'other', label: 'DP', word: 'someone' }
];
const relation = { relation: 'perfective ergative licensing',
  anchors: { licenser: 'licenser', perfectiveVerb: 'verb', caseHead: 'marker', subject: 'nominal' } };
const dispatch = (record = relation, workspaceForest = forest) => dispatchRelationClaims({
  relation: record, currentForest: workspaceForest, stageIndex: 0, relationIndex: 0
});
const items = (record = relation, workspaceForest = forest) => compileRelationRenderPlan([
  { statement: 'Completed state', stageRecord: '', workspaceForest, relations: [record] }
]).frames[0].items;
const path = (record = relation, workspaceForest = forest) => items(record, workspaceForest)
  .filter(item => item.pathStyle === 'case-assignment');
const withHead = head => [forest[0], forest[1], { ...forest[2], children: [forest[2].children[0], head] }, forest[3]];

test('a corroborated Case label draws its exact licenser and recipient without changing the record', () => {
  const before = structuredClone({ relation, forest });
  const paths = path();
  assert.equal(paths.length, 1);
  assert.equal(paths[0].fromNodeId, 'licenser');
  assert.equal(paths[0].toNodeId, 'nominal');
  assert.equal(paths[0].label, 'ergative');
  assert.deepEqual(paths[0].relationRef.anchors, relation.anchors);
  assert.deepEqual({ relation, forest }, before);
  const fields = dispatch().evidenceCoverage.fields;
  for (const key of ['licenser', 'subject']) assert.deepEqual(fields.find(field => field.key === key).unrecoveredItemIndices, []);
  for (const key of ['perfectiveVerb', 'caseHead']) assert.deepEqual(fields.find(field => field.key === key).unrecoveredItemIndices, [0]);
  assert(items().some(item => item.kind === 'fallback'), 'qualifying context retains its authored record');
});

test('conventional Case abbreviations corroborate a full literal without tying recovery to a language', () => {
  for (const [literal, abbreviation] of [['nominative', 'NOM'], ['accusative', 'acc'], ['dative', 'DAT'],
    ['genitive', 'gen'], ['ergative', 'ERG'], ['absolutive', 'ABS'], ['instrumental', 'INS'], ['locative', 'LOC']]) {
    for (const label of [`K[${abbreviation}]`, `K⁰[Case: ${abbreviation}]`, `K[${literal}]`]) {
      const record = { ...relation, relation: `${literal} licensing` };
      assert.equal(path(record, withHead({ ...forest[2].children[1], label }))[0]?.label, literal, label);
    }
  }
  const renamed = { ...relation, relation: 'imperfective ergative marking',
    anchors: { licensor: 'licenser', imperfectiveHead: 'verb', caseHead: 'marker', recipient: 'nominal' } };
  const changed = structuredClone(forest); changed[1].label = 'V[imperfective]';
  assert.equal(path(renamed, changed).length, 1);
  assert.equal(path({ ...renamed, anchors: Object.fromEntries(Object.entries(renamed.anchors).reverse()) }, changed).length, 1);
});

test('a Case-head corroboration requires the exact single annotated head inside the named recipient', () => {
  for (const label of ['K[dat]', 'K', 'D[erg]', 'P[erg]', 'KP[erg]', "K′[erg]", 'K[erg or dat]',
    'K[not erg]', 'K[erg, dat]', 'K[erg][number: singular]', 'K[required: erg]', 'K[unfamiliar]'])
    assert.equal(path(relation, withHead({ ...forest[2].children[1], label })).length, 0, label);
  assert.equal(path(relation, withHead({ ...forest[2].children[1], children: [{ id: 'child', label: 'K[erg]' }] })).length, 0);
  assert.equal(path(relation, [forest[0], forest[1], { ...forest[2], children: [forest[2].children[0]] }, forest[2].children[1]]).length, 0);
  assert.equal(path(relation, [...forest, { ...forest[2].children[1] }]).length, 0, 'duplicate head identity');
  assert.equal(path(relation, [...forest, { ...forest[0] }]).length, 0, 'duplicate licenser identity');
  assert.equal(path(relation, [...forest, { ...forest[2], children: [] }]).length, 0, 'duplicate recipient identity');
});

test('competing, missing or conflated Case roles cannot select an assignment', () => {
  for (const anchors of [
    { ...relation.anchors, licenser: ['licenser', 'other'] },
    { ...relation.anchors, assigner: 'other' },
    { ...relation.anchors, subject: ['nominal', 'other'] },
    { ...relation.anchors, object: 'other' },
    { ...relation.anchors, caseHead: ['marker', 'other'] },
    { ...relation.anchors, case_head: 'other' },
    { ...relation.anchors, licenser: 'missing' },
    { ...relation.anchors, subject: 'missing' },
    { ...relation.anchors, caseHead: 'missing' },
    { ...relation.anchors, licenser: 'nominal' },
    { ...relation.anchors, subject: 'marker' },
    Object.fromEntries(Object.entries(relation.anchors).filter(([key]) => key !== 'licenser'))
  ]) assert.equal(path({ ...relation, anchors }).length, 0, JSON.stringify(anchors));
});

test('modifiers must have exact role and annotation evidence, while prose is not an assignment label', () => {
  for (const name of ['local ergative licensing', 'unfamiliar ergative licensing', 'perfective caused ergative licensing',
    'perfective ergative licensing if available', 'reports ergative licensing', 'ergative licensing is possible',
    'the predicate licenses ergative', '"ergative licensing"', 'ergative licensing and something'])
    assert.equal(path({ ...relation, relation: name }).length, 0, name);
  for (const changed of [
    forest.map(n => n.id === 'verb' ? { ...n, label: 'V[imperfective]' } : n),
    forest.map(n => n.id === 'verb' ? { ...n, label: 'VP[perfective]' } : n),
    [...forest, { ...forest[1] }]
  ]) assert.equal(path(relation, changed).length, 0);
  for (const anchors of [
    { ...relation.anchors, perfectiveVerb: 'missing' },
    { ...relation.anchors, perfectiveVerb: ['verb', 'other'] },
    { ...relation.anchors, perfectiveHead: 'other' },
    { ...relation.anchors, perfectiveVerb: undefined }
  ]) {
    const record = { ...relation, anchors: Object.fromEntries(Object.entries(anchors).filter(([, value]) => value !== undefined)) };
    assert.equal(path(record).length, 0);
  }
});

test('denial and unestablished outcomes cannot become successful Case assignments', () => {
  for (const qualifier of ['no', 'without', 'not', 'non', 'pending', 'possible', 'potential', 'hypothetical',
    'unestablished', 'unresolved', 'failed', 'blocked', 'unlicensed', 'required', 'expected', 'prior', 'if']) {
    const record = { relation: `${qualifier} ergative licensing`,
      anchors: { licenser: 'licenser', [`${qualifier}Verb`]: 'verb', caseHead: 'marker', subject: 'nominal' } };
    const changed = forest.map(n => n.id === 'verb' ? { ...n, label: `V[${qualifier}]` } : n);
    assert.equal(path(record, changed).length, 0, qualifier);
  }
  for (const status of ['pending', 'failed', 'hypothetical', ['licensed', 'failed']])
    assert.equal(path({ ...relation, values: { status } }).length, 0, JSON.stringify(status));
});

test('explicit authored Case evidence remains authoritative and is never duplicated or overwritten', () => {
  for (const literal of ['ergative', 'dative']) {
    const record = { ...relation, values: { case: literal } };
    const paths = path(record);
    assert.equal(paths.length, 1);
    assert.equal(paths[0].label, literal);
    assert.equal(dispatch(record).claims.filter(claim => claim.facet?.recipe.id === 'feature.dependency').length, 1);
  }
  const exactMalformed = { ...relation, relation: 'Case Assignment' };
  assert(!dispatch(exactMalformed).claims.some(claim => claim.tier === 2), 'a malformed registered claim is not repaired');
});
