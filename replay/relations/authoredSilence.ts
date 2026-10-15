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


/**
 * The Replay-lens presentation of authored-silence ghosting, pure and
 * testable. Silent material must never look pronounced: even at its most
 * emphasized, ghost opacity stays below overt material (1.0), and the
 * active emphasis is carried by a glow rather than by brightness alone.
 * During another relation's moment the ghost quiets below its neutral
 * presentation, exactly like every other mark.
 */
export type GhostLensPresentation = { opacity: number; filter: string | null };

export const ghostLensPresentation = (
  emphasis: 'active' | 'quiet' | null
): GhostLensPresentation => {
  if (emphasis === 'active') {
    return { opacity: 0.72, filter: 'drop-shadow(0 0 6px rgba(52,211,153,0.85))' };
  }
  if (emphasis === 'quiet') return { opacity: 0.22, filter: null };
  return { opacity: 0.5, filter: null };
};
