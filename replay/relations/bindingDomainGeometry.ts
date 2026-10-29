import type { HierarchyPointNode } from 'd3';
import type { SyntaxNode } from '../../types.ts';
import { categoryTextLayout, type CategoryTextMeasure } from '../categoryTextLayout.ts';
import { CATEGORY_LABEL, TERMINAL_LABEL } from '../rendererMetrics.ts';
import { isWordlessCategoryLeaf, resolveLeafSurface, shouldExpandPreterminalLeaf } from '../replaySurfaceNotation.ts';
import type { Rect } from './overlayGeometry.ts';
import { boundingRect } from './rectGeometry.ts';
import type { RelationPlanItem } from './renderPlan.ts';

/** Keep the accepted ellipse unless it includes syntax outside its authored domain.
 * The constrained variant fits actual member ink rather than empty rectangle corners. */
export function bindingDomainEllipse(rect: Rect, plaques: readonly Rect[] = [],
  members: readonly Rect[] = [], excluded: readonly Rect[] = []) {
  const ellipse = {
    cx: rect.x + rect.width / 2,
    cy: rect.y + rect.height / 2,
    rx: (rect.width / 2 + 34) * Math.SQRT2,
    ry: (rect.height / 2 + 26) * Math.SQRT2
  };
  const distance = (x: number, y: number) => ((x - ellipse.cx) / ellipse.rx) ** 2
    + ((y - ellipse.cy) / ellipse.ry) ** 2;
  let scale = 1;
  for (const plaque of plaques) {
    // A plaque placed inside the domain must fit completely. Outside plaques
    // stay outside; their attachment does not enlarge the linguistic domain.
    if (distance(plaque.x + plaque.width / 2, plaque.y + plaque.height / 2) >= 1) continue;
    for (const x of [plaque.x - 8, plaque.x + plaque.width + 8]) {
      for (const y of [plaque.y - 8, plaque.y + plaque.height + 8]) scale = Math.max(scale, Math.sqrt(distance(x, y)));
    }
  }
  const ordinary = scale === 1 ? ellipse : { ...ellipse, rx: ellipse.rx * scale, ry: ellipse.ry * scale };
  const nearestDistance = (shape: typeof ellipse, box: Rect) => {
    const x = Math.max(box.x, Math.min(shape.cx, box.x + box.width));
    const y = Math.max(box.y, Math.min(shape.cy, box.y + box.height));
    return ((x - shape.cx) / shape.rx) ** 2 + ((y - shape.cy) / shape.ry) ** 2;
  };
  if (!members.length || !excluded.some(box => nearestDistance(ordinary, box) < 1)) return ordinary;
  const content = [...members, ...plaques.filter(box => distance(box.x + box.width / 2, box.y + box.height / 2) < 1)
    .map(box => ({ x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 }))];
  const top = Math.min(...content.map(box => box.y)) - 26;
  const bottom = Math.max(...content.map(box => box.y + box.height)) + 26;
  const constrained = { cx: ordinary.cx, cy: (top + bottom) / 2, rx: 34, ry: (bottom - top) / 2 };
  const horizontalLimits: { x: number; reach: number }[] = [];
  for (const box of content) for (const x of [box.x - 8, box.x + box.width + 8]) {
    for (const y of [box.y - 8, box.y + box.height + 8]) {
      const vertical = (y - constrained.cy) / constrained.ry;
      const reach = Math.sqrt(1 - vertical ** 2);
      horizontalLimits.push({ x, reach });
      constrained.rx = Math.max(constrained.rx, Math.abs(x - constrained.cx) / reach);
    }
  }
  if (!Number.isFinite(constrained.rx)
    || excluded.some(box => nearestDistance(constrained, box) < 1)) return ordinary;
  // Each corner permits a center interval [x - rx * reach, x + rx * reach].
  // Their first common intersection gives the narrowest ellipse at this height.
  // Keeping the rectangle's center instead can create large empty side margins.
  let radius = 34;
  for (let i = 0; i < horizontalLimits.length; i++) {
    for (let j = i + 1; j < horizontalLimits.length; j++) {
      const a = horizontalLimits[i], b = horizontalLimits[j];
      radius = Math.max(radius, Math.abs(a.x - b.x) / (a.reach + b.reach));
    }
  }
  const left = Math.max(...horizontalLimits.map(limit => limit.x - radius * limit.reach));
  const right = Math.min(...horizontalLimits.map(limit => limit.x + radius * limit.reach));
  const narrower = { ...constrained, cx: (left + right) / 2, rx: radius };
  if (Number.isFinite(radius) && radius <= constrained.rx
    && excluded.every(box => nearestDistance(narrower, box) >= 1)) return narrower;
  return constrained;
}

/** Only an annotation attached inside the authored domain belongs to its enclosure. */
export function bindingDomainPlaques(memberIds: Iterable<string>, items: readonly RelationPlanItem[],
  placements: ReadonlyMap<number, Rect>): Rect[] {
  const members = new Set(memberIds);
  return [...placements].flatMap(([index, rect]) => {
    const item = items[index];
    return item?.kind === 'node-plaque' && item.anchorNodeIds.length
      && item.anchorNodeIds.every(id => members.has(id)) ? [rect] : [];
  });
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
      const width = (measureText ? measureText(text) * TERMINAL_LABEL.fontSize / CATEGORY_LABEL.fontSize : [...text].length * 56) + 56;
      rectangles.push({ x: node.x - width / 2, y: node.y + 55, width, height: 100 });
    }
  }
  return rectangles.length ? boundingRect(rectangles) : null;
}

type DomainNode = HierarchyPointNode<SyntaxNode>;
const domainNodeId = (node: DomainNode) => String((node as DomainNode & { __vizId?: string }).__vizId ?? node.data.id);

/** The ellipse a binding domain paints over `visibleNodes` (bindingDrawing.ts and
 * bindingRefinements.ts measure the same boxes from painted ink): the visible part of
 * its domain's subtree, grown to hold the plaques of `placements` attached inside it,
 * and narrowed off the other visible syntax. The camera fits it with the stage's
 * plaques; plaque allocation keeps plaques off it with none (stageCamera.ts). */
export function sceneBindingDomainEllipse(domainId: string, byId: ReadonlyMap<string, DomainNode>, visibleNodes: readonly DomainNode[],
  items: readonly RelationPlanItem[] = [], placements: ReadonlyMap<number, Rect> = new Map(), measureText?: CategoryTextMeasure) {
  const domain = byId.get(domainId);
  if (!domain) return null;
  const visible = new Set(visibleNodes), members = new Set(domain.descendants());
  const rect = bindingDomainTreeRect(domain.descendants().filter(node => visible.has(node)), measureText);
  if (!rect) return null;
  const boxes = (nodes: readonly DomainNode[]) => nodes.flatMap(node => bindingDomainTreeRect([node], measureText) ?? []);
  return bindingDomainEllipse(rect, bindingDomainPlaques(domain.descendants().map(domainNodeId), items, placements),
    boxes(visibleNodes.filter(node => members.has(node))), boxes(visibleNodes.filter(node => !members.has(node))));
}
