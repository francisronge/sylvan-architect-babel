import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';

const forest = [{ id: 'clause', label: 'IP', children: [
  { id: 'subject', label: 'DP', word: 'Mia', lineageId: 'argument' },
  { id: 'ibar', label: 'I′', children: [
    { id: 'infl', label: 'I', silent: true },
    { id: 'vp', label: 'VP', children: [
      { id: 'verb', label: 'V', word: 'reads' }, { id: 'object', label: 'DP', word: 'books' }
    ] }
  ] }
] }];
const dispatch = (relation, currentForest = forest) => dispatchRelationClaims({ relation, currentForest, stageIndex: 0, relationIndex: 0 });
const plan = relation => compileRelationRenderPlan([{ statement: 'Authored state', stageRecord: '', workspaceForest: forest, relations: [relation] }]).frames[0].items;
const facet = (relation, id, currentForest) => dispatch(relation, currentForest).facets.some(f => f.recipe.id === id);

test('Case labels supply literal values while exact endpoints and original records remain intact', () => {
  for (const source of ['licenser', 'caseAssigner', 'caseLicensor']) {
    const relation = { relation: 'nominative Case licensing', anchors: { [source]: 'infl', subject: 'subject' } };
    const before = structuredClone(relation);
    const path = plan(relation).find(item => item.pathStyle === 'case-assignment');
    assert.equal(path?.fromNodeId, 'infl');
    assert.equal(path?.toNodeId, 'subject');
    assert.equal(path?.featureRow?.value || path?.label, 'nominative');
    assert.deepEqual(relation, before);
    assert.deepEqual(path.relationRef.anchors, before.anchors);
  }
  for (const relation of [
    { relation: 'possibly nominative Case licensing', anchors: { licenser: 'infl', subject: 'subject' } },
    { relation: 'nominative Case licensing', anchors: { licenser: 'infl', subject: 'missing' } },
    { relation: 'nominative Case licensing', anchors: { licenser: 'infl', subject: 'subject', object: 'object' } },
    { relation: 'nominative Case licensing', anchors: { licenser: 'infl', subject: 'subject' }, values: { status: 'unlicensed' } },
    { relation: 'nominative Case licensing', anchors: { unrelated: 'infl', object: 'object' } }
  ]) assert(!plan(relation).some(item => item.pathStyle === 'case-assignment'), JSON.stringify(relation));
});

test('declared Case values require direction or a corroborated head in an explicit Case claim', () => {
  for (const [name, key] of [['Case licensing', 'caseAssigner'], ['lexically selected Case', 'licensor']]) {
    const relation = { relation: name, anchors: { [key]: 'verb', recipient: 'object' }, values: { case: 'dative' } };
    assert(facet(relation, 'feature.dependency'), JSON.stringify(relation));
  }
  const relation = { relation: 'Case assignment', anchors: { assigner: 'verb', finiteLicensor: 'infl', recipient: 'object' }, values: { case: 'accusative' } };
  assert.equal(plan(relation).find(item => item.pathStyle === 'case-assignment')?.fromNodeId, 'verb');
  const governing = { relation: 'Case licensing', anchors: { governingPosition: 'verb', subject: 'subject' }, values: { case: 'nominative' } };
  assert.equal(plan(governing).find(item => item.pathStyle === 'case-assignment')?.fromNodeId, 'verb');
  for (const key of ['marker', 'caseHead', 'finiteHead', 'inflection', 'selector']) {
    const marking = { relation: 'Case licensing', anchors: { [key]: 'verb', subject: 'subject' }, values: { case: 'nominative' } };
    assert(!plan(marking).some(item => item.pathStyle === 'case-assignment'));
    assert(plan(marking).some(item => item.kind === 'node-plaque' && item.anchorNodeIds.includes('subject')));
  }
});

test('morphological claims show authored form and tense at the lexical host without a Case arrow', () => {
  const relation = { relation: 'Finite tense compatibility', anchors: { tense: 'infl', verb: 'verb' },
    values: { tenseValue: 'past', morphologicalCommitment: 'whole-word form' } };
  assert(facet(relation, 'pf.structured'));
  assert(!plan(relation).some(item => item.kind === 'directed-path'));
  const plate = plan(relation).find(item => item.plaqueStyle === 'realization');
  assert(plate || plan(relation).some(item => item.anchorNodeIds?.includes('verb') && item.kind === 'node-plaque'));
  for (const candidate of [
    { ...relation, relation: 'A general description' },
    { ...relation, relation: 'Failed finite tense compatibility' },
    { ...relation, anchors: { ...relation.anchors, lexicalVerb: 'object' } },
    { ...relation, values: { requiredForm: 'participle' } }
  ]) assert(!facet(candidate, 'pf.structured'), JSON.stringify(candidate));
});

test('qualified judgments preserve the entire text as one anchored glyph and label', () => {
  for (const literal of ['grammatical in standard Hindi', 'illicit under the adopted locality theory', 'grammatical with contrastive focus prosody', 'grammatical on the contextually supported past-tense reading', 'syntactically licensed, semantically and pragmatically marked']) {
    const relation = { relation: 'derivational judgment', anchors: { completedClause: 'clause' }, values: { judgment: literal } };
    const before = structuredClone(relation);
    const verdict = plan(relation).find(item => item.kind === 'analysis-verdict');
    assert(verdict, literal);
    assert.equal(verdict.analysisNodeId, 'clause');
    assert.equal(`${verdict.judgment}${verdict.label.startsWith(',') ? '' : ' '}${verdict.label}`, literal);
    assert.deepEqual(relation, before);
  }
  assert(!facet({ relation: 'derivational judgment', anchors: { clause: 'clause' },
    values: { judgment: 'It is unclear whether a grammatical derivation is possible.' } }, 'judgment.verdict'));
});

test('focus restrictions and polarity licensing retain their specified participants', () => {
  assert(facet({ relation: 'sentential focus restriction', anchors: { restrictor: 'verb', restrictedClause: 'clause' }, values: { scope: 'IP' } }, 'focus.association'));
  assert(!facet({ relation: 'temporal restriction', anchors: { restrictor: 'verb', restrictedClause: 'clause' } }, 'focus.association'));
  assert(facet({ relation: 'negative-polarity licensing', anchors: { cCommandingLicensor: 'infl', licensedItem: 'object' } }, 'polarity.licensing'));
});

test('intervention recognizes an explicit denial of access to its named participant', () => {
  const relation = { relation: 'interrogative intervention', anchors: { probe: 'infl', intendedGoal: 'object', intervener: 'subject' },
    values: { result: 'the intended goal cannot be targeted across the intervening interrogative operator' } };
  assert(facet(relation, 'intervention'));
  assert(plan(relation).some(item => item.pathStyle === 'intervention' && item.outcome === 'blocked'));
  for (const result of [
    'the intended goal can be targeted across the intervening interrogative operator',
    'if the intended goal cannot be targeted',
    'the intended goal cannot be targeted unless it moves',
    'the intended goal cannot be targeted across an intervener but can be reached another way',
    'the unrelated goal cannot be targeted',
    'it is unclear whether the intended goal cannot be targeted'
  ]) assert(!facet({ ...relation, values: { result } }, 'intervention'), result);
});

test('binder and variable occurrence qualifiers do not require an invented domain', () => {
  const relation = { relation: 'scope-chain interpretation', anchors: { binderOccurrence: 'subject', variableOccurrence: 'object' } };
  assert(facet(relation, 'operator-binding'));
  const path = plan(relation).find(item => item.kind === 'operator-variable-binding');
  assert(path);
  assert(!plan(relation).some(item => item.kind === 'domain-outline'));
});

test('explicit feature properties can survive an unresolved dependency without inventing agreement', () => {
  const relation = { relation: 'determiner and nominal properties', anchors: { determiner: 'subject', nominalHead: 'object' },
    values: { determinerNumber: 'plural', nominalNumber: 'singular' } };
  const plates = plan(relation).filter(item => item.kind === 'node-plaque');
  assert.equal(plates.length, 2);
  assert.deepEqual(plates.map(item => item.anchorNodeIds[0]).sort(), ['object', 'subject']);
  assert(!plan(relation).some(item => item.kind === 'directed-path'));
  assert(!facet({ ...relation, anchors: { determiner: 'subject', nominalHead: 'object', nominal: 'verb' } }, 'feature.dependency'));
});

test('typed participant properties use the same qualification and ambiguity rules', () => {
  const relation = { relation: 'a head property', anchors: { finiteAuxiliary: 'infl', verb: 'verb' }, values: { auxiliaryTense: 'past' } };
  const plates = plan(relation).filter(item => item.kind === 'node-plaque');
  assert.equal(plates.length, 1);
  assert.deepEqual(plates[0].anchorNodeIds, ['infl']);
  assert(!facet({ ...relation, anchors: { ...relation.anchors, lexicalAuxiliary: 'object' } }, 'plaque.structured'));
  const argument = { relation: 'argument licensing', anchors: { externalArgument: 'subject', predicate: 'verb', caseHead: 'infl' }, values: { case: 'ergative' } };
  assert(plan(argument).some(item => item.kind === 'node-plaque' && item.anchorNodeIds[0] === 'subject'));
  assert(!plan(argument).some(item => item.pathStyle === 'case-assignment'));
  const namedRole = { relation: 'ground and inherent Case licensing', anchors: { localizer: 'verb', ground: 'object' },
    values: { thetaRole: 'Ground', case: 'inherent oblique' } };
  assert(plan(namedRole).some(item => item.kind === 'node-plaque' && item.anchorNodeIds[0] === 'object'));
  assert(!plan(namedRole).some(item => item.pathStyle === 'case-assignment'));
  assert(!facet({ ...namedRole, anchors: { ...namedRole.anchors, Ground: 'subject' } }, 'plaque.structured'));
  const casePosition = { relation: 'argument chain', anchors: { nominativePosition: 'subject', thetaPosition: 'object' }, values: { case: 'nominative' } };
  assert(plan(casePosition).some(item => item.kind === 'node-plaque' && item.anchorNodeIds[0] === 'subject'));
  assert(!plan(casePosition).some(item => item.pathStyle === 'case-assignment'));
  assert(!plan({ ...casePosition, anchors: { ...casePosition.anchors, nominativeOccurrence: 'object' } })
    .some(item => item.kind === 'node-plaque'), 'competing explicit Case positions remain unresolved');
  const participle = { relation: 'object Case and participial concord', anchors: { participle: 'verb', controller: 'object' },
    values: { participialAgreement: 'masculine plural' } };
  assert(plan(participle).some(item => item.kind === 'node-plaque' && item.anchorNodeIds[0] === 'verb'));
  assert(!plan(participle).some(item => item.kind === 'directed-path'), 'the property alone does not supply a collector');
});

test('an explicitly qualified verbal property follows its exponent without selecting between competing bearers', () => {
  const relation = { relation: 'Asymmetric agreement', anchors: { verbalExponent: 'verb', subject: 'subject' },
    values: { verbalGender: 'masculine', subjectGender: 'feminine' } };
  const plates = plan(relation).filter(item => item.kind === 'node-plaque');
  assert.equal(plates.length, 2);
  assert(plates.some(item => item.anchorNodeIds[0] === 'verb' && item.rows[0].value === 'masculine'));
  assert(plates.some(item => item.anchorNodeIds[0] === 'subject' && item.rows[0].value === 'feminine'));
  assert(!plan(relation).some(item => item.kind === 'directed-path'));
  assert(!plan({ ...relation, anchors: { ...relation.anchors, verb: 'object' } }).some(item =>
    item.kind === 'node-plaque' && item.rows.some(row => row.label === 'verbalGender')));
});

test('a morphological surface word belongs to its explicitly anchored whole complex', () => {
  const currentForest = [{ id: 'complex', label: 'I⁰', children: [
    { id: 'stem', label: 'V⁰', word: 'read' }, { id: 'suffix', label: 'I⁰', word: 'ed' }
  ] }, { id: 'outside', label: 'X' }];
  const relation = { relation: 'Past-tense morphological realization',
    anchors: { inflectionalDomain: 'complex', pastExponent: 'suffix', stem: 'stem' },
    values: { surfaceWord: 'readed', process: 'Authored process.' } };
  const get = r => compileRelationRenderPlan([{ statement: '', stageRecord: '', workspaceForest: currentForest, relations: [r] }])
    .frames[0].items.filter(item => item.kind === 'node-plaque' && item.plaqueStyle === 'realization');
  assert.deepEqual(get(relation).map(item => item.anchorNodeIds), [['complex']]);
  for (const anchors of [{ ...relation.anchors, pastExponent: 'outside' },
    { pastExponent: 'suffix', stem: 'stem' }, { ...relation.anchors, morphologicalDomain: 'outside' }]) {
    assert.equal(get({ ...relation, anchors }).length, 0);
  }
});

test('configuration-level Case licensing does not choose one of two contextual heads as assigner', () => {
  const relation = { relation: 'Unmarked object Case licensing',
    anchors: { finiteHead: 'infl', transitiveHead: 'verb', object: 'object' }, values: { case: 'unmarked direct' } };
  assert(!plan(relation).some(item => item.pathStyle === 'case-assignment'));
  assert(plan(relation).some(item => item.kind === 'node-plaque' && item.anchorNodeIds[0] === 'object'));
  const explicit = { ...relation, anchors: { ...relation.anchors, caseAssigner: 'verb' } };
  assert.equal(plan(explicit).find(item => item.pathStyle === 'case-assignment')?.fromNodeId, 'verb');
});

test('an explicit thematic label can identify the owner of a differently qualified Case property', () => {
  const relation = { relation: 'embedded argument licensing', anchors: { predicate: 'verb', experiencer: 'object', stimulus: 'subject' },
    values: { objectRole: 'experiencer', subjectRole: 'stimulus', objectCase: 'accusative' } };
  const plate = plan(relation).find(item => item.plaqueStyle === 'feature');
  assert.deepEqual(plate?.anchorNodeIds, ['object']);
  assert.deepEqual(plate?.rows, [{ label: 'objectCase', value: 'accusative' }]);
  assert(!plan(relation).some(item => item.pathStyle === 'case-assignment'));
  assert(!facet({ ...relation, values: { ...relation.values, objectRole: ['experiencer', 'stimulus'] } }, 'plaque.structured'));
});

test('a complete assignment does not duplicate its owned property in a second plaque', () => {
  const relation = { relation: 'Case licensing', anchors: { licensor: 'infl', subject: 'subject' }, values: { subjectCase: 'nominative' } };
  assert(facet(relation, 'feature.dependency'));
  assert(!facet(relation, 'plaque.structured'));
});

test('Case valuation is the authored Case literal of a complete dependency', () => {
  const relation = { relation: 'T-subject Agree', anchors: { probe: 'infl', goal: 'subject' },
    values: { caseValuation: 'nominative', subjectFeatures: 'third-person plural' } };
  const d = dispatch(relation);
  assert(d.facets.some(f => f.recipe.id === 'feature.dependency'));
  assert.deepEqual(d.evidenceCoverage.fields.find(field => field.key === 'caseValuation').unrecoveredItemIndices, []);
  assert(plan(relation).some(item => item.pathStyle === 'case-assignment' && (item.featureRow?.value || item.label) === 'nominative'));
  assert(!plan({ ...relation, anchors: { probe: 'infl', unrelated: 'subject' } })
    .some(item => item.pathStyle === 'case-assignment'));
});

test('an authored tense value can annotate the unique anchored inflection head without inventing agreement', () => {
  const relation = { relation: 'Auxiliary form licensing', anchors: { auxiliary: 'infl', lexicalVerb: 'verb' },
    values: { tense: 'past', licensedVerbForm: 'base' } };
  const plates = plan(relation).filter(item => item.kind === 'node-plaque');
  assert.equal(plates.length, 1);
  assert.deepEqual(plates[0].anchorNodeIds, ['infl']);
  assert.deepEqual(plates[0].rows, [{ label: 'tense', value: 'past' }]);
  assert(!plan(relation).some(item => item.kind === 'directed-path'));
  const ambiguous = [{ id: 'two', label: 'CP', children: [...forest, { id: 'otherT', label: 'T' }] }];
  assert(!facet({ ...relation, anchors: { ...relation.anchors, secondAuxiliary: 'otherT' } }, 'plaque.structured', ambiguous));
});

test('a literal keyed to its exact participant earns an annotation without a dependency', () => {
  const relation = { relation: 'Perfect-complement selection and participial valuation',
    anchors: { perfectHead: 'infl', verbalHead: 'verb' }, values: { verbalHead: 'past participle' } };
  const items = plan(relation), plate = items.find(item => item.kind === 'node-plaque');
  assert.deepEqual(plate?.anchorNodeIds, ['verb']);
  assert.deepEqual(plate?.rows, [{ label: 'verbalHead', value: 'past participle' }]);
  assert(!items.some(item => item.kind === 'directed-path'));
  assert(!facet({ ...relation, anchors: { perfectHead: 'infl', verbalHead: ['verb', 'object'] } }, 'plaque.structured'));
});

test('several property items on the same host retain every authored list position', () => {
  const relation = { relation: 'feature specification', anchors: { holder: ['verb', 'verb'] },
    values: { holder: ['plural', 'animate'] } };
  const plates = plan(relation).filter(item => item.kind === 'node-plaque');
  assert.equal(plates.length, 1);
  assert.deepEqual(plates[0].anchorNodeIds, ['verb']);
  assert.deepEqual(plates[0].rows, [{ label: 'holder', value: 'plural' }, { label: 'holder', value: 'animate' }]);
  assert(dispatch(relation).evidenceCoverage.fields.every(field => !field.unrecoveredItemIndices.length));
  assert(!facet(relation, 'plaque.structured', [...forest, { id: 'verb', label: 'V' }]));
});

test('a separate subject position does not override an explicit agreement controller', () => {
  const relation = { relation: 'Finite agreement', anchors: { controller: 'subject', finiteHead: 'infl', subjectPosition: 'object' }, values: { features: 'third-person plural' } };
  assert(facet(relation, 'feature.dependency'));
  const path = plan(relation).find(item => item.pathStyle === 'case-agree');
  assert(path);
  assert.equal(path.toNodeId, 'subject');
});

test('one explicit thematic participant is enough for a one-role grid', () => {
  const relation = { relation: 'absolute argument structure', anchors: { predicate: 'verb', agent: 'subject' } };
  const grid = plan(relation).find(item => item.plaqueStyle === 'theta-grid');
  assert.deepEqual(grid?.thetaRoles.map(({ nodeId, label }) => ({ nodeId, label })), [{ nodeId: 'subject', label: 'agent' }]);
  assert(!facet({ ...relation, anchors: { predicate: 'verb', possibleAgent: 'subject' } }, 'theta-grid'));
});

test('a thematic literal names its argument without absorbing the absent external role', () => {
  const relation = { relation: 'raising predicate theta grid', anchors: { predicate: 'verb', propositionalArgument: 'object' },
    values: { complementThetaRole: 'Proposition', externalThetaRole: 'none' } };
  const grid = plan(relation).find(item => item.plaqueStyle === 'theta-grid');
  assert.deepEqual(grid?.thetaRoles.map(({ nodeId, label }) => ({ nodeId, label })), [{ nodeId: 'object', label: 'Proposition' }]);
  assert(dispatch(relation).claims.some(claim => claim.tier === 3 && claim.consumedEvidence.some(ref => ref.key === 'externalThetaRole')));
});

test('modification earns a branch overlay only at an existing shared parent', () => {
  const relation = { relation: 'nominal modification', anchors: { modifiedNominal: 'verb', modifierPP: 'object' } };
  assert(facet(relation, 'pair-merge'));
  assert(facet({ ...relation, relation: 'purpose interpretation' }, 'pair-merge'),
    'explicit modifier roles and an existing shared parent do not require a prescribed relation name');
  assert(!facet({ ...relation, anchors: { ...relation.anchors, modifierPP: 'subject' } }, 'pair-merge'));
  assert(!facet({ ...relation, relation: 'possible association' }, 'pair-merge'));
  assert(facet({ ...relation, anchors: { host: 'verb', modifier: 'object', modifiedNominal: 'vp' } }, 'pair-merge'));
});

test('an explicit probe owns Case licensing while the marker stays contextual', () => {
  const relation = { relation: 'Agree and Case licensing', anchors: { probe: 'infl', goal: 'subject', marker: 'verb' }, values: { case: 'nominative' } };
  assert.equal(plan(relation).find(item => item.pathStyle === 'case-assignment')?.fromNodeId, 'infl');
});

test('qualified licensing with explicit features keeps the exponent separate from the licensor', () => {
  const relation = { relation: 'null subject licensing', anchors: { finiteLicensor: 'infl', subject: 'subject', agreementExponent: 'verb' }, values: { licensedFeatures: 'third person plural' } };
  const path = plan(relation).find(item => item.pathStyle === 'case-agree');
  assert.equal(path?.fromNodeId, 'infl');
  assert.equal(path?.toNodeId, 'subject');
});

test('the prior complex distinguishes a moving complex from its separately mentioned member', () => {
  const v = { id: 'v', label: 'V', lineageId: 'lexical', word: 'read' };
  const complex = { id: 'complex', label: 'v', lineageId: 'complex-lineage', children: [v, { id: 'little-v', label: 'v', silent: true }] };
  const previous = [{ id: 'tp', label: 'TP', children: [{ id: 't', label: 'T', silent: true }, { id: 'vp', label: 'vP', children: [complex] }] }];
  const lower = structuredClone(complex); lower.children[0].silent = true;
  const higher = { id: 'higher', label: 'v', lineageId: 'complex-lineage', children: [
    { ...v, id: 'higher-v' }, { id: 'higher-little-v', label: 'v', silent: true }
  ] };
  const current = [{ id: 'tp', label: 'TP', children: [{ id: 't-complex', label: 'T', children: [higher, { id: 't', label: 'T', silent: true }] },
    { id: 'vp', label: 'vP', children: [lower] }] }];
  const relation = { relation: 'V-v-to-T head movement', anchors: { higherComplex: 'higher', intermediateVerbOccurrence: 'v', lowerComplex: 'complex', landingHead: 't' }, priorAnchors: { sourceComplex: 'complex' } };
  const recovery = recoverMovementEvidence(relation, current, previous);
  assert.equal(recovery.movement?.sourceNodeId, 'complex', JSON.stringify(recovery));
  assert.equal(recovery.movement?.targetNodeId, 'higher');
  const invalid = structuredClone(current); invalid[0].children[1].children[0].children[0].lineageId = 'different';
  assert(!recoverMovementEvidence(relation, invalid, previous).movement);
});

test('an explicitly failed comparison keeps both property labels and only blocked connectors', () => {
  const relation = { relation: 'failed determiner–nominal number agreement', anchors: { determiner: 'subject', nominalHead: 'object' },
    values: { determinerNumber: 'plural', nominalNumber: 'singular' } };
  const items = plan(relation), paths = items.filter(item => item.kind === 'directed-path');
  assert(paths.length > 0);
  assert(paths.every(item => item.outcome === 'blocked' && item.fromNodeId === 'subject' && item.toNodeId === 'object'));
  const plates = items.filter(item => item.kind === 'node-plaque');
  assert.equal(plates.length, 1);
  assert.deepEqual(plates[0].rows, [{ label: 'determinerNumber', value: 'plural' }, { label: 'nominalNumber', value: 'singular' }]);
  for (const candidate of [
    { ...relation, anchors: { ...relation.anchors, nominalHead: 'missing' } },
    { ...relation, values: { ...relation.values, status: 'licensed' } },
    { ...relation, values: { determinerNumber: 'plural' } }
  ]) assert(!facet(candidate, 'feature.dependency'));
});

test('participant aliases bind the same failed comparison without dropping a value', () => {
  const relation = { relation: 'Failed subject–finite agreement', anchors: { subject: 'subject', finiteHead: 'infl', overtVerb: 'verb' },
    values: { subjectFeatures: 'third person, plural', inflectionFeatures: 'third person, singular', result: 'number mismatch' } };
  const paths = plan(relation).filter(item => item.pathStyle === 'case-agree');
  assert.equal(paths.length, 2);
  assert(paths.every(path => path.outcome === 'blocked' && path.fromNodeId === 'infl' && path.toNodeId === 'subject'));
  assert(!facet({ ...relation, anchors: { ...relation.anchors, inflection: 'verb' } }, 'feature.dependency'));
  const morphology = { relation: 'Lexical inflection correspondence', anchors: { finiteHead: 'infl', inflectedVerb: 'verb' },
    values: { tense: 'present', person: 'third', number: 'singular' } };
  const plate = plan(morphology).find(item => item.plaqueStyle === 'realization');
  assert.deepEqual(plate?.rows, Object.entries(morphology.values).map(([label, value]) => ({ label, value })));
});

test('participant-qualified agreement fields independently bind their own exact arguments', () => {
  const relation = { relation: 'polypersonal agreement', anchors: { auxiliary: 'infl', ergativeArgument: 'subject', absolutiveArgument: 'object' },
    values: { ergativeFeatures: '3SG', absolutiveFeatures: '3PL' } };
  const paths = plan(relation).filter(item => item.pathStyle === 'case-agree');
  assert.deepEqual(paths.map(item => [item.toNodeId, item.featureRow.value]).sort(), [['object', '3PL'], ['subject', '3SG']]);
  assert(!facet({ ...relation, anchors: { ...relation.anchors, finiteHead: 'verb' } }, 'feature.dependency'));
});

test('an explicitly shared property earns a vine without inventing direction or identity', () => {
  for (const anchors of [{ head: 'infl', operator: 'subject' }, { topic: 'subject', resumptiveSubject: 'object' }]) {
    const relation = { relation: 'an open dependency', anchors, values: { sharedFeature: 'Q' } };
    const items = plan(relation);
    assert(items.some(item => item.linkStyle === 'feature-sharing'));
    assert(!items.some(item => item.kind === 'directed-path' || item.linkStyle === 'identity'));
  }
  for (const relation of [
    { anchors: { head: 'infl', operator: 'subject' }, values: { features: 'Q' } },
    { anchors: { head: 'infl', domain: 'clause' }, values: { sharedFeatures: 'Q' } },
    { anchors: { head: 'infl', operator: 'subject', context: 'verb' }, values: { sharedFeatures: 'Q' } },
    { anchors: { head: 'infl', operator: 'subject' }, values: { sharedFeatures: 'Q', status: 'failed' } },
    { anchors: { probe: 'infl', goal: 'subject' }, values: { sharedFeatures: 'Q' } }
  ]) assert(!facet({ relation: 'an open dependency', ...relation }, 'feature-sharing'));
});

test('an explicitly named dependency participant owns its property without inventing Case assignment', () => {
  const relation = { relation: 'finite subject Agree', anchors: { probe: 'infl', goal: 'subject' },
    values: { agreement: 'third person plural', subjectCase: 'nominative' } };
  const items = plan(relation);
  const property = items.find(item => item.kind === 'node-plaque' && item.rows.some(row => row.label === 'subjectCase'));
  assert.deepEqual(property?.anchorNodeIds, ['subject']);
  assert(!items.some(item => item.pathStyle === 'case-assignment'));
  assert(plan({ ...relation, relation: 'finite Agree' })
    .some(item => item.kind === 'node-plaque' && item.anchorNodeIds.includes('subject') && item.rows.some(row => row.label === 'subjectCase')),
  'the one explicit finite agreement goal owns its independently qualified subject Case property');
  for (const candidate of [
    { ...relation, relation: 'possible subject Agree' },
    { ...relation, anchors: { ...relation.anchors, target: 'object' } }
  ]) assert(!plan(candidate).some(item => item.kind === 'node-plaque' && item.rows.some(row => row.label === 'subjectCase')));
});

test('an explicitly failed finite comparison retains required and supplied values without repairing either', () => {
  const relation = { relation: 'failed finite morphological licensing', anchors: { finiteHead: 'infl', inflectedVerb: 'verb' },
    values: { requiredFeatures: 'present, third-person plural', suppliedFeatures: 'present, third-person singular', conflict: 'number' } };
  const items = plan(relation), paths = items.filter(item => item.pathStyle === 'case-agree');
  assert.equal(paths.length, 2);
  assert(paths.every(path => path.fromNodeId === 'infl' && path.toNodeId === 'verb' && path.outcome === 'blocked'));
  assert.deepEqual(items.find(item => item.plaqueStyle === 'feature').rows,
    Object.entries(relation.values).filter(([key]) => key !== 'conflict').map(([label, value]) => ({ label, value })));
  for (const candidate of [
    { ...relation, relation: 'finite morphological licensing' },
    { ...relation, anchors: { ...relation.anchors, inflectedVerb: ['verb', 'object'] } },
    { ...relation, values: { ...relation.values, outcome: 'successful' } },
    { ...relation, values: { requiredFeatures: 'present, third-person plural' } }
  ]) assert(!facet(candidate, 'feature.dependency'));
});

test('a named agreement host and explicit recipient bind ordinary feature rows', () => {
  const relation = { relation: 'dative agreement and licensing', anchors: { clitic: 'infl', recipient: 'subject' }, values: { features: 'third person singular' } };
  const path = plan(relation).find(item => item.pathStyle === 'case-agree');
  assert.equal(path?.fromNodeId, 'infl');
  assert.equal(path?.toNodeId, 'subject');
  assert(!facet({ ...relation, anchors: { ...relation.anchors, auxiliary: 'verb' } }, 'feature.dependency'));
  assert(!facet({ ...relation, relation: 'dative doubling' }, 'feature.dependency'));
});

test('failed selection compares the required and actual form through the same blocked primitive', () => {
  const relation = { relation: 'bare-form selection violation', anchors: { selectingAuxiliary: 'infl', selectedVerb: 'verb' },
    values: { requiredForm: 'bare', attestedForm: 'past' } };
  const items = plan(relation), paths = items.filter(item => item.pathStyle === 'case-agree');
  assert.equal(paths.length, 2);
  assert(paths.every(path => path.fromNodeId === 'infl' && path.toNodeId === 'verb' && path.outcome === 'blocked'));
  assert.deepEqual(items.find(item => item.plaqueStyle === 'feature').rows,
    Object.entries(relation.values).map(([label, value]) => ({ label, value })));
  assert(facet({ relation: 'modal-complement selection violation', anchors: { modal: 'infl', actualComplement: 'vp' },
    values: { requiredComplement: 'bare VP', actualComplementCategory: 'infinitival IP' } }, 'feature.dependency'));
  for (const candidate of [
    { ...relation, relation: 'bare-form selection' },
    { ...relation, relation: 'possible selection violation' },
    { ...relation, relation: 'no selection violation' },
    { ...relation, anchors: { ...relation.anchors, selectedHead: 'object' } },
    { ...relation, values: { ...relation.values, status: 'licensed' } },
    { ...relation, values: { requiredForm: 'bare' } }
  ]) assert(!facet(candidate, 'feature.dependency'));
});

test('one shared Case value pairs separate clauses only through their unique structural grouping', () => {
  const currentForest = [{ id: 'cp', label: 'CP', children: [
    { id: 'left', label: 'IP', children: [{ id: 'leftDP', label: 'DP', word: 'Ada' }, { id: 'leftI', label: 'I' }] },
    { id: 'right', label: 'IP', children: [{ id: 'rightDP', label: 'DP', word: 'Ben' }, { id: 'rightI', label: 'I' }] }
  ] }];
  const relation = { relation: 'Nominative Case assignment', anchors: { assigners: ['leftI', 'rightI'], recipients: ['leftDP', 'rightDP'] }, values: { case: 'nominative' } };
  const result = dispatch(relation, currentForest);
  assert.equal(result.facets.filter(f => f.recipe.id === 'feature.dependency').length, 2);
  const wrong = { ...relation, anchors: { ...relation.anchors, recipients: ['rightDP', 'leftDP'] } };
  assert(!facet(wrong, 'feature.dependency', currentForest));
  const ambiguous = [{ id: 'cp', label: 'IP', children: currentForest[0].children.flatMap(node => node.children) }];
  assert(!facet(relation, 'feature.dependency', ambiguous));
});

test('unrelated context does not hide a complete identity group within a chain claim', () => {
  const currentForest = [{ id: 'root', label: 'CP', children: [
    { id: 'high', label: 'DP', lineageId: 'same', word: 'Ada' },
    { id: 'low', label: 'DP', lineageId: 'same', word: 'Ada', silent: true },
    { id: 'pro', label: 'D', silent: true }
  ] }];
  const relation = { relation: 'subject chain and control', anchors: { finiteSubject: 'high', thematicSubject: 'low', controlledSubject: 'pro' } };
  assert(facet(relation, 'identity.occurrences', currentForest));
  assert(facet(relation, 'control.dependency', currentForest), 'finiteSubject explicitly identifies the controller; thematicSubject remains lower-copy context');
  assert(!facet({ ...relation, anchors: { controllerOccurrences: ['high', 'low'], controlledSubject: 'pro' } }, 'control.dependency', currentForest),
    'an unqualified controller occurrence list does not select a single controller');
  const shared = { relation: 'shared thematic argument', anchors: { filingObject: 'high', readingObject: 'low', readingPredicate: 'pro' } };
  assert(facet(shared, 'identity.occurrences', currentForest));
  const distinct = structuredClone(currentForest); distinct[0].children[1].lineageId = 'different';
  assert(!facet(shared, 'identity.occurrences', distinct), 'coreference does not establish occurrence identity');
});
