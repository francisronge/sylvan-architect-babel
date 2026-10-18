import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildReplayPlaqueSchedule, buildStageLayoutGroups, selectReplayPlaqueLayout } from '../replay/stageCamera.ts';
import { buildRenderableDerivationCanvasData } from '../replay/replayCanvas.ts';
import { measurePlaqueLayoutJob, plaqueLayoutViewportKey, runPlaqueLayoutJob } from '../replay/plaqueLayoutJob.ts';
import { fallbackPlaqueTextMeasure } from '../replay/relations/plaqueTextLayout.ts';

test('native plaque measurement follows authored lexical aliases through worker serialization', () => {
  const tree = { id: 'root', label: 'NP', children: [
    { id: 'adjective', label: 'A', children: [{ id: 'a', label: 'new', word: 'new', tokenIndex: 0 }] },
    { id: 'nominal', label: 'N', children: [{ id: 'n', label: 'books', word: 'books', tokenIndex: 1 }] }
  ] };
  const record = { sentence: 'new books', derivationStages: [{ statement: 'Build the NP.',
    stageRecord: 'The lexical bearers share number.', workspaceForest: [tree],
    relations: [{ relation: 'FeatureSharing', anchors: { bearers: ['a', 'n'] }, values: { feature: 'plural' } }] }] };
  const prepared = prepareReplay({ ...record, includePlayback: true });
  const input = { steps: prepared.playbackSteps, stageIndex: 0, plan: prepared.relationRenderPlan,
    completedCanvas: buildRenderableDerivationCanvasData([tree]), width: 1600, height: 1000,
    measurePlaqueText: fallbackPlaqueTextMeasure };
  const iterator = measurePlaqueLayoutJob(input);
  let next = iterator.next(); while (!next.done) next = iterator.next();
  const job = structuredClone(next.value);
  assert(job.plaques.size > 0, 'authored IDs resolve to the stable lexical display aliases during probing');
  assert.doesNotThrow(() => runPlaqueLayoutJob(job));
  job.plaques.clear();
  assert.throws(() => runPlaqueLayoutJob(job), /Missing measured text/, 'missing native metrics cannot silently use fallback ink');
});

test('measurement captures a plaque predicate before and after its head becomes complex', () => {
  const actor = { id: 'actor', label: 'DP', word: 'Mia' };
  const before = { id: 'clause', label: 'TP', children: [actor, { id: 'predicate', label: 'V', word: 'go' }] };
  const after = { id: 'clause', label: 'TP', children: [actor, { id: 'predicate', label: 'V', children: [
    { id: 'tense', label: 'T', word: 'will' }, { id: 'verb', label: 'V', word: 'go' }
  ] }] };
  const items = [{ kind: 'node-plaque', plaqueStyle: 'theta-grid', anchorNodeIds: ['predicate'], rows: [],
    thetaRoles: [{ label: 'Agent', index: 'i', nodeId: 'actor' }], relationRef: { stageIndex: 0, relationIndex: 0 } }];
  const input = { steps: [before, after].map((replayCanvasData, replayStageStepIndex) => ({
    replayFrameIndex: 0, replayStageStepIndex, replayKind: replayStageStepIndex ? 'macro' : 'relation', replayCanvasData,
    replayRelationLinks: []
  })), stageIndex: 0, completedCanvas: after, plan: { frames: [{ items }] }, width: 1596, height: 1016,
    measurePlaqueText: fallbackPlaqueTextMeasure };
  const iterator = measurePlaqueLayoutJob(input);
  let next = iterator.next();
  while (!next.done) next = iterator.next();
  const measuredTexts = new Set([...next.value.plaques.keys()].map(key => JSON.parse(key)[0]));
  assert(measuredTexts.has('go'), 'the earlier simple predicate has measured text');
  assert(measuredTexts.has('V'), 'the later complex predicate has measured text');
});

test('serialized allocation preserves measured text, all future reservations and every placement', async () => {
  const record = JSON.parse(readFileSync(new URL('../fixtures/visual-relations/successive-head-movement.json', import.meta.url)));
  const replay = prepareReplay({ ...record, includePlayback: true });
  replay.relationRenderPlan.frames.forEach((frame, stageIndex) => frame.items.push({
    kind: 'node-plaque', plaqueStyle: 'theta-grid', anchorNodeIds: ['vm'], rows: [],
    thetaRoles: [{ label: 'A long role whose text wraps without losing its exact characters', index: 'i', nodeId: 'im' }],
    relationRef: { stageIndex, relationIndex: 90 }
  }, {
    kind: 'node-plaque', plaqueStyle: 'realization', anchorNodeIds: ['vm', 'im'],
    rows: [{ label: 'surfaceForm', value: '샀다' }], realizationRowKinds: ['literal'],
    relationRef: { stageIndex, relationIndex: 91 }
  }, {
    kind: 'node-plaque', plaqueStyle: 'feature', anchorNodeIds: ['vm'],
    rows: [{ label: 'clauseType', value: 'direct constituent question' }],
    relationRef: { stageIndex, relationIndex: 92 }
  }));
  const input = { steps: replay.playbackSteps, stageIndex: 0, plan: replay.relationRenderPlan,
    width: 1596, height: 1016, layoutGroups: buildStageLayoutGroups(replay.playbackSteps, replay.replayDerivationFrames),
    completedCanvas: buildRenderableDerivationCanvasData(record.derivationStages.at(-1).workspaceForest),
    measureCategoryText: text => [...text].length * 21.125,
    measurePlaqueText: (text, style) => ({ ...fallbackPlaqueTextMeasure(text, style), width: [...text].length * style.fontSize * .58 }) };
  const iterator = measurePlaqueLayoutJob(input);
  let next = iterator.next(), stages = 0;
  while (!next.done) { stages++; next = iterator.next(); }
  assert(stages >= replay.relationRenderPlan.frames.length, 'measurement yields between nodes and canvases');
  const job = structuredClone(next.value);
  assert(job.categories.size > 0 && job.plaques.size > 0);
  const expected = buildReplayPlaqueSchedule(input);
  assert.equal(expected.stages.length, replay.relationRenderPlan.frames.length);
  assert(expected.steps.size > 0, 'movement layouts retain their absolute Replay step keys');
  const stagePlacements = new Map();
  for (const [index, step] of replay.playbackSteps.entries()) {
    const placements = stagePlacements.get(step.replayFrameIndex) ?? new Set();
    placements.add(JSON.stringify([...selectReplayPlaqueLayout(expected, step.replayFrameIndex, index)]));
    stagePlacements.set(step.replayFrameIndex, placements);
  }
  assert([...stagePlacements.values()].some(placements => placements.size > 1),
    'the round-trip fixture exercises different movement placements within one authored stage');
  assert.deepEqual(runPlaqueLayoutJob(job).schedule, expected);
  const worker = new Worker(new URL('./support/plaqueLayoutWorkerBridge.mjs', import.meta.url));
  try {
    const response = once(worker, 'message');
    worker.postMessage(job);
    const actual = (await response)[0];
    assert.deepEqual(actual.result.schedule, expected);
    assert(actual.result.coordinates instanceof Map);
    expected.stages.forEach((layout, stageIndex) => {
      assert.deepEqual(selectReplayPlaqueLayout(actual.result.schedule, stageIndex, replay.playbackSteps.length), layout,
        'a missing Replay step falls back to its completed stage placement');
    });
    for (const [index, step] of replay.playbackSteps.entries()) {
      assert.deepEqual(selectReplayPlaqueLayout(actual.result.schedule, step.replayFrameIndex, index),
        selectReplayPlaqueLayout(expected, step.replayFrameIndex, index), 'worker cloning preserves the selected placement for every step');
    }
  } finally { await worker.terminate(); }
  job.categories.delete(job.categories.keys().next().value);
  assert.throws(() => runPlaqueLayoutJob(job).schedule, /Missing measured text/);
});

// A resize reuses the painted Replay layout only when the viewport key is unchanged.
test('viewports with the same layout key prepare identical coordinates and plaques', () => {
  const load = path => JSON.parse(readFileSync(new URL(`../fixtures/${path}`, import.meta.url)));
  const holdouts = load('movement/holdout-transitions.json');
  const cases = [
    ['movement and plaques', holdouts[2], ['ltr', 'rtl']],
    ['workspaces', load('replay-regressions/workspace-reservation.json').cases[2], ['ltr']]
  ];
  for (const [name, record, directions] of cases) for (const direction of directions) {
    const replay = prepareReplay({ ...record, includePlayback: true });
    const base = { steps: replay.playbackSteps, stageIndex: 0, plan: replay.relationRenderPlan, direction,
      layoutGroups: buildStageLayoutGroups(replay.playbackSteps, replay.replayDerivationFrames),
      completedCanvas: buildRenderableDerivationCanvasData(record.derivationStages.at(-1).workspaceForest),
      measureCategoryText: text => [...text].length * 21.125,
      measurePlaqueText: (text, style) => ({ ...fallbackPlaqueTextMeasure(text, style), width: [...text].length * style.fontSize * .58 }) };
    const layout = (width, height) => {
      const iterator = measurePlaqueLayoutJob({ ...base, width, height });
      let next = iterator.next();
      while (!next.done) next = iterator.next();
      const { coordinates, schedule } = runPlaqueLayoutJob(next.value);
      return { key: plaqueLayoutViewportKey({ ...base, width, height }), coordinates, schedule };
    };
    const reference = layout(1200, 750);
    assert(reference.schedule.stages.some(stage => stage?.size), `${name} exercises plaque placement`);
    // Height alone never changes layout, even where it sets a stage's vertical
    // layout size; this width stays within every stage's own horizontal size.
    for (const [width, height] of [[1200, 2400], [1600, 420]]) {
      const other = layout(width, height);
      assert.equal(other.key, reference.key, `${name} ${direction} ${width}x${height}`);
      assert.deepEqual(other.coordinates, reference.coordinates, `${name} ${direction} ${width}x${height} coordinates`);
      assert.deepEqual(other.schedule, reference.schedule, `${name} ${direction} ${width}x${height} plaques`);
    }
  }
  const small = prepareReplay({ ...holdouts[5], includePlayback: true });
  const key = width => plaqueLayoutViewportKey({ steps: small.playbackSteps, plan: small.relationRenderPlan,
    layoutGroups: buildStageLayoutGroups(small.playbackSteps, small.replayDerivationFrames), width, height: 750 });
  assert.notEqual(key(1600), key(1200), 'a width that changes a stage layout size requests a new layout');
});
