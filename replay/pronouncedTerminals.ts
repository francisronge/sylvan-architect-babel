import type { SyntaxNode } from '../types.ts';
import { authoredWord, collectPronouncedLeaves } from '../server/babelParser/nodePronunciation.js';

/**
 * The pronounced words of a tree in tree order. The contract says that order
 * is the sentence; token indexes are never used to reorder it. A leaf whose
 * token index disagrees with its tree position is reported by the parser's
 * token alignment, not silently corrected here.
 */
export const collectPronouncedTerminalSequence = (
  root?: SyntaxNode | SyntaxNode[] | null
): string[] => (Array.isArray(root) ? root : [root])
  .flatMap((item) => collectPronouncedLeaves(item))
  .map((leaf: SyntaxNode) => authoredWord(leaf)).filter(Boolean);
