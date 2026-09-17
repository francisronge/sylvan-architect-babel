import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dispatchRelationClaimBatch,
  dispatchRelationClaims
} from '../replay/relations/tier2RelationDispatch.ts';
import { createRelationRegistry } from '../replay/relationDispatch/index.js';

const leaf = (id, word, extras = {}) => ({ id, label: 'X', word, ...extras });
const node = (id, label, children = [], extras = {}) => ({ id, label, children, ...extras });

const movementForest = () => {
  const witness = leaf('witness', 't1', { silent: true, lineageId: 'chain' });
  const source = node('source', 'DP', [witness], { lineageId: 'chain' });
  const landing = node('landing', 'DP', [leaf('landing-word', 'book', {
    lineageId: 'chain'
  })], { lineageId: 'chain' });
  const carrier = node('carrier', 'XP', [source]);
  return [node('root', 'TP', [carrier, landing])];
};

const blockedExtractionForest = () => {
  const source = node('blocked_source', 'DP', [leaf('blocked_gap', 'gap')]);
  const adjunct = node('blocked_adjunct', 'CP', [source]);
  const target = node('blocked_target', 'DP', [leaf('blocked_word', 'who')]);
  return [node('blocked_analysis', 'CP', [target, adjunct])];
};

const dispatch = (relation, currentForest, extras = {}) => dispatchRelationClaims({
  relation,
  stageIndex: 0,
  relationIndex: 0,
  currentForest,
  ...extras
});

const claimTiers = (result) => result.claims.map(({ tier }) => tier);
const primaryFallbackReason = (result) => (
  result.primaryClaim?.tier === 3 ? result.primaryClaim.reason : undefined
);

const facetIds = (result) => result.facets.map(({ recipe }) => recipe.id);
const outputKeys = (result) => result.facets.flatMap(({ outputIdentities }) => (
  outputIdentities.map(({ key }) => key)
));
const facetOutputKeys = (result, facetId) => result.facets
  .find(({ recipe }) => recipe.id === facetId)
  ?.outputIdentities.map(({ key }) => key) ?? [];

test('licensing wording has one interpretation across typed domains and unknown relation names', () => {
  const forest = [leaf('a', 'read'), leaf('b', 'books')];
  for (const source of ['licensor', 'licenser', 'licenseSource', 'licensing-head']) {
    for (const target of ['licensee', 'licensedItem', 'licensing_target']) {
      for (const [prefix, values, family] of [
        ['', { case: 'accusative' }, 'feature.dependency'],
        ['', { thetaRole: 'Theme' }, 'theta-grid'],
        ['', { feature: 'strong NPI' }, 'strong-npi'],
        ['case ', { case: 'accusative' }, 'feature.dependency'],
        ['theta ', { thetaRole: 'Theme' }, 'theta-grid']
      ]) {
        const relation = { relation: 'Model-owned name', anchors: { [`${prefix}${source}`]: 'a', [`${prefix}${target}`]: 'b' }, values };
        const original = structuredClone(relation);
        assert.deepEqual(facetIds(dispatch(relation, forest)), [family], JSON.stringify(relation));
        assert.deepEqual(facetIds(dispatch({ ...relation, relation: 'Another name',
          anchors: Object.fromEntries(Object.entries(relation.anchors).reverse()) }, forest)), [family]);
        assert.deepEqual(relation, original, 'interpretation must preserve authored wording');
      }
    }
  }
});

test('licensing equivalents do not establish Agree or supply missing direction, literals or pairing', () => {
  const forest = [leaf('a', 'read'), leaf('b', 'books'), leaf('c', 'Ada')];
  for (const source of ['licensor', 'licenser', 'licenseSource', 'licensing-head']) {
    for (const target of ['licensee', 'licensedItem', 'licensing_target']) {
      for (const values of [{}, { feature: '[+wh]' }, { cycle: '1' }, { case: ['nominative', 'accusative'] }]) {
        assert.deepEqual(facetIds(dispatch({ relation: 'Agree and nominative Case',
          anchors: { [source]: 'a', [target]: 'b' }, values }, forest)), []);
      }
      const mixed = dispatch({ relation: 'Unregistered mixed claim', anchors: { [source]: 'a', [target]: 'b' },
        values: { case: 'accusative', thetaRole: 'Theme' } }, forest);
      assert.deepEqual(facetIds(mixed), ['feature.dependency']);
      assert.ok(mixed.evidenceCoverage.fields.some(field => field.field === 'values'
        && field.key === 'thetaRole' && field.unrecoveredItemIndices.length === 1),
      'the independently supported Case drawing cannot absorb the unresolved theta claim');
    }
  }
  for (const anchors of [
    { nonLicenser: 'a', recipient: 'b' }, { unlicensedHead: 'a', recipient: 'b' },
    { licenser: 'a', recipient: 'missing' }, { licenser: ['a', 'c'], recipient: 'b' },
    { licenser: 'a', licensor: 'c', recipient: 'b' }
  ]) assert.deepEqual(facetIds(dispatch({ relation: 'Case licensing', anchors,
    values: { case: 'nominative' } }, forest)), [], JSON.stringify(anchors));
});

test('shared tree indices are discarded between evaluations of changing forests', () => {
  const forest = movementForest();
  const relation = { relation: 'Unregistered movement', anchors: {
    source: 'source', 'trace witness': 'witness', landing: 'landing'
  } };
  const original = structuredClone(dispatch(relation, forest));
  assert.deepEqual(facetIds(original), ['movement.path']);
  forest[0].children.pop();
  const changed = dispatch(relation, forest);
  assert.deepEqual(facetIds(changed), []);
  assert.deepEqual(claimTiers(changed), [3]);
  assert.deepEqual(dispatch(relation, movementForest()), original,
    'another forest with the same authored IDs must be evaluated independently');
});

test('qualified assignment roles compose from domain and direction with complete literal evidence', () => {
  const forest = [leaf('source', 'read'), leaf('target', 'books'), leaf('second', 'Ada')];
  for (const [anchors, values, family] of [
    [{ caseGovernor: 'source', caseMarked: 'target' }, { Case: 'accusative' }, 'feature.dependency'],
    [{ caseSource: 'source', caseBearer: 'target' }, { Case: 'accusative' }, 'feature.dependency'],
    [{ governor: 'source', caseRecipient: 'target' }, { Case: 'accusative' }, 'feature.dependency'],
    [{ thetaAssigner: 'source', thematicArgument: 'target' }, { thetaRole: 'Theme' }, 'theta-grid'],
    [{ thematicSource: 'source', thetaBearer: 'target' }, { thetaRole: 'Theme' }, 'theta-grid'],
    [{ thetaAssigner: 'source', arguments: ['target', 'second'] }, { arguments: ['Theme', 'Agent'] }, 'theta-grid'],
    [{ assigner: 'source', argument: 'target' }, { thetaRole: 'Theme' }, 'theta-grid'],
    [{ searcher: 'source', agreeGoal: 'target' }, {}, 'feature.dependency']
  ]) {
    const relation = { relation: 'Open claim', anchors, values };
    const original = structuredClone(relation);
    assert(facetIds(dispatch(relation, forest)).includes(family), JSON.stringify(anchors));
    assert.deepEqual(relation, original);
    assert.deepEqual(facetIds(dispatch({ ...relation, anchors: Object.fromEntries(Object.entries(anchors).reverse()) }, forest)),
      facetIds(dispatch(relation, forest)), 'property order must not choose the interpretation');
  }
});

test('qualified roles share Tier-1 binding without completing a malformed registered claim', () => {
  const forest = [leaf('source', 'read'), leaf('target', 'books')];
  const canonical = dispatch({ relation: 'CaseAssignment', anchors: { assigner: 'source', bearer: 'target' } }, forest);
  const qualified = dispatch({ relation: 'CaseAssignment', anchors: { caseGovernor: 'source', caseMarked: 'target' } }, forest);
  assert.deepEqual(claimTiers(qualified), [1]);
  assert.deepEqual(qualified.boundPrimaryRelation.anchors, canonical.boundPrimaryRelation.anchors);
  assert(qualified.claims[0].consumedEvidence.some(ref => ref.key === 'caseGovernor'));
  assert.deepEqual(claimTiers(dispatch({ relation: 'CaseAssignment', anchors: { caseGovernor: 'source' },
    values: { Case: 'accusative' } }, forest)), [3]);
});

test('explicit assignment domains interpret generic directions without relation-name aliases', () => {
  const forest = [leaf('a', 'read'), leaf('b', 'books'), leaf('c', 'Ada')];
  for (const anchors of [{ assigner: 'a', recipient: 'b' }, { source: 'a', target: 'b' },
    { thetaAssigner: 'a', recipient: 'b' }, { source: 'a', thetaBearer: 'b' },
    { assigner: 'a', assignee: 'b' }, { thematicAssigner: 'a', thetaAssignee: 'b' }]) {
    const relation = { relation: 'Open claim', anchors, values: { thetaRole: 'Authored role' } };
    const original = structuredClone(relation);
    assert.ok(facetIds(dispatch(relation, forest)).includes('theta-grid'));
    assert.deepEqual(facetIds(dispatch({ ...relation, anchors: Object.fromEntries(Object.entries(anchors).reverse()) }, forest)),
      facetIds(dispatch(relation, forest)));
    assert.deepEqual(relation, original);
  }
  assert.ok(facetIds(dispatch({ relation: 'Open claim', anchors: { thetaAssigner: 'a', recipient: ['b', 'c'] },
    values: { recipient: ['Theme', 'Agent'] } }, forest)).includes('theta-grid'));
  for (const values of [{ case: 'Accusative' }, { features: ['Case: Accusative'] }]) {
    for (const anchors of [{ assigner: 'a', recipient: 'b' }, { assigner: 'a', assignee: 'b' },
      { caseAssigner: 'a', caseAssignee: 'b' }, { source: 'a', marked: 'b' }])
    assert.ok(facetIds(dispatch({ relation: 'Open claim', anchors, values }, forest))
      .includes('feature.dependency'));
  }
});

test('assignment context cannot guess a domain or choose between competing interpretations', () => {
  const forest = [leaf('a', 'read'), leaf('b', 'books'), leaf('c', 'Ada')];
  for (const [anchors, values] of [
    [{ assigner: 'a', recipient: 'b' }, { role: 'Theme' }],
    [{ assigner: 'a', recipient: 'b' }, { functionLabel: 'administrator' }],
    [{ assigner: 'a', recipient: 'b' }, { thetaRole: 'Theme', case: 'Accusative' }],
    [{ assigner: 'a', recipient: 'b', target: 'c' }, { thetaRole: 'Theme' }],
    [{ assigner: 'a', recipient: ['b', 'c'] }, { thetaRole: 'Theme' }],
    [{ assigner: 'a', recipient: ['b', 'c'] }, { thetaRole: ['Theme', 'Agent'] }],
    [{ assigner: 'a', recipient: 'b' }, { thetaRole: '', functionLabel: 'administrator' }],
    [{ assigner: 'a', recipient: 'missing' }, { thetaRole: 'Theme' }],
    [{ governor: 'a', recipient: 'b' }, { thetaRole: 'Theme' }]
  ]) assert.ok(!facetIds(dispatch({ relation: 'theta-assignment', anchors, values }, forest)).includes('theta-grid'));
});

test('assignment interpretation cannot fill missing literals or turn government and licensing into Agree', () => {
  const forest = [leaf('source', 'read'), leaf('target', 'books')];
  for (const [anchors, values] of [
    [{ governor: 'source', trace: 'target' }, { licensing: 'ECP', Case: 'accusative' }],
    [{ assigner: 'source', assignee: 'target' }, {}],
    [{ assigner: 'source', assignee: 'target' }, { role: 'Theme' }],
    [{ assigner: 'source', assignee: 'target' }, { thetaRole: 'Theme', case: 'Accusative' }],
    [{ assigner: 'source', assignee: 'target', target: 'missing' }, { case: 'Accusative' }],
    [{ governor: 'source', caseMarked: 'target' }, {}],
    [{ caseGovernor: 'source', caseMarked: 'target' }, {}],
    [{ thetaAssigner: 'source', argument: 'target' }, {}],
    [{ licensor: 'source', licensee: 'target' }, {}],
    [{ interrogativeHead: 'source', operator: 'target' }, { feature: '[+wh]' }],
    [{ caseGovernor: 'source', caseMarked: 'missing' }, { Case: 'accusative' }],
    [{ caseGovernor: 'source', caseMarked: 'target' }, { Case: ['accusative', 'nominative'] }]
  ]) assert.deepEqual(facetIds(dispatch({ relation: 'Case accusative, theta Theme, successful licensing', anchors, values }, forest)), [], JSON.stringify(anchors));
});

test('a valid registered identity dispatches only to Tier 1', () => {
  const result = dispatch({
    relation: 'Identity',
    anchors: { occurrences: ['left', 'right'] }
  }, [leaf('left', 'x'), leaf('right', 'x')]);

  assert.deepEqual(claimTiers(result), [1]);
  assert.deepEqual(result.facets, []);
  assert.equal(result.tier1Dispatch.outcome, 'resolved');
});

test('a registered identity with a missing required witness remains Tier 3 despite extra context', () => {
  const result = dispatch({
    relation: 'AbarMove',
    anchors: {
      source: 'source',
      target: 'landing',
      unexplainedParticipant: 'carrier'
    }
  }, movementForest());

  assert.equal(result.tier1Dispatch.outcome, 'signature-incomplete');
  assert.deepEqual(claimTiers(result), [3]);
  assert.equal(primaryFallbackReason(result), 'registered-signature-incomplete');
  assert.deepEqual(result.facets, []);
});

test('an unknown relation with complete movement evidence dispatches only to Tier 2', () => {
  const result = dispatch({
    relation: 'UnknownDependency',
    anchors: {
      source: 'source',
      'trace witness': 'witness',
      landing: 'landing'
    }
  }, movementForest());

  assert.equal(result.tier1Dispatch.outcome, 'unregistered');
  assert.deepEqual(claimTiers(result), [2]);
  assert.deepEqual(facetIds(result), ['movement.path']);
});

test('an unknown relation with no complete facet dispatches only to Tier 3', () => {
  const result = dispatch({
    relation: 'UnknownDependency',
    anchors: { mystery: 'x' }
  }, [leaf('x', 'x')]);

  assert.deepEqual(claimTiers(result), [3]);
  assert.equal(primaryFallbackReason(result), 'no-complete-tier2-facet');
  assert.deepEqual(result.facets, []);
});

test('an unknown relation preserves unconsumed evidence as a separate Tier-3 residual', () => {
  const result = dispatch({
    relation: 'UnknownMovementWithResidual',
    anchors: {
      source: 'source',
      'trace witness': 'witness',
      landing: 'landing',
      mystery: 'carrier'
    }
  }, movementForest());

  assert.deepEqual(claimTiers(result), [2, 3]);
  assert.deepEqual(facetIds(result), ['movement.path']);
  assert.equal(result.primaryClaim?.kind, 'fallback-residual');
  assert.equal(primaryFallbackReason(result), 'unconsumed-envelope-evidence');
  assert.deepEqual(result.primaryRelation, {
    relation: 'UnknownMovementWithResidual',
    anchors: { mystery: 'carrier' }
  });
});

test('one envelope may contain a valid Tier-1 primary and an independent Tier-2 verdict', () => {
  const result = dispatch({
    relation: 'BlockedExtraction',
    anchors: {
      source: 'blocked_source',
      target: 'blocked_target',
      adjunctDomain: 'blocked_adjunct',
      analysis: 'blocked_analysis'
    },
    values: { outcome: 'blocked', judgment: '*', label: 'extraction' }
  }, blockedExtractionForest());

  assert.deepEqual(claimTiers(result), [1, 2]);
  assert.equal(result.primaryClaim?.kind, 'registered-primary');
  assert.deepEqual(facetIds(result), ['judgment.verdict']);
  assert.deepEqual(result.primaryRelation.anchors, {
    source: 'blocked_source',
    target: 'blocked_target',
    adjunctDomain: 'blocked_adjunct'
  });
  assert.deepEqual(result.primaryRelation.values, { outcome: 'blocked' });
  assert.deepEqual(result.claims[1].consumedEvidence, [
    { field: 'anchors', key: 'analysis' },
    { field: 'values', key: 'judgment' },
    { field: 'values', key: 'label' }
  ]);
});

test('an independent Tier-2 verdict survives beside a malformed Tier-3 named primary without repairing it', () => {
  const result = dispatch({
    relation: 'BlockedExtraction',
    anchors: {
      target: 'blocked_target',
      adjunctDomain: 'blocked_adjunct',
      analysis: 'blocked_analysis'
    },
    values: { outcome: 'blocked', judgment: '*', label: 'extraction' }
  }, blockedExtractionForest());

  assert.deepEqual(claimTiers(result), [3, 2]);
  assert.equal(primaryFallbackReason(result), 'registered-signature-incomplete');
  assert.deepEqual(facetIds(result), ['judgment.verdict']);
  assert.deepEqual(result.primaryRelation.anchors, {
    target: 'blocked_target',
    adjunctDomain: 'blocked_adjunct'
  });
});

test('an unknown envelope may recover blocked extraction and its verdict as two Tier-2 claims', () => {
  const result = dispatch({
    relation: 'UnknownBlockedExtraction',
    anchors: {
      'extraction source': 'blocked_source',
      'extraction target': 'blocked_target',
      'adjunct domain': 'blocked_adjunct',
      analysis: 'blocked_analysis'
    },
    values: { outcome: 'blocked', judgment: '*', label: 'extraction' }
  }, blockedExtractionForest());

  assert.deepEqual(claimTiers(result), [2, 2]);
  assert.deepEqual(facetIds(result), ['judgment.verdict', 'blocked-extraction']);
});

test('camelCase authored roles resolve through the same exact Tier-2 vocabulary', () => {
  const result = dispatch({
    relation: 'UnknownBlockedExtraction',
    anchors: {
      extractionSource: 'blocked_source',
      extractionTarget: 'blocked_target',
      adjunctDomain: 'blocked_adjunct'
    },
    values: { outcome: 'blocked' }
  }, blockedExtractionForest());

  assert.deepEqual(claimTiers(result), [2]);
  assert.deepEqual(facetIds(result), ['blocked-extraction']);
});

test('a verdict requires its own explicit analysis anchor', () => {
  const missingAnalysis = dispatch({
    relation: 'UnknownVerdict',
    anchors: { candidate: 'blocked_analysis' },
    values: { judgment: '*', label: 'extraction' }
  }, blockedExtractionForest());
  assert.deepEqual(claimTiers(missingAnalysis), [3]);
  assert.deepEqual(facetIds(missingAnalysis), []);

  const broadTarget = dispatch({
    relation: 'UnknownVerdict',
    anchors: { target: 'blocked_analysis' },
    values: { judgment: '*', label: 'extraction' }
  }, blockedExtractionForest());
  assert.deepEqual(claimTiers(broadTarget), [3]);
  assert.deepEqual(facetIds(broadTarget), []);
});

test('structured feature values recover a generic Tier-2 plaque', () => {
  const currentForest = [
    leaf('licensor', 'C'),
    node('domain', 'TP', [], { silent: true })
  ];
  const genericPlaque = dispatch({
    relation: 'UnknownLicensingFeature',
    anchors: { anchor: 'licensor' },
    values: { rows: '[E]' }
  }, currentForest);
  assert.deepEqual(claimTiers(genericPlaque), [2]);
  assert.deepEqual(facetIds(genericPlaque), ['plaque.structured']);
});

test('complete independent sibling facets survive together', () => {
  const result = dispatch({
    relation: 'UnknownMovementWithGap',
    anchors: {
      source: 'source',
      'trace witness': 'witness',
      landing: 'landing',
      gap: 'witness'
    }
  }, movementForest());

  assert.deepEqual(claimTiers(result), [2, 2]);
  assert.deepEqual(facetIds(result), ['movement.path', 'gap.notation']);
});

test('the carrier facet suppresses its ordinary movement twin', () => {
  const result = dispatch({
    relation: 'UnknownCarrierMovement',
    anchors: {
      source: 'source',
      'trace witness': 'witness',
      landing: 'landing',
      carrier: 'carrier'
    }
  }, movementForest());

  assert.deepEqual(claimTiers(result), [2]);
  assert.deepEqual(facetIds(result), ['movement.carrier']);
  assert.deepEqual(result.diagnostics.find(({ collision }) => (
    collision === 'carrier-or-ordinary-movement'
  )), {
    kind: 'more-specific-facet',
    collision: 'carrier-or-ordinary-movement',
    facets: ['movement.carrier', 'movement.path'],
    winner: 'movement.carrier'
  });
});

test('registered-primary evidence is removed before independent facet collisions are resolved', () => {
  const registry = createRelationRegistry({
    registryId: 'tier2.collision-order',
    version: '1',
    entries: [{
      id: 'carrier-primary',
      version: '1',
      identities: [{ name: 'CarrierPrimary', normalization: 'exact' }],
      signature: {
        anchors: {
          required: { carrier: { minItems: 1, maxItems: 1 } }
        }
      }
    }]
  });
  const result = dispatch({
    relation: 'CarrierPrimary',
    anchors: {
      carrier: 'carrier',
      source: 'source',
      'trace witness': 'witness',
      landing: 'landing'
    }
  }, movementForest(), { registry });

  assert.deepEqual(claimTiers(result), [1, 2]);
  assert.deepEqual(facetIds(result), ['movement.path']);
  assert.deepEqual(result.primaryRelation, {
    relation: 'CarrierPrimary',
    anchors: { carrier: 'carrier' }
  });
  assert.deepEqual(result.diagnostics, []);
});

test('explicit PF evidence selects the PF plate without consuming generic plaques', () => {
  const result = dispatch({
    relation: 'UnknownPfPlate',
    anchors: { 'rewrite output': 'word' },
    values: { 'pf plate rows': ['root: LAUGH -> laughed'] }
  }, [leaf('word', 'laughed')]);

  assert.deepEqual(claimTiers(result), [2]);
  assert.deepEqual(facetIds(result), ['pf.structured']);
});

test('generic feature evidence draws only the generic connector facet', () => {
  const result = dispatch({
    relation: 'UnknownFeatureRelation',
    anchors: { probe: 'probe', goal: 'goal' },
    values: { features: ['Number: PL'] }
  }, [leaf('probe', 'T'), leaf('goal', 'DP')]);

  assert.deepEqual(claimTiers(result), [2]);
  assert.deepEqual(facetIds(result), ['feature.dependency']);
});

test('ordinary Case evidence remains a generic feature dependency', () => {
  const result = dispatch({
    relation: 'UnknownCaseRelation',
    anchors: { probe: 'probe', goal: 'goal' },
    values: { features: ['Case: NOM'] }
  }, [leaf('probe', 'T'), leaf('goal', 'DP')]);

  assert.deepEqual(claimTiers(result), [2]);
  assert.deepEqual(facetIds(result), ['feature.dependency']);
  assert.deepEqual(result.diagnostics, []);
});

test('explicit Dependent Case evidence earns the dependent-case elbow', () => {
  for (const literal of ['Dependent Case: NOM', 'dependent-case assignment: ACC', 'DependentCase: ERG']) {
    const result = dispatch({
      relation: 'UnknownDependentCaseRelation',
      anchors: { probe: 'probe', goal: 'goal' },
      values: { features: [literal] }
    }, [leaf('probe', 'T'), leaf('goal', 'DP')]);

    assert.deepEqual(claimTiers(result), [2], literal);
    assert.deepEqual(facetIds(result), ['dependent-case'], literal);
    assert.deepEqual(result.diagnostics, [{
      kind: 'more-specific-facet',
      collision: 'dependent-case-or-generic-feature',
      facets: ['dependent-case', 'feature.dependency'],
      winner: 'dependent-case'
    }], literal);
  }
});

test('Case-like words do not earn the dependent-case elbow', () => {
  for (const literal of ['caseless', 'showcase', 'uCase']) {
    const result = dispatch({
      relation: 'UnknownCaseRelation',
      anchors: { probe: 'probe', goal: 'goal' },
      values: { features: [literal] }
    }, [leaf('probe', 'T'), leaf('goal', 'DP')]);

    assert.deepEqual(claimTiers(result), [2], literal);
    assert.deepEqual(facetIds(result), ['feature.dependency'], literal);
  }
});

test('authored polarity and index evidence earn Accord over the generic connector', () => {
  const result = dispatch({
    relation: 'UnknownPolarityRelation',
    anchors: { source: 'source', goal: 'goal' },
    values: { features: ['POL: negative'], index: '1' }
  }, [leaf('source', 'I'), leaf('goal', 'DP')]);

  assert.deepEqual(claimTiers(result), [2]);
  assert.deepEqual(facetIds(result), ['accord']);
  assert.deepEqual(result.diagnostics, [{
    kind: 'more-specific-facet',
    collision: 'accord-or-generic-feature',
    facets: ['accord', 'feature.dependency'],
    winner: 'accord'
  }]);
});

test('conflicting specialized feature evidence keeps only the generic connector', () => {
  const result = dispatch({
    relation: 'UnknownMixedFeatureRelation',
    anchors: { probe: 'source', goal: 'goal' },
    values: { features: ['Dependent Case: NOM', 'POL: negative'], index: '1' }
  }, [leaf('source', 'I'), leaf('goal', 'DP')]);

  assert.deepEqual(claimTiers(result), [2, 3]);
  assert.deepEqual(facetIds(result), ['feature.dependency']);
  assert.equal(primaryFallbackReason(result), 'unconsumed-envelope-evidence');
  assert.deepEqual(result.primaryRelation, {
    relation: 'UnknownMixedFeatureRelation',
    anchors: {},
    values: { index: '1' }
  });
  assert.deepEqual(result.diagnostics, [{
    kind: 'ambiguous-facets',
    collision: 'specialized-feature-reading',
    facets: ['dependent-case', 'accord']
  }]);
});

test('a broad carrier alias leaves incompatible enclosure readings unresolved', () => {
  const result = dispatch({
    relation: 'UnknownConstituentRelation',
    anchors: { carrier: 'xp' }
  }, [node('xp', 'XP', [leaf('word', 'x')])]);

  assert.deepEqual(claimTiers(result), [3]);
  assert.equal(primaryFallbackReason(result), 'no-complete-tier2-facet');
  assert.equal(result.diagnostics[0].collision, 'constituent-enclosure-reading');
});

test('an explicit storage host selects the ledger without becoming another plaque', () => {
  const result = dispatch({
    relation: 'UnknownScopeRecord',
    anchors: { scope: 'scope' },
    values: { qstore: ['q'] }
  }, [node('scope', 'S', [leaf('word', 'someone')])]);

  assert.deepEqual(claimTiers(result), [2]);
  assert.deepEqual(facetIds(result), ['storage.ledger']);
  assert.deepEqual(result.diagnostics, []);
});

test('an outcome-specific local judgment does not imply an analysis verdict', () => {
  const result = dispatch({
    relation: 'UnknownJudgment',
    anchors: { candidate: 'root' },
    values: { verdict: 'blocked' }
  }, [leaf('root', 'x')]);

  assert.deepEqual(claimTiers(result), [2]);
  assert.deepEqual(facetIds(result), ['judgment.blocked']);
  assert.deepEqual(result.diagnostics, []);
});

test('independently complete rewrite and fission claims both survive', () => {
  const result = dispatch({
    relation: 'UnknownPfComposition',
    anchors: {
      'rewrite output': 'output',
      'rewrite outputs': ['output-a', 'output-b']
    },
    priorAnchors: {
      'rewrite input': 'prior-input'
    },
    values: {
      'rewrite rows': ['go -> went'],
      inputFeatures: ['person', 'number'], 'rewrite outputs': ['person', 'number']
    }
  }, [
    leaf('output', 'went'),
    leaf('output-a', '-s'),
    leaf('output-b', '-e')
  ], {
    priorForest: [leaf('prior-input', 'go')]
  });

  assert.deepEqual(claimTiers(result), [2, 2]);
  assert.deepEqual(facetIds(result), ['pf.rewrite', 'pf.fission']);
});

test('a Tier-2 facet exclusively owns every prior anchor and value it consumes', () => {
  const registry = createRelationRegistry({
    registryId: 'tier2.prior-value-ownership',
    version: '1',
    entries: [{
      id: 'registered-primary',
      version: '1',
      identities: [{ name: 'RegisteredWithFission', normalization: 'exact' }],
      signature: {
        anchors: {
          required: { primary: { minItems: 1, maxItems: 1 } }
        }
      }
    }]
  });
  const result = dispatch({
    relation: 'RegisteredWithFission',
    anchors: {
      primary: 'primary',
      outputs: ['output-a', 'output-b']
    },
    priorAnchors: { input: 'prior-input' },
    values: { inputFeatures: ['person', 'plural'], outputs: ['person', 'plural'] }
  }, [
    leaf('primary', 'primary'),
    leaf('output-a', '-su'),
    leaf('output-b', '-e')
  ], {
    priorForest: [leaf('prior-input', '-sue')],
    registry
  });

  assert.deepEqual(claimTiers(result), [1, 2]);
  assert.deepEqual(facetIds(result), ['pf.fission']);
  assert.deepEqual(result.primaryRelation, {
    relation: 'RegisteredWithFission',
    anchors: { primary: 'primary' }
  });
  assert.deepEqual(result.claims[1].consumedEvidence, [
    { field: 'priorAnchors', key: 'input' },
    { field: 'anchors', key: 'outputs' },
    { field: 'values', key: 'outputs' },
    { field: 'values', key: 'inputFeatures' }
  ]);
});

test('a valid open-anchor primary keeps all prior and value evidence under Tier-2 pressure', () => {
  const registry = createRelationRegistry({
    registryId: 'tier2.valid-primary-evidence-guard',
    version: '1',
    entries: [{
      id: 'open-primary',
      version: '1',
      identities: [{ name: 'OpenPrimaryWithFissionShape', normalization: 'exact' }],
      signature: {
        anchors: {
          required: { primary: { minItems: 1, maxItems: 1 } },
          allowAdditional: true
        },
        priorAnchors: { allowAdditional: true },
        values: { allowAdditional: true }
      }
    }]
  });
  const relation = {
    relation: 'OpenPrimaryWithFissionShape',
    anchors: {
      primary: 'primary',
      outputs: ['output-a', 'output-b']
    },
    priorAnchors: { input: 'prior-input' },
    values: { features: ['person', 'plural'] }
  };
  const result = dispatch(relation, [
    leaf('primary', 'primary'),
    leaf('output-a', '-su'),
    leaf('output-b', '-e')
  ], {
    priorForest: [leaf('prior-input', '-sue')],
    registry
  });

  assert.deepEqual(claimTiers(result), [1]);
  assert.deepEqual(result.facets, []);
  assert.deepEqual(result.primaryRelation, relation);
  assert.equal(result.tier1Dispatch.outcome, 'resolved');
});

test('presentation and organizational companions require a surviving parent claim', () => {
  const anchors = Array.from({ length: 5 }, (_, index) => leaf(`member-${index}`, 'x', {
    lineageId: 'family'
  }));
  const result = dispatch({
    relation: 'UnknownIdentityPresentation',
    anchors: {
      members: anchors.map(({ id }) => id),
      occurrences: anchors.map(({ id }) => id),
      anchors: anchors.slice(0, 2).map(({ id }) => id)
    }
  }, anchors, { activeLens: true });

  assert.deepEqual(claimTiers(result), [2]);
  assert.deepEqual(facetIds(result), [
    'identity.occurrences',
    'presentation.lens',
    'organization.large-anchor-set'
  ]);
  assert.deepEqual(result.facets.slice(1).map(({ parentFacetIds }) => parentFacetIds), [
    ['identity.occurrences'],
    ['identity.occurrences']
  ]);
});

test('structurally identical authored entries remain independent through dispatch', () => {
  const first = {
    relation: 'UnknownMovement',
    anchors: {
      source: 'source',
      'trace witness': 'witness',
      landing: 'landing'
    },
    values: { outcome: 'licensed', label: ['one', 'two'] }
  };
  const duplicateWithReorderedObjectKeys = {
    values: { label: ['one', 'two'], outcome: 'licensed' },
    anchors: {
      landing: 'landing',
      'trace witness': 'witness',
      source: 'source'
    },
    relation: 'UnknownMovement'
  };
  const entries = dispatchRelationClaimBatch({
    relations: [first, duplicateWithReorderedObjectKeys],
    stageIndex: 3,
    currentForest: movementForest()
  });

  assert.equal(entries.length, 2);
  assert.ok(entries.every(({ dispatch: result }) => (
    JSON.stringify(claimTiers(result)) === JSON.stringify([2, 3])
  )));
  assert.ok(entries.every(({ dispatch: result }) => (
    result.primaryClaim?.kind === 'fallback-residual'
  )));
  assert.deepEqual(entries.map(({ dispatch: result }) => result.relationInstance), [
    { stageIndex: 3, relationIndex: 0 },
    { stageIndex: 3, relationIndex: 1 }
  ]);
  assert.deepEqual(outputKeys(entries[0].dispatch), outputKeys(entries[1].dispatch));
});

test('different unknown names remain separate claims but may earn the same completed visual output', () => {
  const anchors = {
    source: 'source',
    'trace witness': 'witness',
    landing: 'landing'
  };
  const entries = dispatchRelationClaimBatch({
    relations: [
      { relation: 'UnknownMovementOne', anchors },
      { relation: 'UnknownMovementTwo', anchors }
    ],
    stageIndex: 0,
    currentForest: movementForest()
  });

  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map(({ dispatch: result }) => facetIds(result)), [
    ['movement.path'],
    ['movement.path']
  ]);
  assert.deepEqual(outputKeys(entries[0].dispatch), outputKeys(entries[1].dispatch));
});

test('role aliases normalize together while extra values and prior anchors keep outputs separate', () => {
  const entries = dispatchRelationClaimBatch({
    relations: [
      {
        relation: 'UnknownMovement',
        anchors: { source: 'source', 'trace witness': 'witness', landing: 'landing' }
      },
      {
        relation: 'UnknownMovement',
        anchors: { origin: 'source', trace: 'witness', target: 'landing' }
      },
      {
        relation: 'UnknownMovement',
        anchors: { source: 'source', 'trace witness': 'witness', landing: 'landing' },
        values: { outcome: 'blocked' }
      },
      {
        relation: 'UnknownMovement',
        anchors: { source: 'source', 'trace witness': 'witness', landing: 'landing' },
        priorAnchors: { source: 'prior-source' }
      }
    ],
    stageIndex: 1,
    currentForest: movementForest(),
    priorForest: [leaf('prior-source', 'book', { lineageId: 'chain' })]
  });

  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map(({ dispatch: result }) => result.relationInstance.relationIndex), [0, 1, 2, 3]);
  assert.deepEqual(
    facetOutputKeys(entries[0].dispatch, 'movement.path'),
    facetOutputKeys(entries[1].dispatch, 'movement.path')
  );
  assert.notDeepEqual(
    facetOutputKeys(entries[0].dispatch, 'movement.path'),
    facetOutputKeys(entries[2].dispatch, 'movement.path')
  );
  assert.notDeepEqual(
    facetOutputKeys(entries[0].dispatch, 'movement.path'),
    facetOutputKeys(entries[3].dispatch, 'movement.path')
  );
});

test('movement, Forest light, feature valuation, and lens survive together on shared anchors', () => {
  const entries = dispatchRelationClaimBatch({
    relations: [
      {
        relation: 'UnknownMovement',
        anchors: { source: 'source', 'trace witness': 'witness', landing: 'landing' }
      },
      {
        relation: 'UnknownIdentity',
        anchors: {
          occurrences: ['source', 'landing'],
          anchors: ['source', 'landing']
        }
      },
      {
        relation: 'UnknownFeatureValuation',
        anchors: { probe: 'source', goal: 'landing' },
        values: { features: ['Number: PL'] }
      }
    ],
    stageIndex: 0,
    currentForest: movementForest(),
    activeLens: true
  });

  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map(({ dispatch: result }) => facetIds(result)), [
    ['movement.path'],
    ['identity.occurrences', 'presentation.lens'],
    ['feature.dependency']
  ]);
  assert.deepEqual(entries[1].dispatch.facets.flatMap(({ evaluation }) => evaluation.outputs), [
    'Coindex',
    'Forest light',
    'Lens emphasis'
  ]);
});

test('a companion records every surviving parent claim instead of guessing one', () => {
  const result = dispatch({
    relation: 'UnknownMovementWithGapAndLens',
    anchors: {
      source: 'source',
      'trace witness': 'witness',
      landing: 'landing',
      gap: 'witness',
      anchors: ['source', 'landing']
    }
  }, movementForest(), { activeLens: true });

  assert.deepEqual(claimTiers(result), [2, 2]);
  assert.deepEqual(facetIds(result), ['movement.path', 'gap.notation', 'presentation.lens']);
  assert.deepEqual(result.facets[2].parentFacetIds, ['gap.notation', 'movement.path']);
  assert.ok(result.facets.every(({ facetIdentity, outputIdentities }) => (
    facetIdentity.length > 0 && outputIdentities.length > 0
  )));
});
