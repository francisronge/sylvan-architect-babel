import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTier2FacetEvidence, dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const leaf = (id, extra = {}) => ({ id, label: 'D', word: id, ...extra });
const node = (id, label, children) => ({ id, label, children });
const forest = [node('root', 'CP', [leaf('a'), leaf('b'), leaf('c'), node('vp', 'VP', [leaf('v'), leaf('obj')])])];
const relation = (anchors, values, name = 'UnregisteredAnalysis') => ({ relation: name, anchors, ...(values ? { values } : {}) });
const inspect = (record, currentForest = forest, priorForest) => {
  const original = structuredClone(record);
  const input = { relation: record, currentForest, priorForest, stageIndex: priorForest ? 1 : 0, relationIndex: 0 };
  const dispatch = dispatchRelationClaims(input);
  const stage = { statement: 'state', stageRecord: 'record', relations: [record], workspaceForest: currentForest };
  const plan = compileRelationRenderPlan(priorForest ? [{ ...stage, relations: [], workspaceForest: priorForest }, stage] : [stage]);
  assert.deepEqual(record, original, 'dispatch and lowering must not rewrite the authored record');
  return { dispatch, facets: dispatch.facets.map(facet => facet.recipe.id), items: plan.frames.at(-1).items, diagnostics: plan.diagnostics };
};
const has = (result, id) => result.facets.includes(id);

test('single theta assignments preserve their exact literal and endpoint', () => {
  for (const label of ['Theme', 'Agent', ' x_i ']) {
    const result = inspect(relation({ predicate: 'v', argument: 'obj' }, { thetaRole: label }));
    assert(has(result, 'theta-grid'));
    const grid = result.items.find(item => item.plaqueStyle === 'theta-grid');
    assert.deepEqual(grid.thetaRoles, [{ nodeId: 'obj', label, index: 'i' }]);
    assert.deepEqual(grid.rows, [{ label, value: '' }]);
  }
});

test('ordered theta occurrences preserve repeated labels and repeated endpoints', () => {
  // Per-item literals pair with an anchor list through a same-name values entry.
  const record = relation({ predicate: 'v', arguments: ['a', 'a', 'b'] }, { arguments: ['Theme', 'Theme', 'Agent'] });
  const evidence = buildTier2FacetEvidence({ relation: record, currentForest: forest });
  assert.deepEqual(evidence.currentAnchors['theta.arguments'], ['a', 'a', 'b']);
  assert.deepEqual(evidence.authoredValues.find(entry => entry.key === 'arguments').items, ['Theme', 'Theme', 'Agent']);
  assert.deepEqual(inspect(record).items.find(item => item.plaqueStyle === 'theta-grid').thetaRoles,
    [{ nodeId: 'a', label: 'Theme', index: 'i' }, { nodeId: 'a', label: 'Theme', index: 'i' }, { nodeId: 'b', label: 'Agent', index: 'j' }]);
});

test('theta rejects missing literals and unequal associations in either direction', () => {
  for (const labels of [undefined, ['Theme'], ['Agent', 'Theme', 'Goal']]) {
    const result = inspect(relation({ predicate: 'v', arguments: ['a', 'b'] }, labels && { arguments: labels }));
    assert(!has(result, 'theta-grid'));
    assert.equal(result.items.some(item => item.plaqueStyle === 'theta-grid'), false);
  }
});

test('paired literals prefer the exact authored key regardless of property order', () => {
  for (const entries of [
    [['ARGUMENTS', ['Agent', 'Theme']], ['arguments', ['Theme', 'Agent']]],
    [['arguments', ['Theme', 'Agent']], ['ARGUMENTS', ['Agent', 'Theme']]]
  ]) {
    const result = inspect(relation({ predicate: 'v', arguments: ['a', 'b'] }, Object.fromEntries(entries)));
    assert.deepEqual(result.items.find(item => item.plaqueStyle === 'theta-grid').thetaRoles,
      [{ nodeId: 'a', label: 'Theme', index: 'i' }, { nodeId: 'b', label: 'Agent', index: 'j' }]);
    assert.deepEqual(result.dispatch.primaryRelation.values, { ARGUMENTS: ['Agent', 'Theme'] });
  }
});

test('ambiguous normalized literal keys never choose the first association', () => {
  for (const [anchors, key, facet] of [
    [{ predicate: 'v', arguments: ['a', 'b'] }, 'arguments', 'theta-grid'],
    [{ assigner: 'v', recipient: ['a', 'b'] }, 'recipient', 'feature.dependency'],
    [{ correspondenceSource: ['a', 'b'], correspondenceTarget: ['b', 'c'] }, 'correspondenceSource', 'correspondence.alignment']
  ]) {
    const entries = [[key.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase(), ['x', 'y']], [` ${key} `, ['y', 'x']]];
    for (const ordered of [entries, entries.toReversed()]) {
      const values = Object.fromEntries(ordered);
      const result = inspect(relation(anchors, values));
      assert(!has(result, facet), `${facet} must not guess a paired field`);
      assert.deepEqual(result.dispatch.primaryRelation.values, values);
      assert(result.dispatch.facetDiagnostics.some(item => item.facetId === facet && JSON.stringify(item).includes('ambiguous')));
    }
  }
});

test('one unambiguous normalized key still supplies the authored pairing', () => {
  const result = inspect(relation({ predicate: 'v', arguments: ['a', 'b'] }, { ARGUMENTS: ['Theme', 'Agent'] }));
  assert.deepEqual(result.items.find(item => item.plaqueStyle === 'theta-grid').thetaRoles,
    [{ nodeId: 'a', label: 'Theme', index: 'i' }, { nodeId: 'b', label: 'Agent', index: 'j' }]);
});

test('Case assignment uses a solid assignment path with each paired Case literal', () => {
  const result = inspect(relation({ assigner: 'v', recipient: ['a', 'b'] }, { recipient: ['NOM', 'ACC'] }));
  const paths = result.items.filter(item => item.pathStyle === 'case-assignment');
  assert.deepEqual(paths.map(item => [item.fromNodeId, item.toNodeId, item.label]), [['v', 'a', 'NOM'], ['v', 'b', 'ACC']]);
  assert(!result.items.some(item => item.pathStyle === 'case-agree'));
  assert.equal(inspect(relation({ probe: 'v', goal: 'a' }, { features: 'phi' })).items.find(item => item.kind === 'directed-path').pathStyle, 'case-agree');
});

test('Case assignment does not invent a missing or mismatched Case literal', () => {
  for (const values of [undefined, { case: ['NOM', 'ACC'] }]) assert(!has(inspect(relation({ assigner: 'v', recipient: 'a' }, values)), 'feature.dependency'));
});

test('partial outcome consumption leaves unknown qualifiers in the exact authored array', () => {
  const record = relation({ probe: 'v', goal: 'a' }, { outcome: ['licensed', ' UNINTERPRETED_QUALIFIER ', ' UNINTERPRETED_QUALIFIER '] });
  const result = inspect(record);
  assert(has(result, 'feature.dependency'));
  assert.deepEqual(result.dispatch.primaryRelation.values.outcome, [' UNINTERPRETED_QUALIFIER ', ' UNINTERPRETED_QUALIFIER ']);
  const claim = result.dispatch.claims.find(claim => claim.tier === 2);
  assert.deepEqual(claim.consumedEvidence.find(ref => ref.field === 'values').itemIndices, [0]);
});

test('recognized contradictory outcomes fail closed with a diagnostic', () => {
  const result = inspect(relation({ probe: 'v', goal: 'a' }, { outcome: ['licensed', 'blocked'] }));
  assert(!has(result, 'feature.dependency'));
  assert(result.dispatch.diagnostics.some(item => item.collision === 'outcome-conflict'));
  assert.deepEqual(result.dispatch.primaryRelation.values.outcome, ['licensed', 'blocked']);
});

test('correspondence retains repeated targets and each authored index', () => {
  const result = inspect(relation({ correspondenceSource: ['a', 'b'], correspondenceTarget: ['c', 'c'] }, { correspondenceSource: ['i', 'j'] }));
  assert(has(result, 'correspondence.alignment'));
  assert.deepEqual(result.items.find(item => item.linkStyle === 'gapping-pair').pairs,
    [{ fromNodeId: 'a', toNodeId: 'c' }, { fromNodeId: 'b', toNodeId: 'c' }]);
  assert.deepEqual(result.items.filter(item => item.kind === 'coindex').map(item => [item.nodeIds, item.index]), [[['a', 'c'], 'i'], [['b', 'c'], 'j']]);
});

test('correspondence does not manufacture an index or accept uneven pair arrays', () => {
  const anchors = { correspondenceSource: ['a', 'b'], correspondenceTarget: ['c', 'c'] };
  assert(!inspect(relation(anchors)).items.some(item => item.kind === 'coindex'));
  assert(!has(inspect(relation(anchors, { correspondenceSource: ['i', 'j', 'k'] })), 'correspondence.alignment'));
  assert(!inspect(relation(anchors, { index: ['i', 'j'] })).items.some(item => item.kind === 'coindex'), 'a differently named list is not paired');
  assert(!has(inspect(relation({ ...anchors, correspondenceTarget: 'c' })), 'correspondence.alignment'));
});

test('generic source-target, licensing, membership and negated specialized terms stay neutral', () => {
  for (const anchors of [{ source: 'a', target: 'b' }, { licensor: 'a', licensee: 'b' }, { members: ['a', 'b'] }]) {
    const result = inspect(relation(anchors, { note: 'No polarity or focus assertion.' }));
    assert.equal(result.facets.length, 0);
  }
  for (const features of ['not dependent case', 'no polarity', 'polarity is not asserted', 'non-polarity']) {
    const result = inspect(relation({ probe: 'a', goal: 'b' }, { features, index: 'k' }));
    assert(!has(result, 'dependent-case'));
    assert(!has(result, 'accord'));
  }
});

test('specialized positive feature claims need their distinctive literal evidence', () => {
  assert(has(inspect(relation({ probe: 'a', goal: 'b' }, { features: 'dependent case' })), 'dependent-case'));
  assert(has(inspect(relation({ source: 'a', goal: 'b' }, { features: 'polarity negative', index: 'k' })), 'accord'));
  assert(has(inspect(relation({ licensor: 'a', licensee: 'b' }, { feature: 'strong NPI' })), 'strong-npi'));
  assert(!has(inspect(relation({ licensor: 'a', licensee: 'b' }, { feature: 'negative' })), 'strong-npi'));
});

test('candidate outcomes cannot mark the same host licensed and rejected', () => {
  const bad = inspect(relation({ trace: 'a', licensedHosts: 'b', rejectedHosts: 'b' }));
  assert(!has(bad, 'landing-candidates'));
  assert(bad.dispatch.diagnostics.some(item => item.collision === 'candidate-outcome-conflict:b'));
  const good = inspect(relation({ trace: 'a', licensedHosts: 'b', rejectedHosts: 'c' }));
  assert.deepEqual(good.items.filter(item => item.pathStyle === 'improper-candidate').map(item => [item.toNodeId, item.outcome]), [['b', 'licensed'], ['c', 'blocked']]);
});

test('multidominance uses the declared extra parents without duplicating a tree occurrence', () => {
  const tree = [node('root', 'TP', [node('p1', 'XP', [leaf('shared')]), node('p2', 'XP', [leaf('b')])])];
  const good = inspect(relation({ parents: ['p1', 'p2'], shared: 'shared' }), tree);
  assert.deepEqual(good.items.find(item => item.kind === 'shared-node').parentNodeIds, ['p1', 'p2']);
  for (const parents of [['p1', 'missing'], ['p1', 'p1'], ['p1', 'shared']])
    assert(!has(inspect(relation({ parents, shared: 'shared' }), tree), 'multidominance'));
});

test('focus carries its witnessed native branch parent rather than the domain root', () => {
  const tree = [node('root', 'CP', [node('inner', 'TP', [leaf('a'), leaf('b')])])];
  const good = inspect(relation({ focus: 'a', background: 'b', domain: 'root' }), tree);
  const item = good.items.find(item => item.kind === 'branch-emphasis');
  assert.deepEqual(item.strongEdges, [{ fromNodeId: 'inner', toNodeId: 'a' }]);
  assert.deepEqual(item.weakEdges, [{ fromNodeId: 'inner', toNodeId: 'b' }]);
  assert(!has(inspect(relation({ focus: 'a', background: 'obj', domain: 'root' })), 'focus.prominence'));
});

test('projection validates ordered ancestors and emits no accent self-hop', () => {
  const good = inspect(relation({ accentBearer: 'obj', projectionNodes: ['obj', 'vp', 'root'] }, { feature: 'F', accent: 'H*' }));
  assert.deepEqual(good.items.filter(item => item.pathStyle === 'f-projection').map(item => [item.fromNodeId, item.toNodeId, item.projectionFeature]), [['obj', 'vp', 'F'], ['vp', 'root', 'F']]);
  for (const projectionNodes of [['a', 'b'], ['root', 'vp'], ['vp', 'vp']]) assert(!has(inspect(relation({ accentBearer: 'obj', projectionNodes })), 'focus.projection'));
});

test('approved focus can begin at a complement accent and project to its sister predicate head', () => {
  const tree = [node('ip', 'IP', [node('vp', 'VP', [leaf('verb', { label: 'V', word: 'praised' }), node('dp', 'DP', [leaf('accent', { word: 'John' })])])])];
  const result = inspect(relation({ accentBearer: 'accent', projections: ['verb', 'vp', 'ip'] }, { feature: 'F', accent: 'H*' }), tree);
  assert.deepEqual(result.items.filter(item => item.pathStyle === 'f-projection').map(item => [item.fromNodeId, item.toNodeId]), [['accent', 'verb'], ['verb', 'vp'], ['vp', 'ip']]);
  assert.equal(result.items.find(item => item.pathStyle === 'f-projection').projectionTargetAttachment, 'terminal');
});

test('binder-variable is complete without an invented scope hull', () => {
  const good = inspect(relation({ binder: 'a', variable: 'b', lexicalGovernor: 'v' }));
  assert(has(good, 'operator-binding'));
  const path = good.items.find(item => item.kind === 'operator-variable-binding');
  assert.equal(path.scopeDomainNodeId, undefined);
  assert.deepEqual(path.tier2OutputPieces, ['Variable-binding path']);
  assert.equal(good.dispatch.primaryRelation.anchors.lexicalGovernor, 'v');
  assert(has(inspect(relation({ binder: 'a', variable: 'obj', scopeDomain: 'vp' })), 'operator-binding'));
  assert(!has(inspect(relation({ binder: 'a', variable: 'missing' })), 'operator-binding'));
  assert(!has(inspect(relation({ binder: 'a', variable: 'b', scopeDomain: 'vp' })), 'operator-binding'));
});

test('Transfer uses one SOD and each accessible DP outline without a phase-head arc', () => {
  const tree = [node('phase', 'vP', [leaf('a'), leaf('b'), node('vbar', "v'", [leaf('h', { label: 'v' }), node('vp', 'VP', [leaf('obj')])])])];
  const record = relation({ phaseHead: 'h', transferredDomain: 'vp', accessibleDPs: ['a', 'b'] });
  const good = inspect(record, tree);
  assert(has(good, 'transfer.domain'));
  assert.deepEqual(good.items.filter(item => item.domainStyle === 'transfer-edge').map(item => item.rootNodeId), ['a', 'b']);
  assert.deepEqual(good.items.filter(item => item.kind === 'fong-component').map(item => [item.componentLabel, item.headNodeId]), [['SOD', 'vp']]);
  assert(!has(inspect(relation({ phaseHead: 'h' }), tree), 'phase.domain'));
  assert(has(inspect(relation({ transferredDomain: 'vp' }), tree), 'transfer.domain'));
  assert(!has(inspect(relation({ ...record.anchors, accessibleDPs: 'obj' }), tree), 'transfer.domain'));
});

test('Transfer and cyclic feature claims do not repeat equivalent marks', () => {
  const transfer = inspect(relation({ phase: 'root', edge: ['a', 'b'], complement: 'vp' }));
  assert.equal(transfer.items.filter(item => item.domainStyle === 'transfer-edge').length, 2);
  const cycle = inspect(relation({ probe: 'a', goal: ['b', 'c'] }, { cycle: 'C2' }));
  assert.equal(cycle.items.filter(item => item.kind === 'directed-path').length, 2);
  assert(!has(cycle, 'feature.dependency'));
});

test('cycle metadata does not supply missing agreement meaning or distinct endpoints', () => {
  for (const anchors of [{ licensor: 'a', licensee: 'b' }, { searcher: 'a', target: 'b' }, { probe: 'a', goal: 'a' }]) {
    for (const values of [{ cycle: '2' }, { iteration: '2', outcome: 'blocked' }]) {
      const result = inspect(relation(anchors, values));
      assert(!has(result, 'agreement.cycle'), JSON.stringify({ anchors, values }));
      assert(!has(result, 'feature.dependency'));
      assert.equal(result.items.some(item => item.pathStyle === 'agree-cyclic'), false);
      const cycleKey = Object.hasOwn(values, 'cycle') ? 'cycle' : 'iteration';
      assert.equal(result.dispatch.primaryRelation.values[cycleKey], '2');
    }
  }
  const supported = inspect(relation({ licensor: 'a', licensee: 'b' }, { cycle: '2', features: ['number: plural'] }));
  assert(has(supported, 'agreement.cycle'), 'authored feature evidence still establishes a feature dependency');
  assert.deepEqual(supported.dispatch.primaryRelation.values, { features: ['number: plural'] },
    'the cycle path must not consume feature content it does not display');
});

test('Tier-2 cycles preserve authored outcome labels with the same paths as Tier 1', () => {
  const displayedPath = ({ fromNodeId, toNodeId, pathStyle, label, secondaryLabel }) =>
    ({ fromNodeId, toNodeId, pathStyle, label, secondaryLabel });
  for (const outcome of [undefined, 'blocked', 'not allowed', 'allowed']) {
    const values = { cycle: 'C2', ...(outcome ? { outcome } : {}) };
    const result = inspect(relation({ probe: 'a', goal: ['b', 'c'] }, values));
    assert(has(result, 'agreement.cycle'));
    assert(!has(result, 'feature.dependency'));
    assert.deepEqual(result.items.filter(item => item.kind === 'directed-path').map(displayedPath),
      ['b', 'c'].map(goal => inspect(relation({ probe: 'a', goal }, values, 'CyclicAgree'))
        .items.find(item => item.kind === 'directed-path')).map(displayedPath));
    if (outcome) assert(result.dispatch.claims.some(claim => claim.tier === 2
      && claim.consumedEvidence.some(ref => ref.field === 'values' && ref.key === 'outcome')));
  }
});

test('cyclic paths preserve neutral qualifiers and reject contradictory or global outcomes', () => {
  for (const outcome of ['pending evaluation', ['blocked', 'pending evaluation'], '']) {
    const result = inspect(relation({ probe: 'a', goal: 'b' }, { cycle: '2', outcome }));
    assert(has(result, 'agreement.cycle'));
    assert.equal(result.items.find(item => item.pathStyle === 'agree-cyclic').secondaryLabel,
      Array.isArray(outcome) ? 'blocked' : undefined);
    assert.deepEqual(result.dispatch.primaryRelation.values, { outcome: Array.isArray(outcome) ? ['pending evaluation'] : outcome });
  }
  for (const outcome of ['converged', ['allowed', 'blocked']]) {
    const result = inspect(relation({ probe: 'a', goal: 'b' }, { cycle: '2', outcome }));
    assert(!has(result, 'agreement.cycle'), JSON.stringify(outcome));
    assert(!has(result, 'feature.dependency'));
    assert.deepEqual(result.dispatch.primaryRelation.values, { cycle: '2', outcome });
  }
});

test('exact Transfer accepts multiple edges only with its whole curated signature', () => {
  const good = inspect(relation({ phase: 'root', accessibleDPs: ['a', 'b'], complementDomain: 'vp' }, undefined, 'TransferDomain'));
  assert.equal(good.dispatch.primaryClaim.tier, 1);
  assert.deepEqual(good.items.filter(item => item.domainStyle === 'transfer-edge').map(item => item.rootNodeId), ['a', 'b']);
  for (const anchors of [{ phase: 'root', accessibleDPs: ['a', 'b'] }, { accessibleDPs: ['a', 'b'], complementDomain: 'vp' }, { phase: 'root', accessibleDPs: [], complementDomain: 'vp' }]) {
    const bad = inspect(relation(anchors, undefined, 'TransferDomain'));
    assert.equal(bad.dispatch.primaryClaim.tier, 3);
    assert(!has(bad, 'transfer.domain'));
  }
});

test('complete exact claims retain harmless context without salvaging incomplete core', () => {
  const good = inspect(relation({ probe: 'a', goal: 'b', inactiveIntervener: 'c' }, { note: 'context' }, 'Agree'));
  assert.equal(good.dispatch.primaryClaim.tier, 1);
  assert.equal(good.dispatch.residualRelation.anchors.inactiveIntervener, 'c');
  assert.equal(good.dispatch.primaryRelation.values.note, 'context');
  for (const anchors of [{ probe: 'a', inactiveIntervener: 'c' }, { probe: 'a', searcher: 'c', goal: 'b' }]) {
    const bad = inspect(relation(anchors, undefined, 'Agree'));
    assert.equal(bad.dispatch.primaryClaim.tier, 3);
    assert(!has(bad, 'feature.dependency'));
  }
  const transfer = inspect(relation({ phase: 'root', complement: 'vp' }, undefined, 'TransferDomain'));
  assert(transfer.dispatch.claims.every(claim => claim.tier === 3));
  const contradictory = inspect(relation({ probe: 'a', goal: 'b', inactiveIntervener: 'c' }, { outcome: ['licensed', 'blocked'] }, 'Agree'));
  assert.equal(contradictory.dispatch.primaryClaim.tier, 3);
  assert(contradictory.dispatch.tier1Dispatch.signatureIssues.some(issue => issue.kind === 'ambiguous-outcome-values'));
});

test('trace role attaches only to the exact compact silent occurrence', () => {
  for (const label of ['DP', 't_alpha', 't']) {
    const tree = [node('root', 'TP', [leaf('a', { label, word: undefined, silent: true })])];
    const good = inspect(relation({ gap: 'a' }), tree);
    assert(has(good, 'gap.notation'));
    assert.deepEqual(good.items.find(item => item.badgeStyle === 'gap-notation').badges, [{ nodeId: 'a', text: label, shape: 'plain' }]);
  }
  const tree = [node('vp', 'VP', [leaf('v'), leaf('trace', { label: 't', word: undefined, silent: true })])];
  assert(!has(inspect(relation({ gap: 'vp' }), tree), 'gap.notation'));
});

test('silence never licenses deletion, while explicit deletion remains supported', () => {
  const tree = [leaf('a', { silent: true })];
  assert(!has(inspect(relation({ unpronouncedMaterial: 'a' }), tree), 'deletion.site'));
  assert(has(inspect(relation({ deletedMaterial: 'a' }), tree), 'deletion.site'));
  assert(!has(inspect(relation({ site: 'vp' }), [node('vp', 'VP', [leaf('v'), leaf('silent', { silent: true })])]), 'ellipsis.site'));
});

test('PF hosts preserve literal rows and notation requires explicit host semantics', () => {
  for (const role of ['supportedTense', 'tenseHost']) {
    const good = inspect(relation({ [role]: 'a' }, { notation: ['did', 'did'] }));
    const plate = good.items.find(item => item.plaqueStyle === 'realization');
    assert.deepEqual(plate.rows, [{ label: 'notation', value: 'did' }, { label: 'notation', value: 'did' }]);
    assert.deepEqual(plate.realizationRowKinds, ['literal', 'literal']);
  }
  assert(!has(inspect(relation({ output: 'a' }, { notation: 'a = b' })), 'pf.structured'));
  const prose = 'Tense is realized as did; this is not an input-output equation.';
  assert.deepEqual(inspect(relation({ supportedTense: 'a' }, { realization: prose })).items.find(item => item.plaqueStyle === 'realization').rows, [{ label: 'realization', value: prose }]);
});

test('fission needs two outputs and explicit feature grouping', () => {
  const prior = [leaf('input')];
  const record = { ...relation({ outputs: ['a', 'b'] }, { inputFeatures: ['past', 'plural'], outputs: ['past', 'plural'] }), priorAnchors: { input: 'input' } };
  const good = inspect(record, forest, prior);
  assert.deepEqual(good.items.find(item => item.plaqueStyle === 'fission').nativeContent, { kind: 'fission', inputFeatures: ['past', 'plural'], outputFeatures: [['past'], ['plural']] });
  for (const bad of [{ ...record, values: { features: ['past', 'plural'] } }, { ...record, anchors: { outputs: ['a', 'b', 'c'] } }]) assert(!has(inspect(bad, forest, prior), 'pf.fission'));
});

test('impoverishment needs literal hierarchy and a unique nonfinal delink position', () => {
  const good = inspect(relation({ terminal: 'a' }, { featureHierarchy: ['phi', 'number', 'plural'], delinkAfter: 'number' }));
  assert.deepEqual(good.items.find(item => item.plaqueStyle === 'impoverishment').nativeContent, { kind: 'impoverishment', features: ['phi', 'number', 'plural'], delinkIndex: 1 });
  for (const values of [{ features: ['phi', 'plural'], delinkAfter: 'phi' }, { featureHierarchy: ['phi', 'phi', 'plural'], delinkAfter: 'phi' }, { featureHierarchy: ['phi', 'plural'], delinkAfter: 'plural' }]) assert(!has(inspect(relation({ terminal: 'a' }, values)), 'pf.impoverishment'));
});

test('PF correspondence needs explicit associations on one plate', () => {
  const good = inspect(relation({ terminal: 'a' }, { sources: ['past', 'plural'], exponents: ['ed', 's'] }));
  assert.deepEqual(good.items.find(item => item.plaqueStyle === 'correspondence').nativeContent.links, [{ sourceIndex: 0, exponentIndex: 0 }, { sourceIndex: 1, exponentIndex: 1 }]);
  assert(!has(inspect(relation({ sources: ['a', 'b'], targets: ['b', 'c'] }, { correspondences: ['a => b', 'b => c'] })), 'pf.correspondence'));
  assert(!has(inspect(relation({ terminal: 'a' }, { sources: ['past'], exponents: ['ed', 'x'] })), 'pf.correspondence'), 'unequal lists are not a pairing');
});

test('linear precedence and rebracketing do not compete for the same ordinary rows', () => {
  // Orders are node lists; prose rows never establish a precedence comparison.
  const precedence = inspect({ ...relation({ order: ['b', 'a'] }), priorAnchors: { order: ['a', 'b'] } }, forest, forest);
  assert(has(precedence, 'pf.linearization'));
  assert(!has(precedence, 'pf.local-dislocation'));
  assert(!has(inspect(relation({ order: ['a', 'b', 'c'] }, { orderRows: ['a < b', 'b < c'] })), 'pf.linearization'));
  // Local dislocation is claimed only when the trees regroup the sequence.
  const regrouped = [node('root', 'CP', [leaf('a'), leaf('b'), leaf('c')])];
  const grouped = [node('root', 'CP', [node('group', 'XP', [leaf('a'), leaf('b')]), leaf('c')])];
  const dislocation = inspect(relation({ sequence: ['a', 'b'] }, { note: 'regrouped at PF' }), regrouped, grouped);
  assert(has(dislocation, 'pf.local-dislocation'));
  assert(!has(dislocation, 'pf.linearization'));
  assert(!has(inspect(relation({ sequence: ['a', 'b'] }, { orderRows: ['a b', '[a b]'] })), 'pf.local-dislocation'), 'bracket text proves nothing');
  assert(!has(inspect(relation({ order: ['a', 'b'] }, { orderRows: ['ordinary prose', 'more prose'] })), 'pf.linearization'));
});

test('specialized plaques consume only their own rows; other context stays inspectable', () => {
  const result = inspect(relation({ predicate: 'v', argument: 'obj' }, { thetaRole: 'Theme', rows: ['context'], note: 'still authored' }));
  assert.deepEqual(result.items.find(item => item.plaqueStyle === 'feature').rows, [{ label: 'rows', value: 'context' }]);
  assert.equal(result.dispatch.primaryRelation.values.note, 'still authored');
});

test('an unrelated carrier cannot specialize an independently complete movement path', () => {
  const tree = [node('root', 'TP', [
    node('source', 'DP', [leaf('gap', { label: 't', word: undefined, silent: true })]),
    node('landing', 'DP', [leaf('word')]), leaf('carrier')
  ])];
  tree[0].children[0].lineageId = tree[0].children[1].lineageId = 'chain';
  const result = inspect(relation({ source: 'source', traceWitness: 'gap', landing: 'landing', movedCarrier: 'carrier' }), tree);
  assert(!has(result, 'movement.carrier'));
  assert(has(result, 'movement.path'));
});

test('explicit head movement conflicting with structural phrasal evidence remains neutral', () => {
  const source = leaf('source', { word: undefined, silent: true, lineageId: 'john' });
  const landing = leaf('landing', { word: 'John', lineageId: 'john' });
  const tree = [node('root', 'T', [landing, node('bar', "T'", [leaf('t', { label: 'T' }), node('vp', 'VP', [source, leaf('v', { label: 'V' })])])])];
  const prior = [node('prior', 'VP', [leaf('source', { word: 'John', lineageId: 'john' })])];
  const result = inspect(relation({ source: 'source', traceWitness: 'source', landing: 'landing' }, undefined, 'HeadMove'), tree, prior);
  assert.equal(result.dispatch.primaryClaim.tier, 3);
  assert(result.dispatch.tier1Dispatch.signatureIssues.some(issue => issue.reason === 'MOVEMENT_KIND_CONFLICT'));
  assert(!result.items.some(item => item.kind === 'trajectory'));
});

test('theta indices distinguish arguments across grids and persist by exact argument identity', () => {
  const theta = (id, name = 'UnregisteredAnalysis') => relation({ predicate: 'v', argument: id }, { thetaRole: 'Role' }, name);
  const stage = (relations, workspaceForest = forest) => ({ statement: 'State', stageRecord: '', relations, workspaceForest });
  const stages = [stage([theta('a'), theta('b', 'ThetaAssignment')]), stage([theta('b'), theta('a')])];
  const original = structuredClone(stages);
  const frames = compileRelationRenderPlan(stages).frames;
  for (const frame of frames) {
    const roles = frame.items.filter(i => i.plaqueStyle === 'theta-grid').flatMap(i => i.thetaRoles);
    assert.equal(roles.find(r => r.nodeId === 'a').index, 'i');
    assert.equal(roles.find(r => r.nodeId === 'b').index, 'j');
  }
  assert.deepEqual(stages, original);
});

test('theta indices respect later authored movement notation without giving it to unrelated arguments', () => {
  const lower = { id: 'a', label: 'DP', word: 'one', lineageId: 'argument' };
  const other = { id: 'b', label: 'DP', word: 'two', lineageId: 'different' };
  const first = [node('vp', 'VP', [leaf('v'), lower, other])];
  const final = [node('tp', 'TP', [{ ...lower, id: 'higher' }, node('vp', 'VP', [leaf('v'), { ...lower, silent: true }, other])])];
  const stages = [
    { statement: 'State', stageRecord: '', workspaceForest: first, relations: [
      relation({ predicate: 'v', arguments: ['a', 'b'] }, { arguments: ['Agent', 'Theme'] })
    ] },
    { statement: 'State', stageRecord: '', workspaceForest: final, relations: [
      relation({ lowerCopy: 'a', higherCopy: 'higher' }, { index: 'j' }),
      relation({ predicate: 'v', argument: 'higher' }, { thetaRole: 'Agent' })
    ] }
  ];
  const plan = compileRelationRenderPlan(stages);
  const roles = plan.frames.flatMap(f => f.items.filter(i => i.plaqueStyle === 'theta-grid').flatMap(i => i.thetaRoles));
  assert.ok(roles.filter(r => r.nodeId === 'a' || r.nodeId === 'higher').every(r => r.index === 'j'));
  assert.ok(roles.filter(r => r.nodeId === 'b').every(r => r.index === 'i'));
  // Conflicting authored indices remain authored; generated theta notation cannot select one.
  stages[1].relations.push(relation({ lowerCopy: 'a', higherCopy: 'higher' }, { index: 'i' }));
  const conflict = compileRelationRenderPlan(stages).frames[0].items.find(i => i.plaqueStyle === 'theta-grid');
  assert.deepEqual(conflict.thetaRoles.map(r => r.index), ['k', 'l']);
});

test('theta allocation does not renumber other established dependency notation', () => {
  const record = { statement: 'State', stageRecord: '', workspaceForest: forest, relations: [
    relation({ first: 'a', second: 'b' }, { index: 'i' }, 'Coreference'),
    relation({ predicate: 'v', argument: 'obj' }, { thetaRole: 'Theme' })
  ] };
  const items = compileRelationRenderPlan([record]).frames[0].items;
  assert.equal(items.find(i => i.kind === 'coindex').index, 'i');
  assert.equal(items.find(i => i.plaqueStyle === 'theta-grid').thetaRoles[0].index, 'j');
});
