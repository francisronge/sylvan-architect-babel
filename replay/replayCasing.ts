import { categoryLabel } from './categoryLabel.ts';
/** Preserve sentence-initial casing according to the visible syntactic context. */
import { caseSurfaceInitial, resolveSavedInputTokens } from '../server/babelParser/surfaceTokens.js';
import { type SyntaxNode } from '../types.ts';
import { replayOwnerId } from './displayIdentity.ts';
import { readStructuralProjections } from './projectionStructure.ts';
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
  'anyone', 'anybody', 'anything', 'no one', 'nobody', 'nothing', 'each', 'both', 'all', 'none',
  'one', 'some', 'any', 'many', 'much', 'few', 'several', 'most', 'either', 'neither', 'another',
  'mine', 'yours', 'his', 'hers', 'ours', 'theirs'
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

type CasingLeaf = { leaf: SyntaxNode; silent: boolean };

/** One frame's lexical leaves as casing reads them: visible current words in
 * tree order, each with its parent and the syntax above it. A detached
 * forest's workspace container is not syntax and is not an ancestor. */
const readCasingFrame = (step: PlaybackStep, canvas: SyntaxNode) => {
  const detachedForest = canvas.replayOrigin?.kind === 'workspace';
  // Keep first-preorder lookup semantics, including aliases, while collecting
  // parent and inherited flags once instead of searching a path for every leaf.
  const exactNodes = new Map<string, {
    parent: SyntaxNode | null;
    silent: boolean;
    layout: boolean;
    ancestors: SyntaxNode[];
  }>();
  const nodesByName = new Map<string, SyntaxNode>();
  const leafIds: string[] = [];
  const visibleNodeIds = Array.isArray(step.replayVisibleNodeIds)
    ? getReplayVisibleNodeIdSet(step)
    : null;
  const visit = (node: SyntaxNode, parent: SyntaxNode | null, silent: boolean, layout: boolean, ancestors: SyntaxNode[]) => {
    silent = replayEffectiveSilence(node, silent);
    // Invisible scaffolding may contain current visible syntax grafted beneath it.
    layout = (!visibleNodeIds && layout)
      || node.replayOrigin?.kind === 'layout' || Boolean((node as any).replayLayoutOnly);
    const id = String(node.id || '');
    if (!exactNodes.has(id))
      exactNodes.set(id, { parent, silent, layout, ancestors });
    for (const name of nodeNames(node)) {
      if (!nodesByName.has(name))
        nodesByName.set(name, node);
    }
    const children = Array.isArray(node.children) ? node.children : [];
    if (!children.length && id && isLexicalLeaf(node))
      leafIds.push(id);
    const below = detachedForest && node === canvas ? ancestors : [...ancestors, node];
    children.forEach(child => visit(child, node, silent, layout, below));
  };
  visit(canvas, null, false, false, []);
  const currentLeaves = leafIds.map(leafId => {
    const info = exactNodes.get(leafId)!;
    const leaf = nodesByName.get(leafId);
    const visible = !visibleNodeIds || visibleNodeIds.has(leafId)
      || leaf?.aliasIds?.some(id => visibleNodeIds.has(String(id)));
    return !info.layout && visible && leaf ? { leaf, silent: info.silent } : null;
  }).filter((entry): entry is CasingLeaf => Boolean(entry));
  // Separate workspace roots are not ordered before one another, so only
  // pronounced words in a leaf's own tree precede it.
  const pronouncedTrees = new Set<SyntaxNode>();
  const preceded = new Set<SyntaxNode>();
  currentLeaves.forEach(({ leaf, silent }) => {
    const tree = exactNodes.get(String(leaf.id || ''))!.ancestors[0] ?? leaf;
    if (pronouncedTrees.has(tree))
      preceded.add(leaf);
    if (!silent)
      pronouncedTrees.add(tree);
  });
  return { exactNodes, nodesByName, currentLeaves, preceded };
};

const nodeNames = (node: SyntaxNode): string[] => [String(node.id || ''), ...(Array.isArray(node.aliasIds) ? node.aliasIds.map(String) : [])]
  .filter(Boolean);

/** The occurrence of the sentence's first word that nothing pronounced
 * precedes in the final frame, with the syntax above it there. A silent one
 * serves only where the final frame leaves that word unpronounced. */
const finalInitialOccurrence = (steps: readonly PlaybackStep[], initialKey: string) => {
  const finalStep = [...steps].reverse().find(step => step.replayCanvasData);
  if (!finalStep?.replayCanvasData)
    return null;
  const frame = readCasingFrame(finalStep, finalStep.replayCanvasData);
  const candidates = frame.currentLeaves.filter(({ leaf }) => !frame.preceded.has(leaf)
    && normalizeToken(String(leaf.word || leaf.label || '').trim()) === initialKey);
  const first = (candidates.find(({ silent }) => !silent) ?? candidates[0])?.leaf;
  if (!first)
    return null;
  return {
    names: new Set(nodeNames(first)),
    ancestorNames: new Set(frame.exactNodes.get(String(first.id || ''))!.ancestors.flatMap(nodeNames))
  };
};

/** Sentence-initial capitalization is orthography of the final pronounced
 * sentence, not of intermediate workspaces. Only the occurrence that is first
 * in the final sentence receives the generated capital, and only where it
 * stands in its final position: nothing pronounced precedes it in its own
 * tree, and every node above it is also above it in the final tree. A phrase
 * waiting to move to the front, or an occurrence it leaves behind, shows its
 * lowercase form; an occurrence that never moves keeps its capital from its
 * first frame, so no word flips case while it stands still. Every other
 * occurrence of the word loses only a generated capital
 * (maybeLowercaseSentenceInitialFunctionSurface); names, nouns and I keep
 * their authored form. */
export const normalizeReplaySentenceInitialCasing = (steps: PlaybackStep[], sentenceInitialSurface: string): PlaybackStep[] => {
  const initialKey = normalizeToken(sentenceInitialSurface);
  if (!initialKey)
    return steps;
  const uppercaseInitial = caseSurfaceInitial(sentenceInitialSurface, 'upper');
  const lowercaseInitial = caseSurfaceInitial(sentenceInitialSurface, 'lower');
  // A sentence that does not begin with a capital has none to give.
  if (uppercaseInitial === lowercaseInitial || sentenceInitialSurface.trim() !== uppercaseInitial)
    return steps;
  const finalInitial = finalInitialOccurrence(steps, initialKey);
  type CasingFrame = ReturnType<typeof readCasingFrame>;
  const isFinalInitial = (leaf: SyntaxNode) => Boolean(finalInitial && nodeNames(leaf).some(name => finalInitial.names.has(name)));
  const standsFinal = ({ exactNodes, preceded }: CasingFrame, leaf: SyntaxNode): boolean => {
    const info = exactNodes.get(String(leaf.id || ''));
    return Boolean(finalInitial && info && !preceded.has(leaf) && isFinalInitial(leaf)
      && info.ancestors.every(node => nodeNames(node).some(name => finalInitial.ancestorNames.has(name))));
  };
  const frames = steps.map(step => {
    const clonedCanvas = step.replayCanvasData ? cloneSyntaxTree(step.replayCanvasData) : null;
    return clonedCanvas ? { clonedCanvas, frame: readCasingFrame(step, clonedCanvas) } : null;
  });
  // The occurrence stands in its final position only from the last frame that
  // shows it anywhere else: a phrase built apart and then merged low to move
  // later is still waiting.
  const settledFrom = 1 + frames.reduce((last, entry, index) => entry?.frame.currentLeaves
    .some(({ leaf }) => isFinalInitial(leaf) && !standsFinal(entry.frame, leaf)) ? index : last, -1);
  return steps.map((step, stepIndex) => {
    const entry = frames[stepIndex];
    if (!entry)
      return step;
    const { clonedCanvas, frame } = entry;
    let changed = false;
    const { exactNodes, nodesByName, currentLeaves } = frame;
    // Read from structure, a phrase dominating a word directly (C over a raw 'Who')
    // names its projection, not the word's head; X-bar writes it as CP.
    const levels = readStructuralProjections([clonedCanvas]);
    const headsWord = (parent?: SyntaxNode | null) => !levels || !parent || levels.minimal(parent);
    const casingByLeafId = new Map<string, string>();
    currentLeaves.forEach(({ leaf }) => {
      const surface = String(leaf.word || leaf.label || '').trim();
      if (normalizeToken(surface) !== initialKey)
        return;
      const leafId = String(leaf.id || '');
      const parent = exactNodes.get(leafId)?.parent;
      if (!headsWord(parent) || !isSentenceInitialCaseAdjustableParent(parent?.label || leaf.label))
        return;
      const nextSurface = leafId && stepIndex >= settledFrom && standsFinal(frame, leaf)
        ? uppercaseInitial
        : maybeLowercaseSentenceInitialFunctionSurface({
          surface,
          sentenceInitialSurface,
          parentLabel: parent?.label || leaf.label,
          hasNominalComplement: hasDeterminerNominalComplement(parent, exactNodes.get(String(parent?.id || ''))?.parent)
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
  inputTokens?: string[]
): PlaybackStep[] => {
  const firstSentenceToken = String(resolveSavedInputTokens(sentence, inputTokens)[0] || '').trim();
  return firstSentenceToken
    ? normalizeReplaySentenceInitialCasing(steps, firstSentenceToken)
    : steps;
};
