import type * as d3 from 'd3';
import type { SyntaxNode } from '../../types.ts';

export type TreeCameraState = {
  data: SyntaxNode; signature: string; width: number; height: number; transform: d3.ZoomTransform;
};

/** Retained camera interaction state for one mounted tree, shared across frame draws. */
export interface CameraSession {
  cameraRuntime: { applying: boolean; cancel: (() => void) | undefined; deferred: d3.ZoomTransform | null };
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  zoom: d3.ZoomBehavior<SVGSVGElement, unknown>;
  autoCameraRef: { current: (TreeCameraState & { stepIndex: number; fitRevision: number }) | null };
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
