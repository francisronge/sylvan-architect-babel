import { categoryTextLayout, type CategoryTextMeasure } from './categoryTextLayout.ts';
import type { PlaybackStep } from './replayCompiler.ts';
import type { SyntaxNode } from '../types.ts';

type MetricKeys = { labels: string[]; measured: WeakMap<CategoryTextMeasure, string>; fallback?: string };
const metricKeys = new WeakMap<readonly PlaybackStep[], MetricKeys>();
/** Equal layout and line-ink measurements share geometry. A new callback is
 * measured before cache lookup so collector wrappers receive every text probe.
 * Each callback represents one immutable font state, as in the renderer. */
export function categoryMetricKey(steps: readonly PlaybackStep[], measure?: CategoryTextMeasure): string {
  let keys = metricKeys.get(steps);
  if (!keys) {
    const labels = new Set<string>(), seen = new Set<SyntaxNode>();
    const visit = (node: SyntaxNode) => {
      if (seen.has(node)) return;
      seen.add(node); labels.add(node.label || '');
      node.children?.forEach(visit);
    };
    steps.forEach(step => { if (step.replayCanvasData) visit(step.replayCanvasData); });
    keys = { labels: [...labels].sort(), measured: new WeakMap() };
    metricKeys.set(steps, keys);
  }
  const cached = measure ? keys.measured.get(measure) : keys.fallback;
  if (cached !== undefined) return cached;
  const values = keys.labels.map(label => {
    const layout = categoryTextLayout(label, measure);
    const lineWidths = layout.lines.map(line => measure?.(line) ?? [...line].length * 25);
    return [label, layout, lineWidths];
  });
  const key = JSON.stringify(values, (_name, value) => typeof value === 'number'
    ? Object.is(value, -0) ? '-0' : String(value) : value);
  if (measure) keys.measured.set(measure, key); else keys.fallback = key;
  return key;
}
