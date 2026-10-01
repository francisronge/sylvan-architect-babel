import type { Point, Rect } from '../replay/relations/overlayGeometry.ts';

/** Reserve the stroke itself, including its padding, rather than a curve's empty interior. */
export function strokeObstacleRects(points: readonly Point[], padding: number): Rect[] {
  return points.slice(1).map((to, i) => {
    const from = points[i];
    return { x: Math.min(from.x, to.x) - padding, y: Math.min(from.y, to.y) - padding,
      width: Math.abs(to.x - from.x) + 2 * padding, height: Math.abs(to.y - from.y) + 2 * padding };
  });
}

/** Read final relation ink in the common tree coordinates. Neutral labels yield to
 * these obstacles; the measured drawings and the tree are never repositioned. */
export function measureRelationInkObstacles(root: SVGGElement): Rect[] {
  const matrix = root.getCTM();
  if (!matrix) return [];
  const inverse = matrix.inverse(), obstacles: Rect[] = [];
  // Review hosts may hide the whole SVG until its first render is committed.
  // That inherited visibility must not erase obstacles during the render itself.
  const hostHidden = getComputedStyle(root).visibility === 'hidden';
  for (const element of root.querySelectorAll<SVGGraphicsElement>('path,line,polyline,polygon,rect,ellipse,circle,text')) {
    if (!element.closest('[data-vr-owner-refs]')
      || element.closest('defs,marker,clipPath,mask,.vr-fallback-mark,.vr-fallback-connector,.babel-anchor-set-rail,.vr-relation-hit-target')) continue;
    let visible = true;
    for (let ancestor: Element | null = element; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.display === 'none' || !hostHidden && style.visibility === 'hidden'
        || ancestor.getAttribute('visibility') === 'hidden' || (ancestor as SVGElement).style.visibility === 'hidden'
        || Number(style.opacity) === 0) { visible = false; break; }
    }
    if (!visible) continue;
    const localMatrix = element.getCTM();
    if (!localMatrix) continue;
    const transform = inverse.multiply(localMatrix);
    const project = (point: Point): Point => ({ x: transform.a * point.x + transform.c * point.y + transform.e,
      y: transform.b * point.x + transform.d * point.y + transform.f });
    const style = getComputedStyle(element);
    const hasInk = (color: string) => color !== 'none' && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)';
    const fill = hasInk(style.fill) && Number(style.fillOpacity) > 0;
    const stroke = hasInk(style.stroke) && Number(style.strokeOpacity) > 0 && parseFloat(style.strokeWidth) > 0;
    if (element.tagName === 'text' || fill && element.tagName === 'rect') {
      const box = element.getBBox();
      if (!box.width || !box.height) continue;
      const points = [project(box), project({ x: box.x + box.width, y: box.y }),
        project({ x: box.x, y: box.y + box.height }), project({ x: box.x + box.width, y: box.y + box.height })];
      const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
      obstacles.push({ x: x - 5, y: y - 5, width: Math.max(...points.map(p => p.x)) - x + 10,
        height: Math.max(...points.map(p => p.y)) - y + 10 });
    } else if (stroke && 'getTotalLength' in element) {
      const geometry = element as SVGGeometryElement, length = geometry.getTotalLength();
      if (!Number.isFinite(length) || length <= 0) continue;
      const scale = Math.max(Math.hypot(transform.a, transform.b), Math.hypot(transform.c, transform.d));
      const steps = Math.min(4096, Math.max(1, Math.ceil(length * scale / 12)));
      const padding = 5 + parseFloat(style.strokeWidth) * scale / 2;
      const points = Array.from({ length: steps + 1 }, (_, i) => project(geometry.getPointAtLength(length * i / steps)));
      obstacles.push(...strokeObstacleRects(points, padding));
    }
  }
  return obstacles;
}
