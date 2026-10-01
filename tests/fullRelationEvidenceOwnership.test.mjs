import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const leaf = (id, label, word = id) => ({ id, label, word });
const forest = [leaf('finite', 'T'), leaf('otherFinite', 'T'), leaf('verb', 'V[base]'),
  leaf('subject', 'DP'), leaf('recipient', 'DP'), leaf('theme', 'DP'), leaf('adjective', 'A'),
  leaf('demonstrative', 'D'), leaf('noun', 'N'), leaf('relative', 'C'), leaf('resumptive', 'D')];
const dispatch = (relation, currentForest = forest) => dispatchRelationClaims({ relation,
  currentForest, stageIndex: 3, relationIndex: 2 });
const items = (relation, workspaceForest = forest) => compileRelationRenderPlan([
  { statement: '', stageRecord: '', workspaceForest, relations: [relation] }
]).frames[0].items;
const plaques = (relation, currentForest) => items(relation, currentForest)
  .filter(item => item.tier2FacetId === 'plaque.structured');
const recipes = (relation, currentForest) => dispatch(relation, currentForest).claims
  .filter(claim => claim.tier === 2).map(claim => claim.facet.recipe.id);

test('explicit same-key Case properties survive a malformed exact assignment without rescuing its path', () => {
  const relation = { relation: 'Case assignment',
    anchors: { assigners: ['finite', 'verb'], recipients: ['subject', 'recipient'] },
    values: { recipients: ['nominative', 'an unfamiliar Case literal'] } };
  const before = structuredClone(relation), result = dispatch(relation), drawn = items(relation);
  assert.equal(result.primaryClaim.tier, 3);
  assert.equal(result.primaryClaim.reason, 'registered-signature-incomplete');
  assert.deepEqual(recipes(relation), ['plaque.structured', 'plaque.structured']);
  assert(!drawn.some(item => item.kind === 'directed-path'));
  assert.deepEqual(drawn.filter(item => item.tier2FacetId === 'plaque.structured')
    .map(item => [item.anchorNodeIds, item.rows]), [
    [['subject'], [{ label: 'recipients', value: 'nominative' }]],
    [['recipient'], [{ label: 'recipients', value: 'an unfamiliar Case literal' }]]
  ]);
  assert.deepEqual(result.claims.filter(claim => claim.tier === 2).map(claim => claim.consumedEvidence), [
    [{ field: 'anchors', key: 'recipients', itemIndices: [0] }, { field: 'values', key: 'recipients', itemIndices: [0] }],
    [{ field: 'anchors', key: 'recipients', itemIndices: [1] }, { field: 'values', key: 'recipients', itemIndices: [1] }]
  ]);
  assert.deepEqual(result.primaryRelation.anchors, { assigners: relation.anchors.assigners });
  assert.deepEqual(result.relationInstance, { stageIndex: 3, relationIndex: 2 });
  assert.deepEqual(relation, before);
});

test('paired Case properties require exact keys, complete lists, distinct owners and asserted Case', () => {
  const relation = { relation: 'Case assignment',
    anchors: { assigners: ['finite', 'verb'], recipients: ['subject', 'recipient'] },
    values: { recipients: ['nominative', 'opaque Case'] } };
  for (const changed of [
    { ...relation, values: { recipients: ['nominative'] } },
    { ...relation, values: { recipient: ['nominative', 'opaque Case'] } },
    { ...relation, values: { recipients: ['nominative', ''] } },
    { ...relation, anchors: { ...relation.anchors, recipients: ['subject', 'subject'] } },
    { ...relation, values: { ...relation.values, status: 'pending' } },
    ...['No', 'Not', 'Denied', 'Possible', 'Failed', 'Pending'].map(prefix => ({ ...relation, relation: `${prefix} Case assignment` })),
    { ...relation, relation: 'Case assignment if licensed' },
    { ...relation, relation: 'Case assignment unless blocked' },
    { ...relation, relation: 'An observation about participants' },
    { ...relation, anchors: { recipients: relation.anchors.assigners }, values: { recipients: relation.values.recipients },
      relation: 'Case assignment', relationContractFailure: { code: 'malformed-relation' } }
  ]) assert.equal(plaques(changed).length, 0, JSON.stringify(changed));
  const duplicateOwner = [...forest, leaf('subject', 'DP')];
  assert(!plaques(relation, duplicateOwner).some(plaque => plaque.anchorNodeIds.includes('subject')));
  const missingOwner = forest.filter(node => node.id !== 'recipient');
  assert(!plaques(relation, missingOwner).some(plaque => plaque.anchorNodeIds.includes('recipient')));
  const differentOrder = { ...relation, anchors: { ...relation.anchors, recipients: ['recipient', 'subject'] } };
  assert.deepEqual(plaques(differentOrder).map(plaque => [plaque.anchorNodeIds[0], plaque.rows[0].value]),
    [['recipient', 'nominative'], ['subject', 'opaque Case']]);
});

test('compound Case properties coexist with the independently authored agreement dependency', () => {
  const relation = { relation: 'Finite agreement and unmarked structural case',
    anchors: { caseMarkedNonGoals: ['subject', 'recipient'], goal: 'theme', probe: 'finite', nominalFeatureSource: 'noun' },
    values: { caseMarkedNonGoals: ['ergative', 'unfamiliar dependent Case'], agreement: 'feminine singular', goalCase: 'unmarked structural case' } };
  assert(recipes(relation).includes('feature.dependency'));
  assert.deepEqual(plaques(relation).map(plaque => [plaque.anchorNodeIds[0], plaque.rows[0].value]),
    [['subject', 'ergative'], ['recipient', 'unfamiliar dependent Case']]);
  assert(items(relation).some(item => item.kind === 'directed-path' && item.toNodeId === 'theme'));
  const independent = { relation: 'failed agreement; Case assignment',
    anchors: { recipients: ['subject', 'recipient'] }, values: { recipients: ['nominative', 'opaque Case'] } };
  assert.equal(plaques(independent).length, 2);
  assert.equal(plaques({ ...independent, relation: 'agreement; failed Case assignment' }).length, 0);
});

test('a complete registered Case primary retains its curated drawing', () => {
  const relation = { relation: 'Case assignment', anchors: { assigner: 'finite', recipient: 'subject' },
    values: { case: 'nominative' } };
  const result = dispatch(relation);
  assert.equal(result.primaryClaim.tier, 1);
  assert(!recipes(relation).includes('plaque.structured'));
});

test('participant-qualified inflection and class facts keep one exact owner without inventing agreement', () => {
  for (const relation of [
    { relation: 'Nominal concord', anchors: { adjective: 'adjective', demonstrative: 'demonstrative', noun: 'noun' },
      values: { number: 'plural', adjectiveInflection: 'weak inflection' } },
    { relation: 'relative concord', anchors: { antecedent: 'noun', relativeMarker: 'relative', resumptive: 'resumptive' },
      values: { antecedentClass: 'nonhuman plural', concord: 'feminine singular' } }
  ]) {
    const before = structuredClone(relation), properties = plaques(relation);
    const key = Object.keys(relation.values).find(key => /Inflection|Class/u.test(key));
    const owner = key === 'adjectiveInflection' ? 'adjective' : 'noun';
    assert.deepEqual(properties.map(plaque => [plaque.anchorNodeIds, plaque.rows]),
      [[[owner], [{ label: key, value: relation.values[key] }]]]);
    assert(!items(relation).some(item => item.kind === 'directed-path' && item.fromNodeId === owner));
    assert.deepEqual(relation, before);
  }
  const unqualified = { relation: 'relative concord', anchors: { antecedent: 'noun', relativeMarker: 'relative' },
    values: { class: 'nonhuman plural', concord: 'feminine singular' } };
  assert.equal(plaques(unqualified).length, 0);
  assert.equal(plaques({ ...unqualified, anchors: { antecedent: ['noun', 'subject'] },
    values: { antecedentClass: 'nonhuman plural' } }).length, 0);
});

test('qualified property recovery rejects local denial, provisional facts and nonunique current owners', () => {
  for (const [property, owner] of [['Inflection', 'adjective'], ['Class', 'noun'], ['Mood', 'verb'],
    ['Aspect', 'verb'], ['Polarity', 'verb'], ['Voice', 'verb'], ['Definiteness', 'noun'], ['Finiteness', 'verb']]) {
    const key = `${owner}${property}`, relation = { relation: `${property} specification`,
      anchors: { [owner]: owner }, values: { [key]: 'opaque literal' } };
    assert.equal(plaques(relation).length, 1, property);
    for (const prefix of ['No', 'Possible', 'Pending', 'Required', 'Failed'])
      assert.equal(plaques({ ...relation, relation: `${prefix} ${relation.relation}` }).length, 0, `${prefix} ${property}`);
    assert.equal(plaques({ ...relation, relation: `${property} specification if licensed` }).length, 0, property);
    assert.equal(plaques({ ...relation, values: { ...relation.values, status: 'pending' } }).length, 0, property);
    assert.equal(plaques(relation, [...forest, leaf(owner, 'N')]).length, 0, property);
    assert.equal(plaques(relation, forest.filter(node => node.id !== owner)).length, 0, property);
    const sibling = { ...relation, relation: `failed agreement; ${property} specification` };
    assert.equal(plaques(sibling).length, 1, `independent ${property}`);
  }
});

test('a licensed verbal form requires the exact current lexical head to record that form', () => {
  const relation = { relation: 'auxiliary form licensing', anchors: { auxiliary: 'finite', lexicalVerb: 'verb' },
    values: { licensedVerbForm: 'base', tense: 'past' } };
  assert.deepEqual(plaques(relation).filter(plaque => plaque.rows.some(row => row.label === 'licensedVerbForm'))
    .map(plaque => [plaque.anchorNodeIds[0], plaque.rows]),
    [['verb', [{ label: 'licensedVerbForm', value: 'base' }]]]);
  assert(!items(relation).some(item => item.tier2FacetId === 'pf.rewrite'));
  for (const changed of [
    forest.map(node => node.id === 'verb' ? { ...node, label: 'V' } : node),
    forest.map(node => node.id === 'verb' ? { ...node, label: 'N[base]' } : node),
    forest.map(node => node.id === 'verb' ? { ...node, label: 'V[required base]' } : node),
    forest.map(node => node.id === 'verb' ? { id: 'verb', label: 'VP[base]', children: [leaf('inner', 'V[base]')] } : node),
    [...forest, leaf('verb', 'V[base]')]
  ]) assert(!plaques(relation, changed).some(plaque => plaque.rows.some(row => row.label === 'licensedVerbForm')));
  for (const altered of [
    { ...relation, anchors: { ...relation.anchors, verb: 'noun' } },
    { ...relation, values: { ...relation.values, status: 'pending' } },
    { ...relation, relation: 'possible auxiliary form licensing' }
  ]) assert(!plaques(altered).some(plaque => plaque.rows.some(row => row.label === 'licensedVerbForm')));
});

test('an explicitly anchored nominal within a topical PP gets reference coindices without a path', () => {
  const currentForest = [{ id: 'topicalPP', label: 'PP', children: [leaf('prep', 'P'), leaf('referent', 'DP')] },
    leaf('pronoun', 'DP'), leaf('clitic', 'D')];
  const relation = { relation: 'dative topic resumption',
    anchors: { topic: 'topicalPP', referentialNominal: 'referent', resumptiveArgument: 'pronoun', clitic: 'clitic' },
    values: { dependency: 'the separately anchored nominal is resumed by the pronoun' } };
  const before = structuredClone(relation), drawn = items(relation, currentForest);
  assert.deepEqual(drawn.find(item => item.familyId === 'coreference.coindex').nodeIds, ['referent', 'pronoun']);
  assert(!drawn.some(item => item.kind === 'directed-path' || item.tier2FacetId === 'identity.occurrences'));
  assert.deepEqual(drawn.find(item => item.kind === 'fallback').relationRef.anchors,
    { topic: 'topicalPP', clitic: 'clitic' });
  assert.deepEqual(relation, before);
  assert(recipes({ ...relation, relation: 'unfamiliar-topic-qualification topic resumption' }, currentForest)
    .includes('coreference.coindex'));
  for (const altered of [
    { ...relation, relation: 'topic and pronoun configuration' },
    { ...relation, anchors: { ...relation.anchors, antecedent: 'clitic' } },
    { ...relation, anchors: { ...relation.anchors, referentialNominal: 'missing' } },
    { ...relation, values: { ...relation.values, status: 'pending' } },
    ...['No', 'Possible', 'Failed'].map(prefix => ({ ...relation, relation: `${prefix} ${relation.relation}` }))
  ]) assert(!recipes(altered, currentForest).includes('coreference.coindex'), JSON.stringify(altered));
  const detached = [{ id: 'topicalPP', label: 'PP', children: [leaf('prep', 'P')] }, leaf('referent', 'DP'),
    leaf('pronoun', 'DP'), leaf('clitic', 'D')];
  assert(!recipes(relation, detached).includes('coreference.coindex'));
});

test('typed theta assignments retain explicitly named predicate heads and assigning verbs', () => {
  const currentForest = [{ id: 'domain', label: 'VP', children: structuredClone(forest) }];
  for (const source of ['predicateHead', 'assigningVerb']) {
    const relation = { relation: 'external theta-role assignment', anchors: { [source]: 'verb', subject: 'subject' },
      values: { thetaRole: 'opaque thematic role' } };
    const drawn = items(relation, currentForest).find(item => item.plaqueStyle === 'theta-grid');
    assert.deepEqual(drawn.thetaRoles.map(role => [role.nodeId, role.label]), [['subject', 'opaque thematic role']]);
    assert.deepEqual(dispatch(relation, currentForest).claims.find(claim => claim.tier === 2).consumedEvidence,
      [{ field: 'anchors', key: source, itemIndices: [0] }, { field: 'anchors', key: 'subject', itemIndices: [0] },
        { field: 'values', key: 'thetaRole', itemIndices: [0] }]);
    for (const changed of [
      { ...relation, relation: 'possible external theta-role assignment' },
      { ...relation, relation: 'no external theta-role assignment' },
      { ...relation, relation: 'external theta-role assignment if licensed' },
      { ...relation, relation: 'internal role assignment if licensed', anchors: { lexicalPredicate: 'verb', argument: 'subject' } },
      { ...relation, anchors: { ...relation.anchors, predicate: 'noun' } },
      { ...relation, values: { thetaRole: ['Agent', 'Theme'] } },
      { ...relation, anchors: { [source]: 'missing', subject: 'subject' } }
    ]) assert(!recipes(changed, currentForest).includes('theta-grid'), JSON.stringify(changed));
    assert(!recipes(relation, [...currentForest, leaf('verb', 'V')]).includes('theta-grid'));
    assert(!recipes(relation, forest).includes('theta-grid'), 'separate workspaces do not establish assignment');
  }
});

test('an asserted Case scope binds a governing head and its exact nominal dependent', () => {
  const currentForest = [{ id: 'domain', label: 'VP', children: structuredClone(forest) }];
  for (const source of ['governor', 'governingHead']) {
    const relation = { relation: 'government and Case assignment', anchors: { [source]: 'verb', dependent: 'subject' },
      values: { case: 'unfamiliar Case' } };
    const path = items(relation, currentForest).find(item => item.kind === 'directed-path');
    assert.equal(path.fromNodeId, 'verb'); assert.equal(path.toNodeId, 'subject');
    assert.equal(path.pathStyle, 'case-assignment');
    for (const changed of [
      { ...relation, relation: 'government' },
      { ...relation, relation: 'government and possible Case assignment' },
      { ...relation, anchors: { ...relation.anchors, finiteHead: 'finite' } },
      { ...relation, anchors: { [source]: 'verb', dependent: 'missing' } },
      { ...relation, anchors: { [source]: 'verb', dependent: ['subject', 'recipient'] } },
      { ...relation, values: { case: 'unfamiliar Case', status: 'pending' } }
    ]) assert(!items(changed, currentForest).some(item => item.kind === 'directed-path'), JSON.stringify(changed));
    assert(!items(relation, [...currentForest, leaf('subject', 'DP')]).some(item => item.kind === 'directed-path'));
  }
});

test('several explicit failure clauses preserve the negative feature comparison', () => {
  const relation = { relation: 'demonstrative–noun concord failure',
    anchors: { determiner: 'demonstrative', nominal: 'subject', noun: 'noun' },
    values: { determinerNumber: 'plural', nounNumber: 'singular', status: 'incompatible; no successful number concord' } };
  const paths = items(relation).filter(item => item.kind === 'directed-path');
  assert.equal(paths.length, 2);
  assert(paths.every(path => path.outcome === 'blocked' && path.fromNodeId === 'demonstrative' && path.toNodeId === 'noun'));
  assert.deepEqual(paths.map(path => path.featureRow),
    [{ label: 'determinerNumber', value: 'plural' }, { label: 'nounNumber', value: 'singular' }]);
  for (const status of ['incompatible; possibly no successful number concord', 'incompatible; compatible',
    'incompatible; successful number concord', 'not incompatible; no successful number concord', 'pending; no successful number concord'])
    assert(!recipes({ ...relation, values: { ...relation.values, status } }).includes('feature.dependency'), status);
});

test('one explicit covert clause keeps the QR recipe inside a compound relation', () => {
  const lower = { id: 'lower', label: 'DP', word: 'a report', lineageId: 'quantifier' };
  const priorForest = [{ id: 'clause', label: 'IP', children: [lower] }];
  const currentForest = [{ id: 'raisedClause', label: 'IP', children: [
    { ...lower, id: 'upper', silent: true }, structuredClone(priorForest[0])
  ] }];
  const relation = { relation: 'Covert Quantifier Raising and A-bar chain formation',
    anchors: { argumentCopy: 'lower', operatorCopy: 'upper' }, priorAnchors: { source: 'lower' } };
  const recover = record => dispatchRelationClaims({ relation: record, currentForest, priorForest, stageIndex: 1, relationIndex: 0 });
  assert(recover(relation).facets.some(facet => facet.recipe.id === 'scope.movement'));
  assert(!recover(relation).facets.some(facet => facet.recipe.id === 'movement.path'));
  for (const label of ['Possible Covert Quantifier Raising and A-bar chain formation',
    'A claim about Covert Quantifier Raising and A-bar chain formation', 'Covert Quantifier Raising and Covert subject raising',
    'Covert Quantifier Raising; no covert movement', 'Covert Quantifier Raising; covert movement is pending'])
    assert(!recover({ ...relation, relation: label }).facets.some(facet => facet.recipe.id === 'scope.movement'), label);
  assert(recover({ ...relation, relation: 'Covert Quantifier Raising; failed agreement' }).facets.some(facet => facet.recipe.id === 'scope.movement'));
  const missingPrevious = dispatchRelationClaims({ relation, currentForest, priorForest: [], stageIndex: 1, relationIndex: 0 });
  assert(!missingPrevious.facets.some(facet => facet.recipe.id === 'scope.movement'));
});

test('a named feature bearer within an exact goal does not become a competing agreement target', () => {
  const goal = { id: 'goal', label: 'KP', children: [leaf('case', 'K'), leaf('bearingNoun', 'N')] };
  const currentForest = [{ id: 'clause', label: 'TP', children: [goal, leaf('probe', 'T')] }];
  const relation = { relation: 'Agree and unmarked case licensing',
    anchors: { goal: 'goal', featureBearer: 'bearingNoun', probe: 'probe' },
    values: { agreement: 'feminine singular', goalCase: 'opaque Case' } };
  const drawn = items(relation, currentForest), path = drawn.find(item => item.kind === 'directed-path');
  assert.equal(path.fromNodeId, 'probe'); assert.equal(path.toNodeId, 'goal');
  assert(!drawn.some(item => item.kind === 'directed-path' && item.toNodeId === 'bearingNoun'));
  assert.deepEqual(drawn.find(item => item.kind === 'fallback').relationRef.anchors, { featureBearer: 'bearingNoun' });
  for (const changed of [
    { ...relation, anchors: { ...relation.anchors, featureTarget: 'bearingNoun' } },
    { ...relation, anchors: { ...relation.anchors, goal: ['goal', 'bearingNoun'] } },
    { ...relation, relation: 'Possible Agree and unmarked case licensing' }
  ]) assert(!items(changed, currentForest).some(item => item.kind === 'directed-path'), JSON.stringify(changed));
  const detached = [{ id: 'goal', label: 'KP', children: [leaf('case', 'K')] },
    leaf('bearingNoun', 'N'), leaf('probe', 'T')];
  assert(!items(relation, detached).some(item => item.kind === 'directed-path'));
  assert(!items(relation, [...currentForest, leaf('bearingNoun', 'N')]).some(item => item.kind === 'directed-path'));
});

test('an asserted agreement head keeps its nominal controller and contextual verb separate', () => {
  const relation = { relation: 'possessive agreement', anchors: { agreementHead: 'finite', controller: 'subject', inflectedVerb: 'verb' },
    values: { features: 'third-person singular', overtForm: 'verbal form' } };
  const drawn = items(relation), path = drawn.find(item => item.kind === 'directed-path');
  assert.equal(path.fromNodeId, 'finite'); assert.equal(path.toNodeId, 'subject');
  assert(!drawn.some(item => item.kind === 'directed-path' && item.toNodeId === 'verb'));
  for (const currentForest of [forest.map(node => node.id === 'finite' ? { ...node, label: 'N' } : node),
    forest.map(node => node.id === 'finite' ? { ...node, label: 'IP' } : node), [...forest, leaf('finite', 'T')],
    [...forest, leaf('subject', 'DP')]])
    assert(!items(relation, currentForest).some(item => item.kind === 'directed-path'));
  for (const changed of [{ ...relation, relation: 'possible possessive agreement' },
    ...['if licensed', 'unless blocked', 'whether licensed'].map(suffix => ({ ...relation, relation: `possessive agreement ${suffix}` })),
    { ...relation, anchors: { ...relation.anchors, probe: 'otherFinite' } },
    { ...relation, anchors: { ...relation.anchors, goal: 'recipient' } }])
    assert(!items(changed).some(item => item.kind === 'directed-path'));
  const auxiliary = { relation: 'negative-auxiliary agreement', anchors: { auxiliary: 'finite', controller: 'subject' },
    values: { number: 'plural', person: 'third' } };
  assert(items(auxiliary).some(item => item.kind === 'directed-path' && item.fromNodeId === 'finite' && item.toNodeId === 'subject'));
  assert(!items(auxiliary, [...forest, leaf('subject', 'DP')]).some(item => item.kind === 'directed-path'));
  assert(!items({ ...auxiliary, relation: 'negative-auxiliary agreement if licensed' }).some(item => item.kind === 'directed-path'));
});

test('explicit resumptive subject and object names keep binding distinct from topic reference', () => {
  for (const role of ['resumptiveSubject', 'resumptiveObject']) {
    const binding = { relation: 'Relative operator binding', anchors: { operator: 'subject', [role]: 'resumptive' } };
    assert(recipes(binding).includes('binding.dependency'));
    assert(!recipes(binding).includes('coreference.coindex'));
    assert(!recipes(binding, [...forest, leaf('resumptive', 'D')]).includes('binding.dependency'));
    const reference = { relation: 'Topic-resumptive dependency', anchors: { topic: 'subject', [role]: 'resumptive', topicHead: 'finite' } };
    assert(recipes(reference).includes('coreference.coindex'));
    assert(!recipes(reference).some(recipe => ['binding.dependency', 'identity.occurrences'].includes(recipe)));
    for (const prefix of ['No', 'Possible', 'Failed']) {
      assert(!recipes({ ...binding, relation: `${prefix} ${binding.relation}` }).includes('binding.dependency'));
      assert(!recipes({ ...reference, relation: `${prefix} ${reference.relation}` }).includes('coreference.coindex'));
    }
  }
});

test('qualified theta, focus and modification assertions retain exact existing participants', () => {
  const workspaceForest = [{ id: 'scope', label: 'VP', children: [leaf('predicate', 'V'), leaf('argument', 'CP')] }];
  const theta = { relation: 'propositional theta-role assignment', anchors: { predicateHead: 'predicate', argument: 'argument' },
    values: { thetaRole: 'propositional content' } };
  assert(recipes(theta, workspaceForest).includes('theta-grid'));
  assert(!recipes({ ...theta, relation: 'possible propositional theta-role assignment' }, workspaceForest).includes('theta-grid'));
  assert(!recipes({ ...theta, relation: 'propositional theta-role assignment if licensed' }, workspaceForest).includes('theta-grid'));
  const focus = { relation: 'restrictive focus association', anchors: { operator: 'finite', associate: 'subject' } };
  assert(recipes(focus).includes('focus.association'));
  for (const record of [{ ...focus, relation: 'possible restrictive focus association' },
    { ...focus, relation: 'restrictive focus association if licensed' }, { ...focus, relation: 'operator interpretation' },
    { ...focus, values: { status: 'pending' } }, { ...focus, anchors: { ...focus.anchors, particle: 'verb' } }])
    assert(!recipes(record).includes('focus.association'));
  assert(!recipes(focus, [...forest, leaf('subject', 'DP')]).includes('focus.association'));
  const host = { id: 'event', label: 'V', children: [leaf('predicate', 'V')] };
  const modifier = leaf('modifier', 'Adv', 'yesterday');
  const attachment = [{ id: 'modified', label: 'V', children: [host, modifier] }];
  for (const role of ['scope', 'eventPredicate']) {
    const record = { relation: 'temporal modification', anchors: { [role]: 'event', modifier: 'modifier' } };
    assert(recipes(record, attachment).includes('pair-merge'));
    assert(!recipes({ ...record, relation: 'possible temporal modification' }, attachment).includes('pair-merge'));
    assert(!recipes({ ...record, anchors: { [role]: 'predicate', modifier: 'modifier' } }, attachment).includes('pair-merge'));
    assert(!recipes(record, [...attachment, structuredClone(host)]).includes('pair-merge'));
  }
});

test('topic reference and explicitly licensed topic binding use their own declared pairs', () => {
  const lower = leaf('low', 'D'), upper = leaf('high', 'D'), topic = leaf('topic', 'DP');
  lower.lineageId = upper.lineageId = 'argument';
  const currentForest = [topic, lower, upper];
  const reference = { relation: 'Hanging-topic discourse coreference',
    anchors: { discourseTopic: 'topic', anaphoricClitic: 'high', argumentOccurrence: 'low' } };
  assert(recipes(reference, currentForest).includes('coreference.coindex'));
  const binding = { relation: 'Integrated topic-resumption dependency',
    anchors: { topic: 'topic', resumptiveClitic: 'high', argumentOccurrence: 'low' },
    values: { dependency: 'syntactically licensed topic binding' } };
  assert(recipes(binding, currentForest).includes('binding.dependency'));
  assert(!recipes(binding, currentForest).includes('coreference.coindex'));
  for (const dependency of ['possible syntactically licensed topic binding', 'syntactically licensed topic binding if licensed',
    'discourse coreference, not obligatory syntactic topic binding'])
    assert(!recipes({ ...binding, values: { dependency } }, currentForest).includes('binding.dependency'));
  for (const record of [reference, binding])
    assert(!recipes(record, [...currentForest, structuredClone(upper)]).some(recipe => ['coreference.coindex', 'binding.dependency'].includes(recipe)));
  for (const role of ['topic', 'pronoun']) {
    const declared = { relation: 'topic–pronoun referential dependency', anchors: { topic: 'topic', pronoun: 'high' } };
    assert(recipes(declared, currentForest).includes('coreference.coindex'));
    assert(!recipes({ ...declared, anchors: { ...declared.anchors, [role]: ['topic', 'high'] } }, currentForest).includes('coreference.coindex'));
  }
});
