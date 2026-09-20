import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { dispatchRelationClaims, buildTier2FacetEvidence } from '../replay/relations/tier2RelationDispatch.ts';
import { TIER2_VALUE_SYNONYMS } from '../replay/relations/tier2Synonyms.ts';

const leaf = id => ({ id, label: 'X', word: id });
const forest = [{ id: 'root', label: 'XP', children: ['a', 'b', 'c'].map(leaf) }];
const stage = (relations, workspaceForest = forest) => ({ statement: 'Authored state', stageRecord: '', relations, workspaceForest });
const plan = relation => compileRelationRenderPlan([stage([relation])]);
const dispatch = (relation, currentForest = forest, priorForest) => dispatchRelationClaims({
  relation, currentForest, priorForest, stageIndex: priorForest ? 1 : 0, relationIndex: 0
});
const graphic = relation => plan(relation).frames[0].items[0];

test('single-participant feature records reuse the existing plaque without interpreting the title', () => {
  for (const role of ['head', 'bearer', 'arbitraryParticipant']) for (const field of ['features', 'rows']) {
    const relation = { relation: 'An open record', anchors: { [role]: 'a' }, values: { [field]: ['+Q', '+wh'], locality: 'A qualification' } };
    const original = structuredClone(relation);
    const items = plan(relation).frames[0].items;
    const plaques = items.filter(item => item.kind === 'node-plaque');
    assert.equal(plaques.length, 1);
    assert.equal(plaques[0].plaqueStyle, 'feature');
    assert.deepEqual(plaques[0].anchorNodeIds, ['a']);
    assert.deepEqual(plaques[0].rows.map(row => [row.label, row.value]), [[field, '+Q'], [field, '+wh']]);
    assert.ok(items.some(item => item.kind === 'fallback'), 'the qualification remains available');
    assert.ok(!items.some(item => item.kind === 'feature-connector' || item.kind === 'trajectory'));
    assert.deepEqual(relation, original);
  }
});

test('feature records do not guess recipients, rescue exact claims or duplicate a dependency', () => {
  for (const relation of [
    { relation: 'Open record', anchors: { first: 'a', second: 'b' }, values: { features: ['+Q'] } },
    { relation: 'Open record', anchors: { head: ['a', 'a'] }, values: { features: ['+Q'] } },
    { relation: 'Open record', anchors: { head: 'missing' }, values: { features: ['+Q'] } },
    { relation: 'Open record', anchors: {}, priorAnchors: { head: 'a' }, values: { features: ['+Q'] } },
    { relation: 'Open record', anchors: { head: 'a' }, values: { features: ['+Q'], featureValues: ['-Q'] } },
    { relation: 'Open record', anchors: { head: 'a' }, values: { note: 'All features checked' } },
    { relation: 'Agree', anchors: { probe: 'a' }, values: { features: ['+Q'] } }
  ]) assert.ok(!plan(relation).frames[0].items.some(item => item.kind === 'node-plaque'), JSON.stringify(relation));
  const items = plan({ relation: 'Open dependency', anchors: { source: 'a', target: 'b' }, values: { features: ['+Q'] } }).frames[0].items;
  assert.equal(items.filter(item => item.kind === 'node-plaque').length, 1, 'one value plaque belongs to the recovered dependency');
  assert.equal(items.filter(item => item.pathStyle === 'case-agree').length, 1, 'one collection connector');
  assert(items.every(item => item.tier2FacetId === 'feature.dependency'), 'no independent record claim duplicates the dependency');
});

for (const [name, anchors, key, concept, value, output] of [
  ['CyclicAgree', { probe: 'a', goal: 'b' }, 'cycle', 'cycle', '7', 'label'],
  ['FProjection', { accentBearer: 'a', projections: ['root'] }, 'accent', 'accent.label', 'H*', 'label'],
  ['Accord', { source: 'a', goal: 'b' }, 'index', 'index', '7', 'secondaryLabel']
]) test(`${name} carries every shared literal spelling into its drawing`, () => {
  const original = { relation: name, anchors, values: { [key]: value } };
  const expected = graphic(original)[output];
  assert.ok(expected);
  for (const alias of TIER2_VALUE_SYNONYMS.find(group => group.concept === concept).aliases) {
    const relation = { ...original, values: { [alias.toUpperCase()]: value } };
    const copy = structuredClone(relation);
    assert.equal(dispatch(relation).primaryClaim.tier, 1, alias);
    assert.equal(graphic(relation)[output], expected, alias);
    assert.deepEqual(graphic(relation).relationRef.values, relation.values);
    assert.deepEqual(relation, copy);
  }
});

test('native plaques consume bound values while retaining authored rows', () => {
  for (const [relation, anchors, values, changed] of [
    ['Impoverishment', { terminal: 'a' }, { featureHierarchy: ['2', 'pl', 'f'], delinkAfter: '2' },
      { 'feature hierarchy': ['2', 'pl', 'f'], 'delink position': '2' }],
    ['CooperStorage', { scope: 'root' }, { category: 'TP', qstore: ['q'] }, { CATEGORY: 'TP', QSTORE: ['q'] }]
  ]) {
    const before = graphic({ relation, anchors, values });
    const after = graphic({ relation, anchors, values: changed });
    assert.equal(after.kind, 'node-plaque');
    assert.deepEqual(after.nativeContent, before.nativeContent);
    assert.deepEqual(after.relationRef.values, changed);
    assert.deepEqual([...new Set(after.rows.map(row => row.label))], Object.keys(changed));
  }
});

test('bound scalar values never select an item or resolve conflicting aliases by order', () => {
  for (const values of [{ round: ['1', '2'] }, { cycle: '1', round: '2' }, { round: '2', cycle: '1' }]) {
    const relation = { relation: 'CyclicAgree', anchors: { probe: 'a', goal: 'b' }, values };
    assert.equal(dispatch(relation).primaryClaim.tier, 3);
    assert.equal(graphic(relation).kind, 'fallback');
    assert.deepEqual(graphic(relation).relationRef.values, values);
  }
  assert.equal(graphic({ relation: 'CyclicAgree', anchors: { probe: 'a', goal: 'b' } }).label, undefined);
});

test('explicit equivalent optional roles bind one slot without merging conflicting references', () => {
  for (const [relation, anchors] of [
    ['QuantifierRaising', { pronouncedQP: 'a', lfQP: 'b' }],
    ['OperatorVariableBinding', { operator: 'a', variable: 'b' }]
  ]) {
    const authored = { relation, anchors: { ...anchors, semanticDomain: 'root' } };
    assert.equal(dispatch(authored).primaryClaim.tier, 1);
    assert.equal(graphic(authored).scopeDomainNodeId, 'root');
    const conflict = { relation, anchors: { ...anchors, scopeDomain: 'root', domain: 'c' } };
    assert.equal(dispatch(conflict).primaryClaim.tier, 3);
    assert.ok(dispatch(conflict).tier1Dispatch.signatureIssues.some(issue => issue.kind === 'conflicting-role-bindings'));
  }
});

test('equivalent movement endpoint wording cannot turn a head into a phrase', () => {
  for (const role of ['target', 'landing', 'pronouncedCopy', 'higherCopy']) {
    const item = graphic({ relation: 'Lowering', anchors: { source: 'a', [role]: 'b' } });
    assert.equal(item.kind, 'trajectory', role);
    assert.equal(item.trajectoryKind, 'lowering', role);
  }
});

test('distinct enclosure claims survive; two readings of the same participant stay neutral', () => {
  const names = relation => dispatch(relation).facets.map(facet => facet.recipe.id);
  const independent = { relation: 'Authored claims', anchors: { constituent: 'a', 'movement.carrier': 'b' } };
  assert.ok(names(independent).includes('constituent.occurrence'));
  assert.ok(names(independent).includes('constituent.region'));
  assert.deepEqual(names({ ...independent, anchors: { constituent: 'a', 'movement.carrier': 'a' } }), []);
});

test('local rebracketing checks the named sequence, including its identity and surface order', () => {
  const relation = { relation: 'Authored rebracketing', anchors: { sequence: ['a', 'b'] } };
  const prior = [{ id: 'root', label: 'XP', children: [{ id: 'group', label: 'XP', children: [leaf('a'), leaf('b')] }] }];
  const current = [{ id: 'root', label: 'XP', children: [leaf('a'), leaf('b')] }];
  const earned = (now, before = prior) => dispatch(relation, now, before).facets.some(f => f.recipe.id === 'pf.local-dislocation');
  assert.ok(earned(current));
  assert.ok(earned([...current, leaf('unrelated')]));
  assert.ok(earned(current, [...prior, leaf('unrelated')]));
  assert.equal(earned([{ ...current[0], children: [leaf('b'), leaf('a')] }]), false);
  assert.equal(earned([{ ...current[0], children: [leaf('a')] }]), false);
  const sameWord = roots => roots.map(root => ({ ...root, ...(root.word ? { word: 'same' } : {}),
    ...(root.children ? { children: sameWord(root.children) } : {}) }));
  assert.equal(earned(sameWord([{ ...current[0], children: [leaf('b'), leaf('a')] }]), sameWord(prior)), false);
});

test('central role specificity keeps weak ellipsis and generic PF context neutral', () => {
  const silentForest = [{ id: 'a', label: 'XP', silent: true }];
  for (const role of ['site', 'silentSite', 'unpronouncedDomain']) {
    assert.ok(!dispatch({ relation: 'Authored claim', anchors: { [role]: 'a' } }, silentForest)
      .facets.some(f => f.recipe.id === 'ellipsis.site'));
  }
  for (const [role, expected] of [['supportedTense', true], ['tenseHost', true], ['realizationHost', true],
    ['output', false], ['supportedHead', false]]) {
    const evidence = buildTier2FacetEvidence({ relation: { relation: 'Authored claim', anchors: { [role]: 'a' }, values: { notation: 'past' } }, currentForest: forest });
    assert.equal(Boolean(evidence.values['pf.rows']?.length), expected, role);
  }
});

test('the renderer leaves linguistic judgments to the author', () => {
  const relation = { relation: 'Binding', anchors: { binder: 'b', bound: 'a', domain: 'root' } };
  const questionable = [{ id: 'root', label: 'XP', children: [{ id: 'a', label: 'DP', children: [leaf('b')] }] }];
  assert.ok(compileRelationRenderPlan([stage([relation], questionable)]).frames[0].items.some(item => item.kind === 'binding-domain'));
});
