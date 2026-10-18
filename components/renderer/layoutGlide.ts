import * as d3 from 'd3';
import type { SyntaxNode } from '../../types.ts';
import type { DrawingLayer } from './drawingContext.ts';

type Offset = { x: number; y: number };
type PaintedPoint = { x: number; y: number };
const branchPath = d3.linkVertical<{ source: PaintedPoint; target: PaintedPoint }, PaintedPoint>()
  .x(point => point.x).y(point => point.y);

/**
 * Paints one step's layout change as motion. At progress t, each gliding node
 * group (its category, word and label pieces) sits offset × (1 − t) from its new
 * place, its branches follow both endpoints, and a relation mark moves as one
 * coordinate group when every node it is bound to shares one offset. A mark bound
 * to nodes that travel differently cannot follow as one group, so it stays hidden
 * until the glide ends. `painted` records the offsets as painted, for a step that
 * interrupts the glide. Only transforms, branch paths and visibility change per
 * tick; marks drawn later in the step are picked up when they appear.
 *
 * Geometry is measured in tree space from painted elements, so the frame arms the
 * glide only after its synchronous measurements, and later measuring work runs
 * `atRest`, against the new layout.
 */
export type LayoutGlide = ReturnType<typeof createLayoutGlide>;
export function createLayoutGlide(g: DrawingLayer, offsets: ReadonlyMap<string, Offset>, painted: Map<string, Offset>) {
  const root = g.node()!;
  const groups = [...root.querySelectorAll<SVGGElement>('.node-group')].flatMap(element => {
    const offset = offsets.get(element.getAttribute('data-node-group-id') ?? '');
    return offset ? [{ element, offset, node: d3.select<SVGGElement, PaintedPoint>(element).datum() }] : [];
  });
  const branches = [...root.querySelectorAll<SVGPathElement>('path.branch')].flatMap(element => {
    const source = offsets.get(element.getAttribute('data-source-node-id') ?? '');
    const target = offsets.get(element.getAttribute('data-target-node-id') ?? '');
    const link = d3.select<SVGPathElement, d3.HierarchyPointLink<SyntaxNode>>(element).datum();
    return source || target ? [{ element, link, source, target }] : [];
  });
  const marks = new Map<SVGElement, { offset: Offset | null; base: string | null } | null>();
  const markFor = (element: SVGElement) => {
    if (!marks.has(element)) {
      // A mark inside another mark moves with its host.
      const nested = Boolean(element.parentElement?.closest('.vr-item'));
      const shifts = (JSON.parse(element.getAttribute('data-vr-node-ids') ?? '[]') as string[])
        .map(id => offsets.get(id) ?? { x: 0, y: 0 });
      const [first = { x: 0, y: 0 }] = shifts;
      const rigid = shifts.every(shift => Math.abs(shift.x - first.x) < 1e-6 && Math.abs(shift.y - first.y) < 1e-6);
      marks.set(element, nested || (rigid && !first.x && !first.y) ? null
        : { offset: rigid ? first : null, base: element.getAttribute('transform') });
    }
    return marks.get(element);
  };
  const apply = (progress: number) => {
    const remaining = 1 - progress;
    const at = (point: PaintedPoint, offset: Offset | undefined) => ({
      x: point.x + (offset?.x ?? 0) * remaining, y: point.y + (offset?.y ?? 0) * remaining
    });
    for (const { element, offset, node } of groups) {
      const { x, y } = at(node, offset);
      element.setAttribute('transform', `translate(${x},${y})`);
    }
    for (const { element, link, source, target } of branches) {
      element.setAttribute('d', branchPath({ source: at(link.source, source), target: at(link.target, target) })!);
    }
    for (const element of root.querySelectorAll<SVGElement>('.vr-item')) {
      const mark = markFor(element);
      if (!mark) continue;
      if (!mark.offset) {
        if (remaining) element.style.setProperty('visibility', 'hidden');
        else element.style.removeProperty('visibility');
        continue;
      }
      const transform = [remaining ? `translate(${mark.offset.x * remaining},${mark.offset.y * remaining})` : '', mark.base ?? '']
        .filter(Boolean).join(' ');
      if (transform) element.setAttribute('transform', transform);
      else element.removeAttribute('transform');
    }
  };
  let armed = false, current = 0;
  const paint = (progress: number) => {
    current = progress;
    if (armed) apply(progress);
    offsets.forEach((offset, id) => painted.set(id, { x: offset.x * (1 - progress), y: offset.y * (1 - progress) }));
  };
  return {
    paint,
    arm: () => { armed = true; apply(current); },
    /** Runs measuring work against the new layout, then restores the painted glide. */
    atRest: (work: () => void) => {
      const moving = armed && current < 1;
      if (moving) apply(1);
      try { work(); } finally { if (moving) apply(current); }
    },
    /** Completes the glide at once, as a manual camera gesture does for the camera. */
    finish: () => { if (current < 1) paint(1); }
  };
}
