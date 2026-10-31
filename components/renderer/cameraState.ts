import type * as d3 from 'd3';
import type { SyntaxNode } from '../../types.ts';
import type { PaintedNodes } from '../treeViewport.ts';

/** A manual pose is a screen pose of the live SVG; `width` and `height` are that SVG's size. */
export type TreeCameraState = {
  data: SyntaxNode; signature: string; width: number; height: number; transform: d3.ZoomTransform;
};

/** The SVG takes a new size at once, while a held frame keeps the viewport it
 * was drawn for. Manual poses are recorded and restored against the SVG itself. */
export function liveViewportSize(svg: SVGSVGElement | null, fallback: { width: number; height: number }) {
  return svg && svg.clientWidth > 0 && svg.clientHeight > 0 ? { width: svg.clientWidth, height: svg.clientHeight } : fallback;
}

/** The last automatic pose, with the stage and painted syntax it framed. */
export type AutoCameraState = TreeCameraState & {
  stepIndex: number; fitRevision: number; stageIndex: number; paintedNodes: PaintedNodes;
  /** The stage plan closed a movement's room at the crossing into the framed stage. */
  closesOnEntry?: boolean;
  /** Framed the completed last Stage Record, whose fit is its own. */
  completed: boolean;
  /** The app controls the fit avoided (see CameraFitGeometry `controls`). */
  controls?: CameraControlBounds;
};

/** Space the app's own controls take from the tree canvas: the sentence console,
 * the view tabs and the top bar. They float over the canvas, so they can appear
 * or leave without resizing it. */
export type CameraControlBounds = { top: number; right: number; bottom: number };

/** Retained camera interaction state for one mounted tree, shared across frame draws. */
export interface CameraSession {
  /** `deferred` is the pose the camera is settling at: the accepted fit or retained
   * manual pose, or the pose a gesture reached. */
  cameraRuntime: { applying: boolean; cancel: (() => void) | undefined; deferred: d3.ZoomTransform | null };
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  zoom: d3.ZoomBehavior<SVGSVGElement, unknown>;
  autoCameraRef: { current: AutoCameraState | null };
  animated: boolean;
  data: SyntaxNode;
  derivationStagesSignature: string;
  fitRevision: number;
  containerWidth: number;
  containerHeight: number;
  cameraAnimationRef: { current: { stepIndex: number; endsAt: number } | null };
  activeStepIndex: number;
  svgRef: { current: SVGSVGElement | null };
  reportViewError: (error: unknown) => void;
  manualCameraRef: { current: TreeCameraState | null };
}

/** The tree layer's screen matrix under `deferred`, the pose the camera is
 * settling at. A camera transition paints its start pose synchronously, so a
 * placement made after a fit that clamps to the viewport or sizes a mark in
 * screen pixels uses this matrix; measuring painted elements into tree space
 * keeps their live matrix. Before any fit it is the live matrix. */
export function deferredTreeMatrix(svg: SVGSVGElement | null | undefined, tree: SVGGElement | null | undefined,
  deferred: { x: number; y: number; k: number } | null) {
  const outer = deferred ? svg?.getScreenCTM() : null;
  return deferred && outer ? outer.translate(deferred.x, deferred.y).scale(deferred.k) : tree?.getScreenCTM() ?? null;
}

/** Carries a client point measured under the live tree matrix to where it lies
 * under the settled one. */
export function settledClientPoint(live: DOMMatrix, settled: DOMMatrix) {
  const intoTree = live.inverse();
  return (x: number, y: number) => new DOMPoint(x, y).matrixTransform(intoTree).matrixTransform(settled);
}
