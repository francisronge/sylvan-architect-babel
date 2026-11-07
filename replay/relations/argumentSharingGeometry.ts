import type { OverlayBounds } from './geometryBounds.ts';
import type { Rect } from './overlayGeometry.ts';

/** One argument-sharing domain oval around its predicate's domain and the
 * shared object. sharingDrawing.ts paints it around their painted label ink;
 * the stage camera contains it around the same labels estimated before painting
 * (stageCamera.ts). The first domain leans left, every later one right. */
export function argumentSharingDomainEllipse(rect: Rect, domainIndex: number) {
  return {
    cx: rect.x + rect.width / 2,
    cy: rect.y + rect.height / 2,
    rx: (rect.width / 2 + 18) * Math.SQRT2,
    ry: (rect.height / 2 + 16) * Math.SQRT2,
    rotation: domainIndex === 0 ? -10 : 10
  };
}

/** The rotated oval's axis-aligned extent, with room for its stroke. */
export function argumentSharingEllipseBounds(ellipse: ReturnType<typeof argumentSharingDomainEllipse>): OverlayBounds {
  const angle = ellipse.rotation * Math.PI / 180;
  const halfWidth = Math.hypot(ellipse.rx * Math.cos(angle), ellipse.ry * Math.sin(angle)) + 8;
  const halfHeight = Math.hypot(ellipse.rx * Math.sin(angle), ellipse.ry * Math.cos(angle)) + 8;
  return { minX: ellipse.cx - halfWidth, maxX: ellipse.cx + halfWidth,
    minY: ellipse.cy - halfHeight, maxY: ellipse.cy + halfHeight };
}
