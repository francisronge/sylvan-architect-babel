import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const leaf = (id, label, extra = {}) => ({ id, label, word: id, ...extra });
const forest = [{ id: 'root', label: 'TP', children: [
  { id: 'nominal', label: 'D', children: [leaf('host', 'D'),
    { id: 'relative', label: 'C[relative]', children: [leaf('operator', 'D[relative operator]'), leaf('resumptive', 'D[pro]')] }] },
  leaf('verb', 'V[past; object clitic 3fsg]'), leaf('otherVerb', 'V'),
  leaf('context', 'Disc[hanging-topic linkage]'), leaf('topic', 'D'), leaf('pronoun', 'D[clitic]'),
  ...['high', 'edge', 'low'].map(id => leaf(id, 'NP:A′-trace', { lineageId: 'wh' })),
  leaf('unrelated', 'DP', { lineageId: 'other' })
] }];
const dispatch = (relation, currentForest = forest) => dispatchRelationClaims({ relation, currentForest, stageIndex: 0, relationIndex: 0 });
const plan = (relation, currentForest = forest) => compileRelationRenderPlan([
  { statement: '', stageRecord: '', workspaceForest: currentForest, relations: [relation] }
]).frames[0].items;
const claim = (relation, recipe, currentForest = forest) => dispatch(relation, currentForest).claims.find(c => c.tier === 2 && c.facet.recipe.id === recipe);
const snapshot = (relation, run) => {
  const before = structuredClone({ relation, forest });
  const result = run();
  assert.deepEqual({ relation, forest }, before);
  return result;
};

test('one positions array identifies an asserted chain without claiming its descriptions or another movement', () => {
  const relation = { relation: 'A′-chain', anchors: { positions: ['high', 'edge', 'low'] },
    values: { positions: ['interrogative operator', 'intermediate edge', 'theta-marked object position'] } };
  const recovered = snapshot(relation, () => claim(relation, 'identity.occurrences'));
  assert.deepEqual(recovered.consumedEvidence, [{ field: 'anchors', key: 'positions', itemIndices: [0, 1, 2] }]);
  const items = plan(relation);
  assert.deepEqual(items.find(i => i.familyId === 'identity.occurrences').nodeIds, ['high', 'edge', 'low']);
  assert(!items.some(i => i.familyId === 'trajectory.phrasal' || i.kind === 'movement-arrow'));
  assert(items.some(i => i.kind === 'fallback' && i.relationRef.values.positions));
  for (const invalid of [
    { ...relation, relation: 'possible A′-chain' }, { ...relation, relation: 'no A′-chain' },
    { ...relation, relation: 'positions in a diagram' }, { ...relation, values: { status: 'failed' } },
    ...[['high', 'high'], ['high', 'missing'], ['high', 'edge', 'unrelated']].map(positions => ({ ...relation, anchors: { positions } }))
  ]) assert(!claim(invalid, 'identity.occurrences'), JSON.stringify(invalid));
  const noLineage = structuredClone(forest); delete noLineage[0].children.find(n => n.id === 'edge').lineageId;
  assert(!claim(relation, 'identity.occurrences', noLineage));
});

test('a discourse licensor stays context while the two nominal referents receive coindices', () => {
  const relation = { relation: 'Discourse coreference', anchors: { clausalPronoun: 'pronoun', discourseLicensor: 'context', hangingTopic: 'topic' },
    values: { dependencyType: 'discourse anaphora, not a syntactic topic-resumption chain' } };
  const recovered = snapshot(relation, () => claim(relation, 'coreference.coindex'));
  assert.deepEqual(recovered.consumedEvidence.map(x => x.key).sort(), ['clausalPronoun', 'hangingTopic']);
  const items = plan(relation);
  assert.deepEqual(items.find(i => i.familyId === 'coreference.coindex').nodeIds, ['pronoun', 'topic']);
  assert(!items.some(i => ['identity.occurrences', 'binding.dependency'].includes(i.familyId)));
  for (const invalid of [
    { ...relation, relation: 'possible Discourse coreference' }, { ...relation, relation: 'no Discourse coreference' },
    { ...relation, values: { status: 'pending' } }, { ...relation, anchors: { ...relation.anchors, otherReferent: 'unrelated' } },
    { ...relation, anchors: { ...relation.anchors, discourseLicensor: 'missing' } },
    { ...relation, anchors: { ...relation.anchors, discourseLicensor: 'unrelated' } },
    { ...relation, anchors: { clausalPronoun: 'pronoun', context: 'context', hangingTopic: 'topic' } }
  ]) assert(!claim(invalid, 'coreference.coindex'), JSON.stringify(invalid));
});

test('resumptive binding uses the binder and qualified dependent, not the overt clitic exponent', () => {
  const relation = { relation: 'Resumptive operator binding', anchors: { binder: 'operator', cliticExponent: 'verb', resumptiveArgument: 'resumptive' },
    values: { dependency: 'base-generated operator binds a pronominal object; no object extraction' } };
  const recovered = snapshot(relation, () => claim(relation, 'binding.dependency'));
  assert.deepEqual(recovered.consumedEvidence.map(x => x.key), ['binder', 'resumptiveArgument']);
  const items = plan(relation), path = items.find(i => i.kind === 'operator-variable-binding');
  assert.equal(path.operatorNodeId, 'operator'); assert.equal(path.variableNodeId, 'resumptive');
  assert.equal(path.scopeDomainNodeId, undefined);
  assert(!items.some(i => i.kind === 'binding-domain'));
  for (const invalid of [
    { ...relation, relation: 'possible Resumptive operator binding' }, { ...relation, relation: 'no Resumptive operator binding' },
    { ...relation, relation: 'resumptive association' }, { ...relation, values: { status: 'pending' } },
    { ...relation, anchors: { ...relation.anchors, resumptivePronoun: 'pronoun' } },
    { ...relation, anchors: { ...relation.anchors, operator: 'topic' } },
    ...['missing', 'operator'].map(resumptiveArgument => ({ ...relation, anchors: { ...relation.anchors, resumptiveArgument } }))
  ]) assert(!claim(invalid, 'binding.dependency'), JSON.stringify(invalid));
});

test('relative adjunction draws only the authored sister attachment', () => {
  const relation = { relation: 'Restrictive relative adjunction', anchors: { nominalHost: 'host', relativeAdjunct: 'relative', operator: 'operator' },
    values: { mergeType: 'pair-Merge', interpretation: 'books x such that Samer bought x' } };
  const recovered = snapshot(relation, () => claim(relation, 'pair-merge'));
  assert.deepEqual(recovered.consumedEvidence.map(x => x.key), ['nominalHost', 'relativeAdjunct']);
  assert(plan(relation).some(i => i.familyId === 'pair-merge.fork'));
  for (const invalid of [
    { ...relation, relation: 'possible Restrictive relative adjunction' }, { ...relation, relation: 'no Restrictive relative adjunction' },
    { ...relation, values: { status: 'failed' } }, { ...relation, anchors: { ...relation.anchors, host: 'topic' } },
    { ...relation, anchors: { ...relation.anchors, modifier: 'pronoun' } },
    ...['missing', 'operator', 'nominal'].map(nominalHost => ({ ...relation, anchors: { ...relation.anchors, nominalHost } }))
  ]) assert(!claim(invalid, 'pair-merge'), JSON.stringify(invalid));
});

test('explicit thematic role in argument or clitic licensing retains its predicate and pronominal argument', () => {
  const relation = { relation: 'Object-clitic licensing', anchors: { inflectedVerb: 'verb', pronominalArgument: 'resumptive' },
    values: { thetaRole: 'theme', objectFeatures: 'third person feminine singular', implementation: 'The overt suffix licenses a silent doubled pronoun.' } };
  const recovered = snapshot(relation, () => claim(relation, 'theta-grid'));
  assert.deepEqual(recovered.consumedEvidence.map(x => [x.field, x.key]), [
    ['anchors', 'inflectedVerb'], ['anchors', 'pronominalArgument'], ['values', 'thetaRole']
  ]);
  const plaque = plan(relation).find(i => i.plaqueStyle === 'theta-grid');
  assert.deepEqual(plaque.anchorNodeIds, ['verb']);
  assert.deepEqual(plaque.thetaRoles.map(({ nodeId, label }) => ({ nodeId, label })), [{ nodeId: 'resumptive', label: 'theme' }]);
  assert(claim({ ...relation, relation: 'argument licensing' }, 'theta-grid'));
  for (const invalid of [
    { ...relation, relation: 'possible Object-clitic licensing' }, { ...relation, relation: 'no Object-clitic licensing' },
    { ...relation, relation: 'complement selection' }, { ...relation, values: { implementation: 'theme' } },
    { ...relation, values: { thetaRole: ['theme', 'agent'] } }, { ...relation, values: { thetaRole: 'theme', status: 'pending' } },
    { ...relation, anchors: { ...relation.anchors, predicate: 'otherVerb' } },
    { ...relation, anchors: { ...relation.anchors, argument: 'topic' } },
    { ...relation, anchors: { ...relation.anchors, pronominalArgument: 'missing' } }
  ]) assert(!claim(invalid, 'theta-grid'), JSON.stringify(invalid));
  assert(!claim(relation, 'theta-grid', [leaf('verb', 'V'), leaf('resumptive', 'D')]));
});
