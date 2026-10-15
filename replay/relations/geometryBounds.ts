import type { BoundFrame } from './boundGeometry.ts';

/**
 * Complete overlay bounds over the bound primitives, pure and testable —
 * marker glyph extents and labels included, no DOM measurement. Marker pads
 * use a NOMINAL scale so camera fitting is zoom-independent (counter-scaled
 * markers only shrink in world units as zoom grows).
 */
export type OverlayBounds = { minX: number; minY: number; maxX: number; maxY: number };

export const boundOverlayBounds = (
  frame: BoundFrame,
  options: { markerScale?: number } = {}
): OverlayBounds | null => {
  const k = Math.max(0.1, options.markerScale ?? 1);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  const point = (x: number, y: number, pad = 0) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    any = true;
    minX = Math.min(minX, x - pad);
    minY = Math.min(minY, y - pad);
    maxX = Math.max(maxX, x + pad);
    maxY = Math.max(maxY, y + pad);
  };
  const pathPoints = (d: string, pad = 0) => {
    const numbers = d.match(/-?\d+(?:\.\d+)?/g) || [];
    for (let index = 0; index + 1 < numbers.length; index += 2) {
      point(Number(numbers[index]), Number(numbers[index + 1]), pad);
    }
  };
  /**
   * Conservative text half-width from the ACTUAL string: monospace glyph
   * advance ~0.62em plus breathing room. Bounds must grow with authored
   * text; a constant unrelated to length never suffices.
   */
  const textHalfWidth = (text: string | number | null | undefined, fontSize: number): number => {
    const value = text === null || text === undefined ? '' : String(text);
    if (!value) return 0;
    return (value.length * fontSize * 0.65) / 2 + fontSize * 0.6;
  };
  /**
   * Conservative [leftExtent, rightExtent] of a text run measured FROM its
   * anchor point, honoring the renderer's actual `text-anchor`. A long
   * start-anchored index extends fully to the right of its origin; an
   * end-anchored Phase-edge label extends fully to the left.
   */
  const textSpanFromAnchor = (
    text: string | number | null | undefined,
    fontSize: number,
    anchor: 'start' | 'middle' | 'end'
  ): [number, number] => {
    const value = text === null || text === undefined ? '' : String(text);
    if (!value) return [0, 0];
    const width = value.length * fontSize * 0.65 + fontSize * 0.6;
    if (anchor === 'start') return [0, width];
    if (anchor === 'end') return [width, 0];
    return [width / 2, width / 2];
  };
  /** Include an anchored text run drawn inside a counter-scaled marker. */
  const anchoredText = (
    markerX: number,
    markerY: number,
    text: string | number | null | undefined,
    fontSize: number,
    anchor: 'start' | 'middle' | 'end',
    localOffsetX = 0
  ) => {
    const [left, right] = textSpanFromAnchor(text, fontSize, anchor);
    if (left === 0 && right === 0) return;
    point(markerX + (localOffsetX - left) * k, markerY - fontSize * k);
    point(markerX + (localOffsetX + right) * k, markerY + fontSize * k);
  };
  /** Exact axis extrema of a quadratic Bézier (closed form, clamped). */
  const quadraticExtreme = (p0: number, p1: number, p2: number): [number, number] => {
    let lo = Math.min(p0, p2);
    let hi = Math.max(p0, p2);
    const denominator = p0 - 2 * p1 + p2;
    if (denominator !== 0) {
      const t = (p0 - p1) / denominator;
      if (t > 0 && t < 1) {
        const u = 1 - t;
        const at = u * u * p0 + 2 * u * t * p1 + t * t * p2;
        lo = Math.min(lo, at);
        hi = Math.max(hi, at);
      }
    }
    return [lo, hi];
  };
  frame.primitives.forEach((primitive) => {
    switch (primitive.type) {
      case 'trajectory-path': {
        /*
         * The accepted ATB plate fits the complete coordinated tree, then
         * lays its convergent trajectories into the reserved lower canvas.
         * Letting their deliberately deep fan control points refit the camera
         * would shrink and lift the whole tree when a third conjunct is added.
         */
        if (primitive.trajectoryKind === 'atb'
          || primitive.trajectoryKind === 'sideward'
          || primitive.fitPolicy === 'tree-first') return;
        // Exact quadratic extrema plus the accepted 7-unit arrowhead and
        // stroke clearance. The path already insets its endpoints by eight
        // tree units, so this covers the glyph without shifting a tree whose
        // path remains inside its ordinary extent.
        const clearance = 8;
        const [loX, hiX] = quadraticExtreme(primitive.start.x, primitive.control.x, primitive.end.x);
        const [loY, hiY] = quadraticExtreme(primitive.start.y, primitive.control.y, primitive.end.y);
        point(loX, loY, clearance);
        point(hiX, hiY, clearance);
        return;
      }
      case 'index-badge':
        if (primitive.fitPolicy === 'tree-first') return;
        // Renderer: start-anchored 13px text at local x=8.
        point(primitive.x, primitive.y, 10 * k);
        anchoredText(primitive.x, primitive.y, primitive.index, 13, 'start', 8);
        return;
      case 'identity-lens':
        return;
      case 'text-badge':
        if (primitive.badgeStyle === 'gap-notation'
          || primitive.badgeStyle === 'agreement-goal'
          || primitive.badgeStyle === 'idiom-chunk'
          || primitive.badgeStyle === 'split-antecedence') {
          return;
        }
        point(primitive.x, primitive.y, Math.max(18, textHalfWidth(primitive.text, 12) + 10) * k);
        return;
      case 'analysis-verdict':
        // Verdicts live in a post-fit gutter and never change the tree camera.
        return;
      case 'gapping-alignment':
        // The accepted plate fits the complete ordinary tree first and lays
        // all correspondence lanes beneath it afterward.
        return;
      case 'quantifier-raising':
        // The accepted scope box, coindices and elbow path are measured from
        // the fitted tree's rendered labels, then added without refitting it.
        return;
      case 'operator-variable-binding':
        // The accepted nested domains, coindices and binding paths are
        // measured from the fitted tree and never participate in camera fit.
        return;
      case 'split-antecedence':
        // The square and terminal-to-terminal links annotate the fitted tree.
        return;
      case 'fallback-mark':
        // Orchard marks annotate the fitted tree without shrinking it.
        return;
      case 'anchor-set-badge':
        point(primitive.x, primitive.y, Math.max(16, textHalfWidth(primitive.numeral, 10) + 8) * k);
        return;
      case 'anchor-set-rail':
        point(primitive.x1, primitive.y, 10);
        point(primitive.x2, primitive.y, 10);
        primitive.anchors.forEach(anchor => point(anchor.x, anchor.y, 10));
        return;
      case 'segment':
        return;
      case 'native-branch-overlay':
        // Native branch geometry is sampled from the fitted D3 tree.
        return;
      case 'shape-path':
        // These accepted annotations are measured after the ordinary tree fit.
        if (primitive.fitPolicy === 'tree-first'
          || primitive.shapeStyle === 'phase-arc'
          || primitive.shapeStyle === 'blocked-extraction'
          || primitive.shapeStyle === 'idiom-bracket'
          || primitive.shapeStyle === 'blocked-edge-slash') return;
        pathPoints(primitive.d, 10);
        if (primitive.labelAt) {
          point(
            primitive.labelAt.x,
            primitive.labelAt.y,
            Math.max(24, textHalfWidth(primitive.label, 11) + 8) * k
          );
        }
        if (primitive.badge) {
          point(
            primitive.badge.at.x,
            primitive.badge.at.y,
            Math.max(20, textHalfWidth(primitive.badge.text, 11) + 10) * k
          );
        }
        if (primitive.tip) point(primitive.tip.at.x, primitive.tip.at.y, 16 * k);
        return;
      case 'leader':
        point(primitive.from.x, primitive.from.y);
        point(primitive.to.x, primitive.to.y);
        return;
      case 'plaque':
        // Accepted PF and feature plates are positioned after the ordinary
        // tree fit. They annotate the fitted tree; they never shrink or
        // recenter it. Gutter plaques are part of the fitted picture.
        if (
          primitive.plaqueStyle === 'realization' || primitive.plaqueStyle === 'feature'
        ) return;
        point(primitive.x, primitive.y);
        point(primitive.x + primitive.width * k, primitive.y + primitive.height * k);
        return;
      case 'domain-region': {
        // The accepted adjunct-extraction diagnostic replaces the native
        // attachment branch after fit; it never boxes or refits the adjunct.
        if (primitive.fitPolicy === 'tree-first'
          || primitive.domainStyle === 'adjunct-domain') return;
        point(primitive.x, primitive.y, 12);
        point(primitive.x + primitive.width, primitive.y + primitive.height, 12);
        // Renderer text: transfer-edge draws end-anchored 12px at
        // (x - 8, y + height/2) — extending LEFT; other labeled/blocked
        // regions draw start-anchored 12px at (x + width, y).
        const regionText = primitive.outcome === 'blocked' ? '\u2717' : primitive.label;
        if (regionText) {
          if (primitive.domainStyle === 'transfer-edge') {
            anchoredText(primitive.x - 8, primitive.y + primitive.height / 2, regionText, 12, 'end');
          } else {
            anchoredText(primitive.x + primitive.width, primitive.y, regionText, 12, 'start');
          }
        }
        return;
      }
      case 'domain-ellipse':
        if (primitive.fitPolicy === 'tree-first') return;
        point(primitive.cx - primitive.rx, primitive.cy - primitive.ry, 8);
        point(primitive.cx + primitive.rx, primitive.cy + primitive.ry, 8);
        return;
      case 'strike':
        point(primitive.x1, primitive.y, 6);
        point(primitive.x2, primitive.y, 6);
        return;
      case 'enclosure':
        point(primitive.x, primitive.y, 6);
        point(primitive.x + primitive.width, primitive.y + primitive.height, 6);
        return;
      case 'branch-emphasis':
        primitive.strongEdges.concat(primitive.weakEdges).forEach((edge) => {
          point(edge.from.x, edge.from.y, 4);
          point(edge.to.x, edge.to.y, 4);
        });
        return;
      case 'shared-branch':
        point(primitive.from.x, primitive.from.y, 4);
        point(primitive.to.x, primitive.to.y, 4);
        return;
      case 'path-node-ring':
        // Phillips path marks enclose the actual rendered category labels
        // after the ordinary tree fit. Placeholder label dimensions must not
        // shrink or recenter the tree before those labels can be measured.
        return;
      case 'parasitic-gap-copy':
        return;
      case 'ghost-set':
        return;
      default:
        return;
    }
  });
  return any ? { minX, minY, maxX, maxY } : null;
};
