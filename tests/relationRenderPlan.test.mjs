import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { createRelationRegistry } from '../replay/relationDispatch/index.js';
import {
  compileRelationRenderPlan,
  planItemOwnsRelationMoment,
  isPlanItemRevealed
} from '../replay/relations/renderPlanCompiler.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { fallbackDrawing } from '../replay/relations/fallbackTopology.ts';
import {
  LARGE_ANCHOR_ARRAY_THRESHOLD,
  compileLargeAnchorSets
} from '../replay/relations/largeAnchorSets.ts';

const leaf = (id, label, word, extra = {}) => ({ id, label, ...(word ? { word } : {}), ...extra });
const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });

const stage = (relations, forest, overrides = {}) => ({
  statement: 'statement',
  stageRecord: 'record',
  relations: relations,
  workspaceForest: forest,
  ...overrides
});

test('restated current-state claims paint once as their workspace grows and retain every moment', () => {
  const forest = [node('vp', 'VP', [leaf('v', 'V', 'praise'), leaf('dp', 'DP', 'himself'), leaf('subject', 'DP', 'Leo')])];
  const relations = [
    { relation: 'Theme-role assignment', anchors: { predicate: 'v', argument: 'dp' }, values: { thetaRole: 'Theme' } },
    { relation: 'Local anaphor binding', anchors: { antecedent: 'subject', anaphor: 'dp', localDomain: 'vp' }, values: { condition: 'Condition A satisfied' } }
  ];
  const stages = Array.from({ length: 6 }, (_, i) => stage(structuredClone(relations),
    i === 0 ? forest : [node(`root${i}`, 'CP', structuredClone(forest))]));
  const original = structuredClone(stages);
  const plan = compileRelationRenderPlan(stages);
  assert.deepEqual(stages, original, 'drawing coalescing does not change the authored analysis');
  for (const [i, frame] of plan.frames.entries()) {
    for (const [relationIndex, kind] of ['node-plaque', 'binding-domain'].entries()) {
      const items = frame.items.filter(item => item.kind === kind);
      assert.equal(items.length, 1, `${kind} paints once at stage ${i}`);
      const item = items[0];
      assert.equal(item.coalescedRefs?.length ?? 0, i, 'future references never leak into earlier frames');
      for (let previous = 0; previous <= i; previous++) {
        assert(planItemOwnsRelationMoment(item, previous, relationIndex));
      }
      assert.equal(isPlanItemRevealed(item, i, new Set()), i > 0, 'a carried mark stays visible before its restatement');
      assert(isPlanItemRevealed(item, i, new Set([relationIndex]), relationIndex));
    }
  }
});

test('persistent claim identity preserves changed participants, values, lineage and prior-state evidence', () => {
  const relation = { relation: 'Theme-role assignment', anchors: { predicate: 'v', argument: 'dp' }, values: { thetaRole: 'Theme' } };
  const forest = [node('vp', 'VP', [leaf('v', 'V', 'give'), leaf('dp', 'DP', 'book'), leaf('other', 'DP', 'Mia')])];
  const cases = [
    { relation: { ...relation, anchors: { predicate: 'v', argument: 'other' } }, forest },
    { relation: { ...relation, values: { thetaRole: 'Goal' } }, forest },
    { relation, forest: [node('vp', 'VP', [leaf('v', 'V', 'give'), leaf('dp', 'DP', 'book', { lineageId: 'new-object' }), leaf('other', 'DP', 'Mia')])] },
    { relation: { ...relation, priorAnchors: { argument: 'dp' } }, forest }
  ];
  for (const changed of cases) {
    const plan = compileRelationRenderPlan([stage([relation], forest), stage([changed.relation], changed.forest)]);
    const items = plan.frames[1].items.filter(item => item.kind === 'node-plaque');
    assert.equal(items.length, 2, 'a changed claim must not coalesce with its predecessor');
  }
  const historical = { ...relation, priorAnchors: { argument: 'dp' } };
  const plan = compileRelationRenderPlan([stage([], forest), stage([historical], forest), stage([historical], forest)]);
  assert.equal(plan.frames[2].items.filter(item => item.kind === 'node-plaque').length, 2,
    'the same prior ID at different moments denotes different preceding states');
});

test('coalescing does not hide a fresh restatement when an earlier instance is superseded', () => {
  const relation = { relation: 'Theme-role assignment', anchors: { predicate: 'v', argument: 'dp' }, values: { thetaRole: 'Theme' } };
  const forest = [node('vp', 'VP', [leaf('v', 'V', 'give'), leaf('dp', 'DP', 'book')])];
  const replacement = { ...relation, values: { thetaRole: 'Goal' }, priorAnchors: relation.anchors };
  const plan = compileRelationRenderPlan([stage([relation], forest), stage([replacement, relation], forest)]);
  const themeItems = plan.frames[1].items.filter(item => item.kind === 'node-plaque'
    && item.relationRef.values?.thetaRole === 'Theme');
  for (const [played, expected] of [[[], 1], [[0], 0], [[0, 1], 1]]) {
    assert.equal(themeItems.filter(item => isPlanItemRevealed(item, 1, new Set(played))).length, expected);
  }
});

test('committed question fixture compiles both authored movements without diagnostics', () => {
  const fixture = JSON.parse(fs.readFileSync(
    new URL('../fixtures/normalized/what-did-mia-see.xbar.json', import.meta.url),
    'utf8'
  ));
  const plan = compileRelationRenderPlan(fixture.analyses[0].derivationStages);
  const finalFrame = plan.frames.at(-1);

  assert.equal(plan.diagnostics.length, 0);
  assert.equal(finalFrame.items.filter((item) => item.kind === 'trajectory').length, 2);
  assert.deepEqual(
    finalFrame.items.map((item) => item.relationRef.relation).sort(),
    ['auxiliary-head-movement', 'wh-movement']
  );
});

const whTree = node('cp', 'CP', [
  node('dp_high', 'DP', [leaf('d_high', 'D', 'What')]),
  node('tp', 'TP', [
    node('dp_low', 'DP', [leaf('d_low', 'D', 't₁', { silent: true })], { silent: true }),
    node('vp', 'VP', [leaf('v', 'V', 'see')])
  ])
]);

test('registered phrasal movement compiles with witness endpoints and authored payload preserved', () => {
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'AbarMove',
      anchors: { lowerCopy: 'dp_low', traceWitness: 'd_low', pronouncedCopy: 'dp_high' },
      values: { note: 'authored literal' },
    }], [whTree])
  ]);

  assert.equal(plan.registryVersion, '16');
  assert.equal(plan.frames.length, 1);
  const [item] = plan.frames[0].items;
  assert.equal(item.kind, 'trajectory');
  assert.equal(item.trajectoryKind, 'phrasal');
  assert.equal(item.sourceNodeId, 'dp_low');
  assert.equal(item.targetNodeId, 'dp_high');
  assert.equal(item.witnessNodeId, 'd_low');
  // Authored data survives verbatim on the relation reference.
  assert.deepEqual(item.relationRef.values, { note: 'authored literal' });
  assert.deepEqual(item.relationRef.anchors, {
    lowerCopy: 'dp_low', traceWitness: 'd_low', pronouncedCopy: 'dp_high'
  });
  assert.deepEqual(plan.unregistered, []);
  assert.equal(item.tier2FacetId, undefined, 'registered Orchard relations stay entirely Tier 1');
});

const tier2MovementTree = node('tier2_cp', 'CP', [
  node('tier2_landing', 'DP', [leaf('tier2_landing_d', 'D', 'What')], { lineageId: 'tier2_chain' }),
  node('tier2_source', 'DP', [
    leaf('tier2_witness', 'D', 't', { silent: true, lineageId: 'tier2_chain' })
  ], { silent: true, lineageId: 'tier2_chain' })
]);

test('Task 8 lowers a complete unknown movement to Tier 2 and never also draws fallback', () => {
  const relation = {
    relation: 'UnknownMovementShape',
    anchors: {
      source: 'tier2_source',
      'trace witness': 'tier2_witness',
      landing: 'tier2_landing'
    }
  };
  const dispatch = dispatchRelationClaims({
    relation,
    stageIndex: 0,
    relationIndex: 0,
    currentForest: [tier2MovementTree]
  });
  assert.deepEqual(dispatch.claims.map(({ tier }) => tier), [2]);

  const plan = compileRelationRenderPlan([stage([relation], [tier2MovementTree])]);
  const [trajectory] = plan.frames[0].items.filter((item) => item.kind === 'trajectory');
  assert.ok(trajectory);
  assert.equal(trajectory.tier2FacetId, 'movement.path');
  assert.deepEqual(
    trajectory.tier2OutputIdentities,
    dispatch.facets[0].outputIdentities.map(({ key }) => key),
    'production consumes the identities attached by dispatch'
  );
  assert.equal(plan.frames[0].items.some((item) => item.kind === 'fallback'), false);
});

test('Task 8 coalesces identical Tier-2 outputs but keeps every authored relation reference', () => {
  const anchors = {
    source: 'tier2_source',
    'trace witness': 'tier2_witness',
    landing: 'tier2_landing'
  };
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'UnknownMovementOne', anchors },
      { relation: 'UnknownMovementTwo', anchors }
    ], [tier2MovementTree])
  ]);
  const trajectories = plan.frames[0].items.filter((item) => item.kind === 'trajectory');
  assert.equal(trajectories.length, 1);
  assert.equal(trajectories[0].coalescedRefs?.length, 1);
  assert.equal(planItemOwnsRelationMoment(trajectories[0], 0, 0), true);
  assert.equal(planItemOwnsRelationMoment(trajectories[0], 0, 1), true);
});

test('Task 8 renders a complete Tier-2 claim and preserves the residual participant context', () => {
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'UnknownMovementWithResidual',
      anchors: {
        source: 'tier2_source',
        'trace witness': 'tier2_witness',
        landing: 'tier2_landing',
        mystery: 'tier2_landing_d'
      }
    }], [tier2MovementTree])
  ]);
  const [trajectory] = plan.frames[0].items.filter((item) => item.kind === 'trajectory');
  const [fallback] = plan.frames[0].items.filter((item) => item.kind === 'fallback');

  assert.equal(trajectory?.claimTier, 2);
  assert.equal(fallback?.claimTier, 3);
  assert.deepEqual(fallback?.drawing.marks.map(({ witness }) => witness),
    ['tier2_source', 'tier2_witness', 'tier2_landing', 'tier2_landing_d']);
  assert.deepEqual(fallback?.relationRef.anchors, { mystery: 'tier2_landing_d' });
});

test('Task 8 keeps Tier-2 outputs separate when authored values differ', () => {
  const anchors = {
    source: 'tier2_source',
    'trace witness': 'tier2_witness',
    landing: 'tier2_landing'
  };
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'UnknownMovementOne', anchors },
      { relation: 'UnknownMovementTwo', anchors, values: { outcome: 'blocked' } }
    ], [tier2MovementTree])
  ]);
  assert.equal(
    plan.frames[0].items.filter((item) => item.kind === 'trajectory').length,
    2
  );
});

test('OperatorVariableBinding compiles semantic scope, binding, and index evidence without movement', () => {
  const semanticTree = node('scope_root', 'TP', [
    node('operator_qp', 'QP', [leaf('operator_q', 'Q', 'every')]),
    node('scope_body', 'TP', [
      node('variable_dp', 'DP', [leaf('variable_trace', 't', undefined, { silent: true })], { silent: true }),
      node('predicate_vp', 'VP', [leaf('predicate_v', 'V', 'left')])
    ])
  ]);
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'OperatorVariableBinding',
      anchors: {
        operator: 'operator_qp',
        variable: 'variable_dp',
        traceWitness: 'variable_trace',
        scopeDomain: 'scope_body'
      }
    }], [semanticTree])
  ]);

  assert.deepEqual(plan.diagnostics, []);
  const [item] = plan.frames[0].items;
  assert.equal(item.kind, 'operator-variable-binding');
  assert.equal(item.familyId, 'scope.operator-variable');
  assert.equal(item.operatorNodeId, 'operator_qp');
  assert.equal(item.variableNodeId, 'variable_dp');
  assert.equal(item.traceWitnessNodeId, 'variable_trace');
  assert.equal(item.scopeDomainNodeId, 'scope_body');
  assert.ok(item.scopeMemberNodeIds.includes('variable_trace'));
  assert.equal(item.index, 'i');

  const positions = new Map([
    ['operator_qp', { x: 0, y: 0 }],
    ['variable_dp', { x: 100, y: 100 }],
    ['variable_trace', { x: 100, y: 120 }],
    ['scope_body', { x: 50, y: 50 }]
  ]);
  const bound = bindRelationPlanFrame(plan, 0, (nodeId) => positions.get(nodeId) || null);
  assert.deepEqual(bound.failed, []);
  assert.deepEqual(bound.primitives.map((primitive) => primitive.type), ['operator-variable-binding']);
});

test('sluicing composes movement, an ordinary feature plaque, and ellipsis ghosting', () => {
  const sluicingTree = node('coord_sluice_test', 'CoordP', [
    node('tp_ante_sluice_test', 'TP', [
      leaf('v_ante_sluice_test', 'V', 'left')
    ]),
    node('cp_site_sluice_test', 'CP', [
      node('adv_high_sluice_test', 'AdvP', [
        leaf('adv_high_leaf_sluice_test', 'Adv', 'why')
      ]),
      node('tp_site_sluice_test', 'TP', [
        node('adv_low_sluice_test', 'AdvP', [
          leaf('adv_low_leaf_sluice_test', 'Adv', 'why', { silent: true })
        ], { silent: true })
      ], { silent: true })
    ])
  ]);
  const plan = compileRelationRenderPlan([
    stage([
      {
        relation: 'AbarMove',
        anchors: {
          lowerCopy: 'adv_low_sluice_test',
          traceWitness: 'adv_low_leaf_sluice_test',
          pronouncedCopy: 'adv_high_sluice_test'
        }
      },
      {
        relation: 'FeatureBundle',
        anchors: { licensor: 'cp_site_sluice_test' },
        values: { feature: '[E]' }
      },
      { relation: 'Ellipsis', anchors: { domain: 'tp_site_sluice_test' } }
    ], [sluicingTree])
  ]);

  assert.deepEqual(plan.unregistered, []);
  assert.deepEqual(plan.diagnostics, []);
  assert.equal(plan.frames[0].items.length, 3);
  const trajectory = plan.frames[0].items.find((item) => item.kind === 'trajectory');
  const licensingPlaque = plan.frames[0].items.find(
    (item) => item.kind === 'node-plaque'
      && item.plaqueStyle === 'feature'
  );
  const ghosting = plan.frames[0].items.find(
    (item) => item.kind === 'ellipsis-site'
      && item.relationRef.relation === 'Ellipsis'
  );
  assert.deepEqual({
    relation: trajectory?.relationRef.relation,
    familyId: trajectory?.familyId,
    source: trajectory?.sourceNodeId,
    target: trajectory?.targetNodeId,
    witness: trajectory?.witnessNodeId
  }, {
    relation: 'AbarMove',
    familyId: 'trajectory.phrasal',
    source: 'adv_low_sluice_test',
    target: 'adv_high_sluice_test',
    witness: 'adv_low_leaf_sluice_test'
  });
  assert.deepEqual(licensingPlaque?.rows, [{ label: 'feature', value: '[E]' }]);
  assert.equal(ghosting?.relationRef.relation, 'Ellipsis');
  assert.equal(plan.frames[0].items.filter((item) => item.kind === 'ellipsis-site').length, 1);
  assert.equal(plan.frames[0].items.some((item) => item.kind === 'strike-ghost'), false);
  assert.equal(plan.frames[0].items.some((item) => item.kind === 'undirected-link'), false);

  const bundled = compileRelationRenderPlan([
    stage([{ relation: 'Sluicing', anchors: { site: 'tp_site_sluice_test' } }], [sluicingTree])
  ]);
  assert.deepEqual(bundled.unregistered, [{ relation: 'Sluicing', count: 1 }]);
  assert.equal(bundled.frames[0].items.some((item) => item.kind === 'ellipsis-site'), false,
    'generic site plus silence must not assert an ellipsis operation');
  assert.ok(bundled.frames[0].items.some((item) => item.kind === 'fallback'));
  assert.equal(bundled.frames[0].items.some((item) => item.kind === 'trajectory'), false);
});

test('IllicitAnalysis renders one anchored verdict with its optional authored label', () => {
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'IllicitAnalysis',
      anchors: { analysis: 'cp' },
      values: { judgment: '*', label: 'extraction' }
    }], [whTree])
  ]);

  assert.deepEqual(plan.unregistered, []);
  assert.deepEqual(plan.diagnostics, []);
  const [item] = plan.frames[0].items;
  assert.equal(item.familyId, 'analysis.illicit');
  assert.equal(item.kind, 'analysis-verdict');
  assert.equal(item.analysisNodeId, 'cp');
  assert.equal(item.judgment, '*');
  assert.equal(item.label, 'extraction');
  assert.equal(item.claimTier, 1);
  assert.deepEqual(item.relationRef, {
    stageIndex: 0,
    relationIndex: 0,
    relation: 'IllicitAnalysis',
    anchors: { analysis: 'cp' },
    values: { judgment: '*', label: 'extraction' }
  });

  const bound = bindRelationPlanFrame(plan, 0, (nodeId) => (
    nodeId === 'cp' ? { x: 120, y: 40 } : null
  ));
  assert.deepEqual(bound.failed, []);
  assert.equal(bound.primitives.length, 1);
  assert.deepEqual(
    (({ type, analysisNodeId, x, y, judgment, label }) => (
      { type, analysisNodeId, x, y, judgment, label }
    ))(bound.primitives[0]),
    {
      type: 'analysis-verdict',
      analysisNodeId: 'cp',
      x: 120,
      y: 40,
      judgment: '*',
      label: 'extraction'
    }
  );
});

test('a registered blocked extraction may carry an independent Tier-2 verdict in one envelope', () => {
  const source = node('mixed_source', 'DP', [leaf('mixed_gap', 'D', 'gap')]);
  const adjunct = node('mixed_adjunct', 'CP', [source]);
  const target = node('mixed_target', 'DP', [leaf('mixed_word', 'D', 'Who')]);
  const analysis = node('mixed_analysis', 'CP', [target, adjunct]);
  const relation = {
    relation: 'BlockedExtraction',
    anchors: {
      source: 'mixed_source',
      target: 'mixed_target',
      adjunctDomain: 'mixed_adjunct',
      analysis: 'mixed_analysis'
    },
    values: { outcome: 'blocked', judgment: '*', label: 'extraction' }
  };
  const dispatch = dispatchRelationClaims({
    relation,
    stageIndex: 0,
    relationIndex: 0,
    currentForest: [analysis]
  });
  assert.deepEqual(dispatch.claims.map(({ tier }) => tier), [1, 2]);

  const plan = compileRelationRenderPlan([stage([relation], [analysis])]);
  assert.deepEqual(
    plan.frames[0].items.map(({ kind, claimTier }) => ({ kind, claimTier })),
    [
      { kind: 'domain-mark', claimTier: 1 },
      { kind: 'directed-path', claimTier: 1 },
      { kind: 'analysis-verdict', claimTier: 2 }
    ]
  );
  const verdict = plan.frames[0].items.find((item) => item.kind === 'analysis-verdict');
  assert.deepEqual({
    analysisNodeId: verdict?.analysisNodeId,
    judgment: verdict?.judgment,
    label: verdict?.label
  }, {
    analysisNodeId: 'mixed_analysis',
    judgment: '*',
    label: 'extraction'
  });
});

test('a malformed named primary stays Tier 3 while its disjoint verdict remains Tier 2', () => {
  const adjunct = node('mixed_bad_adjunct', 'CP', []);
  const target = node('mixed_bad_target', 'DP', []);
  const analysis = node('mixed_bad_analysis', 'CP', [target, adjunct]);
  const relation = {
    relation: 'BlockedExtraction',
    anchors: {
      target: 'mixed_bad_target',
      adjunctDomain: 'mixed_bad_adjunct',
      analysis: 'mixed_bad_analysis'
    },
    values: { outcome: 'blocked', judgment: '*', label: 'extraction' }
  };
  const plan = compileRelationRenderPlan([stage([relation], [analysis])]);
  const fallback = plan.frames[0].items.find((item) => item.kind === 'fallback');
  const verdict = plan.frames[0].items.find((item) => item.kind === 'analysis-verdict');

  assert.ok(fallback, 'the malformed registered primary must remain Tier 3');
  assert.equal(fallback.claimTier, 3);
  assert.deepEqual(
    fallback.drawing.marks.map(({ witness }) => witness),
    ['mixed_bad_target', 'mixed_bad_adjunct', 'mixed_bad_analysis'],
    'the fallback retains current context without taking ownership of the verdict'
  );
  assert.deepEqual(fallback.relationRef.anchors, { target: 'mixed_bad_target', adjunctDomain: 'mixed_bad_adjunct' });
  assert.equal(verdict?.claimTier, 2);
  assert.equal(verdict?.analysisNodeId, 'mixed_bad_analysis');
});

test('Tier-1 and Tier-2 routes to the same verdict coalesce with Tier 1 owning the pixels', () => {
  const relations = [
    {
      relation: 'IllicitAnalysis',
      anchors: { analysis: 'cp' },
      values: { judgment: '*', label: 'extraction' }
    },
    {
      relation: 'UnknownVerdict',
      anchors: { analysis: 'cp' },
      values: { verdict: '*', label: 'extraction' }
    }
  ];
  const plan = compileRelationRenderPlan([stage(relations, [whTree])]);
  const verdicts = plan.frames[0].items.filter((item) => item.kind === 'analysis-verdict');

  assert.equal(verdicts.length, 1);
  assert.equal(verdicts[0].claimTier, 1);
  assert.equal(verdicts[0].coalescedRefs?.length, 1);
  assert.equal(planItemOwnsRelationMoment(verdicts[0], 0, 0), true);
  assert.equal(planItemOwnsRelationMoment(verdicts[0], 0, 1), true);
});

test('Tier precedence survives an unrelated plan item interposed between equivalent verdicts', () => {
  const relations = [
    {
      relation: 'UnknownVerdict',
      anchors: { analysis: 'cp' },
      values: { verdict: '*', label: 'extraction' }
    },
    {
      relation: 'UnknownLocalJudgment',
      anchors: { candidate: 'dp_high' },
      values: { outcome: 'blocked' }
    },
    {
      relation: 'IllicitAnalysis',
      anchors: { analysis: 'cp' },
      values: { judgment: '*', label: 'extraction' }
    }
  ];
  const plan = compileRelationRenderPlan([stage(relations, [whTree])]);
  const verdicts = plan.frames[0].items.filter((item) => item.kind === 'analysis-verdict');
  const localJudgments = plan.frames[0].items.filter((item) => (
    item.kind === 'node-badges' && item.badgeStyle === 'local-judgment'
  ));

  assert.equal(verdicts.length, 1);
  assert.equal(verdicts[0].claimTier, 1);
  assert.equal(verdicts[0].relationRef.relationIndex, 2);
  assert.equal(verdicts[0].coalescedRefs?.length, 1);
  assert.equal(planItemOwnsRelationMoment(verdicts[0], 0, 0), true);
  assert.equal(planItemOwnsRelationMoment(verdicts[0], 0, 2), true);
  assert.equal(localJudgments.length, 1);
});

test('multiple verdicts retain distinct analysis anchors through geometry binding', () => {
  const nested = node('outer_analysis', 'CP', [node('inner_analysis', 'TP', [])]);
  const plan = compileRelationRenderPlan([
    stage([
      {
        relation: 'IllicitAnalysis',
        anchors: { analysis: 'outer_analysis' },
        values: { judgment: '*', label: 'derivation' }
      },
      {
        relation: 'IllicitAnalysis',
        anchors: { analysis: 'inner_analysis' },
        values: { judgment: '!', label: 'agreement' }
      }
    ], [nested])
  ]);
  const positions = new Map([
    ['outer_analysis', { x: 50, y: 20 }],
    ['inner_analysis', { x: 80, y: 90 }]
  ]);
  const bound = bindRelationPlanFrame(plan, 0, (nodeId) => positions.get(nodeId) ?? null);

  assert.deepEqual(bound.failed, []);
  assert.deepEqual(
    bound.primitives
      .filter((primitive) => primitive.type === 'analysis-verdict')
      .map(({ analysisNodeId, x, y, judgment, label }) => ({
        analysisNodeId,
        x,
        y,
        judgment,
        label
      })),
    [
      {
        analysisNodeId: 'outer_analysis',
        x: 50,
        y: 20,
        judgment: '*',
        label: 'derivation'
      },
      {
        analysisNodeId: 'inner_analysis',
        x: 80,
        y: 90,
        judgment: '!',
        label: 'agreement'
      }
    ]
  );
});

test('coalesced geometry remains focusable from every authored relation moment', () => {
  const relation = {
    relation: 'AbarMove',
    anchors: { lowerCopy: 'dp_low', traceWitness: 'd_low', pronouncedCopy: 'dp_high' }
  };
  const plan = compileRelationRenderPlan([
    stage([relation, { ...relation }], [whTree])
  ]);

  assert.equal(plan.frames[0].items.length, 1, 'identical geometry paints once');
  const [item] = plan.frames[0].items;
  assert.equal(item.coalescedRefs?.length, 1, 'the second authored reference survives');
  assert.equal(planItemOwnsRelationMoment(item, 0, 0), true);
  assert.equal(planItemOwnsRelationMoment(item, 0, 1), true);
  assert.equal(planItemOwnsRelationMoment(item, 0, 2), false);
});

test('a phrasal trajectory without a witness fails closed with a diagnostic, never a substitute', () => {
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'AbarMove',
      anchors: { lowerCopy: 'dp_low', pronouncedCopy: 'dp_high' }
    }], [whTree])
  ]);
  assert.equal(plan.frames[0].items.some((item) => item.kind === 'trajectory'), false);
  assert.ok(plan.diagnostics.some((d) => d.kind === 'signature-incomplete'));
});

test('a witness outside the source occurrence fails closed', () => {
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'AbarMove',
      anchors: { lowerCopy: 'dp_low', traceWitness: 'd_high', pronouncedCopy: 'dp_high' }
    }], [whTree])
  ]);
  assert.deepEqual(plan.frames[0].items.map((item) => item.kind), ['fallback']);
  assert.ok(plan.diagnostics.some((d) => d.kind === 'witness-outside-source'));
});

test('an unregistered name never becomes a movement drawing, even when movement-flavored', () => {
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'FancyFocusMovementParty',
      anchors: { one: 'dp_low', two: 'dp_high' }
    }], [whTree])
  ]);
  const [item] = plan.frames[0].items;
  assert.equal(item.kind, 'fallback');
  // Two scalars license exactly one undirected connector — row 2 — with the
  // relation name preserved verbatim in provenance and never in geometry.
  assert.equal(item.drawing.row, 2);
  assert.equal(item.drawing.link.directed, false);
  assert.equal(item.drawing.link.arrowheads, 0);
  assert.equal(item.relationRef.relation, 'FancyFocusMovementParty');
  assert.deepEqual(plan.unregistered, [{ relation: 'FancyFocusMovementParty', count: 1 }]);
});

test('fallback anchors that do not resolve fail closed and demote the topology row', () => {
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'OpenPairing',
      anchors: { one: 'dp_low', two: 'node_that_never_existed' }
    }], [whTree])
  ]);
  const [item] = plan.frames[0].items;
  assert.equal(item.kind, 'fallback');
  // With one endpoint failed closed, only one witness remains: row 1, no
  // connector is invented from a substitute endpoint.
  assert.equal(item.drawing.row, 1);
  assert.equal(item.drawing.link, null);
  assert.ok(plan.diagnostics.some((d) => d.kind === 'anchor-unresolved'));
});

test('an unregistered fallback reserves space only in its authoring stage; the claim stays in the record', () => {
  const stages = [
    stage([{ relation: 'OpenMark', anchors: { spot: 'dp_low' } }], [whTree]),
    stage([], [whTree])
  ];
  const plan = compileRelationRenderPlan(stages);
  assert.equal(plan.frames[0].items.length, 1);
  assert.equal(plan.frames[0].items[0].persistence, 'relation-only');
  assert.equal(plan.frames[1].items.length, 0,
    'neutral marks do not reserve space in later stages');
  assert.equal(stages[0].relations.length, 1, 'the authored relation is untouched');
});

test('registered movement persists from its authored frame onward and never leaks backward', () => {
  const plan = compileRelationRenderPlan([
    stage([], [whTree]),
    stage([{
      relation: 'AbarMove',
      anchors: { lowerCopy: 'dp_low', traceWitness: 'd_low', pronouncedCopy: 'dp_high' }
    }], [whTree]),
    stage([], [whTree])
  ]);
  assert.equal(plan.frames[0].items.length, 0, 'nothing leaks backward');
  assert.equal(plan.frames[1].items.length, 1, 'appears in its authored frame');
  assert.equal(plan.frames[2].items.length, 1, 'movement persists');
});

test('priorAnchors resolve only against the immediately preceding stage and add the backward cue', () => {
  const before = node('tp_before', 'TP', [leaf('cl_le', 'Cl', 'le')]);
  const after = node('tp_after', 'TP', [leaf('cl_se', 'Cl', 'se'), leaf('cl_lo', 'Cl', 'lo')]);
  const plan = compileRelationRenderPlan([
    stage([], [before]),
    stage([{
      relation: 'SpuriousSeExponence',
      anchors: { exponent: 'cl_se', conditioningClitic: 'cl_lo' },
      priorAnchors: { replacedDative: 'cl_le' }
    }], [after])
  ]);
  const [item] = plan.frames[1].items;
  assert.equal(item.kind, 'fallback');
  assert.equal(item.backward, true);
  assert.deepEqual(item.priorWitnessNodeIds, ['cl_le']);
  // The two current scalars still license their connector; priorAnchors veto nothing.
  assert.equal(item.drawing.row, 2);

  // priorAnchors at stage 0, or naming a node absent from the previous stage,
  // fail closed with diagnostics and add no cue.
  const badPlan = compileRelationRenderPlan([
    stage([{
      relation: 'SpuriousSeExponence',
      anchors: { exponent: 'cl_le' },
      priorAnchors: { ghost: 'nowhere' }
    }], [before])
  ]);
  assert.ok(badPlan.diagnostics.some((d) => d.kind === 'prior-anchor-without-prior-stage'));
  assert.equal(badPlan.frames[0].items[0].backward, false);
});

test('multiple same-stage instances all compile — no single() sampling', () => {
  const tree = node('tp_multi', 'TP', [
    node('dp_a', 'DP', [leaf('d_a', 'D', 'a')]),
    node('dp_b', 'DP', [leaf('d_b', 'D', 'b')]),
    node('dp_c', 'DP', [leaf('d_c', 'D', 'c')]),
    node('dp_d', 'DP', [leaf('d_d', 'D', 'd')])
  ]);
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'Coreference', anchors: { antecedent: 'dp_a', pronoun: 'dp_b' } },
      { relation: 'Coreference', anchors: { antecedent: 'dp_c', pronoun: 'dp_d' } }
    ], [tree])
  ]);
  const coindexItems = plan.frames[0].items.filter((item) => item.kind === 'coindex');
  assert.equal(coindexItems.length, 2);
  // Indices accumulate deterministically, never last-writer-wins.
  assert.notEqual(coindexItems[0].index, coindexItems[1].index);
});

test('a stage-only claim changed in a later stage is a legitimate change, not a conflict', () => {
  const registry = createRelationRegistry({
    registryId: 'test.transient',
    version: 't1',
    entries: [{
      id: 'transient.trajectory',
      version: '1',
      identities: [{ name: 'TransientMove', normalization: 'case-whitespace' }],
      signature: { anchors: { allowAdditional: true } },
      marks: [{ id: 'm', licenses: [{ field: 'relation' }] }]
    }]
  });
  const families = {
    'transient.trajectory': { family: 'trajectory', trajectoryKind: 'head', persistence: 'stage-only' }
  };
  const headTree = node('xp', 'XP', [
    leaf('h_low', 'X', 'low'),
    leaf('h_high', 'Y', 'high')
  ]);
  const planChanged = compileRelationRenderPlan([
    stage([{ relation: 'TransientMove', anchors: { source: 'h_low', target: 'h_high' } }], [headTree]),
    stage([{ relation: 'TransientMove', anchors: { source: 'h_low', target: 'h_high' } }], [headTree])
  ], { registry, families });
  // Same channel, but the marks are never co-visible: both frames keep theirs
  // and no conflict diagnostic is emitted.
  assert.equal(planChanged.frames[0].items.length, 1);
  assert.equal(planChanged.frames[1].items.length, 1);
  assert.equal(planChanged.diagnostics.filter((d) => d.kind === 'conflicting-claim').length, 0);
});

test('coincident but distinct authored claims both survive, routed apart instead of suppressed', () => {
  const registry = createRelationRegistry({
    registryId: 'test.conflict',
    version: 't1',
    entries: [{
      id: 'conflict.head',
      version: '1',
      identities: [{ name: 'HeadishMove', normalization: 'case-whitespace' }],
      signature: { anchors: { allowAdditional: true } },
      marks: [{ id: 'm', licenses: [{ field: 'relation' }] }]
    }, {
      id: 'conflict.lowering',
      version: '1',
      identities: [{ name: 'LoweringishMove', normalization: 'case-whitespace' }],
      signature: { anchors: { allowAdditional: true } },
      marks: [{ id: 'm', licenses: [{ field: 'relation' }] }]
    }]
  });
  const families = {
    'conflict.head': { family: 'trajectory', trajectoryKind: 'head', persistence: 'from-stage-onward' },
    'conflict.lowering': { family: 'trajectory', trajectoryKind: 'lowering', persistence: 'from-stage-onward' }
  };
  const headTree = node('xp2', 'XP', [
    leaf('e_low', 'X', 'low'),
    leaf('e_high', 'Y', 'high')
  ]);
  const plan = compileRelationRenderPlan([
    stage([{ relation: 'HeadishMove', anchors: { source: 'e_low', target: 'e_high' } }], [headTree]),
    stage([{ relation: 'LoweringishMove', anchors: { source: 'e_low', target: 'e_high' } }], [headTree])
  ], { registry, families });
  // Frame 0: only the first authored claim exists yet.
  assert.equal(plan.frames[0].items.length, 1);
  // Frame 1: both authored claims are co-visible on the same route. Babel
  // never decides two authored linguistic claims are incompatible merely
  // because they share a visual channel — both survive, and the binder
  // routes them apart with deterministic ordinals.
  assert.equal(plan.frames[1].items.length, 2);
  assert.deepEqual(
    plan.frames[1].items.map((item) => item.trajectoryKind).sort(),
    ['head', 'lowering']
  );
  assert.equal(plan.diagnostics.length, 0);
  const positions = new Map([
    ['e_low', { x: 100, y: 200 }],
    ['e_high', { x: 400, y: 100 }],
    ['xp2', { x: 250, y: 0 }]
  ]);
  const bound = bindRelationPlanFrame(plan, 1, (nodeId) => positions.get(nodeId) || null);
  const paths = bound.primitives.filter((p) => p.type === 'trajectory-path');
  assert.equal(paths.length, 2, 'both coincident trajectories draw');
  assert.notEqual(paths[0].ordinal, paths[1].ordinal, 'coincident routes take distinct ordinals');
});

test('identical duplicate claims deduplicate to the earlier mark', () => {
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'AbarMove', anchors: { lowerCopy: 'dp_low', traceWitness: 'd_low', pronouncedCopy: 'dp_high' } },
      { relation: 'AbarMove', anchors: { lowerCopy: 'dp_low', traceWitness: 'd_low', pronouncedCopy: 'dp_high' } }
    ], [whTree])
  ]);
  assert.equal(plan.frames[0].items.filter((item) => item.kind === 'trajectory').length, 1);
  assert.equal(plan.diagnostics.filter((d) => d.kind === 'conflicting-claim').length, 0);
});

test('large anchor arrays compile additively and inherit the parent persistence', () => {
  const members = Array.from({ length: 6 }, (_unused, index) => `m_${index}`);
  const bigTree = node('root_big', 'TP', members.map((id) => node(id, 'DP', [leaf(`${id}_d`, 'D', 'x')])));
  const plan = compileRelationRenderPlan([
    stage([{ relation: 'OpenChorus', anchors: { occurrences: members } }], [bigTree]),
    stage([], [bigTree])
  ]);
  const identity = plan.frames[0].items.find((item) => item.tier2FacetId === 'identity.occurrences');
  const anchorSet = plan.frames[0].items.find((item) => item.kind === 'anchor-set');
  assert.ok(identity && anchorSet);
  assert.equal(plan.frames[0].items.some((item) => item.kind === 'fallback'), false,
    'a complete Tier-2 claim excludes Tier 3');
  assert.ok(members.length >= LARGE_ANCHOR_ARRAY_THRESHOLD);
  // Every participant, in authored order, no truncation.
  assert.deepEqual(
    anchorSet.set.roles[0].anchors.map((anchor) => anchor.nodeId),
    members
  );
  // Organization inherits the Tier-2 parent's witness-bounded persistence.
  assert.equal(anchorSet.persistence, 'replace-previous-instance');
  assert.equal(plan.frames[1].items.length, 2,
    'both the identity mark and its organizational rail persist while witnesses resolve');
});

test('a registered parent with a large array keeps its semantic marks and its persistence on the rail', () => {
  const members = Array.from({ length: 5 }, (_unused, index) => `w_${index}`);
  const bigTree = node('root_reg', 'TP', members.map((id) => node(id, 'DP', [leaf(`${id}_d`, 'D', 'x')])));
  const plan = compileRelationRenderPlan([
    stage([{ relation: 'Coreference', anchors: { group: members } }], [bigTree]),
    stage([], [bigTree])
  ]);
  const coindex = plan.frames[0].items.find((item) => item.kind === 'coindex');
  const anchorSet = plan.frames[0].items.find((item) => item.kind === 'anchor-set');
  assert.ok(coindex, 'the registered semantic mark still renders');
  assert.ok(anchorSet, 'the large-array organization is additive');
  assert.equal(anchorSet.badgeSize, 'standard');
  assert.equal(anchorSet.persistence, 'from-stage-onward');
  assert.ok(plan.frames[1].items.some((item) => item.kind === 'anchor-set'));
});

test('CyclicLinearization uses compact production anchor badges', () => {
  const members = Array.from({ length: 5 }, (_unused, index) => `cyclic_${index}`);
  const cyclicTree = node(
    'root_cyclic_badges',
    'TP',
    members.map((id) => node(id, 'DP', [leaf(`${id}_d`, 'D', 'x')]))
  );
  const plan = compileRelationRenderPlan([
    stage([], [cyclicTree]),
    stage([{
      relation: 'CyclicLinearization',
      anchors: { order: members, edgePosition: members[0] },
      priorAnchors: { order: members },
      values: { outcome: 'licensed' }
    }], [cyclicTree])
  ]);
  const anchorSet = plan.frames[1].items.find((item) => item.kind === 'anchor-set');
  assert.ok(anchorSet);
  assert.equal(anchorSet.badgeSize, 'compact');

  const bound = bindRelationPlanFrame(
    plan,
    1,
    (nodeId) => members.includes(nodeId)
      ? { x: (members.indexOf(nodeId) + 1) * 100, y: 50 }
      : null
  );
  const badges = bound.primitives.filter((primitive) => primitive.type === 'anchor-set-badge');
  assert.equal(badges.length, members.length);
  assert.ok(badges.every((badge) => badge.badgeSize === 'compact'));
});

test('DependentCase prepares one literal step and leaves absent-step layout unchanged', () => {
  const forest = [node('root', 'TP', [leaf('a', 'D', 'Mia'), leaf('b', 'D', 'Noa')])];
  // The step is an open literal shown as written; only multiplicity and blanks are rejected.
  for (const stepValue of [undefined, '1', ['1'], '2', ' 1 ', 'first', 'Step 1', '3']) {
    const relation = { relation: 'DependentCase', anchors: { searcher: 'a', licensee: 'b' },
      values: { probeLabel: 'UNM', goalLabel: 'ACC', ...(stepValue === undefined ? {} : { step: stepValue }) } };
    const original = structuredClone(relation);
    const plan = compileRelationRenderPlan([stage([relation], forest)]);
    assert.deepEqual(plan.diagnostics, []);
    const path = plan.frames[0].items.find((item) => item.pathStyle === 'dependent-case');
    assert.ok(path);
    assert.equal(path.dependentCaseStep, Array.isArray(stepValue) ? stepValue[0] : stepValue?.trim());
    assert.equal(path.label, 'UNM');
    assert.equal(path.secondaryLabel, 'ACC');
    assert.deepEqual(relation, original);
  }
  for (const stepValue of [[], ['1', '2'], ['1', '1'], '', ['']]) {
    const plan = compileRelationRenderPlan([stage([{ relation: 'DependentCase',
      anchors: { probe: 'a', goal: 'b' }, values: { step: stepValue } }], forest)]);
    assert.ok(plan.diagnostics.some((diagnostic) => diagnostic.kind === 'illegal-configuration'));
    assert.equal(plan.frames[0].items.some((item) => item.pathStyle === 'dependent-case'), false);
    assert.ok(plan.frames[0].items.some((item) => item.kind === 'fallback'));
  }
});

test('CyclicLinearization does not claim a comparison from ambiguous or unresolved prior content', () => {
  const forest = [node('root', 'TP', [leaf('a', 'D', 'Mia'), leaf('b', 'D', 'Noa')])];
  for (const priorAnchors of [undefined, { order: ['a', 'missing'] }, { order: ['a', 'b'], sequence: ['b', 'a'] }]) {
    const plan = compileRelationRenderPlan([stage([], forest), stage([{ relation: 'CyclicLinearization',
      anchors: { order: ['a', 'b'] }, priorAnchors }], forest)]);
    assert.ok(plan.diagnostics.some((diagnostic) => diagnostic.kind === 'illegal-configuration'));
    assert.equal(plan.frames[1].items.some((item) => item.plaqueStyle === 'linearization'), false);
    assert.ok(plan.frames[1].items.some((item) => item.kind === 'fallback'));
  }
});

test('CyclicLinearization owns its prior order without inheriting unrelated prior context', () => {
  const prior = [node('root', 'TP', [leaf('a', 'D', 'Mia'), leaf('b', 'D', 'Noa')])];
  const current = [...prior, leaf('current-only', 'D', 'context')];
  const relation = { relation: 'CyclicLinearization', anchors: { order: ['a', 'b'] },
    priorAnchors: { order: ['b', 'a'], unrelated: 'current-only' } };
  const original = structuredClone(relation);
  const plan = compileRelationRenderPlan([stage([], prior), stage([relation], current)]);
  const plaque = plan.frames[1].items.find((item) => item.plaqueStyle === 'linearization');
  assert.ok(plaque);
  assert.deepEqual(plaque.nativeContent.priorRows, ['Noa < Mia']);
  assert.deepEqual(plaque.nativeContent.currentRows, ['Mia < Noa']);
  assert.ok(plan.diagnostics.some((diagnostic) => diagnostic.kind === 'prior-anchor-unresolved'));
  assert.equal(plan.diagnostics.some((diagnostic) => diagnostic.kind === 'illegal-configuration'), false);
  assert.equal(plaque.backward, false, 'the incomplete whole prior block still proves no general continuity');
  assert.deepEqual(relation, original);
});

test('repeated large-array instances in one stage each keep their own ordered set', () => {
  const first = ['a1', 'a2', 'a3', 'a4', 'a5'];
  const second = ['b1', 'b2', 'b3', 'b4', 'b5'];
  const forest = [node('root_two', 'TP', [...first, ...second].map((id) => node(id, 'DP', [leaf(`${id}_d`, 'D', 'x')])))];
  const { sets } = compileLargeAnchorSets([
    stage([
      { relation: 'OpenChorus', anchors: { members: first } },
      { relation: 'OpenChorus', anchors: { members: second } }
    ], forest)
  ]);
  assert.equal(sets.length, 2);
  assert.deepEqual(sets.map((set) => set.instanceIndex), [0, 1]);
  assert.deepEqual(sets[0].roles[0].anchors.map((anchor) => anchor.nodeId), first);
  assert.deepEqual(sets[1].roles[0].anchors.map((anchor) => anchor.nodeId), second);
});

test('an unknown membership array remains neutral without inventing identity', () => {
  const members = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'];
  const forest = [node('root_unknown_large', 'TP', members.map((id) => node(id, 'DP', [leaf(`${id}_d`, 'D', id)])))];
  const plan = compileRelationRenderPlan([
    stage([{ relation: 'OpenSixWayRelation', anchors: { members } }], forest)
  ]);
  const bound = bindRelationPlanFrame(
    plan,
    0,
    (nodeId) => members.includes(nodeId)
      ? { x: (members.indexOf(nodeId) + 1) * 100, y: 50 }
      : null
  );
  assert.equal(bound.primitives.filter((p) => p.type === 'fallback-mark').length, 6);
  assert.equal(bound.primitives.filter((p) => p.type === 'anchor-set-badge').length, 0);
  assert.equal(bound.primitives.filter((p) => p.type === 'anchor-set-rail').length, 1, 'neutral topology may organize a large set without asserting identity');
});

test('unsupported native PF content remains neutral with an explicit diagnostic', () => {
  const forest = [node('root', 'TP', [leaf('a', 'T', 'did'), leaf('b', 'V', 'go'), leaf('c', 'D', 'she')])];
  for (const relation of [
    { relation: 'Fission', anchors: { outputs: ['a', 'b', 'c'] }, values: { inputFeatures: ['phi'], outputs: ['person', 'number'] } },
    { relation: 'Fission', anchors: { outputs: ['a', 'b'] }, values: { features: ['phi'] } },
    { relation: 'Impoverishment', anchors: { terminal: 'a' }, values: { featureHierarchy: ['a', 'b'], delinkAfter: 'missing' } },
    { relation: 'ManyToManyCorrespondence', anchors: { word: 'a' }, values: { sources: ['T', 'V'], exponents: ['did'] } }
  ]) {
    const original = structuredClone(relation);
    const plan = compileRelationRenderPlan([stage([relation], forest)]);
    assert.ok(plan.diagnostics.some((diagnostic) => diagnostic.kind === 'illegal-configuration'), relation.relation);
    assert.ok(plan.frames[0].items.some((item) => item.kind === 'fallback'), relation.relation);
    assert.equal(plan.frames[0].items.some((item) => item.kind === 'node-plaque' && item.nativeContent), false);
    assert.deepEqual(relation, original);
  }
});

test('PF realization keeps scalar prose literal and complete rewrite pairs explicit', () => {
  const forest = [leaf('a', 'T', 'did')];
  const relation = { relation: 'PFRealization', anchors: { target: 'a' }, values: {
    input: ' T[past] ', output: 'did', notation: 'supports tense, without a new syntactic head',
    qualifications: ['x_i', 'x_i']
  } };
  const plan = compileRelationRenderPlan([stage([relation], forest)]);
  const plate = plan.frames[0].items.find((item) => item.kind === 'node-plaque');
  assert.deepEqual(plate.rows, [
    { label: ' T[past] ', value: 'did' },
    { label: 'notation', value: 'supports tense, without a new syntactic head' },
    { label: 'qualifications', value: 'x_i' },
    { label: 'qualifications', value: 'x_i' }
  ]);
  assert.deepEqual(plate.realizationRowKinds, ['rewrite', 'literal', 'literal', 'literal']);
});

test('named theta uses the same exact ordered role pairing as recovered theta', () => {
  const forest = [node('root', 'VP', [leaf('v', 'V', 'gave'), leaf('a', 'D', 'she'), leaf('b', 'D', 'it')])];
  // Per-item literals pair with an anchor list through a same-name values entry.
  const relation = { relation: 'ThetaAssignment', anchors: { predicate: 'v', arguments: ['a', 'b'] }, values: { arguments: ['Theme', 'Theme'] } };
  const plan = compileRelationRenderPlan([stage([relation], forest)]);
  assert.deepEqual(plan.frames[0].items.find((item) => item.kind === 'node-plaque')?.thetaRoles,
    [{ nodeId: 'a', label: 'Theme', index: 'i' }, { nodeId: 'b', label: 'Theme', index: 'j' }]);
  // A differently named list of the same length is not a pairing.
  const unpaired = compileRelationRenderPlan([stage([{ ...relation, values: { roles: ['Theme', 'Theme'] } }], forest)]);
  assert.ok(unpaired.diagnostics.some((diagnostic) => diagnostic.kind === 'illegal-configuration'));
  assert.equal(unpaired.frames[0].items.some((item) => item.plaqueStyle === 'theta-grid'), false);
  const mismatch = compileRelationRenderPlan([stage([{ ...relation, values: { arguments: ['Theme'] } }], forest)]);
  assert.ok(mismatch.diagnostics.some((diagnostic) => diagnostic.kind === 'illegal-configuration'));
  assert.ok(mismatch.frames[0].items.some((item) => item.kind === 'fallback'));
  assert.equal(mismatch.frames[0].items.some((item) => item.plaqueStyle === 'theta-grid'), false);
});

test('registered theta retains literal labels under open paired field names', () => {
  const forest = [node('root', 'VP', [leaf('v', 'V', 'gave'), leaf('a', 'D', 'she'), leaf('b', 'D', 'it')])];
  const gridFor = relation => compileRelationRenderPlan([stage([relation], forest)]).frames[0].items
    .find(item => item.plaqueStyle === 'theta-grid');
  for (const key of ['assignments', 'semanticParticipants', 'θέσεις']) {
    const relation = { relation: 'ThetaAssignment', anchors: { predicate: 'v', [key]: ['b', 'a', 'b'] },
      values: { [key]: ['Goal', 'Agent', 'Theme'] } };
    const original = structuredClone(relation);
    assert.deepEqual(gridFor(relation)?.thetaRoles.map(({ nodeId, label }) => ({ nodeId, label })),
      [{ nodeId: 'b', label: 'Goal' }, { nodeId: 'a', label: 'Agent' }, { nodeId: 'b', label: 'Theme' }]);
    assert.deepEqual(relation, original);
    for (const labels of [['Goal'], ['Goal', '', 'Theme']]) {
      assert.equal(gridFor({ ...relation, values: { [key]: labels } }), undefined);
    }
  }
  const mixed = { relation: 'ThetaAssignment', anchors: { predicate: 'v', arguments: 'a', Theme: 'b' },
    values: { arguments: 'Agent' } };
  assert.deepEqual(gridFor(mixed)?.thetaRoles.map(({ nodeId, label }) => ({ nodeId, label })),
    [{ nodeId: 'a', label: 'Agent' }, { nodeId: 'b', label: 'Theme' }]);

  const relation = { relation: 'ThetaAssignment', anchors: { predicate: 'v', roleBearersCustom: ['a', 'b'] } };
  assert.equal(gridFor({ ...relation, values: { 'role bearers custom': ['Theme', 'Goal'],
    role_bearers_custom: ['Agent', 'Theme'] } }), undefined, 'competing normalized names cannot choose labels');
  assert.deepEqual(gridFor({ ...relation, values: { roleBearersCustom: ['Theme', 'Goal'],
    role_bearers_custom: ['Agent', 'Theme'] } })?.thetaRoles.map(role => role.label), ['Theme', 'Goal'],
  'an exact authored name retains precedence');
});

test('Transfer retains each exact accessible edge in its prepared plan', () => {
  const forest = [node('phase', 'CP', [leaf('e1', 'D', 'who'), leaf('e2', 'D', 'she'), node('sod', 'TP', [leaf('v', 'V', 'left')])])];
  const plan = compileRelationRenderPlan([stage([{ relation: 'TransferDomain',
    anchors: { phase: 'phase', edge: ['e1', 'e2'], spellOutDomain: 'sod' } }], forest)]);
  assert.deepEqual(plan.diagnostics, []);
  assert.deepEqual(plan.frames[0].items.filter((item) => item.domainStyle === 'transfer-edge').map((item) => item.rootNodeId), ['e1', 'e2']);
});

test('focus emphasis contains only actual native edges and rejects competing branch ownership', () => {
  const forest = [node('root', 'TP', [node('left', 'DP', [leaf('a', 'N', 'Mia')]), node('right', 'VP', [leaf('b', 'V', 'sang')])])];
  const plan = compileRelationRenderPlan([stage([{ relation: 'FocusMarking', anchors: { domain: 'root', focus: 'a', background: 'b' } }], forest)]);
  const emphasis = plan.frames[0].items.find((item) => item.kind === 'branch-emphasis');
  assert.deepEqual(emphasis.strongEdges, [{ fromNodeId: 'root', toNodeId: 'left' }, { fromNodeId: 'left', toNodeId: 'a' }]);
  assert.deepEqual(emphasis.weakEdges, [{ fromNodeId: 'root', toNodeId: 'right' }, { fromNodeId: 'right', toNodeId: 'b' }]);
  const invalid = compileRelationRenderPlan([stage([{ relation: 'FocusMarking', anchors: { domain: 'root', focus: 'left', background: 'a' } }], forest)]);
  assert.equal(invalid.frames[0].items.some((item) => item.kind === 'branch-emphasis'), false);
  assert.ok(invalid.diagnostics.some((diagnostic) => diagnostic.kind === 'illegal-configuration'));
});

test('unresolved large-array entries stay diagnostics and get no geometry', () => {
  const members = ['ok_1', 'ok_2', 'missing_3', 'ok_4', 'ok_5'];
  const forest = [node('root_miss', 'TP', ['ok_1', 'ok_2', 'ok_4', 'ok_5'].map((id) => node(id, 'DP', [leaf(`${id}_d`, 'D', 'x')])))];
  const plan = compileRelationRenderPlan([
    stage([{ relation: 'OpenChorus', anchors: { members } }], forest)
  ]);
  assert.ok(plan.diagnostics.some((d) => d.kind === 'large-array-anchor-unresolved' && /missing_3/.test(d.detail)));
  const bound = bindRelationPlanFrame(
    plan,
    0,
    (nodeId) => (nodeId.startsWith('ok_') || nodeId.startsWith('root') ? { x: Number(nodeId.slice(-1)) * 100, y: 50 } : null)
  );
  const fallbackMarks = bound.primitives.filter((p) => p.type === 'fallback-mark');
  assert.equal(fallbackMarks.length, 4, 'incomplete Tier-2 evidence fails closed to Tier 3');
  assert.ok(fallbackMarks.every((mark) => mark.nodeId !== 'missing_3'));
  assert.equal(bound.primitives.filter((p) => p.type === 'anchor-set-badge').length, 0);
  assert.equal(bound.primitives.filter((p) => p.type === 'anchor-set-rail').length, 1);
});

test('geometry binding fails closed on missing positions and prints no names, roles, ids, or values', () => {
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'SecretRelation',
      anchors: { one: 'dp_low', two: 'dp_high' },
      values: { secret: 'payload' }
    }], [whTree])
  ]);
  const positions = new Map([
    ['dp_low', { x: 100, y: 200 }],
    ['dp_high', { x: 300, y: 40 }]
  ]);
  const bound = bindRelationPlanFrame(plan, 0, (nodeId) => positions.get(nodeId) || null);
  const rendered = JSON.stringify(bound.primitives.map(({ nodeId, itemIndex, ...visual }) => visual));
  assert.ok(!rendered.includes('SecretRelation'));
  assert.ok(!rendered.includes('secret'));
  assert.ok(!rendered.includes('payload'));
  assert.ok(bound.primitives.some((p) => p.type === 'segment' && p.directed === false));

  const boundMissing = bindRelationPlanFrame(plan, 0, () => null);
  assert.equal(boundMissing.primitives.length, 0);
  assert.ok(boundMissing.failed.length > 0);
});

test('the fallback dispatcher rows match the accepted table', () => {
  assert.equal(fallbackDrawing({ relation: 'X', anchors: { a: 'n1' } }).row, 1);
  assert.equal(fallbackDrawing({ relation: 'X', anchors: { a: 'n1', b: 'n2' } }).row, 2);
  assert.equal(fallbackDrawing({ relation: 'X', anchors: { a: 'n1', b: ['n2', 'n3'] } }).row, 3);
  assert.equal(fallbackDrawing({ relation: 'X', anchors: { a: ['n1', 'n2'] } }).row, 4);
  assert.equal(fallbackDrawing({ relation: 'X', anchors: { a: ['n1', 'n2'], b: ['n3', 'n4'] } }).row, 5);
  assert.equal(fallbackDrawing({ relation: 'X', anchors: { a: 'n1', b: 'n2', c: 'n3' } }).row, 6);
  assert.equal(fallbackDrawing({ relation: 'X', anchors: {}, priorAnchors: { p: 'n0' } }).row, 0);
  // Frames distinguish role groups only for two array groups.
  const twoArrays = fallbackDrawing({ relation: 'X', anchors: { a: ['n1', 'n2'], b: ['n3', 'n4'] } });
  assert.deepEqual(twoArrays.marks.map((mark) => mark.frame), ['circle', 'circle', 'box', 'box']);
});

test('bound HeadMove endpoints are pronounced-terminal positions, never preterminal shells', () => {
  const headTree = node('cp_h', 'CP', [
    node('c_did', 'C', [leaf('c_did_word', 'C', 'did')]),
    node('tp_h', 'TP', [
      node('t_trace', 'T', [leaf('t_trace_word', 'T', 't₁', { silent: true })]),
      node('vp_h', 'VP', [leaf('v_h', 'V', 'leave')])
    ])
  ]);
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'HeadMove',
      anchors: { source: 't_trace', target: 'c_did' }
    }], [headTree])
  ]);
  const [item] = plan.frames[0].items;
  assert.equal(item.kind, 'trajectory');
  assert.equal(item.sourceAttachment, 'terminal');
  assert.equal(item.targetAttachment, 'terminal');

  // A provider in TreeVisualizer's mold: terminal resolves the materialized
  // display leaf inside the exact anchored preterminal; shell resolves the
  // anchored node itself. Distinct positions prove which one was used.
  const shellPositions = new Map([
    ['t_trace', { x: 10, y: 10 }],
    ['c_did', { x: 20, y: 10 }]
  ]);
  const terminalPositions = new Map([
    ['t_trace', { x: 11, y: 99 }],
    ['c_did', { x: 21, y: 99 }]
  ]);
  const provider = (nodeId, attachment = 'position') => (
    attachment === 'terminal'
      ? terminalPositions.get(nodeId) || null
      : shellPositions.get(nodeId) || null
  );
  const bound = bindRelationPlanFrame(plan, 0, provider);
  const path = bound.primitives.find((p) => p.type === 'trajectory-path');
  assert.ok(path);
  assert.deepEqual(path.from, { x: 11, y: 99 });
  assert.deepEqual(path.to, { x: 21, y: 99 }, 'the head landing binds to the pronounced terminal');

  // A head endpoint with no materialized terminal fails closed.
  const noTerminalProvider = (nodeId, attachment = 'position') => (
    attachment === 'terminal' ? null : shellPositions.get(nodeId) || null
  );
  const refused = bindRelationPlanFrame(plan, 0, noTerminalProvider);
  assert.equal(refused.primitives.filter((p) => p.type === 'trajectory-path').length, 0);
  assert.ok(refused.failed.some((f) => /materialized terminal/.test(f.reason)));
});

test('bound AbarMove departs from the witness terminal and lands on the phrase-shell bottom edge', () => {
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'AbarMove',
      anchors: { lowerCopy: 'dp_low', traceWitness: 'd_low', pronouncedCopy: 'dp_high' }
    }], [whTree])
  ]);
  const [item] = plan.frames[0].items;
  assert.equal(item.sourceAttachment, 'terminal');
  assert.equal(item.targetAttachment, 'shell-bottom');

  const provider = (nodeId, attachment = 'position') => {
    if (nodeId === 'd_low' && attachment === 'terminal') return { x: 5, y: 300 };
    if (nodeId === 'dp_high' && attachment === 'shell-bottom') return { x: 200, y: 20 };
    if (nodeId === 'dp_high' && attachment === 'terminal') return { x: 999, y: 999 };
    return null;
  };
  const bound = bindRelationPlanFrame(plan, 0, provider);
  const path = bound.primitives.find((p) => p.type === 'trajectory-path');
  assert.ok(path);
  assert.deepEqual(path.from, { x: 5, y: 300 }, 'departure is the witness trace terminal');
  assert.deepEqual(path.to, { x: 200, y: 20 }, 'landing is the phrase-shell edge, not a terminal');
});

test('every production-wired identity compiles its real accepted anchor shape without signature failure', () => {
  // Fixtures mirror the accepted Lab cards' authored anchor shapes exactly —
  // this is the regression net for any wired relation whose real roles were
  // omitted from its registry entry.
  const tripleTree = node('root_t', 'TP', [
    node('xp_src', 'XP', [leaf('w_src', 'X', 't₁', { silent: true })], { silent: true }),
    node('yp_tgt', 'YP', [leaf('t_tgt', 'Y', 'word')])
  ]);
  const triple = { lowerCopy: 'xp_src', traceWitness: 'w_src', pronouncedCopy: 'yp_tgt' };

  const headTree = node('root_h', 'TP', [
    node('t_src', 'T', [leaf('t_src_word', 'T', 't₁', { silent: true })]),
    node('c_tgt', 'C', [leaf('c_tgt_word', 'C', 'did')])
  ]);

  const opVarTree = node('root_ov', 'CP', [
    node('d_op', 'D', [leaf('d_op_word', 'D', 'Who')]),
    node('dp_var', 'DP', [leaf('d_var', 'D', 't₁', { silent: true })], { silent: true })
  ]);

  const atbTree = node('root_atb', 'TP', [
    node('xp_a', 'XP', [leaf('w_a', 'X', 't₁', { silent: true })], { silent: true }),
    node('xp_b', 'XP', [leaf('w_b', 'X', 't₁', { silent: true })], { silent: true }),
    node('yp_shared', 'YP', [leaf('t_shared', 'Y', 'what')])
  ]);

  const smugglingTree = node('root_sm', 'TP', [
    node('vp_carrier', 'VP', [
      leaf('w_carrier', 'V', 't₁', { silent: true }),
      node('dp_passenger', 'DP', [leaf('d_passenger', 'D', 'obj', { silent: true })], { silent: true })
    ], { silent: true }),
    node('dp_intervener', 'DP', [leaf('d_intervener', 'D', 'exp')]),
    node('vp_landed', 'VP', [leaf('v_landed', 'V', 'carried')])
  ]);

  const pairTree = node('root_pair', 'TP', [
    node('dp_one', 'DP', [leaf('d_one', 'D', 'John')]),
    node('dp_two', 'DP', [leaf('d_two', 'D', 'he')]),
    node('vbar_dom', "V'", [leaf('v_dom', 'V', 'saw'), node('dp_three', 'DP', [leaf('d_three', 'D', 'himself')])])
  ]);

  const qrTree = node('root_qr', 'TP', [
    node('qp_low', 'QP', [leaf('q_low', 'Q', 'every')]),
    node('qp_high', 'QP', [leaf('q_high', 'Q', 'every', { silent: true })], { silent: true })
  ]);

  const ellipsisTree = node('root_el', 'CoordP', [
    node('vp_ante', 'VP', [leaf('v_ante', 'V', 'read')]),
    node('vp_site', 'VP', [leaf('v_site', 'V', 'read', { silent: true })], { silent: true })
  ]);

  const cases = [
    { relation: 'AbarMove', anchors: triple, forest: [tripleTree] },
    { relation: 'AbarMove', anchors: { lowerCopy: 'xp_src', traceWitness: 'w_src', higherCopy: 'yp_tgt' }, forest: [tripleTree] },
    { relation: 'AMove', anchors: triple, forest: [tripleTree] },
    { relation: 'Scrambling', anchors: triple, forest: [tripleTree] },
    { relation: 'wh-movement', anchors: triple, forest: [tripleTree] },
    { relation: 'HeadMove', anchors: { source: 't_src', target: 'c_tgt' }, forest: [headTree] },
    { relation: 'auxiliary-head-movement', anchors: { source: 't_src', target: 'c_tgt' }, forest: [headTree] },
    { relation: 'Lowering', anchors: { source: 't_src', target: 'c_tgt' }, forest: [headTree] },
    {
      relation: 'OperatorVariableBinding',
      anchors: { operator: 'd_op', variable: 'dp_var', traceWitness: 'd_var' },
      forest: [opVarTree]
    },
    { relation: 'RemnantMovement', anchors: triple, forest: [tripleTree] },
    { relation: 'RollUpMovement', anchors: triple, forest: [tripleTree] },
    {
      relation: 'Smuggling',
      anchors: {
        lowerCopy: 'vp_carrier',
        traceWitness: 'w_carrier',
        pronouncedCopy: 'vp_landed',
        passenger: 'dp_passenger',
        intervener: 'dp_intervener'
      },
      forest: [smugglingTree]
    },
    {
      relation: 'AcrossTheBoardMovement',
      anchors: { sources: ['xp_a', 'xp_b'], traceWitnesses: ['w_a', 'w_b'], pronouncedCopy: 'yp_shared' },
      forest: [atbTree]
    },
    { relation: 'SidewardMovement', anchors: triple, forest: [tripleTree] },
    { relation: 'Coreference', anchors: { antecedent: 'dp_one', pronoun: 'dp_two' }, forest: [pairTree] },
    { relation: 'Coreference', anchors: { first: 'dp_one', second: 'dp_two' }, forest: [pairTree] },
    {
      relation: 'Binding',
      anchors: { binder: 'dp_one', bound: 'dp_three', domain: 'vbar_dom' },
      forest: [pairTree]
    },
    {
      relation: 'QuantifierRaising',
      anchors: { pronouncedQP: 'qp_low', lfQP: 'qp_high', scopeDomain: 'root_qr' },
      forest: [qrTree]
    },
    {
      relation: 'EllipsisRecoverability',
      anchors: { antecedent: 'vp_ante', site: 'vp_site' },
      forest: [ellipsisTree]
    }
  ];

  cases.forEach(({ relation, anchors, forest }) => {
    const plan = compileRelationRenderPlan([stage([{ relation, anchors }], forest)]);
    assert.deepEqual(
      plan.unregistered,
      [],
      `${relation} must dispatch through its exact registry entry`
    );
    const signatureFailures = plan.diagnostics.filter((d) => d.kind === 'signature-incomplete');
    assert.deepEqual(
      signatureFailures,
      [],
      `${relation} signature-incomplete: ${JSON.stringify(signatureFailures)}`
    );
    const semanticItems = plan.frames[0].items.filter((item) => item.kind !== 'fallback' && item.kind !== 'anchor-set');
    assert.ok(
      semanticItems.length >= 1,
      `${relation} compiled no semantic item; diagnostics: ${JSON.stringify(plan.diagnostics)}`
    );
  });
});

test('ACD is not a dedicated Tier-1 identity', () => {
  const forest = [node('tp_acd_shape', 'TP', [
    node('qp_low_acd_shape', 'QP', [
      leaf('q_low_acd_shape', 'Q', 'every', { lineageId: 'acd-qp' })
    ], { lineageId: 'acd-qp' }),
    node('qp_high_acd_shape', 'QP', [
      leaf('q_high_acd_shape', 'Q', 'every', { silent: true, lineageId: 'acd-qp' })
    ], { silent: true, lineageId: 'acd-qp' }),
    node('vp_site_acd_shape', 'VP', [
      leaf('v_site_acd_shape', 'V', 'read', { silent: true })
    ], { silent: true })
  ])];
  const relation = {
    relation: 'AntecedentContainedDeletion',
    anchors: {
      'pronounced qp': 'qp_low_acd_shape',
      'covert landing': 'qp_high_acd_shape',
      'scope domain': 'tp_acd_shape',
      'ellipsis site': 'vp_site_acd_shape'
    }
  };
  const dispatch = dispatchRelationClaims({
    relation,
    stageIndex: 0,
    relationIndex: 0,
    currentForest: forest
  });
  assert.equal(dispatch.tier1Dispatch.outcome, 'unregistered');
  assert.deepEqual(
    dispatch.facets.map(({ recipe }) => recipe.id).sort(),
    ['ellipsis.site', 'scope.movement']
  );
  assert.deepEqual(dispatch.claims.map(({ tier }) => tier), [2, 2]);
});

test('the wired ParasiticGap composition renders every large path-array node itself', () => {
  const pathIds = ['pgn_1', 'pgn_2', 'pgn_3', 'pgn_4', 'pgn_5', 'pgn_6'];
  const forest = [node('root_pg', 'CP', pathIds.map((id) => node(id, 'XP', [leaf(`${id}_h`, 'X', 'x')])))];
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'ParasiticGap',
      anchors: {
        filler: 'pgn_1',
        realGap: 'pgn_2',
        traceWitness: 'pgn_2',
        parasiticGap: 'pgn_3',
        primaryPath: pathIds
      }
    }], forest)
  ]);
  // ParasiticGap is production-wired and owns its path arrays: the sourced
  // composition marks every path node, so the organizational rail must not
  // double-mark them — and nothing may silently truncate.
  assert.deepEqual(plan.unregistered, []);
  const pathStatus = plan.frames[0].items.find((item) => item.kind === 'path-status');
  assert.ok(pathStatus, 'the island composition renders its path nodes');
  assert.deepEqual(pathStatus.primaryNodeIds, pathIds);
  assert.equal(plan.frames[0].items.filter((item) => item.kind === 'anchor-set').length, 0);
});

test('PhrasalSpellOut anchors a complete phrase and its compact exponent label', () => {
  const phrase = node('datp_spellout', 'DatP', [leaf('mira_spellout', 'N', 'Mira')]);
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'PhrasalSpellOut',
      anchors: { phrase: 'datp_spellout' },
      values: { exponent: '-nak' }
    }], [phrase])
  ]);

  assert.deepEqual(plan.diagnostics, []);
  const item = plan.frames[0].items.find((candidate) => candidate.familyId === 'pf.phrasal-spellout');
  assert.equal(item?.kind, 'node-plaque');
  assert.deepEqual(item?.anchorNodeIds, ['datp_spellout']);
});

test('only an exact registered family declaring full-array ownership suppresses the organization', () => {
  const sources = ['own_1', 'own_2', 'own_3', 'own_4', 'own_5'];
  const witnesses = sources.map((id) => `${id}_w`);
  const forest = [node('root_own', 'TP', [
    ...sources.map((id, index) => node(id, 'XP', [leaf(witnesses[index], 'X', 't₁', { silent: true })], { silent: true })),
    node('yp_own', 'YP', [leaf('t_own', 'Y', 'what')])
  ])];
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'AcrossTheBoardMovement',
      anchors: { sources, traceWitnesses: witnesses, pronouncedCopy: 'yp_own' }
    }], forest)
  ]);
  // The wired ATB family renders one trajectory per positional pair — it
  // owns the arrays, so no organizational anchor-set doubles them.
  const trajectories = plan.frames[0].items.filter((item) => item.kind === 'trajectory');
  assert.equal(trajectories.length, sources.length, 'every array element renders semantically');
  assert.equal(plan.frames[0].items.filter((item) => item.kind === 'anchor-set').length, 0);
});

test('a similarly named unregistered relation never inherits a full-array exemption', () => {
  const sources = ['sim_1', 'sim_2', 'sim_3', 'sim_4', 'sim_5'];
  const forest = [node('root_sim', 'TP', sources.map((id) => node(id, 'XP', [leaf(`${id}_h`, 'X', 'x')])))];
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'AcrossTheBoardMovementParty',
      anchors: { sources }
    }], forest)
  ]);
  assert.deepEqual(plan.unregistered.map((entry) => entry.relation), ['AcrossTheBoardMovementParty']);
  const anchorSet = plan.frames[0].items.find((item) => item.kind === 'anchor-set');
  assert.ok(anchorSet, 'the exemption belongs to the exact registered entry, never a lookalike');
});

test('values and priorAnchors travel verbatim through the replay plan and authored links', async () => {
  const { buildDerivationReplayPlan } = await import('../derivationReplayPlan.js');
  const {
    adaptDerivationStagesForReplay,
    buildAuthoredRelationLinksForFrames
  } = await import('../replay/replayCompiler.ts');

  const before = node('tp_v_before', 'TP', [leaf('lex_before', 'X', 'le')]);
  const after = node('tp_v_after', 'TP', [leaf('lex_after', 'X', 'se'), leaf('lex_other', 'Y', 'lo')]);
  const stages = [
    stage([], [before]),
    stage([{
      relation: 'AbarMove',
      anchors: {
        lowerCopy: 'lex_after',
        traceWitness: 'lex_after',
        pronouncedCopy: 'lex_other'
      },
      priorAnchors: { replaced: 'lex_before' },
      values: { register: ['α', 'β'], note: 'verbatim' }
    }], [after])
  ];

  const replayPlan = buildDerivationReplayPlan({ derivationStages: stages });
  const relationStep = replayPlan.stages[1].relationSteps[0];
  assert.deepEqual(relationStep.priorAnchors, { replaced: 'lex_before' });
  assert.deepEqual(relationStep.values, { register: ['α', 'β'], note: 'verbatim' });

  const frames = adaptDerivationStagesForReplay(stages);
  const links = buildAuthoredRelationLinksForFrames(
    frames,
    replayPlan,
    1,
    [after]
  );
  assert.equal(links.length, 1);
  assert.deepEqual(links[0].priorAnchors, { replaced: 'lex_before' });
  assert.deepEqual(links[0].values, { register: ['α', 'β'], note: 'verbatim' });
});
