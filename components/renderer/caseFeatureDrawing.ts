import * as d3 from 'd3';
import { getNodeId } from '../../replay/displayIdentity.ts';
import {
  caseFeatureComposition
} from '../../replay/relations/featureComposition.ts';
import {
  caseAssignmentPlaquePath,
  featureCollectionPlaquePath
} from '../../replay/relations/overlayGeometry.ts';
import { caseAssignmentSource, projectPlaqueLayout } from '../../replay/relations/plaquePlacement.ts';
import {
  prepareCasePlaqueRows
} from '../../replay/relations/plaqueTextLayout.ts';
import {
  planItemRelationRefs,
  type RelationPlanItem
} from '../../replay/relations/renderPlan.ts';
import { type SyntaxNode } from '../../types.ts';
import { coalesceCollectionPaths, collectionPathAttachment } from '../collectionPaths.ts';
import type { ClaimDrawing, DrawingLayer, RelationEmphasis, RelationLayers, TreeMeasurements } from './drawingContext.ts';

interface CaseFeatureDrawingContext extends Pick<ClaimDrawing, 'decorateRelationElement'>, Pick<RelationLayers, 'ensureAgreementCaseRelationLayer'>, Pick<TreeMeasurements, 'measuredTreeLabelRectNow' | 'measuredTerminalSubtreeRectNow'> {
  relationEmphasisForItem: (item: RelationPlanItem) => RelationEmphasis;
  activeDerivationFrameIndex: number;
  markerScale: number;
  frameItems: RelationPlanItem[];
  replayPlaqueLayout: ReturnType<typeof projectPlaqueLayout>;
  renderedCaseCompositions: Set<string>;
  revealedItemIndices: Set<number>;
  overlayNodeById: Map<string, d3.HierarchyPointNode<SyntaxNode>>;
  markPreterminalLensNode: (nodeId: string, role: string) => void;
}
export function createCaseFeatureDrawing({
  decorateRelationElement,
  relationEmphasisForItem,
  activeDerivationFrameIndex,
  markerScale,
  frameItems,
  replayPlaqueLayout,
  renderedCaseCompositions,
  revealedItemIndices,
  ensureAgreementCaseRelationLayer,
  measuredTreeLabelRectNow,
  measuredTerminalSubtreeRectNow,
  overlayNodeById,
  markPreterminalLensNode
}: CaseFeatureDrawingContext) {
  const drawPlaqueDependencyPath = (layer: DrawingLayer,
    item: Extract<RelationPlanItem, { kind: 'directed-path' }>, d: string, reveal = false,
    failureCue: string[] | false = [d]) => {
    const blocked = item.outcome === 'blocked';
    const assignment = item.pathStyle === 'case-assignment';
    const ink = blocked ? layer.append('g').attr('class', 'babel-collection-ink') : layer;
    if (blocked) decorateRelationElement(ink.node()!, item, relationEmphasisForItem(item));
    const path = ink.append('path')
      .attr('class', assignment ? 'babel-case-assignment-path' : 'babel-case-collection-path')
      .attr('marker-end', assignment && !blocked ? `url(#babel-agree-arrow-${activeDerivationFrameIndex})` : null)
      .attr('data-case-outcome', assignment ? item.outcome || '' : null)
      .attr('data-collection-plaque', !assignment && reveal ? 'true' : null).attr('d', d);
    decorateRelationElement(path.node()!, item, relationEmphasisForItem(item));
    if (!blocked || !failureCue) return;
    const measure = path.node()!.cloneNode(false) as SVGPathElement;
    const points = failureCue.map(route => {
      measure.setAttribute('d', route);
      return measure.getPointAtLength(measure.getTotalLength() / 2);
    });
    const point = { x: d3.mean(points, p => p.x)!, y: d3.mean(points, p => p.y)! };
    const cue = ink.append('g').attr('class', `vr-overlay-marker babel-dependency-failure ${assignment
      ? 'babel-case-assignment-failure' : 'babel-collection-failure'}`)
      .attr('data-vr-x', String(point.x)).attr('data-vr-y', String(point.y))
      .attr('transform', `translate(${point.x},${point.y}) scale(${markerScale})`);
    decorateRelationElement(cue.node()!, item, relationEmphasisForItem(item));
    cue.append('text').attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .attr('font-size', '14px').attr('fill', 'var(--babel-relation-ink, #34d399)').text('✗');
  };
  const drawCaseFeatureComposition = (assignmentIndex: number) => {
    const composition = caseFeatureComposition(frameItems, assignmentIndex);
    const placement = replayPlaqueLayout.get(assignmentIndex);
    if (!composition || !placement || renderedCaseCompositions.has(String(assignmentIndex))) return;
    const revealedOwners = [...new Set(composition.rows.flatMap(row => row.ownerIndices))]
      .filter(index => revealedItemIndices.has(index));
    if (!revealedOwners.length) return;
    renderedCaseCompositions.add(String(assignmentIndex));
    const { assignment } = composition;
    const rowLayout = prepareCasePlaqueRows(composition.rows);
    const box = { x: placement.x, y: placement.y, width: rowLayout.width, height: rowLayout.height };
    const layer = ensureAgreementCaseRelationLayer();
    const plaque = layer.append('g')
      .attr('class', 'babel-feature-plaque babel-case-feature-plaque')
      .attr('data-feature-placement', 'accepted');
    // The shell shares the visible contributors; each row and line retains its own owners.
    // Keeping the shell beside the rows avoids multiplying a quiet parent's opacity.
    const decorateOwners = (element: SVGElement, indices: number[]) => {
      const visible = indices.filter(index => revealedItemIndices.has(index));
      const refs = [...new Map(visible.flatMap(index => planItemRelationRefs(frameItems[index]))
        .map(ref => [`${ref.stageIndex}:${ref.relationIndex}`, ref])).values()];
      const item = { ...frameItems[visible[0]], relationRef: refs[0], composedRefs: refs.slice(1), coalescedRefs: [] };
      decorateRelationElement(element, item, relationEmphasisForItem(item));
    };
    const shell = plaque.append('g').attr('class', 'babel-feature-plaque-frame');
    decorateOwners(shell.node()!, revealedOwners);
    shell.append('rect').attr('class', 'babel-feature-plaque-shell')
      .attr('x', box.x.toFixed(1)).attr('y', box.y.toFixed(1))
      .attr('width', box.width.toFixed(1)).attr('height', box.height.toFixed(1)).attr('rx', 12);
    shell.append('text').attr('class', 'babel-feature-plaque-title')
      .attr('x', (box.x + 20).toFixed(1)).attr('y', (box.y + 32).toFixed(1)).text('CASE / AGREEMENT');
    const rowTargets = new Map<number, number>();
    rowLayout.rows.forEach((row, rowIndex) => {
      const claim = composition.rows[rowIndex];
      claim.ownerIndices.forEach(index => rowTargets.set(index, box.y + row.y));
      if (!claim.ownerIndices.some(index => revealedItemIndices.has(index))) return;
      const group = plaque.append('g').attr('class', 'babel-feature-row')
        .attr('data-feature-label', row.label).attr('data-feature-anchor', claim.ownerNodeId)
        .attr('data-feature-source', claim.sourceNodeId ?? null);
      decorateOwners(group.node()!, claim.ownerIndices);
      const text = group.append('text').attr('class', 'babel-feature-text').attr('dominant-baseline', 'middle');
      row.lines.forEach((line, lineIndex) => text.append('tspan')
        .attr('x', (box.x + 22).toFixed(1))
        .attr('y', (box.y + row.firstLineY + lineIndex * 38).toFixed(1)).text(line));
    });
    const anchorRect = (id: string) => measuredTreeLabelRectNow(id, false) || measuredTerminalSubtreeRectNow(id);
    let assignmentPath: { item: typeof assignment; d: string } | undefined;
    if (revealedItemIndices.has(assignmentIndex)) {
      const assigner = overlayNodeById.get(assignment.fromNodeId);
      const source = assigner ? caseAssignmentSource(assigner) : null;
      const sourceId = source ? getNodeId(source) : assignment.fromNodeId;
      const sourceRect = source && !source.children?.length && source.data.word
        ? measuredTerminalSubtreeRectNow(sourceId) || anchorRect(sourceId) : anchorRect(sourceId);
      if (sourceRect && anchorRect(assignment.toNodeId)) {
        markPreterminalLensNode(assignment.fromNodeId, 'case-assigner');
        assignmentPath = {
          item: assignment,
          d: caseAssignmentPlaquePath(sourceRect, box, rowTargets.get(assignmentIndex)!, placement.caseRoute)
        };
      }
    }
    const collections = composition.collections.flatMap(({ item, index }, lane) => {
      if (!revealedItemIndices.has(index)) return [];
      const sourceRect = anchorRect(item.toNodeId);
      if (!sourceRect || !anchorRect(item.fromNodeId)) return [];
      const attachment = collectionPathAttachment(placement, item);
      return [{
        item, d: featureCollectionPlaquePath(box, rowTargets.get(index)!, sourceRect, lane,
          attachment?.edge, attachment?.portX)
      }];
    });
    coalesceCollectionPaths([...(assignmentPath ? [assignmentPath] : []), ...collections]).forEach(({ item, d, failureCue }) => {
      drawPlaqueDependencyPath(layer, item, d, true, failureCue);
    });
  };
  return { drawPlaqueDependencyPath, drawCaseFeatureComposition };
}
