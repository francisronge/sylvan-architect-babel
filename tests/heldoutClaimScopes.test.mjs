import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const leaf = (id, label, extra = {}) => ({ id, label, word: id, ...extra });
const forest = [{ id: 'clause', label: 'TP', children: [leaf('t', 'T[past]'), leaf('otherT', 'T'),
  leaf('subject', 'DP'), { id: 'object', label: 'DP', children: [leaf('d', 'Det⁰'), leaf('n', 'N⁰')] },
  { id: 'vp', label: 'VP', children: [leaf('v', 'V'), leaf('agent', 'DP')] }, leaf('neg', 'Neg'),
  leaf('a', 'A'), leaf('appl', 'Appl[recipient]'), leaf('recipient', 'KP'), leaf('clitic', 'D'),
  { id: 'c', label: 'C[wh-probe]', silent: true }, { id: 'qarg', label: 'DP', children: [leaf('wh', 'Det⁰[wh]')] }
] }];
const dispatch = (relation, workspaceForest = forest, priorForest, currentRealizations) => dispatchRelationClaims({ relation,
  currentForest: workspaceForest, priorForest, currentRealizations, stageIndex: 1, relationIndex: 0 });
const by = (relation, id, workspaceForest, priorForest, currentRealizations) => dispatch(relation, workspaceForest, priorForest, currentRealizations)
  .claims.filter(claim => claim.tier === 2 && claim.facet.recipe.id === id);
const used = (claim, key, indices = [0]) => claim.consumedEvidence.some(ref => ref.key === key && JSON.stringify(ref.itemIndices ?? [0]) === JSON.stringify(indices));

test('nominal concord retains Case and definiteness on one native vine and leaves enclosing nominal contextual', () => {
  const relation = { relation: 'Nominal concord', anchors: { nominal: 'object', noun: 'n', demonstrative: 'd' },
    values: { case: 'opaque nominal Case', definiteness: 'definite', number: 'plural' } };
  const claims = by(relation, 'feature-sharing');
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0].facet.evidence.currentAnchors['feature.bearers'], ['n', 'd']);
  for (const key of ['case', 'definiteness', 'number']) assert(used(claims[0], key));
  assert.equal(by(relation, 'feature.dependency').length, 0);
  for (const prefix of ['Denied', 'Possible', 'Pending', 'Required'])
    assert.equal(by({ ...relation, relation: `${prefix} Nominal concord` }, 'feature-sharing').length, 0);
  assert.equal(by(relation, 'feature-sharing', [...forest, leaf('n', 'N')]).length, 0);
});

test('a finite agreement probe reaches its subject goal beside a named finite bearer', () => {
  const subject = { relation: 'Finite agreement', anchors: { probe: 't', subjectGoal: 'subject', finiteBearer: 'v' }, values: { number: 'singular', person: 'third' } };
  assert.equal(by(subject, 'feature.dependency').length, 1);
});

test('checked feature labels enrich one existing dependency while licensed nominal properties keep the exact goal', () => {
  const feature = { relation: 'relative-operator attraction', anchors: { probe: 'c', goal: 'qarg' }, values: { feature: 'relative' } };
  const claims = by(feature, 'feature.dependency'); assert.equal(claims.length, 1); assert(used(claims[0], 'feature'));
  assert.equal(by({ ...feature, relation: 'Pending relative-operator attraction' }, 'feature.dependency').length, 0);
  const licensed = { relation: 'subject agreement', anchors: { probe: 't', goal: 'subject' }, values: { nominalLicensing: 'abstract nominative' } };
  const properties = by(licensed, 'plaque.structured'); assert.equal(properties.length, 1);
  assert.deepEqual(properties[0].facet.evidence.currentAnchors['plaque.anchor'], ['subject']);
  const argument = { relation: 'no agreement; argument licensing', anchors: { internalArgument: 'object' }, values: { internalRole: 'theme', objectCase: 'opaque Case' } };
  assert(by(argument, 'plaque.structured').some(claim => used(claim, 'objectCase')));
  assert(!by({ ...argument, relation: 'Denied argument licensing' }, 'plaque.structured').some(claim => used(claim, 'objectCase')));
});

test('an exact Case-qualified governor and phrase preserve compound literal ownership', () => {
  const relation = { relation: 'Case licensing', anchors: { opaqueGovernor: 'v', opaquePhrase: 'object', matrixSubject: 'subject' },
    values: { objectCase: 'opaque, explicitly realized' } };
  const claims = by(relation, 'feature.dependency'); assert.equal(claims.length, 1); assert(used(claims[0], 'objectCase'));
  assert.deepEqual(claims[0].facet.evidence.currentAnchors, { 'feature.source': ['v'], 'feature.target': ['object'] });
  assert.equal(by({ ...relation, relation: 'Required Case licensing' }, 'feature.dependency').length, 0);
  assert.equal(by({ ...relation, values: { objectCase: 'another opaque literal' } }, 'feature.dependency').length, 0);
  assert.equal(by(relation, 'feature.dependency', [...forest, leaf('v', 'V')]).length, 0);
});

test('actual abstract heads retain their properties separately from the lexical whole-word statement', () => {
  const objects = [{ id: 'root', label: 'TP', children: [leaf('aspect', 'Asp[perfective]'), leaf('tense', 'T[past]'), leaf('verb', 'V[perfective]')] }];
  const relation = { relation: 'Aspect and tense feature checking', anchors: { aspectHead: 'aspect', tenseHead: 'tense', inflectedVerb: 'verb' },
    values: { aspect: 'perfective', tense: 'past', lexicalRealization: 'whole inflected word' } };
  const plaques = by(relation, 'plaque.structured', objects), pf = by(relation, 'pf.structured', objects);
  assert.equal(plaques.length, 2); assert.equal(pf.length, 1); assert(used(pf[0], 'lexicalRealization')); assert(!used(pf[0], 'tense'));
  assert.deepEqual(plaques.map(claim => claim.facet.evidence.currentAnchors['plaque.anchor']).sort(), [['aspect'], ['tense']]);
});

test('current mood licensing preserves its explicit functional recipient without borrowing the verbal exponent', () => {
  const objects = structuredClone(forest); objects[0].children.find(node => node.id === 't').label = 'T[opaque mood]';
  const relation = { relation: 'negative temporal and mood licensing', anchors: { licensor: 'neg', finiteHead: 't', verb: 'v' }, values: { mood: 'opaque mood' } };
  const claims = by(relation, 'feature.dependency', objects); assert.equal(claims.length, 1); assert(used(claims[0], 'mood'));
  assert.deepEqual(claims[0].facet.evidence.currentAnchors['feature.target'], ['t']);
  for (const altered of [
    { ...relation, relation: 'Pending mood licensing' }, { ...relation, anchors: { ...relation.anchors, goal: 'otherT' } },
    { ...relation, values: { selectedMood: 'another mood' } }
  ]) assert.equal(by(altered, 'feature.dependency', objects).length, 0);
  assert.equal(by(relation, 'feature.dependency').length, 0);
});

test('named passive participants use their exact predicate', () => {
  const passive = { relation: 'Passive agent interpretation', anchors: { predicate: 'v', agentNominal: 'agent' }, values: { thetaRole: 'Agent' } };
  assert.equal(by(passive, 'theta-grid').length, 1);
  assert.equal(by({ ...passive, values: { thetaRole: 'Agent assignment is pending' } }, 'theta-grid').length, 0);
  assert.equal(by({ ...passive, values: { thetaRole: 'Agent assignment denied' } }, 'theta-grid').length, 0);
});

test('argument licensing preserves an independently explicit Case source and qualified internal recipient', () => {
  const relation = { relation: 'matrix argument licensing', anchors: { licensingHead: 't', internalArgument: 'object', predicate: 'v', externalArgument: 'subject' },
    values: { internalRole: 'theme', externalRole: 'agent', objectCase: 'opaque object Case' } };
  const claims = by(relation, 'feature.dependency');
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0].facet.evidence.currentAnchors, { 'feature.source': ['t'], 'feature.target': ['object'] });
  assert(used(claims[0], 'objectCase'));
  assert(!used(claims[0], 'predicate'));
  assert.equal(by({ ...relation, relation: 'no agreement; matrix argument licensing' }, 'feature.dependency').length, 1);
  for (const altered of [
    { ...relation, anchors: { internalArgument: 'object', predicate: 'v' } },
    { ...relation, anchors: { ...relation.anchors, licensingHead: undefined, inflection: 't' }, values: { ...relation.values, agreement: 'plural' } },
    { ...relation, anchors: { ...relation.anchors, probe: 'otherT' } },
    { ...relation, anchors: { ...relation.anchors, goal: 'subject' } },
    { ...relation, values: { ...relation.values, status: 'pending' } },
    { ...relation, relation: 'Denied matrix argument licensing' },
    { ...relation, relation: 'matrix argument licensing if licensed' }
  ]) assert.equal(by(altered, 'feature.dependency').length, 0);
  assert.equal(by(relation, 'feature.dependency', [...forest, leaf('t', 'T')]).length, 0);
  const detached = structuredClone(forest); detached[0].children = detached[0].children.filter(node => node.id !== 't'); detached.push(leaf('t', 'T'));
  assert.equal(by(relation, 'feature.dependency', detached).length, 0);
});

test('a collective surface form excludes only its exact enclosing constituent context', () => {
  const objects = [{ id: 'root', label: 'PP', children: [
    { id: 'nominal', label: 'NP', children: [leaf('stem', 'N⁰')] }, leaf('suffix', 'P⁰')
  ] }];
  const group = { nodeIds: ['stem', 'suffix'], tokenIndices: [0] };
  const relation = { relation: 'locative Case and suffix realization', anchors: { nominalHost: 'stem', locativeHead: 'suffix', nominalProjection: 'nominal' },
    values: { case: 'locative', surfaceForm: 'literal combined form' } };
  const claims = by(relation, 'pf.structured', objects, undefined, [group]); assert.equal(claims.length, 1);
  assert.deepEqual(claims[0].facet.evidence.currentAnchors['rewrite.output'], ['stem', 'suffix']);
  assert(used(claims[0], 'surfaceForm')); assert(!used(claims[0], 'nominalProjection')); assert(!used(claims[0], 'case'));
  assert.equal(by({ ...relation, relation: 'no Case; suffix realization' }, 'pf.structured', objects, undefined, [group]).length, 1);
  assert.equal(by({ ...relation, relation: 'failed agreement; suffix realization', values: { ...relation.values, status: 'failed' } }, 'pf.structured', objects, undefined, [group]).length, 1);
  for (const altered of [
    { ...relation, anchors: { ...relation.anchors, nominalProjection: 'unrelated' } },
    { ...relation, relation: 'no suffix realization; suffix realization' },
    { ...relation, values: { ...relation.values, realizationStatus: 'pending' } }
  ]) assert.equal(by(altered, 'pf.structured', [...objects, leaf('unrelated', 'DP')], undefined, [group]).length, 0);
  const explicitOutput = by({ ...relation, anchors: { ...relation.anchors, output: 'nominal' } }, 'pf.structured', objects, undefined, [group]);
  assert.equal(explicitOutput.length, 1);
  assert(used(explicitOutput[0], 'output'), 'the native explicit output retains its original authority');
  assert.equal(by(relation, 'pf.structured', objects, undefined, [group, { nodeIds: ['stem'], tokenIndices: [0] }]).length, 0);
  const contradictory = { relation: 'no argument licensing; matrix argument licensing', anchors: { licensingHead: 't', internalArgument: 'object' }, values: { internalRole: 'theme', objectCase: 'opaque' } };
  assert.equal(by(contradictory, 'feature.dependency').length, 0);
});

test('one exact collective PF plate replaces only the same literal on its proper subset owner', () => {
  const objects = [{ id: 'complex', label: 'I', children: [leaf('v', 'V'), leaf('i', 'I')] }];
  const group = { nodeIds: ['v', 'i'], tokenIndices: [0] };
  const relation = { relation: 'past-predicate realization', anchors: { complex: 'complex', verb: 'v', tense: 'i' },
    priorAnchors: { verb: 'v', tense: 'i' }, values: { surfaceForm: 'whole realized word', tense: 'past' } };
  const stages = [{ statement: '', stageRecord: '', workspaceForest: objects, realizations: [group], relations: [relation] }];
  const claims = by(relation, 'pf.structured', objects, objects, [group]);
  assert.equal(claims.filter(claim => used(claim, 'surfaceForm')).length, 1);
  const whole = claims.find(claim => used(claim, 'surfaceForm'));
  assert.deepEqual(whole.facet.evidence.currentAnchors['rewrite.output'], ['v', 'i']);
  assert(claims.some(claim => used(claim, 'tense')), 'the independent abstract tense row keeps its original owner');
  const plates = compileRelationRenderPlan(stages).frames[0].items.filter(item => item.kind === 'node-plaque' && item.plaqueStyle === 'realization');
  assert.equal(plates.flatMap(plate => plate.rows).filter(row => row.label === 'surfaceForm').length, 1);
  assert(plates.flatMap(plate => plate.rows).some(row => row.label === 'tense'));
  const noGroup = by(relation, 'pf.structured', objects, objects, []);
  assert(noGroup.some(claim => used(claim, 'surfaceForm')), 'without exact group proof the original member-only property survives');
});
