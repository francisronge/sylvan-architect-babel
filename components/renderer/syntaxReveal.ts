import * as d3 from 'd3';
import { getNodeId } from '../../replay/displayIdentity.ts';
import {
  buildResolvedLinkOperatorVariableIndexMap,
  buildResolvedLinkRawTraceAliasMap,
  resolveLexicalMovementTraceDisplayIndex,
  resolveTraceIndexFromNodeContext
} from '../../replay/movementIndices.ts';
import {
  extractMovementIndex,
  formatIndexedSurfaceForDisplayValue,
  formatTraceSurfaceForDisplayValue,
  isDisplayTraceLabel,
  isNullLike,
  isTraceLike,
  normalizeTraceIndexForDisplay
} from '../../replay/replaySurfaceNotation.ts';
import { collectPronouncedLeafNodeIdsInOrder, normalizeToken } from '../../replay/syntaxForest.ts';
import {
  stagedTerminalText
} from '../../replay/treeLabelRuns.ts';
import { type HierNode } from '../../replay/types.ts';
import { caseSurfaceInitial } from '../../server/babelParser/surfaceTokens.js';
import type { SyntaxNode } from '../../types.ts';
import type { SyntaxDrawingContext } from './syntaxDrawing.ts';

export const getReplayTokenIndex = (node: HierNode): number | undefined => {
  let current: HierNode | null = node;
  while (current) {
    const tokenIndex = Number(current.data?.tokenIndex);
    if (Number.isFinite(tokenIndex)) return tokenIndex;
    current = current.parent;
  }
  return undefined;
};

type SentenceInitialCasingContext = Pick<SyntaxDrawingContext,
  | 'animated'
  | 'usesDerivationFrames'
  | 'currentReplayStep'
  | 'firstSentenceReplayToken'
  | 'firstSentenceReplayDisplayToken'
  | 'activeDerivationArrowLinks'
  | 'pendingPhraseFrontingSourceNodeIds'
>;

/** Trims a leaf's word and capitalises it when the leaf is the first visible
 * pronounced leaf and either starts the sentence or was fronted there. Staged
 * Replay owns the displayed word and its casing at each moment. */
export const sentenceInitialLeafCapitalizer = ({
  animated,
  usesDerivationFrames,
  currentReplayStep,
  firstSentenceReplayToken,
  firstSentenceReplayDisplayToken,
  activeDerivationArrowLinks,
  pendingPhraseFrontingSourceNodeIds
}: SentenceInitialCasingContext, firstVisibleOvertLeafId: string) => (node: HierNode, value: string): string => {
  const trimmed = String(value || '').trim();
  if (usesDerivationFrames && animated && currentReplayStep?.replayCanvasData) return trimmed;
  if (!trimmed || isTraceLike(trimmed) || isNullLike(trimmed)) return trimmed;
  if (normalizeToken(trimmed) !== normalizeToken(firstSentenceReplayToken)) return trimmed;
  if (!firstVisibleOvertLeafId || getNodeId(node) !== firstVisibleOvertLeafId) return trimmed;
  const nodeAncestorIds = new Set<string>();
  let currentAncestor: HierNode | null = node;
  while (currentAncestor) {
    const ancestorId = getNodeId(currentAncestor);
    if (ancestorId) nodeAncestorIds.add(ancestorId);
    currentAncestor = currentAncestor.parent;
  }
  const surfacedByFrontingMovement = activeDerivationArrowLinks.some((link) => {
    const targetNodeId = String(link?.targetNodeId || '');
    return Boolean(targetNodeId) && nodeAncestorIds.has(targetNodeId);
  });
  const awaitsPhraseFronting = Array.from(nodeAncestorIds).some((nodeId) => (
    pendingPhraseFrontingSourceNodeIds.has(nodeId)
  ));
  if (getReplayTokenIndex(node) !== 0 && !surfacedByFrontingMovement) return trimmed;
  if (!surfacedByFrontingMovement && awaitsPhraseFronting) return trimmed;
  return firstSentenceReplayDisplayToken || caseSurfaceInitial(trimmed, 'upper');
};

interface SyntaxRevealContext extends Pick<SyntaxDrawingContext,

  | 'animated'
  | 'activeStepIndex'
  | 'usesDerivationFrames'
  | 'traceDisplayIndexByNodeId'
  | 'traceDisplayFrame'
  | 'traceDisplayRelationLinks'
  | 'traceDisplayFrameIndex'
  | 'replayVisibleNodeIdSet'
  | 'currentReplayStep'
  | 'firstSentenceReplayToken'
  | 'activeDerivationArrowLinks'
  | 'pendingPhraseFrontingSourceNodeIds'
  | 'firstSentenceReplayDisplayToken'
  | 'terminalMorphRef'
> {
  svgRef: { current: SVGSVGElement | null };
  canvasData: SyntaxNode;
}
export function updateSyntaxReveal({
  animated,
  activeStepIndex,
  usesDerivationFrames,
  svgRef,
  traceDisplayIndexByNodeId,
  traceDisplayFrame,
  traceDisplayRelationLinks,
  traceDisplayFrameIndex,
  canvasData,
  replayVisibleNodeIdSet,
  currentReplayStep,
  firstSentenceReplayToken,
  activeDerivationArrowLinks,
  pendingPhraseFrontingSourceNodeIds,
  firstSentenceReplayDisplayToken,
  terminalMorphRef
}: SyntaxRevealContext) {
  const revealThreshold = animated ? activeStepIndex : Number.MAX_SAFE_INTEGER;
  const effectiveRevealThreshold = usesDerivationFrames
    ? Number.MAX_SAFE_INTEGER
    : revealThreshold;
  const svg = d3.select(svgRef.current);
  const layoutDerivationTraceIndexByNodeId = traceDisplayIndexByNodeId;
  const layoutOperatorVariableIndexByNodeId = traceDisplayFrame
    ? buildResolvedLinkOperatorVariableIndexMap(
      traceDisplayFrame.workspaceForest || [],
      traceDisplayRelationLinks,
      traceDisplayFrameIndex
    )
    : new Map<string, string>();
  const layoutRawTraceAliasByIndex = traceDisplayFrame
    ? buildResolvedLinkRawTraceAliasMap(
      traceDisplayFrame.workspaceForest || [],
      traceDisplayRelationLinks,
      traceDisplayFrameIndex
    )
    : new Map<string, string>();
  const layoutVisibleOvertLeafIds = collectPronouncedLeafNodeIdsInOrder(canvasData)
    .filter((nodeId) => !replayVisibleNodeIdSet || replayVisibleNodeIdSet.has(nodeId));
  const layoutFirstVisibleOvertLeafId = String(layoutVisibleOvertLeafIds[0] || '');
  const maybeCapitalizeLayoutSentenceInitialLeaf = sentenceInitialLeafCapitalizer({
    animated,
    usesDerivationFrames,
    currentReplayStep,
    firstSentenceReplayToken,
    firstSentenceReplayDisplayToken,
    activeDerivationArrowLinks,
    pendingPhraseFrontingSourceNodeIds
  }, layoutFirstVisibleOvertLeafId);

  svg.selectAll<SVGPathElement, unknown>('.branch')
    .style('opacity', function () {
      const step = Number((this as SVGPathElement).getAttribute('data-step') || 0);
      return step <= effectiveRevealThreshold ? '0.6' : '0';
    });

  svg.selectAll<SVGGElement, unknown>('.node-group')
    .style('opacity', function () {
      const step = Number((this as SVGGElement).getAttribute('data-step') || 0);
      return step <= effectiveRevealThreshold ? '1' : '0';
    });

  svg.selectAll<SVGPathElement, unknown>('.movement-arrow')
    .style('opacity', function () {
      const step = Number((this as SVGPathElement).getAttribute('data-step') || 0);
      return step <= effectiveRevealThreshold ? '0.95' : '0';
    });

  svg.selectAll<SVGTextElement, HierNode>('.terminal-label')
    .text(function (d) {
      if (usesDerivationFrames && currentReplayStep?.replayCanvasData) return stagedTerminalText(d, {
        traceIndices: layoutDerivationTraceIndexByNodeId, operatorIndices: layoutOperatorVariableIndexByNodeId,
        rawTraceAliases: layoutRawTraceAliasByIndex
      });
      const element = this as SVGTextElement;
      const nodeId = element.getAttribute('data-node-id') || '';
      const fallback = element.getAttribute('data-default-label') || '';
      const storedTraceIndex = normalizeTraceIndexForDisplay(
        element.getAttribute('data-trace-index') || ''
      );
      const morph = terminalMorphRef.current.get(nodeId);
      const rawTraceAlias = extractMovementIndex(fallback);
      const aliasedTraceIndex = rawTraceAlias
        ? layoutRawTraceAliasByIndex.get(String(rawTraceAlias).trim().toLowerCase())
        : undefined;
      const directTraceIndex = layoutDerivationTraceIndexByNodeId.get(nodeId);
      const operatorVariableIndex = resolveTraceIndexFromNodeContext(
        d,
        layoutOperatorVariableIndexByNodeId
      );
      const carriedMovementTraceIndex = resolveTraceIndexFromNodeContext(
        d,
        layoutDerivationTraceIndexByNodeId
      );
      const lexicalMovementTraceIndex = resolveLexicalMovementTraceDisplayIndex(
        fallback,
        storedTraceIndex || carriedMovementTraceIndex
      );
      if (lexicalMovementTraceIndex) {
        /*
         * Each movement occurrence keeps its authored words and gains only
         * the chain-index subscript. Pronunciation remains independently
         * authored; an index never converts a copy into a trace.
         * Trace display is reserved for occupants the model authored as
         * traces.
         */
        return formatIndexedSurfaceForDisplayValue(fallback, lexicalMovementTraceIndex);
      }
      if (!morph) {
        return isTraceLike(fallback)
          ? formatTraceSurfaceForDisplayValue(
            fallback,
            directTraceIndex || storedTraceIndex || aliasedTraceIndex || extractMovementIndex(fallback)
          )
          : formatIndexedSurfaceForDisplayValue(
            maybeCapitalizeLayoutSentenceInitialLeaf(d, fallback),
            operatorVariableIndex
          );
      }
      if (effectiveRevealThreshold < morph.step) {
        return morph.hideBefore ? '' : maybeCapitalizeLayoutSentenceInitialLeaf(d, morph.preText);
      }
      if (!morph.postText && isTraceLike(fallback)) {
        return formatTraceSurfaceForDisplayValue(
          fallback,
          directTraceIndex || storedTraceIndex || aliasedTraceIndex || extractMovementIndex(fallback)
        );
      }
      if (morph.postText && isDisplayTraceLabel(morph.postText)) {
        return morph.postText;
      }
      if (morph.postText && isTraceLike(morph.postText)) {
        return formatTraceSurfaceForDisplayValue(
          morph.postText,
          directTraceIndex || storedTraceIndex || aliasedTraceIndex || extractMovementIndex(morph.postText)
        );
      }
      if (isTraceLike(fallback)) {
        return formatTraceSurfaceForDisplayValue(
          fallback,
          directTraceIndex || storedTraceIndex || aliasedTraceIndex || extractMovementIndex(fallback)
        );
      }
      return formatIndexedSurfaceForDisplayValue(
        maybeCapitalizeLayoutSentenceInitialLeaf(d, morph.postText || fallback),
        operatorVariableIndex
      );
    });

}
