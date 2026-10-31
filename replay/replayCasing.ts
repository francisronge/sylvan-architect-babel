import { categoryLabel } from './categoryLabel.ts';
/** Preserve sentence-initial casing according to the visible syntactic context. */
import { caseSurfaceInitial, resolveSavedInputTokens } from '../server/babelParser/surfaceTokens.js';
import { type SyntaxNode } from '../types.ts';
import { replayOwnerId } from './displayIdentity.ts';
import { readStructuralProjections } from './projectionStructure.ts';
import { readStructuralHeads, type StructuralHeads } from './structuralHeads.ts';
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

/** Movements whose landing pronounces the sentence's first word, with the
 * step where each first appears. */
const overtInitialMovements = (steps: readonly PlaybackStep[], initialKey: string) => {
  const found = new Map<string, { moment: number; priorSourceNodeId: string; targetNodeId: string }>();
  steps.forEach((step, moment) => (step.replayRelationLinks || []).forEach(link => {
    const priorSourceNodeId = String(link.priorSourceNodeId || link.sourceNodeId || '');
    const targetNodeId = String(link.targetNodeId || '');
    const key = `${priorSourceNodeId}>${targetNodeId}`;
    if (!priorSourceNodeId || !targetNodeId || found.has(key) || !isResolvedMovementLink(link) || !step.replayCanvasData)
      return;
    const landing = findNodeByName(step.replayCanvasData, targetNodeId);
    const words = landing ? collectOvertLeafNodeIdsInOrder(landing).map(id => findNodeByName(landing, id)) : [];
    if (words.some(word => normalizeToken(String(word?.word || word?.label || '').trim()) === initialKey))
      found.set(key, { moment, priorSourceNodeId, targetNodeId });
  }));
  return [...found.values()];
};

const findNodeByName = (root: SyntaxNode, name: string): SyntaxNode | undefined => {
  if (String(root.id || '') === name || root.aliasIds?.some(id => String(id) === name))
    return root;
  for (const child of root.children || []) {
    const found = findNodeByName(child, name);
    if (found)
      return found;
  }
  return undefined;
};

export const normalizeReplaySentenceInitialCasing = (steps: PlaybackStep[], sentenceInitialSurface: string): PlaybackStep[] => {
  const initialKey = normalizeToken(sentenceInitialSurface);
  if (!initialKey)
    return steps;
  const uppercaseInitial = caseSurfaceInitial(sentenceInitialSurface, 'upper');
  const lowercaseInitial = caseSurfaceInitial(sentenceInitialSurface, 'lower');
  if (uppercaseInitial === lowercaseInitial)
    return steps;
  const movements = overtInitialMovements(steps, initialKey);
  return steps.map((step, stepIndex) => {
    if (!step.replayCanvasData)
      return step;
    const clonedCanvas = cloneSyntaxTree(step.replayCanvasData);
    if (!clonedCanvas)
      return step;
    // Separate workspaces keep the authored form of their first word, but a
    // word preceded by visible pronounced material in its own workspace is
    // never sentence-initial.
    const detachedForest = clonedCanvas.replayOrigin?.kind === 'workspace';
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
    const leafWorkspaces = new Map<string, SyntaxNode>();
    const visibleNodeIds = Array.isArray(step.replayVisibleNodeIds)
      ? getReplayVisibleNodeIdSet(step)
      : null;
    const visit = (node: SyntaxNode, parent: SyntaxNode | null, silent: boolean, layout: boolean, workspace: SyntaxNode) => {
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
      if (!children.length && id && isLexicalLeaf(node)) {
        leafIds.push(id);
        if (!leafWorkspaces.has(id))
          leafWorkspaces.set(id, workspace);
      }
      children.forEach(child => visit(child, node, silent, layout,
        detachedForest && node === clonedCanvas ? child : workspace));
    };
    visit(clonedCanvas, null, false, false, clonedCanvas);
    // Read from structure, a phrase dominating a word directly (C over a raw 'Who')
    // names its projection, not the word's head; X-bar writes it as CP.
    const levels = readStructuralProjections([clonedCanvas]);
    const headsWord = (parent?: SyntaxNode | null) => !levels || !parent || levels.minimal(parent);
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
    const firstPronouncedLeafIds = new Map<SyntaxNode, string>();
    currentLeaves.forEach(({ leaf, silent }) => {
      const workspace = leafWorkspaces.get(String(leaf.id || ''))!;
      if (!silent && !firstPronouncedLeafIds.has(workspace))
        firstPronouncedLeafIds.set(workspace, String(leaf.id || ''));
    });
    let heads: StructuralHeads | undefined;
    // A complement: the phrase's parent projects from a head beside it.
    const precededComplement = (phraseId: string, leafId: string): boolean => {
      const phrase = nodesByName.get(phraseId);
      const parent = phrase && exactNodes.get(String(phrase.id || ''))?.parent;
      if (!phrase || !parent)
        return false;
      heads ??= readStructuralHeads(detachedForest ? clonedCanvas.children || [] : [clonedCanvas]);
      const head = heads.projectingDaughter(parent);
      if (!head || head === phrase || !heads.minimal(head))
        return false;
      const workspace = leafWorkspaces.get(leafId);
      const pronounced = leafIds.filter(id => !exactNodes.get(id)!.layout && !exactNodes.get(id)!.silent && leafWorkspaces.get(id) === workspace);
      return pronounced.indexOf(leafId) > 0;
    };
    const casingByLeafId = new Map<string, string>();
    currentLeaves.forEach(({ leaf }) => {
      const surface = String(leaf.word || leaf.label || '').trim();
      if (normalizeToken(surface) !== initialKey)
        return;
      const leafId = String(leaf.id || '');
      const parent = exactNodes.get(leafId)?.parent;
      if (!headsWord(parent) || !isSentenceInitialCaseAdjustableParent(parent?.label || leaf.label))
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
      // A phrase that an overt movement will carry to the front stands, until
      // it first moves, in its base position. A complement there with
      // pronounced words before it in its stage (a base object after its
      // verb) is not sentence-initial, even while those words are still to be
      // selected.
      const contains = (id: string) => collectOvertLeafNodeIdsInOrder(nodesByName.get(id) ?? {} as SyntaxNode).includes(leafId);
      const awaitsMovement = movements.some(move => move.moment > stepIndex && contains(move.priorSourceNodeId)
          && precededComplement(move.priorSourceNodeId, leafId))
        && !movements.some(move => move.moment <= stepIndex && contains(move.targetNodeId));
      const nextSurface = leafId && leafId === firstPronouncedLeafIds.get(leafWorkspaces.get(leafId)!) && !awaitsMovement
        ? (detachedForest ? surface : authoredLowercaseSource && !surfacedLanding ? authoredSurface : uppercaseInitial)
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
