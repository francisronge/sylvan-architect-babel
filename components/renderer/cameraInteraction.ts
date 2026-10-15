import * as d3 from 'd3';
import { guardViewCallback } from '../viewErrorHandling.ts';
import type { CameraSession } from './cameraState.ts';
import type { DrawingLayer } from './drawingContext.ts';
import { rescaleOverlayMarkers } from './treeNotation.ts';

export interface CameraEffects {
  refreshTrajectoryClearance?: () => void;
  refreshIdentityForestLight?: () => void;
  finishCollectionReveal?: () => void;
}

export function updateScreenStableText(g: DrawingLayer, screenScale: number) {
  const safeScale = Math.max(0.001, screenScale || 1);
  g.selectAll<SVGTextElement, unknown>('[data-vr-screen-font-px]').each(function () {
    const text = d3.select(this);
    const fontPx = Number(this.dataset.vrScreenFontPx || 0);
    const strokePx = Number(this.dataset.vrScreenStrokePx || 0);
    if (fontPx > 0) text.style('font-size', `${fontPx / safeScale}px`);
    if (strokePx > 0) text.style('stroke-width', `${strokePx / safeScale}px`);
  });
}

/** Reuses the mounted zoom behavior; an active gesture dispatches to the current frame. */
export function installCameraInteraction(session: Pick<CameraSession,
  | 'cameraRuntime'
  | 'svg'
  | 'cameraAnimationRef'
  | 'activeStepIndex'
  | 'manualCameraRef'
  | 'data'
  | 'derivationStagesSignature'
  | 'containerWidth'
  | 'containerHeight'
  | 'reportViewError'
  | 'zoom'
>, g: DrawingLayer, effects: CameraEffects) {
  const {
    cameraRuntime,
    svg,
    cameraAnimationRef,
    activeStepIndex,
    manualCameraRef,
    data,
    derivationStagesSignature,
    containerWidth,
    containerHeight,
    reportViewError
  } = session;
  const zoom = session.zoom
    .on('zoom', guardViewCallback((event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
      g.attr('transform', event.transform);
      if (event.sourceEvent && !cameraRuntime.applying) {
        cameraRuntime.cancel?.();
        cameraAnimationRef.current = null;
        svg.attr('data-babel-camera-settled-step', activeStepIndex);
        effects.finishCollectionReveal?.();
        manualCameraRef.current = { data, signature: derivationStagesSignature, width: containerWidth, height: containerHeight, transform: event.transform };
      }
      // Overlay markers keep a stable screen size: their world position is
      // carried on data attributes and their local scale counteracts zoom.
      rescaleOverlayMarkers(g, event.transform.k || 1);
      updateScreenStableText(g, event.transform.k || 1);
      effects.refreshTrajectoryClearance?.();
      effects.refreshIdentityForestLight?.();
    }, reportViewError));

  svg.call(zoom);
  return zoom;
}
