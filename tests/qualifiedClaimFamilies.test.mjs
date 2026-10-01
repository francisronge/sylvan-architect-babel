import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
const leaf = (id, label, extra = {}) => ({ id, label, word: id, ...extra });
const forest = [{ id: 'clause', label: 'TP', children: [
  { id: 'np', label: 'NP', children: [{ id: 'ap', label: 'AP', children: [leaf('adjective', 'A')] }, leaf('noun', 'N')] },
  leaf('subject', 'DP'), leaf('object', 'DP'), leaf('verb', 'V'), leaf('auxiliary', 'T'),
  leaf('negative', 'Neg'), leaf('tense', 'T[jussive]', { word: undefined, silent: true })
] }];
const plan = (relation, workspaceForest = forest) => compileRelationRenderPlan([
  { statement: 'Authored state', stageRecord: '', workspaceForest, relations: [relation] }
]).frames[0].items;
const has = (relation, predicate) => plan(relation).some(predicate);

test('qualified theta assignments retain source, recipient and exact role without treating recipient as a role literal', () => {
  for (const prefix of ['object', 'embedded subject', 'matrix subject', 'external']) {
    const relation = { relation: `${prefix} theta-role assignment`, anchors: { assigner: 'verb', recipient: 'object' }, values: { role: 'Theme' } };
    assert(has(relation, item => item.plaqueStyle === 'theta-grid' && item.thetaRoles.some(role => role.nodeId === 'object' && role.label === 'Theme')));
    for (const invalid of [
      { ...relation, relation: `possible ${relation.relation}` },
      { ...relation, anchors: { ...relation.anchors, predicate: 'auxiliary' } },
      { ...relation, anchors: { ...relation.anchors, recipient: 'missing' } }
    ]) assert(!has(invalid, item => item.plaqueStyle === 'theta-grid'));
  }
});

test('an explicit Case assigner can license its complement, but a contextual head cannot', () => {
  const relation = { relation: 'postpositional case assignment', anchors: { assigner: 'verb', complement: 'np' }, values: { case: 'genitive' } };
  assert(has(relation, item => item.pathStyle === 'case-assignment' && item.fromNodeId === 'verb' && item.toNodeId === 'np'));
  assert(!has({ ...relation, anchors: { head: 'verb', complement: 'np' } }, item => item.pathStyle === 'case-assignment'));
  assert(!has({ ...relation, anchors: { assigner: ['verb', 'auxiliary'], complement: 'np' } }, item => item.pathStyle === 'case-assignment'));
});

test('nominal Case concord uses the shared vine and does not imply Case assignment', () => {
  const relation = { relation: 'adjectival case concord', anchors: { adjective: 'adjective', nominalHead: 'noun' }, values: { case: 'genitive' } };
  assert(has(relation, item => item.linkStyle === 'feature-sharing' && item.label.includes('genitive')));
  assert(!has(relation, item => item.kind === 'directed-path'));
  for (const invalid of [
    { ...relation, relation: 'possible adjectival case concord' },
    { ...relation, anchors: { ...relation.anchors, nominalHead: 'verb' } },
    { ...relation, anchors: { ...relation.anchors, controller: 'subject' } }
  ]) assert(!has(invalid, item => item.linkStyle === 'feature-sharing'));
});

test('a named participial agreement binds its fronted object and leaves the auxiliary and antecedent as context', () => {
  const relation = { relation: 'past-participle agreement with preceding direct object',
    anchors: { auxiliary: 'auxiliary', frontedObject: 'object', objectAntecedent: 'noun', participle: 'verb' },
    values: { gender: 'feminine', number: 'plural' } };
  const paths = plan(relation).filter(item => item.pathStyle === 'case-agree');
  assert.equal(paths.length, 2);
  assert(paths.every(item => item.fromNodeId === 'verb' && item.toNodeId === 'object'));
  for (const extra of [{ directObject: 'subject' }, { participialHead: 'auxiliary' }])
    assert(!has({ ...relation, anchors: { ...relation.anchors, ...extra } }, item => item.pathStyle === 'case-agree'));
});

test('reflexive and explicitly named topic binding use the existing connection without a made-up domain', () => {
  for (const relation of [
    { relation: 'reflexive binding', anchors: { antecedent: 'subject', reflexive: 'object' } },
    { relation: 'topic–subject binding', anchors: { topic: 'subject', subject: 'object' } }
  ]) {
    assert(has(relation, item => item.familyId === 'binding.dependency' && item.kind === 'operator-variable-binding'));
    assert(!has(relation, item => item.domainStyle === 'binding'));
    assert(!has({ ...relation, values: { outcome: 'pending' } }, item => item.familyId === 'binding.dependency' && item.kind === 'operator-variable-binding'));
  }
  assert(!has({ relation: 'topic association', anchors: { topic: 'subject', subject: 'object' } }, item => item.familyId === 'binding.dependency' && item.kind === 'operator-variable-binding'));
});

test('explicit reference can receive a display index without claiming copy identity or binding', () => {
  for (const relation of [
    { relation: 'relative antecedence', anchors: { antecedent: 'noun', relativePronoun: 'object' } },
    { relation: 'relative-operator and head-noun coindexation', anchors: { headNoun: 'noun', operator: 'object' } }
  ]) {
    const items = plan(relation), index = items.find(item => item.familyId === 'coreference.coindex');
    assert(index?.index);
    assert.deepEqual(new Set(index.nodeIds), new Set(['noun', 'object']));
    assert(!items.some(item => item.familyId === 'identity.occurrences' || item.familyId === 'binding.dependency' && item.kind === 'operator-variable-binding'));
    assert(!has({ ...relation, relation: `possible ${relation.relation}` }, item => item.familyId === 'coreference.coindex'));
  }
  const relation = { relation: 'relative-operator and head-noun coindexation', anchors: { headNoun: 'noun', operator: 'object' } };
  for (const label of ['NP, null relative operator', 'DP: relative operator', 'NP[relative]']) {
    const annotatedForest = structuredClone(forest);
    annotatedForest[0].children.find(node => node.id === 'object').label = label;
    assert(plan(relation, annotatedForest).some(item => item.familyId === 'coreference.coindex'));
  }
  for (const label of ['NP, V', 'NP or VP', 'VP, null relative operator']) {
    const ambiguousForest = structuredClone(forest);
    ambiguousForest[0].children.find(node => node.id === 'object').label = label;
    assert(!plan(relation, ambiguousForest).some(item => item.familyId === 'coreference.coindex'));
  }
});

test('form licensing needs an exact source label and independently authored target specification', () => {
  const relation = { relation: 'negative jussive licensing', anchors: { licensedTense: 'tense', negativeHead: 'negative' }, values: { licensedForm: 'jussive' } };
  assert(has(relation, item => item.pathStyle === 'case-agree' && item.fromNodeId === 'negative' && item.toNodeId === 'tense'));
  for (const invalid of [
    { ...relation, relation: 'possible negative jussive licensing' },
    { ...relation, anchors: { ...relation.anchors, licensedTense: 'auxiliary' } },
    { ...relation, anchors: { licensedTense: 'tense', otherHead: 'negative' } },
    { ...relation, values: { licensedForm: 'indicative' } }
  ]) assert(!has(invalid, item => item.pathStyle === 'case-agree'));
});
