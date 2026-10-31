import type { ParseBundle, ParseResult, SyntaxNode } from '../types.ts';
import { displayTreeForAnalysis, finalForestForAnalysis } from '../replay/finalForest.ts';
import { recoverLegacyInputTokens } from './legacyInputTokens.ts';
import { buildMilesNotation } from './milesNotation.ts';

export interface AnalysisDisplay {
  displayTree: SyntaxNode | null;
  inputTokens: string[] | undefined;
  notation: string;
}

/**
 * Everything App derives from the selected analysis while it renders. These
 * values are computed outside every view boundary, so a throw here unmounts the
 * whole workspace.
 */
export const deriveAnalysisDisplay = (bundle: ParseBundle, analysis: ParseResult, sentence: string): AnalysisDisplay => ({
  displayTree: displayTreeForAnalysis(analysis),
  inputTokens: bundle.inputTokens ?? recoverLegacyInputTokens(analysis, sentence),
  notation: buildMilesNotation(finalForestForAnalysis(analysis))
});

/**
 * A bundle is offered to App only when every analysis it can select yields its
 * display values, so a damaged saved record or response fails its open or
 * generation request instead of App's render. `subject` names the analyses in
 * the error.
 */
export const assertBundleDisplayable = (bundle: ParseBundle, sentence: string, subject = 'Saved analysis'): void => {
  bundle.analyses.forEach((analysis, index) => {
    try {
      deriveAnalysisDisplay(bundle, analysis, sentence);
    } catch (error) {
      throw new Error(`${subject} ${index + 1} cannot be displayed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
};
