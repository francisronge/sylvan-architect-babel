import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan, visiblePlanFrameItems } from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';

const leaf = (id, label = 'N', extra = {}) => ({ id, label, word: id, ...extra });
const node = (id, label, children) => ({ id, label, children });
const inspect = (anchors, values, forest, name = 'An open authored claim') => {
  const relation = { relation: name, anchors, ...(values ? { values } : {}) };
  const dispatch = dispatchRelationClaims({ relation, currentForest: forest, stageIndex: 0, relationIndex: 0 });
  const plan = compileRelationRenderPlan([{ statement: 'Completed syntax', stageRecord: 'Authored explanation', relations: [relation], workspaceForest: forest }]);
  return { dispatch, plan, items: plan.frames[0].items, has: id => dispatch.facets.some(f => f.recipe.id === id) };
};
const nominal = [node('dp', 'DP', [leaf('dem', 'D'), node('np', 'NP', [node('ap', 'AP', [leaf('adj', 'A')]), leaf('noun', 'N')])])];

test('nominal members with one shared feature bundle use the Orchard vine', () => {
  for (const name of ['Nominal concord', 'Unlisted name', '名前']) {
    const result = inspect({ adjective: 'adj', demonstrative: 'dem', noun: 'noun' }, { number: 'plural', explanation: 'Weak inflection' }, nominal, name);
    assert(result.has('feature-sharing'));
    const vine = result.items.find(item => item.linkStyle === 'feature-sharing');
    assert.deepEqual(new Set(vine.pairs.flatMap(p => [p.fromNodeId, p.toNodeId])), new Set(['adj', 'dem', 'noun']));
    assert.equal(vine.label, 'number: plural');
    assert.equal(result.items.some(item => item.kind === 'directed-path'), false);
    assert.deepEqual(result.dispatch.primaryRelation.values, { explanation: 'Weak inflection' });
    assert.equal(visiblePlanFrameItems(result.plan, 0, new Set()).some(item => item.linkStyle === 'feature-sharing'), false);
    const bound = bindRelationPlanFrame(result.plan, 0, id => ({ x: ['adj', 'dem', 'noun'].indexOf(id) * 100, y: 60 }));
    assert.equal(bound.primitives.filter(p => p.shapeStyle === 'feature-sharing-vine').length, 3);
  }
  for (const zero of ['⁰', '^0', '0']) {
    const marked = structuredClone(nominal);
    marked[0].children[0].label = `D${zero} [plural]`;
    marked[0].children[1].children[1].label = `N${zero} [plural]`;
    assert(inspect({ demonstrative: 'dem', noun: 'noun' }, { number: 'plural' }, marked).has('feature-sharing'));
  }
});

test('nominal feature recovery does not infer agreement across clauses, missing nodes, or directed claims', () => {
  const anchors = { adjective: 'adj', demonstrative: 'dem', noun: 'noun' };
  for (const [a, v, f] of [
    [anchors, {}, nominal],
    [{ ...anchors, noun: 'absent' }, { number: 'plural' }, nominal],
    [{ ...anchors, controller: 'dem' }, { number: 'plural' }, nominal],
    [anchors, { number: 'plural', outcome: 'failed' }, nominal],
    [anchors, { number: 'plural' }, [node('clause', 'CP', [nominal[0].children[0], nominal[0].children[1]])]],
    [anchors, { number: 'plural' }, [node('dp', 'DP', [leaf('dem', 'D'), node('cp', 'CP', [leaf('adj', 'A'), leaf('noun', 'N')])])]],
    [{ adjective: 'adj', noun: 'adj' }, { number: 'plural' }, nominal]
  ]) assert.equal(inspect(a, v, f).has('feature-sharing'), false);
  const ambiguous = inspect({ bearers: ['adj', 'dem'], participants: ['noun', 'dem'] }, { features: 'plural' }, nominal);
  assert.equal(ambiguous.has('feature-sharing'), false);
});

test('a quantifier and noun share a literal bundle only within one nominal domain', () => {
  const forest = [node('n', 'NP', [node('qp', 'QP', [leaf('q', 'Q')]), leaf('noun', 'N')])];
  const r = inspect({ quantifier: 'q', noun: 'noun' }, { features: ['singular', 'an unfamiliar Case'] }, forest);
  assert(r.has('feature-sharing'));
  assert.equal(r.items.some(item => item.kind === 'directed-path'), false);
  for (const zero of ['⁰', '^0', '0']) {
    const marked = structuredClone(forest);
    marked[0].children[0].children[0].label = `Q${zero} [singular]`;
    marked[0].children[1].label = `N${zero} [singular]`;
    assert(inspect({ quantifier: 'q', noun: 'noun' }, { features: 'singular' }, marked).has('feature-sharing'));
  }
  for (const f of [[leaf('q', 'Q'), leaf('noun', 'N')], [node('n', 'NP', [leaf('q', 'C'), leaf('noun', 'N')])],
    [node('n', 'NP', [node('cp', 'CP', [leaf('q', 'Q')]), leaf('noun', 'N')])]]) {
    assert(!inspect({ quantifier: 'q', noun: 'noun' }, { features: ['singular', 'allative'] }, f).has('feature-sharing'));
  }
});

test('separate explicit idiom components earn underlines without interpreting ordinary predicates as idioms', () => {
  const forest = [node('vp', 'VP', [leaf('v', 'V'), node('object', 'NP', [leaf('n')])])];
  const result = inspect({ idiomVerb: 'v', idiomNominal: 'object', subject: 'n' }, { interpretation: 'A literal authored interpretation' }, forest);
  assert(result.has('idiom.chunks'));
  assert.deepEqual(result.items.find(i => i.badgeStyle === 'idiom-chunk').badges.map(b => b.nodeId), ['v', 'object']);
  assert.equal(result.items.some(i => i.domainStyle === 'idiom'), false);
  for (const anchors of [{ verb: 'v', nominal: 'object' }, { idiomVerb: 'v' }, { idiomVerb: 'v', idiomNominal: 'missing' },
    { idiomVerb: 'v', idiomNominal: 'v' }, { idiomChunks: ['v', 'object'], idiomaticChunks: ['v', 'n'] }]) {
    assert.equal(inspect(anchors, { explanation: 'The verb and nominal form an idiom.' }, forest).has('idiom.chunks'), false);
  }
});

test('binding without an authored domain draws a connection and does not manufacture a circle', () => {
  const forest = [node('clause', 'TP', [leaf('binder', 'D'), leaf('anaphor', 'D'), leaf('controller', 'D')])];
  const result = inspect({ binder: 'binder', anaphor: 'anaphor', controller: 'controller' }, { reference: 'A name' }, forest);
  assert(result.has('binding.dependency'));
  const link = result.items.find(i => i.kind === 'operator-variable-binding');
  assert.equal(link.operatorNodeId, 'binder'); assert.equal(link.variableNodeId, 'anaphor');
  assert.equal(link.scopeDomainNodeId, undefined);
  assert.equal(result.items.some(i => i.kind === 'binding-domain'), false);
  for (const [anchors, values] of [
    [{ localSubject: 'binder', anaphor: 'anaphor' }, {}],
    [{ binder: 'binder', anaphor: 'anaphor', domain: 'missing' }, {}],
    [{ binder: 'binder', anaphor: 'binder' }, {}],
    [{ binder: 'binder', anaphor: 'anaphor' }, { outcome: 'failed' }]
  ]) assert.equal(inspect(anchors, values, forest).has('binding.dependency'), false);
  assert.equal(inspect({ binder: 'binder', bound: 'anaphor' }, {}, forest, 'Binding').has('binding.dependency'), false,
    'Tier 2 must not rescue a registered Binding claim missing its required domain');
});

test('polarity licensing reuses association curves without asserting strong-NPI status', () => {
  const forest = [node('root', 'TP', [leaf('licensor', 'D'), leaf('item', 'Adv')])];
  const namedNpi = inspect({ licensor: 'licensor', licensee: 'item' }, { basis: 'downward-entailing scope' }, forest, 'NPI licensing');
  assert(namedNpi.has('polarity.licensing'));
  assert.equal(namedNpi.has('strong-npi'), false);
  assert.deepEqual(namedNpi.items.find(item => item.linkStyle === 'strong-npi').pairs,
    [{ fromNodeId: 'licensor', toNodeId: 'item' }]);
  assert.equal(inspect({ licensor: 'licensor', licensee: 'item' }, {}, forest, 'Generic licensing').has('polarity.licensing'), false);
  for (const [source, target] of [['licensor', 'polarityItem'], ['licensingDP', 'negativePolarityItem'], ['licenser', 'minimizer']]) {
    const result = inspect({ [source]: 'licensor', [target]: 'item' }, { interpretation: 'Authored meaning' }, forest);
    assert(result.has('polarity.licensing'));
    assert.equal(result.has('strong-npi'), false);
    const link = result.items.find(i => i.linkStyle === 'strong-npi');
    assert.deepEqual(link.pairs, [{ fromNodeId: 'licensor', toNodeId: 'item' }]);
    assert.equal(link.label, undefined);
    const bound = bindRelationPlanFrame(result.plan, 0,
      id => ({ x: id === 'licensor' ? 20 : 220, y: id === 'licensor' ? 50 : 250 }));
    const curve = bound.primitives.find(p => p.shapeStyle === 'strong-npi');
    assert.equal(curve.d, 'M 20.0 90.0 Q 120.0 334.0 220.0 290.0',
      'each endpoint stays below its own label when the anchors have different heights');
  }
  for (const [anchors, values] of [
    [{ licensor: 'licensor', goal: 'item' }, {}],
    [{ licensor: 'licensor', polarityItem: 'missing' }, {}],
    [{ licensor: 'licensor', polarityItem: 'item' }, { outcome: 'unlicensed' }]
  ]) assert.equal(inspect(anchors, values, forest).has('polarity.licensing'), false);
  const strong = inspect({ licensor: 'licensor', npi: 'item' }, { feature: 'strong NPI' }, forest);
  assert(strong.has('strong-npi'));
  assert.equal(strong.has('polarity.licensing'), false);
  assert.equal(strong.items.filter(i => i.linkStyle === 'strong-npi').length, 1);
});

test('qualified parasitic arguments need both actual gap occurrences', () => {
  const forest = [node('root', 'CP', [leaf('filler', 'DP'), leaf('ordinary', 'DP', { silent: true }), leaf('parasitic', 'DP', { silent: true })])];
  const anchors = { whLicenser: 'filler', matrixObject: 'ordinary', parasiticObject: 'parasitic' };
  const result = inspect(anchors, {}, forest);
  assert(result.has('parasitic-gap.copy'));
  const fork = result.items.find(i => i.kind === 'parasitic-gap-copy');
  assert.equal(fork.contentNodeId, 'filler');
  assert.equal(fork.ordinaryGapNodeId, 'ordinary');
  assert.deepEqual(fork.parasiticGapNodeIds, ['parasitic']);
  const overt = structuredClone(forest); delete overt[0].children[2].silent;
  assert.equal(inspect(anchors, {}, overt).has('parasitic-gap.copy'), false);
  assert.equal(inspect({ ...anchors, matrixObject: 'missing' }, {}, forest).has('parasitic-gap.copy'), false);
  const copies = forest[0].children.map(n => ({ ...n, lineageId: 'argument', word: undefined,
    children: [leaf(n.id + '-head', 'N')] }));
  assert(inspect(anchors, {}, [node('root', 'CP', copies)]).has('parasitic-gap.copy'));
  copies[2].lineageId = 'unrelated';
  assert.equal(inspect(anchors, {}, [node('root', 'CP', copies)]).has('parasitic-gap.copy'), false);
});

test('named chains preserve distinct groups, literal ownership and relation timing', () => {
  const forest = [node('root', 'TP', [
    ...['s1', 's2'].map(id => leaf(id, 'D', { lineageId: 'subject' })),
    ...['c1', 'c2', 'c3'].map(id => leaf(id, 'V', { lineageId: 'complex' }))
  ])];
  const result = inspect({ subjectOccurrences: ['s1', 's2'], auxiliaryChain: ['c1', 'c2', 'c3'] }, { pronunciation: 'A separate claim' }, forest);
  const groups = result.items.filter(i => i.kind === 'coindex');
  assert.deepEqual(groups.map(i => i.nodeIds), [['s1', 's2'], ['c1', 'c2', 'c3']]);
  assert.notEqual(groups[0].index, groups[1].index);
  assert.deepEqual(result.dispatch.primaryRelation.values, { pronunciation: 'A separate claim' });
  assert.equal(visiblePlanFrameItems(result.plan, 0, new Set()).some(i => i.kind === 'coindex'), false);
  for (const ids of [['s1', 'c1'], ['s1', 's1'], ['s1', 'missing']]) {
    assert.equal(inspect({ subjectOccurrences: ids }, {}, forest).has('identity.occurrences'), false);
  }
  const oneInvalid = inspect({ subjectOccurrences: ['s1', 'c1'], auxiliaryChain: ['c1', 'c2'] }, {}, forest);
  assert.deepEqual(oneInvalid.items.filter(i => i.kind === 'coindex').map(i => i.nodeIds), [['c1', 'c2']]);
  const noLineage = structuredClone(forest); noLineage[0].children.forEach(n => delete n.lineageId);
  assert.equal(inspect({ subjectOccurrences: ['s1', 's2'] }, {}, noLineage).has('identity.occurrences'), false);
});

test('separately named chain occurrences earn identity without another movement arrow', () => {
  const forest = [node('root', 'TP', [leaf('high', 'DP', { lineageId: 'one' }),
    leaf('low', 'DP', { lineageId: 'one', silent: true }), leaf('other', 'DP', { lineageId: 'two' })])];
  for (const anchors of [{ pronouncedOccurrence: 'high', unpronouncedOccurrence: 'low' },
    { chainFoot: 'low', chainHead: 'high' }, { higherOccurrence: 'high', thematicOccurrence: 'low' }]) {
    const r = inspect(anchors, { pronunciation: 'Only the higher copy is pronounced.' }, forest);
    assert(r.has('identity.occurrences'));
    assert(!r.has('movement.path'));
    assert(r.items.some(item => item.kind === 'fallback' && item.relationRef.values.pronunciation));
    assert.deepEqual(r.items.find(item => item.kind === 'coindex').nodeIds.slice().sort(), ['high', 'low']);
    for (const lower of ['high', 'other', 'missing']) assert(!inspect({ ...anchors, ...Object.fromEntries(Object.entries(anchors).filter(([, id]) => id === 'low').map(([key]) => [key, lower])) }, {}, forest).has('identity.occurrences'));
  }
  const noLineage = structuredClone(forest); delete noLineage[0].children[1].lineageId;
  assert(!inspect({ pronounced: 'high', unpronounced: 'low' }, {}, noLineage).has('identity.occurrences'));
});

test('a growing recovered chain keeps the registered identity index', () => {
  const forest = [node('root', 'CP', ['a', 'b', 'c'].map(id => leaf(id, 'D', { lineageId: 'same' })))];
  const make = relation => ({ statement: 'State', stageRecord: 'Record', workspaceForest: forest, relations: [relation] });
  const plan = compileRelationRenderPlan([
    make({ relation: 'Identity', anchors: { occurrences: ['a', 'b'] } }),
    make({ relation: 'Open restatement', anchors: { subjectOccurrences: ['c', 'a', 'b'] } })
  ]);
  const indices = plan.frames.flatMap(frame => frame.items.filter(i => i.kind === 'coindex').map(i => i.index));
  assert(indices.length >= 2);
  assert.equal(new Set(indices).size, 1);
});
