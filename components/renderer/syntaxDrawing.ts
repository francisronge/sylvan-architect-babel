import * as d3 from 'd3';
import type { ResolvedRelationLink } from '../../relationLinks.ts';
import {
  CATEGORY_LABEL, categoryLineBaselineY, quadraticTrajectoryBellyY, TERMINAL_LABEL, TERMINAL_STEM, TRAJECTORY_ROUTES
} from '../../replay/rendererMetrics.ts';
import { getNodeId } from '../../replay/displayIdentity.ts';
import {
  buildResolvedLinkOperatorVariableIndexMap,
  buildResolvedLinkRawTraceAliasMap,
  resolveLexicalMovementTraceDisplayIndex,
  resolveTraceIndexFromNodeContext
} from '../../replay/movementIndices.ts';
import { normalizeTrajectoryKind } from '../../replay/movementLinks.ts';
import {
  MOVEMENT_ARC_STROKE,
  MOVEMENT_ARROW_COLOR,
  buildFirstRevealNodeStepIndex,
  buildMovementArrowsFromLinks,
  buildMovementCopyTraceIndexByTerminalId,
  buildNodeStepIndex
} from '../../replay/movementPresentation.ts';
import type { RelationRenderPlan } from '../../replay/relations/renderPlan.ts';
import { isSyntheticWorkspaceRootNode } from '../../replay/replayCanvas.ts';
import {
  extractMovementIndex,
  formatAuthoredWitnessSurface,
  formatIndexedSurfaceForDisplayValue,
  formatTraceSurfaceForDisplayValue,
  isNullLike,
  isTraceLike,
  isWordlessCategoryLeaf,
  normalizeTraceIndexForDisplay,
  resolveLeafSurface,
  shouldExpandPreterminalLeaf
} from '../../replay/replaySurfaceNotation.ts';
import { collectPronouncedLeafNodeIdsInOrder, hasSilentOrGhostAncestor, isPronouncedHierLeaf, normalizeToken } from '../../replay/syntaxForest.ts';
import {
  categoryLabelLines,
  stagedTerminalText
} from '../../replay/treeLabelRuns.ts';
import { isUnderTriangulation } from '../../replay/triangulation.ts';
import type { PlaybackStep, ReplayDerivationFrame } from '../../replay/types.ts';
import { type HierNode, type MovementArrow, type VisibleLink } from '../../replay/types.ts';
import { caseSurfaceInitial } from '../../server/babelParser/surfaceTokens.js';
import { type SyntaxNode } from '../../types.ts';
import type { DrawingLayer } from './drawingContext.ts';
import { sentenceInitialLeafCapitalizer } from './syntaxReveal.ts';
import { createTreeGraphicsMeasure } from './treeMeasurements.ts';

type TriangulatedNode = HierNode & {isTriangulated?: boolean; triangulatedWords?: string};

export interface SyntaxDrawingContext {
  treeData: d3.HierarchyPointNode<SyntaxNode>;
  replayVisibleNodeIdSet: Set<string> | null;
  playbackSteps: PlaybackStep[];
  animated: boolean;
  activeStepIndex: number;
  traceDisplayIndexByNodeId: Map<string, string>;
  /** Category-label chain indices of moved phrases (`buildResolvedLinkChainIndices`). */
  phraseChainIndexByNodeId: Map<string, string>;
  traceDisplayFrame: ReplayDerivationFrame | null;
  traceDisplayRelationLinks: ResolvedRelationLink[];
  traceDisplayFrameIndex: number;
  usesDerivationFrames: boolean;
  activeDerivationArrowLinks: ResolvedRelationLink[];
  rootHierarchy: d3.HierarchyNode<SyntaxNode>;
  clonedCanvasData: SyntaxNode;
  firstSentenceReplayToken: string;
  firstSentenceReplayDisplayToken: string;
  terminalMorphRef: { current: Map<string, { preText: string; postText: string; step: number; hideBefore: boolean }> };
  g: DrawingLayer;
  relationRenderPlan: RelationRenderPlan | null;
  measureCategoryText: (text: string) => number;
  currentReplayStep: PlaybackStep | null;
  pendingPhraseFrontingSourceNodeIds: Set<string>;
  hasDerivationFrames: boolean;
}
export function paintSyntaxTree({
  treeData,
  replayVisibleNodeIdSet,
  playbackSteps,
  animated,
  activeStepIndex,
  traceDisplayIndexByNodeId,
  phraseChainIndexByNodeId,
  traceDisplayFrame,
  traceDisplayRelationLinks,
  traceDisplayFrameIndex,
  usesDerivationFrames,
  activeDerivationArrowLinks,
  rootHierarchy,
  clonedCanvasData,
  firstSentenceReplayToken,
  firstSentenceReplayDisplayToken,
  terminalMorphRef,
  g,
  relationRenderPlan,
  measureCategoryText,
  currentReplayStep,
  pendingPhraseFrontingSourceNodeIds,
  hasDerivationFrames
}: SyntaxDrawingContext) {
  const BRANCH_COLOR = '#593a0e';
  const PURE_WHITE = '#ffffff';
  const TARGET_EMERALD = '#10b981';
  const SILENT_SAGE = '#9caf99';

  // 1. RENDER BRANCHES
  const visibleNodes = treeData.descendants().filter((node) =>
    !isUnderTriangulation(node)
    && !isSyntheticWorkspaceRootNode(node)
    && (!replayVisibleNodeIdSet || replayVisibleNodeIdSet.has(getNodeId(node)))
  );
  const visibleLinks = treeData.links().filter((link) =>
    !isUnderTriangulation(link.target)
    && !isSyntheticWorkspaceRootNode(link.source)
    && !isSyntheticWorkspaceRootNode(link.target)
    && (!replayVisibleNodeIdSet || (
      replayVisibleNodeIdSet.has(getNodeId(link.source))
      && replayVisibleNodeIdSet.has(getNodeId(link.target))
    ))
  ) as VisibleLink[];
  const timeline = playbackSteps;
  const nodeStepIndex = buildNodeStepIndex(timeline);
  const firstRevealNodeStepIndex = buildFirstRevealNodeStepIndex(timeline);
  const revealThreshold = animated ? activeStepIndex : Number.MAX_SAFE_INTEGER;
  const derivationTraceIndexByNodeId = traceDisplayIndexByNodeId;
  const derivationOperatorVariableIndexByNodeId = traceDisplayFrame
    ? (() => {
      const workspaceForest = traceDisplayFrame.workspaceForest || [];
      return buildResolvedLinkOperatorVariableIndexMap(
        workspaceForest,
        traceDisplayRelationLinks,
        traceDisplayFrameIndex
      );
    })()
    : new Map<string, string>();
  const operatorVariableWitnessNodeIds = new Set(
    (traceDisplayRelationLinks || [])
      .filter((link) => {
        const relation = String(link?.relation || link?.operation || '').trim();
        const stepIndex = Number.isInteger(link?.stepIndex) ? Number(link.stepIndex) : 0;
        return /operator\s*[-\s]?variable\s*[-\s]?binding/i.test(relation)
          && stepIndex <= traceDisplayFrameIndex;
      })
      .map((link) => String(link?.witnessNodeId || ''))
      .filter(Boolean)
  );
  const derivationRawTraceAliasByIndex = traceDisplayFrame
    ? (() => {
      const workspaceForest = traceDisplayFrame.workspaceForest || [];
      return buildResolvedLinkRawTraceAliasMap(
        workspaceForest,
        traceDisplayRelationLinks,
        traceDisplayFrameIndex
      );
    })()
    : new Map<string, string>();
  const movementArrows = animated
    ? (
      usesDerivationFrames
        ? buildMovementArrowsFromLinks(
          visibleNodes,
          activeDerivationArrowLinks,
          nodeStepIndex,
          timeline
        )
        : []
    )
    : [];
  const effectiveRevealThreshold = usesDerivationFrames
    ? Number.MAX_SAFE_INTEGER
    : revealThreshold;
  const nodeRevealStepIndex = new Map(firstRevealNodeStepIndex);
  const terminalMorph = new Map<string, { preText: string; postText: string; step: number; hideBefore: boolean }>();
  /*
   * A lower occurrence is authored as silent lexical material so Replay can
   * show it overtly before movement. Occupant-as-authored ruling: once its
   * exact phrasal movement relation has played, the vacated occurrence keeps
   * its authored words, ghosted, and gains only the chain-index subscript.
   * Babel never rewrites a copy into a trace; trace display belongs solely
   * to occupants the model authored as traces. The map below supplies the
   * chain index for that subscript.
   */
  const movedFromCopyTraceIndexByTerminalId =
    buildMovementCopyTraceIndexByTerminalId(movementArrows);
  const unrevealedStep = usesDerivationFrames ? Number.MAX_SAFE_INTEGER : 0;
  const getRevealStepForNodeId = (nodeId: string): number =>
    nodeRevealStepIndex.has(nodeId)
      ? (nodeRevealStepIndex.get(nodeId) as number)
      : unrevealedStep;
  const findFirstOvertLeafDescendant = (node: HierNode | null): HierNode | null => {
    if (!node) return null;
    const stack: HierNode[] = [node];
    while (stack.length > 0) {
      const current = stack.shift() as HierNode;
      const children = current.children || [];
      if (children.length === 0) {
        if (isPronouncedHierLeaf(current)) return current;
        continue;
      }
      stack.unshift(...children);
    }
    return null;
  };
  const hierarchyNodeById = new Map<string, HierNode>(
    rootHierarchy.descendants().map((node): [string, HierNode] => [getNodeId(node), node])
  );
  const firstVisibleOvertLeafId = String(
    collectPronouncedLeafNodeIdsInOrder(clonedCanvasData).find((nodeId) => {
      if (!replayVisibleNodeIdSet) return true;
      let current = hierarchyNodeById.get(nodeId) || null;
      while (current) {
        if (replayVisibleNodeIdSet.has(getNodeId(current))) return true;
        current = current.parent;
      }
      return false;
    }) || ''
  );

  movementArrows.forEach((arrow) => {
    const sourceId = getNodeId(arrow.source);
    const targetId = getNodeId(arrow.target);
    const sourceStep = getRevealStepForNodeId(sourceId);
    const targetStep = getRevealStepForNodeId(targetId);
    nodeRevealStepIndex.set(sourceId, Math.min(sourceStep, arrow.step));
    nodeRevealStepIndex.set(targetId, Math.max(targetStep, arrow.step));
    if (arrow.traceNode) {
      const traceId = getNodeId(arrow.traceNode);
      const traceStep = getRevealStepForNodeId(traceId);
      nodeRevealStepIndex.set(traceId, Math.min(traceStep, arrow.step));
    }

    const sourceSurface = resolveLeafSurface(arrow.source);
    const targetSurface = resolveLeafSurface(arrow.target);
    const traceAnchor = arrow.traceNode || (isTraceLike(sourceSurface) ? arrow.source : null);
    if (traceAnchor) {
      const traceId = getNodeId(traceAnchor);
      const traceSurface = resolveLeafSurface(traceAnchor);
      const traceRawAlias = extractMovementIndex(traceSurface);
      const targetRawAlias = extractMovementIndex(targetSurface);
      const relationIndex = arrow.index
        || (traceRawAlias ? derivationRawTraceAliasByIndex.get(String(traceRawAlias).trim().toLowerCase()) : undefined)
        || (targetRawAlias ? derivationRawTraceAliasByIndex.get(String(targetRawAlias).trim().toLowerCase()) : undefined)
        || traceRawAlias
        || targetRawAlias
        || null;
      // Additive indexing only: an authored `t` gains its index; any other
      // authored witness surface (∅, silent lexical material) stays exactly
      // as authored.
      const formattedTraceSurface = isTraceLike(traceSurface)
        ? formatTraceSurfaceForDisplayValue(traceSurface, relationIndex)
        : traceSurface;
      terminalMorph.set(traceId, {
        preText: formattedTraceSurface,
        postText: formattedTraceSurface,
        step: arrow.step,
        hideBefore: false
      });
    }

    if ((arrow.target.children && arrow.target.children.length > 0)) {
      if (normalizeTrajectoryKind(arrow.trajectoryKind) !== 'head') {
        const sentenceInitialLeaf = findFirstOvertLeafDescendant(arrow.target);
        const sentenceInitialSurface = sentenceInitialLeaf
          ? resolveLeafSurface(sentenceInitialLeaf)
          : '';
        const preMovementSentenceInitialSurface =
          firstSentenceReplayToken
            && normalizeToken(sentenceInitialSurface) === normalizeToken(firstSentenceReplayToken)
            ? caseSurfaceInitial(firstSentenceReplayToken, 'lower')
            : sentenceInitialSurface;
        const shouldCapitalizeSentenceInitialLeaf =
          sentenceInitialLeaf
          && getNodeId(sentenceInitialLeaf) === firstVisibleOvertLeafId;
        if (!usesDerivationFrames && sentenceInitialLeaf && shouldCapitalizeSentenceInitialLeaf) {
          terminalMorph.set(getNodeId(sentenceInitialLeaf), {
            preText: preMovementSentenceInitialSurface,
            postText: firstSentenceReplayDisplayToken || caseSurfaceInitial(sentenceInitialSurface, 'upper'),
            step: arrow.step,
            hideBefore: false
          });
        }
      }
    }

    if ((arrow.source.children && arrow.source.children.length > 0) || (arrow.target.children && arrow.target.children.length > 0)) {
      return;
    }

    if (!targetSurface) return;

    const targetIsRenderableTerminal = !isWordlessCategoryLeaf(arrow.target.data as SyntaxNode);
    if (!targetIsRenderableTerminal) return;

    terminalMorph.set(targetId, {
      preText: '',
      postText: isTraceLike(targetSurface)
        ? formatTraceSurfaceForDisplayValue(
          targetSurface,
          arrow.index
          || (() => {
            const rawAlias = extractMovementIndex(targetSurface);
            return rawAlias
              ? derivationRawTraceAliasByIndex.get(String(rawAlias).trim().toLowerCase())
              : undefined;
          })()
          || extractMovementIndex(targetSurface)
        )
        : targetSurface,
      step: arrow.step,
      hideBefore: true
    });
  });

  terminalMorphRef.current = terminalMorph;

  g.selectAll('.branch')
    .data(visibleLinks)
    .enter()
    .append('path')
    .attr('class', 'branch')
    .attr('data-source-node-id', (d: VisibleLink) => getNodeId(d.source))
    .attr('data-target-node-id', (d: VisibleLink) => getNodeId(d.target))
    .attr('fill', 'none')
    .attr('stroke', BRANCH_COLOR)
    .attr('stroke-width', 4)
    .attr('data-step', (d: VisibleLink) => String(getRevealStepForNodeId(getNodeId(d.target))))
    .attr('opacity', (d: VisibleLink) => {
      const step = getRevealStepForNodeId(getNodeId(d.target));
      return step <= effectiveRevealThreshold ? 0.6 : 0;
    })
    .style('transition', 'opacity 280ms ease')
    .attr('d', d3.linkVertical<d3.HierarchyPointLink<SyntaxNode>, d3.HierarchyPointNode<SyntaxNode>>().x(d => d.x).y(d => d.y));

  // Resolved movement arrows draw here only when the compiled overlay is not
  // already drawing authored trajectories.
  const planOwnsTrajectories = Boolean(relationRenderPlan?.frames.some((planFrame) =>
    planFrame.items.some((planItem) => planItem.kind === 'trajectory')));
  if (movementArrows.length > 0 && !planOwnsTrajectories) {
    const defs = g.append('defs');
    defs.append('marker')
      .attr('id', 'movement-arrowhead')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 9)
      .attr('refY', 5)
      .attr('markerWidth', 7)
      .attr('markerHeight', 7)
      .attr('orient', 'auto-start-reverse')
      .append('path')
      .attr('d', 'M 0 0 L 10 5 L 0 10 z')
      .attr('fill', MOVEMENT_ARROW_COLOR);

    const arrowsBySource = new Map<string, MovementArrow[]>();
    const arrowsByTarget = new Map<string, MovementArrow[]>();
    movementArrows.forEach((arrow) => {
      const sourceId = getNodeId(arrow.source);
      const targetId = getNodeId(arrow.target);
      const sourceBucket = arrowsBySource.get(sourceId) || [];
      sourceBucket.push(arrow);
      arrowsBySource.set(sourceId, sourceBucket);
      const targetBucket = arrowsByTarget.get(targetId) || [];
      targetBucket.push(arrow);
      arrowsByTarget.set(targetId, targetBucket);
    });

    const getGroupedOffset = (bucket: MovementArrow[] | undefined, arrow: MovementArrow): number => {
      if (!bucket || bucket.length <= 1) return 0;
      const ordinal = bucket.findIndex((candidate) => candidate === arrow);
      if (ordinal < 0) return 0;
      return (ordinal - ((bucket.length - 1) / 2)) * 18;
    };

    g.selectAll('.movement-arrow')
      .data(movementArrows)
      .enter()
      .append('path')
      .attr('class', 'movement-arrow')
      .attr('fill', 'none')
      .attr('stroke', MOVEMENT_ARROW_COLOR)
      .attr('stroke-width', MOVEMENT_ARC_STROKE)
      .attr('stroke-linecap', 'round')
      .attr('marker-end', 'url(#movement-arrowhead)')
      .attr('data-step', (arrow) => String(arrow.step))
      // Keep replay text and movement visuals synchronized per step.
      .style('transition', 'opacity 80ms linear')
      .attr('opacity', (arrow) => (arrow.step <= effectiveRevealThreshold ? 0.9 : 0))
      .style('filter', 'drop-shadow(0 0 4px rgba(16,185,129,0.35))')
      .attr('d', (arrow) => {
        const sourceOffset = getGroupedOffset(arrowsBySource.get(getNodeId(arrow.source)), arrow);
        const targetOffset = getGroupedOffset(arrowsByTarget.get(getNodeId(arrow.target)), arrow);
        // Arrow endpoints are nodes of the laid-out tree.
        const direction = Math.sign(arrow.target.x! - arrow.source.x!) || 1;
        const inset = TRAJECTORY_ROUTES.quadraticEndpointInset;
        const sx = arrow.source.x! + inset * direction + sourceOffset;
        const sy = arrow.source.y! + 24;
        const tx = arrow.target.x! - inset * direction + targetOffset;
        const ty = arrow.target.y! + 24;
        const controlX = (sx + tx) / 2;
        const controlY = quadraticTrajectoryBellyY({ x: sx, y: sy }, { x: tx, y: ty });
        return `M ${sx} ${sy} Q ${controlX} ${controlY}, ${tx} ${ty}`;
      });
  }

  // 2. RENDER NODE GROUPS
  const nodeGroups = g.selectAll('.node-group')
    .data(visibleNodes)
    .enter()
    .append('g')
    .attr('class', 'node-group')
    .attr('data-node-group-id', (d) => getNodeId(d))
    .attr('transform', (d) => `translate(${d.x},${d.y})`)
    .attr('data-step', (d) => String(getRevealStepForNodeId(getNodeId(d))))
    .attr('opacity', (d) => {
      const step = getRevealStepForNodeId(getNodeId(d));
      return step <= effectiveRevealThreshold ? 1 : 0;
    })
    .style('transition', 'opacity 260ms ease');

  // Wordless categories keep category geometry, even when authored silent.
  const categories = nodeGroups.filter((d) =>
    (Boolean(d.children) && d.children!.length > 0) || shouldExpandPreterminalLeaf(d.data)
    || isWordlessCategoryLeaf(d.data)
  );
  const categoryInk = (d: HierNode) =>
    isWordlessCategoryLeaf(d.data) && isReplaySilentTerminalLeaf(d) ? SILENT_SAGE : PURE_WHITE;
  // A category label's painted lines, with a moved phrase's chain index.
  const getReplayRenderedCategoryLines = (d: HierNode) => categoryLabelLines(d, phraseChainIndexByNodeId, measureCategoryText);
  categories.append('text')
    .attr('class', 'category-label')
    .attr('data-category-node-id', (d) => getNodeId(d))
    .attr('y', CATEGORY_LABEL.baselineY)
    .attr('text-anchor', 'middle')
    .attr('font-size', `${CATEGORY_LABEL.fontSize}px`)
    .attr('font-weight', String(CATEGORY_LABEL.fontWeight))
    .attr('fill', categoryInk)
    .style('fill', categoryInk, 'important')
    .style('font-style', 'normal')
    .style('font-family', 'Quicksand, sans-serif')
    .style('paint-order', 'stroke')
    .style('stroke', '#020806')
    .style('stroke-width', `${CATEGORY_LABEL.strokeWidth}px`)
    .attr('xml:space', 'preserve')
    .each(function (d) {
      const lines = getReplayRenderedCategoryLines(d);
      d3.select(this).selectAll('tspan').data(lines).join('tspan')
        .attr('x', 0).attr('y', (_line, index) => categoryLineBaselineY(index, lines.length))
        .text(line => line);
    });

  // Category text and its dark stroke paint over branches glyph by glyph.
  // A rectangular multiline mask would erase the whole incoming branch.

  // 4. TERMINAL WORDS (Leaf Nodes) - ABSOLUTE EMERALD
  const leafNodes = nodeGroups.filter(d => (!d.children || d.children.length === 0)
    && !isWordlessCategoryLeaf(d.data));
  const maybeCapitalizeSurfacedSentenceInitialLeaf = sentenceInitialLeafCapitalizer({
    animated,
    usesDerivationFrames,
    currentReplayStep,
    firstSentenceReplayToken,
    firstSentenceReplayDisplayToken,
    activeDerivationArrowLinks,
    pendingPhraseFrontingSourceNodeIds
  }, String(collectPronouncedLeafNodeIdsInOrder(clonedCanvasData)[0] || ''));
  const getReplayTerminalSurface = resolveLeafSurface;
  function isReplaySilentTerminalLeaf(node: HierNode): boolean {
    if (isPronouncedHierLeaf(node)) return false;
    const surface = resolveLeafSurface(node);
    if (isTraceLike(surface) || isNullLike(surface)) return true;
    return hasSilentOrGhostAncestor(node);
  }
  const getMovementCopyTraceIndex = (d: HierNode): string => {
    const chainIndex = resolveLexicalMovementTraceDisplayIndex(
      resolveLeafSurface(d),
      resolveTraceIndexFromNodeContext(d, derivationTraceIndexByNodeId)
    );
    if (hasDerivationFrames) return chainIndex;
    const arrowTraceIndex = movedFromCopyTraceIndexByTerminalId.get(getNodeId(d));
    if (arrowTraceIndex) return arrowTraceIndex;
    return '';
  };
  // Every leaf that is not a wordless category is terminal material: a
  // pronounced word, a silent copy, or authored notation.
  const terminals = leafNodes;
  const overtTerminals = terminals.filter((d) => {
    return !isRenderedReplaySilentTerminalLeaf(d);
  });
  const silentTerminals = terminals.filter((d) => {
    return isRenderedReplaySilentTerminalLeaf(d);
  });

  function getReplayRenderedTerminalText(d: HierNode): string {
    if (usesDerivationFrames && currentReplayStep?.replayCanvasData) return stagedTerminalText(d, {
      traceIndices: derivationTraceIndexByNodeId, operatorIndices: derivationOperatorVariableIndexByNodeId,
      rawTraceAliases: derivationRawTraceAliasByIndex
    });
    const nodeId = getNodeId(d);
    const movedFromCopyTraceIndex = getMovementCopyTraceIndex(d);
    if (movedFromCopyTraceIndex) {
      // Both endpoints keep their authored words and pronunciation.
      return formatIndexedSurfaceForDisplayValue(
        maybeCapitalizeSurfacedSentenceInitialLeaf(d, getReplayTerminalSurface(d)),
        movedFromCopyTraceIndex
      );
    }
    const fallback = maybeCapitalizeSurfacedSentenceInitialLeaf(d, getReplayTerminalSurface(d));
    if ((d.data as SyntaxNode & { ghost?: boolean })?.ghost === true) return fallback;
    const morph = terminalMorphRef.current.get(nodeId);
    const rawSurface = morph
      ? (
        effectiveRevealThreshold < morph.step
          ? (morph.hideBefore ? '' : (morph.preText || fallback))
          : (morph.postText || fallback)
      )
      : fallback;
    const inheritedTraceIndex = resolveTraceIndexFromNodeContext(
      d,
      derivationTraceIndexByNodeId
    );
    const rawTraceAlias = extractMovementIndex(rawSurface);
    const aliasedTraceIndex = rawTraceAlias
      ? derivationRawTraceAliasByIndex.get(String(rawTraceAlias).trim().toLowerCase())
      : undefined;
    const formatted = formatAuthoredWitnessSurface(
      rawSurface,
      inheritedTraceIndex,
      aliasedTraceIndex
    );
    return (isTraceLike(formatted) || isNullLike(formatted))
      ? formatted
      : formatIndexedSurfaceForDisplayValue(
        maybeCapitalizeSurfacedSentenceInitialLeaf(d, formatted),
        resolveTraceIndexFromNodeContext(d, derivationOperatorVariableIndexByNodeId)
      );
  }

  function isRenderedReplaySilentTerminalLeaf(d: HierNode): boolean {
    const rendered = getReplayRenderedTerminalText(d);
    return isReplaySilentTerminalLeaf(d) || isTraceLike(rendered) || isNullLike(rendered);
  }

  const appendTerminalText = (
    selection: d3.Selection<SVGGElement, HierNode, SVGGElement, unknown>,
    fill: string
  ) => selection.append('text')
    .attr('class', 'terminal-label')
    .attr('data-node-id', (d) => getNodeId(d))
    .attr('data-default-label', (d) => maybeCapitalizeSurfacedSentenceInitialLeaf(d, getReplayTerminalSurface(d)))
    .attr('data-trace-index', (d) => {
      const movedFromCopyTraceIndex = getMovementCopyTraceIndex(d);
      if (movedFromCopyTraceIndex) return movedFromCopyTraceIndex;
      const fallback = getReplayTerminalSurface(d);
      const inheritedTraceIndex = resolveTraceIndexFromNodeContext(
        d,
        derivationTraceIndexByNodeId
      );
      const rawTraceAlias = extractMovementIndex(fallback);
      const aliasedTraceIndex = rawTraceAlias
        ? derivationRawTraceAliasByIndex.get(String(rawTraceAlias).trim().toLowerCase())
        : undefined;
      if (!isTraceLike(fallback) && !(isNullLike(fallback) && (inheritedTraceIndex || aliasedTraceIndex))) {
        return '';
      }
      return normalizeTraceIndexForDisplay(
        inheritedTraceIndex || aliasedTraceIndex || extractMovementIndex(fallback)
      );
    })
    .attr('y', TERMINAL_LABEL.baselineY)
    .attr('text-anchor', 'middle')
    .attr('font-size', `${TERMINAL_LABEL.fontSize}px`)
    .attr('font-weight', String(TERMINAL_LABEL.fontWeight))
    .attr('fill', fill)
    .attr('style', `fill: ${fill} !important; font-family: 'Quicksand', sans-serif; font-style: italic; paint-order: stroke; stroke: #020806; stroke-width: ${TERMINAL_LABEL.strokeWidth}px;`)
    .style('fill', fill, 'important')
    .text(d => getReplayRenderedTerminalText(d))
    // The deferred theta painter resets the label to this step's staged text.
    .attr('data-staged-label', function () { return this.textContent || ''; });

  // Pronounced leaves stay emerald; silent leaves stay muted.
  appendTerminalText(overtTerminals, TARGET_EMERALD);
  appendTerminalText(silentTerminals, SILENT_SAGE);
  g.selectAll<SVGTextElement, HierNode>('.terminal-label')
    .filter((candidate) => (
      !isRenderedReplaySilentTerminalLeaf(candidate)
      && Boolean(resolveTraceIndexFromNodeContext(
        candidate,
        derivationOperatorVariableIndexByNodeId
      ))
    ))
    .classed('babel-renderer-authored-terminal', true)
    .attr('fill', TARGET_EMERALD)
    .style('fill', TARGET_EMERALD, 'important');
  g.selectAll<SVGTextElement, HierNode>('.terminal-label')
    .filter((candidate) => {
      const nodeId = getNodeId(candidate);
      if (getMovementCopyTraceIndex(candidate) && isRenderedReplaySilentTerminalLeaf(candidate)) return true;
      return isTraceLike(getReplayRenderedTerminalText(candidate))
        && !operatorVariableWitnessNodeIds.has(nodeId);
    })
    .classed('babel-moved-from-copy', true);

  // Vertical dashed connection for leaf nodes
  terminals.append('line')
    .attr('x1', 0).attr('y1', TERMINAL_STEM.topY).attr('x2', 0).attr('y2', TERMINAL_STEM.bottomY)
    .attr('stroke', BRANCH_COLOR).attr('stroke-width', TERMINAL_STEM.strokeWidth).attr('stroke-dasharray', '8,8').attr('opacity', 0.6);

  // 5. ABSTRACTION MODE (Triangles)
  // Triangulation sets both fields on every triangulated node.
  const triangles = nodeGroups.filter((d: TriangulatedNode) => d.isTriangulated!);
  triangles.selectAll('text').remove();
  triangles.append('path')
    .attr('d', d => {
      const wordString = (d as TriangulatedNode).triangulatedWords!;
      const textWidth = wordString.length * 20;
      const half = Math.max(70, textWidth / 2 + 30);
      return `M 0,25 L ${-half},110 L ${half},110 Z`;
    })
    .attr('fill', 'rgba(16, 185, 129, 0.2)')
    .attr('stroke', PURE_WHITE)
    .attr('stroke-width', 3);

  triangles.append('text')
    .attr('y', 8)
    .attr('text-anchor', 'middle')
    .attr('font-size', '38px')
    .attr('font-weight', '900')
    .attr('fill', PURE_WHITE)
    .style('fill', PURE_WHITE, 'important')
    .style('font-family', 'Quicksand, sans-serif')
    .style('paint-order', 'stroke')
    .style('stroke', '#020806')
    .style('stroke-width', '9px')
    .text((d) => d.data.label || '');

  triangles.append('text')
    .attr('y', 155)
    .attr('text-anchor', 'middle')
    .attr('font-size', '52px') // Reduced for consistency
    .attr('font-weight', '900')
    .attr('fill', TARGET_EMERALD)
    .attr('style', `fill: ${TARGET_EMERALD} !important; font-family: 'Quicksand', sans-serif; font-style: italic; paint-order: stroke; stroke: #020806; stroke-width: 8px;`)
    .text((d: TriangulatedNode) => d.triangulatedWords!);

  return {
    visibleNodes,
    getRevealStepForNodeId,
    effectiveRevealThreshold,
    getReplayRenderedTerminalText,
    getReplayRenderedCategoryLines,
    measureGraphicsElementsInTreeSpace: createTreeGraphicsMeasure(g),
    TARGET_EMERALD
  };
}
