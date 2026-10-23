/** Lay out every prepared Replay frame in production order: stage layout groups,
 * stage sizes, stage coordinate reservations, then one tree layout per frame.
 * Replay modules are injected so the corpus comparator can measure another
 * checkout's sources with this harness. Each scene's `nodes` holds only the
 * visible, non-scaffold syntax the frame paints.
 *
 * With `measured`, layout follows the browser rather than the unmeasured
 * reservations: the plaque worker job (module `plaqueJob`) supplies coordinates
 * and the plaque `schedule` from measured text, each scene keeps its whole
 * laid-out `tree` and `visible` ids with unary terminals aligned as the painter
 * aligns them (module `notation`), and `stageCamera(stage, completedStep)` gives
 * the stage camera `bounds` and plaque `containment` that TreeVisualizer passes
 * to fitTreeCamera (module `canvas` builds each stage's completed canvas).
 * `measured` = { plan, protectedNodeIds, treeLabelRuns, measurePlaqueText,
 * measureCategoryText, measureTreeInk, measureTreeLabel, pocketOccupants? }; with
 * `pocketOccupants` the schedule keeps what its hold pass saw at each step
 * (stageCamera.ts, replayPocketOccupants). */
export function layoutReplayFrames({ steps, stages, width, height, direction, measured },
  { coordinates, camera, layout, display, d3, plaqueJob, notation, canvas }) {
  const groups = camera.buildStageLayoutGroups(steps, stages);
  const sizes = new Map(stages.map((_, index) => [index,
    camera.stageTreeLayoutSize(steps, index, width, height, groups)]));
  const completed = stage => canvas.buildRenderableDerivationCanvasData(stages[stage]?.workspaceForest || []);
  const { pocketOccupants = false, ...measures } = measured ?? {};
  const input = measured && { ...measures, steps, stageIndex: 0, completedCanvas: completed(stages.length - 1),
    width, height, direction, abstractionMode: false, layoutGroups: groups };
  let positions, schedule = null, stageCoordinates = null;
  if (measured) {
    const measuring = plaqueJob.measurePlaqueLayoutJob(input);
    let next = measuring.next();
    while (!next.done) next = measuring.next();
    const prepared = plaqueJob.bindPlaqueLayoutResult(input, next.value, plaqueJob.runPlaqueLayoutJob(next.value, undefined, { pocketOccupants }));
    ({ schedule, coordinates: stageCoordinates } = prepared);
    positions = new Map([...prepared.coordinates.values()].flatMap(stage => [...stage]));
  } else positions = new Map([...sizes].flatMap(([index, size]) => {
    if (!size) throw Error(`Missing layout size for stage ${index}`);
    return [...coordinates.buildStageCoordinateReservations(steps, index, size, stage => sizes.get(stage), direction)];
  }));
  const draw = (scene, points) => {
    const tree = d3.hierarchy(scene.canvas); display.applyVizIds(tree);
    if (!measured) return layout.layoutSyntaxTree(tree, sizes.get(scene.step.replayFrameIndex), direction, points, scene.visible);
    const visible = scene.step.replayVisibleNodeIds?.length ? scene.visible : null;
    const laid = layout.layoutSyntaxTree(tree, sizes.get(scene.step.replayFrameIndex), direction, points,
      points ? visible ?? undefined : undefined, { measureCategoryText: measured.measureCategoryText, measureTreeInk: measured.measureTreeInk });
    notation.alignReplayUnaryTerminalLeaves(laid, visible);
    return laid;
  };
  const render = (scene, points) => draw(scene, points).descendants().filter(node => scene.visible.has(display.getNodeId(node))
    && !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace');
  const scenes = steps.map(step => {
    const scene = { step, canvas: step.replayCanvasData, visible: new Set((step.replayVisibleNodeIds ?? []).map(String)) };
    if (measured) scene.tree = draw(scene, positions.get(scene.canvas));
    scene.nodes = new Map((measured ? scene.tree.descendants().filter(node => scene.visible.has(display.getNodeId(node))
      && !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace') : render(scene, positions.get(scene.canvas)))
      .map(node => [display.getNodeId(node), node]));
    return scene;
  });
  const cameras = new Map();
  const stageCamera = (stage, completedStep) => {
    const key = `${stage}:${completedStep}`;
    if (!cameras.has(key)) {
      // TreeVisualizer's own call: the same function with the same measures.
      const { plan, protectedNodeIds, measurePlaqueText, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel } = measured;
      cameras.set(key, camera.buildStageCameraFit({ steps, stageIndex: stage, stepIndex: completedStep, completedCanvas: completed(stage),
        plan, width, height, direction, abstractionMode: false, protectedNodeIds,
        plaqueSchedule: schedule, coordinates: stageCoordinates, layoutGroups: groups,
        measurePlaqueText, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel }));
    }
    return cameras.get(key);
  };
  return { sizes, positions, render, scenes, schedule, ...(measured ? { stageCamera } : {}) };
}
