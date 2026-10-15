import * as d3 from 'd3';
import { type OverlayBounds } from '../../replay/relations/geometryBounds.ts';
import {
  type Rect
} from '../../replay/relations/overlayGeometry.ts';
import { animateReplayCamera } from '../replayCameraMotion.ts';
import { advanceFittedCamera, containCamera } from '../treeViewport.ts';
import { guardViewCallback } from '../viewErrorHandling.ts';
import type { CameraSession } from './cameraState.ts';
import type { DrawingLayer } from './drawingContext.ts';

interface CameraFitGeometry {
  stagePlaqueContainmentBounds: OverlayBounds;
  stageFitContainmentBounds: OverlayBounds | null;
  fitLeft: number;
  fitRight: number;
  fitTop: number;
  fitBottom: number;
  completedReplayStep: number;
  g: DrawingLayer;
  fitFallbackOverlays: (fitZoom: number, fittedViewport: Rect) => void;
}
export function createFittedCamera({ session, layout }: { session: CameraSession; layout: CameraFitGeometry }) {
  const {
    cameraRuntime,
    svg,
    autoCameraRef,
    animated,
    data,
    derivationStagesSignature,
    fitRevision,
    containerWidth,
    containerHeight,
    cameraAnimationRef,
    activeStepIndex,
    svgRef,
    reportViewError,
    manualCameraRef
  } = session;
  const {
    stagePlaqueContainmentBounds,
    stageFitContainmentBounds,
    fitLeft,
    fitRight,
    fitTop,
    fitBottom,
    completedReplayStep,
    g,
    fitFallbackOverlays
  } = layout;
  const animateFittedCamera = (fitted: d3.ZoomTransform, previousFit: typeof autoCameraRef.current) => {
    const sameReplay = animated && previousFit?.data === data
      && previousFit.signature === derivationStagesSignature && previousFit.fitRevision === fitRevision
      && previousFit.width === containerWidth && previousFit.height === containerHeight;
    const pending = cameraAnimationRef.current;
    const continuing = sameReplay && pending?.stepIndex === activeStepIndex;
    const adjacent = sameReplay && Math.abs(previousFit.stepIndex - activeStepIndex) === 1;
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0
      : continuing ? Math.max(0, pending.endsAt - performance.now()) : adjacent ? 360 : 0;
    cameraAnimationRef.current = duration ? { stepIndex: activeStepIndex, endsAt: performance.now() + duration } : null;
    svg.attr('data-babel-camera-settled-step', null);
    cameraRuntime.cancel = animateReplayCamera(d3.zoomTransform(svgRef.current!), fitted, duration,
      pose => applyCameraTransform(session, d3.zoomIdentity.translate(pose.x, pose.y).scale(pose.k)),
      () => { cameraAnimationRef.current = null; svg.attr('data-babel-camera-settled-step', activeStepIndex); },
      {
        now: () => performance.now(),
        request: callback => window.requestAnimationFrame(guardViewCallback(callback, reportViewError)),
        cancel: id => window.cancelAnimationFrame(id)
      });
  };
  const applyFittedCamera = (fitted: d3.ZoomTransform) => {
    if (stagePlaqueContainmentBounds && stageFitContainmentBounds) {
      const contained = containCamera(fitted, stageFitContainmentBounds, { left: fitLeft, right: fitRight, top: fitTop, bottom: fitBottom });
      fitted = d3.zoomIdentity.translate(contained.x, contained.y).scale(contained.k);
    }
    const previousFit = autoCameraRef.current;
    // Font and geometry refinements can repaint the same step. Keep its
    // accepted pose under the same containment rule as a forward advance.
    if (animated && completedReplayStep === undefined && stageFitContainmentBounds && previousFit?.data === data
      && previousFit.signature === derivationStagesSignature && previousFit.fitRevision === fitRevision
      && previousFit.width === containerWidth && previousFit.height === containerHeight
      && (previousFit.stepIndex === activeStepIndex || previousFit.stepIndex + 1 === activeStepIndex)) {
      const advanced = advanceFittedCamera(previousFit.transform, fitted, stageFitContainmentBounds,
        { left: fitLeft, right: fitRight, top: fitTop, bottom: fitBottom });
      fitted = d3.zoomIdentity.translate(advanced.x, advanced.y).scale(advanced.k);
    }
    autoCameraRef.current = {
      data, signature: derivationStagesSignature, width: containerWidth,
      height: containerHeight, stepIndex: activeStepIndex, fitRevision, transform: fitted
    };
    // Labels and complete fallback badges keep their accepted automatic-Fit
    // size, then scale with the tree. Their connectors use the same reference
    // when redrawn under a retained manual camera.
    const fittedMarkerScale = Math.min(1 / fitted.k, 3);
    g.selectAll<SVGGElement, unknown>('.vr-tree-notation').attr('transform', function () {
      const x = Number(this.dataset.vrX) + Number(this.dataset.vrStackOffset || 0) * fittedMarkerScale;
      return `translate(${x},${this.dataset.vrY}) scale(${fittedMarkerScale})`;
    });
    fitFallbackOverlays?.(fitted.k, {
      x: (fitLeft - fitted.x) / fitted.k, y: (fitTop - fitted.y) / fitted.k,
      width: (fitRight - fitLeft) / fitted.k, height: (fitBottom - fitTop) / fitted.k
    });
    const manual = manualCameraRef.current;
    if (manual?.data === data && manual.signature === derivationStagesSignature) {
      const transform = d3.zoomIdentity.translate(
        manual.transform.x + (containerWidth - manual.width) / 2,
        manual.transform.y + (containerHeight - manual.height) / 2
      ).scale(manual.transform.k);
      manualCameraRef.current = { ...manual, width: containerWidth, height: containerHeight, transform };
      cameraRuntime.deferred = transform;
      cameraAnimationRef.current = null;
      applyCameraTransform(session, transform);
      svg.attr('data-babel-camera-settled-step', activeStepIndex);
      return;
    }
    cameraRuntime.deferred = fitted;
    animateFittedCamera(fitted, previousFit);
  };

  return { applyFittedCamera };
}

export function applyCameraTransform({ cameraRuntime, svg, zoom }: Pick<CameraSession, 'cameraRuntime' | 'svg' | 'zoom'>, transform: d3.ZoomTransform) {
  // D3 can retain a wheel sourceEvent during a programmatic fit.
  cameraRuntime.applying = true;
  try {
    svg.call(zoom.transform, transform);
  } finally {
    cameraRuntime.applying = false;
  }
}
