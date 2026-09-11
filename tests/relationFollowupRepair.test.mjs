import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileRelationRenderPlan,
  visiblePlanFrameItems
} from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';

const leaf = (id, label, word, extra = {}) => ({ id, label, ...(word ? { word } : {}), ...extra });
const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });
const stage = (relations, forest) => ({
  statement: 'A derivational state holds.',
  stageRecord: 'A record of the derivational state, long enough to be substantive prose.',
  relations: relations,
  workspaceForest: forest
});

const wideForest = () => [node('root_fu', 'TP', [
  node('a_fu', 'AP', [leaf('a_fu_l', 'A', 'a')]),
  node('b_fu', 'BP', [leaf('b_fu_l', 'B', 'b')]),
  node('c_fu', 'CPx', [leaf('c_fu_l', 'C', 'c')]),
  node('d_fu', 'DPx', [leaf('d_fu_l', 'D', 'd')]),
  node('e_fu', 'EP', [leaf('e_fu_l', 'E', 'e')]),
  node('f_fu', 'FP', [leaf('f_fu_l', 'F', 'f')])
])];

/* ------------------------------------------------------------------ *
 * Defect 1: CyclicAgree never invents a cycle number.
 * ------------------------------------------------------------------ */

test('CyclicAgree draws no cycle numeral unless the model authored one, whatever precedes it', () => {
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'Coreference', anchors: { first: 'e_fu', second: 'f_fu' } },
      { relation: 'Coreference', anchors: { first: 'a_fu', second: 'e_fu' } },
      { relation: 'Coreference', anchors: { first: 'b_fu', second: 'f_fu' } },
      { relation: 'CyclicAgree', anchors: { probe: 'a_fu', goal: 'b_fu' } },
      { relation: 'CyclicAgree', anchors: { probe: 'a_fu', goal: 'c_fu' }, values: { cycle: '2' } }
    ], wideForest())
  ]);
  const paths = plan.frames[0].items.filter((item) => item.pathStyle === 'agree-cyclic');
  assert.equal(paths.length, 2);
  assert.equal(paths[0].label, undefined,
    'the relation list position (index 3) never becomes a cycle numeral');
  assert.equal(paths[1].label, '2', 'the authored cycle renders verbatim');
});

/* ------------------------------------------------------------------ *
 * Defect 2: independent repeated instances never replace each other.
 * ------------------------------------------------------------------ */

test('two independent DependentCase sequences coexist; only a same-participant restatement replaces', () => {
  const forest = wideForest();
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'DependentCase', anchors: { probe: 'a_fu', goal: 'b_fu' }, values: { goalLabel: 'ACC' } },
      { relation: 'DependentCase', anchors: { probe: 'c_fu', goal: 'd_fu' }, values: { goalLabel: 'DAT' } }
    ], forest),
    stage([
      { relation: 'DependentCase', anchors: { probe: 'a_fu', goal: 'b_fu' }, values: { goalLabel: 'ERG' } }
    ], forest)
  ]);
  const frameZero = plan.frames[0].items.filter((item) => item.pathStyle === 'dependent-case');
  assert.equal(frameZero.length, 2, 'independent same-name instances coexist in one stage');
  const frameOne = visiblePlanFrameItems(plan, 1, null)
    .filter((item) => item.pathStyle === 'dependent-case');
  assert.equal(frameOne.length, 2, 'the unrelated c/d claim persists untouched');
  const abClaims = frameOne.filter((item) => item.fromNodeId === 'a_fu');
  assert.equal(abClaims.length, 1, 'the same-participant restatement replaced its own thread only');
  assert.equal(abClaims[0].secondaryLabel, 'ERG');
  assert.ok(frameOne.some((item) => item.fromNodeId === 'c_fu' && item.secondaryLabel === 'DAT'));
});

test('two independent CyclicLinearization domains coexist across stages', () => {
  const forest = wideForest();
  const plan = compileRelationRenderPlan([
    stage([], forest),
    stage([
      { relation: 'CyclicLinearization', anchors: { order: ['a_fu', 'b_fu'] }, priorAnchors: { order: ['a_fu', 'b_fu'] }, values: { outcome: 'licensed' } }
    ], forest),
    stage([
      { relation: 'CyclicLinearization', anchors: { order: ['c_fu', 'd_fu'] }, priorAnchors: { order: ['c_fu', 'd_fu'] }, values: { outcome: 'licensed' } }
    ], forest)
  ]);
  const frameOne = plan.frames[2].items.filter((item) => item.kind === 'node-plaque');
  assert.equal(frameOne.length, 2,
    'a later unrelated domain never erases an earlier one; replacement needs a provable thread');
});

test('a changed-participant replacement requires authored priorAnchors continuity', () => {
  const forest = wideForest();
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'DependentCase', anchors: { probe: 'a_fu', goal: 'b_fu' }, values: { goalLabel: 'UNM' } }
    ], forest),
    stage([
      {
        relation: 'DependentCase',
        anchors: { probe: 'a_fu', goal: 'c_fu' },
        priorAnchors: { probe: 'a_fu', goal: 'b_fu' },
        values: { goalLabel: 'DEP' }
      }
    ], forest)
  ]);
  const claims = visiblePlanFrameItems(plan, 1, null)
    .filter((item) => item.pathStyle === 'dependent-case');
  assert.equal(claims.length, 1);
  assert.equal(claims[0].toNodeId, 'c_fu');
});

/* ------------------------------------------------------------------ *
 * Defect 3: companion Agree paths keep their provenance and timing.
 * ------------------------------------------------------------------ */

test('CaseAssignment companion collection paths carry the companion Agree provenance and Replay timing', () => {
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'CaseAssignment', anchors: { assigner: 'a_fu', bearer: 'b_fu' }, values: { value: 'NOM' } },
      { relation: 'Agree', anchors: { probe: 'b_fu', goal: 'c_fu' }, values: { feature: 'φ' } },
      { relation: 'Agree', anchors: { probe: 'b_fu', goal: 'd_fu' }, values: { feature: 'π' } }
    ], wideForest())
  ]);
  const collectionPaths = plan.frames[0].items.filter((item) => item.pathStyle === 'case-agree');
  assert.equal(collectionPaths.length, 2);
  assert.deepEqual(
    collectionPaths.map((item) => item.relationRef.relation),
    ['Agree', 'Agree'],
    'the dotted collection curve is the companion relation\'s own mark'
  );
  assert.deepEqual(collectionPaths.map((item) => item.relationRef.relationIndex), [1, 2]);

  // Replay timing by exact played identity: after only the CaseAssignment
  // moment, no collection curve is visible; each appears at its own Agree's
  // moment.
  const afterCase = visiblePlanFrameItems(plan, 0, new Set([0]));
  assert.ok(afterCase.some((item) => item.pathStyle === 'case-assignment'));
  assert.equal(afterCase.filter((item) => item.pathStyle === 'case-agree').length, 0,
    'an Agree collection curve never appears before its own authored Agree moment');
  const afterFirstAgree = visiblePlanFrameItems(plan, 0, new Set([0, 1]));
  assert.equal(afterFirstAgree.filter((item) => item.pathStyle === 'case-agree').length, 1);
  const afterAll = visiblePlanFrameItems(plan, 0, new Set([0, 1, 2]));
  assert.equal(afterAll.filter((item) => item.pathStyle === 'case-agree').length, 2);
});

/* ------------------------------------------------------------------ *
 * Defect 4: PF ownership is provable, never first-win.
 * ------------------------------------------------------------------ */

test('an insertion whose target two PF packages share stays standalone with an ambiguity diagnostic', () => {
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'PFRealization', anchors: { root: 'a_fu', tense: 'c_fu' } },
      { relation: 'PFRealization', anchors: { root: 'b_fu', tense: 'c_fu' } },
      { relation: 'VocabularyInsertion', anchors: { terminal: 'c_fu' }, values: { input: 'T', output: '-ed' } },
      { relation: 'VocabularyInsertion', anchors: { terminal: 'a_fu' }, values: { input: '√A', output: 'a' } }
    ], wideForest())
  ]);
  const plates = plan.frames[0].items.filter((item) => item.kind === 'node-plaque');
  const shared = plates.find((plate) =>
    plate.relationRef.relation === 'VocabularyInsertion' && plate.anchorNodeIds.includes('c_fu'));
  assert.ok(shared, 'the ambiguous insertion keeps its own standalone plate');
  assert.deepEqual(shared.rows, [{ label: 'T', value: '-ed' }]);
  const packagePlates = plates.filter((plate) => plate.relationRef.relation === 'PFRealization');
  assert.ok(packagePlates.every((plate) => !plate.rows.some((row) => row.value === '-ed')),
    'neither package silently absorbed the shared row');
  assert.ok(plan.diagnostics.some((d) => d.kind === 'ambiguous-package-ownership'));
  // The unambiguous insertion still joins its unique package.
  const packageA = packagePlates.find((plate) => plate.anchorNodeIds.includes('a_fu'));
  assert.ok(packageA.rows.some((row) => row.value === 'a'));
});

/* ------------------------------------------------------------------ *
 * Defect 5: chain identity claims only what authored data proves.
 * ------------------------------------------------------------------ */

test('a no-lineage chain keeps its identity under anchor-array reordering, and unrelated chains stay distinct', () => {
  const forest = wideForest();
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'Identity', anchors: { occurrences: ['a_fu', 'b_fu'] } },
      { relation: 'Identity', anchors: { occurrences: ['c_fu', 'd_fu'] } }
    ], forest),
    stage([
      { relation: 'Identity', anchors: { occurrences: ['b_fu', 'a_fu'] } }
    ], forest)
  ]);
  const first = plan.frames[0].items.find((item) =>
    item.kind === 'coindex' && item.nodeIds.includes('a_fu'));
  const other = plan.frames[0].items.find((item) =>
    item.kind === 'coindex' && item.nodeIds.includes('c_fu'));
  const reordered = plan.frames[1].items.find((item) =>
    item.kind === 'coindex' && item.nodeIds.includes('a_fu') && item.appearsAtStage === 1);
  assert.equal(reordered.index, first.index,
    'reordering the anchor array does not renumber the same participant set');
  assert.notEqual(other.index, first.index, 'unrelated no-lineage chains are never merged');
});

/* ------------------------------------------------------------------ *
 * Defect 6: geometry-aware routing.
 * ------------------------------------------------------------------ */

const positionsOf = (entries) => {
  const map = new Map(entries);
  return (nodeId) => map.get(nodeId) || null;
};

test('coincident same-style paths route apart; far-apart same-style paths stay unshifted', () => {
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'CyclicAgree', anchors: { probe: 'a_fu', goal: 'b_fu' }, values: { cycle: '1' } },
      { relation: 'CyclicAgree', anchors: { probe: 'a_fu', goal: 'b_fu' }, values: { cycle: '2' } },
      { relation: 'CyclicAgree', anchors: { probe: 'e_fu', goal: 'f_fu' }, values: { cycle: '1' } }
    ], wideForest())
  ]);
  const bound = bindRelationPlanFrame(plan, 0, positionsOf([
    ['a_fu', { x: 100, y: 100 }], ['b_fu', { x: 300, y: 100 }],
    ['e_fu', { x: 3000, y: 100 }], ['f_fu', { x: 3200, y: 100 }]
  ]));
  const curves = bound.primitives.filter((p) => p.type === 'shape-path' && p.shapeStyle === 'agree-cyclic');
  assert.equal(curves.length, 3);
  assert.notEqual(curves[0].d, curves[1].d, 'coincident distinct claims take distinct routes');
  // The far-away pair is isolated: it keeps exactly the geometry it gets
  // when bound alone — never shifted by unrelated routing elsewhere.
  const solo = compileRelationRenderPlan([
    stage([{ relation: 'CyclicAgree', anchors: { probe: 'e_fu', goal: 'f_fu' }, values: { cycle: '1' } }], wideForest())
  ]);
  const soloBound = bindRelationPlanFrame(solo, 0, positionsOf([
    ['e_fu', { x: 3000, y: 100 }], ['f_fu', { x: 3200, y: 100 }]
  ]));
  assert.equal(
    curves[2].d,
    soloBound.primitives.find((p) => p.shapeStyle === 'agree-cyclic').d,
    'a far-apart path is never shifted by unrelated routing elsewhere'
  );
});

test('intersecting different-style paths route apart instead of overlapping blindly', () => {
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'Control', anchors: { controller: 'a_fu', controllee: 'b_fu', domain: 'root_fu' } },
      { relation: 'FProjection', anchors: { accentBearer: 'a_fu', projections: ['root_fu'] } }
    ], wideForest())
  ]);
  const bound = bindRelationPlanFrame(plan, 0, positionsOf([
    ['a_fu', { x: 100, y: 100 }], ['b_fu', { x: 300, y: 100 }],
    ['root_fu', { x: 300, y: 100 }]
  ]));
  const control = bound.primitives.find((p) => p.shapeStyle === 'control');
  const focus = bound.primitives.find((p) => p.shapeStyle === 'f-projection');
  assert.ok(control && focus);
  const bellyOf = (d) => Number(d.split(',')[0].split(' ').at(-1));
  assert.notEqual(bellyOf(control.d), bellyOf(focus.d),
    'two same-route curves of different styles no longer share one belly');
});

test('a post-fit path and plaque both survive without rewriting each other', () => {
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'FeatureBundle', anchors: { bearer: 'c_fu' }, values: { Case: 'NOM', Num: 'SG' } },
      { relation: 'Control', anchors: { controller: 'a_fu', controllee: 'b_fu', domain: 'root_fu' } }
    ], wideForest())
  ]);
  // The plate hangs below c_fu, which sits midway along the a→b chord.
  const bound = bindRelationPlanFrame(plan, 0, positionsOf([
    ['a_fu', { x: 100, y: 100 }], ['b_fu', { x: 500, y: 100 }],
    ['c_fu', { x: 300, y: 120 }]
  ]));
  const control = bound.primitives.find((p) => p.shapeStyle === 'control');
  const plaque = bound.primitives.find((p) => p.type === 'plaque');
  assert.ok(control && plaque, 'both authored marks survive');
  const baseline = bindRelationPlanFrame(
    compileRelationRenderPlan([
      stage([{ relation: 'Control', anchors: { controller: 'a_fu', controllee: 'b_fu', domain: 'root_fu' } }], wideForest())
    ]),
    0,
    positionsOf([['a_fu', { x: 100, y: 100 }], ['b_fu', { x: 500, y: 100 }]])
  ).primitives.find((p) => p.shapeStyle === 'control');
  assert.equal(control.d, baseline.d,
    'a post-fit plaque cannot change the accepted source-backed path geometry');
});

test('screen-stable feature plaques keep independent identities and path labels keep separate lanes', () => {
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'FeatureBundle', anchors: { bearer: 'a_fu' }, values: { Case: 'NOM' } },
      { relation: 'FeatureBundle', anchors: { bearer: 'a_fu' }, values: { Number: 'SG' } },
      { relation: 'CyclicAgree', anchors: { probe: 'b_fu', goal: 'c_fu' }, values: { cycle: '1' } },
      { relation: 'CyclicAgree', anchors: { probe: 'b_fu', goal: 'c_fu' }, values: { cycle: '2' } }
    ], wideForest())
  ]);
  const bound = bindRelationPlanFrame(plan, 0, positionsOf([
    ['a_fu', { x: 100, y: 100 }],
    ['b_fu', { x: 200, y: 100 }],
    ['c_fu', { x: 400, y: 100 }]
  ]), { markerScale: 3 });
  const plates = bound.primitives.filter((primitive) => primitive.type === 'plaque');
  assert.equal(plates.length, 2);
  assert.notEqual(plates[0].itemIndex, plates[1].itemIndex,
    'the specialized feature painter receives both exact authored plaque identities');
  const labels = bound.primitives
    .filter((primitive) => primitive.type === 'shape-path' && primitive.labelAt)
    .map((primitive) => primitive.labelAt.y);
  assert.equal(new Set(labels).size, labels.length, 'coincident path labels take separate lanes');
});

/* ------------------------------------------------------------------ *
 * Defect 7: no invented plaques.
 * ------------------------------------------------------------------ */

test('Agree with only probe/goal draws its registered goal mark and no empty plaque', () => {
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'Agree', anchors: { probe: 'a_fu', goal: 'b_fu' } },
      { relation: 'FeatureBundle', anchors: { bearer: 'a_fu' }, values: { Case: 'NOM' } }
    ], wideForest())
  ]);
  const plaques = plan.frames[0].items.filter((item) => item.kind === 'node-plaque');
  assert.equal(plaques.length, 1, 'only the FeatureBundle with authored rows gets a plaque');
  assert.equal(plaques[0].title, 'AP bearer',
    'the accepted feature plaque identifies the category and authored bearer role');
  assert.deepEqual(plaques[0].rows, [{ label: 'Case', value: 'NOM' }]);
  const agreeMark = plan.frames[0].items.find((item) =>
    item.kind === 'node-badges' && item.relationRef.relation === 'Agree');
  assert.ok(agreeMark, 'the valueless registered Agree relation keeps its sourced goal mark');
  assert.deepEqual(agreeMark.badges.map((badge) => badge.nodeId), ['b_fu']);
});

/* ------------------------------------------------------------------ *
 * Found during browser QA: a stage with no structural change still
 * gives every authored relation its own Replay moment.
 * ------------------------------------------------------------------ */

test('a relations-only stage (unchanged forest) still yields one Replay moment per authored relation', async () => {
  const { adaptDerivationStagesForReplay, buildPlaybackStepsFromDerivationFrames } =
    await import('../replay/replayCompiler.ts');
  const { buildDerivationReplayPlan } = await import('../derivationReplayPlan.js');
  const forest = wideForest();
  const stages = [
    stage([], forest),
    stage([
      { relation: 'CyclicAgree', anchors: { probe: 'a_fu', goal: 'b_fu' } },
      { relation: 'CaseAssignment', anchors: { assigner: 'c_fu', bearer: 'd_fu' }, values: { value: 'ACC' } },
      { relation: 'UnknownTie', anchors: { first: 'e_fu', second: 'f_fu' } }
    ], forest)
  ];
  const frames = adaptDerivationStagesForReplay(stages);
  const plan = buildDerivationReplayPlan({ derivationStages: stages });
  const steps = buildPlaybackStepsFromDerivationFrames(frames, undefined, plan);
  const relationSteps = steps.filter((step) => step.replayKind === 'relation');
  assert.deepEqual(
    relationSteps.map((step) => step.operation),
    ['CyclicAgree', 'CaseAssignment', 'UnknownTie'],
    'no authored relation moment is dropped or collapsed by the visibility passes'
  );
  const visibleCounts = relationSteps.map((step) => (step.replayVisibleNodeIds || []).length);
  assert.ok(
    visibleCounts.every((count) => count === visibleCounts[0] && count > 0),
    'a relation moment never changes which material is structurally visible'
  );
});
