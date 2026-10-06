import type { SyntaxNode } from '../../types.ts';
import { isDisplayTerminalSurface, isWordlessCategoryLeaf } from '../replayCompiler.ts';
import { readCategoryLabel } from '../categoryLabel.ts';

/** A compound head is the authored endpoint, not one arbitrarily chosen morpheme.
 * Simple heads keep their terminal; absent terminal material still fails closed. */
export const headTrajectoryAttachment = (node: SyntaxNode): 'terminal' | 'shell-bottom' => {
  const countTerminals = (current: SyntaxNode): number => current.children?.length
    ? current.children.reduce((count, child) => Math.min(2, count + countTerminals(child)), 0)
    : Number(isDisplayTerminalSurface(current.word || current.label));
  const compoundHead = readCategoryLabel(node.label)?.kind === 'head' && countTerminals(node) > 1;
  return isWordlessCategoryLeaf(node) || compoundHead ? 'shell-bottom' : 'terminal';
};
