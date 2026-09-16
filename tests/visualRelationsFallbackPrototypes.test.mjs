import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CONCORD_RELATION,
  CROSSOVER_RELATION,
  CROSSOVER_TREE_BEFORE,
  DISJOINT_RELATION,
  EXPLETIVE_RELATION,
  FALLBACK_PROTOTYPE_CARDS,
  FALLBACK_PROTOTYPE_RELATIONS,
  RESPECTIVE_RELATION,
  SPURIOUS_SE_RELATION,
  fallbackDrawing
} from '../docs/design/visual-relations-fallback-prototypes-data.ts';
import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';
import {
  adaptDerivationStagesForReplay,
  buildPlaybackStepsFromDerivationFrames,
  stepRepresentsMovement
} from '../replay/replayCompiler.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import {
  ACTIVE_VISUAL_DESIGNS,
  RECOGNIZED_RELATIONS,
  SOURCE_BACKED_UNFROZEN_DESIGNS,
  toRendererStages,
  unregisteredRelationNames,
  validateLabRelations
} from '../docs/design/visual-relations-lab-adapter.ts';
import {
  VISUAL_RELATIONS_FIXTURE_COVERAGE,
  summarizeVisualRelationsFixtureCoverage
} from '../docs/design/visual-relations-coverage-matrix.ts';

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

const witnesses = (drawing) => drawing.marks.map((mark) => mark.witness);

const findNode = (root, nodeId) => {
  if (!root) return null;
  if (root.id === nodeId) return root;
  for (const child of root.children || []) {
    const found = findNode(child, nodeId);
    if (found) return found;
  }
  return null;
};

const findParent = (root, nodeId) => {
  if (!root) return null;
  if ((root.children || []).some((child) => child.id === nodeId)) return root;
  for (const child of root.children || []) {
    const found = findParent(child, nodeId);
    if (found) return found;
  }
  return null;
};

const playback = (card) => buildPlaybackStepsFromDerivationFrames(
  adaptDerivationStagesForReplay(card.derivationStages),
  card.sentence,
  buildDerivationReplayPlan({ derivationStages: card.derivationStages })
);

const playbackFromStages = (derivationStages, sentence = '') =>
  buildPlaybackStepsFromDerivationFrames(
    adaptDerivationStagesForReplay(derivationStages),
    sentence,
    buildDerivationReplayPlan({ derivationStages })
  );

test('every prototype relation is genuinely unregistered', () => {
  const registered = new Set([
    ...Object.values(RECOGNIZED_RELATIONS).flat(),
    ...Object.values(ACTIVE_VISUAL_DESIGNS).flat(),
    ...Object.values(SOURCE_BACKED_UNFROZEN_DESIGNS).flat()
  ].map((name) => String(name).toLowerCase()));
  FALLBACK_PROTOTYPE_RELATIONS.forEach((relation) => {
    assert.equal(
      registered.has(relation.relation.toLowerCase()),
      false,
      `${relation.relation} must stay unregistered for the prototype`
    );
  });
});

test('every prototype card authors a valid four-field contract', () => {
  FALLBACK_PROTOTYPE_CARDS.forEach((card) => {
    card.derivationStages.forEach((stage) => {
      assert.deepEqual(
        Object.keys(stage).sort(),
        ['relations', 'stageRecord', 'statement', 'workspaceForest']
      );
    });
    const contract = validateLabRelations(card.derivationStages, card.data);
    assert.equal(contract.valid, true, `${card.id}: ${JSON.stringify(contract.issues)}`);
    const stageRelations = card.derivationStages[card.relationStageIndex].relations;
    assert.equal(stageRelations.length, 1, `${card.id} demonstrates exactly one instance`);
    assert.deepEqual(unregisteredRelationNames(card.derivationStages), [stageRelations[0].relation]);
    assert.match(card.status, /ACCEPTED DESIGN/);
    assert.match(card.status, /disposable research fixture/);
  });
});

test('dispatch reads topology only — renaming everything changes nothing', () => {
  const renamed = {
    relation: 'ZZZ',
    anchors: { qqq: 'dp_disj_john', www: 'dp_disj_him' },
    values: { eee: 'rrr' }
  };
  const original = fallbackDrawing(DISJOINT_RELATION);
  const disguised = fallbackDrawing(renamed);
  assert.equal(disguised.row, original.row);
  assert.deepEqual(witnesses(disguised), witnesses(original));
  assert.deepEqual(disguised.link, original.link);
});

test('P1A — one current witness draws the mark and nothing else', () => {
  const drawing = fallbackDrawing(EXPLETIVE_RELATION);
  assert.equal(drawing.row, 1);
  assert.deepEqual(drawing.marks, [{
    instance: 1,
    witness: 'dp_expl_it',
    role: 'expletive',
    position: null,
    group: 0,
    frame: 'circle',
    backward: false
  }]);
  assert.equal(drawing.fan, null);
  assert.equal(drawing.link, null);
});

test('P1B + P3 — two scalars license exactly one undirected link', () => {
  const drawing = fallbackDrawing(DISJOINT_RELATION);
  assert.equal(drawing.row, 2);
  assert.deepEqual(witnesses(drawing), ['dp_disj_john', 'dp_disj_him']);
  assert.deepEqual(drawing.link, {
    endpoints: ['dp_disj_john', 'dp_disj_him'],
    directed: false,
    arrowheads: 0
  });
  assert.equal(drawing.fan, null);
  assert.ok(drawing.marks.every((mark) => mark.position === null && mark.frame === 'circle'));
});

test('values change no geometry', () => {
  const withoutValues = fallbackDrawing({
    relation: DISJOINT_RELATION.relation,
    anchors: DISJOINT_RELATION.anchors
  });
  const withValues = fallbackDrawing(DISJOINT_RELATION);
  assert.deepEqual(withValues, withoutValues);
  const sectionSource = FALLBACK_PROTOTYPE_CARDS.find((card) => card.id === 'p1b');
  assert.ok(sectionSource.derivationStages[1].relations[0].values, 'the card carries authored values');
});

test('P1C + P2 — scalar plus array licenses an ordered fan', () => {
  const drawing = fallbackDrawing(CONCORD_RELATION);
  assert.equal(drawing.row, 3);
  assert.deepEqual(drawing.fan, {
    hub: 'v_conc_helfe',
    spokes: ['d_conc_diesem', 'a_conc_alten', 'n_conc_mann'],
    directed: false,
    arrowheads: 0
  });
  assert.equal(drawing.link, null);
  assert.deepEqual(
    drawing.marks.map((mark) => [mark.witness, mark.position]),
    [
      ['v_conc_helfe', null],
      ['d_conc_diesem', 1],
      ['a_conc_alten', 2],
      ['n_conc_mann', 3]
    ]
  );
});

test('P1D — two equal arrays pair by position and take distinct frames', () => {
  const drawing = fallbackDrawing(RESPECTIVE_RELATION);
  assert.equal(drawing.row, 5);
  assert.equal(drawing.fan, null);
  assert.equal(drawing.link, null);
  assert.deepEqual(
    drawing.marks.map((mark) => [mark.witness, mark.position, mark.frame]),
    [
      ['dp_resp_john', 1, 'circle'],
      ['dp_resp_mary', 2, 'circle'],
      ['dp_resp_book', 1, 'box'],
      ['dp_resp_record', 2, 'box']
    ]
  );
});

test('P1E — closure marks every witness and invents no pairing', () => {
  const drawing = fallbackDrawing(CROSSOVER_RELATION);
  assert.equal(drawing.row, 6);
  assert.deepEqual(witnesses(drawing), ['dp_wco_who', 'dp_wco_his', 'dp_wco_gap']);
  assert.equal(drawing.fan, null);
  assert.equal(drawing.link, null);

  // Unequal arrays also close, rather than pairing what nobody paired.
  const unequal = fallbackDrawing({
    relation: CROSSOVER_RELATION.relation,
    anchors: { a: ['n1', 'n2'], b: ['n3', 'n4', 'n5'] }
  });
  assert.equal(unequal.row, 6);
  assert.equal(unequal.link, null);
  assert.equal(unequal.fan, null);
});

test('P1E base-generates Who and commits the raw trace only on the fallback relation frame', () => {
  const card = FALLBACK_PROTOTYPE_CARDS.find((candidate) => candidate.id === 'p1e');
  assert.ok(card);
  assert.equal(CROSSOVER_TREE_BEFORE.id, 'cbar_wco');
  assert.equal(CROSSOVER_TREE_BEFORE.label, "C'");
  assert.equal(findNode(CROSSOVER_TREE_BEFORE, 'cp_wco'), null);
  assert.equal(findParent(CROSSOVER_TREE_BEFORE, 'dp_wco_who')?.id, 'vp_wco');
  assert.equal(findNode(CROSSOVER_TREE_BEFORE, 'd_wco_gap'), null);
  assert.deepEqual(CROSSOVER_RELATION.priorAnchors, { operator: 'dp_wco_who' });

  const steps = playback(card);
  const relationIndex = steps.findIndex((step) => (
    step.replayKind === 'relation' && step.operation === CROSSOVER_RELATION.relation
  ));
  assert.ok(relationIndex > 0);
  const before = steps[relationIndex - 1];
  const relation = steps[relationIndex];
  const stageOne = steps.filter((step) => step.visualFrameIndex === 0);
  assert.ok(stageOne.length > 0);
  assert.equal(stageOne.some((step) => findNode(step.replayCanvasData, 'cp_wco')), false);
  assert.equal(stageOne.some((step) => (
    step.operation === 'Project' && step.targetNodeId === 'cp_wco'
  )), false);
  assert.equal(findParent(before.replayCanvasData, 'dp_wco_who')?.id, 'vp_wco');
  assert.equal(findNode(before.replayCanvasData, 'd_wco_gap'), null);
  assert.equal(relation.replayCanvasData.id, 'cp_wco');
  assert.equal(findParent(relation.replayCanvasData, 'dp_wco_who')?.id, 'cp_wco');
  assert.equal(findNode(relation.replayCanvasData, 'd_wco_gap')?.word, 't');
  assert.equal(findNode(relation.replayCanvasData, 'd_wco_gap')?.silent, true);
  assert.equal(stepRepresentsMovement(relation), false);

  const renderPlan = compileRelationRenderPlan(card.derivationStages);
  assert.deepEqual(renderPlan.frames[1].items.map((item) => item.kind), ['fallback']);
  assert.equal(renderPlan.frames[1].items[0].relationRef.relation, CROSSOVER_RELATION.relation);

  const stageTwo = steps.filter((step) => step.visualFrameIndex === 1);
  assert.deepEqual(
    stageTwo.map((step) => [step.replayKind, step.operation]),
    [
      ['relation', 'WeakCrossoverConfiguration'],
      ['macro', 'StageRecord']
    ]
  );
});

test('P1F — priorAnchors add the backward cue and never veto the connector', () => {
  const drawing = fallbackDrawing(SPURIOUS_SE_RELATION);
  assert.equal(drawing.row, 2, 'the current shape still decides the drawing');
  assert.deepEqual(drawing.link, {
    endpoints: ['cl_se_se', 'cl_se_lo'],
    directed: false,
    arrowheads: 0
  });
  assert.equal(drawing.backward, true);
  assert.ok(drawing.marks.every((mark) => mark.backward === true));
  assert.deepEqual(drawing.priorWitnesses, ['cl_se_le']);
  // Prior witnesses are never marked in the current frame.
  assert.equal(witnesses(drawing).includes('cl_se_le'), false);

  const withoutPriors = fallbackDrawing({
    relation: SPURIOUS_SE_RELATION.relation,
    anchors: SPURIOUS_SE_RELATION.anchors
  });
  assert.equal(withoutPriors.backward, false);
  assert.deepEqual(withoutPriors.link, drawing.link);
});

test('P1F shows only the authored relation stage, while its earlier stage stays clean', () => {
  const after = FALLBACK_PROTOTYPE_CARDS.find((card) => card.id === 'p1f-after');
  assert.ok(after);
  assert.equal(after.relationStageIndex, 1);
  assert.equal(after.pinnedStageIndex, 1);
  assert.deepEqual(after.derivationStages[0].relations, []);
  assert.deepEqual(after.derivationStages[1].relations, [SPURIOUS_SE_RELATION]);
  assert.equal(FALLBACK_PROTOTYPE_CARDS.some((card) => card.id === 'p1f-before'), false);

  const steps = playback(after);
  const relationIndex = steps.findIndex((step) => (
    step.replayKind === 'relation' && step.operation === SPURIOUS_SE_RELATION.relation
  ));
  assert.ok(relationIndex > 0);
  const before = steps[relationIndex - 1];
  const relation = steps[relationIndex];
  assert.ok(findNode(before.replayCanvasData, 'cl_se_le'));
  assert.equal(findNode(before.replayCanvasData, 'cl_se_se'), null);
  assert.equal(findNode(relation.replayCanvasData, 'cl_se_le'), null);
  assert.ok(findNode(relation.replayCanvasData, 'cl_se_se'));

  const stageTwo = steps.filter((step) => step.visualFrameIndex === 1);
  assert.deepEqual(
    stageTwo.map((step) => [step.replayKind, step.operation]),
    [
      ['relation', 'SpuriousSeExponence'],
      ['macro', 'StageRecord']
    ]
  );
});

test('fallback relation frames reveal only their own anchored tree transition', () => {
  const leaf = (id, word) => ({ id, label: 'X', word });
  const branch = (id, child) => ({ id, label: 'XP', children: [child] });
  const beforeTree = {
    id: 'root_scoped',
    label: 'Root',
    children: [
      branch('left_scoped', leaf('left_before', 'left-before')),
      branch('right_scoped', leaf('right_before', 'right-before'))
    ]
  };
  const afterTree = {
    id: 'root_scoped',
    label: 'Root',
    children: [
      branch('left_scoped', leaf('left_after', 'left-after')),
      branch('right_scoped', leaf('right_after', 'right-after')),
      branch('unowned_scoped', leaf('unowned_after', 'unowned-after'))
    ]
  };
  const derivationStages = [
    {
      statement: 'Base state.',
      stageRecord: 'Both original witnesses are present.',
      relations: [],
      workspaceForest: [beforeTree]
    },
    {
      statement: 'Two fallback transitions are authored.',
      stageRecord: 'An unrelated raw addition is also present in the final stage forest.',
      relations: [
        {
          relation: 'ScopedFallbackLeft',
          anchors: { output: 'left_after' },
          priorAnchors: { input: 'left_before' }
        },
        {
          relation: 'ScopedFallbackRight',
          anchors: { output: 'right_after' },
          priorAnchors: { input: 'right_before' }
        }
      ],
      workspaceForest: [afterTree]
    }
  ];

  const steps = playbackFromStages(derivationStages);
  const leftStep = steps.find((step) => step.replayKind === 'relation' && step.operation === 'ScopedFallbackLeft');
  const rightStep = steps.find((step) => step.replayKind === 'relation' && step.operation === 'ScopedFallbackRight');
  const macroStep = steps.find((step) => step.visualFrameIndex === 1 && step.replayKind === 'macro');
  assert.ok(leftStep);
  assert.ok(rightStep);
  assert.ok(macroStep);

  assert.ok(findNode(leftStep.replayCanvasData, 'left_after'));
  assert.equal(findNode(leftStep.replayCanvasData, 'left_before'), null);
  assert.ok(findNode(leftStep.replayCanvasData, 'right_before'));
  assert.equal(findNode(leftStep.replayCanvasData, 'right_after'), null);
  assert.equal(leftStep.replayVisibleNodeIds.includes('unowned_after'), false);

  assert.ok(findNode(rightStep.replayCanvasData, 'left_after'));
  assert.ok(findNode(rightStep.replayCanvasData, 'right_after'));
  assert.equal(findNode(rightStep.replayCanvasData, 'right_before'), null);
  assert.equal(rightStep.replayVisibleNodeIds.includes('unowned_after'), false);

  assert.ok(macroStep.replayVisibleNodeIds.includes('unowned_after'));
});

test('fallback transition creates a required new parent atomically with its output', () => {
  const derivationStages = [
    {
      statement: 'Base state.',
      stageRecord: 'The prior witness is complete.',
      relations: [],
      workspaceForest: [{
        id: 'root_parent_guard',
        label: 'Root',
        children: [{ id: 'guard_before', label: 'X', word: 'before' }]
      }]
    },
    {
      statement: 'A new structural parent contains the current witness.',
      stageRecord: 'The parent is raw syntax, not an authored relation anchor.',
      relations: [{
        relation: 'GuardedFallbackTransition',
        anchors: { output: 'guard_after' },
        priorAnchors: { input: 'guard_before' }
      }],
      workspaceForest: [{
        id: 'root_parent_guard',
        label: 'Root',
        children: [{
          id: 'guard_unanchored_parent',
          label: 'XP',
          children: [{ id: 'guard_after', label: 'X', word: 'after' }]
        }]
      }]
    }
  ];

  const relationStep = playbackFromStages(derivationStages).find((step) =>
    step.replayKind === 'relation' && step.operation === 'GuardedFallbackTransition');
  assert.ok(relationStep);
  const visible = new Set(relationStep.replayVisibleNodeIds);
  assert.ok(visible.has('guard_unanchored_parent'));
  assert.ok(visible.has('guard_after'));
  assert.ok(visible.has('guard_after::__leaf'));
  assert.equal(visible.has('guard_before'), false);
  assert.equal(findNode(relationStep.replayCanvasData, 'guard_after')?.word, 'after');
  assert.deepEqual(
    findNode(relationStep.replayCanvasData, 'guard_unanchored_parent')?.children?.map((child) => child.id),
    ['guard_after']
  );
});

test('fallback transition moves an existing destination parent under its required new ancestor', () => {
  const derivationStages = [
    {
      statement: 'Base state.',
      stageRecord: 'The destination parent is the workspace root.',
      relations: [],
      workspaceForest: [{
        id: 'existing_destination_parent',
        label: 'XP',
        children: [{ id: 'existing_parent_before', label: 'X', word: 'before' }]
      }]
    },
    {
      statement: 'The relation adds a higher structural parent.',
      stageRecord: 'The complete result is attached beneath the new ancestor.',
      relations: [{
        relation: 'ExistingParentFallbackTransition',
        anchors: { output: 'existing_parent_after' },
        priorAnchors: { input: 'existing_parent_before' }
      }],
      workspaceForest: [{
        id: 'required_new_ancestor',
        label: 'YP',
        children: [{
          id: 'existing_destination_parent',
          label: 'XP',
          children: [{ id: 'existing_parent_after', label: 'X', word: 'after' }]
        }]
      }]
    }
  ];

  const relationStep = playbackFromStages(derivationStages).find((step) =>
    step.replayKind === 'relation' && step.operation === 'ExistingParentFallbackTransition');
  assert.ok(relationStep);
  assert.equal(relationStep.replayCanvasData.id, 'required_new_ancestor');
  assert.equal(
    findParent(relationStep.replayCanvasData, 'existing_destination_parent')?.id,
    'required_new_ancestor'
  );
  assert.equal(findNode(relationStep.replayCanvasData, 'existing_parent_before'), null);
  assert.equal(findNode(relationStep.replayCanvasData, 'existing_parent_after')?.word, 'after');
});

test('fallback transition does not relocate an unrelated existing subtree', () => {
  const derivationStages = [
    {
      statement: 'Two workspaces exist.',
      stageRecord: 'Only the left workspace contains the prior relation witness.',
      relations: [],
      workspaceForest: [
        {
          id: 'scoped_existing_parent',
          label: 'XP',
          children: [{ id: 'scoped_existing_before', label: 'X', word: 'before' }]
        },
        {
          id: 'unrelated_existing_branch',
          label: 'ZP',
          children: [{ id: 'unrelated_existing_leaf', label: 'Z', word: 'unrelated' }]
        }
      ]
    },
    {
      statement: 'The relation adds one shared ancestor in the final forest.',
      stageRecord: 'Its frame may relocate only the branch needed by its own witness.',
      relations: [{
        relation: 'ScopedExistingFallbackTransition',
        anchors: { output: 'scoped_existing_after' },
        priorAnchors: { input: 'scoped_existing_before' }
      }],
      workspaceForest: [{
        id: 'scoped_new_ancestor',
        label: 'Top',
        children: [
          {
            id: 'scoped_existing_parent',
            label: 'XP',
            children: [{ id: 'scoped_existing_after', label: 'X', word: 'after' }]
          },
          {
            id: 'unrelated_existing_branch',
            label: 'ZP',
            children: [{ id: 'unrelated_existing_leaf', label: 'Z', word: 'unrelated' }]
          }
        ]
      }]
    }
  ];

  const steps = playbackFromStages(derivationStages);
  const relationStep = steps.find((step) =>
    step.replayKind === 'relation' && step.operation === 'ScopedExistingFallbackTransition');
  const macroStep = steps.find((step) => step.visualFrameIndex === 1 && step.replayKind === 'macro');
  assert.ok(relationStep);
  assert.ok(macroStep);
  assert.equal(
    findParent(relationStep.replayCanvasData, 'unrelated_existing_branch')?.id === 'scoped_new_ancestor',
    false
  );
  assert.equal(findNode(relationStep.replayCanvasData, 'unrelated_existing_leaf')?.word, 'unrelated');
  assert.equal(
    findParent(macroStep.replayCanvasData, 'unrelated_existing_branch')?.id,
    'scoped_new_ancestor'
  );
});

test('a prior-only instance still exists, with no current witness to mark', () => {
  const drawing = fallbackDrawing({
    relation: SPURIOUS_SE_RELATION.relation,
    anchors: {},
    priorAnchors: { replacedDative: 'cl_se_le' }
  });
  assert.equal(drawing.row, 0);
  assert.deepEqual(drawing.marks, []);
  assert.equal(drawing.backward, true);
  assert.deepEqual(drawing.priorWitnesses, ['cl_se_le']);
});

test('empty arrays are dropped exactly as the adapter drops them', () => {
  const drawing = fallbackDrawing({
    relation: 'AnyName',
    anchors: { a: 'n1', b: [], c: ['  '] }
  });
  assert.equal(drawing.row, 1);
  assert.deepEqual(witnesses(drawing), ['n1']);
});

test('Orchard fallback cards use production drawing and timing, with no substitute SVG painter', async () => {
  const source = await readSource('../docs/design/visual-relations-fallback-prototypes.tsx');
  assert.match(source, /<TreeVisualizer/);
  assert.doesNotMatch(source, /disableRelationOverlay|createElementNS|drawFallbackMarks|babel-fbproto-mark/);
  const renderer = await readSource('../components/TreeVisualizer.tsx');
  const start = renderer.indexOf("if (primitive.type === 'fallback-mark') {", renderer.indexOf('const appendMarker'));
  const paint = renderer.slice(start, renderer.indexOf("if (primitive.type === 'anchor-set-badge')", start));
  assert.match(paint, /\.text\(primitive.text\)/);
  assert.match(paint, /data-authored-role/);
  assert.doesNotMatch(paint, /marker-end|vr-backward-cue|vr-fallback-frame/);
});

test('prototypes stay outside the accepted set and coverage matrix while remaining visible in the Orchard', async () => {
  const titles = FALLBACK_PROTOTYPE_CARDS.map((card) => card.title);
  VISUAL_RELATIONS_FIXTURE_COVERAGE.forEach((entry) => {
    entry.cardTitles.forEach((title) => {
      assert.equal(titles.includes(title), false, `${entry.id} must not cite a prototype`);
    });
  });
  // The production topology fallback is implemented and accepted; the three
  // fallback-status ledger entries (F07, F09, F15) describe production
  // behavior backed by production tests — they cite no prototype card, which
  // the loop above enforces.
  assert.equal(summarizeVisualRelationsFixtureCoverage().statuses.fallback, 3);

  const labSource = await readSource('../docs/design/visual-relations-current-lab.tsx');
  assert.equal(/^    title: 'P1[A-F]/m.test(labSource), false);
  assert.match(labSource, /import \{ FallbackPrototypesSection \}/);
  assert.match(labSource, /<FallbackPrototypesSection \/>/);
  assert.match(labSource, /href="#fallback-prototypes">Fallback prototypes<\/a>/);

  const rendererStages = toRendererStages(FALLBACK_PROTOTYPE_CARDS[1].derivationStages);
  assert.deepEqual(rendererStages.at(-1).relations, [DISJOINT_RELATION]);
});
