import type { SyntaxNode } from '../../types.ts';

/** A silent occurrence silences its complete subtree, including lexical leaves. */
export const collectAuthoredSilentSubtreeIds = (node?: SyntaxNode): string[] => {
  const ids: string[] = [];
  const visit = (current: SyntaxNode, inherited: boolean) => {
    const silent = inherited || current.silent === true;
    if (silent && current.id) ids.push(String(current.id));
    current.children?.forEach(child => visit(child, silent));
  };
  if (node) visit(node, false);
  return ids;
};
