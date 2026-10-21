import { buildRenderableCommittedCanvasData } from '../replay/replayCanvas.ts';
import type { SyntaxNode } from '../types.ts';

/**
 * The canvas TreeVisualizer paints for the current Replay step or Canopy.
 * Normalization accepts an empty workspace before the final stage. Its steps
 * carry no canvas of their own and paint nothing, so they return null rather
 * than falling back to the committed tree, which would show later syntax.
 */
export function selectReplayCanvas({ usesDerivationFrames, animated, stepCanvas, activeForest,
  committedCanonicalCanvas, committedDerivationCanvas, data }: {
  usesDerivationFrames: boolean; animated: boolean; stepCanvas: SyntaxNode | null | undefined;
  activeForest: readonly SyntaxNode[] | undefined; committedCanonicalCanvas: SyntaxNode | null;
  committedDerivationCanvas: SyntaxNode | null; data: SyntaxNode;
}): SyntaxNode | null {
  if (usesDerivationFrames) {
    if (activeForest && activeForest.length === 0) return null;
    return stepCanvas || committedCanonicalCanvas || committedDerivationCanvas || data;
  }
  if (animated) return data;
  return buildRenderableCommittedCanvasData(data);
}
