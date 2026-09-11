import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const leaf = (id, extra = {}) => ({ id, label: 'D', word: id, ...extra });
const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });
const forest = [node('root', 'TP', [leaf('a'), leaf('b'), leaf('c'), leaf('v')])];
const relation = (anchors, values, name = 'IndependentLiteralClaim') => ({ relation: name, anchors, ...(values && { values }) });
const inspect = (record, currentForest = forest, priorForest) => {
  const before = structuredClone({ record, currentForest, priorForest });
  const dispatch = dispatchRelationClaims({ relation: record, currentForest, priorForest, stageIndex: priorForest ? 1 : 0, relationIndex: 0 });
  const stage = { statement: 'Authored state', stageRecord: 'Authored record', relations: [record], workspaceForest: currentForest };
  const plan = compileRelationRenderPlan(priorForest ? [{ ...stage, relations: [], workspaceForest: priorForest }, stage] : [stage]);
  assert.deepEqual({ record, currentForest, priorForest }, before);
  return { dispatch, facets: dispatch.facets.map(facet => facet.recipe.id), items: plan.frames.at(-1).items, diagnostics: plan.diagnostics };
};

for (const blank of ['', ' ']) {
  test(`blank ${JSON.stringify(blank)} slots cannot repair unequal associations`, () => {
    for (const [anchors, values, facet] of [
      [{ predicate: 'v', arguments: ['a', 'b'] }, { thetaRole: ['Theme', blank, 'Agent'] }, 'theta-grid'],
      [{ assigner: 'v', recipient: ['a', 'b'] }, { case: ['NOM', blank, 'ACC'] }, 'feature.dependency'],
      [{ correspondenceSource: ['a', 'b'], correspondenceTarget: ['b', 'c'] }, { correspondenceSource: ['i', blank, 'j'] }, 'correspondence.alignment']
    ]) {
      const result = inspect(relation(anchors, values));
      assert(!result.facets.includes(facet));
      assert.deepEqual(result.dispatch.primaryRelation.values, values);
    }
  });

  test(`blank ${JSON.stringify(blank)} required labels stay neutral while optional index slots retain positions`, () => {
    const theta = inspect(relation({ predicate: 'v', arguments: ['a', 'b', 'c'] }, { thetaRole: ['Theme', blank, 'Agent'] }));
    assert(!theta.facets.includes('theta-grid'));
    assert(!theta.items.some(item => item.plaqueStyle === 'theta-grid'));
    assert.deepEqual(theta.dispatch.primaryRelation.values.thetaRole, ['Theme', blank, 'Agent']);
    const cases = inspect(relation({ assigner: 'v', recipient: ['a', 'b', 'c'] }, { case: ['NOM', blank, 'ACC'] }));
    assert(!cases.facets.includes('feature.dependency'));
    assert(!cases.items.some(item => item.pathStyle === 'case-assignment'));
    assert.deepEqual(cases.dispatch.primaryRelation.values.case, ['NOM', blank, 'ACC']);
    const indices = inspect(relation({ correspondenceSource: ['a', 'b', 'c'], correspondenceTarget: ['b', 'c', 'a'] }, { correspondenceSource: ['i', blank, 'j'] }));
    assert.deepEqual(indices.items.filter(item => item.kind === 'coindex').map(item => [item.nodeIds, item.index]),
      [[['a', 'b'], 'i'], [['c', 'a'], 'j']]);
    assert.deepEqual(indices.dispatch.primaryRelation.values.correspondenceSource, [blank]);
    const movedBlank = inspect(relation({ correspondenceSource: ['a', 'b', 'c'], correspondenceTarget: ['b', 'c', 'a'] }, { correspondenceSource: ['i', 'j', blank] }));
    assert.notEqual(indices.dispatch.facets[0].facetIdentity, movedBlank.dispatch.facets[0].facetIdentity);
  });

  test(`blank ${JSON.stringify(blank)} PF slots retain links, grouping and delink position`, () => {
    const correspondence = inspect(relation({ terminal: 'a' }, { sources: ['past', blank, 'plural'], exponents: [blank, 'ed', 's'], correspondence: ['past => ed', 'plural => s'] }));
    assert.deepEqual(correspondence.items.find(item => item.plaqueStyle === 'correspondence').nativeContent,
      { kind: 'correspondence', sources: ['past', blank, 'plural'], exponents: [blank, 'ed', 's'], links: [{ sourceIndex: 0, exponentIndex: 1 }, { sourceIndex: 2, exponentIndex: 2 }] });
    const impoverishment = inspect(relation({ terminal: 'a' }, { featureHierarchy: ['phi', blank, 'number', 'plural'], delinkAfter: 'number' }));
    assert.deepEqual(impoverishment.items.find(item => item.plaqueStyle === 'impoverishment').nativeContent,
      { kind: 'impoverishment', features: ['phi', blank, 'number', 'plural'], delinkIndex: 2 });
    const fission = inspect({ ...relation({ outputs: ['a', 'b'] }, { inputFeatures: ['past', blank, 'plural'], outputOneFeatures: ['past', blank], outputTwoFeatures: ['plural'] }), priorAnchors: { input: 'input' } }, forest, [leaf('input')]);
    assert.deepEqual(fission.items.find(item => item.plaqueStyle === 'fission').nativeContent,
      { kind: 'fission', inputFeatures: ['past', blank, 'plural'], outputFeatures: [['past', blank], ['plural']] });
    const badLinks = inspect(relation({ terminal: 'a' }, { sources: ['past'], exponents: ['ed'], correspondence: ['past => ed', blank] }));
    assert(!badLinks.facets.includes('pf.correspondence'));
    assert.deepEqual(badLinks.dispatch.primaryRelation.values.correspondence, ['past => ed', blank]);
  });
}

test('Case preserves repeated recipient occurrences without inferring their meaning', () => {
  const result = inspect(relation({ assigner: 'v', recipient: ['a', 'a'] }, { recipient: ['NOM', 'not-a-restriction'] }));
  assert.deepEqual(result.items.filter(item => item.pathStyle === 'case-assignment').map(item => [item.fromNodeId, item.toNodeId, item.label]),
    [['v', 'a', 'NOM'], ['v', 'a', 'not-a-restriction']]);
  assert(!inspect(relation({ assigner: 'a', recipient: ['a', 'b'] }, { case: ['NOM', 'ACC'] })).facets.includes('feature.dependency'));
});

for (const [facet, positives, negatives] of [
  ['dependent-case', ['dependent case', 'Dependent Case: NOM', 'dependent-case assignment: ACC', 'DependentCase: ERG', 'Dependent case (ACC)', 'Case: dependent', '[Dependent case: ACC]', 'dependent case: nom/acc', 'dependent case: DP-internal', 'dependent case: DP internal'],
    ['dependent case: not assigned', 'dependent case: absent', 'not dependent case', 'dependent case: false', 'Case: not dependent']],
  ['accord', ['polarity', 'POL: negative', '[Pol: neg]', '(Pol: pos)', 'polarity positive', '[uPol]', 'Pol: -', '[uPol:\u2212]', '[uPol:+]'],
    ['polarity: not asserted', 'polarity: absent', 'no polarity', 'polarity: false', 'non-polarity']]
]) {
  test(`${facet} accepts bounded affirmative feature notation`, () => {
    for (const feature of positives) {
      const result = inspect(relation({ probe: 'a', goal: 'b' }, { features: [feature, 'unrelated literal row'], index: 'k' }));
      assert(result.facets.includes(facet), feature);
      const path = result.items.find(item => item.pathStyle === facet);
      assert.deepEqual(path.relationRef.values.features, [feature, 'unrelated literal row']);
      if (facet === 'dependent-case') assert.equal(path.label, feature);
      else assert.deepEqual(path.featureRow, { label: 'features', value: feature });
      assert.deepEqual(result.dispatch.primaryRelation.values.features, ['unrelated literal row']);
    }
  });
  test(`${facet} rejects denial and contradictory arrays in either order`, () => {
    for (const feature of negatives) {
      for (const features of [feature, [positives[0], feature], [feature, positives[0]]]) {
        const result = inspect(relation({ probe: 'a', goal: 'b' }, { features, index: 'k' }));
        assert(!result.facets.includes(facet), JSON.stringify(features));
        assert(!result.items.some(item => item.pathStyle === facet));
        assert.equal(result.items.find(item => item.pathStyle === 'case-agree').label,
          (Array.isArray(features) ? features : [features]).join(', '));
      }
    }
  });
}

const scopeRelation = relation({ scopeSource: 'source', covertLanding: 'target', scopeDomain: 'root' }, { index: 'q' });
test('feature prose remains residual beside an affirmative assertion but explicit contradictions veto it', () => {
  for (const [facet, feature, prose, contradiction] of [
    ['dependent-case', 'dependent case: nom/acc', 'dependent case is assigned to the lower DP', 'dependent case is not assigned'],
    ['accord', '[uPol:\u2212]', 'polarity is associated with the lower DP', 'polarity is not asserted']
  ]) {
    for (const features of [[feature, prose, prose], [prose, feature, prose]]) {
      const record = relation({ probe: 'a', goal: 'b' }, { features, index: 'k' });
      const result = inspect(record);
      assert(result.facets.includes(facet));
      assert.deepEqual(result.dispatch.primaryRelation.values.features, [prose, prose]);
      const claim = result.dispatch.claims.find(item => item.tier === 2);
      assert.deepEqual(claim.consumedEvidence.find(item => item.key === 'features').itemIndices, [features.indexOf(feature)]);
    }
    assert(!inspect(relation({ probe: 'a', goal: 'b' }, { features: prose, index: 'k' })).facets.includes(facet));
    for (const features of [[feature, contradiction, prose], [prose, contradiction, feature]]) {
      assert(!inspect(relation({ probe: 'a', goal: 'b' }, { features, index: 'k' })).facets.includes(facet));
    }
  }
});

test('blank required role labels and anchors never earn a repaired theta assignment', () => {
  for (const name of ['IndependentLiteralClaim', 'ThetaAssignment']) {
    for (const labels of [['Agent', ''], ['Agent', ' ']]) {
      const result = inspect(relation({ predicate: 'v', arguments: ['a', 'b'] }, { thetaRole: labels }, name));
      assert(!result.items.some(item => item.plaqueStyle === 'theta-grid'));
      assert(!result.facets.includes('theta-grid'));
      assert.deepEqual(result.dispatch.primaryRelation.values.thetaRole, labels);
    }
  }
  const missing = inspect(relation({ predicate: 'v', arguments: ['a', ''] }, { thetaRole: ['Agent', 'Theme'] }));
  assert(!missing.facets.includes('theta-grid'));
  assert(!inspect(relation({ probe: 'a', goal: 'b' }, { features: '[Pol:-]', index: '' })).facets.includes('accord'));
});

test('blank optional gap annotations keep the witnessed gap and do not shift later indices', () => {
  const tree = [leaf('a', { word: 't', silent: true }), leaf('b', { word: 't', silent: true })];
  for (const blank of ['', ' ']) {
    // Indices pair through the same-name entry; the differently named label
    // list is unpaired context and stays whole in the residue.
    const record = relation({ gap: ['a', 'b'] }, { label: [blank, blank], gap: [blank, 'j'] });
    const result = inspect(record, tree);
    assert(result.facets.includes('gap.notation'));
    assert.deepEqual(result.items.find(item => item.badgeStyle === 'gap-notation').badges,
      [{ nodeId: 'a', text: 't', shape: 'plain' }, { nodeId: 'b', text: 't_j', shape: 'plain' }]);
    assert.deepEqual(result.dispatch.primaryRelation.values, { label: [blank, blank], gap: [blank] });
    const mismatch = inspect(relation({ gap: ['a', 'b'] }, { gap: ['i', blank, 'j'] }), tree);
    assert(!mismatch.facets.includes('gap.notation'));
  }
});

test('covert movement requires exact root identity, not a shared descendant', () => {
  for (const lineages of [[undefined, undefined], ['left-root', 'right-root']]) {
    const tree = [node('root', 'TP', [node('source', 'DP', [leaf('left', { lineageId: 'child' })], { lineageId: lineages[0] }), node('target', 'CP', [leaf('right', { lineageId: 'child' })], { lineageId: lineages[1] })])];
    const result = inspect(scopeRelation, tree);
    assert(!result.facets.includes('scope.movement'));
    assert(!result.items.some(item => item.kind === 'quantifier-raising'));
    assert.deepEqual(result.dispatch.primaryRelation, scopeRelation);
  }
  const tree = [node('root', 'TP', [leaf('source', { lineageId: 'q' }), leaf('target', { lineageId: 'q' })])];
  const result = inspect(scopeRelation, tree);
  assert(result.facets.includes('scope.movement'));
  assert.equal(result.items.find(item => item.kind === 'quantifier-raising').index, 'q');
  assert(!inspect({ ...scopeRelation, anchors: { ...scopeRelation.anchors, covertLanding: 'source' } }, tree).facets.includes('scope.movement'));
});

test('covert transition counts the named root lineage, not new shared descendants', () => {
  const source = node('source', 'DP', [leaf('left', { lineageId: 'child' })], { lineageId: 'q' });
  const target = node('target', 'DP', [leaf('right', { lineageId: 'child' })], { lineageId: 'q' });
  const current = [node('root', 'TP', [source, target])];
  const facet = result => result.dispatch.facets.find(item => item.recipe.id === 'scope.movement');
  assert.deepEqual(facet(inspect(scopeRelation, current, [node('prior', 'TP', [source])])).evaluation.earnedTransitions, ['movement']);
  const prior = [node('prior', 'TP', [source, leaf('old-target', { lineageId: 'q' })])];
  assert.deepEqual(facet(inspect(scopeRelation, current, prior)).evaluation.earnedTransitions, []);
});

test('unclaimed anchor context is reported once without weakening a complete Tier1 core', () => {
  const record = relation({ probe: 'a', goal: 'b', extraContext: ['c', 'c'], anotherContext: 'v' }, undefined, 'Agree');
  const result = inspect(record);
  assert.equal(result.dispatch.primaryClaim.tier, 1);
  assert.deepEqual(result.dispatch.primaryRelation, relation({ probe: 'a', goal: 'b' }, undefined, 'Agree'));
  assert.deepEqual(result.dispatch.residualRelation.anchors, { extraContext: ['c', 'c'], anotherContext: 'v' });
  const warnings = result.diagnostics.filter(item => item.kind === 'unrecovered-evidence');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].detail, /extraContext/);
  assert.match(warnings[0].detail, /anotherContext/);
  const malformed = inspect(relation({ probe: 'a', extraContext: 'c' }, undefined, 'Agree'));
  assert.equal(malformed.dispatch.primaryClaim.tier, 3);
  assert(malformed.dispatch.tier1Dispatch.signatureIssues.some(issue => issue.kind === 'missing-role'));
  assert.equal(malformed.diagnostics.filter(item => item.kind === 'unrecovered-evidence').length, 0);
});

test('context consumed by an independent companion is not reported as unrendered', () => {
  const result = inspect(relation({ probe: 'a', goal: 'b', predicate: 'v', argument: 'c' }, { thetaRole: 'Theme' }, 'Agree'));
  assert.equal(result.dispatch.primaryClaim.tier, 1);
  assert(result.facets.includes('theta-grid'));
  assert.equal(result.diagnostics.filter(item => item.kind === 'unrecovered-evidence').length, 0);
  const extra = inspect(relation({ probe: 'a', goal: 'b', predicate: 'v', argument: 'c', unclaimedContext: 'root' }, { thetaRole: 'Theme' }, 'Agree'));
  assert.equal(extra.diagnostics.filter(item => item.kind === 'unrecovered-evidence').length, 1);
});

test('a registered contradictory outcome has one causal diagnostic and remains malformed', () => {
  const result = inspect(relation({ probe: 'a', goal: 'b' }, { outcome: ['licensed', 'blocked'] }, 'Agree'));
  assert.equal(result.dispatch.primaryClaim.tier, 3);
  assert.equal(result.diagnostics.filter(item => /outcome-conflict|ambiguous-outcome-values/.test(item.detail)).length, 1);
});

test('unlabeled argument sharing carries its exact shared witness without a fabricated badge', () => {
  const shared = leaf('shared');
  const tree = [node('root', 'TP', [node('left', 'VP', [shared]), node('right', 'VP', [structuredClone(shared)])])];
  const result = inspect(relation({ predicateDomains: ['left', 'right'], sharedArgument: 'shared' }), tree);
  assert.deepEqual(result.items.filter(item => item.domainStyle === 'argument-domain').map(item => [item.rootNodeId, item.sharedNodeId]), [['left', 'shared'], ['right', 'shared']]);
  assert(!result.items.some(item => item.badgeStyle === 'shared-object'));
});

test('Dependent Case prepares one literal step and never selects the first of several', () => {
  const anchors = { probe: 'a', goal: 'b' };
  const good = inspect(relation(anchors, { features: 'Dependent case (ACC)', step: ' 1 ' }));
  assert.equal(good.items.find(item => item.pathStyle === 'dependent-case').dependentCaseStep, '1');
  assert.equal(inspect(relation(anchors, { features: 'dependent case' })).items.find(item => item.pathStyle === 'dependent-case').dependentCaseStep, undefined);
  const bad = inspect(relation(anchors, { features: 'dependent case', step: ['1', '2'] }));
  assert(!bad.facets.includes('dependent-case'));
  assert.deepEqual(bad.dispatch.primaryRelation.values.step, ['1', '2']);
  for (const step of ['', ' ', [], [''], '3', 'Step 1', 'first']) {
    const invalid = inspect(relation(anchors, { features: 'dependent case', step }));
    assert(!invalid.facets.includes('dependent-case'), JSON.stringify(step));
    assert.deepEqual(invalid.dispatch.primaryRelation.values.step, step);
  }
});

test('linearization prepares only explicit columns or ordered prior/current witnesses', () => {
  const values = { priorOrder: [' a < b ', ' a < b '], currentOrder: [' b < a '] };
  const explicit = inspect(relation({ order: 'root' }, values));
  assert.deepEqual(explicit.items.find(item => item.plaqueStyle === 'linearization').nativeContent,
    { kind: 'linearization', currentNodeIds: ['root'], priorNodeIds: [], priorRows: values.priorOrder, currentRows: values.currentOrder, conflict: false });
  const witnessed = inspect({ ...relation({ order: ['b', 'a'] }), priorAnchors: { order: ['a', 'b'] } }, forest, forest);
  assert.deepEqual(witnessed.items.find(item => item.plaqueStyle === 'linearization').nativeContent,
    { kind: 'linearization', currentNodeIds: ['b', 'a'], priorNodeIds: ['a', 'b'], priorRows: ['a < b'], currentRows: ['b < a'], conflict: false });
  for (const rows of [{ orderRows: ['a < b', 'b < a'] }, { priorOrder: ['a < b'], currentOrder: [''] }]) {
    const bad = inspect(relation({ order: 'root' }, rows));
    assert(!bad.facets.includes('pf.linearization'));
    assert.deepEqual(bad.dispatch.primaryRelation.values, rows);
  }
});
