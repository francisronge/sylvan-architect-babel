import * as d3 from 'd3';
import { getNodeId } from '../../replay/displayIdentity.ts';
import { resolveUniqueDisplayTerminal } from '../../replay/relations/trajectoryAttachment.ts';
import { indexHierarchyNodesByIdAndAliases } from '../../replay/replayCanvas.ts';
import {
  isDisplayTerminalNode,
  isDisplayTraceLabel
} from '../../replay/replaySurfaceNotation.ts';
import { type HierNode } from '../../replay/types.ts';
import { type SyntaxNode } from '../../types.ts';
import type { DrawingLayer } from './drawingContext.ts';

interface RelationAnchorsContext {
  visibleNodes: d3.HierarchyPointNode<SyntaxNode>[];
  treeData: d3.HierarchyPointNode<SyntaxNode>;
  g: DrawingLayer;
}
export function createRelationAnchors({ visibleNodes, treeData, g }: RelationAnchorsContext) {
  const overlayNodeById = indexHierarchyNodesByIdAndAliases(
    visibleNodes as d3.HierarchyPointNode<SyntaxNode>[]
  );
  const visibleOverlayIds = new Set(overlayNodeById.keys());
  /*
   * Replay may keep an authored node (a pending Infl/T wrapper, an
   * expanded preterminal) out of the directly rendered set while its
   * display material stays visible. The anchored node's laid-out position
   * is still real geometry, so an anchor resolves whenever its own
   * subtree has visible material; an anchor with nothing visible fails
   * closed.
   */
  const laidOutNodeById = indexHierarchyNodesByIdAndAliases(
    treeData.descendants() as d3.HierarchyPointNode<SyntaxNode>[]
  );
  const resolveOverlayAnchor = (nodeId: string) => {
    const direct = overlayNodeById.get(nodeId);
    if (direct) return direct;
    const laidOut = laidOutNodeById.get(nodeId);
    if (!laidOut) return undefined;
    const hasVisibleMaterial = laidOut.descendants()
      .some((descendant) => visibleOverlayIds.has(getNodeId(descendant as unknown as HierNode)));
    return hasVisibleMaterial ? laidOut : undefined;
  };
  const isTerminal = (candidate: d3.HierarchyPointNode<SyntaxNode>) => isDisplayTerminalNode(candidate.data);
  /*
   * ONE terminal law for both providers (see
   * resolveUniqueDisplayTerminal): the anchor itself, else exactly one
   * display terminal in the exact subtree; zero or several fail closed —
   * an ambiguous anchor is recorded as a structured diagnostic, never
   * resolved by traversal order or current visibility.
   */
  const terminalAmbiguities = new Map<string, number>();
  const resolveMaterializedTerminal = (
    anchor: d3.HierarchyPointNode<SyntaxNode> | undefined,
    anchorNodeId: string
  ) => {
    if (!anchor) return undefined;
    const resolution = resolveUniqueDisplayTerminal(
      anchor,
      (candidate) => candidate.children || [],
      isTerminal
    );
    if (resolution.terminal) return resolution.terminal;
    if (resolution.reason === 'ambiguous') {
      terminalAmbiguities.set(anchorNodeId, resolution.count);
    }
    return undefined;
  };
  const markPreterminalLensNode = (nodeId: string, role: string) => {
    const anchor = resolveOverlayAnchor(nodeId);
    const children = anchor?.children || [];
    if (children.length !== 1 || !isTerminal(children[0])) return;
    const terminalId = getNodeId(children[0] as unknown as HierNode);
    g.selectAll<SVGTextElement, HierNode>('.terminal-label')
      .filter(function exactPreterminal(candidate) {
        return getNodeId(candidate) === terminalId
          || this.getAttribute('data-node-id') === terminalId;
      })
      .classed('babel-lens-node', true)
      .attr('data-lens-role', role)
      .each(function markProductionLensOwner() {
        (this as SVGTextElement & { __babelProductionLens?: true }).__babelProductionLens = true;
      });
  };
  const markSubtreeLensNodes = (nodeId: string, role: string) => {
    const anchor = resolveOverlayAnchor(nodeId);
    if (!anchor) return;
    const terminalIds = new Set(
      anchor.descendants()
        .filter((candidate) => (candidate.children || []).length === 0)
        .map((candidate) => getNodeId(candidate as unknown as HierNode))
    );
    g.selectAll<SVGTextElement, HierNode>('.terminal-label')
      .filter((candidate) => terminalIds.has(getNodeId(candidate)))
      .classed('babel-lens-node', true)
      .attr('data-lens-role', role)
      .each(function markProductionLensOwner() {
        (this as SVGTextElement & { __babelProductionLens?: true }).__babelProductionLens = true;
      });
  };
  const markIdentityLensOccurrences = (nodeIds: string[]) => {
    nodeIds.forEach((nodeId) => {
      const anchor = resolveOverlayAnchor(nodeId);
      if (!anchor) return;
      const terminalIds = new Set(
        anchor.descendants()
          .filter((candidate) => (candidate.children || []).length === 0)
          .map((candidate) => getNodeId(candidate as unknown as HierNode))
      );
      g.selectAll<SVGTextElement, HierNode>('.terminal-label')
        .filter((candidate) => terminalIds.has(getNodeId(candidate)))
        .each(function markIdentityOccurrence(candidate) {
          const rendered = String(this.textContent || '').trim();
          const trace = isDisplayTraceLabel(rendered);
          if ((candidate.data as SyntaxNode).silent === true && !trace) return;
          const label = d3.select(this)
            .classed('babel-lens-node', true)
            .attr('data-lens-role', trace ? 'trace' : 'pronounced');
          if (trace) label.classed('babel-moved-from-copy', false);
          (this as SVGTextElement & { __babelProductionLens?: true }).__babelProductionLens = true;
        });
    });
  };
  const clearMovedCopyClassForAnchors = (nodeIds: string[]) => {
    const terminalIds = new Set<string>();
    nodeIds.forEach((nodeId) => {
      const anchor = resolveOverlayAnchor(nodeId);
      anchor?.descendants()
        .filter((candidate) => (candidate.children || []).length === 0)
        .forEach((candidate) => terminalIds.add(
          getNodeId(candidate as unknown as HierNode)
        ));
    });
    g.selectAll<SVGTextElement, HierNode>('.terminal-label')
      .filter((candidate) => terminalIds.has(getNodeId(candidate)))
      .classed('babel-moved-from-copy', false);
  };

  return {
    overlayNodeById,
    resolveOverlayAnchor,
    isDisplayTerminalNode: isTerminal,
    terminalAmbiguities,
    resolveMaterializedTerminal,
    markPreterminalLensNode,
    markSubtreeLensNodes,
    markIdentityLensOccurrences,
    clearMovedCopyClassForAnchors
  };
}
