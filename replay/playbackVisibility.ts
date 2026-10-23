/** Step progress labels and visible-word counts over a compiled step sequence. */
import { authoredWord } from '../server/babelParser/nodePronunciation.js';
import { type SyntaxNode } from '../types.ts';
import { buildReplayProgressLabel, getReplayPlanStage } from './playbackFormatting.ts';
import { isLexicalLeaf, normalizeToken } from './syntaxForest.ts';
import { type DerivationReplayPlan, type PlaybackStep } from './types.ts';

export const recountReplayProgress = (steps: PlaybackStep[], replayPlan?: DerivationReplayPlan | null): PlaybackStep[] => {
  const counts = new Map<number, number>();
  const positions = new Map<number, number>();
  steps.forEach(step => {
    const index = step.replayFrameIndex;
    if (index !== undefined)
      counts.set(index, (counts.get(index) || 0) + 1);
  });
  return steps.map(step => {
    const index = step.replayFrameIndex;
    const stage = index === undefined ? undefined : getReplayPlanStage(replayPlan, index);
    if (!stage || index === undefined)
      return step;
    const position = (positions.get(index) || 0) + 1;
    positions.set(index, position);
    return {
      ...step,
      replayStageStepIndex: position - 1,
      replayProgressLabel: buildReplayProgressLabel(stage, replayPlan!.stages.length, position, counts.get(index)!)
    };
  });
};

export const collectVisibleReplayOvertTokenCounts = (step?: PlaybackStep | null): Map<string, number> => {
  const counts = new Map<string, number>();
  if (!step?.replayCanvasData || !Array.isArray(step.replayVisibleNodeIds))
    return counts;
  const visibleIds = new Set(step.replayVisibleNodeIds
    .map((nodeId) => String(nodeId || ''))
    .filter(Boolean));
  const countedLeafIds = new Set<string>();
  const nodesByName = new Map<string, SyntaxNode>();
  const index = (node: SyntaxNode) => {
    for (const name of [node.id, ...(Array.isArray(node.aliasIds) ? node.aliasIds : [])]) {
      const key = String(name || '');
      if (!nodesByName.has(key))
        nodesByName.set(key, node);
    }
    (Array.isArray(node.children) ? node.children : []).forEach(index);
  };
  index(step.replayCanvasData);
  const countedSubtrees = new Set<SyntaxNode>();
  const countLeaves = (node: SyntaxNode): boolean => {
    if (countedSubtrees.has(node))
      return true;
    const children = Array.isArray(node.children) ? node.children : [];
    let complete: boolean;
    if (children.length) {
      // Visit every child even when an earlier child contains an unnamed leaf.
      complete = true;
      for (const child of children) {
        if (!countLeaves(child))
          complete = false;
      }
    }
    else {
      const leafId = String(node.id || '');
      complete = Boolean(leafId);
      if ((!leafId || visibleIds.has(leafId)) && (!leafId || !countedLeafIds.has(leafId))) {
        if (leafId)
          countedLeafIds.add(leafId);
        const key = isLexicalLeaf(node) ? normalizeToken(authoredWord(node)) : '';
        if (key)
          counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    // Named leaves are counted once. Preserve the existing multiplicity of
    // unnamed leaves when several visible ancestors expose the same subtree.
    if (complete)
      countedSubtrees.add(node);
    return complete;
  };
  step.replayVisibleNodeIds.forEach((nodeIdValue) => {
    const nodeId = String(nodeIdValue || '');
    if (!nodeId)
      return;
    const node = nodesByName.get(nodeId);
    if (node)
      countLeaves(node);
  });
  return counts;
};
