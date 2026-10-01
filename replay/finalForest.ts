import type { ParseResult, SyntaxNode } from '../types.ts';
import { buildDerivationCanvasData } from './replayCompiler.ts';

/** Old saved results have only `tree`; current results retain every final root. */
export const finalForestForAnalysis = (analysis?: ParseResult | null): SyntaxNode[] => (
  Array.isArray(analysis?.finalForest) && analysis.finalForest.length > 0
    ? analysis.finalForest
    : analysis?.tree ? [analysis.tree] : []
);

/** A workspace root is a hidden layout device, never an authored syntax node. */
export const displayTreeForAnalysis = (analysis?: ParseResult | null): SyntaxNode | null =>
  buildDerivationCanvasData(finalForestForAnalysis(analysis));
