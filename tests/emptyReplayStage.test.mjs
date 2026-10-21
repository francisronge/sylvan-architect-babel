import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { selectReplayCanvas } from '../components/replayStepCanvas.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildRenderableCommittedCanvasData, buildRenderableDerivationCanvasData } from '../replay/replayCanvas.ts';
import { buildStageCameraBounds, buildStageCameraFit } from '../replay/stageCamera.ts';
import { normalizeParseBundle } from '../server/babelParser/parseNormalization.js';

const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/raw/mia-laughed.xbar.json', import.meta.url), 'utf8'));
const emptyStage = { statement: 'Nothing has entered the derivation.', stageRecord: 'The workspace is empty.',
  relations: [], workspaceForest: [] };

const replayWithEmptyFirstStage = () => {
  const payload = structuredClone(fixture.payload);
  payload.derivationStages = [emptyStage, ...payload.derivationStages];
  const bundle = normalizeParseBundle(payload, fixture.framework, fixture.sentence, fixture.modelRoute, true,
    { payloadIntegrityFlags: [] });
  const stages = bundle.analyses[0].derivationStages;
  return { stages, replay: prepareReplay({ derivationStages: stages, sentence: fixture.sentence,
    inputTokens: bundle.inputTokens, includePlayback: true }) };
};

const schedule = () => ({ stages: [], steps: new Map() });
const cameraInput = (replay, stageIndex) => ({ steps: replay.playbackSteps, stageIndex, stepIndex: undefined,
  plan: replay.relationRenderPlan, width: 1200, height: 800, includeOverlays: true, plaqueSchedule: schedule(), plaqueLayout: new Map() });
// The app's call: the shared stage camera fit, with every measure key present.
const fit = (replay, stageIndex, forest) => buildStageCameraFit({ steps: replay.playbackSteps, stageIndex, stepIndex: undefined,
  completedCanvas: buildRenderableDerivationCanvasData(forest), plan: replay.relationRenderPlan, width: 1200, height: 800,
  plaqueSchedule: schedule(), measurePlaqueText: undefined, measureCategoryText: undefined, measureTreeInk: undefined,
  treeLabelRuns: undefined, measureTreeLabel: undefined });

test('normalization accepts an empty workspace before the final stage, and Replay plays it', () => {
  const { stages, replay } = replayWithEmptyFirstStage();
  assert.deepEqual(stages[0].workspaceForest, []);
  assert.equal(replay.playbackSteps[0].replayFrameIndex, 0);
});

test('an empty active stage contributes no stage camera bounds instead of throwing', () => {
  const { replay } = replayWithEmptyFirstStage();
  const forest = replay.replayDerivationFrames[0].workspaceForest;
  // The historical call framed a null canvas.
  assert.throws(() => buildStageCameraBounds({ ...cameraInput(replay, 0),
    completedCanvas: buildRenderableDerivationCanvasData(forest) }), TypeError);
  assert.deepEqual(fit(replay, 0, forest), { bounds: null, containment: null });
});

test('a stage with syntax keeps its existing camera bounds', () => {
  const { replay } = replayWithEmptyFirstStage();
  const forest = replay.replayDerivationFrames[1].workspaceForest;
  const expected = buildStageCameraBounds({ ...cameraInput(replay, 1),
    completedCanvas: buildRenderableDerivationCanvasData(forest) });
  assert.ok(expected);
  assert.deepEqual(fit(replay, 1, forest).bounds, expected);
});

const canvasFor = (replay, step, data) => selectReplayCanvas({ usesDerivationFrames: true, animated: true,
  stepCanvas: step.replayCanvasData, activeForest: replay.replayDerivationFrames[step.replayFrameIndex].workspaceForest,
  committedCanonicalCanvas: buildRenderableCommittedCanvasData(data),
  committedDerivationCanvas: buildRenderableDerivationCanvasData(replay.replayDerivationFrames.at(-1).workspaceForest), data });

test('an empty stage step paints an empty canvas, not the committed tree', () => {
  const { stages, replay } = replayWithEmptyFirstStage();
  const data = buildRenderableDerivationCanvasData(stages.at(-1).workspaceForest);
  const [emptyStep, ...laterSteps] = replay.playbackSteps;
  // Without its own canvas or visible ids, the old fallback painted the whole final tree here.
  assert.equal(emptyStep.replayCanvasData, null);
  assert.deepEqual(emptyStep.replayVisibleNodeIds, []);
  assert.equal(canvasFor(replay, emptyStep, data), null);
  for (const step of laterSteps) assert.equal(canvasFor(replay, step, data), step.replayCanvasData);
});
