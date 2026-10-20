import * as d3 from 'd3';
import { type OverlayBounds } from '../../replay/relations/geometryBounds.ts';
import {
  type Rect
} from '../../replay/relations/overlayGeometry.ts';
import { animateReplayCamera } from '../replayCameraMotion.ts';
import { advanceFittedCamera, carryCamera, containCamera, type PaintedNodes } from '../treeViewport.ts';
import { guardViewCallback } from '../viewErrorHandling.ts';
import { liveViewportSize, type CameraSession } from './cameraState.ts';
import type { DrawingLayer } from './drawingContext.ts';

interface CameraFitGeometry {
  stagePlaqueContainmentBounds: OverlayBounds | null;
  stageFitContainmentBounds: OverlayBounds | null;
  fitLeft: number;
  fitRight: number;
  fitTop: number;
  fitBottom: number;
  completedReplayStep: number | undefined;
  g: DrawingLayer;
  fitFallbackOverlays: ((fitZoom: number, fittedViewport: Rect) => void) | undefined;
  /** Authored stage being framed; a change marks a stage crossing. */
  stageIndex: number;
  paintedNodes: PaintedNodes;
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
    fitFallbackOverlays,
    stageIndex,
    paintedNodes
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
    const painted = d3.zoomTransform(svgRef.current!);
    // A step across stages starts from the painted pose carried by the common
    // shift of unmoved shared syntax; a reattached constituent appears at its
    // new place on that frame.
    const from = adjacent && previousFit.stageIndex !== stageIndex
      ? carryCamera(painted, previousFit.paintedNodes, paintedNodes) : painted;
    cameraRuntime.cancel = animateReplayCamera(from, fitted, duration,
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
    const step = activeStepIndex - (previousFit?.stepIndex ?? NaN);
    // Keep the accepted pose, under the containment rule, when the same step
    // repaints (font and geometry refinements), on Next, and on Prev within one
    // stage, so a stage keeps one camera in both directions. Prev out of the
    // completed last Stage Record or into an earlier stage refits.
    if (animated && completedReplayStep === undefined && stageFitContainmentBounds && previousFit?.data === data
      && previousFit.signature === derivationStagesSignature && previousFit.fitRevision === fitRevision
      && previousFit.width === containerWidth && previousFit.height === containerHeight
      && (step === 0 || step === 1 || (step === -1 && previousFit.stageIndex === stageIndex && !previousFit.completed))) {
      // Stages lay out syntax in their own coordinates, so a stage crossing first
      // carries the accepted pose by the common shift of unmoved shared syntax.
      const accepted = previousFit.stageIndex === stageIndex ? previousFit.transform
        : carryCamera(previousFit.transform, previousFit.paintedNodes, paintedNodes);
      const advanced = advanceFittedCamera(accepted, fitted, stageFitContainmentBounds,
        { left: fitLeft, right: fitRight, top: fitTop, bottom: fitBottom });
      fitted = d3.zoomIdentity.translate(advanced.x, advanced.y).scale(advanced.k);
    }
    autoCameraRef.current = {
      data, signature: derivationStagesSignature, width: containerWidth,
      height: containerHeight, stepIndex: activeStepIndex, fitRevision, transform: fitted, stageIndex, paintedNodes,
      completed: completedReplayStep !== undefined
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
      const live = liveViewportSize(svgRef.current, { width: containerWidth, height: containerHeight });
      const transform = d3.zoomIdentity.translate(
        manual.transform.x + (live.width - manual.width) / 2,
        manual.transform.y + (live.height - manual.height) / 2
      ).scale(manual.transform.k);
      manualCameraRef.current = { ...manual, ...live, transform };
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
