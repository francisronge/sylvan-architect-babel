import type { HierarchyPointNode } from 'd3';
import type { SyntaxNode } from '../../types.ts';
import { categoryTextLayout, type CategoryTextMeasure } from '../categoryTextLayout.ts';
import { isWordlessCategoryLeaf, resolveLeafSurface, shouldExpandPreterminalLeaf } from '../replayCompiler.ts';
import type { Rect } from './overlayGeometry.ts';

/** The accepted ellipse circumscribes every corner of the padded domain rectangle. */
export function bindingDomainEllipse(rect: Rect) {
  return {
    cx: rect.x + rect.width / 2,
    cy: rect.y + rect.height / 2,
    rx: (rect.width / 2 + 34) * Math.SQRT2,
    ry: (rect.height / 2 + 26) * Math.SQRT2
  };
}

export function bindingEllipseBounds(ellipse: ReturnType<typeof bindingDomainEllipse>) {
  return { minX: ellipse.cx - ellipse.rx - 8, maxX: ellipse.cx + ellipse.rx + 8,
    minY: ellipse.cy - ellipse.ry - 8, maxY: ellipse.cy + ellipse.ry + 8 };
}

/** Reserve the whole rendered domain, including words below their category nodes. */
export function bindingDomainTreeRect(nodes: readonly HierarchyPointNode<SyntaxNode>[], measureText?: CategoryTextMeasure): Rect | null {
  const rectangles: Rect[] = [];
  for (const node of nodes) {
    if (node.children?.length || shouldExpandPreterminalLeaf(node.data) || isWordlessCategoryLeaf(node.data)) {
      const label = categoryTextLayout(node.data.label || '', measureText);
      rectangles.push({ x: node.x + label.x - 8, y: node.y + label.y - 8,
        width: label.width + 16, height: label.height + 16 });
    }
    if (!node.children?.length && !isWordlessCategoryLeaf(node.data)) {
      const text = resolveLeafSurface(node);
      if (!text) continue;
      // Terminal ink uses the same font at 56px instead of 42px. Allow the
      // italic overhang and the terminal's separately displayed chain index.
      const width = (measureText ? measureText(text) * 56 / 42 : [...text].length * 56) + 56;
      rectangles.push({ x: node.x - width / 2, y: node.y + 55, width, height: 100 });
    }
  }
  if (!rectangles.length) return null;
  const x = Math.min(...rectangles.map(rect => rect.x)), y = Math.min(...rectangles.map(rect => rect.y));
  return { x, y, width: Math.max(...rectangles.map(rect => rect.x + rect.width)) - x,
    height: Math.max(...rectangles.map(rect => rect.y + rect.height)) - y };
}
