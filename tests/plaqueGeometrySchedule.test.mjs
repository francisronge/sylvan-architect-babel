import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  buildReplayPlaqueSchedule, buildStageCameraBounds, buildStageLayoutGroups, measureStagePlaqueSpace, selectReplayPlaqueLayout
} from '../replay/stageCamera.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { planItemRelationRefs } from '../replay/relations/renderPlanCompiler.ts';
import {
  caseAssignmentClears, caseAssignmentSource, collectionPlaqueClears, plaqueIdentity,
  plaquesOverlap, projectPlaqueLayout
} from '../replay/relations/plaquePlacement.ts';

const capturedMetrics = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/workspace-font-metrics.json', import.meta.url)));
const categoryMetrics = new Map(capturedMetrics.categories), inkMetrics = new Map(capturedMetrics.treeInk);
const metric = (values, key) => {
  assert(values.has(key), `the regression has a captured production font measurement for ${key}`);
  return values.get(key);
};
const measuredTreeMetrics = {
  measureCategoryText: text => metric(categoryMetrics, text),
  measureTreeInk: (text, style) => metric(inkMetrics, JSON.stringify([text, style])) ?? undefined
};

const leaf = (id, word = id) => ({ id, label: 'N', word });
const branch = (id, children) => ({ id, label: 'XP', children });
const featurePlaque = (anchorNodeIds = ['moving']) => ({
  kind: 'node-plaque', plaqueStyle: 'feature', anchorNodeIds, title: 'Agreement',
  rows: [{ label: 'phi', value: '3sg' }], relationRef: { stageIndex: 0, relationIndex: 0 }
});
const reparentedTree = (moved = false) => branch('root', [
  branch('left', moved ? [leaf('l')] : [leaf('moving'), leaf('l')]),
  branch('right', moved ? [leaf('r'), leaf('moving')] : [leaf('r')])
]);

function scheduleInput(canvases, {
  items = [featurePlaque()], stageIndices = canvases.map(() => 0), kinds,
  width = 1200, height = 900, visibleIds
} = {}) {
  const stageSteps = new Map();
  const steps = canvases.map((replayCanvasData, index) => {
    const replayFrameIndex = stageIndices[index];
    const replayStageStepIndex = stageSteps.get(replayFrameIndex) ?? 0;
    stageSteps.set(replayFrameIndex, replayStageStepIndex + 1);
    return {
      replayCanvasData, replayFrameIndex, replayStageStepIndex,
      replayKind: kinds?.[index] ?? (index === canvases.length - 1 ? 'macro' : 'relation'),
      replayRelationLinks: [{ authoredRelationKey: '0:0' }],
      ...(visibleIds?.[index] ? { replayVisibleNodeIds: visibleIds[index] } : {})
    };
  });
  return {
    steps, stageIndex: 0, completedCanvas: canvases.at(-1), width, height,
    plan: { frames: Array.from({ length: Math.max(...stageIndices) + 1 }, () => ({ items })) }
  };
}

function sceneAt(input, stepIndex) {
  const stageIndex = input.steps[stepIndex].replayFrameIndex;
  const scene = measureStagePlaqueSpace({ ...input, stageIndex }).scenes
    .find(scene => scene.stepIndices.includes(stepIndex));
  assert.ok(scene, `absolute Replay step ${stepIndex} has a measured scene`);
  return scene;
}

const positions = scene => new Map(scene.nodes.map(node => [node.__vizId ?? node.data.id, node]));
const layoutAt = (schedule, input, stepIndex) =>
  selectReplayPlaqueLayout(schedule, input.steps[stepIndex].replayFrameIndex, stepIndex);
const pocket = box => [box.x - box.attachmentX, box.y - box.attachmentY, box.width, box.height];

function auxiliaryCaseStages() {
  const node = (id, label, children = [], properties = {}) => ({ id, label, children, ...properties });
  const word = (id, label, text, tokenIndex, properties = {}) => node(id, label, [], {
    word: text, ...(tokenIndex === undefined ? { silent: true } : { tokenIndex }), ...properties
  });
  const nominal = high => node(high ? 'subjectHigher' : 'subjectLower', 'D', [
    node(high ? 'subjectDHigher' : 'subjectDLower', 'D[proper]', [], { silent: true, lineageId: 'maryD' }),
    word(high ? 'subjectNHigher' : 'subjectNLower', 'N', 'مريم', high ? 2 : undefined, { lineageId: 'maryN' })
  ], { lineageId: 'maryNominal', ...(!high ? { silent: true } : {}) });
  const tense = moved => node('subjectTenseProjection', 'T', [nominal(true), node('tenseProjection', 'T', [
    word('auxiliaryLower', 'T[auxiliary]', 'تكن', moved ? undefined : 1, { lineageId: 'auxiliary' }),
    node('temporalPerfectPredicate', 'Asp', [node('perfectPredicate', 'Asp', [
      word('perfectHead', 'Asp[perfect]', 'قد', 3),
      node('agentPredicate', 'v', [nominal(false), node('transitivePredicate', 'v', [
        node('complexVHead', 'v', [word('verbHigher', 'V', 'أرسلت', 4, { lineageId: 'sendVerb' }),
          node('vNull', 'v[transitive]', [], { silent: true })]),
        node('lexicalPredicate', 'V', [word('verbLower', 'V', 'أرسلت', undefined, { lineageId: 'sendVerb' }),
          node('object', 'D', [node('objectD', 'D[definite]', [], { silent: true }),
            word('objectN', 'N', 'الرسالة', 5)])])
      ])])
    ]), word('temporalAdjunct', 'Adv[temporal]', 'بعد', 6)])
  ])]);
  return [{
    statement: 'The finite auxiliary values agreement and Case.', stageRecord: 'The subject occupies the T edge.',
    workspaceForest: [tense(false)], relations: [{ relation: 'finite Agree',
      anchors: { goal: 'subjectLower', probe: 'auxiliaryLower' },
      values: { agreement: ['third person', 'feminine', 'singular'], case: 'nominative' } }]
  }, {
    statement: 'The auxiliary moves to Fin.', stageRecord: 'Its lower occurrence remains unpronounced.',
    workspaceForest: [node('declarativeClause', 'C', [node('declarativeHead', 'C[declarative]', [], { silent: true }),
      node('negativeClause', 'Neg', [word('negativeHead', 'Neg[past-oriented, jussive-licensing]', 'لم', 0),
        node('finiteClause', 'Fin', [node('complexFiniteHead', 'Fin', [
          word('auxiliaryHigher', 'T[auxiliary]', 'تكن', 1, { lineageId: 'auxiliary' }),
          node('finNull', 'Fin[jussive]', [], { silent: true })
        ]), tense(true)])])])],
    relations: [{ relation: 'T-to-Fin internal merge',
      anchors: { host: 'finNull', landingOccurrence: 'auxiliaryHigher', source: 'auxiliaryLower' },
      priorAnchors: { source: 'auxiliaryLower' }, values: {} }]
  }];
}

for (const [width, height, direction] of [[1200, 900, 'ltr'], [390, 844, 'rtl']]) for (const measured of [true, false]) {
  const behavior = measured ? 'captured font metrics preserve the lower Case pocket through Fin movement'
    : 'conservative fallback preserves a safe Case pocket or replaces an unsafe one';
  test(`${width}px ${direction}: ${behavior}`, () => {
    const stages = auxiliaryCaseStages();
    const replay = prepareReplay({ sentence: 'لم تكن مريم قد أرسلت الرسالة بعد.',
      derivationStages: stages, includePlayback: true });
    const steps = replay.playbackSteps;
    const beforeIndex = steps.findIndex(step => step.replayFrameIndex === 0 && step.replayKind === 'macro');
    const selectionIndex = steps.findIndex(step => step.replayFrameIndex === 1 && step.targetNodeId === 'finNull');
    const movementIndex = steps.findIndex(step => step.replayFrameIndex === 1 && step.replayKind === 'relation');
    assert.equal(selectionIndex, beforeIndex + 1);
    assert.equal(movementIndex, selectionIndex + 1, 'Fin selection precedes the authored head movement');
    const input = { steps, stageIndex: 0, completedCanvas: steps.at(-1).replayCanvasData,
      plan: replay.relationRenderPlan, width, height, direction, layoutGroups: buildStageLayoutGroups(steps, stages),
      ...(measured ? measuredTreeMetrics : {}) };
    const original = JSON.stringify(input);
    const schedule = buildReplayPlaqueSchedule(input);
    const selected = sceneAt(input, selectionIndex);
    const byId = positions(selected);
    assert.ok(byId.has('finNull'));
    assert.ok(!byId.has('finiteClause'), 'the future Fin parent has not merged');
    assert.equal(byId.get('subjectTenseProjection').parent.data.id, 'finiteClause');
    assert.equal(byId.get('subjectTenseProjection').parent.data.replayLayoutOnly, undefined,
      'within-stage future parents must be excluded by availability, not only the scaffold flag');
    const boxes = [beforeIndex, selectionIndex, movementIndex].map(index => {
      const items = input.plan.frames[steps[index].replayFrameIndex].items;
      const itemIndex = items.findIndex(item => item.pathStyle === 'case-assignment');
      assert.equal(items[itemIndex].fromNodeId, 'auxiliaryLower');
      assert.equal(items[itemIndex].toNodeId, 'subjectLower');
      const source = caseAssignmentSource(positions(sceneAt(input, index)).get('auxiliaryLower'));
      assert.equal(source.data.id, 'auxiliaryLower::__leaf', 'the existing claim keeps its exact lower source');
      return layoutAt(schedule, input, index).get(itemIndex);
    });
    assertClose(pocket(boxes[1]), pocket(boxes[0]), 'selection keeps the reserved pocket relative to its source');
    const movingScene = sceneAt(input, movementIndex), movingNodes = positions(movingScene);
    if (measured) {
      for (const id of ['auxiliaryLower', 'auxiliaryLower::__leaf', 'subjectLower']) {
        const initial = positions(sceneAt(input, beforeIndex)).get(id);
        for (const nodes of [byId, movingNodes]) assertClose([nodes.get(id).x, nodes.get(id).y], [initial.x, initial.y],
          `${id} stays stationary through selection and the higher occurrence's movement`);
      }
      assertClose(pocket(boxes[2]), pocket(boxes[1]), 'movement of a new higher occurrence preserves the lower claim');
    } else {
      // Missing font metrics use larger ink envelopes. Retain the old pocket
      // whenever it still clears; changed geometry must not retain a collision.
      const carried = projectPlaqueLayout(new Map([[0, boxes[1]]]), id => movingNodes.get(id) ?? null).get(0);
      const stillClear = movingScene.obstacles.every(obstacle => !plaquesOverlap(carried, obstacle, 0))
        && caseAssignmentClears(movingNodes.get('auxiliaryLower'), carried, movingScene.obstacles)
        && collectionPlaqueClears(carried, movingScene.nodes, movingScene.obstacles);
      if (stillClear) assertClose(pocket(boxes[2]), pocket(boxes[1]), 'a safe prior pocket remains reserved');
      else assert.notDeepEqual(pocket(boxes[2]), pocket(boxes[1]), 'an unsafe prior pocket must be replaced');
    }
    assertClearScenes(input, schedule);
    assert.equal(JSON.stringify(input), original, 'plaque reservation does not change nodes, timing, claims, or canvas geometry');
  });
}

test('a merged scene cannot expose its later parent at the stage boundary', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/scaffold-parent-visibility.json', import.meta.url)));
  const replay = prepareReplay({ ...fixture, includePlayback: true });
  const steps = replay.playbackSteps;
  const selection = steps.findIndex(step => step.replayFrameIndex === 3 && step.replayKind === 'micro');
  assert.equal(steps[selection].operation, 'LexicalSelect');
  assert.equal(steps[selection - 1].replayKind, 'macro');
  assert.ok(!steps[selection].replayVisibleNodeIds.includes('aNegP'));
  const input = { steps, stageIndex: 0, completedCanvas: steps.at(-1).replayCanvasData,
    plan: replay.relationRenderPlan, width: 1200, height: 900,
    layoutGroups: buildStageLayoutGroups(steps, fixture.derivationStages) };
  const merged = sceneAt(input, selection);
  assert.ok(merged.stepIndices.length > 1, 'equivalent canvases share geometry');
  assert.ok(positions(merged).has('aNegP'), 'the shared scene includes the later revealed parent');
  const original = JSON.stringify(input);
  const schedule = buildReplayPlaqueSchedule(input);
  const findCase = index => {
    const itemIndex = input.plan.frames[steps[index].replayFrameIndex].items.findIndex(item =>
      item.pathStyle === 'case-assignment' && item.fromNodeId === 'av0' && item.toNodeId === 'aLetter');
    assert.ok(itemIndex >= 0);
    return layoutAt(schedule, input, index).get(itemIndex);
  };
  assertClose(pocket(findCase(selection)), pocket(findCase(selection - 1)),
    'later visibility in a shared scene cannot reset the existing Case pocket at selection');
  assert.equal(JSON.stringify(input), original);
});

test('a collection prepass cannot replace an accepted pocket before its attachment changes', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/collection-pocket-continuity.json', import.meta.url)));
  const replay = prepareReplay({ ...fixture, includePlayback: true });
  const steps = replay.playbackSteps;
  const selection = steps.findIndex(step => step.replayFrameIndex === 2 && step.replayKind === 'micro');
  assert.equal(steps[selection].operation, 'LexicalSelect');
  assert.equal(steps[selection - 1].replayKind, 'macro');
  const input = { steps, stageIndex: 0, completedCanvas: steps.at(-1).replayCanvasData,
    plan: replay.relationRenderPlan, width: 1200, height: 900,
    layoutGroups: buildStageLayoutGroups(steps, fixture.derivationStages) };
  const original = JSON.stringify(input);
  const schedule = buildReplayPlaqueSchedule(input);
  const at = index => {
    const itemIndex = input.plan.frames[steps[index].replayFrameIndex].items.findIndex(item =>
      item.pathStyle === 'case-assignment' && item.fromNodeId === 'il' && item.toNodeId === 'sl');
    assert.ok(itemIndex >= 0);
    const nodes = positions(sceneAt(input, index));
    const box = projectPlaqueLayout(layoutAt(schedule, input, index), id => nodes.get(id) ?? null).get(itemIndex);
    assert.equal(box.attachmentNodeId, 'il');
    return { nodes, box, scene: sceneAt(input, index) };
  };
  const before = at(selection - 1), selected = at(selection);
  assertClose([selected.nodes.get('il').x, selected.nodes.get('il').y],
    [before.nodes.get('il').x, before.nodes.get('il').y],
    'selection in another workspace leaves the existing assigning head stationary');
  assert.equal(selected.nodes.get('il').parent.data.id, before.nodes.get('il').parent.data.id);
  assertClose(pocket(selected.box), pocket(before.box),
    'the accepted pocket persists instead of resetting to the next stage prepass');
  assert.equal(before.box.attachmentX, before.nodes.get('il').x);
  assert.equal(before.box.attachmentY, before.nodes.get('il').y);
  for (const { nodes, box, scene } of [before, selected]) {
    assert.ok(caseAssignmentClears(nodes.get('il'), box, scene.obstacles));
    assert.ok(collectionPlaqueClears(box, scene.nodes, scene.obstacles));
  }
  assert.equal(JSON.stringify(input), original);
});

function assertClose(actual, expected, message) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-8,
    `${message}: ${value} differs from ${expected[index]}`));
}

function assertClearScenes(input, schedule) {
  for (const stageIndex of new Set(input.steps.map(step => step.replayFrameIndex))) {
    for (const scene of measureStagePlaqueSpace({ ...input, stageIndex }).scenes) {
      const byId = positions(scene);
      // Scheduling reserves later pockets before their relation is played.
      // Only active claims require an attachment and clearance in this scene.
      const layout = new Map([...selectReplayPlaqueLayout(schedule, stageIndex, scene.stepIndices[0])]
        .filter(([index]) => !scene.playedRelations || planItemRelationRefs(input.plan.frames[stageIndex].items[index])
          .some(ref => ref.stageIndex < stageIndex
            || (ref.stageIndex === stageIndex && scene.playedRelations.has(ref.relationIndex)))));
      const projected = projectPlaqueLayout(layout, id => byId.get(id) ?? null);
      assert.equal(projected.size, layout.size, 'every reserved plaque has its actual scene attachment');
      for (const [index, box] of projected) {
        assert.ok(scene.obstacles.every(obstacle => !plaquesOverlap(box, obstacle, 0)),
          `plaque ${index} clears syntax at steps ${scene.stepIndices}`);
        assert.ok(collectionPlaqueClears(box, scene.nodes, scene.obstacles),
          `collection approaches clear syntax at steps ${scene.stepIndices}`);
        const item = input.plan.frames[stageIndex].items[index];
        if (item.pathStyle === 'case-assignment') {
          assert.ok(caseAssignmentClears(byId.get(item.fromNodeId), box, scene.obstacles),
            `Case's curved approach clears syntax at steps ${scene.stepIndices}`);
        }
      }
      const boxes = [...projected.values()];
      boxes.forEach((box, index) => assert.ok(boxes.slice(index + 1)
        .every(other => !plaquesOverlap(box, other, 0)), 'reserved plaques do not cover each other'));
    }
  }
}

test('a retained occurrence can reparent within a stage without a trajectory plan', () => {
  const input = scheduleInput([reparentedTree(), reparentedTree(true), reparentedTree(true)], {
    items: [featurePlaque(['moving', 'r'])]
  });
  const original = JSON.stringify(input);
  const schedule = buildReplayPlaqueSchedule(input);
  const before = positions(sceneAt(input, 0)).get('moving');
  const after = positions(sceneAt(input, 1)).get('moving');
  assert.equal(before.parent.data.id, 'left');
  assert.equal(after.parent.data.id, 'right');
  assert.notEqual(before.x, after.x, 'the retained occurrence changes its attachment geometry');
  assert.ok(input.plan.frames[0].items.every(item => item.kind !== 'trajectory'));
  assert.notStrictEqual(layoutAt(schedule, input, 0), layoutAt(schedule, input, 1),
    'the neutral relation moment revalidates the persistent plaque');
  assert.strictEqual(layoutAt(schedule, input, 1), layoutAt(schedule, input, 2),
    'the completed record keeps the post-reparent placement map');
  assert.strictEqual(schedule.stages[0], layoutAt(schedule, input, 2));
  assertClearScenes(input, schedule);
  assert.equal(JSON.stringify(input), original, 'allocation leaves the authored claim and Replay timing intact');
});

test('returning to an earlier authored tree revalidates the pocket from the preceding moment', () => {
  const input = scheduleInput([
    reparentedTree(), reparentedTree(true), reparentedTree(), reparentedTree()
  ], { items: [featurePlaque(['moving', 'r'])] });
  const schedule = buildReplayPlaqueSchedule(input);
  const first = layoutAt(schedule, input, 0);
  const middle = layoutAt(schedule, input, 1);
  const returned = layoutAt(schedule, input, 2);
  assert.deepEqual(input.steps[0].replayCanvasData, input.steps[2].replayCanvasData);
  assert.notStrictEqual(returned, first, 'a repeated tree cannot revive an earlier phase map');
  assert.notStrictEqual(returned, middle, 'the return has its own attachment validation');
  assert.strictEqual(returned, layoutAt(schedule, input, 3));
  const byId = positions(sceneAt(input, 2));
  const carried = projectPlaqueLayout(middle, id => byId.get(id) ?? null).get(0);
  assert.ok(sceneAt(input, 2).obstacles.every(obstacle => !plaquesOverlap(carried, obstacle, 0)),
    'this return leaves the preceding pocket available');
  const attachment = byId.get(returned.get(0).attachmentNodeId);
  assert.equal(returned.get(0).attachmentX, attachment.x);
  assert.equal(returned.get(0).attachmentY, attachment.y,
    'revalidation binds the chosen pocket to the current attachment');
  assertClearScenes(input, schedule);
});

test('ordinary selection, projection, and reveal steps share their placement map', () => {
  const canvas = reparentedTree();
  const input = scheduleInput(Array.from({ length: 4 }, () => structuredClone(canvas)), {
    kinds: ['micro', 'relation', 'micro', 'macro'],
    visibleIds: [
      ['moving'], ['left', 'moving'], ['left', 'moving', 'l'],
      ['root', 'left', 'right', 'moving', 'l', 'r']
    ]
  });
  const schedule = buildReplayPlaqueSchedule(input);
  const layout = layoutAt(schedule, input, 0);
  assert.equal(layout.size, 1, 'the reveal sequence exercises a real plaque');
  for (const index of [1, 2, 3]) assert.strictEqual(layoutAt(schedule, input, index), layout,
    'ordinary syntax reveals retain the reserved pocket and the same placement map');
  assert.strictEqual(selectReplayPlaqueLayout(schedule, 0), layout);
  assert.strictEqual(selectReplayPlaqueLayout(schedule, 0, 999), layout,
    'an absent absolute step falls back to the completed stage');
  assertClearScenes(input, schedule);
});

test('a stage beginning with a relation revalidates an inherited participant change', () => {
  const input = scheduleInput([reparentedTree(), reparentedTree(true), reparentedTree(true)], {
    items: [featurePlaque(['moving', 'r'])], stageIndices: [0, 1, 1], kinds: ['macro', 'relation', 'macro']
  });
  const prefix = { ...input, steps: input.steps.slice(0, 1), completedCanvas: input.steps[0].replayCanvasData,
    plan: { frames: input.plan.frames.slice(0, 1) } };
  const schedule = buildReplayPlaqueSchedule(input);
  assert.equal(input.steps.find(step => step.replayFrameIndex === 1).replayKind, 'relation');
  assert.deepEqual(schedule.stages[0], buildReplayPlaqueSchedule(prefix).stages[0],
    'later stages cannot translate earlier plaque attachments or alter their dimensions');
  const before = positions(sceneAt(input, 0));
  const after = positions(sceneAt(input, 1));
  assert.notEqual(before.get('moving').x - before.get('r').x,
    after.get('moving').x - after.get('r').x, 'the exact participants change their relative geometry');
  assert.notStrictEqual(layoutAt(schedule, input, 0), layoutAt(schedule, input, 1));
  assert.strictEqual(layoutAt(schedule, input, 1), layoutAt(schedule, input, 2));
  assert.strictEqual(layoutAt(schedule, input, 1), schedule.stages[1],
    'absolute step 1 selects the second authored stage');
  assertClearScenes(input, schedule);
});

test('Case revalidates when a head loses and regains its unique pronounced descendant', () => {
  const tree = complex => branch('root', [
    branch('head', [leaf('verb', 'read'), complex ? leaf('suffix', 'n') : { id: 'suffix', label: 'M' }]),
    leaf('target', 'it')
  ]);
  const assignment = {
    kind: 'directed-path', pathStyle: 'case-assignment', fromNodeId: 'head', toNodeId: 'target',
    featureRow: { label: 'Case', value: 'accusative' }, relationRef: { stageIndex: 0, relationIndex: 0 }
  };
  const input = scheduleInput([tree(false), tree(true), tree(false), tree(false)], { items: [assignment] });
  const schedule = buildReplayPlaqueSchedule(input);
  const scenes = [0, 1, 2].map(index => sceneAt(input, index));
  assert.deepEqual(scenes.map(scene => caseAssignmentSource(positions(scene).get('head')).data.id),
    ['verb', 'head', 'verb']);
  const geometry = scene => scene.nodes.map(node => [node.data.id, node.parent?.data.id, node.x, node.y]);
  assert.deepEqual(geometry(scenes[0]), geometry(scenes[1]),
    'the Case source changes without reparenting or moving the authored head');
  assert.deepEqual(geometry(scenes[0]), geometry(scenes[2]));
  assert.notStrictEqual(layoutAt(schedule, input, 0), layoutAt(schedule, input, 1));
  assert.notStrictEqual(layoutAt(schedule, input, 0), layoutAt(schedule, input, 2),
    'returning to the exact earlier geometry revalidates the effective source');
  assert.notStrictEqual(layoutAt(schedule, input, 1), layoutAt(schedule, input, 2));
  assert.strictEqual(layoutAt(schedule, input, 2), layoutAt(schedule, input, 3));
  assertClearScenes(input, schedule);
});

test('uniform participant translation reuses the plaque offset after a subtree is reparented', () => {
  const unit = () => branch('unit', [leaf('moving'), leaf('target')]);
  const before = branch('outer', [branch('parent-old', [unit()]), branch('fixed', [leaf('blocker')])]);
  const after = branch('outer', [branch('fixed', [leaf('blocker')]), branch('parent-new', [unit()])]);
  const input = scheduleInput([before, after], {
    items: [featurePlaque(['moving', 'target'])], stageIndices: [0, 1], kinds: ['macro', 'relation']
  });
  const schedule = buildReplayPlaqueSchedule(input);
  const oldNodes = positions(sceneAt(input, 0));
  const newNodes = positions(sceneAt(input, 1));
  const delta = id => [newNodes.get(id).x - oldNodes.get(id).x, newNodes.get(id).y - oldNodes.get(id).y];
  assert.ok(Math.hypot(...delta('moving')) > 100, 'the fixture includes a substantial translation');
  assertClose(delta('moving'), delta('target'), 'both exact participants translate together');
  assertClose(delta('moving'), delta('unit'), 'their containing subtree translates with them');
  assert.notEqual(oldNodes.get('unit').parent.data.id, newNodes.get('unit').parent.data.id);
  assertClose(pocket(schedule.stages[0].get(0)), pocket(schedule.stages[1].get(0)),
    'uniform translation retains the existing pocket');
  assertClearScenes(input, schedule);
});

test('a later collection source ends the inherited plaque lifetime when its retained subtree moves', () => {
  const tree = moved => branch('root', [
    branch('left', [leaf('target'), leaf('blocker'),
      ...(moved ? [branch('source-phrase', [leaf('source')])] : [])]),
    branch('right', [leaf('head'),
      ...(moved ? [] : [branch('source-phrase', [leaf('source')])])])
  ]);
  const assignment = {
    kind: 'directed-path', pathStyle: 'case-assignment', fromNodeId: 'head', toNodeId: 'target',
    featureRow: { label: 'Case', value: 'accusative' }, relationRef: { stageIndex: 0, relationIndex: 0 }
  };
  const restated = { ...assignment, coalescedRefs: [{ stageIndex: 1, relationIndex: 1 }] };
  const collection = {
    kind: 'directed-path', pathStyle: 'case-agree', fromNodeId: 'target', toNodeId: 'source',
    featureRow: { label: 'phi', value: '3sg' }, relationRef: { stageIndex: 1, relationIndex: 0 }
  };
  const input = scheduleInput([tree(false), tree(false), tree(true), tree(true)], {
    stageIndices: [0, 1, 2, 2], kinds: ['macro', 'relation', 'relation', 'macro'], width: 390
  });
  input.plan.frames = [{ items: [assignment] }, { items: [restated, collection] }, { items: [restated, collection] }];
  input.steps.filter(step => step.replayFrameIndex > 0).forEach(step =>
    step.replayRelationLinks.push({ authoredRelationKey: '1:0' }));
  const prefix = {
    ...input, steps: input.steps.slice(0, 2), completedCanvas: input.steps[1].replayCanvasData,
    plan: { frames: input.plan.frames.slice(0, 2) }
  };
  const schedule = buildReplayPlaqueSchedule(input);
  assert.equal(plaqueIdentity(assignment), plaqueIdentity(restated), 'the Case claim persists when its rows grow');
  assert.equal(schedule.stages[0].get(0).collectionRows, undefined,
    'the first frame has no collection source to capture');
  assert.deepEqual(schedule.stages[1].get(0).collectionRows.map(row => row.sourceNodeId), ['source']);
  assert.equal(schedule.stages[0].get(0).height, schedule.stages[1].get(0).height,
    'the added row is reserved before it appears');
  const before = positions(sceneAt(input, 1));
  const after = positions(sceneAt(input, 2));
  assert.equal(before.get('head').parent.data.id, after.get('head').parent.data.id);
  assert.equal(before.get('target').parent.data.id, after.get('target').parent.data.id);
  assert.equal(before.get('source').parent.data.id, after.get('source').parent.data.id,
    'the collection source retains its immediate parent inside the moved phrase');
  assert.notEqual(before.get('source-phrase').parent.data.id, after.get('source-phrase').parent.data.id);
  assert.notEqual(before.get('source').x - before.get('head').x,
    after.get('source').x - after.get('head').x);
  assert.deepEqual(schedule.stages[0], buildReplayPlaqueSchedule(prefix).stages[0],
    'the initial pocket includes later rows but stops before their source changes attachment');
  assert.strictEqual(layoutAt(schedule, input, 2), layoutAt(schedule, input, 3));
  assertClearScenes(input, schedule);
});

test('an unplayed Case owner does not displace an active Agree plaque before its own moment', () => {
  const target = () => branch('target-phrase', [branch('target-shell', [leaf('target')])]);
  const tree = moved => branch('root', [
    branch('left', moved ? [leaf('source', 'a')] : [leaf('head'), leaf('source', 'a')]),
    branch('right', moved ? [target(), leaf('head')] : [target()])
  ]);
  const assignment = {
    kind: 'directed-path', pathStyle: 'case-assignment', fromNodeId: 'head', toNodeId: 'target',
    featureRow: { label: 'Case', value: 'accusative' }, relationRef: { stageIndex: 0, relationIndex: 1 }
  };
  const collection = {
    kind: 'directed-path', pathStyle: 'case-agree', fromNodeId: 'target', toNodeId: 'source',
    featureRow: { label: 'phi', value: '3sg' }, relationRef: { stageIndex: 0, relationIndex: 0 }
  };
  const input = scheduleInput([tree(false), tree(true), tree(true)], {
    items: [assignment, collection], width: 390
  });
  input.steps.slice(1).forEach(step => step.replayRelationLinks.push({ authoredRelationKey: '0:1' }));
  const schedule = buildReplayPlaqueSchedule(input);
  const first = layoutAt(schedule, input, 0).get(0);
  assert.deepEqual(first.collectionRows.map(row => row.ownerKeys), [['0:0']],
    'the earlier Agree moment owns a visible row on this shared plaque');
  assert.equal(first.location, 'local', 'the Agree-only frame has a local pocket');
  for (const stepIndex of [0, 1]) {
    const scene = sceneAt(input, stepIndex);
    const byId = positions(scene);
    const box = projectPlaqueLayout(layoutAt(schedule, input, stepIndex), id => byId.get(id) ?? null).get(0);
    assert.ok(scene.playedRelations.has(0), 'the Agree owner is active in both geometries');
    assert.equal(scene.playedRelations.has(1), stepIndex === 1);
    assert.ok(scene.obstacles.every(obstacle => !plaquesOverlap(box, obstacle, 0)));
    assert.ok(collectionPlaqueClears(box, scene.nodes, scene.obstacles),
      'the active collection approach clears the actual scene');
    assert.equal(caseAssignmentClears(byId.get('head'), box, scene.obstacles), stepIndex === 1,
      'the initial pocket ignores the unplayed Case approach; the later pocket clears its owned approach');
  }
  assert.strictEqual(layoutAt(schedule, input, 1), layoutAt(schedule, input, 2));

  const earlyOwned = structuredClone(input);
  earlyOwned.steps[0].replayRelationLinks.push({ authoredRelationKey: '0:1' });
  const ownedSchedule = buildReplayPlaqueSchedule(earlyOwned);
  const ownedScene = sceneAt(earlyOwned, 0);
  const byId = positions(ownedScene);
  const ownedBox = projectPlaqueLayout(layoutAt(ownedSchedule, earlyOwned, 0), id => byId.get(id) ?? null).get(0);
  assert.ok(ownedScene.obstacles.every(obstacle => !plaquesOverlap(ownedBox, obstacle, 0)));
  assert.ok(collectionPlaqueClears(ownedBox, ownedScene.nodes, ownedScene.obstacles));
  assert.ok(caseAssignmentClears(byId.get('head'), ownedBox, ownedScene.obstacles),
    'playing the Case owner earlier enforces its clearance in that earlier geometry');
  assert.notDeepEqual(pocket(ownedBox), pocket(first), 'Case ownership changes which initial pocket is valid');
});

for (const [width, height] of [[1200, 900], [390, 844]]) {
  test(`${width}px camera bounds include every phase and remain identical for each active layout`, () => {
    const input = scheduleInput([
      reparentedTree(), reparentedTree(true), reparentedTree(), reparentedTree()
    ], { items: [featurePlaque(['moving', 'r'])], width, height });
    const schedule = buildReplayPlaqueSchedule(input);
    const expected = buildStageCameraBounds({ ...input, plaqueSchedule: schedule });
    assert.ok(expected);
    assert.ok(new Set(schedule.steps.values()).size > 1, 'the camera covers distinct phase layouts');
    for (const [stepIndex, step] of input.steps.entries()) {
      const active = layoutAt(schedule, input, stepIndex);
      const actual = buildStageCameraBounds({
        ...input, completedCanvas: step.replayCanvasData, plaqueLayout: active, plaqueSchedule: schedule
      });
      assert.deepEqual(actual, expected, 'the active placement cannot change the stage-wide fit');
      const byId = positions(sceneAt(input, stepIndex));
      for (const box of projectPlaqueLayout(active, id => byId.get(id) ?? null).values()) {
        assert.ok(box.x - 24 >= actual.minX && box.x + box.width + 24 <= actual.maxX,
          `horizontal camera extent contains step ${stepIndex}'s plaque and padding`);
        assert.ok(box.y - 24 >= actual.minY && box.y + box.height + 24 <= actual.maxY,
          `vertical camera extent contains step ${stepIndex}'s plaque and padding`);
      }
    }
  });
}
