import { categoryMetricKey } from './categoryMetricKey.ts';
import type { CategoryTextMeasure } from './categoryTextLayout.ts';
import { collectTreeInkMeasurements, type TreeInkTextMeasure } from './treeInkGeometry.ts';
import type { PlaybackStep } from './replayCompiler.ts';
import type { SyntaxNode } from '../types.ts';

type MetricKeys = {
  material: Array<[string, string | undefined]>;
  measured: WeakMap<TreeInkTextMeasure, Map<string, string>>;
};
const metricKeys = new WeakMap<readonly PlaybackStep[], MetricKeys>();

/** Every fresh collector receives the same glyph probes as the collision guard
 * before equal measured values reuse a plan. Callbacks represent immutable font
 * states; wrapping remains part of their memoization context. */
export function treeInkMetricKey(steps: readonly PlaybackStep[], measureCategoryText?: CategoryTextMeasure,
  measureTreeInk?: TreeInkTextMeasure): string {
  const categoryMetrics = categoryMetricKey(steps, measureCategoryText);
  if (!measureTreeInk) return 'unmeasured';
  let keys = metricKeys.get(steps);
  if (!keys) {
    const material = new Map<string, [string, string | undefined]>(), seen = new Set<SyntaxNode>();
    const visit = (node: SyntaxNode) => {
      if (seen.has(node)) return;
      seen.add(node);
      const pair: [string, string | undefined] = [node.label || '', node.word];
      material.set(JSON.stringify(pair), pair);
      node.children?.forEach(visit);
    };
    steps.forEach(step => { if (step.replayCanvasData) visit(step.replayCanvasData); });
    keys = { material: [...material].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, pair]) => pair),
      measured: new WeakMap() };
    metricKeys.set(steps, keys);
  }
  let contexts = keys.measured.get(measureTreeInk);
  if (!contexts) keys.measured.set(measureTreeInk, contexts = new Map());
  const cached = contexts.get(categoryMetrics);
  if (cached !== undefined) return cached;
  const values = keys.material.map(([label, word]) =>
    [label, word, collectTreeInkMeasurements(label, word, measureCategoryText, measureTreeInk)]);
  const key = JSON.stringify(values, (_name, value) => typeof value === 'number'
    ? Object.is(value, -0) ? '-0' : String(value) : value);
  contexts.set(categoryMetrics, key);
  return key;
}
