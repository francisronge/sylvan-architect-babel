import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileRelationRenderPlan,
  visiblePlanFrameItems
} from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { splitAntecedenceLinkPath } from '../replay/relations/markGeometry.ts';
import {
  analysisVerdictCompoundOrigin,
  analysisVerdictInitialLocalScale,
  planAnalysisVerdictRows,
  placeRectBelowCollisions,
  placeStackedRect
} from '../replay/relations/overlayGeometry.ts';

const leaf = (id, label, word, extra = {}) => ({ id, label, ...(word ? { word } : {}), ...extra });
const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });
const stage = (relations, forest) => ({
  statement: 'statement',
  stageRecord: 'record',
  relations: relations,
  workspaceForest: forest
});

const forest = () => [node('root_ms', 'TP', [
  node('a_ms', 'AP', [leaf('a_leaf_ms', 'A', 'a')]),
  node('b_ms', 'BP', [leaf('b_leaf_ms', 'B', 'b')]),
  node('c_ms', 'CPx', [leaf('c_leaf_ms', 'C', 'c')]),
  node('d_ms', 'DPx', [leaf('d_leaf_ms', 'D', 'd')]),
  node('dom_ms', 'ZP', [
    node('in_a_ms', 'ZA', [leaf('in_a_leaf_ms', 'Z', 'za')]),
    node('in_b_ms', 'ZB', [leaf('in_b_leaf_ms', 'Z', 'zb')])
  ]),
  node('src_ms', 'XP', [leaf('w_ms', 'X', 't₁', { silent: true })], { silent: true }),
  node('tgt_ms', 'YP', [leaf('t_ms', 'Y', 'word')])
])];

const gridPositions = new Map([
  ['root_ms', { x: 500, y: 0 }],
  ['a_ms', { x: 100, y: 200 }], ['a_leaf_ms', { x: 100, y: 300 }],
  ['b_ms', { x: 300, y: 200 }], ['b_leaf_ms', { x: 300, y: 300 }],
  ['c_ms', { x: 500, y: 200 }], ['c_leaf_ms', { x: 500, y: 300 }],
  ['d_ms', { x: 700, y: 200 }], ['d_leaf_ms', { x: 700, y: 300 }],
  ['dom_ms', { x: 900, y: 200 }],
  ['in_a_ms', { x: 850, y: 320 }], ['in_a_leaf_ms', { x: 850, y: 420 }],
  ['in_b_ms', { x: 950, y: 320 }], ['in_b_leaf_ms', { x: 950, y: 420 }],
  ['src_ms', { x: 1100, y: 200 }], ['w_ms', { x: 1100, y: 300 }],
  ['tgt_ms', { x: 1300, y: 120 }], ['t_ms', { x: 1300, y: 220 }]
]);
const provider = (nodeId) => gridPositions.get(nodeId) || null;

const bindSingle = (relation) => {
  const plan = compileRelationRenderPlan([stage([relation], forest())]);
  assert.deepEqual(plan.unregistered, [], `${relation.relation} unexpectedly unregistered`);
  return bindRelationPlanFrame(plan, 0, provider);
};

test('Split Antecedence curves leave separate square points and point from dependent to antecedent', () => {
  assert.equal(
    splitAntecedenceLinkPath({ x: 798, y: 562 }, { x: 257, y: 384 }, 0, 2),
    'M 794.0 564.0 C 650.0 626.0, 312.0 612.0, 257.0 384.0'
  );
  assert.equal(
    splitAntecedenceLinkPath({ x: 798, y: 562 }, { x: 583, y: 522 }, 1, 2),
    'M 802.0 564.0 C 724.0 590.0, 611.0 584.0, 583.0 522.0'
  );
});

test('the phase mark binds as the accepted arc, never a rectangle', () => {
  const bound = bindSingle({ relation: 'Phase', anchors: { phase: 'dom_ms', edge: 'in_a_ms' } });
  const arc = bound.primitives.find((p) => p.type === 'shape-path' && p.shapeStyle === 'phase-arc');
  assert.ok(arc, 'the phase draws a shape path');
  assert.match(arc.d, /Q /, 'the phase mark is a quadratic arc');
  assert.equal(arc.arrowhead, false);
  assert.equal(bound.primitives.filter((p) => p.type === 'domain-region').length, 0,
    'no rectangle stands in for the phase arc');
  assert.equal(bound.primitives.some((p) => p.type === 'text-badge'), false,
    'the authored edge shapes the phase arc; it is not a visible badge');
});

test('multiple Phase relations preserve the accepted primary/secondary order and authored edges', () => {
  const plan = compileRelationRenderPlan([stage([
    { relation: 'Phase', anchors: { phase: 'dom_ms', edge: 'in_a_ms' } },
    { relation: 'Phase', anchors: { phase: 'in_b_ms', edge: 'in_b_leaf_ms' } }
  ], forest())]);
  const phaseItems = plan.frames[0].items.filter((item) =>
    item.kind === 'domain-mark' && item.domainStyle === 'phase');
  assert.deepEqual(phaseItems.map((item) => ({
    edge: item.phaseEdgeNodeId,
    primary: item.phasePrimary
  })), [
    { edge: 'in_a_ms', primary: true },
    { edge: 'in_b_leaf_ms', primary: false }
  ]);
});

test('Pair Merge binds both members of one shared-parent native branch overlay', () => {
  const bound = bindSingle({ relation: 'PairMerge', anchors: { pairMember: 'a_ms', host: 'b_ms' } });
  const overlay = bound.primitives.find((p) => p.type === 'native-branch-overlay');
  assert.deepEqual(overlay, {
    type: 'native-branch-overlay',
    targetNodeIds: ['a_ms', 'b_ms'],
    requireSharedParent: true,
    variant: 'pair-merge',
    itemIndex: 0
  });
});

test('Dependent Case binds as the orthogonal elbow with filled circular endpoints and no arrowhead', () => {
  const bound = bindSingle({
    relation: 'DependentCase',
    anchors: { probe: 'a_ms', goal: 'b_ms' },
    values: { step: '1', Case: 'ACC', probeLabel: '[*φ*]', goalLabel: '[CASE: ACC]' }
  });
  const elbow = bound.primitives.find((p) => p.type === 'shape-path' && p.shapeStyle === 'dependent-case');
  assert.ok(elbow);
  assert.equal(elbow.arrowhead, false, 'the dependent-Case elbow never carries an arrowhead');
  assert.equal(elbow.endpointDots?.length, 2, 'both endpoints carry filled circles');
  assert.doesNotMatch(elbow.d, /[QC] /, 'the elbow is orthogonal line segments, not a curve');
  assert.match(elbow.d, /^M [\d.]+ [\d.]+ L /);
});

test('Anti-Locality binds dashed with the source bar tip when blocked, the check when licensed', () => {
  const blocked = bindSingle({
    relation: 'AntiLocality',
    anchors: { source: 'src_ms', traceWitness: 'w_ms', landing: 'tgt_ms' },
    values: { outcome: 'blocked' }
  });
  const blockedPath = blocked.primitives.find((p) => p.type === 'shape-path' && p.shapeStyle === 'anti-locality');
  assert.ok(blockedPath);
  assert.equal(blockedPath.stroke, 'dashed');
  assert.equal(blockedPath.arrowhead, false, 'no triangle arrowhead on the anti-locality comparison');
  assert.equal(blockedPath.tip?.kind, 'bar', 'the blocked path ends in the source bar cap');
  assert.match(blockedPath.tip.d, /^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/, 'the bar cap is one horizontal segment');

  const licensed = bindSingle({
    relation: 'AntiLocality',
    anchors: { source: 'src_ms', traceWitness: 'w_ms', landing: 'tgt_ms', facilitator: 'a_ms' },
    values: { outcome: 'licensed' }
  });
  const licensedPath = licensed.primitives.find((p) => p.type === 'shape-path' && p.shapeStyle === 'anti-locality');
  assert.equal(licensedPath.tip?.kind, 'check');
});

test('Multiple and Cyclic Agree bind as routed curves; cycles carry their numbered badge', () => {
  const multiple = bindSingle({
    relation: 'MultipleAgree',
    anchors: { probe: 'a_ms', goals: ['b_ms', 'c_ms'] }
  });
  const fan = multiple.primitives.filter((p) => p.type === 'shape-path' && p.shapeStyle === 'agree-multiple');
  assert.equal(fan.length, 2, 'one routed curve per goal');
  assert.notEqual(fan[0].d, fan[1].d, 'parallel curves take distinct routes');
  fan.forEach((path) => {
    assert.match(path.d, /C /, 'agreement curves are routed cubics');
    assert.equal(path.arrowhead, true);
  });

  const cyclicPlan = compileRelationRenderPlan([
    stage([{ relation: 'CyclicAgree', anchors: { probe: 'a_ms', goal: 'b_ms' }, values: { cycle: '1' } }], forest()),
    stage([{ relation: 'CyclicAgree', anchors: { probe: 'a_ms', goal: 'c_ms' }, values: { cycle: '2' } }], forest())
  ]);
  // Keine–Dash cycles accumulate: frame 1 shows both ordered probing paths.
  assert.equal(cyclicPlan.frames[1].items.filter((item) => item.kind === 'directed-path').length, 2);
  const boundCycles = bindRelationPlanFrame(cyclicPlan, 1, provider);
  const cycleBadges = boundCycles.primitives
    .filter((p) => p.type === 'shape-path' && p.shapeStyle === 'agree-cyclic')
    .map((p) => p.badge?.text);
  assert.deepEqual(cycleBadges, ['1', '2'], 'each cycle keeps its authored numeral');
});

test('Feature Sharing binds as the accepted vine geometry converging beneath the bearers', () => {
  const bound = bindSingle({
    relation: 'FeatureSharing',
    anchors: { bearers: ['a_ms', 'b_ms', 'c_ms'] },
    values: { feature: 'φ', value: '□' }
  });
  const vines = bound.primitives.filter((p) => p.type === 'shape-path' && p.shapeStyle === 'feature-sharing-vine');
  assert.equal(vines.length, 3, 'one vine per bearer');
  vines.forEach((vine) => assert.match(vine.d, /C /, 'vines are cubics'));
});

test('Case assignment composes the solid Case path with quieter dotted Agree collections', () => {
  const plan = compileRelationRenderPlan([stage([
    { relation: 'CaseAssignment', anchors: { assigner: 'a_ms', bearer: 'b_ms' }, values: { feature: 'Case', value: 'NOM' } },
    { relation: 'Agree', anchors: { probe: 'b_ms', goal: 'c_ms' }, values: { feature: 'φ', value: '3SG' } }
  ], forest())]);
  const bound = bindRelationPlanFrame(plan, 0, provider);
  const solid = bound.primitives.find((p) => p.type === 'shape-path' && p.shapeStyle === 'case-assignment');
  const dotted = bound.primitives.find((p) => p.type === 'shape-path' && p.shapeStyle === 'case-agree');
  assert.ok(solid && dotted);
  assert.equal(solid.stroke, 'solid');
  assert.equal(solid.arrowhead, true);
  assert.equal(dotted.stroke, 'dotted');
  assert.equal(dotted.arrowhead, false);
});

test('the unknown fallback stays neutral: undirected, arrowless, and unchanged by the shape pass', () => {
  const plan = compileRelationRenderPlan([stage([
    { relation: 'CompletelyOpenThing', anchors: { one: 'a_ms', two: 'b_ms' } }
  ], forest())]);
  const bound = bindRelationPlanFrame(plan, 0, provider);
  assert.ok(bound.primitives.some((p) => p.type === 'segment' && p.directed === false));
  assert.equal(bound.primitives.filter((p) => p.type === 'shape-path').length, 0,
    'no specialized shape is invented for an open name');
  const rendered = JSON.stringify(bound.primitives);
  assert.ok(!rendered.includes('CompletelyOpenThing'));
});

test('Cooper storage keeps simultaneous ledgers within a stage and replaces the prior stage atomically', () => {
  const twoScopeForest = forest();
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'CooperStorage', anchors: { scope: 'dom_ms', quantifier: 'a_ms' }, values: { category: 'VP', qstore: ['⟨every book⟩'] } },
      { relation: 'CooperStorage', anchors: { scope: 'root_ms', quantifier: 'b_ms' }, values: { category: 'S', qstore: ['⟨every book⟩', '⟨a student⟩'] } }
    ], twoScopeForest),
    stage([
      { relation: 'CooperStorage', anchors: { scope: 'root_ms', quantifier: 'b_ms' }, values: { category: 'S', qstore: [], retrieved: ['⟨every book⟩', '⟨a student⟩'] } }
    ], twoScopeForest)
  ]);
  const frameZero = plan.frames[0].items.filter((item) => item.kind === 'node-plaque');
  assert.equal(frameZero.length, 2, 'distinct VP and S scopes coexist in the earlier frame');
  const frameOne = visiblePlanFrameItems(plan, 1, null)
    .filter((item) => item.kind === 'node-plaque');
  assert.equal(frameOne.length, 1);
  const sPlaques = frameOne.filter((item) => item.anchorNodeIds[0] === 'root_ms');
  assert.equal(sPlaques.length, 1);
  assert.deepEqual(
    sPlaques[0].rows.filter((row) => row.label === 'retrieved').map((row) => row.value),
    ['⟨every book⟩', '⟨a student⟩'],
    'the surviving S plaque is the later state'
  );
  assert.equal(frameOne.some((item) => item.anchorNodeIds[0] === 'dom_ms'), false,
    'the later Cooper-storage state replaces the prior stage as one semantic ledger');
});

test('plates sharing one anchor stack without overlapping', () => {
  const plan = compileRelationRenderPlan([stage([
    { relation: 'FeatureBundle', anchors: { bearer: 'a_ms' }, values: { Case: 'NOM' } },
    { relation: 'Impoverishment', anchors: { terminal: 'a_ms' }, values: { featureHierarchy: ['π', 'PART'], delinkAfter: 'π' } }
  ], forest())]);
  const bound = bindRelationPlanFrame(plan, 0, provider);
  const plaques = bound.primitives.filter((p) => p.type === 'plaque');
  assert.equal(plaques.length, 2);
  assert.notEqual(plaques[0].y, plaques[1].y, 'same-anchor plates stack instead of overlapping');
});

test('measured feature plaques preserve the first placement and stack later collisions downward', () => {
  const first = { x: 120, y: 120, width: 360, height: 138 };
  assert.deepEqual(placeRectBelowCollisions(first, []), first);
  assert.deepEqual(
    placeRectBelowCollisions(first, [first]),
    { ...first, y: 272 }
  );
});

test('measured PF plates keep the first placement and allocate later same-anchor plates', () => {
  const preferred = { x: 120, y: 120, width: 180, height: 80 };
  const viewport = { x: 0, y: 0, width: 640, height: 480 };
  assert.deepEqual(
    placeStackedRect(preferred, [], viewport),
    preferred,
    'the canonical single-plate placement is unchanged'
  );

  const second = placeStackedRect(preferred, [preferred], viewport);
  assert.deepEqual(second, { x: 120, y: 218, width: 180, height: 80 });

  const third = placeStackedRect(preferred, [preferred, second], viewport);
  assert.deepEqual(third, { x: 120, y: 316, width: 180, height: 80 });
});

test('a licensing feature and ellipsis domain use the ordinary plaque and ghost primitives', () => {
  const plaque = bindSingle({
    relation: 'FeatureBundle',
    anchors: { licensor: 'b_ms' },
    values: { feature: '[E]' }
  });
  assert.ok(plaque.primitives.some(
    (primitive) => primitive.type === 'plaque'
      && primitive.plaqueStyle === 'feature'
      && primitive.rows.some((row) => row.value === '[E]')
  ));

  const ellipsis = bindSingle({
    relation: 'Ellipsis',
    anchors: { domain: 'dom_ms' }
  });
  assert.ok(ellipsis.primitives.some((primitive) => primitive.type === 'ghost-set'));
  assert.equal(ellipsis.primitives.some((primitive) => primitive.type === 'shape-path'), false);
});

test('Transfer/PIC binds as the Fong plate: two tilted component arcs, the Phase-edge outline, no shading', () => {
  const plan = compileRelationRenderPlan([stage([
    { relation: 'Phase', anchors: { phase: 'dom_ms', edge: 'in_a_ms' } },
    { relation: 'TransferDomain', anchors: { phase: 'dom_ms', edge: 'in_a_ms', spellOutDomain: 'in_b_ms' } }
  ], forest())]);
  // The composition owns the phase presentation: the plain phase arc for the
  // same phase head is suppressed rather than double-drawn.
  const bound = bindRelationPlanFrame(plan, 0, provider);
  const componentArcs = bound.primitives.filter(
    (p) => p.type === 'shape-path' && p.shapeStyle === 'fong-component-arc'
  );
  assert.equal(componentArcs.length, 2, 'one tilted arc per component (Phase and SOD)');
  componentArcs.forEach((arc) => {
    assert.match(arc.d, /C /, 'the Fong component arc is the tilted cubic');
    assert.equal(arc.arrowhead, false);
  });
  assert.deepEqual(componentArcs.map((arc) => arc.label).sort(), ['Phase', 'SOD']);
  const edgeOutline = bound.primitives.find(
    (p) => p.type === 'domain-region' && p.domainStyle === 'transfer-edge'
  );
  assert.ok(edgeOutline, 'the Phase-edge outline box draws');
  assert.equal(edgeOutline.label, 'Phase edge');
  assert.equal(
    bound.primitives.filter((p) => p.type === 'domain-region' && p.domainStyle === 'transfer-spellout').length,
    0,
    'no shaded stand-in region survives'
  );
  assert.equal(
    bound.primitives.filter((p) => p.type === 'shape-path' && p.shapeStyle === 'phase-arc').length,
    0,
    'the plain phase arc is suppressed when Transfer owns the phase'
  );

  // A Phase on a different node in the same stage still draws its own arc.
  const independent = compileRelationRenderPlan([stage([
    { relation: 'Phase', anchors: { phase: 'a_ms' } },
    { relation: 'TransferDomain', anchors: { phase: 'dom_ms', edge: 'in_a_ms', spellOutDomain: 'in_b_ms' } }
  ], forest())]);
  const boundIndependent = bindRelationPlanFrame(independent, 0, provider);
  assert.equal(
    boundIndependent.primitives.filter((p) => p.type === 'shape-path' && p.shapeStyle === 'phase-arc').length,
    1
  );
});

test('blocked post-Transfer access binds as the dashed orthogonal lane with origin dot and ✗', () => {
  const bound = bindSingle({
    relation: 'PostTransferAccess',
    anchors: { source: 'a_ms', target: 'in_b_ms', spellOutDomain: 'in_b_ms' },
    values: { outcome: 'blocked' }
  });
  const lane = bound.primitives.find((p) => p.type === 'shape-path' && p.shapeStyle === 'transfer-access');
  assert.ok(lane);
  assert.match(lane.d, /^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ L [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/,
    'the access attempt runs as the orthogonal lane');
  assert.equal(lane.stroke, 'dashed');
  assert.equal(lane.arrowhead, false);
  assert.ok(lane.originDot, 'the attempt starts at the origin circle');
  assert.equal(lane.tip?.kind, 'cross', 'the ✗ sits on the lane');
});

test('the Phillips island marks are path-following circles and squares with the double-slashed blocked edge', () => {
  const island = {
    relation: 'ParasiticGap',
    anchors: {
      filler: 'a_ms', realGap: 'src_ms', traceWitness: 'w_ms', parasiticGap: 'b_ms',
      primaryPath: ['a_ms', 'b_ms', 'c_ms'],
      secondaryPath: ['d_ms', 'in_a_ms'],
      blockedEdge: 'in_b_ms'
    },
    values: { outcome: 'blocked' }
  };
  const plan = compileRelationRenderPlan([stage([island], forest())]);
  const parentAwareProvider = (nodeId, attachment = 'position') => {
    if (attachment === 'parent') {
      // The blocked edge's branch runs from dom_ms down to in_b_ms.
      return nodeId === 'in_b_ms' ? gridPositions.get('dom_ms') || null : null;
    }
    return gridPositions.get(nodeId) || null;
  };
  const bound = bindRelationPlanFrame(plan, 0, parentAwareProvider);
  const rings = bound.primitives.filter((p) => p.type === 'path-node-ring');
  const primaries = rings.filter((ring) => ring.role === 'primary');
  const secondaries = rings.filter((ring) => ring.role === 'secondary');
  assert.equal(primaries.length, 3);
  assert.equal(secondaries.length, 2);
  primaries.forEach((ring) => {
    assert.ok(ring.ellipse, 'primary marks are ellipses');
    const centre = gridPositions.get(ring.nodeId);
    assert.equal(ring.ellipse.cx, centre.x, 'the circle follows the node label, not an offset badge row');
    assert.equal(ring.ellipse.cy, centre.y);
  });
  secondaries.forEach((ring) => {
    assert.ok(ring.rect, 'secondary marks are squares');
    const centre = gridPositions.get(ring.nodeId);
    assert.equal(ring.rect.x + ring.rect.width / 2, centre.x);
  });
  const slashes = bound.primitives.filter((p) => p.type === 'shape-path' && p.shapeStyle === 'blocked-edge-slash');
  assert.equal(slashes.length, 2, 'the blocked edge takes exactly the double slash');

  // Binding is atomic per item: the blocked-edge slash is part of the
  // island mark's complete authored claim, so unmeasurable branch geometry
  // fails the WHOLE mark closed — rings without the blocking judgment
  // would be a partial visual assertion.
  const noParentProvider = (nodeId, attachment = 'position') =>
    (attachment === 'parent' ? null : gridPositions.get(nodeId) || null);
  const noParent = bindRelationPlanFrame(plan, 0, noParentProvider);
  assert.equal(noParent.primitives.filter((p) => p.itemIndex === 0).length, 0,
    'no partial island mark survives its unmeasurable blocked edge');
  assert.ok(noParent.failed.some((f) => f.nodeId === 'in_b_ms' && /slash fails closed/.test(f.reason)));

  // A degenerate branch — parent coinciding with the child — has no
  // measurable direction and fails the mark closed the same way.
  const degenerateProvider = (nodeId, attachment = 'position') => gridPositions.get(nodeId) || null;
  const degenerate = bindRelationPlanFrame(plan, 0, degenerateProvider);
  assert.equal(degenerate.primitives.filter((p) => p.itemIndex === 0).length, 0);
  assert.ok(degenerate.failed.some((f) => f.nodeId === 'in_b_ms' && /slash fails closed/.test(f.reason)));
});

test('analysis verdict geometry keeps the complete compound outside its tree', () => {
  const treeRect = { x: 100, y: 40, width: 240, height: 180 };
  const compoundRect = { x: -2, y: -18, width: 84, height: 36 };
  const origin = analysisVerdictCompoundOrigin(treeRect, compoundRect, 130);
  assert.equal(origin.x + compoundRect.x + compoundRect.width, treeRect.x - 24);
  assert.equal(origin.y + compoundRect.y + compoundRect.height / 2, 130);
  for (const initialCameraScale of [0.05, 0.1, 0.25, 1, 4]) {
    const localScale = analysisVerdictInitialLocalScale(initialCameraScale);
    assert.ok(Math.abs(localScale * initialCameraScale * 160 - 28) < 1e-9);
  }

  const anchors = [
    { analysisNodeId: 'later', desiredY: 110, order: 1 },
    { analysisNodeId: 'earlier', desiredY: 100, order: 0 }
  ];
  const rows = planAnalysisVerdictRows(anchors);
  assert.deepEqual(
    rows.map(({ analysisNodeId, y }) => ({ analysisNodeId, y })),
    [
      { analysisNodeId: 'earlier', y: 100 },
      { analysisNodeId: 'later', y: 290 }
    ],
    'each row keeps its authored anchor identity while close verdicts de-collide'
  );
  assert.deepEqual(
    anchors.map(({ analysisNodeId }) => analysisNodeId),
    ['later', 'earlier'],
    'planning must not mutate authored verdict order'
  );
});
