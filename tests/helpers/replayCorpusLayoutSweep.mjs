/** The layout sweep of tests/replayCorpusLayout.test.mjs. Every committed analysis
 * is laid out in each reading direction with the unmeasured Replay layout of
 * scripts/replayFrameLayout.mjs, which the layout continuity tests check. The
 * contour sweep reads the left-to-right plans. The mirror check compares every
 * right-to-left frame with the left-to-right one, so a continuity check that
 * runs left to right also holds right to left wherever the mirror holds;
 * tests/helpers/rtlMirror.mjs lists where it does not.
 *
 * Records are independent, so `sweepFixtureLayouts` spreads them over worker
 * threads; each thread loads the same committed analyses and sweeps the records
 * it is handed, and the results come back in record order. */
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import * as d3 from 'd3';

import * as display from '../../replay/displayIdentity.ts';
import { prepareReplay } from '../../replay/prepareReplay.ts';
import * as camera from '../../replay/stageCamera.ts';
import * as coordinates from '../../replay/stageCoordinates.ts';
import * as layout from '../../replay/treeLayout.ts';
import { TREE_ROW_HEIGHT } from '../../replay/treeSpacing.ts';
import { layoutReplayFrames } from '../../scripts/replayFrameLayout.mjs';
import { loadFixtureAnalyses } from './replayInvariantCorpus.mjs';

// The viewports at which the continuity tests lay out committed analyses.
// Stage sizes do not depend on the viewport today, so each record is laid out
// once per direction; a record whose sizes come to differ between these
// viewports is also laid out, and mirrored, at each distinct one.
const VIEWPORTS = [[1600, 948], [1600, 1100], [1596, 1016], [1440, 900], [1408, 680], [390, 844], [386, 698]];
const modules = { coordinates, camera, layout, display, d3 };

// Each layout prepares its own Replay, as each continuity test does, so no
// plan cached for one direction can stand in for the other.
const prepare = record => prepareReplay({ ...structuredClone(record), includePlayback: true }).playbackSteps;
const frames = (steps, record, [width, height], direction) =>
  layoutReplayFrames({ steps, stages: record.derivationStages, width, height, direction }, modules);

/** One record's off-grid rows, contour plan statuses and mirror deviations. */
export function sweepRecord({ id, record }) {
  const steps = prepare(record), groups = camera.buildStageLayoutGroups(steps, record.derivationStages);
  const viewports = new Map();
  for (const viewport of VIEWPORTS) {
    const key = JSON.stringify(record.derivationStages.map((_, stage) => camera.stageTreeLayoutSize(steps, stage, ...viewport, groups)));
    if (!viewports.has(key)) viewports.set(key, viewport);
  }
  const [first, ...others] = viewports.values(), ltr = frames(steps, record, first, 'ltr');
  // The contour check matches rows by their y; it relies on the shared row grid.
  const offGrid = steps.flatMap(step => (step.replayVisibleNodeIds ?? []).flatMap(node => {
    const y = ltr.positions.get(step.replayCanvasData)?.get(node)?.y;
    return y !== undefined && Math.abs(y / TREE_ROW_HEIGHT - Math.round(y / TREE_ROW_HEIGHT)) >= 1e-9 ? [`${id}: ${node} at y=${y}`] : [];
  }));
  const statuses = coordinates.getContourPlanStatuses(steps);
  const deviations = [[first, ltr], ...others.map(viewport => [viewport, frames(prepare(record), record, viewport, 'ltr')])]
    .flatMap(([viewport, left]) => {
      const deviation = mirrorDeviation(left.scenes, frames(prepare(record), record, viewport, 'rtl').scenes);
      return deviation ? [{ viewport, ...deviation }] : [];
    });
  return { id, offGrid, statuses, deviations };
}

/** How a right-to-left Replay departs from the reflection of its left-to-right
 * Replay, or null. Reflected, every frame paints the same syntax on the same
 * rows, and x_ltr + x_rtl is one axis across the whole Replay. Kinds:
 * - `not-mirrored`: a frame paints other syntax, another row, or a reflection
 *   about more than one axis;
 * - `frame-axis`: frames of one stage are reflected about different axes, so
 *   syntax moves in one direction where it stays in the other;
 * - `stage-axis`: each stage is reflected about its own axis, so at a stage
 *   boundary the right-to-left drawing translates against the left-to-right one. */
function mirrorDeviation(ltr, rtl) {
  const axes = new Map();
  for (const [index, { step, nodes: left }] of ltr.entries()) {
    const stage = step.replayFrameIndex, right = rtl[index].nodes;
    const frame = index + 1, deviation = detail => ({ kind: 'not-mirrored', frame, detail });
    const missing = [...left.keys()].filter(id => !right.has(id)), extra = [...right.keys()].filter(id => !left.has(id));
    if (missing.length || extra.length) return deviation(`paints [${missing}] only left to right and [${extra}] only right to left`);
    for (const [id, node] of left) {
      const mirror = right.get(id), axis = node.x + mirror.x;
      if (Math.abs(node.y - mirror.y) > 1e-6) return deviation(`${id} is at y ${mirror.y}, not ${node.y}`);
      if (!axes.has(stage)) axes.set(stage, { axis, frame, id });
      const first = axes.get(stage);
      if (Math.abs(axis - first.axis) <= 1e-6) continue;
      return first.frame === frame ? deviation(`${id} reflects about ${axis}, ${first.id} about ${first.axis}`)
        : { kind: 'frame-axis', frame, detail: `stage ${stage + 1} reflects about ${axis} at ${id}, about ${first.axis} at frame ${first.frame}` };
    }
  }
  const distinct = new Set([...axes.values()].map(({ axis }) => axis.toFixed(6)));
  return distinct.size > 1 ? { kind: 'stage-axis', frame: null,
    detail: `stage axes ${[...axes].map(([stage, { axis }]) => `${stage + 1}:${axis}`).join(' ')}` } : null;
}

/** Every committed analysis's sweep, in record order, from up to `jobs` threads. */
export function sweepFixtureLayouts(jobs = Math.min(4, availableParallelism())) {
  const count = loadFixtureAnalyses().records.length, results = new Array(count);
  if (!count) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    let next = 0, done = 0, failed = false;
    const workers = Array.from({ length: Math.max(1, Math.min(jobs, count)) }, () => new Worker(new URL(import.meta.url)));
    const finish = error => {
      if (failed) return;
      if (error) failed = true;
      workers.forEach(worker => worker.terminate());
      error ? reject(error) : resolve(results);
    };
    const feed = worker => { if (next < count) worker.postMessage(next++); };
    for (const worker of workers) {
      worker.on('message', ({ index, result, error }) => {
        if (error) { finish(Error(`Sweeping record ${index} failed: ${error}`)); return; }
        results[index] = result;
        if (++done === count) finish(); else feed(worker);
      });
      worker.on('error', finish);
      worker.on('exit', code => { if (code && done < count) finish(Error(`A layout sweep worker exited with code ${code}`)); });
      feed(worker);
    }
  });
}

if (!isMainThread) {
  const records = loadFixtureAnalyses().records;
  parentPort.on('message', index => {
    try { parentPort.postMessage({ index, result: sweepRecord(records[index]) }); }
    catch (error) { parentPort.postMessage({ index, error: error?.stack ?? String(error) }); }
  });
}
