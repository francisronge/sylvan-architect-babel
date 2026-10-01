import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { visiblePlanFrameItems } from '../replay/relations/renderPlanCompiler.ts';
import {
  diagnosticFinalStage,
  diagnosticReplayStages,
  diagnosticReplayProjection,
  duplicateStageNodeIds,
  inspectionStageDisplay
} from '../contractQualification/diagnosticReplay.ts';

const node = (id, children = []) => ({ id, label: 'X', children });
const inspectedStage = (workspaceForest) => ({
  authoredStage: {
    statement: 'An authored state.',
    stageRecord: 'Its original explanation.',
    relations: [],
    workspaceForest
  },
  workspaceForest
});

test('duplicate stage IDs include nested and separate-root collisions without changing syntax', () => {
  const forest = [
    node('first-root', [node('repeated')]),
    node('other-root', [node('first-root'), node('repeated')]),
    node('repeated'),
    node(''),
    node('')
  ];
  const original = structuredClone(forest);
  const originalNodes = [forest[0], forest[0].children[0], forest[1].children[0]];

  assert.deepEqual(duplicateStageNodeIds(forest).sort(), ['first-root', 'repeated']);
  assert.deepEqual(forest, original);
  assert.strictEqual(forest[0], originalNodes[0]);
  assert.strictEqual(forest[0].children[0], originalNodes[1]);
  assert.strictEqual(forest[1].children[0], originalNodes[2]);
  assert.deepEqual(duplicateStageNodeIds(null), []);
  assert.deepEqual(duplicateStageNodeIds([]), []);
});

test('occurrence IDs may persist across valid stages in diagnostic Replay', () => {
  const stages = [
    inspectedStage([node('persistent')]),
    inspectedStage([node('new-parent', [node('persistent')])])
  ];
  const original = structuredClone(stages);
  const replay = diagnosticReplayStages(stages);

  assert.equal(replay.length, 2);
  assert.strictEqual(replay[0].workspaceForest, stages[0].workspaceForest);
  assert.strictEqual(replay[1].workspaceForest, stages[1].workspaceForest);
  assert.strictEqual(diagnosticFinalStage(stages), stages[1]);
  assert.deepEqual(stages, original);
});

test('a duplicate middle stage remains replayable without collapsing its authored occurrences', () => {
  const duplicateFirst = node('duplicate');
  const duplicateSecond = node('duplicate');
  const stages = [
    inspectedStage([node('initial')]),
    inspectedStage([node('parent', [duplicateFirst]), duplicateSecond]),
    inspectedStage([node('final')])
  ];
  const original = structuredClone(stages);

  const replay = diagnosticReplayStages(stages);
  assert.equal(replay.length, 3);
  assert.equal(replay[1].workspaceForest.length, 2);
  assert.deepEqual(duplicateStageNodeIds(replay[1].workspaceForest), []);
  assert.strictEqual(diagnosticFinalStage(stages), stages[2]);
  assert.deepEqual(stages, original);
  assert.strictEqual(stages[1].workspaceForest[0].children[0], duplicateFirst);
  assert.strictEqual(stages[1].workspaceForest[1], duplicateSecond);
  assert.equal(duplicateFirst.id, 'duplicate');
  assert.equal(duplicateSecond.id, 'duplicate');
});

test('final-stage inspection never substitutes an earlier drawable stage', () => {
  const earlier = inspectedStage([node('earlier')]);
  for (const finalForest of [null, [], [node('duplicate'), node('duplicate')]]) {
    const stages = [earlier, inspectedStage(finalForest)];
    const original = structuredClone(stages);
    assert.equal(diagnosticFinalStage(stages), null);
    assert.deepEqual(stages, original);
  }
  assert.equal(diagnosticFinalStage([]), null);
});

test('duplicate authored occurrences receive unique display positions without repairing the record', () => {
  const subtree = { ...node('shared', [{ ...node('word'), word: 'book', tokenIndex: 0 }]), lineageId: 'books' };
  const forest = [node('parent', [subtree]), structuredClone(subtree), node('inspection:1')];
  const original = structuredClone(forest);
  const display = inspectionStageDisplay(forest);
  assert.deepEqual(display.duplicateIds, ['shared', 'word']);
  assert.deepEqual(duplicateStageNodeIds(display.forest), []);
  assert.equal(display.forest.length, 3);
  assert.equal(display.forest[0].children[0].children[0].word, 'book');
  assert.equal(display.forest[1].children[0].tokenIndex, 0, 'the repeated pronunciation remains visible');
  assert.deepEqual(display.identities.filter(item => item.authoredId === 'shared').map(item => item.position), ['1.1', '2']);
  assert.deepEqual(inspectionStageDisplay(forest), display, 'display identities are deterministic');
  assert.deepEqual(duplicateStageNodeIds(diagnosticReplayStages([inspectedStage(forest)])[0].workspaceForest), [], 'Replay uses distinct display occurrences without repairing the raw IDs');
  display.forest[1].children[0].word = 'changed by painter';
  assert.deepEqual(forest, original);
});

test('unambiguous inspection retains authored IDs and is detached from the source', () => {
  const forest = [node('one', [{ ...node('two'), silent: true, word: 'book' }])];
  const display = inspectionStageDisplay(forest);
  assert.deepEqual(display.forest, forest);
  assert.notStrictEqual(display.forest[0], forest[0]);
  assert.deepEqual(display.identities, []);
  assert.deepEqual(inspectionStageDisplay(null).forest, []);
});


test('saved Hindi gets ordinary Replay through all six authored states, including both Stage 4 copies', () => {
  const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/hindi-duplicate-workspace.json', import.meta.url), 'utf8'));
  const original = structuredClone(record);
  const projection = diagnosticReplayProjection(record.stages);
  assert.equal(projection.stages.length, 6);
  assert.equal(projection.ambiguousRelations.length, 0, 'the actual Hindi relations occur after the duplicated state');
  const [standalone, inside] = [projection.stages[3].workspaceForest[1], projection.stages[3].workspaceForest[2].children[0]];
  assert.notEqual(standalone.id, inside.id);
  assert.equal(projection.stages[4].workspaceForest[0].children[1].children[0].id, inside.id,
    'the copy already inside lowerV keeps its drawing identity when upperV is added');
  for (const [stageIndex, stage] of projection.stages.entries()) {
    assert.deepEqual(duplicateStageNodeIds(stage.workspaceForest), []);
    const authoredByDisplay = new Map(projection.identities.filter(item => item.stageIndex === stageIndex).map(item => [item.displayId, item.authoredId]));
    const authored = node => ({ ...node, id: authoredByDisplay.get(node.id) ?? node.id,
      ...(node.children ? { children: node.children.map(authored) } : {}) });
    assert.deepEqual(stage.workspaceForest.map(authored), record.stages[stageIndex].workspaceForest,
      'the projection changes drawing IDs only, never syntax, order, words, or pronunciation');
  }
  const replay = prepareReplay({ derivationStages: projection.stages, sentence: record.sentence,
    inputTokens: record.inputTokens, includePlayback: true });
  assert.ok(replay.playbackSteps.length > 6);
  assert.deepEqual([...new Set(replay.playbackSteps.map(step => step.sourceFrameIndex))], [0, 1, 2, 3, 4, 5]);
  const fourth = replay.playbackSteps.findLast(step => step.sourceFrameIndex === 3);
  const ids = new Set();
  const visit = node => { if (node.id) ids.add(node.id); node.children?.forEach(visit); };
  visit(fourth.replayCanvasData);
  assert.ok(ids.has(standalone.id) && ids.has(inside.id), 'both completed copies reach the real Replay canvas');
  assert.deepEqual(replay.playbackSteps.filter(step => step.replayKind === 'relation').map(step => step.replayRelationIdentity), [
    { stageIndex: 4, relationIndex: 0 }, { stageIndex: 4, relationIndex: 1 }, { stageIndex: 5, relationIndex: 0 }
  ]);
  assert.ok(!replay.playbackSteps.some(step => /movement/i.test(step.operation)), 'duplicate display IDs must not invent a movement');
  assert.deepEqual(record, original);
});

test('ambiguous current and prior targets get neutral relation moments without choosing a duplicate', () => {
  const duplicated = [{ ...node('same'), word: 'one' }, { ...node('same'), word: 'two' }, node('probe')];
  const first = inspectedStage(duplicated);
  first.authoredStage.relations = [{ relation: 'Agree', anchors: { probe: 'probe', goal: 'same' }, values: { features: 'plural' } }];
  const second = inspectedStage([node('same'), node('probe')]);
  second.authoredStage.relations = [{ relation: 'Unfamiliar continuity', anchors: { current: 'same' }, priorAnchors: { earlier: 'same' } }];
  const original = structuredClone([first, second]);
  const projection = diagnosticReplayProjection([first, second]);
  assert.equal(projection.ambiguousRelations.length, 2);
  assert.equal(projection.stages[0].relations[0].anchors.goal, 'same');
  assert.ok(projection.stages[0].workspaceForest.every(item => item.id !== 'same'));
  assert.equal(projection.stages[1].relations[0].priorAnchors.earlier, 'same');
  assert.deepEqual(projection.stages[0].relations[0].relationContractFailure.raw, first.authoredStage.relations[0]);
  const replay = prepareReplay({ derivationStages: projection.stages, sentence: 'one two', includePlayback: true });
  assert.equal(replay.playbackSteps.filter(step => step.replayKind === 'relation').length, 2);
  for (let stageIndex = 0; stageIndex < 2; stageIndex++) {
    const marks = visiblePlanFrameItems(replay.relationRenderPlan, stageIndex, new Set([0]), 0);
    assert.ok(marks.some(item => item.kind === 'fallback' && item.relationRef.stageIndex === stageIndex));
    assert.ok(marks.every(item => item.kind === 'fallback'), 'no specialized claim is drawn from an ambiguous reference');
  }
  assert.deepEqual([first, second], original);
});

test('display identity allocation reserves authored identifiers and stays deterministic', () => {
  const stages = [inspectedStage([node('shared'), node('shared'), node('inspection-replay:shared:1')])];
  const projection = diagnosticReplayProjection(stages);
  assert.deepEqual(duplicateStageNodeIds(projection.stages[0].workspaceForest), []);
  assert.deepEqual(diagnosticReplayProjection(stages), projection);
  assert.equal(projection.stages[0].workspaceForest[2].id, 'inspection-replay:shared:1');
});
