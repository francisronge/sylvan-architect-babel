import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { isReplayDisplayChild } from './displayIdentity.ts';
import { categoryTextLayout, type CategoryTextMeasure } from './categoryTextLayout.ts';
import type { PreparedReplay } from './prepareReplay.ts';
import {
  applyVizIds, getNodeId, indexHierarchyNodesByIdAndAliases, resolveLeafSurface, isDisplayTerminalSurface,
  isSyntheticWorkspaceRootNode, isWordlessCategoryLeaf, shouldExpandPreterminalLeaf,
  isTraceLike, isNullLike, extractMovementIndex, extractDisplayedSubscriptIndex, normalizeTraceIndexForDisplay,
  resolveTraceIndexFromNodeContext, resolveLexicalMovementTraceDisplayIndex,
  formatIndexedSurfaceForDisplayValue, formatAuthoredWitnessSurface,
  buildResolvedLinkTraceIndexMap, buildResolvedLinkOperatorVariableIndexMap, buildResolvedLinkRawTraceAliasMap,
  type HierNode
} from './replayCompiler.ts';
import { resolveUniqueDisplayTerminal } from './relations/geometryBinding.ts';
import { visiblePlanFrameItems, planItemDependencyNodeIds, resolveDisplayedTrajectoryAttachments } from './relations/renderPlanCompiler.ts';

export type TreeLabelIndex = { text: string; mode: 'identity' | 'theta' };
export type TreeLabelRuns = {
  kind: 'category' | 'terminal';
  text: string;
  indices: readonly TreeLabelIndex[];
  /** Original category tspans; theta's existing reset replaces these with text. */
  lines?: readonly string[];
};
export const treeLabelRunKey = (run: TreeLabelRuns): string => JSON.stringify([
  run.kind, run.text, run.lines ?? null, run.indices.map(index => [index.text, index.mode])
]);
export function treeLabelIndexAttributes(kind: TreeLabelRuns['kind'], mode: TreeLabelIndex['mode']) {
  return { dx: '5', 'font-size': kind === 'terminal' ? '30px' : '22px',
    'font-family': 'Crimson Pro, Georgia, serif', 'font-style': 'italic',
    ...(mode === 'identity' ? {'baseline-shift': 'sub'} : {dy: kind === 'terminal' ? '14' : '9'}) };
}
export type TreeLabelBounds = { x: number; y: number; width: number; height: number };
export type TreeLabelMeasure = (runs: TreeLabelRuns) => TreeLabelBounds | undefined;
export type PreparedTreeLabelRuns = ReadonlyMap<SyntaxNode, ReadonlyMap<string, readonly TreeLabelRuns[]>>;
export type StagedTerminalContext = {
  traceIndices: Map<string, string>;
  operatorIndices: Map<string, string>;
  rawTraceAliases: Map<string, string>;
};

/** Staged Replay already owns surface and casing. This only applies the same
 * additive index/trace notation used by both painter text paths. */
export function stagedTerminalText(node: HierNode, context: StagedTerminalContext): string {
  const surface = resolveLeafSurface(node).trim();
  const inherited = resolveTraceIndexFromNodeContext(node, context.traceIndices);
  const movement = resolveLexicalMovementTraceDisplayIndex(node, surface, inherited);
  if (movement) return formatIndexedSurfaceForDisplayValue(surface, movement);
  if ((node.data as SyntaxNode & { ghost?: boolean }).ghost === true) return surface;
  const rawAlias = extractMovementIndex(surface);
  const alias = rawAlias ? context.rawTraceAliases.get(rawAlias.trim().toLowerCase()) : undefined;
  const formatted = formatAuthoredWitnessSurface(surface, inherited, alias);
  return isTraceLike(formatted) || isNullLike(formatted) ? formatted
    : formatIndexedSurfaceForDisplayValue(formatted, resolveTraceIndexFromNodeContext(node, context.operatorIndices));
}

export const identityIndexAction = (contents: string, existingIndices: readonly string[], index: string) =>
  existingIndices.includes(index) ? 'existing' : extractDisplayedSubscriptIndex(contents) === index ? 'inline' : 'append';
export const thetaLabelBase = (identityBase: string | undefined, defaultText: string | undefined, contents: string) =>
  identityBase || defaultText || contents;

export type TreeLabelState = TreeLabelRuns & { defaultText?: string; identityBaseText?: string };
const textContent = (label: TreeLabelRuns) => label.text + label.indices.map(run => run.text).join('');

/** Identity indices run before deferred theta drawing. Preserve the painter's
 * inline-index reuse and its saved base label exactly. */
export function identityLabelState(label: TreeLabelState, index: string): TreeLabelState {
  const identityBaseText = label.identityBaseText || textContent(label);
  const action = identityIndexAction(textContent(label), label.indices.filter(run => run.mode === 'identity').map(run => run.text), index);
  return { ...label, identityBaseText, indices: action !== 'append' ? label.indices
    : [...label.indices, { text: index, mode: 'identity' }]};
}

/** Theta retains identity runs, resets its base as the painter does, and reuses
 * an equal identity index rather than appending a second copy. */
export function thetaLabelState(label: TreeLabelState, index: string): TreeLabelState {
  const text = thetaLabelBase(label.identityBaseText, label.defaultText, textContent(label));
  const identities = label.indices.filter(run => run.mode === 'identity');
  return { ...label, text, lines: undefined,
    indices: identities.some(run => run.text === index) ? identities : [...identities,{ text: index, mode: 'theta' }]};
}

export function identityLabelTarget(anchor: HierNode | undefined, anchorId?: string): {node: HierNode;labelId:string;kind:'category'|'terminal';ambiguityCount?:number} | undefined {
  if (!anchor) return;
  const resolution = resolveUniqueDisplayTerminal(anchor, node => node.children || [],
    node => !node.children?.length && isDisplayTerminalSurface(resolveLeafSurface(node)));
  const terminal = resolution.terminal;
  return {node:terminal || anchor,labelId:terminal ? getNodeId(terminal) : anchorId || getNodeId(anchor),
    kind:terminal?'terminal':'category',ambiguityCount:resolution.reason === 'ambiguous' ? resolution.count : undefined};
}

export function thetaLabelTarget(anchor: HierNode | undefined, anchorId?: string): {node: HierNode;labelId:string;kind:'category'|'terminal'} | undefined {
  const leaves = anchor?.leaves();
  if (!anchor || !leaves?.length) return;
  return leaves.every(leaf => isTraceLike(resolveLeafSurface(leaf).trim()))
    ? {node:anchor,labelId:anchorId || getNodeId(anchor),kind:'category'}
    : {node:leaves.at(-1)!,labelId:getNodeId(leaves.at(-1)!),kind:'terminal'};
}

/** Derive display-only runs from existing Replay and relation plans. Authored
 * syntax and relation classification remain owned by their existing compilers. */
export function treeLabelRunsForStep(
  prepared: PreparedReplay, stepIndex: number, measureCategoryText?: CategoryTextMeasure,
  options: { includeRelationIndices?: boolean } = {}
): Map<string, TreeLabelRuns[]> {
  const step = prepared.playbackSteps[stepIndex], canvas = step?.replayCanvasData;
  const result = new Map<string, TreeLabelRuns[]>();
  const stage = step?.replayFrameIndex, frame = stage === undefined ? undefined : prepared.replayDerivationFrames[stage];
  if (!canvas || stage === undefined || !frame) return result;
  const root = d3.hierarchy(canvas);
  applyVizIds(root);
  const all = root.descendants(), visible = new Set(step.replayVisibleNodeIds ?? all.map(getNodeId));
  const nodes = all.filter(node => visible.has(getNodeId(node)) && !isSyntheticWorkspaceRootNode(node));
  const visibleAliases = indexHierarchyNodesByIdAndAliases(nodes as d3.HierarchyPointNode<SyntaxNode>[]);
  const allAliases = indexHierarchyNodesByIdAndAliases(all as d3.HierarchyPointNode<SyntaxNode>[]);
  const resolve = (id: string): HierNode | undefined => visibleAliases.get(id) || (() => {
    const anchor = allAliases.get(id);
    return anchor?.descendants().some(node => visible.has(getNodeId(node))) ? anchor : undefined;
  })();
  const links = step.replayRelationLinks || [];
  const context: StagedTerminalContext = {
    traceIndices: buildResolvedLinkTraceIndexMap(frame.workspaceForest || [], links, stage, prepared.movementChainIndexCatalogue),
    operatorIndices: buildResolvedLinkOperatorVariableIndexMap(frame.workspaceForest || [], links, stage),
    rawTraceAliases: buildResolvedLinkRawTraceAliasMap(frame.workspaceForest || [], links, stage)
  };
  const labels = new Map<string, TreeLabelState>();
  const key = (id: string, kind: string) => JSON.stringify([id, kind]);
  for (const node of nodes) {
    const id = getNodeId(node);
    if (node.children?.length || shouldExpandPreterminalLeaf(node.data) || isWordlessCategoryLeaf(node.data)) {
      const lines = categoryTextLayout(node.data.label, measureCategoryText).lines;
      labels.set(key(id, 'category'), {kind: 'category', text: lines.join(''), lines, indices: []});
    }
    if (!node.children?.length && !isWordlessCategoryLeaf(node.data)) {
      labels.set(key(id, 'terminal'), {kind: 'terminal', text: stagedTerminalText(node, context),
        defaultText: resolveLeafSurface(node).trim(), indices: []});
    }
  }
  const played = new Set<number>();
  for (let i = 0; i <= stepIndex; i++) {
    const prior = prepared.playbackSteps[i], identity = prior.replayRelationIdentity;
    if (prior.replayKind === 'relation' && identity?.stageIndex === stage) played.add(identity.relationIndex);
  }
  const activeRelation = step.replayKind === 'relation' ? step.replayRelationIdentity?.relationIndex ?? null : null;
  const items = options.includeRelationIndices !== false && prepared.relationRenderPlan ? visiblePlanFrameItems(prepared.relationRenderPlan, stage, played,
    activeRelation).map(item => resolveDisplayedTrajectoryAttachments(item, id => visibleAliases.get(id)?.data,
      { stageIndex: stage, playedRelationIndices: played }))
    .filter(item => planItemDependencyNodeIds(item).every(id => resolve(id))) : [];
  // The binder tests reuse against the base labels, before any synchronous
  // relation painter mutates their text or appends identity indices.
  const baseLabels = new Map(labels);
  const belongs = (node: HierNode, id: string) => getNodeId(node) === id
    || node.data.aliasIds?.includes(id) || isReplayDisplayChild(node.data, id);
  const reusesGapNotation = (id: string, text: string) => Boolean(text && nodes.some(node => {
    if (!belongs(node, id)) return false;
    return (['category', 'terminal'] as const).some(kind => {
      const label = baseLabels.get(key(getNodeId(node), kind));
      if (!label) return false;
      if (textContent(label) === text) return true;
      if (label.defaultText !== text) return false;
      const inherited = resolveTraceIndexFromNodeContext(node, context.traceIndices);
      const raw = extractMovementIndex(text);
      const alias = raw ? context.rawTraceAliases.get(raw.trim().toLowerCase()) : undefined;
      const index = resolveLexicalMovementTraceDisplayIndex(node, text, inherited)
        || ((isTraceLike(text) || isNullLike(text) && (inherited || alias))
          ? normalizeTraceIndexForDisplay(inherited || alias || raw) : '');
      return textContent(label) === (isTraceLike(text) ? formatAuthoredWitnessSurface(text, index)
        : formatIndexedSurfaceForDisplayValue(text, index));
    });
  }));
  for (const item of items) {
    if (item.kind === 'node-badges' && item.badgeStyle === 'gap-notation'
      && ['trajectory.across-the-board', 'trajectory.sideward'].includes(item.familyId || '')) {
      for (const badge of item.badges) {
        if (reusesGapNotation(badge.nodeId, badge.text)) continue;
        const descendants = new Set(resolve(badge.nodeId)?.descendants().map(getNodeId));
        for (const node of nodes) {
          if (!descendants.has(getNodeId(node))) continue;
          const idKey = key(getNodeId(node), 'terminal'), label = labels.get(idKey);
          // The existing painter resets the whole terminal text, removing its
          // tspans while retaining saved default/identity base attributes.
          if (label) labels.set(idKey, { ...label, text: badge.text, indices: [] });
        }
      }
    }
    if (item.kind === 'coindex' && item.familyId === 'identity.occurrences' && item.index) {
      for (const id of item.nodeIds) {
        const target = identityLabelTarget(resolve(id), id);
        if (!target) continue;
        const matches = nodes.filter(node => labels.has(key(getNodeId(node), target.kind)) && (
          getNodeId(node) === target.labelId || node.data.aliasIds?.includes(target.labelId) || isReplayDisplayChild(node.data, target.labelId)
        ));
        if (matches.length !== 1) continue;
        const idKey = key(getNodeId(matches[0]), target.kind), label = labels.get(idKey)!;
        labels.set(idKey, identityLabelState(label, item.index));
      }
    }
  }
  // Theta is painted on the next animation frame; reserve both displayed states.
  const beforeTheta = new Map(labels);
  const thetaDraws = new Set<string>();
  for (const item of items) if (item.kind === 'node-plaque' && item.plaqueStyle === 'theta-grid' && item.familyId === 'theta.grid') {
    const drawKey = JSON.stringify([item.relationRef.stageIndex, item.relationRef.relationIndex, item.tier2ClaimIdentity ?? null]);
    if (thetaDraws.has(drawKey)) continue;
    thetaDraws.add(drawKey);
    for (const role of item.thetaRoles || []) {
      const target = thetaLabelTarget(resolve(role.nodeId), role.nodeId);
      if (!target) continue;
      const idKey = key(target.labelId, target.kind), label = labels.get(idKey);
      if (label) labels.set(idKey, thetaLabelState(label, role.index || ''));
    }
  }
  for (const [idKey, label] of labels) {
    const [id] = JSON.parse(idKey), runs = result.get(id) || [];
    const {defaultText: _, identityBaseText: __, ...display}=label;
    runs.push(display);
    const prior = beforeTheta.get(idKey);
    if (prior) {
      const {defaultText: _priorDefault, identityBaseText: _priorBase, ...beforeDisplay} = prior;
      if (treeLabelRunKey(beforeDisplay) !== treeLabelRunKey(display)) runs.push(beforeDisplay);
    }
    result.set(id, runs);
  }
  return result;
}
