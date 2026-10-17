/** Lay out every prepared Replay frame in production order: stage layout groups,
 * stage sizes, stage coordinate reservations, then one tree layout per frame.
 * Replay modules are injected so the corpus comparator can measure another
 * checkout's sources with this harness. Each scene's `nodes` holds only the
 * visible, non-scaffold syntax the frame paints. */
export function layoutReplayFrames({ steps, stages, width, height, direction }, { coordinates, camera, layout, display, d3 }) {
  const groups = camera.buildStageLayoutGroups(steps, stages);
  const sizes = new Map(stages.map((_, index) => [index,
    camera.stageTreeLayoutSize(steps, index, width, height, groups)]));
  const positions = new Map([...sizes].flatMap(([index, size]) => {
    if (!size) throw Error(`Missing layout size for stage ${index}`);
    return [...coordinates.buildStageCoordinateReservations(steps, index, size, stage => sizes.get(stage), direction)];
  }));
  const render = (scene, points) => {
    const tree = d3.hierarchy(scene.canvas); display.applyVizIds(tree);
    const visible = new Set(scene.step.replayVisibleNodeIds);
    return layout.layoutSyntaxTree(tree, sizes.get(scene.step.replayFrameIndex), direction, points, visible)
      .descendants().filter(node => visible.has(display.getNodeId(node))
        && !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace');
  };
  const scenes = steps.map(step => {
    const scene = { step, canvas: step.replayCanvasData };
    scene.nodes = new Map(render(scene, positions.get(scene.canvas)).map(node => [display.getNodeId(node), node]));
    return scene;
  });
  return { sizes, positions, render, scenes };
}
