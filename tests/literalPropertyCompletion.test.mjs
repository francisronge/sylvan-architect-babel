import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const german = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/german-paired-case.json', import.meta.url)));
const spanish = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/single-participant-properties.json', import.meta.url)));
const nominal = [{ id: 'dp', label: 'DP', children: [{ id: 'd', label: 'D' }, { id: 'np', label: 'NP', children: [
  { id: 'ap', label: 'AP', children: [{ id: 'a', label: 'A' }] }, { id: 'n', label: 'N' }
] }] }];
const concord = { relation: 'Attributive concord', anchors: { adjective: 'a', determiner: 'd', noun: 'n' },
  values: { case: 'accusative', number: 'singular', gender: 'masculine' } };
const finite = [{ id: 't', label: 'T' }, { id: 'v', label: 'V' }];
const specification = { relation: 'finite feature specification', anchors: { inflection: 't' },
  values: { agreement: 'third-person singular', mood: 'indicative', tense: 'past' } };
const plan = (relation, workspaceForest) => compileRelationRenderPlan([
  { statement: '', stageRecord: '', workspaceForest, relations: [relation] }
]).frames[0].items;
const caseSharing = (r = concord, forest = nominal) => plan(r, forest).filter(item => item.linkStyle === 'feature-sharing' && item.label.includes('accusative'));
const propertyRows = (r = specification, forest = finite) => plan(r, forest).filter(item => item.kind === 'node-plaque').flatMap(item => item.rows ?? []);

test('saved attributive concord includes literal Case on the existing nominal collection', () => {
  const stage = german.examples.find(example => example.model === 'gpt-6.1-sol').stage;
  const relation = stage.relations[4], original = structuredClone(stage), items = plan(relation, stage.workspaceForest);
  const sharing = items.filter(item => item.linkStyle === 'feature-sharing');
  assert.equal(sharing.length, 1);
  for (const literal of ['accusative', 'masculine', 'singular']) assert(sharing[0].label.includes(literal));
  assert.equal(items.some(item => item.pathStyle === 'case-assignment'), false);
  assert.deepEqual(stage, original);
});

test('asserted concord reuses exact nominal membership and never invents Case direction', () => {
  for (const label of ['concord', 'nominal concord', 'attributive concord', 'adjectival concord', 'determiner concord']) {
    const r = { ...concord, relation: label };
    assert.equal(caseSharing(r).length, 1, label);
    assert.equal(plan(r, nominal).some(item => item.kind === 'directed-path'), false);
  }
  for (const r of [
    ...['nominal properties', 'notes about concord', 'possible concord', 'denied concord', 'failed concord',
      'concord if licensed', 'concord; Case assignment denied'].map(relation => ({ ...concord, relation })),
    ...['denied', 'failed', 'pending', 'unknown'].map(status => ({ ...concord, values: { ...concord.values, status } })),
    { ...concord, anchors: { ...concord.anchors, controller: 'n' } },
    { ...concord, anchors: { ...concord.anchors, adjective: 'missing' } }
  ]) assert.equal(caseSharing(r).length, 0, JSON.stringify(r));
  assert.equal(caseSharing(concord, [...nominal, { id: 'n', label: 'N' }]).length, 0);
  assert.equal(caseSharing(concord, [{ id: 'a', label: 'A' }, { id: 'd', label: 'D' }, { id: 'n', label: 'N' }]).length, 0);
});

test('both saved finite specifications retain the mood row at their one exact inflection owner', () => {
  for (const stage of spanish.stages) {
    const relation = stage.relations[2], original = structuredClone(stage);
    const rows = propertyRows(relation, stage.workspaceForest);
    assert.equal(rows.filter(row => row.value === 'indicative').length, 1);
    assert(plan(relation, stage.workspaceForest).filter(item => item.rows?.some(row => row.value === 'indicative'))
      .every(item => JSON.stringify(item.anchorNodeIds) === JSON.stringify([relation.anchors.inflection])));
    assert.equal(plan(relation, stage.workspaceForest).some(item => item.kind === 'directed-path'), false);
    assert.deepEqual(stage, original);
  }
});

test('single-participant grammatical properties stay literal and cannot license assignment', () => {
  for (const property of ['mood', 'aspect', 'voice', 'polarity', 'definiteness', 'finiteness']) {
    const relation = { relation: 'property specification', anchors: { owner: 't' }, values: { [property]: 'opaque authored value' } };
    const items = plan(relation, finite);
    assert.equal(items.filter(item => item.kind === 'node-plaque').flatMap(item => item.rows ?? []).filter(row => row.value === 'opaque authored value').length, 1, property);
    assert.equal(items.some(item => item.kind === 'directed-path'), false);
    assert.equal(propertyRows({ ...relation, anchors: { owner: 't', otherOwner: 'v' } },
      [{ id: 't', label: 'T' }, { id: 'v', label: 'T' }]).some(row => row.value === 'opaque authored value'), false);
  }
  for (const r of [
    { ...specification, anchors: { inflection: ['t', 'v'] } },
    { ...specification, anchors: { inflection: 'missing' } },
    { ...specification, anchors: { inflection: 't', verb: 'v' } },
    ...['Denied specification', 'Possible specification', 'specification if licensed'].map(relation => ({ ...specification, relation })),
    ...['denied', 'failed', 'pending', 'unknown'].map(status => ({ ...specification, values: { ...specification.values, status } }))
  ]) assert.equal(propertyRows(r).some(row => row.value === 'indicative'), false, JSON.stringify(r));
  assert.equal(propertyRows(specification, [...finite, { id: 't', label: 'T' }]).some(row => row.value === 'indicative'), false);
  assert.equal(plan({ ...specification, relation: 'CaseAssignment' }, finite).some(item => item.pathStyle === 'case-assignment'), false);
});

test('a literal mood row does not establish neighboring lexical form or inflection claims', () => {
  for (const relation of ['A description', 'Auxiliary support', 'property specification', 'finite feature specification']) {
    const record = { relation, anchors: { owner: 't' }, values: { mood: 'indicative', form: 'does', inflection: 'past' } };
    const rows = propertyRows(record);
    assert.equal(rows.filter(row => row.label === 'mood' && row.value === 'indicative').length, 1, relation);
    assert(!rows.some(row => row.label === 'form' || row.label === 'inflection'), relation);
    assert(!plan(record, finite).some(item => item.kind === 'directed-path'), relation);
  }
});
