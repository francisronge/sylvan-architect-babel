import type { SyntaxNode } from '../types.ts';
import type { CategoryTextMeasure } from './categoryTextLayout.ts';
import type { PreparedReplay } from './prepareReplay.ts';
import { treeLabelRunsForStep, treeLabelRunKey, type PreparedTreeLabelRuns, type TreeLabelRuns } from './treeLabelRuns.ts';

/** A canvas may be reused at several relation moments. Keep every exact label
 * variant on that canvas so its shared reservation covers each painted state. */
export function prepareTreeLabelRuns(prepared: PreparedReplay, measureCategoryText?: CategoryTextMeasure,
  options: { includeRelationIndices?: boolean } = {}): PreparedTreeLabelRuns {
  const canvases = new Map<SyntaxNode, Map<string, Map<string, TreeLabelRuns>>>();
  prepared.playbackSteps.forEach((step, stepIndex) => {
    const canvas = step.replayCanvasData;
    if (!canvas) return;
    let nodes = canvases.get(canvas);
    if (!nodes) canvases.set(canvas, nodes = new Map());
    for (const [id, runs] of treeLabelRunsForStep(prepared, stepIndex, measureCategoryText, options)) {
      let variants = nodes.get(id);
      if (!variants) nodes.set(id, variants = new Map());
      for (const run of runs) variants.set(treeLabelRunKey(run), run);
    }
  });
  return new Map([...canvases].map(([canvas, nodes]) => [canvas,
    new Map([...nodes].map(([id, runs]) => [id, [...runs.values()]]))]));
}
