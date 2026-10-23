/** Describe syntax occurrences and their positions for the Replay panel. */
import { authoredWord } from '../server/babelParser/nodePronunciation.js';
import { type SyntaxNode } from '../types.ts';
import { categoryLabel } from './categoryLabel.ts';
import { readBareProjections } from './projectionStructure.ts';
import { formatReplaySupportValue, normalizeReplayTargetLabel } from './replayPanelFormatting.ts';
import { findNodeByIdInForest, isNotationLeaf, replayEffectiveSilence } from './syntaxForest.ts';

export const findReplayNodePathById = (
  root: SyntaxNode | null | undefined,
  nodeId: string,
  trail: SyntaxNode[] = []
): SyntaxNode[] | null => {
  if (!root || !nodeId)
    return null;
  const currentTrail = [...trail, root];
  if (String(root.id || '') === nodeId)
    return currentTrail;
  const children = Array.isArray(root.children) ? root.children : [];
  for (const child of children) {
    const match = findReplayNodePathById(child, nodeId, currentTrail);
    if (match)
      return match;
  }
  return null;
};

/** `headLanding` marks the landing of a recovered head movement, which has
 * adjoined to its sister head rather than become its complement. */
export const describeReplayNodePosition = (root: SyntaxNode | null | undefined, nodeId?: string,
  { headLanding = false }: { headLanding?: boolean } = {}): string => {
  const normalizedNodeId = String(nodeId || '');
  if (!root || !normalizedNodeId)
    return '';
  const path = findReplayNodePathById(root, normalizedNodeId);
  if (!path || path.length === 0)
    return '';
  // Skip a unary display/preterminal wrapper with the same label, not an
  // independently branching syntax object. This avoids descriptions like T in T.
  let index = path.length - 1;
  while (index > 0 && path[index - 1].children?.length === 1
    && path[index - 1].label === path[index].label)
    index--;
  const node = path[index];
  const parent = path[index - 1];
  const nodeLabel = formatReplaySupportValue(node.label);
  if (!parent)
    return nodeLabel;
  const parentLabel = formatReplaySupportValue(parent.label);
  const children = parent.children ?? [];
  // Read explicit X-bar levels. Bare repeated XP labels do not distinguish
  // specifiers from adjuncts, and an arbitrary first child need not be either.
  const projection = (label: string) => {
    const plain = label.replace(/(?:\s*\[[^\[\]]*\])+$/u, '').trim();
    const primes = plain.match(/['′’]+$/u)?.[0].length ?? 0;
    const category = categoryLabel(plain);
    // A plain P is the preposition head, not a phrase of an empty category.
    return primes ? { head: category, level: primes }
      : category !== 'P' && category.endsWith('P') ? { head: category.slice(0, -1), level: 2 }
        : { head: category, level: 0 };
  };
  const sibling = children.length === 2 ? children.find(child => child !== node) : undefined;
  // Bare labels name the same positions from structure, with the authored label.
  const bare = readBareProjections([root]);
  if (bare) {
    if (sibling && bare.maximal(node) && bare.projects(sibling, parent)) {
      if (bare.maximal(parent) && !bare.minimal(sibling))
        return `Spec,${parentLabel}`;
      // A one-word head beside a head over its own lower copy may have
      // adjoined; structure cannot tell, so the position stays unnamed.
      if (!bare.maximal(parent) && !bare.minimal(parent) && bare.minimal(sibling)
        && !headLanding && !bare.mayHaveAdjoined(node))
        return `complement of ${categoryLabel(parentLabel)}`;
    }
    // A head names its own projection, as X-bar's T in T′ does.
    const distinct = parentLabel !== nodeLabel || bare.minimal(node) && !bare.minimal(parent);
    return parentLabel && distinct ? `${nodeLabel || 'node'} in ${parentLabel}` : nodeLabel;
  }
  const parentProjection = projection(parentLabel);
  const nodeProjection = projection(nodeLabel);
  const siblingProjection = sibling ? projection(sibling.label) : undefined;
  if (nodeProjection.level === 2 && siblingProjection?.head === parentProjection.head) {
    if (parentProjection.level === 2 && siblingProjection.level === 1)
      return `Spec,${parentLabel}`;
    if (parentProjection.level === 1 && siblingProjection.level === 0)
      return `complement of ${parentProjection.head}`;
  }
  return parentLabel && parentLabel !== nodeLabel ? `${nodeLabel || 'node'} in ${parentLabel}` : nodeLabel;
};

export const getReplayNodeDisplayFromCanvas = (root: SyntaxNode | null | undefined, nodeId?: string): string => {
  const normalizedNodeId = String(nodeId || '');
  if (!root || !normalizedNodeId)
    return '';
  const node = findNodeByIdInForest([root], normalizedNodeId);
  if (!node)
    return '';
  const label = formatReplaySupportValue(String(node.label || '').trim());
  if (isNotationLeaf(node))
    return label;
  const overtYield: string[] = [];
  const collectSurfaceLeaves = (candidate?: SyntaxNode | null, inherited = false) => {
    if (!candidate || typeof candidate !== 'object')
      return;
    const silent = replayEffectiveSilence(candidate, inherited);
    const children = Array.isArray(candidate.children) ? candidate.children : [];
    if (children.length === 0) {
      if (silent)
        return;
      if (isNotationLeaf(candidate))
        return;
      const fallbackLeafSurface = authoredWord(candidate);
      const surface = formatReplaySupportValue(fallbackLeafSurface);
      if (surface)
        overtYield.push(surface);
      return;
    }
    children.forEach((child) => collectSurfaceLeaves(child, silent));
  };
  collectSurfaceLeaves(node);
  const uniqueYield = Array.from(new Set(overtYield));
  if (uniqueYield.length === 1 && label && normalizeReplayTargetLabel(uniqueYield[0]) !== normalizeReplayTargetLabel(label)) {
    return `${uniqueYield[0]} (${label})`;
  }
  return uniqueYield[0] || label;
};

export const getReplayNodeOvertYieldFromCanvas = (root: SyntaxNode | null | undefined, nodeId?: string): string => {
  const normalizedNodeId = String(nodeId || '');
  if (!root || !normalizedNodeId)
    return '';
  const node = findNodeByIdInForest([root], normalizedNodeId);
  if (!node || isNotationLeaf(node))
    return '';
  const overtYield: string[] = [];
  const collectSurfaceLeaves = (candidate?: SyntaxNode | null, inherited = false) => {
    if (!candidate || typeof candidate !== 'object')
      return;
    const silent = replayEffectiveSilence(candidate, inherited);
    const children = Array.isArray(candidate.children) ? candidate.children : [];
    if (children.length === 0) {
      if (silent)
        return;
      if (isNotationLeaf(candidate))
        return;
      const fallbackLeafSurface = authoredWord(candidate);
      const surface = formatReplaySupportValue(fallbackLeafSurface);
      if (surface)
        overtYield.push(surface);
      return;
    }
    children.forEach((child) => collectSurfaceLeaves(child, silent));
  };
  collectSurfaceLeaves(node);
  return overtYield.join(' ').trim();
};

export const getReplayNodeAuthoredYieldFromCanvas = (root: SyntaxNode | null | undefined, nodeId?: string): string => {
  const normalizedNodeId = String(nodeId || '');
  if (!root || !normalizedNodeId)
    return '';
  const node = findNodeByIdInForest([root], normalizedNodeId);
  if (!node || isNotationLeaf(node))
    return '';
  const surfaces: string[] = [];
  const seenLineages = new Set<string>();
  const collectSurfaceLeaves = (candidate?: SyntaxNode | null) => {
    if (!candidate || typeof candidate !== 'object')
      return;
    const children = Array.isArray(candidate.children) ? candidate.children : [];
    if (children.length > 0) {
      children.forEach((child) => collectSurfaceLeaves(child));
      return;
    }
    if (isNotationLeaf(candidate))
      return;
    const lineageId = String(candidate.lineageId || '');
    if (lineageId && seenLineages.has(lineageId))
      return;
    const fallbackLeafSurface = authoredWord(candidate);
    const surface = formatReplaySupportValue(fallbackLeafSurface);
    if (!surface)
      return;
    if (lineageId)
      seenLineages.add(lineageId);
    surfaces.push(surface);
  };
  collectSurfaceLeaves(node);
  return surfaces.join(' ').trim();
};

export const getReplayNodeCategoryFromCanvas = (root: SyntaxNode | null | undefined, nodeId?: string): string => {
  const normalizedNodeId = String(nodeId || '');
  if (!root || !normalizedNodeId)
    return '';
  const node = findNodeByIdInForest([root], normalizedNodeId);
  if (!node)
    return '';
  return formatReplaySupportValue(String(node.label || '').trim());
};
