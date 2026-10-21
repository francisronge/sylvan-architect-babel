import {
  CATEGORY_FONT, CATEGORY_INDEX_FONT, INDEX_LABEL, TERMINAL_FONT, TERMINAL_INDEX_FONT
} from '../replay/rendererMetrics.ts';
import type { TreeInkTextMeasure, TreeInkTextMetrics, TreeInkTextStyle } from '../replay/treeInkGeometry.ts';

const svgNamespace = 'http://www.w3.org/2000/svg';

/** SVG owns the font's subscript baseline. Measure the two painted index forms
 * once, rather than estimating that browser-specific offset from font size. */
function measureIndex(doc: Document, text: string, terminal: boolean): TreeInkTextMetrics | undefined {
  if (!doc.body) return;
  const svg = doc.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;overflow:visible';
  const label = doc.createElementNS(svgNamespace, 'text');
  label.style.font = terminal ? TERMINAL_FONT : CATEGORY_FONT;
  const index = doc.createElementNS(svgNamespace, 'tspan');
  index.style.font = terminal ? TERMINAL_INDEX_FONT : CATEGORY_INDEX_FONT;
  index.textContent = text;
  label.appendChild(index);
  svg.appendChild(label);
  try {
    doc.body.appendChild(svg);
    index.setAttribute('baseline-shift', 'sub');
    const identity = index.getBBox();
    index.removeAttribute('baseline-shift');
    index.setAttribute('dy', String(INDEX_LABEL[terminal ? 'terminal' : 'category'].thetaDy));
    const theta = index.getBBox();
    if ([identity, theta].some(box => ![box.x, box.y, box.width, box.height].every(Number.isFinite)
      || box.width <= 0 || box.height <= 0)) return;
    const left = Math.min(identity.x, theta.x), right = Math.max(identity.x + identity.width, theta.x + theta.width);
    const ascent = -Math.min(identity.y, theta.y), descent = Math.max(identity.y + identity.height, theta.y + theta.height);
    return { width: Math.max(identity.width, theta.width), left, right, ascent, descent,
      fontAscent: Math.max(0, ascent), fontDescent: Math.max(0, descent) };
  } finally {
    svg.remove();
  }
}

/** A cached measure that lists the runs it measured, read only after a font load. */
export type MeasuredRunSource<A extends unknown[]> = { runs(): Iterable<{ args: A; result: unknown }> };

/** Call only after the visualizer's font readiness gate. A new font pass creates
 * a new cache; unavailable measurements retain the established layout envelope. */
export function createTreeInkTextMeasure(doc: Document | undefined): TreeInkTextMeasure & MeasuredRunSource<[string, TreeInkTextStyle]> {
  const context = doc?.createElement('canvas').getContext('2d');
  const cache = new Map<string, { args: [string, TreeInkTextStyle]; result: TreeInkTextMetrics | undefined }>();
  const measure = (text: string, style: TreeInkTextStyle) => {
    const key = JSON.stringify([text, style]);
    const cached = cache.get(key);
    if (cached) return cached.result;
    let result: TreeInkTextMetrics | undefined;
    try {
      if (style === 'category-index' || style === 'terminal-index') {
        if (doc) result = measureIndex(doc, text, style === 'terminal-index');
      } else if (context) {
        context.font = style === 'category' ? CATEGORY_FONT : TERMINAL_FONT;
        context.textAlign = 'left';
        context.textBaseline = 'alphabetic';
        const measured = context.measureText(text);
        result = { width: measured.width, left: -measured.actualBoundingBoxLeft, right: measured.actualBoundingBoxRight,
          ascent: measured.actualBoundingBoxAscent, descent: measured.actualBoundingBoxDescent,
          fontAscent: measured.fontBoundingBoxAscent, fontDescent: measured.fontBoundingBoxDescent };
      }
    } catch {
      // A detached/unavailable SVG or unsupported metrics uses existing bounds.
    }
    cache.set(key, { args: [text, style], result });
    return result;
  };
  return Object.assign(measure, { runs: () => cache.values() });
}
