import * as d3 from 'd3';
import { markerScaleAtZoom } from '../../replay/rendererMetrics.ts';
import { formatAuthoredWitnessSurface, formatIndexedSurfaceForDisplayValue, isTraceLike } from '../../replay/replaySurfaceNotation.ts';
import type { HierNode } from '../../replay/types.ts';
import type { DrawingLayer } from './drawingContext.ts';
import { labelBelongsToNode } from './treeMeasurements.ts';

export { alignReplayUnaryTerminalLeaves } from '../../replay/unaryTerminalLeaves.ts';

export const hasTreeGapNotation = (g: DrawingLayer, nodeId: string, text: string): boolean => Boolean(
  g.selectAll<SVGTextElement, HierNode>('.category-label, .terminal-label')
    .filter(function exactGapOccurrence() {
      return labelBelongsToNode(this, nodeId);
    })
    .filter(function sameGapNotation() {
      if (!text) return false;
      if (this.textContent === text) return true;
      if (this.getAttribute('data-default-label') !== text) return false;
      const index = this.getAttribute('data-trace-index');
      const formatted = isTraceLike(text)
        ? formatAuthoredWitnessSurface(text, index)
        : formatIndexedSurfaceForDisplayValue(text, index);
      return this.textContent === formatted;
    })
    .node()
);

const overlayMarkerScale = (zoom: number) => markerScaleAtZoom(zoom || 1);

/** Deferred markers read the mounted camera when painted, after fitting. */
export function appendOverlayMarker(
  primitiveHost: DrawingLayer,
  markX: number,
  markY: number,
  markerScale?: number,
  badgeGap = 0,
  treeNotation = false,
  stackIndex = 0
) {
  const host = primitiveHost.node();
  const scale = markerScale ?? overlayMarkerScale(host ? d3.zoomTransform(host).k : 1);
  return primitiveHost.append('g')
    .attr('class', treeNotation ? 'vr-tree-notation' : 'vr-overlay-marker')
    .attr('data-vr-x', String(markX - (treeNotation ? stackIndex * badgeGap * scale : 0)))
    .attr('data-vr-y', String(markY))
    .attr('data-vr-stack-offset', treeNotation ? String(stackIndex * badgeGap) : null)
    .attr('transform', `translate(${markX},${markY}) scale(${scale})`);
}

export function rescaleOverlayMarkers(g: DrawingLayer, zoom: number) {
  g.selectAll<SVGGElement, unknown>('.vr-overlay-marker').attr('transform', function () {
    const x = Number(this.dataset.vrX || 0);
    const y = Number(this.dataset.vrY || 0);
    return `translate(${x},${y}) scale(${overlayMarkerScale(zoom)})`;
  });
}
