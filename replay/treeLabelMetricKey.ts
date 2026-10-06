import type { SyntaxNode } from '../types.ts';
import type { PlaybackStep } from './replayCompiler.ts';
import { treeLabelRunKey, type PreparedTreeLabelRuns, type TreeLabelRuns, type TreeLabelMeasure } from './treeLabelRuns.ts';

type Material = {
  assignment: Array<[number, Array<[string, string[]]>]>;
  requests: Array<[string, TreeLabelRuns]>;
  measured: WeakMap<TreeLabelMeasure, string>;
};
const cache = new WeakMap<readonly PlaybackStep[], WeakMap<PreparedTreeLabelRuns, Material>>();

/** A fresh collector always receives every complete styled run before equal
 * values reuse geometry. Callbacks and descriptor maps are immutable inputs. */
export function treeLabelMetricKey(steps: readonly PlaybackStep[], labels?: PreparedTreeLabelRuns,
  measure?: TreeLabelMeasure): string {
  if (!labels) return 'unprepared';
  if (!measure) return 'unmeasured';
  let byLabels = cache.get(steps);
  if (!byLabels) cache.set(steps, byLabels = new WeakMap());
  let material = byLabels.get(labels);
  if (!material) {
    const canvases = new Set<SyntaxNode>(), requests = new Map<string, TreeLabelRuns>();
    const assignment: Material['assignment'] = [];
    for (const step of steps) {
      const canvas = step.replayCanvasData;
      if (!canvas || canvases.has(canvas)) continue;
      canvases.add(canvas);
      const nodes: Array<[string, string[]]> = [...labels.get(canvas) ?? []]
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([id, variants]) => [id, variants.map(run => {
          const key = treeLabelRunKey(run);
          requests.set(key, run);
          return key;
        })]);
      assignment.push([canvases.size - 1, nodes]);
    }
    material = { assignment, requests: [...requests].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
      measured: new WeakMap() };
    byLabels.set(labels, material);
  }
  const cached = material.measured.get(measure);
  if (cached !== undefined) return cached;
  const values = material.requests.map(([request, run]) => {
    const bounds = measure(run);
    return [request, bounds && [bounds.x, bounds.y, bounds.width, bounds.height]];
  });
  const key = JSON.stringify([material.assignment, values], (_name, value) => typeof value === 'number'
    ? Object.is(value, -0) ? '-0' : String(value) : value);
  material.measured.set(measure, key);
  return key;
}
