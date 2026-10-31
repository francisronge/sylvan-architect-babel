import * as d3 from 'd3';
import { type OverlayBounds } from '../../replay/relations/geometryBounds.ts';
import { nativeLinearizationPlateHeight } from '../../replay/relations/nativeDrawingContent.ts';
import {
  type Rect
} from '../../replay/relations/overlayGeometry.ts';
import type { RelationRenderPlan } from '../../replay/relations/renderPlan.ts';
import { getNodeId } from '../../replay/displayIdentity.ts';
import { CAMERA_ZOOM, isCompactViewport, LEAF_INK_EXTENT_Y } from '../../replay/rendererMetrics.ts';
import {
  STAGE_CAMERA_PADDING
} from '../../replay/stageCamera.ts';
import { type SyntaxNode } from '../../types.ts';
import { availableTreeViewport, linearizationViewport } from '../treeViewport.ts';
import { createFittedCamera } from './cameraFitting.ts';
import type { CameraSession } from './cameraState.ts';
import type { DrawingLayer } from './drawingContext.ts';

interface FrameCameraLayout {
  relationRenderPlan: RelationRenderPlan | null;
  activeDerivationFrameIndex: number;
  uiBounds: { top: number; right: number; bottom: number; headerBottom: number; panelTop: number };
  stageCameraBounds: OverlayBounds | null;
  stagePlaqueContainmentBounds: OverlayBounds | null;
  completedReplayStep: number | undefined;
  g: DrawingLayer;
  fitFallbackOverlays: ((fitZoom: number, fittedViewport: Rect) => void) | undefined;
  derivationFrameFitNodes: d3.HierarchyPointNode<SyntaxNode>[] | null;
  overlayFitBounds: OverlayBounds | null;
  visibleNodes: d3.HierarchyPointNode<SyntaxNode>[];
  /** The stage plan closed a movement's room at the crossing into this frame's
   * stage (stageCoordinates.closesOnEntry), so the camera carry there breaks a tie. */
  closesOnEntry?: boolean;
}
/** The stage's cyclic-linearization plate, which takes a column or row of the view. */
const cyclicLinearizationPlate = (relationRenderPlan: RelationRenderPlan | null, stageIndex: number) => (
  relationRenderPlan?.frames[stageIndex]?.items ?? []
).find((item) =>
  item.familyId === 'pf.cyclic-linearization'
  && item.kind === 'node-plaque'
  && item.nativeContent?.kind === 'linearization'
);

/** The rectangle fitTreeCamera fits one stage's tree into: the usable view
 * (`availableTreeViewport`) less the column or row its cyclic-linearization
 * plate takes. The offline camera audit judges poses against the same rectangle. */
export function treeFitViewport(relationRenderPlan: RelationRenderPlan | null, stageIndex: number, treeViewport: ReturnType<typeof availableTreeViewport>) {
  const plate = cyclicLinearizationPlate(relationRenderPlan, stageIndex);
  const placement = plate ? linearizationViewport(treeViewport,
    nativeLinearizationPlateHeight(plate.kind === 'node-plaque' ? plate.nativeContent : undefined)) : null;
  return { left: treeViewport.left, top: placement?.treeTop ?? treeViewport.top,
    right: placement?.treeRight ?? treeViewport.right, bottom: treeViewport.bottom };
}

export function fitTreeCamera({ session, layout }: { session: CameraSession; layout: FrameCameraLayout }) {
  const { containerWidth, containerHeight } = session;
  const {
    relationRenderPlan,
    activeDerivationFrameIndex,
    uiBounds,
    stageCameraBounds,
    stagePlaqueContainmentBounds,
    completedReplayStep,
    g,
    fitFallbackOverlays,
    derivationFrameFitNodes,
    overlayFitBounds,
    visibleNodes,
    closesOnEntry = false
  } = layout;
  const hasCyclicLinearizationPlate = Boolean(cyclicLinearizationPlate(relationRenderPlan, activeDerivationFrameIndex));
  const compactViewport = isCompactViewport(containerWidth);
  const {
    left: fitLeft, right: fitRight, top: fitTop, bottom: fitBottom
  } = treeFitViewport(relationRenderPlan, activeDerivationFrameIndex, availableTreeViewport(containerWidth, containerHeight, uiBounds));
  // Retained framing must protect the same label margin as a fresh Fit.
  const stageFitContainmentBounds = stageCameraBounds ? {
    minX: Math.min(stagePlaqueContainmentBounds?.minX ?? Infinity, stageCameraBounds.minX - STAGE_CAMERA_PADDING.x),
    maxX: Math.max(stagePlaqueContainmentBounds?.maxX ?? -Infinity, stageCameraBounds.maxX + STAGE_CAMERA_PADDING.x),
    minY: Math.min(stagePlaqueContainmentBounds?.minY ?? Infinity, stageCameraBounds.minY - STAGE_CAMERA_PADDING.y),
    maxY: Math.max(stagePlaqueContainmentBounds?.maxY ?? -Infinity, stageCameraBounds.maxY + STAGE_CAMERA_PADDING.y)
  } : null;
  const { applyFittedCamera } = createFittedCamera({
    session, layout: {
      stagePlaqueContainmentBounds,
      stageFitContainmentBounds,
      fitLeft,
      fitRight,
      fitTop,
      fitBottom,
      completedReplayStep,
      g,
      fitFallbackOverlays,
      stageIndex: activeDerivationFrameIndex,
      closesOnEntry,
      controls: { top: uiBounds.top, right: uiBounds.right, bottom: uiBounds.bottom, panelTop: uiBounds.panelTop },
      paintedNodes: new Map(visibleNodes.map(node => [getNodeId(node),
        { x: node.x, y: node.y, parentId: node.parent ? getNodeId(node.parent) : null }]))
    }
  });
  // The Canopy (not animated) always shows its whole tree, however small that
  // makes it; the user zooms in to read.
  const minimumInitialScale = !session.animated ? 0
    : CAMERA_ZOOM.minimumFitScale[compactViewport || hasCyclicLinearizationPlate ? 'compact' : 'regular'];
  const fitToRenderedBounds = () => {
    if (derivationFrameFitNodes && derivationFrameFitNodes.length > 0) {
      const minNodeX = stageCameraBounds?.minX ?? Math.min(
        d3.min(derivationFrameFitNodes, (node) => node.x) ?? 0,
        overlayFitBounds?.minX ?? Infinity
      );
      const maxNodeX = stageCameraBounds?.maxX ?? Math.max(
        d3.max(derivationFrameFitNodes, (node) => node.x) ?? 0,
        overlayFitBounds?.maxX ?? -Infinity
      );
      const minNodeY = stageCameraBounds?.minY ?? Math.min(
        d3.min(derivationFrameFitNodes, (node) => node.y) ?? 0,
        overlayFitBounds?.minY ?? Infinity
      );
      const maxNodeY = stageCameraBounds?.maxY ?? Math.max(
        d3.max(derivationFrameFitNodes, (node) => node.y + (!node.children || node.children.length === 0 ? LEAF_INK_EXTENT_Y : 0)) ?? 0,
        overlayFitBounds?.maxY ?? -Infinity
      );
      const availableWidth = Math.max(1, fitRight - fitLeft);
      const availableHeight = Math.max(1, fitBottom - fitTop);
      const contentWidth = Math.max(1, (maxNodeX - minNodeX) + 2 * STAGE_CAMERA_PADDING.x);
      const contentHeight = Math.max(1, (maxNodeY - minNodeY) + 2 * STAGE_CAMERA_PADDING.y);
      const scaleX = availableWidth / contentWidth;
      const scaleY = availableHeight / contentHeight;
      const initialScale = Math.max(minimumInitialScale, Math.min(scaleX, scaleY, 1));
      const centerX = (minNodeX + maxNodeX) / 2;
      const centerY = (minNodeY + maxNodeY) / 2;
      const initialX = fitLeft + (availableWidth / 2) - centerX * initialScale;
      const initialY = fitTop + (availableHeight / 2) - centerY * initialScale;
      applyFittedCamera(d3.zoomIdentity.translate(initialX, initialY).scale(initialScale));
      return true;
    }

    const rendered = g.node() as SVGGElement | null;
    if (!rendered) return false;

    const bbox = rendered.getBBox();
    if (!Number.isFinite(bbox.width) || !Number.isFinite(bbox.height) || bbox.width <= 0 || bbox.height <= 0) {
      return false;
    }

    const availableWidth = Math.max(1, fitRight - fitLeft);
    const availableHeight = Math.max(1, fitBottom - fitTop);

    const scaleX = availableWidth / bbox.width;
    const scaleY = availableHeight / bbox.height;
    const initialScale = Math.max(minimumInitialScale, Math.min(scaleX, scaleY, 1));

    const bboxCenterX = bbox.x + bbox.width / 2;
    const bboxCenterY = bbox.y + bbox.height / 2;
    const targetCenterX = fitLeft + availableWidth / 2;
    const targetCenterY = fitTop + availableHeight / 2;
    const initialX = targetCenterX - bboxCenterX * initialScale;
    const initialY = targetCenterY - bboxCenterY * initialScale;

    applyFittedCamera(d3.zoomIdentity.translate(initialX, initialY).scale(initialScale));
    return true;
  };

  if (!fitToRenderedBounds() && visibleNodes.length > 0) {
    // Fallback fit in case getBBox is unavailable.
    const minNodeX = d3.min(visibleNodes, (node) => node.x) ?? 0;
    const maxNodeX = d3.max(visibleNodes, (node) => node.x) ?? 0;
    const minNodeY = d3.min(visibleNodes, (node) => node.y) ?? 0;
    const maxNodeY = d3.max(visibleNodes, (node) => node.y + (!node.children || node.children.length === 0 ? LEAF_INK_EXTENT_Y : 0)) ?? 0;
    const contentWidth = Math.max(1, (maxNodeX - minNodeX) + 2 * STAGE_CAMERA_PADDING.x);
    const contentHeight = Math.max(1, (maxNodeY - minNodeY) + 2 * STAGE_CAMERA_PADDING.y);
    const fallbackViewportPadLeft = fitLeft;
    const fallbackViewportPadRight = containerWidth - fitRight;
    const fallbackViewportPadTop = fitTop;
    const fallbackViewportPadBottom = containerHeight - fitBottom;
    const scaleX = Math.max(0.01, (containerWidth - fallbackViewportPadLeft - fallbackViewportPadRight) / contentWidth);
    const scaleY = Math.max(
      0.01,
      (containerHeight - fallbackViewportPadTop - fallbackViewportPadBottom) / contentHeight
    );
    const initialScale = Math.max(minimumInitialScale, Math.min(scaleX, scaleY, 1));
    const centerX = (minNodeX + maxNodeX) / 2;
    const centerY = (minNodeY + maxNodeY) / 2;
    const initialX = fallbackViewportPadLeft + ((containerWidth - fallbackViewportPadLeft - fallbackViewportPadRight) / 2) - centerX * initialScale;
    const initialY = fallbackViewportPadTop
      + ((containerHeight - fallbackViewportPadTop - fallbackViewportPadBottom) / 2)
      - centerY * initialScale;
    applyFittedCamera(d3.zoomIdentity.translate(initialX, initialY).scale(initialScale));
  }

}
