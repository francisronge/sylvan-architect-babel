import { categoryLabel } from './categoryLabel.ts';
/** Preserve sentence-initial casing according to the visible syntactic context. */
import { caseSurfaceInitial, resolveSavedInputTokens } from '../server/babelParser/surfaceTokens.js';
import { type SyntaxNode } from '../types.ts';
import { replayOwnerId } from './displayIdentity.ts';
import { isResolvedMovementLink } from './movementLinks.ts';
import { buildStructuralReplayFallback } from './playbackFormatting.ts';
import {
  cloneSyntaxTree,
  collectOvertLeafNodeIdsInOrder,
  getReplayVisibleNodeIdSet,
  isLexicalLeaf,
  normalizeToken,
  replayEffectiveSilence
} from './syntaxForest.ts';
import { type PlaybackStep } from './types.ts';

const SENTENCE_INITIAL_CASE_ADJUSTABLE_PARENT_LABELS = new Set([
  'A', 'ADV', 'AUX', 'C', 'COORD', 'D', 'DEG', 'DET', 'INFL', 'MOD', 'NEG', 'P', 'Q', 'T', 'V'
]);

const isSentenceInitialCaseAdjustableParent = (label?: string): boolean => SENTENCE_INITIAL_CASE_ADJUSTABLE_PARENT_LABELS.has(categoryLabel(String(label || '')).toUpperCase());

// Structure cannot tell a pronoun from a name under a bare D, so only these
// closed-class English forms may lose sentence casing there. Names keep their
// authored form, and so does I, which is capitalised everywhere.
const BARE_D_SENTENCE_CASED_FORMS = new Set([
  'there', 'it', 'he', 'she', 'we', 'they', 'you', 'me', 'him', 'her', 'us', 'them',
  'this', 'that', 'these', 'those', 'who', 'whom', 'whose', 'what', 'which',
  'someone', 'somebody', 'something', 'everyone', 'everybody', 'everything',
  'anyone', 'anybody', 'anything', 'no one', 'nobody', 'nothing', 'each', 'both', 'all', 'none'
]);

// Atomic D also represents names and pronouns; a nominal complement supplies
// the structural evidence for determiner-specific sentence casing.
export const hasDeterminerNominalComplement = (head: SyntaxNode | null | undefined, projection: SyntaxNode | null | undefined): boolean => categoryLabel(head?.label).toUpperCase() === 'D'
  && ['D', 'DP'].includes(categoryLabel(projection?.label).toUpperCase())
  && Boolean(projection?.children?.some((child) => child !== head
    && ['N', 'NP'].includes(categoryLabel(child.label).toUpperCase())));

/** Read lexical category context from the authored occurrence, not its unfinished projection. */
export const authoredDeterminerHasNominalComplement = (forest: readonly SyntaxNode[], node: SyntaxNode): boolean | undefined => {
  const origin = node.replayOrigin;
  const id = origin?.kind === 'lexical' ? origin.authoredId : origin?.kind === 'word' ? origin.ownerId : node.id;
  let result: boolean | undefined;
  const visit = (candidate: SyntaxNode, parent?: SyntaxNode) => {
    if (candidate.id === id)
      result = hasDeterminerNominalComplement(candidate, parent);
    candidate.children?.forEach(child => visit(child, candidate));
  };
  forest.forEach(root => visit(root));
  return result;
};

/** Optional context for frames that show only built syntax: whether a step shows separate
 * workspaces (by default, whether its canvas has several roots), and the authored parent and
 * grandparent of a word whose parent is not in the canvas yet. */
export interface ReplayCasingContext {
  detached: (step: PlaybackStep) => boolean;
  authoredParents: (step: PlaybackStep, leaf: SyntaxNode) => { parent: SyntaxNode | null; grandparent: SyntaxNode | null } | undefined;
  /** A word's position in its stage's authored order, which decides which shown word comes first. */
  authoredOrder: (step: PlaybackStep, leaf: SyntaxNode) => number;
}

/**
 * The casing context of frames that show only built syntax (the construction kernel's). Main
 * reads these decisions from a canvas holding the stage's whole layout topology (before the
 * stage's movement, its pre-movement forest; its future layout scaffold when one exists).
 * `topologyOf(step)` is that forest for a step.
 */
export const stageCasingContext = (topologyOf: (step: PlaybackStep) => readonly SyntaxNode[]): ReplayCasingContext => {
  const indexes = new WeakMap<readonly SyntaxNode[], Map<string, { node: SyntaxNode; parent: SyntaxNode | null; order: number }>>();
  const indexOf = (step: PlaybackStep) => {
    const forest = topologyOf(step);
    if (!indexes.has(forest)) {
      const index = new Map<string, { node: SyntaxNode; parent: SyntaxNode | null; order: number }>();
      const visit = (node: SyntaxNode, parent: SyntaxNode | null) => {
        const id = String(node.replayOrigin?.authoredId ?? node.id);
        if (!index.has(id)) index.set(id, { node, parent, order: index.size });
        node.children?.forEach(child => visit(child, node));
      };
      forest.forEach(root => visit(root, null));
      indexes.set(forest, index);
    }
    return indexes.get(forest)!;
  };
  const authoredId = (leaf: SyntaxNode) => String(leaf.replayOrigin?.kind === 'lexical' ? leaf.replayOrigin.authoredId
    : leaf.replayOrigin?.kind === 'word' ? leaf.replayOrigin.ownerId : leaf.id);
  return {
    detached: step => topologyOf(step).length > 1,
    authoredParents: (step, leaf) => {
      const kind = leaf.replayOrigin?.kind;
      const owner = kind === 'lexical' || kind === 'word' ? indexOf(step).get(String(leaf.replayOrigin!.ownerId)) : undefined;
      return owner ? { parent: owner.node, grandparent: owner.parent } : undefined;
    },
    authoredOrder: (step, leaf) => indexOf(step).get(authoredId(leaf))?.order ?? Number.MAX_SAFE_INTEGER
  };
};

export const normalizeReplaySentenceInitialCasing = (steps: PlaybackStep[], sentenceInitialSurface: string,
  context?: ReplayCasingContext): PlaybackStep[] => {
  const initialKey = normalizeToken(sentenceInitialSurface);
  if (!initialKey)
    return steps;
  const uppercaseInitial = caseSurfaceInitial(sentenceInitialSurface, 'upper');
  const lowercaseInitial = caseSurfaceInitial(sentenceInitialSurface, 'lower');
  if (uppercaseInitial === lowercaseInitial)
    return steps;
  return steps.map((step) => {
    if (!step.replayCanvasData)
      return step;
    const clonedCanvas = cloneSyntaxTree(step.replayCanvasData);
    if (!clonedCanvas)
      return step;
    // Separate workspaces keep the authored form of their first word, but a
    // word preceded by visible pronounced material is never sentence-initial.
    const detachedForest = context ? context.detached(step) : clonedCanvas.replayOrigin?.kind === 'workspace';
    let changed = false;
    // Keep first-preorder lookup semantics, including aliases, while collecting
    // parent and inherited flags once instead of searching a path for every leaf.
    const exactNodes = new Map<string, {
      parent: SyntaxNode | null;
      silent: boolean;
      layout: boolean;
    }>();
    const nodesByName = new Map<string, SyntaxNode>();
    const leafIds: string[] = [];
    const visibleNodeIds = Array.isArray(step.replayVisibleNodeIds)
      ? getReplayVisibleNodeIdSet(step)
      : null;
    const visit = (node: SyntaxNode, parent: SyntaxNode | null, silent: boolean, layout: boolean) => {
      silent = replayEffectiveSilence(node, silent);
      // Invisible scaffolding may contain current visible syntax grafted beneath it.
      layout = (!visibleNodeIds && layout)
        || node.replayOrigin?.kind === 'layout' || Boolean((node as any).replayLayoutOnly);
      const id = String(node.id || '');
      if (!exactNodes.has(id))
        exactNodes.set(id, { parent, silent, layout });
      for (const name of [id, ...(Array.isArray(node.aliasIds) ? node.aliasIds : [])]) {
        const key = String(name || '');
        if (!nodesByName.has(key))
          nodesByName.set(key, node);
      }
      const children = Array.isArray(node.children) ? node.children : [];
      if (!children.length && id && isLexicalLeaf(node))
        leafIds.push(id);
      children.forEach(child => visit(child, node, silent, layout));
    };
    visit(clonedCanvas, null, false, false);
    const currentLeaves = leafIds.map(leafId => {
      const info = exactNodes.get(leafId)!;
      const leaf = nodesByName.get(leafId);
      const visible = !visibleNodeIds || visibleNodeIds.has(leafId)
        || leaf?.aliasIds?.some(id => visibleNodeIds.has(String(id)));
      return !info.layout && visible && leaf ? { leaf, silent: info.silent } : null;
    })
      .filter((entry): entry is {
        leaf: SyntaxNode;
        silent: boolean;
      } => Boolean(entry));
    if (context) currentLeaves.sort((left, right) => context.authoredOrder(step, left.leaf) - context.authoredOrder(step, right.leaf));
    const firstPronouncedLeafId = String(currentLeaves.find((entry) => !entry.silent)?.leaf.id || '');
    const casingByLeafId = new Map<string, string>();
    currentLeaves.forEach(({ leaf }) => {
      const surface = String(leaf.word || leaf.label || '').trim();
      if (normalizeToken(surface) !== initialKey)
        return;
      const leafId = String(leaf.id || '');
      // A kernel frame may not show a word's parent or grandparent yet; the context gives the authored ones.
      const shown = (node: SyntaxNode | null | undefined) => node && node.replayOrigin?.kind !== 'workspace' ? node : null;
      const canvasParent = exactNodes.get(leafId)?.parent;
      const authored = context ? context.authoredParents(step, leaf) : undefined;
      const parent = context ? shown(canvasParent) ?? authored?.parent ?? null : canvasParent;
      const grandparent = context ? shown(exactNodes.get(String(parent?.id || ''))?.parent) ?? authored?.grandparent ?? null
        : exactNodes.get(String(parent?.id || ''))?.parent;
      if (!isSentenceInitialCaseAdjustableParent(parent?.label || leaf.label))
        return;
      const authoredSurface = leaf.replayOrigin?.kind === 'word'
        ? String(nodesByName.get(String(leaf.replayOrigin.ownerId || ''))?.word || '').trim()
        : '';
      // Selecting a source before its governor must not recase an authored lowercase form.
      const authoredLowercaseSource = authoredSurface === lowercaseInitial;
      const surfacedLanding = authoredLowercaseSource && (step.replayRelationLinks || []).some(link => {
        if (!isResolvedMovementLink(link))
          return false;
        const landing = nodesByName.get(String(link.targetNodeId || ''));
        return landing && collectOvertLeafNodeIdsInOrder(landing).includes(leafId);
      });
      const nextSurface = leafId && leafId === firstPronouncedLeafId
        ? (detachedForest ? surface : authoredLowercaseSource && !surfacedLanding ? authoredSurface : uppercaseInitial)
        : maybeLowercaseSentenceInitialFunctionSurface({
          surface,
          sentenceInitialSurface,
          parentLabel: parent?.label || leaf.label,
          hasNominalComplement: hasDeterminerNominalComplement(parent, grandparent)
        });
      casingByLeafId.set(leafId, nextSurface);
      if (leaf.word && leaf.word !== nextSurface) {
        leaf.word = nextSurface;
        changed = true;
      }
      if (leaf.label && leaf.label !== nextSurface) {
        leaf.label = nextSurface;
        changed = true;
      }
    });
    const casingForNodeId = (nodeId?: string): string => {
      const normalizedNodeId = String(nodeId || '');
      if (!normalizedNodeId)
        return '';
      const exact = casingByLeafId.get(normalizedNodeId);
      if (exact)
        return exact;
      const node = nodesByName.get(replayOwnerId(clonedCanvas, normalizedNodeId));
      if (!node)
        return '';
      const matchingLeafId = collectOvertLeafNodeIdsInOrder(node).find((leafId) => casingByLeafId.has(leafId));
      return matchingLeafId ? String(casingByLeafId.get(matchingLeafId) || '') : '';
    };
    const rawTargetLabel = String(step.targetLabel || '').trim();
    const targetCase = normalizeToken(rawTargetLabel) === initialKey
      ? casingForNodeId(step.targetNodeId)
      : '';
    const nextTargetLabel = targetCase || step.targetLabel;
    const nextSourceLabels = Array.isArray(step.sourceLabels)
      ? step.sourceLabels.map((label, index) => {
        if (normalizeToken(String(label || '').trim()) !== initialKey)
          return label;
        return casingForNodeId(step.sourceNodeIds?.[index])
          || (index === 0 ? targetCase : '')
          || label;
      })
      : step.sourceLabels;
    const labelsChanged = nextTargetLabel !== step.targetLabel
      || JSON.stringify(nextSourceLabels || []) !== JSON.stringify(step.sourceLabels || []);
    const nextRecipe = labelsChanged
      ? buildStructuralReplayFallback(step.operation, nextTargetLabel, nextSourceLabels || [])
      : step.recipe;
    return changed || labelsChanged
      ? {
        ...step,
        targetLabel: nextTargetLabel,
        sourceLabels: nextSourceLabels,
        replayCanvasData: changed ? clonedCanvas : step.replayCanvasData,
        recipe: nextRecipe
      }
      : step;
  });
};

export const maybeLowercaseSentenceInitialFunctionSurface = ({
  surface,
  sentenceInitialSurface,
  nodeId,
  parentLabel,
  visibleOvertLeafIds,
  isWorkspaceForest = false,
  hasNominalComplement = false
}: {
  surface: string;
  sentenceInitialSurface?: string;
  nodeId?: string;
  parentLabel?: string;
  visibleOvertLeafIds?: string[];
  isWorkspaceForest?: boolean;
  hasNominalComplement?: boolean;
}): string => {
  const trimmed = String(surface || '').trim();
  if (!trimmed)
    return '';
  const normalizedNodeId = String(nodeId || '');
  const normalizedParentLabel = categoryLabel(parentLabel).toUpperCase();
  const normalizedSentenceInitialSurface = String(sentenceInitialSurface || '').trim();
  if (isWorkspaceForest)
    return trimmed;
  if (!isSentenceInitialCaseAdjustableParent(normalizedParentLabel))
    return trimmed;
  if (!normalizedSentenceInitialSurface
    || normalizeToken(trimmed) !== normalizeToken(normalizedSentenceInitialSurface)
    || !/^\p{Lu}\p{Ll}/u.test(normalizedSentenceInitialSurface)) {
    return trimmed;
  }
  // A bare D can also be a pronoun or proper name. A nominal complement,
  // explicit wh feature or closed-class form supplies lexical evidence; token
  // position alone does not.
  const hasWhFeature = /\[[^\]]*\bwh\b[^\]]*\]/iu.test(String(parentLabel || ''));
  if (normalizedParentLabel === 'D' && !hasNominalComplement && !hasWhFeature
    && !BARE_D_SENTENCE_CASED_FORMS.has(normalizeToken(trimmed)))
    return trimmed;
  const visibleIds = Array.isArray(visibleOvertLeafIds) ? visibleOvertLeafIds.map((id) => String(id || '')).filter(Boolean) : [];
  const firstVisibleOvertLeafId = visibleIds[0] || '';
  const isSentenceInitialInVisibleReplay = normalizedNodeId && normalizedNodeId === firstVisibleOvertLeafId;
  if (isSentenceInitialInVisibleReplay)
    return trimmed;
  return caseSurfaceInitial(trimmed, 'lower');
};

export const applyPreFrontingSentenceInitialCasing = (
  steps: PlaybackStep[],
  sentence: string,
  inputTokens?: string[],
  context?: ReplayCasingContext
): PlaybackStep[] => {
  const firstSentenceToken = String(resolveSavedInputTokens(sentence, inputTokens)[0] || '').trim();
  return firstSentenceToken
    ? normalizeReplaySentenceInitialCasing(steps, firstSentenceToken, context)
    : steps;
};
