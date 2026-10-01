import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const leaf = (id, label) => ({ id, label, word: id });
const forest = [{ id: 'domain', label: 'VP', children: [leaf('p', 'V'), leaf('other', 'T'), leaf('t', 'T'),
  leaf('a', 'DP'), leaf('b', 'DP'), leaf('c', 'DP'), leaf('d', 'DP'), leaf('pro', 'DP[PRO]'),
  { id: 'cl', label: 'CP', children: [leaf('ch', 'C')] }, { id: 'silent', label: 'TP', silent: true, children: [leaf('sv', 'V')] },
  { id: 'wrong', label: 'CP', children: [leaf('wc', 'C')] }, leaf('adv', 'AdvP')] }];
const dispatch = (relation, currentForest = forest) => dispatchRelationClaims({ relation, currentForest, stageIndex: 0, relationIndex: 0 });
const claims = (relation, currentForest) => dispatch(relation, currentForest).claims.filter(claim => claim.tier === 2);
const by = (relation, id, currentForest) => claims(relation, currentForest).filter(claim => claim.facet.recipe.id === id);
const render = (relation, workspaceForest = forest) => compileRelationRenderPlan([{ statement: '', stageRecord: '', workspaceForest, relations: [relation] }]).frames[0].items;

test('explicit form tuples preserve their exact pair and reject competing or unasserted licensing', () => {
  const relation = { relation: 'participial form licensing', anchors: { licensor: 't', licensedHead: 'p' }, values: { form: 'opaque form' } };
  assert.equal(by(relation, 'feature.dependency').length, 1);
  for (const extra of [{ probe: 'other' }, { goal: 'other' }])
    assert.equal(by({ ...relation, anchors: { ...relation.anchors, ...extra } }, 'feature.dependency').length, 0);
  for (const prefix of ['Denied', 'Rejected', 'Required', 'Requested', 'Expected', 'Pending'])
    assert.equal(by({ ...relation, relation: `${prefix} ${relation.relation}` }, 'feature.dependency').length, 0);
  assert.equal(by({ ...relation, relation: `${relation.relation} if licensed` }, 'feature.dependency').length, 0);
});

test('category-confirmed force properties preserve their literal and local assertion', () => {
  const relation = { relation: 'Declarative clause typing', anchors: { head: 'ch', clause: 'cl' }, values: { force: 'declarative' } };
  assert.equal(by(relation, 'plaque.structured').length, 1);
  for (const altered of [
    { ...relation, relation: 'Pending declarative clause typing' },
    { ...relation, relation: 'clause properties', values: { force: 'interrogative', status: 'pending' } },
    { ...relation, relation: 'clause typing if licensed' }
  ]) assert.equal(by(altered, 'plaque.structured').length, 0);
  for (const label of ['No clause properties', 'Possible clause properties', 'Required clause properties', 'clause properties if licensed'])
    assert.equal(by({ ...relation, relation: label }, 'plaque.structured').length, 0);
  assert.equal(by(relation, 'plaque.structured', [...forest, leaf('ch', 'C')]).length, 0);
});

test('remnant correspondence uses role bijection, retains both proof rows, and invents no index', () => {
  const relation = { relation: 'gapping contrast parallelism', anchors: { antecedentRemnants: ['a', 'b'], ellipsisRemnants: ['c', 'd'] },
    values: { antecedentRemnants: ['agent', 'theme'], ellipsisRemnants: ['theme', 'agent'] } };
  const drawn = by(relation, 'correspondence.alignment');
  assert.equal(drawn.length, 2);
  assert.deepEqual(drawn.map(claim => [claim.facet.evidence.currentAnchors['correspondence.source'], claim.facet.evidence.currentAnchors['correspondence.target']]),
    [[['a'], ['d']], [['b'], ['c']]]);
  assert.deepEqual(drawn.map(claim => claim.consumedEvidence.filter(ref => ref.field === 'values').map(ref => [ref.key, ref.itemIndices])), [
    [['antecedentRemnants', [0]], ['ellipsisRemnants', [1]]], [['antecedentRemnants', [1]], ['ellipsisRemnants', [0]]]
  ]);
  assert(!render(relation).some(item => item.kind === 'coindex' || item.kind === 'coindex-set'));
  for (const values of [
    { antecedentRemnants: ['agent', 'theme'], ellipsisRemnants: ['agent', 'agent'] },
    { antecedentRemnants: ['agent', 'theme'], ellipsisRemnants: ['agent'] },
    { antecedentRemnants: ['agent', 'theme'], ellipsisRemnants: ['agent', 'recipient'] }
  ]) assert.equal(by({ ...relation, values }, 'correspondence.alignment').length, 0);
});

test('named gapping domain needs actual authored silence for deletion', () => {
  const relation = { relation: 'gapping ellipsis', anchors: { silentDomain: 'silent', antecedentDomain: 'cl' } };
  assert.equal(by(relation, 'ellipsis.site').length, 1);
  const overt = structuredClone(forest); overt[0].children.find(node => node.id === 'silent').silent = false;
  assert.equal(by(relation, 'ellipsis.site', overt).length, 0);
  assert.equal(by({ ...relation, relation: 'possible gapping ellipsis' }, 'ellipsis.site').length, 0);
});

test('actual attachment hosts and additive associates use existing primitives without contextual alternatives', () => {
  const modification = { relation: 'temporal modification', anchors: { scope: 'p', modifier: 'adv' } };
  assert.equal(by(modification, 'pair-merge').length, 1);
  for (const prefix of ['Denied', 'Rejected', 'Required', 'Expected'])
    assert.equal(by({ ...modification, relation: `${prefix} temporal modification` }, 'pair-merge').length, 0);
  const focus = { relation: 'additive association', anchors: { additiveAdverb: 'adv', addedSubject: 'a', antecedentSubject: 'b' } };
  assert.equal(by(focus, 'focus.association').length, 1);
  assert.deepEqual(by(focus, 'focus.association')[0].facet.evidence.currentAnchors['association.associate'], ['a']);
  assert.equal(by({ ...focus, anchors: { ...focus.anchors, associate: 'c' } }, 'focus.association').length, 0);
});

test('complement theta scope retains the actual clausal sister and rejects competing assigning predicates', () => {
  const relation = { relation: 'Thematic interpretation', anchors: { predicate: 'p', propositionalArgument: 'cl' }, values: { complementRole: 'opaque propositional role' } };
  assert.equal(by(relation, 'theta-grid').length, 1);
  for (const extra of [{ assigner: 'other' }, { predicateHead: 'other' }])
    assert.equal(by({ ...relation, anchors: { ...relation.anchors, ...extra } }, 'theta-grid').length, 0);
});

test('named control and binding preserve optional domain and authored index', () => {
  const control = { relation: 'subject chain and control', anchors: { finiteSubject: 'a', controlledSubject: 'pro', domain: 'domain' }, values: { index: 'k' } };
  assert.equal(by(control, 'control.dependency').length, 1);
  assert(by(control, 'control.dependency')[0].consumedEvidence.some(ref => ref.field === 'values' && ref.key === 'index'));
  assert.equal(by({ ...control, anchors: { ...control.anchors, domain: 'wrong' } }, 'control.dependency').length, 0);
  const binding = { relation: 'relative operator binding', anchors: { operator: 'a', resumptiveSubject: 'pro', domain: 'domain' }, values: { index: 'j' } };
  assert.equal(by(binding, 'binding.dependency').length, 1);
  assert(by(binding, 'binding.dependency')[0].consumedEvidence.some(ref => ref.field === 'values' && ref.key === 'index'));
  assert.equal(by({ ...binding, anchors: { ...binding.anchors, domain: 'wrong' } }, 'binding.dependency').length, 0);
});

test('noun-class Agree adds its own row to one existing dependency without a second connector', () => {
  const relation = { relation: 'object Agree', anchors: { probe: 't', goal: 'a' }, values: { number: 'plural', nounClass: 'opaque class', case: 'accusative' } };
  assert.equal(by(relation, 'feature.dependency').length, 1);
  assert(by(relation, 'feature.dependency')[0].consumedEvidence.some(ref => ref.key === 'nounClass'));
  assert(!by({ ...relation, relation: 'pending object Agree' }, 'feature.dependency').some(claim => claim.consumedEvidence.some(ref => ref.key === 'nounClass')));
  assert(!by(relation, 'feature.dependency', [...forest, leaf('a', 'DP')]).some(claim => claim.consumedEvidence.some(ref => ref.key === 'nounClass')));
});

test('subject Case property can use a single explicit agreement goal without inventing phi values', () => {
  const relation = { relation: 'Finite agreement and tense licensing', anchors: { goal: 'a', tense: 't', predicate: 'p' }, values: { subjectCase: 'nominative', tense: 'past' } };
  assert(by(relation, 'plaque.structured').some(claim => claim.consumedEvidence.some(ref => ref.key === 'subjectCase')));
  assert.equal(by(relation, 'feature.dependency').length, 0);
  assert(!by({ ...relation, anchors: { ...relation.anchors, recipient: 'b' } }, 'plaque.structured').some(claim => claim.consumedEvidence.some(ref => ref.key === 'subjectCase')));
  assert(!by({ ...relation, relation: 'object Agree', anchors: { probe: 'p', goal: 'a' } }, 'plaque.structured')
    .some(claim => claim.consumedEvidence.some(ref => ref.key === 'subjectCase')));
});

test('interpreted operator aliases require a unique lineage bijection without restricting canonical roles', () => {
  const objects = [{ id: 'root', label: 'CP', children: [
    { ...leaf('op', 'NP'), lineageId: 'one' }, { ...leaf('var', 'NP'), lineageId: 'one' },
    { ...leaf('op2', 'NP'), lineageId: 'two' }, { ...leaf('var2', 'NP'), lineageId: 'two' }, leaf('other', 'NP')
  ] }];
  const relation = { relation: 'relative interpretation', anchors: { operator: 'op', objectVariable: 'var' }, values: { variableIndex: 'j' } };
  const drawn = by(relation, 'operator-binding', objects);
  assert.equal(drawn.length, 1);
  assert(drawn[0].consumedEvidence.some(ref => ref.key === 'variableIndex'));
  for (const anchors of [
    { ...relation.anchors, variable: 'other' }, { ...relation.anchors, relativeOperator: 'other' },
    { operator: 'op', objectVariable: 'var2' }
  ]) assert.equal(by({ ...relation, anchors }, 'operator-binding', objects).length, 0);
  assert.equal(by(relation, 'operator-binding', [...objects, leaf('var', 'NP')]).length, 0);
  assert.equal(by({ ...relation, values: { status: 'pending' } }, 'operator-binding', objects).length, 0);
  const unlineaged = structuredClone(objects); unlineaged[0].children.forEach(node => delete node.lineageId);
  assert.equal(by(relation, 'operator-binding', unlineaged).length, 0);
  for (const label of ['relative interpretation', 'relative head interpretation', 'quantifier scope interpretation'])
    assert.equal(by({ relation: label, anchors: { operator: 'op', variable: 'var' }, values: { index: 'i' } }, 'operator-binding', unlineaged).length, 1);
  const scope = { relation: 'quantifier scope interpretation', anchors: { wideScopeOperator: 'op2', narrowScopeOperator: 'op', subjectVariablePosition: 'var', objectVariablePosition: 'var2' } };
  assert.equal(by(scope, 'operator-binding', objects).length, 2);
  const ambiguous = structuredClone(objects); ambiguous[0].children.filter(node => node.lineageId).forEach(node => node.lineageId = 'same');
  assert.equal(by(scope, 'operator-binding', ambiguous).length, 0);
});

test('selected mood licensing uses its exact functional recipient and current matching annotation', () => {
  const objects = [{ id: 'root', label: 'TP', children: [leaf('neg', 'Neg[selects jussive]'), leaf('finite', 'T[finite,jussive]'), leaf('exponent', 'V[jussive]'), leaf('other', 'T')] }];
  const relation = { relation: 'negative selection and mood licensing', anchors: { selector: 'neg', finiteHead: 'finite', verbalExponent: 'exponent' }, values: { selectedMood: 'jussive' } };
  const drawn = by(relation, 'feature.dependency', objects);
  assert.equal(drawn.length, 1);
  assert.deepEqual(drawn[0].facet.evidence.currentAnchors['feature.target'], ['finite']);
  for (const label of ['negative selection and pending mood licensing', 'negative selection and mood licensing if licensed'])
    assert.equal(by({ ...relation, relation: label }, 'feature.dependency', objects).length, 0);
  assert.equal(by({ ...relation, values: { ...relation.values, status: 'pending' } }, 'feature.dependency', objects).length, 0);
  assert.equal(by({ ...relation, anchors: { ...relation.anchors, goal: 'other' } }, 'feature.dependency', objects).length, 0);
  for (const label of ['T[finite]', 'T[required jussive]', 'TP[jussive]']) {
    const altered = structuredClone(objects); altered[0].children.find(node => node.id === 'finite').label = label;
    assert.equal(by(relation, 'feature.dependency', altered).length, 0);
  }
  assert.equal(by(relation, 'feature.dependency', [...objects, leaf('finite', 'T[jussive]')]).length, 0);
});

test('an explicitly named participle earns only its exact asserted selected form', () => {
  const relation = { relation: 'perfect-participle selection', anchors: { auxiliary: 't', participle: 'p' }, values: { form: 'perfect participle' } };
  assert.equal(by(relation, 'feature.dependency').length, 1);
  for (const values of [{ requiredForm: 'perfect participle' }, { form: 'other form' }, { form: 'perfect participle', status: 'pending' }])
    assert.equal(by({ ...relation, values }, 'feature.dependency').length, 0);
  for (const label of ['Required perfect-participle selection', 'perfect-participle selection if licensed'])
    assert.equal(by({ ...relation, relation: label }, 'feature.dependency').length, 0);
  assert.equal(by({ ...relation, anchors: { ...relation.anchors, goal: 'other' } }, 'feature.dependency').length, 0);
  assert.equal(by(relation, 'feature.dependency', [...forest, leaf('p', 'V')]).length, 0);
  const phrase = structuredClone(forest); phrase[0].children.find(node => node.id === 'p').label = 'VP';
  assert.equal(by(relation, 'feature.dependency', phrase).length, 0);
});

test('relative concord keeps its named bearers and only corroborated determiner context', () => {
  const objects = [{ id: 'nominal', label: 'DP', children: [leaf('det', 'D'), leaf('noun', 'N')] }, leaf('rel', 'C'), leaf('unrelated', 'D')];
  const relation = { relation: 'Relative concord', anchors: { nominalHead: 'noun', relativizer: 'rel', definiteDeterminer: 'det' }, values: { features: 'definite masculine singular' } };
  const drawn = by(relation, 'feature-sharing', objects);
  assert.equal(drawn.length, 1);
  assert.deepEqual(drawn[0].facet.evidence.currentAnchors['feature.bearers'], ['noun', 'rel']);
  for (const anchors of [{ ...relation.anchors, definiteDeterminer: 'unrelated' }, { ...relation.anchors, resumptive: 'det' }])
    assert.equal(by({ ...relation, anchors }, 'feature-sharing', objects).length, 0);
  assert.equal(by({ ...relation, values: { ...relation.values, status: 'pending' } }, 'feature-sharing', objects).length, 0);
  assert.equal(by(relation, 'feature-sharing', [...objects, leaf('rel', 'C')]).length, 0);
});
