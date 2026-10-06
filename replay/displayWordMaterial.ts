import type { SyntaxNode } from '../types.ts';
import { caseSurfaceInitial } from '../server/babelParser/surfaceTokens.js';

/** Generated sentence casing belongs to a display child, not a new authored
 * word. Callers supply the child's current connected syntax owner. */
export function authoredDisplayWord(node: SyntaxNode, owner?: SyntaxNode): string | undefined {
  if (!owner?.word || node.replayOrigin?.kind !== 'word'
    || node.replayOrigin.ownerId !== owner.id || node.children?.length
    || node.word !== node.label
    || caseSurfaceInitial(node.word, 'lower') !== caseSurfaceInitial(owner.word, 'lower')) return;
  return owner.word;
}
