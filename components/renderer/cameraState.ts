import type * as d3 from 'd3';
import type { SyntaxNode } from '../../types.ts';
import type { PaintedNodes } from '../treeViewport.ts';
import type { LayoutGlide } from './layoutGlide.ts';

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
  /** Framed the completed last Stage Record, whose fit is its own. */
  completed: boolean;
  /** Tree-space glide offsets currently painted, updated as a step's glide runs. */
  paintedOffsets: Map<string, { x: number; y: number }>;
};

/** Retained camera interaction state for one mounted tree, shared across frame draws. */
export interface CameraSession {
  cameraRuntime: { applying: boolean; cancel: (() => void) | undefined; deferred: d3.ZoomTransform | null;
    /** The step's layout glide, which moves syntax with the camera animation. */
    glide?: LayoutGlide | null };
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
