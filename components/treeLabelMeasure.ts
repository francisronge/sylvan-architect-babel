import { CATEGORY_FONT, CATEGORY_LINE_HEIGHT } from '../replay/categoryTextLayout.ts';
import { treeLabelRunKey, treeLabelIndexAttributes, type TreeLabelMeasure, type TreeLabelBounds } from '../replay/treeLabelRuns.ts';
import { createTreeInkTextMeasure, TERMINAL_FONT } from './treeInkTextMeasure.ts';
import type { TreeInkTextMeasure } from '../replay/treeInkGeometry.ts';

const namespace = 'http://www.w3.org/2000/svg';

/** Measure the complete styled label, including the browser's subscript shift,
 * text anchoring and arbitrary authored indices. Call after fonts are ready. */
export function createTreeLabelMeasure(doc: Document | undefined): TreeLabelMeasure {
  const cache = new Map<string, TreeLabelBounds | undefined>();
  let plainText: TreeInkTextMeasure | undefined;
  try { plainText = createTreeInkTextMeasure(doc); } catch { /* Keep the native SVG envelope. */ }
  return runs => {
    const key = treeLabelRunKey(runs);
    if (cache.has(key)) return cache.get(key);
    let result: TreeLabelBounds | undefined;
    if (!doc?.body) return;
    const svg = doc.createElementNS(namespace, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;overflow:visible';
    try {
      const label = doc.createElementNS(namespace, 'text');
      const terminal = runs.kind === 'terminal';
      label.style.font = terminal ? TERMINAL_FONT : CATEGORY_FONT;
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('y', terminal ? '115' : '-10');
      if (!terminal) label.setAttribute('xml:space', 'preserve');
      if (runs.lines) {
        runs.lines.forEach((line, index) => {
          const span = doc.createElementNS(namespace, 'tspan');
          span.setAttribute('x', '0');
          span.setAttribute('y', String(-10 - (runs.lines!.length - 1 - index) * CATEGORY_LINE_HEIGHT));
          span.textContent = line;
          label.appendChild(span);
        });
      } else label.textContent = runs.text;
      runs.indices.forEach(run => {
        const span = doc.createElementNS(namespace, 'tspan');
        for (const [name,value] of Object.entries(treeLabelIndexAttributes(runs.kind, run.mode))) span.setAttribute(name,value);
        span.textContent = run.text;
        label.appendChild(span);
      });
      svg.appendChild(label);
      doc.body.appendChild(svg);
      const box = label.getBBox();
      if ([box.x,box.y,box.width,box.height].every(Number.isFinite) && box.width > 0 && box.height > 0) {
        // Native getBBox excludes stroke. The painter's default miter limit is
        // 4, so a join may reach four half-widths beyond the glyph contour.
        const strokeReach = (terminal ? 4 : 5) * 4;
        result = {x:box.x-strokeReach,y:box.y-strokeReach,width:box.width+2*strokeReach,height:box.height+2*strokeReach};
        // SVG text boxes include the whole font cell. For a single-font label,
        // Canvas supplies actual glyph bounds at each exact painted baseline.
        // Styled indices retain the complete native SVG envelope instead.
        if (!runs.indices.length && plainText) {
          const lines = runs.lines ?? [runs.text];
          const glyphs = lines.map((text, index) => ({
            metrics: plainText!(text, runs.kind),
            baseline: runs.lines ? -10 - (lines.length - 1 - index) * CATEGORY_LINE_HEIGHT : terminal ? 115 : -10
          }));
          if (glyphs.length && glyphs.every(({metrics}) => metrics
            && [metrics.ascent, metrics.descent, metrics.ascent + metrics.descent].every(Number.isFinite) && metrics.ascent + metrics.descent > 0)) {
            const top = Math.min(...glyphs.map(({metrics,baseline}) => baseline - metrics!.ascent));
            const bottom = Math.max(...glyphs.map(({metrics,baseline}) => baseline + metrics!.descent));
            result = {...result,y:top-strokeReach,height:bottom-top+2*strokeReach};
          }
        }
      }
    } catch {
      // A missing SVG measurement retains the established conservative bounds.
    } finally {
      svg.remove();
    }
    cache.set(key,result);
    return result;
  };
}
