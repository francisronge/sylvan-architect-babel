import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileRelationRenderPlan,
  visiblePlanFrameItems
} from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { compileTier2RelationOutputs } from '../replay/relations/tier2RenderPlanCompiler.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';

const leaf = (id, label, word, extra = {}) => ({
  id,
  label,
  ...(word ? { word } : {}),
  ...extra
});
const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });
const stage = (relations, forest) => ({
  statement: 'statement',
  stageRecord: 'record',
  relations,
  workspaceForest: forest
});

const assertExclusiveTier2Plan = (plan) => {
  assert.ok(plan.frames.flatMap((frame) => frame.items).some((item) => item.tier2FacetId));
  assert.equal(
    plan.frames.flatMap((frame) => frame.items).some((item) => item.kind === 'fallback'),
    false,
    'a completed Tier-2 relation never also paints Tier 3'
  );
  assert.equal(
    plan.frames.flatMap((frame) => frame.items)
      .filter((item) => item.tier2FacetId)
      .every((item) => item.tier2OutputIdentities.length > 0),
    true,
    'every lowered item retains dispatch-attached output identity'
  );
};

test('Task 8 lowers ghosting, plaques, and judgments through production primitives', () => {
  const ghostForest = [node('ghost_root', 'TP', [
    node('ghost_site', 'VP', [
      leaf('ghost_v', 'V', 'read', { silent: true })
    ], { silent: true })
  ])];
  const ghostPlan = compileRelationRenderPlan([
    stage([{ relation: 'UnknownGhosting', anchors: { 'ellipsis site': 'ghost_site' } }], ghostForest)
  ]);
  assertExclusiveTier2Plan(ghostPlan);
  const ghost = ghostPlan.frames[0].items.find((item) => item.tier2FacetId === 'ellipsis.site');
  assert.equal(ghost?.kind, 'ellipsis-site');
  assert.deepEqual(ghost?.ghostNodeIds, ['ghost_site', 'ghost_v']);
  assert.deepEqual(
    bindRelationPlanFrame(ghostPlan, 0, () => ({ x: 20, y: 20 })).primitives
      .filter((primitive) => primitive.type === 'ghost-set')
      .map((primitive) => primitive.nodeIds),
    [['ghost_site', 'ghost_v']]
  );

  const plaqueForest = [node('plaque_root', 'TP', [leaf('plaque_anchor', 'D', 'word')])];
  const plaquePlan = compileRelationRenderPlan([
    stage([{
      relation: 'UnknownPlaque',
      anchors: { 'plaque anchor': 'plaque_anchor' },
      values: { 'plaque rows': ['Case: NOM'] }
    }], plaqueForest)
  ]);
  assertExclusiveTier2Plan(plaquePlan);
  const plaque = plaquePlan.frames[0].items.find((item) => item.kind === 'node-plaque');
  assert.equal(plaque?.tier2FacetId, 'plaque.structured');
  assert.deepEqual(plaquePlan.diagnostics, []);

  const judgmentForest = [node('judged_root', 'CP', [])];
  const judgmentPlan = compileRelationRenderPlan([
    stage([{
      relation: 'UnknownJudgment',
      anchors: { analysis: 'judged_root' },
      values: { verdict: '*', label: 'extraction' }
    }], judgmentForest)
  ]);
  assertExclusiveTier2Plan(judgmentPlan);
  const boundJudgment = bindRelationPlanFrame(
    judgmentPlan,
    0,
    (nodeId) => nodeId === 'judged_root' ? { x: 100, y: 40 } : null
  );
  assert.deepEqual(boundJudgment.failed, []);
  assert.deepEqual(
    boundJudgment.primitives.find((primitive) => primitive.type === 'analysis-verdict'),
    {
      type: 'analysis-verdict',
      analysisNodeId: 'judged_root',
      x: 100,
      y: 40,
      judgment: '*',
      label: 'extraction',
      itemIndex: 0
    }
  );
});

test('Tier-2 verdict lowering fails closed when its accepted evidence is incomplete', () => {
  const judgmentForest = [node('guarded_root', 'CP', [])];
  const completeRelation = {
    relation: 'UnknownGuardedJudgment',
    anchors: { analysis: 'guarded_root' },
    values: { verdict: '*', label: 'agreement' }
  };
  const dispatch = dispatchRelationClaims({
    relation: completeRelation,
    stageIndex: 0,
    relationIndex: 0,
    currentForest: judgmentForest
  });
  assert.equal(dispatch.facets.some((facet) => facet.recipe.id === 'judgment.verdict'), true);

  const lower = (relation) => compileTier2RelationOutputs({
    relation,
    relationRef: {
      stageIndex: 0,
      relationIndex: 0,
      relation: relation.relation,
      anchors: relation.anchors,
      ...(relation.values ? { values: relation.values } : {})
    },
    dispatch: dispatchRelationClaims({ relation, currentForest: judgmentForest, stageIndex: 0, relationIndex: 0 }),
    currentForest: judgmentForest
  });

  for (const relation of [
    { ...completeRelation, values: { label: 'agreement' } },
    { ...completeRelation, anchors: { analysis: 'missing_node' } }
  ]) {
    const result = lower(relation);
    assert.equal(result.items.some((item) => item.kind === 'analysis-verdict'), false);
  }
});

test('Task 8 emits the active presentation companion without changing tier ownership', () => {
  const forest = [node('lens_root', 'TP', [
    node('lens_a', 'DP', []),
    node('lens_b', 'DP', [])
  ])];
  const relation = {
    relation: 'UnknownIdentityLens',
    anchors: {
      occurrences: ['lens_a', 'lens_b'],
      anchors: ['lens_a', 'lens_b']
    }
  };
  const dispatch = dispatchRelationClaims({
    relation,
    stageIndex: 0,
    relationIndex: 0,
    currentForest: forest,
    activeLens: true
  });
  assert.deepEqual(dispatch.claims.map(({ tier }) => tier), [2]);
  assert.deepEqual(
    dispatch.facets.map((facet) => facet.recipe.id),
    ['identity.occurrences', 'presentation.lens']
  );

  const plan = compileRelationRenderPlan([stage([relation], forest)], { activeLens: true });
  assertExclusiveTier2Plan(plan);
  const presentation = plan.frames[0].items.find(
    (item) => item.tier2FacetId === 'presentation.lens'
  );
  assert.equal(presentation?.persistence, 'stage-only');
  assert.deepEqual(
    presentation?.tier2OutputIdentities,
    dispatch.facets[1].outputIdentities.map(({ key }) => key)
  );
});

test('Task 8 organizes only the authored array that earned the large-array companion', () => {
  const members = ['large_1', 'large_2', 'large_3', 'large_4', 'large_5', 'large_6'];
  const forest = [node('large_root', 'TP', members.map((id) => node(id, 'DP', [])))];
  const relation = {
    relation: 'UnknownLargeSet',
    anchors: { members, occurrences: members, anchor: 'large_root' }
  };
  const dispatch = dispatchRelationClaims({
    relation,
    stageIndex: 0,
    relationIndex: 0,
    currentForest: forest
  });
  assert.deepEqual(dispatch.claims.map(({ tier }) => tier), [2, 3]);
  assert.equal(
    dispatch.facets.some((facet) => facet.recipe.id === 'organization.large-anchor-set'),
    true,
    'the organizational companion must survive public exclusive dispatch'
  );
  const plan = compileRelationRenderPlan([
    stage([relation], forest)
  ]);
  const residual = plan.frames[0].items.find((item) => item.kind === 'fallback');
  assert.deepEqual(residual?.drawing.marks.map(({ witness }) => witness), [...members, ...members, 'large_root']);
  assert.deepEqual(residual.relationRef.anchors, { anchor: 'large_root' });
  const organization = plan.frames[0].items.find(
    (item) => item.tier2FacetId === 'organization.large-anchor-set'
  );
  assert.equal(organization?.kind, 'anchor-set');
  assert.deepEqual(organization?.set.roles.map(({ role }) => role), ['members']);
  assert.deepEqual(
    organization?.set.roles[0].anchors.map(({ nodeId }) => nodeId),
    members
  );

  const splitMembers = members.slice(0, 3);
  const splitParticipants = members.slice(3);
  const splitPlan = compileRelationRenderPlan([
    stage([{
      relation: 'UnknownSplitLargeSet',
      anchors: { members: splitMembers, participants: splitParticipants, occurrences: members }
    }], forest)
  ]);
  const splitOrganization = splitPlan.frames[0].items.find(
    (item) => item.tier2FacetId === 'organization.large-anchor-set'
  );
  assert.deepEqual(
    splitOrganization?.set.roles.map(({ role, anchors }) => ({
      role,
      nodeIds: anchors.map(({ nodeId }) => nodeId)
    })),
    [
      { role: 'members', nodeIds: splitMembers },
      { role: 'participants', nodeIds: splitParticipants }
    ],
    'one recipe-owned aggregate threshold preserves every authored role group'
  );
});

test('Task 8 does not duplicate a movement path for blocked extraction', () => {
  const trace = leaf('blocked_trace', 'D', '', { silent: true, lineageId: 'blocked-chain' });
  const source = node('blocked_source', 'DP', [trace], { lineageId: 'blocked-chain' });
  const target = node('blocked_target', 'DP', [], { lineageId: 'blocked-chain' });
  const adjunct = node('blocked_adjunct', 'CP', [source]);
  const forest = [node('blocked_root', 'TP', [target, adjunct])];
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'UnknownBlockedExtraction',
      anchors: {
        source: 'blocked_source',
        'trace witness': 'blocked_trace',
        landing: 'blocked_target',
        'extraction source': 'blocked_source',
        'extraction target': 'blocked_target',
        'adjunct domain': 'blocked_adjunct'
      },
      values: { outcome: 'blocked', label: 'extraction' }
    }], forest)
  ]);

  assert.equal(
    plan.frames[0].items.filter((item) => (
      item.kind === 'trajectory' || item.pathStyle === 'blocked-extraction'
    )).length,
    1,
    'the ordinary movement trajectory must own the shared source-to-target path'
  );
  assert.equal(
    plan.frames[0].items.some((item) => (
      item.tier2FacetId === 'blocked-extraction' && item.kind === 'domain-mark'
    )),
    true
  );
  assert.equal(
    plan.frames[0].items.some((item) => item.kind === 'analysis-verdict'),
    false,
    'a bare label is not a verdict without an authored analysis anchor and judgment'
  );
});

test('blocked-extraction path suppression is independent of authored relation order', () => {
  const trace = leaf('ordered_trace', 'D', '', { silent: true, lineageId: 'ordered-chain' });
  const source = node('ordered_source', 'DP', [trace], { lineageId: 'ordered-chain' });
  const target = node('ordered_target', 'DP', [], { lineageId: 'ordered-chain' });
  const adjunct = node('ordered_adjunct', 'CP', [source]);
  const forest = [node('ordered_root', 'TP', [target, adjunct])];
  const plan = compileRelationRenderPlan([
    stage([
      {
        relation: 'BlockedExtraction',
        anchors: {
          source: 'ordered_source',
          target: 'ordered_target',
          adjunctDomain: 'ordered_adjunct'
        },
        values: { outcome: 'blocked' }
      },
      {
        relation: 'AbarMove',
        anchors: {
          lowerCopy: 'ordered_source',
          traceWitness: 'ordered_trace',
          pronouncedCopy: 'ordered_target'
        }
      }
    ], forest)
  ]);

  assert.equal(plan.frames[0].items.filter((item) => item.kind === 'trajectory').length, 1);
  assert.equal(plan.frames[0].items.some((item) => (
    item.kind === 'directed-path' && item.pathStyle === 'blocked-extraction'
  )), false);
  assert.equal(plan.frames[0].items.some((item) => (
    item.kind === 'domain-mark' && item.domainStyle === 'adjunct-domain'
  )), true);
});

test('a blocked curve returns after movement vanishes, independent of claim packaging and order', () => {
  const trace = leaf('persistent_trace', 'D', '', {
    silent: true,
    lineageId: 'persistent-chain'
  });
  const firstSource = node('persistent_source', 'DP', [trace], {
    lineageId: 'persistent-chain'
  });
  const laterSource = node('persistent_source', 'DP', [], {
    lineageId: 'persistent-chain'
  });
  const target = node('persistent_target', 'DP', [], {
    lineageId: 'persistent-chain'
  });
  const firstAdjunct = node('persistent_adjunct', 'CP', [firstSource]);
  const laterAdjunct = node('persistent_adjunct', 'CP', [laterSource]);
  const firstForest = [node('persistent_root', 'TP', [target, firstAdjunct])];
  const laterForest = [node('persistent_root', 'TP', [target, laterAdjunct])];
  const movement = {
    relation: 'AbarMove',
    anchors: {
      lowerCopy: 'persistent_source',
      traceWitness: 'persistent_trace',
      pronouncedCopy: 'persistent_target'
    }
  };
  const blocked = {
    relation: 'BlockedExtraction',
    anchors: {
      source: 'persistent_source',
      target: 'persistent_target',
      adjunctDomain: 'persistent_adjunct'
    },
    values: { outcome: 'blocked' }
  };
  const combined = {
    relation: 'UnknownBlockedMovement',
    anchors: {
      source: 'persistent_source',
      'trace witness': 'persistent_trace',
      landing: 'persistent_target',
      'extraction source': 'persistent_source',
      'extraction target': 'persistent_target',
      'adjunct domain': 'persistent_adjunct'
    },
    values: { outcome: 'blocked' }
  };

  [[movement, blocked], [blocked, movement], [combined]].forEach((relations) => {
    const plan = compileRelationRenderPlan([
      stage(relations, firstForest),
      stage([], laterForest)
    ]);
    const routeItems = (frameIndex) => plan.frames[frameIndex].items.filter((item) => (
      item.kind === 'trajectory'
      || (item.kind === 'directed-path' && item.pathStyle === 'blocked-extraction')
    ));

    assert.deepEqual(routeItems(0).map(({ kind }) => kind), ['trajectory']);
    assert.deepEqual(routeItems(1).map(({ kind }) => kind), ['directed-path']);
  });
});

test('Tier-2 prior continuity contains only prior evidence owned by that facet', () => {
  const priorForest = [node('prior_root', 'TP', [
    leaf('owned_prior_input', 'Cl', '-sue'),
    leaf('residual_prior_note', 'X', 'note')
  ])];
  const currentForest = [node('current_root', 'TP', [
    leaf('fission_output_a', 'Agr', '-su'),
    leaf('fission_output_b', 'Num', '-e')
  ])];
  const plan = compileRelationRenderPlan([
    stage([], priorForest),
    stage([{
      relation: 'UnknownFissionWithResidualPrior',
      anchors: { outputs: ['fission_output_a', 'fission_output_b'] },
      priorAnchors: {
        input: 'owned_prior_input',
        mystery: 'residual_prior_note'
      },
      values: { inputFeatures: ['person', 'plural'], outputs: ['person', 'plural'] }
    }], currentForest)
  ]);
  const fission = plan.frames[1].items.find((item) => item.tier2FacetId === 'pf.fission');
  const fallback = plan.frames[1].items.find((item) => item.kind === 'fallback');

  assert.deepEqual(fission?.priorWitnessNodeIds, ['owned_prior_input']);
  assert.equal(fission?.backward, true);
  assert.deepEqual(fallback?.priorWitnessNodeIds, ['residual_prior_note']);
});

test('Task 8 keeps complete sibling facets independent in the production plan', () => {
  const forest = [node('siblings_root', 'TP', [
    node('siblings_a', 'DP', []),
    node('siblings_b', 'DP', [])
  ])];
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'UnknownSiblings',
      anchors: {
        occurrences: ['siblings_a', 'siblings_b'],
        'feature source': 'siblings_a',
        'feature target': 'siblings_b'
      }
    }], forest)
  ]);
  assertExclusiveTier2Plan(plan);
  assert.deepEqual(
    plan.frames[0].items
      .map((item) => item.tier2FacetId)
      .filter(Boolean)
      .sort(),
    ['feature.dependency', 'identity.occurrences']
  );
});

test('Task 8 stops persistence when an exact witness vanishes', () => {
  const firstForest = [node('persist_root', 'TP', [
    node('persist_a', 'DP', []),
    node('persist_b', 'DP', [])
  ])];
  const secondForest = [node('persist_root', 'TP', [node('persist_a', 'DP', [])])];
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'UnknownPersistentIdentity',
      anchors: { occurrences: ['persist_a', 'persist_b'] }
    }], firstForest),
    stage([], secondForest)
  ]);
  assert.equal(plan.frames[0].items.some((item) => item.tier2FacetId === 'identity.occurrences'), true);
  assert.equal(plan.frames[1].items.some((item) => item.tier2FacetId === 'identity.occurrences'), false);
  assert.equal(plan.diagnostics.some((diagnostic) => diagnostic.kind === 'anchor-vanished'), true);
});

test('Task 8 persistence includes a facet witness that the visible geometry does not use', () => {
  const witness = leaf('carrier_witness', 'D', 't1', { silent: true, lineageId: 'carrier_chain' });
  const source = node('carrier_source', 'DP', [witness], { lineageId: 'carrier_chain' });
  const landing = node('carrier_landing', 'DP', [
    leaf('carrier_landing_word', 'D', 'book', { lineageId: 'carrier_chain' })
  ], { lineageId: 'carrier_chain' });
  const firstForest = [node('carrier_root', 'TP', [
    node('carrier_host', 'XP', [source]),
    landing
  ])];
  const secondForest = [node('carrier_root', 'TP', [source, landing])];
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'UnknownCarrierMovement',
      anchors: {
        source: 'carrier_source',
        'trace witness': 'carrier_witness',
        landing: 'carrier_landing',
        carrier: 'carrier_host'
      }
    }], firstForest),
    stage([], secondForest)
  ]);
  assert.equal(
    plan.frames[0].items.some((item) => item.tier2FacetId === 'movement.carrier'),
    true
  );
  assert.equal(
    plan.frames[1].items.some((item) => item.tier2FacetId === 'movement.carrier'),
    false,
    'the carrier witness gates persistence even though the arrow geometry uses source and landing'
  );
});

test('Task 8 never lets a Tier-2 ledger replace a canonical Tier-1 ledger', () => {
  const forest = [node('ledger_scope', 'S', [node('ledger_quantifier', 'QP', [])])];
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'CooperStorage',
      anchors: { scope: 'ledger_scope', quantifier: 'ledger_quantifier' },
      values: { category: 'S', qstore: ['someone'], retrieved: [] }
    }], forest),
    stage([{
      relation: 'UnknownScopeLedger',
      anchors: { 'storage host': 'ledger_scope' },
      values: { qstore: ['q'] }
    }], forest)
  ]);
  const committed = visiblePlanFrameItems(plan, 1, null)
    .filter((item) => item.familyId === 'cooper-storage.ledger');
  assert.equal(committed.length, 2);
  assert.equal(committed.some((item) => item.tier2FacetId === 'storage.ledger'), true);
  assert.equal(committed.some((item) => item.tier2FacetId === undefined), true);
});

test('Task 8 forwards a genuinely ambiguous enclosure collision into the plan', () => {
  const forest = [node('ambiguous_carrier', 'XP', [leaf('ambiguous_word', 'D', 'someone')])];
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'UnknownAmbiguousCarrier',
      anchors: { carrier: 'ambiguous_carrier' }
    }], forest)
  ]);
  assert.equal(plan.frames[0].items.some((item) => item.kind === 'fallback'), true);
  assert.equal(
    plan.diagnostics.some((diagnostic) => (
      diagnostic.kind === 'tier2-collision'
      && diagnostic.detail.includes('constituent-enclosure-reading')
    )),
    true
  );
});

test('Task 8 replaces an earlier claim only through complete immediate prior anchors', () => {
  const firstForest = [node('replace_root', 'TP', [
    node('replace_old_a', 'DP', []),
    node('replace_old_b', 'DP', [])
  ])];
  const secondForest = [node('replace_root', 'TP', [
    node('replace_old_a', 'DP', []),
    node('replace_old_b', 'DP', []),
    node('replace_new_a', 'DP', []),
    node('replace_new_b', 'DP', [])
  ])];
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'UnknownIdentityState',
      anchors: { occurrences: ['replace_old_a', 'replace_old_b'] }
    }], firstForest),
    stage([{
      relation: 'UnknownIdentityState',
      anchors: { occurrences: ['replace_new_a', 'replace_new_b'] },
      priorAnchors: { occurrences: ['replace_old_a', 'replace_old_b'] }
    }], secondForest)
  ]);
  const rawIdentityItems = plan.frames[1].items.filter(
    (item) => item.tier2FacetId === 'identity.occurrences'
  );
  assert.equal(rawIdentityItems.length, 2, 'Replay retains the superseded history in the frame');
  assert.equal(rawIdentityItems.filter((item) => item.supersededAt).length, 1);
  assert.equal(
    visiblePlanFrameItems(plan, 1, null)
      .filter((item) => item.tier2FacetId === 'identity.occurrences').length,
    1,
    'committed view exposes only the explicitly replacing claim'
  );
});

test('unowned unresolved prior evidence does not suppress complete Tier-2 continuity', () => {
  const priorForest = [node('partial_prior_root', 'TP', [
    node('partial_prior_a', 'DP', [])
  ])];
  const currentForest = [node('partial_current_root', 'TP', [
    node('partial_current_a', 'DP', []),
    node('partial_current_b', 'DP', [])
  ])];
  const plan = compileRelationRenderPlan([
    stage([], priorForest),
    stage([{
      relation: 'UnknownPartialPriorIdentity',
      anchors: { occurrences: ['partial_current_a', 'partial_current_b'] },
      priorAnchors: {
        occurrences: ['partial_prior_a'],
        'extra witness': ['missing_prior_witness']
      }
    }], currentForest)
  ]);
  const identity = plan.frames[1].items.find(
    (item) => item.tier2FacetId === 'identity.occurrences'
  );
  assert.equal(identity?.backward, true);
  assert.deepEqual(identity?.priorWitnessNodeIds, ['partial_prior_a']);
  assert.ok(identity?.replacementPredecessorGroup);
  const residual = plan.frames[1].items.find((item) => item.kind === 'fallback');
  assert.equal(residual?.backward, false);
  assert.deepEqual(residual?.priorWitnessNodeIds, []);
  assert.equal(
    plan.diagnostics.some((diagnostic) => diagnostic.kind === 'prior-anchor-unresolved'),
    true
  );
});

test('Task 8 does not coalesce outputs when prior-anchor evidence differs', () => {
  const forest = [node('prior_root', 'TP', [
    node('prior_a', 'DP', []),
    node('prior_b', 'DP', [])
  ])];
  const plan = compileRelationRenderPlan([
    stage([], forest),
    stage([
      {
        relation: 'UnknownIdentityOne',
        anchors: { occurrences: ['prior_a', 'prior_b'] }
      },
      {
        relation: 'UnknownIdentityTwo',
        anchors: { occurrences: ['prior_a', 'prior_b'] },
        priorAnchors: { occurrences: ['prior_a', 'prior_b'] }
      }
    ], forest)
  ]);
  assert.equal(
    plan.frames[1].items.filter((item) => item.tier2FacetId === 'identity.occurrences').length,
    2
  );
});

test('Task 8 emits one operator hull/path item for each complete operator facet', () => {
  const forest = [node('operator_domain', 'TP', [
    node('operator_qp', 'QP', []),
    node('operator_variable', 'DP', [])
  ])];
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'UnknownOperatorBinding',
      anchors: {
        operator: 'operator_qp',
        variable: 'operator_variable',
        'scope domain': 'operator_domain'
      },
      values: { index: '1' }
    }], forest)
  ]);
  assertExclusiveTier2Plan(plan);
  const operatorItems = plan.frames[0].items.filter(
    (item) => item.tier2FacetId === 'operator-binding'
  );
  assert.equal(operatorItems.length, 1);
  assert.equal(operatorItems[0].kind, 'operator-variable-binding');

  const positions = new Map([
    ['operator_domain', { x: 120, y: 20 }],
    ['operator_qp', { x: 60, y: 80 }],
    ['operator_variable', { x: 180, y: 160 }]
  ]);
  const bound = bindRelationPlanFrame(plan, 0, (nodeId) => positions.get(nodeId) || null);
  assert.equal(
    bound.primitives.filter((primitive) => primitive.type === 'operator-variable-binding').length,
    1
  );
});
